"""
synthetic_api.py — FastAPI router for the Pulveriser Digital Twin Simulator.

Mounted on the existing main_server.py with prefix /api/synthetic.

Endpoints:
    POST /api/synthetic/configure   — set config + severities
    POST /api/synthetic/preset      — apply named condition preset
    GET  /api/synthetic/generate    — generate one window (full record)
    GET  /api/synthetic/signal      — get signal samples for display
    GET  /api/synthetic/health      — MHI/PQI/GQI + alarms + KPIs  ← auto-saves to DB
    GET  /api/synthetic/history     — last N windows (for Streamlit)
    POST /api/synthetic/reset       — reset simulator state
    GET  /api/synthetic/status      — current simulator state
    GET  /api/synthetic/presets     — list available presets
"""

from __future__ import annotations

import threading
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from synthetic.config import load_config, PulveriserConfig
from synthetic.simulator import PulveriserSimulator

# DB persistence — graceful degradation if DB not configured
try:
    from db_store import insert_cbm_window, db_is_ready
    _DB_AVAILABLE = True
except Exception:
    _DB_AVAILABLE = False
    def db_is_ready(): return False          # type: ignore
    def insert_cbm_window(_): pass           # type: ignore

# ---------------------------------------------------------------------------
# Router + global state
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/api/synthetic", tags=["synthetic"])

_sim: PulveriserSimulator = PulveriserSimulator(load_config(), seed=42)

# In-memory ring-buffer (max 200 windows for Streamlit history)
_history: List[Dict[str, Any]] = []
_HISTORY_MAX = 200
_history_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _save_to_db_background(record: dict) -> None:
    """Persist window to DB in a daemon thread — never blocks the API."""
    try:
        insert_cbm_window(record)
    except Exception:
        pass


def _push_to_history(record: dict) -> None:
    """Append a compact summary row to the ring-buffer."""
    sev  = record.get("severity",  {})
    idx  = record.get("indices",   {})
    alm  = record.get("alarms",    {})
    kpi  = record.get("kpis",      {})
    feat = record.get("features",  {})
    vib  = feat.get("vibration",   {})
    cur  = feat.get("current",     {})
    tmp  = feat.get("temperature", {})

    row = {
        "window_idx":           record.get("window_idx"),
        "timestamp":            record.get("timestamp"),
        # fault state
        "severity_bearing":     sev.get("bearing_fault", 0),
        "severity_blade":       sev.get("blade_wear",    0),
        # health indices
        "MHI":                  idx.get("MHI"),
        "PQI":                  idx.get("PQI"),
        "GQI":                  idx.get("GQI"),
        "alarm_severity":       alm.get("severity"),
        "min_index":            alm.get("min_index"),
        # KPIs
        "CycleTime":            kpi.get("CycleTime"),
        "Throughput":           kpi.get("Throughput"),
        "GrindingEfficiency":   kpi.get("GrindingEfficiency"),
        "LoadRatio":            kpi.get("LoadRatio"),
        # Vibration features
        "vib_RMS":              vib.get("RMS"),
        "vib_Kurtosis":         vib.get("Kurtosis"),
        "vib_CrestFactor":      vib.get("CrestFactor"),
        "vib_SpectralCentroid": vib.get("SpectralCentroid"),
        "vib_MidBandEnergy":    vib.get("MidBandEnergy"),
        "vib_THD":              vib.get("THD"),
        # Current features
        "cur_RMS":              cur.get("RMS"),
        "cur_Kurtosis":         cur.get("Kurtosis"),
        "cur_THD":              cur.get("THD"),
        # Temperature features
        "temp_Mean":            tmp.get("Mean"),
        "temp_RMS":             tmp.get("RMS"),
        "temp_RateOfChange":    tmp.get("RateOfChange"),
    }

    with _history_lock:
        _history.append(row)
        if len(_history) > _HISTORY_MAX:
            _history.pop(0)


def _apply_severities(cfg: PulveriserConfig, sevs: Dict[str, float]) -> None:
    # Propagate global severities to signal overrides if overrides are not specified
    # (Backward compatibility for legacy Streamlit and test client payloads)
    if (sevs.get("bearing_fault", 0.0) > 0.0 and 
        sevs.get("vib_bearing_fault", 0.0) == 0.0 and 
        sevs.get("cur_bearing_fault", 0.0) == 0.0 and 
        sevs.get("temp_bearing_fault", 0.0) == 0.0):
        sevs["vib_bearing_fault"] = sevs["bearing_fault"]
        sevs["cur_bearing_fault"] = sevs["bearing_fault"]
        sevs["temp_bearing_fault"] = sevs["bearing_fault"]

    if (sevs.get("blade_wear", 0.0) > 0.0 and 
        sevs.get("vib_blade_wear", 0.0) == 0.0 and 
        sevs.get("cur_blade_wear", 0.0) == 0.0 and 
        sevs.get("temp_blade_wear", 0.0) == 0.0):
        sevs["vib_blade_wear"] = sevs["blade_wear"]
        sevs["cur_blade_wear"] = sevs["blade_wear"]
        sevs["temp_blade_wear"] = sevs["blade_wear"]

    for fault, val in sevs.items():
        setattr(cfg.severity, fault, max(0.0, min(1.0, val)))

    # Set signal-specific enable flags based on overrides
    cfg.vibration.bearing_fault["enable"] = (sevs.get("vib_bearing_fault", 0.0) > 0.0 or sevs.get("bearing_fault", 0.0) > 0.0)
    cfg.current.bearing_fault["enable"]   = (sevs.get("cur_bearing_fault", 0.0) > 0.0 or sevs.get("bearing_fault", 0.0) > 0.0)
    cfg.temperature.bearing_fault["enable"] = (sevs.get("temp_bearing_fault", 0.0) > 0.0 or sevs.get("bearing_fault", 0.0) > 0.0)

    # Note: Vibration blade_wear has no enable key in its config, it uses amplitude > 0
    cfg.current.blade_wear["enable"]     = (sevs.get("cur_blade_wear", 0.0) > 0.0 or sevs.get("blade_wear", 0.0) > 0.0)
    cfg.temperature.blade_wear["enable"]  = (sevs.get("temp_blade_wear", 0.0) > 0.0 or sevs.get("blade_wear", 0.0) > 0.0)

    # Rest of the standard faults
    for fault, val in sevs.items():
        if fault in ["vib_blade_wear", "vib_bearing_fault", "cur_blade_wear", "cur_bearing_fault", "temp_blade_wear", "temp_bearing_fault"]:
            continue
        enabled = val > 0
        for sig_cfg in [cfg.vibration, cfg.current, cfg.temperature]:
            if hasattr(sig_cfg, fault):
                sub = getattr(sig_cfg, fault)
                if isinstance(sub, dict):
                    sub["enable"] = enabled


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class SeverityRequest(BaseModel):
    blade_wear:       float = Field(0.0, ge=0.0, le=1.0)
    bearing_fault:    float = Field(0.0, ge=0.0, le=1.0)
    imbalance:        float = Field(0.0, ge=0.0, le=1.0)
    misalignment:     float = Field(0.0, ge=0.0, le=1.0)
    looseness:        float = Field(0.0, ge=0.0, le=1.0)
    material_buildup: float = Field(0.0, ge=0.0, le=1.0)
    partial_clogging: float = Field(0.0, ge=0.0, le=1.0)
    choking:          float = Field(0.0, ge=0.0, le=1.0)

    # Per-signal overrides
    vib_blade_wear:    float = Field(0.0, ge=0.0, le=1.0)
    vib_bearing_fault: float = Field(0.0, ge=0.0, le=1.0)
    cur_blade_wear:    float = Field(0.0, ge=0.0, le=1.0)
    cur_bearing_fault: float = Field(0.0, ge=0.0, le=1.0)
    temp_blade_wear:   float = Field(0.0, ge=0.0, le=1.0)
    temp_bearing_fault:float = Field(0.0, ge=0.0, le=1.0)


class ConfigureRequest(BaseModel):
    severity:    Optional[SeverityRequest] = None
    load_ratio:  float = Field(0.70, ge=0.0, le=2.0)
    seed:        Optional[int] = None
    reset_state: bool = False


CONDITION_PRESETS: Dict[str, Dict[str, float]] = {
    "healthy": {k: 0.0 for k in [
        "blade_wear","bearing_fault","imbalance","misalignment",
        "looseness","material_buildup","partial_clogging","choking"]},
    "bearing": {"blade_wear": 0.0, "bearing_fault": 1.0, "imbalance": 0.0,
                "misalignment": 0.0, "looseness": 0.0, "material_buildup": 0.0,
                "partial_clogging": 0.0, "choking": 0.0},
    "blade":   {"blade_wear": 1.0, "bearing_fault": 0.0, "imbalance": 0.0,
                "misalignment": 0.0, "looseness": 0.0, "material_buildup": 0.0,
                "partial_clogging": 0.0, "choking": 0.0},
    "combined":{"blade_wear": 0.5, "bearing_fault": 0.25, "imbalance": 0.3,
                "misalignment": 0.2, "looseness": 0.1, "material_buildup": 0.4,
                "partial_clogging": 0.5, "choking": 0.0},
}

SEVERITY_LEVEL_MAP = {
    "healthy": 0.00, "very_mild": 0.10, "mild": 0.25,
    "moderate": 0.50, "severe": 0.75, "critical": 1.00,
}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/configure")
async def configure(req: ConfigureRequest) -> Dict[str, Any]:
    global _sim
    cfg = load_config()
    if req.severity:
        _apply_severities(cfg, req.severity.dict())
    _sim.load_ratio = req.load_ratio
    if req.reset_state:
        _sim.reset(config=cfg, seed=req.seed)
    else:
        _sim.update_config(cfg)
    return {
        "status": "ok",
        "window_idx": _sim._window_idx,
        "severity": {k: getattr(cfg.severity, k) for k in [
            "blade_wear","bearing_fault","imbalance","misalignment",
            "looseness","material_buildup","partial_clogging","choking"]},
        "load_ratio": _sim.load_ratio,
    }


@router.post("/preset")
async def set_preset(
    condition: str = Query(...),
    severity_level: Optional[str] = Query(None),
    reset_state: bool = Query(True),
) -> Dict[str, Any]:
    global _sim
    if condition not in CONDITION_PRESETS:
        return {"error": f"Unknown condition: {condition}. Choose from {list(CONDITION_PRESETS)}"}
    sevs = dict(CONDITION_PRESETS[condition])
    if severity_level and severity_level in SEVERITY_LEVEL_MAP:
        scale = SEVERITY_LEVEL_MAP[severity_level]
        sevs = {k: (scale if v > 0 else 0.0) for k, v in sevs.items()}
    cfg = load_config()
    _apply_severities(cfg, sevs)
    if reset_state:
        _sim.reset(config=cfg)
    else:
        _sim.update_config(cfg)
    return {"status": "ok", "condition": condition, "severity_level": severity_level, "severity": sevs}


@router.get("/generate")
async def generate_window() -> Dict[str, Any]:
    global _sim
    record = _sim.run_window()
    _push_to_history(record)
    threading.Thread(target=_save_to_db_background, args=(record,), daemon=True).start()
    return {"status": "ok", **record}


@router.get("/signal")
async def get_signal(
    signal_type: str = Query("vibration", description="vibration | current | temperature"),
    n_points: int = Query(500, description="Points to return (downsampled)"),
) -> Dict[str, Any]:
    global _sim
    record = _sim.run_window()
    _push_to_history(record)
    threading.Thread(target=_save_to_db_background, args=(record,), daemon=True).start()

    sigs = record.get("signals", {})
    signal_map = {
        "vibration":   ("vibration",   "time_vib"),
        "current":     ("current",     "time_cur"),
        "temperature": ("temperature", "time_temp"),
    }
    if signal_type not in signal_map:
        return {"error": f"Unknown signal_type: {signal_type}"}

    sig_key, time_key = signal_map[signal_type]
    raw_sig  = sigs.get(sig_key, [])
    raw_time = sigs.get(time_key, [])

    if len(raw_sig) > n_points:
        step = max(1, len(raw_sig) // n_points)
        raw_sig  = raw_sig[::step][:n_points]
        raw_time = raw_time[::step][:n_points]

    return {
        "status":      "ok",
        "signal_type": signal_type,
        "window_idx":  record["window_idx"],
        "time":        raw_time,
        "values":      raw_sig,
        "features":    record["features"].get(signal_type, {}),
        "severity":    record["severity"],
    }


@router.get("/health")
async def get_health() -> Dict[str, Any]:
    """
    Generate one window → save to DB (background) → cache in history → return compact JSON.
    This is the primary polling endpoint for both React and Streamlit.
    """
    global _sim
    record = _sim.run_window()

    _push_to_history(record)
    threading.Thread(target=_save_to_db_background, args=(record,), daemon=True).start()

    return {
        "status":     "ok",
        "window_idx": record["window_idx"],
        "timestamp":  record["timestamp"],
        "indices":    record["indices"],
        "alarms":     record["alarms"],
        "kpis":       record["kpis"],
        "ewma":       record["ewma"],
        "severity":   record.get("severity", {}),
        "features": {
            "vibration": {k: v for k, v in record["features"]["vibration"].items()
                          if k in ["RMS","CrestFactor","Kurtosis","SpectralCentroid",
                                   "MidBandEnergy","HighBandEnergy","THD"]},
            "current":   {k: v for k, v in record["features"]["current"].items()
                          if k in ["RMS","Variance","Kurtosis","THD"]},
            "temperature": {k: v for k, v in record["features"]["temperature"].items()
                            if k in ["RMS","RateOfChange","Mean"]},
        },
    }


@router.get("/history")
async def get_history(limit: int = Query(100, ge=1, le=200)) -> Dict[str, Any]:
    """Return the last `limit` windows from the in-memory ring-buffer (for Streamlit)."""
    with _history_lock:
        rows = list(_history[-limit:])
    return {"status": "ok", "count": len(rows), "history": rows}


@router.post("/reset")
async def reset_simulator(seed: Optional[int] = Query(None)) -> Dict[str, Any]:
    global _sim
    with _history_lock:
        _history.clear()
    _sim.reset(seed=seed)
    return {"status": "ok", "message": "Simulator reset", "window_idx": 0}


@router.get("/status")
async def get_status() -> Dict[str, Any]:
    global _sim
    cfg = _sim.config
    return {
        "status":         "ok",
        "window_idx":     _sim._window_idx,
        "load_ratio":     _sim.load_ratio,
        "db_connected":   db_is_ready(),
        "history_length": len(_history),
        "severity": {k: getattr(cfg.severity, k) for k in [
            "blade_wear","bearing_fault","imbalance","misalignment",
            "looseness","material_buildup","partial_clogging","choking",
            "vib_blade_wear", "vib_bearing_fault",
            "cur_blade_wear", "cur_bearing_fault",
            "temp_blade_wear", "temp_bearing_fault"
        ]},
        "machine": {
            "id":          cfg.machine.machine_id,
            "type":        cfg.machine.machine_type,
            "motor_kw":    cfg.machine.motor_power_kw,
            "rpm":         cfg.machine.rpm,
            "fs_vib":      cfg.fs_vib,
            "window_size": cfg.window_vib,
        },
    }


@router.get("/presets")
async def list_presets() -> Dict[str, Any]:
    return {"condition_presets": CONDITION_PRESETS, "severity_levels": SEVERITY_LEVEL_MAP}


@router.get("/download_raw_csv")
async def download_raw_csv() -> Any:
    global _sim
    # Run a window with current settings to capture exact fault configurations
    record = _sim.run_window()
    
    sigs = record.get("signals", {})
    
    time_vib = sigs.get("time_vib", [])
    vibration = sigs.get("vibration", [])
    
    time_cur = sigs.get("time_cur", [])
    current = sigs.get("current", [])
    
    time_temp = sigs.get("time_temp", [])
    temperature = sigs.get("temperature", [])
    
    # Align/interpolate current and temperature to the high-frequency vibration time points
    import numpy as np
    
    vib_len = len(time_vib)
    if vib_len == 0:
        return {"error": "No vibration data generated"}
        
    time_vib_arr = np.array(time_vib)
    
    if len(time_cur) > 0 and len(current) > 0:
        current_interp = np.interp(time_vib_arr, np.array(time_cur), np.array(current))
    else:
        current_interp = np.zeros(vib_len)
        
    if len(time_temp) > 0 and len(temperature) > 0:
        temp_interp = np.interp(time_vib_arr, np.array(time_temp), np.array(temperature))
    else:
        temp_interp = np.zeros(vib_len)
        
    import io
    import csv
    from fastapi.responses import StreamingResponse
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Time (s)", "Vibration (g)", "Motor Current (A)", "Temperature (C)"])
    for i in range(vib_len):
        writer.writerow([
            f"{time_vib[i]:.6f}",
            f"{vibration[i]:.6f}",
            f"{current_interp[i]:.6f}",
            f"{temp_interp[i]:.6f}"
        ])
        
    output.seek(0)
    
    headers = {
        'Content-Disposition': 'attachment; filename="pulveriser_raw_1s_data.csv"'
    }
    return StreamingResponse(output, media_type="text/csv", headers=headers)



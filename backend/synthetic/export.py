"""
export.py — CSV / JSON / MAT export for the Pulveriser Digital Twin.

Implements the ``output`` section of the Control JSON (Section 5):

    "output": { "csv": true, "json": true, "mat": false }

Entry point::

    from synthetic.export import export_records, export_from_control_cfg

The exporter never touches internal model constants — it serialises the
structured window records that the PulveriserSimulator already produces.
"""

from __future__ import annotations

import csv
import io
import json
import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Union


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------

def _flatten_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """
    Flatten a window record into a single-level dict suitable for CSV rows.

    The following keys are expanded:
      severity  → sev_{fault}
      features  → {vib|cur|tmp}_{FeatureName}
      ewma      → ewma_{signal}_{slow|fast|gap|slope}
      indices   → MHI, PQI, GQI
      alarms    → alarm_{early|mid|late|normal|severity}
      kpis      → {CycleTime|Throughput|GrindingEfficiency|...}

    Signal arrays (signals key) are omitted for CSV compactness.
    """
    flat: Dict[str, Any] = {
        "window_idx": record.get("window_idx"),
        "timestamp":  record.get("timestamp"),
        "machine_id": record.get("machine_id"),
    }

    for fault, val in record.get("severity", {}).items():
        flat[f"sev_{fault}"] = val

    feat = record.get("features", {})
    for sig_name, feat_dict in feat.items():
        prefix = {"vibration": "vib", "current": "cur", "temperature": "tmp"}.get(sig_name, sig_name)
        for feat_key, feat_val in feat_dict.items():
            flat[f"{prefix}_{feat_key}"] = feat_val

    ewma = record.get("ewma", {})
    for sig_name, ewma_dict in ewma.items():
        for ek, ev in ewma_dict.items():
            flat[f"ewma_{sig_name}_{ek}"] = ev

    for idx_name, val in record.get("indices", {}).items():
        flat[idx_name] = val

    alarms = record.get("alarms", {})
    for ak, av in alarms.items():
        flat[f"alarm_{ak}"] = av

    for kpi_name, val in record.get("kpis", {}).items():
        flat[kpi_name] = val

    return flat


def export_csv(
    records: List[Dict[str, Any]],
    output_path: Union[str, Path, None] = None,
) -> Optional[str]:
    """
    Export window records to CSV.

    Args:
        records:      List of window record dicts from PulveriserSimulator.
        output_path:  If provided, write to file; otherwise return CSV string.

    Returns:
        CSV string if output_path is None, else None (written to file).
    """
    if not records:
        return "" if output_path is None else None

    flat_records = [_flatten_record(r) for r in records]
    fieldnames   = list(flat_records[0].keys())

    if output_path is not None:
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(flat_records)
        return None
    else:
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(flat_records)
        return buf.getvalue()


# ---------------------------------------------------------------------------
# JSON
# ---------------------------------------------------------------------------

def _sanitize_for_json(obj: Any) -> Any:
    """Recursively convert numpy scalars / arrays to plain Python types."""
    try:
        import numpy as np
        if isinstance(obj, np.ndarray):
            return [round(float(x), 6) for x in obj.flat]
        if isinstance(obj, (np.floating, np.integer)):
            return obj.item()
    except ImportError:
        pass

    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(v) for v in obj]
    return obj


def export_json(
    records: List[Dict[str, Any]],
    output_path: Union[str, Path, None] = None,
    indent: int = 2,
    include_signals: bool = True,
) -> Optional[str]:
    """
    Export window records to JSON.

    Args:
        records:         List of window record dicts.
        output_path:     If provided, write to file; else return JSON string.
        indent:          JSON indentation level.
        include_signals: Include raw signal arrays (large). Default True.

    Returns:
        JSON string if output_path is None, else None (written to file).
    """
    if not include_signals:
        cleaned = [{k: v for k, v in r.items() if k != "signals"} for r in records]
    else:
        cleaned = records

    sanitized = _sanitize_for_json(cleaned)
    json_str  = json.dumps(sanitized, indent=indent)

    if output_path is not None:
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(json_str)
        return None
    return json_str


# ---------------------------------------------------------------------------
# MAT (MATLAB .mat)
# ---------------------------------------------------------------------------

def export_mat(
    records: List[Dict[str, Any]],
    output_path: Union[str, Path],
    include_signals: bool = False,
) -> None:
    """
    Export window records to a MATLAB .mat file via scipy.io.savemat.

    Structure saved:
      - window_idx       (1×N int array)
      - MHI / PQI / GQI (1×N float arrays)
      - vib_RMS / vib_Kurtosis / vib_CrestFactor / etc.
      - cur_RMS / tmp_RMS
      - CycleTime / Throughput / GrindingEfficiency
      - severity_{fault}
      - If include_signals: vibration / current / temperature (N_windows × N_samples)

    Args:
        records:         List of window record dicts.
        output_path:     Destination .mat file path.
        include_signals: Include raw signal arrays. Default False (large).

    Raises:
        ImportError: If scipy is not installed.
    """
    try:
        from scipy.io import savemat
        import numpy as np
    except ImportError as exc:
        raise ImportError(
            "scipy is required for MAT export: pip install scipy"
        ) from exc

    if not records:
        return

    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    mdict: Dict[str, Any] = {}

    # ── Scalar time-series arrays ──────────────────────────────────────────
    n = len(records)
    mdict["window_idx"] = np.array([r.get("window_idx", i) for i, r in enumerate(records)], dtype=np.int32)

    # Indices
    for idx_key in ["MHI", "PQI", "GQI"]:
        mdict[idx_key] = np.array(
            [r.get("indices", {}).get(idx_key, np.nan) for r in records], dtype=np.float64
        )

    # Features
    sig_prefix = {"vibration": "vib", "current": "cur", "temperature": "tmp"}
    for sig_name, prefix in sig_prefix.items():
        sample_feat = records[0].get("features", {}).get(sig_name, {})
        for feat_key in sample_feat:
            mdict[f"{prefix}_{feat_key}"] = np.array(
                [r.get("features", {}).get(sig_name, {}).get(feat_key, np.nan) for r in records],
                dtype=np.float64,
            )

    # Severity
    sample_sev = records[0].get("severity", {})
    for fault in sample_sev:
        mdict[f"severity_{fault}"] = np.array(
            [r.get("severity", {}).get(fault, 0) for r in records], dtype=np.float64
        )

    # KPIs
    sample_kpi = records[0].get("kpis", {})
    for kpi_key in sample_kpi:
        mdict[kpi_key] = np.array(
            [r.get("kpis", {}).get(kpi_key, np.nan) for r in records], dtype=np.float64
        )

    # Alarms
    mdict["alarm_severity_label"] = np.array(
        [r.get("alarms", {}).get("severity", "NORMAL") for r in records], dtype=object
    )

    # EWMA
    for sig_name in ["vibration_rms", "current_rms", "temperature"]:
        for ek in ["slow", "fast", "gap", "slope"]:
            vals = [r.get("ewma", {}).get(sig_name, {}).get(ek, np.nan) for r in records]
            mdict[f"ewma_{sig_name}_{ek}"] = np.array(vals, dtype=np.float64)

    # ── Optional raw signals ───────────────────────────────────────────────
    if include_signals:
        for sig_key in ["vibration", "current", "temperature"]:
            arrays = [r.get("signals", {}).get(sig_key) for r in records]
            if any(a is not None for a in arrays):
                lengths = [len(a) for a in arrays if a is not None]
                max_len = max(lengths) if lengths else 0
                mat_arr = np.full((n, max_len), np.nan, dtype=np.float64)
                for i, arr in enumerate(arrays):
                    if arr is not None:
                        arr_np = np.asarray(arr, dtype=np.float64)
                        mat_arr[i, :len(arr_np)] = arr_np
                mdict[sig_key] = mat_arr

    savemat(str(path), mdict, do_compression=True)


# ---------------------------------------------------------------------------
# Combined entry point
# ---------------------------------------------------------------------------

def export_records(
    records: List[Dict[str, Any]],
    output_config: Dict[str, bool],
    output_dir: Union[str, Path] = ".",
    filename_stem: str = "pulveriser_sim",
    include_signals_json: bool = True,
    include_signals_mat:  bool = False,
) -> Dict[str, Optional[str]]:
    """
    Export records in all formats requested by the output section of the Control JSON.

    Args:
        records:              List of window record dicts.
        output_config:        Dict with keys: csv, json, mat (bool each).
        output_dir:           Directory to write files into.
        filename_stem:        Base filename (without extension).
        include_signals_json: Include raw signal arrays in JSON export.
        include_signals_mat:  Include raw signal arrays in MAT export.

    Returns:
        Dict mapping format → output path string (or None if format disabled).

    Example::

        paths = export_records(records, {"csv": True, "json": True, "mat": False})
        # paths["csv"]  → "pulveriser_sim_20260713_093800.csv"
        # paths["json"] → "pulveriser_sim_20260713_093800.json"
    """
    ts      = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    stem    = f"{filename_stem}_{ts}"
    out_dir = Path(output_dir)
    results: Dict[str, Optional[str]] = {"csv": None, "json": None, "mat": None}

    if output_config.get("csv", False):
        csv_path = out_dir / f"{stem}.csv"
        export_csv(records, csv_path)
        results["csv"] = str(csv_path)

    if output_config.get("json", False):
        json_path = out_dir / f"{stem}.json"
        export_json(records, json_path, include_signals=include_signals_json)
        results["json"] = str(json_path)

    if output_config.get("mat", False):
        mat_path = out_dir / f"{stem}.mat"
        export_mat(records, mat_path, include_signals=include_signals_mat)
        results["mat"] = str(mat_path)

    return results


def export_bytes(
    records: List[Dict[str, Any]],
    fmt: str,
    include_signals: bool = False,
) -> bytes:
    """
    Return export data as bytes for in-memory download (e.g. Streamlit).

    Args:
        records:         Window record list.
        fmt:             One of "csv", "json", "mat".
        include_signals: Include raw signal arrays in JSON.

    Returns:
        UTF-8 bytes (CSV/JSON) or binary bytes (MAT).
    """
    fmt = fmt.lower()
    if fmt == "csv":
        csv_str = export_csv(records, output_path=None)
        return (csv_str or "").encode("utf-8")

    if fmt == "json":
        json_str = export_json(records, output_path=None, include_signals=include_signals)
        return (json_str or "").encode("utf-8")

    if fmt == "mat":
        import tempfile, os
        with tempfile.NamedTemporaryFile(suffix=".mat", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            export_mat(records, tmp_path, include_signals=include_signals)
            with open(tmp_path, "rb") as fh:
                return fh.read()
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    raise ValueError(f"Unknown export format: {fmt!r}. Use 'csv', 'json', or 'mat'.")

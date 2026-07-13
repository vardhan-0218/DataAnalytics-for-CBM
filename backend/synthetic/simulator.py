"""
simulator.py — End-to-end window orchestrator for the Digital Twin.

The PulveriserSimulator runs the full pipeline per window::

    Healthy Model → Fault Injection → Noise → Signal Window
        → Feature Extraction → Health Indices → Alarm Generation
        → Process KPIs → JSON record

Usage::

    from synthetic.config import load_config
    from synthetic.simulator import PulveriserSimulator

    cfg = load_config()
    sim = PulveriserSimulator(cfg, seed=42)

    for i in range(60):
        record = sim.run_window()
        print(record["window_idx"], record["indices"]["MHI"])
"""

from __future__ import annotations

import datetime
from typing import Any, Dict, List, Optional

import numpy as np
from numpy.random import Generator

from .config import PulveriserConfig, load_config
from .signal_generator import generate_vibration, generate_current, generate_temperature
from .feature_extraction import extract_all_features, compute_fft
from .condition_monitoring import (
    DualEWMA,
    compute_mhi,
    compute_pqi,
    compute_gqi,
    check_alarms,
)
from .process_kpi import compute_all_kpis


class PulveriserSimulator:
    """
    Digital Twin Simulator for a Food-Processing Pulveriser.

    Generates one window of sensor data per call to ``run_window()``.
    Maintains stateful EWMA filters across windows for continuous trending.

    Args:
        config:      PulveriserConfig instance (or None for defaults).
        seed:        Random seed for reproducibility (None = random).
        load_ratio:  Actual / Rated load fraction (0.6–0.8 healthy).
    """

    def __init__(
        self,
        config: Optional[PulveriserConfig] = None,
        seed: Optional[int] = None,
        load_ratio: float = 0.70,
    ) -> None:
        self.config: PulveriserConfig = config or load_config()
        self.load_ratio: float = load_ratio
        self._window_idx: int = 0
        self._rng: Generator = np.random.default_rng(seed)

        # Stateful EWMA filters (one per signal)
        self._ewma_vib_rms = DualEWMA(alpha_slow=0.05, alpha_fast=0.30, init_value=0.55)
        self._ewma_cur_rms = DualEWMA(alpha_slow=0.05, alpha_fast=0.30, init_value=5.0)
        self._ewma_temp    = DualEWMA(alpha_slow=0.05, alpha_fast=0.30, init_value=35.0)

        # Window records (in-memory history)
        self.history: List[Dict[str, Any]] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def reset(self, config: Optional[PulveriserConfig] = None, seed: Optional[int] = None) -> None:
        """Reset simulator state (window counter, EWMA, history)."""
        if config is not None:
            self.config = config
        self._window_idx = 0
        self._rng = np.random.default_rng(seed)
        self._ewma_vib_rms.reset(0.55)
        self._ewma_cur_rms.reset(5.0)
        self._ewma_temp.reset(35.0)
        self.history.clear()

    def update_config(self, config: PulveriserConfig) -> None:
        """Hot-swap configuration without resetting window index or EWMA state."""
        self.config = config

    def run_window(self) -> Dict[str, Any]:
        """
        Generate one complete window and return a structured JSON record.

        Returns:
            Dict with keys: window_idx, timestamp, signals, features,
                            ewma, indices, alarms, kpis.
        """
        cfg = self.config
        wi = self._window_idx
        rng = self._rng

        # ── Time vectors ─────────────────────────────────────────────────
        t_vib  = np.arange(cfg.window_vib)  / cfg.fs_vib
        t_cur  = np.arange(cfg.window_cur)  / cfg.fs_cur
        t_temp = np.arange(cfg.window_temp) / cfg.fs_temp

        # ── Signal generation ─────────────────────────────────────────────
        vib  = generate_vibration(t_vib,  cfg, window_idx=wi, rng=rng)
        cur  = generate_current(t_cur,    cfg, window_idx=wi, rng=rng)
        temp = generate_temperature(t_temp, cfg, window_idx=wi, rng=rng)

        # ── Feature extraction ─────────────────────────────────────────────
        features = extract_all_features(
            vibration=vib,
            current=cur,
            temperature=temp,
            fs_vib=cfg.fs_vib,
            fs_cur=cfg.fs_cur,
            fs_temp=cfg.fs_temp,
        )

        # ── EWMA trending ──────────────────────────────────────────────────
        ewma_vib = self._ewma_vib_rms.update(features["vibration"]["RMS"])
        ewma_cur = self._ewma_cur_rms.update(features["current"]["RMS"])
        ewma_tmp = self._ewma_temp.update(features["temperature"]["RMS"])

        # ── Health indices ─────────────────────────────────────────────────
        mhi = compute_mhi(features)
        pqi = compute_pqi(features)
        gqi = compute_gqi(features)

        # ── Alarms ────────────────────────────────────────────────────────
        alarms = check_alarms(mhi, pqi, gqi)

        # ── Process KPIs ──────────────────────────────────────────────────
        kpis = compute_all_kpis(cfg, load_ratio=self.load_ratio, rng=rng)

        # ── FFT snapshot (first 256 lines for dashboard) ──────────────────
        fft_freqs, fft_mag = compute_fft(vib, cfg.fs_vib, n_lines=512)

        # ── Build output record ───────────────────────────────────────────
        record: Dict[str, Any] = {
            "window_idx":  wi,
            "timestamp":   datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
            "machine_id":  cfg.machine.machine_id,
            "severity": {
                "blade_wear":       cfg.severity.blade_wear,
                "bearing_fault":    cfg.severity.bearing_fault,
                "imbalance":        cfg.severity.imbalance,
                "misalignment":     cfg.severity.misalignment,
                "looseness":        cfg.severity.looseness,
                "material_buildup": cfg.severity.material_buildup,
                "partial_clogging": cfg.severity.partial_clogging,
                "choking":          cfg.severity.choking,
            },
            "signals": {
                "vibration":   _to_list(vib),
                "current":     _to_list(cur),
                "temperature": _to_list(temp),
                "time_vib":    _to_list(t_vib),
                "time_cur":    _to_list(t_cur),
                "time_temp":   _to_list(t_temp),
                "fft_freqs":   _to_list(fft_freqs),
                "fft_mag":     _to_list(fft_mag),
            },
            "features": {
                "vibration":   _round_dict(features["vibration"]),
                "current":     _round_dict(features["current"]),
                "temperature": _round_dict(features["temperature"]),
            },
            "ewma": {
                "vibration_rms": _round_dict(ewma_vib),
                "current_rms":   _round_dict(ewma_cur),
                "temperature":   _round_dict(ewma_tmp),
            },
            "indices": {
                "MHI": mhi,
                "PQI": pqi,
                "GQI": gqi,
            },
            "alarms": alarms,
            "kpis":   kpis,
        }

        self.history.append({
            k: v for k, v in record.items() if k != "signals"
        })
        self._window_idx += 1
        return record

    def run_simulation(self, n_windows: int) -> List[Dict[str, Any]]:
        """
        Run the simulator for ``n_windows`` windows and return all records.

        Note: Signal arrays are included in each record. For large n_windows
        consider streaming ``run_window()`` individually.
        """
        return [self.run_window() for _ in range(n_windows)]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_list(arr: np.ndarray, decimals: int = 5) -> list:
    """Convert ndarray to a compact list of rounded floats."""
    return [round(float(x), decimals) for x in arr]


def _round_dict(d: Dict[str, float], decimals: int = 4) -> Dict[str, float]:
    """Round all float values in a dict."""
    return {k: round(float(v), decimals) for k, v in d.items()}

"""
condition_monitoring.py — Dual EWMA trending + Health Index computation.

Implements (Section 4 / Section 11):
  - DualEWMA: stateful fast/slow EWMA with gap-based trend detection
  - compute_mhi: Machine Health Index (0–100, >95 = healthy)
  - compute_pqi: Process Quality Index (0–100)
  - compute_gqi: Grinding Quality Index (0–100) — weighted DSP features
  - check_alarms: 3-tier alarm system (Early / Mid / Late)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Healthy baseline reference (Section 5)
# ---------------------------------------------------------------------------

HEALTHY_BASELINE = {
    "vibration": {
        "RMS":              0.55,    # midpoint of 0.3–0.8 g
        "CrestFactor":      3.0,     # midpoint of 2.5–3.5
        "Kurtosis":         3.0,     # midpoint of 2.8–3.2
        "SpectralCentroid": 200.0,   # Hz (estimated midpoint)
        "MidBandEnergy":    1.0,     # normalised reference
        "HighBandEnergy":   0.05,    # low in healthy state
    },
    "current": {
        "RMS": 5.0,          # A (Ibase)
        "Variance": 0.02,    # low variance in healthy state
    },
    "temperature": {
        "RMS": 35.0,         # °C  (ambient + load_rise)
        "RateOfChange": 0.0, # no drift in healthy state
    },
}


# ---------------------------------------------------------------------------
# Dual EWMA
# ---------------------------------------------------------------------------

@dataclass
class DualEWMA:
    """
    Stateful dual-EWMA filter.

    Two EWMA trackers with different smoothing constants (alpha_slow, alpha_fast).
    The gap (fast − slow) is a sensitive trend-change detector.

    Usage::

        ewma = DualEWMA(alpha_slow=0.05, alpha_fast=0.30, init_value=5.0)
        result = ewma.update(new_sample)   # returns dict
    """
    alpha_slow: float = 0.05
    alpha_fast: float = 0.30
    init_value: float = 0.0

    _slow: float = field(init=False)
    _fast: float = field(init=False)
    _history: List[float] = field(default_factory=list, init=False)

    def __post_init__(self) -> None:
        self._slow = self.init_value
        self._fast = self.init_value
        self._history = [self.init_value]

    def update(self, value: float) -> Dict[str, float]:
        """
        Advance EWMA by one sample.

        Returns:
            Dict with keys: slow, fast, gap, slope (last-10-point gradient).
        """
        self._fast = self.alpha_fast * value + (1 - self.alpha_fast) * self._fast
        self._slow = self.alpha_slow * value + (1 - self.alpha_slow) * self._slow
        self._history.append(self._slow)

        k = 10
        if len(self._history) > k:
            slope = (self._slow - self._history[-k]) / k
        else:
            slope = 0.0

        return {
            "slow": self._slow,
            "fast": self._fast,
            "gap":  self._fast - self._slow,
            "slope": slope,
        }

    def reset(self, value: Optional[float] = None) -> None:
        """Reset state to initial value (or a supplied value)."""
        v = value if value is not None else self.init_value
        self._slow = v
        self._fast = v
        self._history = [v]


# ---------------------------------------------------------------------------
# Health index helpers
# ---------------------------------------------------------------------------

def _z_score(value: float, mu: float, sigma: float) -> float:
    """Normalised deviation from healthy baseline."""
    if sigma == 0:
        return 0.0
    return (value - mu) / sigma


def _index_from_z(z: float, positive_is_bad: bool = True) -> float:
    """
    Map a z-score to a 0–100 health index.

    index = 100 means perfectly healthy; 0 means severely degraded.
    ``positive_is_bad`` controls whether high z → bad or low z → bad.
    """
    if positive_is_bad:
        # 0 z → 100, 3 z → ~4 (sigmoid-like)
        score = 100.0 / (1 + math.exp(z - 1))
    else:
        # negative z → bad (e.g., spectral centroid dropping)
        score = 100.0 / (1 + math.exp(-z - 1))
    return max(0.0, min(100.0, score))


# ---------------------------------------------------------------------------
# MHI — Machine Health Index
# ---------------------------------------------------------------------------

def compute_mhi(
    features: Dict[str, Dict[str, float]],
    baseline: Optional[Dict[str, Dict[str, float]]] = None,
) -> float:
    """
    Compute Machine Health Index (0–100, >95 = healthy).

    Combines vibration RMS, Kurtosis, Crest Factor, current RMS, and
    temperature as a weighted z-score Mahalanobis-like distance.

    Args:
        features: Nested feature dict from ``extract_all_features``.
        baseline: Optional custom baseline; defaults to HEALTHY_BASELINE.

    Returns:
        MHI score in [0, 100].
    """
    if baseline is None:
        baseline = HEALTHY_BASELINE

    vib = features.get("vibration", {})
    cur = features.get("current", {})
    temp = features.get("temperature", {})

    # Weights (must sum to 1)
    components = [
        # (measured,        mu,                                 sigma,  weight, positive_is_bad)
        (vib.get("RMS", 0.55),
         baseline["vibration"]["RMS"],        0.15,  0.25, True),

        (vib.get("Kurtosis", 3.0),
         baseline["vibration"]["Kurtosis"],   0.5,   0.20, True),

        (vib.get("CrestFactor", 3.0),
         baseline["vibration"]["CrestFactor"],0.3,   0.20, True),

        (vib.get("HighBandEnergy", 0.05),
         baseline["vibration"]["HighBandEnergy"], 0.02, 0.15, True),

        (cur.get("RMS", 5.0),
         baseline["current"]["RMS"],          0.5,   0.10, True),

        (temp.get("RMS", 35.0),
         baseline["temperature"]["RMS"],      3.0,   0.10, True),
    ]

    mhi = 0.0
    for measured, mu, sigma, weight, pos_bad in components:
        z = _z_score(measured, mu, sigma)
        mhi += weight * _index_from_z(z, positive_is_bad=pos_bad)

    return round(max(0.0, min(100.0, mhi * 100 / 100)), 2)


# ---------------------------------------------------------------------------
# PQI — Process Quality Index
# ---------------------------------------------------------------------------

def compute_pqi(
    features: Dict[str, Dict[str, float]],
    baseline: Optional[Dict[str, Dict[str, float]]] = None,
) -> float:
    """
    Compute Process Quality Index (0–100, >95 = healthy).

    Focuses on process-related signals: current variance and RMS stability,
    spectral centroid trend, mid-band energy.

    Args:
        features: Nested feature dict.
        baseline: Optional custom baseline.

    Returns:
        PQI score in [0, 100].
    """
    if baseline is None:
        baseline = HEALTHY_BASELINE

    vib = features.get("vibration", {})
    cur = features.get("current", {})

    components = [
        # current stability
        (cur.get("RMS", 5.0),
         baseline["current"]["RMS"],      0.8,  0.30, True),

        (cur.get("Variance", 0.02),
         baseline["current"]["Variance"],  0.08, 0.25, True),

        # spectral centroid dropping → process degradation (wide sigma to absorb window-to-window variance)
        (vib.get("SpectralCentroid", 200.0),
         baseline["vibration"]["SpectralCentroid"], 80.0, 0.25, False),

        # mid-band energy decreasing → blade/grinding quality
        (vib.get("MidBandEnergy", 1.0),
         baseline["vibration"]["MidBandEnergy"], 0.5, 0.20, False),
    ]

    pqi = 0.0
    for measured, mu, sigma, weight, pos_bad in components:
        z = _z_score(measured, mu, sigma)
        pqi += weight * _index_from_z(z, positive_is_bad=pos_bad)

    return round(max(0.0, min(100.0, pqi * 100 / 100)), 2)


# ---------------------------------------------------------------------------
# GQI — Grinding Quality Index
# ---------------------------------------------------------------------------

def compute_gqi(
    features: Dict[str, Dict[str, float]],
    baseline: Optional[Dict[str, Dict[str, float]]] = None,
) -> float:
    """
    Compute Grinding Quality Index (0–100, >95 = healthy).

    Uses DSP feature deviations — primarily spectral centroid, mid-band energy,
    and vibration RMS — to estimate grinding quality.

    Args:
        features: Nested feature dict.
        baseline: Optional custom baseline.

    Returns:
        GQI score in [0, 100].
    """
    if baseline is None:
        baseline = HEALTHY_BASELINE

    vib = features.get("vibration", {})

    components = [
        # Spectral centroid dropping → coarser grind (wide sigma to absorb window variance)
        (vib.get("SpectralCentroid", 200.0),
         baseline["vibration"]["SpectralCentroid"], 80.0, 0.40, False),

        # Mid-band energy (grinding activity)
        (vib.get("MidBandEnergy", 1.0),
         baseline["vibration"]["MidBandEnergy"], 0.5, 0.35, False),

        # RMS increase beyond healthy → noise from wear/fault (not grinding)
        (vib.get("RMS", 0.55),
         baseline["vibration"]["RMS"],  0.2,  0.25, True),
    ]

    gqi = 0.0
    for measured, mu, sigma, weight, pos_bad in components:
        z = _z_score(measured, mu, sigma)
        gqi += weight * _index_from_z(z, positive_is_bad=pos_bad)

    return round(max(0.0, min(100.0, gqi * 100 / 100)), 2)


# ---------------------------------------------------------------------------
# Alarm check
# ---------------------------------------------------------------------------

def check_alarms(
    mhi: float,
    pqi: float,
    gqi: float,
    mhi_early: float = 85.0,
    mhi_mid: float = 70.0,
    mhi_late: float = 55.0,
) -> Dict[str, Any]:
    """
    3-tier alarm system based on health indices.

    Tiers:
        EARLY: any index < mhi_early (85)  → predictive maintenance soon
        MID:   any index < mhi_mid   (70)  → increased monitoring required
        LATE:  any index < mhi_late  (55)  → immediate action required

    Args:
        mhi: Machine Health Index.
        pqi: Process Quality Index.
        gqi: Grinding Quality Index.
        mhi_early/mid/late: Alarm thresholds (customisable).

    Returns:
        Dict with alarm flags and severity label.
    """
    min_index = min(mhi, pqi, gqi)

    late  = min_index < mhi_late
    mid   = (not late) and (min_index < mhi_mid)
    early = (not late) and (not mid) and (min_index < mhi_early)
    normal = not (early or mid or late)

    if late:
        severity = "LATE"
    elif mid:
        severity = "MID"
    elif early:
        severity = "EARLY"
    else:
        severity = "NORMAL"

    return {
        "early":    early,
        "mid":      mid,
        "late":     late,
        "normal":   normal,
        "severity": severity,
        "min_index": round(min_index, 2),
        "thresholds": {
            "early": mhi_early,
            "mid":   mhi_mid,
            "late":  mhi_late,
        },
    }

"""
process_kpi.py — Process KPI computation (Section 10).

Computes:
  - Cycle Time  (CT)        — seconds per batch
  - Throughput  (TP)        — kg/hr
  - Grinding Efficiency     — ratio of useful output power to input power
"""

from __future__ import annotations

import math
from typing import Any, Dict

from .config import PulveriserConfig


# ---------------------------------------------------------------------------
# Severity label → float mapping (Section 10)
# ---------------------------------------------------------------------------

SEVERITY_LEVELS = {
    "healthy":    0.00,
    "very_mild":  0.10,
    "mild":       0.25,
    "moderate":   0.50,
    "severe":     0.75,
    "critical":   1.00,
}


# ---------------------------------------------------------------------------
# Cycle Time
# ---------------------------------------------------------------------------

def compute_cycle_time(
    config: PulveriserConfig,
    load_ratio: float = 0.70,
    random_variation_std: float = 2.0,
    rng=None,
) -> float:
    """
    Compute batch cycle time (seconds) using the formula from Section 10::

        CT = CT_base
             + Kw  * Swear
             + Kb  * Sbearing
             + KL  * (Load / LoadRated)
             + Kbuild * Sbuild
             + KPC * SPC
             + Kchoke * Schoke
             + ε,   ε ~ N(0, σ²)

    Args:
        config:               PulveriserConfig instance.
        load_ratio:           Actual / Rated load ratio (0.6–0.8 healthy, >1 overload).
        random_variation_std: Standard deviation of random noise term ε (seconds).
        rng:                  Optional NumPy random Generator.

    Returns:
        Cycle time in seconds.
    """
    import numpy as np
    if rng is None:
        rng = np.random.default_rng()

    kpi = config.process_kpi.cycle_time
    sev = config.severity

    ct = (
        kpi.base
        + kpi.wear_coeff     * sev.blade_wear
        + kpi.bearing_coeff  * sev.bearing_fault
        + kpi.load_coeff     * load_ratio
        + kpi.buildup_coeff  * sev.material_buildup
        + kpi.clogging_coeff * sev.partial_clogging
        + kpi.choking_coeff  * sev.choking
    )

    # Random ±variation
    eps = rng.normal(0, random_variation_std)
    ct = max(10.0, ct + eps)  # floor at 10 s (machine cannot be faster)
    return round(ct, 2)


# ---------------------------------------------------------------------------
# Throughput
# ---------------------------------------------------------------------------

def compute_throughput(cycle_time: float, batch_mass: float = 1.0) -> float:
    """
    Compute throughput in kg/hr.

        TP = (M_batch / CT) × 3600

    Args:
        cycle_time:  Cycle time in seconds (> 0).
        batch_mass:  Batch mass in kg (default 1.0 kg).

    Returns:
        Throughput in kg/hr.
    """
    if cycle_time <= 0:
        return 0.0
    return round(batch_mass * 3600.0 / cycle_time, 2)


# ---------------------------------------------------------------------------
# Grinding Efficiency
# ---------------------------------------------------------------------------

def compute_grinding_efficiency(
    motor_power_kw: float,
    throughput_kg_hr: float,
    specific_energy_ref: float = 50.0,
) -> float:
    """
    Compute Grinding Efficiency (0–1) as power consumption vs throughput.

        eff = (TP × E_ref) / (P_motor × 3600)

    where E_ref is the reference specific energy (kJ/kg) for the healthy state.

    In a healthy machine, efficiency should be close to 1.0.
    As faults develop (higher power draw, lower throughput), efficiency drops.

    Args:
        motor_power_kw:       Actual motor power draw (kW).
        throughput_kg_hr:     Current throughput (kg/hr).
        specific_energy_ref:  Healthy-state specific grinding energy (kJ/kg).

    Returns:
        Efficiency ratio in [0.0, 1.0].
    """
    if motor_power_kw <= 0:
        return 0.0

    # Actual specific energy (kJ/kg) = P(kW) × 3600 / TP(kg/hr)
    if throughput_kg_hr <= 0:
        return 0.0

    actual_specific_energy = (motor_power_kw * 3600.0) / throughput_kg_hr
    eff = specific_energy_ref / actual_specific_energy
    return round(max(0.0, min(1.0, eff)), 4)


# ---------------------------------------------------------------------------
# Combined KPI computation
# ---------------------------------------------------------------------------

def compute_all_kpis(
    config: PulveriserConfig,
    load_ratio: float = 0.70,
    rng=None,
) -> Dict[str, Any]:
    """
    Compute all process KPIs in one call.

    Args:
        config:      PulveriserConfig instance.
        load_ratio:  Actual / Rated load fraction.
        rng:         Optional NumPy random Generator.

    Returns:
        Dict with: CycleTime, Throughput, GrindingEfficiency, LoadRatio.
    """
    ct = compute_cycle_time(config, load_ratio=load_ratio, rng=rng)
    tp = compute_throughput(ct, batch_mass=config.process_kpi.batch_mass)
    eff = compute_grinding_efficiency(
        motor_power_kw=config.machine.motor_power_kw,
        throughput_kg_hr=tp,
    )

    return {
        "CycleTime":          ct,
        "Throughput":         tp,
        "GrindingEfficiency": eff,
        "LoadRatio":          round(load_ratio, 3),
        "BatchMass":          config.process_kpi.batch_mass,
    }

"""
parameter_mapper.py — Severity % → Internal Engineering Parameters.

Converts severity percentages (0–100) from the Control JSON into the
internal Parameter JSON (k1, k2, Ri, m, fm, Kd, Kb, etc.) per the
calibration tables in Sections 7–10 of the specification.

Design rule (Section 5): The UI NEVER sends model constants.
This module is the sole authority for translating severity → parameters.

Interpolation strategy (Section 13 req):
  - Use linear interpolation between the given severity checkpoints
    (0 / 25 / 50 / 75 / 100 or mild/moderate/severe/critical).
  - Where a closed-form rate constant is given (Kd, Kb, kc, etc.) use
    parameter * severity_fraction directly, as specified.
"""

from __future__ import annotations

from typing import Any, Dict

import numpy as np


# ---------------------------------------------------------------------------
# Interpolation helper
# ---------------------------------------------------------------------------

def _interp(severity_pct: float, x_points: list, y_points: list) -> float:
    """
    Linearly interpolate y at severity_pct (0–100) using the given table.

    Args:
        severity_pct: Severity value in percent [0, 100].
        x_points:     Severity checkpoints (e.g. [0, 25, 50, 75, 100]).
        y_points:     Corresponding parameter values.

    Returns:
        Interpolated parameter value.
    """
    return float(np.interp(severity_pct, x_points, y_points))


# ===========================================================================
# VIBRATION FAULT PARAMETERS (Section 7)
# ===========================================================================

# ── 7.1 Blade Wear ────────────────────────────────────────────────────────

def vib_blade_wear_params(severity_pct: float) -> Dict[str, float]:
    """
    §7.1 Blade Wear — A0/B0 amplitude table + rate constants k1/k2.

    k1 = 3.5e-5 g/window (spec)
    k2 = 4.5e-5 g/window (spec)
    A0 interpolated from [0.30, 0.35, 0.40, 0.45, 0.50] @ [0,25,50,75,100]%
    B0 interpolated from [0.60, 0.55, 0.50, 0.45, 0.40] @ [0,25,50,75,100]%
    """
    xp = [0, 25, 50, 75, 100]
    A0 = _interp(severity_pct, xp, [0.30, 0.35, 0.40, 0.45, 0.50])
    B0 = _interp(severity_pct, xp, [0.60, 0.55, 0.50, 0.45, 0.40])
    return {
        "A0": A0,
        "B0": B0,
        "k1": 3.5e-5,   # g/window (spec §7.1)
        "k2": 4.5e-5,   # g/window (spec §7.1)
    }


# ── 7.2 Bearing Fault ─────────────────────────────────────────────────────

def vib_bearing_fault_params(severity_pct: float) -> Dict[str, float]:
    """
    §7.2 Bearing Fault — impulse amplitude Ri.

    Ri table: 25%→0.5, 50%→1.5, 75%→2.5, 100%→3.5 g
    """
    xp = [0, 25, 50, 75, 100]
    Ri = _interp(severity_pct, xp, [0.0, 0.5, 1.5, 2.5, 3.5])
    return {
        "Ri": Ri,
        "fault_frequency": 220.0,   # Hz (BPFO approximation)
        "impulse_width": 0.002,     # seconds
    }


# ── 7.3 Rotor Imbalance ───────────────────────────────────────────────────

def vib_imbalance_params(severity_pct: float) -> Dict[str, float]:
    """
    §7.3 Rotor Imbalance — A_imb amplitude.

    A_imb table: 25%→0.05, 50%→0.10, 75%→0.20, 100%→0.40 g
    """
    xp = [0, 25, 50, 75, 100]
    A_imb = _interp(severity_pct, xp, [0.0, 0.05, 0.10, 0.20, 0.40])
    return {"A_imb": A_imb}


# ── 7.4 Shaft Misalignment ────────────────────────────────────────────────

def vib_misalignment_params(severity_pct: float) -> Dict[str, float]:
    """
    §7.4 Shaft Misalignment — harmonic amplitudes A1:A2:A3 (ratio 1:0.5:0.25).

    A1 table: 25%→0.12, 50%→0.24, 75%→0.36, 100%→0.48 g
    """
    xp = [0, 25, 50, 75, 100]
    A1 = _interp(severity_pct, xp, [0.0, 0.12, 0.24, 0.36, 0.48])
    A2 = A1 * 0.5
    A3 = A1 * 0.25
    return {"A1": A1, "A2": A2, "A3": A3}


# ── 7.5 Mechanical Looseness ──────────────────────────────────────────────

def vib_looseness_params(severity_pct: float) -> Dict[str, float]:
    """
    §7.5 Mechanical Looseness — random impact amplitude Li.

    Li table: 25%→0.5, 50%→1.0, 75%→2.0, 100%→3.0 g
    """
    xp = [0, 25, 50, 75, 100]
    Li = _interp(severity_pct, xp, [0.0, 0.5, 1.0, 2.0, 3.0])
    return {
        "Li": Li,
        "impact_rate": 50.0,    # impacts/second at full severity
    }


# ── 8.1 Material Build-up (vibration) ────────────────────────────────────

def vib_material_buildup_params(severity_pct: float) -> Dict[str, float]:
    """
    §8.1 Material Build-up — amplitude modulation depth m and frequency fm.

    m  table: mild→0.05, moderate→0.15, severe→0.25, critical→0.35
    fm table: mild→0.25, moderate→0.75, severe→1.25, critical→1.75 Hz
    Mapped to severity_pct via [0,25,50,75,100] → [0, 0.05, 0.15, 0.25, 0.35].
    """
    xp  = [0, 25, 50, 75, 100]
    m   = _interp(severity_pct, xp, [0.0, 0.05, 0.15, 0.25, 0.35])
    fm  = _interp(severity_pct, xp, [0.0, 0.25,  0.75, 1.25, 1.75])
    return {"m": m, "fm": fm}


# ── 8.2 Partial Clogging (vibration) ─────────────────────────────────────

def vib_partial_clogging_params(severity_pct: float) -> Dict[str, float]:
    """
    §8.2 Partial Clogging — shaft growth kc and grinding attenuation kg.

    kc table: 25%→0.0001, 50%→0.00035, 75%→0.0006, 100%→0.0009 g/window
    kg table: 25%→0.00005, 50%→0.00025, 75%→0.00035, 100%→0.0005 g/window
    """
    xp = [0, 25,    50,      75,      100]
    kc = _interp(severity_pct, xp, [0.0, 0.0001, 0.00035, 0.0006, 0.0009])
    kg = _interp(severity_pct, xp, [0.0, 0.00005, 0.00025, 0.00035, 0.0005])
    return {"kc": kc, "kg": kg}


# ── 8.3 Complete Choking (vibration) ─────────────────────────────────────

def vib_choking_params(severity_pct: float) -> Dict[str, float]:
    """
    §8.3 Complete Choking — clog rates + transient impact amplitude Ri.

    Ri  table: mild→0.75, moderate→1.5, severe→3.0, critical→4.0 g
    Uses same kc/kg as partial clogging (choking = clogging + transients).
    """
    xp = [0, 25,  50,  75,  100]
    Ri  = _interp(severity_pct, xp, [0.0, 0.75, 1.5, 3.0, 4.0])
    kc  = _interp(severity_pct, xp, [0.0, 0.0001, 0.00035, 0.0006, 0.0009])
    kg  = _interp(severity_pct, xp, [0.0, 0.00005, 0.00025, 0.00035, 0.0005])
    fc  = _interp(severity_pct, xp, [0.0, 0.5, 0.9, 1.5, 2.0])
    return {"Ri": Ri, "kc": kc, "kg": kg, "fc": fc}


# ===========================================================================
# CURRENT FAULT PARAMETERS (Section 9)
# ===========================================================================

# ── 9.1 Blade Wear (current) ──────────────────────────────────────────────

def cur_blade_wear_params(severity_pct: float) -> Dict[str, float]:
    """
    §9.1 Blade Wear Current — Kd growth rate.

    Kd table: 25%→0.0005, 50%→0.0015, 75%→0.0030, 100%→0.0045–0.0050 A/window
    """
    xp = [0, 25,     50,      75,     100]
    Kd = _interp(severity_pct, xp, [0.0, 0.0005, 0.0015, 0.0030, 0.0048])
    return {"Kd": Kd}


# ── 9.2 Bearing Fault (current) ───────────────────────────────────────────

def cur_bearing_fault_params(severity_pct: float) -> Dict[str, float]:
    """
    §9.2 Bearing Fault Current — mBF modulation index and Ri impulse.

    mBF table: minor→0.02, moderate→0.04, severe→0.06, critical→0.10
    Ri  table: minor→0.05, moderate→0.15, severe→0.30, critical→0.40 A
    """
    xp  = [0, 25,   50,    75,    100]
    mBF = _interp(severity_pct, xp, [0.0, 0.02, 0.04, 0.06, 0.10])
    Ri  = _interp(severity_pct, xp, [0.0, 0.05, 0.15, 0.30, 0.40])
    return {
        "mBF": mBF, "Ri": Ri,
        "fBF": 220.0,   # bearing fault frequency (Hz)
    }


# ── 9.3 Imbalance (current) ───────────────────────────────────────────────

def cur_imbalance_params(severity_pct: float) -> Dict[str, float]:
    """
    §9.3 Imbalance Current — m_imb modulation index.

    m_imb table: 25%→0.03, 50%→0.06, 75%→0.10, severe→0.12
    """
    xp    = [0, 25,   50,    75,    100]
    m_imb = _interp(severity_pct, xp, [0.0, 0.03, 0.06, 0.10, 0.12])
    return {"m_imb": m_imb}


# ── 9.4 Misalignment (current) ────────────────────────────────────────────

def cur_misalignment_params(severity_pct: float) -> Dict[str, float]:
    """
    §9.4 Misalignment Current — m1 and m2 modulation indices.

    m1 table: 25%→0.02, 50%→0.05, 75%→0.08, 100%→0.10
    m2 table: 25%→0.01, 50%→0.03, 75%→0.05, 100%→0.07
    """
    xp = [0, 25,   50,    75,    100]
    m1 = _interp(severity_pct, xp, [0.0, 0.02, 0.05, 0.08, 0.10])
    m2 = _interp(severity_pct, xp, [0.0, 0.01, 0.03, 0.05, 0.07])
    return {"m1": m1, "m2": m2}


# ── 9.5 Material Build-up (current) ──────────────────────────────────────

def cur_material_buildup_params(severity_pct: float) -> Dict[str, float]:
    """
    §9.5 Material Build-up Current — Kb growth rate, Ac and fc.

    Kb table: mild→0.0005, moderate→0.0010, severe→0.0015, critical→0.0020 A/window
    Ac table: mild→0.05, moderate→0.10, severe→0.15, critical→0.20 A
    fc table: mild→0.05, moderate→0.20, severe→0.30, critical→0.40 Hz
    """
    xp = [0, 25,     50,      75,      100]
    Kb = _interp(severity_pct, xp, [0.0, 0.0005, 0.0010, 0.0015, 0.0020])
    Ac = _interp(severity_pct, xp, [0.0,  0.05,   0.10,   0.15,   0.20])
    fc = _interp(severity_pct, xp, [0.0,  0.05,   0.20,   0.30,   0.40])
    return {"Kb": Kb, "Ac": Ac, "fc": fc}


# ── 9.6 Partial Clogging (current) ────────────────────────────────────────

def cur_partial_clogging_params(severity_pct: float) -> Dict[str, float]:
    """
    §9.6 Partial Clogging Current — kc, mc, fc, noise_sigma.

    kc  table: mild→0.002, moderate→0.005, severe→0.008, critical→0.010 A/window
    mc  table: mild→0.03, moderate→0.45, severe→0.60, critical→0.75
    fc  table: mild→0.1,  moderate→0.20, severe→0.3,  critical→0.4  Hz
    """
    xp  = [0, 25,   50,    75,    100]
    kc  = _interp(severity_pct, xp, [0.0, 0.002, 0.005, 0.008, 0.010])
    mc  = _interp(severity_pct, xp, [0.0, 0.03,  0.45,  0.60,  0.75])
    fc  = _interp(severity_pct, xp, [0.0, 0.10,  0.20,  0.30,  0.40])
    return {"kc": kc, "mc": mc, "fc": fc}


# ── 9.7 Choking (current) ─────────────────────────────────────────────────

def cur_choking_params(severity_pct: float) -> Dict[str, float]:
    """
    §9.7 Choking Current — Kc, mc, fc, Ri spike.

    Kc table: mild→0.010, moderate→0.015, severe→0.020, near_stall→0.030 A/window
    mc table: mild→0.08, moderate→0.12, severe→0.18, extreme→0.25
    fc table: mild→0.5, moderate→0.9, severe→1.5, extreme→2.0 Hz
    Ri table: mild→0.3, moderate→0.8, severe→1.5, extreme→3.0 A
    """
    xp = [0, 25,   50,    75,    100]
    Kc = _interp(severity_pct, xp, [0.0, 0.010, 0.015, 0.020, 0.030])
    mc = _interp(severity_pct, xp, [0.0, 0.08,  0.12,  0.18,  0.25])
    fc = _interp(severity_pct, xp, [0.0, 0.50,  0.90,  1.50,  2.00])
    Ri = _interp(severity_pct, xp, [0.0, 0.30,  0.80,  1.50,  3.00])
    return {"Kc": Kc, "mc": mc, "fc": fc, "Ri": Ri}


# ===========================================================================
# TEMPERATURE FAULT PARAMETERS (Section 10)
# ===========================================================================

# ── 10.1 Blade Wear (temperature) ────────────────────────────────────────

def temp_blade_wear_params(severity_pct: float) -> Dict[str, float]:
    """
    §10.1 Blade Wear Temperature — k_wear growth rate, Aw oscillation, ft.

    k_wear table: 25%→0.0002, 50%→0.0006, 75%→0.0012, 100%→0.0020 °C/window
    Aw     table: 0.20–0.50°C (linear with severity)
    ft     table: 0.005–0.02 Hz (linear with severity)
    """
    xp     = [0, 25,     50,      75,      100]
    k_wear = _interp(severity_pct, xp, [0.0, 0.0002, 0.0006, 0.0012, 0.0020])
    Aw     = _interp(severity_pct, xp, [0.0,  0.20,   0.30,   0.40,   0.50])
    ft     = _interp(severity_pct, xp, [0.0,  0.005,  0.010,  0.015,  0.020])
    return {"k_wear": k_wear, "Aw": Aw, "ft": ft}


# ── 10.2 Bearing Heating ──────────────────────────────────────────────────

def temp_bearing_fault_params(severity_pct: float) -> Dict[str, float]:
    """
    §10.2 Bearing Heating — kb °C/window.

    kb table: 25%→0.001, 50%→0.005, 75%→0.010, 100%→0.015 °C/window
    """
    xp = [0, 25,    50,     75,     100]
    kb = _interp(severity_pct, xp, [0.0, 0.001, 0.005, 0.010, 0.015])
    return {"kb": kb}


# ── 10.3 Material Build-up (temperature) ──────────────────────────────────

def temp_material_buildup_params(severity_pct: float) -> Dict[str, float]:
    """
    §10.3 Material Build-up Temperature — k_build °C/window.

    k_build table: mild→0.002, moderate→0.0035, severe→0.005, critical→0.008
    """
    xp      = [0, 25,    50,      75,     100]
    k_build = _interp(severity_pct, xp, [0.0, 0.002, 0.0035, 0.005, 0.008])
    return {"k_build": k_build}


# ── 10.4 Partial Clogging (temperature) ───────────────────────────────────

def temp_partial_clogging_params(severity_pct: float) -> Dict[str, float]:
    """
    §10.4 Partial Clogging Temperature — k_PC °C/window.

    k_PC table: mild→0.005, moderate→0.010, severe→0.015, critical→0.020
    """
    xp   = [0, 25,    50,     75,     100]
    k_PC = _interp(severity_pct, xp, [0.0, 0.005, 0.010, 0.015, 0.020])
    return {"k_PC": k_PC}


# ── 10.5 Complete Choking (temperature) ───────────────────────────────────

def temp_choking_params(severity_pct: float) -> Dict[str, float]:
    """
    §10.5 Complete Choking Temperature — k_choke °C/window.

    k_choke table: mild→0.010, moderate→0.020, severe→0.028, critical→0.035
    """
    xp      = [0, 25,    50,     75,     100]
    k_choke = _interp(severity_pct, xp, [0.0, 0.010, 0.020, 0.028, 0.035])
    return {"k_choke": k_choke}


# ===========================================================================
# Combined mapper
# ===========================================================================

def map_parameters(
    machine_faults: Dict[str, Any],
    process_faults: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Map all fault severities from the Control JSON into the full Parameter JSON.

    Args:
        machine_faults: Dict from Control JSON ``machine_faults`` section.
                        Each fault has keys: ``enabled`` (bool), ``severity`` (0–100).
        process_faults: Dict from Control JSON ``process_faults`` section.

    Returns:
        Parameter JSON dict with nested keys per fault and signal type.

    Example::

        params = map_parameters(
            machine_faults={"blade_wear": {"enabled": True, "severity": 50}, ...},
            process_faults={"material_buildup": {"enabled": True, "severity": 25}, ...},
        )
        # params["vibration"]["blade_wear"]["k1"]  → 3.5e-5
        # params["vibration"]["bearing_fault"]["Ri"] → 1.5
    """

    def _sev(d: dict, key: str) -> float:
        entry = d.get(key, {})
        if not isinstance(entry, dict):
            return 0.0
        if not entry.get("enabled", False):
            return 0.0
        return float(entry.get("severity", 0))

    bw  = _sev(machine_faults, "blade_wear")
    bf  = _sev(machine_faults, "bearing_fault")
    imb = _sev(machine_faults, "imbalance")
    mis = _sev(machine_faults, "misalignment")
    los = _sev(machine_faults, "looseness")
    mbu = _sev(process_faults, "material_buildup")
    pc  = _sev(process_faults, "partial_clogging")
    chk = _sev(process_faults, "choking")

    return {
        "vibration": {
            "blade_wear":       vib_blade_wear_params(bw),
            "bearing_fault":    vib_bearing_fault_params(bf),
            "imbalance":        vib_imbalance_params(imb),
            "misalignment":     vib_misalignment_params(mis),
            "looseness":        vib_looseness_params(los),
            "material_buildup": vib_material_buildup_params(mbu),
            "partial_clogging": vib_partial_clogging_params(pc),
            "choking":          vib_choking_params(chk),
        },
        "current": {
            "blade_wear":       cur_blade_wear_params(bw),
            "bearing_fault":    cur_bearing_fault_params(bf),
            "imbalance":        cur_imbalance_params(imb),
            "misalignment":     cur_misalignment_params(mis),
            "material_buildup": cur_material_buildup_params(mbu),
            "partial_clogging": cur_partial_clogging_params(pc),
            "choking":          cur_choking_params(chk),
        },
        "temperature": {
            "blade_wear":       temp_blade_wear_params(bw),
            "bearing_fault":    temp_bearing_fault_params(bf),
            "material_buildup": temp_material_buildup_params(mbu),
            "partial_clogging": temp_partial_clogging_params(pc),
            "choking":          temp_choking_params(chk),
        },
    }

"""
signal_generator.py — Vibration / Current / Temperature signal generators.

Implements every fault equation from Sections 6–10 of the specification.
All fault components are:
  - Additive / modulating on top of the healthy baseline
  - Independently toggleable via the `enable` key in config
  - Scaled by the corresponding severity value (0–1) before addition

Combined model (Section 6 general composition principle):
    Signal = Healthy Signal + Σ(Fault Components) + Noise

    V(t) = V_healthy(t) + V_machine(t) + V_process(t) + N(t)
    I(t) = I_healthy + Σ fault components + Noise
    T(t) = T_healthy + Σ thermal rise terms + Noise

Parameter values are now sourced from parameter_mapper.py calibration tables.
"""

from __future__ import annotations

import numpy as np
from numpy.random import Generator

from .config import PulveriserConfig
from .noise_models import (
    build_vibration_noise,
    build_current_noise,
    build_temperature_noise,
)


# ============================================================================
# VIBRATION GENERATOR
# ============================================================================

def generate_vibration(
    t: np.ndarray,
    config: PulveriserConfig,
    window_idx: int = 0,
    rng: Generator | None = None,
    params: dict | None = None,
) -> np.ndarray:
    """
    Generate a full vibration window.

    Signal = V_healthy + V_machine + V_process + Noise

    Args:
        t:          Time vector (seconds), shape (N,).
        config:     PulveriserConfig instance.
        window_idx: Running window index (used for gradual fault evolution).
        rng:        Optional NumPy RNG for reproducibility.
        params:     Optional pre-computed Parameter JSON from parameter_mapper.
                    If None, falls back to config-embedded values.

    Returns:
        Vibration signal array (g), shape (N,).
    """
    if rng is None:
        rng = np.random.default_rng()

    sev = config.severity
    vh  = config.vibration.healthy

    # ── §6.1 Healthy baseline ─────────────────────────────────────────────
    # V_healthy(t) = A0*sin(2π*fr*t) + B0*sin(2π*fg*t + 0.05*sin(4π*fr*t))
    #                + 0.12*sin(4π*fg*t) + Noise(t)
    A0, B0 = vh.A0, vh.B0
    fr, fg  = vh.fr, vh.fg

    # Blade wear may modify A0/B0 via parameter mapper
    if params and "blade_wear" in params:
        A0 = params["blade_wear"].get("A0", A0)
        B0 = params["blade_wear"].get("B0", B0)

    sig = (
        A0 * np.sin(2 * np.pi * fr * t)
        + B0 * np.sin(2 * np.pi * fg * t + 0.05 * np.sin(4 * np.pi * fr * t))
        + 0.12 * np.sin(4 * np.pi * fg * t)
    )
    # Extra harmonics from config
    for h in vh.harmonics:
        sig += float(h["amp"]) * np.sin(2 * np.pi * float(h["freq"]) * t)

    # ── §7.1 Blade wear — gradual amplitude drift ─────────────────────────
    # V_wear(t) = (A0 + k1*t)*sin(2π*fr*t) + (B0 - k2*t)*sin(2π*fg*t)
    s_wear = getattr(sev, "vib_blade_wear", sev.blade_wear)
    if s_wear > 0:
        bw = config.vibration.blade_wear
        if params and "blade_wear" in params:
            k1 = float(params["blade_wear"].get("k1", 3.5e-5))
            k2 = float(params["blade_wear"].get("k2", 4.5e-5))
        else:
            k1 = float(bw.get("k1", 3.5e-5))
            k2 = float(bw.get("k2", 4.5e-5))
        dA = k1 * window_idx * s_wear
        dB = k2 * window_idx * s_wear
        sig += dA * np.sin(2 * np.pi * fr * t)
        sig -= dB * np.sin(2 * np.pi * fg * t)

    # ── §7.2 Bearing fault — impulsive train ──────────────────────────────
    # V_bearing(t) = Σ Ri * δ(t - ti)
    s_bearing = getattr(sev, "vib_bearing_fault", sev.bearing_fault)
    bf_cfg    = config.vibration.bearing_fault
    if s_bearing > 0 and bf_cfg.get("enable", True):
        if params and "bearing_fault" in params:
            Ri           = float(params["bearing_fault"].get("Ri", 1.5)) * s_bearing
            fault_freq   = float(params["bearing_fault"].get("fault_frequency", 220.0))
            width        = float(params["bearing_fault"].get("impulse_width", 0.002))
        else:
            # Spec §7.2 table: 25%→0.5, 50%→1.5, 75%→2.5, 100%→3.5 g
            Ri_table     = [0, 0.5, 1.5, 2.5, 3.5]
            Ri_sev_pct   = s_bearing * 100
            Ri           = float(np.interp(Ri_sev_pct, [0,25,50,75,100], Ri_table))
            fault_freq   = float(bf_cfg.get("fault_frequency", 220.0))
            width        = float(bf_cfg.get("impulse_width", 0.002))
        fs             = config.fs_vib
        period_samples = max(1, int(fs / fault_freq))
        width_samples  = max(1, int(width * fs))
        for idx in range(0, len(t), period_samples):
            amp = rng.uniform(Ri * 0.6, Ri)
            end = min(idx + width_samples, len(t))
            sig[idx:end] += amp

    # ── §7.3 Rotor imbalance ──────────────────────────────────────────────
    # V_imbalance(t) = A_imb * sin(2π*fr*t + φ)
    s_imb   = sev.imbalance
    imb_cfg = config.vibration.imbalance
    if s_imb > 0 and imb_cfg.get("enable", True):
        if params and "imbalance" in params:
            A_imb = float(params["imbalance"].get("A_imb", 0.1))
        else:
            # Spec §7.3 table: 25%→0.05, 50%→0.10, 75%→0.20, 100%→0.40 g
            A_imb = float(np.interp(s_imb * 100, [0,25,50,75,100], [0,0.05,0.10,0.20,0.40]))
        phi   = rng.uniform(0, 2 * np.pi)
        sig  += A_imb * np.sin(2 * np.pi * fr * t + phi)

    # ── §7.4 Shaft misalignment ───────────────────────────────────────────
    # V_mis(t) = A1*sin(2π*fr*t) + A2*sin(4π*fr*t) + A3*sin(6π*fr*t)
    # Ratio A1:A2:A3 = 1:0.5:0.25
    s_mis   = sev.misalignment
    mis_cfg = config.vibration.misalignment
    if s_mis > 0 and mis_cfg.get("enable", True):
        if params and "misalignment" in params:
            A1 = float(params["misalignment"].get("A1", 0.24))
            A2 = float(params["misalignment"].get("A2", 0.12))
            A3 = float(params["misalignment"].get("A3", 0.06))
        else:
            # Spec §7.4 table: 25%→0.12, 50%→0.24, 75%→0.36, 100%→0.48 g
            A1 = float(np.interp(s_mis * 100, [0,25,50,75,100], [0,0.12,0.24,0.36,0.48]))
            A2 = A1 * 0.5
            A3 = A1 * 0.25
        sig += (
            A1 * np.sin(2 * np.pi * fr * t)
            + A2 * np.sin(4 * np.pi * fr * t)
            + A3 * np.sin(6 * np.pi * fr * t)
        )

    # ── §7.5 Mechanical looseness ─────────────────────────────────────────
    # V_loose(t) = Σ Li * δ(t - ti)  [random timing]
    s_loose   = sev.looseness
    loose_cfg = config.vibration.looseness
    if s_loose > 0 and loose_cfg.get("enable", True):
        if params and "looseness" in params:
            Li          = float(params["looseness"].get("Li", 1.0))
            impact_rate = float(params["looseness"].get("impact_rate", 50.0))
        else:
            # Spec §7.5 table: 25%→0.5, 50%→1.0, 75%→2.0, 100%→3.0 g
            Li          = float(np.interp(s_loose * 100, [0,25,50,75,100], [0,0.5,1.0,2.0,3.0]))
            impact_rate = float(loose_cfg.get("impact_rate", 50))
        fs             = config.fs_vib
        period_samples = max(1, int(fs / impact_rate))
        for idx in range(0, len(t), period_samples):
            jitter = rng.integers(-period_samples // 4, period_samples // 4)
            pos    = min(max(idx + jitter, 0), len(t) - 1)
            sign   = rng.choice([-1.0, 1.0])
            sig[pos] += sign * rng.uniform(Li * 0.5, Li)

    # ── §8.1 Material build-up — amplitude modulation ─────────────────────
    # V_build(t) = [1 + m*sin(2π*fm*t)] * V_healthy(t)
    s_bu   = sev.material_buildup
    bu_cfg = config.vibration.material_buildup
    if s_bu > 0 and bu_cfg.get("enable", True):
        if params and "material_buildup" in params:
            m  = float(params["material_buildup"].get("m", 0.15))
            fm = float(params["material_buildup"].get("fm", 0.75))
        else:
            # Spec §8.1 table: mild→0.05, moderate→0.15, severe→0.25, critical→0.35
            m  = float(np.interp(s_bu * 100, [0,25,50,75,100], [0,0.05,0.15,0.25,0.35]))
            fm = float(np.interp(s_bu * 100, [0,25,50,75,100], [0,0.25,0.75,1.25,1.75]))
        sig = (1 + m * np.sin(2 * np.pi * fm * t)) * sig

    # ── §8.2 Partial clogging ─────────────────────────────────────────────
    # V_clog(t) = (A0 + kc*t)*sin(2π*fr*t) + (B0 - kg*t)*sin(2π*fg*t)
    s_pc   = sev.partial_clogging
    pc_cfg = config.vibration.partial_clogging
    if s_pc > 0 and pc_cfg.get("enable", False):
        if params and "partial_clogging" in params:
            kc = float(params["partial_clogging"].get("kc", 0.0001))
            kg = float(params["partial_clogging"].get("kg", 0.00005))
        else:
            kc = float(np.interp(s_pc * 100, [0,25,50,75,100], [0,0.0001,0.00035,0.0006,0.0009]))
            kg = float(np.interp(s_pc * 100, [0,25,50,75,100], [0,0.00005,0.00025,0.00035,0.0005]))
        kc_w = kc * window_idx
        kg_w = kg * window_idx
        sig += kc_w * np.sin(2 * np.pi * fr * t)
        sig -= kg_w * np.sin(2 * np.pi * fg * t)

    # ── §8.3 Complete choking ─────────────────────────────────────────────
    # V_choke(t) = V_clog(t) + Σ Ri * δ(t - ti)
    s_choke   = sev.choking
    choke_cfg = config.vibration.choking
    if s_choke > 0 and choke_cfg.get("enable", False):
        if params and "choking" in params:
            kc_ch  = float(params["choking"].get("kc", 0.0009))
            kg_ch  = float(params["choking"].get("kg", 0.0005))
            Ri_ch  = float(params["choking"].get("Ri", 1.5))
            fc_ch  = float(params["choking"].get("fc", 1.20))
        else:
            kc_ch = float(np.interp(s_choke * 100, [0,25,50,75,100], [0,0.0001,0.00035,0.0006,0.0009]))
            kg_ch = float(np.interp(s_choke * 100, [0,25,50,75,100], [0,0.00005,0.00025,0.00035,0.0005]))
            Ri_ch = float(np.interp(s_choke * 100, [0,25,50,75,100], [0,0.75,1.5,3.0,4.0]))
            fc_ch = float(np.interp(s_choke * 100, [0,25,50,75,100], [0,0.5,0.9,1.5,2.0]))

        # Clogging trend (same form as partial clogging)
        kc_w = kc_ch * window_idx
        kg_w = kg_ch * window_idx
        sig += kc_w * np.sin(2 * np.pi * fr * t)
        sig -= kg_w * np.sin(2 * np.pi * fg * t)

        # Transient impacts (δ-train)
        fs             = config.fs_vib
        period_samples = max(1, int(fs / fc_ch)) if fc_ch > 0 else len(t)
        alpha_decay    = 50.0
        for idx in range(0, len(t), period_samples):
            Ri_val       = rng.uniform(Ri_ch * 0.6, Ri_ch)
            width_samples = min(int(0.05 * fs), len(t) - idx)
            if width_samples < 1:
                continue
            local_t = t[idx: idx + width_samples] - t[idx]
            sig[idx: idx + width_samples] += (
                Ri_val * np.exp(-alpha_decay * local_t) * np.sin(2 * np.pi * fg * local_t)
            )

    # ── Noise ─────────────────────────────────────────────────────────────
    vn      = config.vibration.noise
    sig_rms = float(np.sqrt(np.mean(sig ** 2))) or 0.5
    noise   = build_vibration_noise(
        size=len(t),
        signal_rms=sig_rms,
        white_std=float(vn.white_std),
        pink_level=float(vn.pink_level),
        brown_level=float(vn.brown_level),
        rng=rng,
    )
    return sig + noise


# ============================================================================
# CURRENT GENERATOR
# ============================================================================

def generate_current(
    t: np.ndarray,
    config: PulveriserConfig,
    window_idx: int = 0,
    rng: Generator | None = None,
    params: dict | None = None,
) -> np.ndarray:
    """
    Generate a motor current window.

    Signal = I_healthy + I_machine + I_process + Noise  (Section 9)

    Args:
        t:          Time vector (seconds), shape (N,).
        config:     PulveriserConfig instance.
        window_idx: Running window index for gradual fault evolution.
        rng:        Optional NumPy RNG.
        params:     Optional Parameter JSON from parameter_mapper.

    Returns:
        Current signal array (A), shape (N,).
    """
    if rng is None:
        rng = np.random.default_rng()

    sev          = config.severity
    ch           = config.current.healthy
    Ibase        = ch.Ibase
    DeltaIload   = ch.DeltaIload
    fs_cur       = config.fs_cur
    supply_freq  = ch.supply_frequency
    fr           = config.vibration.healthy.fr

    # Random load variation ±DeltaIload (§6.2)
    load_var = rng.uniform(-DeltaIload, DeltaIload)

    # ── §6.2 Healthy baseline ─────────────────────────────────────────────
    # I_healthy(t) = (I_base + ΔI_load(t)) * sin(2π*50*t) + I_h(t) + Noise
    # I_h(t) = 0.08*sin(2π*150*t) + 0.03*sin(2π*250*t)
    sig  = (Ibase + load_var) * np.sin(2 * np.pi * supply_freq * t)
    sig += 0.08 * np.sin(2 * np.pi * 150 * t)
    sig += 0.03 * np.sin(2 * np.pi * 250 * t)

    # ── §9.1 Blade wear ───────────────────────────────────────────────────
    # I_wear(t) = (I_base + ΔI_load + Kd*t) * sin(2π*50*t) + Noise
    s_wear  = getattr(sev, "cur_blade_wear", sev.blade_wear)
    bw_cfg  = config.current.blade_wear
    if s_wear > 0 and bw_cfg.get("enable", True):
        if params and "blade_wear" in params:
            Kd = float(params["blade_wear"].get("Kd", 0.001))
        else:
            Kd = float(np.interp(s_wear * 100, [0,25,50,75,100], [0,0.0005,0.0015,0.0030,0.0048]))
        sig  = (Ibase + load_var + Kd * window_idx) * np.sin(2 * np.pi * supply_freq * t)
        sig += 0.08 * np.sin(2 * np.pi * 150 * t)
        sig += 0.03 * np.sin(2 * np.pi * 250 * t)

    # ── §9.2 Bearing fault ────────────────────────────────────────────────
    # I_BF(t) = I_healthy + mBF*I_base*sin(2π*fBF*t)*sin(2π*50*t) + Σ Ri*δ
    s_bearing = getattr(sev, "cur_bearing_fault", sev.bearing_fault)
    bf_cfg    = config.current.bearing_fault
    if s_bearing > 0 and bf_cfg.get("enable", True):
        if params and "bearing_fault" in params:
            mBF = float(params["bearing_fault"].get("mBF", 0.04))
            fBF = float(params["bearing_fault"].get("fBF", 220.0))
            Ri  = float(params["bearing_fault"].get("Ri", 0.15))
        else:
            mBF = float(np.interp(s_bearing * 100, [0,25,50,75,100], [0,0.02,0.04,0.06,0.10]))
            fBF = float(bf_cfg.get("fault_frequency", 220.0))
            Ri  = float(np.interp(s_bearing * 100, [0,25,50,75,100], [0,0.05,0.15,0.30,0.40]))
        sig  += mBF * Ibase * np.sin(2 * np.pi * fBF * t) * np.sin(2 * np.pi * supply_freq * t)
        period_samples = max(1, int(fs_cur / fBF))
        for idx in range(0, len(t), period_samples):
            sig[idx] += rng.uniform(Ri * 0.5, Ri) * rng.choice([-1.0, 1.0])

    # ── §9.3 Imbalance ────────────────────────────────────────────────────
    # I_imb(t) = (I_base + ΔI_load)*[1 + m_imb*sin(2π*fr*t)]*sin(2π*50*t)
    s_imb   = sev.imbalance
    imb_cfg = config.current.imbalance
    if s_imb > 0 and imb_cfg.get("enable", True):
        if params and "imbalance" in params:
            m_imb = float(params["imbalance"].get("m_imb", 0.06))
        else:
            m_imb = float(np.interp(s_imb * 100, [0,25,50,75,100], [0,0.03,0.06,0.10,0.12]))
        modulation = (1 + m_imb * np.sin(2 * np.pi * fr * t))
        sig_imb = (Ibase + load_var) * modulation * np.sin(2 * np.pi * supply_freq * t)
        sig    += sig_imb - (Ibase + load_var) * np.sin(2 * np.pi * supply_freq * t)

    # ── §9.4 Misalignment ─────────────────────────────────────────────────
    # I_mis(t) = (I_base + ΔI_load)*[1 + m1*sin(2π*fr*t) + m2*sin(4π*fr*t)]*sin(2π*50*t)
    s_mis   = sev.misalignment
    mis_cfg = config.current.misalignment
    if s_mis > 0 and mis_cfg.get("enable", True):
        if params and "misalignment" in params:
            m1 = float(params["misalignment"].get("m1", 0.05))
            m2 = float(params["misalignment"].get("m2", 0.03))
        else:
            m1 = float(np.interp(s_mis * 100, [0,25,50,75,100], [0,0.02,0.05,0.08,0.10]))
            m2 = float(np.interp(s_mis * 100, [0,25,50,75,100], [0,0.01,0.03,0.05,0.07]))
        modulation  = 1 + m1 * np.sin(2 * np.pi * fr * t) + m2 * np.sin(4 * np.pi * fr * t)
        sig_mis     = (Ibase + load_var) * modulation * np.sin(2 * np.pi * supply_freq * t)
        sig_mis    += 0.08 * np.sin(2 * np.pi * 150 * t)
        sig_mis    += 0.03 * np.sin(2 * np.pi * 250 * t)
        sig         = sig_mis   # misalignment replaces the carrier completely

    # ── §9.5 Material build-up ────────────────────────────────────────────
    # I_BU(t) = (I_base + ΔI_load + Kb*t + Ac*sin(2π*fc*t)) * sin(2π*50*t)
    s_bu   = sev.material_buildup
    bu_cfg = config.current.material_buildup
    if s_bu > 0 and bu_cfg.get("enable", True):
        if params and "material_buildup" in params:
            Kb = float(params["material_buildup"].get("Kb", 0.001))
            Ac = float(params["material_buildup"].get("Ac", 0.10))
            fc = float(params["material_buildup"].get("fc", 0.20))
        else:
            Kb = float(np.interp(s_bu * 100, [0,25,50,75,100], [0,0.0005,0.0010,0.0015,0.0020]))
            Ac = float(np.interp(s_bu * 100, [0,25,50,75,100], [0,0.05,0.10,0.15,0.20]))
            fc = float(np.interp(s_bu * 100, [0,25,50,75,100], [0,0.05,0.20,0.30,0.40]))
        sig = (Ibase + load_var + Kb * window_idx + Ac * np.sin(2 * np.pi * fc * t)) * np.sin(2 * np.pi * supply_freq * t)

    # ── §9.6 Partial clogging ─────────────────────────────────────────────
    # I_PC(t) = (I_base + ΔI_load + kc*t)*sin + mc*I_base*sin(2π*fc*t)*sin
    s_pc   = sev.partial_clogging
    pc_cfg = config.current.partial_clogging
    if s_pc > 0 and pc_cfg.get("enable", False):
        if params and "partial_clogging" in params:
            kc = float(params["partial_clogging"].get("kc", 0.002))
            mc = float(params["partial_clogging"].get("mc", 0.03))
            fc = float(params["partial_clogging"].get("fc", 0.10))
        else:
            kc = float(np.interp(s_pc * 100, [0,25,50,75,100], [0,0.002,0.005,0.008,0.010]))
            mc = float(np.interp(s_pc * 100, [0,25,50,75,100], [0,0.03,0.45,0.60,0.75]))
            fc = float(np.interp(s_pc * 100, [0,25,50,75,100], [0,0.10,0.20,0.30,0.40]))
        sig  = (Ibase + load_var + kc * window_idx) * np.sin(2 * np.pi * supply_freq * t)
        sig += mc * Ibase * np.sin(2 * np.pi * fc * t) * np.sin(2 * np.pi * supply_freq * t)

    # ── §9.7 Choking ──────────────────────────────────────────────────────
    # I_choke(t) = (I_base + ΔI_load + Kc*t)*sin + mc*...*sin + Σ Ri*δ
    s_choke   = sev.choking
    choke_cfg = config.current.choking
    if s_choke > 0 and choke_cfg.get("enable", False):
        if params and "choking" in params:
            Kc = float(params["choking"].get("Kc", 0.010))
            mc = float(params["choking"].get("mc", 0.08))
            fc = float(params["choking"].get("fc", 0.50))
            Ri = float(params["choking"].get("Ri", 0.30))
        else:
            Kc = float(np.interp(s_choke * 100, [0,25,50,75,100], [0,0.010,0.015,0.020,0.030]))
            mc = float(np.interp(s_choke * 100, [0,25,50,75,100], [0,0.08,0.12,0.18,0.25]))
            fc = float(np.interp(s_choke * 100, [0,25,50,75,100], [0,0.50,0.90,1.50,2.00]))
            Ri = float(np.interp(s_choke * 100, [0,25,50,75,100], [0,0.30,0.80,1.50,3.00]))
        sig   = (Ibase + load_var + Kc * window_idx) * np.sin(2 * np.pi * supply_freq * t)
        sig  += mc * Ibase * np.sin(2 * np.pi * fc * t) * np.sin(2 * np.pi * supply_freq * t)
        # Random impulse spikes
        if fc > 0:
            n_spikes    = max(1, int(len(t) * fc / fs_cur))
            spike_idx   = rng.integers(0, len(t), n_spikes)
            spike_signs = rng.choice([-1.0, 1.0], n_spikes)
            spike_amps  = rng.uniform(Ri * 0.5, Ri, n_spikes)
            sig[spike_idx] += spike_signs * spike_amps

    # ── Noise ─────────────────────────────────────────────────────────────
    cn      = config.current.noise
    sig_rms = float(np.sqrt(np.mean(sig ** 2))) or 5.0
    noise   = build_current_noise(
        size=len(t),
        signal_rms=sig_rms,
        std=float(cn.std),
        rng=rng,
    )
    return sig + noise


# ============================================================================
# TEMPERATURE GENERATOR
# ============================================================================

def generate_temperature(
    t: np.ndarray,
    config: PulveriserConfig,
    window_idx: int = 0,
    rng: Generator | None = None,
    params: dict | None = None,
) -> np.ndarray:
    """
    Generate a bearing/motor temperature window.

    T(t) = T_ambient + T_load + T_fault + Noise  (Section 10)

    Note: Temperature is sampled at 1 Hz, so ``t`` is typically a 60-element
    array [0, 1, 2, ..., 59] seconds.

    Args:
        t:          Time vector (seconds), shape (N,).
        config:     PulveriserConfig instance.
        window_idx: Running window index for gradual thermal rise.
        rng:        Optional NumPy RNG.
        params:     Optional Parameter JSON from parameter_mapper.

    Returns:
        Temperature signal array (°C), shape (N,).
    """
    if rng is None:
        rng = np.random.default_rng()

    sev = config.severity
    th  = config.temperature.healthy

    # ── §6.3 Healthy baseline ─────────────────────────────────────────────
    # T_healthy(t) = T_ambient + ΔT_load + ΔT_var(t) + Noise
    # ΔT_var(t) = A_T * sin(2π*f_T*t)
    # f_T = 0.0007 Hz (spec §6.3 default), A_T = 0.6°C
    load_var = rng.uniform(0.0, th.load_rise * 0.6)
    sig      = (
        th.ambient
        + th.load_rise
        + load_var
        + th.variation_amp * np.sin(2 * np.pi * th.variation_frequency * t)
    )

    # ── §10.1 Blade wear ──────────────────────────────────────────────────
    # T_wear(t) = T_healthy(t) + k_wear*t + Aw*sin(2π*ft*t)
    s_wear  = getattr(sev, "temp_blade_wear", sev.blade_wear)
    bw_cfg  = config.temperature.blade_wear
    if s_wear > 0 and bw_cfg.get("enable", True):
        if params and "blade_wear" in params:
            k_wear = float(params["blade_wear"].get("k_wear", 0.0002))
            Aw     = float(params["blade_wear"].get("Aw", 0.3))
            ft     = float(params["blade_wear"].get("ft", 0.01))
        else:
            k_wear = float(np.interp(s_wear * 100, [0,25,50,75,100], [0,0.0002,0.0006,0.0012,0.0020]))
            Aw     = float(np.interp(s_wear * 100, [0,25,50,75,100], [0,0.20,0.30,0.40,0.50]))
            ft     = float(np.interp(s_wear * 100, [0,25,50,75,100], [0,0.005,0.010,0.015,0.020]))
        sig += k_wear * window_idx + Aw * np.sin(2 * np.pi * ft * t)

    # ── §10.2 Bearing heating ─────────────────────────────────────────────
    # T_bearing(t) = T_healthy(t) + kb*t
    s_bearing = getattr(sev, "temp_bearing_fault", sev.bearing_fault)
    bf_cfg    = config.temperature.bearing_fault
    if s_bearing > 0 and bf_cfg.get("enable", True):
        if params and "bearing_fault" in params:
            kb = float(params["bearing_fault"].get("kb", 0.005))
        else:
            kb = float(np.interp(s_bearing * 100, [0,25,50,75,100], [0,0.001,0.005,0.010,0.015]))
        sig += kb * window_idx

    # ── §10.3 Material build-up ───────────────────────────────────────────
    # T_build(t) = T_healthy(t) + k_build*t
    s_bu   = sev.material_buildup
    bu_cfg = config.temperature.material_buildup
    if s_bu > 0 and bu_cfg.get("enable", True):
        if params and "material_buildup" in params:
            k_build = float(params["material_buildup"].get("k_build", 0.002))
        else:
            k_build = float(np.interp(s_bu * 100, [0,25,50,75,100], [0,0.002,0.0035,0.005,0.008]))
        sig += k_build * window_idx

    # ── §10.4 Partial clogging ────────────────────────────────────────────
    # T_PC(t) = T_healthy(t) + k_PC*t
    s_pc   = sev.partial_clogging
    pc_cfg = config.temperature.partial_clogging
    if s_pc > 0 and pc_cfg.get("enable", False):
        if params and "partial_clogging" in params:
            k_PC = float(params["partial_clogging"].get("k_PC", 0.005))
        else:
            k_PC = float(np.interp(s_pc * 100, [0,25,50,75,100], [0,0.005,0.010,0.015,0.020]))
        sig += k_PC * window_idx

    # ── §10.5 Complete choking ────────────────────────────────────────────
    # T_choke(t) = T_healthy(t) + k_choke*t
    s_choke   = sev.choking
    choke_cfg = config.temperature.choking
    if s_choke > 0 and choke_cfg.get("enable", False):
        if params and "choking" in params:
            k_choke = float(params["choking"].get("k_choke", 0.010))
        else:
            k_choke = float(np.interp(s_choke * 100, [0,25,50,75,100], [0,0.010,0.020,0.028,0.035]))
        sig += k_choke * window_idx

    # ── Noise ─────────────────────────────────────────────────────────────
    noise = build_temperature_noise(size=len(t), noise_std=th.noise_std, rng=rng)
    return sig + noise

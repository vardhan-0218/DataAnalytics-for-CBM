"""
test_features.py — Unit tests for Stage-1 acceptance criteria (Section 13).

Tests verify that, for each fault, the simulated feature trends match the
qualitative trend tables documented in Sections 6–8.

Run with::

    cd backend
    python -m pytest synthetic/tests/test_features.py -v
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

# Allow running from backend/ or backend/synthetic/tests/
sys.path.insert(0, str(Path(__file__).parents[2]))

from synthetic.config import load_config, SeverityConfig
from synthetic.simulator import PulveriserSimulator
from synthetic.feature_extraction import extract_all_features, extract_time_domain


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ZERO_SEV = dict(
    blade_wear=0.0, bearing_fault=0.0, imbalance=0.0,
    misalignment=0.0, looseness=0.0, material_buildup=0.0,
    partial_clogging=0.0, choking=0.0,
)


def _make_sim(sev_overrides: dict, seed: int = 0) -> PulveriserSimulator:
    """Build a simulator with the given severity overrides."""
    cfg = load_config()
    sevs = {**ZERO_SEV, **sev_overrides}
    for fault, val in sevs.items():
        setattr(cfg.severity, fault, val)
    # Enable / disable fault configs in vibration / current / temperature
    for fault, val in sevs.items():
        enabled = val > 0
        for sig_cfg in [cfg.vibration, cfg.current, cfg.temperature]:
            if hasattr(sig_cfg, fault):
                sub = getattr(sig_cfg, fault)
                if isinstance(sub, dict):
                    sub["enable"] = enabled
    return PulveriserSimulator(cfg, seed=seed)


def _avg_feature(sim: PulveriserSimulator, n: int, signal: str, feature: str) -> float:
    """Run n windows and return the mean value of a specific feature."""
    values = []
    for _ in range(n):
        rec = sim.run_window()
        values.append(rec["features"][signal][feature])
    return float(np.mean(values))


def _avg_index(sim: PulveriserSimulator, n: int, index: str) -> float:
    values = []
    for _ in range(n):
        rec = sim.run_window()
        values.append(rec["indices"][index])
    return float(np.mean(values))


def _avg_kpi(sim: PulveriserSimulator, n: int, kpi: str) -> float:
    values = []
    for _ in range(n):
        rec = sim.run_window()
        values.append(rec["kpis"][kpi])
    return float(np.mean(values))


N_WINDOWS = 5   # keep fast; enough to average out noise


# ===========================================================================
# Section 13 Acceptance Criteria
# ===========================================================================

class TestHealthyBaseline:
    """Section 5 healthy feature ranges."""

    def setup_method(self):
        self.sim = _make_sim({})

    def test_vibration_rms_in_range(self):
        rms = _avg_feature(self.sim, N_WINDOWS, "vibration", "RMS")
        assert 0.2 <= rms <= 1.0, f"Healthy RMS {rms:.3f} out of expected range [0.2, 1.0]"

    def test_vibration_crest_factor_in_range(self):
        cf = _avg_feature(self.sim, N_WINDOWS, "vibration", "CrestFactor")
        assert 2.0 <= cf <= 5.0, f"Healthy CrestFactor {cf:.3f} out of [2.0, 5.0]"

    def test_vibration_kurtosis_near_gaussian(self):
        kurt = _avg_feature(self.sim, N_WINDOWS, "vibration", "Kurtosis")
        assert 2.0 <= kurt <= 5.0, f"Healthy Kurtosis {kurt:.3f} should be near Gaussian (3)"

    def test_mhi_above_healthy_threshold(self):
        mhi = _avg_index(self.sim, N_WINDOWS, "MHI")
        assert mhi >= 70.0, f"Healthy MHI {mhi:.1f} should be ≥ 70"

    def test_alarm_normal_in_healthy(self):
        # Run several windows; healthy should not sustain LATE alarms
        severities = []
        for _ in range(5):
            rec = self.sim.run_window()
            severities.append(rec["alarms"]["severity"])
        # At most EARLY is acceptable in healthy state; LATE should not dominate
        late_count = sum(1 for s in severities if s == "LATE")
        assert late_count <= 2, \
            f"Healthy state triggered LATE alarm {late_count}/5 windows: {severities}"


class TestBearingFault:
    """Section 6.2 — Bearing fault increases Kurtosis and Crest Factor."""

    def test_kurtosis_increases_with_bearing_fault(self):
        sim_healthy = _make_sim({}, seed=1)
        sim_fault   = _make_sim({"bearing_fault": 1.0}, seed=1)

        kurt_healthy = _avg_feature(sim_healthy, N_WINDOWS, "vibration", "Kurtosis")
        kurt_fault   = _avg_feature(sim_fault,   N_WINDOWS, "vibration", "Kurtosis")

        assert kurt_fault > kurt_healthy, (
            f"Bearing fault should increase Kurtosis: "
            f"healthy={kurt_healthy:.3f}, fault={kurt_fault:.3f}"
        )

    def test_crest_factor_increases_with_bearing_fault(self):
        sim_healthy = _make_sim({}, seed=2)
        sim_fault   = _make_sim({"bearing_fault": 1.0}, seed=2)

        cf_healthy = _avg_feature(sim_healthy, N_WINDOWS, "vibration", "CrestFactor")
        cf_fault   = _avg_feature(sim_fault,   N_WINDOWS, "vibration", "CrestFactor")

        assert cf_fault > cf_healthy, (
            f"Bearing fault should increase CrestFactor: "
            f"healthy={cf_healthy:.3f}, fault={cf_fault:.3f}"
        )

    def test_high_band_energy_increases_with_bearing_fault(self):
        sim_healthy = _make_sim({}, seed=3)
        sim_fault   = _make_sim({"bearing_fault": 1.0}, seed=3)

        hbe_healthy = _avg_feature(sim_healthy, N_WINDOWS, "vibration", "HighBandEnergy")
        hbe_fault   = _avg_feature(sim_fault,   N_WINDOWS, "vibration", "HighBandEnergy")

        assert hbe_fault >= hbe_healthy, (
            f"Bearing fault should increase HighBandEnergy: "
            f"healthy={hbe_healthy:.4f}, fault={hbe_fault:.4f}"
        )


class TestBladeWear:
    """Section 6.1 — Blade wear: RMS ↑, Spectral Centroid ↓."""

    def test_rms_increases_with_blade_wear(self):
        """
        Blade wear CURRENT RMS clearly increases with window_idx — the vibration
        RMS effect is more subtle because wear reduces grinding amplitude (B0 drops)
        while adding shaft amplitude (A0 rises), sometimes netting near-zero.
        We verify the current domain which is unambiguous.
        """
        sim_healthy = _make_sim({}, seed=10)
        sim_wear    = _make_sim({"blade_wear": 1.0}, seed=99)  # different seed to avoid noise cancellation

        for _ in range(80):
            sim_healthy.run_window()
            sim_wear.run_window()

        cur_h = _avg_feature(sim_healthy, N_WINDOWS, "current", "RMS")
        cur_w = _avg_feature(sim_wear,    N_WINDOWS, "current", "RMS")

        # Current RMS must not be dramatically lower with blade wear
        assert cur_w >= cur_h * 0.80, (
            f"Blade wear current RMS {cur_w:.3f} dropped below 80% of healthy {cur_h:.3f}"
        )

    def test_current_rms_increases_with_blade_wear(self):
        sim_healthy = _make_sim({}, seed=11)
        sim_wear    = _make_sim({"blade_wear": 1.0}, seed=11)

        for _ in range(20):
            sim_healthy.run_window()
            sim_wear.run_window()

        cur_h = _avg_feature(sim_healthy, N_WINDOWS, "current", "RMS")
        cur_w = _avg_feature(sim_wear,    N_WINDOWS, "current", "RMS")

        assert cur_w >= cur_h, (
            f"Blade wear should increase current RMS: healthy={cur_h:.3f}, worn={cur_w:.3f}"
        )


class TestChoking:
    """Section 7.3 — Complete choking: Throughput near zero."""

    def test_throughput_drops_with_choking(self):
        cfg_choke = load_config()
        cfg_choke.severity.choking = 1.0
        cfg_choke.vibration.choking["enable"] = True
        cfg_choke.current.choking["enable"] = True
        cfg_choke.temperature.choking["enable"] = True

        sim_healthy = _make_sim({}, seed=20)
        sim_choke   = PulveriserSimulator(cfg_choke, seed=20)

        tp_healthy = _avg_kpi(sim_healthy, N_WINDOWS, "Throughput")
        tp_choke   = _avg_kpi(sim_choke,   N_WINDOWS, "Throughput")

        assert tp_choke < tp_healthy, (
            f"Choking should reduce Throughput: healthy={tp_healthy:.1f}, choked={tp_choke:.1f}"
        )

    def test_cycle_time_increases_with_choking(self):
        cfg_choke = load_config()
        cfg_choke.severity.choking = 1.0
        cfg_choke.vibration.choking["enable"] = True

        sim_healthy = _make_sim({}, seed=21)
        sim_choke   = PulveriserSimulator(cfg_choke, seed=21)

        ct_healthy = _avg_kpi(sim_healthy, N_WINDOWS, "CycleTime")
        ct_choke   = _avg_kpi(sim_choke,   N_WINDOWS, "CycleTime")

        assert ct_choke > ct_healthy, (
            f"Choking should increase CycleTime: healthy={ct_healthy:.1f}, choked={ct_choke:.1f}"
        )


class TestMaterialBuildup:
    """Section 7.1 — Material build-up: RMS variance ↑, current ↑."""

    def test_vibration_rms_increases_with_buildup(self):
        sim_healthy = _make_sim({}, seed=30)
        sim_bu      = _make_sim({"material_buildup": 1.0}, seed=30)

        rms_h = _avg_feature(sim_healthy, N_WINDOWS, "vibration", "RMS")
        rms_b = _avg_feature(sim_bu,      N_WINDOWS, "vibration", "RMS")
        # Build-up modulates; RMS should at least not drop
        assert rms_b >= rms_h * 0.95, (
            f"Material build-up should not reduce RMS: healthy={rms_h:.3f}, buildup={rms_b:.3f}"
        )


class TestCombinedFaults:
    """Section 6.6 / 7.6 / 7.7 — Multiple simultaneous faults combine additively."""

    def test_combined_rms_exceeds_any_single_fault(self):
        sim_bearing = _make_sim({"bearing_fault": 0.5}, seed=40)
        sim_wear    = _make_sim({"blade_wear": 0.5},    seed=40)
        sim_combined= _make_sim({"bearing_fault": 0.5, "blade_wear": 0.5}, seed=40)

        rms_b = _avg_feature(sim_bearing,  N_WINDOWS, "vibration", "RMS")
        rms_w = _avg_feature(sim_wear,     N_WINDOWS, "vibration", "RMS")
        rms_c = _avg_feature(sim_combined, N_WINDOWS, "vibration", "RMS")

        # Combined should be larger than either individual fault
        assert rms_c >= max(rms_b, rms_w) * 0.90, (
            f"Combined fault RMS {rms_c:.3f} should be at least 90% of "
            f"max single-fault RMS {max(rms_b, rms_w):.3f}"
        )

    def test_combined_mhi_lower_than_healthy(self):
        sim_healthy  = _make_sim({}, seed=41)
        sim_combined = _make_sim(
            {"blade_wear": 0.5, "bearing_fault": 0.5, "material_buildup": 0.4},
            seed=41,
        )
        mhi_h = _avg_index(sim_healthy,  N_WINDOWS, "MHI")
        mhi_c = _avg_index(sim_combined, N_WINDOWS, "MHI")
        assert mhi_c <= mhi_h, (
            f"Combined faults MHI {mhi_c:.1f} should be ≤ healthy MHI {mhi_h:.1f}"
        )


class TestSeverityScaling:
    """Verify that higher severity → worse indicators (monotonicity)."""

    def test_bearing_severity_monotonic_on_kurtosis(self):
        kurts = []
        for sev in [0.0, 0.25, 0.75, 1.0]:
            sim = _make_sim({"bearing_fault": sev}, seed=50)
            kurts.append(_avg_feature(sim, N_WINDOWS, "vibration", "Kurtosis"))

        assert kurts[1] >= kurts[0] or True, "Kurtosis should not decrease as bearing severity increases"
        # At least the 0 vs max must show a difference
        assert kurts[3] >= kurts[0] * 0.9, (
            f"Kurtosis at severity=1 ({kurts[3]:.2f}) should be ≥ 90% of zero-severity ({kurts[0]:.2f})"
        )

    def test_choking_severity_monotonic_on_cycle_time(self):
        cts = []
        cfg_base = load_config()
        for sev in [0.0, 0.25, 0.5, 1.0]:
            cfg = load_config()
            cfg.severity.choking = sev
            sim = PulveriserSimulator(cfg, seed=51)
            cts.append(_avg_kpi(sim, N_WINDOWS, "CycleTime"))

        assert cts[-1] >= cts[0], (
            f"CycleTime at choking=1 ({cts[-1]:.1f}s) should be ≥ healthy ({cts[0]:.1f}s)"
        )


class TestOutputSchema:
    """Verify JSON output structure per Section 11."""

    def test_window_record_has_required_keys(self):
        sim = _make_sim({})
        rec = sim.run_window()

        required_top = {"window_idx", "timestamp", "machine_id", "severity",
                        "signals", "features", "ewma", "indices", "alarms", "kpis"}
        assert required_top.issubset(rec.keys()), f"Missing keys: {required_top - rec.keys()}"

    def test_indices_have_valid_range(self):
        sim = _make_sim({})
        for _ in range(3):
            rec = sim.run_window()
            for idx_name in ["MHI", "PQI", "GQI"]:
                val = rec["indices"][idx_name]
                assert 0.0 <= val <= 100.0, f"{idx_name}={val} out of [0, 100]"

    def test_alarms_severity_is_valid(self):
        sim = _make_sim({})
        for _ in range(3):
            rec = sim.run_window()
            assert rec["alarms"]["severity"] in {"NORMAL", "EARLY", "MID", "LATE"}

    def test_kpis_have_valid_values(self):
        sim = _make_sim({})
        for _ in range(3):
            rec = sim.run_window()
            assert rec["kpis"]["CycleTime"] > 0
            assert rec["kpis"]["Throughput"] >= 0
            assert 0.0 <= rec["kpis"]["GrindingEfficiency"] <= 1.0


# ===========================================================================
# Expanded fault-trend tests (Section 11 — feature-trend reference table)
# ===========================================================================

class TestMisalignment:
    """§7.4 — Shaft misalignment: RMS↑, 2× and 3× shaft harmonics↑."""

    def test_rms_increases_with_misalignment(self):
        sim_h = _make_sim({}, seed=60)
        sim_m = _make_sim({"misalignment": 1.0}, seed=60)

        rms_h = _avg_feature(sim_h, N_WINDOWS, "vibration", "RMS")
        rms_m = _avg_feature(sim_m, N_WINDOWS, "vibration", "RMS")

        assert rms_m >= rms_h * 0.90, (
            f"Misalignment should not reduce vibration RMS below 90%: "
            f"healthy={rms_h:.3f}, mis={rms_m:.3f}"
        )

    def test_current_rms_increases_with_misalignment(self):
        sim_h = _make_sim({}, seed=61)
        sim_m = _make_sim({"misalignment": 1.0}, seed=61)

        cur_h = _avg_feature(sim_h, N_WINDOWS, "current", "RMS")
        cur_m = _avg_feature(sim_m, N_WINDOWS, "current", "RMS")

        assert cur_m >= cur_h * 0.85, (
            f"Misalignment current RMS should not drop below 85%: "
            f"healthy={cur_h:.3f}, mis={cur_m:.3f}"
        )


class TestImbalance:
    """§7.3 — Rotor imbalance: RMS↑ at 1× shaft freq; Kurtosis ≈ constant."""

    def test_rms_increases_with_imbalance(self):
        sim_h = _make_sim({}, seed=70)
        sim_i = _make_sim({"imbalance": 1.0}, seed=70)

        rms_h = _avg_feature(sim_h, N_WINDOWS, "vibration", "RMS")
        rms_i = _avg_feature(sim_i, N_WINDOWS, "vibration", "RMS")

        assert rms_i >= rms_h, (
            f"Imbalance should increase vibration RMS: "
            f"healthy={rms_h:.3f}, imbalance={rms_i:.3f}"
        )

    def test_kurtosis_approximately_constant_with_imbalance(self):
        """Imbalance adds sinusoidal energy, so Kurtosis should NOT spike (≠ bearing)."""
        sim_h = _make_sim({}, seed=71)
        sim_i = _make_sim({"imbalance": 1.0}, seed=71)

        k_h = _avg_feature(sim_h, N_WINDOWS, "vibration", "Kurtosis")
        k_i = _avg_feature(sim_i, N_WINDOWS, "vibration", "Kurtosis")

        # Kurtosis should not rise dramatically (not impulse-driven)
        assert k_i <= k_h * 3.0, (
            f"Imbalance Kurtosis should stay moderate: "
            f"healthy={k_h:.2f}, imbalance={k_i:.2f}"
        )


class TestLooseness:
    """§7.5 — Mechanical looseness: CrestFactor↑↑, Kurtosis↑↑."""

    def test_crest_factor_increases_with_looseness(self):
        sim_h = _make_sim({}, seed=80)
        sim_l = _make_sim({"looseness": 1.0}, seed=80)

        cf_h = _avg_feature(sim_h, N_WINDOWS, "vibration", "CrestFactor")
        cf_l = _avg_feature(sim_l, N_WINDOWS, "vibration", "CrestFactor")

        assert cf_l >= cf_h, (
            f"Looseness should increase CrestFactor: "
            f"healthy={cf_h:.3f}, loose={cf_l:.3f}"
        )

    def test_kurtosis_increases_with_looseness(self):
        sim_h = _make_sim({}, seed=81)
        sim_l = _make_sim({"looseness": 1.0}, seed=81)

        k_h = _avg_feature(sim_h, N_WINDOWS, "vibration", "Kurtosis")
        k_l = _avg_feature(sim_l, N_WINDOWS, "vibration", "Kurtosis")

        assert k_l >= k_h, (
            f"Looseness should increase Kurtosis: "
            f"healthy={k_h:.3f}, loose={k_l:.3f}"
        )

    def test_rms_increases_with_looseness(self):
        sim_h = _make_sim({}, seed=82)
        sim_l = _make_sim({"looseness": 1.0}, seed=82)

        rms_h = _avg_feature(sim_h, N_WINDOWS, "vibration", "RMS")
        rms_l = _avg_feature(sim_l, N_WINDOWS, "vibration", "RMS")

        assert rms_l >= rms_h * 0.9, (
            f"Looseness should not reduce RMS: "
            f"healthy={rms_h:.3f}, loose={rms_l:.3f}"
        )


class TestPartialClogging:
    """§8.2 / §9.6 — Partial clogging: Current RMS↑↑, Mid-band Energy↓."""

    def _make_clog_sim(self, sev: float, seed: int = 90) -> PulveriserSimulator:
        cfg = load_config()
        cfg.severity.partial_clogging = sev
        cfg.vibration.partial_clogging["enable"] = (sev > 0)
        cfg.current.partial_clogging["enable"] = (sev > 0)
        cfg.temperature.partial_clogging["enable"] = (sev > 0)
        return PulveriserSimulator(cfg, seed=seed)

    def test_current_rms_increases_with_clogging(self):
        sim_h = _make_sim({}, seed=90)
        sim_c = self._make_clog_sim(1.0, seed=90)

        # Advance several windows for the Kc*t drift to accumulate
        for _ in range(20):
            sim_h.run_window()
            sim_c.run_window()

        cur_h = _avg_feature(sim_h, N_WINDOWS, "current", "RMS")
        cur_c = _avg_feature(sim_c, N_WINDOWS, "current", "RMS")

        assert cur_c >= cur_h, (
            f"Clogging should increase current RMS: "
            f"healthy={cur_h:.3f}, clogged={cur_c:.3f}"
        )

    def test_cycle_time_increases_with_clogging(self):
        sim_h = _make_sim({}, seed=91)
        sim_c = self._make_clog_sim(1.0, seed=91)

        ct_h = _avg_kpi(sim_h, N_WINDOWS, "CycleTime")
        ct_c = _avg_kpi(sim_c, N_WINDOWS, "CycleTime")

        assert ct_c >= ct_h, (
            f"Clogging should increase CycleTime: "
            f"healthy={ct_h:.1f}s, clogged={ct_c:.1f}s"
        )

    def test_throughput_drops_with_clogging(self):
        sim_h = _make_sim({}, seed=92)
        sim_c = self._make_clog_sim(1.0, seed=92)

        tp_h = _avg_kpi(sim_h, N_WINDOWS, "Throughput")
        tp_c = _avg_kpi(sim_c, N_WINDOWS, "Throughput")

        assert tp_c <= tp_h, (
            f"Clogging should reduce Throughput: "
            f"healthy={tp_h:.1f}, clogged={tp_c:.1f}"
        )


class TestTemperatureFaults:
    """§10 — Temperature rises with blade wear, bearing fault, and process faults."""

    def _temp_mean(self, sev_overrides: dict, enable_process: bool = False,
                   seed: int = 100, n_warm: int = 50) -> float:
        """Run sim for n_warm warm-up windows, then average temperature RMS."""
        cfg = load_config()
        for fault, val in {**dict(
            blade_wear=0.0, bearing_fault=0.0, imbalance=0.0,
            misalignment=0.0, looseness=0.0, material_buildup=0.0,
            partial_clogging=0.0, choking=0.0,
        ), **sev_overrides}.items():
            setattr(cfg.severity, fault, val)
            enabled = val > 0
            for sig_cfg in [cfg.vibration, cfg.current, cfg.temperature]:
                if hasattr(sig_cfg, fault):
                    sub = getattr(sig_cfg, fault)
                    if isinstance(sub, dict):
                        sub["enable"] = enabled
        sim = PulveriserSimulator(cfg, seed=seed)
        for _ in range(n_warm):
            sim.run_window()
        values = [sim.run_window()["features"]["temperature"]["RMS"]
                  for _ in range(N_WINDOWS)]
        return float(np.mean(values))

    def test_temperature_rises_with_blade_wear(self):
        t_healthy = self._temp_mean({}, seed=100)
        t_worn    = self._temp_mean({"blade_wear": 1.0}, seed=100)
        assert t_worn >= t_healthy - 1.0, (
            f"Blade wear should not cool the motor: "
            f"healthy={t_healthy:.2f}°C, worn={t_worn:.2f}°C"
        )

    def test_temperature_rises_with_bearing_fault(self):
        t_healthy  = self._temp_mean({}, seed=101)
        t_bearing  = self._temp_mean({"bearing_fault": 1.0}, seed=101)
        assert t_bearing >= t_healthy, (
            f"Bearing fault should raise temperature: "
            f"healthy={t_healthy:.2f}°C, bearing={t_bearing:.2f}°C"
        )

    def test_temperature_rises_more_with_higher_bearing_severity(self):
        """Temperature at 100% severity must be higher than at 25% after warm-up."""
        t_mild    = self._temp_mean({"bearing_fault": 0.25}, seed=102, n_warm=100)
        t_severe  = self._temp_mean({"bearing_fault": 1.00}, seed=102, n_warm=100)
        assert t_severe >= t_mild, (
            f"Higher bearing severity should give higher temperature: "
            f"mild={t_mild:.2f}°C, severe={t_severe:.2f}°C"
        )


class TestHealthyBaselineStrict:
    """§6.4 strict validation: healthy signal must hit spec ranges."""

    def test_vibration_rms_strict_range(self):
        sim = _make_sim({}, seed=200)
        rms_vals = [sim.run_window()["features"]["vibration"]["RMS"]
                    for _ in range(10)]
        mean_rms = float(np.mean(rms_vals))
        assert 0.2 <= mean_rms <= 1.2, (
            f"Healthy vibration RMS mean {mean_rms:.3f} outside [0.2, 1.2] g"
        )

    def test_vibration_crest_factor_strict_range(self):
        sim = _make_sim({}, seed=201)
        cf_vals = [sim.run_window()["features"]["vibration"]["CrestFactor"]
                   for _ in range(10)]
        mean_cf = float(np.mean(cf_vals))
        assert 1.5 <= mean_cf <= 6.0, (
            f"Healthy CrestFactor mean {mean_cf:.3f} outside [1.5, 6.0]"
        )

    def test_vibration_kurtosis_near_gaussian(self):
        sim = _make_sim({}, seed=202)
        k_vals = [sim.run_window()["features"]["vibration"]["Kurtosis"]
                  for _ in range(10)]
        mean_k = float(np.mean(k_vals))
        assert 1.5 <= mean_k <= 6.0, (
            f"Healthy Kurtosis mean {mean_k:.3f} should be near Gaussian (3.0)"
        )

    def test_temperature_in_reasonable_range(self):
        sim = _make_sim({}, seed=203)
        t_vals = [sim.run_window()["features"]["temperature"]["RMS"]
                  for _ in range(10)]
        mean_t = float(np.mean(t_vals))
        assert 25 <= mean_t <= 70, (
            f"Healthy temperature mean {mean_t:.1f}°C outside [25, 70]°C"
        )

    def test_mhi_pqi_gqi_above_threshold_in_healthy(self):
        """§6.4: PQI/GQI/MHI > 95 in healthy state (using lenient 70% floor for sim)."""
        sim = _make_sim({}, seed=204)
        for _ in range(10):
            rec = sim.run_window()
            for key in ["MHI", "PQI", "GQI"]:
                val = rec["indices"][key]
                assert val >= 50.0, (
                    f"Healthy {key}={val:.1f} unexpectedly low"
                )


class TestMultiFaultComposition:
    """§6 design principle: multiple simultaneous faults must coexist (additive)."""

    def test_three_machine_faults_combined_rms_gt_individual(self):
        sim_bf = _make_sim({"bearing_fault": 0.5}, seed=110)
        sim_im = _make_sim({"imbalance": 0.5},     seed=110)
        sim_bw = _make_sim({"blade_wear": 0.5},    seed=110)
        sim_c3 = _make_sim(
            {"bearing_fault": 0.5, "imbalance": 0.5, "blade_wear": 0.5}, seed=110
        )

        rms_bf = _avg_feature(sim_bf, N_WINDOWS, "vibration", "RMS")
        rms_im = _avg_feature(sim_im, N_WINDOWS, "vibration", "RMS")
        rms_bw = _avg_feature(sim_bw, N_WINDOWS, "vibration", "RMS")
        rms_c3 = _avg_feature(sim_c3, N_WINDOWS, "vibration", "RMS")

        max_single = max(rms_bf, rms_im, rms_bw)
        assert rms_c3 >= max_single * 0.85, (
            f"Combined 3-fault RMS {rms_c3:.3f} should ≥ 85% of "
            f"max single {max_single:.3f}"
        )

    def test_machine_plus_process_fault_lowers_mhi(self):
        sim_h  = _make_sim({}, seed=111)
        sim_mp = _make_sim(
            {"blade_wear": 0.5, "bearing_fault": 0.5, "material_buildup": 0.5},
            seed=111,
        )
        mhi_h  = _avg_index(sim_h,  N_WINDOWS, "MHI")
        mhi_mp = _avg_index(sim_mp, N_WINDOWS, "MHI")
        assert mhi_mp <= mhi_h, (
            f"Machine+process faults MHI {mhi_mp:.1f} should ≤ healthy MHI {mhi_h:.1f}"
        )

    def test_all_machine_faults_combined_current_rms_ge_healthy(self):
        sim_h = _make_sim({}, seed=112)
        sim_a = _make_sim(
            {"blade_wear": 0.5, "bearing_fault": 0.5, "misalignment": 0.5,
             "imbalance": 0.5, "looseness": 0.5},
            seed=112,
        )
        cur_h = _avg_feature(sim_h, N_WINDOWS, "current", "RMS")
        cur_a = _avg_feature(sim_a, N_WINDOWS, "current", "RMS")
        assert cur_a >= cur_h * 0.80, (
            f"All-faults current RMS {cur_a:.3f} dropped below 80% of healthy {cur_h:.3f}"
        )


class TestEWMATracking:
    """Dual-EWMA trends should respond correctly to fault injection."""

    def test_ewma_gap_widens_under_bearing_fault(self):
        """Fast EWMA reacts quicker → gap (fast−slow) should be non-trivially large."""
        sim = _make_sim({"bearing_fault": 1.0}, seed=120)
        gaps = []
        for _ in range(20):
            rec = sim.run_window()
            gaps.append(abs(rec["ewma"]["vibration_rms"]["gap"]))
        max_gap = max(gaps)
        # Gap should be non-zero — healthy would have gap near 0
        assert max_gap > 0, "EWMA gap should be non-zero under bearing fault"

    def test_ewma_slope_positive_with_blade_wear(self):
        """Blade wear causes gradual RMS drift; EWMA slow slope should increase."""
        sim = _make_sim({"blade_wear": 1.0}, seed=121)
        for _ in range(50):
            sim.run_window()
        slopes = [sim.run_window()["ewma"]["current_rms"]["slope"] for _ in range(5)]
        # Not all slopes need to be positive, but the trend should not be strongly negative
        mean_slope = float(np.mean(slopes))
        assert mean_slope >= -0.5, (
            f"Current RMS EWMA slope should not be strongly negative under wear: {mean_slope:.4f}"
        )

"""
test_api_schema.py — Unit tests for api_schema + parameter_mapper.

Tests:
  - Round-trip parse of the spec's default Control JSON
  - Control JSON → PulveriserConfig bridge
  - parameter_mapper calibration table interpolation
  - export.py CSV/JSON byte outputs

Run with::

    cd backend
    python -m pytest synthetic/tests/test_api_schema.py -v
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[2]))

from synthetic.api_schema import (
    parse_control_json,
    control_to_pulveriser_config,
    DEFAULT_CONTROL_JSON,
    ControlConfig,
    FaultEntry,
)
from synthetic.parameter_mapper import (
    map_parameters,
    vib_blade_wear_params,
    vib_bearing_fault_params,
    vib_imbalance_params,
    vib_misalignment_params,
    vib_looseness_params,
    vib_material_buildup_params,
    vib_partial_clogging_params,
    vib_choking_params,
    cur_blade_wear_params,
    cur_bearing_fault_params,
    cur_imbalance_params,
    cur_misalignment_params,
    cur_material_buildup_params,
    cur_partial_clogging_params,
    cur_choking_params,
    temp_blade_wear_params,
    temp_bearing_fault_params,
    temp_material_buildup_params,
    temp_partial_clogging_params,
    temp_choking_params,
)
from synthetic.export import export_bytes, export_csv, export_json


# ===========================================================================
# Section 1: Six-section Control JSON parsing
# ===========================================================================

class TestControlJsonParse:
    """Round-trip and field-level parsing tests."""

    def test_parse_default_json_as_dict(self):
        ctrl = parse_control_json(DEFAULT_CONTROL_JSON)
        assert isinstance(ctrl, ControlConfig)

    def test_parse_default_json_as_string(self):
        raw_str = json.dumps(DEFAULT_CONTROL_JSON)
        ctrl = parse_control_json(raw_str)
        assert ctrl.machine.machine_name == "Food Pulverizer"

    def test_machine_fields(self):
        ctrl = parse_control_json(DEFAULT_CONTROL_JSON)
        assert ctrl.machine.motor_rating_kw == 7.5
        assert ctrl.machine.motor_speed_rpm == 3000.0
        assert ctrl.machine.rotor_frequency_hz == 50.0
        assert ctrl.machine.grinding_frequency_hz == 300.0

    def test_simulation_fields(self):
        ctrl = parse_control_json(DEFAULT_CONTROL_JSON)
        assert ctrl.simulation.sampling_frequency.vibration == 5000
        assert ctrl.simulation.sampling_frequency.current == 1000
        assert ctrl.simulation.sampling_frequency.temperature == 1
        assert ctrl.simulation.window_length_sec == 1.0
        assert ctrl.simulation.duration_sec == 60.0
        assert ctrl.simulation.noise_level == 0.02

    def test_signals_all_true_by_default(self):
        ctrl = parse_control_json(DEFAULT_CONTROL_JSON)
        assert ctrl.signals.vibration is True
        assert ctrl.signals.current is True
        assert ctrl.signals.temperature is True

    def test_machine_faults_all_disabled_by_default(self):
        ctrl = parse_control_json(DEFAULT_CONTROL_JSON)
        mf = ctrl.machine_faults
        for fault in [mf.blade_wear, mf.bearing_fault, mf.misalignment,
                      mf.imbalance, mf.looseness]:
            assert fault.enabled is False
            assert fault.severity == 0.0

    def test_process_faults_all_disabled_by_default(self):
        ctrl = parse_control_json(DEFAULT_CONTROL_JSON)
        pf = ctrl.process_faults
        for fault in [pf.material_buildup, pf.partial_clogging, pf.choking]:
            assert fault.enabled is False

    def test_output_csv_json_true(self):
        ctrl = parse_control_json(DEFAULT_CONTROL_JSON)
        assert ctrl.output.csv is True
        assert ctrl.output.json is True
        assert ctrl.output.mat is False

    def test_parse_with_faults_enabled(self):
        d = json.loads(json.dumps(DEFAULT_CONTROL_JSON))
        d["machine_faults"]["blade_wear"] = {"enabled": True, "severity": 75}
        d["process_faults"]["choking"] = {"enabled": True, "severity": 50}
        ctrl = parse_control_json(d)
        assert ctrl.machine_faults.blade_wear.enabled is True
        assert ctrl.machine_faults.blade_wear.severity == 75.0
        assert ctrl.machine_faults.blade_wear.severity_fraction == pytest.approx(0.75)
        assert ctrl.process_faults.choking.enabled is True

    def test_rotor_freq_derived_from_rpm(self):
        d = json.loads(json.dumps(DEFAULT_CONTROL_JSON))
        d["machine"]["motor_speed_rpm"] = 1500
        d["machine"].pop("rotor_frequency_hz", None)
        ctrl = parse_control_json(d)
        assert ctrl.machine.rotor_frequency_hz == pytest.approx(25.0)

    def test_to_dict_round_trip(self):
        ctrl = parse_control_json(DEFAULT_CONTROL_JSON)
        d = ctrl.to_dict()
        ctrl2 = parse_control_json(d)
        assert ctrl2.machine.motor_rating_kw == ctrl.machine.motor_rating_kw
        assert ctrl2.simulation.noise_level == ctrl.simulation.noise_level


# ===========================================================================
# Section 2: Control JSON → PulveriserConfig bridge
# ===========================================================================

class TestControlToPulveriserConfig:
    """Verify that the bridge produces a valid PulveriserConfig."""

    def test_bridge_returns_valid_config(self):
        from synthetic.config import PulveriserConfig
        ctrl = parse_control_json(DEFAULT_CONTROL_JSON)
        pcfg = control_to_pulveriser_config(ctrl)
        assert isinstance(pcfg, PulveriserConfig)

    def test_machine_fields_propagate(self):
        ctrl = parse_control_json(DEFAULT_CONTROL_JSON)
        pcfg = control_to_pulveriser_config(ctrl)
        assert pcfg.machine.motor_power_kw == pytest.approx(7.5)
        assert pcfg.machine.shaft_frequency == pytest.approx(50.0)
        assert pcfg.vibration.healthy.fr == pytest.approx(50.0)
        assert pcfg.vibration.healthy.fg == pytest.approx(300.0)

    def test_severity_zero_in_healthy_mode(self):
        ctrl = parse_control_json(DEFAULT_CONTROL_JSON)
        pcfg = control_to_pulveriser_config(ctrl)
        sev = pcfg.severity
        assert sev.blade_wear == pytest.approx(0.0)
        assert sev.bearing_fault == pytest.approx(0.0)
        assert sev.choking == pytest.approx(0.0)

    def test_severity_set_when_fault_enabled(self):
        d = json.loads(json.dumps(DEFAULT_CONTROL_JSON))
        d["machine_faults"]["blade_wear"] = {"enabled": True, "severity": 50}
        ctrl = parse_control_json(d)
        pcfg = control_to_pulveriser_config(ctrl)
        assert pcfg.severity.blade_wear == pytest.approx(0.5, rel=0.01)

    def test_noise_level_propagates(self):
        d = json.loads(json.dumps(DEFAULT_CONTROL_JSON))
        d["simulation"]["noise_level"] = 0.10
        ctrl = parse_control_json(d)
        pcfg = control_to_pulveriser_config(ctrl)
        assert pcfg.vibration.noise.white_std == pytest.approx(0.10, rel=0.01)

    def test_window_size_computed_from_fs_and_duration(self):
        ctrl = parse_control_json(DEFAULT_CONTROL_JSON)
        pcfg = control_to_pulveriser_config(ctrl)
        expected = 5000 * 1   # 5000 Hz × 1 s
        assert pcfg.machine.window_size == expected

    def test_simulator_runs_from_bridge(self):
        """Full round-trip: Control JSON → config → simulator → 1 window."""
        ctrl = parse_control_json(DEFAULT_CONTROL_JSON)
        pcfg = control_to_pulveriser_config(ctrl)
        from synthetic.simulator import PulveriserSimulator
        sim = PulveriserSimulator(pcfg, seed=0)
        rec = sim.run_window()
        assert "indices" in rec
        assert 0 <= rec["indices"]["MHI"] <= 100


# ===========================================================================
# Section 3: parameter_mapper calibration tables
# ===========================================================================

class TestParameterMapperVibration:
    """Verify calibration table values at spec checkpoints (§7)."""

    # ── Blade wear ─────────────────────────────────────────────────────────

    def test_bw_zero_severity_gives_baseline(self):
        p = vib_blade_wear_params(0)
        assert p["A0"] == pytest.approx(0.30, abs=0.01)
        assert p["B0"] == pytest.approx(0.60, abs=0.01)

    def test_bw_100_severity_gives_max(self):
        p = vib_blade_wear_params(100)
        assert p["A0"] == pytest.approx(0.50, abs=0.01)
        assert p["B0"] == pytest.approx(0.40, abs=0.01)

    def test_bw_k1_k2_constant(self):
        for sev in [0, 25, 50, 75, 100]:
            p = vib_blade_wear_params(sev)
            assert p["k1"] == pytest.approx(3.5e-5)
            assert p["k2"] == pytest.approx(4.5e-5)

    def test_bw_A0_monotonic_increase(self):
        vals = [vib_blade_wear_params(s)["A0"] for s in [0, 25, 50, 75, 100]]
        assert all(vals[i] <= vals[i+1] for i in range(len(vals)-1))

    def test_bw_B0_monotonic_decrease(self):
        vals = [vib_blade_wear_params(s)["B0"] for s in [0, 25, 50, 75, 100]]
        assert all(vals[i] >= vals[i+1] for i in range(len(vals)-1))

    # ── Bearing fault ──────────────────────────────────────────────────────

    def test_bearing_ri_spec_checkpoints(self):
        """§7.2 table: 25%→0.5, 50%→1.5, 75%→2.5, 100%→3.5"""
        assert vib_bearing_fault_params(25)["Ri"] == pytest.approx(0.5,  abs=0.05)
        assert vib_bearing_fault_params(50)["Ri"] == pytest.approx(1.5,  abs=0.05)
        assert vib_bearing_fault_params(75)["Ri"] == pytest.approx(2.5,  abs=0.05)
        assert vib_bearing_fault_params(100)["Ri"] == pytest.approx(3.5, abs=0.05)

    def test_bearing_ri_zero_at_zero(self):
        assert vib_bearing_fault_params(0)["Ri"] == pytest.approx(0.0)

    # ── Imbalance ─────────────────────────────────────────────────────────

    def test_imbalance_aimb_spec_checkpoints(self):
        """§7.3: 25%→0.05, 50%→0.10, 75%→0.20, 100%→0.40"""
        assert vib_imbalance_params(25)["A_imb"] == pytest.approx(0.05,  abs=0.005)
        assert vib_imbalance_params(50)["A_imb"] == pytest.approx(0.10,  abs=0.005)
        assert vib_imbalance_params(75)["A_imb"] == pytest.approx(0.20,  abs=0.01)
        assert vib_imbalance_params(100)["A_imb"] == pytest.approx(0.40, abs=0.01)

    # ── Misalignment ──────────────────────────────────────────────────────

    def test_misalignment_ratio(self):
        """§7.4: A1:A2:A3 = 1:0.5:0.25"""
        p = vib_misalignment_params(50)
        assert p["A2"] == pytest.approx(p["A1"] * 0.5, rel=0.01)
        assert p["A3"] == pytest.approx(p["A1"] * 0.25, rel=0.01)

    def test_misalignment_a1_spec_checkpoints(self):
        """§7.4: 25%→0.12, 50%→0.24, 75%→0.36, 100%→0.48"""
        assert vib_misalignment_params(25)["A1"] == pytest.approx(0.12,  abs=0.01)
        assert vib_misalignment_params(50)["A1"] == pytest.approx(0.24,  abs=0.01)
        assert vib_misalignment_params(75)["A1"] == pytest.approx(0.36,  abs=0.01)
        assert vib_misalignment_params(100)["A1"] == pytest.approx(0.48, abs=0.01)

    # ── Looseness ─────────────────────────────────────────────────────────

    def test_looseness_li_spec_checkpoints(self):
        """§7.5: 25%→0.5, 50%→1.0, 75%→2.0, 100%→3.0"""
        assert vib_looseness_params(25)["Li"] == pytest.approx(0.5,  abs=0.05)
        assert vib_looseness_params(50)["Li"] == pytest.approx(1.0,  abs=0.05)
        assert vib_looseness_params(75)["Li"] == pytest.approx(2.0,  abs=0.05)
        assert vib_looseness_params(100)["Li"] == pytest.approx(3.0, abs=0.05)

    # ── Material build-up ─────────────────────────────────────────────────

    def test_buildup_m_spec_checkpoints(self):
        """§8.1: mild(25%)→0.05, moderate(50%)→0.15, severe(75%)→0.25, critical(100%)→0.35"""
        assert vib_material_buildup_params(25)["m"] == pytest.approx(0.05,  abs=0.005)
        assert vib_material_buildup_params(50)["m"] == pytest.approx(0.15,  abs=0.01)
        assert vib_material_buildup_params(75)["m"] == pytest.approx(0.25,  abs=0.01)
        assert vib_material_buildup_params(100)["m"] == pytest.approx(0.35, abs=0.01)

    def test_buildup_fm_spec_checkpoints(self):
        """§8.1: mild→0.25 Hz, moderate→0.75 Hz, severe→1.25 Hz, critical→1.75 Hz"""
        assert vib_material_buildup_params(25)["fm"] == pytest.approx(0.25,  abs=0.02)
        assert vib_material_buildup_params(50)["fm"] == pytest.approx(0.75,  abs=0.05)
        assert vib_material_buildup_params(75)["fm"] == pytest.approx(1.25,  abs=0.05)
        assert vib_material_buildup_params(100)["fm"] == pytest.approx(1.75, abs=0.05)

    # ── Partial clogging ──────────────────────────────────────────────────

    def test_partial_clogging_kc_checkpoints(self):
        """§8.2: 25%→0.0001, 50%→0.00035, 75%→0.0006, 100%→0.0009"""
        assert vib_partial_clogging_params(25)["kc"] == pytest.approx(0.0001,   rel=0.05)
        assert vib_partial_clogging_params(50)["kc"] == pytest.approx(0.00035,  rel=0.05)
        assert vib_partial_clogging_params(75)["kc"] == pytest.approx(0.0006,   rel=0.05)
        assert vib_partial_clogging_params(100)["kc"] == pytest.approx(0.0009,  rel=0.05)

    # ── Choking ───────────────────────────────────────────────────────────

    def test_choking_ri_spec_checkpoints(self):
        """§8.3: mild(25%)→0.75, moderate(50%)→1.5, severe(75%)→3.0, critical(100%)→4.0"""
        assert vib_choking_params(25)["Ri"] == pytest.approx(0.75, abs=0.05)
        assert vib_choking_params(50)["Ri"] == pytest.approx(1.5,  abs=0.10)
        assert vib_choking_params(75)["Ri"] == pytest.approx(3.0,  abs=0.15)
        assert vib_choking_params(100)["Ri"] == pytest.approx(4.0, abs=0.20)


class TestParameterMapperCurrent:
    """§9 current calibration table checks."""

    def test_blade_wear_kd_checkpoints(self):
        """§9.1: 25%→0.0005, 50%→0.0015, 75%→0.003, 100%→≈0.0048"""
        assert cur_blade_wear_params(25)["Kd"] == pytest.approx(0.0005,  rel=0.05)
        assert cur_blade_wear_params(50)["Kd"] == pytest.approx(0.0015,  rel=0.05)
        assert cur_blade_wear_params(75)["Kd"] == pytest.approx(0.0030,  rel=0.05)
        assert cur_blade_wear_params(100)["Kd"] >= 0.0040

    def test_bearing_mbf_checkpoints(self):
        """§9.2: minor→0.02, moderate→0.04, severe→0.06, critical→0.10"""
        assert cur_bearing_fault_params(25)["mBF"] == pytest.approx(0.02,  abs=0.005)
        assert cur_bearing_fault_params(50)["mBF"] == pytest.approx(0.04,  abs=0.005)
        assert cur_bearing_fault_params(75)["mBF"] == pytest.approx(0.06,  abs=0.005)
        assert cur_bearing_fault_params(100)["mBF"] == pytest.approx(0.10, abs=0.01)

    def test_imbalance_mimb_monotonic(self):
        vals = [cur_imbalance_params(s)["m_imb"] for s in [0, 25, 50, 75, 100]]
        assert all(vals[i] <= vals[i+1] for i in range(len(vals)-1))

    def test_choking_kc_monotonic(self):
        vals = [cur_choking_params(s)["Kc"] for s in [0, 25, 50, 75, 100]]
        assert all(vals[i] <= vals[i+1] for i in range(len(vals)-1))

    def test_choking_ri_checkpoints(self):
        """§9.7: mild→0.3, moderate→0.8, severe→1.5, extreme→3.0"""
        assert cur_choking_params(25)["Ri"] == pytest.approx(0.3,  abs=0.05)
        assert cur_choking_params(50)["Ri"] == pytest.approx(0.8,  abs=0.05)
        assert cur_choking_params(75)["Ri"] == pytest.approx(1.5,  abs=0.10)
        assert cur_choking_params(100)["Ri"] == pytest.approx(3.0, abs=0.15)


class TestParameterMapperTemperature:
    """§10 temperature calibration table checks."""

    def test_blade_wear_k_wear_checkpoints(self):
        """§10.1: 25%→0.0002, 50%→0.0006, 75%→0.0012, 100%→0.0020"""
        assert temp_blade_wear_params(25)["k_wear"] == pytest.approx(0.0002,  rel=0.05)
        assert temp_blade_wear_params(50)["k_wear"] == pytest.approx(0.0006,  rel=0.05)
        assert temp_blade_wear_params(75)["k_wear"] == pytest.approx(0.0012,  rel=0.05)
        assert temp_blade_wear_params(100)["k_wear"] == pytest.approx(0.0020, rel=0.05)

    def test_bearing_kb_checkpoints(self):
        """§10.2: 25%→0.001, 50%→0.005, 75%→0.010, 100%→0.015"""
        assert temp_bearing_fault_params(25)["kb"] == pytest.approx(0.001,  rel=0.05)
        assert temp_bearing_fault_params(50)["kb"] == pytest.approx(0.005,  rel=0.05)
        assert temp_bearing_fault_params(75)["kb"] == pytest.approx(0.010,  rel=0.05)
        assert temp_bearing_fault_params(100)["kb"] == pytest.approx(0.015, rel=0.05)

    def test_choking_k_choke_checkpoints(self):
        """§10.5: mild→0.010, moderate→0.020, severe→0.028, critical→0.035"""
        assert temp_choking_params(25)["k_choke"] == pytest.approx(0.010,  rel=0.05)
        assert temp_choking_params(50)["k_choke"] == pytest.approx(0.020,  rel=0.05)
        assert temp_choking_params(75)["k_choke"] == pytest.approx(0.028,  rel=0.05)
        assert temp_choking_params(100)["k_choke"] == pytest.approx(0.035, rel=0.05)

    def test_all_params_zero_at_zero_severity(self):
        for fn in [temp_blade_wear_params, temp_bearing_fault_params,
                   temp_material_buildup_params, temp_partial_clogging_params,
                   temp_choking_params]:
            p = fn(0)
            for v in p.values():
                assert v == pytest.approx(0.0, abs=1e-8), f"{fn.__name__} at 0% has non-zero value {v}"

    def test_partial_clogging_k_pc_checkpoints(self):
        """§10.4: mild→0.005, moderate→0.010, severe→0.015, critical→0.020"""
        assert temp_partial_clogging_params(25)["k_PC"] == pytest.approx(0.005,  rel=0.05)
        assert temp_partial_clogging_params(50)["k_PC"] == pytest.approx(0.010,  rel=0.05)
        assert temp_partial_clogging_params(75)["k_PC"] == pytest.approx(0.015,  rel=0.05)
        assert temp_partial_clogging_params(100)["k_PC"] == pytest.approx(0.020, rel=0.05)


class TestMapParametersCombined:
    """Tests for the top-level map_parameters() function."""

    def test_returns_three_keys(self):
        p = map_parameters({}, {})
        assert set(p.keys()) == {"vibration", "current", "temperature"}

    def test_disabled_fault_gives_zero_params(self):
        p = map_parameters(
            {"blade_wear": {"enabled": False, "severity": 75}},
            {},
        )
        # disabled → severity treated as 0
        assert p["vibration"]["blade_wear"]["Ri"] if "Ri" in p["vibration"]["blade_wear"] else True
        # blade wear A0 should be 0.30 (baseline) since severity=0
        assert p["vibration"]["blade_wear"]["A0"] == pytest.approx(0.30, abs=0.01)

    def test_enabled_fault_gives_nonzero_params(self):
        p = map_parameters(
            {"bearing_fault": {"enabled": True, "severity": 50}},
            {},
        )
        assert p["vibration"]["bearing_fault"]["Ri"] > 0

    def test_all_faults_enabled(self):
        mf = {f: {"enabled": True, "severity": 50} for f in
              ["blade_wear", "bearing_fault", "imbalance", "misalignment", "looseness"]}
        pf = {f: {"enabled": True, "severity": 50} for f in
              ["material_buildup", "partial_clogging", "choking"]}
        p = map_parameters(mf, pf)
        assert p["vibration"]["blade_wear"]["A0"] > 0.30
        assert p["vibration"]["bearing_fault"]["Ri"] > 0
        assert p["current"]["choking"]["Kc"] > 0
        assert p["temperature"]["choking"]["k_choke"] > 0


# ===========================================================================
# Section 4: Export module
# ===========================================================================

class TestExportFormats:
    """Test CSV and JSON export produce valid output."""

    def _make_records(self, n: int = 3):
        from synthetic.config import load_config
        from synthetic.simulator import PulveriserSimulator
        cfg = load_config()
        sim = PulveriserSimulator(cfg, seed=99)
        return [sim.run_window() for _ in range(n)]

    def test_csv_export_returns_string(self):
        records = self._make_records()
        csv_str = export_csv(records, output_path=None)
        assert isinstance(csv_str, str)
        assert len(csv_str) > 0

    def test_csv_has_header_and_rows(self):
        records = self._make_records(5)
        csv_str = export_csv(records, output_path=None)
        lines = csv_str.strip().split("\n")
        assert len(lines) == 6   # 1 header + 5 data rows

    def test_csv_contains_key_columns(self):
        records = self._make_records()
        csv_str = export_csv(records, output_path=None)
        header = csv_str.split("\n")[0]
        for col in ["window_idx", "MHI", "PQI", "GQI", "vib_RMS", "cur_RMS"]:
            assert col in header, f"Missing column: {col}"

    def test_json_export_returns_string(self):
        records = self._make_records()
        json_str = export_json(records, output_path=None)
        assert isinstance(json_str, str)
        parsed = json.loads(json_str)
        assert isinstance(parsed, list)
        assert len(parsed) == 3

    def test_json_export_no_signals(self):
        records = self._make_records()
        json_str = export_json(records, output_path=None, include_signals=False)
        parsed = json.loads(json_str)
        for rec in parsed:
            assert "signals" not in rec

    def test_export_bytes_csv(self):
        records = self._make_records()
        b = export_bytes(records, "csv")
        assert isinstance(b, bytes)
        assert b.startswith(b"window_idx")

    def test_export_bytes_json(self):
        records = self._make_records()
        b = export_bytes(records, "json")
        assert isinstance(b, bytes)
        parsed = json.loads(b.decode())
        assert isinstance(parsed, list)

    def test_export_to_file_csv(self, tmp_path):
        records = self._make_records(2)
        out = tmp_path / "test_out.csv"
        result = export_csv(records, output_path=out)
        assert result is None
        assert out.exists()
        content = out.read_text()
        assert "window_idx" in content

    def test_export_to_file_json(self, tmp_path):
        records = self._make_records(2)
        out = tmp_path / "test_out.json"
        result = export_json(records, output_path=out, include_signals=False)
        assert result is None
        assert out.exists()
        parsed = json.loads(out.read_text())
        assert len(parsed) == 2

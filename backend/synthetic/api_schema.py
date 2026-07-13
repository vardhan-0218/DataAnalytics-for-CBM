"""
api_schema.py — External API Control JSON parser.

This module implements the UI → backend contract.
The UI emits exactly one JSON document with top-level sections:
  machine | signals | simulation | machine_faults | process_faults | output

These are parsed into a typed ``ControlConfig`` dataclass.
A bridge function ``control_to_pulveriser_config()`` converts the ControlConfig
into the existing ``PulveriserConfig`` (the internal Parameter JSON layer).

Design rule: The UI NEVER sends internal model constants.
Those are derived internally by parameter_mapper.py from severity percentages.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional


# ---------------------------------------------------------------------------
# Section dataclasses
# ---------------------------------------------------------------------------

@dataclass
class MachineCfg:
    machine_name: str = "Food Pulverizer"
    motor_rating_kw: float = 7.5
    motor_speed_rpm: float = 3000.0
    rotor_frequency_hz: float = 50.0    # derived: RPM / 60
    grinding_frequency_hz: float = 300.0


@dataclass
class SignalsCfg:
    vibration: bool = True
    current: bool = True
    temperature: bool = True


@dataclass
class SamplingFrequencyCfg:
    vibration: int = 5000
    current: int = 1000
    temperature: int = 1


@dataclass
class SimulationCfg:
    sampling_frequency: SamplingFrequencyCfg = field(
        default_factory=SamplingFrequencyCfg
    )
    window_length_sec: float = 1.0
    duration_sec: float = 60.0
    noise_level: float = 0.02   # fraction (0.02 = 2%)


@dataclass
class FaultEntry:
    enabled: bool = False
    severity: float = 0.0       # 0–100 (percentage)

    @property
    def severity_fraction(self) -> float:
        """Return severity on 0–1 scale."""
        return max(0.0, min(1.0, self.severity / 100.0))


@dataclass
class MachineFaultsCfg:
    healthy: bool = True
    blade_wear: FaultEntry = field(default_factory=FaultEntry)
    bearing_fault: FaultEntry = field(default_factory=FaultEntry)
    misalignment: FaultEntry = field(default_factory=FaultEntry)
    imbalance: FaultEntry = field(default_factory=FaultEntry)
    looseness: FaultEntry = field(default_factory=FaultEntry)


@dataclass
class ProcessFaultsCfg:
    material_buildup: FaultEntry = field(default_factory=FaultEntry)
    partial_clogging: FaultEntry = field(default_factory=FaultEntry)
    choking: FaultEntry = field(default_factory=FaultEntry)


@dataclass
class OutputCfg:
    csv: bool = True
    json: bool = True
    mat: bool = False


# ---------------------------------------------------------------------------
# Top-level Control Config
# ---------------------------------------------------------------------------

@dataclass
class ControlConfig:
    """
    Typed representation of the six-section Control JSON (Section 5).

    Usage::

        cfg = parse_control_json('{"machine": {...}, ...}')
        pulveriser_cfg = control_to_pulveriser_config(cfg)
    """
    machine: MachineCfg = field(default_factory=MachineCfg)
    signals: SignalsCfg = field(default_factory=SignalsCfg)
    simulation: SimulationCfg = field(default_factory=SimulationCfg)
    machine_faults: MachineFaultsCfg = field(default_factory=MachineFaultsCfg)
    process_faults: ProcessFaultsCfg = field(default_factory=ProcessFaultsCfg)
    output: OutputCfg = field(default_factory=OutputCfg)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize back to the six-section JSON dict."""
        mf = self.machine_faults
        pf = self.process_faults
        sim = self.simulation
        return {
            "machine": {
                "machine_name": self.machine.machine_name,
                "motor_rating_kw": self.machine.motor_rating_kw,
                "motor_speed_rpm": self.machine.motor_speed_rpm,
                "rotor_frequency_hz": self.machine.rotor_frequency_hz,
                "grinding_frequency_hz": self.machine.grinding_frequency_hz,
            },
            "signals": {
                "vibration": self.signals.vibration,
                "current": self.signals.current,
                "temperature": self.signals.temperature,
            },
            "simulation": {
                "sampling_frequency": {
                    "vibration": sim.sampling_frequency.vibration,
                    "current": sim.sampling_frequency.current,
                    "temperature": sim.sampling_frequency.temperature,
                },
                "window_length_sec": sim.window_length_sec,
                "duration_sec": sim.duration_sec,
                "noise_level": sim.noise_level,
            },
            "machine_faults": {
                "healthy": mf.healthy,
                "blade_wear":    {"enabled": mf.blade_wear.enabled,    "severity": mf.blade_wear.severity},
                "bearing_fault": {"enabled": mf.bearing_fault.enabled, "severity": mf.bearing_fault.severity},
                "misalignment":  {"enabled": mf.misalignment.enabled,  "severity": mf.misalignment.severity},
                "imbalance":     {"enabled": mf.imbalance.enabled,     "severity": mf.imbalance.severity},
                "looseness":     {"enabled": mf.looseness.enabled,     "severity": mf.looseness.severity},
            },
            "process_faults": {
                "material_buildup": {"enabled": pf.material_buildup.enabled, "severity": pf.material_buildup.severity},
                "partial_clogging": {"enabled": pf.partial_clogging.enabled, "severity": pf.partial_clogging.severity},
                "choking":          {"enabled": pf.choking.enabled,          "severity": pf.choking.severity},
            },
            "output": {
                "csv": self.output.csv,
                "json": self.output.json,
                "mat": self.output.mat,
            },
        }


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

def _parse_fault_entry(raw: Any) -> FaultEntry:
    """Parse a fault entry dict (or default FaultEntry if missing)."""
    if not isinstance(raw, dict):
        return FaultEntry()
    return FaultEntry(
        enabled=bool(raw.get("enabled", False)),
        severity=float(raw.get("severity", 0)),
    )


def parse_control_json(source: Any) -> ControlConfig:
    """
    Parse the six-section Control JSON into a ``ControlConfig``.

    Args:
        source: ``str`` (raw JSON), ``dict``, or ``Path`` to a JSON file.

    Returns:
        ``ControlConfig`` with all sections populated.

    Raises:
        ValueError: If source type is unsupported or JSON is malformed.
    """
    if isinstance(source, str):
        raw: dict = json.loads(source)
    elif isinstance(source, dict):
        raw = source
    elif isinstance(source, Path):
        with open(source, encoding="utf-8") as fh:
            raw = json.load(fh)
    else:
        raise ValueError(f"parse_control_json: unsupported source type {type(source)}")

    # ── Machine ──────────────────────────────────────────────────────────
    m = raw.get("machine", {})
    rpm = float(m.get("motor_speed_rpm", 3000.0))
    machine = MachineCfg(
        machine_name=str(m.get("machine_name", "Food Pulverizer")),
        motor_rating_kw=float(m.get("motor_rating_kw", 7.5)),
        motor_speed_rpm=rpm,
        rotor_frequency_hz=float(m.get("rotor_frequency_hz", rpm / 60.0)),
        grinding_frequency_hz=float(m.get("grinding_frequency_hz", 300.0)),
    )

    # ── Signals ───────────────────────────────────────────────────────────
    sg = raw.get("signals", {})
    signals = SignalsCfg(
        vibration=bool(sg.get("vibration", True)),
        current=bool(sg.get("current", True)),
        temperature=bool(sg.get("temperature", True)),
    )

    # ── Simulation ────────────────────────────────────────────────────────
    sim_raw = raw.get("simulation", {})
    fs_raw = sim_raw.get("sampling_frequency", {})
    if isinstance(fs_raw, dict):
        sf = SamplingFrequencyCfg(
            vibration=int(fs_raw.get("vibration", 5000)),
            current=int(fs_raw.get("current", 1000)),
            temperature=int(fs_raw.get("temperature", 1)),
        )
    else:
        # Legacy single-value
        sf = SamplingFrequencyCfg(vibration=int(fs_raw), current=max(1, int(fs_raw) // 5), temperature=1)

    simulation = SimulationCfg(
        sampling_frequency=sf,
        window_length_sec=float(sim_raw.get("window_length_sec", 1.0)),
        duration_sec=float(sim_raw.get("duration_sec", 60.0)),
        noise_level=float(sim_raw.get("noise_level", 0.02)),
    )

    # ── Machine faults ────────────────────────────────────────────────────
    mf_raw = raw.get("machine_faults", {})
    machine_faults = MachineFaultsCfg(
        healthy=bool(mf_raw.get("healthy", True)),
        blade_wear=_parse_fault_entry(mf_raw.get("blade_wear", {})),
        bearing_fault=_parse_fault_entry(mf_raw.get("bearing_fault", {})),
        misalignment=_parse_fault_entry(mf_raw.get("misalignment", {})),
        imbalance=_parse_fault_entry(mf_raw.get("imbalance", {})),
        looseness=_parse_fault_entry(mf_raw.get("looseness", {})),
    )

    # ── Process faults ────────────────────────────────────────────────────
    pf_raw = raw.get("process_faults", {})
    process_faults = ProcessFaultsCfg(
        material_buildup=_parse_fault_entry(pf_raw.get("material_buildup", {})),
        partial_clogging=_parse_fault_entry(pf_raw.get("partial_clogging", {})),
        choking=_parse_fault_entry(pf_raw.get("choking", {})),
    )

    # ── Output ────────────────────────────────────────────────────────────
    out_raw = raw.get("output", {})
    output = OutputCfg(
        csv=bool(out_raw.get("csv", True)),
        json=bool(out_raw.get("json", True)),
        mat=bool(out_raw.get("mat", False)),
    )

    return ControlConfig(
        machine=machine,
        signals=signals,
        simulation=simulation,
        machine_faults=machine_faults,
        process_faults=process_faults,
        output=output,
    )


# ---------------------------------------------------------------------------
# Bridge: ControlConfig → PulveriserConfig
# ---------------------------------------------------------------------------

def control_to_pulveriser_config(ctrl: ControlConfig):
    """
    Convert a ``ControlConfig`` (from the UI) to the internal ``PulveriserConfig``.

    This is the bridge between the UI → backend contract (Section 5) and the
    internal Parameter JSON layer (Section 6–10 model constants).

    Signal generator parameters (k1, k2, Ri, m, fm, etc.) are set to their
    default values here; ``parameter_mapper.apply_parameters()`` should be
    called after this to inject the severity-derived values.

    Args:
        ctrl: Parsed ControlConfig from the Control Panel.

    Returns:
        PulveriserConfig ready for use by PulveriserSimulator.
    """
    # Import here to avoid circular import
    from .config import (
        PulveriserConfig, MachineConfig, SeverityConfig,
        VibrationConfig, VibrationHealthyConfig, VibrationNoiseConfig,
        CurrentConfig, CurrentHealthyConfig, CurrentNoiseConfig,
        TemperatureConfig, TemperatureHealthyConfig,
        ProcessKPIConfig, CycleTimeKPIConfig,
    )

    mf = ctrl.machine_faults
    pf = ctrl.process_faults

    # ── Machine ──────────────────────────────────────────────────────────
    machine = MachineConfig(
        machine_id="PULV001",
        machine_type=ctrl.machine.machine_name,
        motor_power_kw=ctrl.machine.motor_rating_kw,
        rpm=ctrl.machine.motor_speed_rpm,
        shaft_frequency=ctrl.machine.rotor_frequency_hz,
        sampling_frequency=ctrl.simulation.sampling_frequency.vibration,
        window_size=int(
            ctrl.simulation.sampling_frequency.vibration
            * ctrl.simulation.window_length_sec
        ),
    )

    # ── Severity (0–1 fractions from 0–100% UI sliders) ─────────────────
    severity = SeverityConfig(
        blade_wear=mf.blade_wear.severity_fraction if mf.blade_wear.enabled else 0.0,
        bearing_fault=mf.bearing_fault.severity_fraction if mf.bearing_fault.enabled else 0.0,
        imbalance=mf.imbalance.severity_fraction if mf.imbalance.enabled else 0.0,
        misalignment=mf.misalignment.severity_fraction if mf.misalignment.enabled else 0.0,
        looseness=mf.looseness.severity_fraction if mf.looseness.enabled else 0.0,
        material_buildup=pf.material_buildup.severity_fraction if pf.material_buildup.enabled else 0.0,
        partial_clogging=pf.partial_clogging.severity_fraction if pf.partial_clogging.enabled else 0.0,
        choking=pf.choking.severity_fraction if pf.choking.enabled else 0.0,
    )

    # ── Vibration ────────────────────────────────────────────────────────
    nl = ctrl.simulation.noise_level
    vib_healthy = VibrationHealthyConfig(
        A0=0.30, B0=0.60,
        fr=ctrl.machine.rotor_frequency_hz,
        fg=ctrl.machine.grinding_frequency_hz,
    )
    vib_noise = VibrationNoiseConfig(
        white_std=nl * 1.0,          # noise_level directly maps to white noise std
        pink_level=nl * 0.5,
        brown_level=nl * 0.25,
    )
    vibration = VibrationConfig(
        healthy=vib_healthy,
        blade_wear={"k1": 3.5e-5, "k2": 4.5e-5},
        bearing_fault={"enable": mf.bearing_fault.enabled, "fault_frequency": 220.0,
                       "Ri_min": 0.5, "Ri_max": 2.5, "impulse_width": 0.002},
        imbalance={"enable": mf.imbalance.enabled, "Aimb": 0.25},
        misalignment={"enable": mf.misalignment.enabled, "A1": 0.24, "A2": 0.12},
        looseness={"enable": mf.looseness.enabled, "Ri_min": 0.5, "Ri_max": 3.0, "impact_rate": 50},
        material_buildup={"enable": pf.material_buildup.enabled, "Kb": 0.15, "fb": 0.75},
        partial_clogging={"enable": pf.partial_clogging.enabled, "Kc": 0.0001, "fc": 0.0},
        choking={"enable": pf.choking.enabled, "Kc": 0.0009, "fc": 1.20, "spike_amp": 1.5},
        noise=vib_noise,
    )

    # ── Current ───────────────────────────────────────────────────────────
    current = CurrentConfig(
        healthy=CurrentHealthyConfig(Ibase=5.0, DeltaIload=0.15, supply_frequency=50.0),
        blade_wear={"enable": mf.blade_wear.enabled, "Kd": 0.003},
        bearing_fault={"enable": mf.bearing_fault.enabled, "modulation_index": 0.05,
                       "fault_frequency": 220.0, "Ri_min": 0.05, "Ri_max": 0.40},
        imbalance={"enable": mf.imbalance.enabled, "modulation_index": 0.06},
        misalignment={"enable": mf.misalignment.enabled, "m1": 0.05, "m2": 0.03},
        material_buildup={"enable": pf.material_buildup.enabled, "Kb": 0.001, "modulation": 0.10, "frequency": 0.20},
        partial_clogging={"enable": pf.partial_clogging.enabled, "Kc": 0.002, "modulation": 0.03, "frequency": 0.10},
        choking={"enable": pf.choking.enabled, "Kc": 0.010, "modulation": 0.08, "frequency": 0.50, "spike_amp": 0.30},
        noise=CurrentNoiseConfig(std=nl * 2.5),
    )

    # ── Temperature ───────────────────────────────────────────────────────
    temperature = TemperatureConfig(
        healthy=TemperatureHealthyConfig(
            ambient=30.0, load_rise=5.0,
            variation_amp=0.6, variation_frequency=0.0007, noise_std=0.02,
        ),
        blade_wear={"enable": mf.blade_wear.enabled, "kwear": 0.0002},
        bearing_fault={"enable": mf.bearing_fault.enabled, "kbearing": 0.001},
        material_buildup={"enable": pf.material_buildup.enabled, "kbuildup": 0.002},
        partial_clogging={"enable": pf.partial_clogging.enabled, "kpc": 0.005},
        choking={"enable": pf.choking.enabled, "kchoke": 0.010},
    )

    # ── Process KPI ───────────────────────────────────────────────────────
    process_kpi = ProcessKPIConfig(
        batch_mass=1.0,
        cycle_time=CycleTimeKPIConfig(
            base=60.0, wear_coeff=30.0, bearing_coeff=10.0,
            load_coeff=10.0, buildup_coeff=8.0,
            clogging_coeff=20.0, choking_coeff=60.0,
        ),
    )

    return PulveriserConfig(
        machine=machine,
        severity=severity,
        vibration=vibration,
        current=current,
        temperature=temperature,
        process_kpi=process_kpi,
    )


# ---------------------------------------------------------------------------
# Default Control JSON (matches spec Section 5 example)
# ---------------------------------------------------------------------------

DEFAULT_CONTROL_JSON: Dict[str, Any] = {
    "machine": {
        "machine_name": "Food Pulverizer",
        "motor_rating_kw": 7.5,
        "motor_speed_rpm": 3000,
        "rotor_frequency_hz": 50.0,
        "grinding_frequency_hz": 300.0,
    },
    "signals": {
        "vibration": True,
        "current": True,
        "temperature": True,
    },
    "simulation": {
        "sampling_frequency": {"vibration": 5000, "current": 1000, "temperature": 1},
        "window_length_sec": 1,
        "duration_sec": 60,
        "noise_level": 0.02,
    },
    "machine_faults": {
        "healthy": True,
        "blade_wear":    {"enabled": False, "severity": 0},
        "bearing_fault": {"enabled": False, "severity": 0},
        "misalignment":  {"enabled": False, "severity": 0},
        "imbalance":     {"enabled": False, "severity": 0},
        "looseness":     {"enabled": False, "severity": 0},
    },
    "process_faults": {
        "material_buildup": {"enabled": False, "severity": 0},
        "partial_clogging": {"enabled": False, "severity": 0},
        "choking":          {"enabled": False, "severity": 0},
    },
    "output": {
        "csv": True,
        "json": True,
        "mat": False,
    },
}

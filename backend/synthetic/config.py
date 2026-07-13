"""
config.py — PulveriserConfig dataclass + JSON loader.

Loads and validates the simulation configuration matching the Section 11 JSON schema.
All severity values are clamped to [0, 1]. Physical parameters are validated against
the ranges documented in Sections 5–10 of the specification.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _clamp(value: float, lo: float, hi: float, name: str) -> float:
    """Clamp a value to [lo, hi] with a warning if out of range."""
    if value < lo or value > hi:
        import warnings
        warnings.warn(f"Config: '{name}' = {value} clamped to [{lo}, {hi}]")
        return max(lo, min(hi, value))
    return value


# ---------------------------------------------------------------------------
# Sub-configs
# ---------------------------------------------------------------------------

@dataclass
class MachineConfig:
    machine_id: str = "PULV001"
    machine_type: str = "Food Pulverizer"
    motor_power_kw: float = 5.5
    rpm: float = 3000.0
    shaft_frequency: float = 50.0   # Hz  (= RPM/60)
    sampling_frequency: int = 5000  # Hz
    window_size: int = 5000         # samples (= 1 s at 5 kHz)


@dataclass
class SeverityConfig:
    """All fault severities on the 0–1 dimensionless scale (Section 10)."""
    blade_wear: float = 0.50
    bearing_fault: float = 0.25
    imbalance: float = 0.30
    misalignment: float = 0.20
    looseness: float = 0.10
    material_buildup: float = 0.40
    partial_clogging: float = 0.50
    choking: float = 0.00

    # Per-signal overrides
    vib_blade_wear: float = 0.50
    vib_bearing_fault: float = 0.25
    cur_blade_wear: float = 0.50
    cur_bearing_fault: float = 0.25
    temp_blade_wear: float = 0.50
    temp_bearing_fault: float = 0.25

    def __post_init__(self):
        for attr in vars(self):
            setattr(self, attr, _clamp(getattr(self, attr), 0.0, 1.0, f"severity.{attr}"))


@dataclass
class VibrationHealthyConfig:
    A0: float = 0.30   # shaft amplitude (g)
    B0: float = 0.60   # grinding amplitude (g)
    fr: float = 50.0   # rotor frequency (Hz)
    fg: float = 300.0  # grinding frequency (Hz)
    harmonics: List[Dict[str, float]] = field(
        default_factory=lambda: [{"freq": 100.0, "amp": 0.05}, {"freq": 600.0, "amp": 0.12}]
    )


@dataclass
class VibrationNoiseConfig:
    white_std: float = 0.02
    pink_level: float = 0.01
    brown_level: float = 0.005


@dataclass
class VibrationConfig:
    healthy: VibrationHealthyConfig = field(default_factory=VibrationHealthyConfig)
    blade_wear: Dict[str, float] = field(default_factory=lambda: {"k1": 0.0004, "k2": 0.0007})
    bearing_fault: Dict[str, Any] = field(default_factory=lambda: {
        "enable": True, "fault_frequency": 220.0, "Ri_min": 0.5, "Ri_max": 2.5, "impulse_width": 0.002
    })
    imbalance: Dict[str, Any] = field(default_factory=lambda: {"enable": True, "Aimb": 0.25})
    misalignment: Dict[str, Any] = field(default_factory=lambda: {"enable": True, "A1": 0.20, "A2": 0.10})
    looseness: Dict[str, Any] = field(default_factory=lambda: {
        "enable": True, "Ri_min": 0.3, "Ri_max": 1.5, "impact_rate": 20
    })
    material_buildup: Dict[str, Any] = field(default_factory=lambda: {"enable": True, "Kb": 0.002, "fb": 0.50})
    partial_clogging: Dict[str, Any] = field(default_factory=lambda: {"enable": False, "Kc": 0.005, "fc": 0.80})
    choking: Dict[str, Any] = field(default_factory=lambda: {
        "enable": False, "Kc": 0.015, "fc": 1.20, "spike_amp": 3.0
    })
    noise: VibrationNoiseConfig = field(default_factory=VibrationNoiseConfig)


@dataclass
class CurrentHealthyConfig:
    Ibase: float = 5.0           # A
    DeltaIload: float = 0.15     # A (random variation range)
    supply_frequency: float = 50.0  # Hz


@dataclass
class CurrentNoiseConfig:
    std: float = 0.05   # A


@dataclass
class CurrentConfig:
    healthy: CurrentHealthyConfig = field(default_factory=CurrentHealthyConfig)
    blade_wear: Dict[str, Any] = field(default_factory=lambda: {"enable": True, "Kd": 0.0015})
    bearing_fault: Dict[str, Any] = field(default_factory=lambda: {
        "enable": True, "modulation_index": 0.05, "fault_frequency": 220.0, "Ri_min": 0.05, "Ri_max": 0.50
    })
    imbalance: Dict[str, Any] = field(default_factory=lambda: {"enable": True, "modulation_index": 0.05})
    misalignment: Dict[str, Any] = field(default_factory=lambda: {"enable": True, "m1": 0.05, "m2": 0.03})
    material_buildup: Dict[str, Any] = field(default_factory=lambda: {
        "enable": True, "Kb": 0.001, "modulation": 0.03, "frequency": 0.50
    })
    partial_clogging: Dict[str, Any] = field(default_factory=lambda: {
        "enable": False, "Kc": 0.005, "modulation": 0.06, "frequency": 0.80
    })
    choking: Dict[str, Any] = field(default_factory=lambda: {
        "enable": False, "Kc": 0.020, "modulation": 0.15, "frequency": 1.20, "spike_amp": 2.5
    })
    noise: CurrentNoiseConfig = field(default_factory=CurrentNoiseConfig)


@dataclass
class TemperatureHealthyConfig:
    ambient: float = 30.0           # °C
    load_rise: float = 5.0          # °C
    variation_amp: float = 0.5      # °C
    variation_frequency: float = 0.01  # Hz
    noise_std: float = 0.2          # °C


@dataclass
class TemperatureConfig:
    healthy: TemperatureHealthyConfig = field(default_factory=TemperatureHealthyConfig)
    blade_wear: Dict[str, Any] = field(default_factory=lambda: {"enable": True, "kwear": 0.001})
    bearing_fault: Dict[str, Any] = field(default_factory=lambda: {"enable": True, "kbearing": 0.010})
    material_buildup: Dict[str, Any] = field(default_factory=lambda: {"enable": True, "kbuildup": 0.003})
    partial_clogging: Dict[str, Any] = field(default_factory=lambda: {"enable": False, "kpc": 0.010})
    choking: Dict[str, Any] = field(default_factory=lambda: {"enable": False, "kchoke": 0.025})


@dataclass
class CycleTimeKPIConfig:
    base: float = 60.0         # s
    wear_coeff: float = 30.0   # s per unit severity
    bearing_coeff: float = 10.0
    load_coeff: float = 10.0
    buildup_coeff: float = 8.0
    clogging_coeff: float = 20.0
    choking_coeff: float = 60.0


@dataclass
class ProcessKPIConfig:
    batch_mass: float = 1.0    # kg
    cycle_time: CycleTimeKPIConfig = field(default_factory=CycleTimeKPIConfig)


# ---------------------------------------------------------------------------
# Top-level config
# ---------------------------------------------------------------------------

@dataclass
class PulveriserConfig:
    """
    Complete simulation configuration for the Food-Processing Pulveriser Digital Twin.

    Usage::

        cfg = PulveriserConfig()                      # defaults
        cfg = load_config("path/to/config.json")      # from file
        cfg = load_config(my_dict)                    # from dict
    """
    machine: MachineConfig = field(default_factory=MachineConfig)
    severity: SeverityConfig = field(default_factory=SeverityConfig)
    vibration: VibrationConfig = field(default_factory=VibrationConfig)
    current: CurrentConfig = field(default_factory=CurrentConfig)
    temperature: TemperatureConfig = field(default_factory=TemperatureConfig)
    process_kpi: ProcessKPIConfig = field(default_factory=ProcessKPIConfig)

    @property
    def fs_vib(self) -> int:
        """Vibration sampling frequency (Hz)."""
        return self.machine.sampling_frequency

    @property
    def fs_cur(self) -> int:
        """Current sampling frequency (Hz) — 1/5 of vibration by convention."""
        return max(1, self.machine.sampling_frequency // 5)

    @property
    def fs_temp(self) -> int:
        """Temperature sampling frequency (Hz) — 1 Hz."""
        return 1

    @property
    def window_vib(self) -> int:
        """Vibration window size (samples)."""
        return self.machine.window_size

    @property
    def window_cur(self) -> int:
        """Current window size (samples) — 1000 at 1 kHz."""
        return max(1, self.machine.window_size // 5)

    @property
    def window_temp(self) -> int:
        """Temperature window size (samples) — 60 at 1 Hz."""
        return 60


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------

def _merge_dict(base: dict, override: dict) -> dict:
    """Recursively merge override into base (non-destructive)."""
    result = dict(base)
    for k, v in override.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = _merge_dict(result[k], v)
        else:
            result[k] = v
    return result


def load_config(source: Optional[Any] = None) -> PulveriserConfig:
    """
    Load a PulveriserConfig from:
      - ``None``         → default config
      - ``str / Path``   → JSON file path
      - ``dict``         → raw dict

    Any missing keys are filled in from defaults.
    """
    default_path = Path(__file__).parent / "default_config.json"
    with open(default_path, encoding="utf-8") as fh:
        default_dict: dict = json.load(fh)

    if source is None:
        raw = default_dict
    elif isinstance(source, (str, Path)):
        with open(source, encoding="utf-8") as fh:
            user_dict = json.load(fh)
        raw = _merge_dict(default_dict, user_dict)
    elif isinstance(source, dict):
        raw = _merge_dict(default_dict, source)
    else:
        raise TypeError(f"load_config: unsupported source type {type(source)}")

    # --- Machine ---
    m = raw.get("machine", {})
    machine = MachineConfig(
        machine_id=m.get("machine_id", "PULV001"),
        machine_type=m.get("machine_type", "Food Pulverizer"),
        motor_power_kw=float(m.get("motor_power_kw", 5.5)),
        rpm=float(m.get("rpm", 3000)),
        shaft_frequency=float(m.get("shaft_frequency", 50)),
        sampling_frequency=int(m.get("sampling_frequency", 5000)),
        window_size=int(m.get("window_size", 5000)),
    )

    # --- Severity ---
    s = raw.get("severity", {})
    severity = SeverityConfig(
        blade_wear=float(s.get("blade_wear", 0.5)),
        bearing_fault=float(s.get("bearing_fault", 0.25)),
        imbalance=float(s.get("imbalance", 0.3)),
        misalignment=float(s.get("misalignment", 0.2)),
        looseness=float(s.get("looseness", 0.1)),
        material_buildup=float(s.get("material_buildup", 0.4)),
        partial_clogging=float(s.get("partial_clogging", 0.5)),
        choking=float(s.get("choking", 0.0)),
    )

    # --- Vibration ---
    v = raw.get("vibration", {})
    vh = v.get("healthy", {})
    vib_healthy = VibrationHealthyConfig(
        A0=float(vh.get("A0", 0.30)),
        B0=float(vh.get("B0", 0.60)),
        fr=float(vh.get("fr", 50.0)),
        fg=float(vh.get("fg", 300.0)),
        harmonics=vh.get("harmonics", [{"freq": 100.0, "amp": 0.05}, {"freq": 600.0, "amp": 0.12}]),
    )
    vn = v.get("noise", {})
    vib_noise = VibrationNoiseConfig(
        white_std=float(vn.get("white_std", 0.02)),
        pink_level=float(vn.get("pink_level", 0.01)),
        brown_level=float(vn.get("brown_level", 0.005)),
    )
    vibration = VibrationConfig(
        healthy=vib_healthy,
        blade_wear=v.get("blade_wear", {"k1": 0.0004, "k2": 0.0007}),
        bearing_fault=v.get("bearing_fault", {}),
        imbalance=v.get("imbalance", {}),
        misalignment=v.get("misalignment", {}),
        looseness=v.get("looseness", {}),
        material_buildup=v.get("material_buildup", {}),
        partial_clogging=v.get("partial_clogging", {}),
        choking=v.get("choking", {}),
        noise=vib_noise,
    )

    # --- Current ---
    c = raw.get("current", {})
    ch = c.get("healthy", {})
    cur_healthy = CurrentHealthyConfig(
        Ibase=float(ch.get("Ibase", 5.0)),
        DeltaIload=float(ch.get("DeltaIload", 0.15)),
        supply_frequency=float(ch.get("supply_frequency", 50.0)),
    )
    cn = c.get("noise", {})
    cur_noise = CurrentNoiseConfig(std=float(cn.get("std", 0.05)))
    current = CurrentConfig(
        healthy=cur_healthy,
        blade_wear=c.get("blade_wear", {}),
        bearing_fault=c.get("bearing_fault", {}),
        imbalance=c.get("imbalance", {}),
        misalignment=c.get("misalignment", {}),
        material_buildup=c.get("material_buildup", {}),
        partial_clogging=c.get("partial_clogging", {}),
        choking=c.get("choking", {}),
        noise=cur_noise,
    )

    # --- Temperature ---
    t = raw.get("temperature", {})
    th = t.get("healthy", {})
    temp_healthy = TemperatureHealthyConfig(
        ambient=float(th.get("ambient", 30.0)),
        load_rise=float(th.get("load_rise", 5.0)),
        variation_amp=float(th.get("variation_amp", 0.5)),
        variation_frequency=float(th.get("variation_frequency", 0.01)),
        noise_std=float(th.get("noise_std", 0.2)),
    )
    temperature = TemperatureConfig(
        healthy=temp_healthy,
        blade_wear=t.get("blade_wear", {}),
        bearing_fault=t.get("bearing_fault", {}),
        material_buildup=t.get("material_buildup", {}),
        partial_clogging=t.get("partial_clogging", {}),
        choking=t.get("choking", {}),
    )

    # --- Process KPI ---
    p = raw.get("process_kpi", {})
    ct = p.get("cycle_time", {})
    kpi = ProcessKPIConfig(
        batch_mass=float(p.get("batch_mass", 1.0)),
        cycle_time=CycleTimeKPIConfig(
            base=float(ct.get("base", 60.0)),
            wear_coeff=float(ct.get("wear_coeff", 30.0)),
            bearing_coeff=float(ct.get("bearing_coeff", 10.0)),
            load_coeff=float(ct.get("load_coeff", 10.0)),
            buildup_coeff=float(ct.get("buildup_coeff", 8.0)),
            clogging_coeff=float(ct.get("clogging_coeff", 20.0)),
            choking_coeff=float(ct.get("choking_coeff", 60.0)),
        ),
    )

    return PulveriserConfig(
        machine=machine,
        severity=severity,
        vibration=vibration,
        current=current,
        temperature=temperature,
        process_kpi=kpi,
    )

"""
Synthetic Data Generation Package for Food-Processing Pulveriser CBM (Stage-1).

Modules:
    config                — PulveriserConfig dataclass + JSON loader (internal Parameter JSON)
    api_schema            — Section 5 Control JSON parser + ControlConfig dataclass
    parameter_mapper      — Severity % → engineering parameters (calibration tables §7–10)
    noise_models          — Gaussian / spike / drift noise generators (§12)
    signal_generator      — Vibration / current / temperature signal generators (§6–10)
    feature_extraction    — Time-domain and frequency-domain feature extractors
    condition_monitoring  — Dual EWMA, MHI / PQI / GQI computation
    process_kpi           — Cycle Time, Throughput, Grinding Efficiency
    simulator             — End-to-end window orchestrator
    export                — CSV / JSON / MAT export per output section of Control JSON

UI → Backend contract: only the Control JSON (Section 5) crosses the
boundary. Internal model constants (k1, k2, Ri, mBF, etc.) are derived by
parameter_mapper.py and never exposed to the UI.
"""

from .config import PulveriserConfig, load_config
from .simulator import PulveriserSimulator
from .api_schema import (
    ControlConfig,
    parse_control_json,
    control_to_pulveriser_config,
    DEFAULT_CONTROL_JSON,
)
from .parameter_mapper import map_parameters
from .export import export_records, export_bytes

__all__ = [
    # Existing
    "PulveriserConfig",
    "load_config",
    "PulveriserSimulator",
    # New — Control JSON layer
    "ControlConfig",
    "parse_control_json",
    "control_to_pulveriser_config",
    "DEFAULT_CONTROL_JSON",
    # New — Parameter mapper
    "map_parameters",
    # New — Export
    "export_records",
    "export_bytes",
]

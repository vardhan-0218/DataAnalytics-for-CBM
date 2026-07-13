# Pulveriser Digital Twin — Synthetic Data Generator (Stage-1)

A complete DSP-based synthetic data generator for a food-processing pulveriser,
implementing vibration, motor current, and temperature signal generation under
healthy and multiple fault conditions, with feature extraction, health indices,
and process KPIs.

---

## Quick Start

```bash
cd backend

# Install dependencies (if not already installed)
pip install numpy scipy fastapi uvicorn pydantic

# Run CLI — healthy condition, 10 windows
python -m synthetic.main --condition healthy --windows 10

# Run CLI — bearing fault at moderate severity
python -m synthetic.main --condition bearing --severity moderate --windows 20

# Run CLI — multiple simultaneous faults (composable)
python -m synthetic.main --condition combined --windows 30 --output results.json

# Run unit tests
python -m pytest synthetic/tests/test_features.py -v
```

---

## Module Overview

```
backend/synthetic/
├── __init__.py             — Package init
├── config.py               — PulveriserConfig dataclass + JSON loader
├── noise_models.py         — Gaussian / spike / drift noise generators
├── signal_generator.py     — Vibration / current / temperature generators
├── feature_extraction.py   — Time-domain + frequency-domain features
├── condition_monitoring.py — Dual EWMA, MHI/PQI/GQI computation
├── process_kpi.py          — Cycle Time, Throughput, Grinding Efficiency
├── simulator.py            — Full pipeline orchestrator
├── main.py                 — CLI interface
├── default_config.json     — Default configuration (Section 11 schema)
└── tests/
    └── test_features.py    — Acceptance-criteria unit tests
```

---

## Configuration Schema

The configuration file follows the schema in Section 11 of the specification.
Load it from a file or a Python dict:

```python
from synthetic.config import load_config

cfg = load_config()                          # defaults
cfg = load_config("my_config.json")          # from file
cfg = load_config({"severity": {"blade_wear": 0.75}})  # from dict
```

### Severity Scale (Section 10)

All fault severities are dimensionless values in [0, 1]:

| Label | Value | Meaning |
|---|---|---|
| Healthy | 0.00 | No fault |
| Very Mild | 0.10 | Early degradation |
| Mild | 0.25 | Fault detectable |
| Moderate | 0.50 | Performance degradation |
| Severe | 0.75 | Significant degradation |
| Critical | 1.00 | Near failure |

### Per-fault Severity Mapping

| Fault | 0.00 | 0.25 | 0.50 | 0.75 | 1.00 |
|---|---|---|---|---|---|
| Blade Wear | Healthy | 25% wear | 50% wear | 75% wear | 100% wear |
| Bearing Fault | Healthy | Small pit | Medium pit | Large pit | Spalling |
| Material Build-up | None | Light | Moderate | Heavy | Extreme |
| Partial Clogging | None | 20% block | 40% | 60% | 80% |
| Choking | Healthy | Beginning | Serious | Near Stall | Motor Stall |

---

## Fault Models and Feature Effects

| Fault | Vib RMS | Kurtosis | Crest Factor | Spectral Centroid | Current RMS | Temperature | Throughput |
|---|---|---|---|---|---|---|---|
| Healthy | 0.3–0.8 g | 2.8–3.2 | 2.5–3.5 | Stable | 5 A | 35–40 °C | Normal |
| Blade Wear | ↑ | slight ↑ | slight ↑ | ↓ | ↑ | ↑ | ↓ |
| Bearing Fault | ↑ | ↑↑↑ | ↑↑ | stable | slight ↑ | ↑ | ≈ |
| Rotor Imbalance | ↑ | ≈ | ≈ | ↑ (1× shaft) | ↑ | ≈ | ≈ |
| Misalignment | ↑ | slight ↑ | slight ↑ | ↑ | ↑ | ≈ | ≈ |
| Material Build-up | fluctuates | ≈ | ≈ | slight ↓ | ↑ | ↑ | ↓ |
| Partial Clogging | ↑ | ≈ | ≈ | ↓ | ↑↑ | ↑↑ | ↓↓ |
| Choking | ↑↑ | ↑↑↑ | ↑↑↑ | ↓ | ↑↑↑ | ↑↑↑ | ≈ 0 |

---

## API Endpoints (mounted on the FastAPI server)

The synthetic router is automatically mounted when `main_server.py` starts:

```bash
cd backend
uvicorn main_server:app --reload --port 8000
```

| Endpoint | Method | Description |
|---|---|---|
| `/api/synthetic/status` | GET | Current simulator state |
| `/api/synthetic/presets` | GET | List condition presets + severity levels |
| `/api/synthetic/configure` | POST | Set severity values + load ratio |
| `/api/synthetic/preset?condition=bearing` | POST | Apply named preset |
| `/api/synthetic/generate` | GET | Generate one window (full JSON) |
| `/api/synthetic/signal?signal_type=vibration` | GET | Signal samples for display |
| `/api/synthetic/health` | GET | MHI/PQI/GQI + alarms (no signals) |
| `/api/synthetic/reset` | POST | Reset window counter + EWMA |

---

## Health Indices

| Index | Meaning | Healthy | Warning | Critical |
|---|---|---|---|---|
| MHI | Machine Health Index | > 85 | 70–85 | < 70 |
| PQI | Process Quality Index | > 85 | 70–85 | < 70 |
| GQI | Grinding Quality Index | > 85 | 70–85 | < 70 |

Alarm tiers:
- **NORMAL**: all indices ≥ 85
- **EARLY**: any index < 85 (predictive — maintenance soon)
- **MID**: any index < 70 (increased monitoring)
- **LATE**: any index < 55 (immediate action required)

---

## Process KPIs

```
Cycle Time  CT  = 60 + 30×Swear + 10×Sbearing + 10×(Load/Rated)
                     + 8×Sbuild + 20×SPC + 60×Schoke  (seconds)

Throughput  TP  = (M_batch / CT) × 3600              (kg/hr)

Grinding Efficiency = (TP × E_ref) / (P_motor × 3600) (dimensionless)
```

---

## Running Unit Tests

```bash
cd backend
python -m pytest synthetic/tests/test_features.py -v --tb=short
```

Tests cover all Section 13 acceptance criteria:
- ✅ Healthy: RMS 0.3–0.8 g, Kurtosis 2.8–3.2, MHI ≥ 70
- ✅ Bearing fault: Kurtosis ↑, Crest Factor ↑ vs healthy
- ✅ Blade wear: Current RMS ↑ after 50 windows of evolution
- ✅ Choking: Throughput ↓ and Cycle Time ↑ vs healthy
- ✅ Combined faults: RMS ≥ max single-fault RMS
- ✅ Severity monotonicity: higher severity → worse indicators
- ✅ Output schema: all required keys, valid ranges

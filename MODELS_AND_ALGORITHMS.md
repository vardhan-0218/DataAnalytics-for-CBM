# Models and Algorithms Used in Motor Wear Simulation Project

## Overview
This project implements a **real-time motor degradation monitoring system** using statistical process control and predictive maintenance algorithms. The system simulates motor wear over time and uses EWMA (Exponentially Weighted Moving Average) control charts to detect anomalies and predict failures.

---

## 1. Motor Degradation Simulation Model

### Location
`backend/data_generation.py` - `MotorSimulator` class

### Algorithm Description
The motor degradation model simulates realistic motor current behavior over time, incorporating:

#### Core Physics Model
```
motor_current = I_base + degradation + noise
```

Where:
- **I_base**: Baseline motor current (initial: 5.0 A)
- **degradation**: Cumulative wear-driven current increase
- **noise**: Gaussian noise with time-varying variance

#### Degradation Accumulation
```
degradation = wear_rate × (t - t_prev)
```

- **wear_rate**: Rate of degradation per cycle (A/cycle)
- **t**: Current simulation time step
- **t_prev**: Reference time for degradation calculation

#### Noise Model (Heteroscedastic)
```
sigma_noise = SIGMA_INIT + (k_noise × degradation)
noise ~ N(0, sigma_noise)
```

- **SIGMA_INIT**: Base noise standard deviation (0.1 A)
- **k_noise**: Noise sensitivity factor (0.25)
- As degradation increases, noise variance grows (realistic motor behavior)

#### Cycle Time Proxy
```
cycle_time = CT_BASE + CT_K × (motor_current - I_BASE_INIT)
```

- **CT_BASE**: Baseline cycle time (2.0 s)
- **CT_K**: Cycle time sensitivity (0.1)
- Models the fact that degraded motors take longer to complete cycles

### Key Features
- **State-based simulation**: Maintains continuous state across time steps
- **Interrupt handling**: Supports dynamic wear rate changes
- **Reset mechanism**: Detects wear rate reductions and resets to initial state
- **Deterministic seeding**: Uses fixed random seed (42) for reproducibility

---

## 2. EWMA (Exponentially Weighted Moving Average) Control Chart

### Location
`backend/analysis.py` - `AlertSystem` class

### Algorithm Description
EWMA is a statistical process control technique that gives more weight to recent observations while maintaining memory of historical data.

#### EWMA Formula
```
EWMA(t) = α × X(t) + (1 - α) × EWMA(t-1)
```

Where:
- **α (alpha)**: Smoothing parameter (0.1)
  - Lower α = more smoothing, slower response
  - Higher α = less smoothing, faster response
- **X(t)**: Current motor current observation
- **EWMA(t-1)**: Previous EWMA value

#### Initial Condition
```
EWMA(0) = μ (healthy motor mean = 5.0 A)
```

### Why EWMA?
- **Sensitive to small shifts**: Detects gradual degradation better than simple moving averages
- **Memory effect**: Incorporates historical trends
- **Low computational cost**: Only requires previous EWMA value
- **Industry standard**: Widely used in manufacturing quality control

---

## 3. Control Limits (Statistical Thresholds)

### Location
`backend/analysis.py` - `Config` class

### Algorithm Description
Control limits define the boundaries for normal vs. abnormal motor behavior.

#### Upper Control Limits (UCL)
```
UCL_2σ = μ + 2σ = 5.0 + 2(0.25) = 5.5 A
UCL_3σ = μ + 3σ = 5.0 + 3(0.25) = 5.75 A
```

Where:
- **μ (MU)**: Healthy motor mean current (5.0 A)
- **σ (SIGMA)**: Standard deviation (0.25 A)

### Statistical Interpretation
- **2σ limit**: ~95% of healthy motor readings fall below this
- **3σ limit**: ~99.7% of healthy motor readings fall below this
- Exceeding these limits indicates statistically significant degradation

---

## 4. Multi-Tier Alert System

### Location
`backend/analysis.py` - `AlertSystem.process()` method

### Algorithm Description
Three-tier alert system with compound conditions for each tier.

#### Tier 1: EARLY WARNING (Preventive)
```
Conditions (ALL must be true):
1. EWMA < UCL_2σ
2. slope > S_EARLY (0.005)
3. variance < VAR_STABLE (0.05)
```

**Interpretation**: Motor is still within normal range but showing early signs of degradation with stable variance.

#### Tier 2: MID-LEVEL ALERT (Caution)
```
Conditions (ALL must be true):
1. EWMA > UCL_2σ
2. slope > S_MID (0.01)
3. cycle_time > CT_EARLY_THRESHOLD (2.06 s)
```

**Interpretation**: Motor has crossed into abnormal range with confirmed degradation trend and performance impact.

#### Tier 3: LATE/CRITICAL ALERT (Emergency)
```
Conditions (ALL must be true):
1. EWMA > UCL_3σ
2. slope > S_LATE (0.02)
3. cycle_time > CT_LATE_THRESHOLD (2.10 s)
```

**Interpretation**: Severe degradation with high failure risk. Immediate action required.

### Alert State Tracking
- **First trigger time**: Records the simulation time when each alert first activates
- **Continuous monitoring**: Alerts remain active as long as conditions are met
- **No duplicate logging**: Prevents console spam by logging each tier only once

---

## 5. Slope Estimation (Trend Detection)

### Location
`backend/analysis.py` - `AlertSystem.process()` method

### Algorithm Description
Linear slope estimation over a fixed window to detect degradation trends.

#### Slope Formula
```
slope = (EWMA(t) - EWMA(t-k)) / k
```

Where:
- **k**: Window size (10 cycles)
- Positive slope indicates increasing current (degradation)
- Larger slope = faster degradation rate

### Why Slope Matters
- **Trend detection**: Distinguishes gradual degradation from random noise
- **Rate of change**: Quantifies how fast the motor is degrading
- **Predictive power**: Used in time-to-failure estimation

---

## 6. Rolling Variance (Stability Detection)

### Location
`backend/analysis.py` - `AlertSystem.process()` method

### Algorithm Description
Calculates variance over a sliding window to detect noise stability.

#### Variance Formula
```
variance = Var(X[t-49:t])
```

Where:
- **Window size**: 50 samples
- **Minimum samples**: 10 (before calculation starts)

### Purpose
- **Noise characterization**: Stable variance suggests consistent degradation
- **Anomaly detection**: Sudden variance spikes indicate irregular behavior
- **Early warning**: Used in EARLY alert tier to confirm stable degradation pattern

---

## 7. Time-to-Failure Prediction

### Location
`backend/analysis.py` - `AlertSystem.process()` method

### Algorithm Description
Linear extrapolation to estimate remaining operational time.

#### Formula
```
T_fail = (I_THRESHOLD - EWMA(t)) / slope
```

Where:
- **I_THRESHOLD**: Failure threshold (10.0 A)
- **EWMA(t)**: Current EWMA value
- **slope**: Current degradation rate

### Assumptions
- Linear degradation continues at current rate
- No interventions or wear rate changes
- Returns ∞ if slope ≤ 0 (no degradation detected)

### Limitations
- **Linear assumption**: Real degradation may be non-linear
- **Constant rate**: Doesn't account for accelerating wear
- **Best used for**: Short-term predictions when slope is stable

---

## 8. Database Integration (PostgreSQL)

### Location
`backend/analysis.py` - Database helper functions

### Features
- **Real-time polling**: Fetches new readings as they arrive
- **LISTEN/NOTIFY**: Event-driven updates (zero latency)
- **Batch fetching**: Limits queries to last N rows for performance
- **Auto-reconnect**: Handles transient connection failures

### Query Optimization
```sql
-- Efficient incremental fetch
SELECT * FROM simulation_readings
WHERE run_id = ? AND sim_t > ?
ORDER BY sim_t ASC
LIMIT 200
```

---

## 9. Visualization Algorithms

### Location
`backend/analysis.py` - `LivePlot` class

### Features
- **Rolling window**: Displays last 300 cycles to prevent memory growth
- **Real-time updates**: Matplotlib animation with flush events
- **Alert shading**: Background zones show active alert periods
- **Marker placement**: First-trigger markers at exact EWMA values

### Performance Optimizations
- **Incremental updates**: Only redraws changed data
- **Window limiting**: Prevents unbounded memory usage
- **Cached lookups**: t→EWMA mapping for fast marker placement

---

## 10. API Integration Layer

### Location
`backend/api_server.py`

### Design Pattern
**Wrapper pattern**: Exposes existing simulation and analysis modules via REST API without modifying original code.

### Key Endpoints
- **POST /api/start**: Resets both simulator and alert system
- **GET /api/step**: Advances simulation and runs EWMA analysis
- **GET /api/alerts**: Returns current alert states and history
- **GET /api/ewma-data**: Returns EWMA metrics (slope, variance, etc.)

### State Management
- **Global instances**: Single shared `MotorSimulator` and `AlertSystem`
- **Synchronized state**: Both UIs (React + Streamlit) see same simulation
- **Atomic operations**: Each API call is a complete transaction

---

## Summary of Algorithms

| Algorithm | Type | Purpose | Key Parameters |
|-----------|------|---------|----------------|
| **Motor Degradation Model** | Physics-based simulation | Generate realistic motor current data | wear_rate, k_noise, I_base |
| **EWMA** | Statistical smoothing | Detect gradual shifts in motor current | α = 0.1 |
| **Control Limits** | Statistical thresholds | Define normal vs. abnormal behavior | μ = 5.0, σ = 0.25 |
| **Multi-Tier Alerts** | Rule-based classification | Categorize degradation severity | S_EARLY, S_MID, S_LATE |
| **Slope Estimation** | Linear regression | Quantify degradation rate | k = 10 cycles |
| **Rolling Variance** | Statistical dispersion | Detect noise stability | window = 50 samples |
| **Time-to-Failure** | Linear extrapolation | Predict remaining operational time | I_THRESHOLD = 10.0 A |

---

## Mathematical Foundations

### 1. Gaussian Noise Model
```
N(μ, σ²) - Normal distribution with mean μ and variance σ²
```

### 2. Exponential Smoothing
```
S(t) = α·X(t) + (1-α)·S(t-1)
```

### 3. Sample Variance
```
Var(X) = E[(X - μ)²] = (1/n)·Σ(Xi - X̄)²
```

### 4. Linear Slope
```
m = ΔY/ΔX = (Y₂ - Y₁)/(X₂ - X₁)
```

---

## References

### Statistical Process Control
- Montgomery, D.C. (2012). *Introduction to Statistical Quality Control*
- NIST/SEMATECH e-Handbook of Statistical Methods

### EWMA Control Charts
- Roberts, S.W. (1959). "Control Chart Tests Based on Geometric Moving Averages"
- Lucas, J.M. & Saccucci, M.S. (1990). "Exponentially Weighted Moving Average Control Schemes"

### Predictive Maintenance
- Jardine, A.K.S., Lin, D., & Banjevic, D. (2006). "A review on machinery diagnostics and prognostics"
- IEEE Standards for Condition Monitoring

---

## Implementation Notes

### Performance Characteristics
- **EWMA computation**: O(1) per sample
- **Slope calculation**: O(1) with circular buffer
- **Variance calculation**: O(n) where n = window size (50)
- **Overall complexity**: O(1) per time step

### Scalability
- **Memory usage**: O(window_size) - bounded by rolling windows
- **Database queries**: Batched and indexed for efficiency
- **Real-time capable**: Processes samples as fast as they arrive

### Accuracy Considerations
- **Numerical stability**: Uses float64 for all calculations
- **Rounding**: Results rounded to 4-6 decimal places for API responses
- **Edge cases**: Handles division by zero, empty windows, etc.

---

## Future Enhancements

### Potential Algorithm Improvements
1. **Non-linear trend detection**: Polynomial or exponential fitting
2. **Adaptive thresholds**: Dynamic control limits based on operating conditions
3. **Machine learning**: LSTM/GRU for more accurate failure prediction
4. **Multi-sensor fusion**: Combine current, temperature, vibration data
5. **Bayesian inference**: Probabilistic failure predictions with confidence intervals

### Advanced Statistical Methods
- **CUSUM (Cumulative Sum)**: Alternative to EWMA for shift detection
- **Multivariate control charts**: Monitor multiple parameters simultaneously
- **Change point detection**: Identify exact moment of degradation onset
- **Survival analysis**: Kaplan-Meier estimators for failure time distributions

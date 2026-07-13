"""
FastAPI wrapper for the Motor Simulation backend.

This file provides REST API endpoints that wrap the existing Python simulation
without modifying the original data_generation.py or analysis.py files.

Endpoints:
- POST /api/start - Initialize/reset the simulation
- GET /api/step - Advance simulation by one step and return current state
- POST /api/interrupt - Update wear rate
- POST /api/set-motor-current - Update motor current baseline
- POST /api/set-k-noise - Update noise sensitivity
- POST /api/simulate - Run simulation with all parameters
- POST /api/analyze - Run analysis on simulation data

Run with: uvicorn main_server:app --reload --port 8000
"""

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import sys
import numpy as np
from pathlib import Path
from datetime import datetime

# Import the existing simulation modules WITHOUT modification
from data_generation import MotorSimulator
from analysis import Config as EWMAConfig, AlertSystem

app = FastAPI(title="Motor Simulation API — CBM & Digital Twin")

# ── Synthetic Digital Twin router ─────────────────────────────────────────────
try:
    from synthetic_api import router as synthetic_router
    app.include_router(synthetic_router)
    import logging as _logging
    _logging.getLogger("main_server").info("Synthetic Digital Twin router mounted at /api/synthetic/*")
except Exception as _e:
    import logging as _logging
    _logging.getLogger("main_server").warning(f"Synthetic router not loaded: {_e}")

# CORS middleware for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global simulator instance
simulator = MotorSimulator()

# ─────────────────────────────────────────────────────────────────────────────
# EWMA Alert System (imported from analysis.py)
# ─────────────────────────────────────────────────────────────────────────────

# Global EWMA system - using Config and AlertSystem from analysis.py
ewma_config = EWMAConfig()
alert_system = AlertSystem(ewma_config)


# ─────────────────────────────────────────────────────────────────────────────
# Request/Response Models
# ─────────────────────────────────────────────────────────────────────────────

class SimulateRequest(BaseModel):
    """Request body for /api/simulate endpoint"""
    wear_rate: float = 0.0
    motor_current: Optional[float] = None
    k_noise: Optional[float] = None
    steps: int = 1


class StepResponse(BaseModel):
    """Response for /api/step endpoint"""
    current: float
    wear: float
    noise: float
    t: int
    I_base: float
    degradation: float
    cycle_time: float
    ewma: float  # slow EWMA (baseline)
    ewma_fast: float  # fast EWMA (trend)
    ewma_slow: float  # slow EWMA (same as ewma)
    gap: float  # fast - slow (trend gap)
    slope: float
    variance: float
    alerts: Dict[str, Any]


class EWMADataResponse(BaseModel):
    """Response for /api/ewma-data endpoint"""
    ewma: float  # slow EWMA (baseline)
    ewma_fast: float  # fast EWMA (trend)
    ewma_slow: float  # slow EWMA (same as ewma, for clarity)
    gap: float  # fast - slow (trend gap)
    slope: float
    variance: float
    cycle_time: float
    t_fail: float
    config: Dict[str, float]


class AlertConfigRequest(BaseModel):
    """Request for /api/alert-config endpoint"""
    alpha: Optional[float] = None
    alpha_fast: Optional[float] = None
    alpha_slow: Optional[float] = None
    mu: Optional[float] = None
    sigma: Optional[float] = None
    s_early: Optional[float] = None
    s_mid: Optional[float] = None
    s_late: Optional[float] = None


class AnalysisRequest(BaseModel):
    """Request body for /api/analyze endpoint"""
    I_BASE: float = 5.0
    MU: float = 5.0
    SIGMA: float = 0.25
    S_EARLY: float = 0.005
    S_MID: float = 0.01
    S_LATE: float = 0.02
    VAR_STABLE: float = 0.05
    CT_BASELINE: float = 2.0
    CT_EARLY_PCT: float = 0.03
    CT_LATE_PCT: float = 0.05
    I_THRESHOLD: float = 10.0
    alpha: float = 0.1
    k_noise: float = 0.1


# ─────────────────────────────────────────────────────────────────────────────
# API Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/start")
async def start_simulation():
    """Reset the simulation to initial state"""
    global simulator, alert_system, ewma_config
    
    # Complete system reset
    simulator = MotorSimulator()
    alert_system = AlertSystem(ewma_config)
    
    # Log the reset for debugging
    import logging
    logging.info("[API] System reset - new AlertSystem created with empty history")
    logging.info(f"[API] Alert history after reset: {alert_system.alerts}")
    
    # Ensure all parameters are at initial values
    simulator.set_motor_current(5.0)  # Reset to initial baseline
    simulator.set_k_noise(0.05)       # Reset to initial noise level
    simulator.interrupt(0.0)          # Reset wear rate to 0
    
    return {
        "status": "started", 
        "message": "Simulation reset to initial state",
        "initial_values": {
            "motor_current": 5.0,
            "wear_rate": 0.0,
            "k_noise": 0.05,
            "cycle": 0
        }
    }


@app.get("/api/ewma-data", response_model=EWMADataResponse)
async def get_ewma_data():
    """Get current EWMA calculations, slopes, and variance with dual EWMA support"""
    global alert_system, ewma_config
    
    if not alert_system.ewma_history:
        # Return default values if no data processed yet
        return EWMADataResponse(
            ewma=ewma_config.MU,
            ewma_fast=ewma_config.MU,
            ewma_slow=ewma_config.MU,
            gap=0.0,
            slope=0.0,
            variance=0.0,
            cycle_time=ewma_config.CT_BASELINE,
            t_fail=999999.0,  # Use large number instead of inf
            config={
                "mu": ewma_config.MU,
                "ucl_2sigma": ewma_config.UCL_2SIGMA,
                "ucl_3sigma": ewma_config.UCL_3SIGMA,
                "alpha": ewma_config.alpha,
                "alpha_fast": ewma_config.alpha_fast,
                "alpha_slow": ewma_config.alpha_slow,
            }
        )
    
    # Calculate current values - dual EWMA
    ewma_slow = alert_system._slow  # baseline
    ewma_fast = alert_system._fast  # trend
    gap = ewma_fast - ewma_slow     # trend gap
    ewma = ewma_slow  # for backward compatibility
    
    # Slope over last 10 points (using slow EWMA history)
    k = 10
    slope = (
        (ewma_slow - alert_system.ewma_history[-k]) / k
        if len(alert_system.ewma_history) > k
        else 0.0
    )
    
    # Current variance
    variance = (
        float(np.var(alert_system.variance_window))
        if len(alert_system.variance_window) > 10
        else 0.0
    )
    
    # Cycle time
    cycle_time = ewma_config.CT_BASELINE + 0.2 * (ewma_slow - ewma_config.MU)
    
    # Time to failure
    t_fail = (
        (ewma_config.I_THRESHOLD - ewma_slow) / slope
        if slope > 0
        else 999999.0  # Use large number instead of inf for JSON compatibility
    )
    
    return EWMADataResponse(
        ewma=ewma_slow,
        ewma_fast=ewma_fast,
        ewma_slow=ewma_slow,
        gap=gap,
        slope=slope,
        variance=variance,
        cycle_time=cycle_time,
        t_fail=t_fail,
        config={
            "mu": ewma_config.MU,
            "ucl_2sigma": ewma_config.UCL_2SIGMA,
            "ucl_3sigma": ewma_config.UCL_3SIGMA,
            "alpha": ewma_config.alpha,
            "alpha_fast": ewma_config.alpha_fast,
            "alpha_slow": ewma_config.alpha_slow,
        }
    )


@app.get("/api/alerts")
async def get_alerts():
    """Get current alert states and history"""
    global alert_system
    
    return {
        "status": "success",
        "current_alerts": alert_system.alert_states,
        "alert_history": alert_system.alerts,
        "alert_counts": {
            "early": len(alert_system.alerts["early"]),
            "mid": len(alert_system.alerts["mid"]),
            "late": len(alert_system.alerts["late"]),
        }
    }


@app.post("/api/alert-config")
async def configure_alerts(config: AlertConfigRequest):
    """Configure alert thresholds and EWMA parameters including dual EWMA"""
    global ewma_config, alert_system
    
    # Update configuration
    if config.alpha is not None:
        ewma_config.alpha = config.alpha
    if config.alpha_fast is not None:
        ewma_config.alpha_fast = config.alpha_fast
    if config.alpha_slow is not None:
        ewma_config.alpha_slow = config.alpha_slow
    if config.mu is not None:
        ewma_config.MU = config.mu
        ewma_config.UCL_2SIGMA = config.mu + 2 * ewma_config.SIGMA
        ewma_config.UCL_3SIGMA = config.mu + 3 * ewma_config.SIGMA
    if config.sigma is not None:
        ewma_config.SIGMA = config.sigma
        ewma_config.UCL_2SIGMA = ewma_config.MU + 2 * config.sigma
        ewma_config.UCL_3SIGMA = ewma_config.MU + 3 * config.sigma
    if config.s_early is not None:
        ewma_config.S_EARLY = config.s_early
    if config.s_mid is not None:
        ewma_config.S_MID = config.s_mid
    if config.s_late is not None:
        ewma_config.S_LATE = config.s_late
    
    # Recreate alert system with new config
    alert_system = AlertSystem(ewma_config)
    
    return {
        "status": "success",
        "message": "Alert configuration updated with dual EWMA support",
        "config": {
            "alpha": ewma_config.alpha,
            "alpha_fast": ewma_config.alpha_fast,
            "alpha_slow": ewma_config.alpha_slow,
            "mu": ewma_config.MU,
            "sigma": ewma_config.SIGMA,
            "ucl_2sigma": ewma_config.UCL_2SIGMA,
            "ucl_3sigma": ewma_config.UCL_3SIGMA,
            "s_early": ewma_config.S_EARLY,
            "s_mid": ewma_config.S_MID,
            "s_late": ewma_config.S_LATE,
        }
    }


@app.get("/api/step", response_model=StepResponse)
async def get_step():
    """
    Advance simulation by one step and return current state with dual EWMA analysis.
    
    Returns the latest motor current, wear, noise, dual EWMA calculations, and alert states.
    """
    global simulator, alert_system
    
    # Advance one step
    row = simulator.step()
    
    # Process through EWMA alert system with return_dict=True for API response
    ewma_result = alert_system.process(row["t"], row["motor_current"], return_dict=True)
    
    # Extract dual EWMA values
    ewma_slow = alert_system._slow
    ewma_fast = alert_system._fast
    gap = ewma_fast - ewma_slow
    
    return StepResponse(
        current=row["motor_current"],
        wear=row["degradation"],
        noise=row["noise"],
        t=row["t"],
        I_base=row["I_base"],
        degradation=row["degradation"],
        cycle_time=ewma_result["cycle_time"],
        ewma=ewma_slow,  # backward compatibility
        ewma_fast=ewma_fast,
        ewma_slow=ewma_slow,
        gap=gap,
        slope=ewma_result["slope"],
        variance=ewma_result["variance"],
        alerts=ewma_result["alerts"]
    )


@app.post("/api/emergency-stop")
async def emergency_stop():
    """Emergency stop - immediately reset wear rate to 0 for safety"""
    global simulator
    
    # Emergency stop should immediately set wear rate to 0
    action = simulator.interrupt(0.0)
    
    return {
        "status": "emergency_stop_activated",
        "action": action,
        "wear_rate_reset_to": 0.0,
        "current_time": simulator.t,
        "I_base": simulator.I_base,
        "message": "Emergency stop activated - wear rate reset to safe level"
    }


@app.post("/api/interrupt")
async def interrupt_simulation(rate: float = Query(..., description="New wear rate in A/cycle")):
    """
    Update the wear rate (interrupt event).
    
    This captures the current time and motor current, then applies the new wear rate.
    """
    global simulator
    
    action = simulator.interrupt(rate)
    
    return {
        "status": "success",
        "action": action,
        "new_wear_rate": rate,
        "current_time": simulator.t,
        "I_base": simulator.I_base
    }


@app.post("/api/set-motor-current")
async def set_motor_current(value: float = Query(..., description="Motor current baseline in A")):
    """Update motor current baseline"""
    global simulator
    
    simulator.set_motor_current(value)
    
    return {
        "status": "success",
        "motor_current": value,
        "I_base": simulator.I_base
    }


@app.post("/api/set-k-noise")
async def set_k_noise(value: float = Query(..., description="Noise sensitivity factor")):
    """Update noise sensitivity factor"""
    global simulator
    
    simulator.set_k_noise(value)
    
    return {
        "status": "success",
        "k_noise": value,
        "sigma_noise": simulator.sigma_noise
    }


@app.post("/api/simulate")
async def simulate(request: SimulateRequest):
    """
    Run simulation with specified parameters.
    
    This endpoint allows setting multiple parameters at once and running
    multiple steps in a single request.
    """
    global simulator
    
    # Apply parameters
    if request.motor_current is not None:
        simulator.set_motor_current(request.motor_current)
    
    if request.k_noise is not None:
        simulator.set_k_noise(request.k_noise)
    
    if request.wear_rate != simulator.wear_rate:
        simulator.interrupt(request.wear_rate)
    
    # Run steps
    results = []
    for _ in range(request.steps):
        row = simulator.step()
        results.append({
            "t": row["t"],
            "motor_current": row["motor_current"],
            "degradation": row["degradation"],
            "noise": row["noise"],
            "I_base": row["I_base"],
            "cycle_time": row["cycle_time"]
        })
    
    return {
        "status": "success",
        "steps": len(results),
        "results": results,
        "latest": results[-1] if results else None
    }


@app.get("/api/history")
async def get_history(limit: int = Query(50, description="Number of recent records to return")):
    """Get simulation history"""
    global simulator
    
    history = simulator.history[-limit:] if simulator.history else []
    
    return {
        "status": "success",
        "count": len(history),
        "history": history
    }


@app.get("/api/events")
async def get_events():
    """Get interrupt events log"""
    global simulator
    
    return {
        "status": "success",
        "count": len(simulator.events),
        "events": simulator.events
    }


@app.post("/api/analyze")
async def analyze(request: AnalysisRequest):
    """
    Run EWMA analysis on current simulation data.
    
    This endpoint wraps analysis.py functionality without modifying the original file.
    Note: Full analysis.py integration requires database setup. This is a placeholder
    for future implementation.
    """
    # TODO: Implement analysis.py integration
    # For now, return a placeholder response
    return {
        "status": "not_implemented",
        "message": "Analysis endpoint requires database setup. See analysis.py for full implementation.",
        "config": request.dict()
    }


@app.get("/api/system-status")
async def get_system_status():
    """Get comprehensive system status for integration verification"""
    global simulator, alert_system, ewma_config
    
    # Check all system components
    system_status = {
        "status": "operational",
        "timestamp": datetime.now().isoformat(),
        "components": {
            "simulator": {
                "active": simulator is not None,
                "current_cycle": simulator.t if simulator else 0,
                "wear_rate": simulator.wear_rate if simulator else 0.0,
                "motor_current": simulator.I_base if simulator else 5.0,
                "history_length": len(simulator.history) if simulator else 0,
                "events_count": len(simulator.events) if simulator else 0
            },
            "alert_system": {
                "active": alert_system is not None,
                "ewma_history_length": len(alert_system.ewma_history) if alert_system else 0,
                "current_ewma": alert_system.ewma_prev if alert_system else ewma_config.MU,
                "alert_counts": {
                    "early": len(alert_system.alerts["early"]) if alert_system else 0,
                    "mid": len(alert_system.alerts["mid"]) if alert_system else 0,
                    "late": len(alert_system.alerts["late"]) if alert_system else 0
                },
                "current_alerts": alert_system.alert_states if alert_system else {
                    "early": False, "mid": False, "late": False
                }
            },
            "configuration": {
                "mu": ewma_config.MU,
                "alpha": ewma_config.alpha,
                "ucl_2sigma": ewma_config.UCL_2SIGMA,
                "ucl_3sigma": ewma_config.UCL_3SIGMA
            }
        },
        "integration_check": {
            "all_modules_loaded": all([
                simulator is not None,
                alert_system is not None,
                ewma_config is not None
            ]),
            "real_time_ready": all([
                simulator is not None,
                alert_system is not None,
                len(alert_system.ewma_history) >= 0 if alert_system else True
            ])
        }
    }
    
    return system_status


@app.get("/api/status")
async def get_status():
    """Get current simulation status"""
    global simulator
    
    return {
        "status": "running",
        "current_time": simulator.t,
        "wear_rate": simulator.wear_rate,
        "I_base": simulator.I_base,
        "k_noise": simulator.k_noise,
        "history_length": len(simulator.history),
        "events_count": len(simulator.events)
    }


@app.get("/api/state")
async def get_state():
    """
    Return full simulator state WITHOUT advancing the step.

    Use this for read-only consumers (e.g. Streamlit) that want to
    display the current state without side-effects.
    """
    global simulator

    latest = simulator.history[-1] if simulator.history else None

    return {
        "t": simulator.t,
        "wear_rate": simulator.wear_rate,
        "I_base": simulator.I_base,
        "k_noise": simulator.k_noise,
        "sigma_noise": simulator.sigma_noise,
        "history_length": len(simulator.history),
        "events_count": len(simulator.events),
        "latest": latest,
        "events": simulator.events[-8:],   # last 8 interrupt events
    }


@app.get("/")
async def root():
    """API root endpoint"""
    return {
        "message": "Motor Simulation API",
        "version": "1.0.0",
        "endpoints": {
            "POST /api/start": "Reset simulation",
            "GET /api/step": "Advance one step",
            "POST /api/interrupt": "Update wear rate",
            "POST /api/set-motor-current": "Update motor current",
            "POST /api/set-k-noise": "Update noise sensitivity",
            "POST /api/simulate": "Run simulation with parameters",
            "GET /api/history": "Get simulation history",
            "GET /api/events": "Get interrupt events",
            "GET /api/status": "Get current status"
        }
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

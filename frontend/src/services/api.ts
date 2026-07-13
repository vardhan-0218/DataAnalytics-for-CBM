/**
 * api.ts — Frontend service layer for the Motor Simulation API
 *
 * All functions silently return null on failure so the UI degrades
 * gracefully when the backend is offline.
 */

const BASE_URL = 'http://localhost:8000';

/** Shape of data returned by GET /api/step */
export interface StepData {
  current: number;      // Motor current in Amperes
  wear: number;         // Cumulative wear index
  noise: number;        // Random noise component
  t: number;            // Current simulation time
  I_base: number;       // Current baseline
  degradation: number;  // Degradation amount
  cycle_time: number;   // Cycle time
  ewma: number;         // EWMA value (slow baseline)
  ewma_fast: number;    // Fast EWMA (trend)
  ewma_slow: number;    // Slow EWMA (baseline)
  gap: number;          // fast - slow (trend gap)
  slope: number;        // EWMA slope
  variance: number;     // Rolling variance
  alerts: {             // Alert states
    early: boolean;
    mid: boolean;
    late: boolean;
    early_trigger_time?: number;
    mid_trigger_time?: number;
    late_trigger_time?: number;
  };
}

/** Shape of data returned by GET /api/ewma-data */
export interface EWMAData {
  ewma: number;         // Slow EWMA (baseline)
  ewma_fast: number;    // Fast EWMA (trend)
  ewma_slow: number;    // Slow EWMA (same as ewma)
  gap: number;          // fast - slow (trend gap)
  slope: number;
  variance: number;
  cycle_time: number;
  t_fail: number;
  config: {
    mu: number;
    ucl_2sigma: number;
    ucl_3sigma: number;
    alpha: number;
    alpha_fast: number;
    alpha_slow: number;
  };
}

/** Shape of data returned by GET /api/alerts */
export interface AlertData {
  status: string;
  current_alerts: {
    early: boolean;
    mid: boolean;
    late: boolean;
    early_trigger_time?: number;
    mid_trigger_time?: number;
    late_trigger_time?: number;
  };
  alert_history: {
    early: number[];
    mid: number[];
    late: number[];
  };
  alert_counts: {
    early: number;
    mid: number;
    late: number;
  };
}

/** Configuration for alert thresholds */
export interface AlertConfig {
  alpha?: number;
  alpha_fast?: number;
  alpha_slow?: number;
  mu?: number;
  sigma?: number;
  s_early?: number;
  s_mid?: number;
  s_late?: number;
}

/**
 * POST /api/start — Resets the simulation.
 * Call once when the React app mounts.
 */
export async function startSimulation(): Promise<void> {
  const result = await retryApiCall(async () => {
    const response = await fetch(`${BASE_URL}/api/start`, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response;
  });
  
  if (!result) {
    throw new Error('Failed to start simulation after multiple attempts');
  }
}

/**
 * GET /api/step — Fetches the next simulation tick.
 * Returns null if the backend is unreachable.
 */
export async function getStepData(): Promise<StepData | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/step`);
    if (!res.ok) return null;
    return (await res.json()) as StepData;
  } catch {
    return null;
  }
}

/**
 * POST /api/emergency-stop — Emergency stop with immediate wear rate reset.
 * Returns null if the backend is unreachable.
 */
export async function emergencyStop(): Promise<unknown> {
  try {
    const res = await fetch(`${BASE_URL}/api/emergency-stop`, {
      method: 'POST',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * POST /api/interrupt?rate=<rate> — Updates the wear rate.
 * Returns null if the backend is unreachable.
 */
export async function interruptSimulation(rate: number): Promise<unknown> {
  try {
    const res = await fetch(`${BASE_URL}/api/interrupt?rate=${rate}`, {
      method: 'POST',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * POST /api/set-motor-current?value=<value> — Updates motor current baseline.
 * Returns null if the backend is unreachable.
 */
export async function setMotorCurrent(value: number): Promise<unknown> {
  try {
    const res = await fetch(`${BASE_URL}/api/set-motor-current?value=${value}`, {
      method: 'POST',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * POST /api/set-k-noise?value=<value> — Updates noise sensitivity factor.
 * Returns null if the backend is unreachable.
 */
export async function setKNoise(value: number): Promise<unknown> {
  try {
    const res = await fetch(`${BASE_URL}/api/set-k-noise?value=${value}`, {
      method: 'POST',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * GET /api/history?limit=<n> — Get simulation history.
 * Returns null if the backend is unreachable.
 */
export async function getHistory(limit: number = 50): Promise<any[] | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/history?limit=${limit}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.history;
  } catch {
    return null;
  }
}

/**
 * GET /api/events — Get interrupt events log.
 * Returns null if the backend is unreachable.
 */
export async function getEvents(): Promise<any[] | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/events`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.events;
  } catch {
    return null;
  }
}

/**
 * GET /api/ewma-data — Get EWMA calculations, slopes, and variance.
 * Returns null if the backend is unreachable.
 */
export async function getEWMAData(): Promise<EWMAData | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/ewma-data`);
    if (!res.ok) return null;
    return (await res.json()) as EWMAData;
  } catch {
    return null;
  }
}

/**
 * GET /api/alerts — Get current alert states and history.
 * Returns null if the backend is unreachable.
 */
export async function getAlerts(): Promise<AlertData | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/alerts`);
    if (!res.ok) return null;
    return (await res.json()) as AlertData;
  } catch {
    return null;
  }
}

/**
 * POST /api/alert-config — Configure alert thresholds.
 * Returns null if the backend is unreachable.
 */
export async function configureAlerts(config: AlertConfig): Promise<unknown> {
  try {
    const res = await fetch(`${BASE_URL}/api/alert-config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * POST /api/synthetic/configure — Configure synthetic CBM fault severities and load ratio.
 * Returns null if the backend is unreachable.
 */
export async function configureSynthetic(config: { severity: any; load_ratio?: number }): Promise<unknown> {
  try {
    const res = await fetch(`${BASE_URL}/api/synthetic/configure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * GET /api/synthetic/health — Get synthetic CBM health indices, alarms, and KPIs.
 * Returns null if the backend is unreachable.
 */
export async function getSyntheticHealth(): Promise<any | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/synthetic/health`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * GET /api/synthetic/history?limit=<limit> — Get CBM historical records.
 * Returns null if the backend is unreachable.
 */
export async function getSyntheticHistory(limit: number = 60): Promise<any[] | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/synthetic/history?limit=${limit}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.history || null;
  } catch {
    return null;
  }
}
/**
 * GET /api/system-status — Get comprehensive system status for integration verification.
 * Returns null if the backend is unreachable.
 */
export async function getSystemStatus(): Promise<any | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/system-status`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * GET /api/status — Get current simulation status.
 * Returns null if the backend is unreachable.
 */
export async function getStatus(): Promise<any | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/status`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Health check endpoint to verify backend connectivity.
 * Returns true if backend is reachable, false otherwise.
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/`, { 
      method: 'GET',
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Retry wrapper for API calls with exponential backoff
 */
async function retryApiCall<T>(
  apiCall: () => Promise<T>, 
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await apiCall();
    } catch (error) {
      if (attempt === maxRetries - 1) {
        console.error(`API call failed after ${maxRetries} attempts:`, error);
        return null;
      }
      
      // Exponential backoff: 1s, 2s, 4s
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return null;
}
// =============================================================================
// Six-section Control JSON types (Spec Section 5)
// =============================================================================

export interface FaultEntry {
  enabled: boolean;
  severity: number; // 0-100%
}

export interface SyntheticControlJson {
  machine: {
    machine_name: string;
    motor_rating_kw: number;
    motor_speed_rpm: number;
    rotor_frequency_hz: number;
    grinding_frequency_hz: number;
  };
  signals: {
    vibration: boolean;
    current: boolean;
    temperature: boolean;
  };
  simulation: {
    sampling_frequency: { vibration: number; current: number; temperature: number };
    window_length_sec: number;
    duration_sec: number;
    noise_level: number;
  };
  machine_faults: {
    healthy: boolean;
    blade_wear: FaultEntry;
    bearing_fault: FaultEntry;
    misalignment: FaultEntry;
    imbalance: FaultEntry;
    looseness: FaultEntry;
  };
  process_faults: {
    material_buildup: FaultEntry;
    partial_clogging: FaultEntry;
    choking: FaultEntry;
  };
  output: {
    csv: boolean;
    json: boolean;
    mat: boolean;
  };
}

export async function postControlJson(ctrl: SyntheticControlJson): Promise<unknown> {
  try {
    const mf = ctrl.machine_faults;
    const pf = ctrl.process_faults;
    const res = await fetch(`${BASE_URL}/api/synthetic/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        severity: {
          bearing_fault:    mf.bearing_fault.enabled    ? mf.bearing_fault.severity / 100    : 0,
          blade_wear:       mf.blade_wear.enabled        ? mf.blade_wear.severity / 100        : 0,
          imbalance:        mf.imbalance.enabled         ? mf.imbalance.severity / 100         : 0,
          misalignment:     mf.misalignment.enabled      ? mf.misalignment.severity / 100      : 0,
          looseness:        mf.looseness.enabled         ? mf.looseness.severity / 100         : 0,
          material_buildup: pf.material_buildup.enabled  ? pf.material_buildup.severity / 100  : 0,
          partial_clogging: pf.partial_clogging.enabled  ? pf.partial_clogging.severity / 100  : 0,
          choking:          pf.choking.enabled            ? pf.choking.severity / 100            : 0,
        },
        load_ratio: 0.70,
        noise_level: ctrl.simulation.noise_level,
      }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function getSyntheticSignal(): Promise<any | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/synthetic/signal`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function getSyntheticStatus(): Promise<any | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/synthetic/status`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function resetSynthetic(): Promise<unknown> {
  try {
    const res = await fetch(`${BASE_URL}/api/synthetic/reset`, { method: 'POST' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function getSyntheticPresets(): Promise<string[] | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/synthetic/presets`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.presets || null;
  } catch { return null; }
}

export async function applySyntheticPreset(name: string): Promise<unknown> {
  try {
    const res = await fetch(`${BASE_URL}/api/synthetic/preset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: name }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

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
  ewma: number;         // EWMA value
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
  ewma: number;
  slope: number;
  variance: number;
  cycle_time: number;
  t_fail: number;
  config: {
    mu: number;
    ucl_2sigma: number;
    ucl_3sigma: number;
    alpha: number;
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
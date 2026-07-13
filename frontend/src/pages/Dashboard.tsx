import { useState, useEffect, useRef } from 'react';
import { 
  startSimulation, 
  getStepData, 
  interruptSimulation, 
  emergencyStop,
  setMotorCurrent, 
  setKNoise, 
  getEvents,
  getEWMAData,
  getAlerts,
  healthCheck,
  configureSynthetic,
  getSyntheticHealth,
  getSyntheticHistory,
  StepData,
  EWMAData,
  AlertData
} from '../services/api';
import { AdvancedTelemetryGraph, TelemetryPoint, AlertState } from '../app/components/AdvancedTelemetryGraph';
import { SensorStatusCard, SensorDef } from '../app/components/SensorStatusCard';
import { IndustrialKnobControl } from '../app/components/IndustrialKnobControl';
import { ControlPanelSection } from '../app/components/ControlPanelSection';
import { CycleTimeSlider } from '../app/components/CycleTimeSlider';
import { AlertIndicators } from '../app/components/AlertIndicators';
import { EnhancedAlertPopup } from '../app/components/EnhancedAlertPopup';
import { ErrorBoundary } from '../app/components/ErrorBoundary';
import styles from './Dashboard.module.css';

// ─────────────────────────────────────────
// Shared card chrome — identical across ALL panels
// ─────────────────────────────────────────
function Screws({ count = 4 }: { count?: 2 | 4 }) {
  const positions =
    count === 2
      ? [
          { className: styles.screwTopLeft },
          { className: styles.screwTopRight }
        ]
      : [
          { className: styles.screwTopLeft },
          { className: styles.screwTopRight },
          { className: styles.screwBottomLeft },
          { className: styles.screwBottomRight },
        ];
  return (
    <>
      {positions.map((pos, i) => (
        <div
          key={i}
          className={`${styles.screw} ${pos.className}`}
        >
          <div className={styles.screwIcon}>
            +
          </div>
        </div>
      ))}
    </>
  );
}

// ─────────────────────────────────────────
// Sensor definitions
// ─────────────────────────────────────────
// Sensor definitions - Updated to show real EWMA data
// ─────────────────────────────────────────
const SENSOR_DEFS: SensorDef[] = [
  {
    key: 'ewmaSlow',
    label: 'EWMA (Slow)',
    unit: 'A',
    greenZone: [4.5, 5.3],
    yellowZone: [5.3, 5.6],
    redZone: [5.6, 7.0],
    decimals: 3,
  },
  {
    key: 'ewmaFast',
    label: 'EWMA (Fast)',
    unit: 'A',
    greenZone: [4.5, 5.4],
    yellowZone: [5.4, 5.8],
    redZone: [5.8, 7.0],
    decimals: 3,
  },
  {
    key: 'gap',
    label: 'Gap (Fast-Slow)',
    unit: 'A',
    greenZone: [0, 0.05],
    yellowZone: [0.05, 0.15],
    redZone: [0.15, 0.5],
    decimals: 4,
  },
];

// ─────────────────────────────────────────
// Main Dashboard Component
// ─────────────────────────────────────────
export default function Dashboard() {
  // ── Session state (matching Streamlit exactly) ────────────────────────────
  const [running, setRunning] = useState(false);
  const [lastWearRate, setLastWearRate] = useState(0.0);
  const [pendingWearReset, setPendingWearReset] = useState(false);
  
  // ── Parameter state (matching Streamlit defaults) ─────────────────────────
  const [motorCurrentParam, setMotorCurrentParam] = useState(5.0); // I_BASE_INIT
  const [kNoise, setKNoiseState] = useState(0.05);
  const [wearRate, setWearRate] = useState(0.0); // Initially 0.0 like Streamlit
  const [cycleTimeParam, setCycleTimeParam] = useState(2.0); // New cycle time control
  
  // ── Simulation data ───────────────────────────────────────────────────────
  const [events, setEvents] = useState<any[]>([]);
  const [currentData, setCurrentData] = useState<StepData | null>(null);
  const [ewmaData, setEWMAData] = useState<EWMAData | null>(null);
  const [alertData, setAlertData] = useState<AlertData | null>(null);
  
  // ── UI display values - Real EWMA data ───────────────────────────────────
  const [ewmaSlow, setEwmaSlow] = useState(5.0);
  const [ewmaFast, setEwmaFast] = useState(5.0);
  const [gap, setGap] = useState(0.0);
  
  // ── Chart data ────────────────────────────────────────────────────────────
  const [chartHistory, setChartHistory] = useState<TelemetryPoint[]>([]);
  
  // ── Connection state ──────────────────────────────────────────────────────
  const [isConnected, setIsConnected] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  
  // ── Responsive layout state ───────────────────────────────────────────────
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  
  // ── Real-time clock state ─────────────────────────────────────────────────
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // ── Alert management ──────────────────────────────────────────────────────
  const [showAlertPopup, setShowAlertPopup] = useState(false);
  const [lastAlertState, setLastAlertState] = useState<AlertState>({
    early: false,
    mid: false,
    late: false,
  });
  const alertPopupTimeoutRef = useRef<NodeJS.Timeout>();

  // ── Synthetic CBM state — per-signal independent fault modes ─────────────
  type FaultMode = 'healthy' | 'bearing' | 'blade';
  const [vibFault,  setVibFault]  = useState<FaultMode>('healthy');
  const [curFault,  setCurFault]  = useState<FaultMode>('healthy');
  const [tempFault, setTempFault] = useState<FaultMode>('healthy');
  
  // Independent severity state for each signal type
  const [vibSeverity, setVibSeverity]   = useState(0.5);
  const [curSeverity, setCurSeverity]   = useState(0.5);
  const [tempSeverity, setTempSeverity] = useState(0.5);

  const [cbmData,    setCbmData]  = useState<any>(null);
  const [cbmHistory, setCbmHistory] = useState<any[]>([]);
  const lastFaultConfigRef = useRef<string>('h:h:h:0:0:0');

  // ── Refs for tracking ─────────────────────────────────────────────────────
  const intervalRef = useRef<NodeJS.Timeout>();
  const motorCurrentTimeoutRef = useRef<NodeJS.Timeout>();
  const kNoiseTimeoutRef = useRef<NodeJS.Timeout>();
  // Mirror of lastAlertState as a ref so the step interval can compare
  // previous vs current alert flags WITHOUT being in the dependency array.
  // This prevents the interval from restarting (and creating timing gaps)
  // every time an alert fires.
  const lastAlertStateRef = useRef<AlertState>({ 
    early: false, 
    mid: false, 
    late: false,
    earlyTriggerTime: undefined,
    midTriggerTime: undefined,
    lateTriggerTime: undefined
  });
  // Track if we've received the first data point to prevent popups on initial load
  const hasReceivedFirstDataRef = useRef(false);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (motorCurrentTimeoutRef.current) clearTimeout(motorCurrentTimeoutRef.current);
      if (kNoiseTimeoutRef.current) clearTimeout(kNoiseTimeoutRef.current);
      if (alertPopupTimeoutRef.current) clearTimeout(alertPopupTimeoutRef.current);
    };
  }, []);

  // ── Initialize simulation (like Streamlit session state) ──────────────────
  useEffect(() => {
    // Reset backend to clean initial state on mount.
    // The Python backend is a persistent process that retains state between
    // page loads. Without this reset, a stale degraded I_base from a prior
    // session would cause the EWMA to rise even when wear_rate = 0.
    const init = async () => {
      try {
        const connected = await healthCheck();
        setIsConnected(connected);
        if (!connected) {
          setConnectionError('Backend server is not responding. Please ensure the API server is running on port 8000.');
          return;
        }
        // Reset backend → wear_rate=0, I_base=5.0, fresh EWMA state
        await startSimulation();
        setConnectionError(null);
      } catch {
        // If reset fails, still mark connected so polling can retry
        setIsConnected(true);
      }
    };
    
    init();
    
    // Periodic health checks (passive — no reset)
    const healthInterval = setInterval(async () => {
      const connected = await healthCheck();
      setIsConnected(connected);
      if (!connected) {
        setConnectionError('Backend server is not responding. Please ensure the API server is running on port 8000.');
      } else {
        setConnectionError(null);
      }
    }, 30000);
    
    // Handle window resize for responsive layout
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };
    
    // Update clock every second
    const clockInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    
    window.addEventListener('resize', handleResize);
    
    return () => {
      clearInterval(healthInterval);
      clearInterval(clockInterval);
      window.removeEventListener('resize', handleResize);
    };
  }, []);


  // ── Handle parameter changes with immediate application ───────────────────
  useEffect(() => {
    if (motorCurrentTimeoutRef.current) clearTimeout(motorCurrentTimeoutRef.current);
    motorCurrentTimeoutRef.current = setTimeout(() => {
      setMotorCurrent(motorCurrentParam);
    }, 100);
  }, [motorCurrentParam]);

  useEffect(() => {
    if (kNoiseTimeoutRef.current) clearTimeout(kNoiseTimeoutRef.current);
    kNoiseTimeoutRef.current = setTimeout(() => {
      setKNoise(kNoise);
    }, 100);
  }, [kNoise]);

  // ── Apply per-signal fault config to simulator when any radio changes ──────
  useEffect(() => {
    const key = `${vibFault}:${curFault}:${tempFault}:${vibSeverity}:${curSeverity}:${tempSeverity}`;
    if (key === lastFaultConfigRef.current) return;
    lastFaultConfigRef.current = key;

    // Compute signal-specific severities
    const vibBearingSev = vibFault === 'bearing' ? vibSeverity : 0.0;
    const vibBladeSev   = vibFault === 'blade'   ? vibSeverity : 0.0;

    const curBearingSev = curFault === 'bearing' ? curSeverity : 0.0;
    const curBladeSev   = curFault === 'blade'   ? curSeverity : 0.0;

    const tempBearingSev = tempFault === 'bearing' ? tempSeverity : 0.0;
    const tempBladeSev   = tempFault === 'blade'   ? tempSeverity : 0.0;

    configureSynthetic({
      severity: {
        vib_bearing_fault: vibBearingSev,
        vib_blade_wear:    vibBladeSev,
        cur_bearing_fault: curBearingSev,
        cur_blade_wear:    curBladeSev,
        temp_bearing_fault:tempBearingSev,
        temp_blade_wear:   tempBladeSev,
        // global fallbacks for simple checks
        bearing_fault: Math.max(vibBearingSev, curBearingSev, tempBearingSev),
        blade_wear:    Math.max(vibBladeSev, curBladeSev, tempBladeSev)
      },
      load_ratio: 0.70,
    });
  }, [vibFault, curFault, tempFault, vibSeverity, curSeverity, tempSeverity]);

  // ── Handle wear rate changes as interrupts (exact Streamlit logic) ────────
  useEffect(() => {
    if (wearRate !== lastWearRate) {
      if (currentData && currentData.t > 0) {
        interruptSimulation(wearRate).then((result: any) => {
          if (result && result.action === "RESET") {
            setPendingWearReset(true);
          }
        });
      }
      setLastWearRate(wearRate);
    }
  }, [wearRate, lastWearRate, currentData]);

  // ── Handle pending wear reset (exact Streamlit logic) ─────────────────────
  useEffect(() => {
    if (pendingWearReset) {
      setWearRate(0.0);
      setLastWearRate(0.0);
      setPendingWearReset(false);
    }
  }, [pendingWearReset]);

  // ── Start/Stop simulation control ─────────────────────────────────────────
  const handleStartStop = async () => {
    if (running) {
      // ── Emergency Stop ─────────────────────────────────────────────────────
      // Complete emergency stop - pause simulation and reset wear rate to safe level
      setRunning(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      
      try {
        // Call emergency stop API to immediately reset wear rate to 0
        await emergencyStop();
        setWearRate(0.0);
        setLastWearRate(0.0);
        console.log('Emergency stop activated - system paused and wear rate reset to 0');
      } catch (error) {
        console.error('Emergency stop API call failed:', error);
        // Still reset local state even if API fails
        setWearRate(0.0);
        setLastWearRate(0.0);
      }
    } else {
      // ── Start (resume) ────────────────────────────────────────────────────
      // Just verify connectivity then resume polling — backend continues from
      // exactly where it left off (same cycle, same alerts, same EWMA state).
      // startSimulation() is intentionally NOT called here; it resets the
      // backend. Only handleReset should call it.
      setIsConnecting(true);
      try {
        const connected = await healthCheck();
        if (!connected) {
          setConnectionError('Cannot start simulation: Backend server is not responding');
          setIsConnected(false);
          return;
        }
        setRunning(true);
        setConnectionError(null);
        setIsConnected(true);
        
        console.log('Simulation resumed from current state');
      } catch (error) {
        console.error('Failed to start simulation:', error);
        setConnectionError('Failed to start simulation: ' + (error as Error).message);
        setIsConnected(false);
      } finally {
        setIsConnecting(false);
      }
    }
  };

  const handleReset = async () => {
    // Stop if running
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    
    // Complete system reset - return to initial state
    setRunning(false);
    setLastWearRate(0.0);
    setWearRate(0.0);
    setPendingWearReset(false);
    setEvents([]);
    setCurrentData(null);
    setChartHistory([]);
    setEWMAData(null);
    setAlertData(null);
    
    // Reset all UI display values to initial state
    setEwmaSlow(5.0);
    setEwmaFast(5.0);
    setGap(0.0);
    
    // Reset parameters to initial values
    setMotorCurrentParam(5.0);
    setKNoiseState(0.05);
    setCycleTimeParam(2.0);
    
    // Clear alert state completely - return to normal initial position
    const clearedAlerts: AlertState = { 
      early: false, 
      mid: false, 
      late: false,
      earlyTriggerTime: undefined,
      midTriggerTime: undefined,
      lateTriggerTime: undefined
    };
    setLastAlertState(clearedAlerts);
    lastAlertStateRef.current = clearedAlerts;
    
    // Reset first data flag to prevent popups on restart
    hasReceivedFirstDataRef.current = false;
    
    // Close any open alert popups and clear timeout
    if (alertPopupTimeoutRef.current) {
      clearTimeout(alertPopupTimeoutRef.current);
    }
    setShowAlertPopup(false);
    
    // Reset simulation backend with error handling
    try {
      const connected = await healthCheck();
      if (!connected) {
        setConnectionError('Cannot reset simulation: Backend server is not responding');
        setIsConnected(false);
        return;
      }
      
      // Reset backend to clean initial state
      await startSimulation();
      setConnectionError(null);
      setIsConnected(true);
      
      console.log('System reset complete - returned to initial state');
    } catch (error) {
      console.error('Failed to reset simulation:', error);
      setConnectionError('Failed to reset simulation: ' + (error as Error).message);
      setIsConnected(false);
    }
  };

  const handleDownloadRawCSV = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/synthetic/download_raw_csv');
      if (!response.ok) throw new Error('Network response was not ok');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = 'pulveriser_raw_1s_data.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading raw CSV:', error);
      alert('Failed to download raw CSV file.');
    }
  };

  // ── Synthetic CBM tick — fetch /api/synthetic/health every second ─────────
  useEffect(() => {
    if (!running || !isConnected) return;
    const synFetch = async () => {
      try {
        const d = await getSyntheticHealth();
        if (d) {
          setCbmData(d);
          // Also fetch history for sparklines
          const h = await getSyntheticHistory(60);
          if (h) setCbmHistory(h);
        }
      } catch { /* network hiccup — skip frame */ }
    };
    synFetch(); // immediate first tick
    const synInterval = setInterval(synFetch, 1000);
    return () => clearInterval(synInterval);
  }, [running, isConnected]);

  // ── Old simulation step loop — kept for old chart / alert data ─────────────
  useEffect(() => {
    if (running && isConnected) {
      const stepInterval = setInterval(async () => {
        try {
          // Single fetch per tick — step data already contains alerts + ewma
          const data = await getStepData();
          if (!data) {
            console.warn('No data received from backend');
            setConnectionError('No data received from backend');
            return;
          }

          setCurrentData(data);
          setConnectionError(null);

          // ── Append chart point FIRST ─────────────────────────────────────
          // Critical: chartHistory must include this step's point BEFORE
          // setLastAlertState fires, so the graph's alert-tracking effect
          // sees latestPoint = this step (not the previous one).
          setChartHistory(prev => {
            const newPoint: TelemetryPoint = {
              time:      String(data.t),
              timestamp: Date.now(),
              t:         data.t,
              current:   data.current,
              noise:     data.noise,
              ewma:      data.ewma,
              ewma_fast: data.ewma_fast,
              ewma_slow: data.ewma_slow,
              gap:       data.gap,
              slope:     data.slope,
              variance:  data.variance,
              cycleTime: data.cycle_time,
            };
            
            // Debug logging for data validation
            if (data.t <= 5) { // Only log first 5 points to avoid spam
              console.log(`Chart point t=${data.t}:`, {
                current: data.current,
                ewma: data.ewma,
                ewma_fast: data.ewma_fast,
                ewma_slow: data.ewma_slow,
                gap: data.gap,
                noise: data.noise,
                isValidCurrent: typeof data.current === 'number' && !isNaN(data.current),
                isValidEwma: typeof data.ewma === 'number' && !isNaN(data.ewma)
              });
            }
            
            const updated = [...prev, newPoint];
            if (updated.length > 300) updated.shift();
            return updated;
          });

          // ── Alert state update (AFTER chart point) ────────────────────────
          const stepAlerts = data.alerts;
          if (stepAlerts) {
            const prev = lastAlertStateRef.current;
            
            // Only show popup if:
            // 1. We've received at least one data point (not initial load)
            // 2. We have a NEW trigger time (not just state change)
            // 3. The alert is currently active
            // 4. The trigger time is for the CURRENT cycle (not a past alert)
            const isInitialLoad = !hasReceivedFirstDataRef.current;
            
            const newEarlyTrigger = !isInitialLoad &&
              stepAlerts.early && 
              stepAlerts.early_trigger_time && 
              stepAlerts.early_trigger_time !== prev.earlyTriggerTime &&
              stepAlerts.early_trigger_time === data.t; // Only if triggered THIS cycle
              
            const newMidTrigger = !isInitialLoad &&
              stepAlerts.mid && 
              stepAlerts.mid_trigger_time && 
              stepAlerts.mid_trigger_time !== prev.midTriggerTime &&
              stepAlerts.mid_trigger_time === data.t; // Only if triggered THIS cycle
              
            const newLateTrigger = !isInitialLoad &&
              stepAlerts.late && 
              stepAlerts.late_trigger_time && 
              stepAlerts.late_trigger_time !== prev.lateTriggerTime &&
              stepAlerts.late_trigger_time === data.t; // Only if triggered THIS cycle

            // Debug logging for popup triggers
            if (newEarlyTrigger || newMidTrigger || newLateTrigger) {
              console.log('[POPUP] Alert popup triggered:', {
                cycle: data.t,
                early: newEarlyTrigger,
                mid: newMidTrigger,
                late: newLateTrigger,
                isInitialLoad,
                showAlertPopup: showAlertPopup, // Log current popup state
                prevTriggers: {
                  early: prev.earlyTriggerTime,
                  mid: prev.midTriggerTime,
                  late: prev.lateTriggerTime
                },
                currentTriggers: {
                  early: stepAlerts.early_trigger_time,
                  mid: stepAlerts.mid_trigger_time,
                  late: stepAlerts.late_trigger_time
                }
              });
            }

            // Only show popup for the highest severity alert
            // Additional check: don't show if popup is already visible
            if (newLateTrigger && !showAlertPopup) {
              // Clear any existing timeout
              if (alertPopupTimeoutRef.current) {
                clearTimeout(alertPopupTimeoutRef.current);
              }
              setShowAlertPopup(true);
              console.log('[POPUP] Showing LATE alert popup');
              // Auto-dismiss after 10 seconds for late alert (critical)
              alertPopupTimeoutRef.current = setTimeout(() => {
                setShowAlertPopup(false);
                console.log('[POPUP] Auto-dismissed LATE alert popup');
              }, 10000);
            } else if (newMidTrigger && !stepAlerts.late && !showAlertPopup) {
              if (alertPopupTimeoutRef.current) {
                clearTimeout(alertPopupTimeoutRef.current);
              }
              setShowAlertPopup(true);
              console.log('[POPUP] Showing MID alert popup');
              // Auto-dismiss after 8 seconds for mid alert
              alertPopupTimeoutRef.current = setTimeout(() => {
                setShowAlertPopup(false);
                console.log('[POPUP] Auto-dismissed MID alert popup');
              }, 8000);
            } else if (newEarlyTrigger && !stepAlerts.mid && !stepAlerts.late && !showAlertPopup) {
              if (alertPopupTimeoutRef.current) {
                clearTimeout(alertPopupTimeoutRef.current);
              }
              setShowAlertPopup(true);
              console.log('[POPUP] Showing EARLY alert popup');
              // Auto-dismiss after 5 seconds for early alert
              alertPopupTimeoutRef.current = setTimeout(() => {
                setShowAlertPopup(false);
                console.log('[POPUP] Auto-dismissed EARLY alert popup');
              }, 5000);
            }

            const nextAlertState: AlertState = {
              early: stepAlerts.early,
              mid:   stepAlerts.mid,
              late:  stepAlerts.late,
              earlyTriggerTime: stepAlerts.early_trigger_time,
              midTriggerTime:   stepAlerts.mid_trigger_time,
              lateTriggerTime:  stepAlerts.late_trigger_time,
            };

            lastAlertStateRef.current = nextAlertState;
            setLastAlertState(nextAlertState);
            
            // Mark that we've received first data
            if (isInitialLoad) {
              hasReceivedFirstDataRef.current = true;
              console.log('[POPUP] First data received, popup system armed');
            }

            setAlertData(prev => ({
              status: stepAlerts.late ? 'LATE' : stepAlerts.mid ? 'MID' : stepAlerts.early ? 'EARLY' : 'NORMAL',
              current_alerts: {
                early: stepAlerts.early,
                mid:   stepAlerts.mid,
                late:  stepAlerts.late,
                early_trigger_time: stepAlerts.early_trigger_time,
                mid_trigger_time:   stepAlerts.mid_trigger_time,
                late_trigger_time:  stepAlerts.late_trigger_time,
              },
              alert_history: prev?.alert_history || { early: [], mid: [], late: [] },
              alert_counts: prev?.alert_counts || { early: 0, mid: 0, late: 0 },
            }));
          }

          // ── Update sensor display with real EWMA data ────────────────────
          setEwmaSlow(data.ewma_slow);
          setEwmaFast(data.ewma_fast);
          setGap(data.gap);

          // ── Non-critical background fetches (don’t block chart render) ──────
          getEWMAData().then(ewma => { if (ewma) setEWMAData(ewma); });
          getEvents().then(ev     => { if (ev)   setEvents(ev); });
          // Fetch full alert data to populate alert_history panel
          getAlerts().then(fullAlerts => {
            if (fullAlerts) {
              setAlertData(prev => ({
                status: prev?.status || 'NORMAL',
                current_alerts: prev?.current_alerts || { early: false, mid: false, late: false },
                alert_history: fullAlerts.alert_history || { early: [], mid: [], late: [] },
                alert_counts:  fullAlerts.alert_counts  || { early: 0, mid: 0, late: 0 },
              }));
            }
          });

        } catch (error) {
          console.error('Error in simulation step:', error);
          setConnectionError('Lost connection: ' + (error as Error).message);
          setIsConnected(false);
          setRunning(false);
        }
      }, 1000); // Fixed 1-second tick

      intervalRef.current = stepInterval;
      return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }
  // Only re-create interval when running/connection changes — NOT on alert state
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, isConnected]);

  // Get current EWMA and cycle time for display
  const currentEWMA = currentData?.ewma || ewmaData?.ewma || 5.0;
  const currentCycleTime = currentData?.cycle_time || ewmaData?.cycle_time || 2.0;

  // Handle alert actions
  const handleAlertAction = (action: string) => {
    console.log('Alert action triggered:', action);
    // Implement specific actions based on the action type
    switch (action) {
      case 'emergency_stop':
        // Emergency stop with complete system reset
        setRunning(false);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        
        // Call emergency stop API
        emergencyStop().then(() => {
          setWearRate(0.0);
          setLastWearRate(0.0);
          console.log('Emergency stop from alert - system stopped and wear rate reset');
        }).catch((error) => {
          console.error('Emergency stop API failed:', error);
          // Still reset local state
          setWearRate(0.0);
          setLastWearRate(0.0);
        });
        
        // Close alert popup
        setShowAlertPopup(false);
        break;
      case 'schedule_maintenance':
        // Could integrate with maintenance system
        console.log('Maintenance scheduled');
        break;
      case 'reduce_load':
        // Reduce motor current to safe level
        setMotorCurrentParam(Math.max(3.0, motorCurrentParam * 0.8));
        console.log('Load reduced to safe level');
        break;
      default:
        console.log('Unknown action:', action);
    }
  };

  return (
    <div className={styles.container}>
      {/* Fixed corner screws */}
      {[
        { className: styles.cornerScrewTopLeft },
        { className: styles.cornerScrewTopRight },
        { className: styles.cornerScrewBottomLeft },
        { className: styles.cornerScrewBottomRight }
      ].map((pos, i) => (
        <div key={i} className={`${styles.cornerScrew} ${pos.className}`}>
          <div className={styles.cornerScrewIcon}>+</div>
        </div>
      ))}

      <div className={styles.contentWrapper}>

        {/* Connection Status Banner */}
        {!isConnected && (
          <div className={styles.connectionBanner}>
            <div className={styles.connectionIndicator} />
            <div>
              <div className={styles.connectionErrorTitle}>
                CONNECTION ERROR
              </div>
              <div className={styles.connectionErrorMessage}>
                {connectionError}
              </div>
            </div>
          </div>
        )}

        {/* ── HEADER ── */}
        <div className={styles.header}>
          <div>
            <h1 className={styles.headerTitle}>
              INDUSTRIAL CONTROL PANEL
            </h1>
            <div className={styles.headerStatus}>
              <span className={styles.statusItem}>
                <div className={`${styles.statusDot} ${styles.statusDotGreen}`} />
                SYSTEM NORMAL
              </span>
              <span className={`${styles.statusItem} ${styles.statusItemSuccess}`}>
                <div className={`${styles.statusDot} ${styles.statusDotCyan}`} />
                {currentTime.toLocaleTimeString()}
              </span>
            </div>
          </div>
          {/* CBM status badge in header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.65rem', fontFamily: 'monospace' }}>
            {running && cbmData && (
              <span style={{
                padding: '4px 10px',
                borderRadius: '20px',
                background: cbmData.alarms?.severity === 'NORMAL' ? 'rgba(63,185,80,0.12)'
                  : cbmData.alarms?.severity === 'EARLY' ? 'rgba(210,153,34,0.12)'
                  : cbmData.alarms?.severity === 'MID'   ? 'rgba(240,136,62,0.12)'
                  : 'rgba(248,81,73,0.12)',
                border: `1px solid ${ cbmData.alarms?.severity === 'NORMAL' ? '#3fb950'
                  : cbmData.alarms?.severity === 'EARLY' ? '#d29922'
                  : cbmData.alarms?.severity === 'MID'   ? '#f0883e' : '#f85149'}`,
                color: cbmData.alarms?.severity === 'NORMAL' ? '#3fb950'
                  : cbmData.alarms?.severity === 'EARLY' ? '#d29922'
                  : cbmData.alarms?.severity === 'MID'   ? '#f0883e' : '#f85149',
              }}>
                {cbmData.alarms?.severity === 'NORMAL' ? '✅' : cbmData.alarms?.severity === 'EARLY' ? '⚠️' : cbmData.alarms?.severity === 'MID' ? '🔶' : '🚨'}
                &nbsp;{cbmData.alarms?.severity} &nbsp;·&nbsp; MHI {cbmData.indices?.MHI?.toFixed(0)} &nbsp;·&nbsp; Win #{cbmData.window_idx}
              </span>
            )}
          </div>
        </div>

        {/* ── MAIN 3-COLUMN GRID ── */}
        <div
          className={`${styles.mainGrid} ${
            windowWidth > 1200 
              ? styles.mainGridLarge
              : windowWidth > 900 
                ? styles.mainGridMedium
                : styles.mainGridSmall
          }`}
        >

          {/* ══ LEFT COLUMN ══ */}
          <div className={styles.leftColumn}>

            {/* ── CBM Signal / Fault Control Sidebar ── */}
            <div className={`${styles.card}`} style={{ position: 'relative', padding: '14px 12px 10px' }}>
              <Screws count={4} />
              <div className={`${styles.cardTitle} ${styles.cardTitleSmall}`} style={{ marginBottom: '12px' }}>
                CBM SIGNAL CONTROL
              </div>

              {([
                { key: 'vib',  label: 'VIBRATION',     color: '#00b4ff', rgb: '0,180,255',   value: vibFault,  setter: setVibFault,  sev: vibSeverity,  setSev: setVibSeverity  },
                { key: 'cur',  label: 'MOTOR CURRENT',  color: '#f0883e', rgb: '240,136,62',  value: curFault,  setter: setCurFault,  sev: curSeverity,  setSev: setCurSeverity  },
                { key: 'temp', label: 'TEMPERATURE',    color: '#3fb950', rgb: '63,185,80',   value: tempFault, setter: setTempFault, sev: tempSeverity, setSev: setTempSeverity },
              ] as const).map(({ key, label, color, rgb, value, setter, sev, setSev }) => (
                <div key={key} style={{ marginBottom: '14px' }}>
                  {/* Signal title */}
                  <div style={{
                    fontSize: '0.58rem', color, fontFamily: 'monospace', fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.12em',
                    borderBottom: `1px solid ${color}33`, paddingBottom: '4px', marginBottom: '7px',
                  }}>
                    {label}
                  </div>
                  {/* Fault radio buttons */}
                  <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: value !== 'healthy' ? '8px' : '0px' }}>
                    {(['healthy', 'bearing', 'blade'] as const).map(f => {
                      const FC: Record<string, string> = { healthy: '#3fb950', bearing: '#f0883e', blade: '#a371f7' };
                      const FR: Record<string, string> = { healthy: '63,185,80', bearing: '240,136,62', blade: '163,113,247' };
                      const active = value === f;
                      return (
                        <button
                          key={f}
                          id={`${key}-fault-${f}`}
                          onClick={() => (setter as (v: 'healthy'|'bearing'|'blade') => void)(f)}
                          style={{
                            padding: '4px 10px', fontSize: '0.62rem', fontWeight: 600,
                            borderRadius: '4px',
                            border: `1px solid ${active ? FC[f] : 'rgba(255,255,255,0.1)'}`,
                            background: active ? `rgba(${FR[f]},0.12)` : 'rgba(255,255,255,0.02)',
                            color: active ? '#ffffff' : '#8b949e',
                            cursor: 'pointer', transition: 'all 0.15s',
                            boxShadow: active ? `0 0 6px rgba(${FR[f]},0.2)` : 'none',
                            whiteSpace: 'nowrap',
                            display: 'inline-flex',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{
                            display: 'inline-block',
                            width: '7px',
                            height: '7px',
                            borderRadius: '50%',
                            border: `1px solid ${active ? FC[f] : '#8b949e'}`,
                            background: active ? FC[f] : 'transparent',
                            marginRight: '6px',
                            boxShadow: active ? `0 0 4px ${FC[f]}` : 'none',
                            transition: 'all 0.15s',
                          }} />
                          {f === 'healthy' ? 'Healthy' : f === 'bearing' ? 'Bearing' : 'Blade'}
                        </button>
                      );
                    })}
                  </div>

                  {/* Signal-specific severity slider */}
                  {value !== 'healthy' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '4px', marginTop: '4px' }}>
                      <span style={{ fontSize: '0.55rem', color: '#8b949e', textTransform: 'uppercase', fontFamily: 'monospace' }}>
                        Sev:
                      </span>
                      <input
                        type="range" min={0} max={1} step={0.05}
                        value={sev}
                        onChange={e => (setSev as (s: number) => void)(parseFloat(e.target.value))}
                        style={{ flex: 1, height: '4px', accentColor: value === 'bearing' ? '#f0883e' : '#a371f7' }}
                      />
                      <span style={{ fontSize: '0.7rem', color: '#e6edf3', fontFamily: 'monospace', minWidth: '24px', textAlign: 'right' }}>
                        {sev.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              ))}

              {/* 1s Raw Signal Data Download Section */}
              <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px dashed #21262d' }}>
                <button
                  id="raw-download-btn"
                  onClick={handleDownloadRawCSV}
                  style={{
                    background: '#21262d',
                    color: '#e6edf3',
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    fontSize: '0.7rem',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    fontWeight: 600,
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#30363d'}
                  onMouseLeave={e => e.currentTarget.style.background = '#21262d'}
                >
                  📥 Download 1s Raw Signal Data (CSV)
                </button>
              </div>
            </div>

            <IndustrialKnobControl
              label="Wear Rate"
              sublabel="Early vs Mid vs Late alert timing"
              value={wearRate}
              min={0} max={0.040} unit="A/u" step={0.001}
              onChange={setWearRate}
            />
            <IndustrialKnobControl
              label="Motor Current"
              sublabel="Baseline motor current (A)"
              value={motorCurrentParam}
              min={0} max={20} unit="A" step={0.1}
              onChange={setMotorCurrentParam}
            />
            <CycleTimeSlider
              value={cycleTimeParam}
              min={0.5}
              max={5.0}
              step={0.1}
              onChange={setCycleTimeParam}
            />
          </div>

          {/* ══ CENTER COLUMN ══ */}
          <div className={styles.centerColumn}>

            {/* Machine Status */}
            <div className={`${styles.card} ${styles.cardCompact}`}>
              <Screws count={2} />
              <div className={`${styles.cardTitle} ${styles.cardTitleSmall}`}>MACHINE STATUS</div>
              
              {/* Control Buttons */}
              <div className={styles.controlButtons}>
                <button
                  onClick={handleStartStop}
                  disabled={!isConnected || isConnecting}
                  className={`${styles.controlButton} ${
                    (!isConnected || isConnecting) ? styles.controlButtonDisabled :
                    running ? styles.controlButtonPause : styles.controlButtonStart
                  }`}
                >
                  {isConnecting ? '⏳ Connecting...' : !isConnected ? '⚠ Offline' : running ? '⏸ Pause' : '▶ Start'}
                </button>
                <button
                  onClick={handleReset}
                  disabled={!isConnected}
                  className={`${styles.controlButton} ${
                    !isConnected ? styles.controlButtonDisabled : styles.controlButtonReset
                  }`}
                >
                  ↺ Reset
                </button>
              </div>
              
              <div className={styles.statusIndicators}>
                {[
                  { label: 'Running',  active: running,                                    type: 'green' },
                  { label: 'Warning',  active: ewmaSlow > 5.5 || gap > 0.10,              type: 'yellow' },
                  { label: 'Critical', active: ewmaSlow > 5.75 || gap > 0.20,             type: 'red' },
                ].map(({ label, active, type }) => (
                  <div key={label} className={styles.statusIndicator}>
                    <div className={`${styles.statusLight} ${
                      active 
                        ? `${styles.statusLightActive} ${styles[`statusLight${type.charAt(0).toUpperCase() + type.slice(1)}`]}`
                        : styles.statusLightInactive
                    }`} />
                    <span className={`${styles.statusLabel} ${
                      active 
                        ? styles[`statusLabel${type === 'green' ? 'Active' : type === 'yellow' ? 'Warning' : 'Critical'}`]
                        : styles.statusLabelInactive
                    }`}>
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── LIVE CBM DATA PANEL ── */}
            {cbmData && (() => {
              const idx   = cbmData.indices  || {};
              const alm   = cbmData.alarms   || {};
              const kpi   = cbmData.kpis     || {};
              const feat  = cbmData.features || {};
              const vib   = feat.vibration   || {};
              const cur   = feat.current     || {};
              const tmp   = feat.temperature || {};

              const almColor: Record<string, string> = {
                NORMAL: '#3fb950', EARLY: '#d29922', MID: '#f0883e', LATE: '#f85149'
              };
              const almSev  = alm.severity || 'NORMAL';
              const color   = almColor[almSev] || '#3fb950';

              const sigColors: Record<string, string> = {
                vibration: '#00b4ff', current: '#f0883e', temperature: '#3fb950'
              };

              // All signal feature definitions — shown for each selected signal
              const ALL_SIGNAL_FEATURES: Record<string, [string, number|undefined][]> = {
                vibration:   [['RMS (g)',        vib.RMS],
                              ['Kurtosis',       vib.Kurtosis],
                              ['Crest Factor',   vib.CrestFactor],
                              ['Spec. Centroid', vib.SpectralCentroid],
                              ['Mid-Band E',     vib.MidBandEnergy],
                              ['THD',            vib.THD]],
                current:     [['RMS (A)',         cur.RMS],
                              ['Kurtosis',        cur.Kurtosis],
                              ['THD',             cur.THD],
                              ['Variance',        cur.Variance]],
                temperature: [['Mean (°C)',       tmp.Mean],
                              ['RMS',             tmp.RMS],
                              ['Rate of Change',  tmp.RateOfChange]],
              };

              const sigLabels: Record<string, string> = {
                vibration: '〰 Vibration Features',
                current:   '⚡ Motor Current Features',
                temperature: '🌡 Temperature Features',
              };

              // Always show all three signals
              const orderedSignals = ['vibration', 'current', 'temperature'];

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>

                  {/* Alarm banner */}
                  <div style={{
                    background: `rgba(${almSev==='NORMAL'?'63,185,80':almSev==='EARLY'?'210,153,34':almSev==='MID'?'240,136,62':'248,81,73'},0.10)`,
                    border: `1px solid ${color}`, borderRadius: '6px',
                    padding: '7px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color, fontWeight: 700 }}>
                      {almSev === 'NORMAL' ? '✅' : almSev === 'EARLY' ? '⚠️' : almSev === 'MID' ? '🔶' : '🚨'} {almSev}
                    </span>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.65rem', color: '#8b949e' }}>
                      Min Index: <span style={{ color }}>{(alm.min_index ?? 0).toFixed(1)}</span>
                      &nbsp;|&nbsp; Win #{cbmData.window_idx}
                    </span>
                  </div>

                  {/* Health Indices */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                    {[['MHI', idx.MHI, '#58a6ff'], ['PQI', idx.PQI, '#79c0ff'], ['GQI', idx.GQI, '#a5d6ff']].map(([label, val, c]) => (
                      <div key={label as string} style={{
                        background: '#0d1117', border: '1px solid #21262d', borderRadius: '6px',
                        padding: '8px', textAlign: 'center',
                      }}>
                        <div style={{ fontSize: '0.6rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label as string}</div>
                        <div style={{ fontSize: '1.3rem', fontWeight: 700, color: c as string, fontFamily: 'monospace' }}>
                          {typeof val === 'number' ? val.toFixed(1) : '—'}
                        </div>
                        {/* mini bar */}
                        <div style={{ height: '3px', background: '#21262d', borderRadius: '2px', marginTop: '4px' }}>
                          <div style={{ height: '100%', width: `${Math.min(100, typeof val === 'number' ? val : 0)}%`,
                            background: c as string, borderRadius: '2px', transition: 'width 0.5s' }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Selected signal features — one card per signal */}
                  {orderedSignals.map(sig => {
                    const sc = sigColors[sig];
                    const feats = ALL_SIGNAL_FEATURES[sig] || [];
                    return (
                      <div key={sig} style={{ background: '#0d1117', border: `1px solid ${sc}22`, borderRadius: '6px', padding: '8px' }}>
                        <div style={{ fontSize: '0.6rem', color: sc, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', fontWeight: 600 }}>
                          {sigLabels[sig]}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${feats.length <= 3 ? feats.length : 3}, 1fr)`, gap: '4px' }}>
                          {feats.map(([name, val]) => (
                            <div key={name} style={{ background: '#161b22', borderRadius: '4px', padding: '5px 6px' }}>
                              <div style={{ fontSize: '0.55rem', color: '#8b949e' }}>{name}</div>
                              <div style={{ fontSize: '0.8rem', color: sc, fontFamily: 'monospace', fontWeight: 600 }}>
                                {typeof val === 'number' ? val.toFixed(4) : '—'}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {/* KPI row */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                    {[
                      ['Cycle Time', kpi.CycleTime?.toFixed(1), 's',   '#3fb950'],
                      ['Throughput', kpi.Throughput?.toFixed(1), 'kg/h','#3fb950'],
                      ['Grind Eff.', kpi.GrindingEfficiency ? (kpi.GrindingEfficiency*100).toFixed(1) : '—', '%', '#d29922'],
                      ['Load λ',    kpi.LoadRatio?.toFixed(2),  '',     '#f0883e'],
                    ].map(([label, val, unit, c]) => (
                      <div key={label as string} style={{
                        background: '#0d1117', border: '1px solid #21262d', borderRadius: '6px',
                        padding: '7px 6px', textAlign: 'center',
                      }}>
                        <div style={{ fontSize: '0.55rem', color: '#8b949e', textTransform: 'uppercase' }}>{label as string}</div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: c as string, fontFamily: 'monospace' }}>
                          {val ?? '—'}<span style={{ fontSize: '0.6rem', marginLeft: '2px', color: '#8b949e' }}>{unit as string}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Mini sparkline — MHI over last windows */}
                  {cbmHistory.length > 2 && (
                    <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: '6px', padding: '8px' }}>
                      <div style={{ fontSize: '0.6rem', color: '#8b949e', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Health History — Last {cbmHistory.length} windows
                      </div>
                      <svg width="100%" height="40" viewBox={`0 0 ${cbmHistory.length} 40`} preserveAspectRatio="none">
                        {/* MHI line */}
                        <polyline
                          fill="none" stroke="#58a6ff" strokeWidth="1"
                          points={cbmHistory.map((h, i) =>
                            `${i},${40 - ((h.MHI ?? 50) / 100) * 38}`
                          ).join(' ')}
                        />
                        {/* PQI line */}
                        <polyline
                          fill="none" stroke="#3fb950" strokeWidth="1"
                          points={cbmHistory.map((h, i) =>
                            `${i},${40 - ((h.PQI ?? 50) / 100) * 38}`
                          ).join(' ')}
                        />
                        {/* 85% healthy threshold */}
                        <line x1="0" y1={40 - 0.85*38} x2={cbmHistory.length} y2={40 - 0.85*38}
                              stroke="#3fb950" strokeWidth="0.5" strokeDasharray="2,2" />
                        {/* 70% warning threshold */}
                        <line x1="0" y1={40 - 0.70*38} x2={cbmHistory.length} y2={40 - 0.70*38}
                              stroke="#d29922" strokeWidth="0.5" strokeDasharray="2,2" />
                      </svg>
                      <div style={{ display: 'flex', gap: '12px', marginTop: '2px' }}>
                        <span style={{ fontSize: '0.55rem', color: '#58a6ff' }}>— MHI</span>
                        <span style={{ fontSize: '0.55rem', color: '#3fb950' }}>— PQI</span>
                        <span style={{ fontSize: '0.55rem', color: '#8b949e' }}>· · 85 / 70 thresholds</span>
                      </div>
                    </div>
                  )}

                </div>
              );
            })()}

            {/* Advanced Alert System Status */}
            <ControlPanelSection>
              <div className={styles.alertSystemStatus}>
                {running
                  ? `CBM LIVE — VIB:${vibFault.toUpperCase()} · CUR:${curFault.toUpperCase()} · TEMP:${tempFault.toUpperCase()} · WIN #${cbmData?.window_idx ?? 0}`
                  : 'PRESS ▶ START TO BEGIN SYNTHETIC DATA GENERATION'}
              </div>
            </ControlPanelSection>
          </div>


          {/* ══ RIGHT COLUMN ══ */}
          <div className={styles.rightColumn}>
            
            {/* K_Noise Control - Moved to top right */}
            <IndustrialKnobControl
              label="k_noise"
              sublabel="Noise sensitivity factor"
              value={kNoise}
              min={0.05} max={0.25} unit="" step={0.01}
              onChange={setKNoiseState}
            />
            
            <SensorStatusCard
              sensors={SENSOR_DEFS}
              values={{ ewmaSlow, ewmaFast, gap }}
            />
            
            {/* Alert Indicators - Three-tier system */}
            {alertData && ewmaData && (
              <AlertIndicators
                alerts={alertData.current_alerts}
                ewma={currentEWMA}
                slope={currentData?.slope || 0}
                variance={currentData?.variance || 0}
                cycleTime={currentCycleTime}
                config={ewmaData.config}
              />
            )}
          </div>

        </div>

        {/* Full Width Real-Time Data Section - Below Everything */}
        <div className={styles.fullWidthSection}>
          {/* Real-Time Interrupt & Alert Data Display - Full Width */}
          <div className={`${styles.card} ${styles.dataCard}`}>
            <Screws count={4} />
            <div className={`${styles.cardTitle} ${styles.dataCardTitle}`}>REAL-TIME INTERRUPT & ALERT DATA</div>
            
            {/* Current Status Row */}
            <div className={styles.statusRow}>
              {/* EWMA Slow (Baseline) */}
              <div className={styles.statusBox}>
                <div className={styles.statusBoxLabel}>
                  EWMA SLOW (BASELINE)
                </div>
                <div className={`${styles.statusBoxValue} ${
                  ewmaSlow > 5.75 ? styles.statusBoxValueRed : 
                  ewmaSlow > 5.5 ? styles.statusBoxValueYellow : 
                  styles.statusBoxValueGreen
                }`}>
                  {ewmaSlow.toFixed(3)}
                </div>
                <div className={styles.statusBoxUnit}>
                  A
                </div>
              </div>

              {/* EWMA Fast (Trend) */}
              <div className={styles.statusBox}>
                <div className={styles.statusBoxLabel}>
                  EWMA FAST (TREND)
                </div>
                <div className={`${styles.statusBoxValue} ${
                  ewmaFast > 5.8 ? styles.statusBoxValueRed : 
                  ewmaFast > 5.4 ? styles.statusBoxValueYellow : 
                  styles.statusBoxValueCyan
                }`}>
                  {ewmaFast.toFixed(3)}
                </div>
                <div className={styles.statusBoxUnit}>
                  A
                </div>
              </div>

              {/* Gap (Fast - Slow) */}
              <div className={styles.statusBox}>
                <div className={styles.statusBoxLabel}>
                  GAP (FAST - SLOW)
                </div>
                <div className={`${styles.statusBoxValue} ${
                  gap > 0.20 ? styles.statusBoxValueRed : 
                  gap > 0.10 ? styles.statusBoxValueYellow : 
                  styles.statusBoxValueGreen
                }`}>
                  {gap.toFixed(4)}
                </div>
                <div className={styles.statusBoxUnit}>
                  A
                </div>
              </div>

              {/* Current Wear Rate */}
              <div className={styles.statusBox}>
                <div className={styles.statusBoxLabel}>
                  WEAR RATE
                </div>
                <div className={`${styles.statusBoxValue} ${
                  wearRate > 0.02 ? styles.statusBoxValueRed : 
                  wearRate > 0.01 ? styles.statusBoxValueYellow : 
                  styles.statusBoxValueGreen
                }`}>
                  {wearRate.toFixed(3)}
                </div>
                <div className={styles.statusBoxUnit}>
                  A/u
                </div>
              </div>

              {/* Alert Status */}
              <div className={styles.interruptStatus}>
                <div className={styles.interruptStatusLabel}>
                  ALERT STATUS:
                </div>
                <div className={styles.interruptStatusTags}>
                  {alertData?.current_alerts?.late && (
                    <span className={`${styles.statusTag} ${styles.statusTagReset}`}>
                      🚨 LATE
                    </span>
                  )}
                  {alertData?.current_alerts?.mid && !alertData?.current_alerts?.late && (
                    <span className={`${styles.statusTag} ${styles.statusTagChange}`}>
                      ⚠️ MID
                    </span>
                  )}
                  {alertData?.current_alerts?.early && !alertData?.current_alerts?.mid && !alertData?.current_alerts?.late && (
                    <span className={`${styles.statusTag} ${styles.statusTagChange}`}>
                      ⚠️ EARLY
                    </span>
                  )}
                  {!alertData?.current_alerts?.early && !alertData?.current_alerts?.mid && !alertData?.current_alerts?.late && (
                    <span className={`${styles.statusTag} ${styles.statusTagStable}`}>
                      ✅ NORMAL
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Real-time Data Tables */}
            <div className={styles.dataTables}>
              
              {/* Recent Events & Interrupts Table */}
              <div className={styles.dataTable}>
                <div className={styles.dataTableHeader}>
                  <span>RECENT EVENTS & INTERRUPTS:</span>
                  <span>({events.length} total)</span>
                </div>
                
                {/* Table Header */}
                <div className={`${styles.tableHeaderRow} ${styles.eventsTableHeader}`}>
                  <div>Timestamp</div>
                  <div>Time(t)</div>
                  <div>New Wear Rate</div>
                  <div>I_base noted</div>
                  <div>Action</div>
                </div>
                
                {events.length === 0 ? (
                  <div className={styles.emptyTableMessage}>
                    No events recorded yet...
                  </div>
                ) : (
                  <div className={styles.tableRows}>
                    {events.slice(-8).reverse().map((event, index) => (
                      <div key={index} className={`${styles.tableRow} ${styles.eventsTableRow}`}>
                        <div className={`${styles.tableCell} ${styles.tableCellSmall}`}>
                          {event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString()}
                        </div>
                        <div className={`${styles.tableCell} ${styles.tableCellCyan}`}>
                          {event.time ?? event.t ?? currentData?.t ?? 'N/A'}
                        </div>
                        <div className={`${styles.tableCell} ${
                          (event.new_wear_rate ?? event.wear_rate ?? 0) > 0.02 ? styles.tableCellRed : 
                          (event.new_wear_rate ?? event.wear_rate ?? 0) > 0.01 ? styles.tableCellYellow : styles.tableCellGreen
                        }`}>
                          {(event.new_wear_rate ?? event.wear_rate ?? 0).toFixed(3)}
                        </div>
                        <div className={`${styles.tableCell} ${styles.tableCellCyan}`}>
                          {(event.I_base_noted ?? event.current ?? 5.0).toFixed(3)}
                        </div>
                        <div className={`${styles.tableCell} ${styles.tableCellSmall} ${
                          event.action === 'RESET' ? styles.tableCellRed : styles.tableCellGray
                        }`}>
                          {event.action || 'None'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Footer note */}
                <div className={styles.tableFooter}>
                  I_base noted = motor current at the exact moment of the interrupt.
                </div>
              </div>

              {/* Alert History Table */}
              <div className={styles.dataTable}>
                <div className={styles.dataTableHeader}>
                  <span>ALERT HISTORY:</span>
                  <span>({(alertData?.alert_history?.early?.length || 0) + (alertData?.alert_history?.mid?.length || 0) + (alertData?.alert_history?.late?.length || 0)} total)</span>
                </div>
                
                {/* Alert Table Header */}
                <div className={`${styles.tableHeaderRow} ${styles.alertsTableHeader}`}>
                  <div>Time(t)</div>
                  <div>Type</div>
                  <div>EWMA</div>
                  <div>Status</div>
                </div>
                
                {(!alertData?.alert_history || 
                  (!alertData.alert_history.early?.length && 
                   !alertData.alert_history.mid?.length && 
                   !alertData.alert_history.late?.length)) ? (
                  <div className={styles.emptyTableMessage}>
                    No alerts recorded yet...
                  </div>
                ) : (
                  <div className={styles.tableRows}>
                    {/* Combine all alert types and show recent ones */}
                    {[
                      // Backend now returns {t, ewma, timestamp} objects.
                      // Guard handles legacy number format too.
                      ...(alertData.alert_history.early || []).map((item: any) => ({
                        t:         typeof item === 'object' ? item.t         : item,
                        ewma:      typeof item === 'object' ? item.ewma      : null,
                        timestamp: typeof item === 'object' ? item.timestamp : null,
                        type:      'early',
                        active:    alertData.current_alerts?.early === true,
                      })),
                      ...(alertData.alert_history.mid || []).map((item: any) => ({
                        t:         typeof item === 'object' ? item.t         : item,
                        ewma:      typeof item === 'object' ? item.ewma      : null,
                        timestamp: typeof item === 'object' ? item.timestamp : null,
                        type:      'mid',
                        active:    alertData.current_alerts?.mid === true,
                      })),
                      ...(alertData.alert_history.late || []).map((item: any) => ({
                        t:         typeof item === 'object' ? item.t         : item,
                        ewma:      typeof item === 'object' ? item.ewma      : null,
                        timestamp: typeof item === 'object' ? item.timestamp : null,
                        type:      'late',
                        active:    alertData.current_alerts?.late === true,
                      })),
                    ]
                    .sort((a, b) => (b.t || 0) - (a.t || 0)) // newest first
                    .slice(0, 8)
                    .map((alert: any, index: number) => (
                      <div key={index} className={`${styles.tableRow} ${styles.alertsTableRow}`}>
                        <div className={`${styles.tableCell} ${styles.tableCellCyan}`}>
                          {alert.t != null ? `t=${alert.t}` : 'N/A'}
                        </div>
                        <div className={`${styles.tableCell} ${styles.tableCellSmall} ${styles.tableCellUppercase} ${
                          alert.type === 'early' ? styles.tableCellGreen : 
                          alert.type === 'mid' ? styles.tableCellYellow : 
                          alert.type === 'late' ? styles.tableCellRed : styles.tableCellGray
                        }`}>
                          {alert.type || 'N/A'}
                        </div>
                        <div className={`${styles.tableCell} ${styles.tableCellCyan}`}>
                          {alert.ewma != null ? Number(alert.ewma).toFixed(3) + 'A' : '—'}
                        </div>
                        <div className={`${styles.tableCell} ${styles.tableCellSmall} ${
                          alert.active ? styles.tableCellRed : styles.tableCellGreen
                        }`}>
                          {alert.active ? 'ACTIVE' : 'CLEARED'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Enhanced Alert Popup - Positioned at document level with highest z-index */}
        {showAlertPopup && currentData && alertData && (
          <div className={styles.alertPopupOverlay}>
            <div className={styles.alertPopupContainer}>
              <EnhancedAlertPopup
                alerts={alertData.current_alerts}
                ewma={currentEWMA}
                slope={currentData.slope}
                variance={currentData.variance}
                cycleTime={currentCycleTime}
                onDismiss={() => setShowAlertPopup(false)}
                onAction={handleAlertAction}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

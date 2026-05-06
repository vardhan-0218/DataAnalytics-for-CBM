import { useState, useEffect, useRef } from 'react';
import { 
  startSimulation, 
  getStepData, 
  interruptSimulation, 
  emergencyStop,
  setMotorCurrent, 
  setKNoise, 
  getHistory, 
  getEvents,
  getEWMAData,
  getAlerts,
  getSystemStatus,
  healthCheck,
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
const SENSOR_DEFS: SensorDef[] = [
  {
    key: 'motorCurrent',
    label: 'Motor Current',
    unit: 'A',
    greenZone: [40, 70],
    yellowZone: [70, 85],
    redZone: [85, 100],
    decimals: 1,
  },
  {
    key: 'vacuumPressure',
    label: 'Vacuum Pressure',
    unit: 'inHg',
    greenZone: [30, 45],
    yellowZone: [45, 52],
    redZone: [52, 60],
    decimals: 1,
  },
  {
    key: 'airPressure',
    label: 'Air Pressure',
    unit: 'psi',
    greenZone: [75, 95],
    yellowZone: [95, 105],
    redZone: [105, 120],
    decimals: 0,
  },
];

// ─────────────────────────────────────────
// Main Dashboard Component
// ─────────────────────────────────────────
export default function Dashboard() {
  // ── Session state (matching Streamlit exactly) ────────────────────────────
  const [running, setRunning] = useState(false);
  const [lastWearRate, setLastWearRate] = useState(0.0);
  const [speed, setSpeed] = useState(0.3); // 1/speed_hz where speed_hz=2.0 initially
  const [pendingWearReset, setPendingWearReset] = useState(false);
  
  // ── Parameter state (matching Streamlit defaults) ─────────────────────────
  const [speedHz, setSpeedHz] = useState(2.0);
  const [motorCurrentParam, setMotorCurrentParam] = useState(5.0); // I_BASE_INIT
  const [kNoise, setKNoiseState] = useState(0.05);
  const [wearRate, setWearRate] = useState(0.0); // Initially 0.0 like Streamlit
  const [cycleTimeParam, setCycleTimeParam] = useState(2.0); // New cycle time control
  
  // ── Simulation data ───────────────────────────────────────────────────────
  const [history, setHistory] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [currentData, setCurrentData] = useState<StepData | null>(null);
  const [ewmaData, setEWMAData] = useState<EWMAData | null>(null);
  const [alertData, setAlertData] = useState<AlertData | null>(null);
  
  // ── UI display values ─────────────────────────────────────────────────────
  const [motorCurrent, setMotorCurrentDisplay] = useState(65);
  const [vacuumPressure, setVacuumPressure] = useState(42);
  const [airPressure, setAirPressure] = useState(88);
  
  // ── Chart data ────────────────────────────────────────────────────────────
  const [chartHistory, setChartHistory] = useState<TelemetryPoint[]>([]);
  
  // ── Connection state ──────────────────────────────────────────────────────
  const [isConnected, setIsConnected] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [systemStatus, setSystemStatus] = useState<any>(null);
  
  // ── Machine selection (UI only) ───────────────────────────────────────────
  const [selectedMachine, setSelectedMachine] = useState<'M1' | 'M2' | 'M3'>('M1');
  
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

  // ── Refs for tracking ─────────────────────────────────────────────────────
  const intervalRef = useRef<NodeJS.Timeout>();
  const motorCurrentTimeoutRef = useRef<NodeJS.Timeout>();
  const kNoiseTimeoutRef = useRef<NodeJS.Timeout>();
  // Mirror of lastAlertState as a ref so the step interval can compare
  // previous vs current alert flags WITHOUT being in the dependency array.
  // This prevents the interval from restarting (and creating timing gaps)
  // every time an alert fires.
  const lastAlertStateRef = useRef<AlertState>({ early: false, mid: false, late: false });

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
        // Check system integration status
        const status = await getSystemStatus();
        setSystemStatus(status);
        if (status && !status.integration_check.all_modules_loaded) {
          setConnectionError('System integration issue detected. Some modules may not be properly loaded.');
        }
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
    }, 100); // Faster than React's 300ms to match Streamlit immediacy
  }, [motorCurrentParam]);

  useEffect(() => {
    if (kNoiseTimeoutRef.current) clearTimeout(kNoiseTimeoutRef.current);
    kNoiseTimeoutRef.current = setTimeout(() => {
      setKNoise(kNoise); // calls the imported API function
    }, 100);
  }, [kNoise]);

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

  // ── Speed calculation (matching Streamlit: speed = 1.0 / speed_hz) ────────
  useEffect(() => {
    setSpeed(1.0 / speedHz);
  }, [speedHz]);

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
    setHistory([]);
    setEvents([]);
    setCurrentData(null);
    setChartHistory([]);
    setEWMAData(null);
    setAlertData(null);
    
    // Reset all UI display values to initial state
    setMotorCurrentDisplay(65);
    setVacuumPressure(42);
    setAirPressure(88);
    
    // Reset parameters to initial values
    setMotorCurrentParam(5.0);
    setKNoiseState(0.05);
    setCycleTimeParam(2.0);
    setSpeedHz(2.0);
    
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
    
    // Close any open alert popups
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

  // ── Simulation step loop — 1 s tick, alerts from step data directly ────────
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
              slope:     data.slope,
              variance:  data.variance,
              cycleTime: data.cycle_time,
            };
            
            // Debug logging for data validation
            if (data.t <= 5) { // Only log first 5 points to avoid spam
              console.log(`Chart point t=${data.t}:`, {
                current: data.current,
                ewma: data.ewma,
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
            const newEarly = stepAlerts.early && !prev.early;
            const newMid   = stepAlerts.mid   && !prev.mid;
            const newLate  = stepAlerts.late  && !prev.late;

            if (newEarly || newMid || newLate) {
              setShowAlertPopup(true);
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

          // ── Sensor gauge display ─────────────────────────────────────────
          setMotorCurrentDisplay(Math.max(50, Math.min(100, data.current * 12)));
          const deg = data.degradation || 0;
          setVacuumPressure(Math.max(30, Math.min(60, 42 + deg * 20 + (Math.random() - 0.5) * 2)));
          setAirPressure(Math.max(75, Math.min(120, 88 + deg * 15 + (Math.random() - 0.5) * 3)));

          // ── Non-critical background fetches (don’t block chart render) ──────
          getEWMAData().then(ewma => { if (ewma) setEWMAData(ewma); });
          getHistory(50).then(h   => { if (h)    setHistory(h); });
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

  // Alert thresholds - use real EWMA data
  const currentAlerts = alertData?.current_alerts || { early: false, mid: false, late: false };
  const isWarning = currentAlerts.early || currentAlerts.mid;
  const isCritical = currentAlerts.late;
  const showAlert = isWarning || isCritical;

  // Get latest data for display
  const latest = history.length > 0 ? history[history.length - 1] : null;
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
          <div className={styles.machineButtons}>
            {(['M1', 'M2', 'M3'] as const).map(m => (
              <button
                key={m}
                onClick={() => setSelectedMachine(m)}
                className={`${styles.machineButton} ${selectedMachine === m ? styles.machineButtonActive : styles.machineButtonInactive}`}
              >{m}</button>
            ))}
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
                  { label: 'Running',  active: running,            type: 'green' },
                  { label: 'Warning',  active: motorCurrent > 85, type: 'yellow' },
                  { label: 'Critical', active: false,             type: 'red' },
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

            {/* ── Advanced Motor Telemetry — Enhanced graph with zoom/pan ── */}
            <div className={styles.graphContainer}>
              <ErrorBoundary fallback={
                <div className={styles.graphError}>
                  <div>GRAPH RENDERING ERROR</div>
                  <div className={styles.graphErrorSubtext}>
                    Please check console for details
                  </div>
                </div>
              }>
                <AdvancedTelemetryGraph 
                  history={chartHistory}
                  alerts={lastAlertState}
                  config={{
                    alpha: 0.1,
                    mu: 5.0,
                    ucl2Sigma: 5.5,
                    ucl3Sigma: 5.75,
                    windowSize: 300,
                  }}
                />
              </ErrorBoundary>
            </div>

            {/* Advanced Alert System Status - Below Graph */}
            <ControlPanelSection>
              <div className={styles.alertSystemStatus}>
                ADVANCED ALERT SYSTEM ACTIVE - REAL-TIME EWMA MONITORING
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
              values={{ motorCurrent, vacuumPressure, airPressure }}
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
              {/* Current Wear Rate */}
              <div className={styles.statusBox}>
                <div className={styles.statusBoxLabel}>
                  CURRENT WEAR RATE
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

              {/* Last Wear Rate */}
              <div className={styles.statusBox}>
                <div className={styles.statusBoxLabel}>
                  LAST WEAR RATE
                </div>
                <div className={`${styles.statusBoxValue} ${styles.statusBoxValueCyan}`}>
                  {lastWearRate.toFixed(3)}
                </div>
                <div className={styles.statusBoxUnit}>
                  A/u
                </div>
              </div>

              {/* Interrupt Status */}
              <div className={styles.interruptStatus}>
                <div className={styles.interruptStatusLabel}>
                  INTERRUPT STATUS:
                </div>
                <div className={styles.interruptStatusTags}>
                  {pendingWearReset && (
                    <span className={`${styles.statusTag} ${styles.statusTagReset}`}>
                      RESET PENDING
                    </span>
                  )}
                  {wearRate !== lastWearRate && !pendingWearReset && (
                    <span className={`${styles.statusTag} ${styles.statusTagChange}`}>
                      CHANGE DETECTED
                    </span>
                  )}
                  {wearRate === lastWearRate && !pendingWearReset && (
                    <span className={`${styles.statusTag} ${styles.statusTagStable}`}>
                      STABLE
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

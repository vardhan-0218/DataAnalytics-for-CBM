/**
 * DigitalTwin.tsx — Full Six-Section Synthetic Data Control Panel
 *
 * Implements the Section 4 UI spec connected to /api/synthetic/* backend.
 * Design rule: Only the six-section Control JSON crosses the UI→backend boundary.
 * All internal model constants (k1/k2/Ri/mBF/etc.) are derived by parameter_mapper.py.
 *
 * Layout:
 *   LEFT SIDEBAR — Six control sections
 *   RIGHT MAIN   — KPI row, live waveform tabs, FFT, feature grid, health gauges, EWMA trends
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import styles from './DigitalTwin.module.css';
import {
  getSyntheticHealth,
  getSyntheticHistory,
  getSyntheticSignal,
  getSyntheticStatus,
  postControlJson,
  resetSynthetic,
  getSyntheticPresets,
  applySyntheticPreset,
  healthCheck,
  type SyntheticControlJson,
  type FaultEntry,
} from '../services/api';

// ────────────────────────────────────────────────────────────────────────────
// Default Control JSON (matches spec §5 DEFAULT_CONTROL_JSON)
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_CTRL: SyntheticControlJson = {
  machine: {
    machine_name: 'Food Pulverizer',
    motor_rating_kw: 7.5,
    motor_speed_rpm: 3000,
    rotor_frequency_hz: 50.0,
    grinding_frequency_hz: 300,
  },
  signals: { vibration: true, current: true, temperature: true },
  simulation: {
    sampling_frequency: { vibration: 5000, current: 1000, temperature: 1 },
    window_length_sec: 1,
    duration_sec: 60,
    noise_level: 0.02,
  },
  machine_faults: {
    healthy: true,
    blade_wear:    { enabled: false, severity: 50 },
    bearing_fault: { enabled: false, severity: 50 },
    misalignment:  { enabled: false, severity: 50 },
    imbalance:     { enabled: false, severity: 50 },
    looseness:     { enabled: false, severity: 50 },
  },
  process_faults: {
    material_buildup: { enabled: false, severity: 50 },
    partial_clogging: { enabled: false, severity: 50 },
    choking:          { enabled: false, severity: 50 },
  },
  output: { csv: true, json: true, mat: false },
};

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface HealthData {
  window_idx: number;
  timestamp: string;
  indices: { MHI: number; PQI: number; GQI: number };
  alarms: { early: boolean; mid: boolean; late: boolean; normal: boolean; severity: string; min_index: number };
  kpis: { CycleTime: number; Throughput: number; GrindingEfficiency: number; LoadRatio: number; BatchMass: number };
  ewma: Record<string, Record<string, number>>;
  features: {
    vibration: Record<string, number>;
    current: Record<string, number>;
    temperature: Record<string, number>;
  };
  severity: Record<string, number>;
}

type ChartTab = 'vibration' | 'current' | 'temperature' | 'fft';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function fmt(v: number | undefined, d = 2): string {
  if (v === undefined || v === null || isNaN(v)) return '—';
  return v.toFixed(d);
}

function gaugeColor(v: number): string {
  if (v >= 85) return '#10b981';
  if (v >= 65) return '#f59e0b';
  return '#ef4444';
}

function alarmColor(sev: string): string {
  const m: Record<string, string> = { NORMAL: '#10b981', EARLY: '#f59e0b', MID: '#f97316', LATE: '#ef4444' };
  return m[sev] ?? '#10b981';
}

function SeveritySlider({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const fill = value + '%';
  return (
    <div className={styles.severitySection}>
      <div className={styles.severityLabel}>
        <span className={styles.severityName}>Severity</span>
        <span className={styles.severityValue}>{value}%</span>
      </div>
      <input
        type="range" min={0} max={100} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className={styles.slider}
        style={{ '--fill': fill } as React.CSSProperties}
        disabled={disabled}
      />
      <div className={styles.severityTicks}>
        {['0', '25', '50', '75', '100'].map(t => (
          <span key={t} className={styles.tick}>{t}%</span>
        ))}
      </div>
    </div>
  );
}

function GaugeArc({ value, color, label, size = 120 }: { value: number; color: string; label: string; size?: number }) {
  const r = 44;
  const cx = 60;
  const cy = 58;
  const startAngle = -200;
  const endAngle = 20;
  const totalDeg = endAngle - startAngle;
  const angle = startAngle + (value / 100) * totalDeg;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const arc = (deg: number) => ({
    x: cx + r * Math.cos(toRad(deg)),
    y: cy + r * Math.sin(toRad(deg)),
  });
  const s = arc(startAngle);
  const e = arc(angle);
  const largeArc = angle - startAngle > 180 ? 1 : 0;
  const pathData = `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
  const bgEnd = arc(endAngle);
  const bgLarge = totalDeg > 180 ? 1 : 0;
  const bgPath = `M ${s.x} ${s.y} A ${r} ${r} 0 ${bgLarge} 1 ${bgEnd.x} ${bgEnd.y}`;
  return (
    <div className={styles.gaugeCard}>
      <div className={styles.gaugeName}>{label}</div>
      <div className={styles.gaugeArcWrapper} style={{ width: size, height: size * 0.6 }}>
        <svg viewBox="0 0 120 70" className={styles.gaugeSvg} width={size} height={size * 0.6}>
          <path d={bgPath} fill="none" stroke="rgba(30,41,59,0.8)" strokeWidth={8} strokeLinecap="round" />
          <path d={pathData} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: 'stroke 0.4s, d 0.4s' }} />
        </svg>
        <div className={styles.gaugeValueText} style={{ color }}>
          {value > 0 ? Math.round(value) : '—'}
        </div>
      </div>
      <div className={`${styles.gaugeStatus} ${value >= 85 ? styles.gaugeNormal : value >= 65 ? styles.gaugeWarning : styles.gaugeCritical}`}>
        {value >= 85 ? 'HEALTHY' : value >= 65 ? 'DEGRADED' : 'CRITICAL'}
      </div>
    </div>
  );
}

// Mini sparkline SVG
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data.length) return null;
  const h = 36, w = 160;
  const mn = Math.min(...data), mx = Math.max(...data);
  const range = mx - mn || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1 || 1)) * w;
    const y = h - ((v - mn) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5}
                style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Waveform chart (SVG polyline, scrollable)
// ────────────────────────────────────────────────────────────────────────────

function WaveformChart({ samples, color, label }: { samples: number[]; color: string; label: string }) {
  if (!samples.length) return (
    <div className={styles.chartCanvas} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: 'rgba(148,163,184,0.4)', fontSize: '0.85rem' }}>Waiting for data…</span>
    </div>
  );
  const N = Math.min(samples.length, 600);
  const slice = samples.slice(-N);
  const mn = Math.min(...slice), mx = Math.max(...slice);
  const pad = (mx - mn) * 0.1 || 0.1;
  const lo = mn - pad, hi = mx + pad;
  const W = 100, H = 100; // viewBox percentages
  const pts = slice.map((v, i) => {
    const x = (i / (N - 1 || 1)) * W;
    const y = H - ((v - lo) / (hi - lo)) * H;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  return (
    <div className={styles.chartCanvas}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
           className={styles.waveformSvg}>
        <defs>
          <linearGradient id={`wg-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.15" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* Zero line */}
        {mn < 0 && mx > 0 && (
          <line x1="0" y1={((hi / (hi - lo)) * H).toFixed(2)} x2={String(W)}
                y2={((hi / (hi - lo)) * H).toFixed(2)}
                stroke="rgba(100,116,139,0.3)" strokeWidth="0.3" strokeDasharray="2,2" />
        )}
        <polyline points={pts} fill={`url(#wg-${label})`} stroke={color}
                  strokeWidth="0.8" style={{ filter: `drop-shadow(0 0 2px ${color})` }} />
      </svg>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// FFT chart
// ────────────────────────────────────────────────────────────────────────────

function FFTChart({ freqs, magnitudes }: { freqs: number[]; magnitudes: number[] }) {
  if (!freqs.length) return (
    <div className={styles.chartCanvas} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: 'rgba(148,163,184,0.4)', fontSize: '0.85rem' }}>Waiting for FFT data…</span>
    </div>
  );
  const maxF = 1000;
  const idx = freqs.findIndex(f => f > maxF);
  const fSlice = idx > 0 ? freqs.slice(0, idx) : freqs;
  const mSlice = idx > 0 ? magnitudes.slice(0, idx) : magnitudes;
  const mx = Math.max(...mSlice) || 1;
  const W = 100, H = 100;
  const pts = fSlice.map((f, i) => {
    const x = (f / maxF) * W;
    const y = H - (mSlice[i] / mx) * H * 0.92;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  return (
    <div className={styles.chartCanvas}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={styles.waveformSvg}>
        <defs>
          <linearGradient id="fftGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#bc8cff" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#bc8cff" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polyline points={pts + ` ${((fSlice[fSlice.length-1]??0)/maxF*W).toFixed(2)},${H} 0,${H}`}
                  fill="url(#fftGrad)" stroke="#bc8cff" strokeWidth="0.6"
                  style={{ filter: 'drop-shadow(0 0 2px #bc8cff)' }} />
      </svg>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────────────

export default function DigitalTwin() {
  // ── Control JSON state ───────────────────────────────────────────────────
  const [ctrl, setCtrl] = useState<SyntheticControlJson>(DEFAULT_CTRL);
  const updateCtrl = useCallback((patch: Partial<SyntheticControlJson>) => {
    setCtrl(prev => ({ ...prev, ...patch }));
  }, []);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [chartTab, setChartTab] = useState<ChartTab>('vibration');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [presets, setPresets] = useState<string[]>([]);

  // ── Data state ───────────────────────────────────────────────────────────
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [signals, setSignals] = useState<any | null>(null);
  const [windowCount, setWindowCount] = useState(0);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const tickRef = useRef<NodeJS.Timeout>();
  const lastCtrlRef = useRef<string>('');
  const configTimeoutRef = useRef<NodeJS.Timeout>();

  // ── Clock ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Health check + presets on mount ──────────────────────────────────────
  useEffect(() => {
    healthCheck().then(ok => setIsConnected(ok));
    getSyntheticPresets().then(p => { if (p) setPresets(p); });
  }, []);

  // ── Auto-send Control JSON when it changes (debounced 400ms) ─────────────
  useEffect(() => {
    const key = JSON.stringify(ctrl);
    if (key === lastCtrlRef.current) return;
    lastCtrlRef.current = key;
    if (configTimeoutRef.current) clearTimeout(configTimeoutRef.current);
    configTimeoutRef.current = setTimeout(() => {
      postControlJson(ctrl).catch(() => {});
    }, 400);
  }, [ctrl]);

  // ── Simulation tick loop ──────────────────────────────────────────────────
  useEffect(() => {
    if (!running || !isConnected) return;

    const tick = async () => {
      try {
        const [hd, sig, hist] = await Promise.all([
          getSyntheticHealth(),
          getSyntheticSignal(),
          getSyntheticHistory(80),
        ]);
        if (hd) { setHealthData(hd as HealthData); setWindowCount(hd.window_idx ?? 0); }
        if (sig) setSignals(sig);
        if (hist) setHistory(hist);
      } catch {
        setIsConnected(false);
      }
    };

    tick();
    tickRef.current = setInterval(tick, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [running, isConnected]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleStart = async () => {
    const ok = await healthCheck();
    setIsConnected(ok);
    if (!ok) return;
    await postControlJson(ctrl);
    setRunning(true);
  };

  const handleStop = () => {
    setRunning(false);
    if (tickRef.current) clearInterval(tickRef.current);
  };

  const handleReset = async () => {
    handleStop();
    setHealthData(null);
    setHistory([]);
    setSignals(null);
    setWindowCount(0);
    await resetSynthetic();
    setCtrl(DEFAULT_CTRL);
  };

  const handlePreset = async (name: string) => {
    await applySyntheticPreset(name);
    const hd = await getSyntheticHealth();
    if (hd) setHealthData(hd as HealthData);
  };

  // ── Fault toggle helpers ──────────────────────────────────────────────────
  const setMachineFault = (key: keyof typeof ctrl.machine_faults, patch: Partial<FaultEntry> | boolean) => {
    setCtrl(prev => ({
      ...prev,
      machine_faults: {
        ...prev.machine_faults,
        [key]: typeof patch === 'boolean' ? patch
          : { ...((prev.machine_faults[key] as FaultEntry) ?? { enabled: false, severity: 50 }), ...patch },
      },
    }));
  };

  const setProcessFault = (key: keyof typeof ctrl.process_faults, patch: Partial<FaultEntry>) => {
    setCtrl(prev => ({
      ...prev,
      process_faults: {
        ...prev.process_faults,
        [key]: { ...prev.process_faults[key], ...patch },
      },
    }));
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const mhi = healthData?.indices?.MHI ?? 0;
  const pqi = healthData?.indices?.PQI ?? 0;
  const gqi = healthData?.indices?.GQI ?? 0;
  const alarmSev = healthData?.alarms?.severity ?? 'NORMAL';
  const alarmColor_ = alarmColor(alarmSev);
  const kpis = healthData?.kpis;
  const vf = healthData?.features?.vibration ?? {};
  const cf = healthData?.features?.current ?? {};
  const tf = healthData?.features?.temperature ?? {};

  // History sparklines
  const mhiHist = history.map(r => r.MHI ?? 0);
  const pqiHist = history.map(r => r.PQI ?? 0);
  const gqiHist = history.map(r => r.GQI ?? 0);
  const ctHist  = history.map(r => r.CycleTime ?? 0);

  const anyFaultActive = Object.entries(ctrl.machine_faults).some(([k, v]) =>
    k !== 'healthy' && typeof v === 'object' && (v as FaultEntry).enabled
  ) || Object.values(ctrl.process_faults).some(v => v.enabled);

  // ── Waveform data for selected tab ────────────────────────────────────────
  const waveformSamples: Record<ChartTab, number[]> = {
    vibration:   signals?.vibration   ?? [],
    current:     signals?.current     ?? [],
    temperature: signals?.temperature ?? [],
    fft:         [],
  };
  const waveformColors: Record<ChartTab, string> = {
    vibration: '#00b4ff', current: '#f59e0b', temperature: '#f97316', fft: '#bc8cff',
  };

  // Fault row renderer
  const FaultRow = ({
    label, faultKey, color, icon,
  }: { label: string; faultKey: keyof typeof ctrl.machine_faults; color: string; icon: string }) => {
    const entry = ctrl.machine_faults[faultKey] as FaultEntry;
    return (
      <div style={{ marginBottom: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={entry.enabled}
            onChange={e => setMachineFault(faultKey, { enabled: e.target.checked })}
            disabled={ctrl.machine_faults.healthy}
            style={{ accentColor: color, width: 14, height: 14 }}
          />
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: entry.enabled ? color : 'rgba(148,163,184,0.7)' }}>
            {icon} {label}
          </span>
          {entry.enabled && (
            <span style={{
              marginLeft: 'auto', fontSize: '0.63rem', padding: '1px 6px',
              background: `${color}20`, border: `1px solid ${color}60`,
              color, borderRadius: 4, fontFamily: 'monospace',
            }}>
              {entry.severity}%
            </span>
          )}
        </label>
        {entry.enabled && !ctrl.machine_faults.healthy && (
          <SeveritySlider value={entry.severity} onChange={v => setMachineFault(faultKey, { severity: v })} />
        )}
      </div>
    );
  };

  const ProcessFaultRow = ({
    label, faultKey, color, icon,
  }: { label: string; faultKey: keyof typeof ctrl.process_faults; color: string; icon: string }) => {
    const entry = ctrl.process_faults[faultKey];
    return (
      <div style={{ marginBottom: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={entry.enabled}
            onChange={e => setProcessFault(faultKey, { enabled: e.target.checked })}
            style={{ accentColor: color, width: 14, height: 14 }}
          />
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: entry.enabled ? color : 'rgba(148,163,184,0.7)' }}>
            {icon} {label}
          </span>
          {entry.enabled && (
            <span style={{
              marginLeft: 'auto', fontSize: '0.63rem', padding: '1px 6px',
              background: `${color}20`, border: `1px solid ${color}60`,
              color, borderRadius: 4, fontFamily: 'monospace',
            }}>
              {entry.severity}%
            </span>
          )}
        </label>
        {entry.enabled && (
          <SeveritySlider value={entry.severity} onChange={v => setProcessFault(faultKey, { severity: v })} />
        )}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.container}>

      {/* ── HEADER ── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Link to="/" className={styles.backBtn}>← Dashboard</Link>
          <div>
            <div className={styles.headerTitle}>⚙️ FOOD PULVERIZER — DIGITAL TWIN</div>
            <div className={styles.headerSubtitle}>Stage-1 · Synthetic CBM Data Generator · Six-Section Control Panel</div>
          </div>
        </div>
        <div className={styles.headerRight}>
          {running && (
            <div className={styles.liveIndicator}>
              <div className={styles.liveDot} />
              LIVE · Win #{windowCount}
            </div>
          )}
          {!isConnected && (
            <span style={{ fontSize: '0.72rem', color: '#ef4444', fontFamily: 'monospace' }}>
              ⚠ Backend offline
            </span>
          )}
          <span style={{ fontSize: '0.72rem', color: 'rgba(148,163,184,0.7)', fontFamily: 'monospace' }}>
            {currentTime.toLocaleTimeString()}
          </span>
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div className={styles.content}>

        {/* ══════════════════════════ LEFT SIDEBAR ══════════════════════════ */}
        <div className={styles.controlPanel}>

          {/* § 1 Machine Configuration */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>🏭 Machine Configuration</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {/* Motor Rating */}
              <div>
                <div style={{ fontSize: '0.65rem', color: 'rgba(148,163,184,0.6)', marginBottom: 4 }}>Motor (kW)</div>
                <select
                  value={ctrl.machine.motor_rating_kw}
                  onChange={e => updateCtrl({ machine: { ...ctrl.machine, motor_rating_kw: Number(e.target.value) } })}
                  style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(0,180,255,0.2)',
                           borderRadius: 6, color: '#e2e8f0', padding: '6px 8px', fontSize: '0.78rem' }}
                >
                  {[1.5, 2.2, 3.7, 5.5, 7.5, 11, 15, 22].map(v =>
                    <option key={v} value={v}>{v} kW</option>
                  )}
                </select>
              </div>
              {/* Motor Speed */}
              <div>
                <div style={{ fontSize: '0.65rem', color: 'rgba(148,163,184,0.6)', marginBottom: 4 }}>Speed (RPM)</div>
                <select
                  value={ctrl.machine.motor_speed_rpm}
                  onChange={e => {
                    const rpm = Number(e.target.value);
                    updateCtrl({ machine: { ...ctrl.machine, motor_speed_rpm: rpm, rotor_frequency_hz: +(rpm / 60).toFixed(4) } });
                  }}
                  style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(0,180,255,0.2)',
                           borderRadius: 6, color: '#e2e8f0', padding: '6px 8px', fontSize: '0.78rem' }}
                >
                  {[750, 1000, 1450, 1500, 2900, 3000].map(v =>
                    <option key={v} value={v}>{v} RPM</option>
                  )}
                </select>
              </div>
              {/* Vib Fs */}
              <div>
                <div style={{ fontSize: '0.65rem', color: 'rgba(148,163,184,0.6)', marginBottom: 4 }}>Vib Fs (Hz)</div>
                <select
                  value={ctrl.simulation.sampling_frequency.vibration}
                  onChange={e => updateCtrl({ simulation: { ...ctrl.simulation, sampling_frequency: { ...ctrl.simulation.sampling_frequency, vibration: Number(e.target.value) } } })}
                  style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(0,180,255,0.2)',
                           borderRadius: 6, color: '#e2e8f0', padding: '6px 8px', fontSize: '0.78rem' }}
                >
                  {[1000, 2000, 5000, 10000].map(v =>
                    <option key={v} value={v}>{v} Hz</option>
                  )}
                </select>
              </div>
              {/* Window */}
              <div>
                <div style={{ fontSize: '0.65rem', color: 'rgba(148,163,184,0.6)', marginBottom: 4 }}>Window (s)</div>
                <select
                  value={ctrl.simulation.window_length_sec}
                  onChange={e => updateCtrl({ simulation: { ...ctrl.simulation, window_length_sec: Number(e.target.value) } })}
                  style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(0,180,255,0.2)',
                           borderRadius: 6, color: '#e2e8f0', padding: '6px 8px', fontSize: '0.78rem' }}
                >
                  {[0.5, 1, 2, 5].map(v =>
                    <option key={v} value={v}>{v} s</option>
                  )}
                </select>
              </div>
            </div>

            {/* Noise Level */}
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: '0.65rem', color: 'rgba(148,163,184,0.6)' }}>Noise Level</span>
                <span style={{ fontSize: '0.65rem', fontFamily: 'monospace', color: '#00b4ff' }}>
                  {(ctrl.simulation.noise_level * 100).toFixed(0)}%
                </span>
              </div>
              <input type="range" min={0} max={50} value={ctrl.simulation.noise_level * 100}
                onChange={e => updateCtrl({ simulation: { ...ctrl.simulation, noise_level: Number(e.target.value) / 100 } })}
                className={styles.slider}
                style={{ '--fill': `${ctrl.simulation.noise_level * 2}%` } as React.CSSProperties}
              />
            </div>

            {/* fr display */}
            <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(0,180,255,0.06)',
                          border: '1px solid rgba(0,180,255,0.15)', borderRadius: 6,
                          fontFamily: 'monospace', fontSize: '0.7rem', color: 'rgba(148,163,184,0.8)' }}>
              fr = {ctrl.machine.rotor_frequency_hz.toFixed(2)} Hz &nbsp;|&nbsp;
              fg = {ctrl.machine.grinding_frequency_hz} Hz &nbsp;|&nbsp;
              Win = {(ctrl.simulation.sampling_frequency.vibration * ctrl.simulation.window_length_sec).toLocaleString()} samples
            </div>
          </div>

          {/* § 2 Signals */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>📡 Signals to Generate</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['vibration', 'current', 'temperature'] as const).map(sig => (
                <label key={sig} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                                         flex: 1, padding: '6px 8px', borderRadius: 6,
                                         background: ctrl.signals[sig] ? 'rgba(0,180,255,0.1)' : 'rgba(30,41,59,0.4)',
                                         border: `1px solid ${ctrl.signals[sig] ? 'rgba(0,180,255,0.35)' : 'rgba(51,65,85,0.5)'}` }}>
                  <input type="checkbox" checked={ctrl.signals[sig]}
                    onChange={e => updateCtrl({ signals: { ...ctrl.signals, [sig]: e.target.checked } })}
                    style={{ accentColor: '#00b4ff' }}
                  />
                  <span style={{ fontSize: '0.72rem', fontWeight: 600,
                                 color: ctrl.signals[sig] ? '#00b4ff' : 'rgba(148,163,184,0.6)' }}>
                    {sig === 'vibration' ? '〰️ Vib' : sig === 'current' ? '⚡ Cur' : '🌡️ Temp'}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* § 3 Machine Faults */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>🔧 Machine Faults</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={ctrl.machine_faults.healthy}
                onChange={e => setMachineFault('healthy', e.target.checked)}
                style={{ accentColor: '#10b981', width: 14, height: 14 }}
              />
              <span style={{ fontSize: '0.8rem', fontWeight: 600,
                             color: ctrl.machine_faults.healthy ? '#10b981' : 'rgba(148,163,184,0.7)' }}>
                ✅ Healthy (no faults)
              </span>
            </label>
            <FaultRow label="Blade Wear"     faultKey="blade_wear"    color="#f59e0b" icon="🔪" />
            <FaultRow label="Bearing Fault"  faultKey="bearing_fault" color="#ef4444" icon="⚙️" />
            <FaultRow label="Misalignment"   faultKey="misalignment"  color="#f97316" icon="↔️" />
            <FaultRow label="Rotor Imbalance"faultKey="imbalance"     color="#a855f7" icon="🔄" />
            <FaultRow label="Looseness"      faultKey="looseness"     color="#eab308" icon="🔩" />
          </div>

          {/* § 4 Process Faults */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>🌀 Process Faults</div>
            <ProcessFaultRow label="Material Build-up" faultKey="material_buildup" color="#0ea5e9" icon="📦" />
            <ProcessFaultRow label="Partial Clogging"  faultKey="partial_clogging" color="#f97316" icon="🚧" />
            <ProcessFaultRow label="Complete Choking"  faultKey="choking"           color="#ef4444" icon="🛑" />
          </div>

          {/* § 5 Output + Actions */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>💾 Output</div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              {(['csv', 'json', 'mat'] as const).map(fmt => (
                <label key={fmt} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                                         fontSize: '0.78rem', fontWeight: 600,
                                         color: ctrl.output[fmt] ? '#00b4ff' : 'rgba(148,163,184,0.5)' }}>
                  <input type="checkbox" checked={ctrl.output[fmt]}
                    onChange={e => updateCtrl({ output: { ...ctrl.output, [fmt]: e.target.checked } })}
                    style={{ accentColor: '#00b4ff' }}
                  />
                  {fmt.toUpperCase()}
                </label>
              ))}
            </div>

            {/* Presets */}
            {presets.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: '0.65rem', color: 'rgba(148,163,184,0.6)', marginBottom: 6 }}>Quick Presets</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {presets.map(p => (
                    <button key={p} onClick={() => handlePreset(p)}
                      style={{ padding: '3px 8px', borderRadius: 5, fontSize: '0.65rem', fontWeight: 600,
                               background: 'rgba(0,180,255,0.08)', border: '1px solid rgba(0,180,255,0.25)',
                               color: '#00b4ff', cursor: 'pointer' }}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className={styles.controlButtons}>
              {!running ? (
                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleStart} id="btn-generate">
                  ▶ Generate
                </button>
              ) : (
                <button className={`${styles.btn} ${styles.btnStop}`} onClick={handleStop} id="btn-stop">
                  ⏹ Stop
                </button>
              )}
              <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={handleReset} id="btn-reset">
                ↺ Reset
              </button>
            </div>
          </div>

          {/* Active Control JSON preview */}
          <details style={{ marginTop: 2 }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.68rem', color: 'rgba(0,180,255,0.7)',
                              fontFamily: 'monospace', padding: '4px 0' }}>
              📄 Control JSON
            </summary>
            <pre style={{ fontSize: '0.58rem', color: 'rgba(148,163,184,0.7)', overflowX: 'auto',
                          background: 'rgba(15,23,42,0.8)', padding: 8, borderRadius: 6, maxHeight: 200,
                          marginTop: 4, border: '1px solid rgba(51,65,85,0.5)' }}>
              {JSON.stringify(ctrl, null, 2)}
            </pre>
          </details>

        </div>

        {/* ══════════════════════════ RIGHT MAIN AREA ═════════════════════ */}
        <div className={styles.mainArea}>

          {/* ── KPI Row ── */}
          <div className={styles.kpiRow}>
            {[
              { label: 'MHI', value: fmt(mhi, 1), unit: '/100', color: gaugeColor(mhi), trend: mhiHist },
              { label: 'PQI', value: fmt(pqi, 1), unit: '/100', color: gaugeColor(pqi), trend: pqiHist },
              { label: 'GQI', value: fmt(gqi, 1), unit: '/100', color: gaugeColor(gqi), trend: gqiHist },
              { label: 'ALARM', value: alarmSev, unit: '', color: alarmColor_, trend: [] },
              { label: 'Cycle Time', value: fmt(kpis?.CycleTime, 1), unit: 's', color: '#00b4ff', trend: ctHist },
              { label: 'Throughput', value: fmt(kpis?.Throughput, 1), unit: 'kg/hr', color: '#3fb950', trend: [] },
              { label: 'Grind Eff.', value: kpis ? `${(kpis.GrindingEfficiency * 100).toFixed(1)}` : '—', unit: '%', color: '#a78bfa', trend: [] },
            ].map(({ label, value, unit, color, trend }) => (
              <div key={label} className={styles.kpiCard} style={{ '--kpi-color': color } as React.CSSProperties}>
                <div className={styles.kpiLabel}>{label}</div>
                <div className={styles.kpiValue}>{value}</div>
                <div className={styles.kpiUnit}>{unit}</div>
                {trend.length > 1 && (
                  <div style={{ marginTop: 4, opacity: 0.7 }}>
                    <Sparkline data={trend} color={color} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* ── Alarm banner ── */}
          {healthData && (
            <div className={`${styles.alarmBanner} ${
              alarmSev === 'NORMAL' ? styles.alarmNormal :
              alarmSev === 'EARLY'  ? styles.alarmEarly  :
              alarmSev === 'MID'    ? styles.alarmMid    : styles.alarmLate
            }`}>
              <span className={styles.alarmIcon}>
                {alarmSev === 'NORMAL' ? '✅' : alarmSev === 'EARLY' ? '⚠️' : alarmSev === 'MID' ? '🔶' : '🚨'}
              </span>
              <span className={styles.alarmText}>
                <div className={styles.alarmTitle}>
                  {alarmSev} &nbsp;·&nbsp; Min Index: {fmt(healthData.alarms.min_index, 1)}
                </div>
                <div className={styles.alarmDesc}>
                  {anyFaultActive
                    ? `Active faults: ${[
                        ctrl.machine_faults.blade_wear.enabled && 'blade wear',
                        ctrl.machine_faults.bearing_fault.enabled && 'bearing',
                        ctrl.machine_faults.misalignment.enabled && 'misalignment',
                        ctrl.machine_faults.imbalance.enabled && 'imbalance',
                        ctrl.machine_faults.looseness.enabled && 'looseness',
                        ctrl.process_faults.material_buildup.enabled && 'build-up',
                        ctrl.process_faults.partial_clogging.enabled && 'clogging',
                        ctrl.process_faults.choking.enabled && 'choking',
                      ].filter(Boolean).join(', ')}`
                    : 'All systems normal — no active faults'}
                </div>
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', opacity: 0.7 }}>
                Win #{healthData.window_idx}
              </span>
            </div>
          )}

          {/* ── Waveform chart ── */}
          <div className={styles.chartCard}>
            <div className={styles.chartHeader}>
              <div className={styles.cardTitle} style={{ marginBottom: 0 }}>
                {chartTab === 'fft' ? '📊 FFT Spectrum' : '📈 Signal Waveform'}
              </div>
              <div className={styles.chartTabRow}>
                {(['vibration', 'current', 'temperature', 'fft'] as ChartTab[]).map(tab => (
                  <button key={tab}
                    className={`${styles.chartTab} ${chartTab === tab ? styles.active : ''}`}
                    onClick={() => setChartTab(tab)}>
                    {tab === 'vibration' ? '〰️ Vib' : tab === 'current' ? '⚡ Cur' : tab === 'temperature' ? '🌡 Temp' : '📊 FFT'}
                  </button>
                ))}
              </div>
            </div>
            {chartTab === 'fft' ? (
              <FFTChart freqs={signals?.fft_freqs ?? []} magnitudes={signals?.fft_mag ?? []} />
            ) : (
              <WaveformChart
                samples={waveformSamples[chartTab]}
                color={waveformColors[chartTab]}
                label={chartTab}
              />
            )}
            {/* Axis labels */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4,
                          fontSize: '0.6rem', color: 'rgba(100,116,139,0.6)', fontFamily: 'monospace' }}>
              <span>0</span>
              <span style={{ color: 'rgba(148,163,184,0.5)' }}>
                {chartTab === 'fft' ? 'Frequency (Hz) → 1000' :
                 chartTab === 'vibration' ? `Time (s) → ${ctrl.simulation.window_length_sec}` :
                 chartTab === 'current'   ? `Time (s) → ${ctrl.simulation.window_length_sec}` :
                 `Time (s) → 60`}
              </span>
            </div>
          </div>

          {/* ── Feature Grid ── */}
          <div className={styles.featureGrid}>
            {[
              { name: 'Vib RMS',      val: fmt(vf.RMS, 4),          sub: 'g' },
              { name: 'Vib Peak',     val: fmt(vf.Peak, 4),         sub: 'g' },
              { name: 'Crest Factor', val: fmt(vf.CrestFactor, 3),  sub: '' },
              { name: 'Kurtosis',     val: fmt(vf.Kurtosis, 3),     sub: '' },
              { name: 'Spec Centroid',val: fmt(vf.SpectralCentroid, 1), sub: 'Hz' },
              { name: 'Mid-Band E',   val: fmt(vf.MidBandEnergy, 5), sub: '' },
              { name: 'Cur RMS',      val: fmt(cf.RMS, 4),          sub: 'A' },
              { name: 'Cur Kurtosis', val: fmt(cf.Kurtosis, 3),     sub: '' },
              { name: 'Temp RMS',     val: fmt(tf.RMS, 2),          sub: '°C' },
              { name: 'Temp ΔT/win',  val: fmt(tf.RateOfChange, 4), sub: '°C/win' },
              { name: 'EWMA Vib (s)', val: fmt(healthData?.ewma?.vibration_rms?.slow, 4), sub: 'g' },
              { name: 'EWMA Gap',     val: fmt(healthData?.ewma?.vibration_rms?.gap, 5),  sub: 'g' },
            ].map(({ name, val, sub }) => (
              <div key={name} className={styles.featureCard}>
                <div className={styles.featureName}>{name}</div>
                <div className={styles.featureVal}>{val}</div>
                {sub && <div className={styles.featureSubtext}>{sub}</div>}
              </div>
            ))}
          </div>

          {/* ── Health Gauges ── */}
          <div className={styles.gaugeRow}>
            <GaugeArc value={mhi} color={gaugeColor(mhi)} label="MHI — Mechanical Health" />
            <GaugeArc value={pqi} color={gaugeColor(pqi)} label="PQI — Process Quality" />
            <GaugeArc value={gqi} color={gaugeColor(gqi)} label="GQI — Grinding Quality" />
          </div>

          {/* ── EWMA Trend (mini chart) ── */}
          {history.length > 2 && (
            <div className={styles.chartCard} style={{ minHeight: 'auto' }}>
              <div className={styles.chartHeader}>
                <div className={styles.cardTitle} style={{ marginBottom: 0 }}>📉 Health Index Trends (Last {history.length} Windows)</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 8 }}>
                {[
                  { label: 'MHI', data: mhiHist, color: '#00b4ff' },
                  { label: 'PQI', data: pqiHist, color: '#3fb950' },
                  { label: 'GQI', data: gqiHist, color: '#a78bfa' },
                ].map(({ label, data, color }) => (
                  <div key={label}>
                    <div style={{ fontSize: '0.65rem', color: 'rgba(148,163,184,0.6)', marginBottom: 4,
                                  fontFamily: 'monospace' }}>
                      {label} &nbsp;
                      <span style={{ color }}>{data.length ? fmt(data[data.length - 1], 1) : '—'}</span>
                    </div>
                    <Sparkline data={data} color={color} />
                  </div>
                ))}
              </div>
              {/* Reference lines text */}
              <div style={{ marginTop: 6, fontSize: '0.6rem', color: 'rgba(100,116,139,0.5)',
                            fontFamily: 'monospace' }}>
                ▬ Healthy threshold: 95 &nbsp;|&nbsp; ▬ Mid-alarm threshold: 70
              </div>
            </div>
          )}

          {/* ── Idle state ── */}
          {!running && !healthData && (
            <div style={{ textAlign: 'center', padding: '3rem 2rem', color: 'rgba(148,163,184,0.5)' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚙️</div>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#00b4ff', marginBottom: '0.5rem' }}>
                Ready to Simulate
              </div>
              <div style={{ fontSize: '0.82rem', maxWidth: 480, margin: '0 auto', lineHeight: 1.6 }}>
                Configure fault conditions in the sidebar, then click{' '}
                <strong style={{ color: '#00b4ff' }}>▶ Generate</strong> to start the Digital Twin simulation.
              </div>
              <div style={{ marginTop: '1.5rem', fontSize: '0.72rem', fontFamily: 'monospace',
                            color: 'rgba(100,116,139,0.5)' }}>
                UI → six-section Control JSON → parameter_mapper.py → signal_generator → feature_extraction → MHI/PQI/GQI
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

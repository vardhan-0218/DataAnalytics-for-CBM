import { useId } from 'react';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
export interface SensorDef {
  key: string;
  label: string;
  unit: string;
  greenZone: [number, number];
  yellowZone: [number, number];
  redZone: [number, number];
  decimals?: number;
}

export interface SensorValues {
  [key: string]: number;
}

interface SensorStatusCardProps {
  sensors: SensorDef[];
  values: SensorValues;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
type StatusLevel = 'green' | 'yellow' | 'red';

function getStatus(value: number, sensor: SensorDef): StatusLevel {
  const inRange = (v: number, r: [number, number]) => v >= r[0] && v <= r[1];
  if (inRange(value, sensor.redZone)) return 'red';
  if (inRange(value, sensor.yellowZone)) return 'yellow';
  return 'green';
}

const STATUS_COLOR: Record<StatusLevel, string> = {
  green:  '#2ecc71',
  yellow: '#f1c40f',
  red:    '#e74c3c',
};

const STATUS_LABEL: Record<StatusLevel, string> = {
  green:  'NORMAL',
  yellow: 'WARN',
  red:    'CRIT',
};

const STATUS_GLOW: Record<StatusLevel, string> = {
  green:  '0 0 8px rgba(46,204,113,0.9), 0 0 16px rgba(46,204,113,0.5)',
  yellow: '0 0 8px rgba(241,196,15,0.9), 0 0 16px rgba(241,196,15,0.5)',
  red:    '0 0 8px rgba(231,76,60,0.9),  0 0 16px rgba(231,76,60,0.5)',
};

// ──────────────────────────────────────────────
// Sensor Row
// ──────────────────────────────────────────────
function SensorRow({ sensor, value }: { sensor: SensorDef; value: number }) {
  const status = getStatus(value, sensor);
  const color  = STATUS_COLOR[status];
  const glow   = STATUS_GLOW[status];
  const dec    = sensor.decimals ?? 1;
  const animId = useId().replace(/:/g, '');

  const allMin = sensor.greenZone[0];
  const allMax = sensor.redZone[1];
  const pct = Math.max(0, Math.min(100, ((value - allMin) / (allMax - allMin)) * 100));

  return (
    <div
      style={{
        padding: '8px 12px', // Reduced from 10px 14px
        background: 'linear-gradient(135deg, #2a2f35 0%, #222629 100%)',
        border: '1px solid #1a1d20',
        borderRadius: '6px',
        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Left accent bar */}
      <div
        style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: '3px',
          background: color,
          boxShadow: `0 0 6px ${color}`,
          borderRadius: '6px 0 0 6px',
        }}
      />

      {/* Top row: name + value + LED */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '6px', // Reduced from 8px
          marginBottom: '6px', // Reduced from 8px
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px', textTransform: 'uppercase', color: '#b0b5ba', fontFamily: 'monospace', flexShrink: 0 }}>
          {sensor.label}
        </span>

        <span style={{ fontFamily: 'monospace', fontSize: '14px', fontWeight: 'bold', letterSpacing: '1px', color: '#00ff88', textShadow: '0 0 8px rgba(0,255,136,0.7)', whiteSpace: 'nowrap' }}>
          {value.toFixed(dec)}&nbsp;{sensor.unit}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
          <div style={{ position: 'relative', width: '10px', height: '10px' }}>
            <div
              style={{
                position: 'absolute',
                inset: '-4px',
                borderRadius: '50%',
                background: color,
                opacity: 0,
                animation: `pulse-${animId} 2s ease-out infinite`,
              }}
            />
            <div
              style={{
                width: '10px', height: '10px', borderRadius: '50%',
                background: `radial-gradient(circle at 35% 30%, ${color}, ${color}aa)`,
                boxShadow: glow,
                border: `1px solid ${color}88`,
                position: 'relative', zIndex: 1,
              }}
            />
            <style>{`
              @keyframes pulse-${animId} {
                0%   { transform: scale(1);   opacity: 0.6; }
                70%  { transform: scale(2.4); opacity: 0; }
                100% { transform: scale(2.4); opacity: 0; }
              }
            `}</style>
          </div>
          <span style={{ fontSize: '9px', fontWeight: 'bold', letterSpacing: '0.5px', color: color, fontFamily: 'monospace' }}>
            {STATUS_LABEL[status]}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: '4px', background: 'rgba(0,0,0,0.5)', borderRadius: '2px', overflow: 'hidden', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.8)' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: `linear-gradient(90deg, #2ecc71, ${color})`,
            boxShadow: `0 0 6px ${color}`,
            borderRadius: '2px',
            transition: 'width 0.5s ease, background 0.4s ease',
          }}
        />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Main Card
// ──────────────────────────────────────────────
export function SensorStatusCard({ sensors, values }: SensorStatusCardProps) {
  const statuses  = sensors.map(s => getStatus(values[s.key] ?? 0, s));
  const hasRed    = statuses.includes('red');
  const hasYellow = statuses.includes('yellow');

  const headerLedColor = hasRed ? '#e74c3c' : hasYellow ? '#f1c40f' : '#2ecc71';
  const headerText     = hasRed ? 'STATUS: CRITICAL' : hasYellow ? 'STATUS: WARNING' : 'STATUS: NORMAL';

  return (
    <div
      style={{
        padding: '12px', // Reduced from 16px
        borderRadius: '8px',
        position: 'relative',
        background: `linear-gradient(135deg, #3a3f45 0%, #2b2f33 25%, #3a3f45 50%, #2b2f33 75%, #3a3f45 100%)`,
        backgroundSize: '200% 200%',
        boxShadow: `inset 0 3px 8px rgba(0,0,0,0.6), inset 0 -2px 4px rgba(255,255,255,0.03), 0 6px 12px rgba(0,0,0,0.7)`,
        border: '2px solid #1a1d20',
      }}
    >
      {/* Corner screws */}
      {[{ top: '8px', left: '8px' }, { top: '8px', right: '8px' }, { bottom: '8px', left: '8px' }, { bottom: '8px', right: '8px' }].map((pos, i) => (
        <div key={i} style={{ position: 'absolute', width: '12px', height: '12px', borderRadius: '50%', background: 'radial-gradient(circle at 30% 30%, #555, #2a2f35)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.8), 0 1px 2px rgba(255,255,255,0.1)', border: '1px solid #1a1d20', zIndex: 10, ...pos }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#1a1d20', transform: 'rotate(45deg)', fontWeight: 'bold' }}>+</div>
        </div>
      ))}

      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '10px', marginBottom: '12px', borderBottom: '2px solid #1a1d20' }}>
        <span style={{ fontSize: '12px', fontWeight: 'bold', letterSpacing: '2px', textTransform: 'uppercase', color: '#c0c5ca', textShadow: '0 1px 2px rgba(0,0,0,0.5)', fontFamily: 'monospace' }}>
          SENSOR STATUS
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: headerLedColor, boxShadow: `0 0 8px ${headerLedColor}` }} />
          <span style={{ fontSize: '9px', fontWeight: 'bold', letterSpacing: '0.5px', color: headerLedColor, fontFamily: 'monospace' }}>
            {headerText}
          </span>
        </div>
      </div>

      {/* Sensor rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}> {/* Reduced from 8px to 6px */}
        {sensors.map(s => (
          <SensorRow key={s.key} sensor={s} value={values[s.key] ?? 0} />
        ))}
      </div>

      {/* Footer */}
      <div style={{ marginTop: '12px', paddingTop: '8px', borderTop: '1px solid #1a1d20', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '9px', color: '#4a4f55', fontFamily: 'monospace', letterSpacing: '0.5px', textTransform: 'uppercase' }}>● LIVE TELEMETRY</span>
        <span style={{ fontSize: '9px', color: '#4a4f55', fontFamily: 'monospace', letterSpacing: '0.5px' }}>2 s UPDATE CYCLE</span>
      </div>
    </div>
  );
}

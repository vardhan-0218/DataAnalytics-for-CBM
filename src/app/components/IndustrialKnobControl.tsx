import { useState, useRef, useEffect, useCallback, useId } from 'react';

interface IndustrialKnobControlProps {
  label: string;
  sublabel?: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
  step?: number;
}

export function IndustrialKnobControl({
  label,
  sublabel,
  value,
  min,
  max,
  unit,
  onChange,
  step = 0.001,
}: IndustrialKnobControlProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const filterId = useId().replace(/:/g, '');
  const knobRef = useRef<SVGSVGElement>(null);
  const startY = useRef(0);
  const startValue = useRef(0);

  // Clamp & snap to step
  const clamp = useCallback(
    (v: number) => {
      const snapped = Math.round((v - min) / step) * step + min;
      return Math.max(min, Math.min(max, parseFloat(snapped.toFixed(10))));
    },
    [min, max, step]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startY.current = e.clientY;
    startValue.current = value;
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const deltaY = startY.current - e.clientY;
      const range = max - min;
      const newValue = clamp(startValue.current + (deltaY / 200) * range);
      onChange(newValue);
    };
    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, min, max, clamp, onChange]);

  // 270° arc: -135° (min) → +135° (max)
  const normalised = (value - min) / (max - min);
  const rotation = normalised * 270 - 135;

  // Tick marks — 28 ticks spanning 270°
  const TICKS = 28;
  const ticks = Array.from({ length: TICKS }, (_, i) => {
    const angle = -135 + (i / (TICKS - 1)) * 270;
    const isMajor = i % 9 === 0;
    const isMed = i % 3 === 0 && !isMajor;
    const outerR = 54;
    const innerR = isMajor ? 44 : isMed ? 47 : 49;
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      x1: 60 + outerR * sin,
      y1: 60 - outerR * cos,
      x2: 60 + innerR * sin,
      y2: 60 - innerR * cos,
      isMajor,
      isMed,
    };
  });

  // Arc path for the filled progress arc
  const arcPath = (() => {
    const r = 54;
    const startAngle = -135;
    const endAngle = -135 + normalised * 270;
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const x1 = 60 + r * Math.sin(startRad);
    const y1 = 60 - r * Math.cos(startRad);
    const x2 = 60 + r * Math.sin(endRad);
    const y2 = 60 - r * Math.cos(endRad);
    const largeArc = normalised * 270 > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
  })();

  // Format display value
  const formatValue = () => {
    if (step >= 1) return `${Math.round(value)} ${unit}`;
    const decimals = String(step).split('.')[1]?.length ?? 3;
    return `${value.toFixed(decimals)} ${unit}`;
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0,
        padding: '16px 12px 12px',
        background: 'linear-gradient(135deg, #3a3f45 0%, #2b2f33 50%, #3a3f45 100%)',
        border: '2px solid #1a1d20',
        borderRadius: '8px',
        boxShadow:
          'inset 0 3px 6px rgba(0,0,0,0.5), inset 0 -2px 4px rgba(255,255,255,0.03), 0 6px 12px rgba(0,0,0,0.7)',
        position: 'relative',
      }}
    >
      {/* Corner screws */}
      {[
        { top: '6px', left: '6px' },
        { top: '6px', right: '6px' },
        { bottom: '6px', left: '6px' },
        { bottom: '6px', right: '6px' },
      ].map((pos, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: 'radial-gradient(circle at 30% 30%, #666, #2a2f35)',
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.8), 0 1px 2px rgba(255,255,255,0.1)',
            border: '1px solid #1a1d20',
            ...pos,
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '8px',
              color: '#1a1d20',
              transform: 'rotate(45deg)',
              fontWeight: 'bold',
            }}
          >
            +
          </div>
        </div>
      ))}

      {/* Label badge */}
      <div
        style={{
          marginBottom: '10px',
          padding: '3px 10px',
          fontSize: '10px',
          fontWeight: 'bold',
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
          textAlign: 'center',
          color: '#b0b5ba',
          background: 'linear-gradient(180deg, #2a2f35 0%, #1f2327 100%)',
          border: '1px solid #1a1d20',
          borderRadius: '4px',
          boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.4)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>

      {/* SVG Knob */}
      <svg
        ref={knobRef}
        width="120"
        height="120"
        viewBox="0 0 120 120"
        style={{
          cursor: isDragging ? 'grabbing' : isHovered ? 'grab' : 'default',
          filter: isDragging || isHovered
            ? 'drop-shadow(0 0 8px rgba(243,156,18,0.5))'
            : 'drop-shadow(0 4px 8px rgba(0,0,0,0.8))',
          transition: 'filter 0.15s ease',
          userSelect: 'none',
        }}
        onMouseDown={handleMouseDown}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <defs>
          {/* Brushed metal noise filter */}
          <filter id={`noise-${filterId}`} x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.65 0.009"
              numOctaves="3"
              stitchTiles="stitch"
              result="noise"
            />
            <feColorMatrix type="saturate" values="0" in="noise" result="grayNoise" />
            <feBlend in="SourceGraphic" in2="grayNoise" mode="soft-light" result="blended" />
            <feComposite in="blended" in2="SourceGraphic" operator="in" />
          </filter>

          {/* Outer bezel gradient */}
          <radialGradient id={`bezel-${filterId}`} cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor="#6a7080" />
            <stop offset="40%" stopColor="#454a52" />
            <stop offset="100%" stopColor="#1e2226" />
          </radialGradient>

          {/* Inner knob face gradient */}
          <radialGradient id={`face-${filterId}`} cx="38%" cy="32%" r="68%">
            <stop offset="0%" stopColor="#585e68" />
            <stop offset="35%" stopColor="#3a3f47" />
            <stop offset="70%" stopColor="#2b2f35" />
            <stop offset="100%" stopColor="#1a1d22" />
          </radialGradient>

          {/* Specular highlight */}
          <radialGradient id={`specular-${filterId}`} cx="30%" cy="25%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>

          {/* Grip ring gradient */}
          <radialGradient id={`grip-${filterId}`} cx="35%" cy="30%" r="60%">
            <stop offset="0%" stopColor="#50555e" />
            <stop offset="100%" stopColor="#25282d" />
          </radialGradient>

          {/* Progress arc glow */}
          <filter id={`glow-${filterId}`}>
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ── Outer bezel ring ── */}
        <circle cx="60" cy="60" r="57" fill={`url(#bezel-${filterId})`} />
        {/* Bezel inner shadow ring */}
        <circle
          cx="60"
          cy="60"
          r="57"
          fill="none"
          stroke="rgba(0,0,0,0.6)"
          strokeWidth="3"
        />
        {/* Bezel highlight rim */}
        <circle
          cx="60"
          cy="60"
          r="56"
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth="1"
        />

        {/* ── Background arc track ── */}
        <path
          d={arcPath.replace(
            // draw full track
            arcPath,
            (() => {
              const r = 54;
              const startRad = (-135 * Math.PI) / 180;
              const endRad = (135 * Math.PI) / 180;
              const x1 = 60 + r * Math.sin(startRad);
              const y1 = 60 - r * Math.cos(startRad);
              const x2 = 60 + r * Math.sin(endRad);
              const y2 = 60 - r * Math.cos(endRad);
              return `M ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2} ${y2}`;
            })()
          )}
          fill="none"
          stroke="rgba(0,0,0,0.5)"
          strokeWidth="3"
          strokeLinecap="round"
        />

        {/* ── Tick marks ── */}
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={t.isMajor ? '#c0c5ca' : t.isMed ? '#8a8f95' : '#5a5f65'}
            strokeWidth={t.isMajor ? 2 : 1}
            strokeLinecap="round"
          />
        ))}

        {/* ── Progress arc fill ── */}
        {normalised > 0 && (
          <path
            d={arcPath}
            fill="none"
            stroke="#f39c12"
            strokeWidth="2.5"
            strokeLinecap="round"
            filter={`url(#glow-${filterId})`}
            opacity="0.9"
          />
        )}

        {/* ── Knob grip ring (outer serrated band) ── */}
        <circle
          cx="60"
          cy="60"
          r="42"
          fill={`url(#grip-${filterId})`}
          filter={`url(#noise-${filterId})`}
        />
        {/* Grip serrations via dashed stroke */}
        <circle
          cx="60"
          cy="60"
          r="42"
          fill="none"
          stroke="rgba(0,0,0,0.4)"
          strokeWidth="3"
          strokeDasharray="3 2"
          strokeLinecap="round"
        />

        {/* ── Inner knob face ── */}
        <circle
          cx="60"
          cy="60"
          r="34"
          fill={`url(#face-${filterId})`}
          filter={`url(#noise-${filterId})`}
        />
        {/* Inner edge shadow ring */}
        <circle
          cx="60"
          cy="60"
          r="34"
          fill="none"
          stroke="rgba(0,0,0,0.7)"
          strokeWidth="2"
        />
        {/* Specular highlight on face */}
        <circle cx="60" cy="60" r="34" fill={`url(#specular-${filterId})`} />

        {/* ── Pointer indicator (rotates with value) ── */}
        <g
          transform={`rotate(${rotation}, 60, 60)`}
          style={{ transition: isDragging ? 'none' : 'transform 0.075s ease-out' }}
        >
          {/* Pointer line */}
          <line
            x1="60"
            y1="60"
            x2="60"
            y2="30"
            stroke="#ff4422"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          {/* Pointer tip dot */}
          <circle cx="60" cy="29" r="2.5" fill="#ff6644" />
          {/* Pointer glow */}
          <line
            x1="60"
            y1="60"
            x2="60"
            y2="30"
            stroke="rgba(255,80,40,0.4)"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </g>

        {/* ── Center hub cap ── */}
        <circle
          cx="60"
          cy="60"
          r="9"
          fill="radial-gradient(circle at 35% 35%, #5a5f65, #2a2f35)"
          style={{
            fill: 'url(#grip-' + filterId + ')',
          }}
        />
        <circle
          cx="60"
          cy="60"
          r="9"
          fill="none"
          stroke="rgba(0,0,0,0.6)"
          strokeWidth="1.5"
        />
        <circle cx="57" cy="57" r="3" fill="rgba(255,255,255,0.12)" />
      </svg>

      {/* Precision Slider */}
      <div style={{ width: '100%', marginTop: '10px', padding: '0 4px' }}>
        <style>{`
          .ind-slider-${filterId} {
            -webkit-appearance: none;
            appearance: none;
            width: 100%;
            height: 6px;
            border-radius: 3px;
            background: linear-gradient(
              to right,
              #f39c12 0%,
              #f39c12 ${normalised * 100}%,
              #1a1d20 ${normalised * 100}%,
              #1a1d20 100%
            );
            border: 1px solid #0a0c0e;
            box-shadow: inset 0 2px 4px rgba(0,0,0,0.8), inset 0 -1px 0 rgba(255,255,255,0.04);
            outline: none;
            cursor: pointer;
          }
          .ind-slider-${filterId}::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: radial-gradient(circle at 35% 30%, #f5b942, #c07a08);
            border: 2px solid #8a5a05;
            box-shadow: 0 2px 6px rgba(0,0,0,0.6), 0 0 8px rgba(243,156,18,0.4), inset 0 1px 2px rgba(255,255,255,0.3);
            cursor: grab;
            transition: box-shadow 0.1s ease;
          }
          .ind-slider-${filterId}::-webkit-slider-thumb:active {
            cursor: grabbing;
            box-shadow: 0 2px 6px rgba(0,0,0,0.8), 0 0 14px rgba(243,156,18,0.7), inset 0 1px 2px rgba(255,255,255,0.3);
          }
          .ind-slider-${filterId}::-moz-range-thumb {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: radial-gradient(circle at 35% 30%, #f5b942, #c07a08);
            border: 2px solid #8a5a05;
            box-shadow: 0 2px 6px rgba(0,0,0,0.6), 0 0 8px rgba(243,156,18,0.4);
            cursor: grab;
          }
        `}</style>
        <input
          type="range"
          className={`ind-slider-${filterId}`}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      </div>

      {/* Digital value readout */}
      <div
        style={{
          marginTop: '8px',
          padding: '4px 12px',
          backgroundColor: '#0a0c0e',
          border: '2px solid #1a1d20',
          borderRadius: '4px',
          boxShadow:
            'inset 0 3px 6px rgba(0,0,0,0.9), inset 0 -1px 0 rgba(255,255,255,0.04)',
          minWidth: '100px',
          textAlign: 'center',
        }}
      >
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: '14px',
            fontWeight: 'bold',
            letterSpacing: '1px',
            color: '#00ff88',
            textShadow:
              '0 0 8px rgba(0,255,136,0.8), 0 0 16px rgba(0,255,136,0.4)',
          }}
        >
          {formatValue()}
        </span>
      </div>

      {/* Sublabel */}
      {sublabel && (
        <div
          style={{
            marginTop: '6px',
            fontSize: '9px',
            textAlign: 'center',
            color: '#6a6f75',
            lineHeight: 1.35,
            maxWidth: '115px',
          }}
        >
          {sublabel}
        </div>
      )}
    </div>
  );
}

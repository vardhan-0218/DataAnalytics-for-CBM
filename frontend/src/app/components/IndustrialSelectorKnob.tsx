import { useState, useId } from 'react';

export interface SelectorOption {
  value: string;
  label: string;         // short knob label, e.g. "LOW"
  sublabel?: string;     // optional second line, e.g. "0.01 mm/1000h"
}

interface IndustrialSelectorKnobProps {
  label: string;
  description?: string;
  options: SelectorOption[];
  value: string;
  onChange: (value: string) => void;
}

export function IndustrialSelectorKnob({
  label,
  description,
  options,
  value,
  onChange,
}: IndustrialSelectorKnobProps) {
  const [isHovered, setIsHovered] = useState(false);
  const filterId = useId().replace(/:/g, '');

  const currentIndex = options.findIndex((o) => o.value === value);
  const numOptions = options.length;

  // Spread positions evenly across a 270° arc (-135° to +135°)
  const indexToAngle = (i: number) =>
    numOptions === 1 ? 0 : -135 + (i / (numOptions - 1)) * 270;

  const rotation = indexToAngle(currentIndex);

  const advance = () => {
    const next = (currentIndex + 1) % numOptions;
    onChange(options[next].value);
  };

  const retreat = () => {
    const prev = (currentIndex - 1 + numOptions) % numOptions;
    onChange(options[prev].value);
  };

  // Build 28 tick marks for the outer ring (same cadence as IndustrialKnobControl)
  const TICKS = 28;
  const ticks = Array.from({ length: TICKS }, (_, i) => {
    const angle = -135 + (i / (TICKS - 1)) * 270;
    const isMajor = i % 9 === 0;
    const isMed = i % 3 === 0 && !isMajor;
    const outerR = 54;
    const innerR = isMajor ? 44 : isMed ? 47 : 49;
    const rad = (angle * Math.PI) / 180;
    return {
      x1: 60 + outerR * Math.sin(rad),
      y1: 60 - outerR * Math.cos(rad),
      x2: 60 + innerR * Math.sin(rad),
      y2: 60 - innerR * Math.cos(rad),
      isMajor,
      isMed,
    };
  });

  // Position dot markers for each option (on ring between ticks and knob)
  const dots = options.map((opt, i) => {
    const angle = indexToAngle(i);
    const r = 49;
    const rad = (angle * Math.PI) / 180;
    const isActive = i === currentIndex;
    return {
      cx: 60 + r * Math.sin(rad),
      cy: 60 - r * Math.cos(rad),
      isActive,
      label: opt.label,
    };
  });

  // Current option display
  const current = options[currentIndex] ?? options[0];
  const displayLine = current.sublabel
    ? `${current.label}  ${current.sublabel}`
    : current.label;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0,
        padding: '16px 12px 12px',
        background:
          'linear-gradient(135deg, #3a3f45 0%, #2b2f33 50%, #3a3f45 100%)',
        border: '2px solid #1a1d20',
        borderRadius: '8px',
        boxShadow:
          'inset 0 3px 6px rgba(0,0,0,0.5), inset 0 -2px 4px rgba(255,255,255,0.03), 0 6px 12px rgba(0,0,0,0.7)',
        position: 'relative',
        minWidth: '0',
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
            boxShadow:
              'inset 0 1px 3px rgba(0,0,0,0.8), 0 1px 2px rgba(255,255,255,0.1)',
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
        width="120"
        height="120"
        viewBox="0 0 120 120"
        style={{
          cursor: isHovered ? 'pointer' : 'default',
          filter: isHovered
            ? 'drop-shadow(0 0 8px rgba(243,156,18,0.4))'
            : 'drop-shadow(0 4px 8px rgba(0,0,0,0.8))',
          transition: 'filter 0.15s ease',
          userSelect: 'none',
        }}
        onClick={advance}
        onContextMenu={(e) => {
          e.preventDefault();
          retreat();
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <defs>
          {/* Brushed metal noise */}
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

          {/* Dot glow */}
          <filter id={`dotglow-${filterId}`}>
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Bezel gradient */}
          <radialGradient id={`bezel-${filterId}`} cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor="#6a7080" />
            <stop offset="40%" stopColor="#454a52" />
            <stop offset="100%" stopColor="#1e2226" />
          </radialGradient>

          {/* Face gradient */}
          <radialGradient id={`face-${filterId}`} cx="38%" cy="32%" r="68%">
            <stop offset="0%" stopColor="#585e68" />
            <stop offset="35%" stopColor="#3a3f47" />
            <stop offset="70%" stopColor="#2b2f35" />
            <stop offset="100%" stopColor="#1a1d22" />
          </radialGradient>

          {/* Specular */}
          <radialGradient id={`specular-${filterId}`} cx="30%" cy="25%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.15)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>

          {/* Grip gradient */}
          <radialGradient id={`grip-${filterId}`} cx="35%" cy="30%" r="60%">
            <stop offset="0%" stopColor="#50555e" />
            <stop offset="100%" stopColor="#25282d" />
          </radialGradient>
        </defs>

        {/* ── Outer bezel ring ── */}
        <circle cx="60" cy="60" r="57" fill={`url(#bezel-${filterId})`} />
        <circle cx="60" cy="60" r="57" fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth="3" />
        <circle cx="60" cy="60" r="56" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />

        {/* ── Tick marks ── */}
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
            stroke={t.isMajor ? '#c0c5ca' : t.isMed ? '#8a8f95' : '#5a5f65'}
            strokeWidth={t.isMajor ? 2 : 1}
            strokeLinecap="round"
          />
        ))}

        {/* ── Option position dots on ring ── */}
        {dots.map((d, i) => (
          <g key={i} filter={d.isActive ? `url(#dotglow-${filterId})` : undefined}>
            <circle
              cx={d.cx}
              cy={d.cy}
              r={d.isActive ? 4 : 3}
              fill={d.isActive ? '#f39c12' : '#3a3f45'}
              stroke={d.isActive ? '#d68910' : '#5a5f65'}
              strokeWidth="1.5"
            />
          </g>
        ))}

        {/* ── Grip ring ── */}
        <circle cx="60" cy="60" r="42" fill={`url(#grip-${filterId})`} filter={`url(#noise-${filterId})`} />
        <circle cx="60" cy="60" r="42" fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth="3" strokeDasharray="3 2" strokeLinecap="round" />

        {/* ── Inner face ── */}
        <circle cx="60" cy="60" r="34" fill={`url(#face-${filterId})`} filter={`url(#noise-${filterId})`} />
        <circle cx="60" cy="60" r="34" fill="none" stroke="rgba(0,0,0,0.7)" strokeWidth="2" />
        <circle cx="60" cy="60" r="34" fill={`url(#specular-${filterId})`} />

        {/* ── Pointer (snaps to discrete position) ── */}
        <g
          transform={`rotate(${rotation}, 60, 60)`}
          style={{ transition: 'transform 0.25s cubic-bezier(0.34,1.56,0.64,1)' }}
        >
          <line x1="60" y1="60" x2="60" y2="30" stroke="#ff4422" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="60" cy="29" r="2.5" fill="#ff6644" />
          {/* glow */}
          <line x1="60" y1="60" x2="60" y2="30" stroke="rgba(255,80,40,0.35)" strokeWidth="5" strokeLinecap="round" />
        </g>

        {/* ── Center hub ── */}
        <circle cx="60" cy="60" r="9" fill={`url(#grip-${filterId})`} />
        <circle cx="60" cy="60" r="9" fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth="1.5" />
        <circle cx="57" cy="57" r="3" fill="rgba(255,255,255,0.1)" />
      </svg>

      {/* Click hint */}
      <div
        style={{
          marginTop: '4px',
          fontSize: '8px',
          color: '#4a4f55',
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
          fontFamily: 'monospace',
        }}
      >
        click to advance · right-click back
      </div>

      {/* Value readout */}
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
            fontSize: '11px',
            fontWeight: 'bold',
            letterSpacing: '0.5px',
            color: '#00ff88',
            textShadow:
              '0 0 8px rgba(0,255,136,0.8), 0 0 16px rgba(0,255,136,0.4)',
            whiteSpace: 'nowrap',
          }}
        >
          {displayLine}
        </span>
      </div>

      {/* Description */}
      {description && (
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
          {description}
        </div>
      )}
    </div>
  );
}

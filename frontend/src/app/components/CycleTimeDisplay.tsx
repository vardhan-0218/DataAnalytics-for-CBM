/**
 * CycleTimeDisplay.tsx
 * 
 * Real-time cycle time display showing CT_BASELINE + 0.2 * (ewma - MU)
 * Replaces the operator compensation knob control
 */

import React from 'react';

interface CycleTimeDisplayProps {
  cycleTime: number;
  baseline: number;
  ewma: number;
  mu: number;
}

const CARD_STYLE: React.CSSProperties = {
  borderRadius: '8px',
  padding: '16px',
  position: 'relative',
  background: `linear-gradient(
    135deg,
    #3a3f45 0%,
    #2b2f33 25%,
    #3a3f45 50%,
    #2b2f33 75%,
    #3a3f45 100%
  )`,
  backgroundSize: '200% 200%',
  boxShadow: `
    inset 0 3px 8px rgba(0,0,0,0.6),
    inset 0 -2px 4px rgba(255,255,255,0.03),
    0 6px 12px rgba(0,0,0,0.7)
  `,
  border: '2px solid #1a1d20',
};

function Screws() {
  const positions = [
    { top: '8px', left: '8px' },
    { top: '8px', right: '8px' },
    { bottom: '8px', left: '8px' },
    { bottom: '8px', right: '8px' },
  ];

  return (
    <>
      {positions.map((pos, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            background: 'radial-gradient(circle at 30% 30%, #555, #2a2f35)',
            boxShadow:
              'inset 0 1px 3px rgba(0,0,0,0.8), 0 1px 2px rgba(255,255,255,0.1)',
            border: '1px solid #1a1d20',
            zIndex: 10,
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
              fontSize: '10px',
              color: '#1a1d20',
              transform: 'rotate(45deg)',
              fontWeight: 'bold',
            }}
          >
            +
          </div>
        </div>
      ))}
    </>
  );
}

export function CycleTimeDisplay({ cycleTime, baseline, ewma, mu }: CycleTimeDisplayProps) {
  const deviation = ewma - mu;
  const deviationPercent = ((cycleTime - baseline) / baseline) * 100;
  
  // Determine status color based on cycle time elevation
  const getStatusColor = () => {
    if (cycleTime > baseline * 1.05) return '#e74c3c'; // Late threshold (5% above baseline)
    if (cycleTime > baseline * 1.03) return '#f39c12'; // Early threshold (3% above baseline)
    return '#2ecc71'; // Normal
  };

  const getStatusText = () => {
    if (cycleTime > baseline * 1.05) return 'ELEVATED';
    if (cycleTime > baseline * 1.03) return 'RISING';
    return 'NORMAL';
  };

  return (
    <div style={CARD_STYLE}>
      <Screws />
      
      {/* Header */}
      <div style={{
        fontSize: '12px',
        fontWeight: 'bold',
        letterSpacing: '2px',
        textTransform: 'uppercase',
        color: '#c0c5ca',
        textShadow: '0 1px 2px rgba(0,0,0,0.5)',
        fontFamily: 'monospace',
        paddingBottom: '10px',
        marginBottom: '12px',
        borderBottom: '2px solid #1a1d20',
        textAlign: 'center',
      }}>
        Cycle Time
      </div>

      {/* Main Display */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
      }}>
        
        {/* Large Cycle Time Value */}
        <div style={{
          fontSize: '28px',
          fontWeight: 'bold',
          fontFamily: 'monospace',
          color: getStatusColor(),
          textShadow: `0 0 8px ${getStatusColor()}`,
          letterSpacing: '1px',
        }}>
          {cycleTime.toFixed(2)}
        </div>

        {/* Unit and Status */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
        }}>
          <span style={{
            fontSize: '11px',
            fontFamily: 'monospace',
            color: '#9aa0a6',
            letterSpacing: '1px',
          }}>
            SECONDS
          </span>
          
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            <div style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: getStatusColor(),
              boxShadow: `0 0 6px ${getStatusColor()}`,
            }} />
            <span style={{
              fontSize: '10px',
              fontFamily: 'monospace',
              fontWeight: 'bold',
              color: getStatusColor(),
              letterSpacing: '1px',
            }}>
              {getStatusText()}
            </span>
          </div>
        </div>

        {/* Deviation Indicator - Simplified */}
        <div style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          fontSize: '9px',
          fontFamily: 'monospace',
          color: '#7a7f85',
        }}>
          <span style={{
            color: deviationPercent > 0 ? '#f39c12' : '#2ecc71',
            fontWeight: 'bold',
          }}>
            {deviationPercent > 0 ? '+' : ''}{deviationPercent.toFixed(1)}% from baseline
          </span>
        </div>
      </div>
    </div>
  );
}
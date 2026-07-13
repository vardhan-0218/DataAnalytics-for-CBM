/**
 * CycleTimeSlider.tsx
 * 
 * Slider control for cycle time that affects real-time simulation
 * Replaces the display-only cycle time component
 */

import React from 'react';

interface CycleTimeSliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
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

export function CycleTimeSlider({ 
  value, 
  min = 0.5, 
  max = 5.0, 
  step = 0.1, 
  onChange 
}: CycleTimeSliderProps) {
  
  const getStatusColor = () => {
    if (value > 3.0) return '#e74c3c'; // High cycle time
    if (value > 2.5) return '#f39c12'; // Medium cycle time
    return '#2ecc71'; // Normal cycle time
  };

  const getStatusText = () => {
    if (value > 3.0) return 'HIGH';
    if (value > 2.5) return 'ELEVATED';
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

      {/* Value Display */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '16px',
      }}>
        
        {/* Large Value */}
        <div style={{
          fontSize: '24px',
          fontWeight: 'bold',
          fontFamily: 'monospace',
          color: getStatusColor(),
          textShadow: `0 0 8px ${getStatusColor()}`,
          letterSpacing: '1px',
        }}>
          {value.toFixed(1)}
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
      </div>

      {/* Slider */}
      <div style={{
        position: 'relative',
        marginBottom: '12px',
      }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{
            width: '100%',
            height: '6px',
            borderRadius: '3px',
            background: `linear-gradient(
              to right,
              #2ecc71 0%,
              #f39c12 50%,
              #e74c3c 100%
            )`,
            outline: 'none',
            appearance: 'none',
            cursor: 'pointer',
          }}
        />
        
        {/* Custom slider thumb styling */}
        <style>
          {`
            input[type="range"]::-webkit-slider-thumb {
              appearance: none;
              width: 20px;
              height: 20px;
              border-radius: 50%;
              background: radial-gradient(circle at 30% 30%, #fff, #ddd);
              border: 2px solid #333;
              cursor: pointer;
              box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            }
            
            input[type="range"]::-moz-range-thumb {
              width: 20px;
              height: 20px;
              border-radius: 50%;
              background: radial-gradient(circle at 30% 30%, #fff, #ddd);
              border: 2px solid #333;
              cursor: pointer;
              box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            }
          `}
        </style>
      </div>

      {/* Range Labels */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '9px',
        fontFamily: 'monospace',
        color: '#7a7f85',
      }}>
        <span>MIN: {min}s</span>
        <span>MAX: {max}s</span>
      </div>
    </div>
  );
}
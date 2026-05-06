/**
 * AlertIndicators.tsx
 * 
 * Three-tier alert system showing Early, Mid, and Late alerts
 * Based on EWMA analysis from analysis.py
 */

import React from 'react';

interface AlertIndicatorsProps {
  alerts: {
    early: boolean;
    mid: boolean;
    late: boolean;
    early_trigger_time?: number;
    mid_trigger_time?: number;
    late_trigger_time?: number;
  };
  ewma: number;
  slope: number;
  variance: number;
  cycleTime: number;
  config: {
    ucl_2sigma: number;
    ucl_3sigma: number;
  };
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

const ALERT_CONFIGS = {
  early: {
    label: 'Early Alert',
    color: '#2ecc71', // Changed from '#f1c40f' to green
    bgColor: 'rgba(46, 204, 113, 0.1)',
    icon: '⚠',
    description: 'EWMA < UCL 2σ, Slope > 0.005, Variance stable',
  },
  mid: {
    label: 'Mid Alert',
    color: '#f39c12',
    bgColor: 'rgba(243, 156, 18, 0.12)',
    icon: '⚡',
    description: 'EWMA > UCL 2σ, Slope > 0.01, Cycle time elevated',
  },
  late: {
    label: 'Late Alert',
    color: '#e74c3c',
    bgColor: 'rgba(231, 76, 60, 0.15)',
    icon: '🚨',
    description: 'EWMA > UCL 3σ, Slope > 0.02, Cycle time high',
  },
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

function AlertIndicator({ 
  type, 
  active, 
  triggerTime, 
  config 
}: { 
  type: keyof typeof ALERT_CONFIGS; 
  active: boolean; 
  triggerTime?: number;
  config: any;
}) {
  const alertConfig = ALERT_CONFIGS[type];
  
  return (
    <div style={{
      padding: '12px',
      borderRadius: '6px',
      border: `2px solid ${active ? alertConfig.color : '#2a2f35'}`,
      background: active ? alertConfig.bgColor : 'rgba(0,0,0,0.2)',
      boxShadow: active ? `0 0 12px ${alertConfig.color}44` : 'inset 0 2px 4px rgba(0,0,0,0.5)',
      transition: 'all 0.3s ease',
    }}>
      
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '8px',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span style={{
            fontSize: '16px',
            filter: active ? 'none' : 'grayscale(100%)',
          }}>
            {alertConfig.icon}
          </span>
          <span style={{
            fontSize: '11px',
            fontFamily: 'monospace',
            fontWeight: 'bold',
            color: active ? alertConfig.color : '#5a5f65',
            letterSpacing: '1px',
            textTransform: 'uppercase',
          }}>
            {alertConfig.label}
          </span>
        </div>
        
        {/* Status Indicator */}
        <div style={{
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          backgroundColor: active ? alertConfig.color : '#2a2f35',
          boxShadow: active ? `0 0 8px ${alertConfig.color}` : 'inset 0 2px 4px rgba(0,0,0,0.8)',
          border: `2px solid ${active ? alertConfig.color : '#1a1d20'}`,
        }} />
      </div>

      {/* Alert Count and Trigger Time */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '8px',
      }}>
        <div style={{
          fontSize: '18px',
          fontFamily: 'monospace',
          fontWeight: 'bold',
          color: active ? alertConfig.color : '#5a5f65',
        }}>
          {triggerTime ? '1' : '0'}
        </div>
        
        {triggerTime && (
          <div style={{
            fontSize: '10px',
            fontFamily: 'monospace',
            color: active ? alertConfig.color : '#7a7f85',
            textAlign: 'right',
          }}>
            <div>FIRST TRIGGER:</div>
            <div style={{ fontWeight: 'bold' }}>t={triggerTime}</div>
          </div>
        )}
      </div>

      {/* Description - Simplified */}
      <div style={{
        fontSize: '9px',
        fontFamily: 'monospace',
        color: active ? '#c0c5ca' : '#5a5f65',
        lineHeight: '1.3',
      }}>
        {type === 'early' && 'Potential degradation detected'}
        {type === 'mid' && 'Performance degradation confirmed'}
        {type === 'late' && 'Critical degradation - action required'}
      </div>
    </div>
  );
}

export function AlertIndicators({ alerts, ewma, slope, variance, cycleTime, config }: AlertIndicatorsProps) {
  const activeAlerts = [alerts.early, alerts.mid, alerts.late].filter(Boolean).length;
  
  const getOverallStatus = () => {
    if (alerts.late) return { text: 'CRITICAL', color: '#e74c3c' };
    if (alerts.mid) return { text: 'WARNING', color: '#f39c12' };
    if (alerts.early) return { text: 'CAUTION', color: '#2ecc71' }; // Changed to green
    return { text: 'NORMAL', color: '#2ecc71' };
  };

  const status = getOverallStatus();

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
        Alert System
      </div>

      {/* Overall Status */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        marginBottom: '16px',
        padding: '8px',
        background: 'rgba(0,0,0,0.3)',
        borderRadius: '4px',
        border: `1px solid ${status.color}44`,
      }}>
        <div style={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          backgroundColor: status.color,
          boxShadow: `0 0 10px ${status.color}`,
        }} />
        <span style={{
          fontSize: '12px',
          fontFamily: 'monospace',
          fontWeight: 'bold',
          color: status.color,
          letterSpacing: '1px',
        }}>
          {status.text}
        </span>
        <span style={{
          fontSize: '10px',
          fontFamily: 'monospace',
          color: '#7a7f85',
          marginLeft: '8px',
        }}>
          ({activeAlerts} active)
        </span>
      </div>

      {/* Alert Indicators */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}>
        <AlertIndicator
          type="early"
          active={alerts.early}
          triggerTime={alerts.early_trigger_time}
          config={config}
        />
        <AlertIndicator
          type="mid"
          active={alerts.mid}
          triggerTime={alerts.mid_trigger_time}
          config={config}
        />
        <AlertIndicator
          type="late"
          active={alerts.late}
          triggerTime={alerts.late_trigger_time}
          config={config}
        />
      </div>
    </div>
  );
}
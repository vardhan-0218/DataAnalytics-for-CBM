/**
 * EnhancedAlertPopup.tsx
 * 
 * Advanced alert popup that appears when alerts are triggered
 * Shows detailed information and recommended actions
 */

import { useState, useEffect } from 'react';

interface AlertPopupProps {
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
  onDismiss?: () => void;
  onAction?: (action: string) => void;
}

const ALERT_DETAILS = {
  early: {
    title: 'Early Warning Alert',
    color: '#2ecc71',  // Green color
    bgColor: 'rgba(46, 204, 113, 0.1)',
    icon: '⚠️',
    severity: 'WARNING',
    description: 'Potential degradation detected in motor performance',
    recommendations: [
      'Schedule preventive maintenance check',
      'Monitor vibration levels closely',
      'Check lubrication system',
      'Review operating parameters',
    ],
    actions: [
      { label: 'Schedule Maintenance', action: 'schedule_maintenance' },
      { label: 'Increase Monitoring', action: 'increase_monitoring' },
    ],
  },
  mid: {
    title: 'Mid-Level Alert',
    color: '#f39c12',
    bgColor: 'rgba(243, 156, 18, 0.12)',
    icon: '⚡',
    severity: 'CAUTION',
    description: 'Motor performance degradation confirmed',
    recommendations: [
      'Immediate maintenance inspection required',
      'Check bearing condition',
      'Verify alignment and balance',
      'Consider load reduction',
    ],
    actions: [
      { label: 'Emergency Inspection', action: 'emergency_inspection' },
      { label: 'Reduce Load', action: 'reduce_load' },
    ],
  },
  late: {
    title: 'Critical Alert',
    color: '#e74c3c',
    bgColor: 'rgba(231, 76, 60, 0.15)',
    icon: '🚨',
    severity: 'CRITICAL',
    description: 'Severe motor degradation - immediate action required',
    recommendations: [
      'STOP OPERATION IMMEDIATELY',
      'Emergency maintenance required',
      'Replace worn components',
      'Full system inspection needed',
    ],
    actions: [
      { label: 'Emergency Stop', action: 'emergency_stop' },
      { label: 'Call Maintenance', action: 'call_maintenance' },
    ],
  },
};

export function EnhancedAlertPopup({ 
  alerts, 
  ewma, 
  slope, 
  variance, 
  cycleTime, 
  onDismiss, 
  onAction 
}: AlertPopupProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [currentAlert, setCurrentAlert] = useState<keyof typeof ALERT_DETAILS | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  // Determine the highest priority alert - only show when CURRENTLY active
  useEffect(() => {
    let highestAlert: keyof typeof ALERT_DETAILS | null = null;
    
    // Only show popup if alert is CURRENTLY active (not just triggered in the past)
    if (alerts.late) highestAlert = 'late';
    else if (alerts.mid) highestAlert = 'mid';
    else if (alerts.early) highestAlert = 'early';

    // Show popup only when alert becomes active
    if (highestAlert && !isVisible) {
      setCurrentAlert(highestAlert);
      setIsVisible(true);
      setIsAnimating(true);
    } 
    // Hide popup when no alerts are active
    else if (!highestAlert && isVisible) {
      setIsAnimating(false);
      setTimeout(() => {
        setIsVisible(false);
        setCurrentAlert(null);
      }, 300);
    }
    // Update current alert if a higher priority alert becomes active
    else if (highestAlert && isVisible && highestAlert !== currentAlert) {
      setCurrentAlert(highestAlert);
    }
  }, [alerts.early, alerts.mid, alerts.late]);

  const handleAction = (action: string) => {
    if (onAction) {
      onAction(action);
    }
    handleDismiss();
  };

  const handleDismiss = () => {
    setIsAnimating(false);
    setTimeout(() => {
      setIsVisible(false);
      if (onDismiss) {
        onDismiss();
      }
    }, 200);
  };

  if (!isVisible || !currentAlert) {
    return null;
  }

  const alertConfig = ALERT_DETAILS[currentAlert];

  return (
    <div
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: `translate(-50%, -50%) scale(${isAnimating ? 1 : 0.9})`,
        opacity: isAnimating ? 1 : 0,
        transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        zIndex: 999999, // Even higher z-index
        width: '420px',
        maxWidth: '90vw',
        pointerEvents: 'auto',
      }}
    >
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          top: '-50vh',
          left: '-50vw',
          width: '200vw',
          height: '200vh',
          background: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(4px)',
          zIndex: -1,
        }}
        onClick={handleDismiss}
      />

      {/* Alert Card */}
      <div
        style={{
          background: `linear-gradient(
            135deg,
            #3a3f45 0%,
            #2b2f33 25%,
            #3a3f45 50%,
            #2b2f33 75%,
            #3a3f45 100%
          )`,
          borderRadius: '12px',
          padding: '20px',
          border: `3px solid ${alertConfig.color}`,
          boxShadow: `
            0 0 30px ${alertConfig.color}44,
            inset 0 3px 8px rgba(0,0,0,0.6),
            0 10px 25px rgba(0,0,0,0.8)
          `,
          position: 'relative',
        }}
      >
        {/* Close Button */}
        <button
          onClick={handleDismiss}
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid #3a3f45',
            color: '#c0c5ca',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px',
            fontWeight: 'bold',
          }}
        >
          ×
        </button>

        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '16px',
        }}>
          <span style={{ fontSize: '24px' }}>{alertConfig.icon}</span>
          <div>
            <div style={{
              fontSize: '16px',
              fontWeight: 'bold',
              color: alertConfig.color,
              fontFamily: 'monospace',
              letterSpacing: '1px',
            }}>
              {alertConfig.title}
            </div>
            <div style={{
              fontSize: '11px',
              fontFamily: 'monospace',
              color: '#9aa0a6',
              letterSpacing: '2px',
              textTransform: 'uppercase',
            }}>
              Severity: {alertConfig.severity}
            </div>
          </div>
        </div>

        {/* Description */}
        <div style={{
          fontSize: '13px',
          color: '#c0c5ca',
          marginBottom: '16px',
          lineHeight: '1.4',
        }}>
          {alertConfig.description}
        </div>

        {/* Current Metrics */}
        <div style={{
          background: 'rgba(0,0,0,0.3)',
          borderRadius: '6px',
          padding: '12px',
          marginBottom: '16px',
          border: '1px solid #1a1d20',
        }}>
          <div style={{
            fontSize: '10px',
            fontFamily: 'monospace',
            color: '#7a7f85',
            marginBottom: '8px',
            letterSpacing: '1px',
            textTransform: 'uppercase',
          }}>
            Current Readings
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px',
            fontSize: '11px',
            fontFamily: 'monospace',
            color: '#c0c5ca',
          }}>
            <div>EWMA: <span style={{ color: alertConfig.color }}>{ewma.toFixed(3)}A</span></div>
            <div>Slope: <span style={{ color: alertConfig.color }}>{slope.toFixed(5)}</span></div>
            <div>Variance: <span style={{ color: alertConfig.color }}>{variance.toFixed(3)}</span></div>
            <div>Cycle Time: <span style={{ color: alertConfig.color }}>{cycleTime.toFixed(2)}s</span></div>
          </div>
        </div>

        {/* Recommendations */}
        <div style={{
          marginBottom: '16px',
        }}>
          <div style={{
            fontSize: '11px',
            fontFamily: 'monospace',
            color: '#c0c5ca',
            marginBottom: '8px',
            letterSpacing: '1px',
            textTransform: 'uppercase',
            fontWeight: 'bold',
          }}>
            Recommended Actions
          </div>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}>
            {alertConfig.recommendations.map((rec, index) => (
              <div key={index} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '11px',
                color: '#9aa0a6',
              }}>
                <div style={{
                  width: '4px',
                  height: '4px',
                  borderRadius: '50%',
                  background: alertConfig.color,
                  flexShrink: 0,
                }} />
                {rec}
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
        }}>
          {alertConfig.actions.map((action, index) => (
            <button
              key={index}
              onClick={() => handleAction(action.action)}
              style={{
                flex: 1,
                minWidth: '120px',
                padding: '10px 16px',
                borderRadius: '6px',
                fontFamily: 'monospace',
                fontSize: '11px',
                fontWeight: 'bold',
                letterSpacing: '1px',
                textTransform: 'uppercase',
                cursor: 'pointer',
                background: `linear-gradient(180deg, ${alertConfig.color} 0%, ${alertConfig.color}dd 100%)`,
                color: '#1f2327',
                border: `2px solid ${alertConfig.color}dd`,
                boxShadow: `0 0 12px ${alertConfig.color}44, inset 0 2px 4px rgba(255,255,255,0.3)`,
                textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = `0 0 16px ${alertConfig.color}66, inset 0 2px 4px rgba(255,255,255,0.3)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = `0 0 12px ${alertConfig.color}44, inset 0 2px 4px rgba(255,255,255,0.3)`;
              }}
            >
              {action.label}
            </button>
          ))}
        </div>

        {/* Dismiss Button */}
        <button
          onClick={handleDismiss}
          style={{
            width: '100%',
            marginTop: '12px',
            padding: '8px',
            borderRadius: '4px',
            fontFamily: 'monospace',
            fontSize: '10px',
            fontWeight: 'bold',
            letterSpacing: '1px',
            textTransform: 'uppercase',
            cursor: 'pointer',
            background: 'rgba(255,255,255,0.05)',
            color: '#7a7f85',
            border: '1px solid #3a3f45',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
            e.currentTarget.style.color = '#9aa0a6';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
            e.currentTarget.style.color = '#7a7f85';
          }}
        >
          Acknowledge Alert
        </button>
      </div>
    </div>
  );
}
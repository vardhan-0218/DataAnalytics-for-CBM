/**
 * CompactAlertIndicators.tsx
 * 
 * Full alert display showing Early, Mid, and Late alerts clearly
 * Matches the previous design that displays all alert types
 */

import React from 'react';
import styles from './CompactAlertIndicators.module.css';

interface CompactAlertIndicatorsProps {
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

function Screws() {
  const positions = [
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

export function CompactAlertIndicators({ alerts, ewma, slope, variance, cycleTime, config }: CompactAlertIndicatorsProps) {
  const activeAlerts = [alerts.early, alerts.mid, alerts.late].filter(Boolean).length;
  
  const getOverallStatus = () => {
    if (alerts.late) return { text: 'CRITICAL', type: 'critical' };
    if (alerts.mid) return { text: 'WARNING', type: 'warning' };
    if (alerts.early) return { text: 'CAUTION', type: 'normal' };
    return { text: 'NORMAL', type: 'normal' };
  };

  const status = getOverallStatus();

  return (
    <div className={styles.card}>
      <Screws />
      
      {/* Header */}
      <div className={styles.header}>
        Alert System
      </div>

      {/* Overall Status Bar */}
      <div className={`${styles.statusBar} ${styles[`statusBar${status.type.charAt(0).toUpperCase() + status.type.slice(1)}`]}`}>
        <div className={`${styles.statusIndicator} ${styles[`statusIndicator${status.type.charAt(0).toUpperCase() + status.type.slice(1)}`]}`} />
        <span className={`${styles.statusText} ${styles[`statusText${status.type.charAt(0).toUpperCase() + status.type.slice(1)}`]}`}>
          {status.text}
        </span>
        <span className={styles.statusCount}>
          ({activeAlerts})
        </span>
      </div>

      {/* Individual Alert Indicators */}
      <div className={styles.alertsContainer}>
        
        {/* Early Alert */}
        <div className={`${styles.alertIndicator} ${alerts.early ? styles.alertIndicatorEarly : styles.alertIndicatorInactive}`}>
          <div className={styles.alertLeft}>
            <span className={styles.alertIcon}>⚠</span>
            <span className={`${styles.alertLabel} ${alerts.early ? styles.alertLabelEarly : styles.alertLabelInactive}`}>
              EARLY
            </span>
          </div>
          <div className={styles.alertRight}>
            <span className={`${styles.alertCount} ${alerts.early ? styles.alertCountEarly : styles.alertCountInactive}`}>
              {alerts.early_trigger_time ? '1' : '0'}
            </span>
            {alerts.early_trigger_time && (
              <span className={`${styles.alertTime} ${styles.alertTimeEarly}`}>
                t={alerts.early_trigger_time}
              </span>
            )}
          </div>
        </div>

        {/* Mid Alert */}
        <div className={`${styles.alertIndicator} ${alerts.mid ? styles.alertIndicatorMid : styles.alertIndicatorInactive}`}>
          <div className={styles.alertLeft}>
            <span className={styles.alertIcon}>⚡</span>
            <span className={`${styles.alertLabel} ${alerts.mid ? styles.alertLabelMid : styles.alertLabelInactive}`}>
              MID
            </span>
          </div>
          <div className={styles.alertRight}>
            <span className={`${styles.alertCount} ${alerts.mid ? styles.alertCountMid : styles.alertCountInactive}`}>
              {alerts.mid_trigger_time ? '1' : '0'}
            </span>
            {alerts.mid_trigger_time && (
              <span className={`${styles.alertTime} ${styles.alertTimeMid}`}>
                t={alerts.mid_trigger_time}
              </span>
            )}
          </div>
        </div>

        {/* Late Alert */}
        <div className={`${styles.alertIndicator} ${alerts.late ? styles.alertIndicatorLate : styles.alertIndicatorInactive}`}>
          <div className={styles.alertLeft}>
            <span className={styles.alertIcon}>🚨</span>
            <span className={`${styles.alertLabel} ${alerts.late ? styles.alertLabelLate : styles.alertLabelInactive}`}>
              LATE
            </span>
          </div>
          <div className={styles.alertRight}>
            <span className={`${styles.alertCount} ${alerts.late ? styles.alertCountLate : styles.alertCountInactive}`}>
              {alerts.late_trigger_time ? '1' : '0'}
            </span>
            {alerts.late_trigger_time && (
              <span className={`${styles.alertTime} ${styles.alertTimeLate}`}>
                t={alerts.late_trigger_time}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
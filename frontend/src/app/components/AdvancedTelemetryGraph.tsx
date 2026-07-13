/**
 * AdvancedTelemetryGraph.tsx
 * 
 * Sophisticated real-time graph matching analysis.py implementation with:
 * - Zoom/pan controls
 * - Hover tooltips with exact values
 * - Real-time EWMA calculation
 * - Alert zone visualization
 * - Control lines and alert markers
 * - Rolling window management
 * - Interactive legend
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ChartOptions,
  Plugin,
  TooltipItem,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import zoomPlugin from 'chartjs-plugin-zoom';
import styles from './AdvancedTelemetryGraph.module.css';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  zoomPlugin
);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TelemetryPoint {
  time: string;
  timestamp: number;
  t?: number;           // Simulation cycle number
  current: number;
  noise: number;
  ewma: number;         // Slow EWMA (baseline)
  ewma_fast?: number;   // Fast EWMA (trend)
  ewma_slow?: number;   // Slow EWMA (same as ewma)
  gap?: number;         // fast - slow (trend gap)
  slope?: number;
  variance?: number;
  cycleTime?: number;
}

export interface AlertState {
  early: boolean;
  mid: boolean;
  late: boolean;
  earlyTriggerTime?: number;
  midTriggerTime?: number;
  lateTriggerTime?: number;
}

interface AdvancedTelemetryGraphProps {
  history: TelemetryPoint[];
  alerts: AlertState;
  config?: {
    alpha?: number;
    mu?: number;
    ucl2Sigma?: number;
    ucl3Sigma?: number;
    windowSize?: number;
  };
}

// ── Configuration matching analysis.py exactly ──────────────────────────────

const DEFAULT_CONFIG = {
  alpha: 0.1,
  mu: 5.0,
  sigma: 0.25,
  ucl2Sigma: 5.5,   // MU + 2 * SIGMA
  ucl3Sigma: 5.75,  // MU + 3 * SIGMA
  windowSize: 100,  // Show last 100 points in rolling window
};

// Alert colors matching analysis.py LivePlot._TIER_STYLE exactly
const ALERT_COLORS = {
  early: { 
    color: 'green',      // analysis.py: color="green"
    marker: '^',         // analysis.py: marker="^"
    shade: 'limegreen',  // analysis.py: shade="limegreen"
    alpha: 0.10          // analysis.py: alpha=0.10
  },
  mid: { 
    color: 'orange',     // analysis.py: color="orange"
    marker: 'D',         // analysis.py: marker="D"
    shade: 'orange',     // analysis.py: shade="orange"
    alpha: 0.12          // analysis.py: alpha=0.12
  },
  late: { 
    color: 'red',        // analysis.py: color="red"
    marker: 'X',         // analysis.py: marker="X"
    shade: 'red',        // analysis.py: shade="red"
    alpha: 0.15          // analysis.py: alpha=0.15
  },
};

// Chart background colors for alert tiers - matching analysis.py axvspan
const TIER_CHART_BG = {
  early: `rgba(50, 205, 50, ${ALERT_COLORS.early.alpha})`,   // limegreen with alpha=0.10
  mid: `rgba(255, 165, 0, ${ALERT_COLORS.mid.alpha})`,       // orange with alpha=0.12
  late: `rgba(255, 0, 0, ${ALERT_COLORS.late.alpha})`,       // red with alpha=0.15
};

// ── Main Component ───────────────────────────────────────────────────────────

export function AdvancedTelemetryGraph({ 
  history, 
  alerts, 
  config = DEFAULT_CONFIG 
}: AdvancedTelemetryGraphProps) {
  const chartRef = useRef<ChartJS<'line'>>(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [visibleLines, setVisibleLines] = useState({
    current: true,
    ewma: true,
  });

  const cfg = { ...DEFAULT_CONFIG, ...config };

  // ── Active alert tier (highest severity wins) ──────────────────────────
  const activeTier: 'none' | 'early' | 'mid' | 'late' = alerts.late
    ? 'late'
    : alerts.mid
    ? 'mid'
    : alerts.early
    ? 'early'
    : 'none';

  // Ref used by the Chart.js plugin so it reads current tier without stale closure
  const activeTierRef = useRef(activeTier);
  activeTierRef.current = activeTier;


  // ── Chart.js plugin: tints chart area background by active alert tier ─────
  // Mirrors analysis.py LivePlot._TIER_STYLE shade + axvspan approach.
  // DISABLED: Background tinting causes unwanted color changes
  const alertBgPlugin = useRef<Plugin<'line'>>({
    id: 'alertBackground',
    beforeDraw(chart) {
      // Background tinting disabled - keep chart background neutral
      return;
      
      // Original code (disabled):
      // const tier = activeTierRef.current;
      // if (tier === 'none') return;
      // const { ctx, chartArea } = chart;
      // if (!chartArea) return;
      // ctx.save();
      // ctx.fillStyle = TIER_CHART_BG[tier];
      // ctx.fillRect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
      // ctx.restore();
    },
  }).current;

  // ── Chart.js plugin: pixel-perfect alert markers on EWMA line ─────────────
  // All markers are canvas-drawn at the rendered EWMA element position so they
  // stay locked to the line in realtime (no Chart.js point-style drift).
  const alertMarkersPlugin = useRef<Plugin<'line'>>({
    id: 'alertMarkers',
    afterDatasetsDraw(chart) {
      const markers = alertMarkersRef.current;
      if (markers.length === 0) return;

      const { ctx, chartArea } = chart;
      if (!chartArea) return;

      const ewmaDatasetIndex = chart.data.datasets.findIndex(
        ds => ds.label === 'EWMA (Slow)' || ds.label === 'EWMA'
      );
      if (ewmaDatasetIndex === -1) return;

      const ewmaMeta = chart.getDatasetMeta(ewmaDatasetIndex);
      if (!ewmaMeta || ewmaMeta.hidden) return;

      const labels = chart.data.labels as string[] | undefined;
      if (!labels) return;

      ctx.save();
      ctx.beginPath();
      ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
      ctx.clip();

      for (const marker of markers) {
        const labelIndex = labels.indexOf(String(marker.t));
        if (labelIndex < 0) continue;

        const element = ewmaMeta.data[labelIndex];
        if (!element || element.x == null || element.y == null) continue;

        const x = element.x;
        const y = element.y;

        if (marker.type === 'early') {
          const R = 9;
          ctx.fillStyle = '#00aa00';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, y - R);
          ctx.lineTo(x + R * 0.866, y + R * 0.5);
          ctx.lineTo(x - R * 0.866, y + R * 0.5);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (marker.type === 'mid') {
          const R = 8;
          ctx.fillStyle = '#ffa500';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, y - R);
          ctx.lineTo(x + R, y);
          ctx.lineTo(x, y + R);
          ctx.lineTo(x - R, y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (marker.type === 'late') {
          const ARM = 10;
          const LINE_W = 4;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = LINE_W + 3;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x - ARM, y - ARM);
          ctx.lineTo(x + ARM, y + ARM);
          ctx.moveTo(x + ARM, y - ARM);
          ctx.lineTo(x - ARM, y + ARM);
          ctx.stroke();
          ctx.strokeStyle = '#ff1a1a';
          ctx.lineWidth = LINE_W;
          ctx.beginPath();
          ctx.moveTo(x - ARM, y - ARM);
          ctx.lineTo(x + ARM, y + ARM);
          ctx.moveTo(x + ARM, y - ARM);
          ctx.lineTo(x - ARM, y + ARM);
          ctx.stroke();
          ctx.fillStyle = '#ff1a1a';
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    },
  }).current;

  // ── Data Processing ────────────────────────────────────────────────────────

  // Keep ALL history data for scrolling - don't window it
  // The chart will show the most recent data by default, but users can scroll back
  const displayHistory = React.useMemo(() => {
    return history; // Show all data, not just last windowSize
  }, [history]);
  
  // Track if user has manually interacted with the chart
  const [userInteracted, setUserInteracted] = useState(false);
  
  const labels = React.useMemo(() => displayHistory.map(p => p.time), [displayHistory]);
  const currentData = React.useMemo(() => displayHistory.map(p => p.current), [displayHistory]);
  const ewmaData = React.useMemo(() => displayHistory.map(p => p.ewma), [displayHistory]);
  const ewmaFastData = React.useMemo(() => displayHistory.map(p => p.ewma_fast ?? p.ewma), [displayHistory]);
  const gapData = React.useMemo(() => displayHistory.map(p => p.gap ?? 0), [displayHistory]);

  // ── Save Graph Function ───────────────────────────────────────────────────
  
  const saveGraph = useCallback(() => {
    if (chartRef.current) {
      try {
        const canvas = chartRef.current.canvas;
        if (canvas) {
          const now = new Date();
          const dateStr = now.toISOString().slice(0, 10);
          const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
          const dataPoints = displayHistory.length;
          const currentEWMAValue = displayHistory.length > 0
            ? displayHistory[displayHistory.length - 1].ewma.toFixed(3)
            : '0.000';

          // Save as JPEG
          const filename = `motor-telemetry_${dateStr}_${timeStr}_${dataPoints}pts_ewma${currentEWMAValue}.jpg`;

          // Draw on a white-background offscreen canvas (JPEG doesn't support transparency)
          const offscreen = document.createElement('canvas');
          offscreen.width = canvas.width;
          offscreen.height = canvas.height;
          const ctx = offscreen.getContext('2d')!;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, offscreen.width, offscreen.height);
          ctx.drawImage(canvas, 0, 0);

          const link = document.createElement('a');
          link.download = filename;
          link.href = offscreen.toDataURL('image/jpeg', 0.95);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          console.log(`Graph saved as: ${filename}`);
        }
      } catch (error) {
        console.error('Failed to save graph:', error);
        alert('Failed to save graph. Please try again.');
      }
    }
  }, [displayHistory]);

  // ── Alert Markers State ──────────────────────────────────────────────────
  const [alertMarkers, setAlertMarkers] = useState<Array<{
    t: number;        // simulation cycle — stable key for exact x placement
    type: 'early' | 'mid' | 'late';
    ewma: number;
    timestamp: number;
  }>>([]);

  const alertMarkersRef = useRef(alertMarkers);
  alertMarkersRef.current = alertMarkers;

  // ── Track Alert Triggers ─────────────────────────────────────────────────
  const prevAlertsRef = useRef<AlertState>({
    early: false,
    mid: false,
    late: false,
  });

  useEffect(() => {
    const prevAlerts = prevAlertsRef.current;

    // ── Capture trigger point using trigger times from backend ────────────
    // Only add markers when we receive a new trigger time from the backend
    // Check if we have new trigger times from the backend
    const hasNewEarlyTrigger = alerts.earlyTriggerTime && 
      (!prevAlerts.earlyTriggerTime || alerts.earlyTriggerTime !== prevAlerts.earlyTriggerTime);
    
    const hasNewMidTrigger = alerts.midTriggerTime && 
      (!prevAlerts.midTriggerTime || alerts.midTriggerTime !== prevAlerts.midTriggerTime);
    
    const hasNewLateTrigger = alerts.lateTriggerTime && 
      (!prevAlerts.lateTriggerTime || alerts.lateTriggerTime !== prevAlerts.lateTriggerTime);

    const addMarker = (
      type: 'early' | 'mid' | 'late',
      triggerT: number | undefined
    ) => {
      if (triggerT == null) return;
      const triggerPoint = displayHistory.find(p => p.t === triggerT);
      if (!triggerPoint) return; // wait until exact cycle exists in history

      setAlertMarkers(prev => {
        if (prev.some(m => m.type === type)) return prev;
        console.log(`${type.toUpperCase()} alert marker → t=${triggerT}, EWMA=${triggerPoint.ewma}`);
        return [
          ...prev,
          {
            t: triggerT,
            type,
            ewma: triggerPoint.ewma,
            timestamp: triggerPoint.timestamp,
          },
        ];
      });
    };

    if (hasNewEarlyTrigger) addMarker('early', alerts.earlyTriggerTime);
    if (hasNewMidTrigger) addMarker('mid', alerts.midTriggerTime);
    if (hasNewLateTrigger) addMarker('late', alerts.lateTriggerTime);

    prevAlertsRef.current = { ...alerts };
  }, [alerts, displayHistory]);

  // ── Clean up old wear rate lines and markers on simulation reset ──────────
  useEffect(() => {
    // When simulation restarts, history drops back to length 1 (the t=0 point)
    if (displayHistory.length <= 1) {
      setAlertMarkers([]);
      prevAlertsRef.current = { early: false, mid: false, late: false };
      setUserInteracted(false); // Reset user interaction on simulation reset
      
      // Force chart reset to initial position
      if (chartRef.current) {
        try {
          chartRef.current.resetZoom();
          chartRef.current.update('none');
          setIsZoomed(false);
        } catch (error) {
          console.error('Chart reset error:', error);
        }
      }
      
      console.log('Chart reset to initial position - all markers and zoom cleared');
    }
  }, [displayHistory.length]);


  // ══════════════════════════════════════════════════════════════════════════
  // ✨ DYNAMIC Y-AXIS SCALING - START
  // ══════════════════════════════════════════════════════════════════════════
  // Calculate dynamic Y-axis range based on actual data
  const dynamicYRange = React.useMemo(() => {
    if (displayHistory.length === 0) {
      return {
        min: Math.max(0, cfg.mu - 1),
        max: cfg.ucl3Sigma + 0.8,
      };
    }

    // Get min/max from visible data
    const visibleData = displayHistory.slice(-cfg.windowSize);
    const allValues = visibleData.flatMap(p => [p.current, p.ewma]);
    const dataMin = Math.min(...allValues);
    const dataMax = Math.max(...allValues);

    // Add padding (10% on each side)
    const range = dataMax - dataMin;
    const padding = Math.max(range * 0.1, 0.5); // At least 0.5A padding

    // Ensure control lines are visible
    const minWithControls = Math.min(dataMin - padding, cfg.mu - 0.5);
    const maxWithControls = Math.max(dataMax + padding, cfg.ucl3Sigma + 0.5);

    return {
      min: Math.max(0, minWithControls), // Never go below 0
      max: maxWithControls,
    };
  }, [displayHistory, cfg.windowSize, cfg.mu, cfg.ucl3Sigma]);
  // ══════════════════════════════════════════════════════════════════════════
  // ✨ DYNAMIC Y-AXIS SCALING - END
  // ══════════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════════
  // ✨ DYNAMIC X-AXIS SCALING - START
  // ══════════════════════════════════════════════════════════════════════════
  // Calculate dynamic X-axis range based on data density and user interaction
  const dynamicXRange = React.useMemo(() => {
    if (displayHistory.length === 0) {
      return { min: undefined, max: undefined };
    }

    // If user has interacted, don't auto-adjust (let them control the view)
    if (userInteracted) {
      return { min: undefined, max: undefined };
    }

    // Auto-scale based on data amount
    if (displayHistory.length <= cfg.windowSize) {
      // Show all data if less than window size
      return { min: undefined, max: undefined };
    } else {
      // Show rolling window of last N points
      const startLabel = labels[displayHistory.length - cfg.windowSize];
      const endLabel = labels[displayHistory.length - 1];
      return { min: startLabel, max: endLabel };
    }
  }, [displayHistory.length, labels, cfg.windowSize, userInteracted]);
  // ══════════════════════════════════════════════════════════════════════════
  // ✨ DYNAMIC X-AXIS SCALING - END
  // ══════════════════════════════════════════════════════════════════════════

  // ── Chart Configuration matching analysis.py styling ─────────────────────────

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    // Disable animation entirely for real-time oscilloscope-style rendering
    animation: false,
    transitions: {
      active: { animation: { duration: 0 } },
    },
    resizeDelay: 0,
    interaction: { 
      mode: 'index', 
      intersect: false,
    },
    elements: {
      point: {
        hoverRadius: 6,
        hoverBorderWidth: 2,
      },
      line: {
        tension: 0.1,
        borderCapStyle: 'round',
        borderJoinStyle: 'round',
      }
    },
    plugins: {
      legend: {
        position: 'top',
        align: 'start',
        labels: {
          font: { 
            size: 8,  // analysis.py: fontsize=8
            family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            weight: 400
          },
          color: '#2d3748',
          usePointStyle: true,
          pointStyleWidth: 12,
          padding: 20,
          boxWidth: 12,
          boxHeight: 12,
          filter: (legendItem) => {
            const text = legendItem.text?.toLowerCase() || '';
            // Toggle raw current / ewma visibility
            if (text === 'raw current') return visibleLines.current;
            if (text.includes('ewma')) return visibleLines.ewma;
            // Hide all wear rate change lines from legend
            if (
              text.includes('wear rate') ||
              text.includes('📈') ||
              text.includes('📉') ||
              text.includes('🔄')
            ) return false;
            return true;
          },
          // Fix EWMA legend swatch: pointStyle/pointRadius are per-point arrays;
          // Chart.js uses index 0 (circle, radius 0) → invisible. Override to
          // show a solid blue line swatch that matches the EWMA line colour.
          generateLabels: (chart) => {
            const defaultFn = ChartJS.defaults.plugins.legend.labels.generateLabels;
            const items = defaultFn(chart).map(item => {
              if (item.text === 'EWMA (Slow)') {
                item.pointStyle  = 'line';
                item.strokeStyle = '#4169e1';
                item.lineWidth   = 2;
                item.fillStyle   = 'transparent';
              } else if (item.text === 'EWMA (Fast)') {
                item.pointStyle  = 'line';
                item.strokeStyle = '#00bfff';
                item.lineWidth   = 1.5;
                item.fillStyle   = 'transparent';
                item.lineDash    = [4, 2];
              }
              return item;
            });

            const legendSwatches: Array<{ text: string; fill: string; style: 'triangle' | 'rectRot' | 'crossRot' }> = [];
            if (alertMarkersRef.current.some(m => m.type === 'early')) {
              legendSwatches.push({ text: 'Early Alert', fill: '#00aa00', style: 'triangle' });
            }
            if (alertMarkersRef.current.some(m => m.type === 'mid')) {
              legendSwatches.push({ text: 'Mid Alert', fill: '#ffa500', style: 'rectRot' });
            }
            if (alertMarkersRef.current.some(m => m.type === 'late')) {
              legendSwatches.push({ text: 'Late Alert', fill: '#ff1a1a', style: 'crossRot' });
            }

            for (const swatch of legendSwatches) {
              items.push({
                text: swatch.text,
                fillStyle: swatch.fill,
                strokeStyle: swatch.fill,
                lineWidth: 0,
                hidden: false,
                index: items.length,
                datasetIndex: -1,
                pointStyle: swatch.style,
              });
            }

            return items;
          },
        },
        onClick: (_e, legendItem, legend) => {
          const text = legendItem.text?.toLowerCase() || '';
          if (text === 'raw current') {
            setVisibleLines(prev => ({ ...prev, current: !prev.current }));
          } else if (text.includes('ewma')) {
            // Toggle both EWMA lines together
            setVisibleLines(prev => ({ ...prev, ewma: !prev.ewma }));
          } else {
            const chart = legend.chart;
            const datasetIndex = legendItem.datasetIndex;
            if (datasetIndex !== undefined) {
              const meta = chart.getDatasetMeta(datasetIndex);
              meta.hidden = meta.hidden === null ? !(chart.data.datasets[datasetIndex].hidden || false) : !meta.hidden;
              chart.update('none');
            }
          }
        },
      },
      tooltip: {
        enabled: true,
        backgroundColor: 'rgba(255, 255, 255, 0.97)',
        borderColor: '#cbd5e0',
        borderWidth: 1,
        titleColor: '#1a202c',
        bodyColor: '#4a5568',
        titleFont: { 
          family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          size: 12, 
          weight: 600
        },
        bodyFont: { 
          family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          size: 11 
        },
        padding: 12,
        cornerRadius: 6,
        displayColors: true,
        usePointStyle: true,
        boxWidth: 10,
        boxHeight: 10,
        callbacks: {
          title: (tooltipItems: TooltipItem<'line'>[]) => {
            const index = tooltipItems[0]?.dataIndex;
            if (index !== undefined && displayHistory[index]) {
              const point = displayHistory[index];
              return `Cycle t = ${point.t ?? point.time}`;
            }
            return '';
          },
          label: (context: TooltipItem<'line'>) => {
            const value = context.parsed.y;
            const datasetLabel = context.dataset.label || '';
            const index = context.dataIndex;
            
            // For EWMA datasets, show additional dual EWMA info
            if (datasetLabel.includes('EWMA') && displayHistory[index]) {
              const point = displayHistory[index];
              if (datasetLabel.includes('Fast')) {
                return `${datasetLabel}: ${(value || 0).toFixed(3)} A (trend)`;
              } else if (datasetLabel.includes('Slow')) {
                const gap = point.gap ?? 0;
                return [
                  `${datasetLabel}: ${(value || 0).toFixed(3)} A (baseline)`,
                  `Gap: ${gap.toFixed(5)} A (fast - slow)`
                ];
              }
            }
            
            return `${datasetLabel}: ${(value || 0).toFixed(3)} A`;
          },
        },
      },
      zoom: {
        zoom: {
          wheel: { enabled: true, speed: 0.1 },
          pinch: { enabled: true },
          mode: 'xy',  // Allow zoom in both directions
          onZoomStart: () => {
            setUserInteracted(true);
            return false;
          },
          onZoomComplete: () => setIsZoomed(true),
        },
        pan: {
          enabled: true,
          mode: 'xy',  // Allow pan in both directions
          onPanStart: () => {
            setUserInteracted(true);
            return false;
          },
          onPanComplete: () => setIsZoomed(true),
        },
        limits: {
          x: { min: 'original', max: 'original' },  // Allow panning through all data
          y: { min: 'original', max: 'original' },
        },
      },
    },
    scales: {
      x: {
        type: 'category',
        grid: {
          color: 'rgba(0,0,0,0.08)',
          lineWidth: 1,
        },
        ticks: {
          font: { size: 10, family: 'monospace' },
          color: '#4a5568',
          maxTicksLimit: 10,
          maxRotation: 0,
          autoSkip: true,
          autoSkipPadding: 10,
        },
        border: { color: 'rgba(0,0,0,0.2)' },
        title: {
          display: true,
          text: 'Simulation cycle (t)',  // analysis.py: "Simulation cycle (t)"
          color: '#2d3748',
          font: { size: 11, family: 'monospace' },
          padding: { top: 6 },
        },
        // ✨ DYNAMIC X-AXIS SCALING - Use calculated range
        min: dynamicXRange.min,
        max: dynamicXRange.max,
        // ✨ ORIGINAL ROLLING WINDOW VALUES (commented out for easy restore):
        // min: displayHistory.length > cfg.windowSize && !userInteracted
        //   ? labels[displayHistory.length - cfg.windowSize]
        //   : undefined,
        // max: displayHistory.length > 0 && !userInteracted
        //   ? labels[displayHistory.length - 1]
        //   : undefined,
      },
      y: {
        type: 'linear',
        display: true,
        position: 'left',
        grid: {
          color: 'rgba(0,0,0,0.08)',
          lineWidth: 1,
        },
        ticks: {
          font: { size: 10, family: 'monospace' },
          color: '#4a5568',
          callback: (value) => `${Number(value || 0).toFixed(1)}A`,
        },
        border: { color: 'rgba(0,0,0,0.2)' },
        title: {
          display: true,
          text: 'Motor current (A)',  // analysis.py: "Motor current (A)"
          color: '#2d3748',
          font: { size: 11, family: 'monospace' },
          padding: { bottom: 6 },
        },
        // ✨ DYNAMIC Y-AXIS SCALING - Use calculated range instead of static values
        min: dynamicYRange.min,
        max: dynamicYRange.max,
        // ✨ ORIGINAL STATIC VALUES (commented out for easy restore):
        // min: Math.max(0, cfg.mu - 1),
        // max: cfg.ucl3Sigma + 0.8,
      },
    },
  };

  // ── Chart Data matching analysis.py exactly ──────────────────────────────────

  const chartData = React.useMemo(() => {
    return {
      labels,
      datasets: [
        // Raw Current — matching analysis.py: alpha=0.25, color="steelblue", lw=0.8
        {
          label: 'Raw Current',
          data: currentData,
          borderColor: 'rgba(70, 130, 180, 0.25)',  // steelblue with alpha=0.25
          backgroundColor: 'transparent',
          borderWidth: 0.8,  // analysis.py: lw=0.8
          tension: 0.05,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointBackgroundColor: 'rgba(70, 130, 180, 0.8)',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1,
          fill: false,
          hidden: !visibleLines.current,
          order: 3,
        },
        // EWMA — matching analysis.py: color="royalblue", lw=2
        {
          label: `EWMA (Slow)`,
          data: ewmaData,
          borderColor: '#4169e1',  // royalblue
          backgroundColor: 'transparent',
          borderWidth: 2,  // analysis.py: lw=2
          tension: 0,  // straight segments — matches matplotlib; markers sit on line
          pointRadius: 0,
          pointHoverRadius: 5,
          fill: false,
          hidden: !visibleLines.ewma,
          order: 2,
        },
        // EWMA Fast — dual EWMA trend line
        {
          label: `EWMA (Fast)`,
          data: ewmaFastData,
          borderColor: '#00bfff',  // deepskyblue - lighter blue for fast EWMA
          backgroundColor: 'transparent',
          borderWidth: 1.5,  // Thinner than slow EWMA
          borderDash: [4, 2],  // Dashed to distinguish from slow
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: false,
          hidden: !visibleLines.ewma,  // Tied to EWMA visibility
          order: 2,
        },
        // Control lines — matching analysis.py exactly
        ...(labels.length > 0 ? [
          // Mean line: analysis.py: ls="--", color="gray", lw=1
          {
            label: `Mean (${cfg.mu} A)`,
            data: new Array(labels.length).fill(cfg.mu),
            borderColor: '#808080',  // gray
            backgroundColor: 'transparent',
            borderWidth: 1,  // analysis.py: lw=1
            borderDash: [6, 4],  // analysis.py: ls="--"
            pointRadius: 0,
            fill: false,
            tension: 0,
            order: 5,
          },
          // UCL 2σ line: analysis.py: ls="--", color="orange", lw=1.2
          {
            label: `UCL 2σ (${cfg.ucl2Sigma.toFixed(2)} A)`,
            data: new Array(labels.length).fill(cfg.ucl2Sigma),
            borderColor: '#ffa500',  // orange
            backgroundColor: 'transparent',
            borderWidth: 1.2,  // analysis.py: lw=1.2
            borderDash: [6, 4],  // analysis.py: ls="--"
            pointRadius: 0,
            fill: false,
            tension: 0,
            order: 5,
          },
          // UCL 3σ line: analysis.py: ls="--", color="red", lw=1.2
          {
            label: `UCL 3σ (${cfg.ucl3Sigma.toFixed(2)} A)`,
            data: new Array(labels.length).fill(cfg.ucl3Sigma),
            borderColor: '#ff0000',  // red
            backgroundColor: 'transparent',
            borderWidth: 1.2,  // analysis.py: lw=1.2
            borderDash: [6, 4],  // analysis.py: ls="--"
            pointRadius: 0,
            fill: false,
            tension: 0,
            order: 5,
          },
        ] : []),
      ].filter(dataset => dataset),
    };
  }, [labels, currentData, ewmaData, ewmaFastData, cfg, visibleLines]);

  // ── Reset Zoom Function ───────────────────────────────────────────────────

  const resetZoom = useCallback(() => {
    if (chartRef.current) {
      chartRef.current.resetZoom();
      setIsZoomed(false);
      setUserInteracted(false); // Reset user interaction flag to resume auto-scrolling
    }
  }, []);

  // ── Handle fullscreen changes ─────────────────────────────────────────────
  
  useEffect(() => {
    // Multiple resize attempts with different timings for reliability
    const timers = [
      setTimeout(() => {
        if (chartRef.current) {
          try {
            chartRef.current.resize();
          } catch (error) {
            console.error('Chart resize error:', error);
          }
        }
      }, 50),
      setTimeout(() => {
        if (chartRef.current) {
          try {
            chartRef.current.resize();
            chartRef.current.update('none');
          } catch (error) {
            console.error('Chart resize/update error:', error);
          }
        }
      }, 150),
      setTimeout(() => {
        if (chartRef.current) {
          try {
            chartRef.current.resize();
          } catch (error) {
            console.error('Chart resize error:', error);
          }
        }
      }, 300),
      setTimeout(() => {
        if (chartRef.current) {
          try {
            chartRef.current.resize();
          } catch (error) {
            console.error('Chart resize error:', error);
          }
        }
      }, 500), // Additional resize attempt
    ];
    
    return () => {
      timers.forEach(timer => clearTimeout(timer));
    };
  }, [isFullscreen]);

  // ── Escape key handler for fullscreen ────────────────────────────────────
  
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
      // Ctrl+S or Cmd+S to save graph
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        saveGraph();
      }
    };

    const handleResize = () => {
      if (chartRef.current) {
        // Debounced resize
        setTimeout(() => {
          chartRef.current?.resize();
        }, 50);
        setTimeout(() => {
          chartRef.current?.resize();
        }, 200);
      }
    };

    if (isFullscreen) {
      document.addEventListener('keydown', handleKeyDown);
      window.addEventListener('resize', handleResize);
      // Prevent body scroll when in fullscreen
      document.body.style.overflow = 'hidden';
      
      // Force initial resize in fullscreen
      setTimeout(() => {
        if (chartRef.current) {
          chartRef.current.resize();
        }
      }, 100);
    } else {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'auto';
      
      // Force resize when exiting fullscreen
      setTimeout(() => {
        if (chartRef.current) {
          chartRef.current.resize();
        }
      }, 100);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      document.body.style.overflow = 'auto';
    };
  }, [isFullscreen, saveGraph]);

  // ── Force chart update when data changes ─────────────────────────────────
  
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || displayHistory.length === 0) return;

    try {
      if (chart.options.scales?.x) {
        chart.options.scales.x.min = dynamicXRange.min;
        chart.options.scales.x.max = dynamicXRange.max;
      }
      if (chart.options.scales?.y) {
        chart.options.scales.y.min = dynamicYRange.min;
        chart.options.scales.y.max = dynamicYRange.max;
      }
      chart.update('none');
    } catch (error) {
      console.error('Chart update error:', error);
    }
  }, [displayHistory.length, alertMarkers.length, userInteracted, dynamicXRange, dynamicYRange]);

  // ── Status Display ────────────────────────────────────────────────────────



  const currentEwma = displayHistory.length > 0 ? displayHistory[displayHistory.length - 1].ewma : 0;

  const toggleFullscreen = () => {
    const newFullscreenState = !isFullscreen;
    setIsFullscreen(newFullscreenState);
    
    // Reset zoom and user interaction when toggling fullscreen
    if (chartRef.current) {
      chartRef.current.resetZoom();
      setIsZoomed(false);
      setUserInteracted(false);
    }
    
    // Force multiple chart resizes with different timings for reliability
    const resizeChart = () => {
      if (chartRef.current) {
        chartRef.current.resize();
        chartRef.current.update('none'); // Update without animation
      }
    };
    
    // Immediate resize
    resizeChart();
    
    // Multiple delayed resizes for reliability
    setTimeout(resizeChart, 50);
    setTimeout(resizeChart, 150);
    setTimeout(resizeChart, 300);
    setTimeout(resizeChart, 500);
  };

  return (
    <div className={isFullscreen ? styles.containerFullscreen : styles.container}>
      
      {/* Chart Container — white plot area */}
      <div className={`${styles.chartContainer} ${isFullscreen ? styles.chartContainerFullscreen : styles.chartContainerNormal}`}>
        {displayHistory.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}>📈</div>
            <div className={styles.emptyStateText}>WAITING FOR TELEMETRY DATA...</div>
            <div className={styles.emptyStateSubtext}>
              Press START to begin simulation
            </div>
          </div>
        ) : (
          <div className={styles.chartContent}>
            <Line 
              ref={chartRef} 
              data={chartData} 
              options={chartOptions}
              plugins={[alertBgPlugin, alertMarkersPlugin]}
            />
          </div>
        )}
      </div>

      {/* Minimal controls at bottom */}
      {!isFullscreen && (
        <div className={styles.controls}>
          <div className={styles.controlsLeft}>
            {isZoomed && (
              <button
                onClick={resetZoom}
                className={styles.controlButton}
                title="Reset zoom and resume auto-scroll"
              >
                Reset
              </button>
            )}
            
            {userInteracted && !isZoomed && (
              <button
                onClick={() => setUserInteracted(false)}
                className={styles.controlButton}
                title="Resume auto-scroll to latest data"
              >
                Auto
              </button>
            )}
            
            <button
              onClick={saveGraph}
              title="Save graph as JPEG (Ctrl+S)"
              className={styles.controlButton}
            >
              Save
            </button>
            
            <button
              onClick={toggleFullscreen}
              className={styles.controlButton}
              title="Toggle fullscreen"
            >
              {isFullscreen ? 'Exit' : 'Full'}
            </button>
          </div>
          
          <div className={styles.statusDisplay}>
            EWMA: {currentEwma.toFixed(3)}A | Points: {displayHistory.length}
            {userInteracted && ' | 📌 Paused'}
          </div>
        </div>
      )}
    </div>
  );
}
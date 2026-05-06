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
  ScatterController,
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
  ScatterController,
  zoomPlugin
);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TelemetryPoint {
  time: string;
  timestamp: number;
  t?: number;           // Simulation cycle number
  current: number;
  noise: number;
  ewma: number;
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
  const alertBgPlugin = useRef<Plugin<'line'>>({
    id: 'alertBackground',
    beforeDraw(chart) {
      const tier = activeTierRef.current;
      if (tier === 'none') return;
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      ctx.save();
      ctx.fillStyle = TIER_CHART_BG[tier];
      ctx.fillRect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
      ctx.restore();
    },
  }).current;

  // ── Chart.js plugin: draws bold scatter cross (X) for late alert points ──
  // Draws directly on canvas so the marker is always crisp and pixel-perfect,
  // regardless of Chart.js point-style rendering.
  const lateAlertCrossPlugin = useRef<Plugin<'line'>>({
    id: 'lateAlertCross',
    afterDraw(chart) {
      const markers = alertMarkersRef.current.filter(m => m.type === 'late');
      if (markers.length === 0) return;

      const { ctx, chartArea } = chart;
      if (!chartArea) return;

      // Find the EWMA dataset dynamically (index shifts depending on how many alert markers exist)
      const ewmaDatasetIndex = chart.data.datasets.findIndex(ds => ds.label === 'EWMA');
      if (ewmaDatasetIndex === -1) return;

      const ewmaDataset = chart.getDatasetMeta(ewmaDatasetIndex);
      if (!ewmaDataset || ewmaDataset.hidden) return;

      ctx.save();
      // Clip to chart area so crosses don't bleed outside
      ctx.beginPath();
      ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
      ctx.clip();

      markers.forEach(marker => {
        // Find the label's index in the current windowed labels array
        const labelIndex = (chart.data.labels as string[] | undefined)?.indexOf(marker.label);
        if (labelIndex === undefined || labelIndex < 0) return;

        // ── Use actual rendered element position ────────────────────────────
        // Reading element.x / element.y is the only reliable way to get the
        // pixel position. Scale-based getPixelForValue() drifts as the y-axis
        // range expands with new data and is fragile with CategoryScale x-axis.
        const element = ewmaDataset.data[labelIndex];
        if (!element) return;

        const xPixel = element.x;
        const yPixel = element.y;

        const ARM = 10;   // half-length of each cross arm
        const LINE_W = 4; // thickness of the cross arms

        // White outline pass (drawn slightly larger for contrast)
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = LINE_W + 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        // '\' diagonal
        ctx.moveTo(xPixel - ARM, yPixel - ARM);
        ctx.lineTo(xPixel + ARM, yPixel + ARM);
        // '/' diagonal
        ctx.moveTo(xPixel + ARM, yPixel - ARM);
        ctx.lineTo(xPixel - ARM, yPixel + ARM);
        ctx.stroke();

        // Red cross pass (drawn on top)
        ctx.strokeStyle = '#ff1a1a';
        ctx.lineWidth = LINE_W;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(xPixel - ARM, yPixel - ARM);
        ctx.lineTo(xPixel + ARM, yPixel + ARM);
        ctx.moveTo(xPixel + ARM, yPixel - ARM);
        ctx.lineTo(xPixel - ARM, yPixel + ARM);
        ctx.stroke();

        // Small red filled circle at centre
        ctx.fillStyle = '#ff1a1a';
        ctx.beginPath();
        ctx.arc(xPixel, yPixel, 3, 0, Math.PI * 2);
        ctx.fill();
      });

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
    label: string;    // x-axis label (cycle number string) for correct chart placement
    type: 'early' | 'mid' | 'late';
    ewma: number;
    timestamp: number;
  }>>([]);

  // Ref for late alert markers — read by the lateAlertCrossPlugin without stale closure
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

    // ── Capture trigger point when an alert flag FIRST flips true ────────────
    // Only add markers when alert transitions from false to true (first trigger)
    const latestPoint = displayHistory.length > 0
      ? displayHistory[displayHistory.length - 1]
      : null;

    if (alerts.early && !prevAlerts.early && latestPoint) {
      setAlertMarkers(prev => {
        // Debounce: prevent rapid oscillation clusters, but allow new markers if >= 50 cycles later
        if (prev.some(m => m.type === 'early' && (Number(latestPoint.time) - Number(m.label)) < 50)) return prev;
        console.log(`EARLY alert marker → t=${latestPoint.time}, EWMA=${latestPoint.ewma}`);
        return [...prev, { label: latestPoint.time, type: 'early', ewma: latestPoint.ewma, timestamp: latestPoint.timestamp }];
      });
    }

    if (alerts.mid && !prevAlerts.mid && latestPoint) {
      setAlertMarkers(prev => {
        if (prev.some(m => m.type === 'mid' && (Number(latestPoint.time) - Number(m.label)) < 50)) return prev;
        console.log(`MID alert marker   → t=${latestPoint.time}, EWMA=${latestPoint.ewma}`);
        return [...prev, { label: latestPoint.time, type: 'mid', ewma: latestPoint.ewma, timestamp: latestPoint.timestamp }];
      });
    }

    if (alerts.late && !prevAlerts.late && latestPoint) {
      setAlertMarkers(prev => {
        if (prev.some(m => m.type === 'late' && (Number(latestPoint.time) - Number(m.label)) < 50)) return prev;
        console.log(`LATE alert marker  → t=${latestPoint.time}, EWMA=${latestPoint.ewma}`);
        return [...prev, { label: latestPoint.time, type: 'late', ewma: latestPoint.ewma, timestamp: latestPoint.timestamp }];
      });
    }

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


  // ── Generate Alert Marker Datasets (legend-only) matching analysis.py ────────
  // Visual markers are embedded in the EWMA dataset per-point for pixel-perfect
  // positioning. These datasets are invisible (pointRadius=0) but appear in
  // the legend so the user knows what each shape means.
  const getAlertMarkers = useCallback(() => {
    const datasets: any[] = [];

    // Exact analysis.py marker configuration with bold late alert
    const config: Record<string, { pointStyle: any; backgroundColor: string; borderColor: string; pointRadius: number; borderWidth: number }> = {
      early: { pointStyle: 'triangle', backgroundColor: 'green',  borderColor: '#00aa00', pointRadius: 7,  borderWidth: 2 },
      mid:   { pointStyle: 'rectRot',  backgroundColor: 'orange', borderColor: '#cc7700', pointRadius: 7,  borderWidth: 2 },
      late:  { pointStyle: 'crossRot', backgroundColor: '#ff1a1a',borderColor: '#ff1a1a', pointRadius: 10, borderWidth: 3 }, // red border so the × is visible
    };

    Object.entries(config).forEach(([alertType, cfg]) => {
      const hasMarker = alertMarkers.some(m => m.type === alertType);
      if (!hasMarker) return; // only add legend entry once marker actually fired

      datasets.push({
        type: 'scatter',
        label: `${alertType.charAt(0).toUpperCase() + alertType.slice(1)} Alert`,
        // Off-screen single point — invisible but creates the legend entry
        data: [{ x: -9999, y: -9999 }],
        backgroundColor: cfg.backgroundColor,
        borderColor: cfg.borderColor,
        borderWidth: cfg.borderWidth,
        pointRadius: cfg.pointRadius,        // visible in legend swatch
        pointHoverRadius: 0,   // no hover
        pointStyle: cfg.pointStyle,
        showLine: false,
        order: 0,
        clip: false,           // allow off-screen without clipping
      });
    });

    return datasets;
  }, [alertMarkers]);

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
            if (text.startsWith('ewma')) return visibleLines.ewma;
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
            const items = defaultFn(chart);
            return items.map(item => {
              if (item.text === 'EWMA') {
                item.pointStyle  = 'line';
                item.strokeStyle = '#4169e1'; // royalblue — matches EWMA borderColor
                item.lineWidth   = 2;
                item.fillStyle   = 'transparent';
              }
              return item;
            });
          },
        },
        onClick: (_e, legendItem, legend) => {
          const text = legendItem.text?.toLowerCase() || '';
          if (text === 'raw current') {
            setVisibleLines(prev => ({ ...prev, current: !prev.current }));
          } else if (text.startsWith('ewma')) {
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
          label: `EWMA`,
          data: ewmaData,
          borderColor: '#4169e1',  // royalblue
          backgroundColor: 'transparent',
          borderWidth: 2,  // analysis.py: lw=2
          tension: 0.3,
          // Per-point styles — alert trigger cycles get exact analysis.py markers
          // NOTE: late alert visual is handled by lateAlertCrossPlugin (custom canvas draw)
          pointRadius: ewmaData.map((_, i) => {
            const lbl = labels[i];
            const m = alertMarkers.find(am => am.label === lbl);
            if (!m) return 0;
            if (m.type === 'late') return 0;  // Hidden — drawn by lateAlertCrossPlugin
            return 12;  // Large size for early/mid alert markers
          }),
          pointStyle: ewmaData.map((_, i) => {
            const lbl = labels[i];
            const m = alertMarkers.find(am => am.label === lbl);
            if (!m) return 'circle';
            if (m.type === 'early') return 'triangle';  // marker="^"
            if (m.type === 'mid')   return 'rectRot';   // marker="D"
            if (m.type === 'late')  return 'circle';    // Hidden — plugin draws it
            return 'circle';
          }),
          pointBackgroundColor: ewmaData.map((_, i) => {
            const lbl = labels[i];
            const m = alertMarkers.find(am => am.label === lbl);
            if (!m) return 'transparent';
            if (m.type === 'early') return 'green';
            if (m.type === 'mid')   return 'orange';
            if (m.type === 'late')  return 'transparent'; // plugin handles drawing
            return 'transparent';
          }),
          pointBorderColor: ewmaData.map((_, i) => {
            const lbl = labels[i];
            const m = alertMarkers.find(am => am.label === lbl);
            if (!m) return 'transparent';
            if (m.type === 'early') return '#ffffff';
            if (m.type === 'mid')   return '#ffffff';
            if (m.type === 'late')  return 'transparent';
            return 'transparent';
          }),
          pointBorderWidth: ewmaData.map((_, i) => {
            const lbl = labels[i];
            const m = alertMarkers.find(am => am.label === lbl);
            if (!m) return 0;
            if (m.type === 'late') return 0;
            return 3;  // Thicker white border for larger early/mid markers
          }),
          pointHoverRadius: ewmaData.map((_, i) => {
            const lbl = labels[i];
            const m = alertMarkers.find(am => am.label === lbl);
            if (!m) return 5;
            if (m.type === 'late') return 0;
            return 14;  // Larger hover area for early/mid markers
          }),
          fill: false,
          hidden: !visibleLines.ewma,
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
        // Alert markers for legend
        ...getAlertMarkers(),
      ].filter(dataset => dataset),
    };
  }, [labels, currentData, ewmaData, cfg, visibleLines, alertMarkers, getAlertMarkers]);

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
    if (chartRef.current && displayHistory.length > 0) {
      // Force chart to update when new data arrives
      const updateChart = () => {
        if (chartRef.current) {
          try {
            const chart = chartRef.current;
            
            // ✨ DYNAMIC SCALING - Always update axis ranges from calculated values
            // Update X-axis range (from dynamicXRange)
            if (chart.options.scales?.x) {
              chart.options.scales.x.min = dynamicXRange.min;
              chart.options.scales.x.max = dynamicXRange.max;
            }
            
            // Update Y-axis range (from dynamicYRange)
            if (chart.options.scales?.y) {
              chart.options.scales.y.min = dynamicYRange.min;
              chart.options.scales.y.max = dynamicYRange.max;
            }
            
            chartRef.current.update('none'); // Update without animation for real-time feel
          } catch (error) {
            console.error('Chart update error:', error);
            // Silently handle chart update errors to prevent white page
          }
        }
      };
      
      // Immediate update
      updateChart();
      
      // Additional updates with delays for reliability
      setTimeout(updateChart, 10);
      setTimeout(updateChart, 50);
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
              plugins={[alertBgPlugin, lateAlertCrossPlugin]}
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
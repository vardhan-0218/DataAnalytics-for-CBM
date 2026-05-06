/**
 * RealTimeTelemetryGraph.tsx
 * White-themed, real-time line chart using chart.js / react-chartjs-2.
 * Displays three signals: raw Current, Noise, and EWMA (smoothed trend).
 *
 * Props:
 *   history — sliding window of the last N data points
 */

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
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TelemetryPoint {
  time: string;
  current: number;
  noise: number;
  ewma: number;
}

interface RealTimeTelemetryGraphProps {
  history: TelemetryPoint[];
}

// ── Chart config ──────────────────────────────────────────────────────────────

const OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 300 } as const,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: {
      position: 'top' as const,
      labels: {
        font: { size: 11, family: 'monospace' },
        color: '#555',
        usePointStyle: true,
        pointStyleWidth: 12,
        padding: 16,
      },
    },
    title: { display: false },
    tooltip: {
      backgroundColor: '#fff',
      borderColor: '#e0e0e0',
      borderWidth: 1,
      titleColor: '#333',
      bodyColor: '#666',
      titleFont: { family: 'monospace', size: 11 },
      bodyFont: { family: 'monospace', size: 11 },
    },
  },
  scales: {
    x: {
      grid: { color: 'rgba(0,0,0,0.05)' },
      ticks: {
        font: { size: 10, family: 'monospace' },
        color: '#999',
        maxTicksLimit: 8,
        maxRotation: 0,
      },
      border: { color: '#ddd' },
    },
    y: {
      grid: { color: 'rgba(0,0,0,0.05)' },
      ticks: {
        font: { size: 10, family: 'monospace' },
        color: '#999',
      },
      border: { color: '#ddd' },
    },
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

export function RealTimeTelemetryGraph({ history }: RealTimeTelemetryGraphProps) {
  const labels  = history.map(p => p?.time   ?? '');
  const current = history.map(p => p?.current ?? 0);
  const noise   = history.map(p => p?.noise   ?? 0);
  const ewma    = history.map(p => p?.ewma    ?? 0);

  const chartData = {
    labels,
    datasets: [
      {
        label: 'Current (A)',
        data: current,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.08)',
        borderWidth: 2,
        tension: 0.35,
        pointRadius: 0,
        fill: false,
      },
      {
        label: 'Noise',
        data: noise,
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245,158,11,0.08)',
        borderWidth: 1.5,
        borderDash: [4, 3],
        tension: 0.35,
        pointRadius: 0,
        fill: false,
      },
      {
        label: 'EWMA (α=0.3)',
        data: ewma,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16,185,129,0.10)',
        borderWidth: 2.5,
        tension: 0.5,
        pointRadius: 0,
        fill: false,
      },
    ],
  };

  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: '10px',
        padding: '20px 20px 12px',
        boxShadow: '0 2px 16px rgba(0,0,0,0.08)',
        border: '1px solid #e8e8e8',
      }}
    >
      {/* Header */}
      <div
        style={{
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontSize: '12px',
            fontWeight: 700,
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            color: '#333',
            fontFamily: 'monospace',
          }}
        >
          Live Motor Telemetry
        </span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '10px',
            color: '#10b981',
            fontFamily: 'monospace',
            fontWeight: 600,
          }}
        >
          <span
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              background: '#10b981',
              display: 'inline-block',
              boxShadow: '0 0 6px #10b981',
            }}
          />
          LIVE · 1s UPDATE
        </span>
      </div>

      {/* Chart */}
      <div style={{ height: '220px', position: 'relative' }}>
        {history.length === 0 ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#bbb',
              fontSize: '12px',
              fontFamily: 'monospace',
            }}
          >
            Waiting for data…
          </div>
        ) : (
          <Line data={chartData} options={OPTIONS} />
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: '10px',
          paddingTop: '8px',
          borderTop: '1px solid #f0f0f0',
          fontSize: '9px',
          color: '#bbb',
          fontFamily: 'monospace',
          letterSpacing: '0.5px',
        }}
      >
        EWMA: Exponentially Weighted Moving Average · α = 0.3 · Window = last 20 pts
      </div>
    </div>
  );
}

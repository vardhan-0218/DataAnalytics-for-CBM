// DEMO ONLY - Not part of production build. Safe to delete.
// This file replicates the Streamlit UI in React for demonstration purposes.
// It is completely isolated and can be removed without affecting the main application.

import { useState, useEffect } from 'react';
import { startSimulation, getStepData, interruptSimulation, setMotorCurrent, setKNoise } from '../../services/api';

export default function StreamlitDemo() {
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(2.0);
  const [motorCurrent, setMotorCurrentValue] = useState(5.0);
  const [kNoise, setKNoiseValue] = useState(0.05);
  const [wearRate, setWearRate] = useState(0.0);
  
  const [currentData, setCurrentData] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    startSimulation();
  }, []);

  useEffect(() => {
    if (!running) return;
    
    const interval = setInterval(async () => {
      const data = await getStepData();
      if (data) {
        setCurrentData(data);
        setHistory(prev => [...prev, data].slice(-50));
      }
    }, 1000 / speed);

    return () => clearInterval(interval);
  }, [running, speed]);

  const handleReset = () => {
    setRunning(false);
    startSimulation();
    setHistory([]);
    setEvents([]);
    setCurrentData(null);
    setWearRate(0.0);
  };

  const handleWearRateChange = (value: number) => {
    setWearRate(value);
    interruptSimulation(value);
    setEvents(prev => [...prev, { time: currentData?.t || 0, rate: value }]);
  };

  const handleMotorCurrentChange = (value: number) => {
    setMotorCurrentValue(value);
    setMotorCurrent(value);
  };

  const handleKNoiseChange = (value: number) => {
    setKNoiseValue(value);
    setKNoise(value);
  };

  return (
    <div style={{
      minHeight: '100vh',
      padding: '2rem',
      background: '#0d1117',
      color: '#e6edf3',
      fontFamily: "'IBM Plex Sans', sans-serif"
    }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        
        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{
            fontSize: '2rem',
            fontWeight: 'bold',
            fontFamily: "'IBM Plex Mono', monospace",
            marginBottom: '0.5rem'
          }}>
            ⚙️ Motor Wear Simulator (Demo)
          </h1>
          <p style={{ color: '#8b949e', fontSize: '0.875rem' }}>
            Real-time degradation model — Streamlit-style UI in React
          </p>
          <div style={{
            display: 'inline-block',
            marginTop: '1rem',
            padding: '0.5rem 1rem',
            borderRadius: '20px',
            background: running ? '#0f2a0f' : '#2a0f0f',
            border: running ? '1px solid #3fb950' : '1px solid #f85149',
            color: running ? '#3fb950' : '#f85149',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: '0.75rem'
          }}>
            {running ? '● RUNNING' : '■ STOPPED'}
          </div>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid #21262d', margin: '2rem 0' }} />

        {/* Controls */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '250px 1fr',
          gap: '2rem'
        }}>
          
          {/* Sidebar */}
          <div style={{
            background: '#161b22',
            border: '1px solid #21262d',
            borderRadius: '8px',
            padding: '1.5rem'
          }}>
            <h3 style={{
              fontSize: '1rem',
              fontWeight: 'bold',
              marginBottom: '1rem',
              fontFamily: "'IBM Plex Mono', monospace"
            }}>
              Controls
            </h3>

            {/* Start/Pause & Reset */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
              <button
                onClick={() => setRunning(!running)}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  borderRadius: '6px',
                  border: 'none',
                  background: running ? '#3a3f45' : '#238636',
                  color: '#fff',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: '0.75rem'
                }}
              >
                {running ? '⏸ Pause' : '▶ Start'}
              </button>
              <button
                onClick={handleReset}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  borderRadius: '6px',
                  border: 'none',
                  background: '#3a3f45',
                  color: '#fff',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: '0.75rem'
                }}
              >
                ↺ Reset
              </button>
            </div>

            {/* Speed */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{
                display: 'block',
                fontSize: '0.75rem',
                color: '#8b949e',
                marginBottom: '0.5rem',
                fontFamily: "'IBM Plex Mono', monospace"
              }}>
                Simulation speed (cycles/sec): {speed.toFixed(1)}
              </label>
              <input
                type="range"
                min="0.5"
                max="10"
                step="0.5"
                value={speed}
                onChange={(e) => setSpeed(parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            {/* Motor Current */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{
                display: 'block',
                fontSize: '0.75rem',
                color: '#8b949e',
                marginBottom: '0.5rem',
                fontFamily: "'IBM Plex Mono', monospace"
              }}>
                Motor current baseline (A): {motorCurrent.toFixed(1)}
              </label>
              <input
                type="range"
                min="0"
                max="20"
                step="0.1"
                value={motorCurrent}
                onChange={(e) => handleMotorCurrentChange(parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            {/* k_noise */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{
                display: 'block',
                fontSize: '0.75rem',
                color: '#8b949e',
                marginBottom: '0.5rem',
                fontFamily: "'IBM Plex Mono', monospace"
              }}>
                k_noise (sigma sensitivity): {kNoise.toFixed(2)}
              </label>
              <input
                type="range"
                min="0.05"
                max="0.25"
                step="0.05"
                value={kNoise}
                onChange={(e) => handleKNoiseChange(parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid #21262d', margin: '1.5rem 0' }} />

            {/* Wear Rate */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{
                fontSize: '0.875rem',
                fontWeight: 'bold',
                marginBottom: '0.5rem',
                fontFamily: "'IBM Plex Mono', monospace",
                color: '#f0883e'
              }}>
                Wear Rate Slider
              </h4>
              <p style={{
                fontSize: '0.75rem',
                color: '#8b949e',
                marginBottom: '1rem'
              }}>
                Move this slider to simulate a real-time interrupt. Current time and I_Motor are captured automatically.
              </p>
              <label style={{
                display: 'block',
                fontSize: '0.75rem',
                color: '#8b949e',
                marginBottom: '0.5rem',
                fontFamily: "'IBM Plex Mono', monospace"
              }}>
                Wear Rate (A / cycle): {wearRate.toFixed(3)}
              </label>
              <input
                type="range"
                min="0"
                max="0.04"
                step="0.001"
                value={wearRate}
                onChange={(e) => handleWearRateChange(parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
              <p style={{
                fontSize: '0.875rem',
                color: '#f0883e',
                marginTop: '0.5rem',
                fontFamily: "'IBM Plex Mono', monospace"
              }}>
                Current: {wearRate.toFixed(3)} A/cycle
              </p>
            </div>

            {/* Events */}
            <hr style={{ border: 'none', borderTop: '1px solid #21262d', margin: '1.5rem 0' }} />
            <h4 style={{
              fontSize: '0.875rem',
              fontWeight: 'bold',
              marginBottom: '0.5rem',
              fontFamily: "'IBM Plex Mono', monospace"
            }}>
              Interrupt Events
            </h4>
            <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
              {events.length === 0 ? (
                <p style={{ fontSize: '0.75rem', color: '#8b949e' }}>No interrupts yet.</p>
              ) : (
                events.slice(-8).reverse().map((e, i) => (
                  <div key={i} style={{
                    display: 'inline-block',
                    margin: '0.25rem',
                    padding: '0.25rem 0.5rem',
                    background: '#161b22',
                    border: '1px solid #f0883e',
                    borderRadius: '4px',
                    fontSize: '0.625rem',
                    color: '#f0883e',
                    fontFamily: "'IBM Plex Mono', monospace"
                  }}>
                    t={e.time} rate={e.rate.toFixed(3)}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Main Content */}
          <div>
            {/* Live Metrics */}
            {currentData && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '1rem',
                marginBottom: '2rem'
              }}>
                {[
                  { label: '⏱ Current Time(t)', value: currentData.t, color: '#3fb950' },
                  { label: '⚡ Motor Current', value: `${currentData.current.toFixed(3)} A`, color: '#f0883e' },
                  { label: '🔋 I_base', value: `${currentData.I_base.toFixed(3)} A`, color: '#3fb950' },
                  { label: '🔧 Wear Rate', value: wearRate.toFixed(4), color: '#58a6ff' },
                  { label: '📉 Degradation', value: `${currentData.degradation.toFixed(4)} A`, color: '#f0883e' },
                  { label: '🕐 Cycle Time', value: `${currentData.cycle_time.toFixed(3)} s`, color: '#58a6ff' },
                ].map((metric, i) => (
                  <div key={i} style={{
                    background: '#0d1117',
                    border: '1px solid #21262d',
                    borderLeft: `4px solid ${metric.color}`,
                    borderRadius: '8px',
                    padding: '1rem',
                    textAlign: 'center'
                  }}>
                    <div style={{
                      fontSize: '0.625rem',
                      color: '#8b949e',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      marginBottom: '0.5rem',
                      fontFamily: "'IBM Plex Mono', monospace"
                    }}>
                      {metric.label}
                    </div>
                    <div style={{
                      fontSize: '1.5rem',
                      fontWeight: 'bold',
                      color: metric.color,
                      fontFamily: "'IBM Plex Mono', monospace"
                    }}>
                      {metric.value}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* History Table */}
            {history.length > 0 && (
              <div style={{
                background: '#161b22',
                border: '1px solid #21262d',
                borderRadius: '8px',
                padding: '1.5rem'
              }}>
                <h3 style={{
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  marginBottom: '1rem',
                  fontFamily: "'IBM Plex Mono', monospace"
                }}>
                  Live Data (last 10 rows)
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{
                    width: '100%',
                    fontSize: '0.75rem',
                    fontFamily: "'IBM Plex Mono', monospace",
                    borderCollapse: 'collapse'
                  }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #21262d' }}>
                        <th style={{ padding: '0.5rem', textAlign: 'left', color: '#8b949e' }}>t</th>
                        <th style={{ padding: '0.5rem', textAlign: 'left', color: '#8b949e' }}>Motor Current</th>
                        <th style={{ padding: '0.5rem', textAlign: 'left', color: '#8b949e' }}>I_base</th>
                        <th style={{ padding: '0.5rem', textAlign: 'left', color: '#8b949e' }}>Degradation</th>
                        <th style={{ padding: '0.5rem', textAlign: 'left', color: '#8b949e' }}>Noise</th>
                        <th style={{ padding: '0.5rem', textAlign: 'left', color: '#8b949e' }}>Cycle Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.slice(-10).map((row, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #21262d' }}>
                          <td style={{ padding: '0.5rem' }}>{row.t}</td>
                          <td style={{ padding: '0.5rem', color: '#f0883e' }}>{row.current.toFixed(3)}</td>
                          <td style={{ padding: '0.5rem', color: '#3fb950' }}>{row.I_base.toFixed(3)}</td>
                          <td style={{ padding: '0.5rem', color: '#58a6ff' }}>{row.degradation.toFixed(4)}</td>
                          <td style={{ padding: '0.5rem' }}>{row.noise.toFixed(4)}</td>
                          <td style={{ padding: '0.5rem' }}>{row.cycle_time.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!currentData && (
              <div style={{
                background: '#161b22',
                border: '1px solid #21262d',
                borderRadius: '8px',
                padding: '3rem',
                textAlign: 'center',
                color: '#8b949e'
              }}>
                <p style={{ fontSize: '1rem' }}>▶ Press Start to begin the simulation.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

interface TelemetryGraphProps {
  data: Array<{
    time: string;
    signal1: number;
    signal2: number;
    signal3: number;
  }>;
}

export function TelemetryGraph({ data }: TelemetryGraphProps) {
  return (
    <div 
      className="p-5 rounded-lg relative"
      style={{
        background: `
          linear-gradient(135deg, 
            #3a3f45 0%, 
            #2b2f33 25%,
            #3a3f45 50%,
            #2b2f33 75%,
            #3a3f45 100%
          )
        `,
        backgroundSize: '200% 200%',
        boxShadow: `
          inset 0 3px 8px rgba(0,0,0,0.6),
          inset 0 -2px 4px rgba(255,255,255,0.03),
          0 6px 12px rgba(0,0,0,0.7)
        `,
        border: '2px solid #1a1d20'
      }}
    >
      {/* Corner screws */}
      {[
        { top: '8px', left: '8px' },
        { top: '8px', right: '8px' },
        { bottom: '8px', left: '8px' },
        { bottom: '8px', right: '8px' }
      ].map((pos, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width: '12px',
            height: '12px',
            background: 'radial-gradient(circle at 30% 30%, #555, #2a2f35)',
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.8), 0 1px 2px rgba(255,255,255,0.1)',
            border: '1px solid #1a1d20',
            zIndex: 10,
            ...pos
          }}
        >
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              fontSize: '10px',
              color: '#1a1d20',
              transform: 'rotate(45deg)'
            }}
          >
            +
          </div>
        </div>
      ))}
      
      <div 
        className="mb-4 pb-2 text-sm font-bold tracking-wider flex items-center justify-between"
        style={{
          color: '#c0c5ca',
          borderBottom: '2px solid #1a1d20',
          textTransform: 'uppercase',
          letterSpacing: '2px',
          textShadow: '0 1px 2px rgba(0,0,0,0.5)'
        }}
      >
        <span>REAL-TIME DATA</span>
        <span className="text-xs" style={{ color: '#7a7f85', letterSpacing: '1px' }}>
          Vibration Signal
        </span>
      </div>
      
      <div 
        className="p-4 rounded relative"
        style={{
          backgroundColor: '#14161a',
          border: '2px solid #0a0c0e',
          boxShadow: 'inset 0 3px 8px rgba(0,0,0,0.8)'
        }}
      >
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#252a30" strokeOpacity={0.5} />
            
            {/* Threshold zones with labels */}
            <ReferenceLine key="ref-65" y={65} stroke="#f1c40f" strokeOpacity={0.15} strokeWidth={25} />
            <ReferenceLine key="ref-75" y={75} stroke="#f39c12" strokeOpacity={0.15} strokeWidth={25} />
            <ReferenceLine key="ref-85" y={85} stroke="#e74c3c" strokeOpacity={0.15} strokeWidth={25} />
            
            <XAxis 
              dataKey="time" 
              stroke="#6a6f75"
              style={{ fontSize: '10px', fontFamily: 'monospace' }}
              tick={{ fill: '#7a7f85' }}
            />
            <YAxis 
              stroke="#6a6f75"
              style={{ fontSize: '10px', fontFamily: 'monospace' }}
              tick={{ fill: '#7a7f85' }}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#1a1d22', 
                border: '2px solid #2a2f35',
                borderRadius: '6px',
                color: '#e6e6e6',
                boxShadow: '0 4px 12px rgba(0,0,0,0.8)'
              }}
              labelStyle={{ color: '#9aa0a6', fontFamily: 'monospace' }}
            />
            
            <Line 
              key="line-signal1"
              type="monotone" 
              dataKey="signal1" 
              stroke="#f1c40f" 
              strokeWidth={2.5}
              dot={false}
              name="Early"
            />
            <Line 
              key="line-signal2"
              type="monotone" 
              dataKey="signal2" 
              stroke="#f39c12" 
              strokeWidth={2.5}
              dot={false}
              name="Mid"
            />
            <Line 
              key="line-signal3"
              type="monotone" 
              dataKey="signal3" 
              stroke="#e74c3c" 
              strokeWidth={2.5}
              dot={false}
              name="Late"
            />
          </LineChart>
        </ResponsiveContainer>
        
        {/* Zone labels */}
        <div className="absolute left-4 top-6 space-y-1" style={{ pointerEvents: 'none' }}>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: '#f1c40f' }} />
            <span className="text-xs font-bold" style={{ color: '#f1c40f', textShadow: '0 0 4px rgba(241,196,15,0.5)' }}>
              EARLY
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: '#f39c12' }} />
            <span className="text-xs font-bold" style={{ color: '#f39c12', textShadow: '0 0 4px rgba(243,156,18,0.5)' }}>
              MID
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: '#e74c3c' }} />
            <span className="text-xs font-bold" style={{ color: '#e74c3c', textShadow: '0 0 4px rgba(231,76,60,0.5)' }}>
              LATE
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
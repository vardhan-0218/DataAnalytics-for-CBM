interface IndustrialToggleProps {
  label: string;
  sublabel?: string;
  value: 'low' | 'medium' | 'high';
  onChange: (value: 'low' | 'medium' | 'high') => void;
}

export function IndustrialToggle({ label, sublabel, value, onChange }: IndustrialToggleProps) {
  const positions: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];
  const labels = ['LOW', 'MED', 'HIGH'];

  return (
    <div className="flex flex-col items-center">
      {/* Label */}
      <div 
        className="mb-3 px-3 py-1 text-xs font-bold tracking-wider text-center rounded"
        style={{
          background: 'linear-gradient(180deg, #2a2f35 0%, #1f2327 100%)',
          color: '#b0b5ba',
          border: '1px solid #1a1d20',
          boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.5)',
          textTransform: 'uppercase',
          letterSpacing: '1px'
        }}
      >
        {label}
      </div>

      {/* Toggle switch panel */}
      <div 
        className="p-4 rounded-lg relative"
        style={{
          background: 'linear-gradient(135deg, #3a3f45 0%, #2b2f33 100%)',
          boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.6), 0 4px 8px rgba(0,0,0,0.6)',
          border: '2px solid #1a1d20'
        }}
      >
        {/* Position labels */}
        <div className="flex justify-between mb-2 px-1">
          {labels.map((l, i) => (
            <div
              key={i}
              className="text-[9px] font-bold"
              style={{
                color: value === positions[i] ? '#f39c12' : '#5a5f65',
                letterSpacing: '0.5px',
                transition: 'color 0.3s'
              }}
            >
              {l}
            </div>
          ))}
        </div>

        {/* Toggle track */}
        <div 
          className="relative rounded-full"
          style={{
            width: '100px',
            height: '30px',
            background: 'linear-gradient(180deg, #1a1d20 0%, #2a2f35 100%)',
            boxShadow: 'inset 0 3px 6px rgba(0,0,0,0.8)',
            border: '2px solid #0a0c0e'
          }}
        >
          {/* Position markers */}
          {positions.map((_, i) => (
            <div
              key={i}
              className="absolute top-1/2 -translate-y-1/2"
              style={{
                left: `${i * 33 + 16.5}%`,
                width: '4px',
                height: '16px',
                backgroundColor: '#3a3f45',
                borderRadius: '1px'
              }}
            />
          ))}

          {/* Toggle handle */}
          <div
            className="absolute top-1/2 -translate-y-1/2 cursor-pointer transition-all duration-300"
            onClick={() => {
              const currentIndex = positions.indexOf(value);
              const nextIndex = (currentIndex + 1) % positions.length;
              onChange(positions[nextIndex]);
            }}
            style={{
              left: `${positions.indexOf(value) * 33 + 6}%`,
              width: '32px',
              height: '24px',
              background: 'radial-gradient(circle at 35% 35%, #f39c12, #d68910)',
              borderRadius: '4px',
              boxShadow: `
                0 0 12px rgba(243,156,18,0.6),
                inset 0 2px 4px rgba(255,255,255,0.3),
                0 3px 6px rgba(0,0,0,0.8)
              `,
              border: '2px solid #d68910'
            }}
          >
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                fontSize: '8px',
                color: '#1f2327',
                fontWeight: 'bold'
              }}
            >
              ▼
            </div>
          </div>
        </div>
      </div>

      {/* Sublabel */}
      {sublabel && (
        <div 
          className="mt-2 px-2 py-1 text-[10px] text-center"
          style={{
            color: '#7a7f85',
            maxWidth: '110px',
            lineHeight: '1.3'
          }}
        >
          {sublabel}
        </div>
      )}
    </div>
  );
}

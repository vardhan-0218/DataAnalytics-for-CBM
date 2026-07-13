import { useState, useRef, useEffect } from 'react';

interface PercentageKnobProps {
  label: string;
  sublabel?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

export function PercentageKnob({ label, sublabel, value, min, max, onChange }: PercentageKnobProps) {
  const [isDragging, setIsDragging] = useState(false);
  const knobRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const startValue = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    startY.current = e.clientY;
    startValue.current = value;
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const deltaY = startY.current - e.clientY;
      const range = max - min;
      const newValue = Math.max(min, Math.min(max, startValue.current + (deltaY / 100) * range));
      onChange(Math.round(newValue));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, min, max, onChange, value]);

  const rotation = ((value - min) / (max - min)) * 270 - 135;
  const percentage = Math.round(((value - min) / (max - min)) * 100);

  return (
    <div className="flex flex-col items-center">
      {/* Label */}
      <div 
        className="mb-2 px-3 py-1 text-xs font-bold tracking-wider text-center rounded"
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

      {/* Percentage arc background */}
      <div className="relative" style={{ width: '90px', height: '90px' }}>
        {/* Percentage arc */}
        <svg width="90" height="90" className="absolute inset-0" style={{ transform: 'rotate(-135deg)' }}>
          <circle
            cx="45"
            cy="45"
            r="38"
            fill="none"
            stroke="#2a2f35"
            strokeWidth="6"
            strokeDasharray="240"
            strokeLinecap="round"
          />
          <circle
            cx="45"
            cy="45"
            r="38"
            fill="none"
            stroke={percentage > 66 ? '#e74c3c' : percentage > 33 ? '#f1c40f' : '#2ecc71'}
            strokeWidth="6"
            strokeDasharray={`${240 * (percentage / 100)} 240`}
            strokeLinecap="round"
            style={{
              transition: 'stroke-dasharray 0.3s, stroke 0.3s'
            }}
          />
        </svg>

        {/* Knob */}
        <div
          ref={knobRef}
          className="absolute cursor-pointer select-none"
          onMouseDown={handleMouseDown}
          style={{
            width: '60px',
            height: '60px',
            top: '15px',
            left: '15px',
            background: 'radial-gradient(circle at 35% 35%, #4a4f55, #2d3238)',
            borderRadius: '50%',
            boxShadow: `
              0 6px 12px rgba(0,0,0,0.8),
              inset 0 2px 4px rgba(255,255,255,0.1),
              inset 0 -2px 4px rgba(0,0,0,0.3)
            `,
            border: '3px solid #1a1d20'
          }}
        >
          {/* Knob grooves */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `
                repeating-conic-gradient(
                  from 0deg,
                  #2a2f35 0deg 2deg,
                  #3a3f45 2deg 4deg
                )
              `,
              padding: '3px',
              opacity: 0.6
            }}
          >
            <div
              className="w-full h-full rounded-full flex items-center justify-center"
              style={{
                background: 'radial-gradient(circle at 35% 35%, #555b61, #3a3f45)',
                boxShadow: 'inset 0 4px 10px rgba(0,0,0,0.7)'
              }}
            >
              {/* Percentage display */}
              <div
                className="text-sm font-bold"
                style={{
                  color: '#00ff88',
                  textShadow: '0 0 6px rgba(0,255,136,0.8)'
                }}
              >
                {value}%
              </div>

              {/* Indicator notch */}
              <div
                className="absolute"
                style={{
                  width: '3px',
                  height: '16px',
                  background: 'linear-gradient(180deg, #ffffff 0%, #e0e0e0 100%)',
                  top: '6px',
                  left: '50%',
                  transform: `translateX(-50%) rotate(${rotation}deg)`,
                  transformOrigin: 'center 24px',
                  borderRadius: '2px',
                  boxShadow: '0 0 6px rgba(255,255,255,0.9)'
                }}
              />
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

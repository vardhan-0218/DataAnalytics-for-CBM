import { useState, useRef, useEffect } from 'react';

interface PrecisionRotaryKnobProps {
  label: string;
  sublabel?: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
  step?: number;
}

export function PrecisionRotaryKnob({ label, sublabel, value, min, max, unit, onChange, step = 0.001 }: PrecisionRotaryKnobProps) {
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
      const newValue = Math.max(min, Math.min(max, startValue.current + (deltaY / 200) * range));
      onChange(newValue);
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

      {/* Knob with scale markings */}
      <div className="relative">
        {/* Scale background */}
        <div className="relative" style={{ width: '100px', height: '100px' }}>
          {/* Scale markings */}
          {Array.from({ length: 28 }, (_, i) => {
            const angle = -135 + (i * 270 / 27);
            const isMain = i % 9 === 0;
            const length = isMain ? 12 : 6;
            return (
              <div
                key={i}
                className="absolute"
                style={{
                  width: isMain ? '2px' : '1px',
                  height: `${length}px`,
                  backgroundColor: '#9aa0a6',
                  top: '5px',
                  left: '50%',
                  transform: `translateX(-50%) rotate(${angle}deg)`,
                  transformOrigin: 'center 45px',
                  opacity: isMain ? 1 : 0.5
                }}
              />
            );
          })}
          
          {/* Knob */}
          <div
            ref={knobRef}
            className="absolute cursor-pointer select-none"
            onMouseDown={handleMouseDown}
            style={{
              width: '70px',
              height: '70px',
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
                padding: '4px',
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
                {/* Indicator line */}
                <div
                  className="absolute"
                  style={{
                    width: '3px',
                    height: '20px',
                    background: 'linear-gradient(180deg, #ff0000 0%, #cc0000 100%)',
                    top: '8px',
                    left: '50%',
                    transform: `translateX(-50%) rotate(${rotation}deg)`,
                    transformOrigin: 'center 27px',
                    borderRadius: '2px',
                    boxShadow: '0 0 6px rgba(255,0,0,0.8)'
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Digital readout */}
      <div 
        className="mt-2 px-4 py-1 rounded text-center"
        style={{
          backgroundColor: '#0a0c0e',
          boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.9)',
          border: '2px solid #1a1d20',
          minWidth: '90px'
        }}
      >
        <div 
          className="font-mono text-sm tracking-wider font-bold"
          style={{ 
            color: '#00ff88', 
            textShadow: '0 0 8px rgba(0,255,136,0.8)'
          }}
        >
          {value.toFixed(3)} {unit}
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

import { useState, useRef, useEffect } from 'react';

interface RotaryKnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}

export function RotaryKnob({ label, value, min, max, unit, onChange }: RotaryKnobProps) {
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
        className="mb-3 px-4 py-2 text-xs font-bold tracking-wider text-center rounded relative"
        style={{
          background: 'linear-gradient(180deg, #2a2f35 0%, #1f2327 100%)',
          color: '#b0b5ba',
          border: '1px solid #1a1d20',
          boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.5)',
          textTransform: 'uppercase',
          letterSpacing: '1.5px'
        }}
      >
        {label}
      </div>

      {/* Knob */}
      <div
        ref={knobRef}
        className="relative cursor-pointer select-none"
        onMouseDown={handleMouseDown}
        style={{
          width: '90px',
          height: '90px',
          background: 'radial-gradient(circle at 35% 35%, #4a4f55, #2d3238)',
          borderRadius: '50%',
          boxShadow: `
            0 8px 16px rgba(0,0,0,0.8),
            inset 0 2px 4px rgba(255,255,255,0.1),
            inset 0 -2px 4px rgba(0,0,0,0.3)
          `,
          border: '3px solid #1a1d20'
        }}
      >
        {/* Outer ring grooves */}
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
            padding: '5px',
            opacity: 0.6
          }}
        >
          {/* Inner circle */}
          <div
            className="w-full h-full rounded-full flex items-center justify-center"
            style={{
              background: 'radial-gradient(circle at 35% 35%, #555b61, #3a3f45)',
              boxShadow: 'inset 0 4px 10px rgba(0,0,0,0.7)'
            }}
          >
            {/* Indicator notch */}
            <div
              className="absolute"
              style={{
                width: '5px',
                height: '28px',
                background: 'linear-gradient(180deg, #ffffff 0%, #e0e0e0 100%)',
                top: '10px',
                left: '50%',
                transform: `translateX(-50%) rotate(${rotation}deg)`,
                transformOrigin: 'center 35px',
                borderRadius: '2px',
                boxShadow: '0 0 8px rgba(255,255,255,0.9), 0 2px 4px rgba(0,0,0,0.5)'
              }}
            />
            
            {/* Center dot */}
            <div
              className="absolute"
              style={{
                width: '8px',
                height: '8px',
                background: 'radial-gradient(circle at 30% 30%, #666, #333)',
                borderRadius: '50%',
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.8)'
              }}
            />
          </div>
        </div>

        {/* Tick marks around knob */}
        {[-135, -90, -45, 0, 45, 90, 135].map((angle, i) => (
          <div
            key={i}
            className="absolute"
            style={{
              width: i === 3 ? '3px' : '2px',
              height: i === 3 ? '8px' : '6px',
              backgroundColor: '#9aa0a6',
              top: '3px',
              left: '50%',
              transform: `translateX(-50%) rotate(${angle}deg)`,
              transformOrigin: 'center 45px',
              borderRadius: '1px'
            }}
          />
        ))}
      </div>

      {/* Digital readout */}
      <div 
        className="mt-4 px-5 py-2 rounded text-center"
        style={{
          backgroundColor: '#0a0c0e',
          boxShadow: 'inset 0 3px 6px rgba(0,0,0,0.9), inset 0 -1px 0 rgba(255,255,255,0.05)',
          border: '2px solid #1a1d20',
          minWidth: '110px'
        }}
      >
        <div 
          className="font-mono text-lg tracking-wider font-bold"
          style={{ 
            color: '#00ff88', 
            textShadow: '0 0 10px rgba(0,255,136,0.8), 0 0 20px rgba(0,255,136,0.4)'
          }}
        >
          {value.toFixed(label === 'Axis Error' ? 2 : 0)} {unit}
        </div>
      </div>
    </div>
  );
}
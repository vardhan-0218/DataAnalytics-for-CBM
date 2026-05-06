import { useState, useRef, useEffect } from 'react';

interface RotaryControlProps {
  label: string;
  sublabel?: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
  step?: number;
}

export function RotaryControl({ label, sublabel, value, min, max, unit, onChange, step = 0.001 }: RotaryControlProps) {
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

      {/* Industrial Rotary Dial */}
      <div className="relative">
        <div className="relative" style={{ width: '120px', height: '120px' }}>
          {/* Outer bezel */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: 'radial-gradient(circle at 30% 30%, #666, #2a2f35)',
              boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.8), 0 2px 3px rgba(0,0,0,0.5)',
              border: '2px solid #1a1d20'
            }}
          />

          {/* Tick marks around the dial */}
          {Array.from({ length: 36 }, (_, i) => {
            const angle = i * 10; // Every 10 degrees
            const isMain = i % 9 === 0; // Main ticks every 90 degrees
            const length = isMain ? 15 : 8;
            const width = isMain ? 2 : 1;
            return (
              <div
                key={i}
                className="absolute"
                style={{
                  width: `${width}px`,
                  height: `${length}px`,
                  backgroundColor: isMain ? '#c0c5ca' : '#7a7f85',
                  top: '8px',
                  left: '50%',
                  transform: `translateX(-50%) rotate(${angle}deg)`,
                  transformOrigin: 'center 52px',
                  opacity: isMain ? 1 : 0.7
                }}
              />
            );
          })}

          {/* Inner dial face */}
          <div
            className="absolute rounded-full"
            style={{
              width: '80px',
              height: '80px',
              top: '20px',
              left: '20px',
              background: 'radial-gradient(circle at 35% 35%, #1a1d20, #0a0c0e)',
              boxShadow: 'inset 0 4px 8px rgba(0,0,0,0.8), inset 0 -2px 4px rgba(255,255,255,0.05)',
              border: '1px solid #4a4f55'
            }}
          />

          {/* Center indicator hub */}
          <div
            className="absolute rounded-full flex items-center justify-center"
            style={{
              width: '20px',
              height: '20px',
              top: '50px',
              left: '50px',
              background: 'radial-gradient(circle at 30% 30%, #666, #2a2f35)',
              boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.8), 0 1px 2px rgba(255,255,255,0.1)',
              border: '1px solid #1a1d20',
              transform: 'translate(-50%, -50%)'
            }}
          >
            {/* Pointer indicator */}
            <div
              className="absolute"
              style={{
                width: '2px',
                height: '25px',
                background: 'linear-gradient(180deg, #ff4444 0%, #cc0000 100%)',
                top: '-22px',
                left: '50%',
                transform: `translateX(-50%) rotate(${rotation}deg)`,
                transformOrigin: 'center 22px',
                borderRadius: '1px',
                boxShadow: '0 0 6px rgba(255,68,68,0.8)'
              }}
            />
          </div>

          {/* Knob interaction area */}
          <div
            ref={knobRef}
            className="absolute inset-0 cursor-pointer select-none rounded-full"
            onMouseDown={handleMouseDown}
            style={{
              background: 'transparent'
            }}
          />
        </div>
      </div>

      {/* Digital readout */}
      <div
        className="mt-3 px-4 py-2 rounded text-center"
        style={{
          backgroundColor: '#0a0c0e',
          boxShadow: 'inset 0 3px 6px rgba(0,0,0,0.9), inset 0 -1px 0 rgba(255,255,255,0.05)',
          border: '2px solid #1a1d20'
        }}
      >
        <div
          className="font-mono text-lg tracking-wider font-bold"
          style={{
            color: '#00ff88',
            textShadow: '0 0 10px rgba(0,255,136,0.8), 0 0 20px rgba(0,255,136,0.4)',
            filter: 'brightness(1.2)'
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
            maxWidth: '120px',
            lineHeight: '1.3'
          }}
        >
          {sublabel}
        </div>
      )}
    </div>
  );
}
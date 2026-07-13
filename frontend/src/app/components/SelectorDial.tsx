interface SelectorDialProps {
  label: string;
  sublabel?: string;
  options: Array<{ label: string; value: string }>;
  value: string;
  onChange: (value: string) => void;
}

export function SelectorDial({ label, sublabel, options, value, onChange }: SelectorDialProps) {
  const currentIndex = options.findIndex(opt => opt.value === value);
  const rotation = (currentIndex / (options.length - 1)) * 180 - 90;

  const handleClick = () => {
    const nextIndex = (currentIndex + 1) % options.length;
    onChange(options[nextIndex].value);
  };

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

      {/* Dial container */}
      <div className="relative" style={{ width: '100px', height: '70px' }}>
        {/* Option labels in arc */}
        {options.map((opt, i) => {
          const angle = (i / (options.length - 1)) * 180 - 90;
          const radius = 45;
          const x = 50 + radius * Math.cos((angle * Math.PI) / 180);
          const y = 60 + radius * Math.sin((angle * Math.PI) / 180);
          
          return (
            <div
              key={i}
              className="absolute text-[9px] font-bold whitespace-nowrap"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                transform: 'translate(-50%, -50%)',
                color: currentIndex === i ? '#f39c12' : '#6a6f75',
                transition: 'color 0.3s',
                letterSpacing: '0.5px'
              }}
            >
              {opt.label.toUpperCase()}
            </div>
          );
        })}

        {/* Center dial knob */}
        <div
          onClick={handleClick}
          className="absolute cursor-pointer select-none"
          style={{
            width: '50px',
            height: '50px',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
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
          {/* Dial grooves */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `
                repeating-conic-gradient(
                  from 0deg,
                  #2a2f35 0deg 3deg,
                  #3a3f45 3deg 6deg
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
                boxShadow: 'inset 0 3px 8px rgba(0,0,0,0.7)'
              }}
            >
              {/* Indicator pointer */}
              <div
                className="absolute"
                style={{
                  width: '3px',
                  height: '18px',
                  background: 'linear-gradient(180deg, #ffffff 0%, #e0e0e0 100%)',
                  top: '6px',
                  left: '50%',
                  transform: `translateX(-50%) rotate(${rotation}deg)`,
                  transformOrigin: 'center 19px',
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

interface StatusIndicatorProps {
  label: string;
  color: string;
  active: boolean;
}

export function StatusIndicator({ label, color, active }: StatusIndicatorProps) {
  return (
    <div className="flex items-center gap-3 py-2">
      {/* LED */}
      <div className="relative">
        <div
          className="rounded-full"
          style={{
            width: '16px',
            height: '16px',
            backgroundColor: active ? color : '#1f2327',
            boxShadow: active 
              ? `0 0 12px ${color}, 0 0 24px ${color}, inset 0 1px 2px rgba(255,255,255,0.3)` 
              : 'inset 0 2px 4px rgba(0,0,0,0.5)',
            border: `2px solid ${active ? color : '#2a2f35'}`,
            transition: 'all 0.3s ease'
          }}
        />
        {active && (
          <div
            className="absolute inset-0 rounded-full animate-pulse"
            style={{
              backgroundColor: color,
              opacity: 0.4,
              filter: 'blur(4px)'
            }}
          />
        )}
      </div>

      {/* Label */}
      <div 
        className="text-sm font-bold tracking-wide"
        style={{
          color: active ? '#e6e6e6' : '#5a5f65',
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}
      >
        {label}
      </div>
    </div>
  );
}

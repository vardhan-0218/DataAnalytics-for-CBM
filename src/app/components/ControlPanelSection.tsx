import { ReactNode } from 'react';

interface ControlPanelSectionProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export function ControlPanelSection({ title, children, className = '' }: ControlPanelSectionProps) {
  return (
    <div
      className={`p-6 rounded-lg relative ${className}`}
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
        border: '2px solid #1a1d20',
        overflow: 'visible',
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

      {title && (
        <div
          className="mb-4 pb-2 text-sm font-bold tracking-wider text-center"
          style={{
            color: '#c0c5ca',
            borderBottom: '2px solid #1a1d20',
            textTransform: 'uppercase',
            letterSpacing: '2px',
            textShadow: '0 1px 2px rgba(0,0,0,0.5)'
          }}
        >
          {title}
        </div>
      )}

      {children}
    </div>
  );
}
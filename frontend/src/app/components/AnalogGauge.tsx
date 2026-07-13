import { useEffect, useRef } from 'react';

interface AnalogGaugeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  greenZone?: [number, number];
  yellowZone?: [number, number];
  redZone?: [number, number];
}

export function AnalogGauge({ 
  label, 
  value, 
  min, 
  max, 
  unit, 
  greenZone, 
  yellowZone, 
  redZone 
}: AnalogGaugeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height - 30;
    const radius = Math.min(width, height) / 2 - 20;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw outer metallic bezel
    const outerGradient = ctx.createLinearGradient(0, 0, width, height);
    outerGradient.addColorStop(0, '#5a5f65');
    outerGradient.addColorStop(0.5, '#3a3f45');
    outerGradient.addColorStop(1, '#2a2f35');
    ctx.fillStyle = outerGradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + 8, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = '#1a1d20';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Draw gauge background
    const gradient = ctx.createRadialGradient(centerX, centerY, radius * 0.3, centerX, centerY, radius);
    gradient.addColorStop(0, '#f5f5f5');
    gradient.addColorStop(0.7, '#e8e8e8');
    gradient.addColorStop(1, '#d0d0d0');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, Math.PI, 2 * Math.PI);
    ctx.lineTo(centerX + radius, centerY);
    ctx.lineTo(centerX - radius, centerY);
    ctx.closePath();
    ctx.fill();

    // Draw metallic rim with shadow
    ctx.strokeStyle = '#4a4f55';
    ctx.lineWidth = 8;
    ctx.shadowBlur = 6;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowOffsetY = 3;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Draw inner bezel
    ctx.strokeStyle = '#6a6f75';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - 4, Math.PI, 2 * Math.PI);
    ctx.stroke();

    // Helper function to draw zone
    const drawZone = (range: [number, number] | undefined, color: string) => {
      if (!range) return;
      const startAngle = Math.PI + (Math.PI * (range[0] - min) / (max - min));
      const endAngle = Math.PI + (Math.PI * (range[1] - min) / (max - min));
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius - 12, startAngle, endAngle);
      ctx.lineWidth = 16;
      ctx.strokeStyle = color;
      ctx.stroke();
    };

    // Draw color zones
    drawZone(greenZone, '#2ecc71');
    drawZone(yellowZone, '#f1c40f');
    drawZone(redZone, '#e74c3c');

    // Draw tick marks and numbers
    const numTicks = 10;
    ctx.strokeStyle = '#222';
    ctx.fillStyle = '#1a1d20';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    
    for (let i = 0; i <= numTicks; i++) {
      const angle = Math.PI + (Math.PI * i / numTicks);
      const tickValue = min + (max - min) * i / numTicks;
      
      // Major tick marks
      const tickStart = radius - 22;
      const tickEnd = i % 2 === 0 ? radius - 35 : radius - 28;
      
      const x1 = centerX + tickStart * Math.cos(angle);
      const y1 = centerY + tickStart * Math.sin(angle);
      const x2 = centerX + tickEnd * Math.cos(angle);
      const y2 = centerY + tickEnd * Math.sin(angle);
      
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = i % 2 === 0 ? 3 : 2;
      ctx.stroke();
      
      // Numbers
      if (i % 2 === 0) {
        const textRadius = radius - 48;
        const textX = centerX + textRadius * Math.cos(angle);
        const textY = centerY + textRadius * Math.sin(angle) + 4;
        ctx.fillText(tickValue.toFixed(0), textX, textY);
      }
    }

    // Draw center pivot
    ctx.beginPath();
    ctx.arc(centerX, centerY, 10, 0, 2 * Math.PI);
    ctx.fillStyle = '#2a2f35';
    ctx.fill();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw needle
    const needleAngle = Math.PI + (Math.PI * (value - min) / (max - min));
    const needleLength = radius - 28;
    
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(needleAngle);
    
    // Needle shadow
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;
    
    // Needle shape
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(-4, -needleLength);
    ctx.lineTo(4, -needleLength);
    ctx.lineTo(10, 0);
    ctx.closePath();
    
    const needleGradient = ctx.createLinearGradient(-10, 0, 10, 0);
    needleGradient.addColorStop(0, '#c62828');
    needleGradient.addColorStop(0.5, '#e53935');
    needleGradient.addColorStop(1, '#c62828');
    ctx.fillStyle = needleGradient;
    ctx.fill();
    
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    // Needle outline
    ctx.strokeStyle = '#8b1a1a';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    ctx.restore();

    // Center cap on needle
    ctx.beginPath();
    ctx.arc(centerX, centerY, 8, 0, 2 * Math.PI);
    const capGradient = ctx.createRadialGradient(centerX - 2, centerY - 2, 0, centerX, centerY, 8);
    capGradient.addColorStop(0, '#e53935');
    capGradient.addColorStop(1, '#c62828');
    ctx.fillStyle = capGradient;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

  }, [value, min, max, greenZone, yellowZone, redZone]);

  return (
    <div className="flex flex-col items-center">
      <div 
        className="relative p-4 rounded-lg"
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
            inset 0 3px 6px rgba(0,0,0,0.5),
            inset 0 -2px 4px rgba(255,255,255,0.05),
            0 6px 12px rgba(0,0,0,0.7)
          `,
          border: '1px solid #1a1d20',
          position: 'relative'
        }}
      >
        {/* Corner screws */}
        {[
          { top: '6px', left: '6px' },
          { top: '6px', right: '6px' },
          { bottom: '6px', left: '6px' },
          { bottom: '6px', right: '6px' }
        ].map((pos, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: '10px',
              height: '10px',
              background: 'radial-gradient(circle at 30% 30%, #555, #2a2f35)',
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.8), 0 1px 1px rgba(255,255,255,0.1)',
              border: '1px solid #1a1d20',
              ...pos
            }}
          >
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                fontSize: '8px',
                color: '#1a1d20',
                transform: 'rotate(45deg)'
              }}
            >
              +
            </div>
          </div>
        ))}
        
        <canvas 
          ref={canvasRef} 
          width={200} 
          height={160}
          className="block"
        />
        
        {/* Digital readout */}
        <div 
          className="mt-3 px-4 py-2 rounded text-center relative"
          style={{
            backgroundColor: '#0a0c0e',
            boxShadow: 'inset 0 3px 6px rgba(0,0,0,0.9), inset 0 -1px 0 rgba(255,255,255,0.05)',
            border: '2px solid #1a1d20'
          }}
        >
          <div 
            className="font-mono text-xl tracking-wider font-bold"
            style={{ 
              color: '#00ff88', 
              textShadow: '0 0 10px rgba(0,255,136,0.8), 0 0 20px rgba(0,255,136,0.4)',
              filter: 'brightness(1.2)'
            }}
          >
            {value.toFixed(1)} {unit}
          </div>
        </div>
      </div>
      
      {/* Label */}
      <div 
        className="mt-3 px-4 py-2 text-xs font-bold tracking-wider text-center rounded relative"
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
    </div>
  );
}
import { AlertTriangle } from 'lucide-react';

interface AlertCardProps {
  title: string;
  message: string;
  timestamp: string;
}

export function AlertCard({ title, message, timestamp }: AlertCardProps) {
  return (
    <div 
      className="p-3 rounded mb-3"
      style={{
        backgroundColor: '#2b3036',
        border: '1px solid #3a3f45',
        boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
      }}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle 
          size={20} 
          style={{ color: '#f1c40f', flexShrink: 0, marginTop: '2px' }}
        />
        <div className="flex-1">
          <div 
            className="text-sm font-bold mb-1"
            style={{ color: '#e6e6e6' }}
          >
            {title}
          </div>
          <div 
            className="text-xs mb-2"
            style={{ color: '#9aa0a6' }}
          >
            {message}
          </div>
          <div 
            className="text-xs font-mono"
            style={{ color: '#6a6f75' }}
          >
            {timestamp}
          </div>
        </div>
      </div>
    </div>
  );
}

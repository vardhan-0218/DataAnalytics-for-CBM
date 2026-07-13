/**
 * ErrorBoundary.tsx
 * 
 * React Error Boundary to catch rendering errors and prevent white pages
 */

import React, { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{
          padding: '20px',
          margin: '20px',
          borderRadius: '8px',
          background: 'linear-gradient(180deg, #e74c3c 0%, #c0392b 100%)',
          border: '2px solid #c0392b',
          color: '#fff',
          fontFamily: 'monospace',
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: '14px',
            fontWeight: 'bold',
            marginBottom: '8px',
            letterSpacing: '2px',
          }}>
            COMPONENT ERROR
          </div>
          <div style={{
            fontSize: '12px',
            marginBottom: '12px',
            opacity: 0.9,
          }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: undefined })}
            style={{
              padding: '8px 16px',
              borderRadius: '4px',
              background: 'rgba(255,255,255,0.2)',
              border: '1px solid rgba(255,255,255,0.3)',
              color: '#fff',
              fontFamily: 'monospace',
              fontSize: '10px',
              cursor: 'pointer',
              letterSpacing: '1px',
            }}
          >
            RETRY
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
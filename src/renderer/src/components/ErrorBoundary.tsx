import { Component, type ReactNode } from 'react'

interface State { error: Error | null }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 16, color: '#9B3535', fontFamily: 'monospace', fontSize: 12,
          background: '#FFF0F0', height: '100%', overflow: 'auto', boxSizing: 'border-box'
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: 8 }}>React render error</div>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{this.state.error.message}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', opacity: 0.6, marginTop: 8, fontSize: 10 }}>{this.state.error.stack}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

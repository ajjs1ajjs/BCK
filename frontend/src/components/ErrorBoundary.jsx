import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[BCK ErrorBoundary]', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6 animate-ambient"
           style={{ backgroundImage: 'radial-gradient(ellipse at 50% 50%, rgba(239,68,68,0.08) 0%, transparent 60%)' }}>
        
        <div className="w-full max-w-md glass-card p-8 border border-red-200 dark:border-red-900/50 shadow-xl shadow-red-500/10 text-center relative overflow-hidden">
          
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 to-rose-500"></div>

          <div className="mx-auto w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-6">
            <AlertTriangle className="text-red-500 dark:text-red-400 w-8 h-8" />
          </div>
          
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            An unexpected error occurred in the interface.
          </p>
          
          {this.state.error && (
            <div className="mb-6 p-3 bg-red-50 dark:bg-red-900/20 rounded-xl text-left overflow-auto border border-red-100 dark:border-red-900/50">
              <pre className="text-xs font-mono text-red-600 dark:text-red-400 break-all whitespace-pre-wrap">
                {this.state.error.message}
              </pre>
            </div>
          )}
          
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
            >
              <RefreshCw size={16} />
              Reload page
            </button>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-semibold rounded-lg transition-colors shadow-sm"
            >
              Try again
            </button>
          </div>

        </div>
      </div>
    );
  }
}

import { Component, ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class FeatureErrorBoundary extends (Component as new (props: Props) => {
  props: Props;
  state: State;
  setState(updater: Partial<State> | ((prevState: State) => Partial<State>)): void;
}) {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[FeatureErrorBoundary] Uncaught error in feature module:', error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 my-4 bg-rose-50 border border-rose-200 rounded-3xl text-slate-800 shadow-sm max-w-lg mx-auto">
          <div className="flex items-center gap-3 text-rose-700 mb-2">
            <div className="w-10 h-10 rounded-2xl bg-rose-100 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
            </div>
            <div>
              <h3 className="font-bold text-base text-rose-900">
                {this.props.fallbackTitle || 'Feature Temporarily Unavailable'}
              </h3>
              <p className="text-xs text-rose-700">
                An isolated issue occurred. Your main app and medications remain secure.
              </p>
            </div>
          </div>
          <p className="text-xs text-rose-600/90 font-mono bg-white/70 p-2.5 rounded-xl border border-rose-100 my-3 break-all">
            {this.state.error?.message || 'Unknown runtime error'}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="w-full py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reload Section</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

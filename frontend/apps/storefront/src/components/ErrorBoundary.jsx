import { Component } from 'react';
import { ServerCrash, RefreshCw } from 'lucide-react';

/**
 * Error boundary — catches React rendering errors and shows a recovery UI
 * instead of a blank white screen. Wraps each route or section.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomeRiskyComponent />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Report to error tracking service (Sentry, etc.)
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const { fallback, message } = this.props;
      if (fallback) return fallback;

      return (
        <main className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50">
            <ServerCrash className="h-6 w-6 text-red-400" />
          </span>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {message || 'Something went wrong'}
            </h2>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
              An unexpected error occurred. Please try again.
            </p>
          </div>
          <button
            type="button"
            onClick={this.handleRetry}
            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}

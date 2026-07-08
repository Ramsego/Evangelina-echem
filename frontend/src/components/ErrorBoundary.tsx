import { Component, ReactNode } from "react";
import * as Sentry from "@sentry/react";
import { AlertTriangle } from "lucide-react";

interface Props {
  label?: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    if (import.meta.env.VITE_SENTRY_DSN) {
      Sentry.captureException(error, { extra: { componentStack: info.componentStack, label: this.props.label } });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 h-full bg-forest-800 text-forest-300 p-4 text-center">
          <AlertTriangle size={20} className="text-red-400" />
          <p className="text-sm">
            {this.props.label ? `"${this.props.label}" crashed.` : "Something crashed."}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-3 py-1 rounded border border-forest-600 bg-forest-700 text-forest-300 text-xs hover:bg-forest-600 transition-colors"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

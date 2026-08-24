import { Component, type ErrorInfo, type ReactNode } from "react";

import { ErrorState } from "@/components/ui/empty-state";
import { detectLocale } from "@/i18n/config";
import { translate } from "@/i18n/translate";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  render() {
    if (this.state.failed) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return <ErrorFallback />;
    }
    return this.props.children;
  }
}

function ErrorFallback() {
  const locale = detectLocale();

  return (
    <ErrorState
      title={translate(locale, "common.unexpectedError")}
      retryLabel={translate(locale, "common.reloadApp")}
      onRetry={() => window.location.reload()}
      fill
    />
  );
}

import React from "react";
import { Link } from "react-router-dom";

/**
 * ErrorBoundary — catches any JS error in the component tree and shows
 * a friendly recovery screen instead of a blank white page.
 * 
 * Usage: wrap any page or section:
 *   <ErrorBoundary>
 *     <RustoHome />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // In production, send to error monitoring (Sentry, etc.)
    if (import.meta.env.PROD) {
      console.error("[ErrorBoundary]", error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      const isDev = import.meta.env.DEV;
      return (
        <div style={{
          minHeight: "60vh", display: "flex", alignItems: "center",
          justifyContent: "center", padding: "40px 20px"
        }}>
          <div style={{
            maxWidth: 480, width: "100%", textAlign: "center",
            background: "white", borderRadius: 20, padding: 40,
            border: "1px solid #E2E8F0", boxShadow: "0 4px 24px rgba(15,23,42,.08)"
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h2 style={{
              fontFamily: "Outfit, sans-serif", fontWeight: 700,
              color: "#0F172A", fontSize: 22, marginBottom: 8
            }}>
              Something went wrong
            </h2>
            <p style={{ color: "#64748B", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              We hit an unexpected error. This has been logged and our team will look into it.
              Try refreshing the page or go back home.
            </p>
            {isDev && this.state.error && (
              <pre style={{
                textAlign: "left", fontSize: 11, background: "#FEF2F2",
                border: "1px solid #FECACA", borderRadius: 10, padding: 12,
                color: "#991B1B", overflow: "auto", maxHeight: 200, marginBottom: 20
              }}>
                {this.state.error.toString()}
                {this.state.errorInfo?.componentStack}
              </pre>
            )}
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null, errorInfo: null });
                  window.location.reload();
                }}
                style={{
                  padding: "10px 20px", borderRadius: 10, fontSize: 14,
                  fontWeight: 700, color: "white", background: "#1E3A8A",
                  border: "none", cursor: "pointer"
                }}
              >
                Reload page
              </button>
              <Link
                to="/"
                style={{
                  padding: "10px 20px", borderRadius: 10, fontSize: 14,
                  fontWeight: 600, color: "#475569", background: "#F8FAFC",
                  border: "1px solid #E2E8F0", textDecoration: "none",
                  display: "inline-flex", alignItems: "center"
                }}
              >
                Go home
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * HOC wrapper for function components
 * Usage: export default withErrorBoundary(MyComponent);
 */
export function withErrorBoundary(Component, fallback = null) {
  return function WrappedComponent(props) {
    return (
      <ErrorBoundary fallback={fallback}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}

export default ErrorBoundary;

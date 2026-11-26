// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";

export interface InspectorErrorBoundaryProps {
  panelName?: string | undefined;
  resetKey?: string | undefined;
  children: React.ReactNode;
}

interface InspectorErrorBoundaryState {
  hasError: boolean;
  message: string;
}

/**
 * Isolates runtime or dynamic chunk failures inside individual Inspector panels
 * so a single language or analysis panel never crashes the workbench.
 */
export class InspectorErrorBoundary extends React.Component<InspectorErrorBoundaryProps, InspectorErrorBoundaryState> {
  constructor(props: InspectorErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): InspectorErrorBoundaryState {
    const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
    return { hasError: true, message };
  }

  override componentDidUpdate(prevProps: InspectorErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, message: "" });
    }
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, message: "" });
  };

  override render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div
        role="alert"
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "10px",
          padding: "24px",
          textAlign: "center",
          background: "var(--ms-bg, var(--color-canvas-default, transparent))",
          color: "var(--ms-text-1, var(--color-fg-default, inherit))",
        }}
      >
        <div
          style={{
            fontWeight: 600,
            fontSize: "13px",
            color: "var(--ms-status-fail-fg, #e11d48)",
          }}
        >
          {this.props.panelName ? `${this.props.panelName} failed to render` : "Inspector panel failed to render"}
        </div>
        <div
          style={{
            maxWidth: "460px",
            fontSize: "12px",
            fontFamily: "var(--ms-font-mono, monospace)",
            padding: "8px 12px",
            borderRadius: "6px",
            background: "var(--ms-status-fail-bg, rgba(225,29,72,0.08))",
            border: "1px solid var(--ms-status-fail-border, rgba(225,29,72,0.28))",
            color: "var(--ms-text-2, var(--color-fg-muted, inherit))",
            wordBreak: "break-word",
          }}
        >
          {this.state.message}
        </div>
        <button
          type="button"
          onClick={this.handleRetry}
          style={{
            appearance: "none",
            fontSize: "12px",
            fontWeight: 500,
            padding: "5px 12px",
            borderRadius: "6px",
            cursor: "pointer",
            background: "var(--ms-brand, #0e7490)",
            color: "var(--ms-brand-contrast, #ffffff)",
            border: "none",
          }}
        >
          Retry Panel
        </button>
      </div>
    );
  }
}

/**
 * Lightweight skeleton placeholder for lazy-loaded Inspector panels and subtabs.
 */
export const InspectorLoadingSkeleton: React.FC<{ label?: string | undefined }> = ({
  label = "Loading inspector…",
}) => (
  <div
    role="status"
    aria-live="polite"
    style={{
      flex: 1,
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "8px",
      padding: "24px",
      color: "var(--ms-text-2, var(--color-fg-muted, #64748b))",
      fontSize: "12px",
    }}
  >
    <div
      style={{
        width: "22px",
        height: "22px",
        borderRadius: "50%",
        border: "2px solid var(--ms-border, rgba(148,163,184,0.28))",
        borderTopColor: "var(--ms-brand, #0891b2)",
        animation: "spin 0.8s linear infinite",
      }}
    />
    <span>{label}</span>
  </div>
);

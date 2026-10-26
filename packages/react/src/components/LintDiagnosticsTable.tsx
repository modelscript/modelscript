// SPDX-License-Identifier: AGPL-3.0-or-later

export interface LintDiagnosticItem {
  code: string;
  message: string;
  severity: "error" | "warning" | "info";
  blockName?: string;
  line?: number;
  column?: number;
}

export interface LintDiagnosticsTableProps {
  diagnostics: LintDiagnosticItem[];
  onSelect?: (diag: LintDiagnosticItem) => void;
  className?: string;
}

export function LintDiagnosticsTable({ diagnostics, onSelect, className }: LintDiagnosticsTableProps) {
  if (diagnostics.length === 0) {
    return (
      <div
        className={className}
        style={{
          padding: "24px",
          textAlign: "center",
          borderRadius: "8px",
          backgroundColor: "rgba(16, 185, 129, 0.05)",
          border: "1px solid rgba(16, 185, 129, 0.2)",
          color: "#10b981",
        }}
      >
        <div style={{ fontSize: "20px", marginBottom: "4px" }}>✔</div>
        <div style={{ fontWeight: 600, fontSize: "14px" }}>Zero Static Violations Detected</div>
        <div style={{ fontSize: "12px", opacity: 0.8 }}>Model conforms to all pre-flight standards.</div>
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        borderRadius: "8px",
        border: "1px solid var(--color-border-default, #334155)",
        overflow: "hidden",
        backgroundColor: "var(--color-canvas-default, #0f172a)",
      }}
    >
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid var(--color-border-default, #334155)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "12px",
          fontWeight: 700,
          textTransform: "uppercase",
          color: "var(--color-fg-muted, #94a3b8)",
        }}
      >
        <span>Static Diagnostics ({diagnostics.length})</span>
        <span>
          {diagnostics.filter((d) => d.severity === "error").length} errors,{" "}
          {diagnostics.filter((d) => d.severity === "warning").length} warnings
        </span>
      </div>

      <div style={{ maxHeight: "360px", overflowY: "auto" }}>
        {diagnostics.map((diag, i) => {
          const isError = diag.severity === "error";
          return (
            <div
              key={i}
              onClick={() => onSelect?.(diag)}
              style={{
                padding: "10px 16px",
                borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                display: "flex",
                gap: "12px",
                alignItems: "flex-start",
                cursor: onSelect ? "pointer" : "default",
                fontSize: "13px",
                transition: "background 0.15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.03)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  fontFamily: "ui-monospace, monospace",
                  padding: "1px 6px",
                  borderRadius: "4px",
                  backgroundColor: isError ? "rgba(239, 68, 68, 0.15)" : "rgba(245, 158, 11, 0.15)",
                  color: isError ? "#f87171" : "#fbbf24",
                  border: `1px solid ${isError ? "rgba(239, 68, 68, 0.3)" : "rgba(245, 158, 11, 0.3)"}`,
                  flexShrink: 0,
                  marginTop: "2px",
                }}
              >
                {diag.code}
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "var(--color-fg-default, #f8fafc)", lineHeight: 1.4 }}>{diag.message}</div>
                {diag.blockName && (
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--color-fg-muted, #94a3b8)",
                      marginTop: "2px",
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    Target: {diag.blockName}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

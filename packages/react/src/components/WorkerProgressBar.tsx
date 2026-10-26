// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorkerTaskStage } from "../worker/worker-protocol.js";

export interface WorkerProgressBarProps {
  stage: WorkerTaskStage;
  progress: number;
  statusMessage: string;
  isRunning?: boolean | undefined;
  durationMs?: number | null | undefined;
  onAbort?: (() => void) | undefined;
  className?: string | undefined;
}

export function WorkerProgressBar({
  stage,
  progress,
  statusMessage,
  isRunning = false,
  durationMs,
  onAbort,
  className,
}: WorkerProgressBarProps) {
  if (stage === "idle" && !isRunning) return null;

  const isError = stage === "error";
  const isDone = stage === "ready";

  const getStageColor = () => {
    if (isError) return "#ef4444";
    if (isDone) return "#10b981";
    return "#8b5cf6";
  };

  return (
    <div
      className={className}
      style={{
        borderRadius: "8px",
        padding: "12px 16px",
        backgroundColor: "var(--color-canvas-subtle, rgba(255, 255, 255, 0.03))",
        border: `1px solid ${isError ? "rgba(239, 68, 68, 0.3)" : "var(--color-border-default, #334155)"}`,
        marginTop: "12px",
        marginBottom: "12px",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
          fontSize: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              display: "inline-block",
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: getStageColor(),
              boxShadow: isRunning ? `0 0 8px ${getStageColor()}` : "none",
            }}
          />
          <span
            style={{
              fontWeight: 700,
              textTransform: "uppercase",
              fontSize: "11px",
              letterSpacing: "0.5px",
              color: getStageColor(),
            }}
          >
            {stage}
          </span>
          <span style={{ color: "var(--color-fg-muted, #94a3b8)" }}>{statusMessage}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {durationMs !== null && durationMs !== undefined && (
            <span
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: "11px",
                color: "var(--color-fg-muted, #94a3b8)",
              }}
            >
              {durationMs.toFixed(1)} ms
            </span>
          )}

          {isRunning && onAbort && (
            <button
              onClick={onAbort}
              style={{
                background: "none",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                color: "#ef4444",
                borderRadius: "4px",
                padding: "2px 8px",
                fontSize: "11px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Progress Track */}
      <div
        style={{
          width: "100%",
          height: "6px",
          borderRadius: "3px",
          backgroundColor: "rgba(255, 255, 255, 0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(100, Math.max(0, progress))}%`,
            height: "100%",
            borderRadius: "3px",
            backgroundColor: getStageColor(),
            transition: "width 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
            boxShadow: isRunning ? `0 0 10px ${getStageColor()}` : "none",
          }}
        />
      </div>
    </div>
  );
}

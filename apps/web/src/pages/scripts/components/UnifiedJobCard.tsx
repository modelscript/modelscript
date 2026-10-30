// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowRightIcon, CheckCircleFillIcon, ClockIcon, PulseIcon, XCircleFillIcon } from "@primer/octicons-react";
import React from "react";
import Box from "../../../components/Box";
import type { UnifiedJobItem } from "../types";
import { relativeTime } from "../utils";

export interface UnifiedJobCardProps {
  job: UnifiedJobItem;
  onInspect: (jobId: string | number) => void;
}

export const UnifiedJobCard: React.FC<UnifiedJobCardProps> = ({ job, onInspect }) => {
  const isRunning = job.status === "RUNNING";
  const isDone = job.status === "SUCCESS";
  const isFailed = job.status === "FAILED";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onInspect(job.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onInspect(job.id);
        }
      }}
      style={{
        padding: "16px 20px",
        borderRadius: "12px",
        backgroundColor: isRunning ? "rgba(6, 182, 212, 0.05)" : "var(--color-bg-card, rgba(255, 255, 255, 0.025))",
        border: `1px solid ${
          isRunning
            ? "rgba(6, 182, 212, 0.35)"
            : isFailed
              ? "rgba(239, 68, 68, 0.25)"
              : "var(--color-border-glass, rgba(255, 255, 255, 0.08))"
        }`,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        transition: "all 0.15s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = isRunning ? "var(--color-accent-cyan)" : "rgba(255, 255, 255, 0.25)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = isRunning
          ? "rgba(6, 182, 212, 0.35)"
          : isFailed
            ? "rgba(239, 68, 68, 0.25)"
            : "var(--color-border-glass, rgba(255, 255, 255, 0.08))";
        e.currentTarget.style.transform = "none";
      }}
    >
      {/* Top Row: Title, ID, Status, Actions */}
      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
        <Box display="flex" alignItems="center" gap={2} style={{ minWidth: 0, flex: 1 }}>
          {isRunning ? (
            <PulseIcon
              size={18}
              style={{
                color: "var(--color-accent-cyan)",
                animation: "ms-pulse 1.5s infinite",
              }}
            />
          ) : isDone ? (
            <CheckCircleFillIcon size={18} fill="var(--color-status-verified, #10b981)" />
          ) : isFailed ? (
            <XCircleFillIcon size={18} fill="#ef4444" />
          ) : (
            <ClockIcon size={18} style={{ color: "#f59e0b" }} />
          )}

          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: "15px",
                  color: "var(--color-text-primary, #ffffff)",
                }}
              >
                {job.name}
              </span>
              <code
                style={{
                  fontSize: "11px",
                  fontFamily: "var(--font-mono, monospace)",
                  backgroundColor: "rgba(255, 255, 255, 0.08)",
                  color: "var(--color-text-muted, #8b949e)",
                  padding: "1px 6px",
                  borderRadius: "4px",
                }}
              >
                #{String(job.id).slice(0, 8)}
              </code>
            </div>
          </div>
        </Box>

        <Box display="flex" alignItems="center" gap={3}>
          {/* Status Badge */}
          <span
            role="status"
            aria-live="polite"
            style={{
              fontSize: "11px",
              fontWeight: 700,
              fontFamily: "var(--font-mono, monospace)",
              padding: "3px 8px",
              borderRadius: "6px",
              background: isRunning
                ? "rgba(6, 182, 212, 0.15)"
                : isDone
                  ? "rgba(16, 185, 129, 0.15)"
                  : isFailed
                    ? "rgba(239, 68, 68, 0.15)"
                    : "rgba(245, 158, 11, 0.15)",
              color: isRunning
                ? "var(--color-accent-cyan, #06b6d4)"
                : isDone
                  ? "var(--color-status-verified, #10b981)"
                  : isFailed
                    ? "#f87171"
                    : "#fbbf24",
              border: `1px solid ${
                isRunning
                  ? "rgba(6, 182, 212, 0.4)"
                  : isDone
                    ? "rgba(16, 185, 129, 0.4)"
                    : isFailed
                      ? "rgba(239, 68, 68, 0.4)"
                      : "rgba(245, 158, 11, 0.4)"
              }`,
              letterSpacing: "0.5px",
            }}
          >
            {job.status}
          </span>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onInspect(job.id);
            }}
            style={{
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.12))",
              color: "var(--color-text-primary, #ffffff)",
              borderRadius: "6px",
              padding: "4px 10px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span>Inspect</span>
            <ArrowRightIcon size={12} />
          </button>
        </Box>
      </Box>

      {/* Progress Bar (if running or completed) */}
      {(isRunning || job.progress > 0) && (
        <div
          style={{
            height: "5px",
            background: "rgba(255, 255, 255, 0.08)",
            borderRadius: "9999px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${job.progress}%`,
              background: isFailed
                ? "#ef4444"
                : isDone
                  ? "var(--color-status-verified, #10b981)"
                  : "linear-gradient(90deg, #06b6d4, #8b5cf6, #06b6d4)",
              backgroundSize: "200% 100%",
              animation: isRunning ? "shimmer 2s linear infinite" : "none",
              borderRadius: "9999px",
              transition: "width 0.4s ease",
            }}
          />
        </div>
      )}

      {/* Bottom Metadata Row */}
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        gap={2}
        fontSize="12px"
        color="var(--color-text-muted)"
      >
        <Box display="flex" alignItems="center" gap={3} flexWrap="wrap">
          <span>
            Solver: <strong style={{ color: "var(--color-text-primary)" }}>{job.solver}</strong>
          </span>
          <span>·</span>
          <span>
            Domain: <strong style={{ color: "var(--color-accent-cyan)" }}>{job.domain.toUpperCase()}</strong>
          </span>
          <span>·</span>
          <span>
            Compute Profile: <code style={{ fontSize: "11px" }}>{job.profile}</code>
          </span>
        </Box>

        <Box display="flex" alignItems="center" gap={3}>
          {job.costCredits != null && (
            <span style={{ color: "var(--color-accent-purple, #a855f7)", fontWeight: 600 }}>
              {job.costCredits.toFixed(2)} credits
            </span>
          )}
          <span>
            Started {relativeTime(job.started_at)}
            {job.completed_at && ` · Finished ${relativeTime(job.completed_at)}`}
          </span>
        </Box>
      </Box>
    </div>
  );
};

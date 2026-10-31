// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowRightIcon,
  BookmarkIcon,
  CheckCircleFillIcon,
  ClockIcon,
  PackageIcon,
  PulseIcon,
  SyncIcon,
  XCircleFillIcon,
  ZapIcon,
} from "@primer/octicons-react";
import React from "react";
import { Link } from "react-router-dom";
import Box from "../../../components/Box";
import type { UnifiedJobItem } from "../types";
import { relativeTime } from "../utils";

export interface UnifiedJobCardProps {
  job: UnifiedJobItem;
  onInspect: (jobId: string | number) => void;
  onRerun?: ((job: UnifiedJobItem) => void) | undefined;
  onSaveAsTemplate?: ((job: UnifiedJobItem) => void) | undefined;
}

export const UnifiedJobCard: React.FC<UnifiedJobCardProps> = ({ job, onInspect, onRerun, onSaveAsTemplate }) => {
  const isRunning = job.status === "RUNNING";
  const isDone = job.status === "SUCCESS";
  const isFailed = job.status === "FAILED";
  const isLocalWasm = job.executionTarget === "local-wasm" || job.profile === "wasm-edge";
  const stdFmt = job.standardFormat || job.studyInstanceArtifact?.format;

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
        gap: "12px",
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
      {/* Top Row: Title, ID, Study Kind & Target Badges, Status, Actions */}
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
              {stdFmt && (
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    fontFamily: "var(--font-mono, monospace)",
                    padding: "2px 7px",
                    borderRadius: "4px",
                    background:
                      stdFmt === "dakota"
                        ? "rgba(245, 158, 11, 0.14)"
                        : stdFmt === "ssp-ssv"
                          ? "rgba(16, 185, 129, 0.14)"
                          : "rgba(6, 182, 212, 0.14)",
                    border: `1px solid ${
                      stdFmt === "dakota"
                        ? "rgba(245, 158, 11, 0.35)"
                        : stdFmt === "ssp-ssv"
                          ? "rgba(16, 185, 129, 0.35)"
                          : "rgba(6, 182, 212, 0.35)"
                    }`,
                    color: stdFmt === "dakota" ? "#fbbf24" : stdFmt === "ssp-ssv" ? "#34d399" : "#22d3ee",
                  }}
                >
                  {stdFmt === "dakota" ? ".dakota" : stdFmt === "ssp-ssv" ? ".ssv" : ".sedml"}
                </span>
              )}
              {job.studyKind && (
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.4px",
                    padding: "2px 7px",
                    borderRadius: "999px",
                    background: "rgba(168, 85, 247, 0.14)",
                    border: "1px solid rgba(168, 85, 247, 0.3)",
                    color: "#c084fc",
                  }}
                >
                  {job.studyKind}
                </span>
              )}
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  padding: "2px 7px",
                  borderRadius: "999px",
                  background: isLocalWasm ? "rgba(16, 185, 129, 0.12)" : "rgba(6, 182, 212, 0.12)",
                  border: `1px solid ${isLocalWasm ? "rgba(16, 185, 129, 0.3)" : "rgba(6, 182, 212, 0.3)"}`,
                  color: isLocalWasm ? "#34d399" : "#22d3ee",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "3px",
                }}
              >
                <ZapIcon size={10} />
                {isLocalWasm ? "Local WASM" : "HPC Cluster"}
              </span>
            </div>
          </div>
        </Box>

        <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
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

          {onRerun && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRerun(job);
              }}
              title="Re-run this study instance with the exact same configuration"
              style={{
                background: "rgba(6, 182, 212, 0.12)",
                border: "1px solid rgba(6, 182, 212, 0.35)",
                color: "var(--color-accent-cyan, #22d3ee)",
                borderRadius: "6px",
                padding: "5px 10px",
                fontSize: "11.5px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <SyncIcon size={12} />
              <span>Re-run</span>
            </button>
          )}

          {onSaveAsTemplate && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSaveAsTemplate(job);
              }}
              title="Save this study instance as a reusable Study Template"
              style={{
                background: "rgba(168, 85, 247, 0.12)",
                border: "1px solid rgba(168, 85, 247, 0.35)",
                color: "#c084fc",
                borderRadius: "6px",
                padding: "5px 10px",
                fontSize: "11.5px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <BookmarkIcon size={12} />
              <span>Save as Template</span>
            </button>
          )}

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
              padding: "5px 12px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <span>Inspect Study</span>
            <ArrowRightIcon size={12} />
          </button>
        </Box>
      </Box>

      {/* Inline KPI Summary Strip (if study KPIs are available) */}
      {job.kpis && job.kpis.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "8px",
            padding: "8px 12px",
            borderRadius: "8px",
            background: "rgba(0, 0, 0, 0.22)",
            border: "1px solid rgba(255, 255, 255, 0.05)",
          }}
        >
          {job.kpis.slice(0, 4).map((kpi) => (
            <div
              key={kpi.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "11px",
                padding: "2px 8px",
                borderRadius: "6px",
                background: "rgba(255, 255, 255, 0.04)",
              }}
            >
              <span style={{ color: "var(--color-text-muted)" }}>{kpi.label}:</span>
              <strong
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  color: kpi.status === "pass" ? "#34d399" : kpi.status === "fail" ? "#f87171" : "#e2e8f0",
                }}
              >
                {kpi.value}
                {kpi.unit ? ` ${kpi.unit}` : ""}
              </strong>
            </div>
          ))}
        </div>
      )}

      {/* Progress Bar (if running or completed) */}
      {(isRunning || job.progress > 0) && (
        <div
          style={{
            height: "4px",
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
          {(job.targetArtifact || job.modelName) && (
            <>
              <span>
                Artifact:{" "}
                <strong style={{ color: "var(--color-text-primary)" }}>{job.targetArtifact || job.modelName}</strong>
              </span>
              <span>·</span>
            </>
          )}
          {job.packageName && (
            <>
              <Link
                to={`/packages/${job.packageName}/${job.packageVersion || "latest"}?tab=studies`}
                onClick={(e) => e.stopPropagation()}
                title={`View linked Studies & Jobs on package ${job.packageName}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  color: "#93c5fd",
                  textDecoration: "none",
                }}
              >
                <PackageIcon size={12} />
                <code>
                  {job.packageName}
                  {job.packageVersion ? `@${job.packageVersion}` : ""}
                </code>
              </Link>
              <span>·</span>
            </>
          )}
          <span>
            Solver: <strong style={{ color: "var(--color-text-primary)" }}>{job.solver}</strong>
          </span>
          <span>·</span>
          <span>
            Domain: <strong style={{ color: "var(--color-accent-cyan)" }}>{job.domain.toUpperCase()}</strong>
          </span>
          {job.sampleCount && job.sampleCount > 1 && (
            <>
              <span>·</span>
              <span>
                Ensemble: <strong style={{ color: "#c084fc" }}>{job.sampleCount} tasks</strong>
              </span>
            </>
          )}
          <span>·</span>
          <span>
            Profile: <code style={{ fontSize: "11px" }}>{job.profile}</code>
          </span>
        </Box>

        <Box display="flex" alignItems="center" gap={3}>
          {job.costCredits != null && (
            <span style={{ color: "var(--color-accent-purple, #a855f7)", fontWeight: 600 }}>
              {job.costCredits === 0 ? "Free (Local WASM)" : `${job.costCredits.toFixed(2)} credits`}
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

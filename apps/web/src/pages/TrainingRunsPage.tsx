// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import styled from "styled-components";
import { usePageTitle } from "../util/title";

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirroring apps/api/src/routes/models-and-runs.ts)
// ─────────────────────────────────────────────────────────────────────────────

type TrainingRunBackend = "webgpu" | "pytorch" | "slurm";
type TrainingRunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

interface TrainingRunRecord {
  id: number;
  runUid: string;
  recipeName: string;
  recipeVersion: string;
  modelName: string | null;
  backend: TrainingRunBackend;
  status: TrainingRunStatus;
  hyperparams: Record<string, unknown>;
  shardIds: string[];
  slurmJobId: string | null;
  latestCheckpointKey: string | null;
  evalReport: Record<string, unknown> | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

interface TrainingRunMetricPoint {
  id: number;
  runId: number;
  step: number;
  epoch: number | null;
  centerLoss: number | null;
  worstCaseLoss: number | null;
  mActive: number | null;
  maxSpreadDeltaT: number | null;
  prunedCount: number;
  mergedCount: number;
  expandedCount: number;
  girardCapCount: number;
  gate1To4PassRate: number | null;
  ece: number | null;
  wqRecallAtK: number | null;
  extra: Record<string, unknown>;
  recordedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth & Formatting Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const token = localStorage.getItem("modelscript-auth-token") || localStorage.getItem("token");
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }
  } catch {
    // Ignore storage errors
  }
  return headers;
}

function fmtNum(v: number | null | undefined, digits = 4): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Styled Components
// ─────────────────────────────────────────────────────────────────────────────

const PageContainer = styled.div`
  max-width: 1260px;
  margin: 0 auto;
  padding: 24px 20px 64px;
  color: var(--ms-text-1, #e6edf3);
`;

const HeaderRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 18px;
`;

const PageTitle = styled.h1`
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--ms-text-heading, var(--ms-text-1, #f0f6fc));
`;

const Subtitle = styled.p`
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--ms-text-2, #8b949e);
`;

const ButtonRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`;

const ActionButton = styled.button<{ $variant?: "primary" | "secondary" | "success" | "warn" | "danger" }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 13px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid
    ${(p) =>
      p.$variant === "primary"
        ? "var(--ms-brand, #38bdf8)"
        : p.$variant === "success"
          ? "rgba(52, 211, 153, 0.55)"
          : p.$variant === "warn"
            ? "rgba(251, 191, 36, 0.55)"
            : p.$variant === "danger"
              ? "rgba(248, 113, 113, 0.55)"
              : "var(--ms-border, #30363d)"};
  background: ${(p) =>
    p.$variant === "primary"
      ? "linear-gradient(135deg, #0284c7, #6366f1)"
      : p.$variant === "success"
        ? "rgba(16, 185, 129, 0.16)"
        : p.$variant === "warn"
          ? "rgba(245, 158, 11, 0.16)"
          : p.$variant === "danger"
            ? "rgba(239, 68, 68, 0.16)"
            : "var(--ms-bg-elv, #161b22)"};
  color: ${(p) =>
    p.$variant === "primary"
      ? "#ffffff"
      : p.$variant === "success"
        ? "#34d399"
        : p.$variant === "warn"
          ? "#fbbf24"
          : p.$variant === "danger"
            ? "#f87171"
            : "var(--ms-text-1, #e6edf3)"};
  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

const NavLinkButton = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  color: var(--ms-text-1, #e6edf3);
  border: 1px solid var(--ms-border, #30363d);
  background: var(--ms-bg-elv, #161b22);
  &:hover {
    border-color: var(--ms-brand, #38bdf8);
  }
`;

const SectionCard = styled.section`
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid var(--ms-border, #30363d);
  background: var(--ms-bg-elv, #161b22);
  margin-bottom: 16px;
`;

const FilterBar = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--ms-border, #30363d);
  background: var(--ms-bg-elv, #161b22);
  margin-bottom: 16px;
`;

const FilterGroup = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`;

const FilterLabel = styled.span`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ms-text-2, #8b949e);
  min-width: 70px;
`;

const Pill = styled.button<{ $active?: boolean }>`
  padding: 5px 11px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid ${(p) => (p.$active ? "var(--ms-brand, #38bdf8)" : "var(--ms-border, #30363d)")};
  background: ${(p) => (p.$active ? "rgba(56, 189, 248, 0.16)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--ms-brand, #38bdf8)" : "var(--ms-text-2, #8b949e)")};
`;

const StatusBadge = styled.span<{ $status: TrainingRunStatus }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 9px;
  border-radius: 999px;
  background: ${(p) =>
    p.$status === "running"
      ? "rgba(56, 189, 248, 0.18)"
      : p.$status === "completed"
        ? "rgba(52, 211, 153, 0.16)"
        : p.$status === "paused"
          ? "rgba(251, 191, 36, 0.16)"
          : p.$status === "failed" || p.$status === "cancelled"
            ? "rgba(248, 113, 113, 0.16)"
            : "rgba(148, 163, 184, 0.16)"};
  color: ${(p) =>
    p.$status === "running"
      ? "#38bdf8"
      : p.$status === "completed"
        ? "#34d399"
        : p.$status === "paused"
          ? "#fbbf24"
          : p.$status === "failed" || p.$status === "cancelled"
            ? "#f87171"
            : "#94a3b8"};
  border: 1px solid
    ${(p) =>
      p.$status === "running"
        ? "rgba(56, 189, 248, 0.45)"
        : p.$status === "completed"
          ? "rgba(52, 211, 153, 0.45)"
          : p.$status === "paused"
            ? "rgba(251, 191, 36, 0.45)"
            : p.$status === "failed" || p.$status === "cancelled"
              ? "rgba(248, 113, 113, 0.45)"
              : "rgba(148, 163, 184, 0.35)"};
`;

const BackendBadge = styled.span<{ $backend: TrainingRunBackend }>`
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
  font-family: var(--ms-font-mono, monospace);
  padding: 2px 8px;
  border-radius: 6px;
  background: ${(p) =>
    p.$backend === "webgpu"
      ? "rgba(16, 185, 129, 0.16)"
      : p.$backend === "pytorch"
        ? "rgba(249, 115, 22, 0.16)"
        : "rgba(139, 92, 246, 0.16)"};
  color: ${(p) => (p.$backend === "webgpu" ? "#34d399" : p.$backend === "pytorch" ? "#fb923c" : "#a78bfa")};
  border: 1px solid
    ${(p) =>
      p.$backend === "webgpu"
        ? "rgba(16, 185, 129, 0.4)"
        : p.$backend === "pytorch"
          ? "rgba(249, 115, 22, 0.4)"
          : "rgba(139, 92, 246, 0.4)"};
`;

const RunsTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  th,
  td {
    text-align: left;
    padding: 10px 12px;
    border-bottom: 1px solid var(--ms-divider, #21262d);
  }
  th {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ms-text-2, #8b949e);
  }
  tbody tr:hover {
    background: var(--ms-surface-hover, rgba(255, 255, 255, 0.03));
  }
`;

const ChartsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(520px, 1fr));
  gap: 16px;
  margin-bottom: 18px;
  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`;

const ChartCard = styled.div`
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid var(--ms-border, #30363d);
  background: var(--ms-bg-elv, #161b22);
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const ChartHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const ChartTitle = styled.h3`
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--ms-text-heading, var(--ms-text-1, #f0f6fc));
`;

const LegendRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  color: var(--ms-text-2, #8b949e);
`;

const LegendItem = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
`;

const LegendSwatch = styled.span<{ $color: string; $dashed?: boolean }>`
  width: 12px;
  height: 3px;
  border-radius: 2px;
  background: ${(p) => (p.$dashed ? "transparent" : p.$color)};
  border-top: ${(p) => (p.$dashed ? `2px dashed ${p.$color}` : "none")};
`;

const KpiGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
`;

const KpiTile = styled.div`
  padding: 11px 13px;
  border-radius: 10px;
  border: 1px solid var(--ms-divider, #21262d);
  background: var(--ms-bg-elv, #161b22);
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const KpiLabel = styled.span`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--ms-text-2, #8b949e);
`;

const KpiValue = styled.span`
  font-size: 18px;
  font-weight: 700;
  font-family: var(--ms-font-mono, monospace);
`;

const Input = styled.input`
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--ms-border, #30363d);
  background: var(--ms-bg, #0d1117);
  color: var(--ms-text-1, #e6edf3);
  font-size: 13px;
`;

const Select = styled.select`
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--ms-border, #30363d);
  background: var(--ms-bg, #0d1117);
  color: var(--ms-text-1, #e6edf3);
  font-size: 13px;
`;

const FieldLabel = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ms-text-2, #8b949e);
`;

const FormGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
`;

const AlertBox = styled.div<{ $tone: "error" | "info" }>`
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  margin-bottom: 14px;
  border: 1px solid ${(p) => (p.$tone === "error" ? "rgba(248,113,113,0.45)" : "rgba(56,189,248,0.4)")};
  background: ${(p) => (p.$tone === "error" ? "rgba(239,68,68,0.1)" : "rgba(56,189,248,0.08)")};
`;

// ─────────────────────────────────────────────────────────────────────────────
// Zero-Dependency Inline SVG Time-Series Chart Primitives
// ─────────────────────────────────────────────────────────────────────────────

interface ChartSeries {
  id: string;
  label: string;
  color: string;
  axis?: "left" | "right";
  dashed?: boolean;
  points: { step: number; value: number }[];
}

interface SvgTimeSeriesProps {
  title: string;
  subtitle?: string;
  series: ChartSeries[];
  shadedBand?: {
    upperSeriesId: string;
    lowerSeriesId: string;
    fill: string;
    label: string;
  };
  leftFormatter?: (v: number) => string;
  rightFormatter?: (v: number) => string;
  leftDomainMin?: number;
  leftDomainMax?: number;
  rightDomainMin?: number;
  rightDomainMax?: number;
}

const CHART_W = 560;
const CHART_H = 220;
const PAD_L = 52;
const PAD_R = 52;
const PAD_T = 16;
const PAD_B = 30;
const PLOT_W = CHART_W - PAD_L - PAD_R;
const PLOT_H = CHART_H - PAD_T - PAD_B;

function computeDomain(values: number[], fixedMin?: number, fixedMax?: number): [number, number] {
  if (values.length === 0) {
    return [fixedMin ?? 0, fixedMax ?? 1];
  }
  let minV = Math.min(...values);
  let maxV = Math.max(...values);
  if (fixedMin !== undefined) minV = Math.min(minV, fixedMin);
  if (fixedMax !== undefined) maxV = Math.max(maxV, fixedMax);
  if (Math.abs(maxV - minV) < 1e-9) {
    const pad = Math.max(0.5, Math.abs(maxV) * 0.2);
    return [Math.max(fixedMin ?? -Infinity, minV - pad), maxV + pad];
  }
  const margin = (maxV - minV) * 0.08;
  const lo = fixedMin !== undefined ? Math.max(fixedMin, minV - margin) : minV - margin;
  const hi = fixedMax !== undefined ? Math.max(fixedMax, maxV + margin) : maxV + margin;
  return [lo, hi];
}

const SvgTimeSeriesChart: React.FC<SvgTimeSeriesProps> = ({
  title,
  subtitle,
  series,
  shadedBand,
  leftFormatter = (v) => v.toFixed(2),
  rightFormatter = (v) => v.toFixed(2),
  leftDomainMin,
  leftDomainMax,
  rightDomainMin,
  rightDomainMax,
}) => {
  const allSteps = useMemo(() => {
    const set = new Set<number>();
    for (const s of series) {
      for (const p of s.points) set.add(p.step);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [series]);

  const hasAnyData = allSteps.length > 0;
  const minStep = hasAnyData ? allSteps[0]! : 0;
  const maxStep = hasAnyData ? allSteps[allSteps.length - 1]! : 1;

  const leftSeries = series.filter((s) => (s.axis ?? "left") === "left");
  const rightSeries = series.filter((s) => s.axis === "right");
  const hasRightAxis = rightSeries.some((s) => s.points.length > 0);

  const [leftMin, leftMax] = useMemo(
    () =>
      computeDomain(
        leftSeries.flatMap((s) => s.points.map((p) => p.value)),
        leftDomainMin,
        leftDomainMax,
      ),
    [leftSeries, leftDomainMin, leftDomainMax],
  );

  const [rightMin, rightMax] = useMemo(
    () =>
      computeDomain(
        rightSeries.flatMap((s) => s.points.map((p) => p.value)),
        rightDomainMin,
        rightDomainMax,
      ),
    [rightSeries, rightDomainMin, rightDomainMax],
  );

  const xOf = (step: number): number => {
    if (maxStep === minStep) return PAD_L + PLOT_W / 2;
    return PAD_L + ((step - minStep) / (maxStep - minStep)) * PLOT_W;
  };

  const yOf = (val: number, axis: "left" | "right"): number => {
    const [lo, hi] = axis === "right" ? [rightMin, rightMax] : [leftMin, leftMax];
    const ratio = (val - lo) / Math.max(1e-9, hi - lo);
    return PAD_T + PLOT_H - Math.max(0, Math.min(1, ratio)) * PLOT_H;
  };

  const bandPolygon = useMemo(() => {
    if (!shadedBand) return null;
    const upper = series.find((s) => s.id === shadedBand.upperSeriesId);
    const lower = series.find((s) => s.id === shadedBand.lowerSeriesId);
    if (!upper || !lower || upper.points.length === 0 || lower.points.length === 0) return null;

    const lowerByStep = new Map(lower.points.map((p) => [p.step, p.value]));
    const paired: { step: number; hi: number; lo: number }[] = [];
    for (const p of upper.points) {
      const lv = lowerByStep.get(p.step);
      if (lv !== undefined) paired.push({ step: p.step, hi: p.value, lo: lv });
    }
    if (paired.length < 2) return null;

    const topPts = paired.map((p) => `${xOf(p.step).toFixed(1)},${yOf(p.hi, upper.axis ?? "left").toFixed(1)}`);
    const botPts = [...paired]
      .reverse()
      .map((p) => `${xOf(p.step).toFixed(1)},${yOf(p.lo, lower.axis ?? "left").toFixed(1)}`);
    return [...topPts, ...botPts].join(" ");
  }, [shadedBand, series, minStep, maxStep, leftMin, leftMax, rightMin, rightMax]);

  const yTicks = [0, 0.5, 1];
  const xTickSteps = allSteps.length <= 1 ? allSteps : [minStep, Math.round((minStep + maxStep) / 2), maxStep];

  return (
    <ChartCard>
      <ChartHeader>
        <div>
          <ChartTitle>{title}</ChartTitle>
          {subtitle && <div style={{ fontSize: 11, color: "var(--ms-text-2, #8b949e)", marginTop: 2 }}>{subtitle}</div>}
        </div>
        <LegendRow>
          {series.map((s) => (
            <LegendItem key={s.id}>
              <LegendSwatch $color={s.color} $dashed={s.dashed} />
              <span>{s.label}</span>
            </LegendItem>
          ))}
          {shadedBand && (
            <LegendItem>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: shadedBand.fill,
                  border: "1px solid rgba(248,113,113,0.45)",
                }}
              />
              <span>{shadedBand.label}</span>
            </LegendItem>
          )}
        </LegendRow>
      </ChartHeader>

      {!hasAnyData ? (
        <div
          style={{
            height: 180,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            background: "var(--ms-bg, #0d1117)",
            border: "1px dashed var(--ms-divider, #21262d)",
            fontSize: 12,
            color: "var(--ms-text-2, #8b949e)",
          }}
        >
          Awaiting telemetry steps via POST /api/v1/runs/:runUid/metrics…
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          role="img"
          aria-label={title}
          style={{
            width: "100%",
            height: "auto",
            display: "block",
            background: "var(--ms-bg, #0d1117)",
            borderRadius: 8,
            border: "1px solid var(--ms-divider, #21262d)",
          }}
        >
          {/* Horizontal grid lines + Left/Right Y tick labels */}
          {yTicks.map((t) => {
            const y = PAD_T + PLOT_H * (1 - t);
            const leftVal = leftMin + (leftMax - leftMin) * t;
            const rightVal = rightMin + (rightMax - rightMin) * t;
            return (
              <g key={t}>
                <line
                  x1={PAD_L}
                  y1={y}
                  x2={CHART_W - PAD_R}
                  y2={y}
                  stroke="rgba(148, 163, 184, 0.16)"
                  strokeDasharray="3 3"
                />
                <text x={PAD_L - 6} y={y + 3} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#8b949e">
                  {leftFormatter(leftVal)}
                </text>
                {hasRightAxis && (
                  <text
                    x={CHART_W - PAD_R + 6}
                    y={y + 3}
                    textAnchor="start"
                    fontSize="10"
                    fontFamily="monospace"
                    fill="#94a3b8"
                  >
                    {rightFormatter(rightVal)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Shaded invariance gap band */}
          {bandPolygon && shadedBand && <polygon points={bandPolygon} fill={shadedBand.fill} />}

          {/* Series paths & vertices */}
          {series.map((s) => {
            if (s.points.length === 0) return null;
            const axis = s.axis ?? "left";
            const d = s.points
              .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.step).toFixed(1)},${yOf(p.value, axis).toFixed(1)}`)
              .join(" ");
            return (
              <g key={s.id}>
                {s.points.length > 1 && (
                  <path
                    d={d}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="2.1"
                    strokeDasharray={s.dashed ? "5 4" : undefined}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
                {s.points.length <= 40 &&
                  s.points.map((p) => (
                    <circle
                      key={`${s.id}-${p.step}`}
                      cx={xOf(p.step)}
                      cy={yOf(p.value, axis)}
                      r={s.points.length === 1 ? 4 : 2.6}
                      fill={s.color}
                    >
                      <title>{`${s.label} @ step ${p.step}: ${p.value}`}</title>
                    </circle>
                  ))}
              </g>
            );
          })}

          {/* X-axis step labels */}
          {xTickSteps.map((step, idx) => (
            <text
              key={`${step}-${idx}`}
              x={xOf(step)}
              y={CHART_H - 9}
              textAnchor={idx === 0 ? "start" : idx === xTickSteps.length - 1 ? "end" : "middle"}
              fontSize="10"
              fontFamily="monospace"
              fill="#8b949e"
            >
              step {step}
            </text>
          ))}
        </svg>
      )}
    </ChartCard>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Detail View (`/runs/:runUid`)
// ─────────────────────────────────────────────────────────────────────────────

const RunDetailView: React.FC<{ runUid: string }> = ({ runUid }) => {
  const [run, setRun] = useState<TrainingRunRecord | null>(null);
  const [metrics, setMetrics] = useState<TrainingRunMetricPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);

  usePageTitle(run ? `${run.runUid} — Training Telemetry` : "Training Run Telemetry");

  const fetchRun = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await fetch(`/api/v1/runs/${encodeURIComponent(runUid)}`, {
          headers: getAuthHeaders(),
          credentials: "include",
        });
        const data = (await res.json().catch(() => ({}))) as {
          run?: TrainingRunRecord;
          metrics?: TrainingRunMetricPoint[];
          error?: string;
        };
        if (!res.ok || !data.run) {
          throw new Error(data.error || `Failed to load run (${res.status})`);
        }
        setRun(data.run);
        setMetrics(Array.isArray(data.metrics) ? data.metrics : []);
        setError(null);
        setLastUpdated(new Date().toLocaleTimeString());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [runUid],
  );

  useEffect(() => {
    void fetchRun(false);
  }, [fetchRun]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      void fetchRun(true);
    }, 3000);
    return () => window.clearInterval(id);
  }, [autoRefresh, fetchRun]);

  const handleStatusChange = useCallback(
    async (nextStatus: "paused" | "running" | "completed" | "cancelled") => {
      setStatusBusy(nextStatus);
      setStatusFeedback(null);
      try {
        const res = await fetch(`/api/v1/runs/${encodeURIComponent(runUid)}/status`, {
          method: "POST",
          headers: getAuthHeaders({ "Content-Type": "application/json" }),
          credentials: "include",
          body: JSON.stringify({ status: nextStatus }),
        });
        const data = (await res.json().catch(() => ({}))) as { run?: TrainingRunRecord; error?: string };
        if (!res.ok || !data.run) {
          throw new Error(data.error || `Status update failed (${res.status})`);
        }
        setRun(data.run);
        setStatusFeedback(`Transitioned run to '${data.run.status}'.`);
      } catch (err) {
        setStatusFeedback(err instanceof Error ? err.message : String(err));
      } finally {
        setStatusBusy(null);
      }
    },
    [runUid],
  );

  const latest = metrics.length > 0 ? metrics[metrics.length - 1] : null;
  const latestGap =
    latest && latest.worstCaseLoss !== null && latest.centerLoss !== null
      ? latest.worstCaseLoss - latest.centerLoss
      : null;

  const lossSeries = useMemo<ChartSeries[]>(
    () => [
      {
        id: "worst",
        label: "Worst-Case Loss (L_worst)",
        color: "#f87171",
        points: metrics
          .filter((m) => typeof m.worstCaseLoss === "number")
          .map((m) => ({ step: m.step, value: m.worstCaseLoss as number })),
      },
      {
        id: "center",
        label: "Center Loss (L_center)",
        color: "#38bdf8",
        points: metrics
          .filter((m) => typeof m.centerLoss === "number")
          .map((m) => ({ step: m.step, value: m.centerLoss as number })),
      },
    ],
    [metrics],
  );

  const dynamicMSeries = useMemo<ChartSeries[]>(
    () => [
      {
        id: "mActive",
        label: "m_active (left)",
        color: "#a78bfa",
        axis: "left",
        points: metrics
          .filter((m) => typeof m.mActive === "number")
          .map((m) => ({ step: m.step, value: m.mActive as number })),
      },
      {
        id: "spread",
        label: "max_spread_delta_t (right)",
        color: "#fbbf24",
        axis: "right",
        points: metrics
          .filter((m) => typeof m.maxSpreadDeltaT === "number")
          .map((m) => ({ step: m.step, value: m.maxSpreadDeltaT as number })),
      },
    ],
    [metrics],
  );

  const lifecycleSeries = useMemo<ChartSeries[]>(
    () => [
      {
        id: "pruned",
        label: "pruned_count",
        color: "#34d399",
        points: metrics.map((m) => ({ step: m.step, value: m.prunedCount })),
      },
      {
        id: "merged",
        label: "merged_count",
        color: "#38bdf8",
        points: metrics.map((m) => ({ step: m.step, value: m.mergedCount })),
      },
      {
        id: "expanded",
        label: "expanded_count",
        color: "#fbbf24",
        points: metrics.map((m) => ({ step: m.step, value: m.expandedCount })),
      },
      {
        id: "girard",
        label: "girard_cap_count",
        color: "#f472b6",
        points: metrics.map((m) => ({ step: m.step, value: m.girardCapCount })),
      },
    ],
    [metrics],
  );

  const formalSeries = useMemo<ChartSeries[]>(() => {
    const out: ChartSeries[] = [
      {
        id: "gates",
        label: "Gate 1–4 Pass Rate (left)",
        color: "#34d399",
        axis: "left",
        points: metrics
          .filter((m) => typeof m.gate1To4PassRate === "number")
          .map((m) => ({ step: m.step, value: (m.gate1To4PassRate as number) * 100 })),
      },
      {
        id: "ece",
        label: "Δ_t ECE (right)",
        color: "#fb923c",
        axis: "right",
        points: metrics.filter((m) => typeof m.ece === "number").map((m) => ({ step: m.step, value: m.ece as number })),
      },
    ];
    const recallPts = metrics
      .filter((m) => typeof m.wqRecallAtK === "number")
      .map((m) => ({ step: m.step, value: (m.wqRecallAtK as number) * 100 }));
    if (recallPts.length > 0) {
      out.push({
        id: "recall",
        label: "W_q Recall@k (left)",
        color: "#38bdf8",
        axis: "left",
        dashed: true,
        points: recallPts,
      });
    }
    return out;
  }, [metrics]);

  if (loading) return <PageContainer>Loading training run telemetry…</PageContainer>;
  if (error || !run) {
    return (
      <PageContainer>
        <NavLinkButton to="/runs">← Back to Training Runs</NavLinkButton>
        <AlertBox $tone="error" style={{ marginTop: 16 }}>
          {error || "Training run not found."}
        </AlertBox>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <NavLinkButton to="/runs">← All Training Runs</NavLinkButton>
        <NavLinkButton to="/models">Models Hub</NavLinkButton>
        <NavLinkButton to="/leaderboards">Leaderboards</NavLinkButton>
      </div>

      <HeaderRow>
        <div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <PageTitle style={{ fontFamily: "var(--ms-font-mono, monospace)", fontSize: 21 }}>{run.runUid}</PageTitle>
            <StatusBadge $status={run.status}>{run.status}</StatusBadge>
            <BackendBadge $backend={run.backend}>{run.backend}</BackendBadge>
          </div>
          <Subtitle>
            Recipe:{" "}
            <strong>
              {run.recipeName}@{run.recipeVersion}
            </strong>
            {run.modelName ? ` · Target Model: ${run.modelName}` : ""}
            {run.slurmJobId ? ` · Slurm Job #${run.slurmJobId}` : ""}
            {lastUpdated ? ` · Synced ${lastUpdated}` : ""}
          </Subtitle>
        </div>

        <ButtonRow>
          <Pill type="button" $active={autoRefresh} onClick={() => setAutoRefresh((v) => !v)}>
            {autoRefresh ? "● Live Auto-Refresh (3s)" : "○ Auto-Refresh Paused"}
          </Pill>
          <ActionButton type="button" onClick={() => void fetchRun(true)}>
            ↻ Refresh
          </ActionButton>
          <ActionButton
            type="button"
            $variant="warn"
            disabled={statusBusy !== null || run.status === "paused"}
            onClick={() => void handleStatusChange("paused")}
          >
            Pause
          </ActionButton>
          <ActionButton
            type="button"
            $variant="primary"
            disabled={statusBusy !== null || run.status === "running"}
            onClick={() => void handleStatusChange("running")}
          >
            Resume
          </ActionButton>
          <ActionButton
            type="button"
            $variant="success"
            disabled={statusBusy !== null || run.status === "completed"}
            onClick={() => void handleStatusChange("completed")}
          >
            Complete
          </ActionButton>
          <ActionButton
            type="button"
            $variant="danger"
            disabled={statusBusy !== null || run.status === "cancelled"}
            onClick={() => void handleStatusChange("cancelled")}
          >
            Cancel
          </ActionButton>
        </ButtonRow>
      </HeaderRow>

      {statusFeedback && <AlertBox $tone="info">{statusFeedback}</AlertBox>}

      {/* KPI Summary Strip */}
      <KpiGrid>
        <KpiTile>
          <KpiLabel>Latest Step</KpiLabel>
          <KpiValue>{latest ? latest.step : "—"}</KpiValue>
        </KpiTile>
        <KpiTile>
          <KpiLabel>Invariance Gap</KpiLabel>
          <KpiValue style={{ color: latestGap !== null && latestGap < 0.2 ? "#34d399" : "#fbbf24" }}>
            {fmtNum(latestGap, 4)}
          </KpiValue>
        </KpiTile>
        <KpiTile>
          <KpiLabel>Active m</KpiLabel>
          <KpiValue style={{ color: "#a78bfa" }}>{latest?.mActive ?? "—"}</KpiValue>
        </KpiTile>
        <KpiTile>
          <KpiLabel>Max Δ_t Spread</KpiLabel>
          <KpiValue style={{ color: "#fbbf24" }}>{fmtNum(latest?.maxSpreadDeltaT, 4)}</KpiValue>
        </KpiTile>
        <KpiTile>
          <KpiLabel>Gate 1–4 Pass</KpiLabel>
          <KpiValue style={{ color: "#34d399" }}>{fmtPct(latest?.gate1To4PassRate)}</KpiValue>
        </KpiTile>
        <KpiTile>
          <KpiLabel>Δ_t ECE</KpiLabel>
          <KpiValue style={{ color: "#fb923c" }}>{fmtNum(latest?.ece, 4)}</KpiValue>
        </KpiTile>
      </KpiGrid>

      {/* 4 Zero-Dependency Inline SVG Telemetry Charts */}
      <ChartsGrid>
        <SvgTimeSeriesChart
          title="Center Loss vs. Worst-Case Boundary Loss"
          subtitle="Shaded region highlights the certified invariance gap (L_worst − L_center)"
          series={lossSeries}
          shadedBand={{
            upperSeriesId: "worst",
            lowerSeriesId: "center",
            fill: "rgba(248, 113, 113, 0.16)",
            label: "Invariance Gap (L_worst − L_center)",
          }}
          leftDomainMin={0}
          leftFormatter={(v) => v.toFixed(2)}
        />

        <SvgTimeSeriesChart
          title="Dynamic-m Elastic Profile"
          subtitle="Active generator budget m_active ramp vs. worst-case logit spread max_spread_delta_t"
          series={dynamicMSeries}
          leftDomainMin={0}
          rightDomainMin={0}
          leftFormatter={(v) => `m=${Math.round(v)}`}
          rightFormatter={(v) => v.toFixed(2)}
        />

        <SvgTimeSeriesChart
          title="Generator Lifecycle Telemetry"
          subtitle="Per-step pruned, merged, expanded, and Girard-capped zonotope generators"
          series={lifecycleSeries}
          leftDomainMin={0}
          leftFormatter={(v) => String(Math.round(v))}
        />

        <SvgTimeSeriesChart
          title="Formal Gate 1–4 Pass Rate & Δ_t ECE Calibration"
          subtitle="Formal verification pass rate (%) vs. uncertainty calibration ECE"
          series={formalSeries}
          leftDomainMin={0}
          leftDomainMax={100}
          rightDomainMin={0}
          leftFormatter={(v) => `${Math.round(v)}%`}
          rightFormatter={(v) => v.toFixed(3)}
        />
      </ChartsGrid>

      {/* Run Config & Recent Telemetry Table */}
      <SectionCard>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700 }}>Run Metadata &amp; Hyperparameters</div>
          <div style={{ fontSize: 12, color: "var(--ms-text-2, #8b949e)", fontFamily: "monospace" }}>
            Shards: {run.shardIds.length > 0 ? run.shardIds.join(", ") : "none"}
            {run.latestCheckpointKey ? ` · Checkpoint: ${run.latestCheckpointKey}` : ""}
          </div>
        </div>
        <pre
          style={{
            margin: 0,
            padding: 10,
            borderRadius: 8,
            background: "var(--ms-bg, #0d1117)",
            fontSize: 11,
            overflowX: "auto",
          }}
        >
          {JSON.stringify(run.hyperparams, null, 2)}
        </pre>
      </SectionCard>

      {metrics.length > 0 && (
        <SectionCard>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
            Recent Telemetry Steps ({metrics.length} recorded)
          </div>
          <div style={{ overflowX: "auto" }}>
            <RunsTable>
              <thead>
                <tr>
                  <th>Step</th>
                  <th>L_center</th>
                  <th>L_worst</th>
                  <th>Gap</th>
                  <th>m_active</th>
                  <th>max Δ_t</th>
                  <th>P / M / E / G</th>
                  <th>Gate 1–4</th>
                  <th>ECE</th>
                </tr>
              </thead>
              <tbody style={{ fontFamily: "var(--ms-font-mono, monospace)", fontSize: 12 }}>
                {metrics
                  .slice(-15)
                  .reverse()
                  .map((m) => {
                    const gap =
                      m.worstCaseLoss !== null && m.centerLoss !== null ? m.worstCaseLoss - m.centerLoss : null;
                    return (
                      <tr key={m.id}>
                        <td>{m.step}</td>
                        <td>{fmtNum(m.centerLoss, 4)}</td>
                        <td>{fmtNum(m.worstCaseLoss, 4)}</td>
                        <td>{fmtNum(gap, 4)}</td>
                        <td>{m.mActive ?? "—"}</td>
                        <td>{fmtNum(m.maxSpreadDeltaT, 4)}</td>
                        <td>
                          {m.prunedCount}/{m.mergedCount}/{m.expandedCount}/{m.girardCapCount}
                        </td>
                        <td>{fmtPct(m.gate1To4PassRate)}</td>
                        <td>{fmtNum(m.ece, 4)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </RunsTable>
          </div>
        </SectionCard>
      )}
    </PageContainer>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// List View (`/runs`) + Launch Tracked Run Quick Form
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_FILTERS: ("all" | TrainingRunStatus)[] = [
  "all",
  "running",
  "queued",
  "paused",
  "completed",
  "failed",
  "cancelled",
];
const BACKEND_FILTERS: ("all" | TrainingRunBackend)[] = ["all", "webgpu", "pytorch", "slurm"];

export const TrainingRunsPage: React.FC = () => {
  const { runUid } = useParams<{ runUid?: string }>();
  const navigate = useNavigate();

  const [runs, setRuns] = useState<TrainingRunRecord[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | TrainingRunStatus>("all");
  const [backendFilter, setBackendFilter] = useState<"all" | TrainingRunBackend>("all");

  // Launch Tracked Run quick form
  const [showLaunch, setShowLaunch] = useState(false);
  const [recipeName, setRecipeName] = useState("modelica-dynamic-m-sft");
  const [recipeVersion, setRecipeVersion] = useState("0.1.0");
  const [modelName, setModelName] = useState("");
  const [backend, setBackend] = useState<TrainingRunBackend>("webgpu");
  const [initialStatus, setInitialStatus] = useState<"queued" | "running">("running");
  const [slurmJobId, setSlurmJobId] = useState("");
  const [shardIdsText, setShardIdsText] = useState("");
  const [mMax, setMMax] = useState("16");
  const [epsilon, setEpsilon] = useState("0.08");
  const [learningRate, setLearningRate] = useState("1e-4");
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const isDetail = Boolean(runUid);
  usePageTitle(isDetail ? `Run ${runUid}` : "Training Runs — Dynamic-m Telemetry");

  const fetchRuns = useCallback(async () => {
    if (isDetail) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (backendFilter !== "all") qs.set("backend", backendFilter);
      const url = `/api/v1/runs${qs.toString() ? `?${qs.toString()}` : ""}`;
      const res = await fetch(url, { headers: getAuthHeaders(), credentials: "include" });
      const data = (await res.json().catch(() => ({}))) as {
        runs?: TrainingRunRecord[];
        total?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || `Failed to load runs (${res.status})`);
      }
      setRuns(Array.isArray(data.runs) ? data.runs : []);
      setTotal(typeof data.total === "number" ? data.total : (data.runs?.length ?? 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isDetail, statusFilter, backendFilter]);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  const handleLaunchRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setLaunching(true);
    setLaunchError(null);
    try {
      const shardIds = shardIdsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch("/api/v1/runs", {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        credentials: "include",
        body: JSON.stringify({
          recipeName: recipeName.trim(),
          recipeVersion: recipeVersion.trim() || "0.1.0",
          modelName: modelName.trim() || undefined,
          backend,
          status: initialStatus,
          slurmJobId: backend === "slurm" && slurmJobId.trim() ? slurmJobId.trim() : undefined,
          shardIds,
          hyperparams: {
            mMax: Number(mMax) || 16,
            epsilon: Number(epsilon) || 0.08,
            learningRate: Number(learningRate) || 1e-4,
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { run?: TrainingRunRecord; error?: string };
      if (!res.ok || !data.run) {
        throw new Error(data.error || `Failed to launch run (${res.status})`);
      }
      navigate(`/runs/${encodeURIComponent(data.run.runUid)}`);
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
  };

  if (runUid) {
    return <RunDetailView runUid={runUid} />;
  }

  return (
    <PageContainer>
      <HeaderRow>
        <div>
          <PageTitle>Live Training Runs</PageTitle>
          <Subtitle>
            Dynamic-m zonotope invariance telemetry across WebGPU, PyTorch, and Slurm HPC ({total} runs)
          </Subtitle>
        </div>
        <ButtonRow>
          <NavLinkButton to="/models">Models Hub</NavLinkButton>
          <NavLinkButton to="/leaderboards">Leaderboards</NavLinkButton>
          <ActionButton type="button" $variant="primary" onClick={() => setShowLaunch((v) => !v)}>
            {showLaunch ? "Hide Launch Form" : "+ Launch Tracked Run"}
          </ActionButton>
        </ButtonRow>
      </HeaderRow>

      {showLaunch && (
        <SectionCard>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Launch Tracked Training Run</div>
          <form onSubmit={handleLaunchRun} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <FormGrid>
              <FieldLabel>
                Recipe Name *
                <Input required value={recipeName} onChange={(e) => setRecipeName(e.target.value)} />
              </FieldLabel>
              <FieldLabel>
                Recipe Version
                <Input value={recipeVersion} onChange={(e) => setRecipeVersion(e.target.value)} />
              </FieldLabel>
              <FieldLabel>
                Target Model Name
                <Input
                  placeholder="e.g. ansatz-modelica-1.5b"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                />
              </FieldLabel>
              <FieldLabel>
                Backend *
                <Select value={backend} onChange={(e) => setBackend(e.target.value as TrainingRunBackend)}>
                  <option value="webgpu">webgpu (Browser / Local GPU)</option>
                  <option value="pytorch">pytorch (Single / Multi-GPU)</option>
                  <option value="slurm">slurm (HPC Cluster)</option>
                </Select>
              </FieldLabel>
              <FieldLabel>
                Initial Status
                <Select
                  value={initialStatus}
                  onChange={(e) => setInitialStatus(e.target.value as "queued" | "running")}
                >
                  <option value="running">running</option>
                  <option value="queued">queued</option>
                </Select>
              </FieldLabel>
              {backend === "slurm" && (
                <FieldLabel>
                  Slurm Job ID
                  <Input placeholder="e.g. 482910" value={slurmJobId} onChange={(e) => setSlurmJobId(e.target.value)} />
                </FieldLabel>
              )}
            </FormGrid>

            <FormGrid>
              <FieldLabel>
                m_max Budget
                <Input type="number" min={1} max={64} value={mMax} onChange={(e) => setMMax(e.target.value)} />
              </FieldLabel>
              <FieldLabel>
                Perturbation ε
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  max={0.5}
                  value={epsilon}
                  onChange={(e) => setEpsilon(e.target.value)}
                />
              </FieldLabel>
              <FieldLabel>
                Learning Rate
                <Input value={learningRate} onChange={(e) => setLearningRate(e.target.value)} />
              </FieldLabel>
              <FieldLabel>
                Dataset Shard IDs (comma-separated)
                <Input
                  placeholder="shard_a, shard_b"
                  value={shardIdsText}
                  onChange={(e) => setShardIdsText(e.target.value)}
                />
              </FieldLabel>
            </FormGrid>

            {launchError && <AlertBox $tone="error">{launchError}</AlertBox>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <ActionButton type="button" onClick={() => setShowLaunch(false)}>
                Cancel
              </ActionButton>
              <ActionButton type="submit" $variant="primary" disabled={launching}>
                {launching ? "Creating Run…" : "Create & Open Live Telemetry"}
              </ActionButton>
            </div>
          </form>
        </SectionCard>
      )}

      <FilterBar>
        <FilterGroup>
          <FilterLabel>Backend</FilterLabel>
          {BACKEND_FILTERS.map((b) => (
            <Pill key={b} type="button" $active={backendFilter === b} onClick={() => setBackendFilter(b)}>
              {b === "all" ? "All Backends" : b}
            </Pill>
          ))}
        </FilterGroup>
        <FilterGroup>
          <FilterLabel>Status</FilterLabel>
          {STATUS_FILTERS.map((s) => (
            <Pill key={s} type="button" $active={statusFilter === s} onClick={() => setStatusFilter(s)}>
              {s === "all" ? "All Statuses" : s}
            </Pill>
          ))}
        </FilterGroup>
      </FilterBar>

      {error && <AlertBox $tone="error">{error}</AlertBox>}

      {loading ? (
        <div style={{ padding: 24, color: "var(--ms-text-2, #8b949e)" }}>Loading training runs…</div>
      ) : runs.length === 0 ? (
        <SectionCard style={{ textAlign: "center", padding: "36px 20px" }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No training runs found</div>
          <div style={{ fontSize: 13, color: "var(--ms-text-2, #8b949e)", marginBottom: 14 }}>
            Launch a tracked WebGPU, PyTorch, or Slurm run to stream Dynamic-m invariance telemetry.
          </div>
          <ActionButton type="button" $variant="primary" onClick={() => setShowLaunch(true)}>
            + Launch Tracked Run
          </ActionButton>
        </SectionCard>
      ) : (
        <SectionCard style={{ padding: 0, overflowX: "auto" }}>
          <RunsTable>
            <thead>
              <tr>
                <th>Run UID</th>
                <th>Recipe</th>
                <th>Model</th>
                <th>Backend</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.runUid}>
                  <td style={{ fontFamily: "var(--ms-font-mono, monospace)", fontWeight: 700 }}>
                    <Link
                      to={`/runs/${encodeURIComponent(r.runUid)}`}
                      style={{ color: "var(--ms-brand, #38bdf8)", textDecoration: "none" }}
                    >
                      {r.runUid}
                    </Link>
                  </td>
                  <td style={{ fontFamily: "var(--ms-font-mono, monospace)", fontSize: 12 }}>
                    {r.recipeName}@{r.recipeVersion}
                  </td>
                  <td>{r.modelName ?? "—"}</td>
                  <td>
                    <BackendBadge $backend={r.backend}>{r.backend}</BackendBadge>
                  </td>
                  <td>
                    <StatusBadge $status={r.status}>{r.status}</StatusBadge>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--ms-text-2, #8b949e)" }}>
                    {new Date(r.updatedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </RunsTable>
        </SectionCard>
      )}
    </PageContainer>
  );
};

export default TrainingRunsPage;

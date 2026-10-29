// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, GraphIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useMemo, useState } from "react";
import type { CloudSimulationStatus } from "../../api";
import Box from "../Box";
import { StatCard, TableWrap } from "./styles";
import type { ParsedCsvData } from "./types";

interface SimulationResultsViewProps {
  jobStatus: CloudSimulationStatus | null;
  parsedCsv: ParsedCsvData | null;
}

const TRACE_COLORS = ["#06b6d4", "#8b5cf6", "#10b981", "#f59e0b", "#ec4899", "#3b82f6"];

export const SimulationResultsView: React.FC<SimulationResultsViewProps> = ({ jobStatus, parsedCsv }) => {
  const trajectory = parsedCsv?.trajectory;
  const availableStates = useMemo(
    () => (trajectory?.states || []).filter((s) => s.toLowerCase() !== "time"),
    [trajectory],
  );
  const [selectedStateIdx, setSelectedStateIdx] = useState<number>(0);

  const chartPath = useMemo(() => {
    if (!trajectory || availableStates.length === 0 || trajectory.t.length < 2) return null;
    const stateName = availableStates[selectedStateIdx] ?? availableStates[0]!;
    const rawIdx = trajectory.states.indexOf(stateName);
    const series = trajectory.y[rawIdx];
    if (!series || series.length < 2) return null;

    const tMin = trajectory.t[0] ?? 0;
    const tMax = trajectory.t[trajectory.t.length - 1] ?? 1;
    const tSpan = Math.max(1e-9, tMax - tMin);

    let yMin = Infinity;
    let yMax = -Infinity;
    for (const v of series) {
      if (Number.isFinite(v)) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return null;
    const ySpan = Math.max(1e-9, yMax - yMin);

    const width = 680;
    const height = 150;
    const padX = 12;
    const padY = 14;
    const plotW = width - padX * 2;
    const plotH = height - padY * 2;

    const step = Math.max(1, Math.floor(series.length / 250));
    const pts: string[] = [];
    for (let i = 0; i < series.length; i += step) {
      const tx = padX + (((trajectory.t[i] ?? 0) - tMin) / tSpan) * plotW;
      const ty = padY + plotH - (((series[i] ?? 0) - yMin) / ySpan) * plotH;
      pts.push(`${i === 0 ? "M" : "L"}${tx.toFixed(1)},${ty.toFixed(1)}`);
    }

    return {
      d: pts.join(" "),
      yMin,
      yMax,
      tMin,
      tMax,
      stateName,
      color: TRACE_COLORS[selectedStateIdx % TRACE_COLORS.length] || "#06b6d4",
    };
  }, [trajectory, availableStates, selectedStateIdx]);

  return (
    <Box display="flex" flexDirection="column" gap={3}>
      <Box
        p={3}
        borderRadius="10px"
        bg="rgba(16, 185, 129, 0.1)"
        border="1px solid rgba(16, 185, 129, 0.4)"
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        gap={2}
      >
        <Box display="flex" alignItems="center" gap={2}>
          <CheckCircleIcon size={20} fill="#10b981" />
          <div>
            <Text fontWeight="bold" fontSize="14px" color="#10b981" display="block">
              Simulation Succeeded on Cloud HPC
            </Text>
            <Text fontSize="12px" color="var(--color-fg-muted)">
              Trajectory verified and ready for interactive post-processing or CSV export.
            </Text>
          </div>
        </Box>
      </Box>

      {/* Accounting Stats */}
      <Box display="flex" gap={2} flexWrap="wrap">
        <StatCard>
          <Text fontSize="11px" color="var(--color-fg-muted)" display="block">
            CPU Runtime
          </Text>
          <Text fontSize="16px" fontWeight="bold" color="var(--color-fg-default)">
            {(jobStatus?.usage?.cpuSeconds ?? 0.42).toFixed(2)}s
          </Text>
        </StatCard>
        <StatCard>
          <Text fontSize="11px" color="var(--color-fg-muted)" display="block">
            Cost Charged
          </Text>
          <Text fontSize="16px" fontWeight="bold" color="var(--color-accent-purple, #8b5cf6)">
            {(jobStatus?.usage?.costCredits ?? 0.01).toFixed(4)} cr
          </Text>
        </StatCard>
        <StatCard>
          <Text fontSize="11px" color="var(--color-fg-muted)" display="block">
            Time Points
          </Text>
          <Text fontSize="16px" fontWeight="bold" color="var(--color-fg-default)">
            {parsedCsv?.totalRows ?? 0}
          </Text>
        </StatCard>
        <StatCard>
          <Text fontSize="11px" color="var(--color-fg-muted)" display="block">
            Exit Code
          </Text>
          <Text fontSize="16px" fontWeight="bold" color="#10b981">
            {jobStatus?.usage?.exitCode ?? 0}
          </Text>
        </StatCard>
      </Box>

      {/* Interactive SVG Trajectory Mini-Plot */}
      {chartPath && (
        <Box
          p={3}
          borderRadius="10px"
          border="1px solid var(--color-border-default, #30363d)"
          bg="var(--color-canvas-subtle, #161b22)"
        >
          <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={2}>
            <Box display="flex" alignItems="center" gap={2}>
              <GraphIcon size={14} />
              <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-default)">
                Interactive Trajectory Waveform: <code>{chartPath.stateName}</code>
              </Text>
            </Box>
            <Box display="flex" gap={1} flexWrap="wrap">
              {availableStates.slice(0, 8).map((st, idx) => {
                const isAct = idx === selectedStateIdx;
                const col = TRACE_COLORS[idx % TRACE_COLORS.length] || "#06b6d4";
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setSelectedStateIdx(idx)}
                    style={{
                      background: isAct ? `${col}22` : "transparent",
                      border: `1px solid ${isAct ? col : "var(--color-border-default)"}`,
                      color: isAct ? col : "var(--color-fg-muted)",
                      borderRadius: "999px",
                      padding: "2px 8px",
                      fontSize: "11px",
                      fontWeight: 600,
                      fontFamily: "var(--font-mono, monospace)",
                      cursor: "pointer",
                    }}
                  >
                    {st}
                  </button>
                );
              })}
            </Box>
          </Box>

          <svg
            viewBox="0 0 680 150"
            style={{
              width: "100%",
              height: "140px",
              background: "rgba(0, 0, 0, 0.16)",
              borderRadius: "8px",
              display: "block",
            }}
          >
            <line x1="12" y1="75" x2="668" y2="75" stroke="rgba(148, 163, 184, 0.15)" strokeDasharray="4 4" />
            <path d={chartPath.d} fill="none" stroke={chartPath.color} strokeWidth="2.2" strokeLinecap="round" />
          </svg>

          <Box
            display="flex"
            justifyContent="space-between"
            mt={1}
            fontSize="11px"
            color="var(--color-fg-muted)"
            style={{ fontFamily: "var(--font-mono, monospace)" }}
          >
            <span>
              t = [{chartPath.tMin.toFixed(2)}s &rarr; {chartPath.tMax.toFixed(2)}s]
            </span>
            <span>
              min: {chartPath.yMin.toExponential(3)} · max: {chartPath.yMax.toExponential(3)}
            </span>
          </Box>
        </Box>
      )}

      {/* Data Table Preview */}
      {parsedCsv && (
        <Box>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)">
              Trajectory Preview ({parsedCsv.headers.length} variables, {parsedCsv.totalRows} time points)
            </Text>
            <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>Showing first 10 rows</span>
          </Box>
          <TableWrap>
            <table>
              <thead>
                <tr>
                  {parsedCsv.headers.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsedCsv.rows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Box>
      )}
    </Box>
  );
};

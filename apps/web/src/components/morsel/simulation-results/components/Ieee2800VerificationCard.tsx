// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Ieee2800ComplianceReport } from "@modelscript/pscad";
import {
  AlertIcon,
  CheckCircleFillIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  ShieldCheckIcon,
  XCircleFillIcon,
  XIcon,
} from "@primer/octicons-react";
import React, { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import styled from "styled-components";

export interface Ieee2800VerificationCardProps {
  report?: Ieee2800ComplianceReport | null | undefined;
  data?: Record<string, number | string>[] | undefined;
  onClose?: (() => void) | undefined;
  onExportJson?: (() => void) | undefined;
  colorMode?: "light" | "dark" | undefined;
}

const CardContainer = styled.div<{ $isDark: boolean }>`
  border: 1px solid var(--color-border-default, ${(p) => (p.$isDark ? "#30363d" : "#d0d7de")});
  border-radius: 10px;
  background: var(--bgColor-inset, ${(p) => (p.$isDark ? "#121214" : "#f6f8fa")});
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  font-family: inherit;
  margin-top: 8px;
`;

const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
`;

const TitleGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const Badge = styled.span<{ $status: "PASS" | "FAIL" | "WARN" }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: #ffffff;
  background: ${(p) =>
    p.$status === "PASS"
      ? "var(--color-success-emphasis, #238636)"
      : p.$status === "FAIL"
        ? "var(--color-danger-emphasis, #da3633)"
        : "var(--color-attention-emphasis, #9a6700)"};
`;

const ActionButtons = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ActionBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--color-border-default, #30363d);
  background: var(--bgColor-muted, var(--ms-bg-elv));
  color: var(--color-fg-default, #c9d1d9);
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: var(--color-canvas-subtle, #21262d);
  }
`;

const ClauseGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const ClauseRow = styled.div<{ $status: "PASS" | "FAIL" | "WARN"; $expanded: boolean }>`
  display: flex;
  flex-direction: column;
  border: 1px solid
    ${(p) =>
      p.$status === "FAIL" ? "rgba(218, 54, 51, 0.4)" : "var(--color-border-subtle, rgba(255, 255, 255, 0.08))"};
  border-radius: 6px;
  background: var(--bgColor-muted, var(--ms-bg-elv));
  overflow: hidden;
  transition: border-color 0.15s ease;
`;

const ClauseSummaryBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  font-size: 13px;

  &:hover {
    background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.03));
  }
`;

const ClauseInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
`;

const ClauseNumber = styled.span`
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 600;
  color: var(--fgColor-accent, var(--ms-brand));
  background: var(--ms-brand-soft);
  padding: 2px 6px;
  border-radius: 4px;
`;

const ClauseTitle = styled.span`
  font-weight: 600;
  color: var(--color-fg-default, #c9d1d9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const MetricComparison = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
  color: var(--color-fg-muted, #8b949e);
  margin-right: 12px;
`;

const ClauseDetailBox = styled.div`
  padding: 10px 14px;
  font-size: 12px;
  color: var(--color-fg-muted, #8b949e);
  border-top: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.06));
  background: var(--color-canvas-subtle, rgba(0, 0, 0, 0.15));
  line-height: 1.5;
`;

const ChartBox = styled.div`
  margin-top: 6px;
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 8px;
  background: var(--bgColor-muted, var(--ms-bg-elv));
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ChartTitle = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-fg-default, #c9d1d9);
`;

const ChartLegend = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 11px;
  color: var(--color-fg-muted, #8b949e);
`;

const LegendItem = styled.div<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  &::before {
    content: "";
    width: 10px;
    height: 10px;
    border-radius: 2px;
    background: ${(p) => p.$color};
  }
`;

export const Ieee2800VerificationCard: React.FC<Ieee2800VerificationCardProps> = ({
  report,
  data,
  onClose,
  onExportJson,
  colorMode = "dark",
}) => {
  const isDark = colorMode === "dark";
  const [expandedClauses, setExpandedClauses] = useState<Set<string>>(new Set());

  const activeReport = useMemo<Ieee2800ComplianceReport | null>(() => {
    if (report) return report;
    return null;
  }, [report]);

  const toggleClause = (clause: string) => {
    setExpandedClauses((prev) => {
      const next = new Set(prev);
      if (next.has(clause)) next.delete(clause);
      else next.add(clause);
      return next;
    });
  };

  // Prepare chart data for VRT envelope
  const chartData = useMemo(() => {
    if (data && data.length > 0) {
      return data.slice(0, 150).map((row, idx) => {
        const t = Number(row["time"] ?? idx * 0.01);
        const v = Number(row["vPoi"] ?? row["v1"] ?? row["v_a"] ?? 1.0);
        return {
          time: Number(t.toFixed(3)),
          vPoi: Number(v.toFixed(3)),
          noTripLimit: t >= 0.1 && t <= 0.26 ? 0.05 : 0.88,
        };
      });
    }

    // Fallback sample sag curve
    return Array.from({ length: 60 }, (_, i) => {
      const t = i * 0.02;
      let v = 1.0;
      if (t >= 0.1 && t <= 0.25) v = 0.08 + 0.04 * Math.sin(t * 50);
      else if (t > 0.25 && t <= 0.4) v = 0.75 + (t - 0.25) * 1.5;
      return {
        time: Number(t.toFixed(3)),
        vPoi: Number(v.toFixed(3)),
        noTripLimit: t >= 0.1 && t <= 0.26 ? 0.05 : 0.88,
      };
    });
  }, [data]);

  if (!activeReport) {
    return (
      <CardContainer $isDark={isDark} data-testid="ieee2800-verification-card">
        <HeaderRow>
          <TitleGroup>
            <ShieldCheckIcon size={20} fill={isDark ? "#8b949e" : "#57606a"} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: isDark ? "#ffffff" : "#24292f" }}>
                IEEE 2800-2022 & NERC PRC-029-1 Grid Code Verification
              </div>
              <div style={{ fontSize: 11, color: isDark ? "#8b949e" : "#57606a" }}>
                No backend IEEE 2800 compliance evaluation report was generated for this simulation run.
              </div>
            </div>
          </TitleGroup>
          {onClose && (
            <ActionButtons>
              <ActionBtn type="button" onClick={onClose} title="Dismiss Verification Card">
                <XIcon size={14} />
              </ActionBtn>
            </ActionButtons>
          )}
        </HeaderRow>
      </CardContainer>
    );
  }

  const handleExport = () => {
    if (onExportJson) {
      onExportJson();
      return;
    }
    const jsonStr = JSON.stringify(activeReport, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `IEEE_2800_Compliance_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportHtml = () => {
    const rowsHtml = activeReport.checks
      .map(
        (c) =>
          `<tr><td><code>${c.clause}</code></td><td>${c.title}</td><td><strong>${c.status}</strong></td><td>${c.measuredValue}</td><td>${(c as { requiredLimit?: string; requiredThreshold?: string }).requiredLimit ?? (c as { requiredThreshold?: string }).requiredThreshold ?? ""}</td><td>${c.details}</td></tr>`,
      )
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>IEEE 2800 Compliance - ${activeReport.projectName}</title><style>body{font-family:system-ui,sans-serif;background:#0d1117;color:#c9d1d9;padding:24px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #30363d;padding:8px;text-align:left;font-size:13px}th{background:#161b22}</style></head><body><h1>IEEE 2800-2022 & NERC PRC-029-1 Compliance Report</h1><p>Project: <strong>${activeReport.projectName}</strong> | Status: <strong>${activeReport.overallStatus}</strong> | Evaluated: ${activeReport.evaluatedAt}</p><p>${activeReport.summary}</p><table><thead><tr><th>Clause</th><th>Requirement</th><th>Status</th><th>Measured</th><th>Threshold</th><th>Details</th></tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `IEEE_2800_Compliance_${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <CardContainer $isDark={isDark} data-testid="ieee2800-verification-card">
      <HeaderRow>
        <TitleGroup>
          <ShieldCheckIcon size={20} fill={activeReport.overallStatus === "PASS" ? "#3fb950" : "#f85149"} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: isDark ? "#ffffff" : "#24292f" }}>
              IEEE 2800-2022 & NERC PRC-029-1 Grid Code Verification
            </div>
            <div style={{ fontSize: 11, color: isDark ? "#8b949e" : "#57606a" }}>
              {activeReport.projectName} · Evaluated: {new Date(activeReport.evaluatedAt).toLocaleTimeString()}
            </div>
          </div>
          <Badge $status={activeReport.overallStatus}>
            {activeReport.overallStatus === "PASS" ? <CheckIcon size={14} /> : <XIcon size={14} />}
            {activeReport.overallStatus}
          </Badge>
        </TitleGroup>

        <ActionButtons>
          <ActionBtn type="button" onClick={handleExport} title="Download JSON Compliance Report">
            <DownloadIcon size={14} /> Export JSON
          </ActionBtn>
          <ActionBtn type="button" onClick={handleExportHtml} title="Download Standalone HTML Compliance Report">
            <DownloadIcon size={14} /> Export HTML
          </ActionBtn>
          {onClose && (
            <ActionBtn type="button" onClick={onClose} title="Dismiss Verification Card">
              <XIcon size={14} />
            </ActionBtn>
          )}
        </ActionButtons>
      </HeaderRow>

      {/* Ride-Through Envelope Plot */}
      <ChartBox>
        <ChartTitle>
          <span>Clause 7.2.2.1 Voltage Ride-Through (VRT) Trajectory vs Mandatory No-Trip Limit</span>
          <ChartLegend>
            <LegendItem $color="#58a6ff">POI Voltage (V1)</LegendItem>
            <LegendItem $color="#f85149">NERC No-Trip Boundary</LegendItem>
          </ChartLegend>
        </ChartTitle>
        <div style={{ width: "100%", height: 160 }}>
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 160 }}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#30363d" : "#e1e4e8"} />
              <XAxis dataKey="time" stroke={isDark ? "#8b949e" : "#57606a"} tick={{ fontSize: 10 }} unit="s" />
              <YAxis stroke={isDark ? "#8b949e" : "#57606a"} tick={{ fontSize: 10 }} domain={[0, 1.4]} unit="pu" />
              <Tooltip
                contentStyle={{
                  background: isDark ? "#1e1e22" : "#ffffff",
                  borderColor: isDark ? "#30363d" : "#d0d7de",
                  fontSize: 11,
                }}
              />
              <ReferenceArea y1={0.0} y2={0.05} fill="#f85149" fillOpacity={0.12} />
              <ReferenceLine
                y={1.2}
                stroke="#da3633"
                strokeDasharray="4 4"
                label={{ value: "HVRT Limit (1.20 pu)", fill: "#da3633", fontSize: 9 }}
              />
              <Line
                type="monotone"
                dataKey="vPoi"
                stroke="#58a6ff"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="stepAfter"
                dataKey="noTripLimit"
                stroke="#f85149"
                strokeWidth={1.5}
                strokeDasharray="3 3"
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartBox>

      {/* Clause Breakdown Table */}
      <ClauseGrid>
        {activeReport.checks.map((chk) => {
          const isExpanded = expandedClauses.has(chk.clause);
          return (
            <ClauseRow key={chk.clause} $status={chk.status} $expanded={isExpanded}>
              <ClauseSummaryBar onClick={() => toggleClause(chk.clause)}>
                <ClauseInfo>
                  <ClauseNumber>Clause {chk.clause}</ClauseNumber>
                  <ClauseTitle>{chk.title}</ClauseTitle>
                </ClauseInfo>
                <MetricComparison>
                  <span>
                    Measured: <strong style={{ color: isDark ? "#ffffff" : "#24292f" }}>{chk.measuredValue}</strong>
                  </span>
                  <span>Limit: {chk.requiredLimit}</span>
                </MetricComparison>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Badge $status={chk.status}>
                    {chk.status === "PASS" ? (
                      <CheckCircleFillIcon size={12} />
                    ) : chk.status === "FAIL" ? (
                      <XCircleFillIcon size={12} />
                    ) : (
                      <AlertIcon size={12} />
                    )}
                    {chk.status}
                  </Badge>
                  {isExpanded ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
                </div>
              </ClauseSummaryBar>
              {isExpanded && <ClauseDetailBox>{chk.details}</ClauseDetailBox>}
            </ClauseRow>
          );
        })}
      </ClauseGrid>
    </CardContainer>
  );
};

export default Ieee2800VerificationCard;

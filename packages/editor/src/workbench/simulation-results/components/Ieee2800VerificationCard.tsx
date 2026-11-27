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
import {
  ActionBtn,
  ActionButtons,
  CardContainer,
  type ComplianceTone,
  ExpandableHeader,
  ExpandableRow,
  HeaderRow,
  StatusPill,
  TitleGroup,
} from "./ComplianceCardPrimitives";

export interface Ieee2800VerificationCardProps {
  report?: Ieee2800ComplianceReport | null | undefined;
  data?: Record<string, number | string>[] | undefined;
  onClose?: (() => void) | undefined;
  onExportJson?: (() => void) | undefined;
  colorMode?: "light" | "dark" | undefined;
}

const statusToTone = (status: "PASS" | "FAIL" | "WARN"): ComplianceTone =>
  status === "PASS" ? "success" : status === "FAIL" ? "danger" : "warning";

const ChartLegendItem: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
    <span
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: 2,
        background: color,
      }}
    />
    {children}
  </div>
);

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
      <CardContainer isDark={isDark} data-testid="ieee2800-verification-card">
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
              <ActionBtn isDark={isDark} onClick={onClose} title="Dismiss Verification Card">
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
    <CardContainer isDark={isDark} data-testid="ieee2800-verification-card">
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
          <StatusPill tone={statusToTone(activeReport.overallStatus)}>
            {activeReport.overallStatus === "PASS" ? <CheckIcon size={14} /> : <XIcon size={14} />}
            {activeReport.overallStatus}
          </StatusPill>
        </TitleGroup>

        <ActionButtons>
          <ActionBtn isDark={isDark} onClick={handleExport} title="Download JSON Compliance Report">
            <DownloadIcon size={14} /> Export JSON
          </ActionBtn>
          <ActionBtn isDark={isDark} onClick={handleExportHtml} title="Download Standalone HTML Compliance Report">
            <DownloadIcon size={14} /> Export HTML
          </ActionBtn>
          {onClose && (
            <ActionBtn isDark={isDark} onClick={onClose} title="Dismiss Verification Card">
              <XIcon size={14} />
            </ActionBtn>
          )}
        </ActionButtons>
      </HeaderRow>

      {/* Ride-Through Envelope Plot */}
      <div
        style={{
          marginTop: 6,
          border: `1px solid var(--ms-border, var(--color-border-default, ${isDark ? "#30363d" : "#d0d7de"}))`,
          borderRadius: 8,
          background: "var(--ms-bg-elv, var(--bgColor-muted, #1e1e22))",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--ms-text, var(--color-fg-default, #c9d1d9))",
          }}
        >
          <span>Clause 7.2.2.1 Voltage Ride-Through (VRT) Trajectory vs Mandatory No-Trip Limit</span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 11,
              color: "var(--ms-text-2, var(--color-fg-muted, #8b949e))",
            }}
          >
            <ChartLegendItem color="#58a6ff">POI Voltage (V1)</ChartLegendItem>
            <ChartLegendItem color="#f85149">NERC No-Trip Boundary</ChartLegendItem>
          </div>
        </div>
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
      </div>

      {/* Clause Breakdown Table */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {activeReport.checks.map((chk) => {
          const isExpanded = expandedClauses.has(chk.clause);
          return (
            <ExpandableRow key={chk.clause} status={chk.status}>
              <ExpandableHeader
                onClick={() => toggleClause(chk.clause)}
                style={{ padding: "8px 12px", fontSize: 13 }}
                hoverBackground="var(--ms-bg-hover, var(--color-canvas-subtle, rgba(255, 255, 255, 0.03)))"
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      fontFamily: "var(--ms-font-mono, var(--font-mono, monospace))",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--ms-brand, var(--fgColor-accent, #58a6ff))",
                      background: "var(--ms-brand-soft, rgba(88, 166, 255, 0.12))",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    Clause {chk.clause}
                  </span>
                  <span
                    style={{
                      fontWeight: 600,
                      color: "var(--ms-text, var(--color-fg-default, #c9d1d9))",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {chk.title}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    fontSize: 12,
                    color: "var(--ms-text-2, var(--color-fg-muted, #8b949e))",
                    marginRight: 12,
                  }}
                >
                  <span>
                    Measured: <strong style={{ color: isDark ? "#ffffff" : "#24292f" }}>{chk.measuredValue}</strong>
                  </span>
                  <span>Limit: {chk.requiredLimit}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <StatusPill tone={statusToTone(chk.status)}>
                    {chk.status === "PASS" ? (
                      <CheckCircleFillIcon size={12} />
                    ) : chk.status === "FAIL" ? (
                      <XCircleFillIcon size={12} />
                    ) : (
                      <AlertIcon size={12} />
                    )}
                    {chk.status}
                  </StatusPill>
                  {isExpanded ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
                </div>
              </ExpandableHeader>
              {isExpanded && (
                <div
                  style={{
                    padding: "10px 14px",
                    fontSize: 12,
                    color: "var(--ms-text-2, var(--color-fg-muted, #8b949e))",
                    borderTop:
                      "1px solid var(--ms-border-subtle, var(--color-border-subtle, rgba(255, 255, 255, 0.06)))",
                    background: "var(--ms-bg-subtle, var(--color-canvas-subtle, rgba(0, 0, 0, 0.15)))",
                    lineHeight: 1.5,
                  }}
                >
                  {chk.details}
                </div>
              )}
            </ExpandableRow>
          );
        })}
      </div>
    </CardContainer>
  );
};

export default Ieee2800VerificationCard;

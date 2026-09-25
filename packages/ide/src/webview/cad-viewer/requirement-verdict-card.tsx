// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";

export interface RequirementVerdictPayload {
  contractId: string;
  metricName: string;
  actualValue: number;
  threshold: number;
  operator: string;
  unit?: string;
  isSatisfied: boolean;
  marginPercent: number;
  sysmlRequirementId?: string;
  hypergraphThreadId?: number;
}

export interface RequirementVerdictCardProps {
  verdict?: RequirementVerdictPayload;
  onNavigateToRequirement?: (reqId: string) => void;
}

export const RequirementVerdictCard: React.FC<RequirementVerdictCardProps> = ({ verdict, onNavigateToRequirement }) => {
  if (!verdict) return null;

  const isPass = verdict.isSatisfied;
  const statusColor = isPass ? "#10b981" : "#ef4444";
  const bgGradient = isPass ? "rgba(6, 78, 59, 0.85)" : "rgba(127, 29, 29, 0.85)";

  const unitStr = verdict.unit ? ` ${verdict.unit}` : "";

  return (
    <div
      style={{
        position: "absolute",
        top: "16px",
        right: "16px",
        minWidth: "260px",
        maxWidth: "340px",
        background: bgGradient,
        backdropFilter: "blur(14px)",
        border: `1px solid ${statusColor}`,
        borderRadius: "10px",
        padding: "12px 14px",
        color: "#f8fafc",
        fontFamily: "system-ui, -apple-system, sans-serif",
        boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
        zIndex: 40,
        fontSize: "12px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "14px" }}>{isPass ? "✅" : "⚠️"}</span>
          <span style={{ fontWeight: 700, fontSize: "13px", color: isPass ? "#34d399" : "#f87171" }}>
            {isPass ? "Contract Verified" : "Contract Violated"}
          </span>
        </div>
        {verdict.hypergraphThreadId !== undefined && (
          <span
            style={{
              fontSize: "10px",
              fontFamily: "monospace",
              background: "rgba(0,0,0,0.4)",
              padding: "2px 6px",
              borderRadius: "4px",
              color: "#94a3b8",
            }}
          >
            Thread #{verdict.hypergraphThreadId}
          </span>
        )}
      </div>

      <div style={{ marginBottom: "6px" }}>
        <span style={{ color: "#cbd5e1", fontSize: "11px" }}>Requirement: </span>
        <span
          onClick={() => verdict.sysmlRequirementId && onNavigateToRequirement?.(verdict.sysmlRequirementId)}
          style={{
            fontWeight: 600,
            color: "#60a5fa",
            cursor: verdict.sysmlRequirementId ? "pointer" : "default",
            textDecoration: verdict.sysmlRequirementId ? "underline" : "none",
          }}
        >
          {verdict.sysmlRequirementId ?? verdict.contractId}
        </span>
      </div>

      <div style={{ background: "rgba(0,0,0,0.25)", padding: "6px 8px", borderRadius: "6px", marginBottom: "6px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
          <span style={{ color: "#9ca3af" }}>Metric:</span>
          <span style={{ fontWeight: 600 }}>{verdict.metricName}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
          <span style={{ color: "#9ca3af" }}>Simulated Value:</span>
          <span style={{ fontWeight: 700, color: isPass ? "#f8fafc" : "#fca5a5" }}>
            {verdict.actualValue.toFixed(2)}
            {unitStr}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "#9ca3af" }}>Allowable Limit:</span>
          <span style={{ fontWeight: 600 }}>
            {verdict.operator} {verdict.threshold.toFixed(2)}
            {unitStr}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
        <span style={{ color: "#94a3b8" }}>Design Margin:</span>
        <span style={{ fontWeight: 700, color: isPass ? "#34d399" : "#f87171" }}>
          {verdict.marginPercent > 0 ? "+" : ""}
          {verdict.marginPercent.toFixed(1)}%
        </span>
      </div>
    </div>
  );
};

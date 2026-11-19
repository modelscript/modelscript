// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LanguageSimulationCardProps } from "@modelscript/design-tokens/panel";
import { PanelButton, PanelKpiStrip } from "@modelscript/design-tokens/panel";
import React, { useState } from "react";

interface GenericWaterCheck {
  section?: string | undefined;
  category?: string | undefined;
  name?: string | undefined;
  status: "PASS" | "FAIL" | "WARN";
  details?: string | undefined;
}

interface GenericWaterReport {
  utilityName?: string | undefined;
  standard?: string | undefined;
  overallStatus?: "PASS" | "FAIL" | "WARN" | undefined;
  resilienceScore?: number | undefined;
  ili?: number | undefined;
  p90LeadPpb?: number | undefined;
  checks?: GenericWaterCheck[] | undefined;
  summary?: string | undefined;
}

export const WaterComplianceCard: React.FC<LanguageSimulationCardProps> = ({ result, colorMode, host }) => {
  const report = (result["waterComplianceReport"] ?? result["complianceReport"]) as GenericWaterReport | undefined;
  const [expanded, setExpanded] = useState(false);

  if (
    !report ||
    (!report.checks &&
      report.resilienceScore === undefined &&
      report.ili === undefined &&
      report.p90LeadPpb === undefined)
  ) {
    return null;
  }

  const checks = report.checks ?? [];
  const passed = checks.filter((c) => c.status === "PASS").length;
  const failed = checks.filter((c) => c.status === "FAIL").length;
  const overallStatus = report.overallStatus ?? (failed > 0 ? "FAIL" : "PASS");
  const isPass = overallStatus === "PASS";

  return (
    <div
      data-color-mode={colorMode}
      style={{
        border: `1px solid ${isPass ? "var(--ms-success, #3fb950)" : "var(--ms-warning, #d29922)"}`,
        borderRadius: 8,
        padding: 12,
        background: "var(--ms-bg-subtle, rgba(255,255,255,0.03))",
        color: "var(--ms-fg-default, inherit)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong style={{ fontSize: 13 }}>
            {report.standard ?? "Water Utility Compliance (AWIA / AWWA M36 / LCRI)"}
          </strong>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 12,
              background: isPass ? "rgba(63,185,80,0.15)" : "rgba(210,153,34,0.15)",
              color: isPass ? "var(--ms-success, #3fb950)" : "var(--ms-warning, #d29922)",
            }}
          >
            {overallStatus}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {host?.exportFile && (
            <PanelButton
              onClick={() =>
                host.exportFile?.("water-compliance.json", JSON.stringify(report, null, 2), "application/json")
              }
            >
              Export JSON
            </PanelButton>
          )}
          {checks.length > 0 && (
            <PanelButton onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Hide Checks" : `Checks (${checks.length})`}
            </PanelButton>
          )}
        </div>
      </div>

      <PanelKpiStrip
        items={[
          ...(report.resilienceScore !== undefined
            ? [{ label: "Resilience", value: `${report.resilienceScore.toFixed(0)}/100` }]
            : []),
          ...(report.ili !== undefined ? [{ label: "AWWA ILI", value: report.ili.toFixed(2) }] : []),
          ...(report.p90LeadPpb !== undefined
            ? [{ label: "90th % Lead", value: `${report.p90LeadPpb.toFixed(1)} ppb` }]
            : []),
          ...(checks.length > 0
            ? [
                { label: "Passed", value: passed, tone: "success" as const },
                { label: "Failed", value: failed, tone: failed > 0 ? ("danger" as const) : ("neutral" as const) },
              ]
            : []),
        ]}
      />

      {report.summary && <div style={{ fontSize: 12, opacity: 0.8 }}>{report.summary}</div>}

      {expanded && checks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto" }}>
          {checks.map((chk, idx) => (
            <div
              key={`${chk.section ?? chk.name ?? idx}-${idx}`}
              style={{
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid var(--ms-border-default, rgba(128,128,128,0.25))",
                fontSize: 12,
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div>
                <strong>{chk.section ?? chk.name ?? `Check ${idx + 1}`}</strong>
                {chk.category ? ` (${chk.category})` : ""}
                {chk.details && <div style={{ opacity: 0.75, marginTop: 2 }}>{chk.details}</div>}
              </div>
              <span style={{ fontWeight: 600 }}>{chk.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WaterComplianceCard;

// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LanguageSimulationCardProps } from "@modelscript/design-tokens/panel";
import { PanelButton, PanelKpiStrip } from "@modelscript/design-tokens/panel";
import React, { useState } from "react";

interface CsoCheck {
  controlId?: string | undefined;
  title?: string | undefined;
  status: "PASS" | "FAIL" | "WARN";
  details?: string | undefined;
}

interface CsoNpdesReport {
  permitId?: string | undefined;
  overallStatus?: "PASS" | "FAIL" | "WARN" | undefined;
  capturePercent?: number | undefined;
  overflowEvents?: number | undefined;
  totalOverflowVolumeMG?: number | undefined;
  checks?: CsoCheck[] | undefined;
  summary?: string | undefined;
}

export const CsoNpdesCard: React.FC<LanguageSimulationCardProps> = ({ result, colorMode, host }) => {
  const report = (result["csoNpdesReport"] ?? result["complianceReport"]) as CsoNpdesReport | undefined;
  const [expanded, setExpanded] = useState(false);

  if (!report || (report.capturePercent === undefined && report.overflowEvents === undefined && !report.checks)) {
    return null;
  }

  const checks = report.checks ?? [];
  const overallStatus = report.overallStatus ?? "PASS";
  const isPass = overallStatus === "PASS";

  return (
    <div
      data-color-mode={colorMode}
      style={{
        border: `1px solid ${isPass ? "var(--ms-success, #3fb950)" : "var(--ms-error, #f85149)"}`,
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
            EPA CSO / NPDES Compliance{report.permitId ? ` (${report.permitId})` : ""}
          </strong>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 12,
              background: isPass ? "rgba(63,185,80,0.15)" : "rgba(248,81,73,0.15)",
              color: isPass ? "var(--ms-success, #3fb950)" : "var(--ms-error, #f85149)",
            }}
          >
            {overallStatus}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {host?.exportFile && (
            <PanelButton
              onClick={() =>
                host.exportFile?.("cso-npdes-report.json", JSON.stringify(report, null, 2), "application/json")
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
          ...(report.capturePercent !== undefined
            ? [{ label: "Wet-Weather Capture", value: `${report.capturePercent.toFixed(1)}%` }]
            : []),
          ...(report.overflowEvents !== undefined ? [{ label: "CSO Events", value: report.overflowEvents }] : []),
          ...(report.totalOverflowVolumeMG !== undefined
            ? [{ label: "Overflow Vol", value: `${report.totalOverflowVolumeMG.toFixed(2)} MG` }]
            : []),
        ]}
      />

      {report.summary && <div style={{ fontSize: 12, opacity: 0.8 }}>{report.summary}</div>}

      {expanded && checks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto" }}>
          {checks.map((chk, idx) => (
            <div
              key={`${chk.controlId ?? idx}-${idx}`}
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
                <strong>{chk.controlId ?? `Control ${idx + 1}`}</strong>
                {chk.title ? ` — ${chk.title}` : ""}
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

export default CsoNpdesCard;

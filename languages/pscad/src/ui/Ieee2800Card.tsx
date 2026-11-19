// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LanguageSimulationCardProps } from "@modelscript/design-tokens/panel";
import { PanelButton, PanelKpiStrip } from "@modelscript/design-tokens/panel";
import React, { useState } from "react";
import type { Ieee2800ComplianceReport } from "../verification/ieee2800.js";

export const Ieee2800Card: React.FC<LanguageSimulationCardProps> = ({ result, colorMode, host }) => {
  const report = result["complianceReport"] as Ieee2800ComplianceReport | undefined;
  const [expanded, setExpanded] = useState(false);

  if (!report || !Array.isArray(report.checks)) {
    return null;
  }

  const passed = report.checks.filter((c) => c.status === "PASS").length;
  const failed = report.checks.filter((c) => c.status === "FAIL").length;
  const warned = report.checks.filter((c) => c.status === "WARN").length;
  const overallPass = report.overallStatus === "PASS";
  const borderColor = overallPass ? "var(--ms-success, #3fb950)" : "var(--ms-error, #f85149)";

  return (
    <div
      data-color-mode={colorMode}
      style={{
        border: `1px solid ${borderColor}`,
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
          <strong style={{ fontSize: 13 }}>IEEE 2800-2022 IBR Verification</strong>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 12,
              background: overallPass ? "rgba(63,185,80,0.15)" : "rgba(248,81,73,0.15)",
              color: overallPass ? "var(--ms-success, #3fb950)" : "var(--ms-error, #f85149)",
            }}
          >
            {report.overallStatus}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {host?.exportFile && (
            <PanelButton
              onClick={() =>
                host.exportFile?.("ieee2800-report.json", JSON.stringify(report, null, 2), "application/json")
              }
            >
              Export JSON
            </PanelButton>
          )}
          <PanelButton onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Hide Checks" : `Show Checks (${report.checks.length})`}
          </PanelButton>
        </div>
      </div>

      <PanelKpiStrip
        items={[
          { label: "Passed", value: passed, tone: "success" },
          { label: "Warnings", value: warned, tone: warned > 0 ? "warning" : "neutral" },
          { label: "Failed", value: failed, tone: failed > 0 ? "danger" : "neutral" },
          { label: "Total Clauses", value: report.checks.length },
        ]}
      />

      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
          {report.checks.map((chk, idx) => (
            <div
              key={`${chk.clause}-${idx}`}
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
                <strong>{chk.clause}</strong> — {chk.title}
                {chk.details && <div style={{ opacity: 0.75, marginTop: 2 }}>{chk.details}</div>}
              </div>
              <span
                style={{
                  fontWeight: 600,
                  color:
                    chk.status === "PASS"
                      ? "var(--ms-success, #3fb950)"
                      : chk.status === "WARN"
                        ? "var(--ms-warning, #d29922)"
                        : "var(--ms-error, #f85149)",
                }}
              >
                {chk.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Ieee2800Card;

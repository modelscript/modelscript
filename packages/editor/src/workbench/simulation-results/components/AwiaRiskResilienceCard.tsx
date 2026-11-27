// SPDX-License-Identifier: AGPL-3.0-or-later

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
import React, { useState } from "react";
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

export interface AwiaCheckItem {
  section: string;
  category: string;
  status: "PASS" | "FAIL" | "WARN";
  targetMetric: string;
  measuredMetric: string;
  details: string;
  recommendation?: string | undefined;
}

export interface AwiaComplianceReport {
  utilityName: string;
  pwsid?: string | undefined;
  populationServed?: number | undefined;
  evaluatedAt: string;
  overallStatus: "PASS" | "FAIL" | "WARN";
  resilienceScore: number; // 0 - 100
  checks: AwiaCheckItem[];
  summary: string;
}

export interface AwiaRiskResilienceCardProps {
  report?: AwiaComplianceReport | null | undefined;
  onClose?: (() => void) | undefined;
  onExportJson?: (() => void) | undefined;
  colorMode?: "light" | "dark" | undefined;
}

const statusToTone = (status: "PASS" | "FAIL" | "WARN"): ComplianceTone =>
  status === "PASS" ? "success" : status === "FAIL" ? "danger" : "warning";

const ScoreBadge: React.FC<{ score: number; children: React.ReactNode }> = ({ score, children }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "3px 8px",
      borderRadius: 6,
      fontSize: 12,
      fontWeight: 700,
      background:
        score >= 80 ? "rgba(35, 134, 54, 0.2)" : score >= 60 ? "rgba(154, 103, 0, 0.2)" : "rgba(218, 54, 51, 0.2)",
      color: score >= 80 ? "#3fb950" : score >= 60 ? "#d29922" : "#f85149",
      border: `1px solid ${
        score >= 80 ? "rgba(35, 134, 54, 0.4)" : score >= 60 ? "rgba(154, 103, 0, 0.4)" : "rgba(218, 54, 51, 0.4)"
      }`,
    }}
  >
    {children}
  </span>
);

const MetaItem: React.FC<{ label: string; value: React.ReactNode; monospace?: boolean }> = ({
  label,
  value,
  monospace = false,
}) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        color: "var(--ms-text-2, var(--color-fg-muted, #8b949e))",
      }}
    >
      {label}
    </span>
    <span
      style={{
        fontWeight: 600,
        color: "var(--ms-text, var(--color-fg-default, #c9d1d9))",
        fontFamily: monospace ? "var(--ms-font-mono, monospace)" : undefined,
      }}
    >
      {value}
    </span>
  </div>
);

const CheckStatusBadge: React.FC<{ status: "PASS" | "FAIL" | "WARN"; children: React.ReactNode }> = ({
  status,
  children,
}) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      fontSize: 11,
      fontWeight: 700,
      color:
        status === "PASS"
          ? "var(--ms-success-fg, var(--color-success-fg, #3fb950))"
          : status === "FAIL"
            ? "var(--ms-danger-fg, var(--color-danger-fg, #f85149))"
            : "var(--ms-warning-fg, var(--color-attention-fg, #d29922))",
    }}
  >
    {children}
  </span>
);

const DEFAULT_AWIA_REPORT: AwiaComplianceReport = {
  utilityName: "Metropolitan Water District",
  pwsid: "CA1910087",
  populationServed: 145000,
  evaluatedAt: new Date().toISOString(),
  overallStatus: "PASS",
  resilienceScore: 92,
  summary: "All 5 core statutory requirements under AWIA Section 2013 assessed compliant.",
  checks: [
    {
      section: "2013(a)(1)",
      category: "Storage Autonomy & Emergency Drawdown",
      status: "PASS",
      targetMetric: ">= 24.0 h average day demand autonomy",
      measuredMetric: "36.4 h gravity storage margin",
      details: "Elevated tanks and distribution reservoirs maintain >36 hours supply without grid power.",
    },
    {
      section: "2013(a)(2)",
      category: "Fire Flow Adequacy at Peak Hour",
      status: "PASS",
      targetMetric: "Residual pressure >= 20.0 psi (137.9 kPa) at 1,500 gpm",
      measuredMetric: "Residual pressure 28.4 psi (195.8 kPa)",
      details: "No cavitational throttling or pressure collapse observed at commercial hydrants during EPS peak.",
    },
    {
      section: "2013(a)(3)",
      category: "Critical Conveyance Redundancy (N-1)",
      status: "PASS",
      targetMetric: "Unserved customer demand <= 0.0 % upon single trunk isolation",
      measuredMetric: "0.0 % unserved (PDD satisfied: 100.0%)",
      details: "Trunk transmission loop handles isolation of main feeder without service outage.",
    },
    {
      section: "2013(a)(4)",
      category: "Pumping Facility Backup Generation",
      status: "PASS",
      targetMetric: "On-site generator standby >= 48.0 h",
      measuredMetric: "72.0 h dual-fuel capacity",
      details: "Dual-fuel diesel/natural gas generation on-site with automatic transfer switch.",
    },
    {
      section: "2013(a)(5)",
      category: "SCADA & Telemetry Cyber-Physical Resiliency",
      status: "PASS",
      targetMetric: "Fail-safe pneumatic valve fallback + air-gapped PLC subnet",
      measuredMetric: "100.0 % isolated PLC telemetry",
      details: "Air-gapped industrial Ethernet with encrypted link between remote tanks and treatment facility.",
    },
  ],
};

export const AwiaRiskResilienceCard: React.FC<AwiaRiskResilienceCardProps> = ({
  report = DEFAULT_AWIA_REPORT,
  onClose,
  onExportJson,
  colorMode = "dark",
}) => {
  const activeReport = report || DEFAULT_AWIA_REPORT;
  const isDark = colorMode === "dark";
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleExport = () => {
    if (onExportJson) {
      onExportJson();
      return;
    }
    const blob = new Blob([JSON.stringify(activeReport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `awia-report-${activeReport.pwsid || "compliance"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <CardContainer isDark={isDark} data-testid="awia-risk-resilience-card">
      <HeaderRow>
        <TitleGroup>
          <ShieldCheckIcon size={20} fill={activeReport.overallStatus === "PASS" ? "#3fb950" : "#f85149"} />
          <div>
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>AWIA § 2013 Risk & Resilience Assessment</h3>
            <span style={{ fontSize: "11px", color: "var(--ms-text-2, var(--color-fg-muted, #8b949e))" }}>
              America&apos;s Water Infrastructure Act Statutory Audit
            </span>
          </div>
        </TitleGroup>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ScoreBadge score={activeReport.resilienceScore}>Score: {activeReport.resilienceScore}/100</ScoreBadge>
          <StatusPill tone={statusToTone(activeReport.overallStatus)}>
            {activeReport.overallStatus === "PASS" ? (
              <CheckCircleFillIcon size={12} />
            ) : activeReport.overallStatus === "FAIL" ? (
              <XCircleFillIcon size={12} />
            ) : (
              <AlertIcon size={12} />
            )}
            {activeReport.overallStatus}
          </StatusPill>
          <ActionButtons>
            <ActionBtn isDark={isDark} onClick={handleExport} title="Export JSON Report">
              <DownloadIcon size={14} />
              JSON
            </ActionBtn>
            {onClose && (
              <ActionBtn isDark={isDark} onClick={onClose} title="Dismiss">
                <XIcon size={14} />
              </ActionBtn>
            )}
          </ActionButtons>
        </div>
      </HeaderRow>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 8,
          padding: "10px 14px",
          background: "var(--ms-bg-elv, var(--bgColor-muted, #1e1e22))",
          border: "1px solid var(--ms-border-subtle, var(--color-border-subtle, #21262d))",
          borderRadius: 6,
          fontSize: 12,
        }}
      >
        <MetaItem label="Utility Name" value={activeReport.utilityName} />
        {activeReport.pwsid && <MetaItem label="PWSID" value={activeReport.pwsid} monospace />}
        {activeReport.populationServed && (
          <MetaItem label="Pop. Served" value={activeReport.populationServed.toLocaleString()} />
        )}
        <MetaItem label="Audit Date" value={new Date(activeReport.evaluatedAt).toLocaleDateString()} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {activeReport.checks.map((check) => {
          const isExpanded = !!expandedSections[check.section];
          return (
            <ExpandableRow key={check.section} status={check.status}>
              <ExpandableHeader
                onClick={() => toggleSection(check.section)}
                style={{ padding: "10px 14px" }}
                hoverBackground="var(--ms-bg-hover, var(--color-canvas-subtle, rgba(255, 255, 255, 0.02)))"
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                  <span
                    style={{
                      fontFamily: "var(--ms-font-mono, monospace)",
                      fontSize: 11,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: "var(--ms-bg-subtle, var(--color-canvas-subtle, #21262d))",
                      color: "var(--ms-brand, var(--fgColor-accent, #58a6ff))",
                      fontWeight: 600,
                    }}
                  >
                    § {check.section}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: "13px" }}>{check.category}</span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <CheckStatusBadge status={check.status}>
                    {check.status === "PASS" ? (
                      <CheckIcon size={12} />
                    ) : check.status === "FAIL" ? (
                      <XIcon size={12} />
                    ) : (
                      <AlertIcon size={12} />
                    )}
                    {check.status}
                  </CheckStatusBadge>
                  {isExpanded ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
                </div>
              </ExpandableHeader>

              {isExpanded && (
                <div
                  style={{
                    padding: "10px 14px 14px 14px",
                    borderTop:
                      "1px solid var(--ms-border-subtle, var(--color-border-subtle, rgba(255, 255, 255, 0.08)))",
                    background: "var(--ms-bg-subtle, var(--color-canvas-subtle, rgba(0, 0, 0, 0.15)))",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    fontSize: 12,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 12,
                      padding: "8px 12px",
                      borderRadius: 4,
                      background: "var(--ms-bg-elv, var(--bgColor-muted, #1e1e22))",
                      border: "1px solid var(--ms-border-subtle, var(--color-border-subtle, #30363d))",
                    }}
                  >
                    <div>
                      <span
                        style={{
                          fontSize: "10px",
                          color: "var(--ms-text-2, var(--color-fg-muted, #8b949e))",
                          textTransform: "uppercase",
                        }}
                      >
                        Statutory Criterion
                      </span>
                      <div style={{ fontWeight: 600, marginTop: "2px" }}>{check.targetMetric}</div>
                    </div>
                    <div>
                      <span
                        style={{
                          fontSize: "10px",
                          color: "var(--ms-text-2, var(--color-fg-muted, #8b949e))",
                          textTransform: "uppercase",
                        }}
                      >
                        Measured Margin
                      </span>
                      <div
                        style={{
                          fontWeight: 600,
                          marginTop: "2px",
                          color: check.status === "PASS" ? "#3fb950" : "#f85149",
                        }}
                      >
                        {check.measuredMetric}
                      </div>
                    </div>
                  </div>
                  <div>{check.details}</div>
                  {check.recommendation && (
                    <div
                      style={{
                        color: "var(--ms-warning-fg, var(--color-attention-fg, #d29922))",
                        fontStyle: "italic",
                      }}
                    >
                      Recommendation: {check.recommendation}
                    </div>
                  )}
                </div>
              )}
            </ExpandableRow>
          );
        })}
      </div>
    </CardContainer>
  );
};

export default React.memo(AwiaRiskResilienceCard);

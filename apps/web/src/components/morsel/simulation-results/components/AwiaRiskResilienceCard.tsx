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
import styled from "styled-components";

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

const CardContainer = styled.div<{ $isDark: boolean }>`
  border: 1px solid var(--color-border-default, ${(p) => (p.$isDark ? "#30363d" : "#d0d7de")});
  border-radius: 10px;
  background: var(--color-canvas-subtle, ${(p) => (p.$isDark ? "#0d1117" : "#f6f8fa")});
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

const ScoreBadge = styled.span<{ $score: number }>`
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  background: ${(p) =>
    p.$score >= 80 ? "rgba(35, 134, 54, 0.2)" : p.$score >= 60 ? "rgba(154, 103, 0, 0.2)" : "rgba(218, 54, 51, 0.2)"};
  color: ${(p) => (p.$score >= 80 ? "#3fb950" : p.$score >= 60 ? "#d29922" : "#f85149")};
  border: 1px solid
    ${(p) =>
      p.$score >= 80 ? "rgba(35, 134, 54, 0.4)" : p.$score >= 60 ? "rgba(154, 103, 0, 0.4)" : "rgba(218, 54, 51, 0.4)"};
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
  background: var(--color-canvas-default, #161b22);
  color: var(--color-fg-default, #c9d1d9);
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: var(--color-canvas-subtle, #21262d);
  }
`;

const MetaGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
  padding: 10px 14px;
  background: var(--color-canvas-default, #161b22);
  border: 1px solid var(--color-border-subtle, #21262d);
  border-radius: 6px;
  font-size: 12px;
`;

const MetaItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;

  & > span:first-child {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--color-fg-muted, #8b949e);
  }

  & > span:last-child {
    font-weight: 600;
    color: var(--color-fg-default, #c9d1d9);
  }
`;

const CheckGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const CheckRow = styled.div<{ $status: "PASS" | "FAIL" | "WARN"; $expanded: boolean }>`
  display: flex;
  flex-direction: column;
  border: 1px solid
    ${(p) =>
      p.$status === "FAIL" ? "rgba(218, 54, 51, 0.4)" : "var(--color-border-subtle, rgba(255, 255, 255, 0.08))"};
  border-radius: 6px;
  background: var(--color-canvas-default, #161b22);
  overflow: hidden;
  transition: border-color 0.15s ease;
`;

const CheckHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;

  &:hover {
    background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.02));
  }
`;

const CheckTitleCol = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
`;

const SectionPill = styled.span`
  font-family: monospace;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--color-canvas-subtle, #21262d);
  color: var(--color-accent-fg, #58a6ff);
  font-weight: 600;
`;

const CheckStatusBadge = styled.span<{ $status: "PASS" | "FAIL" | "WARN" }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 700;
  color: ${(p) =>
    p.$status === "PASS"
      ? "var(--color-success-fg, #3fb950)"
      : p.$status === "FAIL"
        ? "var(--color-danger-fg, #f85149)"
        : "var(--color-attention-fg, #d29922)"};
`;

const CheckDetails = styled.div`
  padding: 10px 14px 14px 14px;
  border-top: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
  background: var(--color-canvas-subtle, rgba(0, 0, 0, 0.15));
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
`;

const MetricComparison = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 4px;
  background: var(--color-canvas-default, #161b22);
  border: 1px solid var(--color-border-subtle, #30363d);
`;

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
    <CardContainer $isDark={isDark} data-testid="awia-risk-resilience-card">
      <HeaderRow>
        <TitleGroup>
          <ShieldCheckIcon size={20} fill={activeReport.overallStatus === "PASS" ? "#3fb950" : "#f85149"} />
          <div>
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>AWIA § 2013 Risk & Resilience Assessment</h3>
            <span style={{ fontSize: "11px", color: "var(--color-fg-muted, #8b949e)" }}>
              America&apos;s Water Infrastructure Act Statutory Audit
            </span>
          </div>
        </TitleGroup>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ScoreBadge $score={activeReport.resilienceScore}>Score: {activeReport.resilienceScore}/100</ScoreBadge>
          <Badge $status={activeReport.overallStatus}>
            {activeReport.overallStatus === "PASS" ? (
              <CheckCircleFillIcon size={12} />
            ) : activeReport.overallStatus === "FAIL" ? (
              <XCircleFillIcon size={12} />
            ) : (
              <AlertIcon size={12} />
            )}
            {activeReport.overallStatus}
          </Badge>
          <ActionButtons>
            <ActionBtn type="button" onClick={handleExport} title="Export JSON Report">
              <DownloadIcon size={14} />
              JSON
            </ActionBtn>
            {onClose && (
              <ActionBtn type="button" onClick={onClose} title="Dismiss">
                <XIcon size={14} />
              </ActionBtn>
            )}
          </ActionButtons>
        </div>
      </HeaderRow>

      <MetaGrid>
        <MetaItem>
          <span>Utility Name</span>
          <span>{activeReport.utilityName}</span>
        </MetaItem>
        {activeReport.pwsid && (
          <MetaItem>
            <span>PWSID</span>
            <span style={{ fontFamily: "monospace" }}>{activeReport.pwsid}</span>
          </MetaItem>
        )}
        {activeReport.populationServed && (
          <MetaItem>
            <span>Pop. Served</span>
            <span>{activeReport.populationServed.toLocaleString()}</span>
          </MetaItem>
        )}
        <MetaItem>
          <span>Audit Date</span>
          <span>{new Date(activeReport.evaluatedAt).toLocaleDateString()}</span>
        </MetaItem>
      </MetaGrid>

      <CheckGrid>
        {activeReport.checks.map((check) => {
          const isExpanded = !!expandedSections[check.section];
          return (
            <CheckRow key={check.section} $status={check.status} $expanded={isExpanded}>
              <CheckHeader onClick={() => toggleSection(check.section)}>
                <CheckTitleCol>
                  <SectionPill>§ {check.section}</SectionPill>
                  <span style={{ fontWeight: 600, fontSize: "13px" }}>{check.category}</span>
                </CheckTitleCol>

                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <CheckStatusBadge $status={check.status}>
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
              </CheckHeader>

              {isExpanded && (
                <CheckDetails>
                  <MetricComparison>
                    <div>
                      <span
                        style={{
                          fontSize: "10px",
                          color: "var(--color-fg-muted, #8b949e)",
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
                          color: "var(--color-fg-muted, #8b949e)",
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
                  </MetricComparison>
                  <div>{check.details}</div>
                  {check.recommendation && (
                    <div style={{ color: "var(--color-attention-fg, #d29922)", fontStyle: "italic" }}>
                      Recommendation: {check.recommendation}
                    </div>
                  )}
                </CheckDetails>
              )}
            </CheckRow>
          );
        })}
      </CheckGrid>
    </CardContainer>
  );
};

export default React.memo(AwiaRiskResilienceCard);

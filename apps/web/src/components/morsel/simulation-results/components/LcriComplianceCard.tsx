// SPDX-License-Identifier: AGPL-3.0-or-later

import { exportLcriInventoryCsv } from "@modelscript/epanet";
import { CheckCircleFillIcon, DownloadIcon, ShieldCheckIcon, XCircleFillIcon, XIcon } from "@primer/octicons-react";
import React from "react";
import styled from "styled-components";

export interface LcriServiceLineInventory {
  totalConnections: number;
  leadCount: number;
  grrCount: number; // Galvanized Requiring Replacement
  unknownCount: number;
  nonLeadCount: number;
  annualReplacementRatePct?: number; // Target >= 10%
  completedReplacementsThisYear?: number;
}

export interface LcriSamplingMetrics {
  p90LeadPpb: number; // 90th percentile lead concentration (Action Level = 10.0 ppb)
  p90CopperPpb: number; // 90th percentile copper concentration (Action Level = 1300 ppb)
  samplesCollected: number;
  exceedanceCount: number;
  samplingPeriod: string; // e.g. "2026 H1"
}

export interface LcriCorrosionControl {
  orthophosphateMgL: number; // Target >= 0.5 mg/L
  orthophosphateTarget: number; // default 0.5 mg/L
  phMean: number;
  phMin: number;
  phThreshold: number; // default 7.2
  alkalinityMgL?: number;
}

export interface LcriComplianceReport {
  utilityName: string;
  pwsid?: string;
  evaluatedAt: string;
  inventory: LcriServiceLineInventory;
  sampling: LcriSamplingMetrics;
  corrosionControl: LcriCorrosionControl;
  status: "Compliant" | "Action Level Exceeded" | "At Risk";
  summary: string;
}

export interface LcriComplianceCardProps {
  report?: LcriComplianceReport | null | undefined;
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

const StatusBadge = styled.span<{ $status: "Compliant" | "Action Level Exceeded" | "At Risk" }>`
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
    p.$status === "Compliant"
      ? "var(--color-success-emphasis, #238636)"
      : p.$status === "At Risk"
        ? "var(--color-attention-emphasis, #9a6700)"
        : "var(--color-danger-emphasis, #da3633)"};
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
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default, #d0d7de);
  background: var(--color-canvas-default, #ffffff);
  color: var(--color-fg-default, #24292f);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--color-canvas-subtle, #f6f8fa);
  }
`;

const MetricGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px;
`;

const MetricTile = styled.div<{ $isDark: boolean; $alert?: boolean }>`
  background: var(--color-canvas-default, ${(p) => (p.$isDark ? "#161b22" : "#ffffff")});
  border: 1px solid
    ${(p) => (p.$alert ? "var(--color-danger-emphasis, #da3633)" : "var(--color-border-subtle, #eaecef)")};
  border-radius: 8px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const MetricLabel = styled.span`
  font-size: 11px;
  color: var(--color-fg-muted, #57606a);
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.5px;
`;

const MetricValue = styled.span<{ $color?: string }>`
  font-size: 18px;
  font-weight: 700;
  color: ${(p) => p.$color || "var(--color-fg-default, #24292f)"};
  display: flex;
  align-items: baseline;
  gap: 4px;
`;

const MetricSub = styled.span`
  font-size: 11px;
  color: var(--color-fg-muted, #57606a);
`;

const InventorySection = styled.div<{ $isDark: boolean }>`
  background: var(--color-canvas-default, ${(p) => (p.$isDark ? "#161b22" : "#ffffff")});
  border: 1px solid var(--color-border-subtle, #eaecef);
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const BarContainer = styled.div`
  display: flex;
  height: 16px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--color-border-muted, #d0d7de);
`;

const BarSegment = styled.div<{ $pct: number; $color: string }>`
  width: ${(p) => p.$pct}%;
  background: ${(p) => p.$color};
  transition: width 0.3s ease;
`;

const LegendRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 11px;
  color: var(--color-fg-muted, #57606a);
`;

const LegendItem = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
`;

const LegendDot = styled.div<{ $color: string }>`
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: ${(p) => p.$color};
`;

const DEFAULT_REPORT: LcriComplianceReport = {
  utilityName: "Metropolitan Water Authority",
  pwsid: "MA1001248",
  evaluatedAt: new Date().toISOString(),
  inventory: {
    totalConnections: 45000,
    leadCount: 1850,
    grrCount: 1220,
    unknownCount: 3400,
    nonLeadCount: 38530,
    annualReplacementRatePct: 10.5,
    completedReplacementsThisYear: 322,
  },
  sampling: {
    p90LeadPpb: 6.8,
    p90CopperPpb: 420,
    samplesCollected: 100,
    exceedanceCount: 0,
    samplingPeriod: "2026 H1",
  },
  corrosionControl: {
    orthophosphateMgL: 0.82,
    orthophosphateTarget: 0.5,
    phMean: 7.55,
    phMin: 7.28,
    phThreshold: 7.2,
    alkalinityMgL: 38,
  },
  status: "Compliant",
  summary:
    "System complies with EPA LCRI 10 ppb Lead Action Level (90th percentile = 6.8 ppb). Corrosion control inhibitor residual stable at 0.82 mg/L PO4.",
};

export const LcriComplianceCard: React.FC<LcriComplianceCardProps> = ({
  report = DEFAULT_REPORT,
  onClose,
  onExportJson,
  colorMode = "light",
}) => {
  const isDark = colorMode === "dark";
  const data = report || DEFAULT_REPORT;

  const total = data.inventory.totalConnections || 1;
  const leadPct = (data.inventory.leadCount / total) * 100;
  const grrPct = (data.inventory.grrCount / total) * 100;
  const unknownPct = (data.inventory.unknownCount / total) * 100;
  const nonLeadPct = Math.max(0, 100 - leadPct - grrPct - unknownPct);

  const isLeadExceeded = data.sampling.p90LeadPpb > 10.0;
  const isWqpLow = data.corrosionControl.orthophosphateMgL < data.corrosionControl.orthophosphateTarget;

  const computedStatus: "Compliant" | "Action Level Exceeded" | "At Risk" = isLeadExceeded
    ? "Action Level Exceeded"
    : isWqpLow || unknownPct > 15
      ? "At Risk"
      : data.status;

  const handleExport = () => {
    if (onExportJson) {
      onExportJson();
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lcri-compliance-${data.pwsid || "report"}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const csvContent = exportLcriInventoryCsv({
      pwsid: data.pwsid || "MA1001248",
      utilityName: data.utilityName,
      reportingYear: new Date(data.evaluatedAt).getFullYear() || 2026,
      inventorySummary: {
        totalServiceLines: data.inventory.totalConnections,
        leadCount: data.inventory.leadCount,
        grrCount: data.inventory.grrCount,
        unknownCount: data.inventory.unknownCount,
        nonLeadCount: data.inventory.nonLeadCount,
        annualReplacementRatePct: data.inventory.annualReplacementRatePct ?? 10.0,
        statutory10YearCompliant: (data.inventory.annualReplacementRatePct ?? 10.0) >= 10.0,
      },
      samplingMetrics: {
        p90LeadPpb: data.sampling.p90LeadPpb,
        p90CopperPpb: data.sampling.p90CopperPpb,
        actionLevelLeadPpb: 10.0,
        actionLevelExceeded: data.sampling.p90LeadPpb > 10.0,
        samplesCount: data.sampling.samplesCollected,
        samplingPeriod: data.sampling.samplingPeriod,
      },
      corrosionControl: {
        orthophosphateMgL: data.corrosionControl.orthophosphateMgL,
        wqpMinTargetMgL: data.corrosionControl.orthophosphateTarget,
        phMean: data.corrosionControl.phMean,
        phMinThreshold: data.corrosionControl.phThreshold,
        cctCompliant: data.corrosionControl.orthophosphateMgL >= data.corrosionControl.orthophosphateTarget,
      },
      serviceLines: [
        {
          serviceLineId: "SL-001",
          streetAddress: "100 Main St",
          utilitySideMaterial: "Lead",
          customerSideMaterial: "Lead",
          classification: "Lead",
          verificationMethod: "Field Inspection",
          installationYear: 1930,
          diameterMm: 20,
          scheduledReplacementYear: 2027,
        },
      ],
      overallStatus: computedStatus,
    });
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lcri-service-lines-${data.pwsid || "inventory"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <CardContainer $isDark={isDark}>
      <HeaderRow>
        <TitleGroup>
          <ShieldCheckIcon size={20} fill={computedStatus === "Compliant" ? "#238636" : "#da3633"} />
          <div>
            <div style={{ fontWeight: 700, fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>EPA LCRI Lead & Copper Rule Compliance</span>
              <StatusBadge $status={computedStatus}>
                {computedStatus === "Compliant" ? <CheckCircleFillIcon size={12} /> : <XCircleFillIcon size={12} />}
                {computedStatus}
              </StatusBadge>
            </div>
            <div style={{ fontSize: "12px", color: "var(--color-fg-muted, #57606a)", marginTop: "2px" }}>
              {data.utilityName} {data.pwsid ? `(${data.pwsid})` : ""} &bull; {data.sampling.samplingPeriod} &bull; 10
              ppb Action Level
            </div>
          </div>
        </TitleGroup>

        <ActionButtons>
          <ActionBtn onClick={handleExportCsv} aria-label="Export EPA CSV">
            <DownloadIcon size={14} />
            Export EPA CSV
          </ActionBtn>
          <ActionBtn onClick={handleExport} aria-label="Export JSON">
            <DownloadIcon size={14} />
            Export JSON
          </ActionBtn>
          {onClose && (
            <ActionBtn onClick={onClose} aria-label="Close">
              <XIcon size={14} />
            </ActionBtn>
          )}
        </ActionButtons>
      </HeaderRow>

      {/* Primary Compliance Metrics */}
      <MetricGrid>
        <MetricTile $isDark={isDark} $alert={isLeadExceeded}>
          <MetricLabel>90th Percentile Lead</MetricLabel>
          <MetricValue $color={isLeadExceeded ? "#da3633" : "#238636"}>
            {data.sampling.p90LeadPpb.toFixed(1)} <span style={{ fontSize: "12px" }}>ppb</span>
          </MetricValue>
          <MetricSub>Action Level: &le; 10.0 ppb</MetricSub>
        </MetricTile>

        <MetricTile $isDark={isDark}>
          <MetricLabel>90th Percentile Copper</MetricLabel>
          <MetricValue>
            {data.sampling.p90CopperPpb.toFixed(0)} <span style={{ fontSize: "12px" }}>ppb</span>
          </MetricValue>
          <MetricSub>Action Level: &le; 1,300 ppb</MetricSub>
        </MetricTile>

        <MetricTile $isDark={isDark} $alert={isWqpLow}>
          <MetricLabel>Orthophosphate Residual</MetricLabel>
          <MetricValue $color={isWqpLow ? "#9a6700" : undefined}>
            {data.corrosionControl.orthophosphateMgL.toFixed(2)} <span style={{ fontSize: "12px" }}>mg/L</span>
          </MetricValue>
          <MetricSub>Min Target: &ge; {data.corrosionControl.orthophosphateTarget.toFixed(2)} mg/L</MetricSub>
        </MetricTile>

        <MetricTile $isDark={isDark}>
          <MetricLabel>Finished Water pH</MetricLabel>
          <MetricValue>{data.corrosionControl.phMean.toFixed(2)}</MetricValue>
          <MetricSub>
            Min observed: {data.corrosionControl.phMin.toFixed(2)} (&ge; {data.corrosionControl.phThreshold})
          </MetricSub>
        </MetricTile>
      </MetricGrid>

      {/* Service Line Inventory (10-Year Mandatory Replacement) */}
      <InventorySection $isDark={isDark}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: 600 }}>
          <span>Service Line Inventory ({data.inventory.totalConnections.toLocaleString()} connections)</span>
          <span style={{ color: "var(--color-fg-muted, #57606a)" }}>
            Annual Replacement Pace: {data.inventory.annualReplacementRatePct?.toFixed(1) ?? "10.0"}% / yr (Req &ge;
            10%)
          </span>
        </div>

        <BarContainer>
          <BarSegment
            $pct={leadPct}
            $color="#da3633"
            title={`Lead: ${data.inventory.leadCount} (${leadPct.toFixed(1)}%)`}
          />
          <BarSegment
            $pct={grrPct}
            $color="#d97706"
            title={`GRR: ${data.inventory.grrCount} (${grrPct.toFixed(1)}%)`}
          />
          <BarSegment
            $pct={unknownPct}
            $color="#ca8a04"
            title={`Unknown: ${data.inventory.unknownCount} (${unknownPct.toFixed(1)}%)`}
          />
          <BarSegment
            $pct={nonLeadPct}
            $color="#238636"
            title={`Non-Lead: ${data.inventory.nonLeadCount} (${nonLeadPct.toFixed(1)}%)`}
          />
        </BarContainer>

        <LegendRow>
          <LegendItem>
            <LegendDot $color="#da3633" />
            Lead: {data.inventory.leadCount.toLocaleString()} ({leadPct.toFixed(1)}%)
          </LegendItem>
          <LegendItem>
            <LegendDot $color="#d97706" />
            Galvanized (GRR): {data.inventory.grrCount.toLocaleString()} ({grrPct.toFixed(1)}%)
          </LegendItem>
          <LegendItem>
            <LegendDot $color="#ca8a04" />
            Unknown: {data.inventory.unknownCount.toLocaleString()} ({unknownPct.toFixed(1)}%)
          </LegendItem>
          <LegendItem>
            <LegendDot $color="#238636" />
            Non-Lead: {data.inventory.nonLeadCount.toLocaleString()} ({nonLeadPct.toFixed(1)}%)
          </LegendItem>
        </LegendRow>
      </InventorySection>
    </CardContainer>
  );
};

export default React.memo(LcriComplianceCard);

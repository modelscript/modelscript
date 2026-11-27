// SPDX-License-Identifier: AGPL-3.0-or-later

import { exportLcriInventoryCsv } from "@modelscript/epanet";
import { CheckCircleFillIcon, DownloadIcon, ShieldCheckIcon, XCircleFillIcon, XIcon } from "@primer/octicons-react";
import React from "react";
import {
  ActionBtn,
  ActionButtons,
  CardContainer,
  type ComplianceTone,
  HeaderRow,
  MetricGrid,
  MetricLabel,
  MetricSub,
  MetricTile,
  MetricValue,
  StackedBarSegment,
  StatusPill,
  TitleGroup,
} from "./ComplianceCardPrimitives";

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

const statusToTone = (status: "Compliant" | "Action Level Exceeded" | "At Risk"): ComplianceTone =>
  status === "Compliant" ? "success" : status === "At Risk" ? "warning" : "danger";

const LegendItem: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
    <div style={{ width: 9, height: 9, borderRadius: 2, background: color }} />
    {children}
  </div>
);

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
    <CardContainer isDark={isDark}>
      <HeaderRow>
        <TitleGroup>
          <ShieldCheckIcon size={20} fill={computedStatus === "Compliant" ? "#238636" : "#da3633"} />
          <div>
            <div style={{ fontWeight: 700, fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>EPA LCRI Lead & Copper Rule Compliance</span>
              <StatusPill tone={statusToTone(computedStatus)}>
                {computedStatus === "Compliant" ? <CheckCircleFillIcon size={12} /> : <XCircleFillIcon size={12} />}
                {computedStatus}
              </StatusPill>
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "var(--ms-text-2, var(--color-fg-muted, #57606a))",
                marginTop: "2px",
              }}
            >
              {data.utilityName} {data.pwsid ? `(${data.pwsid})` : ""} &bull; {data.sampling.samplingPeriod} &bull; 10
              ppb Action Level
            </div>
          </div>
        </TitleGroup>

        <ActionButtons>
          <ActionBtn isDark={isDark} compact onClick={handleExportCsv} aria-label="Export EPA CSV">
            <DownloadIcon size={14} />
            Export EPA CSV
          </ActionBtn>
          <ActionBtn isDark={isDark} compact onClick={handleExport} aria-label="Export JSON">
            <DownloadIcon size={14} />
            Export JSON
          </ActionBtn>
          {onClose && (
            <ActionBtn isDark={isDark} compact onClick={onClose} aria-label="Close">
              <XIcon size={14} />
            </ActionBtn>
          )}
        </ActionButtons>
      </HeaderRow>

      {/* Primary Compliance Metrics */}
      <MetricGrid>
        <MetricTile isDark={isDark} alert={isLeadExceeded}>
          <MetricLabel>90th Percentile Lead</MetricLabel>
          <MetricValue color={isLeadExceeded ? "#da3633" : "#238636"}>
            {data.sampling.p90LeadPpb.toFixed(1)} <span style={{ fontSize: "12px" }}>ppb</span>
          </MetricValue>
          <MetricSub>Action Level: &le; 10.0 ppb</MetricSub>
        </MetricTile>

        <MetricTile isDark={isDark}>
          <MetricLabel>90th Percentile Copper</MetricLabel>
          <MetricValue>
            {data.sampling.p90CopperPpb.toFixed(0)} <span style={{ fontSize: "12px" }}>ppb</span>
          </MetricValue>
          <MetricSub>Action Level: &le; 1,300 ppb</MetricSub>
        </MetricTile>

        <MetricTile isDark={isDark} alert={isWqpLow}>
          <MetricLabel>Orthophosphate Residual</MetricLabel>
          <MetricValue color={isWqpLow ? "#9a6700" : undefined}>
            {data.corrosionControl.orthophosphateMgL.toFixed(2)} <span style={{ fontSize: "12px" }}>mg/L</span>
          </MetricValue>
          <MetricSub>Min Target: &ge; {data.corrosionControl.orthophosphateTarget.toFixed(2)} mg/L</MetricSub>
        </MetricTile>

        <MetricTile isDark={isDark}>
          <MetricLabel>Finished Water pH</MetricLabel>
          <MetricValue>{data.corrosionControl.phMean.toFixed(2)}</MetricValue>
          <MetricSub>
            Min observed: {data.corrosionControl.phMin.toFixed(2)} (&ge; {data.corrosionControl.phThreshold})
          </MetricSub>
        </MetricTile>
      </MetricGrid>

      {/* Service Line Inventory (10-Year Mandatory Replacement) */}
      <div
        style={{
          background: `var(--ms-bg-elv, var(--bgColor-muted, ${isDark ? "#1e1e22" : "#ffffff"}))`,
          border: `1px solid var(--ms-border-subtle, var(--color-border-subtle, ${isDark ? "#30363d" : "#eaecef"}))`,
          borderRadius: 8,
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: 600 }}>
          <span>Service Line Inventory ({data.inventory.totalConnections.toLocaleString()} connections)</span>
          <span style={{ color: "var(--ms-text-2, var(--color-fg-muted, #57606a))" }}>
            Annual Replacement Pace: {data.inventory.annualReplacementRatePct?.toFixed(1) ?? "10.0"}% / yr (Req &ge;
            10%)
          </span>
        </div>

        <div
          style={{
            display: "flex",
            height: 16,
            borderRadius: 4,
            overflow: "hidden",
            background: "var(--ms-border, var(--color-border-muted, #d0d7de))",
          }}
        >
          <StackedBarSegment
            pct={leadPct}
            color="#da3633"
            title={`Lead: ${data.inventory.leadCount} (${leadPct.toFixed(1)}%)`}
          />
          <StackedBarSegment
            pct={grrPct}
            color="#d97706"
            title={`GRR: ${data.inventory.grrCount} (${grrPct.toFixed(1)}%)`}
          />
          <StackedBarSegment
            pct={unknownPct}
            color="#ca8a04"
            title={`Unknown: ${data.inventory.unknownCount} (${unknownPct.toFixed(1)}%)`}
          />
          <StackedBarSegment
            pct={nonLeadPct}
            color="#238636"
            title={`Non-Lead: ${data.inventory.nonLeadCount} (${nonLeadPct.toFixed(1)}%)`}
          />
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 14,
            fontSize: 11,
            color: "var(--ms-text-2, var(--color-fg-muted, #57606a))",
          }}
        >
          <LegendItem color="#da3633">
            Lead: {data.inventory.leadCount.toLocaleString()} ({leadPct.toFixed(1)}%)
          </LegendItem>
          <LegendItem color="#d97706">
            Galvanized (GRR): {data.inventory.grrCount.toLocaleString()} ({grrPct.toFixed(1)}%)
          </LegendItem>
          <LegendItem color="#ca8a04">
            Unknown: {data.inventory.unknownCount.toLocaleString()} ({unknownPct.toFixed(1)}%)
          </LegendItem>
          <LegendItem color="#238636">
            Non-Lead: {data.inventory.nonLeadCount.toLocaleString()} ({nonLeadPct.toFixed(1)}%)
          </LegendItem>
        </div>
      </div>
    </CardContainer>
  );
};

export default React.memo(LcriComplianceCard);

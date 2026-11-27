// SPDX-License-Identifier: AGPL-3.0-or-later

import { exportAwwaM36Csv } from "@modelscript/epanet";
import { DownloadIcon, GraphIcon, XIcon } from "@primer/octicons-react";
import React from "react";
import {
  ActionBtn,
  ActionButtons,
  CardContainer,
  type ComplianceTone,
  HeaderRow,
  StackedBarSegment,
  StatusPill,
  TitleGroup,
} from "./ComplianceCardPrimitives";

export interface AwwaM36AuditReport {
  utilityName: string;
  auditYear: number;
  evaluatedAt: string;
  serviceConnections: number;
  totalMainsLengthKm: number;
  averagePressurePsi: number;
  systemInputVolumeM3: number;
  authorizedConsumptionM3: number;
  apparentLossesM3: number;
  realLossesM3: number;
  carlLitersPerConnDay: number;
  uarlLitersPerConnDay: number;
  ili: number;
  iliBand: "Band A" | "Band B" | "Band C" | "Band D";
  waterLossCostPerM3: number; // e.g. $0.85/m3
  annualLossCostUsd: number;
  recoverableRevenueUsd: number;
  summary: string;
}

export interface AwwaM36WaterLossCardProps {
  report?: AwwaM36AuditReport | null | undefined;
  onClose?: (() => void) | undefined;
  onExportJson?: (() => void) | undefined;
  colorMode?: "light" | "dark" | undefined;
}

const bandToTone = (band: "Band A" | "Band B" | "Band C" | "Band D"): ComplianceTone =>
  band === "Band A" ? "success" : band === "Band B" ? "brand" : band === "Band C" ? "warning" : "danger";

const KpiCard: React.FC<{
  label: string;
  highlight?: boolean;
  valueColor?: string;
  children: React.ReactNode;
}> = ({ label, highlight = false, valueColor, children }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      gap: 4,
      padding: "10px 12px",
      borderRadius: 6,
      background: "var(--ms-bg-elv, var(--bgColor-muted, #1e1e22))",
      border: `1px solid ${highlight ? "var(--ms-brand, #0969da)" : "var(--ms-border, var(--borderColor-muted, #30363d))"}`,
    }}
  >
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        color: "var(--ms-text-2, var(--fgColor-muted, #8b949e))",
      }}
    >
      {label}
    </span>
    <div
      style={{
        fontSize: 16,
        fontWeight: 700,
        color:
          valueColor ??
          (highlight
            ? "var(--ms-brand, var(--fgColor-accent, #58a6ff))"
            : "var(--ms-text, var(--fgColor-default, #c9d1d9))"),
      }}
    >
      {children}
    </div>
  </div>
);

const LegendItem: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <span style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
    <span>{label}</span>
  </div>
);

const DEFAULT_M36_REPORT: AwwaM36AuditReport = {
  utilityName: "Austin Water Utility",
  auditYear: 2025,
  evaluatedAt: new Date().toISOString(),
  serviceConnections: 248000,
  totalMainsLengthKm: 6200,
  averagePressurePsi: 65.0,
  systemInputVolumeM3: 135000000,
  authorizedConsumptionM3: 118800000,
  apparentLossesM3: 4050000,
  realLossesM3: 12150000,
  carlLitersPerConnDay: 134.2,
  uarlLitersPerConnDay: 72.5,
  ili: 1.85,
  iliBand: "Band A",
  waterLossCostPerM3: 0.95,
  annualLossCostUsd: 11542500,
  recoverableRevenueUsd: 4625000,
  summary:
    "AWWA M36 Water Audit completed with Infrastructure Leakage Index (ILI) of 1.85 (Band A). Real leakage represents 9.0% of system input volume.",
};

export const AwwaM36WaterLossCard: React.FC<AwwaM36WaterLossCardProps> = ({
  report = DEFAULT_M36_REPORT,
  onClose,
  onExportJson,
  colorMode = "dark",
}) => {
  const activeReport = report || DEFAULT_M36_REPORT;
  const isDark = colorMode === "dark";

  const totalVol = Math.max(1, activeReport.systemInputVolumeM3);
  const authPct = (activeReport.authorizedConsumptionM3 / totalVol) * 100;
  const apparentPct = (activeReport.apparentLossesM3 / totalVol) * 100;
  const realPct = (activeReport.realLossesM3 / totalVol) * 100;

  const handleExport = () => {
    if (onExportJson) {
      onExportJson();
      return;
    }
    const blob = new Blob([JSON.stringify(activeReport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `awwa-m36-audit-${activeReport.utilityName.replace(/\s+/g, "_").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const csvContent = exportAwwaM36Csv(
      {
        systemInputVolumeM3Year: activeReport.systemInputVolumeM3,
        authorizedConsumptionM3Year: activeReport.authorizedConsumptionM3,
        waterLossesM3Year: activeReport.apparentLossesM3 + activeReport.realLossesM3,
        apparentLossesM3Year: activeReport.apparentLossesM3,
        realLossesM3Year: activeReport.realLossesM3,
        nonRevenueWaterM3Year: activeReport.apparentLossesM3 + activeReport.realLossesM3,
        nonRevenueWaterPct:
          ((activeReport.apparentLossesM3 + activeReport.realLossesM3) /
            Math.max(1, activeReport.systemInputVolumeM3)) *
          100,
        carlM3Year: (activeReport.carlLitersPerConnDay * activeReport.serviceConnections * 365) / 1000,
        uarlM3Year: (activeReport.uarlLitersPerConnDay * activeReport.serviceConnections * 365) / 1000,
        ili: activeReport.ili,
        performanceBand: activeReport.iliBand.replace("Band ", "") as "A" | "B" | "C" | "D",
        financialImpact: {
          realLossCostUsd: activeReport.annualLossCostUsd - activeReport.recoverableRevenueUsd,
          apparentLossRevenueLostUsd: activeReport.recoverableRevenueUsd,
          totalAnnualLossUsd: activeReport.annualLossCostUsd,
        },
        networkStats: {
          totalMainsLengthKm: activeReport.totalMainsLengthKm,
          avgSystemPressureM: activeReport.averagePressurePsi * 0.7032496,
          serviceConnectionsCount: activeReport.serviceConnections,
        },
      },
      {
        utilityName: activeReport.utilityName,
        reportingYear: activeReport.auditYear,
      },
    );

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `awwa-m36-audit-${activeReport.utilityName.replace(/\s+/g, "_").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <CardContainer isDark={isDark} data-testid="awwa-m36-water-loss-card">
      <HeaderRow>
        <TitleGroup>
          <GraphIcon size={20} fill="var(--ms-brand, var(--fgColor-accent, #58a6ff))" />
          <div>
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>AWWA M36 Water Audit &amp; Loss Control</h3>
            <span style={{ fontSize: "11px", color: "var(--ms-text-2, var(--color-fg-muted, #8b949e))" }}>
              {activeReport.utilityName} • Audit Year {activeReport.auditYear}
            </span>
          </div>
        </TitleGroup>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusPill tone={bandToTone(activeReport.iliBand)}>
            {activeReport.iliBand} (ILI {activeReport.ili.toFixed(2)})
          </StatusPill>
          <ActionButtons>
            <ActionBtn isDark={isDark} onClick={handleExportCsv} title="Export AWWA CSV Audit">
              <DownloadIcon size={14} />
              CSV
            </ActionBtn>
            <ActionBtn isDark={isDark} onClick={handleExport} title="Export JSON Audit">
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
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: 8,
        }}
      >
        <KpiCard label="ILI Index" highlight>
          {activeReport.ili.toFixed(2)}
        </KpiCard>
        <KpiCard label="CARL">
          {activeReport.carlLitersPerConnDay.toFixed(1)}{" "}
          <span style={{ fontSize: "10px", color: "#8b949e" }}>L/conn/d</span>
        </KpiCard>
        <KpiCard label="UARL">
          {activeReport.uarlLitersPerConnDay.toFixed(1)}{" "}
          <span style={{ fontSize: "10px", color: "#8b949e" }}>L/conn/d</span>
        </KpiCard>
        <KpiCard label="Real Losses">
          {realPct.toFixed(1)}%{" "}
          <span style={{ fontSize: "10px", color: "#8b949e" }}>
            ({(activeReport.realLossesM3 / 1e6).toFixed(2)} Mm³)
          </span>
        </KpiCard>
        <KpiCard label="Loss Cost">
          ${(activeReport.annualLossCostUsd / 1e6).toFixed(2)}M{" "}
          <span style={{ fontSize: "10px", color: "#8b949e" }}>/yr</span>
        </KpiCard>
        <KpiCard label="Recoverable" highlight valueColor="#3fb950">
          ${(activeReport.recoverableRevenueUsd / 1e6).toFixed(2)}M{" "}
          <span style={{ fontSize: "10px", color: "#8b949e" }}>/yr</span>
        </KpiCard>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: 12,
          borderRadius: 6,
          background: "var(--ms-bg-elv, var(--bgColor-muted, #1e1e22))",
          border: "1px solid var(--ms-border-subtle, var(--color-border-subtle, #30363d))",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: 600 }}>
          <span>Top-Down Water Balance</span>
          <span style={{ color: "var(--ms-text-2, var(--color-fg-muted, #8b949e))" }}>
            Total Input: {(activeReport.systemInputVolumeM3 / 1e6).toFixed(1)} Mm³/yr
          </span>
        </div>

        <div
          style={{
            display: "flex",
            height: 24,
            borderRadius: 4,
            overflow: "hidden",
            background: "rgba(255, 255, 255, 0.05)",
          }}
        >
          <StackedBarSegment pct={authPct} color="#238636" title={`Authorized: ${authPct.toFixed(1)}%`} />
          <StackedBarSegment pct={apparentPct} color="#9a6700" title={`Apparent Losses: ${apparentPct.toFixed(1)}%`} />
          <StackedBarSegment pct={realPct} color="#da3633" title={`Real Losses: ${realPct.toFixed(1)}%`} />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
            fontSize: 11,
            color: "var(--ms-text-2, var(--color-fg-muted, #8b949e))",
            marginTop: 4,
          }}
        >
          <LegendItem color="#238636" label={`Authorized Consumption (${authPct.toFixed(1)}%)`} />
          <LegendItem color="#9a6700" label={`Apparent Losses (${apparentPct.toFixed(1)}%)`} />
          <LegendItem color="#da3633" label={`Real Leakage Losses (${realPct.toFixed(1)}%)`} />
        </div>
      </div>

      <div
        style={{
          fontSize: "12px",
          color: "var(--ms-text-2, var(--color-fg-muted, #8b949e))",
          fontStyle: "italic",
        }}
      >
        {activeReport.summary}
      </div>
    </CardContainer>
  );
};

export default React.memo(AwwaM36WaterLossCard);

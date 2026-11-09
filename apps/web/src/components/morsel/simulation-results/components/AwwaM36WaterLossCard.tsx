// SPDX-License-Identifier: AGPL-3.0-or-later

import { DownloadIcon, GraphIcon, XIcon } from "@primer/octicons-react";
import React from "react";
import styled from "styled-components";

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

const BandBadge = styled.span<{ $band: "Band A" | "Band B" | "Band C" | "Band D" }>`
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
    p.$band === "Band A"
      ? "var(--color-success-emphasis, #238636)"
      : p.$band === "Band B"
        ? "var(--color-accent-emphasis, #1f6feb)"
        : p.$band === "Band C"
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

const KpiGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 8px;
`;

const KpiCard = styled.div<{ $highlight?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--color-canvas-default, #161b22);
  border: 1px solid
    ${(p) => (p.$highlight ? "var(--color-accent-emphasis, #1f6feb)" : "var(--color-border-subtle, #30363d)")};

  & > span:first-child {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--color-fg-muted, #8b949e);
  }

  & > div:last-child {
    font-size: 16px;
    font-weight: 700;
    color: ${(p) => (p.$highlight ? "var(--color-accent-fg, #58a6ff)" : "var(--color-fg-default, #c9d1d9)")};
  }
`;

const WaterBalanceSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-radius: 6px;
  background: var(--color-canvas-default, #161b22);
  border: 1px solid var(--color-border-subtle, #30363d);
`;

const StackedBar = styled.div`
  display: flex;
  height: 24px;
  border-radius: 4px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
`;

const BarSegment = styled.div<{ $fraction: number; $color: string }>`
  width: ${(p) => Math.max(0, Math.min(100, p.$fraction * 100))}%;
  background: ${(p) => p.$color};
  transition: width 0.3s ease;
`;

const LegendRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--color-fg-muted, #8b949e);
  margin-top: 4px;
`;

const LegendItem = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;

  & > span:first-child {
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }
`;

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

  return (
    <CardContainer $isDark={isDark} data-testid="awwa-m36-water-loss-card">
      <HeaderRow>
        <TitleGroup>
          <GraphIcon size={20} fill="#58a6ff" />
          <div>
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>AWWA M36 Water Audit &amp; Loss Control</h3>
            <span style={{ fontSize: "11px", color: "var(--color-fg-muted, #8b949e)" }}>
              {activeReport.utilityName} • Audit Year {activeReport.auditYear}
            </span>
          </div>
        </TitleGroup>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BandBadge $band={activeReport.iliBand}>
            {activeReport.iliBand} (ILI {activeReport.ili.toFixed(2)})
          </BandBadge>
          <ActionButtons>
            <ActionBtn type="button" onClick={handleExport} title="Export JSON Audit">
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

      <KpiGrid>
        <KpiCard $highlight={true}>
          <span>ILI Index</span>
          <div>{activeReport.ili.toFixed(2)}</div>
        </KpiCard>
        <KpiCard>
          <span>CARL</span>
          <div>
            {activeReport.carlLitersPerConnDay.toFixed(1)}{" "}
            <span style={{ fontSize: "10px", color: "#8b949e" }}>L/conn/d</span>
          </div>
        </KpiCard>
        <KpiCard>
          <span>UARL</span>
          <div>
            {activeReport.uarlLitersPerConnDay.toFixed(1)}{" "}
            <span style={{ fontSize: "10px", color: "#8b949e" }}>L/conn/d</span>
          </div>
        </KpiCard>
        <KpiCard>
          <span>Real Losses</span>
          <div>
            {realPct.toFixed(1)}%{" "}
            <span style={{ fontSize: "10px", color: "#8b949e" }}>
              ({(activeReport.realLossesM3 / 1e6).toFixed(2)} Mm³)
            </span>
          </div>
        </KpiCard>
        <KpiCard>
          <span>Loss Cost</span>
          <div>
            ${(activeReport.annualLossCostUsd / 1e6).toFixed(2)}M{" "}
            <span style={{ fontSize: "10px", color: "#8b949e" }}>/yr</span>
          </div>
        </KpiCard>
        <KpiCard $highlight={true}>
          <span>Recoverable</span>
          <div style={{ color: "#3fb950" }}>
            ${(activeReport.recoverableRevenueUsd / 1e6).toFixed(2)}M{" "}
            <span style={{ fontSize: "10px", color: "#8b949e" }}>/yr</span>
          </div>
        </KpiCard>
      </KpiGrid>

      <WaterBalanceSection>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: 600 }}>
          <span>Top-Down Water Balance</span>
          <span style={{ color: "var(--color-fg-muted, #8b949e)" }}>
            Total Input: {(activeReport.systemInputVolumeM3 / 1e6).toFixed(1)} Mm³/yr
          </span>
        </div>

        <StackedBar>
          <BarSegment $fraction={authPct / 100} $color="#238636" title={`Authorized: ${authPct.toFixed(1)}%`} />
          <BarSegment
            $fraction={apparentPct / 100}
            $color="#9a6700"
            title={`Apparent Losses: ${apparentPct.toFixed(1)}%`}
          />
          <BarSegment $fraction={realPct / 100} $color="#da3633" title={`Real Losses: ${realPct.toFixed(1)}%`} />
        </StackedBar>

        <LegendRow>
          <LegendItem>
            <span style={{ background: "#238636" }} />
            <span>Authorized Consumption ({authPct.toFixed(1)}%)</span>
          </LegendItem>
          <LegendItem>
            <span style={{ background: "#9a6700" }} />
            <span>Apparent Losses ({apparentPct.toFixed(1)}%)</span>
          </LegendItem>
          <LegendItem>
            <span style={{ background: "#da3633" }} />
            <span>Real Leakage Losses ({realPct.toFixed(1)}%)</span>
          </LegendItem>
        </LegendRow>
      </WaterBalanceSection>

      <div style={{ fontSize: "12px", color: "var(--color-fg-muted, #8b949e)", fontStyle: "italic" }}>
        {activeReport.summary}
      </div>
    </CardContainer>
  );
};

export default React.memo(AwwaM36WaterLossCard);

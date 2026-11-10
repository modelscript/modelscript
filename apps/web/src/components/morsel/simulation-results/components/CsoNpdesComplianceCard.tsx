// SPDX-License-Identifier: AGPL-3.0-or-later

import { exportNetDmrXml } from "@modelscript/swmm";
import { CheckCircleFillIcon, DownloadIcon, WorkflowIcon, XCircleFillIcon, XIcon } from "@primer/octicons-react";
import React from "react";
import styled from "styled-components";

export interface CsoOutfallSummary {
  outfallId: string;
  receivingWater: string;
  annualEvents: number; // Permit limit <= 4 / yr
  annualSpillVolumeM3: number;
  peakRateM3s: number;
  compliant: boolean;
}

export interface CsoNpdesComplianceReport {
  utilityName: string;
  permitId: string; // e.g. "NPDES-MA0100456"
  evaluatedYear: number;
  evaluatedAt: string;
  totalAnnualEvents: number; // Presumptive limit <= 4
  maxEventsLimit: number; // default 4
  volumetricCapturePct: number; // Target >= 85.0%
  targetCapturePct: number; // default 85.0%
  totalSpillVolumeM3: number;
  rtcVolumeDivertedM3?: number; // Storage/RTC diversion
  outfalls: CsoOutfallSummary[];
  status: "Compliant" | "Permit Exceeded" | "Warning";
  summary: string;
}

export interface CsoNpdesComplianceCardProps {
  report?: CsoNpdesComplianceReport | null | undefined;
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

const StatusBadge = styled.span<{ $status: "Compliant" | "Permit Exceeded" | "Warning" }>`
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
      : p.$status === "Warning"
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

const OutfallsTable = styled.table<{ $isDark: boolean }>`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  background: var(--color-canvas-default, ${(p) => (p.$isDark ? "#161b22" : "#ffffff")});
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--color-border-subtle, #eaecef);

  th,
  td {
    padding: 8px 12px;
    text-align: left;
    border-bottom: 1px solid var(--color-border-subtle, #eaecef);
  }

  th {
    font-weight: 600;
    color: var(--color-fg-muted, #57606a);
    background: var(--color-canvas-subtle, ${(p) => (p.$isDark ? "#21262d" : "#f6f8fa")});
  }
`;

const DEFAULT_REPORT: CsoNpdesComplianceReport = {
  utilityName: "Greater Harbor Water & Sewer Commission",
  permitId: "NPDES-MA0101832",
  evaluatedYear: 2026,
  evaluatedAt: new Date().toISOString(),
  totalAnnualEvents: 3,
  maxEventsLimit: 4,
  volumetricCapturePct: 91.4,
  targetCapturePct: 85.0,
  totalSpillVolumeM3: 14500,
  rtcVolumeDivertedM3: 48200,
  outfalls: [
    {
      outfallId: "CSO-001",
      receivingWater: "Harbor Tidal Basin",
      annualEvents: 2,
      annualSpillVolumeM3: 8200,
      peakRateM3s: 1.45,
      compliant: true,
    },
    {
      outfallId: "CSO-002",
      receivingWater: "Charles River Estuary",
      annualEvents: 1,
      annualSpillVolumeM3: 6300,
      peakRateM3s: 0.95,
      compliant: true,
    },
  ],
  status: "Compliant",
  summary:
    "System meets Clean Water Act presumptive approach: 3 overflow events (permit limit <= 4/yr) and 91.4% volumetric capture (target >= 85%).",
};

export const CsoNpdesComplianceCard: React.FC<CsoNpdesComplianceCardProps> = ({
  report = DEFAULT_REPORT,
  onClose,
  onExportJson,
  colorMode = "light",
}) => {
  const isDark = colorMode === "dark";
  const data = report || DEFAULT_REPORT;

  const isEventsExceeded = data.totalAnnualEvents > data.maxEventsLimit;
  const isCaptureDeficient = data.volumetricCapturePct < data.targetCapturePct;

  const computedStatus: "Compliant" | "Permit Exceeded" | "Warning" = isEventsExceeded
    ? "Permit Exceeded"
    : isCaptureDeficient
      ? "Warning"
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
    a.download = `cso-npdes-compliance-${data.permitId || "report"}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportXml = () => {
    const xml = exportNetDmrXml({
      permitNumber: data.permitId || "NPDES-MA0101832",
      facilityName: data.utilityName,
      monitoringPeriodStart: `${data.evaluatedYear}-01-01`,
      monitoringPeriodEnd: `${data.evaluatedYear}-12-31`,
      evaluatedYear: data.evaluatedYear,
      presumptiveApproach: {
        maxEventsPermitted: data.maxEventsLimit,
        minVolumetricCapturePct: data.targetCapturePct,
        observedVolumetricCapturePct: data.volumetricCapturePct,
        totalSystemEvents: data.totalAnnualEvents,
        presumptiveCompliant:
          data.totalAnnualEvents <= data.maxEventsLimit && data.volumetricCapturePct >= data.targetCapturePct,
      },
      totalSystemSpillVolumeM3: data.totalSpillVolumeM3,
      rtcVolumeDivertedM3: data.rtcVolumeDivertedM3,
      outfalls: (data.outfalls || []).map((of) => ({
        outfallId: of.outfallId,
        receivingWater: of.receivingWater,
        totalEventsCount: of.annualEvents,
        totalSpillVolumeM3: of.annualSpillVolumeM3,
        peakSpillRateM3s: of.peakRateM3s,
        parameters: [
          {
            parameterCode: "74055",
            parameterName: "CSO Event Count",
            value: of.annualEvents,
            unit: "EVENTS",
            statisticalBaseCode: "COUNT",
            exceedance: of.annualEvents > data.maxEventsLimit,
            permitLimit: data.maxEventsLimit,
          },
          {
            parameterCode: "50050",
            parameterName: "Flow, in conduit or through treatment plant",
            value: of.annualSpillVolumeM3,
            unit: "M3",
            statisticalBaseCode: "TOTAL",
            exceedance: false,
          },
        ],
        compliant: of.compliant,
      })),
      overallStatus: computedStatus,
    });

    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `netdmr-${data.permitId || "cso"}.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <CardContainer $isDark={isDark}>
      <HeaderRow>
        <TitleGroup>
          <WorkflowIcon size={20} fill={computedStatus === "Compliant" ? "#238636" : "#da3633"} />
          <div>
            <div style={{ fontWeight: 700, fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>CWA CSO NPDES Permit Compliance</span>
              <StatusBadge $status={computedStatus}>
                {computedStatus === "Compliant" ? <CheckCircleFillIcon size={12} /> : <XCircleFillIcon size={12} />}
                {computedStatus}
              </StatusBadge>
            </div>
            <div style={{ fontSize: "12px", color: "var(--color-fg-muted, #57606a)", marginTop: "2px" }}>
              {data.utilityName} &bull; {data.permitId} &bull; Calendar Year {data.evaluatedYear}
            </div>
          </div>
        </TitleGroup>

        <ActionButtons>
          <ActionBtn onClick={handleExportXml} aria-label="Export NetDMR XML">
            <DownloadIcon size={14} />
            Export NetDMR XML
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

      {/* Primary Presumptive Criteria Metrics */}
      <MetricGrid>
        <MetricTile $isDark={isDark} $alert={isEventsExceeded}>
          <MetricLabel>Annual CSO Events</MetricLabel>
          <MetricValue $color={isEventsExceeded ? "#da3633" : "#238636"}>
            {data.totalAnnualEvents} <span style={{ fontSize: "12px" }}>/ year</span>
          </MetricValue>
          <MetricSub>Presumptive Limit: &le; {data.maxEventsLimit} events/yr</MetricSub>
        </MetricTile>

        <MetricTile $isDark={isDark} $alert={isCaptureDeficient}>
          <MetricLabel>Volumetric Capture</MetricLabel>
          <MetricValue $color={isCaptureDeficient ? "#9a6700" : "#238636"}>
            {data.volumetricCapturePct.toFixed(1)}%
          </MetricValue>
          <MetricSub>EPA Criteria: &ge; {data.targetCapturePct.toFixed(1)}%</MetricSub>
        </MetricTile>

        <MetricTile $isDark={isDark}>
          <MetricLabel>Total CSO Spill Volume</MetricLabel>
          <MetricValue>
            {(data.totalSpillVolumeM3 / 1000).toFixed(1)} <span style={{ fontSize: "12px" }}>k-m³</span>
          </MetricValue>
          <MetricSub>{data.totalSpillVolumeM3.toLocaleString()} m³ discharged</MetricSub>
        </MetricTile>

        <MetricTile $isDark={isDark}>
          <MetricLabel>RTC / Storage Diverted</MetricLabel>
          <MetricValue $color="#1f6feb">
            {((data.rtcVolumeDivertedM3 ?? 0) / 1000).toFixed(1)} <span style={{ fontSize: "12px" }}>k-m³</span>
          </MetricValue>
          <MetricSub>Volume saved via control</MetricSub>
        </MetricTile>
      </MetricGrid>

      {/* Outfalls Breakdown Table */}
      {data.outfalls && data.outfalls.length > 0 && (
        <OutfallsTable $isDark={isDark}>
          <thead>
            <tr>
              <th>Outfall</th>
              <th>Receiving Water</th>
              <th>Annual Events</th>
              <th>Spill Vol (m³)</th>
              <th>Peak Rate (m³/s)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.outfalls.map((of) => (
              <tr key={of.outfallId}>
                <td style={{ fontWeight: 600 }}>{of.outfallId}</td>
                <td>{of.receivingWater}</td>
                <td>
                  <span
                    style={{ color: of.annualEvents > data.maxEventsLimit ? "#da3633" : undefined, fontWeight: 600 }}
                  >
                    {of.annualEvents}
                  </span>{" "}
                  / {data.maxEventsLimit}
                </td>
                <td>{of.annualSpillVolumeM3.toLocaleString()}</td>
                <td>{of.peakRateM3s.toFixed(2)}</td>
                <td>
                  <span style={{ color: of.compliant ? "#238636" : "#da3633", fontWeight: 600 }}>
                    {of.compliant ? "PASS" : "EXCEED"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </OutfallsTable>
      )}
    </CardContainer>
  );
};

export default React.memo(CsoNpdesComplianceCard);

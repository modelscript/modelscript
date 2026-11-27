// SPDX-License-Identifier: AGPL-3.0-or-later

import { exportNetDmrXml } from "@modelscript/swmm";
import { CheckCircleFillIcon, DownloadIcon, WorkflowIcon, XCircleFillIcon, XIcon } from "@primer/octicons-react";
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
  StatusPill,
  TitleGroup,
} from "./ComplianceCardPrimitives";

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

const statusToTone = (status: "Compliant" | "Permit Exceeded" | "Warning"): ComplianceTone =>
  status === "Compliant" ? "success" : status === "Warning" ? "warning" : "danger";

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

  const borderSubtle = `var(--ms-border-subtle, var(--color-border-subtle, ${isDark ? "#30363d" : "#eaecef"}))`;
  const cellStyle: React.CSSProperties = {
    padding: "8px 12px",
    textAlign: "left",
    borderBottom: `1px solid ${borderSubtle}`,
  };
  const headerCellStyle: React.CSSProperties = {
    ...cellStyle,
    fontWeight: 600,
    color: "var(--ms-text-2, var(--color-fg-muted, #57606a))",
    background: `var(--ms-bg-subtle, var(--color-canvas-subtle, ${isDark ? "#21262d" : "#f6f8fa"}))`,
  };

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
    <CardContainer isDark={isDark}>
      <HeaderRow>
        <TitleGroup>
          <WorkflowIcon size={20} fill={computedStatus === "Compliant" ? "#238636" : "#da3633"} />
          <div>
            <div style={{ fontWeight: 700, fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>CWA CSO NPDES Permit Compliance</span>
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
              {data.utilityName} &bull; {data.permitId} &bull; Calendar Year {data.evaluatedYear}
            </div>
          </div>
        </TitleGroup>

        <ActionButtons>
          <ActionBtn isDark={isDark} compact onClick={handleExportXml} aria-label="Export NetDMR XML">
            <DownloadIcon size={14} />
            Export NetDMR XML
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

      {/* Primary Presumptive Criteria Metrics */}
      <MetricGrid>
        <MetricTile isDark={isDark} alert={isEventsExceeded}>
          <MetricLabel>Annual CSO Events</MetricLabel>
          <MetricValue color={isEventsExceeded ? "#da3633" : "#238636"}>
            {data.totalAnnualEvents} <span style={{ fontSize: "12px" }}>/ year</span>
          </MetricValue>
          <MetricSub>Presumptive Limit: &le; {data.maxEventsLimit} events/yr</MetricSub>
        </MetricTile>

        <MetricTile isDark={isDark} alert={isCaptureDeficient}>
          <MetricLabel>Volumetric Capture</MetricLabel>
          <MetricValue color={isCaptureDeficient ? "#9a6700" : "#238636"}>
            {data.volumetricCapturePct.toFixed(1)}%
          </MetricValue>
          <MetricSub>EPA Criteria: &ge; {data.targetCapturePct.toFixed(1)}%</MetricSub>
        </MetricTile>

        <MetricTile isDark={isDark}>
          <MetricLabel>Total CSO Spill Volume</MetricLabel>
          <MetricValue>
            {(data.totalSpillVolumeM3 / 1000).toFixed(1)} <span style={{ fontSize: "12px" }}>k-m³</span>
          </MetricValue>
          <MetricSub>{data.totalSpillVolumeM3.toLocaleString()} m³ discharged</MetricSub>
        </MetricTile>

        <MetricTile isDark={isDark}>
          <MetricLabel>RTC / Storage Diverted</MetricLabel>
          <MetricValue color="var(--ms-brand, var(--fgColor-accent, #0969da))">
            {((data.rtcVolumeDivertedM3 ?? 0) / 1000).toFixed(1)} <span style={{ fontSize: "12px" }}>k-m³</span>
          </MetricValue>
          <MetricSub>Volume saved via control</MetricSub>
        </MetricTile>
      </MetricGrid>

      {/* Outfalls Breakdown Table */}
      {data.outfalls && data.outfalls.length > 0 && (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12,
            background: `var(--ms-bg-elv, var(--bgColor-muted, ${isDark ? "#1e1e22" : "#ffffff"}))`,
            borderRadius: 8,
            overflow: "hidden",
            border: `1px solid ${borderSubtle}`,
          }}
        >
          <thead>
            <tr>
              <th style={headerCellStyle}>Outfall</th>
              <th style={headerCellStyle}>Receiving Water</th>
              <th style={headerCellStyle}>Annual Events</th>
              <th style={headerCellStyle}>Spill Vol (m³)</th>
              <th style={headerCellStyle}>Peak Rate (m³/s)</th>
              <th style={headerCellStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.outfalls.map((of) => (
              <tr key={of.outfallId}>
                <td style={{ ...cellStyle, fontWeight: 600 }}>{of.outfallId}</td>
                <td style={cellStyle}>{of.receivingWater}</td>
                <td style={cellStyle}>
                  <span
                    style={{ color: of.annualEvents > data.maxEventsLimit ? "#da3633" : undefined, fontWeight: 600 }}
                  >
                    {of.annualEvents}
                  </span>{" "}
                  / {data.maxEventsLimit}
                </td>
                <td style={cellStyle}>{of.annualSpillVolumeM3.toLocaleString()}</td>
                <td style={cellStyle}>{of.peakRateM3s.toFixed(2)}</td>
                <td style={cellStyle}>
                  <span style={{ color: of.compliant ? "#238636" : "#da3633", fontWeight: 600 }}>
                    {of.compliant ? "PASS" : "EXCEED"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </CardContainer>
  );
};

export default React.memo(CsoNpdesComplianceCard);

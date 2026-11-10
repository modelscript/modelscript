// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/swmm — EPA NetDMR / ICIS-NPDES Electronic Regulatory Exporter
 *
 * Implements standard Electronic Reporting Rule (40 CFR Part 127) schemas for
 * Clean Water Act (CWA) Combined Sewer Overflow (CSO) National Pollutant
 * Discharge Elimination System (NPDES) permits:
 * - Discharge Monitoring Report (DMR) XML payload for EPA Central Data Exchange (CDX)
 * - Outfall overflow frequency, event duration, total volume (m3/Mgal), and peak discharge
 * - Pollutant mass loadings (Total Suspended Solids - TSS, Biochemical Oxygen Demand - BOD5)
 * - Presumptive Approach demonstration (<= 4 events/yr and >= 85% volumetric capture).
 */

export interface NetDmrOutfallParameter {
  parameterCode: string; // e.g. "74055" (CSO Event Count), "50050" (Flow Total), "00530" (TSS)
  parameterName: string;
  value: number;
  unit: string; // "EVENTS", "MGAL", "M3", "MG/L", "KG"
  statisticalBaseCode: "TOTAL" | "AVERAGE" | "MAXIMUM" | "COUNT";
  exceedance: boolean;
  permitLimit?: number | undefined;
}

export interface NetDmrOutfallDischarge {
  outfallId: string;
  receivingWater: string;
  latitude?: number | undefined;
  longitude?: number | undefined;
  totalEventsCount: number;
  totalSpillVolumeM3: number;
  peakSpillRateM3s: number;
  parameters: NetDmrOutfallParameter[];
  compliant: boolean;
}

export interface NetDmrPermitDossier {
  permitNumber: string; // e.g. "NPDES-MA0100456"
  facilityName: string;
  monitoringPeriodStart: string; // e.g. "2026-01-01"
  monitoringPeriodEnd: string; // e.g. "2026-12-31"
  evaluatedYear: number;
  presumptiveApproach: {
    maxEventsPermitted: number; // typically 4 events/year
    minVolumetricCapturePct: number; // typically 85.0%
    observedVolumetricCapturePct: number;
    totalSystemEvents: number;
    presumptiveCompliant: boolean;
  };
  totalSystemSpillVolumeM3: number;
  rtcVolumeDivertedM3?: number | undefined;
  outfalls: NetDmrOutfallDischarge[];
  overallStatus: "Compliant" | "Permit Exceeded" | "Warning";
  certifierName?: string | undefined;
  certifierTitle?: string | undefined;
  signatureDate?: string | undefined;
}

/**
 * Serializes the NPDES DMR data to EPA CDX / ICIS-NPDES standard XML schema.
 */
export function exportNetDmrXml(dossier: NetDmrPermitDossier): string {
  const outfallXml = dossier.outfalls
    .map((of) => {
      const paramXml = of.parameters
        .map(
          (p) => `        <ParameterRecord>
          <ParameterCode>${p.parameterCode}</ParameterCode>
          <ParameterName>${p.parameterName}</ParameterName>
          <ReportedValue>${p.value.toFixed(2)}</ReportedValue>
          <UnitCode>${p.unit}</UnitCode>
          <StatisticalBase>${p.statisticalBaseCode}</StatisticalBase>
          <PermitLimit>${p.permitLimit !== undefined ? p.permitLimit.toFixed(2) : "NONE"}</PermitLimit>
          <ExceedanceIndicator>${p.exceedance ? "Y" : "N"}</ExceedanceIndicator>
        </ParameterRecord>`,
        )
        .join("\n");

      return `      <PermittedFeature>
        <PermittedFeatureIdentifier>${of.outfallId}</PermittedFeatureIdentifier>
        <ReceivingWaterBody>${of.receivingWater}</ReceivingWaterBody>
        <AnnualOverflowEvents>${of.totalEventsCount}</AnnualOverflowEvents>
        <DischargeVolumeM3>${of.totalSpillVolumeM3.toFixed(1)}</DischargeVolumeM3>
        <PeakDischargeRateM3s>${of.peakSpillRateM3s.toFixed(3)}</PeakDischargeRateM3s>
        <Parameters>
${paramXml}
        </Parameters>
      </PermittedFeature>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ElectronicDischargeMonitoringReport xmlns="http://www.epa.gov/icis-npdes/netdmr">
  <Header>
    <NPDESPermitNumber>${dossier.permitNumber}</NPDESPermitNumber>
    <FacilityName>${dossier.facilityName}</FacilityName>
    <MonitoringPeriodStartDate>${dossier.monitoringPeriodStart}</MonitoringPeriodStartDate>
    <MonitoringPeriodEndDate>${dossier.monitoringPeriodEnd}</MonitoringPeriodEndDate>
    <ReportType>ANNUAL_CSO_LONG_TERM_CONTROL_PLAN</ReportType>
    <GeneratedBy>ModelScript EPA SWMM Engine v0.1.0</GeneratedBy>
  </Header>
  <PresumptiveCriteria>
    <AnnualOverflowLimit>${dossier.presumptiveApproach.maxEventsPermitted}</AnnualOverflowLimit>
    <TargetVolumetricCapturePct>${dossier.presumptiveApproach.minVolumetricCapturePct.toFixed(1)}</TargetVolumetricCapturePct>
    <ObservedVolumetricCapturePct>${dossier.presumptiveApproach.observedVolumetricCapturePct.toFixed(1)}</ObservedVolumetricCapturePct>
    <PresumptiveCompliant>${dossier.presumptiveApproach.presumptiveCompliant ? "true" : "false"}</PresumptiveCompliant>
  </PresumptiveCriteria>
  <DischargeMonitoringReports>
${outfallXml}
  </DischargeMonitoringReports>
  <Certification>
    <CertifierName>${dossier.certifierName ?? "Authorized Environmental Engineer"}</CertifierName>
    <CertifierTitle>${dossier.certifierTitle ?? "Director of Wastewater Operations"}</CertifierTitle>
    <SignatureDate>${dossier.signatureDate ?? new Date().toISOString()}</SignatureDate>
    <CertificationStatement>I certify under penalty of law that this document was prepared under my direction or supervision in accordance with a system designed to assure that qualified personnel properly gather and evaluate the information submitted.</CertificationStatement>
  </Certification>
</ElectronicDischargeMonitoringReport>
`;
}

/**
 * Serializes outfall discharge monitoring records to CSV.
 */
export function exportNetDmrCsv(dossier: NetDmrPermitDossier): string {
  const headers = [
    "PermitNumber",
    "FacilityName",
    "OutfallID",
    "ReceivingWater",
    "AnnualEvents",
    "TotalSpillVolume_m3",
    "PeakSpillRate_m3s",
    "ParameterCode",
    "ParameterName",
    "Value",
    "Unit",
    "PermitLimit",
    "Exceeded",
  ];

  const rows: string[] = [];
  for (const of of dossier.outfalls) {
    for (const p of of.parameters) {
      rows.push(
        [
          `"${dossier.permitNumber}"`,
          `"${dossier.facilityName}"`,
          `"${of.outfallId}"`,
          `"${of.receivingWater}"`,
          of.totalEventsCount,
          of.totalSpillVolumeM3.toFixed(1),
          of.peakSpillRateM3s.toFixed(3),
          `"${p.parameterCode}"`,
          `"${p.parameterName}"`,
          p.value.toFixed(2),
          `"${p.unit}"`,
          p.permitLimit !== undefined ? p.permitLimit.toFixed(2) : '""',
          p.exceedance ? '"YES"' : '"NO"',
        ].join(","),
      );
    }
  }

  return [headers.join(","), ...rows].join("\n");
}

/**
 * Generates an executive Markdown summary for the annual CSO NPDES filing.
 */
export function generateCsoComplianceReport(dossier: NetDmrPermitDossier): string {
  const p = dossier.presumptiveApproach;
  return `# Clean Water Act CSO NPDES Annual Compliance Report
**Facility:** ${dossier.facilityName} (${dossier.permitNumber})  
**Calendar Year:** ${dossier.evaluatedYear}  
**Status:** **${dossier.overallStatus.toUpperCase()}**  

---

## 1. EPA Presumptive Approach Demonstration
- **Annual CSO Overflow Events:** **${p.totalSystemEvents} events** (Permit Limit: $\\le ${p.maxEventsPermitted}\\text{ events/year}$)
- **System Volumetric Capture:** **${p.observedVolumetricCapturePct.toFixed(1)}%** (Regulatory Criteria: $\\ge ${p.minVolumetricCapturePct.toFixed(1)}\\%$)
- **Presumptive Approach Status:** ${p.presumptiveCompliant ? "✅ COMPLIANT" : "❌ EXCEEDED"}
- **Total Combined Volume Discharged:** ${(dossier.totalSystemSpillVolumeM3 / 1000).toFixed(1)} k-$m^3$
${dossier.rtcVolumeDivertedM3 ? `- **Volume Diverted via Real-Time Control (RTC):** ${(dossier.rtcVolumeDivertedM3 / 1000).toFixed(1)} k-$m^3$` : ""}

## 2. Permitted Outfalls Summary
| Outfall ID | Receiving Water | Annual Events | Discharge ($m^3$) | Peak Rate ($m^3/s$) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
${dossier.outfalls
  .map(
    (of) =>
      `| **${of.outfallId}** | ${of.receivingWater} | ${of.totalEventsCount} | ${of.totalSpillVolumeM3.toLocaleString()} | ${of.peakSpillRateM3s.toFixed(2)} | ${of.compliant ? "✅ PASS" : "❌ EXCEED"} |`,
  )
  .join("\n")}

---
*Generated by ModelScript EPA SWMM Regulatory Engine v0.1.0*
`;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — EPA Lead and Copper Rule Improvements (LCRI) Regulatory Exporter
 *
 * Implements standard reporting schemas mandated by the US EPA Lead and Copper Rule
 * Improvements (LCRI, 40 CFR Part 141 Subpart I):
 * - Service Line Inventory submission table (Public-side, Private-side, GRR, Unknowns)
 * - 10-year mandatory replacement tracking (>= 10% annual pace)
 * - 90th percentile Lead concentration verification (10 ppb Action Level threshold)
 * - Water Quality Parameter (WQP) corrosion inhibitor residual (orthophosphate >= 0.5 mg/L, pH >= 7.2)
 */

export type ServiceLineMaterial =
  | "Lead"
  | "Galvanized Requiring Replacement"
  | "Non-Lead"
  | "Lead Status Unknown";

export type LineClassification = "Lead" | "GRR" | "Non-Lead" | "Unknown";

export type VerificationMethod =
  | "Field Inspection"
  | "Plumbing Records"
  | "Water Quality Sampling"
  | "Predictive Model"
  | "Installation Date";

export interface LcriServiceLineRecord {
  serviceLineId: string;
  streetAddress: string;
  utilitySideMaterial: ServiceLineMaterial;
  customerSideMaterial: ServiceLineMaterial;
  classification: LineClassification;
  verificationMethod: VerificationMethod;
  installationYear: number;
  diameterMm: number;
  scheduledReplacementYear?: number | undefined;
  p90LeadPpb?: number | undefined;
}

export interface LcriComplianceDossier {
  pwsid: string;
  utilityName: string;
  reportingYear: number;
  inventorySummary: {
    totalServiceLines: number;
    leadCount: number;
    grrCount: number;
    unknownCount: number;
    nonLeadCount: number;
    annualReplacementRatePct: number;
    statutory10YearCompliant: boolean;
  };
  samplingMetrics: {
    p90LeadPpb: number;
    p90CopperPpb: number;
    actionLevelLeadPpb: number; // 10.0 ppb under LCRI
    actionLevelExceeded: boolean;
    samplesCount: number;
    samplingPeriod: string;
  };
  corrosionControl: {
    orthophosphateMgL: number;
    wqpMinTargetMgL: number;
    phMean: number;
    phMinThreshold: number;
    cctCompliant: boolean;
  };
  serviceLines: LcriServiceLineRecord[];
  overallStatus: "Compliant" | "Action Level Exceeded" | "At Risk";
  certifiedBy?: string | undefined;
  certifiedDate?: string | undefined;
}

/**
 * Serializes the LCRI Service Line Inventory into the official EPA CSV schema format.
 */
export function exportLcriInventoryCsv(dossier: LcriComplianceDossier): string {
  const headers = [
    "PWSID",
    "ServiceLine_ID",
    "Address",
    "Utility_Side_Material",
    "Customer_Side_Material",
    "Entire_Line_Classification",
    "Verification_Method",
    "Install_Year",
    "Diameter_mm",
    "Replacement_Scheduled_Year",
  ];

  const rows = dossier.serviceLines.map((line) => {
    return [
      `"${dossier.pwsid}"`,
      `"${line.serviceLineId}"`,
      `"${line.streetAddress.replace(/"/g, '""')}"`,
      `"${line.utilitySideMaterial}"`,
      `"${line.customerSideMaterial}"`,
      `"${line.classification}"`,
      `"${line.verificationMethod}"`,
      line.installationYear.toString(),
      line.diameterMm.toString(),
      line.scheduledReplacementYear ? line.scheduledReplacementYear.toString() : '""',
    ].join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

/**
 * Serializes the complete LCRI Compliance Dossier into structured JSON for API submission.
 */
export function exportLcriInventoryJson(dossier: LcriComplianceDossier): string {
  return JSON.stringify(dossier, null, 2);
}

/**
 * Generates an official EPA LCRI Executive Compliance Summary Markdown report.
 */
export function generateLcriComplianceReport(dossier: LcriComplianceDossier): string {
  const inv = dossier.inventorySummary;
  const smp = dossier.samplingMetrics;
  const cct = dossier.corrosionControl;

  const leadPct = ((inv.leadCount / (inv.totalServiceLines || 1)) * 100).toFixed(1);
  const grrPct = ((inv.grrCount / (inv.totalServiceLines || 1)) * 100).toFixed(1);
  const unkPct = ((inv.unknownCount / (inv.totalServiceLines || 1)) * 100).toFixed(1);
  const nonLeadPct = ((inv.nonLeadCount / (inv.totalServiceLines || 1)) * 100).toFixed(1);

  return `# EPA LCRI Lead & Copper Rule Compliance Dossier
**Public Water System:** ${dossier.utilityName} (${dossier.pwsid})  
**Evaluation Reporting Year:** ${dossier.reportingYear}  
**Overall Status:** **${dossier.overallStatus.toUpperCase()}**  
${dossier.certifiedBy ? `**Certified By:** ${dossier.certifiedBy} (${dossier.certifiedDate ?? new Date().toISOString()})  ` : ""}

---

## 1. Compliance Metric Overview
| Parameter | Observed | Regulatory Threshold | Status |
| :--- | :--- | :--- | :--- |
| **90th Percentile Lead** | **${smp.p90LeadPpb.toFixed(1)} ppb** | $\\le 10.0\\text{ ppb}$ (Action Level) | ${smp.actionLevelExceeded ? "❌ EXCEEDED" : "✅ COMPLIANT"} |
| **90th Percentile Copper** | **${smp.p90CopperPpb.toFixed(0)} ppb** | $\\le 1,300\\text{ ppb}$ | ${smp.p90CopperPpb > 1300 ? "❌ EXCEEDED" : "✅ COMPLIANT"} |
| **Orthophosphate Residual** | **${cct.orthophosphateMgL.toFixed(2)} mg/L** | $\\ge ${cct.wqpMinTargetMgL.toFixed(2)}\\text{ mg/L}$ | ${cct.cctCompliant ? "✅ PASS" : "⚠️ LOW RESIDUAL"} |
| **Finished Water pH** | **${cct.phMean.toFixed(2)}** | $\\ge ${cct.phMinThreshold.toFixed(2)}$ | ${cct.phMean >= cct.phMinThreshold ? "✅ PASS" : "⚠️ pH DEFICIENT"} |
| **Annual Replacement Rate** | **${inv.annualReplacementRatePct.toFixed(1)}%/yr** | $\\ge 10.0\\%\\text{/yr}$ (10-Yr Plan) | ${inv.statutory10YearCompliant ? "✅ ON TRACK" : "⚠️ BELOW STATUTORY PACE"} |

## 2. Service Line Inventory Breakdown (${inv.totalServiceLines.toLocaleString()} Total Connections)
- **Lead Service Lines (LSL):** ${inv.leadCount.toLocaleString()} (${leadPct}%)
- **Galvanized Requiring Replacement (GRR):** ${inv.grrCount.toLocaleString()} (${grrPct}%)
- **Lead Status Unknown:** ${inv.unknownCount.toLocaleString()} (${unkPct}%)
- **Non-Lead Lines:** ${inv.nonLeadCount.toLocaleString()} (${nonLeadPct}%)

---
*Generated by ModelScript EPA LCRI Regulatory Engine v0.1.0*
`;
}

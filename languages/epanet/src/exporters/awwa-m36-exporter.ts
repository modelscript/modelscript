// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — AWWA M36 Free Water Audit Software (FWAS) Dossier Exporter
 *
 * Implements the standard AWWA/IWA top-down water audit balance structure:
 * - System Input Volume (SIV)
 * - Authorized Consumption (Billed Metered, Billed Unmetered, Unbilled Metered, Unbilled Unmetered)
 * - Apparent Losses (Unauthorized Consumption, Metering Inaccuracies, Data Errors)
 * - Real Losses (Main leaks, Storage overflow, Service connection leaks)
 * - Performance Indicators (CARL, UARL, ILI, Non-Revenue Water %)
 * - Financial valuation of recoverable water losses.
 */

import type { AwwaM36AuditResult } from "../solver/water-loss-audit.js";

export interface AwwaUtilityMeta {
  utilityName: string;
  pwsid?: string | undefined;
  reportingYear?: number | undefined;
  auditorName?: string | undefined;
}

/**
 * Exports AWWA M36 water balance table in standardized CSV format.
 */
export function exportAwwaM36Csv(audit: AwwaM36AuditResult, meta?: AwwaUtilityMeta): string {
  const lines: string[] = [
    `"AWWA M36 Standard Water Audit Report"`,
    `"Utility Name","${meta?.utilityName ?? "Municipal Water System"}"`,
    `"PWSID","${meta?.pwsid ?? "N/A"}"`,
    `"Audit Year","${meta?.reportingYear ?? new Date().getFullYear()}"`,
    `""`,
    `"Water Balance Category","Volume (m3/yr)","% of SIV"`,
    `"System Input Volume (SIV)",${audit.systemInputVolumeM3Year.toFixed(1)},100.0%`,
    `"Authorized Consumption",${audit.authorizedConsumptionM3Year.toFixed(1)},${((audit.authorizedConsumptionM3Year / audit.systemInputVolumeM3Year) * 100).toFixed(1)}%`,
    `"Water Losses Total",${audit.waterLossesM3Year.toFixed(1)},${((audit.waterLossesM3Year / audit.systemInputVolumeM3Year) * 100).toFixed(1)}%`,
    `"  Apparent Losses (Commercial)",${audit.apparentLossesM3Year.toFixed(1)},${((audit.apparentLossesM3Year / audit.systemInputVolumeM3Year) * 100).toFixed(1)}%`,
    `"  Real Losses (Physical Leaks)",${audit.realLossesM3Year.toFixed(1)},${((audit.realLossesM3Year / audit.systemInputVolumeM3Year) * 100).toFixed(1)}%`,
    `"Non-Revenue Water (NRW)",${audit.nonRevenueWaterM3Year.toFixed(1)},${audit.nonRevenueWaterPct.toFixed(1)}%`,
    `""`,
    `"Performance Indicator","Value","Unit"`,
    `"Current Annual Real Losses (CARL)",${audit.carlM3Year.toFixed(1)},"m3/year"`,
    `"Unavoidable Annual Real Losses (UARL)",${audit.uarlM3Year.toFixed(1)},"m3/year"`,
    `"Infrastructure Leakage Index (ILI)",${audit.ili.toFixed(2)},"ratio"`,
    `"Performance Band","${audit.performanceBand}","AWWA Band"`,
    `""`,
    `"Financial Impact","Amount (USD)"`,
    `"Real Losses Cost",${audit.financialImpact.realLossCostUsd.toFixed(2)}`,
    `"Apparent Losses Lost Revenue",${audit.financialImpact.apparentLossRevenueLostUsd.toFixed(2)}`,
    `"Total Annual Loss Cost",${audit.financialImpact.totalAnnualLossUsd.toFixed(2)}`,
  ];

  return lines.join("\n");
}

/**
 * Serializes AWWA M36 audit to JSON.
 */
export function exportAwwaM36Json(audit: AwwaM36AuditResult, meta?: AwwaUtilityMeta): string {
  return JSON.stringify(
    {
      utilityMeta: meta ?? { utilityName: "Municipal Water System" },
      auditDate: new Date().toISOString(),
      waterAudit: audit,
    },
    null,
    2,
  );
}

/**
 * Generates an executive AWWA M36 summary in Markdown.
 */
export function generateAwwaM36Report(audit: AwwaM36AuditResult, meta?: AwwaUtilityMeta): string {
  return `# AWWA M36 Standard Water Audit & Loss Valuation
**Utility:** ${meta?.utilityName ?? "Municipal Water System"} ${meta?.pwsid ? `(${meta.pwsid})` : ""}  
**Audit Calendar Year:** ${meta?.reportingYear ?? new Date().getFullYear()}  
**Infrastructure Leakage Index (ILI):** **${audit.ili.toFixed(2)} (${audit.performanceBand})**  

---

## 1. Top-Down Water Balance Matrix
| Component | Volume ($m^3/\text{yr}$) | % of SIV | Valuation ($) |
| :--- | :--- | :--- | :--- |
| **System Input Volume (SIV)** | **${audit.systemInputVolumeM3Year.toLocaleString()}** | **100.0%** | - |
| **Authorized Consumption** | **${audit.authorizedConsumptionM3Year.toLocaleString()}** | **${((audit.authorizedConsumptionM3Year / audit.systemInputVolumeM3Year) * 100).toFixed(1)}%** | Revenue |
| **Water Losses** | **${audit.waterLossesM3Year.toLocaleString()}** | **${((audit.waterLossesM3Year / audit.systemInputVolumeM3Year) * 100).toFixed(1)}%** | **$${audit.financialImpact.totalAnnualLossUsd.toLocaleString()}** |
| *Apparent Losses (Metering/Theft)* | ${audit.apparentLossesM3Year.toLocaleString()} | ${((audit.apparentLossesM3Year / audit.systemInputVolumeM3Year) * 100).toFixed(1)}% | $${audit.financialImpact.apparentLossRevenueLostUsd.toLocaleString()} |
| *Real Losses (Physical Leaks)* | ${audit.realLossesM3Year.toLocaleString()} | ${((audit.realLossesM3Year / audit.systemInputVolumeM3Year) * 100).toFixed(1)}% | $${audit.financialImpact.realLossCostUsd.toLocaleString()} |

## 2. Technical Performance Indicators
- **Current Annual Real Losses (CARL):** ${audit.carlM3Year.toLocaleString()} $m^3/\text{yr}$
- **Unavoidable Annual Real Losses (UARL):** ${audit.uarlM3Year.toLocaleString()} $m^3/\text{yr}$
- **Non-Revenue Water (NRW):** ${audit.nonRevenueWaterPct.toFixed(1)}% of total production
- **Total Recoverable Annual Value:** **$${audit.financialImpact.totalAnnualLossUsd.toLocaleString()}**

---
*Generated by ModelScript AWWA M36 Loss Audit Engine v0.1.0*
`;
}

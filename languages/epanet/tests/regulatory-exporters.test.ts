// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  exportAwwaM36Csv,
  exportAwwaM36Json,
  exportLcriInventoryCsv,
  exportLcriInventoryJson,
  generateAwwaM36Report,
  generateLcriComplianceReport,
  type AwwaM36AuditResult,
  type LcriComplianceDossier,
} from "../src/index.js";

describe("EPANET Regulatory Dossier Exporters", () => {
  describe("1. EPA LCRI Exporter", () => {
    const mockDossier: LcriComplianceDossier = {
      pwsid: "MA1001248",
      utilityName: "Greater Boston Water System",
      reportingYear: 2026,
      inventorySummary: {
        totalServiceLines: 45000,
        leadCount: 1850,
        grrCount: 1220,
        unknownCount: 3400,
        nonLeadCount: 38530,
        annualReplacementRatePct: 10.5,
        statutory10YearCompliant: true,
      },
      samplingMetrics: {
        p90LeadPpb: 6.8,
        p90CopperPpb: 420,
        actionLevelLeadPpb: 10.0,
        actionLevelExceeded: false,
        samplesCount: 100,
        samplingPeriod: "2026 H1",
      },
      corrosionControl: {
        orthophosphateMgL: 0.82,
        wqpMinTargetMgL: 0.5,
        phMean: 7.55,
        phMinThreshold: 7.2,
        cctCompliant: true,
      },
      serviceLines: [
        {
          serviceLineId: "SL-00101",
          streetAddress: "142 Beacon St, Boston, MA",
          utilitySideMaterial: "Lead",
          customerSideMaterial: "Lead",
          classification: "Lead",
          verificationMethod: "Field Inspection",
          installationYear: 1928,
          diameterMm: 20,
          scheduledReplacementYear: 2027,
          p90LeadPpb: 7.2,
        },
        {
          serviceLineId: "SL-00102",
          streetAddress: "144 Beacon St, Boston, MA",
          utilitySideMaterial: "Non-Lead",
          customerSideMaterial: "Non-Lead",
          classification: "Non-Lead",
          verificationMethod: "Plumbing Records",
          installationYear: 1995,
          diameterMm: 25,
        },
      ],
      overallStatus: "Compliant",
      certifiedBy: "Jane Doe, PE (MA #48921)",
      certifiedDate: "2026-10-15",
    };

    it("serializes LCRI service line inventory to EPA-standard CSV schema", () => {
      const csv = exportLcriInventoryCsv(mockDossier);
      assert.ok(csv.includes("PWSID,ServiceLine_ID,Address"), "CSV header must match standard");
      assert.ok(csv.includes('"MA1001248"'), "PWSID must be included");
      assert.ok(csv.includes('"SL-00101"'), "First service line ID must be present");
      assert.ok(csv.includes('"142 Beacon St, Boston, MA"'), "Address must be present");
      assert.ok(csv.includes("1928,20,2027"), "Install year, diameter, and replacement year present");
    });

    it("serializes LCRI dossier to valid JSON", () => {
      const jsonStr = exportLcriInventoryJson(mockDossier);
      const parsed = JSON.parse(jsonStr) as LcriComplianceDossier;
      assert.strictEqual(parsed.pwsid, "MA1001248");
      assert.strictEqual(parsed.samplingMetrics.p90LeadPpb, 6.8);
      assert.strictEqual(parsed.inventorySummary.statutory10YearCompliant, true);
      assert.strictEqual(parsed.serviceLines.length, 2);
    });

    it("generates markdown executive summary report", () => {
      const report = generateLcriComplianceReport(mockDossier);
      assert.ok(report.includes("EPA LCRI Lead & Copper Rule Compliance Dossier"));
      assert.ok(report.includes("Greater Boston Water System"));
      assert.ok(report.includes("COMPLIANT"));
      assert.ok(report.includes("6.8 ppb"));
    });
  });

  describe("2. AWWA M36 Water Loss Exporter", () => {
    const mockAudit: AwwaM36AuditResult = {
      systemInputVolumeM3Year: 10000000,
      authorizedConsumptionM3Year: 8800000,
      waterLossesM3Year: 1200000,
      apparentLossesM3Year: 300000,
      realLossesM3Year: 900000,
      nonRevenueWaterM3Year: 1200000,
      nonRevenueWaterPct: 12.0,
      carlM3Year: 900000,
      uarlM3Year: 580000,
      ili: 1.55,
      performanceBand: "A",
      financialImpact: {
        realLossCostUsd: 765000,
        apparentLossRevenueLostUsd: 450000,
        totalAnnualLossUsd: 1215000,
      },
      networkStats: {
        totalMainsLengthKm: 450,
        avgSystemPressureM: 45,
        serviceConnectionsCount: 28000,
      },
    };

    it("exports AWWA M36 water balance table to CSV", () => {
      const csv = exportAwwaM36Csv(mockAudit, { utilityName: "Austin Water", reportingYear: 2026 });
      assert.ok(csv.includes("AWWA M36 Standard Water Audit Report"));
      assert.ok(csv.includes("System Input Volume (SIV)"));
      assert.ok(csv.includes("Infrastructure Leakage Index (ILI)"));
      assert.ok(csv.includes('"A"'));
      assert.ok(csv.includes("1.55"));
    });

    it("exports AWWA M36 to JSON", () => {
      const json = exportAwwaM36Json(mockAudit, { utilityName: "Austin Water" });
      const parsed = JSON.parse(json);
      assert.strictEqual(parsed.utilityMeta.utilityName, "Austin Water");
      assert.strictEqual(parsed.waterAudit.ili, 1.55);
      assert.strictEqual(parsed.waterAudit.performanceBand, "A");
    });

    it("generates formatted Markdown report", () => {
      const rpt = generateAwwaM36Report(mockAudit, { utilityName: "Austin Water" });
      assert.ok(rpt.includes("AWWA M36 Standard Water Audit & Loss Valuation"));
      assert.ok(rpt.includes("Austin Water"));
      assert.ok(rpt.includes("1.55 (A)"));
    });
  });
});

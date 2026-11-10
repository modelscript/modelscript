// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  exportNetDmrCsv,
  exportNetDmrXml,
  generateCsoComplianceReport,
  type NetDmrPermitDossier,
} from "../src/index.js";

describe("SWMM NetDMR / ICIS-NPDES Regulatory Exporter", () => {
  const mockDossier: NetDmrPermitDossier = {
    permitNumber: "NPDES-MA0101832",
    facilityName: "Boston Water & Sewer Commission",
    monitoringPeriodStart: "2026-01-01",
    monitoringPeriodEnd: "2026-12-31",
    evaluatedYear: 2026,
    presumptiveApproach: {
      maxEventsPermitted: 4,
      minVolumetricCapturePct: 85.0,
      observedVolumetricCapturePct: 91.4,
      totalSystemEvents: 3,
      presumptiveCompliant: true,
    },
    totalSystemSpillVolumeM3: 14500,
    rtcVolumeDivertedM3: 48200,
    outfalls: [
      {
        outfallId: "CSO-001",
        receivingWater: "Boston Inner Harbor",
        totalEventsCount: 2,
        totalSpillVolumeM3: 8200,
        peakSpillRateM3s: 1.45,
        parameters: [
          {
            parameterCode: "74055",
            parameterName: "CSO Event Count",
            value: 2,
            unit: "EVENTS",
            statisticalBaseCode: "COUNT",
            exceedance: false,
            permitLimit: 4,
          },
          {
            parameterCode: "50050",
            parameterName: "Flow, in conduit or through treatment plant",
            value: 8200,
            unit: "M3",
            statisticalBaseCode: "TOTAL",
            exceedance: false,
          },
          {
            parameterCode: "00530",
            parameterName: "Total Suspended Solids (TSS)",
            value: 85.4,
            unit: "MG/L",
            statisticalBaseCode: "AVERAGE",
            exceedance: false,
          },
        ],
        compliant: true,
      },
    ],
    overallStatus: "Compliant",
    certifierName: "Dr. Arthur Pendelton, PE",
    certifierTitle: "Chief Engineer of Drainage Operations",
    signatureDate: "2026-11-01",
  };

  it("exports valid NetDMR XML adhering to EPA ICIS-NPDES schema", () => {
    const xml = exportNetDmrXml(mockDossier);
    assert.ok(xml.includes('<?xml version="1.0" encoding="UTF-8"?>'), "Must have XML declaration");
    assert.ok(xml.includes("<NPDESPermitNumber>NPDES-MA0101832</NPDESPermitNumber>"));
    assert.ok(xml.includes("<PermittedFeatureIdentifier>CSO-001</PermittedFeatureIdentifier>"));
    assert.ok(xml.includes("<ParameterCode>74055</ParameterCode>"));
    assert.ok(xml.includes("<AnnualOverflowLimit>4</AnnualOverflowLimit>"));
    assert.ok(xml.includes("<ObservedVolumetricCapturePct>91.4</ObservedVolumetricCapturePct>"));
    assert.ok(xml.includes("<CertifierName>Dr. Arthur Pendelton, PE</CertifierName>"));
  });

  it("exports outfall monitoring parameters to CSV", () => {
    const csv = exportNetDmrCsv(mockDossier);
    assert.ok(csv.includes("PermitNumber,FacilityName,OutfallID"));
    assert.ok(csv.includes('"NPDES-MA0101832"'));
    assert.ok(csv.includes('"CSO-001"'));
    assert.ok(csv.includes('"74055"'));
    assert.ok(csv.includes('"NO"'));
  });

  it("generates markdown executive summary report", () => {
    const report = generateCsoComplianceReport(mockDossier);
    assert.ok(report.includes("Clean Water Act CSO NPDES Annual Compliance Report"));
    assert.ok(report.includes("Boston Water & Sewer Commission"));
    assert.ok(report.includes("91.4%"));
    assert.ok(report.includes("COMPLIANT"));
  });
});

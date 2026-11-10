// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";

import { extractShortPostSlides, isHglCode, isWaterFlowCode } from "../src/components/post/PostArtifactSlider.js";

describe("Water Utilities Engineering Integration for Ansatz Social", () => {
  describe("1. Language Detection & Post Slide Lifting", () => {
    it("identifies waterflow language identifiers", () => {
      assert.strictEqual(isWaterFlowCode("epanet"), true);
      assert.strictEqual(isWaterFlowCode("EPANET"), true);
      assert.strictEqual(isWaterFlowCode("swmm"), true);
      assert.strictEqual(isWaterFlowCode("SWMM"), true);
      assert.strictEqual(isWaterFlowCode("inp"), true);
      assert.strictEqual(isWaterFlowCode("INP"), true);
      assert.strictEqual(isWaterFlowCode("water"), true);
      assert.strictEqual(isWaterFlowCode("waterflow"), true);
      assert.strictEqual(isWaterFlowCode("hec-ras"), true);
      assert.strictEqual(isWaterFlowCode("HEC-RAS"), true);
      assert.strictEqual(isWaterFlowCode("ras"), true);
      assert.strictEqual(isWaterFlowCode("rasgeo"), true);
      assert.strictEqual(isWaterFlowCode("modflow"), true);
      assert.strictEqual(isWaterFlowCode("MODFLOW"), true);
      assert.strictEqual(isWaterFlowCode("dis"), true);
      assert.strictEqual(isWaterFlowCode("dis6"), true);
      assert.strictEqual(isWaterFlowCode("modelica"), false);
      assert.strictEqual(isWaterFlowCode("psse"), false);
    });

    it("identifies HGL and acoustic transient language identifiers", () => {
      assert.strictEqual(isHglCode("hgl"), true);
      assert.strictEqual(isHglCode("HGL"), true);
      assert.strictEqual(isHglCode("surge"), true);
      assert.strictEqual(isHglCode("waterhammer"), true);
      assert.strictEqual(isHglCode("transient"), true);
      assert.strictEqual(isHglCode("comtrade"), false);
      assert.strictEqual(isHglCode("modelica"), false);
    });

    it("lifts single fenced EPANET code block to a waterflow slide", () => {
      const post = {
        content: `Hydraulic simulation of municipal network Net1:
\`\`\`epanet
[JUNCTIONS]
;ID Elevation Demand Pattern
J1 10.0 50.0 1
J2 15.0 100.0 1

[PIPES]
;ID Node1 Node2 Length Diameter Roughness
P1 R1 J1 1000 300 100
P2 J1 J2 500 200 100
\`\`\`
All junction pressures stay above 40 psi.`,
      };

      const { isShortPost, slides, proseText } = extractShortPostSlides(post);
      assert.strictEqual(isShortPost, true);
      assert.strictEqual(slides.length, 1);
      assert.strictEqual(slides[0]?.type, "waterflow");
      assert.strictEqual(slides[0]?.lang, "epanet");
      assert.ok(slides[0]?.code?.includes("[JUNCTIONS]"));
      assert.ok(proseText.includes("Hydraulic simulation of municipal network Net1:"));
      assert.ok(proseText.includes("All junction pressures stay above 40 psi."));
    });

    it("lifts single fenced SWMM code block to a waterflow slide", () => {
      const post = {
        content: `Combined sewer stormwater routing model:
\`\`\`swmm
[JUNCTIONS]
J1 100.0 10.0 0 0 0
J2 90.0 10.0 0 0 0

[CONDUITS]
C1 J1 J2 400.0 0.013 0 0 0 0
\`\`\``,
      };

      const { isShortPost, slides } = extractShortPostSlides(post);
      assert.strictEqual(isShortPost, true);
      assert.strictEqual(slides.length, 1);
      assert.strictEqual(slides[0]?.type, "waterflow");
      assert.strictEqual(slides[0]?.lang, "swmm");
      assert.ok(slides[0]?.code?.includes("[CONDUITS]"));
    });

    it("lifts single HGL code block to an hgl slide", () => {
      const post = {
        content: `Longitudinal Hydraulic Grade Line profile along main transmission conduit:
\`\`\`hgl
Profile: Reservoir R-1 to Tank T-1
Distance (m), Elevation (m), Head (m)
0, 100, 150
500, 110, 148
1200, 105, 142
\`\`\``,
      };

      const { isShortPost, slides } = extractShortPostSlides(post);
      assert.strictEqual(isShortPost, true);
      assert.strictEqual(slides.length, 1);
      assert.strictEqual(slides[0]?.type, "hgl");
      assert.strictEqual(slides[0]?.lang, "hgl");
    });

    it("correctly handles multi-item post with mixed Modelica and EPANET blocks", () => {
      const post = {
        content: `Comparison of pump physics in Modelica vs EPANET:
\`\`\`modelica
model PumpModel
  Real p;
end PumpModel;
\`\`\`

\`\`\`epanet
[PUMPS]
PUMP1 J1 J2 HEAD 1
\`\`\``,
      };

      const { isShortPost, slides } = extractShortPostSlides(post);
      assert.strictEqual(isShortPost, true);
      assert.strictEqual(slides.length, 2);
      assert.strictEqual(slides[0]?.type, "code");
      assert.strictEqual(slides[1]?.type, "waterflow");
    });
  });

  describe("2. Package Registry Water Catalog Verification", () => {
    it("ensures standard water and stormwater libraries exist in stdlibs.catalog.json", () => {
      const candidatePaths = [
        path.resolve(process.cwd(), "packages/exchange/src/catalog/stdlibs.catalog.json"),
        path.resolve(process.cwd(), "../../packages/exchange/src/catalog/stdlibs.catalog.json"),
      ];
      const catalogPath = candidatePaths.find((p) => fs.existsSync(p));
      assert.ok(catalogPath, "stdlibs.catalog.json must exist in packages/exchange");
      const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
      const pkgs = (catalog.libraries || catalog.packages) as { packageName: string; domain: string }[];

      const epanetBenchmarks = pkgs.find((p) => p.packageName === "EPANET-Benchmark-Networks");
      assert.ok(epanetBenchmarks, "EPANET-Benchmark-Networks must be in catalog");
      assert.strictEqual(epanetBenchmarks.domain, "fluids-process");

      const swmmNetworks = pkgs.find((p) => p.packageName === "SWMM-Reference-Networks");
      assert.ok(swmmNetworks, "SWMM-Reference-Networks must be in catalog");
      assert.strictEqual(swmmNetworks.domain, "fluids-process");
    });
  });

  describe("3. Regulatory Compliance Cards", () => {
    it("instantiates AwiaRiskResilienceCard with custom report", async () => {
      const { AwiaRiskResilienceCard } =
        await import("../src/components/morsel/simulation-results/components/AwiaRiskResilienceCard.js");
      assert.ok(AwiaRiskResilienceCard, "AwiaRiskResilienceCard must be exported");

      const customReport = {
        utilityName: "Austin Water System",
        pwsid: "TX2270001",
        populationServed: 1000000,
        evaluatedAt: new Date().toISOString(),
        overallStatus: "PASS" as const,
        resilienceScore: 95,
        checks: [
          {
            section: "2013(a)(1)",
            category: "Emergency Storage Autonomy",
            status: "PASS" as const,
            targetMetric: ">= 24.0 h",
            measuredMetric: "42.0 h",
            details: "Adequate reservoir elevation.",
          },
        ],
        summary: "1 audit section evaluated.",
      };

      const element = React.createElement(AwiaRiskResilienceCard, {
        report: customReport,
        colorMode: "dark",
      });
      assert.ok(element, "React element should be created successfully");
      assert.strictEqual(element.props.report?.utilityName, "Austin Water System");
      assert.strictEqual(element.props.report?.overallStatus, "PASS");
      assert.strictEqual(element.props.report?.resilienceScore, 95);
    });

    it("instantiates AwwaM36WaterLossCard with custom report", async () => {
      const { AwwaM36WaterLossCard } =
        await import("../src/components/morsel/simulation-results/components/AwwaM36WaterLossCard.js");
      assert.ok(AwwaM36WaterLossCard, "AwwaM36WaterLossCard must be exported");

      const customReport = {
        utilityName: "Denver Water",
        auditYear: 2025,
        evaluatedAt: new Date().toISOString(),
        serviceConnections: 320000,
        totalMainsLengthKm: 5000,
        averagePressurePsi: 60,
        systemInputVolumeM3: 150000000,
        authorizedConsumptionM3: 135000000,
        apparentLossesM3: 4500000,
        realLossesM3: 10500000,
        carlLitersPerConnDay: 89.9,
        uarlLitersPerConnDay: 58.0,
        ili: 1.55,
        iliBand: "Band A" as const,
        waterLossCostPerM3: 1.1,
        annualLossCostUsd: 11550000,
        recoverableRevenueUsd: 5200000,
        summary: "Top tier performance.",
      };

      const element = React.createElement(AwwaM36WaterLossCard, {
        report: customReport,
        colorMode: "dark",
      });
      assert.ok(element, "React element should be created successfully");
      assert.strictEqual(element.props.report?.utilityName, "Denver Water");
      assert.strictEqual(element.props.report?.iliBand, "Band A");
      assert.strictEqual(element.props.report?.ili, 1.55);
    });

    it("instantiates LcriComplianceCard with custom report", async () => {
      const { LcriComplianceCard } =
        await import("../src/components/morsel/simulation-results/components/LcriComplianceCard.js");
      assert.ok(LcriComplianceCard, "LcriComplianceCard must be exported");

      const customReport = {
        utilityName: "Greater Boston Water System",
        pwsid: "MA1001248",
        evaluatedAt: new Date().toISOString(),
        inventory: {
          totalConnections: 50000,
          leadCount: 1200,
          grrCount: 800,
          unknownCount: 2000,
          nonLeadCount: 46000,
          annualReplacementRatePct: 11.2,
          completedReplacementsThisYear: 350,
        },
        sampling: {
          p90LeadPpb: 5.4,
          p90CopperPpb: 380,
          samplesCollected: 120,
          exceedanceCount: 0,
          samplingPeriod: "2026 H1",
        },
        corrosionControl: {
          orthophosphateMgL: 0.75,
          orthophosphateTarget: 0.5,
          phMean: 7.6,
          phMin: 7.3,
          phThreshold: 7.2,
          alkalinityMgL: 42,
        },
        status: "Compliant" as const,
        summary: "Full compliance with 10 ppb LCRI action level.",
      };

      const element = React.createElement(LcriComplianceCard, {
        report: customReport,
        colorMode: "dark",
      });
      assert.ok(element, "React element should be created successfully");
      assert.strictEqual(element.props.report?.utilityName, "Greater Boston Water System");
      assert.strictEqual(element.props.report?.status, "Compliant");
      assert.strictEqual(element.props.report?.sampling.p90LeadPpb, 5.4);
    });

    it("instantiates CsoNpdesComplianceCard with custom report", async () => {
      const { CsoNpdesComplianceCard } =
        await import("../src/components/morsel/simulation-results/components/CsoNpdesComplianceCard.js");
      assert.ok(CsoNpdesComplianceCard, "CsoNpdesComplianceCard must be exported");

      const customReport = {
        utilityName: "Narragansett Bay Commission",
        permitId: "NPDES-RI0100072",
        evaluatedYear: 2026,
        evaluatedAt: new Date().toISOString(),
        totalAnnualEvents: 2,
        maxEventsLimit: 4,
        volumetricCapturePct: 93.8,
        targetCapturePct: 85.0,
        totalSpillVolumeM3: 9800,
        rtcVolumeDivertedM3: 56000,
        outfalls: [
          {
            outfallId: "CSO-001",
            receivingWater: "Providence River",
            annualEvents: 2,
            annualSpillVolumeM3: 9800,
            peakRateM3s: 1.2,
            compliant: true,
          },
        ],
        status: "Compliant" as const,
        summary: "Meets presumptive approach criteria.",
      };

      const element = React.createElement(CsoNpdesComplianceCard, {
        report: customReport,
        colorMode: "dark",
      });
      assert.ok(element, "React element should be created successfully");
      assert.strictEqual(element.props.report?.permitId, "NPDES-RI0100072");
      assert.strictEqual(element.props.report?.volumetricCapturePct, 93.8);
      assert.strictEqual(element.props.report?.totalAnnualEvents, 2);
    });
  });

  describe("4. Visual Studio Viewers", () => {
    it("instantiates SwmmViewer with SWMM model input", async () => {
      const { SwmmViewer } = await import("../src/components/artifacts/SwmmViewer.js");
      assert.ok(SwmmViewer, "SwmmViewer must be exported");

      const swmmCode = `[TITLE]
Stormwater Collection Network
[JUNCTIONS]
J1 10.0 5.0 0 0 0
J2 5.0 5.0 0 0 0
[OUTFALLS]
OF1 0.0 FREE NO
[CONDUITS]
C1 J1 J2 300.0 0.013 0 0 0 0
C2 J2 OF1 200.0 0.013 0 0 0 0
[XSECTIONS]
C1 CIRCULAR 1.0 0 0 0 1
C2 CIRCULAR 1.2 0 0 0 1
[COORDINATES]
J1 0.0 100.0
J2 300.0 100.0
OF1 500.0 100.0
`;

      const element = React.createElement(SwmmViewer, {
        viewConfig: {
          code: swmmCode,
          title: "SWMM Studio Test",
          mode: "plan",
        },
      });
      assert.ok(element, "SwmmViewer React element should be created successfully");
      assert.strictEqual(element.props.viewConfig.title, "SWMM Studio Test");
      assert.strictEqual(element.props.viewConfig.mode, "plan");
    });
  });

  describe("5. Polyglot Utility Inspectors", () => {
    it("instantiates OpenChannelHydraulicsInspector with HEC-RAS cross-sections", async () => {
      const { OpenChannelHydraulicsInspector } = await import(
        "../src/components/morsel/panels/inspectors/OpenChannelHydraulicsInspector.js"
      );
      assert.ok(OpenChannelHydraulicsInspector, "OpenChannelHydraulicsInspector must be exported");

      const hecRasCode = `Type RM = 1000\nMann = 0.035\nInvert = 120.0\nType RM = 800\nMann = 0.035\nInvert = 117.2\nType RM = 600\nMann = 0.035\nInvert = 114.5\n`;
      const lines = hecRasCode.split("\n");

      const element = React.createElement(OpenChannelHydraulicsInspector, {
        code: hecRasCode,
        lines,
        colorMode: "dark",
      });
      assert.ok(element, "OpenChannelHydraulicsInspector element created");
      assert.strictEqual(element.props.colorMode, "dark");
      assert.strictEqual(element.props.lines.length, lines.length);
    });

    it("instantiates TransitCockpitInspector with GTFS schedule", async () => {
      const { TransitCockpitInspector } = await import(
        "../src/components/morsel/panels/inspectors/TransitCockpitInspector.js"
      );
      assert.ok(TransitCockpitInspector, "TransitCockpitInspector must be exported");

      const gtfsCode = `trip_id,route_id,service_id,trip_headsign\nTRIP_38R_01,Route-38R,WEEKDAY,Outbound\nTRIP_38R_02,Route-38R,WEEKDAY,Outbound\n`;
      const lines = gtfsCode.split("\n");

      const element = React.createElement(TransitCockpitInspector, {
        code: gtfsCode,
        lines,
        colorMode: "light",
      });
      assert.ok(element, "TransitCockpitInspector element created");
      assert.strictEqual(element.props.colorMode, "light");
      assert.strictEqual(element.props.lines.length, lines.length);
    });
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createModelScriptMcpServer } from "../src/factory.js";
import type { ServerContext } from "../src/types.js";

const SAMPLE_EPANET_INP = `[TITLE]
Sample Municipal Water Network for MCP Testing

[JUNCTIONS]
;ID   Elev   Demand   Pattern
 J1   15.0   25.0     PAT1
 J2   20.0   15.0     PAT1

[RESERVOIRS]
;ID   Head
 R1   80.0

[TANKS]
;ID   Elev  InitLevel  MinLevel  MaxLevel  Diam  MinVol
 T1   40.0  5.0        1.0       10.0      15.0  0.0

[PIPES]
;ID   Node1  Node2  Length  Diam  Roughness
 P1   R1     J1     1200    300   130
 P2   J1     J2     800     200   130
 P3   J1     T1     600     250   130

[PATTERNS]
;ID    Multipliers
 PAT1  0.7  1.3  1.0  0.6

[OPTIONS]
 UNITS    LPS
 HEADLOSS H-W
`;

const SAMPLE_SWMM_INP = `[TITLE]
Sample Stormwater Drainage Network for MCP Testing

[OPTIONS]
FLOW_UNITS           CMS
FLOW_ROUTING         DYNWAVE

[JUNCTIONS]
;;Name           Elevation  MaxDepth   InitDepth  SurDepth   Aponded   
J1               10.0       2.5        0.2        0.0        0.0       
J2               9.0        2.5        0.2        0.0        0.0       

[OUTFALLS]
;;Name           Elevation  Type       Stage Data       Gated    
OUT1             8.0        FREE                        NO       

[CONDUITS]
;;Name           From Node        To Node          Length     Roughness  InOffset   OutOffset  InitFlow   MaxFlow   
C1               J1               J2               100.0      0.013      0.0        0.0        0.0        0.0       
C2               J2               OUT1             120.0      0.013      0.0        0.0        0.0        0.0       

[XSECTIONS]
;;Link           Shape        Geom1      Geom2      Geom3      Geom4      Barrels    Culvert   
C1               CIRCULAR     1.0        0.0        0.0        0.0        1                    
C2               CIRCULAR     1.2        0.0        0.0        0.0        1                    

[SUBCATCHMENTS]
;;Name           Rain Gage        Outlet           Area     %Imperv  Width    %Slope   CurbLen 
SUB1             GAGE1            J1               4.0      50.0     200.0    1.0      0       
`;

describe("Water Utilities MCP Tools Integration Suite", () => {
  const ctx: ServerContext = { current: null };
  const server = createModelScriptMcpServer(ctx);
  const tools = (
    server as unknown as {
      _registeredTools: Record<
        string,
        { handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }> }
      >;
    }
  )._registeredTools;

  it("registers all 9 water engineering MCP tools", () => {
    assert.ok(tools["epanet_solve_hydraulics"], "epanet_solve_hydraulics should be registered");
    assert.ok(tools["epanet_fire_flow_analysis"], "epanet_fire_flow_analysis should be registered");
    assert.ok(tools["epanet_outage_contingency"], "epanet_outage_contingency should be registered");
    assert.ok(tools["epanet_water_hammer_surge"], "epanet_water_hammer_surge should be registered");
    assert.ok(tools["epanet_optimize_cip"], "epanet_optimize_cip should be registered");
    assert.ok(tools["epanet_calibrate_scada"], "epanet_calibrate_scada should be registered");
    assert.ok(tools["water_audit_awwa_m36"], "water_audit_awwa_m36 should be registered");
    assert.ok(tools["swmm_flood_routing"], "swmm_flood_routing should be registered");
    assert.ok(tools["swmm_simulate_rtc"], "swmm_simulate_rtc should be registered");
  });

  it("epanet_solve_hydraulics solves steady-state and EPS simulations", async () => {
    const tool = tools["epanet_solve_hydraulics"]!;
    // 1. Steady state
    const resSS = await tool.handler({ networkContent: SAMPLE_EPANET_INP, extendedPeriod: false });
    const dataSS = JSON.parse(resSS.content[0]?.text ?? "{}");
    assert.strictEqual(dataSS.success, true);
    assert.strictEqual(dataSS.converged, true);
    assert.ok(dataSS.nodePressures["J1"] > 0);

    // 2. Extended period
    const resEPS = await tool.handler({ networkContent: SAMPLE_EPANET_INP, extendedPeriod: true, durationHours: 4 });
    const dataEPS = JSON.parse(resEPS.content[0]?.text ?? "{}");
    assert.strictEqual(dataEPS.success, true);
    assert.strictEqual(dataEPS.mode, "EPS");
    assert.strictEqual(dataEPS.stepsCount, 4);
    assert.ok(dataEPS.minSystemPressure > 0);
  });

  it("epanet_fire_flow_analysis calculates available fire flow at residual pressure", async () => {
    const tool = tools["epanet_fire_flow_analysis"]!;
    const res = await tool.handler({
      networkContent: SAMPLE_EPANET_INP,
      targetHydrantNode: "J1",
      requiredFireFlowLps: 50.0,
      minResidualPressureM: 14.0,
    });
    const data = JSON.parse(res.content[0]?.text ?? "{}");
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.targetNode, "J1");
    assert.ok(data.residualPressureM > 0);
    assert.strictEqual(typeof data.compliant, "boolean");
    assert.ok(data.nfpaClass.length > 0);
  });

  it("epanet_outage_contingency evaluates N-1 pipe break isolation under PDD", async () => {
    const tool = tools["epanet_outage_contingency"]!;
    const res = await tool.handler({
      networkContent: SAMPLE_EPANET_INP,
      isolatedPipeId: "P2",
    });
    const data = JSON.parse(res.content[0]?.text ?? "{}");
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.isolatedPipe, "P2");
    assert.ok(data.satisfactionRatio >= 0 && data.satisfactionRatio <= 1.0);
  });

  it("epanet_water_hammer_surge simulates Joukowsky pressure transients", async () => {
    const tool = tools["epanet_water_hammer_surge"]!;
    const res = await tool.handler({
      pipeLengthM: 1200.0,
      pipeDiameterM: 0.6,
      initialFlowM3s: 0.45,
      closureTimeSeconds: 0.3,
    });
    const data = JSON.parse(res.content[0]?.text ?? "{}");
    assert.strictEqual(data.success, true);
    assert.ok(data.joukowskySurgeM > 100);
    assert.ok(data.maxPressurePsi > 200);
    assert.ok(data.fundamentalPeriodSeconds > 0);
  });

  it("water_audit_awwa_m36 computes CARL, UARL, and ILI leakage grading", async () => {
    const tool = tools["water_audit_awwa_m36"]!;
    const res = await tool.handler({
      networkContent: SAMPLE_EPANET_INP,
      systemInputVolumeM3Year: 5000000,
      billedMeteredM3Year: 4100000,
      serviceConnectionsCount: 8500,
    });
    const data = JSON.parse(res.content[0]?.text ?? "{}");
    assert.strictEqual(data.success, true);
    assert.ok(data.waterLossesM3 > 0);
    assert.ok(data.realLossesM3 > 0);
    assert.ok(data.ili > 0);
    assert.ok(["A", "B", "C", "D"].includes(data.performanceBand));
    assert.ok(data.financialLossUsd > 0);
  });

  it("swmm_flood_routing and swmm_simulate_rtc execute stormwater routing", async () => {
    // 1. Flood routing
    const floodTool = tools["swmm_flood_routing"]!;
    const fRes = await floodTool.handler({
      deckContent: SAMPLE_SWMM_INP,
      durationSeconds: 30,
      rainfallIntensityMmPerHr: 60.0,
    });
    const fData = JSON.parse(fRes.content[0]?.text ?? "{}");
    assert.strictEqual(fData.success, true);
    assert.ok(fData.totalInflowM3s >= 0);

    // 2. Real-Time Control simulation
    const rtcTool = tools["swmm_simulate_rtc"]!;
    const rRes = await rtcTool.handler({
      deckContent: SAMPLE_SWMM_INP,
      linkId: "C1",
      linkType: "ORIFICE",
      actionSetting: 0.5,
      triggerNodeId: "J1",
      operator: ">",
      thresholdDepth: 0.1,
      durationSeconds: 30,
    });
    const rData = JSON.parse(rRes.content[0]?.text ?? "{}");
    assert.strictEqual(rData.success, true);
    assert.strictEqual(rData.activeRulesCount, 1);
  });

  it("epanet_optimize_cip optimizes pipe replacement under capital budget constraint", async () => {
    const tool = tools["epanet_optimize_cip"]!;
    const res = await tool.handler({
      networkContent: SAMPLE_EPANET_INP,
      budgetUsd: 250000,
      targetMinPressureM: 30.0,
      availableDiametersMm: [250, 300, 350, 400],
    });
    const data = JSON.parse(res.content[0]?.text ?? "{}");
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.budgetUsd, 250000);
    assert.ok(data.totalCapexUsd > 0);
    assert.ok(data.totalCapexUsd <= 250000, "Capex must not exceed budget");
    assert.ok(data.remainingBudgetUsd >= 0);
    assert.ok(data.replacedPipeCount >= 1, "At least 1 pipe should be replaced");
    assert.ok(data.optimizedMinPressureM >= data.baselineMinPressureM);
    assert.ok(data.pressureImprovementM >= 0);
    assert.ok(data.summary.includes("Capital Improvement Plan"));
  });

  it("epanet_calibrate_scada tunes Hazen-Williams roughness from SCADA observations", async () => {
    const tool = tools["epanet_calibrate_scada"]!;
    const res = await tool.handler({
      networkContent: SAMPLE_EPANET_INP,
      observations: [
        { nodeId: "J1", observedPressureM: 60.0 },
        { nodeId: "J2", observedPressureM: 55.0 },
      ],
      maxIterations: 10,
    });
    const data = JSON.parse(res.content[0]?.text ?? "{}");
    assert.strictEqual(data.success, true);
    assert.ok(data.initialRmseM > 0);
    assert.ok(data.calibratedRmseM <= data.initialRmseM, "Calibrated RMSE should be <= initial RMSE");
    assert.ok(data.calibratedPipeCount > 0);
    assert.ok(Array.isArray(data.calibratedPipes));
    assert.ok(Array.isArray(data.observationErrors));
    assert.ok(data.summary.includes("SCADA Telemetry Calibration"));
  });

  it("epanet_gis_to_model ingests GeoJSON pipes and DEM raster into EPANET network", async () => {
    const tool = tools["epanet_gis_to_model"]!;
    const pipesGeoJson = JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "P1",
          properties: { diameter: 300, roughness: 120 },
          geometry: {
            type: "LineString",
            coordinates: [
              [100, 100],
              [200, 100],
            ],
          },
        },
        {
          type: "Feature",
          id: "P2",
          properties: { diameter: 200, roughness: 120 },
          geometry: {
            type: "LineString",
            coordinates: [
              [200.5, 100.2], // within snap tolerance
              [300, 100],
            ],
          },
        },
      ],
    });

    const nodesGeoJson = JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "SRC_1",
          properties: { type: "reservoir", head: 95.0 },
          geometry: {
            type: "Point",
            coordinates: [100, 100],
          },
        },
      ],
    });

    const demAscii = `ncols 3
nrows 3
xllcorner 50
yllcorner 50
cellsize 100
NODATA_value -9999
50.0 52.0 54.0
40.0 42.0 44.0
30.0 32.0 34.0`;

    const res = await tool.handler({
      pipesGeoJson,
      nodesGeoJson,
      demAsciiGrid: demAscii,
      snapToleranceM: 2.0,
      networkTitle: "MCP Ingested Municipal Network",
    });

    const data = JSON.parse(res.content[0]?.text ?? "{}");
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.title, "MCP Ingested Municipal Network");
    assert.strictEqual(data.summary.pipesCount, 2);
    assert.strictEqual(data.summary.reservoirsCount, 1);
    assert.ok(data.summary.junctionsCount >= 1);
    assert.ok(data.summary.totalPipeLengthM > 0);
    assert.ok(data.inpContent.includes("[RESERVOIRS]"));
    assert.ok(data.inpContent.includes("SRC_1"));
    assert.ok(data.inpContent.includes("[PIPES]"));
  });

  it("swmm_gis_to_model ingests GeoJSON conduits, catchments, and DEM raster into SWMM deck", async () => {
    const tool = tools["swmm_gis_to_model"]!;
    const conduitsGeoJson = JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "COND_1",
          properties: { diameter: 0.9 },
          geometry: {
            type: "LineString",
            coordinates: [
              [100, 200],
              [200, 200],
            ],
          },
        },
      ],
    });

    const subcatchmentsGeoJson = JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "BASIN_1",
          properties: { imperv: 55 },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [100, 150],
                [200, 150],
                [200, 250],
                [100, 250],
                [100, 150],
              ],
            ],
          },
        },
      ],
    });

    const res = await tool.handler({
      conduitsGeoJson,
      subcatchmentsGeoJson,
      title: "MCP Ingested Stormwater Deck",
    });

    const data = JSON.parse(res.content[0]?.text ?? "{}");
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.title, "MCP Ingested Stormwater Deck");
    assert.strictEqual(data.summary.conduitsCount, 1);
    assert.strictEqual(data.summary.subcatchmentsCount, 1);
    assert.ok(data.summary.totalConduitLengthM > 0);
    assert.ok(data.summary.totalCatchmentAreaHa > 0);
    assert.ok(data.inpContent.includes("[CONDUITS]"));
    assert.ok(data.inpContent.includes("[SUBCATCHMENTS]"));
    assert.ok(data.inpContent.includes("BASIN_1"));
  });
});

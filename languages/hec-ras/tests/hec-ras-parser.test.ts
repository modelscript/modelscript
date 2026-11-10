// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFlow, parseGeometry, parseHecRas } from "../src/parser/hec-ras-parser.js";

const SAMPLE_GEOMETRY = `
Geom Title=Columbia River Reach 1
Program Version=6.3.1
River Reach=Columbia,ReachA
Reach XY=3
0, 1000
500, 1500
1000, 2000

Type RM CEM CS= 1 ,1000    ,        ,
Node Last Edited Time=2024-01-01
DESCRIPTION=Upstream Boundary Cross Section
Station Elevation Data= 5
0, 110  25, 98  50, 92  75, 98  100, 110
Cross Section Reach Lengths and Manning Values=
250, 250, 250, 3, 0.045, 0.035, 0.045, 0, 0
Bank Sta=25,75
Exp/Contr=0.1,0.3

Type RM CEM CS= 1 ,750     ,        ,
DESCRIPTION=Middle Cross Section
Station Elevation Data= 5
0, 108  20, 96  50, 90  80, 96  100, 108
Cross Section Reach Lengths and Manning Values=
250, 250, 250, 3, 0.045, 0.035, 0.045, 0, 0
Bank Sta=20,80

Type RM CEM CS= 2 ,500     ,        ,
Inline Structure
Weir Data= 95, 60, 1.44
`;

const SAMPLE_FLOW = `
Flow Title=100-Year Flood Run
Boundary for River Reach & Node=Columbia,ReachA,1000
Boundary Type=Flow Hydrograph
Hydrograph Data= 3
0, 150  12, 450  24, 180

Boundary for River Reach & Node=Columbia,ReachA,750
Boundary Type=Normal Depth
Friction Slope=0.0015
`;

describe("HEC-RAS Parser", () => {
  it("parses river reaches and cross sections from geometry deck", () => {
    const geom = parseGeometry(SAMPLE_GEOMETRY);
    assert.strictEqual(geom.title, "Columbia River Reach 1");
    assert.strictEqual(geom.version, "6.3.1");
    assert.strictEqual(geom.reaches.length, 1);
    assert.strictEqual(geom.reaches[0]?.river, "Columbia");
    assert.strictEqual(geom.reaches[0]?.reach, "ReachA");
    assert.strictEqual(geom.reaches[0]?.coords.length, 3);

    assert.strictEqual(geom.crossSections.length, 2);
    const cs1 = geom.crossSections[0]!;
    assert.strictEqual(cs1.station, 1000);
    assert.strictEqual(cs1.description, "Upstream Boundary Cross Section");
    assert.strictEqual(cs1.stationElevations.length, 5);
    assert.strictEqual(cs1.stationElevations[2]?.elevation, 92);
    assert.strictEqual(cs1.reachLengths.channel, 250);
    assert.strictEqual(cs1.manning.channel, 0.035);
    assert.strictEqual(cs1.bankStations.left, 25);
    assert.strictEqual(cs1.bankStations.right, 75);

    assert.strictEqual(geom.inlineStructures.length, 1);
    const weir = geom.inlineStructures[0]!;
    assert.strictEqual(weir.station, 500);
    assert.strictEqual(weir.weirCrestElevation, 95);
    assert.strictEqual(weir.weirLength, 60);
  });

  it("parses boundary conditions from flow deck", () => {
    const flow = parseFlow(SAMPLE_FLOW);
    assert.strictEqual(flow.title, "100-Year Flood Run");
    assert.strictEqual(flow.boundaryConditions.length, 2);

    const bc1 = flow.boundaryConditions[0]!;
    assert.strictEqual(bc1.river, "Columbia");
    assert.strictEqual(bc1.station, 1000);
    assert.strictEqual(bc1.type, "Flow Hydrograph");
    assert.strictEqual(bc1.hydrograph?.length, 3);
    assert.strictEqual(bc1.hydrograph?.[1]?.flowOrStage, 450);

    const bc2 = flow.boundaryConditions[1]!;
    assert.strictEqual(bc2.station, 750);
    assert.strictEqual(bc2.type, "Normal Depth");
    assert.strictEqual(bc2.frictionSlope, 0.0015);
  });

  it("detects mixed decks in parseHecRas", () => {
    const res = parseHecRas(SAMPLE_GEOMETRY);
    assert.ok(res.geometry);
    assert.strictEqual(res.geometry.crossSections.length, 2);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerHecRasToDae } from "../src/dae/hec-ras-to-dae.js";
import { parseFlow, parseGeometry } from "../src/parser/hec-ras-parser.js";

const DAE_TEST_GEOM = `
Geom Title=DAE Lowering Test Reach
River Reach=River1,Reach1
Reach XY=2
0, 0
1000, 0

Type RM CEM CS= 1 ,1000    ,        ,
Station Elevation Data= 3
0, 100  20, 90  40, 100
Cross Section Reach Lengths and Manning Values=
200, 200, 200, 3, 0.03, 0.03, 0.03, 0, 0
Bank Sta=0,40

Type RM CEM CS= 1 ,800     ,        ,
Station Elevation Data= 3
0, 99.5  20, 89.5  40, 99.5
Cross Section Reach Lengths and Manning Values=
200, 200, 200, 3, 0.03, 0.03, 0.03, 0, 0
Bank Sta=0,40
`;

const DAE_TEST_FLOW = `
Flow Title=Test Flow
Boundary for River Reach & Node=River1,Reach1,1000
Boundary Type=Flow Hydrograph
Hydrograph Data= 1
0, 75

Boundary for River Reach & Node=River1,Reach1,800
Boundary Type=Normal Depth
Friction Slope=0.001
`;

describe("HEC-RAS DAE Lowering", () => {
  it("compiles HEC-RAS hydraulic deck directly into DAEBuilder linear arena", () => {
    const geom = parseGeometry(DAE_TEST_GEOM);
    const flow = parseFlow(DAE_TEST_FLOW);

    const arena = lowerHecRasToDae(geom, flow);

    // Should create variables: gravity, and for each CS: wsel, Q, v, egl
    // 1 constant + 2 cross-sections * 4 variables = 9 variables
    assert.strictEqual(arena.getVarCount(), 9);

    // Equations:
    // For each CS: Q = discharge (2), egl = wsel + hv (2)
    // Downstream BC (1)
    // Energy conservation between adjacent CS (1)
    // Total = 6 equations
    assert.strictEqual(arena.getEqCount(), 6);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintHecRas } from "../src/lints/rules.js";
import { parseFlow, parseGeometry } from "../src/parser/hec-ras-parser.js";

const VALID_GEOM = `
Geom Title=Valid Geometry
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
0, 99  20, 89  40, 99
Cross Section Reach Lengths and Manning Values=
200, 200, 200, 3, 0.03, 0.03, 0.03, 0, 0
Bank Sta=0,40
`;

const INVERTED_STATION_GEOM = `
Geom Title=Bad Geometry
River Reach=River1,Reach1
Type RM CEM CS= 1 ,1000    ,        ,
Station Elevation Data= 3
0, 100  25, 90  20, 100
Cross Section Reach Lengths and Manning Values=
200, 200, 200, 3, 0.03, 0.03, 0.03, 0, 0
Bank Sta=0,25

Type RM CEM CS= 1 ,800     ,        ,
Station Elevation Data= 3
0, 99  20, 89  40, 99
Cross Section Reach Lengths and Manning Values=
200, 200, 200, 3, 0.03, 0.03, 0.03, 0, 0
Bank Sta=0,40
`;

const OUT_OF_BOUNDS_MANNING_GEOM = `
Geom Title=Bad Manning
River Reach=River1,Reach1
Type RM CEM CS= 1 ,1000    ,        ,
Station Elevation Data= 3
0, 100  20, 90  40, 100
Cross Section Reach Lengths and Manning Values=
200, 200, 200, 3, 0.50, 0.03, 0.03, 0, 0
Bank Sta=0,40

Type RM CEM CS= 1 ,800     ,        ,
Station Elevation Data= 3
0, 99  20, 89  40, 99
Cross Section Reach Lengths and Manning Values=
200, 200, 200, 3, 0.03, 0.03, 0.03, 0, 0
Bank Sta=0,40
`;

describe("HEC-RAS Linter", () => {
  it("passes valid geometry without errors", () => {
    const geom = parseGeometry(VALID_GEOM);
    const flow = parseFlow(`
      Boundary for River Reach & Node=River1,Reach1,800
      Boundary Type=Normal Depth
      Friction Slope=0.001
    `);
    const diags = lintHecRas(geom, flow);
    assert.strictEqual(diags.length, 0);
  });

  it("detects station offset inversion", () => {
    const geom = parseGeometry(INVERTED_STATION_GEOM);
    const diags = lintHecRas(geom);
    const err = diags.find((d) => d.code === 3001);
    assert.ok(err, "Should report M3001 station inversion");
  });

  it("detects Manning roughness out of bounds", () => {
    const geom = parseGeometry(OUT_OF_BOUNDS_MANNING_GEOM);
    const diags = lintHecRas(geom);
    const warn = diags.find((d) => d.code === 3002);
    assert.ok(warn, "Should report M3002 Manning roughness out of bounds");
  });
});

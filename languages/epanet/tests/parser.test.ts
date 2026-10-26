// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseInp } from "../src/parser/index.js";

const SAMPLE_INP = `
[TITLE]
Net1 - Two-Reservoir Two-Zone Water Distribution System

[JUNCTIONS]
;ID              Elev         Demand       Pattern
 10              710          0            ;
 11              710          150          1
 12              700          150          1
 13              695          100          1
 21              700          150          1

[RESERVOIRS]
;ID              Head         Pattern
 9               800          ;

[TANKS]
;ID              Elev         InitLvl      MinLvl       MaxLvl       Diam         MinVol       VolCurve
 2               850          120          100          150          50.0         0            ;

[PIPES]
;ID              Node1        Node2        Length       Diam         Roughness    MinorLoss    Status
 10              10           11           10530        18           100          0            OPEN
 11              11           12           5280         14           100          0            OPEN
 12              12           13           5280         12           100          0            OPEN
 21              10           21           5280         10           100          0            OPEN

[PUMPS]
;ID              Node1        Node2        Parameters
 9               9            10           HEAD Curve1

[VALVES]
;ID              Node1        Node2        Diam         Type         Setting      MinorLoss
 1               13           21           12           PRV          50           0

[CURVES]
;ID              X-Value      Y-Value
 Curve1          1500         250
 Curve1          1400         200
 Curve1          1200         150

[PATTERNS]
;ID              Multipliers
 1               1.0   1.2   1.4   1.6   1.4   1.2

[OPTIONS]
 Units                LPS
 Headloss             H-W
 Accuracy             0.001
 Trials               40

[END]
`;

describe("EPANET Zero-Regex INP Parser", () => {
  it("parses complete EPANET .inp network deck", () => {
    const net = parseInp(SAMPLE_INP, "net1.inp");

    assert.strictEqual(net.title?.trim(), "Net1 - Two-Reservoir Two-Zone Water Distribution System");
    assert.strictEqual(net.junctions.length, 5);
    assert.strictEqual(net.junctions[0]?.id, "10");
    assert.strictEqual(net.junctions[0]?.elevation, 710);
    assert.strictEqual(net.junctions[1]?.demand, 150);
    assert.strictEqual(net.reservoirs.length, 1);
    assert.strictEqual(net.reservoirs[0]?.id, "9");
    assert.strictEqual(net.reservoirs[0]?.totalHead, 800);
    assert.strictEqual(net.tanks.length, 1);
    assert.strictEqual(net.tanks[0]?.id, "2");
    assert.strictEqual(net.tanks[0]?.diameter, 50.0);
    assert.strictEqual(net.pipes.length, 4);
    assert.strictEqual(net.pipes[0]?.id, "10");
    assert.strictEqual(net.pipes[0]?.node1, "10");
    assert.strictEqual(net.pipes[0]?.node2, "11");
    assert.strictEqual(net.pipes[0]?.length, 10530);
    assert.strictEqual(net.pumps.length, 1);
    assert.strictEqual(net.pumps[0]?.id, "9");
    assert.strictEqual(net.pumps[0]?.headCurveId, "Curve1");
    assert.strictEqual(net.valves.length, 1);
    assert.strictEqual(net.valves[0]?.type, "PRV");
    assert.strictEqual(net.curves.length, 1);
    assert.strictEqual(net.curves[0]?.points.length, 3);
    assert.strictEqual(net.patterns.length, 1);
    assert.strictEqual(net.patterns[0]?.multipliers.length, 6);
    assert.strictEqual(net.options.units, "LPS");
    assert.strictEqual(net.options.headloss, "H-W");
  });
});

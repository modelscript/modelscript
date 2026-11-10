// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { parseInp } from "../src/parser/index.js";
import { extractEpanetScreeningModel } from "../src/solver/screening-bridge.js";

const SAMPLE_NETWORK_INP = `
[TITLE]
Sample 3-Node Water Network for Screening

[JUNCTIONS]
;ID              Elev         Demand       Pattern
 J1              20.0         25.0         ;
 J2              20.0         35.0         ;

[RESERVOIRS]
;ID              Head         Pattern
 RES             100.0        ;

[PIPES]
;ID              Node1           Node2           Length       Diameter     Roughness    MinorLoss    Status
 P0              RES             J1              500.0        300.0        120.0        0.0          OPEN
 P1              J1              J2              300.0        200.0        120.0        0.0          OPEN
 P2              RES             J2              600.0        250.0        120.0        0.0          OPEN

[OPTIONS]
Units           LPS
Headloss        H-W
`;

test("EPANET Screening Bridge: Extracts Nodes, Pipes, and Baseline Hydraulics", () => {
  const net = parseInp(SAMPLE_NETWORK_INP);
  const model = extractEpanetScreeningModel(net);

  assert.strictEqual(model.nodes.length, 3, "Must extract 2 junctions + 1 reservoir");
  assert.strictEqual(model.pipes.length, 3, "Must extract 3 pipes");

  // Verify reservoir node
  const res = model.nodes.find((n) => n.id === "RES");
  assert(res, "Reservoir node must be extracted");
  assert.strictEqual(res.isFixedHead, true);
  assert.strictEqual(res.baseHeadM, 100.0);

  // Verify junction nodes
  const j1 = model.nodes.find((n) => n.id === "J1");
  assert(j1, "J1 must be extracted");
  assert.strictEqual(j1.isFixedHead, false);
  assert.strictEqual(j1.elevationM, 20.0);
  assert.strictEqual(j1.baseDemandLps, 25.0);
  assert(j1.baseHeadM > 20.0, "J1 head must exceed ground elevation");

  // Verify pipes
  for (const pipe of model.pipes) {
    assert(pipe.diameterM <= 1.0, `Diameter must be in meters, got ${pipe.diameterM}`);
    assert(pipe.lengthM >= 1.0);
  }

  // Verify baseline hydraulics converged
  assert.strictEqual(model.hydraulics.converged, true);
});

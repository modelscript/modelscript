// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseInp } from "../src/parser/index.js";
import { solveHydraulics } from "../src/solver/index.js";

const SIMPLE_GRAVITY_SYSTEM = `
[TITLE]
Gravity Feed Network

[RESERVOIRS]
;ID  Head
 R1  100.0

[JUNCTIONS]
;ID  Elev  Demand
 J1  50.0  10.0
 J2  40.0  15.0

[PIPES]
;ID  Node1  Node2  Length  Diam  Roughness  MinorLoss  Status
 P1  R1     J1     1000    200   100        0          OPEN
 P2  J1     J2     800     150   100        0          OPEN
`;

describe("EPANET Todini Global Gradient Hydraulic Solver", () => {
  it("solves gravity network pressures and flows to strict convergence", () => {
    const net = parseInp(SIMPLE_GRAVITY_SYSTEM);
    const res = solveHydraulics(net);

    assert.strictEqual(res.converged, true);
    assert(res.iterations <= 15, `Expected <= 15 iterations, got ${res.iterations}`);

    // Check flow conservation at Junction J1
    // Inflow from P1 should equal demand at J1 (10) + outflow to P2 (15) = 25
    const q1 = res.linkFlows.get("P1") ?? 0;
    const q2 = res.linkFlows.get("P2") ?? 0;
    assert.strictEqual(Math.round(q1), 25);
    assert.strictEqual(Math.round(q2), 15);

    // Check pressure heads: Head at J1 should be lower than R1 (100) and higher than J2
    const hR1 = res.nodeHeads.get("R1") ?? 0;
    const hJ1 = res.nodeHeads.get("J1") ?? 0;
    const hJ2 = res.nodeHeads.get("J2") ?? 0;

    assert.strictEqual(hR1, 100.0);
    assert(hJ1 < hR1 && hJ1 > 80.0, `Expected 80 < hJ1 < 100, got ${hJ1}`);
    assert(hJ2 < hJ1 && hJ2 > 60.0, `Expected 60 < hJ2 < hJ1, got ${hJ2}`);

    // Pressure = Head - Elevation > 0
    const pJ1 = res.nodePressures.get("J1") ?? 0;
    const pJ2 = res.nodePressures.get("J2") ?? 0;
    assert(pJ1 > 0, `Expected positive pressure at J1, got ${pJ1}`);
    assert(pJ2 > 0, `Expected positive pressure at J2, got ${pJ2}`);
  });
});

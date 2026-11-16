// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRaw, reduceNodeBreakerToBuses, solvePowerFlow } from "../src/index.js";

const NODE_BREAKER_COUPLER_CLOSED_RAW = `0, 100.00, 34, 0, 1, 60.00 / PSS/E v34 Node-Breaker Case
SUBSTATION COUPLER CLOSED TEST
CASE 1
101, 'SUB1_BUS_A', 138.000, 3, 1, 1, 1, 1.0200, 0.0000
102, 'SUB1_BUS_B', 138.000, 1, 1, 1, 1, 1.0200, 0.0000
201, 'LOAD_BUS', 138.000, 1, 1, 1, 1, 1.0000, -1.0000
0 / END OF BUS DATA
201, '1', 1, 1, 1, 50.000, 15.000, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
101, '1', 50.200, 0.000, 100.000, -50.000, 1.0200, 0, 100.00, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 100.0, 0.0
0 / END OF GENERATOR DATA
102, 201, '1', 0.00500, 0.04000, 0.01000, 150.00, 150.00, 150.00, 0.0, 0.0, 0.0, 0.0, 1, 1, 10.00
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF IMPEDANCE CORRECTION DATA
0 / END OF MULTI-TERMINAL DC DATA
0 / END OF MULTI-SECTION LINE DATA
0 / END OF ZONE DATA
0 / END OF INTER-AREA TRANSFER DATA
0 / END OF OWNER DATA
0 / END OF SWITCHED SHUNT DATA
/ BEGIN SUBSTATION DATA
1, 'NORTH_SUB', 35.120, -80.840, 0.250
1, 'N1_MAIN', 101, 1
2, 'N2_AUX', 102, 1
0 / END OF SUBSTATION NODE DATA
1, 2, 'B1', 0.0001, 200.0, 200.0, 200.0, 1, 1, 'TIE_BREAKER'
0 / END OF SWITCHING DEVICE DATA
0 / END OF SUBSTATION TERMINALS
0 / END OF SUBSTATION DATA
Q
`;

const NODE_BREAKER_SPLIT_RAW = `0, 100.00, 35, 0, 1, 60.00 / PSS/E v35 Node-Breaker Split Test
SUBSTATION BUSBAR SPLIT BY OPEN BREAKER
CASE 2
101, 'SUB1_MAIN', 138.000, 3, 1, 1, 1, 1.0000, 0.0000
201, 'LOAD_WEST', 138.000, 1, 1, 1, 1, 1.0000, 0.0000
202, 'LOAD_EAST', 138.000, 1, 1, 1, 1, 1.0000, 0.0000
0 / END OF BUS DATA
201, '1', 1, 1, 1, 25.000, 5.000, 0.0, 0.0, 0.0, 0.0, 1, 1, 1
202, '1', 1, 1, 1, 20.000, 5.000, 0.0, 0.0, 0.0, 0.0, 1, 1, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
101, '1', 45.000, 0.000, 100.000, -50.000, 1.0000, 0, 100.00, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 100.0, 0.0
0 / END OF GENERATOR DATA
101, 201, '1', 0.00500, 0.04000, 0.00000, 150.00, 150.00, 150.00, 0.0, 0.0, 0.0, 0.0, 1, 1, 5.00
101, 202, '2', 0.00500, 0.04000, 0.00000, 150.00, 150.00, 150.00, 0.0, 0.0, 0.0, 0.0, 1, 1, 5.00
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF IMPEDANCE CORRECTION DATA
0 / END OF MULTI-TERMINAL DC DATA
0 / END OF MULTI-SECTION LINE DATA
0 / END OF ZONE DATA
0 / END OF INTER-AREA TRANSFER DATA
0 / END OF OWNER DATA
0 / END OF SWITCHED SHUNT DATA
/ BEGIN SUBSTATION DATA
1, 'SPLIT_SUB', 35.0, -80.0, 0.2
NODE, 1, 'BUSBAR_A', 101, 1
NODE, 2, 'BUSBAR_B', 101, 1
SWITCH, 1, 2, 'TIE_12', 0
TERMINAL, GEN, 101, '1', 1
TERMINAL, BRANCH, 101, 201, '1', 1
TERMINAL, BRANCH, 101, 202, '2', 2
0 / END OF SUBSTATION DATA
Q
`;

describe("PSS/E v34/v35 Node-Breaker substation parsing & topology reduction", () => {
  it("parses BEGIN SUBSTATION DATA and contracts closed tie breakers into one super-bus", () => {
    const parsed = parseRaw(NODE_BREAKER_COUPLER_CLOSED_RAW);
    assert.equal(parsed.substations?.length, 1);
    const sub = parsed.substations![0]!;
    assert.equal(sub.is, 1);
    assert.equal(sub.name, "NORTH_SUB");
    assert.equal(sub.nodes.length, 2);
    assert.equal(sub.switches.length, 1);
    assert.equal(sub.switches[0]!.status, 1);

    const red = reduceNodeBreakerToBuses(parsed);
    // Bus 102 is absorbed into super-bus 101 because tie breaker 'B1' is closed
    assert.equal(red.absorbedBuses.get(102), 101);
    assert.equal(red.reducedCase.buses.has(102), false);
    assert.equal(red.reducedCase.branches[0]!.i, 101);

    // Solving AC power flow succeeds directly via contracted super-bus!
    const pf = solvePowerFlow(parsed);
    assert.equal(pf.converged, true);
    assert.equal(pf.buses.length, 2);
  });

  it("splits substation busbars when a bus-tie breaker is open and rebinds terminals", () => {
    const parsed = parseRaw(NODE_BREAKER_SPLIT_RAW);
    assert.equal(parsed.substations?.length, 1);
    const sub = parsed.substations![0]!;
    assert.equal(sub.nodes.length, 2);
    assert.equal(sub.switches[0]!.status, 0);
    assert.equal(sub.terminals.length, 3);

    const red = reduceNodeBreakerToBuses(parsed);
    assert.equal(red.splitBuses.length, 1);
    const splitBus = red.splitBuses[0]!;
    assert.equal(red.nodeToBus.get("1:1"), 101);
    assert.equal(red.nodeToBus.get("1:2"), splitBus);

    // Branch 1 stays on 101->201, while Branch 2 moves onto splitBus->202 (disconnected from 101!)
    assert.equal(red.reducedCase.branches[0]!.i, 101);
    assert.equal(red.reducedCase.branches[1]!.i, splitBus);
  });
});

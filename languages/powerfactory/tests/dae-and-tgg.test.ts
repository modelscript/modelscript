// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerPowerFactoryToDae, powerFactoryTggRules } from "../src/index.js";
import type { PowerFactoryModel } from "../src/types.js";

describe("Phase 3: PowerFactory DAE Lowering & Declarative TGG Rules", () => {
  it("lowers a PowerFactoryModel into DAEBuilder variables and nodal power balance equations", () => {
    const model: PowerFactoryModel = {
      name: "TestGrid",
      substations: new Map(),
      bays: new Map(),
      terminals: new Map([
        ["bus1", { id: "bus1", loc_name: "Bus_1", uknom: 110, fnom: 50 }],
        ["bus2", { id: "bus2", loc_name: "Bus_2", uknom: 110, fnom: 50 }],
      ]),
      lines: new Map([
        ["line1", { id: "line1", loc_name: "Line_1_2", bus1Id: "bus1", bus2Id: "bus2", dline: 12.5, r1: 0.1, x1: 0.4 }],
      ]),
      lineTypes: new Map(),
      transformers2w: new Map(),
      trafo2Types: new Map(),
      transformers3w: new Map(),
      trafo3Types: new Map(),
      generators: new Map([
        ["gen1", { id: "gen1", loc_name: "Gen_1", bus1Id: "bus1", pgini: 120, qgini: 30, usetp: 1.02 }],
      ]),
      symTypes: new Map(),
      staticGenerators: new Map(),
      loads: new Map([["load2", { id: "load2", loc_name: "Load_2", bus1Id: "bus2", plini: 80, qlini: 20 }]]),
      shunts: new Map([["shnt2", { id: "shnt2", loc_name: "Cap_2", bus1Id: "bus2", qtot: 10, ncap: 1 }]]),
      switches: new Map(),
      diagrams: new Map(),
    };

    const dae = lowerPowerFactoryToDae(model);
    assert.ok(dae.varCount >= 15, `Expected >= 15 DAE variables, got ${dae.varCount}`);
    assert.equal(dae.eqCount, 4, "Expected 2 nodal balance equations per terminal (P and Q)");
  });

  it("exports 5 declarative TGG rules for PowerFactory <-> PSS/E and Modelica", () => {
    assert.equal(powerFactoryTggRules.length, 5);
    const names = powerFactoryTggRules.map((r) => r.name);
    assert.deepEqual(names, [
      "PowerFactoryTermToPsseBus",
      "PowerFactorySymToModelicaGen",
      "PowerFactoryLineToPsseBranch",
      "PowerFactoryLoadToModelicaLoad",
      "PowerFactoryTrafo2ToPsseTransformer",
    ]);
  });
});

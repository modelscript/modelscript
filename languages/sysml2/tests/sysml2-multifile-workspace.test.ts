// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSysML2QueryEngine, createSysML2WorkspaceIndex } from "../src/factory.js";
import { getSysmlParser, SysML2DaeLowerer } from "../src/sysml2-dae-lowerer.js";

describe("SysML v2 Multi-File Workspace Elaboration", () => {
  it("elaborates cross-file inheritance, component instantiations, and port connections via QueryDB", async () => {
    const parser = getSysmlParser();
    assert.ok(parser, "SysML v2 WASM parser should be available");

    const file1Uri = "sysml2://workspace/Definitions.sysml";
    const file1Source = `
      package Definitions {
        port def ElectricalPin {
          attribute v : Real;
          flow i : Real;
        }

        part def BaseComponent {
          port p : ElectricalPin;
          port n : ElectricalPin;
          attribute active : Real = 1.0;
        }
      }
    `;

    const file2Uri = "sysml2://workspace/Resistor.sysml";
    const file2Source = `
      package Devices {
        part def Resistor :> BaseComponent {
          attribute R : Real = 50.0;
          attribute v : Real;
          attribute i : Real;
          constraint ohm {
            v == i * R;
          }
        }
      }
    `;

    const file3Uri = "sysml2://workspace/Circuit.sysml";
    const file3Source = `
      package Circuits {
        part def VoltageDivider {
          part r1 : Resistor {
            attribute R = 100.0;
          }
          part r2 : Resistor {
            attribute R = 200.0;
          }
          connection c1 connect r1.n to r2.p;
        }
      }
    `;

    // 1. Initialize workspace index and register the multi-file documents
    const ws = createSysML2WorkspaceIndex();

    ws.register(file1Uri, () => {
      const tree = parser.parse(file1Source);
      return tree?.rootNode ?? null;
    });

    ws.register(file2Uri, () => {
      const tree = parser.parse(file2Source);
      return tree?.rootNode ?? null;
    });

    ws.register(file3Uri, () => {
      const tree = parser.parse(file3Source);
      return tree?.rootNode ?? null;
    });

    // 2. Compile unified symbol index and create Salsa QueryEngine
    const unified = await ws.getIndexAsync();
    const queryEngine = createSysML2QueryEngine(unified);
    const queryDb = queryEngine.toQueryDB();

    // 3. Lower Circuit.sysml using queryDb for cross-file symbol resolution
    const lowered = await SysML2DaeLowerer.lowerConstraint(file3Source, undefined, {
      queryDb,
      rootComponentName: "VoltageDivider",
    });

    assert.ok(lowered.arena, "DAE arena should be instantiated");
    assert.equal(lowered.name, "VoltageDivider");

    // 4. Verify cross-file components and inherited attributes were flattened
    const varNames = Array.from({ length: lowered.arena.varCount }, (_, i) => lowered.arena.getVarName(i));

    // Verify subparts r1 and r2 exist with base + specialized attributes
    assert.ok(varNames.includes("r1.R"), "r1.R parameter should exist");
    assert.ok(varNames.includes("r2.R"), "r2.R parameter should exist");
    assert.ok(varNames.includes("r1.active"), "r1.active (inherited from BaseComponent in File 1) should exist");
    assert.ok(varNames.includes("r2.active"), "r2.active (inherited from BaseComponent in File 1) should exist");

    // Verify ports from ElectricalPin (File 1) on r1 and r2 (File 2)
    assert.ok(varNames.includes("r1.p.v"), "r1.p.v potential should exist");
    assert.ok(varNames.includes("r1.p.i"), "r1.p.i flow should exist");
    assert.ok(varNames.includes("r1.n.v"), "r1.n.v potential should exist");
    assert.ok(varNames.includes("r1.n.i"), "r1.n.i flow should exist");
    assert.ok(varNames.includes("r2.p.v"), "r2.p.v potential should exist");
    assert.ok(varNames.includes("r2.p.i"), "r2.p.i flow should exist");
    assert.ok(varNames.includes("r2.n.v"), "r2.n.v potential should exist");
    assert.ok(varNames.includes("r2.n.i"), "r2.n.i flow should exist");

    // Verify parameter overrides on subparts
    const r1RIdx = lowered.arena.lookupVariable("r1.R");
    assert.notEqual(r1RIdx, -1);
    assert.equal(lowered.arena.getVarStartValue(r1RIdx), 100.0, "r1.R should be overridden to 100.0");

    const r2RIdx = lowered.arena.lookupVariable("r2.R");
    assert.notEqual(r2RIdx, -1);
    assert.equal(lowered.arena.getVarStartValue(r2RIdx), 200.0, "r2.R should be overridden to 200.0");

    // 5. Verify equations (Ohm's law from File 2 for r1 and r2 + connection equations in File 3)
    assert.ok(lowered.eqCount >= 3, `Expected at least 3 equations (2 ohm + 1 connect), got ${lowered.eqCount}`);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { AutomationMLWorkspaceIndex } from "../src/workspace-index.js";

describe("AutomationMLWorkspaceIndex", () => {
  const sampleAml = `
    aml "FactoryFloor.aml" version "2.15"
    systemUnitClassLib "RobotLib" {
      systemUnitClass PalletizerUnit extends "AutomationMLBaseSystemUnitClassLib/BaseUnit"
    }
    instanceHierarchy "Line1" {
      element Palletizer1 : "RobotLib/PalletizerUnit" [id="pal-1", ppr=Resource] {
        attribute cycleTime: REAL = 4.2 [s]
        interface gripCmd: In BOOL
      }
    }
  `;

  it("indexes files, resolves symbols in scope, and looks up by name and ID", () => {
    const index = new AutomationMLWorkspaceIndex();
    index.register("file:///line1.aml");
    assert.strictEqual(index.has("file:///line1.aml"), true);

    const fileIdx = index.indexFile("file:///line1.aml", sampleAml);
    assert(fileIdx.symbols.size >= 4);
    assert.strictEqual(index.fileCount, 1);

    const foundByName = index.findByName("Palletizer1");
    assert.strictEqual(foundByName.length, 1);
    assert.strictEqual(foundByName[0]?.kind, "Component");

    const foundById = index.findByName("pal-1");
    assert.strictEqual(foundById.length, 1);
    assert.strictEqual(foundById[0]?.name, "Palletizer1");

    const foundClass = index.findByName("RobotLib/PalletizerUnit");
    assert.strictEqual(foundClass.length, 1);
    assert.strictEqual(foundClass[0]?.kind, "Class");

    const palSym = foundByName[0]!;
    const gripSym = index.resolveInScope("gripCmd", palSym.id, "file:///line1.aml");
    assert(gripSym !== null);
    assert.strictEqual(gripSym.name, "gripCmd");

    const exact = index.lookupExact(palSym.id);
    assert(exact !== undefined);
    assert.strictEqual(exact.name, "Palletizer1");

    index.reindexDocument("file:///line1.aml", () => sampleAml);
    assert(index.version >= 2);

    index.clear();
    assert.strictEqual(index.fileCount, 0);
  });
});

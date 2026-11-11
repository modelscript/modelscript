// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { automationMLLanguage, getAutomationMLDocument, resolveAutomationMLInScope } from "../src/index.js";

describe("AutomationML UnifiedWorkspace Indexing", () => {
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
    const ws = new UnifiedWorkspace(automationMLLanguage);
    ws.setDocument("file:///line1.aml", sampleAml);
    assert.strictEqual(ws.hasDocument("file:///line1.aml"), true);

    const fileIdx = ws.getFileIndex("file:///line1.aml");
    assert(fileIdx !== undefined && fileIdx.symbols.size >= 4);
    assert.strictEqual(ws.fileCount, 1);

    const foundByName = ws.findSymbolsByName("Palletizer1");
    assert.strictEqual(foundByName.length, 1);
    assert.strictEqual(foundByName[0]?.kind, "Component");

    const foundById = ws.findSymbolsByName("pal-1");
    assert.strictEqual(foundById.length, 1);
    assert.strictEqual(foundById[0]?.name, "Palletizer1");

    const foundClass = ws.findSymbolsByName("RobotLib/PalletizerUnit");
    assert.strictEqual(foundClass.length, 1);
    assert.strictEqual(foundClass[0]?.kind, "Class");

    const palSym = foundByName[0]!;
    const gripSym = resolveAutomationMLInScope(ws, "gripCmd", palSym.id, "file:///line1.aml");
    assert(gripSym !== null);
    assert.strictEqual(gripSym.name, "gripCmd");

    const exact = ws.getIndex().symbols.get(palSym.id);
    assert(exact !== undefined);
    assert.strictEqual(exact.name, "Palletizer1");

    assert(getAutomationMLDocument(ws, "file:///line1.aml") !== undefined);

    const prevVersion = ws.version;
    ws.setDocument("file:///line1.aml", sampleAml);
    assert(ws.version > prevVersion);

    ws.clear();
    assert.strictEqual(ws.fileCount, 0);
  });
});

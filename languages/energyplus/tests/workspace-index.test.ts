// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { energyplusLanguage, getAllEnergyPlusZones, getEnergyPlusDocument } from "../src/index.js";

const MODEL_A = `
Building, TowerA, 0, City;
Zone, Level1, 0, 0, 0, 0, 1, 1, 3.5, 350.0;
Material, Steel, Smooth, 0.02, 50.0, 7800, 480;
Construction, SteelDeck, Steel;
`;

const MODEL_B = `
Building, TowerB, 0, City;
Zone, Level2, 0, 0, 0, 0, 1, 1, 3.5, 350.0;
Material, Glass, Smooth, 0.006, 1.0, 2500, 750;
Construction, GlassFacade, Glass;
`;

describe("EnergyPlus Multi-File Workspace Indexer", () => {
  it("indexes multiple EnergyPlus building decks across files", () => {
    const ws = new UnifiedWorkspace(energyplusLanguage);
    const uriA = "file:///workspace/models/tower_a.idf";
    const uriB = "file:///workspace/models/tower_b.idf";

    ws.setDocument(uriA, MODEL_A);
    ws.setDocument(uriB, MODEL_B);

    assert.strictEqual(ws.fileCount, 2);
    assert.strictEqual(ws.hasDocument(uriA), true);
    assert.strictEqual(ws.hasDocument(uriB), true);

    const docA = getEnergyPlusDocument(ws, uriA);
    assert.strictEqual(docA?.building?.name, "TowerA");
    assert.strictEqual(docA?.zones.length, 1);

    const docB = getEnergyPlusDocument(ws, uriB);
    assert.strictEqual(docB?.building?.name, "TowerB");
    assert.strictEqual(docB?.zones.length, 1);

    const level1Syms = ws.findSymbolsByName("Level1");
    assert.strictEqual(level1Syms.length, 1);
    assert.strictEqual(level1Syms[0]?.name, "Level1");

    const allZones = getAllEnergyPlusZones(ws);
    assert.strictEqual(allZones.length, 2);
  });
});

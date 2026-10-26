// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  executeEnergyPlusAction,
  getEnergyPlusDocumentSymbols,
  getEnergyPlusHover,
  validateEnergyPlus,
} from "../src/lsp.js";

const VALID_IDF = `
Building, CleanBldg, 0, Suburbs;
Zone, CleanZone, 0, 0, 0, 0, 1, 1, 3.0, 100.0;
Material, GoodMat, MediumRough, 0.2, 1.5, 2200, 850;
Construction, GoodConst, GoodMat;
BuildingSurface:Detailed, CleanWall, Wall, GoodConst, CleanZone, Outdoors, , SunExposed, WindExposed, 0.5, 4, 0,0,3, 0,0,0, 5,0,0, 5,0,3;
`;

describe("EnergyPlus LSP Language Services", () => {
  it("validates clean building model with zero diagnostics", () => {
    const diags = validateEnergyPlus(VALID_IDF);
    assert.strictEqual(diags.length, 0);
  });

  it("extracts document symbols for building, zones, materials, and constructions", () => {
    const symbols = getEnergyPlusDocumentSymbols(VALID_IDF);
    assert(symbols.length >= 4);

    const bldgSym = symbols.find((s) => s.name.includes("CleanBldg"));
    assert(bldgSym !== undefined);

    const zoneSym = symbols.find((s) => s.name.includes("CleanZone"));
    assert(zoneSym !== undefined);
    assert(zoneSym.children && zoneSym.children.length >= 1);
  });

  it("provides hover details on thermal zones and materials", () => {
    const zoneHover = getEnergyPlusHover(VALID_IDF, 50); // Inside zone definition
    assert(zoneHover !== null);
    assert(zoneHover.contents.value.includes("CleanZone"));
    assert(zoneHover.contents.value.includes("Volume"));
  });

  it("executes custom actions (toModelica, toDae, summary)", () => {
    const summary = executeEnergyPlusAction("energyplus.summary", VALID_IDF);
    assert.strictEqual(summary.building, "CleanBldg");
    assert.strictEqual(summary.zones, 1);

    const moRes = executeEnergyPlusAction("energyplus.toModelica", VALID_IDF);
    assert(moRes.modelica.includes("model CleanBldg"));

    const daeRes = executeEnergyPlusAction("energyplus.toDae", VALID_IDF);
    assert(daeRes.variables >= 3);
    assert(daeRes.equations >= 3);
  });
});

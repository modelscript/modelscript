// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  executeTopasAction,
  getTopasCompletions,
  getTopasDefinition,
  getTopasDocumentSymbols,
  getTopasHover,
  topasLanguage,
  TopasWorkspaceIndex,
  validateTopas,
} from "../src/index.js";

describe("TOPAS LSP Service & WorkspaceIndex", () => {
  const sampleText = `s:Ge/WaterPhantom/Type = "TsBox"
s:Ge/WaterPhantom/Parent = "World"
s:Ge/WaterPhantom/Material = "G4_WATER"
d:Ge/WaterPhantom/HLX = 150.0 mm
d:Ge/WaterPhantom/HLY = 150.0 mm
d:Ge/WaterPhantom/HLZ = 200.0 mm

s:So/ProtonBeam/Type = "Beam"
s:So/ProtonBeam/BeamParticle = "proton"
d:So/ProtonBeam/BeamEnergy = 150.0 MeV
u:So/ProtonBeam/BeamEnergySpread = 0.5

s:Sc/DoseScorer/Quantity = "DoseToWater"
s:Sc/DoseScorer/Component = "WaterPhantom"
`;

  it("indexes symbols in TopasWorkspaceIndex and resolves across scope", () => {
    const idx = new TopasWorkspaceIndex();
    const uri = "file:///nozzle.topas";
    idx.indexFile(uri, sampleText);
    assert.strictEqual(idx.fileCount, 1);
    assert(idx.has(uri));

    const phantomSyms = idx.findByName("WaterPhantom");
    assert.strictEqual(phantomSyms.length, 1);
    assert.strictEqual(phantomSyms[0]?.kind, "Component");

    const resolved = idx.resolveInScope("ProtonBeam", null, uri);
    assert(resolved !== null);
    assert.strictEqual(resolved?.namePath, "So/ProtonBeam");
  });

  it("provides LSP diagnostics, symbols, hover cards, completions, definition, and actions", async () => {
    assert.strictEqual(topasLanguage.name, "topas");
    assert(topasLanguage.fileExtensions.includes(".topas"));
    assert(topasLanguage.fileExtensions.includes(".mac"));

    const diags = validateTopas(sampleText);
    assert.strictEqual(diags.length, 0);

    const symbols = getTopasDocumentSymbols(sampleText);
    assert.strictEqual(symbols.length, 3);

    const beamOffset = sampleText.indexOf("ProtonBeam");
    const hover = getTopasHover(sampleText, beamOffset);
    assert(hover !== null);
    assert(hover.contents.value.includes("Bragg Peak Range"));

    const def = getTopasDefinition(sampleText, sampleText.lastIndexOf("WaterPhantom"), "file:///nozzle.topas");
    assert(def !== null);
    assert.strictEqual(def.range.start.line, 0);

    const completions = getTopasCompletions(sampleText);
    assert(completions.some((c) => c.label === "G4_WATER"));
    assert(completions.some((c) => c.label === "WaterPhantom"));

    const daeRes = await executeTopasAction("topas_to_dae", sampleText);
    assert(daeRes.variableCount > 0);
  });
});

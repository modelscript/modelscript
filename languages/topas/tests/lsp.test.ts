// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import {
  executeTopasAction,
  getTopasCompletions,
  getTopasDefinition,
  getTopasDocumentSymbols,
  getTopasHover,
  resolveTopasInScope,
  topasLanguage,
  validateTopas,
} from "../src/index.js";

describe("TOPAS LSP Service & UnifiedWorkspace", () => {
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

  it("indexes symbols in UnifiedWorkspace and resolves across scope", () => {
    const ws = new UnifiedWorkspace(topasLanguage);
    const uri = "file:///nozzle.topas";
    ws.setDocument(uri, sampleText);
    assert.strictEqual(ws.fileCount, 1);
    assert(ws.hasDocument(uri));

    const phantomSyms = ws.findSymbolsByName("WaterPhantom");
    assert.strictEqual(phantomSyms.length, 1);
    assert.strictEqual(phantomSyms[0]?.kind, "Component");

    const resolved = resolveTopasInScope(ws, "ProtonBeam", null, uri);
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

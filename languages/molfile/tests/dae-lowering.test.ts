// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANONICAL_MOLFILES } from "../src/catalog/molfile-std-schemas.js";
import { lowerMolfileToDae } from "../src/dae/molfile-to-dae.js";
import { parseMolfileDocument } from "../src/parser/molfile-parser.js";

describe("Molfile Harmonic Molecular Mechanics DAE Lowering", () => {
  it("lowers Benzene 3D coordinates, bond distances, and harmonic bond-stretch equations into DAEBuilder", () => {
    const doc = parseMolfileDocument(CANONICAL_MOLFILES.Benzene);
    const dae = lowerMolfileToDae(doc);

    const vars = dae.variables();
    const eqs = dae.equations();

    // 3 molecular scalars + 6*3 coords + 6*4 bond vars + 1 total energy = 46 variables & equations
    assert.strictEqual(vars.length, 46);
    assert.strictEqual(eqs.length, 46);

    const varNames = new Set(vars.map((v) => v.name));
    assert.ok(varNames.has("Benzene_MW"));
    assert.ok(varNames.has("Benzene_RingCount"));
    assert.ok(varNames.has("Benzene_x_1"));
    assert.ok(varNames.has("Benzene_b1_r0"));
    assert.ok(varNames.has("Benzene_b1_kb"));
    assert.ok(varNames.has("Benzene_b1_r"));
    assert.ok(varNames.has("Benzene_b1_E_stretch"));
    assert.ok(varNames.has("Benzene_E_stretch_total"));
  });

  it("lowers multi-record SDF documents with unique prefixed variable namespaces", () => {
    const sdf = `${CANONICAL_MOLFILES.Water}\n$$$$\n${CANONICAL_MOLFILES.Ethanol}\n$$$$`;
    const doc = parseMolfileDocument(sdf, "pair.sdf");
    const dae = lowerMolfileToDae(doc);

    const varNames = new Set(dae.variables().map((v) => v.name));
    assert.ok(varNames.has("Water_1_E_stretch_total"));
    assert.ok(varNames.has("Ethanol_2_E_stretch_total"));
    assert.strictEqual(dae.variables().length, dae.equations().length);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  applyBoundaryActionToDeck,
  getFeaDialect,
  synthesizeFeaBoundary,
  type BoundaryActionPayload,
} from "../src/index.js";

describe("@modelscript/fea Dialect Architecture", () => {
  it("resolves the 'inp' dialect by id and extension", () => {
    const dialectById = getFeaDialect("inp");
    const dialectByExt = getFeaDialect(".inp");

    assert.strictEqual(dialectById.id, "inp");
    assert.strictEqual(dialectByExt.id, "inp");
  });

  it("materializes embedded expressions with parameter lookup using the dialect", () => {
    const dialect = getFeaDialect("inp");

    const template = `** FEA Deck for {{ DroneArm.name }}
*HEADING
ModelScript Structural Study
*MATERIAL, NAME={{ DroneArm.material }}
*ELASTIC
 {{ DroneArm.youngsModulus }}, {{ DroneArm.poissonsRatio }}
*STEP
*STATIC
*CLOAD
 10, 2, {{ DroneArm.thrust * 1.5 }}
*BOUNDARY
 1, 1, 3
*END STEP
`;

    const parameters = {
      "DroneArm.name": "HexaDroneArm",
      "DroneArm.material": "ALUMINUM_6061",
      "DroneArm.youngsModulus": 70e9,
      "DroneArm.poissonsRatio": 0.33,
      "DroneArm.thrust": 20.0,
    };

    const materialized = dialect.materialize(template, { evaluator: parameters });

    assert.ok(materialized.includes("** FEA Deck for HexaDroneArm"));
    assert.ok(materialized.includes("*MATERIAL, NAME=ALUMINUM_6061"));
    assert.ok(materialized.includes("70000000000, 0.33") || materialized.includes("7e+10, 0.33"));
    assert.ok(materialized.includes("10, 2, 30"));
  });

  it("parses elements, nodes, materials, and loads into canonical FeaModelData", () => {
    const dialect = getFeaDialect("inp");

    const deck = `*HEADING
Cantilever Beam Study
*NODE
1, 0.0, 0.0, 0.0
2, 1.0, 0.0, 0.0
3, 0.0, 1.0, 0.0
4, 0.0, 0.0, 1.0
*ELEMENT, TYPE=C3D4, ELSET=BEAM
1, 1, 2, 3, 4
*MATERIAL, NAME=STEEL
*ELASTIC
 210000000000, 0.3
*DENSITY
 7850
*BOUNDARY
 1, 1, 3
*CLOAD
 2, 2, -500.0
`;

    const parsed = dialect.parse(deck);

    assert.strictEqual(parsed.dialect, "inp");
    assert.strictEqual(parsed.heading, "Cantilever Beam Study");
    assert.strictEqual(parsed.nodes.size, 4);
    assert.deepStrictEqual(parsed.nodes.get(2), { id: 2, x: 1.0, y: 0.0, z: 0.0 });

    assert.strictEqual(parsed.elements.size, 1);
    assert.strictEqual(parsed.elements.get(1)?.type, "C3D4");
    assert.deepStrictEqual(parsed.elements.get(1)?.nodes, [1, 2, 3, 4]);

    const mat = parsed.materials.get("STEEL");
    assert.ok(mat);
    assert.strictEqual(mat.E, 210e9);
    assert.strictEqual(mat.nu, 0.3);
    assert.strictEqual(mat.rho, 7850);

    assert.ok(parsed.fixedNodes.has(1));
    assert.deepStrictEqual(parsed.nodalLoads.get(2), [0, -500, 0]);
  });

  it("synthesizes FEA boundary directives and injects them into *STEP blocks", () => {
    const fixAction: BoundaryActionPayload = {
      kind: "fix",
      targetId: "FIXED_ROOT",
      dofs: [1, 3],
    };

    const forceAction: BoundaryActionPayload = {
      kind: "force",
      targetId: 105,
      vector: [0.0, 1500.0, -3000.0],
    };

    const pressureAction: BoundaryActionPayload = {
      kind: "pressure",
      targetId: "SKIN_SURFACE",
      magnitude: 25000.0,
    };

    const fixSnippet = synthesizeFeaBoundary(fixAction, "calculix");
    assert.strictEqual(fixSnippet, "*BOUNDARY\nFIXED_ROOT, 1, 3, 0.0");

    const forceSnippet = synthesizeFeaBoundary(forceAction, "calculix");
    assert.ok(forceSnippet.includes("*CLOAD"));
    assert.ok(forceSnippet.includes("105, 2, 1500"));
    assert.ok(forceSnippet.includes("105, 3, -3000"));

    const pressureSnippet = synthesizeFeaBoundary(pressureAction, "calculix");
    assert.strictEqual(pressureSnippet, "*DLOAD\nSKIN_SURFACE, P, 25000");

    const baseDeck = `*HEADING
Cantilever Plate
*STEP
*STATIC
*CLOAD
 1, 2, -100.0
*END STEP
`;

    const updated = applyBoundaryActionToDeck(baseDeck, fixAction, "calculix");
    assert.ok(updated.includes("*BOUNDARY\nFIXED_ROOT, 1, 3, 0.0"));
    assert.ok(
      updated.indexOf("*BOUNDARY") < updated.indexOf("*END STEP"),
      "*BOUNDARY must be inserted before *END STEP",
    );
  });
});

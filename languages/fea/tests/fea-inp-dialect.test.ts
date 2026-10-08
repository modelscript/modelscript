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

  it("parses BDF decks including CQUAD4, CTETRA, MAT1, SPC, and FORCE cards", () => {
    const dialect = getFeaDialect("bdf");
    assert.strictEqual(dialect.id, "bdf");

    const bdfDeck = `$ Bulk Data Deck
GRID,1,,0.0,0.0,0.0
GRID,2,,10.0,0.0,0.0
GRID,3,,10.0,10.0,0.0
GRID,4,,0.0,10.0,0.0
GRID,5,,0.0,0.0,10.0
CQUAD4,101,1,1,2,3,4
CTETRA,201,1,1,2,3,5
MAT1,1,2.1E11,,0.3,7850.0
SPC1,1,123456,1,4
FORCE,1,2,0,500.0,0.0,-1.0,0.0
ENDDATA
`;

    const parsed = dialect.parse(bdfDeck);
    assert.strictEqual(parsed.dialect, "bdf");
    assert.strictEqual(parsed.nodes.size, 5);
    assert.deepStrictEqual(parsed.nodes.get(1), { id: 1, x: 0.0, y: 0.0, z: 0.0 });
    assert.deepStrictEqual(parsed.nodes.get(3), { id: 3, x: 10.0, y: 10.0, z: 0.0 });

    assert.strictEqual(parsed.elements.size, 2);
    assert.deepStrictEqual(parsed.elements.get(101), { id: 101, type: "CQUAD4", family: "shell", nodes: [1, 2, 3, 4] });
    assert.deepStrictEqual(parsed.elements.get(201), { id: 201, type: "CTETRA", family: "solid", nodes: [1, 2, 3, 5] });

    const mat = parsed.materials.get("1");
    assert.ok(mat);
    assert.strictEqual(mat.E, 2.1e11);
    assert.strictEqual(mat.nu, 0.3);
    assert.strictEqual(mat.rho, 7850.0);

    assert.ok(parsed.fixedNodes.has(1));
    assert.ok(parsed.fixedNodes.has(4));

    assert.deepStrictEqual(parsed.nodalLoads.get(2), [0.0, -500.0, 0.0]);
  });

  it("materializes safe math functions, scientific notation, and captures diagnostics", () => {
    const dialect = getFeaDialect("inp");
    const template = `
FORCE= {{ 1.5e4 * 2.0 }}
TRIG_FORCE= {{ sind(30) * 1000 }}
SQRT_VAL= {{ sqrt(144) }}
PI_VAL= {{ PI }}
BAD_VAL= {{ missing_symbol + 10 }}
`;
    const diagnostics: any[] = [];
    const materialized = dialect.materialize(template, { diagnostics });

    assert.ok(materialized.includes("FORCE= 30000"));
    assert.ok(materialized.includes("TRIG_FORCE= 500"));
    assert.ok(materialized.includes("SQRT_VAL= 12"));
    assert.ok(materialized.includes("3.14159"));
    assert.ok(materialized.includes("BAD_VAL= missing_symbol + 10"));
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].severity, "error");
  });

  it("parses fixed 8-column BDF decks with blank fields and short-format exponents", () => {
    const dialect = getFeaDialect("bdf");
    // Standard fixed 8-character fields without commas
    const fixedBdf = [
      "$ Fixed 8-column deck",
      "GRID    " + "       1" + "        " + "     0.0" + "     0.0" + "     0.0",
      "GRID    " + "       2" + "        " + "    10.0" + "     0.0" + "     0.0",
      "MAT1    " + "       1" + "  2.1+11" + "        " + "     0.3" + "  7850.0",
      "FORCE   " + "       1" + "       2" + "       0" + "   500.0" + "     0.0" + "    -1.0" + "     0.0",
      "FORCE   " + "       1" + "       2" + "       0" + "   200.0" + "     1.0" + "     0.0" + "     0.0",
      "SPC1    " + "       1" + "  123456" + "       1" + "    THRU" + "       2",
      "ENDDATA",
    ].join("\n");

    const parsed = dialect.parse(fixedBdf);
    assert.strictEqual(parsed.nodes.size, 2);
    assert.deepStrictEqual(parsed.nodes.get(1), { id: 1, x: 0.0, y: 0.0, z: 0.0 });
    assert.deepStrictEqual(parsed.nodes.get(2), { id: 2, x: 10.0, y: 0.0, z: 0.0 });

    const mat = parsed.materials.get("1");
    assert.ok(mat);
    assert.strictEqual(mat.E, 2.1e11);

    // Accumulated forces on node 2: [200, -500, 0]
    assert.deepStrictEqual(parsed.nodalLoads.get(2), [200.0, -500.0, 0.0]);

    // SPC1 THRU range expansion
    assert.ok(parsed.fixedNodes.has(1));
    assert.ok(parsed.fixedNodes.has(2));
  });

  it("parses multiline element continuation, *ELSET, and *NSET GENERATE in INP decks", () => {
    const dialect = getFeaDialect("inp");
    const deck = `
*HEADING
Multiline Element and Sets Test
*NODE
1, 0.0, 0.0, 0.0
2, 1.0, 0.0, 0.0
3, 0.0, 1.0, 0.0
4, 0.0, 0.0, 1.0
*ELEMENT, TYPE=C3D10, ELSET=TETRA
1, 1, 2, 3, 4, 5, 6, 7, 8,
9, 10
*NSET, NSET=ROOT_NODES, GENERATE
1, 4, 1
*ELSET, ELSET=SOLID_PARTS
1
`;
    const parsed = dialect.parse(deck);
    assert.strictEqual(parsed.elements.size, 1);
    const elem = parsed.elements.get(1);
    assert.ok(elem);
    assert.strictEqual(elem.type, "C3D10");
    assert.strictEqual(elem.family, "solid");
    assert.deepStrictEqual(elem.nodes, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const nset = parsed.nodeSets.get("ROOT_NODES");
    assert.ok(nset);
    assert.strictEqual(nset.size, 4);
    assert.ok(nset.has(1) && nset.has(2) && nset.has(3) && nset.has(4));

    const elset = parsed.elementSets.get("SOLID_PARTS");
    assert.ok(elset);
    assert.ok(elset.has(1));
  });

  it("synthesizes moments and BDF boundaries and handles case-insensitive steps", () => {
    const momentAction: BoundaryActionPayload = {
      kind: "moment",
      targetId: 10,
      dofs: [5],
      magnitude: 250.0,
    };
    const inpSnippet = synthesizeFeaBoundary(momentAction, "calculix");
    assert.ok(inpSnippet.includes("*CLOAD"));
    assert.ok(inpSnippet.includes("10, 5, 250"));

    const bdfFixAction: BoundaryActionPayload = {
      kind: "fix",
      targetId: 101,
      dofs: [1, 2, 3],
    };
    const bdfSnippet = synthesizeFeaBoundary(bdfFixAction, "bdf");
    assert.strictEqual(bdfSnippet, "SPC1, 1, 123, 101");

    const deckLower = `*HEADING\nPlate\n*step\n*static\n*end step\n`;
    const updated = applyBoundaryActionToDeck(deckLower, momentAction, "calculix");
    assert.ok(updated.includes("*CLOAD\n10, 5, 250"));
    assert.ok(updated.indexOf("*CLOAD") < updated.toLowerCase().indexOf("*end step"));
  });
});

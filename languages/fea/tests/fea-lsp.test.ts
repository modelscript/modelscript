// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  executeFeaAction,
  feaToDae,
  feaToModelica,
  FeaWorkspaceIndex,
  getFeaDocumentSymbols,
  getFeaHover,
  parseFeaDeck,
  validateFea,
} from "../src/index.js";

const VALID_INP_DECK = `*HEADING
Cantilever Beam Model for Benchmark Testing
*NODE
1, 0.0, 0.0, 0.0
2, 1.0, 0.0, 0.0
3, 2.0, 0.0, 0.0
4, 0.0, 1.0, 0.0
5, 1.0, 1.0, 0.0
6, 2.0, 1.0, 0.0
7, 0.0, 0.0, 1.0
8, 1.0, 0.0, 1.0
*ELEMENT, TYPE=C3D8, ELSET=BEAM_ELEMS
1, 1, 2, 5, 4, 7, 8, 6, 3
*NSET, NSET=FIXED_NODES
1, 4, 7
*NSET, NSET=TIP_NODES
3, 6
*MATERIAL, NAME=STEEL
*ELASTIC
210000000000.0, 0.3
*DENSITY
7850.0
*SOLID SECTION, ELSET=BEAM_ELEMS, MATERIAL=STEEL
*BOUNDARY
FIXED_NODES, 1, 3, 0.0
*CLOAD
3, 2, -1000.0
`;

const INVALID_INP_DECK = `*HEADING
Invalid Material Deck
*NODE
1, 0.0, 0.0, 0.0
*MATERIAL, NAME=BAD_STEEL
*ELASTIC
-210000.0, 0.8
*DENSITY
-50.0
*PLASTIC
-100.0, 0.0
`;

describe("@modelscript/fea LSP Services & DAE Lowering", () => {
  test("validates FEA deck and reports 0 error diagnostics for valid deck", () => {
    const diags = validateFea(VALID_INP_DECK, "beam.inp");
    const errors = diags.filter((d) => d.severity === 1);
    assert.equal(errors.length, 0, `Expected 0 errors on valid deck, got: ${JSON.stringify(errors)}`);
  });

  test("detects pre-flight diagnostics with standard M74xx error codes", () => {
    const diags = validateFea(INVALID_INP_DECK, "invalid.inp");
    assert.ok(diags.length >= 3, `Expected multiple diagnostics, got ${diags.length}`);

    const codes = diags.map((d) => d.code);
    assert.ok(codes.includes("M7401"), "Should detect M7401: zero-elastic-modulus");
    assert.ok(codes.includes("M7402"), "Should detect M7402: poisson-ratio-limit");
    assert.ok(codes.includes("M7407"), "Should detect M7407: negative-yield-stress");

    // Verify diagnostics point to actual material line (> 0) rather than hardcoded line 0
    const m7401 = diags.find((d) => d.code === "M7401");
    assert.ok(m7401 && m7401.range.start.line > 0, `Expected M7401 line > 0, got ${m7401?.range.start.line}`);
  });

  test("detects M7405 when mesh has elements but no material definition", () => {
    const noMatDeck = `*HEADING
Unassigned Material Mesh
*NODE
1, 0.0, 0.0, 0.0
2, 1.0, 0.0, 0.0
3, 0.0, 1.0, 0.0
4, 0.0, 0.0, 1.0
*ELEMENT, TYPE=C3D4, ELSET=PART_A
10, 1, 2, 3, 4
*BOUNDARY
1, 1, 3, 0.0
2, 1, 3, 0.0
3, 1, 3, 0.0
`;
    const diags = validateFea(noMatDeck, "nomat.inp");
    const m7405 = diags.find((d) => d.code === "M7405");
    assert.ok(m7405, "Should emit M7405 for missing material definition");
    assert.ok(m7405.range.start.line > 0, "M7405 should report element line number > 0");
  });

  test("extracts document symbols hierarchy for materials, element sets, and mesh counts", () => {
    const symbols = getFeaDocumentSymbols(VALID_INP_DECK, "beam.inp");
    assert.ok(symbols.length > 0, "Symbols array should not be empty");

    const root = symbols[0];
    assert.ok(root.name.includes("Cantilever Beam") || root.name.includes("FEA"), `Root name was: ${root.name}`);
    assert.ok(root.children && root.children.length > 0, "Root should have children symbols");

    const names = root.children!.map((c) => c.name);
    assert.ok(names.includes("STEEL"), "Should include material symbol STEEL");
    assert.ok(names.includes("BEAM_ELEMS"), "Should include element set BEAM_ELEMS");
    assert.ok(
      names.some((n) => n.includes("Nodes")),
      "Should include nodes summary",
    );
    assert.ok(
      names.some((n) => n.includes("Elements")),
      "Should include elements summary",
    );
  });

  test("provides contextual hover information for FEA materials and elements", () => {
    const hover = getFeaHover(VALID_INP_DECK, { line: 5, character: 0 }, "beam.inp");
    assert.ok(hover, "Hover should not be undefined");
    assert.ok(hover.contents.value.includes("FEA Structural Model"));
    assert.ok(hover.contents.value.includes("STEEL"));
    assert.ok(hover.contents.value.includes("210000000000"));
  });

  test("lowers FEA structural model directly into linear-memory DAEBuilder arena", () => {
    const deck = parseFeaDeck(VALID_INP_DECK, "inp");
    const dae = feaToDae(deck, { numModes: 4, dampingRatio: 0.02 });

    assert.ok(dae.varCount >= 10, `Expected >= 10 variables, got ${dae.varCount}`);
    assert.ok(dae.eqCount >= 8, `Expected >= 8 equations, got ${dae.eqCount}`);

    const vars = dae.getVariables();
    const varNames = vars.map((v) => v.name);
    assert.ok(varNames.includes("q_1"), "DAE should declare modal coordinate q_1");
    assert.ok(varNames.includes("v_1"), "DAE should declare modal velocity v_1");
    assert.ok(varNames.includes("StrainEnergy"), "DAE should declare StrainEnergy output");
    assert.ok(varNames.includes("MaxVonMises"), "DAE should declare MaxVonMises output");
  });

  test("projects FEA model into clean Modelica 3.x flexible structural body", () => {
    const deck = parseFeaDeck(VALID_INP_DECK, "inp");
    const mo = feaToModelica(deck, "CantileverBeam");

    assert.ok(mo.includes("model CantileverBeam"), "Modelica model should have correct name");
    assert.ok(mo.includes("parameter Real E = 210000000000"), "Should contain Young's modulus parameter");
    assert.ok(mo.includes("Real q1"), "Should declare modal coordinate q1");
    assert.ok(mo.includes("Real tipDisplacement"), "Should declare tipDisplacement");
    assert.ok(mo.includes("end CantileverBeam;"), "Should cleanly terminate Modelica model");
  });

  test("indexes FEA models in FeaWorkspaceIndex for multi-file discovery", () => {
    const index = new FeaWorkspaceIndex();
    index.indexFile("file:///structures/beam.inp", VALID_INP_DECK);

    assert.equal(index.fileCount, 1);
    assert.ok(index.has("file:///structures/beam.inp"));

    const deck = index.getDeck("file:///structures/beam.inp");
    assert.ok(deck);
    assert.ok(deck.materials.has("STEEL"));

    const defs = index.findDefinition("STEEL", "file:///structures/beam.inp");
    assert.ok(defs.length > 0, "Should locate definition of material 'STEEL'");
  });

  test("executes domain actions: lint, to_dae, to_modelica, solve", async () => {
    const lintRes = await executeFeaAction("lint", { content: VALID_INP_DECK });
    assert.equal(lintRes.success, true);

    const daeRes = await executeFeaAction("to_dae", { content: VALID_INP_DECK });
    assert.equal(daeRes.success, true);
    assert.ok(daeRes.variables > 0);
    assert.ok(daeRes.equations > 0);

    const moRes = await executeFeaAction("to_modelica", { content: VALID_INP_DECK });
    assert.equal(moRes.success, true);
    assert.ok(moRes.modelica.includes("model"));

    const solveRes = await executeFeaAction("solve", { content: VALID_INP_DECK });
    assert.equal(solveRes.success, true);
    assert.ok(solveRes.numNodes > 0);
    assert.ok(solveRes.numElements > 0);
    assert.ok(solveRes.maxDisplacementM > 0);
  });
});

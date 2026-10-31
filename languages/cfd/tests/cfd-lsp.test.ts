// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  cfdToDae,
  cfdToModelica,
  CfdWorkspaceIndex,
  executeCfdAction,
  getCfdDocumentSymbols,
  getCfdHover,
  parseCfdConfig,
  validateCfd,
} from "../src/index.js";

const VALID_SU2_DECK = `%
% SU2 Aerodynamic Configuration Deck: ONERA M6 Wing
%
PHYSICAL_PROBLEM= NAVIER_STOKES
MATH_PROBLEM= EULER
KIND_TURB_MODEL= NONE
REYNOLDS_NUMBER= 11.72E6
MACH_NUMBER= 0.8395
AOA= 3.06
REF_AREA= 0.753
REF_LENGTH= 0.646
MESH_FILENAME= oneraM6.su2
%
% Boundary Conditions
MARKER_EULER= ( wing )
MARKER_FAR= ( farfield )
MARKER_INLET= ( inlet, 101325.0, 288.15, 1.0, 0.0, 0.0 )
MARKER_OUTLET= ( outlet, 101325.0 )
`;

const INVALID_SU2_DECK = `%
% Invalid SU2 configuration for pre-flight testing
%
PHYSICAL_PROBLEM= EULER
MACH_NUMBER= -0.5
REYNOLDS_NUMBER= -1000
REF_AREA= -2.5
CFL_NUMBER= 150.0
MESH_FILENAME= none
`;

describe("@modelscript/cfd LSP Services & DAE Lowering", () => {
  test("validates CFD configuration and reports 0 error diagnostics for valid deck", () => {
    const diags = validateCfd(VALID_SU2_DECK, "oneraM6.cfg");
    const errors = diags.filter((d) => d.severity === 1);
    assert.equal(errors.length, 0, `Expected 0 errors on valid deck, got: ${JSON.stringify(errors)}`);
  });

  test("detects pre-flight diagnostics with standard M73xx error codes", () => {
    const diags = validateCfd(INVALID_SU2_DECK, "invalid.cfg");
    assert.ok(diags.length >= 3, `Expected multiple diagnostics, got ${diags.length}`);

    const codes = diags.map((d) => d.code);
    assert.ok(codes.includes("M7305"), "Should detect M7305: unphysical-freestream-mach");
    assert.ok(codes.includes("M7306"), "Should detect M7306: unphysical-reynolds-number");
    assert.ok(codes.includes("M7307"), "Should detect M7307: negative-surface-area");
    assert.ok(codes.includes("M7301"), "Should detect M7301: cfl-stability-violation");
    assert.ok(codes.includes("M7302"), "Should detect M7302: unresolved-mesh-file");

    // Verify diagnostics point to actual directive lines (> 0) rather than hardcoded line 0
    const m7305 = diags.find((d) => d.code === "M7305");
    assert.ok(m7305 && m7305.range.start.line > 0, `Expected M7305 line > 0, got ${m7305?.range.start.line}`);
  });

  test("extracts document symbols hierarchy for domain, markers, and parameters", () => {
    const symbols = getCfdDocumentSymbols(VALID_SU2_DECK, "oneraM6.cfg");
    assert.ok(symbols.length > 0, "Symbols array should not be empty");

    const root = symbols[0];
    assert.ok(root.name.includes("EULER") || root.name.includes("oneraM6"), `Root name was: ${root.name}`);
    assert.ok(root.children && root.children.length > 0, "Root should have children symbols");

    const names = root.children!.map((c) => c.name);
    assert.ok(names.includes("wing") || names.includes("inlet"), "Should include boundary markers");
    assert.ok(names.includes("MACH_NUMBER"), "Should include MACH_NUMBER parameter");
  });

  test("provides contextual hover information for CFD directives and markers", () => {
    const hover = getCfdHover(VALID_SU2_DECK, { line: 5, character: 0 }, "oneraM6.cfg");
    assert.ok(hover, "Hover should not be undefined");
    assert.ok(hover.contents.value.includes("CFD Domain Specification"));
    assert.ok(hover.contents.value.includes("0.8395"));
    assert.ok(hover.contents.value.includes("wing"));
  });

  test("lowers CFD domain directly into linear-memory DAEBuilder arena", () => {
    const model = parseCfdConfig(VALID_SU2_DECK, "su2");
    const dae = cfdToDae(model, { numCells: 5, referenceArea: 0.753 });

    assert.ok(dae.varCount >= 15, `Expected >= 15 variables, got ${dae.varCount}`);
    assert.equal(
      dae.varCount,
      dae.eqCount,
      `Expected structurally square DAE (varCount=${dae.varCount}, eqCount=${dae.eqCount})`,
    );

    const vars = dae.getVariables();
    const varNames = vars.map((v) => v.name);
    assert.ok(varNames.includes("C_L"), "DAE should declare C_L lift coefficient");
    assert.ok(varNames.includes("C_D"), "DAE should declare C_D drag coefficient");
    assert.ok(varNames.includes("Lift"), "DAE should declare Lift force");
    assert.ok(varNames.includes("Drag"), "DAE should declare Drag force");
    assert.ok(varNames.includes("rho_1"), "DAE should declare cell density state");
    assert.ok(varNames.includes("u_1"), "DAE should declare cell velocity state");
  });

  test("projects CFD configuration into clean Modelica 3.x acausal model", () => {
    const model = parseCfdConfig(VALID_SU2_DECK, "su2");
    const mo = cfdToModelica(model, "OneraM6Wing");

    assert.ok(mo.includes("model OneraM6Wing"), "Modelica model should have correct name");
    assert.ok(mo.includes("parameter Real Mach = 0.8395"), "Should contain Mach parameter");
    assert.ok(mo.includes("Real Lift"), "Should declare Lift variable");
    assert.ok(mo.includes("Real Drag"), "Should declare Drag variable");
    assert.ok(mo.includes("end OneraM6Wing;"), "Should cleanly terminate Modelica model");
  });

  test("indexes CFD models in CfdWorkspaceIndex for multi-file discovery", () => {
    const index = new CfdWorkspaceIndex();
    index.indexFile("file:///cases/oneraM6.cfg", VALID_SU2_DECK);

    assert.equal(index.fileCount, 1);
    assert.ok(index.has("file:///cases/oneraM6.cfg"));

    const config = index.getConfig("file:///cases/oneraM6.cfg");
    assert.ok(config);
    assert.equal(config.machNumber, 0.8395);

    const defs = index.findDefinition("wing", "file:///cases/oneraM6.cfg");
    assert.ok(defs.length > 0, "Should locate definition of marker 'wing'");
  });

  test("executes domain actions: lint, to_dae, to_modelica, solve", async () => {
    const lintRes = await executeCfdAction("lint", { content: VALID_SU2_DECK });
    assert.equal(lintRes.success, true);

    const daeRes = await executeCfdAction("to_dae", { content: VALID_SU2_DECK });
    assert.equal(daeRes.success, true);
    assert.ok(daeRes.variables > 0);
    assert.ok(daeRes.equations > 0);

    const moRes = await executeCfdAction("to_modelica", { content: VALID_SU2_DECK });
    assert.equal(moRes.success, true);
    assert.ok(moRes.modelica.includes("model"));

    const solveRes = await executeCfdAction("solve", { content: VALID_SU2_DECK });
    assert.equal(solveRes.success, true);
    assert.ok(solveRes.cL > 0, "Expected positive lift coefficient");
    assert.ok(solveRes.cD > 0, "Expected positive drag coefficient");
    assert.ok(solveRes.liftN > 0, "Expected positive lift force");
  });
});

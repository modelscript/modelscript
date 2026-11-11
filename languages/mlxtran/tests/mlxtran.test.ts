// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  executeMlxtranAction,
  getMlxtranDocumentSymbols,
  getMlxtranHover,
  lintMlxtran,
  lowerMlxtranToDae,
  mlxtranToModelica,
  parseMlxtran,
  provideMlxtranCompletions,
  serializeMlxtran,
  solveMlxtranPk,
  validateMlxtran,
} from "../src/index.js";

const TWO_CMT_ORAL_MLXTRAN = `
; Two-compartment oral absorption model
[LONGITUDINAL]
input = {ka, V, Cl, Q, V2}

EQUATION:
ddt_Ad = -ka * Ad
ddt_Ac = ka * Ad - (Cl / V) * Ac - (Q / V) * Ac + (Q / V2) * Ap
ddt_Ap = (Q / V) * Ac - (Q / V2) * Ap

Cc = Ac / V

OUTPUT:
output = {Cc}

PK:
depot(target = Ad)
compartment(cmt = 1, amount = Ac, volume = V)
compartment(cmt = 2, amount = Ap, volume = V2)
`;

test("MLXTRAN Parser: parses [LONGITUDINAL], inputs, differential equations, and outputs", () => {
  const doc = parseMlxtran(TWO_CMT_ORAL_MLXTRAN);
  assert.equal(doc.model.inputs.length, 5);
  assert.deepEqual(
    doc.model.inputs.map((p) => p.name),
    ["ka", "V", "Cl", "Q", "V2"],
  );

  assert.equal(doc.model.equations.length, 4);
  assert.equal(doc.model.equations[0]!.lhs, "ddt_Ad");
  assert.equal(doc.model.equations[0]!.isDerivative, true);
  assert.equal(doc.model.equations[0]!.stateName, "Ad");

  assert.equal(doc.model.outputs.length, 1);
  assert.equal(doc.model.outputs[0], "Cc");

  assert.equal(doc.model.macros.length, 3);
  assert.equal(doc.model.macros[0]!.kind, "depot");
  assert.equal(doc.model.macros[1]!.kind, "compartment");
});

test("MLXTRAN Serializer: roundtrips AST back to valid MLXTRAN source", () => {
  const doc = parseMlxtran(TWO_CMT_ORAL_MLXTRAN);
  const serialized = serializeMlxtran(doc);
  assert.ok(serialized.includes("[LONGITUDINAL]"));
  assert.ok(serialized.includes("input = {ka, V, Cl, Q, V2}"));
  assert.ok(serialized.includes("ddt_Ad = -ka * Ad"));
  assert.ok(serialized.includes("output = {Cc}"));

  // Re-parse serialized output
  const reparsed = parseMlxtran(serialized);
  assert.equal(reparsed.model.inputs.length, 5);
  assert.equal(reparsed.model.equations.length, 4);
});

test("MLXTRAN Linter: valid model produces zero errors", () => {
  const doc = parseMlxtran(TWO_CMT_ORAL_MLXTRAN);
  const diags = lintMlxtran(doc);
  assert.equal(diags.length, 0);
});

test("MLXTRAN Linter: flags missing [LONGITUDINAL] and undeclared input parameters (M9421, M9422)", () => {
  const invalidModel = `
input = {V, Cl}
EQUATION:
ddt_Ac = ka * Ad - (Cl / V) * Ac
Cc = Ac / V
OUTPUT:
output = {Cc}
`;
  const doc = parseMlxtran(invalidModel);
  const diags = lintMlxtran(doc);

  const codes = diags.map((d) => d.code);
  assert.ok(codes.includes(9421), "Should trigger M9421 for missing [LONGITUDINAL]");
  assert.ok(codes.includes(9422), "Should trigger M9422 for undeclared ka parameter");
});

test("MLXTRAN Linter: flags negative parameter bounds and duplicate equations (M9425, M9426)", () => {
  const badBoundsModel = `
[LONGITUDINAL]
input = {ka = {min = -2.0}, V = {init = -10.0}}
EQUATION:
Cc = 1.0
Cc = 2.0
OUTPUT:
output = {Cc}
`;
  const doc = parseMlxtran(badBoundsModel);
  const diags = lintMlxtran(doc);

  const codes = diags.map((d) => d.code);
  assert.ok(codes.includes(9425), "Should trigger M9425 for negative bound");
  assert.ok(codes.includes(9426), "Should trigger M9426 for duplicate Cc equation");
});

test("MLXTRAN DAE: lowers parameters, states, and ODEs to square DAEBuilder", () => {
  const doc = parseMlxtran(TWO_CMT_ORAL_MLXTRAN);
  const dae = lowerMlxtranToDae(doc, { defaultDose: 100.0 });

  assert.ok(dae.varCount >= 8);
  assert.equal(dae.varCount, dae.eqCount, "DAE must be structurally square");

  assert.notEqual(dae.lookupVariable("ka"), -1);
  assert.notEqual(dae.lookupVariable("V"), -1);
  assert.notEqual(dae.lookupVariable("Cl"), -1);
  assert.notEqual(dae.lookupVariable("Ad"), -1);
  assert.notEqual(dae.lookupVariable("Ac"), -1);
  assert.notEqual(dae.lookupVariable("Ap"), -1);
  assert.notEqual(dae.lookupVariable("Cc"), -1);
});

test("MLXTRAN PK Solver: simulates 2-compartment oral absorption and computes NCA metrics", () => {
  const doc = parseMlxtran(TWO_CMT_ORAL_MLXTRAN);
  const res = solveMlxtranPk(doc, {
    tEnd: 24.0,
    dt: 0.1,
    dose: 100.0,
    params: { ka: 1.2, v: 10.0, cl: 2.0, q: 0.5, v2: 25.0 },
  });

  assert.ok(res.time.length > 200);
  assert.ok(res.cmax > 0.0);
  assert.ok(res.tmax > 0.0);
  assert.ok(res.auc > 0.0);
  assert.ok(res.halfLife > 0.0);

  // Peak concentration should occur after dose administration
  assert.ok(res.tmax >= 0.5 && res.tmax <= 4.0);
  // Half life should be roughly ln(2) / (CL / V) ~ 0.693 / 0.2 ~ 3.46 hours
  assert.ok(res.halfLife > 3.0 && res.halfLife < 4.0);
});

test("MLXTRAN Modelica Projection: generates valid Modelica 3.x continuous model", () => {
  const doc = parseMlxtran(TWO_CMT_ORAL_MLXTRAN);
  const modelica = mlxtranToModelica(doc, "TwoCmtOralModel");

  assert.ok(modelica.includes("model TwoCmtOralModel"));
  assert.ok(modelica.includes("parameter Real ka = 1.0000;"));
  assert.ok(modelica.includes("Real Ad(start = 100.0, fixed = true);"));
  assert.ok(modelica.includes("Real Ac(start = 0.0, fixed = true);"));
  assert.ok(modelica.includes("der(Ad) = -ka * Ad;"));
  assert.ok(modelica.includes("Cc = Ac / V;"));
  assert.ok(modelica.includes("end TwoCmtOralModel;"));
});

test("MLXTRAN LSP: validates diagnostics, document symbols, hover, and action execution", () => {
  const diags = validateMlxtran(TWO_CMT_ORAL_MLXTRAN);
  assert.equal(diags.length, 0);

  const symbols = getMlxtranDocumentSymbols(TWO_CMT_ORAL_MLXTRAN);
  assert.ok(symbols.length > 0);
  assert.equal(symbols[0]!.children!.length, 12); // 5 inputs + 4 equations + 3 macros

  const hoverLongitudinal = getMlxtranHover(TWO_CMT_ORAL_MLXTRAN, { line: 2, character: 2 });
  assert.ok(hoverLongitudinal && hoverLongitudinal.contents.includes("[LONGITUDINAL]"));

  const completions = provideMlxtranCompletions(TWO_CMT_ORAL_MLXTRAN, { line: 0, character: 0 });
  assert.ok(completions.some((c) => c.label === "compartment"));
  assert.ok(completions.some((c) => c.label === "EQUATION:"));

  const actionRes = executeMlxtranAction(TWO_CMT_ORAL_MLXTRAN, "mlxtran_to_dae") as {
    isSquare: boolean;
    variableCount: number;
    equationCount: number;
  };
  assert.equal(actionRes.isSquare, true);
  assert.ok(actionRes.variableCount >= 8);
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser, facade } = await createWasmParser(modelicaWasm);

function getCstDiagnostics(source: string): { code: number; severity: number; message: string }[] {
  const root = facade.parseIncremental(source, 0, 0, source.length, "file:///phase13_cst.mo");
  assert.ok(root > 0, "Expected facade.parseIncremental root");
  return facade.getDiagnostics(root, 0, 0, source);
}

describe("Modelica Phase 13-14 inner/outer, protected parameter, and CFA masking checks", () => {
  it("detects inner/outer causality conflicts across multiple declarations using root/match memoization", () => {
    const diags = getCstDiagnostics(`
model Sub
  outer input Real u1;
  outer input Real u2;
  Real y = u1 + u2;
end Sub;

model Top
  inner output Real u1 = 1.0;
  inner input Real u2 = 2.0;
  Sub s;
end Top;
`);
    const conflicts = diags.filter((d) => d.code === 4126);
    assert.equal(conflicts.length, 1, `Expected 1 M4126 diagnostic (u1), got ${JSON.stringify(conflicts)}`);
  });

  it("flags unused protected parameters in eligible non-partial models with cached class eligibility", () => {
    const diags = getCstDiagnostics(`
model ProtectedParams
  Real x(start = 1.0);
  Real y;
protected
  parameter Real usedP = 2.0;
  parameter Real unusedP1 = 3.0;
  parameter Real unusedP2 = 4.0;
equation
  x = usedP;
  y = x + 1.0;
end ProtectedParams;
`);
    const m4123 = diags.filter((d) => d.code === 4123);
    assert.equal(m4123.length, 2, `Expected 2 M4123 diagnostics (unusedP1, unusedP2), got ${JSON.stringify(m4123)}`);
  });

  it("ignores '=', '(', '[' inside component description strings in CFA output assignment checks (M5020)", async () => {
    Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
    const ctx = Context.createBatch(new NodeFileSystem());
    ctx.load(
      `
function UnassignedWithTrickyDesc
  input Real u;
  output Real y "range [0..1] (default = 0)";
algorithm
  if u > 1.0 then
    y := u;
  end if;
end UnassignedWithTrickyDesc;
`,
      "phase14_cfa_desc.mo",
    );
    const lints = await ctx.queryEngine.runAllLintsAsync();
    const m5020 = lints.filter((d) => d.code === 5020);
    assert.ok(
      m5020.length >= 1,
      `Expected M5020 on unassigned scalar 'y' despite tricky description: ${JSON.stringify(lints)}`,
    );
  });

  it("reconciles CST diagnostics cleanly via shared reconcileModelicaCstDiagnostics and matches synced catalog messages", async () => {
    const { reconcileModelicaCstDiagnostics, allModelicaLints, ModelicaErrorCode } = await import("../src/index.js");

    const filtered = reconcileModelicaCstDiagnostics({
      cstDiags: [
        { code: 4001, message: "extends cycle", severity: 1 },
        { code: 4033, message: "multiple algorithms", severity: 1 },
        { code: 4006, message: "Element X in algorithm", severity: 1 },
        { code: 4038, message: "flow outside connector", severity: 2 },
      ],
      hasArenaResult: true,
      arenaDiags: [],
      isOldFrontend: true,
    });
    assert.deepEqual(
      filtered.map((d) => d.code),
      [4038],
      `Expected only M4038 after Arena + OldFrontend + M4006/M4033 reconciliation, got ${JSON.stringify(filtered)}`,
    );

    const sampleArg: any = { text: "X", asNumber: () => 0 };
    const syncedPairs: [keyof typeof allModelicaLints, keyof typeof ModelicaErrorCode][] = [
      ["identifierMismatch", "IDENTIFIER_MISMATCH"],
      ["flowOutsideConnector", "FLOW_OUTSIDE_CONNECTOR"],
      ["cardinalityInvalidContext", "CARDINALITY_INVALID_CONTEXT"],
      ["breakOutsideLoop", "BREAK_OUTSIDE_LOOP"],
      ["constantNotFixed", "CONSTANT_NOT_FIXED"],
      ["sampleFactorNotPositive", "SAMPLE_FACTOR_NOT_POSITIVE"],
      ["previousOutsideClocked", "PREVIOUS_OUTSIDE_CLOCKED"],
      ["holdInContinuous", "HOLD_IN_CONTINUOUS"],
      ["impureCalledInPure", "IMPURE_CALLED_IN_PURE"],
      ["impureInEquationSection", "IMPURE_IN_EQUATION_SECTION"],
    ];
    for (const [lintKey, errKey] of syncedPairs) {
      const lintMsg = allModelicaLints[lintKey]!.message(sampleArg, sampleArg, sampleArg);
      const errMsg = (ModelicaErrorCode[errKey].message as (a: string) => string)("X");
      assert.equal(lintMsg, errMsg, `Expected catalog message parity for ${String(lintKey)} / ${String(errKey)}`);
    }
  });
});

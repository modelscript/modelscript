// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unit tests for Phase 7 Modelica linter severities, SOTA parity rules, and formal verification:
 * - Severity alignments: M4077 (warning), M4130 (info), M4134 (warning), M4135 (warning)
 * - SOTA parity: M2022 (`encapsulated-lookup-violation`), M5052 (`stateselect-always-not-state`)
 * - On-demand formal verification: M7107 (`formal-array-equation-unbalanced`),
 *   M7604 (`formal-sysml-requirement-unsatisfiable`), M7704 (`formal-dimension-mismatch-inferred`)
 */

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { ModelicaErrorCode } from "../src/errors.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser, facade } = await createWasmParser(modelicaWasm);

function makeContext(source: string, resourceId = "phase7_test.mo"): Context {
  Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
  const ctx = Context.createBatch(new NodeFileSystem());
  ctx.load(source, resourceId);
  return ctx;
}

describe("Modelica Phase 7 severities, SOTA parity, and formal verification", () => {
  it("aligns M4077, M4130, M4134, and M4135 severities in registry and CST lints", () => {
    assert.equal(ModelicaErrorCode.LOOP_TERMINATION_INCONCLUSIVE.severity, "warning");
    assert.equal(ModelicaErrorCode.CLASS_MISSING_DESCRIPTION.severity, "info");
    assert.equal(ModelicaErrorCode.BROKEN_MODELICA_URI.severity, "warning");
    assert.equal(ModelicaErrorCode.RESOURCE_MISSING.severity, "warning");

    const src = `
model NoDesc
  String u = "modelica://";
end NoDesc;
`;
    const root = facade.parseIncremental(src, 0, 0, src.length, "file:///phase7_sev.mo");
    const diags = facade.getDiagnostics(root, 0, 0, src);
    const m4130 = diags.find((d: any) => d.code === 4130);
    const m4134 = diags.find((d: any) => d.code === 4134);
    assert.ok(m4130 && m4130.severity === 3, `Expected M4130 Information (3), got ${JSON.stringify(m4130)}`);
    assert.ok(m4134 && m4134.severity === 2, `Expected M4134 Warning (2), got ${JSON.stringify(m4134)}`);
  });

  it("detects unimported outer references inside encapsulated scopes while allowing imports and global-rooted refs (M2022)", async () => {
    const ctx = makeContext(`
record OuterType
  Real val = 1.0;
end OuterType;

encapsulated package EncapPkg
  model BadChild
    OuterType badRef;
  end BadChild;

  model ImportedChild
    import OuterType;
    OuterType okRef;
  end ImportedChild;

  model GlobalChild
    .OuterType okGlobal;
    Real scalarOk;
  end GlobalChild;
end EncapPkg;
`);
    const diags = await ctx.queryEngine.runAllLintsAsync();
    const m2022 = diags.filter((d: any) => d.code === 2022);
    assert.equal(m2022.length, 1, `Expected 1 M2022 for BadChild, got ${JSON.stringify(m2022)}`);
    assert.ok(String(m2022[0]!.message).includes("OuterType"));
  });

  it("warns on algebraic variables annotated stateSelect = StateSelect.always (M5052)", async () => {
    const ctx = makeContext(`
model AlgebraicStateSelect
  Real x(stateSelect = StateSelect.always);
  Real y(start = 1.0, stateSelect = StateSelect.always);
equation
  x = 2.0 * y;
  der(y) = -y;
end AlgebraicStateSelect;
`);
    const res = await ctx.verifyFormal({ classNames: ["AlgebraicStateSelect"] });
    const m5052 = res.diagnostics.filter((d) => d.code === 5052);
    assert.equal(m5052.length, 1, `Expected M5052 for non-state 'x': ${JSON.stringify(res.diagnostics)}`);
    assert.ok(String(m5052[0]!.message).includes("'x'"));
  });

  it("detects unbalanced array equation coverage on demand (M7107) and passes balanced arrays", async () => {
    const ctx = makeContext(`
model UnbalancedArray
  Real x[3];
equation
  x[1] = 1.0;
  x[2] = 2.0;
end UnbalancedArray;

model BalancedArray
  Real x[3];
equation
  x[1] = 1.0;
  x[2] = 2.0;
  x[3] = 3.0;
end BalancedArray;
`);
    const defaultLints = await ctx.queryEngine.runAllLintsAsync();
    assert.equal(defaultLints.filter((d: any) => d.code >= 7000).length, 0);

    const res = await ctx.verifyFormal({ classNames: ["UnbalancedArray", "BalancedArray"] });
    const bad = res.diagnostics.filter((d) => d.code === 7107 && d.className === "UnbalancedArray");
    const good = res.diagnostics.filter((d) => d.code === 7107 && d.className === "BalancedArray");
    assert.equal(bad.length, 1, `Expected M7107 for UnbalancedArray: ${JSON.stringify(res.diagnostics)}`);
    assert.equal(good.length, 0, `Did not expect M7107 for BalancedArray: ${JSON.stringify(good)}`);
  });

  it("detects unsatisfiable SysML requirement constraints against model bounds on demand (M7604)", async () => {
    const ctx = makeContext(`
model ReactorHot
  parameter Real T(min = 400.0, max = 500.0) = 450.0;
equation
end ReactorHot;

model ReactorSafe
  parameter Real T(min = 300.0, max = 340.0) = 320.0;
equation
end ReactorSafe;
`);
    // Register two SysML v2 requirements in the workspace SymbolIndex
    ctx.queryEngine.index.symbols.set(910001, {
      id: 910001,
      name: "HotReactorTempLimit",
      kind: "Requirement",
      ruleName: "requirement_def",
      language: "sysml2",
      resourceId: "reqs.sysml",
      parentId: null,
      startOffset: 0,
      endOffset: 20,
      metadata: {
        subjectName: "ReactorHot",
        targetAttribute: "T",
        operator: "<=",
        limitValue: 350.0,
      },
    } as any);
    ctx.queryEngine.index.symbols.set(910002, {
      id: 910002,
      name: "SafeReactorTempLimit",
      kind: "Requirement",
      ruleName: "requirement_def",
      language: "sysml2",
      resourceId: "reqs.sysml",
      parentId: null,
      startOffset: 25,
      endOffset: 45,
      metadata: {
        subjectName: "ReactorSafe",
        constraint: "T <= 350",
      },
    } as any);

    const res = await ctx.verifyFormal({ classNames: ["ReactorHot", "ReactorSafe"] });
    const bad = res.diagnostics.filter((d) => d.code === 7604 && d.className === "ReactorHot");
    const good = res.diagnostics.filter((d) => d.code === 7604 && d.className === "ReactorSafe");
    assert.equal(bad.length, 1, `Expected M7604 for ReactorHot: ${JSON.stringify(res.diagnostics)}`);
    assert.equal(good.length, 0, `Did not expect M7604 for ReactorSafe: ${JSON.stringify(good)}`);
  });

  it("infers and detects physical dimension mismatches on demand (M7704) while passing consistent physics", async () => {
    const ctx = makeContext(`
model DimBad
  input Real d(unit = "m");
  input Real t(unit = "s");
  Real v(unit = "m/s");
equation
  v = d * t;
end DimBad;

model DimOk
  input Real d(unit = "m");
  input Real t(unit = "s");
  Real v(unit = "m/s");
equation
  v = d / t;
end DimOk;
`);
    const res = await ctx.verifyFormal({ classNames: ["DimBad", "DimOk"] });
    const bad = res.diagnostics.filter((d) => d.code === 7704 && d.className === "DimBad");
    const good = res.diagnostics.filter((d) => d.code === 7704 && d.className === "DimOk");
    assert.equal(bad.length, 1, `Expected M7704 for DimBad: ${JSON.stringify(res.diagnostics)}`);
    assert.equal(good.length, 0, `Did not expect M7704 for DimOk: ${JSON.stringify(good)}`);
  });
});

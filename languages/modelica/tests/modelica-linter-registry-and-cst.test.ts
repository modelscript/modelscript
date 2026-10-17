// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import path from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { Context } from "../src/context.js";
import { ModelicaErrorCode, allModelicaLints, getModelicaErrorCodeDef } from "../src/index.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Modelica Linter Error Code Registry & WASM CST Scope Lints", () => {
  let parser: any;
  let facade: any;

  before(async () => {
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    const res = await createWasmParser(wasmPath);
    parser = res.parser;
    facade = res.facade;
    Context.registerParser(".mo", parser as any);
  });

  function getCstDiagnostics(source: string): { code: number; severity: number; message: string }[] {
    const root = facade.parseIncremental(source, 0, 0, source.length, "file:///test.mo");
    assert.ok(root > 0, "Expected facade.parseIncremental to return a valid root");
    return facade.getDiagnostics(root, 0, 0, source);
  }

  describe("1. ModelicaErrorCode Registry Integrity", () => {
    it("assigns a unique numeric code to every entry in ModelicaErrorCode (0 collisions)", () => {
      const seen = new Map<number, string>();
      const collisions: string[] = [];

      for (const [key, def] of Object.entries(ModelicaErrorCode)) {
        const existing = seen.get(def.code);
        if (existing) {
          collisions.push(`${key} and ${existing} share code ${def.code}`);
        } else {
          seen.set(def.code, key);
        }
      }

      assert.deepEqual(collisions, []);
    });

    it("resolves every ModelicaErrorCode entry 1-to-1 via getModelicaErrorCodeDef(code)", () => {
      for (const [key, def] of Object.entries(ModelicaErrorCode)) {
        const resolved = getModelicaErrorCodeDef(def.code);
        assert.ok(resolved, `Expected code ${def.code} (${key}) to resolve`);
        assert.equal(resolved.code, def.code);
        assert.equal(resolved.rule, def.rule);
      }
    });

    it("registers every CST CompilerLint numeric code in ModelicaErrorCode", () => {
      for (const [lintKey, lintRule] of Object.entries(allModelicaLints)) {
        if (lintRule.code !== undefined) {
          const resolved = getModelicaErrorCodeDef(lintRule.code);
          assert.ok(resolved, `CST lint '${lintKey}' uses unregistered numeric code ${lintRule.code}`);
        }
      }
    });
  });

  describe("2. Salsa Query Modifier Diagnostics (M2006 / M2007)", () => {
    it("attaches numeric code 2006 / 2007 to checkModifierNotFound diagnostics", async () => {
      const ctx = new Context(new NodeFileSystem());
      const code = `
model Base
  Real x;
end Base;

model Test1 = Base(nonExistent = 1.0);
model Test2 = Base(redeclare Real nonExistent);
`;
      const uri = "file:///test/ModifierNotFound.mo";
      ctx.load(code, uri);
      const diags = await ctx.queryEngine.runAllLintsAsync(uri);
      const classDiag = diags.find((d: any) => d.message.includes("class or component nonExistent not found"));
      assert.ok(classDiag, `Expected M2007 diagnostic in ${JSON.stringify(diags)}`);
      assert.equal(classDiag.code, ModelicaErrorCode.MODIFIER_CLASS_NOT_FOUND.code);

      const elemDiag = diags.find((d: any) => d.message.includes("Modified element nonExistent not found"));
      assert.ok(elemDiag, `Expected M2006 diagnostic in ${JSON.stringify(diags)}`);
      assert.equal(elemDiag.code, ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.code);
    });
  });

  describe("3. WASM CST Structural & Scope Lints", () => {
    it("detects extends cycles in the same scope (M4001)", () => {
      const diags = getCstDiagnostics(`
package P
  model A
    extends B;
  end A;
  model B
    extends A;
  end B;
end P;
`);
      assert.ok(
        diags.some((d) => d.code === ModelicaErrorCode.EXTENDS_CYCLE.code),
        `Expected M4001 in ${JSON.stringify(diags)}`,
      );
    });

    it("detects extending a replaceable base class (M4034)", () => {
      const diags = getCstDiagnostics(`
model M
  replaceable model Base
    Real x;
  end Base;
  model Sub
    extends Base;
  end Sub;
end M;
`);
      assert.ok(
        diags.some((d) => d.code === ModelicaErrorCode.REPLACEABLE_BASE_CLASS.code),
        `Expected M4034 in ${JSON.stringify(diags)}`,
      );
    });

    it("detects non-replaceable component of a partial class in a non-partial model (M4028)", () => {
      const diags = getCstDiagnostics(`
package P
  partial model PartialBase
    Real x;
  end PartialBase;
  model Concrete
    PartialBase b;
  end Concrete;
end P;
`);
      assert.ok(
        diags.some((d) => d.code === ModelicaErrorCode.PARTIAL_TYPE_COMPONENT.code),
        `Expected M4028 in ${JSON.stringify(diags)}`,
      );
    });

    it("detects cardinality() called with a class name instead of a component (M4048)", () => {
      const diags = getCstDiagnostics(`
model M
  connector C
    Real v;
    flow Real i;
  end C;
  Boolean b = cardinality(C) == 0;
end M;
`);
      assert.ok(
        diags.some((d) => d.code === ModelicaErrorCode.CARDINALITY_EXPECTED_COMPONENT.code),
        `Expected M4048 in ${JSON.stringify(diags)}`,
      );
    });

    it("detects enumeration step ranges start:step:stop (M4022)", () => {
      const diags = getCstDiagnostics(`
model M
  type Color = enumeration(red, green, blue);
  Color c[2] = {Color.red : Color.green : Color.blue};
end M;
`);
      assert.ok(
        diags.some((d) => d.code === ModelicaErrorCode.ENUM_RANGE_WITH_STEP.code),
        `Expected M4022 in ${JSON.stringify(diags)}`,
      );
    });

    it("detects scalar modifier without 'each' on an array component (M4044)", () => {
      const diags = getCstDiagnostics(`
model M
  Real x[3](start = 1.0);
end M;
`);
      assert.ok(
        diags.some((d) => d.code === ModelicaErrorCode.NON_ARRAY_MODIFICATION.code),
        `Expected M4044 in ${JSON.stringify(diags)}`,
      );
    });

    it("detects discrete variable assigned continuous time expression outside when (M4039)", () => {
      const diags = getCstDiagnostics(`
model M
  discrete Real d;
equation
  d = time;
end M;
`);
      assert.ok(
        diags.some((d) => d.code === ModelicaErrorCode.DISCRETE_NOT_ON_LHS.code),
        `Expected M4039 in ${JSON.stringify(diags)}`,
      );
    });

    it("warns on missing inner declaration for an outer component in a self-contained model (M2094)", () => {
      const diags = getCstDiagnostics(`
model M
  outer Real envTemp;
  Real y;
equation
  y = envTemp;
end M;
`);
      assert.ok(
        diags.some((d) => d.code === ModelicaErrorCode.MISSING_INNER.code),
        `Expected M2094 in ${JSON.stringify(diags)}`,
      );
    });

    it("detects mixed clock domain operators in binary expression (M6001)", () => {
      const diags = getCstDiagnostics(`
model M
  Real x(start = 0.0);
  Real y;
equation
  der(x) = 1.0;
  y = sample(x, Clock(0.1)) + previous(x);
end M;
`);
      assert.ok(
        diags.some((d) => d.code === ModelicaErrorCode.MIXED_CLOCK_DOMAINS.code),
        `Expected M6001 in ${JSON.stringify(diags)}`,
      );
    });

    it("detects non-positive factor in subSample / superSample (M6002)", () => {
      const diags = getCstDiagnostics(`
model M
  Real u;
  Real y;
equation
  y = subSample(u, 0);
end M;
`);
      assert.ok(
        diags.some((d) => d.code === ModelicaErrorCode.SAMPLE_FACTOR_NOT_POSITIVE.code),
        `Expected M6002 in ${JSON.stringify(diags)}`,
      );
    });

    it("detects previous() applied to a non-clocked parameter/constant (M6003)", () => {
      const diags = getCstDiagnostics(`
model M
  parameter Real p = 2.0;
  Real y;
equation
  y = previous(p);
end M;
`);
      assert.ok(
        diags.some((d) => d.code === ModelicaErrorCode.PREVIOUS_OUTSIDE_CLOCKED.code),
        `Expected M6003 in ${JSON.stringify(diags)}`,
      );
    });

    it("detects hold() inside continuous der() operator (M6004)", () => {
      const diags = getCstDiagnostics(`
model M
  Real x;
  Real y;
equation
  y = der(hold(x));
end M;
`);
      assert.ok(
        diags.some((d) => d.code === ModelicaErrorCode.HOLD_IN_CONTINUOUS.code),
        `Expected M6004 in ${JSON.stringify(diags)}`,
      );
    });

    it("detects duplicate initialState() calls in the same state machine scope (M6010)", () => {
      const diags = getCstDiagnostics(`
model M
  Real s1;
  Real s2;
equation
  initialState(s1);
  initialState(s2);
end M;
`);
      assert.ok(
        diags.some((d) => d.code === ModelicaErrorCode.DUPLICATE_INITIAL_STATE.code),
        `Expected M6010 in ${JSON.stringify(diags)}`,
      );
    });

    it("detects impure function called inside a pure function (M6020)", () => {
      const diags = getCstDiagnostics(`
package P
  impure function sideEffect
    input Real x;
    output Real y;
  algorithm
    y := x;
  end sideEffect;

  pure function compute
    input Real x;
    output Real y;
  algorithm
    y := sideEffect(x);
  end compute;
end P;
`);
      assert.ok(
        diags.some((d) => d.code === ModelicaErrorCode.IMPURE_CALLED_IN_PURE.code),
        `Expected M6020 in ${JSON.stringify(diags)}`,
      );
    });

    it("detects impure function called inside a continuous equation outside when (M6021)", () => {
      const diags = getCstDiagnostics(`
package P
  impure function sideEffect
    input Real x;
    output Real y;
  algorithm
    y := x;
  end sideEffect;

  model M
    Real y;
  equation
    y = sideEffect(1.0);
  end M;
end P;
`);
      assert.ok(
        diags.some((d) => d.code === ModelicaErrorCode.IMPURE_IN_EQUATION_SECTION.code),
        `Expected M6021 in ${JSON.stringify(diags)}`,
      );
    });
  });
});

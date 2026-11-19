// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unit tests for Phase 9 Modelica parity, LSP error catalog registration, and final 7xxx formal checks:
 * - M2023 (`within-mismatch`): `within` clause vs `package.mo` directory hierarchy and `package.order`
 * - I8: Registration of LSP safety/verification codes (`M5101`, `M5102`, `M5103`, `S5020`, `S5021`) in `errors.ts`
 * - M7404 (`formal-sliding-mode-chattering`): IntervalNewtonRootFinder sliding-surface chattering detection
 * - M7502 (`formal-clocked-invariant-proven`): InductiveProver inductive invariant certification
 * - M7505 (`formal-function-nondeterministic`): RelationalVerifier self-composition monotonicity & Lipschitz checks
 */

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { getModelicaErrorCodeDef, ModelicaErrorCode } from "../src/errors.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser } = await createWasmParser(modelicaWasm);

function createContext(): Context {
  Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
  return Context.createBatch(new NodeFileSystem());
}

describe("Modelica Phase 9 within/order parity, LSP registry codes, and M7404/M7502/M7505", () => {
  it("flags mismatched within clauses against enclosing package.mo hierarchy and package.order omissions (M2023)", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "msx_m2023_"));
    const pkgDir = path.join(tmpRoot, "MyLib");
    fs.mkdirSync(pkgDir, { recursive: true });
    try {
      const pkgMo = path.join(pkgDir, "package.mo");
      const goodMo = path.join(pkgDir, "GoodComp.mo");
      const badMo = path.join(pkgDir, "BadComp.mo");
      const unlistedMo = path.join(pkgDir, "UnlistedComp.mo");
      fs.writeFileSync(path.join(pkgDir, "package.order"), "GoodComp\nBadComp\n", "utf8");

      const ctx = createContext();
      ctx.load(
        `
package MyLib "Root library"
end MyLib;
`,
        pkgMo,
      );
      ctx.load(
        `within MyLib;
model GoodComp "Listed component with matching within"
  Real x = 1.0;
end GoodComp;
`,
        goodMo,
      );
      ctx.load(
        `within WrongLib;
model BadComp "Wrong within header"
  Real x = 2.0;
end BadComp;
`,
        badMo,
      );
      ctx.load(
        `within MyLib;
model UnlistedComp "Missing from package.order"
  Real x = 3.0;
end UnlistedComp;
`,
        unlistedMo,
      );

      const lints = await ctx.queryEngine.runAllLintsAsync();
      const m2023 = lints.filter((d) => d.code === 2023);
      assert.equal(
        m2023.some((d) => d.message.includes("GoodComp.mo")),
        false,
        `Did not expect M2023 for GoodComp.mo: ${JSON.stringify(m2023)}`,
      );
      assert.ok(
        m2023.some((d) => d.message.includes("BadComp.mo") && d.message.includes("WrongLib")),
        `Expected M2023 for BadComp.mo: ${JSON.stringify(m2023)}`,
      );
      assert.ok(
        m2023.some((d) => d.message.includes("UnlistedComp.mo") && d.message.includes("package.order")),
        `Expected M2023 for UnlistedComp missing from package.order: ${JSON.stringify(m2023)}`,
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("registers LSP verification and standard compliance codes in ModelicaErrorCode (I8)", () => {
    assert.equal(getModelicaErrorCodeDef("M5101")?.code, ModelicaErrorCode.LSP_FORMAL_ALGORITHM_PROOF.code);
    assert.equal(getModelicaErrorCodeDef("M5102")?.code, ModelicaErrorCode.LSP_SYSML_CONSTRAINT_VIOLATION.code);
    assert.equal(getModelicaErrorCodeDef("M5103")?.code, ModelicaErrorCode.LSP_DAE_INVARIANT_WARNING.code);
    assert.equal(getModelicaErrorCodeDef("S5020")?.code, ModelicaErrorCode.LSP_STANDARD_COMPLIANCE_VIOLATION.code);
    assert.equal(getModelicaErrorCodeDef("S5021")?.code, ModelicaErrorCode.LSP_STANDARD_COMPLIANCE_WARNING.code);
  });

  it("detects attractive sliding-mode chattering surfaces via IntervalNewtonRootFinder on demand (M7404)", async () => {
    const ctx = createContext();
    ctx.load(
      `
model SlidingPlant
  Real x(start = 0.2);
equation
  der(x) = if x >= 0 then -1.0 else 1.0;
end SlidingPlant;

model RepulsiveSwitch
  Real x(start = 0.2);
equation
  der(x) = if x >= 0 then 1.0 else -1.0;
end RepulsiveSwitch;
`,
      "phase9_m7404.mo",
    );
    const res = await ctx.verifyFormal({ classNames: ["SlidingPlant", "RepulsiveSwitch"] });
    const bad = res.diagnostics.filter((d) => d.code === 7404 && d.className === "SlidingPlant");
    const ok = res.diagnostics.filter((d) => d.code === 7404 && d.className === "RepulsiveSwitch");
    assert.equal(bad.length, 1, `Expected M7404 for SlidingPlant: ${JSON.stringify(res.diagnostics)}`);
    assert.equal(bad[0]!.severity, "warning");
    assert.equal(ok.length, 0, `Did not expect M7404 for RepulsiveSwitch: ${JSON.stringify(ok)}`);
  });

  it("certifies discrete inductive invariants on clocked when systems via InductiveProver on demand (M7502)", async () => {
    const ctx = createContext();
    ctx.load(
      `
model SafeUpCounter
  Integer c(start = 0);
equation
  when sample(0, 1) then
    c = pre(c) + 1;
  end when;
  annotation(__ModelScript_invariant = "c >= 0");
end SafeUpCounter;

model UnsafeDownCounter
  Integer c(start = 0);
equation
  when sample(0, 1) then
    c = pre(c) - 1;
  end when;
  annotation(__ModelScript_invariant = "c >= 0");
end UnsafeDownCounter;
`,
      "phase9_m7502.mo",
    );
    const res = await ctx.verifyFormal({ classNames: ["SafeUpCounter", "UnsafeDownCounter"] });
    const proven = res.diagnostics.filter((d) => d.code === 7502 && d.className === "SafeUpCounter");
    const disproven = res.diagnostics.filter((d) => d.code === 7502 && d.className === "UnsafeDownCounter");
    assert.equal(proven.length, 1, `Expected M7502 info for SafeUpCounter: ${JSON.stringify(res.diagnostics)}`);
    assert.equal(proven[0]!.severity, "info");
    assert.equal(disproven.length, 0, `Did not expect M7502 for UnsafeDownCounter: ${JSON.stringify(disproven)}`);
  });

  it("verifies monotonicity and Lipschitz relational function properties via RelationalVerifier on demand (M7505)", async () => {
    const ctx = createContext();
    ctx.load(
      `
function NonMonotoneGain
  input Real x(min = 0.0, max = 5.0);
  output Real y;
algorithm
  y := -2.0 * x;
  annotation(__ModelScript_monotone = "x -> y");
end NonMonotoneGain;

function MonotoneGain
  input Real x(min = 0.0, max = 5.0);
  output Real y;
algorithm
  y := 2.0 * x + 1.0;
  annotation(__ModelScript_monotone = "x -> y");
end MonotoneGain;

function SteepGain
  input Real x(min = 0.0, max = 5.0);
  output Real y;
algorithm
  y := 3.0 * x;
  annotation(__ModelScript_lipschitz = "x -> y <= 1.0");
end SteepGain;
`,
      "phase9_m7505.mo",
    );
    const res = await ctx.verifyFormal({ classNames: ["NonMonotoneGain", "MonotoneGain", "SteepGain"] });
    const badMono = res.diagnostics.filter((d) => d.code === 7505 && d.className === "NonMonotoneGain");
    const okMono = res.diagnostics.filter((d) => d.code === 7505 && d.className === "MonotoneGain");
    const badLip = res.diagnostics.filter((d) => d.code === 7505 && d.className === "SteepGain");
    assert.equal(badMono.length, 1, `Expected M7505 for NonMonotoneGain: ${JSON.stringify(res.diagnostics)}`);
    assert.equal(okMono.length, 0, `Did not expect M7505 for MonotoneGain: ${JSON.stringify(okMono)}`);
    assert.equal(
      badLip.length,
      1,
      `Expected M7505 Lipschitz violation for SteepGain: ${JSON.stringify(res.diagnostics)}`,
    );
  });
});

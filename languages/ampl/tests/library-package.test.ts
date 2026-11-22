// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AMPL_MODEL_SPECS,
  createFmuAmplInstance,
  fmuToAmplModel,
  getAmplSchemasFromLibraries,
  instantiateAmplWasmModel,
  lookupAmplModelSchema,
  registerBuiltInAmplLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/ampl-std-lib");

describe("@modelscript/ampl — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/ampl-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected ampl-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/ampl-std-lib");
    assert.equal(pkg.manifest.language, "ampl");
    assert.equal(pkg.symbols.length, AMPL_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, AMPL_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & provenance metadata on every registered function
    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected cleanroom SVG icon for ${diag.namePath}`);
      assert.ok(diag.ports.length > 0, `Expected diagram ports for ${diag.namePath}`);
    }
    for (const sym of pkg.symbols) {
      const prov = (sym.metadata as Record<string, unknown> | undefined)?.["provenance"];
      assert.ok(typeof prov === "string" && prov.length > 5, `Expected public provenance citation for ${sym.namePath}`);
    }
  });

  it("supports zero-I/O sync registration and case-insensitive alias lookup", () => {
    registerBuiltInAmplLibrarySync();
    const schemas = getAmplSchemasFromLibraries();
    assert.ok(schemas.length >= AMPL_MODEL_SPECS.length);

    assert.equal(lookupAmplModelSchema("abs")?.name, "ampl_abs");
    assert.equal(lookupAmplModelSchema("Normal")?.name, "ampl_Normal");
    assert.equal(lookupAmplModelSchema("GAMMA")?.name, "ampl_Gamma");
    assert.equal(lookupAmplModelSchema("pwl")?.name, "ampl_pwl");
    assert.equal(lookupAmplModelSchema("less")?.name, "ampl_less");
    assert.equal(lookupAmplModelSchema("round")?.name, "ampl_round");
    assert.equal(lookupAmplModelSchema("precision")?.name, "ampl_precision");
  });

  it("evaluates ampl_pwl, ampl_less, ampl_Normal, ampl_Gamma, and ampl_round in runtime.wasm", () => {
    // 1. Continuous piecewise-linear <<10, 20; 1, 2, 5>> x anchored at f(0) = 0
    const pwl = instantiateAmplWasmModel({ modelType: "ampl_pwl", params: [10, 20, 1, 2, 5] });
    assert.ok(pwl, "Expected ampl_pwl WASM instance");
    pwl.init();
    assert.ok(Math.abs(pwl.eval({ x0: 0 }).result - 0) < 1e-12);
    const pwl5 = pwl.eval({ x0: 5 });
    assert.ok(Math.abs(pwl5.result - 5) < 1e-12, `Expected pwl(5)=5, got ${pwl5.result}`);
    assert.equal(pwl5.aux1, 1);
    const pwl15 = pwl.eval({ x0: 15 });
    assert.ok(Math.abs(pwl15.result - 20) < 1e-12, `Expected pwl(15)=20, got ${pwl15.result}`);
    assert.equal(pwl15.aux1, 2);
    const pwl25 = pwl.eval({ x0: 25 });
    assert.ok(Math.abs(pwl25.result - 55) < 1e-12, `Expected pwl(25)=55, got ${pwl25.result}`);
    assert.equal(pwl25.aux1, 5);

    // 2. less(a, b) = max(a - b, 0)
    const lessFn = instantiateAmplWasmModel({ modelType: "ampl_less" });
    assert.ok(lessFn, "Expected ampl_less WASM instance");
    lessFn.init();
    assert.equal(lessFn.eval({ x0: 10, x1: 3 }).result, 7);
    assert.equal(lessFn.eval({ x0: 3, x1: 10 }).result, 0);

    // 3. Standard Normal(0, 1) PDF & CDF
    const norm = instantiateAmplWasmModel({ modelType: "ampl_Normal", params: [0, 1] });
    assert.ok(norm, "Expected ampl_Normal WASM instance");
    norm.init();
    const norm0 = norm.eval({ x0: 0 });
    const expectedPdf0 = 1 / Math.sqrt(2 * Math.PI);
    assert.ok(
      Math.abs(norm0.result - expectedPdf0) < 1e-12,
      `Expected N(0,1) PDF(0) ~ ${expectedPdf0}, got ${norm0.result}`,
    );
    assert.ok(Math.abs(norm0.aux1 - 0.5) < 1e-6, `Expected N(0,1) CDF(0) ~ 0.5, got ${norm0.aux1}`);
    const norm196 = norm.eval({ x0: 1.95996398454 });
    assert.ok(Math.abs(norm196.aux1 - 0.975) < 1e-5, `Expected N(0,1) CDF(1.96) ~ 0.975, got ${norm196.aux1}`);

    // 4. Lanczos Gamma function
    const gammaFn = instantiateAmplWasmModel({ modelType: "ampl_Gamma" });
    assert.ok(gammaFn, "Expected ampl_Gamma WASM instance");
    gammaFn.init();
    const g5 = gammaFn.eval({ x0: 5 });
    assert.ok(Math.abs(g5.result - 24) < 1e-10, `Expected Gamma(5)=24, got ${g5.result}`);
    const gHalf = gammaFn.eval({ x0: 0.5 });
    assert.ok(Math.abs(gHalf.result - Math.sqrt(Math.PI)) < 1e-10, `Expected Gamma(0.5)=sqrt(pi), got ${gHalf.result}`);
    assert.ok(Math.abs(g5.aux1 - Math.log(24)) < 1e-10, `Expected ln(Gamma(5))=ln(24), got ${g5.aux1}`);

    // 5. ampl_round & ampl_precision
    const roundFn = instantiateAmplWasmModel({ modelType: "ampl_round" });
    assert.ok(roundFn, "Expected ampl_round WASM instance");
    roundFn.init();
    assert.ok(Math.abs(roundFn.eval({ x0: 3.14159, x1: 2 }).result - 3.14) < 1e-12);
    assert.ok(Math.abs(roundFn.eval({ x0: 123.456, x1: -1 }).result - 120) < 1e-12);

    const precFn = instantiateAmplWasmModel({ modelType: "ampl_precision" });
    assert.ok(precFn, "Expected ampl_precision WASM instance");
    precFn.init();
    assert.ok(Math.abs(precFn.eval({ x0: 123.456, x1: 4 }).result - 123.5) < 1e-12);
  });

  it("projects and links an FMI 2.0/3.0 external FMU into AMPL declarations", () => {
    const proj = fmuToAmplModel(
      {
        modelName: "VendorCostOracleFmu",
        variables: [
          { name: "margin", causality: "parameter", type: "Real", valueReference: 1, start: 1.15 },
          { name: "flow", causality: "input", type: "Real", valueReference: 2, start: 10.0 },
          { name: "cost", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      "plant1",
    );
    assert.ok(proj.amplDeclaration.includes("function VendorCostOracleFmu;"));
    assert.ok(proj.amplDeclaration.includes("param plant1_margin := 1.15;"));
    assert.ok(proj.amplDeclaration.includes("subject to plant1_fmu_link:"));

    const fmuInst = createFmuAmplInstance("plant1", proj.modelName, (io) => ({
      result: 1.15 * io.x0 * io.x0,
      deriv: 2.3 * io.x0,
    }));
    const out = fmuInst.eval({ x0: 10 });
    assert.ok(Math.abs(out.result - 115) < 1e-9);
    assert.ok(Math.abs(out.deriv - 23) < 1e-9);
  });

  it("evaluates 5-breakpoint arbitrary AMPL <<b_1,...,b_5; s_0,...,s_5>> x PWL continuity and exact subgradients", () => {
    // <<-10, 0, 5, 15, 30; -2, 1, 3, 2, 4, 6>> x anchored at f(0) = 0
    const breakpoints = [-10, 0, 5, 15, 30];
    const slopes = [-2, 1, 3, 2, 4, 6];
    const pwl5 = instantiateAmplWasmModel({
      modelType: "ampl_pwl",
      pwl: { breakpoints, slopes },
    });
    assert.ok(pwl5, "Expected 5-breakpoint ampl_pwl WASM instance");
    pwl5.init();

    // Exact anchor f(0) = 0 and breakpoint subgradient at x = 0: left=1, right=3, midpoint=2
    const at0 = pwl5.eval({ x0: 0 });
    assert.ok(Math.abs(at0.result - 0.0) < 1e-12);
    assert.equal(at0.aux2, 1);
    assert.equal(at0.aux1, 3);
    assert.equal(at0.deriv, 2);

    // Segment checks:
    // x = -15: f(-10) = -10*1 = -10; f(-15) = -10 + (-2)*(-5) = 0
    const atNeg15 = pwl5.eval({ x0: -15 });
    assert.ok(Math.abs(atNeg15.result - 0.0) < 1e-12, `Expected f(-15)=0, got ${atNeg15.result}`);
    assert.equal(atNeg15.deriv, -2);

    // x = -5: f(-5) = 1*(-5) = -5
    const atNeg5 = pwl5.eval({ x0: -5 });
    assert.ok(Math.abs(atNeg5.result - -5.0) < 1e-12, `Expected f(-5)=-5, got ${atNeg5.result}`);
    assert.equal(atNeg5.deriv, 1);

    // x = 10: f(5)=15, f(10)=15 + 2*5 = 25
    const at10 = pwl5.eval({ x0: 10 });
    assert.ok(Math.abs(at10.result - 25.0) < 1e-12, `Expected f(10)=25, got ${at10.result}`);
    assert.equal(at10.deriv, 2);

    // x = 35: f(15)=35, f(30)=35 + 4*15 = 95, f(35)=95 + 6*5 = 125
    const at35 = pwl5.eval({ x0: 35 });
    assert.ok(Math.abs(at35.result - 125.0) < 1e-12, `Expected f(35)=125, got ${at35.result}`);
    assert.equal(at35.deriv, 6);

    // Verify continuity at every breakpoint b_i
    for (const bp of breakpoints) {
      const fLeft = pwl5.eval({ x0: bp - 1e-8 }).result;
      const fMid = pwl5.eval({ x0: bp }).result;
      const fRight = pwl5.eval({ x0: bp + 1e-8 }).result;
      assert.ok(Math.abs(fLeft - fMid) < 1e-6, `Expected left continuity at bp=${bp}`);
      assert.ok(Math.abs(fRight - fMid) < 1e-6, `Expected right continuity at bp=${bp}`);
    }

    // Also verify 1-breakpoint (k=1, params.length=3) without default-parameter padding
    const pwl1 = instantiateAmplWasmModel({ modelType: "ampl_pwl", params: [10, 1, 4] });
    assert.ok(pwl1);
    pwl1.init();
    assert.ok(Math.abs(pwl1.eval({ x0: 15 }).result - 30.0) < 1e-12);
    assert.equal(pwl1.eval({ x0: 15 }).deriv, 4);
  });
});

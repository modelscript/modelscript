// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ADAMS_MODEL_SPECS,
  createFmuAdamsInstance,
  fmuToAdamsGse,
  getAdamsSchemasFromLibraries,
  instantiateAdamsWasmModel,
  lookupAdamsModelSchema,
  registerBuiltInAdamsLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/adams-std-lib");

describe("@modelscript/adams — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/adams-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected adams-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/adams-std-lib");
    assert.equal(pkg.manifest.language, "adams");
    assert.equal(pkg.symbols.length, ADAMS_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, ADAMS_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons, ports & provenance metadata on every registered element
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
    registerBuiltInAdamsLibrarySync();
    const schemas = getAdamsSchemasFromLibraries();
    assert.ok(schemas.length >= ADAMS_MODEL_SPECS.length);

    assert.equal(lookupAdamsModelSchema("step")?.name, "STEP");
    assert.equal(lookupAdamsModelSchema("step5")?.name, "STEP5");
    assert.equal(lookupAdamsModelSchema("springdamper")?.name, "SPRING_DAMPER");
    assert.equal(lookupAdamsModelSchema("PAC2002")?.name, "PAC2002_TIRE");
    assert.equal(lookupAdamsModelSchema("hinge")?.name, "REVOLUTE");
    assert.equal(lookupAdamsModelSchema("ptcv")?.name, "POINT_CURVE");
  });

  it("evaluates STEP, STEP5, IMPACT, BISTOP, SPRING_DAMPER, BUSHING, and PAC2002_TIRE in runtime.wasm", () => {
    // 1. STEP(x, 0, 10, 2, 30): smooth cubic Hermite transition
    const stepFn = instantiateAdamsWasmModel({ modelType: "STEP", params: { x0: 0, h0: 10, x1: 2, h1: 30 } });
    assert.ok(stepFn, "Expected STEP WASM instance");
    stepFn.init();
    assert.equal(stepFn.evaluate({ x: -0.5 }).value, 10);
    assert.equal(stepFn.evaluate({ x: 2.5 }).value, 30);
    assert.ok(Math.abs(stepFn.evaluate({ x: 1.0 }).value - 20.0) < 1e-12, "STEP midpoint should be 20");
    // At x = 0.5 => u = 0.25 => 10 + 20 * 0.25^2 * (3 - 0.5) = 10 + 3.125 = 13.125
    assert.ok(Math.abs(stepFn.evaluate({ x: 0.5 }).value - 13.125) < 1e-12);

    // 2. STEP5(x, 0, 0, 1, 100): smooth C2 quintic transition
    const step5Fn = instantiateAdamsWasmModel({ modelType: "STEP5", params: { x0: 0, h0: 0, x1: 1, h1: 100 } });
    assert.ok(step5Fn, "Expected STEP5 WASM instance");
    step5Fn.init();
    assert.equal(step5Fn.evaluate({ x: 0.0 }).value, 0);
    assert.equal(step5Fn.evaluate({ x: 1.0 }).value, 100);
    assert.ok(Math.abs(step5Fn.evaluate({ x: 0.5 }).value - 50.0) < 1e-12, "STEP5 midpoint should be 50");
    // At u = 0.25 => 100 * 0.25^3 * (10 - 15*0.25 + 6*0.0625) = 100 * (1/64) * 6.625 = 10.3515625
    assert.ok(Math.abs(step5Fn.evaluate({ x: 0.25 }).value - 10.3515625) < 1e-12);

    // 3. IMPACT(x, xdot, x1=0.0, k=1e5, e=1.5, cmax=200, d=0.002)
    const impact = instantiateAdamsWasmModel({
      modelType: "IMPACT",
      params: { x1: 0.0, k: 1.0e5, e: 1.5, cmax: 200.0, d: 0.002 },
    });
    assert.ok(impact, "Expected IMPACT WASM instance");
    impact.init();
    // No contact when x >= x1
    assert.equal(impact.evaluate({ x: 0.01, xdot: -1.0 }).value, 0);
    // Penetrating at x = -0.004 (pen = 0.004 >= d => full damping cmax = 200), xdot = -0.5
    const impVal = impact.evaluate({ x: -0.004, xdot: -0.5 }).value;
    const expectedImp = 1.0e5 * Math.pow(0.004, 1.5) - 200.0 * -0.5;
    assert.ok(Math.abs(impVal - expectedImp) < 1e-9, `Expected IMPACT=${expectedImp}, got ${impVal}`);

    // 4. SPRING_DAMPER(k=2000, c=50, l0=0.5, f0=100)
    const sd = instantiateAdamsWasmModel({
      modelType: "SPRING_DAMPER",
      params: { k: 2000, c: 50, l0: 0.5, f0: 100, k_nl: 0 },
    });
    assert.ok(sd, "Expected SPRING_DAMPER WASM instance");
    sd.init();
    // x = 0.6 (defl = 0.1), xdot = 0.2 => F = -2000*0.1 - 50*0.2 + 100 = -110 N
    const sdOut = sd.evaluate({ x: 0.6, xdot: 0.2 });
    assert.ok(Math.abs(sdOut.value - -110.0) < 1e-12, `Expected SPRING_DAMPER=-110, got ${sdOut.value}`);

    // 5. BUSHING (6-DOF viscoelastic mount)
    const bush = instantiateAdamsWasmModel({
      modelType: "BUSHING",
      params: {
        kx: 1000,
        ky: 2000,
        kz: 3000,
        krx: 100,
        kry: 200,
        krz: 300,
        cx: 10,
        cy: 20,
        cz: 30,
        crx: 1,
        cry: 2,
        crz: 3,
      },
    });
    assert.ok(bush, "Expected BUSHING WASM instance");
    assert.equal(bush.init(), 6);
    const bOut = bush.evaluate({
      x: 0.01,
      dy: 0.02,
      dz: -0.01,
      rx: 0.1,
      ry: -0.1,
      rz: 0.05,
      xdot: 0.1,
      vy: 0.0,
      vz: 0.0,
      wx: 0.0,
      wy: 0.0,
      wz: 0.0,
    });
    assert.ok(Math.abs(bOut.fx - -11.0) < 1e-12);
    assert.ok(Math.abs(bOut.fy - -40.0) < 1e-12);
    assert.ok(Math.abs(bOut.fz - 30.0) < 1e-12);
    assert.ok(Math.abs(bOut.tx - -10.0) < 1e-12);
    assert.ok(Math.abs(bOut.ty - 20.0) < 1e-12);
    assert.ok(Math.abs(bOut.tz - -15.0) < 1e-12);

    // 6. PAC2002_TIRE: Combined-Slip Pacejka Magic Formula 6.2 (pure-slip parity + friction ellipse + camber + trail Mz)
    const tire = instantiateAdamsWasmModel({
      modelType: "PAC2002_TIRE",
      params: { Bx: 10.0, Cx: 1.65, Dx: 1.0, Ex: 0.1, By: 8.5, Cy: 1.3, Dy: 0.95, Ey: -0.5, fz0: 4000.0, trail: 0.03 },
    });
    assert.ok(tire, "Expected PAC2002_TIRE WASM instance");
    tire.init();
    const kappa = 0.08;
    const alpha = 0.05;
    const fz = 5000.0;

    const mf = (u: number, B: number, C: number, D: number, E: number) =>
      D * Math.sin(C * Math.atan(B * u - E * (B * u - Math.atan(B * u))));
    const expectedFx0 = mf(kappa, 10.0, 1.65, 1.0 * fz, 0.1);
    const expectedFy0 = mf(alpha, 8.5, 1.3, 0.95 * fz, -0.5);

    // Pure longitudinal slip (alpha = 0, gamma = 0) and pure lateral slip (kappa = 0, gamma = 0)
    const pureLong = tire.evaluate({ x: kappa, xdot: 0.0, dy: fz, dz: 0.0 });
    const pureLat = tire.evaluate({ x: 0.0, xdot: alpha, dy: fz, dz: 0.0 });
    assert.ok(Math.abs(pureLong.fx - expectedFx0) < 1e-9, `Expected pure Fx=${expectedFx0}, got ${pureLong.fx}`);
    assert.ok(Math.abs(pureLat.fy - expectedFy0) < 1e-9, `Expected pure Fy=${expectedFy0}, got ${pureLat.fy}`);
    assert.ok(Math.abs(pureLat.fz - fz) < 1e-9);
    assert.ok(
      pureLat.mz < 0 && Math.abs(pureLat.mz) < 0.03 * Math.abs(pureLat.fy),
      "Expected pneumatic-trail self-aligning torque Mz",
    );

    // Combined braking + cornering: friction-ellipse force reduction via G_xalpha and G_ykappa
    const pureBrake = tire.evaluate({ x: -0.12, xdot: 0.0, dy: fz, dz: 0.0 });
    const pureCorner = tire.evaluate({ x: 0.0, xdot: 0.1, dy: fz, dz: 0.0 });
    const combined = tire.evaluate({ x: -0.12, xdot: 0.1, dy: fz, dz: 0.0 });
    assert.ok(
      Math.abs(combined.fx) < Math.abs(pureBrake.fx) * 0.85,
      `Expected friction-ellipse reduction in braking Fx: combined=${combined.fx}, pure=${pureBrake.fx}`,
    );
    assert.ok(
      Math.abs(combined.fy) < Math.abs(pureCorner.fy) * 0.85,
      `Expected friction-ellipse reduction in cornering Fy: combined=${combined.fy}, pure=${pureCorner.fy}`,
    );

    // Camber thrust at zero slip angle (alpha = 0, gamma = 0.05 rad)
    const camberOnly = tire.evaluate({ x: 0.0, xdot: 0.0, dy: fz, dz: 0.05 });
    assert.ok(camberOnly.fy > 50.0, `Expected positive camber thrust Fy at gamma=0.05 rad, got ${camberOnly.fy}`);
  });

  it("projects and links an FMI 2.0/3.0 user-defined FMU via MSC Adams GSE", () => {
    const proj = fmuToAdamsGse(
      {
        modelName: "ActiveSuspensionCtrlFmu",
        variables: [
          { name: "c_skyhook", causality: "parameter", type: "Real", valueReference: 1, start: 2500.0 },
          { name: "z_rel", causality: "input", type: "Real", valueReference: 2 },
          { name: "v_rel", causality: "input", type: "Real", valueReference: 3 },
          { name: "f_act", causality: "output", type: "Real", valueReference: 4 },
        ],
      },
      7,
      10,
      20,
    );
    assert.ok(proj.gseStatement.includes("GSE/7"));
    assert.ok(proj.gseStatement.includes("ActiveSuspensionCtrlFmu"));
    assert.deepEqual(proj.parameterNames, ["c_skyhook"]);

    const fmuInst = createFmuAdamsInstance("gse_7", proj.modelName, (io) => ({
      value: -2500.0 * (io.xdot ?? 0),
    }));
    const out = fmuInst.evaluate({ x: 0.02, xdot: 0.1 }, 0.01, 0.001);
    assert.ok(Math.abs(out.value - -250.0) < 1e-9);
  });
});

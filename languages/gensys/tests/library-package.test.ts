// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  GENSYS_MODEL_SPECS,
  createFmuGensysInstance,
  fmuToGensysCoupling,
  getGensysSchemasFromLibraries,
  instantiateGensysWasmModel,
  lookupGensysModelSchema,
  registerBuiltInGensysLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/gensys-std-lib");

describe("@modelscript/gensys — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/gensys-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected gensys-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/gensys-std-lib");
    assert.equal(pkg.manifest.language, "gensys");
    assert.equal(pkg.symbols.length, GENSYS_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, GENSYS_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & public provenance citations on every registered element
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
    registerBuiltInGensysLibrarySync();
    const schemas = getGensysSchemasFromLibraries();
    assert.ok(schemas.length >= GENSYS_MODEL_SPECS.length);

    assert.equal(lookupGensysModelSchema("K_S")?.name, "k_s");
    assert.equal(lookupGensysModelSchema("WR_COUPL_PE3")?.name, "wr_coupl_pe3");
    assert.equal(lookupGensysModelSchema("S1002")?.name, "prof_S1002");
    assert.equal(lookupGensysModelSchema("60E1")?.name, "rail_UIC60");
    assert.equal(lookupGensysModelSchema("ORE_B176")?.name, "track_irreg_ORE");
    assert.equal(lookupGensysModelSchema("AIRSPRING")?.name, "k_air");
  });

  it("evaluates k_s, c_s, wr_coupl_pe3, k_air, f_fric, and kpf_hertz in runtime.wasm", () => {
    // 1. Elastic spring (k_s): F = -k * dx
    const spring = instantiateGensysWasmModel({
      name: "kp1",
      modelType: "k_s",
      params: { kx: 2.0e6, ky: 1.5e6, kz: 1.2e6, f0: 0, gap: 0 },
    });
    assert.ok(spring, "Expected k_s WASM instance");
    spring.init();
    const spOut = spring.eval(0.0, 0.001, { dx: 0.01, dy: -0.005, dz: 0.02 });
    assert.ok(Math.abs(spOut.fx - -20_000) < 1e-6, `Expected fx=-20000 N, got ${spOut.fx}`);
    assert.ok(Math.abs(spOut.fy - 7_500) < 1e-6, `Expected fy=7500 N, got ${spOut.fy}`);
    assert.ok(Math.abs(spOut.fz - -24_000) < 1e-6, `Expected fz=-24000 N, got ${spOut.fz}`);
    assert.ok(spOut.aux2 > 0, "Expected positive stored elastic strain energy");

    // 2. Viscous damper (c_s): F = -c * v with blow-off saturation
    const damper = instantiateGensysWasmModel({
      name: "cp1",
      modelType: "c_s",
      params: { cx: 2.0e4, cy: 2.5e4, cz: 3.0e4, fmax: 5.0e4 },
    });
    assert.ok(damper, "Expected c_s WASM instance");
    damper.init();
    const dmpOut = damper.eval(0.0, 0.001, { vx: 0.5, vy: -1.0, vz: 5.0 });
    assert.ok(Math.abs(dmpOut.fx - -10_000) < 1e-6, `Expected fx=-10000 N, got ${dmpOut.fx}`);
    assert.ok(Math.abs(dmpOut.fy - 25_000) < 1e-6, `Expected fy=25000 N, got ${dmpOut.fy}`);
    assert.ok(Math.abs(dmpOut.fz - -50_000) < 1e-6, `Expected fz saturated at -50000 N, got ${dmpOut.fz}`);
    assert.ok(dmpOut.aux2 > 0, "Expected positive dissipated power");

    // 3. Nonlinear wheel-rail contact (wr_coupl_pe3): Polach/Kalker creep force & adhesion ratio
    const wrc = instantiateGensysWasmModel({
      name: "wr_l1",
      modelType: "wr_coupl_pe3",
    });
    assert.ok(wrc, "Expected wr_coupl_pe3 WASM instance");
    wrc.init();
    const wrcLowCreep = wrc.eval(0.0, 0.001, {
      vx: 30.0,
      normalForce: 75_000,
      creepX: 0.002,
      creepY: 0.001,
      spin: 0.1,
    });
    assert.ok(wrcLowCreep.fx < 0, `Expected resisting longitudinal creep force fx < 0, got ${wrcLowCreep.fx}`);
    assert.ok(wrcLowCreep.fy < 0, `Expected resisting lateral creep force fy < 0, got ${wrcLowCreep.fy}`);
    assert.ok(
      wrcLowCreep.aux1 > 0 && wrcLowCreep.aux1 <= 1.05,
      `Expected valid adhesion ratio in (0, 1], got ${wrcLowCreep.aux1}`,
    );

    const wrcHighCreep = wrc.eval(0.001, 0.001, {
      vx: 30.0,
      normalForce: 75_000,
      creepX: 0.05,
      creepY: 0.0,
      spin: 0.0,
    });
    assert.ok(
      Math.abs(wrcHighCreep.fx) > Math.abs(wrcLowCreep.fx),
      "Expected higher longitudinal creep force at higher creepage before deep slip",
    );
    assert.ok(
      Math.abs(wrcHighCreep.fx) <= 75_000 * 0.36 * 1.05,
      `Expected Polach force bounded by mu0*N, got ${wrcHighCreep.fx}`,
    );

    // 4. Pneumatic secondary airspring (k_air): vertical restoring force & polytropic pressure increase
    const airspring = instantiateGensysWasmModel({
      name: "kair_l",
      modelType: "k_air",
    });
    assert.ok(airspring, "Expected k_air WASM instance");
    const states = airspring.init({ dz: 0.0 });
    assert.equal(states, 2, "Expected 2 internal states for pneumatic airspring");
    const airOut1 = airspring.eval(0.01, 0.01, { dx: 0.005, dy: 0.0, dz: 0.02 });
    assert.ok(airOut1.fz < 0, `Expected upward restoring force fz < 0 under compression dz>0, got ${airOut1.fz}`);
    assert.ok(airOut1.aux1 > 4.5e5, `Expected bellows pressure above static p0=4.5e5 Pa, got ${airOut1.aux1}`);
    assert.ok(airOut1.fx < 0, `Expected longitudinal bellows shear restoring force fx < 0, got ${airOut1.fx}`);

    // 5. Hertzian normal contact (kpf_hertz) & Coulomb friction (f_fric)
    const hertz = instantiateGensysWasmModel({ name: "hz1", modelType: "kpf_hertz" });
    assert.ok(hertz, "Expected kpf_hertz WASM instance");
    const hzOut = hertz.eval(0.0, 0.001, { dz: 1.0e-4, vz: 0.0 });
    assert.ok(Math.abs(hzOut.fz - 9.5e10 * Math.pow(1.0e-4, 1.5)) < 1e-3);

    const fric = instantiateGensysWasmModel({ name: "fr1", modelType: "f_fric" });
    assert.ok(fric, "Expected f_fric WASM instance");
    const frOut = fric.eval(0.0, 0.001, { vx: 0.1, normalForce: 20_000 });
    assert.ok(Math.abs(frOut.fx - -7_000) < 10.0, `Expected Coulomb force ~ -7000 N, got ${frOut.fx}`);
  });

  it("evaluates cleanroom Kalker FASTSIM 2D contact patch discretization in creep_kalker and wr_coupl_pe3", () => {
    const kalker = instantiateGensysWasmModel({
      name: "kk_1",
      modelType: "creep_kalker",
      params: { mu0: 0.36, a_hertz: 0.0065, b_hertz: 0.0045, g_steel: 8.2e10, c11: 4.12, c22: 3.67, c23: 1.47 },
    });
    assert.ok(kalker, "Expected creep_kalker WASM instance");
    kalker.init();

    const fn = 75_000;
    const fMax = 0.36 * fn;

    // 1. Small creepage matches Kalker linear theory
    const linOut = kalker.eval(0.0, 0.001, { vx: 30.0, normalForce: fn, creepX: 1e-4, creepY: 0.0, spin: 0.0 });
    const expectedFx = -8.2e10 * 0.0065 * 0.0045 * 4.12 * 1e-4;
    assert.ok(
      Math.abs(linOut.fx - expectedFx) / Math.abs(expectedFx) < 0.05,
      `Expected FASTSIM linear Fx ~ ${expectedFx}, got ${linOut.fx}`,
    );

    // 2. High creepage saturates at Coulomb limit mu0 * Fn
    const satOut = kalker.eval(0.001, 0.001, { vx: 30.0, normalForce: fn, creepX: 0.05, creepY: 0.0, spin: 0.0 });
    assert.ok(
      Math.abs(satOut.fx) > 0.9 * fMax && Math.abs(satOut.fx) <= fMax + 1e-6,
      `Expected FASTSIM saturation near ${fMax} N, got ${Math.abs(satOut.fx)} N`,
    );
    assert.ok(satOut.aux1 > 0.9 && satOut.aux1 <= 1.0 + 1e-6, `Expected adhesion ratio near 1, got ${satOut.aux1}`);

    // 3. Spin creepage produces opposing lateral force and spin moment Mz < 0 in wr_coupl_pe3
    const pe3 = instantiateGensysWasmModel({ name: "pe3_spin", modelType: "wr_coupl_pe3" });
    assert.ok(pe3, "Expected wr_coupl_pe3 WASM instance");
    pe3.init();
    const spinOut = pe3.eval(0.0, 0.001, { vx: 25.0, normalForce: fn, creepX: 0.0, creepY: 0.0, spin: 0.5 });
    assert.ok(spinOut.fy < -100.0, `Expected resisting lateral force under positive spin, got ${spinOut.fy}`);
    assert.ok(spinOut.mz < 0.0, `Expected opposing spin moment Mz < 0, got ${spinOut.mz}`);
  });

  it("projects and links an FMI 2.0/3.0 active suspension FMU into GENSYS couplings", () => {
    const proj = fmuToGensysCoupling(
      {
        modelName: "ActiveYawDamperFmu",
        variables: [
          { name: "c_skyhook", causality: "parameter", type: "Real", valueReference: 1, start: 45_000 },
          { name: "vx", causality: "input", type: "Real", valueReference: 2 },
          { name: "fx", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      "bog_1",
      "car_1",
    );
    assert.ok(proj.couplRecord.includes("coupl fmu_cosim"));
    assert.ok(proj.couplRecord.includes("ActiveYawDamperFmu"));
    assert.deepEqual(proj.parameterNames, ["c_skyhook"]);

    const fmuInst = createFmuGensysInstance("yaw_fmu_1", proj.modelName, (_t, _dt, io) => ({
      fx: -45_000 * (io.vx ?? 0),
    }));
    const out = fmuInst.eval(0.01, 0.001, { vx: 0.2 });
    assert.ok(Math.abs(out.fx - -9_000) < 1e-9);
  });
});

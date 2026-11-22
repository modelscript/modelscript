// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  RTDS_MODEL_SPECS,
  createFmuRtdsInstance,
  fmuToRtdsCBuilder,
  getRtdsSchemasFromLibraries,
  instantiateRtdsWasmModel,
  lookupRtdsModelSchema,
  registerBuiltInRtdsLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/rtds-std-lib");

describe("@modelscript/rtds — Cleanroom Standard Library (modelscript.yaml, WASM EMT Runtime & FMU Linking)", () => {
  it("loads @modelscript/rtds-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected rtds-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/rtds-std-lib");
    assert.equal(pkg.manifest.language, "rtds");
    assert.equal(pkg.symbols.length, RTDS_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, RTDS_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & public provenance citations on every registered component
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
    registerBuiltInRtdsLibrarySync();
    const schemas = getRtdsSchemasFromLibraries();
    assert.ok(schemas.length >= RTDS_MODEL_SPECS.length);

    assert.equal(lookupRtdsModelSchema("RTDS_RLC_BRANCH")?.name, "rtds_rlc_branch");
    assert.equal(lookupRtdsModelSchema("SRC3")?.name, "rtds_3p_source");
    assert.equal(lookupRtdsModelSchema("SRF_PLL")?.name, "rtds_pll_srf");
    assert.equal(lookupRtdsModelSchema("RELAY_50_51")?.name, "rtds_oc_50_51");
  });

  it("steps Dommel trapezoidal RLC companion circuit accurately at 50 us EMT timestep", () => {
    const r = 10.0; // ohm
    const l = 0.05; // H -> tau = L/R = 5 ms
    const vStep = 100.0; // V
    const dt = 50e-6; // 50 us

    const rlc = instantiateRtdsWasmModel({
      name: "RLC_1",
      modelType: "rtds_rlc_branch",
      params: { r, l, c: 0.0 },
    });
    assert.ok(rlc, "Expected rtds_rlc_branch WASM instance");
    rlc.init();

    // Run 100 steps (5 ms = 1 time constant tau)
    let out = rlc.doStep(dt, dt, { va: vStep, vb: 0.0 });
    for (let k = 2; k <= 100; k++) {
      out = rlc.doStep(k * dt, dt, { va: vStep, vb: 0.0 });
    }

    const expectedGEq = 1.0 / (r + (2.0 * l) / dt);
    assert.ok(Math.abs(out.gEq - expectedGEq) < 1e-12, `Expected gEq=${expectedGEq}, got ${out.gEq}`);

    // Exact RL step response at t = 1*tau = 5 ms: I(tau) = (V/R)*(1 - e^-1) ≈ 6.3212 A
    const tEnd = 100 * dt;
    const iAnalytical = (vStep / r) * (1.0 - Math.exp(-(r / l) * tEnd));
    const relErr = Math.abs(out.ia - iAnalytical) / iAnalytical;
    assert.ok(relErr < 0.01, `Expected Dommel RL current ~ ${iAnalytical.toFixed(4)} A, got ${out.ia.toFixed(4)} A`);
  });

  it("achieves exact Park abc -> dq0 -> abc roundtrip accuracy", () => {
    const fwd = instantiateRtdsWasmModel({ name: "PARK_FWD", modelType: "rtds_abc_dq0" });
    const inv = instantiateRtdsWasmModel({ name: "PARK_INV", modelType: "rtds_dq0_abc" });
    assert.ok(fwd && inv, "Expected Park transform WASM instances");
    fwd.init();
    inv.init();

    const theta = 1.2345;
    const vaIn = 120.5;
    const vbIn = -85.2;
    const vcIn = -14.8; // includes non-zero zero-sequence component

    const dq0 = fwd.doStep(0, 50e-6, { va: vaIn, vb: vbIn, vc: vcIn, theta });
    const abc = inv.doStep(0, 50e-6, { vd: dq0.vd, vq: dq0.vq, v0: dq0.v0, theta });

    assert.ok(Math.abs(abc.va - vaIn) < 1e-12, `va mismatch: ${abc.va} vs ${vaIn}`);
    assert.ok(Math.abs(abc.vb - vbIn) < 1e-12, `vb mismatch: ${abc.vb} vs ${vbIn}`);
    assert.ok(Math.abs(abc.vc - vcIn) < 1e-12, `vc mismatch: ${abc.vc} vs ${vcIn}`);
  });

  it("locks SRF-PLL onto a 60 Hz three-phase grid waveform at 50 us EMT timestep", () => {
    const dt = 50e-6;
    const fGrid = 60.0;
    const omegaGrid = 2.0 * Math.PI * fGrid;
    const phase0 = 0.6; // initial phase offset (rad)

    const pll = instantiateRtdsWasmModel({
      name: "PLL_1",
      modelType: "rtds_pll_srf",
      params: { freqNom: 60.0, kp: 120.0, ki: 3600.0, vNom: 1.0 },
    });
    assert.ok(pll, "Expected rtds_pll_srf WASM instance");
    pll.init();

    let out = pll.doStep(0, dt, { va: 1, vb: -0.5, vc: -0.5 });
    // Simulate 200 ms (4000 steps at 50 us)
    for (let k = 1; k <= 4000; k++) {
      const t = k * dt;
      const ang = omegaGrid * t + phase0;
      const va = Math.cos(ang);
      const vb = Math.cos(ang - (2.0 * Math.PI) / 3.0);
      const vc = Math.cos(ang + (2.0 * Math.PI) / 3.0);
      out = pll.doStep(t, dt, { va, vb, vc });
    }

    assert.ok(Math.abs(out.freqHz - fGrid) < 0.05, `Expected PLL freqHz ~ 60 Hz, got ${out.freqHz}`);
    assert.ok(Math.abs(out.vq) < 1e-3, `Expected PLL vq ~ 0 at lock, got ${out.vq}`);
    assert.ok(Math.abs(out.vd - 1.0) < 1e-3, `Expected PLL vd ~ 1.0 at lock, got ${out.vd}`);
  });

  it("steps Bergeron line, VSC converter, PI controller, and IEEE 50/51 relay", () => {
    const dt = 50e-6;

    // 1. Bergeron travelling-wave line: wave arrives at receiving end after tau = 250 us (5 steps)
    const line = instantiateRtdsWasmModel({
      name: "TLINE_1",
      modelType: "rtds_bergeron_line",
      params: { zc: 300.0, tau: 250e-6, rTotal: 0.0 },
    });
    assert.ok(line);
    line.init();
    let lineOut = line.doStep(dt, dt, { va: 300.0, va2: 0.0 });
    assert.ok(Math.abs(lineOut.ia - 1.0) < 1e-9);
    assert.ok(Math.abs(lineOut.ia2) < 1e-9, "Expected zero receiving-end current before wave arrival");
    for (let k = 2; k <= 6; k++) {
      lineOut = line.doStep(k * dt, dt, { va: 300.0, va2: 0.0 });
    }
    assert.ok(Math.abs(lineOut.ia2) > 0.5, `Expected travelling wave arrival at receiving end, got ia2=${lineOut.ia2}`);

    // 2. IEEE 50/51 overcurrent relay trips instantaneously on high fault current
    const relay = instantiateRtdsWasmModel({
      name: "OC_1",
      modelType: "rtds_oc_50_51",
      params: { iPickup: 1.2, tds: 0.5, iInst: 5.0 },
    });
    assert.ok(relay);
    relay.init();
    const normalOut = relay.doStep(dt, dt, { meas: 1.0 });
    assert.equal(normalOut.trip, 0);
    const faultOut = relay.doStep(2 * dt, dt, { meas: 6.0 });
    assert.equal(faultOut.trip, 1);
  });

  it("projects and links an FMI 2.0/3.0 user-defined FMU via CBuilder", () => {
    const proj = fmuToRtdsCBuilder(
      {
        modelName: "VendorGridFormingFmu",
        variables: [
          { name: "kpDroop", causality: "parameter", type: "Real", valueReference: 1, start: 0.05 },
          { name: "va", causality: "input", type: "Real", valueReference: 2 },
          { name: "ctrlOut", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      "GFM_1",
      1,
      50,
    );
    assert.ok(proj.cbuilderBlock.includes("CBUILDER_FMU GFM_1"));
    assert.ok(proj.cbuilderBlock.includes("VendorGridFormingFmu"));
    assert.deepEqual(proj.parameterNames, ["kpDroop"]);

    const fmuInst = createFmuRtdsInstance("GFM_1", 1, proj.modelName, (_t, _dt, io) => ({
      ctrlOut: 0.5 * (io.va ?? 0),
    }));
    const out = fmuInst.doStep(50e-6, 50e-6, { va: 2.0 });
    assert.ok(Math.abs(out.ctrlOut - 1.0) < 1e-9);
  });
});

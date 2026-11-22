// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ATP_MODEL_SPECS,
  createFmuAtpInstance,
  fmuToAtpModelsCard,
  getAtpSchemasFromLibraries,
  instantiateAtpWasmModel,
  lookupAtpModelSchema,
  registerBuiltInAtpLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/atp-std-lib");

describe("@modelscript/atp — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/atp-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected atp-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/atp-std-lib");
    assert.equal(pkg.manifest.language, "atp");
    assert.equal(pkg.symbols.length, ATP_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, ATP_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & public Dommel/IEEE/CIGRE provenance on every registered component
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
    registerBuiltInAtpLibrarySync();
    const schemas = getAtpSchemasFromLibraries();
    assert.ok(schemas.length >= ATP_MODEL_SPECS.length);

    assert.equal(lookupAtpModelSchema("branch_rlc_00")?.name, "BRANCH_RLC_00");
    assert.equal(lookupAtpModelSchema("BERGERON")?.name, "LINE_BERGERON_M1");
    assert.equal(lookupAtpModelSchema("MOV")?.name, "MOV_ARRESTER_92");
    assert.equal(lookupAtpModelSchema("type15")?.name, "SRC_IMPULSE_15");
    assert.equal(lookupAtpModelSchema("tacs_int")?.name, "TACS_INTEGRATOR");
  });

  it("steps BRANCH_RLC_00, MOV_ARRESTER_92, SRC_IMPULSE_15, and TACS_INTEGRATOR in runtime.wasm", () => {
    // 1. BRANCH_RLC_00: Dommel trapezoidal series RL step response (R = 10 Ohm, L = 10 mH, C = 0)
    //    Applying V = 100 V step should converge toward I_ss = 10 A with time constant tau = L/R = 1 ms.
    const rlc = instantiateAtpWasmModel({
      modelType: "BRANCH_RLC_00",
      id: "RL1",
      node1: "BUS1",
      node2: "GND",
      params: [10.0, 10.0, 0.0],
    });
    assert.ok(rlc, "Expected BRANCH_RLC_00 WASM instance");
    rlc.init();
    const dt = 1e-4; // 0.1 ms
    let rlcOut = rlc.doStep(dt, dt, { vNode1: 100.0, vNode2: 0.0 });
    // Expected G_eq = 1 / (R + 2*L/dt) = 1 / (10 + 200) = 1/210 S
    assert.ok(Math.abs(rlcOut.gEq - 1.0 / 210.0) < 1e-9, `Expected gEq=1/210, got ${rlcOut.gEq}`);
    for (let k = 2; k <= 100; k++) {
      rlcOut = rlc.doStep(k * dt, dt, { vNode1: 100.0, vNode2: 0.0 });
    }
    assert.ok(
      Math.abs(rlcOut.iBranch - 10.0) < 0.01,
      `Expected RL steady-state current ~10 A after 10*tau, got ${rlcOut.iBranch}`,
    );

    // 2. MOV_ARRESTER_92: Exponential ZnO arrester I = Iref * (V / Vref)^q
    const mov = instantiateAtpWasmModel({
      modelType: "MOV_ARRESTER_92",
      id: "AR1",
      node1: "LINE",
      node2: "GND",
      params: [100000.0, 1000.0, 20.0, 1.0e9],
    });
    assert.ok(mov, "Expected MOV_ARRESTER_92 WASM instance");
    mov.init();
    // At V = Vref = 100 kV, I = Iref + V/Rleak = 1000.0001 A
    const movAtRef = mov.doStep(1e-6, 1e-6, { vNode1: 100000.0, vNode2: 0.0 });
    assert.ok(Math.abs(movAtRef.iBranch - 1000.0) < 1e-2, `Expected I~1000 A at Vref, got ${movAtRef.iBranch}`);
    // At V = 1.1 * Vref, I = 1000 * 1.1^20 ~= 6727.5 A
    const movOver = mov.doStep(2e-6, 1e-6, { vNode1: 110000.0, vNode2: 0.0 });
    const expectedOver = 1000.0 * Math.pow(1.1, 20.0);
    assert.ok(
      Math.abs(movOver.iBranch - expectedOver) < 1.0,
      `Expected I~${expectedOver.toFixed(1)} A at 1.1*Vref, got ${movOver.iBranch}`,
    );
    assert.ok(movOver.auxOut > 0, "Expected cumulative MOV absorbed energy > 0 J");

    // 3. SRC_IMPULSE_15: Double-exponential lightning surge V0 * (exp(-alpha*t) - exp(-beta*t))
    const v0 = 1037000.0;
    const alpha = 14659.0;
    const beta = 2468900.0;
    const imp = instantiateAtpWasmModel({
      modelType: "SRC_IMPULSE_15",
      id: "LIGHT1",
      node1: "TOWER",
      node2: "GND",
      params: [v0, alpha, beta, 0.0, 1e-3],
    });
    assert.ok(imp, "Expected SRC_IMPULSE_15 WASM instance");
    imp.init();
    const tPeak = 2.0e-6;
    const impPeak = imp.doStep(tPeak, 1e-6, {});
    const expectedPeak = v0 * (Math.exp(-alpha * tPeak) - Math.exp(-beta * tPeak));
    assert.ok(
      Math.abs(impPeak.vSource - expectedPeak) < 1e-3,
      `Expected impulse vSource=${expectedPeak}, got ${impPeak.vSource}`,
    );
    const impTail = imp.doStep(50.0e-6, 1e-6, {});
    assert.ok(impTail.vSource < impPeak.vSource * 0.6, "Expected lightning impulse tail to decay below 60% by 50 us");

    // 4. TACS_INTEGRATOR: Trapezoidal integration of constant input u = 5.0 with gain K = 2.0 over 0.1 s -> y = 1.0
    const integ = instantiateAtpWasmModel({
      modelType: "TACS_INTEGRATOR",
      id: "INT1",
      params: [2.0, 0.0, -100.0, 100.0],
    });
    assert.ok(integ, "Expected TACS_INTEGRATOR WASM instance");
    integ.init({ ctrlIn: 5.0 });
    const dtCtrl = 0.01;
    let intOut = integ.doStep(dtCtrl, dtCtrl, { ctrlIn: 5.0 });
    for (let k = 2; k <= 10; k++) {
      intOut = integ.doStep(k * dtCtrl, dtCtrl, { ctrlIn: 5.0 });
    }
    assert.ok(
      Math.abs(intOut.ctrlOut - 1.0) < 1e-9,
      `Expected TACS integrator output 1.0 after 0.1 s, got ${intOut.ctrlOut}`,
    );
  });

  it("projects and links an FMI 2.0/3.0 user-defined FMU via MODELS FOREIGN", () => {
    const proj = fmuToAtpModelsCard(
      {
        modelName: "VendorRelayFmu",
        variables: [
          { name: "iPickup", causality: "parameter", type: "Real", valueReference: 1, start: 500.0 },
          { name: "iMeas", causality: "input", type: "Real", valueReference: 2 },
          { name: "trip", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      "RELAY1",
    );
    assert.ok(proj.modelsCard.includes("MODELS"));
    assert.ok(proj.modelsCard.includes("FOREIGN VendorRelayFmu"));
    assert.deepEqual(proj.parameterNames, ["iPickup"]);

    const fmuInst = createFmuAtpInstance("RELAY1", "BUS1", "GND", proj.modelName, (_t, _dt, io) => ({
      ctrlOut: (io?.ctrlIn ?? 0) > 500.0 ? 1.0 : 0.0,
    }));
    const noTrip = fmuInst.doStep(0.001, 0.001, { ctrlIn: 250.0 });
    assert.equal(noTrip.ctrlOut, 0.0);
    const tripped = fmuInst.doStep(0.002, 0.001, { ctrlIn: 750.0 });
    assert.equal(tripped.ctrlOut, 1.0);
  });

  it("steps 2-pole VF convolution on LINE_JMARTI_FD / LINE_SEMLYEN_FD and Park d-q-0 flux linkages on MACH_SYNC_59", () => {
    const dt = 50e-6;

    // 1. LINE_JMARTI_FD & LINE_SEMLYEN_FD: 2-pole recursive exponential vector-fitting propagation convolution
    for (const lineType of ["LINE_JMARTI_FD", "LINE_SEMLYEN_FD"] as const) {
      const fd = instantiateAtpWasmModel({
        modelType: lineType,
        id: `${lineType}_1`,
        params: [380.0, 250e-6, 1.5, 50e-6, 400e-6],
      });
      assert.ok(fd, `Expected ${lineType} WASM instance`);
      fd.init();
      let out = fd.doStep(dt, dt, { vNode1: 100000.0, vNode2: 0.0 });
      assert.ok(Math.abs(out.iHist2) < 1e-9, "Expected zero receiving-end history before wave arrival");
      for (let k = 2; k <= 12; k++) {
        out = fd.doStep(k * dt, dt, { vNode1: 100000.0, vNode2: 0.0 });
      }
      assert.ok(
        Math.abs(out.iHist2) > 10.0,
        `Expected 2-pole VF convolved wave arrival on ${lineType}, got iHist2=${out.iHist2}`,
      );
      // Verify both fast & slow VF poles (aux2, aux3) contributed to end-2 convolution
      assert.ok(Math.abs(out.aux2 ?? 0) > 1.0 && Math.abs(out.aux3 ?? 0) > 1.0);
    }

    // 2. MACH_SYNC_59: Full 3-phase Park d-q-0 synchronous machine with Ed', Eq', psi_kd, psi_kq
    const mach = instantiateAtpWasmModel({
      modelType: "MACH_SYNC_59",
      id: "GEN59_1",
      params: [20000.0, 60.0, 4.0, 0.2, 5.0e6],
    });
    assert.ok(mach, "Expected MACH_SYNC_59 WASM instance");
    const nStates = mach.init();
    assert.equal(nStates, 9, "Expected 9 Park d-q-0 synchronous machine states");

    // Apply 3-phase bolted terminal fault (vNode1 = 0, vNode2 = 0) and observe subtransient flux decay
    let mOut = mach.doStep(dt, dt, { vNode1: 0.0, vNode2: 0.0, ctrlIn: 1.05 });
    const initialPsiKd = mOut.aux2 ?? 0;
    for (let k = 2; k <= 400; k++) {
      mOut = mach.doStep(k * dt, dt, { vNode1: 0.0, vNode2: 0.0, ctrlIn: 1.05 });
    }
    assert.ok(Number.isFinite(mOut.aux0) && Number.isFinite(mOut.aux1), "Expected finite Ed' and Eq'");
    assert.ok(
      (mOut.aux2 ?? 0) < initialPsiKd,
      `Expected d-axis damper flux psi_kd to decay under fault: ${mOut.aux2} vs ${initialPsiKd}`,
    );
    assert.ok(mOut.flux > 0 && mOut.auxOut > 0, "Expected positive subtransient and transient flux magnitudes");
    assert.ok(mOut.omegaRadS > 2.0 * Math.PI * 60.0, "Expected rotor acceleration during 3-phase fault");
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CYME_MODEL_SPECS,
  createFmuCymeInstance,
  fmuToCymeSxst,
  getCymeSchemasFromLibraries,
  instantiateCymeWasmModel,
  lookupCymeModelSchema,
  registerBuiltInCymeLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/cyme-std-lib");

describe("@modelscript/cyme — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/cyme-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected cyme-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/cyme-std-lib");
    assert.equal(pkg.manifest.language, "cyme");
    assert.equal(pkg.symbols.length, CYME_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, CYME_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & provenance metadata on every registered equipment model
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
    registerBuiltInCymeLibrarySync();
    const schemas = getCymeSchemasFromLibraries();
    assert.ok(schemas.length >= CYME_MODEL_SPECS.length);

    assert.equal(lookupCymeModelSchema("oh_acsr_336_linnet")?.name, "OH_ACSR_336_LINNET");
    assert.equal(lookupCymeModelSchema("LINNET")?.name, "OH_ACSR_336_LINNET");
    assert.equal(lookupCymeModelSchema("65K")?.name, "FUSE_K_65A");
    assert.equal(lookupCymeModelSchema("IEEE_VI")?.name, "RELAY_OC_IEEE_VI");
    assert.equal(lookupCymeModelSchema("PV_IEEE1547")?.name, "DER_PV_IEEE1547");
  });

  it("evaluates Carson sequence impedance, RELAY_OC_IEEE_VI, REG_3P_STEP_32, DER_PV_IEEE1547, and FUSE_K_65A in runtime.wasm", () => {
    // 1. Overhead Conductor (OH_ACSR_336_LINNET): Carson positive & zero-sequence impedance
    const line = instantiateCymeWasmModel({ equipmentId: "LINE_1", modelType: "OH_ACSR_336_LINNET" });
    assert.ok(line, "Expected OH_ACSR_336_LINNET WASM instance");
    line.init();
    const lineOut = line.evaluate({ lengthKm: 2.0, freqHz: 60.0, rhoOhmM: 100.0 });
    assert.ok(lineOut.r1Ohm > 0.35 && lineOut.r1Ohm < 0.41, `Expected r1Ohm ~ 0.3802, got ${lineOut.r1Ohm}`);
    assert.ok(lineOut.x1Ohm > 0.5 && lineOut.x1Ohm < 1.0, `Expected positive x1Ohm, got ${lineOut.x1Ohm}`);
    assert.ok(lineOut.r0Ohm > lineOut.r1Ohm, `Expected r0Ohm > r1Ohm, got r0=${lineOut.r0Ohm}, r1=${lineOut.r1Ohm}`);
    assert.ok(lineOut.x0Ohm > lineOut.x1Ohm, `Expected x0Ohm > x1Ohm, got x0=${lineOut.x0Ohm}, x1=${lineOut.x1Ohm}`);

    // 2. IEEE C37.112 Very Inverse Overcurrent Relay (RELAY_OC_IEEE_VI):
    //    pickup=400 A, TD=1.0, A=19.61, B=0.491, p=2.0 -> at I=1200 A (M=3): t = 19.61/(9-1) + 0.491 = 2.94225 s
    const relay = instantiateCymeWasmModel({ equipmentId: "R51_1", modelType: "RELAY_OC_IEEE_VI" });
    assert.ok(relay, "Expected RELAY_OC_IEEE_VI WASM instance");
    relay.init();
    const noTrip = relay.evaluate({ iAmps: 300.0 });
    assert.equal(noTrip.tripTimeSec, -1.0, "Expected no trip below pickup");
    const viTrip = relay.evaluate({ iAmps: 1200.0 });
    assert.ok(
      Math.abs(viTrip.tripTimeSec - 2.94225) < 1e-4,
      `Expected IEEE VI trip time ~ 2.94225 s at M=3, got ${viTrip.tripTimeSec}`,
    );
    const instTrip = relay.evaluate({ iAmps: 5000.0 });
    assert.ok(
      Math.abs(instTrip.tripTimeSec - 0.02) < 1e-6,
      `Expected instantaneous trip time 0.02 s at M>=10, got ${instTrip.tripTimeSec}`,
    );

    // 3. IEC 60255 Standard Inverse Relay (RELAY_OC_IEC_SI)
    const iecRelay = instantiateCymeWasmModel({ equipmentId: "R51_IEC", modelType: "RELAY_OC_IEC_SI" });
    assert.ok(iecRelay, "Expected RELAY_OC_IEC_SI WASM instance");
    iecRelay.init();
    const iecTrip = iecRelay.evaluate({ iAmps: 2000.0 }); // M = 5, TMS = 0.5
    const expectedIec = 0.5 * (0.14 / (Math.pow(5.0, 0.02) - 1.0));
    assert.ok(
      Math.abs(iecTrip.tripTimeSec - expectedIec) < 1e-4,
      `Expected IEC SI trip time ~ ${expectedIec}, got ${iecTrip.tripTimeSec}`,
    );

    // 4. 32-Step Voltage Regulator (REG_3P_STEP_32): 0.625%/step (+/-16 steps)
    const reg = instantiateCymeWasmModel({ equipmentId: "REG_1", modelType: "REG_3P_STEP_32" });
    assert.ok(reg, "Expected REG_3P_STEP_32 WASM instance");
    reg.init();
    const regTap8 = reg.evaluate({ vPu: 1.0, tapStep: 8 });
    assert.ok(Math.abs(regTap8.tapRatio - 1.05) < 1e-6, `Expected tap +8 ratio 1.05, got ${regTap8.tapRatio}`);
    const regTapMin = reg.evaluate({ vPu: 1.0, tapStep: -16 });
    assert.ok(Math.abs(regTapMin.tapRatio - 0.9) < 1e-6, `Expected tap -16 ratio 0.90, got ${regTapMin.tapRatio}`);
    const regAutoBoost = reg.evaluate({ vPu: 0.95 });
    assert.ok(regAutoBoost.tapRatio > 1.05, `Expected automatic boost for vPu=0.95, got ${regAutoBoost.tapRatio}`);

    // 5. IEEE 1547-2018 Category B PV Smart Inverter (DER_PV_IEEE1547): Volt-VAR & Volt-Watt curves
    const pv = instantiateCymeWasmModel({ equipmentId: "PV_1", modelType: "DER_PV_IEEE1547" });
    assert.ok(pv, "Expected DER_PV_IEEE1547 WASM instance");
    pv.init();
    const pvLowV = pv.evaluate({ vPu: 0.9, pAvailPu: 1.0 });
    assert.ok(
      Math.abs(pvLowV.qOutPu - 0.44) < 1e-6,
      `Expected +0.44 pu VAR injection at 0.90 pu, got ${pvLowV.qOutPu}`,
    );
    assert.ok(Math.abs(pvLowV.pOutPu - 1.0) < 1e-6, `Expected full active power at 0.90 pu, got ${pvLowV.pOutPu}`);

    const pvDeadband = pv.evaluate({ vPu: 1.0, pAvailPu: 1.0 });
    assert.ok(Math.abs(pvDeadband.qOutPu) < 1e-6, `Expected 0 VAR in deadband at 1.00 pu, got ${pvDeadband.qOutPu}`);

    const pvHighV = pv.evaluate({ vPu: 1.08, pAvailPu: 1.0 });
    assert.ok(
      Math.abs(pvHighV.qOutPu - -0.44) < 1e-6,
      `Expected -0.44 pu VAR absorption at 1.08 pu, got ${pvHighV.qOutPu}`,
    );
    assert.ok(
      Math.abs(pvHighV.pOutPu - 0.6) < 1e-6,
      `Expected Volt-Watt active power curtailment to 0.60 pu at 1.08 pu, got ${pvHighV.pOutPu}`,
    );

    // 6. 65A Type-K Fuse Link (FUSE_K_65A): I^2*t minimum melting curve
    const fuse = instantiateCymeWasmModel({ equipmentId: "FUSE_1", modelType: "FUSE_K_65A" });
    assert.ok(fuse, "Expected FUSE_K_65A WASM instance");
    fuse.init();
    const fuseSafe = fuse.evaluate({ iAmps: 100.0 });
    assert.equal(fuseSafe.tripTimeSec, -1.0, "Expected 65K fuse not to melt at 100 A");
    const fuse500 = fuse.evaluate({ iAmps: 500.0 });
    const fuse1000 = fuse.evaluate({ iAmps: 1000.0 });
    assert.ok(
      fuse500.tripTimeSec > 0 && fuse500.tripTimeSec < 0.2,
      `Expected fast melt at 500 A, got ${fuse500.tripTimeSec}`,
    );
    assert.ok(
      fuse1000.tripTimeSec > 0 && fuse1000.tripTimeSec < fuse500.tripTimeSec,
      `Expected faster melt at 1000 A (${fuse1000.tripTimeSec}) than at 500 A (${fuse500.tripTimeSec})`,
    );
  });

  it("projects and links an FMI 2.0/3.0 user-defined FMU for CYME equipment", () => {
    const proj = fmuToCymeSxst(
      {
        modelName: "VendorSmartInverterFmu",
        variables: [
          { name: "droopGain", causality: "parameter", type: "Real", valueReference: 1, start: 5.0 },
          { name: "vPu", causality: "input", type: "Real", valueReference: 2 },
          { name: "qOutPu", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      "DER_FMU_1",
      "SEC_42",
      12.47,
    );
    assert.ok(proj.sxstDeviceRecord.includes("USER_DEFINED_MODEL"));
    assert.ok(proj.sxstDeviceRecord.includes("VendorSmartInverterFmu"));
    assert.deepEqual(proj.parameterNames, ["droopGain"]);

    const fmuInst = createFmuCymeInstance("DER_FMU_1", proj.modelName, (input) => ({
      qOutPu: 5.0 * (1.0 - (input.vPu ?? 1.0)),
    }));
    const out = fmuInst.evaluate({ vPu: 0.96 });
    assert.ok(Math.abs(out.qOutPu - 0.2) < 1e-9, `Expected FMU qOutPu=0.20, got ${out.qOutPu}`);
  });

  it("computes full 3x3 Carson's equations with Kron neutral reduction for OH_ACSR and UG_XLPE cables", () => {
    const oh = instantiateCymeWasmModel({ equipmentId: "OH_1", modelType: "OH_ACSR_336_LINNET" });
    const ug = instantiateCymeWasmModel({ equipmentId: "UG_1", modelType: "UG_XLPE_500MCM_15kV" });
    assert.ok(oh && ug);
    oh.init();
    ug.init();

    const ohOut = oh.evaluate({ lengthKm: 1.0, freqHz: 60.0, rhoOhmM: 100.0 });
    const ugOut = ug.evaluate({ lengthKm: 1.0, freqHz: 60.0, rhoOhmM: 100.0 });

    assert.ok(ohOut.zAbc && ohOut.zAbc.length === 18, "Expected 3x3 complex Z_abc matrix (18 f64s)");
    const z = ohOut.zAbc;
    // Symmetry: Z_ab == Z_ba and Z_ac == Z_ca
    assert.ok(Math.abs(z[2]! - z[6]!) < 1e-12 && Math.abs(z[3]! - z[7]!) < 1e-12, "Expected Z_ab == Z_ba");
    assert.ok(Math.abs(z[4]! - z[12]!) < 1e-12 && Math.abs(z[5]! - z[13]!) < 1e-12, "Expected Z_ac == Z_ca");

    // Exact Fortescue identity from Kron-reduced Z_abc
    const rSelfAvg = (z[0]! + z[8]! + z[16]!) / 3.0;
    const xSelfAvg = (z[1]! + z[9]! + z[17]!) / 3.0;
    const rMutAvg = (z[2]! + z[6]! + z[10]! + z[14]! + z[4]! + z[12]!) / 6.0;
    const xMutAvg = (z[3]! + z[7]! + z[11]! + z[15]! + z[5]! + z[13]!) / 6.0;

    assert.ok(Math.abs(ohOut.r1Ohm - (rSelfAvg - rMutAvg)) < 1e-12);
    assert.ok(Math.abs(ohOut.x1Ohm - (xSelfAvg - xMutAvg)) < 1e-12);
    assert.ok(Math.abs(ohOut.r0Ohm - (rSelfAvg + 2.0 * rMutAvg)) < 1e-12);
    assert.ok(Math.abs(ohOut.x0Ohm - (xSelfAvg + 2.0 * xMutAvg)) < 1e-12);

    // Underground XLPE cable has tighter spacing & concentric neutral -> lower X1 and X0 than overhead ACSR
    assert.ok(ugOut.x1Ohm > 0 && ugOut.x1Ohm < ohOut.x1Ohm, `Expected UG x1 (${ugOut.x1Ohm}) < OH x1 (${ohOut.x1Ohm})`);
    assert.ok(ugOut.x0Ohm > 0 && ugOut.x0Ohm < ohOut.x0Ohm, `Expected UG x0 (${ugOut.x0Ohm}) < OH x0 (${ohOut.x0Ohm})`);
  });
});

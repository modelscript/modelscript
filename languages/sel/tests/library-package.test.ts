// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SEL_ELEMENT_SPECS,
  createFmuSelInstance,
  fmuToSelSettings,
  getSelSchemasFromLibraries,
  instantiateSelWasmElement,
  lookupSelElementSchema,
  registerBuiltInSelLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/sel-std-lib");

describe("@modelscript/sel — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/sel-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected sel-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/sel-std-lib");
    assert.equal(pkg.manifest.language, "sel");
    assert.equal(pkg.symbols.length, SEL_ELEMENT_SPECS.length);
    assert.equal(pkg.diagrams.length, SEL_ELEMENT_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & public IEEE/IEC provenance metadata on every registered schema
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
    registerBuiltInSelLibrarySync();
    const schemas = getSelSchemasFromLibraries();
    assert.ok(schemas.length >= SEL_ELEMENT_SPECS.length);

    assert.equal(lookupSelElementSchema("sel_u3_vi")?.name, "SEL_U3_VI");
    assert.equal(lookupSelElementSchema("C1")?.name, "SEL_C1_SI");
    assert.equal(lookupSelElementSchema("21P")?.name, "EL_21P_MHO");
    assert.equal(lookupSelElementSchema("50P1P")?.name, "EL_50P");
    assert.equal(lookupSelElementSchema("SV1T")?.name, "SV_TIMER");
  });

  it("evaluates IEEE U3, IEC C1, 21P Mho distance, 87T differential, and SV_TIMER in runtime.wasm", () => {
    // 1. SEL_U3_VI (IEEE C37.112 Very Inverse): pickup = 5 A, TD = 1.0, I = 25 A (M = 5)
    //    Expected t_op = 1.0 * (19.61 / (5^2 - 1) + 0.491) = 19.61/24 + 0.491 = 1.3080833... s
    const u3 = instantiateSelWasmElement({
      elementType: "SEL_U3_VI",
      id: "51P1",
      params: { pickup: 5.0, timeDial: 1.0 },
    });
    assert.ok(u3, "Expected SEL_U3_VI WASM instance");
    u3.init();
    const expectedU3Top = 19.61 / (25.0 - 1.0) + 0.491;
    let u3Out = u3.evalStep(0.1, 0.1, { iMag: 25.0 });
    assert.equal(u3Out.pickup, true);
    assert.equal(u3Out.trip, false);
    assert.ok(
      Math.abs(u3Out.operateTimeSec - expectedU3Top) < 1e-6,
      `Expected U3 t_op=${expectedU3Top}, got ${u3Out.operateTimeSec}`,
    );
    for (let k = 1; k < 14; k++) {
      u3Out = u3.evalStep(0.1 * (k + 1), 0.1, { iMag: 25.0 });
    }
    assert.equal(u3Out.trip, true, "Expected SEL_U3_VI to trip once integrated time exceeds t_op");

    // 2. SEL_C1_SI (IEC 60255-151 Standard Inverse): pickup = 2 A, TMS = 0.5, I = 10 A (M = 5)
    //    Expected t_op = 0.5 * 0.14 / (5^0.02 - 1) = 2.1398... s
    const c1 = instantiateSelWasmElement({
      elementType: "SEL_C1_SI",
      id: "51G1",
      params: { pickup: 2.0, timeDial: 0.5 },
    });
    assert.ok(c1, "Expected SEL_C1_SI WASM instance");
    c1.init();
    const expectedC1Top = (0.5 * 0.14) / (Math.pow(5.0, 0.02) - 1.0);
    const c1Out = c1.evalStep(0.05, 0.05, { iMag: 10.0 });
    assert.equal(c1Out.pickup, true);
    assert.ok(
      Math.abs(c1Out.operateTimeSec - expectedC1Top) < 1e-5,
      `Expected C1 t_op=${expectedC1Top}, got ${c1Out.operateTimeSec}`,
    );

    // 3. EL_21P_MHO (Phase Mho Distance): reach = 5 Ohm, MTA = 75 deg, delay = 0 s
    const mho = instantiateSelWasmElement({
      elementType: "EL_21P_MHO",
      id: "Z1P",
      params: { reachOhm: 5.0, mtaDeg: 75.0, delaySec: 0.0 },
    });
    assert.ok(mho, "Expected EL_21P_MHO WASM instance");
    mho.init();
    // Fault inside mho circle at Z = 2.5 < 75 deg -> R = 0.647, X = 2.415
    const mhoInside = mho.evalStep(0.01, 0.01, { zReal: 0.647, zImag: 2.415 });
    assert.equal(mhoInside.pickup, true);
    assert.equal(mhoInside.trip, true, "Expected 21P Mho to trip for in-zone fault");
    // Out-of-zone load impedance at Z = 10 + j2 Ohm
    const mhoOutside = mho.evalStep(0.02, 0.01, { zReal: 10.0, zImag: 2.0 });
    assert.equal(mhoOutside.pickup, false);
    assert.equal(mhoOutside.trip, false, "Expected 21P Mho not to trip for out-of-zone load");

    // 4. SV_TIMER (SELogic Pickup / Dropout Timer): SV1PU = 0.1 s, SV1DO = 0.05 s
    const sv = instantiateSelWasmElement({
      elementType: "SV_TIMER",
      id: "SV1T",
      params: { pickupDelaySec: 0.1, dropoutDelaySec: 0.05 },
    });
    assert.ok(sv, "Expected SV_TIMER WASM instance");
    sv.init();
    assert.equal(sv.evalStep(0.04, 0.04, { logicIn: true }).trip, false, "Should not assert before pickup delay");
    assert.equal(sv.evalStep(0.08, 0.04, { logicIn: true }).trip, false, "Should not assert at 0.08 s < 0.10 s");
    assert.equal(sv.evalStep(0.12, 0.04, { logicIn: true }).trip, true, "Should assert once pickup delay elapses");
    // Input drops out — output should hold during 0.05 s dropout delay
    assert.equal(sv.evalStep(0.15, 0.03, { logicIn: false }).trip, true, "Should hold during dropout delay");
    assert.equal(sv.evalStep(0.18, 0.03, { logicIn: false }).trip, false, "Should drop out after 0.06 s >= 0.05 s");

    // 5. EL_87T (Transformer Differential with 2nd harmonic inrush blocking)
    const diff87t = instantiateSelWasmElement({
      elementType: "EL_87T",
      id: "87T1",
      params: { pickup: 0.3, slope1Pct: 25.0, harm2BlockPct: 15.0 },
    });
    assert.ok(diff87t, "Expected EL_87T WASM instance");
    diff87t.init();
    // High differential with 20% 2nd harmonic inrush -> blocked
    const inrush = diff87t.evalStep(0.01, 0.01, { iDiff: 1.2, iRest: 1.0, auxIn: 20.0 });
    assert.equal(inrush.pickup, true);
    assert.equal(inrush.trip, false, "Expected 87T to block on 20% 2nd harmonic inrush");
    // Internal fault with 2% 2nd harmonic -> trip
    const internalFault = diff87t.evalStep(0.02, 0.01, { iDiff: 1.2, iRest: 1.0, auxIn: 2.0 });
    assert.equal(internalFault.trip, true, "Expected 87T to trip on internal fault");
  });

  it("projects and links an FMI 2.0/3.0 vendor relay FMU alongside cleanroom SEL elements", () => {
    const proj = fmuToSelSettings(
      {
        modelName: "VendorDistanceRelayFmu",
        variables: [
          { name: "z1p", causality: "parameter", type: "Real", valueReference: 1, start: 4.5 },
          { name: "z_real", causality: "input", type: "Real", valueReference: 2 },
          { name: "trip", causality: "output", type: "Boolean", valueReference: 3 },
        ],
      },
      "LINE_421",
      1,
    );
    assert.ok(proj.selSettingsBlock.includes("VendorDistanceRelayFmu"));
    assert.ok(proj.selSettingsBlock.includes("Z1P := 4.5"));
    assert.deepEqual(proj.parameterNames, ["z1p"]);

    const fmuInst = createFmuSelInstance("FMU_21P", proj.relayId, proj.modelName, (_t, _dt, io) => {
      const zMag = Math.hypot(io.zReal ?? 0, io.zImag ?? 0);
      const trippable = zMag > 0 && zMag < 4.5;
      return { pickup: trippable, trip: trippable, operateTimeSec: trippable ? 0.016 : -1.0 };
    });
    const out = fmuInst.evalStep(0.01, 0.01, { zReal: 1.0, zImag: 2.0 });
    assert.equal(out.trip, true);
    assert.equal(out.operateTimeSec, 0.016);
  });
});

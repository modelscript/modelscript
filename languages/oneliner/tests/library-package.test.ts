// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ONELINER_MODEL_SPECS,
  createFmuOneLinerInstance,
  fmuToOneLinerRecord,
  getOneLinerSchemasFromLibraries,
  instantiateOneLinerWasmModel,
  lookupOneLinerModelSchema,
  registerBuiltInOneLinerLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/oneliner-std-lib");

describe("@modelscript/oneliner — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/oneliner-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected oneliner-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/oneliner-std-lib");
    assert.equal(pkg.manifest.language, "oneliner");
    assert.equal(pkg.symbols.length, ONELINER_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, ONELINER_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & public provenance citations on every registered model
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
    registerBuiltInOneLinerLibrarySync();
    const schemas = getOneLinerSchemasFromLibraries();
    assert.ok(schemas.length >= ONELINER_MODEL_SPECS.length);

    assert.equal(lookupOneLinerModelSchema("oc_ieee_vi")?.name, "OC_IEEE_VI");
    assert.equal(lookupOneLinerModelSchema("IEC_Standard_Inverse")?.name, "OC_IEC_SI");
    assert.equal(lookupOneLinerModelSchema("21_mho_z1")?.name, "DIST_MHO_Z1");
    assert.equal(lookupOneLinerModelSchema("87t")?.name, "DIFF_87T");
    assert.equal(lookupOneLinerModelSchema("YNd1")?.name, "XFMR_YND1");
  });

  it("evaluates OC_IEEE_VI, OC_IEC_SI, DIST_MHO_Z1, DIFF_87T, DIST_QUAD_Z1, and DIR_67P in runtime.wasm", () => {
    // 1. OC_IEEE_VI: t = TD * (19.61 / (M^2 - 1) + 0.491)
    // With pickupA = 600, timeDial = 2.0, iFaultA = 3000 => M = 5 => t = 2.0 * (19.61 / 24 + 0.491)
    const ocVi = instantiateOneLinerWasmModel({
      modelType: "OC_IEEE_VI",
      params: { pickupA: 600, timeDial: 2.0 },
    });
    assert.ok(ocVi, "Expected OC_IEEE_VI WASM instance");
    ocVi.init();
    const ocViOut = ocVi.evaluate({ iFaultA: 3000 });
    const expectedVi = 2.0 * (19.61 / (5 * 5 - 1) + 0.491);
    assert.equal(ocViOut.tripped, true);
    assert.ok(
      Math.abs(ocViOut.tripTimeSec - expectedVi) < 1e-6,
      `Expected OC_IEEE_VI trip time ${expectedVi}, got ${ocViOut.tripTimeSec}`,
    );
    const ocViNoTrip = ocVi.evaluate({ iFaultA: 500 });
    assert.equal(ocViNoTrip.tripped, false);

    // 2. OC_IEC_SI: t = TMS * (0.14 / (M^0.02 - 1))
    // With pickupA = 500, timeDial = 0.4, iFaultA = 2500 => M = 5
    const ocIec = instantiateOneLinerWasmModel({
      modelType: "OC_IEC_SI",
      params: { pickupA: 500, timeDial: 0.4 },
    });
    assert.ok(ocIec, "Expected OC_IEC_SI WASM instance");
    ocIec.init();
    const ocIecOut = ocIec.evaluate({ iFaultA: 2500 });
    const expectedIec = 0.4 * (0.14 / (Math.pow(5, 0.02) - 1));
    assert.equal(ocIecOut.tripped, true);
    assert.ok(
      Math.abs(ocIecOut.tripTimeSec - expectedIec) < 1e-6,
      `Expected OC_IEC_SI trip time ${expectedIec}, got ${ocIecOut.tripTimeSec}`,
    );

    // 3. DIST_MHO_Z1: |Z - Zr/2| <= |Zr|/2 with reach = 10 Ohm @ 75 deg
    const mho = instantiateOneLinerWasmModel({
      modelType: "DIST_MHO_Z1",
      params: { reachOhms: 10.0, mtaDeg: 75.0, delaySec: 0.02 },
    });
    assert.ok(mho, "Expected DIST_MHO_Z1 WASM instance");
    mho.init();
    const rad75 = (75 * Math.PI) / 180;
    // Fault at 60% of reach along MTA => inside mho circle
    const mhoIn = mho.evaluate({ rOhms: 6.0 * Math.cos(rad75), xOhms: 6.0 * Math.sin(rad75) });
    assert.equal(mhoIn.tripped, true);
    assert.ok(Math.abs(mhoIn.tripTimeSec - 0.02) < 1e-9);
    // Fault at 120% of reach => outside mho circle
    const mhoOut = mho.evaluate({ rOhms: 12.0 * Math.cos(rad75), xOhms: 12.0 * Math.sin(rad75) });
    assert.equal(mhoOut.tripped, false);

    // 4. DIFF_87T: Dual-slope percentage restraint + 2nd-harmonic inrush blocking
    const diff87t = instantiateOneLinerWasmModel({
      modelType: "DIFF_87T",
      params: { iPickupPu: 0.3, slope1Pct: 25.0, slope2Pct: 50.0, breakpointPu: 2.0, harm2BlockPct: 15.0 },
    });
    assert.ok(diff87t, "Expected DIFF_87T WASM instance");
    diff87t.init();
    // Internal fault: Iop = 1.2 pu, Irest = 1.5 pu => thresh = max(0.3, 0.25*1.5=0.375) => TRIP
    const diffTrip = diff87t.evaluate({ iOpPu: 1.2, iRestPu: 1.5, harm2Pct: 4.0 });
    assert.equal(diffTrip.tripped, true);
    // External fault: Iop = 0.4 pu, Irest = 3.0 pu => thresh = 0.25*2.0 + 0.50*1.0 = 1.0 pu => RESTRAIN
    const diffRestrain = diff87t.evaluate({ iOpPu: 0.4, iRestPu: 3.0, harm2Pct: 2.0 });
    assert.equal(diffRestrain.tripped, false);
    // Magnetizing inrush: Iop = 1.2 pu, Irest = 1.5 pu, 2nd harmonic = 22% >= 15% => BLOCKED
    const diffInrush = diff87t.evaluate({ iOpPu: 1.2, iRestPu: 1.5, harm2Pct: 22.0 });
    assert.equal(diffInrush.tripped, false);

    // 5. DIST_QUAD_Z1: Quadrilateral R/X check
    const quad = instantiateOneLinerWasmModel({
      modelType: "DIST_QUAD_Z1",
      params: { xReachOhms: 10.0, rReachOhms: 6.0, delaySec: 0.02 },
    });
    assert.ok(quad);
    quad.init();
    assert.equal(quad.evaluate({ rOhms: 4.0, xOhms: 8.0 }).tripped, true);
    assert.equal(quad.evaluate({ rOhms: 7.5, xOhms: 8.0 }).tripped, false);

    // 6. DIR_67P: Directional torque angle supervision
    const dir67 = instantiateOneLinerWasmModel({
      modelType: "DIR_67P",
      params: { pickupA: 500, timeDial: 1.0, mtaDeg: -45, halfAngleDeg: 85 },
    });
    assert.ok(dir67);
    dir67.init();
    assert.equal(dir67.evaluate({ iFaultA: 2000, angleDeg: -40 }).tripped, true);
    assert.equal(dir67.evaluate({ iFaultA: 2000, angleDeg: 135 }).tripped, false);
  });

  it("projects and links an FMI 2.0/3.0 user-defined protection FMU via USER_RELAY", () => {
    const proj = fmuToOneLinerRecord(
      {
        modelName: "VendorDistanceFmu",
        variables: [
          { name: "z1Reach", causality: "parameter", type: "Real", valueReference: 1, start: 10.5 },
          { name: "rOhms", causality: "input", type: "Real", valueReference: 2 },
          { name: "xOhms", causality: "input", type: "Real", valueReference: 3 },
          { name: "tripped", causality: "output", type: "Boolean", valueReference: 4 },
        ],
      },
      "BUS_138",
      "LINE_1",
      "REL_FMU_1",
    );
    assert.ok(proj.olxRecord.includes("USER_RELAY"));
    assert.ok(proj.olxRecord.includes("VendorDistanceFmu"));
    assert.deepEqual(proj.parameterNames, ["z1Reach"]);

    const fmuInst = createFmuOneLinerInstance("REL_FMU_1", "BUS_138", "LINE_1", proj.modelName, (input) => {
      const z = Math.hypot(input.rOhms ?? 0, input.xOhms ?? 0);
      return z <= 10.5 ? { tripped: true, tripTimeSec: 0.018 } : { tripped: false, tripTimeSec: 1e9 };
    });
    const out = fmuInst.evaluate({ rOhms: 2.0, xOhms: 6.0 });
    assert.equal(out.tripped, true);
    assert.ok(Math.abs(out.tripTimeSec - 0.018) < 1e-9);
  });
});

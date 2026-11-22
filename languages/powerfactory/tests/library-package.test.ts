// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  POWERFACTORY_MODEL_SPECS,
  PowerFactoryTocCurve,
  createFmuPowerFactoryInstance,
  evalPowerFactoryTocTripTime,
  fmuToPowerFactoryDsl,
  getPowerFactorySchemasFromLibraries,
  instantiatePowerFactoryWasmModel,
  lookupPowerFactoryModelSchema,
  registerBuiltInPowerFactoryLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/powerfactory-std-lib");

describe("@modelscript/powerfactory — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/powerfactory-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected powerfactory-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/powerfactory-std-lib");
    assert.equal(pkg.manifest.language, "powerfactory");
    assert.equal(pkg.symbols.length, POWERFACTORY_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, POWERFACTORY_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons, ports & public provenance citations on every registered model
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
    registerBuiltInPowerFactoryLibrarySync();
    const schemas = getPowerFactorySchemasFromLibraries();
    assert.ok(schemas.length >= POWERFACTORY_MODEL_SPECS.length);

    assert.equal(lookupPowerFactoryModelSchema("TypLne_OHL_400kV")?.name, "TypLne_OHL_400kV");
    assert.equal(lookupPowerFactoryModelSchema("ST1A")?.name, "vco_ST1A");
    assert.equal(lookupPowerFactoryModelSchema("REGC_A")?.name, "wecc_REGC_A");
    assert.equal(lookupPowerFactoryModelSchema("ANSI_51_IEC")?.name, "rel_TOC_IEC");
    assert.equal(lookupPowerFactoryModelSchema("ANSI_81")?.name, "rel_UFLS_81");
  });

  it("initializes flat-start equilibrium (< 1e-6) and steps core DSL & machine models in runtime.wasm", () => {
    const baseIo = {
      eterm: 1.0,
      speedDev: 0.0,
      efd: 1.5,
      pmech: 0.8,
      pelec: 0.8,
      qelec: 0.2,
      freqHz: 50.0,
      iMeas: 0.5,
      pref: 0.8,
    };

    // 1. Synchronous machine (TypSym_Thermal): exact flat-start residual < 1e-6
    const sym = instantiatePowerFactoryWasmModel({ modelType: "TypSym_Thermal", name: "G1" });
    assert.ok(sym, "Expected TypSym_Thermal WASM instance");
    sym.init(baseIo);
    assert.ok(
      sym.checkFlatStart() < 1e-6,
      `Expected TypSym_Thermal flat-start residual < 1e-6, got ${sym.checkFlatStart()}`,
    );

    // 2. Exciter (vco_ST1A): flat-start < 1e-6, boosts efd on terminal voltage dip
    const exc = instantiatePowerFactoryWasmModel({ modelType: "vco_ST1A", name: "AVR1" });
    assert.ok(exc, "Expected vco_ST1A WASM instance");
    exc.init(baseIo);
    assert.ok(exc.checkFlatStart() < 1e-6, `Expected vco_ST1A flat-start residual < 1e-6, got ${exc.checkFlatStart()}`);
    const excDrop = exc.doStep(0.02, 0.02, { ...baseIo, eterm: 0.92 });
    assert.ok(excDrop.efd > baseIo.efd, `Expected vco_ST1A to boost efd on voltage dip, got ${excDrop.efd}`);

    // 3. Governor (gov_HYGOV): flat-start < 1e-6, reduces pmech on overspeed
    const gov = instantiatePowerFactoryWasmModel({ modelType: "gov_HYGOV", name: "GOV1" });
    assert.ok(gov, "Expected gov_HYGOV WASM instance");
    gov.init(baseIo);
    assert.ok(
      gov.checkFlatStart() < 1e-6,
      `Expected gov_HYGOV flat-start residual < 1e-6, got ${gov.checkFlatStart()}`,
    );
    let govOut = gov.doStep(0.05, 0.05, { ...baseIo, speedDev: 0.01 });
    for (let k = 1; k < 20; k++) {
      govOut = gov.doStep(0.05 * (k + 1), 0.05, { ...baseIo, speedDev: 0.01 });
    }
    assert.ok(govOut.pmech < baseIo.pmech, `Expected gov_HYGOV to reduce pmech on overspeed, got ${govOut.pmech}`);

    // 4. WECC IBR (wecc_REGC_A): flat-start < 1e-6, reduces active current under LVPL voltage sag
    const ibr = instantiatePowerFactoryWasmModel({ modelType: "wecc_REGC_A", name: "PV1" });
    assert.ok(ibr, "Expected wecc_REGC_A WASM instance");
    ibr.init(baseIo);
    assert.ok(
      ibr.checkFlatStart() < 1e-6,
      `Expected wecc_REGC_A flat-start residual < 1e-6, got ${ibr.checkFlatStart()}`,
    );
    let ibrOut = ibr.doStep(0.01, 0.01, { ...baseIo, eterm: 0.75 });
    for (let k = 1; k < 10; k++) {
      ibrOut = ibr.doStep(0.01 * (k + 1), 0.01, { ...baseIo, eterm: 0.75 });
    }
    assert.ok(ibrOut.irInj < 0.85, `Expected LVPL active current reduction on sag, got ${ibrOut.irInj}`);

    // 5. UFLS Relay (rel_UFLS_81): flat-start < 1e-6, sheds load below 49.0 Hz
    const ufls = instantiatePowerFactoryWasmModel({ modelType: "rel_UFLS_81", name: "UFLS1" });
    assert.ok(ufls, "Expected rel_UFLS_81 WASM instance");
    ufls.init(baseIo);
    assert.ok(
      ufls.checkFlatStart() < 1e-6,
      `Expected rel_UFLS_81 flat-start residual < 1e-6, got ${ufls.checkFlatStart()}`,
    );
    let uflsOut = ufls.doStep(0.05, 0.05, { ...baseIo, freqHz: 48.7 });
    for (let k = 1; k < 10; k++) {
      uflsOut = ufls.doStep(0.05 * (k + 1), 0.05, { ...baseIo, freqHz: 48.7 });
    }
    assert.ok(uflsOut.tripMult < 1.0, `Expected rel_UFLS_81 to shed load below 49.0 Hz, got ${uflsOut.tripMult}`);
  });

  it("evaluates IEC 60255 & IEEE C37.112 inverse-time overcurrent curves and trips rel_TOC_IEC in runtime.wasm", () => {
    // Verify analytical IEC 60255-151 Standard Inverse at M=5, TMS=0.2: 0.2 * 0.14 / (5^0.02 - 1)
    const iecSiExpected = 0.2 * (0.14 / (Math.pow(5.0, 0.02) - 1.0));
    const iecSiActual = evalPowerFactoryTocTripTime(PowerFactoryTocCurve.IEC_STANDARD_INVERSE, 5.0, 0.2);
    assert.ok(
      Math.abs(iecSiActual - iecSiExpected) < 1e-9,
      `Expected IEC SI trip time ${iecSiExpected}, got ${iecSiActual}`,
    );

    // Verify IEC Very Inverse at M=4, TMS=0.5: 0.5 * 13.5 / (4 - 1) = 2.25 s
    const iecViActual = evalPowerFactoryTocTripTime(PowerFactoryTocCurve.IEC_VERY_INVERSE, 4.0, 0.5);
    assert.ok(Math.abs(iecViActual - 2.25) < 1e-9, `Expected IEC VI trip time 2.25, got ${iecViActual}`);

    // Verify IEEE C37.112 Extremely Inverse at M=5, TD=1.0: 28.2 / (25 - 1) + 0.1217 = 1.2967 s
    const ieeeEiExpected = 28.2 / 24.0 + 0.1217;
    const ieeeEiActual = evalPowerFactoryTocTripTime(PowerFactoryTocCurve.IEEE_EXTREMELY_INVERSE, 5.0, 1.0);
    assert.ok(
      Math.abs(ieeeEiActual - ieeeEiExpected) < 1e-9,
      `Expected IEEE EI trip time ${ieeeEiExpected}, got ${ieeeEiActual}`,
    );

    // Below pickup returns Infinity (non-tripping)
    assert.equal(evalPowerFactoryTocTripTime(PowerFactoryTocCurve.IEC_STANDARD_INVERSE, 0.9, 0.2), Infinity);

    // Dynamic relay stepping: rel_TOC_IEC with ipickup=1.2, tms=0.1, fault current 6.0 pu (M=5 -> ~0.428 s)
    const toc = instantiatePowerFactoryWasmModel({
      modelType: "rel_TOC_IEC",
      name: "OC51_Feeder1",
      params: { ipickup: 1.2, tms: 0.1, curveType: PowerFactoryTocCurve.IEC_STANDARD_INVERSE },
    });
    assert.ok(toc, "Expected rel_TOC_IEC WASM instance");
    const normalIo = { eterm: 1.0, speedDev: 0.0, efd: 1.5, pmech: 0.8, iMeas: 0.8 };
    toc.init(normalIo);
    assert.ok(toc.checkFlatStart() < 1e-6);

    let tocOut = toc.doStep(0.05, 0.05, { ...normalIo, iMeas: 6.0 });
    for (let k = 1; k < 15; k++) {
      tocOut = toc.doStep(0.05 * (k + 1), 0.05, { ...normalIo, iMeas: 6.0 });
    }
    assert.equal(tocOut.tripMult, 0.0, `Expected rel_TOC_IEC to trip under 5x fault current, got ${tocOut.tripMult}`);
  });

  it("projects and links an FMI 2.0/3.0 vendor FMU via PowerFactory BlkDef/ElmDsl wrapper", () => {
    const proj = fmuToPowerFactoryDsl({
      modelName: "VendorGridFormingInverter",
      variables: [
        { name: "kDroop", causality: "parameter", type: "Real", valueReference: 1, start: 0.04 },
        { name: "ut", causality: "input", type: "Real", valueReference: 2 },
        { name: "speed", causality: "input", type: "Real", valueReference: 3 },
        { name: "pt", causality: "output", type: "Real", valueReference: 4 },
      ],
    });
    assert.ok(proj.dslBlock.includes("BlkDef VendorGridFormingInverter"));
    assert.ok(proj.dslBlock.includes('external_fmu "VendorGridFormingInverter"'));
    assert.deepEqual(proj.parameterNames, ["kDroop"]);

    const fmuInst = createFmuPowerFactoryInstance("GFM_1", proj.modelName, (_t, _dt, io) => ({
      pmech: io.pmech - 25.0 * io.speedDev,
    }));
    const out = fmuInst.doStep(0.02, 0.02, { eterm: 1.0, speedDev: 0.002, efd: 1.5, pmech: 0.8 });
    assert.ok(Math.abs(out.pmech - 0.75) < 1e-9);
  });
});

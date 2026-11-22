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
  assessPowerFactoryCables,
  createFmuPowerFactoryInstance,
  evalPowerFactoryTocTripTime,
  fmuToPowerFactoryDsl,
  getPowerFactorySchemasFromLibraries,
  instantiatePowerFactoryWasmModel,
  lookupPowerFactoryModelSchema,
  lowerPowerFactoryToDae,
  registerBuiltInPowerFactoryLibrarySync,
  type PowerFactoryModel,
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

    // 3. Governor (gov_HYGOV): flat-start < 1e-6, reduces pmech on overspeed (after Tw water-hammer transient)
    const gov = instantiatePowerFactoryWasmModel({ modelType: "gov_HYGOV", name: "GOV1" });
    assert.ok(gov, "Expected gov_HYGOV WASM instance");
    gov.init(baseIo);
    assert.ok(
      gov.checkFlatStart() < 1e-6,
      `Expected gov_HYGOV flat-start residual < 1e-6, got ${gov.checkFlatStart()}`,
    );
    let govOut = gov.doStep(0.05, 0.05, { ...baseIo, speedDev: 0.01 });
    for (let k = 1; k < 60; k++) {
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

  it("automatically registers stdlib and resolves equipment defaults in DAE lowering and cable assessment", () => {
    const model: PowerFactoryModel = {
      name: "AutoCatalogGrid",
      substations: new Map(),
      bays: new Map(),
      terminals: new Map([
        ["T1", { id: "T1", loc_name: "Bus1", uknom: 0, fnom: 50 }],
        ["T2", { id: "T2", loc_name: "Bus2", uknom: 110, fnom: 50 }],
      ]),
      lineTypes: new Map(),
      lines: new Map([
        ["L1", { id: "L1", loc_name: "Cable1", bus1Id: "T1", bus2Id: "T2", dline: 2.0, typId: "TypLne_OHL_110kV" }],
      ]),
      transformer2wTypes: new Map(),
      transformers2w: new Map(),
      transformer3wTypes: new Map(),
      transformers3w: new Map(),
      generatorTypes: new Map(),
      generators: new Map([
        ["G1", { id: "G1", loc_name: "Gen1", bus1Id: "T1", pgini: 50, qgini: 10, usetp: 0, typId: "TypSym_Thermal" }],
      ]),
      staticGenerators: new Map(),
      loads: new Map(),
      shunts: new Map(),
      switches: new Map(),
      graphics: new Map(),
      desktops: new Map(),
    };

    const dae = lowerPowerFactoryToDae(model);
    assert.ok(globalLibraryRegistry.getPackagesForLanguage("powerfactory").length > 0);
    assert.notEqual(dae.lookupVariable("U_T1_nom"), -1);
    assert.notEqual(dae.lookupVariable("U_set_G1"), -1);

    const cables = assessPowerFactoryCables(model);
    assert.equal(cables.length, 1);
    assert.ok(cables[0]!.ratedContinuousAmpacityA > 0);
  });

  it("verifies full-order IEEE/WECC fidelity: 6-state TypSym_Thermal fault, gov_HYGOV water hammer, vco_ST1A lead-lag/rate-feedback, vco_EXAC1, pss_PSS2A", () => {
    const baseIo = {
      eterm: 1.0,
      speedDev: 0.0,
      efd: 1.5,
      pmech: 0.8,
      pelec: 0.8,
      qelec: 0.2,
      vr: 1.0,
      vi: 0.0,
      freqHz: 50.0,
      iMeas: 0.5,
      pref: 0.8,
    };

    // 1. 6-state TypSym_Thermal: exact flat-start < 1e-6 and subtransient 3-phase fault current surge
    const sym = instantiatePowerFactoryWasmModel({ modelType: "TypSym_Thermal", name: "G_Thermal" });
    assert.ok(sym, "Expected TypSym_Thermal WASM instance");
    const nSymStates = sym.init(baseIo);
    assert.equal(nSymStates, 6, `Expected 6 dynamic states for TypSym_Thermal, got ${nSymStates}`);
    assert.ok(
      sym.checkFlatStart() < 1e-6,
      `Expected TypSym_Thermal flat-start residual < 1e-6, got ${sym.checkFlatStart()}`,
    );
    const preFault = sym.doStep(0.005, 0.005, baseIo);
    const iPre = Math.hypot(preFault.irInj, preFault.iiInj);
    const faultOut = sym.doStep(0.01, 0.005, { ...baseIo, eterm: 0.25, vr: 0.25, vi: 0.0 });
    const iFault = Math.hypot(faultOut.irInj, faultOut.iiInj);
    assert.ok(
      iFault > iPre * 2.5,
      `Expected subtransient fault current surge (>2.5x pre-fault), got ${iFault} vs ${iPre}`,
    );
    assert.ok(faultOut.pelec < baseIo.pmech, `Expected electrical power drop during fault, got ${faultOut.pelec}`);

    // 2. gov_HYGOV: non-minimum-phase water-hammer inverse response on step frequency drop (dw = -0.01)
    const gov = instantiatePowerFactoryWasmModel({ modelType: "gov_HYGOV", name: "HYGOV_1" });
    assert.ok(gov, "Expected gov_HYGOV WASM instance");
    assert.equal(gov.init(baseIo), 4);
    assert.ok(gov.checkFlatStart() < 1e-6);
    let minPmech = baseIo.pmech;
    let finalPmech = baseIo.pmech;
    for (let k = 0; k < 120; k++) {
      const out = gov.doStep(0.05 * (k + 1), 0.05, { ...baseIo, speedDev: -0.01 });
      if (k < 15 && out.pmech < minPmech) minPmech = out.pmech;
      finalPmech = out.pmech;
    }
    assert.ok(
      minPmech < baseIo.pmech - 0.005,
      `Expected gov_HYGOV initial water-hammer inverse dip below ${baseIo.pmech}, got min=${minPmech}`,
    );
    assert.ok(
      finalPmech > baseIo.pmech + 0.01,
      `Expected gov_HYGOV steady rise above ${baseIo.pmech} after water accelerates, got final=${finalPmech}`,
    );

    // 3. vco_ST1A: lead-lag & rate-feedback damping (kf > 0 vs kf = 0)
    const excNoFb = instantiatePowerFactoryWasmModel({
      modelType: "vco_ST1A",
      name: "AVR_NoFb",
      params: { kf: 0.0, tf: 1.0 },
    });
    const excWithFb = instantiatePowerFactoryWasmModel({
      modelType: "vco_ST1A",
      name: "AVR_WithFb",
      params: { kf: 0.08, tf: 1.0 },
    });
    assert.ok(excNoFb && excWithFb);
    assert.equal(excNoFb.init(baseIo), 4);
    assert.equal(excWithFb.init(baseIo), 4);
    assert.ok(excNoFb.checkFlatStart() < 1e-6);
    assert.ok(excWithFb.checkFlatStart() < 1e-6);
    let efdNoFb = baseIo.efd;
    let efdWithFb = baseIo.efd;
    for (let k = 0; k < 10; k++) {
      efdNoFb = excNoFb.doStep(0.01 * (k + 1), 0.01, { ...baseIo, eterm: 0.94 }).efd;
      efdWithFb = excWithFb.doStep(0.01 * (k + 1), 0.01, { ...baseIo, eterm: 0.94 }).efd;
    }
    assert.ok(efdNoFb > baseIo.efd && efdWithFb > baseIo.efd);
    assert.ok(
      efdWithFb < efdNoFb,
      `Expected rate feedback (kf=0.08) to damp vco_ST1A efd excursion (${efdWithFb} < ${efdNoFb})`,
    );

    // 4. vco_EXAC1 (AC1A with F_EX), vco_EXDC1, gov_TGOV1, pss_PSS2A
    const ac1a = instantiatePowerFactoryWasmModel({ modelType: "vco_EXAC1", name: "AVR_AC1A" });
    const dc1a = instantiatePowerFactoryWasmModel({ modelType: "vco_EXDC1", name: "AVR_DC1A" });
    const tgov = instantiatePowerFactoryWasmModel({ modelType: "gov_TGOV1", name: "GOV_TGOV1" });
    const pss = instantiatePowerFactoryWasmModel({ modelType: "pss_PSS2A", name: "PSS_2A" });
    assert.ok(ac1a && dc1a && tgov && pss);
    assert.equal(ac1a.init(baseIo), 5);
    assert.equal(dc1a.init(baseIo), 5);
    assert.equal(tgov.init(baseIo), 2);
    assert.equal(pss.init(baseIo), 4);
    assert.ok(ac1a.checkFlatStart() < 1e-6);
    assert.ok(dc1a.checkFlatStart() < 1e-6);
    assert.ok(tgov.checkFlatStart() < 1e-6);
    assert.ok(pss.checkFlatStart() < 1e-6);

    const pssStep = pss.doStep(0.02, 0.02, { ...baseIo, speedDev: 0.005 });
    assert.ok(pssStep.vsPss > 0 && pssStep.vsPss <= 0.1, `Expected bounded pss_PSS2A output, got ${pssStep.vsPss}`);
  });
});

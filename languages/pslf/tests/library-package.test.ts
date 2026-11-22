// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PSLF_MODEL_SPECS,
  bindPslfDynamicModelsToWasm,
  createFmuPslfInstance,
  fmuToPslfDyd,
  getPslfSchemasFromLibraries,
  instantiatePslfWasmModel,
  lookupPslfModelSchema,
  registerBuiltInPslfLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/pslf-std-lib");

describe("@modelscript/pslf — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/pslf-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected pslf-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/pslf-std-lib");
    assert.equal(pkg.manifest.language, "pslf");
    assert.equal(pkg.symbols.length, PSLF_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, PSLF_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & provenance metadata on every registered model
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
    registerBuiltInPslfLibrarySync();
    const schemas = getPslfSchemasFromLibraries();
    assert.ok(schemas.length >= PSLF_MODEL_SPECS.length);

    assert.equal(lookupPslfModelSchema("GENROU")?.name, "genrou");
    assert.equal(lookupPslfModelSchema("ESST1A")?.name, "exst1");
    assert.equal(lookupPslfModelSchema("REGC_A")?.name, "regc_a");
    assert.equal(lookupPslfModelSchema("CMPLDW")?.name, "cmpldw");
  });

  it("initializes flat-start equilibrium and steps core IEEE/WECC models in runtime.wasm", () => {
    const baseIo = {
      eterm: 1.0,
      speedDev: 0.0,
      efd: 1.5,
      pmech: 0.8,
      pelec: 0.8,
      qelec: 0.2,
      freqHz: 60.0,
      pref: 0.8,
    };

    // 1. Exciter (exst1): flat-start residual ~ 0, then boosts efd when terminal voltage drops
    const exc = instantiatePslfWasmModel({ modelType: "exst1", busNumber: 1, id: "1", baseKv: 20, params: [] });
    assert.ok(exc, "Expected exst1 WASM instance");
    exc.init(baseIo);
    assert.ok(exc.checkFlatStart() < 1e-6, `Expected exst1 flat-start residual < 1e-6, got ${exc.checkFlatStart()}`);
    const excDrop = exc.doStep(0.02, 0.02, { ...baseIo, eterm: 0.92 });
    assert.ok(excDrop.efd > baseIo.efd, `Expected exst1 to boost efd on voltage dip, got ${excDrop.efd}`);

    // 2. Governor (hygov): flat-start residual ~ 0, then reduces pmech on overspeed (after Tw water-hammer transient)
    const gov = instantiatePslfWasmModel({ modelType: "hygov", busNumber: 1, id: "1", baseKv: 20, params: [] });
    assert.ok(gov, "Expected hygov WASM instance");
    gov.init(baseIo);
    assert.ok(gov.checkFlatStart() < 1e-6, `Expected hygov flat-start residual < 1e-6, got ${gov.checkFlatStart()}`);
    let govOut = gov.doStep(0.05, 0.05, { ...baseIo, speedDev: 0.01 });
    for (let k = 1; k < 60; k++) {
      govOut = gov.doStep(0.05 * (k + 1), 0.05, { ...baseIo, speedDev: 0.01 });
    }
    assert.ok(govOut.pmech < baseIo.pmech, `Expected hygov to reduce pmech on overspeed, got ${govOut.pmech}`);

    // 3. Renewable converter (regc_a): injects reactive current on voltage sag
    const ibr = instantiatePslfWasmModel({ modelType: "regc_a", busNumber: 2, id: "1", baseKv: 34.5, params: [] });
    assert.ok(ibr, "Expected regc_a WASM instance");
    ibr.init(baseIo);
    let ibrOut = ibr.doStep(0.01, 0.01, { ...baseIo, eterm: 0.8 });
    for (let k = 1; k < 10; k++) {
      ibrOut = ibr.doStep(0.01 * (k + 1), 0.01, { ...baseIo, eterm: 0.8 });
    }
    assert.ok(ibrOut.irInj < 0.85, `Expected LVPL active current reduction on voltage sag, got ${ibrOut.irInj}`);

    // 4. UFLS Relay (lshd1): sheds load after sustained under-frequency below 59.3 Hz
    const relay = instantiatePslfWasmModel({ modelType: "lshd1", busNumber: 3, id: "1", baseKv: 138, params: [] });
    assert.ok(relay, "Expected lshd1 WASM instance");
    relay.init(baseIo);
    let relayOut = relay.doStep(0.05, 0.05, { ...baseIo, freqHz: 59.0 });
    for (let k = 1; k < 10; k++) {
      relayOut = relay.doStep(0.05 * (k + 1), 0.05, { ...baseIo, freqHz: 59.0 });
    }
    assert.ok(relayOut.tripMult < 1.0, `Expected lshd1 to shed load below 59.3 Hz, got tripMult=${relayOut.tripMult}`);
  });

  it("projects and links an FMI 2.0/3.0 user-defined FMU via epcmod", () => {
    const proj = fmuToPslfDyd(
      {
        modelName: "VendorGovernorFmu",
        variables: [
          { name: "droop", causality: "parameter", type: "Real", valueReference: 1, start: 0.04 },
          { name: "dw", causality: "input", type: "Real", valueReference: 2 },
          { name: "pmech", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      10,
      "1",
      230.0,
    );
    assert.ok(proj.dydRecord.includes("epcmod"));
    assert.ok(proj.dydRecord.includes("VendorGovernorFmu"));

    const fmuInst = createFmuPslfInstance(10, "1", proj.modelName, (_t, _dt, io) => ({
      pmech: io.pmech - 25.0 * io.speedDev,
    }));
    const out = fmuInst.doStep(0.02, 0.02, { eterm: 1.0, speedDev: 0.002, efd: 1.5, pmech: 0.8 });
    assert.ok(Math.abs(out.pmech - 0.75) < 1e-9);
  });

  it("automatically dispatches parsed .dyd models via bindPslfDynamicModelsToWasm and separates unmodeled types", () => {
    const binding = bindPslfDynamicModelsToWasm([
      { modelType: "exst1", busNumber: 1, id: "1", baseKv: 20, params: [] },
      { modelType: "hygov", busNumber: 1, id: "1", baseKv: 20, params: [] },
      { modelType: "custom_unmodeled_xyz", busNumber: 2, id: "1", baseKv: 138, params: [1.0, 2.0] },
    ]);

    assert.ok(globalLibraryRegistry.getPackagesForLanguage("pslf").length > 0);
    assert.equal(binding.resolved.length, 2);
    assert.equal(binding.unmodeled.length, 1);
    assert.equal(binding.unmodeled[0]?.modelType, "custom_unmodeled_xyz");

    const exc = binding.resolved.find((r) => r.modelType === "exst1");
    assert.ok(exc);
    exc.init({ eterm: 1.0, speedDev: 0.0, efd: 1.5, pmech: 0.8 });
    assert.ok(exc.checkFlatStart() < 1e-6);
  });

  it("verifies full-order IEEE/WECC fidelity: 6-state genrou fault, hygov water hammer, exst1 lead-lag/rate-feedback, exac1, pss2a, cmpldw", () => {
    const baseIo = {
      eterm: 1.0,
      speedDev: 0.0,
      efd: 1.5,
      pmech: 0.8,
      pelec: 0.8,
      qelec: 0.2,
      vr: 1.0,
      vi: 0.0,
      freqHz: 60.0,
      pref: 0.8,
    };

    // 1. 6-state genrou: exact flat-start < 1e-6 and subtransient 3-phase fault current surge
    const gen = instantiatePslfWasmModel({ modelType: "genrou", busNumber: 1, id: "1", baseKv: 20, params: [] });
    assert.ok(gen, "Expected genrou WASM instance");
    const nGenStates = gen.init(baseIo);
    assert.equal(nGenStates, 6, `Expected 6 dynamic states for genrou, got ${nGenStates}`);
    assert.ok(gen.checkFlatStart() < 1e-6, `Expected genrou flat-start residual < 1e-6, got ${gen.checkFlatStart()}`);
    const preFault = gen.doStep(0.005, 0.005, baseIo);
    const iPre = Math.hypot(preFault.irInj, preFault.iiInj);
    const faultOut = gen.doStep(0.01, 0.005, { ...baseIo, eterm: 0.25, vr: 0.25, vi: 0.0 });
    const iFault = Math.hypot(faultOut.irInj, faultOut.iiInj);
    assert.ok(
      iFault > iPre * 2.5,
      `Expected subtransient fault current surge (>2.5x pre-fault), got ${iFault} vs ${iPre}`,
    );
    assert.ok(faultOut.pelec < baseIo.pmech, `Expected electrical power drop during fault, got ${faultOut.pelec}`);

    // 2. hygov: non-minimum-phase water-hammer inverse response on step frequency drop (dw = -0.01)
    const gov = instantiatePslfWasmModel({ modelType: "hygov", busNumber: 1, id: "1", baseKv: 20, params: [] });
    assert.ok(gov, "Expected hygov WASM instance");
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
      `Expected hygov initial water-hammer inverse dip below ${baseIo.pmech}, got min=${minPmech}`,
    );
    assert.ok(
      finalPmech > baseIo.pmech + 0.01,
      `Expected hygov steady rise above ${baseIo.pmech} after water accelerates, got final=${finalPmech}`,
    );

    // 3. exst1: lead-lag transient gain reduction & rate-feedback damping (kf > 0 vs kf = 0)
    const excNoFb = instantiatePslfWasmModel({
      modelType: "exst1",
      busNumber: 1,
      id: "1",
      baseKv: 20,
      params: [0.02, 0.5, -0.5, 1.0, 10.0, 200.0, 0.05, 5.0, -4.5, 0.05, 0.0, 1.0],
    });
    const excWithFb = instantiatePslfWasmModel({
      modelType: "exst1",
      busNumber: 1,
      id: "2",
      baseKv: 20,
      params: [0.02, 0.5, -0.5, 1.0, 10.0, 200.0, 0.05, 5.0, -4.5, 0.05, 0.08, 1.0],
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
      `Expected rate feedback (kf=0.08) to damp exst1 efd excursion (${efdWithFb} < ${efdNoFb})`,
    );

    // 4. exac1 (AC1A with F_EX), tgov1, pss2a (dual washout/lead-lag), cmpldw (motor + electronic + ZIP)
    const ac1a = instantiatePslfWasmModel({ modelType: "exac1", busNumber: 1, id: "1", baseKv: 20, params: [] });
    const tgov = instantiatePslfWasmModel({ modelType: "tgov1", busNumber: 1, id: "1", baseKv: 20, params: [] });
    const pss = instantiatePslfWasmModel({ modelType: "pss2a", busNumber: 1, id: "1", baseKv: 20, params: [] });
    const cmpldw = instantiatePslfWasmModel({ modelType: "cmpldw", busNumber: 2, id: "1", baseKv: 138, params: [] });
    assert.ok(ac1a && tgov && pss && cmpldw);
    assert.equal(ac1a.init(baseIo), 5);
    assert.equal(tgov.init(baseIo), 2);
    assert.equal(pss.init(baseIo), 4);
    assert.equal(cmpldw.init(baseIo), 3);
    assert.ok(ac1a.checkFlatStart() < 1e-6);
    assert.ok(tgov.checkFlatStart() < 1e-6);
    assert.ok(pss.checkFlatStart() < 1e-6);
    assert.ok(cmpldw.checkFlatStart() < 1e-6);

    const pssStep = pss.doStep(0.02, 0.02, { ...baseIo, speedDev: 0.005 });
    assert.ok(pssStep.vsPss > 0 && pssStep.vsPss <= 0.1, `Expected bounded pss2a output, got ${pssStep.vsPss}`);
    const loadSag = cmpldw.doStep(0.05, 0.05, { ...baseIo, eterm: 0.55 });
    assert.ok(loadSag.pelec < baseIo.pelec, `Expected cmpldw active load drop on voltage sag, got ${loadSag.pelec}`);
  });
});

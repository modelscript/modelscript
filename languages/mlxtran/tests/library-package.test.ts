// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  MLXTRAN_MODEL_SPECS,
  createFmuMlxtranInstance,
  fmuToMlxtranBlock,
  getMlxtranSchemasFromLibraries,
  instantiateMlxtranWasmModel,
  lookupMlxtranModelSchema,
  registerBuiltInMlxtranLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/mlxtran-std-lib");

describe("@modelscript/mlxtran — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/mlxtran-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected mlxtran-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/mlxtran-std-lib");
    assert.equal(pkg.manifest.language, "mlxtran");
    assert.equal(pkg.symbols.length, MLXTRAN_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, MLXTRAN_MODEL_SPECS.length);
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
    registerBuiltInMlxtranLibrarySync();
    const schemas = getMlxtranSchemasFromLibraries();
    assert.ok(schemas.length >= MLXTRAN_MODEL_SPECS.length);

    assert.equal(lookupMlxtranModelSchema("bolus_1cpt_VCl")?.name, "bolus_1cpt_VCl");
    assert.equal(lookupMlxtranModelSchema("BATEMAN_1CPT")?.name, "oral1_1cpt_kaVCl");
    assert.equal(lookupMlxtranModelSchema("HILL_EMAX")?.name, "pd_sigmoid_emax");
    assert.equal(lookupMlxtranModelSchema("SIMEONI_TGI")?.name, "tgi_simeoni");
    assert.equal(lookupMlxtranModelSchema("TMDD_QSS")?.name, "tmdd_qss");
    assert.equal(lookupMlxtranModelSchema("PKMODEL")?.name, "pkmodel");
  });

  it("evaluates analytical PK, Hill Emax PD, TMDD QSS, and Simeoni TGI models in runtime.wasm", () => {
    // 1. bolus_1cpt_VCl: Cc(t) = (D / V) * exp(-(Cl / V) * t)
    const iv1 = instantiateMlxtranWasmModel("bolus_1cpt_VCl", { V: 10.0, Cl: 2.0 });
    assert.ok(iv1, "Expected bolus_1cpt_VCl WASM instance");
    iv1.init({ dose: 100.0 });
    const ivAt5 = iv1.eval(5.0, 0.0, { dose: 100.0 });
    const expectedIv5 = (100.0 / 10.0) * Math.exp(-(2.0 / 10.0) * 5.0);
    assert.ok(
      Math.abs(ivAt5.concOut - expectedIv5) < 1e-9,
      `Expected bolus_1cpt_VCl Cc(5) = ${expectedIv5}, got ${ivAt5.concOut}`,
    );

    // 2. oral1_1cpt_kaVCl: Bateman equation
    const oral1 = instantiateMlxtranWasmModel("oral1_1cpt_kaVCl", { ka: 1.5, V: 10.0, Cl: 1.0, F: 0.8 });
    assert.ok(oral1, "Expected oral1_1cpt_kaVCl WASM instance");
    oral1.init({ dose: 100.0 });
    const oralAt2 = oral1.eval(2.0, 0.0, { dose: 100.0 });
    const ke = 1.0 / 10.0;
    const expectedOral2 = ((0.8 * 100.0 * 1.5) / (10.0 * (1.5 - ke))) * (Math.exp(-ke * 2.0) - Math.exp(-1.5 * 2.0));
    assert.ok(
      Math.abs(oralAt2.concOut - expectedOral2) < 1e-9,
      `Expected oral1_1cpt_kaVCl Cc(2) = ${expectedOral2}, got ${oralAt2.concOut}`,
    );
    assert.ok(oralAt2.depotOut < 80.0 && oralAt2.depotOut > 0.0, "Expected depot amount to decay over time");

    // 3. pd_sigmoid_emax: Hill Emax at C = EC50 yields E0 + 0.5 * Emax
    const pd = instantiateMlxtranWasmModel("pd_sigmoid_emax", { E0: 10.0, Emax: 90.0, EC50: 5.0, gamma: 2.0 });
    assert.ok(pd, "Expected pd_sigmoid_emax WASM instance");
    pd.init();
    const pdHalf = pd.eval(0.0, 0.0, { concIn: 5.0 });
    assert.ok(Math.abs(pdHalf.effectOut - 55.0) < 1e-9, `Expected E(EC50) = 55, got ${pdHalf.effectOut}`);
    const pdHigh = pd.eval(0.0, 0.0, { concIn: 50.0 });
    assert.ok(
      pdHigh.effectOut > 98.0 && pdHigh.effectOut <= 100.0,
      `Expected near-maximal effect, got ${pdHigh.effectOut}`,
    );

    // 4. tgi_simeoni: Unperturbed tumor grows, drug-treated tumor shrinks relative to control
    const tgiControl = instantiateMlxtranWasmModel("tgi_simeoni", {
      lambda0: 0.2,
      lambda1: 0.5,
      k1: 0.5,
      k2: 0.2,
      w0: 0.1,
      psi: 20.0,
    });
    const tgiTreated = instantiateMlxtranWasmModel("tgi_simeoni", {
      lambda0: 0.2,
      lambda1: 0.5,
      k1: 0.5,
      k2: 0.2,
      w0: 0.1,
      psi: 20.0,
    });
    assert.ok(tgiControl && tgiTreated, "Expected tgi_simeoni WASM instances");
    tgiControl.init();
    tgiTreated.init();
    let wCtrl = 0.1;
    let wTreat = 0.1;
    for (let day = 1; day <= 10; day++) {
      wCtrl = tgiControl.eval(day, 1.0, { concIn: 0.0 }).tumorOut;
      wTreat = tgiTreated.eval(day, 1.0, { concIn: 3.0 }).tumorOut;
    }
    assert.ok(wCtrl > 0.5, `Expected unperturbed Simeoni tumor growth > 0.5 g, got ${wCtrl}`);
    assert.ok(wTreat < wCtrl * 0.5, `Expected treated Simeoni tumor (${wTreat}) << control (${wCtrl})`);

    // 5. bolus_2cpt_VClQVp & tmdd_qss sanity
    const iv2 = instantiateMlxtranWasmModel("bolus_2cpt_VClQVp", { V: 10.0, Cl: 1.0, Q: 2.0, Vp: 20.0 });
    assert.ok(iv2, "Expected bolus_2cpt_VClQVp WASM instance");
    iv2.init({ dose: 100.0 });
    const iv2At0 = iv2.eval(0.0, 0.0, { dose: 100.0 });
    const iv2At2 = iv2.eval(2.0, 0.0, { dose: 100.0 });
    assert.ok(Math.abs(iv2At0.concOut - 10.0) < 1e-9);
    assert.ok(iv2At2.concOut > 0.0 && iv2At2.concOut < 10.0 && iv2At2.peripheralOut > 0.0);

    const tmdd = instantiateMlxtranWasmModel("tmdd_qss");
    assert.ok(tmdd, "Expected tmdd_qss WASM instance");
    tmdd.init({ dose: 150.0 });
    const tmddDay5 = tmdd.eval(5.0, 5.0);
    assert.ok(
      tmddDay5.concOut > 0.0 && tmddDay5.concOut < 50.0,
      `Expected TMDD QSS free drug decay, got ${tmddDay5.concOut}`,
    );
    assert.ok(tmddDay5.peripheralOut > 0.0, "Expected non-zero drug-target complex RC");
  });

  it("projects and links an FMI 2.0/3.0 external QSP/PBPK FMU into Mlxtran", () => {
    const proj = fmuToMlxtranBlock({
      modelName: "VendorPbpkFmu",
      variables: [
        { name: "CLint", causality: "parameter", type: "Real", valueReference: 1, start: 12.5 },
        { name: "Vss", causality: "parameter", type: "Real", valueReference: 2, start: 45.0 },
        { name: "Cc", causality: "output", type: "Real", valueReference: 3 },
      ],
    });
    assert.ok(proj.mlxtranBlock.includes("[LONGITUDINAL]"));
    assert.ok(proj.mlxtranBlock.includes("VendorPbpkFmu"));
    assert.deepEqual(proj.parameterNames, ["CLint", "Vss"]);
    assert.deepEqual(proj.outputNames, ["Cc"]);

    const fmuInst = createFmuMlxtranInstance(proj.modelName, (t, _dt, io) => ({
      concOut: ((io?.dose ?? 100.0) / 45.0) * Math.exp(-0.2 * t),
    }));
    const out = fmuInst.eval(5.0, 0.0, { dose: 90.0 });
    const expected = (90.0 / 45.0) * Math.exp(-1.0);
    assert.ok(Math.abs(out.concOut - expected) < 1e-9);
  });

  it("verifies bolus_1cpt_VCl, oral1_1cpt_kaVCl, and infusion_1cpt_VCl multi-dose superposition & analytical steady-state trough Css,min (< 1e-6)", () => {
    const V = 25.0;
    const Cl = 2.5;
    const F = 0.9;
    const D = 150.0;
    const tau = 12.0; // II = 12 h
    const k = Cl / V; // 0.1 1/h
    const expectedCssMin = ((F * D) / V) * (Math.exp(-k * tau) / (1.0 - Math.exp(-k * tau)));

    // 1. bolus_1cpt_VCl: Multi-dose superposition (25 doses, ADDL=24) trough at t = 25 * tau
    const ivMulti = instantiateMlxtranWasmModel("bolus_1cpt_VCl", { V, Cl, F });
    assert.ok(ivMulti);
    ivMulti.init({ dose: D });
    const ivTroughMulti = ivMulti.eval(25 * tau, 0.0, { amt: D, ii: tau, addl: 24, ss: 0 });
    assert.ok(
      Math.abs(ivTroughMulti.concOut - expectedCssMin) < 1e-6,
      `bolus_1cpt_VCl multi-dose trough mismatch: got ${ivTroughMulti.concOut}, expected ${expectedCssMin}`,
    );

    // 2. bolus_1cpt_VCl: Steady-state flag SS=1 trough at t = tau matches Css,min exactly
    const ivSs = instantiateMlxtranWasmModel("bolus_1cpt_VCl", { V, Cl, F });
    assert.ok(ivSs);
    ivSs.init({ dose: D });
    const ivTroughSs = ivSs.eval(tau, 0.0, { amt: D, ii: tau, addl: 0, ss: 1 });
    assert.ok(
      Math.abs(ivTroughSs.concOut - expectedCssMin) < 1e-10,
      `bolus_1cpt_VCl SS trough mismatch: got ${ivTroughSs.concOut}, expected ${expectedCssMin}`,
    );

    // 3. oral1_1cpt_kaVCl: Multi-dose with absorption lag time ALAG = 0.5 h converges to SS=1
    const oralMulti = instantiateMlxtranWasmModel("oral1_1cpt_kaVCl", { ka: 1.5, V, Cl, F, Tlag: 0.5 });
    const oralSs = instantiateMlxtranWasmModel("oral1_1cpt_kaVCl", { ka: 1.5, V, Cl, F, Tlag: 0.5 });
    assert.ok(oralMulti && oralSs);
    oralMulti.init({ dose: D });
    oralSs.init({ dose: D });
    const cOralMulti = oralMulti.eval(24 * tau + 4.0, 0.0, { dose: D, ii: tau, addl: 24, ss: 0 });
    const cOralSs = oralSs.eval(4.0, 0.0, { dose: D, ii: tau, addl: 0, ss: 1 });
    assert.ok(
      Math.abs(cOralMulti.concOut - cOralSs.concOut) < 1e-6,
      `oral1_1cpt_kaVCl multi-dose vs SS mismatch: ${cOralMulti.concOut} vs ${cOralSs.concOut}`,
    );

    // 4. infusion_1cpt_VCl: Multi-dose zero-order infusion (RATE = 75 mg/h => Tinf = 2 h) converges to SS=1
    const rate = 75.0;
    const tInf = D / rate;
    const expectedInfPeak = ((F * rate) / Cl) * ((1.0 - Math.exp(-k * tInf)) / (1.0 - Math.exp(-k * tau)));
    const infMulti = instantiateMlxtranWasmModel("infusion_1cpt_VCl", { V, Cl, F });
    const infSs = instantiateMlxtranWasmModel("infusion_1cpt_VCl", { V, Cl, F });
    assert.ok(infMulti && infSs);
    infMulti.init({ dose: D, rate });
    infSs.init({ dose: D, rate });
    const cInfMulti = infMulti.eval(24 * tau + tInf, 0.0, { dose: D, rate, ii: tau, addl: 24, ss: 0 });
    const cInfSs = infSs.eval(tInf, 0.0, { dose: D, rate, ii: tau, addl: 0, ss: 1 });
    assert.ok(Math.abs(cInfSs.concOut - expectedInfPeak) < 1e-9);
    assert.ok(
      Math.abs(cInfMulti.concOut - cInfSs.concOut) < 1e-6,
      `infusion_1cpt_VCl multi-dose vs SS peak mismatch: ${cInfMulti.concOut} vs ${cInfSs.concOut}`,
    );
  });
});

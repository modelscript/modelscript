// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  NMTRAN_MODEL_SPECS,
  createFmuNmtranInstance,
  fmuToNmtranPred,
  getNmtranSchemasFromLibraries,
  instantiateNmtranWasmModel,
  lookupNmtranModelSchema,
  lowerNmtranToDae,
  parseNmtran,
  registerBuiltInNmtranLibrarySync,
  solveNmtranPkPd,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/nmtran-std-lib");

describe("@modelscript/nmtran — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/nmtran-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected nmtran-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/nmtran-std-lib");
    assert.equal(pkg.manifest.language, "nmtran");
    assert.equal(pkg.symbols.length, NMTRAN_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, NMTRAN_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & public provenance metadata on every registered model
    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected cleanroom SVG icon for ${diag.namePath}`);
      assert.ok(diag.ports.length > 0, `Expected diagram ports for ${diag.namePath}`);
    }
    for (const sym of pkg.symbols) {
      const prov = (sym.metadata as Record<string, unknown> | undefined)?.["provenance"];
      assert.ok(
        typeof prov === "string" && prov.length > 10,
        `Expected public provenance citation for ${sym.namePath}`,
      );
    }
  });

  it("supports zero-I/O sync registration and case-insensitive alias lookup", () => {
    registerBuiltInNmtranLibrarySync();
    const schemas = getNmtranSchemasFromLibraries();
    assert.ok(schemas.length >= NMTRAN_MODEL_SPECS.length);

    assert.equal(lookupNmtranModelSchema("advan1")?.name, "ADVAN1");
    assert.equal(lookupNmtranModelSchema("bateman")?.name, "ADVAN2");
    assert.equal(lookupNmtranModelSchema("michaelis_menten")?.name, "ADVAN10");
    assert.equal(lookupNmtranModelSchema("TRANS4")?.name, "TRANS4");
    assert.equal(lookupNmtranModelSchema("hill_emax")?.name, "PRED_EMAX");
    assert.equal(lookupNmtranModelSchema("ruv_comb")?.name, "ERROR_COMB");
  });

  it("evaluates ADVAN1 (1-cpt IV), ADVAN2 (Bateman oral), ADVAN3 (2-cpt IV), ADVAN10 (Michaelis-Menten), and PRED_EMAX accurately in runtime.wasm", () => {
    // 1. ADVAN1: C(t) = (D / V) * exp(-(CL / V) * t)
    const adv1 = instantiateNmtranWasmModel({
      modelType: "ADVAN1",
      params: { CL: 5.0, V: 50.0, F1: 1.0 },
    });
    assert.ok(adv1, "Expected ADVAN1 WASM instance");
    adv1.init({ dose: 500.0 });
    for (const t of [0.0, 2.0, 6.0, 12.0, 24.0]) {
      const out = adv1.evalAt(t, { dose: 500.0 });
      const expected = (500.0 / 50.0) * Math.exp(-(5.0 / 50.0) * t);
      assert.ok(
        Math.abs(out.conc - expected) < 1e-10,
        `ADVAN1 mismatch at t=${t}: got ${out.conc}, expected ${expected}`,
      );
    }

    // 2. ADVAN2: Bateman equation C(t) = (F * D * ka / (V * (ka - k))) * (exp(-k*t) - exp(-ka*t))
    const adv2 = instantiateNmtranWasmModel({
      modelType: "ADVAN2",
      params: { CL: 5.0, V: 50.0, KA: 1.2, F1: 0.8, ALAG1: 0.0 },
    });
    assert.ok(adv2, "Expected ADVAN2 WASM instance");
    adv2.init({ dose: 250.0 });
    const k = 5.0 / 50.0;
    const ka = 1.2;
    for (const t of [0.0, 0.5, 2.0, 4.0, 12.0]) {
      const out = adv2.evalAt(t, { dose: 250.0 });
      const expected = ((0.8 * 250.0 * ka) / (50.0 * (ka - k))) * (Math.exp(-k * t) - Math.exp(-ka * t));
      assert.ok(
        Math.abs(out.conc - expected) < 1e-10,
        `ADVAN2 Bateman mismatch at t=${t}: got ${out.conc}, expected ${expected}`,
      );
    }

    // 3. ADVAN3: 2-compartment IV biexponential
    const CL = 5.0;
    const V1 = 20.0;
    const Q = 10.0;
    const V2 = 40.0;
    const adv3 = instantiateNmtranWasmModel({
      modelType: "ADVAN3",
      params: { CL, V1, Q, V2, F1: 1.0 },
    });
    assert.ok(adv3, "Expected ADVAN3 WASM instance");
    adv3.init({ dose: 400.0 });
    const k10 = CL / V1;
    const k12 = Q / V1;
    const k21 = Q / V2;
    const sum = k10 + k12 + k21;
    const disc = Math.sqrt(sum * sum - 4 * k10 * k21);
    const alpha = 0.5 * (sum + disc);
    const beta = 0.5 * (sum - disc);
    const coefA = (alpha - k21) / (alpha - beta);
    const coefB = (k21 - beta) / (alpha - beta);
    for (const t of [0.0, 1.0, 4.0, 12.0]) {
      const out = adv3.evalAt(t, { dose: 400.0 });
      const expected = (400.0 / V1) * (coefA * Math.exp(-alpha * t) + coefB * Math.exp(-beta * t));
      assert.ok(
        Math.abs(out.conc - expected) < 1e-10,
        `ADVAN3 biexponential mismatch at t=${t}: got ${out.conc}, expected ${expected}`,
      );
    }

    // 4. ADVAN10: 1-compartment Michaelis-Menten saturable elimination via Heun RK2
    // Verify implicit integrated analytical invariant:
    //   Km * ln(C0 / C(t)) + (C0 - C(t)) = (Vmax / V) * t
    const VM = 40.0;
    const KM = 10.0;
    const V = 20.0;
    const D = 600.0; // C0 = 30 mg/L >> Km (saturated regime)
    const adv10 = instantiateNmtranWasmModel({
      modelType: "ADVAN10",
      params: { VM, KM, V, F1: 1.0 },
    });
    assert.ok(adv10, "Expected ADVAN10 WASM instance");
    adv10.init({ dose: D });
    const c0 = D / V;
    for (const t of [2.0, 5.0, 10.0]) {
      const out = adv10.evalAt(t, { dose: D, dt: 0.005 });
      assert.ok(out.conc > 0 && out.conc < c0, `Expected 0 < C(${t}) < C0, got ${out.conc}`);
      const lhs = KM * Math.log(c0 / out.conc) + (c0 - out.conc);
      const rhs = (VM / V) * t;
      assert.ok(
        Math.abs(lhs - rhs) / rhs < 1e-4,
        `ADVAN10 Michaelis-Menten invariant mismatch at t=${t}: lhs=${lhs}, rhs=${rhs}`,
      );
    }

    // 5. PRED_EMAX: Hill sigmoidal E = E0 + Emax * C^gamma / (EC50^gamma + C^gamma)
    const emax = instantiateNmtranWasmModel({
      modelType: "PRED_EMAX",
      params: { E0: 10.0, EMAX: 80.0, EC50: 5.0, GAMMA: 2.0 },
    });
    assert.ok(emax, "Expected PRED_EMAX WASM instance");
    emax.init();
    const atEc50 = emax.evalAt(0.0, { conc: 5.0 });
    assert.ok(Math.abs(atEc50.effect - 50.0) < 1e-10, `Expected E(EC50)=50, got ${atEc50.effect}`);
    const at10 = emax.evalAt(0.0, { conc: 10.0 });
    const expected10 = 10.0 + (80.0 * 100.0) / (25.0 + 100.0);
    assert.ok(Math.abs(at10.effect - expected10) < 1e-10, `Expected E(10)=${expected10}, got ${at10.effect}`);
  });

  it("evaluates ADVAN11 (3-cpt IV), ADVAN12 (3-cpt oral), TRANS4, and ERROR_COMB in runtime.wasm", () => {
    // 3-compartment IV mass conservation at t=0 and monotonic central decay
    const adv11 = instantiateNmtranWasmModel({ modelType: "ADVAN11" });
    assert.ok(adv11);
    adv11.init({ dose: 300.0 });
    const c0 = adv11.evalAt(0.0, { dose: 300.0 });
    const c2 = adv11.evalAt(2.0, { dose: 300.0 });
    assert.ok(Math.abs(c0.conc - 300.0 / 15.0) < 1e-9, `Expected ADVAN11 C(0)=20, got ${c0.conc}`);
    assert.ok(c2.conc > 0 && c2.conc < c0.conc, `Expected ADVAN11 decay at t=2, got ${c2.conc}`);

    // 3-compartment oral absorption rise then decay
    const adv12 = instantiateNmtranWasmModel({ modelType: "ADVAN12" });
    assert.ok(adv12);
    adv12.init({ dose: 300.0 });
    const c0Oral = adv12.evalAt(0.0, { dose: 300.0 });
    const c1Oral = adv12.evalAt(1.0, { dose: 300.0 });
    assert.equal(c0Oral.conc, 0.0);
    assert.ok(c1Oral.conc > 0, `Expected positive ADVAN12 C(1), got ${c1Oral.conc}`);

    // TRANS4: CL=5, V1=20, Q=10, V2=40 => K=0.25, K12=0.5, K21=0.25
    const tr4 = instantiateNmtranWasmModel({ modelType: "TRANS4", params: { CL: 5.0, V1: 20.0, Q: 10.0, V2: 40.0 } });
    assert.ok(tr4);
    const trOut = tr4.evalAt(0.0);
    assert.ok(Math.abs(trOut.value - 0.25) < 1e-12);
    assert.ok(Math.abs((trOut.states[1] ?? 0) - 0.5) < 1e-12);
    assert.ok(Math.abs((trOut.states[2] ?? 0) - 0.25) < 1e-12);

    // ERROR_COMB: Y = F * (1 + eps1) + eps2
    const errComb = instantiateNmtranWasmModel({ modelType: "ERROR_COMB" });
    assert.ok(errComb);
    const errOut = errComb.evalAt(0.0, { ipred: 10.0, eps1: 0.1, eps2: 0.5 });
    assert.ok(Math.abs(errOut.dv - 11.5) < 1e-12);
  });

  it("projects and links an FMI 2.0/3.0 user-defined PK/PD FMU into NMTRAN $PRED", () => {
    const proj = fmuToNmtranPred({
      modelName: "VendorQspTumorFmu",
      variables: [
        { name: "cl", causality: "parameter", type: "Real", valueReference: 1, start: 0.25 },
        { name: "vc", causality: "parameter", type: "Real", valueReference: 2, start: 3.5 },
        { name: "conc", causality: "output", type: "Real", valueReference: 3 },
      ],
    });
    assert.ok(proj.controlStream.includes("$PROBLEM"));
    assert.ok(proj.controlStream.includes("VendorQspTumorFmu.fmu"));
    assert.ok(proj.controlStream.includes("THETA(1)"));
    assert.deepEqual(proj.parameterNames, ["cl", "vc"]);

    const fmuInst = createFmuNmtranInstance(proj.modelName, (tHours, io) => {
      const dose = io?.dose ?? 100.0;
      const conc = (dose / 3.5) * Math.exp(-(0.25 / 3.5) * tHours);
      return { conc, ipred: conc, value: conc };
    });
    const out = fmuInst.evalAt(0.0, { dose: 35.0 });
    assert.ok(Math.abs(out.conc - 10.0) < 1e-9);
  });

  it("automatically registers stdlib and falls back to PREDPP schema defaults in DAE lowering and PK/PD solver", () => {
    // Minimal ADVAN2 control stream omitting CL, V, KA definitions in $PK
    const minimalCtl = `$PROBLEM MINIMAL ADVAN2 SCHEMA DEFAULTS
$SUBROUTINES ADVAN2 TRANS2
$PK
  F1 = 1
`;
    const doc = parseNmtran(minimalCtl);
    const dae = lowerNmtranToDae(doc);
    assert.ok(globalLibraryRegistry.getPackagesForLanguage("nmtran").length > 0);
    assert.equal(dae.varCount, dae.eqCount);
    assert.notEqual(dae.lookupVariable("A_1"), -1);
    assert.notEqual(dae.lookupVariable("A_2"), -1);

    const sim = solveNmtranPkPd(doc, { duration: 12.0, timeStep: 0.1 });
    // ADVAN2 schema defaults: CL = 5.0, V = 50.0, KA = 1.2
    assert.equal(sim.metrics.clearance, 5.0);
    assert.equal(sim.metrics.centralVolume, 50.0);
    assert.ok(sim.metrics.cMax > 0);
  });

  it("verifies ADVAN1/ADVAN2/ADVAN3 multi-dose superposition, zero-order infusion, ALAG1, F1, and analytical steady-state trough Css,min (< 1e-6)", () => {
    const CL = 5.0;
    const V = 50.0;
    const F1 = 0.85;
    const D = 200.0;
    const tau = 12.0; // dosing interval II = 12 h
    const k = CL / V; // 0.1 1/h
    const expectedCssMin = ((F1 * D) / V) * (Math.exp(-k * tau) / (1.0 - Math.exp(-k * tau)));
    const expectedCssMax = (F1 * D) / V / (1.0 - Math.exp(-k * tau));

    // 1. ADVAN1: Multi-dose superposition after 25 doses (ADDL=24) at trough t = 25 * tau
    const adv1Multi = instantiateNmtranWasmModel({ modelType: "ADVAN1", params: { CL, V, F1, ALAG1: 0.0 } });
    assert.ok(adv1Multi);
    adv1Multi.init({ dose: D });
    const troughMulti = adv1Multi.evalAt(25 * tau, { amt: D, ii: tau, addl: 24, ss: 0 });
    assert.ok(
      Math.abs(troughMulti.conc - expectedCssMin) < 1e-6,
      `ADVAN1 multi-dose trough mismatch: got ${troughMulti.conc}, expected ${expectedCssMin}`,
    );

    // 2. ADVAN1: Exact steady-state flag (SS=1) peak at t=0 and trough at t=tau
    const adv1Ss = instantiateNmtranWasmModel({ modelType: "ADVAN1", params: { CL, V, F1 } });
    assert.ok(adv1Ss);
    adv1Ss.init({ dose: D });
    const ssPeak = adv1Ss.evalAt(0.0, { amt: D, ii: tau, addl: 0, ss: 1 });
    const ssTrough = adv1Ss.evalAt(tau, { amt: D, ii: tau, addl: 0, ss: 1 });
    assert.ok(
      Math.abs(ssPeak.conc - expectedCssMax) < 1e-10,
      `ADVAN1 SS peak mismatch: ${ssPeak.conc} vs ${expectedCssMax}`,
    );
    assert.ok(
      Math.abs(ssTrough.conc - expectedCssMin) < 1e-10,
      `ADVAN1 SS trough mismatch: ${ssTrough.conc} vs ${expectedCssMin}`,
    );

    // 3. ADVAN1: Multi-dose zero-order infusion (RATE = 100 mg/h => Tinf = 2 h) SS periodicity
    const rate = 100.0;
    const tInf = D / rate;
    const expectedInfPeak = ((F1 * rate) / CL) * ((1.0 - Math.exp(-k * tInf)) / (1.0 - Math.exp(-k * tau)));
    const adv1Inf = instantiateNmtranWasmModel({ modelType: "ADVAN1", params: { CL, V, F1 } });
    assert.ok(adv1Inf);
    adv1Inf.init({ dose: D, rate });
    const infPeakSs = adv1Inf.evalAt(tInf, { dose: D, rate, ii: tau, addl: 0, ss: 1 });
    const infTrough0 = adv1Inf.evalAt(0.0, { dose: D, rate, ii: tau, addl: 0, ss: 1 });
    const infTroughTau = adv1Inf.evalAt(tau, { dose: D, rate, ii: tau, addl: 0, ss: 1 });
    assert.ok(Math.abs(infPeakSs.conc - expectedInfPeak) < 1e-9);
    assert.ok(Math.abs(infTrough0.conc - infTroughTau.conc) < 1e-10);

    // 4. ADVAN2: Oral multi-dose with ALAG1 = 0.5 h converges to SS=1 steady-state
    const adv2Multi = instantiateNmtranWasmModel({ modelType: "ADVAN2", params: { CL, V, KA: 1.2, F1, ALAG1: 0.5 } });
    const adv2Ss = instantiateNmtranWasmModel({ modelType: "ADVAN2", params: { CL, V, KA: 1.2, F1, ALAG1: 0.5 } });
    assert.ok(adv2Multi && adv2Ss);
    adv2Multi.init({ dose: D });
    adv2Ss.init({ dose: D });
    const oralMulti = adv2Multi.evalAt(24 * tau + 3.0, { dose: D, ii: tau, addl: 24, ss: 0 });
    const oralSs = adv2Ss.evalAt(3.0, { dose: D, ii: tau, addl: 0, ss: 1 });
    assert.ok(
      Math.abs(oralMulti.conc - oralSs.conc) < 1e-6,
      `ADVAN2 multi-dose vs SS mismatch: ${oralMulti.conc} vs ${oralSs.conc}`,
    );

    // 5. ADVAN3: 2-cpt IV multi-dose (ADDL=39) converges to SS=1 steady-state
    const adv3Multi = instantiateNmtranWasmModel({
      modelType: "ADVAN3",
      params: { CL: 5.0, V1: 20.0, Q: 10.0, V2: 40.0, F1 },
    });
    const adv3Ss = instantiateNmtranWasmModel({
      modelType: "ADVAN3",
      params: { CL: 5.0, V1: 20.0, Q: 10.0, V2: 40.0, F1 },
    });
    assert.ok(adv3Multi && adv3Ss);
    adv3Multi.init({ dose: D });
    adv3Ss.init({ dose: D });
    const twoCptMulti = adv3Multi.evalAt(40 * tau, { dose: D, ii: tau, addl: 39, ss: 0 });
    const twoCptSs = adv3Ss.evalAt(tau, { dose: D, ii: tau, addl: 0, ss: 1 });
    assert.ok(
      Math.abs(twoCptMulti.conc - twoCptSs.conc) < 1e-6,
      `ADVAN3 multi-dose vs SS trough mismatch: ${twoCptMulti.conc} vs ${twoCptSs.conc}`,
    );
  });
});

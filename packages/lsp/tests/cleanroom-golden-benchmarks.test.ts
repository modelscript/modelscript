// SPDX-License-Identifier: AGPL-3.0-or-later

import { instantiateAdamsWasmModel } from "@modelscript/adams";
import { instantiateAspenWasmModel } from "@modelscript/aspen";
import { instantiateFeaWasmCard } from "@modelscript/fea";
import { instantiateLpsWasmModel } from "@modelscript/lps";
import { instantiateNmtranWasmModel } from "@modelscript/nmtran";
import { instantiatePowerFactoryWasmModel } from "@modelscript/powerfactory";
import { instantiatePslfWasmModel } from "@modelscript/pslf";
import { instantiateRelap5WasmModel } from "@modelscript/relap5";
import { instantiateSimulinkWasmBlock } from "@modelscript/simulink";
import { instantiateSpiceWasmDevice } from "@modelscript/spice";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("Sprint E — Golden Real-World Engineering Benchmark Parity (< 1e-3 relative error)", () => {
  it("IEEE/WECC Power Grid: 6th-order GENROU flat-start + HYGOV non-minimum-phase water hammer", () => {
    const baseIo = {
      eterm: 1.0,
      speedDev: 0.0,
      efd: 1.8,
      pmech: 0.85,
      pelec: 0.85,
      qelec: 0.25,
      freqHz: 60.0,
      pref: 0.85,
    };

    const gen = instantiatePslfWasmModel({ modelType: "genrou", busNumber: 1, id: "1", baseKv: 20, params: [] });
    assert.ok(gen, "Expected 6th-order PSLF genrou WASM instance");
    const nStates = gen.init(baseIo);
    assert.equal(nStates, 6, "Expected 6th-order synchronous machine states");
    assert.ok(gen.checkFlatStart() < 1e-6, `Expected GENROU flat-start < 1e-6, got ${gen.checkFlatStart()}`);

    const hygov = instantiatePslfWasmModel({ modelType: "hygov", busNumber: 1, id: "1", baseKv: 20, params: [] });
    assert.ok(hygov);
    hygov.init(baseIo);
    assert.ok(hygov.checkFlatStart() < 1e-6);
    // Step under-frequency -> gate opens -> initial inverse-response dip in pmech (water hammer), then rises above 0.85
    const dipOut = hygov.doStep(0.05, 0.05, { ...baseIo, speedDev: -0.01 });
    assert.ok(dipOut.pmech < baseIo.pmech, `Expected HYGOV non-minimum-phase water-hammer dip, got ${dipOut.pmech}`);
    let steadyOut = dipOut;
    for (let k = 1; k < 160; k++) {
      steadyOut = hygov.doStep(0.05 * (k + 1), 0.05, { ...baseIo, speedDev: -0.01 });
    }
    assert.ok(steadyOut.pmech > baseIo.pmech, `Expected HYGOV steady power increase > 0.85, got ${steadyOut.pmech}`);

    // PowerFactory IEEE C37.112 Very Inverse overcurrent relay instantiation
    const pfRel = instantiatePowerFactoryWasmModel({ modelType: "rel_TOC_IEEE", elementName: "R1", params: [] });
    assert.ok(pfRel, "Expected PowerFactory rel_TOC_IEEE WASM instance");
  });

  it("Simulink Controls: 2nd-order underdamped TransferFcn & 2x2 harmonic oscillator StateSpace (< 1e-3)", () => {
    const wn = 2.0;
    const zeta = 0.25;
    const wd = wn * Math.sqrt(1 - zeta * zeta);
    const phi = Math.atan2(Math.sqrt(1 - zeta * zeta), zeta);
    const tf = instantiateSimulinkWasmBlock("TransferFcn", {
      Numerator: [0, 0, wn * wn],
      Denominator: [1, 2 * zeta * wn, wn * wn],
    });
    assert.ok(tf);
    tf.init();
    const dt = 0.005;
    let maxErr = 0;
    for (let k = 1; k <= 400; k++) {
      const t = k * dt;
      const y = tf.step((k - 1) * dt, dt, [1.0]);
      const exact = 1 - (Math.exp(-zeta * wn * t) / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * t + phi);
      maxErr = Math.max(maxErr, Math.abs(y - exact));
    }
    assert.ok(maxErr < 1e-3, `Expected 2nd-order TransferFcn error < 1e-3, got ${maxErr}`);

    // Harmonic oscillator: x1' = x2, x2' = -x1, x(0) = [1, 0] -> y(t) = cos(t)
    const ss = instantiateSimulinkWasmBlock("StateSpace", {
      A: [0, 1, -1, 0],
      B: [0, 0],
      C: [1, 0],
      D: [0],
      X0: [1, 0],
    });
    assert.ok(ss);
    ss.init();
    let ssErr = 0;
    for (let k = 1; k <= 400; k++) {
      const t = k * dt;
      const y = ss.step((k - 1) * dt, dt, [0.0]);
      ssErr = Math.max(ssErr, Math.abs(y - Math.cos(t)));
    }
    assert.ok(ssErr < 1e-3, `Expected 2x2 StateSpace error < 1e-3, got ${ssErr}`);
  });

  it("Thermo & Process: IAPWS-IF97 Steam Table, NIST Aspen Flash2, and ISO 20765-1 AGA-8 Natural Gas", () => {
    // RELAP5 IAPWS-IF97 at 1 atm (101325 Pa): T_sat = 373.124 K
    const steam = instantiateRelap5WasmModel({ componentId: 400, modelType: "STEAM_IAPWS_IF97" });
    assert.ok(steam);
    steam.init();
    const sRes = steam.doStep(0.0, 0.01, { pressure: 101325.0 });
    assert.ok(Math.abs(sRes.tSat - 373.124) < 0.05, `Expected Tsat ~ 373.124 K, got ${sRes.tSat}`);

    // Aspen Flash2 Benzene/Toluene isothermal VLE flash at 368.15 K, 1 atm, z1 = 0.5
    const flash = instantiateAspenWasmModel({ id: "V101", modelType: "Flash2" });
    assert.ok(flash);
    flash.init();
    const fRes = flash.eval({ T_in: 368.15, P_in: 101325.0, F_in: 100.0, z1: 0.5 });
    assert.ok(
      fRes.vaporFraction > 0.2 && fRes.vaporFraction < 0.7,
      `Expected two-phase vapor fraction in (0.2, 0.7), got ${fRes.vaporFraction}`,
    );

    // LPS ISO 20765-1 AGA-8 natural gas Z at 5 MPa, 300 K -> Z in (0.87, 0.94)
    const aga8 = instantiateLpsWasmModel({ id: "EOS_1", modelType: "EOS_AGA8" });
    assert.ok(aga8);
    aga8.init({ pinPa: 5.0e6, tinK: 300.0 });
    const zRes = aga8.eval({ pinPa: 5.0e6, tinK: 300.0 });
    assert.ok(zRes.zFactor > 0.87 && zRes.zFactor < 0.94, `Expected AGA-8 Z in (0.87, 0.94), got ${zRes.zFactor}`);
  });

  it("Pharmacometrics: NONMEM ADVAN1 Multi-Dose Steady-State Trough (< 1e-6)", () => {
    const cl = 2.0;
    const v = 20.0;
    const ke = cl / v; // 0.1 h^-1
    const dose = 100.0;
    const tau = 12.0;
    const adv1 = instantiateNmtranWasmModel({ modelType: "ADVAN1", params: { CL: cl, V: v, F1: 1.0 } });
    assert.ok(adv1);
    adv1.init({ dose });
    const out = adv1.evalAt(tau, { dose, ii: tau, ss: 1 });
    const exactTrough = (dose / v) * (Math.exp(-ke * tau) / (1 - Math.exp(-ke * tau)));
    assert.ok(Math.abs(out.conc - exactTrough) < 1e-6, `Expected Css,min = ${exactTrough}, got ${out.conc}`);
  });

  it("Circuits, FEA & Multibody: SPICE MOSFET Sat, FEA 3D J2 Yield, Adams MF6.2 Friction Ellipse", () => {
    // SPICE NMOS: saturation drain current far exceeds subthreshold/cutoff
    const nmos = instantiateSpiceWasmDevice({ name: "M1", modelType: "M_IRF540_NMOS" });
    assert.ok(nmos);
    nmos.init();
    const cut = nmos.eval({ v1: 1.0, v2: 10.0 });
    const sat = nmos.eval({ v1: 6.0, v2: 10.0 });
    assert.ok(sat.iOut > cut.iOut + 1.0, `Expected strong MOSFET saturation current, got sat=${sat.iOut}`);

    // FEA 3D J2 radial-return plasticity: uniaxial strain beyond yield stays on ideal yield surface
    const j2 = instantiateFeaWasmCard("ABQ_PLASTIC_J2", { E: 210e9, nu: 0.3, sigmaY0: 250e6, H: 0.0 });
    assert.ok(j2);
    j2.init();
    const pl = j2.evaluate({ eps11: 0.01, eps22: -0.003, eps33: -0.003, gamma12: 0.0 });
    assert.ok(Math.abs(pl.vonMises - 250e6) / 250e6 < 1e-3, `Expected von Mises = 250 MPa, got ${pl.vonMises}`);

    // Adams PAC2002 MF 6.2 combined-slip: braking reduces lateral cornering force (friction ellipse)
    const tire = instantiateAdamsWasmModel({ modelType: "PAC2002_TIRE" });
    assert.ok(tire);
    tire.init();
    const pureLat = tire.evaluate({ x: 0.0, xdot: 0.1, dy: 5000.0, dz: 0.0 });
    const combLat = tire.evaluate({ x: -0.12, xdot: 0.1, dy: 5000.0, dz: 0.0 });
    assert.ok(Math.abs(combLat.fy) < Math.abs(pureLat.fy), "Expected combined slip to reduce lateral tire force");
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SPICE_MODEL_SPECS,
  createFmuSpiceInstance,
  fmuToSpiceSubckt,
  getSpiceSchemasFromLibraries,
  instantiateSpiceWasmDevice,
  lookupSpiceModelSchema,
  registerBuiltInSpiceLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/spice-std-lib");

describe("@modelscript/spice — Cleanroom Standard Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/spice-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected spice-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/spice-std-lib");
    assert.equal(pkg.manifest.language, "spice");
    assert.equal(pkg.symbols.length, SPICE_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, SPICE_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    // Verify cleanroom SVG icons & public provenance metadata on every registered model
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
    registerBuiltInSpiceLibrarySync();
    const schemas = getSpiceSchemasFromLibraries();
    assert.ok(schemas.length >= SPICE_MODEL_SPECS.length);

    assert.equal(lookupSpiceModelSchema("1N4148")?.name, "D_1N4148");
    assert.equal(lookupSpiceModelSchema("2n2222")?.name, "Q_2N2222_NPN");
    assert.equal(lookupSpiceModelSchema("IRF540")?.name, "M_IRF540_NMOS");
    assert.equal(lookupSpiceModelSchema("VSWITCH")?.name, "S_VSWITCH");
    assert.equal(lookupSpiceModelSchema("SCHMITT")?.name, "A_SCHMITT");
    assert.equal(lookupSpiceModelSchema("LM741")?.name, "OPAMP_LM741");
  });

  it("evaluates Shockley diode, Ebers-Moll BJT, Shichman-Hodges MOSFET, smooth switch, Schmitt trigger, and op-amp in runtime.wasm", () => {
    // 1. D_1N4148 Shockley diode: forward conduction at 0.7V vs reverse leakage at -5V
    const d1n4148 = instantiateSpiceWasmDevice({ name: "D1", modelType: "D_1N4148" });
    assert.ok(d1n4148, "Expected D_1N4148 WASM instance");
    d1n4148.init();
    const dFwd = d1n4148.eval({ v1: 0.7 });
    const dRev = d1n4148.eval({ v1: -5.0 });
    assert.ok(dFwd.iOut > 1e-3 && dFwd.iOut < 0.1, `Expected D_1N4148 forward current in mA range, got ${dFwd.iOut}`);
    assert.ok(dFwd.gm > 0.01, `Expected positive forward conductance, got ${dFwd.gm}`);
    assert.ok(dRev.iOut <= 0 && Math.abs(dRev.iOut) < 1e-6, `Expected tiny reverse leakage, got ${dRev.iOut}`);

    // 1b. Zener breakdown check on D_BZX84C5V1_ZENER
    const zener = instantiateSpiceWasmDevice({ name: "DZ1", modelType: "D_BZX84C5V1_ZENER" });
    assert.ok(zener, "Expected D_BZX84C5V1_ZENER WASM instance");
    zener.init();
    const zBrk = zener.eval({ v1: -5.2 });
    assert.ok(
      zBrk.iOut < -0.01 && zBrk.region === 3,
      `Expected Zener breakdown conduction, got iOut=${zBrk.iOut}, region=${zBrk.region}`,
    );

    // 2. Q_2N2222_NPN Ebers-Moll BJT: forward-active Ic, Ib, and transconductance gm
    const q2n2222 = instantiateSpiceWasmDevice({ name: "Q1", modelType: "Q_2N2222_NPN" });
    assert.ok(q2n2222, "Expected Q_2N2222_NPN WASM instance");
    q2n2222.init();
    const qAct = q2n2222.eval({ v1: 0.7, v2: 5.0 });
    assert.ok(qAct.iOut > 1e-3, `Expected mA-scale collector current Ic, got ${qAct.iOut}`);
    assert.ok(
      qAct.iAux > 0 && qAct.iOut / qAct.iAux > 100,
      `Expected high forward beta Ic/Ib, got ${qAct.iOut / qAct.iAux}`,
    );
    assert.ok(qAct.gm > 0.05, `Expected positive transconductance gm, got ${qAct.gm}`);

    // 3. M_IRF540_NMOS Shichman-Hodges Level-1 MOSFET: cutoff, triode, and saturation
    const irf540 = instantiateSpiceWasmDevice({ name: "M1", modelType: "M_IRF540_NMOS" });
    assert.ok(irf540, "Expected M_IRF540_NMOS WASM instance");
    irf540.init();
    const mCut = irf540.eval({ v1: 1.0, v2: 10.0 });
    const mTri = irf540.eval({ v1: 6.0, v2: 1.0 });
    const mSat = irf540.eval({ v1: 6.0, v2: 10.0 });
    assert.equal(mCut.iOut, 0, "Expected zero drain current in cutoff");
    assert.equal(mCut.region, 0, "Expected cutoff region=0");
    assert.equal(mTri.region, 1, "Expected triode region=1");
    assert.equal(mSat.region, 2, "Expected saturation region=2");
    assert.ok(
      mSat.iOut > mTri.iOut && mTri.iOut > 0,
      `Expected Id(sat) > Id(triode) > 0, got sat=${mSat.iOut}, tri=${mTri.iOut}`,
    );

    // 4. S_VSWITCH smooth tanh voltage-controlled switch: off vs on conductance
    const vsw = instantiateSpiceWasmDevice({ name: "S1", modelType: "S_VSWITCH" });
    assert.ok(vsw, "Expected S_VSWITCH WASM instance");
    vsw.init();
    const swOff = vsw.eval({ v1: 0.0, v2: 10.0 });
    const swOn = vsw.eval({ v1: 1.0, v2: 10.0 });
    assert.ok(swOff.iOut < 1e-2, `Expected small off-state switch current, got ${swOff.iOut}`);
    assert.ok(swOn.iOut > 5.0, `Expected large on-state switch current (~10A across 1 Ohm), got ${swOn.iOut}`);

    // 5. A_SCHMITT hysteresis: trips high above VT+VH (0.7V), holds high at 0.5V, trips low below VT-VH (0.3V)
    const schmitt = instantiateSpiceWasmDevice({ name: "A1", modelType: "A_SCHMITT" });
    assert.ok(schmitt, "Expected A_SCHMITT WASM instance");
    schmitt.init();
    assert.equal(schmitt.eval({ v1: 0.5 }).vOut, 0.0, "Expected initial low output inside hysteresis band");
    assert.equal(schmitt.eval({ v1: 0.8 }).vOut, 1.0, "Expected high output above VT + VH");
    assert.equal(schmitt.eval({ v1: 0.5 }).vOut, 1.0, "Expected hysteresis latch to hold high at 0.5V");
    assert.equal(schmitt.eval({ v1: 0.2 }).vOut, 0.0, "Expected reset to low below VT - VH");

    // 6. OPAMP_UNIVERSAL single-pole response & rail clamping
    const opamp = instantiateSpiceWasmDevice({ name: "U1", modelType: "OPAMP_UNIVERSAL" });
    assert.ok(opamp, "Expected OPAMP_UNIVERSAL WASM instance");
    opamp.init();
    const opOut = opamp.eval({ v1: 0.01, v2: 0.0, dt: 1e-5 });
    assert.ok(opOut.vOut > 0 && opOut.vOut <= 15.0, `Expected positive rail-clamped op-amp output, got ${opOut.vOut}`);
  });

  it("projects and links an FMI 2.0/3.0 vendor FMU via .SUBCKT wrapper", () => {
    const proj = fmuToSpiceSubckt(
      {
        modelName: "VendorGateDriverFmu",
        variables: [
          { name: "vdd", causality: "parameter", type: "Real", valueReference: 1, start: 12.0 },
          { name: "pwm_in", causality: "input", type: "Real", valueReference: 2 },
          { name: "gate_out", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      "XDRV1",
    );
    assert.ok(proj.subcktDeck.includes(".SUBCKT VendorGateDriverFmu"));
    assert.ok(proj.subcktDeck.includes("vdd=12"));
    assert.ok(proj.instanceCard.startsWith("XDRV1"));

    const fmuInst = createFmuSpiceInstance("XDRV1", proj.modelName, (inp) => ({
      vOut: inp.v1 > 2.5 ? 12.0 : 0.0,
    }));
    assert.equal(fmuInst.eval({ v1: 5.0 }).vOut, 12.0);
    assert.equal(fmuInst.eval({ v1: 0.5 }).vOut, 0.0);
  });

  it("verifies BSIM short-channel MOSFET (subthreshold leakage, DIBL, velocity saturation) and Gummel-Poon BJT (Ikf beta roll-off, Early Vaf/Var, Cje)", () => {
    // 1. BSIM Short-Channel MOSFET: subthreshold exponential conduction (n * Vt) & DIBL threshold shift
    const nSub = 1.5;
    const tempK = 300.15;
    const vt = 8.617333262e-5 * tempK;
    const decadeStep = nSub * vt * Math.LN10; // ~89.2 mV/dec
    const shortNmos = instantiateSpiceWasmDevice({
      name: "M_SHORT",
      modelType: "M_2N7002_NMOS",
      params: { VTO: 0.5, KP: 2.0e-4, W: 10e-6, L: 0.18e-6, LAMBDA: 0.05, NSUB: nSub, ETA0: 0.08, ESAT: 1.0e6 },
    });
    assert.ok(shortNmos);
    shortNmos.init();

    const subLow = shortNmos.eval({ v1: 0.1 - decadeStep, v2: 1.0, tempK });
    const subHigh = shortNmos.eval({ v1: 0.1, v2: 1.0, tempK });
    assert.ok(
      subLow.iOut > 0 && subHigh.iOut > subLow.iOut,
      "Expected positive subthreshold leakage increasing with Vgs",
    );
    const decadeRatio = subHigh.iOut / subLow.iOut;
    assert.ok(
      Math.abs(decadeRatio - 10.0) / 10.0 < 0.05,
      `Expected ~10x subthreshold current increase per n*Vt*ln(10), got ${decadeRatio}`,
    );

    // DIBL: higher Vds reduces Vth_eff and increases subthreshold leakage at fixed Vgs
    const subLowVds = shortNmos.eval({ v1: 0.25, v2: 0.5, tempK });
    const subHighVds = shortNmos.eval({ v1: 0.25, v2: 1.8, tempK });
    assert.ok(
      subHighVds.iOut > subLowVds.iOut * 5.0,
      `Expected DIBL to strongly increase subthreshold leakage at higher Vds: ${subHighVds.iOut} vs ${subLowVds.iOut}`,
    );

    // Velocity saturation (Esat): short-channel saturation current is much lower than long-channel quadratic current
    const longNmos = instantiateSpiceWasmDevice({
      name: "M_LONG",
      modelType: "M_2N7002_NMOS",
      params: { VTO: 0.5, KP: 2.0e-4, W: 10e-6, L: 0.18e-6, LAMBDA: 0.05, NSUB: nSub, ETA0: 0.08, ESAT: 1.0e12 },
    });
    assert.ok(longNmos);
    longNmos.init();
    const idShortSat = shortNmos.eval({ v1: 1.8, v2: 1.8, tempK }).iOut;
    const idLongSat = longNmos.eval({ v1: 1.8, v2: 1.8, tempK }).iOut;
    assert.ok(
      idShortSat > 0 && idShortSat < idLongSat * 0.35,
      `Expected velocity saturation to cap short-channel Id (${idShortSat}) well below quadratic long-channel Id (${idLongSat})`,
    );

    // 2. Gummel-Poon BJT: high-level injection Ikf beta roll-off & depletion capacitance Cje(Vbe)
    const gpBjt = instantiateSpiceWasmDevice({
      name: "Q_GP",
      modelType: "Q_2N2222_NPN",
      params: {
        IS: 1.434e-14,
        BF: 250.0,
        BR: 6.0,
        NF: 1.0,
        VAF: 75.0,
        VAR: 50.0,
        IKF: 0.05,
        CJE: 25e-12,
        VJE: 0.75,
        MJE: 0.33,
      },
    });
    assert.ok(gpBjt);
    gpBjt.init();

    // Low current (Ic << Ikf) vs high current (Ic >> Ikf)
    const lowInj = gpBjt.eval({ v1: 0.62, v2: 5.0, tempK });
    const highInj = gpBjt.eval({ v1: 0.85, v2: 5.0, tempK });
    const betaLow = lowInj.iOut / lowInj.iAux;
    const betaHigh = highInj.iOut / highInj.iAux;
    assert.ok(betaLow > 200, `Expected near-ideal beta at low injection, got ${betaLow}`);
    assert.ok(
      betaHigh < betaLow * 0.2,
      `Expected strong Gummel-Poon Ikf beta roll-off at high injection: betaHigh=${betaHigh}, betaLow=${betaLow}`,
    );

    // Voltage-dependent B-E depletion capacitance: Cje(Vbe) = Cje0 / (1 - Vbe/Vje)^mje for Vbe <= Fc*Vje
    const revBias = gpBjt.eval({ v1: -2.0, v2: 5.0, tempK });
    const expectedCjeRev = 25e-12 / Math.pow(1.0 - -2.0 / 0.75, 0.33);
    assert.ok(
      Math.abs((revBias.cje ?? 0) - expectedCjeRev) / expectedCjeRev < 1e-9,
      `Expected Cje(-2V)=${expectedCjeRev}, got ${revBias.cje}`,
    );
    const zeroBias = gpBjt.eval({ v1: 0.0, v2: 5.0, tempK });
    assert.ok(Math.abs((zeroBias.cje ?? 0) - 25e-12) < 1e-18);
  });
});

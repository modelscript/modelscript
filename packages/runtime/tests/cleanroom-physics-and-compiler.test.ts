// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { compileAssemblyScriptCleanroomModel, createIsolatedWasmInstance } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHYSICS_DIR = path.resolve(__dirname, "../assembly/physics");

describe("@modelscript/runtime — Shared Cleanroom Physics Kernels & Custom User-Model Compiler", () => {
  it("compiles a custom user-authored AssemblyScript model via compileAssemblyScriptCleanroomModel", async () => {
    const userSource = `
      export function userGainStep(u: f64, k: f64, bias: f64): f64 {
        return k * u + bias;
      }
    `;
    const { wasmBytes, diagnostics } = await compileAssemblyScriptCleanroomModel(userSource);
    assert.ok(wasmBytes && wasmBytes.byteLength > 0, `Compilation failed: ${diagnostics.join("; ")}`);

    const inst = createIsolatedWasmInstance(wasmBytes);
    assert.ok(inst, "Expected isolated WASM instance");
    const fn = inst.exports["userGainStep"] as (u: number, k: number, bias: number) => number;
    assert.equal(fn(3.0, 2.5, -1.0), 6.5);
  });

  it("validates shared IEEE/WECC dynamics kernel against published IEEE 421.5 & WECC specs", async () => {
    const src = fs.readFileSync(path.join(PHYSICS_DIR, "ieee-wecc-dynamics.ts"), "utf-8");
    const { wasmBytes, diagnostics } = await compileAssemblyScriptCleanroomModel(src);
    assert.ok(wasmBytes && wasmBytes.byteLength > 0, diagnostics.join("; "));
    const inst = createIsolatedWasmInstance(wasmBytes);
    assert.ok(inst);

    const evalSat = inst.exports["evalIeeeQuadraticSat"] as (x: number, s10: number, s12: number) => number;
    const evalSwing = inst.exports["evalSwingAccel"] as (
      pm: number,
      pe: number,
      dw: number,
      h: number,
      d: number,
    ) => number;
    const evalLvpl = inst.exports["evalWeccLvplScale"] as (v: number, zx: number, bp: number) => number;

    // IEEE 421.5 quadratic saturation must hit s10 at x=1.0 and s12 at x=1.2
    assert.ok(Math.abs(evalSat(1.0, 0.1, 0.4) - 0.1) < 1e-6);
    assert.ok(Math.abs(evalSat(1.2, 0.1, 0.4) - 0.4) < 1e-6);
    // Swing equation: (1.0 - 0.6 - 0) / (2 * 4.0) = 0.05 pu/s
    assert.ok(Math.abs(evalSwing(1.0, 0.6, 0.0, 4.0, 0.0) - 0.05) < 1e-12);
    // WECC LVPL: 0 at 0.4 pu, 0.5 at 0.65 pu, 1.0 at >= 0.9 pu
    assert.equal(evalLvpl(0.3, 0.4, 0.9), 0.0);
    assert.ok(Math.abs(evalLvpl(0.65, 0.4, 0.9) - 0.5) < 1e-12);
    assert.equal(evalLvpl(0.95, 0.4, 0.9), 1.0);
  });

  it("validates shared Protection TCC kernel against IEEE C37.112-2018 & IEC 60255-151 benchmarks", async () => {
    const src = fs.readFileSync(path.join(PHYSICS_DIR, "protection-tcc.ts"), "utf-8");
    const { wasmBytes, diagnostics } = await compileAssemblyScriptCleanroomModel(src);
    assert.ok(wasmBytes && wasmBytes.byteLength > 0, diagnostics.join("; "));
    const inst = createIsolatedWasmInstance(wasmBytes);
    assert.ok(inst);

    const evalToc = inst.exports["evalInverseOvercurrentTripTime"] as (c: number, m: number, td: number) => number;
    const evalMho = inst.exports["evalMhoZoneCheck"] as (r: number, x: number, zr: number, zx: number) => number;
    const evalDiff = inst.exports["evalDiff87Check"] as (
      id: number,
      ir: number,
      ip: number,
      s1: number,
      h2: number,
      h2b: number,
    ) => number;

    // IEEE Very Inverse (curveId=1) at M=5, TD=1: 19.61 / (25 - 1) + 0.491 = 1.308083 s
    const tIeeeVi = evalToc(1, 5.0, 1.0);
    assert.ok(Math.abs(tIeeeVi - (19.61 / 24.0 + 0.491)) < 1e-6);
    // IEC Standard Inverse (curveId=3) at M=5, TMS=1: 0.14 / (5^0.02 - 1) = 4.2797 s
    const tIecSi = evalToc(3, 5.0, 1.0);
    assert.ok(Math.abs(tIecSi - 0.14 / (Math.pow(5.0, 0.02) - 1.0)) < 1e-6);
    // Mho zone: (2, 5) inside diameter (4, 10); (5, 12) outside
    assert.equal(evalMho(2.0, 5.0, 4.0, 10.0), 1);
    assert.equal(evalMho(5.0, 12.0, 4.0, 10.0), 0);
    // Diff 87: trips on internal fault, blocks on 2nd-harmonic inrush
    assert.equal(evalDiff(1.5, 2.0, 0.3, 0.25, 0.05, 0.15), 1);
    assert.equal(evalDiff(1.5, 2.0, 0.3, 0.25, 0.2, 0.15), 0);
  });

  it("validates shared Thermo EOS kernel against IAPWS-IF97, Peng-Robinson, and Rachford-Rice benchmarks", async () => {
    const src = fs.readFileSync(path.join(PHYSICS_DIR, "thermo-eos.ts"), "utf-8");
    const { wasmBytes, diagnostics } = await compileAssemblyScriptCleanroomModel(src);
    assert.ok(wasmBytes && wasmBytes.byteLength > 0, diagnostics.join("; "));
    const inst = createIsolatedWasmInstance(wasmBytes);
    assert.ok(inst);

    const evalTsat = inst.exports["evalIapws97TsatK"] as (pMPa: number) => number;
    const evalPsat = inst.exports["evalIapws97PsatMPa"] as (tK: number) => number;
    const evalLiqRho = inst.exports["evalIapws97LiquidDensity"] as (pMPa: number, tK: number) => number;
    const evalLiqH = inst.exports["evalIapws97LiquidEnthalpyKJkg"] as (pMPa: number, tK: number) => number;
    const evalSteamH = inst.exports["evalIapws97SteamEnthalpyKJkg"] as (pMPa: number, tK: number) => number;
    const evalPrZ = inst.exports["evalPengRobinsonZ"] as (
      tK: number,
      pPa: number,
      tcK: number,
      pcPa: number,
      omega: number,
    ) => number;
    const evalPrPhi = inst.exports["evalPengRobinsonPhi"] as (
      tK: number,
      pPa: number,
      tcK: number,
      pcPa: number,
      omega: number,
      isLiquid?: number,
    ) => number;
    const evalRr = inst.exports["evalBinaryRachfordRice"] as (z1: number, k1: number, k2: number) => number;
    const evalMultiRr = inst.exports["evalMulticompRachfordRice"] as (nc: number, zPtr: number, kPtr: number) => number;
    const evalAga8 = inst.exports["evalAga8CompressibilityZ"] as (
      pMPa: number,
      tK: number,
      sg: number,
      xCo2: number,
      xN2: number,
      xH2: number,
    ) => number;
    const solveThomas = inst.exports["solveTridiagonalThomas"] as (
      n: number,
      aPtr: number,
      bPtr: number,
      cPtr: number,
      dPtr: number,
      xPtr: number,
    ) => number;
    const memory = inst.exports["memory"] as WebAssembly.Memory;

    // 1. IAPWS-IF97 Region 4 T_sat(P) & P_sat(T)
    assert.ok(Math.abs(evalTsat(0.101325) - 373.1243) < 0.01);
    assert.ok(Math.abs(evalTsat(1.0) - 453.0356) < 0.01);
    const pSat100 = evalPsat(373.1243);
    assert.ok(
      Math.abs(pSat100 - 0.101325) < 1e-5,
      `Expected IAPWS-IF97 P_sat(373.1243 K) ~ 0.101325 MPa, got ${pSat100}`,
    );
    assert.ok(Math.abs(evalPsat(300.0) - 0.003536589) < 1e-6);
    assert.ok(Math.abs(evalPsat(500.0) - 2.638898) < 1e-4);

    // 2. IAPWS-IF97 Region 1 compressed liquid density & enthalpy (Table 5 check points)
    const rho300 = evalLiqRho(3.0, 300.0);
    assert.ok(Math.abs(rho300 - 997.85) < 1.5, `Expected Region 1 rho(3 MPa, 300 K) ~ 997.85 kg/m^3, got ${rho300}`);
    const hLiq300 = evalLiqH(3.0, 300.0);
    assert.ok(Math.abs(hLiq300 - 115.33) < 2.0, `Expected Region 1 h(3 MPa, 300 K) ~ 115.33 kJ/kg, got ${hLiq300}`);
    const hLiq500 = evalLiqH(3.0, 500.0);
    assert.ok(Math.abs(hLiq500 - 975.54) < 12.0, `Expected Region 1 h(3 MPa, 500 K) ~ 975.54 kJ/kg, got ${hLiq500}`);

    // 3. IAPWS-IF97 Region 2 steam enthalpy (ideal + residual)
    const hSteam1Atm = evalSteamH(0.101325, 373.1243);
    assert.ok(
      Math.abs(hSteam1Atm - 2675.5) < 15.0,
      `Expected Region 2 h_g(1 atm, 373.1243 K) ~ 2675.5 kJ/kg, got ${hSteam1Atm}`,
    );
    const hSteam700 = evalSteamH(3.0, 700.0);
    assert.ok(
      Math.abs(hSteam700 - 3294.7) < 25.0,
      `Expected Region 2 h(3 MPa, 700 K) ~ 3294.7 kJ/kg, got ${hSteam700}`,
    );

    // 4. Peng-Robinson Z & Fugacity Coefficient phi
    const zCh4 = evalPrZ(300.0, 1e5, 190.56, 4.599e6, 0.0115);
    assert.ok(zCh4 > 0.99 && zCh4 < 1.0, `Expected Z ~ 0.998 for CH4 at 300K, 1 bar, got ${zCh4}`);
    const phiCh4 = evalPrPhi(300.0, 5.0e6, 190.564, 4.5992e6, 0.01142, 0);
    assert.ok(phiCh4 > 0.85 && phiCh4 < 0.96, `Expected CH4 PR phi at 300K/5MPa in (0.85, 0.96), got ${phiCh4}`);
    // Benzene near normal boiling point (353.24 K, 1 atm): K = phi^L / phi^V ~ 1.0
    const phiBenzV = evalPrPhi(353.24, 101325.0, 562.05, 4.895e6, 0.2103, 0);
    const phiBenzL = evalPrPhi(353.24, 101325.0, 562.05, 4.895e6, 0.2103, 1);
    const kBenz = phiBenzL / phiBenzV;
    assert.ok(kBenz > 0.85 && kBenz < 1.15, `Expected Benzene K = phi^L/phi^V ~ 1.0 at Tb, got ${kBenz}`);

    // 5. Binary & 3-component Benzene-Toluene-Xylene Rachford-Rice Flash
    assert.ok(Math.abs(evalRr(0.5, 2.0, 0.5) - 0.5) < 1e-6);
    const scratchBase = 4096;
    const zPtr = scratchBase;
    const kPtr = scratchBase + 128;
    const f64View = new Float64Array(memory.buffer);
    // BTX feed: 40% Benzene (K=1.80), 35% Toluene (K=0.78), 25% p-Xylene (K=0.35) at ~378 K, 1 atm
    const zBtx = [0.4, 0.35, 0.25];
    const kBtx = [1.8, 0.78, 0.35];
    for (let i = 0; i < 3; i++) {
      f64View[zPtr / 8 + i] = zBtx[i]!;
      f64View[kPtr / 8 + i] = kBtx[i]!;
    }
    const betaBtx = evalMultiRr(3, zPtr, kPtr);
    assert.ok(betaBtx > 0.1 && betaBtx < 0.9, `Expected two-phase BTX vapor fraction in (0.1, 0.9), got ${betaBtx}`);
    // Verify Rachford-Rice residual g(beta) == 0 to machine precision
    const rrResidual = zBtx.reduce(
      (acc, zi, i) => acc + (zi * (kBtx[i]! - 1.0)) / (1.0 + betaBtx * (kBtx[i]! - 1.0)),
      0.0,
    );
    assert.ok(Math.abs(rrResidual) < 1e-10, `Expected BTX Rachford-Rice residual ~ 0, got ${rrResidual}`);

    // 6. ISO 20765-1 AGA-8 Natural Gas Compressibility Z at 5 MPa, 300 K
    const zAga8 = evalAga8(5.0, 300.0, 0.6, 0.01, 0.02, 0.0);
    assert.ok(zAga8 > 0.87 && zAga8 < 0.93, `Expected ISO 20765-1 AGA-8 Z(5 MPa, 300 K, sg=0.60) ~ 0.90, got ${zAga8}`);
    const zAga8H2 = evalAga8(5.0, 300.0, 0.6, 0.01, 0.02, 0.25);
    assert.ok(zAga8H2 > zAga8, `Expected 25% H2 blend to increase compressibility Z: ${zAga8H2} vs ${zAga8}`);

    // 7. Tridiagonal Thomas TDMA solver (4-stage linear system)
    // Matrix: diag=4, sub=-1, super=-1, rhs=[3, 2, 2, 3] -> exact solution x=[1, 1, 1, 1]
    const aPtr = scratchBase + 256;
    const bPtr = scratchBase + 384;
    const cPtr = scratchBase + 512;
    const dPtr = scratchBase + 640;
    const xPtr = scratchBase + 768;
    const aArr = [0, -1, -1, -1];
    const bArr = [4, 4, 4, 4];
    const cArr = [-1, -1, -1, 0];
    const dArr = [3, 2, 2, 3];
    for (let i = 0; i < 4; i++) {
      f64View[aPtr / 8 + i] = aArr[i]!;
      f64View[bPtr / 8 + i] = bArr[i]!;
      f64View[cPtr / 8 + i] = cArr[i]!;
      f64View[dPtr / 8 + i] = dArr[i]!;
    }
    const rcThomas = solveThomas(4, aPtr, bPtr, cPtr, dPtr, xPtr);
    assert.equal(rcThomas, 0);
    for (let i = 0; i < 4; i++) {
      assert.ok(
        Math.abs(f64View[xPtr / 8 + i]! - 1.0) < 1e-12,
        `Expected Thomas x[${i}]=1, got ${f64View[xPtr / 8 + i]}`,
      );
    }
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript EOS & porous-media constitutive runtime for `@modelscript/tough-std-lib`.
 *
 * Implements LBNL TOUGH2 / TOUGH3 EOS and multiphase constitutive formulations using a zero-GC
 * 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — model parameter vector (`RP`, `CP`, or EOS params)
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — primary thermodynamic state vector
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives / sensitivities
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — constitutive & thermodynamic I/O bus:
 *       Inputs:
 *         IO[0]  = pressurePa (Pa)
 *         IO[1]  = temperatureC (deg C)
 *         IO[2]  = liquidSat (Sl in [0, 1])
 *         IO[3]  = gasSat (Sg in [0, 1])
 *         IO[4]  = salinity (NaCl mass fraction Xs)
 *         IO[5]  = co2Frac (CO2 mass fraction Xco2)
 *       Outputs:
 *         IO[6]  = krLiquid (k_rl in [0, 1])
 *         IO[7]  = krGas (k_rg in [0, 1])
 *         IO[8]  = capillaryPressurePa (P_cap <= 0, Pa)
 *         IO[9]  = liquidDensity (rho_l, kg/m^3)
 *         IO[10] = gasDensity (rho_g, kg/m^3)
 *         IO[11] = liquidViscosity (mu_l, Pa*s)
 *         IO[12] = saturationPressurePa (P_sat, Pa)
 *         IO[13] = liquidEnthalpy (h_l, J/kg)
 *         IO[14] = co2Solubility (X_co2_aq, mass fraction)
 *         IO[15] = effectiveConductivity (K_eff, m/s)
 */

import {
  evalIapws97LiquidDensity,
  evalIapws97LiquidEnthalpyKJkg,
  evalIapws97PsatMPa,
  evalIapws97SteamEnthalpyKJkg,
} from "../../../../../packages/runtime/assembly/physics/thermo-eos";

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `ToughArchetypeId` in tough-std-schemas.ts)
const ARCH_EOS1_WATER: i32 = 1;
const ARCH_EOS2_WATER_CO2: i32 = 2;
const ARCH_EOS3_WATER_AIR: i32 = 3;
const ARCH_EOS4_VAPOR_LOWERING: i32 = 4;
const ARCH_EOS5_WATER_H2: i32 = 5;
const ARCH_EOS7_BRINE: i32 = 7;
const ARCH_EOS7C_CH4_CO2: i32 = 8;
const ARCH_EOS9_RICHARDS: i32 = 9;
const ARCH_ECO2N_CO2_BRINE: i32 = 10;
const ARCH_EWASG_SALT_GAS: i32 = 11;
const ARCH_TMVOC_VOC: i32 = 12;

const ARCH_IRP1_LINEAR: i32 = 101;
const ARCH_IRP3_COREY: i32 = 103;
const ARCH_IRP4_GRANT: i32 = 104;
const ARCH_IRP7_VANGENUCHTEN: i32 = 107;
const ARCH_IRP8_VERMA: i32 = 108;
const ARCH_IRP11_STONE: i32 = 111;

const ARCH_ICP1_LINEAR: i32 = 201;
const ARCH_ICP3_PICKENS: i32 = 203;
const ARCH_ICP4_TRUST: i32 = 204;
const ARCH_ICP7_VANGENUCHTEN: i32 = 207;
const ARCH_ICP8_LEVERETT: i32 = 208;

@inline
function clamp(x: f64, lo: f64, hi: f64): f64 {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

@inline
function getCon(slotPtr: usize, conCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= conCount) return fallback;
  const v = load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
}

@inline
function setState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_STATE + (<usize>idx << 3), v);
}

@inline
function setDState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3), v);
}

@inline
function getIo(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

/**
 * IAPWS-IF97 Region 4 saturation pressure P_sat(T) in Pa for 273.15 K <= T_K <= 647.096 K.
 */
@inline
function iapwsSatPressurePa(tempC: f64): f64 {
  return evalIapws97PsatMPa(tempC + 273.15) * 1.0e6;
}

/**
 * Cleanroom IAPWS-IF97 Region 1 compressed liquid water density rho_l(P, T) in kg/m^3.
 */
@inline
function waterLiquidDensity(pressurePa: f64, tempC: f64, _betaT: f64): f64 {
  return evalIapws97LiquidDensity(pressurePa * 1.0e-6, tempC + 273.15);
}

/**
 * Vogel-type liquid water dynamic viscosity mu_l(T) in Pa*s.
 */
function waterLiquidViscosity(tempC: f64): f64 {
  const tk = clamp(tempC + 273.15, 273.15, 620.0);
  return 2.414e-5 * Math.pow(10.0, 247.8 / (tk - 140.0));
}

/**
 * Van Genuchten-Mualem liquid relative permeability helper.
 */
function evalVgKrl(sl: f64, lambda: f64, slr: f64, sls: f64): f64 {
  if (sl >= sls) return 1.0;
  if (sl <= slr) return 0.0;
  const denom = Math.max(1e-9, sls - slr);
  const sStar = clamp((sl - slr) / denom, 0.0, 1.0);
  const m = clamp(lambda, 0.05, 0.99);
  const inner = 1.0 - Math.pow(sStar, 1.0 / m);
  const term = 1.0 - Math.pow(Math.max(0.0, inner), m);
  return clamp(Math.sqrt(sStar) * term * term, 0.0, 1.0);
}

/**
 * Van Genuchten capillary pressure helper (TOUGH convention: P_cap <= 0 in Pa).
 */
function evalVgPcap(sl: f64, lambda: f64, slr: f64, alpha: f64, pMax: f64, sls: f64): f64 {
  if (sl >= sls) return 0.0;
  const denom = Math.max(1e-9, sls - slr);
  const sStar = clamp((sl - slr) / denom, 1e-6, 1.0);
  const m = clamp(lambda, 0.05, 0.99);
  const p0 = 1.0 / Math.max(1e-12, alpha);
  const base = Math.max(0.0, Math.pow(sStar, -1.0 / m) - 1.0);
  const pcap = -p0 * Math.pow(base, 1.0 - m);
  return clamp(pcap, -Math.abs(pMax), 0.0);
}

/**
 * Corey (1954) normalized saturation helper.
 */
function coreySHat(sl: f64, slr: f64, sgr: f64): f64 {
  const denom = Math.max(1e-9, 1.0 - slr - sgr);
  return clamp((sl - slr) / denom, 0.0, 1.0);
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function toughGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes primary state vector and performs initial constitutive/EOS evaluation.
 * Returns the number of active state variables stored in the slot.
 */
export function toughModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  const p = getIo(slotPtr, 0) > 0.0 ? getIo(slotPtr, 0) : 101325.0;
  const t = getIo(slotPtr, 1);
  const sl = clamp(getIo(slotPtr, 2), 0.0, 1.0);
  const sg = clamp(1.0 - sl, 0.0, 1.0);
  const xs = clamp(getIo(slotPtr, 4), 0.0, 0.35);
  const xco2 = clamp(getIo(slotPtr, 5), 0.0, 1.0);

  setState(slotPtr, 0, p);
  setState(slotPtr, 1, t);
  setState(slotPtr, 2, sl);
  setState(slotPtr, 3, sg);
  setState(slotPtr, 4, xs);
  setState(slotPtr, 5, xco2);

  for (let i = 0; i < 6; i++) {
    setDState(slotPtr, i, 0.0);
  }

  toughModelEval(archetypeId, slotPtr, conCount);
  return 6;
}

/**
 * Evaluates a TOUGH2/TOUGH3 EOS module, relative permeability model, or capillary pressure model
 * from the slot's `IO[0..5]` inputs and `CON[]` parameters, writing results to `IO[6..15]`.
 * Returns 0 on success, -1 for an unknown archetype ID.
 */
export function toughModelEval(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  const pressurePa = getIo(slotPtr, 0) > 0.0 ? getIo(slotPtr, 0) : 101325.0;
  const tempC = getIo(slotPtr, 1);
  const sl = clamp(getIo(slotPtr, 2), 0.0, 1.0);
  const sg = getIo(slotPtr, 3) >= 0.0 ? clamp(getIo(slotPtr, 3), 0.0, 1.0) : 1.0 - sl;
  const salinity = clamp(getIo(slotPtr, 4), 0.0, 0.35);

  setState(slotPtr, 0, pressurePa);
  setState(slotPtr, 1, tempC);
  setState(slotPtr, 2, sl);
  setState(slotPtr, 3, sg);
  setState(slotPtr, 4, salinity);

  // ── Relative Permeability Models (IRP) ─────────────────────────────────────
  if (archetypeId == ARCH_IRP1_LINEAR) {
    const rp1 = getCon(slotPtr, conCount, 0, 0.0);
    const rp2 = getCon(slotPtr, conCount, 1, 0.0);
    const rp3 = getCon(slotPtr, conCount, 2, 1.0);
    const rp4 = getCon(slotPtr, conCount, 3, 1.0);
    const krl = clamp((sl - rp1) / Math.max(1e-9, rp3 - rp1), 0.0, 1.0);
    const krg = clamp((sg - rp2) / Math.max(1e-9, rp4 - rp2), 0.0, 1.0);
    setIo(slotPtr, 6, krl);
    setIo(slotPtr, 7, krg);
    return 0;
  }

  if (archetypeId == ARCH_IRP3_COREY) {
    const slr = getCon(slotPtr, conCount, 0, 0.3);
    const sgr = getCon(slotPtr, conCount, 1, 0.05);
    const sHat = coreySHat(sl, slr, sgr);
    const s2 = sHat * sHat;
    const krl = s2 * s2;
    const oneMinusS = 1.0 - sHat;
    const krg = oneMinusS * oneMinusS * (1.0 - s2);
    setIo(slotPtr, 6, clamp(krl, 0.0, 1.0));
    setIo(slotPtr, 7, clamp(krg, 0.0, 1.0));
    return 0;
  }

  if (archetypeId == ARCH_IRP4_GRANT) {
    const slr = getCon(slotPtr, conCount, 0, 0.3);
    const sgr = getCon(slotPtr, conCount, 1, 0.05);
    const sHat = coreySHat(sl, slr, sgr);
    const s2 = sHat * sHat;
    const krl = clamp(s2 * s2, 0.0, 1.0);
    const krg = clamp(1.0 - krl, 0.0, 1.0);
    setIo(slotPtr, 6, krl);
    setIo(slotPtr, 7, krg);
    return 0;
  }

  if (archetypeId == ARCH_IRP7_VANGENUCHTEN) {
    const lambda = getCon(slotPtr, conCount, 0, 0.457);
    const slr = getCon(slotPtr, conCount, 1, 0.15);
    const sls = getCon(slotPtr, conCount, 2, 1.0);
    const sgr = getCon(slotPtr, conCount, 3, 0.05);
    const krl = evalVgKrl(sl, lambda, slr, sls);
    let krg: f64;
    if (sgr <= 0.0) {
      krg = clamp(1.0 - krl, 0.0, 1.0);
    } else {
      const sHat = coreySHat(sl, slr, sgr);
      const oneMinusS = 1.0 - sHat;
      krg = clamp(oneMinusS * oneMinusS * (1.0 - sHat * sHat), 0.0, 1.0);
    }
    setIo(slotPtr, 6, krl);
    setIo(slotPtr, 7, krg);
    return 0;
  }

  if (archetypeId == ARCH_IRP8_VERMA) {
    const slr = getCon(slotPtr, conCount, 0, 0.2);
    const sgr = getCon(slotPtr, conCount, 1, 0.05);
    const a = getCon(slotPtr, conCount, 2, 1.259);
    const b = getCon(slotPtr, conCount, 3, -1.7615);
    const c = getCon(slotPtr, conCount, 4, 0.5089);
    const sHat = coreySHat(sl, slr, sgr);
    const krl = clamp(sHat * sHat * sHat, 0.0, 1.0);
    const krg = clamp(a + b * sHat + c * sHat * sHat, 0.0, 1.0);
    setIo(slotPtr, 6, krl);
    setIo(slotPtr, 7, krg);
    return 0;
  }

  if (archetypeId == ARCH_IRP11_STONE) {
    const slr = getCon(slotPtr, conCount, 0, 0.2);
    const sgr = getCon(slotPtr, conCount, 1, 0.05);
    const nExp = Math.max(1.0, getCon(slotPtr, conCount, 3, 3.0));
    const sHat = coreySHat(sl, slr, sgr);
    const krl = clamp(Math.pow(sHat, nExp), 0.0, 1.0);
    const krg = clamp(Math.pow(1.0 - sHat, nExp), 0.0, 1.0);
    setIo(slotPtr, 6, krl);
    setIo(slotPtr, 7, krg);
    return 0;
  }

  // ── Capillary Pressure Models (ICP) ────────────────────────────────────────
  if (archetypeId == ARCH_ICP1_LINEAR) {
    const pMax = Math.abs(getCon(slotPtr, conCount, 0, 1.0e5));
    const slMin = getCon(slotPtr, conCount, 1, 0.1);
    const slMax = getCon(slotPtr, conCount, 2, 1.0);
    let pcap: f64;
    if (sl <= slMin) {
      pcap = -pMax;
    } else if (sl >= slMax) {
      pcap = 0.0;
    } else {
      pcap = -pMax * ((slMax - sl) / Math.max(1e-9, slMax - slMin));
    }
    setIo(slotPtr, 8, pcap);
    return 0;
  }

  if (archetypeId == ARCH_ICP3_PICKENS) {
    const p0 = Math.abs(getCon(slotPtr, conCount, 0, 5.0e4));
    const slr = getCon(slotPtr, conCount, 1, 0.1);
    const sl0 = getCon(slotPtr, conCount, 2, 1.0);
    const xExp = Math.max(0.1, getCon(slotPtr, conCount, 3, 1.5));
    const sEff = clamp((sl - slr) / Math.max(1e-9, sl0 - slr), 1e-4, 1.0);
    const a = 1.0 + Math.pow(sEff, -1.0 / xExp);
    const pcap = -p0 * Math.log(Math.max(1.0, a));
    setIo(slotPtr, 8, Math.min(0.0, pcap));
    return 0;
  }

  if (archetypeId == ARCH_ICP4_TRUST) {
    const p0 = Math.abs(getCon(slotPtr, conCount, 0, 1.0e4));
    const slr = getCon(slotPtr, conCount, 1, 0.1);
    const eta = Math.max(0.1, getCon(slotPtr, conCount, 2, 2.0));
    const pe = Math.abs(getCon(slotPtr, conCount, 3, 1.0e3));
    if (sl >= 1.0) {
      setIo(slotPtr, 8, 0.0);
    } else {
      const sEff = clamp((sl - slr) / Math.max(1e-9, 1.0 - slr), 1e-4, 1.0);
      const pcap = -(pe + p0 * Math.pow((1.0 - sEff) / sEff, 1.0 / eta));
      setIo(slotPtr, 8, Math.max(-1.0e8, pcap));
    }
    return 0;
  }

  if (archetypeId == ARCH_ICP7_VANGENUCHTEN) {
    const lambda = getCon(slotPtr, conCount, 0, 0.457);
    const slr = getCon(slotPtr, conCount, 1, 0.15);
    const alpha = getCon(slotPtr, conCount, 2, 1.0e-4);
    const pMax = getCon(slotPtr, conCount, 3, 1.0e7);
    const sls = getCon(slotPtr, conCount, 4, 1.0);
    const pcap = evalVgPcap(sl, lambda, slr, alpha, pMax, sls);
    setIo(slotPtr, 8, pcap);
    return 0;
  }

  if (archetypeId == ARCH_ICP8_LEVERETT) {
    const sigma = Math.max(1e-4, getCon(slotPtr, conCount, 0, 0.072));
    const phi = clamp(getCon(slotPtr, conCount, 1, 0.2), 1e-4, 0.99);
    const perm = Math.max(1e-22, getCon(slotPtr, conCount, 2, 1.0e-13));
    const slr = getCon(slotPtr, conCount, 3, 0.15);
    const sEff = clamp((sl - slr) / Math.max(1e-9, 1.0 - slr), 1e-4, 1.0);
    const jFunc = 1.417 * (1.0 - sEff) - 2.12 * (1.0 - sEff) * (1.0 - sEff) + 1.263 * Math.pow(1.0 - sEff, 3.0);
    const pcap = -sigma * Math.sqrt(phi / perm) * Math.max(0.0, jFunc);
    setIo(slotPtr, 8, Math.min(0.0, pcap));
    return 0;
  }

  // ── Equation-of-State (EOS) Modules ────────────────────────────────────────
  if (archetypeId == ARCH_EOS1_WATER) {
    const betaT = getCon(slotPtr, conCount, 2, 4.5e-10);
    const tk = clamp(tempC + 273.15, 273.15, 647.096);
    const pMPa = pressurePa * 1.0e-6;
    const pSat = iapwsSatPressurePa(tempC);
    const rhoL = waterLiquidDensity(pressurePa, tempC, betaT);
    const muL = waterLiquidViscosity(tempC);
    // Steam density via compressibility-corrected ideal gas law (R_v = 461.52 J/(kg*K))
    const zSteam = clamp(1.0 - 0.18 * (pressurePa / 2.2064e7) * (647.096 / tk), 0.55, 1.0);
    const rhoG = pressurePa / (zSteam * 461.52 * tk);
    const hL = evalIapws97LiquidEnthalpyKJkg(pMPa, tk) * 1000.0;
    const hG = evalIapws97SteamEnthalpyKJkg(pMPa, tk) * 1000.0;

    setState(slotPtr, 6, hG);
    setIo(slotPtr, 9, rhoL);
    setIo(slotPtr, 10, rhoG);
    setIo(slotPtr, 11, muL);
    setIo(slotPtr, 12, pSat);
    setIo(slotPtr, 13, hL);
    return 0;
  }

  if (archetypeId == ARCH_EOS9_RICHARDS) {
    const perm = Math.max(1e-22, getCon(slotPtr, conCount, 0, 1.0e-12));
    const lambda = getCon(slotPtr, conCount, 1, 0.457);
    const slr = getCon(slotPtr, conCount, 2, 0.15);
    const sls = getCon(slotPtr, conCount, 3, 1.0);
    const alpha = getCon(slotPtr, conCount, 4, 1.0e-4);

    const rhoL = waterLiquidDensity(pressurePa, tempC, 4.5e-10);
    const muL = waterLiquidViscosity(tempC);
    const krl = evalVgKrl(sl, lambda, slr, sls);
    const pcap = evalVgPcap(sl, lambda, slr, alpha, 1.0e7, sls);
    const kSat = (perm * rhoL * 9.80665) / muL;
    const kEff = kSat * krl;

    setIo(slotPtr, 6, krl);
    setIo(slotPtr, 7, 1.0 - krl);
    setIo(slotPtr, 8, pcap);
    setIo(slotPtr, 9, rhoL);
    setIo(slotPtr, 11, muL);
    setIo(slotPtr, 12, iapwsSatPressurePa(tempC));
    setIo(slotPtr, 15, kEff);
    return 0;
  }

  if (archetypeId == ARCH_ECO2N_CO2_BRINE) {
    const xs = salinity > 0.0 ? salinity : getCon(slotPtr, conCount, 0, 0.05);
    const tcCo2 = getCon(slotPtr, conCount, 1, 304.1282);
    const pcCo2 = getCon(slotPtr, conCount, 2, 7.3773e6);
    const kSalting = getCon(slotPtr, conCount, 3, 0.12);

    const tk = clamp(tempC + 273.15, 273.15, 573.15);
    const pSat = iapwsSatPressurePa(tempC);
    const rhoPureWater = waterLiquidDensity(pressurePa, tempC, 4.5e-10);
    // Brine density increases with NaCl mass fraction (~750 kg/m^3 per unit mass fraction)
    const rhoBrine = rhoPureWater + 750.0 * xs;
    const muBrine = waterLiquidViscosity(tempC) * (1.0 + 1.85 * xs + 4.1 * xs * xs);

    // Supercritical / gaseous CO2 density (cleanroom Span-Wagner reduced-state correlation)
    const pBar = pressurePa * 1.0e-5;
    const pr = pressurePa / pcCo2;
    const tr = tk / tcCo2;
    const rCo2: f64 = 188.924; // J/(kg*K)
    let rhoCo2: f64;
    if (pr > 1.0 && tr > 0.95 && tr < 1.5) {
      // Dense supercritical fluid regime (~600-850 kg/m^3 at 10-20 MPa, 40-50 degC)
      const zSc = clamp(0.28 + 0.18 * (tr - 1.0) + 0.08 * pr, 0.22, 0.95);
      rhoCo2 = clamp(pressurePa / (zSc * rCo2 * tk), 150.0, 1050.0);
    } else {
      const zGas = clamp(1.0 - 0.12 * (pr / Math.max(0.5, tr * tr)), 0.35, 1.0);
      rhoCo2 = clamp(pressurePa / (zGas * rCo2 * tk), 0.1, 1050.0);
    }

    // Dissolved CO2 mass fraction in brine (Spycher-Pruess style Henry + Setschenow salting-out)
    const molalityNaCl = xs / (0.05844 * Math.max(0.5, 1.0 - xs));
    const saltingFactor = Math.exp(-kSalting * molalityNaCl);
    const tempFactor = Math.exp(-0.015 * (tempC - 25.0));
    const pEffBar = Math.min(pBar, 250.0);
    // Saturating solubility curve: ~0.04-0.065 mass fraction at 10-15 MPa, 40-50 degC in fresh water
    const xCo2Aq = clamp(((0.00145 * pEffBar) / (1.0 + 0.018 * pEffBar)) * tempFactor * saltingFactor, 0.0, 0.08);
    // Dissolved CO2 slightly increases brine density (~0.25 * rho_w * X_co2)
    const rhoL = rhoBrine * (1.0 + 0.25 * xCo2Aq);

    setIo(slotPtr, 9, rhoL);
    setIo(slotPtr, 10, rhoCo2);
    setIo(slotPtr, 11, muBrine);
    setIo(slotPtr, 12, pSat);
    setIo(slotPtr, 13, evalIapws97LiquidEnthalpyKJkg(pressurePa * 1.0e-6, tk) * 1000.0 * (1.0 - 0.8 * xs));
    setIo(slotPtr, 14, xCo2Aq);
    return 0;
  }

  if (
    archetypeId == ARCH_EOS2_WATER_CO2 ||
    archetypeId == ARCH_EOS3_WATER_AIR ||
    archetypeId == ARCH_EOS4_VAPOR_LOWERING ||
    archetypeId == ARCH_EOS5_WATER_H2 ||
    archetypeId == ARCH_EOS7_BRINE ||
    archetypeId == ARCH_EOS7C_CH4_CO2 ||
    archetypeId == ARCH_EWASG_SALT_GAS ||
    archetypeId == ARCH_TMVOC_VOC
  ) {
    const tk = clamp(tempC + 273.15, 273.15, 620.0);
    let pSat = iapwsSatPressurePa(tempC);
    const rhoPure = waterLiquidDensity(pressurePa, tempC, 4.5e-10);
    const rhoL =
      archetypeId == ARCH_EOS7_BRINE || archetypeId == ARCH_EWASG_SALT_GAS || archetypeId == ARCH_EOS7C_CH4_CO2
        ? rhoPure + 750.0 * salinity
        : rhoPure;
    const muL = waterLiquidViscosity(tempC) * (1.0 + 1.85 * salinity);

    // Kelvin vapor pressure lowering for EOS4
    if (archetypeId == ARCH_EOS4_VAPOR_LOWERING) {
      const pcap = evalVgPcap(sl, 0.457, 0.15, 1.0e-4, 1.0e7, 1.0);
      const kelvin = Math.exp((0.018015 * pcap) / (rhoL * 8.314462618 * tk));
      pSat = pSat * clamp(kelvin, 0.01, 1.0);
      setIo(slotPtr, 8, pcap);
    }

    // Gas-phase density by NCG species molar mass
    let molarMass: f64 = 0.02896; // air
    if (archetypeId == ARCH_EOS2_WATER_CO2 || archetypeId == ARCH_EOS7C_CH4_CO2) molarMass = 0.04401;
    else if (archetypeId == ARCH_EOS5_WATER_H2) molarMass = 0.002016;
    else if (archetypeId == ARCH_TMVOC_VOC) molarMass = 0.09214;

    const rhoG = (pressurePa * molarMass) / (8.314462618 * tk);
    setIo(slotPtr, 9, rhoL);
    setIo(slotPtr, 10, rhoG);
    setIo(slotPtr, 11, muL);
    setIo(slotPtr, 12, pSat);
    setIo(slotPtr, 13, evalIapws97LiquidEnthalpyKJkg(pressurePa * 1.0e-6, tk) * 1000.0);
    return 0;
  }

  return -1;
}

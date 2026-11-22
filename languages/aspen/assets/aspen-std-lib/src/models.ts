// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript process & thermodynamic runtime for `@modelscript/aspen-std-lib`.
 *
 * Implements public chemical engineering correlations (Antoine vapor pressure, Rachford-Rice
 * isothermal VLE flash, Peng-Robinson / SRK cubic EOS compressibility Z & fugacity, isentropic
 * compressor / centrifugal pump shaft work, countercurrent LMTD / epsilon-NTU heat exchanger,
 * and Arrhenius CSTR/PFR reactors) using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — model parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — internal state / converged variables
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — residuals / derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — process stream & thermo I/O bus:
 *       Inputs:
 *         IO[0] = T_in (K)             IO[1] = P_in (Pa)
 *         IO[2] = F_in (mol/s)         IO[3] = z1 (light mole fraction, 0..1)
 *         IO[4] = T_cold_in / T_spec   IO[5] = P_out_spec / F_cold
 *         IO[6] = Cp_hot / gamma       IO[7] = Cp_cold / UA
 *       Outputs:
 *         IO[8]  = T_out (K)           IO[9]  = P_out (Pa)
 *         IO[10] = V_frac / X / T_cOut IO[11] = Q_duty / W_shaft (W)
 *         IO[12] = Z_factor / LMTD / x1
 *         IO[13] = phi_fug / y1 / P_sat (Pa)
 *         IO[14] = K1 / Z_liq / dP     IO[15] = K2 / residual
 */

import {
  evalIapws97PsatMPa,
  evalIapws97TsatK,
  evalMulticompRachfordRice,
  evalPengRobinsonPhi,
  evalPengRobinsonZ,
  solveTridiagonalThomas,
} from "../../../../../packages/runtime/assembly/physics/thermo-eos";

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Static zero-GC scratch buffers for multicomponent Rachford-Rice & RadFrac TDMA
const FLASH_Z_PTR: usize = memory.data(16 * 8);
const FLASH_K_PTR: usize = memory.data(16 * 8);
const TDMA_A_PTR: usize = memory.data(32 * 8);
const TDMA_B_PTR: usize = memory.data(32 * 8);
const TDMA_C_PTR: usize = memory.data(32 * 8);
const TDMA_D_PTR: usize = memory.data(32 * 8);
const TDMA_X_PTR: usize = memory.data(32 * 8);

const R_GAS: f64 = 8.31446261815324; // J / (mol * K)
const LN10: f64 = 2.302585092994046;
const SQRT2: f64 = 1.4142135623730951;

// Archetype IDs (must match `AspenArchetypeId` in aspen-std-schemas.ts)
const ARCH_FLASH2: i32 = 1;
const ARCH_FLASH3: i32 = 2;
const ARCH_RADFRAC: i32 = 3;
const ARCH_DSTWU: i32 = 4;
const ARCH_SEP: i32 = 5;

const ARCH_HEATER: i32 = 10;
const ARCH_HEATX: i32 = 11;

const ARCH_MIXER: i32 = 20;
const ARCH_FSPLIT: i32 = 21;

const ARCH_PUMP: i32 = 30;
const ARCH_COMPR: i32 = 31;
const ARCH_MCOMPR: i32 = 32;
const ARCH_VALVE: i32 = 33;
const ARCH_PIPE: i32 = 34;

const ARCH_RCSTR: i32 = 40;
const ARCH_RPLUG: i32 = 41;
const ARCH_RSTOIC: i32 = 42;
const ARCH_RGIBBS: i32 = 43;
const ARCH_REQUIL: i32 = 44;

const ARCH_EOS_PENG_ROB: i32 = 50;
const ARCH_EOS_SRK: i32 = 51;
const ARCH_ACT_NRTL: i32 = 52;
const ARCH_ACT_UNIQUAC: i32 = 53;
const ARCH_ACT_WILSON: i32 = 54;
const ARCH_THERMO_IDEAL: i32 = 55;
const ARCH_THERMO_STEAM_TA: i32 = 56;
const ARCH_ACT_ELECNRTL: i32 = 57;

const ARCH_PURE_COMPONENT: i32 = 60;

@inline
function clamp(x: f64, lo: f64, hi: f64): f64 {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

@inline
function cbrtSafe(x: f64): f64 {
  if (x == 0.0) return 0.0;
  return x < 0.0 ? -Math.pow(-x, 1.0 / 3.0) : Math.pow(x, 1.0 / 3.0);
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
 * Antoine vapor pressure in Pa from NIST Chemistry WebBook coefficients:
 *   log10(P_bar) = A - B / (T_K + C)
 */
@inline
function antoinePsatPa(T: f64, A: f64, B: f64, C: f64): f64 {
  const denom = T + C;
  if (denom <= 1.0) return 1.0;
  const log10Pbar = clamp(A - B / denom, -12.0, 12.0);
  return 100000.0 * Math.exp(log10Pbar * LN10);
}

/**
 * Peng-Robinson (1976) ln(phi) for a given compressibility Z > B.
 */
@inline
function prLnPhi(Z: f64, A: f64, B: f64): f64 {
  if (Z <= B + 1e-12) return 1e30;
  const term1 = Z - 1.0 - Math.log(Z - B);
  const num = Z + (1.0 + SQRT2) * B;
  const den = Z + (1.0 - SQRT2) * B;
  if (num <= 0.0 || den <= 0.0) return 1e30;
  return term1 - (A / (2.0 * SQRT2 * B)) * Math.log(num / den);
}

/**
 * SRK (1972) ln(phi) for a given compressibility Z > B.
 */
@inline
function srkLnPhi(Z: f64, A: f64, B: f64): f64 {
  if (Z <= B + 1e-12) return 1e30;
  return Z - 1.0 - Math.log(Z - B) - (A / B) * Math.log(1.0 + B / Z);
}

/**
 * Solves cubic EOS Z^3 + c2*Z^2 + c1*Z + c0 = 0 and selects the thermodynamically
 * stable root (minimum Gibbs energy / ln(phi)) with Z > B.
 * Stores Z in STATE[0], Z_min in STATE[1], and phi in STATE[2].
 */
function solveCubicEos(
  slotPtr: usize,
  T: f64,
  P: f64,
  Tc: f64,
  Pc: f64,
  omega: f64,
  isSrk: bool,
): void {
  const Tr = Math.max(0.05, T / Math.max(1.0, Tc));
  const kappa = isSrk
    ? 0.48 + 1.574 * omega - 0.176 * omega * omega
    : 0.37464 + 1.54226 * omega - 0.26992 * omega * omega;
  const sqrtTr = Math.sqrt(Tr);
  const alphaRoot = 1.0 + kappa * (1.0 - sqrtTr);
  const alpha = alphaRoot * alphaRoot;

  const omegaA: f64 = isSrk ? 0.42748023354 : 0.45723552892;
  const omegaB: f64 = isSrk ? 0.08664034996 : 0.07779607390;

  const RT = R_GAS * Math.max(1.0, T);
  const a = (omegaA * R_GAS * R_GAS * Tc * Tc * alpha) / Math.max(1.0, Pc);
  const b = (omegaB * R_GAS * Tc) / Math.max(1.0, Pc);
  const A = (a * P) / (RT * RT);
  const B = Math.max(1e-12, (b * P) / RT);

  const c2 = isSrk ? -1.0 : -(1.0 - B);
  const c1 = isSrk ? A - B - B * B : A - 3.0 * B * B - 2.0 * B;
  const c0 = isSrk ? -A * B : -(A * B - B * B - B * B * B);

  const p = c1 - (c2 * c2) / 3.0;
  const q = (2.0 * c2 * c2 * c2) / 27.0 - (c2 * c1) / 3.0 + c0;
  const disc = (q * q) / 4.0 + (p * p * p) / 27.0;

  let zBest: f64 = 1.0;
  let zLiq: f64 = 1.0;
  let lnPhiBest: f64 = 0.0;

  if (disc > 0.0) {
    if (!isSrk) {
      zBest = evalPengRobinsonZ(T, P, Tc, Pc, omega);
    } else {
      const sqrtD = Math.sqrt(disc);
      const u = cbrtSafe(-q * 0.5 + sqrtD);
      const v = cbrtSafe(-q * 0.5 - sqrtD);
      zBest = Math.max(B + 1e-9, u + v - c2 / 3.0);
    }
    zLiq = zBest;
    lnPhiBest = isSrk ? srkLnPhi(zBest, A, B) : prLnPhi(zBest, A, B);
  } else {
    const r = 2.0 * Math.sqrt(Math.max(0.0, -p / 3.0));
    const cosArg = r > 1e-15 ? clamp((3.0 * q) / (p * r), -1.0, 1.0) : 0.0;
    const theta = Math.acos(cosArg) / 3.0;
    const shift = c2 / 3.0;
    const r1 = r * Math.cos(theta) - shift;
    const r2 = r * Math.cos(theta + (2.0 * Math.PI) / 3.0) - shift;
    const r3 = r * Math.cos(theta + (4.0 * Math.PI) / 3.0) - shift;

    // Sort roots: zMax (vapor) and zMin (liquid > B)
    let zMax = r1;
    if (r2 > zMax) zMax = r2;
    if (r3 > zMax) zMax = r3;

    let zMin = zMax;
    if (r1 > B + 1e-9 && r1 < zMin) zMin = r1;
    if (r2 > B + 1e-9 && r2 < zMin) zMin = r2;
    if (r3 > B + 1e-9 && r3 < zMin) zMin = r3;

    const lnPhiMax = isSrk ? srkLnPhi(zMax, A, B) : prLnPhi(zMax, A, B);
    const lnPhiMin = isSrk ? srkLnPhi(zMin, A, B) : prLnPhi(zMin, A, B);

    zLiq = zMin;
    if (lnPhiMin < lnPhiMax) {
      zBest = zMin;
      lnPhiBest = lnPhiMin;
    } else {
      zBest = zMax;
      lnPhiBest = lnPhiMax;
    }
  }

  let phi: f64;
  let kVle: f64 = 0.0;
  if (!isSrk) {
    const phiV = evalPengRobinsonPhi(T, P, Tc, Pc, omega, 0);
    const phiL = evalPengRobinsonPhi(T, P, Tc, Pc, omega, 1);
    phi = phiL < phiV ? phiL : phiV;
    kVle = phiV > 1e-12 ? phiL / phiV : 1.0;
  } else {
    phi = Math.exp(clamp(lnPhiBest, -40.0, 40.0));
  }
  setState(slotPtr, 0, zBest);
  setState(slotPtr, 1, zLiq);
  setState(slotPtr, 2, phi);
  setIo(slotPtr, 8, T);
  setIo(slotPtr, 9, P);
  setIo(slotPtr, 12, zBest);
  setIo(slotPtr, 13, phi);
  setIo(slotPtr, 14, zLiq);
  setIo(slotPtr, 15, kVle);
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function aspenGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes an Aspen model slot and returns the number of active state variables.
 */
export function aspenModelInit(archetypeId: i32, slotPtr: usize, _conCount: i32): i32 {
  for (let i: i32 = 0; i < 8; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }
  if (
    archetypeId == ARCH_FLASH2 ||
    archetypeId == ARCH_FLASH3 ||
    archetypeId == ARCH_RADFRAC ||
    archetypeId == ARCH_DSTWU
  ) {
    setState(slotPtr, 0, 0.5); // initial vapor fraction guess
    return 3;
  }
  if (archetypeId == ARCH_EOS_PENG_ROB || archetypeId == ARCH_EOS_SRK || archetypeId == ARCH_PURE_COMPONENT) {
    setState(slotPtr, 0, 1.0); // initial Z guess
    return 3;
  }
  return 2;
}

/**
 * Evaluates a cleanroom Aspen unit operation, thermodynamic property method, or pure component.
 * Returns 0 on convergence, non-zero on invalid archetype.
 */
export function aspenModelEval(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  const T_in = getIo(slotPtr, 0) > 1.0 ? getIo(slotPtr, 0) : 298.15;
  const P_in = getIo(slotPtr, 1) > 1.0 ? getIo(slotPtr, 1) : 101325.0;
  const F_in = getIo(slotPtr, 2) > 0.0 ? getIo(slotPtr, 2) : 100.0;
  const z1 = clamp(getIo(slotPtr, 3) > 0.0 ? getIo(slotPtr, 3) : 0.5, 0.0, 1.0);

  // ── Separators & Columns ──────────────────────────────────────────────────────────
  if (archetypeId == ARCH_FLASH2 || archetypeId == ARCH_FLASH3) {
    const T_flash = getIo(slotPtr, 4) > 1.0 ? getIo(slotPtr, 4) : getCon(slotPtr, conCount, 0, T_in);
    const P_flash = getIo(slotPtr, 5) > 1.0 ? getIo(slotPtr, 5) : getCon(slotPtr, conCount, 1, P_in);
    const A1 = getCon(slotPtr, conCount, 2, 4.01814);
    const B1 = getCon(slotPtr, conCount, 3, 1203.835);
    const C1 = getCon(slotPtr, conCount, 4, -53.226);
    const A2 = getCon(slotPtr, conCount, 5, 4.07827);
    const B2 = getCon(slotPtr, conCount, 6, 1343.943);
    const C2 = getCon(slotPtr, conCount, 7, -53.773);
    const dH_vap = getCon(slotPtr, conCount, 8, 32000.0);
    const Cp_liq = getCon(slotPtr, conCount, 9, 140.0);

    const K1 = antoinePsatPa(T_flash, A1, B1, C1) / Math.max(1.0, P_flash);
    const K2 = antoinePsatPa(T_flash, A2, B2, C2) / Math.max(1.0, P_flash);
    store<f64>(FLASH_Z_PTR, z1);
    store<f64>(FLASH_Z_PTR + 8, 1.0 - z1);
    store<f64>(FLASH_K_PTR, Math.max(1e-12, K1));
    store<f64>(FLASH_K_PTR + 8, Math.max(1e-12, K2));
    const beta = evalMulticompRachfordRice(2, FLASH_Z_PTR, FLASH_K_PTR);
    const x1 = clamp(z1 / (1.0 + beta * (K1 - 1.0)), 0.0, 1.0);
    const y1 = clamp(K1 * x1, 0.0, 1.0);
    const Q_duty = F_in * (Cp_liq * (T_flash - T_in) + beta * dH_vap);

    setState(slotPtr, 0, beta);
    setState(slotPtr, 1, x1);
    setState(slotPtr, 2, y1);
    setIo(slotPtr, 8, T_flash);
    setIo(slotPtr, 9, P_flash);
    setIo(slotPtr, 10, beta);
    setIo(slotPtr, 11, Q_duty);
    setIo(slotPtr, 12, x1);
    setIo(slotPtr, 13, y1);
    setIo(slotPtr, 14, K1);
    setIo(slotPtr, 15, K2);
    return 0;
  }

  if (archetypeId == ARCH_RADFRAC || archetypeId == ARCH_DSTWU) {
    const alpha = Math.max(1.01, archetypeId == ARCH_RADFRAC ? getCon(slotPtr, conCount, 5, 2.4) : getCon(slotPtr, conCount, 2, 2.4));
    const nStages = archetypeId == ARCH_RADFRAC ? Math.max(2.0, getCon(slotPtr, conCount, 0, 20.0)) : 12.0;
    const dOverF = archetypeId == ARCH_RADFRAC ? clamp(getCon(slotPtr, conCount, 2, 0.5), 0.01, 0.99) : clamp(z1, 0.05, 0.95);
    const P_top = archetypeId == ARCH_RADFRAC ? getCon(slotPtr, conCount, 3, P_in) : getCon(slotPtr, conCount, 4, P_in);
    const reflux = archetypeId == ARCH_RADFRAC ? Math.max(0.1, getCon(slotPtr, conCount, 1, 2.0)) : 2.0;

    // Stage-by-stage MESH component tridiagonal balance via Thomas TDMA for RadFrac
    let xDist: f64;
    let xBot: f64;
    const nMesh = <i32>clamp(Math.round(nStages), 3.0, 32.0);
    if (archetypeId == ARCH_RADFRAC) {
      const feedStage = nMesh >> 1;
      const L = reflux * dOverF;
      const V = (reflux + 1.0) * dOverF;
      const B = Math.max(1e-4, 1.0 - dOverF);
      const Lstrip = L + 1.0;
      // Geometric mean K for light component around K_light = sqrt(alpha)
      const kLight = Math.sqrt(alpha);
      for (let j = 0; j < nMesh; j++) {
        const off = <usize>j << 3;
        const lIn = j == 0 ? 0.0 : j <= feedStage ? L : Lstrip;
        const lOut = j < feedStage ? L : j < nMesh - 1 ? Lstrip : B;
        const vOut = j == 0 ? dOverF : V;
        const vIn = j < nMesh - 1 ? V : 0.0;
        store<f64>(TDMA_A_PTR + off, lIn);
        store<f64>(TDMA_B_PTR + off, -(lOut + vOut * kLight));
        store<f64>(TDMA_C_PTR + off, vIn * kLight);
        store<f64>(TDMA_D_PTR + off, j == feedStage ? -z1 : 0.0);
      }
      const rc = solveTridiagonalThomas(nMesh, TDMA_A_PTR, TDMA_B_PTR, TDMA_C_PTR, TDMA_D_PTR, TDMA_X_PTR);
      if (rc == 0) {
        xDist = clamp(load<f64>(TDMA_X_PTR) * kLight, 0.0, 0.9999);
        xBot = clamp(load<f64>(TDMA_X_PTR + (<usize>(nMesh - 1) << 3)), 0.0001, 1.0);
      } else {
        const sepFactor = Math.pow(alpha, Math.min(nStages * 0.65, 30.0));
        const ratio = (z1 / Math.max(1e-6, 1.0 - z1)) * Math.sqrt(sepFactor);
        xDist = clamp(ratio / (1.0 + ratio), 0.0, 0.9999);
        xBot = clamp((z1 - dOverF * xDist) / Math.max(1e-6, 1.0 - dOverF), 0.0001, 1.0);
      }
    } else {
      // Fenske shortcut separation factor alpha^N_eff
      const sepFactor = Math.pow(alpha, Math.min(nStages * 0.65, 30.0));
      const ratio = (z1 / Math.max(1e-6, 1.0 - z1)) * Math.sqrt(sepFactor);
      xDist = clamp(ratio / (1.0 + ratio), 0.0, 0.9999);
      xBot = clamp((z1 - dOverF * xDist) / Math.max(1e-6, 1.0 - dOverF), 0.0001, 1.0);
    }
    const Q_reb = F_in * dOverF * (1.0 + reflux) * 32000.0;

    setIo(slotPtr, 8, T_in);
    setIo(slotPtr, 9, P_top);
    setIo(slotPtr, 10, dOverF);
    setIo(slotPtr, 11, Q_reb);
    setIo(slotPtr, 12, xBot);
    setIo(slotPtr, 13, xDist);
    setIo(slotPtr, 14, alpha);
    setIo(slotPtr, 15, 0.0);
    return 0;
  }

  if (archetypeId == ARCH_SEP) {
    const s1 = clamp(getCon(slotPtr, conCount, 0, 0.95), 0.0, 1.0);
    const s2 = clamp(getCon(slotPtr, conCount, 1, 0.05), 0.0, 1.0);
    const P_out = getCon(slotPtr, conCount, 2, P_in);
    const topFlowFrac = z1 * s1 + (1.0 - z1) * s2;
    const y1 = topFlowFrac > 1e-12 ? (z1 * s1) / topFlowFrac : z1;
    setIo(slotPtr, 8, T_in);
    setIo(slotPtr, 9, P_out);
    setIo(slotPtr, 10, topFlowFrac);
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 13, y1);
    setIo(slotPtr, 15, 0.0);
    return 0;
  }

  // ── Heat Transfer ─────────────────────────────────────────────────────────────────
  if (archetypeId == ARCH_HEATER) {
    const T_out = getIo(slotPtr, 4) > 1.0 ? getIo(slotPtr, 4) : getCon(slotPtr, conCount, 0, 373.15);
    const dP = getCon(slotPtr, conCount, 1, 0.0);
    const Cp = getIo(slotPtr, 6) > 0.0 ? getIo(slotPtr, 6) : getCon(slotPtr, conCount, 2, 75.3);
    const Q = F_in * Cp * (T_out - T_in);

    setIo(slotPtr, 8, T_out);
    setIo(slotPtr, 9, Math.max(1.0, P_in - dP));
    setIo(slotPtr, 10, 0.0);
    setIo(slotPtr, 11, Q);
    setIo(slotPtr, 15, 0.0);
    return 0;
  }

  if (archetypeId == ARCH_HEATX) {
    const UA = getIo(slotPtr, 7) > 0.0 ? getIo(slotPtr, 7) : getCon(slotPtr, conCount, 0, 10000.0);
    const T_c_in = getIo(slotPtr, 4) > 1.0 ? getIo(slotPtr, 4) : getCon(slotPtr, conCount, 1, 300.0);
    const F_cold = getIo(slotPtr, 5) > 0.0 ? getIo(slotPtr, 5) : getCon(slotPtr, conCount, 2, 100.0);
    const Cp_hot = getIo(slotPtr, 6) > 0.0 ? getIo(slotPtr, 6) : getCon(slotPtr, conCount, 3, 75.3);
    const Cp_cold = getCon(slotPtr, conCount, 4, 75.3);
    const dP_hot = getCon(slotPtr, conCount, 5, 5000.0);

    const Ch = Math.max(1e-6, F_in * Cp_hot);
    const Cc = Math.max(1e-6, F_cold * Cp_cold);
    const Cmin = Ch < Cc ? Ch : Cc;
    const Cmax = Ch > Cc ? Ch : Cc;
    const Cr = Cmin / Cmax;
    const NTU = Math.max(0.0, UA / Cmin);

    let eps: f64;
    if (Math.abs(1.0 - Cr) < 1e-6) {
      eps = NTU / (1.0 + NTU);
    } else {
      const expTerm = Math.exp(-NTU * (1.0 - Cr));
      eps = (1.0 - expTerm) / (1.0 - Cr * expTerm);
    }

    const Q = eps * Cmin * (T_in - T_c_in);
    const T_h_out = T_in - Q / Ch;
    const T_c_out = T_c_in + Q / Cc;

    const dT1 = T_in - T_c_out;
    const dT2 = T_h_out - T_c_in;
    let lmtd: f64;
    if (Math.abs(dT1 - dT2) < 1e-6 || dT1 * dT2 <= 0.0) {
      lmtd = 0.5 * (dT1 + dT2);
    } else {
      lmtd = (dT1 - dT2) / Math.log(dT1 / dT2);
    }

    setState(slotPtr, 0, T_h_out);
    setState(slotPtr, 1, T_c_out);
    setIo(slotPtr, 8, T_h_out);
    setIo(slotPtr, 9, Math.max(1.0, P_in - dP_hot));
    setIo(slotPtr, 10, T_c_out);
    setIo(slotPtr, 11, Q);
    setIo(slotPtr, 12, lmtd);
    setIo(slotPtr, 15, 0.0);
    return 0;
  }

  // ── Mixers & Splitters ────────────────────────────────────────────────────────────
  if (archetypeId == ARCH_MIXER) {
    const P_spec = getCon(slotPtr, conCount, 0, 0.0);
    const T_in2 = getIo(slotPtr, 4) > 1.0 ? getIo(slotPtr, 4) : getCon(slotPtr, conCount, 1, 300.0);
    const F_in2 = getIo(slotPtr, 5) > 0.0 ? getIo(slotPtr, 5) : getCon(slotPtr, conCount, 2, 10.0);
    const F_tot = Math.max(1e-9, F_in + F_in2);
    const T_out = (F_in * T_in + F_in2 * T_in2) / F_tot;
    setIo(slotPtr, 8, T_out);
    setIo(slotPtr, 9, P_spec > 1.0 ? P_spec : P_in);
    setIo(slotPtr, 10, F_tot);
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 15, 0.0);
    return 0;
  }

  if (archetypeId == ARCH_FSPLIT) {
    const split = clamp(getCon(slotPtr, conCount, 0, 0.5), 0.0, 1.0);
    const dP = getCon(slotPtr, conCount, 1, 0.0);
    setIo(slotPtr, 8, T_in);
    setIo(slotPtr, 9, Math.max(1.0, P_in - dP));
    setIo(slotPtr, 10, split);
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 15, 0.0);
    return 0;
  }

  // ── Pressure Changers & Hydraulics ────────────────────────────────────────────────
  if (archetypeId == ARCH_PUMP) {
    const P_out = getIo(slotPtr, 5) > 1.0 ? getIo(slotPtr, 5) : getCon(slotPtr, conCount, 0, 500000.0);
    const eta = clamp(getCon(slotPtr, conCount, 1, 0.75), 0.05, 1.0);
    const rho = Math.max(1.0, getCon(slotPtr, conCount, 2, 998.0));
    const Mw = Math.max(1.0, getCon(slotPtr, conCount, 3, 18.015));
    const Cp = Math.max(1.0, getCon(slotPtr, conCount, 4, 75.3));

    const volFlow = (F_in * Mw * 1e-3) / rho; // m^3/s
    const dP = P_out - P_in;
    const W_shaft = (volFlow * dP) / eta;
    const dT = (W_shaft * (1.0 - eta)) / Math.max(1e-6, F_in * Cp);

    setIo(slotPtr, 8, T_in + dT);
    setIo(slotPtr, 9, P_out);
    setIo(slotPtr, 10, 0.0);
    setIo(slotPtr, 11, W_shaft);
    setIo(slotPtr, 14, dP);
    setIo(slotPtr, 15, 0.0);
    return 0;
  }

  if (archetypeId == ARCH_COMPR || archetypeId == ARCH_MCOMPR) {
    const P_out = getIo(slotPtr, 5) > 1.0 ? getIo(slotPtr, 5) : getCon(slotPtr, conCount, 0, 500000.0);
    const eta_is = clamp(getCon(slotPtr, conCount, 1, 0.78), 0.1, 1.0);
    const gamma = clamp(getIo(slotPtr, 6) > 1.01 ? getIo(slotPtr, 6) : getCon(slotPtr, conCount, 2, 1.4), 1.05, 1.7);
    const eta_mech = clamp(getCon(slotPtr, conCount, 3, 0.98), 0.1, 1.0);
    const nStages = archetypeId == ARCH_MCOMPR ? Math.max(1.0, Math.round(getCon(slotPtr, conCount, 4, 3.0))) : 1.0;

    const rTotal = Math.max(1e-6, P_out / Math.max(1.0, P_in));
    const rStage = Math.pow(rTotal, 1.0 / nStages);
    const expK = (gamma - 1.0) / gamma;
    const T_2s = T_in * Math.pow(rStage, expK);
    // Compressor (rStage >= 1): T_2 = T_1 + (T_2s - T_1)/eta_is
    // Expander/Turbine (rStage < 1): T_2 = T_1 + eta_is * (T_2s - T_1)
    const T_out = rStage >= 1.0 ? T_in + (T_2s - T_in) / eta_is : T_in + eta_is * (T_2s - T_in);
    const Cp = (gamma * R_GAS) / (gamma - 1.0);
    const W_stage = (F_in * Cp * (T_out - T_in)) / eta_mech;
    const W_total = nStages * W_stage;

    setState(slotPtr, 0, T_out);
    setState(slotPtr, 1, W_total);
    setIo(slotPtr, 8, T_out);
    setIo(slotPtr, 9, P_out);
    setIo(slotPtr, 10, 1.0); // vapor phase
    setIo(slotPtr, 11, W_total);
    setIo(slotPtr, 14, P_out - P_in);
    setIo(slotPtr, 15, 0.0);
    return 0;
  }

  if (archetypeId == ARCH_VALVE) {
    const P_out = getIo(slotPtr, 5) > 1.0 ? getIo(slotPtr, 5) : getCon(slotPtr, conCount, 0, 101325.0);
    const muJT = getCon(slotPtr, conCount, 1, 2.0e-6);
    const T_out = Math.max(1.0, T_in + muJT * (P_out - P_in));
    setIo(slotPtr, 8, T_out);
    setIo(slotPtr, 9, P_out);
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 14, P_in - P_out);
    setIo(slotPtr, 15, 0.0);
    return 0;
  }

  if (archetypeId == ARCH_PIPE) {
    const L = Math.max(0.0, getCon(slotPtr, conCount, 0, 100.0));
    const D = Math.max(1e-4, getCon(slotPtr, conCount, 1, 0.1));
    const fD = Math.max(0.0, getCon(slotPtr, conCount, 2, 0.02));
    const rho = Math.max(0.1, getCon(slotPtr, conCount, 3, 998.0));
    const Mw = Math.max(1.0, getCon(slotPtr, conCount, 4, 18.015));

    const area = 0.25 * Math.PI * D * D;
    const vel = (F_in * Mw * 1e-3) / (rho * area);
    const dP = fD * (L / D) * 0.5 * rho * vel * vel;
    setIo(slotPtr, 8, T_in);
    setIo(slotPtr, 9, Math.max(1.0, P_in - dP));
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 14, dP);
    setIo(slotPtr, 15, 0.0);
    return 0;
  }

  // ── Chemical Reactors ─────────────────────────────────────────────────────────────
  if (archetypeId == ARCH_RCSTR || archetypeId == ARCH_RPLUG) {
    const V = Math.max(1e-6, getCon(slotPtr, conCount, 0, 1.0));
    const k0 = Math.max(0.0, getCon(slotPtr, conCount, 1, 1.0e6));
    const Ea = Math.max(0.0, getCon(slotPtr, conCount, 2, 50000.0));
    const dH_rxn = getCon(slotPtr, conCount, 3, -50000.0);
    const c_tot = Math.max(1e-3, getCon(slotPtr, conCount, 4, 1000.0));

    const v0 = Math.max(1e-9, F_in / c_tot); // volumetric flow m^3/s
    const tau = V / v0; // space time (s)
    const k = k0 * Math.exp(clamp(-Ea / (R_GAS * T_in), -80.0, 40.0));
    const Da = k * tau;
    const X = archetypeId == ARCH_RCSTR ? Da / (1.0 + Da) : 1.0 - Math.exp(-Da);
    const Q = F_in * z1 * X * dH_rxn;

    setState(slotPtr, 0, X);
    setState(slotPtr, 1, k);
    setIo(slotPtr, 8, T_in);
    setIo(slotPtr, 9, P_in);
    setIo(slotPtr, 10, clamp(X, 0.0, 1.0));
    setIo(slotPtr, 11, Q);
    setIo(slotPtr, 12, z1 * (1.0 - X)); // unreacted outlet mole fraction
    setIo(slotPtr, 14, Da);
    setIo(slotPtr, 15, 0.0);
    return 0;
  }

  if (archetypeId == ARCH_RSTOIC) {
    const X = clamp(getCon(slotPtr, conCount, 0, 0.85), 0.0, 1.0);
    const dH_rxn = getCon(slotPtr, conCount, 1, -50000.0);
    const Q = F_in * z1 * X * dH_rxn;
    setIo(slotPtr, 8, T_in);
    setIo(slotPtr, 9, P_in);
    setIo(slotPtr, 10, X);
    setIo(slotPtr, 11, Q);
    setIo(slotPtr, 15, 0.0);
    return 0;
  }

  if (archetypeId == ARCH_RGIBBS || archetypeId == ARCH_REQUIL) {
    const dG0_298 = getCon(slotPtr, conCount, 0, -10000.0);
    const dH_rxn = getCon(slotPtr, conCount, 1, -40000.0);
    // van 't Hoff equation: ln(Keq(T)) = -dG0_298/(R*298.15) - (dH/R)*(1/T - 1/298.15)
    const lnK = -dG0_298 / (R_GAS * 298.15) - (dH_rxn / R_GAS) * (1.0 / T_in - 1.0 / 298.15);
    const Keq = Math.exp(clamp(lnK, -40.0, 40.0));
    const X = Keq / (1.0 + Keq);
    const Q = F_in * z1 * X * dH_rxn;
    setIo(slotPtr, 8, T_in);
    setIo(slotPtr, 9, P_in);
    setIo(slotPtr, 10, X);
    setIo(slotPtr, 11, Q);
    setIo(slotPtr, 14, Keq);
    setIo(slotPtr, 15, 0.0);
    return 0;
  }

  // ── Thermodynamic Property Methods ────────────────────────────────────────────────
  if (archetypeId == ARCH_EOS_PENG_ROB || archetypeId == ARCH_EOS_SRK || archetypeId == ARCH_THERMO_STEAM_TA) {
    const Tc = getCon(slotPtr, conCount, 0, 190.564);
    const Pc = getCon(slotPtr, conCount, 1, 4599200.0);
    const omega = getCon(slotPtr, conCount, 2, 0.01142);
    solveCubicEos(slotPtr, T_in, P_in, Tc, Pc, omega, archetypeId == ARCH_EOS_SRK);
    if (archetypeId == ARCH_THERMO_STEAM_TA) {
      const tSat = evalIapws97TsatK(P_in * 1e-6);
      const pSatPa = evalIapws97PsatMPa(T_in) * 1.0e6;
      setState(slotPtr, 3, tSat);
      setState(slotPtr, 4, pSatPa);
      setIo(slotPtr, 13, pSatPa);
    }
    return 0;
  }

  if (archetypeId == ARCH_THERMO_IDEAL) {
    setIo(slotPtr, 8, T_in);
    setIo(slotPtr, 9, P_in);
    setIo(slotPtr, 12, 1.0);
    setIo(slotPtr, 13, 1.0);
    setIo(slotPtr, 15, 0.0);
    return 0;
  }

  if (
    archetypeId == ARCH_ACT_NRTL ||
    archetypeId == ARCH_ACT_UNIQUAC ||
    archetypeId == ARCH_ACT_WILSON ||
    archetypeId == ARCH_ACT_ELECNRTL
  ) {
    const x1 = clamp(z1, 1e-6, 1.0 - 1e-6);
    const x2 = 1.0 - x1;
    let lnGamma1: f64 = 0.0;
    if (archetypeId == ARCH_ACT_WILSON) {
      const L12 = Math.max(1e-6, getCon(slotPtr, conCount, 0, 0.45));
      const L21 = Math.max(1e-6, getCon(slotPtr, conCount, 1, 0.65));
      lnGamma1 = -Math.log(x1 + L12 * x2) + x2 * (L12 / (x1 + L12 * x2) - L21 / (L21 * x1 + x2));
    } else {
      // NRTL / UNIQUAC / ELECNRTL local-composition excess Gibbs
      const tau12 = getCon(slotPtr, conCount, 0, 0.5);
      const tau21 = getCon(slotPtr, conCount, 1, 1.2);
      const alpha12 = getCon(slotPtr, conCount, 2, 0.3);
      const G12 = Math.exp(-alpha12 * tau12);
      const G21 = Math.exp(-alpha12 * tau21);
      const t1 = G21 / (x1 + x2 * G21);
      const t2 = G12 / (x2 + x1 * G12);
      lnGamma1 = x2 * x2 * (tau21 * t1 * t1 + (tau12 * G12) / ((x2 + x1 * G12) * (x2 + x1 * G12)));
      if (archetypeId == ARCH_ACT_ELECNRTL) {
        const ionicStr = Math.max(0.0, getCon(slotPtr, conCount, 3, 0.1));
        // Pitzer-Debye-Huckel long-range correction
        lnGamma1 -= (0.509 * Math.sqrt(ionicStr)) / (1.0 + 1.5 * Math.sqrt(ionicStr));
      }
      // Keep t2 referenced cleanly
      if (t2 < 0.0) lnGamma1 = 0.0;
    }
    const gamma1 = Math.exp(clamp(lnGamma1, -20.0, 20.0));
    setIo(slotPtr, 8, T_in);
    setIo(slotPtr, 9, P_in);
    setIo(slotPtr, 12, 1.0);
    setIo(slotPtr, 13, gamma1);
    setIo(slotPtr, 15, 0.0);
    return 0;
  }

  // ── Pure Component Public Databank ────────────────────────────────────────────────
  if (archetypeId == ARCH_PURE_COMPONENT) {
    const Tc = getCon(slotPtr, conCount, 0, 647.096);
    const Pc = getCon(slotPtr, conCount, 1, 22064000.0);
    const omega = getCon(slotPtr, conCount, 2, 0.3443);
    const A = getCon(slotPtr, conCount, 5, 5.20389);
    const B = getCon(slotPtr, conCount, 6, 1733.926);
    const C = getCon(slotPtr, conCount, 7, -39.485);

    solveCubicEos(slotPtr, T_in, P_in, Tc, Pc, omega, false);
    const Psat = antoinePsatPa(T_in, A, B, C);
    setIo(slotPtr, 13, Psat);
    setIo(slotPtr, 14, Psat / Math.max(1.0, P_in));
    return 0;
  }

  return -1;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Clean-room AssemblyScript dynamic model implementations for `@modelscript/psse-std-lib`.
 *
 * Supports:
 *   1. Legacy ABI v1 exports (15 models): `<MODEL>_init(conPtr, count, statePtr, ioPtr)` and
 *      `<MODEL>_step(t, dt, conPtr, statePtr, ioPtr)` (`ioPtr`: 6 x f64 = 48 bytes).
 *   2. Generalized ABI v2 archetype dispatch (`2048`-byte aligned slot, all 52 unique archetypes):
 *      - `0x000..0x07F` (128 B):  `ICON[32]`   (`i32`)
 *      - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`)
 *      - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`)
 *      - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`)
 *      - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`)
 *      `psseModelInit(archetypeId, slotPtr, iconCount, conCount): i32`
 *      `psseModelEvalDerivatives(archetypeId, t, dt, slotPtr, conCount): void`
 *      `psseModelStep(archetypeId, t, dt, slotPtr, conCount): void` (2nd-order Heun + substepping)
 *      `psseModelCheckFlatStart(archetypeId, slotPtr, conCount): f64`
 *   3. Batched zero-copy ABI v2.1 entrypoints:
 *      `psseBatchInit(count, tablePtr): void`
 *      `psseBatchStep(count, t, dt, tablePtr): void`
 *      (`tablePtr`: `count * 16` bytes of `{ archetypeId: i32, slotPtr: u32, iconCount: i32, conCount: i32 }`)
 */

import {
  OFF_CON,
  SCRATCH_HEUN_K1,
  SCRATCH_HEUN_Y0,
  clamp,
  evalExponentialSat,
  evalFex,
  evalQuadraticSat,
  getCon,
  getDState,
  getSlotNStates,
  getSlotTMin,
  getState,
  setDState,
  setIo,
  setState,
} from "./blocks";
import { evalExciterOrLimiterDerivs, initExciterOrLimiter } from "./exciters";
import { evalFactsHvdcRelayDerivs, initFactsHvdcRelay } from "./facts-hvdc-relays";
import { evalGeneratorDerivs, initGenerator } from "./generators";
import { evalGovernorDerivs, initGovernor } from "./governors";
import { evalIbrDerivs, initIbr } from "./ibr";
import { evalLoadDerivs, initLoad } from "./loads";
import { evalStabilizerDerivs, initStabilizer } from "./stabilizers";

// Re-export core cleanroom blackbox functions for direct WASM testing/invocation
export { evalQuadraticSat, evalExponentialSat, evalFex };

/**
 * Returns the first safe 64-byte-aligned linear-memory offset strictly above AssemblyScript's
 * static data / Math lookup tables (`__heap_base`) for host-allocated descriptor tables & slots.
 */
export function psseGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

const SLOT_META_ICON_COUNT: i32 = 29;

// === Legacy ABI v1 Exports (100% Backwards Compatible) ===

// 1. SEXS — Simplified Excitation System
export function SEXS_init(conPtr: usize, count: i32, statePtr: usize, ioPtr: usize): void {
  const k = getCon(conPtr, count, 2, 100.0);
  const eterm = load<f64>(ioPtr + 0);
  const efd0 = load<f64>(ioPtr + 16);
  const vref = eterm + efd0 / (k > 1e-6 ? k : 100.0);
  store<f64>(statePtr + 0, vref);
  store<f64>(statePtr + 8, efd0);
}

export function SEXS_step(_t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const k = getCon(conPtr, 6, 2, 100.0);
  const te = Math.max(0.01, getCon(conPtr, 6, 3, 0.05));
  const emin = getCon(conPtr, 6, 4, -5.0);
  const emax = getCon(conPtr, 6, 5, 5.0);
  const vref = load<f64>(statePtr + 0);
  let efd = load<f64>(statePtr + 8);
  const eterm = load<f64>(ioPtr + 0);
  const target = k * (vref - eterm);
  // 2nd-order Heun step
  const k1 = (target - efd) / te;
  const pred = clamp(efd + dt * k1, emin, emax);
  const k2 = (target - pred) / te;
  efd = clamp(efd + 0.5 * dt * (k1 + k2), emin, emax);
  store<f64>(statePtr + 8, efd);
  store<f64>(ioPtr + 16, efd);
}

// 2. ESAC1A — IEEE Type AC1A Exciter (with F_EX rectifier regulation)
export function ESAC1A_init(conPtr: usize, count: i32, statePtr: usize, ioPtr: usize): void {
  const ka = getCon(conPtr, count, 3, 200.0);
  const eterm = load<f64>(ioPtr + 0);
  const efd0 = load<f64>(ioPtr + 16);
  const vref = eterm + efd0 / (ka > 1e-6 ? ka : 200.0);
  store<f64>(statePtr + 0, vref);
  store<f64>(statePtr + 8, efd0);
  store<f64>(statePtr + 16, efd0);
}

export function ESAC1A_step(_t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const ka = getCon(conPtr, 17, 3, 200.0);
  const ta = Math.max(0.01, getCon(conPtr, 17, 4, 0.04));
  const vrmax = getCon(conPtr, 17, 5, 5.0);
  const vrmin = getCon(conPtr, 17, 6, -4.0);
  const te = Math.max(0.02, getCon(conPtr, 17, 8, 0.8));
  const kc = Math.max(0.0, getCon(conPtr, 17, 11, 0.2));
  const vref = load<f64>(statePtr + 0);
  let vr = load<f64>(statePtr + 8);
  let ve = load<f64>(statePtr + 16);
  const eterm = load<f64>(ioPtr + 0);
  const target = clamp(ka * (vref - eterm), vrmin, vrmax);
  vr = clamp(vr + (dt / ta) * (target - vr), vrmin, vrmax);
  ve = clamp(ve + (dt / te) * (vr - ve), vrmin, vrmax);
  const efd = clamp(ve * evalFex((kc * Math.max(0.0, ve)) / Math.max(0.1, ve)), vrmin, vrmax);
  store<f64>(statePtr + 8, vr);
  store<f64>(statePtr + 16, ve);
  store<f64>(ioPtr + 16, efd);
}

// 3. EXST1 — IEEE Type ST1 Static Excitation System
export function EXST1_init(conPtr: usize, count: i32, statePtr: usize, ioPtr: usize): void {
  const ka = getCon(conPtr, count, 5, 200.0);
  const eterm = load<f64>(ioPtr + 0);
  const efd0 = load<f64>(ioPtr + 16);
  const vref = eterm + efd0 / (ka > 1e-6 ? ka : 200.0);
  store<f64>(statePtr + 0, vref);
  store<f64>(statePtr + 8, efd0);
}

export function EXST1_step(_t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const ka = getCon(conPtr, 12, 5, 200.0);
  const ta = Math.max(0.01, getCon(conPtr, 12, 6, 0.05));
  const vrmax = getCon(conPtr, 12, 7, 5.0);
  const vrmin = getCon(conPtr, 12, 8, -4.0);
  const vref = load<f64>(statePtr + 0);
  let efd = load<f64>(statePtr + 8);
  const eterm = load<f64>(ioPtr + 0);
  const target = clamp(ka * (vref - eterm), eterm * vrmin, eterm * vrmax);
  efd = clamp(efd + (dt / ta) * (target - efd), eterm * vrmin, eterm * vrmax);
  store<f64>(statePtr + 8, efd);
  store<f64>(ioPtr + 16, efd);
}

// 4. IEEET1 — 1968 IEEE Type 1 DC Exciter
export function IEEET1_init(conPtr: usize, count: i32, statePtr: usize, ioPtr: usize): void {
  const ka = getCon(conPtr, count, 1, 200.0);
  const eterm = load<f64>(ioPtr + 0);
  const efd0 = load<f64>(ioPtr + 16);
  const vref = eterm + efd0 / (ka > 1e-6 ? ka : 200.0);
  store<f64>(statePtr + 0, vref);
  store<f64>(statePtr + 8, efd0);
}

export function IEEET1_step(_t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const ka = getCon(conPtr, 14, 1, 200.0);
  const ta = Math.max(0.01, getCon(conPtr, 14, 2, 0.05));
  const vrmax = getCon(conPtr, 14, 3, 5.0);
  const vrmin = getCon(conPtr, 14, 4, -4.0);
  const vref = load<f64>(statePtr + 0);
  let efd = load<f64>(statePtr + 8);
  const eterm = load<f64>(ioPtr + 0);
  const target = clamp(ka * (vref - eterm), vrmin, vrmax);
  efd = clamp(efd + (dt / ta) * (target - efd), vrmin, vrmax);
  store<f64>(statePtr + 8, efd);
  store<f64>(ioPtr + 16, efd);
}

// 5. TGOV1 — Steam Turbine-Governor
export function TGOV1_init(_conPtr: usize, _count: i32, statePtr: usize, ioPtr: usize): void {
  const pm0 = load<f64>(ioPtr + 24);
  store<f64>(statePtr + 0, pm0);
  store<f64>(statePtr + 8, pm0);
}

export function TGOV1_step(_t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const r = Math.max(0.005, getCon(conPtr, 7, 0, 0.05));
  const t1 = Math.max(0.02, getCon(conPtr, 7, 1, 0.5));
  const vmax = getCon(conPtr, 7, 2, 1.2);
  const vmin = getCon(conPtr, 7, 3, 0.0);
  const pm0 = load<f64>(statePtr + 0);
  let pm = load<f64>(statePtr + 8);
  const speedDev = load<f64>(ioPtr + 8);
  const target = clamp(pm0 - speedDev / r, vmin, vmax);
  pm = clamp(pm + (dt / t1) * (target - pm), vmin, vmax);
  store<f64>(statePtr + 8, pm);
  store<f64>(ioPtr + 24, pm);
}

// 6. GAST — Gas Turbine-Governor
export function GAST_init(_conPtr: usize, _count: i32, statePtr: usize, ioPtr: usize): void {
  const pm0 = load<f64>(ioPtr + 24);
  store<f64>(statePtr + 0, pm0);
  store<f64>(statePtr + 8, pm0);
}

export function GAST_step(_t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const r = Math.max(0.005, getCon(conPtr, 9, 0, 0.05));
  const t1 = Math.max(0.02, getCon(conPtr, 9, 1, 0.4));
  const vmax = getCon(conPtr, 9, 5, 1.1);
  const vmin = getCon(conPtr, 9, 6, 0.0);
  const pm0 = load<f64>(statePtr + 0);
  let pm = load<f64>(statePtr + 8);
  const speedDev = load<f64>(ioPtr + 8);
  const target = clamp(pm0 - speedDev / r, vmin, vmax);
  pm = clamp(pm + (dt / t1) * (target - pm), vmin, vmax);
  store<f64>(statePtr + 8, pm);
  store<f64>(ioPtr + 24, pm);
}

// 7. HYGOV — Hydro Turbine-Governor (with nonlinear penstock water-hammer)
export function HYGOV_init(_conPtr: usize, _count: i32, statePtr: usize, ioPtr: usize): void {
  const pm0 = load<f64>(ioPtr + 24);
  store<f64>(statePtr + 0, pm0);
  store<f64>(statePtr + 8, pm0);
  store<f64>(statePtr + 16, pm0);
}

export function HYGOV_step(_t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const r = Math.max(0.005, getCon(conPtr, 12, 0, 0.05));
  const tg = Math.max(0.02, getCon(conPtr, 12, 4, 0.5));
  const gmax = getCon(conPtr, 12, 6, 1.05);
  const gmin = Math.max(0.02, getCon(conPtr, 12, 7, 0.02));
  const tw = Math.max(0.1, getCon(conPtr, 12, 8, 1.0));
  const pm0 = load<f64>(statePtr + 0);
  let gate = load<f64>(statePtr + 8);
  let q = load<f64>(statePtr + 16);
  const speedDev = load<f64>(ioPtr + 8);
  const target = clamp(pm0 - speedDev / r, gmin, gmax);
  gate = clamp(gate + (dt / tg) * (target - gate), gmin, gmax);
  const h = (q / Math.max(0.05, gate)) * (q / Math.max(0.05, gate));
  q = clamp(q + (dt / tw) * (1.0 - h), 0.01, gmax * 1.5);
  const pm = clamp(q * h, 0.0, gmax * 1.2);
  store<f64>(statePtr + 8, gate);
  store<f64>(statePtr + 16, q);
  store<f64>(ioPtr + 24, pm);
}

// 8. PSS2B — IEEE Dual-Input Power System Stabilizer
export function PSS2B_init(_conPtr: usize, _count: i32, statePtr: usize, _ioPtr: usize): void {
  store<f64>(statePtr + 0, 0.0);
  store<f64>(statePtr + 8, 0.0);
}

export function PSS2B_step(_t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const tw = Math.max(0.1, getCon(conPtr, 20, 0, 5.0));
  const ks = getCon(conPtr, 20, 10, 10.0);
  const speedDev = load<f64>(ioPtr + 8);
  let xw = load<f64>(statePtr + 0);
  xw = xw + (dt / tw) * (speedDev - xw);
  const vs = clamp(ks * (speedDev - xw), -0.1, 0.1);
  store<f64>(statePtr + 0, xw);
  store<f64>(statePtr + 8, vs);
  const efd = load<f64>(ioPtr + 16);
  store<f64>(ioPtr + 16, efd + vs);
}

// 9. GENROU / GENTPJ / GENSAE — Synchronous Generators (with quadratic/exponential saturation)
export function GENROU_init(conPtr: usize, count: i32, statePtr: usize, ioPtr: usize): void {
  const efd0 = load<f64>(ioPtr + 16);
  const vr = load<f64>(ioPtr + 32);
  const vi = load<f64>(ioPtr + 40);
  store<f64>(statePtr + 0, Math.atan2(vi, vr));
  store<f64>(statePtr + 8, 0.0);
  store<f64>(statePtr + 16, efd0);
  store<f64>(statePtr + 24, getCon(conPtr, count, 0, 6.5));
}

export function GENROU_step(_t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const td0p = Math.max(0.1, getCon(conPtr, 14, 0, 6.5));
  const xd = getCon(conPtr, 14, 6, 1.85);
  const xdp = getCon(conPtr, 14, 8, 0.30);
  const s10 = getCon(conPtr, 14, 12, 0.0);
  const s12 = getCon(conPtr, 14, 13, 0.0);
  let eqp = load<f64>(statePtr + 16);
  const efd = load<f64>(ioPtr + 16);
  const sat = evalQuadraticSat(eqp, 1.0, s10, 1.2, s12) * (xd - xdp);
  eqp = clamp(eqp + (dt / td0p) * (efd - eqp - sat), 0.1, 3.5);
  store<f64>(statePtr + 16, eqp);
}

export function GENTPJ_init(conPtr: usize, count: i32, statePtr: usize, ioPtr: usize): void {
  GENROU_init(conPtr, count, statePtr, ioPtr);
}
export function GENTPJ_step(t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  GENROU_step(t, dt, conPtr, statePtr, ioPtr);
}
export function GENSAE_init(conPtr: usize, count: i32, statePtr: usize, ioPtr: usize): void {
  GENROU_init(conPtr, count, statePtr, ioPtr);
}
export function GENSAE_step(_t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const td0p = Math.max(0.1, getCon(conPtr, 14, 0, 6.5));
  const xd = getCon(conPtr, 14, 6, 1.85);
  const xdp = getCon(conPtr, 14, 8, 0.30);
  const s10 = getCon(conPtr, 14, 12, 0.0);
  const s12 = getCon(conPtr, 14, 13, 0.0);
  let eqp = load<f64>(statePtr + 16);
  const efd = load<f64>(ioPtr + 16);
  const sat = evalExponentialSat(eqp, 1.0, s10, 1.2, s12) * (xd - xdp);
  eqp = clamp(eqp + (dt / td0p) * (efd - eqp - sat), 0.1, 3.5);
  store<f64>(statePtr + 16, eqp);
}

// 10. REGC_A / REEC_A / REPC_A — WECC Renewable / IBR Modules
export function REGC_A_init(_conPtr: usize, _count: i32, statePtr: usize, ioPtr: usize): void {
  store<f64>(statePtr + 0, load<f64>(ioPtr + 16));
}
export function REGC_A_step(_t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const tg = Math.max(0.01, getCon(conPtr, 4, 0, 0.02));
  const vref = load<f64>(statePtr + 0);
  const eterm = load<f64>(ioPtr + 0);
  let iqCmd = load<f64>(ioPtr + 16);
  const target = clamp(vref + 2.0 * (1.0 - eterm), -1.5, 2.5);
  iqCmd = iqCmd + (dt / tg) * (target - iqCmd);
  store<f64>(ioPtr + 16, iqCmd);
}

export function REEC_A_init(_conPtr: usize, _count: i32, statePtr: usize, ioPtr: usize): void {
  store<f64>(statePtr + 0, load<f64>(ioPtr + 0));
}
export function REEC_A_step(_t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const kqv = getCon(conPtr, 6, 2, 2.0);
  const vref = load<f64>(statePtr + 0);
  const eterm = load<f64>(ioPtr + 0);
  const efd = load<f64>(ioPtr + 16);
  const deltaQ = clamp(kqv * (vref - eterm), -0.5, 0.5);
  store<f64>(ioPtr + 16, efd + deltaQ * Math.min(1.0, dt * 10.0));
}

export function REPC_A_init(_conPtr: usize, _count: i32, statePtr: usize, ioPtr: usize): void {
  store<f64>(statePtr + 0, load<f64>(ioPtr + 24));
}
export function REPC_A_step(_t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const droop = Math.max(0.01, getCon(conPtr, 6, 0, 0.05));
  const pRef = load<f64>(statePtr + 0);
  const speedDev = load<f64>(ioPtr + 8);
  const pm = load<f64>(ioPtr + 24);
  const pTarget = clamp(pRef - speedDev / droop, 0.0, 1.2);
  store<f64>(ioPtr + 24, pm + Math.min(1.0, dt * 4.0) * (pTarget - pm));
}

// 11. CMPLDW — WECC Composite Load Model (3-phase motor slip + FIDVR stall)
export function CMPLDW_init(_conPtr: usize, _count: i32, statePtr: usize, ioPtr: usize): void {
  const v0 = Math.max(0.2, load<f64>(ioPtr + 0));
  store<f64>(statePtr + 0, v0);
  store<f64>(statePtr + 8, 0.025);
  store<f64>(statePtr + 16, 0.0);
}
export function CMPLDW_step(_t: f64, dt: f64, _conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const v0 = Math.max(0.2, load<f64>(statePtr + 0));
  const eterm = load<f64>(ioPtr + 0);
  let slip = load<f64>(statePtr + 8);
  const vNorm = eterm / v0;
  const sBreak: f64 = 0.12;
  const slip0: f64 = 0.025;
  const normFactor = (1.0 + (slip0 / sBreak) * (slip0 / sBreak)) / (slip0 / sBreak);
  const te = (vNorm * vNorm * normFactor * (slip / sBreak)) / (1.0 + (slip / sBreak) * (slip / sBreak));
  slip = clamp(slip + (dt / 1.2) * (1.0 - te), 0.002, 0.99);
  store<f64>(statePtr + 8, slip);
}

// === Generalized ABI v2 Archetype Dispatch (All 52 Unique Archetypes / 366 Schemas) ===

export const ARCH_EXCITERS_START: i32 = 10;
export const ARCH_GOVERNORS_START: i32 = 20;
export const ARCH_STABILIZERS_START: i32 = 30;
export const ARCH_IBR_START: i32 = 35;
export const ARCH_LOADS_START: i32 = 42;
export const ARCH_FACTS_HVDC_START: i32 = 48;
export const ARCH_RELAYS_START: i32 = 54;
export const ARCH_COMP_RC_XC: i32 = 58;

/**
 * Initializes a 2048-byte slot for any canonical `DaeArchetypeId` numeric code (`0..58`).
 */
export function psseModelInit(archetypeId: i32, slotPtr: usize, iconCount: i32, conCount: i32): i32 {
  for (let i: i32 = 0; i < 32; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }
  setState(slotPtr, SLOT_META_ICON_COUNT, <f64>iconCount);
  setIo(slotPtr, 12, 1.0); // tripMult default = closed (1.0)

  if (archetypeId < 10) return initGenerator(archetypeId, slotPtr, conCount);
  if ((archetypeId >= 10 && archetypeId <= 19) || archetypeId == ARCH_COMP_RC_XC) {
    return initExciterOrLimiter(archetypeId, slotPtr, conCount);
  }
  if (archetypeId >= 20 && archetypeId <= 29) return initGovernor(archetypeId, slotPtr, conCount);
  if (archetypeId >= 30 && archetypeId <= 34) return initStabilizer(archetypeId, slotPtr, conCount);
  if (archetypeId >= 35 && archetypeId <= 41) return initIbr(archetypeId, slotPtr, conCount);
  if (archetypeId >= 42 && archetypeId <= 47) return initLoad(archetypeId, slotPtr, conCount);
  return initFactsHvdcRelay(archetypeId, slotPtr, conCount);
}

/**
 * Evaluates right-hand-side state derivatives `DSTATE[0..nStates-1]` and outputs into `IO[0..15]`.
 */
export function psseModelEvalDerivatives(
  archetypeId: i32,
  _t: f64,
  _dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const iconCount = <i32>getState(slotPtr, SLOT_META_ICON_COUNT);
  if (archetypeId < 10) {
    evalGeneratorDerivs(archetypeId, slotPtr, conCount);
    return;
  }
  if ((archetypeId >= 10 && archetypeId <= 19) || archetypeId == ARCH_COMP_RC_XC) {
    evalExciterOrLimiterDerivs(archetypeId, slotPtr, conCount);
    return;
  }
  if (archetypeId >= 20 && archetypeId <= 29) {
    evalGovernorDerivs(archetypeId, slotPtr, conCount);
    return;
  }
  if (archetypeId >= 30 && archetypeId <= 34) {
    evalStabilizerDerivs(archetypeId, slotPtr, conCount);
    return;
  }
  if (archetypeId >= 35 && archetypeId <= 41) {
    evalIbrDerivs(archetypeId, slotPtr, iconCount, conCount);
    return;
  }
  if (archetypeId >= 42 && archetypeId <= 47) {
    evalLoadDerivs(archetypeId, slotPtr, conCount);
    return;
  }
  evalFactsHvdcRelayDerivs(archetypeId, slotPtr, conCount);
}

@inline
function clampModelState(archetypeId: i32, slotPtr: usize, conCount: i32, idx: i32, val: f64): f64 {
  const conPtr = slotPtr + OFF_CON;
  if (archetypeId >= 10 && archetypeId <= 16 && (idx == 2 || idx == 3)) {
    const efd0 = getState(slotPtr, 25);
    const vrMax = Math.max(efd0 + 0.5, getCon(conPtr, conCount, archetypeId == 14 ? 7 : 5, 5.0));
    const vrMin = Math.min(efd0 - 0.5, getCon(conPtr, conCount, archetypeId == 14 ? 8 : 6, -4.0));
    return clamp(val, vrMin, vrMax);
  }
  if (archetypeId >= 20 && archetypeId <= 29 && (idx == 0 || idx == 3)) {
    const pRef0 = getState(slotPtr, 24);
    const pMax = Math.max(pRef0 + 0.1, getCon(conPtr, conCount, 2, 1.2));
    const pMin = Math.min(pRef0 - 0.1, getCon(conPtr, conCount, 3, 0.0));
    return clamp(val, pMin, Math.max(pMin + 0.1, pMax * 1.2));
  }
  if (archetypeId >= 42 && archetypeId <= 47 && (idx == 0 || idx == 1)) {
    return clamp(val, 0.002, 0.99);
  }
  if ((archetypeId >= 54 && archetypeId <= 56 && idx == 0) || (archetypeId == 17 && idx == 5)) {
    return Math.max(0.0, val);
  }
  return val;
}

/**
 * Advances one time step for any canonical `DaeArchetypeId` (`0..58`) using 2nd-order Heun
 * (predictor-corrector / explicit trapezoidal) with automatic stiff substepping.
 */
export function psseModelStep(archetypeId: i32, t: f64, dt: f64, slotPtr: usize, conCount: i32): void {
  if (!(dt > 0.0) || !isFinite(dt)) return;
  const nStates = getSlotNStates(slotPtr);
  const tMin = getSlotTMin(slotPtr);

  // Automatic substepping for stiff time constants (dt > 0.5 * tMin), capped at 8 substeps
  let subSteps: i32 = 1;
  if (dt > 0.5 * tMin) {
    subSteps = <i32>Math.ceil(dt / (0.5 * tMin));
    if (subSteps > 8) subSteps = 8;
  }
  const h = dt / <f64>subSteps;

  for (let s: i32 = 0; s < subSteps; s++) {
    const tCur = t + <f64>s * h;

    // Stage 1: evaluate k1 = f(tCur, y0)
    psseModelEvalDerivatives(archetypeId, tCur, h, slotPtr, conCount);
    for (let i: i32 = 0; i < nStates; i++) {
      const y0 = getState(slotPtr, i);
      const k1 = getDState(slotPtr, i);
      const byteOff = (<usize>i) << 3;
      store<f64>(SCRATCH_HEUN_Y0 + byteOff, y0);
      store<f64>(SCRATCH_HEUN_K1 + byteOff, k1);
      if (k1 != 0.0) {
        setState(slotPtr, i, clampModelState(archetypeId, slotPtr, conCount, i, y0 + h * k1));
      }
    }

    // Stage 2: evaluate k2 = f(tCur + h, y0 + h * k1) and apply trapezoidal average
    psseModelEvalDerivatives(archetypeId, tCur + h, h, slotPtr, conCount);
    for (let i: i32 = 0; i < nStates; i++) {
      const byteOff = (<usize>i) << 3;
      const y0 = load<f64>(SCRATCH_HEUN_Y0 + byteOff);
      const k1 = load<f64>(SCRATCH_HEUN_K1 + byteOff);
      const k2 = getDState(slotPtr, i);
      if (k1 != 0.0 || k2 != 0.0) {
        const next = y0 + 0.5 * h * (k1 + k2);
        setState(slotPtr, i, clampModelState(archetypeId, slotPtr, conCount, i, next));
      }
    }
  }

  // Final output refresh at updated state
  psseModelEvalDerivatives(archetypeId, t + dt, h, slotPtr, conCount);
}

/**
 * Evaluates steady-state flat-start derivative residual `max_i |dstate[i]|` right after `psseModelInit`.
 */
export function psseModelCheckFlatStart(archetypeId: i32, slotPtr: usize, conCount: i32): f64 {
  const nStates = getSlotNStates(slotPtr);
  psseModelEvalDerivatives(archetypeId, 0.0, 0.01, slotPtr, conCount);
  let maxRes: f64 = 0.0;
  for (let i: i32 = 0; i < nStates; i++) {
    const r = Math.abs(getDState(slotPtr, i));
    if (r > maxRes) maxRes = r;
  }
  return maxRes;
}

// === Batched Zero-Copy ABI v2.1 Entrypoints (Single JS<->WASM Call per Simulation Step) ===
// Descriptor stride: 16 bytes = { archetypeId: i32 @ +0, slotPtr: u32 @ +4, iconCount: i32 @ +8, conCount: i32 @ +12 }

export function psseBatchInit(count: i32, tablePtr: usize): void {
  for (let i: i32 = 0; i < count; i++) {
    const entry = tablePtr + ((<usize>i) << 4);
    const archId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const iconCount = load<i32>(entry + 8);
    const conCount = load<i32>(entry + 12);
    psseModelInit(archId, slotPtr, iconCount, conCount);
  }
}

export function psseBatchStep(count: i32, t: f64, dt: f64, tablePtr: usize): void {
  for (let i: i32 = 0; i < count; i++) {
    const entry = tablePtr + ((<usize>i) << 4);
    const archId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    psseModelStep(archId, t, dt, slotPtr, conCount);
  }
}

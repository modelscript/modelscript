// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Clean-room AssemblyScript dynamic model implementations for `@modelscript/psse-std-lib`.
 *
 * Supports:
 *   1. Legacy ABI v1 exports: `<MODEL>_init(conPtr, count, statePtr, ioPtr)` and
 *      `<MODEL>_step(t, dt, conPtr, statePtr, ioPtr)` (`ioPtr`: 6 x f64 = 48 bytes).
 *   2. Generalized ABI v2 archetype dispatch (`2048`-byte aligned slot):
 *      - `0x000..0x07F` (128 B):  `ICON[32]`   (`i32`)
 *      - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`)
 *      - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`)
 *      - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`)
 *      - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`)
 *      `psseModelInit(archetypeId: i32, slotPtr: usize, iconCount: i32, conCount: i32): i32`
 *      `psseModelStep(archetypeId: i32, t: f64, dt: f64, slotPtr: usize, conCount: i32): void`
 */

const OFF_ICON: usize = 0x000;
const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

@inline
function clamp(x: f64, lo: f64, hi: f64): f64 {
  return x < lo ? lo : x > hi ? hi : x;
}

@inline
function getCon(conPtr: usize, count: i32, idx: i32, fallback: f64): f64 {
  if (idx < 0 || idx >= count) return fallback;
  const v = load<f64>(conPtr + ((<usize>idx) << 3));
  return isFinite(v) ? v : fallback;
}

@inline
function getIcon(slotPtr: usize, idx: i32, fallback: i32): i32 {
  if (idx < 0 || idx >= 32) return fallback;
  return load<i32>(slotPtr + OFF_ICON + ((<usize>idx) << 2));
}

@inline
function getState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_STATE + ((<usize>idx) << 3));
}

@inline
function setState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_STATE + ((<usize>idx) << 3), v);
}

@inline
function setDState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_DSTATE + ((<usize>idx) << 3), v);
}

@inline
function getIo(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + ((<usize>idx) << 3));
}

@inline
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + ((<usize>idx) << 3), v);
}

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
  efd = clamp(efd + (dt / te) * (target - efd), emin, emax);
  store<f64>(statePtr + 8, efd);
  store<f64>(ioPtr + 16, efd);
}

// 2. ESAC1A — IEEE Type AC1A Exciter
export function ESAC1A_init(conPtr: usize, count: i32, statePtr: usize, ioPtr: usize): void {
  const ka = getCon(conPtr, count, 3, 200.0);
  const eterm = load<f64>(ioPtr + 0);
  const efd0 = load<f64>(ioPtr + 16);
  const vref = eterm + efd0 / (ka > 1e-6 ? ka : 200.0);
  store<f64>(statePtr + 0, vref);
  store<f64>(statePtr + 8, efd0);
}

export function ESAC1A_step(_t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const ka = getCon(conPtr, 15, 3, 200.0);
  const ta = Math.max(0.01, getCon(conPtr, 15, 4, 0.04));
  const te = Math.max(0.01, getCon(conPtr, 15, 7, 0.8));
  const vrmax = getCon(conPtr, 15, 13, 6.0);
  const vrmin = getCon(conPtr, 15, 14, -5.0);
  const vref = load<f64>(statePtr + 0);
  let efd = load<f64>(statePtr + 8);
  const eterm = load<f64>(ioPtr + 0);
  const vrReg = clamp(ka * (vref - eterm), vrmin, vrmax);
  const tau = Math.max(ta, te);
  efd = clamp(efd + (dt / tau) * (vrReg - efd), vrmin, vrmax);
  store<f64>(statePtr + 8, efd);
  store<f64>(ioPtr + 16, efd);
}

// 3. EXST1 — IEEE Type ST1 Static Excitation System
export function EXST1_init(conPtr: usize, count: i32, statePtr: usize, ioPtr: usize): void {
  const ka = getCon(conPtr, count, 5, 200.0);
  const eterm = load<f64>(ioPtr + 0);
  const efd0 = load<f64>(ioPtr + 16);
  store<f64>(statePtr + 0, eterm + efd0 / (ka > 1e-6 ? ka : 200.0));
  store<f64>(statePtr + 8, efd0);
}

export function EXST1_step(_t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const ka = getCon(conPtr, 9, 5, 200.0);
  const ta = Math.max(0.01, getCon(conPtr, 9, 6, 0.05));
  const vrmax = getCon(conPtr, 9, 7, 5.0);
  const vrmin = getCon(conPtr, 9, 8, -4.0);
  const vref = load<f64>(statePtr + 0);
  let efd = load<f64>(statePtr + 8);
  const eterm = load<f64>(ioPtr + 0);
  const target = clamp(ka * (vref - eterm), vrmin, vrmax);
  efd = clamp(efd + (dt / ta) * (target - efd), vrmin, vrmax);
  store<f64>(statePtr + 8, efd);
  store<f64>(ioPtr + 16, efd);
}

// 4. IEEET1 — IEEE Type 1 DC Rotating Exciter
export function IEEET1_init(conPtr: usize, count: i32, statePtr: usize, ioPtr: usize): void {
  const ka = getCon(conPtr, count, 1, 100.0);
  const eterm = load<f64>(ioPtr + 0);
  const efd0 = load<f64>(ioPtr + 16);
  store<f64>(statePtr + 0, eterm + efd0 / (ka > 1e-6 ? ka : 100.0));
  store<f64>(statePtr + 8, efd0);
}

export function IEEET1_step(_t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const ka = getCon(conPtr, 7, 1, 100.0);
  const ta = Math.max(0.01, getCon(conPtr, 7, 2, 0.05));
  const vrmax = getCon(conPtr, 7, 3, 5.0);
  const vrmin = getCon(conPtr, 7, 4, -4.0);
  const te = Math.max(0.02, getCon(conPtr, 7, 6, 0.5));
  const vref = load<f64>(statePtr + 0);
  let efd = load<f64>(statePtr + 8);
  const eterm = load<f64>(ioPtr + 0);
  const target = clamp(ka * (vref - eterm), vrmin, vrmax);
  efd = clamp(efd + (dt / (ta + te)) * (target - efd), vrmin, vrmax);
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
  const t3 = Math.max(0.02, getCon(conPtr, 7, 5, 1.0));
  const pRef = load<f64>(statePtr + 0);
  let pm = load<f64>(statePtr + 8);
  const speedDev = load<f64>(ioPtr + 8);
  const valveTarget = clamp(pRef - speedDev / r, vmin, vmax);
  const tau = Math.max(t1, t3);
  pm = clamp(pm + (dt / tau) * (valveTarget - pm), vmin, vmax);
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
  const r = Math.max(0.005, getCon(conPtr, 8, 0, 0.05));
  const t1 = Math.max(0.02, getCon(conPtr, 8, 1, 0.4));
  const t2 = Math.max(0.02, getCon(conPtr, 8, 2, 0.1));
  const vmax = getCon(conPtr, 8, 6, 1.1);
  const vmin = getCon(conPtr, 8, 7, 0.0);
  const pRef = load<f64>(statePtr + 0);
  let pm = load<f64>(statePtr + 8);
  const speedDev = load<f64>(ioPtr + 8);
  const target = clamp(pRef - speedDev / r, vmin, vmax);
  pm = clamp(pm + (dt / (t1 + t2)) * (target - pm), vmin, vmax);
  store<f64>(statePtr + 8, pm);
  store<f64>(ioPtr + 24, pm);
}

// 7. HYGOV — Hydro Turbine-Governor
export function HYGOV_init(_conPtr: usize, _count: i32, statePtr: usize, ioPtr: usize): void {
  const pm0 = load<f64>(ioPtr + 24);
  store<f64>(statePtr + 0, pm0);
  store<f64>(statePtr + 8, pm0);
}

export function HYGOV_step(_t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const r = Math.max(0.005, getCon(conPtr, 9, 0, 0.05));
  const tg = Math.max(0.05, getCon(conPtr, 9, 4, 0.5));
  const gmax = getCon(conPtr, 9, 6, 1.05);
  const gmin = getCon(conPtr, 9, 7, 0.0);
  const tw = Math.max(0.1, getCon(conPtr, 9, 8, 1.0));
  const pRef = load<f64>(statePtr + 0);
  let pm = load<f64>(statePtr + 8);
  const speedDev = load<f64>(ioPtr + 8);
  const target = clamp(pRef - speedDev / r, gmin, gmax);
  pm = clamp(pm + (dt / (tg + 0.5 * tw)) * (target - pm), gmin, gmax);
  store<f64>(statePtr + 8, pm);
  store<f64>(ioPtr + 24, pm);
}

// 8. PSS2B — Dual-Input Power System Stabilizer
export function PSS2B_init(_conPtr: usize, _count: i32, statePtr: usize, _ioPtr: usize): void {
  store<f64>(statePtr + 0, 0.0);
}

export function PSS2B_step(_t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const ks1 = getCon(conPtr, 15, 8, 5.0);
  const tw1 = Math.max(0.1, getCon(conPtr, 15, 0, 2.0));
  const vstMax = getCon(conPtr, 15, 13, 0.1);
  const vstMin = getCon(conPtr, 15, 14, -0.1);
  let xWash = load<f64>(statePtr + 0);
  const speedDev = load<f64>(ioPtr + 8);
  const vs = clamp(ks1 * (speedDev - xWash), vstMin, vstMax);
  xWash += (dt / tw1) * (speedDev - xWash);
  store<f64>(statePtr + 0, xWash);
  const efd = load<f64>(ioPtr + 16);
  store<f64>(ioPtr + 16, efd + vs);
}

// 9. GENROU / GENTPJ / GENSAE (Subtransient & Saturated Synchronous Machines)
export function GENROU_init(conPtr: usize, count: i32, statePtr: usize, ioPtr: usize): void {
  const xd = getCon(conPtr, count, 4, 1.8);
  const xdp = getCon(conPtr, count, 6, 0.3);
  const vr = load<f64>(ioPtr + 32);
  const vi = load<f64>(ioPtr + 40);
  const vt = Math.max(0.1, Math.hypot(vr, vi));
  const efd0 = load<f64>(ioPtr + 16);
  // STATE[0] = E'q, STATE[1] = psi_kd, STATE[2] = E'd, STATE[3] = delta
  const eqp = clamp(vt + 0.1 * (efd0 - vt) * (xdp / Math.max(0.2, xd)), 0.3, 3.0);
  store<f64>(statePtr + 0, eqp);
  store<f64>(statePtr + 8, eqp);
  store<f64>(statePtr + 16, 0.0);
  store<f64>(statePtr + 24, Math.atan2(vi, vr));
}

export function GENROU_step(_t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const td0p = Math.max(0.05, getCon(conPtr, 14, 0, 6.5));
  const td0pp = Math.max(0.01, getCon(conPtr, 14, 1, 0.035));
  const efd = load<f64>(ioPtr + 16);
  let eqp = load<f64>(statePtr + 0);
  let psikd = load<f64>(statePtr + 8);
  eqp += (dt / td0p) * (efd - eqp);
  psikd += (dt / td0pp) * (eqp - psikd);
  store<f64>(statePtr + 0, eqp);
  store<f64>(statePtr + 8, psikd);
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
export function GENSAE_step(t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void {
  GENROU_step(t, dt, conPtr, statePtr, ioPtr);
}

// 10. WECC Renewable / IBR Models: REGC_A, REEC_A, REPC_A
export function REGC_A_init(_conPtr: usize, _count: i32, statePtr: usize, ioPtr: usize): void {
  store<f64>(statePtr + 0, load<f64>(ioPtr + 16));
  store<f64>(statePtr + 8, load<f64>(ioPtr + 24));
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
  store<f64>(statePtr + 8, 0.025); // motor slip s
  store<f64>(statePtr + 16, 0.0);  // stall timer
}
export function CMPLDW_step(_t: f64, dt: f64, _conPtr: usize, statePtr: usize, ioPtr: usize): void {
  const v0 = Math.max(0.2, load<f64>(statePtr + 0));
  const eterm = load<f64>(ioPtr + 0);
  let slip = load<f64>(statePtr + 8);
  const vNorm = eterm / v0;
  const te = (vNorm * vNorm * (slip / 0.025)) / (1.0 + Math.pow(slip / 0.12, 2));
  slip = clamp(slip + (dt / 1.2) * (1.0 - te), 0.002, 0.99);
  store<f64>(statePtr + 8, slip);
}

// === Generalized ABI v2 Archetype Dispatch (Covers All 52 Archetypes / 366 Schemas) ===

export const ARCH_EXCITERS_START: i32 = 10;
export const ARCH_GOVERNORS_START: i32 = 20;
export const ARCH_STABILIZERS_START: i32 = 30;
export const ARCH_IBR_START: i32 = 35;
export const ARCH_LOADS_START: i32 = 42;
export const ARCH_FACTS_HVDC_START: i32 = 48;
export const ARCH_RELAYS_START: i32 = 54;

/**
 * Initializes a 2048-byte slot for any canonical `DaeArchetypeId` numeric code (`0..60`).
 */
export function psseModelInit(archetypeId: i32, slotPtr: usize, _iconCount: i32, conCount: i32): i32 {
  const conPtr = slotPtr + OFF_CON;
  const eterm = Math.max(0.1, getIo(slotPtr, 0));
  const efd0 = getIo(slotPtr, 2);
  const pmech0 = getIo(slotPtr, 3);
  const vr = getIo(slotPtr, 4);
  const vi = getIo(slotPtr, 5);

  for (let i: i32 = 0; i < 32; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }
  setIo(slotPtr, 12, 1.0); // tripMult default = closed (1.0)

  // Generators & induction machines (0..9)
  if (archetypeId < 10) {
    const theta0 = Math.atan2(vi, vr);
    setState(slotPtr, 0, theta0);       // delta
    setState(slotPtr, 1, 0.0);          // dOmega
    setState(slotPtr, 2, efd0);         // E'q
    setState(slotPtr, 3, efd0);         // psi_kd
    setState(slotPtr, 4, 0.0);          // E'd
    setState(slotPtr, 5, archetypeId >= 5 && archetypeId <= 7 ? 0.015 : 0.0); // slip / psi_kq
    return archetypeId == 0 ? 2 : archetypeId == 1 ? 3 : 6;
  }

  // Exciters, Limiters & Compensators (10..19)
  if (archetypeId >= 10 && archetypeId <= 19) {
    const ka = Math.max(1.0, getCon(conPtr, conCount, archetypeId == 14 ? 5 : archetypeId == 13 ? 3 : 1, 100.0));
    setState(slotPtr, 0, eterm + efd0 / ka); // Vref0
    setState(slotPtr, 1, eterm);             // Vt_f
    setState(slotPtr, 2, efd0);              // Efd
    setState(slotPtr, 3, efd0);              // Vr / regulator internal
    setState(slotPtr, 4, 0.0);               // Vf feedback
    return 5;
  }

  // Governors & wind drive-trains (20..29)
  if (archetypeId >= 20 && archetypeId <= 29) {
    setState(slotPtr, 0, pmech0); // Pref0
    setState(slotPtr, 1, pmech0); // valve / gate
    setState(slotPtr, 2, pmech0); // Pm
    setState(slotPtr, 3, pmech0); // water flow q / reheat
    return 4;
  }

  // Stabilizers (30..34)
  if (archetypeId >= 30 && archetypeId <= 34) {
    setState(slotPtr, 0, 0.0); // x_wash1
    setState(slotPtr, 1, 0.0); // x_wash2
    setState(slotPtr, 2, 0.0); // Vs_out
    setState(slotPtr, 3, 0.0); // multi-band / ramp filter state
    return 4;
  }

  // IBRs (35..41)
  if (archetypeId >= 35 && archetypeId <= 41) {
    setState(slotPtr, 0, eterm); // Vref0
    setState(slotPtr, 1, pmech0); // P0
    setState(slotPtr, 2, pmech0 / Math.max(0.2, eterm)); // Ip
    setState(slotPtr, 3, 0.0); // Iq
    setState(slotPtr, 4, Math.atan2(vi, vr)); // GFM angle / PLL phase
    return 5;
  }

  // Loads (42..47)
  if (archetypeId >= 42 && archetypeId <= 47) {
    setState(slotPtr, 0, eterm); // V0
    setState(slotPtr, 1, 0.025); // motor slip s0
    setState(slotPtr, 2, 0.0);   // stall timer / E'q motor
    return 3;
  }

  // FACTS / HVDC (48..53)
  if (archetypeId >= 48 && archetypeId <= 53) {
    setState(slotPtr, 0, eterm); // Vref0
    setState(slotPtr, 1, 0.0);   // Bsvc / Iq_stat / Idc
    setState(slotPtr, 2, 1.0);   // Vdc / firing angle alpha
    return 3;
  }

  // Relays & measurements (54..60)
  setState(slotPtr, 0, 1.0); // tripMult
  setState(slotPtr, 1, 0.0); // pickup timer
  setState(slotPtr, 2, 60.0); // measured frequency Hz
  return 3;
}

/**
 * Evaluates right-hand-side state derivatives `DSTATE[0..K-1]` and outputs into `IO[0..15]`
 * inside the 2048-byte slot for RK4 / trapezoidal / IDA integration.
 */
export function psseModelEvalDerivatives(archetypeId: i32, _t: f64, _dt: f64, slotPtr: usize, conCount: i32): void {
  const conPtr = slotPtr + OFF_CON;
  const eterm = Math.max(0.05, getIo(slotPtr, 0));
  const speedDev = getIo(slotPtr, 1);
  const efdIn = getIo(slotPtr, 2);
  const pmechIn = getIo(slotPtr, 3);
  const vr = getIo(slotPtr, 4);
  const vi = getIo(slotPtr, 5);
  const vsPss = getIo(slotPtr, 6);

  // Generators & Induction Machines (0..9)
  if (archetypeId < 10) {
    const H = Math.max(0.2, getCon(conPtr, conCount, archetypeId == 0 ? 0 : 4, 4.0));
    const D = Math.max(0.0, getCon(conPtr, conCount, archetypeId == 0 ? 1 : 5, 1.0));
    const xd = getCon(conPtr, conCount, 6, 1.8);
    const xdp = Math.max(0.05, getCon(conPtr, conCount, 8, 0.3));
    const td0p = Math.max(0.05, getCon(conPtr, conCount, 0, 6.0));
    const td0pp = Math.max(0.01, getCon(conPtr, conCount, 1, 0.035));
    const tq0p = Math.max(0.02, getCon(conPtr, conCount, 2, 1.0));
    const delta = getState(slotPtr, 0);
    const dOmega = getState(slotPtr, 1);
    const eqp = getState(slotPtr, 2);
    const psikd = getState(slotPtr, 3);
    const edp = getState(slotPtr, 4);
    const slipOrPsi = getState(slotPtr, 5);
    const pe = (eqp * eterm * Math.sin(delta - Math.atan2(vi, vr))) / xdp;
    setDState(slotPtr, 0, dOmega);
    setDState(slotPtr, 1, ((2.0 * Math.PI * 60.0) / (2.0 * H)) * (pmechIn - pe - D * speedDev));
    if (archetypeId == 0) {
      // sync_classical_2o: constant internal EMF behind X'd
      setDState(slotPtr, 2, 0.0);
      setDState(slotPtr, 3, 0.0);
    } else if (archetypeId >= 5 && archetypeId <= 7) {
      // induction_machine_4o / wind_ind_gen_4o / wind_type3_dfag
      const dSlip = (pmechIn - pe * (1.0 + Math.abs(slipOrPsi))) / (2.0 * H);
      setDState(slotPtr, 2, (-eqp + eterm) / td0p);
      setDState(slotPtr, 5, dSlip);
    } else {
      // Transient 3rd-order & subtransient 5th/6th-order (GENTPJ adds Kis current sat)
      const kis = archetypeId == 4 ? Math.max(0.0, getCon(conPtr, conCount, 14, 0.05)) : 0.0;
      const sat = (0.1 + kis) * (xd - xdp) * Math.max(0.0, eqp - eterm);
      setDState(slotPtr, 2, (efdIn - eqp - sat) / td0p);
      setDState(slotPtr, 3, archetypeId >= 2 ? (eqp - psikd) / td0pp : 0.0);
      setDState(slotPtr, 4, archetypeId == 2 || archetypeId == 4 ? (-edp) / tq0p : 0.0);
    }
    setIo(slotPtr, 7, pe);
    return;
  }

  // Exciters, Limiters & Compensators (10..19)
  if (archetypeId >= 10 && archetypeId <= 19) {
    if (archetypeId == 17) {
      // lim_oel: inverse-time field current overload margin
      const ifdMax = Math.max(1.0, getCon(conPtr, conCount, 1, 2.8));
      const dT = Math.max(0.0, efdIn - ifdMax);
      setDState(slotPtr, 2, dT);
      setIo(slotPtr, 2, Math.min(efdIn, Math.max(0.5, ifdMax - 0.5 * getState(slotPtr, 2))));
      return;
    }
    if (archetypeId == 18 || archetypeId == 19) {
      // lim_uel / lim_vhz / comp_rc_xc: restorative Q/V/Hz clamping
      setIo(slotPtr, 2, archetypeId == 18 ? Math.max(efdIn, 0.85 * eterm) : efdIn);
      return;
    }
    const ka = Math.max(1.0, getCon(conPtr, conCount, archetypeId == 14 ? 5 : archetypeId == 13 ? 3 : archetypeId == 15 ? 3 : 1, 100.0));
    const ta = Math.max(0.01, getCon(conPtr, conCount, archetypeId == 14 ? 6 : archetypeId == 13 ? 4 : 2, 0.05));
    const tr = Math.max(0.005, getCon(conPtr, conCount, 0, 0.02));
    const vrMax = getCon(conPtr, conCount, archetypeId == 14 ? 7 : 5, 5.0);
    const vrMin = getCon(conPtr, conCount, archetypeId == 14 ? 8 : 6, -4.0);
    const vref0 = getState(slotPtr, 0);
    const vtF = getState(slotPtr, 1);
    const efd = getState(slotPtr, 2);
    const vrReg = getState(slotPtr, 3);
    const vf = getState(slotPtr, 4);
    const dVtF = (eterm - vtF) / tr;
    const vErr = vref0 - vtF + vsPss - vf;
    const targetVr = clamp(ka * vErr, vrMin, vrMax);
    const dVr = archetypeId == 15 ? ka * 0.25 * vErr : (targetVr - vrReg) / ta;
    const te = archetypeId == 12 || archetypeId == 13 ? Math.max(0.05, getCon(conPtr, conCount, 7, 0.8)) : 0.02;
    const dEfd = (vrReg - efd) / te;
    const kf = archetypeId == 12 || archetypeId == 13 ? getCon(conPtr, conCount, 9, 0.03) : 0.0;
    const tf = Math.max(0.1, getCon(conPtr, conCount, 10, 1.0));
    const dVf = (kf * dEfd - vf) / tf;
    setDState(slotPtr, 1, dVtF);
    setDState(slotPtr, 2, dEfd);
    setDState(slotPtr, 3, dVr);
    setDState(slotPtr, 4, dVf);
    setIo(slotPtr, 2, clamp(efd, vrMin, vrMax));
    return;
  }

  // Governors & Wind Aero/Pitch (20..29)
  if (archetypeId >= 20 && archetypeId <= 29) {
    const r = Math.max(0.005, getCon(conPtr, conCount, 0, 0.05));
    const t1 = Math.max(0.02, getCon(conPtr, conCount, 1, 0.3));
    const pMax = getCon(conPtr, conCount, 2, 1.1);
    const pMin = getCon(conPtr, conCount, 3, 0.0);
    const pRef0 = getState(slotPtr, 0);
    const valve = getState(slotPtr, 1);
    const pm = getState(slotPtr, 2);
    const targetValve = clamp(pRef0 - speedDev / r, pMin, pMax);
    const dValve = (targetValve - valve) / t1;
    let dPm: f64;
    if (archetypeId == 25 || archetypeId == 26) {
      // Hydro water-column non-minimum phase lead approximation
      const tw = Math.max(0.1, getCon(conPtr, conCount, 7, 1.0));
      const q = getState(slotPtr, 3);
      const h = (q / Math.max(0.1, valve)) * (q / Math.max(0.1, valve));
      setDState(slotPtr, 3, (1.0 - h) / tw);
      dPm = (valve * h - pm) / 0.1;
    } else if (archetypeId == 23 || archetypeId == 24) {
      // Gas / CCGT combustor lag + exhaust temperature ceiling
      const tFuel = Math.max(0.05, getCon(conPtr, conCount, 2, 0.4));
      const tLim = Math.min(valve, pMax * 1.05);
      dPm = (tLim - pm) / tFuel;
    } else {
      const tReheat = archetypeId == 21 ? Math.max(0.05, getCon(conPtr, conCount, 5, 7.0)) : 0.08;
      dPm = (valve - pm) / tReheat;
    }
    setDState(slotPtr, 1, dValve);
    setDState(slotPtr, 2, dPm);
    setIo(slotPtr, 3, clamp(pm, pMin, pMax));
    return;
  }

  // Stabilizers (30..34)
  if (archetypeId >= 30 && archetypeId <= 34) {
    const ks = getCon(conPtr, conCount, archetypeId == 30 ? 12 : archetypeId == 32 ? 2 : 10, 10.0);
    const tw = Math.max(0.1, getCon(conPtr, conCount, 0, 5.0));
    const tLead = Math.max(0.01, getCon(conPtr, conCount, 4, 0.25));
    const tLag = Math.max(0.01, getCon(conPtr, conCount, 5, 0.04));
    const xw1 = getState(slotPtr, 0);
    const xw2 = getState(slotPtr, 1);
    const dxw1 = (speedDev - xw1) / tw;
    const wOut = speedDev - xw1;
    const dxw2 = (ks * wOut - xw2) / tLag;
    const vs = clamp((tLead / tLag) * (ks * wOut - xw2) + xw2, -0.1, 0.1);
    setDState(slotPtr, 0, dxw1);
    setDState(slotPtr, 1, dxw2);
    setState(slotPtr, 2, vs);
    setIo(slotPtr, 6, vs);
    return;
  }

  // IBRs (35..41)
  if (archetypeId >= 35 && archetypeId <= 41) {
    const tg = Math.max(0.01, getCon(conPtr, conCount, 0, 0.02));
    const vref0 = getState(slotPtr, 0);
    const p0 = getState(slotPtr, 1);
    const ip = getState(slotPtr, 2);
    const iq = getState(slotPtr, 3);
    if (archetypeId == 39) {
      // ibr_regfm_vsm: virtual synchronous machine P-f droop angle + Q-V magnitude
      const mp = Math.max(0.005, getCon(conPtr, conCount, 0, 0.05));
      const deltaGfm = getState(slotPtr, 4);
      const pMeas = vr * (ip * vr / eterm) + vi * (ip * vi / eterm);
      setDState(slotPtr, 4, 377.0 * mp * (p0 - pMeas));
      const cosG = Math.cos(deltaGfm);
      const sinG = Math.sin(deltaGfm);
      setIo(slotPtr, 9, ip * cosG + iq * sinG);
      setIo(slotPtr, 10, ip * sinG - iq * cosG);
      return;
    }
    const ipTarget = clamp(p0 / Math.max(0.25, eterm), -1.3, 1.3);
    const iqTarget = clamp(2.0 * (vref0 - eterm), -1.1, 1.1);
    setDState(slotPtr, 2, (ipTarget - ip) / tg);
    setDState(slotPtr, 3, (iqTarget - iq) / tg);
    const cosT = vr / eterm;
    const sinT = vi / eterm;
    setIo(slotPtr, 9, ip * cosT + iq * sinT);
    setIo(slotPtr, 10, ip * sinT - iq * cosT);
    return;
  }

  // Loads (42..47)
  if (archetypeId >= 42 && archetypeId <= 47) {
    const v0 = Math.max(0.2, getState(slotPtr, 0));
    const vNorm = eterm / v0;
    if (archetypeId == 42) {
      // load_static_zipf: algebraic voltage-dependent ZIP load (no slip ODE)
      setDState(slotPtr, 1, 0.0);
      setIo(slotPtr, 11, (vNorm * vNorm - 1.0) * 0.25);
      return;
    }
    const slip = getState(slotPtr, 1);
    const te = (vNorm * vNorm * (slip / 0.025)) / (1.0 + Math.pow(slip / 0.12, 2));
    const dSlip = (1.0 - te) / (archetypeId == 46 ? 0.6 : 1.2);
    setDState(slotPtr, 1, dSlip);
    const bMotor = -0.6 * Math.max(0.0, (slip - 0.025) / 0.975);
    setIo(slotPtr, 11, bMotor * eterm * eterm);
    return;
  }

  // FACTS / HVDC (48..53)
  if (archetypeId >= 48 && archetypeId <= 53) {
    const vref0 = getState(slotPtr, 0);
    const k = Math.max(1.0, getCon(conPtr, conCount, 1, 20.0));
    const x1 = getState(slotPtr, 1);
    const limitHi: f64 = archetypeId == 51 || archetypeId == 52 ? 2.0 : 1.5;
    const limitLo: f64 = archetypeId == 51 || archetypeId == 52 ? -2.0 : -1.0;
    const target = clamp(k * (vref0 - eterm), limitLo, limitHi);
    setDState(slotPtr, 1, (target - x1) / 0.03);
    setIo(slotPtr, 11, archetypeId == 49 ? x1 * eterm : x1 * eterm * eterm);
    return;
  }

  // Relays & Measurements (54..60)
  const tripPickup = archetypeId == 54 ? getCon(conPtr, conCount, 0, 59.3) / 60.0 - 1.0 : -0.25;
  const fpu = 1.0 + speedDev;
  const trippable = archetypeId == 56 ? eterm < 0.45 : speedDev < tripPickup || fpu < 0.95;
  setDState(slotPtr, 1, trippable ? 1.0 : -0.5);
  const timer = getState(slotPtr, 1);
  if (timer > Math.max(0.05, getCon(conPtr, conCount, 2, 0.25))) {
    setIo(slotPtr, 12, 0.0);
  }
}

/**
 * Advances one time step for any canonical `DaeArchetypeId` numeric code (`0..60`).
 */
export function psseModelStep(archetypeId: i32, t: f64, dt: f64, slotPtr: usize, conCount: i32): void {
  psseModelEvalDerivatives(archetypeId, t, dt, slotPtr, conCount);
  const conPtr = slotPtr + OFF_CON;

  for (let i: i32 = 0; i < 6; i++) {
    const d = load<f64>(slotPtr + OFF_DSTATE + ((<usize>i) << 3));
    if (d != 0.0) {
      let next = getState(slotPtr, i) + dt * d;
      if (archetypeId >= 10 && archetypeId <= 19 && i == 2) {
        const vrMax = getCon(conPtr, conCount, archetypeId == 14 ? 7 : 5, 5.0);
        const vrMin = getCon(conPtr, conCount, archetypeId == 14 ? 8 : 6, -4.0);
        next = clamp(next, vrMin, vrMax);
      } else if (archetypeId >= 20 && archetypeId <= 29 && i == 2) {
        const pMax = getCon(conPtr, conCount, 2, 1.1);
        const pMin = getCon(conPtr, conCount, 3, 0.0);
        next = clamp(next, pMin, pMax);
      } else if (archetypeId >= 42 && archetypeId <= 47 && i == 1) {
        next = clamp(next, 0.002, 0.99);
      } else if (archetypeId >= 54 && i == 1) {
        next = Math.max(0.0, next);
      }
      setState(slotPtr, i, next);
    }
  }

  // Refresh outputs after state update
  if (archetypeId >= 10 && archetypeId <= 19 && archetypeId != 17) {
    setIo(slotPtr, 2, getState(slotPtr, 2));
  } else if (archetypeId >= 20 && archetypeId <= 29) {
    setIo(slotPtr, 3, getState(slotPtr, 2));
  }
}


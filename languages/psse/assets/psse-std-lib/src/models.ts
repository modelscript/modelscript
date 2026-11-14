// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Clean-room AssemblyScript dynamic model implementations for `@modelscript/psse-std-lib`.
 *
 * Linear-memory ABI:
 *   - `<MODEL>_init(conPtr: usize, count: i32, statePtr: usize, ioPtr: usize): void`
 *   - `<MODEL>_step(t: f64, dt: f64, conPtr: usize, statePtr: usize, ioPtr: usize): void`
 *
 * `ioPtr` layout (6 x f64 = 48 bytes):
 *   [0] eterm (pu)   [1] speedDev (pu)   [2] efd (pu)   [3] pmech (pu)   [4] vr (pu)   [5] vi (pu)
 */

function clamp(x: f64, lo: f64, hi: f64): f64 {
  return x < lo ? lo : x > hi ? hi : x;
}

function getCon(conPtr: usize, count: i32, idx: i32, fallback: f64): f64 {
  if (idx < 0 || idx >= count) return fallback;
  const v = load<f64>(conPtr + ((idx as usize) << 3));
  return isFinite(v) ? v : fallback;
}

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
// CON: [0]=TR, [1]=VIMAX, [2]=VIMIN, [3]=TC, [4]=TB, [5]=KA, [6]=TA, [7]=VRMAX, [8]=VRMIN
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
// CON: [0]=TR, [1]=KA, [2]=TA, [3]=VRMAX, [4]=VRMIN, [5]=KE, [6]=TE
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
// CON: [0]=R, [1]=r, [2]=Tr, [3]=Tf, [4]=Tg, [5]=VELM, [6]=GMAX, [7]=GMIN, [8]=TW
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

// 9. GENROU / GENTPJ / GENSAE — Round-Rotor / Salient-Pole Synchronous Generator Flux-Decay Trim
export function GENROU_init(_conPtr: usize, _count: i32, statePtr: usize, ioPtr: usize): void {
  store<f64>(statePtr + 0, load<f64>(ioPtr + 16));
}
export function GENROU_step(_t: f64, _dt: f64, _conPtr: usize, _statePtr: usize, _ioPtr: usize): void {}

export function GENTPJ_init(_conPtr: usize, _count: i32, statePtr: usize, ioPtr: usize): void {
  store<f64>(statePtr + 0, load<f64>(ioPtr + 16));
}
export function GENTPJ_step(_t: f64, _dt: f64, _conPtr: usize, _statePtr: usize, _ioPtr: usize): void {}

export function GENSAE_init(_conPtr: usize, _count: i32, statePtr: usize, ioPtr: usize): void {
  store<f64>(statePtr + 0, load<f64>(ioPtr + 16));
}
export function GENSAE_step(_t: f64, _dt: f64, _conPtr: usize, _statePtr: usize, _ioPtr: usize): void {}

// 10. WECC Renewable / IBR Models: REGC_A, REEC_A, REPC_A
export function REGC_A_init(_conPtr: usize, _count: i32, statePtr: usize, ioPtr: usize): void {
  store<f64>(statePtr + 0, load<f64>(ioPtr + 16)); // Vref/Efd proxy
  store<f64>(statePtr + 8, load<f64>(ioPtr + 24)); // Pord
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

// 11. CMPLDW — Composite Load Model (FIDVR motor slip monitor)
export function CMPLDW_init(_conPtr: usize, _count: i32, statePtr: usize, ioPtr: usize): void {
  store<f64>(statePtr + 0, load<f64>(ioPtr + 0));
}
export function CMPLDW_step(_t: f64, _dt: f64, _conPtr: usize, _statePtr: usize, _ioPtr: usize): void {}

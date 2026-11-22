// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript pharmacometrics runtime for `@modelscript/mlxtran-std-lib`.
 *
 * Implements analytical & ODE PK/PD/TMDD/TGI formulations using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `PARAM[160]` (`f64`) — model parameter vector in schema order
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — dynamic state vector
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — simulation I/O bus:
 *       IO[0] = time (h or d)
 *       IO[1] = dose (mg or nmol)
 *       IO[2] = tinf (h) — infusion duration
 *       IO[3] = concIn (mg/L or nM) — driving plasma concentration for PD / TGI / Effect
 *       IO[4] = concOut (mg/L or nM) — primary central/free concentration output
 *       IO[5] = effectOut — pharmacodynamic effect / response output
 *       IO[6] = tumorOut — total tumor weight / volume output
 *       IO[7] = peripheralOut — peripheral amount or TMDD complex RC
 *       IO[8] = depotOut — depot amount or TMDD free target Rfree
 *       IO[9] = aucOut — analytical or accumulated AUC
 */

const OFF_PARAM: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `MlxtranArchetypeId` in mlxtran-std-schemas.ts)
const ARCH_BOLUS_1CPT: i32 = 1;
const ARCH_BOLUS_2CPT: i32 = 2;
const ARCH_BOLUS_3CPT: i32 = 3;
const ARCH_INFUSION_1CPT: i32 = 4;
const ARCH_ORAL1_1CPT: i32 = 5;
const ARCH_ORAL1_2CPT: i32 = 6;
const ARCH_ORAL1_1CPT_TLAG: i32 = 7;
const ARCH_ORAL0_1CPT: i32 = 8;
const ARCH_MICHAELIS_MENTEN: i32 = 9;

const ARCH_MACRO_PKMODEL: i32 = 20;
const ARCH_MACRO_DEPOT: i32 = 21;
const ARCH_MACRO_COMPARTMENT: i32 = 22;
const ARCH_MACRO_ABSORPTION: i32 = 23;
const ARCH_MACRO_ELIMINATION: i32 = 24;
const ARCH_MACRO_PERIPHERAL: i32 = 25;
const ARCH_MACRO_TRANSFER: i32 = 26;
const ARCH_MACRO_EFFECT: i32 = 27;

const ARCH_PD_EMAX_DIRECT: i32 = 30;
const ARCH_PD_SIGMOID_EMAX: i32 = 31;
const ARCH_PD_INDIRECT_INH: i32 = 32;
const ARCH_PD_INDIRECT_STIM: i32 = 33;
const ARCH_TMDD_QSS: i32 = 34;
const ARCH_TGI_SIMEONI: i32 = 35;
const ARCH_TGI_EXPONENTIAL: i32 = 36;

@inline
function getParam(slotPtr: usize, paramCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= paramCount) return fallback;
  const v = load<f64>(slotPtr + OFF_PARAM + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
}

@inline
function getState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_STATE + (<usize>idx << 3));
}

@inline
function setState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_STATE + (<usize>idx << 3), v);
}

@inline
function getDState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3));
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
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function mlxGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes model states at `t = 0` for the given Mlxtran archetype.
 * Returns the number of active dynamic states.
 */
export function mlxModelInit(archetypeId: i32, slotPtr: usize, paramCount: i32): i32 {
  const dose = getIo(slotPtr, 1);
  const concIn = getIo(slotPtr, 3);

  // Zero out first 8 states & derivatives
  for (let i = 0; i < 8; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }
  setIo(slotPtr, 4, 0.0);
  setIo(slotPtr, 5, 0.0);
  setIo(slotPtr, 6, 0.0);
  setIo(slotPtr, 7, 0.0);
  setIo(slotPtr, 8, 0.0);
  setIo(slotPtr, 9, 0.0);

  if (archetypeId == ARCH_BOLUS_1CPT || archetypeId == ARCH_MACRO_COMPARTMENT) {
    const V = Math.max(1e-9, getParam(slotPtr, paramCount, 0, 10.0));
    setState(slotPtr, 0, dose);
    setIo(slotPtr, 4, dose / V);
    return 1;
  }

  if (archetypeId == ARCH_BOLUS_2CPT) {
    const V = Math.max(1e-9, getParam(slotPtr, paramCount, 0, 10.0));
    setState(slotPtr, 0, dose);
    setState(slotPtr, 1, 0.0);
    setIo(slotPtr, 4, dose / V);
    return 2;
  }

  if (archetypeId == ARCH_BOLUS_3CPT) {
    const V = Math.max(1e-9, getParam(slotPtr, paramCount, 0, 10.0));
    setState(slotPtr, 0, dose);
    setState(slotPtr, 1, 0.0);
    setState(slotPtr, 2, 0.0);
    setIo(slotPtr, 4, dose / V);
    return 3;
  }

  if (
    archetypeId == ARCH_INFUSION_1CPT ||
    archetypeId == ARCH_ORAL0_1CPT
  ) {
    setState(slotPtr, 0, 0.0);
    setIo(slotPtr, 4, 0.0);
    return 1;
  }

  if (
    archetypeId == ARCH_ORAL1_1CPT ||
    archetypeId == ARCH_ORAL1_1CPT_TLAG ||
    archetypeId == ARCH_MACRO_DEPOT ||
    archetypeId == ARCH_MACRO_ABSORPTION
  ) {
    const F = archetypeId == ARCH_ORAL1_1CPT_TLAG
      ? getParam(slotPtr, paramCount, 4, 1.0)
      : archetypeId == ARCH_ORAL1_1CPT
        ? getParam(slotPtr, paramCount, 3, 1.0)
        : getParam(slotPtr, paramCount, 1, 1.0);
    setState(slotPtr, 0, F * dose);
    setState(slotPtr, 1, 0.0);
    setIo(slotPtr, 8, F * dose);
    return 2;
  }

  if (archetypeId == ARCH_ORAL1_2CPT) {
    const F = getParam(slotPtr, paramCount, 5, 1.0);
    setState(slotPtr, 0, F * dose);
    setState(slotPtr, 1, 0.0);
    setState(slotPtr, 2, 0.0);
    setIo(slotPtr, 8, F * dose);
    return 3;
  }

  if (archetypeId == ARCH_MICHAELIS_MENTEN) {
    const V = Math.max(1e-9, getParam(slotPtr, paramCount, 0, 10.0));
    const c0 = dose / V;
    setState(slotPtr, 0, c0);
    setIo(slotPtr, 4, c0);
    return 1;
  }

  if (archetypeId == ARCH_MACRO_PKMODEL) {
    const V = Math.max(1e-9, getParam(slotPtr, paramCount, 0, 10.0));
    const ka = getParam(slotPtr, paramCount, 2, 0.0);
    if (ka > 0.0) {
      setState(slotPtr, 0, dose);
      setState(slotPtr, 1, 0.0);
      setIo(slotPtr, 8, dose);
      return 2;
    }
    setState(slotPtr, 0, dose);
    setIo(slotPtr, 4, dose / V);
    return 1;
  }

  if (archetypeId == ARCH_MACRO_ELIMINATION || archetypeId == ARCH_MACRO_TRANSFER) {
    setState(slotPtr, 0, dose);
    setIo(slotPtr, 4, dose);
    return 1;
  }

  if (archetypeId == ARCH_MACRO_PERIPHERAL) {
    setState(slotPtr, 0, dose);
    setState(slotPtr, 1, 0.0);
    return 2;
  }

  if (archetypeId == ARCH_MACRO_EFFECT) {
    setState(slotPtr, 0, concIn);
    setIo(slotPtr, 4, concIn);
    setIo(slotPtr, 5, concIn);
    return 1;
  }

  if (archetypeId == ARCH_PD_EMAX_DIRECT || archetypeId == ARCH_PD_SIGMOID_EMAX) {
    const E0 = getParam(slotPtr, paramCount, 0, 0.0);
    setIo(slotPtr, 5, E0);
    return 0;
  }

  if (archetypeId == ARCH_PD_INDIRECT_INH || archetypeId == ARCH_PD_INDIRECT_STIM) {
    const kin = getParam(slotPtr, paramCount, 0, 10.0);
    const kout = Math.max(1e-9, getParam(slotPtr, paramCount, 1, 0.2));
    const r0 = kin / kout;
    setState(slotPtr, 0, r0);
    setIo(slotPtr, 5, r0);
    return 1;
  }

  if (archetypeId == ARCH_TMDD_QSS) {
    const ksyn = getParam(slotPtr, paramCount, 2, 1.0);
    const kdeg = Math.max(1e-9, getParam(slotPtr, paramCount, 3, 0.1));
    const Kss = Math.max(1e-9, getParam(slotPtr, paramCount, 4, 1.0));
    const V = Math.max(1e-9, getParam(slotPtr, paramCount, 5, 3.0));
    const ctot0 = Math.max(0.0, dose / V);
    const rtot0 = ksyn / kdeg;
    const b = ctot0 - rtot0 - Kss;
    const cfree0 = 0.5 * (b + Math.sqrt(b * b + 4.0 * Kss * ctot0));
    const rc0 = (rtot0 * cfree0) / (Kss + cfree0);
    setState(slotPtr, 0, ctot0);
    setState(slotPtr, 1, rtot0);
    setIo(slotPtr, 4, cfree0);
    setIo(slotPtr, 7, rc0);
    setIo(slotPtr, 8, rtot0 - rc0);
    return 2;
  }

  if (archetypeId == ARCH_TGI_SIMEONI) {
    const w0 = Math.max(1e-9, getParam(slotPtr, paramCount, 4, 0.1));
    setState(slotPtr, 0, w0);
    setState(slotPtr, 1, 0.0);
    setState(slotPtr, 2, 0.0);
    setState(slotPtr, 3, 0.0);
    setIo(slotPtr, 6, w0);
    return 4;
  }

  if (archetypeId == ARCH_TGI_EXPONENTIAL) {
    const w0 = Math.max(1e-9, getParam(slotPtr, paramCount, 2, 0.1));
    setState(slotPtr, 0, w0);
    setIo(slotPtr, 6, w0);
    return 1;
  }

  return 0;
}

/**
 * Computes state derivatives `dstate/dt` for ODE-based Mlxtran archetypes.
 */
function evalOdeDerivatives(archetypeId: i32, slotPtr: usize, paramCount: i32): i32 {
  const concIn = Math.max(0.0, getIo(slotPtr, 3));

  if (archetypeId == ARCH_BOLUS_3CPT) {
    const V = Math.max(1e-9, getParam(slotPtr, paramCount, 0, 10.0));
    const Cl = Math.max(0.0, getParam(slotPtr, paramCount, 1, 1.0));
    const Q2 = Math.max(0.0, getParam(slotPtr, paramCount, 2, 2.0));
    const V2 = Math.max(1e-9, getParam(slotPtr, paramCount, 3, 20.0));
    const Q3 = Math.max(0.0, getParam(slotPtr, paramCount, 4, 0.5));
    const V3 = Math.max(1e-9, getParam(slotPtr, paramCount, 5, 50.0));
    const a1 = getState(slotPtr, 0);
    const a2 = getState(slotPtr, 1);
    const a3 = getState(slotPtr, 2);
    const k10 = Cl / V;
    const k12 = Q2 / V;
    const k21 = Q2 / V2;
    const k13 = Q3 / V;
    const k31 = Q3 / V3;
    setDState(slotPtr, 0, -(k10 + k12 + k13) * a1 + k21 * a2 + k31 * a3);
    setDState(slotPtr, 1, k12 * a1 - k21 * a2);
    setDState(slotPtr, 2, k13 * a1 - k31 * a3);
    return 3;
  }

  if (archetypeId == ARCH_MICHAELIS_MENTEN) {
    const V = Math.max(1e-9, getParam(slotPtr, paramCount, 0, 10.0));
    const Vm = Math.max(0.0, getParam(slotPtr, paramCount, 1, 10.0));
    const Km = Math.max(1e-9, getParam(slotPtr, paramCount, 2, 5.0));
    const c = Math.max(0.0, getState(slotPtr, 0));
    setDState(slotPtr, 0, -(Vm * c) / (V * (Km + c)));
    return 1;
  }

  if (archetypeId == ARCH_MACRO_EFFECT) {
    const ke0 = Math.max(0.0, getParam(slotPtr, paramCount, 0, 0.5));
    const ce = getState(slotPtr, 0);
    setDState(slotPtr, 0, ke0 * (concIn - ce));
    return 1;
  }

  if (archetypeId == ARCH_MACRO_PERIPHERAL) {
    const k12 = Math.max(0.0, getParam(slotPtr, paramCount, 0, 0.2));
    const k21 = Math.max(0.0, getParam(slotPtr, paramCount, 1, 0.1));
    const ac = getState(slotPtr, 0);
    const ap = getState(slotPtr, 1);
    setDState(slotPtr, 0, -k12 * ac + k21 * ap);
    setDState(slotPtr, 1, k12 * ac - k21 * ap);
    return 2;
  }

  if (archetypeId == ARCH_PD_INDIRECT_INH) {
    const kin = getParam(slotPtr, paramCount, 0, 10.0);
    const kout = Math.max(0.0, getParam(slotPtr, paramCount, 1, 0.2));
    const Imax = Math.min(1.0, Math.max(0.0, getParam(slotPtr, paramCount, 2, 0.8)));
    const IC50 = Math.max(1e-9, getParam(slotPtr, paramCount, 3, 5.0));
    const r = getState(slotPtr, 0);
    const inh = (Imax * concIn) / (IC50 + concIn);
    setDState(slotPtr, 0, kin * (1.0 - inh) - kout * r);
    return 1;
  }

  if (archetypeId == ARCH_PD_INDIRECT_STIM) {
    const kin = getParam(slotPtr, paramCount, 0, 10.0);
    const kout = Math.max(0.0, getParam(slotPtr, paramCount, 1, 0.2));
    const Smax = Math.max(0.0, getParam(slotPtr, paramCount, 2, 2.0));
    const SC50 = Math.max(1e-9, getParam(slotPtr, paramCount, 3, 5.0));
    const r = getState(slotPtr, 0);
    const stim = (Smax * concIn) / (SC50 + concIn);
    setDState(slotPtr, 0, kin - kout * (1.0 + stim) * r);
    return 1;
  }

  if (archetypeId == ARCH_TMDD_QSS) {
    const kel = Math.max(0.0, getParam(slotPtr, paramCount, 0, 0.05));
    const kint = Math.max(0.0, getParam(slotPtr, paramCount, 1, 0.2));
    const ksyn = Math.max(0.0, getParam(slotPtr, paramCount, 2, 1.0));
    const kdeg = Math.max(0.0, getParam(slotPtr, paramCount, 3, 0.1));
    const Kss = Math.max(1e-9, getParam(slotPtr, paramCount, 4, 1.0));
    const ctot = Math.max(0.0, getState(slotPtr, 0));
    const rtot = Math.max(0.0, getState(slotPtr, 1));
    const b = ctot - rtot - Kss;
    const cfree = Math.max(0.0, 0.5 * (b + Math.sqrt(b * b + 4.0 * Kss * ctot)));
    const rc = (rtot * cfree) / (Kss + cfree);
    const rfree = Math.max(0.0, rtot - rc);
    setDState(slotPtr, 0, -kel * cfree - kint * rc);
    setDState(slotPtr, 1, ksyn - kdeg * rfree - kint * rc);
    return 2;
  }

  if (archetypeId == ARCH_TGI_SIMEONI) {
    const lambda0 = Math.max(0.0, getParam(slotPtr, paramCount, 0, 0.15));
    const lambda1 = Math.max(1e-9, getParam(slotPtr, paramCount, 1, 0.5));
    const k1 = Math.max(0.0, getParam(slotPtr, paramCount, 2, 0.5));
    const k2 = Math.max(0.0, getParam(slotPtr, paramCount, 3, 0.1));
    const psi = Math.max(1.0, getParam(slotPtr, paramCount, 5, 20.0));

    const x1 = Math.max(0.0, getState(slotPtr, 0));
    const x2 = Math.max(0.0, getState(slotPtr, 1));
    const x3 = Math.max(0.0, getState(slotPtr, 2));
    const x4 = Math.max(0.0, getState(slotPtr, 3));
    const w = Math.max(1e-12, x1 + x2 + x3 + x4);

    // Numerically stable Simeoni growth switch: lambda0 * x1 / (1 + ((lambda0/lambda1)*w)^psi)^(1/psi)
    const ratio = (lambda0 / lambda1) * w;
    let growth: f64;
    if (ratio > 2.0) {
      // Avoid overflow for large ratio^psi: asymptotes to lambda1 * (x1 / w)
      growth = lambda1 * (x1 / w);
    } else {
      const denom = Math.pow(1.0 + Math.pow(ratio, psi), 1.0 / psi);
      growth = (lambda0 * x1) / denom;
    }

    setDState(slotPtr, 0, growth - k2 * concIn * x1);
    setDState(slotPtr, 1, k2 * concIn * x1 - k1 * x2);
    setDState(slotPtr, 2, k1 * (x2 - x3));
    setDState(slotPtr, 3, k1 * (x3 - x4));
    return 4;
  }

  if (archetypeId == ARCH_TGI_EXPONENTIAL) {
    const kg = getParam(slotPtr, paramCount, 0, 0.1);
    const kd = getParam(slotPtr, paramCount, 1, 0.05);
    const w = Math.max(0.0, getState(slotPtr, 0));
    setDState(slotPtr, 0, (kg - kd * concIn) * w);
    return 1;
  }

  return 0;
}

/**
 * Advances an ODE archetype by `dt` using classical 4th-order Runge-Kutta (RK4)
 * with automatic sub-stepping for stability.
 */
function rk4Advance(archetypeId: i32, dt: f64, slotPtr: usize, paramCount: i32): void {
  if (dt <= 0.0) return;
  const maxSubStep: f64 = 0.05;
  const steps = <i32>Math.max(1.0, Math.ceil(dt / maxSubStep));
  const h = dt / <f64>steps;

  for (let s = 0; s < steps; s++) {
    const y0_0 = getState(slotPtr, 0);
    const y0_1 = getState(slotPtr, 1);
    const y0_2 = getState(slotPtr, 2);
    const y0_3 = getState(slotPtr, 3);

    const n = evalOdeDerivatives(archetypeId, slotPtr, paramCount);
    if (n <= 0) return;
    const k1_0 = getDState(slotPtr, 0);
    const k1_1 = getDState(slotPtr, 1);
    const k1_2 = getDState(slotPtr, 2);
    const k1_3 = getDState(slotPtr, 3);

    setState(slotPtr, 0, y0_0 + 0.5 * h * k1_0);
    setState(slotPtr, 1, y0_1 + 0.5 * h * k1_1);
    setState(slotPtr, 2, y0_2 + 0.5 * h * k1_2);
    setState(slotPtr, 3, y0_3 + 0.5 * h * k1_3);
    evalOdeDerivatives(archetypeId, slotPtr, paramCount);
    const k2_0 = getDState(slotPtr, 0);
    const k2_1 = getDState(slotPtr, 1);
    const k2_2 = getDState(slotPtr, 2);
    const k2_3 = getDState(slotPtr, 3);

    setState(slotPtr, 0, y0_0 + 0.5 * h * k2_0);
    setState(slotPtr, 1, y0_1 + 0.5 * h * k2_1);
    setState(slotPtr, 2, y0_2 + 0.5 * h * k2_2);
    setState(slotPtr, 3, y0_3 + 0.5 * h * k2_3);
    evalOdeDerivatives(archetypeId, slotPtr, paramCount);
    const k3_0 = getDState(slotPtr, 0);
    const k3_1 = getDState(slotPtr, 1);
    const k3_2 = getDState(slotPtr, 2);
    const k3_3 = getDState(slotPtr, 3);

    setState(slotPtr, 0, y0_0 + h * k3_0);
    setState(slotPtr, 1, y0_1 + h * k3_1);
    setState(slotPtr, 2, y0_2 + h * k3_2);
    setState(slotPtr, 3, y0_3 + h * k3_3);
    evalOdeDerivatives(archetypeId, slotPtr, paramCount);
    const k4_0 = getDState(slotPtr, 0);
    const k4_1 = getDState(slotPtr, 1);
    const k4_2 = getDState(slotPtr, 2);
    const k4_3 = getDState(slotPtr, 3);

    setState(slotPtr, 0, y0_0 + (h / 6.0) * (k1_0 + 2.0 * k2_0 + 2.0 * k3_0 + k4_0));
    if (n > 1) setState(slotPtr, 1, y0_1 + (h / 6.0) * (k1_1 + 2.0 * k2_1 + 2.0 * k3_1 + k4_1));
    if (n > 2) setState(slotPtr, 2, y0_2 + (h / 6.0) * (k1_2 + 2.0 * k2_2 + 2.0 * k3_2 + k4_2));
    if (n > 3) setState(slotPtr, 3, y0_3 + (h / 6.0) * (k1_3 + 2.0 * k2_3 + 2.0 * k3_3 + k4_3));
  }
}

/**
 * Evaluates a cleanroom Mlxtran pharmacometrics model at time `t` (with step `dt` for ODE models).
 * Writes full outputs into the slot `IO[]` bus and returns the primary scalar output
 * (`concOut` for PK/TMDD, `effectOut` for PD, `tumorOut` for TGI).
 */
export function mlxModelEval(
  archetypeId: i32,
  t: f64,
  dt: f64,
  slotPtr: usize,
  paramCount: i32,
): f64 {
  const time = t >= 0.0 ? t : 0.0;
  const dose = getIo(slotPtr, 1);
  const tinf = getIo(slotPtr, 2) > 1e-9 ? getIo(slotPtr, 2) : 1.0;
  const concIn = Math.max(0.0, getIo(slotPtr, 3));
  setIo(slotPtr, 0, time);

  // 1. 1-Compartment IV Bolus (analytical)
  if (archetypeId == ARCH_BOLUS_1CPT) {
    const V = Math.max(1e-9, getParam(slotPtr, paramCount, 0, 10.0));
    const Cl = Math.max(0.0, getParam(slotPtr, paramCount, 1, 1.0));
    const ke = Cl / V;
    const ac = dose * Math.exp(-ke * time);
    const cc = ac / V;
    const auc = Cl > 1e-12 ? (dose / Cl) * (1.0 - Math.exp(-ke * time)) : cc * time;
    setState(slotPtr, 0, ac);
    setIo(slotPtr, 4, cc);
    setIo(slotPtr, 9, auc);
    return cc;
  }

  // 2. 2-Compartment IV Bolus (analytical bi-exponential)
  if (archetypeId == ARCH_BOLUS_2CPT) {
    const V = Math.max(1e-9, getParam(slotPtr, paramCount, 0, 10.0));
    const Cl = Math.max(0.0, getParam(slotPtr, paramCount, 1, 1.0));
    const Q = Math.max(0.0, getParam(slotPtr, paramCount, 2, 2.0));
    const Vp = Math.max(1e-9, getParam(slotPtr, paramCount, 3, 20.0));
    const k10 = Cl / V;
    const k12 = Q / V;
    const k21 = Q / Vp;
    const sum = k10 + k12 + k21;
    const prod = k10 * k21;
    const disc = Math.sqrt(Math.max(0.0, sum * sum - 4.0 * prod));
    const alpha = 0.5 * (sum + disc);
    const beta = 0.5 * (sum - disc);
    const diff = Math.max(1e-12, alpha - beta);
    const A = (alpha - k21) / (V * diff);
    const B = (k21 - beta) / (V * diff);
    const expA = Math.exp(-alpha * time);
    const expB = Math.exp(-beta * time);
    const cc = dose * (A * expA + B * expB);
    const ap = dose * (k12 / diff) * (expB - expA);
    setState(slotPtr, 0, cc * V);
    setState(slotPtr, 1, ap);
    setIo(slotPtr, 4, cc);
    setIo(slotPtr, 7, ap);
    return cc;
  }

  // 3. 3-Compartment IV Bolus (RK4 ODE)
  if (archetypeId == ARCH_BOLUS_3CPT) {
    const V = Math.max(1e-9, getParam(slotPtr, paramCount, 0, 10.0));
    rk4Advance(archetypeId, dt, slotPtr, paramCount);
    const cc = getState(slotPtr, 0) / V;
    setIo(slotPtr, 4, cc);
    setIo(slotPtr, 7, getState(slotPtr, 1) + getState(slotPtr, 2));
    return cc;
  }

  // 4. 1-Compartment IV Infusion (analytical)
  if (archetypeId == ARCH_INFUSION_1CPT) {
    const V = Math.max(1e-9, getParam(slotPtr, paramCount, 0, 10.0));
    const Cl = Math.max(1e-9, getParam(slotPtr, paramCount, 1, 1.0));
    const ke = Cl / V;
    const r0 = dose / tinf;
    let cc: f64;
    if (time <= tinf) {
      cc = (r0 / Cl) * (1.0 - Math.exp(-ke * time));
    } else {
      cc = (r0 / Cl) * (1.0 - Math.exp(-ke * tinf)) * Math.exp(-ke * (time - tinf));
    }
    setState(slotPtr, 0, cc * V);
    setIo(slotPtr, 4, cc);
    return cc;
  }

  // 5. 1-Compartment First-Order Oral (Bateman analytical)
  if (archetypeId == ARCH_ORAL1_1CPT) {
    const ka = Math.max(1e-9, getParam(slotPtr, paramCount, 0, 1.0));
    const V = Math.max(1e-9, getParam(slotPtr, paramCount, 1, 10.0));
    const Cl = Math.max(0.0, getParam(slotPtr, paramCount, 2, 1.0));
    const F = getParam(slotPtr, paramCount, 3, 1.0);
    const ke = Cl / V;
    const ad = F * dose * Math.exp(-ka * time);
    let cc: f64;
    if (Math.abs(ka - ke) > 1e-7) {
      cc = ((F * dose * ka) / (V * (ka - ke))) * (Math.exp(-ke * time) - Math.exp(-ka * time));
    } else {
      cc = ((F * dose * ka * time) / V) * Math.exp(-ke * time);
    }
    setState(slotPtr, 0, ad);
    setState(slotPtr, 1, cc * V);
    setIo(slotPtr, 4, cc);
    setIo(slotPtr, 8, ad);
    return cc;
  }

  // 6. 2-Compartment First-Order Oral (analytical tri-exponential)
  if (archetypeId == ARCH_ORAL1_2CPT) {
    const ka = Math.max(1e-9, getParam(slotPtr, paramCount, 0, 1.0));
    const V = Math.max(1e-9, getParam(slotPtr, paramCount, 1, 10.0));
    const Cl = Math.max(0.0, getParam(slotPtr, paramCount, 2, 1.0));
    const Q = Math.max(0.0, getParam(slotPtr, paramCount, 3, 2.0));
    const Vp = Math.max(1e-9, getParam(slotPtr, paramCount, 4, 20.0));
    const F = getParam(slotPtr, paramCount, 5, 1.0);
    const k10 = Cl / V;
    const k12 = Q / V;
    const k21 = Q / Vp;
    const sum = k10 + k12 + k21;
    const prod = k10 * k21;
    const disc = Math.sqrt(Math.max(0.0, sum * sum - 4.0 * prod));
    const alpha = 0.5 * (sum + disc);
    const beta = 0.5 * (sum - disc);
    const kaEff =
      Math.abs(ka - alpha) < 1e-6 || Math.abs(ka - beta) < 1e-6 ? ka + 1e-5 : ka;
    const cAlpha = (k21 - alpha) / ((kaEff - alpha) * (beta - alpha));
    const cBeta = (k21 - beta) / ((kaEff - beta) * (alpha - beta));
    const cKa = (k21 - kaEff) / ((alpha - kaEff) * (beta - kaEff));
    const cc =
      ((F * dose * kaEff) / V) *
      (cAlpha * Math.exp(-alpha * time) + cBeta * Math.exp(-beta * time) + cKa * Math.exp(-kaEff * time));
    const ad = F * dose * Math.exp(-kaEff * time);
    setState(slotPtr, 0, ad);
    setState(slotPtr, 1, cc * V);
    setIo(slotPtr, 4, Math.max(0.0, cc));
    setIo(slotPtr, 8, ad);
    return Math.max(0.0, cc);
  }

  // 7. 1-Compartment First-Order Oral with Lag Time
  if (archetypeId == ARCH_ORAL1_1CPT_TLAG) {
    const Tlag = Math.max(0.0, getParam(slotPtr, paramCount, 0, 0.5));
    const ka = Math.max(1e-9, getParam(slotPtr, paramCount, 1, 1.0));
    const V = Math.max(1e-9, getParam(slotPtr, paramCount, 2, 10.0));
    const Cl = Math.max(0.0, getParam(slotPtr, paramCount, 3, 1.0));
    const F = getParam(slotPtr, paramCount, 4, 1.0);
    if (time <= Tlag) {
      setState(slotPtr, 0, F * dose);
      setState(slotPtr, 1, 0.0);
      setIo(slotPtr, 4, 0.0);
      setIo(slotPtr, 8, F * dose);
      return 0.0;
    }
    const tau = time - Tlag;
    const ke = Cl / V;
    const ad = F * dose * Math.exp(-ka * tau);
    let cc: f64;
    if (Math.abs(ka - ke) > 1e-7) {
      cc = ((F * dose * ka) / (V * (ka - ke))) * (Math.exp(-ke * tau) - Math.exp(-ka * tau));
    } else {
      cc = ((F * dose * ka * tau) / V) * Math.exp(-ke * tau);
    }
    setState(slotPtr, 0, ad);
    setState(slotPtr, 1, cc * V);
    setIo(slotPtr, 4, cc);
    setIo(slotPtr, 8, ad);
    return cc;
  }

  // 8. 1-Compartment Zero-Order Oral (Tk0)
  if (archetypeId == ARCH_ORAL0_1CPT) {
    const Tk0 = Math.max(1e-9, getParam(slotPtr, paramCount, 0, 2.0));
    const V = Math.max(1e-9, getParam(slotPtr, paramCount, 1, 10.0));
    const Cl = Math.max(1e-9, getParam(slotPtr, paramCount, 2, 1.0));
    const F = getParam(slotPtr, paramCount, 3, 1.0);
    const ke = Cl / V;
    const r0 = (F * dose) / Tk0;
    let cc: f64;
    if (time <= Tk0) {
      cc = (r0 / Cl) * (1.0 - Math.exp(-ke * time));
    } else {
      cc = (r0 / Cl) * (1.0 - Math.exp(-ke * Tk0)) * Math.exp(-ke * (time - Tk0));
    }
    setState(slotPtr, 0, cc * V);
    setIo(slotPtr, 4, cc);
    return cc;
  }

  // 9. Michaelis-Menten 1-Compartment (RK4 ODE)
  if (archetypeId == ARCH_MICHAELIS_MENTEN) {
    rk4Advance(archetypeId, dt, slotPtr, paramCount);
    const cc = Math.max(0.0, getState(slotPtr, 0));
    setIo(slotPtr, 4, cc);
    return cc;
  }

  // 10. PK Macros
  if (archetypeId == ARCH_MACRO_PKMODEL) {
    const V = Math.max(1e-9, getParam(slotPtr, paramCount, 0, 10.0));
    const Cl = Math.max(0.0, getParam(slotPtr, paramCount, 1, 1.0));
    const ka = getParam(slotPtr, paramCount, 2, 0.0);
    const ke = Cl / V;
    let cc: f64;
    if (ka > 1e-9) {
      if (Math.abs(ka - ke) > 1e-7) {
        cc = ((dose * ka) / (V * (ka - ke))) * (Math.exp(-ke * time) - Math.exp(-ka * time));
      } else {
        cc = ((dose * ka * time) / V) * Math.exp(-ke * time);
      }
    } else {
      cc = (dose / V) * Math.exp(-ke * time);
    }
    setIo(slotPtr, 4, cc);
    return cc;
  }

  if (archetypeId == ARCH_MACRO_DEPOT || archetypeId == ARCH_MACRO_ABSORPTION) {
    const ka = Math.max(0.0, getParam(slotPtr, paramCount, 0, 1.0));
    const p = getParam(slotPtr, paramCount, 1, 1.0);
    const Tlag = Math.max(0.0, getParam(slotPtr, paramCount, 2, 0.0));
    const tau = Math.max(0.0, time - Tlag);
    const ad = p * dose * Math.exp(-ka * tau);
    setState(slotPtr, 0, ad);
    setIo(slotPtr, 8, ad);
    setIo(slotPtr, 4, ka * ad);
    return ad;
  }

  if (archetypeId == ARCH_MACRO_COMPARTMENT) {
    const V = Math.max(1e-9, getParam(slotPtr, paramCount, 0, 10.0));
    const k = Math.max(0.0, getParam(slotPtr, paramCount, 1, 0.1));
    const a = dose * Math.exp(-k * time);
    setState(slotPtr, 0, a);
    setIo(slotPtr, 4, a / V);
    return a / V;
  }

  if (archetypeId == ARCH_MACRO_ELIMINATION || archetypeId == ARCH_MACRO_TRANSFER) {
    const k = Math.max(0.0, getParam(slotPtr, paramCount, 0, 0.1));
    const a = dose * Math.exp(-k * time);
    setState(slotPtr, 0, a);
    setIo(slotPtr, 4, a);
    return a;
  }

  if (archetypeId == ARCH_MACRO_PERIPHERAL) {
    rk4Advance(archetypeId, dt, slotPtr, paramCount);
    const ap = getState(slotPtr, 1);
    setIo(slotPtr, 7, ap);
    return ap;
  }

  if (archetypeId == ARCH_MACRO_EFFECT) {
    rk4Advance(archetypeId, dt, slotPtr, paramCount);
    const ce = getState(slotPtr, 0);
    setIo(slotPtr, 4, ce);
    setIo(slotPtr, 5, ce);
    return ce;
  }

  // 11. Direct Emax PD
  if (archetypeId == ARCH_PD_EMAX_DIRECT) {
    const E0 = getParam(slotPtr, paramCount, 0, 0.0);
    const Emax = getParam(slotPtr, paramCount, 1, 100.0);
    const EC50 = Math.max(1e-9, getParam(slotPtr, paramCount, 2, 5.0));
    const eff = E0 + (Emax * concIn) / (EC50 + concIn);
    setIo(slotPtr, 5, eff);
    return eff;
  }

  // 12. Sigmoid Hill Emax PD
  if (archetypeId == ARCH_PD_SIGMOID_EMAX) {
    const E0 = getParam(slotPtr, paramCount, 0, 0.0);
    const Emax = getParam(slotPtr, paramCount, 1, 100.0);
    const EC50 = Math.max(1e-9, getParam(slotPtr, paramCount, 2, 5.0));
    const gamma = Math.max(1e-6, getParam(slotPtr, paramCount, 3, 2.0));
    const cPow = Math.pow(concIn, gamma);
    const ecPow = Math.pow(EC50, gamma);
    const eff = E0 + (Emax * cPow) / (ecPow + cPow);
    setIo(slotPtr, 5, eff);
    return eff;
  }

  // 13. Indirect Response Turnover ODEs (Dayneka Type I & IV)
  if (archetypeId == ARCH_PD_INDIRECT_INH || archetypeId == ARCH_PD_INDIRECT_STIM) {
    rk4Advance(archetypeId, dt, slotPtr, paramCount);
    const r = Math.max(0.0, getState(slotPtr, 0));
    setIo(slotPtr, 5, r);
    return r;
  }

  // 14. TMDD Quasi-Steady-State (QSS)
  if (archetypeId == ARCH_TMDD_QSS) {
    rk4Advance(archetypeId, dt, slotPtr, paramCount);
    const Kss = Math.max(1e-9, getParam(slotPtr, paramCount, 4, 1.0));
    const ctot = Math.max(0.0, getState(slotPtr, 0));
    const rtot = Math.max(0.0, getState(slotPtr, 1));
    const b = ctot - rtot - Kss;
    const cfree = Math.max(0.0, 0.5 * (b + Math.sqrt(b * b + 4.0 * Kss * ctot)));
    const rc = (rtot * cfree) / (Kss + cfree);
    setIo(slotPtr, 4, cfree);
    setIo(slotPtr, 7, rc);
    setIo(slotPtr, 8, Math.max(0.0, rtot - rc));
    return cfree;
  }

  // 15. Simeoni Tumor Growth Inhibition (TGI)
  if (archetypeId == ARCH_TGI_SIMEONI) {
    rk4Advance(archetypeId, dt, slotPtr, paramCount);
    const w =
      Math.max(0.0, getState(slotPtr, 0)) +
      Math.max(0.0, getState(slotPtr, 1)) +
      Math.max(0.0, getState(slotPtr, 2)) +
      Math.max(0.0, getState(slotPtr, 3));
    setIo(slotPtr, 6, w);
    return w;
  }

  // 16. Exponential Tumor Growth & Log-Kill
  if (archetypeId == ARCH_TGI_EXPONENTIAL) {
    rk4Advance(archetypeId, dt, slotPtr, paramCount);
    const w = Math.max(0.0, getState(slotPtr, 0));
    setIo(slotPtr, 6, w);
    return w;
  }

  return 0.0;
}

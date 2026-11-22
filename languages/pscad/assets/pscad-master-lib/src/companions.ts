// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Clean-room AssemblyScript `fmi-ls-emt` companion implementations for `@modelscript/pscad-master-lib`.
 *
 * All 10 built-in Norton companion models are multi-instance safe (up to 64 concurrent
 * instances per model via `companion_set_instance(id)` defaulting to instance 0).
 */

const MAX_COMP_INST: i32 = 64;
let activeInst: i32 = 0;

export function companion_set_instance(id: i32): void {
  activeInst = id < 0 ? 0 : id >= MAX_COMP_INST ? MAX_COMP_INST - 1 : id;
}

export function companion_get_instance(): i32 {
  return activeInst;
}

function writeDiagG(gPtr: usize, g0: f64, g1: f64, g2: f64): void {
  store<f64>(gPtr + 0, g0);
  store<f64>(gPtr + 8, 0.0);
  store<f64>(gPtr + 16, 0.0);
  store<f64>(gPtr + 24, 0.0);
  store<f64>(gPtr + 32, g1);
  store<f64>(gPtr + 40, 0.0);
  store<f64>(gPtr + 48, 0.0);
  store<f64>(gPtr + 56, 0.0);
  store<f64>(gPtr + 64, g2);
}

function writeI(iPtr: usize, i0: f64, i1: f64, i2: f64): void {
  store<f64>(iPtr + 0, i0);
  store<f64>(iPtr + 8, i1);
  store<f64>(iPtr + 16, i2);
}

// 1. Three-phase shunt resistor (default R = 100 Ohm; params[0] = R)
const resRArr = new Float64Array(MAX_COMP_INST);
resRArr.fill(100.0);
export function resistor_init(paramsPtr: usize, count: i32): void {
  const id = activeInst;
  resRArr[id] = 100.0;
  if (count >= 1) {
    const r = load<f64>(paramsPtr + 0);
    if (isFinite(r) && r > 0.0) resRArr[id] = r;
  }
}
export function resistor_stampCompanion(_t: f64, _dt: f64, gPtr: usize, iPtr: usize): void {
  const g = 1.0 / resRArr[activeInst];
  writeDiagG(gPtr, g, g, g);
  writeI(iPtr, 0.0, 0.0, 0.0);
}
export function resistor_doStep(_t: f64, _dt: f64, _vPtr: usize): void {}

// 2. Three-phase trapezoidal inductor (default L = 0.05 H; params[1] = L or params[0] = L)
const indLArr = new Float64Array(MAX_COMP_INST);
indLArr.fill(0.05);
const indHist = new Float64Array(MAX_COMP_INST * 3);
export function inductor_init(paramsPtr: usize, count: i32): void {
  const id = activeInst;
  indLArr[id] = 0.05;
  const l = count >= 2 ? load<f64>(paramsPtr + 8) : count >= 1 ? load<f64>(paramsPtr + 0) : NaN;
  if (isFinite(l) && l > 0.0) indLArr[id] = l;
  const h = id * 3;
  indHist[h + 0] = 0.0;
  indHist[h + 1] = 0.0;
  indHist[h + 2] = 0.0;
}
export function inductor_stampCompanion(_t: f64, dt: f64, gPtr: usize, iPtr: usize): void {
  const id = activeInst;
  const h = id * 3;
  const safeDt = dt > 1e-9 ? dt : 50e-6;
  const g = safeDt / (2.0 * indLArr[id]);
  writeDiagG(gPtr, g, g, g);
  writeI(iPtr, indHist[h + 0], indHist[h + 1], indHist[h + 2]);
}
export function inductor_doStep(_t: f64, dt: f64, vPtr: usize): void {
  const id = activeInst;
  const h = id * 3;
  const safeDt = dt > 1e-9 ? dt : 50e-6;
  const g = safeDt / (2.0 * indLArr[id]);
  const v0 = load<f64>(vPtr + 0);
  const v1 = load<f64>(vPtr + 8);
  const v2 = load<f64>(vPtr + 16);
  indHist[h + 0] = -(indHist[h + 0] + 2.0 * g * v0);
  indHist[h + 1] = -(indHist[h + 1] + 2.0 * g * v1);
  indHist[h + 2] = -(indHist[h + 2] + 2.0 * g * v2);
}

// 3. Three-phase trapezoidal capacitor (default C = 10 uF; params[2] = C or params[0] = C)
const capCArr = new Float64Array(MAX_COMP_INST);
capCArr.fill(10e-6);
const capHist = new Float64Array(MAX_COMP_INST * 3);
export function capacitor_init(paramsPtr: usize, count: i32): void {
  const id = activeInst;
  capCArr[id] = 10e-6;
  const c = count >= 3 ? load<f64>(paramsPtr + 16) : count >= 1 ? load<f64>(paramsPtr + 0) : NaN;
  if (isFinite(c) && c > 0.0) capCArr[id] = c;
  const h = id * 3;
  capHist[h + 0] = 0.0;
  capHist[h + 1] = 0.0;
  capHist[h + 2] = 0.0;
}
export function capacitor_stampCompanion(_t: f64, dt: f64, gPtr: usize, iPtr: usize): void {
  const id = activeInst;
  const h = id * 3;
  const safeDt = dt > 1e-9 ? dt : 50e-6;
  const g = (2.0 * capCArr[id]) / safeDt;
  writeDiagG(gPtr, g, g, g);
  writeI(iPtr, capHist[h + 0], capHist[h + 1], capHist[h + 2]);
}
export function capacitor_doStep(_t: f64, dt: f64, vPtr: usize): void {
  const id = activeInst;
  const h = id * 3;
  const safeDt = dt > 1e-9 ? dt : 50e-6;
  const g = (2.0 * capCArr[id]) / safeDt;
  const v0 = load<f64>(vPtr + 0);
  const v1 = load<f64>(vPtr + 8);
  const v2 = load<f64>(vPtr + 16);
  capHist[h + 0] = -(2.0 * g * v0 + capHist[h + 0]);
  capHist[h + 1] = -(2.0 * g * v1 + capHist[h + 1]);
  capHist[h + 2] = -(2.0 * g * v2 + capHist[h + 2]);
}

// 4. Three-phase circuit breaker (default closed R = 0.005 Ohm; params[0] = Rcls)
const brkRArr = new Float64Array(MAX_COMP_INST);
brkRArr.fill(0.005);
export function breaker3_init(paramsPtr: usize, count: i32): void {
  const id = activeInst;
  brkRArr[id] = 0.005;
  if (count >= 1) {
    const r = load<f64>(paramsPtr + 0);
    if (isFinite(r) && r > 0.0) brkRArr[id] = r;
  }
}
export function breaker3_stampCompanion(_t: f64, _dt: f64, gPtr: usize, iPtr: usize): void {
  const g = 1.0 / brkRArr[activeInst];
  writeDiagG(gPtr, g, g, g);
  writeI(iPtr, 0.0, 0.0, 0.0);
}
export function breaker3_doStep(_t: f64, _dt: f64, _vPtr: usize): void {}

// 5. Generic grid-following IBR / VSC-PWM Norton companion (default droop + damping)
const ibrPllAngleArr = new Float64Array(MAX_COMP_INST);
export function fmu_ibr_stampCompanion(_t: f64, _dt: f64, gPtr: usize, iPtr: usize): void {
  const g = 0.02;
  const amp = 1.0;
  const ang = ibrPllAngleArr[activeInst];
  writeDiagG(gPtr, g, g, g);
  writeI(
    iPtr,
    amp * Math.sin(ang),
    amp * Math.sin(ang - (2.0 * Math.PI) / 3.0),
    amp * Math.sin(ang + (2.0 * Math.PI) / 3.0),
  );
}
export function fmu_ibr_doStep(_t: f64, dt: f64, _vPtr: usize): void {
  const safeDt = dt > 1e-9 ? dt : 50e-6;
  ibrPllAngleArr[activeInst] += 2.0 * Math.PI * 60.0 * safeDt;
}

export function vsc_pwm_stampCompanion(t: f64, dt: f64, gPtr: usize, iPtr: usize): void {
  fmu_ibr_stampCompanion(t, dt, gPtr, iPtr);
}
export function vsc_pwm_doStep(t: f64, dt: f64, vPtr: usize): void {
  fmu_ibr_doStep(t, dt, vPtr);
}

// 6. Three-phase leakage-inductance transformer companion (params[0] = R, params[1] = L_leak)
const xfmrRArr = new Float64Array(MAX_COMP_INST);
xfmrRArr.fill(0.05);
const xfmrLArr = new Float64Array(MAX_COMP_INST);
xfmrLArr.fill(0.01);
const xfmrHist = new Float64Array(MAX_COMP_INST * 3);
export function transformer_init(paramsPtr: usize, count: i32): void {
  const id = activeInst;
  xfmrRArr[id] = 0.05;
  xfmrLArr[id] = 0.01;
  const r = count >= 1 ? load<f64>(paramsPtr + 0) : NaN;
  const l = count >= 2 ? load<f64>(paramsPtr + 8) : NaN;
  if (isFinite(r) && r > 0.0) xfmrRArr[id] = r;
  if (isFinite(l) && l > 0.0) xfmrLArr[id] = l;
  const h = id * 3;
  xfmrHist[h + 0] = 0.0;
  xfmrHist[h + 1] = 0.0;
  xfmrHist[h + 2] = 0.0;
}
export function transformer_stampCompanion(_t: f64, dt: f64, gPtr: usize, iPtr: usize): void {
  const id = activeInst;
  const h = id * 3;
  const safeDt = dt > 1e-9 ? dt : 50e-6;
  const g = 1.0 / (xfmrRArr[id] + (2.0 * xfmrLArr[id]) / safeDt);
  writeDiagG(gPtr, g, g, g);
  writeI(iPtr, xfmrHist[h + 0], xfmrHist[h + 1], xfmrHist[h + 2]);
}
export function transformer_doStep(_t: f64, dt: f64, vPtr: usize): void {
  const id = activeInst;
  const h = id * 3;
  const safeDt = dt > 1e-9 ? dt : 50e-6;
  const r = xfmrRArr[id];
  const zL = (2.0 * xfmrLArr[id]) / safeDt;
  const k = (zL - r) / (zL + r);
  const g = 1.0 / (zL + r);
  xfmrHist[h + 0] = k * xfmrHist[h + 0] + 2.0 * g * load<f64>(vPtr + 0);
  xfmrHist[h + 1] = k * xfmrHist[h + 1] + 2.0 * g * load<f64>(vPtr + 8);
  xfmrHist[h + 2] = k * xfmrHist[h + 2] + 2.0 * g * load<f64>(vPtr + 16);
}

// 7. MOV surge arrester companion (params[3] = Vref_kV, clamping conductance when |v| > Vref)
const arrVrefArr = new Float64Array(MAX_COMP_INST);
arrVrefArr.fill(200e3);
const arrClampedArr = new Uint8Array(MAX_COMP_INST);
export function arrester_init(paramsPtr: usize, count: i32): void {
  const id = activeInst;
  arrVrefArr[id] = 200e3;
  const vRefKv = count >= 4 ? load<f64>(paramsPtr + 24) : NaN;
  if (isFinite(vRefKv) && vRefKv > 0.0) arrVrefArr[id] = vRefKv * 1e3;
  arrClampedArr[id] = 0;
}
export function arrester_stampCompanion(_t: f64, _dt: f64, gPtr: usize, iPtr: usize): void {
  const g = arrClampedArr[activeInst] != 0 ? 1.0 : 1e-9;
  writeDiagG(gPtr, g, g, g);
  writeI(iPtr, 0.0, 0.0, 0.0);
}
export function arrester_doStep(_t: f64, _dt: f64, vPtr: usize): void {
  const id = activeInst;
  const vRef = arrVrefArr[id];
  const v0 = Math.abs(load<f64>(vPtr + 0));
  const v1 = Math.abs(load<f64>(vPtr + 8));
  const v2 = Math.abs(load<f64>(vPtr + 16));
  arrClampedArr[id] = v0 > vRef || v1 > vRef || v2 > vRef ? 1 : 0;
}

// 8. Switching diode companion (params[0] = Ron)
const diodeRonArr = new Float64Array(MAX_COMP_INST);
diodeRonArr.fill(0.01);
const diodeCondArr = new Uint8Array(MAX_COMP_INST);
diodeCondArr.fill(1);
export function diode_init(paramsPtr: usize, count: i32): void {
  const id = activeInst;
  diodeRonArr[id] = 0.01;
  const ron = count >= 1 ? load<f64>(paramsPtr + 0) : NaN;
  if (isFinite(ron) && ron > 1e-6) diodeRonArr[id] = ron;
  diodeCondArr[id] = 1;
}
export function diode_stampCompanion(_t: f64, _dt: f64, gPtr: usize, iPtr: usize): void {
  const id = activeInst;
  const g = diodeCondArr[id] != 0 ? 1.0 / diodeRonArr[id] : 1e-6;
  writeDiagG(gPtr, g, g, g);
  writeI(iPtr, 0.0, 0.0, 0.0);
}
export function diode_doStep(_t: f64, _dt: f64, vPtr: usize): void {
  diodeCondArr[activeInst] = load<f64>(vPtr + 0) >= 0.0 ? 1 : 0;
}

// 9. Clean-room PI companion (params[4] = Kp, params[5] = Ki)
const piKpArr = new Float64Array(MAX_COMP_INST);
piKpArr.fill(1.0);
const piKiArr = new Float64Array(MAX_COMP_INST);
piKiArr.fill(10.0);
const piIntArr = new Float64Array(MAX_COMP_INST);
export function pi_init(paramsPtr: usize, count: i32): void {
  const id = activeInst;
  piKpArr[id] = 1.0;
  piKiArr[id] = 10.0;
  const kp = count >= 5 ? load<f64>(paramsPtr + 32) : NaN;
  const ki = count >= 6 ? load<f64>(paramsPtr + 40) : NaN;
  if (isFinite(kp)) piKpArr[id] = kp;
  if (isFinite(ki)) piKiArr[id] = ki;
  piIntArr[id] = 0.0;
}
export function pi_stampCompanion(_t: f64, _dt: f64, gPtr: usize, iPtr: usize): void {
  const id = activeInst;
  const kp = piKpArr[id];
  const integ = piIntArr[id];
  writeDiagG(gPtr, kp, kp, kp);
  writeI(iPtr, integ, integ, integ);
}
export function pi_doStep(_t: f64, dt: f64, vPtr: usize): void {
  const id = activeInst;
  const safeDt = dt > 1e-9 ? dt : 50e-6;
  piIntArr[id] += piKiArr[id] * load<f64>(vPtr + 0) * safeDt;
}

// Re-export multi-instance EMTDC linear-memory ABI & all 521 cleanroom subroutines/functions
export * from "./runtime/abi";
export * from "./runtime/subroutines";

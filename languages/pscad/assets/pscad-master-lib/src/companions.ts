// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Clean-room AssemblyScript `fmi-ls-emt` companion implementations for `@modelscript/pscad-master-lib`.
 *
 * Exports `<Component>_stampCompanion(tSec, dtSec, gPtr, iPtr)` and
 * `<Component>_doStep(tSec, dtSec, vPtr)` for 3-phase Norton companion models.
 */

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
let resR: f64 = 100.0;
export function resistor_init(paramsPtr: usize, count: i32): void {
  if (count >= 1) {
    const r = load<f64>(paramsPtr + 0);
    if (isFinite(r) && r > 0.0) resR = r;
  }
}
export function resistor_stampCompanion(_t: f64, _dt: f64, gPtr: usize, iPtr: usize): void {
  const g = 1.0 / resR;
  writeDiagG(gPtr, g, g, g);
  writeI(iPtr, 0.0, 0.0, 0.0);
}
export function resistor_doStep(_t: f64, _dt: f64, _vPtr: usize): void {}

// 2. Three-phase trapezoidal inductor (default L = 0.05 H; params[1] = L or params[0] = L)
let indL: f64 = 0.05;
let indHist0: f64 = 0.0;
let indHist1: f64 = 0.0;
let indHist2: f64 = 0.0;
export function inductor_init(paramsPtr: usize, count: i32): void {
  const l = count >= 2 ? load<f64>(paramsPtr + 8) : count >= 1 ? load<f64>(paramsPtr + 0) : NaN;
  if (isFinite(l) && l > 0.0) indL = l;
  indHist0 = 0.0;
  indHist1 = 0.0;
  indHist2 = 0.0;
}
export function inductor_stampCompanion(_t: f64, dt: f64, gPtr: usize, iPtr: usize): void {
  const safeDt = dt > 1e-9 ? dt : 50e-6;
  const g = safeDt / (2.0 * indL);
  writeDiagG(gPtr, g, g, g);
  writeI(iPtr, indHist0, indHist1, indHist2);
}
export function inductor_doStep(_t: f64, dt: f64, vPtr: usize): void {
  const safeDt = dt > 1e-9 ? dt : 50e-6;
  const g = safeDt / (2.0 * indL);
  const v0 = load<f64>(vPtr + 0);
  const v1 = load<f64>(vPtr + 8);
  const v2 = load<f64>(vPtr + 16);
  indHist0 = -(indHist0 + 2.0 * g * v0);
  indHist1 = -(indHist1 + 2.0 * g * v1);
  indHist2 = -(indHist2 + 2.0 * g * v2);
}

// 3. Three-phase trapezoidal capacitor (default C = 10 uF; params[2] = C or params[0] = C)
let capC: f64 = 10e-6;
let capHist0: f64 = 0.0;
let capHist1: f64 = 0.0;
let capHist2: f64 = 0.0;
export function capacitor_init(paramsPtr: usize, count: i32): void {
  const c = count >= 3 ? load<f64>(paramsPtr + 16) : count >= 1 ? load<f64>(paramsPtr + 0) : NaN;
  if (isFinite(c) && c > 0.0) capC = c;
  capHist0 = 0.0;
  capHist1 = 0.0;
  capHist2 = 0.0;
}
export function capacitor_stampCompanion(_t: f64, dt: f64, gPtr: usize, iPtr: usize): void {
  const safeDt = dt > 1e-9 ? dt : 50e-6;
  const g = (2.0 * capC) / safeDt;
  writeDiagG(gPtr, g, g, g);
  writeI(iPtr, capHist0, capHist1, capHist2);
}
export function capacitor_doStep(_t: f64, dt: f64, vPtr: usize): void {
  const safeDt = dt > 1e-9 ? dt : 50e-6;
  const g = (2.0 * capC) / safeDt;
  const v0 = load<f64>(vPtr + 0);
  const v1 = load<f64>(vPtr + 8);
  const v2 = load<f64>(vPtr + 16);
  capHist0 = -(2.0 * g * v0 + capHist0);
  capHist1 = -(2.0 * g * v1 + capHist1);
  capHist2 = -(2.0 * g * v2 + capHist2);
}

// 4. Three-phase circuit breaker (default closed R = 0.005 Ohm; params[0] = Rcls)
let brkR: f64 = 0.005;
export function breaker3_init(paramsPtr: usize, count: i32): void {
  if (count >= 1) {
    const r = load<f64>(paramsPtr + 0);
    if (isFinite(r) && r > 0.0) brkR = r;
  }
}
export function breaker3_stampCompanion(_t: f64, _dt: f64, gPtr: usize, iPtr: usize): void {
  const g = 1.0 / brkR;
  writeDiagG(gPtr, g, g, g);
  writeI(iPtr, 0.0, 0.0, 0.0);
}
export function breaker3_doStep(_t: f64, _dt: f64, _vPtr: usize): void {}

// 5. Generic grid-following IBR / VSC-PWM Norton companion (default droop + damping)
let ibrPllAngle: f64 = 0.0;
export function fmu_ibr_stampCompanion(_t: f64, _dt: f64, gPtr: usize, iPtr: usize): void {
  const g = 0.02;
  const omega = 2.0 * Math.PI * 60.0;
  const amp = 1.0;
  writeDiagG(gPtr, g, g, g);
  writeI(
    iPtr,
    amp * Math.sin(ibrPllAngle),
    amp * Math.sin(ibrPllAngle - (2.0 * Math.PI) / 3.0),
    amp * Math.sin(ibrPllAngle + (2.0 * Math.PI) / 3.0),
  );
  void omega;
}
export function fmu_ibr_doStep(_t: f64, dt: f64, _vPtr: usize): void {
  const safeDt = dt > 1e-9 ? dt : 50e-6;
  ibrPllAngle += 2.0 * Math.PI * 60.0 * safeDt;
}

export function vsc_pwm_stampCompanion(t: f64, dt: f64, gPtr: usize, iPtr: usize): void {
  fmu_ibr_stampCompanion(t, dt, gPtr, iPtr);
}
export function vsc_pwm_doStep(t: f64, dt: f64, vPtr: usize): void {
  fmu_ibr_doStep(t, dt, vPtr);
}

// 6. Three-phase leakage-inductance transformer companion (params[0] = R, params[1] = L_leak)
let xfmrR: f64 = 0.05;
let xfmrL: f64 = 0.01;
let xfmrHist0: f64 = 0.0;
let xfmrHist1: f64 = 0.0;
let xfmrHist2: f64 = 0.0;
export function transformer_init(paramsPtr: usize, count: i32): void {
  const r = count >= 1 ? load<f64>(paramsPtr + 0) : NaN;
  const l = count >= 2 ? load<f64>(paramsPtr + 8) : NaN;
  if (isFinite(r) && r > 0.0) xfmrR = r;
  if (isFinite(l) && l > 0.0) xfmrL = l;
  xfmrHist0 = 0.0;
  xfmrHist1 = 0.0;
  xfmrHist2 = 0.0;
}
export function transformer_stampCompanion(_t: f64, dt: f64, gPtr: usize, iPtr: usize): void {
  const safeDt = dt > 1e-9 ? dt : 50e-6;
  const g = 1.0 / (xfmrR + (2.0 * xfmrL) / safeDt);
  writeDiagG(gPtr, g, g, g);
  writeI(iPtr, xfmrHist0, xfmrHist1, xfmrHist2);
}
export function transformer_doStep(_t: f64, dt: f64, vPtr: usize): void {
  const safeDt = dt > 1e-9 ? dt : 50e-6;
  const zL = (2.0 * xfmrL) / safeDt;
  const k = (zL - xfmrR) / (zL + xfmrR);
  const g = 1.0 / (zL + xfmrR);
  xfmrHist0 = k * xfmrHist0 + 2.0 * g * load<f64>(vPtr + 0);
  xfmrHist1 = k * xfmrHist1 + 2.0 * g * load<f64>(vPtr + 8);
  xfmrHist2 = k * xfmrHist2 + 2.0 * g * load<f64>(vPtr + 16);
}

// 7. MOV surge arrester companion (params[3] = Vref_kV, clamping conductance when |v| > Vref)
let arrVrefV: f64 = 200e3;
let arrClamped: bool = false;
export function arrester_init(paramsPtr: usize, count: i32): void {
  const vRefKv = count >= 4 ? load<f64>(paramsPtr + 24) : NaN;
  if (isFinite(vRefKv) && vRefKv > 0.0) arrVrefV = vRefKv * 1e3;
  arrClamped = false;
}
export function arrester_stampCompanion(_t: f64, _dt: f64, gPtr: usize, iPtr: usize): void {
  const g = arrClamped ? 1.0 : 1e-9;
  writeDiagG(gPtr, g, g, g);
  writeI(iPtr, 0.0, 0.0, 0.0);
}
export function arrester_doStep(_t: f64, _dt: f64, vPtr: usize): void {
  const v0 = Math.abs(load<f64>(vPtr + 0));
  const v1 = Math.abs(load<f64>(vPtr + 8));
  const v2 = Math.abs(load<f64>(vPtr + 16));
  arrClamped = v0 > arrVrefV || v1 > arrVrefV || v2 > arrVrefV;
}

// 8. Switching diode companion (params[0] = Ron)
let diodeRon: f64 = 0.01;
let diodeConducting: bool = true;
export function diode_init(paramsPtr: usize, count: i32): void {
  const ron = count >= 1 ? load<f64>(paramsPtr + 0) : NaN;
  if (isFinite(ron) && ron > 1e-6) diodeRon = ron;
  diodeConducting = true;
}
export function diode_stampCompanion(_t: f64, _dt: f64, gPtr: usize, iPtr: usize): void {
  const g = diodeConducting ? 1.0 / diodeRon : 1e-6;
  writeDiagG(gPtr, g, g, g);
  writeI(iPtr, 0.0, 0.0, 0.0);
}
export function diode_doStep(_t: f64, _dt: f64, vPtr: usize): void {
  diodeConducting = load<f64>(vPtr + 0) >= 0.0;
}

// 9. Clean-room PI companion (params[4] = Kp, params[5] = Ki)
let piKp: f64 = 1.0;
let piKi: f64 = 10.0;
let piInt: f64 = 0.0;
export function pi_init(paramsPtr: usize, count: i32): void {
  const kp = count >= 5 ? load<f64>(paramsPtr + 32) : NaN;
  const ki = count >= 6 ? load<f64>(paramsPtr + 40) : NaN;
  if (isFinite(kp)) piKp = kp;
  if (isFinite(ki)) piKi = ki;
  piInt = 0.0;
}
export function pi_stampCompanion(_t: f64, _dt: f64, gPtr: usize, iPtr: usize): void {
  writeDiagG(gPtr, piKp, piKp, piKp);
  writeI(iPtr, piInt, piInt, piInt);
}
export function pi_doStep(_t: f64, dt: f64, vPtr: usize): void {
  const safeDt = dt > 1e-9 ? dt : 50e-6;
  piInt += piKi * load<f64>(vPtr + 0) * safeDt;
}

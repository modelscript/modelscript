// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/jsbsim — 6-DOF Aircraft Flight Dynamics Integrator, Trim Solver, and Modal Linearizer.
 *
 * Implements:
 *   1. 1D linear and 2D bilinear aerodynamic lookup table evaluation (<tableData>) and
 *      recursive <product>/<sum>/<difference>/<quotient>/<pow> expression tree evaluation
 *   2. Rigid-body 6 degrees-of-freedom equations of motion coupled with standard atmosphere
 *   3. Steady-level flight Newton-Raphson trim solver (trimFlightCondition)
 *   4. Longitudinal state-space linearization (A_lon, B_lon) and Short-Period / Phugoid
 *      modal eigenvalue extraction (linearizeFlightDynamics).
 */

import type { JsbsimAeroExpr, JsbsimAeroTable, JsbsimDocument, JsbsimModel } from "../types.js";

export interface FlightSolverOptions {
  duration?: number | undefined; // seconds (default: 10.0)
  timeStep?: number | undefined; // dt seconds (default: 0.02 = 50 Hz)
  initialSpeedFps?: number | undefined; // ft/s (default: 180.0)
  initialAltitudeFt?: number | undefined; // ft (default: 5000.0)
  elevatorDeg?: number | undefined; // degrees
  throttle?: number | undefined; // 0.0 - 1.0 (default: 0.7)
}

export interface FlightStepRecord {
  time: number;
  altitudeFt: number;
  speedFps: number;
  mach: number;
  alphaDeg: number;
  betaDeg: number;
  pitchDeg: number;
  rollDeg: number;
  yawDeg: number;
  pRateDegSec: number;
  qRateDegSec: number;
  rRateDegSec: number;
}

export interface FlightSimulationResult {
  aircraftName: string;
  initialAltitude: number;
  finalAltitude: number;
  initialSpeed: number;
  finalSpeed: number;
  stepsCount: number;
  trajectory: FlightStepRecord[];
}

export interface FlightTrimOptions {
  speedFps?: number | undefined;
  altitudeFt?: number | undefined;
  flightPathAngleRad?: number | undefined;
  maxIterations?: number | undefined;
  tolerance?: number | undefined;
}

export interface FlightTrimResult {
  converged: boolean;
  iterations: number;
  alphaRad: number;
  alphaDeg: number;
  thetaRad: number;
  pitchDeg: number;
  elevatorRad: number;
  elevatorDeg: number;
  throttle: number;
  uFps: number;
  wFps: number;
  qbarPsf: number;
  clTrim: number;
  cdTrim: number;
  residualNorm: number;
}

export interface LongitudinalMode {
  name: "short_period" | "phugoid";
  eigenvalueReal: number;
  eigenvalueImag: number;
  naturalFrequencyRadSec: number;
  dampingRatio: number;
  periodSec: number;
}

export interface LongitudinalLinearizationResult {
  trim: FlightTrimResult;
  /** 4x4 longitudinal state matrix over [u, w, q, theta] */
  A: [
    [number, number, number, number],
    [number, number, number, number],
    [number, number, number, number],
    [number, number, number, number],
  ];
  /** 4x2 longitudinal control matrix over [elevatorRad, throttle] */
  B: [[number, number], [number, number], [number, number], [number, number]];
  eigenvalues: { real: number; imag: number }[];
  shortPeriod: LongitudinalMode;
  phugoid: LongitudinalMode;
}

function interpolate1DClamped(xs: number[], ys: number[], x: number): number {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return 0.0;
  if (n === 1 || x <= xs[0]!) return ys[0]!;
  if (x >= xs[n - 1]!) return ys[n - 1]!;

  for (let i = 0; i < n - 1; i++) {
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    if (x >= x0 && x <= x1) {
      const span = x1 - x0;
      const t = Math.abs(span) > 1e-12 ? (x - x0) / span : 0.0;
      return ys[i]! + t * (ys[i + 1]! - ys[i]!);
    }
  }
  return ys[n - 1]!;
}

/**
 * Evaluates a 1D or 2D JSBSim `<tableData>` lookup table using clamped linear / bilinear interpolation.
 */
export function evaluateAeroTable(table: JsbsimAeroTable, props: Record<string, number>): number {
  const rowVar =
    table.independentVars.find((v) => v.lookup === "row")?.property ??
    table.independentVars[0]?.property ??
    "aero/alpha-rad";
  const xRow = props[rowVar] ?? 0.0;

  if (!table.breakpointsCol || table.breakpointsCol.length === 0) {
    const rowVals = table.values[0] ?? [];
    return interpolate1DClamped(table.breakpointsRow, rowVals, xRow);
  }

  // 2D bilinear interpolation
  const colVar =
    table.independentVars.find((v) => v.lookup === "column")?.property ??
    table.independentVars[1]?.property ??
    "fcs/elevator-pos-rad";
  const xCol = props[colVar] ?? 0.0;

  const rLen = table.breakpointsRow.length;
  const cLen = table.breakpointsCol.length;
  if (rLen === 0 || cLen === 0) return 0.0;

  // Interpolate along columns for each row first, or find bounding row indices
  const colInterpolatedAtRow = (rIdx: number): number => {
    const row = table.values[rIdx] ?? [];
    return interpolate1DClamped(table.breakpointsCol!, row, xCol);
  };

  if (rLen === 1 || xRow <= table.breakpointsRow[0]!) {
    return colInterpolatedAtRow(0);
  }
  if (xRow >= table.breakpointsRow[rLen - 1]!) {
    return colInterpolatedAtRow(rLen - 1);
  }

  for (let r = 0; r < rLen - 1; r++) {
    const r0 = table.breakpointsRow[r]!;
    const r1 = table.breakpointsRow[r + 1]!;
    if (xRow >= r0 && xRow <= r1) {
      const span = r1 - r0;
      const t = Math.abs(span) > 1e-12 ? (xRow - r0) / span : 0.0;
      const v0 = colInterpolatedAtRow(r);
      const v1 = colInterpolatedAtRow(r + 1);
      return v0 + t * (v1 - v0);
    }
  }
  return colInterpolatedAtRow(rLen - 1);
}

/**
 * Recursively evaluates a JSBSim aerodynamic expression tree (`<product>`, `<sum>`, `<table>`, `<property>`, `<value>`).
 */
export function evaluateAeroExpr(expr: JsbsimAeroExpr, props: Record<string, number>): number {
  switch (expr.kind) {
    case "value":
      return expr.value;
    case "property":
      return props[expr.property] ?? 0.0;
    case "table":
      return evaluateAeroTable(expr.table, props);
    case "product": {
      if (expr.children.length === 0) return 0.0;
      let prod = 1.0;
      for (const child of expr.children) {
        prod *= evaluateAeroExpr(child, props);
      }
      return prod;
    }
    case "sum": {
      let sum = 0.0;
      for (const child of expr.children) {
        sum += evaluateAeroExpr(child, props);
      }
      return sum;
    }
    case "difference": {
      if (expr.children.length === 0) return 0.0;
      let diff = evaluateAeroExpr(expr.children[0]!, props);
      for (let i = 1; i < expr.children.length; i++) {
        diff -= evaluateAeroExpr(expr.children[i]!, props);
      }
      return diff;
    }
    case "quotient": {
      if (expr.children.length < 2) return 0.0;
      const num = evaluateAeroExpr(expr.children[0]!, props);
      const den = evaluateAeroExpr(expr.children[1]!, props);
      return Math.abs(den) > 1e-12 ? num / den : 0.0;
    }
    case "pow": {
      if (expr.children.length < 2) return 0.0;
      const base = evaluateAeroExpr(expr.children[0]!, props);
      const exp = evaluateAeroExpr(expr.children[1]!, props);
      return Math.pow(base, exp);
    }
  }
}

// 1976 US Standard Atmosphere (Troposphere up to 36,089 ft, isothermal Lower Stratosphere above)
export function getStandardAtmosphere(altFt: number): { rho: number; soundSpeedFps: number } {
  const hClamped = Math.max(0, altFt);
  if (hClamped <= 36089.0) {
    const T0 = 518.67; // Sea-level temperature (Rankine)
    const L = 0.00356616; // Lapse rate (R/ft)
    const T = T0 - L * hClamped;
    const theta = T / T0;
    const rho = 0.0023769 * Math.pow(theta, 4.25588);
    const soundSpeedFps = 49.02 * Math.sqrt(T);
    return { rho, soundSpeedFps };
  }
  // Stratosphere (isothermal T = 389.97 R)
  const T = 389.97;
  const rho36k = 0.00070612;
  const rho = rho36k * Math.exp(-(hClamped - 36089.0) / 20806.0);
  const soundSpeedFps = 49.02 * Math.sqrt(T);
  return { rho, soundSpeedFps };
}

function extractAeroParameters(model: JsbsimModel) {
  let cl0 = 0.35;
  let clAlpha = 4.8;
  let cd0 = 0.027;
  const cdInduced = 0.045;
  let cm0 = 0.05;
  let cmAlpha = -0.75;
  const cmq = -12.0;
  const cmDe = -1.1;

  for (const c of model.aeroCoefficients) {
    const n = c.name.toLowerCase();
    if (c.axis === "LIFT") {
      if (c.table && c.table.breakpointsRow.length >= 2) {
        const valAt0 = evaluateAeroTable(c.table, { "aero/alpha-rad": 0.0, "aero/alpha-deg": 0.0 });
        const valAt01 = evaluateAeroTable(c.table, { "aero/alpha-rad": 0.1, "aero/alpha-deg": 5.729578 });
        const slope = (valAt01 - valAt0) / 0.1;
        if (Math.abs(slope) > 0.1) {
          cl0 = valAt0;
          clAlpha = slope;
        }
      } else if (Math.abs(c.baseValue) > 0) {
        clAlpha = c.baseValue;
      }
    }
    if (c.axis === "DRAG" && Math.abs(c.baseValue) > 0) {
      cd0 = c.baseValue;
    }
    if (c.axis === "PITCH") {
      if (n.includes("0") && c.baseValue !== 0) cm0 = c.baseValue;
      else if (c.baseValue !== 0) cmAlpha = c.baseValue;
    }
  }

  return { cl0, clAlpha, cd0, cdInduced, cm0, cmAlpha, cmq, cmDe };
}

export function solveFlightDynamics(doc: JsbsimDocument, options?: FlightSolverOptions): FlightSimulationResult {
  const model = doc.model;
  const duration = options?.duration ?? 10.0;
  const dt = options?.timeStep ?? 0.02;
  const steps = Math.max(1, Math.round(duration / dt));

  const g = 32.174; // ft/s^2
  const mass = Math.max(10.0, model.massBalance.emptyWeight / g); // slugs
  const ixx = Math.max(10.0, model.massBalance.ixx);
  const iyy = Math.max(10.0, model.massBalance.iyy);
  const izz = Math.max(10.0, model.massBalance.izz);
  const ixz = model.massBalance.ixz ?? 0.0;
  const gammaDet = Math.max(1.0, ixx * izz - ixz * ixz);

  const sRef = model.metrics.wingArea; // ft^2
  const bSpan = model.metrics.wingspan; // ft
  const cChord = model.metrics.chord; // ft

  const maxThrust = model.engines.reduce((acc, e) => acc + (e.maxThrust > 0 ? e.maxThrust : 400.0), 0) || 400.0;
  const throttle = Math.max(0.0, Math.min(1.0, options?.throttle ?? 0.7));
  const elevatorRad = ((options?.elevatorDeg ?? 0.0) * Math.PI) / 180.0;

  const { cl0, clAlpha, cd0, cdInduced, cmAlpha, cmq, cmDe } = extractAeroParameters(model);

  // Lateral-directional aerodynamic baseline derivatives
  let cyBeta = -0.3;
  let clBeta = -0.1;
  let clp = -0.4;
  let cnBeta = 0.08;
  let cnr = -0.1;

  for (const c of model.aeroCoefficients) {
    const nameLower = c.name.toLowerCase();
    if (c.axis === "SIDE" && (nameLower.includes("beta") || Math.abs(c.baseValue) > 0)) {
      cyBeta = c.baseValue !== 0 ? c.baseValue : cyBeta;
    } else if (c.axis === "ROLL") {
      if (nameLower.includes("beta")) clBeta = c.baseValue !== 0 ? c.baseValue : clBeta;
      else if (nameLower.includes("p")) clp = c.baseValue !== 0 ? c.baseValue : clp;
    } else if (c.axis === "YAW") {
      if (nameLower.includes("beta")) cnBeta = c.baseValue !== 0 ? c.baseValue : cnBeta;
      else if (nameLower.includes("r")) cnr = c.baseValue !== 0 ? c.baseValue : cnr;
    }
  }

  // Initial State Vector: [u, v, w, p, q, r, phi, theta, psi, h]
  let h = options?.initialAltitudeFt ?? 5000.0;
  let u = options?.initialSpeedFps ?? 180.0; // ft/s
  let v = 0.0;

  // Calculate cruise trim state using 1976 US Standard Atmosphere
  const { rho: rho0 } = getStandardAtmosphere(h);
  const qbar0 = 0.5 * rho0 * u * u;
  const clTrim = (mass * g) / Math.max(1.0, qbar0 * sRef);
  const alphaTrim = (clTrim - cl0) / clAlpha;

  let w = u * Math.tan(alphaTrim);
  let p = 0.0;
  let q = 0.0;
  let r = 0.0;
  let phi = 0.0;
  let theta = alphaTrim;
  let psi = 0.0;

  const initAlt = h;
  const initSpeed = Math.sqrt(u * u + v * v + w * w);

  // Pre-allocated scratch buffers to eliminate garbage collection inside RK4 loop
  const k1 = new Float64Array(10);
  const k2 = new Float64Array(10);
  const k3 = new Float64Array(10);
  const k4 = new Float64Array(10);

  function evalDerivatives(
    su: number,
    sv: number,
    sw: number,
    sp: number,
    sq: number,
    sr: number,
    sPhi: number,
    sTheta: number,
    _sPsi: number,
    sh: number,
    out: Float64Array,
  ): void {
    const vt = Math.max(1.0, Math.sqrt(su * su + sv * sv + sw * sw));
    const { rho } = getStandardAtmosphere(sh);
    const qbar = 0.5 * rho * vt * vt; // dynamic pressure

    const alpha = Math.atan2(sw, Math.max(1.0, su)); // rad
    const beta = Math.asin(Math.max(-1.0, Math.min(1.0, sv / vt))); // rad

    // Aerodynamic Coefficients
    const cl = cl0 + clAlpha * alpha;
    const cd = cd0 + cdInduced * cl * cl;
    const cy = cyBeta * beta;

    const lift = qbar * sRef * cl;
    const drag = qbar * sRef * cd;
    const side = qbar * sRef * cy;

    const thrust = maxThrust * throttle;

    // Forces in Body Frame
    const cosA = Math.cos(alpha);
    const sinA = Math.sin(alpha);
    const cosTh = Math.cos(sTheta);
    const sinTh = Math.sin(sTheta);
    const cosPh = Math.cos(sPhi);
    const sinPh = Math.sin(sPhi);

    const fx = thrust - drag * cosA + lift * sinA - mass * g * sinTh;
    const fy = side + mass * g * sinPh * cosTh;
    const fz = -lift * cosA - drag * sinA + mass * g * cosPh * cosTh;

    // Moments in Body Frame (referenced to cruise trim elevator balance + elevator deflection)
    const cm = cmAlpha * (alpha - alphaTrim) + cmq * ((sq * cChord) / (2.0 * vt)) + cmDe * elevatorRad;
    const mx = qbar * sRef * bSpan * (clBeta * beta + clp * ((sp * bSpan) / (2.0 * vt)));
    const my = qbar * sRef * cChord * cm;
    const mz = qbar * sRef * bSpan * (cnBeta * beta + cnr * ((sr * bSpan) / (2.0 * vt)));

    // Equations of Motion (with Euler gyroscopic cross-coupling and coupled Ixz product of inertia)
    out[0] = fx / mass - sq * sw + sr * sv;
    out[1] = fy / mass - sr * su + sp * sw;
    out[2] = fz / mass - sp * sv + sq * su;

    const lRhs = mx + (iyy - izz) * sq * sr + ixz * sp * sq;
    const nRhs = mz + (ixx - iyy) * sp * sq - ixz * sq * sr;
    out[3] = (izz * lRhs + ixz * nRhs) / gammaDet;
    out[4] = (my + (izz - ixx) * sp * sr - ixz * (sp * sp - sr * sr)) / iyy;
    out[5] = (ixz * lRhs + ixx * nRhs) / gammaDet;

    const tanTh = Math.tan(sTheta);
    out[6] = sp + (sq * sinPh + sr * cosPh) * tanTh;
    out[7] = sq * cosPh - sr * sinPh;
    out[8] = (sq * sinPh + sr * cosPh) / Math.max(0.01, cosTh);

    out[9] = su * sinTh - sv * sinPh * cosTh - sw * cosPh * cosTh;
  }

  const trajectory: FlightStepRecord[] = [];
  let t = 0.0;

  const toDeg = 180.0 / Math.PI;

  for (let step = 0; step < steps; step++) {
    // Record sample
    if (steps <= 100 || step % Math.ceil(steps / 100) === 0 || step === steps - 1) {
      const vt = Math.sqrt(u * u + v * v + w * w);
      const alpha = Math.atan2(w, Math.max(1.0, u));
      const beta = Math.asin(Math.max(-1.0, Math.min(1.0, v / vt)));
      const { soundSpeedFps } = getStandardAtmosphere(h);
      trajectory.push({
        time: t,
        altitudeFt: h,
        speedFps: vt,
        mach: vt / Math.max(1.0, soundSpeedFps),
        alphaDeg: alpha * toDeg,
        betaDeg: beta * toDeg,
        pitchDeg: theta * toDeg,
        rollDeg: phi * toDeg,
        yawDeg: psi * toDeg,
        pRateDegSec: p * toDeg,
        qRateDegSec: q * toDeg,
        rRateDegSec: r * toDeg,
      });
    }

    // Zero-allocation RK4 Integration
    evalDerivatives(u, v, w, p, q, r, phi, theta, psi, h, k1);

    const halfDt = 0.5 * dt;
    evalDerivatives(
      u + halfDt * k1[0]!,
      v + halfDt * k1[1]!,
      w + halfDt * k1[2]!,
      p + halfDt * k1[3]!,
      q + halfDt * k1[4]!,
      r + halfDt * k1[5]!,
      phi + halfDt * k1[6]!,
      theta + halfDt * k1[7]!,
      psi + halfDt * k1[8]!,
      h + halfDt * k1[9]!,
      k2,
    );

    evalDerivatives(
      u + halfDt * k2[0]!,
      v + halfDt * k2[1]!,
      w + halfDt * k2[2]!,
      p + halfDt * k2[3]!,
      q + halfDt * k2[4]!,
      r + halfDt * k2[5]!,
      phi + halfDt * k2[6]!,
      theta + halfDt * k2[7]!,
      psi + halfDt * k2[8]!,
      h + halfDt * k2[9]!,
      k3,
    );

    evalDerivatives(
      u + dt * k3[0]!,
      v + dt * k3[1]!,
      w + dt * k3[2]!,
      p + dt * k3[3]!,
      q + dt * k3[4]!,
      r + dt * k3[5]!,
      phi + dt * k3[6]!,
      theta + dt * k3[7]!,
      psi + dt * k3[8]!,
      h + dt * k3[9]!,
      k4,
    );

    const dtSixth = dt / 6.0;
    u += dtSixth * (k1[0]! + 2 * k2[0]! + 2 * k3[0]! + k4[0]!);
    v += dtSixth * (k1[1]! + 2 * k2[1]! + 2 * k3[1]! + k4[1]!);
    w += dtSixth * (k1[2]! + 2 * k2[2]! + 2 * k3[2]! + k4[2]!);
    p += dtSixth * (k1[3]! + 2 * k2[3]! + 2 * k3[3]! + k4[3]!);
    q += dtSixth * (k1[4]! + 2 * k2[4]! + 2 * k3[4]! + k4[4]!);
    r += dtSixth * (k1[5]! + 2 * k2[5]! + 2 * k3[5]! + k4[5]!);
    phi += dtSixth * (k1[6]! + 2 * k2[6]! + 2 * k3[6]! + k4[6]!);
    theta += dtSixth * (k1[7]! + 2 * k2[7]! + 2 * k3[7]! + k4[7]!);
    psi += dtSixth * (k1[8]! + 2 * k2[8]! + 2 * k3[8]! + k4[8]!);
    h += dtSixth * (k1[9]! + 2 * k2[9]! + 2 * k3[9]! + k4[9]!);

    t += dt;
  }

  const finalSpeed = Math.sqrt(u * u + v * v + w * w);

  return {
    aircraftName: model.name,
    initialAltitude: initAlt,
    finalAltitude: h,
    initialSpeed: initSpeed,
    finalSpeed,
    stepsCount: steps,
    trajectory,
  };
}

/**
 * Solves a 4x4 linear system J * dx = -r using Gaussian elimination with partial pivoting.
 */
function solveLinear4x4(J: number[][], r: number[]): [number, number, number, number] {
  const A = J.map((row, idx) => [...row, -(r[idx] ?? 0)]);
  for (let col = 0; col < 4; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(A[col]![col]!);
    for (let row = col + 1; row < 4; row++) {
      const val = Math.abs(A[row]![col]!);
      if (val > maxVal) {
        maxVal = val;
        pivotRow = row;
      }
    }
    if (pivotRow !== col) {
      const tmp = A[col]!;
      A[col] = A[pivotRow]!;
      A[pivotRow] = tmp;
    }
    const diag = A[col]![col]!;
    if (Math.abs(diag) < 1e-14) continue;
    for (let row = col + 1; row < 4; row++) {
      const factor = A[row]![col]! / diag;
      for (let k = col; k <= 4; k++) {
        A[row]![k] = A[row]![k]! - factor * A[col]![k]!;
      }
    }
  }

  const x: [number, number, number, number] = [0, 0, 0, 0];
  for (let row = 3; row >= 0; row--) {
    let sum = A[row]![4]!;
    for (let col = row + 1; col < 4; col++) {
      sum -= A[row]![col]! * x[col]!;
    }
    const diag = A[row]![row]!;
    x[row] = Math.abs(diag) > 1e-14 ? sum / diag : 0.0;
  }
  return x;
}

/**
 * Computes the steady wings-level flight trim condition (dot(u) = dot(w) = dot(q) = 0, climb angle = gamma)
 * via damped Newton-Raphson iteration over [alpha, theta, elevatorRad, throttle].
 */
export function trimFlightCondition(
  docOrModel: JsbsimDocument | JsbsimModel,
  options?: FlightTrimOptions,
): FlightTrimResult {
  const model = "model" in docOrModel ? docOrModel.model : docOrModel;
  const vt = Math.max(20.0, options?.speedFps ?? 180.0);
  const altFt = options?.altitudeFt ?? 5000.0;
  const gamma = options?.flightPathAngleRad ?? 0.0;
  const maxIter = options?.maxIterations ?? 40;
  const tol = options?.tolerance ?? 1e-9;

  const g = 32.174;
  const mass = Math.max(10.0, model.massBalance.emptyWeight / g);
  const iyy = Math.max(10.0, model.massBalance.iyy);
  const sRef = Math.max(1.0, model.metrics.wingArea);
  const cChord = Math.max(0.5, model.metrics.chord);
  const maxThrust = model.engines.reduce((acc, e) => acc + (e.maxThrust > 0 ? e.maxThrust : 400.0), 0) || 400.0;

  const { cl0, clAlpha, cd0, cdInduced, cm0, cmAlpha, cmDe } = extractAeroParameters(model);
  const { rho } = getStandardAtmosphere(altFt);
  const qbar = 0.5 * rho * vt * vt;

  // Initial guess from analytical linear approximation
  let alpha = Math.max(-0.25, Math.min(0.25, ((mass * g * Math.cos(gamma)) / (qbar * sRef) - cl0) / clAlpha));
  let theta = alpha + gamma;
  let elevator = -(cm0 + cmAlpha * alpha) / cmDe;
  const clInit = cl0 + clAlpha * alpha;
  const cdInit = cd0 + cdInduced * clInit * clInit;
  let throttle = Math.max(0.0, Math.min(1.0, (qbar * sRef * cdInit + mass * g * Math.sin(gamma)) / maxThrust));

  const evalResidual = (a: number, th: number, de: number, thr: number): [number, number, number, number] => {
    const u = vt * Math.cos(a);
    const w = vt * Math.sin(a);
    const cl = cl0 + clAlpha * a + 0.35 * de;
    const cd = cd0 + cdInduced * cl * cl;
    const cm = cm0 + cmAlpha * a + cmDe * de;

    const lift = qbar * sRef * cl;
    const drag = qbar * sRef * cd;
    const thrust = maxThrust * thr;

    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    const fx = thrust - drag * cosA + lift * sinA - mass * g * Math.sin(th);
    const fz = -lift * cosA - drag * sinA + mass * g * Math.cos(th);
    const my = qbar * sRef * cChord * cm;

    const uDot = fx / mass;
    const wDot = fz / mass;
    const qDot = my / iyy;
    const gammaResidual = (u * Math.sin(th) - w * Math.cos(th)) / vt - Math.sin(gamma);
    return [uDot, wDot, qDot, gammaResidual];
  };

  let iter = 0;
  let res = evalResidual(alpha, theta, elevator, throttle);
  let resNorm = Math.hypot(res[0], res[1], res[2], res[3]);

  const eps = 1e-7;
  while (iter < maxIter && resNorm > tol) {
    const state = [alpha, theta, elevator, throttle] as [number, number, number, number];
    const J: number[][] = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    for (let col = 0; col < 4; col++) {
      const pPlus = [...state] as [number, number, number, number];
      const pMinus = [...state] as [number, number, number, number];
      pPlus[col as 0 | 1 | 2 | 3] += eps;
      pMinus[col as 0 | 1 | 2 | 3] -= eps;
      const rPlus = evalResidual(pPlus[0], pPlus[1], pPlus[2], pPlus[3]);
      const rMinus = evalResidual(pMinus[0], pMinus[1], pMinus[2], pMinus[3]);
      for (let row = 0; row < 4; row++) {
        J[row]![col] = (rPlus[row]! - rMinus[row]!) / (2.0 * eps);
      }
    }

    const dx = solveLinear4x4(J, res);
    alpha += dx[0];
    theta += dx[1];
    elevator += dx[2];
    throttle = Math.max(0.0, Math.min(2.0, throttle + dx[3]));

    res = evalResidual(alpha, theta, elevator, throttle);
    resNorm = Math.hypot(res[0], res[1], res[2], res[3]);
    iter++;
  }

  const toDeg = 180.0 / Math.PI;
  const clFinal = cl0 + clAlpha * alpha + 0.35 * elevator;
  const cdFinal = cd0 + cdInduced * clFinal * clFinal;

  return {
    converged: resNorm <= 1e-4,
    iterations: iter,
    alphaRad: alpha,
    alphaDeg: alpha * toDeg,
    thetaRad: theta,
    pitchDeg: theta * toDeg,
    elevatorRad: elevator,
    elevatorDeg: elevator * toDeg,
    throttle,
    uFps: vt * Math.cos(alpha),
    wFps: vt * Math.sin(alpha),
    qbarPsf: qbar,
    clTrim: clFinal,
    cdTrim: cdFinal,
    residualNorm: resNorm,
  };
}

/**
 * Computes all 4 eigenvalues of a 4x4 real matrix via its characteristic polynomial
 * lambda^4 + c3*lambda^3 + c2*lambda^2 + c1*lambda + c0 = 0 and Durand-Kerner complex root polishing.
 */
function computeEigenvalues4x4(A: number[][]): { real: number; imag: number }[] {
  const mulMat = (M: number[][], N: number[][]): number[][] => {
    const out = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += M[i]![k]! * N[k]![j]!;
        out[i]![j] = s;
      }
    }
    return out;
  };
  const trace = (M: number[][]): number => M[0]![0]! + M[1]![1]! + M[2]![2]! + M[3]![3]!;

  // Faddeev-LeVerrier algorithm for characteristic polynomial coefficients
  const t1 = trace(A);
  const c3 = -t1;

  const A2 = mulMat(A, A);
  const t2 = trace(A2);
  const c2 = -0.5 * (t2 + c3 * t1);

  const A3 = mulMat(A2, A);
  const t3 = trace(A3);
  const c1 = -(t3 + c3 * t2 + c2 * t1) / 3.0;

  const A4 = mulMat(A3, A);
  const t4 = trace(A4);
  const c0 = -(t4 + c3 * t3 + c2 * t2 + c1 * t1) / 4.0;

  // Evaluate P(z) = z^4 + c3*z^3 + c2*z^2 + c1*z + c0 in complex arithmetic
  const evalPoly = (zr: number, zi: number): [number, number] => {
    let rr = 1.0;
    let ri = 0.0;
    const coeffs = [c3, c2, c1, c0];
    for (const c of coeffs) {
      const nr = rr * zr - ri * zi + c;
      const ni = rr * zi + ri * zr;
      rr = nr;
      ri = ni;
    }
    return [rr, ri];
  };

  // Initial distinct complex seeds on circle of radius 1 + max(|c_i|)^0.25
  const R = 1.0 + Math.pow(Math.max(Math.abs(c3), Math.abs(c2), Math.abs(c1), Math.abs(c0)), 0.25);
  const roots: { real: number; imag: number }[] = [
    { real: R * 0.8, imag: R * 0.6 },
    { real: -R * 0.7, imag: R * 0.7 },
    { real: -R * 0.6, imag: -R * 0.8 },
    { real: R * 0.5, imag: -R * 0.5 },
  ];

  // Durand-Kerner simultaneous iteration
  for (let iter = 0; iter < 120; iter++) {
    let maxStep = 0.0;
    for (let i = 0; i < 4; i++) {
      const zi = roots[i]!;
      const [pr, pi] = evalPoly(zi.real, zi.imag);
      let dr = 1.0;
      let di = 0.0;
      for (let j = 0; j < 4; j++) {
        if (i === j) continue;
        const zj = roots[j]!;
        const diffR = zi.real - zj.real;
        const diffI = zi.imag - zj.imag;
        const nr = dr * diffR - di * diffI;
        const ni = dr * diffI + di * diffR;
        dr = nr;
        di = ni;
      }
      const denom = dr * dr + di * di;
      if (denom > 1e-24) {
        const stepR = (pr * dr + pi * di) / denom;
        const stepI = (pi * dr - pr * di) / denom;
        zi.real -= stepR;
        zi.imag -= stepI;
        maxStep = Math.max(maxStep, Math.hypot(stepR, stepI));
      }
    }
    if (maxStep < 1e-13) break;
  }

  return roots;
}

/**
 * Linearizes the longitudinal flight dynamics [u, w, q, theta] around the steady trim condition
 * and extracts the Short-Period and Phugoid dynamic stability modes.
 */
export function linearizeFlightDynamics(
  docOrModel: JsbsimDocument | JsbsimModel,
  options?: FlightTrimOptions,
): LongitudinalLinearizationResult {
  const model = "model" in docOrModel ? docOrModel.model : docOrModel;
  const trim = trimFlightCondition(model, options);
  const altFt = options?.altitudeFt ?? 5000.0;

  const g = 32.174;
  const mass = Math.max(10.0, model.massBalance.emptyWeight / g);
  const iyy = Math.max(10.0, model.massBalance.iyy);
  const sRef = Math.max(1.0, model.metrics.wingArea);
  const cChord = Math.max(0.5, model.metrics.chord);
  const maxThrust = model.engines.reduce((acc, e) => acc + (e.maxThrust > 0 ? e.maxThrust : 400.0), 0) || 400.0;

  const { cl0, clAlpha, cd0, cdInduced, cm0, cmAlpha, cmq, cmDe } = extractAeroParameters(model);
  const { rho } = getStandardAtmosphere(altFt);

  const evalLongitudinalDot = (
    u: number,
    w: number,
    q: number,
    theta: number,
    de: number,
    thr: number,
  ): [number, number, number, number] => {
    const vt = Math.max(1.0, Math.hypot(u, w));
    const qbar = 0.5 * rho * vt * vt;
    const alpha = Math.atan2(w, Math.max(1.0, u));

    const cl = cl0 + clAlpha * alpha + 0.35 * de + 3.0 * ((q * cChord) / (2.0 * vt));
    const cd = cd0 + cdInduced * cl * cl;
    const cm = cm0 + cmAlpha * alpha + cmq * ((q * cChord) / (2.0 * vt)) + cmDe * de;

    const lift = qbar * sRef * cl;
    const drag = qbar * sRef * cd;
    const thrust = maxThrust * thr;

    const cosA = Math.cos(alpha);
    const sinA = Math.sin(alpha);
    const fx = thrust - drag * cosA + lift * sinA - mass * g * Math.sin(theta);
    const fz = -lift * cosA - drag * sinA + mass * g * Math.cos(theta);
    const my = qbar * sRef * cChord * cm;

    const uDot = fx / mass - q * w;
    const wDot = fz / mass + q * u;
    const qDot = my / iyy;
    const thetaDot = q;
    return [uDot, wDot, qDot, thetaDot];
  };

  const x0: [number, number, number, number] = [trim.uFps, trim.wFps, 0.0, trim.thetaRad];
  const u0: [number, number] = [trim.elevatorRad, trim.throttle];

  const A: [
    [number, number, number, number],
    [number, number, number, number],
    [number, number, number, number],
    [number, number, number, number],
  ] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  const B: [[number, number], [number, number], [number, number], [number, number]] = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];

  const epsX = 1e-5;
  for (let col = 0; col < 4; col++) {
    const xPlus = [...x0] as [number, number, number, number];
    const xMinus = [...x0] as [number, number, number, number];
    xPlus[col as 0 | 1 | 2 | 3] += epsX;
    xMinus[col as 0 | 1 | 2 | 3] -= epsX;
    const fPlus = evalLongitudinalDot(xPlus[0], xPlus[1], xPlus[2], xPlus[3], u0[0], u0[1]);
    const fMinus = evalLongitudinalDot(xMinus[0], xMinus[1], xMinus[2], xMinus[3], u0[0], u0[1]);
    for (let row = 0; row < 4; row++) {
      A[row]![col] = (fPlus[row]! - fMinus[row]!) / (2.0 * epsX);
    }
  }

  for (let col = 0; col < 2; col++) {
    const uPlus = [...u0] as [number, number];
    const uMinus = [...u0] as [number, number];
    uPlus[col as 0 | 1] += epsX;
    uMinus[col as 0 | 1] -= epsX;
    const fPlus = evalLongitudinalDot(x0[0], x0[1], x0[2], x0[3], uPlus[0], uPlus[1]);
    const fMinus = evalLongitudinalDot(x0[0], x0[1], x0[2], x0[3], uMinus[0], uMinus[1]);
    for (let row = 0; row < 4; row++) {
      B[row]![col] = (fPlus[row]! - fMinus[row]!) / (2.0 * epsX);
    }
  }

  const eigenvalues = computeEigenvalues4x4(A);

  // Sort eigenvalues by natural frequency |lambda| descending:
  // Highest |lambda| pair is Short-Period, lowest |lambda| pair is Phugoid
  const sorted = [...eigenvalues].sort(
    (a, b) => Math.hypot(b.real, b.imag) - Math.hypot(a.real, a.imag) || b.imag - a.imag,
  );

  const buildMode = (name: "short_period" | "phugoid", eig: { real: number; imag: number }): LongitudinalMode => {
    const wn = Math.max(1e-6, Math.hypot(eig.real, eig.imag));
    const zeta = Math.max(-1.0, Math.min(1.0, -eig.real / wn));
    const wd = Math.abs(eig.imag);
    const periodSec = wd > 1e-6 ? (2.0 * Math.PI) / wd : Number.POSITIVE_INFINITY;
    return {
      name,
      eigenvalueReal: eig.real,
      eigenvalueImag: Math.abs(eig.imag),
      naturalFrequencyRadSec: wn,
      dampingRatio: zeta,
      periodSec,
    };
  };

  const shortPeriod = buildMode("short_period", sorted[0]!);
  const phugoid = buildMode("phugoid", sorted[sorted.length - 1]!);

  return {
    trim,
    A,
    B,
    eigenvalues,
    shortPeriod,
    phugoid,
  };
}

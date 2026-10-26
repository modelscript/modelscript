// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/jsbsim — 6-DOF Aircraft Flight Dynamics Integrator.
 *
 * Implements rigid-body 6 degrees-of-freedom equations of motion coupled with
 * aerodynamic coefficients, propulsion, standard atmosphere, and Euler angles.
 */

import type { JsbsimDocument } from "../types.js";

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

  const sRef = model.metrics.wingArea; // ft^2
  const bSpan = model.metrics.wingspan; // ft
  const cChord = model.metrics.chord; // ft

  const maxThrust = model.engines.reduce((acc, e) => acc + (e.maxThrust > 0 ? e.maxThrust : 400.0), 0);
  const throttle = Math.max(0.0, Math.min(1.0, options?.throttle ?? 0.7));

  // Aerodynamic baseline coefficients
  let cl0 = 0.35;
  let clAlpha = 4.8;
  let cd0 = 0.027;
  let cdInduced = 0.045;
  let cmAlpha = -0.75;
  let cmq = -12.0;

  for (const c of model.aeroCoefficients) {
    if (c.axis === "LIFT") clAlpha = Math.abs(c.baseValue) > 0 ? c.baseValue : clAlpha;
    if (c.axis === "DRAG") cd0 = Math.abs(c.baseValue) > 0 ? c.baseValue : cd0;
    if (c.axis === "PITCH") cmAlpha = c.baseValue !== 0 ? c.baseValue : cmAlpha;
  }

  // 1976 US Standard Atmosphere (Troposphere up to 36,089 ft, isothermal Lower Stratosphere above)
  function getAtmosphere(altFt: number): { rho: number; soundSpeedFps: number } {
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
  const { rho: rho0 } = getAtmosphere(h);
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
    const { rho } = getAtmosphere(sh);
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

    // Moments in Body Frame (referenced to cruise trim elevator balance)
    const cm = cmAlpha * (alpha - alphaTrim) + cmq * ((sq * cChord) / (2.0 * vt));
    const mx = qbar * sRef * bSpan * (clBeta * beta + clp * ((sp * bSpan) / (2.0 * vt)));
    const my = qbar * sRef * cChord * cm;
    const mz = qbar * sRef * bSpan * (cnBeta * beta + cnr * ((sr * bSpan) / (2.0 * vt)));

    // Equations of Motion
    out[0] = fx / mass - sq * sw + sr * sv;
    out[1] = fy / mass - sr * su + sp * sw;
    out[2] = fz / mass - sp * sv + sq * su;

    out[3] = mx / ixx;
    out[4] = my / iyy;
    out[5] = mz / izz;

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
      const { soundSpeedFps } = getAtmosphere(h);
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

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cummins Equation 6-DOF Time-Domain Dynamics with Rational State-Space Radiation Realization.
 *
 * Implements the classic Cummins (1962) integro-differential formulation:
 *   (M + A_inf) * x''(t) + integral_0^t K(t - tau) * x'(tau) dtau + C * x(t) = F_ext(t)
 *
 * The convolution retardation kernel K(t) is replaced by an O(p) rational state-space realization:
 *   z'(t) = A_r * z(t) + B_r * x'(t)
 *   mu(t) = C_r * z(t) + D_r * x'(t)
 *
 * This turns the memory-dependent integro-differential equation into standard continuous 1st-order ODEs.
 */

import type { SimaModel, Vessel } from "../types.js";

export interface StateSpaceRealization {
  dof: number; // 1: Surge, 2: Sway, 3: Heave, 4: Roll, 5: Pitch, 6: Yaw
  order: number; // p (e.g. 2 or 4)
  A: number[][]; // p x p
  B: number[]; // p x 1
  C: number[]; // 1 x p
  D: number; // scalar direct feedthrough
}

/**
 * Synthesizes a stable p-th order rational approximation for radiation retardation kernel K(t).
 * Default coefficients are matched to typical offshore semi-submersibles and ship hulls.
 */
export function createRationalRealization(dof: number, order: 2 | 4 = 2): StateSpaceRealization {
  // Peak resonant radiation frequencies per DOF (rad/s)
  const omega0 = [0.4, 0.4, 0.35, 0.25, 0.3, 0.3][dof - 1] ?? 0.35;
  const dampingRatio = [0.15, 0.15, 0.2, 0.1, 0.15, 0.15][dof - 1] ?? 0.15;
  const gain = [1.2e5, 1.2e5, 2.5e5, 1.5e7, 1.5e7, 2.0e7][dof - 1] ?? 1e5;

  if (order === 2) {
    // 2nd-order companion form:
    // s^2 + 2*zeta*omega0*s + omega0^2
    const a0 = Math.pow(omega0, 2);
    const a1 = 2 * dampingRatio * omega0;

    return {
      dof,
      order: 2,
      A: [
        [0, 1],
        [-a0, -a1],
      ],
      B: [0, 1],
      C: [gain * a0, 0],
      D: 0,
    };
  }

  // 4th-order realization (two cascaded complex conjugate pole pairs)
  const w1 = omega0 * 0.7;
  const w2 = omega0 * 1.3;
  const a0 = Math.pow(w1 * w2, 2);
  const a1 = 2 * dampingRatio * (w1 + w2) * w1 * w2;
  const a2 = Math.pow(w1, 2) + Math.pow(w2, 2) + 4 * Math.pow(dampingRatio, 2) * w1 * w2;
  const a3 = 2 * dampingRatio * (w1 + w2);

  return {
    dof,
    order: 4,
    A: [
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
      [-a0, -a1, -a2, -a3],
    ],
    B: [0, 0, 0, 1],
    C: [gain * a0, gain * a1 * 0.2, 0, 0],
    D: 0,
  };
}

export interface CumminsSimulationConfig {
  durationSeconds: number;
  timeStepSeconds: number;
  waveHs?: number;
  waveTp?: number;
  waveHeadingDeg?: number;
  currentSpeed?: number;
  windSpeed?: number;
}

export interface CumminsTimeStepResult {
  time: number;
  position: [number, number, number, number, number, number]; // [x, y, z, roll, pitch, yaw]
  velocity: [number, number, number, number, number, number];
  radiationForce: [number, number, number, number, number, number];
  restoringForce: [number, number, number, number, number, number];
  excitationForce: [number, number, number, number, number, number];
}

export interface CumminsSimulationResult {
  vesselName: string;
  time: number[];
  positions: number[][]; // 6 x N
  velocities: number[][]; // 6 x N
  maxExcursion: { surge: number; sway: number; heave: number; rollDeg: number; pitchDeg: number; yawDeg: number };
  rmsMotion: { surge: number; sway: number; heave: number; rollDeg: number; pitchDeg: number; yawDeg: number };
}

/**
 * Rapid numerical time-domain simulation of 6-DOF floater Cummins dynamics using 4th-order Runge-Kutta.
 */
export function simulateCumminsDynamics(
  vessel: Vessel,
  model: SimaModel,
  config?: Partial<CumminsSimulationConfig>,
): CumminsSimulationResult {
  const dt = config?.timeStepSeconds ?? model.simulation.timeStep ?? 0.1;
  const duration = config?.durationSeconds ?? Math.min(60.0, model.simulation.duration ?? 60.0);
  const totalSteps = Math.floor(duration / dt);

  const hs = config?.waveHs ?? model.environment.wave.hs;
  const tp = config?.waveTp ?? model.environment.wave.tp;
  const omegaWave = (2 * Math.PI) / Math.max(1.0, tp);

  const r0 = vessel.radiiOfGyration[0] ?? 30;
  const r1 = vessel.radiiOfGyration[1] ?? 30;
  const r2 = vessel.radiiOfGyration[2] ?? 35;

  // Structural mass & added mass at infinity
  const mass: number[][] =
    vessel.massMatrix && vessel.massMatrix.length === 6
      ? vessel.massMatrix
      : [
          [vessel.mass, 0, 0, 0, 0, 0],
          [0, vessel.mass, 0, 0, 0, 0],
          [0, 0, vessel.mass, 0, 0, 0],
          [0, 0, 0, vessel.mass * Math.pow(r0, 2), 0, 0],
          [0, 0, 0, 0, vessel.mass * Math.pow(r1, 2), 0],
          [0, 0, 0, 0, 0, vessel.mass * Math.pow(r2, 2)],
        ];

  const m33 = mass[3]?.[3] ?? vessel.mass * Math.pow(r0, 2);
  const m44 = mass[4]?.[4] ?? vessel.mass * Math.pow(r1, 2);
  const m55 = mass[5]?.[5] ?? vessel.mass * Math.pow(r2, 2);

  const addedMassInf: number[][] =
    vessel.hydrodynamics?.addedMassInfinity && vessel.hydrodynamics.addedMassInfinity.length === 6
      ? vessel.hydrodynamics.addedMassInfinity
      : [
          [0.1 * vessel.mass, 0, 0, 0, 0, 0],
          [0, 0.1 * vessel.mass, 0, 0, 0, 0],
          [0, 0, 0.8 * vessel.mass, 0, 0, 0],
          [0, 0, 0, 0.1 * m33, 0, 0],
          [0, 0, 0, 0, 0.8 * m44, 0],
          [0, 0, 0, 0, 0, 0.1 * m55],
        ];

  // Total inertia per DOF (diagonal approximation for rapid integration)
  const totalInertia: number[] = [0, 1, 2, 3, 4, 5].map((i) => {
    const mi = mass[i]?.[i] ?? vessel.mass;
    const ai = addedMassInf[i]?.[i] ?? 0.1 * vessel.mass;
    return mi + ai;
  });

  // Hydrostatic restoring stiffness matrix C
  const C: number[][] =
    vessel.hydrostaticMatrix && vessel.hydrostaticMatrix.length === 6
      ? vessel.hydrostaticMatrix
      : [
          [0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0],
          [0, 0, model.environment.waterDensity * 9.81 * (vessel.displacement / 20.0), 0, 0, 0],
          [0, 0, 0, vessel.mass * 9.81 * Math.max(0.5, vessel.gmTransverse), 0, 0],
          [0, 0, 0, 0, vessel.mass * 9.81 * Math.max(0.5, vessel.gmLongitudinal), 0],
          [0, 0, 0, 0, 0, 0],
        ];

  // Mooring spread restoring stiffness estimate (Surge, Sway, Yaw)
  let kMooringH = 0;
  for (const line of model.lines) {
    const avgEa = line.segments.reduce((acc, s) => acc + s.axialStiffnessEA, 0) / Math.max(1, line.segments.length);
    kMooringH += (avgEa / Math.max(10, line.totalLength)) * 0.05;
  }
  kMooringH = Math.max(30000, kMooringH);

  // Synthesize 2nd-order state-space realization per DOF
  const realizations: StateSpaceRealization[] = [1, 2, 3, 4, 5, 6].map((dof) => createRationalRealization(dof, 2));

  // State vectors:
  // x: 6 positions, v: 6 velocities
  // z: 6 x 2 radiation auxiliary states
  const x = [0, 0, 0, 0, 0, 0];
  const v = [0, 0, 0, 0, 0, 0];
  const z: number[][] = realizations.map((r) => new Array(r.order).fill(0));

  const timeHist: number[] = [];
  const posHist: number[][] = [[], [], [], [], [], []];
  const velHist: number[][] = [[], [], [], [], [], []];

  // First-order wave force amplitudes per DOF (F0 ~ rho * g * V * k * RAO)
  const f0Wave = [
    0.5 * model.environment.waterDensity * 9.81 * hs * 15.0, // Surge (N)
    0.2 * model.environment.waterDensity * 9.81 * hs * 15.0, // Sway (N)
    0.8 * model.environment.waterDensity * 9.81 * hs * (vessel.displacement / 20.0), // Heave (N)
    0.1 * vessel.mass * 9.81 * hs * 0.5, // Roll (N*m)
    0.5 * vessel.mass * 9.81 * hs * 1.0, // Pitch (N*m)
    0.05 * vessel.mass * 9.81 * hs * 0.5, // Yaw (N*m)
  ];

  // Helper derivative function
  const computeDerivatives = (
    curX: number[],
    curV: number[],
    curZ: number[][],
    time: number,
  ): { dx: number[]; dv: number[]; dz: number[][] } => {
    const dx = [...curV];
    const dv = [0, 0, 0, 0, 0, 0];
    const dz: number[][] = [];

    for (let i = 0; i < 6; i++) {
      const r = realizations[i] ?? createRationalRealization(i + 1, 2);
      const cRow = C[i] ?? [0, 0, 0, 0, 0, 0];
      const c_ii = cRow[i] ?? 0;
      const inertia_i = totalInertia[i] ?? vessel.mass;
      const cZ = curZ[i] ?? [0, 0];
      const z0 = cZ[0] ?? 0;
      const z1 = cZ[1] ?? 0;
      const curX_i = curX[i] ?? 0;
      const curV_i = curV[i] ?? 0;

      // Radiation damping force mu_i = C_r * z_i
      const c0 = r.C[0] ?? 0;
      const c1 = r.C[1] ?? 0;
      const mu_i = c0 * z0 + c1 * z1;

      // Hydrostatic restoring force C_ii * x_i
      let restoring_i = c_ii * curX_i;
      if (i === 0 || i === 1) {
        restoring_i += kMooringH * curX_i;
      }

      // Linear + quadratic viscous damping
      const bLin = vessel.linearDamping?.[i]?.[i] ?? 0.05 * inertia_i;
      const bQuad = vessel.quadraticDamping?.[i]?.[i] ?? 0.01 * inertia_i;
      const fViscous = bLin * curV_i + bQuad * curV_i * Math.abs(curV_i);

      // Wave excitation force
      const f0 = f0Wave[i] ?? 1e5;
      const fExc = f0 * Math.cos(omegaWave * time);

      // Acceleration
      dv[i] = (fExc - mu_i - restoring_i - fViscous) / Math.max(1.0, inertia_i);

      // Radiation state derivatives: dz/dt = A * z + B * v
      const a00 = r.A[0]?.[0] ?? 0;
      const a01 = r.A[0]?.[1] ?? 1;
      const a10 = r.A[1]?.[0] ?? 0;
      const a11 = r.A[1]?.[1] ?? 0;
      const b0 = r.B[0] ?? 0;
      const b1 = r.B[1] ?? 1;

      dz.push([a00 * z0 + a01 * z1 + b0 * curV_i, a10 * z0 + a11 * z1 + b1 * curV_i]);
    }

    return { dx, dv, dz };
  };

  // RK4 time stepping
  for (let step = 0; step < totalSteps; step++) {
    const t = step * dt;
    timeHist.push(t);
    for (let i = 0; i < 6; i++) {
      posHist[i]?.push(x[i] ?? 0);
      velHist[i]?.push(v[i] ?? 0);
    }

    const k1 = computeDerivatives(x, v, z, t);

    const x_k2 = x.map((xi, i) => xi + 0.5 * dt * (k1.dx[i] ?? 0));
    const v_k2 = v.map((vi, i) => vi + 0.5 * dt * (k1.dv[i] ?? 0));
    const z_k2 = z.map((zi, i) => {
      const z0 = zi[0] ?? 0;
      const z1 = zi[1] ?? 0;
      const dz = k1.dz[i] ?? [0, 0];
      return [z0 + 0.5 * dt * (dz[0] ?? 0), z1 + 0.5 * dt * (dz[1] ?? 0)];
    });
    const k2 = computeDerivatives(x_k2, v_k2, z_k2, t + 0.5 * dt);

    const x_k3 = x.map((xi, i) => xi + 0.5 * dt * (k2.dx[i] ?? 0));
    const v_k3 = v.map((vi, i) => vi + 0.5 * dt * (k2.dv[i] ?? 0));
    const z_k3 = z.map((zi, i) => {
      const z0 = zi[0] ?? 0;
      const z1 = zi[1] ?? 0;
      const dz = k2.dz[i] ?? [0, 0];
      return [z0 + 0.5 * dt * (dz[0] ?? 0), z1 + 0.5 * dt * (dz[1] ?? 0)];
    });
    const k3 = computeDerivatives(x_k3, v_k3, z_k3, t + 0.5 * dt);

    const x_k4 = x.map((xi, i) => xi + dt * (k3.dx[i] ?? 0));
    const v_k4 = v.map((vi, i) => vi + dt * (k3.dv[i] ?? 0));
    const z_k4 = z.map((zi, i) => {
      const z0 = zi[0] ?? 0;
      const z1 = zi[1] ?? 0;
      const dz = k3.dz[i] ?? [0, 0];
      return [z0 + dt * (dz[0] ?? 0), z1 + dt * (dz[1] ?? 0)];
    });
    const k4 = computeDerivatives(x_k4, v_k4, z_k4, t + dt);

    // Update state
    for (let i = 0; i < 6; i++) {
      const curX = x[i] ?? 0;
      const curV = v[i] ?? 0;
      const curZ = z[i] ?? [0, 0];
      const z0 = curZ[0] ?? 0;
      const z1 = curZ[1] ?? 0;

      const k1_dx = k1.dx[i] ?? 0;
      const k2_dx = k2.dx[i] ?? 0;
      const k3_dx = k3.dx[i] ?? 0;
      const k4_dx = k4.dx[i] ?? 0;

      const k1_dv = k1.dv[i] ?? 0;
      const k2_dv = k2.dv[i] ?? 0;
      const k3_dv = k3.dv[i] ?? 0;
      const k4_dv = k4.dv[i] ?? 0;

      const k1_dz = k1.dz[i] ?? [0, 0];
      const k2_dz = k2.dz[i] ?? [0, 0];
      const k3_dz = k3.dz[i] ?? [0, 0];
      const k4_dz = k4.dz[i] ?? [0, 0];

      x[i] = curX + (dt / 6) * (k1_dx + 2 * k2_dx + 2 * k3_dx + k4_dx);
      v[i] = curV + (dt / 6) * (k1_dv + 2 * k2_dv + 2 * k3_dv + k4_dv);
      z[i] = [
        z0 + (dt / 6) * ((k1_dz[0] ?? 0) + 2 * (k2_dz[0] ?? 0) + 2 * (k3_dz[0] ?? 0) + (k4_dz[0] ?? 0)),
        z1 + (dt / 6) * ((k1_dz[1] ?? 0) + 2 * (k2_dz[1] ?? 0) + 2 * (k3_dz[1] ?? 0) + (k4_dz[1] ?? 0)),
      ];
    }
  }

  // Compute statistics
  const rad2deg = 180 / Math.PI;
  const calcMax = (arr: number[]) => arr.reduce((max, val) => Math.max(max, Math.abs(val)), 0);
  const calcRms = (arr: number[]) =>
    Math.sqrt(arr.reduce((sum, val) => sum + Math.pow(val, 2), 0) / Math.max(1, arr.length));

  const p0 = posHist[0] ?? [];
  const p1 = posHist[1] ?? [];
  const p2 = posHist[2] ?? [];
  const p3 = posHist[3] ?? [];
  const p4 = posHist[4] ?? [];
  const p5 = posHist[5] ?? [];

  return {
    vesselName: vessel.name,
    time: timeHist,
    positions: posHist,
    velocities: velHist,
    maxExcursion: {
      surge: calcMax(p0),
      sway: calcMax(p1),
      heave: calcMax(p2),
      rollDeg: calcMax(p3) * rad2deg,
      pitchDeg: calcMax(p4) * rad2deg,
      yawDeg: calcMax(p5) * rad2deg,
    },
    rmsMotion: {
      surge: calcRms(p0),
      sway: calcRms(p1),
      heave: calcRms(p2),
      rollDeg: calcRms(p3) * rad2deg,
      pitchDeg: calcRms(p4) * rad2deg,
      yawDeg: calcRms(p5) * rad2deg,
    },
  };
}

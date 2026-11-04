// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opensim — Hill-Type Muscle Activation & Multibody Coordinate RK4 Solver.
 *
 * Integrates:
 * 1. Neural excitation-contraction activation dynamics:
 *      da/dt = (u - a) / tau(a, u)
 *      tau(a, u) = u > a ? tau_act * (0.5 + 1.5 * a) : tau_deact / (0.5 + 1.5 * a)
 * 2. Active & passive force-length curves (Thelen 2003 / Millard 2012 Gaussian & exponential):
 *      f_L(l_tilde) = exp(-(l_tilde - 1)^2 / gamma)
 * 3. Fiber contraction velocity & tendon force balance.
 * 4. Generalized coordinate multibody dynamics:
 *      q_ddot = (tau_muscle - b * q_dot + tau_gravity) / I_eff
 */

import type { OpenSimBody, OpenSimCoordinate, OpenSimDocument, OpenSimJoint, OpenSimMuscle } from "../types.js";

export interface OpenSimSimulationOptions {
  duration?: number | undefined;
  dt?: number | undefined;
  excitations?: Record<string, number> | undefined;
  initialActivations?: Record<string, number> | undefined;
  damping?: number | undefined;
}

export interface OpenSimCoordinateTrajectory {
  q: number[];
  u: number[];
  qdd: number[];
}

export interface OpenSimMuscleTrajectory {
  activation: number[];
  fiberLength: number[];
  tendonForce: number[];
  activeForce: number[];
  passiveForce: number[];
}

export interface OpenSimSimulationResult {
  time: number[];
  steps: number;
  coordinates: Record<string, OpenSimCoordinateTrajectory>;
  muscles: Record<string, OpenSimMuscleTrajectory>;
  finalState: {
    coordinates: Record<string, { q: number; u: number }>;
    muscles: Record<string, { activation: number; fiberLength: number; tendonForce: number }>;
  };
}

/**
 * Computes the Hill-type activation time constant tau(a, u) and derivative da/dt.
 */
export function computeActivationDerivative(
  activation: number,
  excitation: number,
  tauAct: number,
  tauDeact: number,
): number {
  const a = Math.max(0.01, Math.min(1.0, activation));
  const u = Math.max(0.01, Math.min(1.0, excitation));
  const safeTauAct = tauAct > 0 ? tauAct : 0.01;
  const safeTauDeact = tauDeact > 0 ? tauDeact : 0.04;
  const tau = u > a ? safeTauAct * (0.5 + 1.5 * a) : safeTauDeact / (0.5 + 1.5 * a);
  return (u - a) / tau;
}

/**
 * Computes active force-length multiplier f_L(l_tilde) = exp(-(l_tilde - 1)^2 / gamma).
 */
export function computeActiveForceLength(normFiberLength: number, gamma = 0.45): number {
  const diff = normFiberLength - 1.0;
  return Math.exp(-(diff * diff) / Math.max(1e-6, gamma));
}

/**
 * Computes passive force-length multiplier f_PE(l_tilde) (Thelen 2003 formulation).
 */
export function computePassiveForceLength(normFiberLength: number, kpe = 4.0, eps0 = 0.6): number {
  if (normFiberLength <= 1.0) return 0.0;
  const strain = Math.min(normFiberLength - 1.0, eps0 * 2.0);
  return (Math.exp((kpe * strain) / eps0) - 1.0) / (Math.exp(kpe) - 1.0);
}

/**
 * Computes Hill force-velocity multiplier f_V(v_tilde) for normalized fiber velocity v_tilde in [-1, 1].
 */
export function computeForceVelocity(normFiberVelocity: number): number {
  const v = Math.max(-1.0, Math.min(1.0, normFiberVelocity));
  const af = 0.3;
  const fmaxE = 1.4;
  if (v <= 0) {
    // Concentric contraction
    return (1.0 + v) / (1.0 - v / af);
  }
  // Eccentric lengthening
  const b = (2.0 + 2.0 / af) * v;
  return (1.0 + fmaxE * b) / (1.0 + b);
}

function canonicalFrame(raw: string): string {
  const t = raw.trim();
  if (t === "ground" || t === "/ground") return "ground";
  return t.replace(/^\/?bodyset\//i, "").replace(/^\//, "");
}

function estimateBasePathLength(m: OpenSimMuscle): number {
  if (m.pathPoints.length >= 2) {
    let dist = 0;
    for (let i = 1; i < m.pathPoints.length; i++) {
      const p0 = m.pathPoints[i - 1]!.location;
      const p1 = m.pathPoints[i]!.location;
      const dx = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      const dz = p1[2] - p0[2];
      dist += Math.hypot(dx, dy, dz);
    }
    const nominalLength =
      Math.max(1e-4, m.optimalFiberLength) * Math.cos(m.pennationAngleAtOptimal) + Math.max(0, m.tendonSlackLength);
    if (dist > 1e-4) {
      return Math.max(dist, nominalLength * 0.85);
    }
  }
  return Math.max(1e-4, m.optimalFiberLength) * Math.cos(m.pennationAngleAtOptimal) + Math.max(0, m.tendonSlackLength);
}

function estimateMomentArm(m: OpenSimMuscle, joint: OpenSimJoint): number {
  const parentBody = canonicalFrame(joint.parentFrame);
  const childBody = canonicalFrame(joint.childFrame);
  const frames = m.pathPoints.map((p) => canonicalFrame(p.bodyFrame));
  const touchesChild = frames.includes(childBody);
  const touchesParent = frames.includes(parentBody);

  if (!touchesChild && !touchesParent) {
    return 0;
  }

  for (const pp of m.pathPoints) {
    if (canonicalFrame(pp.bodyFrame) === childBody) {
      const r = Math.hypot(pp.location[0], pp.location[1], pp.location[2]);
      if (r > 1e-3 && r < 0.25) {
        return r;
      }
    }
  }
  return 0.04;
}

export function simulateMuscleDynamics(
  doc: OpenSimDocument,
  options?: OpenSimSimulationOptions,
): OpenSimSimulationResult {
  const duration = Math.max(1e-4, options?.duration ?? 0.5);
  const dt = Math.max(1e-5, options?.dt ?? 0.01);
  const damping = options?.damping ?? 0.5;
  const steps = Math.max(1, Math.round(duration / dt));

  const bodyMap = new Map<string, OpenSimBody>();
  for (const b of doc.bodies) {
    bodyMap.set(b.name, b);
    bodyMap.set(b.id, b);
  }

  interface CoordMeta {
    coord: OpenSimCoordinate;
    joint: OpenSimJoint;
    childBody: OpenSimBody | undefined;
    effInertia: number;
    comDistance: number;
  }

  const coordMetas: CoordMeta[] = [];
  for (const j of doc.joints) {
    const childBody = bodyMap.get(canonicalFrame(j.childFrame));
    const mass = childBody && childBody.mass > 0 ? childBody.mass : 1.0;
    const comDist = childBody
      ? Math.hypot(childBody.massCenter[0], childBody.massCenter[1], childBody.massCenter[2])
      : 0.1;
    const iZ = childBody && childBody.inertia[2] > 0 ? childBody.inertia[2] : 0.05;

    for (const c of j.coordinates) {
      const effInertia =
        c.motionType === "translational" ? Math.max(1e-4, mass) : Math.max(1e-4, iZ + mass * comDist * comDist);
      coordMetas.push({
        coord: c,
        joint: j,
        childBody,
        effInertia,
        comDistance: comDist > 1e-4 ? comDist : 0.1,
      });
    }
  }

  const numCoords = coordMetas.length;
  const numMuscles = doc.muscles.length;

  const baseMtl = doc.muscles.map((m) => estimateBasePathLength(m));
  const momentArms: number[][] = doc.muscles.map((m) => coordMetas.map((cm) => estimateMomentArm(m, cm.joint)));

  // State vectors:
  // q[i], u[i] for coordinates; a[m], lM[m] for muscles
  const q = coordMetas.map((cm) => cm.coord.defaultValue);
  const u = coordMetas.map(() => 0.0);
  const a = doc.muscles.map((m) => {
    const initA = options?.initialActivations?.[m.name] ?? 0.05;
    return Math.max(0.01, Math.min(1.0, initA));
  });
  const lM = doc.muscles.map((m) => Math.max(1e-4, m.optimalFiberLength));

  const timeSeries: number[] = [];
  const coordTraj: Record<string, OpenSimCoordinateTrajectory> = {};
  for (const cm of coordMetas) {
    coordTraj[cm.coord.name] = { q: [], u: [], qdd: [] };
  }

  const muscleTraj: Record<string, OpenSimMuscleTrajectory> = {};
  for (const m of doc.muscles) {
    muscleTraj[m.name] = {
      activation: [],
      fiberLength: [],
      tendonForce: [],
      activeForce: [],
      passiveForce: [],
    };
  }

  const gMag = Math.hypot(doc.gravity[0], doc.gravity[1], doc.gravity[2]);

  const evaluateDerivatives = (qState: number[], uState: number[], aState: number[], lMState: number[]) => {
    const dq = new Array<number>(numCoords).fill(0);
    const du = new Array<number>(numCoords).fill(0);
    const da = new Array<number>(numMuscles).fill(0);
    const dlM = new Array<number>(numMuscles).fill(0);
    const tendonForces = new Array<number>(numMuscles).fill(0);
    const activeForces = new Array<number>(numMuscles).fill(0);
    const passiveForces = new Array<number>(numMuscles).fill(0);

    for (let mIdx = 0; mIdx < numMuscles; mIdx++) {
      const m = doc.muscles[mIdx]!;
      const act = Math.max(0.01, Math.min(1.0, aState[mIdx]!));
      const exc = Math.max(0.01, Math.min(1.0, options?.excitations?.[m.name] ?? options?.excitations?.[m.id] ?? 0.5));
      da[mIdx] = computeActivationDerivative(act, exc, m.activationTimeConstant, m.deactivationTimeConstant);

      const lOpt = Math.max(1e-4, m.optimalFiberLength);
      const lSlack = Math.max(1e-4, m.tendonSlackLength);
      const fMax = Math.max(0, m.maxIsometricForce);
      const vMax = Math.max(0.1, m.maxContractionVelocity) * lOpt;
      const cosAlpha = Math.max(0.1, Math.cos(m.pennationAngleAtOptimal));

      // Muscle-tendon length l^MT(q)
      let lMT = baseMtl[mIdx]!;
      for (let cIdx = 0; cIdx < numCoords; cIdx++) {
        const r = momentArms[mIdx]?.[cIdx] ?? 0;
        const q0 = coordMetas[cIdx]!.coord.defaultValue;
        lMT -= r * (qState[cIdx]! - q0);
      }

      const currLM = Math.max(0.2 * lOpt, lMState[mIdx]!);
      const normLM = currLM / lOpt;
      const fL = computeActiveForceLength(normLM);
      const fPE = computePassiveForceLength(normLM);

      const lT = Math.max(0, lMT - currLM * cosAlpha);
      const tendonStrain = (lT - lSlack) / lSlack;
      const normTendonForce =
        tendonStrain > 0 ? Math.min(3.0, 35.0 * tendonStrain * tendonStrain + 0.2 * tendonStrain) : 0.0;

      // Quasi-static Hill force-velocity inversion for dlM/dt
      const targetFM = normTendonForce / cosAlpha;
      const activeCapacity = Math.max(1e-3, act * fL);
      const reqFV = Math.max(0.0, Math.min(1.35, (targetFM - fPE) / activeCapacity));

      // Map required fV around 1.0 to normalized fiber velocity
      const normV = Math.max(-1.0, Math.min(1.0, (reqFV - 1.0) * 0.5));
      dlM[mIdx] = normV * vMax;

      const fV = computeForceVelocity(normV);
      const activeF = fMax * act * fL * fV;
      const passiveF = fMax * fPE;
      const fiberForceAlongTendon = (activeF + passiveF) * cosAlpha;
      const fTendon = Math.max(0, 0.5 * (fMax * normTendonForce + fiberForceAlongTendon));

      activeForces[mIdx] = activeF;
      passiveForces[mIdx] = passiveF;
      tendonForces[mIdx] = fTendon;
    }

    for (let cIdx = 0; cIdx < numCoords; cIdx++) {
      const cm = coordMetas[cIdx]!;
      if (cm.coord.locked) {
        dq[cIdx] = 0;
        du[cIdx] = 0;
        continue;
      }

      dq[cIdx] = uState[cIdx]!;
      let tauMuscle = 0;
      for (let mIdx = 0; mIdx < numMuscles; mIdx++) {
        const r = momentArms[mIdx]?.[cIdx] ?? 0;
        tauMuscle += r * tendonForces[mIdx]!;
      }

      const mass = cm.childBody && cm.childBody.mass > 0 ? cm.childBody.mass : 1.0;
      const tauGravity =
        cm.coord.motionType === "translational"
          ? mass * doc.gravity[1]
          : -mass * gMag * cm.comDistance * Math.sin(qState[cIdx]!);

      du[cIdx] = (tauMuscle - damping * uState[cIdx]! + tauGravity) / cm.effInertia;
    }

    return { dq, du, da, dlM, tendonForces, activeForces, passiveForces };
  };

  for (let step = 0; step <= steps; step++) {
    const t = Number((step * dt).toFixed(6));
    timeSeries.push(t);

    const k1 = evaluateDerivatives(q, u, a, lM);

    // Record step state
    for (let cIdx = 0; cIdx < numCoords; cIdx++) {
      const cm = coordMetas[cIdx]!;
      const traj = coordTraj[cm.coord.name]!;
      traj.q.push(q[cIdx]!);
      traj.u.push(u[cIdx]!);
      traj.qdd.push(k1.du[cIdx]!);
    }

    for (let mIdx = 0; mIdx < numMuscles; mIdx++) {
      const m = doc.muscles[mIdx]!;
      const traj = muscleTraj[m.name]!;
      traj.activation.push(a[mIdx]!);
      traj.fiberLength.push(lM[mIdx]!);
      traj.tendonForce.push(k1.tendonForces[mIdx]!);
      traj.activeForce.push(k1.activeForces[mIdx]!);
      traj.passiveForce.push(k1.passiveForces[mIdx]!);
    }

    if (step === steps) break;

    // RK4 Stage 2
    const q2 = q.map((v, i) => v + 0.5 * dt * k1.dq[i]!);
    const u2 = u.map((v, i) => v + 0.5 * dt * k1.du[i]!);
    const a2 = a.map((v, i) => Math.max(0.01, Math.min(1.0, v + 0.5 * dt * k1.da[i]!)));
    const lM2 = lM.map((v, i) => Math.max(1e-4, v + 0.5 * dt * k1.dlM[i]!));
    const k2 = evaluateDerivatives(q2, u2, a2, lM2);

    // RK4 Stage 3
    const q3 = q.map((v, i) => v + 0.5 * dt * k2.dq[i]!);
    const u3 = u.map((v, i) => v + 0.5 * dt * k2.du[i]!);
    const a3 = a.map((v, i) => Math.max(0.01, Math.min(1.0, v + 0.5 * dt * k2.da[i]!)));
    const lM3 = lM.map((v, i) => Math.max(1e-4, v + 0.5 * dt * k2.dlM[i]!));
    const k3 = evaluateDerivatives(q3, u3, a3, lM3);

    // RK4 Stage 4
    const q4 = q.map((v, i) => v + dt * k3.dq[i]!);
    const u4 = u.map((v, i) => v + dt * k3.du[i]!);
    const a4 = a.map((v, i) => Math.max(0.01, Math.min(1.0, v + dt * k3.da[i]!)));
    const lM4 = lM.map((v, i) => Math.max(1e-4, v + dt * k3.dlM[i]!));
    const k4 = evaluateDerivatives(q4, u4, a4, lM4);

    // Advance state
    for (let i = 0; i < numCoords; i++) {
      const cm = coordMetas[i]!;
      if (cm.coord.locked) continue;
      q[i] = q[i]! + (dt / 6.0) * (k1.dq[i]! + 2 * k2.dq[i]! + 2 * k3.dq[i]! + k4.dq[i]!);
      u[i] = u[i]! + (dt / 6.0) * (k1.du[i]! + 2 * k2.du[i]! + 2 * k3.du[i]! + k4.du[i]!);

      if (cm.coord.clamped) {
        if (q[i]! < cm.coord.rangeMin) {
          q[i] = cm.coord.rangeMin;
          if (u[i]! < 0) u[i] = 0;
        } else if (q[i]! > cm.coord.rangeMax) {
          q[i] = cm.coord.rangeMax;
          if (u[i]! > 0) u[i] = 0;
        }
      }
    }

    for (let mIdx = 0; mIdx < numMuscles; mIdx++) {
      const lOpt = Math.max(1e-4, doc.muscles[mIdx]!.optimalFiberLength);
      a[mIdx] = Math.max(
        0.01,
        Math.min(1.0, a[mIdx]! + (dt / 6.0) * (k1.da[mIdx]! + 2 * k2.da[mIdx]! + 2 * k3.da[mIdx]! + k4.da[mIdx]!)),
      );
      lM[mIdx] = Math.max(
        0.2 * lOpt,
        Math.min(
          2.0 * lOpt,
          lM[mIdx]! + (dt / 6.0) * (k1.dlM[mIdx]! + 2 * k2.dlM[mIdx]! + 2 * k3.dlM[mIdx]! + k4.dlM[mIdx]!),
        ),
      );
    }
  }

  const finalCoords: Record<string, { q: number; u: number }> = {};
  for (let i = 0; i < numCoords; i++) {
    const name = coordMetas[i]!.coord.name;
    finalCoords[name] = { q: q[i]!, u: u[i]! };
  }

  const finalMuscles: Record<string, { activation: number; fiberLength: number; tendonForce: number }> = {};
  for (let mIdx = 0; mIdx < numMuscles; mIdx++) {
    const name = doc.muscles[mIdx]!.name;
    const tSeries = muscleTraj[name]!.tendonForce;
    finalMuscles[name] = {
      activation: a[mIdx]!,
      fiberLength: lM[mIdx]!,
      tendonForce: tSeries[tSeries.length - 1] ?? 0,
    };
  }

  return {
    time: timeSeries,
    steps,
    coordinates: coordTraj,
    muscles: muscleTraj,
    finalState: {
      coordinates: finalCoords,
      muscles: finalMuscles,
    },
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LsDynaCurve, LsDynaDeck, LsDynaElement, LsDynaMaterial, LsDynaNode } from "../types.js";

export interface CflElementInfo {
  eid: number;
  characteristicLength: number;
  waveSpeed: number;
  dtCritical: number;
}

export interface CflAnalysis {
  minDtCritical: number;
  controllingElementId: number;
  maxWaveSpeed: number;
  tssfac: number;
  stableDt: number;
  elements: CflElementInfo[];
}

export interface ExplicitSolverOptions {
  /** Override termination time (defaults to *CONTROL_TERMINATION.endtim or 0.01 s) */
  endTime?: number | undefined;
  /** Override timestep (defaults to tssfac * dtCritical) */
  dt?: number | undefined;
  /** Timestep safety factor (defaults to *CONTROL_TIMESTEP.tssfac or 0.9) */
  tssfac?: number | undefined;
  /** Output sampling stride in steps (default: 1) */
  outputStride?: number | undefined;
  /** Maximum steps safety guard (default: 200000) */
  maxSteps?: number | undefined;
  /** Optional initial nodal displacements map: nid -> [ux, uy, uz] */
  initialDisplacements?: Map<number, [number, number, number]> | undefined;
}

export interface ExplicitTimeSample {
  time: number;
  kineticEnergy: number;
  internalEnergy: number;
  totalEnergy: number;
  displacements: Map<number, [number, number, number]>;
  velocities: Map<number, [number, number, number]>;
}

export interface ExplicitSolverResult {
  cfl: CflAnalysis;
  dtUsed: number;
  steps: number;
  endTime: number;
  samples: ExplicitTimeSample[];
  finalDisplacements: Map<number, [number, number, number]>;
  finalVelocities: Map<number, [number, number, number]>;
  maxEnergyDriftRatio: number;
}

/**
 * Computes longitudinal bar wave speed c = sqrt(E / rho).
 */
export function barWaveSpeed(e: number, rho: number): number {
  if (e <= 0 || rho <= 0) return 0;
  return Math.sqrt(e / rho);
}

/**
 * Computes 3D dilatational wave speed c_d = sqrt(E*(1-nu) / (rho*(1+nu)*(1-2*nu))).
 */
export function solidWaveSpeed(e: number, rho: number, nu: number): number {
  if (e <= 0 || rho <= 0 || nu <= -1 || nu >= 0.5) return 0;
  const denom = rho * (1 + nu) * (1 - 2 * nu);
  return denom > 0 ? Math.sqrt((e * (1 - nu)) / denom) : 0;
}

function nodeDistance(a: LsDynaNode, b: LsDynaNode): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function resolveElementMaterial(deck: LsDynaDeck, el: LsDynaElement): LsDynaMaterial | undefined {
  const part = deck.parts.get(el.pid);
  if (!part) return undefined;
  return deck.materials.get(part.mid);
}

function computeCharacteristicLength(deck: LsDynaDeck, el: LsDynaElement): number {
  const pts: LsDynaNode[] = [];
  for (const nid of el.nodes) {
    const n = deck.nodes.get(nid);
    if (n) pts.push(n);
  }
  if (pts.length < 2) return 0;
  if (el.kind === "BEAM" || pts.length === 2) {
    return nodeDistance(pts[0]!, pts[1]!);
  }
  // For SHELL / SOLID, minimum distinct edge length among element nodes
  let minEdge = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = nodeDistance(pts[i]!, pts[j]!);
      if (d > 1e-15 && d < minEdge) {
        minEdge = d;
      }
    }
  }
  return Number.isFinite(minEdge) ? minEdge : 0;
}

/**
 * Performs CFL critical timestep analysis across all elements in an LS-DYNA deck.
 */
export function computeCflAnalysis(deck: LsDynaDeck, tssfacOverride?: number): CflAnalysis {
  const tssfac = tssfacOverride ?? deck.controlTimestep?.tssfac ?? 0.9;
  const elements: CflElementInfo[] = [];
  let minDtCritical = Number.POSITIVE_INFINITY;
  let controllingElementId = -1;
  let maxWaveSpeed = 0;

  for (const el of deck.elements.values()) {
    const mat = resolveElementMaterial(deck, el);
    if (!mat || mat.e <= 0 || mat.ro <= 0) continue;
    const len = computeCharacteristicLength(deck, el);
    if (len <= 0) continue;

    const c =
      el.kind === "SOLID" && mat.pr > -1 && mat.pr < 0.5
        ? solidWaveSpeed(mat.e, mat.ro, mat.pr)
        : barWaveSpeed(mat.e, mat.ro);
    if (c <= 0) continue;

    const dtCrit = len / c;
    elements.push({
      eid: el.eid,
      characteristicLength: len,
      waveSpeed: c,
      dtCritical: dtCrit,
    });

    if (c > maxWaveSpeed) maxWaveSpeed = c;
    if (dtCrit < minDtCritical) {
      minDtCritical = dtCrit;
      controllingElementId = el.eid;
    }
  }

  if (!Number.isFinite(minDtCritical)) {
    minDtCritical = 0;
  }

  return {
    minDtCritical,
    controllingElementId,
    maxWaveSpeed,
    tssfac,
    stableDt: minDtCritical * tssfac,
    elements,
  };
}

/**
 * Evaluates a `*DEFINE_CURVE` at abscissa `t` using piecewise-linear interpolation.
 */
export function evaluateLsDynaCurve(curve: LsDynaCurve, t: number): number {
  const pts = curve.points;
  if (pts.length === 0) return 0;
  const scaleA = curve.sfa || 1.0;
  const scaleO = curve.sfo || 1.0;
  const offA = curve.offa || 0.0;
  const offO = curve.offo || 0.0;

  const firstT = pts[0]!.abscissa * scaleA + offA;
  const firstV = pts[0]!.ordinate * scaleO + offO;
  if (t <= firstT || pts.length === 1) return firstV;

  for (let i = 0; i < pts.length - 1; i++) {
    const t0 = pts[i]!.abscissa * scaleA + offA;
    const t1 = pts[i + 1]!.abscissa * scaleA + offA;
    const v0 = pts[i]!.ordinate * scaleO + offO;
    const v1 = pts[i + 1]!.ordinate * scaleO + offO;
    if (t >= t0 && t <= t1) {
      if (Math.abs(t1 - t0) < 1e-18) return v1;
      const alpha = (t - t0) / (t1 - t0);
      return v0 + alpha * (v1 - v0);
    }
  }

  const last = pts[pts.length - 1]!;
  return last.ordinate * scaleO + offO;
}

interface BarLink {
  iIdx: number;
  jIdx: number;
  nx: number;
  ny: number;
  nz: number;
  stiffness: number;
  yieldForce: number; // 0 = purely elastic
}

/**
 * Solves an LS-DYNA explicit dynamics deck using the central-difference (velocity-Verlet)
 * time integration scheme with lumped nodal mass matrix.
 */
export function solveLsDynaExplicit(deck: LsDynaDeck, options: ExplicitSolverOptions = {}): ExplicitSolverResult {
  const cfl = computeCflAnalysis(deck, options.tssfac);
  const endTime = options.endTime ?? deck.controlTermination?.endtim ?? 0.01;
  const dtUsed =
    options.dt ??
    (deck.controlTimestep && deck.controlTimestep.dtinit > 0
      ? Math.min(deck.controlTimestep.dtinit, cfl.stableDt > 0 ? cfl.stableDt : deck.controlTimestep.dtinit)
      : cfl.stableDt > 0
        ? cfl.stableDt
        : Math.max(1e-6, endTime / 100));

  const maxSteps = options.maxSteps ?? 200000;
  const outputStride = Math.max(1, options.outputStride ?? 1);

  // Build dense node index
  const nodeIds = Array.from(deck.nodes.keys()).sort((a, b) => a - b);
  const nNodes = nodeIds.length;
  const nidToIdx = new Map<number, number>();
  for (let i = 0; i < nNodes; i++) {
    nidToIdx.set(nodeIds[i]!, i);
  }

  // Lumped nodal mass (scalar per node, applied to all 3 translational DOFs)
  const mass = new Float64Array(nNodes);
  const links: BarLink[] = [];

  for (const el of deck.elements.values()) {
    const part = deck.parts.get(el.pid);
    const mat = part ? deck.materials.get(part.mid) : undefined;
    const sec = part ? deck.sections.get(part.secid) : undefined;
    if (!mat || mat.e <= 0 || mat.ro <= 0) continue;

    if (el.kind === "BEAM" || el.nodes.length === 2) {
      const iIdx = nidToIdx.get(el.nodes[0]!);
      const jIdx = nidToIdx.get(el.nodes[1]!);
      if (iIdx === undefined || jIdx === undefined) continue;
      const ni = deck.nodes.get(el.nodes[0]!)!;
      const nj = deck.nodes.get(el.nodes[1]!)!;
      const dx = nj.x - ni.x;
      const dy = nj.y - ni.y;
      const dz = nj.z - ni.z;
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L <= 1e-15) continue;

      const area = sec?.area && sec.area > 0 ? sec.area : 1.0;
      const elMass = mat.ro * area * L;
      mass[iIdx]! += 0.5 * elMass;
      mass[jIdx]! += 0.5 * elMass;

      const k = (mat.e * area) / L;
      const yieldForce =
        (mat.type === "MAT_PLASTIC_KINEMATIC" || mat.type === "MAT_PIECEWISE_LINEAR_PLASTICITY") &&
        mat.sigy &&
        mat.sigy > 0
          ? mat.sigy * area
          : 0;

      links.push({
        iIdx,
        jIdx,
        nx: dx / L,
        ny: dy / L,
        nz: dz / L,
        stiffness: k,
        yieldForce,
      });
    } else {
      // SHELL or SOLID: assemble edge-bar stiffnesses and lumped nodal mass
      const validNodes: Array<{ idx: number; node: LsDynaNode }> = [];
      for (const nid of el.nodes) {
        const idx = nidToIdx.get(nid);
        const node = deck.nodes.get(nid);
        if (idx !== undefined && node) {
          validNodes.push({ idx, node });
        }
      }
      const m = validNodes.length;
      if (m < 2) continue;

      const Lc = computeCharacteristicLength(deck, el) || 1.0;
      const thickness = sec?.thickness && sec.thickness > 0 ? sec.thickness : Lc;
      const volume = el.kind === "SHELL" ? Lc * Lc * thickness : Lc * Lc * Lc;
      const elMass = mat.ro * volume;
      for (const vn of validNodes) {
        mass[vn.idx]! += elMass / m;
      }

      const eqArea = el.kind === "SHELL" ? (Lc * thickness) / m : (Lc * Lc) / m;
      for (let a = 0; a < m; a++) {
        for (let b = a + 1; b < m; b++) {
          const na = validNodes[a]!;
          const nb = validNodes[b]!;
          const dx = nb.node.x - na.node.x;
          const dy = nb.node.y - na.node.y;
          const dz = nb.node.z - na.node.z;
          const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (L <= 1e-15) continue;
          links.push({
            iIdx: na.idx,
            jIdx: nb.idx,
            nx: dx / L,
            ny: dy / L,
            nz: dz / L,
            stiffness: (mat.e * eqArea) / L,
            yieldForce: 0,
          });
        }
      }
    }
  }

  // Constrained translational DOFs (3 * nNodes)
  const fixed = new Uint8Array(nNodes * 3);

  // Apply *NODE tc constraint codes
  for (let i = 0; i < nNodes; i++) {
    const tc = deck.nodes.get(nodeIds[i]!)!.tc;
    if (tc === 1 || tc === 4 || tc === 6 || tc === 7) fixed[3 * i + 0] = 1;
    if (tc === 2 || tc === 4 || tc === 5 || tc === 7) fixed[3 * i + 1] = 1;
    if (tc === 3 || tc === 5 || tc === 6 || tc === 7) fixed[3 * i + 2] = 1;
  }

  // Apply *BOUNDARY_SPC_NODE and *BOUNDARY_SPC_SET
  for (const spc of deck.boundaries) {
    const targets: number[] =
      spc.targetType === "NODE" ? [spc.targetId] : (deck.nodeSets.get(spc.targetId)?.nodes ?? []);
    for (const nid of targets) {
      const idx = nidToIdx.get(nid);
      if (idx === undefined) continue;
      if (spc.dofx) fixed[3 * idx + 0] = 1;
      if (spc.dofy) fixed[3 * idx + 1] = 1;
      if (spc.dofz) fixed[3 * idx + 2] = 1;
    }
  }

  const u = new Float64Array(nNodes * 3);
  const v = new Float64Array(nNodes * 3);
  const a = new Float64Array(nNodes * 3);
  const fInt = new Float64Array(nNodes * 3);
  const fExt = new Float64Array(nNodes * 3);

  // Apply optional initial displacements
  if (options.initialDisplacements) {
    for (const [nid, disp] of options.initialDisplacements.entries()) {
      const idx = nidToIdx.get(nid);
      if (idx === undefined) continue;
      if (!fixed[3 * idx + 0]) u[3 * idx + 0] = disp[0];
      if (!fixed[3 * idx + 1]) u[3 * idx + 1] = disp[1];
      if (!fixed[3 * idx + 2]) u[3 * idx + 2] = disp[2];
    }
  }

  // Apply *INITIAL_VELOCITY
  for (const iv of deck.initialVelocities) {
    const targets: number[] = iv.nsid === 0 ? nodeIds : (deck.nodeSets.get(iv.nsid)?.nodes ?? []);
    for (const nid of targets) {
      const idx = nidToIdx.get(nid);
      if (idx === undefined) continue;
      if (!fixed[3 * idx + 0]) v[3 * idx + 0] = iv.vx;
      if (!fixed[3 * idx + 1]) v[3 * idx + 1] = iv.vy;
      if (!fixed[3 * idx + 2]) v[3 * idx + 2] = iv.vz;
    }
  }

  function computeInternalForces(): number {
    fInt.fill(0);
    let internalEnergy = 0;
    for (const link of links) {
      const i3 = link.iIdx * 3;
      const j3 = link.jIdx * 3;
      const dux = u[j3 + 0]! - u[i3 + 0]!;
      const duy = u[j3 + 1]! - u[i3 + 1]!;
      const duz = u[j3 + 2]! - u[i3 + 2]!;
      const delta = dux * link.nx + duy * link.ny + duz * link.nz;
      let axialForce = link.stiffness * delta;
      if (link.yieldForce > 0) {
        if (axialForce > link.yieldForce) axialForce = link.yieldForce;
        else if (axialForce < -link.yieldForce) axialForce = -link.yieldForce;
      }
      const fx = axialForce * link.nx;
      const fy = axialForce * link.ny;
      const fz = axialForce * link.nz;

      fInt[i3 + 0]! -= fx;
      fInt[i3 + 1]! -= fy;
      fInt[i3 + 2]! -= fz;
      fInt[j3 + 0]! += fx;
      fInt[j3 + 1]! += fy;
      fInt[j3 + 2]! += fz;

      internalEnergy += 0.5 * axialForce * delta;
    }
    return internalEnergy;
  }

  function computeExternalForces(t: number): void {
    fExt.fill(0);
    for (const load of deck.loads) {
      const idx = nidToIdx.get(load.nid);
      if (idx === undefined) continue;
      const curve = load.lcid > 0 ? deck.curves.get(load.lcid) : undefined;
      const val = curve ? load.sf * evaluateLsDynaCurve(curve, t) : load.sf;
      if (load.dof >= 1 && load.dof <= 3) {
        fExt[3 * idx + (load.dof - 1)]! += val;
      }
    }
  }

  function computeAccelerations(): void {
    for (let i = 0; i < nNodes; i++) {
      const m = mass[i]!;
      const invM = m > 1e-18 ? 1.0 / m : 0.0;
      const i3 = i * 3;
      a[i3 + 0] = fixed[i3 + 0] ? 0 : (fExt[i3 + 0]! - fInt[i3 + 0]!) * invM;
      a[i3 + 1] = fixed[i3 + 1] ? 0 : (fExt[i3 + 1]! - fInt[i3 + 1]!) * invM;
      a[i3 + 2] = fixed[i3 + 2] ? 0 : (fExt[i3 + 2]! - fInt[i3 + 2]!) * invM;
    }
  }

  function computeKineticEnergy(): number {
    let ke = 0;
    for (let i = 0; i < nNodes; i++) {
      const m = mass[i]!;
      const i3 = i * 3;
      const vx = v[i3 + 0]!;
      const vy = v[i3 + 1]!;
      const vz = v[i3 + 2]!;
      ke += 0.5 * m * (vx * vx + vy * vy + vz * vz);
    }
    return ke;
  }

  function snapshot(t: number, ke: number, ie: number): ExplicitTimeSample {
    const displacements = new Map<number, [number, number, number]>();
    const velocities = new Map<number, [number, number, number]>();
    for (let i = 0; i < nNodes; i++) {
      const i3 = i * 3;
      displacements.set(nodeIds[i]!, [u[i3 + 0]!, u[i3 + 1]!, u[i3 + 2]!]);
      velocities.set(nodeIds[i]!, [v[i3 + 0]!, v[i3 + 1]!, v[i3 + 2]!]);
    }
    return {
      time: t,
      kineticEnergy: ke,
      internalEnergy: ie,
      totalEnergy: ke + ie,
      displacements,
      velocities,
    };
  }

  // Step 0 initialization
  let ie = computeInternalForces();
  computeExternalForces(0);
  computeAccelerations();
  let ke = computeKineticEnergy();
  const initialTotalEnergy = ke + ie;
  let maxEnergyDriftRatio = 0;

  const samples: ExplicitTimeSample[] = [snapshot(0, ke, ie)];

  const totalSteps = Math.min(maxSteps, Math.max(0, Math.ceil(endTime / dtUsed)));
  let t = 0;

  for (let step = 1; step <= totalSteps; step++) {
    const stepDt = t + dtUsed > endTime ? endTime - t : dtUsed;
    if (stepDt <= 1e-18) break;

    // Velocity-Verlet / Central Difference half-step velocity & displacement update
    const halfDt = 0.5 * stepDt;
    for (let i = 0; i < nNodes * 3; i++) {
      if (fixed[i]) {
        v[i] = 0;
        u[i] = 0;
      } else {
        const vHalf = v[i]! + halfDt * a[i]!;
        v[i] = vHalf;
        u[i] = u[i]! + stepDt * vHalf;
      }
    }

    t += stepDt;

    // Forces & accelerations at t + dt
    ie = computeInternalForces();
    computeExternalForces(t);
    computeAccelerations();

    // Complete velocity step to integer time level
    for (let i = 0; i < nNodes * 3; i++) {
      if (fixed[i]) {
        v[i] = 0;
      } else {
        v[i] = v[i]! + halfDt * a[i]!;
      }
    }

    ke = computeKineticEnergy();
    const totalEnergy = ke + ie;
    if (initialTotalEnergy > 1e-15) {
      const drift = Math.abs(totalEnergy - initialTotalEnergy) / initialTotalEnergy;
      if (drift > maxEnergyDriftRatio) maxEnergyDriftRatio = drift;
    }

    if (step % outputStride === 0 || step === totalSteps) {
      samples.push(snapshot(t, ke, ie));
    }
  }

  const last = samples[samples.length - 1]!;
  return {
    cfl,
    dtUsed,
    steps: totalSteps,
    endTime: t,
    samples,
    finalDisplacements: last.displacements,
    finalVelocities: last.velocities,
    maxEnergyDriftRatio,
  };
}

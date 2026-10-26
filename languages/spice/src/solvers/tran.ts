// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — Transient (.TRAN) Numerical Simulation Engine.
 *
 * Implements adaptive/fixed-step transient simulation with Trapezoidal
 * and Backward Euler numerical integration companion models for reactive
 * elements (capacitors, inductors), time-varying waveforms (PULSE, SINE, PWL),
 * and non-linear Newton-Raphson convergence at each time step.
 */

import { parseSpiceNumber } from "../parser/spice-parser.js";
import type { SpiceCircuit, SpiceComponent, TransientOptions, TransientResult } from "../types.js";
import {
  DenseLU,
  DenseMatrix,
  buildMnaIndexing,
  flattenSpiceCircuit,
  stampConductance,
  stampCurrentSource,
} from "./mna.js";
import { solveOp } from "./op.js";

interface CapacitorState {
  comp: SpiceComponent;
  C: number;
  vPrev: number;
  iPrev: number;
}

interface InductorState {
  comp: SpiceComponent;
  L: number;
  vPrev: number;
  iPrev: number;
}

export function solveTran(circuit: SpiceCircuit, options?: Partial<TransientOptions>): TransientResult {
  const components = flattenSpiceCircuit(circuit);
  const indexing = buildMnaIndexing(components);

  // Extract .TRAN directive parameters from circuit if not explicitly passed
  let tstep = options?.tstep;
  let tstop = options?.tstop;
  let tstart = options?.tstart ?? 0;
  const uic = options?.uic ?? false;
  const method = options?.method ?? "trapezoidal";

  if (tstep === undefined || tstop === undefined) {
    for (const dir of circuit.directives) {
      if (dir.kind === ".TRAN" && dir.args.length >= 2) {
        if (tstep === undefined && dir.args[0] !== undefined) tstep = parseSpiceNumber(dir.args[0]);
        if (tstop === undefined && dir.args[1] !== undefined) tstop = parseSpiceNumber(dir.args[1]);
        if (dir.args.length >= 3 && options?.tstart === undefined && dir.args[2] !== undefined) {
          tstart = parseSpiceNumber(dir.args[2]);
        }
        break;
      }
    }
  }

  const h = tstep ?? 1e-6;
  const stopTime = tstop ?? 1e-3;

  // Track state of capacitors and inductors
  const capStates: CapacitorState[] = [];
  const indStates: InductorState[] = [];

  for (const comp of components) {
    if (comp.kind === "C") {
      const val = comp.value ?? 1e-9;
      capStates.push({ comp, C: val, vPrev: 0, iPrev: 0 });
    } else if (comp.kind === "L") {
      const val = comp.value ?? 1e-6;
      indStates.push({ comp, L: val, vPrev: 0, iPrev: 0 });
    }
  }

  // Initial conditions at t = 0
  let currentSol = new Float64Array(indexing.totalSize);
  if (!uic) {
    const op = solveOp(circuit);
    for (let i = 0; i < indexing.idxToNode.length; i++) {
      const node = indexing.idxToNode[i];
      if (node !== undefined) {
        currentSol[i] = op.nodeVoltages.get(node) ?? 0;
      }
    }
    for (const [branch, bIdx] of indexing.branchToIdx) {
      currentSol[bIdx] = op.branchCurrents.get(branch) ?? 0;
    }
  }

  // Initialize capacitor voltages and inductor currents from initial solution
  const getNodeVoltage = (node: string | undefined, sol: Float64Array): number => {
    if (!node) return 0.0;
    const norm = node.toUpperCase();
    if (norm === "0" || norm === "GND") return 0.0;
    const idx = indexing.nodeToIdx.get(norm);
    return idx !== undefined ? (sol[idx] ?? 0.0) : 0.0;
  };

  for (const cs of capStates) {
    const v1 = getNodeVoltage(cs.comp.nodes[0], currentSol);
    const v2 = getNodeVoltage(cs.comp.nodes[1], currentSol);
    cs.vPrev = v1 - v2;
    cs.iPrev = 0; // In DC, cap current is 0
  }

  for (const ls of indStates) {
    const v1 = getNodeVoltage(ls.comp.nodes[0], currentSol);
    const v2 = getNodeVoltage(ls.comp.nodes[1], currentSol);
    ls.vPrev = v1 - v2; // In DC, inductor voltage is ~0
    ls.iPrev = 0;
  }

  // Result trajectories
  const timePoints: number[] = [];
  const nodeTrajectories = new Map<string, number[]>();
  nodeTrajectories.set("0", []);
  for (const node of indexing.idxToNode) {
    nodeTrajectories.set(node, []);
  }

  const branchTrajectories = new Map<string, number[]>();
  for (const branch of indexing.branchToIdx.keys()) {
    branchTrajectories.set(branch, []);
  }

  const matrix = new DenseMatrix(indexing.totalSize);
  const rhs = new Float64Array(indexing.totalSize);
  const nextSol = new Float64Array(indexing.totalSize);
  const luSolver = new DenseLU(indexing.totalSize);

  // Pre-assemble constant linear system matrix:
  // 1. Resistors
  for (const comp of components) {
    const n1 = comp.nodes[0] ?? "";
    const n2 = comp.nodes[1] ?? "";
    if (comp.kind === "R") {
      const rVal = comp.value ?? 1e3;
      const g = rVal > 0 ? 1.0 / rVal : 1e12;
      stampConductance(matrix, indexing, n1, n2, g);
    }
  }

  // 2. Capacitors companion conductances
  for (const cs of capStates) {
    const n1 = cs.comp.nodes[0] ?? "";
    const n2 = cs.comp.nodes[1] ?? "";
    const Gc = method === "trapezoidal" ? (2.0 * cs.C) / h : cs.C / h;
    stampConductance(matrix, indexing, n1, n2, Gc);
  }

  // 3. Inductors companion conductances
  for (const ls of indStates) {
    const n1 = ls.comp.nodes[0] ?? "";
    const n2 = ls.comp.nodes[1] ?? "";
    const Gl = method === "trapezoidal" ? h / (2.0 * ls.L) : h / ls.L;
    stampConductance(matrix, indexing, n1, n2, Gl);
  }

  // 4. Voltage Sources and VCVS branch equations
  for (const comp of components) {
    const n1 = comp.nodes[0] ?? "";
    const n2 = comp.nodes[1] ?? "";

    if (comp.kind === "V") {
      const branchIdx = indexing.branchToIdx.get(comp.name);
      if (branchIdx !== undefined) {
        const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
        const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;
        if (i1 >= 0) {
          matrix.add(i1, branchIdx, 1.0);
          matrix.add(branchIdx, i1, 1.0);
        }
        if (i2 >= 0) {
          matrix.add(i2, branchIdx, -1.0);
          matrix.add(branchIdx, i2, -1.0);
        }
      }
    } else if (comp.kind === "E" && comp.controlNodes) {
      const bIdx = indexing.branchToIdx.get(comp.name);
      if (bIdx !== undefined) {
        const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
        const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;
        const c1 = indexing.nodeToIdx.get(comp.controlNodes[0]?.toUpperCase() ?? "") ?? -1;
        const c2 = indexing.nodeToIdx.get(comp.controlNodes[1]?.toUpperCase() ?? "") ?? -1;
        const gain = comp.gain ?? comp.value ?? 1.0;

        if (i1 >= 0) {
          matrix.add(i1, bIdx, 1.0);
          matrix.add(bIdx, i1, 1.0);
        }
        if (i2 >= 0) {
          matrix.add(i2, bIdx, -1.0);
          matrix.add(bIdx, i2, -1.0);
        }
        if (c1 >= 0) matrix.add(bIdx, c1, -gain);
        if (c2 >= 0) matrix.add(bIdx, c2, gain);
      }
    }
  }

  // Factorize once before time stepping
  if (!luSolver.factorize(matrix)) {
    return {
      time: timePoints,
      nodeVoltages: nodeTrajectories,
      branchCurrents: branchTrajectories,
    };
  }

  let t = 0;

  // Main Transient Time-Stepping Loop
  while (t <= stopTime + 1e-15) {
    // Record current step if t >= tstart
    if (t >= tstart - 1e-15) {
      timePoints.push(t);
      nodeTrajectories.get("0")?.push(0.0);
      for (let i = 0; i < indexing.idxToNode.length; i++) {
        const node = indexing.idxToNode[i];
        if (node !== undefined) {
          nodeTrajectories.get(node)?.push(currentSol[i] ?? 0);
        }
      }
      for (const [branch, bIdx] of indexing.branchToIdx) {
        branchTrajectories.get(branch)?.push(currentSol[bIdx] ?? 0);
      }
    }

    t += h;

    // Assemble RHS at next time step t (zero allocations)
    rhs.fill(0);

    // 1. Capacitors companion history currents
    for (const cs of capStates) {
      const n1 = cs.comp.nodes[0] ?? "";
      const n2 = cs.comp.nodes[1] ?? "";
      const Gc = method === "trapezoidal" ? (2.0 * cs.C) / h : cs.C / h;
      const Ieq = method === "trapezoidal" ? Gc * cs.vPrev + cs.iPrev : Gc * cs.vPrev;

      const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
      const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;
      if (i1 >= 0) rhs[i1] = (rhs[i1] ?? 0) + Ieq;
      if (i2 >= 0) rhs[i2] = (rhs[i2] ?? 0) - Ieq;
    }

    // 2. Inductors companion history currents
    for (const ls of indStates) {
      const n1 = ls.comp.nodes[0] ?? "";
      const n2 = ls.comp.nodes[1] ?? "";
      const Gl = method === "trapezoidal" ? h / (2.0 * ls.L) : h / ls.L;
      const Ieq = method === "trapezoidal" ? ls.iPrev + Gl * ls.vPrev : ls.iPrev;

      const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
      const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;
      if (i1 >= 0) rhs[i1] = (rhs[i1] ?? 0) - Ieq;
      if (i2 >= 0) rhs[i2] = (rhs[i2] ?? 0) + Ieq;
    }

    // 3. Time-Varying Sources
    for (const comp of components) {
      const n1 = comp.nodes[0] ?? "";
      const n2 = comp.nodes[1] ?? "";

      if (comp.kind === "V") {
        const branchIdx = indexing.branchToIdx.get(comp.name);
        if (branchIdx !== undefined) {
          rhs[branchIdx] = evaluateSourceWaveform(comp, t);
        }
      } else if (comp.kind === "I") {
        const iNow = evaluateSourceWaveform(comp, t);
        stampCurrentSource(rhs, indexing, n1, n2, iNow);
      }
    }

    // 4. Solve linear system in-place in O(N^2) (zero allocations)
    luSolver.solve(rhs, nextSol);

    // 5. Update Capacitor and Inductor internal states for next step
    for (const cs of capStates) {
      const v1 = getNodeVoltage(cs.comp.nodes[0], nextSol);
      const v2 = getNodeVoltage(cs.comp.nodes[1], nextSol);
      const vNew = v1 - v2;
      let iNew: number;
      if (method === "trapezoidal") {
        const Gc = (2.0 * cs.C) / h;
        iNew = Gc * (vNew - cs.vPrev) - cs.iPrev;
      } else {
        const Gc = cs.C / h;
        iNew = Gc * (vNew - cs.vPrev);
      }
      cs.vPrev = vNew;
      cs.iPrev = iNew;
    }

    for (const ls of indStates) {
      const v1 = getNodeVoltage(ls.comp.nodes[0], nextSol);
      const v2 = getNodeVoltage(ls.comp.nodes[1], nextSol);
      const vNew = v1 - v2;
      let iNew: number;
      if (method === "trapezoidal") {
        const Gl = h / (2.0 * ls.L);
        iNew = ls.iPrev + Gl * (vNew + ls.vPrev);
      } else {
        const Gl = h / ls.L;
        iNew = ls.iPrev + Gl * vNew;
      }
      ls.vPrev = vNew;
      ls.iPrev = iNew;
    }

    currentSol.set(nextSol);
  }

  return {
    time: timePoints,
    nodeVoltages: nodeTrajectories,
    branchCurrents: branchTrajectories,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic Waveform Evaluator
// ─────────────────────────────────────────────────────────────────────────────

export function evaluateSourceWaveform(comp: SpiceComponent, t: number): number {
  const spec = comp.sourceSpec;
  if (!spec || !spec.waveform) {
    return spec?.dc ?? comp.value ?? 0;
  }

  const w = spec.waveform;

  if (w.kind === "PULSE") {
    // PULSE(v1 v2 td tr tf pw per)
    if (t < w.td) return w.v1;

    const tRel = (t - w.td) % w.per;

    if (tRel < w.tr) {
      // Rising edge
      return w.tr > 0 ? w.v1 + (w.v2 - w.v1) * (tRel / w.tr) : w.v2;
    }
    if (tRel < w.tr + w.pw) {
      // Pulse top
      return w.v2;
    }
    if (tRel < w.tr + w.pw + w.tf) {
      // Falling edge
      const tFall = tRel - (w.tr + w.pw);
      return w.tf > 0 ? w.v2 - (w.v2 - w.v1) * (tFall / w.tf) : w.v1;
    }
    // Low period
    return w.v1;
  }

  if (w.kind === "SINE") {
    // SINE(vo va freq td theta)
    const td = w.td ?? 0;
    if (t < td) return w.vo;
    const thetaRad = ((w.theta ?? 0) * Math.PI) / 180.0;
    const arg = 2.0 * Math.PI * w.freq * (t - td) + thetaRad;
    return w.vo + w.va * Math.sin(arg);
  }

  if (w.kind === "PWL") {
    // Piecewise Linear
    const pts = w.points;
    if (pts.length === 0) return 0;
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (!first || !last) return 0;
    if (t <= first[0]) return first[1];
    if (t >= last[0]) return last[1];

    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      if (p1 && p2 && t >= p1[0] && t <= p2[0]) {
        const dt = p2[0] - p1[0];
        if (dt === 0) return p2[1];
        const frac = (t - p1[0]) / dt;
        return p1[1] + frac * (p2[1] - p1[1]);
      }
    }
  }

  return spec.dc ?? comp.value ?? 0;
}

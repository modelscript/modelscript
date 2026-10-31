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
  solveLinearSystem,
  stampConductance,
  stampCurrentSource,
} from "./mna.js";
import {
  extractPrecomputedNonlinearDevices,
  findBranchIndex,
  solveOp,
  stampPrecomputedBjt,
  stampPrecomputedDiode,
  stampPrecomputedMosfet,
} from "./op.js";

interface CapacitorState {
  comp: SpiceComponent;
  C: number;
  vPrev: number;
  iPrev: number;
}

interface InductorCoupling {
  otherIdx: number;
  gammaMutual: number;
}

interface InductorState {
  comp: SpiceComponent;
  L: number;
  gammaSelf: number;
  couplings: InductorCoupling[];
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
  const indNameToIdx = new Map<string, number>();

  for (const comp of components) {
    if (comp.kind === "C") {
      const val = comp.value ?? 1e-9;
      capStates.push({ comp, C: val, vPrev: 0, iPrev: 0 });
    } else if (comp.kind === "L") {
      const val = comp.value ?? 1e-6;
      const idx = indStates.length;
      indStates.push({
        comp,
        L: val,
        gammaSelf: val > 0 ? 1.0 / val : 1e12,
        couplings: [],
        vPrev: 0,
        iPrev: 0,
      });
      indNameToIdx.set(comp.name.toUpperCase(), idx);
    }
  }

  // Process mutual inductors (K cards) to build inverse inductance matrix Gamma = L^-1
  for (const comp of components) {
    if (comp.kind === "K") {
      const l1Name = (comp.inductor1 ?? comp.nodes[0] ?? "").toUpperCase();
      const l2Name = (comp.inductor2 ?? comp.nodes[1] ?? "").toUpperCase();
      const idx1 = indNameToIdx.get(l1Name);
      const idx2 = indNameToIdx.get(l2Name);
      if (idx1 !== undefined && idx2 !== undefined && idx1 !== idx2) {
        const ls1 = indStates[idx1];
        const ls2 = indStates[idx2];
        if (!ls1 || !ls2) continue;
        const rawK = comp.couplingFactor ?? comp.value ?? 0.999;
        const kSign = rawK < 0 ? -1 : 1;
        const kEff = kSign * Math.min(0.9999, Math.abs(rawK));
        const M = kEff * Math.sqrt(ls1.L * ls2.L);
        const det = ls1.L * ls2.L - M * M;
        if (det > 1e-30) {
          ls1.gammaSelf = ls2.L / det;
          ls2.gammaSelf = ls1.L / det;
          const gammaMut = -M / det;
          ls1.couplings.push({ otherIdx: idx2, gammaMutual: gammaMut });
          ls2.couplings.push({ otherIdx: idx1, gammaMutual: gammaMut });
        }
      }
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
    ls.iPrev = uic ? 0 : (v1 - v2) * 1e6;
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

  // 3. Inductors (and coupled K inductors) companion conductances
  const alphaInd = method === "trapezoidal" ? 0.5 * h : h;
  for (const ls of indStates) {
    const n1 = ls.comp.nodes[0] ?? "";
    const n2 = ls.comp.nodes[1] ?? "";
    const Gl = alphaInd * ls.gammaSelf;
    stampConductance(matrix, indexing, n1, n2, Gl);

    const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
    const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;
    for (const cpl of ls.couplings) {
      const other = indStates[cpl.otherIdx];
      if (!other) continue;
      const c1 = indexing.nodeToIdx.get((other.comp.nodes[0] ?? "").toUpperCase()) ?? -1;
      const c2 = indexing.nodeToIdx.get((other.comp.nodes[1] ?? "").toUpperCase()) ?? -1;
      const Gm = alphaInd * cpl.gammaMutual;
      if (i1 >= 0 && c1 >= 0) matrix.add(i1, c1, Gm);
      if (i1 >= 0 && c2 >= 0) matrix.add(i1, c2, -Gm);
      if (i2 >= 0 && c1 >= 0) matrix.add(i2, c1, -Gm);
      if (i2 >= 0 && c2 >= 0) matrix.add(i2, c2, Gm);
    }
  }

  // 4. Voltage Sources and Controlled Sources (E, G, F, H)
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
    } else if (comp.kind === "G" && comp.controlNodes) {
      const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
      const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;
      const c1 = indexing.nodeToIdx.get(comp.controlNodes[0]?.toUpperCase() ?? "") ?? -1;
      const c2 = indexing.nodeToIdx.get(comp.controlNodes[1]?.toUpperCase() ?? "") ?? -1;
      const gm = comp.gain ?? comp.value ?? 1e-3;

      if (i1 >= 0 && c1 >= 0) matrix.add(i1, c1, gm);
      if (i1 >= 0 && c2 >= 0) matrix.add(i1, c2, -gm);
      if (i2 >= 0 && c1 >= 0) matrix.add(i2, c1, -gm);
      if (i2 >= 0 && c2 >= 0) matrix.add(i2, c2, gm);
    } else if (comp.kind === "F" && comp.controlSource) {
      const cBranchIdx = findBranchIndex(indexing.branchToIdx, comp.controlSource);
      if (cBranchIdx !== undefined) {
        const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
        const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;
        const gain = comp.gain ?? comp.value ?? 1.0;
        if (i1 >= 0) matrix.add(i1, cBranchIdx, gain);
        if (i2 >= 0) matrix.add(i2, cBranchIdx, -gain);
      }
    } else if (comp.kind === "H" && comp.controlSource) {
      const bIdx = indexing.branchToIdx.get(comp.name);
      const cBranchIdx = findBranchIndex(indexing.branchToIdx, comp.controlSource);
      if (bIdx !== undefined) {
        const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
        const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;
        const gain = comp.gain ?? comp.value ?? 1.0;
        if (i1 >= 0) {
          matrix.add(i1, bIdx, 1.0);
          matrix.add(bIdx, i1, 1.0);
        }
        if (i2 >= 0) {
          matrix.add(i2, bIdx, -1.0);
          matrix.add(bIdx, i2, -1.0);
        }
        if (cBranchIdx !== undefined) {
          matrix.add(bIdx, cBranchIdx, -gain);
        }
      }
    }
  }

  // 5. Pre-extract non-linear devices (D, Q, M)
  const nlDevices = extractPrecomputedNonlinearDevices(components, circuit, indexing);
  const iterMatrix = nlDevices.hasNonlinear ? new DenseMatrix(indexing.totalSize) : null;
  const iterRhs = nlDevices.hasNonlinear ? new Float64Array(indexing.totalSize) : null;
  const iterSol = nlDevices.hasNonlinear ? new Float64Array(indexing.totalSize) : null;
  const candidateSol = nlDevices.hasNonlinear ? new Float64Array(indexing.totalSize) : null;

  // Factorize once before time stepping if purely linear
  if (!nlDevices.hasNonlinear && !luSolver.factorize(matrix)) {
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

    // 2. Inductors (and coupled K inductors) companion history currents
    const betaInd = method === "trapezoidal" ? 1.0 : 0.0;
    for (const ls of indStates) {
      const n1 = ls.comp.nodes[0] ?? "";
      const n2 = ls.comp.nodes[1] ?? "";
      let dIdtPrev = ls.gammaSelf * ls.vPrev;
      for (const cpl of ls.couplings) {
        const other = indStates[cpl.otherIdx];
        if (!other) continue;
        dIdtPrev += cpl.gammaMutual * other.vPrev;
      }
      const Ieq = ls.iPrev + betaInd * alphaInd * dIdtPrev;

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

    // 4. Solve system at time step t
    if (!nlDevices.hasNonlinear) {
      // Fast path for linear circuits: O(N^2) solve using pre-factorized LU
      luSolver.solve(rhs, nextSol);
    } else if (iterMatrix && iterRhs && iterSol && candidateSol) {
      // Non-linear Newton-Raphson loop at time step t
      iterSol.set(currentSol);
      const maxNrIters = 50;
      const nrTol = 1e-6;
      const damping = 0.8;

      for (let nr = 0; nr < maxNrIters; nr++) {
        iterMatrix.data.set(matrix.data);
        iterRhs.set(rhs);

        for (const diode of nlDevices.diodes) {
          stampPrecomputedDiode(iterMatrix, iterRhs, diode, iterSol);
        }
        for (const bjt of nlDevices.bjts) {
          stampPrecomputedBjt(iterMatrix, iterRhs, bjt, iterSol);
        }
        for (const mosfet of nlDevices.mosfets) {
          stampPrecomputedMosfet(iterMatrix, iterRhs, mosfet, iterSol);
        }

        const solved = solveLinearSystem(iterMatrix, iterRhs, candidateSol, luSolver);
        if (!solved) break;

        let maxDiff = 0;
        for (let j = 0; j < indexing.totalSize; j++) {
          const diff = Math.abs((candidateSol[j] ?? 0) - (iterSol[j] ?? 0));
          if (diff > maxDiff) maxDiff = diff;
        }

        if (maxDiff < nrTol) {
          iterSol.set(candidateSol);
          break;
        }

        const alpha = nr < 10 ? 1.0 : damping;
        for (let j = 0; j < indexing.totalSize; j++) {
          iterSol[j] = alpha * (candidateSol[j] ?? 0) + (1.0 - alpha) * (iterSol[j] ?? 0);
        }
      }
      nextSol.set(iterSol);
    }

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

    const vIndNew = indStates.map((ls) => {
      const v1 = getNodeVoltage(ls.comp.nodes[0], nextSol);
      const v2 = getNodeVoltage(ls.comp.nodes[1], nextSol);
      return v1 - v2;
    });
    const iIndNew = indStates.map((ls, idx) => {
      const vNew = vIndNew[idx] ?? 0;
      let dIdtNew = ls.gammaSelf * vNew;
      let dIdtPrev = ls.gammaSelf * ls.vPrev;
      for (const cpl of ls.couplings) {
        dIdtNew += cpl.gammaMutual * (vIndNew[cpl.otherIdx] ?? 0);
        dIdtPrev += cpl.gammaMutual * (indStates[cpl.otherIdx]?.vPrev ?? 0);
      }
      return ls.iPrev + alphaInd * (dIdtNew + betaInd * dIdtPrev);
    });
    for (let idx = 0; idx < indStates.length; idx++) {
      const ls = indStates[idx];
      if (ls) {
        ls.vPrev = vIndNew[idx] ?? 0;
        ls.iPrev = iIndNew[idx] ?? 0;
      }
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

    const tRel = w.per > 0 ? (t - w.td) % w.per : t - w.td;

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
    const edamp = w.theta ? Math.exp(-(t - td) * w.theta) : 1.0;
    const arg = 2.0 * Math.PI * w.freq * (t - td) + thetaRad;
    return w.vo + w.va * edamp * Math.sin(arg);
  }

  if (w.kind === "EXP") {
    // EXP(v1 v2 td1 tau1 td2 tau2)
    if (t <= w.td1) return w.v1;
    const term1 = (w.v2 - w.v1) * (1.0 - Math.exp(-(t - w.td1) / Math.max(w.tau1, 1e-15)));
    if (t <= w.td2) return w.v1 + term1;
    const term2 = (w.v1 - w.v2) * (1.0 - Math.exp(-(t - w.td2) / Math.max(w.tau2, 1e-15)));
    return w.v1 + term1 + term2;
  }

  if (w.kind === "SFFM") {
    // SFFM(vo va fc mdi fs)
    return w.vo + w.va * Math.sin(2.0 * Math.PI * w.fc * t + w.modIndex * Math.sin(2.0 * Math.PI * w.fs * t));
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

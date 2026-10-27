// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — DC Operating Point (.OP) Solver.
 *
 * Implements non-linear DC operating point calculation using Newton-Raphson
 * iteration, companion conductances for semiconductor devices (diodes, BJTs, MOSFETs),
 * and MNA matrix stamping.
 */

import type { OperatingPoint, SpiceCircuit } from "../types.js";
import {
  DenseLU,
  DenseMatrix,
  buildMnaIndexing,
  flattenSpiceCircuit,
  solveLinearSystem,
  stampConductance,
  stampCurrentSource,
  stampVoltageSource,
} from "./mna.js";

const THERMAL_VOLTAGE_VT = 0.02585; // Vt = kT/q at 300K (~26mV)
const DEFAULT_DIODE_IS = 1e-14;
const DEFAULT_DIODE_N = 1.0;

export interface OpSolverOptions {
  maxIterations?: number | undefined;
  tolerance?: number | undefined;
  dampingFactor?: number | undefined;
}

export function solveOp(circuit: SpiceCircuit, options?: OpSolverOptions): OperatingPoint {
  const components = flattenSpiceCircuit(circuit);
  const indexing = buildMnaIndexing(components);

  const maxIters = options?.maxIterations ?? 100;
  const tol = options?.tolerance ?? 1e-6;
  const damping = options?.dampingFactor ?? 0.8;

  let solution = new Float64Array(indexing.totalSize);

  // Apply initial conditions (.IC or .NODESET) if specified in circuit
  for (const dir of circuit.directives) {
    if (dir.kind === ".IC" || dir.kind === ".NODESET") {
      for (const [k, v] of dir.params) {
        if (typeof v === "number") {
          const idx = indexing.nodeToIdx.get(k.toUpperCase());
          if (idx !== undefined) {
            solution[idx] = v;
          }
        }
      }
    }
  }

  const baseMatrix = new DenseMatrix(indexing.totalSize);
  const baseRhs = new Float64Array(indexing.totalSize);

  // 1. Pre-stamp all linear components into baseMatrix & baseRhs once
  for (const comp of components) {
    const n1 = comp.nodes[0] ?? "";
    const n2 = comp.nodes[1] ?? "";

    if (comp.kind === "R") {
      const val = comp.value ?? 1e3;
      const g = val > 0 ? 1.0 / val : 1e12;
      stampConductance(baseMatrix, indexing, n1, n2, g);
    } else if (comp.kind === "L") {
      // In DC, inductor is short circuit (modeled as small series resistance 1uOhm)
      const gInd = 1e6;
      stampConductance(baseMatrix, indexing, n1, n2, gInd);
    } else if (comp.kind === "C") {
      // In DC, capacitor is open circuit (conductance = 0, no stamp)
    } else if (comp.kind === "V") {
      const vVal = comp.sourceSpec?.dc ?? comp.value ?? 0;
      stampVoltageSource(baseMatrix, baseRhs, indexing, comp.name, n1, n2, vVal);
    } else if (comp.kind === "I") {
      const iVal = comp.sourceSpec?.dc ?? comp.value ?? 0;
      stampCurrentSource(baseRhs, indexing, n1, n2, iVal);
    } else if (comp.kind === "E" && comp.controlNodes) {
      // VCVS: V(n1) - V(n2) - gain * (V(nc1) - V(nc2)) = 0
      const bIdx = indexing.branchToIdx.get(comp.name);
      if (bIdx !== undefined) {
        const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
        const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;
        const c1 = indexing.nodeToIdx.get(comp.controlNodes[0]?.toUpperCase() ?? "") ?? -1;
        const c2 = indexing.nodeToIdx.get(comp.controlNodes[1]?.toUpperCase() ?? "") ?? -1;
        const gain = comp.gain ?? comp.value ?? 1.0;

        if (i1 >= 0) {
          baseMatrix.add(i1, bIdx, 1.0);
          baseMatrix.add(bIdx, i1, 1.0);
        }
        if (i2 >= 0) {
          baseMatrix.add(i2, bIdx, -1.0);
          baseMatrix.add(bIdx, i2, -1.0);
        }
        if (c1 >= 0) baseMatrix.add(bIdx, c1, -gain);
        if (c2 >= 0) baseMatrix.add(bIdx, c2, gain);
      }
    } else if (comp.kind === "G" && comp.controlNodes) {
      // VCCS: I(n1->n2) = gm * (V(nc1) - V(nc2))
      const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
      const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;
      const c1 = indexing.nodeToIdx.get(comp.controlNodes[0]?.toUpperCase() ?? "") ?? -1;
      const c2 = indexing.nodeToIdx.get(comp.controlNodes[1]?.toUpperCase() ?? "") ?? -1;
      const gm = comp.gain ?? comp.value ?? 1e-3;

      if (i1 >= 0 && c1 >= 0) baseMatrix.add(i1, c1, gm);
      if (i1 >= 0 && c2 >= 0) baseMatrix.add(i1, c2, -gm);
      if (i2 >= 0 && c1 >= 0) baseMatrix.add(i2, c1, -gm);
      if (i2 >= 0 && c2 >= 0) baseMatrix.add(i2, c2, gm);
    }
  }

  // 2. Pre-extract and cache semiconductor parameters and integer node indices
  const precomputedDiodes: PrecomputedDiode[] = [];
  const precomputedBjts: PrecomputedBjt[] = [];
  const precomputedMosfets: PrecomputedMosfet[] = [];

  for (const comp of components) {
    if (comp.kind === "D") {
      const modelName = (comp.model ?? "").toUpperCase();
      const model = circuit.models.get(modelName);
      const Is = model?.params.get("IS") ?? DEFAULT_DIODE_IS;
      const N = model?.params.get("N") ?? DEFAULT_DIODE_N;
      const nVt = N * THERMAL_VOLTAGE_VT;
      const n1 = comp.nodes[0] ?? "";
      const n2 = comp.nodes[1] ?? "";
      const iAnode = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
      const iCathode = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;
      precomputedDiodes.push({ iAnode, iCathode, Is, nVt });
    } else if (comp.kind === "Q") {
      const modelName = (comp.model ?? "").toUpperCase();
      const model = circuit.models.get(modelName);
      const betaF = model?.params.get("BF") ?? 100.0;
      const Is = model?.params.get("IS") ?? 1e-14;
      const colNode = comp.nodes[0] ?? "";
      const baseNode = comp.nodes[1] ?? "";
      const emitNode = comp.nodes[2] ?? "";
      const iCol = indexing.nodeToIdx.get(colNode.toUpperCase()) ?? -1;
      const iBase = indexing.nodeToIdx.get(baseNode.toUpperCase()) ?? -1;
      const iEmit = indexing.nodeToIdx.get(emitNode.toUpperCase()) ?? -1;
      precomputedBjts.push({ iCol, iBase, iEmit, betaF, Is });
    } else if (comp.kind === "M") {
      const modelName = (comp.model ?? "").toUpperCase();
      const model = circuit.models.get(modelName);
      const isPmos = model?.type === "PMOS";
      const Vth = model?.params.get("VTO") ?? (isPmos ? -0.7 : 0.7);
      const Kp = model?.params.get("KP") ?? 1e-4;
      const W = Number(comp.params.get("W") ?? 10e-6);
      const L = Number(comp.params.get("L") ?? 1e-6);
      const beta = Kp * (W / L);
      const drainNode = comp.nodes[0] ?? "";
      const gateNode = comp.nodes[1] ?? "";
      const sourceNode = comp.nodes[2] ?? "";
      const iDrain = indexing.nodeToIdx.get(drainNode.toUpperCase()) ?? -1;
      const iGate = indexing.nodeToIdx.get(gateNode.toUpperCase()) ?? -1;
      const iSource = indexing.nodeToIdx.get(sourceNode.toUpperCase()) ?? -1;
      precomputedMosfets.push({
        iDrain,
        iGate,
        iSource,
        isPmos,
        absVth: Math.abs(Vth),
        beta,
      });
    }
  }

  const matrix = new DenseMatrix(indexing.totalSize);
  const rhs = new Float64Array(indexing.totalSize);
  const newSolution = new Float64Array(indexing.totalSize);
  const luSolver = new DenseLU(indexing.totalSize);

  let converged = false;
  let iterations = 0;

  for (let iter = 0; iter < maxIters; iter++) {
    iterations++;
    matrix.data.set(baseMatrix.data);
    rhs.set(baseRhs);

    // Stamp precomputed non-linear semiconductor models (D, Q, M) with zero lookup overhead
    for (const diode of precomputedDiodes) {
      stampPrecomputedDiode(matrix, rhs, diode, solution);
    }
    for (const bjt of precomputedBjts) {
      stampPrecomputedBjt(matrix, rhs, bjt, solution);
    }
    for (const mosfet of precomputedMosfets) {
      stampPrecomputedMosfet(matrix, rhs, mosfet, solution);
    }

    // Solve linear system in-place
    const solved = solveLinearSystem(matrix, rhs, newSolution, luSolver);
    if (!solved) {
      break; // Matrix singular or non-convergent
    }

    // Check convergence
    let maxDiff = 0;
    for (let j = 0; j < indexing.totalSize; j++) {
      const diff = Math.abs((newSolution[j] ?? 0) - (solution[j] ?? 0));
      if (diff > maxDiff) maxDiff = diff;
    }

    if (maxDiff < tol) {
      converged = true;
      solution.set(newSolution);
      break;
    }

    // Update with damping
    for (let j = 0; j < indexing.totalSize; j++) {
      solution[j] = damping * (newSolution[j] ?? 0) + (1 - damping) * (solution[j] ?? 0);
    }
  }

  // Format result
  const nodeVoltages = new Map<string, number>();
  nodeVoltages.set("0", 0.0);
  for (let i = 0; i < indexing.idxToNode.length; i++) {
    const node = indexing.idxToNode[i];
    if (node !== undefined) {
      nodeVoltages.set(node, solution[i] ?? 0);
    }
  }

  const branchCurrents = new Map<string, number>();
  for (const [branchName, bIdx] of indexing.branchToIdx) {
    branchCurrents.set(branchName, solution[bIdx] ?? 0);
  }

  return {
    nodeVoltages,
    branchCurrents,
    converged,
    iterations,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Non-Linear Semiconductor Companions (Pre-computed Zero-Lookup)
// ─────────────────────────────────────────────────────────────────────────────

interface PrecomputedDiode {
  iAnode: number;
  iCathode: number;
  Is: number;
  nVt: number;
}

interface PrecomputedBjt {
  iCol: number;
  iBase: number;
  iEmit: number;
  betaF: number;
  Is: number;
}

interface PrecomputedMosfet {
  iDrain: number;
  iGate: number;
  iSource: number;
  isPmos: boolean;
  absVth: number;
  beta: number;
}

function stampPrecomputedDiode(
  matrix: DenseMatrix,
  rhs: Float64Array,
  diode: PrecomputedDiode,
  currentSol: Float64Array,
): void {
  const { iAnode, iCathode, Is, nVt } = diode;
  const vAnode = iAnode >= 0 ? (currentSol[iAnode] ?? 0) : 0;
  const vCathode = iCathode >= 0 ? (currentSol[iCathode] ?? 0) : 0;
  let vd = vAnode - vCathode;

  // Numerical safeguard on forward bias
  if (vd > 0.8) vd = 0.8;
  if (vd < -10) vd = -10;

  const expTerm = Math.exp(vd / nVt);
  const id = Is * (expTerm - 1.0);
  const gd = (Is / nVt) * expTerm + 1e-12; // Gmin addition for numerical stability
  const ieq = id - gd * vd;

  // Stamp gd
  if (iAnode >= 0) matrix.add(iAnode, iAnode, gd);
  if (iCathode >= 0) matrix.add(iCathode, iCathode, gd);
  if (iAnode >= 0 && iCathode >= 0) {
    matrix.add(iAnode, iCathode, -gd);
    matrix.add(iCathode, iAnode, -gd);
  }

  // Stamp ieq (parallel current source leaving anode, entering cathode)
  if (iAnode >= 0) rhs[iAnode] = (rhs[iAnode] ?? 0) - ieq;
  if (iCathode >= 0) rhs[iCathode] = (rhs[iCathode] ?? 0) + ieq;
}

function stampPrecomputedBjt(
  matrix: DenseMatrix,
  rhs: Float64Array,
  bjt: PrecomputedBjt,
  currentSol: Float64Array,
): void {
  const { iCol, iBase, iEmit, betaF, Is } = bjt;
  const vBase = iBase >= 0 ? (currentSol[iBase] ?? 0) : 0;
  const vEmit = iEmit >= 0 ? (currentSol[iEmit] ?? 0) : 0;

  let vbe = vBase - vEmit;
  if (vbe > 0.8) vbe = 0.8;
  if (vbe < -5) vbe = -5;

  const expVbe = Math.exp(vbe / THERMAL_VOLTAGE_VT);
  const ib = (Is / betaF) * (expVbe - 1.0);
  const gpi = (Is / (betaF * THERMAL_VOLTAGE_VT)) * expVbe + 1e-12;
  const gm = (Is / THERMAL_VOLTAGE_VT) * expVbe;
  const ieqBase = ib - gpi * vbe;
  const ieqCol = betaF * ib - gm * vbe;

  // Base-emitter conductance
  if (iBase >= 0) matrix.add(iBase, iBase, gpi);
  if (iEmit >= 0) matrix.add(iEmit, iEmit, gpi);
  if (iBase >= 0 && iEmit >= 0) {
    matrix.add(iBase, iEmit, -gpi);
    matrix.add(iEmit, iBase, -gpi);
  }

  // Transconductance gm * (Vb - Ve) into collector
  if (iCol >= 0 && iBase >= 0) matrix.add(iCol, iBase, gm);
  if (iCol >= 0 && iEmit >= 0) matrix.add(iCol, iEmit, -gm);
  if (iEmit >= 0 && iBase >= 0) matrix.add(iEmit, iBase, -gm);
  if (iEmit >= 0 && iEmit >= 0) matrix.add(iEmit, iEmit, gm);

  // Equivalent current injections
  if (iBase >= 0) rhs[iBase] = (rhs[iBase] ?? 0) - ieqBase;
  if (iEmit >= 0) rhs[iEmit] = (rhs[iEmit] ?? 0) + ieqBase;
  if (iCol >= 0) rhs[iCol] = (rhs[iCol] ?? 0) - ieqCol;
  if (iEmit >= 0) rhs[iEmit] = (rhs[iEmit] ?? 0) + ieqCol;
}

function stampPrecomputedMosfet(
  matrix: DenseMatrix,
  rhs: Float64Array,
  mos: PrecomputedMosfet,
  currentSol: Float64Array,
): void {
  const { iDrain, iGate, iSource, isPmos, absVth, beta } = mos;

  const vDrain = iDrain >= 0 ? (currentSol[iDrain] ?? 0) : 0;
  const vGate = iGate >= 0 ? (currentSol[iGate] ?? 0) : 0;
  const vSource = iSource >= 0 ? (currentSol[iSource] ?? 0) : 0;

  const vgs = isPmos ? vSource - vGate : vGate - vSource;
  const vds = isPmos ? vSource - vDrain : vDrain - vSource;
  const vov = vgs - absVth;

  let id = 0;
  let gm = 0;
  let gds = 1e-8; // Gmin

  if (vov <= 0) {
    // Cutoff
    id = 0;
    gm = 0;
  } else if (vds < vov) {
    // Linear (triode) region
    id = beta * (vov * vds - 0.5 * vds * vds);
    gm = beta * vds;
    gds += beta * (vov - vds);
  } else {
    // Saturation region
    id = 0.5 * beta * vov * vov;
    gm = beta * vov;
  }

  const ieq = id - gm * vgs - gds * vds;

  // Stamp gds between Drain and Source
  if (iDrain >= 0) matrix.add(iDrain, iDrain, gds);
  if (iSource >= 0) matrix.add(iSource, iSource, gds);
  if (iDrain >= 0 && iSource >= 0) {
    matrix.add(iDrain, iSource, -gds);
    matrix.add(iSource, iDrain, -gds);
  }

  // Stamp gm * (Vg - Vs)
  if (iDrain >= 0 && iGate >= 0) matrix.add(iDrain, iGate, gm);
  if (iDrain >= 0 && iSource >= 0) matrix.add(iDrain, iSource, -gm);
  if (iSource >= 0 && iGate >= 0) matrix.add(iSource, iGate, -gm);
  if (iSource >= 0 && iSource >= 0) matrix.add(iSource, iSource, gm);

  // Stamp ieq
  if (iDrain >= 0) rhs[iDrain] = (rhs[iDrain] ?? 0) - ieq;
  if (iSource >= 0) rhs[iSource] = (rhs[iSource] ?? 0) + ieq;
}

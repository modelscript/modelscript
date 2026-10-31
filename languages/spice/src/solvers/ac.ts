// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — Small-Signal AC Frequency Response (.AC) Solver.
 *
 * Computes frequency response (magnitude, dB, phase) across DEC/OCT/LIN
 * frequency sweeps using augmented complex Modified Nodal Analysis:
 *   [ G   -B ] [ V_r ] = [ I_r ]
 *   [ B    G ] [ V_i ]   [ I_i ]
 * where G is conductance and B is susceptance (omega * C - 1 / (omega * L)).
 */

import { parseSpiceNumber } from "../parser/spice-parser.js";
import type { AcOptions, AcResult, AcSignal, SpiceCircuit, SpiceComponent } from "../types.js";
import { DenseMatrix, buildMnaIndexing, flattenSpiceCircuit, solveLinearSystem, type MnaIndexing } from "./mna.js";
import {
  extractPrecomputedNonlinearDevices,
  findBranchIndex,
  solveOp,
  stampPrecomputedBjt,
  stampPrecomputedDiode,
  stampPrecomputedMosfet,
} from "./op.js";

interface AcInductorEntry {
  comp: SpiceComponent;
  L: number;
  gammaSelf: number;
  couplings: { otherIdx: number; gammaMutual: number }[];
}

export function solveAc(circuit: SpiceCircuit, options?: Partial<AcOptions>): AcResult {
  const components = flattenSpiceCircuit(circuit);
  const indexing = buildMnaIndexing(components);

  // Extract .AC directive parameters if not passed directly
  let variation: "DEC" | "OCT" | "LIN" = options?.variation ?? "DEC";
  let points = options?.points;
  let fstart = options?.fstart;
  let fstop = options?.fstop;

  if (points === undefined || fstart === undefined || fstop === undefined) {
    for (const dir of circuit.directives) {
      if (dir.kind === ".AC" && dir.args.length >= 4) {
        const v = dir.args[0]?.toUpperCase();
        if (v === "DEC" || v === "OCT" || v === "LIN") variation = v;
        if (points === undefined && dir.args[1] !== undefined) points = parseInt(dir.args[1], 10);
        if (fstart === undefined && dir.args[2] !== undefined) fstart = parseSpiceNumber(dir.args[2]);
        if (fstop === undefined && dir.args[3] !== undefined) fstop = parseSpiceNumber(dir.args[3]);
        break;
      }
    }
  }

  const nPoints = points ?? 10;
  const fStart = fstart ?? 10;
  const fStop = fstop ?? 1e6;

  // Generate frequency sweep points
  const frequencies = generateFrequencyPoints(variation, nPoints, fStart, fStop);

  const n = indexing.totalSize;
  const augSize = 2 * n; // Augmented real matrix for [G -B; B G]
  const matrix = new DenseMatrix(augSize);
  const rhs = new Float64Array(augSize);

  // Initialize signals for nodes and branches
  const nodeVoltages = new Map<string, AcSignal>();
  nodeVoltages.set("0", createEmptyAcSignal(frequencies.length));
  for (const node of indexing.idxToNode) {
    nodeVoltages.set(node, createEmptyAcSignal(frequencies.length));
  }

  const branchCurrents = new Map<string, AcSignal>();
  for (const branch of indexing.branchToIdx.keys()) {
    branchCurrents.set(branch, createEmptyAcSignal(frequencies.length));
  }

  const baseMatrix = new DenseMatrix(augSize);
  const baseRhs = new Float64Array(augSize);

  const addG_base = (r: number, c: number, val: number) => {
    baseMatrix.add(r, c, val);
    baseMatrix.add(n + r, n + c, val);
  };

  // 1. Pre-stamp Resistors (Pure Real Conductance) and Controlled Sources (E, G, F, H)
  for (const comp of components) {
    const n1 = comp.nodes[0] ?? "";
    const n2 = comp.nodes[1] ?? "";
    if (comp.kind === "R") {
      const rVal = comp.value ?? 1e3;
      const g = rVal > 0 ? 1.0 / rVal : 1e12;
      stampTwoTerminal(indexing, n1, n2, g, addG_base);
    } else if (comp.kind === "E" && comp.controlNodes) {
      const bIdx = indexing.branchToIdx.get(comp.name);
      if (bIdx !== undefined) {
        const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
        const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;
        const c1 = indexing.nodeToIdx.get(comp.controlNodes[0]?.toUpperCase() ?? "") ?? -1;
        const c2 = indexing.nodeToIdx.get(comp.controlNodes[1]?.toUpperCase() ?? "") ?? -1;
        const gain = comp.gain ?? comp.value ?? 1.0;
        if (i1 >= 0) {
          addG_base(i1, bIdx, 1.0);
          addG_base(bIdx, i1, 1.0);
        }
        if (i2 >= 0) {
          addG_base(i2, bIdx, -1.0);
          addG_base(bIdx, i2, -1.0);
        }
        if (c1 >= 0) addG_base(bIdx, c1, -gain);
        if (c2 >= 0) addG_base(bIdx, c2, gain);
      }
    } else if (comp.kind === "G" && comp.controlNodes) {
      const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
      const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;
      const c1 = indexing.nodeToIdx.get(comp.controlNodes[0]?.toUpperCase() ?? "") ?? -1;
      const c2 = indexing.nodeToIdx.get(comp.controlNodes[1]?.toUpperCase() ?? "") ?? -1;
      const gm = comp.gain ?? comp.value ?? 1e-3;
      if (i1 >= 0 && c1 >= 0) addG_base(i1, c1, gm);
      if (i1 >= 0 && c2 >= 0) addG_base(i1, c2, -gm);
      if (i2 >= 0 && c1 >= 0) addG_base(i2, c1, -gm);
      if (i2 >= 0 && c2 >= 0) addG_base(i2, c2, gm);
    } else if (comp.kind === "F" && comp.controlSource) {
      const cBranchIdx = findBranchIndex(indexing.branchToIdx, comp.controlSource);
      if (cBranchIdx !== undefined) {
        const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
        const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;
        const gain = comp.gain ?? comp.value ?? 1.0;
        if (i1 >= 0) addG_base(i1, cBranchIdx, gain);
        if (i2 >= 0) addG_base(i2, cBranchIdx, -gain);
      }
    } else if (comp.kind === "H" && comp.controlSource) {
      const bIdx = indexing.branchToIdx.get(comp.name);
      const cBranchIdx = findBranchIndex(indexing.branchToIdx, comp.controlSource);
      if (bIdx !== undefined) {
        const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
        const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;
        const gain = comp.gain ?? comp.value ?? 1.0;
        if (i1 >= 0) {
          addG_base(i1, bIdx, 1.0);
          addG_base(bIdx, i1, 1.0);
        }
        if (i2 >= 0) {
          addG_base(i2, bIdx, -1.0);
          addG_base(bIdx, i2, -1.0);
        }
        if (cBranchIdx !== undefined) {
          addG_base(bIdx, cBranchIdx, -gain);
        }
      }
    }
  }

  // 1b. Linearize Nonlinear Devices (D, Q, M) around DC Operating Point (.OP)
  const nlDevices = extractPrecomputedNonlinearDevices(components, circuit, indexing);
  if (nlDevices.hasNonlinear) {
    const op = solveOp(circuit);
    const opSol = new Float64Array(n);
    for (let i = 0; i < indexing.idxToNode.length; i++) {
      const node = indexing.idxToNode[i];
      if (node !== undefined) {
        opSol[i] = op.nodeVoltages.get(node) ?? 0;
      }
    }
    for (const [branch, bIdx] of indexing.branchToIdx) {
      opSol[bIdx] = op.branchCurrents.get(branch) ?? 0;
    }

    const smallSignalG = new DenseMatrix(n);
    const dummyRhs = new Float64Array(n);
    for (const diode of nlDevices.diodes) {
      stampPrecomputedDiode(smallSignalG, dummyRhs, diode, opSol);
    }
    for (const bjt of nlDevices.bjts) {
      stampPrecomputedBjt(smallSignalG, dummyRhs, bjt, opSol);
    }
    for (const mosfet of nlDevices.mosfets) {
      stampPrecomputedMosfet(smallSignalG, dummyRhs, mosfet, opSol);
    }

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const gVal = smallSignalG.get(r, c);
        if (gVal !== 0) {
          addG_base(r, c, gVal);
        }
      }
    }
  }

  // 2. Pre-stamp AC Independent Sources
  for (const comp of components) {
    const n1 = comp.nodes[0] ?? "";
    const n2 = comp.nodes[1] ?? "";

    if (comp.kind === "V") {
      const acMag = comp.sourceSpec?.acMag ?? (comp.sourceSpec?.dc !== undefined ? 0 : (comp.value ?? 0));
      const acPhaseDeg = comp.sourceSpec?.acPhase ?? 0;
      const phaseRad = (acPhaseDeg * Math.PI) / 180.0;
      const realVal = acMag * Math.cos(phaseRad);
      const imagVal = acMag * Math.sin(phaseRad);

      const bIdx = indexing.branchToIdx.get(comp.name);
      if (bIdx !== undefined) {
        const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
        const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;

        if (i1 >= 0) {
          addG_base(i1, bIdx, 1.0);
          addG_base(bIdx, i1, 1.0);
        }
        if (i2 >= 0) {
          addG_base(i2, bIdx, -1.0);
          addG_base(bIdx, i2, -1.0);
        }

        baseRhs[bIdx] = realVal;
        baseRhs[n + bIdx] = imagVal;
      }
    } else if (comp.kind === "I") {
      const acMag = comp.sourceSpec?.acMag ?? 0;
      const acPhaseDeg = comp.sourceSpec?.acPhase ?? 0;
      const phaseRad = (acPhaseDeg * Math.PI) / 180.0;
      const realVal = acMag * Math.cos(phaseRad);
      const imagVal = acMag * Math.sin(phaseRad);

      const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
      const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;

      if (i1 >= 0) {
        baseRhs[i1] = (baseRhs[i1] ?? 0) - realVal;
        baseRhs[n + i1] = (baseRhs[n + i1] ?? 0) - imagVal;
      }
      if (i2 >= 0) {
        baseRhs[i2] = (baseRhs[i2] ?? 0) + realVal;
        baseRhs[n + i2] = (baseRhs[n + i2] ?? 0) + imagVal;
      }
    }
  }

  // Pre-filter reactive components and coupled inductors (K)
  const capComponents = components.filter((c) => c.kind === "C");
  const indEntries: AcInductorEntry[] = [];
  const indNameToIdx = new Map<string, number>();

  for (const comp of components) {
    if (comp.kind === "L") {
      const lVal = comp.value ?? 1e-6;
      const idx = indEntries.length;
      indEntries.push({
        comp,
        L: lVal,
        gammaSelf: lVal > 0 ? 1.0 / lVal : 1e12,
        couplings: [],
      });
      indNameToIdx.set(comp.name.toUpperCase(), idx);
    }
  }

  for (const comp of components) {
    if (comp.kind === "K") {
      const l1Name = (comp.inductor1 ?? comp.nodes[0] ?? "").toUpperCase();
      const l2Name = (comp.inductor2 ?? comp.nodes[1] ?? "").toUpperCase();
      const idx1 = indNameToIdx.get(l1Name);
      const idx2 = indNameToIdx.get(l2Name);
      if (idx1 !== undefined && idx2 !== undefined && idx1 !== idx2) {
        const e1 = indEntries[idx1];
        const e2 = indEntries[idx2];
        if (!e1 || !e2) continue;
        const rawK = comp.couplingFactor ?? comp.value ?? 0.999;
        const kSign = rawK < 0 ? -1 : 1;
        const kEff = kSign * Math.min(0.9999, Math.abs(rawK));
        const M = kEff * Math.sqrt(e1.L * e2.L);
        const det = e1.L * e2.L - M * M;
        if (det > 1e-30) {
          e1.gammaSelf = e2.L / det;
          e2.gammaSelf = e1.L / det;
          const gammaMut = -M / det;
          e1.couplings.push({ otherIdx: idx2, gammaMutual: gammaMut });
          e2.couplings.push({ otherIdx: idx1, gammaMutual: gammaMut });
        }
      }
    }
  }

  // Frequency Sweep Loop
  for (let fIdx = 0; fIdx < frequencies.length; fIdx++) {
    const freq = frequencies[fIdx] ?? 1.0;
    const omega = 2.0 * Math.PI * freq;

    matrix.data.set(baseMatrix.data);
    rhs.set(baseRhs);

    // Helpers to stamp susceptance B: +B into bottom-left, -B into top-right
    // [ G   -B ]
    // [ B    G ]
    const addB = (r: number, c: number, val: number) => {
      matrix.add(n + r, c, val);
      matrix.add(r, n + c, -val);
    };

    // 1. Stamp Capacitors (Susceptance B = omega * C)
    for (const comp of capComponents) {
      const n1 = comp.nodes[0] ?? "";
      const n2 = comp.nodes[1] ?? "";
      const cVal = comp.value ?? 1e-9;
      const b = omega * cVal;
      stampTwoTerminal(indexing, n1, n2, b, addB);
    }

    // 2. Stamp Inductors & Coupled Inductors (Susceptance B = -Gamma / omega)
    for (const entry of indEntries) {
      const n1 = entry.comp.nodes[0] ?? "";
      const n2 = entry.comp.nodes[1] ?? "";
      const bSelf = -entry.gammaSelf / omega;
      stampTwoTerminal(indexing, n1, n2, bSelf, addB);

      const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
      const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;
      for (const cpl of entry.couplings) {
        const other = indEntries[cpl.otherIdx];
        if (!other) continue;
        const c1 = indexing.nodeToIdx.get((other.comp.nodes[0] ?? "").toUpperCase()) ?? -1;
        const c2 = indexing.nodeToIdx.get((other.comp.nodes[1] ?? "").toUpperCase()) ?? -1;
        const bMut = -cpl.gammaMutual / omega;
        if (i1 >= 0 && c1 >= 0) addB(i1, c1, bMut);
        if (i1 >= 0 && c2 >= 0) addB(i1, c2, -bMut);
        if (i2 >= 0 && c1 >= 0) addB(i2, c1, -bMut);
        if (i2 >= 0 && c2 >= 0) addB(i2, c2, bMut);
      }
    }

    // Solve augmented linear system
    const sol = solveLinearSystem(matrix, rhs);
    if (!sol) continue;

    // Record AC response for this frequency
    for (let i = 0; i < indexing.idxToNode.length; i++) {
      const node = indexing.idxToNode[i];
      if (node === undefined) continue;

      const r = sol[i] ?? 0;
      const im = sol[n + i] ?? 0;
      const mag = Math.sqrt(r * r + im * im);
      const magDb = mag > 1e-20 ? 20.0 * Math.log10(mag) : -400.0;
      const ph = (Math.atan2(im, r) * 180.0) / Math.PI;

      const sig = nodeVoltages.get(node);
      if (sig) {
        sig.real[fIdx] = r;
        sig.imag[fIdx] = im;
        sig.magnitude[fIdx] = mag;
        sig.magnitudeDb[fIdx] = magDb;
        sig.phaseDeg[fIdx] = ph;
      }
    }

    for (const [branch, bIdx] of indexing.branchToIdx) {
      const r = sol[bIdx] ?? 0;
      const im = sol[n + bIdx] ?? 0;
      const mag = Math.sqrt(r * r + im * im);
      const magDb = mag > 1e-20 ? 20.0 * Math.log10(mag) : -400.0;
      const ph = (Math.atan2(im, r) * 180.0) / Math.PI;

      const sig = branchCurrents.get(branch);
      if (sig) {
        sig.real[fIdx] = r;
        sig.imag[fIdx] = im;
        sig.magnitude[fIdx] = mag;
        sig.magnitudeDb[fIdx] = magDb;
        sig.phaseDeg[fIdx] = ph;
      }
    }
  }

  return {
    frequency: frequencies,
    nodeVoltages,
    branchCurrents,
  };
}

function stampTwoTerminal(
  indexing: MnaIndexing,
  n1: string,
  n2: string,
  val: number,
  addFn: (r: number, c: number, v: number) => void,
): void {
  const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
  const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;

  if (i1 >= 0) addFn(i1, i1, val);
  if (i2 >= 0) addFn(i2, i2, val);
  if (i1 >= 0 && i2 >= 0) {
    addFn(i1, i2, -val);
    addFn(i2, i1, -val);
  }
}

function generateFrequencyPoints(
  variation: "DEC" | "OCT" | "LIN",
  nPoints: number,
  fStart: number,
  fStop: number,
): number[] {
  const pts: number[] = [];

  if (variation === "DEC") {
    const decades = Math.log10(fStop / fStart);
    const totalPoints = Math.round(decades * nPoints) + 1;
    for (let i = 0; i < totalPoints; i++) {
      const f = fStart * Math.pow(10, i / nPoints);
      if (f <= fStop * 1.0001) pts.push(f);
    }
  } else if (variation === "OCT") {
    const octaves = Math.log2(fStop / fStart);
    const totalPoints = Math.round(octaves * nPoints) + 1;
    for (let i = 0; i < totalPoints; i++) {
      const f = fStart * Math.pow(2, i / nPoints);
      if (f <= fStop * 1.0001) pts.push(f);
    }
  } else {
    // LIN
    const step = (fStop - fStart) / Math.max(1, nPoints - 1);
    for (let i = 0; i < nPoints; i++) {
      pts.push(fStart + i * step);
    }
  }

  return pts;
}

function createEmptyAcSignal(len: number): AcSignal {
  return {
    magnitude: new Array(len).fill(0),
    magnitudeDb: new Array(len).fill(0),
    phaseDeg: new Array(len).fill(0),
    real: new Array(len).fill(0),
    imag: new Array(len).fill(0),
  };
}

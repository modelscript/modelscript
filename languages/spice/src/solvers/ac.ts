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
import type { AcOptions, AcResult, AcSignal, SpiceCircuit } from "../types.js";
import { DenseMatrix, buildMnaIndexing, flattenSpiceCircuit, solveLinearSystem, type MnaIndexing } from "./mna.js";

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

  // Frequency Sweep Loop
  for (let fIdx = 0; fIdx < frequencies.length; fIdx++) {
    const freq = frequencies[fIdx] ?? 1.0;
    const omega = 2.0 * Math.PI * freq;

    matrix.clear();
    rhs.fill(0);

    // Helpers to stamp real conductance G into top-left and bottom-right blocks
    const addG = (r: number, c: number, val: number) => {
      matrix.add(r, c, val);
      matrix.add(n + r, n + c, val);
    };

    // Helpers to stamp susceptance B: +B into bottom-left, -B into top-right
    // [ G   -B ]
    // [ B    G ]
    const addB = (r: number, c: number, val: number) => {
      matrix.add(n + r, c, val);
      matrix.add(r, n + c, -val);
    };

    // 1. Stamp Resistors (Pure Real Conductance)
    for (const comp of components) {
      const n1 = comp.nodes[0] ?? "";
      const n2 = comp.nodes[1] ?? "";

      if (comp.kind === "R") {
        const rVal = comp.value ?? 1e3;
        const g = rVal > 0 ? 1.0 / rVal : 1e12;
        stampTwoTerminal(indexing, n1, n2, g, addG);
      }
    }

    // 2. Stamp Capacitors (Susceptance B = omega * C)
    for (const comp of components) {
      const n1 = comp.nodes[0] ?? "";
      const n2 = comp.nodes[1] ?? "";

      if (comp.kind === "C") {
        const cVal = comp.value ?? 1e-9;
        const b = omega * cVal;
        stampTwoTerminal(indexing, n1, n2, b, addB);
      }
    }

    // 3. Stamp Inductors (Susceptance B = -1 / (omega * L))
    for (const comp of components) {
      const n1 = comp.nodes[0] ?? "";
      const n2 = comp.nodes[1] ?? "";

      if (comp.kind === "L") {
        const lVal = comp.value ?? 1e-6;
        const b = lVal > 0 ? -1.0 / (omega * lVal) : -1e12;
        stampTwoTerminal(indexing, n1, n2, b, addB);
      }
    }

    // 4. Stamp AC Sources
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
            addG(i1, bIdx, 1.0);
            addG(bIdx, i1, 1.0);
          }
          if (i2 >= 0) {
            addG(i2, bIdx, -1.0);
            addG(bIdx, i2, -1.0);
          }

          rhs[bIdx] = realVal;
          rhs[n + bIdx] = imagVal;
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
          rhs[i1] = (rhs[i1] ?? 0) - realVal;
          rhs[n + i1] = (rhs[n + i1] ?? 0) - imagVal;
        }
        if (i2 >= 0) {
          rhs[i2] = (rhs[i2] ?? 0) + realVal;
          rhs[n + i2] = (rhs[n + i2] ?? 0) + imagVal;
        }
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

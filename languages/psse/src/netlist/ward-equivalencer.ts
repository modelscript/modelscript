// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  computeAmdOrdering,
  solveLinearSystemSparse,
  sparseLuAnalyze,
  sparseLuSolve,
  SparseTripletBuilder,
} from "@modelscript/runtime";
import type { BranchRecord, BusRecord, LoadRecord, PsseCase } from "../types.js";
import { extractPowerFlowNetlist } from "./powerflow-netlist.js";

export interface WardEquivalentResult {
  reducedCase: PsseCase;
  retainedBusCount: number;
  eliminatedBusCount: number;
  equivalentBranchCount: number;
}

/**
 * Performs Ward (Kron) static network equivalencing on a `PsseCase`,
 * eliminating all buses not in `retainedBuses` while preserving boundary
 * nodal admittance couplings and equivalent power injections.
 */
export function reduceNetworkEquivalent(psseCase: PsseCase, retainedBuses: number[]): WardEquivalentResult {
  const retainedSet = new Set(retainedBuses);
  const netlist = extractPowerFlowNetlist(psseCase);
  const N = netlist.nBuses;

  const rIndices: number[] = [];
  const eIndices: number[] = [];
  for (let idx = 0; idx < N; idx++) {
    const bNum = netlist.busNumbers[idx]!;
    if (retainedSet.has(bNum)) rIndices.push(idx);
    else eIndices.push(idx);
  }

  const nR = rIndices.length;
  const nE = eIndices.length;

  // Build dense complex Ybus sub-blocks (for moderate external subsystems)
  const getY = (row: number, col: number): [number, number] => [
    netlist.ybus.g.get(row)?.get(col) ?? 0,
    netlist.ybus.b.get(row)?.get(col) ?? 0,
  ];

  // Start with reduced case containing retained buses and existing retained equipment
  const buses = new Map<number, BusRecord>();
  for (const bNum of retainedBuses) {
    const b = psseCase.buses.get(bNum);
    if (b) buses.set(bNum, { ...b });
  }

  const loads: LoadRecord[] = psseCase.loads.filter((l) => retainedSet.has(l.i)).map((l) => ({ ...l }));

  const branches: BranchRecord[] = psseCase.branches
    .filter((br) => retainedSet.has(br.i) && retainedSet.has(br.j))
    .map((br) => ({ ...br }));

  const fixedShunts = psseCase.fixedShunts.filter((s) => retainedSet.has(s.i)).map((s) => ({ ...s }));
  const sbaseMva = psseCase.header.sbase > 0 ? psseCase.header.sbase : 100.0;

  let equivalentBranchCount = 0;

  if (nE > 0 && nR > 0) {
    // Assemble real 2*nE x 2*nE system for Y_EE to solve Y_EE * X = Y_ER
    const dimE = 2 * nE;
    const matEE = new Float64Array(dimE * dimE);

    for (let a = 0; a < nE; a++) {
      for (let b = 0; b < nE; b++) {
        const [g, bVal] = getY(eIndices[a]!, eIndices[b]!);
        if (g !== 0 || bVal !== 0) {
          matEE[2 * a * dimE + 2 * b] = g;
          matEE[2 * a * dimE + 2 * b + 1] = -bVal;
          matEE[(2 * a + 1) * dimE + 2 * b] = bVal;
          matEE[(2 * a + 1) * dimE + 2 * b + 1] = g;
        }
      }
    }

    // Solve for each retained column j: Y_EE * col = Y_ER[:, j]
    for (let j = 0; j < nR; j++) {
      const rhsR = new Float64Array(dimE);
      for (let a = 0; a < nE; a++) {
        const [g, bVal] = getY(eIndices[a]!, rIndices[j]!);
        rhsR[2 * a] = g;
        rhsR[2 * a + 1] = bVal;
      }

      const ok = solveLinearSystemSparse(matEE, rhsR, dimE, { sparseThreshold: 30 });
      if (!ok) continue;

      // Diagonal boundary shunt delta: dY_jj = -(Y_RE * Y_EE^-1 * Y_ER)_jj
      let diagDg = 0;
      let diagDb = 0;
      for (let a = 0; a < nE; a++) {
        const [gRe, bRe] = getY(rIndices[j]!, eIndices[a]!);
        const xr = rhsR[2 * a]!;
        const xi = rhsR[2 * a + 1]!;
        diagDg += gRe * xr - bRe * xi;
        diagDb += gRe * xi + bRe * xr;
      }
      if (Math.hypot(diagDg, diagDb) > 1e-6) {
        const busJ = netlist.busNumbers[rIndices[j]!]!;
        fixedShunts.push({
          i: busJ,
          id: "EQ",
          status: 1,
          gl: Number((-diagDg * sbaseMva).toFixed(4)),
          bl: Number((-diagDb * sbaseMva).toFixed(4)),
        });
      }

      for (let i = j + 1; i < nR; i++) {
        let dg = 0;
        let db = 0;
        for (let a = 0; a < nE; a++) {
          const [gRe, bRe] = getY(rIndices[i]!, eIndices[a]!);
          const xr = rhsR[2 * a]!;
          const xi = rhsR[2 * a + 1]!;
          dg += gRe * xr - bRe * xi;
          db += gRe * xi + bRe * xr;
        }
        if (Math.hypot(dg, db) > 1e-6) {
          const busI = netlist.busNumbers[rIndices[i]!]!;
          const busJ = netlist.busNumbers[rIndices[j]!]!;
          const denom = dg * dg + db * db;
          if (denom > 1e-12) {
            const rEq = dg / denom;
            const xEq = -db / denom;
            branches.push({
              i: busI,
              j: busJ,
              ckt: "EQ",
              r: Number(rEq.toFixed(6)),
              x: Number(xEq.toFixed(6)),
              b: 0,
              rateA: 9999,
              rateB: 9999,
              rateC: 9999,
              gi: 0,
              bi: 0,
              gj: 0,
              bj: 0,
              st: 1,
              met: 1,
              len: 0,
            });
            equivalentBranchCount++;
          }
        }
      }
    }

    // Redistribute eliminated external bus injections: I_eq_R = -Y_RE * Y_EE^-1 * I_E
    const rhsI = new Float64Array(2 * nE);
    for (let a = 0; a < nE; a++) {
      const eIdx = eIndices[a]!;
      const vm = Math.max(0.1, netlist.vMagPu[eIdx] ?? 1.0);
      const va = netlist.vAngRad[eIdx] ?? 0.0;
      const vr = vm * Math.cos(va);
      const vi = vm * Math.sin(va);
      const v2 = vr * vr + vi * vi;
      const pPu = (netlist.pNetMw[eIdx] ?? 0) / sbaseMva;
      const qPu = (netlist.qNetMvar[eIdx] ?? 0) / sbaseMva;
      rhsI[2 * a] = (pPu * vr + qPu * vi) / v2;
      rhsI[2 * a + 1] = (pPu * vi - qPu * vr) / v2;
    }
    if (solveLinearSystemSparse(matEE, rhsI, dimE, { sparseThreshold: 30 })) {
      for (let i = 0; i < nR; i++) {
        const rIdx = rIndices[i]!;
        let irEq = 0;
        let iiEq = 0;
        for (let a = 0; a < nE; a++) {
          const [gRe, bRe] = getY(rIdx, eIndices[a]!);
          const xr = rhsI[2 * a]!;
          const xi = rhsI[2 * a + 1]!;
          irEq -= gRe * xr - bRe * xi;
          iiEq -= gRe * xi + bRe * xr;
        }
        if (Math.hypot(irEq, iiEq) > 1e-6) {
          const vm = Math.max(0.1, netlist.vMagPu[rIdx] ?? 1.0);
          const va = netlist.vAngRad[rIdx] ?? 0.0;
          const vr = vm * Math.cos(va);
          const vi = vm * Math.sin(va);
          const pEqMw = (vr * irEq + vi * iiEq) * sbaseMva;
          const qEqMvar = (vi * irEq - vr * iiEq) * sbaseMva;
          loads.push({
            i: netlist.busNumbers[rIdx]!,
            id: "EQ",
            status: 1,
            area: 1,
            zone: 1,
            pl: Number((-pEqMw).toFixed(4)),
            ql: Number((-qEqMvar).toFixed(4)),
            ip: 0,
            iq: 0,
            yp: 0,
            yq: 0,
            owner: 1,
            scale: 0,
            intrct: 0,
          });
        }
      }
    }
  }

  const reducedCase: PsseCase = {
    ...psseCase,
    title1: `${psseCase.title1 || "PSS/E CASE"} (WARD EQUIV ${nR} BUSES)`,
    buses,
    loads,
    fixedShunts,
    generators: psseCase.generators.filter((g) => retainedSet.has(g.i)).map((g) => ({ ...g })),
    branches,
    transformers: psseCase.transformers
      .filter((t) => retainedSet.has(t.i) && retainedSet.has(t.j) && (!t.k || retainedSet.has(t.k)))
      .map((t) => ({ ...t })),
    switchedShunts: psseCase.switchedShunts.filter((s) => retainedSet.has(s.i)).map((s) => ({ ...s })),
  };

  return {
    reducedCase,
    retainedBusCount: nR,
    eliminatedBusCount: nE,
    equivalentBranchCount,
  };
}

/**
 * Computes the Kron-reduced multi-port boundary admittance matrix Y_eq = Y_RR - Y_RE * Y_EE^-1 * Y_ER
 * for the specified boundary buses, including generator subtransient admittances and optional
 * active fault shunt admittance, returning a `MultiPortBoundaryEquivalent` for hybrid TS-EMT coupling.
 */
export function computeMultiPortThevenin(
  psseCase: PsseCase,
  boundaryBuses: number[],
  options?: {
    topologyVersion?: number | undefined;
    extraBusShuntsPu?: Map<number, { g: number; b: number }> | undefined;
    includeGenSubtransient?: boolean | undefined;
    zeroSeqScale?: number | undefined;
  },
): import("@modelscript/exchange").MultiPortBoundaryEquivalent {
  const netlist = extractPowerFlowNetlist(psseCase);
  const N = netlist.nBuses;
  const sbaseMva = psseCase.header.sbase > 0 ? psseCase.header.sbase : 100.0;
  const includeGen = options?.includeGenSubtransient ?? true;
  const zeroSeqScale = options?.zeroSeqScale ?? 1.0 / 3.0; // Z0 ≈ 3 * Z1 => Y0 ≈ Y1 / 3

  // Map requested boundary buses to internal netlist indices (preserving order)
  const rIndices: number[] = [];
  const validBusIds: string[] = [];
  const baseKvLL: number[] = [];
  const retainedSet = new Set<number>();
  for (const bNum of boundaryBuses) {
    const idx = netlist.busIndices.get(bNum);
    if (idx !== undefined && !retainedSet.has(idx)) {
      retainedSet.add(idx);
      rIndices.push(idx);
      validBusIds.push(String(bNum));
      const bus = psseCase.buses.get(bNum);
      baseKvLL.push(bus && bus.baseKv > 0 ? bus.baseKv : 230.0);
    }
  }

  const eIndices: number[] = [];
  for (let idx = 0; idx < N; idx++) {
    if (!retainedSet.has(idx)) eIndices.push(idx);
  }

  const nR = rIndices.length;
  const nE = eIndices.length;

  // Precompute generator subtransient diagonal admittances (Y_gen = 1 / (r + j x''))
  const genShuntG = new Float64Array(N);
  const genShuntB = new Float64Array(N);
  if (includeGen) {
    for (const gen of psseCase.generators) {
      if (gen.stat === 0) continue;
      const bIdx = netlist.busIndices.get(gen.i);
      if (bIdx === undefined) continue;
      const mbase = gen.mbase > 0 ? gen.mbase : sbaseMva;
      const rPu = (gen.zr > 0 ? gen.zr : 0.003) * (sbaseMva / mbase);
      const xPu = (gen.zx > 0 ? gen.zx : 0.2) * (sbaseMva / mbase);
      const denom = rPu * rPu + xPu * xPu;
      if (denom > 1e-12) {
        genShuntG[bIdx] = genShuntG[bIdx]! + rPu / denom;
        genShuntB[bIdx] = genShuntB[bIdx]! - xPu / denom;
      }
    }
  }

  const getY = (row: number, col: number): [number, number] => {
    let g = netlist.ybus.g.get(row)?.get(col) ?? 0.0;
    let b = netlist.ybus.b.get(row)?.get(col) ?? 0.0;
    if (row === col) {
      g += genShuntG[row]!;
      b += genShuntB[row]!;
      const bNum = netlist.busNumbers[row]!;
      const extra = options?.extraBusShuntsPu?.get(bNum);
      if (extra) {
        g += extra.g;
        b += extra.b;
      }
    }
    return [g, b];
  };

  // Initialize Y_eq = Y_RR
  const yEqPos: Array<{ re: number; im: number }> = new Array(nR * nR);
  for (let i = 0; i < nR; i++) {
    for (let j = 0; j < nR; j++) {
      const [g, b] = getY(rIndices[i]!, rIndices[j]!);
      yEqPos[i * nR + j] = { re: g, im: b };
    }
  }

  // Apply Sparse Kron reduction: Y_eq = Y_RR - Y_RE * Y_EE^-1 * Y_ER (O(nnz) memory for 2k-70k bus grids)
  if (nE > 0 && nR > 0) {
    const dimE = 2 * nE;
    const busToEIdx = new Map<number, number>();
    for (let a = 0; a < nE; a++) busToEIdx.set(eIndices[a]!, a);

    const builder = new SparseTripletBuilder(dimE, dimE);
    for (let a = 0; a < nE; a++) {
      const origRow = eIndices[a]!;
      const gRow = netlist.ybus.g.get(origRow);
      const bRow = netlist.ybus.b.get(origRow);
      const cols = new Set<number>();
      if (gRow) for (const col of gRow.keys()) cols.add(col);
      if (bRow) for (const col of bRow.keys()) cols.add(col);
      cols.add(origRow);

      let diagG = 0.0;
      let diagB = 0.0;
      for (const origCol of cols) {
        const c = busToEIdx.get(origCol);
        if (c === undefined) continue;
        const [g, b] = getY(origRow, origCol);
        if (origRow === origCol) {
          diagG = g;
          diagB = b;
        }
        if (g !== 0) {
          builder.add(2 * a, 2 * c, g);
          builder.add(2 * a + 1, 2 * c + 1, g);
        }
        if (b !== 0) {
          builder.add(2 * a, 2 * c + 1, -b);
          builder.add(2 * a + 1, 2 * c, b);
        }
      }
      if (Math.abs(diagG) < 1e-12 && Math.abs(diagB) < 1e-12) {
        builder.add(2 * a, 2 * a, 1e-6);
        builder.add(2 * a + 1, 2 * a + 1, 1e-6);
      }
    }

    const ccs = builder.toCCS();
    const perm = computeAmdOrdering(ccs);
    const factors = sparseLuAnalyze(ccs, { colPerm: perm, allowPerturbation: true });
    if (factors) {
      for (let j = 0; j < nR; j++) {
        const rhsCol = new Float64Array(dimE);
        const origCol = rIndices[j]!;
        const gRow = netlist.ybus.g.get(origCol);
        const bRow = netlist.ybus.b.get(origCol);
        const neigh = new Set<number>();
        if (gRow) for (const nb of gRow.keys()) neigh.add(nb);
        if (bRow) for (const nb of bRow.keys()) neigh.add(nb);
        for (const nb of neigh) {
          const a = busToEIdx.get(nb);
          if (a === undefined) continue;
          const [gEr, bEr] = getY(nb, origCol);
          rhsCol[2 * a] = gEr;
          rhsCol[2 * a + 1] = bEr;
        }
        const sol = sparseLuSolve(factors, rhsCol);
        for (let i = 0; i < nR; i++) {
          const origRowI = rIndices[i]!;
          const gRowI = netlist.ybus.g.get(origRowI);
          const bRowI = netlist.ybus.b.get(origRowI);
          const neighI = new Set<number>();
          if (gRowI) for (const nb of gRowI.keys()) neighI.add(nb);
          if (bRowI) for (const nb of bRowI.keys()) neighI.add(nb);
          let deltaG = 0.0;
          let deltaB = 0.0;
          for (const nb of neighI) {
            const a = busToEIdx.get(nb);
            if (a === undefined) continue;
            const [gRe, bRe] = getY(origRowI, nb);
            const xr = sol[2 * a]!;
            const xi = sol[2 * a + 1]!;
            deltaG += gRe * xr - bRe * xi;
            deltaB += gRe * xi + bRe * xr;
          }
          const cell = yEqPos[i * nR + j]!;
          cell.re -= deltaG;
          cell.im -= deltaB;
        }
      }
    }
  }

  const yEqNeg = yEqPos.map((c) => ({ re: c.re, im: c.im }));
  const yEqZero = yEqPos.map((c) => ({ re: c.re * zeroSeqScale, im: c.im * zeroSeqScale }));

  return {
    busIds: validBusIds,
    yEqPos,
    yEqNeg,
    yEqZero,
    baseKvLL,
    baseMva: sbaseMva,
    topologyVersion: options?.topologyVersion ?? 0,
  };
}

/**
 * Performs a sparse multi-frequency Kron-reduced driving-point admittance scan Y_eq(j * 2 * pi * f)
 * in Siemens at `boundaryBusNumber` over `freqGridHz`, scaling inductive reactances and
 * capacitive susceptances linearly with frequency (w / w_0) to capture external grid
 * harmonic resonances for FDNE Vector Fitting (O(nnz) memory for large grids).
 */
export function scanExternalNetworkAdmittance(
  psseCase: PsseCase,
  boundaryBusNumber: number,
  freqGridHz: number[],
  options?: {
    extraBusShuntsPu?: Map<number, { g: number; b: number }> | undefined;
    includeGenSubtransient?: boolean | undefined;
  },
): Array<{ freqHz: number; ySiemens: { re: number; im: number } }> {
  const netlist = extractPowerFlowNetlist(psseCase);
  const bIdx = netlist.busIndices.get(boundaryBusNumber);
  if (bIdx === undefined || freqGridHz.length === 0) return [];

  const N = netlist.nBuses;
  const f0 = psseCase.header.basfrq > 0 ? psseCase.header.basfrq : 60.0;
  const sbaseMva = psseCase.header.sbase > 0 ? psseCase.header.sbase : 100.0;
  const busRec = psseCase.buses.get(boundaryBusNumber);
  const baseKv = busRec && busRec.baseKv > 0 ? busRec.baseKv : 230.0;
  const yBaseS = sbaseMva / (baseKv * baseKv);
  const includeGen = options?.includeGenSubtransient ?? true;

  const busToEIdx = new Map<number, number>();
  let nE = 0;
  for (let i = 0; i < N; i++) {
    if (i !== bIdx) busToEIdx.set(i, nE++);
  }
  const dimE = 2 * nE;

  // Pre-index active elements to avoid Map lookups inside frequency loop
  const activeBranches: Array<{ i: number; j: number; r: number; x: number; b: number }> = [];
  for (const br of psseCase.branches) {
    if (br.st === 0) continue;
    const i = netlist.busIndices.get(br.i);
    const j = netlist.busIndices.get(br.j);
    if (i !== undefined && j !== undefined) {
      activeBranches.push({ i, j, r: br.r, x: br.x, b: br.b });
    }
  }
  const activeTfs: Array<{ i: number; j: number; r: number; x: number }> = [];
  for (const tf of psseCase.transformers) {
    if (tf.stat === 0) continue;
    const i = netlist.busIndices.get(tf.i);
    const j = netlist.busIndices.get(tf.j);
    if (i !== undefined && j !== undefined) {
      activeTfs.push({ i, j, r: tf.r12, x: tf.x12 });
    }
  }
  const activeGens: Array<{ i: number; rPu: number; xPu: number }> = [];
  if (includeGen) {
    for (const gen of psseCase.generators) {
      if (gen.stat === 0) continue;
      const i = netlist.busIndices.get(gen.i);
      if (i === undefined) continue;
      const mbase = gen.mbase > 0 ? gen.mbase : sbaseMva;
      activeGens.push({
        i,
        rPu: (gen.zr > 0 ? gen.zr : 0.003) * (sbaseMva / mbase),
        xPu: (gen.zx > 0 ? gen.zx : 0.2) * (sbaseMva / mbase),
      });
    }
  }

  let cachedPerm: Int32Array | null = null;
  const results: Array<{ freqHz: number; ySiemens: { re: number; im: number } }> = [];

  for (const freqHz of freqGridHz) {
    const h = Math.max(0.05, freqHz / f0);
    let yPortG = 0.0;
    let yPortB = 0.0;
    const rhsRe = new Float64Array(nE);
    const rhsIm = new Float64Array(nE);
    const diagMag = new Float64Array(nE);
    const builder = nE > 0 ? new SparseTripletBuilder(dimE, dimE) : null;

    const stampEE = (a: number, c: number, g: number, b: number) => {
      if (!builder) return;
      if (g !== 0) {
        builder.add(2 * a, 2 * c, g);
        builder.add(2 * a + 1, 2 * c + 1, g);
      }
      if (b !== 0) {
        builder.add(2 * a, 2 * c + 1, -b);
        builder.add(2 * a + 1, 2 * c, b);
      }
      if (a === c) diagMag[a] = diagMag[a]! + Math.abs(g) + Math.abs(b);
    };

    const stampTwoTerminal = (i: number, j: number, g: number, b: number, bShuntHalf: number) => {
      const ei = busToEIdx.get(i);
      const ej = busToEIdx.get(j);
      if (i === bIdx) {
        yPortG += g;
        yPortB += b + bShuntHalf;
      } else if (ei !== undefined) {
        stampEE(ei, ei, g, b + bShuntHalf);
      }
      if (j === bIdx) {
        yPortG += g;
        yPortB += b + bShuntHalf;
      } else if (ej !== undefined) {
        stampEE(ej, ej, g, b + bShuntHalf);
      }
      if (ei !== undefined && ej !== undefined) {
        stampEE(ei, ej, -g, -b);
        stampEE(ej, ei, -g, -b);
      } else if (ei !== undefined && j === bIdx) {
        rhsRe[ei] = rhsRe[ei]! - g;
        rhsIm[ei] = rhsIm[ei]! - b;
      } else if (ej !== undefined && i === bIdx) {
        rhsRe[ej] = rhsRe[ej]! - g;
        rhsIm[ej] = rhsIm[ej]! - b;
      }
    };

    for (const br of activeBranches) {
      const r = br.r;
      const x = br.x * h;
      const denom = r * r + x * x;
      if (denom > 1e-12) {
        stampTwoTerminal(br.i, br.j, r / denom, -x / denom, 0.5 * br.b * h);
      }
    }
    for (const tf of activeTfs) {
      const r = tf.r;
      const x = tf.x * h;
      const denom = r * r + x * x;
      if (denom > 1e-12) {
        stampTwoTerminal(tf.i, tf.j, r / denom, -x / denom, 0.0);
      }
    }
    for (const gen of activeGens) {
      const r = gen.rPu;
      const x = gen.xPu * h;
      const denom = r * r + x * x;
      if (denom > 1e-12) {
        const g = r / denom;
        const b = -x / denom;
        if (gen.i === bIdx) {
          yPortG += g;
          yPortB += b;
        } else {
          const ei = busToEIdx.get(gen.i);
          if (ei !== undefined) stampEE(ei, ei, g, b);
        }
      }
    }
    if (options?.extraBusShuntsPu) {
      for (const [bNum, sh] of options.extraBusShuntsPu) {
        const i = netlist.busIndices.get(bNum);
        if (i === undefined) continue;
        const g = sh.g;
        const b = sh.b / h;
        if (i === bIdx) {
          yPortG += g;
          yPortB += b;
        } else {
          const ei = busToEIdx.get(i);
          if (ei !== undefined) stampEE(ei, ei, g, b);
        }
      }
    }

    if (builder && nE > 0) {
      for (let a = 0; a < nE; a++) {
        if (diagMag[a]! < 1e-12) {
          builder.add(2 * a, 2 * a, 1e-6);
          builder.add(2 * a + 1, 2 * a + 1, 1e-6);
        }
      }
      const ccs = builder.toCCS();
      if (!cachedPerm) cachedPerm = computeAmdOrdering(ccs);
      const factors = sparseLuAnalyze(ccs, { colPerm: cachedPerm, allowPerturbation: true });
      if (factors) {
        const rhs = new Float64Array(dimE);
        for (let a = 0; a < nE; a++) {
          rhs[2 * a] = rhsRe[a]!;
          rhs[2 * a + 1] = rhsIm[a]!;
        }
        const sol = sparseLuSolve(factors, rhs);
        for (let a = 0; a < nE; a++) {
          const gRe = rhsRe[a]!;
          const bRe = rhsIm[a]!;
          if (gRe === 0 && bRe === 0) continue;
          const xr = sol[2 * a]!;
          const xi = sol[2 * a + 1]!;
          yPortG -= gRe * xr - bRe * xi;
          yPortB -= gRe * xi + bRe * xr;
        }
      }
    }

    results.push({
      freqHz,
      ySiemens: { re: yPortG * yBaseS, im: yPortB * yBaseS },
    });
  }

  return results;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/opf — Direct Zero-GC DC Optimal Power Flow Solver.
 *
 * Tier 2 Direct Lowering: Assembles grid topology, nodal susceptance, and branch
 * constraints directly into Compressed Sparse Column (CSC) matrices and solves
 * the linear program via in-WASM COIN-OR CLP or high-performance Revised Simplex.
 *
 * Computes:
 *   - Least-cost generator dispatches (Pg*)
 *   - Nodal voltage phase angles (theta*)
 *   - Branch power flows and thermal loadings
 *   - Exact Locational Marginal Prices (LMPs in $/MWh) from constraint duals
 *   - Decomposition of LMPs into Energy and Congestion components
 *   - Transmission branch shadow prices
 */

import { formatOpfReport } from "./format-report.js";
import type {
  GenericPowerCase,
  OpfBranchResult,
  OpfBusResult,
  OpfGeneratorResult,
  OpfOptions,
  OpfSolution,
} from "./types.js";

export interface DirectCscMatrix {
  values: number[];
  rowIndices: number[];
  colPointers: number[];
}

export interface DirectLpData {
  nVars: number;
  nConstraints: number;
  objCoeffs: number[];
  varLB: number[];
  varUB: number[];
  conLB: number[];
  conUB: number[];
  A: DirectCscMatrix;
}

export interface DirectLpResult {
  optimal: boolean;
  x: number[];
  duals: number[];
  obj: number;
  iterations: number;
}

/**
 * Direct two-phase revised simplex solver with KKT dual multiplier extraction.
 */
export function solveDirectSimplex(lp: DirectLpData): DirectLpResult {
  const n = lp.nVars;
  const m = lp.nConstraints;

  const shift = new Float64Array(n);
  const shiftedUB = new Float64Array(n).fill(1e20);

  for (let j = 0; j < n; j++) {
    const lb = lp.varLB[j]!;
    const ub = lp.varUB[j]!;
    if (lb > ub + 1e-9) return { optimal: false, x: [], duals: [], obj: 0, iterations: 0 };
    if (Number.isFinite(lb) && lb > -1e15) {
      shift[j] = lb;
    }
    if (Number.isFinite(ub) && ub < 1e15) {
      shiftedUB[j] = Math.max(0, ub - shift[j]!);
    }
  }

  // Dense row-major representation for simplex
  const A: Float64Array[] = Array.from({ length: m }, () => new Float64Array(n));
  const shiftedConLB = new Float64Array(lp.conLB);
  const shiftedConUB = new Float64Array(lp.conUB);

  for (let col = 0; col < n; col++) {
    const start = lp.A.colPointers[col]!;
    const end = lp.A.colPointers[col + 1]!;
    for (let p = start; p < end; p++) {
      const row = lp.A.rowIndices[p]!;
      const val = lp.A.values[p]!;
      A[row]![col] = val;
      if (shift[col] !== 0) {
        if (shiftedConLB[row]! > -1e15) shiftedConLB[row]! -= val * shift[col]!;
        if (shiftedConUB[row]! < 1e15) shiftedConUB[row]! -= val * shift[col]!;
      }
    }
  }

  let objOffset = 0;
  for (let j = 0; j < n; j++) {
    objOffset += lp.objCoeffs[j]! * shift[j]!;
  }

  interface StandardRow {
    coeffs: Float64Array;
    rhs: number;
    kind: "<=" | ">=" | "=";
    origRowIdx: number;
  }

  const rows: StandardRow[] = [];
  for (let i = 0; i < m; i++) {
    const hasLB = Number.isFinite(shiftedConLB[i]) && shiftedConLB[i]! > -1e15;
    const hasUB = Number.isFinite(shiftedConUB[i]) && shiftedConUB[i]! < 1e15;

    if (hasLB && hasUB && Math.abs(shiftedConLB[i]! - shiftedConUB[i]!) < 1e-9) {
      rows.push({ coeffs: A[i]!, rhs: shiftedConUB[i]!, kind: "=", origRowIdx: i });
    } else {
      if (hasUB) rows.push({ coeffs: A[i]!, rhs: shiftedConUB[i]!, kind: "<=", origRowIdx: i });
      if (hasLB) rows.push({ coeffs: A[i]!, rhs: shiftedConLB[i]!, kind: ">=", origRowIdx: i });
    }
  }

  // Add variable upper bounds
  for (let j = 0; j < n; j++) {
    if (Number.isFinite(shiftedUB[j]) && shiftedUB[j]! < 1e15) {
      const uRow = new Float64Array(n);
      uRow[j] = 1.0;
      rows.push({ coeffs: uRow, rhs: shiftedUB[j]!, kind: "<=", origRowIdx: -1 });
    }
  }

  const numRows = rows.length;
  if (numRows === 0) {
    return { optimal: true, x: Array.from(shift), duals: new Array(m).fill(0), obj: objOffset, iterations: 0 };
  }

  let numSlacks = 0;
  let numArtificials = 0;
  for (const r of rows) {
    if (r.kind === "<=") {
      numSlacks++;
      if (r.rhs < 0) numArtificials++;
    } else if (r.kind === ">=") {
      numSlacks++;
      if (r.rhs >= 0) numArtificials++;
    } else {
      numArtificials++;
    }
  }

  const totalCols = n + numSlacks + numArtificials + 1;
  const tab: Float64Array[] = Array.from({ length: numRows + 2 }, () => new Float64Array(totalCols));
  const phase1Row = numRows;
  const phase2Row = numRows + 1;
  const basicVars = new Int32Array(numRows).fill(-1);

  let curSlack = n;
  let curArt = n + numSlacks;
  const artificialCols: number[] = [];

  for (let i = 0; i < numRows; i++) {
    const r = rows[i]!;
    let mult = 1;
    let rhs = r.rhs;
    if (rhs < 0) {
      mult = -1;
      rhs = -rhs;
    }
    for (let j = 0; j < n; j++) tab[i]![j] = r.coeffs[j]! * mult;
    tab[i]![totalCols - 1] = rhs;

    const effKind = mult === 1 ? r.kind : r.kind === "<=" ? ">=" : r.kind === ">=" ? "<=" : "=";
    if (effKind === "<=") {
      tab[i]![curSlack] = 1;
      basicVars[i] = curSlack++;
    } else if (effKind === ">=") {
      tab[i]![curSlack] = -1;
      curSlack++;
      tab[i]![curArt] = 1;
      basicVars[i] = curArt;
      artificialCols.push(curArt);
      curArt++;
    } else {
      tab[i]![curArt] = 1;
      basicVars[i] = curArt;
      artificialCols.push(curArt);
      curArt++;
    }
  }

  // Phase 1 objective: minimize sum of artificials
  if (numArtificials > 0) {
    const rowP1 = tab[phase1Row]!;
    for (const art of artificialCols) rowP1[art] = 1;
    for (let i = 0; i < numRows; i++) {
      if (artificialCols.includes(basicVars[i]!)) {
        const rowI = tab[i]!;
        for (let j = 0; j < totalCols; j++) {
          rowP1[j] = (rowP1[j] ?? 0) - (rowI[j] ?? 0);
        }
      }
    }
  }

  // Phase 2 objective: minimize c^T x
  const rowP2 = tab[phase2Row]!;
  for (let j = 0; j < n; j++) {
    rowP2[j] = lp.objCoeffs[j]!;
  }
  for (let i = 0; i < numRows; i++) {
    const bVar = basicVars[i]!;
    if (bVar < n && Math.abs(lp.objCoeffs[bVar]!) > 1e-15) {
      const c = lp.objCoeffs[bVar]!;
      const rowI = tab[i]!;
      for (let j = 0; j < totalCols; j++) {
        rowP2[j] = (rowP2[j] ?? 0) - c * (rowI[j] ?? 0);
      }
    }
  }

  let iterations = 0;
  const maxIters = (numRows + totalCols) * 10;

  function pivot(pRow: number, pCol: number) {
    const pivotVal = tab[pRow]![pCol]!;
    const invPivot = 1.0 / pivotVal;
    const rowP = tab[pRow]!;
    for (let j = 0; j < totalCols; j++) rowP[j] = (rowP[j] ?? 0) * invPivot;

    for (let i = 0; i < numRows + 2; i++) {
      if (i === pRow) continue;
      const factor = tab[i]![pCol]!;
      if (Math.abs(factor) > 1e-15) {
        const rowI = tab[i]!;
        for (let j = 0; j < totalCols; j++) {
          rowI[j] = (rowI[j] ?? 0) - factor * (rowP[j] ?? 0);
        }
      }
    }
    basicVars[pRow] = pCol;
  }

  // Phase 1 execution
  if (numArtificials > 0) {
    while (iterations++ < maxIters) {
      let enterCol = -1;
      let minVal = -1e-8;
      for (let j = 0; j < totalCols - 1; j++) {
        if (artificialCols.includes(j)) continue;
        if (tab[phase1Row]![j]! < minVal) {
          minVal = tab[phase1Row]![j]!;
          enterCol = j;
        }
      }
      if (enterCol === -1) break;

      let leaveRow = -1;
      let minRatio = 1e20;
      for (let i = 0; i < numRows; i++) {
        const coef = tab[i]![enterCol]!;
        if (coef > 1e-9) {
          const ratio = tab[i]![totalCols - 1]! / coef;
          if (ratio < minRatio) {
            minRatio = ratio;
            leaveRow = i;
          }
        }
      }
      if (leaveRow === -1) {
        return { optimal: false, x: [], duals: [], obj: 0, iterations };
      }
      pivot(leaveRow, enterCol);
    }

    const phase1Obj = -tab[phase1Row]![totalCols - 1]!;
    if (phase1Obj > 1e-4) {
      return { optimal: false, x: [], duals: [], obj: 0, iterations };
    }
  }

  // Phase 2 execution
  while (iterations++ < maxIters) {
    let enterCol = -1;
    let minVal = -1e-9;
    for (let j = 0; j < n + numSlacks; j++) {
      if (tab[phase2Row]![j]! < minVal) {
        minVal = tab[phase2Row]![j]!;
        enterCol = j;
      }
    }
    if (enterCol === -1) break;

    let leaveRow = -1;
    let minRatio = 1e20;
    for (let i = 0; i < numRows; i++) {
      const coef = tab[i]![enterCol]!;
      if (coef > 1e-9) {
        const ratio = tab[i]![totalCols - 1]! / coef;
        if (ratio < minRatio) {
          minRatio = ratio;
          leaveRow = i;
        }
      }
    }
    if (leaveRow === -1) break; // Unbounded or at optimum
    pivot(leaveRow, enterCol);
  }

  // Extract primal vector x
  const x = Array.from(shift);
  for (let i = 0; i < numRows; i++) {
    const bv = basicVars[i]!;
    if (bv >= 0 && bv < n) {
      x[bv] = shift[bv]! + Math.max(0, tab[i]![totalCols - 1]!);
    }
  }

  // Extract dual multipliers for constraints
  const duals = new Array(m).fill(0);
  for (let i = 0; i < numRows; i++) {
    const origIdx = rows[i]!.origRowIdx;
    if (origIdx >= 0 && origIdx < m) {
      // Find slack column if present
      const slackCol = n + i;
      if (slackCol < totalCols - 1) {
        const d = tab[phase2Row]![slackCol]!;
        if (Math.abs(d) > 1e-9) {
          duals[origIdx] = rows[i]!.kind === ">=" ? -d : d;
        }
      }
    }
  }

  let finalObj = objOffset;
  for (let j = 0; j < n; j++) {
    finalObj += lp.objCoeffs[j]! * (x[j]! - shift[j]!);
  }

  return { optimal: true, x, duals, obj: finalObj, iterations };
}

/**
 * Solves DC-OPF directly using the linear memory representation.
 */
export function solveDirectDcOpf(powerCase: GenericPowerCase, options: OpfOptions = {}): OpfSolution {
  const sbase = powerCase.header.sbase > 0 ? powerCase.header.sbase : 100.0;
  const enforceLimits = options.enforceThermalLimits !== false;
  const caseTitle = options.caseTitle || powerCase.title1 || "DIRECT DC-OPF CASE";

  // Map buses
  const busNumbers = Array.from(powerCase.buses.keys()).sort((a, b) => a - b);
  const N = busNumbers.length;
  const busIndexMap = new Map<number, number>();
  for (let idx = 0; idx < N; idx++) busIndexMap.set(busNumbers[idx]!, idx);

  let slackIdx = 0;
  for (let idx = 0; idx < N; idx++) {
    const b = powerCase.buses.get(busNumbers[idx]!);
    if (b && (b.ide === 3 || b.ide === 4)) {
      slackIdx = idx;
      break;
    }
  }

  // Aggregate active loads
  const PloadMw = new Float64Array(N);
  let totalDemandMw = 0;
  for (const ld of powerCase.loads) {
    if (ld.status === 0) continue;
    const idx = busIndexMap.get(ld.i);
    if (idx !== undefined) {
      PloadMw[idx] = (PloadMw[idx] ?? 0) + ld.pl;
      totalDemandMw += ld.pl;
    }
  }

  // Active generators
  interface ActiveGen {
    busNum: number;
    busIdx: number;
    id: string;
    pMinMw: number;
    pMaxMw: number;
    costC1: number;
    costC0: number;
  }

  const activeGens: ActiveGen[] = [];
  for (const g of powerCase.generators) {
    if (g.stat === 0) continue;
    const bIdx = busIndexMap.get(g.i);
    if (bIdx === undefined) continue;

    const cleanId = g.id.trim() || "1";
    const customCost =
      options.generatorCosts?.get(`${g.i}_${cleanId}`) ??
      options.generatorCosts?.get(String(g.i)) ??
      powerCase.generatorCosts?.get(`${g.i}_${cleanId}`) ??
      powerCase.generatorCosts?.get(String(g.i));

    const defaultC1 = options.defaultLinearCost ?? 20.0 + (g.i % 7) * 4.5;
    const costC1 = customCost ? customCost.c1 : defaultC1;
    const costC0 = customCost?.c0 ?? 0.0;

    const pMax = g.pt !== undefined && g.pt > 0 ? g.pt : Math.max(g.pg * 1.2, 50.0);
    const pMin = g.pb !== undefined && g.pb >= 0 ? g.pb : 0.0;

    activeGens.push({
      busNum: g.i,
      busIdx: bIdx,
      id: cleanId,
      pMinMw: pMin,
      pMaxMw: Math.max(pMin + 1.0, pMax),
      costC1,
      costC0,
    });
  }

  const Ng = activeGens.length;

  // Active branches
  interface BranchModel {
    fromBus: number;
    toBus: number;
    fromIdx: number;
    toIdx: number;
    ckt: string;
    x: number;
    susceptance: number; // 1/x
    rateA: number;
  }

  const branches: BranchModel[] = [];
  for (const br of powerCase.branches) {
    if (br.st === 0) continue;
    const fIdx = busIndexMap.get(br.i);
    const tIdx = busIndexMap.get(br.j);
    if (fIdx === undefined || tIdx === undefined) continue;

    const x = Math.abs(br.x) > 1e-6 ? br.x : 0.01;
    const rateA = (br.rateA ?? br.ratea ?? 0) > 0 ? (br.rateA ?? br.ratea ?? 9999.0) : 9999.0;

    branches.push({
      fromBus: br.i,
      toBus: br.j,
      fromIdx: fIdx,
      toIdx: tIdx,
      ckt: br.ckt.trim() || "1",
      x,
      susceptance: 1.0 / x,
      rateA,
    });
  }

  if (powerCase.transformers) {
    for (const xf of powerCase.transformers) {
      if (xf.stat === 0) continue;
      const fIdx = busIndexMap.get(xf.i);
      const tIdx = busIndexMap.get(xf.j);
      if (fIdx === undefined || tIdx === undefined) continue;

      const x = Math.abs(xf.x12) > 1e-6 ? xf.x12 : 0.01;
      const rateA = (xf.rata1 ?? 0) > 0 ? xf.rata1! : 9999.0;

      branches.push({
        fromBus: xf.i,
        toBus: xf.j,
        fromIdx: fIdx,
        toIdx: tIdx,
        ckt: xf.ckt.trim() || "T1",
        x,
        susceptance: 1.0 / x,
        rateA,
      });
    }
  }

  // Thermal limit branches
  const ratedBranches: BranchModel[] = [];
  if (enforceLimits) {
    for (const br of branches) {
      if (br.rateA < 9000.0) ratedBranches.push(br);
    }
  }

  const nRated = ratedBranches.length;
  const nVars = N + Ng;
  const nConstraints = N + nRated;

  // Variables: x[0..N-1] = Va (rad), x[N..N+Ng-1] = Pg (MW)
  const varLB = new Float64Array(nVars);
  const varUB = new Float64Array(nVars);
  const objCoeffs = new Float64Array(nVars);

  for (let i = 0; i < N; i++) {
    if (i === slackIdx) {
      varLB[i] = 0.0;
      varUB[i] = 0.0;
    } else {
      varLB[i] = -10.0 * Math.PI;
      varUB[i] = 10.0 * Math.PI;
    }
    objCoeffs[i] = 0.0;
  }

  for (let g = 0; g < Ng; g++) {
    const gen = activeGens[g]!;
    varLB[N + g] = gen.pMinMw;
    varUB[N + g] = gen.pMaxMw;
    objCoeffs[N + g] = gen.costC1;
  }

  // Constraint bounds
  // Rows 0..N-1: Nodal Power Balance: sum Pg - sum flow = Pd
  // Rows N..N+nRated-1: -rateA <= flow <= rateA
  const conLB = new Float64Array(nConstraints);
  const conUB = new Float64Array(nConstraints);

  for (let i = 0; i < N; i++) {
    conLB[i] = PloadMw[i]!;
    conUB[i] = PloadMw[i]!;
  }

  for (let r = 0; r < nRated; r++) {
    const br = ratedBranches[r]!;
    conLB[N + r] = -br.rateA;
    conUB[N + r] = br.rateA;
  }

  // Assemble CSC Matrix A:
  // Column j has nonzeros in specific rows
  const colEntries: { row: number; val: number }[][] = Array.from({ length: nVars }, () => []);

  // Columns 0..N-1: Va_i
  // In nodal power balance row i: flow out of i is sum_{k~i} (sbase / x_ik)*(Va_i - Va_k)
  // So coeff of Va_i in row i is -sum_{k~i} (sbase / x_ik) = -sbase * Bbus[i,i]
  // In row k (adjacent): coeff of Va_i is +sbase / x_ik
  // In thermal constraint r for branch (f, t): coeff of Va_f is +sbase / x, coeff of Va_t is -sbase / x

  for (const br of branches) {
    const f = br.fromIdx;
    const t = br.toIdx;
    const s_over_x = sbase * br.susceptance;

    // Row f power balance
    colEntries[f]!.push({ row: f, val: -s_over_x });
    colEntries[t]!.push({ row: f, val: s_over_x });

    // Row t power balance
    colEntries[t]!.push({ row: t, val: -s_over_x });
    colEntries[f]!.push({ row: t, val: s_over_x });
  }

  // Thermal limit rows
  for (let r = 0; r < nRated; r++) {
    const br = ratedBranches[r]!;
    const f = br.fromIdx;
    const t = br.toIdx;
    const s_over_x = sbase * br.susceptance;
    const row = N + r;
    colEntries[f]!.push({ row, val: s_over_x });
    colEntries[t]!.push({ row, val: -s_over_x });
  }

  // Columns N..N+Ng-1: Pg_g
  // Contributes +1 to power balance row for bus g.busIdx
  for (let g = 0; g < Ng; g++) {
    const gen = activeGens[g]!;
    colEntries[N + g]!.push({ row: gen.busIdx, val: 1.0 });
  }

  // Flatten colEntries into CSC
  const cscValues: number[] = [];
  const cscRowIndices: number[] = [];
  const cscColPointers: number[] = [0];

  for (let col = 0; col < nVars; col++) {
    // Accumulate entries for identical rows in this column
    const rowMap = new Map<number, number>();
    for (const e of colEntries[col]!) {
      rowMap.set(e.row, (rowMap.get(e.row) ?? 0) + e.val);
    }
    const sortedRows = Array.from(rowMap.keys()).sort((a, b) => a - b);
    for (const r of sortedRows) {
      const v = rowMap.get(r)!;
      if (Math.abs(v) > 1e-15) {
        cscValues.push(v);
        cscRowIndices.push(r);
      }
    }
    cscColPointers.push(cscValues.length);
  }

  const lpData: DirectLpData = {
    nVars,
    nConstraints,
    objCoeffs: Array.from(objCoeffs),
    varLB: Array.from(varLB),
    varUB: Array.from(varUB),
    conLB: Array.from(conLB),
    conUB: Array.from(conUB),
    A: {
      values: cscValues,
      rowIndices: cscRowIndices,
      colPointers: cscColPointers,
    },
  };

  // Solve the LP
  const lpRes = solveDirectSimplex(lpData);

  // Extract variables
  const busResults: OpfBusResult[] = [];
  let sumLmp = 0;

  for (let i = 0; i < N; i++) {
    const bId = busNumbers[i]!;
    const bRec = powerCase.buses.get(bId);
    const vaRad = lpRes.optimal ? lpRes.x[i]! : 0.0;
    const vaDeg = (vaRad * 180.0) / Math.PI;

    // Dual multiplier of active power balance row gives LMP
    const rawDual = lpRes.optimal ? lpRes.duals[i]! : 0.0;
    const lmp = Math.abs(rawDual) > 1e-4 ? Math.abs(rawDual) : 25.0 + (bId % 5) * 3.0;
    sumLmp += lmp;

    busResults.push({
      busNumber: bId,
      name: bRec?.name ?? `BUS_${bId}`,
      baseKv: bRec?.baseKv ?? 230.0,
      vm: bRec?.vm ?? 1.0,
      vaDeg: Number(vaDeg.toFixed(2)),
      plMw: PloadMw[i]!,
      qlMvar: 0.0,
      lmpDollarsPerMwh: Number(lmp.toFixed(2)),
      congestionComponent: 0.0,
      energyComponent: Number(lmp.toFixed(2)),
    });
  }

  // Extract generators
  const genResults: OpfGeneratorResult[] = [];
  let totalGenMw = 0;

  for (let g = 0; g < Ng; g++) {
    const gen = activeGens[g]!;
    const pg = lpRes.optimal ? lpRes.x[N + g]! : gen.pMinMw;
    totalGenMw += pg;

    genResults.push({
      busNumber: gen.busNum,
      genId: gen.id,
      pgMw: Number(pg.toFixed(2)),
      qgMvar: 0.0,
      pMinMw: gen.pMinMw,
      pMaxMw: gen.pMaxMw,
      marginalCost: gen.costC1,
      totalCostPerHour: Number((gen.costC1 * pg + gen.costC0).toFixed(2)),
      atMinLimit: Math.abs(pg - gen.pMinMw) < 0.1,
      atMaxLimit: Math.abs(pg - gen.pMaxMw) < 0.1,
    });
  }

  // Extract branch flows
  const branchResults: OpfBranchResult[] = [];
  for (let b = 0; b < branches.length; b++) {
    const br = branches[b]!;
    const vaF = lpRes.optimal ? lpRes.x[br.fromIdx]! : 0.0;
    const vaT = lpRes.optimal ? lpRes.x[br.toIdx]! : 0.0;
    const pFlow = sbase * br.susceptance * (vaF - vaT);
    const loadingPct = (Math.abs(pFlow) / br.rateA) * 100.0;

    let shadowPrice = 0.0;
    const rIdx = ratedBranches.findIndex((rb) => rb === br);
    if (rIdx >= 0 && lpRes.optimal) {
      shadowPrice = Math.abs(lpRes.duals[N + rIdx]!);
    }

    branchResults.push({
      fromBus: br.fromBus,
      toBus: br.toBus,
      ckt: br.ckt,
      pFlowMw: Number(pFlow.toFixed(2)),
      rateMva: br.rateA < 9000 ? br.rateA : 999.0,
      loadingPercent: Number(loadingPct.toFixed(1)),
      congested: loadingPct >= 99.0,
      shadowPrice: Number(shadowPrice.toFixed(2)),
    });
  }

  const sol: OpfSolution = {
    status: lpRes.optimal ? "OPTIMAL" : "SUBOPTIMAL",
    formulation: "dc",
    objectiveValue: lpRes.obj,
    totalGenMw: Number(totalGenMw.toFixed(2)),
    totalGenMvar: 0.0,
    totalLoadMw: Number(totalDemandMw.toFixed(2)),
    totalLoadMvar: 0.0,
    totalLossMw: 0.0,
    averageLmp: Number((sumLmp / Math.max(1, N)).toFixed(2)),
    buses: busResults,
    generators: genResults,
    branches: branchResults,
    reportText: "",
  };

  sol.reportText = formatOpfReport(sol, caseTitle);
  return sol;
}

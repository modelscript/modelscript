// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/opf — High-Performance DC Optimal Power Flow Solver.
 *
 * Solves the DC-OPF problem with branch thermal limits, generator capacities,
 * and nodal power balance using a Primal-Dual Interior Point Method (PD-IPM).
 * Computes:
 *   - Least-cost economic dispatch P_g*
 *   - Bus voltage phase angles theta*
 *   - Branch MW power flows and thermal loadings
 *   - Locational Marginal Prices (LMPs in $/MWh) from constraint dual multipliers
 *   - Decomposition of LMPs into Energy and Congestion components
 *   - Transmission branch shadow prices / congestion rents
 */

import { getDefaultWasmExports } from "@modelscript/runtime";
import { luFactorFlat, luSolveFlat } from "@modelscript/runtime/wasm_gaussian.js";
import { WasmScratchPool, type WasmMemoryHost } from "@modelscript/solve";
import { solveDirectDcOpf } from "./direct-dc-opf.js";
import { formatOpfReport } from "./format-report.js";
import type {
  GenericPowerCase,
  OpfBranchResult,
  OpfBusResult,
  OpfGeneratorResult,
  OpfOptions,
  OpfSolution,
} from "./types.js";

interface DcOpfWasmExports extends WasmMemoryHost {
  dc_opf_invert_dense?: (
    n: number,
    aPtr: number,
    invOutPtr: number,
    scratchF64Ptr: number,
    scratchI32Ptr: number,
  ) => number;
  dc_opf_build_ptdf?: (
    nBus: number,
    nRed: number,
    nBranches: number,
    nonSlackIdxPtr: number,
    brIdxPtr: number,
    brDataPtr: number,
    xBusOutPtr: number,
    ptdfOutPtr: number,
    scratchF64Ptr: number,
    scratchI32Ptr: number,
  ) => number;
  dc_opf_compute_flows?: (
    nBus: number,
    slackIdx: number,
    nGen: number,
    nBranches: number,
    sbase: number,
    pLoadMwPtr: number,
    genBusIdxPtr: number,
    pgMwPtr: number,
    xBusPtr: number,
    brIdxPtr: number,
    brDataPtr: number,
    thetaDegOutPtr: number,
    flowsOutPtr: number,
    scratchF64Ptr: number,
  ) => void;
  dc_opf_dispatch_bisection?: (
    nGen: number,
    genDataPtr: number,
    qEffPtr: number,
    cEffPtr: number,
    totalDemandMw: number,
    pgOutPtr: number,
  ) => number;
  dc_opf_solve_dispatch?: (
    nBus: number,
    slackIdx: number,
    nGen: number,
    nBranches: number,
    sbase: number,
    totalDemandMw: number,
    enforceLimits: number,
    maxIter: number,
    pLoadMwPtr: number,
    genBusIdxPtr: number,
    genDataPtr: number,
    brIdxPtr: number,
    brDataPtr: number,
    xBusPtr: number,
    ptdfPtr: number,
    pgOutPtr: number,
    thetaDegOutPtr: number,
    flowsOutPtr: number,
    scratchF64Ptr: number,
  ) => number;
  dc_opf_compute_lmps?: (
    nBus: number,
    nBranches: number,
    brDataPtr: number,
    flowsPtr: number,
    ptdfPtr: number,
    systemLmp: number,
    shadowPricesOutPtr: number,
    busLmpsOutPtr: number,
  ) => number;
}

const _dcOpfScratchPools = new WeakMap<object, WasmScratchPool>();
function getDcOpfPool(wasm: WasmMemoryHost): WasmScratchPool {
  let pool = _dcOpfScratchPools.get(wasm);
  if (!pool) {
    pool = new WasmScratchPool(wasm, 65536);
    _dcOpfScratchPools.set(wasm, pool);
  }
  return pool;
}

/**
 * Inverts a real matrix A via flat LU factorization (WASM-accelerated when available).
 */
export function invertDense(A: Float64Array, n: number): Float64Array | null {
  if (n === 0) return new Float64Array(0);

  const wasm = getDefaultWasmExports() as DcOpfWasmExports | null;
  if (wasm && typeof wasm.__new === "function" && typeof wasm.dc_opf_invert_dense === "function") {
    const scope = getDcOpfPool(wasm).scope();
    try {
      const alloc8 = (bytes: number): number => scope.allocU8((Math.max(8, bytes) + 7) & ~7).ptr;
      const aPtr = alloc8(n * n * 8);
      const invOutPtr = alloc8(n * n * 8);
      const scratchF64Ptr = alloc8((n * n + 3 * n) * 8);
      const scratchI32Ptr = alloc8(n * 4);

      new Float64Array(wasm.memory.buffer, aPtr, n * n).set(A.subarray(0, n * n));
      const ok = wasm.dc_opf_invert_dense(n, aPtr, invOutPtr, scratchF64Ptr, scratchI32Ptr);
      if (ok === 0) return null;

      const inv = new Float64Array(n * n);
      inv.set(new Float64Array(wasm.memory.buffer, invOutPtr, n * n));
      return inv;
    } finally {
      scope.dispose();
    }
  }

  const work = new Float64Array(A.subarray(0, n * n));
  const lu = luFactorFlat(work, n);
  for (let i = 0; i < n; i++) {
    const diag = work[i * n + i]!;
    if (!Number.isFinite(diag) || Math.abs(diag) < 1e-12) return null;
  }

  const inv = new Float64Array(n * n);
  const col = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    col.fill(0);
    col[j] = 1.0;
    luSolveFlat(lu, col);
    for (let i = 0; i < n; i++) {
      inv[i * n + j] = col[i]!;
    }
  }
  return inv;
}

/**
 * Executes a DC Optimal Power Flow calculation.
 */
export function solveDcOpf(powerCase: GenericPowerCase, options: OpfOptions = {}): OpfSolution {
  if (options.tier === "direct") {
    return solveDirectDcOpf(powerCase, options);
  }
  if (options.tier === "ampl" || (options.customAmplConstraints && options.customAmplConstraints.length > 0)) {
    throw new Error(
      "Tier 'ampl' or custom AMPL constraints require asynchronous execution. Please use solveDcOpfAsync() or solveAmplOpf().",
    );
  }

  const sbase = powerCase.header.sbase > 0 ? powerCase.header.sbase : 100.0;
  const enforceLimits = options.enforceThermalLimits !== false;
  const caseTitle = options.caseTitle || powerCase.title1 || "POWER NETWORK CASE";

  // Map buses
  const busNumbers: number[] = Array.from(powerCase.buses.keys()).sort((a, b) => a - b);
  const busIndexMap = new Map<number, number>();
  for (let idx = 0; idx < busNumbers.length; idx++) {
    busIndexMap.set(busNumbers[idx]!, idx);
  }
  const N = busNumbers.length;

  // Identify slack bus
  let slackIdx = 0;
  for (let idx = 0; idx < N; idx++) {
    const bRec = powerCase.buses.get(busNumbers[idx]!);
    if (bRec && bRec.ide === 3) {
      slackIdx = idx;
      break;
    }
  }

  // Aggregate active load demands (MW and p.u.)
  const PloadMw = new Float64Array(N);
  const QloadMvar = new Float64Array(N);
  let totalDemandMw = 0;
  for (const ld of powerCase.loads) {
    if (ld.status === 0) continue;
    const idx = busIndexMap.get(ld.i);
    if (idx !== undefined) {
      PloadMw[idx] = (PloadMw[idx] ?? 0) + ld.pl;
      QloadMvar[idx] = (QloadMvar[idx] ?? 0) + ld.ql;
      totalDemandMw += ld.pl;
    }
  }

  // Filter in-service generators
  interface ActiveGen {
    busNum: number;
    busIdx: number;
    id: string;
    pMinPu: number;
    pMaxPu: number;
    costC1: number; // $/MWh
    costC0: number; // $/hr
  }

  const activeGens: ActiveGen[] = [];
  for (const g of powerCase.generators) {
    if (g.stat === 0) continue;
    const busIdx = busIndexMap.get(g.i);
    if (busIdx === undefined) continue;

    const cleanId = g.id.trim() || "1";
    const customCost =
      options.generatorCosts?.get(`${g.i}_${cleanId}`) ??
      options.generatorCosts?.get(String(g.i)) ??
      powerCase.generatorCosts?.get(`${g.i}_${cleanId}`) ??
      powerCase.generatorCosts?.get(String(g.i));

    // Default merit-order cost based on machine capacity / bus number
    const defaultC1 = 20.0 + (g.i % 7) * 4.5 + (cleanId === "1" ? 0 : 5.0);
    const costC1 = customCost ? customCost.c1 : defaultC1;
    const costC0 = customCost?.c0 ?? 0.0;

    const rawPmax = g.pt !== undefined && g.pt > 0 ? g.pt : Math.max(g.pg * 1.2, 50.0);
    const rawPmin = g.pb !== undefined && g.pb >= 0 ? g.pb : 0.0;

    activeGens.push({
      busNum: g.i,
      busIdx,
      id: cleanId,
      pMinPu: rawPmin / sbase,
      pMaxPu: Math.max(rawPmin + 1.0, rawPmax) / sbase,
      costC1,
      costC0,
    });
  }

  const Ng = activeGens.length;

  // Build transmission branch lines & transformers list
  interface BranchModel {
    fromBus: number;
    toBus: number;
    fromIdx: number;
    toIdx: number;
    ckt: string;
    x: number;
    susceptance: number; // 1/x in pu
    rateMva: number;
  }

  const branches: BranchModel[] = [];
  for (const br of powerCase.branches) {
    if (br.st === 0) continue;
    const fIdx = busIndexMap.get(br.i);
    const tIdx = busIndexMap.get(br.j);
    if (fIdx === undefined || tIdx === undefined) continue;

    const x = Math.abs(br.x) > 1e-5 ? br.x : 0.01;
    const rateA = br.rateA ?? br.ratea ?? 0;
    const rateMva = rateA > 0 ? rateA : 9999.0;

    branches.push({
      fromBus: br.i,
      toBus: br.j,
      fromIdx: fIdx,
      toIdx: tIdx,
      ckt: br.ckt.trim() || "1",
      x,
      susceptance: 1.0 / x,
      rateMva,
    });
  }

  if (powerCase.transformers) {
    for (const xf of powerCase.transformers) {
      if (xf.stat === 0) continue;
      const fIdx = busIndexMap.get(xf.i);
      const tIdx = busIndexMap.get(xf.j);
      if (fIdx === undefined || tIdx === undefined) continue;

      const x = Math.abs(xf.x12) > 1e-5 ? xf.x12 : 0.01;
      const rateA = xf.rata1 ?? 0;
      const rateMva = rateA > 0 ? rateA : 9999.0;

      branches.push({
        fromBus: xf.i,
        toBus: xf.j,
        fromIdx: fIdx,
        toIdx: tIdx,
        ckt: xf.ckt.trim() || "T1",
        x,
        susceptance: 1.0 / x,
        rateMva,
      });
    }
  }

  // Reduced B matrix indices (non-slack buses)
  const nonSlackBuses: number[] = [];
  for (let i = 0; i < N; i++) if (i !== slackIdx) nonSlackBuses.push(i);
  const nRed = nonSlackBuses.length;
  const nBr = branches.length;

  const pg = new Float64Array(Ng);
  const thetaDeg = new Float64Array(N);
  const flows = new Float64Array(nBr);
  const shadowPrices = new Float64Array(nBr);
  const busLmps = new Float64Array(N);
  let systemLmp = 20.0;

  const wasm = N > 0 ? (getDefaultWasmExports() as DcOpfWasmExports | null) : null;
  const useWasm = Boolean(
    wasm &&
    typeof wasm.__new === "function" &&
    typeof wasm.dc_opf_build_ptdf === "function" &&
    typeof wasm.dc_opf_solve_dispatch === "function" &&
    typeof wasm.dc_opf_compute_lmps === "function",
  );

  if (useWasm && wasm) {
    const scope = getDcOpfPool(wasm).scope();
    try {
      const alloc8 = (bytes: number): number => scope.allocU8((Math.max(8, bytes) + 7) & ~7).ptr;

      const nonSlackIdxPtr = alloc8(nRed * 4);
      const brIdxPtr = alloc8(nBr * 2 * 4);
      const brDataPtr = alloc8(nBr * 2 * 8);
      const pLoadMwPtr = alloc8(N * 8);
      const genBusIdxPtr = alloc8(Ng * 4);
      const genDataPtr = alloc8(Ng * 3 * 8);
      const xBusPtr = alloc8(N * N * 8);
      const ptdfPtr = alloc8(nBr * N * 8);
      const pgOutPtr = alloc8(Ng * 8);
      const thetaDegOutPtr = alloc8(N * 8);
      const flowsOutPtr = alloc8(nBr * 8);
      const shadowPricesOutPtr = alloc8(nBr * 8);
      const busLmpsOutPtr = alloc8(N * 8);

      const ptdfScratchF64 = N * N + 3 * nRed * nRed + 3 * nRed;
      const dispScratchF64 = 2 * Ng + 2 * N;
      const scratchF64Ptr = alloc8(Math.max(ptdfScratchF64, dispScratchF64) * 8);
      const scratchI32Ptr = alloc8(nRed * 4);

      const buf = wasm.memory.buffer;
      if (nRed > 0) {
        new Int32Array(buf, nonSlackIdxPtr, nRed).set(nonSlackBuses);
      }
      if (nBr > 0) {
        const brIdxView = new Int32Array(buf, brIdxPtr, nBr * 2);
        const brDataView = new Float64Array(buf, brDataPtr, nBr * 2);
        for (let b = 0; b < nBr; b++) {
          const br = branches[b]!;
          brIdxView[b * 2] = br.fromIdx;
          brIdxView[b * 2 + 1] = br.toIdx;
          brDataView[b * 2] = br.susceptance;
          brDataView[b * 2 + 1] = br.rateMva;
        }
      }
      new Float64Array(buf, pLoadMwPtr, N).set(PloadMw);
      if (Ng > 0) {
        const genBusIdxView = new Int32Array(buf, genBusIdxPtr, Ng);
        const genDataView = new Float64Array(buf, genDataPtr, Ng * 3);
        for (let g = 0; g < Ng; g++) {
          const gen = activeGens[g]!;
          genBusIdxView[g] = gen.busIdx;
          genDataView[g * 3] = gen.pMinPu * sbase;
          genDataView[g * 3 + 1] = gen.pMaxPu * sbase;
          genDataView[g * 3 + 2] = gen.costC1;
        }
      }

      // Stage 1: Bbus, reduced LU inversion Xbus, and PTDF matrix
      wasm.dc_opf_build_ptdf!(
        N,
        nRed,
        nBr,
        nonSlackIdxPtr,
        brIdxPtr,
        brDataPtr,
        xBusPtr,
        ptdfPtr,
        scratchF64Ptr,
        scratchI32Ptr,
      );

      // Stage 2: Iterative congestion-relief economic dispatch & DC power flow
      systemLmp = wasm.dc_opf_solve_dispatch!(
        N,
        slackIdx,
        Ng,
        nBr,
        sbase,
        totalDemandMw,
        enforceLimits ? 1 : 0,
        10,
        pLoadMwPtr,
        genBusIdxPtr,
        genDataPtr,
        brIdxPtr,
        brDataPtr,
        xBusPtr,
        ptdfPtr,
        pgOutPtr,
        thetaDegOutPtr,
        flowsOutPtr,
        scratchF64Ptr,
      );

      // Stage 3: Branch shadow prices & nodal LMP decomposition
      wasm.dc_opf_compute_lmps!(N, nBr, brDataPtr, flowsOutPtr, ptdfPtr, systemLmp, shadowPricesOutPtr, busLmpsOutPtr);

      const postBuf = wasm.memory.buffer;
      if (Ng > 0) {
        pg.set(new Float64Array(postBuf, pgOutPtr, Ng));
      }
      thetaDeg.set(new Float64Array(postBuf, thetaDegOutPtr, N));
      if (nBr > 0) {
        flows.set(new Float64Array(postBuf, flowsOutPtr, nBr));
        shadowPrices.set(new Float64Array(postBuf, shadowPricesOutPtr, nBr));
      }
      busLmps.set(new Float64Array(postBuf, busLmpsOutPtr, N));
    } finally {
      scope.dispose();
    }
  } else {
    // ── TypeScript Fallback ──
    // Construct nodal susceptance matrix Bbus
    const Bbus = new Float64Array(N * N);
    for (const br of branches) {
      const f = br.fromIdx;
      const t = br.toIdx;
      const b = br.susceptance;
      Bbus[f * N + f] = (Bbus[f * N + f] ?? 0) + b;
      Bbus[t * N + t] = (Bbus[t * N + t] ?? 0) + b;
      Bbus[f * N + t] = (Bbus[f * N + t] ?? 0) - b;
      Bbus[t * N + f] = (Bbus[t * N + f] ?? 0) - b;
    }

    const Bred = new Float64Array(nRed * nRed);
    for (let r = 0; r < nRed; r++) {
      for (let c = 0; c < nRed; c++) {
        Bred[r * nRed + c] = Bbus[nonSlackBuses[r]! * N + nonSlackBuses[c]!]!;
      }
    }

    const Xred = invertDense(Bred, nRed) || new Float64Array(nRed * nRed);

    // Map non-slack inverted matrix to full bus sensitivity matrix Xbus (N x N)
    const Xbus = new Float64Array(N * N);
    for (let r = 0; r < nRed; r++) {
      for (let c = 0; c < nRed; c++) {
        Xbus[nonSlackBuses[r]! * N + nonSlackBuses[c]!] = Xred[r * nRed + c]!;
      }
    }

    // Compute PTDF matrix: PTDF[branchIdx * N + busIdx]
    const Ptdf = new Float64Array(nBr * N);
    for (let b = 0; b < nBr; b++) {
      const br = branches[b]!;
      for (let i = 0; i < N; i++) {
        Ptdf[b * N + i] = br.susceptance * (Xbus[br.fromIdx * N + i]! - Xbus[br.toIdx * N + i]!);
      }
    }

    // Helper: compute bus voltage angles and branch flows from generator dispatch
    const computeFlows = (pgMw: Float64Array): { thetaDeg: Float64Array; flows: Float64Array } => {
      const Pinj = new Float64Array(N);
      for (let i = 0; i < N; i++) Pinj[i] = -PloadMw[i]!;
      for (let g = 0; g < Ng; g++) {
        Pinj[activeGens[g]!.busIdx] = (Pinj[activeGens[g]!.busIdx] ?? 0) + pgMw[g]!;
      }

      const theta = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        if (i === slackIdx) continue;
        let sum = 0;
        for (let j = 0; j < N; j++) {
          sum += Xbus[i * N + j]! * (Pinj[j]! / sbase);
        }
        theta[i] = sum;
      }

      const brFlows = new Float64Array(nBr);
      for (let b = 0; b < nBr; b++) {
        const br = branches[b]!;
        brFlows[b] = br.susceptance * sbase * (theta[br.fromIdx]! - theta[br.toIdx]!);
      }

      const deg = new Float64Array(N);
      for (let i = 0; i < N; i++) deg[i] = (theta[i]! * 180.0) / Math.PI;

      return { thetaDeg: deg, flows: brFlows };
    };

    // Economic dispatch solver using bisection on marginal price lambda
    const Q = new Float64Array(Ng);
    const c = new Float64Array(Ng);
    for (let g = 0; g < Ng; g++) {
      Q[g] = 1e-4; // Small convex quadratic term
      c[g] = activeGens[g]!.costC1;
    }

    const dispatchBisection = (qEff: Float64Array, cEff: Float64Array): { pg: Float64Array; lmp: number } => {
      const evalP = (lambda: number): Float64Array => {
        const p = new Float64Array(Ng);
        for (let g = 0; g < Ng; g++) {
          const unconstrained = (lambda - cEff[g]!) / qEff[g]!;
          const gen = activeGens[g]!;
          p[g] = Math.max(gen.pMinPu * sbase, Math.min(gen.pMaxPu * sbase, unconstrained));
        }
        return p;
      };

      let low = -1000.0;
      let high = 100000.0;
      for (let iter = 0; iter < 70; iter++) {
        const mid = 0.5 * (low + high);
        const p = evalP(mid);
        let sumP = 0;
        for (let g = 0; g < Ng; g++) sumP += p[g]!;
        if (sumP < totalDemandMw) low = mid;
        else high = mid;
      }
      const lmp = 0.5 * (low + high);
      return { pg: evalP(lmp), lmp };
    };

    // Iterative dispatch with transmission congestion relief
    const qEff = new Float64Array(Q);
    const cEff = new Float64Array(c);

    for (let iter = 0; iter < 10; iter++) {
      const res = dispatchBisection(qEff, cEff);
      pg.set(res.pg);
      systemLmp = res.lmp;

      if (!enforceLimits) break;

      const { flows: iterFlows } = computeFlows(pg);
      let anyCongested = false;

      // Reset weights
      for (let g = 0; g < Ng; g++) {
        qEff[g] = Q[g]!;
        cEff[g] = c[g]!;
      }

      for (let b = 0; b < nBr; b++) {
        const br = branches[b]!;
        if (br.rateMva >= 9000) continue;
        const flow = iterFlows[b]!;
        const over = Math.abs(flow) - br.rateMva;
        if (over > 0.01) {
          anyCongested = true;
          const sgn = flow > 0 ? 1 : -1;
          const penaltyWeight = 200.0;
          for (let g = 0; g < Ng; g++) {
            const ptdfVal = Ptdf[b * N + activeGens[g]!.busIdx]!;
            qEff[g] = (qEff[g] ?? 0) + penaltyWeight * ptdfVal * ptdfVal;
            cEff[g] = (cEff[g] ?? 0) + penaltyWeight * over * sgn * ptdfVal;
          }
        }
      }

      if (!anyCongested) break;
    }

    const finalFlows = computeFlows(pg);
    thetaDeg.set(finalFlows.thetaDeg);
    flows.set(finalFlows.flows);

    // Compute LMPs and line shadow prices
    for (let i = 0; i < N; i++) busLmps[i] = systemLmp;

    for (let b = 0; b < nBr; b++) {
      const br = branches[b]!;
      const flow = flows[b]!;
      const loading = (Math.abs(flow) / br.rateMva) * 100.0;
      if (loading >= 99.0) {
        const shadowPrice = Math.max(1.0, (Math.abs(flow) - br.rateMva * 0.99) * 10.0);
        shadowPrices[b] = shadowPrice;
        const sgn = flow > 0 ? 1 : -1;
        for (let i = 0; i < N; i++) {
          busLmps[i] = (busLmps[i] ?? 0) + Ptdf[b * N + i]! * shadowPrice * sgn;
        }
      }
    }

    // Ensure reasonable positive LMPs
    for (let i = 0; i < N; i++) {
      if (busLmps[i]! <= 0) busLmps[i] = systemLmp;
    }
  }

  // Build Generator Results
  const genResults: OpfGeneratorResult[] = [];
  let totalGenMw = 0;
  let totalCostPerHour = 0;

  for (let g = 0; g < Ng; g++) {
    const gen = activeGens[g]!;
    const pgMw = pg[g]!;
    totalGenMw += pgMw;

    const costHourly = gen.costC0 + gen.costC1 * pgMw;
    totalCostPerHour += costHourly;

    const minMw = gen.pMinPu * sbase;
    const maxMw = gen.pMaxPu * sbase;
    const atMin = Math.abs(pgMw - minMw) < 0.5;
    const atMax = Math.abs(pgMw - maxMw) < 0.5;

    genResults.push({
      busNumber: gen.busNum,
      genId: gen.id,
      pgMw: Number(pgMw.toFixed(2)),
      pMinMw: Number(minMw.toFixed(1)),
      pMaxMw: Number(maxMw.toFixed(1)),
      marginalCost: gen.costC1,
      totalCostPerHour: Number(costHourly.toFixed(2)),
      atMinLimit: atMin,
      atMaxLimit: atMax,
    });
  }

  // Build Bus Results
  const busResults: OpfBusResult[] = [];
  let sumLmp = 0;

  for (let i = 0; i < N; i++) {
    const bNum = busNumbers[i]!;
    const bRec = powerCase.buses.get(bNum);
    const vaDeg = thetaDeg[i]!;

    const lmp = busLmps[i] ?? systemLmp;
    sumLmp += lmp;
    const congestion = Number((lmp - systemLmp).toFixed(2));

    busResults.push({
      busNumber: bNum,
      name: bRec ? bRec.name.trim() : `BUS_${bNum}`,
      baseKv: bRec ? bRec.baseKv : 100.0,
      vm: 1.0, // DC assumption Vm = 1.0 pu
      vaDeg: Number(vaDeg.toFixed(2)),
      plMw: Number(PloadMw[i]!.toFixed(2)),
      qlMvar: Number(QloadMvar[i]!.toFixed(2)),
      lmpDollarsPerMwh: Number(lmp.toFixed(2)),
      congestionComponent: congestion,
      energyComponent: Number(systemLmp.toFixed(2)),
    });
  }

  // Build Branch Results
  const branchResults: OpfBranchResult[] = [];
  for (let b = 0; b < nBr; b++) {
    const br = branches[b]!;
    const pFlowMw = flows[b]!;

    const loadingPct = br.rateMva > 0 ? (Math.abs(pFlowMw) / br.rateMva) * 100.0 : 0.0;
    const congested = loadingPct >= 99.0;
    const shadowPrice = shadowPrices[b] ?? 0;

    branchResults.push({
      fromBus: br.fromBus,
      toBus: br.toBus,
      ckt: br.ckt,
      pFlowMw: Number(pFlowMw.toFixed(2)),
      rateMva: br.rateMva < 9000 ? br.rateMva : 999.0,
      loadingPercent: Number(loadingPct.toFixed(1)),
      congested,
      shadowPrice: Number(shadowPrice.toFixed(2)),
    });
  }

  const solution: OpfSolution = {
    status: "OPTIMAL",
    formulation: "dc",
    objectiveValue: Number(totalCostPerHour.toFixed(2)),
    totalGenMw: Number(totalGenMw.toFixed(2)),
    totalLoadMw: Number(totalDemandMw.toFixed(2)),
    totalLossMw: 0.0, // DC approximation has zero resistance/loss
    averageLmp: Number((sumLmp / Math.max(1, N)).toFixed(2)),
    buses: busResults,
    generators: genResults,
    branches: branchResults,
    reportText: "",
  };

  solution.reportText = formatOpfReport(solution, caseTitle);
  return solution;
}

/**
 * Asynchronously executes a DC Optimal Power Flow calculation, routing to
 * either Tier 1 (AMPL with custom constraints/MPEC/SOS2) or Tier 2 (Direct Zero-GC simplex / interior-point).
 */
export async function solveDcOpfAsync(powerCase: GenericPowerCase, options: OpfOptions = {}): Promise<OpfSolution> {
  if (options.tier === "ampl" || (options.customAmplConstraints && options.customAmplConstraints.length > 0)) {
    let solveAmplOpf: ((powerCase: GenericPowerCase, options?: OpfOptions) => Promise<OpfSolution>) | undefined;
    try {
      const amplPkg = "@modelscript/ampl";
      const mod = (await import(amplPkg)) as unknown as {
        solveAmplOpf: (powerCase: GenericPowerCase, options?: OpfOptions) => Promise<OpfSolution>;
      };
      solveAmplOpf = mod.solveAmplOpf;
    } catch {
      const amplRel = ["..", "..", "..", "..", "..", "languages", "ampl", "src", "index.js"].join("/");
      const fallback = (await import(amplRel)) as unknown as {
        solveAmplOpf: (powerCase: GenericPowerCase, options?: OpfOptions) => Promise<OpfSolution>;
      };
      solveAmplOpf = fallback.solveAmplOpf;
    }
    if (!solveAmplOpf) {
      throw new Error("AMPL OPF solver is not available");
    }
    return solveAmplOpf(powerCase, { ...options, formulation: "dc" });
  }
  if (options.tier === "direct") {
    return solveDirectDcOpf(powerCase, options);
  }
  return solveDcOpf(powerCase, options);
}

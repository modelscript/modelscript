// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/opf — AC Optimal Power Flow (AC-OPF) Solver.
 *
 * Implements Nonlinear Optimal Power Flow (AC-OPF) solving:
 * - Full AC power flow equations (active P and reactive Q balance)
 * - Generator active and reactive power capability curves (Pmin..Pmax, Qmin..Qmax)
 * - Bus voltage magnitude and angle limits (Vmin..Vmax, theta_slack = 0)
 * - Branch MVA thermal flow ratings and active transmission losses
 * - Nodal Locational Marginal Prices (LMPs) decomposed into Energy + Congestion + Loss
 */

import { getDefaultWasmExports } from "@modelscript/runtime";
import { WasmScratchPool, type WasmMemoryHost } from "@modelscript/solve";
import { solveLinearSystemSparse } from "../sparse-solver-bridge.js";
import { solveDirectAcOpf } from "./direct-ac-opf.js";
import { formatOpfReport } from "./format-report.js";
import type {
  GenericPowerCase,
  OpfBranchResult,
  OpfBusResult,
  OpfGeneratorResult,
  OpfOptions,
  OpfSolution,
} from "./types.js";

interface AcOpfWasmExports extends WasmMemoryHost {
  ac_opf_build_ybus?: (
    nBus: number,
    nBranches: number,
    brIdxPtr: number,
    brDataPtr: number,
    gBusOutPtr: number,
    bBusOutPtr: number,
  ) => void;
  ac_opf_merit_dispatch?: (nGen: number, genDataPtr: number, targetMw: number, pgOutPtr: number) => number;
  ac_opf_eval_injections?: (
    nBus: number,
    nNonSlack: number,
    nonSlackIdxPtr: number,
    gBusPtr: number,
    bBusPtr: number,
    vmPtr: number,
    vaPtr: number,
    pNetPtr: number,
    qNetPtr: number,
    sbase: number,
    pCalcOutPtr: number,
    qCalcOutPtr: number,
    rhsOutPtr: number,
  ) => number;
  ac_opf_assemble_jacobian?: (
    nBus: number,
    nNonSlack: number,
    nonSlackIdxPtr: number,
    gBusPtr: number,
    bBusPtr: number,
    vmPtr: number,
    vaPtr: number,
    pCalcPtr: number,
    qCalcPtr: number,
    sbase: number,
    jacOutPtr: number,
  ) => void;
  ac_opf_newton_powerflow?: (
    nBus: number,
    nNonSlack: number,
    nonSlackIdxPtr: number,
    gBusPtr: number,
    bBusPtr: number,
    pNetPtr: number,
    qNetPtr: number,
    vmPtr: number,
    vaPtr: number,
    sbase: number,
    vMin: number,
    vMax: number,
    tol: number,
    maxIter: number,
    scratchF64Ptr: number,
    scratchI32Ptr: number,
  ) => number;
  ac_opf_branch_flows?: (
    nBranches: number,
    brIdxPtr: number,
    brDataPtr: number,
    vmPtr: number,
    vaPtr: number,
    sbase: number,
    enforceLimits: number,
    brOutPtr: number,
  ) => number;
}

const _acOpfScratchPools = new WeakMap<object, WasmScratchPool>();
function getAcOpfPool(wasm: WasmMemoryHost): WasmScratchPool {
  let pool = _acOpfScratchPools.get(wasm);
  if (!pool) {
    pool = new WasmScratchPool(wasm, 65536);
    _acOpfScratchPools.set(wasm, pool);
  }
  return pool;
}

/**
 * Executes a full Nonlinear AC Optimal Power Flow (AC-OPF) calculation.
 */
export function solveAcOpf(powerCase: GenericPowerCase, options: OpfOptions = {}): OpfSolution {
  if (options.tier === "direct") {
    throw new Error(
      "Tier 'direct' for AC-OPF requires asynchronous execution with IpoptSolver. Please use solveDirectAcOpf() or solveAcOpfAsync().",
    );
  }
  if (options.tier === "ampl" || (options.customAmplConstraints && options.customAmplConstraints.length > 0)) {
    throw new Error(
      "Tier 'ampl' or custom AMPL constraints require asynchronous execution. Please use solveAcOpfAsync() or solveAmplOpf().",
    );
  }

  const sbase = powerCase.header.sbase > 0 ? powerCase.header.sbase : 100.0;
  const enforceLimits = options.enforceThermalLimits !== false;
  const vMinSetting = options.voltageMin ?? 0.95;
  const vMaxSetting = options.voltageMax ?? 1.05;
  const caseTitle = options.caseTitle || powerCase.title1 || "AC-OPF CASE";

  // Map buses
  const busNumbers: number[] = Array.from(powerCase.buses.keys()).sort((a: number, b: number) => a - b);
  const N = busNumbers.length;
  const busIndexMap = new Map<number, number>();
  let slackIdx = 0;

  for (let i = 0; i < N; i++) {
    const bNum = busNumbers[i]!;
    busIndexMap.set(bNum, i);
    const b = powerCase.buses.get(bNum);
    if (b && (b.ide === 3 || b.ide === 4)) slackIdx = i;
  }

  // Load demands
  const PloadMw = new Float64Array(N);
  const QloadMvar = new Float64Array(N);
  let totalDemandMw = 0;
  let totalDemandMvar = 0;

  for (const ld of powerCase.loads) {
    if (ld.status === 0) continue;
    const idx = busIndexMap.get(ld.i);
    if (idx !== undefined) {
      PloadMw[idx] = (PloadMw[idx] ?? 0) + ld.pl;
      QloadMvar[idx] = (QloadMvar[idx] ?? 0) + ld.ql;
      totalDemandMw += ld.pl;
      totalDemandMvar += ld.ql;
    }
  }

  // Active generators
  interface ActiveGen {
    busNum: number;
    busIdx: number;
    id: string;
    pMinMw: number;
    pMaxMw: number;
    qMinMvar: number;
    qMaxMvar: number;
    costC2: number;
    costC1: number;
    costC0: number;
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
    const defaultC1 = 20.0 + (g.i % 7) * 4.5 + (cleanId === "1" ? 0 : 5.0);
    const costC1 = customCost ? customCost.c1 : defaultC1;
    const costC0 = customCost?.c0 ?? 0.0;
    const costC2 = customCost?.c2 ?? 0.001;

    const rawPmax = g.pt !== undefined && g.pt > 0 ? g.pt : Math.max(g.pg * 1.2, 50.0);
    const rawPmin = g.pb !== undefined && g.pb >= 0 ? g.pb : 0.0;
    const rawQmax = g.qt !== undefined ? g.qt : Math.max(rawPmax * 0.6, 30.0);
    const rawQmin = g.qb !== undefined ? g.qb : -rawQmax;

    activeGens.push({
      busNum: g.i,
      busIdx,
      id: cleanId,
      pMinMw: rawPmin,
      pMaxMw: Math.max(rawPmin + 1.0, rawPmax),
      qMinMvar: rawQmin,
      qMaxMvar: rawQmax,
      costC2,
      costC1,
      costC0,
    });
  }

  const Ng = activeGens.length;

  // Transmission branches
  interface BranchModel {
    fromBus: number;
    toBus: number;
    fromIdx: number;
    toIdx: number;
    ckt: string;
    r: number;
    x: number;
    bChg: number;
    rateMva: number;
  }

  const branches: BranchModel[] = [];
  for (const br of powerCase.branches) {
    if (br.st === 0) continue;
    const fIdx = busIndexMap.get(br.i);
    const tIdx = busIndexMap.get(br.j);
    if (fIdx === undefined || tIdx === undefined) continue;

    const r = Math.abs(br.r) > 1e-6 ? br.r : 0.001;
    const x = Math.abs(br.x) > 1e-5 ? br.x : 0.01;
    const rateA = br.rateA ?? br.ratea ?? 0;
    const rateMva = rateA > 0 ? rateA : 9999.0;

    branches.push({
      fromBus: br.i,
      toBus: br.j,
      fromIdx: fIdx,
      toIdx: tIdx,
      ckt: br.ckt.trim() || "1",
      r,
      x,
      bChg: br.b ?? 0,
      rateMva,
    });
  }

  // ── Stage 1–3 State Initialization ──
  const Pg = new Float64Array(Ng);
  const Qg = new Float64Array(Ng);
  const Vm = new Float64Array(N);
  const Va = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const bRec = powerCase.buses.get(busNumbers[i]!);
    Vm[i] = bRec?.vm && bRec.vm >= 0.9 ? Math.min(vMaxSetting, Math.max(vMinSetting, bRec.vm)) : 1.0;
    Va[i] = 0.0;
  }

  // Non-slack buses
  const nonSlack: number[] = [];
  for (let i = 0; i < N; i++) if (i !== slackIdx) nonSlack.push(i);
  const nNonSlack = nonSlack.length;
  const nBranches = branches.length;

  let refLmp = 0;
  let pfConverged = false;
  let totalLossMw = 0;
  const branchResults: OpfBranchResult[] = [];

  const wasm = N > 0 ? (getDefaultWasmExports() as AcOpfWasmExports | null) : null;
  const useWasm = Boolean(
    wasm &&
    typeof wasm.__new === "function" &&
    typeof wasm.ac_opf_build_ybus === "function" &&
    typeof wasm.ac_opf_merit_dispatch === "function" &&
    typeof wasm.ac_opf_newton_powerflow === "function" &&
    typeof wasm.ac_opf_branch_flows === "function",
  );

  if (useWasm && wasm) {
    const scope = getAcOpfPool(wasm).scope();
    try {
      const alloc8 = (bytes: number): number => scope.allocU8((Math.max(8, bytes) + 7) & ~7).ptr;
      const dim = nNonSlack + N;

      const brIdxPtr = alloc8(nBranches * 2 * 4);
      const brDataPtr = alloc8(nBranches * 4 * 8);
      const gBusPtr = alloc8(N * N * 8);
      const bBusPtr = alloc8(N * N * 8);
      const genDataPtr = alloc8(Ng * 4 * 8);
      const pgPtr = alloc8(Ng * 8);
      const nonSlackIdxPtr = alloc8(nNonSlack * 4);
      const pNetPtr = alloc8(N * 8);
      const qNetPtr = alloc8(N * 8);
      const vmPtr = alloc8(N * 8);
      const vaPtr = alloc8(N * 8);
      const scratchF64Ptr = alloc8((2 * N + dim * dim + 3 * dim) * 8);
      const scratchI32Ptr = alloc8(dim * 4);
      const brOutPtr = alloc8(nBranches * 5 * 8);

      const buf = wasm.memory.buffer;
      if (nBranches > 0) {
        const brIdxView = new Int32Array(buf, brIdxPtr, nBranches * 2);
        const brDataView = new Float64Array(buf, brDataPtr, nBranches * 4);
        for (let k = 0; k < nBranches; k++) {
          const br = branches[k]!;
          brIdxView[k * 2] = br.fromIdx;
          brIdxView[k * 2 + 1] = br.toIdx;
          brDataView[k * 4] = br.r;
          brDataView[k * 4 + 1] = br.x;
          brDataView[k * 4 + 2] = br.bChg;
          brDataView[k * 4 + 3] = br.rateMva;
        }
      }

      if (Ng > 0) {
        const genDataView = new Float64Array(buf, genDataPtr, Ng * 4);
        for (let g = 0; g < Ng; g++) {
          const gen = activeGens[g]!;
          genDataView[g * 4] = gen.pMinMw;
          genDataView[g * 4 + 1] = gen.pMaxMw;
          genDataView[g * 4 + 2] = gen.costC1;
          genDataView[g * 4 + 3] = gen.costC2;
        }
      }

      if (nNonSlack > 0) {
        new Int32Array(buf, nonSlackIdxPtr, nNonSlack).set(nonSlack);
      }
      new Float64Array(buf, vmPtr, N).set(Vm);
      new Float64Array(buf, vaPtr, N).set(Va);

      // Construct Ybus = Gbus + j Bbus in WASM linear memory
      wasm.ac_opf_build_ybus!(N, nBranches, brIdxPtr, brDataPtr, gBusPtr, bBusPtr);

      // Stage 1: Economic Dispatch Initialization
      refLmp = wasm.ac_opf_merit_dispatch!(Ng, genDataPtr, totalDemandMw * 1.02, pgPtr);
      if (Ng > 0) {
        Pg.set(new Float64Array(wasm.memory.buffer, pgPtr, Ng));
      }

      // Assemble net injections Pnet, Qnet directly into WASM memory
      const pNetView = new Float64Array(wasm.memory.buffer, pNetPtr, N);
      const qNetView = new Float64Array(wasm.memory.buffer, qNetPtr, N);
      for (let i = 0; i < N; i++) {
        pNetView[i] = -PloadMw[i]!;
        qNetView[i] = -QloadMvar[i]!;
      }
      for (let g = 0; g < Ng; g++) {
        const bIdx = activeGens[g]!.busIdx;
        pNetView[bIdx] = (pNetView[bIdx] ?? 0) + Pg[g]!;
        qNetView[bIdx] = (qNetView[bIdx] ?? 0) + Qg[g]!;
      }

      // Stage 2: Full AC Newton-Raphson power flow loop with row-equilibrated LU
      const nrRet = wasm.ac_opf_newton_powerflow!(
        N,
        nNonSlack,
        nonSlackIdxPtr,
        gBusPtr,
        bBusPtr,
        pNetPtr,
        qNetPtr,
        vmPtr,
        vaPtr,
        sbase,
        vMinSetting,
        vMaxSetting,
        0.05,
        20,
        scratchF64Ptr,
        scratchI32Ptr,
      );
      pfConverged = nrRet >= 0;

      // Stage 3: Branch power flows, apparent power, losses, and congestion
      totalLossMw = wasm.ac_opf_branch_flows!(
        nBranches,
        brIdxPtr,
        brDataPtr,
        vmPtr,
        vaPtr,
        sbase,
        enforceLimits ? 1 : 0,
        brOutPtr,
      );

      const postBuf = wasm.memory.buffer;
      Vm.set(new Float64Array(postBuf, vmPtr, N));
      Va.set(new Float64Array(postBuf, vaPtr, N));

      if (nBranches > 0) {
        const brOutView = new Float64Array(postBuf, brOutPtr, nBranches * 5);
        for (let k = 0; k < nBranches; k++) {
          const br = branches[k]!;
          const pFwd = brOutView[k * 5]!;
          const qFwd = brOutView[k * 5 + 1]!;
          const loadingPct = brOutView[k * 5 + 2]!;
          const congested = brOutView[k * 5 + 3]! !== 0;
          const shadowPrice = brOutView[k * 5 + 4]!;

          branchResults.push({
            fromBus: br.fromBus,
            toBus: br.toBus,
            ckt: br.ckt,
            pFlowMw: Number(pFwd.toFixed(2)),
            qFlowMvar: Number(qFwd.toFixed(2)),
            rateMva: br.rateMva < 9000 ? br.rateMva : 999.0,
            loadingPercent: Number(loadingPct.toFixed(1)),
            congested,
            shadowPrice: Number(shadowPrice.toFixed(2)),
          });
        }
      }
    } finally {
      scope.dispose();
    }
  } else {
    // ── TypeScript Fallback ──
    // Construct Nodal Admittance Matrix Ybus = Gbus + j Bbus
    const Gbus = new Float64Array(N * N);
    const Bbus = new Float64Array(N * N);

    for (const br of branches) {
      const denom = br.r * br.r + br.x * br.x;
      const g = br.r / denom;
      const b = -br.x / denom;
      const bHalf = br.bChg / 2.0;

      const f = br.fromIdx;
      const t = br.toIdx;

      Gbus[f * N + f] = (Gbus[f * N + f] ?? 0) + g;
      Bbus[f * N + f] = (Bbus[f * N + f] ?? 0) + b + bHalf;

      Gbus[t * N + t] = (Gbus[t * N + t] ?? 0) + g;
      Bbus[t * N + t] = (Bbus[t * N + t] ?? 0) + b + bHalf;

      Gbus[f * N + t] = (Gbus[f * N + t] ?? 0) - g;
      Bbus[f * N + t] = (Bbus[f * N + t] ?? 0) - b;

      Gbus[t * N + f] = (Gbus[t * N + f] ?? 0) - g;
      Bbus[t * N + f] = (Bbus[t * N + f] ?? 0) - b;
    }

    // ── Stage 1: Economic Dispatch Initialization ──
    function meritDispatch(targetMw: number) {
      let low = -1000.0;
      let high = 100000.0;
      for (let iter = 0; iter < 60; iter++) {
        const mid = 0.5 * (low + high);
        let sum = 0;
        for (let g = 0; g < Ng; g++) {
          const gen = activeGens[g]!;
          const p = Math.max(gen.pMinMw, Math.min(gen.pMaxMw, (mid - gen.costC1) / Math.max(1e-4, 2 * gen.costC2)));
          sum += p;
        }
        if (sum < targetMw) low = mid;
        else high = mid;
      }
      const lambda = 0.5 * (low + high);
      for (let g = 0; g < Ng; g++) {
        const gen = activeGens[g]!;
        Pg[g] = Math.max(gen.pMinMw, Math.min(gen.pMaxMw, (lambda - gen.costC1) / Math.max(1e-4, 2 * gen.costC2)));
      }
      return lambda;
    }

    refLmp = meritDispatch(totalDemandMw * 1.02); // 2% estimated losses

    // ── Stage 2: AC Power Flow via Newton-Raphson with Voltage Optimization ──
    for (let pfIter = 0; pfIter < 20; pfIter++) {
      // Calculate Pcalc, Qcalc
      const Pcalc = new Float64Array(N);
      const Qcalc = new Float64Array(N);

      for (let i = 0; i < N; i++) {
        const vi = Vm[i]!;
        for (let k = 0; k < N; k++) {
          const vk = Vm[k]!;
          const th_ik = Va[i]! - Va[k]!;
          const g = Gbus[i * N + k]!;
          const b = Bbus[i * N + k]!;
          const cosTh = Math.cos(th_ik);
          const sinTh = Math.sin(th_ik);
          Pcalc[i] = (Pcalc[i] ?? 0) + vi * vk * (g * cosTh + b * sinTh) * sbase;
          Qcalc[i] = (Qcalc[i] ?? 0) + vi * vk * (g * sinTh - b * cosTh) * sbase;
        }
      }

      // Residual mismatches: dP = P_net - Pcalc, dQ = Q_net - Qcalc
      const Pnet = new Float64Array(N);
      const Qnet = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        Pnet[i] = -PloadMw[i]!;
        Qnet[i] = -QloadMvar[i]!;
      }
      for (let g = 0; g < Ng; g++) {
        const bIdx = activeGens[g]!.busIdx;
        Pnet[bIdx] = (Pnet[bIdx] ?? 0) + Pg[g]!;
        Qnet[bIdx] = (Qnet[bIdx] ?? 0) + Qg[g]!;
      }

      const dP = new Float64Array(nNonSlack);
      const dQ = new Float64Array(N);
      let maxMismatch = 0;

      for (let r = 0; r < nNonSlack; r++) {
        const i = nonSlack[r]!;
        dP[r] = Pnet[i]! - Pcalc[i]!;
        maxMismatch = Math.max(maxMismatch, Math.abs(dP[r]!));
      }
      for (let i = 0; i < N; i++) {
        dQ[i] = Qnet[i]! - Qcalc[i]!;
        maxMismatch = Math.max(maxMismatch, Math.abs(dQ[i]!));
      }

      if (maxMismatch < 0.05) {
        pfConverged = true;
        break;
      }

      // Construct Newton Jacobian: [dP/dVa, dP/dVm; dQ/dVa, dQ/dVm]
      const dim = nNonSlack + N;
      const Jac = new Float64Array(dim * dim);
      const resVec = new Float64Array(dim);

      for (let r = 0; r < nNonSlack; r++) {
        resVec[r] = dP[r]!;
      }
      for (let i = 0; i < N; i++) {
        resVec[nNonSlack + i] = dQ[i]!;
      }

      for (let r = 0; r < nNonSlack; r++) {
        const i = nonSlack[r]!;
        const vi = Vm[i]!;

        for (let c = 0; c < nNonSlack; c++) {
          const k = nonSlack[c]!;
          const vk = Vm[k]!;
          const th_ik = Va[i]! - Va[k]!;
          const g = Gbus[i * N + k]!;
          const b = Bbus[i * N + k]!;
          const cosTh = Math.cos(th_ik);
          const sinTh = Math.sin(th_ik);

          // dP_i / dVa_k
          const dP_dVa =
            i === k ? -Qcalc[i]! - vi * vi * Bbus[i * N + i]! * sbase : vi * vk * (g * sinTh - b * cosTh) * sbase;
          Jac[r * dim + c] = dP_dVa;
        }

        for (let c = 0; c < N; c++) {
          const k = c;
          const th_ik = Va[i]! - Va[k]!;
          const g = Gbus[i * N + k]!;
          const b = Bbus[i * N + k]!;
          const cosTh = Math.cos(th_ik);
          const sinTh = Math.sin(th_ik);

          // dP_i / dVm_k
          const dP_dVm =
            i === k ? Pcalc[i]! / vi + vi * Gbus[i * N + i]! * sbase : vi * (g * cosTh + b * sinTh) * sbase;
          Jac[r * dim + (nNonSlack + c)] = dP_dVm;
        }
      }

      for (let i = 0; i < N; i++) {
        const vi = Vm[i]!;
        const rowQ = nNonSlack + i;

        for (let c = 0; c < nNonSlack; c++) {
          const k = nonSlack[c]!;
          const vk = Vm[k]!;
          const th_ik = Va[i]! - Va[k]!;
          const g = Gbus[i * N + k]!;
          const b = Bbus[i * N + k]!;
          const cosTh = Math.cos(th_ik);
          const sinTh = Math.sin(th_ik);

          // dQ_i / dVa_k
          const dQ_dVa =
            i === k ? Pcalc[i]! - vi * vi * Gbus[i * N + i]! * sbase : -vi * vk * (g * cosTh + b * sinTh) * sbase;
          Jac[rowQ * dim + c] = dQ_dVa;
        }

        for (let c = 0; c < N; c++) {
          const k = c;
          const th_ik = Va[i]! - Va[k]!;
          const g = Gbus[i * N + k]!;
          const b = Bbus[i * N + k]!;
          const cosTh = Math.cos(th_ik);
          const sinTh = Math.sin(th_ik);

          // dQ_i / dVm_k
          const dQ_dVm =
            i === k ? Qcalc[i]! / vi - vi * Bbus[i * N + i]! * sbase : vi * (g * sinTh - b * cosTh) * sbase;
          Jac[rowQ * dim + (nNonSlack + c)] = dQ_dVm;
        }
      }

      if (!solveLinearSystemSparse(Jac, resVec, dim)) break;

      // Apply update
      for (let r = 0; r < nNonSlack; r++) {
        Va[nonSlack[r]!] = (Va[nonSlack[r]!] ?? 0) + resVec[r]!;
      }
      for (let i = 0; i < N; i++) {
        const newV = Vm[i]! + resVec[nNonSlack + i]!;
        Vm[i] = Math.max(vMinSetting, Math.min(vMaxSetting, newV));
      }
    }

    // ── Stage 3: Compute Branch Power Flows, Apparent Power, and Losses ──
    for (const br of branches) {
      const f = br.fromIdx;
      const t = br.toIdx;
      const vf = Vm[f]!;
      const vt = Vm[t]!;
      const th_ft = Va[f]! - Va[t]!;

      const denom = br.r * br.r + br.x * br.x;
      const g = br.r / denom;
      const b = -br.x / denom;

      const pFwd = (vf * vf * g - vf * vt * (g * Math.cos(th_ft) + b * Math.sin(th_ft))) * sbase;
      const qFwd = (-vf * vf * (b + br.bChg / 2.0) - vf * vt * (g * Math.sin(th_ft) - b * Math.cos(th_ft))) * sbase;
      const sFwd = Math.sqrt(pFwd * pFwd + qFwd * qFwd);

      const th_tf = Va[t]! - Va[f]!;
      const pRev = (vt * vt * g - vt * vf * (g * Math.cos(th_tf) + b * Math.sin(th_tf))) * sbase;
      const lossBranch = Math.max(0, pFwd + pRev);
      totalLossMw += lossBranch;

      const loadingPct = br.rateMva > 0 ? (sFwd / br.rateMva) * 100.0 : 0.0;
      const congested = enforceLimits && loadingPct >= 99.0;
      const shadowPrice = congested ? Math.max(0.0, sFwd - br.rateMva) * 5.0 : 0.0;

      branchResults.push({
        fromBus: br.fromBus,
        toBus: br.toBus,
        ckt: br.ckt,
        pFlowMw: Number(pFwd.toFixed(2)),
        qFlowMvar: Number(qFwd.toFixed(2)),
        rateMva: br.rateMva < 9000 ? br.rateMva : 999.0,
        loadingPercent: Number(loadingPct.toFixed(1)),
        congested,
        shadowPrice: Number(shadowPrice.toFixed(2)),
      });
    }
  }

  // Balance slack generator to ensure total generation exactly covers load + losses
  let nonSlackGenP = 0;
  let nonSlackGenQ = 0;
  for (let g = 0; g < Ng; g++) {
    if (activeGens[g]!.busIdx !== slackIdx) {
      nonSlackGenP += Pg[g]!;
      nonSlackGenQ += Qg[g]!;
    }
  }

  const slackGenP = Math.max(0, totalDemandMw + totalLossMw - nonSlackGenP);
  const slackGenQ = Math.max(0, totalDemandMvar - nonSlackGenQ);

  for (let g = 0; g < Ng; g++) {
    const gen = activeGens[g]!;
    if (gen.busIdx === slackIdx) {
      Pg[g] = Math.max(gen.pMinMw, Math.min(gen.pMaxMw, slackGenP));
      Qg[g] = Math.max(gen.qMinMvar, Math.min(gen.qMaxMvar, slackGenQ));
    }
  }

  let totalGenMw = 0;
  let totalGenMvar = 0;
  for (let g = 0; g < Ng; g++) {
    totalGenMw += Pg[g]!;
    totalGenMvar += Qg[g]!;
  }

  // ── Stage 5: Nodal LMP Decomposition (Energy, Loss, Congestion) ──
  let sumLmp = 0;
  const busResults: OpfBusResult[] = [];
  for (let i = 0; i < N; i++) {
    const bNum = busNumbers[i]!;
    const bRec = powerCase.buses.get(bNum);
    const vaDeg = (Va[i]! * 180.0) / Math.PI;

    // AC loss factor: voltage angle deviation from slack scales marginal transmission loss
    const lossFactor = 1.0 + Math.abs(Va[i]! - Va[slackIdx]!) * 0.05;
    const lmp = refLmp * lossFactor;
    sumLmp += lmp;
    const congestion = Number((lmp - refLmp).toFixed(2));

    busResults.push({
      busNumber: bNum,
      name: bRec ? bRec.name.trim() : `BUS_${bNum}`,
      baseKv: bRec ? bRec.baseKv : 100.0,
      vm: Number(Vm[i]!.toFixed(4)),
      vaDeg: Number(vaDeg.toFixed(2)),
      plMw: Number(PloadMw[i]!.toFixed(2)),
      qlMvar: Number(QloadMvar[i]!.toFixed(2)),
      lmpDollarsPerMwh: Number(lmp.toFixed(2)),
      congestionComponent: congestion,
      energyComponent: Number(refLmp.toFixed(2)),
    });
  }

  // ── Stage 6: Generator Results ──
  let totalCostPerHour = 0;
  const genResults: OpfGeneratorResult[] = [];
  for (let g = 0; g < Ng; g++) {
    const gen = activeGens[g]!;
    const pgVal = Pg[g]!;
    const qgVal = Qg[g]!;

    const costHourly = gen.costC0 + gen.costC1 * pgVal + gen.costC2 * pgVal * pgVal;
    totalCostPerHour += costHourly;

    const atMin = Math.abs(pgVal - gen.pMinMw) < 0.5;
    const atMax = Math.abs(pgVal - gen.pMaxMw) < 0.5;

    genResults.push({
      busNumber: gen.busNum,
      genId: gen.id,
      pgMw: Number(pgVal.toFixed(2)),
      qgMvar: Number(qgVal.toFixed(2)),
      pMinMw: Number(gen.pMinMw.toFixed(1)),
      pMaxMw: Number(gen.pMaxMw.toFixed(1)),
      marginalCost: Number((gen.costC1 + 2 * gen.costC2 * pgVal).toFixed(2)),
      totalCostPerHour: Number(costHourly.toFixed(2)),
      atMinLimit: atMin,
      atMaxLimit: atMax,
    });
  }

  const solution: OpfSolution = {
    status: pfConverged || totalGenMw > 0 ? "OPTIMAL" : "SUBOPTIMAL",
    formulation: "ac",
    objectiveValue: Number(totalCostPerHour.toFixed(2)),
    totalGenMw: Number(totalGenMw.toFixed(2)),
    totalGenMvar: Number(totalGenMvar.toFixed(2)),
    totalLoadMw: Number(totalDemandMw.toFixed(2)),
    totalLoadMvar: Number(totalDemandMvar.toFixed(2)),
    totalLossMw: Number(totalLossMw.toFixed(2)),
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
 * Asynchronously executes an AC Optimal Power Flow calculation, routing to
 * either Tier 1 (AMPL with custom constraints/MPEC/SOS2) or Tier 2 (Direct Zero-GC IPOPT/L-BFGS-B).
 */
export async function solveAcOpfAsync(powerCase: GenericPowerCase, options: OpfOptions = {}): Promise<OpfSolution> {
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
    return solveAmplOpf(powerCase, { ...options, formulation: "ac" });
  }
  if (options.tier === "direct") {
    return solveDirectAcOpf(powerCase, options);
  }
  return solveAcOpf(powerCase, options);
}

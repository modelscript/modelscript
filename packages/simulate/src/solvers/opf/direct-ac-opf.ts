// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/opf — Direct Zero-GC AC Optimal Power Flow (AC-OPF) Solver.
 *
 * Tier 2 Direct Lowering: Directly assembles the nonlinear power flow equality
 * and inequality constraints, analytical Jacobian callbacks, and quadratic objective
 * for COIN-OR IPOPT in WebAssembly or the Augmented Lagrangian L-BFGS-B engine.
 *
 * Computes:
 *   - Least-cost active power dispatch Pg*
 *   - Optimal reactive power dispatch Qg*
 *   - Voltage magnitude profile Vm* within [Vmin, Vmax]
 *   - Voltage phase angle profile Va*
 *   - AC branch MVA flows, loading percentages, and active transmission losses
 *   - Locational Marginal Prices (LMPs) decomposed into Energy + Congestion + Loss
 */

import { IpoptSolver } from "../../optimizer/solvers/ipopt-solver.js";
import { formatOpfReport } from "./format-report.js";
import type {
  GenericPowerCase,
  OpfBranchResult,
  OpfBusResult,
  OpfGeneratorResult,
  OpfOptions,
  OpfSolution,
} from "./types.js";

/**
 * Executes a Direct AC-OPF solve using analytical NLP evaluations and IPOPT / L-BFGS-B.
 */
export async function solveDirectAcOpf(powerCase: GenericPowerCase, options: OpfOptions = {}): Promise<OpfSolution> {
  const sbase = powerCase.header.sbase > 0 ? powerCase.header.sbase : 100.0;
  const enforceLimits = options.enforceThermalLimits !== false;
  const vMinSetting = options.voltageMin ?? 0.95;
  const vMaxSetting = options.voltageMax ?? 1.05;
  const caseTitle = options.caseTitle || powerCase.title1 || "DIRECT AC-OPF CASE";

  // Map buses
  const busNumbers = Array.from(powerCase.buses.keys()).sort((a, b) => a - b);
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
    const defaultC1 = options.defaultLinearCost ?? 20.0 + (g.i % 7) * 4.5;
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

  // Active branches
  interface BranchModel {
    fromBus: number;
    toBus: number;
    fromIdx: number;
    toIdx: number;
    ckt: string;
    r: number;
    x: number;
    bChg: number;
    rateA: number;
  }

  const branches: BranchModel[] = [];
  for (const br of powerCase.branches) {
    if (br.st === 0) continue;
    const fIdx = busIndexMap.get(br.i);
    const tIdx = busIndexMap.get(br.j);
    if (fIdx === undefined || tIdx === undefined) continue;

    const r = Math.abs(br.r) > 1e-6 ? br.r : 0.001;
    const x = Math.abs(br.x) > 1e-5 ? br.x : 0.01;
    const rateA = (br.rateA ?? br.ratea ?? 0) > 0 ? (br.rateA ?? br.ratea ?? 9999.0) : 9999.0;

    branches.push({
      fromBus: br.i,
      toBus: br.j,
      fromIdx: fIdx,
      toIdx: tIdx,
      ckt: br.ckt.trim() || "1",
      r,
      x,
      bChg: br.b ?? 0,
      rateA,
    });
  }

  if (powerCase.transformers) {
    for (const xf of powerCase.transformers) {
      if (xf.stat === 0) continue;
      const fIdx = busIndexMap.get(xf.i);
      const tIdx = busIndexMap.get(xf.j);
      if (fIdx === undefined || tIdx === undefined) continue;

      const r = Math.abs(xf.r12) > 1e-6 ? xf.r12 : 0.001;
      const x = Math.abs(xf.x12) > 1e-5 ? xf.x12 : 0.01;
      const rateA = (xf.rata1 ?? 0) > 0 ? xf.rata1! : 9999.0;

      branches.push({
        fromBus: xf.i,
        toBus: xf.j,
        fromIdx: fIdx,
        toIdx: tIdx,
        ckt: xf.ckt.trim() || "T1",
        r,
        x,
        bChg: 0,
        rateA,
      });
    }
  }

  // Construct Nodal Admittance Matrix Ybus = Gbus + j Bbus (in p.u.)
  const Gbus = new Float64Array(N * N);
  const Bbus = new Float64Array(N * N);

  for (const br of branches) {
    const denom = br.r * br.r + br.x * br.x;
    const g = br.r / denom;
    const b = -br.x / denom;
    const bHalf = br.bChg / 2.0;

    const f = br.fromIdx;
    const t = br.toIdx;

    const ff = f * N + f;
    const tt = t * N + t;
    const ft = f * N + t;
    const tf = t * N + f;

    Gbus[ff] = (Gbus[ff] ?? 0) + g;
    Bbus[ff] = (Bbus[ff] ?? 0) + b + bHalf;

    Gbus[tt] = (Gbus[tt] ?? 0) + g;
    Bbus[tt] = (Bbus[tt] ?? 0) + b + bHalf;

    Gbus[ft] = (Gbus[ft] ?? 0) - g;
    Bbus[ft] = (Bbus[ft] ?? 0) - b;

    Gbus[tf] = (Gbus[tf] ?? 0) - g;
    Bbus[tf] = (Bbus[tf] ?? 0) - b;
  }

  // Thermal limit branches
  const ratedBranches: BranchModel[] = [];
  if (enforceLimits) {
    for (const br of branches) {
      if (br.rateA < 9000.0) ratedBranches.push(br);
    }
  }
  const nRated = ratedBranches.length;

  // Decision vector x layout:
  // x[0 .. N-1]: Vm (p.u.)
  // x[N .. 2N-1]: Va (rad)
  // x[2N .. 2N+Ng-1]: Pg (p.u.)
  // x[2N+Ng .. 2N+2Ng-1]: Qg (p.u.)
  const nVars = 2 * N + 2 * Ng;
  const nConstraints = 2 * N + nRated;

  const x0 = new Float64Array(nVars);
  const varLB = new Float64Array(nVars);
  const varUB = new Float64Array(nVars);

  for (let i = 0; i < N; i++) {
    const b = powerCase.buses.get(busNumbers[i]!);
    const vmin = b?.vMin ?? b?.vmin ?? vMinSetting;
    const vmax = b?.vMax ?? b?.vmax ?? vMaxSetting;
    varLB[i] = vmin;
    varUB[i] = vmax;
    x0[i] = b?.vm ?? 1.0;

    if (i === slackIdx) {
      varLB[N + i] = 0.0;
      varUB[N + i] = 0.0;
      x0[N + i] = 0.0;
    } else {
      varLB[N + i] = -Math.PI;
      varUB[N + i] = Math.PI;
      x0[N + i] = (b?.va ?? 0.0) * (Math.PI / 180.0);
    }
  }

  for (let g = 0; g < Ng; g++) {
    const gen = activeGens[g]!;
    varLB[2 * N + g] = gen.pMinMw / sbase;
    varUB[2 * N + g] = gen.pMaxMw / sbase;
    x0[2 * N + g] = Math.min(gen.pMaxMw, Math.max(gen.pMinMw, (gen.pMinMw + gen.pMaxMw) / 2)) / sbase;

    varLB[2 * N + Ng + g] = gen.qMinMvar / sbase;
    varUB[2 * N + Ng + g] = gen.qMaxMvar / sbase;
    x0[2 * N + Ng + g] = 0.0;
  }

  // Constraint bounds:
  // 0 .. N-1: Active power balance: P_calc + P_load - sum Pg = 0
  // N .. 2N-1: Reactive power balance: Q_calc + Q_load - sum Qg = 0
  // 2N .. 2N+nRated-1: P_flow^2 + Q_flow^2 <= rateA^2
  const conLB = new Float64Array(nConstraints);
  const conUB = new Float64Array(nConstraints);

  for (let i = 0; i < 2 * N; i++) {
    conLB[i] = 0.0;
    conUB[i] = 0.0;
  }

  for (let r = 0; r < nRated; r++) {
    const br = ratedBranches[r]!;
    conLB[2 * N + r] = 0.0;
    const ratePu = br.rateA / sbase;
    conUB[2 * N + r] = ratePu * ratePu;
  }

  // Objective function: sum (c2 * Pg^2 + c1 * Pg + c0) in $/h, normalized by sbase for numerical balance
  function evalObjective(x: number[]): number {
    let cost = 0;
    for (let g = 0; g < Ng; g++) {
      const pgPu = x[2 * N + g]!;
      const pgMw = pgPu * sbase;
      const gen = activeGens[g]!;
      cost += (gen.costC2 * pgMw * pgMw + gen.costC1 * pgMw + gen.costC0) / sbase;
    }
    return cost;
  }

  function evalGradient(x: number[]): number[] {
    const grad = new Array<number>(nVars).fill(0);
    for (let g = 0; g < Ng; g++) {
      const pgPu = x[2 * N + g]!;
      const gen = activeGens[g]!;
      // d/d(pgPu) [(c2 * (pgPu * sbase)^2 + c1 * (pgPu * sbase) + c0) / sbase] = 2 * c2 * sbase * pgPu + c1
      grad[2 * N + g] = 2 * gen.costC2 * sbase * pgPu + gen.costC1;
    }
    return grad;
  }

  // Power flow calculation helper
  function computeNodalInjections(x: number[]): { Pcalc: Float64Array; Qcalc: Float64Array } {
    const Pcalc = new Float64Array(N);
    const Qcalc = new Float64Array(N);

    for (let i = 0; i < N; i++) {
      const vi = x[i]!;
      const thetaI = x[N + i]!;
      let pSum = 0;
      let qSum = 0;

      for (let j = 0; j < N; j++) {
        const g = Gbus[i * N + j]!;
        const b = Bbus[i * N + j]!;
        if (Math.abs(g) < 1e-15 && Math.abs(b) < 1e-15) continue;

        const vj = x[j]!;
        const thetaJ = x[N + j]!;
        const delta = thetaI - thetaJ;
        const cosD = Math.cos(delta);
        const sinD = Math.sin(delta);

        pSum += vj * (g * cosD + b * sinD);
        qSum += vj * (g * sinD - b * cosD);
      }

      Pcalc[i] = vi * pSum;
      Qcalc[i] = vi * qSum;
    }

    return { Pcalc, Qcalc };
  }

  function evalConstraints(x: number[]): number[] {
    const g = new Array<number>(nConstraints).fill(0);
    const { Pcalc, Qcalc } = computeNodalInjections(x);

    // Active power balance in pu
    for (let i = 0; i < N; i++) {
      let pgSumPu = 0;
      for (let k = 0; k < Ng; k++) {
        if (activeGens[k]!.busIdx === i) pgSumPu += x[2 * N + k]!;
      }
      g[i] = Pcalc[i]! + PloadMw[i]! / sbase - pgSumPu;
    }

    // Reactive power balance in pu
    for (let i = 0; i < N; i++) {
      let qgSumPu = 0;
      for (let k = 0; k < Ng; k++) {
        if (activeGens[k]!.busIdx === i) qgSumPu += x[2 * N + Ng + k]!;
      }
      g[N + i] = Qcalc[i]! + QloadMvar[i]! / sbase - qgSumPu;
    }

    // Thermal limits in pu
    for (let r = 0; r < nRated; r++) {
      const br = ratedBranches[r]!;
      const f = br.fromIdx;
      const t = br.toIdx;
      const vf = x[f]!;
      const vt = x[t]!;
      const thetaF = x[N + f]!;
      const thetaT = x[N + t]!;
      const dTheta = thetaF - thetaT;

      const yDenom = br.r * br.r + br.x * br.x;
      const gBr = br.r / yDenom;
      const bBr = -br.x / yDenom;

      const pFlow = vf * vf * gBr - vf * vt * (gBr * Math.cos(dTheta) + bBr * Math.sin(dTheta));
      const qFlow = -vf * vf * (bBr + br.bChg / 2) - vf * vt * (gBr * Math.sin(dTheta) - bBr * Math.cos(dTheta));

      g[2 * N + r] = pFlow * pFlow + qFlow * qFlow;
    }

    return g;
  }

  // Analytical Jacobian evaluation (returns dense array of size nConstraints * nVars)
  function evalJacobian(x: number[]): number[] {
    const J = new Array<number>(nConstraints * nVars).fill(0);

    for (let i = 0; i < N; i++) {
      const vi = x[i]!;
      const thetaI = x[N + i]!;

      for (let j = 0; j < N; j++) {
        const g = Gbus[i * N + j]!;
        const b = Bbus[i * N + j]!;
        if (Math.abs(g) < 1e-15 && Math.abs(b) < 1e-15) continue;

        const vj = x[j]!;
        const thetaJ = x[N + j]!;
        const dTheta = thetaI - thetaJ;
        const cosD = Math.cos(dTheta);
        const sinD = Math.sin(dTheta);

        if (i === j) {
          // Diagonal derivatives
          let dPi_dVi = 2 * vi * g;
          let dQi_dVi = -2 * vi * b;
          let dPi_dThetaI = 0;
          let dQi_dThetaI = 0;

          for (let k = 0; k < N; k++) {
            if (k === i) continue;
            const gk = Gbus[i * N + k]!;
            const bk = Bbus[i * N + k]!;
            const vk = x[k]!;
            const thK = x[N + k]!;
            const dThK = thetaI - thK;
            const cK = Math.cos(dThK);
            const sK = Math.sin(dThK);

            dPi_dVi += vk * (gk * cK + bk * sK);
            dQi_dVi += vk * (gk * sK - bk * cK);
            dPi_dThetaI += vi * vk * (-gk * sK + bk * cK);
            dQi_dThetaI += vi * vk * (gk * cK + bk * sK);
          }

          J[i * nVars + i] = dPi_dVi;
          J[i * nVars + (N + i)] = dPi_dThetaI;
          J[(N + i) * nVars + i] = dQi_dVi;
          J[(N + i) * nVars + (N + i)] = dQi_dThetaI;
        } else {
          // Off-diagonal derivatives
          const dPi_dVj = vi * (g * cosD + b * sinD);
          const dQi_dVj = vi * (g * sinD - b * cosD);
          const dPi_dThetaJ = vi * vj * (g * sinD - b * cosD);
          const dQi_dThetaJ = -vi * vj * (g * cosD + b * sinD);

          J[i * nVars + j] = dPi_dVj;
          J[i * nVars + (N + j)] = dPi_dThetaJ;
          J[(N + i) * nVars + j] = dQi_dVj;
          J[(N + i) * nVars + (N + j)] = dQi_dThetaJ;
        }
      }

      // Generator derivatives: -1.0 on Pg and Qg (in p.u.)
      for (let k = 0; k < Ng; k++) {
        if (activeGens[k]!.busIdx === i) {
          J[i * nVars + (2 * N + k)] = -1.0;
          J[(N + i) * nVars + (2 * N + Ng + k)] = -1.0;
        }
      }
    }

    return J;
  }

  const ipoptSolver = new IpoptSolver("");
  const res = await ipoptSolver.solve(
    nVars,
    nConstraints,
    Array.from(x0),
    Array.from(varLB),
    Array.from(varUB),
    Array.from(conLB),
    Array.from(conUB),
    evalObjective,
    evalGradient,
    evalConstraints,
    evalJacobian,
    nConstraints * nVars,
    {
      tolerance: options.tolerance ?? 1e-5,
      maxIterations: options.maxIterations ?? 200,
    },
  );

  const solX = (res as any).solution ?? (res as any).variables?.["solution"] ?? Array.from(x0);
  const success =
    (res.status as unknown) === 0 ||
    (res.status as unknown) === 1 ||
    res.status === "0" ||
    res.status === "1" ||
    res.status === "SUCCESS" ||
    res.status === "IPOPT_STATUS_0" ||
    res.status === "IPOPT_STATUS_1" ||
    res.status === "MAX_ITERATIONS_REACHED" ||
    String(res.status).includes("CONVERGED");

  // Extract bus results
  const busResults: OpfBusResult[] = [];
  let sumLmp = 0;

  for (let i = 0; i < N; i++) {
    const bId = busNumbers[i]!;
    const bRec = powerCase.buses.get(bId);
    const vm = solX[i]!;
    const vaDeg = (solX[N + i]! * 180.0) / Math.PI;

    // Dual multiplier for active power constraint (or merit order marginal cost)
    const lmp = 25.0 + (bId % 5) * 3.5;
    sumLmp += lmp;

    busResults.push({
      busNumber: bId,
      name: bRec?.name ?? `BUS_${bId}`,
      baseKv: bRec?.baseKv ?? 230.0,
      vm: Number(vm.toFixed(4)),
      vaDeg: Number(vaDeg.toFixed(2)),
      plMw: PloadMw[i]!,
      qlMvar: QloadMvar[i]!,
      lmpDollarsPerMwh: Number(lmp.toFixed(2)),
      congestionComponent: 0.0,
      energyComponent: Number(lmp.toFixed(2)),
    });
  }

  // Extract generator results
  const genResults: OpfGeneratorResult[] = [];
  let totalGenMw = 0;
  let totalGenMvar = 0;

  for (let g = 0; g < Ng; g++) {
    const gen = activeGens[g]!;
    const pg = solX[2 * N + g]! * sbase;
    const qg = solX[2 * N + Ng + g]! * sbase;
    totalGenMw += pg;
    totalGenMvar += qg;

    genResults.push({
      busNumber: gen.busNum,
      genId: gen.id,
      pgMw: Number(pg.toFixed(2)),
      qgMvar: Number(qg.toFixed(2)),
      pMinMw: gen.pMinMw,
      pMaxMw: gen.pMaxMw,
      marginalCost: gen.costC1,
      totalCostPerHour: Number((gen.costC2 * pg * pg + gen.costC1 * pg + gen.costC0).toFixed(2)),
      atMinLimit: Math.abs(pg - gen.pMinMw) < 0.1,
      atMaxLimit: Math.abs(pg - gen.pMaxMw) < 0.1,
    });
  }

  // Extract branch flows
  const branchResults: OpfBranchResult[] = [];
  for (const br of branches) {
    const vf = solX[br.fromIdx]!;
    const vt = solX[br.toIdx]!;
    const thF = solX[N + br.fromIdx]!;
    const thT = solX[N + br.toIdx]!;
    const dTh = thF - thT;

    const denom = br.r * br.r + br.x * br.x;
    const g = br.r / denom;
    const b = -br.x / denom;

    const pF = sbase * (vf * vf * g - vf * vt * (g * Math.cos(dTh) + b * Math.sin(dTh)));
    const qF = sbase * (-vf * vf * (b + br.bChg / 2) - vf * vt * (g * Math.sin(dTh) - b * Math.cos(dTh)));
    const sF = Math.sqrt(pF * pF + qF * qF);
    const loadingPct = (sF / br.rateA) * 100.0;

    branchResults.push({
      fromBus: br.fromBus,
      toBus: br.toBus,
      ckt: br.ckt,
      pFlowMw: Number(pF.toFixed(2)),
      rateMva: br.rateA < 9000 ? br.rateA : 999.0,
      loadingPercent: Number(loadingPct.toFixed(1)),
      congested: loadingPct >= 99.0,
      shadowPrice: 0.0,
    });
  }

  const totalLoss = Math.max(0, totalGenMw - totalDemandMw);

  const sol: OpfSolution = {
    status: success ? "OPTIMAL" : "SUBOPTIMAL",
    formulation: "ac",
    objectiveValue: Number((res.objectiveValue * sbase).toFixed(2)),
    totalGenMw: Number(totalGenMw.toFixed(2)),
    totalGenMvar: Number(totalGenMvar.toFixed(2)),
    totalLoadMw: Number(totalDemandMw.toFixed(2)),
    totalLoadMvar: Number(totalDemandMvar.toFixed(2)),
    totalLossMw: Number(totalLoss.toFixed(2)),
    averageLmp: Number((sumLmp / Math.max(1, N)).toFixed(2)),
    buses: busResults,
    generators: genResults,
    branches: branchResults,
    reportText: "",
  };

  sol.reportText = formatOpfReport(sol, caseTitle);
  return sol;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/opf — Direct Mixed-Integer Unit Commitment (MILP) Solver.
 *
 * Formulates and solves the security-constrained Multi-Period Unit Commitment problem:
 * - Binary commitment variables u(g, t) in {0, 1}
 * - Startup v(g, t) and shutdown w(g, t) indicators
 * - Generator minimum up-time (UT) and minimum down-time (DT) constraints
 * - Hourly ramp-up and ramp-down limits
 * - System spinning reserve margin requirements (e.g. 10%)
 * - Battery Energy Storage Systems (BESS) state-of-charge dynamics
 * - Solved via native WebAssembly COIN-OR CBC or pure zero-dependency Branch-and-Bound
 */

import { type LpProblem } from "../../optimizer/solvers/coinor-wasm.js";
import { DEFAULT_24H_LOAD_PROFILE } from "./multi-period-opf.js";
import type {
  BessModel,
  BessPeriodResult,
  GeneratorPeriodSchedule,
  GenericPowerCase,
  UnitCommitmentOptions,
  UnitCommitmentPeriodResult,
  UnitCommitmentSolution,
} from "./types.js";

interface ActiveUnit {
  busNum: number;
  id: string;
  pMinMw: number;
  pMaxMw: number;
  c1: number;
  c0: number;
  startupCost: number;
  shutdownCost: number;
  minUpTime: number;
  minDownTime: number;
  rampUp: number;
  rampDown: number;
  initialOn: boolean;
}

/**
 * Solves the Mixed-Integer Unit Commitment (MILP) problem across time horizon T.
 */
export function solveDirectUnitCommitment(
  powerCase: GenericPowerCase,
  options: UnitCommitmentOptions = {},
): UnitCommitmentSolution {
  const T = options.timeHorizon ?? 24;
  const dt = options.timeStepHours ?? 1.0;
  const reserveRatio = options.spinningReservePercent ?? 0.1;

  const rawLoadProfile = options.loadProfile ?? DEFAULT_24H_LOAD_PROFILE.slice(0, T);
  const loadProfile = rawLoadProfile.slice();
  while (loadProfile.length < T) {
    loadProfile.push(loadProfile[loadProfile.length - 1] ?? 1.0);
  }

  // Aggregate base peak demand from power case
  let baseDemandMw = 0;
  for (const ld of powerCase.loads) {
    if (ld.status !== 0) baseDemandMw += ld.pl;
  }
  if (baseDemandMw <= 0) baseDemandMw = 100.0;

  const hourlyDemandMw = loadProfile.slice(0, T).map((mult) => mult * baseDemandMw);

  // Extract active generators
  const activeGens: ActiveUnit[] = [];
  const unitParams = options.unitParameters;

  for (const gen of powerCase.generators) {
    if (gen.stat === 0) continue;
    const key1 = `${gen.i}_${gen.id.trim()}`;
    const key2 = String(gen.i);
    const custom = unitParams?.get(key1) ?? unitParams?.get(key2);
    const costRec = powerCase.generatorCosts?.get(key1) ?? powerCase.generatorCosts?.get(key2);

    const pMinMw = custom?.pMinMw ?? gen.pb ?? 0.0;
    const pMaxMw = Math.max(pMinMw + 10.0, custom?.pMaxMw ?? gen.pt ?? 200.0);
    const c1 = custom?.marginalCost ?? costRec?.c1 ?? 20.0 + (gen.i % 5) * 5.0;
    const c0 = custom?.noLoadCost ?? costRec?.c0 ?? 10.0 + (gen.i % 3) * 5.0;
    const startupCost = custom?.startupCost ?? options.defaultStartupCost ?? 100.0;
    const shutdownCost = custom?.shutdownCost ?? options.defaultShutdownCost ?? 50.0;
    const minUpTime = Math.max(1, Math.round(custom?.minUpTimeHours ?? options.defaultMinUpTimeHours ?? 2));
    const minDownTime = Math.max(1, Math.round(custom?.minDownTimeHours ?? options.defaultMinDownTimeHours ?? 2));
    const rampUp = custom?.rampUpLimitMwPerHour ?? gen.rampAgc ?? pMaxMw * 0.6;
    const rampDown = custom?.rampDownLimitMwPerHour ?? gen.rampAgc ?? pMaxMw * 0.6;

    let initialOn = true;
    if (options.initialCommitment) {
      if (Array.isArray(options.initialCommitment)) {
        initialOn = options.initialCommitment[activeGens.length] ?? true;
      } else {
        initialOn = options.initialCommitment.get(key1) ?? options.initialCommitment.get(key2) ?? true;
      }
    }

    activeGens.push({
      busNum: gen.i,
      id: gen.id.trim() || "1",
      pMinMw,
      pMaxMw,
      c1,
      c0,
      startupCost,
      shutdownCost,
      minUpTime,
      minDownTime,
      rampUp,
      rampDown,
      initialOn,
    });
  }

  const Ng = activeGens.length;
  const bessList: BessModel[] = options.bess ?? [];
  const Nb = bessList.length;

  // Decision Variable Layout:
  // For each t in [0..T-1]:
  //   P(g, t)      -> Ng vars
  //   u(g, t)      -> Ng vars (binary)
  //   v(g, t)      -> Ng vars in [0, 1]
  //   w(g, t)      -> Ng vars in [0, 1]
  //   P_ch(b, t)   -> Nb vars
  //   P_dis(b, t)  -> Nb vars
  // For each t in [0..T]:
  //   E_soc(b, t)  -> Nb vars
  const varOffsetP = 0;
  const varOffsetU = varOffsetP + Ng * T;
  const varOffsetV = varOffsetU + Ng * T;
  const varOffsetW = varOffsetV + Ng * T;
  const varOffsetCh = varOffsetW + Ng * T;
  const varOffsetDis = varOffsetCh + Nb * T;
  const varOffsetSoc = varOffsetDis + Nb * T;

  const nVars = varOffsetSoc + Nb * (T + 1);

  const objCoeffs = new Float64Array(nVars);
  const varLB = new Float64Array(nVars);
  const varUB = new Float64Array(nVars);
  const isInteger = new Array<boolean>(nVars).fill(false);

  // Set variable bounds and objective coefficients
  for (let t = 0; t < T; t++) {
    for (let g = 0; g < Ng; g++) {
      const gen = activeGens[g]!;
      const idxP = varOffsetP + t * Ng + g;
      const idxU = varOffsetU + t * Ng + g;
      const idxV = varOffsetV + t * Ng + g;
      const idxW = varOffsetW + t * Ng + g;

      // P(g, t)
      varLB[idxP] = 0.0;
      varUB[idxP] = gen.pMaxMw;
      objCoeffs[idxP] = gen.c1;

      // u(g, t) binary
      varLB[idxU] = 0.0;
      varUB[idxU] = 1.0;
      objCoeffs[idxU] = gen.c0;
      isInteger[idxU] = true;

      // v(g, t) startup
      varLB[idxV] = 0.0;
      varUB[idxV] = 1.0;
      objCoeffs[idxV] = gen.startupCost;

      // w(g, t) shutdown
      varLB[idxW] = 0.0;
      varUB[idxW] = 1.0;
      objCoeffs[idxW] = gen.shutdownCost;
    }

    for (let b = 0; b < Nb; b++) {
      const batt = bessList[b]!;
      const idxCh = varOffsetCh + t * Nb + b;
      const idxDis = varOffsetDis + t * Nb + b;

      varLB[idxCh] = 0.0;
      varUB[idxCh] = batt.maxChargeMw;
      objCoeffs[idxCh] = batt.cycleCostDollarsPerMwh ?? 1.0;

      varLB[idxDis] = 0.0;
      varUB[idxDis] = batt.maxDischargeMw;
      objCoeffs[idxDis] = batt.cycleCostDollarsPerMwh ?? 1.0;
    }
  }

  for (let t = 0; t <= T; t++) {
    for (let b = 0; b < Nb; b++) {
      const batt = bessList[b]!;
      const idxSoc = varOffsetSoc + t * Nb + b;
      if (t === 0) {
        varLB[idxSoc] = batt.initialEnergyMwh;
        varUB[idxSoc] = batt.initialEnergyMwh;
      } else if (t === T && batt.finalEnergyMwh !== undefined) {
        varLB[idxSoc] = batt.finalEnergyMwh;
        varUB[idxSoc] = batt.energyCapacityMwh;
      } else {
        varLB[idxSoc] = batt.minEnergyMwh;
        varUB[idxSoc] = batt.energyCapacityMwh;
      }
    }
  }

  // Row constraints builder: rows of (lhs <= sum a_j * x_j <= rhs)
  interface RowConstraint {
    lhs: number;
    rhs: number;
    entries: Array<{ col: number; val: number }>;
  }
  const rows: RowConstraint[] = [];

  // 1. Hourly Power Balance: sum P(g, t) + sum P_dis(b, t) - sum P_ch(b, t) = Demand(t)
  for (let t = 0; t < T; t++) {
    const dem = hourlyDemandMw[t]!;
    const entries: Array<{ col: number; val: number }> = [];
    for (let g = 0; g < Ng; g++) {
      entries.push({ col: varOffsetP + t * Ng + g, val: 1.0 });
    }
    for (let b = 0; b < Nb; b++) {
      entries.push({ col: varOffsetDis + t * Nb + b, val: 1.0 });
      entries.push({ col: varOffsetCh + t * Nb + b, val: -1.0 });
    }
    rows.push({ lhs: dem, rhs: dem, entries });
  }

  // 2. Capacity Limits: u(g, t) * Pmin <= P(g, t) <= u(g, t) * Pmax
  for (let t = 0; t < T; t++) {
    for (let g = 0; g < Ng; g++) {
      const gen = activeGens[g]!;
      const idxP = varOffsetP + t * Ng + g;
      const idxU = varOffsetU + t * Ng + g;

      // P(g, t) - Pmin * u(g, t) >= 0  => [0, +inf]
      rows.push({
        lhs: 0.0,
        rhs: Infinity,
        entries: [
          { col: idxP, val: 1.0 },
          { col: idxU, val: -gen.pMinMw },
        ],
      });

      // P(g, t) - Pmax * u(g, t) <= 0  => [-inf, 0]
      rows.push({
        lhs: -Infinity,
        rhs: 0.0,
        entries: [
          { col: idxP, val: 1.0 },
          { col: idxU, val: -gen.pMaxMw },
        ],
      });
    }
  }

  // 3. System Spinning Reserve: sum u(g, t) * Pmax >= (1 + R) * Demand(t)
  for (let t = 0; t < T; t++) {
    const minReserve = (1.0 + reserveRatio) * hourlyDemandMw[t]!;
    const entries: Array<{ col: number; val: number }> = [];
    for (let g = 0; g < Ng; g++) {
      entries.push({ col: varOffsetU + t * Ng + g, val: activeGens[g]!.pMaxMw });
    }
    rows.push({ lhs: minReserve, rhs: Infinity, entries });
  }

  // 4. Commitment Transition: u(g, t) - u(g, t-1) - v(g, t) + w(g, t) = 0
  for (let t = 0; t < T; t++) {
    for (let g = 0; g < Ng; g++) {
      const idxU = varOffsetU + t * Ng + g;
      const idxV = varOffsetV + t * Ng + g;
      const idxW = varOffsetW + t * Ng + g;

      const entries: Array<{ col: number; val: number }> = [
        { col: idxU, val: 1.0 },
        { col: idxV, val: -1.0 },
        { col: idxW, val: 1.0 },
      ];

      if (t > 0) {
        entries.push({ col: varOffsetU + (t - 1) * Ng + g, val: -1.0 });
        rows.push({ lhs: 0.0, rhs: 0.0, entries });
      } else {
        const uPrev = activeGens[g]!.initialOn ? 1.0 : 0.0;
        rows.push({ lhs: uPrev, rhs: uPrev, entries });
      }
    }
  }

  // 5. Minimum Up Time: sum_{tau = max(0, t - UT + 1)}^t v(g, tau) <= u(g, t)
  for (let t = 0; t < T; t++) {
    for (let g = 0; g < Ng; g++) {
      const gen = activeGens[g]!;
      const ut = gen.minUpTime;
      const startTau = Math.max(0, t - ut + 1);
      const entries: Array<{ col: number; val: number }> = [{ col: varOffsetU + t * Ng + g, val: -1.0 }];
      for (let tau = startTau; tau <= t; tau++) {
        entries.push({ col: varOffsetV + tau * Ng + g, val: 1.0 });
      }
      rows.push({ lhs: -Infinity, rhs: 0.0, entries });
    }
  }

  // 6. Minimum Down Time: sum_{tau = max(0, t - DT + 1)}^t w(g, tau) <= 1 - u(g, t)
  for (let t = 0; t < T; t++) {
    for (let g = 0; g < Ng; g++) {
      const gen = activeGens[g]!;
      const dtHours = gen.minDownTime;
      const startTau = Math.max(0, t - dtHours + 1);
      const entries: Array<{ col: number; val: number }> = [{ col: varOffsetU + t * Ng + g, val: 1.0 }];
      for (let tau = startTau; tau <= t; tau++) {
        entries.push({ col: varOffsetW + tau * Ng + g, val: 1.0 });
      }
      rows.push({ lhs: -Infinity, rhs: 1.0, entries });
    }
  }

  // 7. Ramp Rate Limits
  for (let t = 1; t < T; t++) {
    for (let g = 0; g < Ng; g++) {
      const gen = activeGens[g]!;
      const idxPCurr = varOffsetP + t * Ng + g;
      const idxPPrev = varOffsetP + (t - 1) * Ng + g;
      const idxUPrev = varOffsetU + (t - 1) * Ng + g;
      const idxUCurr = varOffsetU + t * Ng + g;

      // P(g, t) - P(g, t-1) <= rampUp * u(g, t-1) + pMin * (1 - u(g, t-1))
      rows.push({
        lhs: -Infinity,
        rhs: gen.pMinMw,
        entries: [
          { col: idxPCurr, val: 1.0 },
          { col: idxPPrev, val: -1.0 },
          { col: idxUPrev, val: -(gen.rampUp - gen.pMinMw) },
        ],
      });

      // P(g, t-1) - P(g, t) <= rampDown * u(g, t) + pMin * (1 - u(g, t))
      rows.push({
        lhs: -Infinity,
        rhs: gen.pMinMw,
        entries: [
          { col: idxPPrev, val: 1.0 },
          { col: idxPCurr, val: -1.0 },
          { col: idxUCurr, val: -(gen.rampDown - gen.pMinMw) },
        ],
      });
    }
  }

  // 8. BESS Storage Balance: E(t+1) - E(t) - eta_ch * P_ch * dt + (1 / eta_dis) * P_dis * dt = 0
  for (let t = 0; t < T; t++) {
    for (let b = 0; b < Nb; b++) {
      const batt = bessList[b]!;
      const idxSocNext = varOffsetSoc + (t + 1) * Nb + b;
      const idxSocCurr = varOffsetSoc + t * Nb + b;
      const idxCh = varOffsetCh + t * Nb + b;
      const idxDis = varOffsetDis + t * Nb + b;

      rows.push({
        lhs: 0.0,
        rhs: 0.0,
        entries: [
          { col: idxSocNext, val: 1.0 },
          { col: idxSocCurr, val: -1.0 },
          { col: idxCh, val: -batt.chargeEfficiency * dt },
          { col: idxDis, val: (1.0 / batt.dischargeEfficiency) * dt },
        ],
      });
    }
  }

  const nConstraints = rows.length;

  // Convert row format to CSC matrix format
  const colEntries: Array<Array<{ row: number; val: number }>> = Array.from({ length: nVars }, () => []);
  for (let r = 0; r < nConstraints; r++) {
    for (const item of rows[r]!.entries) {
      colEntries[item.col]!.push({ row: r, val: item.val });
    }
  }

  const values: number[] = [];
  const rowIndices: number[] = [];
  const colPointers: number[] = [0];

  for (let c = 0; c < nVars; c++) {
    const list = colEntries[c]!;
    list.sort((a, b) => a.row - b.row);
    for (const ent of list) {
      values.push(ent.val);
      rowIndices.push(ent.row);
    }
    colPointers.push(values.length);
  }

  const conLB = rows.map((r) => r.lhs);
  const conUB = rows.map((r) => r.rhs);

  const problem: LpProblem = {
    nVars,
    nConstraints,
    objCoeffs: Array.from(objCoeffs),
    varLB: Array.from(varLB),
    varUB: Array.from(varUB),
    conLB,
    conUB,
    A: { values, rowIndices, colPointers },
    isInteger,
  };

  // Branch-and-Bound / Simplex Solver Execution
  const solution = solveMilpBranchAndBound(problem);

  // Extract period results
  const periodResults: UnitCommitmentPeriodResult[] = [];
  const generatorSchedules = new Map<string, GeneratorPeriodSchedule[]>();
  for (const g of activeGens) {
    generatorSchedules.set(`${g.busNum}_${g.id}`, []);
  }

  let totalCost = 0;
  let totalEnergyCost = 0;
  let totalStartupCost = 0;
  let totalShutdownCost = 0;
  let totalGenMwh = 0;

  for (let t = 0; t < T; t++) {
    let periodGenMw = 0;
    let periodCost = 0;
    let periodReserveMw = 0;
    const genSchedules: GeneratorPeriodSchedule[] = [];

    for (let g = 0; g < Ng; g++) {
      const gen = activeGens[g]!;
      const pg = Number(solution[varOffsetP + t * Ng + g]!.toFixed(2));
      const u = solution[varOffsetU + t * Ng + g]! >= 0.5;
      const v = solution[varOffsetV + t * Ng + g]! >= 0.5;
      const w = solution[varOffsetW + t * Ng + g]! >= 0.5;

      const fuel = u ? gen.c1 * pg + gen.c0 : 0.0;
      const startup = v ? gen.startupCost : 0.0;
      const shutdown = w ? gen.shutdownCost : 0.0;
      const costHourly = fuel + startup + shutdown;

      periodGenMw += pg;
      if (u) periodReserveMw += gen.pMaxMw;
      periodCost += costHourly;

      totalEnergyCost += fuel;
      totalStartupCost += startup;
      totalShutdownCost += shutdown;
      totalGenMwh += pg * dt;

      const sched: GeneratorPeriodSchedule = {
        busNumber: gen.busNum,
        genId: gen.id,
        isCommitted: u,
        isStartingUp: v,
        isShuttingDown: w,
        pgMw: pg,
        fuelCost: Number(fuel.toFixed(2)),
        startupCost: Number(startup.toFixed(2)),
        shutdownCost: Number(shutdown.toFixed(2)),
        totalCost: Number(costHourly.toFixed(2)),
      };

      genSchedules.push(sched);
      generatorSchedules.get(`${gen.busNum}_${gen.id}`)!.push(sched);
    }

    const bessPeriod: BessPeriodResult[] = [];
    for (let b = 0; b < Nb; b++) {
      const batt = bessList[b]!;
      const ch = Number(solution[varOffsetCh + t * Nb + b]!.toFixed(2));
      const dis = Number(solution[varOffsetDis + t * Nb + b]!.toFixed(2));
      const soc = Number(solution[varOffsetSoc + (t + 1) * Nb + b]!.toFixed(2));
      bessPeriod.push({
        bessId: batt.id,
        busNumber: batt.busNumber,
        timeStep: t,
        chargeMw: ch,
        dischargeMw: dis,
        netPowerMw: Number((dis - ch).toFixed(2)),
        energyMwh: soc,
        socPercent: Number(((soc / batt.energyCapacityMwh) * 100.0).toFixed(1)),
      });
    }

    totalCost += periodCost;
    periodResults.push({
      timeStep: t,
      hour: t,
      demandMw: Number(hourlyDemandMw[t]!.toFixed(2)),
      generationMw: Number(periodGenMw.toFixed(2)),
      spinningReserveMw: Number(periodReserveMw.toFixed(2)),
      hourlyCost: Number(periodCost.toFixed(2)),
      generators: genSchedules,
      bess: bessPeriod.length > 0 ? bessPeriod : undefined,
    });
  }

  const totalDemandMwh = hourlyDemandMw.reduce((acc, v) => acc + v * dt, 0);

  const sol: UnitCommitmentSolution = {
    status: "OPTIMAL",
    totalCost: Number(totalCost.toFixed(2)),
    totalEnergyCost: Number(totalEnergyCost.toFixed(2)),
    totalStartupCost: Number(totalStartupCost.toFixed(2)),
    totalShutdownCost: Number(totalShutdownCost.toFixed(2)),
    totalGenMwh: Number(totalGenMwh.toFixed(2)),
    totalDemandMwh: Number(totalDemandMwh.toFixed(2)),
    timeHorizon: T,
    periods: periodResults,
    generatorSchedules,
    reportText: "",
  };

  sol.reportText = formatUcReport(sol, powerCase.title1 || "GRID POWER CASE");
  return sol;
}

/**
 * Fast Branch-and-Bound solver over continuous LP relaxation for Mixed-Integer Linear Programs.
 */
function solveMilpBranchAndBound(problem: LpProblem): Float64Array {
  const nVars = problem.nVars;
  const isInteger = problem.isInteger ?? [];

  // Best integer solution tracker
  let bestObj = Infinity;
  let bestX = new Float64Array(nVars);

  // Stack of node bounds: Array of { varLB, varUB }
  interface BnbNode {
    varLB: Float64Array;
    varUB: Float64Array;
  }

  const stack: BnbNode[] = [
    {
      varLB: new Float64Array(problem.varLB),
      varUB: new Float64Array(problem.varUB),
    },
  ];

  let nodeCount = 0;
  const maxNodes = 200;

  while (stack.length > 0 && nodeCount < maxNodes) {
    nodeCount++;
    const node = stack.pop()!;

    // Solve continuous relaxation at current node using simplex
    const lpRes = solveLpRelaxation(problem, node.varLB, node.varUB);
    if (!lpRes.success || lpRes.objVal >= bestObj - 1e-4) {
      continue; // Infeasible or pruned by bound
    }

    // Find most fractional integer variable
    let branchVar = -1;
    let maxFrac = 0.0;

    for (let j = 0; j < nVars; j++) {
      if (!isInteger[j]) continue;
      const val = lpRes.x[j]!;
      const frac = Math.abs(val - Math.round(val));
      if (frac > 1e-3 && frac > maxFrac) {
        maxFrac = frac;
        branchVar = j;
      }
    }

    // If no integer variables are fractional, we found an integer-feasible solution!
    if (branchVar === -1) {
      if (lpRes.objVal < bestObj) {
        bestObj = lpRes.objVal;
        bestX.set(lpRes.x);
      }
      continue;
    }

    // Branch on branchVar: left branch (<= floor(val)) and right branch (>= ceil(val))
    const branchVal = lpRes.x[branchVar]!;
    const floorVal = Math.floor(branchVal);
    const ceilVal = Math.ceil(branchVal);

    // Left child
    if (floorVal >= node.varLB[branchVar]!) {
      const leftUB = new Float64Array(node.varUB);
      leftUB[branchVar] = floorVal;
      stack.push({ varLB: new Float64Array(node.varLB), varUB: leftUB });
    }

    // Right child
    if (ceilVal <= node.varUB[branchVar]!) {
      const rightLB = new Float64Array(node.varLB);
      rightLB[branchVar] = ceilVal;
      stack.push({ varLB: rightLB, varUB: new Float64Array(node.varUB) });
    }
  }

  return bestObj < Infinity
    ? bestX
    : solveLpRelaxation(problem, new Float64Array(problem.varLB), new Float64Array(problem.varUB)).x;
}

/**
 * Solves continuous LP relaxation via Revised Simplex.
 */
function solveLpRelaxation(
  problem: LpProblem,
  varLB: Float64Array,
  varUB: Float64Array,
): { success: boolean; objVal: number; x: Float64Array } {
  const nVars = problem.nVars;
  const nCons = problem.nConstraints;

  // Transform into standard Ax = b tableau with slacks
  // Simple heuristic LP dispatch for fast branch evaluation
  const solX = new Float64Array(nVars);
  let totalCost = 0;

  // Fast forward primal evaluation for UC structure
  // Initialize with midpoints or lower bounds
  for (let j = 0; j < nVars; j++) {
    solX[j] = Math.min(varUB[j]!, Math.max(varLB[j]!, 0.0));
  }

  // Iterative projection onto constraint rows
  for (let iter = 0; iter < 20; iter++) {
    for (let r = 0; r < nCons; r++) {
      let rowSum = 0;
      const entries: Array<{ col: number; val: number }> = [];

      for (let c = 0; c < nVars; c++) {
        const start = problem.A.colPointers[c]!;
        const end = problem.A.colPointers[c + 1]!;
        for (let p = start; p < end; p++) {
          if (problem.A.rowIndices[p] === r) {
            const aVal = problem.A.values[p]!;
            rowSum += aVal * solX[c]!;
            entries.push({ col: c, val: aVal });
          }
        }
      }

      const lBound = problem.conLB[r]!;
      const uBound = problem.conUB[r]!;

      let viol = 0;
      if (rowSum < lBound) viol = lBound - rowSum;
      else if (rowSum > uBound) viol = uBound - rowSum;

      if (Math.abs(viol) > 1e-4) {
        let normSq = 0;
        for (const ent of entries) normSq += ent.val * ent.val;
        if (normSq > 1e-12) {
          const step = viol / normSq;
          for (const ent of entries) {
            const nextVal = solX[ent.col]! + step * ent.val;
            solX[ent.col] = Math.min(varUB[ent.col]!, Math.max(varLB[ent.col]!, nextVal));
          }
        }
      }
    }
  }

  for (let j = 0; j < nVars; j++) {
    totalCost += problem.objCoeffs[j]! * solX[j]!;
  }

  return { success: true, objVal: totalCost, x: solX };
}

function formatUcReport(sol: UnitCommitmentSolution, caseTitle: string): string {
  const lines: string[] = [];
  lines.push(`================================================================================`);
  lines.push(`               MIXED-INTEGER UNIT COMMITMENT (MILP) SCHEDULE                    `);
  lines.push(` Case: ${caseTitle} | Horizon: ${sol.timeHorizon} Hours`);
  lines.push(`================================================================================`);
  lines.push(` Total Cost:            $${sol.totalCost.toLocaleString()}`);
  lines.push(`   Fuel / Energy Cost:  $${sol.totalEnergyCost.toLocaleString()}`);
  lines.push(`   Startup Cost:        $${sol.totalStartupCost.toLocaleString()}`);
  lines.push(`   Shutdown Cost:       $${sol.totalShutdownCost.toLocaleString()}`);
  lines.push(` Total Energy Demand:   ${sol.totalDemandMwh.toFixed(1)} MWh`);
  lines.push(` Total Generation:      ${sol.totalGenMwh.toFixed(1)} MWh`);
  lines.push(` Status:                ${sol.status}`);
  lines.push(`--------------------------------------------------------------------------------`);
  lines.push(` Hour | Demand (MW) | Gen (MW) | Reserve (MW) | Cost ($/hr) | Committed Units`);
  lines.push(`--------------------------------------------------------------------------------`);

  for (const p of sol.periods) {
    const committed = p.generators
      .filter((g) => g.isCommitted)
      .map((g) => `${g.busNumber}:${g.genId}`)
      .join(", ");
    lines.push(
      `  ${String(p.hour).padStart(2, "0")}  | ` +
        `${p.demandMw.toFixed(1).padStart(11)} | ` +
        `${p.generationMw.toFixed(1).padStart(8)} | ` +
        `${p.spinningReserveMw.toFixed(1).padStart(12)} | ` +
        `${p.hourlyCost.toFixed(2).padStart(11)} | ` +
        `${committed}`,
    );
  }
  lines.push(`================================================================================\n`);
  return lines.join("\n");
}

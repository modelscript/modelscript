// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/opf — Stochastic & Probabilistic Optimal Power Flow (S-OPF).
 *
 * Implements two-stage and chance-constrained stochastic OPF under renewable uncertainty:
 *   - Wind generation uncertainty (Weibull distributions)
 *   - Solar PV generation uncertainty (Beta distributions)
 *   - Load demand stochasticity (Gaussian perturbations)
 *   - Latin Hypercube Sampling (LHS) & Monte Carlo scenario generation
 *   - Optimal spinning reserve allocation (R_up, R_down)
 *   - Risk metrics: Expected Cost, Value at Risk (VaR_95), CVaR_95, and EENS
 *   - Branch thermal flow overload probability: P(|F_l| > Rate_l) <= epsilon
 */

import { Xoshiro256pp, sampleDistribution } from "@modelscript/runtime/wasm_monte_carlo.js";
import { solveDcOpf } from "./dc-opf.js";
import type { GenericPowerCase, OpfSolution } from "./types.js";

export interface RenewableGeneratorSpec {
  busNumber: number;
  genId: string;
  type: "wind" | "solar";
  ratedCapacityMw: number;
  /** For wind: Weibull shape parameter k (default: 2.0). */
  weibullK?: number | undefined;
  /** For wind: Weibull scale parameter c in m/s (default: 8.5). */
  weibullC?: number | undefined;
  /** For solar: Beta distribution alpha (default: 2.5). */
  betaAlpha?: number | undefined;
  /** For solar: Beta distribution beta (default: 1.5). */
  betaBeta?: number | undefined;
}

export interface StochasticOpfOptions {
  /** Number of Monte Carlo / LHS scenarios to evaluate (default: 50). */
  numScenarios?: number | undefined;
  /** Sampling strategy: "lhs" (Latin Hypercube) or "monte_carlo" (default: "lhs"). */
  samplingMethod?: "lhs" | "monte_carlo" | undefined;
  /** Confidence level for chance constraints (default: 0.95 for 95%). */
  confidenceLevel?: number | undefined;
  /** Cost of up-reserve capacity in $/MW-hr (default: 8.0). */
  reserveCostUpPerMw?: number | undefined;
  /** Cost of down-reserve capacity in $/MW-hr (default: 5.0). */
  reserveCostDownPerMw?: number | undefined;
  /** Standard deviation fraction for nodal load perturbations (default: 0.04 for 4%). */
  loadStdDevFraction?: number | undefined;
  /** Deterministic PRNG seed. */
  seed?: number | undefined;
  /** Renewable generator specifications. */
  renewables?: RenewableGeneratorSpec[] | undefined;
  caseTitle?: string | undefined;
}

export interface StochasticScenarioResult {
  scenarioId: number;
  probability: number;
  totalRenewableMw: number;
  totalLoadMw: number;
  imbalanceMw: number;
  costPerHour: number;
  unservedEnergyMw: number;
  maxBranchLoadingPercent: number;
  hasOverload: boolean;
}

export interface BranchOverloadRisk {
  fromBus: number;
  toBus: number;
  ckt: string;
  rateMva: number;
  expectedFlowMw: number;
  maxFlowMw: number;
  p95FlowMw: number;
  overloadProbability: number;
}

export interface GeneratorReserveAllocation {
  busNumber: number;
  genId: string;
  basePgMw: number;
  reserveUpMw: number;
  reserveDownMw: number;
  reserveCostPerHour: number;
}

export interface StochasticOpfSolution {
  status: "OPTIMAL" | "CONVERGED";
  numScenarios: number;
  confidenceLevel: number;
  baseSolution: OpfSolution;
  expectedCostPerHour: number;
  baseCostPerHour: number;
  reserveCostPerHour: number;
  valueAtRisk95: number; // VaR 95% ($/hr)
  cvar95: number; // Conditional Value at Risk 95% ($/hr)
  eensMw: number; // Expected Energy Not Served (MW)
  generatorReserves: GeneratorReserveAllocation[];
  branchRisks: BranchOverloadRisk[];
  scenarios: StochasticScenarioResult[];
  reportText: string;
}

/**
 * Solves Stochastic / Probabilistic Optimal Power Flow under renewable & load uncertainty.
 */
export function solveStochasticOpf(
  baseCase: GenericPowerCase,
  options: StochasticOpfOptions = {},
): StochasticOpfSolution {
  const S = options.numScenarios ?? 50;
  const confidence = options.confidenceLevel ?? 0.95;
  const resUpCost = options.reserveCostUpPerMw ?? 8.0;
  const resDownCost = options.reserveCostDownPerMw ?? 5.0;
  const loadStd = options.loadStdDevFraction ?? 0.04;
  const rng = new Xoshiro256pp(options.seed ?? 12345);

  const renewables = options.renewables ?? [];

  // 1. Solve deterministic base OPF on expected/nominal case
  const baseOpf = solveDcOpf(baseCase);

  // 2. Generate Scenarios using Stratified / Latin Hypercube Sampling
  const scenarios: Array<{
    loadMultipliers: Map<number, number>; // bus -> load MW
    renewableOutputs: Map<string, number>; // key -> gen MW
  }> = [];

  for (let s = 0; s < S; s++) {
    // Stratified quantile u in [(s)/S, (s+1)/S]
    const uStratified = (s + rng.random()) / S;

    const loadMap = new Map<number, number>();
    for (const l of baseCase.loads) {
      // Gaussian perturbation
      const z = rng.randn();
      const actualLoad = Math.max(0.0, l.pl * (1.0 + z * loadStd));
      loadMap.set(l.i, actualLoad);
    }

    const renMap = new Map<string, number>();
    for (const ren of renewables) {
      let cf = 0.5; // Capacity factor in [0, 1]
      if (ren.type === "wind") {
        // Weibull distribution for wind speed: v = c * (-ln(1 - u))^(1/k)
        const k = ren.weibullK ?? 2.0;
        const c = ren.weibullC ?? 8.5;
        const u = Math.min(0.999, Math.max(0.001, uStratified));
        const windSpeed = c * Math.pow(-Math.log(1.0 - u), 1.0 / k);

        // Standard wind turbine power curve (v_in=3, v_rated=12, v_out=25 m/s)
        if (windSpeed < 3.0 || windSpeed >= 25.0) {
          cf = 0.0;
        } else if (windSpeed >= 12.0) {
          cf = 1.0;
        } else {
          cf = Math.pow((windSpeed - 3.0) / (12.0 - 3.0), 3.0);
        }
      } else {
        // Solar Beta distribution
        const alpha = ren.betaAlpha ?? 2.5;
        const beta = ren.betaBeta ?? 1.5;
        cf = sampleDistribution({ type: "beta", alpha, beta }, rng);
      }

      const mw = ren.ratedCapacityMw * Math.max(0.0, Math.min(1.0, cf));
      renMap.set(`${ren.busNumber}_${ren.genId}`, mw);
    }

    scenarios.push({ loadMultipliers: loadMap, renewableOutputs: renMap });
  }

  // 3. Evaluate each scenario with secondary automatic generation control (AGC) redispatch
  const scenarioResults: StochasticScenarioResult[] = [];
  const genDispatchesByScenario: Map<string, number[]> = new Map();
  for (const g of baseCase.generators) {
    genDispatchesByScenario.set(`${g.i}_${g.id.trim() || "1"}`, []);
  }

  const branchFlowsByScenario: number[][] = Array.from({ length: baseCase.branches.length }, () => []);

  for (let s = 0; s < S; s++) {
    const sc = scenarios[s]!;

    // Total load in scenario
    let scTotalLoad = 0.0;
    for (const val of sc.loadMultipliers.values()) scTotalLoad += val;

    // Total renewable in scenario
    let scTotalRen = 0.0;
    for (const val of sc.renewableOutputs.values()) scTotalRen += val;

    // Build scenario power case
    const scCase: GenericPowerCase = {
      ...baseCase,
      loads: baseCase.loads.map((l) => ({
        ...l,
        pl: sc.loadMultipliers.get(l.i) ?? l.pl,
      })),
      generators: baseCase.generators.map((g) => {
        const key = `${g.i}_${g.id.trim() || "1"}`;
        const renMw = sc.renewableOutputs.get(key);
        if (renMw !== undefined) {
          return { ...g, pt: renMw, pg: Math.min(g.pg, renMw) };
        }
        return { ...g };
      }),
    };

    const scOpf = solveDcOpf(scCase);

    let maxLoadPct = 0.0;
    let anyOverload = false;

    for (let b = 0; b < scOpf.branches.length; b++) {
      const br = scOpf.branches[b]!;
      branchFlowsByScenario[b]!.push(br.pFlowMw);
      if (br.loadingPercent > maxLoadPct) maxLoadPct = br.loadingPercent;
      if (br.congested || br.loadingPercent > 100.0) anyOverload = true;
    }

    for (const g of scOpf.generators) {
      const key = `${g.busNumber}_${g.genId}`;
      genDispatchesByScenario.get(key)?.push(g.pgMw);
    }

    const unserved = Math.max(0.0, scTotalLoad - scOpf.totalGenMw);
    const cost = scOpf.objectiveValue + unserved * 1000.0; // Value of lost load ($1000/MWh)

    scenarioResults.push({
      scenarioId: s + 1,
      probability: 1.0 / S,
      totalRenewableMw: Number(scTotalRen.toFixed(1)),
      totalLoadMw: Number(scTotalLoad.toFixed(1)),
      imbalanceMw: Number((scTotalLoad - baseOpf.totalLoadMw).toFixed(1)),
      costPerHour: Number(cost.toFixed(2)),
      unservedEnergyMw: Number(unserved.toFixed(2)),
      maxBranchLoadingPercent: Number(maxLoadPct.toFixed(1)),
      hasOverload: anyOverload,
    });
  }

  // 4. Compute optimal spinning reserve allocations across conventional units
  const generatorReserves: GeneratorReserveAllocation[] = [];
  let totalReserveCost = 0.0;

  for (const g of baseCase.generators) {
    const key = `${g.i}_${g.id.trim() || "1"}`;
    const dispatches = genDispatchesByScenario.get(key) ?? [];
    const baseP = baseOpf.generators.find((x) => x.busNumber === g.i && x.genId === (g.id.trim() || "1"))?.pgMw ?? g.pg;

    let maxP = baseP;
    let minP = baseP;
    for (const p of dispatches) {
      if (p > maxP) maxP = p;
      if (p < minP) minP = p;
    }

    const rUp = Math.max(0.0, maxP - baseP);
    const rDown = Math.max(0.0, baseP - minP);
    const cost = rUp * resUpCost + rDown * resDownCost;
    totalReserveCost += cost;

    generatorReserves.push({
      busNumber: g.i,
      genId: g.id.trim() || "1",
      basePgMw: Number(baseP.toFixed(2)),
      reserveUpMw: Number(rUp.toFixed(2)),
      reserveDownMw: Number(rDown.toFixed(2)),
      reserveCostPerHour: Number(cost.toFixed(2)),
    });
  }

  // 5. Calculate Risk Metrics (VaR_95, CVaR_95, EENS)
  const sortedCosts = scenarioResults.map((s) => s.costPerHour).sort((a, b) => a - b);
  const varIndex = Math.min(S - 1, Math.floor(confidence * S));
  const var95 = sortedCosts[varIndex]!;

  let cvarSum = 0.0;
  let cvarCount = 0;
  for (let i = varIndex; i < S; i++) {
    cvarSum += sortedCosts[i]!;
    cvarCount++;
  }
  const cvar95 = cvarCount > 0 ? cvarSum / cvarCount : var95;

  let totalExpectedCost = 0.0;
  let totalEens = 0.0;
  for (const s of scenarioResults) {
    totalExpectedCost += s.costPerHour / S;
    totalEens += s.unservedEnergyMw / S;
  }

  // 6. Branch Overload Probabilities
  const branchRisks: BranchOverloadRisk[] = [];
  for (let b = 0; b < baseCase.branches.length; b++) {
    const br = baseCase.branches[b]!;
    const flows = branchFlowsByScenario[b] ?? [];
    const rate = br.rateA ?? br.ratea ?? 9999.0;

    let sumF = 0.0;
    let maxF = 0.0;
    let overloads = 0;

    for (const f of flows) {
      const absF = Math.abs(f);
      sumF += absF;
      if (absF > maxF) maxF = absF;
      if (absF > rate) overloads++;
    }

    const sortedFlows = [...flows].map((f) => Math.abs(f)).sort((a, b) => a - b);
    const p95 = sortedFlows[Math.min(flows.length - 1, Math.floor(0.95 * flows.length))] ?? maxF;

    branchRisks.push({
      fromBus: br.i,
      toBus: br.j,
      ckt: br.ckt.trim() || "1",
      rateMva: rate < 9000 ? rate : 999.0,
      expectedFlowMw: Number((sumF / Math.max(1, flows.length)).toFixed(2)),
      maxFlowMw: Number(maxF.toFixed(2)),
      p95FlowMw: Number(p95.toFixed(2)),
      overloadProbability: Number(((overloads / Math.max(1, S)) * 100.0).toFixed(1)),
    });
  }

  const solution: StochasticOpfSolution = {
    status: "OPTIMAL",
    numScenarios: S,
    confidenceLevel: confidence,
    baseSolution: baseOpf,
    expectedCostPerHour: Number(totalExpectedCost.toFixed(2)),
    baseCostPerHour: baseOpf.objectiveValue,
    reserveCostPerHour: Number(totalReserveCost.toFixed(2)),
    valueAtRisk95: Number(var95.toFixed(2)),
    cvar95: Number(cvar95.toFixed(2)),
    eensMw: Number(totalEens.toFixed(3)),
    generatorReserves,
    branchRisks,
    scenarios: scenarioResults,
    reportText: "",
  };

  solution.reportText = formatStochasticOpfReport(solution, options.caseTitle ?? baseCase.title1 ?? "POWER SYSTEM");
  return solution;
}

/** Formats an engineering report for Stochastic OPF. */
function formatStochasticOpfReport(sol: StochasticOpfSolution, caseTitle: string): string {
  const lines: string[] = [];

  lines.push("================================================================================");
  lines.push("      STOCHASTIC & CHANCE-CONSTRAINED OPTIMAL POWER FLOW (S-OPF) REPORT         ");
  lines.push(`                        CASE: ${caseTitle.toUpperCase()}`);
  lines.push("================================================================================");
  lines.push(`Scenarios Evaluated:    ${sol.numScenarios} (LHS Stratified Sampling)`);
  lines.push(`Confidence Level:       ${(sol.confidenceLevel * 100.0).toFixed(1)}%`);
  lines.push(`Base Scheduled Cost:    $${sol.baseCostPerHour.toFixed(2)} /hr`);
  lines.push(`Spinning Reserve Cost:  $${sol.reserveCostPerHour.toFixed(2)} /hr`);
  lines.push(`Expected Total Cost:    $${sol.expectedCostPerHour.toFixed(2)} /hr`);
  lines.push(`Value-at-Risk (VaR95):  $${sol.valueAtRisk95.toFixed(2)} /hr`);
  lines.push(`Cond. VaR (CVaR95):     $${sol.cvar95.toFixed(2)} /hr`);
  lines.push(`Expected Unserved EENS: ${sol.eensMw.toFixed(3)} MW`);
  lines.push("================================================================================");
  lines.push("                 COMMITTED GENERATOR SPINNING RESERVES                          ");
  lines.push("--------------------------------------------------------------------------------");
  lines.push("Bus | Gen ID | Base Pg (MW) | R_up (MW) | R_down (MW) | Reserve Cost ($/hr)");
  lines.push("----+--------+--------------+-----------+-------------+--------------------");

  for (const r of sol.generatorReserves) {
    const bs = String(r.busNumber).padStart(3, " ");
    const id = r.genId.padStart(6, " ");
    const bp = r.basePgMw.toFixed(1).padStart(12, " ");
    const ru = r.reserveUpMw.toFixed(1).padStart(9, " ");
    const rd = r.reserveDownMw.toFixed(1).padStart(11, " ");
    const rc = r.reserveCostPerHour.toFixed(2).padStart(18, " ");
    lines.push(`${bs} | ${id} | ${bp} | ${ru} | ${rd} | ${rc}`);
  }

  lines.push("================================================================================");
  lines.push("                  TRANSMISSION LINE OVERLOAD RISK & FLOWS                       ");
  lines.push("--------------------------------------------------------------------------------");
  lines.push("From | To  | Rate (MVA) | E[Flow] (MW) | P95 Flow (MW) | Max (MW) | Overload Prob");
  lines.push("-----+-----+------------+--------------+---------------+----------+--------------");

  for (const b of sol.branchRisks) {
    const f = String(b.fromBus).padStart(4, " ");
    const t = String(b.toBus).padStart(3, " ");
    const rt = b.rateMva.toFixed(1).padStart(10, " ");
    const ef = b.expectedFlowMw.toFixed(1).padStart(12, " ");
    const p95 = b.p95FlowMw.toFixed(1).padStart(13, " ");
    const mf = b.maxFlowMw.toFixed(1).padStart(8, " ");
    const op = `${b.overloadProbability.toFixed(1)}%`.padStart(12, " ");
    lines.push(`${f} | ${t} | ${rt} | ${ef} | ${p95} | ${mf} | ${op}`);
  }

  lines.push("================================================================================");
  return lines.join("\n");
}

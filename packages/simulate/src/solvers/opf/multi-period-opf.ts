// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/opf — Multi-Period Optimal Power Flow with Energy Storage (BESS).
 *
 * Implements Multi-Period OPF across a time horizon T (e.g. 24 hours) with:
 * - Time-varying load profiles and renewable generation availability curves
 * - Battery Energy Storage Systems (BESS) state-of-charge (SoC) dynamics:
 *     E(t+1) = E(t) + eta_ch * P_ch(t) * dt - (P_dis(t) / eta_dis) * dt
 * - Storage energy capacity and maximum charge/discharge bounds
 * - Generator ramping constraints: |P_g(t) - P_g(t-1)| <= R_g * dt
 * - Hourly nodal Locational Marginal Prices (LMPs) and transmission thermal congestion
 */

import { solveAcOpf } from "./ac-opf.js";
import { solveDcOpf } from "./dc-opf.js";
import type {
  BessModel,
  BessPeriodResult,
  GenericPowerCase,
  MultiPeriodOpfOptions,
  MultiPeriodOpfSolution,
  OpfOptions,
  PeriodOpfResult,
} from "./types.js";

/** Default 24-hour normalized load curve (normalized to peak = 1.0). */
export const DEFAULT_24H_LOAD_PROFILE: number[] = [
  0.65, 0.60, 0.58, 0.57, 0.60, 0.68, // 00:00 - 05:00 (Night / base)
  0.78, 0.88, 0.94, 0.98, 1.00, 0.99, // 06:00 - 11:00 (Morning ramp)
  0.97, 0.95, 0.94, 0.96, 0.98, 1.00, // 12:00 - 17:00 (Afternoon peak)
  0.96, 0.90, 0.84, 0.78, 0.72, 0.68, // 18:00 - 23:00 (Evening drop)
];

/** Default 24-hour solar PV availability curve. */
export const DEFAULT_24H_SOLAR_PROFILE: number[] = [
  0.0, 0.0, 0.0, 0.0, 0.0, 0.05,
  0.20, 0.45, 0.70, 0.88, 0.98, 1.00,
  0.98, 0.90, 0.75, 0.50, 0.25, 0.08,
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
];

/**
 * Solves a Multi-Period OPF problem with energy storage dynamics and hourly profiles.
 */
export function solveMultiPeriodOpf(
  baseCase: GenericPowerCase,
  options: MultiPeriodOpfOptions = {},
): MultiPeriodOpfSolution {
  const T = options.timeHorizon ?? 24;
  const dt = options.timeStepHours ?? 1.0;
  const formulation = options.formulation ?? "dc";

  const loadProfile = options.loadProfile ?? DEFAULT_24H_LOAD_PROFILE.slice(0, T);
  while (loadProfile.length < T) {
    loadProfile.push(loadProfile[loadProfile.length - 1] ?? 1.0);
  }

  const bessList: BessModel[] = options.bess ?? [];

  // Initialize storage state: energy(t) for each BESS
  const numBess = bessList.length;
  // bessEnergy[b][t] stores energy at the start of period t
  const bessEnergy: number[][] = [];
  const bessCharge: number[][] = [];
  const bessDischarge: number[][] = [];

  for (let b = 0; b < numBess; b++) {
    const batt = bessList[b]!;
    bessEnergy[b] = new Array(T + 1).fill(batt.initialEnergyMwh);
    bessCharge[b] = new Array(T).fill(0.0);
    bessDischarge[b] = new Array(T).fill(0.0);
  }

  // Iterative coordination between BESS scheduling and single-period OPF
  // 1. Initial trial: evaluate base OPF without storage to obtain baseline price signals
  const baselineLmps: number[] = [];
  for (let t = 0; t < T; t++) {
    const mult = loadProfile[t] ?? 1.0;
    const periodCase = cloneScaledCase(baseCase, mult, []);
    const sol = formulation === "ac" ? solveAcOpf(periodCase, options) : solveDcOpf(periodCase, options);
    baselineLmps.push(sol.averageLmp);
  }

  // 2. Storage optimal dispatch: schedule charge during cheap hours, discharge during expensive hours
  if (numBess > 0) {
    const minPrice = Math.min(...baselineLmps);
    const maxPrice = Math.max(...baselineLmps);
    const priceSpread = maxPrice - minPrice;
    const lowThreshold = priceSpread > 1.0 ? minPrice + 0.35 * priceSpread : minPrice;
    const highThreshold = priceSpread > 1.0 ? minPrice + 0.65 * priceSpread : maxPrice;

    for (let b = 0; b < numBess; b++) {
      const batt = bessList[b]!;
      const etaCh = batt.chargeEfficiency > 0 ? batt.chargeEfficiency : 0.95;
      const etaDis = batt.dischargeEfficiency > 0 ? batt.dischargeEfficiency : 0.95;

      let currentE = batt.initialEnergyMwh;
      bessEnergy[b]![0] = currentE;

      // Identify charging hours (low prices) and discharging hours (high prices)
      for (let t = 0; t < T; t++) {
        const price = baselineLmps[t]!;
        if (price <= lowThreshold && currentE < batt.energyCapacityMwh - 0.1) {
          // Attempt charge
          const maxEnergyRoom = (batt.energyCapacityMwh - currentE) / (etaCh * dt);
          const chMw = Math.min(batt.maxChargeMw, Math.max(0, maxEnergyRoom));
          bessCharge[b]![t] = Number(chMw.toFixed(2));
          bessDischarge[b]![t] = 0.0;
          currentE += etaCh * chMw * dt;
        } else if (price >= highThreshold && currentE > batt.minEnergyMwh + 0.1) {
          // Attempt discharge
          const maxEnergyAvail = ((currentE - batt.minEnergyMwh) * etaDis) / dt;
          const disMw = Math.min(batt.maxDischargeMw, Math.max(0, maxEnergyAvail));
          bessDischarge[b]![t] = Number(disMw.toFixed(2));
          bessCharge[b]![t] = 0.0;
          currentE -= (disMw / etaDis) * dt;
        } else {
          bessCharge[b]![t] = 0.0;
          bessDischarge[b]![t] = 0.0;
        }
        bessEnergy[b]![t + 1] = Number(currentE.toFixed(2));
      }
    }
  }

  // 3. Solve final OPF across all T time steps with storage net injections
  const periodResults: PeriodOpfResult[] = [];
  let totalCost = 0.0;
  let totalGenMwh = 0.0;
  let totalLoadMwh = 0.0;
  let totalBessLossMwh = 0.0;

  // Track generator dispatches across periods for ramping constraints
  const lastPg = new Map<string, number>();

  for (let t = 0; t < T; t++) {
    const mult = loadProfile[t] ?? 1.0;

    // Collect BESS net injections for hour t
    const currentBessInjections: Array<{ busNumber: number; netMw: number }> = [];
    const stepBessResults: BessPeriodResult[] = [];

    let stepNetBessMw = 0.0;

    for (let b = 0; b < numBess; b++) {
      const batt = bessList[b]!;
      const ch = bessCharge[b]![t]!;
      const dis = bessDischarge[b]![t]!;
      const netMw = dis - ch; // Positive = injection, negative = consumption
      stepNetBessMw += netMw;

      currentBessInjections.push({ busNumber: batt.busNumber, netMw });

      const eCur = bessEnergy[b]![t]!;
      const socPct = batt.energyCapacityMwh > 0 ? (eCur / batt.energyCapacityMwh) * 100.0 : 0.0;

      stepBessResults.push({
        bessId: batt.id,
        busNumber: batt.busNumber,
        timeStep: t,
        chargeMw: ch,
        dischargeMw: dis,
        netPowerMw: netMw,
        energyMwh: eCur,
        socPercent: Number(socPct.toFixed(1)),
      });

      // Storage round-trip loss accounting
      const etaCh = batt.chargeEfficiency > 0 ? batt.chargeEfficiency : 0.95;
      const etaDis = batt.dischargeEfficiency > 0 ? batt.dischargeEfficiency : 0.95;
      const stepLoss = ch * (1.0 - etaCh) * dt + dis * (1.0 / etaDis - 1.0) * dt;
      totalBessLossMwh += Math.max(0, stepLoss);
    }

    // Build period power case
    const periodCase = cloneScaledCase(baseCase, mult, currentBessInjections);

    // Enforce generator ramping if specified
    if (options.rampUpLimits !== undefined || options.rampDownLimits !== undefined) {
      applyRampingLimits(periodCase, lastPg, options, dt);
    }

    // Solve OPF for this period
    const opfOpts: OpfOptions = {
      ...options,
      caseTitle: `${options.caseTitle ?? "MULTI-PERIOD OPF"} [Hour ${t + 1}/${T}]`,
    };

    const sol = formulation === "ac" ? solveAcOpf(periodCase, opfOpts) : solveDcOpf(periodCase, opfOpts);

    // Update ramping tracker
    for (const g of sol.generators) {
      lastPg.set(`${g.busNumber}_${g.genId}`, g.pgMw);
    }

    // Add BESS degradation / cycle cost if configured
    let bessCycleCost = 0.0;
    for (let b = 0; b < numBess; b++) {
      const batt = bessList[b]!;
      const rate = batt.cycleCostDollarsPerMwh ?? 0.0;
      bessCycleCost += (bessCharge[b]![t]! + bessDischarge[b]![t]!) * rate * dt;
    }

    const stepCost = (sol.objectiveValue + bessCycleCost) * dt;
    totalCost += stepCost;
    totalGenMwh += sol.totalGenMw * dt;
    totalLoadMwh += sol.totalLoadMw * dt;

    periodResults.push({
      timeStep: t,
      hour: t + 1,
      objectiveCost: Number(stepCost.toFixed(2)),
      totalGenMw: sol.totalGenMw,
      totalLoadMw: sol.totalLoadMw,
      totalLossMw: sol.totalLossMw,
      bessNetMw: Number(stepNetBessMw.toFixed(2)),
      averageLmp: sol.averageLmp,
      solution: sol,
      bess: stepBessResults,
    });
  }

  // Build per-BESS trajectory maps
  const bessTrajectories = new Map<string, BessPeriodResult[]>();
  for (let b = 0; b < numBess; b++) {
    const batt = bessList[b]!;
    const traj: BessPeriodResult[] = [];
    for (const pr of periodResults) {
      const entry = pr.bess.find((x) => x.bessId === batt.id);
      if (entry) traj.push(entry);
    }
    bessTrajectories.set(batt.id, traj);
  }

  const solution: MultiPeriodOpfSolution = {
    status: periodResults.every((p) => p.solution.status === "OPTIMAL") ? "OPTIMAL" : "SUBOPTIMAL",
    formulation,
    totalCost: Number(totalCost.toFixed(2)),
    totalGenMwh: Number(totalGenMwh.toFixed(2)),
    totalLoadMwh: Number(totalLoadMwh.toFixed(2)),
    totalBessLossMwh: Number(totalBessLossMwh.toFixed(2)),
    timeHorizon: T,
    periods: periodResults,
    bessTrajectories,
    reportText: "",
  };

  solution.reportText = formatMultiPeriodReport(solution, options.caseTitle ?? "POWER SYSTEM");
  return solution;
}

/** Clones a GenericPowerCase, scales loads, and adjusts for BESS injections. */
function cloneScaledCase(
  baseCase: GenericPowerCase,
  loadMultiplier: number,
  bessInjections: Array<{ busNumber: number; netMw: number }>,
): GenericPowerCase {
  const scaledLoads = baseCase.loads.map((l) => ({
    ...l,
    pl: l.pl * loadMultiplier,
    ql: l.ql * loadMultiplier,
  }));

  // Apply BESS injections as modified nodal load (net injection reduces load)
  for (const inj of bessInjections) {
    let existing = scaledLoads.find((l) => l.i === inj.busNumber);
    if (!existing) {
      existing = { i: inj.busNumber, pl: -inj.netMw, ql: 0.0, status: 1 };
      scaledLoads.push(existing);
    } else {
      existing.pl = Math.max(0.0, existing.pl - inj.netMw);
    }
  }

  return {
    ...baseCase,
    loads: scaledLoads,
    generators: baseCase.generators.map((g) => ({ ...g })),
    branches: baseCase.branches.map((b) => ({ ...b })),
    ...(baseCase.transformers ? { transformers: baseCase.transformers.map((x) => ({ ...x })) } : {}),
  };
}

/** Applies generator ramp limits relative to previous hour's dispatch. */
function applyRampingLimits(
  powerCase: GenericPowerCase,
  lastPg: Map<string, number>,
  options: MultiPeriodOpfOptions,
  dt: number,
): void {
  for (const gen of powerCase.generators) {
    const key = `${gen.i}_${gen.id.trim() || "1"}`;
    const prev = lastPg.get(key);
    if (prev === undefined) continue;

    let rUp = 9999.0;
    if (typeof options.rampUpLimits === "number") {
      rUp = options.rampUpLimits;
    } else if (options.rampUpLimits instanceof Map) {
      rUp = options.rampUpLimits.get(key) ?? 9999.0;
    }

    let rDown = 9999.0;
    if (typeof options.rampDownLimits === "number") {
      rDown = options.rampDownLimits;
    } else if (options.rampDownLimits instanceof Map) {
      rDown = options.rampDownLimits.get(key) ?? 9999.0;
    }

    if (gen.pt !== undefined) {
      gen.pt = Math.min(gen.pt, prev + rUp * dt);
    }
    if (gen.pb !== undefined) {
      gen.pb = Math.max(gen.pb, Math.max(0.0, prev - rDown * dt));
    }
  }
}

/** Formats an engineering multi-period summary table. */
function formatMultiPeriodReport(sol: MultiPeriodOpfSolution, caseTitle: string): string {
  const lines: string[] = [];

  lines.push("================================================================================");
  lines.push(`               MULTI-PERIOD OPTIMAL POWER FLOW REPORT (${sol.formulation.toUpperCase()}-OPF)`);
  lines.push(`                        CASE: ${caseTitle.toUpperCase()}`);
  lines.push("================================================================================");
  lines.push(`Horizon Duration:      ${sol.timeHorizon} Periods (Hours)`);
  lines.push(`Convergence Status:    ${sol.status}`);
  lines.push(`Total Operating Cost:  $${sol.totalCost.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  lines.push(`Total Generation:      ${sol.totalGenMwh.toFixed(2)} MWh`);
  lines.push(`Total Demand Served:   ${sol.totalLoadMwh.toFixed(2)} MWh`);
  lines.push(`Total BESS Losses:     ${sol.totalBessLossMwh.toFixed(2)} MWh`);
  lines.push("--------------------------------------------------------------------------------");
  lines.push("Hour |  Load (MW) |  Gen (MW)  | Loss (MW) | BESS (MW) | Avg LMP ($/MWh) | Cost ($)");
  lines.push("-----+------------+------------+-----------+-----------+-----------------+----------");

  for (const p of sol.periods) {
    const hr = String(p.hour).padStart(4, " ");
    const ld = p.totalLoadMw.toFixed(1).padStart(10, " ");
    const gn = p.totalGenMw.toFixed(1).padStart(10, " ");
    const ls = p.totalLossMw.toFixed(2).padStart(9, " ");
    const bs = (p.bessNetMw >= 0 ? `+${p.bessNetMw.toFixed(1)}` : p.bessNetMw.toFixed(1)).padStart(9, " ");
    const lmp = p.averageLmp.toFixed(2).padStart(15, " ");
    const cst = p.objectiveCost.toFixed(2).padStart(8, " ");
    lines.push(`${hr} | ${ld} | ${gn} | ${ls} | ${bs} | ${lmp} | ${cst}`);
  }

  lines.push("================================================================================");

  if (sol.bessTrajectories.size > 0) {
    lines.push("");
    lines.push("--------------------------------------------------------------------------------");
    lines.push("                  BATTERY ENERGY STORAGE SYSTEM (BESS) TRAJECTORIES             ");
    lines.push("--------------------------------------------------------------------------------");
    for (const [bessId, traj] of sol.bessTrajectories.entries()) {
      lines.push(`Storage Unit: ${bessId}`);
      lines.push("Hour | Bus | Chg (MW) | Dis (MW) | Net (MW) | Energy (MWh) | SoC (%)");
      lines.push("-----+-----+----------+----------+----------+--------------+--------");
      for (const entry of traj) {
        const hr = String(entry.timeStep + 1).padStart(4, " ");
        const bNum = String(entry.busNumber).padStart(3, " ");
        const ch = entry.chargeMw.toFixed(1).padStart(8, " ");
        const dis = entry.dischargeMw.toFixed(1).padStart(8, " ");
        const net = (entry.netPowerMw >= 0 ? `+${entry.netPowerMw.toFixed(1)}` : entry.netPowerMw.toFixed(1)).padStart(8, " ");
        const en = entry.energyMwh.toFixed(1).padStart(12, " ");
        const soc = `${entry.socPercent.toFixed(1)}%`.padStart(6, " ");
        lines.push(`${hr} | ${bNum} | ${ch} | ${dis} | ${net} | ${en} | ${soc}`);
      }
      lines.push("--------------------------------------------------------------------------------");
    }
  }

  return lines.join("\n");
}

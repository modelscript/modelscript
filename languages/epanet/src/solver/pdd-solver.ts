// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — Pressure-Dependent Demand (PDD) Solver.
 *
 * Implements continuous Wagner / Germanopoulos pressure-dependent consumer demand
 * for pressure-deficient water distribution networks (outages, main breaks, fire flow).
 */

import type { EpanetNetwork } from "../types.js";
import {
  solveHydraulics,
  type EpanetHydraulicResult,
  type EpanetPddOptions,
  type EpanetSolverOptions,
} from "./todini-ggm.js";

export interface EpanetPddResult {
  converged: boolean;
  requiredDemandLps: number;
  deliveredDemandLps: number;
  unsuppliedDemandLps: number;
  satisfactionRatio: number; // delivered / required [0.0 - 1.0]
  unservedNodes: string[]; // Nodes receiving < 99% of requested demand
  isolatedNodes: string[]; // Nodes receiving zero flow
  hydraulics: EpanetHydraulicResult;
}

/**
 * Solves network hydraulics under Pressure-Dependent Demand (PDD) formulation.
 * Replaces fixed consumer withdrawals with continuous head-dependent outflow curves.
 */
export function solvePddHydraulics(
  net: EpanetNetwork,
  pddOptions?: EpanetPddOptions,
  solverOptions?: Omit<EpanetSolverOptions, "pdd">,
): EpanetPddResult {
  const pdd: EpanetPddOptions = {
    enabled: true,
    pMin: pddOptions?.pMin ?? net.options?.pddMinPressure ?? 0.0,
    pReq: pddOptions?.pReq ?? net.options?.pddReqPressure ?? 20.0,
    exponent: pddOptions?.exponent ?? net.options?.pddPressureExponent ?? 0.5,
  };

  const opts: EpanetSolverOptions = {
    ...solverOptions,
    pdd,
  };

  const hydResult = solveHydraulics(net, opts);

  let totalRequired = 0.0;
  let totalDelivered = 0.0;
  const unservedNodes: string[] = [];
  const isolatedNodes: string[] = [];

  const actualDemands = hydResult.nodeActualDemands ?? new Map<string, number>();

  for (const junc of net.junctions) {
    const customDem = opts.demandOverrides?.get(junc.id.toLowerCase()) ?? opts.demandOverrides?.get(junc.id);
    const req = customDem !== undefined ? customDem : junc.demand;
    const delivered = actualDemands.get(junc.id) ?? req;

    if (req > 0.0) {
      totalRequired += req;
      totalDelivered += delivered;

      if (delivered < req * 0.99) {
        unservedNodes.push(junc.id);
      }
      if (delivered <= 1e-4) {
        isolatedNodes.push(junc.id);
      }
    }
  }

  const unsupplied = Math.max(0.0, totalRequired - totalDelivered);
  const ratio = totalRequired > 0.0 ? Math.min(1.0, totalDelivered / totalRequired) : 1.0;

  return {
    converged: hydResult.converged,
    requiredDemandLps: totalRequired,
    deliveredDemandLps: totalDelivered,
    unsuppliedDemandLps: unsupplied,
    satisfactionRatio: ratio,
    unservedNodes,
    isolatedNodes,
    hydraulics: hydResult,
  };
}

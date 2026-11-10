// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/powerfactory — Optimal Power Flow (OPF) & QDSL Bridge for PowerFactory Models.
 *
 * Implements direct coupling between DIgSILENT PowerFactory models and ModelScript's
 * high-performance AC/DC Optimal Power Flow and Quasi-Dynamic Time-Series simulation engines.
 */

import {
  solveAcOpf,
  solveDcOpf,
  type GeneratorCostCurve,
  type GenericPowerCase,
  type OpfOptions,
  type OpfSolution,
} from "@modelscript/simulate/opf";
import {
  runQuasiDynamicSimulation,
  type QdslOptions,
  type QdslResult,
} from "@modelscript/simulate/powerflow";
import { powerFactoryToPsse } from "../projections/powerfactory-to-psse.js";
import type { PowerFactoryModel } from "../types.js";

/**
 * Converts a PowerFactoryModel into a canonical GenericPowerCase for OPF and QDSL solvers.
 */
export function powerFactoryToGenericPowerCase(
  model: PowerFactoryModel,
  customCosts?: Map<string, GeneratorCostCurve> | undefined,
): GenericPowerCase {
  const { psseCase, termToBusMap } = powerFactoryToPsse(model);

  // Build generator economic cost curves
  const generatorCosts = new Map<string, GeneratorCostCurve>();

  for (const gen of psseCase.generators) {
    const key = `${gen.i}_${gen.id.trim()}`;
    const busKey = String(gen.i);

    // Find corresponding PowerFactory generator for loc_name matching
    const pfGen = Array.from(model.generators.values()).find((g) => {
      const bNum = termToBusMap.get(g.bus1Id);
      return bNum === gen.i;
    });

    let assignedCost: GeneratorCostCurve | undefined;

    if (customCosts) {
      if (customCosts.has(key)) assignedCost = customCosts.get(key);
      else if (customCosts.has(busKey)) assignedCost = customCosts.get(busKey);
      else if (pfGen && customCosts.has(`${gen.i}_${pfGen.id}`)) assignedCost = customCosts.get(`${gen.i}_${pfGen.id}`);
      else if (pfGen && customCosts.has(`${gen.i}_${pfGen.loc_name}`)) assignedCost = customCosts.get(`${gen.i}_${pfGen.loc_name}`);
      else if (pfGen && customCosts.has(pfGen.id)) assignedCost = customCosts.get(pfGen.id);
      else if (pfGen && customCosts.has(pfGen.loc_name)) assignedCost = customCosts.get(pfGen.loc_name);
    }

    if (assignedCost) {
      generatorCosts.set(key, assignedCost);
      continue;
    }

    // Default merit-order cost assignment:
    // Check if generator is renewable (static generator or solar/wind naming)
    const isRenewable =
      Array.from(model.staticGenerators.values()).some((sg) => sg.id === gen.id || sg.loc_name.includes(gen.id)) ||
      gen.id.toLowerCase().includes("pv") ||
      gen.id.toLowerCase().includes("wind");

    if (isRenewable) {
      generatorCosts.set(key, { c0: 0, c1: 0.0, c2: 0.001 });
    } else {
      generatorCosts.set(key, { c0: 100, c1: 30.0, c2: 0.05 });
    }
  }

  return {
    header: { sbase: psseCase.header.sbase },
    title1: psseCase.title1 || "PowerFactory Grid Case",
    buses: psseCase.buses,
    loads: psseCase.loads,
    generators: psseCase.generators,
    branches: psseCase.branches,
    transformers: psseCase.transformers,
    generatorCosts,
  };
}

/**
 * Solves Optimal Power Flow (AC-OPF or DC-OPF) directly on a PowerFactory model.
 *
 * @param model PowerFactoryModel network
 * @param options OPF options (formulation: 'ac' | 'dc', enforceThermalLimits, generatorCosts)
 * @returns OpfSolution with optimal dispatch, LMPs ($/MWh), and branch loadings
 */
export function solvePowerFactoryOpf(
  model: PowerFactoryModel,
  options: OpfOptions = {},
): OpfSolution {
  const powerCase = powerFactoryToGenericPowerCase(model, options.generatorCosts);
  const formulation = options.formulation ?? "dc";

  if (formulation === "ac") {
    return solveAcOpf(powerCase, options);
  }
  return solveDcOpf(powerCase, options);
}

/**
 * Runs Quasi-Dynamic Time-Series (QDSL) simulation directly on a PowerFactory model.
 *
 * @param model PowerFactoryModel network
 * @param options QDSL options (timeStepHours, durationHours, loadProfiles, generationProfiles)
 * @returns QdslResult with time-series profiles and aggregate energy metrics
 */
export function solvePowerFactoryQdsl(
  model: PowerFactoryModel,
  options: QdslOptions = {},
): QdslResult {
  const powerCase = powerFactoryToGenericPowerCase(model);
  return runQuasiDynamicSimulation(powerCase, options);
}

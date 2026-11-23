// SPDX-License-Identifier: AGPL-3.0-or-later

import { DEEP_SPACE_TEMP_K, type TrasysDeck } from "../types.js";
import { computeOrbitalFluxes, type OrbitalFluxResult } from "./orbital-flux.js";
import { computeGebhartExchange, solveEquilibriumTemperatures, type GebhartResult } from "./radiosity.js";
import { computeViewFactors, type ViewFactorOptions, type ViewFactorResult } from "./view-factors.js";

export {
  computeEclipseFraction,
  computeOrbitalFluxes,
  computePlanetViewFactor,
  type OrbitalFluxResult,
  type SurfaceOrbitalFlux,
} from "./orbital-flux.js";
export { computeGebhartExchange, solveEquilibriumTemperatures, type GebhartResult } from "./radiosity.js";
export {
  computeViewFactors,
  viewFactorCoaxialDisks,
  viewFactorParallelRectangles,
  type ViewFactorOptions,
  type ViewFactorResult,
} from "./view-factors.js";

export interface TrasysThermalSolution {
  viewFactors: ViewFactorResult;
  gebhart: GebhartResult;
  orbital: OrbitalFluxResult;
  temperaturesK: Record<string, number>;
}

/**
 * Runs the complete TRASYS thermal radiation analysis pipeline:
 *   1. FFCAL: View factors (F_ij)
 *   2. RKCAL: Gebhart absorption (B_ij) & radiation conductors (RADK)
 *   3. QCAL:  Orbital solar/albedo/planet-IR heating fluxes
 *   4. Steady-state radiative equilibrium temperatures (T_i)
 */
export function solveTrasysThermal(
  deck: TrasysDeck,
  options?: ViewFactorOptions & { spaceTempK?: number | undefined },
): TrasysThermalSolution {
  const viewFactors = computeViewFactors(deck.surfaces, {
    raysPerSurface: options?.raysPerSurface ?? deck.options.rays,
    seed: options?.seed,
    method: options?.method,
    enforceReciprocity: options?.enforceReciprocity,
  });
  const gebhart = computeGebhartExchange(deck.surfaces, viewFactors, deck.options.stefanBoltzmann);
  const orbital = computeOrbitalFluxes(deck);

  const heatLoads: Record<string, number> = {};
  for (const [id, flux] of Object.entries(orbital.surfaces)) {
    heatLoads[id] = flux.qTotalW;
  }

  const temperaturesK = solveEquilibriumTemperatures(gebhart, heatLoads, options?.spaceTempK ?? DEEP_SPACE_TEMP_K);

  return {
    viewFactors,
    gebhart,
    orbital,
    temperaturesK,
  };
}

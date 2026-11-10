// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GeothermalWellResult, ToughDeck } from "../types.js";

const H_SAT_LIQUID_100C = 419040.0; // J/kg
const H_SAT_VAPOR_100C = 2676000.0; // J/kg

/**
 * Geothermal Well & Flashing Production Evaluator:
 * Computes thermal power generation and flashed steam quality for producing geothermal wells.
 */
export function solveGeothermalWells(deck: ToughDeck): GeothermalWellResult[] {
  const results: GeothermalWellResult[] = [];

  for (const gen of deck.generators) {
    if (gen.type === "MASS") {
      const massRate = Math.abs(gen.rate); // production rate in kg/s
      const enthalpy = gen.enthalpy > 0 ? gen.enthalpy : 1000000.0; // J/kg

      // Flashed steam fraction at atmospheric separation
      let steamFraction = 0.0;
      if (enthalpy > H_SAT_LIQUID_100C) {
        steamFraction = Math.min(
          1.0,
          (enthalpy - H_SAT_LIQUID_100C) / (H_SAT_VAPOR_100C - H_SAT_LIQUID_100C),
        );
      }

      // Thermal power produced (MWth) relative to 40 deg C reinjection (~167.5 kJ/kg)
      const hReinject = 167500.0;
      const thermalPower = (massRate * Math.max(0, enthalpy - hReinject)) / 1e6;

      results.push({
        element: gen.elem,
        wellName: gen.name,
        massRateKgS: massRate,
        enthalpyJPerKg: enthalpy,
        thermalPowerMW: thermalPower,
        steamFraction,
      });
    }
  }

  return results;
}

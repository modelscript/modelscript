// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projection from NASA TRASYS to Modelica (.mo) radiative heat balance model.
 */

import { computeSurfaceArea } from "../cad/index.js";
import { solveTrasysThermal, type ViewFactorOptions } from "../solver/index.js";
import { DEEP_SPACE_TEMP_K, type TrasysDeck } from "../types.js";

function sanitizeIdent(id: string): string {
  const clean = id.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(clean) ? `S_${clean}` : clean;
}

/**
 * Generates a Modelica model representing the TRASYS radiative thermal network.
 */
export function trasysToModelica(deck: TrasysDeck, options?: ViewFactorOptions & { spaceTempK?: number }): string {
  const spaceTempK = options?.spaceTempK ?? DEEP_SPACE_TEMP_K;
  const sol = solveTrasysThermal(deck, options);
  const active = deck.surfaces.filter((s) => s.active !== "NONE");
  const modelName = sanitizeIdent(deck.name || "TrasysRadiationModel");

  const lines: string[] = [
    `model ${modelName} "Generated from NASA TRASYS thermal radiation deck"`,
    `  parameter Real sigma_SB = ${deck.options.stefanBoltzmann.toExponential(6)} "Stefan-Boltzmann constant [W/(m2.K4)]";`,
    `  parameter Real T_space = ${spaceTempK.toFixed(3)} "Deep space temperature [K]";`,
  ];

  // Surface parameters and temperature variables
  for (let i = 0; i < active.length; i++) {
    const s = active[i]!;
    const sid = sanitizeIdent(s.id);
    const area = computeSurfaceArea(s);
    const flux = sol.orbital.surfaces[s.id];
    const tEq = sol.temperaturesK[s.id] ?? s.temperatureK ?? 290.0;
    lines.push(
      `  parameter Real A_${sid} = ${area.toFixed(6)} "Surface ${s.id} area [m2]";`,
      `  parameter Real alpha_${sid} = ${s.prop.alpha.toFixed(4)} "Solar absorptance";`,
      `  parameter Real eps_${sid} = ${s.prop.epsilon.toFixed(4)} "IR emissivity";`,
      `  parameter Real Q_total_${sid} = ${(flux?.qTotalW ?? 0).toFixed(6)} "Orbital + internal absorbed heat [W]";`,
      `  parameter Real G_space_${sid} = ${(sol.gebhart.radkSpace[i] ?? 0).toExponential(6)} "Space radiation conductor [W/K4]";`,
      `  Real T_${sid}(start = ${tEq.toFixed(2)}) "Surface ${s.id} temperature [K]";`,
    );
  }

  // Pairwise radiation conductors
  for (let i = 0; i < active.length; i++) {
    for (let j = 0; j < active.length; j++) {
      if (i === j) continue;
      const gij = sol.gebhart.radk[i]?.[j] ?? 0;
      if (gij > 1e-18) {
        const si = sanitizeIdent(active[i]!.id);
        const sj = sanitizeIdent(active[j]!.id);
        lines.push(
          `  parameter Real G_rad_${si}_${sj} = ${gij.toExponential(6)} "RADK ${active[i]!.id} -> ${active[j]!.id} [W/K4]";`,
        );
      }
    }
  }

  lines.push(`equation`);
  for (let i = 0; i < active.length; i++) {
    const si = sanitizeIdent(active[i]!.id);
    const terms: string[] = [`G_space_${si} * (T_${si}^4 - T_space^4)`];
    for (let j = 0; j < active.length; j++) {
      if (i === j) continue;
      const gij = sol.gebhart.radk[i]?.[j] ?? 0;
      if (gij > 1e-18) {
        const sj = sanitizeIdent(active[j]!.id);
        terms.push(`G_rad_${si}_${sj} * (T_${si}^4 - T_${sj}^4)`);
      }
    }
    lines.push(`  ${terms.join(" + ")} = Q_total_${si};`);
  }

  lines.push(`end ${modelName};`, ``);
  return lines.join("\n");
}

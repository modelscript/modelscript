// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mcnp — Projection from MCNP Deck to Modelica (Point-Kinetics & Cell Flux Balance).
 */

import { computeExactCellVolume } from "../cad/csg-geometry.js";
import { computeMaterialCrossSections } from "../solver/monte-carlo.js";
import type { McnpDeck } from "../types.js";

function sanitizeIdent(raw: string): string {
  const clean = raw.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "");
  if (!clean) return "McnpModel";
  return /^[0-9]/.test(clean) ? `M_${clean}` : clean;
}

/**
 * Generates a clean Modelica model representing the MCNP deck's 6-group point-kinetics
 * and homogenized cell-level neutron flux balance.
 */
export function mcnpToModelica(deck: McnpDeck): string {
  const modelName = sanitizeIdent(deck.title || "McnpTransportModel");
  const lines: string[] = [
    `model ${modelName}`,
    `  "Projected from MCNP transport deck: ${deck.title.replace(/"/g, "'")}"`,
    `  parameter Real Lambda = 1.0e-5 "Prompt neutron generation time [s]";`,
    `  parameter Real beta[6] = {0.000215, 0.001424, 0.001274, 0.002568, 0.000748, 0.000273};`,
    `  parameter Real lambda_d[6] = {0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01};`,
    `  parameter Real beta_tot = sum(beta);`,
    `  parameter Real rho_0 = 0.0 "Initial reactivity";`,
    `  Real n(start = 1.0) "Normalized reactor power";`,
    `  Real rho "Reactivity";`,
    `  Real C[6](start = {beta[i] / (Lambda * lambda_d[i]) for i in 1:6}) "Delayed neutron precursors";`,
  ];

  const activeCells: Array<{ id: number; nuSigmaF: number; sigmaA: number; dCoeff: number; vol: number }> = [];
  for (const cell of deck.cells.values()) {
    const isGraveyard = Object.values(cell.imp).some((v) => v === 0);
    if (isGraveyard) continue;
    const mat = cell.materialId > 0 ? deck.materials.get(cell.materialId) : undefined;
    const xs =
      mat && cell.density
        ? computeMaterialCrossSections(mat, cell.density, "fast")
        : { sigmaA: 0, sigmaT: 0, nuSigmaF: 0 };
    const vol = computeExactCellVolume(deck, cell.id) ?? 1000.0;
    const dCoeff = xs.sigmaT > 0 ? 1.0 / (3.0 * xs.sigmaT) : 1.0;
    activeCells.push({ id: cell.id, nuSigmaF: xs.nuSigmaF, sigmaA: xs.sigmaA, dCoeff, vol });
    lines.push(
      `  parameter Real Sigma_a_${cell.id} = ${xs.sigmaA.toExponential(6)} "Cell ${cell.id} absorption XS [1/cm]";`,
      `  parameter Real nuSigma_f_${cell.id} = ${xs.nuSigmaF.toExponential(6)} "Cell ${cell.id} production XS [1/cm]";`,
      `  Real phi_${cell.id}(start = 1.0) "Cell ${cell.id} neutron flux [n/(cm^2*s)]";`,
    );
  }

  lines.push(`equation`);
  lines.push(`  rho = rho_0;`);
  lines.push(`  der(n) = ((rho - beta_tot) / Lambda) * n + sum(lambda_d[i] * C[i] for i in 1:6);`);
  lines.push(`  for i in 1:6 loop`);
  lines.push(`    der(C[i]) = (beta[i] / Lambda) * n - lambda_d[i] * C[i];`);
  lines.push(`  end for;`);

  for (const c of activeCells) {
    const rEff = Math.cbrt((3 * c.vol) / (4 * Math.PI));
    const bucklingSq = (Math.PI / Math.max(1.0, rEff)) ** 2;
    const leak = c.dCoeff * bucklingSq;
    lines.push(
      `  der(phi_${c.id}) = 1.4e9 * (nuSigma_f_${c.id} - Sigma_a_${c.id} - ${leak.toExponential(6)}) * phi_${c.id};`,
    );
  }

  lines.push(`end ${modelName};`);
  return lines.join("\n") + "\n";
}

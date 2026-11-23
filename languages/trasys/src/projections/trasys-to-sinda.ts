// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projection from NASA TRASYS to a SINDA/FLUINT thermal network conductor deck.
 *
 * Emits:
 *   - HEADER NODE DATA (thermal nodes + deep space boundary node 99999)
 *   - HEADER CONDUCTOR DATA (negative RADK radiation conductors in W/K^4)
 *   - HEADER SOURCE DATA (orbit-averaged solar, albedo, and planet-IR heat loads in W)
 */

import { solveTrasysThermal, type ViewFactorOptions } from "../solver/index.js";
import { DEEP_SPACE_TEMP_K, type TrasysDeck } from "../types.js";

export interface SindaProjectionOptions extends ViewFactorOptions {
  spaceNodeId?: number | undefined;
  spaceTempK?: number | undefined;
}

/**
 * Generates a SINDA/FLUINT thermal conductor deck from a parsed TRASYS model.
 */
export function trasysToSinda(deck: TrasysDeck, options?: SindaProjectionOptions): string {
  const spaceNodeId = options?.spaceNodeId ?? 99999;
  const spaceTempK = options?.spaceTempK ?? DEEP_SPACE_TEMP_K;
  const sol = solveTrasysThermal(deck, options);
  const active = deck.surfaces.filter((s) => s.active !== "NONE");

  const lines: string[] = [
    `C SINDA/FLUINT Thermal Radiation Deck generated from TRASYS model: ${deck.name}`,
    `HEADER OPTIONS DATA`,
    `  TITLE = ${deck.name} (SINDA Projection)`,
    `  ABSZRO = 0.0`,
    `  SIGMA = ${deck.options.stefanBoltzmann.toExponential(6)}`,
    ``,
    `HEADER NODE DATA`,
  ];

  const nodeIds: number[] = [];
  for (let i = 0; i < active.length; i++) {
    const s = active[i]!;
    const nid = s.nodeId ?? 100 + i + 1;
    nodeIds.push(nid);
    const tInit = sol.temperaturesK[s.id] ?? s.temperatureK ?? 290.0;
    lines.push(`  ${nid}, ${tInit.toFixed(2)}, 100.0 $ Surface ${s.id} (${s.kind})`);
  }
  lines.push(`  -${spaceNodeId}, ${spaceTempK.toFixed(3)}, 0.0 $ Deep Space Boundary Node`);

  lines.push(``, `HEADER CONDUCTOR DATA`);
  let condId = 1;
  // Pairwise radiation conductors (SINDA convention: negative conductor ID indicates radiation)
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const gij = sol.gebhart.radk[i]?.[j] ?? 0;
      if (gij > 1e-18) {
        lines.push(
          `  -${condId++}, ${nodeIds[i]}, ${nodeIds[j]}, ${gij.toExponential(6)} $ RADK ${active[i]!.id} <-> ${active[j]!.id}`,
        );
      }
    }
    const gSpace = sol.gebhart.radkSpace[i] ?? 0;
    if (gSpace > 1e-18) {
      lines.push(
        `  -${condId++}, ${nodeIds[i]}, ${spaceNodeId}, ${gSpace.toExponential(6)} $ RADK ${active[i]!.id} -> SPACE`,
      );
    }
  }

  lines.push(``, `HEADER SOURCE DATA`);
  for (let i = 0; i < active.length; i++) {
    const s = active[i]!;
    const flux = sol.orbital.surfaces[s.id];
    const qTot = flux?.qTotalW ?? 0;
    lines.push(
      `  ${nodeIds[i]}, ${qTot.toFixed(4)} $ Q_sol=${(flux?.qSolarW ?? 0).toFixed(2)}W Q_alb=${(flux?.qAlbedoW ?? 0).toFixed(2)}W Q_ir=${(flux?.qPlanetIrW ?? 0).toFixed(2)}W`,
    );
  }

  lines.push(``, `END OF DATA`, ``);
  return lines.join("\n");
}

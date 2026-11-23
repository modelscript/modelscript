// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/scale — Projection to LANL MCNP Criticality Input Deck.
 */

import { SCALE_NUCLIDE_DATA, SCALE_STANDARD_COMPOSITIONS, normalizeNuclideId } from "../catalog/scale-std-schemas.js";
import type { ScaleDeck } from "../types.js";

/**
 * Projects a parsed SCALE / KENO deck to an MCNP input deck (Cells, Surfaces, Materials, KCODE).
 */
export function scaleToMcnp(deck: ScaleDeck): string {
  const lines: string[] = [];
  const surfLines: string[] = [];
  const cellLines: string[] = [];
  const matLines: string[] = [];

  lines.push(`${deck.title || "SCALE-to-MCNP Projected Deck"}`);
  lines.push(`c Projected from ORNL SCALE (${deck.sequence || "csas6"})`);
  lines.push("c ==================== Cell Cards ====================");

  let nextCellId = 1;
  let nextSurfId = 1;
  const bodyToSurfMap = new Map<string, number>();

  for (const unit of deck.units.values()) {
    for (const body of unit.bodies) {
      const key = `${unit.id}:${body.id}`;
      const sId = nextSurfId++;
      bodyToSurfMap.set(key, sId);

      if (body.kind === "sphere") {
        const [ox, oy, oz] = body.origin ?? [0, 0, 0];
        if (ox === 0 && oy === 0 && oz === 0) {
          surfLines.push(`${sId} so ${(body.radius ?? 1).toFixed(4)}`);
        } else {
          surfLines.push(
            `${sId} s ${ox.toFixed(4)} ${oy.toFixed(4)} ${oz.toFixed(4)} ${(body.radius ?? 1).toFixed(4)}`,
          );
        }
      } else if (body.kind === "cylinder") {
        const [ox, oy, oz] = body.origin ?? [0, 0, 0];
        const zMin = (body.zMinus ?? -10) + oz;
        const h = (body.zPlus ?? 10) - (body.zMinus ?? -10);
        surfLines.push(
          `${sId} rcc ${ox.toFixed(4)} ${oy.toFixed(4)} ${zMin.toFixed(4)} 0 0 ${h.toFixed(4)} ${(body.radius ?? 1).toFixed(4)}`,
        );
      } else if (body.kind === "cuboid") {
        const [ox, oy, oz] = body.origin ?? [0, 0, 0];
        surfLines.push(
          `${sId} rpp ${((body.xMinus ?? -1) + ox).toFixed(4)} ${((body.xPlus ?? 1) + ox).toFixed(4)} ` +
            `${((body.yMinus ?? -1) + oy).toFixed(4)} ${((body.yPlus ?? 1) + oy).toFixed(4)} ` +
            `${((body.zMinus ?? -1) + oz).toFixed(4)} ${((body.zPlus ?? 1) + oz).toFixed(4)}`,
        );
      } else if (body.kind === "hexprism") {
        const [ox, oy, oz] = body.origin ?? [0, 0, 0];
        const zMin = (body.zMinus ?? -10) + oz;
        const h = (body.zPlus ?? 10) - (body.zMinus ?? -10);
        const a = body.radius ?? 1;
        surfLines.push(
          `${sId} hex ${ox.toFixed(4)} ${oy.toFixed(4)} ${zMin.toFixed(4)} 0 0 ${h.toFixed(4)} ${a.toFixed(4)} 0 0`,
        );
      }
    }

    for (const med of unit.media) {
      const cId = nextCellId++;
      const comp = deck.compositions.find((c) => c.mixtureId === med.mixtureId);
      const std = comp ? SCALE_STANDARD_COMPOSITIONS[comp.materialName.toUpperCase()] : undefined;
      const density = comp?.density ?? std?.defaultDensity ?? 1.0;

      const geomTerms: string[] = [];
      for (const reg of med.regions) {
        const sId = bodyToSurfMap.get(`${unit.id}:${Math.abs(reg)}`);
        if (sId !== undefined) {
          // KENO positive = inside (-sId in MCNP); KENO negative = outside (+sId in MCNP)
          geomTerms.push(reg > 0 ? `-${sId}` : `${sId}`);
        }
      }
      const geomExpr = geomTerms.length > 0 ? geomTerms.join(" ") : "-1";
      if (med.mixtureId === 0) {
        cellLines.push(`${cId} 0 ${geomExpr} imp:n=1 $ unit ${unit.id} void`);
      } else {
        cellLines.push(`${cId} ${med.mixtureId} -${density.toFixed(4)} ${geomExpr} imp:n=1 $ unit ${unit.id}`);
      }
    }
  }

  // Graveyard cell
  if (nextSurfId > 1) {
    const outerSurf = nextSurfId - 1;
    cellLines.push(`${nextCellId} 0 ${outerSurf} imp:n=0 $ graveyard`);
  }

  // Material cards
  for (const comp of deck.compositions) {
    const isoEntries = Object.entries(comp.isotopes);
    if (isoEntries.length > 0) {
      const pairs = isoEntries.map(([iso, pct]) => {
        const norm = normalizeNuclideId(iso);
        const zaid = SCALE_NUCLIDE_DATA[norm]?.zaid ?? 92235;
        return `${zaid}.80c -${(pct / 100).toFixed(6)}`;
      });
      matLines.push(`m${comp.mixtureId} ${pairs.join(" ")} $ ${comp.materialName}`);
    } else {
      const matUpper = comp.materialName.toUpperCase();
      if (matUpper === "H2O") {
        matLines.push(`m${comp.mixtureId} 1001.80c 2.0 8016.80c 1.0 $ H2O`);
      } else if (matUpper === "UO2") {
        const enr = (comp.enrichment ?? 3.5) / 100;
        matLines.push(
          `m${comp.mixtureId} 92235.80c ${enr.toFixed(5)} 92238.80c ${(1 - enr).toFixed(5)} 8016.80c 2.0 $ UO2`,
        );
      } else if (matUpper === "ZIRC4") {
        matLines.push(`m${comp.mixtureId} 40000.80c 0.982 50000.80c 0.015 26000.80c 0.003 $ ZIRC4`);
      } else if (matUpper === "B4C") {
        matLines.push(`m${comp.mixtureId} 5010.80c 0.8 5011.80c 3.2 6000.80c 1.0 $ B4C`);
      } else {
        matLines.push(`m${comp.mixtureId} 26056.80c 1.0 $ ${comp.materialName}`);
      }
    }
  }

  const npg = typeof deck.params.parameters["npg"] === "number" ? deck.params.parameters["npg"] : 1000;
  const nsk = typeof deck.params.parameters["nsk"] === "number" ? deck.params.parameters["nsk"] : 50;
  const gen = typeof deck.params.parameters["gen"] === "number" ? deck.params.parameters["gen"] : 250;

  lines.push(...cellLines);
  lines.push("");
  lines.push("c ==================== Surface Cards ====================");
  lines.push(...surfLines);
  lines.push("");
  lines.push("c ==================== Data Cards ====================");
  lines.push("mode n");
  lines.push(`kcode ${npg} 1.0 ${nsk} ${gen}`);
  lines.push("ksrc 0.0 0.0 0.0");
  lines.push(...matLines);

  return lines.join("\n") + "\n";
}

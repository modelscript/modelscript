// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Serializer for Wastewater Treatment Plant (.asm, .bsm) Model Descriptions.
 */

import type { AsmPlantModel } from "../types.js";

/**
 * Serializes an AsmPlantModel into standard ASM plant DSL syntax.
 */
export function writeAsmPlant(plant: AsmPlantModel): string {
  const lines: string[] = [];
  lines.push(`plant ${plant.name} {`);
  lines.push(`  model: ${plant.modelType};`);
  lines.push(``);

  // Influent
  lines.push(`  influent {`);
  lines.push(`    flow: ${plant.influentFlowM3Day.toFixed(1)} m3/day;`);
  for (const [k, v] of Object.entries(plant.influentConcentrations)) {
    lines.push(`    ${k}: ${v.toFixed(2)};`);
  }
  lines.push(`  }`);
  lines.push(``);

  // Recycle
  lines.push(`  recycle {`);
  lines.push(`    internal_ratio: ${plant.internalRecycleRatio.toFixed(2)};`);
  lines.push(`    sludge_ratio: ${plant.sludgeRecycleRatio.toFixed(2)};`);
  lines.push(`    waste_flow: ${plant.wasteFlowM3Day.toFixed(1)} m3/day;`);
  lines.push(`  }`);
  lines.push(``);

  // Bioreactors
  for (const r of plant.reactors) {
    lines.push(`  bioreactor ${r.name} {`);
    lines.push(`    type: ${r.type};`);
    lines.push(`    volume: ${r.volumeM3.toFixed(1)} m3;`);
    if (r.klaHr !== undefined) lines.push(`    kla: ${r.klaHr.toFixed(1)};`);
    if (r.doTargetMgL !== undefined) lines.push(`    do_target: ${r.doTargetMgL.toFixed(1)};`);
    lines.push(`  }`);
    lines.push(``);
  }

  // Clarifiers
  for (const c of plant.clarifiers) {
    lines.push(`  clarifier ${c.name} {`);
    lines.push(`    area: ${c.surfaceAreaM2.toFixed(1)} m2;`);
    lines.push(`    depth: ${c.heightM.toFixed(1)} m;`);
    lines.push(`    layers: ${c.layers};`);
    lines.push(`    feed_layer: ${c.feedLayer};`);
    lines.push(`  }`);
    lines.push(``);
  }

  lines.push(`}`);
  return lines.join("\n") + "\n";
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Serializer for USACE HEC-HMS basin files (.basin).
 */

import type { HmsBasinModel } from "../types.js";

/**
 * Serializes an HmsBasinModel into standard HEC-HMS .basin format.
 */
export function writeHmsBasin(basin: HmsBasinModel): string {
  const lines: string[] = [];

  // Basin Header
  lines.push(`Basin: ${basin.name}`);
  lines.push(`  Unit System: ${basin.unitSystem}`);
  lines.push(`End:`);
  lines.push("");

  // Subbasins
  for (const [name, sb] of basin.subbasins) {
    lines.push(`Subbasin: ${name}`);
    lines.push(`  Area: ${sb.area.toFixed(4)}`);
    if (sb.downstream) lines.push(`  Downstream: ${sb.downstream}`);
    if (sb.lossMethod) lines.push(`  Loss: ${sb.lossMethod}`);
    if (sb.transformMethod) lines.push(`  Transform: ${sb.transformMethod}`);
    if (sb.baseflowMethod) lines.push(`  Baseflow: ${sb.baseflowMethod}`);
    lines.push(`End:`);
    lines.push("");

    if (sb.curveNumber !== undefined || sb.initialAbstraction !== undefined) {
      lines.push(`Subbasin-Loss: ${name}`);
      if (sb.curveNumber !== undefined) lines.push(`  Curve Number: ${sb.curveNumber.toFixed(2)}`);
      if (sb.initialAbstraction !== undefined) lines.push(`  Initial Abstraction: ${sb.initialAbstraction.toFixed(2)}`);
      if (sb.imperviousPercent !== undefined) lines.push(`  Impervious: ${sb.imperviousPercent.toFixed(2)}`);
      lines.push(`End:`);
      lines.push("");
    }

    if (sb.lagMinutes !== undefined || sb.timeOfConcentrationHours !== undefined) {
      lines.push(`Subbasin-Transform: ${name}`);
      if (sb.lagMinutes !== undefined) lines.push(`  Lag: ${sb.lagMinutes.toFixed(2)}`);
      if (sb.timeOfConcentrationHours !== undefined)
        lines.push(`  Time of Concentration: ${sb.timeOfConcentrationHours.toFixed(2)}`);
      if (sb.storageCoefficientHours !== undefined)
        lines.push(`  Storage Coefficient: ${sb.storageCoefficientHours.toFixed(2)}`);
      lines.push(`End:`);
      lines.push("");
    }
  }

  // Reaches
  for (const [name, r] of basin.reaches) {
    lines.push(`Reach: ${name}`);
    if (r.downstream) lines.push(`  Downstream: ${r.downstream}`);
    if (r.routingMethod) lines.push(`  Route: ${r.routingMethod}`);
    lines.push(`End:`);
    lines.push("");

    if (r.muskingumK !== undefined || r.muskingumX !== undefined) {
      lines.push(`Reach-Route: ${name}`);
      if (r.muskingumK !== undefined) lines.push(`  Muskingum K: ${r.muskingumK.toFixed(2)}`);
      if (r.muskingumX !== undefined) lines.push(`  Muskingum X: ${r.muskingumX.toFixed(2)}`);
      if (r.subreaches !== undefined) lines.push(`  Subreaches: ${r.subreaches}`);
      lines.push(`End:`);
      lines.push("");
    }
  }

  // Junctions
  for (const [name, j] of basin.junctions) {
    lines.push(`Junction: ${name}`);
    if (j.downstream) lines.push(`  Downstream: ${j.downstream}`);
    lines.push(`End:`);
    lines.push("");
  }

  // Reservoirs
  for (const [name, res] of basin.reservoirs) {
    lines.push(`Reservoir: ${name}`);
    if (res.downstream) lines.push(`  Downstream: ${res.downstream}`);
    lines.push(`End:`);
    lines.push("");
  }

  // Sinks
  for (const [name] of basin.sinks) {
    lines.push(`Sink: ${name}`);
    lines.push(`End:`);
    lines.push("");
  }

  return lines.join("\n");
}

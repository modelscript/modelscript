// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bi-directional Projection: USACE HEC-HMS Hydrograph -> HEC-RAS Unsteady Flow (.u01).
 */

import type { HmsHydrographPoint } from "../types.js";

export interface HecRasExportOptions {
  riverName?: string;
  reachName?: string;
  station?: string | number;
  flowTitle?: string;
}

/**
 * Converts a HEC-HMS hydrograph into a HEC-RAS unsteady flow (.u01) boundary condition deck.
 */
export function hmsHydrographToHecRasU01(hydrograph: HmsHydrographPoint[], options?: HecRasExportOptions): string {
  const river = options?.riverName ?? "MainRiver";
  const reach = options?.reachName ?? "Reach1";
  const station = options?.station ?? "1000";
  const title = options?.flowTitle ?? "HEC-HMS Inflow Hydrograph";

  const lines: string[] = [];
  lines.push(`Flow Title=${title}`);
  lines.push(`Program Version=6.00`);
  lines.push("");

  lines.push(`Boundary for River Reach & Node=${river},${reach},${station}`);
  lines.push(`Boundary Type=Flow Hydrograph`);
  lines.push(`Hydrograph Data=`);

  for (const p of hydrograph) {
    lines.push(`  ${p.timeHours.toFixed(2)}  ${p.flow.toFixed(2)}`);
  }

  return lines.join("\n");
}

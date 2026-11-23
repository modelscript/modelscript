// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/grib — Projection to Flat Lat/Lon CSV Table.
 */

import { lookupWmoParameterByCode } from "../catalog/grib-std-schemas.js";
import { getGdsLatitudes, getGdsLongitudes } from "../solver/packing.js";
import type { GribDocument } from "../types.js";

/**
 * Projects all GRIB1 messages in `doc` to a CSV table:
 *   `message,parameter,level_type,level_value,lat,lon,value`
 */
export function gribToCsv(doc: GribDocument): string {
  const rows: string[] = ["message,parameter,level_type,level_value,lat,lon,value"];

  for (const msg of doc.messages) {
    const pds = msg.pds;
    const paramName =
      pds?.parameterName ??
      (pds ? lookupWmoParameterByCode(pds.parameterCode)?.mnemonic : undefined) ??
      `P${pds?.parameterCode ?? 0}`;
    const levelType = pds?.levelName ?? String(pds?.levelType ?? 0);
    const levelVal = pds?.levelValue ?? 0;
    const values = msg.bds?.values ?? [];

    if (msg.gds && msg.gds.ni > 0 && msg.gds.nj > 0) {
      const lats = getGdsLatitudes(msg.gds);
      const lons = getGdsLongitudes(msg.gds);
      for (let j = 0; j < msg.gds.nj; j++) {
        for (let i = 0; i < msg.gds.ni; i++) {
          const idx = j * msg.gds.ni + i;
          const v = idx < values.length ? values[idx]! : NaN;
          const vStr = Number.isFinite(v) ? Number(v.toFixed(6)).toString() : "";
          rows.push(
            `${msg.index},${paramName},${levelType},${levelVal},${Number(lats[j]!.toFixed(4))},${Number(lons[i]!.toFixed(4))},${vStr}`,
          );
        }
      }
    } else {
      for (let k = 0; k < values.length; k++) {
        const v = values[k]!;
        const vStr = Number.isFinite(v) ? Number(v.toFixed(6)).toString() : "";
        rows.push(`${msg.index},${paramName},${levelType},${levelVal},0,${k},${vStr}`);
      }
    }
  }

  return rows.join("\n") + "\n";
}

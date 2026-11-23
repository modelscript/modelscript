// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/grib — Projection to NetCDF Common Data Language (CDL).
 */

import { lookupWmoLevelType, lookupWmoParameterByCode } from "../catalog/grib-std-schemas.js";
import { getGdsLatitudes, getGdsLongitudes } from "../solver/packing.js";
import type { GribDocument } from "../types.js";

/**
 * Projects a `GribDocument` to NetCDF CDL (Common Data Language) following CF-1.8 conventions.
 */
export function gribToNetCdfCdl(doc: GribDocument, datasetName = "grib1_dataset"): string {
  const safeDataset = datasetName.replace(/[^A-Za-z0-9_]/g, "_") || "grib1_dataset";
  const firstGds = doc.messages.find((m) => m.gds)?.gds;
  const ni = firstGds?.ni ?? 1;
  const nj = firstGds?.nj ?? 1;
  const lats = firstGds ? getGdsLatitudes(firstGds) : [0];
  const lons = firstGds ? getGdsLongitudes(firstGds) : [0];

  const lines: string[] = [];
  lines.push(`netcdf ${safeDataset} {`);
  lines.push(`dimensions:`);
  lines.push(`  lat = ${nj} ;`);
  lines.push(`  lon = ${ni} ;`);
  lines.push(`variables:`);
  lines.push(`  float lat(lat) ;`);
  lines.push(`    lat:units = "degrees_north" ;`);
  lines.push(`    lat:standard_name = "latitude" ;`);
  lines.push(`  float lon(lon) ;`);
  lines.push(`    lon:units = "degrees_east" ;`);
  lines.push(`    lon:standard_name = "longitude" ;`);

  const varEntries: Array<{ varName: string; values: number[] }> = [];
  const usedNames = new Set<string>();

  for (const msg of doc.messages) {
    const pds = msg.pds;
    const paramMeta = pds ? lookupWmoParameterByCode(pds.parameterCode) : undefined;
    const levelMeta = pds ? lookupWmoLevelType(pds.levelType) : undefined;
    const baseName = (pds?.parameterName ?? paramMeta?.mnemonic ?? `param_${pds?.parameterCode ?? msg.index}`).replace(
      /[^A-Za-z0-9_]/g,
      "_",
    );
    let varName = pds ? `${baseName}_${levelMeta?.mnemonic ?? `L${pds.levelType}`}_${pds.levelValue}` : baseName;
    if (usedNames.has(varName)) {
      varName = `${varName}_${msg.index}`;
    }
    usedNames.add(varName);

    lines.push(`  float ${varName}(lat, lon) ;`);
    lines.push(`    ${varName}:long_name = "${paramMeta?.name ?? baseName}" ;`);
    lines.push(`    ${varName}:units = "${paramMeta?.unit ?? "1"}" ;`);
    lines.push(`    ${varName}:GRIB1_parameter = ${pds?.parameterCode ?? 0} ;`);
    lines.push(`    ${varName}:GRIB1_level_type = ${pds?.levelType ?? 0} ;`);
    lines.push(`    ${varName}:GRIB1_level_value = ${pds?.levelValue ?? 0} ;`);
    lines.push(`    ${varName}:_FillValue = -9999.f ;`);

    varEntries.push({
      varName,
      values: msg.bds?.values ?? [],
    });
  }

  lines.push(``);
  lines.push(`// global attributes:`);
  lines.push(`    :Conventions = "CF-1.8" ;`);
  lines.push(`    :source = "WMO GRIB Edition 1 via @modelscript/grib" ;`);
  lines.push(`    :message_count = ${doc.messages.length} ;`);
  lines.push(`data:`);
  lines.push(`  lat = ${lats.map((v) => Number(v.toFixed(4))).join(", ")} ;`);
  lines.push(`  lon = ${lons.map((v) => Number(v.toFixed(4))).join(", ")} ;`);

  for (const entry of varEntries) {
    const formatted = entry.values.map((v) => (Number.isFinite(v) ? Number(v.toFixed(4)).toString() : "_")).join(", ");
    lines.push(`  ${entry.varName} = ${formatted} ;`);
  }

  lines.push(`}`);
  return lines.join("\n") + "\n";
}

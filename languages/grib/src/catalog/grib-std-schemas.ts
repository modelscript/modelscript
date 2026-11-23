// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/grib — Cleanroom WMO Table 2 (Parameters) & Table 3 (Level Types) Standard Library Schemas.
 */

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";
import type { GribLevelType, GribWmoParameter } from "../types.js";

/**
 * Archetype IDs matching `assets/grib-std-lib/src/models.ts`.
 */
export const GribArchetypeId = {
  PRES: 1,
  PRMSL: 2,
  HGT: 7,
  TMP: 11,
  UGRD: 33,
  VGRD: 34,
  RH: 52,
  APCP: 61,
  SFC: 101,
  ISBL: 100,
  MSL: 102,
  TGL: 105,
  TROP: 107,
  MAXW: 106,
} as const;

export type GribArchetypeId = (typeof GribArchetypeId)[keyof typeof GribArchetypeId];

export type GribSchemaCategory = "WMO Parameter" | "Vertical Level";

export interface GribCatalogSpec {
  name: string;
  aliases?: string[];
  label: string;
  category: GribSchemaCategory;
  archetypeId: GribArchetypeId;
  wmoCode: number;
  unit: string;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

/**
 * WMO Table 2 (Version 2) Parameter Lookup Table.
 */
export const WMO_TABLE_2: Record<number, GribWmoParameter> = {
  1: {
    code: 1,
    mnemonic: "PRES",
    name: "Pressure",
    unit: "Pa",
    minPlausible: 100,
    maxPlausible: 115000,
    description: "Atmospheric static pressure at the specified vertical level.",
  },
  2: {
    code: 2,
    mnemonic: "PRMSL",
    name: "Pressure reduced to MSL",
    unit: "Pa",
    minPlausible: 85000,
    maxPlausible: 110000,
    description: "Mean sea-level atmospheric pressure reduced via hydrostatic hypsometry.",
  },
  7: {
    code: 7,
    mnemonic: "HGT",
    name: "Geopotential height",
    unit: "gpm",
    minPlausible: -1000,
    maxPlausible: 80000,
    description: "Geopotential height Z = Phi / g_0 of an isobaric or reference surface.",
  },
  11: {
    code: 11,
    mnemonic: "TMP",
    name: "Temperature",
    unit: "K",
    minPlausible: 150,
    maxPlausible: 350,
    description: "Air temperature in Kelvin.",
  },
  33: {
    code: 33,
    mnemonic: "UGRD",
    name: "u-component of wind",
    unit: "m/s",
    minPlausible: -200,
    maxPlausible: 200,
    description: "Eastward (zonal) horizontal wind velocity component.",
  },
  34: {
    code: 34,
    mnemonic: "VGRD",
    name: "v-component of wind",
    unit: "m/s",
    minPlausible: -200,
    maxPlausible: 200,
    description: "Northward (meridional) horizontal wind velocity component.",
  },
  52: {
    code: 52,
    mnemonic: "RH",
    name: "Relative humidity",
    unit: "%",
    minPlausible: 0,
    maxPlausible: 105,
    description: "Atmospheric relative humidity percentage.",
  },
  61: {
    code: 61,
    mnemonic: "APCP",
    name: "Total precipitation",
    unit: "kg/m^2",
    minPlausible: 0,
    maxPlausible: 2000,
    description: "Accumulated total liquid-equivalent precipitation mass per unit area.",
  },
};

/**
 * WMO Table 3 Fixed Surface / Vertical Level Lookup Table.
 */
export const WMO_LEVEL_TYPES: Record<number, GribLevelType> = {
  1: {
    code: 1,
    mnemonic: "SFC",
    name: "Ground or water surface",
    unit: "1",
    description: "Earth ground or ocean surface level.",
  },
  6: {
    code: 6,
    mnemonic: "MAXW",
    name: "Maximum wind level",
    unit: "1",
    description: "Jet-stream maximum wind speed level.",
  },
  7: {
    code: 7,
    mnemonic: "TROP",
    name: "Tropopause",
    unit: "1",
    description: "Atmospheric tropopause boundary surface.",
  },
  100: {
    code: 100,
    mnemonic: "ISBL",
    name: "Isobaric level",
    unit: "hPa",
    description: "Constant atmospheric pressure surface in hectopascals (hPa / mb).",
  },
  102: {
    code: 102,
    mnemonic: "MSL",
    name: "Mean sea level",
    unit: "m",
    description: "Geopotential mean sea level reference surface.",
  },
  105: {
    code: 105,
    mnemonic: "TGL",
    name: "Specified height level above ground",
    unit: "m",
    description: "Fixed altitude above ground level (e.g. 2 m temperature, 10 m wind).",
  },
};

export function lookupWmoParameterByCode(code: number): GribWmoParameter | undefined {
  return WMO_TABLE_2[code];
}

export function lookupWmoParameterByMnemonic(mnemonic: string): GribWmoParameter | undefined {
  const upper = mnemonic.trim().toUpperCase();
  return Object.values(WMO_TABLE_2).find((p) => p.mnemonic === upper);
}

export function lookupWmoLevelType(code: number): GribLevelType | undefined {
  return WMO_LEVEL_TYPES[code];
}

export function lookupWmoLevelByMnemonic(mnemonic: string): GribLevelType | undefined {
  const upper = mnemonic.trim().toUpperCase();
  if (upper === "HTGL") return WMO_LEVEL_TYPES[105];
  return Object.values(WMO_LEVEL_TYPES).find((l) => l.mnemonic === upper);
}

const CATEGORY_COLORS: Record<GribSchemaCategory, { fill: string; stroke: string; badge: string }> = {
  "WMO Parameter": { fill: "#0f2942", stroke: "#38bdf8", badge: "WMO" },
  "Vertical Level": { fill: "#1e3a2f", stroke: "#34d399", badge: "LVL" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a WMO GRIB1 schema.
 */
export function generateGribBlockSvg(name: string, category: GribSchemaCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = name.toUpperCase().slice(0, 10);
  const fontSize = label.length > 7 ? "8.5" : "10.0";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPorts(category: GribSchemaCategory): DiagramPortSpec[] {
  if (category === "Vertical Level") {
    return [
      { name: "z_in", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "p_out", kind: "signal", side: "right", dx: 88, dy: 26 },
    ];
  }
  return [
    { name: "packed_in", kind: "signal", side: "left", dx: 0, dy: 26 },
    { name: "field_out", kind: "signal", side: "right", dx: 88, dy: 26 },
  ];
}

const GRIB_SPECS: GribCatalogSpec[] = [
  {
    name: "PRES",
    aliases: ["PRESSURE", "P", "WMO_1"],
    label: "PRES (Atmospheric Pressure)",
    category: "WMO Parameter",
    archetypeId: GribArchetypeId.PRES,
    wmoCode: 1,
    unit: "Pa",
    description: "WMO Table 2 code 1: Atmospheric static pressure in Pascals.",
    provenance: "WMO FM 92-VIII Ext. GRIB Table 2",
    params: [
      ["code", 1, "id", "WMO Table 2 parameter indicator"],
      ["reference", 101325, "Pa", "Reference atmospheric pressure"],
    ],
  },
  {
    name: "PRMSL",
    aliases: ["MSLP", "PMSL", "WMO_2"],
    label: "PRMSL (Mean Sea Level Pressure)",
    category: "WMO Parameter",
    archetypeId: GribArchetypeId.PRMSL,
    wmoCode: 2,
    unit: "Pa",
    description: "WMO Table 2 code 2: Pressure reduced to mean sea level in Pascals.",
    provenance: "WMO FM 92-VIII Ext. GRIB Table 2",
    params: [
      ["code", 2, "id", "WMO Table 2 parameter indicator"],
      ["reference", 101325, "Pa", "Standard sea-level pressure"],
    ],
  },
  {
    name: "HGT",
    aliases: ["GH", "GEOPOTENTIAL_HEIGHT", "Z", "WMO_7"],
    label: "HGT (Geopotential Height)",
    category: "WMO Parameter",
    archetypeId: GribArchetypeId.HGT,
    wmoCode: 7,
    unit: "gpm",
    description: "WMO Table 2 code 7: Geopotential height in geopotential meters (gpm).",
    provenance: "WMO FM 92-VIII Ext. GRIB Table 2",
    params: [
      ["code", 7, "id", "WMO Table 2 parameter indicator"],
      ["reference", 5500, "gpm", "Typical 500 hPa geopotential height"],
    ],
  },
  {
    name: "TMP",
    aliases: ["TEMP", "TEMPERATURE", "T", "WMO_11"],
    label: "TMP (Air Temperature)",
    category: "WMO Parameter",
    archetypeId: GribArchetypeId.TMP,
    wmoCode: 11,
    unit: "K",
    description: "WMO Table 2 code 11: Atmospheric air temperature in Kelvin.",
    provenance: "WMO FM 92-VIII Ext. GRIB Table 2",
    params: [
      ["code", 11, "id", "WMO Table 2 parameter indicator"],
      ["reference", 288.15, "K", "ISA sea-level standard temperature"],
    ],
  },
  {
    name: "UGRD",
    aliases: ["U", "UWIND", "WMO_33"],
    label: "UGRD (Zonal Wind U)",
    category: "WMO Parameter",
    archetypeId: GribArchetypeId.UGRD,
    wmoCode: 33,
    unit: "m/s",
    description: "WMO Table 2 code 33: Eastward (u) wind velocity component in m/s.",
    provenance: "WMO FM 92-VIII Ext. GRIB Table 2",
    params: [
      ["code", 33, "id", "WMO Table 2 parameter indicator"],
      ["reference", 0, "m/s", "Reference zonal wind"],
    ],
  },
  {
    name: "VGRD",
    aliases: ["V", "VWIND", "WMO_34"],
    label: "VGRD (Meridional Wind V)",
    category: "WMO Parameter",
    archetypeId: GribArchetypeId.VGRD,
    wmoCode: 34,
    unit: "m/s",
    description: "WMO Table 2 code 34: Northward (v) wind velocity component in m/s.",
    provenance: "WMO FM 92-VIII Ext. GRIB Table 2",
    params: [
      ["code", 34, "id", "WMO Table 2 parameter indicator"],
      ["reference", 0, "m/s", "Reference meridional wind"],
    ],
  },
  {
    name: "RH",
    aliases: ["RELH", "HUMIDITY", "WMO_52"],
    label: "RH (Relative Humidity)",
    category: "WMO Parameter",
    archetypeId: GribArchetypeId.RH,
    wmoCode: 52,
    unit: "%",
    description: "WMO Table 2 code 52: Atmospheric relative humidity in percent.",
    provenance: "WMO FM 92-VIII Ext. GRIB Table 2",
    params: [
      ["code", 52, "id", "WMO Table 2 parameter indicator"],
      ["reference", 50, "%", "Mid-troposphere nominal RH"],
    ],
  },
  {
    name: "APCP",
    aliases: ["PRECIP", "TP", "WMO_61"],
    label: "APCP (Total Precipitation)",
    category: "WMO Parameter",
    archetypeId: GribArchetypeId.APCP,
    wmoCode: 61,
    unit: "kg/m^2",
    description: "WMO Table 2 code 61: Accumulated total precipitation in kg/m^2 (mm).",
    provenance: "WMO FM 92-VIII Ext. GRIB Table 2",
    params: [
      ["code", 61, "id", "WMO Table 2 parameter indicator"],
      ["reference", 0, "kg/m^2", "Baseline precipitation"],
    ],
  },
  {
    name: "SFC",
    aliases: ["SURFACE", "LVL_1"],
    label: "SFC (Ground/Water Surface)",
    category: "Vertical Level",
    archetypeId: GribArchetypeId.SFC,
    wmoCode: 1,
    unit: "1",
    description: "WMO Table 3 code 1: Ground or water surface level.",
    provenance: "WMO FM 92-VIII Ext. GRIB Table 3",
    params: [["levelType", 1, "id", "WMO Table 3 level indicator"]],
  },
  {
    name: "ISBL",
    aliases: ["ISOBARIC", "PRESSURE_LEVEL", "LVL_100"],
    label: "ISBL (Isobaric Pressure Level)",
    category: "Vertical Level",
    archetypeId: GribArchetypeId.ISBL,
    wmoCode: 100,
    unit: "hPa",
    description: "WMO Table 3 code 100: Constant pressure isobaric surface in hPa.",
    provenance: "WMO FM 92-VIII Ext. GRIB Table 3",
    params: [
      ["levelType", 100, "id", "WMO Table 3 level indicator"],
      ["levelValue", 500, "hPa", "Isobaric pressure level"],
    ],
  },
  {
    name: "MSL",
    aliases: ["MEAN_SEA_LEVEL", "LVL_102"],
    label: "MSL (Mean Sea Level)",
    category: "Vertical Level",
    archetypeId: GribArchetypeId.MSL,
    wmoCode: 102,
    unit: "m",
    description: "WMO Table 3 code 102: Mean sea level surface.",
    provenance: "WMO FM 92-VIII Ext. GRIB Table 3",
    params: [["levelType", 102, "id", "WMO Table 3 level indicator"]],
  },
  {
    name: "TGL",
    aliases: ["HTGL", "AGL", "LVL_105"],
    label: "TGL (Height Above Ground)",
    category: "Vertical Level",
    archetypeId: GribArchetypeId.TGL,
    wmoCode: 105,
    unit: "m",
    description: "WMO Table 3 code 105: Specified height level above ground in meters.",
    provenance: "WMO FM 92-VIII Ext. GRIB Table 3",
    params: [
      ["levelType", 105, "id", "WMO Table 3 level indicator"],
      ["levelValue", 2, "m", "Altitude above ground"],
    ],
  },
  {
    name: "TROP",
    aliases: ["TROPOPAUSE", "LVL_7"],
    label: "TROP (Tropopause)",
    category: "Vertical Level",
    archetypeId: GribArchetypeId.TROP,
    wmoCode: 7,
    unit: "1",
    description: "WMO Table 3 code 7: Atmospheric tropopause level.",
    provenance: "WMO FM 92-VIII Ext. GRIB Table 3",
    params: [["levelType", 7, "id", "WMO Table 3 level indicator"]],
  },
  {
    name: "MAXW",
    aliases: ["MAX_WIND", "LVL_6"],
    label: "MAXW (Maximum Wind Level)",
    category: "Vertical Level",
    archetypeId: GribArchetypeId.MAXW,
    wmoCode: 6,
    unit: "1",
    description: "WMO Table 3 code 6: Maximum wind speed level.",
    provenance: "WMO FM 92-VIII Ext. GRIB Table 3",
    params: [["levelType", 6, "id", "WMO Table 3 level indicator"]],
  },
];

/**
 * Builds the declarative `CleanroomModelSchema[]` array for `@modelscript/grib-std-lib`.
 */
export function buildGribCleanroomSchemas(): CleanroomModelSchema[] {
  return GRIB_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    const namespace = spec.category === "WMO Parameter" ? "WMO.Table2" : "WMO.Table3";
    return {
      namePath: `GRIB.${namespace}.${spec.name}`,
      name: spec.name,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "meteorology",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: spec.category === "WMO Parameter" ? "grib_parameter" : "grib_level",
      width: 88,
      height: 52,
      svg: generateGribBlockSvg(spec.name, spec.category),
      ports: defaultPorts(spec.category),
      parameters,
      wasmKernel: "gribEval",
      extra: {
        archetypeId: spec.archetypeId,
        wmoCode: spec.wmoCode,
        unit: spec.unit,
      },
    };
  });
}

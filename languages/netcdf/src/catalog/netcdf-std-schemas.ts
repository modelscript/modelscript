// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/netcdf — Cleanroom CF-1.x Standard Variables & NetCDF Classic Data Type Schemas.
 */

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Archetype IDs matching `assets/netcdf-std-lib/src/models.ts`.
 */
export const NetcdfArchetypeId = {
  // CF-1.x Standard Variables
  TEMPERATURE: 1,
  PRESSURE: 2,
  U_WIND: 3,
  V_WIND: 4,
  SALINITY: 5,
  ELEVATION: 6,
  // NetCDF Classic Data Types
  NC_BYTE: 11,
  NC_CHAR: 12,
  NC_SHORT: 13,
  NC_INT: 14,
  NC_FLOAT: 15,
  NC_DOUBLE: 16,
} as const;

export type NetcdfArchetypeId = (typeof NetcdfArchetypeId)[keyof typeof NetcdfArchetypeId];

export type NetcdfSchemaCategory = "CF-1.x Atmosphere" | "CF-1.x Ocean & Surface" | "NetCDF Classic Types";

export interface NetcdfSchemaSpec {
  name: string;
  aliases?: string[];
  label: string;
  category: NetcdfSchemaCategory;
  archetypeId: NetcdfArchetypeId;
  description: string;
  provenance: string;
  params: Array<
    [key: string, defaultValue: number | string, unit?: string | undefined, description?: string | undefined]
  >;
}

const CATEGORY_COLORS: Record<NetcdfSchemaCategory, { fill: string; stroke: string; badge: string }> = {
  "CF-1.x Atmosphere": { fill: "#1e293b", stroke: "#38bdf8", badge: "ATM" },
  "CF-1.x Ocean & Surface": { fill: "#12302b", stroke: "#34d399", badge: "OCN" },
  "NetCDF Classic Types": { fill: "#2e1f3d", stroke: "#c084fc", badge: "CDF" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a NetCDF / CF-1.x schema.
 */
export function generateNetcdfBlockSvg(name: string, category: NetcdfSchemaCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = name.toUpperCase().slice(0, 11);
  const fontSize = label.length > 8 ? "8.0" : "9.5";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPorts(category: NetcdfSchemaCategory): DiagramPortSpec[] {
  if (category === "NetCDF Classic Types") {
    return [
      { name: "raw", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "unpacked", kind: "signal", side: "right", dx: 88, dy: 26 },
    ];
  }
  return [
    { name: "grid_in", kind: "signal", side: "left", dx: 0, dy: 26 },
    { name: "field_out", kind: "signal", side: "right", dx: 88, dy: 26 },
  ];
}

export const NETCDF_STD_SPECS: readonly NetcdfSchemaSpec[] = [
  // CF-1.x Standard Variables
  {
    name: "temperature",
    aliases: ["air_temperature", "temp", "tas", "T"],
    label: "Air Temperature (CF-1.x)",
    category: "CF-1.x Atmosphere",
    archetypeId: NetcdfArchetypeId.TEMPERATURE,
    description: "CF-1.x standard air temperature field (standard_name='air_temperature', canonical units='K').",
    provenance: "CF Conventions 1.8 / Unidata NetCDF Classic",
    params: [
      ["standard_name", "air_temperature", undefined, "CF canonical standard name"],
      ["units", "K", "K", "SI thermodynamic temperature unit"],
      ["scale_factor", 1.0, undefined, "Linear packing scale factor"],
      ["add_offset", 0.0, "K", "Linear packing additive offset"],
      ["valid_min", 150.0, "K", "Lower physical validity bound"],
      ["valid_max", 350.0, "K", "Upper physical validity bound"],
    ],
  },
  {
    name: "pressure",
    aliases: ["air_pressure", "psl", "slp", "P"],
    label: "Air Pressure (CF-1.x)",
    category: "CF-1.x Atmosphere",
    archetypeId: NetcdfArchetypeId.PRESSURE,
    description: "CF-1.x standard atmospheric pressure field (standard_name='air_pressure', canonical units='Pa').",
    provenance: "CF Conventions 1.8 / Unidata NetCDF Classic",
    params: [
      ["standard_name", "air_pressure", undefined, "CF canonical standard name"],
      ["units", "Pa", "Pa", "SI pressure unit"],
      ["scale_factor", 1.0, undefined, "Linear packing scale factor"],
      ["add_offset", 0.0, "Pa", "Linear packing additive offset"],
      ["reference_pressure", 101325.0, "Pa", "Standard sea-level reference pressure"],
    ],
  },
  {
    name: "u_wind",
    aliases: ["eastward_wind", "uas", "u"],
    label: "Eastward Wind (CF-1.x)",
    category: "CF-1.x Atmosphere",
    archetypeId: NetcdfArchetypeId.U_WIND,
    description: "CF-1.x zonal (eastward) wind velocity component (standard_name='eastward_wind', units='m s-1').",
    provenance: "CF Conventions 1.8 / Unidata NetCDF Classic",
    params: [
      ["standard_name", "eastward_wind", undefined, "CF canonical standard name"],
      ["units", "m s-1", "m/s", "Zonal velocity unit"],
      ["scale_factor", 1.0, undefined, "Linear packing scale factor"],
      ["add_offset", 0.0, "m/s", "Linear packing additive offset"],
    ],
  },
  {
    name: "v_wind",
    aliases: ["northward_wind", "vas", "v"],
    label: "Northward Wind (CF-1.x)",
    category: "CF-1.x Atmosphere",
    archetypeId: NetcdfArchetypeId.V_WIND,
    description:
      "CF-1.x meridional (northward) wind velocity component (standard_name='northward_wind', units='m s-1').",
    provenance: "CF Conventions 1.8 / Unidata NetCDF Classic",
    params: [
      ["standard_name", "northward_wind", undefined, "CF canonical standard name"],
      ["units", "m s-1", "m/s", "Meridional velocity unit"],
      ["scale_factor", 1.0, undefined, "Linear packing scale factor"],
      ["add_offset", 0.0, "m/s", "Linear packing additive offset"],
    ],
  },
  {
    name: "salinity",
    aliases: ["sea_water_salinity", "so", "S"],
    label: "Sea Water Salinity (CF-1.x)",
    category: "CF-1.x Ocean & Surface",
    archetypeId: NetcdfArchetypeId.SALINITY,
    description: "CF-1.x practical sea water salinity field (standard_name='sea_water_salinity', units='0.001').",
    provenance: "CF Conventions 1.8 / Unidata NetCDF Classic",
    params: [
      ["standard_name", "sea_water_salinity", undefined, "CF canonical standard name"],
      ["units", "0.001", "PSU", "Practical Salinity Units (g/kg)"],
      ["scale_factor", 1.0, undefined, "Linear packing scale factor"],
      ["add_offset", 0.0, "PSU", "Linear packing additive offset"],
    ],
  },
  {
    name: "elevation",
    aliases: ["surface_altitude", "orog", "z", "bathymetry"],
    label: "Surface Elevation (CF-1.x)",
    category: "CF-1.x Ocean & Surface",
    archetypeId: NetcdfArchetypeId.ELEVATION,
    description:
      "CF-1.x terrain / bathymetric surface elevation above geoid (standard_name='surface_altitude', units='m').",
    provenance: "CF Conventions 1.8 / Unidata NetCDF Classic",
    params: [
      ["standard_name", "surface_altitude", undefined, "CF canonical standard name"],
      ["units", "m", "m", "Vertical height above datum"],
      ["positive", "up", undefined, "Vertical positive direction"],
      ["scale_factor", 1.0, undefined, "Linear packing scale factor"],
      ["add_offset", 0.0, "m", "Linear packing additive offset"],
    ],
  },

  // NetCDF Classic Data Types
  {
    name: "byte",
    aliases: ["NC_BYTE", "int8"],
    label: "NC_BYTE (8-bit Signed)",
    category: "NetCDF Classic Types",
    archetypeId: NetcdfArchetypeId.NC_BYTE,
    description: "NetCDF Classic 8-bit signed two's-complement integer (type code 1, default fill -127).",
    provenance: "Unidata NetCDF Classic v1/v2 Specification (1988)",
    params: [
      ["type_code", 1, undefined, "XDR binary type tag"],
      ["byte_size", 1, "bytes", "Storage width per element"],
      ["default_fill", -127, undefined, "NC_FILL_BYTE"],
    ],
  },
  {
    name: "char",
    aliases: ["NC_CHAR", "ascii"],
    label: "NC_CHAR (8-bit ASCII)",
    category: "NetCDF Classic Types",
    archetypeId: NetcdfArchetypeId.NC_CHAR,
    description: "NetCDF Classic 8-bit ISO/ASCII character array element (type code 2, default fill 0).",
    provenance: "Unidata NetCDF Classic v1/v2 Specification (1988)",
    params: [
      ["type_code", 2, undefined, "XDR binary type tag"],
      ["byte_size", 1, "bytes", "Storage width per character"],
      ["default_fill", 0, undefined, "NC_FILL_CHAR"],
    ],
  },
  {
    name: "short",
    aliases: ["NC_SHORT", "int16"],
    label: "NC_SHORT (16-bit Signed)",
    category: "NetCDF Classic Types",
    archetypeId: NetcdfArchetypeId.NC_SHORT,
    description: "NetCDF Classic 16-bit big-endian signed integer (type code 3, default fill -32767).",
    provenance: "Unidata NetCDF Classic v1/v2 Specification (1988)",
    params: [
      ["type_code", 3, undefined, "XDR binary type tag"],
      ["byte_size", 2, "bytes", "Storage width per element"],
      ["default_fill", -32767, undefined, "NC_FILL_SHORT"],
    ],
  },
  {
    name: "int",
    aliases: ["NC_INT", "long", "int32"],
    label: "NC_INT (32-bit Signed)",
    category: "NetCDF Classic Types",
    archetypeId: NetcdfArchetypeId.NC_INT,
    description:
      "NetCDF Classic 32-bit big-endian signed integer (type code 4, CDL alias 'long', default fill -2147483647).",
    provenance: "Unidata NetCDF Classic v1/v2 Specification (1988)",
    params: [
      ["type_code", 4, undefined, "XDR binary type tag"],
      ["byte_size", 4, "bytes", "Storage width per element"],
      ["default_fill", -2147483647, undefined, "NC_FILL_INT"],
    ],
  },
  {
    name: "float",
    aliases: ["NC_FLOAT", "real", "float32"],
    label: "NC_FLOAT (IEEE-754 32-bit)",
    category: "NetCDF Classic Types",
    archetypeId: NetcdfArchetypeId.NC_FLOAT,
    description: "NetCDF Classic 32-bit big-endian IEEE-754 single-precision float (type code 5).",
    provenance: "Unidata NetCDF Classic v1/v2 Specification (1988)",
    params: [
      ["type_code", 5, undefined, "XDR binary type tag"],
      ["byte_size", 4, "bytes", "Storage width per element"],
      ["default_fill", 9.969209968386869e36, undefined, "NC_FILL_FLOAT"],
    ],
  },
  {
    name: "double",
    aliases: ["NC_DOUBLE", "float64"],
    label: "NC_DOUBLE (IEEE-754 64-bit)",
    category: "NetCDF Classic Types",
    archetypeId: NetcdfArchetypeId.NC_DOUBLE,
    description: "NetCDF Classic 64-bit big-endian IEEE-754 double-precision float (type code 6).",
    provenance: "Unidata NetCDF Classic v1/v2 Specification (1988)",
    params: [
      ["type_code", 6, undefined, "XDR binary type tag"],
      ["byte_size", 8, "bytes", "Storage width per element"],
      ["default_fill", 9.969209968386869e36, undefined, "NC_FILL_DOUBLE"],
    ],
  },
];

/**
 * Builds the declarative `CleanroomModelSchema[]` array for `@modelscript/netcdf-std-lib`.
 */
export function buildNetcdfCleanroomSchemas(): CleanroomModelSchema[] {
  return NETCDF_STD_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: typeof defaultValue === "string" ? "string" : Number.isInteger(defaultValue) ? "integer" : "real",
      defaultValue,
      ...(unit !== undefined ? { unit } : {}),
      ...(description !== undefined ? { description } : {}),
    }));

    return {
      namePath: `NetCDF.${spec.name}`,
      name: spec.name,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "earth-science",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 88,
      height: 52,
      svg: generateNetcdfBlockSvg(spec.name, spec.category),
      ports: defaultPorts(spec.category),
      parameters,
      wasmKernel: "ncEval",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}

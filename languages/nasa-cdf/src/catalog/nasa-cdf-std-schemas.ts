// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nasa-cdf — Cleanroom ISTP/SPDF Standard Attributes & Space-Physics Telemetry Schemas.
 */

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Archetype IDs matching `assets/nasa-cdf-std-lib/src/models.ts`.
 */
export const NasaCdfArchetypeId = {
  PROJECT: 1,
  SOURCE_NAME: 2,
  DISCIPLINE: 3,
  DATA_TYPE: 4,
  DESCRIPTOR: 5,
  DEPEND_0: 10,
  UNITS: 11,
  VALIDMIN: 12,
  VALIDMAX: 13,
  FILLVAL: 14,
  CATDESC: 15,
  FIELDNAM: 16,
  VAR_TYPE: 17,
  EPOCH: 20,
  B_GSE: 21,
  B_GSM: 22,
  B_MAG: 23,
  N_PROTON: 24,
  V_SW: 25,
  T_PROTON: 26,
} as const;

export type NasaCdfArchetypeId = (typeof NasaCdfArchetypeId)[keyof typeof NasaCdfArchetypeId];

export type NasaCdfSchemaCategory = "ISTP Global" | "ISTP Variable" | "Magnetometer" | "Plasma Telemetry";

export interface NasaCdfSchemaSpec {
  name: string;
  aliases?: string[];
  label: string;
  category: NasaCdfSchemaCategory;
  archetypeId: NasaCdfArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<NasaCdfSchemaCategory, { fill: string; stroke: string; badge: string }> = {
  "ISTP Global": { fill: "#1e293b", stroke: "#38bdf8", badge: "GLB" },
  "ISTP Variable": { fill: "#2e1f47", stroke: "#c084fc", badge: "VAR" },
  Magnetometer: { fill: "#17352d", stroke: "#34d399", badge: "MAG" },
  "Plasma Telemetry": { fill: "#3d2614", stroke: "#fbbf24", badge: "PLS" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a NASA CDF / ISTP schema.
 */
export function generateNasaCdfBlockSvg(name: string, category: NasaCdfSchemaCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = name.toUpperCase().slice(0, 10);
  const fontSize = label.length > 8 ? "7.8" : "9.2";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPorts(category: NasaCdfSchemaCategory): DiagramPortSpec[] {
  if (category === "Magnetometer" || category === "Plasma Telemetry") {
    return [
      { name: "epoch_in", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "telemetry_out", kind: "signal", side: "right", dx: 88, dy: 26 },
    ];
  }
  return [
    { name: "meta_in", kind: "signal", side: "left", dx: 0, dy: 26 },
    { name: "meta_out", kind: "signal", side: "right", dx: 88, dy: 26 },
  ];
}

const NASA_CDF_SPECS: NasaCdfSchemaSpec[] = [
  {
    name: "Project",
    aliases: ["PROJECT"],
    label: "Project (ISTP Global)",
    category: "ISTP Global",
    archetypeId: NasaCdfArchetypeId.PROJECT,
    description:
      "Required ISTP global attribute naming the overarching mission or program (e.g. THEMIS, MMS, Parker Solar Probe).",
    provenance: "NASA SPDF ISTP/IACG Metadata Guidelines §2.1",
    params: [["required", 1, "bool", "Mandatory ISTP global attribute"]],
  },
  {
    name: "Source_name",
    aliases: ["SOURCE_NAME"],
    label: "Source_name (ISTP Global)",
    category: "ISTP Global",
    archetypeId: NasaCdfArchetypeId.SOURCE_NAME,
    description: "Required ISTP global attribute identifying the spacecraft or ground observatory.",
    provenance: "NASA SPDF ISTP/IACG Metadata Guidelines §2.1",
    params: [["required", 1, "bool", "Mandatory ISTP global attribute"]],
  },
  {
    name: "Discipline",
    aliases: ["DISCIPLINE"],
    label: "Discipline (ISTP Global)",
    category: "ISTP Global",
    archetypeId: NasaCdfArchetypeId.DISCIPLINE,
    description:
      "Required ISTP global attribute specifying scientific discipline (e.g. 'Space Physics>Magnetospheric Science').",
    provenance: "NASA SPDF ISTP/IACG Metadata Guidelines §2.1",
    params: [["required", 1, "bool", "Mandatory ISTP global attribute"]],
  },
  {
    name: "Data_type",
    aliases: ["DATA_TYPE"],
    label: "Data_type (ISTP Global)",
    category: "ISTP Global",
    archetypeId: NasaCdfArchetypeId.DATA_TYPE,
    description:
      "Required ISTP global attribute classifying product level (e.g. 'L2>Level 2 Science Data', 'K0>Key Parameter').",
    provenance: "NASA SPDF ISTP/IACG Metadata Guidelines §2.1",
    params: [["level", 2, "level", "Science data processing level"]],
  },
  {
    name: "Descriptor",
    aliases: ["DESCRIPTOR"],
    label: "Descriptor (ISTP Global)",
    category: "ISTP Global",
    archetypeId: NasaCdfArchetypeId.DESCRIPTOR,
    description: "Required ISTP global attribute naming the instrument (e.g. 'FGM>Fluxgate Magnetometer').",
    provenance: "NASA SPDF ISTP/IACG Metadata Guidelines §2.1",
    params: [["required", 1, "bool", "Mandatory ISTP global attribute"]],
  },
  {
    name: "DEPEND_0",
    label: "DEPEND_0 (Time Dependency)",
    category: "ISTP Variable",
    archetypeId: NasaCdfArchetypeId.DEPEND_0,
    description:
      "Required ISTP variable attribute linking a record-varying science channel to its Epoch/TT2000 time variable.",
    provenance: "NASA SPDF ISTP/IACG Metadata Guidelines §3.1",
    params: [["axis", 0, "index", "Record (time) axis index"]],
  },
  {
    name: "UNITS",
    label: "UNITS (Physical Units)",
    category: "ISTP Variable",
    archetypeId: NasaCdfArchetypeId.UNITS,
    description:
      "Required ISTP variable attribute giving SI or space-physics units (e.g. 'nT', 'cm^-3', 'km/s', 'eV').",
    provenance: "NASA SPDF ISTP/IACG Metadata Guidelines §3.1",
    params: [["required", 1, "bool", "Mandatory for physical channels"]],
  },
  {
    name: "VALIDMIN",
    label: "VALIDMIN (Lower Valid Bound)",
    category: "ISTP Variable",
    archetypeId: NasaCdfArchetypeId.VALIDMIN,
    description: "Required ISTP variable attribute defining the minimum physically valid value.",
    provenance: "NASA SPDF ISTP/IACG Metadata Guidelines §3.1",
    params: [["minVal", -65536.0, "nT", "Default lower physical bound"]],
  },
  {
    name: "VALIDMAX",
    label: "VALIDMAX (Upper Valid Bound)",
    category: "ISTP Variable",
    archetypeId: NasaCdfArchetypeId.VALIDMAX,
    description: "Required ISTP variable attribute defining the maximum physically valid value.",
    provenance: "NASA SPDF ISTP/IACG Metadata Guidelines §3.1",
    params: [["maxVal", 65536.0, "nT", "Default upper physical bound"]],
  },
  {
    name: "FILLVAL",
    label: "FILLVAL (Missing Data Sentinel)",
    category: "ISTP Variable",
    archetypeId: NasaCdfArchetypeId.FILLVAL,
    description:
      "ISTP sentinel value indicating missing or invalid telemetry samples (commonly -1.0e31 for CDF_REAL4).",
    provenance: "NASA SPDF ISTP/IACG Metadata Guidelines §3.1",
    params: [["fillVal", -1.0e31, "sentinel", "Standard ISTP float32 fill value"]],
  },
  {
    name: "CATDESC",
    label: "CATDESC (Catalog Description)",
    category: "ISTP Variable",
    archetypeId: NasaCdfArchetypeId.CATDESC,
    description: "Human-readable catalog description of a CDF variable for SPDF CDAWeb.",
    provenance: "NASA SPDF ISTP/IACG Metadata Guidelines §3.1",
    params: [["required", 1, "bool", "Catalog description"]],
  },
  {
    name: "FIELDNAM",
    label: "FIELDNAM (Short Field Name)",
    category: "ISTP Variable",
    archetypeId: NasaCdfArchetypeId.FIELDNAM,
    description: "Short display label for plotting and tabular exports.",
    provenance: "NASA SPDF ISTP/IACG Metadata Guidelines §3.1",
    params: [["maxChars", 30, "chars", "Recommended maximum label length"]],
  },
  {
    name: "VAR_TYPE",
    label: "VAR_TYPE (ISTP Variable Role)",
    category: "ISTP Variable",
    archetypeId: NasaCdfArchetypeId.VAR_TYPE,
    description: "Classifies a variable as 'data', 'support_data', 'metadata', or 'ignore_data'.",
    provenance: "NASA SPDF ISTP/IACG Metadata Guidelines §3.1",
    params: [["roleCode", 1, "enum", "1=data, 2=support_data, 3=metadata"]],
  },
  {
    name: "EPOCH",
    aliases: ["Epoch", "CDF_EPOCH", "CDF_TIME_TT2000"],
    label: "EPOCH (Spacecraft Time Tag)",
    category: "Magnetometer",
    archetypeId: NasaCdfArchetypeId.EPOCH,
    description:
      "Monotonically increasing spacecraft observation timestamps in CDF_EPOCH (ms since 0000-01-01) or CDF_TIME_TT2000.",
    provenance: "NASA SPDF CDF User's Guide §2.5",
    params: [
      ["cadenceSec", 1.0, "s", "Nominal telemetry sampling cadence"],
      ["j2000EpochMs", 63113947200000.0, "ms", "CDF_EPOCH milliseconds at J2000.0 UTC"],
    ],
  },
  {
    name: "B_GSE",
    aliases: ["BGSE", "BGSEc"],
    label: "B_GSE (3-Axis Magnetometer GSE)",
    category: "Magnetometer",
    archetypeId: NasaCdfArchetypeId.B_GSE,
    description: "3-component magnetic field vector [Bx, By, Bz] in Geocentric Solar Ecliptic (GSE) coordinates (nT).",
    provenance: "NASA SPDF ISTP Magnetometer Schema",
    params: [
      ["bx", 3.0, "nT", "GSE X component (Sunward)"],
      ["by", 4.0, "nT", "GSE Y component (Duskward)"],
      ["bz", 0.0, "nT", "GSE Z component (Ecliptic North)"],
    ],
  },
  {
    name: "B_GSM",
    aliases: ["BGSM"],
    label: "B_GSM (3-Axis Magnetometer GSM)",
    category: "Magnetometer",
    archetypeId: NasaCdfArchetypeId.B_GSM,
    description:
      "3-component magnetic field vector [Bx, By, Bz] in Geocentric Solar Magnetospheric (GSM) coordinates (nT).",
    provenance: "NASA SPDF ISTP Magnetometer Schema",
    params: [
      ["bx", 2.5, "nT", "GSM X component"],
      ["by", -3.0, "nT", "GSM Y component"],
      ["bz", -2.0, "nT", "GSM Z component (Southward IMF drives reconnection)"],
    ],
  },
  {
    name: "B_MAG",
    aliases: ["BTOTAL", "B_TOTAL"],
    label: "B_MAG (Magnetic Field Magnitude)",
    category: "Magnetometer",
    archetypeId: NasaCdfArchetypeId.B_MAG,
    description: "Scalar magnetic field magnitude |B| = sqrt(Bx^2 + By^2 + Bz^2) in nT.",
    provenance: "NASA SPDF ISTP Magnetometer Schema",
    params: [["bMag", 5.0, "nT", "Nominal interplanetary magnetic field magnitude"]],
  },
  {
    name: "N_PROTON",
    aliases: ["Np", "DENSITY"],
    label: "N_PROTON (Solar Wind Proton Density)",
    category: "Plasma Telemetry",
    archetypeId: NasaCdfArchetypeId.N_PROTON,
    description: "Solar wind proton number density in cm^-3 (1 cm^-3 = 1e6 m^-3).",
    provenance: "NASA SPDF ISTP Plasma Telemetry Schema",
    params: [["densityCm3", 5.0, "cm^-3", "Nominal 1 AU solar wind proton density"]],
  },
  {
    name: "V_SW",
    aliases: ["V_GSE", "BULK_SPEED"],
    label: "V_SW (Solar Wind Bulk Velocity)",
    category: "Plasma Telemetry",
    archetypeId: NasaCdfArchetypeId.V_SW,
    description: "Solar wind proton bulk flow speed in km/s.",
    provenance: "NASA SPDF ISTP Plasma Telemetry Schema",
    params: [["speedKmS", 400.0, "km/s", "Nominal 1 AU solar wind bulk speed"]],
  },
  {
    name: "T_PROTON",
    aliases: ["Tp", "TEMP_P"],
    label: "T_PROTON (Proton Kinetic Temperature)",
    category: "Plasma Telemetry",
    archetypeId: NasaCdfArchetypeId.T_PROTON,
    description: "Solar wind proton kinetic temperature in Kelvin.",
    provenance: "NASA SPDF ISTP Plasma Telemetry Schema",
    params: [["tempK", 1.0e5, "K", "Nominal 1 AU solar wind proton temperature"]],
  },
];

/**
 * Builds the complete list of cleanroom NASA CDF / ISTP standard library schemas.
 */
export function buildNasaCdfCleanroomSchemas(): CleanroomModelSchema[] {
  return NASA_CDF_SPECS.map((spec): CleanroomModelSchema => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      ...(unit !== undefined ? { unit } : {}),
      ...(description !== undefined ? { description } : {}),
    }));

    return {
      namePath: `NASA_CDF.${spec.category.replace(/\s+/g, "_")}.${spec.name}`,
      name: spec.name,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "space-physics",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "cdf_schema",
      width: 88,
      height: 52,
      svg: generateNasaCdfBlockSvg(spec.name, spec.category),
      ports: defaultPorts(spec.category),
      parameters,
      wasmKernel: "cdfEval",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}

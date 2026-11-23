// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * HDF4 cleanroom object & NASA EOS-HDF archetype IDs matching `assets/hdf4-std-lib/src/models.ts`.
 */
export const Hdf4ArchetypeId = {
  // Core HDF4 Object Tags
  SDS: 1,
  VGROUP: 2,
  VDATA: 3,
  RASTER8: 4,
  PALETTE: 5,
  NDG: 6,
  // NASA EOS-HDF Swath / Grid / Point Archetypes
  EOS_SWATH: 10,
  EOS_GRID: 11,
  EOS_POINT: 12,
  MODIS_L1B: 13,
  AIRS_L2: 14,
  LANDSAT_TM: 15,
} as const;

export type Hdf4ArchetypeId = (typeof Hdf4ArchetypeId)[keyof typeof Hdf4ArchetypeId];

export type Hdf4ModelCategory = "HDF4 Core Objects" | "NASA EOS-HDF Archetypes";

export interface Hdf4ModelSpec {
  modelType: string;
  aliases?: string[] | undefined;
  label: string;
  category: Hdf4ModelCategory;
  archetypeId: Hdf4ArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<Hdf4ModelCategory, { fill: string; stroke: string; badge: string }> = {
  "HDF4 Core Objects": { fill: "#1e3a5f", stroke: "#38bdf8", badge: "HDF4" },
  "NASA EOS-HDF Archetypes": { fill: "#1e3f2f", stroke: "#34d399", badge: "EOS" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for an HDF4 / EOS-HDF archetype.
 */
export function generateHdf4BlockSvg(modelType: string, category: Hdf4ModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 10);
  const fontSize = label.length > 8 ? "8.2" : "9.5";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">`,
    `  <rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.6"/>`,
    `  <rect x="6" y="6" width="30" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>`,
    `  <text x="21" y="14.5" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}" font-weight="700">${c.badge}</text>`,
    `  <text x="44" y="34" text-anchor="middle" font-family="monospace" font-size="${fontSize}" fill="#f8fafc" font-weight="700">${label}</text>`,
    `</svg>`,
  ].join("\n");
}

export const HDF4_MODEL_SPECS: Hdf4ModelSpec[] = [
  {
    modelType: "SDS",
    aliases: ["DFTAG_SD", "SCIENTIFIC_DATA_SET"],
    label: "Scientific Data Set (SDS)",
    category: "HDF4 Core Objects",
    archetypeId: Hdf4ArchetypeId.SDS,
    description:
      "N-dimensional typed scientific array with dimension scales, calibration, and attributes (DFTAG_SD=702).",
    provenance: "NCSA HDF4 Specification v4.2 (1987)",
    params: [
      ["tag", 702, "", "DFTAG_SD primary data tag"],
      ["dataType", 5, "", "DFNT_FLOAT32 (5) or DFNT_FLOAT64 (6)"],
      ["rank", 2, "", "Number of array dimensions"],
      ["scaleFactor", 1.0, "", "Linear calibration gain"],
      ["addOffset", 0.0, "", "Linear calibration offset"],
    ],
  },
  {
    modelType: "Vgroup",
    aliases: ["DFTAG_VG", "VGROUP"],
    label: "Vgroup Container",
    category: "HDF4 Core Objects",
    archetypeId: Hdf4ArchetypeId.VGROUP,
    description:
      "Hierarchical grouping container linking tag/ref pairs of SDS, Vdata, Raster8, and nested Vgroups (DFTAG_VG=1965).",
    provenance: "NCSA HDF4 Specification v4.2 (1987)",
    params: [
      ["tag", 1965, "", "DFTAG_VG descriptor tag"],
      ["maxMembers", 256, "", "Recommended member capacity"],
    ],
  },
  {
    modelType: "Vdata",
    aliases: ["DFTAG_VH", "DFTAG_VS", "VDATA"],
    label: "Vdata Table",
    category: "HDF4 Core Objects",
    archetypeId: Hdf4ArchetypeId.VDATA,
    description:
      "Heterogeneous multi-field record table stored as DFTAG_VH (1962) header + DFTAG_VS (1963) record payload.",
    provenance: "NCSA HDF4 Specification v4.2 (1987)",
    params: [
      ["headerTag", 1962, "", "DFTAG_VH header tag"],
      ["dataTag", 1963, "", "DFTAG_VS data tag"],
      ["interlace", 0, "", "0=FULL_INTERLACE, 1=NO_INTERLACE"],
    ],
  },
  {
    modelType: "Raster8",
    aliases: ["DFTAG_RI8", "RASTER8", "DFR8"],
    label: "8-Bit Raster Image",
    category: "HDF4 Core Objects",
    archetypeId: Hdf4ArchetypeId.RASTER8,
    description: "Indexed 8-bit raster image with DFTAG_ID8 (200) dimensions and DFTAG_RI8 (202) pixel array.",
    provenance: "NCSA HDF4 Specification v4.2 (1987)",
    params: [
      ["dimTag", 200, "", "DFTAG_ID8 dimension tag"],
      ["dataTag", 202, "", "DFTAG_RI8 pixel tag"],
      ["width", 256, "px", "Image width in pixels"],
      ["height", 256, "px", "Image height in pixels"],
    ],
  },
  {
    modelType: "Palette",
    aliases: ["DFTAG_IP8", "PALETTE", "DFP"],
    label: "8-Bit RGB Color Palette",
    category: "HDF4 Core Objects",
    archetypeId: Hdf4ArchetypeId.PALETTE,
    description: "256-entry RGB lookup table (768 bytes) stored under DFTAG_IP8 (201).",
    provenance: "NCSA HDF4 Specification v4.2 (1987)",
    params: [
      ["tag", 201, "", "DFTAG_IP8 palette tag"],
      ["entries", 768, "bytes", "256 RGB triplets (768 bytes)"],
    ],
  },
  {
    modelType: "NDG",
    aliases: ["DFTAG_NDG", "NUMERIC_DATA_GROUP"],
    label: "Numeric Data Group (NDG)",
    category: "HDF4 Core Objects",
    archetypeId: Hdf4ArchetypeId.NDG,
    description:
      "Composite group linking DFTAG_SDD, DFTAG_SD, DFTAG_NT, DFTAG_SDL, and DFTAG_SDU into an SDS (DFTAG_NDG=720).",
    provenance: "NCSA HDF4 Specification v4.2 (1987)",
    params: [
      ["tag", 720, "", "DFTAG_NDG group tag"],
      ["sddTag", 701, "", "DFTAG_SDD dimension record tag"],
      ["sdTag", 702, "", "DFTAG_SD numeric payload tag"],
    ],
  },
  {
    modelType: "EOS_SWATH",
    aliases: ["SWATH", "HDF_EOS_SWATH"],
    label: "NASA HDF-EOS Swath",
    category: "NASA EOS-HDF Archetypes",
    archetypeId: Hdf4ArchetypeId.EOS_SWATH,
    description: "Orbital cross-track/along-track satellite swath pairing Geolocation Fields with Data Fields.",
    provenance: "NASA HDF-EOS2 Specification (1995)",
    params: [
      ["alongTrack", 2030, "px", "Along-track scan lines"],
      ["crossTrack", 1354, "px", "Cross-track pixels per scan"],
      ["geoStride", 5, "", "Geolocation decimation factor"],
    ],
  },
  {
    modelType: "EOS_GRID",
    aliases: ["GRID", "HDF_EOS_GRID"],
    label: "NASA HDF-EOS Grid",
    category: "NASA EOS-HDF Archetypes",
    archetypeId: Hdf4ArchetypeId.EOS_GRID,
    description: "Map-projected rectilinear Earth observation grid (Sinusoidal, Geographic, Polar Stereographic).",
    provenance: "NASA HDF-EOS2 Specification (1995)",
    params: [
      ["xDim", 1200, "px", "Grid columns"],
      ["yDim", 1200, "px", "Grid rows"],
      ["projectionCode", 16, "", "GCTP projection code (16=Sinusoidal)"],
    ],
  },
  {
    modelType: "EOS_POINT",
    aliases: ["POINT", "HDF_EOS_POINT"],
    label: "NASA HDF-EOS Point",
    category: "NASA EOS-HDF Archetypes",
    archetypeId: Hdf4ArchetypeId.EOS_POINT,
    description: "Multi-level Vdata point observation structure for in-situ atmospheric and oceanographic profiles.",
    provenance: "NASA HDF-EOS2 Specification (1995)",
    params: [
      ["levels", 2, "", "Relational Vdata hierarchy depth"],
      ["recordCount", 1000, "", "Observation point records"],
    ],
  },
  {
    modelType: "MODIS_L1B",
    aliases: ["MOD021KM", "MYD021KM"],
    label: "MODIS Level-1B Calibrated Radiance",
    category: "NASA EOS-HDF Archetypes",
    archetypeId: Hdf4ArchetypeId.MODIS_L1B,
    description: "Terra/Aqua MODIS 1 km calibrated radiances & reflectances with EV_1KM_RefSB and EV_1KM_Emissive SDS.",
    provenance: "NASA LP DAAC MODIS Level-1B Product User Guide",
    params: [
      ["bands", 15, "", "Reflective/emissive spectral bands"],
      ["radianceScale", 0.005, "W/(m2.sr.um)", "Calibration slope"],
      ["radianceOffset", 0.0, "W/(m2.sr.um)", "Calibration offset"],
    ],
  },
  {
    modelType: "AIRS_L2",
    aliases: ["AIRX2RET"],
    label: "AIRS Level-2 Atmospheric Retrieval",
    category: "NASA EOS-HDF Archetypes",
    archetypeId: Hdf4ArchetypeId.AIRS_L2,
    description:
      "Aqua AIRS atmospheric temperature & water vapor vertical profile swath (28 standard pressure levels).",
    provenance: "NASA GES DISC AIRS Version 6 User Guide",
    params: [
      ["pressureLevels", 28, "", "Standard atmospheric pressure levels"],
      ["scanLines", 45, "", "Granule along-track FOV lines"],
      ["xTrack", 30, "", "Granule cross-track FOV pixels"],
    ],
  },
  {
    modelType: "LANDSAT_TM",
    aliases: ["LANDSAT_ETM"],
    label: "Landsat TM/ETM+ Multispectral Scene",
    category: "NASA EOS-HDF Archetypes",
    archetypeId: Hdf4ArchetypeId.LANDSAT_TM,
    description: "30 m multispectral Earth imaging grid with calibrated reflectance bands and thermal IR channel.",
    provenance: "USGS / NASA Landsat Data Continuity Archive",
    params: [
      ["bands", 7, "", "Spectral channels"],
      ["gsdMeters", 30.0, "m", "Ground sample distance"],
      ["solarZenithDeg", 35.0, "deg", "Scene center solar zenith angle"],
    ],
  },
];

const DEFAULT_PORTS: DiagramPortSpec[] = [
  { name: "in", kind: "data", side: "left", dx: 0, dy: 26 },
  { name: "out", kind: "data", side: "right", dx: 88, dy: 26 },
];

/**
 * Builds `CleanroomModelSchema[]` for `@modelscript/hdf4-std-lib`.
 */
export function buildHdf4CleanroomSchemas(): CleanroomModelSchema[] {
  return HDF4_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit: unit || undefined,
      description: description || undefined,
    }));

    return {
      namePath: `HDF4.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "scientific-data",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 88,
      height: 52,
      svg: generateHdf4BlockSvg(spec.modelType, spec.category),
      ports: DEFAULT_PORTS,
      parameters,
      wasmKernel: "hdf4ModelEval",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}

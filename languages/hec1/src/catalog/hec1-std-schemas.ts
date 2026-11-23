// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom Standard Library Schemas for USACE HEC-1 (`@modelscript/hec1-std-lib`).
 *
 * Includes:
 *   - USDA NRCS TR-55 SCS Curve Number tables (Hydrologic Soil Groups A, B, C, D)
 *   - Clark (`UC`), SCS Dimensionless (`UD`), and Snyder (`US`) Unit Hydrograph archetypes
 *   - Muskingum (`RM`), Storage Routing (`RS`), and Hydrograph Combine (`HC`) blocks
 */

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

export type HydrologicSoilGroup = "A" | "B" | "C" | "D";

export const Hec1ArchetypeId = {
  SCS_CN_TABLE: 1,
  CLARK_UH: 10,
  SCS_UH: 11,
  SNYDER_UH: 12,
  MUSKINGUM_ROUTE: 20,
  STORAGE_ROUTE: 21,
  HYDROGRAPH_COMBINE: 30,
} as const;

export type Hec1ArchetypeId = (typeof Hec1ArchetypeId)[keyof typeof Hec1ArchetypeId];

export type Hec1ModelCategory = "SCS Curve Number (TR-55)" | "Unit Hydrograph" | "Channel Routing" | "Network Combine";

export interface Tr55LandCoverEntry {
  code: string;
  label: string;
  imperviousPct: number;
  cn: Record<HydrologicSoilGroup, number>;
}

/**
 * Public-domain USDA NRCS Technical Release 55 (TR-55, Table 2-2a/b/c) Curve Number table.
 */
export const TR55_CURVE_NUMBER_TABLE: readonly Tr55LandCoverEntry[] = [
  {
    code: "SCS_CN_URBAN_COMMERCIAL",
    label: "Urban Commercial & Business",
    imperviousPct: 85,
    cn: { A: 89, B: 92, C: 94, D: 95 },
  },
  {
    code: "SCS_CN_URBAN_INDUSTRIAL",
    label: "Urban Industrial District",
    imperviousPct: 72,
    cn: { A: 81, B: 88, C: 91, D: 93 },
  },
  {
    code: "SCS_CN_RESIDENTIAL_QUARTER_ACRE",
    label: "Residential (1/4 acre lots)",
    imperviousPct: 38,
    cn: { A: 61, B: 75, C: 83, D: 87 },
  },
  {
    code: "SCS_CN_RESIDENTIAL_ONE_ACRE",
    label: "Residential (1 acre lots)",
    imperviousPct: 20,
    cn: { A: 51, B: 68, C: 79, D: 84 },
  },
  {
    code: "SCS_CN_PAVED_IMPERVIOUS",
    label: "Paved Parking, Roofs & Streets",
    imperviousPct: 98,
    cn: { A: 98, B: 98, C: 98, D: 98 },
  },
  {
    code: "SCS_CN_OPEN_SPACE_GOOD",
    label: "Open Space / Lawns (Good, >75% grass)",
    imperviousPct: 0,
    cn: { A: 39, B: 61, C: 74, D: 80 },
  },
  {
    code: "SCS_CN_PASTURE_GOOD",
    label: "Pasture / Grassland (Good condition)",
    imperviousPct: 0,
    cn: { A: 39, B: 61, C: 74, D: 80 },
  },
  {
    code: "SCS_CN_ROW_CROPS_GOOD",
    label: "Cultivated Row Crops (Straight Row, Good)",
    imperviousPct: 0,
    cn: { A: 67, B: 78, C: 85, D: 89 },
  },
  {
    code: "SCS_CN_WOODS_GOOD",
    label: "Woods / Forest (Good hydrologic condition)",
    imperviousPct: 0,
    cn: { A: 30, B: 55, C: 70, D: 77 },
  },
];

/**
 * Looks up a USDA TR-55 SCS Curve Number by land-cover code (or substring) and Hydrologic Soil Group (A–D).
 */
export function lookupTr55CurveNumber(landCoverCode: string, soilGroup: HydrologicSoilGroup): number | undefined {
  const key = landCoverCode.trim().toUpperCase();
  const entry = TR55_CURVE_NUMBER_TABLE.find((e) => e.code === key || e.label.toUpperCase().includes(key));
  return entry?.cn[soilGroup];
}

export interface Hec1ModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: Hec1ModelCategory;
  archetypeId: Hec1ArchetypeId;
  description: string;
  provenance: string;
  wasmKernel: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<Hec1ModelCategory, { fill: string; stroke: string; badge: string }> = {
  "SCS Curve Number (TR-55)": { fill: "#1e3a5f", stroke: "#38bdf8", badge: "LS" },
  "Unit Hydrograph": { fill: "#163b3b", stroke: "#2dd4bf", badge: "UH" },
  "Channel Routing": { fill: "#2e2447", stroke: "#a78bfa", badge: "RM" },
  "Network Combine": { fill: "#3b2f16", stroke: "#fbbf24", badge: "HC" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a HEC-1 hydrologic element.
 */
export function generateHec1BlockSvg(modelType: string, category: Hec1ModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType
    .replace(/^SCS_CN_/, "")
    .toUpperCase()
    .slice(0, 10);
  const fontSize = label.length > 8 ? "8.0" : "9.5";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="24" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="18" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: Hec1ModelSpec): DiagramPortSpec[] {
  switch (spec.category) {
    case "SCS Curve Number (TR-55)":
      return [
        { name: "precip_in", kind: "signal", side: "top", dx: 44, dy: 0 },
        { name: "excess_out", kind: "fluid", side: "right", dx: 88, dy: 26 },
      ];
    case "Unit Hydrograph":
      return [
        { name: "excess_in", kind: "fluid", side: "left", dx: 0, dy: 26 },
        { name: "runoff_out", kind: "fluid", side: "right", dx: 88, dy: 26 },
      ];
    case "Channel Routing":
      return [
        { name: "inflow", kind: "fluid", side: "left", dx: 0, dy: 26 },
        { name: "outflow", kind: "fluid", side: "right", dx: 88, dy: 26 },
      ];
    case "Network Combine":
      return [
        { name: "inflow_1", kind: "fluid", side: "left", dx: 0, dy: 16 },
        { name: "inflow_2", kind: "fluid", side: "left", dx: 0, dy: 36 },
        { name: "combined_out", kind: "fluid", side: "right", dx: 88, dy: 26 },
      ];
  }
}

export const HEC1_MODEL_SPECS: readonly Hec1ModelSpec[] = [
  ...TR55_CURVE_NUMBER_TABLE.map((entry): Hec1ModelSpec => ({
    modelType: entry.code,
    aliases: [entry.label.toLowerCase()],
    label: entry.label,
    category: "SCS Curve Number (TR-55)",
    archetypeId: Hec1ArchetypeId.SCS_CN_TABLE,
    description: `USDA NRCS TR-55 SCS Curve Number table for ${entry.label} across Hydrologic Soil Groups A (${entry.cn.A}), B (${entry.cn.B}), C (${entry.cn.C}), and D (${entry.cn.D}).`,
    provenance: "USDA NRCS Technical Release 55 (TR-55, Table 2-2) / USACE HEC-1 (1968) LS Card",
    wasmKernel: "scsExcessRunoff",
    params: [
      ["CN_A", entry.cn.A, "-", "Curve Number for Hydrologic Soil Group A (sand/loamy sand)"],
      ["CN_B", entry.cn.B, "-", "Curve Number for Hydrologic Soil Group B (silt loam/loam)"],
      ["CN_C", entry.cn.C, "-", "Curve Number for Hydrologic Soil Group C (sandy clay loam)"],
      ["CN_D", entry.cn.D, "-", "Curve Number for Hydrologic Soil Group D (clay/impervious)"],
      ["RTIMP", entry.imperviousPct, "%", "Typical directly connected impervious area percentage"],
    ],
  })),
  {
    modelType: "CLARK_UH",
    aliases: ["UC", "CLARK", "CLARK_UNIT_HYDROGRAPH"],
    label: "Clark Unit Hydrograph (UC)",
    category: "Unit Hydrograph",
    archetypeId: Hec1ArchetypeId.CLARK_UH,
    description:
      "USACE HEC-1 Clark synthetic time-area translation and linear-reservoir attenuation unit hydrograph (UC card).",
    provenance: "Clark (1945) / USACE HEC-1 Flood Hydrograph Package (1968) UC Card",
    wasmKernel: "clarkReservoirStep",
    params: [
      ["TC", 2.0, "hr", "Watershed time of concentration"],
      ["R", 1.5, "hr", "Linear reservoir storage attenuation coefficient"],
      ["AREA", 10.0, "mi^2", "Subbasin drainage area (BA card)"],
    ],
  },
  {
    modelType: "SCS_UH",
    aliases: ["UD", "SCS_DIMENSIONLESS_UH"],
    label: "SCS Dimensionless Unit Hydrograph (UD)",
    category: "Unit Hydrograph",
    archetypeId: Hec1ArchetypeId.SCS_UH,
    description: "USDA SCS dimensionless unit hydrograph parameterized by watershed lag time TLAG (UD card).",
    provenance: "USDA SCS NEH-4 / USACE HEC-1 (1968) UD Card",
    wasmKernel: "scsExcessRunoff",
    params: [
      ["TLAG", 1.2, "hr", "Watershed lag time from centroid of rainfall excess to peak"],
      ["PRF", 484.0, "-", "SCS peak rate factor (484 standard)"],
      ["AREA", 10.0, "mi^2", "Subbasin drainage area (BA card)"],
    ],
  },
  {
    modelType: "SNYDER_UH",
    aliases: ["US", "SNYDER", "SNYDER_UNIT_HYDROGRAPH"],
    label: "Snyder Synthetic Unit Hydrograph (US)",
    category: "Unit Hydrograph",
    archetypeId: Hec1ArchetypeId.SNYDER_UH,
    description:
      "Snyder synthetic unit hydrograph parameterized by standard lag TP and peaking coefficient CP (US card).",
    provenance: "Snyder (1938) / USACE HEC-1 (1968) US Card",
    wasmKernel: "snyderPeakDischarge",
    params: [
      ["TP", 2.5, "hr", "Snyder standard basin lag time"],
      ["CP", 0.65, "-", "Snyder peaking coefficient (0.4 - 0.8)"],
      ["AREA", 10.0, "mi^2", "Subbasin drainage area (BA card)"],
    ],
  },
  {
    modelType: "MUSKINGUM_ROUTE",
    aliases: ["RM", "MUSKINGUM"],
    label: "Muskingum Channel Routing (RM)",
    category: "Channel Routing",
    archetypeId: Hec1ArchetypeId.MUSKINGUM_ROUTE,
    description:
      "Multi-subreach Muskingum linear storage-wedge channel routing (RM card) with exact mass conservation.",
    provenance: "McCarthy (1938) / USACE HEC-1 (1968) RM Card",
    wasmKernel: "muskingumStep",
    params: [
      ["NSTPS", 3, "-", "Number of routing subreaches"],
      ["AMSKK", 2.0, "hr", "Total Muskingum travel time K"],
      ["X", 0.2, "-", "Muskingum weighting factor (0 <= X <= 0.5)"],
    ],
  },
  {
    modelType: "STORAGE_ROUTE",
    aliases: ["RS", "MODIFIED_PULS"],
    label: "Modified Puls Storage Routing (RS)",
    category: "Channel Routing",
    archetypeId: Hec1ArchetypeId.STORAGE_ROUTE,
    description: "Level-pool / Modified Puls storage-indication routing block (RS card).",
    provenance: "USACE HEC-1 Flood Hydrograph Package (1968) RS Card",
    wasmKernel: "muskingumStep",
    params: [
      ["NSTPS", 1, "-", "Number of routing steps"],
      ["RSVRIC", 0.0, "cfs", "Initial outflow / storage indicator"],
      ["X", 0.0, "-", "Routing weighting factor (0 for level-pool)"],
    ],
  },
  {
    modelType: "HYDROGRAPH_COMBINE",
    aliases: ["HC", "COMBINE", "JUNCTION"],
    label: "Hydrograph Combine Junction (HC)",
    category: "Network Combine",
    archetypeId: Hec1ArchetypeId.HYDROGRAPH_COMBINE,
    description: "Combines ICOMP >= 2 upstream hydrographs by ordinate summation (HC card).",
    provenance: "USACE HEC-1 Flood Hydrograph Package (1968) HC Card",
    wasmKernel: "muskingumStep",
    params: [["ICOMP", 2, "-", "Number of upstream hydrographs to combine (>= 2)"]],
  },
];

/**
 * Builds the `CleanroomModelSchema[]` array consumed by `cleanroomSchemasToLibraryPayloads`.
 */
export function buildHec1CleanroomSchemas(): CleanroomModelSchema[] {
  return HEC1_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real" as const,
      defaultValue,
      unit,
      description,
    }));

    return {
      namePath: `HEC1.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "hydrology",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 88,
      height: 52,
      svg: generateHec1BlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: spec.wasmKernel,
      extra: { archetypeId: spec.archetypeId },
    };
  });
}

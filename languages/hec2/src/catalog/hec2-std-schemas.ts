// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom HEC-2 hydraulic archetype IDs matching `assets/hec2-std-lib/src/models.ts`.
 */
export const Hec2ArchetypeId = {
  // Manning Roughness — Concrete & Lined Channels
  CONCRETE_TROWELED: 1,
  CONCRETE_FLOAT_FINISHED: 2,
  CONCRETE_UNFINISHED: 3,
  CONCRETE_SHOTCRETE: 4,
  // Manning Roughness — Excavated Earth Channels
  EARTH_CLEAN_STRAIGHT: 10,
  EARTH_GRAVEL_UNIFORM: 11,
  EARTH_SHORT_GRASS_WEEDS: 12,
  EARTH_DENSE_WEEDS: 13,
  // Manning Roughness — Natural Streams
  STREAM_CLEAN_STRAIGHT: 20,
  STREAM_WINDING_POOLS: 21,
  STREAM_SLUGGISH_WEEDY: 22,
  STREAM_MOUNTAIN_COBBLES: 23,
  // Manning Roughness — Floodplains & Overbanks
  FLOODPLAIN_PASTURE_SHORT: 30,
  FLOODPLAIN_CULTIVATED_CROPS: 31,
  FLOODPLAIN_SCATTERED_BRUSH: 32,
  FLOODPLAIN_HEAVY_TIMBER: 33,
  // Bridge & Culvert Contraction / Expansion Losses
  TRANSITION_GRADUAL: 40,
  BRIDGE_TYPICAL: 41,
  TRANSITION_ABRUPT: 42,
  CULVERT_BOX_WINGWALL: 43,
  CULVERT_PIPE_PROJECTING: 44,
} as const;

export type Hec2ArchetypeId = (typeof Hec2ArchetypeId)[keyof typeof Hec2ArchetypeId];

export type Hec2SchemaCategory =
  "Concrete Channels" | "Earth Channels" | "Natural Streams" | "Floodplains" | "Bridge & Culvert Losses";

export interface Hec2StdSchemaSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: Hec2SchemaCategory;
  archetypeId: Hec2ArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_STYLE: Record<Hec2SchemaCategory, { fill: string; stroke: string; badge: string }> = {
  "Concrete Channels": { fill: "#1e293b", stroke: "#94a3b8", badge: "CONC" },
  "Earth Channels": { fill: "#3b2f1e", stroke: "#d97706", badge: "ERTH" },
  "Natural Streams": { fill: "#0f3443", stroke: "#38bdf8", badge: "STRM" },
  Floodplains: { fill: "#1b3b2b", stroke: "#4ade80", badge: "FLDP" },
  "Bridge & Culvert Losses": { fill: "#3b1e2e", stroke: "#f472b6", badge: "LOSS" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a HEC-2 hydraulic schema.
 */
export function generateHec2BlockSvg(modelType: string, category: Hec2SchemaCategory): string {
  const c = CATEGORY_STYLE[category];
  const label = modelType.replace(/_/g, " ").slice(0, 12);
  const fontSize = label.length > 9 ? "7.5" : "8.8";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 52" width="96" height="52">` +
    `<rect x="2" y="2" width="92" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="30" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="21" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

const STANDARD_HYDRAULIC_PORTS: DiagramPortSpec[] = [
  { name: "upstream", kind: "hydraulic", side: "left", dx: 0, dy: 26 },
  { name: "downstream", kind: "hydraulic", side: "right", dx: 96, dy: 26 },
];

/**
 * Cleanroom Chow (1959) Open-Channel Hydraulics & USACE HEC-2 / EM 1110-2-1416
 * Manning's n roughness and bridge/culvert contraction-expansion loss schemas.
 */
export const HEC2_STD_SPECS: Hec2StdSchemaSpec[] = [
  // Concrete Channels
  {
    modelType: "CONCRETE_TROWELED",
    aliases: ["concrete_smooth", "troweled_concrete"],
    label: "Troweled Concrete Channel",
    category: "Concrete Channels",
    archetypeId: Hec2ArchetypeId.CONCRETE_TROWELED,
    description: "Smooth troweled-finish concrete open channel (Chow Table 5-6).",
    provenance: "Chow (1959) Open-Channel Hydraulics Table 5-6; USACE HEC-2 Manual",
    params: [
      ["nMin", 0.011, "s/m^(1/3)", "Minimum Manning roughness coefficient"],
      ["nNormal", 0.013, "s/m^(1/3)", "Normal Manning roughness coefficient"],
      ["nMax", 0.015, "s/m^(1/3)", "Maximum Manning roughness coefficient"],
    ],
  },
  {
    modelType: "CONCRETE_FLOAT_FINISHED",
    aliases: ["concrete_lined", "float_concrete"],
    label: "Float-Finished Concrete Channel",
    category: "Concrete Channels",
    archetypeId: Hec2ArchetypeId.CONCRETE_FLOAT_FINISHED,
    description: "Float-finished concrete lined canal or floodway (Chow Table 5-6).",
    provenance: "Chow (1959) Open-Channel Hydraulics Table 5-6; USACE EM 1110-2-1416",
    params: [
      ["nMin", 0.013, "s/m^(1/3)", "Minimum Manning roughness coefficient"],
      ["nNormal", 0.015, "s/m^(1/3)", "Normal Manning roughness coefficient"],
      ["nMax", 0.016, "s/m^(1/3)", "Maximum Manning roughness coefficient"],
    ],
  },
  {
    modelType: "CONCRETE_UNFINISHED",
    aliases: ["unfinished_concrete", "gunite"],
    label: "Unfinished Concrete Channel",
    category: "Concrete Channels",
    archetypeId: Hec2ArchetypeId.CONCRETE_UNFINISHED,
    description: "Unfinished concrete channel with form marks and minor roughness.",
    provenance: "Chow (1959) Open-Channel Hydraulics Table 5-6",
    params: [
      ["nMin", 0.014, "s/m^(1/3)", "Minimum Manning roughness coefficient"],
      ["nNormal", 0.017, "s/m^(1/3)", "Normal Manning roughness coefficient"],
      ["nMax", 0.02, "s/m^(1/3)", "Maximum Manning roughness coefficient"],
    ],
  },
  {
    modelType: "CONCRETE_SHOTCRETE",
    aliases: ["shotcrete", "gunite_wavy"],
    label: "Shotcrete / Gunite Lined Channel",
    category: "Concrete Channels",
    archetypeId: Hec2ArchetypeId.CONCRETE_SHOTCRETE,
    description: "Good-to-wavy shotcrete/gunite lined open channel.",
    provenance: "Chow (1959) Open-Channel Hydraulics Table 5-6",
    params: [
      ["nMin", 0.016, "s/m^(1/3)", "Minimum Manning roughness coefficient"],
      ["nNormal", 0.019, "s/m^(1/3)", "Normal Manning roughness coefficient"],
      ["nMax", 0.023, "s/m^(1/3)", "Maximum Manning roughness coefficient"],
    ],
  },

  // Earth Channels
  {
    modelType: "EARTH_CLEAN_STRAIGHT",
    aliases: ["earth_clean", "excavated_earth"],
    label: "Excavated Earth — Clean & Straight",
    category: "Earth Channels",
    archetypeId: Hec2ArchetypeId.EARTH_CLEAN_STRAIGHT,
    description: "Clean, recently completed straight excavated earth channel.",
    provenance: "Chow (1959) Open-Channel Hydraulics Table 5-6; USACE HEC-2",
    params: [
      ["nMin", 0.016, "s/m^(1/3)", "Minimum Manning roughness coefficient"],
      ["nNormal", 0.018, "s/m^(1/3)", "Normal Manning roughness coefficient"],
      ["nMax", 0.02, "s/m^(1/3)", "Maximum Manning roughness coefficient"],
    ],
  },
  {
    modelType: "EARTH_GRAVEL_UNIFORM",
    aliases: ["earth_gravel", "gravel_canal"],
    label: "Excavated Earth — Uniform Gravel",
    category: "Earth Channels",
    archetypeId: Hec2ArchetypeId.EARTH_GRAVEL_UNIFORM,
    description: "Uniform section earth channel with clean gravel bed.",
    provenance: "Chow (1959) Open-Channel Hydraulics Table 5-6",
    params: [
      ["nMin", 0.022, "s/m^(1/3)", "Minimum Manning roughness coefficient"],
      ["nNormal", 0.025, "s/m^(1/3)", "Normal Manning roughness coefficient"],
      ["nMax", 0.03, "s/m^(1/3)", "Maximum Manning roughness coefficient"],
    ],
  },
  {
    modelType: "EARTH_SHORT_GRASS_WEEDS",
    aliases: ["earth_grass", "earth_weeds"],
    label: "Excavated Earth — Short Grass & Few Weeds",
    category: "Earth Channels",
    archetypeId: Hec2ArchetypeId.EARTH_SHORT_GRASS_WEEDS,
    description: "Straight earth channel with short grass and scattered weeds.",
    provenance: "Chow (1959) Open-Channel Hydraulics Table 5-6",
    params: [
      ["nMin", 0.022, "s/m^(1/3)", "Minimum Manning roughness coefficient"],
      ["nNormal", 0.027, "s/m^(1/3)", "Normal Manning roughness coefficient"],
      ["nMax", 0.033, "s/m^(1/3)", "Maximum Manning roughness coefficient"],
    ],
  },
  {
    modelType: "EARTH_DENSE_WEEDS",
    aliases: ["earth_unmaintained", "weedy_ditch"],
    label: "Unmaintained Earth — Dense Weeds",
    category: "Earth Channels",
    archetypeId: Hec2ArchetypeId.EARTH_DENSE_WEEDS,
    description: "Unmaintained excavated channel with dense weeds as high as flow depth.",
    provenance: "Chow (1959) Open-Channel Hydraulics Table 5-6",
    params: [
      ["nMin", 0.05, "s/m^(1/3)", "Minimum Manning roughness coefficient"],
      ["nNormal", 0.08, "s/m^(1/3)", "Normal Manning roughness coefficient"],
      ["nMax", 0.12, "s/m^(1/3)", "Maximum Manning roughness coefficient"],
    ],
  },

  // Natural Streams
  {
    modelType: "STREAM_CLEAN_STRAIGHT",
    aliases: ["natural_stream_clean", "stream_straight"],
    label: "Natural Stream — Clean & Straight",
    category: "Natural Streams",
    archetypeId: Hec2ArchetypeId.STREAM_CLEAN_STRAIGHT,
    description: "Clean, straight natural stream at full stage without rifts or deep pools.",
    provenance: "Chow (1959) Open-Channel Hydraulics Table 5-6; USACE HEC-2",
    params: [
      ["nMin", 0.025, "s/m^(1/3)", "Minimum Manning roughness coefficient"],
      ["nNormal", 0.03, "s/m^(1/3)", "Normal Manning roughness coefficient"],
      ["nMax", 0.033, "s/m^(1/3)", "Maximum Manning roughness coefficient"],
    ],
  },
  {
    modelType: "STREAM_WINDING_POOLS",
    aliases: ["natural_stream_winding", "winding_stream"],
    label: "Natural Stream — Clean, Winding with Pools",
    category: "Natural Streams",
    archetypeId: Hec2ArchetypeId.STREAM_WINDING_POOLS,
    description: "Clean, winding natural stream with some pools and shoals.",
    provenance: "Chow (1959) Open-Channel Hydraulics Table 5-6",
    params: [
      ["nMin", 0.033, "s/m^(1/3)", "Minimum Manning roughness coefficient"],
      ["nNormal", 0.04, "s/m^(1/3)", "Normal Manning roughness coefficient"],
      ["nMax", 0.045, "s/m^(1/3)", "Maximum Manning roughness coefficient"],
    ],
  },
  {
    modelType: "STREAM_SLUGGISH_WEEDY",
    aliases: ["sluggish_stream", "weedy_stream"],
    label: "Natural Stream — Sluggish, Weedy & Deep Pools",
    category: "Natural Streams",
    archetypeId: Hec2ArchetypeId.STREAM_SLUGGISH_WEEDY,
    description: "Sluggish natural stream reaches with weeds and deep pools.",
    provenance: "Chow (1959) Open-Channel Hydraulics Table 5-6",
    params: [
      ["nMin", 0.05, "s/m^(1/3)", "Minimum Manning roughness coefficient"],
      ["nNormal", 0.07, "s/m^(1/3)", "Normal Manning roughness coefficient"],
      ["nMax", 0.08, "s/m^(1/3)", "Maximum Manning roughness coefficient"],
    ],
  },
  {
    modelType: "STREAM_MOUNTAIN_COBBLES",
    aliases: ["mountain_stream", "cobble_stream"],
    label: "Mountain Stream — Gravel, Cobbles & Boulders",
    category: "Natural Streams",
    archetypeId: Hec2ArchetypeId.STREAM_MOUNTAIN_COBBLES,
    description: "Steep mountain stream with cobbles and large boulders.",
    provenance: "Chow (1959) Open-Channel Hydraulics Table 5-6",
    params: [
      ["nMin", 0.04, "s/m^(1/3)", "Minimum Manning roughness coefficient"],
      ["nNormal", 0.05, "s/m^(1/3)", "Normal Manning roughness coefficient"],
      ["nMax", 0.07, "s/m^(1/3)", "Maximum Manning roughness coefficient"],
    ],
  },

  // Floodplains
  {
    modelType: "FLOODPLAIN_PASTURE_SHORT",
    aliases: ["floodplain_pasture", "overbank_pasture"],
    label: "Floodplain — Short Grass Pasture",
    category: "Floodplains",
    archetypeId: Hec2ArchetypeId.FLOODPLAIN_PASTURE_SHORT,
    description: "Floodplain overbank pasture with short grass and no brush.",
    provenance: "Chow (1959) Open-Channel Hydraulics Table 5-6; USACE HEC-2",
    params: [
      ["nMin", 0.025, "s/m^(1/3)", "Minimum Manning roughness coefficient"],
      ["nNormal", 0.03, "s/m^(1/3)", "Normal Manning roughness coefficient"],
      ["nMax", 0.035, "s/m^(1/3)", "Maximum Manning roughness coefficient"],
    ],
  },
  {
    modelType: "FLOODPLAIN_CULTIVATED_CROPS",
    aliases: ["floodplain_crops", "cultivated_overbank"],
    label: "Floodplain — Mature Row Crops",
    category: "Floodplains",
    archetypeId: Hec2ArchetypeId.FLOODPLAIN_CULTIVATED_CROPS,
    description: "Cultivated floodplain with mature row crops.",
    provenance: "Chow (1959) Open-Channel Hydraulics Table 5-6",
    params: [
      ["nMin", 0.025, "s/m^(1/3)", "Minimum Manning roughness coefficient"],
      ["nNormal", 0.035, "s/m^(1/3)", "Normal Manning roughness coefficient"],
      ["nMax", 0.045, "s/m^(1/3)", "Maximum Manning roughness coefficient"],
    ],
  },
  {
    modelType: "FLOODPLAIN_SCATTERED_BRUSH",
    aliases: ["floodplain_brush", "overbank_brush"],
    label: "Floodplain — Scattered Brush & Heavy Weeds",
    category: "Floodplains",
    archetypeId: Hec2ArchetypeId.FLOODPLAIN_SCATTERED_BRUSH,
    description: "Floodplain overbank with scattered brush and heavy weeds.",
    provenance: "Chow (1959) Open-Channel Hydraulics Table 5-6",
    params: [
      ["nMin", 0.035, "s/m^(1/3)", "Minimum Manning roughness coefficient"],
      ["nNormal", 0.05, "s/m^(1/3)", "Normal Manning roughness coefficient"],
      ["nMax", 0.07, "s/m^(1/3)", "Maximum Manning roughness coefficient"],
    ],
  },
  {
    modelType: "FLOODPLAIN_HEAVY_TIMBER",
    aliases: ["floodplain_timber", "floodplain_forest"],
    label: "Floodplain — Heavy Stand of Timber",
    category: "Floodplains",
    archetypeId: Hec2ArchetypeId.FLOODPLAIN_HEAVY_TIMBER,
    description: "Heavy stand of timber with few down trees and flood stage below branches.",
    provenance: "Chow (1959) Open-Channel Hydraulics Table 5-6; USACE HEC-2",
    params: [
      ["nMin", 0.08, "s/m^(1/3)", "Minimum Manning roughness coefficient"],
      ["nNormal", 0.1, "s/m^(1/3)", "Normal Manning roughness coefficient"],
      ["nMax", 0.12, "s/m^(1/3)", "Maximum Manning roughness coefficient"],
    ],
  },

  // Bridge & Culvert Contraction / Expansion Losses
  {
    modelType: "TRANSITION_GRADUAL",
    aliases: ["gradual_transition", "no_transition_loss"],
    label: "Gradual Channel Transition",
    category: "Bridge & Culvert Losses",
    archetypeId: Hec2ArchetypeId.TRANSITION_GRADUAL,
    description: "Gradual subcritical open-channel transition (USACE HEC-2 default NC card values).",
    provenance: "USACE HEC-2 Water Surface Profiles User's Manual Table 2",
    params: [
      ["cchv", 0.1, "-", "Contraction loss coefficient Cc"],
      ["cehv", 0.3, "-", "Expansion loss coefficient Ce"],
    ],
  },
  {
    modelType: "BRIDGE_TYPICAL",
    aliases: ["typical_bridge", "bridge_section"],
    label: "Typical Bridge Section Transition",
    category: "Bridge & Culvert Losses",
    archetypeId: Hec2ArchetypeId.BRIDGE_TYPICAL,
    description: "Typical subcritical bridge contraction and expansion loss coefficients.",
    provenance: "USACE HEC-2 Water Surface Profiles User's Manual Table 2",
    params: [
      ["cchv", 0.3, "-", "Contraction loss coefficient Cc"],
      ["cehv", 0.5, "-", "Expansion loss coefficient Ce"],
      ["pierLossK", 1.25, "-", "Yarnell pier shape coefficient K"],
    ],
  },
  {
    modelType: "TRANSITION_ABRUPT",
    aliases: ["abrupt_transition", "severe_bridge"],
    label: "Abrupt Transition / Severe Bridge",
    category: "Bridge & Culvert Losses",
    archetypeId: Hec2ArchetypeId.TRANSITION_ABRUPT,
    description: "Abrupt contraction/expansion at severe bridge constrictions or abutments.",
    provenance: "USACE HEC-2 Water Surface Profiles User's Manual Table 2",
    params: [
      ["cchv", 0.6, "-", "Contraction loss coefficient Cc"],
      ["cehv", 0.8, "-", "Expansion loss coefficient Ce"],
    ],
  },
  {
    modelType: "CULVERT_BOX_WINGWALL",
    aliases: ["box_culvert", "culvert_box"],
    label: "Reinforced Concrete Box Culvert (30°-75° Wingwalls)",
    category: "Bridge & Culvert Losses",
    archetypeId: Hec2ArchetypeId.CULVERT_BOX_WINGWALL,
    description: "Concrete box culvert entrance and contraction/expansion loss parameters (FHWA HDS-5 / HEC-2).",
    provenance: "FHWA HDS-5 Hydraulic Design of Highway Culverts; USACE HEC-2",
    params: [
      ["cchv", 0.3, "-", "Contraction loss coefficient Cc"],
      ["cehv", 0.5, "-", "Expansion loss coefficient Ce"],
      ["ke", 0.4, "-", "Entrance loss coefficient Ke"],
      ["nBarrel", 0.013, "s/m^(1/3)", "Concrete barrel Manning's n"],
    ],
  },
  {
    modelType: "CULVERT_PIPE_PROJECTING",
    aliases: ["pipe_culvert", "cmp_culvert"],
    label: "Corrugated Metal Pipe Culvert (Projecting)",
    category: "Bridge & Culvert Losses",
    archetypeId: Hec2ArchetypeId.CULVERT_PIPE_PROJECTING,
    description: "Projecting corrugated metal pipe culvert loss and roughness parameters (FHWA HDS-5 / HEC-2).",
    provenance: "FHWA HDS-5 Hydraulic Design of Highway Culverts; USACE HEC-2",
    params: [
      ["cchv", 0.3, "-", "Contraction loss coefficient Cc"],
      ["cehv", 0.5, "-", "Expansion loss coefficient Ce"],
      ["ke", 0.9, "-", "Projecting entrance loss coefficient Ke"],
      ["nBarrel", 0.024, "s/m^(1/3)", "Corrugated metal barrel Manning's n"],
    ],
  },
];

/**
 * Converts `HEC2_STD_SPECS` into declarative `CleanroomModelSchema[]` for `cleanroomSchemasToLibraryPayloads`.
 */
export function buildHec2CleanroomSchemas(): CleanroomModelSchema[] {
  return HEC2_STD_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `HEC2.${spec.category.replace(/[^a-zA-Z0-9]+/g, "")}.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "hydraulics",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Component",
      width: 96,
      height: 52,
      svg: generateHec2BlockSvg(spec.modelType, spec.category),
      ports: STANDARD_HYDRAULIC_PORTS,
      parameters,
      wasmKernel: "hec2EvalHydraulics",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}

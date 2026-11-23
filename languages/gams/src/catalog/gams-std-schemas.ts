// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gams — Cleanroom Standard Library Schemas.
 *
 * Declarative schemas for GAMS intrinsic set/math operators (`sum`, `prod`, `smin`, `smax`,
 * `ord`, `card`, `sameas`) and classic GAMSlib LP/MIP archetypes (`trnsport`, `diet`, `blend`).
 */

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

export const GamsArchetypeId = {
  // Intrinsic set / math operators
  SUM: 1,
  PROD: 2,
  SMIN: 3,
  SMAX: 4,
  ORD: 5,
  CARD: 6,
  SAMEAS: 7,
  // Classic GAMSlib optimization archetypes
  TRNSPORT: 101,
  DIET: 102,
  BLEND: 103,
} as const;

export type GamsArchetypeId = (typeof GamsArchetypeId)[keyof typeof GamsArchetypeId];

export type GamsModelCategory = "Set & Indexed Operators" | "GAMSlib Optimization Archetypes";

export interface GamsModelSpec {
  modelType: string;
  aliases?: string[] | undefined;
  label: string;
  category: GamsModelCategory;
  archetypeId: GamsArchetypeId;
  wasmKernel: string;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<GamsModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Set & Indexed Operators": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "OP" },
  "GAMSlib Optimization Archetypes": { fill: "#1e3f2f", stroke: "#34d399", badge: "OPT" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a GAMS operator or archetype.
 */
export function generateGamsBlockSvg(modelType: string, category: GamsModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 10);
  const fontSize = label.length > 7 ? "8.5" : "10";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 56" width="96" height="56">`,
    `<rect x="2" y="2" width="92" height="52" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="2"/>`,
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>`,
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>`,
    `<text x="48" y="37" text-anchor="middle" font-family="sans-serif" font-weight="600" font-size="${fontSize}" fill="#f8fafc">${label}</text>`,
    `</svg>`,
  ].join("");
}

export const GAMS_MODEL_SPECS: GamsModelSpec[] = [
  // Intrinsic Set & Indexed Operators
  {
    modelType: "sum",
    aliases: ["SUM", "sigma"],
    label: "Indexed Summation (sum)",
    category: "Set & Indexed Operators",
    archetypeId: GamsArchetypeId.SUM,
    wasmKernel: "gams_sum",
    description: "Computes the algebraic summation over an indexed domain set with optional $-conditional filter.",
    provenance: "GAMS User's Guide (Brooke, Kendrick, Meeraus, 1988) — Indexed Operations",
    params: [["n", 3, "count", "Number of domain elements"]],
  },
  {
    modelType: "prod",
    aliases: ["PROD"],
    label: "Indexed Product (prod)",
    category: "Set & Indexed Operators",
    archetypeId: GamsArchetypeId.PROD,
    wasmKernel: "gams_prod",
    description: "Computes the algebraic product over an indexed domain set.",
    provenance: "GAMS User's Guide (Brooke, Kendrick, Meeraus, 1988) — Indexed Operations",
    params: [["n", 3, "count", "Number of domain elements"]],
  },
  {
    modelType: "smin",
    aliases: ["SMIN"],
    label: "Indexed Minimum (smin)",
    category: "Set & Indexed Operators",
    archetypeId: GamsArchetypeId.SMIN,
    wasmKernel: "gams_smin",
    description: "Returns the minimum value of an expression evaluated over an indexed domain set.",
    provenance: "GAMS User's Guide (Brooke, Kendrick, Meeraus, 1988) — Indexed Operations",
    params: [["n", 3, "count", "Number of domain elements"]],
  },
  {
    modelType: "smax",
    aliases: ["SMAX"],
    label: "Indexed Maximum (smax)",
    category: "Set & Indexed Operators",
    archetypeId: GamsArchetypeId.SMAX,
    wasmKernel: "gams_smax",
    description: "Returns the maximum value of an expression evaluated over an indexed domain set.",
    provenance: "GAMS User's Guide (Brooke, Kendrick, Meeraus, 1988) — Indexed Operations",
    params: [["n", 3, "count", "Number of domain elements"]],
  },
  {
    modelType: "ord",
    aliases: ["ORD"],
    label: "Ordinal Position (ord)",
    category: "Set & Indexed Operators",
    archetypeId: GamsArchetypeId.ORD,
    wasmKernel: "gams_ord",
    description: "Returns the 1-based ordinal position of an element within an ordered static GAMS set.",
    provenance: "GAMS User's Guide (Brooke, Kendrick, Meeraus, 1988) — Ordered Sets",
    params: [["index", 1, "1-based", "1-based element index"]],
  },
  {
    modelType: "card",
    aliases: ["CARD"],
    label: "Set Cardinality (card)",
    category: "Set & Indexed Operators",
    archetypeId: GamsArchetypeId.CARD,
    wasmKernel: "gams_card",
    description: "Returns the number of elements (cardinality) in a GAMS set.",
    provenance: "GAMS User's Guide (Brooke, Kendrick, Meeraus, 1988) — Ordered Sets",
    params: [["count", 0, "count", "Cardinality of the set"]],
  },
  {
    modelType: "sameas",
    aliases: ["SAMEAS"],
    label: "Set Element Equality (sameas)",
    category: "Set & Indexed Operators",
    archetypeId: GamsArchetypeId.SAMEAS,
    wasmKernel: "gams_sameas",
    description: "Returns 1 if two set element labels are identical (case-insensitive), otherwise 0.",
    provenance: "GAMS User's Guide (Brooke, Kendrick, Meeraus, 1988) — Set Comparisons",
    params: [
      ["a", 1, "id", "First element identifier"],
      ["b", 1, "id", "Second element identifier"],
    ],
  },

  // Classic GAMSlib Archetypes
  {
    modelType: "trnsport",
    aliases: ["TRNSPORT", "transport", "dantzig_transport"],
    label: "Transportation Problem (trnsport)",
    category: "GAMSlib Optimization Archetypes",
    archetypeId: GamsArchetypeId.TRNSPORT,
    wasmKernel: "gams_trnsport_cost",
    description: "Dantzig's classic 2-plant, 3-market minimum-cost transportation LP (optimal objective = 153.675).",
    provenance: "G. B. Dantzig (1963), Linear Programming and Extensions; GAMSlib SEQ=1 (trnsport.gms)",
    params: [
      ["freight", 90, "$/case/1000mi", "Freight cost per case per thousand miles"],
      ["cap_seattle", 350, "cases", "Canning capacity at Seattle"],
      ["cap_sandiego", 600, "cases", "Canning capacity at San Diego"],
    ],
  },
  {
    modelType: "diet",
    aliases: ["DIET", "stigler_diet"],
    label: "Diet Optimization Problem (diet)",
    category: "GAMSlib Optimization Archetypes",
    archetypeId: GamsArchetypeId.DIET,
    wasmKernel: "gams_diet_cost",
    description: "Minimum-cost nutritional diet LP satisfying daily nutrient lower bounds.",
    provenance: "G. J. Stigler (1945), The Cost of Subsistence; GAMSlib diet archetype",
    params: [
      ["min_calories", 2000, "kcal", "Minimum daily caloric intake"],
      ["min_protein", 55, "g", "Minimum daily protein intake"],
    ],
  },
  {
    modelType: "blend",
    aliases: ["BLEND", "alloy_blend"],
    label: "Blending Problem (blend)",
    category: "GAMSlib Optimization Archetypes",
    archetypeId: GamsArchetypeId.BLEND,
    wasmKernel: "gams_blend_cost",
    description: "Minimum-cost raw material blending LP subject to composition ratio constraints.",
    provenance: "H. P. Williams (1978), Model Building in Mathematical Programming; GAMSlib blend archetype",
    params: [
      ["target_batch", 100, "kg", "Target blended batch mass"],
      ["min_grade", 0.4, "fraction", "Minimum active component grade"],
    ],
  },
];

/**
 * Builds the `CleanroomModelSchema[]` array consumed by `cleanroomSchemasToLibraryPayloads`.
 */
export function buildGamsCleanroomSchemas(): CleanroomModelSchema[] {
  return GAMS_MODEL_SPECS.map((spec) => {
    const ports: DiagramPortSpec[] = [
      { name: "in", kind: "signal", side: "left", dx: 0, dy: 28 },
      { name: "out", kind: "signal", side: "right", dx: 96, dy: 28 },
    ];
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `GAMS.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "optimization",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Function",
      width: 96,
      height: 56,
      svg: generateGamsBlockSvg(spec.modelType, spec.category),
      ports,
      parameters,
      wasmKernel: spec.wasmKernel,
      extra: { archetypeId: spec.archetypeId },
    };
  });
}

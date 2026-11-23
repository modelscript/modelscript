// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom Gerber aperture primitive & IPC-2221 DFM preset archetype IDs
 * matching `assets/gerber-std-lib/src/models.ts`.
 */
export const GerberArchetypeId = {
  // Standard RS-274X Aperture Primitives
  APERTURE_CIRCLE: 1,
  APERTURE_RECTANGLE: 2,
  APERTURE_OBROUND: 3,
  APERTURE_POLYGON: 4,
  MACRO_THERMAL: 5,
  MACRO_MOIRE: 6,
  // IPC-2221 Trace / Pad / Via DFM Presets
  IPC2221_CLASS1_TRACE: 10,
  IPC2221_CLASS2_TRACE: 11,
  IPC2221_CLASS3_TRACE: 12,
  IPC2221_VIA_STANDARD: 13,
  IPC2221_VIA_MICRO: 14,
  // Copper Weight & Dielectric Stackup Presets
  IPC2221_COPPER_1OZ: 20,
  IPC2221_COPPER_2OZ: 21,
  IPC2221_FR4_SUBSTRATE: 22,
} as const;

export type GerberArchetypeId = (typeof GerberArchetypeId)[keyof typeof GerberArchetypeId];

export type GerberModelCategory = "Aperture Primitives" | "IPC-2221 DFM Presets" | "PCB Stackup Materials";

export interface GerberModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: GerberModelCategory;
  archetypeId: GerberArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<GerberModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Aperture Primitives": { fill: "#1e3a5f", stroke: "#38bdf8", badge: "APER" },
  "IPC-2221 DFM Presets": { fill: "#3b2314", stroke: "#f59e0b", badge: "DFM" },
  "PCB Stackup Materials": { fill: "#143829", stroke: "#34d399", badge: "MATL" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a Gerber aperture primitive or IPC-2221 preset.
 */
export function generateGerberBlockSvg(modelType: string, category: GerberModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 12);
  const fontSize = label.length > 9 ? "7.4" : "8.8";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 52" width="96" height="52">` +
    `<rect x="2" y="2" width="92" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.0" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: GerberModelSpec): DiagramPortSpec[] {
  if (spec.category === "Aperture Primitives") {
    return [
      { name: "coord_in", kind: "geometry", side: "left", dx: 0, dy: 26 },
      { name: "copper_out", kind: "geometry", side: "right", dx: 96, dy: 26 },
    ];
  }
  return [
    { name: "geometry_in", kind: "geometry", side: "left", dx: 0, dy: 26 },
    { name: "dfm_out", kind: "signal", side: "right", dx: 96, dy: 26 },
  ];
}

/**
 * Declarative catalog of standard Gerber RS-274X aperture primitives and IPC-2221 DFM presets.
 */
export const GERBER_MODEL_SPECS: GerberModelSpec[] = [
  // --- Aperture Primitives ---
  {
    modelType: "APERTURE_CIRCLE",
    aliases: ["C", "CIRCLE", "CIRCULAR"],
    label: "Circle Aperture (C)",
    category: "Aperture Primitives",
    archetypeId: GerberArchetypeId.APERTURE_CIRCLE,
    description: "Standard Gerber RS-274X circular aperture (%ADD<n>C,<diameter>[X<hole>]*%).",
    provenance: "Ucamco Gerber Layer Format Specification (RS-274X) §4.4.2",
    params: [
      ["diameter", 0.254, "mm", "Outer circle diameter (default 10 mil)"],
      ["holeDiameter", 0.0, "mm", "Optional concentric circular hole diameter"],
    ],
  },
  {
    modelType: "APERTURE_RECTANGLE",
    aliases: ["R", "RECT", "RECTANGLE"],
    label: "Rectangle Aperture (R)",
    category: "Aperture Primitives",
    archetypeId: GerberArchetypeId.APERTURE_RECTANGLE,
    description: "Standard Gerber RS-274X rectangular aperture (%ADD<n>R,<xSize>X<ySize>[X<hole>]*%).",
    provenance: "Ucamco Gerber Layer Format Specification (RS-274X) §4.4.3",
    params: [
      ["xSize", 1.5, "mm", "Rectangle X width"],
      ["ySize", 1.0, "mm", "Rectangle Y height"],
      ["holeDiameter", 0.0, "mm", "Optional concentric circular hole diameter"],
    ],
  },
  {
    modelType: "APERTURE_OBROUND",
    aliases: ["O", "OBROUND", "OVAL"],
    label: "Obround Aperture (O)",
    category: "Aperture Primitives",
    archetypeId: GerberArchetypeId.APERTURE_OBROUND,
    description: "Standard Gerber RS-274X obround (stadium/oval) aperture (%ADD<n>O,<xSize>X<ySize>[X<hole>]*%).",
    provenance: "Ucamco Gerber Layer Format Specification (RS-274X) §4.4.4",
    params: [
      ["xSize", 2.0, "mm", "Obround X outer length"],
      ["ySize", 1.0, "mm", "Obround Y outer width"],
      ["holeDiameter", 0.0, "mm", "Optional concentric circular hole diameter"],
    ],
  },
  {
    modelType: "APERTURE_POLYGON",
    aliases: ["P", "POLYGON", "POLY"],
    label: "Regular Polygon Aperture (P)",
    category: "Aperture Primitives",
    archetypeId: GerberArchetypeId.APERTURE_POLYGON,
    description:
      "Standard Gerber RS-274X regular polygon aperture (%ADD<n>P,<outerDia>X<vertices>[X<rot>[X<hole>]]*%).",
    provenance: "Ucamco Gerber Layer Format Specification (RS-274X) §4.4.5",
    params: [
      ["outerDiameter", 1.6, "mm", "Circumscribed outer diameter"],
      ["vertices", 6, "count", "Number of polygon vertices (3..12)"],
      ["rotationDeg", 0.0, "deg", "Counter-clockwise rotation angle"],
      ["holeDiameter", 0.0, "mm", "Optional concentric circular hole diameter"],
    ],
  },
  {
    modelType: "MACRO_THERMAL",
    aliases: ["THERMAL", "AM_THERMAL", "PRIMITIVE_7"],
    label: "Thermal Relief Macro (Code 7)",
    category: "Aperture Primitives",
    archetypeId: GerberArchetypeId.MACRO_THERMAL,
    description: "Gerber RS-274X aperture macro primitive code 7: annular thermal relief pad with 4 spoke gaps.",
    provenance: "Ucamco Gerber Layer Format Specification (RS-274X) §4.5.1.8",
    params: [
      ["outerDiameter", 2.0, "mm", "Outer thermal ring diameter"],
      ["innerDiameter", 1.2, "mm", "Inner thermal ring diameter"],
      ["gapThickness", 0.3, "mm", "Cross-hair isolation gap width"],
      ["rotationDeg", 45.0, "deg", "Cross-hair rotation angle"],
    ],
  },
  {
    modelType: "MACRO_MOIRE",
    aliases: ["MOIRE", "AM_MOIRE", "PRIMITIVE_6"],
    label: "Moire Target Macro (Code 6)",
    category: "Aperture Primitives",
    archetypeId: GerberArchetypeId.MACRO_MOIRE,
    description: "Gerber RS-274X aperture macro primitive code 6: registration fiducial target with concentric rings.",
    provenance: "Ucamco Gerber Layer Format Specification (RS-274X) §4.5.1.7",
    params: [
      ["outerDiameter", 3.0, "mm", "Outer ring diameter"],
      ["ringThickness", 0.15, "mm", "Concentric ring stroke width"],
      ["ringGap", 0.15, "mm", "Gap between concentric rings"],
      ["maxRings", 3, "count", "Maximum number of concentric rings"],
    ],
  },

  // --- IPC-2221 Trace / Pad / Via DFM Presets ---
  {
    modelType: "IPC2221_CLASS1_TRACE",
    aliases: ["IPC_CLASS1", "CLASS1_TRACE"],
    label: "IPC-2221 Class 1 Trace DFM",
    category: "IPC-2221 DFM Presets",
    archetypeId: GerberArchetypeId.IPC2221_CLASS1_TRACE,
    description: "IPC-2221A Class 1 (General Electronic Products) minimum trace width, spacing, and annular ring.",
    provenance: "IPC-2221A Generic Standard on Printed Board Design §6.2 & Table 6-1",
    params: [
      ["minTraceWidthMm", 0.15, "mm", "Minimum conductor width (6 mil)"],
      ["minSpacingMm", 0.15, "mm", "Minimum conductor spacing (6 mil)"],
      ["minAnnularRingMm", 0.05, "mm", "Minimum supported hole annular ring"],
      ["tempRiseC", 10.0, "degC", "Allowable conductor temperature rise"],
    ],
  },
  {
    modelType: "IPC2221_CLASS2_TRACE",
    aliases: ["IPC_CLASS2", "CLASS2_TRACE", "IPC2221_STANDARD"],
    label: "IPC-2221 Class 2 Trace DFM",
    category: "IPC-2221 DFM Presets",
    archetypeId: GerberArchetypeId.IPC2221_CLASS2_TRACE,
    description: "IPC-2221A Class 2 (Dedicated Service Electronics) trace width, spacing, and annular ring preset.",
    provenance: "IPC-2221A Generic Standard on Printed Board Design §6.2 & §9.1",
    params: [
      ["minTraceWidthMm", 0.127, "mm", "Minimum conductor width (5 mil)"],
      ["minSpacingMm", 0.127, "mm", "Minimum conductor spacing (5 mil)"],
      ["minAnnularRingMm", 0.127, "mm", "Minimum annular ring (5 mil)"],
      ["tempRiseC", 10.0, "degC", "Allowable conductor temperature rise"],
    ],
  },
  {
    modelType: "IPC2221_CLASS3_TRACE",
    aliases: ["IPC_CLASS3", "CLASS3_TRACE", "AEROSPACE_TRACE"],
    label: "IPC-2221 Class 3 Trace DFM",
    category: "IPC-2221 DFM Presets",
    archetypeId: GerberArchetypeId.IPC2221_CLASS3_TRACE,
    description: "IPC-2221A Class 3 (High-Reliability Aerospace/Medical) conservative trace and annular ring limits.",
    provenance: "IPC-2221A Generic Standard on Printed Board Design §9.1.2 (Class 3)",
    params: [
      ["minTraceWidthMm", 0.15, "mm", "Minimum conductor width"],
      ["minSpacingMm", 0.15, "mm", "Minimum conductor spacing"],
      ["minAnnularRingMm", 0.15, "mm", "Minimum annular ring (Class 3)"],
      ["tempRiseC", 10.0, "degC", "Allowable conductor temperature rise"],
    ],
  },
  {
    modelType: "IPC2221_VIA_STANDARD",
    aliases: ["VIA_STD", "STANDARD_VIA"],
    label: "Standard Through-Hole Via",
    category: "IPC-2221 DFM Presets",
    archetypeId: GerberArchetypeId.IPC2221_VIA_STANDARD,
    description: "Standard 0.30 mm drill / 0.60 mm pad through-hole PCB via (0.15 mm annular ring).",
    provenance: "IPC-2221A / IPC-2222 Sectional Design Standard for Rigid Organic Printed Boards",
    params: [
      ["padDiameterMm", 0.6, "mm", "Outer via pad diameter"],
      ["drillDiameterMm", 0.3, "mm", "Finished hole drill diameter"],
      ["minAnnularRingMm", 0.127, "mm", "Minimum annular ring requirement"],
    ],
  },
  {
    modelType: "IPC2221_VIA_MICRO",
    aliases: ["MICROVIA", "HDI_VIA"],
    label: "HDI Laser Microvia",
    category: "IPC-2221 DFM Presets",
    archetypeId: GerberArchetypeId.IPC2221_VIA_MICRO,
    description: "IPC-2226 HDI laser-drilled microvia preset (0.10 mm drill / 0.25 mm capture pad).",
    provenance: "IPC-2226 Sectional Design Standard for High Density Interconnect (HDI) Boards",
    params: [
      ["padDiameterMm", 0.25, "mm", "Capture pad diameter"],
      ["drillDiameterMm", 0.1, "mm", "Laser drill hole diameter"],
      ["minAnnularRingMm", 0.05, "mm", "Minimum HDI annular ring"],
    ],
  },

  // --- PCB Copper & Stackup Materials ---
  {
    modelType: "IPC2221_COPPER_1OZ",
    aliases: ["COPPER_1OZ", "CU_1OZ"],
    label: "1 oz/ft^2 Copper Foil",
    category: "PCB Stackup Materials",
    archetypeId: GerberArchetypeId.IPC2221_COPPER_1OZ,
    description:
      "Standard 1 oz/ft^2 electrodeposited copper foil (34.8 um nominal thickness, rho_20 = 1.7241e-8 Ohm*m).",
    provenance: "IPC-4562A Metal Foil for Printed Board Applications & IEC 60028",
    params: [
      ["thicknessUm", 34.8, "um", "Nominal 1 oz copper foil thickness"],
      ["resistivityOhmM", 1.7241e-8, "Ohm.m", "Annealed copper resistivity at 20 C"],
      ["tempCoeffPerK", 0.00393, "1/K", "Copper resistance temperature coefficient"],
    ],
  },
  {
    modelType: "IPC2221_COPPER_2OZ",
    aliases: ["COPPER_2OZ", "CU_2OZ"],
    label: "2 oz/ft^2 Heavy Copper Foil",
    category: "PCB Stackup Materials",
    archetypeId: GerberArchetypeId.IPC2221_COPPER_2OZ,
    description: "Heavy power-electronics 2 oz/ft^2 copper foil (69.6 um nominal thickness).",
    provenance: "IPC-4562A Metal Foil for Printed Board Applications",
    params: [
      ["thicknessUm", 69.6, "um", "Nominal 2 oz copper foil thickness"],
      ["resistivityOhmM", 1.7241e-8, "Ohm.m", "Annealed copper resistivity at 20 C"],
      ["tempCoeffPerK", 0.00393, "1/K", "Copper resistance temperature coefficient"],
    ],
  },
  {
    modelType: "IPC2221_FR4_SUBSTRATE",
    aliases: ["FR4", "SUBSTRATE_FR4"],
    label: "FR-4 Epoxy Glass Dielectric",
    category: "PCB Stackup Materials",
    archetypeId: GerberArchetypeId.IPC2221_FR4_SUBSTRATE,
    description: "Standard 1.6 mm FR-4 woven glass-epoxy PCB substrate (eps_r = 4.4, tan_delta = 0.02).",
    provenance: "IPC-4101E Specification for Base Materials for Rigid and Multilayer Printed Boards",
    params: [
      ["thicknessMm", 1.6, "mm", "Nominal board dielectric thickness"],
      ["relativePermittivity", 4.4, "1", "Relative permittivity (Dk) at 1 MHz"],
      ["lossTangent", 0.02, "1", "Dissipation factor (Df)"],
    ],
  },
];

/**
 * Converts declarative `GERBER_MODEL_SPECS` into `@modelscript/runtime` `CleanroomModelSchema[]`.
 */
export function buildGerberCleanroomSchemas(): CleanroomModelSchema[] {
  return GERBER_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      ...(unit !== undefined ? { unit } : {}),
      ...(description !== undefined ? { description } : {}),
    }));
    return {
      namePath: `Gerber.StdLib.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "electronics",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Component",
      width: 96,
      height: 52,
      svg: generateGerberBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: "gerberModelEval",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}

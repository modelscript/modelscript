// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * CIF cleanroom layer & cell archetype IDs matching `assets/cif-std-lib/src/models.ts`.
 */
export const CifArchetypeId = {
  // MOSIS SCMOS Layers
  CAA: 1, // Active Area (Diffusion)
  CPG: 2, // Polysilicon Gate
  CCA: 3, // Contact to Active/Poly
  CMF: 4, // Metal 1
  CVA: 5, // Via (Metal 1 to Metal 2)
  CMS: 6, // Metal 2
  CWN: 7, // N-Well
  // Mead-Conway Classic NMOS Layers
  ND: 10, // NMOS Diffusion
  NP: 11, // NMOS Polysilicon
  NM: 12, // NMOS Metal
  NC: 13, // NMOS Contact Cut
  NI: 14, // NMOS Depletion Implant
  // Reference Standard Cells
  NMOS_INVERTER: 20,
  CMOS_INVERTER: 21,
} as const;

export type CifArchetypeId = (typeof CifArchetypeId)[keyof typeof CifArchetypeId];

export type CifLayerCategory = "MOSIS SCMOS" | "Mead-Conway NMOS" | "Standard Cells";

export interface MosisLayerRule {
  /** Canonical CIF 2.0 layer short name (1–4 uppercase chars). */
  layer: string;
  /** Human-readable layer title. */
  label: string;
  /** Process family category. */
  category: CifLayerCategory;
  /** AssemblyScript archetype ID. */
  archetypeId: CifArchetypeId;
  /** GDSII stream layer number (MOSIS SCMOS / Mead-Conway mapping). */
  gdsLayer: number;
  /** Minimum feature width in Mead-Conway lambda (λ) units. */
  minWidthLambda: number;
  /** Minimum same-layer spacing in lambda (λ) units. */
  minSpacingLambda: number;
  /** Nominal sheet resistance in Ω/□. */
  sheetResistanceOhmPerSq: number;
  /** Area capacitance to substrate in aF/µm² (1 aF = 1e-18 F). */
  areaCapAfPerUm2: number;
  /** Perimeter fringe capacitance in aF/µm. */
  fringeCapAfPerUm: number;
  /** Vertical stack bottom Z height in µm (for 3D CAD extrusion). */
  zMinUm: number;
  /** Vertical layer thickness in µm (for 3D CAD extrusion). */
  zThicknessUm: number;
  /** Display fill color (hex) for SVG & diagram rendering. */
  color: string;
  /** Display stroke color (hex). */
  stroke: string;
  /** Display fill opacity (0..1). */
  opacity: number;
  /** Brief provenance/engineering description. */
  description: string;
}

/**
 * MOSIS SCMOS (Scalable CMOS, rev. 7/8) and classic Mead-Conway (1980) NMOS layer
 * definitions with lambda design rules and nominal parasitic RC parameters.
 */
export const MOSIS_SCMOS_LAYERS: Record<string, MosisLayerRule> = {
  CWN: {
    layer: "CWN",
    label: "N-Well (CWN)",
    category: "MOSIS SCMOS",
    archetypeId: CifArchetypeId.CWN,
    gdsLayer: 42,
    minWidthLambda: 10,
    minSpacingLambda: 9,
    sheetResistanceOhmPerSq: 1200,
    areaCapAfPerUm2: 110,
    fringeCapAfPerUm: 30,
    zMinUm: 0.0,
    zThicknessUm: 0.4,
    color: "#d97706",
    stroke: "#f59e0b",
    opacity: 0.28,
    description: "MOSIS SCMOS N-Well diffusion tub for PMOS transistors (min width 10λ).",
  },
  CAA: {
    layer: "CAA",
    label: "Active Area (CAA)",
    category: "MOSIS SCMOS",
    archetypeId: CifArchetypeId.CAA,
    gdsLayer: 43,
    minWidthLambda: 3,
    minSpacingLambda: 3,
    sheetResistanceOhmPerSq: 50,
    areaCapAfPerUm2: 420,
    fringeCapAfPerUm: 180,
    zMinUm: 0.4,
    zThicknessUm: 0.25,
    color: "#16a34a",
    stroke: "#22c55e",
    opacity: 0.65,
    description: "MOSIS SCMOS Active Area / thin-oxide diffusion region (min width 3λ).",
  },
  CPG: {
    layer: "CPG",
    label: "Polysilicon Gate (CPG)",
    category: "MOSIS SCMOS",
    archetypeId: CifArchetypeId.CPG,
    gdsLayer: 46,
    minWidthLambda: 2,
    minSpacingLambda: 2,
    sheetResistanceOhmPerSq: 25,
    areaCapAfPerUm2: 95,
    fringeCapAfPerUm: 45,
    zMinUm: 0.7,
    zThicknessUm: 0.3,
    color: "#dc2626",
    stroke: "#ef4444",
    opacity: 0.72,
    description: "MOSIS SCMOS Polysilicon 1 transistor gate and local interconnect (min width 2λ).",
  },
  CCA: {
    layer: "CCA",
    label: "Contact Cut (CCA)",
    category: "MOSIS SCMOS",
    archetypeId: CifArchetypeId.CCA,
    gdsLayer: 48,
    minWidthLambda: 2,
    minSpacingLambda: 2,
    sheetResistanceOhmPerSq: 10,
    areaCapAfPerUm2: 60,
    fringeCapAfPerUm: 20,
    zMinUm: 1.0,
    zThicknessUm: 0.5,
    color: "#111827",
    stroke: "#f8fafc",
    opacity: 0.9,
    description: "MOSIS SCMOS Contact cut between Metal 1 and Active/Polysilicon (exact 2λ × 2λ).",
  },
  CMF: {
    layer: "CMF",
    label: "Metal 1 (CMF)",
    category: "MOSIS SCMOS",
    archetypeId: CifArchetypeId.CMF,
    gdsLayer: 49,
    minWidthLambda: 3,
    minSpacingLambda: 3,
    sheetResistanceOhmPerSq: 0.08,
    areaCapAfPerUm2: 38,
    fringeCapAfPerUm: 52,
    zMinUm: 1.5,
    zThicknessUm: 0.6,
    color: "#2563eb",
    stroke: "#60a5fa",
    opacity: 0.7,
    description: "MOSIS SCMOS First-level Aluminum Metallization (min width 3λ).",
  },
  CVA: {
    layer: "CVA",
    label: "Via 1-2 (CVA)",
    category: "MOSIS SCMOS",
    archetypeId: CifArchetypeId.CVA,
    gdsLayer: 50,
    minWidthLambda: 2,
    minSpacingLambda: 3,
    sheetResistanceOhmPerSq: 2,
    areaCapAfPerUm2: 30,
    fringeCapAfPerUm: 15,
    zMinUm: 2.1,
    zThicknessUm: 0.5,
    color: "#7c3aed",
    stroke: "#c4b5fd",
    opacity: 0.88,
    description: "MOSIS SCMOS Via cut connecting Metal 1 (CMF) to Metal 2 (CMS) (2λ × 2λ).",
  },
  CMS: {
    layer: "CMS",
    label: "Metal 2 (CMS)",
    category: "MOSIS SCMOS",
    archetypeId: CifArchetypeId.CMS,
    gdsLayer: 51,
    minWidthLambda: 3,
    minSpacingLambda: 4,
    sheetResistanceOhmPerSq: 0.05,
    areaCapAfPerUm2: 22,
    fringeCapAfPerUm: 44,
    zMinUm: 2.6,
    zThicknessUm: 0.8,
    color: "#0891b2",
    stroke: "#22d3ee",
    opacity: 0.65,
    description: "MOSIS SCMOS Second-level Aluminum Metallization (min width 3λ).",
  },
  // Classic Mead-Conway (1980) NMOS layers
  ND: {
    layer: "ND",
    label: "NMOS Diffusion (ND)",
    category: "Mead-Conway NMOS",
    archetypeId: CifArchetypeId.ND,
    gdsLayer: 1,
    minWidthLambda: 2,
    minSpacingLambda: 3,
    sheetResistanceOhmPerSq: 15,
    areaCapAfPerUm2: 100,
    fringeCapAfPerUm: 40,
    zMinUm: 0.2,
    zThicknessUm: 0.25,
    color: "#15803d",
    stroke: "#4ade80",
    opacity: 0.68,
    description: "Mead-Conway NMOS n+ diffusion layer (min width 2λ).",
  },
  NP: {
    layer: "NP",
    label: "NMOS Polysilicon (NP)",
    category: "Mead-Conway NMOS",
    archetypeId: CifArchetypeId.NP,
    gdsLayer: 2,
    minWidthLambda: 2,
    minSpacingLambda: 2,
    sheetResistanceOhmPerSq: 30,
    areaCapAfPerUm2: 40,
    fringeCapAfPerUm: 25,
    zMinUm: 0.5,
    zThicknessUm: 0.3,
    color: "#b91c1c",
    stroke: "#f87171",
    opacity: 0.72,
    description: "Mead-Conway NMOS polysilicon gate layer (min width 2λ).",
  },
  NM: {
    layer: "NM",
    label: "NMOS Metal (NM)",
    category: "Mead-Conway NMOS",
    archetypeId: CifArchetypeId.NM,
    gdsLayer: 3,
    minWidthLambda: 3,
    minSpacingLambda: 3,
    sheetResistanceOhmPerSq: 0.05,
    areaCapAfPerUm2: 30,
    fringeCapAfPerUm: 35,
    zMinUm: 1.2,
    zThicknessUm: 0.6,
    color: "#1d4ed8",
    stroke: "#93c5fd",
    opacity: 0.7,
    description: "Mead-Conway NMOS metal interconnect layer (min width 3λ).",
  },
  NC: {
    layer: "NC",
    label: "NMOS Contact Cut (NC)",
    category: "Mead-Conway NMOS",
    archetypeId: CifArchetypeId.NC,
    gdsLayer: 4,
    minWidthLambda: 2,
    minSpacingLambda: 2,
    sheetResistanceOhmPerSq: 10,
    areaCapAfPerUm2: 50,
    fringeCapAfPerUm: 20,
    zMinUm: 0.8,
    zThicknessUm: 0.4,
    color: "#0f172a",
    stroke: "#e2e8f0",
    opacity: 0.9,
    description: "Mead-Conway NMOS contact cut (2λ × 2λ).",
  },
  NI: {
    layer: "NI",
    label: "NMOS Implant (NI)",
    category: "Mead-Conway NMOS",
    archetypeId: CifArchetypeId.NI,
    gdsLayer: 5,
    minWidthLambda: 4,
    minSpacingLambda: 2,
    sheetResistanceOhmPerSq: 200,
    areaCapAfPerUm2: 80,
    fringeCapAfPerUm: 20,
    zMinUm: 0.1,
    zThicknessUm: 0.15,
    color: "#ca8a04",
    stroke: "#facc15",
    opacity: 0.45,
    description: "Mead-Conway NMOS depletion-mode ion implant (min width 4λ).",
  },
};

/**
 * Looks up a MOSIS SCMOS or Mead-Conway NMOS layer rule by short name (case-insensitive).
 */
export function lookupMosisLayerRule(layerName: string): MosisLayerRule | undefined {
  return MOSIS_SCMOS_LAYERS[layerName.trim().toUpperCase()];
}

/**
 * Generates a deterministic cleanroom SVG block icon for a CIF layer or standard cell.
 */
export function generateCifLayerSvg(name: string, fill: string, stroke: string, badge: string): string {
  const label = name.toUpperCase().slice(0, 10);
  const fontSize = label.length > 7 ? "8.2" : "10.0";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="#0f172a" stroke="${stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="32" height="12" rx="3" fill="${fill}" fill-opacity="0.35"/>` +
    `<text x="22" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${stroke}">${badge}</text>` +
    `<rect x="68" y="8" width="12" height="12" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1"/>` +
    `<text x="44" y="38" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

/**
 * Builds the declarative cleanroom standard library schemas for `@modelscript/cif-std-lib`.
 */
export function buildCifCleanroomSchemas(): CleanroomModelSchema[] {
  const schemas: CleanroomModelSchema[] = [];

  const defaultPorts: DiagramPortSpec[] = [
    { name: "in", kind: "electrical", side: "left", dx: 0, dy: 26 },
    { name: "out", kind: "electrical", side: "right", dx: 88, dy: 26 },
  ];

  for (const rule of Object.values(MOSIS_SCMOS_LAYERS)) {
    const badge = rule.category === "MOSIS SCMOS" ? "SCMOS" : "NMOS";
    const parameters: CleanroomParameterSchema[] = [
      {
        key: "minWidthLambda",
        type: "real",
        defaultValue: rule.minWidthLambda,
        unit: "lambda",
        description: "Minimum feature width in lambda units",
      },
      {
        key: "minSpacingLambda",
        type: "real",
        defaultValue: rule.minSpacingLambda,
        unit: "lambda",
        description: "Minimum same-layer spacing in lambda units",
      },
      {
        key: "sheetResistanceOhmPerSq",
        type: "real",
        defaultValue: rule.sheetResistanceOhmPerSq,
        unit: "Ohm/sq",
        description: "Sheet resistance",
      },
      {
        key: "areaCapAfPerUm2",
        type: "real",
        defaultValue: rule.areaCapAfPerUm2,
        unit: "aF/um^2",
        description: "Area capacitance to substrate",
      },
      {
        key: "fringeCapAfPerUm",
        type: "real",
        defaultValue: rule.fringeCapAfPerUm,
        unit: "aF/um",
        description: "Perimeter fringe capacitance",
      },
      {
        key: "gdsLayer",
        type: "integer",
        defaultValue: rule.gdsLayer,
        unit: "1",
        description: "GDSII stream layer number",
      },
    ];

    schemas.push({
      namePath: `CIF.Layers.${rule.layer}`,
      name: rule.layer,
      aliases: [rule.layer.toLowerCase(), `L_${rule.layer}`],
      label: rule.label,
      category: rule.category,
      domain: "ic-layout",
      description: rule.description,
      provenance:
        rule.category === "MOSIS SCMOS"
          ? "MOSIS Scalable CMOS (SCMOS) Design Rules"
          : "Mead & Conway, Introduction to VLSI Systems (1980)",
      symbolKind: "Layer",
      width: 88,
      height: 52,
      svg: generateCifLayerSvg(rule.layer, rule.color, rule.stroke, badge),
      ports: defaultPorts,
      parameters,
      wasmKernel: "cifEvalLayerParasitics",
      extra: {
        archetypeId: rule.archetypeId,
        gdsLayer: rule.gdsLayer,
        minWidthLambda: rule.minWidthLambda,
        minSpacingLambda: rule.minSpacingLambda,
      },
    });
  }

  // Reference Mead-Conway & SCMOS inverter cells
  schemas.push(
    {
      namePath: "CIF.Cells.NMOS_INVERTER",
      name: "NMOS_INVERTER",
      aliases: ["nmos_inv", "INV_NMOS"],
      label: "Mead-Conway NMOS Inverter",
      category: "Standard Cells",
      domain: "ic-layout",
      description: "Classic Mead-Conway depletion-load NMOS inverter cell (ND, NP, NM, NC, NI).",
      provenance: "Mead & Conway, Introduction to VLSI Systems (1980), Chapter 2",
      symbolKind: "Cell",
      width: 88,
      height: 52,
      svg: generateCifLayerSvg("NMOS_INV", "#15803d", "#4ade80", "CELL"),
      ports: defaultPorts,
      parameters: [
        { key: "lambdaUm", type: "real", defaultValue: 1.0, unit: "um", description: "Lambda feature scale" },
        { key: "pullupRatio", type: "real", defaultValue: 4.0, unit: "1", description: "Zpu/Zpd inverter ratio" },
      ],
      wasmKernel: "cifCheckMinWidth",
      extra: { archetypeId: CifArchetypeId.NMOS_INVERTER },
    },
    {
      namePath: "CIF.Cells.CMOS_INVERTER",
      name: "CMOS_INVERTER",
      aliases: ["cmos_inv", "INV_CMOS"],
      label: "MOSIS SCMOS Inverter",
      category: "Standard Cells",
      domain: "ic-layout",
      description: "Static CMOS inverter cell in MOSIS SCMOS (CWN, CAA, CPG, CCA, CMF).",
      provenance: "MOSIS SCMOS Standard Cell Reference",
      symbolKind: "Cell",
      width: 88,
      height: 52,
      svg: generateCifLayerSvg("CMOS_INV", "#2563eb", "#60a5fa", "CELL"),
      ports: defaultPorts,
      parameters: [
        { key: "lambdaUm", type: "real", defaultValue: 1.0, unit: "um", description: "Lambda feature scale" },
        { key: "betaRatio", type: "real", defaultValue: 2.0, unit: "1", description: "PMOS/NMOS width ratio" },
      ],
      wasmKernel: "cifCheckMinWidth",
      extra: { archetypeId: CifArchetypeId.CMOS_INVERTER },
    },
  );

  return schemas;
}

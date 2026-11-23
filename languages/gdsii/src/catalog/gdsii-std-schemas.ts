// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom CMOS foundry layer & standard-cell archetype IDs matching `assets/gdsii-std-lib/src/models.ts`.
 */
export const GdsiiArchetypeId = {
  NWELL: 1,
  ACTIVE: 2,
  POLY: 3,
  CONTACT: 4,
  METAL1: 5,
  VIA1: 6,
  METAL2: 7,
  CELL_INV: 101,
  CELL_NAND2: 102,
} as const;

export type GdsiiArchetypeId = (typeof GdsiiArchetypeId)[keyof typeof GdsiiArchetypeId];

export type GdsiiStdCategory = "Foundry Layer" | "Standard Cell";

export interface GdsiiStdSpec {
  name: string;
  aliases?: string[];
  label: string;
  category: GdsiiStdCategory;
  archetypeId: GdsiiArchetypeId;
  description: string;
  provenance: string;
  color: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
  ports?: DiagramPortSpec[];
}

const GDSII_STD_SPECS: GdsiiStdSpec[] = [
  {
    name: "NWELL",
    aliases: ["NW", "L1"],
    label: "N-Well Implant (Layer 1)",
    category: "Foundry Layer",
    archetypeId: GdsiiArchetypeId.NWELL,
    description: "Deep N-well implant region for PMOS devices in cleanroom generic CMOS process.",
    provenance: "Cleanroom Generic 180nm CMOS PDK",
    color: "#93c5fd",
    params: [
      ["layer", 1, "", "GDSII layer number"],
      ["datatype", 0, "", "GDSII datatype"],
      ["minWidthUm", 1.2, "um", "Minimum N-well width"],
      ["minSpacingUm", 1.2, "um", "Minimum N-well spacing"],
      ["sheetResistance", 1000.0, "Ohm/sq", "N-well sheet resistance"],
      ["thicknessUm", 0.5, "um", "Implant effective depth"],
    ],
  },
  {
    name: "ACTIVE",
    aliases: ["DIFF", "OD", "L2"],
    label: "Active Diffusion (Layer 2)",
    category: "Foundry Layer",
    archetypeId: GdsiiArchetypeId.ACTIVE,
    description: "Active silicon diffusion region (OD) defining NMOS and PMOS source/drain/channel.",
    provenance: "Cleanroom Generic 180nm CMOS PDK",
    color: "#4ade80",
    params: [
      ["layer", 2, "", "GDSII layer number"],
      ["datatype", 0, "", "GDSII datatype"],
      ["minWidthUm", 0.24, "um", "Minimum active width"],
      ["minSpacingUm", 0.28, "um", "Minimum active spacing"],
      ["sheetResistance", 10.0, "Ohm/sq", "Salicided diffusion sheet resistance"],
      ["thicknessUm", 0.15, "um", "Diffusion thickness"],
    ],
  },
  {
    name: "POLY",
    aliases: ["PO", "GATE", "L3"],
    label: "Polysilicon Gate (Layer 3)",
    category: "Foundry Layer",
    archetypeId: GdsiiArchetypeId.POLY,
    description: "Polysilicon gate electrode and local interconnect layer.",
    provenance: "Cleanroom Generic 180nm CMOS PDK",
    color: "#f87171",
    params: [
      ["layer", 3, "", "GDSII layer number"],
      ["datatype", 0, "", "GDSII datatype"],
      ["minWidthUm", 0.18, "um", "Minimum poly gate length"],
      ["minSpacingUm", 0.25, "um", "Minimum poly spacing"],
      ["sheetResistance", 8.0, "Ohm/sq", "Poly sheet resistance"],
      ["thicknessUm", 0.2, "um", "Poly thickness"],
    ],
  },
  {
    name: "CONTACT",
    aliases: ["CO", "CONT", "L4"],
    label: "Contact Cut (Layer 4)",
    category: "Foundry Layer",
    archetypeId: GdsiiArchetypeId.CONTACT,
    description: "Tungsten contact cut connecting Active/Poly to Metal 1.",
    provenance: "Cleanroom Generic 180nm CMOS PDK",
    color: "#facc15",
    params: [
      ["layer", 4, "", "GDSII layer number"],
      ["datatype", 0, "", "GDSII datatype"],
      ["minWidthUm", 0.22, "um", "Exact contact square size"],
      ["minSpacingUm", 0.25, "um", "Minimum contact-to-contact spacing"],
      ["sheetResistance", 15.0, "Ohm/sq", "Contact resistance per cut"],
      ["thicknessUm", 0.44, "um", "Contact vertical height"],
    ],
  },
  {
    name: "METAL1",
    aliases: ["M1", "L5"],
    label: "Metal 1 Interconnect (Layer 5)",
    category: "Foundry Layer",
    archetypeId: GdsiiArchetypeId.METAL1,
    description: "First aluminum/copper metal routing layer for standard cell power rails and local wiring.",
    provenance: "Cleanroom Generic 180nm CMOS PDK",
    color: "#60a5fa",
    params: [
      ["layer", 5, "", "GDSII layer number"],
      ["datatype", 0, "", "GDSII datatype"],
      ["minWidthUm", 0.24, "um", "Minimum Metal 1 width"],
      ["minSpacingUm", 0.24, "um", "Minimum Metal 1 spacing"],
      ["sheetResistance", 0.08, "Ohm/sq", "Metal 1 sheet resistance"],
      ["thicknessUm", 0.4, "um", "Metal 1 thickness"],
    ],
  },
  {
    name: "VIA1",
    aliases: ["V1", "L6"],
    label: "Via 1 Cut (Layer 6)",
    category: "Foundry Layer",
    archetypeId: GdsiiArchetypeId.VIA1,
    description: "Inter-layer via cut connecting Metal 1 to Metal 2.",
    provenance: "Cleanroom Generic 180nm CMOS PDK",
    color: "#c084fc",
    params: [
      ["layer", 6, "", "GDSII layer number"],
      ["datatype", 0, "", "GDSII datatype"],
      ["minWidthUm", 0.26, "um", "Exact Via 1 cut size"],
      ["minSpacingUm", 0.26, "um", "Minimum Via 1 spacing"],
      ["sheetResistance", 5.0, "Ohm/sq", "Via 1 resistance per cut"],
      ["thicknessUm", 0.5, "um", "Via 1 vertical height"],
    ],
  },
  {
    name: "METAL2",
    aliases: ["M2", "L7"],
    label: "Metal 2 Interconnect (Layer 7)",
    category: "Foundry Layer",
    archetypeId: GdsiiArchetypeId.METAL2,
    description: "Second metal routing layer for block-level signal and power distribution.",
    provenance: "Cleanroom Generic 180nm CMOS PDK",
    color: "#f472b6",
    params: [
      ["layer", 7, "", "GDSII layer number"],
      ["datatype", 0, "", "GDSII datatype"],
      ["minWidthUm", 0.28, "um", "Minimum Metal 2 width"],
      ["minSpacingUm", 0.28, "um", "Minimum Metal 2 spacing"],
      ["sheetResistance", 0.05, "Ohm/sq", "Metal 2 sheet resistance"],
      ["thicknessUm", 0.6, "um", "Metal 2 thickness"],
    ],
  },
  {
    name: "INV",
    aliases: ["INV_X1", "INVERTER"],
    label: "CMOS Inverter (INV)",
    category: "Standard Cell",
    archetypeId: GdsiiArchetypeId.CELL_INV,
    description: "Cleanroom 1x CMOS static inverter standard cell (PMOS in NWELL + NMOS in substrate).",
    provenance: "Cleanroom Generic 180nm CMOS Standard Cell Library",
    color: "#38bdf8",
    params: [
      ["cellWidthUm", 2.4, "um", "Standard cell width"],
      ["cellHeightUm", 4.8, "um", "Standard cell height"],
      ["gateLengthUm", 0.18, "um", "Transistor gate length"],
      ["wnUm", 0.6, "um", "NMOS channel width"],
      ["wpUm", 1.2, "um", "PMOS channel width"],
      ["cinFf", 1.8, "fF", "Input gate capacitance"],
    ],
    ports: [
      { name: "A", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "Y", kind: "signal", side: "right", dx: 88, dy: 26 },
      { name: "VDD", kind: "electrical", side: "top", dx: 44, dy: 0 },
      { name: "VSS", kind: "electrical", side: "bottom", dx: 44, dy: 52 },
    ],
  },
  {
    name: "NAND2",
    aliases: ["NAND2_X1"],
    label: "2-Input CMOS NAND (NAND2)",
    category: "Standard Cell",
    archetypeId: GdsiiArchetypeId.CELL_NAND2,
    description: "Cleanroom 1x 2-input CMOS NAND standard cell with series NMOS and parallel PMOS.",
    provenance: "Cleanroom Generic 180nm CMOS Standard Cell Library",
    color: "#34d399",
    params: [
      ["cellWidthUm", 3.6, "um", "Standard cell width"],
      ["cellHeightUm", 4.8, "um", "Standard cell height"],
      ["gateLengthUm", 0.18, "um", "Transistor gate length"],
      ["wnUm", 1.2, "um", "Series NMOS channel width"],
      ["wpUm", 1.2, "um", "Parallel PMOS channel width"],
      ["cinFf", 2.4, "fF", "Per-input gate capacitance"],
    ],
    ports: [
      { name: "A", kind: "signal", side: "left", dx: 0, dy: 16 },
      { name: "B", kind: "signal", side: "left", dx: 0, dy: 36 },
      { name: "Y", kind: "signal", side: "right", dx: 88, dy: 26 },
      { name: "VDD", kind: "electrical", side: "top", dx: 44, dy: 0 },
      { name: "VSS", kind: "electrical", side: "bottom", dx: 44, dy: 52 },
    ],
  },
];

/**
 * Generates a deterministic cleanroom SVG block icon for a GDSII layer or standard cell.
 */
export function generateGdsiiBlockSvg(spec: GdsiiStdSpec): string {
  const badge = spec.category === "Foundry Layer" ? "LAYER" : "CELL";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="52" viewBox="0 0 88 52">`,
    `  <rect x="2" y="2" width="84" height="48" rx="6" fill="#0f172a" stroke="${spec.color}" stroke-width="2" />`,
    `  <rect x="6" y="6" width="76" height="12" rx="3" fill="${spec.color}" fill-opacity="0.22" />`,
    `  <text x="44" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${spec.color}">${badge}</text>`,
    `  <text x="44" y="34" text-anchor="middle" font-family="monospace" font-size="10.5" font-weight="bold" fill="#f8fafc">${spec.name}</text>`,
    `</svg>`,
  ].join("\n");
}

/**
 * Builds the declarative `CleanroomModelSchema[]` array for `@modelscript/gdsii-std-lib`.
 */
export function buildGdsiiCleanroomSchemas(): CleanroomModelSchema[] {
  return GDSII_STD_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit: unit ?? "",
      description: description ?? "",
    }));

    return {
      namePath: `GDSII.${spec.category === "Foundry Layer" ? "Layers" : "Cells"}.${spec.name}`,
      name: spec.name,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "semiconductor",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 88,
      height: 52,
      svg: generateGdsiiBlockSvg(spec),
      ports: spec.ports ?? [],
      parameters,
      wasmKernel: "gdsiiElmoreDelayPs",
      extra: {
        archetypeId: spec.archetypeId,
        color: spec.color,
      },
    };
  });
}

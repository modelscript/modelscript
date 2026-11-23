// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * EDIF 2.0.0 cleanroom GENERIC cell archetype IDs matching `assets/edif-std-lib/src/models.ts`.
 */
export const EdifArchetypeId = {
  // Passives & Sources
  RES: 1,
  CAP: 2,
  IND: 3,
  GND: 4,
  VCC: 5,
  // Digital Logic Gates & Sequential
  AND2: 10,
  OR2: 11,
  NAND2: 12,
  NOR2: 13,
  INV: 14,
  XOR2: 15,
  DFF: 16,
} as const;

export type EdifArchetypeId = (typeof EdifArchetypeId)[keyof typeof EdifArchetypeId];

export type EdifCellCategory = "Passive" | "Supply" | "Combinational" | "Sequential";

export interface EdifStdCellSpec {
  cellName: string;
  aliases?: string[];
  label: string;
  category: EdifCellCategory;
  archetypeId: EdifArchetypeId;
  description: string;
  provenance: string;
  ports: DiagramPortSpec[];
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<EdifCellCategory, { fill: string; stroke: string; badge: string }> = {
  Passive: { fill: "#1e3a5f", stroke: "#60a5fa", badge: "PASS" },
  Supply: { fill: "#3b2247", stroke: "#c084fc", badge: "PWR" },
  Combinational: { fill: "#163b3b", stroke: "#2dd4bf", badge: "GATE" },
  Sequential: { fill: "#4a2c1d", stroke: "#fb923c", badge: "SEQ" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for an EDIF GENERIC cell.
 */
export function generateEdifBlockSvg(cellName: string, category: EdifCellCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = cellName.toUpperCase().slice(0, 8);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="30" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="21" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

/**
 * Canonical 12 standard EDIF 2.0.0 GENERIC library cell specifications.
 */
export const EDIF_STD_CELL_SPECS: readonly EdifStdCellSpec[] = [
  {
    cellName: "RES",
    aliases: ["RESISTOR", "R"],
    label: "Resistor (RES)",
    category: "Passive",
    archetypeId: EdifArchetypeId.RES,
    description: "Two-terminal linear Ohm's law resistor (V = I * R).",
    provenance: "EIA-548 / EDIF 2.0.0 GENERIC Standard Library",
    ports: [
      { name: "P", kind: "electrical", side: "left", dx: 0, dy: 26 },
      { name: "N", kind: "electrical", side: "right", dx: 88, dy: 26 },
    ],
    params: [["R", 1000, "Ohm", "Electrical resistance"]],
  },
  {
    cellName: "CAP",
    aliases: ["CAPACITOR", "C"],
    label: "Capacitor (CAP)",
    category: "Passive",
    archetypeId: EdifArchetypeId.CAP,
    description: "Two-terminal linear capacitor (I = C * dV/dt).",
    provenance: "EIA-548 / EDIF 2.0.0 GENERIC Standard Library",
    ports: [
      { name: "P", kind: "electrical", side: "left", dx: 0, dy: 26 },
      { name: "N", kind: "electrical", side: "right", dx: 88, dy: 26 },
    ],
    params: [["C", 1e-6, "F", "Electrical capacitance"]],
  },
  {
    cellName: "IND",
    aliases: ["INDUCTOR", "L"],
    label: "Inductor (IND)",
    category: "Passive",
    archetypeId: EdifArchetypeId.IND,
    description: "Two-terminal linear inductor (V = L * dI/dt).",
    provenance: "EIA-548 / EDIF 2.0.0 GENERIC Standard Library",
    ports: [
      { name: "P", kind: "electrical", side: "left", dx: 0, dy: 26 },
      { name: "N", kind: "electrical", side: "right", dx: 88, dy: 26 },
    ],
    params: [["L", 1e-3, "H", "Electrical inductance"]],
  },
  {
    cellName: "GND",
    aliases: ["GROUND", "VSS", "0"],
    label: "Ground Reference (GND)",
    category: "Supply",
    archetypeId: EdifArchetypeId.GND,
    description: "Zero-volt electrical reference node (V = 0 V).",
    provenance: "EIA-548 / EDIF 2.0.0 GENERIC Standard Library",
    ports: [{ name: "P", kind: "electrical", side: "top", dx: 44, dy: 0 }],
    params: [["V", 0, "V", "Reference potential"]],
  },
  {
    cellName: "VCC",
    aliases: ["VDD", "PWR", "SUPPLY"],
    label: "DC Supply Rail (VCC)",
    category: "Supply",
    archetypeId: EdifArchetypeId.VCC,
    description: "Ideal DC supply voltage rail (default V = 5.0 V).",
    provenance: "EIA-548 / EDIF 2.0.0 GENERIC Standard Library",
    ports: [{ name: "P", kind: "electrical", side: "bottom", dx: 44, dy: 52 }],
    params: [["V", 5.0, "V", "Supply voltage"]],
  },
  {
    cellName: "AND2",
    aliases: ["AND"],
    label: "2-Input AND Gate",
    category: "Combinational",
    archetypeId: EdifArchetypeId.AND2,
    description: "Two-input logical conjunction gate (Y = A & B).",
    provenance: "EIA-548 / EDIF 2.0.0 GENERIC Standard Library",
    ports: [
      { name: "A", kind: "digital", side: "left", dx: 0, dy: 16 },
      { name: "B", kind: "digital", side: "left", dx: 0, dy: 36 },
      { name: "Y", kind: "digital", side: "right", dx: 88, dy: 26 },
    ],
    params: [["VDD", 5.0, "V", "Logic high voltage"]],
  },
  {
    cellName: "OR2",
    aliases: ["OR"],
    label: "2-Input OR Gate",
    category: "Combinational",
    archetypeId: EdifArchetypeId.OR2,
    description: "Two-input logical disjunction gate (Y = A | B).",
    provenance: "EIA-548 / EDIF 2.0.0 GENERIC Standard Library",
    ports: [
      { name: "A", kind: "digital", side: "left", dx: 0, dy: 16 },
      { name: "B", kind: "digital", side: "left", dx: 0, dy: 36 },
      { name: "Y", kind: "digital", side: "right", dx: 88, dy: 26 },
    ],
    params: [["VDD", 5.0, "V", "Logic high voltage"]],
  },
  {
    cellName: "NAND2",
    aliases: ["NAND"],
    label: "2-Input NAND Gate",
    category: "Combinational",
    archetypeId: EdifArchetypeId.NAND2,
    description: "Two-input logical NAND gate (Y = ~(A & B)).",
    provenance: "EIA-548 / EDIF 2.0.0 GENERIC Standard Library",
    ports: [
      { name: "A", kind: "digital", side: "left", dx: 0, dy: 16 },
      { name: "B", kind: "digital", side: "left", dx: 0, dy: 36 },
      { name: "Y", kind: "digital", side: "right", dx: 88, dy: 26 },
    ],
    params: [["VDD", 5.0, "V", "Logic high voltage"]],
  },
  {
    cellName: "NOR2",
    aliases: ["NOR"],
    label: "2-Input NOR Gate",
    category: "Combinational",
    archetypeId: EdifArchetypeId.NOR2,
    description: "Two-input logical NOR gate (Y = ~(A | B)).",
    provenance: "EIA-548 / EDIF 2.0.0 GENERIC Standard Library",
    ports: [
      { name: "A", kind: "digital", side: "left", dx: 0, dy: 16 },
      { name: "B", kind: "digital", side: "left", dx: 0, dy: 36 },
      { name: "Y", kind: "digital", side: "right", dx: 88, dy: 26 },
    ],
    params: [["VDD", 5.0, "V", "Logic high voltage"]],
  },
  {
    cellName: "INV",
    aliases: ["NOT", "INVERTER"],
    label: "Inverter (INV)",
    category: "Combinational",
    archetypeId: EdifArchetypeId.INV,
    description: "Single-input logical inverter (Y = ~A).",
    provenance: "EIA-548 / EDIF 2.0.0 GENERIC Standard Library",
    ports: [
      { name: "A", kind: "digital", side: "left", dx: 0, dy: 26 },
      { name: "Y", kind: "digital", side: "right", dx: 88, dy: 26 },
    ],
    params: [["VDD", 5.0, "V", "Logic high voltage"]],
  },
  {
    cellName: "XOR2",
    aliases: ["XOR"],
    label: "2-Input XOR Gate",
    category: "Combinational",
    archetypeId: EdifArchetypeId.XOR2,
    description: "Two-input exclusive-OR gate (Y = A ^ B).",
    provenance: "EIA-548 / EDIF 2.0.0 GENERIC Standard Library",
    ports: [
      { name: "A", kind: "digital", side: "left", dx: 0, dy: 16 },
      { name: "B", kind: "digital", side: "left", dx: 0, dy: 36 },
      { name: "Y", kind: "digital", side: "right", dx: 88, dy: 26 },
    ],
    params: [["VDD", 5.0, "V", "Logic high voltage"]],
  },
  {
    cellName: "DFF",
    aliases: ["D_FF", "FLIPFLOP"],
    label: "D Flip-Flop (DFF)",
    category: "Sequential",
    archetypeId: EdifArchetypeId.DFF,
    description: "Positive-edge-triggered D flip-flop with Q output.",
    provenance: "EIA-548 / EDIF 2.0.0 GENERIC Standard Library",
    ports: [
      { name: "D", kind: "digital", side: "left", dx: 0, dy: 16 },
      { name: "CLK", kind: "digital", side: "left", dx: 0, dy: 36 },
      { name: "Q", kind: "digital", side: "right", dx: 88, dy: 26 },
    ],
    params: [
      ["VDD", 5.0, "V", "Logic high voltage"],
      ["Q0", 0.0, "", "Initial state"],
    ],
  },
];

/**
 * Builds the `CleanroomModelSchema[]` array for `@modelscript/edif-std-lib`.
 */
export function buildEdifCleanroomSchemas(): CleanroomModelSchema[] {
  return EDIF_STD_CELL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real" as const,
      defaultValue,
      unit,
      description,
    }));

    return {
      namePath: `GENERIC.${spec.cellName}`,
      name: spec.cellName,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "electronics",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Cell",
      width: 88,
      height: 52,
      svg: generateEdifBlockSvg(spec.cellName, spec.category),
      ports: spec.ports,
      parameters,
      wasmKernel: "edif_eval",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}

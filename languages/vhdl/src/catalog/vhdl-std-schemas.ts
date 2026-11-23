// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * VHDL cleanroom standard library archetype IDs matching `assets/vhdl-std-lib/src/models.ts`.
 */
export const VhdlArchetypeId = {
  // STD.STANDARD
  STD_BIT: 1,
  STD_BIT_VECTOR: 2,
  STD_BOOLEAN: 3,
  STD_INTEGER: 4,
  STD_NATURAL: 5,
  STD_POSITIVE: 6,
  STD_TIME: 7,
  // IEEE.STD_LOGIC_1164
  STD_ULOGIC: 10,
  STD_LOGIC: 11,
  STD_LOGIC_VECTOR: 12,
  RESOLVED: 13,
  RISING_EDGE: 14,
  FALLING_EDGE: 15,
  // IEEE.NUMERIC_STD
  UNSIGNED: 20,
  SIGNED: 21,
  TO_UNSIGNED: 22,
  TO_INTEGER: 23,
  ADD_UNSIGNED: 24,
  SUB_UNSIGNED: 25,
  // Primitive Gates & Sequential Elements
  AND2: 30,
  OR2: 31,
  XOR2: 32,
  NAND2: 33,
  NOR2: 34,
  INV: 35,
  MUX2: 36,
  FA1: 37,
  DFF: 38,
  REG4: 39,
} as const;

export type VhdlArchetypeId = (typeof VhdlArchetypeId)[keyof typeof VhdlArchetypeId];

export type VhdlStdCategory =
  "STD.STANDARD" | "IEEE.STD_LOGIC_1164" | "IEEE.NUMERIC_STD" | "Logic Gates" | "Sequential";

export interface VhdlStdSpec {
  namePath: string;
  name: string;
  aliases?: string[];
  label: string;
  category: VhdlStdCategory;
  archetypeId: VhdlArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<VhdlStdCategory, { fill: string; stroke: string; badge: string }> = {
  "STD.STANDARD": { fill: "#1e293b", stroke: "#94a3b8", badge: "STD" },
  "IEEE.STD_LOGIC_1164": { fill: "#1e3a5f", stroke: "#38bdf8", badge: "1164" },
  "IEEE.NUMERIC_STD": { fill: "#163b3b", stroke: "#2dd4bf", badge: "NUM" },
  "Logic Gates": { fill: "#2e2447", stroke: "#c084fc", badge: "GATE" },
  Sequential: { fill: "#4a1d1d", stroke: "#fb923c", badge: "SEQ" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for a VHDL stdlib symbol.
 */
export function generateVhdlBlockSvg(name: string, category: VhdlStdCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = name.toUpperCase().slice(0, 11);
  const fontSize = label.length > 8 ? "8.0" : "9.5";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="30" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="21" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: VhdlStdSpec): DiagramPortSpec[] {
  if (spec.name === "INV") {
    return [
      { name: "a", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "y", kind: "signal", side: "right", dx: 88, dy: 26 },
    ];
  }
  if (spec.name === "MUX2") {
    return [
      { name: "d0", kind: "signal", side: "left", dx: 0, dy: 14 },
      { name: "d1", kind: "signal", side: "left", dx: 0, dy: 34 },
      { name: "sel", kind: "signal", side: "bottom", dx: 44, dy: 52 },
      { name: "y", kind: "signal", side: "right", dx: 88, dy: 26 },
    ];
  }
  if (spec.name === "FA1") {
    return [
      { name: "a", kind: "signal", side: "left", dx: 0, dy: 12 },
      { name: "b", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "cin", kind: "signal", side: "left", dx: 0, dy: 40 },
      { name: "sum", kind: "signal", side: "right", dx: 88, dy: 18 },
      { name: "cout", kind: "signal", side: "right", dx: 88, dy: 36 },
    ];
  }
  if (spec.name === "DFF" || spec.name === "REG4") {
    return [
      { name: "clk", kind: "signal", side: "left", dx: 0, dy: 14 },
      { name: "rst", kind: "signal", side: "bottom", dx: 44, dy: 52 },
      { name: "d", kind: "signal", side: "left", dx: 0, dy: 36 },
      { name: "q", kind: "signal", side: "right", dx: 88, dy: 26 },
    ];
  }
  return [
    { name: "a", kind: "signal", side: "left", dx: 0, dy: 16 },
    { name: "b", kind: "signal", side: "left", dx: 0, dy: 36 },
    { name: "y", kind: "signal", side: "right", dx: 88, dy: 26 },
  ];
}

export const VHDL_STD_SPECS: VhdlStdSpec[] = [
  // STD.STANDARD
  {
    namePath: "STD.STANDARD.BIT",
    name: "BIT",
    aliases: ["std.standard.bit"],
    label: "BIT",
    category: "STD.STANDARD",
    archetypeId: VhdlArchetypeId.STD_BIT,
    description: "IEEE 1076-1987 unresolved 2-value binary enumeration ('0', '1').",
    provenance: "IEEE Std 1076-1987 Clause 14.2 (STD.STANDARD)",
    params: [["width", 1, "bit", "Scalar bit width"]],
  },
  {
    namePath: "STD.STANDARD.BIT_VECTOR",
    name: "BIT_VECTOR",
    aliases: ["std.standard.bit_vector"],
    label: "BIT_VECTOR",
    category: "STD.STANDARD",
    archetypeId: VhdlArchetypeId.STD_BIT_VECTOR,
    description: "Unconstrained array of STD.STANDARD.BIT indexed by NATURAL.",
    provenance: "IEEE Std 1076-1987 Clause 14.2 (STD.STANDARD)",
    params: [["width", 8, "bit", "Vector bit width"]],
  },
  {
    namePath: "STD.STANDARD.BOOLEAN",
    name: "BOOLEAN",
    aliases: ["std.standard.boolean"],
    label: "BOOLEAN",
    category: "STD.STANDARD",
    archetypeId: VhdlArchetypeId.STD_BOOLEAN,
    description: "Predefined enumeration type (FALSE, TRUE).",
    provenance: "IEEE Std 1076-1987 Clause 14.2 (STD.STANDARD)",
    params: [["default", 0, "bool", "Default value (FALSE)"]],
  },
  {
    namePath: "STD.STANDARD.INTEGER",
    name: "INTEGER",
    aliases: ["std.standard.integer"],
    label: "INTEGER",
    category: "STD.STANDARD",
    archetypeId: VhdlArchetypeId.STD_INTEGER,
    description: "Predefined 32-bit signed integer type (-2147483647 to 2147483647).",
    provenance: "IEEE Std 1076-1987 Clause 14.2 (STD.STANDARD)",
    params: [["bits", 32, "bit", "Signed integer width"]],
  },
  {
    namePath: "STD.STANDARD.NATURAL",
    name: "NATURAL",
    aliases: ["std.standard.natural"],
    label: "NATURAL",
    category: "STD.STANDARD",
    archetypeId: VhdlArchetypeId.STD_NATURAL,
    description: "Subtype of INTEGER constrained to range 0 to INTEGER'HIGH.",
    provenance: "IEEE Std 1076-1987 Clause 14.2 (STD.STANDARD)",
    params: [["min", 0, "int", "Minimum value"]],
  },
  {
    namePath: "STD.STANDARD.POSITIVE",
    name: "POSITIVE",
    aliases: ["std.standard.positive"],
    label: "POSITIVE",
    category: "STD.STANDARD",
    archetypeId: VhdlArchetypeId.STD_POSITIVE,
    description: "Subtype of INTEGER constrained to range 1 to INTEGER'HIGH.",
    provenance: "IEEE Std 1076-1987 Clause 14.2 (STD.STANDARD)",
    params: [["min", 1, "int", "Minimum value"]],
  },
  {
    namePath: "STD.STANDARD.TIME",
    name: "TIME",
    aliases: ["std.standard.time"],
    label: "TIME",
    category: "STD.STANDARD",
    archetypeId: VhdlArchetypeId.STD_TIME,
    description: "Predefined physical type for simulation time (fs, ps, ns, us, ms, sec).",
    provenance: "IEEE Std 1076-1987 Clause 14.2 (STD.STANDARD)",
    params: [["resolutionPs", 1, "ps", "Base time resolution"]],
  },
  // IEEE.STD_LOGIC_1164
  {
    namePath: "IEEE.STD_LOGIC_1164.STD_ULOGIC",
    name: "STD_ULOGIC",
    aliases: ["ieee.std_logic_1164.std_ulogic"],
    label: "STD_ULOGIC",
    category: "IEEE.STD_LOGIC_1164",
    archetypeId: VhdlArchetypeId.STD_ULOGIC,
    description: "Unresolved 9-value logic enumeration ('U','X','0','1','Z','W','L','H','-').",
    provenance: "IEEE Std 1164-1993 (Multivalue Logic System)",
    params: [["states", 9, "enum", "Number of logic states"]],
  },
  {
    namePath: "IEEE.STD_LOGIC_1164.STD_LOGIC",
    name: "STD_LOGIC",
    aliases: ["ieee.std_logic_1164.std_logic"],
    label: "STD_LOGIC",
    category: "IEEE.STD_LOGIC_1164",
    archetypeId: VhdlArchetypeId.STD_LOGIC,
    description: "Resolved 9-value logic subtype using IEEE 1164 RESOLVED resolution function.",
    provenance: "IEEE Std 1164-1993 (Multivalue Logic System)",
    params: [["states", 9, "enum", "Number of logic states"]],
  },
  {
    namePath: "IEEE.STD_LOGIC_1164.STD_LOGIC_VECTOR",
    name: "STD_LOGIC_VECTOR",
    aliases: ["ieee.std_logic_1164.std_logic_vector"],
    label: "STD_LOGIC_VECTOR",
    category: "IEEE.STD_LOGIC_1164",
    archetypeId: VhdlArchetypeId.STD_LOGIC_VECTOR,
    description: "Unconstrained array of resolved STD_LOGIC indexed by NATURAL.",
    provenance: "IEEE Std 1164-1993 (Multivalue Logic System)",
    params: [["width", 8, "bit", "Default bus width"]],
  },
  {
    namePath: "IEEE.STD_LOGIC_1164.RESOLVED",
    name: "RESOLVED",
    aliases: ["ieee.std_logic_1164.resolved"],
    label: "RESOLVED",
    category: "IEEE.STD_LOGIC_1164",
    archetypeId: VhdlArchetypeId.RESOLVED,
    description: "IEEE 1164 9x9 symmetric resolution function for multi-driver STD_LOGIC nets.",
    provenance: "IEEE Std 1164-1993 Resolution Table",
    params: [["tableSize", 81, "entries", "9x9 resolution matrix"]],
  },
  {
    namePath: "IEEE.STD_LOGIC_1164.RISING_EDGE",
    name: "RISING_EDGE",
    aliases: ["ieee.std_logic_1164.rising_edge"],
    label: "RISING_EDGE",
    category: "IEEE.STD_LOGIC_1164",
    archetypeId: VhdlArchetypeId.RISING_EDGE,
    description: "Detects '0'/'L' to '1'/'H' rising clock transition on STD_ULOGIC.",
    provenance: "IEEE Std 1164-1993 Edge Detection",
    params: [["polarity", 1, "edge", "Rising edge polarity"]],
  },
  {
    namePath: "IEEE.STD_LOGIC_1164.FALLING_EDGE",
    name: "FALLING_EDGE",
    aliases: ["ieee.std_logic_1164.falling_edge"],
    label: "FALLING_EDGE",
    category: "IEEE.STD_LOGIC_1164",
    archetypeId: VhdlArchetypeId.FALLING_EDGE,
    description: "Detects '1'/'H' to '0'/'L' falling clock transition on STD_ULOGIC.",
    provenance: "IEEE Std 1164-1993 Edge Detection",
    params: [["polarity", 0, "edge", "Falling edge polarity"]],
  },
  // IEEE.NUMERIC_STD
  {
    namePath: "IEEE.NUMERIC_STD.UNSIGNED",
    name: "UNSIGNED",
    aliases: ["ieee.numeric_std.unsigned"],
    label: "UNSIGNED",
    category: "IEEE.NUMERIC_STD",
    archetypeId: VhdlArchetypeId.UNSIGNED,
    description: "Unsigned binary integer vector of STD_LOGIC elements.",
    provenance: "IEEE Std 1076.3-1997 (NUMERIC_STD)",
    params: [["width", 8, "bit", "Vector width"]],
  },
  {
    namePath: "IEEE.NUMERIC_STD.SIGNED",
    name: "SIGNED",
    aliases: ["ieee.numeric_std.signed"],
    label: "SIGNED",
    category: "IEEE.NUMERIC_STD",
    archetypeId: VhdlArchetypeId.SIGNED,
    description: "Two's-complement signed binary integer vector of STD_LOGIC elements.",
    provenance: "IEEE Std 1076.3-1997 (NUMERIC_STD)",
    params: [["width", 8, "bit", "Vector width"]],
  },
  {
    namePath: "IEEE.NUMERIC_STD.TO_UNSIGNED",
    name: "TO_UNSIGNED",
    aliases: ["ieee.numeric_std.to_unsigned"],
    label: "TO_UNSIGNED",
    category: "IEEE.NUMERIC_STD",
    archetypeId: VhdlArchetypeId.TO_UNSIGNED,
    description: "Converts a NATURAL integer to an N-bit UNSIGNED vector.",
    provenance: "IEEE Std 1076.3-1997 (NUMERIC_STD)",
    params: [["width", 4, "bit", "Target vector width"]],
  },
  {
    namePath: "IEEE.NUMERIC_STD.TO_INTEGER",
    name: "TO_INTEGER",
    aliases: ["ieee.numeric_std.to_integer"],
    label: "TO_INTEGER",
    category: "IEEE.NUMERIC_STD",
    archetypeId: VhdlArchetypeId.TO_INTEGER,
    description: "Converts UNSIGNED or SIGNED vector to STD.STANDARD.INTEGER.",
    provenance: "IEEE Std 1076.3-1997 (NUMERIC_STD)",
    params: [["width", 4, "bit", "Source vector width"]],
  },
  {
    namePath: "IEEE.NUMERIC_STD.ADD_UNSIGNED",
    name: "ADD_UNSIGNED",
    aliases: ["add_u"],
    label: "ADD_UNSIGNED",
    category: "IEEE.NUMERIC_STD",
    archetypeId: VhdlArchetypeId.ADD_UNSIGNED,
    description: "Modular unsigned addition on N-bit vectors.",
    provenance: "IEEE Std 1076.3-1997 (NUMERIC_STD)",
    params: [["width", 4, "bit", "Operand width"]],
  },
  {
    namePath: "IEEE.NUMERIC_STD.SUB_UNSIGNED",
    name: "SUB_UNSIGNED",
    aliases: ["sub_u"],
    label: "SUB_UNSIGNED",
    category: "IEEE.NUMERIC_STD",
    archetypeId: VhdlArchetypeId.SUB_UNSIGNED,
    description: "Modular unsigned subtraction on N-bit vectors.",
    provenance: "IEEE Std 1076.3-1997 (NUMERIC_STD)",
    params: [["width", 4, "bit", "Operand width"]],
  },
  // Cleanroom Primitive Logic Gates & Sequential Elements
  {
    namePath: "VHDL.GATES.AND2",
    name: "AND2",
    aliases: ["and_gate", "and2"],
    label: "AND2",
    category: "Logic Gates",
    archetypeId: VhdlArchetypeId.AND2,
    description: "2-input IEEE 1164 9-value AND gate.",
    provenance: "IEEE Std 1164-1993 Truth Table",
    params: [["tpdNs", 1.0, "ns", "Propagation delay"]],
  },
  {
    namePath: "VHDL.GATES.OR2",
    name: "OR2",
    aliases: ["or_gate", "or2"],
    label: "OR2",
    category: "Logic Gates",
    archetypeId: VhdlArchetypeId.OR2,
    description: "2-input IEEE 1164 9-value OR gate.",
    provenance: "IEEE Std 1164-1993 Truth Table",
    params: [["tpdNs", 1.0, "ns", "Propagation delay"]],
  },
  {
    namePath: "VHDL.GATES.XOR2",
    name: "XOR2",
    aliases: ["xor_gate", "xor2"],
    label: "XOR2",
    category: "Logic Gates",
    archetypeId: VhdlArchetypeId.XOR2,
    description: "2-input IEEE 1164 9-value XOR gate.",
    provenance: "IEEE Std 1164-1993 Truth Table",
    params: [["tpdNs", 1.2, "ns", "Propagation delay"]],
  },
  {
    namePath: "VHDL.GATES.NAND2",
    name: "NAND2",
    aliases: ["nand_gate", "nand2"],
    label: "NAND2",
    category: "Logic Gates",
    archetypeId: VhdlArchetypeId.NAND2,
    description: "2-input IEEE 1164 9-value NAND gate.",
    provenance: "IEEE Std 1164-1993 Truth Table",
    params: [["tpdNs", 0.8, "ns", "Propagation delay"]],
  },
  {
    namePath: "VHDL.GATES.NOR2",
    name: "NOR2",
    aliases: ["nor_gate", "nor2"],
    label: "NOR2",
    category: "Logic Gates",
    archetypeId: VhdlArchetypeId.NOR2,
    description: "2-input IEEE 1164 9-value NOR gate.",
    provenance: "IEEE Std 1164-1993 Truth Table",
    params: [["tpdNs", 0.8, "ns", "Propagation delay"]],
  },
  {
    namePath: "VHDL.GATES.INV",
    name: "INV",
    aliases: ["not_gate", "inverter"],
    label: "INV",
    category: "Logic Gates",
    archetypeId: VhdlArchetypeId.INV,
    description: "IEEE 1164 9-value inverter (NOT gate).",
    provenance: "IEEE Std 1164-1993 Truth Table",
    params: [["tpdNs", 0.5, "ns", "Propagation delay"]],
  },
  {
    namePath: "VHDL.GATES.MUX2",
    name: "MUX2",
    aliases: ["mux2_1", "multiplexer"],
    label: "MUX2",
    category: "Logic Gates",
    archetypeId: VhdlArchetypeId.MUX2,
    description: "2-to-1 IEEE 1164 9-value multiplexer.",
    provenance: "IEEE Std 1076-1987 Combinational Logic",
    params: [["tpdNs", 1.5, "ns", "Propagation delay"]],
  },
  {
    namePath: "VHDL.GATES.FA1",
    name: "FA1",
    aliases: ["full_adder", "full_adder_1bit"],
    label: "FA1",
    category: "Logic Gates",
    archetypeId: VhdlArchetypeId.FA1,
    description: "1-bit full adder producing sum and carry-out.",
    provenance: "IEEE Std 1076-1987 Arithmetic Primitives",
    params: [["tpdNs", 2.0, "ns", "Propagation delay"]],
  },
  {
    namePath: "VHDL.SEQ.DFF",
    name: "DFF",
    aliases: ["d_flip_flop", "dff"],
    label: "DFF",
    category: "Sequential",
    archetypeId: VhdlArchetypeId.DFF,
    description: "Rising-edge triggered D flip-flop with synchronous/asynchronous reset.",
    provenance: "IEEE Std 1076-1987 Sequential Logic",
    params: [["tcoNs", 1.0, "ns", "Clock-to-Q delay"]],
  },
  {
    namePath: "VHDL.SEQ.REG4",
    name: "REG4",
    aliases: ["register4", "reg4"],
    label: "REG4",
    category: "Sequential",
    archetypeId: VhdlArchetypeId.REG4,
    description: "4-bit rising-edge triggered register with reset.",
    provenance: "IEEE Std 1076-1987 Sequential Logic",
    params: [
      ["width", 4, "bit", "Register width"],
      ["tcoNs", 1.2, "ns", "Clock-to-Q delay"],
    ],
  },
];

/**
 * Builds `CleanroomModelSchema[]` for `@modelscript/vhdl-std-lib`.
 */
export function buildVhdlCleanroomSchemas(): CleanroomModelSchema[] {
  return VHDL_STD_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: Number.isInteger(defaultValue) ? "integer" : "real",
      defaultValue,
      unit,
      description,
    }));

    return {
      namePath: spec.namePath,
      name: spec.name,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "digital",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 88,
      height: 52,
      svg: generateVhdlBlockSvg(spec.name, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: "vhdlStdEval",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}

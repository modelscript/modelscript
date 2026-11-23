// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom IEEE 1364 Verilog primitive & RTL block archetype IDs
 * matching `assets/verilog-std-lib/src/models.ts`.
 */
export const VerilogArchetypeId = {
  // IEEE 1364 Built-in Gate Primitives
  AND: 1,
  NAND: 2,
  OR: 3,
  NOR: 4,
  XOR: 5,
  XNOR: 6,
  BUF: 7,
  NOT: 8,
  BUFIF0: 9,
  BUFIF1: 10,
  NOTIF0: 11,
  NOTIF1: 12,
  // Standard Sequential & Combinational Building Blocks
  DFF: 20,
  DFFR: 21,
  DFFE: 22,
  DLATCH: 23,
  MUX2: 30,
  MUX4: 31,
  HALF_ADDER: 40,
  FULL_ADDER: 41,
  ALU4: 42,
  SHIFT_REG: 50,
  LFSR7: 51,
  COUNTER: 52,
} as const;

export type VerilogArchetypeId = (typeof VerilogArchetypeId)[keyof typeof VerilogArchetypeId];

export type VerilogModelCategory =
  | "Logic Gates"
  | "Tri-State Buffers"
  | "Sequential Elements"
  | "Multiplexers"
  | "Arithmetic & ALU"
  | "Registers & Counters";

export interface VerilogModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: VerilogModelCategory;
  archetypeId: VerilogArchetypeId;
  description: string;
  provenance: string;
  ports: DiagramPortSpec[];
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<VerilogModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Logic Gates": { fill: "#1e293b", stroke: "#38bdf8", badge: "GATE" },
  "Tri-State Buffers": { fill: "#2e1f47", stroke: "#c084fc", badge: "TRI" },
  "Sequential Elements": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "SEQ" },
  Multiplexers: { fill: "#163b3b", stroke: "#2dd4bf", badge: "MUX" },
  "Arithmetic & ALU": { fill: "#4a2511", stroke: "#f97316", badge: "ALU" },
  "Registers & Counters": { fill: "#1e3f2f", stroke: "#34d399", badge: "REG" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for a Verilog primitive or RTL block.
 */
export function generateVerilogBlockSvg(modelType: string, category: VerilogModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 10);
  const fontSize = label.length > 7 ? "8.2" : "9.5";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

const TWO_IN_GATE_PORTS: DiagramPortSpec[] = [
  { name: "a", kind: "signal", side: "left", dx: 0, dy: 16 },
  { name: "b", kind: "signal", side: "left", dx: 0, dy: 36 },
  { name: "y", kind: "signal", side: "right", dx: 88, dy: 26 },
];

const ONE_IN_GATE_PORTS: DiagramPortSpec[] = [
  { name: "a", kind: "signal", side: "left", dx: 0, dy: 26 },
  { name: "y", kind: "signal", side: "right", dx: 88, dy: 26 },
];

const TRISTATE_GATE_PORTS: DiagramPortSpec[] = [
  { name: "a", kind: "signal", side: "left", dx: 0, dy: 18 },
  { name: "en", kind: "signal", side: "bottom", dx: 44, dy: 52 },
  { name: "y", kind: "signal", side: "right", dx: 88, dy: 26 },
];

export const VERILOG_MODEL_SPECS: readonly VerilogModelSpec[] = [
  // ── IEEE 1364 Built-in Gate Primitives ──────────────────────────────────
  {
    modelType: "and",
    aliases: ["AND2", "AND_GATE"],
    label: "AND Gate",
    category: "Logic Gates",
    archetypeId: VerilogArchetypeId.AND,
    description: "IEEE 1364 built-in 4-state N-input AND gate primitive (controlling value 0).",
    provenance: "IEEE Std 1364-2001 §7.2",
    ports: TWO_IN_GATE_PORTS,
    params: [["DELAY", 0, "ns", "Propagation delay"]],
  },
  {
    modelType: "nand",
    aliases: ["NAND2", "NAND_GATE"],
    label: "NAND Gate",
    category: "Logic Gates",
    archetypeId: VerilogArchetypeId.NAND,
    description: "IEEE 1364 built-in 4-state N-input NAND gate primitive.",
    provenance: "IEEE Std 1364-2001 §7.2",
    ports: TWO_IN_GATE_PORTS,
    params: [["DELAY", 0, "ns", "Propagation delay"]],
  },
  {
    modelType: "or",
    aliases: ["OR2", "OR_GATE"],
    label: "OR Gate",
    category: "Logic Gates",
    archetypeId: VerilogArchetypeId.OR,
    description: "IEEE 1364 built-in 4-state N-input OR gate primitive (controlling value 1).",
    provenance: "IEEE Std 1364-2001 §7.2",
    ports: TWO_IN_GATE_PORTS,
    params: [["DELAY", 0, "ns", "Propagation delay"]],
  },
  {
    modelType: "nor",
    aliases: ["NOR2", "NOR_GATE"],
    label: "NOR Gate",
    category: "Logic Gates",
    archetypeId: VerilogArchetypeId.NOR,
    description: "IEEE 1364 built-in 4-state N-input NOR gate primitive.",
    provenance: "IEEE Std 1364-2001 §7.2",
    ports: TWO_IN_GATE_PORTS,
    params: [["DELAY", 0, "ns", "Propagation delay"]],
  },
  {
    modelType: "xor",
    aliases: ["XOR2", "XOR_GATE"],
    label: "XOR Gate",
    category: "Logic Gates",
    archetypeId: VerilogArchetypeId.XOR,
    description: "IEEE 1364 built-in 4-state N-input XOR gate primitive.",
    provenance: "IEEE Std 1364-2001 §7.2",
    ports: TWO_IN_GATE_PORTS,
    params: [["DELAY", 0, "ns", "Propagation delay"]],
  },
  {
    modelType: "xnor",
    aliases: ["XNOR2", "XNOR_GATE"],
    label: "XNOR Gate",
    category: "Logic Gates",
    archetypeId: VerilogArchetypeId.XNOR,
    description: "IEEE 1364 built-in 4-state N-input XNOR gate primitive.",
    provenance: "IEEE Std 1364-2001 §7.2",
    ports: TWO_IN_GATE_PORTS,
    params: [["DELAY", 0, "ns", "Propagation delay"]],
  },
  {
    modelType: "buf",
    aliases: ["BUFFER"],
    label: "Buffer",
    category: "Logic Gates",
    archetypeId: VerilogArchetypeId.BUF,
    description: "IEEE 1364 built-in 4-state non-inverting buffer primitive (maps Z -> X).",
    provenance: "IEEE Std 1364-2001 §7.3",
    ports: ONE_IN_GATE_PORTS,
    params: [["DELAY", 0, "ns", "Propagation delay"]],
  },
  {
    modelType: "not",
    aliases: ["INV", "INVERTER"],
    label: "Inverter (NOT)",
    category: "Logic Gates",
    archetypeId: VerilogArchetypeId.NOT,
    description: "IEEE 1364 built-in 4-state inverting gate primitive.",
    provenance: "IEEE Std 1364-2001 §7.3",
    ports: ONE_IN_GATE_PORTS,
    params: [["DELAY", 0, "ns", "Propagation delay"]],
  },
  {
    modelType: "bufif0",
    aliases: ["TRISTATE_BUF_L"],
    label: "Tri-State Buffer (Active-Low)",
    category: "Tri-State Buffers",
    archetypeId: VerilogArchetypeId.BUFIF0,
    description: "IEEE 1364 tri-state non-inverting buffer enabled when control is 0; drives Z when control is 1.",
    provenance: "IEEE Std 1364-2001 §7.4",
    ports: TRISTATE_GATE_PORTS,
    params: [["DELAY", 0, "ns", "Propagation delay"]],
  },
  {
    modelType: "bufif1",
    aliases: ["TRISTATE_BUF_H"],
    label: "Tri-State Buffer (Active-High)",
    category: "Tri-State Buffers",
    archetypeId: VerilogArchetypeId.BUFIF1,
    description: "IEEE 1364 tri-state non-inverting buffer enabled when control is 1; drives Z when control is 0.",
    provenance: "IEEE Std 1364-2001 §7.4",
    ports: TRISTATE_GATE_PORTS,
    params: [["DELAY", 0, "ns", "Propagation delay"]],
  },
  {
    modelType: "notif0",
    aliases: ["TRISTATE_INV_L"],
    label: "Tri-State Inverter (Active-Low)",
    category: "Tri-State Buffers",
    archetypeId: VerilogArchetypeId.NOTIF0,
    description: "IEEE 1364 tri-state inverting buffer enabled when control is 0; drives Z when control is 1.",
    provenance: "IEEE Std 1364-2001 §7.4",
    ports: TRISTATE_GATE_PORTS,
    params: [["DELAY", 0, "ns", "Propagation delay"]],
  },
  {
    modelType: "notif1",
    aliases: ["TRISTATE_INV_H"],
    label: "Tri-State Inverter (Active-High)",
    category: "Tri-State Buffers",
    archetypeId: VerilogArchetypeId.NOTIF1,
    description: "IEEE 1364 tri-state inverting buffer enabled when control is 1; drives Z when control is 0.",
    provenance: "IEEE Std 1364-2001 §7.4",
    ports: TRISTATE_GATE_PORTS,
    params: [["DELAY", 0, "ns", "Propagation delay"]],
  },

  // ── Standard Flip-Flop, Mux, Arithmetic & Register Building Blocks ──────
  {
    modelType: "dff",
    aliases: ["D_FF", "FLIPFLOP"],
    label: "D Flip-Flop",
    category: "Sequential Elements",
    archetypeId: VerilogArchetypeId.DFF,
    description: "Positive-edge triggered D flip-flop.",
    provenance: "IEEE 1364 RTL Standard Library",
    ports: [
      { name: "d", kind: "signal", side: "left", dx: 0, dy: 16 },
      { name: "clk", kind: "signal", side: "left", dx: 0, dy: 36 },
      { name: "q", kind: "signal", side: "right", dx: 88, dy: 26 },
    ],
    params: [["WIDTH", 1, "bits", "Data bus width"]],
  },
  {
    modelType: "dffr",
    aliases: ["D_FF_RST"],
    label: "D Flip-Flop w/ Reset",
    category: "Sequential Elements",
    archetypeId: VerilogArchetypeId.DFFR,
    description: "Positive-edge triggered D flip-flop with synchronous active-high reset.",
    provenance: "IEEE 1364 RTL Standard Library",
    ports: [
      { name: "d", kind: "signal", side: "left", dx: 0, dy: 14 },
      { name: "clk", kind: "signal", side: "left", dx: 0, dy: 28 },
      { name: "rst", kind: "signal", side: "left", dx: 0, dy: 42 },
      { name: "q", kind: "signal", side: "right", dx: 88, dy: 26 },
    ],
    params: [
      ["WIDTH", 1, "bits", "Data bus width"],
      ["RESET_VAL", 0, "", "Reset value"],
    ],
  },
  {
    modelType: "dffe",
    aliases: ["D_FF_EN"],
    label: "D Flip-Flop w/ Enable",
    category: "Sequential Elements",
    archetypeId: VerilogArchetypeId.DFFE,
    description: "Positive-edge triggered D flip-flop with clock enable and synchronous reset.",
    provenance: "IEEE 1364 RTL Standard Library",
    ports: [
      { name: "d", kind: "signal", side: "left", dx: 0, dy: 12 },
      { name: "en", kind: "signal", side: "left", dx: 0, dy: 24 },
      { name: "clk", kind: "signal", side: "left", dx: 0, dy: 36 },
      { name: "rst", kind: "signal", side: "bottom", dx: 44, dy: 52 },
      { name: "q", kind: "signal", side: "right", dx: 88, dy: 26 },
    ],
    params: [["WIDTH", 1, "bits", "Data bus width"]],
  },
  {
    modelType: "dlatch",
    aliases: ["D_LATCH"],
    label: "D Latch",
    category: "Sequential Elements",
    archetypeId: VerilogArchetypeId.DLATCH,
    description: "Level-sensitive transparent D latch.",
    provenance: "IEEE 1364 RTL Standard Library",
    ports: [
      { name: "d", kind: "signal", side: "left", dx: 0, dy: 16 },
      { name: "en", kind: "signal", side: "left", dx: 0, dy: 36 },
      { name: "q", kind: "signal", side: "right", dx: 88, dy: 26 },
    ],
    params: [["WIDTH", 1, "bits", "Data bus width"]],
  },
  {
    modelType: "mux2",
    aliases: ["MUX2TO1"],
    label: "2:1 Multiplexer",
    category: "Multiplexers",
    archetypeId: VerilogArchetypeId.MUX2,
    description: "4-state 2-to-1 multiplexer (sel=0 -> a, sel=1 -> b).",
    provenance: "IEEE 1364 RTL Standard Library",
    ports: [
      { name: "a", kind: "signal", side: "left", dx: 0, dy: 16 },
      { name: "b", kind: "signal", side: "left", dx: 0, dy: 36 },
      { name: "sel", kind: "signal", side: "bottom", dx: 44, dy: 52 },
      { name: "y", kind: "signal", side: "right", dx: 88, dy: 26 },
    ],
    params: [["WIDTH", 1, "bits", "Bus width"]],
  },
  {
    modelType: "mux4",
    aliases: ["MUX4TO1"],
    label: "4:1 Multiplexer",
    category: "Multiplexers",
    archetypeId: VerilogArchetypeId.MUX4,
    description: "4-state 4-to-1 multiplexer with 2-bit select.",
    provenance: "IEEE 1364 RTL Standard Library",
    ports: [
      { name: "d0", kind: "signal", side: "left", dx: 0, dy: 10 },
      { name: "d1", kind: "signal", side: "left", dx: 0, dy: 20 },
      { name: "d2", kind: "signal", side: "left", dx: 0, dy: 32 },
      { name: "d3", kind: "signal", side: "left", dx: 0, dy: 42 },
      { name: "sel", kind: "signal", side: "bottom", dx: 44, dy: 52 },
      { name: "y", kind: "signal", side: "right", dx: 88, dy: 26 },
    ],
    params: [["WIDTH", 1, "bits", "Bus width"]],
  },
  {
    modelType: "half_adder",
    aliases: ["HA"],
    label: "Half Adder",
    category: "Arithmetic & ALU",
    archetypeId: VerilogArchetypeId.HALF_ADDER,
    description: "1-bit gate-level half adder (sum = a ^ b, cout = a & b).",
    provenance: "IEEE 1364 RTL Standard Library",
    ports: [
      { name: "a", kind: "signal", side: "left", dx: 0, dy: 16 },
      { name: "b", kind: "signal", side: "left", dx: 0, dy: 36 },
      { name: "sum", kind: "signal", side: "right", dx: 88, dy: 16 },
      { name: "cout", kind: "signal", side: "right", dx: 88, dy: 36 },
    ],
    params: [],
  },
  {
    modelType: "full_adder",
    aliases: ["FA"],
    label: "Full Adder",
    category: "Arithmetic & ALU",
    archetypeId: VerilogArchetypeId.FULL_ADDER,
    description: "1-bit gate-level full adder with 4-state X/Z propagation.",
    provenance: "IEEE 1364 RTL Standard Library",
    ports: [
      { name: "a", kind: "signal", side: "left", dx: 0, dy: 12 },
      { name: "b", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "cin", kind: "signal", side: "left", dx: 0, dy: 40 },
      { name: "sum", kind: "signal", side: "right", dx: 88, dy: 16 },
      { name: "cout", kind: "signal", side: "right", dx: 88, dy: 36 },
    ],
    params: [],
  },
  {
    modelType: "alu4",
    aliases: ["ALU_4BIT"],
    label: "4-Bit ALU",
    category: "Arithmetic & ALU",
    archetypeId: VerilogArchetypeId.ALU4,
    description: "4-bit combinational Arithmetic Logic Unit supporting ADD, SUB, AND, OR, XOR, NOT, SHL, SHR.",
    provenance: "IEEE 1364 RTL Standard Library",
    ports: [
      { name: "a", kind: "signal", side: "left", dx: 0, dy: 12 },
      { name: "b", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "op", kind: "signal", side: "left", dx: 0, dy: 40 },
      { name: "y", kind: "signal", side: "right", dx: 88, dy: 16 },
      { name: "zero", kind: "signal", side: "right", dx: 88, dy: 36 },
    ],
    params: [["WIDTH", 4, "bits", "ALU operand width"]],
  },
  {
    modelType: "shift_reg",
    aliases: ["SISO", "SIPO"],
    label: "Shift Register",
    category: "Registers & Counters",
    archetypeId: VerilogArchetypeId.SHIFT_REG,
    description: "Synchronous serial-in parallel-out shift register.",
    provenance: "IEEE 1364 RTL Standard Library",
    ports: [
      { name: "sin", kind: "signal", side: "left", dx: 0, dy: 14 },
      { name: "clk", kind: "signal", side: "left", dx: 0, dy: 28 },
      { name: "rst", kind: "signal", side: "left", dx: 0, dy: 42 },
      { name: "q", kind: "signal", side: "right", dx: 88, dy: 26 },
    ],
    params: [["WIDTH", 8, "bits", "Shift register stages"]],
  },
  {
    modelType: "lfsr7",
    aliases: ["PRBS7"],
    label: "PRBS-7 LFSR",
    category: "Registers & Counters",
    archetypeId: VerilogArchetypeId.LFSR7,
    description: "7-bit maximal-length PRBS-7 LFSR (polynomial x^7 + x^6 + 1, period 127).",
    provenance: "ITU-T O.150 / IEEE 1364 RTL Standard Library",
    ports: [
      { name: "clk", kind: "signal", side: "left", dx: 0, dy: 18 },
      { name: "rst", kind: "signal", side: "left", dx: 0, dy: 34 },
      { name: "q", kind: "signal", side: "right", dx: 88, dy: 26 },
    ],
    params: [["SEED", 0x7f, "", "Non-zero 7-bit seed"]],
  },
  {
    modelType: "counter",
    aliases: ["UP_COUNTER"],
    label: "Binary Counter",
    category: "Registers & Counters",
    archetypeId: VerilogArchetypeId.COUNTER,
    description: "Synchronous N-bit binary up-counter with enable and reset.",
    provenance: "IEEE 1364 RTL Standard Library",
    ports: [
      { name: "clk", kind: "signal", side: "left", dx: 0, dy: 14 },
      { name: "rst", kind: "signal", side: "left", dx: 0, dy: 28 },
      { name: "en", kind: "signal", side: "left", dx: 0, dy: 42 },
      { name: "count", kind: "signal", side: "right", dx: 88, dy: 26 },
    ],
    params: [["WIDTH", 8, "bits", "Counter width"]],
  },
];

/**
 * Builds the declarative `CleanroomModelSchema[]` array for `@modelscript/verilog-std-lib`.
 */
export function buildVerilogCleanroomSchemas(): CleanroomModelSchema[] {
  return VERILOG_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "integer",
      defaultValue,
      unit,
      description,
    }));

    return {
      namePath: `Verilog.Std.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "digital-rtl",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Component",
      width: 88,
      height: 52,
      svg: generateVerilogBlockSvg(spec.modelType, spec.category),
      ports: spec.ports,
      parameters,
      wasmKernel: "verilogEvalPrimitive",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}

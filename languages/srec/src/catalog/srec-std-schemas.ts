// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom archetype IDs matching `assets/srec-std-lib/src/models.ts`.
 */
export const SrecArchetypeId = {
  // Record Types (S0–S9)
  REC_S0: 1,
  REC_S1: 2,
  REC_S2: 3,
  REC_S3: 4,
  REC_S4: 5,
  REC_S5: 6,
  REC_S6: 7,
  REC_S7: 8,
  REC_S8: 9,
  REC_S9: 10,
  // Classic Motorola Processor Memory Map Presets
  PRESET_MC6800: 20,
  PRESET_MC68000: 21,
  PRESET_COLDFIRE: 22,
  PRESET_POWERPC: 23,
} as const;

export type SrecArchetypeId = (typeof SrecArchetypeId)[keyof typeof SrecArchetypeId];

export type SrecModelCategory = "Record Types" | "Motorola Memory Maps";

export interface SrecModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: SrecModelCategory;
  archetypeId: SrecArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<SrecModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Record Types": { fill: "#1e293b", stroke: "#38bdf8", badge: "SREC" },
  "Motorola Memory Maps": { fill: "#2e1065", stroke: "#c084fc", badge: "MMAP" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for an SREC record or memory map preset.
 */
export function generateSrecBlockSvg(modelType: string, category: SrecModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 10);
  const fontSize = label.length > 8 ? "8.2" : "9.5";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: SrecModelSpec): DiagramPortSpec[] {
  if (spec.category === "Record Types") {
    return [
      { name: "addr_in", kind: "data", side: "left", dx: 0, dy: 26 },
      { name: "bytes_out", kind: "data", side: "right", dx: 88, dy: 26 },
    ];
  }
  return [
    { name: "bus_addr", kind: "data", side: "left", dx: 0, dy: 18 },
    { name: "bus_data", kind: "data", side: "right", dx: 88, dy: 18 },
    { name: "reset_vec", kind: "control", side: "bottom", dx: 44, dy: 52 },
  ];
}

export const SREC_STD_MODEL_SPECS: SrecModelSpec[] = [
  // Motorola S-Record Types (S0–S9)
  {
    modelType: "S0",
    aliases: ["HEADER", "S0_HEADER"],
    label: "S0 Header Record",
    category: "Record Types",
    archetypeId: SrecArchetypeId.REC_S0,
    description: "Vendor-specific ASCII header record with 16-bit address (typically 0x0000) and module metadata.",
    provenance: "Motorola S-Record Specification (1974)",
    params: [
      ["addressBits", 16, "bit", "Address field width in bits"],
      ["addressBytes", 2, "B", "Address field width in bytes"],
      ["maxPayloadBytes", 252, "B", "Maximum payload bytes per record"],
    ],
  },
  {
    modelType: "S1",
    aliases: ["DATA16", "S1_DATA"],
    label: "S1 16-bit Data Record",
    category: "Record Types",
    archetypeId: SrecArchetypeId.REC_S1,
    description: "Data record carrying binary payload for 16-bit (64 KiB) address spaces such as Motorola 6800/6809.",
    provenance: "Motorola S-Record Specification (1974)",
    params: [
      ["addressBits", 16, "bit", "Address field width in bits"],
      ["addressBytes", 2, "B", "Address field width in bytes"],
      ["maxPayloadBytes", 252, "B", "Maximum payload bytes per record"],
    ],
  },
  {
    modelType: "S2",
    aliases: ["DATA24", "S2_DATA"],
    label: "S2 24-bit Data Record",
    category: "Record Types",
    archetypeId: SrecArchetypeId.REC_S2,
    description: "Data record carrying binary payload for 24-bit (16 MiB) address spaces such as Motorola 68000.",
    provenance: "Motorola S-Record Specification (1979)",
    params: [
      ["addressBits", 24, "bit", "Address field width in bits"],
      ["addressBytes", 3, "B", "Address field width in bytes"],
      ["maxPayloadBytes", 251, "B", "Maximum payload bytes per record"],
    ],
  },
  {
    modelType: "S3",
    aliases: ["DATA32", "S3_DATA"],
    label: "S3 32-bit Data Record",
    category: "Record Types",
    archetypeId: SrecArchetypeId.REC_S3,
    description:
      "Data record carrying binary payload for 32-bit (4 GiB) address spaces such as 68020, ColdFire, and PowerPC.",
    provenance: "Motorola S-Record Specification (1984)",
    params: [
      ["addressBits", 32, "bit", "Address field width in bits"],
      ["addressBytes", 4, "B", "Address field width in bytes"],
      ["maxPayloadBytes", 250, "B", "Maximum payload bytes per record"],
    ],
  },
  {
    modelType: "S4",
    aliases: ["RESERVED", "S4_RESERVED"],
    label: "S4 Reserved Record",
    category: "Record Types",
    archetypeId: SrecArchetypeId.REC_S4,
    description:
      "Reserved record type in Motorola S-Record specification; flagged as invalid (SREC3001) in firmware images.",
    provenance: "Motorola S-Record Specification",
    params: [
      ["addressBits", 16, "bit", "Reserved"],
      ["addressBytes", 2, "B", "Reserved"],
      ["maxPayloadBytes", 0, "B", "Reserved"],
    ],
  },
  {
    modelType: "S5",
    aliases: ["COUNT16", "S5_COUNT"],
    label: "S5 16-bit Record Count",
    category: "Record Types",
    archetypeId: SrecArchetypeId.REC_S5,
    description: "Optional 16-bit count of preceding S1/S2/S3 data records (up to 65,535 records).",
    provenance: "Motorola S-Record Specification",
    params: [
      ["addressBits", 16, "bit", "Count field width in bits"],
      ["addressBytes", 2, "B", "Count field width in bytes"],
      ["maxCount", 65535, "records", "Maximum representable record count"],
    ],
  },
  {
    modelType: "S6",
    aliases: ["COUNT24", "S6_COUNT"],
    label: "S6 24-bit Record Count",
    category: "Record Types",
    archetypeId: SrecArchetypeId.REC_S6,
    description: "Optional 24-bit count of preceding S1/S2/S3 data records (up to 16,777,215 records).",
    provenance: "Motorola S-Record Specification",
    params: [
      ["addressBits", 24, "bit", "Count field width in bits"],
      ["addressBytes", 3, "B", "Count field width in bytes"],
      ["maxCount", 16777215, "records", "Maximum representable record count"],
    ],
  },
  {
    modelType: "S7",
    aliases: ["TERM32", "S7_START"],
    label: "S7 32-bit Start Address",
    category: "Record Types",
    archetypeId: SrecArchetypeId.REC_S7,
    description: "Termination record specifying a 32-bit execution entry point for S3 data images.",
    provenance: "Motorola S-Record Specification (1984)",
    params: [
      ["addressBits", 32, "bit", "Start address width in bits"],
      ["addressBytes", 4, "B", "Start address width in bytes"],
      ["pairedDataType", 3, "", "Paired data record type (S3)"],
    ],
  },
  {
    modelType: "S8",
    aliases: ["TERM24", "S8_START"],
    label: "S8 24-bit Start Address",
    category: "Record Types",
    archetypeId: SrecArchetypeId.REC_S8,
    description: "Termination record specifying a 24-bit execution entry point for S2 data images.",
    provenance: "Motorola S-Record Specification (1979)",
    params: [
      ["addressBits", 24, "bit", "Start address width in bits"],
      ["addressBytes", 3, "B", "Start address width in bytes"],
      ["pairedDataType", 2, "", "Paired data record type (S2)"],
    ],
  },
  {
    modelType: "S9",
    aliases: ["TERM16", "S9_START"],
    label: "S9 16-bit Start Address",
    category: "Record Types",
    archetypeId: SrecArchetypeId.REC_S9,
    description: "Termination record specifying a 16-bit execution entry point for S1 data images.",
    provenance: "Motorola S-Record Specification (1974)",
    params: [
      ["addressBits", 16, "bit", "Start address width in bits"],
      ["addressBytes", 2, "B", "Start address width in bytes"],
      ["pairedDataType", 1, "", "Paired data record type (S1)"],
    ],
  },

  // Classic Motorola Processor Memory Map Presets
  {
    modelType: "MC6800",
    aliases: ["6800", "M6800", "S19_6800"],
    label: "Motorola 6800 Memory Map",
    category: "Motorola Memory Maps",
    archetypeId: SrecArchetypeId.PRESET_MC6800,
    description:
      "Classic 8-bit Motorola MC6800 16-bit address map (RAM 0x0000, ROM 0xE000, Reset Vector 0xFFFE, S1/S9).",
    provenance: "Motorola M6800 Microprocessor Applications Manual (1975)",
    params: [
      ["addressBits", 16, "bit", "16-bit linear address bus"],
      ["ramBase", 0x0000, "addr", "Zero-page & user RAM base"],
      ["romBase", 0xe000, "addr", "Monitor / firmware ROM base"],
      ["resetVector", 0xfffe, "addr", "16-bit big-endian reset vector"],
    ],
  },
  {
    modelType: "MC68000",
    aliases: ["68000", "M68K", "S28_68K"],
    label: "Motorola 68000 Memory Map",
    category: "Motorola Memory Maps",
    archetypeId: SrecArchetypeId.PRESET_MC68000,
    description:
      "Classic Motorola 68000 24-bit address map (Vector Table 0x000000, ROM 0x000400, RAM 0x800000, S2/S8).",
    provenance: "Motorola MC68000 User's Manual (1979)",
    params: [
      ["addressBits", 24, "bit", "24-bit physical address bus"],
      ["vectorBase", 0x000000, "addr", "Exception vector table base (SSP + PC)"],
      ["romBase", 0x000400, "addr", "Boot ROM code base"],
      ["ramBase", 0x800000, "addr", "System RAM base"],
    ],
  },
  {
    modelType: "COLDFIRE",
    aliases: ["MCF5200", "MCF5400", "S37_COLDFIRE"],
    label: "Motorola ColdFire Memory Map",
    category: "Motorola Memory Maps",
    archetypeId: SrecArchetypeId.PRESET_COLDFIRE,
    description:
      "32-bit Motorola/Freescale ColdFire embedded flash & SRAM map (Flash 0x00000000, SRAM 0x20000000, S3/S7).",
    provenance: "Motorola ColdFire Family Programmer's Reference Manual",
    params: [
      ["addressBits", 32, "bit", "32-bit address bus"],
      ["flashBase", 0x00000000, "addr", "Internal/External Flash base"],
      ["sramBase", 0x20000000, "addr", "On-chip SRAM base"],
      ["periphBase", 0x40000000, "addr", "IPSBAR peripheral register base"],
    ],
  },
  {
    modelType: "POWERPC",
    aliases: ["MPC555", "MPC860", "PPC", "S37_PPC"],
    label: "Motorola PowerPC Memory Map",
    category: "Motorola Memory Maps",
    archetypeId: SrecArchetypeId.PRESET_POWERPC,
    description:
      "32-bit Motorola/Freescale PowerPC embedded map (SRAM 0x00000000, Boot Flash 0xFFF00000, Reset 0xFFF00100, S3/S7).",
    provenance: "Motorola PowerPC MPC5xx / MPC8xx Reference Manual",
    params: [
      ["addressBits", 32, "bit", "32-bit Book-E / Classic PPC address space"],
      ["ramBase", 0x00000000, "addr", "System SDRAM / SRAM base"],
      ["bootFlashBase", 0xfff00000, "addr", "High boot ROM / Flash base"],
      ["resetVector", 0xfff00100, "addr", "System reset exception vector"],
    ],
  },
];

/**
 * Builds the declarative `CleanroomModelSchema[]` array for `@modelscript/srec-std-lib`.
 */
export function buildSrecCleanroomSchemas(): CleanroomModelSchema[] {
  return SREC_STD_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "integer",
      defaultValue,
      unit,
      description,
    }));

    return {
      namePath: `srec.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "firmware",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 88,
      height: 52,
      svg: generateSrecBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: "srecModelEval",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}

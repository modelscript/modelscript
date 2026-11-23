// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom JEDEC JESD3 PLD & Field Descriptor archetype IDs
 * matching `assets/jedec-std-lib/src/models.ts`.
 */
export const JedecArchetypeId = {
  // Classic 1980s Programmable Logic Devices
  PAL16L8: 1,
  PAL16R8: 2,
  GAL16V8: 3,
  GAL22V10: 4,
  // JESD3 Field Descriptors
  FIELD_QP: 10,
  FIELD_QF: 11,
  FIELD_L: 12,
  FIELD_C: 13,
  FIELD_V: 14,
} as const;

export type JedecArchetypeId = (typeof JedecArchetypeId)[keyof typeof JedecArchetypeId];

export type JedecModelCategory = "Programmable Logic Devices" | "JESD3 Field Descriptors";

export interface JedecModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: JedecModelCategory;
  archetypeId: JedecArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<JedecModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Programmable Logic Devices": { fill: "#1e293b", stroke: "#38bdf8", badge: "PLD" },
  "JESD3 Field Descriptors": { fill: "#2e1f14", stroke: "#f59e0b", badge: "JESD3" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a PLD device or JESD3 field descriptor.
 */
export function generateJedecBlockSvg(modelType: string, category: JedecModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 12);
  const fontSize = label.length > 9 ? "7.4" : "8.8";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 52" width="96" height="52">` +
    `<rect x="2" y="2" width="92" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="32" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="22" y="15" text-anchor="middle" font-family="monospace" font-size="6.8" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: JedecModelSpec): DiagramPortSpec[] {
  if (spec.category === "Programmable Logic Devices") {
    return [
      { name: "inputs", kind: "digital", side: "left", dx: 0, dy: 26 },
      { name: "outputs", kind: "digital", side: "right", dx: 96, dy: 26 },
    ];
  }
  return [
    { name: "stream_in", kind: "signal", side: "left", dx: 0, dy: 26 },
    { name: "field_out", kind: "signal", side: "right", dx: 96, dy: 26 },
  ];
}

/**
 * Declarative catalog of classic 1980s PLDs and JESD3 field descriptors.
 */
export const JEDEC_MODEL_SPECS: JedecModelSpec[] = [
  // --- Classic 1980s PLDs ---
  {
    modelType: "PAL16L8",
    aliases: ["16L8", "MMI_PAL16L8"],
    label: "PAL16L8 Combinational PLD",
    category: "Programmable Logic Devices",
    archetypeId: JedecArchetypeId.PAL16L8,
    description:
      "Monolithic Memories 20-pin combinational PAL with 10 dedicated inputs, 6 bidirectional I/Os, 2 dedicated active-low outputs, and 64x32 (2048) AND-OR fuse array.",
    provenance: "MMI PAL Device Data Book (1981) / JEDEC JESD3",
    params: [
      ["pinCount", 20, "pins", "20-pin DIP package"],
      ["fuseCount", 2048, "fuses", "64 product terms x 32 input columns"],
      ["matrixRows", 64, "rows", "8 outputs x 8 product terms (1 OE + 7 SOP)"],
      ["matrixCols", 32, "cols", "16 true/complement input literal pairs"],
      ["tpdNs", 15, "ns", "Nominal propagation delay (PAL16L8-15)"],
    ],
  },
  {
    modelType: "PAL16R8",
    aliases: ["16R8", "MMI_PAL16R8"],
    label: "PAL16R8 Registered PLD",
    category: "Programmable Logic Devices",
    archetypeId: JedecArchetypeId.PAL16R8,
    description:
      "Monolithic Memories 20-pin registered PAL with 8 D-flip-flop outputs clocked by pin 1, common /OE on pin 11, and 64x32 (2048) AND-OR fuse array.",
    provenance: "MMI PAL Device Data Book (1981) / JEDEC JESD3",
    params: [
      ["pinCount", 20, "pins", "20-pin DIP package"],
      ["fuseCount", 2048, "fuses", "64 product terms x 32 input columns"],
      ["matrixRows", 64, "rows", "8 registered outputs x 8 SOP product terms"],
      ["matrixCols", 32, "cols", "16 true/complement input literal pairs"],
      ["fmaxMHz", 50, "MHz", "Maximum clock frequency"],
    ],
  },
  {
    modelType: "GAL16V8",
    aliases: ["16V8", "LATTICE_GAL16V8"],
    label: "GAL16V8 Electrically Erasable PLD",
    category: "Programmable Logic Devices",
    archetypeId: JedecArchetypeId.GAL16V8,
    description:
      "Lattice Semiconductor 20-pin E2CMOS Generic Array Logic emulating PAL16L8/16R8 with 8 OLMC macrocells, programmable XOR output polarity, and 2194 fuses.",
    provenance: "Lattice Semiconductor GAL16V8 Datasheet (1985) / JEDEC JESD3",
    params: [
      ["pinCount", 20, "pins", "20-pin DIP/PLCC package"],
      ["fuseCount", 2194, "fuses", "2048 AND array + 8 XOR + 64 UES + 8 AC1 + 64 PTD + SYN + AC0"],
      ["matrixRows", 64, "rows", "8 OLMC macrocells x 8 product terms"],
      ["matrixCols", 32, "cols", "16 true/complement input literal pairs"],
      ["tpdNs", 10, "ns", "Nominal propagation delay (GAL16V8D-10)"],
    ],
  },
  {
    modelType: "GAL22V10",
    aliases: ["22V10", "AMD_PAL22V10", "LATTICE_GAL22V10"],
    label: "GAL22V10 Variable-Product-Term PLD",
    category: "Programmable Logic Devices",
    archetypeId: JedecArchetypeId.GAL22V10,
    description:
      "24-pin E2CMOS PLD with 10 OLMC macrocells, variable product terms (8..16 per output), global AR/SP terms, and 5892 fuses (132x44 AND array).",
    provenance: "AMD AmPAL22V10 (1983) / Lattice GAL22V10 Datasheet / JEDEC JESD3",
    params: [
      ["pinCount", 24, "pins", "24-pin Skinny DIP / 28-pin PLCC"],
      ["fuseCount", 5892, "fuses", "5808 AND array (132x44) + 20 architecture + 64 UES fuses"],
      ["matrixRows", 132, "rows", "1 AR + 10 macrocells (8..16 SOP + OE) + 1 SP"],
      ["matrixCols", 44, "cols", "22 true/complement input literal pairs"],
      ["tpdNs", 10, "ns", "Nominal propagation delay (GAL22V10D-10)"],
    ],
  },

  // --- JESD3 Field Descriptors ---
  {
    modelType: "QP",
    aliases: ["FIELD_QP", "PIN_COUNT"],
    label: "QP — Pin Count Field",
    category: "JESD3 Field Descriptors",
    archetypeId: JedecArchetypeId.FIELD_QP,
    description: "JESD3 device pin count declaration (`QP<n>*`, e.g., `QP20*` for 20-pin PAL/GAL).",
    provenance: "JEDEC Standard 3 (JESD3-C) §3.2",
    params: [["pinCount", 20, "pins", "Number of device pins"]],
  },
  {
    modelType: "QF",
    aliases: ["FIELD_QF", "FUSE_COUNT"],
    label: "QF — Fuse Count Field",
    category: "JESD3 Field Descriptors",
    archetypeId: JedecArchetypeId.FIELD_QF,
    description: "Mandatory JESD3 total fuse count declaration (`QF<n>*`, e.g., `QF2048*` for PAL16L8).",
    provenance: "JEDEC Standard 3 (JESD3-C) §3.2",
    params: [["fuseCount", 2048, "fuses", "Total addressable fuse count"]],
  },
  {
    modelType: "L",
    aliases: ["FIELD_L", "FUSE_LIST"],
    label: "L — Fuse Data List Field",
    category: "JESD3 Field Descriptors",
    archetypeId: JedecArchetypeId.FIELD_L,
    description: "JESD3 fuse address and binary bit-string (`L<addr> <0|1...>*`, where 0 = intact, 1 = blown).",
    provenance: "JEDEC Standard 3 (JESD3-C) §3.2",
    params: [
      ["startAddress", 0, "index", "0-based starting fuse address"],
      ["bitWidth", 32, "bits", "Typical row width per L record"],
    ],
  },
  {
    modelType: "C",
    aliases: ["FIELD_C", "FUSE_CHECKSUM"],
    label: "C — 16-bit Fuse Checksum Field",
    category: "JESD3 Field Descriptors",
    archetypeId: JedecArchetypeId.FIELD_C,
    description:
      "JESD3 16-bit hexadecimal fuse checksum (`C<hhhh>*`) computed as LSB-first 8-bit byte sum mod 0x10000.",
    provenance: "JEDEC Standard 3 (JESD3-C) §3.3",
    params: [["checksumWidthBits", 16, "bits", "16-bit unsigned hexadecimal checksum"]],
  },
  {
    modelType: "V",
    aliases: ["FIELD_V", "TEST_VECTOR"],
    label: "V — Functional Test Vector Field",
    category: "JESD3 Field Descriptors",
    archetypeId: JedecArchetypeId.FIELD_V,
    description:
      "JESD3 functional test vector (`V<n> <pins>*`) specifying per-pin stimulus (`0`,`1`,`C`) and expected response (`H`,`L`,`Z`,`X`,`N`).",
    provenance: "JEDEC Standard 3 (JESD3-C) §3.4",
    params: [["vectorIndex", 1, "index", "1-based sequential test vector number"]],
  },
];

/**
 * Converts declarative `JEDEC_MODEL_SPECS` into `CleanroomModelSchema[]` payloads for stdlib packaging.
 */
export function buildJedecCleanroomSchemas(): CleanroomModelSchema[] {
  return JEDEC_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      ...(unit !== undefined ? { unit } : {}),
      ...(description !== undefined ? { description } : {}),
    }));

    return {
      namePath: `jedec.${spec.modelType}`,
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
      svg: generateJedecBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: "jedecFuseCountForDevice",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom IRIG 106 Chapter 9 TMATS archetype IDs matching `assets/irig106-std-lib/src/models.ts`.
 */
export const Irig106ArchetypeId = {
  // TMATS Chapter 9 Core Groups
  GROUP_G: 1,
  GROUP_T: 2,
  GROUP_M: 3,
  GROUP_P: 4,
  GROUP_D: 5,
  GROUP_C: 6,
  // IRIG 106 Standard Optimal Frame Synchronization Patterns (Appendix C)
  SYNC_16_EB90: 16,
  SYNC_24_FAF320: 24,
  SYNC_32_FE6B2840: 32,
} as const;

export type Irig106ArchetypeId = (typeof Irig106ArchetypeId)[keyof typeof Irig106ArchetypeId];

export type Irig106SchemaCategory = "TMATS Groups" | "IRIG-106 Sync Words";

export interface Irig106SyncWordSpec {
  id: string;
  bitLength: number;
  hex: string;
  binary: string;
  numericValue: number;
  description: string;
}

/**
 * Standard IRIG 106 Appendix C optimal PCM frame synchronization patterns.
 */
export const IRIG106_STANDARD_SYNC_WORDS: readonly Irig106SyncWordSpec[] = [
  {
    id: "SYNC_16_EB90",
    bitLength: 16,
    hex: "EB90",
    binary: "1110101110010000",
    numericValue: 0xeb90,
    description: "IRIG 106 standard 16-bit optimal frame synchronization pattern (0xEB90).",
  },
  {
    id: "SYNC_24_FAF320",
    bitLength: 24,
    hex: "FAF320",
    binary: "111110101111001100100000",
    numericValue: 0xfaf320,
    description: "IRIG 106 standard 24-bit optimal frame synchronization pattern (0xFAF320).",
  },
  {
    id: "SYNC_32_FE6B2840",
    bitLength: 32,
    hex: "FE6B2840",
    binary: "11111110011010110010100001000000",
    numericValue: 0xfe6b2840,
    description: "IRIG 106 standard 32-bit optimal frame synchronization pattern (0xFE6B2840).",
  },
] as const;

interface Irig106SchemaSpec {
  name: string;
  aliases: string[];
  label: string;
  category: Irig106SchemaCategory;
  archetypeId: Irig106ArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number | string, unit?: string, description?: string]>;
}

const CATEGORY_STYLE: Record<Irig106SchemaCategory, { fill: string; stroke: string; badge: string }> = {
  "TMATS Groups": { fill: "#1e293b", stroke: "#38bdf8", badge: "TMATS" },
  "IRIG-106 Sync Words": { fill: "#2e1f47", stroke: "#a855f7", badge: "SYNC" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for an IRIG 106 TMATS schema.
 */
export function generateIrig106BlockSvg(name: string, category: Irig106SchemaCategory): string {
  const c = CATEGORY_STYLE[category];
  const label = name.toUpperCase().slice(0, 12);
  const fontSize = label.length > 9 ? "7.8" : "9.2";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 92 52" width="92" height="52">` +
    `<rect x="2" y="2" width="88" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="34" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="23" y="14.5" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="46" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

const IRIG106_SPECS: Irig106SchemaSpec[] = [
  {
    name: "TMATS_G",
    aliases: ["G", "GENERAL"],
    label: "G — General Information Group",
    category: "TMATS Groups",
    archetypeId: Irig106ArchetypeId.GROUP_G,
    description:
      "IRIG 106 Chapter 9 General Information group (program name PN, IRIG version 106, data sources DSI/DST).",
    provenance: "RCC IRIG 106 Chapter 9 (TMATS)",
    params: [
      ["PN", "PROGRAM_01", "", "Program Name"],
      ["106", "04", "", "IRIG 106 Version"],
      ["DSI_N", 1, "", "Number of Data Sources"],
    ],
  },
  {
    name: "TMATS_T",
    aliases: ["T", "TRANSMISSION"],
    label: "T — Transmission Attributes Group",
    category: "TMATS Groups",
    archetypeId: Irig106ArchetypeId.GROUP_T,
    description:
      "IRIG 106 Chapter 9 RF Transmission Attributes group (RF carrier frequency RF1, bandwidth RF2, modulation RF4).",
    provenance: "RCC IRIG 106 Chapter 9 (TMATS)",
    params: [
      ["RF1", 2250.5, "MHz", "RF Carrier Frequency"],
      ["RF2", 1000.0, "kHz", "RF Bandwidth"],
      ["RF4", "PCM/FM", "", "Modulation Type"],
    ],
  },
  {
    name: "TMATS_M",
    aliases: ["M", "MULTIPLEX"],
    label: "M — Multiplex / Modulation Group",
    category: "TMATS Groups",
    archetypeId: Irig106ArchetypeId.GROUP_M,
    description:
      "IRIG 106 Chapter 9 Multiplex/Modulation Attributes group (signal structure BB1, baseband modulation BB2, DLN).",
    provenance: "RCC IRIG 106 Chapter 9 (TMATS)",
    params: [
      ["BB1", "PCM", "", "Signal Structure Type"],
      ["BB2", "FM", "", "Baseband Modulation"],
    ],
  },
  {
    name: "TMATS_P",
    aliases: ["P", "PCM_FORMAT"],
    label: "P — PCM Format Attributes Group",
    category: "TMATS Groups",
    archetypeId: Irig106ArchetypeId.GROUP_P,
    description:
      "IRIG 106 Chapter 9 PCM Format Attributes group (D1 bit rate, F1 word length, MF1 words, MF2 bits, MF4 sync).",
    provenance: "RCC IRIG 106 Chapter 9 (TMATS)",
    params: [
      ["D1", 128000, "bps", "PCM Bit Rate"],
      ["F1", 16, "bits", "Common Word Length"],
      ["MF1", 6, "words", "Words in Minor Frame"],
      ["MF2", 128, "bits", "Bits in Minor Frame"],
      ["MF_N", 4, "frames", "Minor Frames in Major Frame"],
    ],
  },
  {
    name: "TMATS_D",
    aliases: ["D", "PCM_MEASUREMENT"],
    label: "D — PCM Measurement Description Group",
    category: "TMATS Groups",
    archetypeId: Irig106ArchetypeId.GROUP_D,
    description:
      "IRIG 106 Chapter 9 PCM Measurement Description group (MN name, WP word position, WI interval, FP/FI subframe).",
    provenance: "RCC IRIG 106 Chapter 9 (TMATS)",
    params: [
      ["WP", 1, "word", "1-based Word Position in Minor Frame"],
      ["WI", 0, "words", "Word Interval (Supercommutation)"],
      ["FP", 1, "frame", "1-based Minor Frame Position"],
      ["FI", 1, "frames", "Minor Frame Interval (Subcommutation)"],
    ],
  },
  {
    name: "TMATS_C",
    aliases: ["C", "DATA_CONVERSION"],
    label: "C — Data Conversion Attributes Group",
    category: "TMATS Groups",
    archetypeId: Irig106ArchetypeId.GROUP_C,
    description:
      "IRIG 106 Chapter 9 Data Conversion Attributes group (DCN name, DCT type COE/DER/PRS, polynomial CO-0..CO-n).",
    provenance: "RCC IRIG 106 Chapter 9 (TMATS)",
    params: [
      ["DCT", "COE", "", "Data Conversion Type"],
      ["CO_0", 0.0, "", "Polynomial Coefficient c0 (Offset)"],
      ["CO_1", 1.0, "", "Polynomial Coefficient c1 (Slope)"],
    ],
  },
  {
    name: "SYNC_16_EB90",
    aliases: ["EB90", "0xEB90", "SYNC16"],
    label: "IRIG-106 16-bit Sync (EB90)",
    category: "IRIG-106 Sync Words",
    archetypeId: Irig106ArchetypeId.SYNC_16_EB90,
    description: "IRIG 106 Appendix C optimal 16-bit PCM frame synchronization pattern (0xEB90).",
    provenance: "RCC IRIG 106 Appendix C",
    params: [
      ["BITS", 16, "bits", "Sync Pattern Bit Length"],
      ["HEX", "EB90", "", "Hexadecimal Sync Pattern"],
      ["VALUE", 0xeb90, "", "Unsigned Integer Value"],
    ],
  },
  {
    name: "SYNC_24_FAF320",
    aliases: ["FAF320", "0xFAF320", "SYNC24"],
    label: "IRIG-106 24-bit Sync (FAF320)",
    category: "IRIG-106 Sync Words",
    archetypeId: Irig106ArchetypeId.SYNC_24_FAF320,
    description: "IRIG 106 Appendix C optimal 24-bit PCM frame synchronization pattern (0xFAF320).",
    provenance: "RCC IRIG 106 Appendix C",
    params: [
      ["BITS", 24, "bits", "Sync Pattern Bit Length"],
      ["HEX", "FAF320", "", "Hexadecimal Sync Pattern"],
      ["VALUE", 0xfaf320, "", "Unsigned Integer Value"],
    ],
  },
  {
    name: "SYNC_32_FE6B2840",
    aliases: ["FE6B2840", "0xFE6B2840", "SYNC32"],
    label: "IRIG-106 32-bit Sync (FE6B2840)",
    category: "IRIG-106 Sync Words",
    archetypeId: Irig106ArchetypeId.SYNC_32_FE6B2840,
    description: "IRIG 106 Appendix C optimal 32-bit PCM frame synchronization pattern (0xFE6B2840).",
    provenance: "RCC IRIG 106 Appendix C",
    params: [
      ["BITS", 32, "bits", "Sync Pattern Bit Length"],
      ["HEX", "FE6B2840", "", "Hexadecimal Sync Pattern"],
      ["VALUE", 0xfe6b2840, "", "Unsigned Integer Value"],
    ],
  },
];

/**
 * Builds the declarative cleanroom standard library schemas for `@modelscript/irig106-std-lib`.
 */
export function buildIrig106CleanroomSchemas(): CleanroomModelSchema[] {
  const defaultPorts: DiagramPortSpec[] = [
    { name: "in", kind: "signal", side: "left", dx: 0, dy: 26 },
    { name: "out", kind: "signal", side: "right", dx: 92, dy: 26 },
  ];

  return IRIG106_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => {
      const param: CleanroomParameterSchema = {
        key,
        type: typeof defaultValue === "number" ? "real" : "string",
        defaultValue,
      };
      if (unit) param.unit = unit;
      if (description) param.description = description;
      return param;
    });
    return {
      namePath: `irig106:${spec.name}`,
      name: spec.name,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "aerospace",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 92,
      height: 52,
      svg: generateIrig106BlockSvg(spec.name, spec.category),
      ports: defaultPorts,
      parameters,
      wasmKernel: "irig106EvalPoly",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}

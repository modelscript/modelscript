// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom Intel HEX record type & classic MCU flash layout archetype IDs
 * matching `assets/ihex-std-lib/src/models.ts`.
 */
export const IhexArchetypeId = {
  // Intel HEX Standard Record Types (00..05)
  REC_00_DATA: 1,
  REC_01_EOF: 2,
  REC_02_EXT_SEG_ADDR: 3,
  REC_03_START_SEG_ADDR: 4,
  REC_04_EXT_LIN_ADDR: 5,
  REC_05_START_LIN_ADDR: 6,
  // Classic MCU Flash Memory Layouts
  MCU_8051: 10,
  MCU_AVR_ATMEGA328P: 11,
  MCU_ARM_CORTEX_M0: 12,
  MCU_ARM_CORTEX_M4: 13,
} as const;

export type IhexArchetypeId = (typeof IhexArchetypeId)[keyof typeof IhexArchetypeId];

export type IhexModelCategory = "Record Types" | "MCU Flash Layouts";

export interface IhexModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: IhexModelCategory;
  archetypeId: IhexArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<IhexModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Record Types": { fill: "#1e293b", stroke: "#38bdf8", badge: "REC" },
  "MCU Flash Layouts": { fill: "#163b3b", stroke: "#34d399", badge: "MCU" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for an Intel HEX schema.
 */
export function generateIhexBlockSvg(modelType: string, category: IhexModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 14);
  const fontSize = label.length > 10 ? "7.8" : "9.0";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 52" width="96" height="52">`,
    `<rect x="2" y="2" width="92" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>`,
    `<rect x="6" y="6" width="26" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>`,
    `<text x="19" y="14.5" text-anchor="middle" fill="${c.stroke}" font-family="monospace" font-size="7.5" font-weight="700">${c.badge}</text>`,
    `<text x="48" y="34" text-anchor="middle" fill="#f8fafc" font-family="monospace" font-size="${fontSize}" font-weight="600">${label}</text>`,
    `</svg>`,
  ].join("");
}

export const IHEX_MODEL_SPECS: readonly IhexModelSpec[] = [
  {
    modelType: "REC_00_DATA",
    aliases: ["DATA", "00", "TYPE_00"],
    label: "Record 00 — Data",
    category: "Record Types",
    archetypeId: IhexArchetypeId.REC_00_DATA,
    description: "Contains data bytes and a 16-bit load offset relative to the current extended base address.",
    provenance: "Intel Hexadecimal Object File Format Specification Rev. A (1988) / Intel MDS-80 (1973)",
    params: [
      ["RECORD_TYPE", 0, "hex", "Intel HEX record type code (0x00)"],
      ["DEFAULT_BYTE_COUNT", 16, "B", "Typical data payload bytes per record (1..255)"],
      ["ADDRESS_BITS", 16, "bit", "16-bit load offset field width"],
    ],
  },
  {
    modelType: "REC_01_EOF",
    aliases: ["EOF", "01", "TYPE_01"],
    label: "Record 01 — End Of File",
    category: "Record Types",
    archetypeId: IhexArchetypeId.REC_01_EOF,
    description: "Terminates an Intel HEX file. Canonical encoding is ':00000001FF'.",
    provenance: "Intel Hexadecimal Object File Format Specification Rev. A (1988)",
    params: [
      ["RECORD_TYPE", 1, "hex", "Intel HEX record type code (0x01)"],
      ["EXPECTED_BYTE_COUNT", 0, "B", "Payload length must be 0 bytes"],
      ["CANONICAL_CHECKSUM", 0xff, "hex", "2's-complement checksum for ':00000001FF'"],
    ],
  },
  {
    modelType: "REC_02_EXT_SEG_ADDR",
    aliases: ["ESA", "02", "TYPE_02"],
    label: "Record 02 — Extended Segment Address",
    category: "Record Types",
    archetypeId: IhexArchetypeId.REC_02_EXT_SEG_ADDR,
    description: "I16HEX 20-bit segmented addressing: shifts 16-bit USBA left by 4 bits (x16) to form segment base.",
    provenance: "Intel Hexadecimal Object File Format Specification Rev. A (1988)",
    params: [
      ["RECORD_TYPE", 2, "hex", "Intel HEX record type code (0x02)"],
      ["EXPECTED_BYTE_COUNT", 2, "B", "Payload length must be 2 bytes (USBA)"],
      ["SHIFT_BITS", 4, "bit", "Segment shift left count (base = USBA << 4)"],
    ],
  },
  {
    modelType: "REC_03_START_SEG_ADDR",
    aliases: ["SSA", "03", "TYPE_03"],
    label: "Record 03 — Start Segment Address",
    category: "Record Types",
    archetypeId: IhexArchetypeId.REC_03_START_SEG_ADDR,
    description: "I16HEX 80x86 execution entry point specifying initial 16-bit CS and 16-bit IP registers.",
    provenance: "Intel Hexadecimal Object File Format Specification Rev. A (1988)",
    params: [
      ["RECORD_TYPE", 3, "hex", "Intel HEX record type code (0x03)"],
      ["EXPECTED_BYTE_COUNT", 4, "B", "Payload length must be 4 bytes (CS:IP)"],
    ],
  },
  {
    modelType: "REC_04_EXT_LIN_ADDR",
    aliases: ["ELA", "04", "TYPE_04"],
    label: "Record 04 — Extended Linear Address",
    category: "Record Types",
    archetypeId: IhexArchetypeId.REC_04_EXT_LIN_ADDR,
    description: "I32HEX 32-bit linear addressing: shifts 16-bit ULBA left by 16 bits for 4 GiB flat address space.",
    provenance: "Intel Hexadecimal Object File Format Specification Rev. A (1988)",
    params: [
      ["RECORD_TYPE", 4, "hex", "Intel HEX record type code (0x04)"],
      ["EXPECTED_BYTE_COUNT", 2, "B", "Payload length must be 2 bytes (ULBA)"],
      ["SHIFT_BITS", 16, "bit", "Linear shift left count (base = ULBA << 16)"],
    ],
  },
  {
    modelType: "REC_05_START_LIN_ADDR",
    aliases: ["SLA", "05", "TYPE_05"],
    label: "Record 05 — Start Linear Address",
    category: "Record Types",
    archetypeId: IhexArchetypeId.REC_05_START_LIN_ADDR,
    description: "I32HEX 32-bit linear execution entry point (EIP / Reset_Handler address).",
    provenance: "Intel Hexadecimal Object File Format Specification Rev. A (1988)",
    params: [
      ["RECORD_TYPE", 5, "hex", "Intel HEX record type code (0x05)"],
      ["EXPECTED_BYTE_COUNT", 4, "B", "Payload length must be 4 bytes (32-bit EIP)"],
    ],
  },
  {
    modelType: "MCU_8051",
    aliases: ["8051", "MCS51", "AT89C51"],
    label: "Intel 8051 (MCS-51) Flash Layout",
    category: "MCU Flash Layouts",
    archetypeId: IhexArchetypeId.MCU_8051,
    description: "Classic 8-bit Harvard-architecture 8051 microcontroller with 64 KiB I8HEX code space at 0x0000.",
    provenance: "Intel MCS-51 Family User's Manual (1980)",
    params: [
      ["FLASH_BASE", 0x0000, "addr", "Code ROM base address"],
      ["FLASH_SIZE", 65536, "B", "Maximum 16-bit code space (64 KiB)"],
      ["PAGE_SIZE", 256, "B", "Code page granularity"],
      ["ERASE_BYTE", 0xff, "hex", "Unprogrammed EPROM/Flash byte"],
    ],
  },
  {
    modelType: "AVR_ATMEGA328P",
    aliases: ["ATMEGA328P", "AVR", "ARDUINO_UNO"],
    label: "AVR ATmega328P Flash Layout",
    category: "MCU Flash Layouts",
    archetypeId: IhexArchetypeId.MCU_AVR_ATMEGA328P,
    description: "Microchip/Atmel AVR ATmega328P 32 KiB flash (0x0000–0x7FFF) with 512 B Optiboot bootloader region.",
    provenance: "ATmega328P Datasheet (DS40002061B)",
    params: [
      ["FLASH_BASE", 0x0000, "addr", "Flash base address"],
      ["FLASH_SIZE", 32768, "B", "Total internal flash (32 KiB)"],
      ["PAGE_SIZE", 128, "B", "SPM flash page size (64 words = 128 B)"],
      ["BOOTLOADER_SIZE", 512, "B", "Default Optiboot bootloader size"],
      ["ERASE_BYTE", 0xff, "hex", "Erased flash byte"],
    ],
  },
  {
    modelType: "ARM_CORTEX_M0",
    aliases: ["CORTEX_M0", "STM32F0", "RP2040"],
    label: "ARM Cortex-M0 Flash Layout",
    category: "MCU Flash Layouts",
    archetypeId: IhexArchetypeId.MCU_ARM_CORTEX_M0,
    description: "32-bit ARM Cortex-M0 I32HEX flash layout (64 KiB at 0x08000000, 1 KiB erase pages).",
    provenance: "ARMv6-M Architecture Reference Manual",
    params: [
      ["FLASH_BASE", 0x08000000, "addr", "32-bit linear flash base address"],
      ["FLASH_SIZE", 65536, "B", "64 KiB flash memory"],
      ["PAGE_SIZE", 1024, "B", "1 KiB flash erase page"],
      ["VECTOR_TABLE_SIZE", 192, "B", "Initial SP + Reset + IRQ vector table"],
      ["ERASE_BYTE", 0xff, "hex", "Erased flash byte"],
    ],
  },
  {
    modelType: "ARM_CORTEX_M4",
    aliases: ["CORTEX_M4", "STM32F4", "NRF52840"],
    label: "ARM Cortex-M4 Flash Layout",
    category: "MCU Flash Layouts",
    archetypeId: IhexArchetypeId.MCU_ARM_CORTEX_M4,
    description: "32-bit ARM Cortex-M4F I32HEX flash layout (512 KiB at 0x08000000, 16 KiB sectors).",
    provenance: "ARMv7E-M Architecture Reference Manual",
    params: [
      ["FLASH_BASE", 0x08000000, "addr", "32-bit linear flash base address"],
      ["FLASH_SIZE", 524288, "B", "512 KiB flash memory"],
      ["PAGE_SIZE", 16384, "B", "16 KiB flash sector size"],
      ["VECTOR_TABLE_SIZE", 384, "B", "Initial SP + Reset + NVIC vector table"],
      ["ERASE_BYTE", 0xff, "hex", "Erased flash byte"],
    ],
  },
];

const DEFAULT_PORTS: DiagramPortSpec[] = [
  { name: "in", kind: "input", side: "left", dx: -48, dy: 0 },
  { name: "out", kind: "output", side: "right", dx: 48, dy: 0 },
];

/**
 * Builds the declarative `CleanroomModelSchema[]` array for `@modelscript/ihex-std-lib`.
 */
export function buildIhexCleanroomSchemas(): CleanroomModelSchema[] {
  return IHEX_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));

    return {
      namePath: `Ihex.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "firmware",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 96,
      height: 52,
      svg: generateIhexBlockSvg(spec.modelType, spec.category),
      ports: DEFAULT_PORTS,
      parameters,
      wasmKernel: "ihexModelEval",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}

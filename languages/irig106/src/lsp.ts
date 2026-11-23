// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for `@modelscript/irig106` (IRIG 106 Chapter 9 TMATS).
 */

import { lintIrig106, type Irig106Diagnostic } from "./lints/index.js";
import { parseIrig106 } from "./parser/tmats-parser.js";
import { buildCommutatorGrid } from "./solver/commutator.js";

export interface Irig106Position {
  line: number;
  character: number;
}

export interface Irig106Range {
  start: Irig106Position;
  end: Irig106Position;
}

export interface Irig106DocumentSymbol {
  name: string;
  detail?: string;
  kind: "Package" | "Class" | "Variable" | "Function";
  range: Irig106Range;
  selectionRange: Irig106Range;
  children?: Irig106DocumentSymbol[];
}

export interface Irig106HoverResult {
  contents: string;
  range?: Irig106Range;
}

export interface Irig106CompletionItem {
  label: string;
  detail: string;
  documentation: string;
  insertText: string;
}

const ATTRIBUTE_DOCS: Record<string, string> = {
  "G\\PN": "Program Name — identifies the flight test or telemetry program.",
  "G\\TA": "Test Item — identifies the vehicle or unit under test.",
  "G\\106": "IRIG 106 Version — Telemetry Standards revision level (e.g. 04, 17, 22).",
  "G\\DSI": "Data Source ID — unique identifier for each telemetry data source.",
  "T\\ID": "Transmission Group ID — identifies an RF telemetry transmitter.",
  "T\\RF1": "RF Carrier Frequency (MHz).",
  "T\\RF2": "RF Bandwidth (kHz).",
  "T\\RF4": "RF Modulation Type (e.g. PCM/FM, SOQPSK-TG).",
  "M\\ID": "Multiplex/Modulation Group ID.",
  "M\\BB1": "Baseband Signal Structure Type (e.g. PCM).",
  "M\\BB2": "Baseband Modulation Type.",
  "P\\DLN": "PCM Data Link Name — links P-x format group to D-x measurement descriptions.",
  "P\\D1": "PCM Bit Rate in bits per second (bps).",
  "P\\D2": "PCM Bit Encoding (e.g. NRZ-L, BI-L, RNRZ-L).",
  "P\\F1": "Common Word Length in bits (valid range: 4–64 bits).",
  "P\\F2": "Word Transfer Order (`M` = MSB first, `L` = LSB first).",
  "P\\F3": "Parity (`EV` = Even, `OD` = Odd, `NO` = None).",
  "P\\MF\\N": "Number of Minor Frames in a Major Frame.",
  "P\\MF1": "Number of Data Words in a Minor Frame.",
  "P\\MF2": "Total Number of Bits in a Minor Frame (including sync pattern).",
  "P\\MF3": "Minor Frame Synchronization Type (`FPT` = Fixed Pattern).",
  "P\\MF4": "Minor Frame Synchronization Pattern (e.g. `EB90`, `FAF320`, `FE6B2840`).",
  "D\\DLN": "Data Link Name matching `P-x\\DLN`.",
  "D\\MN": "Measurement Name (`D-x\\MN-l-m`) matching `C-x\\DCN`.",
  "D\\WP": "1-based Word Position (`D-x\\WP-l-m`) within the minor frame.",
  "D\\WI": "Word Interval (`D-x\\WI-l-m`) for supercommutated channels.",
  "D\\FP": "1-based Minor Frame Position (`D-x\\FP-l-m`) for subcommutated channels.",
  "D\\FI": "Minor Frame Interval (`D-x\\FI-l-m`) for subcommutated channels.",
  "D\\WFM": "Word Fragment Mask (`FW` for full word, or binary/hex bit mask).",
  "C\\DCN": "Data Conversion Name — links `C-x` calibration to `D-x\\MN-l-m`.",
  "C\\MN1": "Measurement Description.",
  "C\\MN3": "Engineering Units (e.g. `DEG/S`, `PSI`, `DEG C`, `G`).",
  "C\\BFM": "Binary Format (`UNS`, `TWO`, `ONE`, `SIG`, `OFF`, `FPT`).",
  "C\\DCT": "Data Conversion Type (`COE` polynomial, `DER` derived, `PRS` pair sets, `NON` none).",
  "C\\CO": "Polynomial Calibration Coefficient $c_k$ in $y = \\sum c_k x^k$.",
};

/**
 * Validates an IRIG 106 Chapter 9 TMATS document and returns all diagnostics.
 */
export function validateIrig106(source: string): Irig106Diagnostic[] {
  return lintIrig106(source);
}

/**
 * Extracts hierarchical LSP document symbols for a TMATS file.
 */
export function getIrig106DocumentSymbols(source: string): Irig106DocumentSymbol[] {
  const model = parseIrig106(source);
  const children: Irig106DocumentSymbol[] = [];

  for (const pcm of model.pcmFormats.values()) {
    const line0 = Math.max(0, (pcm.line ?? 1) - 1);
    const range: Irig106Range = { start: { line: line0, character: 0 }, end: { line: line0, character: 40 } };
    children.push({
      name: pcm.dataLinkName ?? `P-${pcm.index}`,
      detail: `${pcm.bitRateBps ?? 0} bps, ${pcm.commonWordLengthBits ?? 0}-bit, MF1=${pcm.wordsPerMinorFrame ?? 0}`,
      kind: "Class",
      range,
      selectionRange: range,
    });
  }

  for (const dg of model.measurementGroups.values()) {
    for (const meas of dg.measurements) {
      const line0 = Math.max(0, meas.line - 1);
      const range: Irig106Range = { start: { line: line0, character: 0 }, end: { line: line0, character: 40 } };
      children.push({
        name: meas.name,
        detail: `WP=${meas.wordPosition ?? "?"}${meas.wordInterval ? `, WI=${meas.wordInterval}` : ""}`,
        kind: "Variable",
        range,
        selectionRange: range,
      });
    }
  }

  for (const conv of model.conversions.values()) {
    const line0 = Math.max(0, conv.line - 1);
    const range: Irig106Range = { start: { line: line0, character: 0 }, end: { line: line0, character: 40 } };
    children.push({
      name: conv.measurementName,
      detail: `${conv.conversionType}${conv.engineeringUnits ? ` (${conv.engineeringUnits})` : ""}`,
      kind: "Function",
      range,
      selectionRange: range,
    });
  }

  const lineCount = Math.max(1, source.split(/\r?\n/).length);
  const rootRange: Irig106Range = {
    start: { line: 0, character: 0 },
    end: { line: lineCount - 1, character: 0 },
  };

  return [
    {
      name: model.name,
      detail: "IRIG 106 Chapter 9 TMATS",
      kind: "Package",
      range: rootRange,
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
      children,
    },
  ];
}

/**
 * Provides contextual hover documentation for a 0-based (line, character) position in a TMATS file.
 */
export function getIrig106Hover(source: string, line: number, _character: number): Irig106HoverResult | null {
  const model = parseIrig106(source);
  const targetLine = line + 1;
  const attr = model.attributes.find((a) => a.line === targetLine);
  if (!attr) return null;

  const baseSub = attr.subPath.replace(/-\d+(?:-\d+)*$/, "");
  const docKey = `${attr.group}\\${baseSub}`;
  const doc = ATTRIBUTE_DOCS[docKey];

  const lines: string[] = [`**\`${attr.rawCode}\`** = \`${attr.value}\``];
  if (doc) lines.push(doc);

  // Enrich with computed commutator schedule if hovering on a measurement name
  if ((attr.group === "D" && baseSub === "MN") || (attr.group === "C" && baseSub === "DCN")) {
    const grid = buildCommutatorGrid(model);
    const sched = grid.schedules.find((s) => s.name === attr.value);
    if (sched) {
      lines.push(
        `Sample Rate: **${sched.sampleRateHz.toFixed(2)} Hz** (Nyquist: ${sched.nyquistBandwidthHz.toFixed(2)} Hz) · Mode: \`${sched.commutationType}\``,
      );
    }
  }

  return {
    contents: lines.join("\n\n"),
    range: {
      start: { line, character: Math.max(0, attr.column - 1) },
      end: { line, character: Math.max(0, attr.column - 1 + attr.rawCode.length) },
    },
  };
}

/**
 * Returns TMATS Chapter 9 attribute & standard sync word completions.
 */
export function getIrig106Completions(_source: string, _line?: number, _character?: number): Irig106CompletionItem[] {
  return [
    {
      label: "G\\PN",
      detail: "Program Name",
      documentation: "General Information group: Program Name.",
      insertText: "G\\PN:PROGRAM_01;",
    },
    {
      label: "P-1\\DLN",
      detail: "PCM Data Link Name",
      documentation: "PCM Format group: Data Link Name.",
      insertText: "P-1\\DLN:PCM_LINK_1;",
    },
    {
      label: "P-1\\D1",
      detail: "PCM Bit Rate (bps)",
      documentation: "PCM Format group: Bit rate in bits per second.",
      insertText: "P-1\\D1:128000;",
    },
    {
      label: "P-1\\F1",
      detail: "Common Word Length (bits)",
      documentation: "PCM Format group: Common word length in bits (4–64).",
      insertText: "P-1\\F1:16;",
    },
    {
      label: "P-1\\MF1",
      detail: "Words per Minor Frame",
      documentation: "PCM Format group: Number of data words per minor frame.",
      insertText: "P-1\\MF1:6;",
    },
    {
      label: "P-1\\MF2",
      detail: "Bits per Minor Frame",
      documentation: "PCM Format group: Total bits per minor frame including sync word.",
      insertText: "P-1\\MF2:128;",
    },
    {
      label: "P-1\\MF4",
      detail: "Frame Sync Pattern",
      documentation: "PCM Format group: Sync pattern (16-bit EB90, 24-bit FAF320, 32-bit FE6B2840).",
      insertText: "P-1\\MF4:FE6B2840;",
    },
    {
      label: "D-1\\MN-1-1",
      detail: "Measurement Name",
      documentation: "PCM Measurement Description: Measurement name.",
      insertText: "D-1\\MN-1-1:CHAN_1;",
    },
    {
      label: "D-1\\WP-1-1",
      detail: "Word Position",
      documentation: "PCM Measurement Description: 1-based word position in minor frame.",
      insertText: "D-1\\WP-1-1:1;",
    },
    {
      label: "D-1\\WI-1-1",
      detail: "Word Interval (Supercommutation)",
      documentation: "PCM Measurement Description: Word interval for supercommutation.",
      insertText: "D-1\\WI-1-1:2;",
    },
    {
      label: "C-1\\DCN",
      detail: "Data Conversion Name",
      documentation: "Data Conversion group: Measurement name matching D-x\\MN.",
      insertText: "C-1\\DCN:CHAN_1;",
    },
    {
      label: "C-1\\DCT",
      detail: "Data Conversion Type",
      documentation: "Data Conversion group: COE (polynomial), DER (derived), PRS (pair sets), NON.",
      insertText: "C-1\\DCT:COE;",
    },
    {
      label: "C-1\\CO-0",
      detail: "Polynomial Coefficient c0",
      documentation: "Data Conversion group: Constant term c0 in y = sum(c_k * x^k).",
      insertText: "C-1\\CO-0:0.0;",
    },
    {
      label: "COMMENT",
      detail: "TMATS Comment",
      documentation: "Free-form TMATS Chapter 9 comment record.",
      insertText: "COMMENT:Telemetry definition;",
    },
  ];
}

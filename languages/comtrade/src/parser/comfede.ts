// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE C37.239 (COMFEDE) Common Format for Event Data Exchange (Sequence of Events / SOE).
 *
 * Parses and serializes time-synchronized SOE records (breaker trips, close commands,
 * relay targets, PMU/DFR triggers) used to correlate field switching with EMT validation.
 */

export interface ComfedeHeader {
  stationName: string;
  deviceId: string;
  revisionYear: number;
  startTimestampIso: string;
  timeCode?: string | undefined;
}

export interface ComfedeEventRecord {
  sequenceNumber: number;
  timestampIso: string;
  offsetMs: number;
  channelId: string;
  description: string;
  state: "OPEN" | "CLOSED" | "ASSERTED" | "CLEARED" | "TRIP" | string;
  phase?: "A" | "B" | "C" | "3P" | undefined;
}

export interface ComfedeDocument {
  header: ComfedeHeader;
  events: ComfedeEventRecord[];
}

import { createWasmParserSync } from "@modelscript/comtrade/wasm-parser";
import { cstLineText, groupAllCstTokensByLine } from "@modelscript/runtime";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let cachedParser: ReturnType<typeof createWasmParserSync>["parser"] | undefined;
function getComtradeWasmParser() {
  if (!cachedParser) {
    const wasmPath = require.resolve("@modelscript/comtrade/parser.wasm");
    cachedParser = createWasmParserSync(wasmPath).parser;
  }
  return cachedParser;
}

/**
 * Parses an IEEE C37.239 COMFEDE (SOE) CSV/ASCII document.
 */
export function parseComfede(text: string): ComfedeDocument {
  const cstTree = getComtradeWasmParser().parse(text);
  const cstLines = groupAllCstTokensByLine(cstTree?.rootNode);
  const lines = cstLines
    .map(({ tokens }) => cstLineText(text, tokens).trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length < 2) {
    throw new Error("Invalid COMFEDE document: missing header lines.");
  }

  const hdrParts = lines[0]!.split(",").map((s) => s.trim());
  const timeParts = lines[1]!.split(",").map((s) => s.trim());

  const header: ComfedeHeader = {
    stationName: hdrParts[0] ?? "UNKNOWN_STATION",
    deviceId: hdrParts[1] ?? "SOE_1",
    revisionYear: Number.parseInt(hdrParts[2] ?? "2010", 10) || 2010,
    startTimestampIso: timeParts[0] ?? new Date(0).toISOString(),
    timeCode: timeParts[1],
  };

  const events: ComfedeEventRecord[] = [];
  for (let idx = 2; idx < lines.length; idx++) {
    const cols = lines[idx]!.split(",").map((s) => s.trim());
    if (cols.length < 6) continue;
    events.push({
      sequenceNumber: Number.parseInt(cols[0]!, 10) || idx - 1,
      timestampIso: cols[1]!,
      offsetMs: Number.parseFloat(cols[2]!) || 0,
      channelId: cols[3]!,
      description: cols[4]!,
      state: cols[5]!,
      phase: cols[6] as ComfedeEventRecord["phase"],
    });
  }

  return { header, events };
}

/**
 * Serializes a `ComfedeDocument` into IEEE C37.239 CSV/ASCII format.
 */
export function serializeComfede(doc: ComfedeDocument): string {
  const lines: string[] = [
    `${doc.header.stationName},${doc.header.deviceId},${doc.header.revisionYear}`,
    `${doc.header.startTimestampIso}${doc.header.timeCode ? `,${doc.header.timeCode}` : ""}`,
  ];
  for (const ev of doc.events) {
    lines.push(
      `${ev.sequenceNumber},${ev.timestampIso},${ev.offsetMs.toFixed(3)},${ev.channelId},${ev.description},${ev.state}${ev.phase ? `,${ev.phase}` : ""}`,
    );
  }
  return lines.join("\n");
}

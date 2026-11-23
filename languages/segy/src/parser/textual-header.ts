// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SEG-Y 40-card × 80-byte (3200-byte) textual reel header parser and formatter.
 */

import type { SegyTextEncoding, SegyTextualCard, SegyTextualHeader } from "../types.js";
import {
  asciiBytesToString,
  asciiToEbcdic,
  detectTextualHeaderEncoding,
  ebcdicToAscii,
  stringToAsciiBytes,
} from "./ebcdic.js";

export const SEGY_TEXTUAL_HEADER_BYTES = 3200;
export const SEGY_CARD_WIDTH = 80;
export const SEGY_CARD_COUNT = 40;

const KEYWORD_PATTERNS: ReadonlyArray<{ key: string; regex: RegExp }> = [
  { key: "CLIENT", regex: /\bCLIENT\s*[:=]?\s*(.+?)(?=\s{2,}|$)/i },
  { key: "LINE", regex: /\bLINE\s*[:=]?\s*(.+?)(?=\s{2,}|$)/i },
  { key: "AREA", regex: /\bAREA\s*[:=]?\s*(.+?)(?=\s{2,}|$)/i },
  { key: "SAMPLE INTERVAL", regex: /\bSAMPLE\s+INTERVAL\s*[:=]?\s*([0-9.]+)\s*(?:US|USEC|MS|MSEC)?/i },
  { key: "TRACE LENGTH", regex: /\bTRACE\s+LENGTH\s*[:=]?\s*([0-9.]+)\s*(?:MS|MSEC|S|SEC)?/i },
  { key: "FORMAT", regex: /\bFORMAT\s*[:=]?\s*(.+?)(?=\s{2,}|$)/i },
  { key: "REV", regex: /\b(?:SEG\s*Y\s*)?REV(?:ISION)?\s*[:=]?\s*([0-9.]+)/i },
];

/**
 * Parses a SEG-Y textual reel header from multi-line text or a flat 3200-character string.
 */
export function parseSegyTextualHeader(text: string, encoding: SegyTextEncoding = "ascii"): SegyTextualHeader {
  let rawCards: string[];
  if (text.includes("\n") || text.includes("\r")) {
    rawCards = text.split(/\r?\n/).filter((l, idx, arr) => !(idx === arr.length - 1 && l === ""));
  } else if (text.length > SEGY_CARD_WIDTH) {
    rawCards = [];
    for (let i = 0; i < text.length && rawCards.length < SEGY_CARD_COUNT; i += SEGY_CARD_WIDTH) {
      rawCards.push(text.slice(i, i + SEGY_CARD_WIDTH));
    }
  } else {
    rawCards = text.length > 0 ? [text] : [];
  }

  const cards: SegyTextualCard[] = [];
  let client: string | undefined;
  let line: string | undefined;
  let area: string | undefined;
  let sampleIntervalUs: number | undefined;
  let traceLengthMs: number | undefined;
  let format: string | undefined;
  let revision: string | undefined;
  let hasEndTextualHeader = false;

  for (let i = 0; i < rawCards.length; i++) {
    const rawLine = rawCards[i]!;
    const cardMatch = /^\s*C\s*(\d{1,2})\s*(.*)$/i.exec(rawLine);
    const cardNumber = cardMatch ? parseInt(cardMatch[1]!, 10) : i + 1;
    const body = cardMatch ? cardMatch[2]!.trim() : rawLine.trim();

    if (/END\s+TEXTUAL\s+HEADER/i.test(body)) {
      hasEndTextualHeader = true;
      cards.push({
        cardNumber,
        raw: rawLine,
        key: "END TEXTUAL HEADER",
        value: "",
        line: i + 1,
      });
      continue;
    }

    let matchedKey: string | undefined;
    let matchedVal: string | undefined;

    for (const pat of KEYWORD_PATTERNS) {
      const m = pat.regex.exec(body);
      if (m && m[1]) {
        const val = m[1].trim();
        if (!matchedKey) {
          matchedKey = pat.key;
          matchedVal = val;
        }
        switch (pat.key) {
          case "CLIENT":
            client ??= val;
            break;
          case "LINE":
            line ??= val;
            break;
          case "AREA":
            area ??= val;
            break;
          case "SAMPLE INTERVAL": {
            const num = Number.parseFloat(val);
            if (Number.isFinite(num)) {
              const isMs = /\bMS\b/i.test(m[0]);
              sampleIntervalUs ??= isMs ? num * 1000 : num;
            }
            break;
          }
          case "TRACE LENGTH": {
            const num = Number.parseFloat(val);
            if (Number.isFinite(num)) {
              traceLengthMs ??= num;
            }
            break;
          }
          case "FORMAT":
            format ??= val;
            break;
          case "REV":
            revision ??= val;
            break;
        }
      }
    }

    cards.push({
      cardNumber,
      raw: rawLine,
      key: matchedKey,
      value: matchedVal,
      line: i + 1,
    });
  }

  return {
    encoding,
    cards,
    client,
    line,
    area,
    sampleIntervalUs,
    traceLengthMs,
    format,
    revision,
    hasEndTextualHeader,
    rawText: text,
  };
}

/**
 * Decodes a 3200-byte binary textual header block (auto-detecting ASCII vs EBCDIC unless specified).
 */
export function decodeTextualHeaderBytes(bytes: Uint8Array, encoding?: SegyTextEncoding): SegyTextualHeader {
  const slice = bytes.subarray(0, Math.min(bytes.length, SEGY_TEXTUAL_HEADER_BYTES));
  const detected = encoding ?? detectTextualHeaderEncoding(slice);
  const text = detected === "ebcdic" ? ebcdicToAscii(slice) : asciiBytesToString(slice);
  return parseSegyTextualHeader(text, detected);
}

/**
 * Formats a `SegyTextualHeader` (or array of card strings) into an exact 3200-character (40 × 80) block.
 */
export function formatSegyTextualHeader(header: SegyTextualHeader | string[]): string {
  const lines = Array.isArray(header) ? header : header.cards.map((c) => c.raw);
  const out: string[] = [];
  for (let i = 0; i < SEGY_CARD_COUNT; i++) {
    const raw = lines[i] ?? `C${String(i + 1).padStart(2, " ")}`;
    const cleaned = raw.replace(/[\r\n]/g, " ");
    out.push(cleaned.slice(0, SEGY_CARD_WIDTH).padEnd(SEGY_CARD_WIDTH, " "));
  }
  return out.join("");
}

/**
 * Encodes a textual header into exactly 3200 bytes in ASCII or EBCDIC.
 */
export function encodeTextualHeaderBytes(
  header: SegyTextualHeader | string[],
  encoding: SegyTextEncoding = "ebcdic",
): Uint8Array {
  const fixed3200 = formatSegyTextualHeader(header);
  return encoding === "ebcdic" ? asciiToEbcdic(fixed3200) : stringToAsciiBytes(fixed3200);
}

/**
 * Creates a standard 40-card SEG-Y Rev 1 textual reel header.
 */
export function createDefaultTextualHeader(opts?: {
  client?: string;
  line?: string;
  area?: string;
  sampleIntervalUs?: number;
  traceLengthMs?: number;
  format?: string;
  revision?: string;
  encoding?: SegyTextEncoding;
}): SegyTextualHeader {
  const client = opts?.client ?? "MODELSCRIPT GEOPHYSICS";
  const line = opts?.line ?? "LINE-001";
  const area = opts?.area ?? "SYNTHETIC BASIN";
  const dtUs = opts?.sampleIntervalUs ?? 2000;
  const traceLenMs = opts?.traceLengthMs ?? 1000;
  const format = opts?.format ?? "1 (4-BYTE IBM FLOATING POINT)";
  const rev = opts?.revision ?? "1.0";
  const encoding = opts?.encoding ?? "ebcdic";

  const cards: string[] = [
    `C 1 CLIENT: ${client}`,
    `C 2 LINE: ${line}`,
    `C 3 AREA: ${area}`,
    `C 4 SAMPLE INTERVAL: ${dtUs} US`,
    `C 5 TRACE LENGTH: ${traceLenMs} MS`,
    `C 6 FORMAT: ${format}`,
    `C 7 SEG Y REV ${rev}`,
  ];
  for (let i = 8; i <= 39; i++) {
    cards.push(`C${String(i).padStart(2, " ")}`);
  }
  cards.push("C40 END TEXTUAL HEADER");

  return parseSegyTextualHeader(cards.join("\n"), encoding);
}

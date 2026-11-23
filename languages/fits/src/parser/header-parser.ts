// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/fits — Textual & 80-Character FITS Header Card Parser and Formatter.
 *
 * Implements FITS 4.0 Section 4.1–4.2 header card parsing (fixed-80-byte blocks
 * as well as newline-delimited FITS header text) and canonical 80-character card formatting.
 */

import type { FitsCard, FitsCardValueType, FitsDocument, FitsHdu, FitsHduKind, FitsHeader } from "../types.js";

export const FITS_CARD_LENGTH = 80;
export const FITS_BLOCK_BYTES = 2880;
export const FITS_CARDS_PER_BLOCK = 36;

const COMMENTARY_KEYWORDS = new Set(["COMMENT", "HISTORY", "CONTINUE", ""]);

/**
 * Splits a value/comment portion (after `= `) into the value substring and optional `/` comment,
 * respecting FITS single-quoted string literals (`''` is an escaped quote).
 */
function splitValueAndComment(rest: string): { valuePart: string; comment: string } {
  let inString = false;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]!;
    if (ch === "'") {
      if (inString && rest[i + 1] === "'") {
        i++; // skip escaped quote ''
        continue;
      }
      inString = !inString;
    } else if (ch === "/" && !inString) {
      return {
        valuePart: rest.slice(0, i).trim(),
        comment: rest.slice(i + 1).trim(),
      };
    }
  }
  return { valuePart: rest.trim(), comment: "" };
}

/**
 * Parses the typed value from a FITS value token string.
 */
function parseFitsValue(valueStr: string): {
  value: boolean | number | string | [number, number] | null;
  valueType: FitsCardValueType;
} {
  if (valueStr.length === 0) {
    return { value: null, valueType: "empty" };
  }

  // Quoted string literal
  if (valueStr.startsWith("'")) {
    let out = "";
    let i = 1;
    while (i < valueStr.length) {
      const ch = valueStr[i]!;
      if (ch === "'") {
        if (valueStr[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        break;
      }
      out += ch;
      i++;
    }
    // FITS 4.0 §4.2.1: trailing spaces in character strings are not significant
    return { value: out.replace(/ +$/, ""), valueType: "string" };
  }

  // Logical T / F
  if (valueStr === "T") {
    return { value: true, valueType: "boolean" };
  }
  if (valueStr === "F") {
    return { value: false, valueType: "boolean" };
  }

  // Complex number: (re, im)
  const complexMatch =
    /^\(\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?)\s*,\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?)\s*\)$/.exec(
      valueStr,
    );
  if (complexMatch) {
    const re = Number(complexMatch[1]!.replace(/[dD]/, "e"));
    const im = Number(complexMatch[2]!.replace(/[dD]/, "e"));
    if (Number.isFinite(re) && Number.isFinite(im)) {
      return { value: [re, im], valueType: "complex" };
    }
  }

  // Integer
  if (/^[+-]?\d+$/.test(valueStr)) {
    const num = Number.parseInt(valueStr, 10);
    if (Number.isSafeInteger(num)) {
      return { value: num, valueType: "integer" };
    }
  }

  // Float (supports Fortran D exponent)
  if (/^[+-]?(?:\d+\.\d*|\.\d+|\d+[eEdD][+-]?\d+)(?:[eEdD][+-]?\d+)?$/.test(valueStr)) {
    const num = Number(valueStr.replace(/[dD]/, "e"));
    if (Number.isFinite(num)) {
      return { value: num, valueType: "float" };
    }
  }

  // Fallback unquoted string
  return { value: valueStr, valueType: "string" };
}

/**
 * Parses a single FITS header card line (80-char fixed card or free-form textual line).
 */
export function parseFitsCard(rawLine: string, line: number, cardIndex: number): FitsCard {
  const trimmed = rawLine.trim();

  // Blank card
  if (trimmed.length === 0) {
    return {
      keyword: "",
      value: null,
      valueType: "empty",
      comment: "",
      raw: rawLine,
      line,
      cardIndex,
    };
  }

  // END card
  if (trimmed === "END" || (rawLine.slice(0, 8).trim() === "END" && rawLine.slice(8).trim() === "")) {
    return {
      keyword: "END",
      value: null,
      valueType: "empty",
      comment: "",
      raw: rawLine,
      line,
      cardIndex,
    };
  }

  // Commentary cards: HISTORY / COMMENT
  const head8 = rawLine.slice(0, 8).trim();
  if (head8 === "HISTORY" || head8 === "COMMENT") {
    return {
      keyword: head8,
      value: null,
      valueType: "comment",
      comment: rawLine.slice(8).trim(),
      raw: rawLine,
      line,
      cardIndex,
    };
  }

  // Standard value indicator `= ` at columns 9-10 (0-based index 8-9) OR free-form `KEY = VAL`
  const eqIndex = rawLine.indexOf("=");
  if (eqIndex > 0) {
    const keyword = rawLine.slice(0, eqIndex).trim();
    const rest = rawLine.slice(eqIndex + 1);
    const { valuePart, comment } = splitValueAndComment(rest);
    const { value, valueType } = parseFitsValue(valuePart);
    return {
      keyword,
      value,
      valueType,
      comment,
      raw: rawLine,
      line,
      cardIndex,
    };
  }

  // Keyword without value indicator (commentary / non-standard)
  return {
    keyword: head8 || trimmed.slice(0, 8),
    value: null,
    valueType: "comment",
    comment: rawLine.slice(8).trim(),
    raw: rawLine,
    line,
    cardIndex,
  };
}

/**
 * Splits a textual FITS header string into raw card strings.
 * Handles both newline-delimited headers and raw 80-character concatenated streams.
 */
export function splitFitsHeaderCards(text: string): string[] {
  if (text.includes("\n") || text.includes("\r")) {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  }
  // No newlines: chunk into 80-character cards
  const cards: string[] = [];
  for (let offset = 0; offset < text.length; offset += FITS_CARD_LENGTH) {
    cards.push(text.slice(offset, offset + FITS_CARD_LENGTH));
  }
  return cards;
}

/**
 * Determines the HDU kind from a parsed FITS header.
 */
export function classifyHduKind(header: FitsHeader, hduIndex: number): FitsHduKind {
  if (hduIndex === 0 && header.keywords["SIMPLE"]) {
    return "PRIMARY";
  }
  const xt = header.keywords["XTENSION"];
  if (xt && typeof xt.value === "string") {
    const upper = xt.value.trim().toUpperCase();
    if (upper === "IMAGE") return "IMAGE";
    if (upper === "TABLE") return "TABLE";
    if (upper === "BINTABLE") return "BINTABLE";
  }
  return hduIndex === 0 ? "PRIMARY" : "UNKNOWN";
}

/**
 * Builds a `FitsHeader` from a list of parsed `FitsCard`s.
 */
export function buildFitsHeader(cards: FitsCard[]): FitsHeader {
  const keywords: Record<string, FitsCard> = {};
  const history: string[] = [];
  const comments: string[] = [];
  const duplicateKeywords: Array<{ keyword: string; line: number }> = [];
  let hasEndCard = false;

  for (const card of cards) {
    if (card.keyword === "END") {
      hasEndCard = true;
      continue;
    }
    if (card.keyword === "HISTORY") {
      history.push(card.comment);
      continue;
    }
    if (card.keyword === "COMMENT") {
      comments.push(card.comment);
      continue;
    }
    if (COMMENTARY_KEYWORDS.has(card.keyword)) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(keywords, card.keyword)) {
      duplicateKeywords.push({ keyword: card.keyword, line: card.line });
    }
    keywords[card.keyword] = card;
  }

  return {
    cards,
    keywords,
    history,
    comments,
    hasEndCard,
    duplicateKeywords,
  };
}

/**
 * Parses textual FITS header content (single or multi-HDU) into a `FitsDocument`.
 */
export function parseFitsHeaderText(text: string, uri?: string): FitsDocument {
  const rawLines = splitFitsHeaderCards(text);
  const hdus: FitsHdu[] = [];

  let currentCards: FitsCard[] = [];
  let cardIndex = 0;

  const flushHdu = (): void => {
    if (currentCards.length === 0) return;
    const header = buildFitsHeader(currentCards);
    const index = hdus.length;
    const kind = classifyHduKind(header, index);
    const extnameCard = header.keywords["EXTNAME"];
    const name =
      extnameCard && typeof extnameCard.value === "string"
        ? extnameCard.value
        : index === 0
          ? "PRIMARY"
          : `HDU_${index}`;
    hdus.push({
      index,
      kind,
      name,
      header,
    });
    currentCards = [];
    cardIndex = 0;
  };

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    const line = i + 1;
    // Skip trailing empty lines after an END card
    if (currentCards.length === 0 && raw.trim().length === 0) {
      continue;
    }
    const card = parseFitsCard(raw, line, cardIndex++);
    currentCards.push(card);
    if (card.keyword === "END") {
      flushHdu();
    }
  }

  // Flush any remaining HDU missing an END card
  if (currentCards.length > 0) {
    flushHdu();
  }

  return {
    uri,
    hdus,
    isBinary: false,
  };
}

/**
 * Formats a single FITS header card into an exact 80-character ASCII string
 * conforming to FITS 4.0 Section 4.1.2.
 */
export function formatFitsCard(keyword: string, value?: boolean | number | string | null, comment?: string): string {
  const kw = keyword.toUpperCase().slice(0, 8);

  if (kw === "END") {
    return "END".padEnd(FITS_CARD_LENGTH, " ");
  }

  if (kw === "COMMENT" || kw === "HISTORY" || kw === "") {
    const prefix = kw.padEnd(8, " ");
    const body = (comment ?? (typeof value === "string" ? value : "")).slice(0, FITS_CARD_LENGTH - 8);
    return (prefix + body).padEnd(FITS_CARD_LENGTH, " ").slice(0, FITS_CARD_LENGTH);
  }

  const keyField = kw.padEnd(8, " ");
  let valField: string;

  if (typeof value === "boolean") {
    valField = (value ? "T" : "F").padStart(20, " ");
  } else if (typeof value === "number") {
    if (Number.isInteger(value) && Math.abs(value) < 1e15) {
      valField = String(value).padStart(20, " ");
    } else {
      const formatted = Number.isFinite(value) ? value.toPrecision(12).replace(/\.?0+(?=e|$)/, "") : "0.0";
      const withDot =
        formatted.includes(".") || formatted.includes("e") || formatted.includes("E")
          ? formatted.toUpperCase()
          : `${formatted}.0`;
      valField = withDot.padStart(20, " ");
    }
  } else if (typeof value === "string") {
    const escaped = value.replace(/'/g, "''");
    const padded = escaped.length < 8 ? escaped.padEnd(8, " ") : escaped;
    valField = `'${padded}'`.padEnd(20, " ");
  } else {
    valField = "".padEnd(20, " ");
  }

  let card = `${keyField}= ${valField}`;
  if (comment && comment.length > 0 && card.length + 3 < FITS_CARD_LENGTH) {
    card += ` / ${comment}`;
  }

  return card.slice(0, FITS_CARD_LENGTH).padEnd(FITS_CARD_LENGTH, " ");
}

/**
 * Serializes a list of 80-char FITS cards into a 2880-byte-aligned ASCII `Uint8Array`,
 * automatically appending an `END` card if not already present.
 */
export function serializeFitsHeaderBlocks(cards: string[]): Uint8Array {
  const normalized = cards.map((c) => c.slice(0, FITS_CARD_LENGTH).padEnd(FITS_CARD_LENGTH, " "));
  const hasEnd = normalized.some((c) => c.slice(0, 8).trim() === "END");
  if (!hasEnd) {
    normalized.push(formatFitsCard("END"));
  }
  const totalCards = Math.ceil(normalized.length / FITS_CARDS_PER_BLOCK) * FITS_CARDS_PER_BLOCK;
  const totalBytes = totalCards * FITS_CARD_LENGTH;
  const out = new Uint8Array(totalBytes);
  out.fill(0x20); // ASCII space padding

  for (let i = 0; i < normalized.length; i++) {
    const card = normalized[i]!;
    const base = i * FITS_CARD_LENGTH;
    for (let j = 0; j < FITS_CARD_LENGTH; j++) {
      const code = card.charCodeAt(j);
      out[base + j] = code >= 0x20 && code <= 0x7e ? code : 0x20;
    }
  }

  return out;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dual-mode parser for USACE HEC-1 (1968) Flood Hydrograph Package card decks.
 *
 * Supports:
 *   1. Classic 8-column fixed-format Fortran card decks (cols 1-2 card code,
 *      cols 3-8 Field 1, cols 9-16 Field 2, ..., cols 73-80 Field 10).
 *   2. Free-format comma-delimited (`LS,,78,15`) and whitespace-delimited
 *      (`RM 3 1.5 0.2`) card decks.
 *   3. Comment cards (`*` in column 1) and blank lines.
 */

import type {
  Hec1Card,
  Hec1CardCode,
  Hec1CardFormat,
  Hec1Deck,
  Hec1ParseError,
  Hec1Station,
  Hec1UnitSystem,
} from "../types.js";

const VALID_CARD_CODES = new Set<Hec1CardCode>([
  "ID",
  "IT",
  "IN",
  "IO",
  "KK",
  "KM",
  "KO",
  "BA",
  "PB",
  "PI",
  "PC",
  "LU",
  "LS",
  "LE",
  "UC",
  "UD",
  "US",
  "BF",
  "RM",
  "RS",
  "RD",
  "HC",
  "ZW",
  "ZZ",
]);

const TEXT_CARDS = new Set<Hec1CardCode>(["ID", "KM", "ZW"]);

export interface ParseHec1Options {
  /** Override unit system (default: "English", matching classic USACE HEC-1). */
  unitSystem?: Hec1UnitSystem | undefined;
  /** Force fixed or free format; default auto-detects per card. */
  format?: Hec1CardFormat | "auto" | undefined;
}

function parseNum(s: string | undefined): number {
  if (s === undefined) return Number.NaN;
  const trimmed = s.trim();
  if (trimmed.length === 0) return Number.NaN;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Detects whether a non-comment, non-text HEC-1 card line uses 8-column fixed
 * format or free format (comma/whitespace delimited).
 */
function detectCardFormat(line: string, mode: Hec1CardFormat | "auto"): Hec1CardFormat {
  if (mode !== "auto") return mode;
  const rest = line.slice(2);
  if (rest.includes(",")) return "free";
  if (rest.includes("\t")) return "free";

  // Check if any token crosses an 8-column boundary (col 8, 16, 24, ...)
  for (let col = 8; col < line.length; col += 8) {
    const prev = line[col - 1];
    const curr = line[col];
    if (prev !== undefined && curr !== undefined && prev !== " " && curr !== " ") {
      return "free";
    }
  }

  // Check if any 8-column slot contains multiple whitespace-separated tokens
  const firstSlot = line.slice(2, 8).trim();
  if (firstSlot.length > 0 && /\s+/.test(firstSlot)) {
    return "free";
  }
  for (let col = 8; col < line.length; col += 8) {
    const slot = line.slice(col, col + 8).trim();
    if (slot.length > 0 && /\s+/.test(slot)) {
      return "free";
    }
  }

  // If the line has at least 8 chars and aligns to 8-col slots (e.g. leading blanks or fixed spacing)
  if (line.length >= 8) {
    return "fixed";
  }

  return "free";
}

function splitFixedFields(line: string): string[] {
  const fields: string[] = [];
  // Field 1: cols 3-8 (indices 2..8)
  fields.push(line.slice(2, 8).trim());
  // Fields 2-10: cols 9-16, 17-24, ..., 73-80
  for (let col = 8; col < Math.max(line.length, 8); col += 8) {
    fields.push(line.slice(col, col + 8).trim());
  }
  // Trim trailing empty fields
  while (fields.length > 0 && fields[fields.length - 1] === "") {
    fields.pop();
  }
  return fields;
}

function splitFreeFields(line: string): string[] {
  const rest = line.slice(2);
  if (rest.includes(",")) {
    // Allow optional leading comma right after card code (e.g. `LS,0.5,75` vs `LS,,75`)
    const trimmedStart = rest.replace(/^[ \t]+/, "");
    const rawParts = trimmedStart.startsWith(",") ? trimmedStart.slice(1).split(",") : trimmedStart.split(",");
    return rawParts.map((p) => p.trim());
  }
  const trimmed = rest.trim();
  if (trimmed.length === 0) return [];
  return trimmed.split(/\s+/);
}

/**
 * Parses a USACE HEC-1 card deck string into a structured `Hec1Deck` model.
 */
export function parseHec1Deck(source: string, options?: ParseHec1Options): Hec1Deck {
  const formatMode = options?.format ?? "auto";
  const unitSystem: Hec1UnitSystem = options?.unitSystem ?? "English";

  const titleLines: string[] = [];
  const stations = new Map<string, Hec1Station>();
  const stationList: Hec1Station[] = [];
  const stationOrder: string[] = [];
  const cards: Hec1Card[] = [];
  const parseErrors: Hec1ParseError[] = [];

  let timeControl: Hec1Deck["timeControl"];
  let outputControl: Hec1Deck["outputControl"];
  let hasEndCard = false;
  let currentStation: Hec1Station | undefined;

  const rawLines = source.split(/\r?\n/);
  let offset = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i] ?? "";
    const lineNum = i + 1;
    const startOffset = offset;
    const endOffset = offset + raw.length;
    offset = endOffset + 1; // +1 for newline

    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;

    // Comment card: '*' in column 1 (or leading '*')
    if (raw.startsWith("*") || trimmed.startsWith("*")) {
      cards.push({
        code: "*",
        fields: [raw.slice(raw.indexOf("*") + 1).trim()],
        numericFields: [],
        raw,
        line: lineNum,
        format: "free",
        startOffset,
        endOffset,
      });
      continue;
    }

    // Card code is first 2 non-whitespace characters
    const leadMatch = raw.match(/^\s*([A-Za-z]{2})(.*)$/);
    if (!leadMatch) {
      parseErrors.push({
        message: `Unrecognized HEC-1 card line '${trimmed.slice(0, 24)}'`,
        line: lineNum,
        column: 1,
        raw,
      });
      continue;
    }

    const codeUpper = leadMatch[1]!.toUpperCase() as Hec1CardCode;
    if (!VALID_CARD_CODES.has(codeUpper)) {
      parseErrors.push({
        message: `Unknown HEC-1 card code '${codeUpper}'`,
        line: lineNum,
        column: 1,
        raw,
      });
      continue;
    }

    let format: Hec1CardFormat;
    let fields: string[];
    if (TEXT_CARDS.has(codeUpper)) {
      format = "free";
      fields = [raw.slice(2).trim()];
    } else if (codeUpper === "KK") {
      // KK field 1 is station ID (cols 3-8 in fixed format, or first token in free format)
      format = detectCardFormat(raw, formatMode);
      if (format === "fixed") {
        const idField = raw.slice(2, 8).trim();
        const descField = raw.slice(8).trim();
        fields = descField.length > 0 ? [idField, descField] : idField.length > 0 ? [idField] : [];
      } else {
        const rest = raw.slice(2).trim();
        if (rest.includes(",")) {
          fields = splitFreeFields(raw);
        } else {
          const m = rest.match(/^(\S+)(?:\s+(.*))?$/);
          fields = m ? (m[2] ? [m[1]!, m[2].trim()] : [m[1]!]) : [];
        }
      }
    } else {
      format = detectCardFormat(raw, formatMode);
      fields = format === "fixed" ? splitFixedFields(raw) : splitFreeFields(raw);
    }

    const numericFields = fields.map((f) => parseNum(f));
    const card: Hec1Card = {
      code: codeUpper,
      fields,
      numericFields,
      raw,
      line: lineNum,
      format,
      startOffset,
      endOffset,
    };
    cards.push(card);

    // Dispatch card semantics
    switch (codeUpper) {
      case "ID": {
        if (fields[0]) titleLines.push(fields[0]);
        break;
      }

      case "IT": {
        const nmin = numericFields[0] ?? Number.NaN;
        const idate = fields[1] || undefined;
        const itime = fields[2] || undefined;
        const nq = numericFields[3] ?? (Number.isFinite(numericFields[1]) && !idate ? numericFields[1]! : Number.NaN);
        const iddate = fields[4] || undefined;
        const itdate = fields[5] || undefined;
        timeControl = {
          nmin: Number.isFinite(nmin) ? nmin : 0,
          idate,
          itime,
          nq: Number.isFinite(nq) ? nq : 0,
          iddate,
          itdate,
          precipIntervalMin: timeControl?.precipIntervalMin,
          line: lineNum,
        };
        break;
      }

      case "IN": {
        const inMin = numericFields[0];
        if (Number.isFinite(inMin)) {
          if (timeControl) {
            timeControl.precipIntervalMin = inMin;
          } else {
            timeControl = {
              nmin: inMin!,
              nq: 0,
              precipIntervalMin: inMin,
              line: lineNum,
            };
          }
        }
        break;
      }

      case "IO": {
        outputControl = {
          iprint: Number.isFinite(numericFields[0]) ? numericFields[0] : undefined,
          iplot: Number.isFinite(numericFields[1]) ? numericFields[1] : undefined,
          line: lineNum,
        };
        break;
      }

      case "KK": {
        const stationId = (fields[0] ?? "").trim();
        if (!stationId) {
          parseErrors.push({
            message: "Missing station identifier on 'KK' card",
            line: lineNum,
            column: 3,
            raw,
          });
          break;
        }
        const station: Hec1Station = {
          id: stationId,
          description: fields[1] || undefined,
          kind: "unknown",
          line: lineNum,
          startOffset,
          endOffset,
          cards: [card],
        };
        stationList.push(station);
        if (!stations.has(stationId)) {
          stations.set(stationId, station);
          stationOrder.push(stationId);
        }
        currentStation = station;
        break;
      }

      case "KM": {
        if (currentStation) {
          currentStation.cards.push(card);
          currentStation.endOffset = endOffset;
          const desc = fields[0] ?? "";
          if (desc) {
            currentStation.description = currentStation.description ? `${currentStation.description} ${desc}` : desc;
          }
        }
        break;
      }

      case "KO":
      case "RD": {
        if (currentStation) {
          currentStation.cards.push(card);
          currentStation.endOffset = endOffset;
        }
        break;
      }

      case "BA": {
        if (currentStation) {
          currentStation.cards.push(card);
          currentStation.endOffset = endOffset;
          currentStation.kind = "subbasin";
          currentStation.area = Number.isFinite(numericFields[0]) ? numericFields[0] : Number.NaN;
          currentStation.areaLine = lineNum;
        }
        break;
      }

      case "PB": {
        if (currentStation) {
          currentStation.cards.push(card);
          currentStation.endOffset = endOffset;
          if (Number.isFinite(numericFields[0])) {
            currentStation.precipitationTotal = numericFields[0];
          }
        }
        break;
      }

      case "PI": {
        if (currentStation) {
          currentStation.cards.push(card);
          currentStation.endOffset = endOffset;
          const vals = numericFields.filter((v) => Number.isFinite(v));
          currentStation.precipitationIncrements = [...(currentStation.precipitationIncrements ?? []), ...vals];
        }
        break;
      }

      case "PC": {
        if (currentStation) {
          currentStation.cards.push(card);
          currentStation.endOffset = endOffset;
          const vals = numericFields.filter((v) => Number.isFinite(v));
          currentStation.precipitationCumulative = [...(currentStation.precipitationCumulative ?? []), ...vals];
        }
        break;
      }

      case "LS": {
        if (currentStation) {
          currentStation.cards.push(card);
          currentStation.endOffset = endOffset;
          if (currentStation.kind === "unknown") currentStation.kind = "subbasin";
          const strtl = Number.isFinite(numericFields[0]) ? numericFields[0] : undefined;
          const curveNumber = Number.isFinite(numericFields[1]) ? numericFields[1]! : Number.NaN;
          const rtimp = Number.isFinite(numericFields[2]) ? numericFields[2]! : 0;
          currentStation.loss = {
            method: "SCS",
            strtl,
            curveNumber,
            rtimp,
            line: lineNum,
          };
        }
        break;
      }

      case "LU": {
        if (currentStation) {
          currentStation.cards.push(card);
          currentStation.endOffset = endOffset;
          if (currentStation.kind === "unknown") currentStation.kind = "subbasin";
          currentStation.loss = {
            method: "Uniform",
            strtl: Number.isFinite(numericFields[0]) ? numericFields[0]! : 0,
            cnstl: Number.isFinite(numericFields[1]) ? numericFields[1]! : 0,
            rtimp: Number.isFinite(numericFields[2]) ? numericFields[2]! : 0,
            line: lineNum,
          };
        }
        break;
      }

      case "LE": {
        if (currentStation) {
          currentStation.cards.push(card);
          currentStation.endOffset = endOffset;
          if (currentStation.kind === "unknown") currentStation.kind = "subbasin";
          currentStation.loss = {
            method: "Exponential",
            strkr: Number.isFinite(numericFields[0]) ? numericFields[0]! : 0,
            dltkr: Number.isFinite(numericFields[1]) ? numericFields[1]! : 0,
            rtiql: Number.isFinite(numericFields[2]) ? numericFields[2]! : 1,
            erain: Number.isFinite(numericFields[3]) ? numericFields[3]! : 0.5,
            rtimp: Number.isFinite(numericFields[4]) ? numericFields[4]! : 0,
            line: lineNum,
          };
        }
        break;
      }

      case "UC": {
        if (currentStation) {
          currentStation.cards.push(card);
          currentStation.endOffset = endOffset;
          if (currentStation.kind === "unknown") currentStation.kind = "subbasin";
          currentStation.unitHydrograph = {
            method: "Clark",
            tc: Number.isFinite(numericFields[0]) ? numericFields[0]! : Number.NaN,
            r: Number.isFinite(numericFields[1]) ? numericFields[1]! : Number.NaN,
            line: lineNum,
          };
        }
        break;
      }

      case "UD": {
        if (currentStation) {
          currentStation.cards.push(card);
          currentStation.endOffset = endOffset;
          if (currentStation.kind === "unknown") currentStation.kind = "subbasin";
          currentStation.unitHydrograph = {
            method: "SCS",
            tlag: Number.isFinite(numericFields[0]) ? numericFields[0]! : Number.NaN,
            line: lineNum,
          };
        }
        break;
      }

      case "US": {
        if (currentStation) {
          currentStation.cards.push(card);
          currentStation.endOffset = endOffset;
          if (currentStation.kind === "unknown") currentStation.kind = "subbasin";
          currentStation.unitHydrograph = {
            method: "Snyder",
            tp: Number.isFinite(numericFields[0]) ? numericFields[0]! : Number.NaN,
            cp: Number.isFinite(numericFields[1]) ? numericFields[1]! : Number.NaN,
            line: lineNum,
          };
        }
        break;
      }

      case "BF": {
        if (currentStation) {
          currentStation.cards.push(card);
          currentStation.endOffset = endOffset;
          currentStation.baseflow = {
            strtq: Number.isFinite(numericFields[0]) ? numericFields[0]! : 0,
            qrcsn: Number.isFinite(numericFields[1]) ? numericFields[1]! : 0,
            rtior: Number.isFinite(numericFields[2]) ? numericFields[2]! : 1.0,
            line: lineNum,
          };
        }
        break;
      }

      case "RM": {
        if (currentStation) {
          currentStation.cards.push(card);
          currentStation.endOffset = endOffset;
          currentStation.kind = "route";
          currentStation.muskingum = {
            nstps: Number.isFinite(numericFields[0]) ? numericFields[0]! : 1,
            amskk: Number.isFinite(numericFields[1]) ? numericFields[1]! : Number.NaN,
            x: Number.isFinite(numericFields[2]) ? numericFields[2]! : Number.NaN,
            tstra: Number.isFinite(numericFields[3]) ? numericFields[3] : undefined,
            line: lineNum,
          };
        }
        break;
      }

      case "RS": {
        if (currentStation) {
          currentStation.cards.push(card);
          currentStation.endOffset = endOffset;
          currentStation.kind = "route";
          currentStation.storageRouting = {
            nstps: Number.isFinite(numericFields[0]) ? numericFields[0]! : 1,
            ityp: Number.isFinite(numericFields[1]) ? numericFields[1]! : 0,
            rsvric: Number.isFinite(numericFields[2]) ? numericFields[2]! : 0,
            x: Number.isFinite(numericFields[3]) ? numericFields[3]! : 0,
            line: lineNum,
          };
        }
        break;
      }

      case "HC": {
        if (currentStation) {
          currentStation.cards.push(card);
          currentStation.endOffset = endOffset;
          currentStation.kind = "combine";
          currentStation.combineCount = Number.isFinite(numericFields[0]) ? numericFields[0]! : 0;
          currentStation.combineLine = lineNum;
        }
        break;
      }

      case "ZW": {
        if (currentStation) {
          currentStation.cards.push(card);
          currentStation.endOffset = endOffset;
          currentStation.dssWritePath = fields[0] || undefined;
        }
        break;
      }

      case "ZZ": {
        hasEndCard = true;
        break;
      }

      case "*":
        break;
    }
  }

  return {
    titleLines,
    timeControl,
    outputControl,
    stations,
    stationList,
    stationOrder,
    cards,
    hasEndCard,
    unitSystem,
    parseErrors,
  };
}

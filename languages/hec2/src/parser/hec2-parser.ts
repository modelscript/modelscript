// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  Hec2BridgeData,
  Hec2CrossSection,
  Hec2Deck,
  Hec2DischargeTableCard,
  Hec2HorizontalManningCard,
  Hec2HorizontalManningPair,
  Hec2Job2Card,
  Hec2JobCard,
  Hec2ManningCard,
  Hec2ParseError,
  Hec2RawCard,
  Hec2UnitSystem,
} from "../types.js";

const VALID_CARD_CODES = new Set([
  "T1",
  "T2",
  "T3",
  "J1",
  "J2",
  "J3",
  "J4",
  "J5",
  "J6",
  "NC",
  "NH",
  "NV",
  "QT",
  "X1",
  "X2",
  "X3",
  "X4",
  "X5",
  "GR",
  "SB",
  "BT",
  "CI",
  "EJ",
  "ER",
]);

const SINGLE_NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Parses numeric fields of a single HEC-2 card line (after the 2-char card code),
 * supporting both classic 8-column Fortran fixed-format (cols 3-8, 9-16, ..., 73-80)
 * and free-format (comma-delimited or whitespace-delimited).
 */
export function parseCardFields(
  line: string,
  lineNum: number,
  parseErrors: Hec2ParseError[],
): { fields: Array<number | null>; format: "fixed" | "free" } {
  const rest = line.slice(2);
  if (rest.trim().length === 0) {
    return { fields: [], format: "fixed" };
  }

  // 1. Comma-delimited free-format
  if (rest.includes(",")) {
    const trimmedRest = rest.startsWith(",") ? rest.slice(1) : rest;
    const rawParts = trimmedRest.split(",");
    const fields: Array<number | null> = [];
    for (const part of rawParts) {
      const t = part.trim();
      if (t.length === 0) {
        fields.push(null);
      } else if (SINGLE_NUM_RE.test(t)) {
        fields.push(Number(t));
      } else {
        parseErrors.push({
          line: lineNum,
          message: `Invalid numeric token '${t}' in free-format card`,
        });
        fields.push(null);
      }
    }
    return { fields, format: "free" };
  }

  // 2. Test classic 8-column fixed-format (field 1: cols 3..8, fields 2..10: 8-char slices)
  const fixedFields: Array<number | null> = [];
  let fixedValid = line.length <= 84;
  if (fixedValid) {
    const ranges: Array<[number, number]> = [
      [2, 8],
      [8, 16],
      [16, 24],
      [24, 32],
      [32, 40],
      [40, 48],
      [48, 56],
      [56, 64],
      [64, 72],
      [72, 80],
    ];
    let hasAny = false;
    for (const [start, end] of ranges) {
      if (start >= line.length) break;
      const slice = line.slice(start, end).trim();
      if (slice.length === 0) {
        fixedFields.push(null);
      } else if (SINGLE_NUM_RE.test(slice)) {
        fixedFields.push(Number(slice));
        hasAny = true;
      } else {
        fixedValid = false;
        break;
      }
    }
    // Check for leftover non-whitespace beyond col 80
    if (fixedValid && line.length > 80 && line.slice(80).trim().length > 0) {
      fixedValid = false;
    }
    if (fixedValid && hasAny) {
      // Trim trailing nulls
      while (fixedFields.length > 0 && fixedFields[fixedFields.length - 1] === null) {
        fixedFields.pop();
      }
      return { fields: fixedFields, format: "fixed" };
    }
  }

  // 3. Whitespace-delimited free-format
  const tokens = rest.trim().split(/\s+/);
  const freeFields: Array<number | null> = [];
  for (const tok of tokens) {
    if (SINGLE_NUM_RE.test(tok)) {
      freeFields.push(Number(tok));
    } else {
      parseErrors.push({
        line: lineNum,
        message: `Invalid numeric token '${tok}' in card`,
      });
      freeFields.push(null);
    }
  }
  return { fields: freeFields, format: "free" };
}

function fieldVal(fields: Array<number | null>, index0: number): number | undefined {
  const v = fields[index0];
  return v !== null && v !== undefined && Number.isFinite(v) ? v : undefined;
}

/**
 * Parses a complete USACE HEC-2 Water Surface Profiles card deck into a structured `Hec2Deck`.
 */
export function parseHec2Deck(text: string): Hec2Deck {
  const lines = text.split(/\r?\n/);

  const titles: string[] = [];
  const jobCards: Hec2RawCard[] = [];
  const manningCards: Hec2ManningCard[] = [];
  const horizontalManningCards: Hec2HorizontalManningCard[] = [];
  const crossSections: Hec2CrossSection[] = [];
  const cards: Hec2RawCard[] = [];
  const parseErrors: Hec2ParseError[] = [];

  let units: Hec2UnitSystem = "US";
  let jobCard: Hec2JobCard | undefined;
  let job2Card: Hec2Job2Card | undefined;
  let dischargeTable: Hec2DischargeTableCard | undefined;
  let hasEndJob = false;
  let hasEndRun = false;

  // Running Manning's n and loss coefficients (inherited across X1 cards per HEC-2 spec)
  let currentManning = { left: 0.035, right: 0.035, channel: 0.03 };
  let currentCchv = 0.1;
  let currentCehv = 0.3;

  // Pending NH or bridge cards declared before/after X1
  let pendingNh: Hec2HorizontalManningPair[] | undefined;
  let pendingBridge: Hec2BridgeData | undefined;
  let currentXs: Hec2CrossSection | undefined;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const lineNum = i + 1;

    if (rawLine.trim().length === 0) continue;

    // Comment cards: "C " or "C" alone or "*" or "!" in column 1
    if (
      rawLine.startsWith("C ") ||
      rawLine.startsWith("c ") ||
      rawLine.trim() === "C" ||
      rawLine.trim() === "c" ||
      rawLine.startsWith("*") ||
      rawLine.startsWith("!")
    ) {
      cards.push({
        code: "C ",
        fields: [],
        rawText: rawLine,
        line: lineNum,
        format: "fixed",
      });
      continue;
    }

    const code = rawLine.slice(0, 2).toUpperCase();
    if (!VALID_CARD_CODES.has(code)) {
      parseErrors.push({
        line: lineNum,
        message: `Unrecognized HEC-2 card code '${code.trim() || rawLine.slice(0, 2)}'`,
      });
      continue;
    }

    // Title cards (T1, T2, T3) carry free-form text in cols 3..80
    if (code === "T1" || code === "T2" || code === "T3") {
      const titleText = rawLine.slice(2).trim();
      titles.push(titleText);
      cards.push({
        code,
        fields: [],
        rawText: rawLine,
        line: lineNum,
        format: "fixed",
      });
      continue;
    }

    // End cards
    if (code === "EJ") {
      hasEndJob = true;
      cards.push({ code, fields: [], rawText: rawLine, line: lineNum, format: "fixed" });
      continue;
    }
    if (code === "ER") {
      hasEndRun = true;
      cards.push({ code, fields: [], rawText: rawLine, line: lineNum, format: "fixed" });
      continue;
    }

    const { fields, format } = parseCardFields(rawLine, lineNum, parseErrors);
    const rawCard: Hec2RawCard = { code, fields, rawText: rawLine, line: lineNum, format };
    cards.push(rawCard);

    switch (code) {
      case "J1": {
        const metricFlag = fieldVal(fields, 5);
        if (metricFlag === 1) {
          units = "SI";
        }
        jobCard = {
          icheck: fieldVal(fields, 0),
          inq: fieldVal(fields, 1),
          ninv: fieldVal(fields, 2),
          idir: fieldVal(fields, 3),
          strt: fieldVal(fields, 4),
          metric: metricFlag,
          hvins: fieldVal(fields, 6),
          q: fieldVal(fields, 7),
          wsel: fieldVal(fields, 8),
          fq: fieldVal(fields, 9),
          line: lineNum,
        };
        break;
      }

      case "J2": {
        job2Card = {
          nprof: fieldVal(fields, 0),
          iplot: fieldVal(fields, 1),
          prfvs: fieldVal(fields, 2),
          xsecv: fieldVal(fields, 3),
          xsech: fieldVal(fields, 4),
          fn: fieldVal(fields, 5),
          alldc: fieldVal(fields, 6),
          ibw: fieldVal(fields, 7),
          chnim: fieldVal(fields, 8),
          itrace: fieldVal(fields, 9),
          line: lineNum,
        };
        break;
      }

      case "J3":
      case "J4":
      case "J5":
      case "J6": {
        jobCards.push(rawCard);
        break;
      }

      case "NC": {
        const f1 = fieldVal(fields, 0);
        const f2 = fieldVal(fields, 1);
        const f3 = fieldVal(fields, 2);
        const f4 = fieldVal(fields, 3);
        const f5 = fieldVal(fields, 4);

        const nc: Hec2ManningCard = {
          xnl: f1 !== undefined ? f1 : currentManning.left,
          xnr: f2 !== undefined ? f2 : currentManning.right,
          xnch: f3 !== undefined ? f3 : currentManning.channel,
          cchv: f4 !== undefined ? f4 : currentCchv,
          cehv: f5 !== undefined ? f5 : currentCehv,
          line: lineNum,
        };
        manningCards.push(nc);

        if (f1 !== undefined && f1 > 0) currentManning.left = f1;
        if (f2 !== undefined && f2 > 0) currentManning.right = f2;
        if (f3 !== undefined && f3 > 0) currentManning.channel = f3;
        if (f4 !== undefined && f4 >= 0) currentCchv = f4;
        if (f5 !== undefined && f5 >= 0) currentCehv = f5;
        break;
      }

      case "NH": {
        const numnh = fieldVal(fields, 0) ?? 0;
        const pairs: Hec2HorizontalManningPair[] = [];
        for (let k = 1; k + 1 < fields.length; k += 2) {
          const nVal = fieldVal(fields, k);
          const staVal = fieldVal(fields, k + 1);
          if (nVal !== undefined && staVal !== undefined) {
            pairs.push({ n: nVal, station: staVal });
          }
        }
        horizontalManningCards.push({ numnh, pairs, line: lineNum });
        pendingNh = pairs;
        break;
      }

      case "QT": {
        const numq = fieldVal(fields, 0) ?? 0;
        const discharges: number[] = [];
        for (let k = 1; k < fields.length; k++) {
          const qv = fieldVal(fields, k);
          if (qv !== undefined) discharges.push(qv);
        }
        dischargeTable = { numq, discharges, line: lineNum };
        break;
      }

      case "X1": {
        const secno = fieldVal(fields, 0) ?? 0;
        const numst = fieldVal(fields, 1) ?? 0;
        const stchl = fieldVal(fields, 2) ?? 0;
        const stchr = fieldVal(fields, 3) ?? 0;
        const xlobl = fieldVal(fields, 4) ?? 0;
        const xlobr = fieldVal(fields, 5) ?? 0;
        const xlch = fieldVal(fields, 6) ?? 0;
        const pxsecr = fieldVal(fields, 7) ?? 0;
        const pxsece = fieldVal(fields, 8) ?? 0;

        // Repeated cross-section when NUMST === 0 and a previous section exists
        const prevXs = crossSections[crossSections.length - 1];
        const inheritedGr =
          numst === 0 && prevXs
            ? prevXs.grPoints.map((pt) => ({
                elevation: pt.elevation + pxsece,
                station: pxsecr > 0 ? pt.station * pxsecr : pt.station,
              }))
            : [];

        const xs: Hec2CrossSection = {
          secno,
          numst,
          stchl: numst === 0 && stchl === 0 && prevXs ? prevXs.stchl : stchl,
          stchr: numst === 0 && stchr === 0 && prevXs ? prevXs.stchr : stchr,
          xlobl,
          xlobr,
          xlch,
          pxsecr,
          pxsece,
          manning: { ...currentManning },
          contractionCoef: currentCchv,
          expansionCoef: currentCehv,
          horizontalManning: pendingNh,
          grPoints: inheritedGr,
          bridge: pendingBridge,
          line: lineNum,
        };
        pendingNh = undefined;
        pendingBridge = undefined;
        crossSections.push(xs);
        currentXs = xs;
        break;
      }

      case "X2": {
        const target = currentXs;
        const b: Hec2BridgeData = target?.bridge ?? { line: lineNum };
        b.ibridg = fieldVal(fields, 2);
        b.ellc = fieldVal(fields, 3);
        b.eltrd = fieldVal(fields, 4);
        if (target) {
          target.bridge = b;
        } else {
          pendingBridge = b;
        }
        break;
      }

      case "SB": {
        const b: Hec2BridgeData = pendingBridge ?? { line: lineNum };
        b.xk = fieldVal(fields, 0);
        b.xkor = fieldVal(fields, 1);
        b.cofq = fieldVal(fields, 2);
        b.rdlen = fieldVal(fields, 3);
        b.bwp = fieldVal(fields, 4);
        b.barea = fieldVal(fields, 5);
        b.ss = fieldVal(fields, 6);
        b.elchU = fieldVal(fields, 7);
        b.elchD = fieldVal(fields, 8);
        pendingBridge = b;
        break;
      }

      case "BT": {
        const b: Hec2BridgeData = pendingBridge ?? { line: lineNum };
        if (!b.bridgeTable) b.bridgeTable = [];
        // BT format: field 1 = NRD (on first BT), then triplets (station, highChord, lowChord)
        const startIdx = b.bridgeTable.length === 0 ? 1 : 0;
        for (let k = startIdx; k + 2 < fields.length; k += 3) {
          const sta = fieldVal(fields, k);
          const hi = fieldVal(fields, k + 1);
          const lo = fieldVal(fields, k + 2);
          if (sta !== undefined && hi !== undefined && lo !== undefined) {
            b.bridgeTable.push({ station: sta, highChord: hi, lowChord: lo });
          }
        }
        pendingBridge = b;
        break;
      }

      case "GR": {
        if (!currentXs) {
          parseErrors.push({
            line: lineNum,
            message: `'GR' ground profile card appeared before any 'X1' cross-section card`,
          });
          break;
        }
        const scale = currentXs.pxsecr > 0 ? currentXs.pxsecr : 1.0;
        const shift = currentXs.pxsece;
        for (let k = 0; k + 1 < fields.length; k += 2) {
          const el = fieldVal(fields, k);
          const sta = fieldVal(fields, k + 1);
          if (el !== undefined && sta !== undefined) {
            currentXs.grPoints.push({
              elevation: el + shift,
              station: sta * scale,
            });
          }
        }
        break;
      }

      default:
        // NV, X3, X4, X5, CI preserved in raw `cards`
        break;
    }
  }

  return {
    titles,
    units,
    jobCard,
    job2Card,
    jobCards,
    manningCards,
    horizontalManningCards,
    dischargeTable,
    crossSections,
    cards,
    hasEndJob,
    hasEndRun,
    parseErrors,
  };
}

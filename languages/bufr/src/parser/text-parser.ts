// SPDX-License-Identifier: AGPL-3.0-or-later

import { lookupTableB, parseBufrDescriptor } from "../catalog/wmo-tables.js";
import type {
  BufrDescriptor,
  BufrMessage,
  BufrObservationValue,
  BufrSubset,
  BufrTableBEntry,
  BufrTableDEntry,
} from "../types.js";

function stripComment(line: string): string {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"' && line[i - 1] !== "\\") {
      inQuote = !inQuote;
    } else if (ch === "#" && !inQuote) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseScalarValue(raw: string): number | string | null {
  const t = raw.trim();
  if (!t || /^missing$/i.test(t) || /^null$/i.test(t) || /^nan$/i.test(t)) {
    return null;
  }
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  const num = Number(t);
  if (!Number.isNaN(num) && Number.isFinite(num)) {
    return num;
  }
  return t;
}

/**
 * Parses a textual WMO BUFR document (`.bufr`, `.bfr`, `.bufr.txt`) into a `BufrMessage`.
 */
export function parseBufrText(source: string, name = "BUFR_MESSAGE"): BufrMessage {
  const lines = source.split(/\r?\n/);

  const customTableB = new Map<string, BufrTableBEntry>();
  const customTableD = new Map<string, BufrTableDEntry>();
  const descriptors: BufrDescriptor[] = [];
  const subsets: BufrSubset[] = [];
  const syntaxErrors: Array<{ message: string; line: number; column: number }> = [];

  const section0: BufrMessage["section0"] = {
    magic: "BUFR",
    totalLength: 0,
    edition: 4,
  };
  const section1: BufrMessage["section1"] = {
    masterTable: 0,
    originatingCentre: 7,
    originatingSubCentre: 0,
    updateSequence: 0,
    optionalSection: false,
    dataCategory: 0,
    internationalSubCategory: 0,
    localSubCategory: 0,
    masterTableVersion: 38,
    localTableVersion: 0,
    year: 2026,
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
  };
  const section3: BufrMessage["section3"] = {
    subsetCount: 0,
    isObserved: true,
    isCompressed: false,
    descriptors,
  };

  let declaredSubsetCount: number | undefined;
  let hasMagicHeader = false;
  let hasEndMarker = false;
  let currentSection: "NONE" | "SEC0" | "SEC1" | "SEC3" | "SEC4" | "SEC5" | "TABLE_B" | "TABLE_D" = "NONE";
  let currentSubset: BufrSubset | null = null;
  let offset = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx]!;
    const lineNo = idx + 1;
    const lineStartOffset = offset;
    offset += rawLine.length + 1;

    const cleaned = stripComment(rawLine).trim();
    if (!cleaned) continue;

    // Header: BUFR [EDITION 3|4] [NAME ...]
    if (/^BUFR\b/i.test(cleaned)) {
      hasMagicHeader = true;
      section0.line = lineNo;
      const edMatch = /\bEDITION\s+(\d+)/i.exec(cleaned);
      if (edMatch) {
        const ed = Number.parseInt(edMatch[1]!, 10);
        if (ed === 3 || ed === 4) {
          section0.edition = ed;
        } else {
          syntaxErrors.push({ message: `Unsupported BUFR edition '${ed}' (expected 3 or 4)`, line: lineNo, column: 1 });
        }
      }
      const nameMatch = /\bNAME\s+([A-Za-z0-9_.-]+)/i.exec(cleaned);
      if (nameMatch) {
        name = nameMatch[1]!;
      }
      continue;
    }

    // End sentinel: 7777
    if (/^7777\b/.test(cleaned)) {
      hasEndMarker = true;
      currentSection = "SEC5";
      continue;
    }

    // Section headers
    const secMatch = /^SECTION\s+(\d+)\b/i.exec(cleaned);
    if (secMatch) {
      const secNum = Number.parseInt(secMatch[1]!, 10);
      if (secNum === 0) {
        currentSection = "SEC0";
        section0.line = lineNo;
      } else if (secNum === 1) {
        currentSection = "SEC1";
        section1.line = lineNo;
      } else if (secNum === 3) {
        currentSection = "SEC3";
        section3.line = lineNo;
      } else if (secNum === 4) {
        currentSection = "SEC4";
      } else if (secNum === 5) {
        currentSection = "SEC5";
      } else {
        syntaxErrors.push({ message: `Unknown BUFR section '${secNum}'`, line: lineNo, column: 1 });
      }
      continue;
    }

    if (/^TABLE_B\b/i.test(cleaned)) {
      currentSection = "TABLE_B";
      continue;
    }
    if (/^TABLE_D\b/i.test(cleaned)) {
      currentSection = "TABLE_D";
      continue;
    }
    if (/^DESCRIPTORS\s*:?\s*$/i.test(cleaned)) {
      currentSection = "SEC3";
      continue;
    }

    // SUBSET header inside Section 4
    const subsetMatch = /^SUBSET(?:\s+(\d+))?(?:\s+([A-Za-z0-9_.-]+))?\s*:?\s*$/i.exec(cleaned);
    if (subsetMatch) {
      currentSection = "SEC4";
      const subIdx = subsetMatch[1] ? Number.parseInt(subsetMatch[1], 10) : subsets.length + 1;
      currentSubset = {
        index: subIdx,
        label: subsetMatch[2] ?? `SUBSET_${subIdx}`,
        values: [],
        line: lineNo,
        startOffset: lineStartOffset,
        endOffset: lineStartOffset + rawLine.length,
      };
      subsets.push(currentSubset);
      continue;
    }

    // Custom Table B entry: 0-XX-YYY name="..." unit="..." scale=0 ref=0 width=16
    if (currentSection === "TABLE_B") {
      const tbMatch = /^(\d+-\d+-\d+)\s+(.*)$/.exec(cleaned);
      if (tbMatch) {
        const desc = parseBufrDescriptor(tbMatch[1]!, lineNo, lineStartOffset, lineStartOffset + tbMatch[1]!.length);
        const rest = tbMatch[2]!;
        if (desc && desc.f === 0) {
          const getAttr = (k: string): string | undefined => {
            const m = new RegExp(`\\b${k}\\s*=\\s*(?:"([^"]*)"|([^\\s,]+))`, "i").exec(rest);
            return m ? (m[1] ?? m[2]) : undefined;
          };
          customTableB.set(desc.code, {
            code: desc.code,
            f: 0,
            x: desc.x,
            y: desc.y,
            name: getAttr("name") ?? desc.code,
            unit: getAttr("unit") ?? "Numeric",
            scale: Number(getAttr("scale") ?? 0),
            referenceValue: Number(getAttr("ref") ?? getAttr("reference") ?? 0),
            bitWidth: Number(getAttr("width") ?? getAttr("bits") ?? 16),
            isString: /CCITT|IA5|STRING/i.test(getAttr("unit") ?? ""),
          });
          continue;
        }
      }
    }

    // Custom Table D entry: 3-XX-YYY = [0-01-001, 0-01-002]
    if (currentSection === "TABLE_D") {
      const tdMatch = /^(\d+-\d+-\d+)\s*=\s*\[([^\]]+)\](?:\s+"([^"]*)")?/.exec(cleaned);
      if (tdMatch) {
        const desc = parseBufrDescriptor(tdMatch[1]!, lineNo, lineStartOffset, lineStartOffset + tdMatch[1]!.length);
        if (desc && desc.f === 3) {
          const children = tdMatch[2]!
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean);
          customTableD.set(desc.code, {
            code: desc.code,
            f: 3,
            x: desc.x,
            y: desc.y,
            name: tdMatch[3] ?? desc.code,
            descriptors: children,
          });
          continue;
        }
      }
    }

    // Key = Value assignments
    const kvMatch = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(cleaned);
    if (kvMatch) {
      const rawKey = kvMatch[1]!;
      const rawVal = kvMatch[2]!.trim();
      const keyUpper = rawKey.toUpperCase();

      // Observation assignment: F-XX-YYY = value
      const obsDesc = parseBufrDescriptor(rawKey, lineNo, lineStartOffset, lineStartOffset + rawLine.length);
      if (obsDesc) {
        if (!currentSubset) {
          currentSubset = {
            index: subsets.length + 1,
            label: `SUBSET_${subsets.length + 1}`,
            values: [],
            line: lineNo,
            startOffset: lineStartOffset,
            endOffset: lineStartOffset + rawLine.length,
          };
          subsets.push(currentSubset);
        }
        const entry = lookupTableB(obsDesc.code, customTableB);
        const obs: BufrObservationValue = {
          descriptor: obsDesc.code,
          name: entry?.name,
          value: parseScalarValue(rawVal),
          unit: entry?.unit,
          line: lineNo,
          startOffset: lineStartOffset,
          endOffset: lineStartOffset + rawLine.length,
        };
        currentSubset.values.push(obs);
        currentSubset.endOffset = lineStartOffset + rawLine.length;
        continue;
      }

      if (currentSection === "SEC0" || keyUpper === "EDITION" || keyUpper === "LENGTH") {
        if (keyUpper === "EDITION") {
          const ed = Number.parseInt(rawVal, 10);
          if (ed === 3 || ed === 4) section0.edition = ed;
        } else if (keyUpper === "LENGTH") {
          section0.totalLength = Number.parseInt(rawVal, 10) || 0;
        }
        continue;
      }

      if (currentSection === "SEC1") {
        const numVal = Number.parseInt(rawVal, 10);
        switch (keyUpper) {
          case "MASTER_TABLE":
            section1.masterTable = numVal;
            break;
          case "CENTRE":
          case "ORIGINATING_CENTRE":
            section1.originatingCentre = numVal;
            break;
          case "SUBCENTRE":
          case "ORIGINATING_SUBCENTRE":
            section1.originatingSubCentre = numVal;
            break;
          case "UPDATE":
          case "UPDATE_SEQUENCE":
            section1.updateSequence = numVal;
            break;
          case "OPTIONAL_SECTION":
            section1.optionalSection = /^true|1$/i.test(rawVal);
            break;
          case "CATEGORY":
          case "DATA_CATEGORY":
            section1.dataCategory = numVal;
            break;
          case "SUBCATEGORY":
          case "INTL_SUBCATEGORY":
            section1.internationalSubCategory = numVal;
            break;
          case "LOCAL_SUBCATEGORY":
            section1.localSubCategory = numVal;
            break;
          case "VERSION":
          case "MASTER_TABLE_VERSION":
            section1.masterTableVersion = numVal;
            break;
          case "LOCAL_VERSION":
          case "LOCAL_TABLE_VERSION":
            section1.localTableVersion = numVal;
            break;
          case "YEAR":
            section1.year = numVal;
            break;
          case "MONTH":
            section1.month = numVal;
            break;
          case "DAY":
            section1.day = numVal;
            break;
          case "HOUR":
            section1.hour = numVal;
            break;
          case "MINUTE":
            section1.minute = numVal;
            break;
          case "SECOND":
            section1.second = numVal;
            break;
          default:
            break;
        }
        continue;
      }

      if (currentSection === "SEC3") {
        if (keyUpper === "SUBSETS" || keyUpper === "SUBSET_COUNT") {
          declaredSubsetCount = Number.parseInt(rawVal, 10);
          section3.subsetCount = declaredSubsetCount;
        } else if (keyUpper === "OBSERVED") {
          section3.isObserved = /^true|1$/i.test(rawVal);
        } else if (keyUpper === "COMPRESSED") {
          section3.isCompressed = /^true|1$/i.test(rawVal);
        } else if (keyUpper === "DESCRIPTORS") {
          const tokens = rawVal
            .replace(/^\[|\]$/g, "")
            .split(/[,\s]+/)
            .filter(Boolean);
          for (const tok of tokens) {
            const d = parseBufrDescriptor(tok, lineNo, lineStartOffset, lineStartOffset + rawLine.length);
            if (d) descriptors.push(d);
            else syntaxErrors.push({ message: `Invalid descriptor token '${tok}'`, line: lineNo, column: 1 });
          }
        }
        continue;
      }
    }

    // Bare descriptor tokens inside Section 3
    if (currentSection === "SEC3") {
      const tokens = cleaned.split(/[,\s]+/).filter(Boolean);
      let matchedAny = false;
      for (const tok of tokens) {
        const d = parseBufrDescriptor(tok, lineNo, lineStartOffset, lineStartOffset + rawLine.length);
        if (d) {
          descriptors.push(d);
          matchedAny = true;
        } else {
          syntaxErrors.push({ message: `Invalid descriptor '${tok}' in Section 3`, line: lineNo, column: 1 });
        }
      }
      if (matchedAny) continue;
    }

    syntaxErrors.push({
      message: `Unexpected BUFR statement '${cleaned}'`,
      line: lineNo,
      column: 1,
    });
  }

  if (declaredSubsetCount === undefined) {
    section3.subsetCount = subsets.length;
  }

  return {
    name,
    section0,
    section1,
    section3,
    subsets,
    customTableB,
    customTableD,
    hasEndMarker,
    hasMagicHeader,
    syntaxErrors,
    rawText: source,
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/grib — Textual GRIB Edition 1 Descriptor Dump Parser & Formatter.
 *
 * Parses structured human-readable GRIB1 descriptor dumps containing:
 *   GRIB [edition=1]
 *     IS { edition = 1, totalLength = ... }
 *     PDS { center = 7, parameter = TMP, levelType = ISBL, level = 500, date = 2026-01-15T00:00, decimalScale = 1 }
 *     GDS { gridType = 0, ni = 4, nj = 3, la1 = 60, lo1 = -120, la2 = 30, lo2 = -60, di = 20, dj = 15 }
 *     BMS { bitmap = [1, 1, 1, ...] }
 *     BDS { bitsPerValue = 16, binaryScale = 0, referenceValue = 250.0, values = [...] }
 *   7777
 */

import {
  lookupWmoLevelByMnemonic,
  lookupWmoLevelType,
  lookupWmoParameterByCode,
  lookupWmoParameterByMnemonic,
} from "../catalog/grib-std-schemas.js";
import { unpackGrib1Values } from "../solver/packing.js";
import type {
  GribBinaryDataSection,
  GribDocument,
  GribGridDefinitionSection,
  GribIndicatorSection,
  GribMessage,
  GribProductDefinitionSection,
} from "../types.js";

type SectionKind = "IS" | "PDS" | "GDS" | "BMS" | "BDS";

function stripComments(line: string): string {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"' || ch === "'") {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === "#") return line.slice(0, i);
      if (ch === "/" && line[i + 1] === "/") return line.slice(0, i);
    }
  }
  return line;
}

function parseNumberList(raw: string): number[] {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!inner) return [];
  return inner
    .split(/[\s,]+/)
    .filter((tok) => tok.length > 0)
    .map((tok) => Number(tok));
}

function parseIsoDateTime(raw: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} | null {
  const cleaned = raw.replace(/^["']|["']$/g, "").trim();
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2}))?/.exec(cleaned);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: match[4] !== undefined ? Number(match[4]) : 0,
    minute: match[5] !== undefined ? Number(match[5]) : 0,
  };
}

function createDefaultIndicator(line: number): GribIndicatorSection {
  return {
    magic: "GRIB",
    totalLength: 0,
    edition: 1,
    span: { startLine: line, startColumn: 1, endLine: line, endColumn: 5 },
  };
}

function createDefaultPds(line: number): GribProductDefinitionSection {
  return {
    tableVersion: 2,
    centerId: 7,
    generatingProcessId: 81,
    gridId: 255,
    hasGds: false,
    hasBms: false,
    parameterCode: 11,
    parameterName: "TMP",
    levelType: 100,
    levelName: "ISBL",
    levelValue: 500,
    year: 2026,
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
    timeUnit: 1,
    p1: 0,
    p2: 0,
    timeRangeIndicator: 0,
    century: 21,
    subCenterId: 0,
    decimalScaleFactor: 0,
    span: { startLine: line, startColumn: 1, endLine: line, endColumn: 4 },
  };
}

function createDefaultGds(line: number): GribGridDefinitionSection {
  return {
    dataRepresentationType: 0,
    ni: 0,
    nj: 0,
    la1: 90,
    lo1: 0,
    resolutionFlags: 128,
    la2: -90,
    lo2: 360,
    di: 1,
    dj: 1,
    scanningMode: 0,
    span: { startLine: line, startColumn: 1, endLine: line, endColumn: 4 },
  };
}

function createDefaultBds(line: number): GribBinaryDataSection {
  return {
    flags: 0,
    binaryScaleFactor: 0,
    referenceValue: 0,
    bitsPerValue: 16,
    values: [],
    span: { startLine: line, startColumn: 1, endLine: line, endColumn: 4 },
  };
}

function applyKeyValue(section: SectionKind, keyRaw: string, valRaw: string, msg: GribMessage, lineNum: number): void {
  const key = keyRaw.trim().toLowerCase().replace(/[_-]/g, "");
  const val = valRaw.trim().replace(/[,;]$/, "").trim();
  const unquoted = val.replace(/^["']|["']$/g, "");
  const numVal = Number(unquoted);

  if (section === "IS") {
    if (key === "magic") msg.indicator.magic = unquoted;
    else if (key === "edition" || key === "editionnumber") msg.indicator.edition = numVal;
    else if (key === "totallength" || key === "length") msg.indicator.totalLength = numVal;
    return;
  }

  if (section === "PDS") {
    if (!msg.pds) msg.pds = createDefaultPds(lineNum);
    const pds = msg.pds;
    if (key === "tableversion" || key === "table") pds.tableVersion = numVal;
    else if (key === "center" || key === "centerid" || key === "centre") pds.centerId = numVal;
    else if (key === "subcenter" || key === "subcenterid") pds.subCenterId = numVal;
    else if (key === "process" || key === "generatingprocessid") pds.generatingProcessId = numVal;
    else if (key === "grid" || key === "gridid") pds.gridId = numVal;
    else if (key === "parameter" || key === "parametercode" || key === "param") {
      if (Number.isFinite(numVal) && unquoted !== "") {
        pds.parameterCode = numVal;
        pds.parameterName = lookupWmoParameterByCode(numVal)?.mnemonic ?? pds.parameterName;
      } else {
        const meta = lookupWmoParameterByMnemonic(unquoted);
        pds.parameterName = unquoted.toUpperCase();
        if (meta) pds.parameterCode = meta.code;
        else pds.parameterCode = 255;
      }
    } else if (key === "parametername" || key === "paramname") {
      pds.parameterName = unquoted.toUpperCase();
      const meta = lookupWmoParameterByMnemonic(unquoted);
      if (meta) pds.parameterCode = meta.code;
    } else if (key === "leveltype" || key === "levelindicator") {
      if (Number.isFinite(numVal) && unquoted !== "") {
        pds.levelType = numVal;
        pds.levelName = lookupWmoLevelType(numVal)?.mnemonic ?? pds.levelName;
      } else {
        const meta = lookupWmoLevelByMnemonic(unquoted);
        pds.levelName = unquoted.toUpperCase();
        if (meta) pds.levelType = meta.code;
        else pds.levelType = 255;
      }
    } else if (key === "level" || key === "levelvalue") pds.levelValue = numVal;
    else if (key === "level2" || key === "levelvalue2") pds.levelValue2 = numVal;
    else if (key === "date" || key === "datetime" || key === "reftime") {
      const parsed = parseIsoDateTime(unquoted);
      if (parsed) {
        pds.year = parsed.year;
        pds.month = parsed.month;
        pds.day = parsed.day;
        pds.hour = parsed.hour;
        pds.minute = parsed.minute;
        pds.century = Math.floor((parsed.year - 1) / 100) + 1;
      }
    } else if (key === "year") {
      pds.year = numVal;
      if (numVal >= 100) pds.century = Math.floor((numVal - 1) / 100) + 1;
    } else if (key === "month") pds.month = numVal;
    else if (key === "day") pds.day = numVal;
    else if (key === "hour") pds.hour = numVal;
    else if (key === "minute") pds.minute = numVal;
    else if (key === "century") pds.century = numVal;
    else if (key === "timeunit") pds.timeUnit = numVal;
    else if (key === "p1" || key === "step" || key === "forecast") pds.p1 = numVal;
    else if (key === "p2") pds.p2 = numVal;
    else if (key === "timerange" || key === "timerangeindicator") pds.timeRangeIndicator = numVal;
    else if (key === "decimalscale" || key === "decimalscalefactor" || key === "d") {
      pds.decimalScaleFactor = numVal;
    }
    return;
  }

  if (section === "GDS") {
    if (!msg.gds) msg.gds = createDefaultGds(lineNum);
    const gds = msg.gds;
    if (key === "gridtype" || key === "datarepresentationtype") gds.dataRepresentationType = numVal;
    else if (key === "ni" || key === "nx" || key === "nlon") gds.ni = numVal;
    else if (key === "nj" || key === "ny" || key === "nlat") gds.nj = numVal;
    else if (key === "la1" || key === "lat1") gds.la1 = numVal;
    else if (key === "lo1" || key === "lon1") gds.lo1 = numVal;
    else if (key === "la2" || key === "lat2") gds.la2 = numVal;
    else if (key === "lo2" || key === "lon2") gds.lo2 = numVal;
    else if (key === "di" || key === "dlon") gds.di = numVal;
    else if (key === "dj" || key === "dlat") gds.dj = numVal;
    else if (key === "resolutionflags" || key === "resflags") gds.resolutionFlags = numVal;
    else if (key === "scanningmode" || key === "scanmode") gds.scanningMode = numVal;
    return;
  }

  if (section === "BMS") {
    if (!msg.bms) {
      msg.bms = {
        unusedBits: 0,
        tableReference: 0,
        bitmap: [],
        span: { startLine: lineNum, startColumn: 1, endLine: lineNum, endColumn: 4 },
      };
    }
    if (key === "bitmap" || key === "mask") {
      msg.bms.bitmap = parseNumberList(val).map((n) => n !== 0);
    } else if (key === "unusedbits") {
      msg.bms.unusedBits = numVal;
    } else if (key === "tablereference") {
      msg.bms.tableReference = numVal;
    }
    return;
  }

  if (section === "BDS") {
    if (!msg.bds) msg.bds = createDefaultBds(lineNum);
    const bds = msg.bds;
    if (key === "flags") bds.flags = numVal;
    else if (key === "binaryscale" || key === "binaryscalefactor" || key === "e") bds.binaryScaleFactor = numVal;
    else if (key === "referencevalue" || key === "ref" || key === "r") bds.referenceValue = numVal;
    else if (key === "bitspervalue" || key === "bits" || key === "nbits") bds.bitsPerValue = numVal;
    else if (key === "values" || key === "data") bds.values = parseNumberList(val);
    else if (key === "packed" || key === "packedvalues") bds.packedValues = parseNumberList(val);
  }
}

/**
 * Parses a textual GRIB Edition 1 descriptor dump into a `GribDocument`.
 */
export function parseGribDescriptor(text: string, uri?: string): GribDocument {
  const lines = text.split(/\r?\n/);
  const messages: GribMessage[] = [];
  const syntaxErrors: Array<{ message: string; line: number; column: number }> = [];

  let currentMsg: GribMessage | null = null;
  let currentSection: SectionKind | null = null;
  let collectingArrayKey: string | null = null;
  let collectingArrayBuf = "";
  let collectingArrayLine = 1;

  const finalizeMessage = (msg: GribMessage, endLine: number): void => {
    if (msg.pds) {
      msg.pds.hasGds = Boolean(msg.gds);
      msg.pds.hasBms = Boolean(msg.bms);
    }
    // If packedValues were provided without explicit unpacked values, unpack via Y = (R + X * 2^E) * 10^(-D)
    if (msg.bds && msg.bds.values.length === 0 && msg.bds.packedValues && msg.bds.packedValues.length > 0) {
      msg.bds.values = unpackGrib1Values(
        msg.bds.referenceValue,
        msg.bds.packedValues,
        msg.bds.binaryScaleFactor,
        msg.pds?.decimalScaleFactor ?? 0,
      );
    }
    if (msg.span) {
      msg.span.endLine = endLine;
    }
    messages.push(msg);
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = stripComments(lines[i]!).trim();
    if (!rawLine) continue;

    // Handle multi-line array continuation (e.g. values = [\n 280.1, 281.2 \n])
    if (collectingArrayKey !== null && currentMsg && currentSection) {
      collectingArrayBuf += " " + rawLine;
      if (rawLine.includes("]")) {
        const closeIdx = collectingArrayBuf.indexOf("]");
        const arrayPart = collectingArrayBuf.slice(0, closeIdx + 1);
        applyKeyValue(currentSection, collectingArrayKey, arrayPart, currentMsg, collectingArrayLine);
        collectingArrayKey = null;
        collectingArrayBuf = "";
      }
      continue;
    }

    // Check message start: GRIB ...
    const gribStart = /^GRIB(?:\s+(.*))?$/i.exec(rawLine);
    if (gribStart) {
      if (currentMsg) {
        finalizeMessage(currentMsg, lineNum - 1);
      }
      currentMsg = {
        index: messages.length,
        indicator: createDefaultIndicator(lineNum),
        end: { magic: "", present: false },
        span: { startLine: lineNum, startColumn: 1, endLine: lineNum, endColumn: rawLine.length },
      };
      currentSection = "IS";
      // Parse inline attributes on GRIB line (e.g. `GRIB edition=1`)
      const rest = gribStart[1]?.replace(/[{}]/g, "").trim();
      if (rest) {
        for (const pair of rest.split(/[,;]+/)) {
          const kv = /^([A-Za-z_][A-Za-z0-9_-]*)\s*[:=]\s*(.+)$/.exec(pair.trim());
          if (kv) {
            applyKeyValue("IS", kv[1]!, kv[2]!, currentMsg, lineNum);
          }
        }
      }
      continue;
    }

    // Check message end: 7777
    if (/^7777\b/.test(rawLine)) {
      if (currentMsg) {
        currentMsg.end = {
          magic: "7777",
          present: true,
          span: { startLine: lineNum, startColumn: 1, endLine: lineNum, endColumn: 5 },
        };
        finalizeMessage(currentMsg, lineNum);
        currentMsg = null;
        currentSection = null;
      } else {
        syntaxErrors.push({
          message: "Unexpected '7777' trailer without preceding 'GRIB' header",
          line: lineNum,
          column: 1,
        });
      }
      continue;
    }

    // Check closing brace of section
    if (rawLine === "}") {
      currentSection = null;
      continue;
    }

    // Check section header: IS, PDS, GDS, BMS, BDS
    const secMatch = /^(IS|PDS|GDS|BMS|BDS)\b\s*(.*)$/i.exec(rawLine);
    if (secMatch) {
      if (!currentMsg) {
        syntaxErrors.push({
          message: `Section '${secMatch[1]!.toUpperCase()}' declared before 'GRIB' indicator header`,
          line: lineNum,
          column: 1,
        });
        currentMsg = {
          index: messages.length,
          indicator: {
            magic: "",
            totalLength: 0,
            edition: 1,
            span: { startLine: lineNum, startColumn: 1, endLine: lineNum, endColumn: 1 },
          },
          end: { magic: "", present: false },
          span: { startLine: lineNum, startColumn: 1, endLine: lineNum, endColumn: rawLine.length },
        };
      }
      const secName = secMatch[1]!.toUpperCase() as SectionKind;
      currentSection = secName;
      if (secName === "PDS" && !currentMsg.pds) currentMsg.pds = createDefaultPds(lineNum);
      if (secName === "GDS" && !currentMsg.gds) currentMsg.gds = createDefaultGds(lineNum);
      if (secName === "BMS" && !currentMsg.bms) {
        currentMsg.bms = {
          unusedBits: 0,
          tableReference: 0,
          bitmap: [],
          span: { startLine: lineNum, startColumn: 1, endLine: lineNum, endColumn: 4 },
        };
      }
      if (secName === "BDS" && !currentMsg.bds) currentMsg.bds = createDefaultBds(lineNum);

      // Parse inline key=value pairs on section header line (e.g. `IS { edition = 1 }`)
      const inline = secMatch[2]!
        .replace(/^[:{]\s*/, "")
        .replace(/\}\s*$/, "")
        .trim();
      if (inline) {
        // Respect bracketed arrays while splitting on commas
        const parts: string[] = [];
        let depth = 0;
        let start = 0;
        for (let k = 0; k < inline.length; k++) {
          const c = inline[k]!;
          if (c === "[") depth++;
          else if (c === "]") depth = Math.max(0, depth - 1);
          else if ((c === "," || c === ";") && depth === 0) {
            parts.push(inline.slice(start, k));
            start = k + 1;
          }
        }
        parts.push(inline.slice(start));
        for (const part of parts) {
          const kv = /^([A-Za-z_][A-Za-z0-9_-]*)\s*[:=]\s*(.+)$/.exec(part.trim());
          if (kv) {
            applyKeyValue(secName, kv[1]!, kv[2]!, currentMsg, lineNum);
          }
        }
        if (secMatch[2]!.includes("}")) {
          currentSection = null;
        }
      }
      continue;
    }

    // Parse key = value or key: value inside active section
    const kvMatch = /^([A-Za-z_][A-Za-z0-9_-]*)\s*[:=]\s*(.*)$/.exec(rawLine);
    if (kvMatch && currentMsg && currentSection) {
      const key = kvMatch[1]!;
      const valueStr = kvMatch[2]!.trim();
      if (valueStr.startsWith("[") && !valueStr.includes("]")) {
        collectingArrayKey = key;
        collectingArrayBuf = valueStr;
        collectingArrayLine = lineNum;
      } else {
        applyKeyValue(currentSection, key, valueStr, currentMsg, lineNum);
      }
      continue;
    }

    syntaxErrors.push({
      message: `Unrecognized GRIB1 descriptor line: '${rawLine.slice(0, 60)}'`,
      line: lineNum,
      column: 1,
    });
  }

  if (currentMsg) {
    finalizeMessage(currentMsg, lines.length);
  }

  return {
    uri,
    isBinary: false,
    messages,
    syntaxErrors,
  };
}

/**
 * Formats a `GribDocument` into canonical textual GRIB Edition 1 descriptor notation.
 */
export function formatGribDescriptor(doc: GribDocument): string {
  const blocks: string[] = [];
  for (const msg of doc.messages) {
    const out: string[] = [];
    out.push(`GRIB edition=${msg.indicator.edition}`);
    out.push(`  IS {`);
    out.push(`    edition = ${msg.indicator.edition}`);
    if (msg.indicator.totalLength > 0) {
      out.push(`    totalLength = ${msg.indicator.totalLength}`);
    }
    out.push(`  }`);

    if (msg.pds) {
      const p = msg.pds;
      const yyyy = String(p.year).padStart(4, "0");
      const mm = String(p.month).padStart(2, "0");
      const dd = String(p.day).padStart(2, "0");
      const hh = String(p.hour).padStart(2, "0");
      const min = String(p.minute).padStart(2, "0");
      out.push(`  PDS {`);
      out.push(`    tableVersion = ${p.tableVersion}`);
      out.push(`    center = ${p.centerId}`);
      out.push(`    parameter = ${p.parameterName ?? p.parameterCode}`);
      out.push(`    levelType = ${p.levelName ?? p.levelType}`);
      out.push(`    level = ${p.levelValue}`);
      out.push(`    date = "${yyyy}-${mm}-${dd}T${hh}:${min}"`);
      out.push(`    decimalScale = ${p.decimalScaleFactor}`);
      out.push(`  }`);
    }

    if (msg.gds) {
      const g = msg.gds;
      out.push(`  GDS {`);
      out.push(`    gridType = ${g.dataRepresentationType}`);
      out.push(`    ni = ${g.ni}`);
      out.push(`    nj = ${g.nj}`);
      out.push(`    la1 = ${g.la1}`);
      out.push(`    lo1 = ${g.lo1}`);
      out.push(`    la2 = ${g.la2}`);
      out.push(`    lo2 = ${g.lo2}`);
      out.push(`    di = ${g.di}`);
      out.push(`    dj = ${g.dj}`);
      out.push(`  }`);
    }

    if (msg.bms && msg.bms.bitmap.length > 0) {
      out.push(`  BMS {`);
      out.push(`    bitmap = [${msg.bms.bitmap.map((b) => (b ? "1" : "0")).join(", ")}]`);
      out.push(`  }`);
    }

    if (msg.bds) {
      const b = msg.bds;
      out.push(`  BDS {`);
      out.push(`    bitsPerValue = ${b.bitsPerValue}`);
      out.push(`    binaryScale = ${b.binaryScaleFactor}`);
      out.push(`    referenceValue = ${Number(b.referenceValue.toFixed(6))}`);
      out.push(`    values = [${b.values.map((v) => (Number.isFinite(v) ? Number(v.toFixed(4)) : "NaN")).join(", ")}]`);
      out.push(`  }`);
    }

    if (msg.end.present) {
      out.push(`7777`);
    }
    blocks.push(out.join("\n"));
  }
  return blocks.join("\n\n") + "\n";
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  AreaRecord,
  BranchRecord,
  BusRecord,
  BusType,
  CaseIdentification,
  FixedShuntRecord,
  GeneratorRecord,
  LoadRecord,
  PsseCase,
  SourceSpan,
  SubstationRecord,
  SubstationTerminalRecord,
  SwitchedShuntRecord,
  SystemSwitchingDeviceRecord,
  TransformerRecord,
  TwoTerminalDcRecord,
  VscDcRecord,
} from "../types.js";

import {
  extractFieldsFromCstTokens,
  isPsseSectionTerminator,
  parsePsseCstDocument,
  type PsseCstDocument,
  type PsseCstLine,
} from "./cst-tokens.js";

/**
 * Splits a PSS/E line into field strings using the native WASM GLR parser CST,
 * respecting quoted strings and ignoring `/` comments.
 */
export function tokenizeRawLine(line: string): string[] {
  const doc = parsePsseCstDocument(line);
  const first = doc.lines[0];
  if (!first) return [];
  return extractFieldsFromCstTokens(first.tokens, line, "delimited").map((f) => f.value);
}

/**
 * Parses numeric value or falls back to default.
 */
function parseNum(val: string | undefined, def = 0): number {
  if (val === undefined || val === "") return def;
  const n = Number(val);
  return Number.isFinite(n) ? n : def;
}

/**
 * Parses string value or falls back to default.
 */
function parseStr(val: string | undefined, def = ""): string {
  if (val === undefined || val === "") return def;
  const trimmed = val.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed[0] === "'" && trimmed[trimmed.length - 1] === "'") ||
      (trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"'))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Extracts `@pos(x, y)` diagram coordinates from an inline `/` or `/*` comment if present.
 */
function parsePosComment(commentText?: string): { x: number; y: number } | undefined {
  if (!commentText) return undefined;
  const m = /@pos\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i.exec(commentText);
  if (!m) return undefined;
  const x = Number(m[1]);
  const y = Number(m[2]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

/**
 * Parses PSS/E RAW format text into a structured `PsseCase` via the native WASM CST.
 */
export function parseRaw(text: string, precomputedCstDoc?: PsseCstDocument): PsseCase {
  const cstDoc = precomputedCstDoc ?? parsePsseCstDocument(text);
  const lines = cstDoc.lines;
  let lineIdx = 0;

  function nextLine(): PsseCstLine | null {
    if (lineIdx >= lines.length) return null;
    return lines[lineIdx++]!;
  }

  function fieldsOf(info: PsseCstLine | null): string[] {
    if (!info) return [];
    return extractFieldsFromCstTokens(info.tokens, text, "delimited").map((f) => f.value);
  }

  const rawMetadataDetected = lines.some((l) => l.line.trimStart().startsWith("@!"));

  // Skip any leading comment lines (@! or /) before the Case Identification header
  while (lineIdx < lines.length && lines[lineIdx]!.isCommentOrBlank) {
    nextLine();
  }

  function isSectionBoundaryLine(info: PsseCstLine): boolean {
    if (info.isCommentOrBlank) return false;
    const fields = extractFieldsFromCstTokens(info.tokens, text, "delimited");
    if (fields.length !== 1) return false;
    return isPsseSectionTerminator(fields) !== null;
  }

  function isLikelyBusRecord(info: PsseCstLine): boolean {
    if (info.isCommentOrBlank) return false;
    const fields = extractFieldsFromCstTokens(info.tokens, text, "delimited");
    if (fields.length < 7) return false;
    const busNum = Number(fields[0]!.value);
    const baseKv = Number(fields[2]!.value);
    const ide = Number(fields[3]!.value);
    return (
      Number.isInteger(busNum) &&
      busNum > 0 &&
      Number.isFinite(baseKv) &&
      baseKv >= 0 &&
      (ide === 1 || ide === 2 || ide === 3 || ide === 4)
    );
  }

  function isNonTitleLine(info: PsseCstLine): boolean {
    return info.line.trimStart().startsWith("@!") || isSectionBoundaryLine(info) || isLikelyBusRecord(info);
  }

  // 1. Header (Case Identification) — only consume if the first non-comment line is not a section marker or bus record
  const firstCandidate = lineIdx < lines.length ? lines[lineIdx]! : null;
  const headerLineInfo =
    firstCandidate && !isSectionBoundaryLine(firstCandidate) && !isLikelyBusRecord(firstCandidate) ? nextLine() : null;
  const headerTokens = fieldsOf(headerLineInfo);
  const headerCommentUpper = (headerLineInfo?.commentText ?? "").toUpperCase();
  let inferredRev = 33;
  if (headerLineInfo) {
    if (headerTokens[2] !== undefined && headerTokens[2] !== "") {
      inferredRev = parseNum(headerTokens[2], 33);
    } else if (headerTokens.length <= 2) {
      // Pre-v30 PSS/E RAW files (v26–v29) only have `IC, SBASE` on line 1 (no REV column)
      inferredRev = /PSS\/E[- ]*26|\bREV\s*26\b|\bV26\b/.test(headerCommentUpper) ? 26 : 29;
    }
  }
  const header: CaseIdentification = {
    ic: parseNum(headerTokens[0], 0),
    sbase: parseNum(headerTokens[1], 100.0),
    rev: inferredRev,
    xfrrat: parseNum(headerTokens[3], 0),
    nxfrat: parseNum(headerTokens[4], 0),
    basfrq: parseNum(headerTokens[5], 60.0),
    rawMetadataDetected,
    span: headerLineInfo
      ? {
          startOffset: headerLineInfo.startOffset,
          endOffset: headerLineInfo.endOffset,
          line: headerLineInfo.lineNum,
          column: 1,
        }
      : undefined,
  };

  // 2. Title Line 1 (only when immediately following the Case Identification header and not a section/data line)
  let title1 = "";
  let title2 = "";
  if (headerLineInfo) {
    const headerRow = headerLineInfo.row;
    if (lineIdx < lines.length && lines[lineIdx]!.row === headerRow + 1 && !isNonTitleLine(lines[lineIdx]!)) {
      const t1 = nextLine();
      title1 = t1 ? t1.line.trim() : "";
    }

    // 3. Title Line 2 (only within 2 rows of the header and not a section/data line)
    if (lineIdx < lines.length && lines[lineIdx]!.row <= headerRow + 2 && !isNonTitleLine(lines[lineIdx]!)) {
      const t2 = nextLine();
      title2 = t2 ? t2.line.trim() : "";
    }
  }

  const buses = new Map<number, BusRecord>();
  const loads: LoadRecord[] = [];
  const fixedShunts: FixedShuntRecord[] = [];
  const generators: GeneratorRecord[] = [];
  const branches: BranchRecord[] = [];
  const transformers: TransformerRecord[] = [];
  const areas: AreaRecord[] = [];
  const twoTerminalDc: TwoTerminalDcRecord[] = [];
  const vscDc: VscDcRecord[] = [];
  const switchedShunts: SwitchedShuntRecord[] = [];
  const substations: SubstationRecord[] = [];
  const systemSwitchingDevices: SystemSwitchingDeviceRecord[] = [];
  let currentSub: SubstationRecord | null = null;
  let subStage: "header" | "nodes" | "switches" | "terminals" = "header";

  const flushCurrentSub = (): void => {
    if (currentSub) {
      substations.push(currentSub);
      currentSub = null;
    }
    subStage = "header";
  };

  // Section codes:
  // 0=Bus, 1=Load, 2=FixedShunt, 3=Gen, 4=Branch, 5=Xfmr, 6=Area, 7=2TermDC, 8=VscDC,
  // 9=SwitchedShunt (or ImpedanceCorrection in full v33), 10..15=Intermediate v33 sections, 16=SwitchedShunt, 18=Substation (v34/v35 Node-Breaker)
  let section = 0;

  function resolveSectionFromComment(commentLine: string, currentSec: number): number {
    const upper = commentLine.toUpperCase();
    if (upper.includes("BEGIN BUS")) return 0;
    if (upper.includes("BEGIN LOAD")) return 1;
    if (upper.includes("BEGIN FIXED SHUNT")) return 2;
    if (upper.includes("BEGIN GENERATOR")) return 3;
    if (upper.includes("BEGIN BRANCH") || upper.includes("BEGIN NON-TRANSFORMER")) return 4;
    if (upper.includes("BEGIN TRANSFORMER")) return 5;
    if (upper.includes("BEGIN AREA")) return 6;
    if (upper.includes("BEGIN TWO-TERMINAL DC")) return 7;
    if (upper.includes("BEGIN VSC DC")) return 8;
    if (upper.includes("BEGIN IMPEDANCE CORRECTION")) return 10;
    if (upper.includes("BEGIN MULTI-TERMINAL DC")) return 11;
    if (upper.includes("BEGIN MULTI-SECTION LINE")) return 12;
    if (upper.includes("BEGIN ZONE")) return 13;
    if (upper.includes("BEGIN INTER-AREA TRANSFER")) return 14;
    if (upper.includes("BEGIN OWNER")) return 15;
    if (upper.includes("BEGIN FACTS")) return 15;
    if (upper.includes("BEGIN SWITCHED SHUNT")) return 9;
    if (upper.includes("END OF SWITCHED SHUNT")) return 17;
    if (upper.includes("BEGIN SUBSTATION")) return 18;
    if (upper.includes("END OF SUBSTATION DATA")) return 19;
    if (upper.includes("BEGIN SYSTEM SWITCHING DEVICE")) return 20;
    // Pre-v31 RAW files (v26, v29, v30) embed GL/BL in Bus Data and have no Fixed Shunt section
    if (currentSec === 1 && header.rev <= 30) return 3;
    return currentSec + 1;
  }

  let openSection: { section: number; span?: SourceSpan | undefined } | undefined;
  let prevLineEndOffset = 0;
  let currentSectionCols = new Map<string, number>();

  function parseMetadataColumns(rawLine: string): void {
    const trimmed = rawLine.trimStart();
    if (!trimmed.startsWith("@!")) return;
    const body = trimmed.slice(2).trim();
    if (!body.includes(",")) return;
    const parts = body.split(",").map((p) =>
      p
        .replace(/^['"]|['"]$/g, "")
        .trim()
        .toUpperCase(),
    );
    if (parts.length >= 3) {
      const next = new Map<string, number>();
      for (let idx = 0; idx < parts.length; idx++) {
        const key = parts[idx]!;
        if (key.length > 0 && !next.has(key)) next.set(key, idx);
      }
      currentSectionCols = next;
    }
  }

  function col(name: string, fallback: number): number {
    return currentSectionCols.get(name) ?? fallback;
  }

  while (lineIdx < lines.length) {
    const info = nextLine();
    if (!info) break;
    if (section < 18 && info.startOffset > prevLineEndOffset) {
      const gap = text.slice(prevLineEndOffset, info.startOffset).toUpperCase();
      if (gap.includes("BEGIN SUBSTATION")) {
        flushCurrentSub();
        openSection = undefined;
        section = 18;
      }
    }
    prevLineEndOffset = info.endOffset;
    if (info.isCommentOrBlank) {
      parseMetadataColumns(info.line);
      if ((info.commentText || info.line).toUpperCase().includes("BEGIN SUBSTATION")) {
        flushCurrentSub();
        openSection = undefined;
        section = 18;
      }
      continue;
    }

    const cstFields = extractFieldsFromCstTokens(info.tokens, text, "delimited");
    const term = isPsseSectionTerminator(cstFields);
    if (term === "end_file") {
      flushCurrentSub();
      openSection = undefined;
      break;
    }
    if (term === "end_section") {
      openSection = undefined;
      currentSectionCols.clear();
      const commentUpper = (info.commentText || info.line).toUpperCase().trim();
      const isEndOfSubstationSection =
        commentUpper.includes("END OF SUBSTATION DATA") || /END OF SUBSTATION\s*$/.test(commentUpper);
      if (section === 18 && currentSub !== null && !isEndOfSubstationSection) {
        if (subStage === "nodes") subStage = "switches";
        else if (subStage === "switches") subStage = "terminals";
        else flushCurrentSub();
        continue;
      }
      if (section === 18) flushCurrentSub();
      section = resolveSectionFromComment(info.commentText || info.line, section);
      if (section >= 99) break;
      continue;
    }

    const toks = cstFields.map((f) => f.value);
    const fieldSpans: SourceSpan[] = cstFields.map((f) => ({
      startOffset: f.startOffset,
      endOffset: f.endOffset,
      line: f.line0 + 1,
      column: f.startCol0 + 1,
    }));
    const span: SourceSpan = {
      startOffset: info.startOffset,
      endOffset: info.endOffset,
      line: info.lineNum,
      column: 1,
    };
    openSection = { section, span };

    switch (section) {
      case 0: {
        // Bus Data (supports v26/v29/v30 inline GL,BL normalization + v31–v36 & @! column mapping)
        const busNum = parseNum(toks[col("I", 0)], 0);
        if (busNum > 0) {
          const hasInlineGlBl =
            header.rev <= 30 && toks.length >= 10 && toks.length <= 11 && !currentSectionCols.has("NVHI");
          let area: number;
          let zone: number;
          let owner: number;
          let vm: number;
          let va: number;
          let nvhi: number | undefined;
          let nvlo: number | undefined;
          let evhi: number | undefined;
          let evlo: number | undefined;

          if (hasInlineGlBl) {
            // PSS/E v26/v29/v30 layout: I,'NAME',BASKV,IDE,GL,BL,AREA,ZONE,VM,VA[,OWNER]
            const gl = parseNum(toks[4], 0.0);
            const bl = parseNum(toks[5], 0.0);
            area = parseNum(toks[6], 1);
            zone = parseNum(toks[7], 1);
            vm = parseNum(toks[8], 1.0);
            va = parseNum(toks[9], 0.0);
            owner = toks[10] !== undefined ? parseNum(toks[10], 1) : 1;
            if (gl !== 0 || bl !== 0) {
              fixedShunts.push({
                i: busNum,
                id: "1",
                status: 1,
                gl,
                bl,
                span,
              });
            }
          } else {
            area = parseNum(toks[col("AREA", 4)], 1);
            zone = parseNum(toks[col("ZONE", 5)], 1);
            owner = parseNum(toks[col("OWNER", 6)], 1);
            vm = parseNum(toks[col("VM", 7)], 1.0);
            va = parseNum(toks[col("VA", 8)], 0.0);
            const iNvhi = col("NVHI", 9);
            const iNvlo = col("NVLO", 10);
            const iEvhi = col("EVHI", 11);
            const iEvlo = col("EVLO", 12);
            nvhi = toks[iNvhi] !== undefined ? parseNum(toks[iNvhi], 1.1) : undefined;
            nvlo = toks[iNvlo] !== undefined ? parseNum(toks[iNvlo], 0.9) : undefined;
            evhi = toks[iEvhi] !== undefined ? parseNum(toks[iEvhi], 1.1) : undefined;
            evlo = toks[iEvlo] !== undefined ? parseNum(toks[iEvlo], 0.9) : undefined;
          }

          const bus: BusRecord = {
            i: busNum,
            name: parseStr(toks[col("NAME", 1)], `BUS ${busNum}`),
            baseKv: parseNum(toks[col("BASKV", 2)], 0),
            ide: (parseNum(toks[col("IDE", 3)], 1) as BusType) || 1,
            area,
            zone,
            owner,
            vm,
            va,
            nvhi,
            nvlo,
            evhi,
            evlo,
            span,
            fieldSpans,
            position: parsePosComment(info.commentText),
          };
          buses.set(busNum, bus);
          header.minBusColumnCount =
            header.minBusColumnCount === undefined ? toks.length : Math.min(header.minBusColumnCount, toks.length);
          header.maxBusColumnCount =
            header.maxBusColumnCount === undefined ? toks.length : Math.max(header.maxBusColumnCount, toks.length);
        }
        break;
      }

      case 1: {
        // Load Data
        const busNum = parseNum(toks[col("I", 0)], 0);
        if (busNum > 0) {
          loads.push({
            i: busNum,
            id: parseStr(toks[col("ID", 1)], "1"),
            status: parseNum(toks[col("STATUS", 2)], 1),
            area: parseNum(toks[col("AREA", 3)], 1),
            zone: parseNum(toks[col("ZONE", 4)], 1),
            pl: parseNum(toks[col("PL", 5)], 0.0),
            ql: parseNum(toks[col("QL", 6)], 0.0),
            ip: parseNum(toks[col("IP", 7)], 0.0),
            iq: parseNum(toks[col("IQ", 8)], 0.0),
            yp: parseNum(toks[col("YP", 9)], 0.0),
            yq: parseNum(toks[col("YQ", 10)], 0.0),
            owner: parseNum(toks[col("OWNER", 11)], 1),
            scale: parseNum(toks[col("SCALE", 12)], 1),
            intrct: parseNum(toks[col("INTRPT", col("INTRCT", 13))], 1),
            span,
            position: parsePosComment(info.commentText),
          });
        }
        break;
      }

      case 2: {
        // Fixed Bus Shunt Data
        const busNum = parseNum(toks[col("I", 0)], 0);
        if (busNum > 0) {
          fixedShunts.push({
            i: busNum,
            id: parseStr(toks[col("ID", 1)], "1"),
            status: parseNum(toks[col("STATUS", 2)], 1),
            gl: parseNum(toks[col("GL", 3)], 0.0),
            bl: parseNum(toks[col("BL", 4)], 0.0),
            span,
            position: parsePosComment(info.commentText),
          });
        }
        break;
      }

      case 3: {
        // Generator Data
        const busNum = parseNum(toks[col("I", 0)], 0);
        if (busNum > 0) {
          // PSS/E v35/v36 inserts NREG (regulated node) at toks[8] before MBASE
          const off = header.rev >= 35 && toks.length >= 20 ? 1 : 0;
          const iO1 = col("O1", 18 + off);
          const iF1 = col("F1", 19 + off);
          generators.push({
            i: busNum,
            id: parseStr(toks[col("ID", 1)], "1"),
            pg: parseNum(toks[col("PG", 2)], 0.0),
            qg: parseNum(toks[col("QG", 3)], 0.0),
            qt: parseNum(toks[col("QT", 4)], 9999.0),
            qb: parseNum(toks[col("QB", 5)], -9999.0),
            vs: parseNum(toks[col("VS", 6)], 1.0),
            ireg: parseNum(toks[col("IREG", 7)], 0),
            mbase: parseNum(toks[col("MBASE", 8 + off)], header.sbase),
            zr: parseNum(toks[col("ZR", 9 + off)], 0.0),
            zx: parseNum(toks[col("ZX", 10 + off)], 1.0),
            rt: parseNum(toks[col("RT", 11 + off)], 0.0),
            xt: parseNum(toks[col("XT", 12 + off)], 0.0),
            gtap: parseNum(toks[col("GTAP", 13 + off)], 1.0),
            stat: parseNum(toks[col("STAT", 14 + off)], 1),
            rmpct: parseNum(toks[col("RMPCT", 15 + off)], 100.0),
            pt: parseNum(toks[col("PT", 16 + off)], 9999.0),
            pb: parseNum(toks[col("PB", 17 + off)], -9999.0),
            o1: toks[iO1] !== undefined ? parseNum(toks[iO1], 1) : undefined,
            f1: toks[iF1] !== undefined ? parseNum(toks[iF1], 1.0) : undefined,
            span,
            fieldSpans,
            position: parsePosComment(info.commentText),
          });
        }
        break;
      }

      case 4: {
        // Branch Data
        const fromBus = parseNum(toks[col("I", 0)], 0);
        const toBus = parseNum(toks[col("J", 1)], 0);
        if (fromBus > 0 && toBus !== 0) {
          // PSS/E v35/v36 inserts NAME at toks[6] and uses 12 RATE columns (toks[7..18]) before GI..BJ & STAT
          const isFullV35 = header.rev >= 35 && toks.length >= 26;
          const rateOff = isFullV35 ? 1 : 0;
          const off = isFullV35 ? 10 : 0;
          const iO1 = col("O1", 16 + off);
          const iF1 = col("F1", 17 + off);
          branches.push({
            i: fromBus,
            j: toBus,
            ckt: parseStr(toks[col("CKT", 2)], "1"),
            r: parseNum(toks[col("R", 3)], 0.0),
            x: parseNum(toks[col("X", 4)], 0.0001),
            b: parseNum(toks[col("B", 5)], 0.0),
            rateA: parseNum(toks[col("RATE1", col("RATEA", 6 + rateOff))], 0.0),
            rateB: parseNum(toks[col("RATE2", col("RATEB", 7 + rateOff))], 0.0),
            rateC: parseNum(toks[col("RATE3", col("RATEC", 8 + rateOff))], 0.0),
            gi: parseNum(toks[col("GI", 9 + off)], 0.0),
            bi: parseNum(toks[col("BI", 10 + off)], 0.0),
            gj: parseNum(toks[col("GJ", 11 + off)], 0.0),
            bj: parseNum(toks[col("BJ", 12 + off)], 0.0),
            st: parseNum(toks[col("STAT", col("ST", 13 + off))], 1),
            met: parseNum(toks[col("MET", 14 + off)], 1),
            len: parseNum(toks[col("LEN", 15 + off)], 0.0),
            o1: toks[iO1] !== undefined ? parseNum(toks[iO1], 1) : undefined,
            f1: toks[iF1] !== undefined ? parseNum(toks[iF1], 1.0) : undefined,
            span,
            fieldSpans,
          });
        }
        break;
      }

      case 5: {
        // Transformer Data (line 1 of 4 for 2-winding, or line 1 of 5 for 3-winding)
        const iBus = parseNum(toks[0], 0);
        const jBus = parseNum(toks[1], 0);
        const kBus = parseNum(toks[2], 0);
        if (iBus > 0 && jBus > 0) {
          const nextDataLine = (): PsseCstLine | null => {
            while (lineIdx < lines.length && lines[lineIdx]!.isCommentOrBlank) nextLine();
            return nextLine();
          };
          const l2 = nextDataLine();
          const toks2 = fieldsOf(l2);
          const l3 = nextDataLine();
          const toks3 = fieldsOf(l3);
          const l4 = nextDataLine();
          const toks4 = fieldsOf(l4);
          let l5: PsseCstLine | null = null;
          let toks5: string[] = [];
          if (kBus !== 0) {
            l5 = nextDataLine();
            toks5 = fieldsOf(l5);
          }
          const lastLine = l5 ?? l4 ?? l3 ?? l2 ?? info;
          const xfmrSpan: SourceSpan = {
            ...span,
            endOffset: lastLine.endOffset,
          };

          // Standard PSS/E v30+ Line 1: I,J,K,CKT,CW,CZ,CM,MAG1,MAG2,NMETR,'NAME',STAT,O1,F1
          // Also tolerate legacy 11-column fixtures that omit CZ (NAME at index 9).
          const hasCzCol =
            cstFields[10]?.tokenType === "QuotedString" ||
            (cstFields[9]?.tokenType !== "QuotedString" && toks.length >= 12);
          const czOff = hasCzCol ? 1 : 0;

          transformers.push({
            i: iBus,
            j: jBus,
            k: kBus,
            ckt: parseStr(toks[3], "1"),
            cw: parseNum(toks[4], 1),
            cz: hasCzCol ? parseNum(toks[5], 1) : 1,
            cm: parseNum(toks[5 + czOff], 1),
            mag1: parseNum(toks[6 + czOff], 0.0),
            mag2: parseNum(toks[7 + czOff], 0.0),
            nmetr: parseNum(toks[8 + czOff], 2),
            name: parseStr(toks[9 + czOff], ""),
            stat: parseNum(toks[10 + czOff], 1),
            o1: toks[11 + czOff] !== undefined ? parseNum(toks[11 + czOff], 1) : undefined,
            f1: toks[12 + czOff] !== undefined ? parseNum(toks[12 + czOff], 1.0) : undefined,
            r12: parseNum(toks2[0], 0.0),
            x12: parseNum(toks2[1], 0.0001),
            sbase12: parseNum(toks2[2], header.sbase),
            r23: kBus !== 0 ? parseNum(toks2[3], 0.0) : undefined,
            x23: kBus !== 0 ? parseNum(toks2[4], 0.0001) : undefined,
            sbase23: kBus !== 0 ? parseNum(toks2[5], header.sbase) : undefined,
            r31: kBus !== 0 ? parseNum(toks2[6], 0.0) : undefined,
            x31: kBus !== 0 ? parseNum(toks2[7], 0.0001) : undefined,
            sbase31: kBus !== 0 ? parseNum(toks2[8], header.sbase) : undefined,
            vmstar: kBus !== 0 ? parseNum(toks2[9], 1.0) : undefined,
            anstar: kBus !== 0 ? parseNum(toks2[10], 0.0) : undefined,
            windv1: parseNum(toks3[0], 1.0),
            nomv1: parseNum(toks3[1], 0.0),
            ang1: parseNum(toks3[2], 0.0),
            rata1: parseNum(toks3[3], 0.0),
            ratb1: parseNum(toks3[4], 0.0),
            ratc1: parseNum(toks3[5], 0.0),
            cod1: parseNum(toks3[6], 0),
            cont1: parseNum(toks3[7], 0),
            rma1: parseNum(toks3[8], 1.1),
            rmi1: parseNum(toks3[9], 0.9),
            vma1: parseNum(toks3[10], 1.1),
            vmi1: parseNum(toks3[11], 0.9),
            ntp1: parseNum(toks3[12], 33),
            tab1: parseNum(toks3[13], 0),
            cr1: parseNum(toks3[14], 0.0),
            cx1: parseNum(toks3[15], 0.0),
            cnxa1: parseNum(toks3[16], 0.0),
            windv2: parseNum(toks4[0], 1.0),
            nomv2: parseNum(toks4[1], 0.0),
            ang2: toks4[2] !== undefined ? parseNum(toks4[2], 0.0) : undefined,
            rata2: toks4[3] !== undefined ? parseNum(toks4[3], 0.0) : undefined,
            ratb2: toks4[4] !== undefined ? parseNum(toks4[4], 0.0) : undefined,
            ratc2: toks4[5] !== undefined ? parseNum(toks4[5], 0.0) : undefined,
            windv3: kBus !== 0 ? parseNum(toks5[0], 1.0) : undefined,
            nomv3: kBus !== 0 ? parseNum(toks5[1], 0.0) : undefined,
            ang3: kBus !== 0 ? parseNum(toks5[2], 0.0) : undefined,
            rata3: kBus !== 0 ? parseNum(toks5[3], 0.0) : undefined,
            ratb3: kBus !== 0 ? parseNum(toks5[4], 0.0) : undefined,
            ratc3: kBus !== 0 ? parseNum(toks5[5], 0.0) : undefined,
            span: xfmrSpan,
          });
        }
        break;
      }

      case 6: {
        // Area Interchange Data
        const areaNum = parseNum(toks[0], 0);
        if (areaNum > 0) {
          areas.push({
            i: areaNum,
            isw: parseNum(toks[1], 0),
            pdes: parseNum(toks[2], 0.0),
            ptol: parseNum(toks[3], 10.0),
            arname: parseStr(toks[4], `AREA ${areaNum}`),
            span,
          });
        }
        break;
      }

      case 7: {
        // Two-Terminal DC
        const dcNum = parseNum(toks[0], 0);
        const isQuotedName = cstFields[0]?.tokenType === "QuotedString";
        if (dcNum > 0 || isQuotedName) {
          const idNum = dcNum > 0 ? dcNum : twoTerminalDc.length + 1;
          const dcName = isQuotedName ? parseStr(toks[0], "") : undefined;
          let ipr: number | undefined;
          let ipi: number | undefined;
          // Consume optional rectifier/inverter continuation lines if present in 3-line v33 format
          const peek1 = lines[lineIdx];
          const p1Fields =
            peek1 && !peek1.isCommentOrBlank ? extractFieldsFromCstTokens(peek1.tokens, text, "delimited") : [];
          if (
            p1Fields.length >= 10 &&
            !isPsseSectionTerminator(p1Fields) &&
            p1Fields[0]?.tokenType !== "QuotedString"
          ) {
            nextLine();
            ipr = parseNum(p1Fields[0]?.value, 0);
            const peek2 = lines[lineIdx];
            const p2Fields =
              peek2 && !peek2.isCommentOrBlank ? extractFieldsFromCstTokens(peek2.tokens, text, "delimited") : [];
            if (p2Fields.length > 0 && !isPsseSectionTerminator(p2Fields)) {
              nextLine();
              ipi = parseNum(p2Fields[0]?.value, 0);
            }
          }
          twoTerminalDc.push({
            i: idNum,
            name: dcName,
            mdc: parseNum(toks[1], 0),
            rdc: parseNum(toks[2], 0.0),
            setvl: parseNum(toks[3], 0.0),
            vschd: parseNum(toks[4], 0.0),
            vcmod: parseNum(toks[5], 0.0),
            rcomp: parseNum(toks[6], 0.0),
            deltm: parseNum(toks[7], 0.0),
            ipr,
            ipi,
            span,
          });
        }
        break;
      }

      case 8: {
        // VSC DC
        const name = parseStr(toks[0], "");
        if (name) {
          let ibus1: number | undefined;
          let ibus2: number | undefined;
          const peek1 = lines[lineIdx];
          const p1Fields =
            peek1 && !peek1.isCommentOrBlank ? extractFieldsFromCstTokens(peek1.tokens, text, "delimited") : [];
          if (p1Fields.length > 0 && !isPsseSectionTerminator(p1Fields) && p1Fields[0]?.tokenType !== "QuotedString") {
            nextLine();
            ibus1 = parseNum(p1Fields[0]?.value, 0);
            const peek2 = lines[lineIdx];
            const p2Fields =
              peek2 && !peek2.isCommentOrBlank ? extractFieldsFromCstTokens(peek2.tokens, text, "delimited") : [];
            if (
              p2Fields.length > 0 &&
              !isPsseSectionTerminator(p2Fields) &&
              p2Fields[0]?.tokenType !== "QuotedString"
            ) {
              nextLine();
              ibus2 = parseNum(p2Fields[0]?.value, 0);
            }
          }
          vscDc.push({
            name,
            mdc: parseNum(toks[1], 1),
            rdc: parseNum(toks[2], 0.0),
            ibus1,
            ibus2,
            o1: parseNum(toks[3], 1),
            f1: parseNum(toks[4], 1.0),
            span,
          });
        }
        break;
      }

      case 9:
      case 16: {
        // Switched Shunts
        const busNum = parseNum(toks[0], 0);
        if (busNum > 0 && toks.length >= 10) {
          switchedShunts.push({
            i: busNum,
            modsw: parseNum(toks[1], 1),
            adjm: parseNum(toks[2], 0),
            stat: parseNum(toks[3], 1),
            vswhi: parseNum(toks[4], 1.05),
            vswlo: parseNum(toks[5], 0.95),
            swrem: parseNum(toks[6], 0),
            rmpct: parseNum(toks[7], 100.0),
            rmidnt: parseStr(toks[8], ""),
            binit: parseNum(toks[9], 0.0),
            n1: parseNum(toks[10], 0),
            b1: parseNum(toks[11], 0.0),
            span,
          });
        }
        break;
      }

      case 18: {
        // PSS/E v34/v35 Node-Breaker Substation Data
        const kw = String(toks[0] ?? "")
          .trim()
          .toUpperCase();
        if (currentSub && (kw === "NODE" || kw === "SWITCH" || kw === "BREAKER" || kw === "TERMINAL")) {
          if (kw === "NODE") {
            currentSub.nodes.push({
              ni: parseNum(toks[1], 0),
              name: parseStr(toks[2], `N${toks[1] ?? ""}`),
              ibus: parseNum(toks[3], 0),
              status: parseNum(toks[4], 1),
              span,
            });
          } else if (kw === "SWITCH" || kw === "BREAKER") {
            currentSub.switches.push({
              ni: parseNum(toks[1], 0),
              nj: parseNum(toks[2], 0),
              id: parseStr(toks[3], "1"),
              x: parseNum(toks[4], 0.0001),
              rate1: parseNum(toks[5], 0),
              rate2: parseNum(toks[6], 0),
              rate3: parseNum(toks[7], 0),
              status: toks.length <= 6 ? parseNum(toks[4], 1) : parseNum(toks[8], 1),
              type: parseNum(toks[9], 1),
              name: parseStr(toks[10], ""),
              span,
            });
          } else if (kw === "TERMINAL") {
            const rawEq = String(toks[1] ?? "GEN")
              .trim()
              .toUpperCase();
            const eqType: SubstationTerminalRecord["eqType"] =
              rawEq === "BUS" ||
              rawEq === "GEN" ||
              rawEq === "LOAD" ||
              rawEq === "SHUNT" ||
              rawEq === "SWSHUNT" ||
              rawEq === "BRANCH" ||
              rawEq === "XFMR" ||
              rawEq === "DC"
                ? rawEq
                : "GEN";
            currentSub.terminals.push({
              eqType,
              i: parseNum(toks[2], 0),
              j: toks[5] !== undefined ? parseNum(toks[3], 0) : undefined,
              id: parseStr(toks[5] !== undefined ? toks[4] : toks[3], "1"),
              ni: parseNum(toks[5] !== undefined ? toks[5] : toks[4], 0),
              span,
            });
          }
          break;
        }

        if (currentSub === null || subStage === "header") {
          const is = parseNum(toks[0], 0);
          if (is > 0) {
            currentSub = {
              is,
              name: parseStr(toks[1], `SUB ${is}`),
              lati: parseNum(toks[2], 0),
              long: parseNum(toks[3], 0),
              sgr: parseNum(toks[4], 0),
              nodes: [],
              switches: [],
              terminals: [],
              span,
            };
            subStage = "nodes";
          }
        } else if (subStage === "nodes") {
          const ni = parseNum(toks[0], 0);
          if (ni > 0) {
            currentSub.nodes.push({
              ni,
              name: parseStr(toks[1], `NODE ${ni}`),
              ibus: parseNum(toks[2], 0),
              status: parseNum(toks[3], 1),
              span,
            });
          }
        } else if (subStage === "switches") {
          const ni = parseNum(toks[0], 0);
          const nj = parseNum(toks[1], 0);
          if (ni > 0 && nj > 0) {
            currentSub.switches.push({
              ni,
              nj,
              id: parseStr(toks[2], "1"),
              x: toks.length <= 5 ? 0.0001 : parseNum(toks[3], 0.0001),
              rate1: toks.length <= 5 ? 0 : parseNum(toks[4], 0),
              rate2: toks.length <= 5 ? 0 : parseNum(toks[5], 0),
              rate3: toks.length <= 5 ? 0 : parseNum(toks[6], 0),
              status: toks.length <= 5 ? parseNum(toks[3], 1) : parseNum(toks[7], 1),
              type: parseNum(toks[8], 1),
              name: parseStr(toks[9], ""),
              span,
            });
          }
        } else if (subStage === "terminals") {
          const rawEq = String(toks[0] ?? "GEN")
            .trim()
            .toUpperCase();
          const eqType: SubstationTerminalRecord["eqType"] =
            rawEq === "BUS" ||
            rawEq === "GEN" ||
            rawEq === "LOAD" ||
            rawEq === "SHUNT" ||
            rawEq === "SWSHUNT" ||
            rawEq === "BRANCH" ||
            rawEq === "XFMR" ||
            rawEq === "DC"
              ? rawEq
              : "GEN";
          currentSub.terminals.push({
            eqType,
            i: parseNum(toks[1], 0),
            j: toks.length >= 5 ? parseNum(toks[2], 0) : undefined,
            id: parseStr(toks.length >= 5 ? toks[3] : toks[2], "1"),
            ni: parseNum(toks.length >= 5 ? toks[4] : toks[3], 0),
            span,
          });
        }
        break;
      }

      case 20: {
        // PSS/E v34/v35/v36 System Switching Device Data
        const iBus = parseNum(toks[col("I", 0)], 0);
        const jBus = parseNum(toks[col("J", 1)], 0);
        if (iBus > 0 && jBus > 0) {
          systemSwitchingDevices.push({
            i: iBus,
            j: jBus,
            ckt: parseStr(toks[col("CKT", 2)], "1"),
            x: parseNum(toks[col("X", 3)], 0.0001),
            rate1: parseNum(toks[col("RATE1", 4)], 0.0),
            rate2: parseNum(toks[col("RATE2", 5)], 0.0),
            rate3: parseNum(toks[col("RATE3", 6)], 0.0),
            stat: parseNum(toks[col("STAT", 7)], 1),
            nstat: parseNum(toks[col("NSTAT", 8)], 1),
            met: parseNum(toks[col("MET", 9)], 1),
            stype: parseNum(toks[col("STYPE", 10)], 1),
            name: parseStr(toks[col("NAME", 11)], ""),
            span,
          });
        }
        break;
      }

      default:
        break;
    }
  }

  flushCurrentSub();

  return {
    header,
    title1,
    title2,
    buses,
    loads,
    fixedShunts,
    generators,
    branches,
    transformers,
    areas,
    twoTerminalDc,
    vscDc,
    switchedShunts,
    ...(substations.length > 0 ? { substations } : {}),
    ...(systemSwitchingDevices.length > 0 ? { systemSwitchingDevices } : {}),
    ...(openSection ? { unterminatedSection: openSection } : {}),
  };
}

export interface WriteRawOptions {
  /** Target PSS/E RAW format revision (`26 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36`). Defaults to `c.header.rev`. */
  rev?: number | undefined;
  /** Emit `@!` column metadata headers (default: `true` for `rev >= 34`, `false` otherwise). */
  includeMetadataHeaders?: boolean | undefined;
}

/**
 * Formats a `PsseCase` back into standard PSS/E RAW format text for any revision `v26`–`v36`.
 */
export function writeRaw(c: PsseCase, opts?: WriteRawOptions): string {
  const rev = opts?.rev ?? c.header.rev;
  const emitMeta = opts?.includeMetadataHeaders ?? rev >= 34;
  const lines: string[] = [];

  // Header
  if (rev <= 29) {
    lines.push(`0, ${c.header.sbase.toFixed(2)} / PSS/E-${rev} RAW Data File`);
  } else {
    lines.push(
      `0, ${c.header.sbase.toFixed(2)}, ${rev}, ${c.header.xfrrat}, ${c.header.nxfrat}, ${c.header.basfrq.toFixed(2)} / PSS/E-${rev} RAW Data File`,
    );
  }
  lines.push(c.title1 || "MODELSCALE POWER FLOW BASE CASE");
  lines.push(c.title2 || "");

  // Aggregate fixed shunts by bus when exporting to pre-v31 formats (v26, v29, v30)
  const shuntByBus = new Map<number, { gl: number; bl: number }>();
  if (rev <= 30) {
    for (const s of c.fixedShunts) {
      if (s.status !== 1) continue;
      const cur = shuntByBus.get(s.i) ?? { gl: 0, bl: 0 };
      cur.gl += s.gl;
      cur.bl += s.bl;
      shuntByBus.set(s.i, cur);
    }
  }

  // Bus Data
  if (emitMeta) {
    lines.push("@!   I, 'NAME        ', BASKV, IDE, AREA, ZONE, OWNER, VM, VA, NVHI, NVLO, EVHI, EVLO");
  }
  for (const b of c.buses.values()) {
    if (rev <= 26) {
      const sh = shuntByBus.get(b.i) ?? { gl: 0, bl: 0 };
      lines.push(
        `${b.i}, '${b.name}', ${b.baseKv.toFixed(3)}, ${b.ide}, ${sh.gl.toFixed(3)}, ${sh.bl.toFixed(3)}, ${b.area}, ${b.zone}, ${b.vm.toFixed(4)}, ${b.va.toFixed(4)}`,
      );
    } else if (rev <= 30) {
      const sh = shuntByBus.get(b.i) ?? { gl: 0, bl: 0 };
      lines.push(
        `${b.i}, '${b.name}', ${b.baseKv.toFixed(3)}, ${b.ide}, ${sh.gl.toFixed(3)}, ${sh.bl.toFixed(3)}, ${b.area}, ${b.zone}, ${b.vm.toFixed(4)}, ${b.va.toFixed(4)}, ${b.owner}`,
      );
    } else if (rev >= 32) {
      lines.push(
        `${b.i}, '${b.name}', ${b.baseKv.toFixed(3)}, ${b.ide}, ${b.area}, ${b.zone}, ${b.owner}, ${b.vm.toFixed(4)}, ${b.va.toFixed(4)}, ${(b.nvhi ?? 1.1).toFixed(4)}, ${(b.nvlo ?? 0.9).toFixed(4)}, ${(b.evhi ?? 1.1).toFixed(4)}, ${(b.evlo ?? 0.9).toFixed(4)}`,
      );
    } else {
      lines.push(
        `${b.i}, '${b.name}', ${b.baseKv.toFixed(3)}, ${b.ide}, ${b.area}, ${b.zone}, ${b.owner}, ${b.vm.toFixed(4)}, ${b.va.toFixed(4)}`,
      );
    }
  }
  lines.push("0 / END OF BUS DATA, BEGIN LOAD DATA");

  // Load Data
  if (emitMeta) {
    lines.push("@!   I, 'ID', STATUS, AREA, ZONE, PL, QL, IP, IQ, YP, YQ, OWNER, SCALE, INTRPT");
  }
  for (const l of c.loads) {
    lines.push(
      `${l.i}, '${l.id}', ${l.status}, ${l.area}, ${l.zone}, ${l.pl.toFixed(3)}, ${l.ql.toFixed(3)}, ${l.ip.toFixed(3)}, ${l.iq.toFixed(3)}, ${l.yp.toFixed(3)}, ${l.yq.toFixed(3)}, ${l.owner}, ${l.scale}, ${l.intrct}`,
    );
  }
  if (rev <= 30) {
    lines.push("0 / END OF LOAD DATA, BEGIN GENERATOR DATA");
  } else {
    lines.push("0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA");
    // Fixed Shunt Data (v31+)
    if (emitMeta) {
      lines.push("@!   I, 'ID', STATUS, GL, BL");
    }
    for (const s of c.fixedShunts) {
      lines.push(`${s.i}, '${s.id}', ${s.status}, ${s.gl.toFixed(3)}, ${s.bl.toFixed(3)}`);
    }
    lines.push("0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA");
  }

  // Generator Data
  if (emitMeta) {
    lines.push(
      rev >= 35
        ? "@!   I, 'ID', PG, QG, QT, QB, VS, IREG, NREG, MBASE, ZR, ZX, RT, XT, GTAP, STAT, RMPCT, PT, PB, O1, F1"
        : "@!   I, 'ID', PG, QG, QT, QB, VS, IREG, MBASE, ZR, ZX, RT, XT, GTAP, STAT, RMPCT, PT, PB, O1, F1",
    );
  }
  for (const g of c.generators) {
    if (rev >= 35) {
      lines.push(
        `${g.i}, '${g.id}', ${g.pg.toFixed(3)}, ${g.qg.toFixed(3)}, ${g.qt.toFixed(3)}, ${g.qb.toFixed(3)}, ${g.vs.toFixed(4)}, ${g.ireg}, 0, ${g.mbase.toFixed(2)}, ${g.zr.toFixed(5)}, ${g.zx.toFixed(5)}, ${g.rt.toFixed(5)}, ${g.xt.toFixed(5)}, ${g.gtap.toFixed(4)}, ${g.stat}, ${g.rmpct.toFixed(1)}, ${g.pt.toFixed(3)}, ${g.pb.toFixed(3)}, ${g.o1 ?? 1}, ${(g.f1 ?? 1.0).toFixed(4)}`,
      );
    } else {
      lines.push(
        `${g.i}, '${g.id}', ${g.pg.toFixed(3)}, ${g.qg.toFixed(3)}, ${g.qt.toFixed(3)}, ${g.qb.toFixed(3)}, ${g.vs.toFixed(4)}, ${g.ireg}, ${g.mbase.toFixed(2)}, ${g.zr.toFixed(5)}, ${g.zx.toFixed(5)}, ${g.rt.toFixed(5)}, ${g.xt.toFixed(5)}, ${g.gtap.toFixed(4)}, ${g.stat}, ${g.rmpct.toFixed(1)}, ${g.pt.toFixed(3)}, ${g.pb.toFixed(3)}`,
      );
    }
  }
  lines.push("0 / END OF GENERATOR DATA, BEGIN BRANCH DATA");

  // Branch Data
  if (emitMeta) {
    lines.push(
      rev >= 35
        ? "@!   I, J, 'CKT', R, X, B, 'NAME', RATE1, RATE2, RATE3, RATE4, RATE5, RATE6, RATE7, RATE8, RATE9, RATE10, RATE11, RATE12, GI, BI, GJ, BJ, STAT, MET, LEN, O1, F1"
        : "@!   I, J, 'CKT', R, X, B, RATEA, RATEB, RATEC, GI, BI, GJ, BJ, ST, MET, LEN",
    );
  }
  for (const br of c.branches) {
    if (rev >= 35) {
      lines.push(
        `${br.i}, ${br.j}, '${br.ckt}', ${br.r.toFixed(5)}, ${br.x.toFixed(5)}, ${br.b.toFixed(5)}, '', ${br.rateA.toFixed(2)}, ${br.rateB.toFixed(2)}, ${br.rateC.toFixed(2)}, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, ${br.gi.toFixed(5)}, ${br.bi.toFixed(5)}, ${br.gj.toFixed(5)}, ${br.bj.toFixed(5)}, ${br.st}, ${br.met}, ${br.len.toFixed(2)}, ${br.o1 ?? 1}, ${(br.f1 ?? 1.0).toFixed(4)}`,
      );
    } else {
      lines.push(
        `${br.i}, ${br.j}, '${br.ckt}', ${br.r.toFixed(5)}, ${br.x.toFixed(5)}, ${br.b.toFixed(5)}, ${br.rateA.toFixed(2)}, ${br.rateB.toFixed(2)}, ${br.rateC.toFixed(2)}, ${br.gi.toFixed(5)}, ${br.bi.toFixed(5)}, ${br.gj.toFixed(5)}, ${br.bj.toFixed(5)}, ${br.st}, ${br.met}, ${br.len.toFixed(2)}`,
      );
    }
  }
  if (rev >= 34 && c.systemSwitchingDevices && c.systemSwitchingDevices.length > 0) {
    lines.push("0 / END OF BRANCH DATA, BEGIN SYSTEM SWITCHING DEVICE DATA");
    if (emitMeta) {
      lines.push("@!   I, J, 'CKT', X, RATE1, RATE2, RATE3, STAT, NSTAT, MET, STYPE, 'NAME'");
    }
    for (const swd of c.systemSwitchingDevices) {
      lines.push(
        `${swd.i}, ${swd.j}, '${swd.ckt}', ${swd.x.toFixed(5)}, ${swd.rate1.toFixed(2)}, ${swd.rate2.toFixed(2)}, ${swd.rate3.toFixed(2)}, ${swd.stat}, ${swd.nstat}, ${swd.met}, ${swd.stype}, '${swd.name}'`,
      );
    }
    lines.push("0 / END OF SYSTEM SWITCHING DEVICE DATA, BEGIN TRANSFORMER DATA");
  } else {
    lines.push("0 / END OF BRANCH DATA, BEGIN TRANSFORMER DATA");
  }

  // Transformer Data
  for (const t of c.transformers) {
    lines.push(
      `${t.i}, ${t.j}, ${t.k}, '${t.ckt}', ${t.cw}, ${t.cz ?? 1}, ${t.cm}, ${t.mag1.toFixed(5)}, ${t.mag2.toFixed(5)}, ${t.nmetr}, '${t.name}', ${t.stat}`,
    );
    if (t.k !== 0) {
      lines.push(
        `${t.r12.toFixed(5)}, ${t.x12.toFixed(5)}, ${t.sbase12.toFixed(2)}, ${(t.r23 ?? 0).toFixed(5)}, ${(t.x23 ?? 0).toFixed(5)}, ${(t.sbase23 ?? t.sbase12).toFixed(2)}, ${(t.r31 ?? 0).toFixed(5)}, ${(t.x31 ?? 0).toFixed(5)}, ${(t.sbase31 ?? t.sbase12).toFixed(2)}, ${(t.vmstar ?? 1).toFixed(4)}, ${(t.anstar ?? 0).toFixed(4)}`,
      );
    } else {
      lines.push(`${t.r12.toFixed(5)}, ${t.x12.toFixed(5)}, ${t.sbase12.toFixed(2)}`);
    }
    lines.push(
      `${t.windv1.toFixed(4)}, ${t.nomv1.toFixed(2)}, ${t.ang1.toFixed(2)}, ${t.rata1.toFixed(2)}, ${t.ratb1.toFixed(2)}, ${t.ratc1.toFixed(2)}, ${t.cod1}, ${t.cont1}, ${t.rma1.toFixed(4)}, ${t.rmi1.toFixed(4)}, ${t.vma1.toFixed(4)}, ${t.vmi1.toFixed(4)}, ${t.ntp1}, ${t.tab1}, ${t.cr1.toFixed(5)}, ${t.cx1.toFixed(5)}, ${t.cnxa1.toFixed(2)}`,
    );
    if (t.k !== 0) {
      lines.push(
        `${t.windv2.toFixed(4)}, ${t.nomv2.toFixed(2)}, ${(t.ang2 ?? 0).toFixed(2)}, ${(t.rata2 ?? 0).toFixed(2)}, ${(t.ratb2 ?? 0).toFixed(2)}, ${(t.ratc2 ?? 0).toFixed(2)}`,
      );
      lines.push(
        `${(t.windv3 ?? 1).toFixed(4)}, ${(t.nomv3 ?? 0).toFixed(2)}, ${(t.ang3 ?? 0).toFixed(2)}, ${(t.rata3 ?? 0).toFixed(2)}, ${(t.ratb3 ?? 0).toFixed(2)}, ${(t.ratc3 ?? 0).toFixed(2)}`,
      );
    } else {
      lines.push(`${t.windv2.toFixed(4)}, ${t.nomv2.toFixed(2)}`);
    }
  }
  lines.push("0 / END OF TRANSFORMER DATA, BEGIN AREA DATA");

  // Area Interchange Data
  for (const a of c.areas) {
    lines.push(`${a.i}, ${a.isw}, ${a.pdes.toFixed(3)}, ${a.ptol.toFixed(3)}, '${a.arname}'`);
  }
  lines.push("0 / END OF AREA DATA, BEGIN TWO-TERMINAL DC DATA");

  // Two-Terminal DC Data
  for (const dc of c.twoTerminalDc) {
    lines.push(
      `${dc.i}, ${dc.mdc}, ${dc.rdc.toFixed(4)}, ${dc.setvl.toFixed(2)}, ${dc.vschd.toFixed(2)}, ${dc.vcmod.toFixed(2)}, ${dc.rcomp.toFixed(4)}, ${dc.deltm.toFixed(2)}`,
    );
  }
  lines.push("0 / END OF TWO-TERMINAL DC DATA, BEGIN VSC DC DATA");

  // VSC DC Data
  for (const vsc of c.vscDc) {
    lines.push(`'${vsc.name}', ${vsc.mdc}, ${vsc.rdc.toFixed(4)}`);
  }
  lines.push("0 / END OF VSC DC DATA, BEGIN SWITCHED SHUNT DATA");

  // Switched Shunt Data
  for (const sw of c.switchedShunts) {
    lines.push(
      `${sw.i}, ${sw.modsw}, ${sw.adjm}, ${sw.stat}, ${sw.vswhi.toFixed(4)}, ${sw.vswlo.toFixed(4)}, ${sw.swrem}, ${sw.rmpct.toFixed(1)}, '${sw.rmidnt}', ${sw.binit.toFixed(3)}, ${sw.n1}, ${sw.b1.toFixed(3)}`,
    );
  }
  lines.push("0 / END OF SWITCHED SHUNT DATA");

  if (rev >= 34 && c.substations && c.substations.length > 0) {
    lines.push("0 / BEGIN SUBSTATION DATA");
    for (const sub of c.substations) {
      lines.push(`${sub.is}, '${sub.name}', ${sub.lati.toFixed(4)}, ${sub.long.toFixed(4)}, ${sub.sgr.toFixed(4)}`);
      for (const n of sub.nodes) {
        lines.push(`${n.ni}, '${n.name}', ${n.ibus}, ${n.status}`);
      }
      lines.push("0 / END OF SUBSTATION NODE DATA");
      for (const sw of sub.switches) {
        lines.push(
          `${sw.ni}, ${sw.nj}, '${sw.id}', ${sw.x.toFixed(5)}, ${sw.rate1.toFixed(2)}, ${sw.rate2.toFixed(2)}, ${sw.rate3.toFixed(2)}, ${sw.status}, ${sw.type}, '${sw.name}'`,
        );
      }
      lines.push("0 / END OF SWITCHING DEVICE DATA");
      for (const t of sub.terminals) {
        lines.push(
          t.j !== undefined
            ? `'${t.eqType}', ${t.i}, ${t.j}, '${t.id}', ${t.ni}`
            : `'${t.eqType}', ${t.i}, '${t.id}', ${t.ni}`,
        );
      }
      lines.push("0 / END OF SUBSTATION TERMINALS");
    }
    lines.push("0 / END OF SUBSTATION DATA");
  }

  lines.push("Q");
  return lines.join("\n") + "\n";
}

export const serializeRaw = writeRaw;

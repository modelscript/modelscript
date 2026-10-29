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
  SwitchedShuntRecord,
  TransformerRecord,
  TwoTerminalDcRecord,
  VscDcRecord,
} from "../types.js";

/**
 * Splits a PSS/E line into token strings, respecting quotes and discarding comments after `/`.
 */
export function tokenizeRawLine(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;

    if (!inQuote && ch === "/") {
      // Remainder of line is a comment
      break;
    }

    if (ch === "'" || ch === '"') {
      if (!inQuote) {
        inQuote = true;
        quoteChar = ch;
      } else if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
      continue;
    }

    if (!inQuote && (ch === "," || ch === "\t")) {
      tokens.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  tokens.push(current.trim());
  return tokens;
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
  return val.replace(/^['"]|['"]$/g, "").trim();
}

/**
 * Parses PSS/E RAW format text into a structured `PsseCase`.
 */
export function parseRaw(text: string): PsseCase {
  const lines = text.split(/\r?\n/);
  let lineIdx = 0;
  let charOffset = 0;

  function nextLine(): { line: string; lineNum: number; startOffset: number; endOffset: number } | null {
    if (lineIdx >= lines.length) return null;
    const l = lines[lineIdx]!;
    const start = charOffset;
    const end = start + l.length;
    // Add 1 for newline in offset tracking
    charOffset = end + 1;
    lineIdx++;
    return { line: l, lineNum: lineIdx, startOffset: start, endOffset: end };
  }

  // Skip any leading comment lines (@! or /) before the Case Identification header
  while (lineIdx < lines.length) {
    const peek = lines[lineIdx]!.trim();
    if (peek === "" || peek.startsWith("@!") || peek.startsWith("/")) {
      nextLine();
    } else {
      break;
    }
  }

  // 1. Header (Case Identification)
  const headerLineInfo = nextLine();
  const headerTokens = headerLineInfo ? tokenizeRawLine(headerLineInfo.line) : [];
  const header: CaseIdentification = {
    ic: parseNum(headerTokens[0], 0),
    sbase: parseNum(headerTokens[1], 100.0),
    rev: parseNum(headerTokens[2], 33),
    xfrrat: parseNum(headerTokens[3], 0),
    nxfrat: parseNum(headerTokens[4], 0),
    basfrq: parseNum(headerTokens[5], 60.0),
    span: headerLineInfo
      ? {
          startOffset: headerLineInfo.startOffset,
          endOffset: headerLineInfo.endOffset,
          line: headerLineInfo.lineNum,
          column: 1,
        }
      : undefined,
  };

  function isLikelyBusRecord(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("/") || trimmed.startsWith("@!")) return false;
    const toks = tokenizeRawLine(trimmed);
    if (toks.length < 7) return false;
    const busNum = Number(toks[0]);
    const baseKv = Number(toks[2]);
    const ide = Number(toks[3]);
    return (
      Number.isInteger(busNum) &&
      busNum > 0 &&
      Number.isFinite(baseKv) &&
      baseKv >= 0 &&
      (ide === 1 || ide === 2 || ide === 3 || ide === 4)
    );
  }

  // 2. Title Line 1 (unless the file omits title lines and starts Bus Data immediately)
  let title1 = "";
  if (lineIdx < lines.length && !isLikelyBusRecord(lines[lineIdx]!)) {
    const t1 = nextLine();
    title1 = t1 ? t1.line.trim() : "";
  }

  // 3. Title Line 2 (unless Bus Data starts on line 3)
  let title2 = "";
  if (lineIdx < lines.length && !isLikelyBusRecord(lines[lineIdx]!)) {
    const t2 = nextLine();
    title2 = t2 ? t2.line.trim() : "";
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

  // Section codes:
  // 0=Bus, 1=Load, 2=FixedShunt, 3=Gen, 4=Branch, 5=Xfmr, 6=Area, 7=2TermDC, 8=VscDC,
  // 9=SwitchedShunt (or ImpedanceCorrection in full v33), 10..15=Intermediate v33 sections, 16=SwitchedShunt
  let section = 0;

  function resolveSectionFromComment(commentLine: string, currentSec: number): number {
    const upper = commentLine.toUpperCase();
    if (/^Q(?:\s*,|\s*\/|\s*$)/i.test(commentLine.trim())) return 99;
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
    return currentSec + 1;
  }

  while (lineIdx < lines.length) {
    const info = nextLine();
    if (!info) break;
    const trimmed = info.line.trim();
    if (trimmed === "" || trimmed.startsWith("/") || trimmed.startsWith("@!")) continue;

    // Check for section terminator ('0', '0 / ...', '0, ...', 'Q', 'Q / ...') without matching '0.000'
    if (/^(?:0(?:\s*,|\s*\/|\s*$)|Q(?:\s*,|\s*\/|\s*$))/i.test(trimmed)) {
      section = resolveSectionFromComment(trimmed, section);
      if (section >= 99) break;
      continue;
    }

    const toks = tokenizeRawLine(info.line);
    const span: SourceSpan = {
      startOffset: info.startOffset,
      endOffset: info.endOffset,
      line: info.lineNum,
      column: 1,
    };

    switch (section) {
      case 0: {
        // Bus Data
        const busNum = parseNum(toks[0], 0);
        if (busNum > 0) {
          const bus: BusRecord = {
            i: busNum,
            name: parseStr(toks[1], `BUS ${busNum}`),
            baseKv: parseNum(toks[2], 0),
            ide: (parseNum(toks[3], 1) as BusType) || 1,
            area: parseNum(toks[4], 1),
            zone: parseNum(toks[5], 1),
            owner: parseNum(toks[6], 1),
            vm: parseNum(toks[7], 1.0),
            va: parseNum(toks[8], 0.0),
            nvhi: toks[9] !== undefined ? parseNum(toks[9], 1.1) : undefined,
            nvlo: toks[10] !== undefined ? parseNum(toks[10], 0.9) : undefined,
            evhi: toks[11] !== undefined ? parseNum(toks[11], 1.1) : undefined,
            evlo: toks[12] !== undefined ? parseNum(toks[12], 0.9) : undefined,
            span,
          };
          buses.set(busNum, bus);
        }
        break;
      }

      case 1: {
        // Load Data
        const busNum = parseNum(toks[0], 0);
        if (busNum > 0) {
          loads.push({
            i: busNum,
            id: parseStr(toks[1], "1"),
            status: parseNum(toks[2], 1),
            area: parseNum(toks[3], 1),
            zone: parseNum(toks[4], 1),
            pl: parseNum(toks[5], 0.0),
            ql: parseNum(toks[6], 0.0),
            ip: parseNum(toks[7], 0.0),
            iq: parseNum(toks[8], 0.0),
            yp: parseNum(toks[9], 0.0),
            yq: parseNum(toks[10], 0.0),
            owner: parseNum(toks[11], 1),
            scale: parseNum(toks[12], 1),
            intrct: parseNum(toks[13], 1),
            span,
          });
        }
        break;
      }

      case 2: {
        // Fixed Bus Shunt Data
        const busNum = parseNum(toks[0], 0);
        if (busNum > 0) {
          fixedShunts.push({
            i: busNum,
            id: parseStr(toks[1], "1"),
            status: parseNum(toks[2], 1),
            gl: parseNum(toks[3], 0.0),
            bl: parseNum(toks[4], 0.0),
            span,
          });
        }
        break;
      }

      case 3: {
        // Generator Data
        const busNum = parseNum(toks[0], 0);
        if (busNum > 0) {
          generators.push({
            i: busNum,
            id: parseStr(toks[1], "1"),
            pg: parseNum(toks[2], 0.0),
            qg: parseNum(toks[3], 0.0),
            qt: parseNum(toks[4], 9999.0),
            qb: parseNum(toks[5], -9999.0),
            vs: parseNum(toks[6], 1.0),
            ireg: parseNum(toks[7], 0),
            mbase: parseNum(toks[8], header.sbase),
            zr: parseNum(toks[9], 0.0),
            zx: parseNum(toks[10], 1.0),
            rt: parseNum(toks[11], 0.0),
            xt: parseNum(toks[12], 0.0),
            gtap: parseNum(toks[13], 1.0),
            stat: parseNum(toks[14], 1),
            rmpct: parseNum(toks[15], 100.0),
            pt: parseNum(toks[16], 9999.0),
            pb: parseNum(toks[17], -9999.0),
            o1: toks[18] !== undefined ? parseNum(toks[18], 1) : undefined,
            f1: toks[19] !== undefined ? parseNum(toks[19], 1.0) : undefined,
            span,
          });
        }
        break;
      }

      case 4: {
        // Branch Data
        const fromBus = parseNum(toks[0], 0);
        const toBus = parseNum(toks[1], 0);
        if (fromBus > 0 && toBus !== 0) {
          branches.push({
            i: fromBus,
            j: toBus,
            ckt: parseStr(toks[2], "1"),
            r: parseNum(toks[3], 0.0),
            x: parseNum(toks[4], 0.0001),
            b: parseNum(toks[5], 0.0),
            rateA: parseNum(toks[6], 0.0),
            rateB: parseNum(toks[7], 0.0),
            rateC: parseNum(toks[8], 0.0),
            gi: parseNum(toks[9], 0.0),
            bi: parseNum(toks[10], 0.0),
            gj: parseNum(toks[11], 0.0),
            bj: parseNum(toks[12], 0.0),
            st: parseNum(toks[13], 1),
            met: parseNum(toks[14], 1),
            len: parseNum(toks[15], 0.0),
            o1: toks[16] !== undefined ? parseNum(toks[16], 1) : undefined,
            f1: toks[17] !== undefined ? parseNum(toks[17], 1.0) : undefined,
            span,
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
          const l2 = nextLine();
          const toks2 = l2 ? tokenizeRawLine(l2.line) : [];
          const l3 = nextLine();
          const toks3 = l3 ? tokenizeRawLine(l3.line) : [];
          const l4 = nextLine();
          const toks4 = l4 ? tokenizeRawLine(l4.line) : [];
          let toks5: string[] = [];
          if (kBus !== 0) {
            const l5 = nextLine();
            toks5 = l5 ? tokenizeRawLine(l5.line) : [];
          }

          transformers.push({
            i: iBus,
            j: jBus,
            k: kBus,
            ckt: parseStr(toks[3], "1"),
            cw: parseNum(toks[4], 1),
            cm: parseNum(toks[5], 1),
            mag1: parseNum(toks[6], 0.0),
            mag2: parseNum(toks[7], 0.0),
            nmetr: parseNum(toks[8], 2),
            name: parseStr(toks[9], ""),
            stat: parseNum(toks[10], 1),
            o1: toks[11] !== undefined ? parseNum(toks[11], 1) : undefined,
            f1: toks[12] !== undefined ? parseNum(toks[12], 1.0) : undefined,
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
            span,
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
        if (dcNum > 0 || toks[0]?.startsWith("'")) {
          const idNum = dcNum > 0 ? dcNum : twoTerminalDc.length + 1;
          let ipr: number | undefined;
          let ipi: number | undefined;
          // Consume optional rectifier/inverter continuation lines if present in 3-line v33 format
          const peek1 = lines[lineIdx]?.trim() ?? "";
          if (peek1 && !/^(?:0(?:\s*,|\s*\/|\s*$)|Q(?:\s*,|\s*\/|\s*$))/i.test(peek1)) {
            const p1Toks = tokenizeRawLine(peek1);
            if (p1Toks.length >= 10 && !peek1.startsWith("'")) {
              nextLine();
              ipr = parseNum(p1Toks[0], 0);
              const peek2 = lines[lineIdx]?.trim() ?? "";
              if (peek2 && !/^(?:0(?:\s*,|\s*\/|\s*$)|Q(?:\s*,|\s*\/|\s*$))/i.test(peek2)) {
                const p2Toks = tokenizeRawLine(peek2);
                nextLine();
                ipi = parseNum(p2Toks[0], 0);
              }
            }
          }
          twoTerminalDc.push({
            i: idNum,
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
          const peek1 = lines[lineIdx]?.trim() ?? "";
          if (peek1 && !/^(?:0(?:\s*,|\s*\/|\s*$)|Q(?:\s*,|\s*\/|\s*$))/i.test(peek1) && !peek1.startsWith("'")) {
            const p1Toks = tokenizeRawLine(peek1);
            nextLine();
            ibus1 = parseNum(p1Toks[0], 0);
            const peek2 = lines[lineIdx]?.trim() ?? "";
            if (peek2 && !/^(?:0(?:\s*,|\s*\/|\s*$)|Q(?:\s*,|\s*\/|\s*$))/i.test(peek2) && !peek2.startsWith("'")) {
              const p2Toks = tokenizeRawLine(peek2);
              nextLine();
              ibus2 = parseNum(p2Toks[0], 0);
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

      default:
        break;
    }
  }

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
  };
}

/**
 * Formats a `PsseCase` back into standard PSS/E RAW format text.
 */
export function writeRaw(c: PsseCase): string {
  const lines: string[] = [];

  // Header
  lines.push(
    `0, ${c.header.sbase.toFixed(2)}, ${c.header.rev}, ${c.header.xfrrat}, ${c.header.nxfrat}, ${c.header.basfrq.toFixed(2)} / PSS/E RAW Data File`,
  );
  lines.push(c.title1 || "MODELSCALE POWER FLOW BASE CASE");
  lines.push(c.title2 || "");

  // Bus Data
  for (const b of c.buses.values()) {
    lines.push(
      `${b.i}, '${b.name}', ${b.baseKv.toFixed(3)}, ${b.ide}, ${b.area}, ${b.zone}, ${b.owner}, ${b.vm.toFixed(4)}, ${b.va.toFixed(4)}`,
    );
  }
  lines.push("0 / END OF BUS DATA");

  // Load Data
  for (const l of c.loads) {
    lines.push(
      `${l.i}, '${l.id}', ${l.status}, ${l.area}, ${l.zone}, ${l.pl.toFixed(3)}, ${l.ql.toFixed(3)}, ${l.ip.toFixed(3)}, ${l.iq.toFixed(3)}, ${l.yp.toFixed(3)}, ${l.yq.toFixed(3)}, ${l.owner}, ${l.scale}, ${l.intrct}`,
    );
  }
  lines.push("0 / END OF LOAD DATA");

  // Fixed Shunt Data
  for (const s of c.fixedShunts) {
    lines.push(`${s.i}, '${s.id}', ${s.status}, ${s.gl.toFixed(3)}, ${s.bl.toFixed(3)}`);
  }
  lines.push("0 / END OF FIXED SHUNT DATA");

  // Generator Data
  for (const g of c.generators) {
    lines.push(
      `${g.i}, '${g.id}', ${g.pg.toFixed(3)}, ${g.qg.toFixed(3)}, ${g.qt.toFixed(3)}, ${g.qb.toFixed(3)}, ${g.vs.toFixed(4)}, ${g.ireg}, ${g.mbase.toFixed(2)}, ${g.zr.toFixed(5)}, ${g.zx.toFixed(5)}, ${g.rt.toFixed(5)}, ${g.xt.toFixed(5)}, ${g.gtap.toFixed(4)}, ${g.stat}, ${g.rmpct.toFixed(1)}, ${g.pt.toFixed(3)}, ${g.pb.toFixed(3)}`,
    );
  }
  lines.push("0 / END OF GENERATOR DATA");

  // Branch Data
  for (const br of c.branches) {
    lines.push(
      `${br.i}, ${br.j}, '${br.ckt}', ${br.r.toFixed(5)}, ${br.x.toFixed(5)}, ${br.b.toFixed(5)}, ${br.rateA.toFixed(2)}, ${br.rateB.toFixed(2)}, ${br.rateC.toFixed(2)}, ${br.gi.toFixed(5)}, ${br.bi.toFixed(5)}, ${br.gj.toFixed(5)}, ${br.bj.toFixed(5)}, ${br.st}, ${br.met}, ${br.len.toFixed(2)}`,
    );
  }
  lines.push("0 / END OF BRANCH DATA");

  // Transformer Data
  for (const t of c.transformers) {
    lines.push(
      `${t.i}, ${t.j}, ${t.k}, '${t.ckt}', ${t.cw}, ${t.cm}, ${t.mag1.toFixed(5)}, ${t.mag2.toFixed(5)}, ${t.nmetr}, '${t.name}', ${t.stat}`,
    );
    lines.push(`${t.r12.toFixed(5)}, ${t.x12.toFixed(5)}, ${t.sbase12.toFixed(2)}`);
    lines.push(
      `${t.windv1.toFixed(4)}, ${t.nomv1.toFixed(2)}, ${t.ang1.toFixed(2)}, ${t.rata1.toFixed(2)}, ${t.ratb1.toFixed(2)}, ${t.ratc1.toFixed(2)}, ${t.cod1}, ${t.cont1}, ${t.rma1.toFixed(4)}, ${t.rmi1.toFixed(4)}, ${t.vma1.toFixed(4)}, ${t.vmi1.toFixed(4)}, ${t.ntp1}, ${t.tab1}, ${t.cr1.toFixed(5)}, ${t.cx1.toFixed(5)}, ${t.cnxa1.toFixed(2)}`,
    );
    lines.push(`${t.windv2.toFixed(4)}, ${t.nomv2.toFixed(2)}`);
  }
  lines.push("0 / END OF TRANSFORMER DATA");

  // Area Interchange Data
  for (const a of c.areas) {
    lines.push(`${a.i}, ${a.isw}, ${a.pdes.toFixed(3)}, ${a.ptol.toFixed(3)}, '${a.arname}'`);
  }
  lines.push("0 / END OF AREA DATA");

  // Two-Terminal DC Data
  for (const dc of c.twoTerminalDc) {
    lines.push(
      `${dc.i}, ${dc.mdc}, ${dc.rdc.toFixed(4)}, ${dc.setvl.toFixed(2)}, ${dc.vschd.toFixed(2)}, ${dc.vcmod.toFixed(2)}, ${dc.rcomp.toFixed(4)}, ${dc.deltm.toFixed(2)}`,
    );
  }
  lines.push("0 / END OF TWO-TERMINAL DC DATA");

  // VSC DC Data
  for (const vsc of c.vscDc) {
    lines.push(`'${vsc.name}', ${vsc.mdc}, ${vsc.rdc.toFixed(4)}`);
  }
  lines.push("0 / END OF VSC DC DATA");

  // Switched Shunt Data
  for (const sw of c.switchedShunts) {
    lines.push(
      `${sw.i}, ${sw.modsw}, ${sw.adjm}, ${sw.stat}, ${sw.vswhi.toFixed(4)}, ${sw.vswlo.toFixed(4)}, ${sw.swrem}, ${sw.rmpct.toFixed(1)}, '${sw.rmidnt}', ${sw.binit.toFixed(3)}, ${sw.n1}, ${sw.b1.toFixed(3)}`,
    );
  }
  lines.push("0 / END OF SWITCHED SHUNT DATA");

  return lines.join("\n") + "\n";
}

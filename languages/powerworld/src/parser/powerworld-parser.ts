// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/powerworld — PowerWorld Auxiliary (.aux) Parser.
 *
 * Parses DATA (ObjectType, [Fields]) { ... } and SCRIPT { ... } blocks
 * into typed Bus, Gen, Load, Branch, Shunt, and Contingency collections.
 */

import type {
  AuxBranch,
  AuxBus,
  AuxContingency,
  AuxDataRow,
  AuxDataSection,
  AuxGen,
  AuxLoad,
  AuxScriptBlock,
  AuxScriptCommand,
  AuxShunt,
  AuxSourceSpan,
  PowerWorldAuxModel,
} from "../types.js";

function unquote(val: string): string {
  const trimmed = val.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function toNum(val: string | undefined, fallback = 0): number {
  if (val === undefined || val === "") return fallback;
  const n = Number(unquote(val));
  return Number.isFinite(n) ? n : fallback;
}

function isStatusOpen(val: string | undefined): boolean {
  const s = unquote(val ?? "").toUpperCase();
  return s === "OPEN" || s === "NO" || s === "0" || s === "FALSE";
}

function isTruthyFlag(val: string | undefined): boolean {
  const s = unquote(val ?? "").toUpperCase();
  return s === "YES" || s === "TRUE" || s === "1";
}

class AuxScanner {
  private pos = 0;
  private line = 1;
  private col = 1;

  constructor(private readonly src: string) {}

  get offset(): number {
    return this.pos;
  }

  get currentLine(): number {
    return this.line;
  }

  get currentColumn(): number {
    return this.col;
  }

  eof(): boolean {
    return this.pos >= this.src.length;
  }

  peek(offset = 0): string {
    return this.src[this.pos + offset] ?? "";
  }

  advance(count = 1): void {
    for (let i = 0; i < count && this.pos < this.src.length; i++) {
      const ch = this.src[this.pos]!;
      this.pos++;
      if (ch === "\n") {
        this.line++;
        this.col = 1;
      } else {
        this.col++;
      }
    }
  }

  skipWhitespaceAndComments(): void {
    while (!this.eof()) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        this.advance();
        continue;
      }
      if (ch === "/" && this.peek(1) === "/") {
        while (!this.eof() && this.peek() !== "\n") this.advance();
        continue;
      }
      if (ch === "/" && this.peek(1) === "*") {
        this.advance(2);
        while (!this.eof() && !(this.peek() === "*" && this.peek(1) === "/")) {
          this.advance();
        }
        if (!this.eof()) this.advance(2);
        continue;
      }
      break;
    }
  }

  readIdentifier(): string {
    this.skipWhitespaceAndComments();
    const start = this.pos;
    while (!this.eof() && /[a-zA-Z0-9_.:-]/.test(this.peek())) {
      this.advance();
    }
    return this.src.slice(start, this.pos);
  }

  readBalanced(
    openChar: string,
    closeChar: string,
  ): { body: string; startLine: number; startCol: number; startOffset: number } {
    this.skipWhitespaceAndComments();
    const startLine = this.line;
    const startCol = this.col;
    const startOffset = this.pos;
    if (this.peek() !== openChar) {
      return { body: "", startLine, startCol, startOffset };
    }
    this.advance();
    const bodyStart = this.pos;
    let depth = 1;
    let inSingle = false;
    let inDouble = false;
    while (!this.eof() && depth > 0) {
      const ch = this.peek();
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (!inSingle && !inDouble) {
        if (ch === openChar) depth++;
        else if (ch === closeChar) {
          depth--;
          if (depth === 0) {
            const body = this.src.slice(bodyStart, this.pos);
            this.advance();
            return { body, startLine, startCol, startOffset };
          }
        }
      }
      this.advance();
    }
    return { body: this.src.slice(bodyStart, this.pos), startLine, startCol, startOffset };
  }

  makeSpan(startLine: number, startCol: number, startOffset: number): AuxSourceSpan {
    return {
      line: startLine,
      column: startCol,
      endLine: this.line,
      endColumn: this.col,
      startOffset,
      endOffset: this.pos,
    };
  }
}

function splitTokens(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && (line[i] === " " || line[i] === "\t" || line[i] === ",")) i++;
    if (i >= line.length) break;
    const ch = line[i]!;
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      const start = i;
      while (i < line.length && line[i] !== quote) i++;
      tokens.push(line.slice(start, i));
      if (i < line.length) i++;
    } else {
      const start = i;
      while (i < line.length && line[i] !== " " && line[i] !== "\t" && line[i] !== ",") i++;
      tokens.push(line.slice(start, i));
    }
  }
  return tokens;
}

function parseDataHeader(header: string): { objectType: string; fields: string[] } {
  const commaIdx = header.indexOf(",");
  const objectType = (commaIdx !== -1 ? header.slice(0, commaIdx) : header).trim();
  const lBracket = header.indexOf("[");
  const rBracket = header.indexOf("]");
  const fields: string[] = [];
  if (lBracket !== -1 && rBracket !== -1 && rBracket > lBracket) {
    const rawFields = header.slice(lBracket + 1, rBracket);
    for (const f of rawFields.split(",")) {
      const clean = unquote(f.trim());
      if (clean) fields.push(clean);
    }
  }
  return { objectType, fields };
}

function parseDataRows(body: string, fields: string[], baseLine: number): AuxDataRow[] {
  const rows: AuxDataRow[] = [];
  const lines = body.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx]!;
    const stripped = rawLine
      .replace(/\/\/.*$/, "")
      .replace(/;$/, "")
      .trim();
    if (!stripped) continue;
    const values = splitTokens(stripped);
    if (values.length === 0) continue;
    const record: Record<string, string> = {};
    for (let f = 0; f < fields.length && f < values.length; f++) {
      record[fields[f]!] = values[f]!;
    }
    const lineNum = baseLine + idx;
    rows.push({
      values,
      record,
      span: {
        line: lineNum,
        column: 1,
        endLine: lineNum,
        endColumn: rawLine.length + 1,
        startOffset: 0,
        endOffset: 0,
      },
    });
  }
  return rows;
}

function parseScriptCommands(body: string, baseLine: number): AuxScriptCommand[] {
  const commands: AuxScriptCommand[] = [];
  const lines = body.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx]!;
    const stripped = rawLine
      .replace(/\/\/.*$/, "")
      .replace(/;$/, "")
      .trim();
    if (!stripped) continue;
    const match = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\(([^)]*)\))?$/.exec(stripped);
    if (!match) continue;
    const name = match[1]!;
    const args = match[2] ? splitTokens(match[2]) : [];
    const lineNum = baseLine + idx;
    commands.push({
      name,
      args,
      raw: stripped,
      span: {
        line: lineNum,
        column: 1,
        endLine: lineNum,
        endColumn: rawLine.length + 1,
        startOffset: 0,
        endOffset: 0,
      },
    });
  }
  return commands;
}

function getField(rec: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    if (rec[k] !== undefined) return rec[k];
    const lowerK = k.toLowerCase();
    for (const [rk, rv] of Object.entries(rec)) {
      if (rk.toLowerCase() === lowerK) return rv;
    }
  }
  return undefined;
}

/**
 * Parse a PowerWorld Auxiliary (.aux) file into a structured PowerWorldAuxModel.
 */
export function parsePowerWorldAux(source: string): PowerWorldAuxModel {
  const scanner = new AuxScanner(source);
  const dataSections: AuxDataSection[] = [];
  const scriptBlocks: AuxScriptBlock[] = [];

  while (!scanner.eof()) {
    scanner.skipWhitespaceAndComments();
    if (scanner.eof()) break;

    const startLine = scanner.currentLine;
    const startCol = scanner.currentColumn;
    const startOffset = scanner.offset;
    const kw = scanner.readIdentifier();
    if (!kw) {
      scanner.advance();
      continue;
    }

    const upper = kw.toUpperCase();
    if (upper === "DATA") {
      const header = scanner.readBalanced("(", ")");
      const { objectType, fields } = parseDataHeader(header.body);
      const bodyBlock = scanner.readBalanced("{", "}");
      const rows = parseDataRows(bodyBlock.body, fields, bodyBlock.startLine);
      dataSections.push({
        objectType,
        fields,
        rows,
        span: scanner.makeSpan(startLine, startCol, startOffset),
      });
      continue;
    }

    if (upper === "SCRIPT") {
      scanner.skipWhitespaceAndComments();
      if (scanner.peek() !== "{") {
        scanner.readIdentifier();
      }
      const bodyBlock = scanner.readBalanced("{", "}");
      scriptBlocks.push({
        commands: parseScriptCommands(bodyBlock.body, bodyBlock.startLine),
        rawBody: bodyBlock.body.trim(),
        span: scanner.makeSpan(startLine, startCol, startOffset),
      });
      continue;
    }
  }

  const buses: AuxBus[] = [];
  const busByNum = new Map<number, AuxBus>();
  const generators: AuxGen[] = [];
  const loads: AuxLoad[] = [];
  const branches: AuxBranch[] = [];
  const shunts: AuxShunt[] = [];
  const contingencies: AuxContingency[] = [];

  for (const sec of dataSections) {
    const typeUpper = sec.objectType.toUpperCase();
    for (const row of sec.rows) {
      const rec = row.record;
      if (typeUpper === "BUS") {
        const busNum = toNum(getField(rec, "BusNum", "Number"));
        const bus: AuxBus = {
          busNum,
          busName: getField(rec, "BusName", "Name") ?? `Bus_${busNum}`,
          nomVoltKv: toNum(getField(rec, "BusNomVolt", "NomkV"), 138),
          puVolt: toNum(getField(rec, "BusPUVolt", "PUVolt"), 1.0),
          angleDeg: toNum(getField(rec, "BusAngle", "Angle"), 0.0),
          isSlack: isTruthyFlag(getField(rec, "BusSlack", "Slack")),
          areaName: getField(rec, "AreaName"),
          zoneName: getField(rec, "ZoneName"),
          span: row.span,
        };
        buses.push(bus);
        if (!busByNum.has(busNum)) busByNum.set(busNum, bus);
      } else if (typeUpper === "GEN") {
        const mwMaxRaw = getField(rec, "GenMWMax", "MaxMW");
        const mwMinRaw = getField(rec, "GenMWMin", "MinMW");
        const vSetRaw = getField(rec, "GenVoltSet", "VoltSet");
        generators.push({
          busNum: toNum(getField(rec, "BusNum")),
          genId: getField(rec, "GenID", "ID") ?? "1",
          status: isStatusOpen(getField(rec, "GenStatus", "Status")) ? "Open" : "Closed",
          mw: toNum(getField(rec, "GenMW", "MW")),
          mvar: toNum(getField(rec, "GenMVR", "GenMVAR", "MVAR")),
          mwMax: mwMaxRaw !== undefined ? toNum(mwMaxRaw) : undefined,
          mwMin: mwMinRaw !== undefined ? toNum(mwMinRaw) : undefined,
          voltSetPu: vSetRaw !== undefined ? toNum(vSetRaw, 1.0) : undefined,
          span: row.span,
        });
      } else if (typeUpper === "LOAD") {
        loads.push({
          busNum: toNum(getField(rec, "BusNum")),
          loadId: getField(rec, "LoadID", "ID") ?? "1",
          status: isStatusOpen(getField(rec, "LoadStatus", "Status")) ? "Open" : "Closed",
          mw: toNum(getField(rec, "LoadMW", "MW")),
          mvar: toNum(getField(rec, "LoadMVR", "LoadMVAR", "MVAR")),
          span: row.span,
        });
      } else if (typeUpper === "BRANCH") {
        branches.push({
          fromBus: toNum(getField(rec, "BusNumFrom", "FromBus")),
          toBus: toNum(getField(rec, "BusNumTo", "ToBus")),
          circuit: getField(rec, "LineCircuit", "Circuit") ?? "1",
          status: isStatusOpen(getField(rec, "LineStatus", "Status")) ? "Open" : "Closed",
          rPu: toNum(getField(rec, "LineR", "R")),
          xPu: toNum(getField(rec, "LineX", "X"), 0.01),
          bPu: toNum(getField(rec, "LineC", "LineB", "B")),
          rateAMva: toNum(getField(rec, "LineAMVA", "RateA"), 100),
          tapRatio: toNum(getField(rec, "LineTap", "Tap"), 1.0),
          phaseShiftDeg: toNum(getField(rec, "LinePhase", "Phase"), 0.0),
          isTransformer: isTruthyFlag(getField(rec, "LineXfmr", "Xfmr")),
          span: row.span,
        });
      } else if (typeUpper === "SHUNT") {
        shunts.push({
          busNum: toNum(getField(rec, "BusNum")),
          shuntId: getField(rec, "ShuntID", "ID") ?? "1",
          status: isStatusOpen(getField(rec, "ShuntStatus", "Status")) ? "Open" : "Closed",
          mw: toNum(getField(rec, "ShuntMW", "MW")),
          mvar: toNum(getField(rec, "ShuntMVR", "ShuntMVAR", "MVAR")),
          span: row.span,
        });
      } else if (typeUpper === "CONTINGENCY" || typeUpper === "CTG") {
        contingencies.push({
          name: getField(rec, "CTGName", "Name") ?? "CTG",
          skip: isTruthyFlag(getField(rec, "CTGSkip", "Skip")),
          span: row.span,
        });
      }
    }
  }

  return {
    dataSections,
    scriptBlocks,
    buses,
    busByNum,
    generators,
    loads,
    branches,
    shunts,
    contingencies,
  };
}

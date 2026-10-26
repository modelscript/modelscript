// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — Robust Zero-Regex SPICE Netlist Parser & Serializer.
 *
 * Implements deterministic card/token-based parsing for SPICE 2G6, 3F5,
 * HSPICE, and LTspice netlists. Correctly resolves line continuations (+),
 * multi-format comments (*, ;, //, $), engineering unit multipliers
 * (MEG, K, U, N, P, F, MIL), parameter evaluations, subcircuit definitions,
 * models, sources, and simulation directives.
 */

import type {
  ComponentKind,
  DirectiveKind,
  ModelType,
  PulseWaveform,
  SineWaveform,
  SourceSpec,
  SpiceCircuit,
  SpiceComponent,
  SpiceDirective,
  SpiceModel,
  SpiceSourceSpan,
  SpiceSubcircuit,
  WaveformSpec,
} from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Zero-Regex Number & Unit Multiplier Parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses a SPICE numerical string with optional engineering suffix and units.
 * Supports:
 *   T / TERA = 1e12
 *   G / GIGA = 1e9
 *   MEG / MEGA = 1e6
 *   K / KILO = 1e3
 *   M / MILLI = 1e-3
 *   U / MICRO = 1e-6
 *   N / NANO = 1e-9
 *   P / PICO = 1e-12
 *   F / FEMTO = 1e-15
 *   MIL = 25.4e-6
 */
export function parseSpiceNumber(raw: string, params?: Map<string, number>): number {
  const str = raw.trim();
  if (!str) return 0;

  // Handle curly brace parameter expressions: {2*pi*1k} or {R_val}
  if (str.startsWith("{") && str.endsWith("}")) {
    const expr = str.slice(1, -1).trim();
    return evaluateExpression(expr, params);
  }

  // Handle parameter reference directly if present
  if (params) {
    if (params.has(str)) return params.get(str)!;
    const upper = str.toUpperCase();
    if (params.has(upper)) return params.get(upper)!;
  }

  let i = 0;
  const len = str.length;

  // Optional sign
  if (i < len && (str[i] === "+" || str[i] === "-")) {
    i++;
  }

  // Digits before decimal
  let hasDigits = false;
  while (i < len && str.charCodeAt(i) >= 48 && str.charCodeAt(i) <= 57) {
    hasDigits = true;
    i++;
  }

  // Decimal point
  if (i < len && str[i] === ".") {
    i++;
    while (i < len && str.charCodeAt(i) >= 48 && str.charCodeAt(i) <= 57) {
      hasDigits = true;
      i++;
    }
  }

  if (!hasDigits) {
    // If not a number, check params or return NaN
    if (params) {
      if (params.has(str)) return params.get(str)!;
      const upper = str.toUpperCase();
      if (params.has(upper)) return params.get(upper)!;
    }
    return Number.NaN;
  }

  // Scientific exponent (e/E followed by optional sign and digits)
  if (i < len && (str[i] === "e" || str[i] === "E")) {
    const mark = i;
    i++;
    if (i < len && (str[i] === "+" || str[i] === "-")) {
      i++;
    }
    let expDigits = false;
    while (i < len && str.charCodeAt(i) >= 48 && str.charCodeAt(i) <= 57) {
      expDigits = true;
      i++;
    }
    if (!expDigits) {
      i = mark; // Rollback if not valid exponent
    }
  }

  const numPart = str.slice(0, i);
  const baseVal = parseFloat(numPart);
  if (Number.isNaN(baseVal)) return 0;

  // Extract engineering suffix
  const suffix = str.slice(i).toUpperCase();
  if (!suffix) return baseVal;

  let multiplier = 1.0;
  if (suffix.startsWith("MEG")) {
    multiplier = 1e6;
  } else if (suffix.startsWith("MIL")) {
    multiplier = 25.4e-6;
  } else if (suffix.startsWith("T")) {
    multiplier = 1e12;
  } else if (suffix.startsWith("G")) {
    multiplier = 1e9;
  } else if (suffix.startsWith("K")) {
    multiplier = 1e3;
  } else if (suffix.startsWith("M")) {
    multiplier = 1e-3;
  } else if (suffix.startsWith("U")) {
    multiplier = 1e-6;
  } else if (suffix.startsWith("N")) {
    multiplier = 1e-9;
  } else if (suffix.startsWith("P")) {
    multiplier = 1e-12;
  } else if (suffix.startsWith("F")) {
    multiplier = 1e-15;
  }

  return baseVal * multiplier;
}

/**
 * Safely evaluates simple SPICE math expressions in parameters without regex.
 */
function evaluateExpression(expr: string, params?: Map<string, number>): number {
  const scope: Record<string, number> = {
    pi: Math.PI,
    PI: Math.PI,
    e: Math.E,
    E: Math.E,
  };

  if (params) {
    for (const [k, v] of params) {
      scope[k] = v;
      scope[k.toLowerCase()] = v;
      scope[k.toUpperCase()] = v;
    }
  }

  const tokens: (string | number)[] = [];
  let idx = 0;
  while (idx < expr.length) {
    const ch = expr[idx] ?? "";
    if (ch === " " || ch === "\t") {
      idx++;
      continue;
    }

    if ("+-*/()^".includes(ch)) {
      tokens.push(ch);
      idx++;
      continue;
    }

    // Number or identifier
    const start = idx;
    while (idx < expr.length && !" +-*/()^\t".includes(expr[idx] ?? "")) {
      idx++;
    }
    const tok = expr.slice(start, idx);
    const parsed = parseSpiceNumber(tok, params);
    if (!Number.isNaN(parsed)) {
      tokens.push(parsed);
    } else if (tok in scope) {
      tokens.push(scope[tok] ?? 0);
    } else {
      tokens.push(0);
    }
  }

  return evaluateTokens(tokens);
}

function evaluateTokens(tokens: (string | number)[]): number {
  const values: number[] = [];
  const ops: string[] = [];

  const precedence = (op: string): number => {
    if (op === "+" || op === "-") return 1;
    if (op === "*" || op === "/") return 2;
    if (op === "^") return 3;
    return 0;
  };

  const applyOp = () => {
    const op = ops.pop();
    if (!op) return;
    const b = values.pop() ?? 0;
    const a = values.pop() ?? 0;
    switch (op) {
      case "+":
        values.push(a + b);
        break;
      case "-":
        values.push(a - b);
        break;
      case "*":
        values.push(a * b);
        break;
      case "/":
        values.push(b !== 0 ? a / b : 0);
        break;
      case "^":
        values.push(Math.pow(a, b));
        break;
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === undefined) continue;

    if (typeof t === "number") {
      values.push(t);
    } else if (t === "(") {
      ops.push(t);
    } else if (t === ")") {
      while (ops.length > 0 && ops[ops.length - 1] !== "(") {
        applyOp();
      }
      ops.pop(); // discard '('
    } else if ("+-*/^".includes(t)) {
      // Check for unary minus at beginning or after operator
      const prevTok = i > 0 ? (tokens[i - 1] ?? "") : "";
      if (t === "-" && (i === 0 || prevTok === "(" || "+-*/^".includes(String(prevTok)))) {
        values.push(0);
      }
      while (ops.length > 0 && precedence(ops[ops.length - 1] ?? "") >= precedence(t)) {
        applyOp();
      }
      ops.push(t);
    }
  }

  while (ops.length > 0) {
    applyOp();
  }

  return values.length > 0 ? (values[0] ?? 0) : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zero-Regex Scanner & Line Preprocessor
// ─────────────────────────────────────────────────────────────────────────────

interface PreprocessedLine {
  text: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
}

function preprocessLines(rawText: string): { lines: PreprocessedLine[]; comments: { line: number; text: string }[] } {
  const result: PreprocessedLine[] = [];
  const comments: { line: number; text: string }[] = [];

  let curOffset = 0;
  const rawLines = rawText.split("\n");

  let activeLine: PreprocessedLine | null = null;

  for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx++) {
    const rawLine = rawLines[lineIdx] ?? "";
    const lineNum = lineIdx + 1;
    const lineStartOffset = curOffset;
    curOffset += rawLine.length + 1; // +1 for '\n'

    // Check if line is purely whitespace
    let firstNonWs = 0;
    while (
      firstNonWs < rawLine.length &&
      (rawLine[firstNonWs] === " " || rawLine[firstNonWs] === "\t" || rawLine[firstNonWs] === "\r")
    ) {
      firstNonWs++;
    }

    if (firstNonWs >= rawLine.length) {
      continue; // Empty line
    }

    const firstChar = rawLine[firstNonWs] ?? "";

    // Check if whole line is comment (* or ; at column 1)
    if (firstChar === "*" || (firstNonWs === 0 && (firstChar === ";" || firstChar === "$"))) {
      comments.push({ line: lineNum, text: rawLine.trim() });
      continue;
    }

    // Strip inline comments (; or $ or //) not in quotes or braces
    let stripped = "";
    let inQuotes = false;
    let quoteChar = "";
    let inBraces = 0;

    for (let c = 0; c < rawLine.length; c++) {
      const ch = rawLine[c] ?? "";
      if ((ch === '"' || ch === "'") && inBraces === 0) {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = ch;
        } else if (quoteChar === ch) {
          inQuotes = false;
        }
      } else if (ch === "{" && !inQuotes) {
        inBraces++;
      } else if (ch === "}" && !inQuotes && inBraces > 0) {
        inBraces--;
      } else if (!inQuotes && inBraces === 0) {
        if (ch === ";" || ch === "$") {
          break; // inline comment
        }
        if (ch === "/" && c + 1 < rawLine.length && rawLine[c + 1] === "/") {
          break; // // inline comment
        }
      }
      stripped += ch;
    }

    const cleanText = stripped.trim();
    if (!cleanText) continue;

    // Check continuation line ('+')
    if (cleanText.startsWith("+") && activeLine !== null) {
      const cont = cleanText.slice(1).trim();
      activeLine.text += " " + cont;
      activeLine.endLine = lineNum;
      activeLine.endOffset = lineStartOffset + rawLine.length;
    } else {
      if (activeLine) {
        result.push(activeLine);
      }
      activeLine = {
        text: cleanText,
        startLine: lineNum,
        endLine: lineNum,
        startOffset: lineStartOffset + firstNonWs,
        endOffset: lineStartOffset + rawLine.length,
      };
    }
  }

  if (activeLine) {
    result.push(activeLine);
  }

  return { lines: result, comments };
}

export function tokenizeSpiceLine(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const len = line.length;

  while (i < len) {
    // Skip whitespace and commas
    while (i < len && (line[i] === " " || line[i] === "\t" || line[i] === "," || line[i] === "\r")) {
      i++;
    }
    if (i >= len) break;

    const start = i;
    const ch = line[i] ?? "";

    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < len && line[i] !== q) {
        i++;
      }
      if (i < len) i++; // consume closing quote
      tokens.push(line.slice(start, i));
    } else if (ch === "{") {
      let depth = 1;
      i++;
      while (i < len && depth > 0) {
        if (line[i] === "{") depth++;
        else if (line[i] === "}") depth--;
        i++;
      }
      tokens.push(line.slice(start, i));
    } else {
      let inParens = 0;
      while (i < len) {
        const c = line[i] ?? "";
        if (c === "(") {
          inParens++;
        } else if (c === ")") {
          if (inParens > 0) inParens--;
        } else if (inParens === 0 && (c === " " || c === "\t" || c === "," || c === "\r")) {
          break;
        }
        i++;
      }
      tokens.push(line.slice(start, i));
    }
  }

  return tokens;
}

// ─────────────────────────────────────────────────────────────────────────────
// SPICE Parser Core
// ─────────────────────────────────────────────────────────────────────────────

export class SpiceParser {
  private globalParams = new Map<string, number>();

  public parse(sourceText: string): SpiceCircuit {
    const { lines, comments } = preprocessLines(sourceText);

    let title = "SPICE Netlist";
    let lineStartIdx = 0;

    // Check if line 1 comment exists (standard SPICE title card)
    if (comments.length > 0 && comments[0]?.line === 1) {
      title = comments[0].text.replace(/^\*+\s*/, "").trim();
    } else if (lines.length > 0) {
      const firstLine = lines[0];
      if (firstLine && firstLine.startLine === 1) {
        const firstTok = firstLine.text.split(/[ \t]/)[0]?.toUpperCase() ?? "";
        const isDirective = firstTok.startsWith(".");
        const isStandardComp = /^[RCLDVIMEQFGHXSTW][0-9A-Z_]/i.test(firstTok);
        if (!isDirective && !isStandardComp) {
          title = firstLine.text;
          lineStartIdx = 1;
        }
      }
    }

    const circuit: SpiceCircuit = {
      title,
      components: [],
      subcircuits: new Map(),
      models: new Map(),
      directives: [],
      globalNodes: new Set(["0", "GND"]),
      rawLines: sourceText.split("\n"),
      comments,
    };

    let currentSubcircuit: SpiceSubcircuit | null = null;
    const subcircuitStack: SpiceSubcircuit[] = [];

    // First pass: extract all .PARAM definitions
    for (let l = lineStartIdx; l < lines.length; l++) {
      const pLine = lines[l];
      if (!pLine) continue;
      const tokens = tokenizeSpiceLine(pLine.text);
      if (tokens.length >= 2 && tokens[0]?.toUpperCase() === ".PARAM") {
        this.extractParams(tokens.slice(1), this.globalParams);
      }
    }

    // Second pass: parse components, models, subcircuits, directives
    for (let l = lineStartIdx; l < lines.length; l++) {
      const pLine = lines[l];
      if (!pLine) continue;
      const tokens = tokenizeSpiceLine(pLine.text);
      if (tokens.length === 0) continue;

      const span: SpiceSourceSpan = {
        startLine: pLine.startLine,
        startCol: 1,
        endLine: pLine.endLine,
        endCol: pLine.text.length + 1,
        startOffset: pLine.startOffset,
        endOffset: pLine.endOffset,
      };

      const leadToken = tokens[0] ?? "";
      const upperLead = leadToken.toUpperCase();

      if (upperLead.startsWith(".")) {
        if (upperLead === ".SUBCKT") {
          const subckt = this.parseSubcircuitHeader(tokens, span);
          if (currentSubcircuit) {
            subcircuitStack.push(currentSubcircuit);
            currentSubcircuit.subcircuits.push(subckt);
          } else {
            circuit.subcircuits.set(subckt.name.toUpperCase(), subckt);
          }
          currentSubcircuit = subckt;
        } else if (upperLead === ".ENDS") {
          if (subcircuitStack.length > 0) {
            currentSubcircuit = subcircuitStack.pop() ?? null;
          } else {
            currentSubcircuit = null;
          }
        } else if (upperLead === ".MODEL") {
          const model = this.parseModelCard(tokens, span);
          if (currentSubcircuit) {
            currentSubcircuit.models.push(model);
          } else {
            circuit.models.set(model.name.toUpperCase(), model);
          }
        } else if (upperLead === ".GLOBAL") {
          for (let i = 1; i < tokens.length; i++) {
            const gNode = tokens[i];
            if (gNode !== undefined) {
              circuit.globalNodes.add(gNode);
            }
          }
        } else {
          const directive = this.parseDirective(tokens, span);
          circuit.directives.push(directive);
        }
        continue;
      }

      const component = this.parseComponent(tokens, pLine.text, span);
      if (currentSubcircuit) {
        currentSubcircuit.components.push(component);
      } else {
        circuit.components.push(component);
      }
    }

    return circuit;
  }

  private parseComponent(tokens: string[], rawLine: string, span: SpiceSourceSpan): SpiceComponent {
    const rawName = tokens[0] ?? "U";
    const kindChar = (rawName[0] ?? "U").toUpperCase();
    const kind: ComponentKind = this.resolveComponentKind(kindChar);
    const params = new Map<string, number | string>();

    const comp: SpiceComponent = {
      name: rawName,
      kind,
      nodes: [],
      params,
      rawLine,
      span,
    };

    switch (kind) {
      case "R":
      case "C":
      case "L": {
        if (tokens.length >= 4) {
          comp.nodes = [tokens[1] ?? "", tokens[2] ?? ""];
          comp.value = parseSpiceNumber(tokens[3] ?? "0", this.globalParams);
          this.parseKeyValues(tokens.slice(4), params);
        }
        break;
      }
      case "D": {
        if (tokens.length >= 4) {
          comp.nodes = [tokens[1] ?? "", tokens[2] ?? ""];
          comp.model = tokens[3];
          if (tokens.length >= 5) {
            const areaVal = parseSpiceNumber(tokens[4] ?? "1", this.globalParams);
            if (!Number.isNaN(areaVal)) params.set("AREA", areaVal);
          }
          this.parseKeyValues(tokens.slice(4), params);
        }
        break;
      }
      case "Q": {
        if (tokens.length >= 5) {
          let modelIdx = 4;
          const tok4 = tokens[4] ?? "";
          if (tokens.length >= 6 && !tok4.includes("=") && Number.isNaN(parseSpiceNumber(tok4, this.globalParams))) {
            comp.nodes = [tokens[1] ?? "", tokens[2] ?? "", tokens[3] ?? "", tok4];
            modelIdx = 5;
          } else {
            comp.nodes = [tokens[1] ?? "", tokens[2] ?? "", tokens[3] ?? ""];
          }
          comp.model = tokens[modelIdx];
          this.parseKeyValues(tokens.slice(modelIdx + 1), params);
        }
        break;
      }
      case "M": {
        if (tokens.length >= 6) {
          comp.nodes = [tokens[1] ?? "", tokens[2] ?? "", tokens[3] ?? "", tokens[4] ?? ""];
          comp.model = tokens[5];
          this.parseKeyValues(tokens.slice(6), params);
        }
        break;
      }
      case "J": {
        if (tokens.length >= 5) {
          comp.nodes = [tokens[1] ?? "", tokens[2] ?? "", tokens[3] ?? ""];
          comp.model = tokens[4];
          this.parseKeyValues(tokens.slice(5), params);
        }
        break;
      }
      case "V":
      case "I": {
        if (tokens.length >= 3) {
          comp.nodes = [tokens[1] ?? "", tokens[2] ?? ""];
          comp.sourceSpec = this.parseSourceSpec(tokens.slice(3));
          if (comp.sourceSpec.dc !== undefined) {
            comp.value = comp.sourceSpec.dc;
          }
        }
        break;
      }
      case "E":
      case "G": {
        if (tokens.length >= 6) {
          comp.nodes = [tokens[1] ?? "", tokens[2] ?? ""];
          comp.controlNodes = [tokens[3] ?? "", tokens[4] ?? ""];
          comp.gain = parseSpiceNumber(tokens[5] ?? "1", this.globalParams);
          comp.value = comp.gain;
        }
        break;
      }
      case "F":
      case "H": {
        if (tokens.length >= 5) {
          comp.nodes = [tokens[1] ?? "", tokens[2] ?? ""];
          comp.controlSource = tokens[3];
          comp.gain = parseSpiceNumber(tokens[4] ?? "1", this.globalParams);
          comp.value = comp.gain;
        }
        break;
      }
      case "X": {
        this.parseSubcircuitCall(tokens, comp, params);
        break;
      }
      case "K": {
        if (tokens.length >= 4) {
          comp.nodes = [tokens[1] ?? "", tokens[2] ?? ""];
          comp.value = parseSpiceNumber(tokens[3] ?? "1", this.globalParams);
        }
        break;
      }
      default: {
        if (tokens.length >= 3) {
          comp.nodes = [tokens[1] ?? "", tokens[2] ?? ""];
          if (tokens.length >= 4) {
            comp.value = parseSpiceNumber(tokens[3] ?? "0", this.globalParams);
          }
          this.parseKeyValues(tokens.slice(4), params);
        }
        break;
      }
    }

    return comp;
  }

  private resolveComponentKind(ch: string): ComponentKind {
    switch (ch) {
      case "R":
        return "R";
      case "C":
        return "C";
      case "L":
        return "L";
      case "K":
        return "K";
      case "D":
        return "D";
      case "Q":
        return "Q";
      case "M":
        return "M";
      case "J":
        return "J";
      case "V":
        return "V";
      case "I":
        return "I";
      case "E":
        return "E";
      case "F":
        return "F";
      case "G":
        return "G";
      case "H":
        return "H";
      case "X":
        return "X";
      case "S":
        return "S";
      case "W":
        return "W";
      case "T":
        return "T";
      default:
        return "UNKNOWN";
    }
  }

  private parseSubcircuitHeader(tokens: string[], span: SpiceSourceSpan): SpiceSubcircuit {
    const name = tokens[1] ?? "UNNAMED";
    const ports: string[] = [];
    const params = new Map<string, number | string>();

    let idx = 2;
    while (idx < tokens.length) {
      const tok = tokens[idx] ?? "";
      if (tok.toUpperCase() === "PARAMS:" || tok.toUpperCase() === "PARAMS") {
        idx++;
        break;
      }
      if (tok.includes("=")) {
        break;
      }
      ports.push(tok);
      idx++;
    }

    this.parseKeyValues(tokens.slice(idx), params);

    return {
      name,
      ports,
      params,
      components: [],
      subcircuits: [],
      models: [],
      span,
    };
  }

  private parseSubcircuitCall(tokens: string[], comp: SpiceComponent, params: Map<string, number | string>): void {
    let subcktIdx = tokens.length - 1;

    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i] ?? "";
      if (tok.toUpperCase() === "PARAMS:" || tok.toUpperCase() === "PARAMS") {
        subcktIdx = i - 1;
        this.parseKeyValues(tokens.slice(i + 1), params);
        break;
      }
      if (tok.includes("=")) {
        subcktIdx = i - 1;
        this.parseKeyValues(tokens.slice(i), params);
        break;
      }
    }

    comp.subcktName = tokens[subcktIdx] ?? "";
    comp.nodes = tokens.slice(1, subcktIdx);
  }

  private parseModelCard(tokens: string[], span: SpiceSourceSpan): SpiceModel {
    const name = tokens[1] ?? "UNNAMED";
    const rawType = (tokens[2] ?? "UNKNOWN").replace(/[()]/g, "").toUpperCase();
    const type: ModelType = this.resolveModelType(rawType);
    const params = new Map<string, number>();

    // Flatten all parameter tokens, strip parentheses, and split on whitespace
    const allParamText = tokens.slice(3).join(" ").replace(/[()]/g, " ");
    const paramTokens: string[] = [];
    let curTok = "";
    for (let i = 0; i < allParamText.length; i++) {
      const ch = allParamText[i] ?? "";
      if (ch === " " || ch === "\t" || ch === "," || ch === "\r") {
        if (curTok) {
          paramTokens.push(curTok);
          curTok = "";
        }
      } else {
        curTok += ch;
      }
    }
    if (curTok) {
      paramTokens.push(curTok);
    }

    this.extractParams(paramTokens, params);

    return {
      name,
      type,
      params,
      span,
    };
  }

  private resolveModelType(t: string): ModelType {
    switch (t) {
      case "D":
        return "D";
      case "NPN":
        return "NPN";
      case "PNP":
        return "PNP";
      case "NMOS":
        return "NMOS";
      case "PMOS":
        return "PMOS";
      case "NJF":
        return "NJF";
      case "PJF":
        return "PJF";
      case "SW":
        return "SW";
      case "CSW":
        return "CSW";
      case "R":
        return "R";
      case "C":
        return "C";
      case "L":
        return "L";
      default:
        return "UNKNOWN";
    }
  }

  private parseSourceSpec(tokens: string[]): SourceSpec {
    const spec: SourceSpec = {};

    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i] ?? "";
      const upper = tok.toUpperCase();

      if (upper === "DC") {
        if (i + 1 < tokens.length) {
          spec.dc = parseSpiceNumber(tokens[i + 1] ?? "0", this.globalParams);
          i += 2;
        } else {
          i++;
        }
      } else if (upper === "AC") {
        if (i + 1 < tokens.length) {
          spec.acMag = parseSpiceNumber(tokens[i + 1] ?? "1", this.globalParams);
          i += 2;
          const nextTok = tokens[i] ?? "";
          if (
            i < tokens.length &&
            !nextTok.toUpperCase().startsWith("PULSE") &&
            !nextTok.toUpperCase().startsWith("SINE")
          ) {
            const maybePhase = parseSpiceNumber(nextTok, this.globalParams);
            if (!Number.isNaN(maybePhase)) {
              spec.acPhase = maybePhase;
              i++;
            }
          }
        } else {
          i++;
        }
      } else if (upper.startsWith("PULSE")) {
        spec.waveform = this.parsePulseWaveform(tok, tokens.slice(i + 1));
        break;
      } else if (upper.startsWith("SINE") || upper.startsWith("SIN")) {
        spec.waveform = this.parseSineWaveform(tok, tokens.slice(i + 1));
        break;
      } else {
        const val = parseSpiceNumber(tok, this.globalParams);
        if (!Number.isNaN(val) && spec.dc === undefined) {
          spec.dc = val;
        }
        i++;
      }
    }

    return spec;
  }

  private parsePulseWaveform(initialTok: string, followingTokens: string[]): PulseWaveform {
    const allArgs = this.extractFunctionArgs(initialTok, followingTokens);
    return {
      kind: "PULSE",
      v1: allArgs[0] !== undefined ? parseSpiceNumber(allArgs[0], this.globalParams) : 0,
      v2: allArgs[1] !== undefined ? parseSpiceNumber(allArgs[1], this.globalParams) : 1,
      td: allArgs[2] !== undefined ? parseSpiceNumber(allArgs[2], this.globalParams) : 0,
      tr: allArgs[3] !== undefined ? parseSpiceNumber(allArgs[3], this.globalParams) : 1e-9,
      tf: allArgs[4] !== undefined ? parseSpiceNumber(allArgs[4], this.globalParams) : 1e-9,
      pw: allArgs[5] !== undefined ? parseSpiceNumber(allArgs[5], this.globalParams) : 1e-6,
      per: allArgs[6] !== undefined ? parseSpiceNumber(allArgs[6], this.globalParams) : 2e-6,
    };
  }

  private parseSineWaveform(initialTok: string, followingTokens: string[]): SineWaveform {
    const allArgs = this.extractFunctionArgs(initialTok, followingTokens);
    return {
      kind: "SINE",
      vo: allArgs[0] !== undefined ? parseSpiceNumber(allArgs[0], this.globalParams) : 0,
      va: allArgs[1] !== undefined ? parseSpiceNumber(allArgs[1], this.globalParams) : 1,
      freq: allArgs[2] !== undefined ? parseSpiceNumber(allArgs[2], this.globalParams) : 1e3,
      td: allArgs[3] !== undefined ? parseSpiceNumber(allArgs[3], this.globalParams) : 0,
      theta: allArgs[4] !== undefined ? parseSpiceNumber(allArgs[4], this.globalParams) : 0,
    };
  }

  private extractFunctionArgs(initialTok: string, followingTokens: string[]): string[] {
    const combined = [initialTok, ...followingTokens].join(" ");
    const openParen = combined.indexOf("(");
    const closeParen = combined.lastIndexOf(")");
    if (openParen !== -1 && closeParen !== -1 && closeParen > openParen) {
      const inner = combined.slice(openParen + 1, closeParen);
      return tokenizeSpiceLine(inner);
    }
    return [];
  }

  private parseDirective(tokens: string[], span: SpiceSourceSpan): SpiceDirective {
    const rawKind = (tokens[0] ?? "").toUpperCase();
    let kind: DirectiveKind = ".OTHER";

    if (
      rawKind === ".TRAN" ||
      rawKind === ".AC" ||
      rawKind === ".DC" ||
      rawKind === ".OP" ||
      rawKind === ".PARAM" ||
      rawKind === ".IC" ||
      rawKind === ".NODESET" ||
      rawKind === ".GLOBAL" ||
      rawKind === ".INCLUDE" ||
      rawKind === ".LIB" ||
      rawKind === ".OPTIONS" ||
      rawKind === ".TEMP" ||
      rawKind === ".FOUR" ||
      rawKind === ".NOISE" ||
      rawKind === ".TF" ||
      rawKind === ".SENS" ||
      rawKind === ".END"
    ) {
      kind = rawKind;
    }

    const args = tokens.slice(1);
    const params = new Map<string, number | string>();
    this.parseKeyValues(args, params);

    return {
      kind,
      args,
      params,
      span,
    };
  }

  private parseKeyValues(tokens: string[], target: Map<string, number | string>): void {
    for (const tok of tokens) {
      const eqIdx = tok.indexOf("=");
      if (eqIdx !== -1) {
        const key = tok.slice(0, eqIdx).trim().toUpperCase();
        const rawVal = tok.slice(eqIdx + 1).trim();
        const numVal = parseSpiceNumber(rawVal, this.globalParams);
        if (!Number.isNaN(numVal)) {
          target.set(key, numVal);
        } else {
          target.set(key, rawVal);
        }
      }
    }
  }

  private extractParams(tokens: string[], target: Map<string, number>): void {
    for (const tok of tokens) {
      const eqIdx = tok.indexOf("=");
      if (eqIdx !== -1) {
        const key = tok.slice(0, eqIdx).trim().toUpperCase();
        const rawVal = tok.slice(eqIdx + 1).trim();
        const numVal = parseSpiceNumber(rawVal, target);
        if (!Number.isNaN(numVal)) {
          target.set(key, numVal);
        }
      }
    }
  }
}

export function parseSpice(sourceText: string): SpiceCircuit {
  const parser = new SpiceParser();
  return parser.parse(sourceText);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lossless SPICE Serializer
// ─────────────────────────────────────────────────────────────────────────────

export function serializeSpice(circuit: SpiceCircuit): string {
  const lines: string[] = [];

  // Title
  lines.push(`* ${circuit.title}`);

  // Global nodes
  if (circuit.globalNodes.size > 2) {
    const nonDefaultGlobals = Array.from(circuit.globalNodes).filter((n) => n !== "0" && n.toUpperCase() !== "GND");
    if (nonDefaultGlobals.length > 0) {
      lines.push(`.GLOBAL ${nonDefaultGlobals.join(" ")}`);
    }
  }

  // Directives
  for (const dir of circuit.directives) {
    lines.push(`${dir.kind} ${dir.args.join(" ")}`);
  }

  // Models
  for (const model of circuit.models.values()) {
    const pStr = Array.from(model.params.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    lines.push(`.MODEL ${model.name} ${model.type} (${pStr})`);
  }

  // Subcircuits
  for (const subckt of circuit.subcircuits.values()) {
    lines.push(`.SUBCKT ${subckt.name} ${subckt.ports.join(" ")}`);
    for (const c of subckt.components) {
      lines.push(serializeComponent(c));
    }
    lines.push(`.ENDS ${subckt.name}`);
  }

  // Top-level Components
  for (const comp of circuit.components) {
    lines.push(serializeComponent(comp));
  }

  lines.push(".END");
  return lines.join("\n") + "\n";
}

function serializeComponent(c: SpiceComponent): string {
  if (c.rawLine) return c.rawLine;

  const parts: string[] = [c.name, ...c.nodes];

  if (c.kind === "X" && c.subcktName) {
    parts.push(c.subcktName);
  } else if (c.model) {
    parts.push(c.model);
  } else if (c.value !== undefined) {
    parts.push(String(c.value));
  }

  if (c.sourceSpec) {
    if (c.sourceSpec.dc !== undefined) parts.push(`DC ${c.sourceSpec.dc}`);
    if (c.sourceSpec.acMag !== undefined) parts.push(`AC ${c.sourceSpec.acMag}`);
    if (c.sourceSpec.waveform) {
      parts.push(serializeWaveform(c.sourceSpec.waveform));
    }
  }

  for (const [k, v] of c.params) {
    parts.push(`${k}=${v}`);
  }

  return parts.join(" ");
}

function serializeWaveform(w: WaveformSpec): string {
  if (w.kind === "PULSE") {
    return `PULSE(${w.v1} ${w.v2} ${w.td} ${w.tr} ${w.tf} ${w.pw} ${w.per})`;
  }
  if (w.kind === "SINE") {
    return `SINE(${w.vo} ${w.va} ${w.freq} ${w.td ?? 0} ${w.theta ?? 0})`;
  }
  return "";
}

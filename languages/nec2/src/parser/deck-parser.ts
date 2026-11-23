// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * LLNL NEC-2 Wire Antenna Deck Parser with 4NEC2 `SY` symbolic expression evaluator
 * and geometry expansion (`GA`, `GH`, `GM`, `GR`, `GS`).
 */

import type {
  Nec2Arc,
  Nec2CardRecord,
  Nec2Deck,
  Nec2Excitation,
  Nec2Execute,
  Nec2Frequency,
  Nec2Ground,
  Nec2Helix,
  Nec2Load,
  Nec2Network,
  Nec2ParseError,
  Nec2Patch,
  Nec2RadiationPattern,
  Nec2Scale,
  Nec2SourceSpan,
  Nec2SymbolDef,
  Nec2Symmetry,
  Nec2Transform,
  Nec2TransmissionLine,
  Nec2Wire,
} from "../types.js";

const DEG_TO_RAD = Math.PI / 180;

/**
 * Safe recursive-descent arithmetic expression evaluator for NEC-2 `SY` variables and card fields.
 */
export function evaluateNec2Expression(expr: string, symbols: Map<string, number>): number {
  const input = expr.trim();
  if (input.length === 0) return Number.NaN;

  // Fast path for plain numeric literal
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?$/.test(input)) {
    return Number(input.replace(/[dD]/, "e"));
  }

  let pos = 0;

  function skipWs(): void {
    while (pos < input.length && (input[pos] === " " || input[pos] === "\t")) pos++;
  }

  function parseAddSub(): number {
    let left = parseMulDiv();
    for (;;) {
      skipWs();
      if (pos < input.length && input[pos] === "+") {
        pos++;
        left += parseMulDiv();
      } else if (pos < input.length && input[pos] === "-") {
        pos++;
        left -= parseMulDiv();
      } else {
        break;
      }
    }
    return left;
  }

  function parseMulDiv(): number {
    let left = parsePow();
    for (;;) {
      skipWs();
      if (pos < input.length && input[pos] === "*") {
        pos++;
        left *= parsePow();
      } else if (pos < input.length && input[pos] === "/") {
        pos++;
        left /= parsePow();
      } else {
        break;
      }
    }
    return left;
  }

  function parsePow(): number {
    const base = parseUnary();
    skipWs();
    if (pos < input.length && input[pos] === "^") {
      pos++;
      return Math.pow(base, parsePow());
    }
    if (pos + 1 < input.length && input[pos] === "*" && input[pos + 1] === "*") {
      pos += 2;
      return Math.pow(base, parsePow());
    }
    return base;
  }

  function parseUnary(): number {
    skipWs();
    if (pos < input.length && input[pos] === "+") {
      pos++;
      return parseUnary();
    }
    if (pos < input.length && input[pos] === "-") {
      pos++;
      return -parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    skipWs();
    if (pos >= input.length) return Number.NaN;

    if (input[pos] === "(") {
      pos++;
      const val = parseAddSub();
      skipWs();
      if (pos < input.length && input[pos] === ")") pos++;
      return val;
    }

    // Number literal
    const numMatch = /^(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/.exec(input.slice(pos));
    if (numMatch) {
      pos += numMatch[0].length;
      return Number(numMatch[0].replace(/[dD]/, "e"));
    }

    // Identifier or function call
    const idMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(pos));
    if (idMatch) {
      const name = idMatch[0];
      pos += name.length;
      skipWs();
      if (pos < input.length && input[pos] === "(") {
        pos++;
        const arg = parseAddSub();
        skipWs();
        if (pos < input.length && input[pos] === ")") pos++;
        switch (name.toLowerCase()) {
          case "sin":
            return Math.sin(arg);
          case "cos":
            return Math.cos(arg);
          case "tan":
            return Math.tan(arg);
          case "asin":
            return Math.asin(arg);
          case "acos":
            return Math.acos(arg);
          case "atan":
            return Math.atan(arg);
          case "sqrt":
            return Math.sqrt(arg);
          case "abs":
            return Math.abs(arg);
          case "exp":
            return Math.exp(arg);
          case "log":
          case "ln":
            return Math.log(arg);
          case "log10":
            return Math.log10(arg);
          default:
            return Number.NaN;
        }
      }

      const lower = name.toLowerCase();
      if (symbols.has(lower)) return symbols.get(lower)!;
      if (symbols.has(name)) return symbols.get(name)!;
      if (lower === "pi") return Math.PI;
      if (lower === "c0" || lower === "c") return 299792458.0;
      return Number.NaN;
    }

    return Number.NaN;
  }

  const result = parseAddSub();
  skipWs();
  if (pos < input.length) return Number.NaN;
  return result;
}

/**
 * Splits a NEC-2 card argument string into fields, respecting commas, whitespace, and parentheses.
 */
function splitCardFields(rest: string): string[] {
  // Strip inline comment starting with ' or !
  let clean = rest;
  const quoteIdx = clean.indexOf("'");
  const bangIdx = clean.indexOf("!");
  const cut =
    quoteIdx >= 0 && bangIdx >= 0
      ? Math.min(quoteIdx, bangIdx)
      : quoteIdx >= 0
        ? quoteIdx
        : bangIdx >= 0
          ? bangIdx
          : -1;
  if (cut >= 0) clean = clean.slice(0, cut);

  const fields: string[] = [];
  let cur = "";
  let depth = 0;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (ch === "(") {
      depth++;
      cur += ch;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      cur += ch;
    } else if (depth === 0 && (ch === "," || ch === " " || ch === "\t")) {
      if (cur.length > 0) {
        fields.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) fields.push(cur);
  return fields;
}

function evalField(
  fields: string[],
  idx: number,
  symbols: Map<string, number>,
  defaultVal: number,
  required: boolean,
  errors: Nec2ParseError[],
  span: Nec2SourceSpan,
  raw: string,
  fieldLabel: string,
): number {
  const token = fields[idx];
  if (token === undefined || token === "") {
    if (required) {
      errors.push({
        ...span,
        message: `Missing required field '${fieldLabel}' at position ${idx + 1}`,
        raw,
      });
    }
    return defaultVal;
  }
  const val = evaluateNec2Expression(token, symbols);
  if (!Number.isFinite(val)) {
    errors.push({
      ...span,
      message: `Invalid numeric/symbolic value '${token}' for field '${fieldLabel}'`,
      raw,
    });
    return defaultVal;
  }
  return val;
}

const KNOWN_CARDS = new Set([
  "CM",
  "CE",
  "SY",
  "GW",
  "GA",
  "GH",
  "GM",
  "GR",
  "GS",
  "SP",
  "SM",
  "SC",
  "GC",
  "GE",
  "FR",
  "EX",
  "LD",
  "GN",
  "GD",
  "NT",
  "TL",
  "RP",
  "XQ",
  "EN",
  "PT",
  "PQ",
  "KH",
  "EK",
  "CP",
  "NH",
  "NE",
  "NX",
  "WG",
  "GF",
]);

/**
 * Parses a LLNL NEC-2 wire antenna deck string into a structured `Nec2Deck`.
 */
export function parseNec2Deck(source: string): Nec2Deck {
  const comments: string[] = [];
  const symbolDefs: Nec2SymbolDef[] = [];
  const symbols = new Map<string, number>();
  const wires: Nec2Wire[] = [];
  const arcs: Nec2Arc[] = [];
  const helices: Nec2Helix[] = [];
  const transforms: Nec2Transform[] = [];
  const symmetries: Nec2Symmetry[] = [];
  const scales: Nec2Scale[] = [];
  const patches: Nec2Patch[] = [];
  const frequencies: Nec2Frequency[] = [];
  const excitations: Nec2Excitation[] = [];
  const loads: Nec2Load[] = [];
  const grounds: Nec2Ground[] = [];
  const networks: Nec2Network[] = [];
  const transmissionLines: Nec2TransmissionLine[] = [];
  const radiationPatterns: Nec2RadiationPattern[] = [];
  const executes: Nec2Execute[] = [];
  const cards: Nec2CardRecord[] = [];
  const parseErrors: Nec2ParseError[] = [];

  let hasCommentEnd = false;
  let hasGeometryEnd = false;
  let hasEnd = false;
  let geometryEnd: Nec2Deck["geometryEnd"] = undefined;

  const lines = source.split(/\r?\n/);
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const lineNum = i + 1;
    const lineStart = offset;
    const lineEnd = offset + rawLine.length;
    offset = lineEnd + 1; // account for newline

    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;

    // Standalone comment lines starting with ' or !
    if (trimmed.startsWith("'") || trimmed.startsWith("!")) {
      comments.push(trimmed.slice(1).trim());
      continue;
    }

    const leadingWs = rawLine.length - rawLine.trimStart().length;
    const span: Nec2SourceSpan = {
      line: lineNum,
      column: leadingWs + 1,
      startOffset: lineStart + leadingWs,
      endOffset: lineEnd,
    };

    const match = /^([A-Za-z]{2})(?:\s+(.*)|,(.*)|$)/.exec(trimmed);
    if (!match) {
      parseErrors.push({
        ...span,
        message: `Unrecognized NEC-2 card syntax '${trimmed.slice(0, 24)}'`,
        raw: rawLine,
      });
      continue;
    }

    const mnemonic = match[1]!.toUpperCase();
    const rest = (match[2] ?? match[3] ?? "").trim();

    if (!KNOWN_CARDS.has(mnemonic)) {
      parseErrors.push({
        ...span,
        message: `Unknown NEC-2 card mnemonic '${mnemonic}'`,
        raw: rawLine,
      });
      continue;
    }

    cards.push({ ...span, mnemonic, raw: rawLine });

    switch (mnemonic) {
      case "CM": {
        comments.push(rest);
        break;
      }
      case "CE": {
        hasCommentEnd = true;
        if (rest.length > 0) comments.push(rest);
        break;
      }
      case "SY": {
        // SY cards may have comma-separated assignments: SY L=0.5, a=0.001
        const cleanRest = rest.replace(/['!].*$/, "");
        const assignments = cleanRest.split(",");
        for (const assign of assignments) {
          const eqIdx = assign.indexOf("=");
          if (eqIdx < 0) continue;
          const varName = assign.slice(0, eqIdx).trim();
          const expr = assign.slice(eqIdx + 1).trim();
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) {
            parseErrors.push({ ...span, message: `Invalid SY variable name '${varName}'`, raw: rawLine });
            continue;
          }
          const val = evaluateNec2Expression(expr, symbols);
          if (!Number.isFinite(val)) {
            parseErrors.push({ ...span, message: `Could not evaluate SY expression '${expr}'`, raw: rawLine });
            continue;
          }
          symbols.set(varName.toLowerCase(), val);
          symbolDefs.push({ ...span, name: varName, expression: expr, value: val });
        }
        break;
      }
      case "GW": {
        const f = splitCardFields(rest);
        const tag = Math.trunc(evalField(f, 0, symbols, 0, true, parseErrors, span, rawLine, "tag"));
        const segments = Math.trunc(evalField(f, 1, symbols, 1, true, parseErrors, span, rawLine, "segments"));
        const x1 = evalField(f, 2, symbols, 0, true, parseErrors, span, rawLine, "x1");
        const y1 = evalField(f, 3, symbols, 0, true, parseErrors, span, rawLine, "y1");
        const z1 = evalField(f, 4, symbols, 0, true, parseErrors, span, rawLine, "z1");
        const x2 = evalField(f, 5, symbols, 0, true, parseErrors, span, rawLine, "x2");
        const y2 = evalField(f, 6, symbols, 0, true, parseErrors, span, rawLine, "y2");
        const z2 = evalField(f, 7, symbols, 0, true, parseErrors, span, rawLine, "z2");
        const radius = evalField(f, 8, symbols, 0.001, true, parseErrors, span, rawLine, "radius");
        wires.push({ ...span, tag, segments, x1, y1, z1, x2, y2, z2, radius });
        break;
      }
      case "GA": {
        const f = splitCardFields(rest);
        const tag = Math.trunc(evalField(f, 0, symbols, 0, true, parseErrors, span, rawLine, "tag"));
        const segments = Math.trunc(evalField(f, 1, symbols, 1, true, parseErrors, span, rawLine, "segments"));
        const arcRadius = evalField(f, 2, symbols, 0.1, true, parseErrors, span, rawLine, "arcRadius");
        const angle1Deg = evalField(f, 3, symbols, 0, true, parseErrors, span, rawLine, "angle1");
        const angle2Deg = evalField(f, 4, symbols, 360, true, parseErrors, span, rawLine, "angle2");
        const wireRadius = evalField(f, 5, symbols, 0.001, true, parseErrors, span, rawLine, "wireRadius");
        arcs.push({ ...span, tag, segments, arcRadius, angle1Deg, angle2Deg, wireRadius });
        break;
      }
      case "GH": {
        const f = splitCardFields(rest);
        const tag = Math.trunc(evalField(f, 0, symbols, 0, true, parseErrors, span, rawLine, "tag"));
        const segments = Math.trunc(evalField(f, 1, symbols, 1, true, parseErrors, span, rawLine, "segments"));
        const spacing = evalField(f, 2, symbols, 0.05, true, parseErrors, span, rawLine, "spacing");
        const length = evalField(f, 3, symbols, 0.5, true, parseErrors, span, rawLine, "length");
        const rx1 = evalField(f, 4, symbols, 0.05, true, parseErrors, span, rawLine, "rx1");
        const ry1 = evalField(f, 5, symbols, rx1, false, parseErrors, span, rawLine, "ry1");
        const rx2 = evalField(f, 6, symbols, rx1, false, parseErrors, span, rawLine, "rx2");
        const ry2 = evalField(f, 7, symbols, ry1, false, parseErrors, span, rawLine, "ry2");
        const wireRadius = evalField(f, 8, symbols, 0.001, true, parseErrors, span, rawLine, "wireRadius");
        helices.push({ ...span, tag, segments, spacing, length, rx1, ry1, rx2, ry2, wireRadius });
        break;
      }
      case "GM": {
        const f = splitCardFields(rest);
        const tagIncrement = Math.trunc(evalField(f, 0, symbols, 0, false, parseErrors, span, rawLine, "tagInc"));
        const newStructures = Math.trunc(evalField(f, 1, symbols, 0, false, parseErrors, span, rawLine, "nrpt"));
        const roXDeg = evalField(f, 2, symbols, 0, false, parseErrors, span, rawLine, "roX");
        const roYDeg = evalField(f, 3, symbols, 0, false, parseErrors, span, rawLine, "roY");
        const roZDeg = evalField(f, 4, symbols, 0, false, parseErrors, span, rawLine, "roZ");
        const dx = evalField(f, 5, symbols, 0, false, parseErrors, span, rawLine, "dx");
        const dy = evalField(f, 6, symbols, 0, false, parseErrors, span, rawLine, "dy");
        const dz = evalField(f, 7, symbols, 0, false, parseErrors, span, rawLine, "dz");
        const startTag = Math.trunc(evalField(f, 8, symbols, 0, false, parseErrors, span, rawLine, "startTag"));
        transforms.push({ ...span, tagIncrement, newStructures, roXDeg, roYDeg, roZDeg, dx, dy, dz, startTag });
        break;
      }
      case "GR": {
        const f = splitCardFields(rest);
        const tagIncrement = Math.trunc(evalField(f, 0, symbols, 0, true, parseErrors, span, rawLine, "tagInc"));
        const copies = Math.trunc(evalField(f, 1, symbols, 1, true, parseErrors, span, rawLine, "copies"));
        symmetries.push({ ...span, tagIncrement, copies });
        break;
      }
      case "GS": {
        const f = splitCardFields(rest);
        // GS I1 I2 F1 (scale factor is usually 3rd field, or 1st if shorthand)
        const factor =
          f.length >= 3
            ? evalField(f, 2, symbols, 1, true, parseErrors, span, rawLine, "factor")
            : evalField(f, 0, symbols, 1, true, parseErrors, span, rawLine, "factor");
        scales.push({ ...span, factor });
        break;
      }
      case "SP": {
        const f = splitCardFields(rest);
        const ns = Math.trunc(evalField(f, 1, symbols, 0, false, parseErrors, span, rawLine, "ns"));
        const x1 = evalField(f, 2, symbols, 0, false, parseErrors, span, rawLine, "x1");
        const y1 = evalField(f, 3, symbols, 0, false, parseErrors, span, rawLine, "y1");
        const z1 = evalField(f, 4, symbols, 0, false, parseErrors, span, rawLine, "z1");
        const x2 = evalField(f, 5, symbols, 0, false, parseErrors, span, rawLine, "x2");
        const y2 = evalField(f, 6, symbols, 0, false, parseErrors, span, rawLine, "y2");
        const z2 = evalField(f, 7, symbols, 0, false, parseErrors, span, rawLine, "z2");
        patches.push({ ...span, kind: "SP", ns, x1, y1, z1, x2, y2, z2 });
        break;
      }
      case "SM": {
        const f = splitCardFields(rest);
        const nx = Math.trunc(evalField(f, 0, symbols, 1, true, parseErrors, span, rawLine, "nx"));
        const ny = Math.trunc(evalField(f, 1, symbols, 1, true, parseErrors, span, rawLine, "ny"));
        const x1 = evalField(f, 2, symbols, 0, false, parseErrors, span, rawLine, "x1");
        const y1 = evalField(f, 3, symbols, 0, false, parseErrors, span, rawLine, "y1");
        const z1 = evalField(f, 4, symbols, 0, false, parseErrors, span, rawLine, "z1");
        const x2 = evalField(f, 5, symbols, 0, false, parseErrors, span, rawLine, "x2");
        const y2 = evalField(f, 6, symbols, 0, false, parseErrors, span, rawLine, "y2");
        const z2 = evalField(f, 7, symbols, 0, false, parseErrors, span, rawLine, "z2");
        patches.push({ ...span, kind: "SM", ns: 0, nx, ny, x1, y1, z1, x2, y2, z2 });
        break;
      }
      case "GE": {
        const f = splitCardFields(rest);
        const gpflag =
          f.length > 0 ? Math.trunc(evalField(f, 0, symbols, 0, false, parseErrors, span, rawLine, "gpflag")) : 0;
        hasGeometryEnd = true;
        geometryEnd = { ...span, gpflag };
        break;
      }
      case "FR": {
        const f = splitCardFields(rest);
        const ifrq = Math.trunc(evalField(f, 0, symbols, 0, false, parseErrors, span, rawLine, "ifrq"));
        const nfrq = Math.trunc(evalField(f, 1, symbols, 1, false, parseErrors, span, rawLine, "nfrq"));
        // NEC-2 FR card: FR IFRQ NFRQ I3 I4 FMHZ DELFRQ
        const fmhz = evalField(f, 4, symbols, 0, true, parseErrors, span, rawLine, "fmhz");
        const delFreq = evalField(f, 5, symbols, 0, false, parseErrors, span, rawLine, "delFreq");
        frequencies.push({ ...span, ifrq, nfrq, fmhz, delFreq });
        break;
      }
      case "EX": {
        const f = splitCardFields(rest);
        const type = Math.trunc(evalField(f, 0, symbols, 0, true, parseErrors, span, rawLine, "type"));
        const tag = Math.trunc(evalField(f, 1, symbols, 0, true, parseErrors, span, rawLine, "tag"));
        const segment = Math.trunc(evalField(f, 2, symbols, 1, true, parseErrors, span, rawLine, "segment"));
        const admit = Math.trunc(evalField(f, 3, symbols, 0, false, parseErrors, span, rawLine, "admit"));
        const vReal = evalField(f, 4, symbols, 1.0, false, parseErrors, span, rawLine, "vReal");
        const vImag = evalField(f, 5, symbols, 0.0, false, parseErrors, span, rawLine, "vImag");
        excitations.push({ ...span, type, tag, segment, admit, vReal, vImag });
        break;
      }
      case "LD": {
        const f = splitCardFields(rest);
        const ldtyp = Math.trunc(evalField(f, 0, symbols, 0, true, parseErrors, span, rawLine, "ldtyp"));
        const tag = Math.trunc(evalField(f, 1, symbols, 0, false, parseErrors, span, rawLine, "tag"));
        const segStart = Math.trunc(evalField(f, 2, symbols, 0, false, parseErrors, span, rawLine, "segStart"));
        const segEnd = Math.trunc(evalField(f, 3, symbols, 0, false, parseErrors, span, rawLine, "segEnd"));
        const z1 = evalField(f, 4, symbols, 0, false, parseErrors, span, rawLine, "z1");
        const z2 = evalField(f, 5, symbols, 0, false, parseErrors, span, rawLine, "z2");
        const z3 = evalField(f, 6, symbols, 0, false, parseErrors, span, rawLine, "z3");
        loads.push({ ...span, ldtyp, tag, segStart, segEnd, z1, z2, z3 });
        break;
      }
      case "GN": {
        const f = splitCardFields(rest);
        const iperf = Math.trunc(evalField(f, 0, symbols, -1, true, parseErrors, span, rawLine, "iperf"));
        const nradl = Math.trunc(evalField(f, 1, symbols, 0, false, parseErrors, span, rawLine, "nradl"));
        const epsr = evalField(f, 4, symbols, 1.0, false, parseErrors, span, rawLine, "epsr");
        const sigma = evalField(f, 5, symbols, 0.0, false, parseErrors, span, rawLine, "sigma");
        grounds.push({ ...span, iperf, nradl, epsr, sigma });
        break;
      }
      case "NT": {
        const f = splitCardFields(rest);
        const tag1 = Math.trunc(evalField(f, 0, symbols, 0, true, parseErrors, span, rawLine, "tag1"));
        const seg1 = Math.trunc(evalField(f, 1, symbols, 1, true, parseErrors, span, rawLine, "seg1"));
        const tag2 = Math.trunc(evalField(f, 2, symbols, 0, true, parseErrors, span, rawLine, "tag2"));
        const seg2 = Math.trunc(evalField(f, 3, symbols, 1, true, parseErrors, span, rawLine, "seg2"));
        const y11Re = evalField(f, 4, symbols, 0, false, parseErrors, span, rawLine, "y11Re");
        const y11Im = evalField(f, 5, symbols, 0, false, parseErrors, span, rawLine, "y11Im");
        const y12Re = evalField(f, 6, symbols, 0, false, parseErrors, span, rawLine, "y12Re");
        const y12Im = evalField(f, 7, symbols, 0, false, parseErrors, span, rawLine, "y12Im");
        const y22Re = evalField(f, 8, symbols, 0, false, parseErrors, span, rawLine, "y22Re");
        const y22Im = evalField(f, 9, symbols, 0, false, parseErrors, span, rawLine, "y22Im");
        networks.push({ ...span, tag1, seg1, tag2, seg2, y11Re, y11Im, y12Re, y12Im, y22Re, y22Im });
        break;
      }
      case "TL": {
        const f = splitCardFields(rest);
        const tag1 = Math.trunc(evalField(f, 0, symbols, 0, true, parseErrors, span, rawLine, "tag1"));
        const seg1 = Math.trunc(evalField(f, 1, symbols, 1, true, parseErrors, span, rawLine, "seg1"));
        const tag2 = Math.trunc(evalField(f, 2, symbols, 0, true, parseErrors, span, rawLine, "tag2"));
        const seg2 = Math.trunc(evalField(f, 3, symbols, 1, true, parseErrors, span, rawLine, "seg2"));
        const z0 = evalField(f, 4, symbols, 50, true, parseErrors, span, rawLine, "z0");
        const length = evalField(f, 5, symbols, 0, false, parseErrors, span, rawLine, "length");
        const y1Re = evalField(f, 6, symbols, 0, false, parseErrors, span, rawLine, "y1Re");
        const y1Im = evalField(f, 7, symbols, 0, false, parseErrors, span, rawLine, "y1Im");
        const y2Re = evalField(f, 8, symbols, 0, false, parseErrors, span, rawLine, "y2Re");
        const y2Im = evalField(f, 9, symbols, 0, false, parseErrors, span, rawLine, "y2Im");
        transmissionLines.push({ ...span, tag1, seg1, tag2, seg2, z0, length, y1Re, y1Im, y2Re, y2Im });
        break;
      }
      case "RP": {
        const f = splitCardFields(rest);
        const mode = Math.trunc(evalField(f, 0, symbols, 0, false, parseErrors, span, rawLine, "mode"));
        const nth = Math.trunc(evalField(f, 1, symbols, 37, false, parseErrors, span, rawLine, "nth"));
        const nph = Math.trunc(evalField(f, 2, symbols, 1, false, parseErrors, span, rawLine, "nph"));
        const xn = Math.trunc(evalField(f, 3, symbols, 1000, false, parseErrors, span, rawLine, "xn"));
        const theta0Deg = evalField(f, 4, symbols, 0, false, parseErrors, span, rawLine, "theta0");
        const phi0Deg = evalField(f, 5, symbols, 0, false, parseErrors, span, rawLine, "phi0");
        const dThetaDeg = evalField(f, 6, symbols, 5, false, parseErrors, span, rawLine, "dTheta");
        const dPhiDeg = evalField(f, 7, symbols, 5, false, parseErrors, span, rawLine, "dPhi");
        radiationPatterns.push({ ...span, mode, nth, nph, xn, theta0Deg, phi0Deg, dThetaDeg, dPhiDeg });
        break;
      }
      case "XQ": {
        const f = splitCardFields(rest);
        const option =
          f.length > 0 ? Math.trunc(evalField(f, 0, symbols, 0, false, parseErrors, span, rawLine, "opt")) : 0;
        executes.push({ ...span, option });
        break;
      }
      case "EN": {
        hasEnd = true;
        break;
      }
      default:
        break;
    }
  }

  const title = comments.find((c) => c.trim().length > 0) ?? "NEC2_Antenna";

  return {
    title,
    comments,
    hasCommentEnd,
    hasGeometryEnd,
    hasEnd,
    symbolDefs,
    symbols,
    wires,
    arcs,
    helices,
    transforms,
    symmetries,
    scales,
    patches,
    geometryEnd,
    frequencies,
    excitations,
    loads,
    grounds,
    networks,
    transmissionLines,
    radiationPatterns,
    executes,
    cards,
    parseErrors,
  };
}

function rotatePoint(
  x: number,
  y: number,
  z: number,
  rxDeg: number,
  ryDeg: number,
  rzDeg: number,
): [number, number, number] {
  const rx = rxDeg * DEG_TO_RAD;
  const ry = ryDeg * DEG_TO_RAD;
  const rz = rzDeg * DEG_TO_RAD;

  // Rotate about X
  let y1 = y * Math.cos(rx) - z * Math.sin(rx);
  let z1 = y * Math.sin(rx) + z * Math.cos(rx);
  let x1 = x;

  // Rotate about Y
  const x2 = x1 * Math.cos(ry) + z1 * Math.sin(ry);
  const z2 = -x1 * Math.sin(ry) + z1 * Math.cos(ry);
  x1 = x2;
  z1 = z2;

  // Rotate about Z
  const x3 = x1 * Math.cos(rz) - y1 * Math.sin(rz);
  const y3 = x1 * Math.sin(rz) + y1 * Math.cos(rz);
  return [x3, y3, z1];
}

/**
 * Expands `GW`, `GA` (arc), `GH` (helix), `GM` (transform/replicate), `GR` (cylindrical symmetry),
 * and `GS` (scale) into a flat list of concrete wire primitives for MoM discretization.
 */
export function expandNec2Geometry(deck: Nec2Deck): Nec2Wire[] {
  let out: Nec2Wire[] = deck.wires.map((w) => ({ ...w }));

  // Expand GA (wire arc in X-Z plane)
  for (const arc of deck.arcs) {
    const n = Math.max(1, arc.segments);
    const a1 = arc.angle1Deg * DEG_TO_RAD;
    const a2 = arc.angle2Deg * DEG_TO_RAD;
    const da = (a2 - a1) / n;
    for (let k = 0; k < n; k++) {
      const t1 = a1 + k * da;
      const t2 = a1 + (k + 1) * da;
      out.push({
        ...arc,
        tag: arc.tag,
        segments: 1,
        x1: arc.arcRadius * Math.cos(t1),
        y1: 0,
        z1: arc.arcRadius * Math.sin(t1),
        x2: arc.arcRadius * Math.cos(t2),
        y2: 0,
        z2: arc.arcRadius * Math.sin(t2),
        radius: arc.wireRadius,
      });
    }
  }

  // Expand GH (helix along Z)
  for (const h of deck.helices) {
    const n = Math.max(1, h.segments);
    const turns = h.spacing !== 0 ? h.length / h.spacing : 1;
    for (let k = 0; k < n; k++) {
      const f1 = k / n;
      const f2 = (k + 1) / n;
      const ang1 = 2 * Math.PI * turns * f1;
      const ang2 = 2 * Math.PI * turns * f2;
      const rx1 = h.rx1 + (h.rx2 - h.rx1) * f1;
      const ry1 = h.ry1 + (h.ry2 - h.ry1) * f1;
      const rx2 = h.rx1 + (h.rx2 - h.rx1) * f2;
      const ry2 = h.ry1 + (h.ry2 - h.ry1) * f2;
      out.push({
        ...h,
        tag: h.tag,
        segments: 1,
        x1: rx1 * Math.cos(ang1),
        y1: ry1 * Math.sin(ang1),
        z1: h.length * f1,
        x2: rx2 * Math.cos(ang2),
        y2: ry2 * Math.sin(ang2),
        z2: h.length * f2,
        radius: h.wireRadius,
      });
    }
  }

  // Apply GM coordinate transformations / replications
  for (const gm of deck.transforms) {
    const base = out.filter((w) => gm.startTag === 0 || w.tag >= gm.startTag);
    if (gm.newStructures === 0) {
      out = out.map((w) => {
        if (gm.startTag !== 0 && w.tag < gm.startTag) return w;
        const [nx1, ny1, nz1] = rotatePoint(w.x1, w.y1, w.z1, gm.roXDeg, gm.roYDeg, gm.roZDeg);
        const [nx2, ny2, nz2] = rotatePoint(w.x2, w.y2, w.z2, gm.roXDeg, gm.roYDeg, gm.roZDeg);
        return {
          ...w,
          tag: w.tag + gm.tagIncrement,
          x1: nx1 + gm.dx,
          y1: ny1 + gm.dy,
          z1: nz1 + gm.dz,
          x2: nx2 + gm.dx,
          y2: ny2 + gm.dy,
          z2: nz2 + gm.dz,
        };
      });
    } else {
      let current = base;
      for (let c = 1; c <= gm.newStructures; c++) {
        const next = current.map((w) => {
          const [nx1, ny1, nz1] = rotatePoint(w.x1, w.y1, w.z1, gm.roXDeg, gm.roYDeg, gm.roZDeg);
          const [nx2, ny2, nz2] = rotatePoint(w.x2, w.y2, w.z2, gm.roXDeg, gm.roYDeg, gm.roZDeg);
          return {
            ...w,
            tag: w.tag + gm.tagIncrement,
            x1: nx1 + gm.dx,
            y1: ny1 + gm.dy,
            z1: nz1 + gm.dz,
            x2: nx2 + gm.dx,
            y2: ny2 + gm.dy,
            z2: nz2 + gm.dz,
          };
        });
        out.push(...next);
        current = next;
      }
    }
  }

  // Apply GR cylindrical symmetry
  for (const gr of deck.symmetries) {
    if (gr.copies <= 1) continue;
    const base = [...out];
    const stepDeg = 360 / gr.copies;
    for (let c = 1; c < gr.copies; c++) {
      const ang = c * stepDeg;
      for (const w of base) {
        const [nx1, ny1, nz1] = rotatePoint(w.x1, w.y1, w.z1, 0, 0, ang);
        const [nx2, ny2, nz2] = rotatePoint(w.x2, w.y2, w.z2, 0, 0, ang);
        out.push({
          ...w,
          tag: w.tag + c * gr.tagIncrement,
          x1: nx1,
          y1: ny1,
          z1: nz1,
          x2: nx2,
          y2: ny2,
          z2: nz2,
        });
      }
    }
  }

  // Apply GS uniform scaling
  for (const gs of deck.scales) {
    const f = gs.factor;
    out = out.map((w) => ({
      ...w,
      x1: w.x1 * f,
      y1: w.y1 * f,
      z1: w.z1 * f,
      x2: w.x2 * f,
      y2: w.y2 * f,
      z2: w.z2 * f,
      radius: w.radius * f,
    }));
  }

  return out;
}

/**
 * Expands all `FR` frequency cards into an ordered list of frequencies in MHz.
 */
export function expandNec2Frequencies(deck: Nec2Deck): number[] {
  const freqs: number[] = [];
  for (const fr of deck.frequencies) {
    if (fr.fmhz <= 0 || fr.nfrq < 1) continue;
    for (let k = 0; k < fr.nfrq; k++) {
      if (fr.ifrq === 1) {
        const ratio = fr.delFreq > 0 ? fr.delFreq : 1;
        freqs.push(fr.fmhz * Math.pow(ratio, k));
      } else {
        freqs.push(fr.fmhz + k * fr.delFreq);
      }
    }
  }
  return freqs;
}

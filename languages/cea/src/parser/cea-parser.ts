// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cea — Structured Parser for NASA CEA Problem Decks.
 *
 * Parses NASA CEA input datasets (`problem`, `reactants`, `only`, `omit`, `insert`,
 * `output`, `end`) with `#` and `!` comments, unit conversions, and source spans.
 */

import type {
  CeaDeck,
  CeaOutputOptions,
  CeaParseDiagnostic,
  CeaPressureUnit,
  CeaProblemSection,
  CeaProblemType,
  CeaReactant,
  CeaReactantRole,
  CeaTemperatureUnit,
} from "../types.js";

const SECTION_KEYWORDS = new Set([
  "problem",
  "prob",
  "reactants",
  "reac",
  "only",
  "omit",
  "insert",
  "output",
  "outp",
  "end",
]);

const PROBLEM_TYPE_ALIASES: Record<string, CeaProblemType> = {
  hp: "hp",
  tp: "tp",
  uv: "uv",
  tv: "tv",
  sp: "sp",
  sv: "sv",
  rocket: "rocket",
  rkt: "rocket",
  deton: "deton",
  det: "deton",
  shock: "shock",
};

const PRESSURE_TO_BAR: Record<CeaPressureUnit, number> = {
  bar: 1.0,
  atm: 1.01325,
  psia: 0.068947572931684,
  mmhg: 1.01325 / 760,
  pa: 1e-5,
};

function convertTemperatureToK(val: number, unit: CeaTemperatureUnit): number {
  switch (unit) {
    case "k":
      return val;
    case "c":
      return val + 273.15;
    case "r":
      return (val * 5) / 9;
    case "f":
      return ((val - 32) * 5) / 9 + 273.15;
  }
}

function stripComment(line: string): { code: string; comment?: string } {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble && (ch === "#" || ch === "!")) {
      return { code: line.slice(0, i), comment: line.slice(i) };
    }
  }
  return { code: line };
}

function isNumericToken(tok: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?$/.test(tok);
}

function parseNumberToken(tok: string): number {
  return Number(tok.replace(/[dD]/g, "e"));
}

/**
 * Tokenizes a CEA line into logical tokens, normalizing `key = val` into `key=val`
 * while preserving commas inside numeric lists.
 */
function tokenizeLine(code: string): Array<{ text: string; col: number }> {
  const raw: Array<{ text: string; col: number }> = [];
  let i = 0;
  const n = code.length;
  while (i < n) {
    while (i < n && (code[i] === " " || code[i] === "\t" || code[i] === ",")) i++;
    if (i >= n) break;
    const start = i;
    if (code[i] === "=") {
      raw.push({ text: "=", col: start + 1 });
      i++;
      continue;
    }
    if (code[i] === '"' || code[i] === "'") {
      const quote = code[i];
      i++;
      while (i < n && code[i] !== quote) i++;
      if (i < n) i++;
      raw.push({ text: code.slice(start, i), col: start + 1 });
      continue;
    }
    while (i < n && code[i] !== " " && code[i] !== "\t" && code[i] !== "=") {
      i++;
    }
    raw.push({ text: code.slice(start, i), col: start + 1 });
  }

  // Merge `key`, `=`, `val` into `key=val`
  const merged: Array<{ text: string; col: number }> = [];
  for (let j = 0; j < raw.length; j++) {
    const cur = raw[j]!;
    const next = raw[j + 1];
    if (next && next.text === "=") {
      const val = raw[j + 2];
      if (val && val.text !== "=") {
        merged.push({ text: `${cur.text}=${val.text}`, col: cur.col });
        j += 2;
      } else {
        merged.push({ text: `${cur.text}=`, col: cur.col });
        j += 1;
      }
    } else if (cur.text.endsWith("=") && next && next.text !== "=") {
      merged.push({ text: `${cur.text}${next.text}`, col: cur.col });
      j += 1;
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

function splitNumberList(valStr: string): number[] | null {
  const parts = valStr
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!isNumericToken(p)) return null;
    nums.push(parseNumberToken(p));
  }
  return nums;
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Parses a NASA CEA input deck string into a structured `CeaDeck`.
 */
export function parseCeaDeck(source: string): CeaDeck {
  const problem: CeaProblemSection = {
    rawProblemTypes: [],
    unknownTokens: [],
    equilibrium: false,
    frozen: false,
    pressures: [],
    pressureUnit: "bar",
    pressuresBar: [],
    temperatures: [],
    temperatureUnit: "k",
    temperaturesK: [],
    ofRatios: [],
    phiRatios: [],
    piPeRatios: [],
    supar: [],
    subar: [],
    mach: [],
    u1: [],
  };

  const output: CeaOutputOptions = {
    siunits: true,
    calories: false,
    short: false,
    massf: false,
    molef: true,
    transport: false,
    plot: [],
  };

  const reactants: CeaReactant[] = [];
  const only: string[] = [];
  const omit: string[] = [];
  const insert: string[] = [];
  const comments: Array<{ text: string; line: number }> = [];
  const parseErrors: CeaParseDiagnostic[] = [];

  let hasProblem = false;
  let hasReactants = false;
  let hasEnd = false;
  let currentSection: "none" | "problem" | "reactants" | "only" | "omit" | "insert" | "output" = "none";

  const lines = source.split(/\r?\n/);
  let offset = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx] ?? "";
    const lineNum = lineIdx + 1;
    const lineStartOffset = offset;
    offset += rawLine.length + 1;

    const { code, comment } = stripComment(rawLine);
    if (comment) {
      comments.push({ text: comment.trim(), line: lineNum });
    }
    const trimmed = code.trim();
    if (trimmed.length === 0) continue;

    const tokens = tokenizeLine(code);
    if (tokens.length === 0) continue;

    let startIdx = 0;
    const firstLower = tokens[0]!.text.toLowerCase();

    if (SECTION_KEYWORDS.has(firstLower)) {
      startIdx = 1;
      if (firstLower === "problem" || firstLower === "prob") {
        currentSection = "problem";
        hasProblem = true;
        if (!problem.span) {
          problem.span = {
            startLine: lineNum,
            startColumn: tokens[0]!.col,
            endLine: lineNum,
            endColumn: rawLine.length + 1,
            startOffset: lineStartOffset,
            endOffset: lineStartOffset + rawLine.length,
          };
        }
      } else if (firstLower === "reactants" || firstLower === "reac") {
        currentSection = "reactants";
        hasReactants = true;
      } else if (firstLower === "only") {
        currentSection = "only";
      } else if (firstLower === "omit") {
        currentSection = "omit";
      } else if (firstLower === "insert") {
        currentSection = "insert";
      } else if (firstLower === "output" || firstLower === "outp") {
        currentSection = "output";
        if (!output.span) {
          output.span = {
            startLine: lineNum,
            startColumn: tokens[0]!.col,
            endLine: lineNum,
            endColumn: rawLine.length + 1,
            startOffset: lineStartOffset,
            endOffset: lineStartOffset + rawLine.length,
          };
        }
      } else if (firstLower === "end") {
        hasEnd = true;
        currentSection = "none";
        continue;
      }
    }

    const lineTokens = tokens.slice(startIdx);
    if (lineTokens.length === 0) continue;

    if (currentSection === "problem") {
      if (problem.span) {
        problem.span.endLine = lineNum;
        problem.span.endColumn = rawLine.length + 1;
        problem.span.endOffset = lineStartOffset + rawLine.length;
      }
      parseProblemTokens(lineTokens, lineNum, problem, parseErrors);
    } else if (currentSection === "reactants") {
      parseReactantLine(lineTokens, lineNum, lineStartOffset, lineStartOffset + rawLine.length, reactants, parseErrors);
    } else if (currentSection === "only") {
      for (const t of lineTokens) {
        for (const sp of t.text.split(",")) {
          const clean = sp.trim();
          if (clean.length > 0) only.push(clean);
        }
      }
    } else if (currentSection === "omit") {
      for (const t of lineTokens) {
        for (const sp of t.text.split(",")) {
          const clean = sp.trim();
          if (clean.length > 0) omit.push(clean);
        }
      }
    } else if (currentSection === "insert") {
      for (const t of lineTokens) {
        for (const sp of t.text.split(",")) {
          const clean = sp.trim();
          if (clean.length > 0) insert.push(clean);
        }
      }
    } else if (currentSection === "output") {
      parseOutputTokens(lineTokens, lineNum, output, parseErrors);
    } else {
      parseErrors.push({
        code: "CEA1001",
        message: `Unexpected token '${lineTokens[0]!.text}' outside any CEA dataset section.`,
        line: lineNum,
        column: lineTokens[0]!.col,
      });
    }
  }

  // Default to equilibrium mode if neither equilibrium nor frozen was explicitly specified
  if (!problem.equilibrium && !problem.frozen) {
    problem.equilibrium = true;
  }

  const name = problem.caseName || (problem.problemType ? `cea_${problem.problemType}` : "cea_problem");

  return {
    name,
    hasProblem,
    hasReactants,
    hasEnd,
    problem,
    reactants,
    only,
    omit,
    insert,
    output,
    comments,
    parseErrors,
    rawText: source,
  };
}

function collectFollowingNumbers(
  tokens: Array<{ text: string; col: number }>,
  startIndex: number,
): { values: number[]; consumed: number } {
  const values: number[] = [];
  let consumed = 0;
  for (let k = startIndex; k < tokens.length; k++) {
    const tok = tokens[k]!.text;
    const list = splitNumberList(tok);
    if (list) {
      values.push(...list);
      consumed++;
    } else {
      break;
    }
  }
  return { values, consumed };
}

function parseProblemTokens(
  tokens: Array<{ text: string; col: number }>,
  lineNum: number,
  problem: CeaProblemSection,
  parseErrors: CeaParseDiagnostic[],
): void {
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const raw = tok.text;
    const eqIdx = raw.indexOf("=");

    if (eqIdx >= 0) {
      const key = raw.slice(0, eqIdx).trim().toLowerCase();
      const valStr = raw.slice(eqIdx + 1).trim();

      if (key === "case" || key === "id") {
        problem.caseName = unquote(valStr);
        continue;
      }

      const inlineNums = valStr.length > 0 ? splitNumberList(valStr) : [];
      const extra = collectFollowingNumbers(tokens, i + 1);
      i += extra.consumed;

      if (inlineNums === null) {
        parseErrors.push({
          code: "CEA1001",
          message: `Invalid numeric value '${valStr}' for '${key}'`,
          line: lineNum,
          column: tok.col,
        });
        continue;
      }
      const vals = [...inlineNums, ...extra.values];
      if (vals.length === 0) {
        parseErrors.push({
          code: "CEA1001",
          message: `Missing numeric value for '${key}'`,
          line: lineNum,
          column: tok.col,
        });
        continue;
      }

      if (key === "p,bar" || key === "p(bar)" || key === "p") {
        problem.pressureUnit = "bar";
        problem.pressures.push(...vals);
        problem.pressuresBar.push(...vals.map((v) => v * PRESSURE_TO_BAR.bar));
      } else if (key === "p,atm" || key === "p(atm)") {
        problem.pressureUnit = "atm";
        problem.pressures.push(...vals);
        problem.pressuresBar.push(...vals.map((v) => v * PRESSURE_TO_BAR.atm));
      } else if (key === "p,psia" || key === "p(psia)" || key === "p,psi") {
        problem.pressureUnit = "psia";
        problem.pressures.push(...vals);
        problem.pressuresBar.push(...vals.map((v) => v * PRESSURE_TO_BAR.psia));
      } else if (key === "p,mmhg" || key === "p(mmhg)") {
        problem.pressureUnit = "mmhg";
        problem.pressures.push(...vals);
        problem.pressuresBar.push(...vals.map((v) => v * PRESSURE_TO_BAR.mmhg));
      } else if (key === "p,pa" || key === "p(pa)") {
        problem.pressureUnit = "pa";
        problem.pressures.push(...vals);
        problem.pressuresBar.push(...vals.map((v) => v * PRESSURE_TO_BAR.pa));
      } else if (key === "t,k" || key === "t(k)" || key === "t") {
        problem.temperatureUnit = "k";
        problem.temperatures.push(...vals);
        problem.temperaturesK.push(...vals.map((v) => convertTemperatureToK(v, "k")));
      } else if (key === "t,c" || key === "t(c)") {
        problem.temperatureUnit = "c";
        problem.temperatures.push(...vals);
        problem.temperaturesK.push(...vals.map((v) => convertTemperatureToK(v, "c")));
      } else if (key === "t,r" || key === "t(r)") {
        problem.temperatureUnit = "r";
        problem.temperatures.push(...vals);
        problem.temperaturesK.push(...vals.map((v) => convertTemperatureToK(v, "r")));
      } else if (key === "t,f" || key === "t(f)") {
        problem.temperatureUnit = "f";
        problem.temperatures.push(...vals);
        problem.temperaturesK.push(...vals.map((v) => convertTemperatureToK(v, "f")));
      } else if (key === "o/f" || key === "of") {
        problem.ofRatios.push(...vals);
      } else if (key === "phi" || key === "r,eq" || key === "eq.ratio") {
        problem.phiRatios.push(...vals);
      } else if (key === "pi/pe" || key === "pip" || key === "pi/p") {
        problem.piPeRatios.push(...vals);
      } else if (key === "supar" || key === "sup") {
        problem.supar.push(...vals);
      } else if (key === "subar" || key === "sub") {
        problem.subar.push(...vals);
      } else if (key === "mach" || key === "mach1") {
        problem.mach.push(...vals);
      } else if (key === "u1") {
        problem.u1.push(...vals);
      } else if (key === "tcest,k" || key === "tcest") {
        problem.tcEstK = vals[0];
      } else if (key === "nfz" || key === "nfrz") {
        problem.frozen = true;
      } else {
        problem.unknownTokens.push({ token: raw, line: lineNum, column: tok.col });
      }
      continue;
    }

    const lower = raw.toLowerCase().replace(/,+$/, "");
    if (lower.length === 0) continue;

    if (lower in PROBLEM_TYPE_ALIASES) {
      const pt = PROBLEM_TYPE_ALIASES[lower]!;
      problem.problemType = pt;
      problem.rawProblemTypes.push(lower);
    } else if (lower === "equilibrium" || lower === "eq") {
      problem.equilibrium = true;
    } else if (lower === "frozen" || lower === "fz") {
      problem.frozen = true;
    } else if (lower === "iac") {
      problem.iac = true;
    } else if (lower === "fac") {
      problem.fac = true;
    } else if (lower === "incd" || lower === "refl" || lower === "ions") {
      // Valid CEA modifier flags
    } else {
      problem.unknownTokens.push({ token: raw, line: lineNum, column: tok.col });
    }
  }
}

function parseReactantLine(
  tokens: Array<{ text: string; col: number }>,
  lineNum: number,
  startOffset: number,
  endOffset: number,
  reactants: CeaReactant[],
  parseErrors: CeaParseDiagnostic[],
): void {
  let role: CeaReactantRole | undefined;
  let name = "";
  let wtPercent: number | undefined;
  let moles: number | undefined;
  let temperatureK: number | undefined;
  let enthalpyKjMol: number | undefined;
  let density: number | undefined;
  const formula: Record<string, number> = {};
  let hasFormula = false;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const raw = tok.text;
    const eqIdx = raw.indexOf("=");

    if (eqIdx >= 0) {
      const key = raw.slice(0, eqIdx).trim().toLowerCase();
      const val = unquote(raw.slice(eqIdx + 1).trim());

      if (key === "fuel" || key === "fu") {
        role = "fuel";
        name = val;
      } else if (key === "oxid" || key === "ox") {
        role = "oxid";
        name = val;
      } else if (key === "name") {
        role = "name";
        name = val;
      } else if (key === "wt%" || key === "wt") {
        if (isNumericToken(val)) wtPercent = parseNumberToken(val);
        else {
          parseErrors.push({
            code: "CEA1001",
            message: `Invalid numeric wt% '${val}'`,
            line: lineNum,
            column: tok.col,
          });
        }
      } else if (key === "moles" || key === "m") {
        if (isNumericToken(val)) moles = parseNumberToken(val);
        else {
          parseErrors.push({
            code: "CEA1001",
            message: `Invalid numeric moles '${val}'`,
            line: lineNum,
            column: tok.col,
          });
        }
      } else if (key === "t(k)" || key === "t,k" || key === "t") {
        if (isNumericToken(val)) temperatureK = parseNumberToken(val);
        else {
          parseErrors.push({
            code: "CEA1001",
            message: `Invalid numeric temperature '${val}'`,
            line: lineNum,
            column: tok.col,
          });
        }
      } else if (key === "t(c)" || key === "t,c") {
        if (isNumericToken(val)) temperatureK = convertTemperatureToK(parseNumberToken(val), "c");
      } else if (key === "t(r)" || key === "t,r") {
        if (isNumericToken(val)) temperatureK = convertTemperatureToK(parseNumberToken(val), "r");
      } else if (key === "t(f)" || key === "t,f") {
        if (isNumericToken(val)) temperatureK = convertTemperatureToK(parseNumberToken(val), "f");
      } else if (key === "h,kj/mol" || key === "h(kj/mol)" || key === "h") {
        if (isNumericToken(val)) enthalpyKjMol = parseNumberToken(val);
      } else if (key === "h,cal/mol" || key === "h(cal/mol)") {
        if (isNumericToken(val)) enthalpyKjMol = parseNumberToken(val) * 0.004184;
      } else if (key === "rho" || key === "rho,g/cc") {
        if (isNumericToken(val)) density = parseNumberToken(val);
      }
      continue;
    }

    // Inline chemical formula pairs: e.g., `C 1 H 1.9423`
    const next = tokens[i + 1];
    if (/^[A-Z][a-z]?$/.test(raw) && next && isNumericToken(next.text)) {
      formula[raw] = parseNumberToken(next.text);
      hasFormula = true;
      i++;
    }
  }

  if (!role || name.length === 0) {
    parseErrors.push({
      code: "CEA1001",
      message: `Reactant declaration must specify 'fuel=', 'oxid=', or 'name='`,
      line: lineNum,
      column: tokens[0]?.col ?? 1,
    });
    return;
  }

  reactants.push({
    role,
    name,
    wtPercent,
    moles,
    temperatureK,
    enthalpyKjMol,
    formula: hasFormula ? formula : undefined,
    density,
    line: lineNum,
    column: tokens[0]?.col ?? 1,
    startOffset,
    endOffset,
  });
}

function parseOutputTokens(
  tokens: Array<{ text: string; col: number }>,
  lineNum: number,
  output: CeaOutputOptions,
  parseErrors: CeaParseDiagnostic[],
): void {
  let inPlot = false;
  for (const tok of tokens) {
    const raw = tok.text;
    const eqIdx = raw.indexOf("=");
    if (eqIdx >= 0) {
      inPlot = false;
      const key = raw.slice(0, eqIdx).trim().toLowerCase();
      const val = raw.slice(eqIdx + 1).trim();
      if (key === "trace") {
        if (isNumericToken(val)) {
          output.trace = parseNumberToken(val);
        } else {
          parseErrors.push({
            code: "CEA1001",
            message: `Invalid numeric trace threshold '${val}'`,
            line: lineNum,
            column: tok.col,
          });
        }
      }
      continue;
    }

    const lower = raw.toLowerCase();
    if (lower === "siunits" || lower === "si") {
      output.siunits = true;
      output.calories = false;
      inPlot = false;
    } else if (lower === "calories" || lower === "cal") {
      output.calories = true;
      output.siunits = false;
      inPlot = false;
    } else if (lower === "short") {
      output.short = true;
      inPlot = false;
    } else if (lower === "massf") {
      output.massf = true;
      output.molef = false;
      inPlot = false;
    } else if (lower === "molef") {
      output.molef = true;
      output.massf = false;
      inPlot = false;
    } else if (lower === "transport" || lower === "trans") {
      output.transport = true;
      inPlot = false;
    } else if (lower === "plot") {
      inPlot = true;
    } else if (inPlot) {
      output.plot.push(lower);
    }
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmtran — Zero-Regex Character-by-Character NONMEM / NMTRAN Parser & Serializer.
 *
 * Parses .ctl and .mod pharmacometric control streams without any regular expressions.
 */

import type {
  CompartmentDef,
  DesEquation,
  DosingRecord,
  ErrorStatement,
  NmtranControlStream,
  NmtranDocument,
  NmtranRange,
  NmtranSimulationSpec,
  OmegaSpec,
  PkStatement,
  SigmaSpec,
  ThetaSpec,
} from "../types.js";

interface SourceLine {
  lineNumber: number; // 1-based
  rawText: string;
  codeText: string;
  commentText: string;
  startOffset: number;
  endOffset: number;
}

function isHorizontalSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r";
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isAlpha(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isAlphaNum(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

function isIdentChar(ch: string): boolean {
  return isAlphaNum(ch) || ch === "." || ch === "-" || ch === "/" || ch === "@";
}

function splitLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const len = source.length;
  let i = 0;
  let lineNum = 1;

  while (i <= len) {
    const startOffset = i;
    while (i < len && source[i] !== "\n") {
      i++;
    }
    let endOffset = i;
    if (endOffset > startOffset && source[endOffset - 1] === "\r") {
      endOffset--;
    }
    const rawText = source.slice(startOffset, endOffset);

    // Split code vs comment at first ';' outside quotes
    let semiIdx = -1;
    let inSingle = false;
    let inDouble = false;
    for (let j = 0; j < rawText.length; j++) {
      const ch = rawText[j];
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
      } else if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
      } else if (ch === ";" && !inSingle && !inDouble) {
        semiIdx = j;
        break;
      }
    }

    const codeText = semiIdx >= 0 ? rawText.slice(0, semiIdx) : rawText;
    const commentText = semiIdx >= 0 ? rawText.slice(semiIdx + 1).trim() : "";

    lines.push({
      lineNumber: lineNum,
      rawText,
      codeText,
      commentText,
      startOffset,
      endOffset,
    });

    lineNum++;
    if (i === len) break;
    i++; // skip '\n'
  }

  return lines;
}

function makeLineRange(line: SourceLine): NmtranRange {
  return {
    startLine: line.lineNumber,
    startColumn: 1,
    endLine: line.lineNumber,
    endColumn: Math.max(1, line.rawText.length + 1),
    startOffset: line.startOffset,
    endOffset: line.endOffset,
  };
}

/**
 * Extracts all 1-based integer arguments to `funcName(k)` in `expr` without regex.
 */
export function extractIndexedReferences(expr: string, funcName: string): number[] {
  const results: number[] = [];
  const target = funcName.toUpperCase();
  const n = expr.length;
  const m = target.length;
  let i = 0;

  while (i <= n - m) {
    const prevCh = i > 0 ? (expr[i - 1] ?? "") : "";
    if (prevCh === "" || !isAlphaNum(prevCh)) {
      let match = true;
      for (let k = 0; k < m; k++) {
        const c = expr[i + k]?.toUpperCase() ?? "";
        if (c !== target[k]) {
          match = false;
          break;
        }
      }
      if (match) {
        const afterIdx = i + m;
        const afterCh = expr[afterIdx] ?? "";
        if (afterCh === "" || !isAlphaNum(afterCh)) {
          let p = afterIdx;
          while (p < n && isHorizontalSpace(expr[p] ?? "")) p++;
          if (expr[p] === "(") {
            p++;
            while (p < n && isHorizontalSpace(expr[p] ?? "")) p++;
            let numStr = "";
            if (expr[p] === "-" || expr[p] === "+") {
              numStr += expr[p];
              p++;
            }
            while (p < n && isDigit(expr[p] ?? "")) {
              numStr += expr[p];
              p++;
            }
            while (p < n && isHorizontalSpace(expr[p] ?? "")) p++;
            if (expr[p] === ")" && numStr.length > 0 && numStr !== "-" && numStr !== "+") {
              const idxVal = Number.parseInt(numStr, 10);
              if (!Number.isNaN(idxVal) && !results.includes(idxVal)) {
                results.push(idxVal);
              }
              i = p + 1;
              continue;
            }
          }
        }
      }
    }
    i++;
  }

  return results;
}

function tokenizeWhitespaceAndPunct(text: string): string[] {
  const tokens: string[] = [];
  const n = text.length;
  let i = 0;

  while (i < n) {
    const ch = text[i] ?? "";
    if (isWhitespace(ch) || ch === ",") {
      i++;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "=") {
      tokens.push(ch);
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let str = "";
      i++;
      while (i < n && text[i] !== quote) {
        str += text[i];
        i++;
      }
      if (i < n && text[i] === quote) i++;
      tokens.push(str);
      continue;
    }
    let tok = "";
    while (
      i < n &&
      !isWhitespace(text[i] ?? "") &&
      text[i] !== "," &&
      text[i] !== "(" &&
      text[i] !== ")" &&
      text[i] !== "="
    ) {
      tok += text[i];
      i++;
    }
    if (tok.length > 0) {
      tokens.push(tok);
    }
  }

  return tokens;
}

function parseBoundValue(tok: string): number {
  const upper = tok.trim().toUpperCase();
  if (upper === "-INF" || upper === "-INFINITY" || upper === "-1000000") {
    return Number.NEGATIVE_INFINITY;
  }
  if (upper === "INF" || upper === "+INF" || upper === "INFINITY" || upper === "+INFINITY" || upper === "1000000") {
    return Number.POSITIVE_INFINITY;
  }
  return Number.parseFloat(upper);
}

function normalizeRecordType(rawRecordName: string): string {
  const up = rawRecordName.toUpperCase();
  if (up.startsWith("PROB")) return "PROBLEM";
  if (up.startsWith("INP")) return "INPUT";
  if (up.startsWith("DAT")) return "DATA";
  if (up.startsWith("SUB")) return "SUBROUTINES";
  if (up.startsWith("MOD")) return "MODEL";
  if (up === "PK" || up === "PRED") return "PK";
  if (up === "DES") return "DES";
  if (up.startsWith("ERR")) return "ERROR";
  if (up.startsWith("THE")) return "THETA";
  if (up.startsWith("OME")) return "OMEGA";
  if (up.startsWith("SIG")) return "SIGMA";
  if (up.startsWith("EST")) return "ESTIMATION";
  if (up.startsWith("SIM")) return "SIMULATION";
  if (up.startsWith("DOS")) return "DOSE";
  if (up.startsWith("TAB")) return "TABLE";
  if (up.startsWith("COV")) return "COVARIANCE";
  return up;
}

function parseAssignmentLine(code: string): { lhs: string; rhs: string } | null {
  let trimmed = code.trim();
  if (trimmed.length === 0) return null;

  // Handle "IF (condition) LHS = RHS"
  if (trimmed.length > 2 && trimmed.slice(0, 2).toUpperCase() === "IF") {
    const afterIf = trimmed[2] ?? "";
    if (isHorizontalSpace(afterIf) || afterIf === "(") {
      let p = 2;
      while (p < trimmed.length && isHorizontalSpace(trimmed[p] ?? "")) p++;
      if (trimmed[p] === "(") {
        let depth = 0;
        while (p < trimmed.length) {
          if (trimmed[p] === "(") depth++;
          else if (trimmed[p] === ")") {
            depth--;
            if (depth === 0) {
              p++;
              break;
            }
          }
          p++;
        }
        trimmed = trimmed.slice(p).trim();
        if (trimmed.toUpperCase().startsWith("THEN")) {
          trimmed = trimmed.slice(4).trim();
        }
      }
    }
  }

  // Find single '=' assignment operator (not ==, /=, <=, >=, !=)
  let eqPos = -1;
  let parenDepth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i] ?? "";
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === "=" && parenDepth === 0) {
      const prev = i > 0 ? (trimmed[i - 1] ?? "") : "";
      const next = i + 1 < trimmed.length ? (trimmed[i + 1] ?? "") : "";
      if (prev !== "=" && prev !== "<" && prev !== ">" && prev !== "/" && prev !== "!" && next !== "=") {
        eqPos = i;
        break;
      }
    }
  }

  if (eqPos <= 0) return null;
  const lhs = trimmed.slice(0, eqPos).trim();
  const rhs = trimmed.slice(eqPos + 1).trim();
  if (lhs.length === 0 || rhs.length === 0) return null;
  return { lhs, rhs };
}

function parseKeyValDosingLine(text: string, range: NmtranRange): DosingRecord | null {
  const tokens = tokenizeWhitespaceAndPunct(text);
  if (tokens.length === 0) return null;

  let hasDoseKeys = false;
  let id: string | number | undefined;
  let time = 0;
  let amt = 0;
  let rate = 0;
  let cmt = 1;
  let evid = 1;
  let ii = 0;
  let addl = 0;
  let dv: number | undefined;
  let mdv: number | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const key = (tokens[i] ?? "").toUpperCase();
    if (tokens[i + 1] === "=" && i + 2 < tokens.length) {
      const valStr = tokens[i + 2] ?? "";
      const numVal = Number.parseFloat(valStr);
      if (key === "ID") {
        id = Number.isNaN(numVal) ? valStr : numVal;
        hasDoseKeys = true;
      } else if (key === "TIME" || key === "T") {
        if (!Number.isNaN(numVal)) time = numVal;
        hasDoseKeys = true;
      } else if (key === "AMT" || key === "DOSE") {
        if (!Number.isNaN(numVal)) amt = numVal;
        hasDoseKeys = true;
      } else if (key === "RATE") {
        if (!Number.isNaN(numVal)) rate = numVal;
        hasDoseKeys = true;
      } else if (key === "CMT" || key === "COMP") {
        if (!Number.isNaN(numVal)) cmt = Math.trunc(numVal);
        hasDoseKeys = true;
      } else if (key === "EVID") {
        if (!Number.isNaN(numVal)) evid = Math.trunc(numVal);
        hasDoseKeys = true;
      } else if (key === "II") {
        if (!Number.isNaN(numVal)) ii = numVal;
        hasDoseKeys = true;
      } else if (key === "ADDL") {
        if (!Number.isNaN(numVal)) addl = Math.trunc(numVal);
        hasDoseKeys = true;
      } else if (key === "DV") {
        if (!Number.isNaN(numVal)) dv = numVal;
        hasDoseKeys = true;
      } else if (key === "MDV") {
        if (!Number.isNaN(numVal)) mdv = Math.trunc(numVal);
        hasDoseKeys = true;
      }
      i += 2;
    }
  }

  if (!hasDoseKeys) return null;
  return {
    id,
    time,
    amt,
    rate,
    cmt,
    evid,
    ii,
    addl,
    dv,
    mdv,
    range,
  };
}

function parseTabularDosingLine(text: string, inputs: string[], range: NmtranRange): DosingRecord | null {
  const tokens = tokenizeWhitespaceAndPunct(text);
  if (tokens.length === 0 || inputs.length === 0) return null;

  // All tokens must be numeric or '.' (missing value marker in NONMEM)
  for (const tok of tokens) {
    if (tok !== "." && Number.isNaN(Number.parseFloat(tok))) {
      return null;
    }
  }

  let id: string | number | undefined;
  let time = 0;
  let amt = 0;
  let rate = 0;
  let cmt = 1;
  let evid = 1;
  let ii = 0;
  let addl = 0;
  let dv: number | undefined;
  let mdv: number | undefined;

  const count = Math.min(tokens.length, inputs.length);
  for (let i = 0; i < count; i++) {
    const col = (inputs[i] ?? "").toUpperCase();
    const raw = tokens[i] ?? ".";
    if (raw === ".") continue;
    const val = Number.parseFloat(raw);
    if (Number.isNaN(val)) continue;

    if (col === "ID") id = val;
    else if (col === "TIME") time = val;
    else if (col === "AMT") amt = val;
    else if (col === "RATE") rate = val;
    else if (col === "CMT") cmt = Math.trunc(val);
    else if (col === "EVID") evid = Math.trunc(val);
    else if (col === "II") ii = val;
    else if (col === "ADDL") addl = Math.trunc(val);
    else if (col === "DV") dv = val;
    else if (col === "MDV") mdv = Math.trunc(val);
  }

  return {
    id,
    time,
    amt,
    rate,
    cmt,
    evid,
    ii,
    addl,
    dv,
    mdv,
    range,
  };
}

export function parseNmtran(source: string, sourceFile?: string): NmtranDocument {
  const lines = splitLines(source);

  const controlStream: NmtranControlStream = {
    problem: "",
    hasProblemRecord: false,
    inputs: [],
    subroutines: {
      advan: "",
      trans: "TRANS1",
    },
    compartments: [],
    pkStatements: [],
    desEquations: [],
    hasDesBlock: false,
    errorStatements: [],
    hasErrorBlock: false,
    thetas: [],
    omegas: [],
    sigmas: [],
    estimations: [],
    dosingRecords: [],
    range: {
      startLine: 1,
      startColumn: 1,
      endLine: Math.max(1, lines.length),
      endColumn: Math.max(1, (lines[lines.length - 1]?.rawText.length ?? 0) + 1),
      startOffset: 0,
      endOffset: source.length,
    },
  };

  let currentSection = "";

  for (const line of lines) {
    const lineRange = makeLineRange(line);

    // Check comment for inline dosing annotation: "; @DOSE ..." or "; DOSE ..."
    if (line.commentText.length > 0) {
      const upperComment = line.commentText.toUpperCase();
      if (upperComment.startsWith("@DOSE") || upperComment.startsWith("DOSE:") || upperComment.startsWith("DOSE ")) {
        let payload = line.commentText;
        if (upperComment.startsWith("@DOSE")) payload = payload.slice(5).trim();
        else if (upperComment.startsWith("DOSE:")) payload = payload.slice(5).trim();
        else payload = payload.slice(4).trim();
        const doseRec = parseKeyValDosingLine(payload, lineRange);
        if (doseRec) {
          controlStream.dosingRecords.push(doseRec);
        }
      }
    }

    let rem = line.codeText.trim();
    if (rem.length === 0) continue;

    // Check if line begins with a $RECORD directive
    if (rem[0] === "$") {
      let i = 1;
      while (i < rem.length && isAlpha(rem[i] ?? "")) {
        i++;
      }
      const rawDirective = rem.slice(1, i);
      currentSection = normalizeRecordType(rawDirective);
      rem = rem.slice(i).trim();

      if (currentSection === "PROBLEM") {
        controlStream.hasProblemRecord = true;
        controlStream.problem = rem;
        controlStream.problemRange = lineRange;
        continue;
      }
      if (currentSection === "DES") {
        controlStream.hasDesBlock = true;
      }
      if (currentSection === "ERROR") {
        controlStream.hasErrorBlock = true;
      }
      if (currentSection === "SUBROUTINES" && controlStream.subroutines.range === undefined) {
        controlStream.subroutines.range = lineRange;
      }
    }

    if (rem.length === 0) continue;

    switch (currentSection) {
      case "PROBLEM": {
        if (controlStream.problem.length === 0) {
          controlStream.problem = rem;
        }
        break;
      }

      case "INPUT": {
        const toks = tokenizeWhitespaceAndPunct(rem);
        for (let i = 0; i < toks.length; i++) {
          const tok = toks[i] ?? "";
          if (tok === "=" || tok === "(" || tok === ")") continue;
          if (toks[i + 1] === "=" && i + 2 < toks.length) {
            const rhs = toks[i + 2] ?? "";
            if (rhs.toUpperCase() !== "DROP" && tok.toUpperCase() !== "DROP") {
              controlStream.inputs.push(tok.toUpperCase());
            }
            i += 2;
          } else if (tok.toUpperCase() !== "DROP") {
            controlStream.inputs.push(tok.toUpperCase());
          }
        }
        break;
      }

      case "DATA": {
        // Check if this line is a tabular data row or key=val dosing row
        const kvDose = parseKeyValDosingLine(rem, lineRange);
        if (kvDose) {
          controlStream.dosingRecords.push(kvDose);
          break;
        }
        const firstCh = rem[0] ?? "";
        if (controlStream.dataFile !== undefined && (isDigit(firstCh) || firstCh === ".")) {
          const tabDose = parseTabularDosingLine(rem, controlStream.inputs, lineRange);
          if (tabDose) {
            controlStream.dosingRecords.push(tabDose);
            break;
          }
        }

        const toks = tokenizeWhitespaceAndPunct(rem);
        for (let i = 0; i < toks.length; i++) {
          const tok = toks[i] ?? "";
          const up = tok.toUpperCase();
          if (up === "IGNORE" || up === "IGN") {
            if (toks[i + 1] === "=" && i + 2 < toks.length) {
              controlStream.ignoreChars = controlStream.ignoreChars ?? [];
              controlStream.ignoreChars.push(toks[i + 2] ?? "");
              i += 2;
            } else if (toks[i + 1] === "(" && i + 3 < toks.length) {
              controlStream.ignoreChars = controlStream.ignoreChars ?? [];
              controlStream.ignoreChars.push(toks[i + 2] ?? "");
              i += 3;
            }
          } else if (controlStream.dataFile === undefined && tok !== "=" && tok !== "(" && tok !== ")") {
            controlStream.dataFile = tok;
          }
        }
        break;
      }

      case "SUBROUTINES": {
        const toks = tokenizeWhitespaceAndPunct(rem);
        for (let i = 0; i < toks.length; i++) {
          const tok = (toks[i] ?? "").toUpperCase();
          if (tok === "=" || tok === "(" || tok === ")") continue;
          if (tok.startsWith("ADVAN") && tok.length > 5) {
            controlStream.subroutines.advan = tok;
          } else if (tok === "ADVAN" && toks[i + 1] === "=" && i + 2 < toks.length) {
            const val = (toks[i + 2] ?? "").toUpperCase();
            controlStream.subroutines.advan = val.startsWith("ADVAN") ? val : `ADVAN${val}`;
            i += 2;
          } else if (tok.startsWith("TRANS") && tok.length > 5) {
            controlStream.subroutines.trans = tok;
          } else if (tok === "TRANS" && toks[i + 1] === "=" && i + 2 < toks.length) {
            const val = (toks[i + 2] ?? "").toUpperCase();
            controlStream.subroutines.trans = val.startsWith("TRANS") ? val : `TRANS${val}`;
            i += 2;
          } else if (tok === "TOL") {
            const nextIdx = toks[i + 1] === "=" ? i + 2 : i + 1;
            const tolVal = Number.parseInt(toks[nextIdx] ?? "", 10);
            if (!Number.isNaN(tolVal)) {
              controlStream.subroutines.tol = tolVal;
              i = nextIdx;
            }
          } else {
            controlStream.subroutines.other = controlStream.subroutines.other ?? [];
            controlStream.subroutines.other.push(tok);
          }
        }
        break;
      }

      case "MODEL": {
        parseModelLine(rem, controlStream, lineRange);
        break;
      }

      case "PK": {
        const assign = parseAssignmentLine(rem);
        if (assign) {
          const stmt: PkStatement = {
            lhs: assign.lhs.toUpperCase(),
            rhs: assign.rhs,
            thetaRefs: extractIndexedReferences(assign.rhs, "THETA"),
            etaRefs: extractIndexedReferences(assign.rhs, "ETA"),
            range: lineRange,
          };
          controlStream.pkStatements.push(stmt);
        }
        break;
      }

      case "DES": {
        const assign = parseAssignmentLine(rem);
        if (assign) {
          const dadtRefs = extractIndexedReferences(assign.lhs, "DADT");
          const isDeriv = dadtRefs.length > 0 && assign.lhs.toUpperCase().startsWith("DADT");
          const cmtIdx = isDeriv ? (dadtRefs[0] ?? 0) : 0;

          const rhsA = extractIndexedReferences(assign.rhs, "A");
          const rhsDadt = extractIndexedReferences(assign.rhs, "DADT");
          const cmtRefs: number[] = [];
          if (isDeriv && cmtIdx !== 0) cmtRefs.push(cmtIdx);
          for (const r of rhsA) {
            if (!cmtRefs.includes(r)) cmtRefs.push(r);
          }
          for (const r of rhsDadt) {
            if (!cmtRefs.includes(r)) cmtRefs.push(r);
          }

          const eq: DesEquation = {
            compartmentIndex: cmtIdx,
            lhs: isDeriv ? `DADT(${cmtIdx})` : assign.lhs.toUpperCase(),
            rhs: assign.rhs,
            isDerivative: isDeriv,
            thetaRefs: extractIndexedReferences(assign.rhs, "THETA"),
            etaRefs: extractIndexedReferences(assign.rhs, "ETA"),
            compartmentRefs: cmtRefs,
            range: lineRange,
          };
          controlStream.desEquations.push(eq);
        }
        break;
      }

      case "ERROR": {
        const assign = parseAssignmentLine(rem);
        if (assign) {
          const epsRefs = extractIndexedReferences(assign.rhs, "EPS");
          const errRefs = extractIndexedReferences(assign.rhs, "ERR");
          for (const r of errRefs) {
            if (!epsRefs.includes(r)) epsRefs.push(r);
          }
          const st: ErrorStatement = {
            lhs: assign.lhs.toUpperCase(),
            rhs: assign.rhs,
            thetaRefs: extractIndexedReferences(assign.rhs, "THETA"),
            etaRefs: extractIndexedReferences(assign.rhs, "ETA"),
            epsRefs,
            compartmentRefs: extractIndexedReferences(assign.rhs, "A"),
            range: lineRange,
          };
          controlStream.errorStatements.push(st);
        }
        break;
      }

      case "THETA": {
        parseThetaLine(rem, line.commentText, controlStream, lineRange);
        break;
      }

      case "OMEGA": {
        parseOmegaLine(rem, line.commentText, controlStream, lineRange);
        break;
      }

      case "SIGMA": {
        parseSigmaLine(rem, line.commentText, controlStream, lineRange);
        break;
      }

      case "ESTIMATION": {
        parseEstimationLine(rem, controlStream, lineRange);
        break;
      }

      case "SIMULATION": {
        parseSimulationLine(rem, controlStream, lineRange);
        break;
      }

      case "DOSE": {
        const kv = parseKeyValDosingLine(rem, lineRange);
        if (kv) {
          controlStream.dosingRecords.push(kv);
        } else {
          const tab = parseTabularDosingLine(rem, controlStream.inputs, lineRange);
          if (tab) controlStream.dosingRecords.push(tab);
        }
        break;
      }

      default:
        break;
    }
  }

  if (controlStream.nCompartments === undefined && controlStream.compartments.length > 0) {
    controlStream.nCompartments = controlStream.compartments.length;
  }

  return {
    controlStream,
    sourceFile,
  };
}

function parseModelLine(rem: string, cs: NmtranControlStream, range: NmtranRange): void {
  const n = rem.length;
  let i = 0;

  while (i < n) {
    while (i < n && (isWhitespace(rem[i] ?? "") || rem[i] === ",")) i++;
    if (i >= n) break;

    let key = "";
    while (i < n && isAlphaNum(rem[i] ?? "")) {
      key += rem[i];
      i++;
    }
    const upKey = key.toUpperCase();
    while (i < n && isHorizontalSpace(rem[i] ?? "")) i++;

    if (upKey === "NCOMPARTMENTS" || upKey === "NCMT" || upKey === "NCOMP" || upKey === "NCOMPS") {
      if (rem[i] === "=") i++;
      while (i < n && (isHorizontalSpace(rem[i] ?? "") || rem[i] === "(")) i++;
      let numStr = "";
      while (i < n && isDigit(rem[i] ?? "")) {
        numStr += rem[i];
        i++;
      }
      if (rem[i] === ")") i++;
      const val = Number.parseInt(numStr, 10);
      if (!Number.isNaN(val)) {
        cs.nCompartments = val;
      }
      continue;
    }

    if (upKey === "COMP" || upKey === "COMPARTMENT") {
      if (rem[i] === "=") i++;
      while (i < n && isHorizontalSpace(rem[i] ?? "")) i++;

      let compContent = "";
      if (rem[i] === "(") {
        i++;
        const start = i;
        while (i < n && rem[i] !== ")") i++;
        compContent = rem.slice(start, i);
        if (rem[i] === ")") i++;
      } else {
        const start = i;
        while (i < n && !isWhitespace(rem[i] ?? "") && rem[i] !== ",") i++;
        compContent = rem.slice(start, i);
      }

      const compTokens = tokenizeWhitespaceAndPunct(compContent);
      const cmtIdx = cs.compartments.length + 1;
      let name = `COMP${cmtIdx}`;
      let nameSet = false;
      let defDose = false;
      let defObs = false;
      let initialOff: boolean | undefined;
      let noOff: boolean | undefined;

      for (const ct of compTokens) {
        const upCt = ct.toUpperCase();
        if (upCt === "DEFDOSE") defDose = true;
        else if (upCt === "DEFOBS") defObs = true;
        else if (upCt === "INITIALOFF") initialOff = true;
        else if (upCt === "NOOFF") noOff = true;
        else if (!nameSet) {
          name = ct;
          nameSet = true;
        }
      }

      const compDef: CompartmentDef = {
        index: cmtIdx,
        name,
        defDose,
        defObs,
        initialOff,
        noOff,
        range,
      };
      cs.compartments.push(compDef);
      continue;
    }

    // Advance if nothing matched
    i++;
  }
}

function extractCommentLabelAndUnits(comment: string): { name?: string | undefined; units?: string | undefined } {
  const trimmed = comment.trim();
  if (trimmed.length === 0) return {};

  const openParen = trimmed.indexOf("(");
  const closeParen = trimmed.indexOf(")", openParen + 1);
  if (openParen > 0 && closeParen > openParen) {
    const namePart = trimmed.slice(0, openParen).trim();
    const unitsPart = trimmed.slice(openParen + 1, closeParen).trim();
    return {
      name: namePart.length > 0 ? namePart : undefined,
      units: unitsPart.length > 0 ? unitsPart : undefined,
    };
  }
  // Take first identifier word
  let i = 0;
  while (i < trimmed.length && isIdentChar(trimmed[i] ?? "")) i++;
  const word = trimmed.slice(0, i).trim();
  return { name: word.length > 0 ? word : trimmed };
}

function parseThetaLine(rem: string, comment: string, cs: NmtranControlStream, range: NmtranRange): void {
  const n = rem.length;
  let i = 0;
  const addedOnLine: ThetaSpec[] = [];

  while (i < n) {
    while (i < n && (isWhitespace(rem[i] ?? "") || rem[i] === ",")) i++;
    if (i >= n) break;

    if (rem[i] === "(") {
      i++; // skip '('
      const start = i;
      while (i < n && rem[i] !== ")") i++;
      const inside = rem.slice(start, i);
      if (rem[i] === ")") i++;

      const toks = tokenizeWhitespaceAndPunct(inside);
      const nums: number[] = [];
      let fixed = false;
      for (const t of toks) {
        const up = t.toUpperCase();
        if (up === "FIX" || up === "FIXED") {
          fixed = true;
        } else {
          const val = parseBoundValue(t);
          if (!Number.isNaN(val)) {
            nums.push(val);
          }
        }
      }

      // Check if FIX / FIXED immediately follows ')'
      let lookahead = i;
      while (lookahead < n && isHorizontalSpace(rem[lookahead] ?? "")) lookahead++;
      let nextWord = "";
      let p = lookahead;
      while (p < n && isAlpha(rem[p] ?? "")) {
        nextWord += rem[p];
        p++;
      }
      if (nextWord.toUpperCase() === "FIX" || nextWord.toUpperCase() === "FIXED") {
        fixed = true;
        i = p;
      }

      if (nums.length > 0) {
        const idx = cs.thetas.length + 1;
        let lower: number | undefined;
        let init = 0;
        let upper: number | undefined;

        if (nums.length === 1) {
          init = nums[0] ?? 0;
        } else if (nums.length === 2) {
          lower = nums[0];
          init = nums[1] ?? 0;
          upper = Number.POSITIVE_INFINITY;
        } else {
          lower = nums[0];
          init = nums[1] ?? 0;
          upper = nums[2];
        }

        const spec: ThetaSpec = {
          index: idx,
          lower,
          init,
          upper,
          fixed,
          range,
        };
        cs.thetas.push(spec);
        addedOnLine.push(spec);
      }
      continue;
    }

    // Scalar token outside parentheses
    let tok = "";
    while (i < n && !isWhitespace(rem[i] ?? "") && rem[i] !== "," && rem[i] !== "(" && rem[i] !== ")") {
      tok += rem[i];
      i++;
    }
    const upTok = tok.toUpperCase();
    if (upTok === "FIX" || upTok === "FIXED") {
      const prev = cs.thetas[cs.thetas.length - 1];
      if (prev) prev.fixed = true;
      continue;
    }

    const numVal = parseBoundValue(tok);
    if (!Number.isNaN(numVal)) {
      let fixed = false;
      let lookahead = i;
      while (lookahead < n && isHorizontalSpace(rem[lookahead] ?? "")) lookahead++;
      let nextWord = "";
      let p = lookahead;
      while (p < n && isAlpha(rem[p] ?? "")) {
        nextWord += rem[p];
        p++;
      }
      if (nextWord.toUpperCase() === "FIX" || nextWord.toUpperCase() === "FIXED") {
        fixed = true;
        i = p;
      }

      const spec: ThetaSpec = {
        index: cs.thetas.length + 1,
        init: numVal,
        fixed,
        range,
      };
      cs.thetas.push(spec);
      addedOnLine.push(spec);
    }
  }

  if (addedOnLine.length === 1 && comment.length > 0) {
    const meta = extractCommentLabelAndUnits(comment);
    const first = addedOnLine[0];
    if (first) {
      if (meta.name !== undefined) first.name = meta.name;
      if (meta.units !== undefined) first.units = meta.units;
    }
  }
}

function parseOmegaLine(rem: string, comment: string, cs: NmtranControlStream, range: NmtranRange): void {
  const toks = tokenizeWhitespaceAndPunct(rem);
  const addedOnLine: OmegaSpec[] = [];
  let i = 0;

  while (i < toks.length) {
    const tok = (toks[i] ?? "").toUpperCase();
    if (tok === "(" || tok === ")" || tok === "=") {
      i++;
      continue;
    }

    if (tok === "DIAGONAL") {
      if (toks[i + 1] === "(" && i + 3 < toks.length && toks[i + 3] === ")") {
        i += 4;
      } else {
        i++;
      }
      continue;
    }

    if (tok === "BLOCK") {
      let blockSize = 1;
      if (toks[i + 1] === "(" && i + 3 < toks.length && toks[i + 3] === ")") {
        blockSize = Math.max(1, Number.parseInt(toks[i + 2] ?? "1", 10) || 1);
        i += 4;
      } else {
        i++;
      }

      // Check for SAME
      if ((toks[i] ?? "").toUpperCase() === "SAME") {
        i++;
        const startCopyIdx = Math.max(0, cs.omegas.length - blockSize);
        for (let b = 0; b < blockSize; b++) {
          const template = cs.omegas[startCopyIdx + b];
          const spec: OmegaSpec = {
            index: cs.omegas.length + 1,
            variance: template?.variance ?? 0.04,
            fixed: template?.fixed ?? false,
            blockSize,
            same: true,
            range,
          };
          cs.omegas.push(spec);
          addedOnLine.push(spec);
        }
        continue;
      }

      // Lower triangular matrix has blockSize * (blockSize + 1) / 2 numbers
      const expectedNums = (blockSize * (blockSize + 1)) / 2;
      const vals: number[] = [];
      let fixed = false;
      while (i < toks.length && vals.length < expectedNums) {
        const t = (toks[i] ?? "").toUpperCase();
        if (t === "(" || t === ")") {
          i++;
          continue;
        }
        if (t === "FIX" || t === "FIXED") {
          fixed = true;
          i++;
          continue;
        }
        const v = Number.parseFloat(t);
        if (!Number.isNaN(v)) {
          vals.push(v);
          i++;
        } else {
          break;
        }
      }
      if (i < toks.length) {
        const nextUp = (toks[i] ?? "").toUpperCase();
        if (nextUp === "FIX" || nextUp === "FIXED") {
          fixed = true;
          i++;
        }
      }

      let pos = 0;
      for (let row = 1; row <= blockSize; row++) {
        const rowCovs: number[] = [];
        for (let col = 1; col <= row; col++) {
          rowCovs.push(vals[pos++] ?? 0);
        }
        const diagVar = rowCovs[rowCovs.length - 1] ?? 0;
        const spec: OmegaSpec = {
          index: cs.omegas.length + 1,
          variance: diagVar,
          fixed,
          blockSize,
          covariances: rowCovs,
          range,
        };
        cs.omegas.push(spec);
        addedOnLine.push(spec);
      }
      continue;
    }

    if (tok === "FIX" || tok === "FIXED") {
      const prev = cs.omegas[cs.omegas.length - 1];
      if (prev) prev.fixed = true;
      i++;
      continue;
    }

    const numVal = Number.parseFloat(tok);
    if (!Number.isNaN(numVal)) {
      let fixed = false;
      let nextIdx = i + 1;
      while (nextIdx < toks.length && toks[nextIdx] === ")") nextIdx++;
      const nextTok = (toks[nextIdx] ?? "").toUpperCase();
      if (nextTok === "FIX" || nextTok === "FIXED") {
        fixed = true;
        i = nextIdx + 1;
      } else {
        i++;
      }

      const spec: OmegaSpec = {
        index: cs.omegas.length + 1,
        variance: numVal,
        fixed,
        range,
      };
      cs.omegas.push(spec);
      addedOnLine.push(spec);
      continue;
    }

    i++;
  }

  if (addedOnLine.length === 1 && comment.length > 0) {
    const meta = extractCommentLabelAndUnits(comment);
    const first = addedOnLine[0];
    if (first && meta.name !== undefined) {
      first.name = meta.name;
    }
  }
}

function parseSigmaLine(rem: string, comment: string, cs: NmtranControlStream, range: NmtranRange): void {
  const toks = tokenizeWhitespaceAndPunct(rem);
  const addedOnLine: SigmaSpec[] = [];
  let i = 0;

  while (i < toks.length) {
    const tok = (toks[i] ?? "").toUpperCase();
    if (tok === "(" || tok === ")" || tok === "=" || tok === "DIAGONAL") {
      i++;
      continue;
    }
    if (tok === "FIX" || tok === "FIXED") {
      const prev = cs.sigmas[cs.sigmas.length - 1];
      if (prev) prev.fixed = true;
      i++;
      continue;
    }
    const numVal = Number.parseFloat(tok);
    if (!Number.isNaN(numVal)) {
      let fixed = false;
      let nextIdx = i + 1;
      while (nextIdx < toks.length && toks[nextIdx] === ")") nextIdx++;
      const nextTok = (toks[nextIdx] ?? "").toUpperCase();
      if (nextTok === "FIX" || nextTok === "FIXED") {
        fixed = true;
        i = nextIdx + 1;
      } else {
        i++;
      }
      const spec: SigmaSpec = {
        index: cs.sigmas.length + 1,
        variance: numVal,
        fixed,
        range,
      };
      cs.sigmas.push(spec);
      addedOnLine.push(spec);
      continue;
    }
    i++;
  }

  if (addedOnLine.length === 1 && comment.length > 0) {
    const meta = extractCommentLabelAndUnits(comment);
    const first = addedOnLine[0];
    if (first && meta.name !== undefined) {
      first.name = meta.name;
    }
  }
}

function parseEstimationLine(rem: string, cs: NmtranControlStream, range: NmtranRange): void {
  const toks = tokenizeWhitespaceAndPunct(rem);
  let est = cs.estimations[cs.estimations.length - 1];
  if (!est) {
    est = {
      method: "1",
      interaction: false,
      range,
    };
    cs.estimations.push(est);
  }

  for (let i = 0; i < toks.length; i++) {
    const tok = (toks[i] ?? "").toUpperCase();
    if (tok === "METHOD" || tok === "METH") {
      if (toks[i + 1] === "=" && i + 2 < toks.length) {
        est.method = (toks[i + 2] ?? "1").toUpperCase();
        i += 2;
      }
    } else if (tok === "INTERACTION" || tok === "INTER") {
      est.interaction = true;
    } else if (tok === "MAXEVAL" || tok === "MAXEVALS" || tok === "MAX") {
      if (toks[i + 1] === "=" && i + 2 < toks.length) {
        const v = Number.parseInt(toks[i + 2] ?? "", 10);
        if (!Number.isNaN(v)) est.maxEval = v;
        i += 2;
      }
    } else if (tok === "SIGDIGITS" || tok === "SIG" || tok === "NSIG") {
      if (toks[i + 1] === "=" && i + 2 < toks.length) {
        const v = Number.parseInt(toks[i + 2] ?? "", 10);
        if (!Number.isNaN(v)) est.sigDigits = v;
        i += 2;
      }
    } else if (tok === "PRINT") {
      if (toks[i + 1] === "=" && i + 2 < toks.length) {
        const v = Number.parseInt(toks[i + 2] ?? "", 10);
        if (!Number.isNaN(v)) est.print = v;
        i += 2;
      }
    } else if (tok === "NOABORT" || tok === "NOhabort") {
      est.noAbort = true;
    } else if (tok === "POSTHOC") {
      est.posthoc = true;
    }
  }
}

function parseSimulationLine(rem: string, cs: NmtranControlStream, range: NmtranRange): void {
  const toks = tokenizeWhitespaceAndPunct(rem);
  const sim: NmtranSimulationSpec = cs.simulation ?? {
    seed: 12345,
    subProblems: 1,
    onlySimulation: false,
    range,
  };

  for (let i = 0; i < toks.length; i++) {
    const tok = (toks[i] ?? "").toUpperCase();
    if (tok === "(" && i + 1 < toks.length) {
      const seedVal = Number.parseInt(toks[i + 1] ?? "", 10);
      if (!Number.isNaN(seedVal)) sim.seed = seedVal;
    } else if (tok === "SUBPROBLEMS" || tok === "NSUB" || tok === "NSUBPROBLEMS") {
      if (toks[i + 1] === "=" && i + 2 < toks.length) {
        const nsub = Number.parseInt(toks[i + 2] ?? "", 10);
        if (!Number.isNaN(nsub)) sim.subProblems = nsub;
        i += 2;
      }
    } else if (tok === "ONLYSIMULATION" || tok === "ONLYSIM") {
      sim.onlySimulation = true;
    }
  }

  cs.simulation = sim;
}

/**
 * Serializes an `NmtranDocument` AST back into a canonical NONMEM / NMTRAN control stream.
 */
export function serializeNmtran(doc: NmtranDocument): string {
  const cs = doc.controlStream;
  const lines: string[] = [];

  if (cs.hasProblemRecord || cs.problem.length > 0) {
    lines.push(`$PROBLEM ${cs.problem}`);
  }

  if (cs.inputs.length > 0) {
    lines.push(`$INPUT ${cs.inputs.join(" ")}`);
  }

  if (cs.dataFile) {
    const ign =
      cs.ignoreChars && cs.ignoreChars.length > 0 ? " " + cs.ignoreChars.map((c) => `IGNORE=${c}`).join(" ") : "";
    lines.push(`$DATA ${cs.dataFile}${ign}`);
  }

  if (cs.subroutines.advan) {
    const parts = [cs.subroutines.advan, cs.subroutines.trans];
    if (cs.subroutines.tol !== undefined) {
      parts.push(`TOL=${cs.subroutines.tol}`);
    }
    lines.push(`$SUBROUTINES ${parts.join(" ")}`);
  }

  if (cs.compartments.length > 0 || cs.nCompartments !== undefined) {
    const modParts: string[] = [];
    if (cs.nCompartments !== undefined) {
      modParts.push(`NCOMPARTMENTS=${cs.nCompartments}`);
    }
    for (const c of cs.compartments) {
      const attrs = [c.name];
      if (c.defDose) attrs.push("DEFDOSE");
      if (c.defObs) attrs.push("DEFOBS");
      if (c.initialOff) attrs.push("INITIALOFF");
      if (c.noOff) attrs.push("NOOFF");
      modParts.push(`COMP=(${attrs.join(" ")})`);
    }
    lines.push(`$MODEL ${modParts.join(" ")}`);
  }

  if (cs.pkStatements.length > 0) {
    lines.push(`$PK`);
    for (const st of cs.pkStatements) {
      lines.push(`  ${st.lhs} = ${st.rhs}`);
    }
  }

  if (cs.hasDesBlock || cs.desEquations.length > 0) {
    lines.push(`$DES`);
    for (const eq of cs.desEquations) {
      lines.push(`  ${eq.lhs} = ${eq.rhs}`);
    }
  }

  if (cs.hasErrorBlock || cs.errorStatements.length > 0) {
    lines.push(`$ERROR`);
    for (const st of cs.errorStatements) {
      lines.push(`  ${st.lhs} = ${st.rhs}`);
    }
  }

  if (cs.thetas.length > 0) {
    lines.push(`$THETA`);
    for (const th of cs.thetas) {
      const fixStr = th.fixed ? " FIX" : "";
      const commentStr = th.name ? ` ; ${th.name}${th.units ? ` (${th.units})` : ""}` : "";
      if (th.lower !== undefined && th.upper !== undefined) {
        const lowStr = Number.isFinite(th.lower) ? String(th.lower) : "-INF";
        const upStr = Number.isFinite(th.upper) ? String(th.upper) : "INF";
        lines.push(`  (${lowStr}, ${th.init}, ${upStr})${fixStr}${commentStr}`);
      } else if (th.lower !== undefined) {
        const lowStr = Number.isFinite(th.lower) ? String(th.lower) : "-INF";
        lines.push(`  (${lowStr}, ${th.init})${fixStr}${commentStr}`);
      } else {
        lines.push(`  ${th.init}${fixStr}${commentStr}`);
      }
    }
  }

  if (cs.omegas.length > 0) {
    lines.push(`$OMEGA`);
    for (const om of cs.omegas) {
      const fixStr = om.fixed ? " FIX" : "";
      const commentStr = om.name ? ` ; ${om.name}` : "";
      lines.push(`  ${om.variance}${fixStr}${commentStr}`);
    }
  }

  if (cs.sigmas.length > 0) {
    lines.push(`$SIGMA`);
    for (const sg of cs.sigmas) {
      const fixStr = sg.fixed ? " FIX" : "";
      const commentStr = sg.name ? ` ; ${sg.name}` : "";
      lines.push(`  ${sg.variance}${fixStr}${commentStr}`);
    }
  }

  for (const est of cs.estimations) {
    const parts = [`METHOD=${est.method}`];
    if (est.interaction) parts.push("INTERACTION");
    if (est.maxEval !== undefined) parts.push(`MAXEVAL=${est.maxEval}`);
    if (est.sigDigits !== undefined) parts.push(`SIGDIGITS=${est.sigDigits}`);
    if (est.print !== undefined) parts.push(`PRINT=${est.print}`);
    if (est.noAbort) parts.push("NOABORT");
    if (est.posthoc) parts.push("POSTHOC");
    lines.push(`$ESTIMATION ${parts.join(" ")}`);
  }

  if (cs.simulation) {
    const parts = [`(${cs.simulation.seed})`, `SUBPROBLEMS=${cs.simulation.subProblems}`];
    if (cs.simulation.onlySimulation) parts.push("ONLYSIMULATION");
    lines.push(`$SIMULATION ${parts.join(" ")}`);
  }

  if (cs.dosingRecords.length > 0) {
    lines.push(`$DOSE`);
    for (const d of cs.dosingRecords) {
      const parts = [
        `TIME=${d.time}`,
        `AMT=${d.amt}`,
        `RATE=${d.rate}`,
        `CMT=${d.cmt}`,
        `EVID=${d.evid}`,
        `II=${d.ii}`,
        `ADDL=${d.addl}`,
      ];
      lines.push(`  ${parts.join(" ")}`);
    }
  }

  return lines.join("\n") + "\n";
}

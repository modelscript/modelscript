// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Line-and-offset-tracking parser for Gaussian Input (.gjf / .com) files,
 * supporting Link0 commands, Route sections, Title, Charge/Multiplicity,
 * Cartesian & Z-matrix coordinates (including dummy atoms X), Variables/Constants
 * blocks, `--Link1--` multi-step jobs, and `!` comments.
 */

import { lookupElement } from "../elements.js";
import type {
  GaussianAtomSpec,
  GaussianComment,
  GaussianInputDocument,
  GaussianJobStep,
  GaussianLink0Command,
  GaussianParseError,
  GaussianPrintLevel,
  GaussianRouteKeyword,
  GaussianRouteSection,
  GaussianValueRef,
  GaussianVariableEntry,
} from "../types.js";

interface IndexedLine {
  lineNumber: number; // 1-based
  raw: string;
  startOffset: number;
  endOffset: number;
}

function splitLinesWithOffsets(text: string): IndexedLine[] {
  const lines: IndexedLine[] = [];
  let offset = 0;
  let lineNumber = 1;
  const n = text.length;
  while (offset <= n) {
    let nl = text.indexOf("\n", offset);
    if (nl === -1) nl = n;
    let end = nl;
    if (end > offset && text.charCodeAt(end - 1) === 13) {
      end--;
    }
    lines.push({
      lineNumber,
      raw: text.slice(offset, end),
      startOffset: offset,
      endOffset: end,
    });
    if (nl === n) break;
    offset = nl + 1;
    lineNumber++;
  }
  return lines;
}

function stripInlineComment(line: IndexedLine, comments: GaussianComment[]): string {
  const bangIdx = line.raw.indexOf("!");
  if (bangIdx === -1) return line.raw;
  comments.push({
    text: line.raw.slice(bangIdx + 1).trim(),
    line: line.lineNumber,
    startOffset: line.startOffset + bangIdx,
    endOffset: line.endOffset,
  });
  return line.raw.slice(0, bangIdx);
}

/**
 * Tokenizes a route section string respecting balanced parentheses, e.g.
 * `B3LYP/6-31G(d) opt=(tight,calcfc) freq scrf=(pcm,solvent=water)`.
 */
function tokenizeRoute(body: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === "(") {
      depth++;
      current += ch;
    } else if (ch === ")") {
      if (depth > 0) depth--;
      current += ch;
    } else if ((ch === " " || ch === "\t" || ch === "\r" || ch === "\n") && depth === 0) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function parseRouteKeyword(token: string): GaussianRouteKeyword {
  const eqIdx = token.indexOf("=");
  const parenIdx = token.indexOf("(");

  if (eqIdx !== -1 && (parenIdx === -1 || eqIdx < parenIdx)) {
    const name = token.slice(0, eqIdx).trim();
    let rhs = token.slice(eqIdx + 1).trim();
    if (rhs.startsWith("(") && rhs.endsWith(")")) {
      rhs = rhs.slice(1, -1);
    }
    const options = rhs
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return { name, options, raw: token };
  }

  if (parenIdx !== -1 && token.endsWith(")")) {
    const name = token.slice(0, parenIdx).trim();
    const inner = token.slice(parenIdx + 1, -1);
    const options = inner
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return { name, options, raw: token };
  }

  return { name: token, options: [], raw: token };
}

function parseRouteSection(routeLines: IndexedLine[], strippedTexts: string[]): GaussianRouteSection {
  const first = routeLines[0]!;
  const last = routeLines[routeLines.length - 1]!;
  const raw = strippedTexts.map((s) => s.trim()).join(" ");

  let printLevel: GaussianPrintLevel = "normal";
  let body = raw;
  const headerMatch = /^#([pPnNtT]?)(?:\s+(.*))?$/.exec(raw);
  if (headerMatch) {
    const flag = (headerMatch[1] ?? "").toLowerCase();
    if (flag === "p") printLevel = "verbose";
    else if (flag === "t") printLevel = "terse";
    else printLevel = "normal";
    body = (headerMatch[2] ?? "").trim();
  } else if (raw.startsWith("#")) {
    body = raw.slice(1).trim();
  }

  const tokens = tokenizeRoute(body);
  let method: string | undefined;
  let basisSet: string | undefined;
  const keywords: GaussianRouteKeyword[] = [];

  for (const tok of tokens) {
    // Method/Basis token: contains '/' outside '=' and not starting with '='
    const slashIdx = tok.indexOf("/");
    const eqIdx = tok.indexOf("=");
    if (slashIdx > 0 && (eqIdx === -1 || slashIdx < eqIdx) && !method) {
      method = tok.slice(0, slashIdx).trim();
      basisSet = tok.slice(slashIdx + 1).trim();
      continue;
    }
    keywords.push(parseRouteKeyword(tok));
  }

  return {
    printLevel,
    method,
    basisSet,
    keywords,
    raw,
    line: first.lineNumber,
    startOffset: first.startOffset,
    endOffset: last.endOffset,
  };
}

function parseValueRef(token: string): GaussianValueRef {
  const trimmed = token.trim();
  // Support Fortran D-exponent syntax (e.g. 1.0D-05)
  const normalized = trimmed.replace(/[dD]([+-]?\d+)$/, "e$1");
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) {
    return {
      kind: "number",
      value: Number(normalized),
      raw: trimmed,
    };
  }
  const negated = trimmed.startsWith("-");
  const varName = negated || trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
  return {
    kind: "variable",
    variableName: varName,
    negated,
    raw: trimmed,
  };
}

function isIntegerToken(tok: string): boolean {
  return /^[+-]?\d+$/.test(tok);
}

function isNumericToken(tok: string): boolean {
  const normalized = tok.replace(/[dD]([+-]?\d+)$/, "e$1");
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized);
}

/**
 * Resolves a numeric or symbolic `GaussianValueRef` against variable & constant maps.
 */
export function resolveValueRef(
  ref: GaussianValueRef | undefined,
  variables: Map<string, GaussianVariableEntry>,
  constants: Map<string, GaussianVariableEntry>,
): number | undefined {
  if (!ref) return undefined;
  if (ref.kind === "number") return ref.value;
  if (!ref.variableName) return undefined;
  const key = ref.variableName.toLowerCase();
  const entry = variables.get(key) ?? constants.get(key);
  if (!entry) return undefined;
  return ref.negated ? -entry.value : entry.value;
}

function parseAtomLine(
  line: IndexedLine,
  cleaned: string,
  atomIndex: number,
  parseErrors: GaussianParseError[],
): GaussianAtomSpec | null {
  const tokens = cleaned
    .trim()
    .split(/[\s,]+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;

  const elementRaw = tokens[0]!;
  const elData = lookupElement(elementRaw);
  const element = elData ? elData.symbol : elementRaw;
  const atomicNumber = elData ? elData.atomicNumber : -1;
  const isDummy = Boolean(elData?.isDummy);

  // Atom 1 of a Z-matrix: single element token
  if (tokens.length === 1) {
    return {
      index: atomIndex,
      kind: "zmatrix",
      element,
      atomicNumber,
      isDummy,
      raw: cleaned.trim(),
      line: line.lineNumber,
      startOffset: line.startOffset,
      endOffset: line.endOffset,
    };
  }

  // Z-matrix atom 2: Element r_ref r_val
  if (tokens.length === 3 && isIntegerToken(tokens[1]!)) {
    return {
      index: atomIndex,
      kind: "zmatrix",
      element,
      atomicNumber,
      isDummy,
      bondRef: Number.parseInt(tokens[1]!, 10),
      bondLength: parseValueRef(tokens[2]!),
      raw: cleaned.trim(),
      line: line.lineNumber,
      startOffset: line.startOffset,
      endOffset: line.endOffset,
    };
  }

  // Cartesian: Element X Y Z
  if (tokens.length === 4) {
    return {
      index: atomIndex,
      kind: "cartesian",
      element,
      atomicNumber,
      isDummy,
      x: parseValueRef(tokens[1]!),
      y: parseValueRef(tokens[2]!),
      z: parseValueRef(tokens[3]!),
      raw: cleaned.trim(),
      line: line.lineNumber,
      startOffset: line.startOffset,
      endOffset: line.endOffset,
    };
  }

  // 5 tokens: either Cartesian with freeze flag (Element freeze X Y Z) or Z-matrix atom 3 (Element r_ref r_val a_ref a_val)
  if (tokens.length === 5) {
    const t1 = tokens[1]!;
    const t3 = tokens[3]!;
    const t1Int = isIntegerToken(t1) ? Number.parseInt(t1, 10) : NaN;
    const isFreezeCartesian =
      (t1Int === 0 || t1Int === -1) &&
      isNumericToken(tokens[2]!) &&
      isNumericToken(tokens[3]!) &&
      isNumericToken(tokens[4]!);

    if (isFreezeCartesian) {
      return {
        index: atomIndex,
        kind: "cartesian",
        element,
        atomicNumber,
        isDummy,
        freezeFlag: t1Int,
        x: parseValueRef(tokens[2]!),
        y: parseValueRef(tokens[3]!),
        z: parseValueRef(tokens[4]!),
        raw: cleaned.trim(),
        line: line.lineNumber,
        startOffset: line.startOffset,
        endOffset: line.endOffset,
      };
    }

    if (isIntegerToken(t1) && isIntegerToken(t3)) {
      return {
        index: atomIndex,
        kind: "zmatrix",
        element,
        atomicNumber,
        isDummy,
        bondRef: t1Int,
        bondLength: parseValueRef(tokens[2]!),
        angleRef: Number.parseInt(t3, 10),
        bondAngle: parseValueRef(tokens[4]!),
        raw: cleaned.trim(),
        line: line.lineNumber,
        startOffset: line.startOffset,
        endOffset: line.endOffset,
      };
    }
  }

  // Z-matrix atom >= 4: Element r_ref r_val a_ref a_val d_ref d_val [fmt]
  if (
    (tokens.length === 7 || tokens.length === 8) &&
    isIntegerToken(tokens[1]!) &&
    isIntegerToken(tokens[3]!) &&
    isIntegerToken(tokens[5]!)
  ) {
    const fmt = tokens.length === 8 && isIntegerToken(tokens[7]!) ? Number.parseInt(tokens[7]!, 10) : undefined;
    return {
      index: atomIndex,
      kind: "zmatrix",
      element,
      atomicNumber,
      isDummy,
      bondRef: Number.parseInt(tokens[1]!, 10),
      bondLength: parseValueRef(tokens[2]!),
      angleRef: Number.parseInt(tokens[3]!, 10),
      bondAngle: parseValueRef(tokens[4]!),
      dihedralRef: Number.parseInt(tokens[5]!, 10),
      dihedralAngle: parseValueRef(tokens[6]!),
      zmatrixFormatCode: fmt,
      raw: cleaned.trim(),
      line: line.lineNumber,
      startOffset: line.startOffset,
      endOffset: line.endOffset,
    };
  }

  parseErrors.push({
    message: `Malformed atom specification at line ${line.lineNumber}: '${cleaned.trim()}'`,
    line: line.lineNumber,
    column: 1,
    startOffset: line.startOffset,
    endOffset: line.endOffset,
  });
  return null;
}

function parseVariableLine(line: IndexedLine, cleaned: string, isConstant: boolean): GaussianVariableEntry | null {
  const trimmed = cleaned.trim();
  if (!trimmed) return null;
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|\s|,)\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?)$/.exec(trimmed);
  if (!match) return null;
  const name = match[1]!;
  const numStr = match[2]!.replace(/[dD]([+-]?\d+)$/, "e$1");
  return {
    name,
    value: Number(numStr),
    isConstant,
    raw: trimmed,
    line: line.lineNumber,
    startOffset: line.startOffset,
    endOffset: line.endOffset,
  };
}

function parseSingleJobStep(
  lines: IndexedLine[],
  stepIndex: number,
  fullText: string,
  parseErrors: GaussianParseError[],
): GaussianJobStep {
  const startOffset = lines.length > 0 ? lines[0]!.startOffset : 0;
  const endOffset = lines.length > 0 ? lines[lines.length - 1]!.endOffset : 0;

  const link0: GaussianLink0Command[] = [];
  const comments: GaussianComment[] = [];
  const atoms: GaussianAtomSpec[] = [];
  const variables = new Map<string, GaussianVariableEntry>();
  const constants = new Map<string, GaussianVariableEntry>();
  const variableEntries: GaussianVariableEntry[] = [];

  let route: GaussianRouteSection | undefined;
  let title: string | undefined;
  let titleLine: number | undefined;
  let charge: number | undefined;
  let multiplicity: number | undefined;
  let chargeMultLine: number | undefined;
  let chargeMultStartOffset: number | undefined;
  let chargeMultEndOffset: number | undefined;

  let idx = 0;

  // Skip leading blank/comment lines
  while (idx < lines.length) {
    const cleaned = stripInlineComment(lines[idx]!, comments).trim();
    if (cleaned.length === 0) {
      idx++;
      continue;
    }
    break;
  }

  // 1. Link0 commands (%chk=, %mem=, %nprocshared=, etc.)
  while (idx < lines.length) {
    const line = lines[idx]!;
    const cleaned = stripInlineComment(line, comments).trim();
    if (cleaned.length === 0) {
      idx++;
      continue;
    }
    if (!cleaned.startsWith("%")) break;

    const eqIdx = cleaned.indexOf("=");
    const directive = (eqIdx === -1 ? cleaned.slice(1) : cleaned.slice(1, eqIdx)).trim().toLowerCase();
    const value = eqIdx === -1 ? undefined : cleaned.slice(eqIdx + 1).trim();
    link0.push({
      directive,
      value,
      raw: cleaned,
      line: line.lineNumber,
      startOffset: line.startOffset,
      endOffset: line.endOffset,
    });
    idx++;
  }

  // 2. Route section (starts with #, continues until blank line)
  if (idx < lines.length) {
    const firstCleaned = stripInlineComment(lines[idx]!, comments).trim();
    if (firstCleaned.startsWith("#")) {
      const routeLines: IndexedLine[] = [];
      const routeTexts: string[] = [];
      while (idx < lines.length) {
        const line = lines[idx]!;
        const cleaned = stripInlineComment(line, comments).trim();
        if (cleaned.length === 0) {
          idx++;
          break;
        }
        routeLines.push(line);
        routeTexts.push(cleaned);
        idx++;
      }
      route = parseRouteSection(routeLines, routeTexts);
    }
  }

  // Skip blank lines before Title
  while (idx < lines.length) {
    const cleaned = stripInlineComment(lines[idx]!, comments).trim();
    if (cleaned.length === 0) {
      idx++;
      continue;
    }
    break;
  }

  // Check if route specifies geom=allcheck (which omits title and molecule)
  const isAllCheck = route?.keywords.some(
    (k) => k.name.toLowerCase() === "geom" && k.options.some((o) => o.toLowerCase() === "allcheck"),
  );

  if (!isAllCheck && idx < lines.length) {
    // 3. Title section (non-blank lines until blank line)
    const titleLines: string[] = [];
    titleLine = lines[idx]!.lineNumber;
    while (idx < lines.length) {
      const line = lines[idx]!;
      const cleaned = stripInlineComment(line, comments).trim();
      if (cleaned.length === 0) {
        idx++;
        break;
      }
      titleLines.push(cleaned);
      idx++;
    }
    title = titleLines.join(" ").trim();

    // Skip extra blank lines before Charge & Multiplicity
    while (idx < lines.length) {
      const cleaned = stripInlineComment(lines[idx]!, comments).trim();
      if (cleaned.length === 0) {
        idx++;
        continue;
      }
      break;
    }

    // 4. Charge & Spin Multiplicity line
    if (idx < lines.length) {
      const cmLine = lines[idx]!;
      const cleaned = stripInlineComment(cmLine, comments).trim();
      const cmParts = cleaned.split(/[\s,]+/).filter((t) => t.length > 0);
      if (cmParts.length >= 2 && isIntegerToken(cmParts[0]!) && isIntegerToken(cmParts[1]!)) {
        charge = Number.parseInt(cmParts[0]!, 10);
        multiplicity = Number.parseInt(cmParts[1]!, 10);
        chargeMultLine = cmLine.lineNumber;
        chargeMultStartOffset = cmLine.startOffset;
        chargeMultEndOffset = cmLine.endOffset;
        idx++;
      } else {
        parseErrors.push({
          message: `Expected charge and spin multiplicity integers at line ${cmLine.lineNumber}, found '${cleaned}'`,
          line: cmLine.lineNumber,
          column: 1,
          startOffset: cmLine.startOffset,
          endOffset: cmLine.endOffset,
        });
        idx++;
      }
    }

    // 5. Molecule specification (atoms until blank line or Variables:/Constants:)
    let atomIndex = 1;
    let inVarBlock = false;
    let isConstantMode = false;

    while (idx < lines.length) {
      const line = lines[idx]!;
      const cleaned = stripInlineComment(line, comments).trim();
      if (cleaned.length === 0) {
        idx++;
        break;
      }
      if (/^variables\s*:?$/i.test(cleaned)) {
        inVarBlock = true;
        isConstantMode = false;
        idx++;
        break;
      }
      if (/^constants\s*:?$/i.test(cleaned)) {
        inVarBlock = true;
        isConstantMode = true;
        idx++;
        break;
      }
      const atom = parseAtomLine(line, cleaned, atomIndex, parseErrors);
      if (atom) {
        atoms.push(atom);
        atomIndex++;
      }
      idx++;
    }

    // 6. Optional Variables: / Constants: sections
    // (Can be directly after Variables:/Constants: header or after the blank line following Z-matrix atoms)
    while (idx < lines.length) {
      const line = lines[idx]!;
      const cleaned = stripInlineComment(line, comments).trim();
      if (cleaned.length === 0) {
        idx++;
        continue;
      }
      if (/^variables\s*:?$/i.test(cleaned)) {
        inVarBlock = true;
        isConstantMode = false;
        idx++;
        continue;
      }
      if (/^constants\s*:?$/i.test(cleaned)) {
        inVarBlock = true;
        isConstantMode = true;
        idx++;
        continue;
      }
      const entry = parseVariableLine(line, cleaned, isConstantMode);
      if (entry) {
        variableEntries.push(entry);
        const key = entry.name.toLowerCase();
        if (isConstantMode) {
          if (!constants.has(key)) constants.set(key, entry);
        } else {
          if (!variables.has(key)) variables.set(key, entry);
        }
        inVarBlock = true;
        idx++;
        continue;
      }
      // If we weren't in a variable block and hit trailing additional input (like gen basis), stop cleanly
      if (!inVarBlock) {
        break;
      }
      idx++;
    }
  }

  return {
    stepIndex,
    link0,
    route,
    title,
    titleLine,
    charge,
    multiplicity,
    chargeMultLine,
    chargeMultStartOffset,
    chargeMultEndOffset,
    atoms,
    variables,
    constants,
    variableEntries,
    comments,
    rawText: fullText.slice(startOffset, endOffset),
    startOffset,
    endOffset,
  };
}

/**
 * Parses a Gaussian `.gjf` / `.com` input file (supporting `--Link1--` multi-step jobs).
 */
export function parseGaussianInput(text: string): GaussianInputDocument {
  const allLines = splitLinesWithOffsets(text);
  const parseErrors: GaussianParseError[] = [];

  // Split into multi-step jobs on `--Link1--` lines
  const stepChunks: IndexedLine[][] = [];
  let current: IndexedLine[] = [];
  for (const line of allLines) {
    if (/^\s*--link1--\s*$/i.test(line.raw)) {
      stepChunks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  stepChunks.push(current);

  const jobs: GaussianJobStep[] = [];
  for (let i = 0; i < stepChunks.length; i++) {
    const chunk = stepChunks[i]!;
    // Skip completely empty trailing chunks after a final --Link1--
    if (i > 0 && chunk.every((l) => l.raw.trim().length === 0)) continue;
    jobs.push(parseSingleJobStep(chunk, jobs.length, text, parseErrors));
  }

  return { jobs, parseErrors };
}

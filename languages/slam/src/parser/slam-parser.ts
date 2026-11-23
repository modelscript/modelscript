// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Structured parser for SLAM II (Simulation Language for Alternative Modeling, 1979)
 * input decks, control statements, network nodes, and continuous state equations.
 */

import type {
  SlamAssignmentPair,
  SlamExprNode,
  SlamModel,
  SlamNetworkNode,
  SlamNodeType,
  SourceSpan,
} from "../types.js";

const NODE_KEYWORDS = new Set<string>([
  "CREATE",
  "QUEUE",
  "ACTIVITY",
  "ACT",
  "ASSIGN",
  "AWAIT",
  "FREE",
  "RESOURCE",
  "GATE",
  "OPEN",
  "CLOSE",
  "COLCT",
  "DETECT",
  "TERMINATE",
  "TERM",
]);

function normalizeNodeType(raw: string): SlamNodeType | undefined {
  const u = raw.toUpperCase();
  if (u === "ACT") return "ACTIVITY";
  if (u === "TERM") return "TERMINATE";
  if (NODE_KEYWORDS.has(u)) return u as SlamNodeType;
  return undefined;
}

/**
 * Splits a comma-separated argument string respecting nested parentheses and quotes.
 */
export function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote: string | null = null;
  let start = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      if (depth > 0) depth--;
    } else if (ch === "," && depth === 0) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts;
}

/**
 * Recursive-descent expression parser for SLAM II continuous equations,
 * INTLC initializations, ASSIGN statements, and distribution expressions.
 */
interface Token {
  type: "num" | "ident" | "op" | "lparen" | "rparen" | "comma" | "eof";
  text: string;
}

function tokenizeExpr(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i]!;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || (ch === "." && i + 1 < n && src[i + 1]! >= "0" && src[i + 1]! <= "9")) {
      const start = i;
      while (i < n && src[i]! >= "0" && src[i]! <= "9") i++;
      if (i < n && src[i] === ".") {
        i++;
        while (i < n && src[i]! >= "0" && src[i]! <= "9") i++;
      }
      if (i < n && (src[i] === "e" || src[i] === "E")) {
        i++;
        if (i < n && (src[i] === "+" || src[i] === "-")) i++;
        while (i < n && src[i]! >= "0" && src[i]! <= "9") i++;
      }
      tokens.push({ type: "num", text: src.slice(start, i) });
      continue;
    }
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_") {
      const start = i;
      while (
        i < n &&
        ((src[i]! >= "A" && src[i]! <= "Z") ||
          (src[i]! >= "a" && src[i]! <= "z") ||
          (src[i]! >= "0" && src[i]! <= "9") ||
          src[i] === "_")
      ) {
        i++;
      }
      tokens.push({ type: "ident", text: src.slice(start, i) });
      continue;
    }
    if (ch === "*" && i + 1 < n && src[i + 1] === "*") {
      tokens.push({ type: "op", text: "^" });
      i += 2;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^") {
      tokens.push({ type: "op", text: ch });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen", text: "(" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", text: ")" });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma", text: "," });
      i++;
      continue;
    }
    i++;
  }
  tokens.push({ type: "eof", text: "" });
  return tokens;
}

export function parseSlamExpr(src: string): SlamExprNode {
  const tokens = tokenizeExpr(src.trim());
  let pos = 0;

  function peek(): Token {
    return tokens[pos] ?? { type: "eof", text: "" };
  }

  function next(): Token {
    const t = peek();
    if (pos < tokens.length) pos++;
    return t;
  }

  function parseAddSub(): SlamExprNode {
    let left = parseMulDiv();
    while (peek().type === "op" && (peek().text === "+" || peek().text === "-")) {
      const op = next().text as "+" | "-";
      const right = parseMulDiv();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  function parseMulDiv(): SlamExprNode {
    let left = parsePow();
    while (peek().type === "op" && (peek().text === "*" || peek().text === "/")) {
      const op = next().text as "*" | "/";
      const right = parsePow();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  function parsePow(): SlamExprNode {
    const base = parseUnary();
    if (peek().type === "op" && peek().text === "^") {
      next();
      const exp = parsePow();
      return { kind: "binary", op: "^", left: base, right: exp };
    }
    return base;
  }

  function parseUnary(): SlamExprNode {
    if (peek().type === "op" && (peek().text === "+" || peek().text === "-")) {
      const op = next().text as "+" | "-";
      const operand = parseUnary();
      return { kind: "unary", op, operand };
    }
    return parsePrimary();
  }

  function parsePrimary(): SlamExprNode {
    const t = peek();
    if (t.type === "num") {
      next();
      const val = Number(t.text);
      return { kind: "number", value: Number.isFinite(val) ? val : 0 };
    }
    if (t.type === "lparen") {
      next();
      const inner = parseAddSub();
      if (peek().type === "rparen") next();
      return inner;
    }
    if (t.type === "ident") {
      next();
      const upper = t.text.toUpperCase();
      if (peek().type === "lparen") {
        next();
        const args: SlamExprNode[] = [];
        if (peek().type !== "rparen") {
          args.push(parseAddSub());
          while (peek().type === "comma") {
            next();
            args.push(parseAddSub());
          }
        }
        if (peek().type === "rparen") next();
        if (
          (upper === "SS" || upper === "DD" || upper === "XX" || upper === "ATRIB") &&
          args.length === 1 &&
          args[0]!.kind === "number"
        ) {
          return { kind: "state", array: upper, index: Math.trunc(args[0]!.value) };
        }
        return { kind: "call", callee: upper, args };
      }
      return { kind: "ident", name: upper };
    }
    return { kind: "number", value: 0 };
  }

  return parseAddSub();
}

function parseOptionalNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function stripTrailingComment(rawLine: string): string {
  // In SLAM II, `;` terminates a statement and starts a comment on the same line.
  // Full-line comments begin with `;` (or `//`).
  let inQuote: string | null = null;
  for (let i = 0; i < rawLine.length; i++) {
    const ch = rawLine[i]!;
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
    } else if (ch === ";") {
      return rawLine.slice(0, i);
    } else if (ch === "/" && i + 1 < rawLine.length && rawLine[i + 1] === "/") {
      return rawLine.slice(0, i);
    }
  }
  return rawLine;
}

function makeSpan(
  lineIdx: number,
  startCol: number,
  endCol: number,
  startOffset: number,
  endOffset: number,
): SourceSpan {
  return {
    line: lineIdx + 1,
    column: startCol + 1,
    endLine: lineIdx + 1,
    endColumn: Math.max(startCol + 2, endCol + 1),
    startOffset,
    endOffset,
  };
}

/**
 * Parses a SLAM II input deck string into a structured `SlamModel`.
 */
export function parseSlamDeck(source: string): SlamModel {
  const model: SlamModel = {
    name: "SLAM_MODEL",
    intlc: [],
    stateEquations: [],
    hasNetwork: false,
    hasEndNetwork: false,
    hasFin: false,
    nodes: [],
    resources: new Map(),
    gates: new Map(),
    labels: new Map(),
    syntaxErrors: [],
  };

  const lines = source.split(/\r?\n/);
  let offset = 0;
  let nodeCounter = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]!;
    const lineStartOffset = offset;
    offset += rawLine.length + 1;

    const codePart = stripTrailingComment(rawLine);
    const trimmed = codePart.trim();
    if (!trimmed) continue;

    const leadingSpaces = codePart.length - codePart.trimStart().length;
    const span = makeSpan(
      lineIdx,
      leadingSpaces,
      leadingSpaces + trimmed.length,
      lineStartOffset + leadingSpaces,
      lineStartOffset + leadingSpaces + trimmed.length,
    );

    // 1. Check for continuous state equation: DD(i) = expr or SS(i) = expr
    const eqMatch = trimmed.match(/^(DD|SS)\s*\(\s*(\d+)\s*\)\s*=\s*(.+)$/i);
    if (eqMatch) {
      const lhsKind = eqMatch[1]!.toUpperCase() as "DD" | "SS";
      const index = Number.parseInt(eqMatch[2]!, 10);
      const rhsText = eqMatch[3]!.trim();
      model.stateEquations.push({
        lhsKind,
        index,
        rhsText,
        rhsExpr: parseSlamExpr(rhsText),
        span,
      });
      continue;
    }

    // 2. Check for control statements
    const headMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\b(.*)$/);
    if (!headMatch) {
      model.syntaxErrors.push({ message: `Unrecognized statement '${trimmed}'`, span });
      continue;
    }

    const firstWord = headMatch[1]!.toUpperCase();
    const rest = headMatch[2]!.trim();

    if (firstWord === "GEN") {
      const restClean = rest.startsWith(",") ? rest.slice(1) : rest;
      const parts = splitTopLevelCommas(restClean);
      const analyst = (parts[0] ?? "ANALYST").replace(/^['"]|['"]$/g, "").trim() || "ANALYST";
      const project = (parts[1] ?? "SLAM_MODEL").replace(/^['"]|['"]$/g, "").trim() || "SLAM_MODEL";
      const date = parts[2] ? parts[2].replace(/^['"]|['"]$/g, "").trim() : undefined;
      const runs = parseOptionalNumber(parts[3]) ?? 1;
      model.gen = { analyst, project, date, runs, span };
      model.name = project.replace(/[^A-Za-z0-9_]/g, "_") || "SLAM_MODEL";
      continue;
    }

    if (firstWord === "LIMITS") {
      const restClean = rest.startsWith(",") ? rest.slice(1) : rest;
      const parts = splitTopLevelCommas(restClean);
      model.limits = {
        mfil: parseOptionalNumber(parts[0]) ?? 1,
        matr: parseOptionalNumber(parts[1]) ?? 1,
        mnentries: parseOptionalNumber(parts[2]) ?? 100,
        span,
      };
      continue;
    }

    if (firstWord === "CONTINUOUS") {
      const restClean = rest.startsWith(",") ? rest.slice(1) : rest;
      const parts = splitTopLevelCommas(restClean);
      const nnequations = parseOptionalNumber(parts[0]) ?? 0;
      const nnstates = parseOptionalNumber(parts[1]) ?? 0;
      const dtmin = parseOptionalNumber(parts[2]) ?? 0.01;
      const dtmax = parseOptionalNumber(parts[3]) ?? 0.1;
      const dtsav = parseOptionalNumber(parts[4]) ?? dtmax;
      const warningFlag = parts[5] || undefined;
      const aaerr = parseOptionalNumber(parts[6]);
      const rrerr = parseOptionalNumber(parts[7]);
      model.continuous = { nnequations, nnstates, dtmin, dtmax, dtsav, warningFlag, aaerr, rrerr, span };
      continue;
    }

    if (firstWord === "INITIALIZE") {
      const restClean = rest.startsWith(",") ? rest.slice(1) : rest;
      const parts = splitTopLevelCommas(restClean);
      const ttbeg = parseOptionalNumber(parts[0]) ?? 0.0;
      const ttfin = parseOptionalNumber(parts[1]) ?? 100.0;
      model.initialize = { ttbeg, ttfin, span };
      continue;
    }

    if (firstWord === "INTLC") {
      const restClean = rest.startsWith(",") ? rest.slice(1) : rest;
      const parts = splitTopLevelCommas(restClean);
      for (const p of parts) {
        if (!p) continue;
        const assignMatch = p.match(/^([A-Za-z_][A-Za-z0-9_]*(?:\s*\(\s*\d+\s*\))?)\s*=\s*(.+)$/);
        if (!assignMatch) {
          model.syntaxErrors.push({ message: `Invalid INTLC assignment '${p}'`, span });
          continue;
        }
        const targetRaw = assignMatch[1]!.replace(/\s+/g, "").toUpperCase();
        const valueExpr = assignMatch[2]!.trim();
        const arrMatch = targetRaw.match(/^(SS|DD|XX|ATRIB)\((\d+)\)$/);
        const numericValue = parseOptionalNumber(valueExpr);
        if (arrMatch) {
          model.intlc.push({
            target: targetRaw,
            kind: arrMatch[1] as "SS" | "DD" | "XX" | "ATRIB",
            index: Number.parseInt(arrMatch[2]!, 10),
            valueExpr,
            numericValue,
            span,
          });
        } else {
          model.intlc.push({
            target: targetRaw,
            kind: "VAR",
            valueExpr,
            numericValue,
            span,
          });
        }
      }
      continue;
    }

    if (firstWord === "NETWORK") {
      model.hasNetwork = true;
      model.networkSpan = span;
      continue;
    }

    if (firstWord === "ENDNETWORK") {
      model.hasEndNetwork = true;
      model.endNetworkSpan = span;
      continue;
    }

    if (firstWord === "FIN") {
      model.hasFin = true;
      continue;
    }

    // 3. Check for network node (optionally prefixed with a label)
    let label: string | undefined;
    let nodeStmt = trimmed;
    let nodeType = normalizeNodeType(firstWord);

    if (!nodeType) {
      // Try label prefix: "LBL1 QUEUE(1), ..." or "LBL1: QUEUE(1), ..."
      const labelMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:?\s+([A-Za-z_][A-Za-z0-9_]*)(.*)$/);
      if (labelMatch) {
        const candidateType = normalizeNodeType(labelMatch[2]!);
        if (candidateType) {
          label = labelMatch[1]!.toUpperCase();
          nodeType = candidateType;
          nodeStmt = labelMatch[2]! + labelMatch[3]!;
        }
      }
    }

    if (!nodeType) {
      model.syntaxErrors.push({ message: `Unknown SLAM II keyword or node '${firstWord}'`, span });
      continue;
    }

    nodeCounter++;
    const node = parseNetworkNode(nodeType, nodeStmt, label, nodeCounter, span);
    model.nodes.push(node);

    if (label && !model.labels.has(label)) {
      model.labels.set(label, node);
    }
    if (node.type === "RESOURCE" && node.resourceName) {
      model.resources.set(node.resourceName.toUpperCase(), node);
    }
    if (node.type === "GATE" && node.gateName) {
      model.gates.set(node.gateName.toUpperCase(), node);
    }
  }

  return model;
}

function parseNetworkNode(
  type: SlamNodeType,
  stmt: string,
  label: string | undefined,
  counter: number,
  span: SourceSpan,
): SlamNetworkNode {
  // Strip keyword from start
  const kwMatch = stmt.match(/^[A-Za-z_][A-Za-z0-9_]*(.*)$/);
  const tail = kwMatch ? kwMatch[1]!.trim() : "";

  const node: SlamNetworkNode = {
    id: label ?? `${type}_${counter}`,
    label,
    type,
    args: [],
    span,
  };

  // Helper to extract leading (N) or /SPEC before first comma
  let remainder = tail;
  let slashPrefix: string | undefined;
  let parenPrefix: string | undefined;

  if (remainder.startsWith("/")) {
    const commaIdx = remainder.indexOf(",");
    if (commaIdx >= 0) {
      slashPrefix = remainder.slice(1, commaIdx).trim();
      remainder = remainder.slice(commaIdx + 1).trim();
    } else {
      slashPrefix = remainder.slice(1).trim();
      remainder = "";
    }
  } else if (remainder.startsWith("(")) {
    const closeIdx = remainder.indexOf(")");
    if (closeIdx >= 0) {
      parenPrefix = remainder.slice(1, closeIdx).trim();
      remainder = remainder.slice(closeIdx + 1).trim();
      if (remainder.startsWith(",")) remainder = remainder.slice(1).trim();
    }
  } else if (remainder.startsWith(",")) {
    remainder = remainder.slice(1).trim();
  }

  const args = remainder ? splitTopLevelCommas(remainder) : [];
  node.args = args;

  switch (type) {
    case "CREATE": {
      // CREATE, TBC, TF, MA, MC, M
      node.interarrivalExpr = args[0] || "1.0";
      node.firstCreation = parseOptionalNumber(args[1]) ?? 0.0;
      node.markAttribute = parseOptionalNumber(args[2]);
      node.maxCreations = parseOptionalNumber(args[3]);
      node.maxBranches = parseOptionalNumber(args[4]);
      break;
    }

    case "QUEUE": {
      // QUEUE(IFL), IQ, QC, BLOCK/BALK(NLBL)
      node.fileNumber = parseOptionalNumber(parenPrefix ?? args[0]) ?? 1;
      const offset = parenPrefix !== undefined ? 0 : 1;
      node.initialCount = parseOptionalNumber(args[offset]) ?? 0;
      node.capacity = parseOptionalNumber(args[offset + 1]);
      const balkRaw = args[offset + 2];
      if (balkRaw) {
        const balkMatch = balkRaw.match(/BALK\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/i);
        if (balkMatch) node.targetLabel = balkMatch[1]!.toUpperCase();
      }
      break;
    }

    case "ACTIVITY": {
      // ACTIVITY/A, DUR, PROB_OR_COND, NLBL
      if (slashPrefix) {
        node.activityIndex = parseOptionalNumber(slashPrefix);
      }
      node.durationExpr = args[0] || "0.0";
      if (args[1]) {
        node.conditionOrProb = args[1];
        const p = parseOptionalNumber(args[1]);
        if (p !== undefined) node.probability = p;
      }
      if (args[2]) {
        node.targetLabel = args[2].trim().toUpperCase();
      }
      break;
    }

    case "ASSIGN": {
      // ASSIGN, VAR=EXPR, ..., M
      const pairs: SlamAssignmentPair[] = [];
      for (const a of args) {
        if (!a) continue;
        const eqIdx = a.indexOf("=");
        if (eqIdx > 0) {
          const lhs = a.slice(0, eqIdx).replace(/\s+/g, "").toUpperCase();
          const rhsText = a.slice(eqIdx + 1).trim();
          pairs.push({ lhs, rhsText, rhsExpr: parseSlamExpr(rhsText) });
        } else {
          const m = parseOptionalNumber(a);
          if (m !== undefined) node.maxBranches = m;
        }
      }
      node.assignments = pairs;
      break;
    }

    case "RESOURCE": {
      // RESOURCE/RLBL(CAP), IFL1, IFL2, ... or RESOURCE, RLBL(CAP), IFL1
      const spec = slashPrefix ?? args[0] ?? "";
      const resMatch = spec.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\s*([+-]?\d+)\s*\))?$/);
      if (resMatch) {
        node.resourceName = resMatch[1]!.toUpperCase();
        node.resourceUnits = resMatch[2] !== undefined ? Number.parseInt(resMatch[2]!, 10) : 1;
      }
      const fileArg = slashPrefix !== undefined ? args[0] : args[1];
      node.fileNumber = parseOptionalNumber(fileArg) ?? 1;
      break;
    }

    case "AWAIT": {
      // AWAIT(IFL), RLBL/UR, BLOCK/BALK(NLBL), M
      node.fileNumber = parseOptionalNumber(parenPrefix) ?? 1;
      const resSpec = args[0] ?? "";
      const parts = resSpec.split("/");
      if (parts[0]?.trim()) {
        node.resourceName = parts[0].trim().toUpperCase();
      }
      node.resourceUnits = parseOptionalNumber(parts[1]) ?? 1;
      if (args[1]) {
        const balkMatch = args[1].match(/BALK\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/i);
        if (balkMatch) node.targetLabel = balkMatch[1]!.toUpperCase();
      }
      node.maxBranches = parseOptionalNumber(args[2]);
      break;
    }

    case "FREE": {
      // FREE, RLBL/UF, M
      const resSpec = args[0] ?? "";
      const parts = resSpec.split("/");
      if (parts[0]?.trim()) {
        node.resourceName = parts[0].trim().toUpperCase();
      }
      node.resourceUnits = parseOptionalNumber(parts[1]) ?? 1;
      node.maxBranches = parseOptionalNumber(args[1]);
      break;
    }

    case "GATE": {
      // GATE/GLBL, OPEN|CLOSED, IFL1, ... or GATE, GLBL, OPEN|CLOSED, IFL1
      const gName = (slashPrefix ?? args[0] ?? "").trim().toUpperCase();
      const offset = slashPrefix !== undefined ? 0 : 1;
      if (gName) node.gateName = gName;
      const status = (args[offset] ?? "OPEN").trim().toUpperCase();
      node.gateInitialOpen = status !== "CLOSED" && status !== "CLOSE";
      node.fileNumber = parseOptionalNumber(args[offset + 1]) ?? 1;
      break;
    }

    case "OPEN":
    case "CLOSE": {
      // OPEN, GLBL, M  |  CLOSE, GLBL, M
      if (args[0]?.trim()) node.gateName = args[0].trim().toUpperCase();
      node.maxBranches = parseOptionalNumber(args[1]);
      break;
    }

    case "COLCT": {
      // COLCT, VAR, ID, H, M
      node.collectVar = args[0] || "TNOW";
      node.collectId = (args[1] || node.collectVar).replace(/^['"]|['"]$/g, "").trim();
      node.maxBranches = parseOptionalNumber(args[3] ?? args[2]);
      break;
    }

    case "DETECT": {
      // DETECT, XVAR, XDIR, VALUE, TOL, M
      node.detectVar = (args[0] || "SS(1)").replace(/\s+/g, "").toUpperCase();
      node.detectDirection = (args[1] || "XP").trim().toUpperCase();
      node.detectThreshold = parseOptionalNumber(args[2]) ?? 0.0;
      node.detectTolerance = parseOptionalNumber(args[3]) ?? 1e-3;
      node.maxBranches = parseOptionalNumber(args[4]);
      break;
    }

    case "TERMINATE": {
      // TERMINATE, TC
      node.terminateCount = parseOptionalNumber(args[0]);
      break;
    }
  }

  return node;
}

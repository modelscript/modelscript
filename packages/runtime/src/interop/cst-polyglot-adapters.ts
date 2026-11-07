// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Comment-Aware, Balanced-Delimiter CST/AST Parsers & PolyglotNode Adapters
 * for Modelica 3.x and SysML v2.
 *
 * Eliminates regex fragility across multi-line declarations, block comments (`/* ... * /`),
 * line comments (`// ...`), nested array/matrix literals (`{1, 2, 3}`), and complex
 * modifier expressions (`k = 2 * pi`), while recording exact source byte spans for
 * surgical CST unparsing.
 */

import { extractModelicaTwinAnnotations } from "../formal/requirement_binder.js";
import type { PolyglotNode } from "./polyglot-transformer.js";

export interface SourceByteSpan {
  start: number;
  end: number;
}

export interface ModelicaModifierNode {
  name: string;
  value: string;
  span: SourceByteSpan;
  valueSpan: SourceByteSpan;
}

export interface ModelicaComponentNode {
  typePrefix: string;
  causality: "parameter" | "input" | "output" | "local";
  variability: "fixed" | "continuous" | "discrete" | "constant";
  typeSpecifier: string;
  name: string;
  arraySubscripts?: string | undefined;
  modifications: Record<string, string>;
  modifierNodes: ModelicaModifierNode[];
  bindingExpr?: string | undefined;
  description?: string | undefined;
  twinAnnotation?: string | undefined;
  span: SourceByteSpan;
}

export interface ModelicaConnectionNode {
  from: string;
  to: string;
  span: SourceByteSpan;
}

export interface ModelicaEquationNode {
  text: string;
  lhs: string;
  rhs: string;
  derStateVar?: string | undefined;
  span: SourceByteSpan;
}

export interface ParsedModelicaCst {
  kind: "model" | "block" | "connector" | "class" | "fragment";
  modelName: string;
  docstring?: string | undefined;
  components: ModelicaComponentNode[];
  connections: ModelicaConnectionNode[];
  equations: ModelicaEquationNode[];
  stateVars: Set<string>;
}

/**
 * Replaces line comments (`// ...`) and block comments (`/* ... * /`) with spaces of equal
 * byte length (preserving newlines and all character offsets), while leaving string literals intact.
 * When `preserveDocComments` is true, `doc /* ... * /` blocks in SysML v2 are preserved.
 */
export function maskCommentsPreservingOffsets(source: string, preserveSysmlDoc = false): string {
  const chars = source.split("");
  const len = chars.length;
  let i = 0;

  while (i < len) {
    const ch = chars[i];
    // String literal "..." or '...'
    if (ch === '"') {
      i++;
      while (i < len && chars[i] !== '"') {
        if (chars[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }

    // Line comment //
    if (ch === "/" && chars[i + 1] === "/") {
      // Check if it's a period annotation comment in SysML action (`// Period: 0.01s`) when preserveSysmlDoc is set
      const lineEnd = source.indexOf("\n", i);
      const end = lineEnd === -1 ? len : lineEnd;
      const commentSlice = source.slice(i, end);
      if (preserveSysmlDoc && /\/\/\s*Period:/i.test(commentSlice)) {
        i = end;
        continue;
      }
      for (let k = i; k < end; k++) {
        if (chars[k] !== "\r" && chars[k] !== "\n") chars[k] = " ";
      }
      i = end;
      continue;
    }

    // Block comment /* ... */
    if (ch === "/" && chars[i + 1] === "*") {
      const prevSlice = source.slice(Math.max(0, i - 12), i);
      const isSysmlDoc = preserveSysmlDoc && /\bdoc\s*$/.test(prevSlice);
      const closeIdx = source.indexOf("*/", i + 2);
      const end = closeIdx === -1 ? len : closeIdx + 2;
      if (!isSysmlDoc) {
        for (let k = i; k < end; k++) {
          if (chars[k] !== "\r" && chars[k] !== "\n") chars[k] = " ";
        }
      }
      i = end;
      continue;
    }

    i++;
  }

  return chars.join("");
}

/**
 * Splits a character range into top-level semicolon-terminated statements,
 * respecting nested `(...)`, `{...}`, `[...]`, and `"..."`.
 */
export function splitTopLevelStatements(
  maskedSource: string,
  rawSource: string,
  rangeStart = 0,
  rangeEnd = maskedSource.length,
): { maskedText: string; rawText: string; start: number; end: number }[] {
  const statements: { maskedText: string; rawText: string; start: number; end: number }[] = [];
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let inString = false;
  let stmtStart = rangeStart;

  for (let i = rangeStart; i < rangeEnd; i++) {
    const ch = maskedSource[i];
    if (inString) {
      if (ch === "\\") {
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "(") {
      depthParen++;
    } else if (ch === ")") {
      depthParen = Math.max(0, depthParen - 1);
    } else if (ch === "{") {
      depthBrace++;
    } else if (ch === "}") {
      depthBrace = Math.max(0, depthBrace - 1);
    } else if (ch === "[") {
      depthBracket++;
    } else if (ch === "]") {
      depthBracket = Math.max(0, depthBracket - 1);
    } else if (ch === ";" && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      let s = stmtStart;
      while (s < i && /\s/.test(maskedSource[s]!)) s++;
      const e = i + 1;
      if (s < i) {
        statements.push({
          maskedText: maskedSource.slice(s, e),
          rawText: rawSource.slice(s, e),
          start: s,
          end: e,
        });
      }
      stmtStart = e;
    }
  }

  return statements;
}

/**
 * Splits a comma-separated argument/modifier list at top-level depth 0,
 * respecting nested `(...)`, `{...}`, `[...]`, and `"..."`.
 */
export function splitTopLevelCommaList(
  text: string,
  baseOffset = 0,
): { text: string; start: number; end: number }[] {
  const items: { text: string; start: number; end: number }[] = [];
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let inString = false;
  let itemStart = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "(") depthParen++;
    else if (ch === ")") depthParen = Math.max(0, depthParen - 1);
    else if (ch === "{") depthBrace++;
    else if (ch === "}") depthBrace = Math.max(0, depthBrace - 1);
    else if (ch === "[") depthBracket++;
    else if (ch === "]") depthBracket = Math.max(0, depthBracket - 1);
    else if (ch === "," && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      let s = itemStart;
      let e = i;
      while (s < e && /\s/.test(text[s]!)) s++;
      while (e > s && /\s/.test(text[e - 1]!)) e--;
      if (s < e) {
        items.push({ text: text.slice(s, e), start: baseOffset + s, end: baseOffset + e });
      }
      itemStart = i + 1;
    }
  }

  let s = itemStart;
  let e = text.length;
  while (s < e && /\s/.test(text[s]!)) s++;
  while (e > s && /\s/.test(text[e - 1]!)) e--;
  if (s < e) {
    items.push({ text: text.slice(s, e), start: baseOffset + s, end: baseOffset + e });
  }

  return items;
}

/**
 * Parses Modelica 3.x source code (either a complete `model ... end ...;` or a snippet of
 * component declarations and equations) into a structured CST with byte spans.
 */
export function parseModelicaCst(source: string): ParsedModelicaCst {
  const masked = maskCommentsPreservingOffsets(source, false);
  const twinMap = extractModelicaTwinAnnotations(source);

  let kind: ParsedModelicaCst["kind"] = "fragment";
  let modelName = "ModelicaModel";
  let docstring: string | undefined;

  const headerMatch = /\b(model|block|connector|class)\s+([A-Za-z_]\w*)/.exec(masked);
  let bodyStart = 0;
  let bodyEnd = masked.length;

  if (headerMatch && headerMatch[1] && headerMatch[2]) {
    kind = headerMatch[1] as ParsedModelicaCst["kind"];
    modelName = headerMatch[2];
    bodyStart = headerMatch.index + headerMatch[0].length;
    const afterHeader = source.slice(bodyStart);
    const docMatch = /^\s*"([^"]*)"/.exec(afterHeader);
    if (docMatch && docMatch[1] !== undefined) {
      docstring = docMatch[1];
      bodyStart += docMatch[0].length;
    }
    const endRegex = new RegExp(`\\bend\\s+${modelName}\\s*;`, "g");
    let endMatch: RegExpExecArray | null;
    while ((endMatch = endRegex.exec(masked)) !== null) {
      bodyEnd = endMatch.index;
    }
  }

  // Locate top-level `equation` and `algorithm` section boundaries inside [bodyStart, bodyEnd]
  const eqRegex = /\b(equation|initial\s+equation|algorithm|initial\s+algorithm)\b/g;
  eqRegex.lastIndex = bodyStart;
  let firstSectionIdx = bodyEnd;
  let secMatch: RegExpExecArray | null;
  while ((secMatch = eqRegex.exec(masked)) !== null) {
    if (secMatch.index >= bodyEnd) break;
    if (secMatch.index < firstSectionIdx) {
      firstSectionIdx = secMatch.index;
    }
  }

  const components: ModelicaComponentNode[] = [];
  const connections: ModelicaConnectionNode[] = [];
  const equations: ModelicaEquationNode[] = [];
  const stateVars = new Set<string>();

  const parseStatementAsComponentOrEquation = (stmt: {
    maskedText: string;
    rawText: string;
    start: number;
    end: number;
  }, inEquationSection: boolean) => {
    // Strip leading section keywords (`public`, `protected`, `equation`, `algorithm`)
    let localOffset = 0;
    let mText = stmt.maskedText;
    const kwMatch = /^(?:\s*(?:public|protected|equation|initial\s+equation|algorithm|initial\s+algorithm)\b\s*)+/.exec(
      mText,
    );
    if (kwMatch) {
      localOffset += kwMatch[0].length;
      mText = mText.slice(kwMatch[0].length);
    }

    const trimmedMasked = mText.replace(/;\s*$/, "").trim();
    if (!trimmedMasked || trimmedMasked.startsWith("import ") || trimmedMasked.startsWith("extends ")) {
      return;
    }
    if (trimmedMasked.startsWith("annotation(") || trimmedMasked.startsWith("annotation (")) {
      return;
    }

    // 1. Check `connect(a, b)`
    const connMatch = /^connect\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)$/.exec(trimmedMasked);
    if (connMatch && connMatch[1] && connMatch[2]) {
      connections.push({
        from: connMatch[1].trim(),
        to: connMatch[2].trim(),
        span: { start: stmt.start + localOffset, end: stmt.end },
      });
      return;
    }

    // 2. If in equation section (or starts with `der(` or has top-level `=` before any identifier pair), parse as equation
    const isEquationLike =
      inEquationSection ||
      /^der\s*\(/.test(trimmedMasked) ||
      /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?\s*=/.test(trimmedMasked);

    if (isEquationLike) {
      // Find top-level `=`
      let eqPos = -1;
      let dp = 0;
      for (let i = 0; i < trimmedMasked.length; i++) {
        const c = trimmedMasked[i];
        if (c === "(" || c === "[" || c === "{") dp++;
        else if (c === ")" || c === "]" || c === "}") dp = Math.max(0, dp - 1);
        else if (c === "=" && dp === 0 && trimmedMasked[i - 1] !== "<" && trimmedMasked[i - 1] !== ">" && trimmedMasked[i + 1] !== "=") {
          eqPos = i;
          break;
        }
      }
      if (eqPos !== -1) {
        const lhs = trimmedMasked.slice(0, eqPos).trim();
        const rhs = trimmedMasked.slice(eqPos + 1).trim();
        const derMatch = /\bder\s*\(\s*([A-Za-z_]\w*)\s*\)/.exec(lhs) ?? /\bder\s*\(\s*([A-Za-z_]\w*)\s*\)/.exec(rhs);
        const derStateVar = derMatch?.[1];
        if (derStateVar) stateVars.add(derStateVar);
        equations.push({
          text: `${lhs} = ${rhs};`,
          lhs,
          rhs,
          derStateVar,
          span: { start: stmt.start + localOffset, end: stmt.end },
        });
        return;
      }
    }

    // 3. Parse as component declaration:
    // [typePrefix] TypeSpecifier Name [arraySubscripts] [(modifications)] [= bindingExpr] ["description"] [annotation(...)]
    const rawStmtBody = stmt.rawText.slice(localOffset).replace(/;\s*$/, "");
    let maskedBody = mText.replace(/;\s*$/, "");

    // Strip trailing `annotation(...)` at top level
    const annoIdx = maskedBody.search(/\bannotation\s*\(/);
    let rawClean = rawStmtBody;
    if (annoIdx !== -1) {
      maskedBody = maskedBody.slice(0, annoIdx);
      rawClean = rawStmtBody.slice(0, annoIdx);
    }

    // Extract optional trailing description string `"..."` at top level
    let description: string | undefined;
    const descMatch = /"([^"]*)"\s*$/.exec(rawClean);
    if (descMatch && descMatch[1] !== undefined) {
      description = descMatch[1];
      rawClean = rawClean.slice(0, descMatch.index);
      maskedBody = maskedBody.slice(0, descMatch.index);
    }

    // Match prefixes + typeSpecifier + componentName
    const declHeadRegex =
      /^\s*((?:(?:parameter|constant|discrete|input|output|flow|stream|inner|outer|replaceable|redeclare)\s+)*)([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+([A-Za-z_]\w*)(\s*\[[^\]]*\])?/;
    const headMatch = declHeadRegex.exec(maskedBody);
    if (!headMatch || !headMatch[2] || !headMatch[3]) {
      return;
    }

    const typePrefix = (headMatch[1] || "").trim();
    const typeSpecifier = headMatch[2].trim();
    const compName = headMatch[3].trim();
    const arraySubscripts = headMatch[4]?.trim();

    let causality: ModelicaComponentNode["causality"] = "local";
    let variability: ModelicaComponentNode["variability"] = "continuous";
    if (/\bparameter\b/.test(typePrefix)) {
      causality = "parameter";
      variability = "fixed";
    } else if (/\bconstant\b/.test(typePrefix)) {
      variability = "constant";
    } else if (/\bdiscrete\b/.test(typePrefix)) {
      variability = "discrete";
    }
    if (/\binput\b/.test(typePrefix)) causality = "input";
    else if (/\boutput\b/.test(typePrefix)) causality = "output";
    else if (typeSpecifier.endsWith("RealInput") || typeSpecifier.endsWith("IntegerInput") || typeSpecifier.endsWith("BooleanInput")) {
      causality = "input";
    } else if (typeSpecifier.endsWith("RealOutput") || typeSpecifier.endsWith("IntegerOutput") || typeSpecifier.endsWith("BooleanOutput")) {
      causality = "output";
    }

    let cursor = headMatch[0].length;
    const modifications: Record<string, string> = {};
    const modifierNodes: ModelicaModifierNode[] = [];

    // Check for `( ... )` modification block
    while (cursor < maskedBody.length && /\s/.test(maskedBody[cursor]!)) cursor++;
    if (maskedBody[cursor] === "(") {
      const openParen = cursor;
      let depth = 1;
      cursor++;
      while (cursor < maskedBody.length && depth > 0) {
        if (maskedBody[cursor] === "(") depth++;
        else if (maskedBody[cursor] === ")") depth--;
        cursor++;
      }
      const closeParen = cursor - 1;
      if (closeParen > openParen) {
        const innerRaw = rawClean.slice(openParen + 1, closeParen);
        const modAbsBase = stmt.start + localOffset + openParen + 1;
        const modItems = splitTopLevelCommaList(innerRaw, modAbsBase);
        for (const item of modItems) {
          // Strip optional `each ` or `final `
          const modMatch = /^(?:(?:each|final)\s+)*([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(item.text);
          if (modMatch && modMatch[1] && modMatch[2]) {
            const mName = modMatch[1].trim();
            const mVal = modMatch[2].trim();
            const valOffsetInItem = item.text.indexOf(mVal, item.text.indexOf("="));
            modifications[mName] = mVal;
            modifierNodes.push({
              name: mName,
              value: mVal,
              span: { start: item.start, end: item.end },
              valueSpan: {
                start: item.start + (valOffsetInItem !== -1 ? valOffsetInItem : 0),
                end: item.end,
              },
            });
          }
        }
      }
    }

    // Check for `= bindingExpr`
    while (cursor < maskedBody.length && /\s/.test(maskedBody[cursor]!)) cursor++;
    let bindingExpr: string | undefined;
    if (maskedBody[cursor] === "=") {
      bindingExpr = rawClean.slice(cursor + 1).trim();
    }

    components.push({
      typePrefix,
      causality,
      variability,
      typeSpecifier,
      name: compName,
      arraySubscripts,
      modifications,
      modifierNodes,
      bindingExpr,
      description,
      twinAnnotation: twinMap.get(compName),
      span: { start: stmt.start + localOffset, end: stmt.end },
    });
  };

  if (firstSectionIdx < bodyEnd) {
    const declStmts = splitTopLevelStatements(masked, source, bodyStart, firstSectionIdx);
    for (const st of declStmts) {
      parseStatementAsComponentOrEquation(st, false);
    }
    const eqStmts = splitTopLevelStatements(masked, source, firstSectionIdx, bodyEnd);
    for (const st of eqStmts) {
      parseStatementAsComponentOrEquation(st, true);
    }
  } else {
    const allStmts = splitTopLevelStatements(masked, source, bodyStart, bodyEnd);
    for (const st of allStmts) {
      parseStatementAsComponentOrEquation(st, false);
    }
  }

  return {
    kind,
    modelName,
    docstring,
    components,
    connections,
    equations,
    stateVars,
  };
}

export interface SysmlRequirementNode {
  id: string;
  docText: string;
  attributes: Record<string, string>;
  constraints: string[];
  span: SourceByteSpan;
}

export interface SysmlSatisfyNode {
  reqId: string;
  byTarget: string;
  span: SourceByteSpan;
}

export interface SysmlPortNode {
  name: string;
  direction: "in" | "out" | "inout";
  typeName: string;
  isConjugated: boolean;
  span: SourceByteSpan;
}

export interface SysmlActionNode {
  name: string;
  periodSec?: number | undefined;
  span: SourceByteSpan;
}

export interface SysmlConnectionNode {
  from: string;
  to: string;
  span: SourceByteSpan;
}

export interface SysmlPartDefNode {
  name: string;
  ports: SysmlPortNode[];
  actions: SysmlActionNode[];
  connections: SysmlConnectionNode[];
  attributes: Record<string, string>;
  span: SourceByteSpan;
}

export interface ParsedSysml2Cst {
  requirementDefs: SysmlRequirementNode[];
  satisfyLinks: SysmlSatisfyNode[];
  partDefs: SysmlPartDefNode[];
  topLevelConnections: SysmlConnectionNode[];
}

function findMatchingCloseBrace(masked: string, openBraceIdx: number): number {
  let depth = 1;
  let inString = false;
  for (let i = openBraceIdx + 1; i < masked.length; i++) {
    const ch = masked[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Parses SysML v2 textual notation into structured CST nodes (`requirement def`, `part def`,
 * `in/out port`, `action`, `connect`, `satisfy`) using comment-aware balanced brace scanning.
 */
export function parseSysml2Cst(source: string): ParsedSysml2Cst {
  const masked = maskCommentsPreservingOffsets(source, true);
  const requirementDefs: SysmlRequirementNode[] = [];
  const satisfyLinks: SysmlSatisfyNode[] = [];
  const partDefs: SysmlPartDefNode[] = [];
  const topLevelConnections: SysmlConnectionNode[] = [];

  const blockIntervals: SourceByteSpan[] = [];

  // 1. Parse `requirement [def] [<'shortId'>] <id> { ... }`
  const reqHeaderRegex = /\brequirement(?:\s+def)?\s+(?:<[^>]+>\s*)?(?:'([^']+)'|"([^"]+)"|([A-Za-z0-9_.-]+))\s*\{/g;
  let rMatch: RegExpExecArray | null;
  while ((rMatch = reqHeaderRegex.exec(masked)) !== null) {
    const id = (rMatch[1] || rMatch[2] || rMatch[3] || "").trim();
    const openBraceIdx = rMatch.index + rMatch[0].length - 1;
    const closeBraceIdx = findMatchingCloseBrace(masked, openBraceIdx);
    if (closeBraceIdx === -1) continue;

    blockIntervals.push({ start: rMatch.index, end: closeBraceIdx + 1 });
    const rawBody = source.slice(openBraceIdx + 1, closeBraceIdx);
    const maskedBody = masked.slice(openBraceIdx + 1, closeBraceIdx);

    let docText = "";
    const docMatch = /\bdoc\s*\/\*([\s\S]*?)\*\//.exec(rawBody);
    if (docMatch && docMatch[1] !== undefined) {
      docText = docMatch[1].trim();
    }

    const attributes: Record<string, string> = {};
    const attrRegex = /\battribute\s+([A-Za-z_]\w*)(?:\s*:\s*[A-Za-z_]\w*)?\s*=\s*("[^"]*"|'[^']*'|[^;]+?)\s*;/g;
    let aMatch: RegExpExecArray | null;
    while ((aMatch = attrRegex.exec(maskedBody)) !== null) {
      const aName = aMatch[1]!.trim();
      const rawVal = rawBody.slice(aMatch.index, aMatch.index + aMatch[0].length);
      const eqIdx = rawVal.indexOf("=");
      const valClean = rawVal
        .slice(eqIdx + 1)
        .replace(/;\s*$/, "")
        .trim()
        .replace(/^["']|["']$/g, "");
      attributes[aName] = valClean;
    }

    const constraints: string[] = [];
    const constraintHeaderRegex = /\b(?:require|assert)\s+constraint\s*\{/g;
    let cMatch: RegExpExecArray | null;
    while ((cMatch = constraintHeaderRegex.exec(maskedBody)) !== null) {
      const cOpen = cMatch.index + cMatch[0].length - 1;
      const cClose = findMatchingCloseBrace(maskedBody, cOpen);
      if (cClose !== -1) {
        const expr = maskedBody.slice(cOpen + 1, cClose).trim().replace(/;\s*$/, "").trim();
        if (expr) constraints.push(expr);
      }
    }

    requirementDefs.push({
      id,
      docText,
      attributes,
      constraints,
      span: { start: rMatch.index, end: closeBraceIdx + 1 },
    });
  }

  // 2. Parse `part def <Name> { ... }`
  const partHeaderRegex = /\bpart\s+def\s+(?:'([^']+)'|([A-Za-z_]\w*))\s*(?:extends\s+[^{]+)?\{/g;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = partHeaderRegex.exec(masked)) !== null) {
    const name = (pMatch[1] || pMatch[2] || "").trim();
    const openBraceIdx = pMatch.index + pMatch[0].length - 1;
    const closeBraceIdx = findMatchingCloseBrace(masked, openBraceIdx);
    if (closeBraceIdx === -1) continue;

    blockIntervals.push({ start: pMatch.index, end: closeBraceIdx + 1 });
    const maskedBody = masked.slice(openBraceIdx + 1, closeBraceIdx);
    const bodyBaseOffset = openBraceIdx + 1;

    const ports: SysmlPortNode[] = [];
    const portRegex =
      /\b(?:(in|out|inout)\s+)?port\s+([~]?[A-Za-z_]\w*)(?:\s*:\s*([~]?[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*))?\s*;/g;
    let ptMatch: RegExpExecArray | null;
    while ((ptMatch = portRegex.exec(maskedBody)) !== null) {
      const rawDir = ptMatch[1] as "in" | "out" | "inout" | undefined;
      const rawPortName = ptMatch[2]!.trim();
      const rawTypeName = (ptMatch[3] || "").trim();
      const isConjugated = rawPortName.startsWith("~") || rawTypeName.startsWith("~");
      const cleanName = rawPortName.replace(/^~/, "");
      const cleanType = rawTypeName.replace(/^~/, "");
      const direction: "in" | "out" | "inout" =
        rawDir ?? (isConjugated ? "out" : "in");
      ports.push({
        name: cleanName,
        direction,
        typeName: cleanType,
        isConjugated,
        span: { start: bodyBaseOffset + ptMatch.index, end: bodyBaseOffset + ptMatch.index + ptMatch[0].length },
      });
    }

    const actions: SysmlActionNode[] = [];
    const actionRegex = /\baction\s+([A-Za-z_]\w*)\s*;(?:\s*\/\/\s*Period:\s*([\d.]+)s)?/g;
    let actMatch: RegExpExecArray | null;
    while ((actMatch = actionRegex.exec(maskedBody)) !== null) {
      const actName = actMatch[1]!.trim();
      const periodSec = actMatch[2] !== undefined ? Number(actMatch[2]) : undefined;
      actions.push({
        name: actName,
        periodSec: periodSec !== undefined && !Number.isNaN(periodSec) ? periodSec : undefined,
        span: { start: bodyBaseOffset + actMatch.index, end: bodyBaseOffset + actMatch.index + actMatch[0].length },
      });
    }

    const connections: SysmlConnectionNode[] = [];
    const connRegex = /\b(?:connection\s+[A-Za-z_]\w*\s+)?connect\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s+to\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s*;/g;
    let cnMatch: RegExpExecArray | null;
    while ((cnMatch = connRegex.exec(maskedBody)) !== null) {
      connections.push({
        from: cnMatch[1]!.trim(),
        to: cnMatch[2]!.trim(),
        span: { start: bodyBaseOffset + cnMatch.index, end: bodyBaseOffset + cnMatch.index + cnMatch[0].length },
      });
    }

    const attributes: Record<string, string> = {};
    const attrRegex = /\battribute\s+([A-Za-z_]\w*)(?:\s*:\s*[A-Za-z_]\w*)?\s*=\s*([^;]+?)\s*;/g;
    let atMatch: RegExpExecArray | null;
    while ((atMatch = attrRegex.exec(maskedBody)) !== null) {
      attributes[atMatch[1]!.trim()] = atMatch[2]!.trim().replace(/^["']|["']$/g, "");
    }

    partDefs.push({
      name,
      ports,
      actions,
      connections,
      attributes,
      span: { start: pMatch.index, end: closeBraceIdx + 1 },
    });
  }

  // 3. Parse `satisfy <reqId> by <target>;`
  const satRegex = /\bsatisfy\s+(?:requirement\s+)?(?:'([^']+)'|"([^"]+)"|([A-Za-z0-9_.-]+))\s+by\s+([A-Za-z0-9_.:-]+)\s*;/g;
  let sMatch: RegExpExecArray | null;
  while ((sMatch = satRegex.exec(masked)) !== null) {
    const reqId = (sMatch[1] || sMatch[2] || sMatch[3] || "").trim();
    const byTarget = sMatch[4]!.trim();
    satisfyLinks.push({
      reqId,
      byTarget,
      span: { start: sMatch.index, end: sMatch.index + sMatch[0].length },
    });
  }

  // 4. Parse top-level `connect <from> to <to>;` outside `part def` blocks
  const topConnRegex = /\b(?:connection\s+[A-Za-z_]\w*\s+)?connect\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s+to\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s*;/g;
  let tcMatch: RegExpExecArray | null;
  while ((tcMatch = topConnRegex.exec(masked)) !== null) {
    const idx = tcMatch.index;
    const insideBlock = blockIntervals.some((b) => idx >= b.start && idx < b.end);
    if (!insideBlock) {
      topLevelConnections.push({
        from: tcMatch[1]!.trim(),
        to: tcMatch[2]!.trim(),
        span: { start: idx, end: idx + tcMatch[0].length },
      });
    }
  }

  return {
    requirementDefs,
    satisfyLinks,
    partDefs,
    topLevelConnections,
  };
}

/**
 * Converts a `ParsedModelicaCst` into a `PolyglotNode` graph suitable for `PolyglotTransformer`.
 */
export function modelicaCstToPolyglotGraph(cst: ParsedModelicaCst): PolyglotNode {
  return {
    kind: "ModelDefinition",
    name: cst.modelName,
    properties: {
      name: cst.modelName,
      docstring: cst.docstring,
    },
    children: cst.components.map((c) => ({
      kind: "ModelicaComponent",
      name: c.name,
      typeSpecifier: c.typeSpecifier,
      causality: c.causality,
      variability: c.variability,
      modifications: c.modifications,
      properties: {
        name: c.name,
        typeSpecifier: c.typeSpecifier,
        causality: c.causality,
        variability: c.variability,
        ...c.modifications,
        ...(c.bindingExpr !== undefined ? { start: c.bindingExpr, bindingExpr: c.bindingExpr } : {}),
        ...(c.description !== undefined ? { description: c.description } : {}),
      },
    })),
    connections: cst.connections.map((cn) => ({
      source: cn.from,
      target: cn.to,
    })),
    equations: cst.equations.map((eq) => eq.text),
  };
}

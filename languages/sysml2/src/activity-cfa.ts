// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Unified Control Flow (CFA) & Data Flow Analysis (DFA) Engine.
 *
 * Implements compiler-grade CFA/DFA for SysML v2 / KerML behavioral actions:
 *   1. CST and QueryDB native extraction for action definitions, usages, and control nodes.
 *   2. Classical iterative dataflow framework over action CFG basic blocks:
 *      - Path-sensitive Definite Assignment over decision/merge branches.
 *      - Use-Before-Def (uninitialized variable reads) detection.
 *   3. Van der Aalst Petri Net Workflow Soundness (WF-net):
 *      - Join-Decide deadlock detection (unmerged decision paths).
 *      - Reachability / dead action detection.
 *      - Option to complete and proper termination.
 *   4. Item Flow / Pin typing and dimensional compatibility checking.
 */

import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import {
  collectCstLeaves,
  type CstLeaf,
  extractLastNameSegment,
  findMatchingBraceLeaf,
  isSysmlIdentLeaf,
  parseSysmlSource,
  readDottedChainFromLeaves,
  sliceBetweenLeaves,
} from "./cst-utils.js";
import { resolveFeatureInScope } from "./queries.js";

function isSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

function isIdentChar(ch: string | undefined): boolean {
  if (!ch) return false;
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_";
}

function isIdentOrTypeChar(ch: string | undefined): boolean {
  if (!ch) return false;
  return isIdentChar(ch) || ch === "." || ch === ":";
}

/**
 * Replaces block comments (`/* ... * /`), line comments (`// ...`), and double-quoted string literals (`"..."`)
 * with spaces of identical character length so lexical scanning preserves exact source byte/char offsets.
 */
function maskCommentsAndStrings(src: string): string {
  const chars = src.split("");
  let i = 0;
  const len = chars.length;
  while (i < len) {
    const c = chars[i];
    const next = chars[i + 1];
    if (c === "/" && next === "*") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 2;
      while (i < len) {
        if (chars[i] === "*" && chars[i + 1] === "/") {
          chars[i] = " ";
          chars[i + 1] = " ";
          i += 2;
          break;
        }
        if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
        i++;
      }
      continue;
    }
    if (c === "/" && next === "/") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 2;
      while (i < len && chars[i] !== "\n") {
        if (chars[i] !== "\r") chars[i] = " ";
        i++;
      }
      continue;
    }
    if (c === '"') {
      chars[i] = " ";
      i++;
      while (i < len) {
        if (chars[i] === "\\" && i + 1 < len) {
          chars[i] = " ";
          chars[i + 1] = " ";
          i += 2;
          continue;
        }
        const isClose = chars[i] === '"';
        if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
        i++;
        if (isClose) break;
      }
      continue;
    }
    i++;
  }
  return chars.join("");
}

function extractIdentifiers(expr: string): string[] {
  const masked = maskCommentsAndStrings(expr);
  const idents: string[] = [];
  let i = 0;
  const len = masked.length;
  while (i < len) {
    const ch = masked[i]!;
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      const start = i;
      i++;
      while (i < len && isIdentChar(masked[i])) {
        i++;
      }
      idents.push(masked.slice(start, i));
    } else {
      i++;
    }
  }
  return idents;
}

export interface ActionPinInfo {
  name: string;
  direction: "in" | "out" | "inout" | "return";
  type?: string | undefined;
  hasDefault?: boolean | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface ActionAssignmentInfo {
  target: string;
  expr: string;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface ActivityNodeInfo {
  name: string;
  kind: "action" | "merge" | "decide" | "fork" | "join" | "initial" | "final";
  calleeTypeName?: string | undefined;
  isInvocation?: boolean | undefined;
  inputs: ActionPinInfo[];
  outputs: ActionPinInfo[];
  assignments: ActionAssignmentInfo[];
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface ActivityFlowInfo {
  source: string;
  target: string;
  kind: "control" | "object";
  guard?: string | undefined;
  itemType?: string | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface ActivityGraph {
  name: string;
  nodes: ActivityNodeInfo[];
  flows: ActivityFlowInfo[];
  declaredOutputs: ActionPinInfo[];
  enclosingOutputs?: ActionPinInfo[] | undefined;
  topLevelAssignments?: ActionAssignmentInfo[] | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface CfaDiagnostic {
  severity: "error" | "warning" | "info";
  rule: string;
  nodeName: string;
  message: string;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface ActivityCfaResult {
  isSound: boolean;
  isDefiniteAssigned: boolean;
  diagnostics: CfaDiagnostic[];
  deadlockNodes: string[];
  unreachableActions: string[];
  unassignedOutputs: string[];
  uninitializedReads: { variable: string; nodeName: string }[];
  summary: string;
}

export interface InterproceduralCfaResult {
  isSound: boolean;
  diagnostics: CfaDiagnostic[];
  callGraph: Map<string, string[]>;
  activityResults: Map<string, ActivityCfaResult>;
  summary: string;
}

/**
 * Extracts balanced-brace block content, respecting quotes and comments.
 */
export function extractBalancedBlock(str: string, openBracePos: number): { body: string; endPos: number } {
  let depth = 1;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let i = openBracePos + 1;

  while (i < str.length && depth > 0) {
    const c = str[i];
    const next = str[i + 1];

    if (inLineComment) {
      if (c === "\n") inLineComment = false;
    } else if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
    } else if (inString) {
      if (c === "\\" && next) {
        i++;
      } else if (c === '"') {
        inString = false;
      }
    } else {
      if (c === "/" && next === "/") {
        inLineComment = true;
        i++;
      } else if (c === "/" && next === "*") {
        inBlockComment = true;
        i++;
      } else if (c === '"') {
        inString = true;
      } else if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0) {
          return { body: str.slice(openBracePos + 1, i), endPos: i + 1 };
        }
      }
    }
    i++;
  }
  return { body: str.slice(openBracePos + 1), endPos: str.length };
}

function parseOptionalFlowGuard(
  leaves: readonly CstLeaf[],
  idx: number,
  sourceText: string,
  requireSemicolon: boolean,
): { guard?: string | undefined; endOffset: number } | null {
  const cur = leaves[idx];
  if (!cur) {
    return requireSemicolon ? null : { endOffset: sourceText.length };
  }
  if (cur.text === ";") {
    return { endOffset: cur.end };
  }
  if (cur.text === "if") {
    for (let j = idx + 1; j < leaves.length; j++) {
      const tok = leaves[j]!.text;
      if (tok === ";") {
        const guard = sliceBetweenLeaves(sourceText, cur, leaves[j]!);
        return guard ? { guard, endOffset: leaves[j]!.end } : null;
      }
      if (tok === "{" || tok === "}") return null;
    }
    if (!requireSemicolon && idx + 1 < leaves.length) {
      const guard = sourceText.slice(cur.end).trim();
      return guard ? { guard, endOffset: sourceText.length } : null;
    }
  }
  return requireSemicolon ? null : { endOffset: cur.end };
}

const PIN_FORBIDDEN_NAMES = new Set([
  "def",
  "action",
  "item",
  "attribute",
  "ref",
  "doc",
  "comment",
  "first",
  "then",
  "if",
  "else",
  "assign",
  "for",
  "while",
  "loop",
  "until",
  "return",
  "perform",
  "accept",
  "send",
  "decide",
  "merge",
  "fork",
  "join",
  "flow",
  "succession",
]);

function isAtStatementBoundary(src: string, pos: number): boolean {
  let k = pos - 1;
  while (k >= 0 && isSpace(src[k])) k--;
  if (k < 0) return true;
  const prev = src[k]!;
  if (prev === ";" || prev === "{" || prev === "}" || prev === "(" || prev === ",") {
    return true;
  }
  // Allow optional visibility prefix (`public` / `private` / `protected`)
  if (isIdentChar(prev)) {
    const end = k + 1;
    while (k >= 0 && isIdentChar(src[k])) k--;
    const word = src.slice(k + 1, end);
    if (word === "public" || word === "private" || word === "protected") {
      return isAtStatementBoundary(src, k + 1);
    }
  }
  return false;
}

function extractTopLevelBraceZeroLeaves(leaves: readonly CstLeaf[]): CstLeaf[] {
  const out: CstLeaf[] = [];
  let braceDepth = 0;
  for (const lf of leaves) {
    if (lf.text === "{") {
      braceDepth++;
      continue;
    }
    if (lf.text === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (braceDepth === 0) out.push(lf);
  }
  return out;
}

function extractSuccessionsFromLeaves(
  leaves: readonly CstLeaf[],
  sourceText: string,
  requireSemicolon: boolean,
  initialDecideName?: string,
): ActivityFlowInfo[] {
  const out: ActivityFlowInfo[] = [];
  let lastDecideName = initialDecideName;
  let braceDepth = 0;

  for (let i = 0; i < leaves.length; i++) {
    const kw = leaves[i]!.text;
    if (kw === "{") {
      braceDepth++;
      continue;
    }
    if (kw === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (braceDepth > 0) continue;

    if (kw === "decide" && isSysmlIdentLeaf(leaves[i + 1]?.text)) {
      lastDecideName = leaves[i + 1]!.text;
      continue;
    }

    if (kw === "first" || kw === "succession") {
      let p = i + 1;
      if (kw === "succession") {
        if (leaves[p]?.text === "first") {
          p++;
        } else {
          const maybeName = readDottedChainFromLeaves(leaves, p);
          if (maybeName && leaves[maybeName.nextIdx]?.text === "first") {
            p = maybeName.nextIdx + 1;
          }
        }
      }
      const src = readDottedChainFromLeaves(leaves, p);
      if (!src) continue;

      if (leaves[src.nextIdx]?.text === "then") {
        const tgt = readDottedChainFromLeaves(leaves, src.nextIdx + 1);
        if (!tgt) continue;
        const after = parseOptionalFlowGuard(leaves, tgt.nextIdx, sourceText, requireSemicolon);
        if (!after) continue;
        out.push({
          source: src.text,
          target: tgt.text,
          kind: "control",
          guard: after.guard,
          startOffset: leaves[i]!.start,
          endOffset: after.endOffset,
        });
        i = tgt.nextIdx - 1;
        continue;
      }

      // `first <src> if <guard> then <tgt>;`
      if (leaves[src.nextIdx]?.text === "if") {
        const ifLeaf = leaves[src.nextIdx]!;
        let thenIdx = -1;
        let pDepth = 0;
        for (let j = src.nextIdx + 1; j < leaves.length; j++) {
          const jt = leaves[j]!.text;
          if (jt === "(" || jt === "[") pDepth++;
          else if (jt === ")" || jt === "]") pDepth = Math.max(0, pDepth - 1);
          else if (pDepth === 0) {
            if (jt === "then") {
              thenIdx = j;
              break;
            }
            if (jt === ";" || jt === "{" || jt === "}") break;
          }
        }
        if (thenIdx > src.nextIdx + 1) {
          const guard = sliceBetweenLeaves(sourceText, ifLeaf, leaves[thenIdx]!);
          const tgt = readDottedChainFromLeaves(leaves, thenIdx + 1);
          if (guard && tgt) {
            const endOff = leaves[tgt.nextIdx]?.text === ";" ? leaves[tgt.nextIdx]!.end : leaves[tgt.nextIdx - 1]!.end;
            if (!requireSemicolon || leaves[tgt.nextIdx]?.text === ";") {
              out.push({
                source: src.text,
                target: tgt.text,
                kind: "control",
                guard,
                startOffset: leaves[i]!.start,
                endOffset: endOff,
              });
              i = tgt.nextIdx - 1;
              continue;
            }
          }
        }
      }

      // `first <src> else then <tgt>;`
      if (leaves[src.nextIdx]?.text === "else" && leaves[src.nextIdx + 1]?.text === "then") {
        const tgt = readDottedChainFromLeaves(leaves, src.nextIdx + 2);
        if (tgt && (!requireSemicolon || leaves[tgt.nextIdx]?.text === ";")) {
          const endOff = leaves[tgt.nextIdx]?.text === ";" ? leaves[tgt.nextIdx]!.end : leaves[tgt.nextIdx - 1]!.end;
          out.push({
            source: src.text,
            target: tgt.text,
            kind: "control",
            guard: "else",
            startOffset: leaves[i]!.start,
            endOffset: endOff,
          });
          i = tgt.nextIdx - 1;
          continue;
        }
      }
    } else if (kw === "else" && leaves[i + 1]?.text === "then" && lastDecideName) {
      // SysML v2 `else then <target>;` fallback succession from preceding DecisionNode
      const tgt = readDottedChainFromLeaves(leaves, i + 2);
      if (tgt && (!requireSemicolon || leaves[tgt.nextIdx]?.text === ";")) {
        const endOff = leaves[tgt.nextIdx]?.text === ";" ? leaves[tgt.nextIdx]!.end : leaves[tgt.nextIdx - 1]!.end;
        out.push({
          source: lastDecideName,
          target: tgt.text,
          kind: "control",
          guard: "else",
          startOffset: leaves[i]!.start,
          endOffset: endOff,
        });
        i = tgt.nextIdx - 1;
      }
    } else if (
      kw === "if" &&
      lastDecideName &&
      (i === 0 || leaves[i - 1]?.text === ";" || leaves[i - 1]?.text === "{")
    ) {
      // Shorthand decision succession `if <guard> then <target>;` (distinct from `IfNode` which has `{`)
      let thenIdx = -1;
      let pDepth = 0;
      for (let j = i + 1; j < leaves.length; j++) {
        const jt = leaves[j]!.text;
        if (jt === "(" || jt === "[") pDepth++;
        else if (jt === ")" || jt === "]") pDepth = Math.max(0, pDepth - 1);
        else if (pDepth === 0) {
          if (jt === "then") {
            thenIdx = j;
            break;
          }
          if (jt === ";" || jt === "{" || jt === "}") break;
        }
      }
      if (thenIdx > i + 1) {
        const guard = sliceBetweenLeaves(sourceText, leaves[i]!, leaves[thenIdx]!);
        const tgt = readDottedChainFromLeaves(leaves, thenIdx + 1);
        if (guard && tgt && leaves[tgt.nextIdx]?.text === ";") {
          out.push({
            source: lastDecideName,
            target: tgt.text,
            kind: "control",
            guard,
            startOffset: leaves[i]!.start,
            endOffset: leaves[tgt.nextIdx]!.end,
          });
          i = tgt.nextIdx;
        }
      }
    } else if (kw === "flow") {
      let p = i + 1;
      if (leaves[p]?.text === "of") {
        const ofType = readDottedChainFromLeaves(leaves, p + 1);
        if (!ofType) continue;
        p = ofType.nextIdx;
      }
      let src: { text: string; nextIdx: number } | null = null;
      if (leaves[p]?.text === "from") {
        src = readDottedChainFromLeaves(leaves, p + 1);
      } else {
        // Optional flow usage name / typing before `from`, or shorthand `flow <src> to <tgt>`
        const firstChain = readDottedChainFromLeaves(leaves, p);
        if (firstChain) {
          if (leaves[firstChain.nextIdx]?.text === "to") {
            src = firstChain;
          } else {
            let scan = firstChain.nextIdx;
            if (leaves[scan]?.text === ":") {
              const tc = readDottedChainFromLeaves(leaves, scan + 1);
              if (tc) scan = tc.nextIdx;
            }
            if (leaves[scan]?.text === "of") {
              const ofType = readDottedChainFromLeaves(leaves, scan + 1);
              if (ofType) scan = ofType.nextIdx;
            }
            if (leaves[scan]?.text === "from") {
              src = readDottedChainFromLeaves(leaves, scan + 1);
            }
          }
        }
      }
      if (!src || leaves[src.nextIdx]?.text !== "to") continue;
      const tgt = readDottedChainFromLeaves(leaves, src.nextIdx + 1);
      if (!tgt) continue;
      const after = parseOptionalFlowGuard(leaves, tgt.nextIdx, sourceText, requireSemicolon);
      if (!after) continue;
      out.push({
        source: src.text,
        target: tgt.text,
        kind: "object",
        guard: after.guard,
        startOffset: leaves[i]!.start,
        endOffset: after.endOffset,
      });
    }
  }
  return out;
}

function collectPinsFromLeaves(leaves: readonly CstLeaf[], allowKindPrefix: boolean): ActionPinInfo[] {
  const pins: ActionPinInfo[] = [];
  for (let i = 0; i < leaves.length; i++) {
    const dir = leaves[i]!.text;
    if (dir !== "in" && dir !== "out" && dir !== "inout") continue;
    if (i > 0) {
      const prev = leaves[i - 1]!.text;
      if (
        prev !== ";" &&
        prev !== "{" &&
        prev !== "}" &&
        prev !== "(" &&
        prev !== "," &&
        prev !== "public" &&
        prev !== "private" &&
        prev !== "protected"
      ) {
        continue;
      }
    }
    let p = i + 1;
    if (
      allowKindPrefix &&
      (leaves[p]?.text === "item" || leaves[p]?.text === "attribute" || leaves[p]?.text === "ref") &&
      isSysmlIdentLeaf(leaves[p + 1]?.text)
    ) {
      p++;
    }
    const pName = leaves[p]?.text;
    if (!isSysmlIdentLeaf(pName) || PIN_FORBIDDEN_NAMES.has(pName)) continue;
    p++;
    let pType: string | undefined;
    if (leaves[p]?.text === ":") {
      const tc = readDottedChainFromLeaves(leaves, p + 1);
      if (tc) {
        pType = tc.text;
        p = tc.nextIdx;
      }
    }
    let hasDefault = false;
    for (let k = p; k < leaves.length; k++) {
      const kt = leaves[k]!.text;
      if (kt === ";" || kt === "{" || kt === "}" || kt === "," || kt === ")") break;
      if (kt === "=" || kt === ":=" || kt === "default") {
        hasDefault = true;
        break;
      }
    }
    pins.push({ name: pName, direction: dir, type: pType, hasDefault });
  }
  return pins;
}

function collectAssignmentsFromLeaves(leaves: readonly CstLeaf[], sourceText: string): ActionAssignmentInfo[] {
  const assignments: ActionAssignmentInfo[] = [];
  for (let i = 0; i < leaves.length; i++) {
    if (leaves[i]!.text !== "assign") continue;
    let semiIdx = -1;
    for (let s = i + 1; s < leaves.length; s++) {
      const tok = leaves[s]!.text;
      if (tok === ";") {
        semiIdx = s;
        break;
      }
      if (tok === "{" || tok === "}") break;
    }
    if (semiIdx === -1) continue;

    let walrusIdx = -1;
    let revIdx = -1;
    let revEndIdx = -1;
    for (let j = i + 1; j < semiIdx; j++) {
      const tok = leaves[j]!.text;
      if (tok === ":=" && walrusIdx === -1) {
        walrusIdx = j;
      } else if (tok === "=:" && revIdx === -1) {
        revIdx = j;
        revEndIdx = j;
      } else if (tok === "=" && leaves[j + 1]?.text === ":" && j + 1 < semiIdx && revIdx === -1) {
        revIdx = j;
        revEndIdx = j + 1;
      }
    }

    if (walrusIdx === i + 2 && isSysmlIdentLeaf(leaves[i + 1]?.text) && walrusIdx + 1 < semiIdx) {
      const expr = sliceBetweenLeaves(sourceText, leaves[walrusIdx]!, leaves[semiIdx]!);
      if (expr) assignments.push({ target: leaves[i + 1]!.text, expr });
    } else if (revIdx !== -1 && revEndIdx + 1 < semiIdx && isSysmlIdentLeaf(leaves[semiIdx - 1]?.text)) {
      const target = leaves[semiIdx - 1]!.text;
      const expr = sliceBetweenLeaves(sourceText, leaves[i]!, leaves[revIdx]!);
      if (expr && !assignments.some((a) => a.target === target)) {
        assignments.push({ target, expr });
      }
    } else if (walrusIdx > i + 2 && walrusIdx === semiIdx - 2 && isSysmlIdentLeaf(leaves[semiIdx - 1]?.text)) {
      const target = leaves[semiIdx - 1]!.text;
      const expr = sliceBetweenLeaves(sourceText, leaves[i]!, leaves[walrusIdx]!);
      if (expr && !assignments.some((a) => a.target === target)) {
        assignments.push({ target, expr });
      }
    }
  }
  return assignments;
}

function parsePinMetadataFromText(text: string): {
  direction?: "in" | "out" | "inout" | "return" | undefined;
  type?: string | undefined;
  hasDefault: boolean;
} {
  const leaves = collectCstLeaves(parseSysmlSource(text));
  let idx = 0;
  const first = leaves[idx]?.text;
  if (first === "public" || first === "private" || first === "protected") idx++;
  const dirTok = leaves[idx]?.text;
  const direction =
    dirTok === "in" || dirTok === "out" || dirTok === "inout" || dirTok === "return" ? dirTok : undefined;
  let type: string | undefined;
  const colonIdx = leaves.findIndex((l) => l.text === ":");
  if (colonIdx !== -1) {
    const tc = readDottedChainFromLeaves(leaves, colonIdx + 1);
    if (tc) type = tc.text;
  }
  const hasDefault = leaves.some((l) => l.text === "=" || l.text === ":=" || l.text === "default");
  return { direction, type, hasDefault };
}

/**
 * Parses textual SysML v2 source into a normalized ActivityGraph.
 * Handles nested action defs, control nodes, balanced blocks, and successions.
 */
export function extractActivityGraphFromText(sysmlSource: string): ActivityGraph {
  const nodes: ActivityNodeInfo[] = [];
  const flows: ActivityFlowInfo[] = [];
  const declaredOutputs: ActionPinInfo[] = [];
  const enclosingOutputs: ActionPinInfo[] = [];

  const allLeaves = collectCstLeaves(parseSysmlSource(sysmlSource));
  let containerName = "Activity";
  let searchLeaves = allLeaves;
  let hasEnclosingActionDef = false;

  // 1. Check if enclosed in action def <Name> ... { ... }
  for (let i = 0; i + 3 < allLeaves.length; i++) {
    if (
      allLeaves[i]!.text === "action" &&
      allLeaves[i + 1]!.text === "def" &&
      isSysmlIdentLeaf(allLeaves[i + 2]!.text)
    ) {
      let openBrace = -1;
      for (let j = i + 3; j < allLeaves.length; j++) {
        if (allLeaves[j]!.text === "{") {
          openBrace = j;
          break;
        }
        if (allLeaves[j]!.text === ";") break;
      }
      if (openBrace !== -1) {
        containerName = allLeaves[i + 2]!.text;
        const closeIdx = findMatchingBraceLeaf(allLeaves, openBrace);
        // Also collect formal parameter list pins if `action def Name(in x : Real, out y : Real)`
        const headerParamLeaves = allLeaves.slice(i + 3, openBrace);
        for (const pin of collectPinsFromLeaves(headerParamLeaves, true)) {
          declaredOutputs.push(pin);
          if (pin.direction === "out" || pin.direction === "inout") {
            enclosingOutputs.push(pin);
          }
        }
        searchLeaves = allLeaves.slice(openBrace + 1, closeIdx);
        hasEnclosingActionDef = true;
        break;
      }
    }
  }

  const topLevelLeaves = extractTopLevelBraceZeroLeaves(searchLeaves);

  // 1b. Extract top-level action def pins at brace-depth 0
  if (hasEnclosingActionDef) {
    for (const pin of collectPinsFromLeaves(topLevelLeaves, true)) {
      if (!declaredOutputs.some((p) => p.name === pin.name)) {
        declaredOutputs.push(pin);
      }
      if (
        (pin.direction === "out" || pin.direction === "inout") &&
        !enclosingOutputs.some((p) => p.name === pin.name)
      ) {
        enclosingOutputs.push(pin);
      }
    }
  }

  const topLevelAssignments = collectAssignmentsFromLeaves(topLevelLeaves, sysmlSource);

  // 2. Extract action usages: action [name] { ... } or action [name]; or perform [action] [name]
  for (let k = 0; k < searchLeaves.length; k++) {
    const cur = searchLeaves[k]!.text;
    let isPerform = false;
    let hasActionKw = false;
    let nameIdx = -1;

    if (cur === "perform") {
      isPerform = true;
      if (searchLeaves[k + 1]?.text === "action" && isSysmlIdentLeaf(searchLeaves[k + 2]?.text)) {
        hasActionKw = true;
        nameIdx = k + 2;
      } else if (isSysmlIdentLeaf(searchLeaves[k + 1]?.text)) {
        nameIdx = k + 1;
      }
    } else if (cur === "action" && searchLeaves[k + 1]?.text !== "def" && isSysmlIdentLeaf(searchLeaves[k + 1]?.text)) {
      hasActionKw = true;
      nameIdx = k + 1;
    }

    if (nameIdx === -1) continue;
    const name = searchLeaves[nameIdx]!.text;

    let endDeclIdx = -1;
    for (let p = nameIdx + 1; p < searchLeaves.length; p++) {
      const t = searchLeaves[p]!.text;
      if (t === "{" || t === ";") {
        endDeclIdx = p;
        break;
      }
    }
    if (endDeclIdx === -1) continue;

    let typeMatchName: string | undefined;
    for (let p = nameIdx + 1; p < endDeclIdx; p++) {
      if (searchLeaves[p]!.text === ":") {
        const tc = readDottedChainFromLeaves(searchLeaves, p + 1);
        if (tc) typeMatchName = tc.text;
        break;
      }
    }
    const calleeTypeName = typeMatchName ?? (isPerform && !hasActionKw ? name : undefined);
    const isInvocation = Boolean(calleeTypeName);

    let bodyLeaves: CstLeaf[] = [];
    let endLeafIdx = endDeclIdx;
    if (searchLeaves[endDeclIdx]!.text === "{") {
      endLeafIdx = findMatchingBraceLeaf(searchLeaves, endDeclIdx);
      bodyLeaves = searchLeaves.slice(endDeclIdx + 1, endLeafIdx);
    }

    const inputs: ActionPinInfo[] = [];
    const outputs: ActionPinInfo[] = [];
    for (const pinInfo of collectPinsFromLeaves(bodyLeaves, true)) {
      if (pinInfo.direction === "in") {
        inputs.push(pinInfo);
      } else {
        outputs.push(pinInfo);
        if (!declaredOutputs.some((p) => p.name === pinInfo.name)) {
          declaredOutputs.push(pinInfo);
        }
      }
    }

    const assignments = collectAssignmentsFromLeaves(bodyLeaves, sysmlSource);

    nodes.push({
      name,
      kind: "action",
      calleeTypeName,
      isInvocation,
      inputs,
      outputs,
      assignments,
      startOffset: searchLeaves[k]!.start,
      endOffset: searchLeaves[endLeafIdx]!.end,
    });
    k = endLeafIdx;
  }

  // 3. Extract control nodes: (merge|decide|fork|join) [name];
  for (let k = 0; k + 2 < searchLeaves.length; k++) {
    const kind = searchLeaves[k]!.text;
    const name = searchLeaves[k + 1]!.text;
    if (
      (kind === "merge" || kind === "decide" || kind === "fork" || kind === "join") &&
      isSysmlIdentLeaf(name) &&
      searchLeaves[k + 2]!.text === ";"
    ) {
      nodes.push({
        name,
        kind,
        inputs: [],
        outputs: [],
        assignments: [],
        startOffset: searchLeaves[k]!.start,
        endOffset: searchLeaves[k + 2]!.end,
      });
    }
  }

  // 3b. Extract decide blocks: decide [name] { case [guard] => ... | if [guard] then [target]; | else then [target]; }
  for (let k = 0; k + 2 < searchLeaves.length; k++) {
    if (
      searchLeaves[k]!.text !== "decide" ||
      !isSysmlIdentLeaf(searchLeaves[k + 1]!.text) ||
      searchLeaves[k + 2]!.text !== "{"
    ) {
      continue;
    }
    const decideName = searchLeaves[k + 1]!.text;
    const closeIdx = findMatchingBraceLeaf(searchLeaves, k + 2);
    nodes.push({
      name: decideName,
      kind: "decide",
      inputs: [],
      outputs: [],
      assignments: [],
      startOffset: searchLeaves[k]!.start,
      endOffset: searchLeaves[closeIdx]!.end,
    });

    const body = searchLeaves.slice(k + 3, closeIdx);
    let caseIdx = 1;
    let armStart = 0;
    while (armStart < body.length) {
      let semiIdx = armStart;
      while (semiIdx < body.length && body[semiIdx]!.text !== ";") semiIdx++;
      if (semiIdx >= body.length) break;

      const head = body[armStart]!.text;
      if (head === "case" || head === "else" || head === "default") {
        // Also support `else then <existingTarget>;` directly inside `decide d { ... }`
        if ((head === "else" || head === "default") && body[armStart + 1]?.text === "then") {
          const tgt = readDottedChainFromLeaves(body, armStart + 2);
          if (tgt && tgt.nextIdx === semiIdx) {
            flows.push({
              source: decideName,
              target: tgt.text,
              kind: "control",
              guard: "else",
              startOffset: body[armStart]!.start,
              endOffset: body[semiIdx]!.end,
            });
            armStart = semiIdx + 1;
            continue;
          }
        }

        let sepIdx = -1;
        let sepEndIdx = -1;
        for (let s = armStart + 1; s < semiIdx; s++) {
          const t = body[s]!.text;
          if (t === "=>" || t === "then") {
            sepIdx = s;
            sepEndIdx = s;
            break;
          }
          if (t === "=" && body[s + 1]?.text === ">" && s + 1 < semiIdx) {
            sepIdx = s;
            sepEndIdx = s + 1;
            break;
          }
          if (t === ":" && body[s + 1]?.text !== "=") {
            sepIdx = s;
            sepEndIdx = s + 1;
            break;
          }
        }
        if (sepIdx !== -1 && sepEndIdx + 1 < semiIdx) {
          const guardStr = head === "case" ? sliceBetweenLeaves(sysmlSource, body[armStart]!, body[sepIdx]!) : head;
          if (guardStr) {
            const targetName = `${decideName}_case_${caseIdx++}`;
            const startOff = body[armStart]!.start;
            const endOff = body[semiIdx]!.end;
            nodes.push({
              name: targetName,
              kind: "action",
              inputs: [],
              outputs: [],
              assignments: [],
              startOffset: startOff,
              endOffset: endOff,
            });
            flows.push({
              source: decideName,
              target: targetName,
              kind: "control",
              guard: guardStr,
              startOffset: startOff,
              endOffset: endOff,
            });
          }
        }
      } else if (head === "if" || head === "first" || head === "succession") {
        const subFlows = extractSuccessionsFromLeaves(body.slice(armStart, semiIdx + 1), sysmlSource, true, decideName);
        flows.push(...subFlows);
      } else if (head === "then") {
        const tgt = readDottedChainFromLeaves(body, armStart + 1);
        if (tgt && tgt.nextIdx === semiIdx) {
          flows.push({
            source: decideName,
            target: tgt.text,
            kind: "control",
            startOffset: body[armStart]!.start,
            endOffset: body[semiIdx]!.end,
          });
        }
      }
      armStart = semiIdx + 1;
    }
    k = closeIdx;
  }

  // 4. Extract top-level successions and flows
  for (const flow of extractSuccessionsFromLeaves(searchLeaves, sysmlSource, true)) {
    flows.push(flow);
  }

  return {
    name: containerName,
    nodes,
    flows,
    declaredOutputs,
    enclosingOutputs,
    topLevelAssignments,
    startOffset: 0,
    endOffset: sysmlSource.length,
  };
}

/**
 * Extracts ActivityGraph directly from a Salsa QueryDB and SymbolEntry.
 */
export function extractActivityGraphFromQueryDB(db: QueryDB, actionSymbol: SymbolEntry): ActivityGraph {
  const nodes: ActivityNodeInfo[] = [];
  const flows: ActivityFlowInfo[] = [];
  const declaredOutputs: ActionPinInfo[] = [];
  const enclosingOutputs: ActionPinInfo[] = [];
  const topLevelAssignments: ActionAssignmentInfo[] = [];

  const children = db.childrenOf(actionSymbol.id);
  let lastDecideName: string | undefined;

  for (const child of children) {
    const rule = child.ruleName;
    const rawName = child.name;

    if (rule === "SuccessionAsUsage" || rule === "SuccessionFlowUsage" || rule === "FlowUsage") {
      const text = db.cstText(child.startOffset, child.endOffset, child) || "";
      const parsed = extractSuccessionsFromLeaves(
        collectCstLeaves(parseSysmlSource(text)),
        text,
        false,
        lastDecideName,
      );
      const match = parsed[0];
      if (match) {
        flows.push({
          source: match.source,
          target: match.target,
          kind: rule === "SuccessionFlowUsage" || rule === "FlowUsage" ? "object" : "control",
          guard: match.guard,
          startOffset: child.startOffset,
          endOffset: child.endOffset,
        });
      }
      continue;
    }

    // Handle top-level AssignActionNode even when anonymous (`assign y := 1;`)
    if (rule === "AssignActionNode" && (!rawName || rawName === "<anonymous>" || rawName === "AssignActionNode")) {
      const assignText = db.cstText(child.startOffset, child.endOffset, child) || "";
      const parsedAssigns = collectAssignmentsFromLeaves(collectCstLeaves(parseSysmlSource(assignText)), assignText);
      for (const a of parsedAssigns) {
        topLevelAssignments.push({
          ...a,
          startOffset: child.startOffset,
          endOffset: child.endOffset,
        });
      }
      continue;
    }

    const name = rawName;
    if (!name || name === "<anonymous>") continue;

    // Top-level action pins (in / out / inout parameters on the enclosing ActionDefinition / ActionUsage)
    if (
      rule === "ParameterMember" ||
      rule === "ReturnParameterMember" ||
      rule === "ItemUsage" ||
      rule === "AttributeUsage" ||
      rule === "ReferenceUsage" ||
      rule === "DefaultReferenceUsage"
    ) {
      const text = (db.cstText(child.startOffset, child.endOffset, child) || "").trim();
      const rawMetaDir = child.metadata?.["direction"];
      const metaDir = typeof rawMetaDir === "string" ? rawMetaDir : undefined;
      const parsedPin = parsePinMetadataFromText(text);
      const typingChild = db.childrenOf(child.id).find((c) => c.ruleName === "OwnedFeatureTyping" && c.name);
      const rawMetaType = child.metadata?.["typeSpecifier"];
      const pinType =
        typingChild?.name || (typeof rawMetaType === "string" ? rawMetaType : undefined) || parsedPin.type;
      const dir =
        rule === "ReturnParameterMember"
          ? "out"
          : ((metaDir || parsedPin.direction) as "in" | "out" | "inout" | "return" | undefined);
      if (dir) {
        const normalizedDir = dir === "return" ? "out" : dir;
        const pinInfo: ActionPinInfo = {
          name,
          direction: normalizedDir,
          type: pinType,
          hasDefault: parsedPin.hasDefault,
          startOffset: child.startOffset,
          endOffset: child.endOffset,
        };
        declaredOutputs.push(pinInfo);
        if (normalizedDir === "out" || normalizedDir === "inout") {
          enclosingOutputs.push(pinInfo);
        }
        continue;
      }
    }

    if (
      rule === "ActionUsage" ||
      rule === "PerformActionUsage" ||
      rule === "AcceptActionNode" ||
      rule === "SendActionNode" ||
      rule === "AssignActionNode"
    ) {
      const inputs: ActionPinInfo[] = [];
      const outputs: ActionPinInfo[] = [];
      const assignments: ActionAssignmentInfo[] = [];

      // Check child parameters / pin usages
      const childSymbols = db.childrenOf(child.id);
      for (const pin of childSymbols) {
        if (!pin.name || pin.name === "<anonymous>") continue;
        const text = (db.cstText(pin.startOffset, pin.endOffset, pin) || "").trim();
        const rawPinMetaDir = pin.metadata?.["direction"];
        const metaDir = typeof rawPinMetaDir === "string" ? rawPinMetaDir : undefined;
        const parsedPin = parsePinMetadataFromText(text);
        const isParamRule = pin.ruleName === "ParameterMember" || pin.ruleName === "ReturnParameterMember";
        if (!isParamRule && !metaDir && !parsedPin.direction) continue;

        const pinTyping = db.childrenOf(pin.id).find((c) => c.ruleName === "OwnedFeatureTyping" && c.name);
        const rawPinMetaType = pin.metadata?.["typeSpecifier"];
        const pinType =
          pinTyping?.name || (typeof rawPinMetaType === "string" ? rawPinMetaType : undefined) || parsedPin.type;

        const isOut =
          pin.ruleName === "ReturnParameterMember" ||
          metaDir === "out" ||
          metaDir === "inout" ||
          parsedPin.direction === "out" ||
          parsedPin.direction === "inout" ||
          parsedPin.direction === "return";
        const pinInfo: ActionPinInfo = {
          name: pin.name,
          direction: isOut ? "out" : "in",
          type: pinType,
          hasDefault: parsedPin.hasDefault,
          startOffset: pin.startOffset,
          endOffset: pin.endOffset,
        };
        if (isOut) {
          outputs.push(pinInfo);
          if (!declaredOutputs.some((p) => p.name === pinInfo.name)) {
            declaredOutputs.push(pinInfo);
          }
        } else {
          inputs.push(pinInfo);
        }
      }

      // 1. Direct CST node inspection for pins and assignments if available
      interface CstInspectNode {
        type?: string | undefined;
        name?: string | undefined;
        text?: string | undefined;
        startIndex?: number | undefined;
        endIndex?: number | undefined;
        children?: CstInspectNode[] | undefined;
        childCount?: number | undefined;
        child?(i: number): CstInspectNode | null | undefined;
        childForFieldName?(name: string): { text?: string | undefined } | null | undefined;
      }
      const cstNode = (db as { cstNode?(id: number): CstInspectNode | null | undefined }).cstNode?.(child.id);
      if (cstNode) {
        const walkCst = (n: CstInspectNode | null | undefined) => {
          if (!n) return;
          const nt = (n.type || "").toLowerCase();
          if (
            nt.includes("inusage") ||
            nt.includes("outusage") ||
            nt.includes("itemusage") ||
            nt.includes("attributeusage") ||
            nt.includes("parametermember")
          ) {
            const pName = (n.childForFieldName?.("name")?.text || n.name || "").trim();
            const nText = maskCommentsAndStrings(n.text || "").trim();
            const parsedNPin = nText ? parsePinMetadataFromText(nText) : { direction: undefined, hasDefault: false };
            const explicitInOrOut = nt.includes("inusage") || nt.includes("outusage") || Boolean(parsedNPin.direction);
            if (
              explicitInOrOut &&
              pName &&
              !PIN_FORBIDDEN_NAMES.has(pName) &&
              !inputs.some((p) => p.name === pName) &&
              !outputs.some((p) => p.name === pName)
            ) {
              const isOut =
                nt.includes("outusage") ||
                nt.includes("return") ||
                parsedNPin.direction === "out" ||
                parsedNPin.direction === "inout" ||
                parsedNPin.direction === "return";
              const pinInfo: ActionPinInfo = {
                name: pName,
                direction: isOut ? "out" : "in",
                type: parsedNPin.type,
                hasDefault: parsedNPin.hasDefault,
                startOffset: n.startIndex ?? child.startOffset,
                endOffset: n.endIndex ?? child.endOffset,
              };
              if (isOut) {
                outputs.push(pinInfo);
                if (!declaredOutputs.some((p) => p.name === pinInfo.name)) {
                  declaredOutputs.push(pinInfo);
                }
              } else {
                inputs.push(pinInfo);
              }
            }
          }
          if (nt.includes("assign")) {
            const tgt =
              n.childForFieldName?.("targetFeature")?.text ||
              n.childForFieldName?.("target")?.text ||
              n.childForFieldName?.("name")?.text;
            const expr =
              n.childForFieldName?.("assignedValue")?.text ||
              n.childForFieldName?.("value")?.text ||
              n.childForFieldName?.("expression")?.text;
            if (tgt && expr && !assignments.some((a) => a.target === tgt.trim())) {
              assignments.push({
                target: tgt.trim(),
                expr: expr.trim(),
                startOffset: n.startIndex ?? child.startOffset,
                endOffset: n.endIndex ?? child.endOffset,
              });
            }
          }
          if (Array.isArray(n.children)) {
            for (const c of n.children) walkCst(c);
          } else if (typeof n.childCount === "number" && typeof n.child === "function") {
            for (let i = 0; i < n.childCount; i++) walkCst(n.child(i));
          }
        };
        walkCst(cstNode);
      }

      // 2. Check assignments and inline pins in CST text with comments and string literals stripped
      const rawActionText = db.cstText(child.startOffset, child.endOffset, child) || "";
      const maskedActionText = maskCommentsAndStrings(rawActionText);
      const headerEnd = maskedActionText.indexOf("{");
      const headerSlice = headerEnd !== -1 ? maskedActionText.slice(0, headerEnd) : maskedActionText;

      let typeMatchVal: string | undefined = undefined;
      const colonIdx = headerSlice.indexOf(":");
      if (colonIdx !== -1 && headerSlice[colonIdx + 1] !== "=" && headerSlice[colonIdx + 1] !== ">") {
        let p = colonIdx + 1;
        while (p < headerSlice.length && isSpace(headerSlice[p])) p++;
        const s = p;
        while (p < headerSlice.length && isIdentOrTypeChar(headerSlice[p])) p++;
        if (p > s) typeMatchVal = headerSlice.slice(s, p);
      }
      const typingChild = childSymbols.find((c) => c.ruleName === "OwnedFeatureTyping" && c.name);
      const refSubsetChild =
        rule === "PerformActionUsage"
          ? childSymbols.find((c) => (c.ruleName === "OwnedReferenceSubsetting" || c.kind === "Reference") && c.name)
          : undefined;
      const headerLeaves = collectCstLeaves(parseSysmlSource(headerSlice));
      const performWithoutActionKw =
        rule === "PerformActionUsage" &&
        headerLeaves[0]?.text === "perform" &&
        headerLeaves[1]?.text !== "action" &&
        isSysmlIdentLeaf(headerLeaves[1]?.text);

      const calleeTypeName =
        (child as { typeName?: string | undefined }).typeName ||
        typingChild?.name ||
        typeMatchVal ||
        refSubsetChild?.name ||
        (performWithoutActionKw ? name : undefined);
      const isInvocation = Boolean(calleeTypeName);

      // Extract inline pins from masked bodySlice so `doc /* ... in ... out ... */` never synthesizes phantom pins
      const bodyStartIdx = maskedActionText.indexOf("{");
      if (bodyStartIdx !== -1) {
        const bodySlice = maskedActionText.slice(bodyStartIdx + 1);
        let bi = 0;
        const bLen = bodySlice.length;
        while (bi < bLen) {
          let dir: "in" | "out" | "inout" | null = null;
          let kwLen = 0;
          if (
            bodySlice.startsWith("inout", bi) &&
            !isIdentChar(bodySlice[bi + 5]) &&
            isAtStatementBoundary(bodySlice, bi)
          ) {
            dir = "inout";
            kwLen = 5;
          } else if (
            bodySlice.startsWith("out", bi) &&
            !isIdentChar(bodySlice[bi + 3]) &&
            isAtStatementBoundary(bodySlice, bi)
          ) {
            dir = "out";
            kwLen = 3;
          } else if (
            bodySlice.startsWith("in", bi) &&
            !isIdentChar(bodySlice[bi + 2]) &&
            isAtStatementBoundary(bodySlice, bi)
          ) {
            dir = "in";
            kwLen = 2;
          }

          if (dir) {
            const pStart = bi;
            bi += kwLen;
            while (bi < bLen && isSpace(bodySlice[bi])) bi++;
            for (const prefix of ["item", "attribute", "ref"]) {
              if (bodySlice.startsWith(prefix, bi) && !isIdentChar(bodySlice[bi + prefix.length])) {
                bi += prefix.length;
                while (bi < bLen && isSpace(bodySlice[bi])) bi++;
                break;
              }
            }
            const idStart = bi;
            while (bi < bLen && isIdentChar(bodySlice[bi])) bi++;
            const pName = bodySlice.slice(idStart, bi);
            if (pName && !PIN_FORBIDDEN_NAMES.has(pName)) {
              while (bi < bLen && isSpace(bodySlice[bi])) bi++;
              let pType: string | undefined = undefined;
              if (bi < bLen && bodySlice[bi] === ":" && bodySlice[bi + 1] !== "=") {
                bi++;
                while (bi < bLen && isSpace(bodySlice[bi])) bi++;
                const typeStart = bi;
                while (bi < bLen && isIdentOrTypeChar(bodySlice[bi])) bi++;
                if (bi > typeStart) pType = bodySlice.slice(typeStart, bi);
              }
              const pEnd = bi;
              let scanSemi = bi;
              let hasDef = false;
              while (
                scanSemi < bLen &&
                bodySlice[scanSemi] !== ";" &&
                bodySlice[scanSemi] !== "{" &&
                bodySlice[scanSemi] !== "}"
              ) {
                if (bodySlice[scanSemi] === "=" || bodySlice.startsWith("default", scanSemi)) {
                  hasDef = true;
                  break;
                }
                scanSemi++;
              }
              if (!inputs.some((p) => p.name === pName) && !outputs.some((p) => p.name === pName)) {
                const pinInfo: ActionPinInfo = {
                  name: pName,
                  direction: dir,
                  type: pType,
                  hasDefault: hasDef,
                  startOffset: child.startOffset + bodyStartIdx + 1 + pStart,
                  endOffset: child.startOffset + bodyStartIdx + 1 + pEnd,
                };
                if (dir === "in") {
                  inputs.push(pinInfo);
                } else {
                  outputs.push(pinInfo);
                  if (!declaredOutputs.some((p) => p.name === pinInfo.name)) {
                    declaredOutputs.push(pinInfo);
                  }
                }
              }
            }
            continue;
          }
          bi++;
        }
      }

      // Extract assignments over maskedActionText (avoiding `assign` inside comments/strings)
      let ai = 0;
      const aLen = maskedActionText.length;
      while (ai < aLen) {
        if (
          maskedActionText.startsWith("assign", ai) &&
          !isIdentChar(maskedActionText[ai + 6]) &&
          (ai === 0 || !isIdentChar(maskedActionText[ai - 1]))
        ) {
          const assignStart = ai;
          ai += 6;
          while (ai < aLen && isSpace(maskedActionText[ai])) ai++;
          const semiIdx = maskedActionText.indexOf(";", ai);
          if (semiIdx !== -1) {
            const clause = rawActionText.slice(ai, semiIdx);
            const maskedClause = maskedActionText.slice(ai, semiIdx);
            const assignWalrusIdx = maskedClause.indexOf(":=");
            const assignRevIdx = maskedClause.indexOf("=:");
            if (assignWalrusIdx !== -1) {
              const target = maskedClause.slice(0, assignWalrusIdx).trim();
              const expr = clause.slice(assignWalrusIdx + 2).trim();
              if (target && !assignments.some((a) => a.target === target)) {
                assignments.push({
                  target,
                  expr,
                  startOffset: child.startOffset + assignStart,
                  endOffset: child.startOffset + semiIdx + 1,
                });
              }
            } else if (assignRevIdx !== -1) {
              const expr = clause.slice(0, assignRevIdx).trim();
              const target = maskedClause.slice(assignRevIdx + 2).trim();
              if (target && !assignments.some((a) => a.target === target)) {
                assignments.push({
                  target,
                  expr,
                  startOffset: child.startOffset + assignStart,
                  endOffset: child.startOffset + semiIdx + 1,
                });
              }
            }
            ai = semiIdx + 1;
            continue;
          }
        }
        ai++;
      }

      nodes.push({
        name,
        kind: "action",
        calleeTypeName,
        isInvocation,
        inputs,
        outputs,
        assignments,
        startOffset: child.startOffset,
        endOffset: child.endOffset,
      });
    } else if (rule === "MergeNode" || rule === "DecisionNode" || rule === "ForkNode" || rule === "JoinNode") {
      let kind: ActivityNodeInfo["kind"] = "merge";
      if (rule === "DecisionNode") {
        kind = "decide";
        lastDecideName = name;
      } else if (rule === "ForkNode") kind = "fork";
      else if (rule === "JoinNode") kind = "join";

      nodes.push({
        name,
        kind,
        inputs: [],
        outputs: [],
        assignments: [],
        startOffset: child.startOffset,
        endOffset: child.endOffset,
      });

      // Extract inline decision block arms if `decide d { ... }` was used
      if (rule === "DecisionNode") {
        const dText = db.cstText(child.startOffset, child.endOffset, child) || "";
        if (dText.includes("{")) {
          const subGraph = extractActivityGraphFromText(dText);
          for (const subNode of subGraph.nodes) {
            if (subNode.name !== name && !nodes.some((n) => n.name === subNode.name)) {
              nodes.push({
                ...subNode,
                startOffset: child.startOffset + (subNode.startOffset ?? 0),
                endOffset: child.startOffset + (subNode.endOffset ?? dText.length),
              });
            }
          }
          for (const subFlow of subGraph.flows) {
            flows.push({
              ...subFlow,
              startOffset: child.startOffset + (subFlow.startOffset ?? 0),
              endOffset: child.startOffset + (subFlow.endOffset ?? dText.length),
            });
          }
        }
      }
    }
  }

  // Scan outer action body for `else then <target>;` or shorthand decision branches not indexed as SuccessionAsUsage
  const containerText = db.cstText(actionSymbol.startOffset, actionSymbol.endOffset, actionSymbol) || "";
  const containerOpenBrace = containerText.indexOf("{");
  if (containerOpenBrace !== -1) {
    const containerLeaves = collectCstLeaves(parseSysmlSource(containerText));
    const openLeafIdx = containerLeaves.findIndex((l) => l.start >= containerOpenBrace && l.text === "{");
    if (openLeafIdx !== -1) {
      const closeLeafIdx = findMatchingBraceLeaf(containerLeaves, openLeafIdx);
      const innerLeaves = containerLeaves.slice(openLeafIdx + 1, closeLeafIdx);
      for (const extraFlow of extractSuccessionsFromLeaves(innerLeaves, containerText, true)) {
        const duplicate = flows.some(
          (f) =>
            f.source === extraFlow.source &&
            f.target === extraFlow.target &&
            (f.guard ?? "") === (extraFlow.guard ?? ""),
        );
        if (!duplicate) {
          flows.push({
            ...extraFlow,
            startOffset: actionSymbol.startOffset + (extraFlow.startOffset ?? 0),
            endOffset: actionSymbol.startOffset + (extraFlow.endOffset ?? containerText.length),
          });
        }
      }
    }
  }

  return {
    name: actionSymbol.name || "Activity",
    nodes,
    flows,
    declaredOutputs,
    enclosingOutputs,
    topLevelAssignments,
    startOffset: actionSymbol.startOffset,
    endOffset: actionSymbol.endOffset,
  };
}

function resolveFlowNodeName(endpoint: string, nodeMap: ReadonlyMap<string, ActivityNodeInfo>): string | undefined {
  if (nodeMap.has(endpoint)) return endpoint;
  const dotIdx = endpoint.indexOf(".");
  if (dotIdx > 0) {
    const base = endpoint.slice(0, dotIdx);
    if (nodeMap.has(base)) return base;
  }
  return undefined;
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

/**
 * Performs rigorous Control Flow and Data Flow Analysis on an ActivityGraph.
 */
export function analyzeActivityCfa(graph: ActivityGraph): ActivityCfaResult {
  const diagnostics: CfaDiagnostic[] = [];
  const deadlockNodes: string[] = [];
  const unreachableActions: string[] = [];
  const unassignedOutputs: string[] = [];
  const uninitializedReads: { variable: string; nodeName: string }[] = [];

  const { nodes, flows, declaredOutputs } = graph;
  const topLevelAssignments = graph.topLevelAssignments ?? [];
  const enclosingOutputs = graph.enclosingOutputs ?? [];

  const enclosingInVars = new Set<string>(
    declaredOutputs.filter((p) => p.direction === "in" || p.direction === "inout").map((p) => p.name),
  );
  const declaredOutNames = new Set<string>(declaredOutputs.filter((p) => p.direction !== "in").map((p) => p.name));

  const nodeMap = new Map<string, ActivityNodeInfo>();
  for (const n of nodes) nodeMap.set(n.name, n);

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const n of nodes) {
    outgoing.set(n.name, []);
    incoming.set(n.name, []);
  }

  const hasExternalInputFlow = new Set<string>();
  const explicitStartTargets = new Set<string>();
  const incomingFlowPinsByNode = new Map<string, Set<string>>();

  // Normalize control successions AND pin object flows (`stepA.outPin -> stepB.inPin` connects `stepA -> stepB`)
  for (const f of flows) {
    const srcNode = resolveFlowNodeName(f.source, nodeMap);
    const tgtNode = resolveFlowNodeName(f.target, nodeMap);

    if (srcNode && tgtNode && srcNode !== tgtNode) {
      const outList = outgoing.get(srcNode)!;
      if (!outList.includes(tgtNode)) outList.push(tgtNode);
      const inList = incoming.get(tgtNode)!;
      if (!inList.includes(srcNode)) inList.push(srcNode);
    } else if (!srcNode && tgtNode) {
      const srcRoot = f.source.includes(".") ? f.source.split(".")[0]! : f.source;
      if (f.source === "start" || srcRoot === "start") {
        explicitStartTargets.add(tgtNode);
      } else if (enclosingInVars.has(f.source) || enclosingInVars.has(srcRoot)) {
        hasExternalInputFlow.add(tgtNode);
      }
    }

    if (tgtNode && f.target.startsWith(`${tgtNode}.`)) {
      const pinName = f.target.slice(tgtNode.length + 1);
      if (pinName) {
        let pinSet = incomingFlowPinsByNode.get(tgtNode);
        if (!pinSet) {
          pinSet = new Set();
          incomingFlowPinsByNode.set(tgtNode, pinSet);
        }
        pinSet.add(pinName);
      }
    }
  }

  // --- 1. Reachability & Dead Code Detection ---
  const withOut = nodes.filter((n) => (outgoing.get(n.name) || []).length > 0);
  const entryNodes = nodes.filter(
    (n) =>
      explicitStartTargets.has(n.name) ||
      ((incoming.get(n.name) || []).length === 0 &&
        ((outgoing.get(n.name) || []).length > 0 || hasExternalInputFlow.has(n.name))),
  );
  if (entryNodes.length === 0 && nodes.length > 0) {
    if (withOut.length > 0) {
      entryNodes.push(withOut[0]!);
    } else {
      entryNodes.push(nodes[0]!);
    }
  }

  const reachable = new Set<string>();
  const queue = entryNodes.map((n) => n.name);
  for (const n of queue) reachable.add(n);

  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const nxt of outgoing.get(curr) || []) {
      if (!reachable.has(nxt)) {
        reachable.add(nxt);
        queue.push(nxt);
      }
    }
  }

  for (const n of nodes) {
    if (!reachable.has(n.name) && n.kind === "action") {
      unreachableActions.push(n.name);
      diagnostics.push({
        severity: "warning",
        rule: "unreachable-action",
        nodeName: n.name,
        message: `Action '${n.name}' is disconnected or unreachable from the workflow execution path.`,
        startOffset: n.startOffset,
        endOffset: n.endOffset,
      });
    }
  }

  // --- 2. Join-Decide Deadlock Analysis ---
  const joinNodes = nodes.filter((n) => n.kind === "join");
  for (const join of joinNodes) {
    const incomingEdges = incoming.get(join.name) || [];
    if (incomingEdges.length <= 1) continue;

    const branchDecisions = new Map<string, Set<string>>();
    const branchForks = new Map<string, Set<string>>();

    for (const inEdge of incomingEdges) {
      const visited = new Set<string>();
      const decisions = new Set<string>();
      const forks = new Set<string>();
      const bQueue = [inEdge];
      visited.add(inEdge);

      while (bQueue.length > 0) {
        const curr = bQueue.shift()!;
        const currNode = nodeMap.get(curr);
        if (currNode && currNode.kind === "decide") {
          decisions.add(curr);
        }
        if (currNode && currNode.kind === "fork") {
          forks.add(curr);
        }
        if (currNode && currNode.kind === "merge") {
          continue; // Intervening merge reconciles the branch
        }

        for (const pred of incoming.get(curr) || []) {
          if (!visited.has(pred)) {
            visited.add(pred);
            bQueue.push(pred);
          }
        }
      }
      branchDecisions.set(inEdge, decisions);
      branchForks.set(inEdge, forks);
    }

    const inKeys = Array.from(branchDecisions.keys());
    for (let i = 0; i < inKeys.length; i++) {
      for (let j = i + 1; j < inKeys.length; j++) {
        // If both incoming branches share a common fork node, they are concurrent parallel paths
        const f1 = branchForks.get(inKeys[i]!)!;
        const f2 = branchForks.get(inKeys[j]!)!;
        const sharesCommonFork = Array.from(f1).some((f) => f2.has(f));
        if (sharesCommonFork) continue;

        const d1 = branchDecisions.get(inKeys[i]!)!;
        const d2 = branchDecisions.get(inKeys[j]!)!;
        for (const d of d1) {
          if (d2.has(d)) {
            deadlockNodes.push(join.name);
            diagnostics.push({
              severity: "error",
              rule: "join-decide-deadlock",
              nodeName: join.name,
              message: `Join deadlock: join node '${join.name}' synchronizes mutually exclusive paths originating from decision node '${d}' without an intervening merge node.`,
              startOffset: join.startOffset,
              endOffset: join.endOffset,
            });
            break;
          }
        }
      }
    }
  }

  // --- 3. Path-Sensitive Definite Assignment & Use-Before-Def Analysis ---
  // Iterative forward must-dataflow over the reachability graph:
  //   InSet(u) = ⋃_{p ∈ Pred(u)} OutSet(p)  when u is a `join` node (all parallel branches completed)
  //   InSet(u) = ⋂_{p ∈ Pred(u)} OutSet(p)  otherwise (decision/merge/sequential paths)
  //   OutSet(u) = InSet(u) ∪ Gen(u)
  const allVars = new Set<string>(enclosingInVars);
  for (const n of nodes) {
    for (const p of n.inputs) allVars.add(p.name);
    for (const p of n.outputs) allVars.add(p.name);
    for (const a of n.assignments) allVars.add(a.target);
  }
  for (const p of declaredOutputs) allVars.add(p.name);
  for (const a of topLevelAssignments) allVars.add(a.target);

  const computeGen = (n: ActivityNodeInfo): Set<string> => {
    const gen = new Set<string>();
    for (const pin of n.inputs) gen.add(pin.name);
    for (const asgn of n.assignments) gen.add(asgn.target);
    if (n.isInvocation) {
      for (const outPin of n.outputs) gen.add(outPin.name);
    }
    const flowPins = incomingFlowPinsByNode.get(n.name);
    if (flowPins) {
      for (const p of flowPins) gen.add(p);
    }
    return gen;
  };

  const inSets = new Map<string, Set<string>>();
  const outSets = new Map<string, Set<string>>();

  for (const n of nodes) {
    inSets.set(n.name, new Set(allVars));
    outSets.set(n.name, new Set(allVars));
  }

  // Seed entry nodes with enclosing input parameters, top-level assignments, and node inputs
  const baseSeed = new Set<string>(enclosingInVars);
  for (const a of topLevelAssignments) baseSeed.add(a.target);

  const entrySeedByNode = new Map<string, Set<string>>();
  for (const entry of entryNodes) {
    const entryIn = new Set<string>(baseSeed);
    for (const p of entry.inputs) entryIn.add(p.name);
    entrySeedByNode.set(entry.name, entryIn);
    inSets.set(entry.name, new Set(entryIn));
    const gen = computeGen(entry);
    outSets.set(entry.name, new Set([...entryIn, ...gen]));
  }

  // Fixed-point iteration (purely converges inSets / outSets without emitting diagnostics inside loop)
  let changed = true;
  let iterations = 0;
  const maxIterations = 64;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    for (const n of nodes) {
      if (!reachable.has(n.name)) continue;

      const preds = (incoming.get(n.name) || []).filter((p) => reachable.has(p));
      const entrySeed = entrySeedByNode.get(n.name);
      let newIn: Set<string>;

      if (preds.length > 0) {
        if (n.kind === "join") {
          newIn = new Set<string>(entrySeed || []);
          for (const p of preds) {
            for (const item of outSets.get(p) || []) {
              newIn.add(item);
            }
          }
        } else {
          let first = !entrySeed;
          newIn = entrySeed ? new Set<string>(entrySeed) : new Set<string>();
          for (const p of preds) {
            const pOut = outSets.get(p) || new Set<string>();
            if (first) {
              newIn = new Set(pOut);
              first = false;
            } else {
              const nextIn = new Set<string>();
              for (const item of newIn) {
                if (pOut.has(item)) nextIn.add(item);
              }
              newIn = nextIn;
            }
          }
        }
      } else {
        newIn = new Set(entrySeed || inSets.get(n.name) || baseSeed);
      }

      const gen = computeGen(n);
      const newOut = new Set([...newIn, ...gen]);
      const prevIn = inSets.get(n.name) || new Set<string>();
      const prevOut = outSets.get(n.name) || new Set<string>();

      if (!setsEqual(newIn, prevIn) || !setsEqual(newOut, prevOut)) {
        inSets.set(n.name, newIn);
        outSets.set(n.name, newOut);
        changed = true;
      }
    }
  }

  // Emit `use-before-def` diagnostics ONCE after fixpoint convergence
  const seenUseBeforeDef = new Set<string>();
  const topDefined = new Set<string>(enclosingInVars);
  for (const asgn of topLevelAssignments) {
    for (const id of extractIdentifiers(asgn.expr)) {
      if (declaredOutNames.has(id) && !topDefined.has(id) && id !== asgn.target) {
        const ubdKey = `${graph.name}::${id}`;
        if (!seenUseBeforeDef.has(ubdKey)) {
          seenUseBeforeDef.add(ubdKey);
          uninitializedReads.push({ variable: id, nodeName: graph.name });
          diagnostics.push({
            severity: "warning",
            rule: "use-before-def",
            nodeName: graph.name,
            message: `Variable '${id}' may be used before being initialized in action '${graph.name}'.`,
            startOffset: asgn.startOffset || graph.startOffset,
            endOffset: asgn.endOffset || graph.endOffset,
          });
        }
      }
    }
    topDefined.add(asgn.target);
  }

  for (const n of nodes) {
    if (!reachable.has(n.name)) continue;
    const localDefined = new Set<string>(inSets.get(n.name) || []);
    for (const pin of n.inputs) localDefined.add(pin.name);
    const flowPins = incomingFlowPinsByNode.get(n.name);
    if (flowPins) {
      for (const p of flowPins) localDefined.add(p);
    }

    for (const asgn of n.assignments) {
      const idents = extractIdentifiers(asgn.expr);
      for (const id of idents) {
        if (declaredOutNames.has(id) && !localDefined.has(id) && id !== asgn.target) {
          const ubdKey = `${n.name}::${id}`;
          if (!seenUseBeforeDef.has(ubdKey)) {
            seenUseBeforeDef.add(ubdKey);
            uninitializedReads.push({ variable: id, nodeName: n.name });
            diagnostics.push({
              severity: "warning",
              rule: "use-before-def",
              nodeName: n.name,
              message: `Variable '${id}' may be used before being initialized in action '${n.name}'.`,
              startOffset: asgn.startOffset || n.startOffset,
              endOffset: asgn.endOffset || n.endOffset,
            });
          }
        }
      }
      localDefined.add(asgn.target);
    }
  }

  // --- 3b. Definite Assignment Verification ---
  // (a) Each non-invocation action node must definitely assign all output pins declared directly on it
  for (const n of nodes) {
    if (!reachable.has(n.name) || n.kind !== "action" || n.isInvocation) continue;
    for (const outPin of n.outputs) {
      if (outPin.hasDefault) continue;
      const nodeOut = outSets.get(n.name) || new Set<string>();
      if (!nodeOut.has(outPin.name)) {
        if (!unassignedOutputs.includes(outPin.name)) {
          unassignedOutputs.push(outPin.name);
          diagnostics.push({
            severity: "error",
            rule: "definite-output-assignment",
            nodeName: outPin.name,
            message: `Output variable '${outPin.name}' is declared but not assigned across all action paths.`,
            startOffset: outPin.startOffset || n.startOffset,
            endOffset: outPin.endOffset || n.endOffset,
          });
        }
      }
    }
  }

  // (b) At any merge node, if an output variable was produced in one branch but missing in another branch
  const mergeNodes = nodes.filter((n) => n.kind === "merge" && reachable.has(n.name));
  for (const m of mergeNodes) {
    const preds = (incoming.get(m.name) || []).filter((p) => reachable.has(p));
    if (preds.length <= 1) continue;

    const allProduced = new Set<string>();
    for (const p of preds) {
      const pOut = outSets.get(p) || new Set<string>();
      for (const v of pOut) allProduced.add(v);
    }

    const inM = inSets.get(m.name) || new Set<string>();
    for (const v of allProduced) {
      if (!inM.has(v)) {
        if (declaredOutNames.has(v) && !unassignedOutputs.includes(v)) {
          unassignedOutputs.push(v);
          const outPin = declaredOutputs.find((o) => o.name === v && o.direction !== "in");
          diagnostics.push({
            severity: "error",
            rule: "definite-output-assignment",
            nodeName: v,
            message: `Output variable '${v}' is declared but not assigned across all action paths.`,
            startOffset: outPin?.startOffset || m.startOffset,
            endOffset: outPin?.endOffset || m.endOffset,
          });
        }
      }
    }
  }

  // (c) Enclosing ActionDefinition / container `out` parameters must be definitely assigned across all exit paths
  //     (even when there is no `merge` node), whenever the activity has an executable body.
  const hasExecutableBody = nodes.length > 0 || flows.length > 0 || topLevelAssignments.length > 0;
  if (hasExecutableBody && enclosingOutputs.length > 0) {
    const reachableExitNodes = nodes.filter(
      (n) => reachable.has(n.name) && (outgoing.get(n.name) || []).filter((t) => reachable.has(t)).length === 0,
    );

    for (const outPin of enclosingOutputs) {
      if (outPin.hasDefault || outPin.direction === "in") continue;

      const assignedAtTopLevel = topLevelAssignments.some((a) => a.target === outPin.name);
      const fedByReachableFlow = flows.some((f) => {
        if (f.target !== outPin.name) return false;
        const srcNode = resolveFlowNodeName(f.source, nodeMap);
        if (srcNode) return reachable.has(srcNode);
        const srcRoot = f.source.includes(".") ? f.source.split(".")[0]! : f.source;
        return enclosingInVars.has(f.source) || enclosingInVars.has(srcRoot);
      });

      let assignedAcrossAllExits = false;
      if (assignedAtTopLevel || fedByReachableFlow) {
        assignedAcrossAllExits = true;
      } else if (nodes.length > 0) {
        if (reachableExitNodes.length > 0) {
          assignedAcrossAllExits = reachableExitNodes.every((exitNode) =>
            Boolean(outSets.get(exitNode.name)?.has(outPin.name)),
          );
        } else {
          assignedAcrossAllExits = nodes.some(
            (n) => reachable.has(n.name) && Boolean(outSets.get(n.name)?.has(outPin.name)),
          );
        }
      }

      if (!assignedAcrossAllExits && !unassignedOutputs.includes(outPin.name)) {
        unassignedOutputs.push(outPin.name);
        diagnostics.push({
          severity: "error",
          rule: "definite-output-assignment",
          nodeName: outPin.name,
          message: `Output variable '${outPin.name}' is declared but not assigned across all action paths.`,
          startOffset: outPin.startOffset || graph.startOffset,
          endOffset: outPin.endOffset || graph.endOffset,
        });
      }
    }
  }

  // --- 4. Unbound Action Inputs Check ---
  for (const n of nodes) {
    if (n.kind === "action" && n.inputs.length > 0) {
      const inCount = (incoming.get(n.name) || []).length;
      if (inCount === 0 && !hasExternalInputFlow.has(n.name) && (outgoing.get(n.name) || []).length > 0) {
        diagnostics.push({
          severity: "warning",
          rule: "unbound-action-input",
          nodeName: n.name,
          message: `Action '${n.name}' requires input (${n.inputs.map((p) => p.name).join(", ")}) but has no incoming flows.`,
          startOffset: n.startOffset,
          endOffset: n.endOffset,
        });
      }
    }
  }

  const isSound = diagnostics.filter((d) => d.severity === "error").length === 0;
  const isDefiniteAssigned = unassignedOutputs.length === 0;
  const summary = isSound
    ? `Activity model '${graph.name}' is sound (${nodes.length} nodes, ${flows.length} flows).`
    : `Activity soundness violations in '${graph.name}': ${diagnostics.length} issue(s) (${deadlockNodes.length} deadlocks, ${unassignedOutputs.length} unassigned outputs).`;

  return {
    isSound,
    isDefiniteAssigned,
    diagnostics,
    deadlockNodes,
    unreachableActions,
    unassignedOutputs,
    uninitializedReads,
    summary,
  };
}

/**
 * Extracts all ActivityGraphs defined across a multi-activity SysML v2 source document.
 */
export function extractActivityGraphsFromText(sysmlSource: string): Map<string, ActivityGraph> {
  const result = new Map<string, ActivityGraph>();
  const leaves = collectCstLeaves(parseSysmlSource(sysmlSource));
  const nsStack: { name: string; closeIdx: number }[] = [];

  for (let i = 0; i < leaves.length; i++) {
    while (nsStack.length > 0 && i >= nsStack[nsStack.length - 1]!.closeIdx) {
      nsStack.pop();
    }

    if (leaves[i]!.text === "package" && isSysmlIdentLeaf(leaves[i + 1]?.text) && leaves[i + 2]?.text === "{") {
      nsStack.push({ name: leaves[i + 1]!.text, closeIdx: findMatchingBraceLeaf(leaves, i + 2) });
      continue;
    }

    if (
      i + 3 < leaves.length &&
      leaves[i]!.text === "action" &&
      leaves[i + 1]!.text === "def" &&
      isSysmlIdentLeaf(leaves[i + 2]!.text)
    ) {
      let openBrace = -1;
      for (let j = i + 3; j < leaves.length; j++) {
        if (leaves[j]!.text === "{") {
          openBrace = j;
          break;
        }
        if (leaves[j]!.text === ";") break;
      }
      if (openBrace !== -1) {
        const actName = leaves[i + 2]!.text;
        const closeIdx = findMatchingBraceLeaf(leaves, openBrace);
        const subSource = sysmlSource.slice(leaves[i]!.start, leaves[closeIdx]!.end);
        const g = extractActivityGraphFromText(subSource);
        g.name = actName;
        if (!result.has(actName)) {
          result.set(actName, g);
        }
        if (nsStack.length > 0) {
          const qualified = `${nsStack.map((n) => n.name).join("::")}::${actName}`;
          result.set(qualified, g);
        }
      }
    }
  }
  if (result.size === 0) {
    const single = extractActivityGraphFromText(sysmlSource);
    result.set(single.name, single);
  }
  return result;
}

function getSymbolQualifiedName(db: QueryDB, sym: SymbolEntry): string {
  const parts: string[] = [sym.name];
  if (typeof db.symbol === "function") {
    let cur = sym.parentId;
    while (cur !== null) {
      const p = db.symbol(cur);
      if (!p) break;
      if (p.name && p.name !== "<anonymous>") parts.unshift(p.name);
      cur = p.parentId;
    }
  }
  return parts.join("::");
}

function isActionSymbol(s: SymbolEntry | null | undefined): s is SymbolEntry {
  return Boolean(
    s && (s.ruleName === "ActionDefinition" || s.ruleName === "ActionUsage" || s.ruleName === "PerformActionUsage"),
  );
}

function resolveCalleeActionSymbolInDb(db: QueryDB, callerSym: SymbolEntry, calleeRef: string): SymbolEntry | null {
  // 1. Check direct child ActionUsage inside callerSym (e.g. `perform localStep;` referencing `action localStep { ... }`)
  for (const ch of db.childrenOf(callerSym.id)) {
    if (ch.ruleName === "ActionUsage" && ch.name === calleeRef) {
      return ch;
    }
  }

  // 2. Scope-aware resolution from callerSym and callerSym.parentId (handles `Pkg::Act` and sibling `ActionUsage`s)
  if (typeof db.symbol === "function") {
    const inSelf = resolveFeatureInScope(db, callerSym.id, calleeRef);
    if (isActionSymbol(inSelf)) return inSelf;

    const inParent = resolveFeatureInScope(db, callerSym.parentId, calleeRef);
    if (isActionSymbol(inParent)) return inParent;
  }

  // 3. Qualified suffix or short-name lookup via db.byName
  const shortName = extractLastNameSegment(calleeRef);
  const candidates = db.byName(shortName).filter(isActionSymbol);
  if (calleeRef.includes("::")) {
    const exactQual = candidates.find((c) => {
      const qn = getSymbolQualifiedName(db, c);
      return qn === calleeRef || qn.endsWith(`::${calleeRef}`);
    });
    if (exactQual) return exactQual;
  }
  return candidates.find((c) => c.ruleName === "ActionDefinition") ?? candidates[0] ?? null;
}

/**
 * Performs rigorous Inter-procedural Control Flow and Data Flow Analysis across
 * multiple interconnected activities.
 *
 * Verifies:
 *   1. Activity call graph construction and cycle detection.
 *   2. Pin contract fulfillment: all required input pins of invoked sub-activities
 *      must receive incoming flows or bindings at the call site.
 *   3. Callee output pin propagation to caller's definite assignment set.
 *   4. References to undefined pins on callees.
 *   5. Soundness propagation: failures in callee activities propagate to caller.
 */
export function analyzeInterproceduralCfa(
  input: Map<string, ActivityGraph> | ActivityGraph[] | QueryDB,
  rootActivityName?: string,
): InterproceduralCfaResult {
  const fullActivityMap = new Map<string, ActivityGraph>();
  const aliasToCanonical = new Map<string, string>();

  const resolveKeyInMap = (refName: string): string | undefined => {
    if (fullActivityMap.has(refName)) return refName;
    const aliased = aliasToCanonical.get(refName);
    if (aliased && fullActivityMap.has(aliased)) return aliased;
    if (refName.includes("::")) {
      for (const key of fullActivityMap.keys()) {
        if (key === refName || key.endsWith(`::${refName}`)) return key;
      }
      const short = extractLastNameSegment(refName);
      if (fullActivityMap.has(short)) return short;
    }
    return undefined;
  };

  if (input instanceof Map) {
    for (const [k, v] of input) {
      if (k.includes("::") && fullActivityMap.has(v.name) && fullActivityMap.get(v.name) === v) {
        aliasToCanonical.set(k, v.name);
      } else {
        fullActivityMap.set(k, v);
      }
    }
  } else if (Array.isArray(input)) {
    for (const g of input) fullActivityMap.set(g.name, g);
  } else {
    // QueryDB: when `rootActivityName` is given, discover only `rootActivityName` and its reachable callees
    const db = input;
    const symIdToKey = new Map<number, string>();

    const registerSym = (sym: SymbolEntry): string => {
      const existing = symIdToKey.get(sym.id);
      if (existing) return existing;
      const g = extractActivityGraphFromQueryDB(db, sym);
      const qn = getSymbolQualifiedName(db, sym);
      let key = g.name;
      if (fullActivityMap.has(key)) {
        key = qn || `${g.name}#${sym.id}`;
      }
      fullActivityMap.set(key, g);
      symIdToKey.set(sym.id, key);
      if (qn && qn !== key) aliasToCanonical.set(qn, key);
      if (g.name !== key && !aliasToCanonical.has(g.name)) aliasToCanonical.set(g.name, key);
      return key;
    };

    let seedSymbols: SymbolEntry[];
    if (rootActivityName) {
      const shortRoot = extractLastNameSegment(rootActivityName);
      const candidates = db.byName(shortRoot).filter(isActionSymbol);
      if (rootActivityName.includes("::")) {
        const qualMatches = candidates.filter((c) => {
          const qn = getSymbolQualifiedName(db, c);
          return qn === rootActivityName || qn.endsWith(`::${rootActivityName}`);
        });
        seedSymbols = qualMatches.length > 0 ? qualMatches : candidates;
      } else {
        seedSymbols = candidates;
      }
    } else {
      seedSymbols = db.allEntries().filter((s) => s.ruleName === "ActionDefinition");
    }

    const worklist: SymbolEntry[] = [...seedSymbols];
    const visitedSymIds = new Set<number>();

    while (worklist.length > 0) {
      const currSym = worklist.shift()!;
      if (visitedSymIds.has(currSym.id)) continue;
      visitedSymIds.add(currSym.id);

      const callerKey = registerSym(currSym);
      const callerGraph = fullActivityMap.get(callerKey)!;

      for (const node of callerGraph.nodes) {
        if (!node.calleeTypeName) continue;
        const calleeSym = resolveCalleeActionSymbolInDb(db, currSym, node.calleeTypeName);
        if (calleeSym) {
          const calleeKey = registerSym(calleeSym);
          aliasToCanonical.set(`${callerKey}::call::${node.calleeTypeName}`, calleeKey);
          aliasToCanonical.set(node.calleeTypeName, calleeKey);
          if (!visitedSymIds.has(calleeSym.id)) {
            worklist.push(calleeSym);
          }
        }
      }
    }
  }

  // Restrict analyzed activities to `rootActivityName` and its reachable callees when `rootActivityName` is specified
  let activityMap: Map<string, ActivityGraph>;
  if (rootActivityName && (input instanceof Map || Array.isArray(input))) {
    activityMap = new Map<string, ActivityGraph>();
    const rootKey = resolveKeyInMap(rootActivityName);
    if (rootKey) {
      const bfs: string[] = [rootKey];
      while (bfs.length > 0) {
        const k = bfs.shift()!;
        if (activityMap.has(k)) continue;
        const g = fullActivityMap.get(k);
        if (!g) continue;
        activityMap.set(k, g);
        for (const node of g.nodes) {
          if (!node.calleeTypeName) continue;
          const targetKey = resolveKeyInMap(node.calleeTypeName);
          if (targetKey && !activityMap.has(targetKey)) {
            bfs.push(targetKey);
          }
        }
      }
    }
  } else {
    activityMap = fullActivityMap;
  }

  const resolveCalleeForCaller = (callerKey: string, calleeRef: string): string | undefined => {
    const scoped = aliasToCanonical.get(`${callerKey}::call::${calleeRef}`);
    if (scoped && activityMap.has(scoped)) return scoped;
    const resolved = resolveKeyInMap(calleeRef);
    if (resolved && activityMap.has(resolved)) return resolved;
    return undefined;
  };

  const callGraph = new Map<string, string[]>();
  for (const [name, graph] of activityMap) {
    const callees: string[] = [];
    for (const node of graph.nodes) {
      if (node.calleeTypeName) {
        const resolvedKey = resolveCalleeForCaller(name, node.calleeTypeName) ?? node.calleeTypeName;
        callees.push(resolvedKey);
      }
    }
    callGraph.set(name, callees);
  }

  const diagnostics: CfaDiagnostic[] = [];
  const activityResults = new Map<string, ActivityCfaResult>();

  // 1. Analyze each activity's local CFA
  for (const [name, graph] of activityMap) {
    const res = analyzeActivityCfa(graph);
    activityResults.set(name, res);
    diagnostics.push(...res.diagnostics);
  }

  // 2. Cycle Detection in Call Graph
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];

  function detectCycle(curr: string): boolean {
    visited.add(curr);
    recStack.add(curr);
    path.push(curr);

    const callees = callGraph.get(curr) || [];
    for (const callee of callees) {
      if (!visited.has(callee)) {
        if (detectCycle(callee)) return true;
      } else if (recStack.has(callee)) {
        path.push(callee);
        const cycleStart = path.indexOf(callee);
        const cyclePath = path.slice(cycleStart);
        diagnostics.push({
          severity: "error",
          rule: "cyclic-activity-invocation",
          nodeName: curr,
          message: `Cyclic activity invocation detected: ${cyclePath.join(" -> ")}. Recursive activities are not sound without guarded termination.`,
        });
        return true;
      }
    }

    path.pop();
    recStack.delete(curr);
    return false;
  }

  for (const actName of activityMap.keys()) {
    if (!visited.has(actName)) {
      path.length = 0;
      recStack.clear();
      detectCycle(actName);
    }
  }

  // 3. Pin Contract Checking & Soundness Propagation
  for (const [callerName, graph] of activityMap) {
    for (const node of graph.nodes) {
      if (!node.calleeTypeName) continue;

      // Skip self-referential local step without external definition when `perform step;` matches an inline node with no callee body
      const calleeKey = resolveCalleeForCaller(callerName, node.calleeTypeName);
      const callee = calleeKey ? activityMap.get(calleeKey) : undefined;
      if (!callee) {
        const localSiblingNode = graph.nodes.find((n) => n !== node && n.name === node.calleeTypeName);
        if (localSiblingNode) {
          continue;
        }
        diagnostics.push({
          severity: "warning",
          rule: "unresolved-callee-activity",
          nodeName: node.name,
          message: `Action invocation '${node.name}' references undefined activity '${node.calleeTypeName}'.`,
          startOffset: node.startOffset,
          endOffset: node.endOffset,
        });
        continue;
      }

      // Check callee soundness
      const calleeRes = calleeKey ? activityResults.get(calleeKey) : undefined;
      if (calleeRes && !calleeRes.isSound) {
        diagnostics.push({
          severity: "error",
          rule: "unsound-callee-dependency",
          nodeName: node.name,
          message: `Action invocation '${node.name}' calls activity '${callee.name}', which has soundness errors (${calleeRes.summary}).`,
          startOffset: node.startOffset,
          endOffset: node.endOffset,
        });
      }

      // Gather callee input pins
      const calleeInputs = callee.nodes
        .flatMap((n) => n.inputs)
        .concat(callee.declaredOutputs.filter((p) => p.direction === "in"));
      const uniqueCalleeInputs = new Map<string, ActionPinInfo>();
      for (const pin of calleeInputs) {
        if (!uniqueCalleeInputs.has(pin.name)) uniqueCalleeInputs.set(pin.name, pin);
      }

      for (const [pinName, pin] of uniqueCalleeInputs) {
        if (pin.hasDefault) continue;

        const hasFlow = graph.flows.some((f) => f.target === node.name || f.target === `${node.name}.${pinName}`);
        const hasNodeInput = node.inputs.some((p) => p.name === pinName);

        if (!hasFlow && !hasNodeInput) {
          diagnostics.push({
            severity: "error",
            rule: "unfulfilled-callee-input",
            nodeName: node.name,
            message: `Required input pin '${pinName}' of activity '${callee.name}' is unfulfilled at call site '${node.name}'.`,
            startOffset: node.startOffset,
            endOffset: node.endOffset,
          });
        }
      }

      // Check caller flows referencing callee output pins
      const calleeOutputs = new Set<string>(
        callee.declaredOutputs
          .filter((p) => p.direction === "out" || p.direction === "inout" || p.direction === "return")
          .map((p) => p.name),
      );
      for (const n of callee.nodes) {
        for (const out of n.outputs) calleeOutputs.add(out.name);
      }

      for (const flow of graph.flows) {
        if (flow.source.startsWith(`${node.name}.`)) {
          const pinName = flow.source.slice(node.name.length + 1);
          if (calleeOutputs.size > 0 && !calleeOutputs.has(pinName)) {
            diagnostics.push({
              severity: "error",
              rule: "unresolved-callee-pin",
              nodeName: node.name,
              message: `Pin '${pinName}' does not exist on invoked activity '${callee.name}'.`,
              startOffset: flow.startOffset || node.startOffset,
              endOffset: flow.endOffset || node.endOffset,
            });
          }
        }
      }
    }
  }

  const isSound = diagnostics.every((d) => d.severity !== "error");
  const summary = isSound
    ? `All ${activityMap.size} activities and inter-procedural call contracts verified sound.`
    : `Inter-procedural CFA detected ${diagnostics.filter((d) => d.severity === "error").length} contract/soundness error(s).`;

  return {
    isSound,
    diagnostics,
    callGraph,
    activityResults,
    summary,
  };
}

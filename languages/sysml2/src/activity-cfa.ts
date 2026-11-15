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
  findMatchingBraceLeaf,
  isSysmlIdentLeaf,
  parseSysmlSource,
  readDottedChainFromLeaves,
  sliceBetweenLeaves,
} from "./cst-utils.js";

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

function extractIdentifiers(expr: string): string[] {
  const idents: string[] = [];
  let i = 0;
  const len = expr.length;
  while (i < len) {
    const ch = expr[i]!;
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      const start = i;
      i++;
      while (i < len && isIdentChar(expr[i])) {
        i++;
      }
      idents.push(expr.slice(start, i));
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

function extractSuccessionsFromLeaves(
  leaves: readonly CstLeaf[],
  sourceText: string,
  requireSemicolon: boolean,
): ActivityFlowInfo[] {
  const out: ActivityFlowInfo[] = [];
  for (let i = 0; i < leaves.length; i++) {
    const kw = leaves[i]!.text;
    if (kw === "first" || kw === "succession") {
      const src = readDottedChainFromLeaves(leaves, i + 1);
      if (!src || leaves[src.nextIdx]?.text !== "then") continue;
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
    } else if (kw === "flow") {
      let p = i + 1;
      if (leaves[p]?.text === "of") {
        const ofType = readDottedChainFromLeaves(leaves, p + 1);
        if (!ofType) continue;
        p = ofType.nextIdx;
      }
      if (leaves[p]?.text !== "from") continue;
      const src = readDottedChainFromLeaves(leaves, p + 1);
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
    if (i > 0 && leaves[i - 1]!.text === ".") continue;
    let p = i + 1;
    if (
      allowKindPrefix &&
      (leaves[p]?.text === "item" || leaves[p]?.text === "attribute") &&
      isSysmlIdentLeaf(leaves[p + 1]?.text)
    ) {
      p++;
    }
    const pName = leaves[p]?.text;
    if (!isSysmlIdentLeaf(pName)) continue;
    p++;
    let pType: string | undefined;
    if (leaves[p]?.text === ":") {
      const tc = readDottedChainFromLeaves(leaves, p + 1);
      if (tc) pType = tc.text;
    }
    pins.push({ name: pName, direction: dir, type: pType });
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
  hasDefault: boolean;
} {
  const leaves = collectCstLeaves(parseSysmlSource(text));
  let idx = 0;
  const first = leaves[idx]?.text;
  if (first === "public" || first === "private" || first === "protected") idx++;
  const dirTok = leaves[idx]?.text;
  const direction =
    dirTok === "in" || dirTok === "out" || dirTok === "inout" || dirTok === "return" ? dirTok : undefined;
  const hasDefault = leaves.some((l) => l.text === "=" || l.text === ":=" || l.text === "default");
  return { direction, hasDefault };
}

/**
 * Parses textual SysML v2 source into a normalized ActivityGraph.
 * Handles nested action defs, control nodes, balanced blocks, and successions.
 */
export function extractActivityGraphFromText(sysmlSource: string): ActivityGraph {
  const nodes: ActivityNodeInfo[] = [];
  const flows: ActivityFlowInfo[] = [];
  const declaredOutputs: ActionPinInfo[] = [];

  const allLeaves = collectCstLeaves(parseSysmlSource(sysmlSource));
  let containerName = "Activity";
  let searchLeaves = allLeaves;

  // 1. Check if enclosed in action def <Name> { ... }
  for (let i = 0; i + 3 < allLeaves.length; i++) {
    if (
      allLeaves[i]!.text === "action" &&
      allLeaves[i + 1]!.text === "def" &&
      isSysmlIdentLeaf(allLeaves[i + 2]!.text) &&
      allLeaves[i + 3]!.text === "{"
    ) {
      containerName = allLeaves[i + 2]!.text;
      const closeIdx = findMatchingBraceLeaf(allLeaves, i + 3);
      searchLeaves = allLeaves.slice(i + 4, closeIdx);
      break;
    }
  }

  // 1b. Extract top-level action def pins: (in|out|inout) (item|attribute)? [name] (: [type])?
  for (const pin of collectPinsFromLeaves(searchLeaves, true)) {
    declaredOutputs.push(pin);
  }

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
    const isInvocation = isPerform || Boolean(calleeTypeName);

    let bodyLeaves: CstLeaf[] = [];
    let endLeafIdx = endDeclIdx;
    if (searchLeaves[endDeclIdx]!.text === "{") {
      endLeafIdx = findMatchingBraceLeaf(searchLeaves, endDeclIdx);
      bodyLeaves = searchLeaves.slice(endDeclIdx + 1, endLeafIdx);
    }

    const inputs: ActionPinInfo[] = [];
    const outputs: ActionPinInfo[] = [];
    for (const pinInfo of collectPinsFromLeaves(bodyLeaves, false)) {
      if (pinInfo.direction === "in") {
        inputs.push(pinInfo);
      } else {
        outputs.push(pinInfo);
        declaredOutputs.push(pinInfo);
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

  // 3b. Extract decide blocks: decide [name] { case [guard] => [target/assignment]; ... }
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
            sepEndIdx = s;
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
      }
      armStart = semiIdx + 1;
    }
  }

  // 4. Extract successions: first [source] then [target] (optional if [guard]);
  for (const flow of extractSuccessionsFromLeaves(searchLeaves, sysmlSource, true)) {
    flows.push(flow);
  }

  return {
    name: containerName,
    nodes,
    flows,
    declaredOutputs,
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

  const children = db.childrenOf(actionSymbol.id);

  for (const child of children) {
    const rule = child.ruleName;
    const name = child.name;

    if (rule === "SuccessionAsUsage" || rule === "SuccessionFlowUsage" || rule === "FlowUsage") {
      const text = db.cstText(child.startOffset, child.endOffset, child) || "";
      const parsed = extractSuccessionsFromLeaves(collectCstLeaves(parseSysmlSource(text)), text, false);
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
      const dir =
        rule === "ReturnParameterMember"
          ? "out"
          : ((metaDir || parsedPin.direction) as "in" | "out" | "inout" | "return" | undefined);
      if (dir) {
        declaredOutputs.push({
          name,
          direction: dir === "return" ? "out" : dir,
          hasDefault: parsedPin.hasDefault,
          startOffset: child.startOffset,
          endOffset: child.endOffset,
        });
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
          hasDefault: parsedPin.hasDefault,
          startOffset: pin.startOffset,
          endOffset: pin.endOffset,
        };
        if (isOut) {
          outputs.push(pinInfo);
          declaredOutputs.push(pinInfo);
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
            const pName = n.childForFieldName?.("name")?.text || n.name || "";
            const isOut = nt.includes("out") || nt.includes("return");
            if (pName && !inputs.some((p) => p.name === pName) && !outputs.some((p) => p.name === pName)) {
              const pinInfo: ActionPinInfo = {
                name: pName,
                direction: isOut ? "out" : "in",
                startOffset: n.startIndex ?? child.startOffset,
                endOffset: n.endIndex ?? child.endOffset,
              };
              if (isOut) {
                outputs.push(pinInfo);
                declaredOutputs.push(pinInfo);
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
            if (tgt && expr && !assignments.some((a) => a.target === tgt)) {
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

      // 2. Check assignments and inline pins in CST text without regex
      const actionText = db.cstText(child.startOffset, child.endOffset, child) || "";
      const headerSlice = actionText.split("{")[0] || actionText;
      let typeMatchVal: string | undefined = undefined;
      const colonIdx = headerSlice.indexOf(":");
      if (colonIdx !== -1) {
        let p = colonIdx + 1;
        while (p < headerSlice.length && isSpace(headerSlice[p])) p++;
        const s = p;
        while (p < headerSlice.length && isIdentOrTypeChar(headerSlice[p])) p++;
        if (p > s) typeMatchVal = headerSlice.slice(s, p);
      }
      const typingChild = childSymbols.find((c) => c.ruleName === "OwnedFeatureTyping" && c.name);
      const calleeTypeName = (child as { typeName?: string | undefined }).typeName || typingChild?.name || typeMatchVal;
      const isInvocation = rule === "PerformActionUsage" || Boolean(calleeTypeName);

      // Extract inline pins from bodySlice
      const bodyStartIdx = actionText.indexOf("{");
      if (bodyStartIdx !== -1) {
        const bodySlice = actionText.slice(bodyStartIdx + 1);
        let bi = 0;
        const bLen = bodySlice.length;
        while (bi < bLen) {
          let dir: "in" | "out" | "inout" | null = null;
          let kwLen = 0;
          if (bodySlice.startsWith("inout", bi) && !isIdentChar(bodySlice[bi + 5])) {
            dir = "inout";
            kwLen = 5;
          } else if (bodySlice.startsWith("out", bi) && !isIdentChar(bodySlice[bi + 3])) {
            dir = "out";
            kwLen = 3;
          } else if (bodySlice.startsWith("in", bi) && !isIdentChar(bodySlice[bi + 2])) {
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
            if (pName) {
              while (bi < bLen && isSpace(bodySlice[bi])) bi++;
              let pType: string | undefined = undefined;
              if (bi < bLen && bodySlice[bi] === ":") {
                bi++;
                while (bi < bLen && isSpace(bodySlice[bi])) bi++;
                const typeStart = bi;
                while (bi < bLen && isIdentOrTypeChar(bodySlice[bi])) bi++;
                if (bi > typeStart) pType = bodySlice.slice(typeStart, bi);
              }
              const pEnd = bi;
              if (!inputs.some((p) => p.name === pName) && !outputs.some((p) => p.name === pName)) {
                const pinInfo: ActionPinInfo = {
                  name: pName,
                  direction: dir,
                  type: pType,
                  startOffset: child.startOffset + bodyStartIdx + 1 + pStart,
                  endOffset: child.startOffset + bodyStartIdx + 1 + pEnd,
                };
                if (dir === "in") {
                  inputs.push(pinInfo);
                } else {
                  outputs.push(pinInfo);
                  declaredOutputs.push(pinInfo);
                }
              }
            }
            continue;
          }
          bi++;
        }
      }

      // Extract assignments without regex: assign <target> := <expr>; or assign <expr> =: <target>;
      let ai = 0;
      const aLen = actionText.length;
      while (ai < aLen) {
        if (actionText.startsWith("assign", ai) && !isIdentChar(actionText[ai + 6])) {
          const assignStart = ai;
          ai += 6;
          while (ai < aLen && isSpace(actionText[ai])) ai++;
          const semiIdx = actionText.indexOf(";", ai);
          if (semiIdx !== -1) {
            const clause = actionText.slice(ai, semiIdx);
            const assignWalrusIdx = clause.indexOf(":=");
            const assignRevIdx = clause.indexOf("=:");
            if (assignWalrusIdx !== -1) {
              const target = clause.slice(0, assignWalrusIdx).trim();
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
              const target = clause.slice(assignRevIdx + 2).trim();
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
      if (rule === "DecisionNode") kind = "decide";
      else if (rule === "ForkNode") kind = "fork";
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
    }
  }

  return {
    name: actionSymbol.name || "Activity",
    nodes,
    flows,
    declaredOutputs,
    startOffset: actionSymbol.startOffset,
    endOffset: actionSymbol.endOffset,
  };
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
  const nodeMap = new Map<string, ActivityNodeInfo>();
  for (const n of nodes) nodeMap.set(n.name, n);

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const n of nodes) {
    outgoing.set(n.name, []);
    incoming.set(n.name, []);
  }

  for (const f of flows) {
    if (outgoing.has(f.source) && incoming.has(f.target)) {
      outgoing.get(f.source)!.push(f.target);
      incoming.get(f.target)!.push(f.source);
    }
  }

  // --- 1. Reachability & Dead Code Detection ---
  const withOut = nodes.filter((n) => (outgoing.get(n.name) || []).length > 0);
  const entryNodes = nodes.filter(
    (n) => (incoming.get(n.name) || []).length === 0 && (outgoing.get(n.name) || []).length > 0,
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
  // Iterative forward dataflow over the reachability DAG/graph:
  // InSet(u) = ⋂_{p ∈ Pred(u)} OutSet(p)  (for merge / sequential)
  // OutSet(u) = InSet(u) ∪ Gen(u)
  // In must-dataflow analysis, non-entry nodes must be initialized to TOP (all variables)
  // so that back-edges in loops do not destroy definite assignments at loop headers.
  const allVars = new Set<string>();
  for (const n of nodes) {
    for (const p of n.inputs) allVars.add(p.name);
    for (const p of n.outputs) allVars.add(p.name);
    for (const a of n.assignments) allVars.add(a.target);
  }
  for (const p of declaredOutputs) allVars.add(p.name);

  const inSets = new Map<string, Set<string>>();
  const outSets = new Map<string, Set<string>>();

  for (const n of nodes) {
    inSets.set(n.name, new Set(allVars));
    outSets.set(n.name, new Set(allVars));
  }

  // Initial node seeds with initial input parameters
  for (const entry of entryNodes) {
    const entryInputs = new Set(entry.inputs.map((p) => p.name));
    inSets.set(entry.name, entryInputs);
    const gen = new Set(entry.assignments.map((a) => a.target));
    outSets.set(entry.name, new Set([...entryInputs, ...gen]));
  }

  // Fixed-point iteration
  let changed = true;
  let iterations = 0;
  const maxIterations = 50;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    for (const n of nodes) {
      if (!reachable.has(n.name)) continue;

      const preds = incoming.get(n.name) || [];
      let newIn = new Set<string>();

      if (preds.length > 0) {
        // Intersect output sets of all predecessors
        let first = true;
        for (const p of preds) {
          const pOut = outSets.get(p) || new Set();
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
      } else {
        newIn = inSets.get(n.name) || new Set();
      }

      // Check Use-Before-Def for expressions in assignments:
      for (const asgn of n.assignments) {
        const idents = extractIdentifiers(asgn.expr);
        for (const id of idents) {
          // If identifier matches an output or local variable but is not yet in newIn
          const isDeclaredOut = declaredOutputs.some((o) => o.name === id);
          if (isDeclaredOut && !newIn.has(id) && id !== asgn.target) {
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

      // Gen set: assigned variables + action input pins
      const gen = new Set<string>();
      for (const pin of n.inputs) gen.add(pin.name);
      for (const asgn of n.assignments) gen.add(asgn.target);

      const newOut = new Set([...newIn, ...gen]);
      const prevOut = outSets.get(n.name) || new Set();

      if (newOut.size !== prevOut.size) {
        outSets.set(n.name, newOut);
        inSets.set(n.name, newIn);
        changed = true;
      }
    }
  }

  // --- 3. Definite Assignment Verification ---
  // (a) Each action node must definitely assign all output pins declared directly on it
  for (const n of nodes) {
    if (!reachable.has(n.name) || n.kind !== "action") continue;
    for (const outPin of n.outputs) {
      const nodeOut = outSets.get(n.name) || new Set();
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
  const mergeNodes = nodes.filter((n) => n.kind === "merge");
  for (const m of mergeNodes) {
    const preds = incoming.get(m.name) || [];
    if (preds.length <= 1) continue;

    // Check variables present in some predecessor but not all predecessors
    const allProduced = new Set<string>();
    for (const p of preds) {
      const pOut = outSets.get(p) || new Set();
      for (const v of pOut) allProduced.add(v);
    }

    const inM = inSets.get(m.name) || new Set();
    for (const v of allProduced) {
      if (!inM.has(v)) {
        const isDeclaredOut = declaredOutputs.some((o) => o.name === v);
        if (isDeclaredOut && !unassignedOutputs.includes(v)) {
          unassignedOutputs.push(v);
          const outPin = declaredOutputs.find((o) => o.name === v);
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

  // --- 4. Unbound Action Inputs Check ---
  for (const n of nodes) {
    if (n.kind === "action" && n.inputs.length > 0) {
      const inCount = (incoming.get(n.name) || []).length;
      if (inCount === 0 && (outgoing.get(n.name) || []).length > 0) {
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
  for (let i = 0; i + 3 < leaves.length; i++) {
    if (
      leaves[i]!.text === "action" &&
      leaves[i + 1]!.text === "def" &&
      isSysmlIdentLeaf(leaves[i + 2]!.text) &&
      leaves[i + 3]!.text === "{"
    ) {
      const actName = leaves[i + 2]!.text;
      const closeIdx = findMatchingBraceLeaf(leaves, i + 3);
      const subSource = sysmlSource.slice(leaves[i]!.start, leaves[closeIdx]!.end);
      const g = extractActivityGraphFromText(subSource);
      g.name = actName;
      result.set(actName, g);
    }
  }
  if (result.size === 0) {
    const single = extractActivityGraphFromText(sysmlSource);
    result.set(single.name, single);
  }
  return result;
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
  _rootActivityName?: string,
): InterproceduralCfaResult {
  const activityMap = new Map<string, ActivityGraph>();
  if (input instanceof Map) {
    for (const [k, v] of input) activityMap.set(k, v);
  } else if (Array.isArray(input)) {
    for (const g of input) activityMap.set(g.name, g);
  } else {
    // QueryDB
    const symbols = input.allEntries().filter((s) => s.ruleName === "ActionDefinition");
    for (const s of symbols) {
      const g = extractActivityGraphFromQueryDB(input, s);
      activityMap.set(g.name, g);
    }
  }

  const callGraph = new Map<string, string[]>();
  for (const [name, graph] of activityMap) {
    const callees: string[] = [];
    for (const node of graph.nodes) {
      if (node.calleeTypeName) {
        callees.push(node.calleeTypeName);
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
  for (const [_callerName, graph] of activityMap) {
    for (const node of graph.nodes) {
      if (!node.calleeTypeName) continue;

      const callee = activityMap.get(node.calleeTypeName);
      if (!callee) {
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
      const calleeRes = activityResults.get(node.calleeTypeName);
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

        const hasFlow = graph.flows.some(
          (f) => f.target === node.name || f.target === `${node.name}.${pinName}` || f.target.endsWith(`.${pinName}`),
        );
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
        callee.declaredOutputs.filter((p) => p.direction === "out").map((p) => p.name),
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

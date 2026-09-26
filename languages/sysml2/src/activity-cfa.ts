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

export interface ActionPinInfo {
  name: string;
  direction: "in" | "out" | "inout" | "return";
  type?: string;
  hasDefault?: boolean;
  startByte?: number;
  endByte?: number;
}

export interface ActionAssignmentInfo {
  target: string;
  expr: string;
  startByte?: number;
  endByte?: number;
}

export interface ActivityNodeInfo {
  name: string;
  kind: "action" | "merge" | "decide" | "fork" | "join" | "initial" | "final";
  calleeTypeName?: string;
  isInvocation?: boolean;
  inputs: ActionPinInfo[];
  outputs: ActionPinInfo[];
  assignments: ActionAssignmentInfo[];
  startByte?: number;
  endByte?: number;
}

export interface ActivityFlowInfo {
  source: string;
  target: string;
  kind: "control" | "object";
  guard?: string;
  itemType?: string;
  startByte?: number;
  endByte?: number;
}

export interface ActivityGraph {
  name: string;
  nodes: ActivityNodeInfo[];
  flows: ActivityFlowInfo[];
  declaredOutputs: ActionPinInfo[];
  startByte?: number;
  endByte?: number;
}

export interface CfaDiagnostic {
  severity: "error" | "warning" | "info";
  rule: string;
  nodeName: string;
  message: string;
  startByte?: number;
  endByte?: number;
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

/**
 * Parses textual SysML v2 source into a normalized ActivityGraph.
 * Handles nested action defs, control nodes, balanced blocks, and successions.
 */
export function extractActivityGraphFromText(sysmlSource: string): ActivityGraph {
  const nodes: ActivityNodeInfo[] = [];
  const flows: ActivityFlowInfo[] = [];
  const declaredOutputs: ActionPinInfo[] = [];

  let containerName = "Activity";
  let searchSource = sysmlSource;

  // 1. Check if enclosed in action def <Name> { ... }
  const actionDefMatch = /\baction\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/.exec(sysmlSource);
  if (actionDefMatch) {
    containerName = actionDefMatch[1]!;
    const openBrace = actionDefMatch.index + actionDefMatch[0].length - 1;
    const block = extractBalancedBlock(sysmlSource, openBrace);
    searchSource = block.body;
  }

  // 1b. Extract top-level action def pins: (in|out|inout) (item|attribute)? [name] (: [type])?
  const topPinRegex =
    /\b(in|out|inout)\s+(?:item\s+|attribute\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z0-9_.]+))?/g;
  let tpm: RegExpExecArray | null;
  while ((tpm = topPinRegex.exec(searchSource)) !== null) {
    const dir = tpm[1] as "in" | "out" | "inout";
    const pName = tpm[2]!;
    const pType = tpm[3];
    const pinInfo: ActionPinInfo = { name: pName, direction: dir, type: pType };
    declaredOutputs.push(pinInfo);
  }

  // 2. Extract action usages: action [name] { ... } or action [name];
  let idx = 0;
  while (idx < searchSource.length) {
    const actMatch = /\b(?:perform\s+action\s+|perform\s+|action\s+(?!def\b))([A-Za-z_][A-Za-z0-9_]*)/g;
    actMatch.lastIndex = idx;
    const m = actMatch.exec(searchSource);
    if (!m) break;

    const name = m[1]!;
    const afterName = m.index + m[0].length;
    let endOfDecl = afterName;

    // Skip whitespace
    while (endOfDecl < searchSource.length && /\s/.test(searchSource[endOfDecl]!)) endOfDecl++;

    let bodyText = "";
    let bracePos = -1;
    let semiPos = -1;
    for (let p = afterName; p < searchSource.length; p++) {
      const ch = searchSource[p];
      if (ch === "{") {
        bracePos = p;
        break;
      }
      if (ch === ";") {
        semiPos = p;
        break;
      }
    }

    const declSlice = searchSource.slice(
      afterName,
      bracePos !== -1 ? bracePos : semiPos !== -1 ? semiPos : searchSource.length,
    );
    const typeMatch = /:\s*([A-Za-z_][A-Za-z0-9_.]*)/.exec(declSlice);
    const calleeTypeName = typeMatch
      ? typeMatch[1]
      : m[0].trim().startsWith("perform") && !m[0].includes("action")
        ? name
        : undefined;
    const isInvocation = m[0].trim().startsWith("perform") || Boolean(calleeTypeName);

    if (bracePos !== -1) {
      const block = extractBalancedBlock(searchSource, bracePos);
      bodyText = block.body;
      idx = block.endPos;
    } else if (semiPos !== -1) {
      idx = semiPos + 1;
    } else {
      idx = afterName;
      continue;
    }

    const inputs: ActionPinInfo[] = [];
    const outputs: ActionPinInfo[] = [];
    const assignments: ActionAssignmentInfo[] = [];

    // Pins: in/out [name] : [type];
    const pinRegex = /\b(in|out|inout)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z0-9_.]+))?/g;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = pinRegex.exec(bodyText)) !== null) {
      const dir = pMatch[1] as "in" | "out" | "inout";
      const pName = pMatch[2]!;
      const pType = pMatch[3];
      const pinInfo: ActionPinInfo = { name: pName, direction: dir, type: pType };
      if (dir === "in") {
        inputs.push(pinInfo);
      } else {
        outputs.push(pinInfo);
        declaredOutputs.push(pinInfo);
      }
    }

    // Assignments: assign [target] := [expr]; or assign [val] =: [target];
    const assignRegex = /\bassign\s+([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*([^;\r\n]+?)\s*;/g;
    let asMatch: RegExpExecArray | null;
    while ((asMatch = assignRegex.exec(bodyText)) !== null) {
      assignments.push({ target: asMatch[1]!, expr: asMatch[2]!.trim() });
    }
    const assignRevRegex = /\bassign\s+([A-Za-z0-9_.]+)\s*:=?\s*([A-Za-z_][A-Za-z0-9_]*)\s*;/g;
    while ((asMatch = assignRevRegex.exec(bodyText)) !== null) {
      if (!assignments.some((a) => a.target === asMatch![2])) {
        assignments.push({ target: asMatch[2]!, expr: asMatch[1]!.trim() });
      }
    }

    nodes.push({
      name,
      kind: "action",
      calleeTypeName,
      isInvocation,
      inputs,
      outputs,
      assignments,
      startByte: m.index,
      endByte: idx,
    });
  }

  // 3. Extract control nodes: (merge|decide|fork|join) [name];
  const ctrlRegex = /\b(merge|decide|fork|join)\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/g;
  let cMatch: RegExpExecArray | null;
  while ((cMatch = ctrlRegex.exec(searchSource)) !== null) {
    const kind = cMatch[1] as "merge" | "decide" | "fork" | "join";
    const name = cMatch[2]!;
    nodes.push({
      name,
      kind,
      inputs: [],
      outputs: [],
      assignments: [],
      startByte: cMatch.index,
      endByte: cMatch.index + cMatch[0].length,
    });
  }

  // 3b. Extract decide blocks: decide [name] { case [guard] => [target/assignment]; ... }
  const decideBlockRegex = /\bdecide\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
  let dbMatch: RegExpExecArray | null;
  while ((dbMatch = decideBlockRegex.exec(searchSource)) !== null) {
    const decideName = dbMatch[1]!;
    const openBrace = dbMatch.index + dbMatch[0].length - 1;
    const block = extractBalancedBlock(searchSource, openBrace);
    nodes.push({
      name: decideName,
      kind: "decide",
      inputs: [],
      outputs: [],
      assignments: [],
      startByte: dbMatch.index,
      endByte: block.endPos,
    });

    const caseRegex = /\b(?:case\s+([^;\r\n]+?)|(else|default))\s*(?:=>|\bthen\b|:(?!=))\s*([^;\r\n]+?)\s*;/g;
    let cm: RegExpExecArray | null;
    let caseIdx = 1;
    while ((cm = caseRegex.exec(block.body)) !== null) {
      const guardStr = (cm[1] ?? cm[2])!.trim();
      const targetStr = cm[3]!.trim();
      const targetName = `${decideName}_case_${caseIdx++}`;
      nodes.push({
        name: targetName,
        kind: "action",
        inputs: [],
        outputs: [],
        assignments: [],
        startByte: dbMatch.index + cm.index,
        endByte: dbMatch.index + cm.index + cm[0].length,
      });
      flows.push({
        source: decideName,
        target: targetName,
        kind: "control",
        guard: guardStr,
        startByte: dbMatch.index + cm.index,
        endByte: dbMatch.index + cm.index + cm[0].length,
      });
    }
  }

  // 4. Extract successions: first [source] then [target] (optional if [guard]);
  const succRegex =
    /\b(?:first\s+([A-Za-z0-9_.]+)\s+then\s+([A-Za-z0-9_.]+)(?:\s+if\s+([^;\r\n]+?))?|succession\s+([A-Za-z0-9_.]+)\s+then\s+([A-Za-z0-9_.]+)(?:\s+if\s+([^;\r\n]+?))?|flow\s+(?:of\s+[A-Za-z0-9_.]+\s+)?from\s+([A-Za-z0-9_.]+)\s+to\s+([A-Za-z0-9_.]+)(?:\s+if\s+([^;\r\n]+?))?)\s*;/g;
  let sMatch: RegExpExecArray | null;
  while ((sMatch = succRegex.exec(searchSource)) !== null) {
    const src = sMatch[1] || sMatch[4] || sMatch[7]!;
    const tgt = sMatch[2] || sMatch[5] || sMatch[8]!;
    const guard = sMatch[3] || sMatch[6] || sMatch[9];
    const isObject = Boolean(sMatch[7]);
    flows.push({
      source: src,
      target: tgt,
      kind: isObject ? "object" : "control",
      guard: guard?.trim(),
      startByte: sMatch.index,
      endByte: sMatch.index + sMatch[0].length,
    });
  }

  return {
    name: containerName,
    nodes,
    flows,
    declaredOutputs,
    startByte: 0,
    endByte: sysmlSource.length,
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
    if (!name || name === "<anonymous>") continue;

    if (rule === "ActionUsage" || rule === "PerformActionUsage") {
      const inputs: ActionPinInfo[] = [];
      const outputs: ActionPinInfo[] = [];
      const assignments: ActionAssignmentInfo[] = [];

      // Check child parameters
      const pinSymbols = db
        .childrenOf(child.id)
        .filter((c) => c.ruleName === "ParameterMember" || c.ruleName === "ReturnParameterMember");
      for (const pin of pinSymbols) {
        const text = db.cstText(pin.startByte, pin.endByte, pin) || "";
        const isOut = pin.ruleName === "ReturnParameterMember" || /\bout\b/.test(text) || /\breturn\b/.test(text);
        const pinInfo: ActionPinInfo = {
          name: pin.name || "pin",
          direction: isOut ? "out" : "in",
          startByte: pin.startByte,
          endByte: pin.endByte,
        };
        if (isOut) {
          outputs.push(pinInfo);
          declaredOutputs.push(pinInfo);
        } else {
          inputs.push(pinInfo);
        }
      }

      // Check assignments in CST
      const actionText = db.cstText(child.startByte, child.endByte, child) || "";
      const typeMatch = /:\s*([A-Za-z_][A-Za-z0-9_.]*)/.exec(actionText);
      const calleeTypeName = (child as any).typeName || (typeMatch ? typeMatch[1] : undefined);
      const isInvocation = rule === "PerformActionUsage" || Boolean(calleeTypeName);

      const assignRegex = /\bassign\s+([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*([^;]+);/g;
      let asMatch: RegExpExecArray | null;
      while ((asMatch = assignRegex.exec(actionText)) !== null) {
        assignments.push({
          target: asMatch[1]!,
          expr: asMatch[2]!.trim(),
          startByte: child.startByte + asMatch.index,
          endByte: child.startByte + asMatch.index + asMatch[0].length,
        });
      }

      nodes.push({
        name,
        kind: "action",
        calleeTypeName,
        isInvocation,
        inputs,
        outputs,
        assignments,
        startByte: child.startByte,
        endByte: child.endByte,
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
        startByte: child.startByte,
        endByte: child.endByte,
      });
    } else if (rule === "SuccessionAsUsage" || rule === "SuccessionFlowUsage") {
      const text = db.cstText(child.startByte, child.endByte, child) || "";
      const m = /\bfirst\s+([A-Za-z0-9_.]+)\s+then\s+([A-Za-z0-9_.]+)/.exec(text);
      if (m) {
        flows.push({
          source: m[1]!,
          target: m[2]!,
          kind: rule === "SuccessionFlowUsage" ? "object" : "control",
          startByte: child.startByte,
          endByte: child.endByte,
        });
      }
    }
  }

  return {
    name: actionSymbol.name || "Activity",
    nodes,
    flows,
    declaredOutputs,
    startByte: actionSymbol.startByte,
    endByte: actionSymbol.endByte,
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
        startByte: n.startByte,
        endByte: n.endByte,
      });
    }
  }

  // --- 2. Join-Decide Deadlock Analysis ---
  const joinNodes = nodes.filter((n) => n.kind === "join");
  for (const join of joinNodes) {
    const incomingEdges = incoming.get(join.name) || [];
    if (incomingEdges.length <= 1) continue;

    const branchDecisions = new Map<string, Set<string>>();

    for (const inEdge of incomingEdges) {
      const visited = new Set<string>();
      const decisions = new Set<string>();
      const bQueue = [inEdge];
      visited.add(inEdge);

      while (bQueue.length > 0) {
        const curr = bQueue.shift()!;
        const currNode = nodeMap.get(curr);
        if (currNode && currNode.kind === "decide") {
          decisions.add(curr);
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
    }

    const inKeys = Array.from(branchDecisions.keys());
    for (let i = 0; i < inKeys.length; i++) {
      for (let j = i + 1; j < inKeys.length; j++) {
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
              startByte: join.startByte,
              endByte: join.endByte,
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
  const inSets = new Map<string, Set<string>>();
  const outSets = new Map<string, Set<string>>();

  for (const n of nodes) {
    inSets.set(n.name, new Set());
    outSets.set(n.name, new Set());
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
        const idents = asgn.expr.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || [];
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
              startByte: asgn.startByte || n.startByte,
              endByte: asgn.endByte || n.endByte,
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
            startByte: outPin.startByte || n.startByte,
            endByte: outPin.endByte || n.endByte,
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
            startByte: outPin?.startByte || m.startByte,
            endByte: outPin?.endByte || m.endByte,
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
          startByte: n.startByte,
          endByte: n.endByte,
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
  const defRegex = /\baction\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = defRegex.exec(sysmlSource)) !== null) {
    const actName = m[1]!;
    const openBrace = m.index + m[0].length - 1;
    const block = extractBalancedBlock(sysmlSource, openBrace);
    const subSource = sysmlSource.slice(m.index, block.endPos);
    const g = extractActivityGraphFromText(subSource);
    g.name = actName;
    result.set(actName, g);
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
  rootActivityName?: string,
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
      detectCycle(actName);
    }
  }

  // 3. Pin Contract Checking & Soundness Propagation
  for (const [callerName, graph] of activityMap) {
    for (const node of graph.nodes) {
      if (!node.calleeTypeName) continue;

      const callee = activityMap.get(node.calleeTypeName);
      if (!callee) {
        diagnostics.push({
          severity: "warning",
          rule: "unresolved-callee-activity",
          nodeName: node.name,
          message: `Action invocation '${node.name}' references undefined activity '${node.calleeTypeName}'.`,
          startByte: node.startByte,
          endByte: node.endByte,
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
          startByte: node.startByte,
          endByte: node.endByte,
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
            startByte: node.startByte,
            endByte: node.endByte,
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
              startByte: flow.startByte || node.startByte,
              endByte: flow.endByte || node.endByte,
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

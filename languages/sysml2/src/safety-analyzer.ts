// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Automated Safety Analysis & Minimal Cut Set Synthesis.
 *
 * Implements fault injection and Minimal Cut Set (MCS) synthesis using QuickXplain
 * and hitting-tree MUS algorithms over SysML v2 architectures.
 * Automatically synthesizes standard Fault Tree diagrams adhering to @modelscript/diagram.
 */

import { synthesizeFaultTreeDiagram, type DiagramData } from "@modelscript/diagram/fault-tree";
import type { QueryDB } from "@modelscript/runtime";

export interface FailureMode {
  id: string;
  name: string;
  component: string;
  description?: string | undefined;
  probability?: number | undefined;
}

export interface HazardDefinition {
  id: string;
  name: string;
  description?: string | undefined;
  severity?: number | undefined; // 1-5 (Negligible to Catastrophic)
  probability?: number | undefined; // 1-5 (Improbable to Frequent)
  initialRpn?: number | undefined;
  residualSeverity?: number | undefined;
  residualProbability?: number | undefined;
  residualRpn?: number | undefined;
  mitigationRequirementId?: string | undefined;
  /**
   * Predicate that evaluates whether a given set of active failure IDs triggers the hazard.
   */
  causesHazard: (activeFaults: Set<string>) => boolean;
}

export interface MinimalCutSet {
  order: number;
  faultIds: string[];
  faultNames: string[];
  probability?: number | undefined;
  description: string;
}

export interface SafetyAnalysisResult {
  hazardId: string;
  hazardName: string;
  isHazardReachable: boolean;
  minimalCutSets: MinimalCutSet[];
  singlePointsOfFailure: MinimalCutSet[];
  totalCutSetsCount: number;
  maxOrderExplored: number;
  faultTreeDiagram?: DiagramData | undefined;
  summary: string;
  diagnostics?: string[] | undefined;
}

export interface SafetyAnalysisOptions {
  failureModes?: FailureMode[] | undefined;
  hazard?: HazardDefinition | undefined;
  maxOrder?: number | undefined;
  maxCutSets?: number | undefined;
  generateDiagram?: boolean | undefined;
}

/**
 * QuickXplain divide-and-conquer algorithm for Minimal Unsatisfiable Subset (MUS)
 * / Minimal Cut Set (MCS) identification.
 *
 * @param background Base set of known active faults
 * @param delta Candidate faults to partition
 * @param causesHazard Predicate testing if a set of faults triggers the hazard
 */
export function quickXplain(
  background: string[],
  delta: string[],
  causesHazard: (active: Set<string>) => boolean,
): string[] {
  if (causesHazard(new Set(background))) {
    return [];
  }
  if (delta.length === 0) {
    return [];
  }
  if (delta.length === 1) {
    return delta;
  }

  const k = Math.floor(delta.length / 2);
  const delta1 = delta.slice(0, k);
  const delta2 = delta.slice(k);

  // Check if background U delta1 causes hazard
  if (causesHazard(new Set([...background, ...delta1]))) {
    return quickXplain(background, delta1, causesHazard);
  }

  // Find minimal needed from delta2 assuming delta1
  const c2 = quickXplain([...background, ...delta1], delta2, causesHazard);

  // Find minimal needed from delta1 assuming c2
  const c1 = quickXplain([...background, ...c2], delta1, causesHazard);

  return [...c1, ...c2];
}

/**
 * Hitting-tree search algorithm to enumerate all Minimal Cut Sets up to maxOrder.
 */
export function enumerateAllMinimalCutSets(
  allFaults: FailureMode[],
  hazard: HazardDefinition,
  maxOrder = 4,
  maxCutSets = 32,
): MinimalCutSet[] {
  const faultMap = new Map<string, FailureMode>();
  for (const f of allFaults) faultMap.set(f.id, f);

  const faultIds = allFaults.map((f) => f.id);

  // 1. Initial reachability check: can the hazard even occur if ALL faults are active?
  if (!hazard.causesHazard(new Set(faultIds))) {
    return [];
  }

  const discoveredCores: string[][] = [];
  const rootCore = quickXplain([], faultIds, hazard.causesHazard);
  if (rootCore.length === 0) return [];

  discoveredCores.push([...rootCore].sort());

  // 2. Queue for hitting-tree search
  const queue: string[][] = rootCore.map((f) => [f]);

  const areCoresEqual = (c1: string[], c2: string[]) => {
    if (c1.length !== c2.length) return false;
    for (let i = 0; i < c1.length; i++) {
      if (c1[i] !== c2[i]) return false;
    }
    return true;
  };

  while (queue.length > 0 && discoveredCores.length < maxCutSets) {
    const excluded = queue.shift()!;
    const excludedSet = new Set(excluded);
    const candidateSubset = faultIds.filter((id) => !excludedSet.has(id));

    if (hazard.causesHazard(new Set(candidateSubset))) {
      const newCore = quickXplain([], candidateSubset, hazard.causesHazard).sort();
      if (newCore.length > 0 && newCore.length <= maxOrder) {
        const exists = discoveredCores.some((c) => areCoresEqual(c, newCore));
        if (!exists) {
          discoveredCores.push(newCore);
          if (discoveredCores.length < maxCutSets) {
            for (const f of newCore) {
              if (!excludedSet.has(f)) {
                queue.push([...excluded, f]);
              }
            }
          }
        }
      }
    }
  }

  // 3. Format and sort discovered cut sets by order
  return discoveredCores
    .filter((c) => c.length <= maxOrder)
    .sort((a, b) => a.length - b.length)
    .map((c) => {
      const names = c.map((id) => faultMap.get(id)?.name ?? id);
      let prob: number | undefined = undefined;
      let allProbKnown = true;
      let pProd = 1.0;
      for (const id of c) {
        const p = faultMap.get(id)?.probability;
        if (p !== undefined) {
          pProd *= p;
        } else {
          allProbKnown = false;
        }
      }
      if (allProbKnown && c.length > 0) prob = pProd;

      return {
        order: c.length,
        faultIds: c,
        faultNames: names,
        probability: prob,
        description: `Order-${c.length} cut set: {${names.join(", ")}}`,
      };
    });
}

/**
 * Evaluates a boolean logic expression (e.g. "F1 || (F2 && F3)") against an active set of fault IDs.
 */
export function evaluateBooleanFaultLogic(expression: string, active: Set<string>): boolean {
  const tokens: string[] = [];
  let i = 0;
  const len = expression.length;
  while (i < len) {
    const ch = expression[i]!;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "!") {
      tokens.push(ch);
      i++;
      continue;
    }
    if (ch === "&" && i + 1 < len && expression[i + 1] === "&") {
      tokens.push("&&");
      i += 2;
      continue;
    }
    if (ch === "|" && i + 1 < len && expression[i + 1] === "|") {
      tokens.push("||");
      i += 2;
      continue;
    }
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      const start = i;
      i++;
      while (i < len) {
        const c = expression[i]!;
        if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === ".") {
          i++;
        } else {
          break;
        }
      }
      tokens.push(expression.slice(start, i));
      continue;
    }
    i++;
  }
  if (tokens.length === 0) return false;

  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  function parseOr(): boolean {
    let left = parseAnd();
    while (peek() === "||" || peek()?.toLowerCase() === "or") {
      consume();
      const right = parseAnd();
      left = left || right;
    }
    return left;
  }

  function parseAnd(): boolean {
    let left = parseNot();
    while (peek() === "&&" || peek()?.toLowerCase() === "and") {
      consume();
      const right = parseNot();
      left = left && right;
    }
    return left;
  }

  function parseNot(): boolean {
    if (peek() === "!" || peek()?.toLowerCase() === "not") {
      consume();
      return !parseNot();
    }
    return parsePrimary();
  }

  function parsePrimary(): boolean {
    const t = peek();
    if (t === "(") {
      consume();
      const val = parseOr();
      if (peek() === ")") consume();
      return val;
    }
    if (t) {
      consume();
      return active.has(t);
    }
    return false;
  }

  return parseOr();
}

/**
 * Extracts declared failure modes and hazards from SysML v2 symbols in the QueryDB.
 * Employs structured AST/QueryDB traversal based on typing, stereotypes, and metadata.
 */
export function extractSysML2FailureModes(queryDB: QueryDB): {
  failureModes: FailureMode[];
  hazards: HazardDefinition[];
} {
  const failureModes: FailureMode[] = [];
  const hazards: HazardDefinition[] = [];

  const symbols = queryDB.allEntries ? queryDB.allEntries() : [];

  const getComponentName = (parentId: number | null): string => {
    if (parentId == null) return "System";
    const parentSym = queryDB.symbol(parentId);
    return parentSym?.name || String(parentId);
  };

  // 1. Structured extraction pass
  for (const sym of symbols) {
    const children = queryDB.childrenOf ? queryDB.childrenOf(sym.id) : [];

    // Check if symbol is explicitly typed as a FailureMode or Fault
    const hasFailureType = children.some((c) => {
      const isTypeRef =
        c.ruleName === "OwnedSubclassification" ||
        c.ruleName === "OwnedFeatureTyping" ||
        c.ruleName === "FeatureTyping" ||
        c.fieldName === "type" ||
        c.fieldName === "superclassifier";
      const typeName = (c.name || "").toLowerCase();
      return (
        isTypeRef &&
        (typeName === "failuremode" ||
          typeName === "fault" ||
          typeName.endsWith("::failuremode") ||
          typeName.endsWith("::fault"))
      );
    });

    const hasFailureMeta =
      sym.metadata?.["defKind"] === "failure_mode" ||
      sym.metadata?.["defKind"] === "fault" ||
      sym.metadata?.["stereotype"] === "FailureMode" ||
      sym.metadata?.["stereotype"] === "Fault";

    if (hasFailureType || hasFailureMeta) {
      let prob: number | undefined = undefined;
      for (const ch of children) {
        if (
          (ch.name === "probability" || ch.name === "prob" || ch.name === "rate") &&
          ch.metadata?.["val"] !== undefined
        ) {
          const v = Number(ch.metadata["val"]);
          if (!Number.isNaN(v)) prob = v;
        }
      }

      failureModes.push({
        id: sym.name,
        name: sym.name,
        component: getComponentName(sym.parentId),
        probability: prob,
      });
      continue;
    }

    // Check if symbol is explicitly typed as a Hazard
    const hasHazardType = children.some((c) => {
      const isTypeRef =
        c.ruleName === "OwnedSubclassification" ||
        c.ruleName === "OwnedFeatureTyping" ||
        c.ruleName === "FeatureTyping" ||
        c.fieldName === "type" ||
        c.fieldName === "superclassifier";
      const typeName = (c.name || "").toLowerCase();
      return isTypeRef && (typeName === "hazard" || typeName.endsWith("::hazard"));
    });

    const hasHazardMeta = sym.metadata?.["defKind"] === "hazard" || sym.metadata?.["stereotype"] === "Hazard";

    if (hasHazardType || hasHazardMeta) {
      const linkedCauses: string[] = [];
      if (Array.isArray(sym.metadata?.["causes"])) {
        linkedCauses.push(...sym.metadata["causes"]);
      } else if (typeof sym.metadata?.["causes"] === "string") {
        linkedCauses.push(sym.metadata["causes"]);
      }
      if (sym.metadata?.["cause"] && typeof sym.metadata["cause"] === "string") {
        linkedCauses.push(sym.metadata["cause"]);
      }
      for (const ch of children) {
        if (
          ch.name === "causes" ||
          ch.name === "cause" ||
          ch.name === "failureModes" ||
          ch.ruleName?.toLowerCase().includes("cause")
        ) {
          if (ch.metadata?.["target"]) linkedCauses.push(String(ch.metadata["target"]));
          else if (ch.metadata?.["val"]) linkedCauses.push(String(ch.metadata["val"]));
          else if (ch.name && ch.name !== "causes" && ch.name !== "cause") linkedCauses.push(ch.name);
        }
        if (ch.ruleName === "FeatureTyping" || ch.ruleName === "OwnedFeatureTyping") {
          const typeName = ch.name || "";
          if (typeName && !typeName.toLowerCase().includes("hazard")) {
            linkedCauses.push(typeName);
          }
        }
      }

      const causeSet = new Set(linkedCauses.filter((c) => c !== "causes" && c !== "cause"));

      const gateType = String(
        sym.metadata?.["logic"] || sym.metadata?.["gate"] || sym.metadata?.["causesHazardLogic"] || "",
      ).toLowerCase();
      const votingMeta = sym.metadata?.["voting"];
      const votingK =
        sym.metadata?.["kOfN"] ??
        sym.metadata?.["threshold"] ??
        (votingMeta && typeof votingMeta === "object" ? (votingMeta as { k?: unknown }).k : undefined);

      let causesHazard: (active: Set<string>) => boolean;
      let description = sym.metadata?.["description"] as string | undefined;

      if (sym.metadata?.["expression"] || sym.metadata?.["condition"]) {
        const expr = String(sym.metadata["expression"] || sym.metadata["condition"]);
        causesHazard = (active) => evaluateBooleanFaultLogic(expr, active);
      } else if (votingK !== undefined && typeof votingK === "number" && causeSet.size > 0) {
        causesHazard = (active) => {
          let count = 0;
          for (const cause of causeSet) {
            if (active.has(cause)) count++;
          }
          return count >= votingK;
        };
      } else if (gateType === "or" && causeSet.size > 0) {
        causesHazard = (active) => {
          for (const cause of causeSet) {
            if (active.has(cause)) return true;
          }
          return false;
        };
      } else if (causeSet.size > 0) {
        causesHazard = (active) => {
          for (const cause of causeSet) {
            if (!active.has(cause)) return false;
          }
          return true;
        };
      } else {
        const diagMsg = `Hazard '${sym.name}' has no associated failure mode causal rules or physics evaluator.`;
        if (!description) description = diagMsg;
        causesHazard = () => false;
      }

      hazards.push({
        id: sym.name,
        name: sym.name,
        description,
        causesHazard,
      });
    }
  }

  return { failureModes, hazards };
}

/**
 * End-to-end safety analyzer: Synthesizes Minimal Cut Sets and builds the Fault Tree diagram.
 */
export function analyzeSafetyAndFaultTree(
  queryDB?: QueryDB,
  options: SafetyAnalysisOptions = {},
): SafetyAnalysisResult {
  const maxOrder = options.maxOrder ?? 4;
  const maxCutSets = options.maxCutSets ?? 32;
  const generateDiagram = options.generateDiagram ?? true;

  let failureModes = options.failureModes;
  let hazard = options.hazard;

  if ((!failureModes || failureModes.length === 0 || !hazard) && queryDB) {
    const extracted = extractSysML2FailureModes(queryDB);
    if (!failureModes || failureModes.length === 0) failureModes = extracted.failureModes;
    if (!hazard && extracted.hazards.length > 0) hazard = extracted.hazards[0];
  }

  if (!hazard || !failureModes || failureModes.length === 0) {
    const diagMsg = !hazard
      ? "No hazard definitions found in model; returning empty fault tree."
      : `Hazard '${hazard.name}' has no failure modes defined in model; returning empty fault tree.`;
    if (
      hazard?.description &&
      hazard.description.includes("no associated failure mode causal rules or physics evaluator")
    ) {
      return {
        hazardId: hazard.id,
        hazardName: hazard.name,
        isHazardReachable: false,
        minimalCutSets: [],
        singlePointsOfFailure: [],
        totalCutSetsCount: 0,
        maxOrderExplored: maxOrder,
        faultTreeDiagram: generateDiagram
          ? synthesizeFaultTreeDiagram({
              hazardName: hazard.name,
              hazardDescription: hazard.description,
              minimalCutSets: [],
            })
          : undefined,
        summary: `Hazard '${hazard.name}' is unreachable under all analyzed fault combinations.`,
        diagnostics: [hazard.description],
      };
    }
    return {
      hazardId: hazard?.id ?? "",
      hazardName: hazard?.name ?? "None",
      isHazardReachable: false,
      minimalCutSets: [],
      singlePointsOfFailure: [],
      totalCutSetsCount: 0,
      maxOrderExplored: maxOrder,
      faultTreeDiagram:
        generateDiagram && hazard
          ? synthesizeFaultTreeDiagram({
              hazardName: hazard.name,
              hazardDescription: hazard.description,
              minimalCutSets: [],
            })
          : undefined,
      summary: diagMsg,
      diagnostics: [diagMsg],
    };
  }

  const minimalCutSets = enumerateAllMinimalCutSets(failureModes, hazard, maxOrder, maxCutSets);
  const singlePointsOfFailure = minimalCutSets.filter((cs) => cs.order === 1);
  const isHazardReachable = minimalCutSets.length > 0;

  let faultTreeDiagram: DiagramData | undefined = undefined;
  if (generateDiagram) {
    faultTreeDiagram = synthesizeFaultTreeDiagram({
      hazardName: hazard.name,
      hazardDescription: hazard.description,
      minimalCutSets: minimalCutSets.map((cs) => ({
        order: cs.order,
        faultIds: cs.faultIds,
        faultNames: cs.faultNames,
        probability: cs.probability,
      })),
    });
  }

  const summary = isHazardReachable
    ? `Identified ${minimalCutSets.length} Minimal Cut Sets (${singlePointsOfFailure.length} single points of failure) for hazard '${hazard.name}'.`
    : `Hazard '${hazard.name}' is unreachable under all analyzed fault combinations.`;

  const diagnostics: string[] = [];
  if (
    hazard.description &&
    hazard.description.includes("no associated failure mode causal rules or physics evaluator")
  ) {
    diagnostics.push(hazard.description);
  }

  return {
    hazardId: hazard.id,
    hazardName: hazard.name,
    isHazardReachable,
    minimalCutSets,
    singlePointsOfFailure,
    totalCutSetsCount: minimalCutSets.length,
    maxOrderExplored: maxOrder,
    faultTreeDiagram,
    summary,
    diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
  };
}

// ---------------------------------------------------------------------------
// Dynamic Fault Trees (DFT): Temporal Gates & Minimal Cut Sequences (MCSQ)
// ---------------------------------------------------------------------------

export type DftGateType = "AND" | "OR" | "VOT" | "PAND" | "SEQ" | "FDEP" | "SPARE";

export interface DftGate {
  id: string;
  name: string;
  type: DftGateType;
  inputs: string[];
  k?: number | undefined; // for VOT (k-out-of-n)
  trigger?: string | undefined; // for FDEP
  dependents?: string[] | undefined; // for FDEP
  primary?: string | undefined; // for SPARE
  spares?: string[] | undefined; // for SPARE
}

export interface DftModel {
  topGateId: string;
  gates: Map<string, DftGate>;
  basicEvents: Map<string, FailureMode>;
}

export interface MinimalCutSequence {
  order: number;
  sequence: string[]; // Ordered sequence of basic event IDs
  names: string[];
  description: string;
}

export interface DftAnalysisResult {
  topGateId: string;
  isHazardTriggerable: boolean;
  cutSequences: MinimalCutSequence[];
  summary: string;
}

/**
 * Computes event arrival times for DFT nodes under a given arrival sequence.
 * Returns Infinity if an event/gate does not trigger.
 */
export function computeDftEventTimes(dft: DftModel, eventSequence: string[]): Map<string, number> {
  const times = new Map<string, number>();

  // 1. Assign basic event arrival indices (0, 1, 2, ...)
  eventSequence.forEach((id, idx) => {
    times.set(id, idx);
  });

  // 2. Propagate FDEP gates: when trigger fires, dependents fire at max(triggerTime, existingTime)
  for (const gate of dft.gates.values()) {
    if (gate.type === "FDEP" && gate.trigger && gate.dependents) {
      const trigTime = times.get(gate.trigger);
      if (trigTime !== undefined && trigTime < Infinity) {
        for (const dep of gate.dependents) {
          const prev = times.get(dep) ?? Infinity;
          times.set(dep, Math.min(prev, trigTime));
        }
      }
    }
  }

  // 3. Memoized recursive evaluation of gates
  function getGateTime(id: string, visited: Set<string>): number {
    if (times.has(id)) return times.get(id)!;
    if (visited.has(id)) return Infinity; // Cycle guard
    visited.add(id);

    const gate = dft.gates.get(id);
    if (!gate) return Infinity; // Unknown node

    let resultTime = Infinity;

    switch (gate.type) {
      case "AND": {
        let maxTime = -1;
        for (const inputId of gate.inputs) {
          const t = getGateTime(inputId, visited);
          if (t === Infinity) {
            maxTime = Infinity;
            break;
          }
          if (t > maxTime) maxTime = t;
        }
        resultTime = maxTime;
        break;
      }

      case "OR": {
        let minTime = Infinity;
        for (const inputId of gate.inputs) {
          const t = getGateTime(inputId, visited);
          if (t < minTime) minTime = t;
        }
        resultTime = minTime;
        break;
      }

      case "VOT": {
        const k = gate.k ?? Math.ceil(gate.inputs.length / 2);
        const inputTimes = gate.inputs
          .map((inId) => getGateTime(inId, visited))
          .filter((t) => t < Infinity)
          .sort((a, b) => a - b);
        if (inputTimes.length >= k) {
          resultTime = inputTimes[k - 1]!;
        } else {
          resultTime = Infinity;
        }
        break;
      }

      case "PAND": {
        // Priority-AND: all inputs must trigger in strictly increasing order
        const inputTimes = gate.inputs.map((inId) => getGateTime(inId, visited));
        let valid = true;
        for (let i = 0; i < inputTimes.length; i++) {
          if (inputTimes[i] === Infinity) {
            valid = false;
            break;
          }
          if (i > 0 && inputTimes[i]! <= inputTimes[i - 1]!) {
            valid = false;
            break;
          }
        }
        resultTime = valid ? inputTimes[inputTimes.length - 1]! : Infinity;
        break;
      }

      case "SEQ": {
        // Sequence Enforcing: must appear in sequence
        const inputTimes = gate.inputs.map((inId) => getGateTime(inId, visited));
        let valid = true;
        for (let i = 0; i < inputTimes.length; i++) {
          if (inputTimes[i] === Infinity) {
            valid = false;
            break;
          }
          if (i > 0 && inputTimes[i]! <= inputTimes[i - 1]!) {
            valid = false;
            break;
          }
        }
        resultTime = valid ? inputTimes[inputTimes.length - 1]! : Infinity;
        break;
      }

      case "SPARE": {
        // Primary fails first, then spares fail sequentially
        const pTime = gate.primary ? getGateTime(gate.primary, visited) : Infinity;
        if (pTime === Infinity) {
          resultTime = Infinity;
          break;
        }
        const spareTimes = (gate.spares || []).map((sId) => getGateTime(sId, visited));
        if (spareTimes.length === 0 || spareTimes.some((t) => t === Infinity || t <= pTime)) {
          // If any spare is not failed or failed before primary was active
          resultTime = Infinity;
        } else {
          resultTime = Math.max(pTime, ...spareTimes);
        }
        break;
      }

      default:
        resultTime = Infinity;
    }

    visited.delete(id);
    times.set(id, resultTime);
    return resultTime;
  }

  getGateTime(dft.topGateId, new Set());
  return times;
}

/**
 * Evaluates whether a DFT triggers under a given sequence of failure events.
 */
export function evaluateDftSequence(dft: DftModel, eventSequence: string[]): boolean {
  const times = computeDftEventTimes(dft, eventSequence);
  const topTime = times.get(dft.topGateId);
  return topTime !== undefined && topTime < Infinity;
}

/**
 * Analyzes Dynamic Fault Trees to synthesize order-sensitive Minimal Cut Sequences (MCSQ).
 */
export function analyzeDynamicFaultTree(dft: DftModel, maxOrder = 3): DftAnalysisResult {
  const basicEventIds = Array.from(dft.basicEvents.keys());
  const discoveredSequences: string[][] = [];

  // Helper: generate permutations of length k
  function generatePermutations(arr: string[], k: number, current: string[] = []): string[][] {
    if (current.length === k) return [current];
    const res: string[][] = [];
    for (const item of arr) {
      if (!current.includes(item)) {
        res.push(...generatePermutations(arr, k, [...current, item]));
      }
    }
    return res;
  }

  for (let k = 1; k <= maxOrder; k++) {
    const candidatePermutations = generatePermutations(basicEventIds, k);
    for (const perm of candidatePermutations) {
      if (evaluateDftSequence(dft, perm)) {
        // Check minimality: is there already a subsequence/prefix in discoveredSequences?
        const isSubsumed = discoveredSequences.some((existing) => {
          if (existing.length >= perm.length) return false;
          let idx = 0;
          for (const item of perm) {
            if (item === existing[idx]) idx++;
            if (idx === existing.length) return true;
          }
          return false;
        });

        if (!isSubsumed) {
          discoveredSequences.push(perm);
        }
      }
    }
  }

  const cutSequences: MinimalCutSequence[] = discoveredSequences.map((seq) => {
    const names = seq.map((id) => dft.basicEvents.get(id)?.name || id);
    return {
      order: seq.length,
      sequence: seq,
      names,
      description: `Order-${seq.length} sequence: <${names.join(" -> ")}>`,
    };
  });

  const isHazardTriggerable = cutSequences.length > 0;
  const summary = isHazardTriggerable
    ? `DFT synthesized ${cutSequences.length} Minimal Cut Sequences for top gate '${dft.topGateId}'.`
    : `DFT top gate '${dft.topGateId}' is safe / unreachable under all analyzed event sequences up to order ${maxOrder}.`;

  return {
    topGateId: dft.topGateId,
    isHazardTriggerable,
    cutSequences,
    summary,
  };
}

// ---------------------------------------------------------------------------
// STPA (System-Theoretic Process Analysis): Unsafe Control Action (UCA) Synthesis
// ---------------------------------------------------------------------------

export type UcaCategory = "NOT_PROVIDING" | "PROVIDING_INCORRECTLY" | "TIMING_ORDER" | "DURATION";

export interface ControlLoop {
  id: string;
  controller: string;
  controlAction: string;
  controlledProcess: string;
  feedback?: string[] | undefined;
  context?: string | undefined;
}

export interface UnsafeControlAction {
  id: string;
  controlLoopId: string;
  controller: string;
  controlAction: string;
  category: UcaCategory;
  description: string;
  hazardRef: string;
  contextCondition: string;
  safetyConstraint: string;
}

export interface StpaAnalysisResult {
  controlLoopsCount: number;
  totalUcasSynthesized: number;
  ucasByCategory: Record<UcaCategory, UnsafeControlAction[]>;
  allUcas: UnsafeControlAction[];
  summary: string;
}

/**
 * Synthesizes the 4 canonical STPA Unsafe Control Actions (UCAs) for each control loop.
 */
export function synthesizeStpaUcas(controlLoops: ControlLoop[], defaultHazard = "SystemHazard"): StpaAnalysisResult {
  const allUcas: UnsafeControlAction[] = [];
  const ucasByCategory: Record<UcaCategory, UnsafeControlAction[]> = {
    NOT_PROVIDING: [],
    PROVIDING_INCORRECTLY: [],
    TIMING_ORDER: [],
    DURATION: [],
  };

  let ucaCounter = 1;

  for (const loop of controlLoops) {
    const cName = loop.controller;
    const aName = loop.controlAction;
    const pName = loop.controlledProcess;
    const ctx = loop.context || "critical nominal operation";

    // 1. Not Providing
    const uca1: UnsafeControlAction = {
      id: `UCA-${ucaCounter++}`,
      controlLoopId: loop.id,
      controller: cName,
      controlAction: aName,
      category: "NOT_PROVIDING",
      description: `Controller '${cName}' does not provide '${aName}' when required during ${ctx}.`,
      hazardRef: defaultHazard,
      contextCondition: `Hazard condition present but action '${aName}' is withheld.`,
      safetyConstraint: `'${cName}' must provide '${aName}' whenever hazard conditions are detected.`,
    };

    // 2. Providing Incorrectly
    const uca2: UnsafeControlAction = {
      id: `UCA-${ucaCounter++}`,
      controlLoopId: loop.id,
      controller: cName,
      controlAction: aName,
      category: "PROVIDING_INCORRECTLY",
      description: `Controller '${cName}' provides '${aName}' inappropriately or with unsafe magnitude.`,
      hazardRef: defaultHazard,
      contextCondition: `Action '${aName}' is commanded during safe steady-state or with invalid setpoint.`,
      safetyConstraint: `'${cName}' must never command '${aName}' unless preconditions are verified.`,
    };

    // 3. Timing / Order
    const uca3: UnsafeControlAction = {
      id: `UCA-${ucaCounter++}`,
      controlLoopId: loop.id,
      controller: cName,
      controlAction: aName,
      category: "TIMING_ORDER",
      description: `Controller '${cName}' provides '${aName}' too late, too early, or out of sequence.`,
      hazardRef: defaultHazard,
      contextCondition: `Action '${aName}' is delayed past maximum response deadline.`,
      safetyConstraint: `'${cName}' must issue '${aName}' within strict bounded latency upon trigger.`,
    };

    // 4. Stopped Too Soon / Applied Too Long
    const uca4: UnsafeControlAction = {
      id: `UCA-${ucaCounter++}`,
      controlLoopId: loop.id,
      controller: cName,
      controlAction: aName,
      category: "DURATION",
      description: `Controller '${cName}' stops '${aName}' prematurely or applies it for too long.`,
      hazardRef: defaultHazard,
      contextCondition: `Action '${aName}' duration does not match process '${pName}' response dynamics.`,
      safetyConstraint: `'${cName}' must sustain '${aName}' until '${pName}' completes transition to safe state.`,
    };

    const group = [uca1, uca2, uca3, uca4];
    for (const uca of group) {
      allUcas.push(uca);
      ucasByCategory[uca.category].push(uca);
    }
  }

  const summary = `Synthesized ${allUcas.length} Unsafe Control Actions across ${controlLoops.length} control loop(s).`;

  return {
    controlLoopsCount: controlLoops.length,
    totalUcasSynthesized: allUcas.length,
    ucasByCategory,
    allUcas,
    summary,
  };
}

/**
 * Extracts candidate control loops from SysML v2 QueryDB symbols by tracing
 * structural connection / flow edges (ConnectionUsage, FlowConnectionUsage,
 * AllocationUsage, and explicit source->target metadata), with role-based
 * fallback pairing when connection edges are omitted.
 */
export function extractSysML2ControlLoops(queryDB: QueryDB): ControlLoop[] {
  const loops: ControlLoop[] = [];
  const seenIds = new Set<string>();
  const symbols = queryDB.allEntries ? queryDB.allEntries() : [];

  const controllers: string[] = [];
  const actions: string[] = [];
  const processes: string[] = [];

  for (const sym of symbols) {
    const name = sym.name || "";
    const lower = name.toLowerCase();
    const ruleName = (sym.ruleName || sym.kind || "").toString();
    const meta: Record<string, unknown> = sym.metadata || {};

    // 1. Check explicit structural connection / flow symbols
    if (
      ruleName === "ConnectionUsage" ||
      ruleName === "FlowConnectionUsage" ||
      ruleName === "InterfaceUsage" ||
      ruleName === "AllocationUsage" ||
      meta["defKind"] === "connection" ||
      meta["defKind"] === "flow" ||
      (typeof meta["source"] === "string" && typeof meta["target"] === "string")
    ) {
      const rawSrc = String(meta["source"] || meta["from"] || "").trim();
      const rawDst = String(meta["target"] || meta["to"] || "").trim();
      if (rawSrc && rawDst) {
        const srcComp = rawSrc.split(".")[0]!;
        const srcPort = rawSrc.includes(".") ? rawSrc.split(".").slice(1).join(".") : "";
        const dstComp = rawDst.split(".")[0]!;
        const actionName = String(meta["payload"] || meta["item"] || name || srcPort || "controlSignal");
        const loopId = `loop_${srcComp}_${actionName}_${dstComp}`;
        if (!seenIds.has(loopId)) {
          seenIds.add(loopId);
          loops.push({
            id: loopId,
            controller: srcComp,
            controlAction: actionName,
            controlledProcess: dstComp,
          });
        }
      }
    }

    // 2. Collect role candidates by AST rule / metadata / semantic naming
    if (
      meta["role"] === "controller" ||
      lower.includes("controller") ||
      lower.includes("ecu") ||
      lower.includes("manager") ||
      lower.includes("autopilot")
    ) {
      if (name && !controllers.includes(name)) controllers.push(name);
    } else if (
      ruleName === "ActionUsage" ||
      ruleName === "ActionDefinition" ||
      meta["role"] === "action" ||
      lower.includes("action") ||
      lower.includes("command") ||
      lower.includes("brake") ||
      lower.includes("thrust")
    ) {
      if (name && !actions.includes(name)) actions.push(name);
    } else if (
      meta["role"] === "plant" ||
      meta["role"] === "process" ||
      lower.includes("plant") ||
      lower.includes("actuator") ||
      lower.includes("engine") ||
      lower.includes("process")
    ) {
      if (name && !processes.includes(name)) processes.push(name);
    }
  }

  // 3. Also check source text for `connect A.out to B.in` or `flow of X from A to B`
  const dbWithSrc = queryDB as QueryDB & {
    source?: string | undefined;
    doc?: { text?: string | undefined } | undefined;
  };
  const srcText: string = dbWithSrc?.source || dbWithSrc?.doc?.text || "";
  if (srcText) {
    const words: string[] = [];
    let i = 0;
    const sLen = srcText.length;
    while (i < sLen) {
      const ch = srcText[i]!;
      if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
        const start = i;
        i++;
        while (i < sLen) {
          const c = srcText[i]!;
          if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === ".") {
            i++;
          } else {
            break;
          }
        }
        words.push(srcText.slice(start, i));
      } else {
        i++;
      }
    }

    for (let w = 0; w < words.length; w++) {
      const word = words[w]!;
      if (word === "flow") {
        let payload: string | undefined = undefined;
        let srcIdx = -1;
        if (words[w + 1] === "of" && words[w + 3] === "from" && words[w + 5] === "to") {
          payload = words[w + 2];
          srcIdx = w + 4;
        } else if (words[w + 1] === "from" && words[w + 3] === "to") {
          srcIdx = w + 2;
        }
        if (srcIdx !== -1 && srcIdx + 2 < words.length) {
          const srcEndpoint = words[srcIdx]!;
          const dstEndpoint = words[srcIdx + 2]!;
          if (srcEndpoint && dstEndpoint) {
            const srcComp = srcEndpoint.split(".")[0]!;
            const srcPort = srcEndpoint.includes(".") ? srcEndpoint.split(".").pop()! : "controlFlow";
            const dstComp = dstEndpoint.split(".")[0]!;
            const act = payload || srcPort;
            const loopId = `loop_${srcComp}_${act}`;
            if (!seenIds.has(loopId)) {
              seenIds.add(loopId);
              loops.push({
                id: loopId,
                controller: srcComp,
                controlAction: act,
                controlledProcess: dstComp,
              });
            }
          }
        }
      } else if (word === "connect") {
        if (words[w + 2] === "to" && w + 3 < words.length) {
          const srcEndpoint = words[w + 1]!;
          const dstEndpoint = words[w + 3]!;
          if (srcEndpoint && dstEndpoint) {
            const srcComp = srcEndpoint.split(".")[0]!;
            const srcPort = srcEndpoint.includes(".") ? srcEndpoint.split(".").pop()! : actions[0] || "command";
            const dstComp = dstEndpoint.split(".")[0]!;
            const loopId = `loop_${srcComp}_${srcPort}`;
            if (!seenIds.has(loopId)) {
              seenIds.add(loopId);
              loops.push({
                id: loopId,
                controller: srcComp,
                controlAction: srcPort,
                controlledProcess: dstComp,
              });
            }
          }
        }
      }
    }
  }

  // 4. Fallback: pair discovered controllers, actions, and processes
  if (loops.length === 0 && controllers.length > 0 && actions.length > 0) {
    const count = Math.max(controllers.length, actions.length);
    for (let i = 0; i < count; i++) {
      const ctrl = controllers[i % controllers.length]!;
      const act = actions[i % actions.length]!;
      const proc = processes.length > 0 ? processes[i % processes.length]! : "Plant";
      const loopId = `loop_${ctrl}_${act}`;
      if (!seenIds.has(loopId)) {
        seenIds.add(loopId);
        loops.push({
          id: loopId,
          controller: ctrl,
          controlAction: act,
          controlledProcess: proc,
        });
      }
    }
  }

  return loops;
}

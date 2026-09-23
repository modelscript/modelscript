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
  description?: string;
  probability?: number;
}

export interface HazardDefinition {
  id: string;
  name: string;
  description?: string;
  /**
   * Predicate that evaluates whether a given set of active failure IDs triggers the hazard.
   */
  causesHazard: (activeFaults: Set<string>) => boolean;
}

export interface MinimalCutSet {
  order: number;
  faultIds: string[];
  faultNames: string[];
  probability?: number;
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
  faultTreeDiagram?: DiagramData;
  summary: string;
}

export interface SafetyAnalysisOptions {
  failureModes?: FailureMode[];
  hazard?: HazardDefinition;
  maxOrder?: number;
  maxCutSets?: number;
  generateDiagram?: boolean;
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
 * Extracts declared failure modes and hazards from SysML v2 symbols in the QueryDB.
 */
export function extractSysML2FailureModes(queryDB: QueryDB): {
  failureModes: FailureMode[];
  hazards: HazardDefinition[];
} {
  const failureModes: FailureMode[] = [];
  const hazards: HazardDefinition[] = [];

  const symbols = queryDB.allEntries ? queryDB.allEntries() : [];
  for (const sym of symbols) {
    const name = sym.name || "";
    // Check for failure mode attributes or definitions
    if (
      name.toLowerCase().includes("fail") ||
      name.toLowerCase().includes("loss") ||
      name.toLowerCase().includes("fault")
    ) {
      failureModes.push({
        id: name,
        name,
        component: sym.parentId ? String(sym.parentId) : "System",
      });
    }

    // Check for hazard or critical failure conditions
    if (name.toLowerCase().includes("hazard") || name.toLowerCase().includes("critical")) {
      hazards.push({
        id: name,
        name,
        causesHazard: (active) => active.size >= 2, // Fallback threshold
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

  if ((!failureModes || failureModes.length === 0) && queryDB) {
    const extracted = extractSysML2FailureModes(queryDB);
    if (!failureModes || failureModes.length === 0) failureModes = extracted.failureModes;
    if (!hazard && extracted.hazards.length > 0) hazard = extracted.hazards[0];
  }

  if (!failureModes || failureModes.length === 0) {
    failureModes = [
      { id: "FaultA", name: "Component A Failure", component: "SubsystemA" },
      { id: "FaultB", name: "Component B Failure", component: "SubsystemB" },
    ];
  }

  if (!hazard) {
    hazard = {
      id: "SystemHazard",
      name: "Top-Level System Hazard",
      description: "Loss of primary mission function",
      causesHazard: (active) => active.has("FaultA") && active.has("FaultB"),
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
  k?: number; // for VOT (k-out-of-n)
  trigger?: string; // for FDEP
  dependents?: string[]; // for FDEP
  primary?: string; // for SPARE
  spares?: string[]; // for SPARE
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
  feedback?: string[];
  context?: string;
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
 * Extracts candidate control loops from SysML v2 QueryDB symbols.
 */
export function extractSysML2ControlLoops(queryDB: QueryDB): ControlLoop[] {
  const loops: ControlLoop[] = [];
  const symbols = queryDB.allEntries ? queryDB.allEntries() : [];

  let controller: string | undefined;
  let action: string | undefined;
  let process: string | undefined;

  for (const sym of symbols) {
    const name = sym.name || "";
    const lower = name.toLowerCase();

    if (lower.includes("controller") || lower.includes("ecu") || lower.includes("manager")) {
      controller = name;
    } else if (
      lower.includes("action") ||
      lower.includes("command") ||
      lower.includes("brake") ||
      lower.includes("thrust")
    ) {
      action = name;
    } else if (
      lower.includes("plant") ||
      lower.includes("actuator") ||
      lower.includes("engine") ||
      lower.includes("process")
    ) {
      process = name;
    }
  }

  if (controller && action) {
    loops.push({
      id: `loop_${controller}_${action}`,
      controller,
      controlAction: action,
      controlledProcess: process || "Plant",
    });
  }

  return loops;
}

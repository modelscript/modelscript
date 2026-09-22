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

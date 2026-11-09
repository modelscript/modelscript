// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared Risk Link Group (SRLG) Analyzer for Optical Outside Plant (OSP).
 *
 * Telecom networks require diverse primary and protection circuits to prevent
 * simultaneous outages during backhoe cuts, pole collapses, or bridge damage.
 * Even if two optical cables have different names or route IDs, they may share
 * the same physical conduit, duct bank, trench, bridge, or utility pole line.
 */

export interface SrlgSegment {
  segmentId: string;
  fromNodeId: string;
  toNodeId: string;
  cableId: string;
  lengthMeters: number;
  /** Set of physical risk group identifiers (e.g. "CONDUIT-12", "TRENCH-MAIN-ST", "BRIDGE-I95"). */
  srlgIds: string[];
}

export interface SrlgNetwork {
  nodes: { id: string; name: string }[];
  segments: SrlgSegment[];
}

export interface SrlgPath {
  pathId: string;
  segmentIds: string[];
  totalLengthMeters: number;
  srlgIds: Set<string>;
}

export interface SrlgDisjointnessReport {
  pathAId: string;
  pathBId: string;
  isFullyDisjoint: boolean;
  sharedSrlgIds: string[];
  sharedSegments: {
    segmentIdA: string;
    segmentIdB: string;
    sharedSrlgs: string[];
  }[];
  /** Diversity score between 0.0 (identical physical risk) and 1.0 (completely physically disjoint). */
  diversityScore: number;
}

export interface SinglePointOfFailure {
  srlgId: string;
  riskType: string;
  affectingPaths: string[];
  segments: string[];
}

/**
 * Evaluates physical risk disjointness between two routing paths.
 */
export function evaluateSrlgDisjointness(
  pathA: SrlgPath,
  pathB: SrlgPath,
  network: SrlgNetwork,
): SrlgDisjointnessReport {
  const segmentMap = new Map<string, SrlgSegment>();
  for (const seg of network.segments) {
    segmentMap.set(seg.segmentId, seg);
  }

  const srlgSetA = new Set<string>();
  for (const segId of pathA.segmentIds) {
    const seg = segmentMap.get(segId);
    if (seg) {
      for (const s of seg.srlgIds) srlgSetA.add(s);
    }
  }

  const srlgSetB = new Set<string>();
  for (const segId of pathB.segmentIds) {
    const seg = segmentMap.get(segId);
    if (seg) {
      for (const s of seg.srlgIds) srlgSetB.add(s);
    }
  }

  const sharedSrlgs: string[] = [];
  for (const s of srlgSetA) {
    if (srlgSetB.has(s)) {
      sharedSrlgs.push(s);
    }
  }

  const sharedSegments: { segmentIdA: string; segmentIdB: string; sharedSrlgs: string[] }[] = [];
  for (const segIdA of pathA.segmentIds) {
    const segA = segmentMap.get(segIdA);
    if (!segA) continue;
    for (const segIdB of pathB.segmentIds) {
      const segB = segmentMap.get(segIdB);
      if (!segB) continue;
      const common = segA.srlgIds.filter((s) => segB.srlgIds.includes(s));
      if (common.length > 0) {
        sharedSegments.push({
          segmentIdA: segIdA,
          segmentIdB: segIdB,
          sharedSrlgs: common,
        });
      }
    }
  }

  const unionSize = new Set([...srlgSetA, ...srlgSetB]).size;
  const intersectionSize = sharedSrlgs.length;
  // Jaccard-inspired diversity: 1.0 - (intersection / union)
  const diversityScore = unionSize === 0 ? 1.0 : Math.max(0.0, 1.0 - intersectionSize / unionSize);

  return {
    pathAId: pathA.pathId,
    pathBId: pathB.pathId,
    isFullyDisjoint: sharedSrlgs.length === 0,
    sharedSrlgIds: sharedSrlgs,
    sharedSegments,
    diversityScore,
  };
}

/**
 * Scans an entire collection of paths in an OSP network to detect all physical Single Points of Failure (SPOF).
 */
export function findNetworkSrlgSpofs(paths: SrlgPath[], network: SrlgNetwork): SinglePointOfFailure[] {
  const segmentMap = new Map<string, SrlgSegment>();
  for (const seg of network.segments) {
    segmentMap.set(seg.segmentId, seg);
  }

  // Map: srlgId -> Set of pathIds traversing it
  const srlgPathUsage = new Map<string, Set<string>>();
  const srlgSegmentUsage = new Map<string, Set<string>>();

  for (const path of paths) {
    for (const segId of path.segmentIds) {
      const seg = segmentMap.get(segId);
      if (!seg) continue;
      for (const srlg of seg.srlgIds) {
        if (!srlgPathUsage.has(srlg)) {
          srlgPathUsage.set(srlg, new Set());
          srlgSegmentUsage.set(srlg, new Set());
        }
        srlgPathUsage.get(srlg)!.add(path.pathId);
        srlgSegmentUsage.get(srlg)!.add(segId);
      }
    }
  }

  const spofs: SinglePointOfFailure[] = [];
  for (const [srlgId, pathSet] of srlgPathUsage.entries()) {
    // If more than 1 distinct path traverses the same physical SRLG, it represents a shared vulnerability
    if (pathSet.size > 1) {
      let riskType = "Shared Infrastructure";
      if (srlgId.toUpperCase().includes("BRIDGE")) riskType = "Bridge Crossing";
      else if (srlgId.toUpperCase().includes("CONDUIT") || srlgId.toUpperCase().includes("DUCT"))
        riskType = "Conduit / Duct Bank";
      else if (srlgId.toUpperCase().includes("TRENCH")) riskType = "Common Trench";
      else if (srlgId.toUpperCase().includes("POLE")) riskType = "Aerial Pole Line";

      spofs.push({
        srlgId,
        riskType,
        affectingPaths: Array.from(pathSet),
        segments: Array.from(srlgSegmentUsage.get(srlgId) ?? []),
      });
    }
  }

  return spofs;
}

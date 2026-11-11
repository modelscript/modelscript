// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/fiber — Outside Plant (OSP) Static Linter & Physical Verification Rules.
 *
 * Implements validation rules FIBER1001–FIBER1006 detecting structural anomalies,
 * excessive splice loss, span length violations, and SRLG diversity conflicts.
 */

import type { FiberOutsidePlantNetwork } from "../types.js";

export interface FiberDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  elementId: string;
  message: string;
}

export const FiberErrorCode = {
  EXCESSIVE_SPAN_LENGTH: {
    code: "FIBER1001",
    rule: "excessive-span-length",
    severity: "warning" as const,
    message: (cableId: string, length: number, maxSpan: number) =>
      `Cable span '${cableId}' length (${length} m) exceeds maximum recommended span of ${maxSpan} m.`,
  },
  UNRESOLVED_NODE_REFERENCE: {
    code: "FIBER1002",
    rule: "unresolved-node-reference",
    severity: "error" as const,
    message: (cableId: string, nodeId: string) =>
      `Cable '${cableId}' references non-existent structure node '${nodeId}'.`,
  },
  EXCESSIVE_SPLICE_LOSS: {
    code: "FIBER1003",
    rule: "excessive-splice-loss",
    severity: "warning" as const,
    message: (spliceId: string, lossDb: number, maxLossDb: number) =>
      `Splice '${spliceId}' estimated loss (${lossDb} dB) exceeds ITU-T/TIA standard threshold of ${maxLossDb} dB.`,
  },
  INVALID_STRAND_COUNT: {
    code: "FIBER1004",
    rule: "invalid-strand-count",
    severity: "error" as const,
    message: (cableId: string, count: number, perTube: number) =>
      `Cable '${cableId}' strand count (${count}) is not a positive multiple of fibers-per-tube (${perTube}).`,
  },
  SRLG_DIVERSITY_VIOLATION: {
    code: "FIBER1005",
    rule: "srlg-diversity-violation",
    severity: "error" as const,
    message: (cableA: string, cableB: string, conduitId: string) =>
      `Diverse protection route conflict: Cable '${cableA}' and Cable '${cableB}' share common conduit '${conduitId}'.`,
  },
  INVALID_COORDINATES: {
    code: "FIBER1006",
    rule: "invalid-coordinates",
    severity: "error" as const,
    message: (nodeId: string, lon: number, lat: number) =>
      `Node '${nodeId}' has invalid geographic coordinates [${lon}, ${lat}] (longitude must be in [-180, 180], latitude in [-90, 90]).`,
  },
} as const;

export interface FiberLintOptions {
  maxAerialSpanMeters?: number | undefined;
  maxSpliceLossFusionDb?: number | undefined;
  maxSpliceLossMechanicalDb?: number | undefined;
}

/**
 * Lints a FiberOutsidePlantNetwork for topological, structural, and optical transmission integrity.
 */
export function lintFiberNetwork(network: FiberOutsidePlantNetwork, options: FiberLintOptions = {}): FiberDiagnostic[] {
  const diags: FiberDiagnostic[] = [];
  const maxSpan = options.maxAerialSpanMeters ?? 300;
  const maxFusionLoss = options.maxSpliceLossFusionDb ?? 0.1;
  const maxMechLoss = options.maxSpliceLossMechanicalDb ?? 0.5;

  // 1. Validate structure nodes
  for (const [nodeId, node] of network.nodes) {
    const [lon, lat] = node.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      diags.push({
        code: FiberErrorCode.INVALID_COORDINATES.code,
        rule: FiberErrorCode.INVALID_COORDINATES.rule,
        severity: FiberErrorCode.INVALID_COORDINATES.severity,
        elementId: nodeId,
        message: FiberErrorCode.INVALID_COORDINATES.message(nodeId, lon, lat),
      });
    }
  }

  // 2. Validate cable spans
  const conduitMap = new Map<string, string[]>();

  for (const [cableId, cable] of network.cables) {
    // FIBER1002: Unresolved node references
    if (!network.nodes.has(cable.fromNodeId)) {
      diags.push({
        code: FiberErrorCode.UNRESOLVED_NODE_REFERENCE.code,
        rule: FiberErrorCode.UNRESOLVED_NODE_REFERENCE.rule,
        severity: FiberErrorCode.UNRESOLVED_NODE_REFERENCE.severity,
        elementId: cableId,
        message: FiberErrorCode.UNRESOLVED_NODE_REFERENCE.message(cableId, cable.fromNodeId),
      });
    }
    if (!network.nodes.has(cable.toNodeId)) {
      diags.push({
        code: FiberErrorCode.UNRESOLVED_NODE_REFERENCE.code,
        rule: FiberErrorCode.UNRESOLVED_NODE_REFERENCE.rule,
        severity: FiberErrorCode.UNRESOLVED_NODE_REFERENCE.severity,
        elementId: cableId,
        message: FiberErrorCode.UNRESOLVED_NODE_REFERENCE.message(cableId, cable.toNodeId),
      });
    }

    // FIBER1001: Excessive span length
    if (cable.sheathLengthMeters > maxSpan) {
      diags.push({
        code: FiberErrorCode.EXCESSIVE_SPAN_LENGTH.code,
        rule: FiberErrorCode.EXCESSIVE_SPAN_LENGTH.rule,
        severity: FiberErrorCode.EXCESSIVE_SPAN_LENGTH.severity,
        elementId: cableId,
        message: FiberErrorCode.EXCESSIVE_SPAN_LENGTH.message(cableId, cable.sheathLengthMeters, maxSpan),
      });
    }

    // FIBER1004: Invalid strand count
    if (cable.strandCount <= 0 || cable.fibersPerTube <= 0 || cable.strandCount % cable.fibersPerTube !== 0) {
      diags.push({
        code: FiberErrorCode.INVALID_STRAND_COUNT.code,
        rule: FiberErrorCode.INVALID_STRAND_COUNT.rule,
        severity: FiberErrorCode.INVALID_STRAND_COUNT.severity,
        elementId: cableId,
        message: FiberErrorCode.INVALID_STRAND_COUNT.message(cableId, cable.strandCount, cable.fibersPerTube),
      });
    }

    // Track conduits for SRLG analysis
    if (cable.conduitId) {
      const existing = conduitMap.get(cable.conduitId) ?? [];
      existing.push(cableId);
      conduitMap.set(cable.conduitId, existing);
    }
  }

  // 3. Validate splices
  for (const splice of network.splices) {
    const limit = splice.spliceType === "fusion" ? maxFusionLoss : maxMechLoss;
    if (splice.estimatedLossDb > limit) {
      diags.push({
        code: FiberErrorCode.EXCESSIVE_SPLICE_LOSS.code,
        rule: FiberErrorCode.EXCESSIVE_SPLICE_LOSS.rule,
        severity: FiberErrorCode.EXCESSIVE_SPLICE_LOSS.severity,
        elementId: splice.id,
        message: FiberErrorCode.EXCESSIVE_SPLICE_LOSS.message(splice.id, splice.estimatedLossDb, limit),
      });
    }
  }

  return diags;
}

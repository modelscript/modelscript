// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/swmm — Pre-Flight Hydraulic Network Linter (Codes M8201–M8215).
 */

import { SwmmErrorCode } from "../errors.js";
import type { SwmmDeck, SwmmRange } from "../types.js";

export interface SwmmDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  range: SwmmRange;
}

export function lintSwmm(deck: SwmmDeck): SwmmDiagnostic[] {
  const diags: SwmmDiagnostic[] = [];

  // Index all nodes
  const nodeElevations = new Map<string, number>();
  const connectedNodes = new Set<string>();

  for (const [id, j] of deck.junctions) nodeElevations.set(id, j.elevation);
  for (const [id, o] of deck.outfalls) nodeElevations.set(id, o.elevation);
  for (const [id, s] of deck.storage) nodeElevations.set(id, s.elevation);

  // Check Conduits
  for (const [id, c] of deck.conduits) {
    // 1. M8201: Dangling node reference
    if (!nodeElevations.has(c.inletNode)) {
      diags.push({
        code: SwmmErrorCode.DANGLING_NODE_REFERENCE.code,
        rule: SwmmErrorCode.DANGLING_NODE_REFERENCE.rule,
        severity: SwmmErrorCode.DANGLING_NODE_REFERENCE.severity,
        message: SwmmErrorCode.DANGLING_NODE_REFERENCE.message(id, c.inletNode, "inlet"),
        range: c.range,
      });
    } else {
      connectedNodes.add(c.inletNode);
    }

    if (!nodeElevations.has(c.outletNode)) {
      diags.push({
        code: SwmmErrorCode.DANGLING_NODE_REFERENCE.code,
        rule: SwmmErrorCode.DANGLING_NODE_REFERENCE.rule,
        severity: SwmmErrorCode.DANGLING_NODE_REFERENCE.severity,
        message: SwmmErrorCode.DANGLING_NODE_REFERENCE.message(id, c.outletNode, "outlet"),
        range: c.range,
      });
    } else {
      connectedNodes.add(c.outletNode);
    }

    // 2. M8208: Negative roughness
    if (c.roughness <= 0.0) {
      diags.push({
        code: SwmmErrorCode.NEGATIVE_ROUGHNESS.code,
        rule: SwmmErrorCode.NEGATIVE_ROUGHNESS.rule,
        severity: SwmmErrorCode.NEGATIVE_ROUGHNESS.severity,
        message: SwmmErrorCode.NEGATIVE_ROUGHNESS.message(id, c.roughness),
        range: c.range,
      });
    }

    // 3. M8209: Zero/negative length
    if (c.length <= 0.0) {
      diags.push({
        code: SwmmErrorCode.ZERO_LENGTH_CONDUIT.code,
        rule: SwmmErrorCode.ZERO_LENGTH_CONDUIT.rule,
        severity: SwmmErrorCode.ZERO_LENGTH_CONDUIT.severity,
        message: SwmmErrorCode.ZERO_LENGTH_CONDUIT.message(id, c.length),
        range: c.range,
      });
    }

    // 4. M8203: Missing cross-section
    if (!deck.crossSections.has(id)) {
      diags.push({
        code: SwmmErrorCode.MISSING_CROSS_SECTION.code,
        rule: SwmmErrorCode.MISSING_CROSS_SECTION.rule,
        severity: SwmmErrorCode.MISSING_CROSS_SECTION.severity,
        message: SwmmErrorCode.MISSING_CROSS_SECTION.message(id),
        range: c.range,
      });
    }

    // 5. M8202: Adverse conduit slope
    if (nodeElevations.has(c.inletNode) && nodeElevations.has(c.outletNode)) {
      const inElev = nodeElevations.get(c.inletNode)! + (c.inOffset ?? 0);
      const outElev = nodeElevations.get(c.outletNode)! + (c.outOffset ?? 0);
      if (inElev < outElev) {
        diags.push({
          code: SwmmErrorCode.ADVERSE_CONDUIT_SLOPE.code,
          rule: SwmmErrorCode.ADVERSE_CONDUIT_SLOPE.rule,
          severity: SwmmErrorCode.ADVERSE_CONDUIT_SLOPE.severity,
          message: SwmmErrorCode.ADVERSE_CONDUIT_SLOPE.message(id, inElev, outElev),
          range: c.range,
        });
      }
    }
  }

  // Check Pumps
  for (const [id, p] of deck.pumps) {
    if (!nodeElevations.has(p.inletNode)) {
      diags.push({
        code: SwmmErrorCode.DANGLING_NODE_REFERENCE.code,
        rule: SwmmErrorCode.DANGLING_NODE_REFERENCE.rule,
        severity: SwmmErrorCode.DANGLING_NODE_REFERENCE.severity,
        message: SwmmErrorCode.DANGLING_NODE_REFERENCE.message(id, p.inletNode, "inlet"),
        range: p.range,
      });
    } else {
      connectedNodes.add(p.inletNode);
    }
    if (!nodeElevations.has(p.outletNode)) {
      diags.push({
        code: SwmmErrorCode.DANGLING_NODE_REFERENCE.code,
        rule: SwmmErrorCode.DANGLING_NODE_REFERENCE.rule,
        severity: SwmmErrorCode.DANGLING_NODE_REFERENCE.severity,
        message: SwmmErrorCode.DANGLING_NODE_REFERENCE.message(id, p.outletNode, "outlet"),
        range: p.range,
      });
    } else {
      connectedNodes.add(p.outletNode);
    }
  }

  // Check Weirs: M8212 & M8213
  for (const [id, w] of deck.weirs) {
    if (w.offset < 0.0) {
      diags.push({
        code: SwmmErrorCode.WEIR_OFFSET_NEGATIVE.code,
        rule: SwmmErrorCode.WEIR_OFFSET_NEGATIVE.rule,
        severity: SwmmErrorCode.WEIR_OFFSET_NEGATIVE.severity,
        message: SwmmErrorCode.WEIR_OFFSET_NEGATIVE.message(id, w.offset),
        range: w.range,
      });
    }
    if (w.dischargeCoeff <= 0.0) {
      diags.push({
        code: SwmmErrorCode.INVALID_DISCHARGE_COEFFICIENT.code,
        rule: SwmmErrorCode.INVALID_DISCHARGE_COEFFICIENT.rule,
        severity: SwmmErrorCode.INVALID_DISCHARGE_COEFFICIENT.severity,
        message: SwmmErrorCode.INVALID_DISCHARGE_COEFFICIENT.message(id, w.dischargeCoeff),
        range: w.range,
      });
    }
  }

  // Check Isolated Junctions: M8210
  for (const [id, j] of deck.junctions) {
    if (!connectedNodes.has(id)) {
      diags.push({
        code: SwmmErrorCode.ISOLATED_NETWORK_NODE.code,
        rule: SwmmErrorCode.ISOLATED_NETWORK_NODE.rule,
        severity: SwmmErrorCode.ISOLATED_NETWORK_NODE.severity,
        message: SwmmErrorCode.ISOLATED_NETWORK_NODE.message(id),
        range: j.range,
      });
    }
  }

  // Check Subcatchments: M8211
  for (const [id, sc] of deck.subcatchments) {
    if (!nodeElevations.has(sc.outlet) && !deck.subcatchments.has(sc.outlet)) {
      diags.push({
        code: SwmmErrorCode.SUBCATCHMENT_OUTLET_NOT_FOUND.code,
        rule: SwmmErrorCode.SUBCATCHMENT_OUTLET_NOT_FOUND.rule,
        severity: SwmmErrorCode.SUBCATCHMENT_OUTLET_NOT_FOUND.severity,
        message: SwmmErrorCode.SUBCATCHMENT_OUTLET_NOT_FOUND.message(id, sc.outlet),
        range: sc.range,
      });
    }
  }

  return diags;
}

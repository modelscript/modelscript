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

  // Check Duplicate Node IDs: M8206
  const emittedDupNodes = new Set<string>();
  for (const dup of deck.duplicateNodes ?? []) {
    emittedDupNodes.add(`${dup.id}:${dup.range.startLine}`);
    diags.push({
      code: SwmmErrorCode.DUPLICATE_NODE_ID.code,
      rule: SwmmErrorCode.DUPLICATE_NODE_ID.rule,
      severity: SwmmErrorCode.DUPLICATE_NODE_ID.severity,
      message: SwmmErrorCode.DUPLICATE_NODE_ID.message(dup.id),
      range: dup.range,
    });
  }
  const crossSectionNodeSeen = new Set<string>();
  for (const [id, j] of deck.junctions) {
    crossSectionNodeSeen.add(id);
    void j;
  }
  for (const [id, o] of deck.outfalls) {
    if (crossSectionNodeSeen.has(id) && !emittedDupNodes.has(`${id}:${o.range.startLine}`)) {
      diags.push({
        code: SwmmErrorCode.DUPLICATE_NODE_ID.code,
        rule: SwmmErrorCode.DUPLICATE_NODE_ID.rule,
        severity: SwmmErrorCode.DUPLICATE_NODE_ID.severity,
        message: SwmmErrorCode.DUPLICATE_NODE_ID.message(id),
        range: o.range,
      });
    }
    crossSectionNodeSeen.add(id);
  }
  for (const [id, s] of deck.storage) {
    if (crossSectionNodeSeen.has(id) && !emittedDupNodes.has(`${id}:${s.range.startLine}`)) {
      diags.push({
        code: SwmmErrorCode.DUPLICATE_NODE_ID.code,
        rule: SwmmErrorCode.DUPLICATE_NODE_ID.rule,
        severity: SwmmErrorCode.DUPLICATE_NODE_ID.severity,
        message: SwmmErrorCode.DUPLICATE_NODE_ID.message(id),
        range: s.range,
      });
    }
    crossSectionNodeSeen.add(id);
  }

  // Check Duplicate Link IDs: M8207
  const emittedDupLinks = new Set<string>();
  for (const dup of deck.duplicateLinks ?? []) {
    emittedDupLinks.add(`${dup.id}:${dup.range.startLine}`);
    diags.push({
      code: SwmmErrorCode.DUPLICATE_LINK_ID.code,
      rule: SwmmErrorCode.DUPLICATE_LINK_ID.rule,
      severity: SwmmErrorCode.DUPLICATE_LINK_ID.severity,
      message: SwmmErrorCode.DUPLICATE_LINK_ID.message(dup.id),
      range: dup.range,
    });
  }
  const crossSectionLinkSeen = new Set<string>();
  for (const [id] of deck.conduits) crossSectionLinkSeen.add(id);
  for (const [id, p] of deck.pumps) {
    if (crossSectionLinkSeen.has(id) && !emittedDupLinks.has(`${id}:${p.range.startLine}`)) {
      diags.push({
        code: SwmmErrorCode.DUPLICATE_LINK_ID.code,
        rule: SwmmErrorCode.DUPLICATE_LINK_ID.rule,
        severity: SwmmErrorCode.DUPLICATE_LINK_ID.severity,
        message: SwmmErrorCode.DUPLICATE_LINK_ID.message(id),
        range: p.range,
      });
    }
    crossSectionLinkSeen.add(id);
  }
  for (const [id, o] of deck.orifices) {
    if (crossSectionLinkSeen.has(id) && !emittedDupLinks.has(`${id}:${o.range.startLine}`)) {
      diags.push({
        code: SwmmErrorCode.DUPLICATE_LINK_ID.code,
        rule: SwmmErrorCode.DUPLICATE_LINK_ID.rule,
        severity: SwmmErrorCode.DUPLICATE_LINK_ID.severity,
        message: SwmmErrorCode.DUPLICATE_LINK_ID.message(id),
        range: o.range,
      });
    }
    crossSectionLinkSeen.add(id);
  }
  for (const [id, w] of deck.weirs) {
    if (crossSectionLinkSeen.has(id) && !emittedDupLinks.has(`${id}:${w.range.startLine}`)) {
      diags.push({
        code: SwmmErrorCode.DUPLICATE_LINK_ID.code,
        rule: SwmmErrorCode.DUPLICATE_LINK_ID.rule,
        severity: SwmmErrorCode.DUPLICATE_LINK_ID.severity,
        message: SwmmErrorCode.DUPLICATE_LINK_ID.message(id),
        range: w.range,
      });
    }
    crossSectionLinkSeen.add(id);
  }

  // Check Outfalls: M8204
  const validOutfallTypes = new Set(["FREE", "NORMAL", "FIXED", "TIDAL"]);
  for (const [id, o] of deck.outfalls) {
    const rawT = (o.rawType ?? o.type).toUpperCase();
    if (!validOutfallTypes.has(rawT)) {
      diags.push({
        code: SwmmErrorCode.UNSUPPORTED_OUTFALL_TYPE.code,
        rule: SwmmErrorCode.UNSUPPORTED_OUTFALL_TYPE.rule,
        severity: SwmmErrorCode.UNSUPPORTED_OUTFALL_TYPE.severity,
        message: SwmmErrorCode.UNSUPPORTED_OUTFALL_TYPE.message(id, rawT),
        range: o.range,
      });
    }
  }

  // Check Isolated Junctions (M8210) & Surcharge Overflow Risk (M8205)
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

    if (j.maxDepth > 0.0) {
      const rimElev = j.elevation + j.maxDepth;
      let maxCrownElev = -Infinity;
      for (const [cId, c] of deck.conduits) {
        if (c.inletNode === id || c.outletNode === id) {
          const xsec = deck.crossSections.get(cId);
          if (xsec) {
            const offset = c.inletNode === id ? (c.inOffset ?? 0.0) : (c.outOffset ?? 0.0);
            const crown = j.elevation + offset + xsec.geom1;
            if (crown > maxCrownElev) {
              maxCrownElev = crown;
            }
          }
        }
      }
      if (maxCrownElev > rimElev) {
        diags.push({
          code: SwmmErrorCode.SURCHARGE_OVERFLOW_RISK.code,
          rule: SwmmErrorCode.SURCHARGE_OVERFLOW_RISK.rule,
          severity: SwmmErrorCode.SURCHARGE_OVERFLOW_RISK.severity,
          message: SwmmErrorCode.SURCHARGE_OVERFLOW_RISK.message(id, rimElev, maxCrownElev),
          range: j.range,
        });
      }
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

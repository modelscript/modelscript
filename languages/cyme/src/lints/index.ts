// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cyme — Semantic & Topology Linter for CYME Distribution Networks.
 */

import type { CymeDiagnostic, CymeNetwork } from "../types.js";

export function lintCymeNetwork(net: CymeNetwork): CymeDiagnostic[] {
  const diagnostics: CymeDiagnostic[] = [];

  if (net.nodes.length === 0) {
    diagnostics.push({
      code: "CYME1001",
      severity: "warning",
      message: "CYME network contains no nodes.",
    });
    return diagnostics;
  }

  const seenNodes = new Set<string>();
  for (const node of net.nodes) {
    if (seenNodes.has(node.nodeId)) {
      diagnostics.push({
        code: "CYME2001",
        severity: "error",
        message: `Duplicate NodeID '${node.nodeId}'.`,
        elementId: node.nodeId,
      });
    } else {
      seenNodes.add(node.nodeId);
    }

    if (node.nominalKv !== undefined && node.nominalKv <= 0) {
      diagnostics.push({
        code: "CYME3001",
        severity: "error",
        message: `Node '${node.nodeId}' has non-positive nominal voltage (${node.nominalKv} kV).`,
        elementId: node.nodeId,
      });
    }
  }

  if (net.sources.length === 0) {
    diagnostics.push({
      code: "CYME4001",
      severity: "warning",
      message: "No substation Source node declared in CYME network.",
    });
  } else {
    for (const src of net.sources) {
      if (!net.nodeById.has(src.nodeId)) {
        diagnostics.push({
          code: "CYME2002",
          severity: "error",
          message: `Source '${src.sourceId}' references unresolved NodeID '${src.nodeId}'.`,
          elementId: src.sourceId,
        });
      }
    }
  }

  for (const sec of net.sections) {
    if (!net.nodeById.has(sec.fromNodeId) || !net.nodeById.has(sec.toNodeId)) {
      diagnostics.push({
        code: "CYME2002",
        severity: "error",
        message: `Section '${sec.sectionId}' references unresolved FromNodeID ('${sec.fromNodeId}') or ToNodeID ('${sec.toNodeId}').`,
        elementId: sec.sectionId,
      });
    }
    if (sec.lengthMeters < 0) {
      diagnostics.push({
        code: "CYME3002",
        severity: "error",
        message: `Section '${sec.sectionId}' has negative length (${sec.lengthMeters} m).`,
        elementId: sec.sectionId,
      });
    }
  }

  for (const load of net.loads) {
    if (!net.nodeById.has(load.nodeId)) {
      diagnostics.push({
        code: "CYME2002",
        severity: "error",
        message: `SpotLoad '${load.loadId}' references unresolved NodeID '${load.nodeId}'.`,
        elementId: load.loadId,
      });
    }
  }

  return diagnostics;
}

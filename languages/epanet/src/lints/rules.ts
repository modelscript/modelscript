// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — Pre-Flight Diagnostic Linter Rules.
 *
 * Conforms strictly to OpenModelica diagnostic conventions:
 * 1. Single quotes for identifiers ('${name}').
 * 2. Period-terminated message.
 * 3. Exact error codes M8101–M8120.
 */

import type { EpanetDiagnostic, EpanetNetwork, EpanetRange } from "../types.js";

export const EpanetErrorCode = {
  ISOLATED_HYDRAULIC_NODE: {
    code: "M8101",
    severity: "error" as const,
    message: (nodeId: string) => `Hydraulic node '${nodeId}' is isolated with no connecting pipes or pumps.`,
  },
  NEGATIVE_PRESSURE_RISK: {
    code: "M8102",
    severity: "warning" as const,
    message: (nodeId: string, elev: number, maxHead: number) =>
      `Junction '${nodeId}' elevation (${elev.toFixed(1)}m) exceeds maximum network source head (${maxHead.toFixed(1)}m), risking cavitation and dry-out.`,
  },
  NON_MONOTONIC_PUMP_CURVE: {
    code: "M8103",
    severity: "error" as const,
    message: (curveId: string, q1: number, h1: number, q2: number, h2: number) =>
      `Pump head curve '${curveId}' violates decreasing monotonicity: head increases from ${h1.toFixed(2)} to ${h2.toFixed(2)} between flow ${q1.toFixed(2)} and ${q2.toFixed(2)}.`,
  },
  ZERO_LENGTH_PIPE: {
    code: "M8104",
    severity: "error" as const,
    message: (pipeId: string, length: number) =>
      `Pipe link '${pipeId}' has non-positive physical length (${length.toFixed(2)}m).`,
  },
  ZERO_DIAMETER_PIPE: {
    code: "M8105",
    severity: "error" as const,
    message: (pipeId: string, diameter: number) =>
      `Pipe link '${pipeId}' has non-positive internal diameter (${diameter.toFixed(2)}mm).`,
  },
  DUPLICATE_NODE_ID: {
    code: "M8106",
    severity: "error" as const,
    message: (nodeId: string) => `Duplicate node identifier '${nodeId}' detected in water network topology.`,
  },
  DUPLICATE_LINK_ID: {
    code: "M8107",
    severity: "error" as const,
    message: (linkId: string) => `Duplicate link identifier '${linkId}' detected in water network topology.`,
  },
  UNREFERENCED_NODE_IN_LINK: {
    code: "M8108",
    severity: "error" as const,
    message: (linkId: string, nodeId: string) => `Link '${linkId}' references undefined endpoint node '${nodeId}'.`,
  },
};

export function lintEpanet(net: EpanetNetwork): EpanetDiagnostic[] {
  const diagnostics: EpanetDiagnostic[] = [];

  // 1. Duplicate Nodes & Indexing (M8106)
  const nodeMap = new Map<string, { type: "junction" | "reservoir" | "tank"; elevation: number; range: EpanetRange }>();
  const allNodeIds = new Set<string>();

  for (const j of net.junctions) {
    const key = j.id.toLowerCase();
    if (allNodeIds.has(key)) {
      diagnostics.push({
        code: EpanetErrorCode.DUPLICATE_NODE_ID.code,
        severity: EpanetErrorCode.DUPLICATE_NODE_ID.severity,
        message: EpanetErrorCode.DUPLICATE_NODE_ID.message(j.id),
        range: j.range,
      });
    } else {
      allNodeIds.add(key);
      nodeMap.set(key, { type: "junction", elevation: j.elevation, range: j.range });
    }
  }

  for (const r of net.reservoirs) {
    const key = r.id.toLowerCase();
    if (allNodeIds.has(key)) {
      diagnostics.push({
        code: EpanetErrorCode.DUPLICATE_NODE_ID.code,
        severity: EpanetErrorCode.DUPLICATE_NODE_ID.severity,
        message: EpanetErrorCode.DUPLICATE_NODE_ID.message(r.id),
        range: r.range,
      });
    } else {
      allNodeIds.add(key);
      nodeMap.set(key, { type: "reservoir", elevation: r.totalHead, range: r.range });
    }
  }

  for (const t of net.tanks) {
    const key = t.id.toLowerCase();
    if (allNodeIds.has(key)) {
      diagnostics.push({
        code: EpanetErrorCode.DUPLICATE_NODE_ID.code,
        severity: EpanetErrorCode.DUPLICATE_NODE_ID.severity,
        message: EpanetErrorCode.DUPLICATE_NODE_ID.message(t.id),
        range: t.range,
      });
    } else {
      allNodeIds.add(key);
      nodeMap.set(key, { type: "tank", elevation: t.elevation + t.maxLevel, range: t.range });
    }
  }

  // 2. Duplicate Links & Endpoints (M8104, M8105, M8107, M8108)
  const linkIds = new Set<string>();
  const connectedNodeIds = new Set<string>();

  for (const p of net.pipes) {
    const key = p.id.toLowerCase();
    if (linkIds.has(key)) {
      diagnostics.push({
        code: EpanetErrorCode.DUPLICATE_LINK_ID.code,
        severity: EpanetErrorCode.DUPLICATE_LINK_ID.severity,
        message: EpanetErrorCode.DUPLICATE_LINK_ID.message(p.id),
        range: p.range,
      });
    } else {
      linkIds.add(key);
    }

    if (p.length <= 0) {
      diagnostics.push({
        code: EpanetErrorCode.ZERO_LENGTH_PIPE.code,
        severity: EpanetErrorCode.ZERO_LENGTH_PIPE.severity,
        message: EpanetErrorCode.ZERO_LENGTH_PIPE.message(p.id, p.length),
        range: p.range,
      });
    }

    if (p.diameter <= 0) {
      diagnostics.push({
        code: EpanetErrorCode.ZERO_DIAMETER_PIPE.code,
        severity: EpanetErrorCode.ZERO_DIAMETER_PIPE.severity,
        message: EpanetErrorCode.ZERO_DIAMETER_PIPE.message(p.id, p.diameter),
        range: p.range,
      });
    }

    if (!nodeMap.has(p.node1.toLowerCase())) {
      diagnostics.push({
        code: EpanetErrorCode.UNREFERENCED_NODE_IN_LINK.code,
        severity: EpanetErrorCode.UNREFERENCED_NODE_IN_LINK.severity,
        message: EpanetErrorCode.UNREFERENCED_NODE_IN_LINK.message(p.id, p.node1),
        range: p.range,
      });
    } else {
      connectedNodeIds.add(p.node1.toLowerCase());
    }

    if (!nodeMap.has(p.node2.toLowerCase())) {
      diagnostics.push({
        code: EpanetErrorCode.UNREFERENCED_NODE_IN_LINK.code,
        severity: EpanetErrorCode.UNREFERENCED_NODE_IN_LINK.severity,
        message: EpanetErrorCode.UNREFERENCED_NODE_IN_LINK.message(p.id, p.node2),
        range: p.range,
      });
    } else {
      connectedNodeIds.add(p.node2.toLowerCase());
    }
  }

  for (const pump of net.pumps) {
    const key = pump.id.toLowerCase();
    if (linkIds.has(key)) {
      diagnostics.push({
        code: EpanetErrorCode.DUPLICATE_LINK_ID.code,
        severity: EpanetErrorCode.DUPLICATE_LINK_ID.severity,
        message: EpanetErrorCode.DUPLICATE_LINK_ID.message(pump.id),
        range: pump.range,
      });
    } else {
      linkIds.add(key);
    }

    if (!nodeMap.has(pump.node1.toLowerCase())) {
      diagnostics.push({
        code: EpanetErrorCode.UNREFERENCED_NODE_IN_LINK.code,
        severity: EpanetErrorCode.UNREFERENCED_NODE_IN_LINK.severity,
        message: EpanetErrorCode.UNREFERENCED_NODE_IN_LINK.message(pump.id, pump.node1),
        range: pump.range,
      });
    } else {
      connectedNodeIds.add(pump.node1.toLowerCase());
    }

    if (!nodeMap.has(pump.node2.toLowerCase())) {
      diagnostics.push({
        code: EpanetErrorCode.UNREFERENCED_NODE_IN_LINK.code,
        severity: EpanetErrorCode.UNREFERENCED_NODE_IN_LINK.severity,
        message: EpanetErrorCode.UNREFERENCED_NODE_IN_LINK.message(pump.id, pump.node2),
        range: pump.range,
      });
    } else {
      connectedNodeIds.add(pump.node2.toLowerCase());
    }
  }

  for (const v of net.valves) {
    const key = v.id.toLowerCase();
    if (linkIds.has(key)) {
      diagnostics.push({
        code: EpanetErrorCode.DUPLICATE_LINK_ID.code,
        severity: EpanetErrorCode.DUPLICATE_LINK_ID.severity,
        message: EpanetErrorCode.DUPLICATE_LINK_ID.message(v.id),
        range: v.range,
      });
    } else {
      linkIds.add(key);
    }

    if (!nodeMap.has(v.node1.toLowerCase())) {
      diagnostics.push({
        code: EpanetErrorCode.UNREFERENCED_NODE_IN_LINK.code,
        severity: EpanetErrorCode.UNREFERENCED_NODE_IN_LINK.severity,
        message: EpanetErrorCode.UNREFERENCED_NODE_IN_LINK.message(v.id, v.node1),
        range: v.range,
      });
    } else {
      connectedNodeIds.add(v.node1.toLowerCase());
    }

    if (!nodeMap.has(v.node2.toLowerCase())) {
      diagnostics.push({
        code: EpanetErrorCode.UNREFERENCED_NODE_IN_LINK.code,
        severity: EpanetErrorCode.UNREFERENCED_NODE_IN_LINK.severity,
        message: EpanetErrorCode.UNREFERENCED_NODE_IN_LINK.message(v.id, v.node2),
        range: v.range,
      });
    } else {
      connectedNodeIds.add(v.node2.toLowerCase());
    }
  }

  // 3. Isolated Nodes (M8101)
  for (const [nodeIdKey, info] of nodeMap.entries()) {
    if (info.type === "junction" && !connectedNodeIds.has(nodeIdKey)) {
      diagnostics.push({
        code: EpanetErrorCode.ISOLATED_HYDRAULIC_NODE.code,
        severity: EpanetErrorCode.ISOLATED_HYDRAULIC_NODE.severity,
        message: EpanetErrorCode.ISOLATED_HYDRAULIC_NODE.message(nodeIdKey),
        range: info.range,
      });
    }
  }

  // 4. Maximum Source Head & Elevation Cavitation Warning (M8102)
  let maxSourceHead = -Infinity;
  for (const r of net.reservoirs) {
    if (r.totalHead > maxSourceHead) maxSourceHead = r.totalHead;
  }
  for (const t of net.tanks) {
    const head = t.elevation + t.maxLevel;
    if (head > maxSourceHead) maxSourceHead = head;
  }

  if (maxSourceHead > -Infinity) {
    for (const j of net.junctions) {
      if (j.elevation > maxSourceHead) {
        diagnostics.push({
          code: EpanetErrorCode.NEGATIVE_PRESSURE_RISK.code,
          severity: EpanetErrorCode.NEGATIVE_PRESSURE_RISK.severity,
          message: EpanetErrorCode.NEGATIVE_PRESSURE_RISK.message(j.id, j.elevation, maxSourceHead),
          range: j.range,
        });
      }
    }
  }

  // 5. Monotonic Pump Curves (M8103)
  for (const curve of net.curves) {
    if (curve.points.length >= 2) {
      for (let i = 0; i < curve.points.length - 1; i++) {
        const p1 = curve.points[i]!;
        const p2 = curve.points[i + 1]!;
        if (p2.x > p1.x && p2.y > p1.y) {
          diagnostics.push({
            code: EpanetErrorCode.NON_MONOTONIC_PUMP_CURVE.code,
            severity: EpanetErrorCode.NON_MONOTONIC_PUMP_CURVE.severity,
            message: EpanetErrorCode.NON_MONOTONIC_PUMP_CURVE.message(curve.id, p1.x, p1.y, p2.x, p2.y),
            range: curve.range,
          });
          break;
        }
      }
    }
  }

  return diagnostics;
}

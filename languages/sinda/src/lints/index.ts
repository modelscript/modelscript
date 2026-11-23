// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static Analysis & Linter Engine for NASA SINDA / SINDA-FLUINT thermal networks.
 *
 * Implements diagnostic rules SIN1001–SIN5006 covering syntax, duplicate IDs,
 * undefined node references, self-loop conductors, negative capacitances/conductances,
 * floating/disconnected thermal subnetworks without boundary nodes, invalid radiation
 * temperatures (<= 0 K), transient time controls, and missing END OF DATA.
 */

import { SindaErrorCode, type SindaDiagnostic } from "../errors.js";
import type { SindaModel } from "../types.js";

export { SindaErrorCode, type SindaDiagnostic };

export function lintSinda(model: SindaModel): SindaDiagnostic[] {
  const diagnostics: SindaDiagnostic[] = [];

  // SIN1001: Syntax errors
  for (const err of model.parseErrors) {
    diagnostics.push({
      code: SindaErrorCode.SYNTAX_ERROR.code,
      id: SindaErrorCode.SYNTAX_ERROR.id,
      rule: SindaErrorCode.SYNTAX_ERROR.rule,
      severity: SindaErrorCode.SYNTAX_ERROR.severity,
      message: SindaErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
      column: err.column,
    });
  }

  // SIN1002: Missing END OF DATA terminator
  if (!model.hasEndOfData) {
    diagnostics.push({
      code: SindaErrorCode.MISSING_END_OF_DATA.code,
      id: SindaErrorCode.MISSING_END_OF_DATA.id,
      rule: SindaErrorCode.MISSING_END_OF_DATA.rule,
      severity: SindaErrorCode.MISSING_END_OF_DATA.severity,
      message: SindaErrorCode.MISSING_END_OF_DATA.message(),
    });
  }

  // SIN5006: Empty thermal network
  if (model.nodes.size === 0) {
    diagnostics.push({
      code: SindaErrorCode.EMPTY_THERMAL_NETWORK.code,
      id: SindaErrorCode.EMPTY_THERMAL_NETWORK.id,
      rule: SindaErrorCode.EMPTY_THERMAL_NETWORK.rule,
      severity: SindaErrorCode.EMPTY_THERMAL_NETWORK.severity,
      message: SindaErrorCode.EMPTY_THERMAL_NETWORK.message(),
    });
  }

  // SIN2001: Duplicate node IDs
  for (const dup of model.duplicateNodes) {
    diagnostics.push({
      code: SindaErrorCode.DUPLICATE_NODE_ID.code,
      id: SindaErrorCode.DUPLICATE_NODE_ID.id,
      rule: SindaErrorCode.DUPLICATE_NODE_ID.rule,
      severity: SindaErrorCode.DUPLICATE_NODE_ID.severity,
      message: SindaErrorCode.DUPLICATE_NODE_ID.message(dup.id),
      line: dup.line,
      nodeId: dup.id,
    });
  }

  // SIN2002: Duplicate conductor IDs
  for (const dup of model.duplicateConductors) {
    diagnostics.push({
      code: SindaErrorCode.DUPLICATE_CONDUCTOR_ID.code,
      id: SindaErrorCode.DUPLICATE_CONDUCTOR_ID.id,
      rule: SindaErrorCode.DUPLICATE_CONDUCTOR_ID.rule,
      severity: SindaErrorCode.DUPLICATE_CONDUCTOR_ID.severity,
      message: SindaErrorCode.DUPLICATE_CONDUCTOR_ID.message(dup.id),
      line: dup.line,
      conductorId: dup.id,
    });
  }

  let hasRadiation = false;
  const adjacency = new Map<number, Set<number>>();
  for (const id of model.nodes.keys()) {
    adjacency.set(id, new Set<number>());
  }

  // Conductor checks: SIN2003, SIN3001, SIN3003
  for (const cond of model.conductors.values()) {
    if (cond.kind === "radiation") {
      hasRadiation = true;
    }

    if (cond.nodeI === cond.nodeJ) {
      diagnostics.push({
        code: SindaErrorCode.SELF_LOOP_CONDUCTOR.code,
        id: SindaErrorCode.SELF_LOOP_CONDUCTOR.id,
        rule: SindaErrorCode.SELF_LOOP_CONDUCTOR.rule,
        severity: SindaErrorCode.SELF_LOOP_CONDUCTOR.severity,
        message: SindaErrorCode.SELF_LOOP_CONDUCTOR.message(cond.id, cond.nodeI),
        line: cond.line,
        column: cond.column,
        conductorId: cond.id,
      });
    }

    const hasI = model.nodes.has(cond.nodeI);
    const hasJ = model.nodes.has(cond.nodeJ);

    if (!hasI) {
      diagnostics.push({
        code: SindaErrorCode.UNDEFINED_CONDUCTOR_NODE.code,
        id: SindaErrorCode.UNDEFINED_CONDUCTOR_NODE.id,
        rule: SindaErrorCode.UNDEFINED_CONDUCTOR_NODE.rule,
        severity: SindaErrorCode.UNDEFINED_CONDUCTOR_NODE.severity,
        message: SindaErrorCode.UNDEFINED_CONDUCTOR_NODE.message(cond.id, cond.nodeI),
        line: cond.line,
        column: cond.column,
        conductorId: cond.id,
        nodeId: cond.nodeI,
      });
    }

    if (!hasJ && cond.nodeJ !== cond.nodeI) {
      diagnostics.push({
        code: SindaErrorCode.UNDEFINED_CONDUCTOR_NODE.code,
        id: SindaErrorCode.UNDEFINED_CONDUCTOR_NODE.id,
        rule: SindaErrorCode.UNDEFINED_CONDUCTOR_NODE.rule,
        severity: SindaErrorCode.UNDEFINED_CONDUCTOR_NODE.severity,
        message: SindaErrorCode.UNDEFINED_CONDUCTOR_NODE.message(cond.id, cond.nodeJ),
        line: cond.line,
        column: cond.column,
        conductorId: cond.id,
        nodeId: cond.nodeJ,
      });
    }

    if (cond.conductance < 0) {
      diagnostics.push({
        code: SindaErrorCode.NEGATIVE_CONDUCTANCE.code,
        id: SindaErrorCode.NEGATIVE_CONDUCTANCE.id,
        rule: SindaErrorCode.NEGATIVE_CONDUCTANCE.rule,
        severity: SindaErrorCode.NEGATIVE_CONDUCTANCE.severity,
        message: SindaErrorCode.NEGATIVE_CONDUCTANCE.message(cond.id, cond.conductance),
        line: cond.line,
        column: cond.column,
        conductorId: cond.id,
      });
    }

    if (hasI && hasJ && cond.nodeI !== cond.nodeJ && cond.conductance > 0) {
      adjacency.get(cond.nodeI)!.add(cond.nodeJ);
      adjacency.get(cond.nodeJ)!.add(cond.nodeI);
    }
  }

  // Node checks: SIN3002, SIN5001
  for (const node of model.nodes.values()) {
    if (node.capacitance < 0) {
      diagnostics.push({
        code: SindaErrorCode.NEGATIVE_CAPACITANCE.code,
        id: SindaErrorCode.NEGATIVE_CAPACITANCE.id,
        rule: SindaErrorCode.NEGATIVE_CAPACITANCE.rule,
        severity: SindaErrorCode.NEGATIVE_CAPACITANCE.severity,
        message: SindaErrorCode.NEGATIVE_CAPACITANCE.message(node.id, node.capacitance),
        line: node.line,
        column: node.column,
        nodeId: node.id,
      });
    }

    if (hasRadiation) {
      const absTempK = node.initialTemp - model.options.abszro;
      if (absTempK <= 0) {
        diagnostics.push({
          code: SindaErrorCode.INVALID_RADIATION_TEMPERATURE.code,
          id: SindaErrorCode.INVALID_RADIATION_TEMPERATURE.id,
          rule: SindaErrorCode.INVALID_RADIATION_TEMPERATURE.rule,
          severity: SindaErrorCode.INVALID_RADIATION_TEMPERATURE.severity,
          message: SindaErrorCode.INVALID_RADIATION_TEMPERATURE.message(node.id, absTempK),
          line: node.line,
          column: node.column,
          nodeId: node.id,
        });
      }
    }
  }

  // Source checks: SIN2004
  for (const src of model.sources) {
    if (!model.nodes.has(src.nodeId)) {
      diagnostics.push({
        code: SindaErrorCode.UNDEFINED_SOURCE_NODE.code,
        id: SindaErrorCode.UNDEFINED_SOURCE_NODE.id,
        rule: SindaErrorCode.UNDEFINED_SOURCE_NODE.rule,
        severity: SindaErrorCode.UNDEFINED_SOURCE_NODE.severity,
        message: SindaErrorCode.UNDEFINED_SOURCE_NODE.message(src.nodeId),
        line: src.line,
        nodeId: src.nodeId,
      });
    }
  }

  // SIN4001: Floating/disconnected thermal subnetwork with no boundary node
  const visited = new Set<number>();
  for (const startId of model.nodes.keys()) {
    if (visited.has(startId)) continue;
    const component: number[] = [];
    const queue: number[] = [startId];
    visited.add(startId);
    let hasBoundary = false;

    while (queue.length > 0) {
      const cur = queue.shift()!;
      component.push(cur);
      const node = model.nodes.get(cur);
      if (node && node.kind === "boundary") {
        hasBoundary = true;
      }
      const neighbors = adjacency.get(cur);
      if (neighbors) {
        for (const nxt of neighbors) {
          if (!visited.has(nxt)) {
            visited.add(nxt);
            queue.push(nxt);
          }
        }
      }
    }

    if (!hasBoundary && component.length > 0) {
      component.sort((a, b) => a - b);
      const firstNode = model.nodes.get(component[0]!);
      diagnostics.push({
        code: SindaErrorCode.FLOATING_SUBNETWORK.code,
        id: SindaErrorCode.FLOATING_SUBNETWORK.id,
        rule: SindaErrorCode.FLOATING_SUBNETWORK.rule,
        severity: SindaErrorCode.FLOATING_SUBNETWORK.severity,
        message: SindaErrorCode.FLOATING_SUBNETWORK.message(component.join(", ")),
        line: firstNode?.line,
        nodeId: component[0],
      });
    }
  }

  // SIN5002: Transient time control checks
  const timeo = model.constants["TIMEO"];
  const timend = model.constants["TIMEND"];
  const dtimei = model.constants["DTIMEI"];
  if (timeo !== undefined && timend !== undefined && timend <= timeo) {
    diagnostics.push({
      code: SindaErrorCode.INVALID_TIME_CONTROL.code,
      id: SindaErrorCode.INVALID_TIME_CONTROL.id,
      rule: SindaErrorCode.INVALID_TIME_CONTROL.rule,
      severity: SindaErrorCode.INVALID_TIME_CONTROL.severity,
      message: SindaErrorCode.INVALID_TIME_CONTROL.message(`TIMEND (${timend}) must be greater than TIMEO (${timeo})`),
    });
  }
  if (dtimei !== undefined && dtimei <= 0) {
    diagnostics.push({
      code: SindaErrorCode.INVALID_TIME_CONTROL.code,
      id: SindaErrorCode.INVALID_TIME_CONTROL.id,
      rule: SindaErrorCode.INVALID_TIME_CONTROL.rule,
      severity: SindaErrorCode.INVALID_TIME_CONTROL.severity,
      message: SindaErrorCode.INVALID_TIME_CONTROL.message(`DTIMEI (${dtimei}) must be positive`),
    });
  }

  return diagnostics;
}

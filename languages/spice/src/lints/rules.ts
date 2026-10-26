// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — Pre-Flight Diagnostic Rules (M7101–M7110).
 *
 * Implements structural and electrical validity checks: floating nodes,
 * voltage loops, current cutsets, unresolved subcircuits, invalid passives,
 * timestep errors, duplicate names, missing models, and pin count mismatches.
 */

import { parseSpiceNumber } from "../parser/spice-parser.js";
import type { SpiceCircuit, SpiceComponent, SpiceDiagnostic } from "../types.js";

export const SPICE_ERROR_CODES = {
  FLOATING_NODE: {
    code: 7101,
    rule: "spice-floating-node",
    severity: "error" as const,
    message: (nodeName: string) => `Floating node '${nodeName}' has no DC reference path to ground.`,
  },
  VOLTAGE_LOOP: {
    code: 7102,
    rule: "spice-voltage-loop",
    severity: "error" as const,
    message: (vName: string) =>
      `Voltage source '${vName}' forms a closed loop of ideal voltage sources without series resistance.`,
  },
  CURRENT_CUTSET: {
    code: 7103,
    rule: "spice-current-cutset",
    severity: "error" as const,
    message: (nodeName: string) =>
      `Node '${nodeName}' is connected strictly to ideal current sources (current cutset).`,
  },
  UNRESOLVED_SUBCIRCUIT: {
    code: 7104,
    rule: "spice-unresolved-subcircuit",
    severity: "error" as const,
    message: (subName: string, compName: string) =>
      `Subcircuit '${subName}' is referenced by '${compName}' but not defined.`,
  },
  INVALID_PASSIVE: {
    code: 7105,
    rule: "spice-invalid-passive-value",
    severity: "error" as const,
    message: (compName: string, val: number) =>
      `Passive component '${compName}' has invalid non-positive value ${val}.`,
  },
  TIMESTEP_VIOLATION: {
    code: 7106,
    rule: "spice-timestep-violation",
    severity: "error" as const,
    message: (tstep: number, tstop: number) =>
      `Transient analysis directive specifies invalid timestep '${tstep}' or stop time '${tstop}'.`,
  },
  DUPLICATE_DEVICE: {
    code: 7107,
    rule: "spice-duplicate-device",
    severity: "error" as const,
    message: (compName: string) => `Duplicate component name '${compName}' detected in circuit scope.`,
  },
  MISSING_MODEL: {
    code: 7108,
    rule: "spice-missing-model",
    severity: "error" as const,
    message: (compName: string, modelName: string) =>
      `Active device '${compName}' references undefined model '${modelName}'.`,
  },
  PIN_COUNT_MISMATCH: {
    code: 7109,
    rule: "spice-pin-count-mismatch",
    severity: "error" as const,
    message: (compName: string, nodeCount: number, subName: string, portCount: number) =>
      `Subcircuit instance '${compName}' connects ${nodeCount} pins but definition '${subName}' expects ${portCount} ports.`,
  },
  MALFORMED_DIRECTIVE: {
    code: 7110,
    rule: "spice-malformed-directive",
    severity: "warning" as const,
    message: (dirName: string) => `Malformed or unsupported directive '${dirName}'.`,
  },
};

export function lintSpiceCircuit(circuit: SpiceCircuit): SpiceDiagnostic[] {
  const diagnostics: SpiceDiagnostic[] = [];

  // Track names for duplicate detection (M7107)
  const seenNames = new Map<string, SpiceComponent>();
  for (const comp of circuit.components) {
    const upperName = comp.name.toUpperCase();
    if (seenNames.has(upperName)) {
      diagnostics.push({
        code: SPICE_ERROR_CODES.DUPLICATE_DEVICE.code,
        rule: SPICE_ERROR_CODES.DUPLICATE_DEVICE.rule,
        severity: SPICE_ERROR_CODES.DUPLICATE_DEVICE.severity,
        message: SPICE_ERROR_CODES.DUPLICATE_DEVICE.message(comp.name),
        span: comp.span,
      });
    } else {
      seenNames.set(upperName, comp);
    }
  }

  // Node connection graph
  const nodeConnections = new Map<string, { comp: SpiceComponent; isCurrentSource: boolean }[]>();
  const addNodeConn = (node: string, comp: SpiceComponent, isCurrentSource: boolean) => {
    const norm = node.toUpperCase();
    const list = nodeConnections.get(norm) ?? [];
    list.push({ comp, isCurrentSource });
    nodeConnections.set(norm, list);
  };

  // Check components
  for (const comp of circuit.components) {
    const isCurrentSource = comp.kind === "I";
    for (const node of comp.nodes) {
      addNodeConn(node, comp, isCurrentSource);
    }

    // M7105: Invalid passive value (R, L, C <= 0)
    if ((comp.kind === "R" || comp.kind === "L" || comp.kind === "C") && comp.value !== undefined) {
      if (comp.value <= 0) {
        diagnostics.push({
          code: SPICE_ERROR_CODES.INVALID_PASSIVE.code,
          rule: SPICE_ERROR_CODES.INVALID_PASSIVE.rule,
          severity: SPICE_ERROR_CODES.INVALID_PASSIVE.severity,
          message: SPICE_ERROR_CODES.INVALID_PASSIVE.message(comp.name, comp.value),
          span: comp.span,
        });
      }
    }

    // M7104 & M7109: Subcircuit resolution and pin count
    if (comp.kind === "X" && comp.subcktName) {
      const subName = comp.subcktName.toUpperCase();
      const sub = circuit.subcircuits.get(subName);
      if (!sub) {
        diagnostics.push({
          code: SPICE_ERROR_CODES.UNRESOLVED_SUBCIRCUIT.code,
          rule: SPICE_ERROR_CODES.UNRESOLVED_SUBCIRCUIT.rule,
          severity: SPICE_ERROR_CODES.UNRESOLVED_SUBCIRCUIT.severity,
          message: SPICE_ERROR_CODES.UNRESOLVED_SUBCIRCUIT.message(comp.subcktName, comp.name),
          span: comp.span,
        });
      } else {
        if (comp.nodes.length !== sub.ports.length) {
          diagnostics.push({
            code: SPICE_ERROR_CODES.PIN_COUNT_MISMATCH.code,
            rule: SPICE_ERROR_CODES.PIN_COUNT_MISMATCH.rule,
            severity: SPICE_ERROR_CODES.PIN_COUNT_MISMATCH.severity,
            message: SPICE_ERROR_CODES.PIN_COUNT_MISMATCH.message(
              comp.name,
              comp.nodes.length,
              sub.name,
              sub.ports.length,
            ),
            span: comp.span,
          });
        }
      }
    }

    // M7108: Missing active model reference (D, Q, M, J)
    if ((comp.kind === "D" || comp.kind === "Q" || comp.kind === "M" || comp.kind === "J") && comp.model) {
      const modelUpper = comp.model.toUpperCase();
      if (!circuit.models.has(modelUpper)) {
        diagnostics.push({
          code: SPICE_ERROR_CODES.MISSING_MODEL.code,
          rule: SPICE_ERROR_CODES.MISSING_MODEL.rule,
          severity: SPICE_ERROR_CODES.MISSING_MODEL.severity,
          message: SPICE_ERROR_CODES.MISSING_MODEL.message(comp.name, comp.model),
          span: comp.span,
        });
      }
    }
  }

  // M7101: Floating nodes & M7103: Current cutsets
  for (const [node, conns] of nodeConnections) {
    if (node === "0" || node === "GND") continue;

    // Single pin connection is definitely floating
    if (conns.length === 1) {
      const firstConn = conns[0];
      if (firstConn) {
        const comp = firstConn.comp;
        diagnostics.push({
          code: SPICE_ERROR_CODES.FLOATING_NODE.code,
          rule: SPICE_ERROR_CODES.FLOATING_NODE.rule,
          severity: SPICE_ERROR_CODES.FLOATING_NODE.severity,
          message: SPICE_ERROR_CODES.FLOATING_NODE.message(node),
          span: comp.span,
          quickFix: comp.span
            ? {
                title: `Connect 1G bleeder resistor from '${node}' to ground (0)`,
                newText: `\nR_bleed_${node} ${node} 0 1G`,
                span: comp.span,
              }
            : undefined,
        });
      }
    }

    // M7103: All connections are ideal current sources
    const allCurrentSources = conns.every((c) => c.isCurrentSource);
    if (allCurrentSources && conns.length > 0) {
      const firstConn = conns[0];
      diagnostics.push({
        code: SPICE_ERROR_CODES.CURRENT_CUTSET.code,
        rule: SPICE_ERROR_CODES.CURRENT_CUTSET.rule,
        severity: SPICE_ERROR_CODES.CURRENT_CUTSET.severity,
        message: SPICE_ERROR_CODES.CURRENT_CUTSET.message(node),
        span: firstConn?.comp.span,
      });
    }
  }

  // M7102: Ideal voltage source parallel loops
  const vPairs = new Map<string, SpiceComponent[]>();
  for (const comp of circuit.components) {
    if (comp.kind === "V" && comp.nodes.length >= 2) {
      const n1 = comp.nodes[0] ?? "";
      const n2 = comp.nodes[1] ?? "";
      const key = [n1.toUpperCase(), n2.toUpperCase()].sort().join("<->");
      const list = vPairs.get(key) ?? [];
      list.push(comp);
      vPairs.set(key, list);
    }
  }
  for (const [, vList] of vPairs) {
    if (vList.length > 1) {
      for (const comp of vList) {
        diagnostics.push({
          code: SPICE_ERROR_CODES.VOLTAGE_LOOP.code,
          rule: SPICE_ERROR_CODES.VOLTAGE_LOOP.rule,
          severity: SPICE_ERROR_CODES.VOLTAGE_LOOP.severity,
          message: SPICE_ERROR_CODES.VOLTAGE_LOOP.message(comp.name),
          span: comp.span,
        });
      }
    }
  }

  // Directives inspection (M7106, M7110)
  for (const dir of circuit.directives) {
    if (dir.kind === ".TRAN") {
      if (dir.args.length >= 2) {
        const tstep = parseSpiceNumber(dir.args[0] ?? "0");
        const tstop = parseSpiceNumber(dir.args[1] ?? "0");
        if (tstep <= 0 || tstop <= tstep) {
          diagnostics.push({
            code: SPICE_ERROR_CODES.TIMESTEP_VIOLATION.code,
            rule: SPICE_ERROR_CODES.TIMESTEP_VIOLATION.rule,
            severity: SPICE_ERROR_CODES.TIMESTEP_VIOLATION.severity,
            message: SPICE_ERROR_CODES.TIMESTEP_VIOLATION.message(tstep, tstop),
            span: dir.span,
          });
        }
      }
    } else if (dir.kind === ".OTHER") {
      diagnostics.push({
        code: SPICE_ERROR_CODES.MALFORMED_DIRECTIVE.code,
        rule: SPICE_ERROR_CODES.MALFORMED_DIRECTIVE.rule,
        severity: SPICE_ERROR_CODES.MALFORMED_DIRECTIVE.severity,
        message: SPICE_ERROR_CODES.MALFORMED_DIRECTIVE.message(dir.args[0] ?? "unknown"),
        span: dir.span,
      });
    }
  }

  return diagnostics;
}

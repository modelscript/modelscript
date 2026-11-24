// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Semantic and SCAP causality linters for `@modelscript/twentysim`.
 */

import { TwentySimErrorCode, type TwentySimDiagnostic } from "../errors.js";
import { parseTwentySim } from "../parser/emx-parser.js";
import type { TwentySimModel, TwentySimPort, TwentySimSubmodel } from "../types.js";
import { runScap } from "./scap.js";

export * from "./scap.js";

function findPort(sub: TwentySimSubmodel, portName: string): TwentySimPort | undefined {
  const exact = sub.ports.find((p) => p.name === portName);
  if (exact) return exact;
  // Junctions accept arbitrary power bond port names (`p`, `p1`, `p2`, ...)
  if (sub.elementKind === "0" || sub.elementKind === "1") {
    return { name: portName, kind: "power", direction: "inout" };
  }
  return undefined;
}

function detectSignalAlgebraicLoops(container: TwentySimSubmodel, diagnostics: TwentySimDiagnostic[]): void {
  const adj = new Map<string, string[]>();
  const isIntegrator = new Set<string>();
  for (const sub of container.submodels) {
    const typeNorm = (sub.typeName ?? sub.name).toLowerCase();
    if (
      sub.elementKind === "C" ||
      sub.elementKind === "I" ||
      typeNorm.includes("integrate") ||
      typeNorm.includes("delay") ||
      sub.equations.some((eq) => JSON.stringify(eq).includes('"int"') || JSON.stringify(eq).includes('"ddt"'))
    ) {
      isIntegrator.add(sub.name);
    }
  }

  for (const conn of container.connections) {
    if (conn.kind !== "signal") continue;
    if (!adj.has(conn.fromSubmodel)) adj.set(conn.fromSubmodel, []);
    adj.get(conn.fromSubmodel)!.push(conn.toSubmodel);
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  const dfs = (u: string): void => {
    if (isIntegrator.has(u)) return;
    visited.add(u);
    stack.add(u);
    path.push(u);

    for (const v of adj.get(u) ?? []) {
      if (isIntegrator.has(v)) continue;
      if (stack.has(v)) {
        const idx = path.indexOf(v);
        const cycle = [...path.slice(idx), v].join(" -> ");
        diagnostics.push({
          code: TwentySimErrorCode.ALGEBRAIC_LOOP.code,
          id: TwentySimErrorCode.ALGEBRAIC_LOOP.id,
          rule: TwentySimErrorCode.ALGEBRAIC_LOOP.rule,
          severity: TwentySimErrorCode.ALGEBRAIC_LOOP.severity,
          message: TwentySimErrorCode.ALGEBRAIC_LOOP.message(cycle),
          symbol: v,
        });
      } else if (!visited.has(v)) {
        dfs(v);
      }
    }

    path.pop();
    stack.delete(u);
  };

  for (const node of adj.keys()) {
    if (!visited.has(node)) dfs(node);
  }
}

function lintSubmodel(container: TwentySimSubmodel, diagnostics: TwentySimDiagnostic[]): void {
  // 1. Duplicate submodels
  const seenSubmodels = new Map<string, TwentySimSubmodel>();
  for (const sub of container.submodels) {
    if (seenSubmodels.has(sub.name)) {
      diagnostics.push({
        code: TwentySimErrorCode.DUPLICATE_SUBMODEL.code,
        id: TwentySimErrorCode.DUPLICATE_SUBMODEL.id,
        rule: TwentySimErrorCode.DUPLICATE_SUBMODEL.rule,
        severity: TwentySimErrorCode.DUPLICATE_SUBMODEL.severity,
        message: TwentySimErrorCode.DUPLICATE_SUBMODEL.message(sub.name),
        line: sub.line,
        startOffset: sub.startOffset,
        endOffset: sub.endOffset,
        symbol: sub.name,
      });
    } else {
      seenSubmodels.set(sub.name, sub);
    }
  }

  // 2. Connection reference & port-kind checks
  const connectedPorts = new Set<string>();
  for (const conn of container.connections) {
    const fromSub = seenSubmodels.get(conn.fromSubmodel);
    const toSub = seenSubmodels.get(conn.toSubmodel);

    if (!fromSub) {
      diagnostics.push({
        code: TwentySimErrorCode.UNRESOLVED_REFERENCE.code,
        id: TwentySimErrorCode.UNRESOLVED_REFERENCE.id,
        rule: TwentySimErrorCode.UNRESOLVED_REFERENCE.rule,
        severity: TwentySimErrorCode.UNRESOLVED_REFERENCE.severity,
        message: TwentySimErrorCode.UNRESOLVED_REFERENCE.message(`${conn.fromSubmodel}.${conn.fromPort}`),
        line: conn.line,
        startOffset: conn.startOffset,
        endOffset: conn.endOffset,
        symbol: conn.fromSubmodel,
      });
      continue;
    }
    if (!toSub) {
      diagnostics.push({
        code: TwentySimErrorCode.UNRESOLVED_REFERENCE.code,
        id: TwentySimErrorCode.UNRESOLVED_REFERENCE.id,
        rule: TwentySimErrorCode.UNRESOLVED_REFERENCE.rule,
        severity: TwentySimErrorCode.UNRESOLVED_REFERENCE.severity,
        message: TwentySimErrorCode.UNRESOLVED_REFERENCE.message(`${conn.toSubmodel}.${conn.toPort}`),
        line: conn.line,
        startOffset: conn.startOffset,
        endOffset: conn.endOffset,
        symbol: conn.toSubmodel,
      });
      continue;
    }

    const fromPort = findPort(fromSub, conn.fromPort);
    const toPort = findPort(toSub, conn.toPort);

    if (!fromPort) {
      diagnostics.push({
        code: TwentySimErrorCode.UNRESOLVED_REFERENCE.code,
        id: TwentySimErrorCode.UNRESOLVED_REFERENCE.id,
        rule: TwentySimErrorCode.UNRESOLVED_REFERENCE.rule,
        severity: TwentySimErrorCode.UNRESOLVED_REFERENCE.severity,
        message: TwentySimErrorCode.UNRESOLVED_REFERENCE.message(`${conn.fromSubmodel}.${conn.fromPort}`),
        line: conn.line,
        symbol: conn.fromPort,
      });
      continue;
    }
    if (!toPort) {
      diagnostics.push({
        code: TwentySimErrorCode.UNRESOLVED_REFERENCE.code,
        id: TwentySimErrorCode.UNRESOLVED_REFERENCE.id,
        rule: TwentySimErrorCode.UNRESOLVED_REFERENCE.rule,
        severity: TwentySimErrorCode.UNRESOLVED_REFERENCE.severity,
        message: TwentySimErrorCode.UNRESOLVED_REFERENCE.message(`${conn.toSubmodel}.${conn.toPort}`),
        line: conn.line,
        symbol: conn.toPort,
      });
      continue;
    }

    if (fromPort.kind !== "unknown" && toPort.kind !== "unknown" && fromPort.kind !== toPort.kind) {
      diagnostics.push({
        code: TwentySimErrorCode.PORT_KIND_MISMATCH.code,
        id: TwentySimErrorCode.PORT_KIND_MISMATCH.id,
        rule: TwentySimErrorCode.PORT_KIND_MISMATCH.rule,
        severity: TwentySimErrorCode.PORT_KIND_MISMATCH.severity,
        message: TwentySimErrorCode.PORT_KIND_MISMATCH.message(
          `${conn.fromSubmodel}.${conn.fromPort}`,
          `${conn.toSubmodel}.${conn.toPort}`,
        ),
        line: conn.line,
        startOffset: conn.startOffset,
        endOffset: conn.endOffset,
      });
    }

    connectedPorts.add(`${fromSub.name}.${fromPort.name}`);
    connectedPorts.add(`${toSub.name}.${toPort.name}`);
  }

  // 3. Unconnected power ports on child submodels
  if (container.submodels.length > 0) {
    for (const sub of container.submodels) {
      if (sub.elementKind === "0" || sub.elementKind === "1") continue;
      for (const port of sub.ports) {
        if (port.kind !== "power") continue;
        if (!connectedPorts.has(`${sub.name}.${port.name}`)) {
          diagnostics.push({
            code: TwentySimErrorCode.UNCONNECTED_PORT.code,
            id: TwentySimErrorCode.UNCONNECTED_PORT.id,
            rule: TwentySimErrorCode.UNCONNECTED_PORT.rule,
            severity: TwentySimErrorCode.UNCONNECTED_PORT.severity,
            message: TwentySimErrorCode.UNCONNECTED_PORT.message(sub.name, port.name),
            line: port.line ?? sub.line,
            symbol: `${sub.name}.${port.name}`,
          });
        }
      }
    }
  }

  // 4. SCAP causality analysis
  if (container.connections.some((c) => c.kind === "bond")) {
    const scap = runScap(container);
    for (const conflict of scap.conflicts) {
      diagnostics.push({
        code: TwentySimErrorCode.CAUSALITY_CONFLICT.code,
        id: TwentySimErrorCode.CAUSALITY_CONFLICT.id,
        rule: TwentySimErrorCode.CAUSALITY_CONFLICT.rule,
        severity: TwentySimErrorCode.CAUSALITY_CONFLICT.severity,
        message: TwentySimErrorCode.CAUSALITY_CONFLICT.message(conflict.node, conflict.detail),
        line: conflict.line,
        symbol: conflict.node,
      });
    }
    for (const deriv of scap.derivativeCausality) {
      diagnostics.push({
        code: TwentySimErrorCode.DERIVATIVE_CAUSALITY.code,
        id: TwentySimErrorCode.DERIVATIVE_CAUSALITY.id,
        rule: TwentySimErrorCode.DERIVATIVE_CAUSALITY.rule,
        severity: TwentySimErrorCode.DERIVATIVE_CAUSALITY.severity,
        message: TwentySimErrorCode.DERIVATIVE_CAUSALITY.message(deriv.element, deriv.kind),
        line: deriv.line,
        symbol: deriv.element,
      });
    }
  }

  // 5. Algebraic loops in causal signal graphs
  detectSignalAlgebraicLoops(container, diagnostics);

  // Recurse into nested submodels
  for (const child of container.submodels) {
    if (child.submodels.length > 0 || child.connections.length > 0) {
      lintSubmodel(child, diagnostics);
    }
  }
}

/**
 * Lint a 20-sim model (parsed or raw `.emx`/`.emxz`/`.sid` source).
 */
export function lintTwentySim(modelOrSource: TwentySimModel | string): TwentySimDiagnostic[] {
  const model = typeof modelOrSource === "string" ? parseTwentySim(modelOrSource) : modelOrSource;
  const diagnostics: TwentySimDiagnostic[] = [];

  for (const issue of model.parseIssues) {
    diagnostics.push({
      code: TwentySimErrorCode.SYNTAX_ERROR.code,
      id: TwentySimErrorCode.SYNTAX_ERROR.id,
      rule: TwentySimErrorCode.SYNTAX_ERROR.rule,
      severity: TwentySimErrorCode.SYNTAX_ERROR.severity,
      message: TwentySimErrorCode.SYNTAX_ERROR.message(issue.message),
      line: issue.line,
      column: issue.column,
      startOffset: issue.startOffset,
      endOffset: issue.endOffset,
    });
  }

  lintSubmodel(model.root, diagnostics);
  return diagnostics;
}

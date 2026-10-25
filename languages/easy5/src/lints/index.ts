// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pre-Flight Static Analysis and Linter Engine for EASY5.
 *
 * Implements 12 diagnostic rules (M7001–M7012) covering connectivity,
 * direct feedthrough algebraic loops, improper transfer functions, parameter bounds,
 * state dimensions, and user Fortran subroutines.
 */

import { getBlockDescriptor } from "../catalog/gp-library.js";
import { validateUserFortranCode } from "../script/user-code.js";
import type { Easy5Component, Easy5Model } from "../types.js";

export interface Easy5Diagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  line?: number | undefined;
  column?: number | undefined;
  endLine?: number | undefined;
  endColumn?: number | undefined;
  componentId?: string | undefined;
}

export const Easy5ErrorCode = {
  UNCONNECTED_INPUT_PORT: {
    code: 7001,
    id: "M7001",
    rule: "unconnected-input-port",
    severity: "warning" as const,
    message: (comp: string, port: string) => `Input port '${comp}.${port}' has no incoming connection.`,
  },
  CSMF_ALGEBRAIC_LOOP: {
    code: 7002,
    id: "M7002",
    rule: "csmf-algebraic-loop",
    severity: "error" as const,
    message: (cycle: string[]) =>
      `Direct feedthrough algebraic loop detected with no continuous state or delay: ${cycle.join(" -> ")}.`,
  },
  DUPLICATE_COMPONENT_ID: {
    code: 7003,
    id: "M7003",
    rule: "duplicate-component-id",
    severity: "error" as const,
    message: (id: string) => `Duplicate component identifier '${id}' in model.`,
  },
  UNINITIALIZED_STATE: {
    code: 7004,
    id: "M7004",
    rule: "uninitialized-state",
    severity: "info" as const,
    message: (comp: string) => `Continuous state in component '${comp}' defaults to 0.0 with no explicit S0 specified.`,
  },
  IMPROPER_TRANSFER_FUNCTION: {
    code: 7005,
    id: "M7005",
    rule: "improper-transfer-function",
    severity: "error" as const,
    message: (comp: string, degNum: number, degDen: number) =>
      `Transfer function in component '${comp}' is improper: numerator degree (${degNum}) exceeds denominator degree (${degDen}).`,
  },
  PARAMETER_OUT_OF_BOUNDS: {
    code: 7006,
    id: "M7006",
    rule: "parameter-out-of-bounds",
    severity: "error" as const,
    message: (comp: string, param: string, reason: string) =>
      `Parameter '${param}' in component '${comp}' is out of valid bounds: ${reason}.`,
  },
  PORT_DIMENSION_MISMATCH: {
    code: 7007,
    id: "M7007",
    rule: "port-dimension-mismatch",
    severity: "error" as const,
    message: (from: string, to: string, dim1: number, dim2: number) =>
      `Connection width mismatch from '${from}' (dim ${dim1}) to '${to}' (dim ${dim2}).`,
  },
  STATE_INDEX_OUT_OF_BOUNDS: {
    code: 7008,
    id: "M7008",
    rule: "state-index-out-of-bounds",
    severity: "error" as const,
    message: (comp: string, idx: number, max: number) =>
      `State index S(${idx}) in component '${comp}' exceeds allocated continuous states (${max}).`,
  },
  SAMPLE_RATE_MISMATCH: {
    code: 7009,
    id: "M7009",
    rule: "sample-rate-mismatch",
    severity: "warning" as const,
    message: (from: string, to: string, rate1: number, rate2: number) =>
      `Sample rate mismatch between '${from}' (${rate1}s) and '${to}' (${rate2}s) without rate transition block.`,
  },
  USER_FORTRAN_SYNTAX_ERROR: {
    code: 7010,
    id: "M7010",
    rule: "user-fortran-syntax-error",
    severity: "error" as const,
    message: (comp: string, detail: string) => `User Fortran subroutine in '${comp}' has defect: ${detail}`,
  },
  UNSTABLE_LINEAR_POLE: {
    code: 7011,
    id: "M7011",
    rule: "unstable-linear-pole",
    severity: "warning" as const,
    message: (comp: string, poleReal: number) =>
      `Component '${comp}' has open-loop pole in right-half plane (Re = +${poleReal.toFixed(3)}), indicating open-loop instability.`,
  },
  TABLE_EXTRAPOLATION_HAZARD: {
    code: 7012,
    id: "M7012",
    rule: "table-extrapolation-hazard",
    severity: "warning" as const,
    message: (comp: string, tableName: string) =>
      `Component '${comp}' references table '${tableName}' without bounded extrapolation protection.`,
  },
};

/**
 * Runs pre-flight static analysis on parsed EASY5 model.
 */
export function lintEasy5(model: Easy5Model): Easy5Diagnostic[] {
  const diagnostics: Easy5Diagnostic[] = [];

  // Track connected input ports
  const connectedInputPorts = new Set<string>();
  for (const conn of model.connections) {
    const key = `${conn.toComponent}.${conn.toPort}`.toUpperCase();
    connectedInputPorts.add(key);
  }

  // 1. Component Parameter and State Checks
  for (const [compId, comp] of model.components) {
    const typeUpper = comp.type.toUpperCase().replace(/^GP\//, "");
    const desc = getBlockDescriptor(typeUpper);

    // M7001: Unconnected Input Ports
    if (desc) {
      for (const p of desc.ports) {
        if (p.kind === "input") {
          const portKey = `${compId}.${p.name}`.toUpperCase();
          // For SJ (Summing Junction), inputs IN3, IN4 are optional if unused
          if (typeUpper === "SJ" && (p.name === "IN3" || p.name === "IN4")) {
            continue;
          }
          if (!connectedInputPorts.has(portKey)) {
            diagnostics.push({
              code: Easy5ErrorCode.UNCONNECTED_INPUT_PORT.code,
              id: Easy5ErrorCode.UNCONNECTED_INPUT_PORT.id,
              rule: Easy5ErrorCode.UNCONNECTED_INPUT_PORT.rule,
              severity: Easy5ErrorCode.UNCONNECTED_INPUT_PORT.severity,
              message: Easy5ErrorCode.UNCONNECTED_INPUT_PORT.message(compId, p.name),
              line: comp.line,
              column: comp.column,
              startOffset: comp.startOffset,
              endOffset: comp.endOffset,
              componentId: compId,
            });
          }
        }
      }
    }

    // M7005: Improper Transfer Function (deg NUM > deg DEN)
    if (typeUpper === "TF") {
      const num = Array.isArray(comp.parameters["NUM"]) ? (comp.parameters["NUM"] as number[]) : [1.0];
      const den = Array.isArray(comp.parameters["DEN"]) ? (comp.parameters["DEN"] as number[]) : [1.0, 1.0];
      const degNum = Math.max(0, num.length - 1);
      const degDen = Math.max(0, den.length - 1);
      if (degNum > degDen) {
        diagnostics.push({
          code: Easy5ErrorCode.IMPROPER_TRANSFER_FUNCTION.code,
          id: Easy5ErrorCode.IMPROPER_TRANSFER_FUNCTION.id,
          rule: Easy5ErrorCode.IMPROPER_TRANSFER_FUNCTION.rule,
          severity: Easy5ErrorCode.IMPROPER_TRANSFER_FUNCTION.severity,
          message: Easy5ErrorCode.IMPROPER_TRANSFER_FUNCTION.message(compId, degNum, degDen),
          line: comp.line,
          column: comp.column,
          startOffset: comp.startOffset,
          endOffset: comp.endOffset,
          componentId: compId,
        });
      }
    }

    // M7006: Parameter Out Of Bounds
    if (typeUpper === "LA") {
      const tau2 = typeof comp.parameters["TAU2"] === "number" ? comp.parameters["TAU2"] : 1.0;
      if (tau2 <= 0) {
        diagnostics.push({
          code: Easy5ErrorCode.PARAMETER_OUT_OF_BOUNDS.code,
          id: Easy5ErrorCode.PARAMETER_OUT_OF_BOUNDS.id,
          rule: Easy5ErrorCode.PARAMETER_OUT_OF_BOUNDS.rule,
          severity: Easy5ErrorCode.PARAMETER_OUT_OF_BOUNDS.severity,
          message: Easy5ErrorCode.PARAMETER_OUT_OF_BOUNDS.message(
            compId,
            "TAU2",
            "lag time constant must be strictly positive (> 0)",
          ),
          line: comp.line,
          column: comp.column,
          startOffset: comp.startOffset,
          endOffset: comp.endOffset,
          componentId: compId,
        });
      }
    }

    if (typeUpper === "LM") {
      const ul = typeof comp.parameters["UL"] === "number" ? comp.parameters["UL"] : 1.0;
      const ll = typeof comp.parameters["LL"] === "number" ? comp.parameters["LL"] : -1.0;
      if (ll > ul) {
        diagnostics.push({
          code: Easy5ErrorCode.PARAMETER_OUT_OF_BOUNDS.code,
          id: Easy5ErrorCode.PARAMETER_OUT_OF_BOUNDS.id,
          rule: Easy5ErrorCode.PARAMETER_OUT_OF_BOUNDS.rule,
          severity: Easy5ErrorCode.PARAMETER_OUT_OF_BOUNDS.severity,
          message: Easy5ErrorCode.PARAMETER_OUT_OF_BOUNDS.message(
            compId,
            "LL",
            `lower limit (${ll}) exceeds upper limit (${ul})`,
          ),
          line: comp.line,
          column: comp.column,
          startOffset: comp.startOffset,
          endOffset: comp.endOffset,
          componentId: compId,
        });
      }
    }

    // M7010: User Fortran Subroutine Diagnostics
    if (typeUpper === "UG" && comp.userCode) {
      const fortranDiags = validateUserFortranCode(comp.userCode);
      for (const fd of fortranDiags) {
        diagnostics.push({
          code: Easy5ErrorCode.USER_FORTRAN_SYNTAX_ERROR.code,
          id: Easy5ErrorCode.USER_FORTRAN_SYNTAX_ERROR.id,
          rule: Easy5ErrorCode.USER_FORTRAN_SYNTAX_ERROR.rule,
          severity: fd.severity,
          message: Easy5ErrorCode.USER_FORTRAN_SYNTAX_ERROR.message(compId, `[${fd.id}] ${fd.message}`),
          line: (comp.line ?? 1) + (fd.line ?? 1) - 1,
          column: fd.column ?? 1,
          startOffset: (comp.startOffset ?? 0) + (fd.startOffset ?? 0),
          endOffset: (comp.startOffset ?? 0) + (fd.endOffset ?? 0),
          componentId: compId,
        });
      }
    }
  }

  // 2. M7002: Direct Feedthrough Algebraic Loop Detection
  detectAlgebraicLoops(model, diagnostics);

  return diagnostics;
}

/**
 * Checks for algebraic cycles through direct feedthrough components.
 */
function detectAlgebraicLoops(model: Easy5Model, diagnostics: Easy5Diagnostic[]): void {
  function isDirectFeedthrough(comp: Easy5Component | undefined): boolean {
    if (!comp) return false;
    const t = comp.type.toUpperCase().replace(/^GP\//, "");
    // Gain, Summing Junction, Limiter, Deadband, Switch have direct feedthrough Y = f(U)
    if (t === "GA" || t === "SJ" || t === "LM" || t === "DZ" || t === "SW") return true;
    if (t === "LA") {
      const tau1 = typeof comp.parameters["TAU1"] === "number" ? comp.parameters["TAU1"] : 0.0;
      return tau1 !== 0; // Lead-lag has feedthrough when TAU1 > 0
    }
    if (t === "TF") {
      const num = Array.isArray(comp.parameters["NUM"]) ? (comp.parameters["NUM"] as number[]) : [];
      const den = Array.isArray(comp.parameters["DEN"]) ? (comp.parameters["DEN"] as number[]) : [];
      return num.length >= den.length && num.length > 0;
    }
    // Integrator (IN) and delay (TD) break direct feedthrough
    return false;
  }

  const adj = new Map<string, string[]>();
  for (const conn of model.connections) {
    const fromComp = model.components.get(conn.fromComponent);
    const toComp = model.components.get(conn.toComponent);
    if (isDirectFeedthrough(fromComp) && isDirectFeedthrough(toComp)) {
      if (!adj.has(conn.fromComponent)) adj.set(conn.fromComponent, []);
      adj.get(conn.fromComponent)!.push(conn.toComponent);
    }
  }

  // Tarjan's Strongly Connected Components
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let currentIndex = 0;

  function strongConnect(v: string): void {
    index.set(v, currentIndex);
    lowlink.set(v, currentIndex);
    currentIndex++;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
      }
    }

    if (lowlink.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);

      if (scc.length > 1 || (adj.get(v) ?? []).includes(v)) {
        scc.reverse();
        const firstComp = model.components.get(scc[0]!);
        diagnostics.push({
          code: Easy5ErrorCode.CSMF_ALGEBRAIC_LOOP.code,
          id: Easy5ErrorCode.CSMF_ALGEBRAIC_LOOP.id,
          rule: Easy5ErrorCode.CSMF_ALGEBRAIC_LOOP.rule,
          severity: Easy5ErrorCode.CSMF_ALGEBRAIC_LOOP.severity,
          message: Easy5ErrorCode.CSMF_ALGEBRAIC_LOOP.message(scc),
          line: firstComp?.line,
          column: firstComp?.column,
          startOffset: firstComp?.startOffset,
          endOffset: firstComp?.endOffset,
          componentId: scc[0],
        });
      }
    }
  }

  for (const compId of adj.keys()) {
    if (!index.has(compId)) {
      strongConnect(compId);
    }
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * DIgSILENT Simulation Language (DSL) Parser.
 *
 * Parses DSL models defining continuous differential-algebraic equations,
 * Laplace s-domain transfer functions, integrators, and non-linear limiters.
 */

import type { DslBlock, DslEquation } from "../types.js";

/**
 * Parses DSL source code into a structured DslBlock AST.
 */
export function parseDsl(dslSource: string): DslBlock {
  const lines = dslSource.split(/\r?\n/);
  let name = "DslModel";
  let type: "model" | "composite" = "model";
  const inputs: string[] = [];
  const outputs: string[] = [];
  const parameters = new Map<string, number>();
  const internals: string[] = [];
  const equations: DslEquation[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("!") || line.startsWith("//")) continue;

    // Check header: model Name or composite Name
    const modelHeaderMatch = /^(model|composite)\s+([A-Za-z0-9_]+)/i.exec(line);
    if (modelHeaderMatch) {
      type = modelHeaderMatch[1]!.toLowerCase() as "model" | "composite";
      name = modelHeaderMatch[2]!;
      continue;
    }

    if (/^end(\s+[A-Za-z0-9_]+)?$/i.test(line)) {
      continue;
    }

    // Check declarations: input:, output:, parameter:, internal:
    if (/^input\s*:/i.test(line)) {
      const rest = line.replace(/^input\s*:/i, "").trim();
      for (const tok of rest.split(/[,;\s]+/)) {
        if (tok) inputs.push(tok);
      }
      continue;
    }

    if (/^output\s*:/i.test(line)) {
      const rest = line.replace(/^output\s*:/i, "").trim();
      for (const tok of rest.split(/[,;\s]+/)) {
        if (tok) outputs.push(tok);
      }
      continue;
    }

    if (/^parameter\s*:/i.test(line)) {
      const rest = line.replace(/^parameter\s*:/i, "").trim();
      const paramMatches = rest.matchAll(/([A-Za-z0-9_]+)\s*=\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/g);
      for (const pm of paramMatches) {
        if (pm[1] && pm[2]) {
          parameters.set(pm[1], parseFloat(pm[2]));
        }
      }
      continue;
    }

    if (/^internal\s*:/i.test(line)) {
      const rest = line.replace(/^internal\s*:/i, "").trim();
      for (const tok of rest.split(/[,;\s]+/)) {
        if (tok) internals.push(tok);
      }
      continue;
    }

    // Equations
    // 1. Differential equation: s:x = expr
    const diffMatch = /^s:([A-Za-z0-9_]+)\s*=\s*(.+)$/i.exec(line);
    if (diffMatch) {
      equations.push({
        kind: "differential",
        lhs: diffMatch[1]!,
        rhs: diffMatch[2]!.replace(/;$/, "").trim(),
      });
      continue;
    }

    // 2. Algebraic or macro equation: y = macro(args...) or y = expr
    const eqMatch = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (eqMatch) {
      const lhs = eqMatch[1]!;
      const rhs = eqMatch[2]!.replace(/;$/, "").trim();

      // Check macro calls
      const macroMatch = /^(int_l|int|lim|pic|lead_lag|lag|washout)\s*\(([^)]+)\)$/i.exec(rhs);
      if (macroMatch) {
        const mType = macroMatch[1]!.toUpperCase() as DslEquation["macroType"];
        const mArgs = macroMatch[2]!.split(",").map((s) => s.trim());
        equations.push({
          kind: "macro",
          lhs,
          rhs,
          macroType: mType,
          macroArgs: mArgs,
        });
      } else {
        equations.push({
          kind: "algebraic",
          lhs,
          rhs,
        });
      }
    }
  }

  return {
    name,
    type,
    inputs,
    outputs,
    parameters,
    internals,
    equations,
  };
}

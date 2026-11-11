// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mlxtran — Pre-flight Pharmacometrics Diagnostic Linter.
 *
 * Checks M9421 - M9430 diagnostic rules against parsed MLXTRAN documents.
 */

import { type DiagnosticItem, MlxtranErrorCode } from "../errors.js";
import type { MlxtranDocument } from "../types.js";

const BUILTIN_MATH_IDENTIFIERS = new Set([
  "t",
  "time",
  "pi",
  "e",
  "exp",
  "log",
  "ln",
  "log10",
  "sqrt",
  "sin",
  "cos",
  "tan",
  "abs",
  "min",
  "max",
  "pow",
]);

export function extractEquationIdentifiers(rhs: string): string[] {
  const matches = rhs.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g);
  if (!matches) return [];
  return matches.filter((id) => !BUILTIN_MATH_IDENTIFIERS.has(id.toLowerCase()));
}

export function lintMlxtran(doc: MlxtranDocument): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];
  const model = doc.model;

  // 1. M9421: Missing [LONGITUDINAL] section header
  if (!/\[LONGITUDINAL\]/i.test(doc.raw)) {
    diagnostics.push({
      code: MlxtranErrorCode.MISSING_LONGITUDINAL_BLOCK.code,
      rule: MlxtranErrorCode.MISSING_LONGITUDINAL_BLOCK.rule,
      severity: MlxtranErrorCode.MISSING_LONGITUDINAL_BLOCK.severity,
      message: MlxtranErrorCode.MISSING_LONGITUDINAL_BLOCK.message(),
      range: model.range,
    });
  }

  // Set of declared inputs
  const declaredInputs = new Set<string>();
  for (const inp of model.inputs) {
    declaredInputs.add(inp.name);

    // M9425: Negative parameter bound or initial value
    if (inp.min !== undefined && inp.min < 0) {
      diagnostics.push({
        code: MlxtranErrorCode.NEGATIVE_PARAMETER_BOUND.code,
        rule: MlxtranErrorCode.NEGATIVE_PARAMETER_BOUND.rule,
        severity: MlxtranErrorCode.NEGATIVE_PARAMETER_BOUND.severity,
        message: MlxtranErrorCode.NEGATIVE_PARAMETER_BOUND.message(inp.name, inp.min),
        range: inp.range,
      });
    }
    if (inp.init !== undefined && inp.init <= 0) {
      diagnostics.push({
        code: MlxtranErrorCode.NEGATIVE_PARAMETER_BOUND.code,
        rule: MlxtranErrorCode.NEGATIVE_PARAMETER_BOUND.rule,
        severity: MlxtranErrorCode.NEGATIVE_PARAMETER_BOUND.severity,
        message: MlxtranErrorCode.NEGATIVE_PARAMETER_BOUND.message(inp.name, inp.init),
        range: inp.range,
      });
    }
  }

  // Set of all LHS identifiers and state variables
  const definedLhs = new Set<string>();
  const definedStates = new Set<string>();

  for (const eq of model.equations) {
    // M9426: Duplicate equation definition
    if (definedLhs.has(eq.lhs)) {
      diagnostics.push({
        code: MlxtranErrorCode.DUPLICATE_EQUATION_DEFINITION.code,
        rule: MlxtranErrorCode.DUPLICATE_EQUATION_DEFINITION.rule,
        severity: MlxtranErrorCode.DUPLICATE_EQUATION_DEFINITION.severity,
        message: MlxtranErrorCode.DUPLICATE_EQUATION_DEFINITION.message(eq.lhs),
        range: eq.range,
      });
    }
    definedLhs.add(eq.lhs);
    if (eq.isDerivative && eq.stateName) {
      definedStates.add(eq.stateName);
    }
  }

  // Also collect compartment names defined in macros
  for (const mac of model.macros) {
    if (mac.params["amount"]) definedStates.add(mac.params["amount"]);
    if (mac.params["target"]) definedStates.add(mac.params["target"]);

    // M9430: Unbalanced or self-referential transfer
    if (mac.kind === "transfer") {
      const from = mac.params["from"] ?? "";
      const to = mac.params["to"] ?? "";
      if (from === to && from !== "") {
        diagnostics.push({
          code: MlxtranErrorCode.UNBALANCED_COMPARTMENT_TRANSFER.code,
          rule: MlxtranErrorCode.UNBALANCED_COMPARTMENT_TRANSFER.rule,
          severity: MlxtranErrorCode.UNBALANCED_COMPARTMENT_TRANSFER.severity,
          message: MlxtranErrorCode.UNBALANCED_COMPARTMENT_TRANSFER.message(from, to),
          range: mac.range,
        });
      }
    }
  }

  // Check equation RHS for undeclared inputs (M9422)
  for (const eq of model.equations) {
    const ids = extractEquationIdentifiers(eq.rhs);
    for (const id of ids) {
      if (!declaredInputs.has(id) && !definedLhs.has(id) && !definedStates.has(id)) {
        diagnostics.push({
          code: MlxtranErrorCode.UNDECLARED_INPUT_PARAMETER.code,
          rule: MlxtranErrorCode.UNDECLARED_INPUT_PARAMETER.rule,
          severity: MlxtranErrorCode.UNDECLARED_INPUT_PARAMETER.severity,
          message: MlxtranErrorCode.UNDECLARED_INPUT_PARAMETER.message(id),
          range: eq.range,
        });
      }
    }
  }

  // M9427: Missing output definition
  if (model.equations.length > 0 && model.outputs.length === 0) {
    diagnostics.push({
      code: MlxtranErrorCode.MISSING_OUTPUT_DEFINITION.code,
      rule: MlxtranErrorCode.MISSING_OUTPUT_DEFINITION.rule,
      severity: MlxtranErrorCode.MISSING_OUTPUT_DEFINITION.severity,
      message: MlxtranErrorCode.MISSING_OUTPUT_DEFINITION.message(),
      range: model.range,
    });
  }

  // M9423: Orphan derivative check
  for (const st of definedStates) {
    let referenced = false;
    for (const out of model.outputs) {
      if (out.includes(st)) referenced = true;
    }
    for (const eq of model.equations) {
      // If referenced in any equation RHS (other than its own derivative equation)
      if (eq.rhs.includes(st) && (!eq.isDerivative || eq.stateName !== st)) {
        referenced = true;
      }
    }
    for (const mac of model.macros) {
      if (mac.params["amount"] === st || mac.params["target"] === st) referenced = true;
    }
    if (!referenced && model.outputs.length > 0) {
      diagnostics.push({
        code: MlxtranErrorCode.ORPHAN_DERIVATIVE.code,
        rule: MlxtranErrorCode.ORPHAN_DERIVATIVE.rule,
        severity: MlxtranErrorCode.ORPHAN_DERIVATIVE.severity,
        message: MlxtranErrorCode.ORPHAN_DERIVATIVE.message(st),
      });
    }
  }

  return diagnostics;
}

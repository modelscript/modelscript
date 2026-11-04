// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gproms — Pre-flight Process Modeling Diagnostics Linter.
 *
 * Implements OpenModelica-style diagnostic codes (M9451 - M9460) for gPROMS models and processes.
 */

import { type DiagnosticItem, GpromsErrorCode } from "../errors.js";
import type { GpromsDocument, GpromsModel, GpromsProcess } from "../types.js";

function resolveModelsForProcess(doc: GpromsDocument, proc: GpromsProcess): GpromsModel[] {
  const result: GpromsModel[] = [];
  const seen = new Set<string>();
  for (const modelName of proc.units.values()) {
    const m = doc.models.get(modelName);
    if (m && !seen.has(m.name)) {
      seen.add(m.name);
      result.push(m);
    }
  }
  if (result.length === 0 && doc.models.size > 0) {
    const first = doc.models.values().next().value;
    if (first) result.push(first);
  }
  return result;
}

function resolveModelForEntry(
  doc: GpromsDocument,
  proc: GpromsProcess,
  unitName: string | undefined,
): GpromsModel | undefined {
  if (unitName) {
    const modelName = proc.units.get(unitName);
    if (modelName) return doc.models.get(modelName);
  }
  return doc.models.values().next().value;
}

export function lintGproms(doc: GpromsDocument): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];

  // M9460: Duplicate entity declarations recorded during parsing
  for (const dup of doc.duplicateDeclarations) {
    diagnostics.push({
      code: GpromsErrorCode.DUPLICATE_ENTITY_DECLARATION.code,
      rule: GpromsErrorCode.DUPLICATE_ENTITY_DECLARATION.rule,
      severity: GpromsErrorCode.DUPLICATE_ENTITY_DECLARATION.severity,
      message: GpromsErrorCode.DUPLICATE_ENTITY_DECLARATION.message(dup.kind, dup.name, dup.scope),
      range: dup.range,
    });
  }

  // M9459: Empty gPROMS model check (no models in document)
  if (doc.models.size === 0) {
    diagnostics.push({
      code: GpromsErrorCode.EMPTY_GPROMS_MODEL.code,
      rule: GpromsErrorCode.EMPTY_GPROMS_MODEL.rule,
      severity: GpromsErrorCode.EMPTY_GPROMS_MODEL.severity,
      message: GpromsErrorCode.EMPTY_GPROMS_MODEL.message("Document"),
    });
  }

  // M9452: Invalid variable type bounds or default value
  for (const vt of doc.variableTypes.values()) {
    if (vt.lowerBound >= vt.upperBound || vt.defaultValue < vt.lowerBound || vt.defaultValue > vt.upperBound) {
      diagnostics.push({
        code: GpromsErrorCode.INVALID_VARIABLE_BOUNDS.code,
        rule: GpromsErrorCode.INVALID_VARIABLE_BOUNDS.rule,
        severity: GpromsErrorCode.INVALID_VARIABLE_BOUNDS.severity,
        message: GpromsErrorCode.INVALID_VARIABLE_BOUNDS.message(
          vt.name,
          vt.defaultValue,
          vt.lowerBound,
          vt.upperBound,
        ),
        range: vt.range,
      });
    }
  }

  // Model-level checks
  for (const model of doc.models.values()) {
    // M9459: Empty model (no variables and no equations)
    if (model.variables.size === 0 && model.equations.length === 0) {
      diagnostics.push({
        code: GpromsErrorCode.EMPTY_GPROMS_MODEL.code,
        rule: GpromsErrorCode.EMPTY_GPROMS_MODEL.rule,
        severity: GpromsErrorCode.EMPTY_GPROMS_MODEL.severity,
        message: GpromsErrorCode.EMPTY_GPROMS_MODEL.message(model.name),
        range: model.range,
      });
      continue;
    }

    // M9451: Variable references undeclared DECLARE TYPE
    for (const v of model.variables.values()) {
      if (!doc.variableTypes.has(v.typeName)) {
        diagnostics.push({
          code: GpromsErrorCode.UNDECLARED_VARIABLE_TYPE.code,
          rule: GpromsErrorCode.UNDECLARED_VARIABLE_TYPE.rule,
          severity: GpromsErrorCode.UNDECLARED_VARIABLE_TYPE.severity,
          message: GpromsErrorCode.UNDECLARED_VARIABLE_TYPE.message(model.name, v.name, v.typeName),
          range: v.range ?? model.range,
        });
      }
    }

    // M9453: Invalid distribution domain bounds or grid points
    for (const dom of model.domains.values()) {
      if (dom.lowerBound >= dom.upperBound || dom.gridPoints < 2) {
        diagnostics.push({
          code: GpromsErrorCode.INVALID_DISTRIBUTION_DOMAIN.code,
          rule: GpromsErrorCode.INVALID_DISTRIBUTION_DOMAIN.rule,
          severity: GpromsErrorCode.INVALID_DISTRIBUTION_DOMAIN.severity,
          message: GpromsErrorCode.INVALID_DISTRIBUTION_DOMAIN.message(
            model.name,
            dom.name,
            dom.lowerBound,
            dom.upperBound,
            dom.gridPoints,
          ),
          range: dom.range ?? model.range,
        });
      }
    }

    // M9454 & M9457: Equation identifier resolution and PARTIAL domain checks
    const allEquations = [...model.boundaryEquations, ...model.equations];
    const reportedUndef = new Set<string>();

    for (const eq of allEquations) {
      for (const ident of eq.identifiers) {
        const isDeclared = model.variables.has(ident) || model.parameters.has(ident) || model.domains.has(ident);
        if (!isDeclared && !reportedUndef.has(ident)) {
          reportedUndef.add(ident);
          diagnostics.push({
            code: GpromsErrorCode.UNDECLARED_EQUATION_IDENTIFIER.code,
            rule: GpromsErrorCode.UNDECLARED_EQUATION_IDENTIFIER.rule,
            severity: GpromsErrorCode.UNDECLARED_EQUATION_IDENTIFIER.severity,
            message: GpromsErrorCode.UNDECLARED_EQUATION_IDENTIFIER.message(model.name, ident),
            range: eq.range ?? model.range,
          });
        }
      }

      for (const p of eq.partials) {
        const v = model.variables.get(p.variable);
        if (!v || !v.domains.includes(p.domain)) {
          diagnostics.push({
            code: GpromsErrorCode.PARTIAL_ON_NON_DISTRIBUTED_VARIABLE.code,
            rule: GpromsErrorCode.PARTIAL_ON_NON_DISTRIBUTED_VARIABLE.rule,
            severity: GpromsErrorCode.PARTIAL_ON_NON_DISTRIBUTED_VARIABLE.severity,
            message: GpromsErrorCode.PARTIAL_ON_NON_DISTRIBUTED_VARIABLE.message(model.name, p.variable, p.domain),
            range: eq.range ?? model.range,
          });
        }
      }
    }

    // Collect differential state variables ($x) in model
    const diffStateVars = new Set<string>();
    for (const eq of allEquations) {
      for (const dv of eq.differentialVariables) {
        if (model.variables.has(dv)) {
          diffStateVars.add(dv);
        }
      }
    }

    // Find processes that instantiate this model
    const matchingProcesses = Array.from(doc.processes.values()).filter((p) =>
      resolveModelsForProcess(doc, p).some((m) => m.name === model.name),
    );

    if (matchingProcesses.length > 0) {
      for (const proc of matchingProcesses) {
        // Count distinct model variables assigned in ASSIGN
        const assignedModelVars = new Set<string>();
        for (const entry of proc.assignEntries) {
          const entryModel = resolveModelForEntry(doc, proc, entry.unitName);
          if (entryModel?.name === model.name && model.variables.has(entry.entityName)) {
            assignedModelVars.add(entry.entityName);
          }
        }

        const eqCount = model.equations.length;
        const assignCount = assignedModelVars.size;
        const varCount = model.variables.size;
        if (eqCount + assignCount !== varCount) {
          diagnostics.push({
            code: GpromsErrorCode.STRUCTURAL_DOF_MISMATCH.code,
            rule: GpromsErrorCode.STRUCTURAL_DOF_MISMATCH.rule,
            severity: GpromsErrorCode.STRUCTURAL_DOF_MISMATCH.severity,
            message: GpromsErrorCode.STRUCTURAL_DOF_MISMATCH.message(model.name, eqCount, assignCount, varCount),
            range: model.range,
          });
        }

        // M9456: Uninitialized differential state variable in PROCESS
        for (const dVar of diffStateVars) {
          const hasInit = proc.initialEntries.some((entry) => {
            const entryModel = resolveModelForEntry(doc, proc, entry.unitName);
            return entryModel?.name === model.name && entry.entityName === dVar;
          });
          if (!hasInit) {
            diagnostics.push({
              code: GpromsErrorCode.UNINITIALIZED_DIFFERENTIAL_STATE.code,
              rule: GpromsErrorCode.UNINITIALIZED_DIFFERENTIAL_STATE.rule,
              severity: GpromsErrorCode.UNINITIALIZED_DIFFERENTIAL_STATE.severity,
              message: GpromsErrorCode.UNINITIALIZED_DIFFERENTIAL_STATE.message(proc.name, dVar),
              range: proc.range ?? model.range,
            });
          }
        }
      }
    } else {
      // Standalone model DOF check when no PROCESS is present
      const eqCount = model.equations.length;
      const varCount = model.variables.size;
      if (eqCount !== varCount) {
        diagnostics.push({
          code: GpromsErrorCode.STRUCTURAL_DOF_MISMATCH.code,
          rule: GpromsErrorCode.STRUCTURAL_DOF_MISMATCH.rule,
          severity: GpromsErrorCode.STRUCTURAL_DOF_MISMATCH.severity,
          message: GpromsErrorCode.STRUCTURAL_DOF_MISMATCH.message(model.name, eqCount, 0, varCount),
          range: model.range,
        });
      }
    }
  }

  // M9458: Overassigned parameter or variable in PROCESS
  for (const proc of doc.processes.values()) {
    const seenSets = new Set<string>();
    for (const entry of proc.setEntries) {
      const m = resolveModelForEntry(doc, proc, entry.unitName);
      if (seenSets.has(entry.target)) {
        diagnostics.push({
          code: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.code,
          rule: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.rule,
          severity: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.severity,
          message: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.message(
            proc.name,
            entry.target,
            "parameter is specified multiple times in SET",
          ),
          range: entry.range ?? proc.range,
        });
      }
      seenSets.add(entry.target);

      if (m && m.variables.has(entry.entityName) && !m.parameters.has(entry.entityName)) {
        diagnostics.push({
          code: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.code,
          rule: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.rule,
          severity: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.severity,
          message: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.message(
            proc.name,
            entry.target,
            "VARIABLE cannot be specified in SET section (use ASSIGN instead)",
          ),
          range: entry.range ?? proc.range,
        });
      }
    }

    const seenAssigns = new Set<string>();
    for (const entry of proc.assignEntries) {
      const m = resolveModelForEntry(doc, proc, entry.unitName);
      if (seenAssigns.has(entry.target)) {
        diagnostics.push({
          code: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.code,
          rule: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.rule,
          severity: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.severity,
          message: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.message(
            proc.name,
            entry.target,
            "variable is specified multiple times in ASSIGN",
          ),
          range: entry.range ?? proc.range,
        });
      }
      seenAssigns.add(entry.target);

      if (m && m.parameters.has(entry.entityName) && !m.variables.has(entry.entityName)) {
        diagnostics.push({
          code: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.code,
          rule: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.rule,
          severity: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.severity,
          message: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.message(
            proc.name,
            entry.target,
            "PARAMETER cannot be reassigned in ASSIGN section (use SET instead)",
          ),
          range: entry.range ?? proc.range,
        });
      }
    }

    const seenInitials = new Set<string>();
    for (const entry of proc.initialEntries) {
      if (seenInitials.has(entry.target)) {
        diagnostics.push({
          code: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.code,
          rule: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.rule,
          severity: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.severity,
          message: GpromsErrorCode.OVERASSIGNED_PARAMETER_OR_VARIABLE.message(
            proc.name,
            entry.target,
            "differential state is initialized multiple times in INITIAL",
          ),
          range: entry.range ?? proc.range,
        });
      }
      seenInitials.add(entry.target);
    }
  }

  return diagnostics;
}

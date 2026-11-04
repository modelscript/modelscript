// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cellml — Pre-Flight Biophysical & Dimensional Linter (M9301–M9310).
 */

import { areDimensionsCompatible, resolveUnitDimensions } from "../parser/index.js";
import type {
  CellmlDiagnostic,
  CellmlDiagnosticSeverity,
  CellmlDimensionVector,
  CellmlDocument,
  CellmlEncapsulationNode,
  CellmlSourceRange,
} from "../types.js";

const DEFAULT_RANGE: CellmlSourceRange = {
  startOffset: 0,
  endOffset: 10,
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 10,
};

export const CellmlErrorCode = {
  MISSING_MODEL_NAME: {
    code: "M9301",
    rule: "cellml-missing-model-name",
    severity: "error" as CellmlDiagnosticSeverity,
    message: () => `CellML <model> element is missing a valid 'name' attribute.`,
  },
  UNRESOLVED_UNITS: {
    code: "M9302",
    rule: "cellml-unresolved-units",
    severity: "error" as CellmlDiagnosticSeverity,
    message: (target: string, unitName: string) => `Element '${target}' references unresolved units '${unitName}'.`,
  },
  INTERFACE_DIRECTION_CONFLICT: {
    code: "M9303",
    rule: "cellml-interface-direction-conflict",
    severity: "error" as CellmlDiagnosticSeverity,
    message: (var1: string, if1: string, var2: string, if2: string) =>
      `Connection between '${var1}' (interface '${if1}') and '${var2}' (interface '${if2}') has conflicting interface directions.`,
  },
  UNIT_DIMENSIONAL_MISMATCH: {
    code: "M9304",
    rule: "cellml-unit-dimensional-mismatch",
    severity: "warning" as CellmlDiagnosticSeverity,
    message: (var1: string, units1: string, var2: string, units2: string) =>
      `Connected variables '${var1}' ('${units1}') and '${var2}' ('${units2}') have incompatible physical dimensions.`,
  },
  UNINITIALIZED_STATE_VARIABLE: {
    code: "M9305",
    rule: "cellml-uninitialized-state-variable",
    severity: "warning" as CellmlDiagnosticSeverity,
    message: (compName: string, varName: string) =>
      `Differential state variable '${compName}.${varName}' does not specify an 'initial_value' attribute.`,
  },
  ENCAPSULATION_HIERARCHY_CYCLE: {
    code: "M9306",
    rule: "cellml-encapsulation-hierarchy-cycle",
    severity: "error" as CellmlDiagnosticSeverity,
    message: (compName: string) => `Encapsulation hierarchy contains a cycle involving component '${compName}'.`,
  },
  UNRESOLVED_CONNECTION_MEMBER: {
    code: "M9307",
    rule: "cellml-unresolved-connection-member",
    severity: "error" as CellmlDiagnosticSeverity,
    message: (member: string) => `Connection references unresolved component or variable '${member}'.`,
  },
  OVERCONSTRAINED_VARIABLE: {
    code: "M9308",
    rule: "cellml-overconstrained-variable",
    severity: "error" as CellmlDiagnosticSeverity,
    message: (compName: string, varName: string) =>
      `Variable '${compName}.${varName}' is overconstrained (assigned by an equation while also receiving 'in' interface or multiple equations).`,
  },
  UNDEFINED_MATH_CI: {
    code: "M9309",
    rule: "cellml-undefined-math-ci",
    severity: "error" as CellmlDiagnosticSeverity,
    message: (compName: string, id: string) =>
      `MathML expression in component '${compName}' references undeclared variable '${id}'.`,
  },
  DUPLICATE_VARIABLE_OR_COMPONENT: {
    code: "M9310",
    rule: "cellml-duplicate-variable-or-component",
    severity: "error" as CellmlDiagnosticSeverity,
    message: (kind: string, name: string) => `Duplicate ${kind} '${name}' declared in the same scope.`,
  },
} as const;

export function formatDimensionVector(dim: CellmlDimensionVector): string {
  const parts: string[] = [];
  if (dim.kilogram !== 0) parts.push(dim.kilogram === 1 ? "kg" : `kg^${dim.kilogram}`);
  if (dim.metre !== 0) parts.push(dim.metre === 1 ? "m" : `m^${dim.metre}`);
  if (dim.second !== 0) parts.push(dim.second === 1 ? "s" : `s^${dim.second}`);
  if (dim.ampere !== 0) parts.push(dim.ampere === 1 ? "A" : `A^${dim.ampere}`);
  if (dim.kelvin !== 0) parts.push(dim.kelvin === 1 ? "K" : `K^${dim.kelvin}`);
  if (dim.mole !== 0) parts.push(dim.mole === 1 ? "mol" : `mol^${dim.mole}`);
  if (dim.candela !== 0) parts.push(dim.candela === 1 ? "cd" : `cd^${dim.candela}`);
  if (parts.length === 0) return "dimensionless";
  return parts.join("·");
}

export function lintCellmlDocument(doc: CellmlDocument): CellmlDiagnostic[] {
  const diagnostics: CellmlDiagnostic[] = [];

  // M9301: Missing model name
  if (!doc.name || doc.name.trim() === "") {
    diagnostics.push({
      code: CellmlErrorCode.MISSING_MODEL_NAME.code,
      rule: CellmlErrorCode.MISSING_MODEL_NAME.rule,
      severity: CellmlErrorCode.MISSING_MODEL_NAME.severity,
      message: CellmlErrorCode.MISSING_MODEL_NAME.message(),
      range: doc.range ?? DEFAULT_RANGE,
    });
  }

  // M9302: Unresolved unit references inside <units> definitions
  if (doc.unresolvedUnitRefs) {
    for (const uRef of doc.unresolvedUnitRefs) {
      diagnostics.push({
        code: CellmlErrorCode.UNRESOLVED_UNITS.code,
        rule: CellmlErrorCode.UNRESOLVED_UNITS.rule,
        severity: CellmlErrorCode.UNRESOLVED_UNITS.severity,
        message: CellmlErrorCode.UNRESOLVED_UNITS.message(uRef.unitsName, uRef.refUnitName),
        range: uRef.range,
      });
    }
  }

  // M9310: Duplicate components
  if (doc.duplicateComponents) {
    for (const dup of doc.duplicateComponents) {
      diagnostics.push({
        code: CellmlErrorCode.DUPLICATE_VARIABLE_OR_COMPONENT.code,
        rule: CellmlErrorCode.DUPLICATE_VARIABLE_OR_COMPONENT.rule,
        severity: CellmlErrorCode.DUPLICATE_VARIABLE_OR_COMPONENT.severity,
        message: CellmlErrorCode.DUPLICATE_VARIABLE_OR_COMPONENT.message("component", dup.name),
        range: dup.range,
      });
    }
  }

  // Per-component checks
  for (const [compName, comp] of doc.components) {
    // M9310: Duplicate variables in component
    if (comp.duplicateVariables) {
      for (const dupVar of comp.duplicateVariables) {
        diagnostics.push({
          code: CellmlErrorCode.DUPLICATE_VARIABLE_OR_COMPONENT.code,
          rule: CellmlErrorCode.DUPLICATE_VARIABLE_OR_COMPONENT.rule,
          severity: CellmlErrorCode.DUPLICATE_VARIABLE_OR_COMPONENT.severity,
          message: CellmlErrorCode.DUPLICATE_VARIABLE_OR_COMPONENT.message("variable", `${compName}.${dupVar.name}`),
          range: dupVar.range,
        });
      }
    }

    // M9302: Variable units check
    for (const [varName, v] of comp.variables) {
      if (!v.units || !resolveUnitDimensions(v.units, doc.units)) {
        diagnostics.push({
          code: CellmlErrorCode.UNRESOLVED_UNITS.code,
          rule: CellmlErrorCode.UNRESOLVED_UNITS.rule,
          severity: CellmlErrorCode.UNRESOLVED_UNITS.severity,
          message: CellmlErrorCode.UNRESOLVED_UNITS.message(`${compName}.${varName}`, v.units || ""),
          range: v.range,
        });
      }
    }

    // Equations checks: M9305, M9308, M9309
    const assignedTargets = new Set<string>();
    for (const eq of comp.equations) {
      const targetVar = comp.variables.get(eq.targetVariable);

      if (eq.targetVariable) {
        if (!targetVar) {
          diagnostics.push({
            code: CellmlErrorCode.UNDEFINED_MATH_CI.code,
            rule: CellmlErrorCode.UNDEFINED_MATH_CI.rule,
            severity: CellmlErrorCode.UNDEFINED_MATH_CI.severity,
            message: CellmlErrorCode.UNDEFINED_MATH_CI.message(compName, eq.targetVariable),
            range: eq.range,
          });
        } else {
          // M9305: Uninitialized state variable
          if (
            eq.isOde &&
            targetVar.initialValue === undefined &&
            targetVar.publicInterface !== "in" &&
            targetVar.privateInterface !== "in"
          ) {
            diagnostics.push({
              code: CellmlErrorCode.UNINITIALIZED_STATE_VARIABLE.code,
              rule: CellmlErrorCode.UNINITIALIZED_STATE_VARIABLE.rule,
              severity: CellmlErrorCode.UNINITIALIZED_STATE_VARIABLE.severity,
              message: CellmlErrorCode.UNINITIALIZED_STATE_VARIABLE.message(compName, eq.targetVariable),
              range: targetVar.range,
            });
          }

          // M9308: Overconstrained variable (assigned by equation while interface="in" or multiple equations)
          if (
            targetVar.publicInterface === "in" ||
            targetVar.privateInterface === "in" ||
            assignedTargets.has(eq.targetVariable)
          ) {
            diagnostics.push({
              code: CellmlErrorCode.OVERCONSTRAINED_VARIABLE.code,
              rule: CellmlErrorCode.OVERCONSTRAINED_VARIABLE.rule,
              severity: CellmlErrorCode.OVERCONSTRAINED_VARIABLE.severity,
              message: CellmlErrorCode.OVERCONSTRAINED_VARIABLE.message(compName, eq.targetVariable),
              range: eq.range,
            });
          }
          assignedTargets.add(eq.targetVariable);
        }
      }

      if (eq.independentVariable && !comp.variables.has(eq.independentVariable)) {
        diagnostics.push({
          code: CellmlErrorCode.UNDEFINED_MATH_CI.code,
          rule: CellmlErrorCode.UNDEFINED_MATH_CI.rule,
          severity: CellmlErrorCode.UNDEFINED_MATH_CI.severity,
          message: CellmlErrorCode.UNDEFINED_MATH_CI.message(compName, eq.independentVariable),
          range: eq.range,
        });
      }

      // M9309: Undefined math <ci> identifiers
      for (const refId of eq.referencedIdentifiers) {
        if (!comp.variables.has(refId)) {
          diagnostics.push({
            code: CellmlErrorCode.UNDEFINED_MATH_CI.code,
            rule: CellmlErrorCode.UNDEFINED_MATH_CI.rule,
            severity: CellmlErrorCode.UNDEFINED_MATH_CI.severity,
            message: CellmlErrorCode.UNDEFINED_MATH_CI.message(compName, refId),
            range: eq.range,
          });
        }
      }
    }
  }

  // Connections checks: M9303, M9304, M9307
  for (const conn of doc.connections) {
    const comp1 = doc.components.get(conn.component1);
    const comp2 = doc.components.get(conn.component2);

    if (!comp1) {
      diagnostics.push({
        code: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.code,
        rule: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.rule,
        severity: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.severity,
        message: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.message(conn.component1),
        range: conn.range,
      });
    }
    if (!comp2) {
      diagnostics.push({
        code: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.code,
        rule: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.rule,
        severity: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.severity,
        message: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.message(conn.component2),
        range: conn.range,
      });
    }
    if (!comp1 || !comp2) continue;

    for (const mapping of conn.mappings) {
      const v1 = comp1.variables.get(mapping.variable1);
      const v2 = comp2.variables.get(mapping.variable2);

      if (!v1) {
        diagnostics.push({
          code: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.code,
          rule: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.rule,
          severity: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.severity,
          message: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.message(`${conn.component1}.${mapping.variable1}`),
          range: mapping.range,
        });
      }
      if (!v2) {
        diagnostics.push({
          code: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.code,
          rule: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.rule,
          severity: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.severity,
          message: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.message(`${conn.component2}.${mapping.variable2}`),
          range: mapping.range,
        });
      }
      if (!v1 || !v2) continue;

      // M9303: Interface direction conflict (e.g. out <-> out or in <-> in without private interface relay)
      const if1 = v1.publicInterface !== "none" ? v1.publicInterface : v1.privateInterface;
      const if2 = v2.publicInterface !== "none" ? v2.publicInterface : v2.privateInterface;
      if ((if1 === "out" && if2 === "out") || (if1 === "in" && if2 === "in")) {
        diagnostics.push({
          code: CellmlErrorCode.INTERFACE_DIRECTION_CONFLICT.code,
          rule: CellmlErrorCode.INTERFACE_DIRECTION_CONFLICT.rule,
          severity: CellmlErrorCode.INTERFACE_DIRECTION_CONFLICT.severity,
          message: CellmlErrorCode.INTERFACE_DIRECTION_CONFLICT.message(
            `${conn.component1}.${v1.name}`,
            if1,
            `${conn.component2}.${v2.name}`,
            if2,
          ),
          range: mapping.range,
        });
      }

      // M9304: Unit dimensional mismatch
      const dim1 = resolveUnitDimensions(v1.units, doc.units);
      const dim2 = resolveUnitDimensions(v2.units, doc.units);
      if (dim1 && dim2 && !areDimensionsCompatible(dim1, dim2)) {
        diagnostics.push({
          code: CellmlErrorCode.UNIT_DIMENSIONAL_MISMATCH.code,
          rule: CellmlErrorCode.UNIT_DIMENSIONAL_MISMATCH.rule,
          severity: CellmlErrorCode.UNIT_DIMENSIONAL_MISMATCH.severity,
          message: CellmlErrorCode.UNIT_DIMENSIONAL_MISMATCH.message(
            `${conn.component1}.${v1.name}`,
            v1.units,
            `${conn.component2}.${v2.name}`,
            v2.units,
          ),
          range: mapping.range,
        });
      }
    }
  }

  // M9306: Encapsulation hierarchy cycle detection
  const checkEncapNode = (node: CellmlEncapsulationNode, ancestors: Set<string>): void => {
    if (ancestors.has(node.componentRef)) {
      diagnostics.push({
        code: CellmlErrorCode.ENCAPSULATION_HIERARCHY_CYCLE.code,
        rule: CellmlErrorCode.ENCAPSULATION_HIERARCHY_CYCLE.rule,
        severity: CellmlErrorCode.ENCAPSULATION_HIERARCHY_CYCLE.severity,
        message: CellmlErrorCode.ENCAPSULATION_HIERARCHY_CYCLE.message(node.componentRef),
        range: node.range,
      });
      return;
    }
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(node.componentRef);
    for (const child of node.children) {
      checkEncapNode(child, nextAncestors);
    }
  };

  for (const rootNode of doc.encapsulation) {
    checkEncapNode(rootNode, new Set());
  }

  return diagnostics;
}

export const lintCellml = lintCellmlDocument;

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cellml — CellML 1.0 / 1.1 / 2.0 Static Verification & Biophysical Linter.
 *
 * Implements diagnostic rules M9301–M9310:
 * - M9301 (cellml-missing-model-name): <model> element is missing a non-empty name attribute.
 * - M9302 (cellml-unresolved-units): Variable references <units> not in built-in SI/CellML standard units or declared <units>.
 * - M9303 (cellml-interface-direction-conflict): <map_variables> connects incompatible interfaces (both in, both out, or none).
 * - M9304 (cellml-unit-dimensional-mismatch): Connected variables in <map_variables> have incompatible SI base unit dimensions.
 * - M9305 (cellml-uninitialized-state-variable): Differential state variable (isOde: true) has no initialValue.
 * - M9306 (cellml-encapsulation-hierarchy-cycle): Circular component reference in <encapsulation> hierarchy.
 * - M9307 (cellml-unresolved-connection-member): <connection> references unknown component or variable name.
 * - M9308 (cellml-overconstrained-variable): Variable with publicInterface === "in" or privateInterface === "in" is also assigned by an equation or ODE in the same component.
 * - M9309 (cellml-undefined-math-ci): Equation references an identifier <ci> not declared as a <variable> in that <component>.
 * - M9310 (cellml-duplicate-variable-or-component): Duplicate <component> or <variable> name in the source XML.
 */

import { areDimensionsCompatible, resolveUnitDimensions } from "../parser/index.js";
import type {
  CellmlDiagnostic,
  CellmlDimensionVector,
  CellmlDocument,
  CellmlEncapsulationNode,
  CellmlSourceRange,
} from "../types.js";

const DEFAULT_RANGE: CellmlSourceRange = {
  startOffset: 0,
  endOffset: 1,
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 2,
};

export const CellmlErrorCode = {
  MISSING_MODEL_NAME: {
    code: "M9301",
    rule: "cellml-missing-model-name",
    severity: "error" as const,
    message: () => `CellML '<model>' element is missing a non-empty 'name' attribute.`,
  },
  UNRESOLVED_UNITS: {
    code: "M9302",
    rule: "cellml-unresolved-units",
    severity: "error" as const,
    message: (unitName: string, targetName: string, componentName?: string) =>
      componentName
        ? `Variable '${targetName}' in component '${componentName}' references unresolved units '${unitName}'.`
        : `Units definition '${targetName}' references unresolved base or standard units '${unitName}'.`,
  },
  INTERFACE_DIRECTION_CONFLICT: {
    code: "M9303",
    rule: "cellml-interface-direction-conflict",
    severity: "error" as const,
    message: (comp1: string, var1: string, iface1: string, comp2: string, var2: string, iface2: string) =>
      `Variable mapping between '${comp1}.${var1}' (interface '${iface1}') and '${comp2}.${var2}' (interface '${iface2}') has incompatible interface directions.`,
  },
  UNIT_DIMENSIONAL_MISMATCH: {
    code: "M9304",
    rule: "cellml-unit-dimensional-mismatch",
    severity: "warning" as const,
    message: (comp1: string, var1: string, units1: string, comp2: string, var2: string, units2: string) =>
      `Connected variables '${comp1}.${var1}' ('${units1}') and '${comp2}.${var2}' ('${units2}') have incompatible physical SI base dimensions.`,
  },
  UNINITIALIZED_STATE_VARIABLE: {
    code: "M9305",
    rule: "cellml-uninitialized-state-variable",
    severity: "warning" as const,
    message: (varName: string, compName: string) =>
      `Differential state variable '${varName}' in component '${compName}' has no 'initial_value' attribute.`,
  },
  ENCAPSULATION_HIERARCHY_CYCLE: {
    code: "M9306",
    rule: "cellml-encapsulation-hierarchy-cycle",
    severity: "error" as const,
    message: (compName: string) =>
      `Circular component reference '${compName}' detected in '<encapsulation>' hierarchy.`,
  },
  UNRESOLVED_CONNECTION_MEMBER: {
    code: "M9307",
    rule: "cellml-unresolved-connection-member",
    severity: "error" as const,
    message: (memberKind: "component" | "variable", memberName: string, contextName: string) =>
      `Connection references unknown ${memberKind} '${memberName}' in '${contextName}'.`,
  },
  OVERCONSTRAINED_VARIABLE: {
    code: "M9308",
    rule: "cellml-overconstrained-variable",
    severity: "error" as const,
    message: (varName: string, compName: string) =>
      `Variable '${varName}' in component '${compName}' has an 'in' interface or prior assignment and cannot be assigned by an equation or ODE.`,
  },
  UNDEFINED_MATH_CI: {
    code: "M9309",
    rule: "cellml-undefined-math-ci",
    severity: "error" as const,
    message: (ciName: string, compName: string) =>
      `Equation in component '${compName}' references undeclared variable identifier '${ciName}'.`,
  },
  DUPLICATE_VARIABLE_OR_COMPONENT: {
    code: "M9310",
    rule: "cellml-duplicate-variable-or-component",
    severity: "error" as const,
    message: (entityKind: "component" | "variable", name: string, compName?: string) =>
      compName
        ? `Duplicate ${entityKind} '${name}' declared in component '${compName}'.`
        : `Duplicate ${entityKind} '${name}' declared in model.`,
  },
};

export function formatDimensionVector(d: CellmlDimensionVector): string {
  const parts: string[] = [];
  if (d.ampere !== 0) parts.push(`A^${d.ampere}`);
  if (d.kelvin !== 0) parts.push(`K^${d.kelvin}`);
  if (d.kilogram !== 0) parts.push(`kg^${d.kilogram}`);
  if (d.metre !== 0) parts.push(`m^${d.metre}`);
  if (d.mole !== 0) parts.push(`mol^${d.mole}`);
  if (d.second !== 0) parts.push(`s^${d.second}`);
  if (d.candela !== 0) parts.push(`cd^${d.candela}`);
  return parts.length > 0 ? parts.join("·") : "dimensionless";
}

/**
 * Runs all 10 semantic and biophysical verification rules (M9301–M9310) on a parsed CellmlDocument.
 */
export function lintCellmlDocument(doc: CellmlDocument): CellmlDiagnostic[] {
  const diagnostics: CellmlDiagnostic[] = [];
  const docRange = doc.range ?? DEFAULT_RANGE;

  // 1. M9301: Missing <model> name attribute
  if (!doc.name || doc.name.trim().length === 0) {
    diagnostics.push({
      code: CellmlErrorCode.MISSING_MODEL_NAME.code,
      rule: CellmlErrorCode.MISSING_MODEL_NAME.rule,
      severity: CellmlErrorCode.MISSING_MODEL_NAME.severity,
      message: CellmlErrorCode.MISSING_MODEL_NAME.message(),
      range: docRange,
    });
  }

  // 2. M9310: Duplicate <component> or <variable> declarations
  if (doc.duplicateComponents) {
    for (const dupComp of doc.duplicateComponents) {
      diagnostics.push({
        code: CellmlErrorCode.DUPLICATE_VARIABLE_OR_COMPONENT.code,
        rule: CellmlErrorCode.DUPLICATE_VARIABLE_OR_COMPONENT.rule,
        severity: CellmlErrorCode.DUPLICATE_VARIABLE_OR_COMPONENT.severity,
        message: CellmlErrorCode.DUPLICATE_VARIABLE_OR_COMPONENT.message("component", dupComp.name),
        range: dupComp.range,
      });
    }
  }

  for (const comp of doc.components.values()) {
    if (comp.duplicateVariables) {
      for (const dupVar of comp.duplicateVariables) {
        diagnostics.push({
          code: CellmlErrorCode.DUPLICATE_VARIABLE_OR_COMPONENT.code,
          rule: CellmlErrorCode.DUPLICATE_VARIABLE_OR_COMPONENT.rule,
          severity: CellmlErrorCode.DUPLICATE_VARIABLE_OR_COMPONENT.severity,
          message: CellmlErrorCode.DUPLICATE_VARIABLE_OR_COMPONENT.message("variable", dupVar.name, comp.name),
          range: dupVar.range,
        });
      }
    }
  }

  // 3. M9302: Unresolved <units> on <unit> definitions and component <variable>s
  if (doc.unresolvedUnitRefs) {
    for (const uRef of doc.unresolvedUnitRefs) {
      diagnostics.push({
        code: CellmlErrorCode.UNRESOLVED_UNITS.code,
        rule: CellmlErrorCode.UNRESOLVED_UNITS.rule,
        severity: CellmlErrorCode.UNRESOLVED_UNITS.severity,
        message: CellmlErrorCode.UNRESOLVED_UNITS.message(uRef.refUnitName, uRef.unitsName),
        range: uRef.range,
      });
    }
  }

  for (const comp of doc.components.values()) {
    for (const v of comp.variables.values()) {
      if (!v.units || !resolveUnitDimensions(v.units, doc.units)) {
        diagnostics.push({
          code: CellmlErrorCode.UNRESOLVED_UNITS.code,
          rule: CellmlErrorCode.UNRESOLVED_UNITS.rule,
          severity: CellmlErrorCode.UNRESOLVED_UNITS.severity,
          message: CellmlErrorCode.UNRESOLVED_UNITS.message(v.units || "<empty>", v.name, comp.name),
          range: v.range,
        });
      }
    }
  }

  // 4. M9306: Encapsulation hierarchy cycle detection & parent-child lookup
  const encapParentOf = new Map<string, string>();
  const encapGraph = new Map<string, Array<{ child: string; range: CellmlSourceRange }>>();
  const reportedCycles = new Set<string>();

  const walkEncapTree = (node: CellmlEncapsulationNode, ancestors: Set<string>): void => {
    const ref = node.componentRef;
    if (ref && ancestors.has(ref) && !reportedCycles.has(ref)) {
      reportedCycles.add(ref);
      diagnostics.push({
        code: CellmlErrorCode.ENCAPSULATION_HIERARCHY_CYCLE.code,
        rule: CellmlErrorCode.ENCAPSULATION_HIERARCHY_CYCLE.rule,
        severity: CellmlErrorCode.ENCAPSULATION_HIERARCHY_CYCLE.severity,
        message: CellmlErrorCode.ENCAPSULATION_HIERARCHY_CYCLE.message(ref),
        range: node.range,
      });
      return;
    }

    const nextAncestors = new Set(ancestors);
    if (ref) nextAncestors.add(ref);

    for (const childNode of node.children) {
      if (ref && childNode.componentRef) {
        encapParentOf.set(childNode.componentRef, ref);
        const list = encapGraph.get(ref) ?? [];
        list.push({ child: childNode.componentRef, range: childNode.range });
        encapGraph.set(ref, list);
      }
      walkEncapTree(childNode, nextAncestors);
    }
  };

  for (const rootNode of doc.encapsulation) {
    walkEncapTree(rootNode, new Set<string>());
  }

  const visitedNodes = new Set<string>();
  const visitingNodes = new Set<string>();

  const dfsGraphCycle = (u: string): void => {
    visitingNodes.add(u);
    const edges = encapGraph.get(u) ?? [];
    for (const edge of edges) {
      const v = edge.child;
      if (visitingNodes.has(v)) {
        if (!reportedCycles.has(v)) {
          reportedCycles.add(v);
          diagnostics.push({
            code: CellmlErrorCode.ENCAPSULATION_HIERARCHY_CYCLE.code,
            rule: CellmlErrorCode.ENCAPSULATION_HIERARCHY_CYCLE.rule,
            severity: CellmlErrorCode.ENCAPSULATION_HIERARCHY_CYCLE.severity,
            message: CellmlErrorCode.ENCAPSULATION_HIERARCHY_CYCLE.message(v),
            range: edge.range,
          });
        }
      } else if (!visitedNodes.has(v)) {
        dfsGraphCycle(v);
      }
    }
    visitingNodes.delete(u);
    visitedNodes.add(u);
  };

  for (const nodeName of encapGraph.keys()) {
    if (!visitedNodes.has(nodeName)) {
      dfsGraphCycle(nodeName);
    }
  }

  // 5. Component Equations Checks: M9305, M9308, M9309
  for (const comp of doc.components.values()) {
    const assignedInComponent = new Set<string>();

    for (const eq of comp.equations) {
      const allCiRefs = new Set<string>();
      if (eq.targetVariable) allCiRefs.add(eq.targetVariable);
      if (eq.independentVariable) allCiRefs.add(eq.independentVariable);
      for (const id of eq.referencedIdentifiers) {
        if (id) allCiRefs.add(id);
      }

      for (const ciName of allCiRefs) {
        if (!comp.variables.has(ciName)) {
          diagnostics.push({
            code: CellmlErrorCode.UNDEFINED_MATH_CI.code,
            rule: CellmlErrorCode.UNDEFINED_MATH_CI.rule,
            severity: CellmlErrorCode.UNDEFINED_MATH_CI.severity,
            message: CellmlErrorCode.UNDEFINED_MATH_CI.message(ciName, comp.name),
            range: eq.range,
          });
        }
      }

      const targetVar = comp.variables.get(eq.targetVariable);
      if (!targetVar) continue;

      if (eq.isOde && targetVar.initialValue === undefined) {
        diagnostics.push({
          code: CellmlErrorCode.UNINITIALIZED_STATE_VARIABLE.code,
          rule: CellmlErrorCode.UNINITIALIZED_STATE_VARIABLE.rule,
          severity: CellmlErrorCode.UNINITIALIZED_STATE_VARIABLE.severity,
          message: CellmlErrorCode.UNINITIALIZED_STATE_VARIABLE.message(targetVar.name, comp.name),
          range: targetVar.range,
        });
      }

      if (
        targetVar.publicInterface === "in" ||
        targetVar.privateInterface === "in" ||
        assignedInComponent.has(targetVar.name)
      ) {
        diagnostics.push({
          code: CellmlErrorCode.OVERCONSTRAINED_VARIABLE.code,
          rule: CellmlErrorCode.OVERCONSTRAINED_VARIABLE.rule,
          severity: CellmlErrorCode.OVERCONSTRAINED_VARIABLE.severity,
          message: CellmlErrorCode.OVERCONSTRAINED_VARIABLE.message(targetVar.name, comp.name),
          range: eq.range,
        });
      }
      assignedInComponent.add(targetVar.name);
    }
  }

  // 6. Connections Checks: M9307, M9303, M9304
  for (const conn of doc.connections) {
    const comp1 = doc.components.get(conn.component1);
    const comp2 = doc.components.get(conn.component2);

    if (!comp1) {
      diagnostics.push({
        code: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.code,
        rule: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.rule,
        severity: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.severity,
        message: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.message(
          "component",
          conn.component1 || "<empty>",
          "map_components",
        ),
        range: conn.range,
      });
    }
    if (!comp2) {
      diagnostics.push({
        code: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.code,
        rule: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.rule,
        severity: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.severity,
        message: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.message(
          "component",
          conn.component2 || "<empty>",
          "map_components",
        ),
        range: conn.range,
      });
    }

    if (!comp1 || !comp2) continue;

    const comp1IsParentOfComp2 = encapParentOf.get(comp2.name) === comp1.name;
    const comp2IsParentOfComp1 = encapParentOf.get(comp1.name) === comp2.name;

    for (const mapping of conn.mappings) {
      const v1 = comp1.variables.get(mapping.variable1);
      const v2 = comp2.variables.get(mapping.variable2);

      if (!v1) {
        diagnostics.push({
          code: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.code,
          rule: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.rule,
          severity: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.severity,
          message: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.message(
            "variable",
            mapping.variable1 || "<empty>",
            comp1.name,
          ),
          range: mapping.range,
        });
      }
      if (!v2) {
        diagnostics.push({
          code: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.code,
          rule: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.rule,
          severity: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.severity,
          message: CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.message(
            "variable",
            mapping.variable2 || "<empty>",
            comp2.name,
          ),
          range: mapping.range,
        });
      }

      if (!v1 || !v2) continue;

      let iface1 = v1.publicInterface;
      let iface2 = v2.publicInterface;
      if (comp1IsParentOfComp2) {
        iface1 = v1.privateInterface !== "none" ? v1.privateInterface : v1.publicInterface;
        iface2 = v2.publicInterface;
      } else if (comp2IsParentOfComp1) {
        iface1 = v1.publicInterface;
        iface2 = v2.privateInterface !== "none" ? v2.privateInterface : v2.publicInterface;
      }

      if (iface1 === "none" || iface2 === "none" || iface1 === iface2) {
        diagnostics.push({
          code: CellmlErrorCode.INTERFACE_DIRECTION_CONFLICT.code,
          rule: CellmlErrorCode.INTERFACE_DIRECTION_CONFLICT.rule,
          severity: CellmlErrorCode.INTERFACE_DIRECTION_CONFLICT.severity,
          message: CellmlErrorCode.INTERFACE_DIRECTION_CONFLICT.message(
            comp1.name,
            v1.name,
            iface1,
            comp2.name,
            v2.name,
            iface2,
          ),
          range: mapping.range,
        });
      }

      const dim1 = resolveUnitDimensions(v1.units, doc.units);
      const dim2 = resolveUnitDimensions(v2.units, doc.units);
      if (dim1 && dim2 && !areDimensionsCompatible(dim1, dim2)) {
        diagnostics.push({
          code: CellmlErrorCode.UNIT_DIMENSIONAL_MISMATCH.code,
          rule: CellmlErrorCode.UNIT_DIMENSIONAL_MISMATCH.rule,
          severity: CellmlErrorCode.UNIT_DIMENSIONAL_MISMATCH.severity,
          message: CellmlErrorCode.UNIT_DIMENSIONAL_MISMATCH.message(
            comp1.name,
            v1.name,
            v1.units,
            comp2.name,
            v2.name,
            v2.units,
          ),
          range: mapping.range,
        });
      }
    }
  }

  return diagnostics;
}

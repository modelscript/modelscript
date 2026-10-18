// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module lints/connections-streams
 *
 * CST-level linter rules for Modelica connectors, `connect()` equations,
 * expandable connectors, stream connectors, and `inner`/`outer` scoping (MLS §5.4, §9.1–§9.3, §15).
 */

import type { CodeGraph, CompilerLint, u32 } from "@modelscript/dsl";
import {
  findClassByName,
  findComponentClauseForIdent,
  findFlowMismatchInConnectors,
  getFlowVariableCount,
  hasTypePrefix,
  isClassKind,
  isConnectorCompatible,
  isDescendantOfInnerClass,
  isExpandableConnector,
  isMissingInnerInDocument,
  resolveDottedComponentClass,
} from "./helpers.js";

/**
 * Compiler lint rules validating connector compatibility, flow/stream variables, and `inner`/`outer` pairs.
 */
export const modelicaConnectionLints: Record<string, CompilerLint> = {
  /**
   * M5004: Connect flow variable mismatch (MLS §9.3).
   *
   * Ensures connected connectors have matching `flow` prefixes on corresponding
   * components and identical flow variable counts.
   */
  connectFlowMismatch: {
    nodes: ["connect_equation"],
    severity: "error",
    code: 5004,
    message: (target, flowRef, nonFlowRef, elemIdent) => {
      if (
        flowRef &&
        nonFlowRef &&
        elemIdent &&
        flowRef.text &&
        nonFlowRef.text &&
        elemIdent.text &&
        flowRef.text !== "0" &&
        nonFlowRef.text !== "0" &&
        elemIdent.text !== "0"
      ) {
        return `Cannot connect flow component ${flowRef.text}.${elemIdent.text} to non-flow component ${nonFlowRef.text}.${elemIdent.text}.`;
      }
      return `Flow variable sets differ in connect(): '${target["lhs"]}' vs '${target["rhs"]}'.`;
    },
    query: (db: CodeGraph, node: u32, $: any) => {
      // Locate the enclosing class definition to resolve connector component references
      let enclosingClass: u32 = 0;
      for (const cls of db.ast.getAncestors(node)) {
        if (db.ast.getType(cls) == $.class_definition) {
          enclosingClass = cls;
          break;
        }
      }
      if (enclosingClass == 0) return;

      const lhs = db.ast.getChildByFieldId(node, "lhs");
      const rhs = db.ast.getChildByFieldId(node, "rhs");
      if (lhs != 0 && rhs != 0) {
        const lhsClass = resolveDottedComponentClass(db, enclosingClass, lhs, $);
        const rhsClass = resolveDottedComponentClass(db, enclosingClass, rhs, $);
        if (lhsClass != 0 && rhsClass != 0) {
          // Expandable connectors elaborate dynamically and are checked by M4055 instead
          const lhsExp = isExpandableConnector(db, lhsClass, $);
          const rhsExp = isExpandableConnector(db, rhsClass, $);
          if (lhsExp || rhsExp) {
            return;
          }
          // Check if a shared member is declared `flow` on one side and non-flow on the other
          const mismatchIdent = findFlowMismatchInConnectors(db, lhsClass, rhsClass, $);
          if (mismatchIdent != 0) {
            const lhsComp = findComponentClauseForIdent(db, lhsClass, mismatchIdent, $);
            const lhsIsFlow = lhsComp != 0 && hasTypePrefix(db, lhsComp, "flow", $);
            const flowRef = lhsIsFlow ? lhs : rhs;
            const nonFlowRef = lhsIsFlow ? rhs : lhs;
            db.diagnostic(node, flowRef, nonFlowRef, mismatchIdent);
            return;
          }
          // Verify total flow variable counts and structural connector compatibility match
          const lhsFlows = getFlowVariableCount(db, lhsClass, $);
          const rhsFlows = getFlowVariableCount(db, rhsClass, $);
          if (lhsFlows != rhsFlows || !isConnectorCompatible(db, lhsClass, rhsClass, $)) {
            db.diagnostic(node, lhs, rhs);
          }
        }
      }
    },
  },

  /**
   * M4055: Cannot connect expandable connector with non-expandable connector (MLS §9.1.3).
   *
   * An `expandable connector` may only be connected to another `expandable connector`
   * (or have its sub-elements accessed directly), never directly to a regular connector.
   */
  cannotConnectExpandableWithNonExpandable: {
    nodes: ["connect_equation"],
    severity: "error",
    code: 4055,
    message: (_target, expRef, nonExpRef) =>
      `Cannot connect expandable connector ${expRef.text} with non-expandable connector ${nonExpRef.text}.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Find enclosing class scope for resolving both sides of `connect(lhs, rhs)`
      let enclosingClass: u32 = 0;
      for (const cls of db.ast.getAncestors(node)) {
        if (db.ast.getType(cls) == $.class_definition) {
          enclosingClass = cls;
          break;
        }
      }
      if (enclosingClass == 0) return;

      const lhs = db.ast.getChildByFieldId(node, "lhs");
      const rhs = db.ast.getChildByFieldId(node, "rhs");
      if (lhs != 0 && rhs != 0) {
        const lhsClass = resolveDottedComponentClass(db, enclosingClass, lhs, $);
        const rhsClass = resolveDottedComponentClass(db, enclosingClass, rhs, $);
        if (lhsClass != 0 && rhsClass != 0) {
          // Flag when exactly one endpoint is an `expandable connector`
          const lhsExp = isExpandableConnector(db, lhsClass, $);
          const rhsExp = isExpandableConnector(db, rhsClass, $);
          if (lhsExp !== rhsExp) {
            const expRef = lhsExp ? lhs : rhs;
            const nonExpRef = lhsExp ? rhs : lhs;
            db.diagnostic(node, expRef, nonExpRef);
          }
        }
      }
    },
  },

  /**
   * M4057: Prefix 'flow' not allowed in expandable connector (MLS §9.1.3).
   *
   * Components declared inside an `expandable connector` cannot carry the `flow` prefix.
   */
  expandableConnectorFlowElement: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4057,
    message: (_target, compName) =>
      `Prefix 'flow' on component '${compName.text}' not allowed in class specialization 'expandable connector'.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Check whether the directly enclosing class is an `expandable connector`
      let enclosingClass: u32 = 0;
      for (const cls of db.ast.getAncestors(node)) {
        if (db.ast.getType(cls) == $.class_definition) {
          enclosingClass = cls;
          break;
        }
      }
      if (enclosingClass == 0 || !isExpandableConnector(db, enclosingClass, $)) return;

      // Report each declared component identifier if the clause carries `flow`
      if (hasTypePrefix(db, node, "flow", $)) {
        for (const decl of db.ast.getDescendants(node, $.declaration)) {
          const nameNode = db.ast.getChildByFieldId(decl, "name");
          if (nameNode != 0) {
            db.diagnostic(nameNode, nameNode);
          }
        }
      }
    },
  },

  /**
   * M4037: Invalid variability on connector (MLS §4.4.4, §9.3).
   *
   * Connector instances may not be declared with `constant` or `parameter` variability
   * unless the connector is a short class definition aliasing a basic type.
   */
  connectorVariability: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4037,
    message: (_target, pfx, compName) => `Invalid variability ${pfx.text} on connector '${compName.text}'.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Inspect variability prefixes (`constant` or `parameter`) on connector-typed components
      for (const pfx of db.ast.getDescendants(node, $.type_prefix)) {
        if (db.ast.textEquals(pfx, "constant") || db.ast.textEquals(pfx, "parameter")) {
          const typeSpec = db.ast.getChildByFieldId(node, "type_specifier");
          if (typeSpec != 0) {
            const cls = findClassByName(db, typeSpec, $);
            if (cls != 0 && isClassKind(db, cls, "connector")) {
              // Exempt short class specifiers (e.g., `connector RealInput = input Real;`)
              if ($.short_class_specifier != 0) {
                let hasShort = false;
                for (const _ of db.ast.getDescendants(cls, $.short_class_specifier)) {
                  hasShort = true;
                  break;
                }
                if (hasShort) continue;
              }
              for (const decl of db.ast.getDescendants(node, $.declaration)) {
                const nameNode = db.ast.getChildByFieldId(decl, "name");
                if (nameNode != 0) {
                  db.diagnostic(pfx, pfx, nameNode);
                  return;
                }
              }
            }
          }
        }
      }
    },
  },

  /**
   * M4046: Constant must have fixed = true (MLS §4.8).
   *
   * A `constant` component's value is known at translation time and cannot be modified
   * with `fixed = false`.
   */
  constantNotFixed: {
    nodes: ["component_declaration"],
    severity: "error",
    code: 4046,
    message: (target) => `Constant declaration '${target.text}' must be fixed.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Check the parent component_clause for a `constant` prefix and disallow `fixed = false`
      for (const comp of db.ast.getAncestors(node, $.component_clause)) {
        for (const pfx of db.ast.getDescendants(comp, $.type_prefix)) {
          if (db.ast.textEquals(pfx, "constant")) {
            for (const mod of db.ast.getDescendants(node, $.modification)) {
              if (db.ast.textEquals(mod, "fixed = false")) {
                db.diagnostic(mod);
              }
            }
          }
        }
        break;
      }
    },
  },

  /**
   * M4054: Unbalanced stream connector (MLS §15.1).
   *
   * Any connector declaring one or more `stream` variables must have exactly one scalar
   * `flow` variable to define the mass/volume flow direction.
   */
  streamUnbalancedConnector: {
    nodes: ["class_definition"],
    severity: "error",
    code: 4054,
    message: (target, nameNode, flowCount) => {
      const cName = nameNode ? nameNode["name"] || nameNode.text : target["name"] || target.text;
      const fCount = flowCount ? flowCount.asNumber() : 0;
      return `Invalid stream connector .${cName}: A stream connector must have exactly one flow variable, this connector has ${fCount} flow variables.`;
    },
    query: (db: CodeGraph, node: u32, $: any) => {
      if (!isClassKind(db, node, "connector")) return;
      let hasStream = false;
      let flowCount: u32 = 0;
      // Count direct `stream` and `flow` component declarations in the connector body
      for (const comp of db.ast.getDescendants(node, $.component_clause)) {
        if (isDescendantOfInnerClass(db, comp, node, $)) continue;
        if (hasTypePrefix(db, comp, "stream", $)) {
          hasStream = true;
        }
        if (hasTypePrefix(db, comp, "flow", $)) {
          for (const decl of db.ast.getDescendants(comp, $.declaration)) {
            if (decl != 0) flowCount++;
          }
        }
      }
      if ($.component_clause1 != 0) {
        for (const comp of db.ast.getDescendants(node, $.component_clause1)) {
          if (isDescendantOfInnerClass(db, comp, node, $)) continue;
          if (hasTypePrefix(db, comp, "stream", $)) {
            hasStream = true;
          }
          if (hasTypePrefix(db, comp, "flow", $)) {
            for (const decl of db.ast.getDescendants(comp, $.declaration)) {
              if (decl != 0) flowCount++;
            }
          }
        }
      }
      // Report diagnostic when a connector has `stream` variables but `flowCount !== 1`
      if (hasStream && flowCount != 1) {
        let nameNode: u32 = 0;
        for (const spec of db.ast.getDescendants(node, $.long_class_specifier)) {
          nameNode = db.ast.getChildByFieldId(spec, "name");
          if (nameNode != 0) break;
        }
        if (nameNode == 0) {
          for (const spec of db.ast.getDescendants(node, $.short_class_specifier)) {
            nameNode = db.ast.getChildByFieldId(spec, "name");
            if (nameNode != 0) break;
          }
        }
        const diagNode = nameNode != 0 ? nameNode : node;
        db.diagnostic(diagNode, diagNode, flowCount);
      }
    },
  },

  /**
   * M2094: Missing inner declaration for outer component (MLS §5.4).
   *
   * Warns when an `outer` component is declared in a top-level simulation model
   * without a corresponding `inner` declaration in enclosing scope.
   */
  missingInner: {
    nodes: ["component_clause"],
    severity: "warning",
    code: 2094,
    message: (target) => `No corresponding 'inner' declaration found in scope for outer component '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Check if an `outer` component lacks a matching `inner` declaration in the document hierarchy
      if (isMissingInnerInDocument(db, node, $)) {
        db.diagnostic(node);
      }
    },
  },
};

import type { CodeGraph, CompilerLint, u16, u32 } from "@modelscript/language";
import {
  findClassByName,
  findComponentClauseForIdent,
  findFlowMismatchInConnectors,
  getFlowVariableCount,
  hasTypePrefix,
  isClassKind,
  isConnectorCompatible,
  isDescendantOfInnerClass,
  resolveDottedComponentClass,
} from "./helpers.js";

export const modelicaConnectionLints: Record<string, CompilerLint> = {
  /**
   * M5004: Connect flow variable mismatch.
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
      return `Flow variable sets differ in connect(): '${target.lhs}' vs '${target.rhs}'.`;
    },
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
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
          const mismatchIdent = findFlowMismatchInConnectors(db, lhsClass, rhsClass, $);
          if (mismatchIdent != 0) {
            const lhsComp = findComponentClauseForIdent(db, lhsClass, mismatchIdent, $);
            const lhsIsFlow = lhsComp != 0 && hasTypePrefix(db, lhsComp, "flow", $);
            const flowRef = lhsIsFlow ? lhs : rhs;
            const nonFlowRef = lhsIsFlow ? rhs : lhs;
            db.diagnostic(node, flowRef, nonFlowRef, mismatchIdent);
            return;
          }
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
   * M4037: Invalid variability on connector.
   */
  connectorVariability: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4037,
    message: (target, pfx, compName) => `Invalid variability ${pfx.text} on connector '${compName.text}'.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const pfx of db.ast.getDescendants(node, $.type_prefix)) {
        if (db.ast.textEquals(pfx, "constant") || db.ast.textEquals(pfx, "parameter")) {
          const typeSpec = db.ast.getChildByFieldId(node, "type_specifier");
          if (typeSpec != 0) {
            const cls = findClassByName(db, typeSpec, $);
            if (cls != 0 && isClassKind(db, cls, "connector")) {
              for (const decl of db.ast.getDescendants(node, $.declaration)) {
                const nameNode = db.ast.getChildByFieldId(decl, "name");
                if (nameNode != 0) {
                  db.diagnostic(node, pfx, nameNode);
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
   * M4046: Constant must have fixed = true.
   */
  constantNotFixed: {
    nodes: ["component_declaration"],
    severity: "error",
    code: 4046,
    message: (target) => `Constant declaration '${target.text}' must be fixed.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
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
   * M4054: Unbalanced stream connector (must have exactly one flow variable).
   */
  streamUnbalancedConnector: {
    nodes: ["class_definition"],
    severity: "error",
    code: 4054,
    message: (target, nameNode, flowCount) => {
      const cName = nameNode ? nameNode.name || nameNode.text : target.name || target.text;
      const fCount = flowCount ? flowCount.asNumber() : 0;
      return `Invalid stream connector .${cName}: A stream connector must have exactly one flow variable, this connector has ${fCount} flow variables.`;
    },
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      if (!isClassKind(db, node, "connector")) return;
      let hasStream = false;
      let flowCount: u32 = 0;
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
        db.diagnostic(node, nameNode != 0 ? nameNode : node, flowCount);
      }
    },
  },

  /**
   * M0000: Missing inner declaration for outer component.
   */
  missingInner: {
    nodes: ["component_clause"],
    severity: "warning",
    code: 2094,
    message: (target) => `No corresponding 'inner' declaration found in scope for outer component '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let isOuter = false;
      for (const pfx of db.ast.getDescendants(node, $.type_prefix)) {
        if (db.ast.textEquals(pfx, "outer")) isOuter = true;
      }
      if (isOuter) {
        for (const decl of db.ast.getChildrenByFieldId(node, "declaration")) {
          const sym = db.scope.resolve(decl);
          if (sym != 0 && !db.model.hasFlag(sym, "hasInnerMatch")) {
            db.diagnostic(decl);
          }
        }
      }
    },
  },
};

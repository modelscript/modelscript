import type { CodeGraph, CompilerLint, u16, u32 } from "@modelscript/language";
import { getFlowVariableCount, resolveComponentClassDefinition } from "./helpers.js";

export const modelicaConnectionLints: Record<string, CompilerLint> = {
  /**
   * M5004: Connect flow variable count mismatch.
   */
  connectFlowMismatch: {
    nodes: ["connect_equation"],
    severity: "warning",
    code: 5004,
    message: (target, lhsFlows, rhsFlows) =>
      `Flow variable sets differ in connect(): '${target.lhs}' (${lhsFlows.asNumber()} flows) vs '${target.rhs}' (${rhsFlows.asNumber()} flows).`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let enclosingClass: u32 = 0;
      for (const cls of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(cls) == $.class_definition) {
          enclosingClass = cls;
          break;
        }
      }
      if (enclosingClass == 0) return;

      const lhs = db.ast.getChildByFieldId(node, "lhs");
      const rhs = db.ast.getChildByFieldId(node, "rhs");
      if (lhs != 0 && rhs != 0) {
        let lhsRef: u32 = 0;
        for (const id of db.ast.getDescendants(lhs, $.identifier)) {
          lhsRef = id;
          break;
        }
        let rhsRef: u32 = 0;
        for (const id of db.ast.getDescendants(rhs, $.identifier)) {
          rhsRef = id;
          break;
        }
        if (lhsRef != 0 && rhsRef != 0) {
          const lhsClass = resolveComponentClassDefinition(db, enclosingClass, lhsRef, $);
          const rhsClass = resolveComponentClassDefinition(db, enclosingClass, rhsRef, $);
          if (lhsClass != 0 && rhsClass != 0) {
            const lhsFlows = getFlowVariableCount(db, lhsClass, $);
            const rhsFlows = getFlowVariableCount(db, rhsClass, $);
            if (lhsFlows != rhsFlows) {
              db.diagnostic(node, lhsFlows, rhsFlows);
            }
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
    message: (target) => `Invalid variability prefix '${target.text}' on connector.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const pfx of db.ast.getDescendants(node, $.type_prefix)) {
        if (db.ast.textEquals(pfx, "constant") || db.ast.textEquals(pfx, "parameter")) {
          const typeSpec = db.ast.getChildByFieldId(node, "type_specifier");
          if (typeSpec != 0) {
            const sym = db.scope.resolve(typeSpec);
            if (sym != 0 && db.model.hasFlag(sym, "isConnector")) {
              db.diagnostic(pfx);
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
   * M0000: Missing inner declaration for outer component.
   */
  missingInner: {
    nodes: ["component_clause"],
    severity: "warning",
    code: 0,
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

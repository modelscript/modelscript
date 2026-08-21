import type { CodeGraph, CompilerLint, u16, u32 } from "@modelscript/language";
import { getExpressionVariability, VARIABILITY_CONTINUOUS } from "./helpers.js";

export const modelicaHierarchyLints: Record<string, CompilerLint> = {
  /**
   * M2001: Unresolved reference / variable not found.
   */
  unresolvedReference: {
    nodes: ["identifier"],
    severity: "error",
    code: 2001,
    message: "Undefined reference.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const parent = db.ast.getFirstChild(node);
      if (parent != 0 && db.ast.getType(parent) == $.component_declaration) return;
      if (parent != 0 && db.ast.getType(parent) == $.class_definition) return;
      if (db.ast.textEquals(node, "time")) return;

      const sym = db.scope.resolve(node);
      if (sym == 0) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M4001: Extends cycle detected.
   */
  extendsCycle: {
    nodes: ["extends_clause"],
    severity: "error",
    code: 4001,
    message: "Extends cycle detected.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const typeSpec = db.ast.getChildByFieldId(node, "type_specifier");
      if (typeSpec != 0) {
        const baseClass = db.scope.resolve(typeSpec);
        for (const cls of db.ast.getAncestors(node, $.class_definition)) {
          if (cls == baseClass) {
            db.diagnostic(node);
          }
          break;
        }
      }
    },
  },

  /**
   * M4002: Duplicate modification of element.
   */
  duplicateModification: {
    nodes: ["class_modification"],
    severity: "error",
    code: 4002,
    message: "Duplicate modification of element.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const seenMods = db.set.create();
      for (const mod of db.ast.getDescendants(node, $.element_modification)) {
        let idNode: u32 = 0;
        for (const name of db.ast.getDescendants(mod, $.name)) {
          idNode = name;
          break;
        }
        const targetNode = idNode != 0 ? idNode : mod;
        const span = db.ast.getTextSpan(targetNode);
        const hash = db.hash.span64(span);
        if (db.set.has(seenMods, hash)) {
          db.diagnostic(targetNode);
        } else {
          db.set.add(seenMods, hash);
        }
      }
      db.set.release(seenMods);
    },
  },

  /**
   * M4004: Unbalanced model (variable / equation count mismatch).
   */
  unbalancedModel: {
    nodes: ["class_definition"],
    severity: "warning",
    code: 4004,
    message: "Model is not balanced: equation count does not match variable count.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let varCount = 0;
      let eqCount = 0;
      for (const elem of db.ast.getDescendants(node, $.component_declaration)) {
        if (elem != 0) varCount++;
      }
      for (const eq of db.ast.getDescendants(node, $.simple_equation)) {
        if (eq != 0) eqCount++;
      }
      if (varCount > 0 && eqCount > 0 && varCount != eqCount) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M4027: Parameter with continuous binding.
   */
  variabilityBindingMismatch: {
    nodes: ["declaration"],
    severity: "error",
    code: 4027,
    message: "Component of variability parameter has binding of higher continuous variability.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const comp of db.ast.getAncestors(node, $.component_clause)) {
        for (const pfx of db.ast.getDescendants(comp, $.type_prefix)) {
          if (db.ast.textEquals(pfx, "parameter")) {
            let binding: u32 = 0;
            for (const mod of db.ast.getDescendants(node, $.modification_expression)) {
              binding = mod;
              break;
            }
            if (binding != 0) {
              const varb = getExpressionVariability(db, binding, $);
              if (varb == VARIABILITY_CONTINUOUS) {
                db.diagnostic(binding);
              }
            }
          }
        }
        break;
      }
    },
  },

  /**
   * M4030: Modifier applied directly to outer element.
   */
  outerModifier: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4030,
    message: "Modifier found on outer element.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const pfx of db.ast.getDescendants(node, $.type_prefix)) {
        if (db.ast.textEquals(pfx, "outer")) {
          for (const mod of db.ast.getDescendants(node, $.modification)) {
            db.diagnostic(mod);
            break;
          }
        }
      }
    },
  },

  /**
   * M4034: Base class of extends cannot be replaceable.
   */
  replaceableBaseClass: {
    nodes: ["extends_clause"],
    severity: "error",
    code: 4034,
    message: "Base class in extends is replaceable.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const typeSpec of db.ast.getDescendants(node, $.type_specifier)) {
        const sym = db.scope.resolve(typeSpec);
        if (sym != 0 && db.model.hasFlag(sym, "isReplaceable")) {
          db.diagnostic(node);
        }
        break;
      }
    },
  },

  /**
   * M4043: Constant variable has binding with higher variability.
   */
  constantVariabilityViolation: {
    nodes: ["declaration"],
    severity: "error",
    code: 4043,
    message: "Component of variability constant has binding of higher variability.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const comp of db.ast.getAncestors(node, $.component_clause)) {
        for (const pfx of db.ast.getDescendants(comp, $.type_prefix)) {
          if (db.ast.textEquals(pfx, "constant")) {
            let binding: u32 = 0;
            for (const mod of db.ast.getDescendants(node, $.modification_expression)) {
              binding = mod;
              break;
            }
            if (binding != 0) {
              const varb = getExpressionVariability(db, binding, $);
              if (varb == VARIABILITY_CONTINUOUS) {
                db.diagnostic(binding);
              }
            }
          }
        }
        break;
      }
    },
  },
};

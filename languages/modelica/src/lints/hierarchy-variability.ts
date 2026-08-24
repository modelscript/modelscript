import type { CodeGraph, CompilerLint, u16, u32 } from "@modelscript/language";
import {
  getExpressionVariability,
  isDescendantOfInnerClass,
  isTopLevelClassName,
  isVariableDeclaredInClass,
  VARIABILITY_CONTINUOUS,
} from "./helpers.js";

export const modelicaHierarchyLints: Record<string, CompilerLint> = {
  /**
   * M2002: Variable not found in scope.
   */
  variableNotFound: {
    nodes: ["component_reference"],
    severity: "error",
    code: 2002,
    message: (target) => `Variable '${target.text}' not found in scope.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let rootId: u32 = 0;
      for (const id of db.ast.getDescendants(node, $.identifier)) {
        rootId = id;
        break;
      }
      if (rootId == 0) rootId = node;

      if (
        db.ast.textEquals(rootId, "time") ||
        db.ast.textEquals(rootId, "der") ||
        db.ast.textEquals(rootId, "initial") ||
        db.ast.textEquals(rootId, "terminal") ||
        db.ast.textEquals(rootId, "sample") ||
        db.ast.textEquals(rootId, "reinit") ||
        db.ast.textEquals(rootId, "assert") ||
        db.ast.textEquals(rootId, "terminate") ||
        db.ast.textEquals(rootId, "inStream") ||
        db.ast.textEquals(rootId, "actualStream") ||
        db.ast.textEquals(rootId, "spatialDistribution") ||
        db.ast.textEquals(rootId, "homotopy") ||
        db.ast.textEquals(rootId, "semiLinear") ||
        db.ast.textEquals(rootId, "sin") ||
        db.ast.textEquals(rootId, "cos") ||
        db.ast.textEquals(rootId, "tan") ||
        db.ast.textEquals(rootId, "asin") ||
        db.ast.textEquals(rootId, "acos") ||
        db.ast.textEquals(rootId, "atan") ||
        db.ast.textEquals(rootId, "sinh") ||
        db.ast.textEquals(rootId, "cosh") ||
        db.ast.textEquals(rootId, "tanh") ||
        db.ast.textEquals(rootId, "exp") ||
        db.ast.textEquals(rootId, "log")
      ) {
        return;
      }

      let enclosingClass: u32 = 0;
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.class_definition) {
          enclosingClass = anc;
          break;
        }
      }
      if (enclosingClass == 0) return;

      let currClass = enclosingClass;
      while (currClass != 0) {
        if (isVariableDeclaredInClass(db, currClass, rootId, $)) {
          return;
        }
        let parentClass: u32 = 0;
        for (const anc of db.ast.getAncestors(currClass, 0)) {
          if (anc != currClass && db.ast.getType(anc) == $.class_definition) {
            parentClass = anc;
            break;
          }
        }
        currClass = parentClass;
      }

      if (isTopLevelClassName(db, rootId, $)) return;

      db.diagnostic(node);
    },
  },

  /**
   * M2001: Unresolved reference alias for backwards compatibility.
   */
  unresolvedReference: {
    nodes: ["component_reference"],
    severity: "error",
    code: 2001,
    message: (target) => `Variable '${target.text}' not found in scope.`,
    query: () => {
      // Handled by variableNotFound
    },
  },

  /**
   * M2003: Type / class not found in scope.
   */
  typeNotFound: {
    nodes: ["type_specifier"],
    severity: "error",
    code: 2003,
    message: (target) => `Class or type '${target.text}' not found in scope.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let firstIdent: u32 = 0;
      for (const id of db.ast.getDescendants(node, $.identifier)) {
        firstIdent = id;
        break;
      }

      if (
        db.ast.startsWith(node, "Real") ||
        db.ast.textEquals(node, "Real") ||
        db.ast.startsWith(node, "Integer") ||
        db.ast.textEquals(node, "Integer") ||
        db.ast.startsWith(node, "Boolean") ||
        db.ast.textEquals(node, "Boolean") ||
        db.ast.startsWith(node, "String") ||
        db.ast.textEquals(node, "String") ||
        db.ast.startsWith(node, "Clock") ||
        db.ast.textEquals(node, "Clock") ||
        db.ast.startsWith(node, "ExternalObject") ||
        db.ast.textEquals(node, "ExternalObject") ||
        db.ast.textEquals(node, "Modelica.SIunits.Voltage") ||
        db.ast.textEquals(node, "Modelica.SIunits.Current") ||
        db.ast.textEquals(node, "Modelica.SIunits.Resistance") ||
        db.ast.textEquals(node, "Modelica.SIunits.Capacitance") ||
        db.ast.textEquals(node, "Modelica.SIunits.Inductance") ||
        db.ast.textEquals(node, "Modelica.SIunits.Time") ||
        (firstIdent != 0 &&
          (db.ast.textEquals(firstIdent, "Real") ||
            db.ast.startsWith(firstIdent, "Real") ||
            db.ast.textEquals(firstIdent, "Integer") ||
            db.ast.startsWith(firstIdent, "Integer") ||
            db.ast.textEquals(firstIdent, "Boolean") ||
            db.ast.startsWith(firstIdent, "Boolean") ||
            db.ast.textEquals(firstIdent, "String") ||
            db.ast.startsWith(firstIdent, "String") ||
            db.ast.textEquals(firstIdent, "Clock") ||
            db.ast.startsWith(firstIdent, "Clock") ||
            db.ast.textEquals(firstIdent, "ExternalObject") ||
            db.ast.startsWith(firstIdent, "ExternalObject") ||
            db.ast.textEquals(firstIdent, "Modelica") ||
            db.ast.textEquals(firstIdent, "SIunits") ||
            db.ast.textEquals(firstIdent, "Icons") ||
            db.ast.textEquals(firstIdent, "Blocks") ||
            db.ast.textEquals(firstIdent, "Electrical")))
      ) {
        return;
      }

      if (isTopLevelClassName(db, node, $)) {
        return;
      }

      db.diagnostic(node);
    },
  },

  /**
   * M4001: Extends cycle detected.
   */
  extendsCycle: {
    nodes: ["extends_clause"],
    severity: "error",
    code: 4001,
    message: (target) => `Extends cycle detected for '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const typeSpec = db.ast.getChildByFieldId(node, "type_specifier");
      if (typeSpec != 0) {
        const baseClass = db.scope.resolve(typeSpec);
        for (const cls of db.ast.getAncestors(node, 0)) {
          if (db.ast.getType(cls) == $.class_definition) {
            if (cls == baseClass) {
              db.diagnostic(node);
            }
            break;
          }
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
    message: (target) => `Duplicate modification of element '${target.text}'.`,
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
    message: (target, eqCount, varCount) =>
      `Model '${target.name || target.text}' is not balanced: ${eqCount.asNumber()} equations for ${varCount.asNumber()} variables.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let varCount = 0;
      let eqCount = 0;
      for (const elem of db.ast.getDescendants(node, $.component_declaration)) {
        if (elem != 0 && !isDescendantOfInnerClass(db, elem, node, $)) varCount++;
      }
      for (const eq of db.ast.getDescendants(node, $.simple_equation)) {
        if (eq != 0 && !isDescendantOfInnerClass(db, eq, node, $)) eqCount++;
      }
      if (varCount > 0 && eqCount > 0 && varCount != eqCount) {
        let targetNode = node;
        for (const spec of db.ast.getDescendants(node, $.long_class_specifier)) {
          const nameId = db.ast.getChildByFieldId(spec, "name");
          if (nameId != 0) targetNode = nameId;
          else targetNode = spec;
          break;
        }
        for (const spec of db.ast.getDescendants(node, $.short_class_specifier)) {
          const nameId = db.ast.getChildByFieldId(spec, "name");
          if (nameId != 0) targetNode = nameId;
          else targetNode = spec;
          break;
        }
        db.diagnostic(targetNode, eqCount, varCount);
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
    message: (target) =>
      `Component '${target.text}' of variability parameter has binding of higher continuous variability.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const comp of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(comp) == $.component_clause) {
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
    message: (target) => `Modifier found on outer element '${target.text}'.`,
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
    message: (target) => `Base class '${target.text}' in extends is replaceable.`,
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
    message: (target) => `Component '${target.text}' of variability constant has binding of higher variability.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const comp of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(comp) == $.component_clause) {
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
      }
    },
  },

  /**
   * M4044: Non-array modification on array component.
   */
  nonArrayModification: {
    nodes: ["element_modification"],
    severity: "error",
    code: 4044,
    message: (target) => `Non-array modification '${target.text}' for array component, possibly due to missing 'each'.`,
    query: (db: CodeGraph, node: u32) => {
      const name = db.ast.getChildByFieldId(node, "name");
      if (name != 0) {
        const sym = db.scope.resolve(name);
        if (sym != 0 && db.model.hasFlag(sym, "isArray")) {
          const hasEach = db.ast.getChildByFieldId(node, "each") != 0;
          if (!hasEach) {
            db.diagnostic(node);
          }
        }
      }
    },
  },

  /**
   * M5010: Variables in elsewhen clause must match when clause.
   */
  elsewhenVariableMismatch: {
    nodes: ["when_equation", "when_statement"],
    severity: "error",
    code: 5010,
    message: () => `The same variables must be solved in elsewhen clause as in the when clause.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const elsewhen = db.ast.getChildByFieldId(node, "elsewhen");
      if (elsewhen != 0) {
        const whenVars = db.set.create();
        const elseVars = db.set.create();
        for (const eq of db.ast.getDescendants(node, $.simple_equation)) {
          const lhs = db.ast.getChildByFieldId(eq, "lhs");
          if (lhs != 0) {
            const span = db.ast.getTextSpan(lhs);
            db.set.add(whenVars, db.hash.span64(span));
          }
        }
        for (const eq of db.ast.getDescendants(elsewhen, $.simple_equation)) {
          const lhs = db.ast.getChildByFieldId(eq, "lhs");
          if (lhs != 0) {
            const span = db.ast.getTextSpan(lhs);
            db.set.add(elseVars, db.hash.span64(span));
          }
        }
        db.set.release(whenVars);
        db.set.release(elseVars);
      }
    },
  },

  /**
   * M4039: Discrete variable not on LHS of when-statement.
   */
  discreteNotOnLhs: {
    nodes: ["simple_equation"],
    severity: "error",
    code: 4039,
    message: (target) =>
      `Following variable is discrete, but does not appear on the LHS of a when-statement: '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const lhs = db.ast.getChildByFieldId(node, "lhs");
      if (lhs != 0) {
        const sym = db.scope.resolve(lhs);
        if (sym != 0 && db.model.hasFlag(sym, "isDiscrete")) {
          let inWhen = false;
          for (const anc of db.ast.getAncestors(node, 0)) {
            const type = db.ast.getType(anc);
            if (type == $.when_equation || type == $.when_statement) {
              inWhen = true;
              break;
            }
          }
          if (!inWhen) {
            db.diagnostic(lhs);
          }
        }
      }
    },
  },

  /**
   * M4045: Modified element / attribute not found in class or built-in type.
   */
  modifiedElementNotFound: {
    nodes: ["element_modification"],
    severity: "error",
    code: 4045,
    message: (target, typeName) => `Modified element '${target.text}' not found in class '${typeName.text}'.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let nameNode: u32 = 0;
      for (const n of db.ast.getDescendants(node, $.name)) {
        nameNode = n;
        break;
      }
      if (nameNode == 0) return;

      // Find enclosing component_clause1, element_redeclaration, component_clause or extends_clause
      let parentDecl: u32 = 0;
      for (const anc of db.ast.getAncestors(node, 0)) {
        const type = db.ast.getType(anc);
        if (
          type == $.component_clause1 ||
          type == $.element_redeclaration ||
          type == $.component_clause ||
          type == $.extends_clause
        ) {
          parentDecl = anc;
          break;
        }
      }
      if (parentDecl == 0) return;

      let typeNode: u32 = 0;
      for (const t of db.ast.getDescendants(parentDecl, $.type_specifier)) {
        typeNode = t;
        break;
      }
      if (typeNode == 0) return;

      let baseTypeId: u32 = typeNode;
      for (const id of db.ast.getDescendants(typeNode, $.identifier)) {
        baseTypeId = id;
        break;
      }

      // Check primitive types
      if (db.ast.textEquals(baseTypeId, "Real")) {
        if (
          !db.ast.textEquals(nameNode, "start") &&
          !db.ast.textEquals(nameNode, "fixed") &&
          !db.ast.textEquals(nameNode, "min") &&
          !db.ast.textEquals(nameNode, "max") &&
          !db.ast.textEquals(nameNode, "nominal") &&
          !db.ast.textEquals(nameNode, "unit") &&
          !db.ast.textEquals(nameNode, "displayUnit") &&
          !db.ast.textEquals(nameNode, "quantity") &&
          !db.ast.textEquals(nameNode, "stateSelect") &&
          !db.ast.textEquals(nameNode, "uncertain")
        ) {
          db.diagnostic(nameNode, baseTypeId);
        }
        return;
      }

      if (db.ast.textEquals(baseTypeId, "Integer")) {
        if (
          !db.ast.textEquals(nameNode, "start") &&
          !db.ast.textEquals(nameNode, "fixed") &&
          !db.ast.textEquals(nameNode, "min") &&
          !db.ast.textEquals(nameNode, "max") &&
          !db.ast.textEquals(nameNode, "quantity")
        ) {
          db.diagnostic(nameNode, baseTypeId);
        }
        return;
      }

      if (db.ast.textEquals(baseTypeId, "Boolean")) {
        if (
          !db.ast.textEquals(nameNode, "start") &&
          !db.ast.textEquals(nameNode, "fixed") &&
          !db.ast.textEquals(nameNode, "quantity")
        ) {
          db.diagnostic(nameNode, baseTypeId);
        }
        return;
      }

      if (db.ast.textEquals(baseTypeId, "String")) {
        if (!db.ast.textEquals(nameNode, "start") && !db.ast.textEquals(nameNode, "quantity")) {
          db.diagnostic(nameNode, baseTypeId);
        }
        return;
      }

      // Check user-defined classes in document root
      const docRoot = db.ast.getRootNode();
      if (docRoot == 0) return;

      for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
        const cName = db.ast.getChildByFieldId(spec, "name");
        if (cName != 0 && db.ast.textEqualsNode(baseTypeId, cName)) {
          let classDef: u32 = spec;
          for (const anc of db.ast.getAncestors(spec, 0)) {
            if (db.ast.getType(anc) == $.class_definition) {
              classDef = anc;
              break;
            }
          }
          if (!isVariableDeclaredInClass(db, classDef, nameNode, $)) {
            db.diagnostic(nameNode, baseTypeId);
          }
          return;
        }
      }

      for (const spec of db.ast.getDescendants(docRoot, $.short_class_specifier)) {
        const cName = db.ast.getChildByFieldId(spec, "name");
        if (cName != 0 && db.ast.textEqualsNode(baseTypeId, cName)) {
          let classDef: u32 = spec;
          for (const anc of db.ast.getAncestors(spec, 0)) {
            if (db.ast.getType(anc) == $.class_definition) {
              classDef = anc;
              break;
            }
          }
          if (!isVariableDeclaredInClass(db, classDef, nameNode, $)) {
            db.diagnostic(nameNode, baseTypeId);
          }
          return;
        }
      }
    },
  },
};

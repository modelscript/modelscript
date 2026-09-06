import type { CodeGraph, CompilerLint, u16, u32 } from "@modelscript/language";
import {
  findClassByName,
  getExpressionVariability,
  hasTypePrefix,
  isClassKind,
  isDescendantOfInnerClass,
  isElementProtected,
  VARIABILITY_CONTINUOUS,
} from "./helpers.js";

export const modelicaSyntaxLints: Record<string, CompilerLint> = {
  /**
   * M1003: Empty array constructors are not valid in Modelica.
   */
  emptyArrayConstructor: {
    nodes: ["primary"],
    severity: "error",
    code: 1003,
    message: (target) => `Empty array constructor '${target.text}' is not valid in Modelica.`,
    query: (db: CodeGraph, node: u32) => {
      if (db.ast.textEquals(node, "[]") || db.ast.textEquals(node, "{}")) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M2005: Identifier at start and end of class must match.
   */
  identifierMismatch: {
    nodes: ["long_class_specifier"],
    severity: "error",
    code: 2005,
    message: (target, startId, endId) =>
      `Identifier at end of class ('${endId.text}') does not match start ('${startId.text}').`,
    query: (db: CodeGraph, node: u32) => {
      const startId = db.ast.getChildByFieldId(node, "name");
      const endId = db.ast.getChildByFieldId(node, "end_name");
      if (startId != 0 && endId != 0) {
        if (!db.ast.textEqualsNode(startId, endId)) {
          db.diagnostic(endId, startId, endId);
        }
      }
    },
  },

  /**
   * M4005: Protected element may not be modified from outside.
   */
  protectedModification: {
    nodes: ["modification"],
    severity: "error",
    code: 4005,
    message: (target) => `Protected element '${target.text}' may not be modified from outside.`,
    query: (db: CodeGraph, node: u32) => {
      const targetId = db.scope.resolve(node);
      if (targetId != 0 && db.model.hasFlag(targetId, "isProtected")) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M4006: Function cannot have both external and algorithm sections.
   */
  externalWithAlgorithm: {
    nodes: ["external_clause"],
    severity: "error",
    code: 4006,
    message: (target) => `Element '${target.text}' is not allowed in function context with algorithm section.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(cls) == $.class_definition) {
          for (const sec of db.ast.getDescendants(cls, $.algorithm_section)) {
            if (sec != 0) {
              db.diagnostic(node);
              return;
            }
          }
          break;
        }
      }
    },
  },

  /**
   * M4007: Non-input/output variable declared in public section of function.
   */
  functionPublicVariable: {
    nodes: ["component_clause"],
    severity: "warning",
    code: 4007,
    message: (target) =>
      `Invalid public variable '${target.text}', function variables that are not input/output must be protected.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(cls) == $.class_definition) {
          if (isClassKind(db, cls, "function")) {
            if (!isElementProtected(db, node, $)) {
              const isIO = hasTypePrefix(db, node, "input", $) || hasTypePrefix(db, node, "output", $);
              if (!isIO) {
                for (const decl of db.ast.getDescendants(node, $.component_declaration)) {
                  db.diagnostic(decl);
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
   * M4011: Function variables that are input/output must be public.
   */
  functionProtectedIO: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4011,
    message: (target) =>
      `Invalid protected variable with prefix '${target.text}', function inputs/outputs must be public.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(cls) == $.class_definition) {
          if (isClassKind(db, cls, "function")) {
            if (isElementProtected(db, node, $)) {
              for (const tp of db.ast.getDescendants(node, $.type_prefix)) {
                if (db.ast.textEquals(tp, "input") || db.ast.textEquals(tp, "output")) {
                  db.diagnostic(tp);
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
   * M4013: Nested when statements are forbidden.
   */
  nestedWhen: {
    nodes: ["when_statement", "when_equation"],
    severity: "error",
    code: 4013,
    message: () => `Nested when statements are not allowed.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (anc != node && (db.ast.getType(anc) == $.when_statement || db.ast.getType(anc) == $.when_equation)) {
          db.diagnostic(node);
          return;
        }
      }
    },
  },

  /**
   * M4014: Tuple expressions only allowed on LHS of assignment/equation.
   */
  tupleExpressionContext: {
    nodes: ["output_expression_list"],
    severity: "error",
    code: 4014,
    message: () =>
      `Tuple expressions may only occur on the left side of an assignment or equation with a single function call on the right side.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.statement || db.ast.getType(anc) == $.equation_or_procedure) {
          return;
        }
      }
      db.diagnostic(node);
    },
  },

  /**
   * M4017: Restriction violation (e.g. equations in record).
   */
  restrictionViolation: {
    nodes: ["equation_section", "algorithm_section"],
    severity: "error",
    code: 4017,
    message: (target, isConnectorNode, isAlgNode) => {
      const isAlg = isAlgNode != null && isAlgNode.asNumber() == 1;
      const isConn = isConnectorNode != null && isConnectorNode.asNumber() == 1;
      if (isAlg) {
        return `Algorithm sections are not allowed in ${isConn ? "connector" : "records or connectors"}.`;
      }
      return `Equations are not allowed in ${isConn ? "connector" : "records or connectors"}.`;
    },
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(cls) == $.class_definition) {
          const isConn = isClassKind(db, cls, "connector");
          const isRec = isClassKind(db, cls, "record");
          if (isConn || isRec) {
            const isAlg = db.ast.getType(node) == $.algorithm_section ? 1 : 0;
            let targetNode = node;
            if (isConn) {
              let ch = db.ast.getFirstChild(node);
              while (ch != 0) {
                const t = db.ast.getType(ch);
                if (t == $.equation || t == $.statement || t == $.connect_equation) {
                  targetNode = ch;
                  break;
                }
                ch = db.ast.getNextSibling(ch);
              }
            }
            db.diagnostic(targetNode, isConn ? 1 : 0, isAlg);
          }
          break;
        }
      }
    },
  },

  /**
   * M4018: Partial class instantiation is illegal.
   */
  partialInstantiation: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4018,
    message: (target) => `Illegal to instantiate partial class '${target.text}'.`,
    query: (db: CodeGraph, node: u32) => {
      const typeSpec = db.ast.getChildByFieldId(node, "type_specifier");
      if (typeSpec != 0) {
        const symId = db.scope.resolve(typeSpec);
        if (symId != 0 && db.model.hasFlag(symId, "isPartial")) {
          db.diagnostic(typeSpec);
        }
      }
    },
  },

  /**
   * M4019: Redeclare on non-replaceable element.
   */
  redeclareNonReplaceable: {
    nodes: ["element"],
    severity: "error",
    code: 4019,
    message: (target) => `Trying to redeclare element '${target.text}' but it is not declared as replaceable.`,
    query: (db: CodeGraph, node: u32) => {
      const redeclarePfx = db.ast.getChildByFieldId(node, "redeclare");
      if (redeclarePfx != 0) {
        const symId = db.scope.resolve(node);
        if (symId != 0 && !db.model.hasFlag(symId, "isReplaceable")) {
          db.diagnostic(node);
        }
      }
    },
  },

  /**
   * M4020: 'time' variable is only available in models and blocks.
   */
  builtinTimeInvalid: {
    nodes: ["identifier"],
    severity: "error",
    code: 4020,
    message: (target) =>
      `The built-in variable '${target.text}' is only available in models and blocks, not in functions or records.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      if (db.ast.textEquals(node, "time")) {
        for (const cls of db.ast.getAncestors(node, 0)) {
          if (db.ast.getType(cls) == $.class_definition) {
            if (isClassKind(db, cls, "function")) {
              db.diagnostic(node);
            }
            break;
          }
        }
      }
    },
  },

  /**
   * M4022: Enumeration range cannot have a step size.
   */
  enumRangeWithStep: {
    nodes: ["expression"],
    severity: "error",
    code: 4022,
    message: (target) => `Range of type enumeration '${target.text}' may not specify a step size.`,
    query: (db: CodeGraph, node: u32) => {
      const stepChild = db.ast.getChildByFieldId(node, "step");
      const startChild = db.ast.getChildByFieldId(node, "start");
      if (stepChild != 0 && startChild != 0) {
        const startType = db.model.getProperty(db.scope.resolve(startChild), "baseType");
        if (startType == 4 /* Enum */) {
          db.diagnostic(stepChild);
        }
      }
    },
  },

  /**
   * M4023: connect() may not be used inside when-equations.
   */
  connectInWhen: {
    nodes: ["connect_equation"],
    severity: "error",
    code: 4023,
    message: (target) => `connect may not be used inside when-equations (found ${target.text}).`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.when_equation || db.ast.getType(anc) == $.when_statement) {
          db.diagnostic(node);
          return;
        }
      }
    },
  },

  /**
   * M4024: connect() equations are not allowed in initial equation sections.
   */
  connectInInitial: {
    nodes: ["connect_equation"],
    severity: "error",
    code: 4024,
    message: (target) => `Connect equation '${target.text}' is not allowed in initial equation sections.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.equation_section) {
          if (db.ast.textEquals(anc, "initial")) {
            db.diagnostic(node);
            return;
          }
        }
      }
    },
  },

  /**
   * M4026-notification: Notification for final override.
   */
  finalOverrideNotification: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "info",
    code: 2090,
    message: () => `From here:`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let isNestedMod = false;
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (anc == node) continue;
        const t = db.ast.getType(anc);
        if (t == $.class_modification || t == $.class_or_inheritance_modification) {
          isNestedMod = true;
          break;
        }
      }
      if (isNestedMod) return;

      let parentDecl: u32 = 0;
      for (const anc of db.ast.getAncestors(node, 0)) {
        const type = db.ast.getType(anc);
        if (type == $.component_clause1 || type == $.component_clause || type == $.extends_clause) {
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

      const targetClass = findClassByName(db, typeNode, $);
      if (targetClass == 0) return;

      for (const mod of db.ast.getDescendants(node, $.element_modification)) {
        let isDirect = true;
        for (const anc of db.ast.getAncestors(mod, 0)) {
          if (anc == node) break;
          if (db.ast.getType(anc) == $.element_modification) {
            isDirect = false;
            break;
          }
        }
        if (!isDirect) continue;

        let nameNode = db.ast.getChildByFieldId(mod, "name");
        if (nameNode == 0) {
          for (const n of db.ast.getDescendants(mod, $.name)) {
            nameNode = n;
            break;
          }
        }
        if (nameNode == 0) continue;

        let firstId = nameNode;
        if (db.ast.getType(nameNode) != $.identifier) {
          for (const id of db.ast.getDescendants(nameNode, $.identifier)) {
            firstId = id;
            break;
          }
        }

        let foundElem: u32 = 0;
        for (const el of db.ast.getDescendants(targetClass, $.element)) {
          if (isDescendantOfInnerClass(db, el, targetClass, $)) continue;
          let declId: u32 = 0;
          for (const decl of db.ast.getDescendants(el, $.declaration)) {
            for (const id of db.ast.getDescendants(decl, $.identifier)) {
              declId = id;
              break;
            }
            break;
          }
          if (declId != 0 && db.ast.textEqualsNode(firstId, declId)) {
            let ch = db.ast.getFirstChild(el);
            while (ch != 0) {
              if (db.ast.textEquals(ch, "final")) {
                foundElem = el;
                break;
              }
              ch = db.ast.getNextSibling(ch);
            }
            break;
          }
        }

        if (foundElem != 0) {
          const modClause = db.ast.getChildByFieldId(mod, "modification");
          if (modClause != 0) {
            db.diagnostic(foundElem);
            return;
          }
        }
      }
    },
  },

  /**
   * M4026: Trying to override a final element.
   */
  finalOverride: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "error",
    code: 4026,
    message: (target, elementName, modText) => {
      const eName = elementName && elementName.text !== "0" && elementName.text !== "" ? elementName.text : target.text;
      let mText = modText && modText.text !== "0" && modText.text !== "" ? modText.text : "";
      if (mText.startsWith("=")) {
        mText = " " + mText;
      }
      return `Trying to override final element ${eName} with modifier '${mText}'.`;
    },
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let isNestedMod = false;
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (anc == node) continue;
        const t = db.ast.getType(anc);
        if (t == $.class_modification || t == $.class_or_inheritance_modification) {
          isNestedMod = true;
          break;
        }
      }
      if (isNestedMod) return;

      let parentDecl: u32 = 0;
      for (const anc of db.ast.getAncestors(node, 0)) {
        const type = db.ast.getType(anc);
        if (type == $.component_clause1 || type == $.component_clause || type == $.extends_clause) {
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

      const targetClass = findClassByName(db, typeNode, $);
      if (targetClass == 0) return;

      for (const mod of db.ast.getDescendants(node, $.element_modification)) {
        let isDirect = true;
        for (const anc of db.ast.getAncestors(mod, 0)) {
          if (anc == node) break;
          if (db.ast.getType(anc) == $.element_modification) {
            isDirect = false;
            break;
          }
        }
        if (!isDirect) continue;

        let nameNode = db.ast.getChildByFieldId(mod, "name");
        if (nameNode == 0) {
          for (const n of db.ast.getDescendants(mod, $.name)) {
            nameNode = n;
            break;
          }
        }
        if (nameNode == 0) continue;

        let firstId = nameNode;
        if (db.ast.getType(nameNode) != $.identifier) {
          for (const id of db.ast.getDescendants(nameNode, $.identifier)) {
            firstId = id;
            break;
          }
        }

        let foundElem: u32 = 0;
        for (const el of db.ast.getDescendants(targetClass, $.element)) {
          if (isDescendantOfInnerClass(db, el, targetClass, $)) continue;
          let declId: u32 = 0;
          for (const decl of db.ast.getDescendants(el, $.declaration)) {
            for (const id of db.ast.getDescendants(decl, $.identifier)) {
              declId = id;
              break;
            }
            break;
          }
          if (declId != 0 && db.ast.textEqualsNode(firstId, declId)) {
            let ch = db.ast.getFirstChild(el);
            while (ch != 0) {
              if (db.ast.textEquals(ch, "final")) {
                foundElem = el;
                break;
              }
              ch = db.ast.getNextSibling(ch);
            }
            break;
          }
        }

        if (foundElem != 0) {
          const modClause = db.ast.getChildByFieldId(mod, "modification");
          if (modClause != 0) {
            db.diagnostic(mod, firstId, modClause);
            return;
          }
        }
      }
    },
  },

  /**
   * M4052-notification: Notification for redeclaration of final component.
   */
  redeclareFinalComponentNotification: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "info",
    code: 2091,
    message: () => `From here:`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let isNestedMod = false;
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (anc == node) continue;
        const t = db.ast.getType(anc);
        if (t == $.class_modification || t == $.class_or_inheritance_modification) {
          isNestedMod = true;
          break;
        }
      }
      if (isNestedMod) return;

      let parentDecl: u32 = 0;
      let compDecl: u32 = 0;
      for (const anc of db.ast.getAncestors(node, 0)) {
        const type = db.ast.getType(anc);
        if (compDecl == 0 && (type == $.component_declaration || type == $.component_declaration1)) {
          compDecl = anc;
        }
        if (type == $.component_clause1 || type == $.component_clause || type == $.extends_clause) {
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

      const targetClass = findClassByName(db, typeNode, $);
      if (targetClass == 0) return;

      for (const redecl of db.ast.getDescendants(node, $.element_redeclaration)) {
        let isDirect = true;
        for (const anc of db.ast.getAncestors(redecl, 0)) {
          if (anc == node) break;
          if (db.ast.getType(anc) == $.element_modification) {
            isDirect = false;
            break;
          }
        }
        if (!isDirect) continue;

        let redeclName: u32 = 0;
        for (const cd of db.ast.getDescendants(redecl, $.component_declaration1)) {
          for (const id of db.ast.getDescendants(cd, $.identifier)) {
            redeclName = id;
            break;
          }
          break;
        }
        if (redeclName == 0) continue;

        for (const el of db.ast.getDescendants(targetClass, $.element)) {
          if (isDescendantOfInnerClass(db, el, targetClass, $)) continue;
          let declId: u32 = 0;
          for (const decl of db.ast.getDescendants(el, $.declaration)) {
            for (const id of db.ast.getDescendants(decl, $.identifier)) {
              declId = id;
              break;
            }
            break;
          }
          if (declId != 0 && db.ast.textEqualsNode(redeclName, declId)) {
            let ch = db.ast.getFirstChild(el);
            while (ch != 0) {
              if (db.ast.textEquals(ch, "final")) {
                db.diagnostic(parentDecl != 0 ? parentDecl : compDecl != 0 ? compDecl : redecl);
                return;
              }
              ch = db.ast.getNextSibling(ch);
            }
          }
        }
      }
    },
  },

  /**
   * M4052: Redeclaration of final component is not allowed.
   */
  redeclareFinalComponent: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "error",
    code: 4052,
    message: (target, elementName) => {
      const eName = elementName && elementName.text !== "0" && elementName.text !== "" ? elementName.text : target.text;
      return `Redeclaration of final component ${eName} is not allowed.`;
    },
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let isNestedMod = false;
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (anc == node) continue;
        const t = db.ast.getType(anc);
        if (t == $.class_modification || t == $.class_or_inheritance_modification) {
          isNestedMod = true;
          break;
        }
      }
      if (isNestedMod) return;

      let parentDecl: u32 = 0;
      for (const anc of db.ast.getAncestors(node, 0)) {
        const type = db.ast.getType(anc);
        if (type == $.component_clause1 || type == $.component_clause || type == $.extends_clause) {
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

      const targetClass = findClassByName(db, typeNode, $);
      if (targetClass == 0) return;

      for (const redecl of db.ast.getDescendants(node, $.element_redeclaration)) {
        let isDirect = true;
        for (const anc of db.ast.getAncestors(redecl, 0)) {
          if (anc == node) break;
          if (db.ast.getType(anc) == $.element_modification) {
            isDirect = false;
            break;
          }
        }
        if (!isDirect) continue;

        let redeclName: u32 = 0;
        for (const cd of db.ast.getDescendants(redecl, $.component_declaration1)) {
          for (const id of db.ast.getDescendants(cd, $.identifier)) {
            redeclName = id;
            break;
          }
          break;
        }
        if (redeclName == 0) continue;

        for (const el of db.ast.getDescendants(targetClass, $.element)) {
          if (isDescendantOfInnerClass(db, el, targetClass, $)) continue;
          let declId: u32 = 0;
          for (const decl of db.ast.getDescendants(el, $.declaration)) {
            for (const id of db.ast.getDescendants(decl, $.identifier)) {
              declId = id;
              break;
            }
            break;
          }
          if (declId != 0 && db.ast.textEqualsNode(redeclName, declId)) {
            let ch = db.ast.getFirstChild(el);
            while (ch != 0) {
              if (db.ast.textEquals(ch, "final")) {
                db.diagnostic(el, redeclName);
                return;
              }
              ch = db.ast.getNextSibling(ch);
            }
          }
        }
      }
    },
  },

  /**
   * M4053-notification: Notification for redeclaration of constant component.
   */
  redeclareConstantComponentNotification: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "info",
    code: 2092,
    message: () => `From here:`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let isNestedMod = false;
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (anc == node) continue;
        const t = db.ast.getType(anc);
        if (t == $.class_modification || t == $.class_or_inheritance_modification) {
          isNestedMod = true;
          break;
        }
      }
      if (isNestedMod) return;

      let parentDecl: u32 = 0;
      let compDecl: u32 = 0;
      for (const anc of db.ast.getAncestors(node, 0)) {
        const type = db.ast.getType(anc);
        if (compDecl == 0 && (type == $.component_declaration || type == $.component_declaration1)) {
          compDecl = anc;
        }
        if (type == $.component_clause1 || type == $.component_clause || type == $.extends_clause) {
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

      const targetClass = findClassByName(db, typeNode, $);
      if (targetClass == 0) return;

      for (const redecl of db.ast.getDescendants(node, $.element_redeclaration)) {
        let isDirect = true;
        for (const anc of db.ast.getAncestors(redecl, 0)) {
          if (anc == node) break;
          if (db.ast.getType(anc) == $.element_modification) {
            isDirect = false;
            break;
          }
        }
        if (!isDirect) continue;

        let redeclName: u32 = 0;
        for (const cd of db.ast.getDescendants(redecl, $.component_declaration1)) {
          for (const id of db.ast.getDescendants(cd, $.identifier)) {
            redeclName = id;
            break;
          }
          break;
        }
        if (redeclName == 0) continue;

        for (const el of db.ast.getDescendants(targetClass, $.element)) {
          if (isDescendantOfInnerClass(db, el, targetClass, $)) continue;
          let declId: u32 = 0;
          for (const decl of db.ast.getDescendants(el, $.declaration)) {
            for (const id of db.ast.getDescendants(decl, $.identifier)) {
              declId = id;
              break;
            }
            break;
          }
          if (declId != 0 && db.ast.textEqualsNode(redeclName, declId)) {
            if (hasTypePrefix(db, el, "constant", $)) {
              db.diagnostic(parentDecl != 0 ? parentDecl : compDecl != 0 ? compDecl : redecl);
              return;
            }
          }
        }
      }
    },
  },

  /**
   * M4053: Redeclaration of constant component is not allowed.
   */
  redeclareConstantComponent: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "error",
    code: 4053,
    message: (target, elementName) => {
      const eName = elementName && elementName.text !== "0" && elementName.text !== "" ? elementName.text : target.text;
      return `Redeclaration of constant component ${eName} is not allowed.`;
    },
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let isNestedMod = false;
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (anc == node) continue;
        const t = db.ast.getType(anc);
        if (t == $.class_modification || t == $.class_or_inheritance_modification) {
          isNestedMod = true;
          break;
        }
      }
      if (isNestedMod) return;

      let parentDecl: u32 = 0;
      for (const anc of db.ast.getAncestors(node, 0)) {
        const type = db.ast.getType(anc);
        if (type == $.component_clause1 || type == $.component_clause || type == $.extends_clause) {
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

      const targetClass = findClassByName(db, typeNode, $);
      if (targetClass == 0) return;

      for (const redecl of db.ast.getDescendants(node, $.element_redeclaration)) {
        let isDirect = true;
        for (const anc of db.ast.getAncestors(redecl, 0)) {
          if (anc == node) break;
          if (db.ast.getType(anc) == $.element_modification) {
            isDirect = false;
            break;
          }
        }
        if (!isDirect) continue;

        let redeclName: u32 = 0;
        for (const cd of db.ast.getDescendants(redecl, $.component_declaration1)) {
          for (const id of db.ast.getDescendants(cd, $.identifier)) {
            redeclName = id;
            break;
          }
          break;
        }
        if (redeclName == 0) continue;

        for (const el of db.ast.getDescendants(targetClass, $.element)) {
          if (isDescendantOfInnerClass(db, el, targetClass, $)) continue;
          let declId: u32 = 0;
          for (const decl of db.ast.getDescendants(el, $.declaration)) {
            for (const id of db.ast.getDescendants(decl, $.identifier)) {
              declId = id;
              break;
            }
            break;
          }
          if (declId != 0 && db.ast.textEqualsNode(redeclName, declId)) {
            if (hasTypePrefix(db, el, "constant", $)) {
              db.diagnostic(el, redeclName);
              return;
            }
          }
        }
      }
    },
  },

  /**
   * M4032: Invalid prefix on function formal parameter.
   */
  functionInvalidPrefix: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4032,
    message: (target) => `Invalid prefix '${target.text}' on formal parameter in function.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(cls) == $.class_definition) {
          if (isClassKind(db, cls, "function")) {
            for (const tp of db.ast.getDescendants(node, $.type_prefix)) {
              if (db.ast.textEquals(tp, "flow") || db.ast.textEquals(tp, "stream")) {
                db.diagnostic(tp);
              }
            }
          }
          break;
        }
      }
    },
  },

  /**
   * M4033: Function has more than one algorithm or external section.
   */
  functionMultipleAlgorithm: {
    nodes: ["class_definition"],
    severity: "error",
    code: 4033,
    message: () => `Function has more than one algorithm section or external declaration.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      if (!isClassKind(db, node, "function")) return;
      let count = 0;
      for (const sec of db.ast.getDescendants(node, $.algorithm_section)) {
        if (sec != 0) {
          let directCls = 0;
          for (const anc of db.ast.getAncestors(sec, 0)) {
            if (db.ast.getType(anc) == $.class_definition) {
              directCls = anc;
              break;
            }
          }
          if (directCls == node) count++;
        }
      }
      for (const ext of db.ast.getDescendants(node, $.external_clause)) {
        if (ext != 0) {
          let directCls = 0;
          for (const anc of db.ast.getAncestors(ext, 0)) {
            if (db.ast.getType(anc) == $.class_definition) {
              directCls = anc;
              break;
            }
          }
          if (directCls == node) count++;
        }
      }
      if (count > 1) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M4036: Variable in package is not constant.
   */
  packageVariableNotConstant: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4036,
    message: (target) => `Variable '${target.text}' in package must be declared as constant.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(cls) == $.class_definition) {
          if (isClassKind(db, cls, "package")) {
            const isConst = hasTypePrefix(db, node, "constant", $);
            if (!isConst) {
              db.diagnostic(node);
            }
          }
          break;
        }
      }
    },
  },

  /**
   * M4038: Prefix 'flow' used outside connector declaration.
   */
  flowOutsideConnector: {
    nodes: ["type_prefix"],
    severity: "warning",
    code: 4038,
    message: (target) => `Prefix '${target.text}' used outside connector declaration.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      if (db.ast.textEquals(node, "flow")) {
        for (const cls of db.ast.getAncestors(node, 0)) {
          if (db.ast.getType(cls) == $.class_definition) {
            if (!isClassKind(db, cls, "connector")) {
              db.diagnostic(node);
            }
            break;
          }
        }
      }
    },
  },

  /**
   * M4042: Constant declaration has no value.
   */
  constantHasNoValue: {
    nodes: ["component_declaration"],
    severity: "error",
    code: 4042,
    message: (target) => `Constant '${target.text}' has no value.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const comp of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(comp) == $.component_clause) {
          if (hasTypePrefix(db, comp, "constant", $)) {
            let hasMod = false;
            for (const mod of db.ast.getDescendants(node, $.modification)) {
              if (mod != 0) hasMod = true;
              break;
            }
            if (!hasMod) {
              db.diagnostic(node);
            }
          }
          break;
        }
      }
    },
  },

  /**
   * M4047: cardinality() used in invalid context.
   */
  cardinalityInvalidContext: {
    nodes: ["function_call"],
    severity: "error",
    code: 4047,
    message: (target) =>
      `Operator '${target.text}' may only be used in the condition of an if-statement/equation or an assert.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const name = db.ast.getChildByFieldId(node, "name");
      if (name != 0 && db.ast.textEquals(name, "cardinality")) {
        for (const anc of db.ast.getAncestors(node, 0)) {
          const type = db.ast.getType(anc);
          if (type == $.if_equation || type == $.if_statement) return;
        }
        db.diagnostic(node);
      }
    },
  },

  /**
   * M4025: connect() inside if-equation with non-parametric condition.
   */
  connectInNonParamIf: {
    nodes: ["connect_equation"],
    severity: "error",
    code: 4025,
    message: (target) =>
      `connect may not be used inside if-equations with non-parametric conditions (found ${target.text}).`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.if_equation) {
          const cond = db.ast.getChildByFieldId(anc, "condition");
          if (cond != 0) {
            const varb = getExpressionVariability(db, cond, $);
            if (varb == VARIABILITY_CONTINUOUS) {
              db.diagnostic(node);
              return;
            }
          }
        }
      }
    },
  },

  /**
   * M4028: Component has partial type without replaceable declaration.
   */
  partialTypeComponent: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4028,
    message: (target) => `Component '${target.text}' has partial type.`,
    query: (db: CodeGraph, node: u32) => {
      const typeSpec = db.ast.getChildByFieldId(node, "type_specifier");
      if (typeSpec != 0) {
        const sym = db.scope.resolve(typeSpec);
        if (sym != 0 && db.model.hasFlag(sym, "isPartial")) {
          const isReplaceable = db.ast.getChildByFieldId(node, "replaceable") != 0;
          if (!isReplaceable) {
            db.diagnostic(typeSpec);
          }
        }
      }
    },
  },

  /**
   * M4048: Expected component instance, but found class in cardinality().
   */
  cardinalityExpectedComponent: {
    nodes: ["function_call"],
    severity: "error",
    code: 4048,
    message: (target) => `Expected '${target.text}' to be a component instance, but found class instead.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const name = db.ast.getChildByFieldId(node, "name");
      if (name != 0 && db.ast.textEquals(name, "cardinality")) {
        for (const arg of db.ast.getDescendants(node, $.function_argument)) {
          const sym = db.scope.resolve(arg);
          if (sym != 0 && db.model.hasFlag(sym, "isClass")) {
            db.diagnostic(arg);
          }
          break;
        }
      }
    },
  },
};

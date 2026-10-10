// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CodeGraph, CompilerLint, u16, u32 } from "@modelscript/dsl";
import {
  classContainsElementRecursive,
  findClassByName,
  findComposition,
  findTargetElementInClass,
  getClassNameNode,
  getEnclosingClass,
  getExpressionVariability,
  getRedeclName,
  hasTypePrefix,
  isClassKind,
  isDescendantOfInnerClass,
  isDirectModificationChild,
  isElementFinal,
  isElementProtected,
  isElementReplaceable,
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
   * M4005-notification: Notification for modification of protected element.
   */
  protectedModificationNotification: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "info",
    code: 2097,
    message: () => `From here:`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const docRoot = db.ast.getRootNode();
      if (docRoot != 0 && $.string_literal != 0) {
        for (const str of db.ast.getDescendants(docRoot, $.string_literal)) {
          if (db.ast.textEquals(str, '"-d=-newInst"') || db.ast.textEquals(str, "-d=-newInst")) {
            return;
          }
        }
      }

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
        if (type == $.component_clause1 || type == $.component_clause) {
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
        if (!isDirectModificationChild(db, mod, node, $)) continue;
        let nameNode = db.ast.getChildByFieldId(mod, "name");
        if (nameNode == 0) {
          for (const n of db.ast.getDescendants(mod, $.name)) {
            nameNode = n;
            break;
          }
        }
        if (nameNode == 0) continue;
        const targetEl = findTargetElementInClass(db, targetClass, nameNode, $);
        if (targetEl != 0 && isElementProtected(db, targetEl, $)) {
          db.diagnostic(mod);
          return;
        }
      }
    },
  },

  /**
   * M4005: Protected element may not be modified from outside.
   */
  protectedModification: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "error",
    code: 4005,
    message: (target, elementName, modText) => {
      const eName = elementName && elementName.text !== "0" && elementName.text !== "" ? elementName.text : target.text;
      const mText = modText && modText.text !== "0" && modText.text !== "" ? modText.text : target.text;
      return `Protected element '${eName}' may not be modified, got '${mText}'.`;
    },
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const docRoot = db.ast.getRootNode();
      if (docRoot != 0 && $.string_literal != 0) {
        for (const str of db.ast.getDescendants(docRoot, $.string_literal)) {
          if (db.ast.textEquals(str, '"-d=-newInst"') || db.ast.textEquals(str, "-d=-newInst")) {
            return;
          }
        }
      }

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
        if (type == $.component_clause1 || type == $.component_clause) {
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
        if (!isDirectModificationChild(db, mod, node, $)) continue;
        let nameNode = db.ast.getChildByFieldId(mod, "name");
        if (nameNode == 0) {
          for (const n of db.ast.getDescendants(mod, $.name)) {
            nameNode = n;
            break;
          }
        }
        if (nameNode == 0) continue;
        const targetEl = findTargetElementInClass(db, targetClass, nameNode, $);
        if (targetEl != 0 && isElementProtected(db, targetEl, $)) {
          db.diagnostic(targetEl, nameNode, mod);
          return;
        }
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
    severity: "error",
    code: 4007,
    message: (node, varName) =>
      `Invalid public variable ${varName && varName.text ? varName.text : node.text}, function variables that are not input/output must be protected.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(cls) == $.class_definition) {
          if (isClassKind(db, cls, "function")) {
            if (!isElementProtected(db, node, $)) {
              const isIO = hasTypePrefix(db, node, "input", $) || hasTypePrefix(db, node, "output", $);
              if (!isIO) {
                let varId: u32 = 0;
                for (const decl of db.ast.getDescendants(node, $.declaration)) {
                  for (const id of db.ast.getDescendants(decl, $.identifier)) {
                    varId = id;
                    break;
                  }
                  if (varId != 0) break;
                }
                db.diagnostic(node, varId);
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
    message: (node, varName) =>
      `Invalid protected variable ${varName && varName.text ? varName.text : node.text}, function variables that are input/output must be public.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(cls) == $.class_definition) {
          if (isClassKind(db, cls, "function")) {
            if (isElementProtected(db, node, $)) {
              if (hasTypePrefix(db, node, "input", $) || hasTypePrefix(db, node, "output", $)) {
                let varId: u32 = 0;
                for (const decl of db.ast.getDescendants(node, $.declaration)) {
                  for (const id of db.ast.getDescendants(decl, $.identifier)) {
                    varId = id;
                    break;
                  }
                  if (varId != 0) break;
                }
                db.diagnostic(node, varId);
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
      let outerWhen: u32 = 0;
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (anc != node && (db.ast.getType(anc) == $.when_statement || db.ast.getType(anc) == $.when_equation)) {
          outerWhen = anc;
        }
      }
      if (outerWhen != 0) {
        let isOldFrontend: u32 = 0;
        const docRoot = db.ast.getRootNode();
        if (docRoot != 0 && $.string_literal != 0) {
          for (const str of db.ast.getDescendants(docRoot, $.string_literal)) {
            if (db.ast.textEquals(str, '"-d=-newInst"') || db.ast.textEquals(str, "-d=-newInst")) {
              isOldFrontend = 1;
              break;
            }
          }
        }
        db.diagnostic(isOldFrontend ? outerWhen : node);
        return;
      }
    },
  },

  /**
   * M4014: Tuple expressions only allowed on LHS of assignment/equation or cannot be subscripted.
   */
  tupleExpressionContext: {
    nodes: ["output_expression_list"],
    severity: "error",
    code: 4014,
    message: (target, subNode) => {
      if (subNode && subNode.text && subNode.text.startsWith("[")) {
        return "Tuple expression can not be subscripted.";
      }
      const exprText = subNode && subNode.text ? subNode.text : target ? target.text : "";
      return `Tuple expressions may only occur on the left side of an assignment or equation with a single function call on the right side.${
        exprText
          ? ` Got the following expression: (${exprText
              .split(",")
              .map((s: string) => s.trim())
              .join(", ")}).`
          : ""
      }`;
    },
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const anc of db.ast.getAncestors(node, $.primary)) {
        for (const sub of db.ast.getDescendants(anc, $.array_subscripts)) {
          if (sub != 0) {
            db.diagnostic(anc, sub);
            return;
          }
        }
      }
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.statement || db.ast.getType(anc) == $.equation_or_procedure) {
          return;
        }
      }
      let diagNode = node;
      for (const anc of db.ast.getAncestors(node, 0)) {
        const t = db.ast.getType(anc);
        if (t == $.component_clause || t == $.statement || t == $.equation) {
          diagNode = anc;
          break;
        }
      }
      for (const el of db.ast.getDescendants(diagNode, $.output_expression_list)) {
        if (el != node) return;
        break;
      }
      db.diagnostic(diagNode, node);
    },
  },

  /**
   * M4017: Restriction violation (e.g. equations or algorithms in record, type, package, connector, function).
   */
  restrictionViolation: {
    nodes: ["equation_section", "algorithm_section"],
    severity: "error",
    code: 4017,
    message: (_target, isAlgNode, isInitialNode, kindNode) => {
      const isAlg = isAlgNode != null && isAlgNode.asNumber() == 1;
      const isInitial = isInitialNode != null && isInitialNode.asNumber() == 1;
      const kind = kindNode != null ? kindNode.asNumber() : 1;
      if (kind == 5) {
        if (isInitial) {
          return isAlg
            ? "Initial algorithm sections are not allowed in function."
            : "Initial equation sections are not allowed in function.";
        }
        return "Equations are not allowed in function.";
      }
      const kindStr = kind == 1 ? "record" : kind == 2 ? "type" : kind == 3 ? "package" : "connector";
      return isAlg ? `Algorithm sections are not allowed in ${kindStr}.` : `Equations are not allowed in ${kindStr}.`;
    },
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(cls) == $.class_definition) {
          let kind = 0;
          if (isClassKind(db, cls, "record")) kind = 1;
          else if (isClassKind(db, cls, "type")) kind = 2;
          else if (isClassKind(db, cls, "package")) kind = 3;
          else if (isClassKind(db, cls, "connector")) kind = 4;
          else if (isClassKind(db, cls, "function")) kind = 5;

          if (kind != 0) {
            const isAlg = db.ast.getType(node) == $.algorithm_section ? 1 : 0;
            let isInitial = 0;
            let ch = db.ast.getFirstChild(node);
            while (ch != 0) {
              if (db.ast.textEquals(ch, "initial")) {
                isInitial = 1;
                break;
              }
              ch = db.ast.getNextSibling(ch);
            }

            // Normal algorithm sections are allowed in functions!
            if (kind == 5 && isAlg == 1 && isInitial == 0) {
              break;
            }

            let targetNode = node;
            if (isAlg != 0 && $.statement != 0) {
              for (const stmt of db.ast.getDescendants(node, $.statement)) {
                targetNode = stmt;
                break;
              }
            } else if (isAlg == 0 && $.some_equation != 0) {
              for (const eq of db.ast.getDescendants(node, $.some_equation)) {
                targetNode = eq;
                break;
              }
            }
            db.diagnostic(targetNode, isAlg, isInitial, kind);
          }
          break;
        }
      }
    },
  },

  /**
   * M4019-notification: Notification for redeclaration of non-replaceable element.
   */
  redeclareNonReplaceableNotification: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "info",
    code: 2096,
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
        if (!isDirectModificationChild(db, redecl, node, $)) continue;
        const redeclName = getRedeclName(db, redecl, $);
        if (redeclName == 0) continue;
        const targetEl = findTargetElementInClass(db, targetClass, redeclName, $);
        if (targetEl != 0 && !isElementReplaceable(db, targetEl, $)) {
          let redeclType: u32 = 0;
          for (const t of db.ast.getDescendants(redecl, $.type_specifier)) {
            redeclType = t;
            break;
          }
          let targetType: u32 = 0;
          for (const t of db.ast.getDescendants(targetEl, $.type_specifier)) {
            targetType = t;
            break;
          }
          if (redeclType != 0 && targetType != 0 && db.ast.textEqualsNode(redeclType, targetType)) {
            continue;
          }
          db.diagnostic(parentDecl != 0 ? parentDecl : compDecl != 0 ? compDecl : redecl);
          return;
        }
      }
      for (const redecl of db.ast.getDescendants(node, $.element_replaceable)) {
        if (!isDirectModificationChild(db, redecl, node, $)) continue;
        const redeclName = getRedeclName(db, redecl, $);
        if (redeclName == 0) continue;
        const targetEl = findTargetElementInClass(db, targetClass, redeclName, $);
        if (targetEl != 0 && !isElementReplaceable(db, targetEl, $)) {
          let redeclType: u32 = 0;
          for (const t of db.ast.getDescendants(redecl, $.type_specifier)) {
            redeclType = t;
            break;
          }
          let targetType: u32 = 0;
          for (const t of db.ast.getDescendants(targetEl, $.type_specifier)) {
            targetType = t;
            break;
          }
          if (redeclType != 0 && targetType != 0 && db.ast.textEqualsNode(redeclType, targetType)) {
            continue;
          }
          db.diagnostic(parentDecl != 0 ? parentDecl : compDecl != 0 ? compDecl : redecl);
          return;
        }
      }
    },
  },

  /**
   * M4019: Redeclaration with a new type requires element to be replaceable.
   */
  redeclareNonReplaceable: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "error",
    code: 4019,
    message: (target, elementName) => {
      const eName = elementName && elementName.text !== "0" && elementName.text !== "" ? elementName.text : target.text;
      return `Redeclaration with a new type requires '${eName}' to be replaceable.`;
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
        if (!isDirectModificationChild(db, redecl, node, $)) continue;
        const redeclName = getRedeclName(db, redecl, $);
        if (redeclName == 0) continue;
        const targetEl = findTargetElementInClass(db, targetClass, redeclName, $);
        const isRepl = isElementReplaceable(db, targetEl, $);
        if (targetEl != 0 && !isRepl) {
          let redeclType: u32 = 0;
          for (const t of db.ast.getDescendants(redecl, $.type_specifier)) {
            redeclType = t;
            break;
          }
          let targetType: u32 = 0;
          for (const t of db.ast.getDescendants(targetEl, $.type_specifier)) {
            targetType = t;
            break;
          }
          if (redeclType != 0 && targetType != 0 && db.ast.textEqualsNode(redeclType, targetType)) {
            continue;
          }
          db.diagnostic(targetEl, redeclName);
          return;
        }
      }
      for (const redecl of db.ast.getDescendants(node, $.element_replaceable)) {
        if (!isDirectModificationChild(db, redecl, node, $)) continue;
        const redeclName = getRedeclName(db, redecl, $);
        if (redeclName == 0) continue;
        const targetEl = findTargetElementInClass(db, targetClass, redeclName, $);
        if (targetEl != 0 && !isElementReplaceable(db, targetEl, $)) {
          let redeclType: u32 = 0;
          for (const t of db.ast.getDescendants(redecl, $.type_specifier)) {
            redeclType = t;
            break;
          }
          let targetType: u32 = 0;
          for (const t of db.ast.getDescendants(targetEl, $.type_specifier)) {
            targetType = t;
            break;
          }
          if (redeclType != 0 && targetType != 0 && db.ast.textEqualsNode(redeclType, targetType)) {
            continue;
          }
          db.diagnostic(targetEl, redeclName);
          return;
        }
      }
    },
  },

  /**
   * M4068: Invalid redeclaration of element, a redeclare may not have a condition attribute.
   */
  redeclareConditionAttribute: {
    nodes: ["condition_attribute"],
    severity: "error",
    code: 4068,
    message: (target, elementName) => {
      const eName = elementName && elementName.text !== "0" && elementName.text !== "" ? elementName.text : target.text;
      return `Invalid redeclaration of ${eName}, a redeclare may not have a condition attribute.`;
    },
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const compDecl of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(compDecl) == $.component_declaration) {
          for (const anc of db.ast.getAncestors(compDecl, 0)) {
            const t = db.ast.getType(anc);
            if (t == $.element_redeclaration) {
              let nameNode: u32 = 0;
              for (const id of db.ast.getDescendants(compDecl, $.identifier)) {
                nameNode = id;
                break;
              }
              db.diagnostic(anc, nameNode);
              return;
            } else if (t == $.element) {
              let hasRedecl = false;
              if (db.ast.startsWith(anc, "redeclare")) {
                hasRedecl = true;
              } else {
                let ch = db.ast.getFirstChild(anc);
                while (ch != 0) {
                  if (db.ast.startsWith(ch, "redeclare") || db.ast.textEquals(ch, "redeclare")) {
                    hasRedecl = true;
                    break;
                  }
                  ch = db.ast.getNextSibling(ch);
                }
              }
              if (hasRedecl) {
                let nameNode: u32 = 0;
                for (const id of db.ast.getDescendants(compDecl, $.identifier)) {
                  nameNode = id;
                  break;
                }
                db.diagnostic(anc, nameNode);
                return;
              }
            }
          }
          break;
        }
      }
    },
  },

  /**
   * M4063: Invalid redeclaration of class, class extends only allowed on inherited classes.
   */
  classExtendsNonInherited: {
    nodes: ["element"],
    severity: "error",
    code: 4063,
    message: (target, elementName) => {
      const eName = elementName && elementName.text !== "0" && elementName.text !== "" ? elementName.text : target.text;
      return `Base class targeted by class extends ${eName} not found in the inherited classes.`;
    },
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let hasRedeclare = false;
      if (db.ast.startsWith(node, "redeclare")) {
        hasRedeclare = true;
      } else {
        let ch = db.ast.getFirstChild(node);
        while (ch != 0) {
          if (db.ast.startsWith(ch, "redeclare") || db.ast.textEquals(ch, "redeclare")) {
            hasRedeclare = true;
            break;
          }
          ch = db.ast.getNextSibling(ch);
        }
      }
      if (!hasRedeclare) return;

      const enclosingClass = getEnclosingClass(db, node, $);
      if (enclosingClass == 0) return;

      let classDef: u32 = 0;
      for (const cd of db.ast.getDescendants(node, $.class_definition)) {
        classDef = cd;
        break;
      }
      if (classDef == 0) return;

      let isClassExtends = false;
      let redeclNameNode: u32 = 0;
      for (const spec of db.ast.getDescendants(classDef, $.long_class_specifier)) {
        let sch = db.ast.getFirstChild(spec);
        while (sch != 0) {
          if (db.ast.startsWith(sch, "extends") || db.ast.textEquals(sch, "extends")) {
            isClassExtends = true;
            break;
          }
          sch = db.ast.getNextSibling(sch);
        }
        if (isClassExtends) {
          redeclNameNode = db.ast.getChildByFieldId(spec, "name");
          break;
        }
      }
      if (!isClassExtends || redeclNameNode == 0) return;

      let isInherited = false;
      const comp = findComposition(db, enclosingClass, $);
      const searchRoot = comp != 0 ? comp : enclosingClass;
      for (const ext of db.ast.getDescendants(searchRoot, $.extends_clause)) {
        if (isDescendantOfInnerClass(db, ext, enclosingClass, $)) continue;
        for (const ts of db.ast.getDescendants(ext, $.type_specifier)) {
          const baseClass = findClassByName(db, ts, $);
          if (baseClass != 0) {
            if (classContainsElementRecursive(db, baseClass, redeclNameNode, $, 0)) {
              isInherited = true;
              break;
            }
          }
        }
        if (isInherited) break;
      }

      if (!isInherited) {
        db.diagnostic(classDef, redeclNameNode);
      }
    },
  },

  /**
   * M4061: Illegal redeclare of element, no inherited element with that name exists.
   */
  redeclareNonInherited: {
    nodes: ["element"],
    severity: "error",
    code: 4061,
    message: (target, elementName) => {
      const eName = elementName && elementName.text !== "0" && elementName.text !== "" ? elementName.text : target.text;
      return `Illegal redeclare of element ${eName}, no inherited element with that name exists.`;
    },
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let hasRedeclare = false;
      if (db.ast.startsWith(node, "redeclare")) {
        hasRedeclare = true;
      } else {
        let ch = db.ast.getFirstChild(node);
        while (ch != 0) {
          if (db.ast.startsWith(ch, "redeclare") || db.ast.textEquals(ch, "redeclare")) {
            hasRedeclare = true;
            break;
          }
          ch = db.ast.getNextSibling(ch);
        }
      }
      if (!hasRedeclare) return;

      const enclosingClass = getEnclosingClass(db, node, $);
      if (enclosingClass == 0) return;

      let redeclNameNode: u32 = 0;
      let targetDiagNode: u32 = node;

      let classDef: u32 = 0;
      for (const cd of db.ast.getDescendants(node, $.class_definition)) {
        classDef = cd;
        break;
      }
      if (classDef != 0) {
        for (const spec of db.ast.getDescendants(classDef, $.long_class_specifier)) {
          let sch = db.ast.getFirstChild(spec);
          while (sch != 0) {
            if (db.ast.startsWith(sch, "extends") || db.ast.textEquals(sch, "extends")) {
              return;
            }
            sch = db.ast.getNextSibling(sch);
          }
          const n = db.ast.getChildByFieldId(spec, "name");
          if (n != 0) {
            redeclNameNode = n;
            break;
          }
        }
        if (redeclNameNode == 0) {
          for (const spec of db.ast.getDescendants(classDef, $.short_class_specifier)) {
            const n = db.ast.getChildByFieldId(spec, "name");
            if (n != 0) {
              redeclNameNode = n;
              break;
            }
          }
        }
        targetDiagNode = classDef;
      } else {
        for (const cd of db.ast.getDescendants(node, $.component_declaration)) {
          for (const id of db.ast.getDescendants(cd, $.identifier)) {
            redeclNameNode = id;
            break;
          }
          if (redeclNameNode != 0) break;
        }
        if (redeclNameNode == 0) {
          for (const cd of db.ast.getDescendants(node, $.component_declaration1)) {
            for (const id of db.ast.getDescendants(cd, $.identifier)) {
              redeclNameNode = id;
              break;
            }
            if (redeclNameNode != 0) break;
          }
        }
        targetDiagNode = node;
      }

      if (redeclNameNode == 0) return;

      let isInherited = false;
      const comp = findComposition(db, enclosingClass, $);
      const searchRoot = comp != 0 ? comp : enclosingClass;
      for (const ext of db.ast.getDescendants(searchRoot, $.extends_clause)) {
        if (isDescendantOfInnerClass(db, ext, enclosingClass, $)) continue;
        for (const ts of db.ast.getDescendants(ext, $.type_specifier)) {
          const baseClass = findClassByName(db, ts, $);
          if (baseClass != 0) {
            if (classContainsElementRecursive(db, baseClass, redeclNameNode, $, 0)) {
              isInherited = true;
              break;
            }
          }
        }
        if (isInherited) break;
      }

      if (!isInherited) {
        db.diagnostic(targetDiagNode, redeclNameNode);
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
    message: () => `Connect equations are not allowed in initial equation sections.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.equation_section) {
          const firstChild = db.ast.getFirstChild(anc);
          if (firstChild != 0 && db.ast.textEquals(firstChild, "initial")) {
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
        if (!isDirectModificationChild(db, redecl, node, $)) continue;
        const redeclName = getRedeclName(db, redecl, $);
        if (redeclName == 0) continue;
        const targetEl = findTargetElementInClass(db, targetClass, redeclName, $);
        if (targetEl != 0 && isElementFinal(db, targetEl, $)) {
          db.diagnostic(parentDecl != 0 ? parentDecl : compDecl != 0 ? compDecl : redecl);
          return;
        }
      }
      for (const redecl of db.ast.getDescendants(node, $.element_replaceable)) {
        if (!isDirectModificationChild(db, redecl, node, $)) continue;
        const redeclName = getRedeclName(db, redecl, $);
        if (redeclName == 0) continue;
        const targetEl = findTargetElementInClass(db, targetClass, redeclName, $);
        if (targetEl != 0 && isElementFinal(db, targetEl, $)) {
          db.diagnostic(parentDecl != 0 ? parentDecl : compDecl != 0 ? compDecl : redecl);
          return;
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
        if (!isDirectModificationChild(db, redecl, node, $)) continue;
        const redeclName = getRedeclName(db, redecl, $);
        if (redeclName == 0) continue;
        const targetEl = findTargetElementInClass(db, targetClass, redeclName, $);
        if (targetEl != 0 && isElementFinal(db, targetEl, $)) {
          db.diagnostic(targetEl, redeclName);
          return;
        }
      }
      for (const redecl of db.ast.getDescendants(node, $.element_replaceable)) {
        if (!isDirectModificationChild(db, redecl, node, $)) continue;
        const redeclName = getRedeclName(db, redecl, $);
        if (redeclName == 0) continue;
        const targetEl = findTargetElementInClass(db, targetClass, redeclName, $);
        if (targetEl != 0 && isElementFinal(db, targetEl, $)) {
          db.diagnostic(targetEl, redeclName);
          return;
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
        if (!isDirectModificationChild(db, redecl, node, $)) continue;
        const redeclName = getRedeclName(db, redecl, $);
        if (redeclName == 0) continue;
        const targetEl = findTargetElementInClass(db, targetClass, redeclName, $);
        if (targetEl != 0 && hasTypePrefix(db, targetEl, "constant", $) && !isElementReplaceable(db, targetEl, $)) {
          db.diagnostic(parentDecl != 0 ? parentDecl : compDecl != 0 ? compDecl : redecl);
          return;
        }
      }
      for (const redecl of db.ast.getDescendants(node, $.element_replaceable)) {
        if (!isDirectModificationChild(db, redecl, node, $)) continue;
        const redeclName = getRedeclName(db, redecl, $);
        if (redeclName == 0) continue;
        const targetEl = findTargetElementInClass(db, targetClass, redeclName, $);
        if (targetEl != 0 && hasTypePrefix(db, targetEl, "constant", $) && !isElementReplaceable(db, targetEl, $)) {
          db.diagnostic(parentDecl != 0 ? parentDecl : compDecl != 0 ? compDecl : redecl);
          return;
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
        if (!isDirectModificationChild(db, redecl, node, $)) continue;
        const redeclName = getRedeclName(db, redecl, $);
        if (redeclName == 0) continue;
        const targetEl = findTargetElementInClass(db, targetClass, redeclName, $);
        if (targetEl != 0 && hasTypePrefix(db, targetEl, "constant", $) && !isElementReplaceable(db, targetEl, $)) {
          db.diagnostic(targetEl, redeclName);
          return;
        }
      }
      for (const redecl of db.ast.getDescendants(node, $.element_replaceable)) {
        if (!isDirectModificationChild(db, redecl, node, $)) continue;
        const redeclName = getRedeclName(db, redecl, $);
        if (redeclName == 0) continue;
        const targetEl = findTargetElementInClass(db, targetClass, redeclName, $);
        if (targetEl != 0 && hasTypePrefix(db, targetEl, "constant", $) && !isElementReplaceable(db, targetEl, $)) {
          db.diagnostic(targetEl, redeclName);
          return;
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
    message: (_target, nameNode) => {
      const name = nameNode && nameNode.text !== "0" && nameNode.text !== "" ? nameNode.text : "";
      return `Function ${name} has more than one algorithm section or external declaration.`;
    },
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      if (!isClassKind(db, node, "function")) return;
      let isOldFrontend: u32 = 0;
      const docRoot = db.ast.getRootNode();
      if (docRoot != 0 && $.string_literal != 0) {
        for (const str of db.ast.getDescendants(docRoot, $.string_literal)) {
          if (db.ast.textEquals(str, '"-d=-newInst"') || db.ast.textEquals(str, "-d=-newInst")) {
            isOldFrontend = 1;
            break;
          }
        }
      }
      if (isOldFrontend) return;
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
      for (const extClause of db.ast.getDescendants(node, $.extends_clause)) {
        if (isDescendantOfInnerClass(db, extClause, node, $)) continue;
        for (const ts of db.ast.getDescendants(extClause, $.type_specifier)) {
          const baseClass = findClassByName(db, ts, $);
          if (baseClass != 0) {
            for (const sec of db.ast.getDescendants(baseClass, $.algorithm_section)) {
              if (sec != 0) {
                let directCls = 0;
                for (const anc of db.ast.getAncestors(sec, 0)) {
                  if (db.ast.getType(anc) == $.class_definition) {
                    directCls = anc;
                    break;
                  }
                }
                if (directCls == baseClass) {
                  count++;
                  break;
                }
              }
            }
            for (const ext of db.ast.getDescendants(baseClass, $.external_clause)) {
              if (ext != 0) {
                let directCls = 0;
                for (const anc of db.ast.getAncestors(ext, 0)) {
                  if (db.ast.getType(anc) == $.class_definition) {
                    directCls = anc;
                    break;
                  }
                }
                if (directCls == baseClass) {
                  count++;
                  break;
                }
              }
            }
          }
        }
      }
      if (count > 1) {
        const nameNode = getClassNameNode(db, node, $);
        db.diagnostic(node, nameNode != 0 ? nameNode : node);
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
      const docRoot = db.ast.getRootNode();
      if (docRoot != 0 && $.string_literal != 0) {
        for (const str of db.ast.getDescendants(docRoot, $.string_literal)) {
          if (db.ast.textEquals(str, '"-d=-newInst"') || db.ast.textEquals(str, "-d=-newInst")) {
            return;
          }
        }
      }
      let encClass: u32 = 0;
      let classCount = 0;
      for (const cls of db.ast.getAncestors(node, $.class_definition)) {
        if (classCount === 0) encClass = cls;
        classCount++;
        if (isClassKind(db, cls, "function")) return;
        if (isClassKind(db, cls, "partial")) return;
      }
      if (classCount > 1) return;

      for (const comp of db.ast.getAncestors(node, $.component_clause)) {
        for (const el of db.ast.getAncestors(comp, $.element)) {
          if (isElementReplaceable(db, el, $)) return;
        }
        let isPrimitive = false;
        if ($.type_specifier != 0) {
          for (const ts of db.ast.getDescendants(comp, $.type_specifier)) {
            for (const id of db.ast.getDescendants(ts, $.identifier)) {
              if (
                db.ast.textEquals(id, "Real") ||
                db.ast.textEquals(id, "Integer") ||
                db.ast.textEquals(id, "Boolean") ||
                db.ast.textEquals(id, "String")
              ) {
                isPrimitive = true;
              }
              break;
            }
            break;
          }
        }
        if (!isPrimitive) return;

        if (hasTypePrefix(db, comp, "constant", $)) {
          let hasMod = false;
          for (const mod of db.ast.getDescendants(node, $.modification)) {
            if (mod != 0) hasMod = true;
            break;
          }
          let nameId: u32 = 0;
          for (const id of db.ast.getDescendants(node, $.identifier)) {
            nameId = id;
            break;
          }
          if (!hasMod && encClass != 0 && nameId != 0 && $.equation_section != 0) {
            for (const eqSec of db.ast.getDescendants(encClass, $.equation_section)) {
              for (const eq of db.ast.getDescendants(eqSec, $.equation)) {
                let ch = db.ast.getFirstChild(eq);
                while (ch != 0) {
                  if (db.ast.textEquals(ch, "=")) break;
                  for (const id of db.ast.getDescendants(ch, $.identifier)) {
                    if (db.ast.textEqualsNode(id, nameId)) {
                      hasMod = true;
                      break;
                    }
                  }
                  if (hasMod) break;
                  ch = db.ast.getNextSibling(ch);
                }
                if (hasMod) break;
              }
              if (hasMod) break;
            }
          }
          if (!hasMod && nameId != 0 && docRoot != 0) {
            for (const elemMod of db.ast.getDescendants(docRoot, $.element_modification)) {
              for (const n of db.ast.getDescendants(elemMod, $.name)) {
                if (db.ast.textEqualsNode(n, nameId)) {
                  hasMod = true;
                  break;
                }
              }
              if (hasMod) break;
            }
          }
          if (!hasMod) {
            db.diagnostic(node);
          }
        }
        break;
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
              for (const conn of db.ast.getDescendants(anc, $.connect_equation)) {
                if (conn === node) {
                  db.diagnostic(node);
                }
                return;
              }
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

  /**
   * M4064: Protected sections are not allowed in connector.
   */
  protectedInConnector: {
    nodes: ["composition"],
    severity: "error",
    code: 4064,
    message: (_target, kindNode) => {
      const k = kindNode != null ? kindNode.asNumber() : 0;
      const kindStr = k == 1 ? "record" : k == 2 ? "type" : "connector";
      return `Protected sections are not allowed in ${kindStr}.`;
    },
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const encClass = getEnclosingClass(db, node, $);
      if (encClass != 0) {
        let kindNum = 0;
        if (isClassKind(db, encClass, "connector")) kindNum = 0;
        else if (isClassKind(db, encClass, "record")) {
          let isOldFrontend: u32 = 0;
          const docRoot = db.ast.getRootNode();
          if (docRoot != 0 && $.string_literal != 0) {
            for (const str of db.ast.getDescendants(docRoot, $.string_literal)) {
              if (db.ast.textEquals(str, '"-d=-newInst"') || db.ast.textEquals(str, "-d=-newInst")) {
                isOldFrontend = 1;
                break;
              }
            }
          }
          if (isOldFrontend) return;
          kindNum = 1;
        } else if (isClassKind(db, encClass, "type")) kindNum = 2;
        else return;

        let ch = db.ast.getFirstChild(node);
        while (ch != 0) {
          if (db.ast.textEquals(ch, "protected") || db.ast.startsWith(ch, "protected")) {
            db.diagnostic(ch, kindNum);
          }
          ch = db.ast.getNextSibling(ch);
        }
      }
    },
  },

  /**
   * M4065: Equations are not allowed in connector.
   */
  equationInConnector: {
    nodes: ["equation_section"],
    severity: "error",
    code: 4065,
    message: () => `Equations are not allowed in connector.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const encClass = getEnclosingClass(db, node, $);
      if (encClass != 0 && isClassKind(db, encClass, "connector")) {
        let firstEq: u32 = 0;
        if ($.some_equation != 0) {
          for (const eq of db.ast.getDescendants(node, $.some_equation)) {
            firstEq = eq;
            break;
          }
        }
        db.diagnostic(firstEq != 0 ? firstEq : node);
      }
    },
  },

  /**
   * M4066: Algorithm sections are not allowed in connector.
   */
  algorithmInConnector: {
    nodes: ["algorithm_section"],
    severity: "error",
    code: 4066,
    message: () => `Algorithm sections are not allowed in connector.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const encClass = getEnclosingClass(db, node, $);
      if (encClass != 0 && isClassKind(db, encClass, "connector")) {
        let firstStmt: u32 = 0;
        if ($.statement != 0) {
          for (const stmt of db.ast.getDescendants(node, $.statement)) {
            firstStmt = stmt;
            break;
          }
        }
        db.diagnostic(firstStmt != 0 ? firstStmt : node);
      }
    },
  },

  /**
   * M5017: A when-statement may not be used inside a function or a while, if, or for-clause.
   */
  whenIllegalContext: {
    nodes: ["when_statement"],
    severity: "error",
    code: 5017,
    message: () => `A when-statement may not be used inside a function or a while, if, or for-clause.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (anc != node && (db.ast.getType(anc) == $.when_statement || db.ast.getType(anc) == $.when_equation)) {
          return;
        }
      }
      let isIllegal = false;
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (anc == node) continue;
        const t = db.ast.getType(anc);
        if (
          ($.if_statement != 0 && t == $.if_statement) ||
          ($.for_statement != 0 && t == $.for_statement) ||
          ($.while_statement != 0 && t == $.while_statement)
        ) {
          isIllegal = true;
          break;
        }
        if (t == $.class_definition) {
          if (isClassKind(db, anc, "function")) {
            isIllegal = true;
          }
          break;
        }
      }
      if (isIllegal) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M4040: 'return' may not be used outside function.
   */
  returnOutsideFunction: {
    nodes: ["statement"],
    severity: "error",
    code: 4079,
    message: () => `'return' may not be used outside function.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let isReturn = false;
      let ch = db.ast.getFirstChild(node);
      while (ch != 0) {
        if (db.ast.textEquals(ch, "return")) {
          isReturn = true;
          break;
        }
        ch = db.ast.getNextSibling(ch);
      }
      if (!isReturn) return;

      let isInsideFunction = false;
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.class_definition) {
          if (isClassKind(db, anc, "function")) {
            isInsideFunction = true;
          }
          break;
        }
      }
      if (!isInsideFunction) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M4020: time is not allowed in a function.
   */
  timeInFunction: {
    nodes: ["primary"],
    severity: "error",
    code: 4020,
    message: () => `time is not allowed in a function.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      if (!db.ast.textEquals(node, "time")) return;
      let inDecl = false;
      let inRedecl = false;
      for (const anc of db.ast.getAncestors(node, 0)) {
        const type = db.ast.getType(anc);
        if (type == $.element_redeclaration) inRedecl = true;
        if (type == $.component_clause || type == $.component_declaration) inDecl = true;
        if (type == $.class_definition) {
          if (isClassKind(db, anc, "function")) {
            if (inDecl && !inRedecl) return;
            let targetNode = node;
            for (const p of db.ast.getAncestors(node, 0)) {
              if (db.ast.getType(p) == $.element_redeclaration) {
                targetNode = p;
                break;
              }
              if (db.ast.getType(p) == $.class_definition) break;
            }
            db.diagnostic(targetNode);
          }
          break;
        }
      }
    },
  },

  /**
   * M4078: terminate is not allowed in a function.
   */
  terminateInFunction: {
    nodes: ["function_call"],
    severity: "error",
    code: 4078,
    message: () => `terminate is not allowed in a function.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let isTerminate = false;
      let nameNode = db.ast.getChildByFieldId(node, "name");
      if (nameNode != 0 && db.ast.textEquals(nameNode, "terminate")) {
        isTerminate = true;
      }
      if (!isTerminate) {
        let first = db.ast.getFirstChild(node);
        if (first != 0 && db.ast.textEquals(first, "terminate")) {
          isTerminate = true;
        }
      }
      if (!isTerminate) return;

      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.class_definition) {
          if (isClassKind(db, anc, "function")) {
            let targetNode = node;
            for (const stmt of db.ast.getAncestors(node, 0)) {
              if (db.ast.getType(stmt) == $.statement) {
                targetNode = stmt;
                break;
              }
            }
            db.diagnostic(targetNode);
          }
          break;
        }
      }
    },
  },

  /**
   * M4041: Negative dimension index.
   */
  negativeDimension: {
    nodes: ["component_declaration", "component_declaration1"],
    severity: "error",
    code: 4041,
    message: (_target, dimNode, nameNode) => {
      const dim = dimNode && dimNode.text ? dimNode.text : "-1";
      const name = nameNode && nameNode.text ? nameNode.text : "component";
      return `Negative dimension index (${dim}) for component ${name}.`;
    },
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      if ($.array_subscripts == 0 || $.subscript == 0) return;
      let subsNode: u32 = 0;
      for (const s of db.ast.getDescendants(node, $.array_subscripts)) {
        subsNode = s;
        break;
      }
      if (subsNode == 0) {
        for (const anc of db.ast.getAncestors(node, 0)) {
          if (db.ast.getType(anc) == $.component_clause) {
            for (const s of db.ast.getDescendants(anc, $.array_subscripts)) {
              subsNode = s;
              break;
            }
            break;
          }
        }
      }
      if (subsNode == 0) return;

      for (const sub of db.ast.getDescendants(subsNode, $.subscript)) {
        if (db.ast.startsWith(sub, "-")) {
          let nameNode: u32 = 0;
          for (const decl of db.ast.getDescendants(node, $.declaration)) {
            for (const id of db.ast.getDescendants(decl, $.identifier)) {
              nameNode = id;
              break;
            }
            if (nameNode != 0) break;
          }
          if (nameNode == 0) {
            for (const id of db.ast.getDescendants(node, $.identifier)) {
              nameNode = id;
              break;
            }
          }
          let targetNode = node;
          for (const anc of db.ast.getAncestors(node, 0)) {
            if (db.ast.getType(anc) == $.component_clause) {
              targetNode = anc;
              break;
            }
          }
          db.diagnostic(targetNode, sub, nameNode);
          return;
        }
      }
    },
  },

  /**
   * M4070: Class specialization violation: external declaration not allowed outside function.
   */
  externalNonFunction: {
    nodes: ["external_clause"],
    severity: "error",
    code: 4070,
    message: (_target, nameNode, kindCode) => {
      const name = nameNode && nameNode.text !== "0" && nameNode.text !== "" ? nameNode.text : "";
      const k = kindCode != null ? kindCode.asNumber() : 0;
      const kindStr =
        k == 1
          ? "model"
          : k == 2
            ? "record"
            : k == 3
              ? "block"
              : k == 4
                ? "connector"
                : k == 5
                  ? "package"
                  : k == 6
                    ? "type"
                    : "class";
      return `Class specialization violation: ${name} is a ${kindStr}, which may not contain an external declaration.`;
    },
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.class_definition) {
          if (!isClassKind(db, anc, "function")) {
            const nameNode = getClassNameNode(db, anc, $);
            let k = 7;
            if (isClassKind(db, anc, "model")) k = 1;
            else if (isClassKind(db, anc, "record")) k = 2;
            else if (isClassKind(db, anc, "block")) k = 3;
            else if (isClassKind(db, anc, "connector")) k = 4;
            else if (isClassKind(db, anc, "package")) k = 5;
            else if (isClassKind(db, anc, "type")) k = 6;
            db.diagnostic(anc, nameNode != 0 ? nameNode : anc, k);
          }
          break;
        }
      }
    },
  },
};

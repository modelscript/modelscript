// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module lints/syntax-placement
 *
 * CST-level linter rules for Modelica syntactic restrictions, element placement,
 * specialized class constraints (`record`, `connector`, `package`, `type`, `function`),
 * `final`/`protected`/`replaceable` modification rules, and statement context checks
 * (MLS §4, §7, §8, §9, §10, §11, §12).
 */

import type { CodeGraph, CompilerLint, u32 } from "@modelscript/dsl";
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
  isCardinalityClassArg,
  isClassKind,
  isDescendantOfInnerClass,
  isDirectModificationChild,
  isElementFinal,
  isElementProtected,
  isElementReplaceable,
  isEnumStepRangeExpr,
  isIgnoreReplaceableActive,
  isOldFrontendActive,
  isPartialTypeComponentInScope,
  VARIABILITY_CONTINUOUS,
} from "./helpers.js";

/**
 * Compiler lint rules enforcing syntactic placement, specialized class restrictions, and modification legality.
 */
export const modelicaSyntaxLints: Record<string, CompilerLint> = {
  /**
   * M1003: Empty array constructors (`[]` or `{}`) are not valid in Modelica (MLS §10.4).
   *
   * Empty arrays must be constructed with `fill(..., 0)` so their element type is known.
   */
  emptyArrayConstructor: {
    nodes: ["primary"],
    severity: "error",
    code: 1003,
    message: (target) => `Empty array constructor '${target.text}' is not valid in Modelica.`,
    query: (db: CodeGraph, node: u32) => {
      // Flag literal `[]` or `{}` primary expressions
      if (db.ast.textEquals(node, "[]") || db.ast.textEquals(node, "{}")) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M2005: Identifier at start and end of a long class definition must match (MLS §4.5).
   */
  identifierMismatch: {
    nodes: ["long_class_specifier"],
    severity: "error",
    code: 2005,
    message: () => `Parse error: The identifier at start and end are different`,
    query: (db: CodeGraph, node: u32) => {
      // Compare the class header `name` and trailing `end <end_name>` identifiers
      const startId = db.ast.getChildByFieldId(node, "name");
      const endId = db.ast.getChildByFieldId(node, "end_name");
      if (startId != 0 && endId != 0) {
        if (!db.ast.textEqualsNode(startId, endId)) {
          db.diagnostic(node);
        }
      }
    },
  },

  /**
   * M2097 (M4005-notification): Companion `From here:` location note for modification of a protected element (MLS §4.1, §7.2).
   */
  protectedModificationNotification: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "info",
    code: 2097,
    message: () => `From here:`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Emit source-location note at the modifier site when a protected member is modified externally
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
   * M4005: Protected element may not be modified from outside its class or inheritance hierarchy (MLS §4.1, §7.2).
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
    query: (db: CodeGraph, node: u32, $: any) => {
      // Check component modifications (excluding `extends` modifications) for protected target members
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
   * M4006: Function cannot have both `external` and `algorithm` sections (MLS §12.9).
   */
  externalWithAlgorithm: {
    nodes: ["external_clause"],
    severity: "error",
    code: 4006,
    message: (target) => `Element '${target.text}' is not allowed in function context with algorithm section.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Check if the enclosing class definition also contains an `algorithm_section`
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
   * M4007: Non-input/output variable declared in public section of a function (MLS §12.2).
   *
   * Local auxiliary variables in a `function` must be declared inside a `protected` section.
   */
  functionPublicVariable: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4007,
    message: (node, varName) =>
      `Invalid public variable ${varName && varName.text ? varName.text : node.text}, function variables that are not input/output must be protected.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      if (isOldFrontendActive(db, $)) return;
      // Flag public component declarations in functions that lack `input`, `output`, or `constant`
      for (const cls of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(cls) == $.class_definition) {
          if (isClassKind(db, cls, "function")) {
            if (!isElementProtected(db, node, $)) {
              const isIO =
                hasTypePrefix(db, node, "input", $) ||
                hasTypePrefix(db, node, "output", $) ||
                hasTypePrefix(db, node, "constant", $);
              if (!isIO) {
                let varId: u32 = 0;
                for (const decl of db.ast.getDescendants(node, $.declaration)) {
                  for (const id of db.ast.getDescendants(decl, $.identifier)) {
                    varId = id;
                    break;
                  }
                  if (varId != 0) break;
                }
                db.diagnostic(varId != 0 ? varId : node, varId);
              }
            }
          }
          break;
        }
      }
    },
  },

  /**
   * M4011: Function formal parameters (`input`/`output`) must be public (MLS §12.2).
   */
  functionProtectedIO: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4011,
    message: (node, varName) =>
      `Invalid protected variable ${varName && varName.text ? varName.text : node.text}, function variables that are input/output must be public.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Disallow `input` or `output` causality prefixes inside a function's `protected` section
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
                db.diagnostic(varId != 0 ? varId : node, varId);
              }
            }
          }
          break;
        }
      }
    },
  },

  /**
   * M4013: Nested `when` equations or statements are forbidden (MLS §8.3.5, §11.2.7).
   */
  nestedWhen: {
    nodes: ["when_statement", "when_equation"],
    severity: "error",
    code: 4013,
    message: () => `Nested when statements are not allowed.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Check if any ancestor of `node` is another `when_statement` or `when_equation`
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
   * M4014: Tuple expressions are only allowed on the LHS of an assignment/equation and cannot be subscripted (MLS §8.3.1, §11.2.1.1).
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
    query: (db: CodeGraph, node: u32, $: any) => {
      // Reject subscripted tuple expressions `(a, b)[1]` and tuples outside statement/equation LHS
      for (const anc of db.ast.getAncestors(node, $.primary)) {
        for (const sub of db.ast.getDescendants(anc, $.array_subscripts)) {
          if (sub != 0) {
            let insideTuple = false;
            for (const subAnc of db.ast.getAncestors(sub, 0)) {
              if (subAnc == node) {
                insideTuple = true;
                break;
              }
              if (subAnc == anc) break;
            }
            if (!insideTuple) {
              db.diagnostic(sub, sub);
              return;
            }
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
   * M4017: Specialized class restriction violation — equations or algorithms in `record`, `type`, `package`, `connector`, or `function` (MLS §4.6).
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
    query: (db: CodeGraph, node: u32, $: any) => {
      // Check enclosing class specialization; only non-initial `algorithm` sections are valid in `function`
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
   * M2096 (M4019-notification): Companion `From here:` location note for redeclaration of a non-replaceable element (MLS §7.3).
   */
  redeclareNonReplaceableNotification: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "info",
    code: 2096,
    message: () => `From here:`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Emit source-location note at the component/extends declaration containing the illegal redeclare
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
   * M4019: Redeclaration with a new type requires the target element to be declared `replaceable` (MLS §7.3).
   */
  redeclareNonReplaceable: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "error",
    code: 4019,
    message: (target, elementName) => {
      const eName = elementName && elementName.text !== "0" && elementName.text !== "" ? elementName.text : target.text;
      return `Redeclaration with a new type requires '${eName}' to be replaceable.`;
    },
    query: (db: CodeGraph, node: u32, $: any) => {
      if (isIgnoreReplaceableActive(db, $)) return;
      // Verify that any `redeclare` changing a member's type targets an element with the `replaceable` prefix
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
   * M4068: Invalid redeclaration of element — a `redeclare` may not specify or change a `if` condition attribute (MLS §4.4.5, §7.3).
   */
  redeclareConditionAttribute: {
    nodes: ["condition_attribute"],
    severity: "error",
    code: 4068,
    message: (target, elementName) => {
      const eName = elementName && elementName.text !== "0" && elementName.text !== "" ? elementName.text : target.text;
      return `Invalid redeclaration of ${eName}, a redeclare may not have a condition attribute.`;
    },
    query: (db: CodeGraph, node: u32, $: any) => {
      // Flag `condition_attribute` (`if expr`) when placed on a redeclared component declaration
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
   * M4063: Invalid `redeclare class extends X` — target class `X` must exist in an inherited base class (MLS §7.3.1).
   */
  classExtendsNonInherited: {
    nodes: ["element"],
    severity: "error",
    code: 4063,
    message: (target, elementName, isOldFrontend) => {
      const eName = elementName && elementName.text !== "0" && elementName.text !== "" ? elementName.text : target.text;
      const isOld = isOldFrontend && (isOldFrontend.asNumber ? isOldFrontend.asNumber() : Number(isOldFrontend)) === 1;
      if (isOld) {
        return `Invalid redeclaration of class ${eName}, class extends only allowed on inherited classes.`;
      }
      return `Base class targeted by class extends ${eName} not found in the inherited classes.`;
    },
    query: (db: CodeGraph, node: u32, $: any) => {
      // Ensure `redeclare class extends <Name>` refers to a class inherited via `extends`
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
        let isOldFrontend: u32 = 0;
        const docRoot = db.ast.getRootNode();
        if (docRoot != 0 && $.string_literal != 0) {
          for (const str of db.ast.getDescendants(docRoot, $.string_literal)) {
            if (
              db.ast.textEquals(str, '"-d=-newInst"') ||
              db.ast.textEquals(str, "-d=-newInst") ||
              db.ast.textEquals(str, '"-d=nogen -d=-newInst"') ||
              db.ast.textEquals(str, "-d=nogen -d=-newInst")
            ) {
              isOldFrontend = 1;
              break;
            }
          }
        }
        db.diagnostic(classDef, redeclNameNode, isOldFrontend);
      }
    },
  },

  /**
   * M4061: Illegal `redeclare` of element — no inherited element with that name exists (MLS §7.3).
   */
  redeclareNonInherited: {
    nodes: ["element"],
    severity: "error",
    code: 4061,
    message: (target, elementName) => {
      const eName = elementName && elementName.text !== "0" && elementName.text !== "" ? elementName.text : target.text;
      return `Illegal redeclare of element ${eName}, no inherited element with that name exists.`;
    },
    query: (db: CodeGraph, node: u32, $: any) => {
      // Check that a standalone `redeclare` element in a class body overrides an element from an `extends` clause
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

      let isOldFrontend: u32 = 0;
      const docRoot = db.ast.getRootNode();
      if (docRoot != 0 && $.string_literal != 0) {
        for (const str of db.ast.getDescendants(docRoot, $.string_literal)) {
          if (
            db.ast.textEquals(str, '"-d=-newInst"') ||
            db.ast.textEquals(str, "-d=-newInst") ||
            db.ast.textEquals(str, '"-d=nogen -d=-newInst"') ||
            db.ast.textEquals(str, "-d=nogen -d=-newInst")
          ) {
            isOldFrontend = 1;
            break;
          }
        }
      }

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
              if (isOldFrontend) {
                break;
              }
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
        db.diagnostic(redeclNameNode != 0 ? redeclNameNode : targetDiagNode, redeclNameNode);
      }
    },
  },

  /**
   * M4022: Enumeration range expression `start:step:stop` cannot specify a step size (MLS §4.8.5, §10.4.3).
   */
  enumRangeWithStep: {
    nodes: ["expression"],
    severity: "error",
    code: 4022,
    message: (target) => `Range of type enumeration '${target.text}' may not specify a step size.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Detect three-part range expressions `e1:step:e2` whose endpoints are enumeration literals
      if (isEnumStepRangeExpr(db, node, $)) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M4023: `connect()` equations may not appear inside `when` equations (MLS §8.3.5, §9.1).
   */
  connectInWhen: {
    nodes: ["connect_equation"],
    severity: "error",
    code: 4023,
    message: (target) => `connect may not be used inside when-equations (found ${target.text}).`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Disallow `connect_equation` nested inside any `when_equation` or `when_statement`
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.when_equation || db.ast.getType(anc) == $.when_statement) {
          db.diagnostic(node);
          return;
        }
      }
    },
  },

  /**
   * M4024: `connect()` equations are not allowed in `initial equation` sections (MLS §8.6, §9.1).
   */
  connectInInitial: {
    nodes: ["connect_equation"],
    severity: "error",
    code: 4024,
    message: () => `Connect equations are not allowed in initial equation sections.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Check if the enclosing `equation_section` begins with the `initial` keyword
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
   * M2090 (M4026-notification): Companion `From here:` location note for overriding a `final` element (MLS §7.2.6).
   */
  finalOverrideNotification: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "info",
    code: 2090,
    message: () => `From here:`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Point to the original `final` declaration inside the target class when modified
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
          const at = db.ast.getType(anc);
          if (at == $.element_modification || at == $.element_redeclaration || at == $.element_replaceable) {
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
   * M4026: Trying to override a `final` element via modification (MLS §7.2.6).
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
    query: (db: CodeGraph, node: u32, $: any) => {
      // Reject value modifications targeting an element declared `final` in its class
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
          const at = db.ast.getType(anc);
          if (at == $.element_modification || at == $.element_redeclaration || at == $.element_replaceable) {
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
   * M2091 (M4052-notification): Companion `From here:` location note for redeclaration of a `final` component (MLS §7.2.6, §7.3).
   */
  redeclareFinalComponentNotification: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "info",
    code: 2091,
    message: () => `From here:`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Emit source-location note at the declaration site containing the illegal redeclare of a final element
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
   * M4052: Redeclaration of a `final` component is not allowed (MLS §7.2.6, §7.3).
   */
  redeclareFinalComponent: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "error",
    code: 4052,
    message: (target, elementName) => {
      const eName = elementName && elementName.text !== "0" && elementName.text !== "" ? elementName.text : target.text;
      return `Redeclaration of final component ${eName} is not allowed.`;
    },
    query: (db: CodeGraph, node: u32, $: any) => {
      // Disallow `redeclare` clauses targeting an element marked `final`
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
   * M2092 (M4053-notification): Companion `From here:` location note for redeclaration of a `constant` component (MLS §4.4.4, §7.3).
   */
  redeclareConstantComponentNotification: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "info",
    code: 2092,
    message: () => `From here:`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Emit source-location note at the declaration site containing the illegal redeclare of a constant
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
        if (targetEl != 0 && hasTypePrefix(db, targetEl, "constant", $)) {
          db.diagnostic(parentDecl != 0 ? parentDecl : compDecl != 0 ? compDecl : redecl);
          return;
        }
      }
      for (const redecl of db.ast.getDescendants(node, $.element_replaceable)) {
        if (!isDirectModificationChild(db, redecl, node, $)) continue;
        const redeclName = getRedeclName(db, redecl, $);
        if (redeclName == 0) continue;
        const targetEl = findTargetElementInClass(db, targetClass, redeclName, $);
        if (targetEl != 0 && hasTypePrefix(db, targetEl, "constant", $)) {
          db.diagnostic(parentDecl != 0 ? parentDecl : compDecl != 0 ? compDecl : redecl);
          return;
        }
      }
    },
  },

  /**
   * M4053: Redeclaration of a `constant` component is not allowed (MLS §4.4.4, §7.3).
   */
  redeclareConstantComponent: {
    nodes: ["class_modification", "class_or_inheritance_modification"],
    severity: "error",
    code: 4053,
    message: (target, elementName) => {
      const eName = elementName && elementName.text !== "0" && elementName.text !== "" ? elementName.text : target.text;
      return `Redeclaration of constant component ${eName} is not allowed.`;
    },
    query: (db: CodeGraph, node: u32, $: any) => {
      // Disallow `redeclare` clauses targeting an element declared with the `constant` prefix
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
        if (targetEl != 0 && hasTypePrefix(db, targetEl, "constant", $)) {
          let diagNode = targetEl;
          for (const cc of db.ast.getDescendants(targetEl, $.component_clause)) {
            diagNode = cc;
            break;
          }
          db.diagnostic(diagNode, redeclName);
          return;
        }
      }
      for (const redecl of db.ast.getDescendants(node, $.element_replaceable)) {
        if (!isDirectModificationChild(db, redecl, node, $)) continue;
        const redeclName = getRedeclName(db, redecl, $);
        if (redeclName == 0) continue;
        const targetEl = findTargetElementInClass(db, targetClass, redeclName, $);
        if (targetEl != 0 && hasTypePrefix(db, targetEl, "constant", $)) {
          let diagNode = targetEl;
          for (const cc of db.ast.getDescendants(targetEl, $.component_clause)) {
            diagNode = cc;
            break;
          }
          db.diagnostic(diagNode, redeclName);
          return;
        }
      }
    },
  },

  /**
   * M4032: Invalid connector prefix (`flow` or `stream`) on a function formal parameter (MLS §12.2).
   */
  functionInvalidPrefix: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4032,
    message: (target) => `Invalid prefix '${target.text}' on formal parameter in function.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Reject `flow` and `stream` prefixes on components declared inside a `function`
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
   * M4033: Function has more than one `algorithm` section or `external` declaration (MLS §12.2).
   */
  functionMultipleAlgorithm: {
    nodes: ["class_definition"],
    severity: "error",
    code: 4033,
    message: (_target, nameNode) => {
      const name = nameNode && nameNode.text !== "0" && nameNode.text !== "" ? nameNode.text : "";
      return `Function ${name} has more than one algorithm section or external declaration.`;
    },
    query: (db: CodeGraph, node: u32, $: any) => {
      // Count direct and inherited `algorithm_section` and `external_clause` nodes in a `function`
      if (!isClassKind(db, node, "function")) return;
      let isOldFrontend: u32 = 0;
      const docRoot = db.ast.getRootNode();
      if (docRoot != 0 && $.string_literal != 0) {
        for (const str of db.ast.getDescendants(docRoot, $.string_literal)) {
          if (
            db.ast.textEquals(str, '"-d=-newInst"') ||
            db.ast.textEquals(str, "-d=-newInst") ||
            db.ast.textEquals(str, '"-d=nogen -d=-newInst"') ||
            db.ast.textEquals(str, "-d=nogen -d=-newInst")
          ) {
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
          break;
        }
      }
      if (count > 1) {
        const nameNode = getClassNameNode(db, node, $);
        const target = nameNode != 0 ? nameNode : node;
        db.diagnostic(target, target);
      }
    },
  },

  /**
   * M4038: Prefix `flow` used outside a `connector` declaration (MLS §9.3).
   */
  flowOutsideConnector: {
    nodes: ["type_prefix"],
    severity: "warning",
    code: 4038,
    message: (target) => `Prefix '${target.text}' used outside connector declaration.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Warn when `flow` is used inside a class whose specialization is not `connector`
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
   * M4042: `constant` declaration has no value binding (MLS §4.4.4).
   */
  constantHasNoValue: {
    nodes: ["component_declaration"],
    severity: "error",
    code: 4042,
    message: (target) => `Constant '${target.text}' has no value.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Ensure top-level non-replaceable primitive `constant` declarations specify a binding or equation
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
        if (isClassKind(db, cls, "package") && docRoot != 0) {
          let lastTopCls: u32 = 0;
          for (const topCls of db.ast.getDescendants(docRoot, $.class_definition)) {
            let isTop = true;
            for (const anc of db.ast.getAncestors(topCls, $.class_definition)) {
              if (anc != topCls) {
                isTop = false;
                break;
              }
            }
            if (isTop) lastTopCls = topCls;
          }
          if (lastTopCls != 0 && lastTopCls != cls) return;
        }
      }
      if (classCount > 1) return;

      for (const comp of db.ast.getAncestors(node, $.component_clause)) {
        if (!hasTypePrefix(db, comp, "constant", $)) return;
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
   * M4047: `cardinality()` operator used outside the condition of an `if` equation/statement or `assert()` (MLS §3.7.2.3).
   */
  cardinalityInvalidContext: {
    nodes: ["function_call"],
    severity: "error",
    code: 4047,
    message: (target) =>
      `Operator '${target.text}' may only be used in the condition of an if-statement/equation or an assert.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Allow `cardinality(...)` only when enclosed by an `if_equation` or `if_statement`
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
   * M4025: `connect()` inside an `if` equation whose condition has non-parametric variability (MLS §8.3.4, §9.1).
   */
  connectInNonParamIf: {
    nodes: ["connect_equation"],
    severity: "error",
    code: 4025,
    message: (target) =>
      `connect may not be used inside if-equations with non-parametric conditions (found ${target.text}).`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Check enclosing `if_equation` condition variability and reject continuous/time-varying conditions
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
   * M4028: Component instantiated from a `partial` class without a `replaceable` prefix (MLS §4.4.2).
   */
  partialTypeComponent: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4028,
    message: (target) => `Component '${target.text}' has partial type.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Disallow non-replaceable component declarations whose resolved type is `partial` in a concrete class
      if (isPartialTypeComponentInScope(db, node, $)) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M4048: Argument to `cardinality()` must be a connector component instance, not a class name (MLS §3.7.2.3).
   */
  cardinalityExpectedComponent: {
    nodes: ["function_call", "primary"],
    severity: "error",
    code: 4048,
    message: (target) => `Expected ${target.text} to be a component, but found class instead.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Report when the argument passed to `cardinality(arg)` resolves to a class rather than a component
      if (isCardinalityClassArg(db, node, $)) {
        for (const arg of db.ast.getDescendants(node, $.function_argument)) {
          db.diagnostic(arg);
          break;
        }
      }
    },
  },

  /**
   * M4064: `protected` sections are not allowed in `connector`, `record`, or `type` definitions (MLS §4.6).
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
    query: (db: CodeGraph, node: u32, $: any) => {
      // Check if a `connector`, `record`, or `type` composition contains a `protected` keyword
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
   * M4065: `equation` sections are not allowed in a `connector` definition (MLS §4.6).
   */
  equationInConnector: {
    nodes: ["equation_section"],
    severity: "error",
    code: 4065,
    message: () => `Equations are not allowed in connector.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Reject `equation_section` inside any `connector` class
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
   * M4066: `algorithm` sections are not allowed in a `connector` definition (MLS §4.6).
   */
  algorithmInConnector: {
    nodes: ["algorithm_section"],
    severity: "error",
    code: 4066,
    message: () => `Algorithm sections are not allowed in connector.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Reject `algorithm_section` inside any `connector` class
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
   * M5017: A `when` statement may not be used inside a `function` or nested inside `while`, `if`, or `for` clauses (MLS §11.2.7).
   */
  whenIllegalContext: {
    nodes: ["when_statement"],
    severity: "error",
    code: 5017,
    message: () => `A when-statement may not be used inside a function or a while, if, or for-clause.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Skip nested `when` (already reported by M4013) and check for enclosing `if`/`for`/`while` or `function`
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
   * M4079: `return` statement may not be used outside a `function` (MLS §11.2.6).
   */
  returnOutsideFunction: {
    nodes: ["statement"],
    severity: "error",
    code: 4079,
    message: () => `'return' may not be used outside function.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Verify that any `return` statement is enclosed by a `function` class definition
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
   * M4091: `break` statement may only be used inside a `while` or `for` loop (MLS §11.2.5).
   */
  breakOutsideLoop: {
    nodes: ["statement"],
    severity: "error",
    code: 4091,
    message: () => `'break' may only be used in a while- or for-loop.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Ensure `break` has a `for_statement`, `while_statement`, or `for_equation` ancestor in the current class
      let isBreak = false;
      let ch = db.ast.getFirstChild(node);
      while (ch != 0) {
        if (db.ast.textEquals(ch, "break")) {
          isBreak = true;
          break;
        }
        ch = db.ast.getNextSibling(ch);
      }
      if (!isBreak) return;

      let isInsideLoop = false;
      for (const anc of db.ast.getAncestors(node, 0)) {
        const t = db.ast.getType(anc);
        if (t == $.for_statement || t == $.while_statement || t == $.for_equation) {
          isInsideLoop = true;
          break;
        }
        if (t == $.class_definition) {
          break;
        }
      }
      if (!isInsideLoop) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M4020: Built-in variable `time` is not allowed inside a `function` (MLS §3.6.7, §12.2).
   */
  timeInFunction: {
    nodes: ["primary"],
    severity: "error",
    code: 4020,
    message: () => `time is not allowed in a function.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Disallow references to `time` in function bodies or redeclarations inside a function
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
   * M4078: Built-in `terminate()` operator is not allowed inside a `function` (MLS §8.3.8, §12.2).
   */
  terminateInFunction: {
    nodes: ["function_call"],
    severity: "error",
    code: 4078,
    message: () => `terminate is not allowed in a function.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Flag `terminate(...)` calls appearing inside a `function` class definition
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
   * M4041: Negative array dimension size is not valid in a component declaration (MLS §10.1).
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
    query: (db: CodeGraph, node: u32, $: any) => {
      // Check declared array subscripts for negative integer dimension expressions
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
          db.diagnostic(sub, sub, nameNode);
          return;
        }
      }
    },
  },

  /**
   * M4070: Class specialization violation — `external` declarations are only allowed in `function` classes (MLS §4.6, §12.9).
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
    query: (db: CodeGraph, node: u32, $: any) => {
      // Verify that the directly enclosing `class_definition` of an `external_clause` is a `function`
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
            db.diagnostic(node, nameNode != 0 ? nameNode : anc, k);
          }
          break;
        }
      }
    },
  },

  /**
   * M4020: Identifier `time` is reserved for the built-in simulation time variable and cannot be redeclared as a component (MLS §3.6.7).
   */
  reservedBuiltinTime: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4020,
    message: () => `Identifier time is reserved for the built-in element with the same name.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Disallow declaring any component named `time`
      for (const decl of db.ast.getDescendants(node, $.declaration)) {
        const nameNode = db.ast.getChildByFieldId(decl, "name");
        if (nameNode != 0 && db.ast.textEquals(nameNode, "time")) {
          db.diagnostic(node);
          return;
        }
      }
    },
  },
};

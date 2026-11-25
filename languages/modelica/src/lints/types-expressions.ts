// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module lints/types-expressions
 *
 * CST-level linter rules for Modelica type checking, dimensional unit consistency,
 * array subscripts and shapes, equation/assignment type compatibility, and parameter bounds
 * (MLS §6, §8, §10, §11, §15, §19).
 */

import type { CodeGraph, CompilerLint, f64, i32, u16, u32 } from "@modelscript/dsl";
import { unitsCompatible } from "../units.js";
import {
  getComponentUnit,
  getDeclaredArraySubscripts,
  getEnclosingClass,
  getVariableTypeInClass,
  hasTypePrefix,
  hasUnitInClass,
  inferExprType,
  inferExprUnit,
  isBindingValueLiteral,
  isClassKind,
  isDescendantOfInnerClass,
  isIntEnumConversionActive,
  isLiteralInValuePosition,
  isOldFrontendActive,
  isSimpleNumericLiteral,
  isStreamVariable,
  isTypeCompatible,
  resolveBasePrimitiveType,
  TYPE_BOOLEAN,
  TYPE_INTEGER,
  TYPE_REAL,
  TYPE_STRING,
  TYPE_UNKNOWN,
  type ModelicaGrammarSymbols,
} from "./helpers.js";

/**
 * Sentinel infinity bound used for integer interval/octagon abstract domain checks (`2^30 - 1`).
 */
const OCTAGON_INF: i32 = 0x3fffffff;

/**
 * Compiler lint rules enforcing type safety, array shapes/bounds, unit compatibility, and assignment restrictions.
 */
export const modelicaTypeLints: Record<string, CompilerLint> = {
  /**
   * M3001: Type mismatch in binding equation (MLS §6.6, §8.3.1).
   *
   * Verifies that component declaration bindings (`Real x = expr`) have a value type
   * compatible with the declared primitive or derived base type.
   */
  typeMismatchBinding: {
    nodes: ["component_declaration"],
    severity: "error",
    code: 3001,
    message: (target, expType, actType) => {
      const typeNames = ["Real", "Integer", "Boolean", "String"];
      const eIdx = expType && expType.asNumber ? expType.asNumber() : Number(expType);
      const aIdx = actType && actType.asNumber ? actType.asNumber() : Number(actType);
      const expName = eIdx >= 0 && eIdx < typeNames.length ? typeNames[eIdx] : "";
      const actName = aIdx >= 0 && aIdx < typeNames.length ? typeNames[aIdx] : "";
      if (expName && actName) {
        return `Type mismatch in binding ${target.text}, expected subtype of ${expName}, got type ${actName}.`;
      }
      return `Type mismatch in binding or modification expression '${target.text}'.`;
    },
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      // Resolve the primitive base type of the enclosing component clause
      let expectedType: u16 = TYPE_UNKNOWN;
      for (const anc of db.ast.getAncestors(node)) {
        const ancType = db.ast.getType(anc);
        if (ancType == $.component_clause || ancType == $.component_clause1) {
          let typeSpecNode: u32 = 0;
          if ($.type_specifier != 0) {
            for (const ts of db.ast.getDescendants(anc, $.type_specifier)) {
              typeSpecNode = ts;
              break;
            }
          }
          if (typeSpecNode != 0) {
            expectedType = resolveBasePrimitiveType(db, typeSpecNode, $);
          }
          if (expectedType == TYPE_UNKNOWN) {
            for (const id of db.ast.getDescendants(anc, $.identifier)) {
              expectedType = resolveBasePrimitiveType(db, id, $);
              if (expectedType != TYPE_UNKNOWN) break;
            }
          }
          break;
        }
      }
      if (expectedType == TYPE_UNKNOWN) return;

      // Find the declaration node under component_declaration
      let declNode: u32 = 0;
      for (const d of db.ast.getDescendants(node, $.declaration)) {
        declNode = d;
        break;
      }
      if (declNode == 0) return;

      // Find modification inside declaration
      let modNode: u32 = 0;
      for (const m of db.ast.getDescendants(declNode, $.modification)) {
        modNode = m;
        break;
      }
      // If there is no modification on this declaration, there is no binding equation to check
      if (modNode == 0) return;

      // A literal only fixes the binding's type when it is in value position — not an if-condition,
      // relation/logical operand, call argument or subscript — and not inside a description,
      // annotation, or string-valued attribute modification such as `unit="m"`.
      if (expectedType == TYPE_REAL || expectedType == TYPE_INTEGER || expectedType == TYPE_BOOLEAN) {
        if ($.string_literal != 0) {
          for (const str of db.ast.getDescendants(modNode, $.string_literal)) {
            if (!isBindingValueLiteral(db, str, node, true, $)) continue;
            db.diagnosticAt(str, declNode, expectedType, TYPE_STRING);
            return;
          }
        }
        if (expectedType == TYPE_INTEGER && $.unsigned_real != 0) {
          for (const num of db.ast.getDescendants(modNode, $.unsigned_real)) {
            if (!isBindingValueLiteral(db, num, node, false, $)) continue;
            db.diagnosticAt(num, declNode, TYPE_INTEGER, TYPE_REAL);
            return;
          }
        }
      } else if (expectedType == TYPE_STRING) {
        if ($.unsigned_real != 0) {
          for (const num of db.ast.getDescendants(modNode, $.unsigned_real)) {
            if (!isBindingValueLiteral(db, num, node, false, $)) continue;
            db.diagnosticAt(num, declNode, TYPE_STRING, TYPE_REAL);
            return;
          }
        }
        if ($.unsigned_integer != 0) {
          for (const num of db.ast.getDescendants(modNode, $.unsigned_integer)) {
            if (!isBindingValueLiteral(db, num, node, false, $)) continue;
            db.diagnosticAt(num, declNode, TYPE_STRING, TYPE_INTEGER);
            return;
          }
        }
      }
    },
  },

  /**
   * M3002: Type mismatch in element modification expression (MLS §7.2).
   *
   * Checks that built-in attribute modifications (`start`, `min`, `max`, `fixed`, `unit`, etc.)
   * and class component modifications match their declared types.
   */
  typeMismatchModification: {
    nodes: ["element_modification"],
    severity: "error",
    code: 3002,
    message: (target) => `Type mismatch in binding or modification expression '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      // Skip modifications inside graphical/documentation annotations
      for (const anc of db.ast.getAncestors(node)) {
        const t = db.ast.getType(anc);
        if (($.annotation != 0 && t == $.annotation) || ($.annotation_clause != 0 && t == $.annotation_clause)) {
          return;
        }
      }
      let modClause = db.ast.getChildByFieldId(node, "modification");
      if (modClause == 0) {
        for (const m of db.ast.getDescendants(node, $.modification)) {
          let direct = true;
          for (const anc of db.ast.getAncestors(m)) {
            if (anc == node) break;
            if (db.ast.getType(anc) == $.element_modification) {
              direct = false;
              break;
            }
          }
          if (direct) {
            modClause = m;
            break;
          }
        }
      }
      if (modClause == 0) return;

      let modExpr = db.ast.getChildByFieldId(modClause, "modification_expression");
      if (modExpr == 0) {
        for (const e of db.ast.getDescendants(modClause, $.modification_expression)) {
          let direct = true;
          for (const anc of db.ast.getAncestors(e)) {
            if (anc == modClause) break;
            if (db.ast.getType(anc) == $.class_modification) {
              direct = false;
              break;
            }
          }
          if (direct) {
            modExpr = e;
            break;
          }
        }
      }
      if (modExpr == 0) return;

      let nameNode = db.ast.getChildByFieldId(node, "name");
      if (nameNode == 0) {
        for (const n of db.ast.getDescendants(node, $.name)) {
          nameNode = n;
          break;
        }
      }
      if (nameNode == 0) return;

      let lastId: u32 = 0;
      let firstId: u32 = 0;
      if (db.ast.getType(nameNode) == $.identifier) {
        lastId = nameNode;
        firstId = nameNode;
      } else {
        for (const id of db.ast.getDescendants(nameNode, $.identifier)) {
          if (firstId == 0) firstId = id;
          lastId = id;
        }
      }

      let expectedType: u16 = TYPE_UNKNOWN;

      if (lastId != 0) {
        if (
          db.ast.textEquals(lastId, "unit") ||
          db.ast.textEquals(lastId, "displayUnit") ||
          db.ast.textEquals(lastId, "quantity")
        ) {
          expectedType = TYPE_STRING;
        } else if (db.ast.textEquals(lastId, "fixed") || db.ast.textEquals(lastId, "uncertain")) {
          expectedType = TYPE_BOOLEAN;
        }
      }

      if (expectedType == TYPE_UNKNOWN) {
        // Find enclosing component_clause1, element_redeclaration, component_clause, or extends_clause
        let parentDecl: u32 = 0;
        for (const anc of db.ast.getAncestors(node)) {
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

        // 1. Primitive or derived primitive types
        const basePrim = resolveBasePrimitiveType(db, baseTypeId, $);
        if (basePrim == TYPE_REAL) {
          if (
            db.ast.textEquals(nameNode, "start") ||
            db.ast.textEquals(nameNode, "min") ||
            db.ast.textEquals(nameNode, "max") ||
            db.ast.textEquals(nameNode, "nominal")
          ) {
            expectedType = TYPE_REAL;
          } else if (db.ast.textEquals(nameNode, "fixed") || db.ast.textEquals(nameNode, "uncertain")) {
            expectedType = TYPE_BOOLEAN;
          } else if (
            db.ast.textEquals(nameNode, "unit") ||
            db.ast.textEquals(nameNode, "displayUnit") ||
            db.ast.textEquals(nameNode, "quantity")
          ) {
            expectedType = TYPE_STRING;
          } else {
            expectedType = TYPE_REAL;
          }
        } else if (basePrim == TYPE_INTEGER) {
          if (
            db.ast.textEquals(nameNode, "start") ||
            db.ast.textEquals(nameNode, "min") ||
            db.ast.textEquals(nameNode, "max")
          ) {
            expectedType = TYPE_INTEGER;
          } else if (db.ast.textEquals(nameNode, "fixed")) {
            expectedType = TYPE_BOOLEAN;
          } else if (db.ast.textEquals(nameNode, "quantity")) {
            expectedType = TYPE_STRING;
          } else {
            expectedType = TYPE_INTEGER;
          }
        } else if (basePrim == TYPE_BOOLEAN) {
          if (db.ast.textEquals(nameNode, "start") || db.ast.textEquals(nameNode, "fixed")) {
            expectedType = TYPE_BOOLEAN;
          } else if (db.ast.textEquals(nameNode, "quantity")) {
            expectedType = TYPE_STRING;
          } else {
            expectedType = TYPE_BOOLEAN;
          }
        } else if (basePrim == TYPE_STRING) {
          expectedType = TYPE_STRING;
        } else {
          // 2. User-defined classes
          const docRoot = db.ast.getRootNode();
          if (docRoot != 0) {
            for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
              let cName = db.ast.getChildByFieldId(spec, "name");
              if (cName == 0) {
                for (const id of db.ast.getDescendants(spec, $.identifier)) {
                  cName = id;
                  break;
                }
              }
              if (cName != 0 && db.ast.textEqualsNode(baseTypeId, cName)) {
                let classDef: u32 = spec;
                for (const anc of db.ast.getAncestors(spec)) {
                  if (db.ast.getType(anc) == $.class_definition) {
                    classDef = anc;
                    break;
                  }
                }
                expectedType = getVariableTypeInClass(db, classDef, firstId != 0 ? firstId : nameNode, $);
                break;
              }
            }
            if (expectedType == TYPE_UNKNOWN) {
              for (const spec of db.ast.getDescendants(docRoot, $.short_class_specifier)) {
                let cName = db.ast.getChildByFieldId(spec, "name");
                if (cName == 0) {
                  for (const id of db.ast.getDescendants(spec, $.identifier)) {
                    cName = id;
                    break;
                  }
                }
                if (cName != 0 && db.ast.textEqualsNode(baseTypeId, cName)) {
                  let classDef: u32 = spec;
                  for (const anc of db.ast.getAncestors(spec)) {
                    if (db.ast.getType(anc) == $.class_definition) {
                      classDef = anc;
                      break;
                    }
                  }
                  expectedType = getVariableTypeInClass(db, classDef, firstId != 0 ? firstId : nameNode, $);
                  break;
                }
              }
            }
          }
        }
      }

      if (expectedType == TYPE_UNKNOWN) return;

      // Only literals in value position determine the modification's type (see isLiteralInValuePosition):
      // `start = if s == "a" then 1 else 0` must not be reported as a String modification.
      if (expectedType == TYPE_REAL || expectedType == TYPE_INTEGER || expectedType == TYPE_BOOLEAN) {
        if (db.ast.getType(modExpr) == $.string_literal) {
          db.diagnostic(modExpr);
          return;
        }
        for (const d of db.ast.getDescendants(modExpr)) {
          const isStr =
            db.ast.getType(d) == $.string_literal || (db.ast.getFirstChild(d) == 0 && db.ast.startsWith(d, '"'));
          if (isStr && isLiteralInValuePosition(db, d, modExpr, $)) {
            db.diagnostic(d);
            return;
          }
        }
        if (expectedType == TYPE_INTEGER && $.unsigned_real != 0) {
          if (db.ast.getType(modExpr) == $.unsigned_real) {
            db.diagnostic(modExpr);
            return;
          }
          for (const d of db.ast.getDescendants(modExpr, $.unsigned_real)) {
            if (isLiteralInValuePosition(db, d, modExpr, $)) {
              db.diagnostic(d);
              return;
            }
          }
        }
      } else if (expectedType == TYPE_STRING) {
        if (db.ast.getType(modExpr) == $.unsigned_real || db.ast.getType(modExpr) == $.unsigned_integer) {
          db.diagnostic(modExpr);
          return;
        }
        for (const num of db.ast.getDescendants(modExpr)) {
          const t = db.ast.getType(num);
          if (
            (($.unsigned_real != 0 && t == $.unsigned_real) || ($.unsigned_integer != 0 && t == $.unsigned_integer)) &&
            isLiteralInValuePosition(db, num, modExpr, $)
          ) {
            db.diagnostic(num);
          }
        }
      }
    },
  },

  /**
   * M3009: Array index must be Integer or Boolean (MLS §10.1, §10.5).
   *
   * Rejects `Real` or `String` expressions used as array subscripts.
   */
  arrayIndexTypeMismatch: {
    nodes: ["subscript"],
    severity: "error",
    code: 3009,
    message: (target) => `Array index '${target.text}' has invalid type: expected Integer or Boolean.`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      // Infer subscript expression type and ensure it is Integer, Boolean, or Enumeration
      const idxType = inferExprType(db, node, $);
      if (idxType != TYPE_UNKNOWN && idxType != TYPE_INTEGER && idxType != 2 /* Boolean */) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M4003: Array shape mismatch between declared dimension and initializer (MLS §10.3, §10.4).
   * e.g. `Real x[9] = {8};`
   */
  arrayShapeMismatch: {
    nodes: ["component_declaration", "component_declaration1"],
    severity: "error",
    code: 4003,
    message: (target) =>
      `Array shape mismatch: declared dimension does not match initializer element count in '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      // 1. Find array_subscripts declared directly on declaration or enclosing component_clause
      const subNode = getDeclaredArraySubscripts(db, node, $);
      if (subNode == 0) return;

      // Require the first declared dimension to be a plain positive integer literal (not `n + 1`).
      let firstSub: u32 = 0;
      if ($.subscript != 0) {
        for (const s of db.ast.getDescendants(subNode, $.subscript)) {
          firstSub = s;
          break;
        }
      }
      if (firstSub != 0 && !isSimpleNumericLiteral(db, firstSub, $)) return;

      const declaredSize = db.ast.parseInteger(firstSub != 0 ? firstSub : subNode);
      if (declaredSize <= 0) return;

      // 2. Find direct top-level array_arguments (`{ ... }`) in the declaration's binding expression
      const decl = db.ast.getType(node) == $.declaration ? node : db.ast.getChildByFieldId(node, "declaration");
      if (decl == 0) return;
      const mod = db.ast.getChildByFieldId(decl, "modification");
      if (mod == 0) return;
      const modExpr = db.ast.getChildByFieldId(mod, "modification_expression");
      if (modExpr == 0) return;

      let arrayArgs: u32 = 0;
      if ($.array_arguments != 0) {
        for (const args of db.ast.getDescendants(modExpr, $.array_arguments)) {
          let isTopLevel = true;
          for (const anc of db.ast.getAncestors(args, 0, modExpr)) {
            if (anc == args) continue;
            const at = db.ast.getType(anc);
            if (
              ($.function_call_args != 0 && at == $.function_call_args) ||
              ($.array_subscripts != 0 && at == $.array_subscripts) ||
              ($.array_arguments != 0 && at == $.array_arguments) ||
              ($.element_modification != 0 && at == $.element_modification) ||
              db.ast.getChildByFieldId(anc, "left") != 0 ||
              db.ast.getChildByFieldId(anc, "right") != 0
            ) {
              isTopLevel = false;
              break;
            }
          }
          if (isTopLevel) {
            arrayArgs = args;
          }
          break;
        }
      }
      if (arrayArgs == 0) return;

      // Skip array comprehensions with 'for'
      if ($.for_indices != 0) {
        for (const forIdx of db.ast.getDescendants(arrayArgs, $.for_indices)) {
          if (forIdx != 0) return;
        }
      }

      // Count elements in array_arguments (only direct elements of arrayArgs, not nested inner arrays)
      let count: u32 = 1;
      if ($.array_arguments_non_first != 0) {
        const nonFirstElements = db.ast.getDescendants(arrayArgs, $.array_arguments_non_first);
        for (const elem of nonFirstElements) {
          if (elem != 0) {
            let isNested = false;
            for (const anc of db.ast.getAncestors(elem)) {
              if (anc == arrayArgs) break;
              if (db.ast.getType(anc) == $.array_arguments) {
                isNested = true;
                break;
              }
            }
            if (!isNested) count++;
          }
        }
      }

      if (count != (declaredSize as u32)) {
        db.diagnostic(arrayArgs);
      }
    },
  },

  /**
   * M3018: Array element type mismatch (MLS §10.4).
   *
   * Ensures all literal elements inside an array constructor `{ ... }` are type-compatible
   * with the declared array component type.
   */
  arrayElementTypeMismatch: {
    nodes: ["component_declaration", "component_declaration1"],
    severity: "error",
    code: 3018,
    message: (target) => `Array element type mismatch in '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      let arrayArgs: u32 = 0;
      for (const args of db.ast.getDescendants(node, $.array_arguments)) {
        arrayArgs = args;
        break;
      }
      if (arrayArgs == 0) return;

      // Determine expected primitive type
      let expectedType: u16 = TYPE_UNKNOWN;
      for (const anc of db.ast.getAncestors(node)) {
        const ancType = db.ast.getType(anc);
        if (ancType == $.component_clause || ancType == $.component_clause1) {
          let typeSpecNode: u32 = 0;
          if ($.type_specifier != 0) {
            for (const ts of db.ast.getDescendants(anc, $.type_specifier)) {
              typeSpecNode = ts;
              break;
            }
          }
          if (typeSpecNode != 0) {
            expectedType = resolveBasePrimitiveType(db, typeSpecNode, $);
          }
          if (expectedType == TYPE_UNKNOWN) {
            for (const id of db.ast.getDescendants(anc, $.identifier)) {
              expectedType = resolveBasePrimitiveType(db, id, $);
              if (expectedType != TYPE_UNKNOWN) break;
            }
          }
          break;
        }
      }
      if (expectedType == TYPE_UNKNOWN) return;

      if (expectedType == TYPE_REAL || expectedType == TYPE_INTEGER) {
        for (const str of db.ast.getDescendants(arrayArgs, $.string_literal)) {
          let inSubOrCall = false;
          for (const anc of db.ast.getAncestors(str)) {
            if (anc == arrayArgs) break;
            const t = db.ast.getType(anc);
            if (
              t == $.array_subscripts ||
              t == $.subscript ||
              t == $.function_call_args ||
              ($.for_indices != 0 && t == $.for_indices) ||
              ($.for_index != 0 && t == $.for_index)
            ) {
              inSubOrCall = true;
              break;
            }
          }
          if (!inSubOrCall) db.diagnostic(str);
        }
      } else if (expectedType == TYPE_STRING) {
        for (const num of db.ast.getDescendants(arrayArgs, $.unsigned_real)) {
          let inSubOrCall = false;
          for (const anc of db.ast.getAncestors(num)) {
            if (anc == arrayArgs) break;
            const t = db.ast.getType(anc);
            if (
              t == $.array_subscripts ||
              t == $.subscript ||
              t == $.function_call_args ||
              ($.for_indices != 0 && t == $.for_indices) ||
              ($.for_index != 0 && t == $.for_index)
            ) {
              inSubOrCall = true;
              break;
            }
          }
          if (!inSubOrCall) db.diagnostic(num);
        }
        for (const num of db.ast.getDescendants(arrayArgs, $.unsigned_integer)) {
          let inSubOrCall = false;
          for (const anc of db.ast.getAncestors(num)) {
            if (anc == arrayArgs) break;
            const t = db.ast.getType(anc);
            if (
              t == $.array_subscripts ||
              t == $.subscript ||
              t == $.function_call_args ||
              ($.for_indices != 0 && t == $.for_indices) ||
              ($.for_index != 0 && t == $.for_index)
            ) {
              inSubOrCall = true;
              break;
            }
          }
          if (!inSubOrCall) db.diagnostic(num);
        }
      }
    },
  },

  /**
   * M5001: Type mismatch in equation `lhs = rhs` (MLS §8.3.1).
   *
   * Both sides of a simple equation must have compatible types (accounting for
   * `Integer` to `Real` coercion).
   */
  equationTypeMismatch: {
    nodes: ["simple_equation"],
    severity: "error",
    code: 5001,
    message: (target, lhsType, rhsType, isOldFrontend) => {
      const typeNames = ["Real", "Integer", "Boolean", "String"];
      const lIdx = lhsType && lhsType.asNumber ? lhsType.asNumber() : Number(lhsType);
      const rIdx = rhsType && rhsType.asNumber ? rhsType.asNumber() : Number(rhsType);
      const lName = lIdx >= 0 && lIdx < typeNames.length ? typeNames[lIdx] : "Unknown";
      const rName = rIdx >= 0 && rIdx < typeNames.length ? typeNames[rIdx] : "Unknown";
      const isOld = isOldFrontend && (isOldFrontend.asNumber ? isOldFrontend.asNumber() : Number(isOldFrontend)) === 1;
      let eqText = "";
      let inWs = true;
      for (let i = 0; i < target.text.length; i++) {
        const code = target.text.charCodeAt(i);
        if (code === 32 || (code >= 9 && code <= 13)) {
          if (!inWs) {
            eqText += " ";
            inWs = true;
          }
        } else {
          eqText += target.text.charAt(i);
          inWs = false;
        }
      }
      if (eqText.endsWith(" ")) eqText = eqText.slice(0, -1);
      if (isOld) {
        return `Type mismatch in equation ${eqText.replace(" = ", "=")} of type ${lName}=${rName}.`;
      }
      return `Type mismatch in equation ${eqText} of type ${lName} = ${rName}.`;
    },
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      // Extract LHS and RHS expression nodes around the '=' token
      let lhs = db.ast.getFirstChild(node);
      if (lhs == 0) return;
      let eqToken = db.ast.getNextSibling(lhs);
      let rhs = eqToken != 0 ? db.ast.getNextSibling(eqToken) : 0;
      if (rhs == 0) {
        let sib = eqToken;
        while (sib != 0) {
          if (db.ast.getType(sib) != 0 && !db.ast.textEquals(sib, "=")) {
            rhs = sib;
            break;
          }
          sib = db.ast.getNextSibling(sib);
        }
      }
      if (lhs != 0 && rhs != 0) {
        const lhsType = inferExprType(db, lhs, $);
        const rhsType = inferExprType(db, rhs, $);
        const bothPrim = lhsType < 4 && rhsType < 4;
        const classEqPrimLiteral =
          lhsType >= 0x8000 &&
          rhsType < 4 &&
          (rhsType == TYPE_BOOLEAN || rhsType == TYPE_STRING || isSimpleNumericLiteral(db, rhs, $));
        if (lhsType != TYPE_UNKNOWN && rhsType != TYPE_UNKNOWN && (bothPrim || classEqPrimLiteral)) {
          const allowIntEnum = isIntEnumConversionActive(db, $);
          if (!isTypeCompatible(rhsType, lhsType, allowIntEnum) && !isTypeCompatible(lhsType, rhsType, allowIntEnum)) {
            const isOldFrontend: u32 = isOldFrontendActive(db, $) ? 1 : 0;
            db.diagnosticAt(rhs, node, lhsType, rhsType, isOldFrontend);
          }
        }
      }
    },
  },

  /**
   * M5005: Division by literal zero (MLS §10.6).
   *
   * Flags binary division (`/`) or element-wise division (`./`) where the denominator
   * is the literal `0` or `0.0`.
   */
  divisionByZero: {
    nodes: ["expression"],
    severity: "error",
    code: 5005,
    message: (lhs) => `Division by zero: ${lhs.text} / 0.`,
    query: (db: CodeGraph, node: u32) => {
      // Check binary operator code (3 = '/', 8 = './') and literal zero denominator
      const leftChild = db.ast.getChildByFieldId(node, "left");
      const rightChild = db.ast.getChildByFieldId(node, "right");
      if (leftChild != 0 && rightChild != 0) {
        const op = db.ast.getBinaryOp(leftChild, rightChild);
        if (op === 3 || op === 8) {
          if (db.ast.textEquals(rightChild, "0") || db.ast.textEquals(rightChild, "0.0")) {
            db.diagnosticAt(rightChild, leftChild);
          }
        }
      }
    },
  },

  /**
   * M5006: Type mismatch in assignment `target := expr` (MLS §11.2.1).
   *
   * Ensures the value expression on the RHS of an algorithmic assignment is type-compatible
   * with the LHS target reference.
   */
  assignmentTypeMismatch: {
    nodes: ["assignment_statement"],
    severity: "error",
    code: 5006,
    message: (target, targetType, valType) => {
      const typeNames = ["Real", "Integer", "Boolean", "String", "Enumeration", "Clock"];
      const tIdx = targetType && targetType.asNumber ? targetType.asNumber() : Number(targetType);
      const vIdx = valType && valType.asNumber ? valType.asNumber() : Number(valType);
      const tName = tIdx >= 0 && tIdx < typeNames.length ? typeNames[tIdx] : "Unknown";
      const vName = vIdx >= 0 && vIdx < typeNames.length ? typeNames[vIdx] : "Unknown";
      return `Type mismatch in assignment in ${target.text} of ${tName} := ${vName}`;
    },
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      // Infer LHS target and RHS value types and verify assignment compatibility
      const target = db.ast.getChildByFieldId(node, "target");
      const value = db.ast.getChildByFieldId(node, "value");
      if (target != 0 && value != 0) {
        const targetType = inferExprType(db, target, $);
        const valType = inferExprType(db, value, $);
        if (targetType != TYPE_UNKNOWN && valType != TYPE_UNKNOWN && targetType < 0x8000 && valType < 0x8000) {
          const allowIntEnum = isIntEnumConversionActive(db, $);
          if (!isTypeCompatible(valType, targetType, allowIntEnum)) {
            db.diagnosticAt(value, node, targetType, valType);
          }
        }
      }
    },
  },

  /**
   * M5008: Assignment to constant component (MLS §4.4.4, §11.2.1).
   *
   * Disallows algorithmic `:=` assignments to components declared with the `constant` prefix.
   */
  assignmentToConstant: {
    nodes: ["assignment_statement"],
    severity: "error",
    code: 5008,
    message: (node, idNode) =>
      `Trying to assign to constant component ${idNode && idNode.text ? idNode.text : node.text}.`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      // Extract the root target identifier and check if its declaration has the `constant` prefix
      const target = db.ast.getChildByFieldId(node, "target");
      if (target == 0) return;
      let idNode: u32 = 0;
      for (const id of db.ast.getDescendants(target, $.identifier)) {
        idNode = id;
        break;
      }
      if (idNode == 0) return;

      let enclosingClass: u32 = 0;
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.class_definition) {
          enclosingClass = anc;
          break;
        }
      }
      if (enclosingClass == 0) return;

      for (const comp of db.ast.getDescendants(enclosingClass, $.component_clause)) {
        if (isDescendantOfInnerClass(db, comp, enclosingClass, $)) continue;
        for (const decl of db.ast.getDescendants(comp, $.declaration)) {
          for (const did of db.ast.getDescendants(decl, $.identifier)) {
            if (db.ast.textEqualsNode(did, idNode)) {
              if (hasTypePrefix(db, comp, "constant", $)) {
                db.diagnostic(target, idNode);
              }
              return;
            }
            break;
          }
        }
      }
    },
  },

  /**
   * M5009: Assignment to function input parameter (MLS §12.2).
   *
   * Formal `input` parameters of a `function` are read-only and cannot appear on the LHS
   * of an assignment statement.
   */
  assignmentToInput: {
    nodes: ["assignment_statement"],
    severity: "error",
    code: 5009,
    message: (node, idNode) =>
      `Trying to assign to input component ${idNode && idNode.text ? idNode.text : node.text}.`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      // Verify the statement is inside a `function` and check if the target carries `input`
      const target = db.ast.getChildByFieldId(node, "target");
      if (target == 0) return;
      let idNode: u32 = 0;
      for (const id of db.ast.getDescendants(target, $.identifier)) {
        idNode = id;
        break;
      }
      if (idNode == 0) return;

      let enclosingClass: u32 = 0;
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.class_definition) {
          enclosingClass = anc;
          break;
        }
      }
      if (enclosingClass == 0) return;
      if (!isClassKind(db, enclosingClass, "function")) return;

      for (const comp of db.ast.getDescendants(enclosingClass, $.component_clause)) {
        if (isDescendantOfInnerClass(db, comp, enclosingClass, $)) continue;
        for (const decl of db.ast.getDescendants(comp, $.declaration)) {
          for (const did of db.ast.getDescendants(decl, $.identifier)) {
            if (db.ast.textEqualsNode(did, idNode)) {
              if (hasTypePrefix(db, comp, "input", $)) {
                db.diagnostic(target, idNode);
              }
              return;
            }
            break;
          }
        }
      }
    },
  },

  /**
   * M5013: Argument to inStream() or actualStream() must be a stream variable (MLS §15.2, §15.3).
   *
   * Stream operators may only be applied to connector components declared with the `stream` prefix.
   */
  notAStreamVariable: {
    nodes: ["component_reference"],
    severity: "error",
    code: 5013,
    message: (target, argNode, fnName) => {
      const aText = argNode && argNode.text ? argNode.text : target.text;
      const fText = fnName && fnName.text ? fnName.text : "inStream";
      return `Operand '${aText}' to operator '${fText}' is not a stream variable.`;
    },
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      // Match calls to `inStream(...)` or `actualStream(...)` and check the argument's `stream` prefix
      if (!db.ast.textEquals(node, "inStream") && !db.ast.textEquals(node, "actualStream")) {
        return;
      }
      const next = db.ast.getNextSibling(node);
      if (next == 0 || db.ast.getType(next) != $.function_call_args) {
        return;
      }

      let enclosingClass: u32 = 0;
      for (const cls of db.ast.getAncestors(node)) {
        if (db.ast.getType(cls) == $.class_definition) {
          enclosingClass = cls;
          break;
        }
      }
      if (enclosingClass == 0) return;

      let argNode: u32 = 0;
      for (const arg of db.ast.getDescendants(next, $.component_reference)) {
        argNode = arg;
        break;
      }
      if (argNode == 0) {
        for (const arg of db.ast.getDescendants(next, $.identifier)) {
          argNode = arg;
          break;
        }
      }
      if (argNode != 0) {
        if (!isStreamVariable(db, enclosingClass, argNode, $)) {
          db.diagnostic(argNode, argNode, node);
        }
      } else {
        let targetArg: u32 = 0;
        if ($.function_argument != 0) {
          for (const arg of db.ast.getDescendants(next, $.function_argument)) {
            targetArg = arg;
            break;
          }
        }
        if (targetArg == 0 && $.function_arguments != 0) {
          for (const args of db.ast.getDescendants(next, $.function_arguments)) {
            targetArg = args;
            break;
          }
        }
        if (targetArg != 0) {
          db.diagnostic(targetArg, targetArg, node);
        }
      }
    },
  },

  /**
   * M5007: Iterator in for loop must be a 1D range or vector expression (MLS §8.3.2, §11.2.2).
   *
   * Rejects multi-dimensional nested array constructors (e.g., `{{1, 2}, {3, 4}}`) used as
   * the iteration range of a `for` loop.
   */
  forIteratorNot1D: {
    nodes: ["for_statement", "for_equation"],
    severity: "error",
    code: 5007,
    message: (_node, varNode, packedShape) => {
      const vName = varNode && varNode.text ? varNode.text : "iterator";
      const val = packedShape && packedShape.asNumber ? packedShape.asNumber() : Number(packedShape);
      const typeNum = (val >> 24) & 0xff;
      const d1 = (val >> 12) & 0xfff;
      const d2 = val & 0xfff;
      const typeNames = ["Real", "Integer", "Boolean", "String"];
      const tName = typeNum >= 0 && typeNum < typeNames.length ? typeNames[typeNum] : "Integer";
      const shapeStr = d1 && d2 ? `${tName}[${d1}, ${d2}]` : tName;
      return `Iterator ${vName}, has type ${shapeStr}, but expected a 1D array expression.`;
    },
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      // Inspect each `for_index` range for nested 2D array constructors
      if ($.for_index == 0) return;
      for (const forIdx of db.ast.getDescendants(node, $.for_index)) {
        let varNode = db.ast.getChildByFieldId(forIdx, "variable");
        if (varNode == 0) {
          for (const id of db.ast.getDescendants(forIdx, $.identifier)) {
            varNode = id;
            break;
          }
        }
        let rangeNode = db.ast.getChildByFieldId(forIdx, "range");
        if (rangeNode == 0) continue;

        if ($.array_arguments != 0) {
          let innerArrayCount: u32 = 0;
          let firstInnerArray: u32 = 0;
          let outerArray: u32 = 0;

          for (const args of db.ast.getDescendants(rangeNode, $.array_arguments)) {
            if (outerArray == 0) {
              outerArray = args;
            } else {
              let isDirectInner = true;
              for (const anc of db.ast.getAncestors(args)) {
                if (anc == outerArray) break;
                if (db.ast.getType(anc) == $.array_arguments) {
                  isDirectInner = false;
                  break;
                }
              }
              if (isDirectInner) {
                innerArrayCount++;
                if (firstInnerArray == 0) {
                  firstInnerArray = args;
                }
              }
            }
          }

          if (firstInnerArray != 0) {
            let dim2: u32 = 1;
            if ($.array_arguments_non_first != 0) {
              for (const elem of db.ast.getDescendants(firstInnerArray, $.array_arguments_non_first)) {
                if (elem != 0) {
                  let isNested = false;
                  for (const anc of db.ast.getAncestors(elem)) {
                    if (anc == firstInnerArray) break;
                    if (db.ast.getType(anc) == $.array_arguments) {
                      isNested = true;
                      break;
                    }
                  }
                  if (!isNested) dim2++;
                }
              }
            }

            const elemType = inferExprType(db, firstInnerArray, $);
            let typeNum: u32 = 1;
            if (elemType == TYPE_REAL) typeNum = 0;
            else if (elemType == TYPE_BOOLEAN) typeNum = 2;
            else if (elemType == TYPE_STRING) typeNum = 3;

            const packedShape: u32 = (typeNum << 24) | ((innerArrayCount & 0xfff) << 12) | (dim2 & 0xfff);
            db.diagnostic(forIdx, varNode, packedShape);
            return;
          }
        }
      }
    },
  },

  /**
   * M3010: Unit mismatch in simple equation (MLS §19).
   *
   * Warns when the inferred physical SI units of the LHS and RHS of an equation
   * are dimensionally incompatible.
   */
  unitMismatchEquation: {
    nodes: ["simple_equation"],
    severity: "warning",
    code: 3010,
    message: (target) => `Unit mismatch in equation '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      // Fast-path: skip unit inference if no component in the enclosing class declares a unit
      let classNode: u32 = getEnclosingClass(db, node, $);
      if (classNode == 0 || !hasUnitInClass(db, classNode, $)) return;

      let lhs = db.ast.getChildByFieldId(node, "lhs");
      let rhs = db.ast.getChildByFieldId(node, "rhs");
      if (lhs == 0) lhs = db.ast.getFirstChild(node);
      if (rhs == 0) {
        let afterEq = false;
        let sib = db.ast.getFirstChild(node);
        while (sib != 0) {
          if (db.ast.textEquals(sib, "=")) {
            afterEq = true;
          } else if (afterEq && db.ast.getType(sib) != 0) {
            rhs = sib;
            break;
          }
          sib = db.ast.getNextSibling(sib);
        }
      }

      if (lhs != 0 && rhs != 0) {
        const lhsUnit = inferExprUnit(db, lhs, $, classNode);
        const rhsUnit = inferExprUnit(db, rhs, $, classNode);

        if (lhsUnit != null && rhsUnit != null && !unitsCompatible(lhsUnit, rhsUnit)) {
          db.diagnosticAt(rhs, node, 1);
        }
      }
    },
  },

  /**
   * M3022: Unit mismatch in component declaration binding (MLS §19).
   *
   * Warns when a component with an explicit `unit` attribute is bound to an expression
   * with an incompatible physical unit.
   */
  unitMismatchBinding: {
    nodes: ["component_declaration"],
    severity: "warning",
    code: 3022,
    message: (target) => `Unit mismatch in component binding '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      // Retrieve declared unit on the component and compare against the binding expression's unit
      const compUnit = getComponentUnit(db, node, $);
      if (compUnit == null) return;

      let classNode: u32 = getEnclosingClass(db, node, $);

      let declNode = node;
      if (db.ast.getType(node) == $.component_declaration) {
        let c = db.ast.getFirstChild(node);
        while (c != 0) {
          if (db.ast.getType(c) == $.declaration) {
            declNode = c;
            break;
          }
          c = db.ast.getNextSibling(c);
        }
      }

      let exprNode = 0;
      for (const m of db.ast.getDescendants(declNode, $.modification_expression)) {
        let insideElemMod = false;
        for (const anc of db.ast.getAncestors(m)) {
          if (anc == declNode) break;
          const t = db.ast.getType(anc);
          if (t == $.element_modification || t == $.class_modification) {
            insideElemMod = true;
            break;
          }
        }
        if (!insideElemMod) {
          exprNode = m;
          break;
        }
      }
      if (exprNode == 0) {
        for (const e of db.ast.getDescendants(declNode, $.expression)) {
          let insideElemMod = false;
          for (const anc of db.ast.getAncestors(e)) {
            if (anc == declNode) break;
            const t = db.ast.getType(anc);
            if (t == $.element_modification || t == $.class_modification) {
              insideElemMod = true;
              break;
            }
          }
          if (!insideElemMod) {
            exprNode = e;
            break;
          }
        }
      }

      if (exprNode != 0) {
        const exprUnit = inferExprUnit(db, exprNode, $, classNode);
        if (exprUnit != null && !unitsCompatible(compUnit, exprUnit)) {
          db.diagnosticAt(exprNode, node);
        }
      }
    },
  },

  /**
   * M4031: Array index out of bounds (MLS §10.5).
   *
   * Statically validates constant integer subscripts against the declared 1-based dimension
   * bounds `[1 .. size]` of local array components.
   */
  arrayIndexOutOfBounds: {
    nodes: ["component_reference"],
    severity: "error",
    code: 4031,
    message: (subNode, arrNode, dimIndex, dimSize) => {
      const isConnect = subNode && subNode.text && subNode.text.startsWith("connect");
      const dIdxNum = dimIndex ? Number(dimIndex) : 1;
      let idxText = subNode && subNode.text ? subNode.text : "index";
      if (isConnect && arrNode && arrNode.text) {
        const lb = arrNode.text.indexOf("[");
        const rb = arrNode.text.lastIndexOf("]");
        if (lb >= 0 && rb > lb) {
          const parts = arrNode.text.slice(lb + 1, rb).split(",");
          idxText = (parts[dIdxNum - 1] ?? parts[0] ?? "index").trim();
        }
      }
      const arrName =
        arrNode && arrNode.text && arrNode.text !== "0"
          ? isConnect
            ? arrNode.text.trim()
            : arrNode.text.split("[")[0]!.trim()
          : "array";
      const dIdx = dimIndex ? String(dimIndex) : "1";
      const dSz = dimSize ? String(dimSize) : "?";
      return `Subscript '${idxText}' for dimension ${dIdx} (size = ${dSz}) of ${arrName} is out of bounds.`;
    },
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      if ($.array_subscripts == 0 || $.subscript == 0) return;
      if ($.if_equation != 0) {
        for (const anc of db.ast.getAncestors(node)) {
          if (db.ast.getType(anc) == $.if_equation) return;
        }
      }
      let subsNode: u32 = 0;
      for (const s of db.ast.getDescendants(node, $.array_subscripts)) {
        subsNode = s;
        break;
      }
      if (subsNode == 0) return;

      // Extract array name
      let arrNameNode: u32 = 0;
      for (const id of db.ast.getDescendants(node, $.identifier)) {
        arrNameNode = id;
        break;
      }
      if (arrNameNode == 0) return;

      // Find declared size from enclosing class/component declaration
      const encClass = getEnclosingClass(db, node, $);
      if (encClass == 0) return;

      let declSubs: u32 = 0;
      for (const compDecl of db.ast.getDescendants(encClass, $.component_declaration)) {
        if (isDescendantOfInnerClass(db, compDecl, encClass, $)) continue;
        let nameNode: u32 = 0;
        for (const decl of db.ast.getDescendants(compDecl, $.declaration)) {
          for (const id of db.ast.getDescendants(decl, $.identifier)) {
            nameNode = id;
            break;
          }
          if (nameNode != 0) break;
        }
        if (nameNode != 0 && db.ast.textEqualsNode(nameNode, arrNameNode)) {
          // Look for array_subscripts on compDecl first (e.g. Real x[1, 3])
          for (const s of db.ast.getDescendants(compDecl, $.array_subscripts)) {
            declSubs = s;
            break;
          }
          if (declSubs == 0) {
            // Look for array_subscripts on component_clause (e.g. Real[2, 6] x)
            for (const anc of db.ast.getAncestors(compDecl)) {
              const ancType = db.ast.getType(anc);
              if (ancType == $.component_clause || ancType == $.component_clause1) {
                for (const s of db.ast.getDescendants(anc, $.array_subscripts)) {
                  declSubs = s;
                  break;
                }
                break;
              }
            }
          }
          break;
        }
      }
      if (declSubs == 0) return;

      // Check each subscript in use
      let dimIdx = 1;
      for (const sub of db.ast.getDescendants(subsNode, $.subscript)) {
        // Find dimension size for dimension dimIdx
        let curDim = 1;
        let dimSize = 0;
        let isDimDynamic = false;
        for (const dSub of db.ast.getDescendants(declSubs, $.subscript)) {
          if (curDim == dimIdx) {
            for (const _ of db.ast.getDescendants(dSub, $.identifier)) {
              isDimDynamic = true;
              break;
            }
            if (!isDimDynamic) {
              for (const num of db.ast.getDescendants(dSub, $.unsigned_integer)) {
                dimSize = db.ast.parseInteger(num);
                break;
              }
            }
            break;
          }
          curDim++;
        }

        if (!isDimDynamic && dimSize > 0) {
          let hasIdent = false;
          for (const _ of db.ast.getDescendants(sub, $.identifier)) {
            hasIdent = true;
            break;
          }
          if (!hasIdent) {
            let numCount: u32 = 0;
            let firstNum: u32 = 0;
            for (const num of db.ast.getDescendants(sub, $.unsigned_integer)) {
              numCount++;
              if (firstNum == 0) firstNum = num;
            }
            // Only validate when subscript is a single integer literal (or negative integer literal), not a range 1:3 or binary op 1+1
            if (numCount == 1 && firstNum != 0) {
              const val = db.ast.parseInteger(sub);
              if (val < 1 || val > dimSize) {
                let connectNode: u32 = 0;
                if ($.connect_equation) {
                  for (const cc of db.ast.getDescendants(encClass, $.connect_equation)) {
                    for (const cr of db.ast.getDescendants(cc, $.component_reference)) {
                      if (cr === node) {
                        connectNode = cc;
                        break;
                      }
                    }
                    if (connectNode !== 0) break;
                  }
                }
                if (connectNode !== 0) {
                  db.diagnostic(connectNode, node, dimIdx, dimSize);
                } else {
                  db.diagnostic(sub, arrNameNode, dimIdx, dimSize);
                }
                return;
              }
            }
          }
        }
        dimIdx++;
      }
    },
  },

  /**
   * M4076: Parameter lower bound exceeds upper bound (MLS §4.8).
   *
   * Reports an error when a parameter's `min` attribute modification is strictly greater
   * than its `max` attribute modification.
   */
  parameterBoundContradiction: {
    nodes: ["component_declaration", "component_declaration1"],
    severity: "error",
    code: 4076,
    message: (node, lowerNode, upperNode, declNode) => {
      let pName = "parameter";
      const src = declNode && declNode.text && declNode.text !== "0" ? declNode : node;
      if (src && src.text) {
        const parts = src.text.split("(")[0]!.split("=");
        pName = parts[0]!.trim();
      }
      const lVal = lowerNode && lowerNode.text ? lowerNode.text : "min";
      const uVal = upperNode && upperNode.text ? upperNode.text : "max";
      return `Contradictory bounds for parameter '${pName}': lower bound '${lVal}' exceeds upper bound '${uVal}'.`;
    },
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      // Must be parameter variability
      let isParam = false;
      for (const anc of db.ast.getAncestors(node)) {
        const ancType = db.ast.getType(anc);
        if (ancType == $.component_clause || ancType == $.component_clause1) {
          for (const prefix of db.ast.getDescendants(anc, $.type_prefix)) {
            if (db.ast.textEquals(prefix, "parameter")) {
              isParam = true;
              break;
            }
          }
          break;
        }
      }
      if (!isParam) return;

      // Check for min and max element modifications with simple numeric literal bounds
      let minVal: f64 = -(OCTAGON_INF as f64);
      let maxVal: f64 = OCTAGON_INF as f64;
      let minNode: u32 = 0;
      let maxNode: u32 = 0;

      for (const mod of db.ast.getDescendants(node, $.element_modification)) {
        let isNestedMod = false;
        for (const anc of db.ast.getAncestors(mod)) {
          if (anc == node) break;
          if (db.ast.getType(anc) == $.element_modification) {
            isNestedMod = true;
            break;
          }
        }
        if (isNestedMod) continue;
        let nameId = db.ast.getChildByFieldId(mod, "name");
        if (nameId == 0) {
          for (const n of db.ast.getDescendants(mod, $.name)) {
            nameId = n;
            break;
          }
        }
        if (nameId == 0) continue;
        const isMin = db.ast.textEquals(nameId, "min");
        const isMax = !isMin && db.ast.textEquals(nameId, "max");
        if (!isMin && !isMax) continue;

        const modClause = db.ast.getChildByFieldId(mod, "modification");
        const modExpr = modClause != 0 ? db.ast.getChildByFieldId(modClause, "modification_expression") : 0;
        let expr: u32 = 0;
        if (modExpr != 0) {
          for (const e of db.ast.getDescendants(modExpr, $.expression)) {
            expr = e;
            break;
          }
        } else {
          for (const e of db.ast.getDescendants(mod, $.expression)) {
            expr = e;
            break;
          }
        }
        if (expr != 0 && isSimpleNumericLiteral(db, expr, $)) {
          if (isMin) {
            minVal = db.ast.parseReal(expr);
            minNode = expr;
          } else {
            maxVal = db.ast.parseReal(expr);
            maxNode = expr;
          }
        }
      }

      if (minNode != 0 && maxNode != 0 && minVal > maxVal) {
        db.diagnostic(minNode, minNode, maxNode, node);
      }
    },
  },

  /**
   * M3023: Comparing Real values with `==` or `<>` outside a function (MLS §3.5).
   *
   * Equality/inequality checks on floating-point Real expressions outside functions
   * are unreliable and disallowed in Modelica 3.5+ relational equations.
   */
  realEqualityComparison: {
    nodes: ["expression", "lhs_expression"],
    severity: "warning",
    code: 3023,
    message: (target, opNode) =>
      `Comparing Real expressions in '${target.text}' with '${opNode ? opNode.text : "=="}' outside a function is discouraged per Modelica specification §3.5.`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      let opTok: u32 = 0;
      let left: u32 = db.ast.getChildByFieldId(node, "left");
      let right: u32 = db.ast.getChildByFieldId(node, "right");

      for (const tok of db.ast.getDescendants(node)) {
        if (db.ast.getFirstChild(tok) == 0 && (db.ast.textEquals(tok, "==") || db.ast.textEquals(tok, "<>"))) {
          let belongsToNode = true;
          for (const anc of db.ast.getAncestors(tok)) {
            if (anc == node) break;
            const at = db.ast.getType(anc);
            if (at == $.expression || at == $.lhs_expression || at == $.primary || at == $.lhs_primary) {
              belongsToNode = false;
              break;
            }
          }
          if (belongsToNode) {
            opTok = tok;
            break;
          }
        }
      }
      if (opTok == 0) return;

      if (left == 0 || right == 0) {
        let cur: u32 = opTok;
        for (const p of db.ast.getAncestors(opTok)) {
          let sib = db.ast.getFirstChild(p);
          let prevSib: u32 = 0;
          while (sib != 0 && sib != cur) {
            prevSib = sib;
            sib = db.ast.getNextSibling(sib);
          }
          const nextSib = db.ast.getNextSibling(cur);
          if (left == 0 && prevSib != 0) left = prevSib;
          if (right == 0 && nextSib != 0) right = nextSib;
          if ((left != 0 && right != 0) || p == node) break;
          cur = p;
        }
      }
      if (left == 0 || right == 0) return;

      for (const anc of db.ast.getAncestors(node)) {
        const at = db.ast.getType(anc);
        if ($.annotation_clause != 0 && at == $.annotation_clause) return;
        if (at == $.class_definition) break;
      }

      const cls = getEnclosingClass(db, node, $);
      if (cls != 0 && isClassKind(db, cls, "function")) return;

      const lt = inferExprType(db, left, $);
      const rt = inferExprType(db, right, $);
      if (lt == TYPE_REAL || rt == TYPE_REAL) {
        db.diagnostic(node, opTok);
      }
    },
  },

  /**
   * M5051: `der(...)` applied to non-Real expression (MLS §3.7.4).
   *
   * The time derivative operator `der(expr)` is only valid on continuous-time
   * `Real` expressions and cannot be applied to `Integer`, `Boolean`, or `String` values.
   */
  derOfNonReal: {
    nodes: ["primary", "lhs_primary"],
    severity: "warning",
    code: 5051,
    message: (target) => `Argument '${target.text}' of 'der(...)' must have type Real.`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      if (!db.ast.startsWith(node, "der")) return;
      let fc = db.ast.getFirstChild(node);
      while (fc != 0 && db.ast.getFirstChild(fc) != 0) {
        fc = db.ast.getFirstChild(fc);
      }
      if (fc == 0 || !db.ast.textEquals(fc, "der")) return;

      for (const anc of db.ast.getAncestors(node)) {
        const at = db.ast.getType(anc);
        if ($.annotation_clause != 0 && at == $.annotation_clause) return;
        if (at == $.class_definition) break;
      }

      let argList = db.ast.getChildByFieldId(node, "argument");
      if (argList == 0 && $.expression_list != 0) {
        for (const el of db.ast.getDescendants(node, $.expression_list)) {
          let belongsToNode = true;
          for (const anc of db.ast.getAncestors(el)) {
            if (anc == node) break;
            const at = db.ast.getType(anc);
            if (at == $.primary || at == $.lhs_primary) {
              belongsToNode = false;
              break;
            }
          }
          if (belongsToNode) {
            argList = el;
            break;
          }
        }
      }
      if (argList == 0) return;

      let argExpr: u32 = 0;
      for (const e of db.ast.getDescendants(argList, $.expression)) {
        argExpr = e;
        break;
      }
      if (argExpr == 0) return;

      // Array/matrix constructors ([...] / {...}) can hold mixed or Integer elements that
      // implicitly promote to Real when vectorized in `der(...)`.
      if (db.ast.startsWith(argExpr, "[") || db.ast.startsWith(argExpr, "{")) return;

      const t = inferExprType(db, argExpr, $);
      if (t == TYPE_INTEGER || t == TYPE_BOOLEAN || t == TYPE_STRING) {
        db.diagnostic(argExpr);
      }
    },
  },
};

import type { CodeGraph, CompilerLint, u16, u32 } from "@modelscript/language";
import {
  getVariableTypeInClass,
  inferExprType,
  isTypeCompatible,
  TYPE_BOOLEAN,
  TYPE_CLOCK,
  TYPE_INTEGER,
  TYPE_REAL,
  TYPE_STRING,
  TYPE_UNKNOWN,
} from "./helpers.js";

export const modelicaTypeLints: Record<string, CompilerLint> = {
  /**
   * M3001: Type mismatch in binding equation.
   */
  typeMismatchBinding: {
    nodes: ["component_declaration"],
    severity: "error",
    code: 3001,
    message: (target) => `Type mismatch in binding or modification expression '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let expectedType: u16 = TYPE_UNKNOWN;
      for (const anc of db.ast.getAncestors(node, 0)) {
        const ancType = db.ast.getType(anc);
        if (ancType == $.component_clause || ancType == $.component_clause1) {
          for (const id of db.ast.getDescendants(anc, $.identifier)) {
            if (db.ast.textEquals(id, "Real")) expectedType = TYPE_REAL;
            else if (db.ast.textEquals(id, "Integer")) expectedType = TYPE_INTEGER;
            else if (db.ast.textEquals(id, "Boolean")) expectedType = TYPE_BOOLEAN;
            else if (db.ast.textEquals(id, "String")) expectedType = TYPE_STRING;
            else if (db.ast.textEquals(id, "Clock")) expectedType = TYPE_CLOCK;
            break;
          }
          break;
        }
      }
      if (expectedType == TYPE_UNKNOWN) return;

      if (expectedType == TYPE_REAL || expectedType == TYPE_INTEGER || expectedType == TYPE_BOOLEAN) {
        let foundStr = false;
        if ($.string_literal != 0) {
          for (const str of db.ast.getDescendants(node, $.string_literal)) {
            db.diagnostic(str);
            foundStr = true;
            break;
          }
        }
        if (!foundStr) {
          for (const d of db.ast.getDescendants(node, 0)) {
            if (db.ast.getType(d) == $.string_literal || (db.ast.getFirstChild(d) == 0 && db.ast.startsWith(d, '"'))) {
              db.diagnostic(d);
              break;
            }
          }
        }
      } else if (expectedType == TYPE_STRING) {
        for (const num of db.ast.getDescendants(node, $.unsigned_real)) {
          db.diagnostic(num);
        }
        for (const num of db.ast.getDescendants(node, $.unsigned_integer)) {
          db.diagnostic(num);
        }
      }
    },
  },

  /**
   * M3001: Type mismatch in element modification expression.
   */
  typeMismatchModification: {
    nodes: ["element_modification"],
    severity: "error",
    code: 3001,
    message: (target) => `Type mismatch in binding or modification expression '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let nameNode: u32 = 0;
      for (const n of db.ast.getDescendants(node, $.name)) {
        nameNode = n;
        break;
      }
      if (nameNode == 0) return;

      // Find enclosing component_clause1, element_redeclaration, component_clause, or extends_clause
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

      let expectedType: u16 = TYPE_UNKNOWN;

      // 1. Primitive types
      if (db.ast.textEquals(baseTypeId, "Real")) {
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
        }
      } else if (db.ast.textEquals(baseTypeId, "Integer")) {
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
        }
      } else if (db.ast.textEquals(baseTypeId, "Boolean")) {
        if (db.ast.textEquals(nameNode, "start") || db.ast.textEquals(nameNode, "fixed")) {
          expectedType = TYPE_BOOLEAN;
        } else if (db.ast.textEquals(nameNode, "quantity")) {
          expectedType = TYPE_STRING;
        }
      } else if (db.ast.textEquals(baseTypeId, "String")) {
        if (db.ast.textEquals(nameNode, "start") || db.ast.textEquals(nameNode, "quantity")) {
          expectedType = TYPE_STRING;
        }
      } else {
        // 2. User-defined classes
        const docRoot = db.ast.getRootNode();
        if (docRoot != 0) {
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
              expectedType = getVariableTypeInClass(db, classDef, nameNode, $);
              break;
            }
          }
          if (expectedType == TYPE_UNKNOWN) {
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
                expectedType = getVariableTypeInClass(db, classDef, nameNode, $);
                break;
              }
            }
          }
        }
      }

      if (expectedType == TYPE_UNKNOWN) return;

      if (expectedType == TYPE_REAL || expectedType == TYPE_INTEGER || expectedType == TYPE_BOOLEAN) {
        let foundStr = false;
        if ($.string_literal != 0) {
          for (const str of db.ast.getDescendants(node, $.string_literal)) {
            db.diagnostic(str);
            foundStr = true;
            break;
          }
        }
        if (!foundStr) {
          for (const d of db.ast.getDescendants(node, 0)) {
            if (db.ast.getType(d) == $.string_literal || (db.ast.getFirstChild(d) == 0 && db.ast.startsWith(d, '"'))) {
              db.diagnostic(d);
              break;
            }
          }
        }
      } else if (expectedType == TYPE_STRING) {
        for (const num of db.ast.getDescendants(node, $.unsigned_real)) {
          db.diagnostic(num);
        }
        for (const num of db.ast.getDescendants(node, $.unsigned_integer)) {
          db.diagnostic(num);
        }
      }
    },
  },

  /**
   * M3009: Array index must be Integer or Boolean.
   */
  arrayIndexTypeMismatch: {
    nodes: ["subscript"],
    severity: "error",
    code: 3009,
    message: (target) => `Array index '${target.text}' has invalid type: expected Integer or Boolean.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const idxType = inferExprType(db, node, $);
      if (idxType != TYPE_UNKNOWN && idxType != TYPE_INTEGER && idxType != 2 /* Boolean */) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M5001: Type mismatch in equation `lhs = rhs`.
   */
  equationTypeMismatch: {
    nodes: ["simple_equation"],
    severity: "error",
    code: 5001,
    message: (target) => `Type mismatch in equation '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let lhs = db.ast.getChildByFieldId(node, "lhs");
      let rhs = db.ast.getChildByFieldId(node, "rhs");
      if (lhs == 0) lhs = db.ast.getFirstChild(node);
      if (rhs == 0 && lhs != 0) {
        let sib = db.ast.getNextSibling(lhs);
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
        if (lhsType != TYPE_UNKNOWN && rhsType != TYPE_UNKNOWN) {
          if (!isTypeCompatible(rhsType, lhsType) && !isTypeCompatible(lhsType, rhsType)) {
            db.diagnostic(node);
          }
        }
      }
    },
  },

  /**
   * M5005: Division by literal zero.
   */
  divisionByZero: {
    nodes: ["expression"],
    severity: "error",
    code: 5005,
    message: (target) => `Division by literal zero in '${target.text}'.`,
    query: (db: CodeGraph, node: u32) => {
      const rightChild = db.ast.getChildByFieldId(node, "right");
      if (rightChild != 0) {
        if (db.ast.textEquals(rightChild, "0") || db.ast.textEquals(rightChild, "0.0")) {
          db.diagnostic(rightChild);
        }
      }
    },
  },

  /**
   * M5006: Type mismatch in assignment `target := expr`.
   */
  assignmentTypeMismatch: {
    nodes: ["assignment_statement"],
    severity: "error",
    code: 5006,
    message: (target) => `Type mismatch in assignment statement '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const target = db.ast.getChildByFieldId(node, "target");
      const value = db.ast.getChildByFieldId(node, "value");
      if (target != 0 && value != 0) {
        const targetType = inferExprType(db, target, $);
        const valType = inferExprType(db, value, $);
        if (targetType != TYPE_UNKNOWN && valType != TYPE_UNKNOWN) {
          if (!isTypeCompatible(valType, targetType)) {
            db.diagnostic(node);
          }
        }
      }
    },
  },

  /**
   * M5008: Assignment to constant component.
   */
  assignmentToConstant: {
    nodes: ["assignment_statement"],
    severity: "error",
    code: 5008,
    message: (target) => `Trying to assign to constant component '${target.text}'.`,
    query: (db: CodeGraph, node: u32) => {
      const target = db.ast.getChildByFieldId(node, "target");
      if (target != 0) {
        const symId = db.scope.resolve(target);
        if (symId != 0 && db.model.hasFlag(symId, "isConstant")) {
          db.diagnostic(target);
        }
      }
    },
  },

  /**
   * M5009: Assignment to function input parameter.
   */
  assignmentToInput: {
    nodes: ["assignment_statement"],
    severity: "error",
    code: 5009,
    message: (target) => `Trying to assign to input component '${target.text}'.`,
    query: (db: CodeGraph, node: u32) => {
      const target = db.ast.getChildByFieldId(node, "target");
      if (target != 0) {
        const symId = db.scope.resolve(target);
        if (symId != 0 && db.model.hasFlag(symId, "isInput")) {
          db.diagnostic(target);
        }
      }
    },
  },

  /**
   * M5013: Argument to inStream() must be a stream variable.
   */
  notAStreamVariable: {
    nodes: ["function_call"],
    severity: "error",
    code: 5013,
    message: (target) => `Operand '${target.text}' is not a stream variable.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const nameNode = db.ast.getChildByFieldId(node, "name");
      if (nameNode != 0 && (db.ast.textEquals(nameNode, "inStream") || db.ast.textEquals(nameNode, "actualStream"))) {
        let argNode: u32 = 0;
        for (const arg of db.ast.getDescendants(node, $.function_argument)) {
          argNode = arg;
          break;
        }
        if (argNode != 0) {
          const symId = db.scope.resolve(argNode);
          if (symId != 0 && !db.model.hasFlag(symId, "isStream")) {
            db.diagnostic(argNode);
          }
        }
      }
    },
  },

  /**
   * M5007: Iterator in for loop must be a 1D range or array expression.
   */
  forIteratorNot1D: {
    nodes: ["for_index"],
    severity: "error",
    code: 5007,
    message: (target) => `Iterator in '${target.text}' must evaluate to a 1D sequence or array expression.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const expr = db.ast.getChildByFieldId(node, "expression");
      if (expr != 0) {
        const type = inferExprType(db, expr, $);
        if (type != TYPE_UNKNOWN && type != TYPE_INTEGER && type != 4 /* Enum */) {
          db.diagnostic(node);
        }
      }
    },
  },
};

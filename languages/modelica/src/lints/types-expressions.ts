import type { CodeGraph, CompilerLint, u16, u32 } from "@modelscript/language";
import { inferExprType, isTypeCompatible, TYPE_INTEGER, TYPE_UNKNOWN } from "./helpers.js";

export const modelicaTypeLints: Record<string, CompilerLint> = {
  /**
   * M3001: Type mismatch in binding equation.
   */
  typeMismatchBinding: {
    nodes: ["component_declaration"],
    severity: "error",
    code: 3001,
    message: "Type mismatch in binding.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let bindingNode: u32 = 0;
      for (const mod of db.ast.getDescendants(node, $.modification_expression)) {
        bindingNode = mod;
        break;
      }
      if (bindingNode == 0) return;

      const symId = db.scope.resolve(node);
      if (symId == 0) return;

      const expectedType = db.model.getProperty(symId, "baseType") as u16;
      const actualType = inferExprType(db, bindingNode, $);

      if (expectedType != TYPE_UNKNOWN && actualType != TYPE_UNKNOWN) {
        if (!isTypeCompatible(actualType, expectedType)) {
          db.diagnostic(bindingNode);
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
    message: "Array index type mismatch: expected Integer or Boolean.",
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
    message: "Type mismatch in equation.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const lhs = db.ast.getChildByFieldId(node, "lhs");
      const rhs = db.ast.getChildByFieldId(node, "rhs");
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
    nodes: ["div_expression"],
    severity: "error",
    code: 5005,
    message: "Division by zero.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const rightChild = db.ast.getChildByFieldId(node, "right");
      if (rightChild != 0) {
        const type = db.ast.getType(rightChild);
        if (type == $.unsigned_integer && db.ast.textEquals(rightChild, "0")) {
          db.diagnostic(node);
        } else if (
          type == $.unsigned_real &&
          (db.ast.textEquals(rightChild, "0.0") || db.ast.textEquals(rightChild, "0"))
        ) {
          db.diagnostic(node);
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
    message: "Type mismatch in assignment.",
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
    message: "Trying to assign to constant component.",
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
    message: "Trying to assign to input component.",
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
    message: "Operand is not a stream variable.",
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
};

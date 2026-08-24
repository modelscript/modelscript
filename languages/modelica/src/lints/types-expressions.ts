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
    message: (target) => `Type mismatch in binding expression '${target.text}'.`,
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

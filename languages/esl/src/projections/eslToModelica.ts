// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects ESA ESL models into clean, executable Modelica 3.x code.
 */

import { parseEsl } from "../parser/esl-parser.js";
import type { EslBlock, EslExpr, EslProgram, EslStatement } from "../types.js";

function exprToModelica(expr: EslExpr): string {
  switch (expr.kind) {
    case "number":
      return Number.isInteger(expr.value) ? `${expr.value}.0` : String(expr.value);
    case "boolean":
      return expr.value ? "true" : "false";
    case "string":
      return JSON.stringify(expr.value);
    case "identifier": {
      const up = expr.name.toUpperCase();
      if (up === "T" || up === "TIME") return "time";
      if (up === "PI") return "Modelica.Constants.pi";
      return expr.name;
    }
    case "derivative":
      return `der(${expr.target})`;
    case "unary": {
      const inner = exprToModelica(expr.operand);
      if (expr.op === "NOT") return `not (${inner})`;
      return `${expr.op}(${inner})`;
    }
    case "binary": {
      const l = exprToModelica(expr.left);
      const r = exprToModelica(expr.right);
      let op: string = expr.op;
      if (op === "**") op = "^";
      else if (op === "=" || op === "==") op = "==";
      else if (op === "/=" || op === "!=") op = "<>";
      else if (op === "AND") op = "and";
      else if (op === "OR") op = "or";
      return `(${l} ${op} ${r})`;
    }
    case "conditional":
      return `(if ${exprToModelica(expr.condition)} then ${exprToModelica(expr.thenExpr)} else ${exprToModelica(expr.elseExpr)})`;
    case "call": {
      const fnUpper = expr.callee.toUpperCase();
      const args = expr.args.map(exprToModelica);
      const lowerBuiltin: Record<string, string> = {
        SIN: "sin",
        COS: "cos",
        TAN: "tan",
        SQRT: "sqrt",
        ABS: "abs",
        EXP: "exp",
        LOG: "log",
        LN: "log",
        LOG10: "log10",
        ASIN: "asin",
        ACOS: "acos",
        ATAN: "atan",
        ATAN2: "atan2",
        SIGN: "sign",
        MIN: "min",
        MAX: "max",
      };
      const mapped = lowerBuiltin[fnUpper];
      if (mapped) return `${mapped}(${args.join(", ")})`;
      if (fnUpper === "LIMIT" && args.length === 3) {
        return `min(${args[1]}, max(${args[0]}, ${args[2]}))`;
      }
      return `${expr.callee}(${args.join(", ")})`;
    }
  }
}

function stmtToModelica(stmt: EslStatement, indent: string, inWhen = false): string[] {
  switch (stmt.kind) {
    case "assign": {
      const rhs = exprToModelica(stmt.value);
      if (stmt.isDerivative) {
        return [`${indent}der(${stmt.target}) = ${rhs};`];
      }
      if (inWhen) {
        return [`${indent}reinit(${stmt.target}, ${rhs});`];
      }
      return [`${indent}${stmt.target} = ${rhs};`];
    }
    case "when": {
      const lines: string[] = [`${indent}when ${exprToModelica(stmt.condition)} then`];
      for (const s of stmt.body) {
        lines.push(...stmtToModelica(s, `${indent}  `, true));
      }
      lines.push(`${indent}end when;`);
      return lines;
    }
    case "if": {
      const lines: string[] = [`${indent}if ${exprToModelica(stmt.condition)} then`];
      for (const s of stmt.thenBody) {
        lines.push(...stmtToModelica(s, `${indent}  `, inWhen));
      }
      if (stmt.elseBody.length > 0) {
        lines.push(`${indent}else`);
        for (const s of stmt.elseBody) {
          lines.push(...stmtToModelica(s, `${indent}  `, inWhen));
        }
      }
      lines.push(`${indent}end if;`);
      return lines;
    }
    case "terminate":
      return [
        `${indent}when ${exprToModelica(stmt.condition)} then`,
        `${indent}  terminate("ESL TERMINATE condition triggered");`,
        `${indent}end when;`,
      ];
    case "submodel_call":
      return [`${indent}// Submodel call: ${stmt.callee}(${stmt.args.map(exprToModelica).join(", ")})`];
    default:
      return [];
  }
}

function blockToModelica(block: EslBlock): string {
  const modelName = block.name.replace(/[^A-Za-z0-9_]/g, "_");
  const lines: string[] = [];
  lines.push(`// Modelica projection generated from ESA ESL ${block.kind}: ${block.name}`);
  lines.push(`model ${modelName}`);

  for (const decl of block.declarations) {
    const moType = decl.dataType === "INTEGER" ? "Integer" : decl.dataType === "LOGICAL" ? "Boolean" : "Real";
    const prefix = decl.isConstant ? "parameter " : "";
    if (decl.initialValue) {
      const initStr = exprToModelica(decl.initialValue);
      if (decl.isConstant) {
        lines.push(`  ${prefix}${moType} ${decl.name} = ${initStr};`);
      } else {
        lines.push(`  ${moType} ${decl.name}(start = ${initStr});`);
      }
    } else {
      lines.push(`  ${prefix}${moType} ${decl.name};`);
    }
  }

  if (block.initialStatements.length > 0) {
    lines.push("initial equation");
    for (const stmt of block.initialStatements) {
      lines.push(...stmtToModelica(stmt, "  ", false));
    }
  }

  if (block.dynamicStatements.length > 0) {
    lines.push("equation");
    for (const stmt of block.dynamicStatements) {
      lines.push(...stmtToModelica(stmt, "  ", false));
    }
  }

  lines.push(`end ${modelName};`);
  return lines.join("\n");
}

/**
 * Projects an ESA ESL program (or source string) into executable Modelica 3.x source code.
 */
export function eslToModelica(programOrSource: EslProgram | string, modelName?: string): string {
  const program = typeof programOrSource === "string" ? parseEsl(programOrSource) : programOrSource;
  let target: EslBlock | undefined;
  if (modelName) {
    target = program.models.get(modelName) ?? program.segments.get(modelName);
  }
  if (!target) {
    target = Array.from(program.models.values())[0] ?? program.studies[0] ?? program.blocks[0];
  }
  if (!target) {
    return `model EmptyEslModel\nend EmptyEslModel;`;
  }
  return blockToModelica(target);
}

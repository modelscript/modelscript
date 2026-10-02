// SPDX-License-Identifier: AGPL-3.0-or-later

import wabt from "wabt";
import { unwrapNode } from "../queries.js";

export function toWasmType(typeStr?: string): string {
  if (!typeStr) return "i32";
  const trimmed = typeStr.trim();
  switch (trimmed) {
    case "i32":
    case "u32":
    case "bool":
    case "usize":
      return "i32";
    case "i64":
    case "u64":
      return "i64";
    case "f32":
      return "f32";
    case "f64":
      return "f64";
    case "void":
      return "void";
    default:
      return "i32"; // Pointers to structs/arrays are i32 in WASM32
  }
}

export class WasmEmitter {
  private locals = new Map<string, string>(); // name -> wasmType
  private loopCounter = 0;

  emitWat(rawRootNode: any): string {
    const rootNode = unwrapNode(rawRootNode);
    this.loopCounter = 0;

    const functionsWat: string[] = [];
    const topLevelStmts: any[] = [];
    const topLevelLocals = new Map<string, string>();

    for (let i = 0; i < rootNode.childCount; i++) {
      const child = unwrapNode(rootNode.child(i));
      if (!child || child.type === ";" || child.type === "_EmptyStatement") continue;

      if (child.type === "FunctionDeclaration") {
        functionsWat.push(this.emitFunction(child));
      } else if (child.type === "StructDeclaration" || child.type === "ImportDeclaration") {
        // Struct declarations and imports handled semantically
        continue;
      } else {
        topLevelStmts.push(child);
        this.collectLocals(child, topLevelLocals);
      }
    }

    if (topLevelStmts.length > 0) {
      this.locals = new Map(topLevelLocals);
      const mainLines: string[] = [];
      mainLines.push("  (func $main (result i32)");
      for (const [name, type] of topLevelLocals) {
        mainLines.push(`    (local $${name} ${type})`);
      }
      for (const stmt of topLevelStmts) {
        mainLines.push(this.emitStatement(stmt, "    "));
      }
      mainLines.push("    i32.const 0");
      mainLines.push("    return");
      mainLines.push("  )");
      mainLines.push('  (export "main" (func $main))');
      functionsWat.push(mainLines.join("\n"));
    }

    return ["(module", '  (memory (export "memory") 1)', ...functionsWat, ")"].join("\n");
  }

  async compile(rootNode: any): Promise<Uint8Array> {
    const wat = this.emitWat(rootNode);
    const wabtModule = await (wabt as any)();
    const parsed = wabtModule.parseWat("module.wat", wat);
    const { buffer } = parsed.toBinary({});
    return buffer;
  }

  private collectLocals(node: any, locals: Map<string, string>): void {
    if (!node) return;
    const unwrapped = unwrapNode(node);
    if (!unwrapped) return;

    if (unwrapped.type === "VariableDeclaration") {
      const name = unwrapped.childForFieldName?.("name")?.text;
      const typeStr = unwrapped.childForFieldName?.("type")?.text;
      const valNode = unwrapped.childForFieldName?.("value");
      let wasmType = toWasmType(typeStr);
      if (!typeStr && valNode) {
        const valText = valNode.text || "";
        if (valText.includes(".") || valText.toLowerCase().includes("e")) {
          wasmType = "f64";
        }
      }
      if (name) locals.set(name, wasmType);
    }

    for (let i = 0; i < unwrapped.childCount; i++) {
      this.collectLocals(unwrapped.child(i), locals);
    }
  }

  private emitFunction(node: any): string {
    const name = node.childForFieldName?.("name")?.text || "fn";
    const paramsNode = node.childForFieldName?.("parameters");
    const returnTypeStr = node.childForFieldName?.("returnType")?.text;
    const retType = toWasmType(returnTypeStr || "i32");
    const bodyNode = node.childForFieldName?.("body");

    this.locals.clear();
    const paramsList: string[] = [];

    if (paramsNode) {
      for (let i = 0; i < paramsNode.childCount; i++) {
        const param = paramsNode.child(i);
        if (param.type === "Parameter") {
          const pName = param.childForFieldName?.("name")?.text;
          const pType = toWasmType(param.childForFieldName?.("type")?.text);
          if (pName) {
            this.locals.set(pName, pType);
            paramsList.push(`(param $${pName} ${pType})`);
          }
        }
      }
    }

    // Collect inner locals
    const fnLocals = new Map<string, string>();
    this.collectLocals(bodyNode, fnLocals);
    for (const [pName] of this.locals) {
      fnLocals.delete(pName); // Parameters are already declared
    }
    for (const [lName, lType] of fnLocals) {
      this.locals.set(lName, lType);
    }

    const lines: string[] = [];
    const paramsStr = paramsList.length > 0 ? " " + paramsList.join(" ") : "";
    const resultStr = retType !== "void" ? ` (result ${retType})` : "";
    lines.push(`  (func $${name}${paramsStr}${resultStr}`);

    for (const [lName, lType] of fnLocals) {
      lines.push(`    (local $${lName} ${lType})`);
    }

    if (bodyNode) {
      lines.push(this.emitBlock(bodyNode, "    "));
    }

    if (retType !== "void") {
      lines.push(`    ${retType === "f64" ? "f64.const 0" : "i32.const 0"}`);
      lines.push("    return");
    }

    lines.push("  )");
    lines.push(`  (export "${name}" (func $${name}))`);

    return lines.join("\n");
  }

  private emitBlock(blockNode: any, indent: string): string {
    const lines: string[] = [];
    for (let i = 0; i < blockNode.childCount; i++) {
      const child = blockNode.child(i);
      if (child.type !== "{" && child.type !== "}" && child.type !== ";") {
        const s = this.emitStatement(child, indent);
        if (s.trim()) lines.push(s);
      }
    }
    return lines.join("\n");
  }

  private emitStatement(rawNode: any, indent: string): string {
    const node = unwrapNode(rawNode);
    if (!node) return "";

    switch (node.type) {
      case "BlockStatement":
        return this.emitBlock(node, indent);

      case "VariableDeclaration": {
        const name = node.childForFieldName?.("name")?.text;
        const valNode = node.childForFieldName?.("value");
        if (name && valNode) {
          const valWat = this.emitExpression(valNode);
          return `${indent}${valWat}\n${indent}local.set $${name}`;
        }
        return "";
      }

      case "AssignmentStatement": {
        const targetNode = node.childForFieldName?.("target");
        const valNode = node.childForFieldName?.("value");
        const targetName = targetNode?.text || "";
        const valWat = this.emitExpression(valNode);
        return `${indent}${valWat}\n${indent}local.set $${targetName}`;
      }

      case "ReturnStatement": {
        const valNode = node.childForFieldName?.("value");
        if (valNode) {
          const valWat = this.emitExpression(valNode);
          return `${indent}${valWat}\n${indent}return`;
        }
        return `${indent}return`;
      }

      case "IfStatement": {
        const condNode = node.childForFieldName?.("condition");
        const consNode = node.childForFieldName?.("consequence");
        const altNode = node.childForFieldName?.("alternative");
        const condWat = this.emitExpression(condNode);

        const lines: string[] = [];
        lines.push(`${indent}${condWat}`);
        lines.push(`${indent}if`);
        lines.push(this.emitStatement(consNode, indent + "  "));
        if (altNode) {
          lines.push(`${indent}else`);
          lines.push(this.emitStatement(altNode, indent + "  "));
        }
        lines.push(`${indent}end`);
        return lines.join("\n");
      }

      case "WhileStatement": {
        const loopId = ++this.loopCounter;
        const condNode = node.childForFieldName?.("condition");
        const bodyNode = node.childForFieldName?.("body");
        const condWat = this.emitExpression(condNode);

        const lines: string[] = [];
        lines.push(`${indent}block $b_${loopId}`);
        lines.push(`${indent}  loop $l_${loopId}`);
        lines.push(`${indent}    ${condWat}`);
        lines.push(`${indent}    i32.eqz`);
        lines.push(`${indent}    br_if $b_${loopId}`);
        lines.push(this.emitStatement(bodyNode, indent + "    "));
        lines.push(`${indent}    br $l_${loopId}`);
        lines.push(`${indent}  end`);
        lines.push(`${indent}end`);
        return lines.join("\n");
      }

      case "ExpressionStatement": {
        const exprNode = node.childForFieldName?.("expression");
        const exprWat = this.emitExpression(exprNode);
        return `${indent}${exprWat}\n${indent}drop`;
      }

      default:
        return "";
    }
  }

  private exprType(rawNode: any): string {
    const node = unwrapNode(rawNode);
    if (!node) return "i32";

    if (node.type === "NUMBER") {
      const text = node.text || "";
      return text.includes(".") || text.toLowerCase().includes("e") ? "f64" : "i32";
    }
    if (node.type === "IDENTIFIER") {
      const name = node.text || "";
      return this.locals.get(name) || "i32";
    }
    if (node.type === "BinaryExpression") {
      const left = node.childForFieldName?.("left");
      const right = node.childForFieldName?.("right");
      if (this.exprType(left) === "f64" || this.exprType(right) === "f64") {
        return "f64";
      }
      return "i32";
    }
    if (node.type === "ParenthesizedExpression") {
      return this.exprType(node.childForFieldName?.("expression"));
    }
    return "i32";
  }

  private emitExpression(rawNode: any): string {
    const node = unwrapNode(rawNode);
    if (!node) return "i32.const 0";

    switch (node.type) {
      case "NUMBER": {
        const text = node.text || "0";
        if (text.includes(".") || text.toLowerCase().includes("e")) {
          return `f64.const ${text}`;
        }
        return `i32.const ${text}`;
      }

      case "BOOLEAN": {
        return node.text === "true" ? "i32.const 1" : "i32.const 0";
      }

      case "IDENTIFIER": {
        const name = node.text || "";
        return `local.get $${name}`;
      }

      case "BinaryExpression": {
        const leftNode = node.childForFieldName?.("left");
        const opNode = node.childForFieldName?.("operator");
        const rightNode = node.childForFieldName?.("right");
        const op = opNode?.text || "+";

        const leftWat = this.emitExpression(leftNode);
        const rightWat = this.emitExpression(rightNode);

        const isF64 = this.exprType(leftNode) === "f64" || this.exprType(rightNode) === "f64";
        const prefix = isF64 ? "f64" : "i32";

        let instr = "";
        switch (op) {
          case "+":
            instr = `${prefix}.add`;
            break;
          case "-":
            instr = `${prefix}.sub`;
            break;
          case "*":
            instr = `${prefix}.mul`;
            break;
          case "/":
            instr = isF64 ? "f64.div" : "i32.div_s";
            break;
          case "%":
            instr = "i32.rem_s";
            break;
          case "==":
            instr = `${prefix}.eq`;
            break;
          case "!=":
            instr = `${prefix}.ne`;
            break;
          case "<":
            instr = isF64 ? "f64.lt" : "i32.lt_s";
            break;
          case "<=":
            instr = isF64 ? "f64.le" : "i32.le_s";
            break;
          case ">":
            instr = isF64 ? "f64.gt" : "i32.gt_s";
            break;
          case ">=":
            instr = isF64 ? "f64.ge" : "i32.ge_s";
            break;
          case "&&":
            instr = "i32.and";
            break;
          case "||":
            instr = "i32.or";
            break;
          default:
            instr = `${prefix}.add`;
        }

        return `${leftWat}\n${rightWat}\n${instr}`;
      }

      case "UnaryExpression": {
        const opNode = node.childForFieldName?.("operator");
        const operandNode = node.childForFieldName?.("operand");
        const op = opNode?.text || "!";
        const operandWat = this.emitExpression(operandNode);

        if (op === "!") {
          return `${operandWat}\ni32.eqz`;
        }
        if (op === "-") {
          return `i32.const 0\n${operandWat}\ni32.sub`;
        }
        return operandWat;
      }

      case "PostfixExpression": {
        const calleeNode = node.childForFieldName?.("callee");
        if (calleeNode) {
          const callee = calleeNode.text || "fn";
          const argsNode = node.childForFieldName?.("arguments");
          const argsWat: string[] = [];

          if (argsNode) {
            for (let i = 0; i < argsNode.childCount; i++) {
              const arg = argsNode.child(i);
              if (arg.type === "Argument") {
                const val = arg.childForFieldName?.("value") || arg;
                argsWat.push(this.emitExpression(val));
              }
            }
          }

          const argsStr = argsWat.length > 0 ? argsWat.join("\n") + "\n" : "";
          return `${argsStr}call $${callee}`;
        }
        return "i32.const 0";
      }

      case "CallExpression": {
        const callee = node.childForFieldName?.("function")?.text || "fn";
        const argsNode = node.childForFieldName?.("arguments");
        const argsWat: string[] = [];

        if (argsNode) {
          for (let i = 0; i < argsNode.childCount; i++) {
            const arg = argsNode.child(i);
            if (arg.type === "Argument" || (arg.type !== "(" && arg.type !== ")" && arg.type !== ",")) {
              const val = arg.childForFieldName?.("value") || arg;
              argsWat.push(this.emitExpression(val));
            }
          }
        }

        const argsStr = argsWat.length > 0 ? argsWat.join("\n") + "\n" : "";
        return `${argsStr}call $${callee}`;
      }

      case "ParenthesizedExpression": {
        const inner = node.childForFieldName?.("expression");
        return this.emitExpression(inner);
      }

      default:
        return "i32.const 0";
    }
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import wabt from "wabt";
import {
  ModelScriptQueryEngine,
  parseTypeName,
  unwrapNode,
  type ModelScriptType,
  type StructFieldLayout,
  type StructLayout,
} from "../queries.js";

/**
 * Maps a ModelScript source type annotation to its underlying WebAssembly value type (`i32`, `i64`, `f32`, `f64`, or `void`).
 */
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

/**
 * Converts a semantic `ModelScriptType` into its corresponding WASM register type.
 */
function modelScriptTypeToWasm(type: ModelScriptType): string {
  switch (type.kind) {
    case "f64":
      return "f64";
    case "i64":
      return "i64";
    default:
      return "i32";
  }
}

/**
 * WebAssembly code generator for ModelScript that lowers linear CST nodes into
 * WebAssembly Text Format (WAT) and binary `.wasm` modules via `wabt`.
 */
export class WasmEmitter {
  private locals = new Map<string, string>(); // name -> wasmType
  private localTypes = new Map<string, ModelScriptType>(); // name -> semantic type
  private structLayouts = new Map<string, StructLayout>();
  private fnReturnTypes = new Map<string, string>();
  private queries = new ModelScriptQueryEngine();
  private loopCounter = 0;

  /**
   * Emits a complete WebAssembly Text Format (`.wat`) module string from a parsed CST root node.
   */
  emitWat(rawRootNode: any): string {
    const rootNode = unwrapNode(rawRootNode);
    this.loopCounter = 0;
    this.structLayouts.clear();
    this.fnReturnTypes.clear();
    this.queries.clear();

    // First pass: index struct layouts and function signatures
    for (let i = 0; i < rootNode.childCount; i++) {
      const child = unwrapNode(rootNode.child(i));
      if (!child || child.type === ";" || child.type === "_EmptyStatement") continue;
      if (child.type === "StructDeclaration") {
        const layout = this.queries.structLayout(child);
        this.structLayouts.set(layout.name, layout);
      } else if (child.type === "FunctionDeclaration") {
        const fnName = child.childForFieldName?.("name")?.text || "fn";
        const returnTypeStr = child.childForFieldName?.("returnType")?.text;
        this.fnReturnTypes.set(fnName, toWasmType(returnTypeStr || "i32"));
      }
    }

    const functionsWat: string[] = [];
    const topLevelStmts: any[] = [];
    const topLevelLocals = new Map<string, string>();
    const topLevelSemanticTypes = new Map<string, ModelScriptType>();

    // Second pass: emit named functions and gather top-level statements for synthetic $main
    for (let i = 0; i < rootNode.childCount; i++) {
      const child = unwrapNode(rootNode.child(i));
      if (!child || child.type === ";" || child.type === "_EmptyStatement") continue;

      if (child.type === "FunctionDeclaration") {
        functionsWat.push(this.emitFunction(child));
      } else if (child.type === "StructDeclaration" || child.type === "ImportDeclaration") {
        continue;
      } else {
        topLevelStmts.push(child);
        this.collectLocals(child, topLevelLocals, topLevelSemanticTypes);
      }
    }

    if (topLevelStmts.length > 0) {
      this.locals = new Map(topLevelLocals);
      this.localTypes = new Map(topLevelSemanticTypes);
      const needsAlloc = topLevelStmts.some((s) => this.containsHeapAllocation(s));
      const mainLines: string[] = [];
      mainLines.push("  (func $main (result i32)");
      for (const [name, type] of topLevelLocals) {
        mainLines.push(`    (local $${name} ${type})`);
      }
      if (needsAlloc) {
        mainLines.push("    (local $__alloc_ptr i32)");
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

    const moduleHeader = ["(module", '  (memory (export "memory") 1)'];
    if (this.containsHeapAllocation(rootNode)) {
      // Bump-allocator pointer starts at byte offset 1024 in linear memory
      moduleHeader.push("  (global $__heap_ptr (mut i32) (i32.const 1024))");
    }

    return [...moduleHeader, ...functionsWat, ")"].join("\n");
  }

  /**
   * Compiles a parsed ModelScript CST root node into a binary WebAssembly module (`Uint8Array`).
   */
  async compile(rootNode: any): Promise<Uint8Array> {
    const wat = this.emitWat(rootNode);
    const wabtModule = await (wabt as any)();
    const parsed = wabtModule.parseWat("module.wat", wat);
    const { buffer } = parsed.toBinary({});
    return buffer;
  }

  /**
   * Checks whether a CST subtree contains any `new` struct allocations or array literals
   * that require the linear-memory bump allocator (`$__heap_ptr` and `$__alloc_ptr`).
   */
  private containsHeapAllocation(rawNode: any): boolean {
    if (!rawNode) return false;
    const node = unwrapNode(rawNode);
    if (!node) return false;
    if (node.type === "NewExpression" || node.type === "ArrayLiteral") {
      return true;
    }
    for (let i = 0; i < node.childCount; i++) {
      if (this.containsHeapAllocation(node.child(i))) return true;
    }
    return false;
  }

  /**
   * Infers the semantic `ModelScriptType` of an initializer expression for local variable typing.
   */
  private inferSemanticTypeFromValue(rawValNode: any, semanticTypes: Map<string, ModelScriptType>): ModelScriptType {
    const valNode = unwrapNode(rawValNode);
    if (!valNode) return { kind: "i32" };

    if (valNode.type === "NewExpression") {
      const ctor =
        valNode.childForFieldName?.("constructor")?.text ||
        valNode.childForFieldName?.("class")?.text ||
        valNode.namedChildren?.[0]?.text ||
        "AnonymousStruct";
      return { kind: "struct", name: ctor };
    }
    if (valNode.type === "ArrayLiteral") {
      const elems: any[] = [];
      for (let i = 0; i < valNode.childCount; i++) {
        const c = valNode.child(i);
        if (c?.type === "Expression") {
          elems.push(c);
        }
      }
      if (elems.length > 0) {
        return { kind: "array", element: this.inferSemanticTypeFromValue(elems[0], semanticTypes) };
      }
      return { kind: "array", element: { kind: "i32" } };
    }
    if (valNode.type === "NUMBER") {
      const text = valNode.text || "";
      return text.includes(".") || text.toLowerCase().includes("e") ? { kind: "f64" } : { kind: "i32" };
    }
    if (valNode.type === "IDENTIFIER") {
      return semanticTypes.get(valNode.text || "") || { kind: "i32" };
    }
    if (valNode.type === "PostfixExpression") {
      const objNode = valNode.childForFieldName?.("object");
      const propNode = valNode.childForFieldName?.("property");
      const arrNode = valNode.childForFieldName?.("array");
      const idxNode = valNode.childForFieldName?.("index");
      if (objNode && propNode) {
        const field = this.resolveStructField(objNode, propNode.text || "", semanticTypes);
        if (field) return field.type;
        if (propNode.text === "length") return { kind: "i32" };
      }
      if (arrNode && idxNode) {
        const arrType = this.inferSemanticTypeFromValue(arrNode, semanticTypes);
        if (arrType.kind === "array") return arrType.element;
      }
    }
    return this.queries.inferExpressionType(valNode, semanticTypes);
  }

  /**
   * Recursively scans a statement or function body to pre-collect all `VariableDeclaration`
   * locals and their WASM/semantic types (required at the top of a WAT `(func ...)`).
   */
  private collectLocals(node: any, locals: Map<string, string>, semanticTypes: Map<string, ModelScriptType>): void {
    if (!node) return;
    const unwrapped = unwrapNode(node);
    if (!unwrapped) return;

    if (unwrapped.type === "VariableDeclaration") {
      const name = unwrapped.childForFieldName?.("name")?.text;
      const typeStr = unwrapped.childForFieldName?.("type")?.text;
      const valNode = unwrapped.childForFieldName?.("value");
      let semanticType: ModelScriptType = typeStr
        ? parseTypeName(typeStr)
        : this.inferSemanticTypeFromValue(valNode, semanticTypes);
      if (semanticType.kind === "unknown") {
        semanticType = { kind: "i32" };
      }
      const wasmType = typeStr ? toWasmType(typeStr) : modelScriptTypeToWasm(semanticType);
      if (name) {
        locals.set(name, wasmType);
        semanticTypes.set(name, semanticType);
      }
    }

    for (let i = 0; i < unwrapped.childCount; i++) {
      this.collectLocals(unwrapped.child(i), locals, semanticTypes);
    }
  }

  /**
   * Emits a WAT `(func ...)` and `(export ...)` definition for a `FunctionDeclaration` node.
   */
  private emitFunction(node: any): string {
    const name = node.childForFieldName?.("name")?.text || "fn";
    const paramsNode = node.childForFieldName?.("parameters");
    const returnTypeStr = node.childForFieldName?.("returnType")?.text;
    const retType = toWasmType(returnTypeStr || "i32");
    const bodyNode = node.childForFieldName?.("body");

    this.locals.clear();
    this.localTypes.clear();
    const paramsList: string[] = [];

    if (paramsNode) {
      for (let i = 0; i < paramsNode.childCount; i++) {
        const param = paramsNode.child(i);
        if (param.type === "Parameter") {
          const pName = param.childForFieldName?.("name")?.text;
          const pTypeStr = param.childForFieldName?.("type")?.text;
          const pType = toWasmType(pTypeStr);
          if (pName) {
            this.locals.set(pName, pType);
            this.localTypes.set(pName, pTypeStr ? parseTypeName(pTypeStr) : { kind: "i32" });
            paramsList.push(`(param $${pName} ${pType})`);
          }
        }
      }
    }

    // Collect inner locals
    const fnLocals = new Map<string, string>();
    const fnSemanticTypes = new Map<string, ModelScriptType>(this.localTypes);
    this.collectLocals(bodyNode, fnLocals, fnSemanticTypes);
    for (const [pName] of this.locals) {
      fnLocals.delete(pName); // Parameters are already declared
    }
    for (const [lName, lType] of fnLocals) {
      this.locals.set(lName, lType);
    }
    for (const [lName, sType] of fnSemanticTypes) {
      this.localTypes.set(lName, sType);
    }

    const lines: string[] = [];
    const paramsStr = paramsList.length > 0 ? " " + paramsList.join(" ") : "";
    const resultStr = retType !== "void" ? ` (result ${retType})` : "";
    lines.push(`  (func $${name}${paramsStr}${resultStr}`);

    for (const [lName, lType] of fnLocals) {
      lines.push(`    (local $${lName} ${lType})`);
    }
    if (this.containsHeapAllocation(bodyNode)) {
      lines.push("    (local $__alloc_ptr i32)");
    }

    if (bodyNode) {
      lines.push(this.emitBlock(bodyNode, "    "));
    }

    // Emit a fallback zero return at the end of non-void functions to satisfy WASM stack validation
    if (retType !== "void") {
      lines.push(`    ${retType === "f64" ? "f64.const 0" : "i32.const 0"}`);
      lines.push("    return");
    }

    lines.push("  )");
    lines.push(`  (export "${name}" (func $${name}))`);

    return lines.join("\n");
  }

  /**
   * Emits WAT instructions for all statements inside a `BlockStatement`.
   */
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

  /**
   * Resolves a struct field's layout (`offset`, `size`, `type`) from an object receiver expression.
   */
  private resolveStructField(
    rawObjNode: any,
    propName: string,
    semanticMap: Map<string, ModelScriptType> = this.localTypes,
  ): StructFieldLayout | undefined {
    const objNode = unwrapNode(rawObjNode);
    if (objNode) {
      if (objNode.type === "IDENTIFIER") {
        const objType = semanticMap.get(objNode.text || "");
        if (objType?.kind === "struct") {
          const layout = this.structLayouts.get(objType.name);
          const field = layout?.fields.find((f) => f.name === propName);
          if (field) return field;
        }
      } else if (objNode.type === "NewExpression") {
        const ctor = objNode.childForFieldName?.("constructor")?.text || "";
        const layout = this.structLayouts.get(ctor);
        const field = layout?.fields.find((f) => f.name === propName);
        if (field) return field;
      }
    }
    for (const layout of this.structLayouts.values()) {
      const field = layout.fields.find((f) => f.name === propName);
      if (field) return field;
    }
    return undefined;
  }

  /**
   * Determines the WASM element type (`"i32"`, `"i64"`, or `"f64"`) for an array expression.
   */
  private resolveArrayElementWasmType(rawArrNode: any): string {
    const arrNode = unwrapNode(rawArrNode);
    if (!arrNode) return "i32";
    if (arrNode.type === "IDENTIFIER") {
      const t = this.localTypes.get(arrNode.text || "");
      if (t?.kind === "array") {
        return modelScriptTypeToWasm(t.element);
      }
    } else if (arrNode.type === "ArrayLiteral") {
      for (let i = 0; i < arrNode.childCount; i++) {
        const c = arrNode.child(i);
        if (c?.type === "Expression") {
          return this.exprType(c);
        }
      }
    }
    return "i32";
  }

  /**
   * Emits WAT instructions for a single statement node (declarations, assignments,
   * returns, conditionals, and structured `block`/`loop` control flow).
   */
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
          const targetWasmType = this.locals.get(name) || this.exprType(valNode);
          const valWat = this.emitExpressionAs(valNode, targetWasmType);
          return `${indent}${valWat}\n${indent}local.set $${name}`;
        }
        return "";
      }

      case "AssignmentStatement": {
        const targetNode = unwrapNode(node.childForFieldName?.("target"));
        const opNode = node.childForFieldName?.("operator");
        const valNode = node.childForFieldName?.("value");
        const op = opNode?.text || "=";

        if (targetNode?.type === "PostfixExpression") {
          const objNode = targetNode.childForFieldName?.("object");
          const propNode = targetNode.childForFieldName?.("property");
          const arrNode = targetNode.childForFieldName?.("array");
          const idxNode = targetNode.childForFieldName?.("index");

          // Struct field store at computed static byte offset
          if (objNode && propNode) {
            const field = this.resolveStructField(objNode, propNode.text || "");
            const fieldWasmType = field ? modelScriptTypeToWasm(field.type) : this.exprType(valNode);
            const offset = field ? field.offset : 0;
            const storeInstr =
              fieldWasmType === "f64"
                ? "f64.store"
                : fieldWasmType === "i64"
                  ? "i64.store"
                  : field?.size === 1
                    ? "i32.store8"
                    : "i32.store";
            return `${indent}${this.emitExpression(objNode)}\n${indent}${this.emitExpressionAs(valNode, fieldWasmType)}\n${indent}${storeInstr} offset=${offset}`;
          }
          // Array element store (8-byte header holds length + padding; elements start at offset=8)
          if (arrNode && idxNode) {
            const elemWasmType = this.resolveArrayElementWasmType(arrNode);
            const elemSize = elemWasmType === "f64" || elemWasmType === "i64" ? 8 : 4;
            const storeInstr = `${elemWasmType}.store`;
            return [
              `${indent}${this.emitExpression(arrNode)}`,
              `${indent}${this.emitExpression(idxNode)}`,
              `${indent}i32.const ${elemSize}`,
              `${indent}i32.mul`,
              `${indent}i32.add`,
              `${indent}${this.emitExpressionAs(valNode, elemWasmType)}`,
              `${indent}${storeInstr} offset=8`,
            ].join("\n");
          }
        }

        const targetName = targetNode?.text || "";
        const targetWasmType = this.locals.get(targetName) || this.exprType(valNode);
        const valWat = this.emitExpressionAs(valNode, targetWasmType);
        if (op === "+=" || op === "-=" || op === "*=" || op === "/=") {
          const isF64 = targetWasmType === "f64";
          const prefix = isF64 ? "f64" : "i32";
          const instr =
            op === "+="
              ? `${prefix}.add`
              : op === "-="
                ? `${prefix}.sub`
                : op === "*="
                  ? `${prefix}.mul`
                  : isF64
                    ? "f64.div"
                    : "i32.div_s";
          return `${indent}local.get $${targetName}\n${indent}${valWat}\n${indent}${instr}\n${indent}local.set $${targetName}`;
        }
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
        // Lower while loop into a WASM outer `block` (break target) and inner `loop` (continue target)
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

      case "ForStatement": {
        const loopId = ++this.loopCounter;
        const initNode = node.childForFieldName?.("init");
        const condNode = node.childForFieldName?.("condition");
        const updateNode = node.childForFieldName?.("update");
        const bodyNode = node.childForFieldName?.("body");

        const lines: string[] = [];
        if (initNode) {
          const initWat = this.emitStatement(initNode, indent);
          if (initWat.trim()) lines.push(initWat);
        }
        lines.push(`${indent}block $b_${loopId}`);
        lines.push(`${indent}  loop $l_${loopId}`);
        if (condNode) {
          const condWat = this.emitExpression(condNode);
          lines.push(`${indent}    ${condWat}`);
          lines.push(`${indent}    i32.eqz`);
          lines.push(`${indent}    br_if $b_${loopId}`);
        }
        if (bodyNode) {
          lines.push(this.emitStatement(bodyNode, indent + "    "));
        }
        if (updateNode) {
          const updateWat = this.emitStatement(updateNode, indent + "    ");
          if (updateWat.trim()) lines.push(updateWat);
        }
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

  /**
   * Computes the resulting WASM stack value type (`"i32"`, `"i64"`, or `"f64"`) of an expression node.
   */
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
    if (node.type === "UnaryExpression") {
      const op = node.childForFieldName?.("operator")?.text;
      if (op === "!" || op === "~") return "i32";
      return this.exprType(node.childForFieldName?.("operand"));
    }
    if (node.type === "BinaryExpression") {
      const op = node.childForFieldName?.("operator")?.text || "+";
      if (["==", "!=", "<", "<=", ">", ">=", "&&", "||"].includes(op)) {
        return "i32";
      }
      const left = node.childForFieldName?.("left");
      const right = node.childForFieldName?.("right");
      if (this.exprType(left) === "f64" || this.exprType(right) === "f64") {
        return "f64";
      }
      return "i32";
    }
    if (node.type === "PostfixExpression") {
      const calleeNode = node.childForFieldName?.("callee");
      if (calleeNode) {
        return this.fnReturnTypes.get(calleeNode.text || "") || "i32";
      }
      const objNode = node.childForFieldName?.("object");
      const propNode = node.childForFieldName?.("property");
      if (objNode && propNode) {
        if (propNode.text === "length") return "i32";
        const field = this.resolveStructField(objNode, propNode.text || "");
        return field ? modelScriptTypeToWasm(field.type) : "i32";
      }
      const arrNode = node.childForFieldName?.("array");
      const idxNode = node.childForFieldName?.("index");
      if (arrNode && idxNode) {
        return this.resolveArrayElementWasmType(arrNode);
      }
      return "i32";
    }
    if (node.type === "NewExpression" || node.type === "ArrayLiteral") {
      return "i32";
    }
    if (node.type === "ParenthesizedExpression") {
      return this.exprType(node.childForFieldName?.("expression"));
    }
    return "i32";
  }

  /**
   * Emits an expression and appends numeric conversion instructions (`f64.convert_i32_s`
   * or `i32.trunc_f64_s`) when the expression's type differs from `targetWasmType`.
   */
  private emitExpressionAs(rawNode: any, targetWasmType: string): string {
    const actualType = this.exprType(rawNode);
    const wat = this.emitExpression(rawNode);
    if (actualType === targetWasmType) return wat;
    if (targetWasmType === "f64" && actualType === "i32") {
      return `${wat}\nf64.convert_i32_s`;
    }
    if (targetWasmType === "i32" && actualType === "f64") {
      return `${wat}\ni32.trunc_f64_s`;
    }
    return wat;
  }

  /**
   * Emits WAT stack instructions to evaluate an expression node and leave its result on the stack.
   */
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

      case "NewExpression": {
        const ctor = node.childForFieldName?.("constructor")?.text || "";
        const layout = this.structLayouts.get(ctor);
        const argsNode = node.childForFieldName?.("arguments");
        const argValues: any[] = [];
        if (argsNode) {
          for (let i = 0; i < argsNode.childCount; i++) {
            const arg = argsNode.child(i);
            if (arg.type === "Argument") {
              argValues.push(arg.childForFieldName?.("value") || arg);
            }
          }
        }

        // Bump-allocate 8-byte aligned struct block in linear memory and store constructor arguments
        const rawSize = layout ? Math.max(8, layout.totalSize) : Math.max(8, argValues.length * 8);
        const alignedSize = Math.ceil(rawSize / 8) * 8;
        const instrs: string[] = [
          "global.get $__heap_ptr",
          "local.tee $__alloc_ptr",
          `i32.const ${alignedSize}`,
          "i32.add",
          "global.set $__heap_ptr",
        ];

        for (let i = 0; i < argValues.length; i++) {
          const argVal = argValues[i];
          const field = layout?.fields[i];
          const fieldWasmType = field ? modelScriptTypeToWasm(field.type) : this.exprType(argVal);
          const offset = field ? field.offset : i * 8;
          const storeInstr =
            fieldWasmType === "f64"
              ? "f64.store"
              : fieldWasmType === "i64"
                ? "i64.store"
                : field?.size === 1
                  ? "i32.store8"
                  : "i32.store";
          instrs.push("local.get $__alloc_ptr");
          instrs.push(this.emitExpressionAs(argVal, fieldWasmType));
          instrs.push(`${storeInstr} offset=${offset}`);
        }

        instrs.push("local.get $__alloc_ptr");
        return instrs.join("\n");
      }

      case "ArrayLiteral": {
        const elems: any[] = [];
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i);
          if (c?.type === "Expression") {
            elems.push(c);
          }
        }
        const elemWasmType = elems.some((e) => this.exprType(e) === "f64") ? "f64" : "i32";
        const elemSize = elemWasmType === "f64" ? 8 : 4;
        const alignedSize = Math.ceil((8 + elems.length * elemSize) / 8) * 8;

        // Allocate array in linear memory: [offset 0: i32 length, offset 4: padding, offset 8+: elements]
        const instrs: string[] = [
          "global.get $__heap_ptr",
          "local.tee $__alloc_ptr",
          `i32.const ${alignedSize}`,
          "i32.add",
          "global.set $__heap_ptr",
          "local.get $__alloc_ptr",
          `i32.const ${elems.length}`,
          "i32.store offset=0",
        ];

        for (let i = 0; i < elems.length; i++) {
          instrs.push("local.get $__alloc_ptr");
          instrs.push(this.emitExpressionAs(elems[i], elemWasmType));
          instrs.push(`${elemWasmType}.store offset=${8 + i * elemSize}`);
        }

        instrs.push("local.get $__alloc_ptr");
        return instrs.join("\n");
      }

      case "BinaryExpression": {
        const leftNode = node.childForFieldName?.("left");
        const opNode = node.childForFieldName?.("operator");
        const rightNode = node.childForFieldName?.("right");
        const op = opNode?.text || "+";

        const isF64 = this.exprType(leftNode) === "f64" || this.exprType(rightNode) === "f64";
        const operandType = isF64 && op !== "&&" && op !== "||" && op !== "%" ? "f64" : "i32";
        const leftWat = this.emitExpressionAs(leftNode, operandType);
        const rightWat = this.emitExpressionAs(rightNode, operandType);
        const prefix = operandType;

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
        if (op === "~") {
          return `${operandWat}\ni32.const -1\ni32.xor`;
        }
        if (op === "-") {
          if (this.exprType(operandNode) === "f64") {
            return `${operandWat}\nf64.neg`;
          }
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

        const objNode = node.childForFieldName?.("object");
        const propNode = node.childForFieldName?.("property");
        if (objNode && propNode) {
          const propName = propNode.text || "";
          const field = this.resolveStructField(objNode, propName);
          if (field) {
            const fieldWasmType = modelScriptTypeToWasm(field.type);
            const loadInstr =
              fieldWasmType === "f64"
                ? "f64.load"
                : fieldWasmType === "i64"
                  ? "i64.load"
                  : field.size === 1
                    ? "i32.load8_u"
                    : "i32.load";
            return `${this.emitExpression(objNode)}\n${loadInstr} offset=${field.offset}`;
          }
          if (propName === "length") {
            return `${this.emitExpression(objNode)}\ni32.load offset=0`;
          }
          return `${this.emitExpression(objNode)}\ni32.load offset=0`;
        }

        const arrNode = node.childForFieldName?.("array");
        const idxNode = node.childForFieldName?.("index");
        if (arrNode && idxNode) {
          const elemWasmType = this.resolveArrayElementWasmType(arrNode);
          const elemSize = elemWasmType === "f64" || elemWasmType === "i64" ? 8 : 4;
          const loadInstr = `${elemWasmType}.load`;
          return [
            this.emitExpression(arrNode),
            this.emitExpression(idxNode),
            `i32.const ${elemSize}`,
            "i32.mul",
            "i32.add",
            `${loadInstr} offset=8`,
          ].join("\n");
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

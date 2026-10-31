// SPDX-License-Identifier: AGPL-3.0-or-later

import wabt from "wabt";
import {
  getTypeSizeAndAlign,
  ModelScriptQueryEngine,
  parseTypeName,
  unwrapNode,
  type ModelScriptCstNode,
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
      return "i32"; // Pointers to structs/arrays/strings are i32 in WASM32
  }
}

/**
 * Converts a semantic `ModelScriptType` into its corresponding WASM register type.
 */
function modelScriptTypeToWasm(type: ModelScriptType): string {
  switch (type.kind) {
    case "f64":
      return "f64";
    case "f32":
      return "f32";
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
  private stringPool = new Map<string, { offset: number; byteLength: number; watData: string }>();
  private nextDataOffset = 64;
  private queries = new ModelScriptQueryEngine();
  private loopCounter = 0;

  /**
   * Interns a string literal in linear memory at a 4-byte aligned static data offset:
   * `[offset+0..3: i32 byteLength, offset+4..: UTF-8 bytes + NUL]`.
   */
  private internString(rawLiteral: string): number {
    let unquoted = rawLiteral;
    if ((unquoted.startsWith('"') && unquoted.endsWith('"')) || (unquoted.startsWith("'") && unquoted.endsWith("'"))) {
      unquoted = unquoted.slice(1, -1);
    }
    const str = unquoted
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");

    const existing = this.stringPool.get(str);
    if (existing) return existing.offset;

    const utf8 = new TextEncoder().encode(str);
    const len = utf8.length;
    const allBytes = new Uint8Array(4 + len + 1);
    allBytes[0] = len & 0xff;
    allBytes[1] = (len >>> 8) & 0xff;
    allBytes[2] = (len >>> 16) & 0xff;
    allBytes[3] = (len >>> 24) & 0xff;
    allBytes.set(utf8, 4);
    allBytes[4 + len] = 0;

    let watData = "";
    for (const b of allBytes) {
      watData += "\\" + b.toString(16).padStart(2, "0");
    }

    const offset = Math.ceil(this.nextDataOffset / 4) * 4;
    this.nextDataOffset = offset + allBytes.length;
    this.stringPool.set(str, { offset, byteLength: len, watData });
    return offset;
  }

  /**
   * Extracts `{ key, valueNode }` entries from an `ObjectLiteral` CST node.
   */
  private extractObjectFields(node: ModelScriptCstNode): { key: string; valueNode: ModelScriptCstNode }[] {
    const fields: { key: string; valueNode: ModelScriptCstNode }[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c?.type === "ObjectField") {
        const keyNode = c.childForFieldName?.("key") ?? c.childForFieldName?.("shorthand");
        const valNode = c.childForFieldName?.("value") ?? c.childForFieldName?.("shorthand");
        if (keyNode?.text && valNode) {
          fields.push({ key: keyNode.text, valueNode: valNode });
        }
      }
    }
    return fields;
  }

  /**
   * Matches an `ObjectLiteral` against a declared struct layout or synthesizes an anonymous layout.
   */
  private getOrCreateObjectStructLayout(
    node: ModelScriptCstNode,
    semanticTypes: Map<string, ModelScriptType>,
  ): StructLayout {
    const objFields = this.extractObjectFields(node);
    const fieldKeys = objFields.map((f) => f.key);

    for (const layout of this.structLayouts.values()) {
      if (
        layout.fields.length === fieldKeys.length &&
        fieldKeys.every((k) => layout.fields.some((lf) => lf.name === k))
      ) {
        return layout;
      }
    }

    const synthName = `__obj_${fieldKeys.join("_") || "empty"}`;
    const existing = this.structLayouts.get(synthName);
    if (existing) return existing;

    const fields: StructFieldLayout[] = [];
    let currentOffset = 0;
    let maxAlign = 1;

    for (const ofield of objFields) {
      let fType = this.inferSemanticTypeFromValue(ofield.valueNode, semanticTypes);
      if (fType.kind === "unknown") fType = { kind: "i32" };
      const { size, align } = getTypeSizeAndAlign(fType);
      if (align > maxAlign) maxAlign = align;
      if (currentOffset % align !== 0) {
        currentOffset += align - (currentOffset % align);
      }
      fields.push({
        name: ofield.key,
        type: fType,
        size,
        offset: currentOffset,
        alignment: align,
      });
      currentOffset += size;
    }

    if (maxAlign > 1 && currentOffset % maxAlign !== 0) {
      currentOffset += maxAlign - (currentOffset % maxAlign);
    }

    const layout: StructLayout = {
      name: synthName,
      totalSize: Math.max(8, currentOffset),
      alignment: maxAlign,
      fields,
    };
    this.structLayouts.set(synthName, layout);
    return layout;
  }

  /**
   * Emits a complete WebAssembly Text Format (`.wat`) module string from a parsed CST root node.
   */
  emitWat(rawRootNode: ModelScriptCstNode): string {
    const rootNode = unwrapNode(rawRootNode);
    this.loopCounter = 0;
    this.structLayouts.clear();
    this.fnReturnTypes.clear();
    this.stringPool.clear();
    this.nextDataOffset = 64;
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
    const topLevelStmts: ModelScriptCstNode[] = [];
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
    for (const entry of this.stringPool.values()) {
      moduleHeader.push(`  (data (i32.const ${entry.offset}) "${entry.watData}")`);
    }

    if (this.containsHeapAllocation(rootNode)) {
      const initialHeapPtr = Math.max(1024, Math.ceil(this.nextDataOffset / 8) * 8);
      moduleHeader.push(`  (global $__heap_ptr (mut i32) (i32.const ${initialHeapPtr}))`);
      moduleHeader.push(
        [
          "  (func $__alloc (param $size i32) (result i32)",
          "    (local $ptr i32)",
          "    (local $new_ptr i32)",
          "    global.get $__heap_ptr",
          "    local.tee $ptr",
          "    local.get $size",
          "    i32.add",
          "    local.tee $new_ptr",
          "    memory.size",
          "    i32.const 16",
          "    i32.shl",
          "    i32.gt_u",
          "    if",
          "      local.get $size",
          "      i32.const 16",
          "      i32.shr_u",
          "      i32.const 1",
          "      i32.add",
          "      memory.grow",
          "      drop",
          "    end",
          "    local.get $new_ptr",
          "    global.set $__heap_ptr",
          "    local.get $ptr",
          "  )",
        ].join("\n"),
      );
    }

    return [...moduleHeader, ...functionsWat, ")"].join("\n");
  }

  /**
   * Compiles a parsed ModelScript CST root node into a binary WebAssembly module (`Uint8Array`).
   */
  async compile(rootNode: ModelScriptCstNode): Promise<Uint8Array> {
    const wat = this.emitWat(rootNode);
    const wabtModule = await wabt();
    const parsed = wabtModule.parseWat("module.wat", wat);
    const { buffer } = parsed.toBinary({});
    return buffer;
  }

  /**
   * Checks whether a CST subtree contains any `new` struct allocations, object literals,
   * array literals, or FLWOR comprehensions that require the linear-memory bump allocator.
   */
  private containsHeapAllocation(rawNode: ModelScriptCstNode | null | undefined): boolean {
    if (!rawNode) return false;
    const node = unwrapNode(rawNode);
    if (!node) return false;
    if (
      node.type === "NewExpression" ||
      node.type === "ArrayLiteral" ||
      node.type === "ObjectLiteral" ||
      node.type === "FLWORExpression"
    ) {
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
  private inferSemanticTypeFromValue(
    rawValNode: ModelScriptCstNode | null | undefined,
    semanticTypes: Map<string, ModelScriptType>,
  ): ModelScriptType {
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
    if (valNode.type === "ObjectLiteral") {
      const layout = this.getOrCreateObjectStructLayout(valNode, semanticTypes);
      return { kind: "struct", name: layout.name };
    }
    if (valNode.type === "STRING") {
      return { kind: "string" };
    }
    if (valNode.type === "FLWORExpression") {
      const tempTypes = new Map(semanticTypes);
      let retElemType: ModelScriptType = { kind: "i32" };
      for (let i = 0; i < valNode.childCount; i++) {
        const c = valNode.child(i);
        if (!c) continue;
        if (c.type === "ForClause") {
          const varName = c.childForFieldName?.("variable")?.text;
          const collType = this.inferSemanticTypeFromValue(c.childForFieldName?.("collection"), tempTypes);
          if (varName) {
            tempTypes.set(varName, collType.kind === "array" ? collType.element : { kind: "i32" });
          }
        } else if (c.type === "LetClause") {
          const varName = c.childForFieldName?.("variable")?.text;
          const letType = this.inferSemanticTypeFromValue(c.childForFieldName?.("value"), tempTypes);
          if (varName) {
            tempTypes.set(varName, letType);
          }
        } else if (c.type === "ReturnClause") {
          retElemType = this.inferSemanticTypeFromValue(c.childForFieldName?.("value"), tempTypes);
        }
      }
      return { kind: "array", element: retElemType };
    }
    if (valNode.type === "ArrayLiteral") {
      const elems: ModelScriptCstNode[] = [];
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
    if (valNode.type === "ParenthesizedExpression") {
      return this.inferSemanticTypeFromValue(valNode.childForFieldName?.("expression"), semanticTypes);
    }
    if (valNode.type === "UnaryExpression") {
      const op = valNode.childForFieldName?.("operator")?.text;
      if (op === "!") return { kind: "bool" };
      if (op === "~") return { kind: "i32" };
      return this.inferSemanticTypeFromValue(valNode.childForFieldName?.("operand"), semanticTypes);
    }
    if (valNode.type === "BinaryExpression") {
      const op = valNode.childForFieldName?.("operator")?.text || "+";
      if (["==", "!=", "<", "<=", ">", ">=", "&&", "||"].includes(op)) {
        return { kind: "bool" };
      }
      const leftType = this.inferSemanticTypeFromValue(valNode.childForFieldName?.("left"), semanticTypes);
      const rightType = this.inferSemanticTypeFromValue(valNode.childForFieldName?.("right"), semanticTypes);
      if (leftType.kind === "f64" || rightType.kind === "f64") {
        return { kind: "f64" };
      }
      if (leftType.kind === "f32" || rightType.kind === "f32") {
        return { kind: "f32" };
      }
      if (leftType.kind === "i64" || rightType.kind === "i64") {
        return { kind: "i64" };
      }
      if (leftType.kind === "u32" || rightType.kind === "u32") {
        return { kind: "u32" };
      }
      return { kind: "i32" };
    }
    return this.queries.inferExpressionType(valNode, semanticTypes);
  }

  /**
   * Recursively scans a statement or function body to pre-collect all `VariableDeclaration`
   * and `FLWORExpression` locals and their WASM/semantic types (required at the top of a WAT `(func ...)`).
   */
  private collectLocals(
    node: ModelScriptCstNode | null | undefined,
    locals: Map<string, string>,
    semanticTypes: Map<string, ModelScriptType>,
  ): void {
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
    } else if (unwrapped.type === "FLWORExpression") {
      locals.set("__flwor_src", "i32");
      locals.set("__flwor_len", "i32");
      locals.set("__flwor_idx", "i32");
      locals.set("__flwor_dst", "i32");
      locals.set("__flwor_out_len", "i32");

      let forIdx = 0;
      let orderByClause: ModelScriptCstNode | null = null;
      let returnClause: ModelScriptCstNode | null = null;

      for (let i = 0; i < unwrapped.childCount; i++) {
        const c = unwrapped.child(i);
        if (!c) continue;
        if (c.type === "ForClause") {
          if (forIdx >= 1) {
            locals.set(`__flwor_src_${forIdx}`, "i32");
            locals.set(`__flwor_len_${forIdx}`, "i32");
            locals.set(`__flwor_idx_${forIdx}`, "i32");
          }
          forIdx++;
          const varName = c.childForFieldName?.("variable")?.text;
          const collType = this.inferSemanticTypeFromValue(c.childForFieldName?.("collection"), semanticTypes);
          const elemType: ModelScriptType = collType.kind === "array" ? collType.element : { kind: "i32" };
          if (varName) {
            locals.set(varName, modelScriptTypeToWasm(elemType));
            semanticTypes.set(varName, elemType);
          }
        } else if (c.type === "LetClause") {
          const varName = c.childForFieldName?.("variable")?.text;
          const letType = this.inferSemanticTypeFromValue(c.childForFieldName?.("value"), semanticTypes);
          if (varName) {
            locals.set(varName, modelScriptTypeToWasm(letType));
            semanticTypes.set(varName, letType);
          }
        } else if (c.type === "OrderByClause") {
          orderByClause = c;
        } else if (c.type === "ReturnClause") {
          returnClause = c;
        }
      }

      if (orderByClause && returnClause) {
        const criteriaNode = orderByClause.childForFieldName?.("criteria");
        const retValNode = returnClause.childForFieldName?.("value");
        const keySemType = this.inferSemanticTypeFromValue(criteriaNode, semanticTypes);
        const dstSemType = this.inferSemanticTypeFromValue(retValNode, semanticTypes);
        const keyWasmType = modelScriptTypeToWasm(keySemType);
        const dstWasmType = modelScriptTypeToWasm(dstSemType);
        locals.set("__flwor_keys", "i32");
        locals.set("__flwor_sort_i", "i32");
        locals.set("__flwor_sort_j", "i32");
        locals.set(`__flwor_tmp_key_${keyWasmType}`, keyWasmType);
        locals.set(`__flwor_tmp_val_${dstWasmType}`, dstWasmType);
      }
    }

    for (let i = 0; i < unwrapped.childCount; i++) {
      this.collectLocals(unwrapped.child(i), locals, semanticTypes);
    }
  }

  /**
   * Emits a WAT `(func ...)` and `(export ...)` definition for a `FunctionDeclaration` node.
   */
  private emitFunction(node: ModelScriptCstNode): string {
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
        if (param?.type === "Parameter") {
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
      const zeroConst =
        retType === "f64"
          ? "f64.const 0"
          : retType === "f32"
            ? "f32.const 0"
            : retType === "i64"
              ? "i64.const 0"
              : "i32.const 0";
      lines.push(`    ${zeroConst}`);
      lines.push("    return");
    }

    lines.push("  )");
    lines.push(`  (export "${name}" (func $${name}))`);

    return lines.join("\n");
  }

  /**
   * Emits WAT instructions for all statements inside a `BlockStatement`.
   */
  private emitBlock(blockNode: ModelScriptCstNode, indent: string): string {
    const lines: string[] = [];
    for (let i = 0; i < blockNode.childCount; i++) {
      const child = blockNode.child(i);
      if (child && child.type !== "{" && child.type !== "}" && child.type !== ";") {
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
    rawObjNode: ModelScriptCstNode | null | undefined,
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
      } else if (objNode.type === "ObjectLiteral") {
        const layout = this.getOrCreateObjectStructLayout(objNode, semanticMap);
        const field = layout.fields.find((f) => f.name === propName);
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
  private resolveArrayElementWasmType(rawArrNode: ModelScriptCstNode | null | undefined): string {
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
    } else if (arrNode.type === "FLWORExpression") {
      for (let i = 0; i < arrNode.childCount; i++) {
        const c = arrNode.child(i);
        if (c?.type === "ReturnClause") {
          return this.exprType(c.childForFieldName?.("value"));
        }
      }
    }
    return "i32";
  }

  /**
   * Emits WAT instructions for a single statement node (declarations, assignments,
   * returns, conditionals, and structured `block`/`loop` control flow).
   */
  private emitStatement(rawNode: ModelScriptCstNode | null | undefined, indent: string): string {
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
                : fieldWasmType === "f32"
                  ? "f32.store"
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
        const targetSemType = this.localTypes.get(targetName);
        const valWat = this.emitExpressionAs(valNode, targetWasmType);
        if (op === "+=" || op === "-=" || op === "*=" || op === "/=") {
          const isFloat = targetWasmType === "f64" || targetWasmType === "f32";
          const isUnsigned = targetSemType?.kind === "u32";
          const prefix = targetWasmType;
          const instr =
            op === "+="
              ? `${prefix}.add`
              : op === "-="
                ? `${prefix}.sub`
                : op === "*="
                  ? `${prefix}.mul`
                  : isFloat
                    ? `${prefix}.div`
                    : isUnsigned
                      ? `${prefix}.div_u`
                      : `${prefix}.div_s`;
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
   * Infers the semantic `ModelScriptType` of an expression using `ModelScriptQueryEngine`
   * and the active lexical scope's semantic type map.
   */
  private semanticType(rawNode: ModelScriptCstNode | null | undefined): ModelScriptType {
    const node = unwrapNode(rawNode);
    if (!node) return { kind: "i32" };
    if (node.type === "PostfixExpression") {
      const objNode = node.childForFieldName?.("object");
      const propNode = node.childForFieldName?.("property");
      if (objNode && propNode) {
        if (propNode.text === "length") return { kind: "i32" };
        const field = this.resolveStructField(objNode, propNode.text || "");
        if (field) return field.type;
      }
    }
    const queried = this.queries.inferExpressionType(node, this.localTypes);
    if (queried.kind !== "unknown") return queried;
    return this.inferSemanticTypeFromValue(node, this.localTypes);
  }

  /**
   * Computes the resulting WASM stack value type (`"i32"`, `"i64"`, `"f32"`, or `"f64"`) of an expression node.
   */
  private exprType(rawNode: ModelScriptCstNode | null | undefined): string {
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
      const lType = this.exprType(left);
      const rType = this.exprType(right);
      if (lType === "f64" || rType === "f64") return "f64";
      if (lType === "f32" || rType === "f32") return "f32";
      if (lType === "i64" || rType === "i64") return "i64";
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
    if (
      node.type === "NewExpression" ||
      node.type === "ArrayLiteral" ||
      node.type === "ObjectLiteral" ||
      node.type === "FLWORExpression" ||
      node.type === "STRING"
    ) {
      return "i32";
    }
    if (node.type === "ParenthesizedExpression") {
      return this.exprType(node.childForFieldName?.("expression"));
    }
    return modelScriptTypeToWasm(this.semanticType(node));
  }

  /**
   * Emits an expression and appends numeric conversion instructions when the expression's
   * WASM value type differs from `targetWasmType`.
   */
  private emitExpressionAs(rawNode: ModelScriptCstNode | null | undefined, targetWasmType: string): string {
    const node = unwrapNode(rawNode);
    if (node?.type === "NUMBER" && targetWasmType === "f32") {
      return `f32.const ${node.text || "0"}`;
    }
    const actualType = this.exprType(rawNode);
    const semType = this.semanticType(rawNode);
    const isUnsigned = semType.kind === "u32";
    const wat = this.emitExpression(rawNode);
    if (actualType === targetWasmType) return wat;
    if (targetWasmType === "f64" && actualType === "i32") {
      return `${wat}\n${isUnsigned ? "f64.convert_i32_u" : "f64.convert_i32_s"}`;
    }
    if (targetWasmType === "f64" && actualType === "f32") {
      return `${wat}\nf64.promote_f32`;
    }
    if (targetWasmType === "f32" && actualType === "f64") {
      return `${wat}\nf32.demote_f64`;
    }
    if (targetWasmType === "f32" && actualType === "i32") {
      return `${wat}\n${isUnsigned ? "f32.convert_i32_u" : "f32.convert_i32_s"}`;
    }
    if (targetWasmType === "i32" && actualType === "f64") {
      return `${wat}\n${isUnsigned ? "i32.trunc_f64_u" : "i32.trunc_f64_s"}`;
    }
    if (targetWasmType === "i32" && actualType === "f32") {
      return `${wat}\n${isUnsigned ? "i32.trunc_f32_u" : "i32.trunc_f32_s"}`;
    }
    return wat;
  }

  /**
   * Emits WAT stack instructions to evaluate an expression node and leave its result on the stack.
   */
  private emitExpression(rawNode: ModelScriptCstNode | null | undefined): string {
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

      case "STRING": {
        const offset = this.internString(node.text || '""');
        return `i32.const ${offset}`;
      }

      case "IDENTIFIER": {
        const name = node.text || "";
        return `local.get $${name}`;
      }

      case "NewExpression": {
        const ctor = node.childForFieldName?.("constructor")?.text || "";
        const layout = this.structLayouts.get(ctor);
        const argsNode = node.childForFieldName?.("arguments");
        const argValues: ModelScriptCstNode[] = [];
        if (argsNode) {
          for (let i = 0; i < argsNode.childCount; i++) {
            const arg = argsNode.child(i);
            if (arg?.type === "Argument") {
              argValues.push(arg.childForFieldName?.("value") || arg);
            }
          }
        }

        // Bump-allocate 8-byte aligned struct block in linear memory and store constructor arguments
        const rawSize = layout ? Math.max(8, layout.totalSize) : Math.max(8, argValues.length * 8);
        const alignedSize = Math.ceil(rawSize / 8) * 8;
        const instrs: string[] = [`i32.const ${alignedSize}`, "call $__alloc", "local.set $__alloc_ptr"];

        for (let i = 0; i < argValues.length; i++) {
          const argVal = argValues[i]!;
          const field = layout?.fields[i];
          const fieldWasmType = field ? modelScriptTypeToWasm(field.type) : this.exprType(argVal);
          const offset = field ? field.offset : i * 8;
          const storeInstr =
            fieldWasmType === "f64"
              ? "f64.store"
              : fieldWasmType === "f32"
                ? "f32.store"
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

      case "ObjectLiteral": {
        const layout = this.getOrCreateObjectStructLayout(node, this.localTypes);
        const fieldList = this.extractObjectFields(node);
        const rawSize = Math.max(8, layout.totalSize, fieldList.length * 8);
        const alignedSize = Math.ceil(rawSize / 8) * 8;
        const instrs: string[] = [`i32.const ${alignedSize}`, "call $__alloc", "local.set $__alloc_ptr"];

        for (let i = 0; i < fieldList.length; i++) {
          const { key, valueNode } = fieldList[i]!;
          const field = layout.fields.find((f) => f.name === key) ?? layout.fields[i];
          const fieldWasmType = field ? modelScriptTypeToWasm(field.type) : this.exprType(valueNode);
          const offset = field ? field.offset : i * 8;
          const storeInstr =
            fieldWasmType === "f64"
              ? "f64.store"
              : fieldWasmType === "f32"
                ? "f32.store"
                : fieldWasmType === "i64"
                  ? "i64.store"
                  : field?.size === 1
                    ? "i32.store8"
                    : "i32.store";
          instrs.push("local.get $__alloc_ptr");
          instrs.push(this.emitExpressionAs(valueNode, fieldWasmType));
          instrs.push(`${storeInstr} offset=${offset}`);
        }

        instrs.push("local.get $__alloc_ptr");
        return instrs.join("\n");
      }

      case "ArrayLiteral": {
        const elems: ModelScriptCstNode[] = [];
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i);
          if (c?.type === "Expression") {
            elems.push(c);
          }
        }
        const elemWasmType = elems.some((e) => this.exprType(e) === "f64")
          ? "f64"
          : elems.some((e) => this.exprType(e) === "f32")
            ? "f32"
            : "i32";
        const elemSize = elemWasmType === "f64" ? 8 : 4;
        const alignedSize = Math.ceil((8 + elems.length * elemSize) / 8) * 8;

        // Allocate array in linear memory: [offset 0: i32 length, offset 4: padding, offset 8+: elements]
        const instrs: string[] = [
          `i32.const ${alignedSize}`,
          "call $__alloc",
          "local.tee $__alloc_ptr",
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

      case "FLWORExpression": {
        const forClauses: ModelScriptCstNode[] = [];
        const letClauses: ModelScriptCstNode[] = [];
        const whereClauses: ModelScriptCstNode[] = [];
        let orderByClause: ModelScriptCstNode | null = null;
        let returnClause: ModelScriptCstNode | null = null;

        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i);
          if (!c) continue;
          if (c.type === "ForClause") forClauses.push(c);
          else if (c.type === "LetClause") letClauses.push(c);
          else if (c.type === "WhereClause") whereClauses.push(c);
          else if (c.type === "OrderByClause") orderByClause = c;
          else if (c.type === "ReturnClause") returnClause = c;
        }

        if (forClauses.length === 0 || !returnClause) {
          return "i32.const 0";
        }

        const retValNode = returnClause.childForFieldName?.("value");
        const firstCollNode = forClauses[0]!.childForFieldName?.("collection");
        const firstSrcElemWasmType = this.resolveArrayElementWasmType(firstCollNode);
        const dstElemWasmType = retValNode ? this.exprType(retValNode) : firstSrcElemWasmType;
        const dstElemSize = dstElemWasmType === "f64" || dstElemWasmType === "i64" ? 8 : 4;
        const loopId = ++this.loopCounter;

        const instrs: string[] = [];

        // 1. Evaluate all input collections and load their lengths
        for (let k = 0; k < forClauses.length; k++) {
          const fc = forClauses[k]!;
          const collNode = fc.childForFieldName?.("collection");
          const srcLocal = k === 0 ? "__flwor_src" : `__flwor_src_${k}`;
          const lenLocal = k === 0 ? "__flwor_len" : `__flwor_len_${k}`;
          instrs.push(
            this.emitExpression(collNode),
            `local.set $${srcLocal}`,
            `local.get $${srcLocal}`,
            "i32.load offset=0",
            `local.set $${lenLocal}`,
          );
        }

        // 2. Compute maximum output capacity = product of collection lengths
        instrs.push("local.get $__flwor_len");
        for (let k = 1; k < forClauses.length; k++) {
          instrs.push(`local.get $__flwor_len_${k}`, "i32.mul");
        }
        instrs.push(
          `i32.const ${dstElemSize}`,
          "i32.mul",
          "i32.const 8",
          "i32.add",
          "call $__alloc",
          "local.set $__flwor_dst",
        );

        // If OrderByClause is present, allocate a parallel key buffer
        let keyWasmType = "f64";
        let keyElemSize = 8;
        let isDescending = false;
        let isKeyUnsigned = false;
        const criteriaNode = orderByClause?.childForFieldName?.("criteria") ?? null;
        if (orderByClause && criteriaNode) {
          const dirText = (orderByClause.childForFieldName?.("direction")?.text || "ascending").toLowerCase();
          isDescending = dirText === "descending" || dirText === "desc";
          const keySem = this.semanticType(criteriaNode);
          isKeyUnsigned = keySem.kind === "u32";
          keyWasmType = this.exprType(criteriaNode);
          keyElemSize = keyWasmType === "f64" || keyWasmType === "i64" ? 8 : 4;

          instrs.push("local.get $__flwor_len");
          for (let k = 1; k < forClauses.length; k++) {
            instrs.push(`local.get $__flwor_len_${k}`, "i32.mul");
          }
          instrs.push(
            `i32.const ${keyElemSize}`,
            "i32.mul",
            "i32.const 8",
            "i32.add",
            "call $__alloc",
            "local.set $__flwor_keys",
          );
        }

        instrs.push("i32.const 0", "local.set $__flwor_out_len");

        // 3. Open nested loops for each ForClause (relational Cartesian/filtered join)
        for (let k = 0; k < forClauses.length; k++) {
          const fc = forClauses[k]!;
          const varName = fc.childForFieldName?.("variable")?.text || "$x";
          const collNode = fc.childForFieldName?.("collection");
          const srcElemWasmType = this.resolveArrayElementWasmType(collNode);
          const srcElemSize = srcElemWasmType === "f64" || srcElemWasmType === "i64" ? 8 : 4;
          const srcLocal = k === 0 ? "__flwor_src" : `__flwor_src_${k}`;
          const lenLocal = k === 0 ? "__flwor_len" : `__flwor_len_${k}`;
          const idxLocal = k === 0 ? "__flwor_idx" : `__flwor_idx_${k}`;
          const bLabel = k === 0 ? `$flwor_b_${loopId}` : `$flwor_b_${loopId}_${k}`;
          const lLabel = k === 0 ? `$flwor_l_${loopId}` : `$flwor_l_${loopId}_${k}`;

          instrs.push(
            "i32.const 0",
            `local.set $${idxLocal}`,
            `block ${bLabel}`,
            `  loop ${lLabel}`,
            `    local.get $${idxLocal}`,
            `    local.get $${lenLocal}`,
            "    i32.ge_s",
            `    br_if ${bLabel}`,
            `    local.get $${srcLocal}`,
            `    local.get $${idxLocal}`,
            `    i32.const ${srcElemSize}`,
            "    i32.mul",
            "    i32.add",
            `    ${srcElemWasmType}.load offset=8`,
            `    local.set $${varName}`,
          );
        }

        for (const letClause of letClauses) {
          const letVarName = letClause.childForFieldName?.("variable")?.text;
          const letValNode = letClause.childForFieldName?.("value");
          if (letVarName && letValNode) {
            const letWasmType = this.locals.get(letVarName) || this.exprType(letValNode);
            instrs.push(this.emitExpressionAs(letValNode, letWasmType));
            instrs.push(`    local.set $${letVarName}`);
          }
        }

        const storeResultInstrs: string[] = [
          "      local.get $__flwor_dst",
          "      local.get $__flwor_out_len",
          `      i32.const ${dstElemSize}`,
          "      i32.mul",
          "      i32.add",
          this.emitExpressionAs(retValNode, dstElemWasmType),
          `      ${dstElemWasmType}.store offset=8`,
        ];

        if (orderByClause && criteriaNode) {
          storeResultInstrs.push(
            "      local.get $__flwor_keys",
            "      local.get $__flwor_out_len",
            `      i32.const ${keyElemSize}`,
            "      i32.mul",
            "      i32.add",
            this.emitExpressionAs(criteriaNode, keyWasmType),
            `      ${keyWasmType}.store offset=8`,
          );
        }

        storeResultInstrs.push(
          "      local.get $__flwor_out_len",
          "      i32.const 1",
          "      i32.add",
          "      local.set $__flwor_out_len",
        );

        if (whereClauses.length > 0) {
          for (const wc of whereClauses) {
            const condNode = wc.childForFieldName?.("condition");
            instrs.push(this.emitExpression(condNode));
            instrs.push("    if");
          }
          instrs.push(...storeResultInstrs);
          for (let i = 0; i < whereClauses.length; i++) {
            instrs.push("    end");
          }
        } else {
          instrs.push(...storeResultInstrs);
        }

        // 4. Close nested ForClause loops from innermost to outermost
        for (let k = forClauses.length - 1; k >= 0; k--) {
          const idxLocal = k === 0 ? "__flwor_idx" : `__flwor_idx_${k}`;
          const lLabel = k === 0 ? `$flwor_l_${loopId}` : `$flwor_l_${loopId}_${k}`;
          instrs.push(
            `    local.get $${idxLocal}`,
            "    i32.const 1",
            "    i32.add",
            `    local.set $${idxLocal}`,
            `    br ${lLabel}`,
            "  end",
            "end",
          );
        }

        // 5. Optional in-memory sorting when OrderByClause is present
        if (orderByClause && criteriaNode) {
          const isKeyFloat = keyWasmType === "f64" || keyWasmType === "f32";
          const cmpInstr = isDescending
            ? isKeyFloat
              ? `${keyWasmType}.lt`
              : isKeyUnsigned
                ? `${keyWasmType}.lt_u`
                : `${keyWasmType}.lt_s`
            : isKeyFloat
              ? `${keyWasmType}.gt`
              : isKeyUnsigned
                ? `${keyWasmType}.gt_u`
                : `${keyWasmType}.gt_s`;
          const tmpKeyLocal = `__flwor_tmp_key_${keyWasmType}`;
          const tmpValLocal = `__flwor_tmp_val_${dstElemWasmType}`;

          instrs.push(
            "i32.const 0",
            "local.set $__flwor_sort_i",
            `block $flwor_sb_o_${loopId}`,
            `  loop $flwor_sl_o_${loopId}`,
            "    local.get $__flwor_sort_i",
            "    local.get $__flwor_out_len",
            "    i32.ge_s",
            `    br_if $flwor_sb_o_${loopId}`,
            "    local.get $__flwor_sort_i",
            "    i32.const 1",
            "    i32.add",
            "    local.set $__flwor_sort_j",
            `    block $flwor_sb_i_${loopId}`,
            `      loop $flwor_sl_i_${loopId}`,
            "        local.get $__flwor_sort_j",
            "        local.get $__flwor_out_len",
            "        i32.ge_s",
            `        br_if $flwor_sb_i_${loopId}`,
            // Load key[i]
            "        local.get $__flwor_keys",
            "        local.get $__flwor_sort_i",
            `        i32.const ${keyElemSize}`,
            "        i32.mul",
            "        i32.add",
            `        ${keyWasmType}.load offset=8`,
            // Load key[j]
            "        local.get $__flwor_keys",
            "        local.get $__flwor_sort_j",
            `        i32.const ${keyElemSize}`,
            "        i32.mul",
            "        i32.add",
            `        ${keyWasmType}.load offset=8`,
            `        ${cmpInstr}`,
            "        if",
            // Swap keys[i] and keys[j]
            "          local.get $__flwor_keys",
            "          local.get $__flwor_sort_i",
            `          i32.const ${keyElemSize}`,
            "          i32.mul",
            "          i32.add",
            `          ${keyWasmType}.load offset=8`,
            `          local.set $${tmpKeyLocal}`,
            "          local.get $__flwor_keys",
            "          local.get $__flwor_sort_i",
            `          i32.const ${keyElemSize}`,
            "          i32.mul",
            "          i32.add",
            "          local.get $__flwor_keys",
            "          local.get $__flwor_sort_j",
            `          i32.const ${keyElemSize}`,
            "          i32.mul",
            "          i32.add",
            `          ${keyWasmType}.load offset=8`,
            `          ${keyWasmType}.store offset=8`,
            "          local.get $__flwor_keys",
            "          local.get $__flwor_sort_j",
            `          i32.const ${keyElemSize}`,
            "          i32.mul",
            "          i32.add",
            `          local.get $${tmpKeyLocal}`,
            `          ${keyWasmType}.store offset=8`,
            // Swap dst[i] and dst[j]
            "          local.get $__flwor_dst",
            "          local.get $__flwor_sort_i",
            `          i32.const ${dstElemSize}`,
            "          i32.mul",
            "          i32.add",
            `          ${dstElemWasmType}.load offset=8`,
            `          local.set $${tmpValLocal}`,
            "          local.get $__flwor_dst",
            "          local.get $__flwor_sort_i",
            `          i32.const ${dstElemSize}`,
            "          i32.mul",
            "          i32.add",
            "          local.get $__flwor_dst",
            "          local.get $__flwor_sort_j",
            `          i32.const ${dstElemSize}`,
            "          i32.mul",
            "          i32.add",
            `          ${dstElemWasmType}.load offset=8`,
            `          ${dstElemWasmType}.store offset=8`,
            "          local.get $__flwor_dst",
            "          local.get $__flwor_sort_j",
            `          i32.const ${dstElemSize}`,
            "          i32.mul",
            "          i32.add",
            `          local.get $${tmpValLocal}`,
            `          ${dstElemWasmType}.store offset=8`,
            "        end",
            "        local.get $__flwor_sort_j",
            "        i32.const 1",
            "        i32.add",
            "        local.set $__flwor_sort_j",
            `        br $flwor_sl_i_${loopId}`,
            "      end",
            "    end",
            "    local.get $__flwor_sort_i",
            "    i32.const 1",
            "    i32.add",
            "    local.set $__flwor_sort_i",
            `    br $flwor_sl_o_${loopId}`,
            "  end",
            "end",
          );
        }

        instrs.push(
          "local.get $__flwor_dst",
          "local.get $__flwor_out_len",
          "i32.store offset=0",
          "local.get $__flwor_dst",
        );

        return instrs.join("\n");
      }

      case "BinaryExpression": {
        const leftNode = node.childForFieldName?.("left");
        const opNode = node.childForFieldName?.("operator");
        const rightNode = node.childForFieldName?.("right");
        const op = opNode?.text || "+";

        const leftSem = this.semanticType(leftNode);
        const rightSem = this.semanticType(rightNode);
        const leftWasm = this.exprType(leftNode);
        const rightWasm = this.exprType(rightNode);

        const isUnsigned = leftSem.kind === "u32" || rightSem.kind === "u32";
        const isF64 = leftWasm === "f64" || rightWasm === "f64";
        const isF32 = !isF64 && (leftWasm === "f32" || rightWasm === "f32");
        const isI64 = !isF64 && !isF32 && (leftWasm === "i64" || rightWasm === "i64");

        const operandType =
          op === "&&" || op === "||"
            ? "i32"
            : op === "%"
              ? isI64
                ? "i64"
                : "i32"
              : isF64
                ? "f64"
                : isF32
                  ? "f32"
                  : isI64
                    ? "i64"
                    : "i32";
        const isFloat = operandType === "f64" || operandType === "f32";
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
            instr = isFloat ? `${prefix}.div` : isUnsigned ? `${prefix}.div_u` : `${prefix}.div_s`;
            break;
          case "%":
            instr = isUnsigned ? `${prefix}.rem_u` : `${prefix}.rem_s`;
            break;
          case "==":
            instr = `${prefix}.eq`;
            break;
          case "!=":
            instr = `${prefix}.ne`;
            break;
          case "<":
            instr = isFloat ? `${prefix}.lt` : isUnsigned ? `${prefix}.lt_u` : `${prefix}.lt_s`;
            break;
          case "<=":
            instr = isFloat ? `${prefix}.le` : isUnsigned ? `${prefix}.le_u` : `${prefix}.le_s`;
            break;
          case ">":
            instr = isFloat ? `${prefix}.gt` : isUnsigned ? `${prefix}.gt_u` : `${prefix}.gt_s`;
            break;
          case ">=":
            instr = isFloat ? `${prefix}.ge` : isUnsigned ? `${prefix}.ge_u` : `${prefix}.ge_s`;
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
          const opType = this.exprType(operandNode);
          if (opType === "f64") {
            return `${operandWat}\nf64.neg`;
          }
          if (opType === "f32") {
            return `${operandWat}\nf32.neg`;
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
              if (arg?.type === "Argument") {
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
                : fieldWasmType === "f32"
                  ? "f32.load"
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
            if (arg && (arg.type === "Argument" || (arg.type !== "(" && arg.type !== ")" && arg.type !== ","))) {
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

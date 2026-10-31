// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Semantic type representation used across ModelScript's Salsa queries and WASM codegen.
 */
export type ModelScriptType =
  | { kind: "i32" }
  | { kind: "u32" }
  | { kind: "i64" }
  | { kind: "f32" }
  | { kind: "f64" }
  | { kind: "bool" }
  | { kind: "string" }
  | { kind: "struct"; name: string }
  | { kind: "array"; element: ModelScriptType }
  | { kind: "unknown" };

/**
 * Memory layout metadata for a single field within a linear-memory struct.
 */
export interface StructFieldLayout {
  name: string;
  type: ModelScriptType;
  size: number;
  offset: number;
  alignment: number;
}

/**
 * Computed byte layout, alignment, and field table for a ModelScript `struct`.
 */
export interface StructLayout {
  name: string;
  totalSize: number;
  alignment: number;
  fields: StructFieldLayout[];
}

/**
 * Returns the byte size and natural alignment requirement for a `ModelScriptType`
 * in 32-bit WebAssembly linear memory.
 */
export function getTypeSizeAndAlign(type: ModelScriptType): { size: number; align: number } {
  switch (type.kind) {
    case "i32":
    case "u32":
    case "f32":
      return { size: 4, align: 4 };
    case "i64":
    case "f64":
      return { size: 8, align: 8 };
    case "bool":
      return { size: 1, align: 1 };
    case "string":
    case "array":
      return { size: 4, align: 4 }; // Pointer in 32-bit WASM linear memory
    case "struct":
      return { size: 4, align: 4 }; // Reference pointer
    default:
      return { size: 4, align: 4 };
  }
}

/**
 * Parses a textual type annotation (e.g., `"f64"`, `"f32"`, `"u32"`, `"Array<i32>"`, `"Vector3"`)
 * into a structured `ModelScriptType`.
 */
export function parseTypeName(typeStr: string): ModelScriptType {
  const trimmed = typeStr.trim();
  if (trimmed === "i32") return { kind: "i32" };
  if (trimmed === "u32") return { kind: "u32" };
  if (trimmed === "i64") return { kind: "i64" };
  if (trimmed === "f32") return { kind: "f32" };
  if (trimmed === "f64") return { kind: "f64" };
  if (trimmed === "bool") return { kind: "bool" };
  if (trimmed === "string") return { kind: "string" };

  if (trimmed.startsWith("Array<") && trimmed.endsWith(">")) {
    const inner = trimmed.slice(6, -1);
    return { kind: "array", element: parseTypeName(inner) };
  }
  if (trimmed.startsWith("Slice<") && trimmed.endsWith(">")) {
    const inner = trimmed.slice(6, -1);
    return { kind: "array", element: parseTypeName(inner) };
  }

  return { kind: "struct", name: trimmed };
}

/**
 * Structural CST node interface compatible with generated WASM `SyntaxNode` instances.
 */
export interface ModelScriptCstNode {
  id?: number | string | undefined;
  type: string;
  text: string;
  name?: string | undefined;
  fieldName?: string | undefined;
  startIndex?: number | undefined;
  endIndex?: number | undefined;
  startPosition?: { row: number; column: number } | undefined;
  endPosition?: { row: number; column: number } | undefined;
  parent?: ModelScriptCstNode | null | undefined;
  children?: ModelScriptCstNode[] | undefined;
  namedChildren?: ModelScriptCstNode[] | undefined;
  childCount: number;
  child(index: number): ModelScriptCstNode | null;
  childForFieldName(name: string): ModelScriptCstNode | null;
}

/**
 * Recursively unwraps grammar wrapper CST nodes (`TopLevelDeclaration`, `Statement`,
 * `Expression`, `PrimaryExpression`, `ParenthesizedExpression`) to reach the underlying
 * semantic AST/CST node.
 */
export function unwrapNode(node: ModelScriptCstNode): ModelScriptCstNode;
export function unwrapNode(node: ModelScriptCstNode | null | undefined): ModelScriptCstNode | null;
export function unwrapNode(node: ModelScriptCstNode | null | undefined): ModelScriptCstNode | null {
  if (!node) return null;
  let current: ModelScriptCstNode | null = node;
  while (
    current &&
    (current.type === "TopLevelDeclaration" ||
      current.type === "Statement" ||
      current.type === "Expression" ||
      current.type === "PrimaryExpression" ||
      current.type === "ParenthesizedExpression")
  ) {
    if (current.type === "ParenthesizedExpression") {
      const inner: ModelScriptCstNode | null | undefined = current.childForFieldName
        ? current.childForFieldName("expression")
        : current.namedChildren?.[0];
      if (!inner || inner === current) break;
      current = inner;
      continue;
    }
    let child: ModelScriptCstNode | null = null;
    for (let i = 0; i < current.childCount; i++) {
      const c = current.child(i);
      if (c && c.type !== ";" && c.type !== "_EmptyStatement") {
        child = c;
        break;
      }
    }
    if (!child || child === current) break;
    current = child;
  }
  return current;
}

/**
 * Salsa Query memoization cache key helper.
 */
function queryKey(queryName: string, id: string | number): string {
  return `${queryName}:${id}`;
}

/**
 * Revision-tracked Salsa query engine for ModelScript, providing memoized
 * struct memory layout computation and expression type inference.
 */
export class ModelScriptQueryEngine {
  private layoutCache = new Map<string, { revision: number; value: StructLayout }>();
  private exprCache = new Map<string, { revision: number; value: ModelScriptType }>();
  private structLayouts = new Map<string, StructLayout>();
  private globalRevision = 1;

  /**
   * Advances the global revision counter, invalidating stale cached query entries.
   */
  incrementRevision(): number {
    return ++this.globalRevision;
  }

  /**
   * Returns the current global revision number.
   */
  getRevision(): number {
    return this.globalRevision;
  }

  /**
   * Clears all memoized query results and resets the revision counter.
   */
  clear(): void {
    this.layoutCache.clear();
    this.exprCache.clear();
    this.structLayouts.clear();
    this.globalRevision = 1;
  }

  /**
   * Walks up to the root `SourceFile` node and indexes all top-level `StructDeclaration` layouts.
   */
  private indexStructsFromRoot(contextNode: ModelScriptCstNode | null | undefined): void {
    let curr = contextNode;
    while (curr?.parent) {
      curr = curr.parent;
    }
    if (!curr || !curr.childCount) return;
    for (let i = 0; i < curr.childCount; i++) {
      const child = unwrapNode(curr.child(i));
      if (child?.type === "StructDeclaration") {
        this.structLayout(child);
      }
    }
  }

  /**
   * Looks up a struct's memory layout by name, lazily indexing root declarations if needed.
   */
  private findStructLayout(structName: string, contextNode?: ModelScriptCstNode | null): StructLayout | undefined {
    let layout = this.structLayouts.get(structName);
    if (!layout && contextNode) {
      this.indexStructsFromRoot(contextNode);
      layout = this.structLayouts.get(structName);
    }
    return layout;
  }

  /**
   * Searches all known struct layouts for a field matching `propName` when receiver type is unknown.
   */
  private findFieldInAnyStruct(propName: string, contextNode?: ModelScriptCstNode | null): ModelScriptType | undefined {
    if (contextNode) {
      this.indexStructsFromRoot(contextNode);
    }
    for (const layout of this.structLayouts.values()) {
      const field = layout.fields.find((f) => f.name === propName);
      if (field) return field.type;
    }
    return undefined;
  }

  /**
   * Computes the memory layout (offsets, alignment, size) for an @unmanaged struct node.
   */
  structLayout(rawStructNode: ModelScriptCstNode): StructLayout {
    const structNode = unwrapNode(rawStructNode);
    const structName = structNode.childForFieldName ? structNode.childForFieldName("name")?.text : structNode.name;
    const cacheKey = queryKey("structLayout", structName || structNode.id || 0);

    const cached = this.layoutCache.get(cacheKey);
    if (cached && cached.revision === this.globalRevision) {
      return cached.value;
    }

    const fields: StructFieldLayout[] = [];
    let currentOffset = 0;
    let maxAlign = 1;

    const fieldNodes =
      structNode.namedChildren?.filter(
        (c: ModelScriptCstNode) =>
          c.type === "StructField" || c.type === "field" || (c.type === "IDENTIFIER" && c.fieldName === "fields"),
      ) ?? [];

    for (const f of fieldNodes) {
      const fNameNode = f.childForFieldName ? f.childForFieldName("name") : null;
      const fTypeNode = f.childForFieldName ? f.childForFieldName("type") : null;
      const fName = fNameNode?.text || f.name || "unnamed";
      const fType = parseTypeName(fTypeNode?.text || "i32");

      const { size, align } = getTypeSizeAndAlign(fType);
      if (align > maxAlign) maxAlign = align;

      // Natural alignment padding
      if (currentOffset % align !== 0) {
        currentOffset += align - (currentOffset % align);
      }

      fields.push({
        name: fName,
        type: fType,
        size,
        offset: currentOffset,
        alignment: align,
      });

      currentOffset += size;
    }

    // Structure tail padding
    if (maxAlign > 1 && currentOffset % maxAlign !== 0) {
      currentOffset += maxAlign - (currentOffset % maxAlign);
    }

    const layout: StructLayout = {
      name: structName || "AnonymousStruct",
      totalSize: currentOffset,
      alignment: maxAlign,
      fields,
    };

    this.structLayouts.set(layout.name, layout);
    this.layoutCache.set(cacheKey, { revision: this.globalRevision, value: layout });
    return layout;
  }

  /**
   * Infers the type of an expression node.
   */
  inferExpressionType(
    rawNode: ModelScriptCstNode | null | undefined,
    scope: Map<string, ModelScriptType> = new Map(),
  ): ModelScriptType {
    const node = unwrapNode(rawNode);
    if (!node) return { kind: "unknown" };

    // Build a deterministic cache key incorporating both node span and active lexical scope bindings
    const scopeTag =
      scope.size > 0
        ? Array.from(scope.entries())
            .map(([k, v]) => {
              if (v.kind === "struct") return `${k}:struct:${v.name}`;
              if (v.kind === "array") return `${k}:array:${v.element.kind}`;
              return `${k}:${v.kind}`;
            })
            .join(",")
        : "";
    const cacheKey = queryKey("inferExpr", `${node.startIndex}_${node.endIndex}_${node.text}_${scopeTag}`);
    const cached = this.exprCache.get(cacheKey);
    if (cached && cached.revision === this.globalRevision) {
      return cached.value;
    }

    let result: ModelScriptType = { kind: "unknown" };

    switch (node.type) {
      case "NUMBER": {
        // Floating-point literals contain a decimal point or scientific exponent
        const text = node.text || "";
        result = text.includes(".") || text.toLowerCase().includes("e") ? { kind: "f64" } : { kind: "i32" };
        break;
      }
      case "STRING":
        result = { kind: "string" };
        break;
      case "BOOLEAN":
        result = { kind: "bool" };
        break;
      case "IDENTIFIER": {
        const name = node.text || "";
        if (scope.has(name)) {
          result = scope.get(name)!;
        }
        break;
      }
      case "UnaryExpression": {
        const ch = Array.isArray(node.children)
          ? node.children
          : Array.from({ length: node.childCount || 0 }, (_, i) => node.child(i)).filter(
              (c): c is ModelScriptCstNode => c !== null,
            );
        const op = node.childForFieldName?.("operator")?.text ?? ch[0]?.text;
        const operand = node.childForFieldName?.("operand") ?? ch[1];
        if (op === "!") {
          result = { kind: "bool" };
        } else {
          result = this.inferExpressionType(operand, scope);
        }
        break;
      }
      case "BinaryExpression": {
        const ch = Array.isArray(node.children)
          ? node.children
          : Array.from({ length: node.childCount || 0 }, (_, i) => node.child(i)).filter(
              (c): c is ModelScriptCstNode => c !== null,
            );
        const left = node.childForFieldName?.("left") ?? ch[0];
        const op = node.childForFieldName?.("operator")?.text ?? ch[1]?.text;
        const right = node.childForFieldName?.("right") ?? ch[2];

        // Relational and logical operators always yield boolean results; arithmetic promotes across numeric hierarchy
        if (op && ["==", "!=", "<", "<=", ">", ">="].includes(op)) {
          result = { kind: "bool" };
        } else if (op && ["&&", "||"].includes(op)) {
          result = { kind: "bool" };
        } else {
          const lType = this.inferExpressionType(left, scope);
          const rType = this.inferExpressionType(right, scope);
          if (lType.kind === "f64" || rType.kind === "f64") {
            result = { kind: "f64" };
          } else if (lType.kind === "f32" || rType.kind === "f32") {
            result = { kind: "f32" };
          } else if (lType.kind === "i64" || rType.kind === "i64") {
            result = { kind: "i64" };
          } else if (lType.kind === "u32" || rType.kind === "u32") {
            result = { kind: "u32" };
          } else if (lType.kind !== "unknown") {
            result = lType;
          } else {
            result = rType;
          }
        }
        break;
      }
      case "ArrayLiteral": {
        const ch =
          node.namedChildren ??
          Array.from({ length: node.childCount || 0 }, (_, i) => node.child(i)).filter(
            (c): c is ModelScriptCstNode => c !== null && c.type !== "[" && c.type !== "]" && c.type !== ",",
          );
        if (ch.length > 0) {
          const elemType = this.inferExpressionType(ch[0], scope);
          result = { kind: "array", element: elemType };
        } else {
          result = { kind: "array", element: { kind: "unknown" } };
        }
        break;
      }
      case "NewExpression": {
        const ch =
          node.namedChildren ??
          Array.from({ length: node.childCount || 0 }, (_, i) => node.child(i)).filter(
            (c): c is ModelScriptCstNode =>
              c !== null && c.type !== "new" && c.type !== "(" && c.type !== ")" && c.type !== ",",
          );
        const ctorName =
          node.childForFieldName?.("constructor")?.text ||
          node.childForFieldName?.("class")?.text ||
          ch[0]?.text ||
          "AnonymousStruct";
        result = { kind: "struct", name: ctorName };
        break;
      }
      case "FLWORExpression": {
        const ch =
          node.namedChildren ??
          Array.from({ length: node.childCount || 0 }, (_, i) => node.child(i)).filter(
            (c): c is ModelScriptCstNode => c !== null,
          );
        const flworScope = new Map(scope);
        for (const c of ch) {
          if (c.type === "ForClause") {
            const fcChildren = Array.from({ length: c.childCount || 0 }, (_, i) => c.child(i)).filter(
              (fc): fc is ModelScriptCstNode => fc !== null,
            );
            const varNode = c.childForFieldName?.("variable") ?? fcChildren.find((fc) => fc.type === "IDENTIFIER");
            const inIdx = fcChildren.findIndex((fc) => fc.type === "in");
            const collNode = c.childForFieldName?.("collection") ?? (inIdx >= 0 ? fcChildren[inIdx + 1] : undefined);
            if (varNode?.text && collNode) {
              const collType = this.inferExpressionType(collNode, flworScope);
              flworScope.set(varNode.text, collType.kind === "array" ? collType.element : { kind: "f64" });
            }
          }
        }
        const returnClause = ch.find((c: ModelScriptCstNode) => c.type === "ReturnClause");
        if (returnClause) {
          const rcChildren = Array.from({ length: returnClause.childCount || 0 }, (_, i) =>
            returnClause.child(i),
          ).filter((rc): rc is ModelScriptCstNode => rc !== null && rc.type !== "return");
          const expr =
            returnClause.childForFieldName?.("value") ||
            returnClause.childForFieldName?.("expression") ||
            returnClause.namedChildren?.[0] ||
            rcChildren[0];
          const itemType = this.inferExpressionType(expr, flworScope);
          result = { kind: "array", element: itemType };
        }
        break;
      }
      case "PostfixExpression": {
        let objNode = node.childForFieldName?.("object") ?? null;
        let propNode = node.childForFieldName?.("property") ?? null;
        let arrNode = node.childForFieldName?.("array") ?? null;
        let idxNode = node.childForFieldName?.("index") ?? null;

        if (!objNode && !arrNode) {
          const ch = Array.from({ length: node.childCount || 0 }, (_, i) => node.child(i)).filter(
            (c): c is ModelScriptCstNode => c !== null,
          );
          if (ch.some((c) => c.type === ".")) {
            objNode = ch[0] ?? null;
            propNode = ch[2] ?? null;
          } else if (ch.some((c) => c.type === "[")) {
            arrNode = ch[0] ?? null;
            idxNode = ch[2] ?? null;
          } else if (ch.some((c) => c.type === "(") && ch[0]?.text && scope.has(ch[0].text)) {
            result = scope.get(ch[0].text)!;
            break;
          }
        }

        if (objNode && propNode) {
          const propName = propNode.text || "";
          const objType = this.inferExpressionType(objNode, scope);
          if (propName === "length" && (objType.kind === "array" || objType.kind === "string")) {
            result = { kind: "i32" };
          } else if (objType.kind === "struct") {
            const layout = this.findStructLayout(objType.name, node);
            const field = layout?.fields.find((f) => f.name === propName);
            result = field ? field.type : { kind: "f64" };
          } else {
            const fieldType = this.findFieldInAnyStruct(propName, node);
            result = fieldType ?? { kind: "f64" };
          }
        } else if (arrNode && idxNode) {
          const arrType = this.inferExpressionType(arrNode, scope);
          result = arrType.kind === "array" ? arrType.element : { kind: "f64" };
        } else {
          result = { kind: "f64" };
        }
        break;
      }
      default:
        break;
    }

    this.exprCache.set(cacheKey, { revision: this.globalRevision, value: result });
    return result;
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Semantic type representation used across ModelScript's Salsa queries and WASM codegen.
 */
export type ModelScriptType =
  | { kind: "i32" }
  | { kind: "u32" }
  | { kind: "i64" }
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
 * Parses a textual type annotation (e.g., `"f64"`, `"Array<i32>"`, `"Vector3"`)
 * into a structured `ModelScriptType`.
 */
export function parseTypeName(typeStr: string): ModelScriptType {
  const trimmed = typeStr.trim();
  if (trimmed === "i32") return { kind: "i32" };
  if (trimmed === "u32") return { kind: "u32" };
  if (trimmed === "i64") return { kind: "i64" };
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
 * Recursively unwraps grammar wrapper CST nodes (`TopLevelDeclaration`, `Statement`,
 * `Expression`, `PrimaryExpression`, `ParenthesizedExpression`) to reach the underlying
 * semantic AST/CST node.
 */
export function unwrapNode(node: any): any {
  if (!node) return null;
  while (
    node &&
    (node.type === "TopLevelDeclaration" ||
      node.type === "Statement" ||
      node.type === "Expression" ||
      node.type === "PrimaryExpression" ||
      node.type === "ParenthesizedExpression")
  ) {
    if (node.type === "ParenthesizedExpression") {
      const inner = node.childForFieldName ? node.childForFieldName("expression") : node.namedChildren?.[0];
      if (!inner || inner === node) break;
      node = inner;
      continue;
    }
    let child = null;
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c && c.type !== ";" && c.type !== "_EmptyStatement") {
        child = c;
        break;
      }
    }
    if (!child || child === node) break;
    node = child;
  }
  return node;
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
  private cache = new Map<string, { revision: number; value: any }>();
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
    this.cache.clear();
    this.structLayouts.clear();
    this.globalRevision = 1;
  }

  /**
   * Walks up to the root `SourceFile` node and indexes all top-level `StructDeclaration` layouts.
   */
  private indexStructsFromRoot(contextNode: any): void {
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
  private findStructLayout(structName: string, contextNode?: any): StructLayout | undefined {
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
  private findFieldInAnyStruct(propName: string, contextNode?: any): ModelScriptType | undefined {
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
  structLayout(rawStructNode: any): StructLayout {
    const structNode = unwrapNode(rawStructNode);
    const structName = structNode.childForFieldName ? structNode.childForFieldName("name")?.text : structNode.name;
    const cacheKey = queryKey("structLayout", structName || structNode.id || 0);

    const cached = this.cache.get(cacheKey);
    if (cached && cached.revision === this.globalRevision) {
      return cached.value;
    }

    const fields: StructFieldLayout[] = [];
    let currentOffset = 0;
    let maxAlign = 1;

    const fieldNodes =
      structNode.namedChildren?.filter(
        (c: any) =>
          c.type === "StructField" || c.type === "field" || (c.type === "IDENTIFIER" && c.fieldName === "fields"),
      ) ?? [];

    for (const f of fieldNodes) {
      const fNameNode = f.childForFieldName ? f.childForFieldName("name") : f.name;
      const fTypeNode = f.childForFieldName ? f.childForFieldName("type") : f.type;
      const fName = fNameNode?.text || "unnamed";
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
    this.cache.set(cacheKey, { revision: this.globalRevision, value: layout });
    return layout;
  }

  /**
   * Infers the type of an expression node.
   */
  inferExpressionType(rawNode: any, scope: Map<string, ModelScriptType> = new Map()): ModelScriptType {
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
    const cached = this.cache.get(cacheKey);
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
        const op = node.childForFieldName ? node.childForFieldName("operator")?.text : node.children?.[0]?.text;
        const operand = node.childForFieldName ? node.childForFieldName("operand") : node.children?.[1];
        if (op === "!") {
          result = { kind: "bool" };
        } else {
          result = this.inferExpressionType(operand, scope);
        }
        break;
      }
      case "BinaryExpression": {
        const left = node.childForFieldName ? node.childForFieldName("left") : node.children?.[0];
        const op = node.childForFieldName ? node.childForFieldName("operator")?.text : node.children?.[1]?.text;
        const right = node.childForFieldName ? node.childForFieldName("right") : node.children?.[2];

        // Relational and logical operators always yield boolean results; arithmetic promotes to f64
        if (["==", "!=", "<", "<=", ">", ">="].includes(op)) {
          result = { kind: "bool" };
        } else if (["&&", "||"].includes(op)) {
          result = { kind: "bool" };
        } else {
          const lType = this.inferExpressionType(left, scope);
          const rType = this.inferExpressionType(right, scope);
          if (lType.kind === "f64" || rType.kind === "f64") {
            result = { kind: "f64" };
          } else {
            result = lType;
          }
        }
        break;
      }
      case "ArrayLiteral": {
        const elements = node.namedChildren || [];
        if (elements.length > 0) {
          const elemType = this.inferExpressionType(elements[0], scope);
          result = { kind: "array", element: elemType };
        } else {
          result = { kind: "array", element: { kind: "unknown" } };
        }
        break;
      }
      case "NewExpression": {
        const ctorName =
          node.childForFieldName?.("constructor")?.text ||
          node.childForFieldName?.("class")?.text ||
          node.namedChildren?.[0]?.text ||
          "AnonymousStruct";
        result = { kind: "struct", name: ctorName };
        break;
      }
      case "FLWORExpression": {
        // A FLWOR query always evaluates to an array of its ReturnClause expression type
        const returnClause = node.namedChildren?.find((c: any) => c.type === "ReturnClause");
        if (returnClause) {
          const expr =
            returnClause.childForFieldName?.("value") ||
            returnClause.childForFieldName?.("expression") ||
            returnClause.namedChildren?.[0];
          const itemType = this.inferExpressionType(expr, scope);
          result = { kind: "array", element: itemType };
        }
        break;
      }
      case "PostfixExpression": {
        const objNode = node.childForFieldName?.("object");
        const propNode = node.childForFieldName?.("property");
        const arrNode = node.childForFieldName?.("array");
        const idxNode = node.childForFieldName?.("index");

        if (objNode && propNode) {
          const propName = propNode.text || "";
          const objType = this.inferExpressionType(objNode, scope);
          if (objType.kind === "struct") {
            const layout = this.findStructLayout(objType.name, node);
            const field = layout?.fields.find((f) => f.name === propName);
            result = field ? field.type : { kind: "f64" };
          } else if (objType.kind === "array" && propName === "length") {
            result = { kind: "i32" };
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

    this.cache.set(cacheKey, { revision: this.globalRevision, value: result });
    return result;
  }
}

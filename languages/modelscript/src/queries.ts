// SPDX-License-Identifier: AGPL-3.0-or-later

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

export interface StructFieldLayout {
  name: string;
  type: ModelScriptType;
  size: number;
  offset: number;
  alignment: number;
}

export interface StructLayout {
  name: string;
  totalSize: number;
  alignment: number;
  fields: StructFieldLayout[];
}

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

export function unwrapNode(node: any): any {
  if (!node) return null;
  while (
    node &&
    (node.type === "TopLevelDeclaration" ||
      node.type === "Statement" ||
      node.type === "Expression" ||
      node.type === "PrimaryExpression")
  ) {
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

export class ModelScriptQueryEngine {
  private cache = new Map<string, { revision: number; value: any }>();
  private globalRevision = 1;

  incrementRevision(): number {
    return ++this.globalRevision;
  }

  getRevision(): number {
    return this.globalRevision;
  }

  clear(): void {
    this.cache.clear();
    this.globalRevision = 1;
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

    this.cache.set(cacheKey, { revision: this.globalRevision, value: layout });
    return layout;
  }

  /**
   * Infers the type of an expression node.
   */
  inferExpressionType(rawNode: any, scope: Map<string, ModelScriptType> = new Map()): ModelScriptType {
    const node = unwrapNode(rawNode);
    if (!node) return { kind: "unknown" };

    const cacheKey = queryKey("inferExpr", `${node.startIndex}_${node.endIndex}_${node.text}`);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.revision === this.globalRevision) {
      return cached.value;
    }

    let result: ModelScriptType = { kind: "unknown" };

    switch (node.type) {
      case "NUMBER": {
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
      case "BinaryExpression": {
        const left = node.childForFieldName ? node.childForFieldName("left") : node.children?.[0];
        const op = node.childForFieldName ? node.childForFieldName("operator")?.text : node.children?.[1]?.text;
        const right = node.childForFieldName ? node.childForFieldName("right") : node.children?.[2];

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
      case "FLWORExpression": {
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
        // e.g. x.val -> look into struct if available, otherwise unknown
        result = { kind: "f64" };
        break;
      }
      default:
        break;
    }

    this.cache.set(cacheKey, { revision: this.globalRevision, value: result });
    return result;
  }
}

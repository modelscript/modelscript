// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Standard Semantic CST Node Tags (GraalVM/Truffle Instrumentation API pattern).
 *
 * Assigns a compact 32-bit `SemanticCstTag` bitmask to each grammar rule ID in a static
 * `Uint32Array` table. This requires zero extra bytes per CST node in linear memory while
 * enabling universal LSP outline/folding/tokens, diagram extraction, DAP breakpoints, and
 * blast-radius highlighting across all 106+ languages without per-language glue code.
 */

export enum SemanticCstTag {
  None = 0,

  // Structural tags (bits 0..7)
  Root = 0x00000001,
  Declaration = 0x00000002,
  Component = 0x00000004,
  Import = 0x00000008,
  Inheritance = 0x00000010,
  Scope = 0x00000020,
  Block = 0x00000040,
  Comment = 0x00000080,

  // Interface & wiring tags (bits 8..13)
  Port = 0x00000100,
  Connection = 0x00000200,
  Parameter = 0x00000400,
  Modifier = 0x00000800,
  TypeRef = 0x00001000,
  Identifier = 0x00002000,

  // Behavioral & equation tags (bits 14..21)
  Equation = 0x00004000,
  Statement = 0x00008000,
  Expression = 0x00010000,
  Call = 0x00020000,
  State = 0x00040000,
  Transition = 0x00080000,
  Function = 0x00100000,
  Algorithm = 0x00200000,

  // Engineering & domain tags (bits 22..27)
  Requirement = 0x00400000,
  Annotation = 0x00800000,
  Unit = 0x01000000,
  Geometry = 0x02000000,
  Constraint = 0x04000000,
  Literal = 0x08000000,
}

/**
 * Compact static lookup table mapping numeric grammar `kindId` -> `SemanticCstTag` bitmask,
 * plus optional name-based fallback for CST wrappers that expose string `type` names.
 */
export interface SemanticTagTable {
  /** Indexed by numeric CST `kindId` for O(1) zero-allocation checks. */
  readonly byKindId: Uint32Array;
  /** Indexed by grammar rule name (e.g. `"class_definition"`, `"connect_clause"`). */
  readonly byRuleName: ReadonlyMap<string, number>;
}

/**
 * Minimal CST node shape compatible with both linear-memory CST wrappers and `SyntaxNode`.
 */
export interface TaggableCstNode {
  readonly type: string;
  readonly kindId?: number | undefined;
  readonly startIndex?: number | undefined;
  readonly endIndex?: number | undefined;
  readonly startPosition?: { readonly row: number; readonly column: number } | undefined;
  readonly endPosition?: { readonly row: number; readonly column: number } | undefined;
  readonly text?: string | undefined;
  readonly namedChildren?: readonly TaggableCstNode[] | undefined;
  readonly children?: readonly TaggableCstNode[] | undefined;
  childForFieldName?(fieldName: string): TaggableCstNode | null | undefined;
}

/**
 * Infers sensible default `SemanticCstTag` bits from a grammar rule name so languages
 * get baseline instrumentation automatically even before explicit `.tag(...)` annotations.
 */
export function inferDefaultTagsFromRuleName(ruleName: string): number {
  const r = ruleName.toLowerCase();
  let mask = SemanticCstTag.None;

  if (r === "source_file" || r === "stored_definition" || r === "program" || r === "compilation_unit" || r === "root") {
    mask |= SemanticCstTag.Root | SemanticCstTag.Scope;
  }
  if (
    r.includes("class_definition") ||
    r.includes("model_definition") ||
    r.includes("part_definition") ||
    r.includes("block_definition") ||
    r.includes("subckt") ||
    r.includes("entity_declaration") ||
    r.includes("module_declaration")
  ) {
    mask |= SemanticCstTag.Declaration | SemanticCstTag.Scope | SemanticCstTag.Block;
  }
  if (r.includes("function_definition") || r.includes("action_definition") || r.includes("method_declaration")) {
    mask |= SemanticCstTag.Declaration | SemanticCstTag.Function | SemanticCstTag.Scope | SemanticCstTag.Block;
  }
  if (
    r.includes("component_clause") ||
    r.includes("component_declaration") ||
    r.includes("part_usage") ||
    r.includes("instance")
  ) {
    mask |= SemanticCstTag.Component | SemanticCstTag.Declaration;
  }
  if (r.includes("import_clause") || r.includes("import_statement") || r.includes("include_directive")) {
    mask |= SemanticCstTag.Import;
  }
  if (r.includes("extends_clause") || r.includes("specialization") || r.includes("inheritance")) {
    mask |= SemanticCstTag.Inheritance;
  }
  if (r.includes("port") || r.includes("connector") || r.includes("pin") || r.includes("terminal")) {
    mask |= SemanticCstTag.Port;
  }
  if (r.includes("connect_clause") || r.includes("connection") || r.includes("bind_clause")) {
    mask |= SemanticCstTag.Connection;
  }
  if (r.includes("parameter") || r.includes("attribute_usage") || r.includes("attribute_def")) {
    mask |= SemanticCstTag.Parameter;
  }
  if (r.includes("modification") || r.includes("modifier")) {
    mask |= SemanticCstTag.Modifier;
  }
  if (r.includes("equation") && !r.includes("section")) {
    mask |= SemanticCstTag.Equation;
  }
  if (r.includes("equation_section") || r.includes("algorithm_section") || r.includes("body") || r.includes("block")) {
    mask |= SemanticCstTag.Block;
  }
  if (r.includes("algorithm")) {
    mask |= SemanticCstTag.Algorithm;
  }
  if (r.includes("statement") || r.includes("assignment")) {
    mask |= SemanticCstTag.Statement;
  }
  if (r.includes("call_expression") || r.includes("function_call")) {
    mask |= SemanticCstTag.Call | SemanticCstTag.Expression;
  } else if (r.includes("expression") || r.includes("expr")) {
    mask |= SemanticCstTag.Expression;
  }
  if (r.includes("state_def") || r.includes("state_usage") || r === "state") {
    mask |= SemanticCstTag.State | SemanticCstTag.Scope;
  }
  if (r.includes("transition")) {
    mask |= SemanticCstTag.Transition;
  }
  if (r.includes("requirement") || r.includes("satisfy") || r.includes("verify")) {
    mask |= SemanticCstTag.Requirement;
  }
  if (r.includes("annotation") || r.includes("metadata")) {
    mask |= SemanticCstTag.Annotation;
  }
  if (r.includes("constraint") || r.includes("assert")) {
    mask |= SemanticCstTag.Constraint;
  }
  if (r.includes("comment")) {
    mask |= SemanticCstTag.Comment;
  }
  if (r.includes("identifier") || r === "ident" || r === "name") {
    mask |= SemanticCstTag.Identifier;
  }
  if (r.includes("literal") || r.includes("number") || r.includes("string")) {
    mask |= SemanticCstTag.Literal;
  }

  return mask;
}

/**
 * Builds a `SemanticTagTable` from a grammar's rule-name list (indexed by `kindId`)
 * merged with optional explicit rule-to-tag overrides.
 */
export function buildSemanticTagTable(
  ruleNamesByKindId: readonly string[],
  explicitTags?: Readonly<Record<string, number>>,
): SemanticTagTable {
  const byKindId = new Uint32Array(ruleNamesByKindId.length);
  const byRuleName = new Map<string, number>();

  for (let i = 0; i < ruleNamesByKindId.length; i++) {
    const ruleName = ruleNamesByKindId[i]!;
    const explicit = explicitTags?.[ruleName];
    const mask = explicit !== undefined ? explicit >>> 0 : inferDefaultTagsFromRuleName(ruleName) >>> 0;
    byKindId[i] = mask;
    if (mask !== SemanticCstTag.None) {
      byRuleName.set(ruleName, mask);
    }
  }

  if (explicitTags) {
    for (const [ruleName, mask] of Object.entries(explicitTags)) {
      byRuleName.set(ruleName, mask >>> 0);
    }
  }

  return { byKindId, byRuleName };
}

/**
 * O(1) lookup of a CST node's `SemanticCstTag` bitmask.
 * Uses the flat `Uint32Array` `byKindId` table when `kindId` is available, falling back
 * to `byRuleName` or `inferDefaultTagsFromRuleName`.
 */
export function getNodeSemanticTags(node: TaggableCstNode, table?: SemanticTagTable): number {
  if (table) {
    if (node.kindId !== undefined && node.kindId >= 0 && node.kindId < table.byKindId.length) {
      return table.byKindId[node.kindId]!;
    }
    const byName = table.byRuleName.get(node.type);
    if (byName !== undefined) return byName;
  }
  return inferDefaultTagsFromRuleName(node.type);
}

/**
 * Returns `true` if `node` carries all bits specified in `requiredTagMask`.
 */
export function nodeHasSemanticTag(node: TaggableCstNode, requiredTagMask: number, table?: SemanticTagTable): boolean {
  if (requiredTagMask === SemanticCstTag.None) return true;
  return (getNodeSemanticTags(node, table) & requiredTagMask) === requiredTagMask;
}

/**
 * Emits a static TypeScript/JavaScript `Uint32Array` literal (`SEMANTIC_TAG_BY_KIND_ID`)
 * for inclusion in `@modelscript/dsl` generated WASM parser bindings, providing O(1)
 * zero-allocation `kindId -> SemanticCstTag` lookups at parse time.
 */
export function generateSemanticTagTableSource(
  ruleNamesByKindId: readonly string[],
  explicitTags?: Readonly<Record<string, number>>,
): string {
  const table = buildSemanticTagTable(ruleNamesByKindId, explicitTags);
  const values = Array.from(table.byKindId, (v) => `0x${v.toString(16)}`);
  return [
    "// Auto-generated static SemanticCstTag table indexed by CST kindId",
    `export const SEMANTIC_TAG_BY_KIND_ID = new Uint32Array([${values.join(", ")}]);`,
    "",
  ].join("\n");
}

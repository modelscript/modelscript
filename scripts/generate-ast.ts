#!/usr/bin/env npx tsx
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * generate-ast.ts
 *
 * Reads tree-sitter's generated `grammar.json` and emits a fully-typed AST
 * module for incremental parsing reconciliation.
 *
 * Usage:
 *   npx tsx scripts/generate-ast.ts [--grammar src/grammar.json] [--out src/ast.ts]
 */

import * as fs from "fs";
import * as path from "path";

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function flag(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GRAMMAR_PATH = flag(
  "grammar",
  path.resolve(__dirname, "..", "languages", "modelica", "tree-sitter-modelica", "src", "grammar.json"),
);
const OUTPUT_PATH = flag("out", path.resolve(__dirname, "..", "languages", "modelica", "ast", "src", "index.ts"));

// ─── Grammar JSON types ─────────────────────────────────────────────────────

interface GrammarRule {
  type: string;
  name?: string;
  value?: string;
  content?: GrammarRule;
  members?: GrammarRule[];
}

interface GrammarJSON {
  name: string;
  word: string;
  rules: Record<string, GrammarRule>;
  extras: GrammarRule[];
  conflicts: string[][];
  supertypes: string[];
}

// ─── Naming helpers ──────────────────────────────────────────────────────────

const RESERVED_NAMES = new Set(["Number", "String", "Boolean", "Object", "Array", "Function", "Error", "Symbol"]);

function toPascalCase(name: string): string {
  const pascal = name
    .replace(/^_+/, "")
    .split("_")
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join("");
  return RESERVED_NAMES.has(pascal) ? `${pascal}Node` : pascal;
}

function toCamelCase(name: string): string {
  const pascal = name
    .replace(/^_+/, "")
    .split("_")
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join("");
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function isHiddenRule(name: string): boolean {
  return name.startsWith("_");
}

function isTerminal(rule: GrammarRule): boolean {
  if (rule.type === "PATTERN") return true;
  if (rule.type === "STRING") return true;
  if (rule.type === "SEQ") {
    return (rule.members ?? []).every((m) => m.type === "STRING" || m.type === "PATTERN");
  }
  if (rule.type === "CHOICE") {
    return (rule.members ?? []).every((m) => m.type === "STRING" || m.type === "BLANK");
  }
  return false;
}

// ─── Analysis ────────────────────────────────────────────────────────────────

interface FieldInfo {
  name: string;
  typeName: string;
  ruleName: string;
  optional: boolean;
  multiple: boolean;
}

interface HiddenChildInfo {
  hiddenRuleName: string;
  concreteTypes: string[];
  repeated: boolean;
}

interface NodeInfo {
  ruleName: string;
  typeName: string;
  hidden: boolean;
  terminal: boolean;
  fields: FieldInfo[];
  unionMembers: string[];
  childSymbols: string[];
  hiddenChildren: HiddenChildInfo[];
}

function extractFields(
  rule: GrammarRule,
  ctx: { optional: boolean; multiple: boolean } = { optional: false, multiple: false },
): FieldInfo[] {
  const fields: FieldInfo[] = [];
  switch (rule.type) {
    case "FIELD":
      if (rule.content) {
        fields.push({
          name: rule.name!,
          typeName: resolveFieldType(rule.content),
          ruleName: resolveFieldRuleName(rule.content),
          optional: ctx.optional,
          multiple: ctx.multiple,
        });
      }
      break;
    case "SEQ":
      for (const m of rule.members ?? []) fields.push(...extractFields(m, ctx));
      break;
    case "CHOICE": {
      const hasBlank = (rule.members ?? []).some((m) => m.type === "BLANK");
      for (const m of rule.members ?? []) {
        if (m.type === "BLANK") continue;
        fields.push(...extractFields(m, { optional: ctx.optional || hasBlank, multiple: ctx.multiple }));
      }
      break;
    }
    case "REPEAT":
    case "REPEAT1":
      if (rule.content) fields.push(...extractFields(rule.content, { optional: ctx.optional, multiple: true }));
      break;
    default:
      if (rule.content) fields.push(...extractFields(rule.content, ctx));
      break;
  }
  return fields;
}

function extractChildSymbols(rule: GrammarRule): { concrete: string[]; hidden: { name: string; repeated: boolean }[] } {
  const concrete: string[] = [];
  const hidden: { name: string; repeated: boolean }[] = [];
  function walk(r: GrammarRule, inRepeat: boolean): void {
    switch (r.type) {
      case "SYMBOL":
        if (isHiddenRule(r.name!)) hidden.push({ name: r.name!, repeated: inRepeat });
        else concrete.push(r.name!);
        break;
      case "FIELD":
        break;
      case "SEQ":
      case "CHOICE":
        for (const m of r.members ?? []) walk(m, inRepeat);
        break;
      case "REPEAT":
      case "REPEAT1":
        if (r.content) walk(r.content, true);
        break;
      default:
        if (r.content) walk(r.content, inRepeat);
        break;
    }
  }
  walk(rule, false);
  return { concrete, hidden };
}

function resolveFieldType(rule: GrammarRule): string {
  switch (rule.type) {
    case "SYMBOL":
      return toPascalCase(rule.name!);
    case "CHOICE": {
      const types = (rule.members ?? []).filter((m) => m.type !== "BLANK").map((m) => resolveFieldType(m));
      return [...new Set(types)].join(" | ");
    }
    case "ALIAS":
      return toPascalCase(rule.value ?? rule.name ?? "Unknown");
    default:
      return "SyntaxNode";
  }
}

function resolveFieldRuleName(rule: GrammarRule): string {
  switch (rule.type) {
    case "SYMBOL":
      return rule.name!;
    case "ALIAS":
      return rule.value ?? rule.name ?? "";
    default:
      return "";
  }
}

function extractUnionMembers(rule: GrammarRule): string[] {
  if (rule.type !== "CHOICE") return [];
  return (rule.members ?? []).filter((m) => m.type === "SYMBOL").map((m) => m.name!);
}

function resolveHiddenToConcretes(ruleName: string, grammar: GrammarJSON, visited: Set<string> = new Set()): string[] {
  if (visited.has(ruleName)) return [];
  visited.add(ruleName);
  const rule = grammar.rules[ruleName];
  if (!rule) return [];
  if (!isHiddenRule(ruleName)) return [ruleName];
  const concretes: string[] = [];
  for (const m of extractUnionMembers(rule)) concretes.push(...resolveHiddenToConcretes(m, grammar, visited));
  return concretes;
}

function analyzeGrammar(grammar: GrammarJSON): Map<string, NodeInfo> {
  const nodes = new Map<string, NodeInfo>();
  for (const [ruleName, rule] of Object.entries(grammar.rules)) {
    const hidden = isHiddenRule(ruleName);
    const terminal = isTerminal(rule);
    const fields = extractFields(rule);
    const fieldMap = new Map<string, FieldInfo>();
    for (const f of fields) {
      const existing = fieldMap.get(f.name);
      if (existing) {
        existing.optional = existing.optional || f.optional;
        existing.multiple = existing.multiple || f.multiple;
        const types = new Set(existing.typeName.split(" | "));
        for (const t of f.typeName.split(" | ")) types.add(t);
        existing.typeName = [...types].join(" | ");
      } else {
        fieldMap.set(f.name, { ...f });
      }
    }
    const unionMembers = hidden ? extractUnionMembers(rule) : [];
    const { concrete, hidden: hiddenSyms } = extractChildSymbols(rule);
    const fieldRuleNames = new Set([...fieldMap.values()].map((f) => f.ruleName));
    const childSymbols = [...new Set(concrete)].filter((s) => !fieldRuleNames.has(s));
    const hiddenChildMap = new Map<string, HiddenChildInfo>();
    for (const hs of hiddenSyms) {
      if (!hiddenChildMap.has(hs.name)) {
        hiddenChildMap.set(hs.name, {
          hiddenRuleName: hs.name,
          concreteTypes: resolveHiddenToConcretes(hs.name, grammar),
          repeated: hs.repeated,
        });
      } else if (hs.repeated) {
        hiddenChildMap.get(hs.name)!.repeated = true;
      }
    }
    nodes.set(ruleName, {
      ruleName,
      typeName: toPascalCase(ruleName),
      hidden,
      terminal,
      fields: [...fieldMap.values()],
      unionMembers,
      childSymbols,
      hiddenChildren: [...hiddenChildMap.values()],
    });
  }
  return nodes;
}

function ruleContainsRepeatOf(rule: GrammarRule, symbolName: string): boolean {
  switch (rule.type) {
    case "REPEAT":
    case "REPEAT1":
      return ruleContainsSymbol(rule.content!, symbolName);
    case "SEQ":
    case "CHOICE":
      return (rule.members ?? []).some((m) => ruleContainsRepeatOf(m, symbolName));
    default:
      return rule.content ? ruleContainsRepeatOf(rule.content, symbolName) : false;
  }
}

function ruleContainsSymbol(rule: GrammarRule, symbolName: string): boolean {
  if (rule.type === "SYMBOL" && rule.name === symbolName) return true;
  if (rule.members) return rule.members.some((m) => ruleContainsSymbol(m, symbolName));
  if (rule.content) return ruleContainsSymbol(rule.content, symbolName);
  return false;
}

// ─── Slot descriptors for codegen ────────────────────────────────────────────

interface SlotDescriptor {
  /** The key used in childSlots and in JSON */
  slotKey: string;
  /** camelCase accessor name */
  accessor: string;
  /** PascalCase type (class name) of the child */
  typeName: string;
  /** I-prefixed interface type for JSON */
  iTypeName: string;
  /** Whether the slot is an array */
  multiple: boolean;
  /** Whether the slot can be null/absent */
  optional: boolean;
  /** Source: 'field' (named tree-sitter field), 'child' (non-field concrete child), 'hidden' (hidden union child) */
  source: "field" | "child" | "hidden";
  /** For 'field' and 'child': the tree-sitter type to match. For 'hidden': the concrete type set. */
  cstMatchTypes: string[];
}

function buildSlots(info: NodeInfo, grammar: GrammarJSON, nodes: Map<string, NodeInfo>): SlotDescriptor[] {
  const slots: SlotDescriptor[] = [];
  const fieldRuleNames = new Set(info.fields.map((f) => f.ruleName));

  // 1. Named fields
  for (const field of info.fields) {
    slots.push({
      slotKey: field.name,
      accessor: toCamelCase(field.name),
      typeName: field.typeName,
      iTypeName: field.typeName
        .split(" | ")
        .map((t) => `I${t}`)
        .join(" | "),
      multiple: field.multiple,
      optional: field.optional,
      source: "field",
      cstMatchTypes: [field.ruleName],
    });
  }

  // 2. Non-field concrete children
  const nonFieldChildren = info.childSymbols.filter((s) => !fieldRuleNames.has(s));
  for (const childRule of nonFieldChildren) {
    const childInfo = nodes.get(childRule);
    if (!childInfo) continue;
    const isRepeated = ruleContainsRepeatOf(grammar.rules[info.ruleName], childRule);
    slots.push({
      slotKey: childRule,
      accessor: toCamelCase(childRule),
      typeName: childInfo.typeName,
      iTypeName: `I${childInfo.typeName}`,
      multiple: isRepeated,
      optional: !isRepeated,
      source: "child",
      cstMatchTypes: [childRule],
    });
  }

  // 3. Hidden-rule children
  for (const hc of info.hiddenChildren) {
    const hiddenInfo = nodes.get(hc.hiddenRuleName);
    if (!hiddenInfo || hiddenInfo.unionMembers.length === 0) continue;
    const unionName = toPascalCase(hc.hiddenRuleName);
    slots.push({
      slotKey: hc.hiddenRuleName,
      accessor: toCamelCase(hc.hiddenRuleName),
      typeName: unionName,
      iTypeName: `I${unionName}`,
      multiple: hc.repeated,
      optional: !hc.repeated,
      source: "hidden",
      cstMatchTypes: hc.concreteTypes,
    });
  }

  return slots;
}

// ─── Code generation ─────────────────────────────────────────────────────────

function generateCode(grammar: GrammarJSON, nodes: Map<string, NodeInfo>): string {
  const L: string[] = [];
  const emit = (line = "") => L.push(line);
  const emitBlock = (block: string) => block.split("\n").forEach((l) => L.push(l));

  // Derive prefix from grammar name (e.g. "sysml2" → "SysML2", "modelica" → "Modelica")
  const grammarPrefix = toPascalCase(grammar.name);
  const visitorInterface = `I${grammarPrefix}SyntaxVisitor`;

  // Derive root node type from the first rule in the grammar
  const rootRuleName = Object.keys(grammar.rules)[0];
  const rootTypeName = toPascalCase(rootRuleName);
  const rootITypeName = `I${rootTypeName}`;
  const visitorClass = `${grammarPrefix}SyntaxVisitor`;

  // ── Header ────────────────────────────────────────────────────────────────

  emitBlock(`// ──────────────────────────────────────────────────────────────────────────────
// AUTO-GENERATED — do not edit manually.
// Generated from grammar.json by scripts/generate-ast.ts
//
// Architecture: Hybrid Fiber (Proposal 5) with dual-source constructors,
// I-prefixed JSON interfaces, content/structural hashing, and toJSON.
// ──────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
`);

  // ── Tree-sitter interop types ─────────────────────────────────────────────

  emitBlock(`// ─── Tree-sitter interop types ───────────────────────────────────────────────

export interface TSNode {
  readonly type: string;
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: TSPoint;
  readonly endPosition: TSPoint;
  readonly childCount: number;
  readonly children: TSNode[];
  readonly namedChildCount: number;
  readonly namedChildren: TSNode[];
  readonly hasChanges: boolean;
  readonly id: number;
  parent: TSNode | null;
  childForFieldName(fieldName: string): TSNode | null;
  childrenForFieldName(fieldName: string): TSNode[];
  fieldNameForChild(childIndex: number): string | null;
}

export interface TSPoint {
  readonly row: number;
  readonly column: number;
}
`);

  // ── Source range ───────────────────────────────────────────────────────────

  emitBlock(`// ─── Source location ─────────────────────────────────────────────────────────

export interface SourceRange {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: TSPoint;
  readonly endPosition: TSPoint;
}

function sourceRangeFrom(node: TSNode): SourceRange {
  return {
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    startPosition: node.startPosition,
    endPosition: node.endPosition,
  };
}
`);

  // ── JSON value type ───────────────────────────────────────────────────────

  emitBlock(`// ─── JSON types ─────────────────────────────────────────────────────────────

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };
`);

  // ── Hashing ───────────────────────────────────────────────────────────────

  emitBlock(`// ─── Hashing ────────────────────────────────────────────────────────────────

/**
 * FNV-1a 32-bit hash.  Fast, non-cryptographic, good distribution.
 * Used for both content hashes and structural hashes.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

function hashToHex(hash: number): string {
  return (hash >>> 0).toString(16).padStart(8, "0");
}
`);

  // ── Node type constants ───────────────────────────────────────────────────

  emit("// ─── Node type constants ────────────────────────────────────────────────────");
  emit("");
  emit("export const NodeType = {");
  for (const [ruleName, info] of nodes) {
    if (!info.hidden) emit(`  ${info.typeName}: "${ruleName}" as const,`);
  }
  emit("} as const;");
  emit("");
  emit("export type NodeTypeValue = (typeof NodeType)[keyof typeof NodeType];");
  emit("");

  // ── Base ISyntaxNode interface ────────────────────────────────────────────

  emitBlock(`// ─── Base JSON interface ─────────────────────────────────────────────────────

/** Base JSON shape for all AST nodes.  Every I-prefixed interface extends this. */
export interface ISyntaxNode {
  readonly "@type": string;
  readonly nodeId?: number;
  readonly sourceRange?: SourceRange | null;
  readonly contentHash?: string;
  readonly structuralHash?: string;
}
`);

  // ── Base SyntaxNode class ─────────────────────────────────────────────────

  emitBlock(`// ─── Change Event System ─────────────────────────────────────────────────────

export type ChangeKind = "added" | "removed" | "modified" | "reused";

/**
 * Describes a single change that occurred during AST reconciliation.
 * Emitted by reconcileAST() so the semantic layer can perform targeted updates.
 */
export interface ASTChangeEvent {
  /** What happened to this node. */
  readonly kind: ChangeKind;
  /** The node affected (the new node for added/modified, the old node for removed). */
  readonly node: SyntaxNode;
  /** For "modified": the previous version of this node (node.alternate). */
  readonly oldNode?: SyntaxNode | undefined;
  /** The parent slot name this node belongs to. */
  readonly parentSlot?: string | undefined;
  /** The parent node. */
  readonly parent?: SyntaxNode | undefined;
}

/**
 * Mutable collector for change events during a single reconciliation pass.
 * Created at the start of reconcileAST() and threaded through all reconcile calls.
 */
export class ChangeCollector {
  readonly events: ASTChangeEvent[] = [];

  added(node: SyntaxNode, parentSlot?: string, parent?: SyntaxNode): void {
    this.events.push({ kind: "added", node, parentSlot, parent });
  }

  removed(node: SyntaxNode, parentSlot?: string, parent?: SyntaxNode): void {
    this.events.push({ kind: "removed", node, parentSlot, parent });
  }

  modified(node: SyntaxNode, oldNode: SyntaxNode, parentSlot?: string, parent?: SyntaxNode): void {
    this.events.push({ kind: "modified", node, oldNode, parentSlot, parent });
  }

  reused(node: SyntaxNode, parentSlot?: string, parent?: SyntaxNode): void {
    this.events.push({ kind: "reused", node, parentSlot, parent });
  }
}

/** Result of an incremental reconciliation. */
export interface ReconcileResult {
  readonly ast: ${rootTypeName};
  readonly events: readonly ASTChangeEvent[];
}
`);

  // ── Base SyntaxNode class ─────────────────────────────────────────────────

  emitBlock(`// ─── Base SyntaxNode — Hybrid Fiber Architecture (Lazy + Incremental) ────────

let globalVersion = 0;
export function nextVersion(): number { return ++globalVersion; }

let globalNodeId = 0;
export function nextNodeId(): number { return ++globalNodeId; }
/** Set the next node ID counter (e.g. when restoring from JSON). */
export function setNextNodeId(id: number): void { globalNodeId = id; }

export abstract class SyntaxNode implements ISyntaxNode {
  /** The tree-sitter rule name (e.g. "part_definition"). */
  abstract readonly "@type": string;

  /** Visitor pattern: dispatch to the appropriate visitor method. */
  abstract accept<R, A>(visitor: ${visitorInterface}<R, A>, argument?: A): R;

  /** Stable identity that survives serialization round-trips. */
  readonly nodeId: number;

  sourceRange: SourceRange | null;

  // ── Fiber fields ────────────────────────────────────────────────────

  alternate: SyntaxNode | null = null;
  version: number = 0;
  dirty: boolean = false;

  // ── CST backing reference (for lazy child materialization) ──────────

  /** The underlying tree-sitter CST node. Held for lazy children.  */
  protected _cstNode: TSNode | null = null;

  /** Tracks which child slots have been materialized from the CST. */
  private _materializedSlots: Set<string> = new Set();

  /** Whether a given child slot has been materialized. */
  isMaterialized(fieldName: string): boolean {
    return this._materializedSlots.has(fieldName);
  }

  // ── Tree pointers ───────────────────────────────────────────────────

  private _parent: WeakRef<SyntaxNode> | null = null;
  /** Which field name this node occupies in its parent. */
  parentSlot: string | null = null;

  get parent(): SyntaxNode | null { return this._parent?.deref() ?? null; }

  setParent(parent: SyntaxNode | null): void {
    this._parent = parent ? new WeakRef(parent) : null;
  }

  // ── Child slot registry ─────────────────────────────────────────────

  protected childSlots: Map<string, SyntaxNode | SyntaxNode[] | null> = new Map();

  /** Set of all valid slot names for this node type (populated by subclass constructors). */
  protected _slotNames: Set<string> = new Set();

  protected setChild(fieldName: string, child: SyntaxNode | null): void {
    this.childSlots.set(fieldName, child);
    this._materializedSlots.add(fieldName);
    if (child) {
      child.setParent(this);
      child.parentSlot = fieldName;
    }
  }

  protected setChildren(fieldName: string, children: SyntaxNode[]): void {
    this.childSlots.set(fieldName, children);
    this._materializedSlots.add(fieldName);
    for (const child of children) {
      child.setParent(this);
      child.parentSlot = fieldName;
    }
  }

  getChild(fieldName: string): SyntaxNode | null {
    const slot = this.childSlots.get(fieldName);
    return slot instanceof SyntaxNode ? slot : null;
  }

  getChildren(fieldName: string): SyntaxNode[] {
    const slot = this.childSlots.get(fieldName);
    return Array.isArray(slot) ? slot : [];
  }

  // ── Lazy child materialization ──────────────────────────────────────

  /**
   * Lazy single-child accessor.  On first access, calls the factory to
   * materialize the child from the backing CST node.  Subsequent accesses
   * return the cached result.  If constructing from JSON, the slot is
   * pre-populated eagerly and this is essentially a no-op wrapper.
   */
  protected lazyChild<T extends SyntaxNode>(
    fieldName: string,
    factory: () => T | null,
  ): T | null {
    if (this._materializedSlots.has(fieldName)) {
      return this.getChild(fieldName) as T | null;
    }
    this._materializedSlots.add(fieldName);
    const child = factory();
    // Use setChild to wire up parent pointers
    this.childSlots.set(fieldName, child);
    if (child) {
      child.setParent(this);
      child.parentSlot = fieldName;
    }
    return child;
  }

  /**
   * Lazy array-child accessor.  Same lazy semantics as lazyChild but for
   * list slots (e.g. \`classDefinitions\`, \`members\`).
   */
  protected lazyChildren<T extends SyntaxNode>(
    fieldName: string,
    factory: () => T[],
  ): T[] {
    if (this._materializedSlots.has(fieldName)) {
      return this.getChildren(fieldName) as T[];
    }
    this._materializedSlots.add(fieldName);
    const children = factory();
    this.childSlots.set(fieldName, children);
    for (const child of children) {
      child.setParent(this);
      child.parentSlot = fieldName;
    }
    return children;
  }

  // ── Hashing ─────────────────────────────────────────────────────────

  /**
   * Content hash: captures the full structural shape AND leaf text values.
   * Two subtrees with identical content hashes are semantically identical.
   *
   * For unmaterialized slots, falls back to CST-based proxy hashing
   * (using byte length + start index) to avoid forcing materialization.
   */
  private _contentHash: string | null = null;

  get contentHash(): string {
    if (this._contentHash === null) this._contentHash = hashToHex(this.computeContentHash());
    return this._contentHash;
  }

  /**
   * Structural hash: captures only the tree shape (node types, field names,
   * child counts) but NOT leaf text.  Useful for detecting structurally
   * equivalent subtrees that differ only in identifiers/values.
   */
  private _structuralHash: string | null = null;

  get structuralHash(): string {
    if (this._structuralHash === null) this._structuralHash = hashToHex(this.computeStructuralHash());
    return this._structuralHash;
  }

  /** Override in subclasses to include field-specific data. */
  protected computeContentHash(): number {
    let parts = this["@type"];
    for (const key of this._slotNames) {
      parts += ":" + key + "=";
      if (!this._materializedSlots.has(key)) {
        // Unmaterialized — use CST text as proxy without materializing
        const cstChild = this._cstNode?.childForFieldName(key);
        parts += cstChild ? "cst:" + cstChild.endIndex + ":" + cstChild.startIndex : "null";
        continue;
      }
      const slot = this.childSlots.get(key);
      if (Array.isArray(slot)) {
        parts += "[" + slot.map((c) => c.contentHash).join(",") + "]";
      } else if (slot) {
        parts += slot.contentHash;
      } else {
        parts += "null";
      }
    }
    return fnv1a(parts);
  }

  protected computeStructuralHash(): number {
    let parts = this["@type"];
    for (const key of this._slotNames) {
      parts += ":" + key + "=";
      if (!this._materializedSlots.has(key)) {
        // Unmaterialized — use CST type as proxy without materializing
        const cstChild = this._cstNode?.childForFieldName(key);
        parts += cstChild ? "cst:" + cstChild.type : "null";
        continue;
      }
      const slot = this.childSlots.get(key);
      if (Array.isArray(slot)) {
        parts += "[" + slot.map((c) => c.structuralHash).join(",") + "]";
      } else if (slot) {
        parts += slot.structuralHash;
      } else {
        parts += "null";
      }
    }
    return fnv1a(parts);
  }

  /** Invalidate cached hashes (call after reconciliation). */
  protected invalidateHash(): void {
    this._contentHash = null;
    this._structuralHash = null;
  }

  // ── Ancestry & Path ──────────────────────────────────────────────────

  /** Walk up the tree to find the nearest ancestor passing a predicate. */
  closestAncestor<T extends SyntaxNode>(predicate: (n: SyntaxNode) => n is T): T | null {
    let curr = this.parent;
    while (curr) {
      if (predicate(curr)) return curr;
      curr = curr.parent;
    }
    return null;
  }

  /** Get the full path from root to this node. */
  get path(): SyntaxNode[] {
    const res: SyntaxNode[] = [];
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let curr: SyntaxNode | null = this;
    while (curr) {
      res.unshift(curr);
      curr = curr.parent;
    }
    return res;
  }

  /** Distance from root (0-indexed). */
  get depth(): number {
    let d = 0;
    let curr = this.parent;
    while (curr) {
      d++;
      curr = curr.parent;
    }
    return d;
  }

  // ── Sibling Navigation ────────────────────────────────────────────────

  /** 
   * Index within the parent's child array. 
   * Returns -1 if the node has no parent or is in a singular slot.
   */
  get childIndex(): number {
    const p = this.parent;
    if (!p || !this.parentSlot) return -1;
    const slot = p.childSlots.get(this.parentSlot);
    if (Array.isArray(slot)) return slot.indexOf(this);
    return -1;
  }

  /** Previous sibling in the same slot array. */
  get previousSibling(): SyntaxNode | null {
    const idx = this.childIndex;
    if (idx <= 0 || !this.parent || !this.parentSlot) return null;
    const slot = this.parent.childSlots.get(this.parentSlot);
    if (Array.isArray(slot)) return slot[idx - 1] ?? null;
    return null;
  }

  /** Next sibling in the same slot array. */
  get nextSibling(): SyntaxNode | null {
    const idx = this.childIndex;
    if (idx < 0 || !this.parent || !this.parentSlot) return null;
    const slot = this.parent.childSlots.get(this.parentSlot);
    if (Array.isArray(slot)) return slot[idx + 1] ?? null;
    return null;
  }

  // ── Diffing ──────────────────────────────────────────────────────────

  /**
   * Compare this node to its alternate (previous version).
   * Returns an array of slot names whose content hashes changed.
   */
  diffFromAlternate(): string[] {
    if (!this.alternate) return Array.from(this._slotNames);
    const changed: string[] = [];
    for (const key of this._slotNames) {
      if (!this._materializedSlots.has(key)) continue;
      const slot = this.childSlots.get(key) ?? null;
      const oldSlot = this.alternate.childSlots.get(key) ?? null;
      const newHash = this.slotContentHash(slot);
      const oldHash = this.alternate.slotContentHash(oldSlot);
      if (newHash !== oldHash) changed.push(key);
    }
    return changed;
  }

  private slotContentHash(slot: SyntaxNode | SyntaxNode[] | null): string {
    if (Array.isArray(slot)) return "[" + slot.map((c) => c.contentHash).join(",") + "]";
    if (slot) return slot.contentHash;
    return "null";
  }

  // ── Tree Traversal ───────────────────────────────────────────────────

  /** Yields all direct children across all materialized slots. */
  *allChildren(): IterableIterator<SyntaxNode> {
    for (const slot of this.childSlots.values()) {
      if (Array.isArray(slot)) {
        for (const child of slot) yield child;
      } else if (slot) {
        yield slot;
      }
    }
  }

  /** Depth-first traversal of all descendants (only materialized). */
  *descendants(): IterableIterator<SyntaxNode> {
    for (const child of this.allChildren()) {
      yield child;
      yield* child.descendants();
    }
  }

  /** Depth-first traversal, filtering by a type guard. */
  *descendantsOfType<T extends SyntaxNode>(guard: (n: SyntaxNode) => n is T): IterableIterator<T> {
    for (const child of this.descendants()) {
      if (guard(child)) yield child;
    }
  }

  // ── Reconciliation ──────────────────────────────────────────────────

  get reconciliationKey(): string { return this["@type"]; }

  markDirty(): void {
    if (this.dirty) return;
    this.dirty = true;
    this.parent?.markDirty();
  }

  updateSourceRange(cstNode: TSNode): void {
    this.sourceRange = sourceRangeFrom(cstNode);
  }

  /**
   * Update the backing CST reference (used during lazy reconciliation
   * to swap the new CST in without materializing children).
   */
  updateCST(cstNode: TSNode): void {
    this._cstNode = cstNode;
    this.sourceRange = sourceRangeFrom(cstNode);
  }

  /**
   * Reconcile this node with a new CST.  Only recurses into
   * **materialized** child slots — unmaterialized "ghost" subtrees
   * simply get their CST reference updated and their lazy cache
   * invalidated, giving O(1) cost for unaccessed function bodies.
   */
  reconcileChildren(newCST: TSNode, collector?: ChangeCollector): void {
    this._cstNode = newCST;

    for (const fieldName of this._slotNames) {
      if (!this._materializedSlots.has(fieldName)) {
        // Unmaterialized ghost — just drop any stale cache.
        // The next lazy getter call will use the new _cstNode.
        continue;
      }

      const oldSlot = this.childSlots.get(fieldName) ?? null;

      if (Array.isArray(oldSlot)) {
        const newCSTChildren = newCST.childrenForFieldName(fieldName);
        const resolvedChildren = newCSTChildren.length > 0
          ? newCSTChildren
          : newCST.namedChildren.filter(c => NODE_FACTORIES[c.type] !== undefined);
        this.childSlots.set(fieldName, reconcileArray(oldSlot, resolvedChildren, this, fieldName, collector));
      } else if (oldSlot instanceof SyntaxNode) {
        const newCSTChild = newCST.childForFieldName(fieldName);
        if (!newCSTChild) {
          this.childSlots.set(fieldName, null);
          collector?.removed(oldSlot, fieldName, this);
          continue;
        }
        if (!newCSTChild.hasChanges) {
          oldSlot.updateSourceRange(newCSTChild);
          oldSlot.updateCST(newCSTChild);
          collector?.reused(oldSlot, fieldName, this);
          continue;
        }
        const newChild = createNode(newCSTChild);
        if (newChild) {
          newChild.alternate = oldSlot;
          newChild.setParent(this);
          this.childSlots.set(fieldName, newChild);
          collector?.modified(newChild, oldSlot, fieldName, this);
        }
      } else {
        const newCSTChild = newCST.childForFieldName(fieldName);
        if (newCSTChild) {
          const newChild = createNode(newCSTChild);
          if (newChild) {
            newChild.setParent(this);
            this.childSlots.set(fieldName, newChild);
            collector?.added(newChild, fieldName, this);
          }
        }
      }
    }
    this.sourceRange = sourceRangeFrom(newCST);
    this.dirty = false;
    this.version = nextVersion();
    this.invalidateHash();
  }

  // ── Serialization ───────────────────────────────────────────────────

  /** Serialize this node to a plain JSON object matching its I-prefixed interface. */
  toJSON(): ISyntaxNode {
    const json: Record<string, any> = {
      "@type": this["@type"],
      nodeId: this.nodeId,
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
    };
    for (const [key, slot] of this.childSlots) {
      if (Array.isArray(slot)) {
        json[key] = slot.map((c) => c.toJSON());
      } else if (slot) {
        json[key] = slot.toJSON();
      } else {
        json[key] = null;
      }
    }
    return json as ISyntaxNode;
  }

  constructor(sourceRange: SourceRange | null, nodeId?: number, cstNode?: TSNode | null) {
    this.nodeId = nodeId ?? nextNodeId();
    this.sourceRange = sourceRange;
    this.version = nextVersion();
    this._cstNode = cstNode ?? null;
  }
}
`);

  // ── Keyed array reconciliation ────────────────────────────────────────────

  emitBlock(`// ─── Keyed Array Reconciliation ──────────────────────────────────────────────

function reconcileArray(
  oldChildren: SyntaxNode[],
  newCSTChildren: TSNode[],
  parent: SyntaxNode,
  slotName?: string,
  collector?: ChangeCollector,
): SyntaxNode[] {
  const oldByKey = new Map<string, SyntaxNode>();
  for (const old of oldChildren) oldByKey.set(old.reconciliationKey, old);

  // Track which old keys were matched, so we can emit "removed" for unmatched ones
  const matchedKeys = new Set<string>();

  const result = newCSTChildren.map((cstChild, index) => {
    const key = computeReconciliationKey(cstChild, index);
    const old = oldByKey.get(key);
    if (old && !cstChild.hasChanges) {
      matchedKeys.add(key);
      old.updateSourceRange(cstChild);
      old.setParent(parent);
      collector?.reused(old, slotName, parent);
      return old;
    }
    if (old && cstChild.hasChanges) {
      matchedKeys.add(key);
      old.markDirty();
      old.reconcileChildren(cstChild, collector);
      old.setParent(parent);
      collector?.modified(old, old.alternate ?? old, slotName, parent);
      return old;
    }
    const newNode = createNode(cstChild);
    if (newNode) {
      newNode.setParent(parent);
      collector?.added(newNode, slotName, parent);
      return newNode;
    }
    throw new Error(\`Cannot create AST node for CST type: \${cstChild.type}\`);
  });

  // Emit "removed" for old children whose keys were not matched
  for (const [key, old] of oldByKey) {
    if (!matchedKeys.has(key)) {
      collector?.removed(old, slotName, parent);
    }
  }

  return result;
}

function computeReconciliationKey(cstNode: TSNode, positionalIndex: number): string {
  const nameChild = cstNode.childForFieldName("name");
  if (nameChild) return \`\${cstNode.type}:\${nameChild.text}\`;
  return \`\${cstNode.type}#\${positionalIndex}\`;
}
`);

  // ── Union type aliases (hidden rules) ─────────────────────────────────────

  emit("// ─── Union Types (from hidden rules) ────────────────────────────────────────");
  emit("");

  for (const [, info] of nodes) {
    if (!info.hidden || info.unionMembers.length === 0) continue;
    const memberTypes = info.unionMembers.map((m) => toPascalCase(m)).join(" | ");
    const iMemberTypes = info.unionMembers.map((m) => `I${toPascalCase(m)}`).join(" | ");
    emit(`/** Union type from hidden rule \`${info.ruleName}\`. */`);
    emit(`export type ${info.typeName} = ${memberTypes};`);
    emit(`export type I${info.typeName} = ${iMemberTypes};`);
    emit("");
  }

  // ── Concrete node interfaces & classes ────────────────────────────────────

  emit("// ─── Concrete Node Interfaces & Classes ──────────────────────────────────────");
  emit("");

  const visitorMethods: { visitName: string; className: string; slots: SlotDescriptor[] }[] = [];

  for (const [, info] of nodes) {
    if (info.hidden) continue;

    const cls = info.typeName;
    const iface = `I${cls}`;
    const slots = info.terminal ? [] : buildSlots(info, grammar, nodes);

    // ── Interface ────────────────────────────────────────────────────────

    emit(`export interface ${iface} extends ISyntaxNode {`);
    emit(`  readonly "@type": "${info.ruleName}";`);
    if (info.terminal) {
      emit(`  readonly text: string;`);
    }
    for (const slot of slots) {
      const baseIType = slot.iTypeName;
      const propName = slot.multiple ? slot.accessor + "s" : slot.accessor;
      if (slot.multiple) {
        const arrType = baseIType.includes(" | ") ? `(${baseIType})[]` : `${baseIType}[]`;
        emit(`  readonly ${propName}: ${arrType};`);
      } else if (slot.optional) {
        emit(`  readonly ${propName}: ${baseIType} | null;`);
      } else {
        emit(`  readonly ${propName}: ${baseIType};`);
      }
    }
    emit("}");
    emit("");

    // ── Class ────────────────────────────────────────────────────────────

    emit(`export class ${cls} extends SyntaxNode implements ${iface} {`);
    emit(`  readonly "@type" = "${info.ruleName}" as const;`);

    if (info.terminal) {
      // ── Terminal class ──────────────────────────────────────────────

      emit(`  readonly text: string;`);
      emit("");
      emit(`  constructor(`);
      emit(`    cstNode?: TSNode | null,`);
      emit(`    astNode?: ${iface} | null,`);
      emit(`  ) {`);
      emit(`    super(cstNode ? sourceRangeFrom(cstNode) : astNode?.sourceRange ?? null, astNode?.nodeId);`);
      emit(`    this.text = cstNode?.text ?? astNode?.text ?? "";`);
      emit(`  }`);
      emit("");
      emit(`  override get reconciliationKey(): string { return \`${info.ruleName}:\${this.text}\`; }`);
      emit("");
      emit(`  protected override computeContentHash(): number { return fnv1a(this["@type"] + ":" + this.text); }`);
      emit(`  protected override computeStructuralHash(): number { return fnv1a(this["@type"]); }`);
      emit("");
      emit(`  override toJSON(): ${iface} {`);
      emit(`    return {`);
      emit(`      "@type": this["@type"],`);
      emit(`      text: this.text,`);
      emit(`      sourceRange: this.sourceRange,`);
      emit(`      contentHash: this.contentHash,`);
      emit(`      structuralHash: this.structuralHash,`);
      emit(`    };`);
      emit(`  }`);

      // accept
      emit("");
      emit(`  accept<R, A>(visitor: ${visitorInterface}<R, A>, argument?: A): R {`);
      emit(`    return visitor.visit${cls}(this, argument);`);
      emit(`  }`);

      // static new
      emit("");
      emit(`  static new(`);
      emit(`    cstNode?: TSNode | null,`);
      emit(`    astNode?: ${iface} | null,`);
      emit(`  ): ${cls} | null {`);
      emit(`    const type = cstNode?.type ?? astNode?.["@type"];`);
      emit(`    if (type === "${info.ruleName}") return new ${cls}(cstNode, astNode);`);
      emit(`    return null;`);
      emit(`  }`);
    } else {
      // ── Composite class (Lazy + Incremental) ───────────────────────

      emit("");

      // Lazy field accessors as getters
      for (const slot of slots) {
        const isUnion = slot.typeName.includes(" | ");
        const rType = slot.multiple
          ? isUnion
            ? `(${slot.typeName})[]`
            : `${slot.typeName}[]`
          : slot.optional
            ? `${slot.typeName} | null`
            : slot.typeName;
        const suffix = slot.multiple ? "s" : "";
        const accName = slot.accessor + suffix;
        emit(
          `  /** ${slot.source === "field" ? "Field" : slot.source === "hidden" ? "Hidden rule" : "Child"}: \`${slot.slotKey}\` */`,
        );

        if (slot.multiple) {
          // For union types, wrap in parens so `(A | B)[]` instead of `A | B[]`
          const arrTypeName = isUnion ? `(${slot.typeName})` : slot.typeName;
          // ── Lazy array getter ─────────────────────────────────────
          if (slot.source === "field") {
            emit(`  get ${accName}(): ${rType} {`);
            emit(`    return this.lazyChildren<${slot.typeName}>("${slot.slotKey}", () => {`);
            emit(`      const cstChildren = this._cstNode?.childrenForFieldName("${slot.slotKey}") ?? [];`);
            emit(`      const oldChildren = this.alternate?.isMaterialized("${slot.slotKey}")`);
            emit(`        ? (this.alternate.getChildren("${slot.slotKey}") as ${arrTypeName}[])`);
            emit(`        : [];`);
            emit(`      if (oldChildren.length > 0) {`);
            emit(
              `        return reconcileArray(oldChildren, cstChildren, this, "${slot.slotKey}") as ${arrTypeName}[];`,
            );
            emit(`      }`);
            emit(`      return cstChildren.map(c => createNode(c)!).filter(Boolean) as ${arrTypeName}[];`);
            emit(`    });`);
            emit(`  }`);
          } else if (slot.source === "child") {
            const matchType = slot.cstMatchTypes[0];
            emit(`  get ${accName}(): ${rType} {`);
            emit(`    return this.lazyChildren<${slot.typeName}>("${slot.slotKey}", () => {`);
            emit(
              `      const cstChildren = (this._cstNode?.namedChildren ?? []).filter(c => c.type === "${matchType}");`,
            );
            emit(`      const oldChildren = this.alternate?.isMaterialized("${slot.slotKey}")`);
            emit(`        ? (this.alternate.getChildren("${slot.slotKey}") as ${arrTypeName}[])`);
            emit(`        : [];`);
            emit(`      if (oldChildren.length > 0) {`);
            emit(
              `        return reconcileArray(oldChildren, cstChildren, this, "${slot.slotKey}") as ${arrTypeName}[];`,
            );
            emit(`      }`);
            emit(`      return cstChildren.map(c => createNode(c)!).filter(Boolean) as ${arrTypeName}[];`);
            emit(`    });`);
            emit(`  }`);
          } else {
            // hidden
            const typeSetStr = `new Set([${slot.cstMatchTypes.map((t) => `"${t}"`).join(", ")}])`;
            emit(`  get ${accName}(): ${rType} {`);
            emit(`    return this.lazyChildren<${slot.typeName}>("${slot.slotKey}", () => {`);
            emit(`      const types = ${typeSetStr};`);
            emit(`      const cstChildren = (this._cstNode?.namedChildren ?? []).filter(c => types.has(c.type));`);
            emit(`      const oldChildren = this.alternate?.isMaterialized("${slot.slotKey}")`);
            emit(`        ? (this.alternate.getChildren("${slot.slotKey}") as ${arrTypeName}[])`);
            emit(`        : [];`);
            emit(`      if (oldChildren.length > 0) {`);
            emit(
              `        return reconcileArray(oldChildren, cstChildren, this, "${slot.slotKey}") as ${arrTypeName}[];`,
            );
            emit(`      }`);
            emit(`      return cstChildren.map(c => createNode(c)!).filter(Boolean) as ${arrTypeName}[];`);
            emit(`    });`);
            emit(`  }`);
          }
        } else {
          // ── Lazy single-child getter ──────────────────────────────
          if (slot.source === "field") {
            const bangSuffix = slot.optional ? "" : "!";
            emit(`  get ${accName}(): ${rType} {`);
            emit(`    return this.lazyChild<${slot.typeName}>("${slot.slotKey}", () => {`);
            emit(`      const c = this._cstNode?.childForFieldName("${slot.slotKey}") ?? null;`);
            emit(`      if (!c) return null;`);
            emit(`      const old = this.alternate?.isMaterialized("${slot.slotKey}")`);
            emit(`        ? (this.alternate.getChild("${slot.slotKey}") as ${slot.typeName} | null)`);
            emit(`        : null;`);
            emit(`      if (old && !c.hasChanges) { old.updateCST(c); return old; }`);
            emit(`      return createNode(c) as ${slot.typeName} | null;`);
            emit(`    })${bangSuffix};`);
            emit(`  }`);
          } else if (slot.source === "child") {
            const matchType = slot.cstMatchTypes[0];
            const bangSuffix2 = slot.optional ? "" : "!";
            emit(`  get ${accName}(): ${rType} {`);
            emit(`    return this.lazyChild<${slot.typeName}>("${slot.slotKey}", () => {`);
            emit(`      const c = (this._cstNode?.namedChildren ?? []).find(c => c.type === "${matchType}") ?? null;`);
            emit(`      if (!c) return null;`);
            emit(`      const old = this.alternate?.isMaterialized("${slot.slotKey}")`);
            emit(`        ? (this.alternate.getChild("${slot.slotKey}") as ${slot.typeName} | null)`);
            emit(`        : null;`);
            emit(`      if (old && !c.hasChanges) { old.updateCST(c); return old; }`);
            emit(`      return createNode(c) as ${slot.typeName} | null;`);
            emit(`    })${bangSuffix2};`);
            emit(`  }`);
          } else {
            // hidden
            const typeSetStr = `new Set([${slot.cstMatchTypes.map((t) => `"${t}"`).join(", ")}])`;
            const bangSuffix3 = slot.optional ? "" : "!";
            emit(`  get ${accName}(): ${rType} {`);
            emit(`    return this.lazyChild<${slot.typeName}>("${slot.slotKey}", () => {`);
            emit(`      const types = ${typeSetStr};`);
            emit(`      const c = (this._cstNode?.namedChildren ?? []).find(c => types.has(c.type)) ?? null;`);
            emit(`      if (!c) return null;`);
            emit(`      const old = this.alternate?.isMaterialized("${slot.slotKey}")`);
            emit(`        ? (this.alternate.getChild("${slot.slotKey}") as ${slot.typeName} | null)`);
            emit(`        : null;`);
            emit(`      if (old && !c.hasChanges) { old.updateCST(c); return old; }`);
            emit(`      return createNode(c) as ${slot.typeName} | null;`);
            emit(`    })${bangSuffix3};`);
            emit(`  }`);
          }
        }
        emit("");
      }

      // Lazy dual-source constructor
      emit(`  constructor(`);
      emit(`    cstNode?: TSNode | null,`);
      emit(`    astNode?: ${iface} | null,`);
      emit(`  ) {`);
      emit(`    super(`);
      emit(`      cstNode ? sourceRangeFrom(cstNode) : astNode?.sourceRange ?? null,`);
      emit(`      astNode?.nodeId,`);
      emit(`      cstNode,`);
      emit(`    );`);

      // Register slot names for reconciliation tracking
      if (slots.length > 0) {
        for (const slot of slots) {
          emit(`    this._slotNames.add("${slot.slotKey}");`);
        }
      }

      // JSON path: eagerly populate (data is already materialized)
      emit(`    if (astNode) {`);
      for (const slot of slots) {
        const accSuffix = slot.multiple ? "s" : "";
        const jsonAcc = slot.accessor + accSuffix;
        if (slot.multiple) {
          emit(
            `      this.setChildren("${slot.slotKey}", (astNode.${jsonAcc} ?? []).map(a => createNodeFromJSON(a)!).filter(Boolean));`,
          );
        } else {
          emit(
            `      this.setChild("${slot.slotKey}", astNode.${jsonAcc} ? createNodeFromJSON(astNode.${jsonAcc} as any) : null);`,
          );
        }
      }
      emit(`    }`);
      emit(`    // CST path: children are NOT constructed here — lazy getters handle it`);

      emit(`  }`);

      // Reconciliation key
      const nameField = info.fields.find((f) => f.name === "name");
      if (nameField) {
        emit("");
        emit(`  override get reconciliationKey(): string {`);
        emit(`    const n = this.getChild("name");`);
        emit(`    return n ? \`${info.ruleName}:\${(n as any).text ?? ""}\` : this["@type"];`);
        emit(`  }`);
      }

      // toJSON override (forces materialization of all slots)
      emit("");
      emit(`  override toJSON(): ${iface} {`);
      emit(`    return {`);
      emit(`      "@type": this["@type"],`);
      emit(`      sourceRange: this.sourceRange,`);
      emit(`      contentHash: this.contentHash,`);
      emit(`      structuralHash: this.structuralHash,`);
      for (const slot of slots) {
        const accSuffix = slot.multiple ? "s" : "";
        const accName = slot.accessor + accSuffix;
        if (slot.multiple) {
          emit(`      ${accName}: this.${accName}.map(c => c.toJSON()) as any,`);
        } else {
          emit(`      ${accName}: this.${accName}?.toJSON() as any ?? null,`);
        }
      }
      emit(`    };`);
      emit(`  }`);

      // accept
      emit("");
      emit(`  accept<R, A>(visitor: ${visitorInterface}<R, A>, argument?: A): R {`);
      emit(`    return visitor.visit${cls}(this, argument);`);
      emit(`  }`);

      // static new
      emit("");
      emit(`  static new(`);
      emit(`    cstNode?: TSNode | null,`);
      emit(`    astNode?: ${iface} | null,`);
      emit(`  ): ${cls} | null {`);
      emit(`    const type = cstNode?.type ?? astNode?.["@type"];`);
      emit(`    if (type === "${info.ruleName}") return new ${cls}(cstNode, astNode);`);
      emit(`    return null;`);
      emit(`  }`);
    }

    emit("}");
    emit("");

    visitorMethods.push({ visitName: `visit${cls}`, className: cls, slots });
  }

  // ── Factories ─────────────────────────────────────────────────────────────

  emit("// ─── Node Factories ─────────────────────────────────────────────────────────");
  emit("");
  emit("const NODE_FACTORIES: Record<string, (cstNode: TSNode) => SyntaxNode> = {");
  for (const [ruleName, info] of nodes) {
    if (info.hidden) continue;
    emit(`  "${ruleName}": (c) => new ${info.typeName}(c),`);
  }
  emit("};");
  emit("");

  emit("const JSON_FACTORIES: Record<string, (a: ISyntaxNode) => SyntaxNode> = {");
  for (const [ruleName, info] of nodes) {
    if (info.hidden) continue;
    emit(`  "${ruleName}": (a) => new ${info.typeName}(null, a as I${info.typeName}),`);
  }
  emit("};");
  emit("");

  emit("/**");
  emit(" * Create an AST node from a tree-sitter CST node.");
  emit(" * Returns null for unrecognized node types.");
  emit(" */");
  emit("export function createNode(cstNode: TSNode): SyntaxNode | null {");
  emit("  const factory = NODE_FACTORIES[cstNode.type];");
  emit("  return factory ? factory(cstNode) : null;");
  emit("}");
  emit("");
  emit("/**");
  emit(" * Create an AST node from a serialized JSON object (ISyntaxNode).");
  emit(" * Returns null for unrecognized `@type` values.");
  emit(" */");
  emit("export function createNodeFromJSON(astNode: ISyntaxNode): SyntaxNode | null {");
  emit('  const factory = JSON_FACTORIES[astNode["@type"]];');
  emit("  return factory ? factory(astNode) : null;");
  emit("}");
  emit("");
  emit("/**");
  emit(" * Build a complete AST from a tree-sitter parse tree root.");
  emit(" */");
  emit(`export function buildAST(rootCST: TSNode): ${rootTypeName} | null {`);
  emit(`  if (rootCST.type !== "${rootRuleName}") return null;`);
  emit(`  return new ${rootTypeName}(rootCST);`);
  emit("}");
  emit("");
  emit("/**");
  emit(" * Build a complete AST from a serialized JSON root.");
  emit(" */");
  emit(`export function buildASTFromJSON(json: ${rootITypeName}): ${rootTypeName} | null {`);
  emit(`  if (json["@type"] !== "${rootRuleName}") return null;`);
  emit(`  return new ${rootTypeName}(null, json);`);
  emit("}");
  emit("");
  emit("/**");
  emit(" * Incrementally reconcile an existing AST with a new CST.");
  emit(" * Main entry point for the Hybrid Fiber Architecture.");
  emit(" * Returns the reconciled AST and a list of change events.");
  emit(" */");
  emit(`export function reconcileAST(oldAST: ${rootTypeName}, newCST: TSNode): ReconcileResult {`);
  emit(`  if (newCST.type !== "${rootRuleName}") {`);
  emit(`    throw new Error(\`Expected ${rootRuleName} CST root, got: \${newCST.type}\`);`);
  emit("  }");
  emit("  const collector = new ChangeCollector();");
  emit("  if (!newCST.hasChanges) {");
  emit("    oldAST.updateSourceRange(newCST);");
  emit("    return { ast: oldAST, events: collector.events };");
  emit("  }");
  emit("  oldAST.markDirty();");
  emit("  oldAST.reconcileChildren(newCST, collector);");
  emit("  return { ast: oldAST, events: collector.events };");
  emit("}");
  emit("");

  // ── Visitor interface ───────────────────────────────────────────────────

  emit("// ─── Visitor Pattern ────────────────────────────────────────────────────────");
  emit("");
  emit(`export interface ${visitorInterface}<R, A> {`);
  for (const { visitName, className } of visitorMethods) {
    emit(`  ${visitName}(node: ${className}, argument?: A): R;`);
  }
  emit("}");
  emit("");

  // ── Default visitor ────────────────────────────────────────────────────

  emit("/**");
  emit(" * Default visitor that walks all children in source order.");
  emit(" * Override individual visit methods to customize behavior.");
  emit(" * Returns null by default for each node.");
  emit(" */");
  emit(`export abstract class ${visitorClass}<R, A> implements ${visitorInterface}<R | null, A> {`);

  for (const { visitName, className, slots } of visitorMethods) {
    emit(`  ${visitName}(node: ${className}, argument?: A): R | null {`);
    // Visit each child in order
    for (const slot of slots) {
      const accSuffix = slot.multiple ? "s" : "";
      const accName = slot.accessor + accSuffix;
      if (slot.multiple) {
        emit(`    for (const child of node.${accName}) child.accept(this, argument);`);
      } else {
        emit(`    node.${accName}?.accept(this, argument);`);
      }
    }
    emit(`    return null;`);
    emit(`  }`);
    emit("");
  }

  emit("}");
  emit("");

  return L.join("\n");
}

// ─── Build-time hashing ──────────────────────────────────────────────────────

function fnv1aString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  console.log(`Reading grammar: ${GRAMMAR_PATH}`);
  const grammarText = fs.readFileSync(GRAMMAR_PATH, "utf-8");
  const grammarHash = fnv1aString(grammarText);

  // Incremental: skip regeneration if grammar hasn't changed
  if (fs.existsSync(OUTPUT_PATH)) {
    const existing = fs.readFileSync(OUTPUT_PATH, "utf-8");
    const hashLine = existing.match(/^\/\/ grammar-hash: ([a-f0-9]+)$/m);
    if (hashLine && hashLine[1] === grammarHash) {
      console.log(`Grammar unchanged (hash: ${grammarHash}), skipping generation.`);
      return;
    }
  }

  const grammar: GrammarJSON = JSON.parse(grammarText);

  console.log(`Analyzing ${Object.keys(grammar.rules).length} rules...`);
  const nodes = analyzeGrammar(grammar);

  const hiddenCount = [...nodes.values()].filter((n) => n.hidden).length;
  const concreteCount = [...nodes.values()].filter((n) => !n.hidden).length;
  const terminalCount = [...nodes.values()].filter((n) => !n.hidden && n.terminal).length;

  console.log(`  ${concreteCount} concrete nodes (${terminalCount} terminals)`);
  console.log(`  ${hiddenCount} hidden rules → union types`);

  const code = `// grammar-hash: ${grammarHash}\n` + generateCode(grammar, nodes);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, code, "utf-8");
  console.log(`Written: ${OUTPUT_PATH} (${code.length} bytes)`);
}

main();

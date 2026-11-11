// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context } from "@modelscript/modelica/context";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import v8 from "node:v8";

import type { ClassMetadata, ComponentMetadata } from "../database.js";
import { NodeFileSystem } from "./filesystem.js";

/** Initialize the WASM GLR parser once. */
let parserPromise: Promise<void> | null = null;
async function ensureParser(): Promise<void> {
  if (parserPromise) return parserPromise;
  parserPromise = (async () => {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const modelicaWasmPath = require.resolve("@modelscript/modelica/dist/parser.wasm");
    const { createWasmParser } = await import("@modelscript/modelica/parser");
    const { parser } = await createWasmParser(modelicaWasmPath);

    Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
  })();
  return parserPromise;
}

export interface SvgResult {
  icon: string | null;
  diagram: string | null;
}

export interface ClassRenderResult {
  metadata: ClassMetadata;
  iconSvg: string | null;
  diagramSvg: string | null;
}

export interface DependencyLibrarySpec {
  name: string;
  version: string;
  extractedPath?: string | undefined;
  bundleIndexJson?:
    | {
        symbols: [number, unknown][];
        byName: [string, number[]][];
        childrenOf: [number | null, number[]][];
      }
    | undefined;
  iconHashes?: Map<string, string> | undefined;
}

export interface PreviousVersionCache {
  version: string;
  classes: Map<string, ClassMetadata & { iconHash: string | null; diagramHash: string | null }>;
  readSvg: (className: string, type: "icon" | "diagram") => string | null;
}

export interface ProcessLibraryOptions {
  dependencies?: DependencyLibrarySpec[] | undefined;
  previousVersion?: PreviousVersionCache | undefined;
  skipSvg?: boolean | undefined;
}

interface CstNodeLike {
  type?: string | undefined;
  text?: string | undefined;
  children?: CstNodeLike[] | undefined;
  parent?: CstNodeLike | undefined;
}

interface ModificationArgLike {
  name?: string | undefined;
  expression?: { toJSON?: unknown } | undefined;
  value?: { text?: string | undefined } | string | number | boolean | undefined;
}

interface ModificationLike extends CstNodeLike {
  modificationArguments?: ModificationArgLike[] | undefined;
  bindingExpression?: { text?: string | undefined; value?: unknown } | undefined;
  args?: { name?: string | undefined; value?: { text?: string | undefined } | unknown }[] | undefined;
}

interface ComponentInputLike {
  name?: string | undefined;
  classInstance?: { compositeName?: string | undefined } | null | undefined;
  declaredType?: { compositeName?: string | undefined } | null | undefined;
  description?: string | null | undefined;
  cstNode?: CstNodeLike | null | undefined;
  abstractSyntaxNode?:
    | (CstNodeLike & {
        parent?:
          | (CstNodeLike & {
              causality?: { toString(): string } | null | undefined;
              variability?: { toString(): string } | null | undefined;
            })
          | undefined;
      })
    | null
    | undefined;
  causality?: { toString(): string } | null | undefined;
  variability?: { toString(): string } | null | undefined;
  declaration?:
    | {
        metadata?:
          | {
              causality?: { toString(): string } | null | undefined;
              variability?: { toString(): string } | null | undefined;
            }
          | undefined;
      }
    | undefined;
  modification?: ModificationLike | null | undefined;
}

interface ClassAdapterComponent {
  id: number;
  name?: string | undefined;
  entry: unknown;
  cstNode: CstNodeLike | null;
  abstractSyntaxNode: CstNodeLike | null;
  classInstance: ClassAdapter | null;
  classKind: string;
  modification: {
    expression: { text: string } | undefined;
    getModificationArgument: (argName: string) => { expression: { text: string } | undefined } | undefined;
  };
  parent?: ClassAdapter | undefined;
  annotation?: ((name: string) => unknown) | undefined;
}

interface ClassAdapterConnectEq {
  lhs: string;
  rhs: string;
  cstNode: CstNodeLike | null;
  annotation?: ((name: string) => unknown) | undefined;
}

interface ClassAdapter {
  id: number;
  db: unknown;
  context: Context;
  cstNode: CstNodeLike | null;
  abstractSyntaxNode: CstNodeLike | null;
  isClassInstance: boolean;
  name: string;
  classKind: string;
  entry: unknown;
  components: ClassAdapterComponent[];
  connectEquations: ClassAdapterConnectEq[];
  extendsClassInstances: { classInstance: ClassAdapter }[];
  resolveName?: ((parts: string[]) => ClassAdapterComponent | null) | undefined;
  annotation?:
    | ((name: string, ctx?: { classInstance?: unknown; modification?: unknown; cstNode?: unknown }) => unknown)
    | undefined;
}

type AnnotationEvaluatorConstructor = new (ctx?: unknown) => {
  evaluate(node: unknown, name: string): ({ info?: string | undefined } & Record<string, unknown>) | null;
};

function cleanModelicaDescription(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/\s*\bannotation\s*\([\s\S]*$/i, "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Extract modifier name/value pairs from a modification or CST node.
 */

function extractModifiers(
  modification: ModificationLike | null | undefined,
  cstNode?: CstNodeLike | null | undefined,
): { name: string; value: string | null }[] {
  const result: { name: string; value: string | null }[] = [];
  if (!modification && !cstNode) return result;

  if (Array.isArray(modification?.modificationArguments)) {
    for (const arg of modification.modificationArguments) {
      const name = arg.name;
      if (name) {
        let value: string | null = null;
        try {
          const expr = arg.expression;
          if (expr) {
            const json = expr.toJSON;
            value = typeof json === "string" ? json : JSON.stringify(json);
          }
        } catch {
          // Skip modifiers that fail to evaluate
        }
        result.push({ name, value });
      }
    }
    return result;
  }

  // Real CST traversal fallback
  const targetNode = cstNode ?? modification;
  if (!targetNode) return result;

  const walk = (node: CstNodeLike | null | undefined, depth = 0) => {
    if (!node) return;
    if (
      node.type === "annotation_clause" ||
      node.type === "AnnotationClause" ||
      node.type === "description" ||
      node.type === "comment" ||
      node.type === "description_string"
    ) {
      return;
    }
    if (node.type === "element_modification" || node.type === "ElementModification") {
      const nameNode = node.children?.find(
        (c: CstNodeLike) =>
          c.type === "name" || c.type === "Name" || c.type === "identifier" || c.type === "Identifier",
      );
      const valNode = node.children?.find((c: CstNodeLike) => c.type === "modification" || c.type === "Modification");
      if (nameNode?.text) {
        result.push({
          name: nameNode.text.trim(),
          value: valNode?.text?.replace(/^:?=\s*/, "").trim() ?? null,
        });
      }
      return;
    }
    // Direct `= expr` or `(start=1) = expr` binding on the component declaration's top-level modification
    if ((node.type === "modification" || node.type === "Modification") && depth <= 3) {
      const directExpr = node.children?.find(
        (c: CstNodeLike) =>
          c.type !== "class_modification" &&
          c.type !== "ClassModification" &&
          c.type !== "=" &&
          c.type !== ":=" &&
          c.text &&
          c.text.trim() !== "=" &&
          c.text.trim() !== ":=",
      );
      if (directExpr?.text) {
        result.push({
          name: "value",
          value: directExpr.text.trim(),
        });
      } else if (typeof node.text === "string" && /^:?=\s*/.test(node.text.trim())) {
        result.push({
          name: "value",
          value: node.text
            .trim()
            .replace(/^:?=\s*/, "")
            .trim(),
        });
      }
    }
    for (const child of node.children || []) {
      walk(child, depth + 1);
    }
  };
  walk(targetNode, 0);

  return result;
}

/**
 * Extract metadata for a single component instance.
 */

export function _extractComponentMetadata(component: ComponentInputLike): ComponentMetadata | null {
  const name = component.name;
  if (!name) return null;

  const typeName = component.classInstance?.compositeName ?? component.declaredType?.compositeName ?? "unknown";
  const description = cleanModelicaDescription(component.description ?? null);
  const cst = component.cstNode ?? component.abstractSyntaxNode;

  // Get causality and variability from component properties, symbol metadata, or AST/CST node
  let causality =
    component.causality?.toString() ??
    component.declaration?.metadata?.causality?.toString() ??
    (
      component.abstractSyntaxNode?.parent as { causality?: { toString(): string } | null | undefined } | undefined
    )?.causality?.toString() ??
    null;
  if (!causality && cst) {
    let p = cst.parent;
    while (p && !causality) {
      if (p.type === "component_clause" || p.type === "ComponentClause") {
        const tp = p.children?.find((c: CstNodeLike) => c.type === "type_prefix" || c.type === "TypePrefix");
        if (tp?.text?.includes("input")) causality = "input";
        else if (tp?.text?.includes("output")) causality = "output";
        break;
      }
      p = p.parent;
    }
  }

  let variability =
    component.variability?.toString() ??
    component.declaration?.metadata?.variability?.toString() ??
    (
      component.abstractSyntaxNode?.parent as { variability?: { toString(): string } | null | undefined } | undefined
    )?.variability?.toString() ??
    null;
  if (!variability && cst) {
    let p = cst.parent;
    while (p && !variability) {
      if (p.type === "component_clause" || p.type === "ComponentClause") {
        const tp = p.children?.find((c: CstNodeLike) => c.type === "type_prefix" || c.type === "TypePrefix");
        if (tp?.text?.includes("parameter")) variability = "parameter";
        else if (tp?.text?.includes("constant")) variability = "constant";
        else if (tp?.text?.includes("discrete")) variability = "discrete";
        break;
      }
      p = p.parent;
    }
  }

  const modifiers = extractModifiers(component.modification, cst);

  return { name, typeName, description, causality, variability, modifiers };
}

const CLASS_KIND_KEYWORDS = [
  "class",
  "model",
  "record",
  "block",
  "connector",
  "type",
  "package",
  "function",
  "operator",
  "optimization",
];

function classKindFromEntry(entry: { metadata?: Record<string, unknown> | undefined } | null | undefined): string {
  const prefixesText = entry?.metadata?.["classPrefixes"] ?? entry?.metadata?.["classKind"];
  if (typeof prefixesText !== "string" || !prefixesText) return "class";
  const lower = prefixesText.toLowerCase();
  for (let i = CLASS_KIND_KEYWORDS.length - 1; i >= 0; i--) {
    const kw = CLASS_KIND_KEYWORDS[i];
    if (kw && lower.includes(kw)) return kw;
  }
  return "class";
}

function resolveSymbolId(context: Context, name: string): number | null {
  const byName = context.queryEngine.index.byName.get(name);
  if (byName && byName.length > 0 && typeof byName[0] === "number") return byName[0];
  const parts = name.split(".");
  const first = parts[0];
  if (!first) return null;
  let curr: number | undefined = context.queryEngine.index.byName.get(first)?.[0];
  if (typeof curr !== "number") return null;
  const db = context.queryEngine.toQueryDB();
  for (let i = 1; i < parts.length; i++) {
    if (typeof curr !== "number") return null;
    const children: { id?: number | undefined; name?: string | undefined }[] =
      (db.childrenOf(curr) as { id?: number | undefined; name?: string | undefined }[] | undefined) || [];
    const match: { id?: number | undefined; name?: string | undefined } | undefined = children.find(
      (c: { id?: number | undefined; name?: string | undefined }) => c.name === parts[i],
    );
    if (!match || typeof match.id !== "number") return null;
    curr = match.id;
  }
  return typeof curr === "number" ? curr : null;
}

function getSymbolFqn(context: Context, symbolId: number): string {
  const db = context.queryEngine.toQueryDB();
  const parts: string[] = [];
  let currId: number | null | undefined = symbolId;
  const seen = new Set<number>();
  while (typeof currId === "number" && currId > 0 && !seen.has(currId)) {
    seen.add(currId);
    const sym = db.symbol(currId);
    if (!sym) break;
    if (sym.name) parts.unshift(sym.name);
    if (sym.parentId === currId || sym.parentId === null || sym.parentId === undefined) break;
    currId = sym.parentId;
  }
  return parts.join(".");
}

function getOwnSourceExcludingNestedClasses(context: Context, symbolId: number): string {
  const db = context.queryEngine.toQueryDB();
  const sym = db.symbol(symbolId);
  if (!sym) return "";
  const fullText =
    typeof sym.startOffset === "number" && typeof sym.endOffset === "number" && sym.endOffset > sym.startOffset
      ? db.cstText(sym.startOffset, sym.endOffset, sym)
      : ((db.cstNode(symbolId) as CstNodeLike | null)?.text ?? "");
  if (!fullText) return `${sym.name}:${classKindFromEntry(sym)}:${String(sym.metadata?.["description"] ?? "")}`;

  const children = db.childrenOf(symbolId) || [];
  const baseStart = sym.startOffset ?? 0;
  const baseEnd = sym.endOffset ?? baseStart + fullText.length;

  const nestedClassSpans = children
    .filter(
      (c) =>
        c.kind === "Class" &&
        c.resourceId === sym.resourceId &&
        typeof c.startOffset === "number" &&
        typeof c.endOffset === "number" &&
        c.startOffset >= baseStart &&
        c.endOffset <= baseEnd &&
        c.endOffset > c.startOffset,
    )
    .sort((a, b) => (a.startOffset ?? 0) - (b.startOffset ?? 0));

  if (nestedClassSpans.length === 0) {
    return fullText;
  }

  let out = "";
  let cursor = 0;
  for (const ch of nestedClassSpans) {
    const relStart = Math.max(cursor, (ch.startOffset ?? baseStart) - baseStart);
    const relEnd = Math.min(fullText.length, (ch.endOffset ?? baseStart) - baseStart);
    if (relStart > cursor) {
      out += fullText.slice(cursor, relStart);
    }
    out += `<class:${ch.name}>`;
    cursor = Math.max(cursor, relEnd);
  }
  if (cursor < fullText.length) {
    out += fullText.slice(cursor);
  }
  return out;
}

interface ParsedImportClause {
  raw: string;
  alias?: string | undefined;
  target: string;
  wildcard: boolean;
}

function extractScopeImports(ownSource: string): ParsedImportClause[] {
  const imports: ParsedImportClause[] = [];
  const importRegex =
    /\bimport\s+(?:([A-Za-z_]\w*)\s*=\s*)?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)(\.\*)?\s*(?:["'][^"']*["']\s*)?;/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(ownSource)) !== null) {
    const alias = match[1];
    const target = match[2] ?? "";
    const wildcard = Boolean(match[3]);
    if (target) {
      imports.push({
        raw: match[0].trim(),
        alias: alias ?? (wildcard ? undefined : target.split(".").pop()),
        target,
        wildcard,
      });
    }
  }
  return imports;
}

function resolveSymbolIdInScope(
  context: Context,
  scopeSymbolId: number,
  rawName: string,
  ownSourceCache?: Map<number, string>,
): number | null {
  const name = rawName.replace(/^\./, "").trim();
  if (!name) return null;
  const isGlobalRooted = rawName.trim().startsWith(".");
  if (isGlobalRooted) {
    return resolveSymbolId(context, name);
  }

  const db = context.queryEngine.toQueryDB();
  const scopeIds: number[] = [];
  const scopeNames: string[] = [];
  let currId: number | null | undefined = scopeSymbolId;
  const seen = new Set<number>();
  while (typeof currId === "number" && currId > 0 && !seen.has(currId)) {
    seen.add(currId);
    const s = db.symbol(currId);
    if (!s) break;
    scopeIds.push(currId);
    if (s.name) scopeNames.unshift(s.name);
    if (s.parentId === currId || s.parentId === null || s.parentId === undefined) break;
    currId = s.parentId;
  }

  const parts = name.split(".");
  const firstPart = parts[0]!;
  const restSuffix = parts.length > 1 ? "." + parts.slice(1).join(".") : "";

  // 1. Check imports and lexical scopes from innermost scope to outermost package
  for (let i = 0; i < scopeIds.length; i++) {
    const sId = scopeIds[i]!;
    let ownSrc = ownSourceCache?.get(sId);
    if (ownSrc === undefined) {
      ownSrc = getOwnSourceExcludingNestedClasses(context, sId);
      ownSourceCache?.set(sId, ownSrc);
    }
    const imports = extractScopeImports(ownSrc);
    for (const imp of imports) {
      if (!imp.wildcard && imp.alias === firstPart) {
        const mappedId = resolveSymbolId(context, `${imp.target}${restSuffix}`);
        if (mappedId !== null) return mappedId;
      } else if (imp.wildcard) {
        const mappedId = resolveSymbolId(context, `${imp.target}.${name}`);
        if (mappedId !== null) return mappedId;
      }
    }

    const prefixLen = scopeNames.length - i;
    if (prefixLen >= 1) {
      const prefix = scopeNames.slice(0, prefixLen).join(".");
      const scopedId = resolveSymbolId(context, `${prefix}.${name}`);
      if (scopedId !== null) return scopedId;
    }
  }

  // 2. Fallback to global root resolution
  return resolveSymbolId(context, name);
}

export function buildClassAdapter(
  context: Context,
  symbolId: number,
  AnnotationEvaluatorClass: AnnotationEvaluatorConstructor,
  depth = 0,
  adapterCache = new Map<number, ClassAdapter | null>(),
  visited = new Set<number>(),
  extendsDepth = 0,
): ClassAdapter | null {
  if (visited.has(symbolId)) return null;
  const cacheKey = depth === 0 ? symbolId : -symbolId;
  const cached = adapterCache.get(cacheKey);
  if (cached !== undefined) return cached;

  visited.add(symbolId);

  const queryDB = context.queryEngine.toQueryDB();
  const entry = queryDB.symbol(symbolId);
  if (!entry) {
    adapterCache.set(cacheKey, null);
    return null;
  }
  const cstNode = queryDB.cstNode(symbolId) as CstNodeLike | null;
  const children = queryDB.childrenOf(symbolId) || [];
  const components: ClassAdapterComponent[] = [];
  const connectEquations: ClassAdapterConnectEq[] = [];
  const extendsClassInstances: { classInstance: ClassAdapter }[] = [];

  for (const child of children) {
    if (child.kind === "Component" || child.kind === "Variable") {
      const isConnector = child.metadata?.["causality"] === "connector" || classKindFromEntry(child) === "connector";

      // Depth-bounding: components of components (depth >= 1) are only needed if they are
      // interface connectors (pins/ports). Internal subcomponents of subcomponents are never
      // rendered on a parent diagram.
      if (depth >= 1 && !isConnector) continue;

      let childClassId = queryDB.query("classInstance", child.id) as number | undefined;
      if (typeof childClassId !== "number") {
        const compTypeName = (child.metadata?.["typeSpecifier"] as string | undefined) || "";
        if (compTypeName) {
          childClassId = resolveSymbolIdInScope(context, symbolId, compTypeName) ?? undefined;
        }
      }
      const compCls =
        typeof childClassId === "number" && depth < 2
          ? buildClassAdapter(
              context,
              childClassId,
              AnnotationEvaluatorClass,
              depth + 1,
              adapterCache,
              new Set(visited),
              0,
            )
          : null;
      const childMod = queryDB.query("effectiveModification", child.id) as ModificationLike | undefined;
      let exprText = childMod?.bindingExpression?.text ?? childMod?.bindingExpression?.value;
      if (exprText === undefined && childMod?.args) {
        const startArg = childMod.args.find((a) => a.name === "start");
        if (startArg) {
          const rawVal = startArg.value;
          exprText =
            typeof rawVal === "object" && rawVal !== null && "text" in rawVal
              ? (rawVal as { text?: string | undefined }).text
              : rawVal;
        }
      }
      const isPrimitiveExprText =
        typeof exprText === "string" || typeof exprText === "number" || typeof exprText === "boolean";
      components.push({
        id: child.id,
        name: child.name,
        entry: child,
        cstNode: null,
        abstractSyntaxNode: null,
        classInstance: compCls,
        classKind: compCls?.classKind ?? classKindFromEntry(child),
        modification: {
          expression: isPrimitiveExprText ? { text: String(exprText) } : undefined,
          getModificationArgument: (argName: string) => {
            const foundArg = childMod?.args?.find((a) => a.name === argName);
            if (foundArg) {
              const rawVal = foundArg.value;
              const valText =
                typeof rawVal === "object" && rawVal !== null && "text" in rawVal
                  ? (rawVal as { text?: string | undefined }).text
                  : rawVal;
              if (typeof valText === "string" || typeof valText === "number" || typeof valText === "boolean") {
                return { expression: { text: String(valText) } };
              }
            }
            return undefined;
          },
        },
      });
    } else if ((child.kind === "ConnectEquation" || child.ruleName?.includes("connect")) && depth === 0) {
      let lhs = child.metadata?.["lhs"] ? String(child.metadata["lhs"]) : "";
      let rhs = child.metadata?.["rhs"] ? String(child.metadata["rhs"]) : "";
      if (!lhs || !rhs) {
        const connText =
          typeof child.startOffset === "number" &&
          typeof child.endOffset === "number" &&
          child.endOffset > child.startOffset
            ? (queryDB.cstText(child.startOffset, child.endOffset, child) ?? "")
            : "";
        const m = connText.match(
          /\bconnect\s*\(\s*((?:[a-zA-Z0-9_]+|'[^']+')(?:\[[^\]]*\])?(?:\.(?:[a-zA-Z0-9_]+|'[^']+')(?:\[[^\]]*\])?)*)\s*,\s*((?:[a-zA-Z0-9_]+|'[^']+')(?:\[[^\]]*\])?(?:\.(?:[a-zA-Z0-9_]+|'[^']+')(?:\[[^\]]*\])?)*)\s*\)/,
        );
        if (m) {
          if (!lhs && m[1]) lhs = m[1].trim();
          if (!rhs && m[2]) rhs = m[2].trim();
        }
      }
      const connCst = queryDB.cstNode(child.id) as CstNodeLike | null;
      if ((!lhs || !rhs) && connCst) {
        const cRefs = (connCst.children || []).filter(
          (c: CstNodeLike) => c.type === "component_reference" || c.type === "ComponentReference",
        );
        if (!lhs && cRefs.length > 0) lhs = cRefs[0]?.text?.trim() ?? "";
        if (!rhs && cRefs.length > 1) rhs = cRefs[1]?.text?.trim() ?? "";
      }
      connectEquations.push({
        lhs,
        rhs,
        cstNode: connCst,
      });
    } else if (child.kind === "Extends" || child.ruleName?.includes("extends")) {
      let baseSym = queryDB.query("resolvedBaseClass", child.id) as { id?: number | undefined } | null | undefined;
      const baseName = (child.metadata?.["typeSpecifier"] as string | undefined) || child.name;
      if (!baseSym && baseName) {
        const baseId = resolveSymbolIdInScope(context, symbolId, baseName);
        if (baseId) baseSym = queryDB.symbol(baseId);
      }
      if (baseSym && typeof baseSym.id === "number" && !visited.has(baseSym.id) && extendsDepth < 10) {
        const baseAdapter = buildClassAdapter(
          context,
          baseSym.id,
          AnnotationEvaluatorClass,
          depth,
          adapterCache,
          new Set(visited),
          extendsDepth + 1,
        );
        if (baseAdapter) {
          extendsClassInstances.push({ classInstance: baseAdapter });
        }
      }
    }
  }

  const adapter: ClassAdapter = {
    id: symbolId,
    db: queryDB,
    context,
    cstNode,
    abstractSyntaxNode: cstNode,
    isClassInstance: true,
    name: entry.name,
    classKind: classKindFromEntry(entry),
    entry,
    components,
    connectEquations,
    extendsClassInstances,
  };

  adapter.resolveName = (parts: string[]): ClassAdapterComponent | null => {
    if (!parts || parts.length === 0) return null;
    const [first, ...rest] = parts;
    if (!first) return null;
    let found = components.find((c) => c.name === first);
    if (!found) {
      for (const ext of extendsClassInstances) {
        found = ext.classInstance?.resolveName?.([first]) ?? undefined;
        if (found) break;
      }
    }
    if (!found) return null;
    if (rest.length === 0) return found;
    return found.classInstance?.resolveName?.(rest) ?? null;
  };

  const evaluator = new AnnotationEvaluatorClass(adapter);
  for (const comp of components) {
    comp.parent = adapter;
    const childCst = comp.cstNode ?? queryDB.cstNode(comp.id);
    comp.annotation = (name: string) => (childCst ? evaluator.evaluate(childCst, name) : null);
  }
  for (const connEq of connectEquations) {
    connEq.annotation = (name: string) => (connEq.cstNode ? evaluator.evaluate(connEq.cstNode, name) : null);
  }

  adapter.annotation = (
    name: string,
    _ctx?: { classInstance?: unknown; modification?: unknown; cstNode?: unknown },
  ) => {
    if (!cstNode) return null;
    if (_ctx && (_ctx.classInstance || _ctx.modification || _ctx.cstNode)) {
      return new AnnotationEvaluatorClass({ componentInstance: _ctx, classInstance: adapter }).evaluate(cstNode, name);
    }
    return evaluator.evaluate(cstNode, name);
  };

  adapterCache.set(cacheKey, adapter);
  return adapter;
}

/**
 * Check if an SVG string contains any meaningful visual elements.
 * Returns false for SVGs that only have empty groups/wrappers.
 */
function hasVisualContent(svg: string): boolean {
  const visualElements = /<(line|rect|circle|path|polygon|polyline|ellipse|text|image)\b/i;
  return visualElements.test(svg);
}

/**
 * Render SVGs and extract metadata for all classes in an extracted library directory.
 * Supports hydrating cross-library dependencies and sound Merkle-hash incremental reuse
 * from a previous version of the library.
 */
export async function processLibrary(
  libraryPath: string,
  processedClassNames: Set<string>,
  onClass: (className: string, metadata: ClassMetadata, svgs: SvgResult) => Promise<void>,
  onReady?: (context: Context) => Promise<void>,
  options?: ProcessLibraryOptions,
): Promise<Context> {
  await ensureParser();

  const { renderIconSvgString, renderDiagramSvgString, AnnotationEvaluator } =
    await import("@modelscript/modelica/diagram");

  const context = new Context(new NodeFileSystem(), undefined, 50_000);

  // 1. Hydrate cross-library dependencies before indexing the target library
  const externalIconHashes = new Map<string, string>();
  if (options?.dependencies && options.dependencies.length > 0) {
    for (const dep of options.dependencies) {
      if (dep.iconHashes) {
        for (const [clsName, hash] of dep.iconHashes.entries()) {
          externalIconHashes.set(clsName, `${dep.name}:${hash}`);
        }
      }
      if (dep.bundleIndexJson) {
        const depPrefix = dep.extractedPath ? dep.extractedPath.replace(/\\/g, "/").replace(/\/?$/, "/") : "";
        context.workspaceIndex.hydrate(
          `dep-bundle:/${dep.name}@${dep.version}`,
          {
            symbols: new Map(dep.bundleIndexJson.symbols as [number, unknown][]),
            byName: new Map(dep.bundleIndexJson.byName),
            childrenOf: new Map(dep.bundleIndexJson.childrenOf),
          },
          undefined,
          (origPath: string) => {
            const rel = origPath.startsWith("sources/") ? origPath.substring("sources/".length) : origPath;
            return depPrefix ? `${depPrefix}${rel}` : `dep-bundle:/${dep.name}@${dep.version}/${rel}`;
          },
        );
        console.log(`[publish] Hydrated dependency index for ${dep.name}@${dep.version}`);
      } else if (dep.extractedPath && fs.existsSync(dep.extractedPath)) {
        await context.addLibrary(dep.extractedPath, { skipIndex: true });
        console.log(`[publish] Registered dependency library path for ${dep.name}@${dep.version}`);
      }
    }
  }

  const memBefore = process.memoryUsage();
  console.log(`[publish] Memory before addLibrary: ${Math.round(memBefore.heapUsed / 1024 / 1024)}MB heap`);

  const library = await context.addLibrary(libraryPath);
  if (!library) {
    console.warn(`[publish] Warning: Not a valid Modelica library or missing package.mo at: ${libraryPath}`);
    return context;
  }

  const memAfter = process.memoryUsage();
  console.log(`[publish] Memory after addLibrary: ${Math.round(memAfter.heapUsed / 1024 / 1024)}MB heap`);

  // Force GC right after loading
  if (typeof globalThis.gc === "function") {
    globalThis.gc();
    const memGC = process.memoryUsage();
    console.log(`[publish] Memory after GC: ${Math.round(memGC.heapUsed / 1024 / 1024)}MB heap`);
  }

  // Fire onReady callback immediately after indexing, before the expensive SVG pass.
  // This allows the caller to export salsa-index and lsp-bundle early.
  if (onReady) {
    await onReady(context);
  }

  // Dynamic safety limit: on low-memory hosts (e.g. 2GB droplet with --max-old-space-size=1400),
  // trip SVG skipping and cache pruning much earlier (55% of limit or 700MB) before V8 old space
  // fragmentation causes fatal "Ineffective mark-compacts near heap limit".
  const v8Limit = v8.getHeapStatistics().heap_size_limit;
  const isLowMem = os.totalmem() <= 2.5 * 1024 * 1024 * 1024 || v8Limit <= 2048 * 1024 * 1024;
  const HEAP_LIMIT = isLowMem
    ? Math.min(Math.floor(v8Limit * 0.55), 700 * 1024 * 1024)
    : Math.min(5 * 1024 * 1024 * 1024, Math.floor(v8Limit * 0.7));
  let classesProcessed = 0;
  let classesReused = 0;

  function isMemoryTight(): boolean {
    const mem = process.memoryUsage();
    if (mem.heapUsed > HEAP_LIMIT) return true;
    if (isLowMem && mem.rss > 1400 * 1024 * 1024) return true;
    if (os.freemem() < 250 * 1024 * 1024) return true;
    return false;
  }

  function tryGC() {
    if (typeof globalThis.gc === "function") {
      globalThis.gc();
    }
  }

  const queryDB = context.queryEngine.toQueryDB();
  const symIndex = context.queryEngine.index;
  const normLibPrefix = libraryPath.replace(/\\/g, "/").replace(/\/?$/, "/");

  // 2. Memoized Sound Merkle Dependency Hashers over the resolved QueryEngine graph
  const ownSourceCache = new Map<number, string>();
  const iconHashMemo = new Map<number, string>();
  const diagramHashMemo = new Map<number, string>();
  const sharedAdapterCache = new Map<number, ClassAdapter | null>();

  function getOwnSource(symbolId: number): string {
    let cached = ownSourceCache.get(symbolId);
    if (cached === undefined) {
      cached = getOwnSourceExcludingNestedClasses(context, symbolId);
      if (ownSourceCache.size >= 200) {
        const oldestKey = ownSourceCache.keys().next().value;
        if (oldestKey !== undefined) ownSourceCache.delete(oldestKey);
      }
      ownSourceCache.set(symbolId, cached);
    }
    return cached;
  }

  function isExternalSymbol(sym: { resourceId?: string | undefined } | null | undefined): boolean {
    if (!sym?.resourceId) return false;
    const cleanRes = sym.resourceId.replace(/\\/g, "/").replace(/^[a-z0-9+-]+:\/\//i, "");
    return !cleanRes.startsWith(normLibPrefix);
  }

  function computeIconHash(classId: number, visiting = new Set<number>()): string {
    const existing = iconHashMemo.get(classId);
    if (existing !== undefined) return existing;

    const sym = queryDB.symbol(classId);
    if (!sym) return "null";

    const fqn = getSymbolFqn(context, classId);
    if (isExternalSymbol(sym) && externalIconHashes.has(fqn)) {
      const extHash = externalIconHashes.get(fqn)!;
      iconHashMemo.set(classId, extHash);
      return extHash;
    }

    if (visiting.has(classId)) {
      return `cycle:${fqn}`;
    }
    visiting.add(classId);

    const h = crypto.createHash("sha256");
    const ownSource = getOwnSource(classId);
    h.update(`self:${fqn}:${classKindFromEntry(sym)}:${ownSource}\n`);

    // Include enclosing scope imports & constants so lexical import rebinding invalidates downstream classes
    let currParentId: number | null | undefined = sym.parentId;
    const seenParents = new Set<number>();
    while (typeof currParentId === "number" && currParentId > 0 && !seenParents.has(currParentId)) {
      seenParents.add(currParentId);
      const pSym = queryDB.symbol(currParentId);
      if (!pSym) break;
      const pOwnSrc = getOwnSource(currParentId);
      const pImports = extractScopeImports(pOwnSrc);
      for (const imp of pImports) {
        const targetId = resolveSymbolId(context, imp.target);
        const targetFqn = targetId ? getSymbolFqn(context, targetId) : "unresolved";
        h.update(`scope-import:${currParentId}:${imp.raw}->${targetFqn}\n`);
      }
      const pChildren = queryDB.childrenOf(currParentId) || [];
      for (const pch of pChildren) {
        if (pch.kind === "Component" || pch.kind === "Variable") {
          const pchText =
            typeof pch.startOffset === "number" && typeof pch.endOffset === "number" && pch.endOffset > pch.startOffset
              ? queryDB.cstText(pch.startOffset, pch.endOffset, pch)
              : ((queryDB.cstNode(pch.id) as CstNodeLike | null)?.text ?? "");
          h.update(`scope-const:${pch.name}:${pchText || String(pch.metadata?.["typeSpecifier"] ?? "")}\n`);
        }
      }
      if (pSym.parentId === currParentId || pSym.parentId === null || pSym.parentId === undefined) break;
      currParentId = pSym.parentId;
    }

    // Include own imports and resolved targets
    for (const imp of extractScopeImports(ownSource)) {
      const targetId = resolveSymbolId(context, imp.target);
      const targetFqn = targetId ? getSymbolFqn(context, targetId) : "unresolved";
      h.update(`own-import:${imp.raw}->${targetFqn}\n`);
    }

    // Include transitive extends base classes and connector types
    const children = queryDB.childrenOf(classId) || [];
    for (const child of children) {
      if (child.kind === "Extends" || child.ruleName?.includes("extends")) {
        let baseSym = queryDB.query("resolvedBaseClass", child.id) as { id?: number | undefined } | null | undefined;
        const baseName = (child.metadata?.["typeSpecifier"] as string | undefined) || child.name;
        if (!baseSym && baseName) {
          const baseId = resolveSymbolIdInScope(context, classId, baseName, ownSourceCache);
          if (baseId) baseSym = queryDB.symbol(baseId);
        }
        if (baseSym && typeof baseSym.id === "number") {
          const baseFqn = getSymbolFqn(context, baseSym.id);
          const baseHash = computeIconHash(baseSym.id, new Set(visiting));
          h.update(`extends:${baseName}->${baseFqn}:${baseHash}\n`);
        } else {
          h.update(`extends:${baseName}->unresolved\n`);
        }
      } else if (child.kind === "Component" || child.kind === "Variable") {
        const compTypeName = (child.metadata?.["typeSpecifier"] as string | undefined) || "";
        let compClassId = queryDB.query("classInstance", child.id) as number | undefined;
        if (typeof compClassId !== "number" && compTypeName) {
          compClassId = resolveSymbolIdInScope(context, classId, compTypeName, ownSourceCache) ?? undefined;
        }
        if (typeof compClassId === "number") {
          const compSym = queryDB.symbol(compClassId);
          const compKind = classKindFromEntry(compSym);
          const compFqn = getSymbolFqn(context, compClassId);
          if (compKind === "connector" || child.metadata?.["causality"] === "connector") {
            const connHash = computeIconHash(compClassId, new Set(visiting));
            h.update(`connector:${child.name}:${compTypeName}->${compFqn}:${connHash}\n`);
          } else {
            h.update(`comp-decl:${child.name}:${compTypeName}->${compFqn}\n`);
          }
        } else {
          h.update(`comp-decl:${child.name}:${compTypeName}->builtin\n`);
        }
      }
    }

    const digest = h.digest("hex");
    iconHashMemo.set(classId, digest);
    return digest;
  }

  function computeDiagramHash(classId: number, visiting = new Set<number>()): string {
    const existing = diagramHashMemo.get(classId);
    if (existing !== undefined) return existing;

    const sym = queryDB.symbol(classId);
    if (!sym) return "null";

    const fqn = getSymbolFqn(context, classId);
    if (visiting.has(classId)) {
      return `cycle:${fqn}`;
    }
    visiting.add(classId);

    const h = crypto.createHash("sha256");
    h.update(`icon:${computeIconHash(classId)}\n`);

    const children = queryDB.childrenOf(classId) || [];
    for (const child of children) {
      if (child.kind === "Extends" || child.ruleName?.includes("extends")) {
        let baseSym = queryDB.query("resolvedBaseClass", child.id) as { id?: number | undefined } | null | undefined;
        const baseName = (child.metadata?.["typeSpecifier"] as string | undefined) || child.name;
        if (!baseSym && baseName) {
          const baseId = resolveSymbolIdInScope(context, classId, baseName, ownSourceCache);
          if (baseId) baseSym = queryDB.symbol(baseId);
        }
        if (baseSym && typeof baseSym.id === "number") {
          const baseDiagHash = computeDiagramHash(baseSym.id, new Set(visiting));
          h.update(`ext-diagram:${baseName}->${baseDiagHash}\n`);
        }
      } else if (child.kind === "Component" || child.kind === "Variable") {
        const compTypeName = (child.metadata?.["typeSpecifier"] as string | undefined) || "";
        let compClassId = queryDB.query("classInstance", child.id) as number | undefined;
        if (typeof compClassId !== "number" && compTypeName) {
          compClassId = resolveSymbolIdInScope(context, classId, compTypeName, ownSourceCache) ?? undefined;
        }
        if (typeof compClassId === "number") {
          const compIconHash = computeIconHash(compClassId);
          h.update(`comp-icon:${child.name}:${compTypeName}->${compIconHash}\n`);
        }
      }
    }

    const digest = h.digest("hex");
    diagramHashMemo.set(classId, digest);
    return digest;
  }

  async function visitClass(classId: number, fqn: string) {
    const sym = queryDB.symbol(classId);
    if (!sym) return;

    const className = fqn;
    const children = queryDB.childrenOf(classId) || [];

    if (!processedClassNames.has(className)) {
      try {
        const iconHash = computeIconHash(classId);
        const diagramHash = computeDiagramHash(classId);
        const prev = options?.previousVersion?.classes.get(className);

        // Fast-path: 100% transitive Merkle match (both icon and diagram + metadata unchanged)
        if (
          prev &&
          prev.iconHash &&
          prev.diagramHash &&
          prev.iconHash === iconHash &&
          prev.diagramHash === diagramHash
        ) {
          const reusedIcon = options?.previousVersion?.readSvg(className, "icon") ?? null;
          const reusedDiagram = options?.previousVersion?.readSvg(className, "diagram") ?? null;
          const reusedMeta: ClassMetadata = {
            className,
            classKind: prev.classKind,
            description: prev.description,
            documentation: prev.documentation,
            baseClasses: prev.baseClasses,
            components: prev.components,
            iconHash,
            diagramHash,
          };
          await onClass(className, reusedMeta, { icon: reusedIcon, diagram: reusedDiagram });
          classesProcessed++;
          classesReused++;
        } else {
          const ownSrc = getOwnSource(classId);
          const classKind = classKindFromEntry(sym);
          const baseClasses: string[] = [];
          const components: ComponentMetadata[] = [];

          for (const child of children) {
            if (child.kind === "Extends") {
              const baseName = (child.metadata?.["typeSpecifier"] as string) || child.name;
              if (baseName) baseClasses.push(baseName);
            } else if (child.kind === "Component" || child.kind === "Variable") {
              const compText =
                typeof child.startOffset === "number" &&
                typeof child.endOffset === "number" &&
                child.endOffset > child.startOffset
                  ? (queryDB.cstText(child.startOffset, child.endOffset, child) ?? "")
                  : "";
              const preAnnCompText = compText
                .replace(/\bannotation\s*\([\s\S]*$/, "")
                .replace(/"(?:[^"\\]|\\.)*"/g, "");
              const needsCompCstForMod = preAnnCompText.includes("(") || preAnnCompText.includes("=");

              let compDesc: string | null = cleanModelicaDescription(
                (child.metadata?.["description"] as string) ?? null,
              );
              let compCst: CstNodeLike | null = null;
              if (!compDesc && compText.includes('"')) {
                compCst = queryDB.cstNode(child.id) as CstNodeLike | null;
                if (compCst?.children) {
                  const descChild = compCst.children.find(
                    (c: CstNodeLike) =>
                      c.type === "description" || c.type === "comment" || c.type === "description_string",
                  );
                  const descStrNode =
                    descChild?.children?.find(
                      (c: CstNodeLike) => c.type === "description_string" || c.type === "string_comment",
                    ) ?? descChild;
                  if (descStrNode?.text) {
                    compDesc = cleanModelicaDescription(descStrNode.text);
                  }
                }
              }

              let causality: string | null = (child.metadata?.["causality"] as string) ?? null;
              if (!causality) {
                try {
                  causality = queryDB.query("causality", child.id)?.toString() ?? null;
                } catch {}
              }

              let variability: string | null = (child.metadata?.["variability"] as string) ?? null;
              if (!variability) {
                try {
                  variability = queryDB.query("variability", child.id)?.toString() ?? null;
                } catch {}
              }

              if (needsCompCstForMod && !compCst) {
                compCst = queryDB.cstNode(child.id) as CstNodeLike | null;
              }
              const modifiers = needsCompCstForMod ? extractModifiers(null, compCst) : [];

              components.push({
                name: child.name ?? "",
                typeName: (child.metadata?.["typeSpecifier"] as string) ?? "unknown",
                description: compDesc,
                causality,
                variability,
                modifiers,
              });
            }
          }

          let description: string | null = cleanModelicaDescription((sym.metadata?.["description"] as string) ?? null);
          let cstNode: CstNodeLike | null = null;
          if (!description && ownSrc.includes('"')) {
            cstNode = queryDB.cstNode(classId) as CstNodeLike | null;
            if (cstNode?.children) {
              // Check for description_string in long_class_specifier or children
              const walkForDesc = (n: CstNodeLike | null | undefined): string | null => {
                if (!n) return null;
                if (n.type === "annotation_clause" || n.type === "AnnotationClause" || n.type === "composition") {
                  return null;
                }
                if (n.type === "description_string" || n.type === "string_comment") {
                  return cleanModelicaDescription(n.text);
                }
                if (n.type === "description" || n.type === "comment") {
                  const strNode = n.children?.find(
                    (c: CstNodeLike) => c.type === "description_string" || c.type === "string_comment",
                  );
                  if (strNode?.text) return cleanModelicaDescription(strNode.text);
                  return cleanModelicaDescription(n.text);
                }
                for (const ch of n.children || []) {
                  if (ch.type === "composition" || ch.type === "annotation_clause") continue;
                  const d = walkForDesc(ch);
                  if (d) return d;
                }
                return null;
              };
              description = walkForDesc(cstNode);
            }
          }

          let documentation: string | null = null;
          if (/\bDocumentation\s*\(/.test(ownSrc)) {
            const docMatch = ownSrc.match(/\bDocumentation\s*\([\s\S]*?\binfo\s*=\s*"((?:[^"\\]|\\.)*)"\s*[,)]/);
            if (docMatch && docMatch[1] !== undefined) {
              documentation = docMatch[1].replace(/\\(["\\nrt])/g, (_, ch) => {
                switch (ch) {
                  case '"':
                    return '"';
                  case "\\":
                    return "\\";
                  case "n":
                    return "\n";
                  case "r":
                    return "\r";
                  case "t":
                    return "\t";
                  default:
                    return ch;
                }
              });
            } else {
              if (!cstNode) cstNode = queryDB.cstNode(classId) as CstNodeLike | null;
              if (cstNode) {
                try {
                  const evaluator = new (AnnotationEvaluator as unknown as AnnotationEvaluatorConstructor)();
                  const doc = evaluator.evaluate(cstNode, "Documentation");
                  if (doc?.info) {
                    documentation = doc.info;
                  }
                } catch {}
              }
            }
          }

          const memoryTight = isMemoryTight();
          let iconSvg: string | null = null;
          let diagramSvg: string | null = null;
          const skipDiagram = Boolean(options?.skipSvg) || memoryTight || children.length > 2500;
          const skipIcon = Boolean(options?.skipSvg) || memoryTight;

          if (!skipIcon || !skipDiagram) {
            try {
              const canReuseIcon = Boolean(prev && prev.iconHash && prev.iconHash === iconHash);
              if (canReuseIcon) {
                iconSvg = options?.previousVersion?.readSvg(className, "icon") ?? null;
              }

              const adapter = buildClassAdapter(
                context,
                classId,
                AnnotationEvaluator as unknown as AnnotationEvaluatorConstructor,
                0,
                sharedAdapterCache,
              );
              if (adapter) {
                if (!skipIcon && !canReuseIcon) {
                  const svgStr = renderIconSvgString(adapter as unknown as Parameters<typeof renderIconSvgString>[0]);
                  if (svgStr && hasVisualContent(svgStr)) iconSvg = svgStr;
                }
                if (!skipDiagram) {
                  const svgStr = renderDiagramSvgString(
                    adapter as unknown as Parameters<typeof renderDiagramSvgString>[0],
                  );
                  if (svgStr && hasVisualContent(svgStr)) diagramSvg = svgStr;
                }
              }
            } catch {}
          }

          const metadata: ClassMetadata = {
            className,
            classKind,
            description,
            documentation,
            baseClasses,
            components,
            iconHash: skipIcon ? null : iconHash,
            diagramHash: skipDiagram ? null : diagramHash,
          };

          await onClass(className, metadata, { icon: iconSvg, diagram: diagramSvg });
          classesProcessed++;
        }

        if (classesProcessed % 50 === 0 || isMemoryTight()) {
          context.pruneCaches();
          sharedAdapterCache.clear();
          queryDB.flushVolatile?.();
          queryDB.clearMemos?.();
          tryGC();
        }

        if (classesProcessed % 100 === 0) {
          const mem = process.memoryUsage();
          console.log(
            `[publish] ${classesProcessed} classes (${classesReused} reused) — heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB, rss: ${Math.round(mem.rss / 1024 / 1024)}MB${isMemoryTight() ? " [MEMORY TIGHT - SKIPPING SVGS]" : ""}`,
          );
        }
      } catch (err) {
        console.warn(`[publish] Skipping class ${className}: ${err instanceof Error ? err.message : err}`);
      }
    }

    await new Promise<void>((resolve) => setImmediate(resolve));

    for (const child of children) {
      if (child.kind === "Class") {
        await visitClass(child.id, `${fqn}.${child.name}`);
      }
    }
  }

  // Find root classes for this library:
  const BUILTIN_PRIMITIVES = new Set([
    "Real",
    "Integer",
    "Boolean",
    "String",
    "StateSelect",
    "ExternalObject",
    "Clock",
  ]);
  const rootSymbols: { id: number; name: string }[] = [];
  for (const [_id, sym] of symIndex.symbols.entries()) {
    if (
      sym.kind === "Class" &&
      (sym.parentId === null || sym.parentId === sym.id) &&
      !sym.metadata?.["isPredefined"] &&
      !BUILTIN_PRIMITIVES.has(sym.name) &&
      sym.id > 0
    ) {
      if (sym.resourceId && (sym.resourceId.includes("/Resources/") || sym.resourceId.includes("\\Resources\\"))) {
        continue;
      }
      if (sym.name === library.name || (sym.resourceId && sym.resourceId.startsWith(libraryPath))) {
        rootSymbols.push(sym);
      }
    }
  }

  if (rootSymbols.length === 0) {
    const rootFromClasses = context.classes.find((c) => c.name === library.name);
    if (rootFromClasses) {
      const sym = queryDB.symbol(rootFromClasses.id);
      if (sym) rootSymbols.push(sym);
    }
  }

  const matchingLibraryRoots = rootSymbols.filter((s) => s.name === library.name);
  const rootsToVisit = matchingLibraryRoots.length > 0 ? matchingLibraryRoots : rootSymbols;
  for (const rootSym of rootsToVisit) {
    await visitClass(rootSym.id, rootSym.name);
  }

  return context;
}

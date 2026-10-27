// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context } from "@modelscript/modelica/context";
import { registerWindow } from "@svgdotjs/svg.js";
import { createSVGWindow } from "svgdom";
import xmlFormat from "xml-formatter";

import type { ClassMetadata, ComponentMetadata } from "../database.js";
import { NodeFileSystem } from "./filesystem.js";

/** Initialize the headless SVG environment once. */
let svgWindowInitialized = false;
function ensureSvgWindow(): void {
  if (svgWindowInitialized) return;
  const window = createSVGWindow();
  registerWindow(window, window.document);
  svgWindowInitialized = true;
}

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

function buildClassAdapter(
  context: Context,
  symbolId: number,
  AnnotationEvaluatorClass: AnnotationEvaluatorConstructor,
  visited = new Set<number>(),
): ClassAdapter | null {
  if (visited.has(symbolId)) return null;
  visited.add(symbolId);

  const queryDB = context.queryEngine.toQueryDB();
  const entry = queryDB.symbol(symbolId);
  if (!entry) return null;
  const cstNode = queryDB.cstNode(symbolId) as CstNodeLike | null;
  const children = queryDB.childrenOf(symbolId) || [];
  const components: ClassAdapterComponent[] = [];
  const connectEquations: ClassAdapterConnectEq[] = [];
  const extendsClassInstances: { classInstance: ClassAdapter }[] = [];

  for (const child of children) {
    if (child.kind === "Component" || child.kind === "Variable") {
      const _childCst = queryDB.cstNode(child.id) as CstNodeLike | null;
      void _childCst;
      const childClassId = queryDB.query("classInstance", child.id) as number | undefined;
      const compCls =
        typeof childClassId === "number"
          ? buildClassAdapter(context, childClassId, AnnotationEvaluatorClass, new Set(visited))
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
      components.push({
        id: child.id,
        name: child.name,
        entry: child,
        cstNode: _childCst,
        abstractSyntaxNode: _childCst,
        classInstance: compCls,
        classKind: compCls?.classKind ?? classKindFromEntry(child),
        modification: {
          expression: exprText !== undefined ? { text: String(exprText) } : undefined,
          getModificationArgument: (argName: string) => {
            const foundArg = childMod?.args?.find((a) => a.name === argName);
            if (foundArg) {
              const rawVal = foundArg.value;
              const valText =
                typeof rawVal === "object" && rawVal !== null && "text" in rawVal
                  ? (rawVal as { text?: string | undefined }).text
                  : rawVal;
              return { expression: valText !== undefined ? { text: String(valText) } : undefined };
            }
            return undefined;
          },
        },
      });
    } else if (child.kind === "ConnectEquation" || child.ruleName?.includes("connect")) {
      const connCst = queryDB.cstNode(child.id) as CstNodeLike | null;
      let lhs = "";
      let rhs = "";
      if (connCst) {
        const cRefs = (connCst.children || []).filter(
          (c: CstNodeLike) => c.type === "component_reference" || c.type === "ComponentReference",
        );
        if (cRefs.length > 0) lhs = cRefs[0]?.text?.trim() ?? "";
        if (cRefs.length > 1) rhs = cRefs[1]?.text?.trim() ?? "";
      }
      if (!lhs && child.metadata?.["lhs"]) lhs = String(child.metadata["lhs"]);
      if (!rhs && child.metadata?.["rhs"]) rhs = String(child.metadata["rhs"]);
      connectEquations.push({
        lhs,
        rhs,
        cstNode: connCst,
      });
    } else if (child.kind === "Extends" || child.ruleName?.includes("extends")) {
      let baseSym = queryDB.query("resolvedBaseClass", child.id) as { id?: number | undefined } | null | undefined;
      if (!baseSym && child.name) {
        const baseId = resolveSymbolId(context, child.name);
        if (baseId) baseSym = queryDB.symbol(baseId);
      }
      if (baseSym && typeof baseSym.id === "number" && !visited.has(baseSym.id)) {
        const baseAdapter = buildClassAdapter(context, baseSym.id, AnnotationEvaluatorClass, new Set(visited));
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
 */
export async function processLibrary(
  libraryPath: string,
  processedClassNames: Set<string>,
  onClass: (className: string, metadata: ClassMetadata, svgs: SvgResult) => Promise<void>,
  onReady?: (context: Context) => Promise<void>,
): Promise<Context> {
  ensureSvgWindow();
  await ensureParser();

  const { renderIcon, renderDiagram, AnnotationEvaluator } = await import("@modelscript/modelica/diagram");
  const formatXml = xmlFormat as unknown as (xml: string) => string;

  const context = new Context(new NodeFileSystem());

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

  // We use 5 GB as a conservative limit to ensure we hit the safety check before V8 crashes at 8 GB
  const HEAP_LIMIT = 5 * 1024 * 1024 * 1024;
  let classesProcessed = 0;

  function isMemoryTight(): boolean {
    return process.memoryUsage().heapUsed > HEAP_LIMIT;
  }

  function tryGC() {
    if (typeof globalThis.gc === "function") {
      globalThis.gc();
    }
  }

  const queryDB = context.queryEngine.toQueryDB();
  const symIndex = context.queryEngine.index;

  async function visitClass(classId: number, fqn: string) {
    const sym = queryDB.symbol(classId);
    if (!sym) return;

    const className = fqn;
    const cstNode = queryDB.cstNode(classId) as CstNodeLike | null;
    const children = queryDB.childrenOf(classId) || [];

    if (!processedClassNames.has(className)) {
      try {
        const classKind = classKindFromEntry(sym);
        const baseClasses: string[] = [];
        const components: ComponentMetadata[] = [];

        for (const child of children) {
          if (child.kind === "Extends") {
            const baseName = (child.metadata?.["typeSpecifier"] as string) || child.name;
            if (baseName) baseClasses.push(baseName);
          } else if (child.kind === "Component" || child.kind === "Variable") {
            const compCst = queryDB.cstNode(child.id) as CstNodeLike | null;
            let compDesc: string | null = cleanModelicaDescription((child.metadata?.["description"] as string) ?? null);
            if (!compDesc && compCst?.children) {
              const descChild = compCst.children.find(
                (c: CstNodeLike) => c.type === "description" || c.type === "comment" || c.type === "description_string",
              );
              const descStrNode =
                descChild?.children?.find(
                  (c: CstNodeLike) => c.type === "description_string" || c.type === "string_comment",
                ) ?? descChild;
              if (descStrNode?.text) {
                compDesc = cleanModelicaDescription(descStrNode.text);
              }
            }

            let causality: string | null = null;
            try {
              causality = queryDB.query("causality", child.id)?.toString() ?? null;
            } catch {}

            let variability: string | null = null;
            try {
              variability = queryDB.query("variability", child.id)?.toString() ?? null;
            } catch {}

            const modifiers = extractModifiers(null, compCst);

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
        if (!description && cstNode?.children) {
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

        let documentation: string | null = null;
        if (cstNode) {
          try {
            const evaluator = new (AnnotationEvaluator as unknown as AnnotationEvaluatorConstructor)();
            const doc = evaluator.evaluate(cstNode, "Documentation");
            if (doc?.info) {
              documentation = doc.info;
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
        };

        const memoryTight = isMemoryTight();
        let iconSvg: string | null = null;
        let diagramSvg: string | null = null;
        const skipRendering = memoryTight || children.length > 300;

        if (!skipRendering) {
          try {
            const adapter = buildClassAdapter(
              context,
              classId,
              AnnotationEvaluator as unknown as AnnotationEvaluatorConstructor,
            );
            if (adapter) {
              const icon = renderIcon(adapter as unknown as Parameters<typeof renderIcon>[0]);
              if (icon) {
                const svgStr = formatXml(icon.svg());
                if (hasVisualContent(svgStr)) iconSvg = svgStr;
                icon.remove();
                icon.clear();
              }
              const diagram = renderDiagram(adapter as unknown as Parameters<typeof renderDiagram>[0]);
              if (diagram) {
                const svgStr = formatXml(diagram.svg());
                if (hasVisualContent(svgStr)) diagramSvg = svgStr;
                diagram.remove();
                diagram.clear();
              }
            }
          } catch {}

          const win = (
            globalThis as {
              window?: { document?: { body?: { innerHTML: string } | undefined } | undefined } | undefined;
            }
          ).window;
          if (win?.document?.body) {
            win.document.body.innerHTML = "";
          }
        }

        await onClass(className, metadata, { icon: iconSvg, diagram: diagramSvg });
        classesProcessed++;

        if (classesProcessed % 50 === 0) {
          tryGC();
        }

        if (classesProcessed % 100 === 0) {
          const mem = process.memoryUsage();
          console.log(
            `[publish] ${classesProcessed} classes — heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB, rss: ${Math.round(mem.rss / 1024 / 1024)}MB${memoryTight ? " [MEMORY TIGHT - SKIPPING SVGS]" : ""}`,
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
  const rootSymbols: { id: number; name: string }[] = [];
  for (const [_id, sym] of symIndex.symbols.entries()) {
    if (
      sym.kind === "Class" &&
      (sym.parentId === null || sym.parentId === sym.id) &&
      !sym.metadata?.["isPredefined"] &&
      sym.id > 0
    ) {
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

  for (const rootSym of rootSymbols) {
    await visitClass(rootSym.id, rootSym.name);
  }

  return context;
}

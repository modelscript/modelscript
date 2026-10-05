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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Context.registerParser(".mo", parser as any);
  })();
  return parserPromise;
}

export interface SvgResult {
  icon: string | null;
  diagram: string | null;
}

/**
 * Extract modifier name/value pairs from a modification or CST node.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractModifiers(modification: any | null, cstNode?: any): { name: string; value: string | null }[] {
  const result: { name: string; value: string | null }[] = [];
  if (!modification && !cstNode) return result;

  if (Array.isArray(modification?.modificationArguments)) {
    for (const arg of modification.modificationArguments) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const name = (arg as any).name;
      if (name) {
        let value: string | null = null;
        try {
          const expr = arg.expression;
          if (expr) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const json = (expr as any).toJSON;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (node: any) => {
    if (!node) return;
    if (node.type === "element_modification" || node.type === "ElementModification") {
      const nameNode = node.children?.find(
        (c: any) => c.type === "name" || c.type === "Name" || c.type === "identifier" || c.type === "Identifier",
      );
      const valNode = node.children?.find((c: any) => c.type === "modification" || c.type === "Modification");
      if (nameNode?.text) {
        result.push({
          name: nameNode.text.trim(),
          value: valNode?.text?.replace(/^=\s*/, "").trim() ?? null,
        });
      }
      return;
    }
    for (const child of node.children || []) {
      walk(child);
    }
  };
  walk(targetNode);

  return result;
}

/**
 * Extract metadata for a single component instance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractComponentMetadata(component: any): ComponentMetadata | null {
  const name = component.name;
  if (!name) return null;

  const typeName = component.classInstance?.compositeName ?? component.declaredType?.compositeName ?? "unknown";
  const description = component.description ?? null;
  const cst = component.cstNode ?? component.abstractSyntaxNode;

  // Get causality and variability from component properties, symbol metadata, or AST/CST node
  let causality =
    component.causality?.toString() ??
    component.declaration?.metadata?.causality?.toString() ??
    (
      component.abstractSyntaxNode?.parent as { causality?: { toString(): string } | null } | undefined
    )?.causality?.toString() ??
    null;
  if (!causality && cst) {
    let p = cst.parent;
    while (p && !causality) {
      if (p.type === "component_clause" || p.type === "ComponentClause") {
        const tp = p.children?.find((c: any) => c.type === "type_prefix" || c.type === "TypePrefix");
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
      component.abstractSyntaxNode?.parent as { variability?: { toString(): string } | null } | undefined
    )?.variability?.toString() ??
    null;
  if (!variability && cst) {
    let p = cst.parent;
    while (p && !variability) {
      if (p.type === "component_clause" || p.type === "ComponentClause") {
        const tp = p.children?.find((c: any) => c.type === "type_prefix" || c.type === "TypePrefix");
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

  const { renderIcon, renderDiagram } = await import("@modelscript/modelica/diagram");

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

  // Process classes recursively
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function processElement(element: any) {
    if (!element) return;
    if (element.isComponentInstance || element.kind === "Extends" || element.kind === "Component") return;
    if (element.isClassInstance === false && !element.classKind && element.kind !== "Class") return;

    const className = element.compositeName;
    if (className) {
      if (!processedClassNames.has(className)) {
        try {
          const classKind = element.classKind ?? "unknown";
          const baseClasses = (element.extendsClassInstances || [])
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((e: any) => e.classInstance?.compositeName)
            .filter(Boolean) as string[];

          const components: ComponentMetadata[] = [];
          for (const comp of element.components || []) {
            const compMeta = extractComponentMetadata(comp);
            if (compMeta) components.push(compMeta);
          }

          const metadata: ClassMetadata = {
            className,
            classKind: classKind.toString(),
            description: element.description ?? null,
            documentation: (element.annotation?.("Documentation") as { info?: string } | undefined)?.info ?? null,
            baseClasses,
            components,
          };

          const memoryTight = isMemoryTight();
          // Render SVGs — skip when memory is tight, for packages, or for classes with many declared elements
          // (declaredElements is a plain array, safe to check without triggering lazy resolution)
          let iconSvg: string | null = null;
          let diagramSvg: string | null = null;
          const skipRendering = memoryTight || (element.declaredElements?.length ?? 0) > 200;

          if (!skipRendering) {
            try {
              const icon = renderIcon(element);
              if (icon) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const svgStr: string = (xmlFormat as any)(icon.svg());
                if (hasVisualContent(svgStr)) {
                  iconSvg = svgStr;
                }
                // Aggressive DOM cleanup to prevent leaks
                icon.remove();
                icon.clear();
              }
            } catch {
              // Skip classes that fail to render
            }

            try {
              const diagram = renderDiagram(element);
              if (diagram) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const svgStr: string = (xmlFormat as any)(diagram.svg());
                if (hasVisualContent(svgStr)) {
                  diagramSvg = svgStr;
                }
                // Aggressive DOM cleanup to prevent leaks
                diagram.remove();
                diagram.clear();
              }
            } catch {
              // Skip classes that fail to render
            }

            // Clear global fake window body to ensure no detached nodes accumulate
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const win = (globalThis as any).window;
            if (win && win.document && win.document.body) {
              win.document.body.innerHTML = "";
            }
          }

          await onClass(className, metadata, { icon: iconSvg, diagram: diagramSvg });
          classesProcessed++;

          // Force GC periodically to reclaim intermediate objects
          if (classesProcessed % 50 === 0) {
            tryGC();
          }

          // Log memory usage for diagnostics
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
    }

    // Process nested elements
    for (const child of element.elements) {
      await processElement(child);
    }
  }

  for (const element of context.elements) {
    await processElement(element);
  }

  return context;
}

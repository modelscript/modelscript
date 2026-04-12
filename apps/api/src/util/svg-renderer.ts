// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Context,
  ModelicaClassInstance,
  ModelicaComponentInstance,
  type ModelicaModification,
} from "@modelscript/core";
import Modelica from "@modelscript/tree-sitter-modelica";
import { registerWindow } from "@svgdotjs/svg.js";
import { createSVGWindow } from "svgdom";
import Parser from "tree-sitter";
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

/** Initialize the tree-sitter parser once. */
let parserRegistered = false;
function ensureParser(): void {
  if (parserRegistered) return;
  const parser = new Parser();
  parser.setLanguage(Modelica);
  Context.registerParser(".mo", parser);
  parserRegistered = true;
}

export interface SvgResult {
  icon: string | null;
  diagram: string | null;
}

/**
 * Extract modifier name/value pairs from a ModelicaModification.
 */
function extractModifiers(modification: ModelicaModification | null): { name: string; value: string | null }[] {
  const result: { name: string; value: string | null }[] = [];
  if (!modification) return result;

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

/**
 * Extract metadata for a single component instance.
 */
function extractComponentMetadata(component: ModelicaComponentInstance): ComponentMetadata | null {
  const name = component.name;
  if (!name) return null;

  const typeName = component.classInstance?.compositeName ?? component.declaredType?.compositeName ?? "unknown";
  const description = component.description ?? null;

  // Get causality and variability from the AST node's parent component clause
  const astNode = component.abstractSyntaxNode;
  const parentClause = astNode?.parent;
  const causality =
    (parentClause as { causality?: { toString(): string } | null } | undefined)?.causality?.toString() ?? null;
  const variability =
    (parentClause as { variability?: { toString(): string } | null } | undefined)?.variability?.toString() ?? null;

  const modifiers = extractModifiers(component.modification);

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
  onClass: (className: string, metadata: ClassMetadata, svgs: SvgResult) => Promise<void>,
): Promise<void> {
  ensureSvgWindow();
  ensureParser();

  const { renderIcon, renderDiagram } = await import("@modelscript/core");

  const context = new Context(new NodeFileSystem());

  const memBefore = process.memoryUsage();
  console.log(`[publish] Memory before addLibrary: ${Math.round(memBefore.heapUsed / 1024 / 1024)}MB heap`);

  const library = context.addLibrary(libraryPath);
  if (!library) {
    throw new Error(`Failed to load library from: ${libraryPath}`);
  }

  const memAfter = process.memoryUsage();
  console.log(`[publish] Memory after addLibrary: ${Math.round(memAfter.heapUsed / 1024 / 1024)}MB heap`);

  // Force GC right after loading
  if (typeof globalThis.gc === "function") {
    globalThis.gc();
    const memGC = process.memoryUsage();
    console.log(`[publish] Memory after GC: ${Math.round(memGC.heapUsed / 1024 / 1024)}MB heap`);
  }

  const HEAP_LIMIT = 4 * 1024 * 1024 * 1024; // 4 GB — aggressive to leave headroom
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
  async function processElement(element: unknown) {
    if (!(element instanceof ModelicaClassInstance)) return;

    const className = element.compositeName;
    if (className) {
      try {
        const classKind = element.classKind ?? "class";
        const memoryTight = isMemoryTight();

        // Extract extends (guarded — the getter can trigger heavy resolution)
        const baseClasses: string[] = [];
        if (!memoryTight) {
          try {
            for (const ext of element.extendsClassInstances) {
              const baseName = ext.classInstance?.compositeName;
              if (baseName) baseClasses.push(baseName);
            }
          } catch {
            // Skip if extends resolution fails
          }
        }

        // Extract components (guarded — the getter can trigger massive allocations)
        const components: ComponentMetadata[] = [];
        if (!memoryTight) {
          try {
            let count = 0;
            for (const comp of element.components) {
              if (count >= 500) break;
              const meta = extractComponentMetadata(comp);
              if (meta) components.push(meta);
              count++;
            }
          } catch {
            // Skip if component resolution fails
          }
        }

        const metadata: ClassMetadata = {
          className,
          classKind: classKind.toString(),
          description: element.description ?? null,
          documentation: element.annotation<{ info?: string }>("Documentation")?.info ?? null,
          baseClasses,
          components,
        };

        // Render SVGs — skip when memory is tight, for packages, or for classes with many declared elements
        // (declaredElements is a plain array, safe to check without triggering lazy resolution)
        let iconSvg: string | null = null;
        let diagramSvg: string | null = null;
        const skipRendering =
          memoryTight || classKind.toString() === "package" || (element.declaredElements?.length ?? 0) > 200;

        if (!skipRendering) {
          try {
            const icon = renderIcon(element);
            if (icon) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              iconSvg = (xmlFormat as any)(icon.svg());
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
            }
          } catch {
            // Skip classes that fail to render
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
            `[publish] ${classesProcessed} classes — heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB, rss: ${Math.round(mem.rss / 1024 / 1024)}MB${memoryTight ? " [MEMORY TIGHT]" : ""}`,
          );
        }
      } catch (err) {
        console.warn(`[publish] Skipping class ${className}: ${err instanceof Error ? err.message : err}`);
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
}

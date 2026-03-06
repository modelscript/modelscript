// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Context,
  ModelicaClassInstance,
  ModelicaComponentInstance,
  type ModelicaModification,
} from "@modelscript/core";
import Modelica from "@modelscript/tree-sitter-modelica";
import { registerWindow } from "@svgdotjs/svg.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSVGWindow } from "svgdom";
import Parser from "tree-sitter";
import xmlFormat from "xml-formatter";

import type { ClassMetadata, ComponentMetadata } from "../database.js";
import { NodeFileSystem } from "./filesystem.js";
import { extractZipToDir, findLibraryRoot } from "./zip.js";

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
 * Extract class metadata from a loaded library context.
 */
function extractClassMetadata(context: Context): ClassMetadata[] {
  const classes: ClassMetadata[] = [];

  function processClass(element: unknown) {
    if (!(element instanceof ModelicaClassInstance)) return;

    const className = element.compositeName;
    if (className) {
      const classKind = element.classKind ?? "class";

      // Collect base classes
      const baseClasses: string[] = [];
      for (const ext of element.extendsClassInstances) {
        const baseName = ext.classInstance?.compositeName;
        if (baseName) baseClasses.push(baseName);
      }

      // Collect components
      const components: ComponentMetadata[] = [];
      for (const comp of element.components) {
        const meta = extractComponentMetadata(comp);
        if (meta) components.push(meta);
      }

      classes.push({
        className,
        classKind: classKind.toString(),
        description: element.description ?? null,
        documentation: element.annotation<{ info?: string }>("Documentation")?.info ?? null,
        baseClasses,
        components,
      });
    }

    // Recursively process nested classes/components
    for (const child of element.elements) {
      processClass(child);
    }
  }

  for (const element of context.elements) {
    processClass(element);
  }

  return classes;
}

export interface LibraryProcessingResult {
  svgs: Map<string, SvgResult>;
  metadata: ClassMetadata[];
}

/**
 * Render SVGs and extract metadata for all classes in a library zip.
 */
export async function processLibrary(zipBuffer: Buffer): Promise<LibraryProcessingResult> {
  ensureSvgWindow();
  ensureParser();

  const { renderIcon, renderDiagram } = await import("@modelscript/core");

  const svgs = new Map<string, SvgResult>();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "modelscript-"));

  let metadata: ClassMetadata[] = [];

  try {
    await extractZipToDir(zipBuffer, tmpDir);

    const libraryRoot = findLibraryRoot(tmpDir);
    if (!libraryRoot) {
      throw new Error("Could not find package.mo in the extracted zip");
    }

    const context = new Context(new NodeFileSystem());
    const library = context.addLibrary(libraryRoot);
    if (!library) {
      throw new Error("Failed to load library from extracted zip");
    }

    // Extract metadata
    metadata = extractClassMetadata(context);

    // Render SVGs
    function processElement(element: unknown) {
      if (!(element instanceof ModelicaClassInstance)) return;

      const name = element.compositeName;
      if (name) {
        let iconSvg: string | null = null;
        let diagramSvg: string | null = null;

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
            diagramSvg = (xmlFormat as any)(diagram.svg());
          }
        } catch {
          // Skip classes that fail to render
        }

        if (iconSvg || diagramSvg) {
          svgs.set(name, { icon: iconSvg, diagram: diagramSvg });
        }
      }

      for (const child of element.elements) {
        processElement(child);
      }
    }

    for (const element of context.elements) {
      processElement(element);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return { svgs, metadata };
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context, ModelicaClassInstance, renderDiagram, renderIcon } from "@modelscript/modelscript";
import Modelica from "@modelscript/tree-sitter-modelica";
import { registerWindow } from "@svgdotjs/svg.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSVGWindow } from "svgdom";
import Parser from "tree-sitter";
import xmlFormat from "xml-formatter";
import yauzl from "yauzl";

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

/**
 * Extract all files from a zip buffer into a target directory.
 */
async function extractZipToDir(buffer: Buffer, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error("Failed to open zip"));
        return;
      }

      zipfile.readEntry();

      zipfile.on("entry", (entry: yauzl.Entry) => {
        const entryPath = path.join(targetDir, entry.fileName);

        if (entry.fileName.endsWith("/")) {
          fs.mkdirSync(entryPath, { recursive: true });
          zipfile.readEntry();
          return;
        }

        fs.mkdirSync(path.dirname(entryPath), { recursive: true });

        zipfile.openReadStream(entry, (err, readStream) => {
          if (err || !readStream) {
            reject(err ?? new Error("Failed to read entry"));
            return;
          }

          const writeStream = fs.createWriteStream(entryPath);
          readStream.pipe(writeStream);
          writeStream.on("close", () => zipfile.readEntry());
          writeStream.on("error", reject);
        });
      });

      zipfile.on("end", resolve);
      zipfile.on("error", reject);
    });
  });
}

/**
 * Find the library root directory inside an extracted zip.
 * Looks for the shallowest `package.mo` file.
 */
function findLibraryRoot(dir: string): string | null {
  // Check if package.mo is directly in the directory
  if (fs.existsSync(path.join(dir, "package.mo"))) {
    return dir;
  }

  // Check one level deeper (common: zip contains a single top-level folder)
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const candidate = path.join(dir, entry.name, "package.mo");
      if (fs.existsSync(candidate)) {
        return path.join(dir, entry.name);
      }
    }
  }

  return null;
}

export interface SvgResult {
  icon: string | null;
  diagram: string | null;
}

/**
 * Render icon and diagram SVGs for all classes in a library zip.
 *
 * @returns Map keyed by composite class name to SVG strings.
 */
export async function renderLibrarySvgs(zipBuffer: Buffer): Promise<Map<string, SvgResult>> {
  ensureSvgWindow();
  ensureParser();

  const results = new Map<string, SvgResult>();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "modelscript-"));

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

    for (const element of context.elements) {
      if (!(element instanceof ModelicaClassInstance)) continue;

      const name = element.compositeName;
      if (!name) continue;

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
        results.set(name, { icon: iconSvg, diagram: diagramSvg });
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return results;
}

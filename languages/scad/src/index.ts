// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileToStep, type Solid } from "@modelscript/cad";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TreeSitterParser } from "../src-gen/bindings.js";
import { ScadEvaluator, type ScadEvaluationOptions } from "./evaluator.js";
import { scadLanguage } from "./language.js";
import { ScadPatcher } from "./patcher.js";

export { ScadEvaluator, scadLanguage, ScadPatcher };
export type { ScadEvaluationOptions };

let cachedParser: TreeSitterParser | null = null;

function findFile(relativePaths: string[]): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of relativePaths) {
    const candidate = path.resolve(currentDir, rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.resolve(currentDir, relativePaths[0]);
}

/**
 * Initializes or retrieves the singleton WebAssembly GLR parser for SCAD.
 */
export async function getScadParser(): Promise<TreeSitterParser> {
  if (cachedParser) return cachedParser;

  const wasmPath = findFile(["../parser.wasm", "../dist/parser.wasm", "../../dist/parser.wasm", "parser.wasm"]);

  const bindingsPath = findFile(["../src-gen/bindings.js", "../../src-gen/bindings.js", "src-gen/bindings.js"]);

  const wasmBytes = fs.readFileSync(wasmPath);
  const { createWasmParser } = await import(bindingsPath);
  const { parser } = await createWasmParser(wasmBytes);
  cachedParser = parser;
  return parser;
}

/**
 * Parses and evaluates SCAD source code into a @modelscript/cad Solid CSG tree.
 */
export async function compileScadToSolid(source: string, options?: ScadEvaluationOptions): Promise<Solid | null> {
  const parser = await getScadParser();
  const tree = parser.parse(source);
  if (!tree) return null;
  const evaluator = new ScadEvaluator(options);
  return evaluator.evaluate(tree.rootNode);
}

/**
 * Parses and evaluates SCAD source code directly into a STEP Part 21 string.
 */
export async function compileScadToStep(source: string, options?: ScadEvaluationOptions): Promise<string> {
  const solid = await compileScadToSolid(source, options);
  if (!solid) {
    throw new Error("Failed to compile SCAD: no solid geometry generated");
  }
  return compileToStep(solid);
}

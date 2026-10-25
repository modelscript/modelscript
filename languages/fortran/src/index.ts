// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser, type TreeSitterParser } from "../src-gen/bindings.js";
import { FortranAstParser, parseFortranScript, tokenizeFortran, type FortranExpr, type FortranStmt } from "./ast.js";
import {
  buildStepFunction,
  compileFortranSegment,
  compileFortranStep,
  type CompiledFortranComponent,
  type FortranExecutionContext,
  type FortranStepFunction,
} from "./codegen/step-compiler.js";
import { lowerFortranToDae, type FortranDaeLoweringResult } from "./dae/lowering.js";
import { fortranLanguage } from "./language.js";
import { FortranErrorCode, lintFortran, lintFortranSource, type FortranDiagnostic } from "./lints/index.js";
import {
  evaluateCondition,
  preprocessFortran,
  preprocessFortranSegment,
  type PreprocessedFortran,
} from "./preprocessor.js";

export {
  buildStepFunction,
  compileFortranSegment,
  compileFortranStep,
  evaluateCondition,
  FortranAstParser,
  FortranErrorCode,
  fortranLanguage,
  lintFortran,
  lintFortranSource,
  lowerFortranToDae,
  parseFortranScript,
  preprocessFortran,
  preprocessFortranSegment,
  tokenizeFortran,
};

export type {
  CompiledFortranComponent,
  FortranDaeLoweringResult,
  FortranDiagnostic,
  FortranExecutionContext,
  FortranExpr,
  FortranStepFunction,
  FortranStmt,
  PreprocessedFortran,
  TreeSitterParser,
};

let cachedParser: TreeSitterParser | null = null;

function findFile(relativePaths: string[]): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of relativePaths) {
    const candidate = path.resolve(currentDir, rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.resolve(currentDir, relativePaths[0]!);
}

/**
 * Initializes or retrieves the singleton WebAssembly GLR parser for Fortran.
 */
export async function getFortranParser(wasmUrlOrBytes?: Uint8Array | ArrayBuffer | string): Promise<TreeSitterParser> {
  if (cachedParser) return cachedParser;

  let wasmInput: Uint8Array | ArrayBuffer | string | undefined = wasmUrlOrBytes;
  if (!wasmInput) {
    if (
      typeof fs?.readFileSync === "function" &&
      typeof import.meta?.url === "string" &&
      import.meta.url.startsWith("file:")
    ) {
      const wasmPath = findFile(["../parser.wasm", "../dist/parser.wasm", "../../dist/parser.wasm", "parser.wasm"]);
      wasmInput = fs.readFileSync(wasmPath);
    } else {
      wasmInput = "fortran.wasm";
    }
  }

  const { parser } = await createWasmParser(wasmInput);
  cachedParser = parser;
  return parser;
}

/**
 * Parses Fortran source code into a CST node.
 */
export async function parseFortran(source: string): Promise<any> {
  const parser = await getFortranParser();
  const tree = parser.parse(source);
  return tree?.rootNode ?? null;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser, type SyntaxNode, type TreeSitterParser } from "../src-gen/bindings.js";
import { CAstParser, parseCScript, tokenizeC, type CExpr, type CStmt, type CSwitchCase, type CToken } from "./ast.js";
import {
  scrapeCHeader,
  type CFunctionParam,
  type CFunctionPrototype,
  type CStructDefinition,
  type CStructField,
  type ScrapedCHeader,
} from "./bridge/header-scraper.js";
import {
  bindCHeaderToModelica,
  generateModelicaFunction,
  generateModelicaRecord,
  mapCTypeToModelica,
} from "./bridge/modelica-binder.js";
import {
  buildCStepFunction,
  compileCStep,
  type CExecutionContext,
  type CompiledCComponent,
  type CStepFunction,
} from "./codegen/step-compiler.js";
import { lowerCToDae, type CDaeLoweringResult } from "./dae/lowering.js";
import { CErrorCode, type CErrorCodeKey } from "./errors.js";
import {
  verifyCRoutine,
  type CVerificationDiagnostic,
  type CVerificationDiagnosticCode,
  type CVerificationOptions,
  type CVerificationResult,
  type NumericInterval,
  type PointerAbstractState,
  type PointerStatus,
} from "./formal/verifier.js";
import { getCLanguageConfiguration, getCMonarchDefinition, getCTextMateGrammar } from "./ide/index.js";
import { cLanguage } from "./language.js";
import { lintC, lintCSource, type CDiagnostic, type CLintOptions } from "./lints/index.js";
import { evaluateCondition, preprocessCSegment, type PreprocessedC } from "./preprocessor.js";

export {
  bindCHeaderToModelica,
  buildCStepFunction,
  CAstParser,
  CErrorCode,
  cLanguage,
  compileCStep,
  evaluateCondition,
  generateModelicaFunction,
  generateModelicaRecord,
  getCLanguageConfiguration,
  getCMonarchDefinition,
  getCTextMateGrammar,
  lintC,
  lintCSource,
  lowerCToDae,
  mapCTypeToModelica,
  parseCScript,
  preprocessCSegment,
  scrapeCHeader,
  tokenizeC,
  verifyCRoutine,
};

export type {
  CDaeLoweringResult,
  CDiagnostic,
  CErrorCodeKey,
  CExecutionContext,
  CExpr,
  CFunctionParam,
  CFunctionPrototype,
  CLintOptions,
  CompiledCComponent,
  CStepFunction,
  CStmt,
  CStructDefinition,
  CStructField,
  CSwitchCase,
  CToken,
  CVerificationDiagnostic,
  CVerificationDiagnosticCode,
  CVerificationOptions,
  CVerificationResult,
  NumericInterval,
  PointerAbstractState,
  PointerStatus,
  PreprocessedC,
  ScrapedCHeader,
  SyntaxNode,
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
 * Initializes or retrieves the singleton WebAssembly GLR parser for C.
 */
export async function getCParser(wasmUrlOrBytes?: Uint8Array | ArrayBuffer | string): Promise<TreeSitterParser> {
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
      wasmInput = "c.wasm";
    }
  }

  const { parser } = await createWasmParser(wasmInput);
  cachedParser = parser;
  return parser;
}

/**
 * Parses C source code into a CST root node using the WebAssembly GLR parser.
 */
export async function parseC(source: string): Promise<SyntaxNode | null> {
  const parser = await getCParser();
  const tree = parser.parse(source);
  return tree?.rootNode ?? null;
}

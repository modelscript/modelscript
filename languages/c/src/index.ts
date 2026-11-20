// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { createWasmParser, createWasmParserSync, type SyntaxNode, type TreeSitterParser } from "../src-gen/bindings.js";
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

export * from "./lsp.js";

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

/**
 * Initializes or retrieves the singleton WebAssembly GLR parser for C.
 */
export async function getCParser(wasmUrlOrBytes?: Uint8Array | ArrayBuffer | string): Promise<TreeSitterParser> {
  if (cachedParser) return cachedParser;

  if (!wasmUrlOrBytes) {
    cachedParser = getOrLoadLanguageWasmParser("c", import.meta.url, createWasmParserSync);
    return cachedParser;
  }

  const { parser } = await createWasmParser(wasmUrlOrBytes);
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

export * from "./lints/workspace.js";
export * from "./lsp-actions.js";

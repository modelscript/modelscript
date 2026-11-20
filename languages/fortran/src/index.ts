// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { createWasmParser, createWasmParserSync, type SyntaxNode, type TreeSitterParser } from "../src-gen/bindings.js";
import {
  extractFortranSignature,
  FortranAstParser,
  parseFortranAst,
  parseFortranModule,
  parseFortranScript,
  tokenizeFortran,
  type FortranArraySpec,
  type FortranCaseBranch,
  type FortranCaseValue,
  type FortranExpr,
  type FortranModuleAst,
  type FortranRoutineSignature,
  type FortranStmt,
  type FortranSubscript,
  type FortranUnitAst,
} from "./ast.js";
import {
  buildStepFunction,
  compileFortranSegment,
  compileFortranStep,
  compileUserComponentStep,
  simulateFortranRoutine,
  type CompiledFortranComponent,
  type CompiledUserComponentStep,
  type FortranExecutionContext,
  type FortranSimulationOptions,
  type FortranSimulationResult,
  type FortranStepFunction,
  type RuntimeFortranArray,
} from "./codegen/step-compiler.js";
import { lowerFortranToDae, type FortranDaeLoweringResult } from "./dae/lowering.js";
import {
  createFortranZipArchive,
  exportFortranFmu,
  type FortranFmuOptions,
  type FortranFmuResult,
  type FortranFmuVariable,
} from "./fmu/exporter.js";
import {
  buildFortranCFG,
  verifyFortranSource,
  type FortranVerificationOptions,
  type FortranVerificationReport,
} from "./formal/verifier.js";
import {
  getFortranLanguageConfiguration,
  getFortranMonarchDefinition,
  getFortranTextMateGrammar,
} from "./ide/index.js";
import { fortranLanguage } from "./language.js";
import { FortranErrorCode, lintFortran, lintFortranSource, type FortranDiagnostic } from "./lints/index.js";
import {
  evaluateCondition,
  preprocessFortran,
  preprocessFortranSegment,
  type PreprocessedFortran,
} from "./preprocessor.js";
export { buildFortranDiagramFromCst, maskFortranFixedCommentsAndPreprocessor } from "./diagram-builder.js";

export {
  buildFortranCFG,
  buildStepFunction,
  compileFortranSegment,
  compileFortranStep,
  compileUserComponentStep,
  createFortranZipArchive,
  evaluateCondition,
  exportFortranFmu,
  extractFortranSignature,
  FortranAstParser,
  FortranErrorCode,
  fortranLanguage,
  getFortranLanguageConfiguration,
  getFortranMonarchDefinition,
  getFortranTextMateGrammar,
  lintFortran,
  lintFortranSource,
  lowerFortranToDae,
  parseFortranAst,
  parseFortranModule,
  parseFortranScript,
  preprocessFortran,
  preprocessFortranSegment,
  simulateFortranRoutine,
  tokenizeFortran,
  verifyFortranSource,
};

export * from "./lsp.js";
export * from "./semantic-tokens.js";

export type {
  CompiledFortranComponent,
  CompiledUserComponentStep,
  FortranArraySpec,
  FortranCaseBranch,
  FortranCaseValue,
  FortranDaeLoweringResult,
  FortranDiagnostic,
  FortranExecutionContext,
  FortranExpr,
  FortranFmuOptions,
  FortranFmuResult,
  FortranFmuVariable,
  FortranModuleAst,
  FortranRoutineSignature,
  FortranSimulationOptions,
  FortranSimulationResult,
  FortranStepFunction,
  FortranStmt,
  FortranSubscript,
  FortranUnitAst,
  FortranVerificationOptions,
  FortranVerificationReport,
  PreprocessedFortran,
  RuntimeFortranArray,
  SyntaxNode,
  TreeSitterParser,
};

let cachedParser: TreeSitterParser | null = null;

/**
 * Initializes or retrieves the singleton WebAssembly GLR parser for Fortran.
 */
export async function getFortranParser(wasmUrlOrBytes?: Uint8Array | ArrayBuffer | string): Promise<TreeSitterParser> {
  if (cachedParser) return cachedParser;

  const isEmptyInput =
    !wasmUrlOrBytes ||
    (typeof wasmUrlOrBytes !== "string" && "byteLength" in wasmUrlOrBytes && wasmUrlOrBytes.byteLength === 0);

  if (isEmptyInput) {
    try {
      cachedParser = getOrLoadLanguageWasmParser("fortran", import.meta.url, createWasmParserSync);
      return cachedParser;
    } catch {
      const serverBase = (globalThis as { serverDistBase?: string | undefined }).serverDistBase;
      const fallbackUrl = serverBase ? `${serverBase.replace(/\/$/, "")}/fortran.wasm` : "fortran.wasm";
      const { parser } = await createWasmParser(fallbackUrl);
      cachedParser = parser;
      return parser;
    }
  }

  const { parser } = await createWasmParser(wasmUrlOrBytes);
  cachedParser = parser;
  return parser;
}

/**
 * Parses Fortran source code into a CST node.
 */
export async function parseFortran(source: string): Promise<SyntaxNode | null> {
  const parser = await getFortranParser();
  const tree = parser.parse(source);
  return tree?.rootNode ?? null;
}

export * from "./lints/workspace.js";
export * from "./lsp-actions.js";

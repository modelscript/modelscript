// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "./catalog/index.js";
export { eslToDae, lowerEslToDae, type EslDaeLoweringResult, type EslToDaeOptions } from "./dae/index.js";
export { EslErrorCode, type EslDiagnostic, type EslErrorCodeKey } from "./errors.js";
export { eslIndexing } from "./indexing.js";
export { eslLanguage } from "./language.js";
export { lintEsl, lintEslSource } from "./lints/index.js";
export {
  LspSymbolKind,
  executeEslAction,
  getEslCompletions,
  getEslDocumentSymbols,
  getEslHover,
  validateEsl,
  type LspCompletionItem,
  type LspDiagnostic,
  type LspDocumentSymbol,
  type LspHover,
  type LspPosition,
  type LspRange,
} from "./lsp.js";
export { parseEsl } from "./parser/index.js";
export { eslToModelica } from "./projections/index.js";
export {
  simulateEsl,
  type EslEventRecord,
  type EslSimulationOptions,
  type EslSimulationResult,
} from "./solver/index.js";
export type {
  EslBinaryOp,
  EslBlock,
  EslBlockKind,
  EslDataType,
  EslDeclaration,
  EslExpr,
  EslParameter,
  EslProgram,
  EslSectionKind,
  EslSourceSpan,
  EslStatement,
  EslSyntaxError,
  EslUnaryOp,
} from "./types.js";

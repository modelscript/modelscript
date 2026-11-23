// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "./catalog/index.js";
export {
  dynamoToDae,
  extractLevelRateExpr,
  lowerDynamoToDae,
  type DynamoDaeLoweringResult,
  type DynamoToDaeOptions,
} from "./dae/index.js";
export { DynamoErrorCode, type DynamoErrorCodeKey } from "./errors.js";
export { dynamoIndexing } from "./indexing.js";
export { dynamoLanguage } from "./language.js";
export { lintDynamo, type DynamoDiagnostic } from "./lints/index.js";
export {
  LspSymbolKind,
  getDynamoCompletions,
  getDynamoDocumentSymbols,
  getDynamoHover,
  validateDynamo,
  type LspCompletionItem,
  type LspDiagnostic,
  type LspDocumentSymbol,
  type LspHover,
  type LspPosition,
  type LspRange,
} from "./lsp.js";
export { extractExprRefs, parseDynamo, parseDynamoExpr } from "./parser/index.js";
export { dynamoToModelica } from "./projections/index.js";
export {
  simulateDynamo,
  type DynamoIntegrator,
  type DynamoSimOptions,
  type DynamoSimPoint,
  type DynamoSimResult,
} from "./solver/index.js";
export type {
  DynamoBinaryOp,
  DynamoEquation,
  DynamoEquationKind,
  DynamoExpr,
  DynamoModel,
  DynamoNote,
  DynamoParseError,
  DynamoPlotDirective,
  DynamoPlotEntry,
  DynamoPrintDirective,
  DynamoRunDirective,
  DynamoSourceSpan,
  DynamoSpec,
  DynamoTimeSubscript,
} from "./types.js";

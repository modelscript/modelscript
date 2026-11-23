// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "./catalog/index.js";
export {
  inferResourceRates,
  lowerSimscriptToDae,
  resolveSimscriptSchemaParamDefaults,
  simscriptToDae,
  type SimscriptDaeLoweringResult,
  type SimscriptToDaeOptions,
} from "./dae/index.js";
export { SimscriptErrorCode, type SimscriptErrorCodeKey } from "./errors.js";
export { simscriptIndexing } from "./indexing.js";
export { simscriptLanguage } from "./language.js";
export { lintSimscript, type SimscriptDiagnostic } from "./lints/index.js";
export {
  LspSymbolKind,
  getSimscriptCompletions,
  getSimscriptDocumentSymbols,
  getSimscriptHover,
  validateSimscript,
  type LspCompletionItem,
  type LspDiagnostic,
  type LspDocumentSymbol,
  type LspHover,
  type LspPosition,
  type LspRange,
} from "./lsp.js";
export { parseDistributionExpr, parseSimscript } from "./parser/index.js";
export { simscriptToModelica } from "./projections/index.js";
export {
  SeededRng,
  computeMMcAnalytical,
  sampleDistribution,
  simulateSimscript,
  type MMcAnalyticalResult,
  type ResourceStats,
  type SetStats,
  type SimscriptSimOptions,
  type SimscriptSimResult,
  type TallyStats,
} from "./solver/index.js";
export type {
  SimscriptDefineDecl,
  SimscriptDistributionExpr,
  SimscriptEntityDecl,
  SimscriptEntityKind,
  SimscriptModel,
  SimscriptPreamble,
  SimscriptRoutineBlock,
  SimscriptSetDiscipline,
  SimscriptStatDecl,
  SimscriptStatMeasure,
  SimscriptStatement,
  SimscriptSyntaxError,
  SourceSpan,
} from "./types.js";

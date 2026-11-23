// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "./catalog/index.js";
export {
  lowerSindaToDae,
  sindaToDae,
  type SindaDaeBundle,
  type SindaDaeLoweringResult,
  type SindaToDaeOptions,
} from "./dae/index.js";
export { SindaErrorCode, type SindaDiagnostic } from "./errors.js";
export { sindaIndexing } from "./indexing.js";
export { sindaLanguage } from "./language.js";
export { lintSinda } from "./lints/index.js";
export {
  LspSymbolKind,
  getSindaCompletions,
  getSindaDocumentSymbols,
  getSindaHover,
  validateSinda,
  type LspCompletionItem,
  type LspDiagnostic,
  type LspDocumentSymbol,
  type LspHover,
  type LspPosition,
  type LspRange,
} from "./lsp.js";
export { parseSindaDeck, parseSindaNumber } from "./parser/index.js";
export { sindaToModelica, type SindaToModelicaOptions } from "./projections/index.js";
export {
  solveLinearSystem,
  solveSindaSteadyState,
  solveSindaTransient,
  type SindaSteadyOptions,
  type SindaSteadyResult,
  type SindaTransientMethod,
  type SindaTransientOptions,
  type SindaTransientResult,
} from "./solver/index.js";
export {
  STEFAN_BOLTZMANN,
  type SindaArray,
  type SindaBlock,
  type SindaConductor,
  type SindaConductorKind,
  type SindaDuplicateRef,
  type SindaExecutionCall,
  type SindaModel,
  type SindaNode,
  type SindaNodeKind,
  type SindaOptions,
  type SindaParseError,
  type SindaSource,
} from "./types.js";

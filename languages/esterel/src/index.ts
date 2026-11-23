// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "./catalog/index.js";
export {
  esterelToDae,
  lowerEsterelToDae,
  type EsterelDaeLoweringResult,
  type EsterelToDaeOptions,
} from "./dae/index.js";
export { EsterelErrorCode, type EsterelErrorKey } from "./errors.js";
export * from "./indexing.js";
export { esterelLanguage } from "./language.js";
export { lintEsterel, mayTerminateInstantaneously } from "./lints/index.js";
export {
  LspSymbolKind,
  getEsterelCompletions,
  getEsterelDocumentSymbols,
  getEsterelHover,
  validateEsterel,
  type LspCompletionItem,
  type LspDiagnostic,
  type LspDocumentSymbol,
  type LspHover,
  type LspPosition,
  type LspRange,
} from "./lsp.js";
export { parseEsterel } from "./parser/index.js";
export { esterelToLustre, esterelToModelica, type EsterelProjectionOptions } from "./projections/index.js";
export {
  EsterelSimulator,
  simulateEsterelTrace,
  type EsterelReactionResult,
  type EsterelSimulateOptions,
  type EsterelTraceResult,
  type SignalStatus,
} from "./solver/index.js";
export type {
  EsterelAwaitCase,
  EsterelDiagnostic,
  EsterelModule,
  EsterelProgram,
  EsterelRelation,
  EsterelRelationKind,
  EsterelSignalDecl,
  EsterelSignalDirection,
  EsterelSignalExpr,
  EsterelSignalRenaming,
  EsterelStatement,
  EsterelSyntaxError,
  EsterelTrapHandler,
  SourceSpan,
} from "./types.js";

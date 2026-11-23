// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "./catalog/index.js";
export { lowerSdlToDae, sdlToDae, type SdlDaeLoweringResult, type SdlToDaeResult } from "./dae/index.js";
export { SdlErrorCode, type SdlDiagnostic } from "./errors.js";
export { sdlIndexing } from "./indexing.js";
export { sdlLanguage } from "./language.js";
export { lintSdl } from "./lints/index.js";
export {
  LspSymbolKind,
  getSdlCompletions,
  getSdlDocumentSymbols,
  getSdlHover,
  validateSdl,
  type LspCompletionItem,
  type LspDiagnostic,
  type LspDocumentSymbol,
  type LspHover,
  type LspPosition,
  type LspRange,
} from "./lsp.js";
export { parseSdl } from "./parser/index.js";
export { sdlToModelica } from "./projections/index.js";
export {
  analyzeSdlReachability,
  evaluateSdlExpr,
  simulateSdl,
  type SdlEnvOutput,
  type SdlInjectedSignal,
  type SdlProcessReachability,
  type SdlProcessSnapshot,
  type SdlReachabilityReport,
  type SdlSimulationOptions,
  type SdlSimulationResult,
  type SdlTimerExpiryRecord,
  type SdlTraceEvent,
  type SdlValue,
} from "./solver/index.js";
export type {
  SdlAction,
  SdlBlockDecl,
  SdlChannelDecl,
  SdlChannelPath,
  SdlConnectDecl,
  SdlDecisionBranch,
  SdlInputClause,
  SdlProcessDecl,
  SdlSignalDecl,
  SdlSignalRouteDecl,
  SdlSpan,
  SdlStateDecl,
  SdlSyntaxError,
  SdlSystemModel,
  SdlTerminator,
  SdlTimerDecl,
  SdlTransition,
  SdlVarDecl,
} from "./types.js";

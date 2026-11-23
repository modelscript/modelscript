// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "./catalog/index.js";
export { gpssToDae, lowerGpssToDae, type GpssDaeLoweringResult, type GpssToDaeOptions } from "./dae/index.js";
export { GpssErrorCode, type GpssDiagnostic } from "./errors.js";
export { gpssIndexing } from "./indexing.js";
export { gpssLanguage } from "./language.js";
export { lintGpss, lintGpssSource } from "./lints/index.js";
export {
  LspSymbolKind,
  executeGpssAction,
  getGpssCompletions,
  getGpssDocumentSymbols,
  getGpssHover,
  validateGpss,
  type LspCompletionItem,
  type LspDiagnostic,
  type LspDocumentSymbol,
  type LspHover,
  type LspPosition,
  type LspRange,
} from "./lsp.js";
export { parseGpss } from "./parser/index.js";
export { gpssToModelica } from "./projections/index.js";
export {
  computeErlangC,
  computeMM1,
  simulateGpss,
  type ErlangCResult,
  type GpssFacilityStats,
  type GpssQueueStats,
  type GpssSimulateOptions,
  type GpssSimulationResult,
  type GpssStorageStats,
  type GpssTableStats,
} from "./solver/index.js";
export {
  GPSS_BLOCK_OPCODES,
  GPSS_CONTROL_OPCODES,
  type GpssBlockOpcode,
  type GpssControlOpcode,
  type GpssEquDef,
  type GpssFunctionDef,
  type GpssModel,
  type GpssOpcode,
  type GpssStatement,
  type GpssStorageDef,
  type GpssSyntaxError,
  type GpssTableDef,
} from "./types.js";

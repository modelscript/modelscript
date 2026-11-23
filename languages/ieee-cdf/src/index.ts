// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "./catalog/index.js";
export {
  ieeeCdfToDae,
  lowerIeeeCdfToDae,
  type IeeeCdfDaeLoweringResult,
  type IeeeCdfToDaeOptions,
} from "./dae/index.js";
export { IeeeCdfErrorCode, type IeeeCdfDiagnostic, type IeeeCdfErrorCodeKey } from "./errors.js";
export * from "./indexing.js";
export { ieeeCdfLanguage } from "./language.js";
export { lintIeeeCdf } from "./lints/index.js";
export {
  LspSymbolKind,
  getIeeeCdfCompletions,
  getIeeeCdfDocumentSymbols,
  getIeeeCdfHover,
  validateIeeeCdf,
  type LspCompletionItem,
  type LspDiagnostic,
  type LspDocumentSymbol,
  type LspHover,
  type LspPosition,
  type LspRange,
} from "./lsp.js";
export { detectIeeeCdfFormat, parseBpaIpf, parseIeeeCdf } from "./parser/index.js";
export { ieeeCdfToMatpower, ieeeCdfToModelica, ieeeCdfToPsseRaw } from "./projections/index.js";
export {
  buildYBus,
  solvePowerFlow,
  type BranchFlowResult,
  type BusFlowResult,
  type PowerFlowOptions,
  type PowerFlowResult,
  type SparseYEntry,
  type YBusMatrix,
} from "./solver/index.js";
export type {
  IeeeCdfBranch,
  IeeeCdfBranchType,
  IeeeCdfBus,
  IeeeCdfBusType,
  IeeeCdfFormat,
  IeeeCdfInterchange,
  IeeeCdfLossZone,
  IeeeCdfNetwork,
  IeeeCdfParseIssue,
  IeeeCdfTieLine,
  IeeeCdfTitleCard,
} from "./types.js";

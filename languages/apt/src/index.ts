// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "./cad/index.js";
export * from "./catalog/index.js";
export * from "./dae/index.js";
export { AptErrorCode, type AptDiagnostic, type AptErrorKey, type AptErrorSpec } from "./errors.js";
export { aptIndexing } from "./indexing.js";
export { aptLanguage } from "./language.js";
export { lintApt } from "./lints/index.js";
export {
  LspSymbolKind,
  getAptCompletions,
  getAptDocumentSymbols,
  getAptHover,
  validateApt,
  type LspCompletionItem,
  type LspDiagnostic,
  type LspDocumentSymbol,
  type LspHover,
  type LspPosition,
  type LspRange,
} from "./lsp.js";
export * from "./parser/index.js";
export * from "./projections/index.js";
export type * from "./types.js";

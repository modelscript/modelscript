// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "./cad/index.js";
export * from "./catalog/index.js";
export * from "./dae/index.js";
export { GCodeErrorCode, type GCodeErrorCodeKey } from "./errors.js";
export { gcodeIndexing } from "./indexing.js";
export { gcodeLanguage } from "./language.js";
export { lintGCode, type GCodeDiagnostic } from "./lints/index.js";
export {
  LspSymbolKind,
  getGCodeCompletions,
  getGCodeDocumentSymbols,
  getGCodeHover,
  validateGCode,
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

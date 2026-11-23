// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "./catalog/index.js";
export {
  lowerLustreToDae,
  lustreToDae,
  type LustreDaeLoweringOptions,
  type LustreDaeLoweringResult,
} from "./dae/index.js";
export { LustreErrorCode, type LustreDiagnostic } from "./errors.js";
export * from "./indexing.js";
export { lustreLanguage } from "./language.js";
export { formatClock, lintLustre, lintLustreSource } from "./lints/index.js";
export {
  LspSymbolKind,
  getLustreCompletions,
  getLustreDocumentSymbols,
  getLustreHover,
  validateLustre,
  type LspCompletionItem,
  type LspDiagnostic,
  type LspDocumentSymbol,
  type LspHover,
  type LspPosition,
  type LspRange,
} from "./lsp.js";
export { parseLustre } from "./parser/index.js";
export { lustreToModelica, type LustreToModelicaOptions } from "./projections/index.js";
export {
  checkLustreObserver,
  createLustreStepper,
  simulateLustre,
  type LustreObserverResult,
  type LustreSimulationResult,
  type LustreStepInputs,
  type LustreStepOutputs,
  type LustreStepResult,
  type LustreStepper,
} from "./solver/index.js";
export type {
  LustreAssertion,
  LustreBaseType,
  LustreBinaryOp,
  LustreClock,
  LustreConstDecl,
  LustreEquation,
  LustreExpr,
  LustreNodeDecl,
  LustreProgram,
  LustreRuntimeValue,
  LustreScalarValue,
  LustreSpan,
  LustreSyntaxError,
  LustreType,
  LustreTypeDecl,
  LustreUnaryOp,
  LustreVarDecl,
} from "./types.js";

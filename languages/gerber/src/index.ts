// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "./cad/index.js";
export * from "./catalog/index.js";
export * from "./dae/index.js";
export { GerberErrorCode, type GerberDiagnostic, type GerberErrorKey } from "./errors.js";
export { gerberIndexing } from "./indexing.js";
export { gerberLanguage } from "./language.js";
export { lintGerber, type GerberLintOptions } from "./lints/index.js";
export {
  LspSymbolKind,
  getGerberCompletions,
  getGerberDocumentSymbols,
  getGerberHover,
  validateGerber,
  type LspCompletionItem,
  type LspDiagnostic,
  type LspDocumentSymbol,
  type LspHover,
  type LspPosition,
  type LspRange,
} from "./lsp.js";
export { decodeGerberCoordinate, parseGerber } from "./parser/index.js";
export * from "./projections/index.js";
export type {
  GerberApertureDef,
  GerberApertureMacro,
  GerberApertureShape,
  GerberAttribute,
  GerberBoundingBox,
  GerberCommand,
  GerberComment,
  GerberCoordNotation,
  GerberDocument,
  GerberDrawCommand,
  GerberFilledRegion,
  GerberFlashPad,
  GerberFormatSpec,
  GerberGeometry,
  GerberInterpolation,
  GerberMacroPrimitive,
  GerberModeCommand,
  GerberOperationKind,
  GerberParseError,
  GerberPoint,
  GerberPolarity,
  GerberQuadrantMode,
  GerberRegionCommand,
  GerberRegionSegment,
  GerberSelectApertureCommand,
  GerberStepRepeat,
  GerberStrokeSegment,
  GerberUnit,
  GerberZeroOmission,
  SourceSpan,
} from "./types.js";

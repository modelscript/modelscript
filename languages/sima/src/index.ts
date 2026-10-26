// SPDX-License-Identifier: AGPL-3.0-or-later

export { simaToDae, type SimaToDaeOptions } from "./dae/index.js";
export { simaLanguage } from "./language.js";
export { SimaErrorCode, lintSimaProject, type SimaDiagnostic } from "./lints/index.js";
export {
  executeSimaAction,
  getSimaDocumentSymbols,
  getSimaHover,
  validateSima,
  type LspDiagnostic,
  type LspDocumentSymbol,
  type LspHover,
  type LspPosition,
  type LspRange,
} from "./lsp.js";
export { parseCardDeck, parseHydFile, parseSimaFile, parseSimaXml } from "./parser/index.js";
export { simaToModelica, simaToSsp, simaToSysml2 } from "./projections/index.js";
export {
  createRationalRealization,
  lowerSimaToDae,
  simulateCumminsDynamics,
  solveCatenary,
  type CatenaryResult,
  type CatenarySolveParams,
  type CumminsSimulationConfig,
  type CumminsSimulationResult,
  type CumminsTimeStepResult,
  type StateSpaceRealization,
} from "./solver/index.js";
export type {
  EnvironmentalConditions,
  FairleadPoint,
  HydrodynamicData,
  HydrodynamicRaoEntry,
  LineSegment,
  MooringLine,
  SimaModel,
  SimulationConfig,
  Vessel,
} from "./types.js";
export {
  DNV_SN_CURVES,
  computeFatigueDamage,
  evaluateOffsetLimits,
  extractTurningPoints,
  rainflowCount,
  verifyDnvMooringCompliance,
  type DnvVerificationReport,
  type FatigueEvaluationParams,
  type FatigueEvaluationResult,
  type LineOffsetCheck,
  type LineVerificationResult,
  type OffsetLimitOptions,
  type OffsetLimitReport,
  type RainflowCycle,
  type SnCurveParameters,
} from "./verification/index.js";
export { SimaWorkspaceIndex } from "./workspace-index.js";

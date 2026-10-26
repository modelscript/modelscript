// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  gtsuiteToDae,
  lowerGtSuiteToDae,
  simulateGtSuiteTransient,
  type GtDaeLoweringResult,
  type GtSimulateOptions,
  type GtSuiteToDaeOptions,
} from "./dae/index.js";
export {
  buildGtSuiteDiagramData,
  renderGtSuiteSchematicSvg,
  type AntvEdge,
  type AntvGraphData,
  type AntvNode,
} from "./diagram/index.js";
export {
  isGtSuiteEngineAvailable,
  runGtSuiteSimulation,
  verifyEngineGates,
  type GtGateCheckResult,
  type GtSuiteEngineOptions,
  type GtVerificationGateOptions,
  type GtVerificationReport,
} from "./engine/index.js";
export { gtsuiteLanguage } from "./language.js";
export { GtSuiteErrorCode, lintGtModel } from "./lints/index.js";
export {
  executeGtsuiteAction,
  getGtsuiteDocumentSymbols,
  getGtsuiteHover,
  validateGtsuite,
  type LspDiagnostic,
  type LspDocumentSymbol,
  type LspHover,
  type LspPosition,
  type LspRange,
} from "./lsp.js";
export { interpolateMap1D, parseGdxTrajectory, parseGtTableMap, parseGtmModel } from "./parser/index.js";
export { gtsuiteToModelica, gtsuiteToSsp, gtsuiteToSysml2 } from "./projections/index.js";
export {
  STANDARD_FUELS,
  calculateCrankSliderKinematics,
  calculateGasProperties,
  calculateWoschniHeatTransfer,
  calculateZeldovichNoxRate,
  evaluateBurnRate,
  evaluateLivengoodWuKnock,
  getFuelProperties,
  type CrankSliderKinematics,
  type FuelProperties,
  type HeatTransferResult,
  type NoxKineticsResult,
} from "./thermo/index.js";
export type {
  GtCombustionModelConfig,
  GtComponent,
  GtComponentKind,
  GtConnection,
  GtCylinderComponent,
  GtDiagnostic,
  GtEnvironmentComponent,
  GtHeatTransferConfig,
  GtInjectorComponent,
  GtIntercoolerComponent,
  GtModel,
  GtPipeComponent,
  GtPlenumComponent,
  GtShaftComponent,
  GtSimulationResult,
  GtSimulationResultPoint,
  GtSimulationSettings,
  GtTableMap,
  GtTurboCompressorComponent,
  GtTurboTurbineComponent,
  GtValveComponent,
} from "./types.js";
export { GtSuiteWorkspaceIndex } from "./workspace-index.js";

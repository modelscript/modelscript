// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  DEFAULT_PUMP_MAP,
  DEFAULT_TURBINE_MAP,
  interpolatePerformanceMap,
  type MapPoint,
} from "./catalog/default-maps.js";
export { ROCETS_MODULE_DESCRIPTORS, getModuleDescriptor, type ModuleDescriptor } from "./catalog/modules.js";
export { lowerRocetsToDae, type RocetsDaeLoweringResult } from "./dae/lowering.js";
export {
  buildRocetsDiagramData,
  renderRocetsPidSvg,
  type AntvEdge,
  type AntvGraphData,
  type AntvNode,
} from "./diagram/index.js";
export { rocetsLanguage } from "./language.js";
export { RocetsErrorCode, lintRocets, type RocetsDiagnostic } from "./lints/index.js";
export { parseRocetsDeck } from "./parser/deck-parser.js";
export { parseRocetsMap } from "./parser/map-parser.js";
export { rocetsToModelica, rocetsToSsp } from "./projections/index.js";
export {
  compileRocetsRoutineStep,
  lowerRocetsRoutineToDae,
  validateRocetsFortranRoutine,
} from "./script/user-routines.js";
export {
  simulateRocetsTransient,
  solveRocetsBalance,
  type RocetsBalanceResult,
  type RocetsTransientPoint,
  type RocetsTransientResult,
} from "./solver/index.js";
export {
  calculateBartzHeatTransfer,
  evaluateCombustionCEA,
  evaluateNozzlePerformance,
  getFluidProperties,
  type CEACombustionResult,
  type FluidProperties,
  type NozzleGasDynamics,
} from "./thermo/index.js";
export type {
  RocetsComponent,
  RocetsConnection,
  RocetsEngineModel,
  RocetsPerformanceMap,
  RocetsPort,
} from "./types.js";
export { RocetsWorkspaceIndex } from "./workspace-index.js";

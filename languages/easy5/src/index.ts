// SPDX-License-Identifier: AGPL-3.0-or-later

export { GP_BLOCK_DESCRIPTORS, getBlockDescriptor, type BlockDescriptor } from "./catalog/gp-library.js";
export { lowerEasy5ToDae, type Easy5DaeLoweringResult } from "./dae/lowering.js";
export {
  buildEasy5DiagramData,
  renderEasy5SchematicSvg,
  renderEasy5SchematicSvg as renderEasy5SvgDiagram,
  type AntvEdge,
  type AntvGraphData,
  type AntvNode,
} from "./diagram/easy5-diagram.js";
export { easy5Language } from "./language.js";
export {
  buildModelEvaluator,
  computeBodePlot,
  computeBodePlot as computeEasy5FrequencyResponse,
  computeEigenvalues,
  linearizeEasy5,
  trimEasy5,
  type EvaluatorContext,
  type TrimResult,
} from "./linear/index.js";
export { Easy5ErrorCode, lintEasy5, type Easy5Diagnostic } from "./lints/index.js";
export { parseEasy5 } from "./parser/easy5-parser.js";
export { parseEasy5Table } from "./parser/table-parser.js";
export { easy5ToModelica, easy5ToSsp } from "./projections/index.js";
export { compileUserComponentStep, lowerUserComponentToDae, validateUserFortranCode } from "./script/user-code.js";
export type {
  BodeChannelData,
  BodePlotData,
  Easy5AnalysisDirectives,
  Easy5Component,
  Easy5Connection,
  Easy5LinearConfig,
  Easy5Model,
  Easy5Port,
  Easy5SimulationConfig,
  Easy5Table,
  LinearSystemModel,
  PortKind,
  SystemEigenvalue,
} from "./types.js";
export { Easy5WorkspaceIndex } from "./workspace-index.js";

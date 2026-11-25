// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Multi-Language Semantic Theory Coordinator & Digital Thread Hypergraph Engine
 * for `HomeSemanticCoordinator.vue` (VitePress Web Showcase).
 *
 * Thin browser adapter delegating to `@modelscript/runtime`'s shared
 * `createPolyglotCoordinator(providers)` so Web Showcase, ModelScript CLI, and VS Code LSP
 * share identical N-ary orchestration, Nelson-Oppen theory propagation, and
 * `DigitalThreadHypergraph` status computation.
 */

import { OpenFoamDialect } from "../../../../../../languages/cfd/src/dialects/openfoam.js";
import { evaluateCfdExpression } from "../../../../../../languages/cfd/src/materializer.js";
import { InpDialect } from "../../../../../../languages/fea/src/dialects/inp.js";
import { evaluateScad } from "../../../../../../languages/scad/src/evaluator.js";
import { scanStepEntities } from "../../../../../../languages/step/src/schema.js";
import { parseUrdf } from "../../../../../../languages/urdf/src/parser/urdf-parser.js";
import { computeMeshVolumeAndArea } from "../../../../../../packages/cad/src/csg-bsp.js";
import { ToleranceStackVerifier } from "../../../../../../packages/cad/src/tolerance-stack.js";
import { SolidKind } from "../../../../../../packages/cad/src/types.js";
import {
  COORDINATOR_SCENARIOS,
  createPolyglotCoordinator,
  type Cfd3DVisualData,
  type CoordinatedVariableLink,
  type CoordinatorEvaluationResult,
  type CoordinatorPaneSpec,
  type CoordinatorPreset,
  type CoordinatorScenario,
  type CsgTreeNodeSummary,
  type DomainFqnBinding,
  type EvaluatedEquationRecord,
  type ExplicitDirectiveLink,
  type ExplicitPortBinding,
  type Fea3DVisualData,
  type HypergraphNodeStatus,
  type ModelicaDaeVisualData,
  type PaneVisualData,
  type ParsedScenarioMetadata,
  type Scad3DVisualData,
  type StepGdtVisualData,
  type SysmlBddVisualData,
  type Urdf3DVisualData,
  type Visual3DTriangle,
} from "../../../../../../packages/runtime/src/interop/polyglot_coordinator_factory.js";
import { LbmVoxelizer } from "../../../../../../packages/simulate/src/cfd/lbm-voxelizer.js";
import { WebGPULbmRunner } from "../../../../../../packages/simulate/src/cfd/webgpu-lbm-runner.js";
import { FeaSolver } from "../../../../../../packages/simulate/src/fea/fea-solver.js";
import { Tet4Mesher } from "../../../../../../packages/simulate/src/fea/tet4-mesher.js";
import { MeshQualityAnalyzer } from "../../../../../../packages/simulate/src/meshing/mesh-quality-analyzer.js";
import { getWasmRuntime, lintSyntaxForLang } from "./workflow-highlighter";

export {
  COORDINATOR_SCENARIOS,
  type Cfd3DVisualData,
  type CoordinatedVariableLink,
  type CoordinatorEvaluationResult,
  type CoordinatorPaneSpec,
  type CoordinatorPreset,
  type CoordinatorScenario,
  type CsgTreeNodeSummary,
  type DomainFqnBinding,
  type EvaluatedEquationRecord,
  type ExplicitDirectiveLink,
  type ExplicitPortBinding,
  type Fea3DVisualData,
  type HypergraphNodeStatus,
  type ModelicaDaeVisualData,
  type PaneVisualData,
  type ParsedScenarioMetadata,
  type Scad3DVisualData,
  type StepGdtVisualData,
  type SysmlBddVisualData,
  type Urdf3DVisualData,
  type Visual3DTriangle,
};

const _coordinator = createPolyglotCoordinator({
  ensureSysmlReady: () => {
    getWasmRuntime("sysml");
  },
  parseScadRoot: (scadCode) => getWasmRuntime("scad")?.parser.parse(scadCode)?.rootNode,
  lintSyntaxForLang,
  OpenFoamDialect,
  evaluateCfdExpression,
  InpDialect,
  evaluateScad,
  scanStepEntities,
  parseUrdf,
  computeMeshVolumeAndArea,
  ToleranceStackVerifier,
  SolidKind,
  LbmVoxelizer,
  WebGPULbmRunner,
  FeaSolver,
  Tet4Mesher,
  MeshQualityAnalyzer,
});

export const { evaluateCoordinatorScenario } = _coordinator;

export const evaluatePolyglotDigitalThreadFromFiles: (
  files: Array<{ uri?: string; fileName: string; content: string; theoryConstraints?: unknown }>,
  explicitScenarioId?: string,
  options?: { symbolIndex?: unknown },
) => {
  scenarioId: string;
  isSat: boolean;
  status: string;
  summaryText: string;
  conflicts: unknown[];
  variableLinks: unknown[];
  hypergraphNodes: unknown[];
} = _coordinator.evaluatePolyglotDigitalThreadFromFiles;

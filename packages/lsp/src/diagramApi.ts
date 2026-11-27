// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Unified Diagram API dispatch layer.
// Routes diagram requests to language-specific backends (Modelica / SysML2 / Generic DSL / Domain builders)
// based on the document URI.

import {
  ModelicaDiagramBackend as ModelicaDiagramBackendCore,
  processDiagramEditBatch as processDiagramEditBatchCore,
  type ModelicaBackendDeps,
} from "@modelscript/modelica/diagram";
import { computeModelicaComponentDropEdits, resolveCrossLanguageComponentDrop } from "./cross-language-drop.js";
import {
  computeMinimalTextEdit,
  deduplicateAndSort,
  type DiagramApplyEditsParams,
  type DiagramApplyEditsResult,
  type DiagramBackend,
} from "./diagramProtocol.js";

export { computeMinimalTextEdit, deduplicateAndSort, type DiagramBackend };
export type { ModelicaBackendDeps };

const lspModelicaCrossLanguageDrop = {
  resolveCrossLanguageComponentDrop,
  computeModelicaComponentDropEdits,
};

export class ModelicaDiagramBackend extends ModelicaDiagramBackendCore {
  constructor(deps: ModelicaBackendDeps) {
    super(deps.crossLanguageDrop ? deps : { ...deps, crossLanguageDrop: lspModelicaCrossLanguageDrop });
  }
}

export function processDiagramEditBatch(
  request: DiagramApplyEditsParams,
  classInstance: Parameters<typeof processDiagramEditBatchCore>[1],
  docText: string,
  unifiedIndex?: Parameters<typeof processDiagramEditBatchCore>[3],
  dropIconOptions?: Parameters<typeof processDiagramEditBatchCore>[4],
): DiagramApplyEditsResult {
  const opts = dropIconOptions?.crossLanguageDrop
    ? dropIconOptions
    : { ...dropIconOptions, crossLanguageDrop: lspModelicaCrossLanguageDrop };
  return processDiagramEditBatchCore(request, classInstance, docText, unifiedIndex, opts);
}

export { Owl2DiagramBackend, type Owl2BackendDeps } from "@modelscript/owl2/diagram";
export { SysML2DiagramBackend, type SysML2BackendDeps } from "@modelscript/sysml2";

export type {
  DiagramDispatchDeps,
  DiagramScopeResolverLike,
  DiagramSymbolIndexLike,
  GenericDiagramConfigLike,
  GenericDSLBackendDeps,
  RawAstDataLike,
} from "./diagram/diagram-api-types.js";
export { maskComments } from "./diagram/diagram-edit-helpers.js";
export { createDiagramDispatch, getUnifiedIndexFromDeps } from "./diagram/domain-diagram-dispatch.js";
export { GenericDSLDiagramBackend } from "./diagram/generic-dsl-diagram-backend.js";

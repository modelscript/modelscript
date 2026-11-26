// SPDX-License-Identifier: AGPL-3.0-or-later

import { createOpenDriveDiagramBackend } from "@modelscript/opendrive";
import { createPscadDiagramBackend as createPscadDiagramBackendCore } from "@modelscript/pscad";
import { createPsseDiagramBackend as createPsseDiagramBackendCore } from "@modelscript/psse";
import { createSimulinkDiagramBackend as createSimulinkDiagramBackendCore } from "@modelscript/simulink";
import { createSpiceDiagramBackend as createSpiceDiagramBackendCore } from "@modelscript/spice";
import { createSspDiagramBackend } from "@modelscript/ssp";
import {
  computePscadComponentDropEdits,
  computeSimulinkComponentDropEdits,
  computeSpiceComponentDropEdits,
  createDropBatchState,
  mergeCoincidentInsertEdits,
  resolveCrossLanguageComponentDrop,
} from "../cross-language-drop.js";
import type { DiagramBackendHost } from "../diagramProtocol.js";

const lspCrossLanguageDrop = {
  createDropBatchState,
  mergeCoincidentInsertEdits,
  computeSpiceComponentDropEdits,
  computeSimulinkComponentDropEdits,
  computePscadComponentDropEdits,
  resolveCrossLanguageComponentDrop,
};

function withCrossLanguageDrop(backends: DiagramBackendHost): DiagramBackendHost {
  return backends.crossLanguageDrop ? backends : { ...backends, crossLanguageDrop: lspCrossLanguageDrop };
}

export { createOpenDriveDiagramBackend, createSspDiagramBackend };

export function createPscadDiagramBackend(backends: DiagramBackendHost) {
  return createPscadDiagramBackendCore(withCrossLanguageDrop(backends));
}

export function createPsseDiagramBackend(backends: DiagramBackendHost) {
  return createPsseDiagramBackendCore(withCrossLanguageDrop(backends));
}

export function createSimulinkDiagramBackend(backends: DiagramBackendHost) {
  return createSimulinkDiagramBackendCore(withCrossLanguageDrop(backends));
}

export function createSpiceDiagramBackend(backends: DiagramBackendHost) {
  return createSpiceDiagramBackendCore(withCrossLanguageDrop(backends));
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { createDiagramDispatch } from "../src/diagramApi.js";
import { registerBuiltinLanguagePlugins } from "../src/registry/builtin-plugins.js";

const SAMPLE_SSD = `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription" name="DriveSystem" version="1.0">
  <ssd:System name="Root">
    <ssd:Elements>
      <ssd:Component name="Controller" source="resources/Controller.fmu" />
      <ssd:Component name="Plant" source="resources/Plant.fmu" />
    </ssd:Elements>
  </ssd:System>
</ssd:SystemStructureDescription>
`;

test("SSP Diagram Dispatch resolves in-memory .ssd documents with builtin plugins registered", async () => {
  registerBuiltinLanguagePlugins({
    workspaceManager: {
      getWorkspaceIndex: () => ({}),
      unifiedWorkspace: { registerWorkspace: () => {} },
    } as never,
  });
  const uri = "file:///document.ssd";

  const dispatchWithDocs = createDiagramDispatch({
    generic: {
      deps: {
        getDocumentText: (targetUri: string) => (targetUri === uri ? SAMPLE_SSD : undefined),
      },
    } as never,
  });

  const dataFromMem = await dispatchWithDocs.getData({ uri });
  assert.ok(dataFromMem, "Expected non-null DiagramData from in-memory .ssd document");
  assert.equal(dataFromMem.nodes.length, 2);
  assert.deepEqual(
    dataFromMem.nodes.map((n) => n.id),
    ["Controller", "Plant"],
  );
  assert.equal(dataFromMem.coordinateSystem?.axesStyle?.visible, false);
  assert.equal(dataFromMem.coordinateSystem?.boundsStyle?.visible, false);

  const dispatchEmpty = createDiagramDispatch({});
  const dataFromParam = await dispatchEmpty.getData({ uri, documentText: SAMPLE_SSD });
  assert.ok(dataFromParam, "Expected non-null DiagramData when documentText is passed directly");
  assert.equal(dataFromParam.nodes.length, 2);
});

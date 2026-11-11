// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { getStepAssemblyModel, indexStepDocument, stepLanguage } from "../src/index.js";

describe("STEP UnifiedWorkspace Indexing and STEP LSP Handlers", () => {
  const sampleUri = "memfs:/drone-meshing/drone.step";
  const sampleText = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Sample Drone'), '2;1');
FILE_NAME('drone.step', '2026-09-30', ('ModelScript'), ('ModelScript'), '', '', '');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#10 = PRODUCT('DroneChassis', 'DroneChassis', '', (#11));
#20 = MANIFOLD_SOLID_BREP('CentralBody', #30);
ENDSEC;
END-ISO-10303-21;`;

  it("indexes STEP products, shapes, and assembly models into UnifiedWorkspace via getIndex()", async () => {
    const ws = new UnifiedWorkspace(stepLanguage);

    assert.strictEqual(ws.hasDocument(sampleUri), false);
    assert.strictEqual(ws.getFileIndex(sampleUri), undefined);

    const initialRev = ws.version;
    ws.setDocument(sampleUri, sampleText);
    assert.ok(ws.version > initialRev);
    assert.strictEqual(ws.hasDocument(sampleUri), true);

    const fileIndex = ws.getFileIndex(sampleUri);
    assert.ok(fileIndex);
    assert.ok(fileIndex.symbols.size > 0);
    assert.ok(ws.getIndex().byName.has("DroneChassis"));
    assert.ok(ws.getIndex().byName.has("CentralBody"));
    assert.ok(getStepAssemblyModel(ws, sampleUri));

    const buffer = new TextEncoder().encode(sampleText);
    const asyncIndex = await indexStepDocument(ws, sampleUri, buffer);
    assert.ok(asyncIndex.symbols.size > 0);
  });

  it("returns meshes from modelscript/getStepMeshes handler for STEP files", async () => {
    const ws = new UnifiedWorkspace(stepLanguage);
    ws.setDocument(sampleUri, sampleText);
    const mockContext = {
      workspaceManager: {
        unifiedWorkspace: ws,
      },
      documentManager: {
        documentTrees: new Map([[sampleUri, { text: sampleText }]]),
      },
    };

    const handler = (stepLanguage as any)?.lsp?.handlers?.["modelscript/getStepMeshes"];
    assert.strictEqual(typeof handler, "function");

    const meshes = await handler(mockContext, { uri: sampleUri });
    assert.ok(Array.isArray(meshes));
    assert.ok(meshes.length > 0, "Expected at least one mesh to be returned");
    assert.strictEqual(meshes[0].name, "CentralBody");
    assert.ok(meshes[0].vertices.length > 0);
    assert.ok(meshes[0].indices.length > 0);
  });
});

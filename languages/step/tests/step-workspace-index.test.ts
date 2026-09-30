// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { stepLanguage } from "../src/language.js";
import { StepWorkspaceIndex } from "../src/workspace-index.js";

describe("StepWorkspaceIndex and STEP LSP Handlers", () => {
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

  it("implements IWorkspaceIndex with has, getFileIndex, register, and reindexDocument", async () => {
    const index = new StepWorkspaceIndex();

    assert.strictEqual(typeof index.has, "function");
    assert.strictEqual(typeof index.getFileIndex, "function");
    assert.strictEqual(typeof index.register, "function");
    assert.strictEqual(typeof index.reindexDocument, "function");

    assert.strictEqual(index.has(sampleUri), false);
    assert.strictEqual(index.getFileIndex(sampleUri), undefined);

    index.register(sampleUri);
    assert.strictEqual(index.has(sampleUri), true);
    assert.ok(index.getFileIndex(sampleUri));

    const initialRev = index.version;
    index.reindexDocument(sampleUri);
    assert.ok(index.version > initialRev);

    // Parse actual content
    const buffer = new TextEncoder().encode(sampleText);
    await index.parseStepFile(sampleUri, buffer);

    assert.strictEqual(index.has(sampleUri), true);
    const fileIndex = index.getFileIndex(sampleUri);
    assert.ok(fileIndex);
    assert.ok(fileIndex.symbols.size > 0);
  });

  it("returns meshes from modelscript/getStepMeshes handler for STEP files", async () => {
    const wsIndex = new StepWorkspaceIndex();
    const mockContext = {
      workspaceManager: {
        stepWorkspaceIndex: wsIndex,
        getWorkspaceIndex: (id: string) => (id === "step" ? wsIndex : null),
        unifiedWorkspace: {
          toUnifiedPartial: () => wsIndex.toUnified(),
        },
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

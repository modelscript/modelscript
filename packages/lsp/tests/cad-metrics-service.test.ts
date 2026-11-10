// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "assert";
import test, { describe } from "node:test";
import { CadMetricsService } from "../src/services/cad-metrics-service.js";

import { TextDocument } from "vscode-languageserver-textdocument";
import { ValidationService } from "../src/services/validation-service.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";

describe("CadMetricsService: Off-Thread / Cached 3D CSG Evaluation", () => {
  test("computes and memoizes OpenSCAD CSG metrics by content hash", async () => {
    const service = new CadMetricsService();
    const uri = "file:///workspace/cad/bracket.scad";
    const scadCode = `wall_t = 2.0;
cube([10, 20, 30]);
`;
    const doc = TextDocument.create(uri, "scad", 1, scadCode);
    const mockDocManager: any = {
      documents: new Map([[uri, doc]]),
      documentTrees: new Map(),
    };
    const mockParserService: any = {
      getSharedCstTreeWrapper: () => null,
      facade: null,
      sharedContext: null,
    };
    const wm = new WorkspaceManager();
    const vs = new ValidationService(
      {
        sendDiagnostics: () => {},
        sendNotification: () => {},
        console: { warn: () => {}, error: () => {}, info: () => {}, log: () => {} },
      } as any,
      mockDocManager,
      wm,
      mockParserService,
    );
    await vs.validateTextDocument(doc);
    const mockRootNode = mockDocManager.documentTrees.get(uri)?.tree?.rootNode;
    assert.ok(mockRootNode, "Parsed rootNode must be present");

    let refreshed = false;
    const mockConnection: any = {
      sendRequest: async (method: string) => {
        if (method === "workspace/codeLens/refresh") {
          refreshed = true;
        }
      },
    };

    // First call: cold compute
    const initialTitle = service.getOrSchedule(uri, scadCode, mockRootNode, mockConnection);
    assert.ok(initialTitle, "Initial title must be returned");
    assert.ok(initialTitle.includes("Volume: 6000.0 mm³"), "Title must contain correct volume");
    assert.ok(initialTitle.includes("Frontal Area: A ="), "Title must contain frontal area");

    // Second call: exact cache hit (same content hash)
    const cachedTitle = service.getOrSchedule(uri, scadCode, mockRootNode, mockConnection);
    assert.strictEqual(cachedTitle, initialTitle, "Second call must return cached title instantly");

    // Content change: schedule background evaluation and return stale title
    const modifiedCode = scadCode + "\n// modified";
    const staleTitle = service.getOrSchedule(uri, modifiedCode, mockRootNode, mockConnection);
    assert.strictEqual(staleTitle, initialTitle, "Must return stale-while-revalidate title during background update");

    // Await background evaluation debounce and microtask
    await new Promise((r) => setTimeout(r, 260));
    assert.ok(refreshed, "Must notify client via workspace/codeLens/refresh upon background completion");

    // Cleanup
    service.disposeDocument(uri);
    service.clear();
  });

  test("returns digital thread fallback when tree is not yet available", () => {
    const service = new CadMetricsService();
    const uri = "file:///workspace/cad/chassis.scad";
    const scadCode = "sphere(r=5);";

    const title = service.getOrSchedule(
      uri,
      scadCode,
      null,
      undefined,
      { frontalArea: 0.125, mass: 1.45 },
      { syncFallback: false },
    );

    assert.ok(title, "Fallback title must be returned");
    assert.ok(title.includes("0.125 m²"), "Title must contain fallback frontal area");
    assert.ok(title.includes("1.45 kg"), "Title must contain fallback mass");
  });
});

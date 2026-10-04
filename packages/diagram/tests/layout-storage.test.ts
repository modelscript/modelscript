// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createEmptyLayout,
  InlineAnnotationLayoutStorage,
  MemoryFsBridge,
  parseLayout,
  resolveSidecarUri,
  serializeLayout,
  SidecarLayoutStorage,
} from "../src/layout-storage.js";

describe("Pluggable Diagram Layout Storage", () => {
  it("should create and serialize empty layout", () => {
    const layout = createEmptyLayout();
    assert.strictEqual(layout.version, 1);
    assert.deepStrictEqual(layout.elements, {});

    const json = serializeLayout(layout);
    const parsed = parseLayout(json);
    assert.ok(parsed);
    assert.strictEqual(parsed.version, 1);
  });

  it("should resolve sidecar URIs with various extensions and locations", () => {
    const uri = "file:///workspace/Model.sysml";

    // Default alongside
    assert.strictEqual(resolveSidecarUri(uri), "file:///workspace/Model.sysml.layout");

    // Custom extension
    assert.strictEqual(
      resolveSidecarUri(uri, { extension: ".layout.json" }),
      "file:///workspace/Model.sysml.layout.json",
    );

    // Hidden location
    assert.strictEqual(
      resolveSidecarUri(uri, { location: "hidden", extension: ".layout" }),
      "file:///workspace/.Model.sysml.layout",
    );

    // Subfolder location
    assert.strictEqual(
      resolveSidecarUri(uri, { location: "subfolder", extension: ".layout" }),
      "file:///workspace/.layouts/Model.sysml.layout",
    );

    // Custom function
    assert.strictEqual(
      resolveSidecarUri(uri, { location: (u, ext) => `${u}-visual${ext}` }),
      "file:///workspace/Model.sysml-visual.layout",
    );
  });

  it("should update element positions and connection vertices in SidecarLayoutStorage with MemoryFsBridge", async () => {
    const fsBridge = new MemoryFsBridge();
    const storage = new SidecarLayoutStorage({ fsBridge });
    const uri = "inmemory://test.sysml";

    const { layout } = await storage.updatePositions(uri, [
      {
        name: "engine",
        x: 100,
        y: 200,
        width: 120,
        height: 80,
        edges: [
          {
            source: "engine.power",
            target: "trans.in",
            points: [
              { x: 100, y: 200 },
              { x: 150, y: 200 },
            ],
          },
        ],
      },
    ]);

    assert.ok(layout);
    assert.strictEqual(layout.elements.engine.x, 100);
    assert.strictEqual(layout.elements.engine.y, 200);
    assert.strictEqual(layout.connections["engine.power→trans.in"].vertices.length, 2);

    // Verify it was written to the fsBridge
    const saved = await fsBridge.readFile("inmemory://test.sysml.layout");
    assert.ok(saved);
    assert.ok(saved.includes('"engine"'));
  });

  it("should synchronize element rename and update connection endpoints", async () => {
    const fsBridge = new MemoryFsBridge();
    const storage = new SidecarLayoutStorage({ fsBridge });
    const uri = "file:///workspace/System.sysml";

    await storage.updatePositions(uri, [
      {
        name: "Vehicle",
        x: 300,
        y: 400,
        width: 160,
        height: 50,
        edges: [
          {
            source: "Vehicle.chassis",
            target: "Engine.mount",
            points: [
              { x: 300, y: 400 },
              { x: 500, y: 400 },
            ],
          },
        ],
      },
      {
        name: "Engine",
        x: 550,
        y: 400,
      },
    ]);

    // Rename "Vehicle" to "Automobile"
    const renamed = await storage.renameElement(uri, "Vehicle", "Automobile");
    assert.strictEqual(renamed, true);

    const updated = await storage.loadLayout(uri);
    assert.ok(updated);
    assert.strictEqual(updated.elements.Vehicle, undefined);
    assert.ok(updated.elements.Automobile);
    assert.strictEqual(updated.elements.Automobile.x, 300);
    assert.strictEqual(updated.elements.Automobile.y, 400);
    assert.strictEqual(updated.elements.Automobile.previousName, "Vehicle");

    // Connection key must have been rewritten
    assert.strictEqual(updated.connections["Vehicle.chassis→Engine.mount"], undefined);
    assert.ok(updated.connections["Automobile.chassis→Engine.mount"]);
    assert.strictEqual(updated.connections["Automobile.chassis→Engine.mount"].vertices.length, 2);
  });

  it("should prune orphaned elements and connections cleanly", async () => {
    const fsBridge = new MemoryFsBridge();
    const storage = new SidecarLayoutStorage({ fsBridge });
    const uri = "file:///workspace/Prune.sysml";

    await storage.updatePositions(uri, [
      {
        name: "AliveNode",
        x: 10,
        y: 20,
        edges: [{ source: "AliveNode.p", target: "DeadNode.p", points: [] }],
      },
      {
        name: "DeadNode",
        x: 50,
        y: 60,
      },
    ]);

    // Prune so only "AliveNode" is active
    const { prunedCount, layout } = await storage.pruneOrphans(uri, ["AliveNode"]);
    assert.strictEqual(prunedCount, 1);
    assert.ok(layout);
    assert.ok(layout.elements.AliveNode);
    assert.strictEqual(layout.elements.DeadNode, undefined);
    // Connection to DeadNode should be pruned as well
    assert.deepStrictEqual(layout.connections, {});
  });

  it("should delegate to editComputer in InlineAnnotationLayoutStorage", async () => {
    let capturedUri = "";
    let capturedCount = 0;

    const storage = new InlineAnnotationLayoutStorage(async (uri, items) => {
      capturedUri = uri;
      capturedCount = items.length;
      return [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "annotation" }];
    });

    const res = await storage.updatePositions("file:///test.mo", [{ name: "resistor", x: 50, y: 50 }]);

    assert.strictEqual(capturedUri, "file:///test.mo");
    assert.strictEqual(capturedCount, 1);
    assert.strictEqual(res.edits?.length, 1);
  });
});

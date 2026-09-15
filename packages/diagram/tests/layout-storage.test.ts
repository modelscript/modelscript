// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createEmptyLayout,
  InlineAnnotationLayoutStorage,
  parseLayout,
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

  it("should update element positions and connection vertices in SidecarLayoutStorage", async () => {
    const storage = new SidecarLayoutStorage();
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

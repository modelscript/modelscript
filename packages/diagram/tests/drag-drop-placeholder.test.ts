// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { dropComponentGhost, ensureDiagramStyles } from "../src/drop-placeholder.js";

test("Drag and Drop Component Placeholder & Bounce Animation Suite", async (t) => {
  await t.test("should ensure bounce animation style keyframes are defined", () => {
    // In Node.js environment without DOM, ensureDiagramStyles handles undefined document safely
    assert.doesNotThrow(() => {
      ensureDiagramStyles();
    });

    // Mock document to verify keyframe generation
    const mockStyle: any = { id: "", textContent: "" };
    const mockDocument: any = {
      getElementById: (id: string) => (mockStyle.id === id ? mockStyle : null),
      createElement: (tag: string) => {
        if (tag === "style") return mockStyle;
        return {};
      },
      head: {
        appendChild: (el: any) => {
          mockStyle.id = el.id;
          mockStyle.textContent = el.textContent;
        },
      },
    };

    (globalThis as any).document = mockDocument;
    try {
      ensureDiagramStyles();
      assert.strictEqual(mockStyle.id, "modelscript-diagram-animations");
      assert.match(mockStyle.textContent, /@keyframes drop-placeholder-bounce/);
      assert.match(mockStyle.textContent, /@keyframes drop-placeholder-pulse/);
      assert.match(mockStyle.textContent, /transform:\s*scale\(1\.18\)/);
    } finally {
      delete (globalThis as any).document;
    }
  });

  await t.test("should create placeholder image node with bounce animation on drop with SVG icon", () => {
    const addedNodes: any[] = [];
    const removedCells: any[] = [];
    const mockGraph: any = {
      getCellById: (id: string) => {
        if (id === "__drop_placeholder__" || id === "placement-ghost") {
          return { id, isNode: () => true };
        }
        return null;
      },
      removeCell: (cell: any) => {
        removedCells.push(cell.id);
      },
      addNode: (node: any) => {
        addedNodes.push(node);
        return node;
      },
    };

    const iconSvg = '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="blue"/></svg>';
    dropComponentGhost(mockGraph, 150, 200, "Modelica.Electrical.Analog.Basic.Resistor", iconSvg, false, 40, 40);

    // Old placeholder and ghost should be cleaned up
    assert.ok(removedCells.includes("__drop_placeholder__"));
    assert.ok(removedCells.includes("placement-ghost"));

    // One new placeholder node added
    assert.strictEqual(addedNodes.length, 1);
    const node = addedNodes[0];
    assert.strictEqual(node.id, "__drop_placeholder__");
    assert.strictEqual(node.shape, "image");
    assert.strictEqual(node.x, 150 - 20);
    assert.strictEqual(node.y, 200 - 20);
    assert.strictEqual(node.width, 40);
    assert.strictEqual(node.height, 40);
    assert.ok(node.imageUrl.startsWith("data:image/svg+xml;utf8,"));
    assert.match(node.attrs.image.style, /drop-placeholder-bounce/);
    assert.match(node.attrs.image.style, /transform-origin:\s*center center/);
  });

  await t.test("should fallback to styled rectangular placeholder when SVG is missing", () => {
    const addedNodes: any[] = [];
    const mockGraph: any = {
      getCellById: () => null,
      removeCell: () => {},
      addNode: (node: any) => {
        addedNodes.push(node);
        return node;
      },
    };

    dropComponentGhost(mockGraph, 80, 120, "Modelica.Blocks.Sources.Sine", null, true, 40, 40);

    assert.strictEqual(addedNodes.length, 1);
    const node = addedNodes[0];
    assert.strictEqual(node.id, "__drop_placeholder__");
    assert.strictEqual(node.shape, "rect");
    assert.strictEqual(node.x, 80 - 20);
    assert.strictEqual(node.y, 120 - 20);
    assert.strictEqual(node.attrs.text.text, "Sine");
    assert.match(node.attrs.body.style, /drop-placeholder-bounce/);
  });
});

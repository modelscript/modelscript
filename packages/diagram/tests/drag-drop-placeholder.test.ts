// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  DROP_BOUNCE_DURATION_MS,
  clearActiveDropPlaceholder,
  dropComponentGhost,
  ensureDiagramStyles,
  getActiveDropPlaceholder,
  getTypicalNodeSize,
} from "../src/drop-placeholder.js";
import * as Spinner from "../src/spinner.js";

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
      assert.match(mockStyle.textContent, /transform-box:\s*fill-box\s*!important/);
      assert.match(mockStyle.textContent, /transform-origin:\s*center center\s*!important/);
    } finally {
      delete (globalThis as any).document;
    }
  });

  await t.test("should dynamically calculate typical node size or default to 20x20", () => {
    assert.strictEqual(DROP_BOUNCE_DURATION_MS, 240);

    // Empty graph defaults to 20x20
    assert.deepStrictEqual(getTypicalNodeSize({}), { width: 20, height: 20 });
    assert.deepStrictEqual(getTypicalNodeSize({ getNodes: () => [] }), { width: 20, height: 20 });

    // Graph with ephemeral nodes only (background, axes) defaults to 20x20
    const mockGraphWithEphemeral = {
      getNodes: () => [
        { id: "__diagram_background__", getSize: () => ({ width: 1000, height: 800 }) },
        { id: "__diagram_axes__", getSize: () => ({ width: 1000, height: 800 }) },
        { id: "solder_dot_1", getSize: () => ({ width: 4, height: 4 }) },
      ],
    };
    assert.deepStrictEqual(getTypicalNodeSize(mockGraphWithEphemeral), { width: 20, height: 20 });

    // Graph with Modelica components (e.g. R, L, C all 20x20) returns 20x20
    const mockGraphModelica = {
      getNodes: () => [
        { id: "__diagram_background__", getSize: () => ({ width: 1000, height: 800 }) },
        { id: "R1", getSize: () => ({ width: 20, height: 20 }) },
        { id: "C1", getSize: () => ({ width: 20, height: 20 }) },
        { id: "L1", getSize: () => ({ width: 20, height: 20 }) },
      ],
    };
    assert.deepStrictEqual(getTypicalNodeSize(mockGraphModelica), { width: 20, height: 20 });

    // Graph with SysML blocks (e.g. 120x60) returns 120x60
    const mockGraphSysML = {
      getNodes: () => [
        { id: "Block1", getSize: () => ({ width: 120, height: 60 }) },
        { id: "Block2", getSize: () => ({ width: 120, height: 60 }) },
      ],
    };
    assert.deepStrictEqual(getTypicalNodeSize(mockGraphSysML), { width: 120, height: 60 });
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
      getNodes: () => [{ id: "R1", getSize: () => ({ width: 20, height: 20 }) }],
    };

    const iconSvg = '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="blue"/></svg>';
    // Call without explicit width/height to verify it uses typical node size (20x20)
    dropComponentGhost(mockGraph, 150, 200, "Modelica.Electrical.Analog.Basic.Resistor", iconSvg, false);

    // Old placeholder and ghost should be cleaned up
    assert.ok(removedCells.includes("__drop_placeholder__"));
    assert.ok(removedCells.includes("placement-ghost"));

    // One new placeholder node added
    assert.strictEqual(addedNodes.length, 1);
    const node = addedNodes[0];
    assert.strictEqual(node.id, "__drop_placeholder__");
    assert.strictEqual(node.shape, "image");
    assert.strictEqual(node.x, 150 - 10);
    assert.strictEqual(node.y, 200 - 10);
    assert.strictEqual(node.width, 20);
    assert.strictEqual(node.height, 20);
    assert.strictEqual(node.zIndex, 9999);
    assert.ok(node.imageUrl.startsWith("data:image/svg+xml;utf8,"));
    assert.match(node.attrs.image.style, /drop-placeholder-bounce/);
    assert.match(node.attrs.image.style, /transform-box:\s*fill-box/);
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
      getNodes: () => [],
    };

    dropComponentGhost(mockGraph, 80, 120, "Modelica.Blocks.Sources.Sine", null, true);

    assert.strictEqual(addedNodes.length, 1);
    const node = addedNodes[0];
    assert.strictEqual(node.id, "__drop_placeholder__");
    assert.strictEqual(node.shape, "rect");
    assert.strictEqual(node.x, 80 - 10);
    assert.strictEqual(node.y, 120 - 10);
    assert.strictEqual(node.width, 20);
    assert.strictEqual(node.height, 20);
    assert.strictEqual(node.attrs.text.text, "Sine");
    assert.match(node.attrs.body.style, /drop-placeholder-bounce/);
    assert.match(node.attrs.body.style, /transform-box:\s*fill-box/);
  });

  await t.test("should track active drop placeholder and clear it properly", () => {
    const mockGraph: any = {
      getCellById: () => null,
      removeCell: () => {},
      addNode: (node: any) => node,
      getNodes: () => [],
    };

    dropComponentGhost(mockGraph, 100, 150, "Modelica.Electrical.Analog.Basic.Capacitor", "<svg></svg>", false);
    const active = getActiveDropPlaceholder();
    assert.ok(active !== null);
    assert.strictEqual(active?.x, 100);
    assert.strictEqual(active?.y, 150);
    assert.strictEqual(active?.className, "Modelica.Electrical.Analog.Basic.Capacitor");

    clearActiveDropPlaceholder();
    assert.strictEqual(getActiveDropPlaceholder(), null);
  });

  await t.test("should debounce spinner to avoid flicker on fast operations", async () => {
    const mockSpinnerEl: any = { style: { display: "none" } };
    (globalThis as any).document = {
      getElementById: (id: string) => (id === "spinner" ? mockSpinnerEl : null),
    };

    try {
      // 1. Calling show() then immediate hide() (< 160ms) should never make spinner visible
      Spinner.show();
      assert.strictEqual(mockSpinnerEl.style.display, "none");
      Spinner.hide();
      assert.strictEqual(mockSpinnerEl.style.display, "none");

      // 2. Calling show() and waiting >= 170ms should make spinner visible
      Spinner.show();
      await new Promise((r) => setTimeout(r, 180));
      assert.strictEqual(mockSpinnerEl.style.display, "block");

      // 3. Calling hide() after it is visible should enforce minimum display time and then hide
      Spinner.hide();
      // Initially still visible due to minimum display time
      assert.strictEqual(mockSpinnerEl.style.display, "block");
      await new Promise((r) => setTimeout(r, 270));
      assert.strictEqual(mockSpinnerEl.style.display, "none");
    } finally {
      delete (globalThis as any).document;
    }
  });
});

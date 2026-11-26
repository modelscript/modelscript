// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileGlyphMarkup } from "@modelscript/canvas/engine";
import assert from "node:assert";
import test from "node:test";
import { attachPlacementAndWireTools } from "../src/canvas-placement-wire.js";
import {
  DROP_BOUNCE_DURATION_MS,
  clearActiveDropPlaceholder,
  dropComponentGhost,
  ensureDiagramStyles,
  getActiveDropPlaceholder,
  getTypicalNodeSize,
  parseIconSvgToMarkup,
} from "../src/drop-placeholder.js";
import * as Spinner from "../src/spinner.js";
import { performViewportCulling } from "../src/viewport-culling.js";

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
      assert.doesNotMatch(mockStyle.textContent, /\.modelscript-anchor-halo\s*\{[^}]*stroke:\s*#06b6d4/);
      assert.match(
        mockStyle.textContent,
        /\.modelscript-anchor-halo text,\s*\.modelscript-anchor-halo tspan\s*\{[^}]*stroke:\s*none\s*!important;/,
      );
      assert.match(
        mockStyle.textContent,
        /\.ms-lod-low text,\s*\.ms-lod-low tspan\s*\{[^}]*display:\s*none\s*!important;/,
      );
      assert.match(mockStyle.textContent, /\.ms-lod-minimal \.ms-port\s*\{[^}]*display:\s*none\s*!important;/);
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
    assert.ok(Array.isArray(node.markup), "drop placeholder must provide inline SVG markup");
    assert.strictEqual(node.markup[0].tagName, "svg");
    assert.strictEqual(node.markup[0].selector, "image");
    assert.strictEqual(node.markup[0].attrs.viewBox, "0 0 100 100");
    assert.strictEqual(node.markup[0].children?.[0]?.tagName, "rect");
    assert.strictEqual(node.markup[0].children?.[0]?.attrs?.fill, "blue");
    assert.match(node.attrs.image.style, /drop-placeholder-bounce/);
    assert.match(node.attrs.image.style, /transform-box:\s*fill-box/);
    assert.match(node.attrs.image.style, /transform-origin:\s*center center/);
  });

  await t.test("parseIconSvgToMarkup converts PSSE SVG icons into sanitized DiagramMarkupNode trees", () => {
    const psseSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" onclick="alert(1)"><circle cx="32" cy="30" r="22" fill="#eff6ff" stroke="#1d4ed8" stroke-width="2.5"/><path d="M 18 30 Q 25 18 32 30 T 46 30" fill="none" stroke="#1d4ed8" stroke-width="2.5"/><text x="32" y="61" text-anchor="middle" fill="#1e3a8a">GENROU</text></svg>';
    const markup = parseIconSvgToMarkup(psseSvg, 40, 40);
    assert.ok(markup && markup.length === 1);
    const root = markup[0]!;
    assert.strictEqual(root.tagName, "svg");
    assert.strictEqual(root.selector, "image");
    assert.strictEqual(root.attrs?.width, 40);
    assert.strictEqual(root.attrs?.height, 40);
    assert.strictEqual(root.attrs?.viewBox, "0 0 64 64");
    assert.strictEqual(root.attrs?.onclick, undefined, "inline event handlers must be stripped");
    assert.strictEqual(root.children?.length, 3);
    assert.strictEqual(root.children?.[0]?.tagName, "circle");
    assert.strictEqual(root.children?.[1]?.tagName, "path");
    assert.strictEqual(root.children?.[2]?.tagName, "text");
    assert.strictEqual(root.children?.[2]?.textContent, "GENROU");

    assert.strictEqual(parseIconSvgToMarkup("", 40, 40), null);
    assert.strictEqual(parseIconSvgToMarkup("<div>not svg</div>", 40, 40), null);
  });

  await t.test("placement-ghost renders dragged SVG icon markup instead of default black rect", () => {
    const addedNodes: any[] = [];
    const handlers = new Map<string, (...args: any[]) => void>();
    const mockGraph: any = {
      on: (event: string, fn: (...args: any[]) => void) => handlers.set(event, fn),
      getNodes: () => [{ id: "GEN1", getSize: () => ({ width: 48, height: 48 }) }],
      getCellById: () => null,
      addNode: (node: any) => {
        const created = {
          ...node,
          remove: () => {},
          getSize: () => ({ width: node.width, height: node.height }),
          position: () => {},
        };
        addedNodes.push(created);
        return created;
      },
    };

    const prevWindow = (globalThis as any).window;
    const mockWin: any = {
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    (globalThis as any).window = mockWin;
    try {
      const controller = attachPlacementAndWireTools({
        graph: mockGraph,
        isDark: false,
        startInlineNodeEdit: () => {},
      });
      const psseSvg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="30" r="22" fill="#eff6ff" stroke="#1d4ed8"/></svg>';
      mockWin.__startPlacement({
        className: "psse:generator",
        classKind: "Component",
        iconSvg: psseSvg,
        isDrag: true,
      });
      mockWin.__movePlacementGhost(200, 160, { buttons: 1 });

      assert.strictEqual(addedNodes.length, 1);
      const ghost = addedNodes[0];
      assert.strictEqual(ghost.id, "placement-ghost");
      assert.ok(Array.isArray(ghost.markup), "placement-ghost must supply inline SVG markup");
      assert.strictEqual(ghost.markup[0].tagName, "svg");
      assert.strictEqual(ghost.markup[0].children?.[0]?.tagName, "circle");

      // Verify the canvas glyph compiler produces the dragged SVG icon rather than the default #1e293b rect
      const compiled = compileGlyphMarkup(ghost.markup, ghost.attrs, ghost.width, ghost.height);
      assert.strictEqual(compiled.roots[0]?.tagName, "svg");
      assert.strictEqual(compiled.roots[0]?.children[0]?.tagName, "circle");
      assert.strictEqual(compiled.roots[0]?.children[0]?.attrs.fill, "#eff6ff");

      controller.dispose();
    } finally {
      if (prevWindow === undefined) {
        delete (globalThis as any).window;
      } else {
        (globalThis as any).window = prevWindow;
      }
    }
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

  await t.test("performViewportCulling should cull offscreen SVG nodes when graph has >250 nodes", () => {
    const nodeElements: Record<string, { style: { visibility: string } }> = {};
    const nodes = [];

    // Create 260 nodes
    for (let i = 0; i < 260; i++) {
      const id = `node_${i}`;
      nodeElements[id] = { style: { visibility: "" } };
      // Node 0 is on-screen at (100, 100)
      // Node 259 is far off-screen at (5000, 5000)
      const x = i === 259 ? 5000 : 100 + (i % 5) * 40;
      const y = i === 259 ? 5000 : 100 + Math.floor(i / 5) * 40;
      nodes.push({
        id,
        getPosition: () => ({ x, y }),
        getSize: () => ({ width: 30, height: 30 }),
      });
    }

    const mockGraph: any = {
      container: { clientWidth: 800, clientHeight: 600 },
      getNodes: () => nodes,
      scale: () => ({ sx: 1, sy: 1 }),
      translate: () => ({ tx: 0, ty: 0 }),
      findViewByCell: (n: any) => ({ container: nodeElements[n.id] }),
    };

    (globalThis as any).document = {
      querySelector: (selector: string) => {
        const match = selector.match(/data-cell-id="([^"]+)"/);
        return match ? nodeElements[match[1]!] : null;
      },
    };

    try {
      performViewportCulling(mockGraph);
      // Node 0 should be visible
      assert.strictEqual(nodeElements["node_0"]?.style.visibility, "");
      // Node 259 is at 5000, 5000 and should be culled (visibility: hidden)
      assert.strictEqual(nodeElements["node_259"]?.style.visibility, "hidden");

      // Verify that graphs with <= 250 nodes do not trigger culling
      const smallMockGraph: any = {
        container: { clientWidth: 800, clientHeight: 600 },
        getNodes: () => nodes.slice(0, 100),
        scale: () => ({ sx: 1, sy: 1 }),
        translate: () => ({ tx: 0, ty: 0 }),
        findViewByCell: (n: any) => ({ container: nodeElements[n.id] }),
      };
      nodeElements["node_99"] = { style: { visibility: "" } };
      performViewportCulling(smallMockGraph);
      assert.strictEqual(nodeElements["node_99"]?.style.visibility, "");
    } finally {
      delete (globalThis as any).document;
    }
  });

  await t.test("should adapt drop placeholder SVG colors in dark mode", () => {
    const addedNodes: any[] = [];
    const mockGraph: any = {
      getCellById: () => null,
      removeCell: () => {},
      addNode: (node: any) => {
        addedNodes.push(node);
        return node;
      },
      getNodes: () => [{ id: "R1", getSize: () => ({ width: 20, height: 20 }) }],
    };

    const rawBlackStrokeSvg =
      '<svg viewBox="0 0 100 100"><line x1="0" y1="0" x2="100" y2="100" stroke="#000000" fill="#ffffff"/></svg>';
    dropComponentGhost(mockGraph, 50, 60, "Modelica.Electrical.Analog.Basic.Resistor", rawBlackStrokeSvg, true);

    assert.strictEqual(addedNodes.length, 1);
    const decoded = decodeURIComponent(addedNodes[0].imageUrl.replace("data:image/svg+xml;utf8,", ""));
    assert.ok(!decoded.includes('stroke="#000000"'), "Dark-mode drop placeholder must invert pure black strokes");
    clearActiveDropPlaceholder();
  });
});

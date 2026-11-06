// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ensureMinimapHud, toggleMinimapHud, updateMinimapHud, type MinimapGraph } from "../src/minimap.js";

describe("CAD Interactive Minimap HUD", () => {
  let origDocument: any;

  beforeEach(() => {
    origDocument = (globalThis as any).document;
  });

  afterEach(() => {
    (globalThis as any).document = origDocument;
  });

  function createMockElement(tag: string): any {
    const children: any[] = [];
    const listeners: Record<string, ((...args: unknown[]) => unknown)[]> = {};
    const attrs: Record<string, string> = {};
    const style: Record<string, string> = {};

    return {
      tagName: tag.toUpperCase(),
      id: "",
      className: "",
      style,
      innerHTML: "",
      textContent: "",
      viewBox: { baseVal: { x: 0, y: 0, width: 200, height: 150 } },
      children,
      appendChild(child: any) {
        children.push(child);
        return child;
      },
      querySelector(sel: string) {
        if (sel === "#minimap-svg" || sel === "svg") {
          return children.find((c) => c.id === "minimap-svg");
        }
        if (sel === "#modelscript-minimap-hud") {
          return children.find((c) => c.id === "modelscript-minimap-hud");
        }
        return null;
      },
      setAttribute(name: string, val: string) {
        attrs[name] = val;
      },
      getAttribute(name: string) {
        return attrs[name];
      },
      addEventListener(evt: string, fn: (...args: unknown[]) => unknown) {
        if (!listeners[evt]) listeners[evt] = [];
        listeners[evt]!.push(fn);
      },
      dispatchEvent(evt: { type: string; [key: string]: any }) {
        const fns = listeners[evt.type] || [];
        for (const fn of fns) fn(evt);
      },
      getBoundingClientRect() {
        return { left: 10, top: 20, width: 180, height: 100 };
      },
      setPointerCapture() {},
      releasePointerCapture() {},
    };
  }

  it("handles undefined document safely in headless environments", () => {
    (globalThis as any).document = undefined;
    const mockContainer: any = createMockElement("div");
    assert.strictEqual(
      ensureMinimapHud(mockContainer, () => {}),
      null,
    );
    assert.strictEqual(toggleMinimapHud(mockContainer), false);
  });

  it("creates and attaches minimap DOM hierarchy", () => {
    const mockDoc = {
      createElement: (tag: string) => createMockElement(tag),
      createElementNS: (_ns: string, tag: string) => createMockElement(tag),
    };
    (globalThis as any).document = mockDoc;

    let centeredX = 0;
    let centeredY = 0;
    const mockContainer = createMockElement("div");

    const hud = ensureMinimapHud(mockContainer, (x, y) => {
      centeredX = x;
      centeredY = y;
    });

    assert.ok(hud);
    assert.strictEqual(hud.id, "modelscript-minimap-hud");
    assert.strictEqual(hud.className, "modelscript-minimap-hud");
    assert.strictEqual(mockContainer.children.length, 1);

    // Clicking / pointer panning navigates the camera
    const svg = hud.querySelector("#minimap-svg");
    assert.ok(svg);
    svg.dispatchEvent({ type: "pointerdown", clientX: 100, clientY: 70, pointerId: 1 });
    assert.ok(centeredX > 0);
    assert.ok(centeredY > 0);
  });

  it("toggles minimap visibility state", () => {
    const mockDoc = {
      createElement: (tag: string) => createMockElement(tag),
      createElementNS: (_ns: string, tag: string) => createMockElement(tag),
    };
    (globalThis as any).document = mockDoc;

    const mockContainer = createMockElement("div");
    const hud = ensureMinimapHud(mockContainer, () => {});
    assert.ok(hud);

    // Initial state is flex (visible)
    assert.strictEqual(hud.style.display, "flex");

    // Toggle to hidden
    const res1 = toggleMinimapHud(mockContainer);
    assert.strictEqual(res1, false);
    assert.strictEqual(hud.style.display, "none");

    // Toggle back to visible
    const res2 = toggleMinimapHud(mockContainer);
    assert.strictEqual(res2, true);
    assert.strictEqual(hud.style.display, "flex");
  });

  it("updates minimap thumbnail nodes, edges, and viewfinder", () => {
    const mockDoc = {
      createElement: (tag: string) => createMockElement(tag),
      createElementNS: (_ns: string, tag: string) => createMockElement(tag),
    };
    (globalThis as any).document = mockDoc;

    const mockContainer = createMockElement("div");
    const hud = ensureMinimapHud(mockContainer, () => {});
    assert.ok(hud);

    const mockGraph: MinimapGraph = {
      container: mockContainer,
      getNodes: () => [
        {
          id: "nodeA",
          getPosition: () => ({ x: 20, y: 30 }),
          getSize: () => ({ width: 60, height: 40 }),
          attr: (p: string) => (p === "body/stroke" ? "#38bdf8" : undefined),
        },
        {
          id: "nodeB",
          getPosition: () => ({ x: 150, y: 120 }),
          getSize: () => ({ width: 80, height: 50 }),
          attr: () => "#10b981",
        },
      ],
      getEdges: () => [
        {
          id: "edge1",
          getSourcePoint: () => ({ x: 80, y: 50 }),
          getTargetPoint: () => ({ x: 150, y: 140 }),
        },
      ],
      scale: () => ({ sx: 1, sy: 1 }),
      translate: () => ({ tx: -50, ty: -30 }),
    };

    updateMinimapHud(hud, mockGraph);

    const svg = hud.querySelector("#minimap-svg");
    assert.ok(svg);
    // Verifies SVG contains node rects, edge lines, and camera viewfinder
    assert.match(svg.innerHTML, /<rect x="20" y="30"/);
    assert.match(svg.innerHTML, /<rect x="150" y="120"/);
    assert.match(svg.innerHTML, /<line x1="80" y1="50" x2="150" y2="140"/);
    assert.match(svg.innerHTML, /rgba\(56, 189, 248, 0\.2\)/); // Viewfinder rect
  });
});

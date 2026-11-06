// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeNodeAlignment,
  computeNodeNudge,
  showAlignmentToolbar,
  type AlignableNode,
} from "../src/alignment.js";

describe("CAD Multi-Node Alignment & Distribution Engine", () => {
  const nodes: AlignableNode[] = [
    { id: "nodeA", x: 20, y: 10, width: 40, height: 40 },
    { id: "nodeB", x: 100, y: 80, width: 60, height: 40 },
    { id: "nodeC", x: 200, y: 150, width: 50, height: 50 },
  ];

  it("align-left aligns all nodes to the minimum x position", () => {
    const res = computeNodeAlignment(nodes, "align-left");
    assert.strictEqual(res.length, 3);
    for (const r of res) {
      assert.strictEqual(r.x, 20);
    }
    // y positions must remain untouched
    assert.strictEqual(res[0]?.y, 10);
    assert.strictEqual(res[1]?.y, 80);
    assert.strictEqual(res[2]?.y, 150);
  });

  it("align-right aligns all nodes to the maximum right edge", () => {
    // maxRight = nodeC (200 + 50 = 250)
    const res = computeNodeAlignment(nodes, "align-right");
    assert.strictEqual(res.length, 3);
    assert.strictEqual(res[0]?.x, 250 - 40); // 210
    assert.strictEqual(res[1]?.x, 250 - 60); // 190
    assert.strictEqual(res[2]?.x, 250 - 50); // 200
  });

  it("align-center centers all nodes horizontally along the collective centerline", () => {
    // minX = 20, maxRight = 250, center = 135
    const res = computeNodeAlignment(nodes, "align-center");
    assert.strictEqual(res.length, 3);
    // nodeA: width 40 -> 135 - 20 = 115
    assert.strictEqual(res[0]?.x, 115);
    // nodeB: width 60 -> 135 - 30 = 105
    assert.strictEqual(res[1]?.x, 105);
    // nodeC: width 50 -> 135 - 25 = 110
    assert.strictEqual(res[2]?.x, 110);
  });

  it("align-top aligns all nodes to the minimum y position", () => {
    const res = computeNodeAlignment(nodes, "align-top");
    assert.strictEqual(res.length, 3);
    for (const r of res) {
      assert.strictEqual(r.y, 10);
    }
    assert.strictEqual(res[0]?.x, 20);
    assert.strictEqual(res[1]?.x, 100);
    assert.strictEqual(res[2]?.x, 200);
  });

  it("align-bottom aligns all nodes to the maximum bottom edge", () => {
    // maxBottom = nodeC (150 + 50 = 200)
    const res = computeNodeAlignment(nodes, "align-bottom");
    assert.strictEqual(res.length, 3);
    assert.strictEqual(res[0]?.y, 200 - 40); // 160
    assert.strictEqual(res[1]?.y, 200 - 40); // 160
    assert.strictEqual(res[2]?.y, 200 - 50); // 150
  });

  it("align-middle centers all nodes vertically along the collective centerline", () => {
    // minY = 10, maxBottom = 200, centerY = 105
    const res = computeNodeAlignment(nodes, "align-middle");
    assert.strictEqual(res.length, 3);
    // nodeA: height 40 -> 105 - 20 = 85
    assert.strictEqual(res[0]?.y, 85);
    // nodeB: height 40 -> 105 - 20 = 85
    assert.strictEqual(res[1]?.y, 85);
    // nodeC: height 50 -> 105 - 25 = 80
    assert.strictEqual(res[2]?.y, 80);
  });

  it("distribute-horizontal distributes intermediate nodes with equal gap spacing", () => {
    // NodeA: x=0, w=40
    // NodeB: x=50, w=40
    // NodeC: x=200, w=40
    // totalSpan = 240 - 0 = 240
    // totalWidth = 120, totalGap = 120, 2 gaps -> gap = 60
    // Expected: NodeA x=0, NodeB x=100, NodeC x=200
    const testNodes: AlignableNode[] = [
      { id: "A", x: 0, y: 0, width: 40, height: 40 },
      { id: "B", x: 50, y: 0, width: 40, height: 40 },
      { id: "C", x: 200, y: 0, width: 40, height: 40 },
    ];
    const res = computeNodeAlignment(testNodes, "distribute-horizontal");
    assert.strictEqual(res.length, 3);
    assert.strictEqual(res[0]?.x, 0);
    assert.strictEqual(res[1]?.x, 100);
    assert.strictEqual(res[2]?.x, 200);
  });

  it("distribute-vertical distributes intermediate nodes with equal gap spacing", () => {
    const testNodes: AlignableNode[] = [
      { id: "A", x: 0, y: 0, width: 40, height: 40 },
      { id: "B", x: 0, y: 50, width: 40, height: 40 },
      { id: "C", x: 0, y: 200, width: 40, height: 40 },
    ];
    const res = computeNodeAlignment(testNodes, "distribute-vertical");
    assert.strictEqual(res.length, 3);
    assert.strictEqual(res[0]?.y, 0);
    assert.strictEqual(res[1]?.y, 100);
    assert.strictEqual(res[2]?.y, 200);
  });

  it("snaps to grid when snapGrid > 1", () => {
    const res = computeNodeAlignment(nodes, "align-left", 18);
    // minX = 20, 20 / 18 -> 18
    assert.strictEqual(res[0]?.x, 18);
  });

  it("returns empty array when fewer than 2 nodes are provided", () => {
    assert.deepStrictEqual(computeNodeAlignment([], "align-left"), []);
    assert.deepStrictEqual(computeNodeAlignment([nodes[0]!], "align-left"), []);
  });

  describe("3-Gear Precision Arrow Key Shifting (computeNodeNudge)", () => {
    it("shifts nodes by baseStep (2px) in normal mode across all 4 directions", () => {
      const single = [{ id: "C", x: 100, y: 200, width: 40, height: 40 }];
      assert.deepStrictEqual(computeNodeNudge(single, "ArrowUp"), [{ id: "C", x: 100, y: 198, dx: 0, dy: -2 }]);
      assert.deepStrictEqual(computeNodeNudge(single, "ArrowDown"), [{ id: "C", x: 100, y: 202, dx: 0, dy: 2 }]);
      assert.deepStrictEqual(computeNodeNudge(single, "ArrowLeft"), [{ id: "C", x: 98, y: 200, dx: -2, dy: 0 }]);
      assert.deepStrictEqual(computeNodeNudge(single, "ArrowRight"), [{ id: "C", x: 102, y: 200, dx: 2, dy: 0 }]);
    });

    it("shifts nodes by coarse step (10px) when shiftKey is true", () => {
      const single = [{ id: "C", x: 100, y: 200, width: 40, height: 40 }];
      assert.deepStrictEqual(computeNodeNudge(single, "ArrowRight", { shiftKey: true }), [
        { id: "C", x: 110, y: 200, dx: 10, dy: 0 },
      ]);
      assert.deepStrictEqual(computeNodeNudge(single, "ArrowUp", { shiftKey: true }), [
        { id: "C", x: 100, y: 190, dx: 0, dy: -10 },
      ]);
    });

    it("shifts nodes by sub-grid fine step (1px) when altKey is true", () => {
      const single = [{ id: "C", x: 100, y: 200, width: 40, height: 40 }];
      assert.deepStrictEqual(computeNodeNudge(single, "ArrowLeft", { altKey: true }), [
        { id: "C", x: 99, y: 200, dx: -1, dy: 0 },
      ]);
      assert.deepStrictEqual(computeNodeNudge(single, "ArrowDown", { altKey: true }), [
        { id: "C", x: 100, y: 201, dx: 0, dy: 1 },
      ]);
    });
  });

  describe("Contextual Floating Edit Bar (showAlignmentToolbar)", () => {
    const createMockToolbar = () => {
      const classSet = new Set<string>();
      return {
        innerHTML: "",
        dataset: {} as Record<string, string | undefined>,
        style: { left: "", top: "" },
        classList: {
          add: (c: string) => classSet.add(c),
          remove: (c: string) => classSet.delete(c),
          contains: (c: string) => classSet.has(c),
        },
      } as unknown as HTMLElement;
    };

    const mockContainer = { clientWidth: 1000, clientHeight: 800 } as unknown as HTMLElement;

    it("renders single-node contextual edit bar with identity chip, quick parameter pill, rotate, flip, duplicate, properties, and delete", () => {
      const toolbar = createMockToolbar();
      showAlignmentToolbar(
        toolbar,
        mockContainer,
        [
          {
            id: "C",
            x: 200,
            y: 150,
            width: 40,
            height: 40,
            name: "C",
            primaryParam: { name: "C", value: "1e-4" },
          },
        ],
        { sx: 1, sy: 1 },
        { tx: 0, ty: 0 },
      );

      assert.strictEqual(toolbar.classList.contains("visible"), true);
      assert.strictEqual(toolbar.dataset["mode"], "single:C:C=1e-4");
      assert.equal(toolbar.innerHTML.includes('data-align="rename"'), true);
      assert.equal(toolbar.innerHTML.includes('data-align="edit-param"'), true);
      assert.equal(toolbar.innerHTML.includes("C=1e-4"), true);
      assert.equal(toolbar.innerHTML.includes('data-align="rotate-ccw"'), true);
      assert.equal(toolbar.innerHTML.includes('data-align="rotate-cw"'), true);
      assert.equal(toolbar.innerHTML.includes('data-align="flip-h"'), true);
      assert.equal(toolbar.innerHTML.includes('data-align="flip-v"'), true);
      assert.equal(toolbar.innerHTML.includes('data-align="duplicate"'), true);
      assert.equal(toolbar.innerHTML.includes('data-align="properties"'), true);
      assert.equal(toolbar.innerHTML.includes('data-align="delete"'), true);
    });

    it("flips floating toolbar below the component when near the top of the viewport", () => {
      const toolbar = createMockToolbar();
      showAlignmentToolbar(
        toolbar,
        mockContainer,
        [{ id: "C", x: 200, y: 10, width: 40, height: 40, name: "C" }],
        { sx: 1, sy: 1 },
        { tx: 0, ty: 0 },
      );
      // screenTopY = 10 - 14 = -4 < 48 -> flips below maxY (50) + 14 = 64px
      assert.strictEqual(toolbar.style.top, "64px");
    });

    it("renders multi-node CAD alignment & batch toolbar when 2 or more nodes are selected", () => {
      const toolbar = createMockToolbar();
      showAlignmentToolbar(toolbar, mockContainer, nodes, { sx: 1, sy: 1 }, { tx: 0, ty: 0 });
      assert.strictEqual(toolbar.classList.contains("visible"), true);
      assert.strictEqual(toolbar.dataset["mode"], "multi:3");
      assert.equal(toolbar.innerHTML.includes("3 selected"), true);
      assert.equal(toolbar.innerHTML.includes('data-align="align-left"'), true);
      assert.equal(toolbar.innerHTML.includes('data-align="distribute-horizontal"'), true);
    });
  });
});

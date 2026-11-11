// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoLayoutDiagram, autoLayoutDiagramAsync } from "../src/auto-layout.js";

describe("Diagram Auto-layout Engine & Coordinate Preservation", () => {
  it("should NOT move or perturb the square box (__diagram_background__) when no components exist", () => {
    let bgMoved = false;
    let setPositionCalls = 0;

    const bgNode = {
      id: "__diagram_background__",
      isNode: () => true,
      getParent: () => null,
      getPosition: () => ({ x: -100, y: -100 }),
      getSize: () => ({ width: 200, height: 200 }),
      setPosition: (x: number, y: number) => {
        bgMoved = true;
        setPositionCalls++;
      },
    };

    const axesNode = {
      id: "__diagram_axes__",
      isNode: () => true,
      getParent: () => null,
      getPosition: () => ({ x: 0, y: 0 }),
      getSize: () => ({ width: 0, height: 0 }),
      setPosition: () => {
        setPositionCalls++;
      },
    };

    const mockGraph: any = {
      disposed: false,
      getNodes: () => [bgNode, axesNode],
      getEdges: () => [],
      getCellById: (id: string) => {
        if (id === "__diagram_background__") return bgNode;
        if (id === "__diagram_axes__") return axesNode;
        return null;
      },
      batchUpdate: (_name: string, fn: () => void) => fn(),
      zoomToFit: () => {},
      centerContent: () => {},
    };

    const res = autoLayoutDiagram(mockGraph);
    assert.strictEqual(res, false, "autoLayoutDiagram must return false when no layoutable components exist");
    assert.strictEqual(bgMoved, false, "The square box must remain in its original position and never be moved");
    assert.strictEqual(
      setPositionCalls,
      0,
      "No setPosition calls should occur for an equation-based model without components",
    );
  });

  it("should lay out real schematic components while keeping the square box in the center", () => {
    const bgNode = {
      id: "__diagram_background__",
      isNode: () => true,
      getParent: () => null,
      getPosition: () => ({ x: -100, y: -100 }),
      getSize: () => ({ width: 200, height: 200 }),
      setPosition: (_x: number, _y: number) => {
        assert.fail("The square box (__diagram_background__) must NEVER have setPosition called during autoLayout");
      },
    };

    const r1Pos = { x: 50, y: 50 };
    const r1Node = {
      id: "R1",
      isNode: () => true,
      getParent: () => null,
      getPosition: () => ({ ...r1Pos }),
      getSize: () => ({ width: 40, height: 20 }),
      getAngle: () => 0,
      setPosition: (x: number, y: number) => {
        r1Pos.x = x;
        r1Pos.y = y;
      },
    };

    const c1Pos = { x: 50, y: 100 };
    const c1Node = {
      id: "C1",
      isNode: () => true,
      getParent: () => null,
      getPosition: () => ({ ...c1Pos }),
      getSize: () => ({ width: 40, height: 20 }),
      getAngle: () => 0,
      setPosition: (x: number, y: number) => {
        c1Pos.x = x;
        c1Pos.y = y;
      },
    };

    const edge1Vertices: { x: number; y: number }[] = [{ x: 10, y: 10 }];
    const edge1 = {
      id: "edge1",
      getSourceCellId: () => "R1",
      getTargetCellId: () => "C1",
      getVertices: () => edge1Vertices,
      setVertices: (v: { x: number; y: number }[]) => {
        edge1Vertices.length = 0;
        edge1Vertices.push(...v);
      },
    };

    let actionEnqueued: any = null;
    const mockGraph: any = {
      disposed: false,
      container: { clientWidth: 800, clientHeight: 600 },
      options: {
        onAction: (act: any) => {
          actionEnqueued = act;
        },
      },
      getNodes: () => [bgNode, r1Node, c1Node],
      getEdges: () => [edge1],
      getCellById: (id: string) => {
        if (id === "__diagram_background__") return bgNode;
        if (id === "R1") return r1Node;
        if (id === "C1") return c1Node;
        return null;
      },
      batchUpdate: (_name: string, fn: () => void) => fn(),
      zoomToRect: () => {},
      centerPoint: () => {},
    };

    const res = autoLayoutDiagram(mockGraph);
    assert.strictEqual(res, true, "autoLayoutDiagram should return true when layoutable components are positioned");

    // Component coordinates should be centered around the background box center (0, 0)
    const midX = (r1Pos.x + c1Pos.x + 40) / 2;
    const midY = (r1Pos.y + c1Pos.y + 20) / 2;
    assert.ok(
      Math.abs(midX) < 100,
      `Expected layout to be centered within coordinate box horizontally, got midX=${midX}`,
    );
    assert.ok(
      Math.abs(midY) < 100,
      `Expected layout to be centered within coordinate box vertically, got midY=${midY}`,
    );

    // Stale edge vertices must be cleared
    assert.strictEqual(edge1Vertices.length, 0, "Edge intermediate vertices must be cleared on auto-layout");

    // Action must be enqueued with move items
    assert.ok(actionEnqueued, "A move diagram action must be dispatched to persist changes");
    assert.strictEqual(actionEnqueued.type, "move");
    assert.strictEqual(actionEnqueued.items.length, 2);
    assert.ok(actionEnqueued.items.some((i: any) => i.name === "R1"));
    assert.ok(actionEnqueued.items.some((i: any) => i.name === "C1"));
  });

  it("should filter out ephemeral nodes like solder dots and alignment guides", () => {
    const solderDot = {
      id: "solder_dot_1",
      isNode: () => true,
      getParent: () => null,
      getPosition: () => ({ x: 0, y: 0 }),
      getSize: () => ({ width: 8, height: 8 }),
      setPosition: () => {
        assert.fail("solder dots must not be laid out by Dagre");
      },
    };

    const guide = {
      id: "__alignment_guide_x",
      isNode: () => true,
      getParent: () => null,
      getPosition: () => ({ x: 0, y: 0 }),
      getSize: () => ({ width: 1, height: 1 }),
      setPosition: () => {
        assert.fail("alignment guides must not be laid out by Dagre");
      },
    };

    const mockGraph: any = {
      disposed: false,
      getNodes: () => [solderDot, guide],
      getEdges: () => [],
      getCellById: (id: string) => (id === "solder_dot_1" ? solderDot : id === "__alignment_guide_x" ? guide : null),
      batchUpdate: (_name: string, fn: () => void) => fn(),
    };

    const res = autoLayoutDiagram(mockGraph);
    assert.strictEqual(res, false, "Must return false when only ephemeral nodes are present");
  });

  it("should asynchronously layout components with autoLayoutDiagramAsync", async () => {
    const r1Pos = { x: 0, y: 0 };
    const r1Node = {
      id: "R1",
      isNode: () => true,
      getParent: () => null,
      getPosition: () => ({ ...r1Pos }),
      getSize: () => ({ width: 40, height: 20 }),
      setPosition: (x: number, y: number) => {
        r1Pos.x = x;
        r1Pos.y = y;
      },
    };

    const mockGraph: any = {
      disposed: false,
      getNodes: () => [r1Node],
      getEdges: () => [],
      getCellById: (id: string) => (id === "R1" ? r1Node : null),
      batchUpdate: (_name: string, fn: () => void) => fn(),
    };

    const res = await autoLayoutDiagramAsync(mockGraph);
    assert.strictEqual(res, true, "autoLayoutDiagramAsync should resolve to true when components are laid out");
  });

  it("should run port constraint optimization when components have ports and edges", () => {
    let portPropCalled = false;

    const r1Pos = { x: 0, y: 0 };
    const r1Node = {
      id: "R1",
      isNode: () => true,
      getParent: () => null,
      getPosition: () => ({ ...r1Pos }),
      getSize: () => ({ width: 40, height: 40 }),
      getPorts: () => [{ id: "p", group: "right" }],
      portProp: (_portId: string, _path: string, _val?: unknown) => {
        portPropCalled = true;
      },
      setPosition: (x: number, y: number) => {
        r1Pos.x = x;
        r1Pos.y = y;
      },
    };

    const c1Pos = { x: 100, y: 0 };
    const c1Node = {
      id: "C1",
      isNode: () => true,
      getParent: () => null,
      getPosition: () => ({ ...c1Pos }),
      getSize: () => ({ width: 40, height: 40 }),
      getPorts: () => [{ id: "n", group: "left" }],
      portProp: (_portId: string, _path: string, _val?: unknown) => {
        portPropCalled = true;
      },
      setPosition: (x: number, y: number) => {
        c1Pos.x = x;
        c1Pos.y = y;
      },
    };

    const edge = {
      id: "e1",
      getSourceCellId: () => "R1",
      getTargetCellId: () => "C1",
      getSourcePortId: () => "p",
      getTargetPortId: () => "n",
      setVertices: () => {},
    };

    const mockGraph: any = {
      disposed: false,
      getNodes: () => [r1Node, c1Node],
      getEdges: () => [edge],
      getCellById: (id: string) => (id === "R1" ? r1Node : id === "C1" ? c1Node : null),
      batchUpdate: (_name: string, fn: () => void) => fn(),
    };

    const res = autoLayoutDiagram(mockGraph, { optimizePorts: true });
    assert.strictEqual(res, true);
    assert.strictEqual(portPropCalled, true, "Port ILP optimization should configure portProp coordinates");
  });
});

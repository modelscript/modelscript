// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoLayoutDiagram, autoLayoutDiagramAsync, layoutWithElk } from "../src/auto-layout.js";
import { groupSelectedNodesOnGraph, ungroupSelectedNodesOnGraph } from "../src/group-actions.js";
import { solvePortPlacements } from "../src/port-ilp-solver.js";

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

  it("should untangle crossed edges with layoutWithElk multi-pass Sugiyama layered layout", () => {
    const pos = {
      Src: { x: 0, y: 0 },
      T1: { x: 0, y: 200 },
      T2: { x: 0, y: 50 },
    };
    const mkNode = (id: "Src" | "T1" | "T2", ports: { id: string; group: string }[]) => ({
      id,
      isNode: () => true,
      getParent: () => null,
      getPosition: () => ({ ...pos[id] }),
      getSize: () => ({ width: 80, height: 60 }),
      getPorts: () => ports,
      portProp: () => {},
      setPosition: (x: number, y: number) => {
        pos[id].x = x;
        pos[id].y = y;
      },
    });

    const srcNode = mkNode("Src", [
      { id: "topOut", group: "right" },
      { id: "botOut", group: "right" },
    ]);
    // Put T2 above T1 in input array while Src.topOut -> T1 and Src.botOut -> T2
    const t2Node = mkNode("T2", [{ id: "in", group: "left" }]);
    const t1Node = mkNode("T1", [{ id: "in", group: "left" }]);

    const edges = [
      {
        id: "e_top",
        getSourceCellId: () => "Src",
        getTargetCellId: () => "T1",
        getSourcePortId: () => "topOut",
        getTargetPortId: () => "in",
        setVertices: () => {},
      },
      {
        id: "e_bot",
        getSourceCellId: () => "Src",
        getTargetCellId: () => "T2",
        getSourcePortId: () => "botOut",
        getTargetPortId: () => "in",
        setVertices: () => {},
      },
    ];

    const mockGraph: any = {
      disposed: false,
      getNodes: () => [srcNode, t2Node, t1Node],
      getEdges: () => edges,
      getCellById: (id: string) => (id === "Src" ? srcNode : id === "T1" ? t1Node : id === "T2" ? t2Node : null),
      batchUpdate: (_name: string, fn: () => void) => fn(),
    };

    const ok = layoutWithElk(mockGraph, { rankdir: "LR" });
    assert.strictEqual(ok, true);
    assert.ok(pos.T1.x > pos.Src.x && pos.T2.x > pos.Src.x, "Target layer must be placed right of source layer");
    assert.ok(
      pos.T1.y < pos.T2.y,
      `Sugiyama barycenter port ordering should place T1 (topOut target) above T2 (botOut target): T1=${pos.T1.y}, T2=${pos.T2.y}`,
    );
  });

  it("should group and ungroup selected nodes cleanly via groupSelectedNodesOnGraph / ungroupSelectedNodesOnGraph", () => {
    const mkNode = (id: string, x: number, y: number, w = 60, h = 40) => {
      const children: any[] = [];
      let parent: any = null;
      return {
        id,
        isNode: () => true,
        getPosition: () => ({ x, y }),
        getSize: () => ({ width: w, height: h }),
        getChildren: () => children,
        addChild: (c: any) => {
          children.push(c);
        },
        removeChild: (c: any) => {
          const i = children.indexOf(c);
          if (i >= 0) children.splice(i, 1);
          c.setParent?.(null);
        },
        setParent: (p: any) => {
          parent = p;
        },
        getParent: () => parent,
        setZIndex: () => {},
        getData: () => ({}),
      };
    };

    const n1 = mkNode("R1", 100, 100);
    const n2 = mkNode("C1", 240, 140);
    const nodes: any[] = [n1, n2];
    let selected: any[] = [n1, n2];

    const mockGraph: any = {
      disposed: false,
      getSelectedCells: () => selected,
      addNode: (spec: any) => {
        const gChildren: any[] = [];
        const gNode = {
          id: spec.id,
          isNode: () => true,
          getPosition: () => ({ x: spec.x, y: spec.y }),
          getSize: () => ({ width: spec.width, height: spec.height }),
          getChildren: () => gChildren,
          addChild: (c: any) => {
            gChildren.push(c);
            c.setParent(gNode);
          },
          removeChild: (c: any) => {
            const idx = gChildren.indexOf(c);
            if (idx >= 0) gChildren.splice(idx, 1);
            c.setParent(null);
          },
          getData: () => spec.data,
        };
        nodes.push(gNode);
        return gNode;
      },
      removeCell: (cell: any) => {
        const idx = nodes.indexOf(cell);
        if (idx >= 0) nodes.splice(idx, 1);
      },
      batchUpdate: (_name: string, fn: () => void) => fn(),
      cleanSelection: () => {
        selected = [];
      },
      select: (c: any) => {
        selected = Array.isArray(c) ? c : [c];
      },
    };

    const grp = groupSelectedNodesOnGraph(mockGraph);
    assert.ok(grp, "groupSelectedNodesOnGraph must return newly created group node");
    assert.strictEqual(n1.getParent(), grp);
    assert.strictEqual(n2.getParent(), grp);
    assert.deepStrictEqual(selected, [grp]);

    const detached = ungroupSelectedNodesOnGraph(mockGraph);
    assert.strictEqual(detached.length, 2);
    assert.strictEqual(n1.getParent(), null);
    assert.strictEqual(n2.getParent(), null);
    assert.strictEqual(nodes.includes(grp), false, "Removed group cell must be purged from graph");
  });

  it("GlobalPortIlpSolver eliminates multi-port crossings and snaps multi-hop chains without sibling overlap", () => {
    const solved = solvePortPlacements(
      [
        {
          id: "A",
          x: 0,
          y: 0,
          width: 80,
          height: 100,
          ports: [
            { id: "a_p1", nodeId: "A", fixedSide: "right", y: 80 },
            { id: "a_p2", nodeId: "A", fixedSide: "right", y: 20 },
          ],
        },
        {
          id: "B_top",
          x: 200,
          y: 0,
          width: 80,
          height: 40,
          ports: [
            { id: "b1_in", nodeId: "B_top", fixedSide: "left" },
            { id: "b1_out", nodeId: "B_top", fixedSide: "right" },
          ],
        },
        {
          id: "B_bot",
          x: 200,
          y: 80,
          width: 80,
          height: 40,
          ports: [{ id: "b2_in", nodeId: "B_bot", fixedSide: "left" }],
        },
        {
          id: "C",
          x: 400,
          y: 4,
          width: 80,
          height: 40,
          ports: [{ id: "c_in", nodeId: "C", fixedSide: "left" }],
        },
      ],
      [
        { sourceNodeId: "A", sourcePortId: "a_p1", targetNodeId: "B_top", targetPortId: "b1_in" },
        { sourceNodeId: "A", sourcePortId: "a_p2", targetNodeId: "B_bot", targetPortId: "b2_in" },
        { sourceNodeId: "B_top", sourcePortId: "b1_out", targetNodeId: "C", targetPortId: "c_in" },
      ],
      { minSpacing: 16, straightTolerance: 10 },
    );

    const p1 = solved.get("a_p1")!;
    const p2 = solved.get("a_p2")!;
    const b1Out = solved.get("b1_out")!;
    const cIn = solved.get("c_in")!;
    assert.ok(p1.y < p2.y, `Expected a_p1 (going to B_top) above a_p2 (going to B_bot): ${p1.y} vs ${p2.y}`);
    assert.ok(Math.abs(p2.y - p1.y) >= 16, "Ports on same face must obey minSpacing=16");
    assert.strictEqual(
      b1Out.y,
      cIn.y,
      "3-hop chain segment B_top.b1_out -> C.c_in must snap collinearly within straightTolerance",
    );
  });
});

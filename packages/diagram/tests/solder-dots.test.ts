// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  computeSolderDots,
  computeWireCrossings,
  resolveWireCrossingStyle,
  solderDotToDiagramNode,
  wireCrossingToDiagramNode,
} from "../src/solder-dots.js";

test("Topological Solder Dot Junction Engine", async (t) => {
  await t.test("should detect T-junction between an edge endpoint and another edge segment", () => {
    // Edge 1: horizontal line from (0, 50) to (100, 50)
    // Edge 2: vertical line from (50, 50) to (50, 100) meeting edge 1 at (50, 50)
    const edges = [
      {
        id: "e1",
        points: [
          { x: 0, y: 50 },
          { x: 100, y: 50 },
        ],
        color: "#0000ff",
      },
      {
        id: "e2",
        points: [
          { x: 50, y: 50 },
          { x: 50, y: 100 },
        ],
        color: "#0000ff",
      },
    ];

    const dots = computeSolderDots(edges);
    assert.strictEqual(dots.length, 1);
    assert.strictEqual(dots[0].x, 50);
    assert.strictEqual(dots[0].y, 50);
    assert.strictEqual(dots[0].id, "solder_dot_e1_e2");
  });

  await t.test("should not create solder dots for parallel or disjoint edges", () => {
    const edges = [
      {
        id: "e1",
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      },
      {
        id: "e2",
        points: [
          { x: 0, y: 50 },
          { x: 100, y: 50 },
        ],
      },
    ];

    const dots = computeSolderDots(edges);
    assert.strictEqual(dots.length, 0);
  });

  await t.test("should not create solder dots for degree-2 series connections", () => {
    const edges = [
      {
        id: "e1",
        points: [
          { x: 0, y: 50 },
          { x: 50, y: 50 },
        ],
      },
      {
        id: "e2",
        points: [
          { x: 50, y: 50 },
          { x: 100, y: 50 },
        ],
      },
    ];

    const dots = computeSolderDots(edges);
    assert.strictEqual(dots.length, 0);
  });

  await t.test("should create exactly 1 solder dot with stable ID for 3 incident edges", () => {
    const edges = [
      {
        id: "e1",
        points: [
          { x: 0, y: 50 },
          { x: 50, y: 50 },
        ],
      },
      {
        id: "e2",
        points: [
          { x: 50, y: 50 },
          { x: 100, y: 50 },
        ],
      },
      {
        id: "e3",
        points: [
          { x: 50, y: 50 },
          { x: 50, y: 100 },
        ],
      },
    ];

    const dots = computeSolderDots(edges);
    assert.strictEqual(dots.length, 1);
    assert.strictEqual(dots[0].id, "solder_dot_e1_e2_e3");
    assert.strictEqual(dots[0].x, 50);
    assert.strictEqual(dots[0].y, 50);
  });

  await t.test("should cluster slightly offset / jittered endpoints into a single solder dot", () => {
    const edges = [
      {
        id: "e1",
        points: [
          { x: 0, y: 50 },
          { x: 50.04, y: 50 },
        ],
      },
      {
        id: "e2",
        points: [
          { x: 50.08, y: 49.98 },
          { x: 100, y: 50 },
        ],
      },
      {
        id: "e3",
        points: [
          { x: 49.95, y: 50.02 },
          { x: 50, y: 100 },
        ],
      },
    ];

    const dots = computeSolderDots(edges);
    assert.strictEqual(dots.length, 1);
    assert.strictEqual(dots[0].id, "solder_dot_e1_e2_e3");
    assert.strictEqual(dots[0].x, 50);
    assert.strictEqual(dots[0].y, 50);
  });

  await t.test("should exclude solder dots on top of component connection ports", () => {
    const edges = [
      {
        id: "e1",
        points: [
          { x: 0, y: 50 },
          { x: 50, y: 50 },
        ],
      },
      {
        id: "e2",
        points: [
          { x: 50, y: 50 },
          { x: 100, y: 50 },
        ],
      },
      {
        id: "e3",
        points: [
          { x: 50, y: 50 },
          { x: 50, y: 100 },
        ],
      },
    ];

    const portPoints = [{ x: 50, y: 50 }];
    const dots = computeSolderDots(edges, { portPoints });
    assert.strictEqual(dots.length, 0);
  });

  await t.test("should not create solder dots for internal corners of a single polyline edge", () => {
    const edges = [
      {
        id: "e1",
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 50 },
          { x: 100, y: 50 },
        ],
      },
    ];

    const dots = computeSolderDots(edges);
    assert.strictEqual(dots.length, 0);
  });

  await t.test("should detect slightly offset T-junction and snap to through wire", () => {
    const edges = [
      {
        id: "e1",
        points: [
          { x: 0, y: 50 },
          { x: 100, y: 50 },
        ],
      },
      {
        id: "e2",
        points: [
          { x: 50.3, y: 50.4 },
          { x: 50.3, y: 100 },
        ],
      },
    ];

    const dots = computeSolderDots(edges);
    assert.strictEqual(dots.length, 1);
    assert.strictEqual(dots[0].id, "solder_dot_e1_e2");
    assert.strictEqual(dots[0].y, 50); // Snapped to through wire
  });

  await t.test("should convert solder dot to valid X6 DiagramNode with pointerEvents none", () => {
    const dot = {
      id: "solder_dot_1_2",
      x: 100,
      y: 200,
      color: "#ff0000",
      edgeIds: ["1", "2"] as [string, string],
    };

    const node = solderDotToDiagramNode(dot);
    assert.strictEqual(node.id, "solder_dot_1_2");
    assert.strictEqual(node.shape, "circle");
    assert.strictEqual(node.width, 3);
    assert.strictEqual(node.height, 3);
    assert.strictEqual(node.x, 98.5);
    assert.strictEqual(node.y, 198.5);
    assert.strictEqual((node.attrs as any)?.body?.fill, "#ff0000");
    assert.strictEqual((node.attrs as any)?.body?.pointerEvents, "none");
  });

  await t.test(
    "should not create false solder dots when a bend corner of one net touches a wire of an unrelated net",
    () => {
      // Top net: L.n -> R.p passing vertically down x = 60 from y = -40 to y = 30
      // Bottom net: R.n -> Vb.n with a bend corner at (60, 30)
      // Because they do not share any connected endpoint keys, they belong to separate nets.
      const edges = [
        {
          id: "top_net",
          sourceKey: "L.n",
          targetKey: "R.p",
          points: [
            { x: 10, y: -40 },
            { x: 60, y: -40 },
            { x: 60, y: 40 },
          ],
        },
        {
          id: "bottom_net",
          sourceKey: "R.n",
          targetKey: "Vb.n",
          points: [
            { x: 60, y: 60 },
            { x: 60, y: 30 },
            { x: -70, y: 30 },
          ],
        },
      ];

      const dots = computeSolderDots(edges);
      assert.strictEqual(dots.length, 0, "Unrelated nets touching at a bend corner must not spawn a solder dot");
    },
  );

  await t.test("should create solder dot when two edges in the same electrical net meet at a T-junction", () => {
    const edges = [
      {
        id: "c_to_vb",
        sourceKey: "C.n",
        targetKey: "Vb.n",
        points: [
          { x: 20, y: 10 },
          { x: 20, y: 30 },
          { x: -70, y: 30 },
          { x: -70, y: 10 },
        ],
      },
      {
        id: "r_to_vb",
        sourceKey: "R.n",
        targetKey: "Vb.n",
        points: [
          { x: 60, y: 10 },
          { x: 60, y: 30 },
          { x: -70, y: 30 },
          { x: -70, y: 10 },
        ],
      },
    ];

    const dots = computeSolderDots(edges, { portPoints: [{ x: -70, y: 10 }] });
    assert.strictEqual(dots.length, 1);
    assert.strictEqual(dots[0].x, 20);
    assert.strictEqual(dots[0].y, 30);
  });

  await t.test("should detect crossing between perpendicular horizontal and vertical wires without solder dots", () => {
    const edges = [
      {
        id: "h_wire",
        points: [
          { x: 0, y: 50 },
          { x: 100, y: 50 },
        ],
        color: "#1890ff",
      },
      {
        id: "v_wire",
        points: [
          { x: 50, y: 0 },
          { x: 50, y: 100 },
        ],
        color: "#1890ff",
      },
    ];

    const dots = computeSolderDots(edges);
    assert.strictEqual(dots.length, 0, "Perpendicular crossing without shared endpoints must not create a solder dot");

    const crossings = computeWireCrossings(edges, dots);
    assert.strictEqual(crossings.length, 1, "Must detect exactly 1 wire crossing");
    assert.strictEqual(crossings[0].x, 50);
    assert.strictEqual(crossings[0].y, 50);
    assert.strictEqual(crossings[0].horizontalEdgeId, "h_wire");
    assert.strictEqual(crossings[0].verticalEdgeId, "v_wire");

    const node = wireCrossingToDiagramNode(crossings[0], true);
    assert.strictEqual(node.type, "wire-crossing");
    assert.strictEqual(node.x, 47); // 50 - half(3) for refined 6px micro-arc
    assert.strictEqual(node.y, 47);
    assert.strictEqual(node.width, 6);
    assert.strictEqual(node.height, 6);
    assert.strictEqual(node.attrs?.arc?.stroke, "#1890ff");
    assert.strictEqual(node.attrs?.arc?.strokeWidth, 1.0);
    assert.strictEqual(node.attrs?.arc?.["vector-effect"], "non-scaling-stroke");

    // Also verify air-gap style
    const gapNode = wireCrossingToDiagramNode(crossings[0], true, { style: "gap" });
    assert.strictEqual(gapNode.type, "wire-crossing");
    assert.strictEqual(
      gapNode.markup.some((m) => m.selector === "arc"),
      false,
    );
  });

  await t.test("should resolve language-aware crossing styles according to domain standards", () => {
    // Modern EDA standard (no bridge hops, straight lines + solder dots)
    assert.strictEqual(resolveWireCrossingStyle("modelica"), "none");
    assert.strictEqual(resolveWireCrossingStyle("spice"), "none");
    assert.strictEqual(resolveWireCrossingStyle("verilog-a"), "none");
    assert.strictEqual(resolveWireCrossingStyle("sysml2"), "none");
    assert.strictEqual(resolveWireCrossingStyle("ssp"), "none");
    assert.strictEqual(resolveWireCrossingStyle("reqif"), "none");

    // Micro-arc bridge hops
    assert.strictEqual(resolveWireCrossingStyle("pscad"), "micro-arc");
    assert.strictEqual(resolveWireCrossingStyle("opendss"), "micro-arc");
    assert.strictEqual(resolveWireCrossingStyle("psse"), "micro-arc");
    assert.strictEqual(resolveWireCrossingStyle("plcopen"), "micro-arc");
    assert.strictEqual(resolveWireCrossingStyle("simulink"), "micro-arc");
    assert.strictEqual(resolveWireCrossingStyle("easy5"), "micro-arc");

    // Technical air-gap breaks (P&ID)
    assert.strictEqual(resolveWireCrossingStyle("relap5"), "gap");
    assert.strictEqual(resolveWireCrossingStyle("swmm"), "gap");
    assert.strictEqual(resolveWireCrossingStyle("epanet"), "gap");

    // Explicit user preference overrides language default
    assert.strictEqual(resolveWireCrossingStyle("modelica", "micro-arc"), "micro-arc");
    assert.strictEqual(resolveWireCrossingStyle("pscad", "none"), "none");
    assert.strictEqual(resolveWireCrossingStyle("modelica", "gap"), "gap");
  });

  await t.test("should not create jumpover when crossing is within tolerance of an existing solder dot", () => {
    const edges = [
      {
        id: "h_wire",
        points: [
          { x: 0, y: 50 },
          { x: 100, y: 50 },
        ],
        color: "#1890ff",
      },
      {
        id: "v_wire",
        points: [
          { x: 50, y: 0 },
          { x: 50, y: 100 },
        ],
        color: "#1890ff",
      },
    ];

    const fakeSolderDots = [{ id: "dot1", x: 50, y: 50, color: "#1890ff" }];
    const crossings = computeWireCrossings(edges, fakeSolderDots);
    assert.strictEqual(crossings.length, 0, "Wire crossing at a solder dot must be suppressed");
  });

  await t.test("should not create jumpover when crossing is within tolerance of a component port", () => {
    const edges = [
      {
        id: "h_wire",
        points: [
          { x: 0, y: 50 },
          { x: 100, y: 50 },
        ],
        color: "#1890ff",
      },
      {
        id: "v_wire",
        points: [
          { x: 50, y: 0 },
          { x: 50, y: 100 },
        ],
        color: "#1890ff",
      },
    ];

    const crossings = computeWireCrossings(edges, [], { portPoints: [{ x: 50, y: 50 }] });
    assert.strictEqual(crossings.length, 0, "Wire crossing at a component port must be suppressed");
  });

  await t.test("resolveWireCrossingStyle controls wire crossing generation", () => {
    const edges = [
      {
        id: "e_h",
        points: [
          { x: 0, y: 50 },
          { x: 100, y: 50 },
        ],
        color: "#0000ff",
      },
      {
        id: "e_v",
        points: [
          { x: 50, y: 0 },
          { x: 50, y: 100 },
        ],
        color: "#0000ff",
      },
    ];

    const dots = computeSolderDots(edges);

    // 1. Modelica: style is "none" -> crossings suppressed
    const styleModelica = resolveWireCrossingStyle("modelica");
    assert.strictEqual(styleModelica, "none");
    const crossingsModelica = styleModelica === "none" ? [] : computeWireCrossings(edges, dots);
    assert.strictEqual(crossingsModelica.length, 0, "Modelica must suppress wire crossing nodes");

    // 2. PSCAD: style is "micro-arc" -> refined micro-arc generated
    const stylePscad = resolveWireCrossingStyle("pscad");
    assert.strictEqual(stylePscad, "micro-arc");
    const crossingsPscad = stylePscad === "none" ? [] : computeWireCrossings(edges, dots);
    assert.strictEqual(crossingsPscad.length, 1, "PSCAD must detect wire crossing");
    const pscadNode = wireCrossingToDiagramNode(crossingsPscad[0], true, { style: stylePscad });
    assert.strictEqual(pscadNode.width, 6, "Must be refined 6px micro-arc");
    assert.strictEqual(pscadNode.attrs?.arc?.strokeWidth, 1.0);

    // 3. RELAP5: style is "gap" -> air-gap generated
    const styleRelap5 = resolveWireCrossingStyle("relap5");
    assert.strictEqual(styleRelap5, "gap");
    const gapNode = wireCrossingToDiagramNode(crossingsPscad[0], true, { style: styleRelap5 });
    assert.strictEqual(gapNode.width, 6);
    assert.strictEqual(
      gapNode.markup.some((m) => m.selector === "arc"),
      false,
    );
  });
});

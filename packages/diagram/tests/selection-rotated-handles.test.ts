// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  alignNodeSelectionBox,
  getEdgeToolConfig,
  resolveEdgeSelectionStyle,
  syncAllNodeSelectionBoxes,
  type GraphLike,
  type NodeLike,
} from "../src/selection-handles.js";

describe("Diagram Selection Handles and Box Rotation", () => {
  it("aligns and rotates selection box for rotated nodes", () => {
    const mockBox = {
      style: {} as Record<string, string>,
    } as unknown as HTMLElement;

    const mockNode = {
      id: "comp1",
      isNode: () => true,
      getBBox: () => ({ x: 100, y: 150, width: 80, height: 60 }),
      getAngle: () => 45,
    } as unknown as NodeLike;

    const mockGraph = {
      matrix: () => ({ a: 2, d: 2, e: 50, f: 30 }),
    } as unknown as GraphLike;

    alignNodeSelectionBox(mockBox, mockNode, mockGraph);

    assert.strictEqual(mockBox.style.position, "absolute");
    assert.strictEqual(mockBox.style.left, `${100 * 2 + 50}px`);
    assert.strictEqual(mockBox.style.top, `${150 * 2 + 30}px`);
    assert.strictEqual(mockBox.style.width, `${80 * 2}px`);
    assert.strictEqual(mockBox.style.height, `${60 * 2}px`);
    assert.strictEqual(mockBox.style.transform, "rotate(45deg)");
    assert.strictEqual(mockBox.style.transformOrigin, "center center");
    assert.strictEqual(mockBox.style.margin, "-5px 0 0 -5px");
    assert.strictEqual(mockBox.style.padding, "4px");
    assert.strictEqual(mockBox.style.boxSizing, "content-box");
  });

  it("does not apply rotation transform when node angle is 0", () => {
    const mockBox = {
      style: {} as Record<string, string>,
    } as unknown as HTMLElement;

    const mockNode = {
      id: "comp2",
      isNode: () => true,
      getBBox: () => ({ x: 200, y: 200, width: 50, height: 50 }),
      getAngle: () => 0,
    } as unknown as NodeLike;

    const mockGraph = {
      matrix: () => ({ a: 1, d: 1, e: 0, f: 0 }),
    } as unknown as GraphLike;

    alignNodeSelectionBox(mockBox, mockNode, mockGraph);

    assert.strictEqual(mockBox.style.transform, "");
    assert.strictEqual(mockBox.style.left, "200px");
    assert.strictEqual(mockBox.style.top, "200px");
    assert.strictEqual(mockBox.style.width, "50px");
    assert.strictEqual(mockBox.style.height, "50px");
  });

  it("normalizes negative and full-circle angles", () => {
    const mockBox = {
      style: {} as Record<string, string>,
    } as unknown as HTMLElement;

    const mockNode = {
      id: "comp3",
      isNode: () => true,
      getBBox: () => ({ x: 0, y: 0, width: 40, height: 40 }),
      getAngle: () => -90,
    } as unknown as NodeLike;

    const mockGraph = {
      matrix: () => ({ a: 1, d: 1, e: 0, f: 0 }),
    } as unknown as GraphLike;

    alignNodeSelectionBox(mockBox, mockNode, mockGraph);
    assert.strictEqual(mockBox.style.transform, "rotate(270deg)");
  });

  it("synchronizes all node selection boxes in the container", () => {
    const boxes = [
      {
        getAttribute: (attr: string) => (attr === "data-cell-id" ? "nodeA" : null),
        style: {} as Record<string, string>,
      },
      {
        getAttribute: (attr: string) => (attr === "data-cell-id" ? "nodeB" : null),
        style: {} as Record<string, string>,
      },
    ];

    const mockContainer = {
      querySelectorAll: () => boxes,
    } as unknown as HTMLElement;

    const nodes: Record<string, NodeLike> = {
      nodeA: {
        id: "nodeA",
        isNode: () => true,
        getBBox: () => ({ x: 10, y: 10, width: 20, height: 20 }),
        getAngle: () => 30,
      } as unknown as NodeLike,
      nodeB: {
        id: "nodeB",
        isNode: () => true,
        getBBox: () => ({ x: 50, y: 50, width: 30, height: 30 }),
        getAngle: () => 90,
      } as unknown as NodeLike,
    };

    const mockGraph = {
      getCellById: (id: string) => nodes[id] ?? null,
      matrix: () => ({ a: 1, d: 1, e: 0, f: 0 }),
    } as unknown as GraphLike;

    syncAllNodeSelectionBoxes(mockGraph, mockContainer);

    assert.strictEqual(boxes[0].style.transform, "rotate(30deg)");
    assert.strictEqual(boxes[1].style.transform, "rotate(90deg)");
  });

  it("generates refined, scaled edge tool configurations", () => {
    const mockGraphZoomed = {
      zoom: () => 3.0,
    } as unknown as GraphLike;

    const toolsLight = getEdgeToolConfig({} as any, mockGraphZoomed, false) as {
      name: string;
      args: { attrs: Record<string, unknown> };
    }[];

    const vertTool = toolsLight.find((t) => t.name === "vertices");
    assert.ok(vertTool, "Vertices tool must be configured");
    assert.strictEqual(vertTool.args.attrs.fill, "#ffffff");
    assert.strictEqual(vertTool.args.attrs.stroke, "#0284c7");
    assert.strictEqual(vertTool.args.attrs.strokeWidth, 1.5);
    // At zoom 3.0, radius should be scaled down to prevent oversized handles
    const r = vertTool.args.attrs.r as number;
    assert.ok(r <= 1.5, `Radius at zoom 3.0 should be <= 1.5, got ${r}`);

    const segTool = toolsLight.find((t) => t.name === "segments");
    assert.ok(segTool, "Segments tool must be configured");
    assert.strictEqual(segTool.args.attrs.fill, "#ffffff");
    assert.strictEqual(segTool.args.attrs.stroke, "#0284c7");

    const toolsDark = getEdgeToolConfig({} as any, mockGraphZoomed, true) as {
      name: string;
      args: { attrs: Record<string, unknown> };
    }[];
    const vertToolDark = toolsDark.find((t) => t.name === "vertices");
    assert.strictEqual(vertToolDark?.args.attrs.fill, "#1e293b");
    assert.strictEqual(vertToolDark?.args.attrs.stroke, "#38bdf8");
  });

  it("resolves language-adaptive edge selection styles", () => {
    // Physical circuits & EDA -> Minimalist
    assert.strictEqual(resolveEdgeSelectionStyle("modelica"), "minimalist");
    assert.strictEqual(resolveEdgeSelectionStyle("mo"), "minimalist");
    assert.strictEqual(resolveEdgeSelectionStyle("spice"), "minimalist");
    assert.strictEqual(resolveEdgeSelectionStyle("cir"), "minimalist");
    assert.strictEqual(resolveEdgeSelectionStyle("pscad"), "minimalist");
    assert.strictEqual(resolveEdgeSelectionStyle("opendss"), "minimalist");
    assert.strictEqual(resolveEdgeSelectionStyle("verilog-a"), "minimalist");

    // Systems, Block Diagrams & Controls -> Floating HUD
    assert.strictEqual(resolveEdgeSelectionStyle("sysml"), "hud");
    assert.strictEqual(resolveEdgeSelectionStyle("sysml2"), "hud");
    assert.strictEqual(resolveEdgeSelectionStyle("simulink"), "hud");
    assert.strictEqual(resolveEdgeSelectionStyle("slx"), "hud");
    assert.strictEqual(resolveEdgeSelectionStyle("easy5"), "hud");
    assert.strictEqual(resolveEdgeSelectionStyle("plcopen"), "hud");

    // Fluids & Process Networks -> Flow Trace
    assert.strictEqual(resolveEdgeSelectionStyle("olga"), "trace");
    assert.strictEqual(resolveEdgeSelectionStyle("swmm"), "trace");
    assert.strictEqual(resolveEdgeSelectionStyle("lps"), "trace");
    assert.strictEqual(resolveEdgeSelectionStyle("epanet"), "trace");

    // Ontologies, Knowledge Graphs & Default -> Precision Halo
    assert.strictEqual(resolveEdgeSelectionStyle("owl2"), "halo");
    assert.strictEqual(resolveEdgeSelectionStyle("oscal"), "halo");
    assert.strictEqual(resolveEdgeSelectionStyle(undefined), "halo");

    // Explicit user preference overrides language default
    assert.strictEqual(resolveEdgeSelectionStyle("modelica", "hud"), "hud");
    assert.strictEqual(resolveEdgeSelectionStyle("sysml2", "minimalist"), "minimalist");
    assert.strictEqual(resolveEdgeSelectionStyle("modelica", "auto"), "minimalist");
  });

  it("omits segment midpoint handles in minimalist mode to avoid schematic clutter", () => {
    const mockGraph = { zoom: () => 1.0 } as unknown as GraphLike;

    // Minimalist mode (e.g. Modelica)
    const toolsMinimal = getEdgeToolConfig({} as any, mockGraph, false, "minimalist") as { name: string }[];
    assert.ok(
      toolsMinimal.find((t) => t.name === "vertices"),
      "Vertices handles must be present",
    );
    assert.strictEqual(
      toolsMinimal.find((t) => t.name === "segments"),
      undefined,
      "Segment handles must be omitted in minimalist mode",
    );

    // HUD / Halo mode
    const toolsHud = getEdgeToolConfig({} as any, mockGraph, false, "hud") as { name: string }[];
    assert.ok(
      toolsHud.find((t) => t.name === "vertices"),
      "Vertices handles must be present",
    );
    assert.ok(
      toolsHud.find((t) => t.name === "segments"),
      "Segment handles must be present in HUD mode",
    );
  });
});

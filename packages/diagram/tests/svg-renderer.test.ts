// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import type { DiagramData } from "../src/protocol.js";
import { renderPolyglotDiagramToSvg } from "../src/svg-renderer.js";

describe("Headless SVG Renderer (Zero DOM)", () => {
  const sampleDiagram: DiagramData = {
    coordinateSystem: { x: 0, y: 0, width: 800, height: 600 },
    diagramBackground: null,
    nodes: [
      {
        id: "n_1",
        x: 100,
        y: 100,
        width: 200,
        height: 120,
        shape: "rect",
        attrs: {
          body: { fill: "#1e293b", stroke: "#38bdf8", rx: 6, ry: 6 },
          label: { text: "PumpController" },
        },
        data: {
          ruleName: "PartDefinition",
          multiplicity: 3,
          sections: [
            { header: "attributes", entries: ["pressure : Real", "flowRate : Real"] },
            { header: "operations", entries: ["startPump()", "stopPump()"] },
          ],
        },
        ports: {
          groups: {},
          items: [{ id: "p1", group: "out", args: { x: 200, y: 60 } }],
        },
      },
      {
        id: "n_2",
        x: 450,
        y: 100,
        width: 160,
        height: 80,
        shape: "rect",
        attrs: {
          body: { fill: "#1e293b", stroke: "#38bdf8", rx: 6, ry: 6 },
          label: { text: "Valve" },
        },
        ports: {
          groups: {},
          items: [{ id: "p2", group: "in", args: { x: 0, y: 40 } }],
        },
      },
    ],
    edges: [
      {
        id: "e_1",
        source: { cell: "n_1", port: "p1" },
        target: { cell: "n_2", port: "p2" },
        connector: "jumpover",
        attrs: {
          line: {
            stroke: "#38bdf8",
            strokeWidth: 2,
            targetMarker: { name: "classic" },
            sourceMarker: { name: "diamond" },
          },
        },
        labels: [{ attrs: { text: { text: "fluid_flow" } } }],
      },
    ],
  };

  it("renders pure SVG XML string with nodes, compartments, and markers", () => {
    const svg = renderPolyglotDiagramToSvg(sampleDiagram, { theme: "dark" });
    assert.ok(svg.startsWith("<svg"), "Output must start with <svg");
    assert.ok(svg.endsWith("</svg>"), "Output must end with </svg>");
    assert.ok(svg.includes("viewBox="), "Must contain viewBox");
    assert.ok(svg.includes("PumpController"), "Must contain node title");
    assert.ok(svg.includes("pressure : Real"), "Must contain compartment attribute");
    assert.ok(svg.includes("startPump()"), "Must contain compartment operation");
    assert.ok(svg.includes("fluid_flow"), "Must contain edge label");
    assert.ok(svg.includes("marker-classic"), "Must contain marker def");
    assert.ok(svg.includes("marker-diamond"), "Must contain diamond marker");
  });

  it("renders 2.5D multiplicity cascade shadows for arrayed nodes", () => {
    const svg = renderPolyglotDiagramToSvg(sampleDiagram, { theme: "dark" });
    // Should render offset shadow rectangles with opacity 0.4 and 0.7
    assert.ok(svg.includes('opacity="0.4"'), "Must render 2.5D background shadow card");
    assert.ok(svg.includes('opacity="0.7"'), "Must render 2.5D midground shadow card");
  });

  it("supports light theme rendering", () => {
    const svg = renderPolyglotDiagramToSvg(sampleDiagram, { theme: "light" });
    assert.ok(svg.includes("background-color: #ffffff"), "Light theme must use white background");
  });

  it("renders procedural 3D lighting gradients in SVG defs", () => {
    const svg = renderPolyglotDiagramToSvg(sampleDiagram);
    assert.ok(svg.includes('id="grad-cylinder-horizontal"'), "Must include horizontal cylinder 3D shader");
    assert.ok(svg.includes('id="grad-cylinder-vertical"'), "Must include vertical cylinder 3D shader");
    assert.ok(svg.includes('id="grad-sphere"'), "Must include spherical 3D lighting shader");
  });

  it("renders smooth Catmull-Rom cubic Bezier spline for smooth connectors", () => {
    const bezierDiagram: DiagramData = {
      nodes: [
        { id: "a", x: 10, y: 10, width: 50, height: 50, shape: "rect" },
        { id: "b", x: 200, y: 100, width: 50, height: 50, shape: "rect" },
      ],
      edges: [
        {
          id: "e1",
          source: { cell: "a", port: "" },
          target: { cell: "b", port: "" },
          connector: "smooth",
          vertices: [
            { x: 50, y: 30 },
            { x: 100, y: 80 },
            { x: 150, y: 40 },
            { x: 200, y: 100 },
          ],
          attrs: { line: { stroke: "#38bdf8", strokeWidth: 2 } },
        },
      ],
    };

    const svg = renderPolyglotDiagramToSvg(bezierDiagram);
    assert.ok(svg.includes("<path"), "Bezier edge must render as an SVG path");
    assert.ok(svg.includes(" C "), "Smooth Bezier curve must contain cubic Bezier 'C' commands");
  });

  it("renders embedded raster image icons with xlink:href", () => {
    const iconDiagram: DiagramData = {
      nodes: [
        {
          id: "n_icon",
          x: 20,
          y: 20,
          width: 80,
          height: 80,
          shape: "rect",
          attrs: {
            icon: {
              href: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
              refWidth: "32",
              refHeight: "32",
            },
          },
        },
      ],
      edges: [],
    };

    const svg = renderPolyglotDiagramToSvg(iconDiagram);
    assert.ok(svg.includes("<image"), "Must render <image> SVG element");
    assert.ok(svg.includes("data:image/png;base64"), "Must include image data URI");
  });
});

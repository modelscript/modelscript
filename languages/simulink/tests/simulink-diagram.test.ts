// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { buildSimulinkDiagram, renderSimulinkSvg } from "../src/index.js";
import type { SimulinkModel } from "../src/types.js";

describe("@modelscript/simulink Diagram & SVG Generator", () => {
  const mockModel: SimulinkModel = {
    name: "FeedbackControlSystem",
    rootSystem: {
      name: "FeedbackControlSystem",
      blocks: new Map([
        [
          "StepInput",
          {
            name: "StepInput",
            type: "Constant",
            id: "step1",
            parameters: new Map([["Value", 1]]),
            ports: [{ id: 1, portNumber: 1, type: "out" }],
            position: { x: 50, y: 150, width: 70, height: 50 },
          },
        ],
        [
          "SumError",
          {
            name: "SumError",
            type: "Sum",
            id: "sum1",
            parameters: new Map([["Inputs", "|+-"]]),
            ports: [
              { id: 1, portNumber: 1, type: "in" },
              { id: 2, portNumber: 2, type: "in" },
              { id: 3, portNumber: 1, type: "out" },
            ],
            position: { x: 180, y: 155, width: 45, height: 45 },
          },
        ],
        [
          "PIDController",
          {
            name: "PIDController",
            type: "Gain",
            id: "gain1",
            parameters: new Map([["Gain", 2.5]]),
            ports: [
              { id: 1, portNumber: 1, type: "in" },
              { id: 2, portNumber: 1, type: "out" },
            ],
            position: { x: 280, y: 150, width: 80, height: 55 },
          },
        ],
        [
          "PlantModel",
          {
            name: "PlantModel",
            type: "TransferFcn",
            id: "tf1",
            parameters: new Map([
              ["Numerator", "1"],
              ["Denominator", "s^2 + 2s + 1"],
            ]),
            ports: [
              { id: 1, portNumber: 1, type: "in" },
              { id: 2, portNumber: 1, type: "out" },
            ],
            position: { x: 410, y: 145, width: 120, height: 65 },
          },
        ],
        [
          "OutputScope",
          {
            name: "OutputScope",
            type: "Scope",
            id: "scope1",
            parameters: new Map(),
            ports: [{ id: 1, portNumber: 1, type: "in" }],
            position: { x: 600, y: 150, width: 75, height: 55 },
          },
        ],
      ]),
      lines: [
        {
          id: "line1",
          srcBlock: "StepInput",
          srcPort: 1,
          dstBlock: "SumError",
          dstPort: 1,
          name: "reference",
        },
        {
          id: "line2",
          srcBlock: "SumError",
          srcPort: 1,
          dstBlock: "PIDController",
          dstPort: 1,
          name: "error",
        },
        {
          id: "line3",
          srcBlock: "PIDController",
          srcPort: 1,
          dstBlock: "PlantModel",
          dstPort: 1,
          name: "u",
        },
        {
          id: "line4",
          srcBlock: "PlantModel",
          srcPort: 1,
          dstBlock: "OutputScope",
          dstPort: 1,
          branches: [{ dstBlock: "SumError", dstPort: 2 }],
          name: "y",
        },
      ],
    },
  };

  test("generates AntV X6 graph structure with correct cells", () => {
    const diag = buildSimulinkDiagram(mockModel);
    assert.equal(diag.title, "FeedbackControlSystem");

    const blockCells = diag.cells.filter((c) => c.id.startsWith("block_"));
    assert.equal(blockCells.length, 5, "Should create 5 block nodes");

    const sumBlock = blockCells.find((c) => c.id === "block_SumError");
    assert.ok(sumBlock, "Should find SumError block");
    assert.equal(sumBlock?.shape, "circle");

    const tfBlock = blockCells.find((c) => c.id === "block_PlantModel");
    assert.ok(tfBlock, "Should find TransferFcn block");
    assert.equal(tfBlock?.shape, "rect");

    const lineCells = diag.cells.filter((c) => c.shape === "edge");
    assert.ok(lineCells.length >= 5, "Should have 4 lines + 1 branch connection");
  });

  test("renders valid, well-formed dark-mode SVG markup", () => {
    const svg = renderSimulinkSvg(mockModel);
    assert.ok(svg.startsWith("<?xml version="), "Should produce valid XML declaration");
    assert.ok(svg.includes("<svg"), "Should contain svg root element");
    assert.ok(svg.includes("FeedbackControlSystem — Simulink Block Diagram"), "Should contain diagram title");
    assert.ok(svg.includes("simulink-arrow"), "Should contain arrow markers");
    assert.ok(svg.includes("PIDController"), "Should contain block label PIDController");
    assert.ok(svg.includes("1/s") || svg.includes("∑") || svg.includes("TF"), "Should contain mathematical glyphs");
    assert.ok(svg.endsWith("</svg>\n"), "Should properly close svg tag");
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBondGraphDiagram, renderBondGraphSvg } from "../src/diagram/index.js";

const SAMPLE_SID = `
model RC
  submodels
    Se V (effort = 5);
    OneJunction j1;
    R R1 (r = 10);
    C C1 (c = 0.01);
  connections
    V.p => j1.p;
    j1.p => R1.p;
    j1.p => C1.p;
end RC;
`;

describe("20-sim Bond Graph SVG Diagram Builder", () => {
  it("builds a diagram scene with SCAP-assigned causalities", () => {
    const scene = buildBondGraphDiagram(SAMPLE_SID);
    assert.strictEqual(scene.modelName, "RC");
    assert.strictEqual(scene.nodes.length, 4);
    assert.strictEqual(scene.edges.length, 3);
    assert.ok(scene.edges.every((e) => e.causality !== "unassigned"));
  });

  it("renders valid SVG with junction circle and causal stroke bars", () => {
    const svg = renderBondGraphSvg(SAMPLE_SID);
    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.endsWith("</svg>"));
    assert.ok(svg.includes("20-sim: RC"));
    assert.ok(svg.includes("<circle"));
    assert.ok(svg.includes("#f59e0b"), "Expected amber causal stroke lines");
  });
});

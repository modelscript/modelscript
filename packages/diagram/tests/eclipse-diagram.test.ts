// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { buildEclipseDiagram, renderEclipseSvg, type EclipseDeckLike } from "../src/eclipse-diagram-builder.js";

const sampleDeck: EclipseDeckLike = {
  title: "North Sea Sandstone Reservoir",
  grid: { nx: 20, ny: 20, nz: 4, topsDepth: 2500 },
  wells: [
    { name: "P1", i: 5, j: 5, type: "PROD", fluid: "OIL", perforations: [{ kTop: 2, kBottom: 3 }] },
    { name: "I1", i: 15, j: 15, type: "INJE", fluid: "WATER", perforations: [{ kTop: 3, kBottom: 4 }] },
  ],
  contacts: { gocDepth: 2530, owcDepth: 2580 },
};

test("ECLIPSE Diagram: Builds X6 graph cells for stratigraphic layers and vertical wellbores", () => {
  const diag = buildEclipseDiagram(sampleDeck);
  assert.equal(diag.title, "North Sea Sandstone Reservoir");
  assert.ok(diag.cells.length >= 6); // 4 layers + 2 wellheads + 2 wellbores

  const layer1 = diag.cells.find((c) => c.id === "layer_1");
  assert.ok(layer1);
  assert.equal(layer1.shape, "rect");

  const p1 = diag.cells.find((c) => c.id === "wellhead_P1");
  assert.ok(p1);
  assert.equal(p1.shape, "polygon"); // Derrick

  const i1 = diag.cells.find((c) => c.id === "wellhead_I1");
  assert.ok(i1);
});

test("ECLIPSE SVG: Renders standalone subsurface cross-section with depth scale, GOC/OWC, and completions", () => {
  const svg = renderEclipseSvg(sampleDeck);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("North Sea Sandstone Reservoir"));
  assert.ok(svg.includes("Layer K=1"));
  assert.ok(svg.includes("GOC: Gas-Oil Contact"));
  assert.ok(svg.includes("OWC: Oil-Water Contact"));
  assert.ok(svg.includes("P1"));
  assert.ok(svg.includes("I1"));
  assert.ok(svg.includes("2500m")); // Depth scale
  assert.ok(svg.endsWith("</svg>\n"));
});

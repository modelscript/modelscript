// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { buildJsbsimDiagram, renderJsbsimSvg, type JsbsimFdmLike } from "../src/jsbsim-diagram-builder.js";

const sampleFdm: JsbsimFdmLike = {
  name: "C172P",
  metrics: {
    wingspan: 36.0,
    chord: 4.9,
    wingarea: 174.0,
    htailarea: 21.9,
    vtailarea: 16.5,
    aerorp: { x: 43.1, y: 0.0, z: 0.0 },
  },
  massBalance: {
    emptywt: 1500.0,
    cg: { x: 41.0, y: 0.0, z: 0.0 },
  },
};

test("JSBSim Diagram: Builds X6 graph cells for fuselage, main wing, horizontal tail, and reference points", () => {
  const diag = buildJsbsimDiagram(sampleFdm);
  assert.equal(diag.title, "C172P 6-DOF Airframe Geometry");
  assert.ok(diag.cells.length >= 5);

  const fuselage = diag.cells.find((c) => c.id === "fuselage");
  assert.ok(fuselage);
  assert.equal(fuselage.shape, "rect");

  const wing = diag.cells.find((c) => c.id === "wing_main");
  assert.ok(wing);
  assert.equal((wing.data as any)?.span, 36.0);

  const cg = diag.cells.find((c) => c.id === "marker_cg");
  assert.ok(cg);
  assert.equal(cg.shape, "circle");

  const aerorp = diag.cells.find((c) => c.id === "marker_aerorp");
  assert.ok(aerorp);
});

test("JSBSim SVG: Renders standalone blueprint planform with wing span callout and CG/AERORP markers", () => {
  const svg = renderJsbsimSvg(sampleFdm);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("C172P"));
  assert.ok(svg.includes("b = 36 ft"));
  assert.ok(svg.includes('CG (Station: 41")'));
  assert.ok(svg.includes('AERORP (43.1")'));
  assert.ok(svg.includes("THRUST VECTOR"));
  assert.ok(svg.endsWith("</svg>\n"));
});

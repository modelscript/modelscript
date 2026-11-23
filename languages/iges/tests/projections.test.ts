// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildIgesFile, igesToStep, igesToSvg, type SvgProjectionView } from "../src/index.js";

describe("@modelscript/iges — Projections (IGES -> SVG & IGES -> STEP AP214)", () => {
  const sampleIges = buildIgesFile({
    productId: "FLANGE_01",
    fileName: "flange.igs",
    author: "Grace Hopper",
    organization: "Naval CAD",
    unitFlag: 2,
    entities: [
      // D1: Point
      { entityType: 116, label: "ORIG_PT", params: [0, 0, 0, 0] },
      // D3: Line
      { entityType: 110, label: "EDGE_1", params: [0, 0, 0, 100, 0, 0] },
      // D5: Circular Arc
      { entityType: 100, label: "BOLTHOLE", params: [0, 50, 25, 60, 25, 60, 25] },
      // D7: NURBS Curve
      {
        entityType: 126,
        label: "FILLET",
        params: [2, 2, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, Math.SQRT1_2, 1, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 1, 0, 0, 1],
      },
      // D9: NURBS Surface
      {
        entityType: 128,
        label: "TOP_FACE",
        params: [
          1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 100, 0, 0, 0, 50, 0, 100, 50, 0, 0, 1,
          0, 1,
        ],
      },
      // D11: Manifold Solid B-Rep
      { entityType: 186, label: "FLNGSLD", params: [9, 1, 0] },
    ],
  });

  it("projects IGES geometry to SVG across xy, xz, yz, and iso views", () => {
    const views: SvgProjectionView[] = ["xy", "xz", "yz", "iso"];
    for (const view of views) {
      const svg = igesToSvg(sampleIges, {
        view,
        width: 640,
        height: 480,
        title: `Flange ${view}`,
      });
      assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"'));
      assert.ok(svg.includes(`<title>Flange ${view}</title>`));
      assert.ok(svg.includes("<line "), `View ${view} should emit <line> for Type 110`);
      assert.ok(svg.includes("<polyline "), `View ${view} should emit <polyline> for Type 100/126`);
      assert.ok(svg.includes("<circle "), `View ${view} should emit <circle> for Type 116`);
      assert.ok(svg.includes("<polygon "), `View ${view} should emit <polygon> for Type 128`);
      assert.ok(svg.trimEnd().endsWith("</svg>"));
    }
  });

  it("handles an empty IGES document gracefully in igesToSvg", () => {
    const emptyIges = buildIgesFile({ entities: [] });
    const svg = igesToSvg(emptyIges);
    assert.ok(svg.startsWith("<svg "));
    assert.ok(svg.trimEnd().endsWith("</svg>"));
  });

  it("projects IGES 5.3 entities to ISO 10303-21 STEP AP214 / AP242", () => {
    const step = igesToStep(sampleIges, {
      schema: "AP242_MANAGED_MODEL_BASED_3D_ENGINEERING",
    });

    assert.ok(step.startsWith("ISO-10303-21;\nHEADER;"));
    assert.ok(step.includes("FILE_NAME('flange.igs'"));
    assert.ok(step.includes("('Grace Hopper'),('Naval CAD')"));
    assert.ok(step.includes("FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING'));"));
    assert.ok(step.includes("CARTESIAN_POINT('ORIG_PT'"));
    assert.ok(step.includes("LINE('EDGE_1'"));
    assert.ok(step.includes("CIRCLE('BOLTHOLE'"));
    assert.ok(step.includes("RATIONAL_B_SPLINE_CURVE("));
    assert.ok(step.includes("B_SPLINE_SURFACE_WITH_KNOTS('TOP_FACE'"));
    assert.ok(step.includes("MANIFOLD_SOLID_BREP('FLNGSLD'"));
    assert.ok(step.includes("SHAPE_REPRESENTATION('IGES_MODEL'"));
    assert.ok(step.trimEnd().endsWith("END-ISO-10303-21;"));
  });

  it("applies Type 124 transformation matrices when projecting to STEP", () => {
    const transformed = buildIgesFile({
      entities: [
        { entityType: 124, params: [1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30] },
        { entityType: 116, label: "SHIFTED", transformMatrixPointer: 1, params: [1, 2, 3, 0] },
      ],
    });
    const step = igesToStep(transformed);
    assert.ok(step.includes("CARTESIAN_POINT('SHIFTED',(11.0,22.0,33.0))"));
  });
});

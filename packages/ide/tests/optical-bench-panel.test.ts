// SPDX-License-Identifier: AGPL-3.0-or-later

import { lintOpticalSystem, parseOpticalSystem, renderOpticalBenchSvg } from "@modelscript/diagram/optical-bench";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OpticalBenchEditorProvider, OpticalBenchPanel } from "../src/optical-bench-panel.js";

const SAMPLE_OPTICS_FIXTURE = `
TITLE: Cooke Triplet Photographic Objective
OBJECT_DIST: 10000.0

ELEMENT lens L1 Front_Crown 10.0 38.0 42.0 -180.0 6.0 BK7
ELEMENT lens L2 Mid_Flint    22.0 30.0 -35.0 38.0   2.5 F2
ELEMENT aperture_stop STOP Iris 26.0 24.0
ELEMENT lens L3 Rear_Crown   32.0 34.0 120.0 -45.0  5.0 BK7
ELEMENT image_plane IMG Film_Plane 85.0 36.0
`;

describe("Geometrical Optics & Beam Propagation IDE Panels (Path I)", () => {
  it("exposes OpticalBenchPanel and OpticalBenchEditorProvider viewType identifiers", () => {
    assert.equal(OpticalBenchPanel.viewType, "modelscript.opticalBenchViewer");
    assert.equal(OpticalBenchEditorProvider.viewType, "modelscript.opticalBenchEditor");
  });

  it("constructs optical system from deck and renders optical bench layout & spot diagram", () => {
    const data = parseOpticalSystem(SAMPLE_OPTICS_FIXTURE);
    assert.equal(data.title, "Cooke Triplet Photographic Objective");
    assert.equal(data.elements.length, 5);

    const diags = lintOpticalSystem(data);
    assert.equal(diags.filter((d) => d.severity === "error").length, 0);

    assert.ok(data.rays.length >= 15);
    assert.ok(data.effectiveFocalLengthMm > 20.0 && data.effectiveFocalLengthMm < 150.0);
    assert.ok(data.rmsSpotRadiusUm > 0.0);

    const svg = renderOpticalBenchSvg(data, {
      width: 960,
      height: 540,
      showRays: true,
      showSpotDiagram: true,
      darkMode: true,
    });

    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("Cooke Triplet Photographic Objective"), "Should include calculation title");
    assert.ok(svg.includes("Optical Bench Ray-Tracing"), "Should include bench layout subtitle");
    assert.ok(svg.includes("Front_Crown"), "Should label front lens");
    assert.ok(svg.includes("Mid_Flint"), "Should label middle lens");
    assert.ok(svg.includes("Focal Spot Diagram"), "Should render 2D spot diagram");
    assert.ok(svg.includes("Airy"), "Should include Airy disk reference");
  });
});

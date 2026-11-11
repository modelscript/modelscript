// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getRefractiveIndex,
  lintOpticalSystem,
  parseOpticalSystem,
  renderOpticalBenchSvg,
  type OpticalSystemData,
} from "../src/optical-bench-builder.js";

const SAMPLE_OPTICAL_BENCH = `
TITLE: Astronomical Refractor Achromatic Doublet
OBJECT_DIST: 20000.0

ELEMENT lens L1 Crown_BK7 15.0 45.0 75.0 -50.0 9.0 BK7
ELEMENT lens L2 Flint_F2  24.0 45.0 -50.0 -220.0 5.0 F2
ELEMENT aperture_stop STOP Iris 35.0 32.0
ELEMENT image_plane IMG CCD_Sensor 145.0 35.0
`;

describe("Geometrical Optics & Beam Propagation Diagram Builders (Path I)", () => {
  it("calculates Sellmeier glass dispersion for N-BK7 and F2 glasses across Fraunhofer lines", () => {
    // Fraunhofer d-line (587.6 nm)
    const nBk7D = getRefractiveIndex("BK7", 587.6);
    assert.ok(nBk7D > 1.515 && nBk7D < 1.519, `BK7 nd should be ~1.5168: got ${nBk7D}`);

    // Fraunhofer F-line (486.1 nm Blue) - should have higher index (normal dispersion)
    const nBk7F = getRefractiveIndex("BK7", 486.1);
    assert.ok(nBk7F > nBk7D, `Blue light should experience higher index: ${nBk7F} > ${nBk7D}`);

    // Fraunhofer C-line (656.3 nm Red) - should have lower index
    const nBk7C = getRefractiveIndex("BK7", 656.3);
    assert.ok(nBk7C < nBk7D, `Red light should experience lower index: ${nBk7C} < ${nBk7D}`);

    // Flint glass F2 has higher refractive index and stronger dispersion
    const nF2D = getRefractiveIndex("F2", 587.6);
    assert.ok(nF2D > 1.615 && nF2D < 1.625, `F2 nd should be ~1.620: got ${nF2D}`);
  });

  it("parses optical bench deck, traces multi-wavelength rays, and computes focal spot metrics", () => {
    const data = parseOpticalSystem(SAMPLE_OPTICAL_BENCH);
    assert.strictEqual(data.title, "Astronomical Refractor Achromatic Doublet");
    assert.strictEqual(data.elements.length, 4);

    const l1 = data.elements.find((e) => e.id === "L1")!;
    assert.strictEqual(l1.glass, "BK7");
    assert.strictEqual(l1.radiusFrontMm, 75.0);
    assert.strictEqual(l1.radiusBackMm, -50.0);
    assert.strictEqual(l1.thicknessMm, 9.0);

    assert.ok(data.rays.length >= 15, "Should trace multi-wavelength ray paths");
    assert.ok(data.effectiveFocalLengthMm > 50.0 && data.effectiveFocalLengthMm < 250.0);
    assert.ok(data.spotPoints.length > 10, "Should generate spot diagram points");
    assert.ok(data.rmsSpotRadiusUm > 0.0);
  });

  it("renders publication-grade SVG with optical bench layout, ray bundles, and spot diagram", () => {
    const data = parseOpticalSystem(SAMPLE_OPTICAL_BENCH);

    const svg = renderOpticalBenchSvg(data, {
      width: 960,
      height: 580,
      showRays: true,
      showSpotDiagram: true,
    });

    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("Astronomical Refractor"), "Should include title");
    assert.ok(svg.includes("Optical Bench Ray-Tracing"), "Should include ray-tracing subtitle");
    assert.ok(svg.includes("Crown_BK7"), "Should label Crown lens");
    assert.ok(svg.includes("Flint_F2"), "Should label Flint lens");
    assert.ok(svg.includes("Focal Spot Diagram"), "Should render 2D spot diagram");
    assert.ok(svg.includes("Airy"), "Should include Airy disk reference");
    assert.ok(svg.includes("656.3 nm (C)"), "Should label C-line in legend");
  });

  it("evaluates optical physics linter and catches unphysical refractive index and mechanical collisions", () => {
    const validData = parseOpticalSystem(SAMPLE_OPTICAL_BENCH);

    // 1. Clean data: valid optics
    const cleanDiags = lintOpticalSystem(validData);
    assert.strictEqual(cleanDiags.filter((d) => d.severity === "error").length, 0);

    // 2. Unphysical refractive index (n < 1.0)
    const badIndexData: OpticalSystemData = {
      ...validData,
      elements: validData.elements.map((e) => (e.id === "L1" ? { ...e, refractiveIndex: 0.85 } : e)),
    };
    const indexDiags = lintOpticalSystem(badIndexData);
    assert.ok(indexDiags.some((d) => d.code === "OPT1003" && d.severity === "error"));

    // 3. Mechanical lens collision along optical axis: L1 thickness 20mm starting at z=15mm -> ends at z=35mm > L2 at z=24mm!
    const collideData: OpticalSystemData = {
      ...validData,
      elements: validData.elements.map((e) => (e.id === "L1" ? { ...e, thicknessMm: 20.0 } : e)),
    };
    const colDiags = lintOpticalSystem(collideData);
    assert.ok(colDiags.some((d) => d.code === "OPT1004" && d.severity === "error"));
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerGerberToCadSolids, lowerGerberToGeometry, resolveGerberArc } from "../src/cad/index.js";
import { lowerGerberToDae } from "../src/dae/index.js";
import { parseGerber } from "../src/parser/index.js";

describe("@modelscript/gerber — CAD Geometry Lowering & DAE Lowering", () => {
  it("computes exact 2D bounding box, trace length, pad count, and copper area for strokes, arcs, flashes, and regions", () => {
    const src = [
      "%FSLAX34Y34*%",
      "%MOMM*%",
      "%ADD10C,0.500*%",
      "%ADD11R,2.000X1.000*%",
      "%ADD12C,2.000X1.000*%",
      "%LPD*%",
      "G75*",
      "D10*",
      "G01*",
      "X0Y0D02*",
      "X100000Y0D01*", // 10 mm horizontal trace, width 0.5 mm
      "G03X100000Y40000I0J20000D01*", // 180 deg CCW semicircle, r = 2 mm, arcLen = 2*pi mm
      "D11*",
      "X0Y0D03*", // 2x1 mm rect pad = 2.0 mm^2
      "D12*",
      "X100000Y40000D03*", // annular circle pad: pi*(1^2 - 0.5^2) = 0.75*pi mm^2
      "G36*",
      "G01*",
      "X20000Y10000D02*",
      "X60000Y10000D01*",
      "X60000Y30000D01*",
      "X20000Y30000D01*",
      "X20000Y10000D01*", // 4 mm x 2 mm rectangle region = 8.0 mm^2
      "G37*",
      "M02*",
    ].join("\n");

    const doc = parseGerber(src);
    const geom = lowerGerberToGeometry(doc);

    assert.equal(geom.traceCount, 1);
    assert.equal(geom.arcCount, 1);
    assert.equal(geom.padCount, 2);
    assert.equal(geom.regionCount, 1);

    const expectedTraceLen = 10.0 + Math.PI * 2.0;
    assert.ok(
      Math.abs(geom.traceLengthMm - expectedTraceLen) < 1e-6,
      `Expected trace length ${expectedTraceLen}, got ${geom.traceLengthMm}`,
    );

    const expectedLineArea = 10.0 * 0.5 + Math.PI * 0.25 * 0.25;
    const expectedArcArea = Math.PI * 2.0 * 0.5 + Math.PI * 0.25 * 0.25;
    const expectedRectPad = 2.0 * 1.0;
    const expectedAnnularPad = Math.PI * (1.0 * 1.0 - 0.5 * 0.5);
    const expectedRegionArea = 4.0 * 2.0;
    const expectedTotalArea =
      expectedLineArea + expectedArcArea + expectedRectPad + expectedAnnularPad + expectedRegionArea;

    assert.ok(
      Math.abs(geom.copperAreaMm2 - expectedTotalArea) < 1e-6,
      `Expected copper area ${expectedTotalArea}, got ${geom.copperAreaMm2}`,
    );

    // Bounding box covers X: [-1.0 (rect pad left), 12.25 (arc rightmost 10+2+0.25)]
    assert.ok(Math.abs(geom.boundingBox.minX - -1.0) < 1e-6);
    assert.ok(Math.abs(geom.boundingBox.maxX - 12.25) < 1e-6);
    assert.ok(Math.abs(geom.boundingBox.minY - -0.5) < 1e-6);
    assert.ok(Math.abs(geom.boundingBox.maxY - 5.0) < 1e-6);
  });

  it("resolves single-quadrant (G74) arcs accurately", () => {
    // 90 deg CCW arc from (10, 0) to (0, 10) around origin (0, 0)
    // In G74 single-quadrant mode, I=10, J=0 (unsigned magnitudes)
    const arc = resolveGerberArc({ x: 10, y: 0 }, { x: 0, y: 10 }, 10, 0, false, "SINGLE");
    assert.ok(Math.abs(arc.center.x - 0) < 1e-6);
    assert.ok(Math.abs(arc.center.y - 0) < 1e-6);
    assert.ok(Math.abs(arc.radius - 10) < 1e-6);
    assert.ok(Math.abs(arc.sweepAngleRad - Math.PI / 2) < 1e-6);
    assert.ok(Math.abs(arc.lengthMm - 5 * Math.PI) < 1e-6);
  });

  it("extrudes 3D copper solids via @modelscript/cad and lowers electrical RC equations into DAEBuilder", () => {
    const src = [
      "%FSLAX34Y34*%",
      "%MOMM*%",
      "%ADD10C,0.500*%",
      "%LPD*%",
      "G01*",
      "D10*",
      "X0Y0D02*",
      "X500000Y0D01*", // 50 mm trace, 0.5 mm wide
      "X500000Y0D03*",
      "M02*",
    ].join("\n");

    const doc = parseGerber(src);
    const solids = lowerGerberToCadSolids(doc, { copperThicknessMm: 0.035 });
    assert.equal(solids.length, 2, "Expected 1 trace solid + 1 pad solid");

    const builder = new DAEBuilder();
    const daeRes = lowerGerberToDae(builder, doc, {
      copperThicknessUm: 34.8,
      temperatureC: 20.0,
      relativePermittivity: 4.4,
      dielectricThicknessMm: 1.6,
    });

    assert.equal(daeRes.traces.length, 1);
    assert.ok(daeRes.equationCount >= 4, "Expected per-trace R, R_total, C_total, and tau_RC equations");
    assert.ok(daeRes.variableMap.has("R_total_ohm"));
    assert.ok(daeRes.variableMap.has("C_total_F"));
    assert.ok(daeRes.variableMap.has("tau_RC_s"));
    assert.ok(daeRes.totalTraceResistanceOhm > 0.04 && daeRes.totalTraceResistanceOhm < 0.06);
    assert.ok(daeRes.totalCapacitanceF > 0);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { gcodeToDxf, gcodeToSvg } from "../src/index.js";

const SAMPLE_PROGRAM = [
  "O3001 (PROJECTION TEST)",
  "G21 G90 G17",
  "S10000 M03",
  "G00 X0 Y0 Z10",
  "G01 Z-2 F300",
  "G01 X40 Y0 F600",
  "G03 X50 Y10 I0 J10",
  "G02 X50 Y10 I-5 J0",
  "G00 Z10",
  "G81 X20 Y20 Z-10 R2 F180",
  "G80",
  "M30",
].join("\n");

test("G-code SVG Projection: renders rapid, linear, arc, full-circle, and drill markers", () => {
  const svg = gcodeToSvg(SAMPLE_PROGRAM, { width: 800, height: 600, background: "#111827" });
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"'));
  assert.ok(svg.includes('fill="#111827"'));
  assert.ok(svg.includes('class="gcode-rapid"'));
  assert.ok(svg.includes('class="gcode-cut"'));
  assert.ok(svg.includes('<path class="gcode-arc"'));
  assert.ok(svg.includes('<circle class="gcode-arc"'));
  assert.ok(svg.includes('<circle class="gcode-drill"'));
  assert.ok(svg.trim().endsWith("</svg>"));

  const svgNoRapid = gcodeToSvg(SAMPLE_PROGRAM, { showRapid: false });
  assert.equal(svgNoRapid.includes('class="gcode-rapid"'), false);
  assert.ok(svgNoRapid.includes('class="gcode-cut"'));
});

test("G-code DXF Projection: emits layered AutoCAD ASCII DXF with LINE, ARC, and CIRCLE entities", () => {
  const dxf = gcodeToDxf(SAMPLE_PROGRAM);
  assert.ok(dxf.includes("SECTION\n2\nHEADER"));
  assert.ok(dxf.includes("SECTION\n2\nTABLES"));
  assert.ok(dxf.includes("RAPID"));
  assert.ok(dxf.includes("CUTTING"));
  assert.ok(dxf.includes("ARC"));
  assert.ok(dxf.includes("DRILL"));
  assert.ok(dxf.includes("SECTION\n2\nENTITIES"));
  assert.ok(dxf.includes("0\nLINE\n8\nRAPID"));
  assert.ok(dxf.includes("0\nLINE\n8\nCUTTING"));
  assert.ok(dxf.includes("0\nARC\n8\nARC"));
  assert.ok(dxf.includes("0\nCIRCLE\n8\nARC"));
  assert.ok(dxf.includes("0\nCIRCLE\n8\nDRILL"));
  assert.ok(dxf.trim().endsWith("EOF"));

  const dxfNoRapid = gcodeToDxf(SAMPLE_PROGRAM, { includeRapid: false });
  assert.equal(dxfNoRapid.includes("0\nLINE\n8\nRAPID"), false);
  assert.ok(dxfNoRapid.includes("0\nLINE\n8\nCUTTING"));
});

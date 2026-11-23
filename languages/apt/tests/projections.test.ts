// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { aptToGCode, aptToSvg } from "../src/index.js";

const SAMPLE_APT = [
  "PARTNO FLANGE CONTOUR",
  "UNITS / MM",
  "CUTTER / 10.0",
  "SPINDL / 5000, CLW",
  "FEDRAT / 500.0",
  "COOLNT / FLOOD",
  "SETPT = POINT / -10, -10, 0",
  "P1 = POINT / 0, 0, 0",
  "P2 = POINT / 60, 0, 0",
  "P3 = POINT / 60, 40, 0",
  "P4 = POINT / 0, 40, 0",
  "L1 = LINE / P1, P2",
  "L2 = LINE / P2, P3",
  "L3 = LINE / P3, P4",
  "L4 = LINE / P4, P1",
  "C1 = CIRCLE / 50, 10, 0, 10",
  "PL1 = PLANE / 0, 0, 1, 0",
  "FROM / SETPT",
  "RAPID",
  "GO / TO, L1, TO, PL1, TO, L4",
  "GORGT / L1, TANTO, C1",
  "GOFWD / C1, TANTO, L2",
  "GOLFT / L2, PAST, L3",
  "COOLNT / OFF",
  "SPINDL / OFF",
  "FINI",
].join("\n");

test("APT Projections: aptToGCode emits valid RS-274 G-code with G21, G00, G01, G03, M03, M08, M30", () => {
  const gcode = aptToGCode(SAMPLE_APT, { programNumber: 2025, precision: 3 });

  assert.ok(gcode.startsWith("%\nO2025 (FLANGE CONTOUR)"));
  assert.ok(gcode.includes("G21 G90 G17 G40"));
  assert.ok(gcode.includes("S5000 M03"));
  assert.ok(gcode.includes("M08"));
  assert.ok(gcode.includes("G00 X-10.000 Y-10.000 Z0.000"));
  assert.ok(gcode.includes("G01 "));
  assert.ok(gcode.includes("G03 "));
  assert.ok(gcode.includes("I0.000 J15.000"));
  assert.ok(gcode.includes("M09"));
  assert.ok(gcode.includes("M05"));
  assert.ok(gcode.includes("M30"));
  assert.ok(gcode.trimEnd().endsWith("%"));

  const noNums = aptToGCode(SAMPLE_APT, { lineNumbers: false });
  assert.ok(!/^N\d+ /m.test(noNums));
});

test("APT Projections: aptToSvg emits standalone SVG with geometry, rapid, linear, and arc elements", () => {
  const svg = aptToSvg(SAMPLE_APT, { width: 800, height: 600 });

  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"'));
  assert.ok(svg.includes("FLANGE CONTOUR"));
  assert.ok(svg.includes('class="apt-from"'));
  assert.ok(svg.includes('class="apt-rapid"'));
  assert.ok(svg.includes('class="apt-cut"'));
  assert.ok(svg.includes('class="apt-arc"'));
  assert.ok(svg.includes('class="apt-geom-circle"'));
  assert.ok(svg.trimEnd().endsWith("</svg>"));

  const minimalSvg = aptToSvg(SAMPLE_APT, { showRapid: false, showGeometry: false });
  assert.ok(!minimalSvg.includes('class="apt-rapid"'));
  assert.ok(!minimalSvg.includes('class="apt-geom-circle"'));
  assert.ok(minimalSvg.includes('class="apt-cut"'));
});

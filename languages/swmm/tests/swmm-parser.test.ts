// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseSwmm } from "../src/index.js";
import { SWMM_URBAN_WATERSHED_BENCHMARK } from "./swmm-benchmark-runner.js";

test("SWMM Parser: parses complete options, junctions, and conduits", () => {
  const project = parseSwmm(SWMM_URBAN_WATERSHED_BENCHMARK);

  assert.equal(project.flowUnits, "CMS");
  assert.equal(project.routingModel, "DYNWAVE");
  assert.equal(project.options["INFILTRATION"], "HORTON");

  const j1 = project.junctions.get("J1");
  assert.ok(j1, "Junction J1 must exist");
  assert.equal(j1.elevation, 30.0);
  assert.equal(j1.maxDepth, 3.0);

  const of1 = project.outfalls.get("OF1");
  assert.ok(of1, "Outfall OF1 must exist");
  assert.equal(of1.elevation, 20.0);
  assert.equal(of1.type, "FREE");

  const c1 = project.conduits.get("C1");
  assert.ok(c1, "Conduit C1 must exist");
  assert.equal(c1.inletNode, "J1");
  assert.equal(c1.outletNode, "J2");
  assert.equal(c1.length, 150.0);
  assert.equal(c1.roughness, 0.013);
});

test("SWMM Parser: parses complex cross-sections and subcatchments", () => {
  const project = parseSwmm(SWMM_URBAN_WATERSHED_BENCHMARK);

  const xsecC3 = project.crossSections.get("C3");
  assert.ok(xsecC3, "Cross section C3 must exist");
  assert.equal(xsecC3.shape, "RECT_CLOSED");
  assert.equal(xsecC3.geom1, 2.0);
  assert.equal(xsecC3.geom2, 1.5);

  const sc1 = project.subcatchments.get("SC1");
  assert.ok(sc1, "Subcatchment SC1 must exist");
  assert.equal(sc1.outlet, "J1");
  assert.equal(sc1.area, 5.0);
  assert.equal(sc1.impervPct, 70.0);
});

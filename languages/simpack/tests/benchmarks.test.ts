// SPDX-License-Identifier: AGPL-3.0-or-later

import { initBltWasm } from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  analyzeMobility,
  getWasmKinematicsBridge,
  lintSimpackModel,
  lowerSimpackToDae,
  parseSpckXml,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, "..", "testsuite", "DoubleWishbone.spck");

describe("SIMPACK Double-Wishbone Automotive Suspension Benchmark", () => {
  it("should parse and validate the Double-Wishbone suspension mechanism", () => {
    const xml = fs.readFileSync(fixturePath, "utf-8");
    const model = parseSpckXml(xml, "DoubleWishbone");

    assert.equal(model.name, "DoubleWishbone");
    assert.equal(model.bodies.size, 5);
    assert.equal(model.markers.size, 12);
    assert.equal(model.joints.size, 5);
    assert.equal(model.forces.size, 1);

    const diags = lintSimpackModel(model);
    assert.equal(diags.length, 0, "Benchmark model must have zero lint diagnostics");

    const mobility = analyzeMobility(model);
    assert.equal(mobility.numBodies, 5);
    assert.equal(mobility.numJoints, 5);

    // 5 moving bodies (30 coord dofs) - (3 revolute * 5 + 2 spherical * 3 = 21 constraints) = 9 dofs
    // (6 chassis rigid dofs + 1 suspension vertical dof + 1 steering dof + 1 wheel spin dof = 9 dofs)
    assert.equal(mobility.calculatedMobility, 9);
    assert.equal(mobility.isOverconstrained, false);
  });

  it("should lower Double-Wishbone dynamics into DAE and simulate jounce response", async () => {
    await initBltWasm();

    const xml = fs.readFileSync(fixturePath, "utf-8");
    const model = parseSpckXml(xml, "DoubleWishbone");
    const dae = lowerSimpackToDae(model);

    // 5 bodies * 12 vars + 1 coilover * 3 vars = 63 variables
    assert.equal(dae.varCount, 63);
    // 63 constitutive/Newton-Euler equations + 5 joints * 3 position constraints = 78 equations
    assert.equal(dae.eqCount, 78);

    // Apply 50 mm vertical bump to wheel hub
    const hubZIdx = dae.lookupVariable("b_hub.z");
    assert.ok(hubZIdx >= 0);
    dae.setVarStartValue(hubZIdx, 0.05);

    const result = simulateArena(dae, {
      startTime: 0,
      stopTime: 0.4,
      step: 0.002,
    });

    assert.ok(result.t.length > 100);
    const zStateIdx = result.states.indexOf("b_hub.z");
    assert.ok(zStateIdx >= 0);
    assert.equal(result.y[0]![zStateIdx], 0.05);
  });

  it("should evaluate all suspension joints in WebAssembly linear memory", async () => {
    const bridge = getWasmKinematicsBridge();
    const xml = fs.readFileSync(fixturePath, "utf-8");
    const model = parseSpckXml(xml, "DoubleWishbone");

    const identity = bridge.identityMatrix();
    const markerTransforms = Array.from(model.markers.values()).map((m) => ({
      position: m.position,
      rotation: identity,
    }));

    const markerMap = new Map(Array.from(model.markers.keys()).map((k, idx) => [k, idx]));

    const jointSpecs = Array.from(model.joints.values()).map((j) => ({
      id: j.id,
      type: j.type,
      markerAIdx: markerMap.get(j.fromMarker) ?? 0,
      markerBIdx: markerMap.get(j.toMarker) ?? 0,
    }));

    const residuals = bridge.batchEvaluateJoints(jointSpecs, markerTransforms);
    assert.equal(residuals.length, 5);
    for (const r of residuals) {
      assert.ok(r.constraintNorm >= 0);
    }
  });
});

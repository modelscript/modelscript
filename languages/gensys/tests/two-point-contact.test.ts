// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findMultiPointWheelRailContact, getWasmContactBridge } from "../src/index.js";

describe("Two-Point Wheel-Rail Contact Mechanics with Multi-Patch Creep", () => {
  it("should evaluate single-point tread contact at small lateral displacements", () => {
    const totalLoad = 100000; // 100 kN
    const res = findMultiPointWheelRailContact(0.0, 0.46, 1 / 40, totalLoad);

    assert.equal(res.isTwoPointContact, false);
    assert.equal(res.patches.length, 1);
    assert.equal(res.treadPatch.patchType, "tread");
    assert.equal(res.flangePatch, undefined);
    assert.equal(res.treadPatch.normalForceShare, 1.0);

    // Tread contact angle should be small (~0.035 rad, ~2 deg)
    assert.ok(res.treadPatch.contactAngleRad < 0.1);
    assert.ok(Math.abs(res.treadPatch.normalForceN * Math.cos(res.treadPatch.contactAngleRad) - totalLoad) < 1.0);
  });

  it("should detect two-point contact (tread + flange) under flange clearance threshold", () => {
    const totalLoad = 100000; // 100 kN
    // Shift wheelset 7.5 mm towards rail gauge corner
    const res = findMultiPointWheelRailContact(0.0075, 0.46, 1 / 40, totalLoad);

    assert.equal(res.isTwoPointContact, true);
    assert.equal(res.patches.length, 2);
    assert.ok(res.flangePatch !== undefined);
    assert.equal(res.treadPatch.patchType, "tread");
    assert.equal(res.flangePatch?.patchType, "flange");

    // Flange contact angle must be significantly steeper than tread
    assert.ok(
      res.flangePatch!.contactAngleRad > res.treadPatch.contactAngleRad,
      "Flange contact angle must exceed tread angle",
    );
    assert.ok(
      res.flangePatch!.contactAngleRad > 0.4,
      `Expected flange angle > 0.4 rad, got ${res.flangePatch!.contactAngleRad}`,
    );

    // Load sharing: N1*cos(delta1) + N2*cos(delta2) == Q
    const N1 = res.treadPatch.normalForceN;
    const N2 = res.flangePatch!.normalForceN;
    const delta1 = res.treadPatch.contactAngleRad;
    const delta2 = res.flangePatch!.contactAngleRad;
    const verticalSum = N1 * Math.cos(delta1) + N2 * Math.cos(delta2);

    assert.ok(
      Math.abs(verticalSum - totalLoad) < 1.0,
      `Vertical load equilibrium must balance total load: expected ${totalLoad}, got ${verticalSum}`,
    );

    // Both patches carry non-zero load
    assert.ok(res.treadPatch.normalForceShare > 0.05);
    assert.ok(res.flangePatch!.normalForceShare > 0.05);
    assert.ok(Math.abs(res.treadPatch.normalForceShare + res.flangePatch!.normalForceShare - 1.0) < 1e-4);

    // Lateral guidance force must be directed away from rail gauge corner
    assert.ok(res.totalLateralNormalForce > 0);
  });

  it("should evaluate batched WASM creep forces for multi-point contact patches", () => {
    const totalLoad = 90000;
    const contact = findMultiPointWheelRailContact(0.0075, 0.46, 1 / 40, totalLoad);
    assert.equal(contact.isTwoPointContact, true);

    const bridge = getWasmContactBridge();

    // Map tread and flange patches into contact inputs for WASM Fastsim batch
    const inputs = contact.patches.map((patch) => {
      const isFlange = patch.patchType === "flange";
      return {
        normalForce: patch.normalForceN,
        longitudinalCreep: 0.002,
        lateralCreep: isFlange ? 0.005 : 0.001,
        wheelVelocity: 20.0,
        spin: isFlange ? 0.15 : 0.01,
        ellipseSemiMajor: isFlange ? 0.004 : 0.006,
        ellipseSemiMinor: isFlange ? 0.003 : 0.005,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.35,
        staticFriction: 0.35,
      };
    });

    const fastsimResults = bridge.batchFastsim(inputs, 15);
    assert.equal(fastsimResults.length, 2);

    const [treadFastsim, flangeFastsim] = fastsimResults;
    assert.ok(treadFastsim && flangeFastsim);
    assert.ok(treadFastsim.fx > 0);
    assert.ok(flangeFastsim.fx > 0);
    assert.ok(treadFastsim.adhesionRatio <= 1.0);
    assert.ok(flangeFastsim.adhesionRatio <= 1.0);

    const polachResults = bridge.batchPolach(inputs);
    assert.equal(polachResults.length, 2);
    const [treadPolach, flangePolach] = polachResults;
    assert.ok(treadPolach && flangePolach);
    assert.ok(treadPolach.fx > 0);
    assert.ok(flangePolach.fx > 0);
  });
});

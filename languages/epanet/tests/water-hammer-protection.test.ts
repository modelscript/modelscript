// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  solveWaterHammerMoc,
  type WaterHammerPipeParams,
} from "../src/index.js";

describe("EPANET MOC Surge Protection Devices", () => {
  const pipe: WaterHammerPipeParams = {
    id: "Transmission_Main_1",
    lengthM: 600.0,
    diameterM: 0.4, // 400 mm
    waveSpeedMps: 1200.0,
    darcyRoughness: 0.02,
    elevationUpstreamM: 50.0,
    elevationDownstreamM: 10.0,
  };

  const steadyInitial = {
    flowM3s: 0.25, // 250 L/s (v0 = 1.99 m/s)
    headUpstreamM: 80.0,
    headDownstreamM: 65.0,
  };

  const fastClosure = {
    type: "VALVE_CLOSURE" as const,
    durationSeconds: 0.1, // Rapid closure (< 2L/a = 1.0s) -> full Joukowsky surge
    exponent: 1.0,
  };

  it("1. Unprotected baseline produces severe Joukowsky acoustic surge", () => {
    const unprot = solveWaterHammerMoc(pipe, steadyInitial, fastClosure, {
      simulationDurationSeconds: 4.0,
      spatialReaches: 12,
    });

    assert.ok(unprot.joukowskySurgeM > 200.0, "Joukowsky surge should be ~240m");
    assert.ok(unprot.maxHeadM > 250.0, "Peak head should exceed 250m");
    assert.strictEqual(unprot.surgeProtectionActive, false);
    assert.strictEqual(unprot.surgeSuppressionRatioPct, undefined);
  });

  it("2. Hydropneumatic Air Vessel suppresses peak acoustic surge and cushions pressure waves", () => {
    const unprot = solveWaterHammerMoc(pipe, steadyInitial, fastClosure, {
      simulationDurationSeconds: 4.0,
      spatialReaches: 12,
    });

    const withVessel = solveWaterHammerMoc(pipe, steadyInitial, fastClosure, {
      simulationDurationSeconds: 4.0,
      spatialReaches: 12,
      surgeProtection: {
        type: "AIR_VESSEL",
        initialAirVolumeM3: 2.5, // 2.5 m^3 air cushion
        polytropicExponent: 1.2,
        orificeLossCoeffInflow: 0.5,
        orificeLossCoeffOutflow: 2.0,
      },
    });

    assert.strictEqual(withVessel.surgeProtectionActive, true);
    assert.ok(
      withVessel.maxHeadM < unprot.maxHeadM * 0.6,
      `Air vessel must suppress peak head: got ${withVessel.maxHeadM.toFixed(1)}m vs unprot ${unprot.maxHeadM.toFixed(1)}m`,
    );
    assert.ok((withVessel.surgeSuppressionRatioPct ?? 0) > 40.0, "Surge suppression ratio should exceed 40%");

    // Verify air vessel tracked volume changes
    const hasVolumeTracking = withVessel.timeSeries.some(
      (ts) => ts.airVesselVolumeM3 !== undefined && ts.airVesselVolumeM3 !== 2.5,
    );
    assert.ok(hasVolumeTracking, "Air vessel volume should dynamically compress/expand");
  });

  it("3. Dual-Chamber Air Release / Vacuum Relief Valve prevents negative pressure column separation", () => {
    // Fast pump trip with flow collapse
    const pumpTrip = {
      type: "PUMP_TRIP" as const,
      durationSeconds: 0.2,
    };

    const unprotTrip = solveWaterHammerMoc(pipe, steadyInitial, pumpTrip, {
      simulationDurationSeconds: 3.0,
      spatialReaches: 10,
    });

    const withAirValve = solveWaterHammerMoc(pipe, steadyInitial, pumpTrip, {
      simulationDurationSeconds: 3.0,
      spatialReaches: 10,
      surgeProtection: {
        type: "AIR_VALVE",
        inletOrificeDiameterMm: 100, // 100 mm vacuum breaker
        outletOrificeDiameterMm: 25, // 25 mm exhaust
        dischargeCoeff: 0.65,
      },
    });

    assert.strictEqual(withAirValve.surgeProtectionActive, true);
    // Head at protected downstream station must remain at or above atmospheric elevation (10.0m)
    assert.ok(
      withAirValve.minHeadDownstreamM !== undefined && withAirValve.minHeadDownstreamM >= 9.9,
      `Vacuum relief valve must prevent sub-atmospheric downstream head: got ${withAirValve.minHeadDownstreamM?.toFixed(2)}m`,
    );
    assert.ok(
      (unprotTrip.minHeadDownstreamM ?? 0) < 5.0,
      `Unprotected pump trip must experience negative gauge head at downstream: got ${unprotTrip.minHeadDownstreamM?.toFixed(2)}m`,
    );
  });

  it("4. Spring-Loaded Pressure Relief Valve (PRV) caps peak surge to set threshold", () => {
    const unprot = solveWaterHammerMoc(pipe, steadyInitial, fastClosure, {
      simulationDurationSeconds: 4.0,
      spatialReaches: 12,
    });

    const setPressureM = 95.0; // Cap pressure rise at 95m (steady head is 65m)
    const withPrv = solveWaterHammerMoc(pipe, steadyInitial, fastClosure, {
      simulationDurationSeconds: 4.0,
      spatialReaches: 12,
      surgeProtection: {
        type: "RELIEF_VALVE",
        setPressureHeadM: setPressureM,
        dischargeCoeff: 0.05, // Rapid blowoff capacity
      },
    });

    assert.strictEqual(withPrv.surgeProtectionActive, true);
    assert.ok(
      withPrv.maxHeadM < unprot.maxHeadM * 0.5,
      `PRV must relieve surge head: got ${withPrv.maxHeadM.toFixed(1)}m vs unprot ${unprot.maxHeadM.toFixed(1)}m`,
    );
    assert.ok(
      withPrv.maxHeadM <= setPressureM + 15.0,
      `PRV should clamp peak head near set threshold: ${withPrv.maxHeadM.toFixed(1)}m <= ${setPressureM + 15}m`,
    );
  });
});

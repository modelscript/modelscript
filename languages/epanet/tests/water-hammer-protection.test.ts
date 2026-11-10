// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { solveWaterHammerMoc, type WaterHammerPipeParams } from "../src/index.js";

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

  it("5. Discrete Vapor Cavity Model (DVCM) tracks column separation and collapse shockwave (HAMMER Parity)", () => {
    // Pipeline on a steep hill where sudden downstream valve closure sends negative reflection
    const uphillPipe: WaterHammerPipeParams = {
      id: "High_Ridge_Pumping_Line",
      lengthM: 800.0,
      diameterM: 0.3,
      waveSpeedMps: 1000.0,
      darcyRoughness: 0.02,
      elevationUpstreamM: 10.0,
      elevationDownstreamM: 60.0, // High crest
    };

    const uphillInitial = {
      flowM3s: 0.15,
      headUpstreamM: 95.0,
      headDownstreamM: 85.0,
    };

    // Fast valve closure causing deep low-pressure depression wave
    const tripEvent = {
      type: "VALVE_CLOSURE" as const,
      durationSeconds: 0.05,
    };

    const dvcmResult = solveWaterHammerMoc(uphillPipe, uphillInitial, tripEvent, {
      simulationDurationSeconds: 4.0,
      spatialReaches: 16,
      vaporPressureHeadM: -10.0,
      enableDvcmCavitation: true,
      dvcmWeightingFactor: 0.5,
    });

    assert.strictEqual(dvcmResult.cavitationOccurred, true, "Cavitation must occur during low-pressure depression");
    assert.ok(
      (dvcmResult.maxCavityVolumeM3 ?? 0) > 0.0,
      `Vapor cavity volume must be tracked: got ${dvcmResult.maxCavityVolumeM3} m^3`,
    );
    assert.strictEqual(dvcmResult.cavitationCollapseOccurred, true, "Cavitation cavity must collapse");
    assert.ok(
      (dvcmResult.maxCollapseSurgeM ?? 0) > uphillInitial.headDownstreamM,
      `Collapse surge spike must exceed initial downstream head: got ${dvcmResult.maxCollapseSurgeM}m`,
    );
  });

  it("6. Four-Quadrant Suter Pump Coastdown simulates flow reversal and check valve slam (HAMMER Parity)", () => {
    // Pumping uphill from wet well into high-pressure discharge reservoir
    const uphillPumpPipe: WaterHammerPipeParams = {
      id: "Pump_Station_Discharge_Line",
      lengthM: 600.0,
      diameterM: 0.4,
      waveSpeedMps: 1200.0,
      darcyRoughness: 0.02,
      elevationUpstreamM: 10.0,
      elevationDownstreamM: 50.0,
    };

    const uphillPumpInitial = {
      flowM3s: 0.25,
      headUpstreamM: 90.0, // Initial discharge head into pipeline (suction = 10m + pump head = 80m)
      headDownstreamM: 80.0, // High discharge reservoir head
    };

    const pumpTripEvent = {
      type: "PUMP_TRIP" as const,
      durationSeconds: 5.0,
      pumpCoastdown: {
        specificSpeedType: "RADIAL" as const,
        momentOfInertiaKgM2: 25.0, // Typical pump + motor polar moment of inertia
        ratedSpeedRpm: 1750.0,
        ratedFlowM3s: 0.25,
        ratedHeadM: 80.0,
        ratedEfficiency: 0.82,
        hasCheckValve: true, // Non-return check valve
      },
    };

    const pumpResult = solveWaterHammerMoc(uphillPumpPipe, uphillPumpInitial, pumpTripEvent, {
      simulationDurationSeconds: 4.0,
      spatialReaches: 12,
      suctionHeadM: 10.0,
    });

    // Check valve slam head should be registered
    assert.ok(
      pumpResult.checkValveSlamHeadM !== undefined,
      "Check valve slam head should be captured upon flow reversal",
    );

    // Verify time series captures pump telemetry
    const initialStep = pumpResult.timeSeries[0]!;
    assert.strictEqual(initialStep.pumpQuadrant, "NORMAL");
    assert.ok(
      (initialStep.pumpSpeedRpm ?? 0) > 1700.0,
      `Initial pump speed should match rated rpm: got ${initialStep.pumpSpeedRpm}`,
    );

    // Verify deceleration
    const laterStep = pumpResult.timeSeries[pumpResult.timeSeries.length - 1]!;
    assert.ok(
      (laterStep.pumpSpeedRpm ?? 0) < (initialStep.pumpSpeedRpm ?? 0),
      "Pump rotational speed must decelerate following power failure",
    );

    // Verify that check valve prevented severe reverse flow
    const hasNegativeFlow = pumpResult.timeSeries.some((ts) => ts.flowUpstreamM3s < -0.05);
    assert.strictEqual(hasNegativeFlow, false, "Check valve must prevent large reverse flow");

    // Also test pump WITHOUT check valve entering turbine runaway
    const runawayEvent = {
      type: "PUMP_TRIP" as const,
      durationSeconds: 6.0,
      pumpCoastdown: {
        specificSpeedType: "RADIAL" as const,
        momentOfInertiaKgM2: 15.0,
        ratedSpeedRpm: 1750.0,
        ratedFlowM3s: 0.25,
        ratedHeadM: 70.0,
        ratedEfficiency: 0.82,
        hasCheckValve: false, // Uncontrolled reverse runaway
      },
    };

    const runawayResult = solveWaterHammerMoc(uphillPumpPipe, uphillPumpInitial, runawayEvent, {
      simulationDurationSeconds: 5.0,
      spatialReaches: 10,
      suctionHeadM: 10.0,
    });

    assert.ok(
      (runawayResult.maxReverseFlowM3s ?? 0) > 0.05,
      `Unprotected pump trip must experience reverse flow: got ${runawayResult.maxReverseFlowM3s} m^3/s`,
    );
  });
});

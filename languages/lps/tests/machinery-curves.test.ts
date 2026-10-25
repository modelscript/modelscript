// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { CompressorMapEngine } from "../src/solver/machinery/compressor-map.js";
import { PumpCurveEngine } from "../src/solver/machinery/pump-curve.js";

test("CompressorMap: Evaluates nominal pipeline operating point within speed and power envelope", () => {
  const map = CompressorMapEngine.createDefaultPipelineMap(15.0e6, 9500); // 15 MW rated
  const suctionP = 50.0e5; // 50 bar
  const suctionT = 290.15; // ~17 °C
  const targetDischargeP = 75.0e5; // 75 bar (1.5 pressure ratio)
  const massFlowKgS = 85.0; // 85 kg/s

  const gasProps = {
    molarMass: 0.017,
    zFactor: 0.87,
    isentropicExponent: 1.3,
    lhvMjKg: 47.0,
  };

  const point = CompressorMapEngine.evaluate(map, suctionP, suctionT, targetDischargeP, massFlowKgS, gasProps);

  assert.ok(
    point.speedRpm >= map.minSpeedRpm && point.speedRpm <= map.maxSpeedRpm,
    "Speed must be within governor limits",
  );
  assert.ok(point.pressureRatio >= 1.45 && point.pressureRatio <= 1.55, "Achieved pressure ratio should meet target");
  assert.ok(point.dischargePressurePa > suctionP, "Discharge pressure must exceed suction pressure");
  assert.ok(point.dischargeTempK > suctionT, "Gas must warm up during compression");
  assert.ok(point.polytropicEfficiency > 0.7 && point.polytropicEfficiency < 0.9, "Polytropic efficiency realistic");
  assert.ok(point.shaftPowerWatts > 2.0e6 && point.shaftPowerWatts < 15.0e6, "Shaft power within 15 MW rating");
  assert.ok(point.fuelGasRateKgS > 0.1 && point.fuelGasRateKgS < 2.0, "Fuel gas consumption realistic");
  assert.equal(point.isSurging, false, "Should not surge at nominal 85 kg/s flow");
  assert.equal(point.antiSurgeRecycleFlowM3s, 0.0, "Anti-surge valve closed at nominal flow");
});

test("CompressorMap: Anti-Surge Controller modulates recycle valve under low inflow", () => {
  const map = CompressorMapEngine.createDefaultPipelineMap(15.0e6, 9500);
  const suctionP = 50.0e5;
  const suctionT = 290.15;
  const targetDischargeP = 75.0e5;
  const lowMassFlowKgS = 15.0; // Very low flow rate -> triggers surge line

  const gasProps = {
    molarMass: 0.017,
    zFactor: 0.87,
    isentropicExponent: 1.3,
  };

  const point = CompressorMapEngine.evaluate(map, suctionP, suctionT, targetDischargeP, lowMassFlowKgS, gasProps);

  assert.ok(point.isSurging || point.antiSurgeRecycleFlowM3s > 0, "Low flow must trigger surge or anti-surge recycle");
  assert.ok(point.antiSurgeRecycleFlowM3s > 0, "Recycle valve must open to protect compressor");
});

test("PumpCurve: Evaluates centrifugal pump operating point and VFD speed scaling", () => {
  const pumpCurve = PumpCurveEngine.createDefaultPipelinePump(3.0e6, 2950);
  const suctionP = 15.0e5; // 15 bar suction
  const flowM3s = 0.3; // ~1080 m3/h
  const liquidProps = {
    densityKgM3: 840.0, // Crude / diesel
    vaporPressurePa: 50.0e3, // 0.5 bar Reid vapor pressure
  };

  const point = PumpCurveEngine.evaluate(pumpCurve, suctionP, flowM3s, liquidProps, 65.0e5); // 65 bar target

  assert.ok(point.headMeters > 400.0 && point.headMeters < 900.0, "Delivered head should be realistic");
  assert.ok(point.differentialPressurePa > 30.0e5, "Differential pressure should be positive (> 30 bar)");
  assert.ok(point.dischargePressurePa > suctionP, "Discharge pressure > suction pressure");
  assert.ok(point.efficiency > 0.7 && point.efficiency < 0.9, "Pump hydraulic efficiency ~80%");
  assert.ok(point.shaftPowerWatts > 1.0e6 && point.shaftPowerWatts <= 3.2e6, "Power within 3 MW rating");
  assert.equal(point.isCavitationHazard, false, "15 bar suction provides ample NPSHA margin");
});

test("PumpCurve: NPSH cavitation check detects low suction pressure hazard", () => {
  const pumpCurve = PumpCurveEngine.createDefaultPipelinePump(3.0e6, 2950);
  const lowSuctionP = 60.0e3; // Only 0.6 bar suction (near 0.5 bar vapor pressure)
  const flowM3s = 0.35; // High runout flow -> high NPSHR
  const liquidProps = {
    densityKgM3: 840.0,
    vaporPressurePa: 55.0e3,
  };

  const point = PumpCurveEngine.evaluate(pumpCurve, lowSuctionP, flowM3s, liquidProps);

  assert.ok(point.npshMarginMeters < 1.0, "NPSH margin should be severely depleted");
  assert.equal(point.isCavitationHazard, true, "Cavitation hazard must be flagged");
});

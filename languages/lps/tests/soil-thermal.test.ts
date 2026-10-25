// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { SoilThermalEngine } from "../src/solver/thermal/soil-diffusion.ts";
import type { LpsPipe } from "../src/types.js";

test("SoilThermalEngine: Discretizes 10-layer concentric radial cylindrical mesh around buried pipe", () => {
  const pipe: LpsPipe = {
    name: "Buried_Transmission_Loop",
    fromNode: "Station_A",
    toNode: "Station_B",
    length: 10000,
    diameter: 0.914, // 36-inch mainline
    roughness: 4.5e-5,
    maop: 100e5,
    wallThickness: 0.0159,
  };

  const initialFluidT = 318.15; // 45 deg C
  const ambientGroundT = 283.15; // 10 deg C

  const profile = SoilThermalEngine.createInitialSoilProfile(pipe, 1.8, initialFluidT, ambientGroundT, 10);

  assert.equal(profile.shellRadiiM.length, 11);
  assert.equal(profile.shellTempsK.length, 11);

  // First boundary radius should match outer pipe radius
  const expectedR0 = pipe.diameter / 2.0 + (pipe.wallThickness ?? 0.0127);
  assert.ok(Math.abs(profile.shellRadiiM[0]! - expectedR0) < 1e-4);

  // Far-field boundary radius should be at least 10x pipe radius
  assert.ok(profile.shellRadiiM[10]! >= 10.0 * expectedR0);

  // Inner temperature near fluid, outer temperature equals ambient
  assert.ok(profile.shellTempsK[0]! > ambientGroundT);
  assert.equal(profile.shellTempsK[10], ambientGroundT);
});

test("SoilThermalEngine: Advances transient radial diffusion and calculates positive heat loss", () => {
  const pipe: LpsPipe = {
    name: "Buried_Segment",
    fromNode: "Inlet",
    toNode: "Outlet",
    length: 5000,
    diameter: 0.762, // 30-inch
    roughness: 4.5e-5,
    maop: 80e5,
    wallThickness: 0.0127,
  };

  const initialFluidT = 313.15; // 40 deg C
  const ambientGroundT = 280.15; // 7 deg C

  let state = SoilThermalEngine.createInitialSoilProfile(pipe, 1.5, initialFluidT, ambientGroundT, 10);
  state = SoilThermalEngine.advanceTimeStep(state, pipe, initialFluidT, 60.0, ambientGroundT);

  assert.ok(state.heatLossRateWattsPerM > 0, "Heat loss from hot fluid to colder ground must be positive");
  assert.ok(state.heatLossRateWattsPerM < 5000, "Heat loss rate per meter within realistic range");
  assert.equal(state.shellTempsK[10], ambientGroundT, "Far-field boundary remains at ambient ground temperature");
});

test("SoilThermalEngine: Simulates 48-hour pipeline cooldown post-shutdown with smooth monotonic decay", () => {
  const pipe: LpsPipe = {
    name: "Shutdown_Pipeline",
    fromNode: "Plant_Out",
    toNode: "Meter_In",
    length: 20000,
    diameter: 0.508, // 20-inch
    roughness: 4.5e-5,
    maop: 75e5,
    wallThickness: 0.0127,
  };

  const initialFluidT = 315.15; // 42 deg C
  const ambientGroundT = 283.15; // 10 deg C

  const sim = SoilThermalEngine.simulateCooldown(pipe, 48.0, initialFluidT, ambientGroundT);

  assert.ok(sim.timesHours.length > 10);
  assert.equal(sim.fluidTempsK[0], initialFluidT);

  // Final fluid temperature after 48h must be significantly cooler than initial, but above ambient
  const finalFluidT = sim.fluidTempsK[sim.fluidTempsK.length - 1]!;
  assert.ok(finalFluidT < initialFluidT - 5.0, "Fluid should cool substantially over 48 hours");
  assert.ok(finalFluidT >= ambientGroundT, "Fluid temperature cannot fall below ambient ground temperature");

  // Monotonic temperature decrease
  for (let i = 1; i < sim.fluidTempsK.length; i++) {
    assert.ok(sim.fluidTempsK[i]! <= sim.fluidTempsK[i - 1]! + 1e-4, "Temperature must decay monotonically");
  }
});

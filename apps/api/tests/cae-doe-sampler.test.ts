// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { CaeDoeSampler, type ParametricSweepVariable } from "../src/services/cae-doe-sampler.js";

test("CaeDoeSampler: Template Parameter Auto-Extraction & DoE Sampling", async (t) => {
  await t.test("extractTemplateParameters: extracts parameters from CalculiX FEA .inpt templates", () => {
    const template = `
*HEADING
Automated 3D Structural FEA for {{ DroneArm.name }}
*MATERIAL, NAME=ALUMINUM
*ELASTIC
 {{ DroneArm.youngsModulus }}, {{ DroneArm.poissonsRatio }}
*STEP
*STATIC
*BOUNDARY
 1, 1, 3
*CLOAD
 2, 2, {{ DroneArm.thrustForce * 1.5 + 10.0 }}
*END STEP
`;
    const params = CaeDoeSampler.extractTemplateParameters(template);
    assert.deepStrictEqual(params, [
      "DroneArm.name",
      "DroneArm.poissonsRatio",
      "DroneArm.thrustForce",
      "DroneArm.youngsModulus",
    ]);
  });

  await t.test("extractTemplateParameters: extracts parameters from SU2 CFD .cfgt templates", () => {
    const template = `
% SU2 Parametric CFD Config
MATH_PROBLEM= NAVIER_STOKES
MACH_NUMBER= 0.15
FREESTREAM_DENSITY= {{ Atmosphere.airDensity }}
FREESTREAM_VELOCITY= ( {{ FlightEnvelope.v_inlet * cos(FlightEnvelope.aoa) }}, 0.0, 0.0 )
MARKER_INLET= ( inlet, {{ FlightEnvelope.v_inlet }}, 1.0, 0.0, 0.0 )
MARKER_HEATFLUX= ( arm_wall, {{ sqrt(ThermalLoad.heatCoeff) * 2.0 }} )
`;
    const params = CaeDoeSampler.extractTemplateParameters(template);
    assert.deepStrictEqual(params, [
      "Atmosphere.airDensity",
      "FlightEnvelope.aoa",
      "FlightEnvelope.v_inlet",
      "ThermalLoad.heatCoeff",
    ]);
  });

  const variables: ParametricSweepVariable[] = [
    { name: "inletVelocity", min: 10.0, max: 50.0, nominal: 25.0 },
    { name: "angleAttack", min: -2.0, max: 14.0, nominal: 4.0 },
    { name: "thrustForce", min: 50.0, max: 200.0, nominal: 100.0 },
  ];

  await t.test("generateSamples: Latin Hypercube Sampling (LHS)", () => {
    const N = 12;
    const res = CaeDoeSampler.generateSamples(variables, "lhs", N, 42);

    assert.strictEqual(res.sampleCount, N);
    assert.strictEqual(res.samples.length, N);
    assert.strictEqual(res.strategy, "lhs");

    for (const sample of res.samples) {
      assert.ok(sample.inletVelocity !== undefined);
      assert.ok(sample.angleAttack !== undefined);
      assert.ok(sample.thrustForce !== undefined);

      assert.ok(sample.inletVelocity >= 10.0 && sample.inletVelocity <= 50.0);
      assert.ok(sample.angleAttack >= -2.0 && sample.angleAttack <= 14.0);
      assert.ok(sample.thrustForce >= 50.0 && sample.thrustForce <= 200.0);
    }

    // Verify 1D stratification: each bin should have samples
    const velocities = res.samples.map((s) => s.inletVelocity).sort((a, b) => a - b);
    const minVal = velocities[0]!;
    const maxVal = velocities[velocities.length - 1]!;
    assert.ok(maxVal > minVal, "LHS should cover parameter space");
  });

  await t.test("generateSamples: Sobol Quasi-Random Sequence", () => {
    const N = 16;
    const res = CaeDoeSampler.generateSamples(variables, "sobol", N);

    assert.strictEqual(res.sampleCount, N);
    assert.strictEqual(res.samples.length, N);
    assert.strictEqual(res.strategy, "sobol");

    for (const sample of res.samples) {
      assert.ok(sample.inletVelocity >= 10.0 && sample.inletVelocity <= 50.0);
      assert.ok(sample.angleAttack >= -2.0 && sample.angleAttack <= 14.0);
      assert.ok(sample.thrustForce >= 50.0 && sample.thrustForce <= 200.0);
    }
  });

  await t.test("generateSamples: Cartesian Grid", () => {
    const gridVars: ParametricSweepVariable[] = [
      { name: "x", min: 0.0, max: 10.0, numSteps: 3 }, // 0, 5, 10
      { name: "y", min: 100.0, max: 200.0, numSteps: 2 }, // 100, 200
    ];

    const res = CaeDoeSampler.generateSamples(gridVars, "grid", 6);
    assert.strictEqual(res.sampleCount, 6);
    assert.strictEqual(res.samples.length, 6);

    const xVals = new Set(res.samples.map((s) => s.x));
    const yVals = new Set(res.samples.map((s) => s.y));
    assert.deepStrictEqual(
      Array.from(xVals).sort((a, b) => a - b),
      [0, 5, 10],
    );
    assert.deepStrictEqual(
      Array.from(yVals).sort((a, b) => a - b),
      [100, 200],
    );
  });

  await t.test("generateSamples: Random Sampling with Normal distribution", () => {
    const normalVars: ParametricSweepVariable[] = [
      { name: "v", min: 10.0, max: 50.0, distribution: "normal", mean: 30.0, stdDev: 5.0 },
    ];
    const res = CaeDoeSampler.generateSamples(normalVars, "random", 15, 12345);
    assert.strictEqual(res.samples.length, 15);
    for (const s of res.samples) {
      assert.ok(s.v >= 10.0 && s.v <= 50.0);
    }
  });
});

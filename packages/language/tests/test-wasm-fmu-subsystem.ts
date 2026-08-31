// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import assert from "node:assert";
import type { TrainedROM } from "../src/compiler/simulator/surrogates/rom-trainer.js";
import {
  FmuSubsystemRegistry,
  LookupTableFmuSubsystem,
  NeuralNetFmuSubsystem,
} from "../src/runtime/wasm_fmu_subsystem.js";

console.log("Testing WASM FMU Subsystems & Surrogate Registry...");

// Test 1: LookupTableFmuSubsystem
{
  const gains = new Map<string, Map<string, number>>([["heatFlux", new Map([["temperature", 2.5]])]]);
  const offsets = new Map<string, number>([["heatFlux", 10.0]]);

  const lookupSub = new LookupTableFmuSubsystem("cfdLookup", ["temperature"], ["heatFlux"], [], gains, offsets);

  lookupSub.initialize(0, 10, 0.1);
  lookupSub.setInputs(new Map([["temperature", 4.0]]));
  lookupSub.doStep(0, 0.1);

  const outputs = lookupSub.getOutputs();
  // heatFlux = 10.0 + 2.5 * 4.0 = 20.0
  assert.strictEqual(outputs.get("heatFlux"), 20.0);
  lookupSub.terminate();
  console.log("  ✔ LookupTableFmuSubsystem evaluation passed");
}

// Test 2: NeuralNetFmuSubsystem
{
  const mockROM: TrainedROM = {
    architecture: "mlp",
    inputNames: ["u1", "u2"],
    outputNames: ["y1"],
    inputScaling: [
      { mean: 0.0, std: 1.0 },
      { mean: 0.0, std: 1.0 },
    ],
    outputScaling: [{ mean: 0.0, std: 1.0 }],
    weights: {
      type: "mlp",
      layers: [
        {
          W: [[1.0, 2.0]], // 1 output, 2 inputs: y1 = 1*u1 + 2*u2 + 0.5
          b: [0.5],
        },
      ],
      activation: "linear",
    },
    metrics: { trainMSE: 0.001, valMSE: 0.001, r2: 0.99 },
  };

  const nnSub = new NeuralNetFmuSubsystem("nnSubsystem", mockROM);
  nnSub.initialize(0, 10, 0.1);
  nnSub.setInputs(
    new Map([
      ["u1", 3.0],
      ["u2", 2.0],
    ]),
  );
  nnSub.doStep(0, 0.1);

  const outputs = nnSub.getOutputs();
  // y1 = 1 * 3.0 + 2 * 2.0 + 0.5 = 7.5
  assert.ok(Math.abs(outputs.get("y1")! - 7.5) < 1e-6, `Expected y1 = 7.5, got ${outputs.get("y1")}`);
  nnSub.terminate();
  console.log("  ✔ NeuralNetFmuSubsystem surrogate evaluation passed");
}

// Test 3: FmuSubsystemRegistry
{
  const registry = new FmuSubsystemRegistry();
  const sub1 = new LookupTableFmuSubsystem("sub1", ["u"], ["y"]);
  const sub2 = new LookupTableFmuSubsystem("sub2", ["u"], ["y"]);

  registry.register("pump", sub1);
  registry.register("valve", sub2);

  assert.strictEqual(registry.has("pump"), true);
  assert.strictEqual(registry.has("valve"), true);
  assert.strictEqual(registry.has("boiler"), false);
  assert.strictEqual(registry.get("pump"), sub1);

  registry.initializeAll(0, 5, 0.01);
  registry.terminateAll();
  console.log("  ✔ FmuSubsystemRegistry lifecycle management passed");
}

console.log("=== All WASM FMU Subsystem Tests Passed Cleanly ===");

// SPDX-License-Identifier: AGPL-3.0-or-later

import { FmuSubsystemRegistry, OnnxFmuSubsystem } from "@modelscript/runtime";
import {
  evaluateROM,
  exportROMToC,
  exportROMToONNX,
  exportROMToPyTorch,
  loadROM,
  saveROM,
  trainROM,
  type ROMTrainConfig,
} from "../src/surrogates/rom-trainer.js";
import type { ArenaDoEResult } from "../src/uq/doe.js";

async function main() {
  console.log("=== Running Surrogate ROM & ONNX Interop Validation ===");

  // 1. Generate Synthetic Transient DoE Dataset (Decay: x(t) = exp(-k * t))
  const kValues = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
  const snapshotTimes = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0];
  const inputs: number[][] = [];
  const outputs: number[][][] = [];

  for (const k of kValues) {
    inputs.push([k]);
    const traj: number[][] = [];
    for (const t of snapshotTimes) {
      traj.push([Math.exp(-k * t)]);
    }
    outputs.push(traj);
  }

  const doeResult: ArenaDoEResult = {
    inputs,
    outputs,
    inputNames: ["k"],
    outputNames: ["x"],
    snapshotTimes,
    isTransient: true,
    wallClockMs: 10,
    failedSamples: 0,
    totalSamples: kValues.length,
  };

  // 2. Train Trajectory ROM with transientMode: "trajectory"
  console.log("1. Training Trajectory Neural ROM...");
  const config: ROMTrainConfig = {
    data: doeResult,
    architecture: "mlp",
    transientMode: "trajectory",
    hiddenLayers: [16, 16],
    activation: "tanh",
    epochs: 400,
    learningRate: 0.01,
    seed: 42,
  };

  const rom = trainROM(config);

  if (!rom.inputNames.includes("time")) {
    throw new Error(`Expected 'time' in rom.inputNames, got: ${rom.inputNames.join(", ")}`);
  }
  console.log(`  ✔ ROM trained with input dimensions: [${rom.inputNames.join(", ")}]`);
  console.log(`  ✔ Validation R2: ${rom.metrics.r2.toFixed(4)}, Train MSE: ${rom.metrics.trainMSE.toExponential(3)}`);

  // Test evaluation at unseen point (k = 1.0, t = 0.5)
  const pred = evaluateROM(rom, [1.0, 0.5]);
  const expected = Math.exp(-1.0 * 0.5);
  const err = Math.abs(pred[0]! - expected);
  console.log(
    `  Evaluation at (k=1.0, t=0.5): pred=${pred[0]!.toFixed(4)}, exact=${expected.toFixed(4)}, absErr=${err.toFixed(4)}`,
  );
  if (err > 0.05) {
    throw new Error(`Trajectory prediction error too high: ${err}`);
  }
  console.log("  ✔ Trajectory evaluation accuracy passed");

  // 3. Test ONNX Graph Export
  console.log("\n2. Testing ONNX Graph Export...");
  const onnxGraph = exportROMToONNX(rom, "DecaySurrogate");
  if (onnxGraph.modelFormat !== "ONNX-v1.14") throw new Error("Invalid ONNX model format");
  if (onnxGraph.graph.inputs.length !== 1 || onnxGraph.graph.outputs.length !== 1) {
    throw new Error("Invalid ONNX graph IO count");
  }
  const hasGemm = onnxGraph.graph.nodes.some((n) => n.opType === "Gemm");
  const hasTanh = onnxGraph.graph.nodes.some((n) => n.opType === "Tanh");
  if (!hasGemm || !hasTanh) {
    throw new Error("Expected Gemm and Tanh nodes in ONNX export");
  }
  console.log(
    `  ✔ ONNX graph exported with ${onnxGraph.graph.nodes.length} nodes and ${onnxGraph.graph.initializers.length} initializers`,
  );

  // 4. Test PyTorch Script Export
  console.log("\n3. Testing PyTorch Script Generation...");
  const pyCode = exportROMToPyTorch(rom, "DecayNet");
  if (!pyCode.includes("class DecayNet(nn.Module):")) throw new Error("PyTorch class definition missing");
  if (!pyCode.includes("nn.Linear")) throw new Error("PyTorch Linear layer missing");
  if (!pyCode.includes("nn.Tanh()")) throw new Error("PyTorch Tanh activation missing");
  console.log("  ✔ PyTorch script generated successfully");

  // 5. Test Serialization and Restoration
  console.log("\n4. Testing JSON Serialization/Restoration...");
  const json = saveROM(rom);
  const loadedRom = loadROM(json);
  const rePred = evaluateROM(loadedRom, [1.0, 0.5]);
  if (Math.abs(rePred[0]! - pred[0]!) > 1e-12) {
    throw new Error(`Restored ROM output mismatch: ${rePred[0]} vs ${pred[0]}`);
  }
  console.log("  ✔ Serialization round-trip bit-identical");

  // 6. Test OnnxFmuSubsystem Co-Simulation Adapter
  console.log("\n5. Testing OnnxFmuSubsystem...");
  const registry = new FmuSubsystemRegistry();
  const onnxSubsystem = new OnnxFmuSubsystem("decay_surrogate", ["k", "time"], ["x"], (inputs) => {
    // Evaluate ROM on the provided float buffer
    const res = evaluateROM(rom, [inputs[0]!, inputs[1]!]);
    return new Float64Array(res);
  });

  registry.register("decay_surrogate", onnxSubsystem);
  onnxSubsystem.initialize(0, 1.0, 0.01);
  onnxSubsystem.setInputs(
    new Map([
      ["k", 1.0],
      ["time", 0.5],
    ]),
  );
  onnxSubsystem.doStep(0.5, 0.01);
  const outputsMap = onnxSubsystem.getOutputs();
  const outVal = outputsMap.get("x") ?? 0;
  if (Math.abs(outVal - pred[0]!) > 1e-12) {
    throw new Error(`OnnxFmuSubsystem output mismatch: ${outVal} vs ${pred[0]}`);
  }
  console.log(`  ✔ OnnxFmuSubsystem evaluated output correctly: ${outVal.toFixed(4)}`);

  // 7. Test Zero-Allocation C Code Generation (eFMI / Embedded HIL)
  console.log("\n6. Testing Zero-Allocation C ROM Code Generation (exportROMToC)...");
  const cExport = exportROMToC(rom, "decay_rom_eval");
  if (!cExport.header.includes("#define DECAY_ROM_EVAL_N_INPUTS 2")) {
    throw new Error("Missing DECAY_ROM_EVAL_N_INPUTS in generated C header");
  }
  if (!cExport.header.includes("#define DECAY_ROM_EVAL_N_OUTPUTS 1")) {
    throw new Error("Missing DECAY_ROM_EVAL_N_OUTPUTS in generated C header");
  }
  if (!cExport.source.includes("void decay_rom_eval(")) {
    throw new Error("Missing function definition in generated C source");
  }
  if (!cExport.source.includes("static const double W_0")) {
    throw new Error("Missing static weight array W_0 in generated C source");
  }
  if (cExport.source.includes("malloc") || cExport.source.includes("free")) {
    throw new Error("Zero-allocation violation: malloc or free found in generated C ROM code");
  }
  console.log("  ✔ Standalone C code generated with zero dynamic memory allocation");

  console.log("\nAll Surrogate ROM & ONNX Interop tests PASSED!");
}

main().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});

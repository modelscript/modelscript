// SPDX-License-Identifier: AGPL-3.0-or-later

import { FmuSubsystemRegistry, OnnxFmuSubsystem } from "@modelscript/runtime";
import assert from "node:assert";
import { emitModelicaROM } from "../src/surrogates/modelica-surrogate-emitter.js";
import { importONNXToArenaNeuralBlock, importONNXToROM } from "../src/surrogates/onnx-importer.js";
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

  // 2b. Test Bidirectional ONNX Graph Import to TrainedROM
  console.log("\n2b. Testing Bidirectional ONNX Graph Import to TrainedROM...");
  const importedRom = importONNXToROM(onnxGraph, {
    inputNames: rom.inputNames,
    outputNames: rom.outputNames,
  });
  const impPred = evaluateROM(importedRom, [1.0, 0.5]);
  const diffRom = Math.abs(impPred[0]! - pred[0]!);
  if (diffRom > 1e-7) {
    throw new Error(`Imported ROM output mismatch: ${impPred[0]} vs ${pred[0]} (diff: ${diffRom})`);
  }
  console.log(`  ✔ ONNX imported back to TrainedROM with exact numerical parity: ${impPred[0]?.toFixed(4)}`);

  // 2c. Test ONNX Import directly to in-arena ArenaNeuralBlock
  console.log("\n2c. Testing ONNX Graph Import to ArenaNeuralBlock...");
  const importedBlock = importONNXToArenaNeuralBlock(onnxGraph, "imported_decay");
  assert.deepStrictEqual(importedBlock.layers, [2, 16, 16, 1]);
  const normInput = new Float64Array([
    (1.0 - rom.inputScaling[0]!.mean) / rom.inputScaling[0]!.std,
    (0.5 - rom.inputScaling[1]!.mean) / rom.inputScaling[1]!.std,
  ]);
  const blockPredNorm = importedBlock.forwardVectorized(normInput);
  const blockPred = blockPredNorm[0]! * rom.outputScaling[0]!.std + rom.outputScaling[0]!.mean;
  const diffBlock = Math.abs(blockPred - pred[0]!);
  if (diffBlock > 1e-7) {
    throw new Error(`Imported ArenaNeuralBlock output mismatch: ${blockPred} vs ${pred[0]} (diff: ${diffBlock})`);
  }
  console.log(`  ✔ ONNX imported to ArenaNeuralBlock with exact parity: ${blockPred.toFixed(4)}`);

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

  // 8. Test Portable Modelica Block Generation with Extrapolation Guardrails
  console.log("\n7. Testing Self-Contained Modelica Block Generation (emitModelicaROM)...");
  const moCode = emitModelicaROM(rom, {
    modelName: "DecaySurrogateBlock",
    parameterBounds: {
      k: { min: 0.5, max: 2.0 },
      time: { min: 0.0, max: 1.0 },
    },
    enableExtrapolationWarnings: true,
    emitExtrapolationFlag: true,
  });

  assert.ok(moCode.includes("block DecaySurrogateBlock"));
  assert.ok(moCode.includes("input Real k"));
  assert.ok(moCode.includes("input Real time"));
  assert.ok(moCode.includes("output Real x"));
  assert.ok(moCode.includes("output Boolean isExtrapolating"));
  assert.ok(moCode.includes("assert(k >= 0.5 and k <= 2.0, \"Extrapolation warning: Input 'k'"));
  assert.ok(moCode.includes("assert(time >= 0.0 and time <= 1.0, \"Extrapolation warning: Input 'time'"));
  assert.ok(moCode.includes("isExtrapolating ="));
  assert.ok(moCode.includes("parameter Real W_0"));
  assert.ok(moCode.includes("parameter Real b_0"));
  assert.ok(moCode.includes("algorithm"));
  assert.ok(moCode.includes("Modelica.Math.tanh"));
  console.log("  ✔ Self-contained Modelica block generated with active guardrails and neural equations");

  console.log("\nAll Surrogate ROM & ONNX Interop tests PASSED!");
}

main().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});

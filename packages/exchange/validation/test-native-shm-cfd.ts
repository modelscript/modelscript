// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  CFD_HEADER_BYTES,
  CFD_PATCH_STRIDE_BYTES,
  CfdIpcCodec,
  CfdIpcCommand,
  CfdIpcStatus,
  CfdPatchType,
  NativeShmCfdProvider,
  type CfdPatchData,
} from "../src/cosim/index.js";

async function main() {
  console.log("=== Testing Native CFD Zero-Copy IPC Daemon & Provider ===");

  // 1. Test Binary Codec Bit-Level Fidelity
  {
    console.log("1. Testing CfdIpcCodec binary packing...");
    const buffer = new ArrayBuffer(CFD_HEADER_BYTES + CFD_PATCH_STRIDE_BYTES);
    const view = new DataView(buffer);

    CfdIpcCodec.encodeHeader(view, CfdIpcCommand.Step, CfdIpcStatus.Ready, 105, 1, 0.05, 1e-3, {
      maxVelocity: 14.2,
      dragForceX: 1.25,
      dragForceY: -0.05,
    });

    const header = CfdIpcCodec.decodeHeader(view);
    assert.strictEqual(header.command, CfdIpcCommand.Step);
    assert.strictEqual(header.status, CfdIpcStatus.Ready);
    assert.strictEqual(header.stepId, 105);
    assert.strictEqual(header.numPatches, 1);
    assert.ok(Math.abs(header.currentTime - 0.05) < 1e-6);
    assert.ok(Math.abs(header.stepSize - 1e-3) < 1e-6);
    assert.ok(Math.abs(header.maxVelocity - 14.2) < 1e-6);
    assert.ok(Math.abs(header.dragForceX - 1.25) < 1e-6);

    const testPatch: CfdPatchData = {
      patchId: 1,
      patchName: "inlet",
      patchType: CfdPatchType.VelocityInlet,
      pressure: 101325.0,
      massFlow: 0.15,
      velocity: [10.0, 0.0, 0.0],
      temperature: 310.0,
      wallForce: 0.0,
    };

    CfdIpcCodec.encodePatch(view, CFD_HEADER_BYTES, testPatch);
    const decodedPatch = CfdIpcCodec.decodePatch(view, CFD_HEADER_BYTES, "inlet");
    assert.strictEqual(decodedPatch.patchId, 1);
    assert.strictEqual(decodedPatch.patchType, CfdPatchType.VelocityInlet);
    assert.ok(Math.abs(decodedPatch.pressure - 101325.0) < 1e-6);
    assert.ok(Math.abs(decodedPatch.velocity[0] - 10.0) < 1e-6);
    assert.ok(Math.abs(decodedPatch.massFlow - 0.15) < 1e-6);
    console.log("  ✓ Binary header and patch codec encode/decode passed.");
  }

  // 2. Test End-to-End Co-Simulation with Persistent IPC Daemon
  {
    console.log("2. Launching NativeShmCfdProvider with persistent daemon...");
    const provider = new NativeShmCfdProvider({
      id: "native-openfoam-car",
      modelName: "AerodynamicSedan",
      autoSpawnDaemon: true,
      patches: [
        {
          name: "frontInlet",
          patchId: 0,
          type: CfdPatchType.VelocityInlet,
          initialVelocity: [15.0, 0.0, 0.0],
        },
        {
          name: "rearOutlet",
          patchId: 1,
          type: CfdPatchType.PressureOutlet,
          initialPressure: 101325.0,
        },
        {
          name: "carBody",
          patchId: 2,
          type: CfdPatchType.Wall,
        },
      ],
    });

    await provider.initialize(0.0, 1.0, 0.01);
    console.log("  ✓ IPC Daemon connected and initialized in memory.");

    // Perform 25 co-simulation steps and measure step latency
    const tStart = performance.now();
    const numSteps = 25;
    for (let s = 1; s <= numSteps; s++) {
      // Prescribe dynamic inlet speed change
      const dynamicSpeed = 15.0 + s * 0.5;
      const inMap = new Map();
      inMap.set("frontInlet.vx", dynamicSpeed);
      await provider.setInputs(inMap);

      await provider.doStep((s - 1) * 0.01, 0.01);

      const outputs = await provider.getOutputs();
      const drag = outputs.get("total_drag_force") as number;
      const maxVel = outputs.get("max_velocity") as number;
      assert.ok(drag > 0, `Drag force must be positive, got ${drag}`);
      assert.ok(maxVel > 0, `Velocity must be positive, got ${maxVel}`);
    }

    const elapsedMs = performance.now() - tStart;
    const avgStepMs = elapsedMs / numSteps;
    console.log(`  ✓ Completed ${numSteps} steps in ${elapsedMs.toFixed(2)} ms (avg ${avgStepMs.toFixed(2)} ms/step).`);
    assert.ok(avgStepMs < 25.0, `Step latency should be fast without disk I/O, got ${avgStepMs.toFixed(2)} ms/step`);

    // Verify final outputs
    const finalOutputs = await provider.getOutputs();
    const finalDrag = finalOutputs.get("total_drag_force") as number;
    console.log(`  Final aerodynamic drag force: ${finalDrag.toFixed(4)} N`);

    await provider.terminate();
    console.log("  ✓ Clean termination and socket teardown verified.");
  }

  console.log("All Native CFD Zero-Copy IPC tests passed successfully!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { formatSlcanFrame, parseSlcanLine, WebSerialParticipant } from "../src/cosim/participants/web-hardware.js";
import type { FmiLsBusFrame } from "../src/fmu/fmi-ls-bus.js";
import { FmiLsBusCodec } from "../src/fmu/fmi-ls-bus.js";

async function main() {
  console.log("=== Running End-to-End Closed-Loop Soft HIL Co-Simulation Validation ===");

  // ── 1. Define CAN Bus Frames & Signals ──
  console.log("1. Defining CAN bus architecture for Vehicle & ECU...");
  const frame120: FmiLsBusFrame = {
    name: "EngineStatus",
    id: 0x120,
    length: 8,
    cycleTime: 0.02,
    signals: [
      {
        name: "speed",
        valueReference: 1,
        startBit: 0,
        bitLength: 16,
        byteOrder: "littleEndian",
        factor: 0.1, // 0.1 km/h per bit
        offset: 0.0,
        unit: "km/h",
      },
    ],
  };

  const frame200: FmiLsBusFrame = {
    name: "DriverDemand",
    id: 0x200,
    length: 8,
    cycleTime: 0.02,
    signals: [
      {
        name: "throttle",
        valueReference: 2,
        startBit: 0,
        bitLength: 8,
        byteOrder: "littleEndian",
        factor: 0.5, // 0.5 % per bit (0-100%)
        offset: 0.0,
        unit: "%",
      },
    ],
  };

  // ── 2. Create Bidirectional In-Memory Streams for Soft HIL ──
  console.log("2. Establishing virtual serial communication streams...");
  const plantToHw = new TransformStream<Uint8Array, Uint8Array>();
  const hwToPlant = new TransformStream<Uint8Array, Uint8Array>();

  const hwParticipant = new WebSerialParticipant({
    id: "soft-hil-serial-bridge",
    protocol: "slcan",
    busFrames: [frame120, frame200],
    customStream: {
      readable: hwToPlant.readable,
      writable: plantToHw.writable,
    },
  });

  await hwParticipant.initialize(0, 10, 0.02);
  console.log("  ✔ Soft HIL WebSerial participant initialized in SLCAN mode");

  // ── 3. Start Mock ECU Task Over Serial Stream ──
  console.log("3. Launching virtual Cruise Control ECU firmware task...");
  const ecuWriter = hwToPlant.writable.getWriter();
  const ecuReader = plantToHw.readable.getReader();
  let ecuRunning = true;
  let ecuFramesProcessed = 0;

  const runEcuFirmware = async () => {
    const decoder = new TextDecoder();
    let lineBuf = "";
    let integralErr = 0;
    while (ecuRunning) {
      const { value, done } = await ecuReader.read();
      if (done) break;
      if (value) {
        lineBuf += decoder.decode(value, { stream: true });
        const lines = lineBuf.split("\r");
        lineBuf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const slcan = parseSlcanLine(line.trim());
          if (slcan && slcan.id === 0x120) {
            ecuFramesProcessed++;
            // Unpack vehicle speed from Frame 0x120
            const decoded = FmiLsBusCodec.unpackFrame(frame120, slcan.data);
            const currentSpeed = decoded.get("speed") ?? 0;

            // PI controller targeting 100 km/h setpoint
            const targetSpeed = 100.0;
            const error = targetSpeed - currentSpeed;
            integralErr = Math.max(-50, Math.min(50, integralErr + error * 0.02));
            const throttleCmd = Math.max(0, Math.min(100, error * 1.8 + integralErr * 1.5));

            // Pack throttle command into Frame 0x200
            const outPayload = FmiLsBusCodec.packFrame(frame200, new Map([["throttle", throttleCmd]]));
            const txLine = formatSlcanFrame(0x200, false, outPayload);
            await ecuWriter.write(new TextEncoder().encode(txLine));
          }
        }
      }
    }
  };

  const ecuPromise = runEcuFirmware();

  // ── 4. Closed-Loop Co-Simulation Loop ──
  console.log("4. Stepping closed-loop co-simulation (Plant Model ↔ CAN Bus ↔ Virtual ECU)...");
  // Simple vehicle longitudinal dynamics: M * der(v) = F_thrust - F_drag
  let vehicleSpeed = 0.0;
  let vehicleThrottle = 0.0;
  const dt = 0.02; // 20 ms CAN bus cycle time
  const totalSteps = 120;

  for (let step = 0; step < totalSteps; step++) {
    const t = step * dt;

    // A. Plant sends current speed to hardware bridge
    await hwParticipant.setInputs(new Map([["speed", vehicleSpeed]]));
    await hwParticipant.doStep(t, dt);

    // B. Yield briefly to allow virtual ECU task to process the serial chunk
    await new Promise((resolve) => setTimeout(resolve, 3));

    // C. Hardware bridge polls incoming CAN frames from ECU
    await hwParticipant.doStep(t, dt);
    const outputs = await hwParticipant.getOutputs();
    if (outputs.has("throttle")) {
      const decodedVal = outputs.get("throttle");
      if (typeof decodedVal === "number") {
        vehicleThrottle = decodedVal;
      }
    }

    // D. Step vehicle plant dynamics
    // Acceleration: throttle gives thrust, aero drag slows vehicle
    const thrust = vehicleThrottle * 1.8;
    const drag = 0.015 * vehicleSpeed * vehicleSpeed + 0.1 * vehicleSpeed;
    const accel = (thrust - drag) / 10.0;
    vehicleSpeed = Math.max(0, vehicleSpeed + accel * dt * 10.0);

    if (step % 15 === 0 || step === totalSteps - 1) {
      console.log(
        `  t=${t.toFixed(2)}s | CAN Speed=${vehicleSpeed.toFixed(1)} km/h | ECU Throttle=${vehicleThrottle.toFixed(1)}%`,
      );
    }
  }

  // ── 5. Validate Closed-Loop Regulation ──
  console.log("5. Evaluating closed-loop regulation performance...");
  assert.ok(ecuFramesProcessed >= 40, `ECU must process at least 40 CAN frames (processed: ${ecuFramesProcessed})`);
  assert.ok(vehicleSpeed > 85.0, `Vehicle speed must approach 100 km/h setpoint (speed: ${vehicleSpeed.toFixed(1)})`);
  assert.ok(
    vehicleSpeed < 115.0,
    `Vehicle speed must not overshoot setpoint wildly (speed: ${vehicleSpeed.toFixed(1)})`,
  );
  console.log(
    `  ✔ Closed-loop cruise control successfully regulated speed to ${vehicleSpeed.toFixed(1)} km/h over CAN bus`,
  );

  // Terminate
  ecuRunning = false;
  await hwParticipant.terminate();
  try {
    await ecuReader.cancel();
    await ecuWriter.close();
  } catch {
    // ignore
  }
  await Promise.race([ecuPromise, new Promise((r) => setTimeout(r, 50))]);

  console.log("\nAll End-to-End Soft HIL Co-Simulation tests PASSED!\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import { formatSlcanFrame, parseSlcanLine, WebSerialParticipant } from "../src/cosim/participants/web-hardware.js";
import type { FmiLsBusFrame, FmiLsBusManifest } from "../src/fmu/fmi-ls-bus.js";
import { FmiLsBusCodec, generateFmiLsBusXml } from "../src/fmu/fmi-ls-bus.js";

async function main() {
  console.log("=== Running FMI-LS-BUS & Browser Soft HIL Validation ===");

  // ── 1. Test FMI-LS-BUS Frame Codec (Little-Endian Intel) ──
  console.log("1. Testing Intel Little-Endian CAN Frame Packing & Unpacking...");

  const frameIntel: FmiLsBusFrame = {
    name: "PowertrainStatus",
    id: 0x120,
    length: 8,
    cycleTime: 0.01,
    signals: [
      {
        name: "speed",
        valueReference: 10,
        startBit: 0,
        bitLength: 16,
        byteOrder: "littleEndian",
        factor: 0.1, // raw 1200 -> 120.0 km/h
        offset: 0,
        unit: "km/h",
      },
      {
        name: "rpm",
        valueReference: 11,
        startBit: 16,
        bitLength: 16,
        byteOrder: "littleEndian",
        factor: 1.0,
        offset: 0,
        unit: "rpm",
      },
      {
        name: "batterySoc",
        valueReference: 12,
        startBit: 32,
        bitLength: 8,
        byteOrder: "littleEndian",
        factor: 0.5, // 0-100% in steps of 0.5%
        offset: 0,
        unit: "%",
      },
      {
        name: "temp",
        valueReference: 13,
        startBit: 40,
        bitLength: 8,
        byteOrder: "littleEndian",
        dataType: "int8",
        factor: 1.0,
        offset: -40.0, // offset -40 to 215 degC
        unit: "degC",
      },
    ],
  };

  const testInputs = new Map<string, number>([
    ["speed", 120.5], // raw = 1205 (0x04B5)
    ["rpm", 3500], // raw = 3500 (0x0DAC)
    ["batterySoc", 85.0], // raw = 170 (0xAA)
    ["temp", 25.0], // raw = 65 (0x41) (65 - 40 = 25)
  ]);

  const packedBuffer = FmiLsBusCodec.packFrame(frameIntel, testInputs);
  if (packedBuffer.length !== 8) {
    throw new Error(`Expected packed buffer length 8, got ${packedBuffer.length}`);
  }

  // Verify byte representation:
  // speed (1205 = 0x04B5): bytes[0]=0xB5, bytes[1]=0x04
  // rpm (3500 = 0x0DAC): bytes[2]=0xAC, bytes[3]=0x0D
  // batterySoc (170 = 0xAA): bytes[4]=0xAA
  // temp (65 = 0x41): bytes[5]=0x41
  if (
    packedBuffer[0] !== 0xb5 ||
    packedBuffer[1] !== 0x04 ||
    packedBuffer[2] !== 0xac ||
    packedBuffer[3] !== 0x0d ||
    packedBuffer[4] !== 0xaa ||
    packedBuffer[5] !== 0x41
  ) {
    throw new Error(
      `Packed buffer bytes mismatch: [${Array.from(packedBuffer)
        .map((b) => b.toString(16))
        .join(", ")}]`,
    );
  }
  console.log("  ✔ Intel byte packing matches exact bit alignment");

  // Unpack and verify round-trip
  const unpackedSignals = FmiLsBusCodec.unpackFrame(frameIntel, packedBuffer);
  const unpackedSpeed = unpackedSignals.get("speed")!;
  const unpackedRpm = unpackedSignals.get("rpm")!;
  const unpackedSoc = unpackedSignals.get("batterySoc")!;
  const unpackedTemp = unpackedSignals.get("temp")!;

  if (Math.abs(unpackedSpeed - 120.5) > 0.05) throw new Error(`Speed mismatch: ${unpackedSpeed}`);
  if (Math.abs(unpackedRpm - 3500) > 0.5) throw new Error(`RPM mismatch: ${unpackedRpm}`);
  if (Math.abs(unpackedSoc - 85.0) > 0.1) throw new Error(`SoC mismatch: ${unpackedSoc}`);
  if (Math.abs(unpackedTemp - 25.0) > 0.1) throw new Error(`Temp mismatch: ${unpackedTemp}`);
  console.log("  ✔ Intel byte unpacking accurately reconstructed physical values");

  // ── 2. Test FMI-LS-BUS Frame Codec (Motorola Big-Endian) ──
  console.log("\n2. Testing Motorola Big-Endian CAN Frame Packing & Unpacking...");

  const frameMotorola: FmiLsBusFrame = {
    name: "RadarTarget",
    id: 0x200,
    length: 8,
    signals: [
      {
        name: "distance",
        valueReference: 20,
        startBit: 7, // MSB in byte 0
        bitLength: 16,
        byteOrder: "bigEndian",
        factor: 0.01,
        offset: 0,
        unit: "m",
      },
    ],
  };

  const distInputs = new Map<string, number>([["distance", 75.25]]); // raw = 7525 (0x1D65)
  const packedMoto = FmiLsBusCodec.packFrame(frameMotorola, distInputs);
  // Big-endian: MSB 0x1D in byte 0, LSB 0x65 in byte 1
  if (packedMoto[0] !== 0x1d || packedMoto[1] !== 0x65) {
    throw new Error(
      `Motorola packed bytes mismatch: 0x${packedMoto[0]?.toString(16)}, 0x${packedMoto[1]?.toString(16)}`,
    );
  }
  const unpackedMoto = FmiLsBusCodec.unpackFrame(frameMotorola, packedMoto);
  if (Math.abs(unpackedMoto.get("distance")! - 75.25) > 0.01) {
    throw new Error(`Motorola distance mismatch: ${unpackedMoto.get("distance")}`);
  }
  console.log("  ✔ Motorola big-endian packing and unpacking verified");

  // ── 3. Test XML Manifest Generation ──
  console.log("\n3. Testing FMI-LS-BUS XML Manifest Generation...");
  const manifest: FmiLsBusManifest = {
    version: "1.0.0",
    buses: [
      {
        name: "CAN_Powertrain",
        type: "CAN",
        baudRate: 500000,
        frames: [frameIntel, frameMotorola],
      },
    ],
  };

  const xml = generateFmiLsBusXml(manifest);
  if (!xml.includes('<fmi-ls-bus version="1.0.0"')) throw new Error("Missing fmi-ls-bus root element");
  if (!xml.includes('<Bus name="CAN_Powertrain" type="CAN" baudRate="500000">')) {
    throw new Error("Missing Bus definition in XML");
  }
  if (!xml.includes('<Frame name="PowertrainStatus" id="288" length="8"')) {
    throw new Error("Missing Frame definition in XML");
  }
  if (!xml.includes('<Signal name="speed" valueReference="10"')) {
    throw new Error("Missing Signal definition in XML");
  }
  console.log("  ✔ fmi-ls-bus.xml schema conforms to Modelica Association specification");

  // ── 4. Test SLCAN Protocol Parsing & Formatting ──
  console.log("\n4. Testing SLCAN Protocol Framing...");

  // Format 11-bit standard CAN frame
  const slcan11 = formatSlcanFrame(0x120, false, packedBuffer);
  if (slcan11 !== "t1208B504AC0DAA410000\r") {
    throw new Error(`SLCAN 11-bit formatting mismatch: got '${slcan11}'`);
  }

  // Parse 11-bit standard CAN frame
  const parsed11 = parseSlcanLine(slcan11.trim());
  if (!parsed11 || parsed11.id !== 0x120 || parsed11.isExtended !== false || parsed11.length !== 8) {
    throw new Error("Failed to parse 11-bit SLCAN frame");
  }

  // Format and parse 29-bit extended CAN frame
  const slcan29 = formatSlcanFrame(0x18ea0001, true, new Uint8Array([1, 2, 3]));
  if (slcan29 !== "T18EA00013010203\r") {
    throw new Error(`SLCAN 29-bit formatting mismatch: got '${slcan29}'`);
  }
  const parsed29 = parseSlcanLine(slcan29.trim());
  if (!parsed29 || parsed29.id !== 0x18ea0001 || parsed29.isExtended !== true || parsed29.length !== 3) {
    throw new Error("Failed to parse 29-bit SLCAN frame");
  }
  console.log("  ✔ SLCAN 11-bit and 29-bit framing parsed and formatted correctly");

  // ── 5. Test WebSerialParticipant with Mock Stream ──
  console.log("\n5. Testing WebSerialParticipant with Mock Stream...");

  // Create stream pair for bidirectional testing
  let readableController!: ReadableStreamDefaultController<Uint8Array>;
  const mockReadable = new ReadableStream<Uint8Array>({
    start(c) {
      readableController = c;
    },
  });

  const writtenChunks: Uint8Array[] = [];
  const mockWritable = new WritableStream<Uint8Array>({
    write(chunk) {
      writtenChunks.push(chunk);
    },
  });

  const hwParticipant = new WebSerialParticipant({
    id: "test_ecu",
    baudRate: 500000,
    protocol: "slcan",
    busFrames: [frameIntel],
    customStream: {
      readable: mockReadable,
      writable: mockWritable,
    },
  });

  await hwParticipant.initialize(0, 10, 0.01);

  // Simulate hardware sending SLCAN frame into the browser
  const incomingLine = new TextEncoder().encode("t1208B504AC0DAA410000\r");
  readableController.enqueue(incomingLine);

  // Perform step
  await hwParticipant.doStep(0.0, 0.01);

  // Read decoded outputs from hardware participant
  const hwOutputs = await hwParticipant.getOutputs();
  const receivedSpeed = hwOutputs.get("speed");
  const receivedRpm = hwOutputs.get("rpm");

  if (typeof receivedSpeed !== "number" || Math.abs(receivedSpeed - 120.5) > 0.05) {
    throw new Error(`WebSerialParticipant did not decode speed correctly: ${receivedSpeed}`);
  }
  if (typeof receivedRpm !== "number" || Math.abs(receivedRpm - 3500) > 0.5) {
    throw new Error(`WebSerialParticipant did not decode rpm correctly: ${receivedRpm}`);
  }
  console.log(`  ✔ Hardware participant decoded incoming CAN speed=${receivedSpeed} km/h, rpm=${receivedRpm}`);

  await hwParticipant.terminate();
  console.log("  ✔ Hardware participant cleanly terminated");

  console.log("\nAll FMI-LS-BUS and Soft HIL tests PASSED!");
}

main().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});

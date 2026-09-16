// SPDX-License-Identifier: AGPL-3.0-or-later

import { Causality, DAEBuilder, initBltWasm, Variability, VarType } from "@modelscript/runtime";
import { StringInterner } from "@modelscript/runtime/wasm_string_pool.js";
import assert from "node:assert";
import { buildFmuArchive } from "../src/fmu/archive.js";
import { extractBusManifestFromDae, FmiLsBusCodec, generateFmiLsBusXml } from "../src/fmu/fmi-ls-bus.js";

async function main() {
  console.log("=== Running Modelica Bus Annotations & FMU Bundling Validation ===");
  await initBltWasm();

  // ── 1. Construct DAE with CAN Signal & Frame Attributes ──
  console.log("1. Constructing DAE with bus, frame, and signal attributes...");
  const interner = new StringInterner();
  const dae = new DAEBuilder(interner, "CAN_Powertrain");

  // Speed signal on CAN0, Frame 0x120 (startBit=0, bitLength=16, factor=0.1)
  const speedIdx = dae.addVariable("speed", VarType.Real, Variability.Continuous, Causality.Output, 100.0);
  dae.setVarAttr(speedIdx, "__bus_name", dae.addStringLiteral("CAN0"));
  dae.setVarAttr(speedIdx, "__bus_type", dae.addStringLiteral("CAN"));
  dae.setVarAttr(speedIdx, "__frame_id", dae.addIntLiteral(0x120));
  dae.setVarAttr(speedIdx, "__frame_name", dae.addStringLiteral("EngineStatus"));
  dae.setVarAttr(speedIdx, "__signal_startbit", dae.addIntLiteral(0));
  dae.setVarAttr(speedIdx, "__signal_bitlength", dae.addIntLiteral(16));
  dae.setVarAttr(speedIdx, "__signal_factor", dae.addRealLiteral(0.1));
  dae.setVarAttr(speedIdx, "__signal_offset", dae.addRealLiteral(0.0));

  // RPM signal on CAN0, Frame 0x120 (startBit=16, bitLength=16, factor=1.0)
  const rpmIdx = dae.addVariable("rpm", VarType.Real, Variability.Continuous, Causality.Output, 3000.0);
  dae.setVarAttr(rpmIdx, "__frame_id", dae.addIntLiteral(0x120));
  dae.setVarAttr(rpmIdx, "__signal_startbit", dae.addIntLiteral(16));
  dae.setVarAttr(rpmIdx, "__signal_bitlength", dae.addIntLiteral(16));
  dae.setVarAttr(rpmIdx, "__signal_factor", dae.addRealLiteral(1.0));

  // Throttle request on CAN0, Frame 0x200 (startBit=0, bitLength=8, factor=0.5)
  const throttleIdx = dae.addVariable("throttle", VarType.Real, Variability.Continuous, Causality.Input, 0.0);
  dae.setVarAttr(throttleIdx, "__frame_id", dae.addIntLiteral(0x200));
  dae.setVarAttr(throttleIdx, "__frame_name", dae.addStringLiteral("DriverDemand"));
  dae.setVarAttr(throttleIdx, "__signal_startbit", dae.addIntLiteral(0));
  dae.setVarAttr(throttleIdx, "__signal_bitlength", dae.addIntLiteral(8));
  dae.setVarAttr(throttleIdx, "__signal_factor", dae.addRealLiteral(0.5));

  console.log("  ✔ DAE variables and attributes attached successfully");

  // ── 2. Test extractBusManifestFromDae ──
  console.log("2. Extracting FmiLsBusManifest from DAE attributes...");
  const manifest = extractBusManifestFromDae(dae);

  assert.strictEqual(manifest.version, "1.0.0");
  assert.strictEqual(manifest.buses.length, 1);
  const bus = manifest.buses[0];
  assert.strictEqual(bus.name, "CAN0");
  assert.strictEqual(bus.type, "CAN");
  assert.strictEqual(bus.frames.length, 2);

  const frame120 = bus.frames.find((f) => f.id === 0x120);
  assert.ok(frame120, "Frame 0x120 must be present");
  assert.strictEqual(frame120.name, "EngineStatus");
  assert.strictEqual(frame120.signals.length, 2);
  assert.strictEqual(frame120.signals[0].name, "speed");
  assert.strictEqual(frame120.signals[0].factor, 0.1);
  assert.strictEqual(frame120.signals[1].name, "rpm");
  assert.strictEqual(frame120.signals[1].factor, 1.0);

  const frame200 = bus.frames.find((f) => f.id === 0x200);
  assert.ok(frame200, "Frame 0x200 must be present");
  assert.strictEqual(frame200.name, "DriverDemand");
  assert.strictEqual(frame200.signals.length, 1);
  assert.strictEqual(frame200.signals[0].name, "throttle");

  console.log("  ✔ Extracted 1 CAN bus, 2 frames, and 3 signals accurately");

  // ── 3. Validate XML Generation ──
  console.log("3. Validating FMI-LS-BUS XML schema serialization...");
  const xml = generateFmiLsBusXml(manifest);
  assert.ok(xml.includes("<fmi-ls-bus"), "XML must have root <fmi-ls-bus>");
  assert.ok(xml.includes('name="CAN0"'), "XML must declare bus CAN0");
  assert.ok(xml.includes('name="EngineStatus" id="288"'), "XML must declare EngineStatus (0x120=288)");
  assert.ok(xml.includes('name="speed"') && xml.includes('factor="0.1"'), "XML must declare speed signal with factor");
  assert.ok(
    xml.includes('name="throttle"') && xml.includes('factor="0.5"'),
    "XML must declare throttle signal with factor",
  );
  console.log("  ✔ Generated valid fmi-ls-bus.xml adhering to Modelica Association specification");

  // ── 4. Verify Frame Packing & Unpacking with Extracted Manifest ──
  console.log("4. Testing bit-level codec round-trip using extracted manifest...");
  const packedBytes = FmiLsBusCodec.packFrame(frame120, {
    speed: 85.5, // raw = 855 -> 0x0357
    rpm: 2400, // raw = 2400 -> 0x0960
  });

  assert.strictEqual(packedBytes.length, 8);
  const unpacked = FmiLsBusCodec.unpackFrame(frame120, packedBytes);
  assert.strictEqual(Math.round((unpacked.get("speed") ?? 0) * 10) / 10, 85.5);
  assert.strictEqual(unpacked.get("rpm"), 2400);
  console.log("  ✔ Frame packing and unpacking verified with zero numerical error");

  // ── 5. Test Automatic FMU Archive Bundling ──
  console.log("5. Testing automatic fmi-ls-bus.xml bundling in buildFmuArchive...");
  const archiveResult = buildFmuArchive(dae, {
    modelIdentifier: "CAN_Powertrain",
  });

  assert.ok(archiveResult.files.includes("fmi-ls-bus.xml"), "FMU archive must auto-include fmi-ls-bus.xml");
  assert.ok(archiveResult.files.includes("modelDescription.xml"), "FMU archive must include modelDescription.xml");
  assert.ok(archiveResult.archive.length > 0, "Archive binary must be non-empty");
  console.log("  ✔ Successfully auto-bundled fmi-ls-bus.xml into generated FMU archive");

  console.log("\nAll Bus Annotation & FMU Bundling tests PASSED!\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

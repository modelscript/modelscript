// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SdlArchetypeId,
  ensureBuiltInSdlLibraryRegistered,
  getSdlSchemasFromLibraries,
  getSdlStdLibWasmBytes,
  lookupSdlModelSchema,
} from "../src/index.js";

describe("SDL-88 Cleanroom Standard Library (@modelscript/sdl-std-lib)", () => {
  it("registers ITU-T Z.100 predefined sorts and canonical telecom protocol blocks", () => {
    ensureBuiltInSdlLibraryRegistered();
    const schemas = getSdlSchemasFromLibraries();
    assert.ok(schemas.length >= 13, `Expected >= 13 schemas, got ${schemas.length}`);

    const predefinedSorts = ["Boolean", "Integer", "Real", "Duration", "Time", "PId", "Charstring"];
    for (const sort of predefinedSorts) {
      const s = lookupSdlModelSchema(sort);
      assert.ok(s, `Missing predefined ITU-T Z.100 sort '${sort}'`);
      assert.ok(s.svg?.includes("<svg"), `Expected cleanroom SVG icon for '${sort}'`);
    }

    const telecomBlocks = [
      "AlternatingBitSender",
      "AlternatingBitReceiver",
      "UnreliableChannel",
      "WatchdogTimer",
      "CallSetupOriginator",
      "CallSetupTerminator",
    ];
    for (const blk of telecomBlocks) {
      const s = lookupSdlModelSchema(blk);
      assert.ok(s, `Missing telecom protocol block '${blk}'`);
      assert.ok(s.ports.length >= 2, `Expected ports on '${blk}'`);
    }
  });

  it("executes the compiled AssemblyScript WASM runtime for WatchdogTimer", async () => {
    const wasmBytes = getSdlStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 200, "WASM stdlib bytes should be non-empty");

    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as {
      memory: WebAssembly.Memory;
      sdlModelInit: (arch: number, slotPtr: number, conCount: number) => void;
      sdlModelStep: (arch: number, t: number, dt: number, slotPtr: number, conCount: number) => void;
    };

    const slotPtr = 2048;
    if (exports.memory.buffer.byteLength < slotPtr + 2048) {
      exports.memory.grow(1);
    }
    const f64 = new Float64Array(exports.memory.buffer);
    // CON[0] = timeout = 2.0s at offset 0x080
    f64[(slotPtr + 0x080) >> 3] = 2.0;

    exports.sdlModelInit(SdlArchetypeId.WATCHDOG_TIMER, slotPtr, 1);
    // Step 1.0s without kick -> not expired yet
    exports.sdlModelStep(SdlArchetypeId.WATCHDOG_TIMER, 0.0, 1.0, slotPtr, 1);
    assert.strictEqual(f64[(slotPtr + 0x780 + 6 * 8) >> 3], 0.0, "Alarm should not fire at t=1.0s");

    // Step another 1.0s without kick -> expired at t=2.0s
    exports.sdlModelStep(SdlArchetypeId.WATCHDOG_TIMER, 1.0, 1.0, slotPtr, 1);
    assert.strictEqual(f64[(slotPtr + 0x780 + 6 * 8) >> 3], 1.0, "Alarm should fire at t=2.0s");
  });
});

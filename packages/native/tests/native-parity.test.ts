// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import * as browserStub from "../src/browser-stub.js";
import { loadNativeAddon, resetNativeAddonCache } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

describe("@modelscript/native (wasm2c + GPU capabilities)", () => {
  it("browser stub always returns null/false so web/docs/vscode-web stay pure WASM", () => {
    assert.equal(browserStub.isNativeAvailable(), false);
    assert.equal(browserStub.loadNativeAddon(), null);
    assert.equal(browserStub.getNativeRuntimeExports(), null);
    assert.equal(browserStub.getNativeSimulateExports(), null);
    assert.equal(browserStub.getNativeGpuCapabilities(), null);
  });

  it("respects MODELSCRIPT_BACKEND=wasm override", () => {
    const prev = process.env["MODELSCRIPT_BACKEND"];
    try {
      process.env["MODELSCRIPT_BACKEND"] = "wasm";
      resetNativeAddonCache();
      assert.equal(loadNativeAddon(), null);
    } finally {
      if (prev === undefined) delete process.env["MODELSCRIPT_BACKEND"];
      else process.env["MODELSCRIPT_BACKEND"] = prev;
      resetNativeAddonCache();
    }
  });

  it("loads compiled modelscript_native.node and passes bit-exact parity vs simulate.wasm", () => {
    resetNativeAddonCache();
    const addon = loadNativeAddon();
    if (!addon) {
      // Skip gracefully in environments where native addon has not been compiled yet
      console.log("[native-parity] modelscript_native.node not built for this platform; skipping native parity.");
      return;
    }

    assert.equal(addon.backend, "wasm2c-native");
    assert.equal(addon.selftest(), 0);

    const caps = addon.getGpuCapabilities();
    assert.equal(typeof caps.dawnCompiled, "boolean");
    assert.equal(typeof caps.cudaCompiled, "boolean");
    assert.equal(typeof caps.hardwareFp64, "boolean");
    assert.equal(typeof caps.backendName, "string");

    // Verify runtime native exports are populated
    assert.ok(addon.runtime.memory.buffer.byteLength > 0);

    // Compare native wasm2c simulate kernel bit-for-bit against simulate.wasm
    const simWasmPath = path.join(REPO_ROOT, "packages", "simulate", "build", "simulate.wasm");
    if (!fs.existsSync(simWasmPath)) return;

    const wasmMod = new WebAssembly.Module(fs.readFileSync(simWasmPath));
    const wasmInst = new WebAssembly.Instance(wasmMod, {
      env: {
        abort: () => {
          throw new Error("wasm abort");
        },
      },
    });
    const wasmSim = wasmInst.exports as Record<string, any>;
    const nativeSim = addon.simulate as Record<string, any>;

    const nx = 3;
    const ny = 2;
    const nz = 2;
    const nCells = nx * ny * nz;
    const nVerts = (nx + 1) * (ny + 1) * (nz + 1);
    const elemBytes = nCells * 6 * 4 * 4;
    const coordBytes = nVerts * 3 * 8;

    const wElemsPtr = wasmSim.alloc(elemBytes);
    const wCoordsPtr = wasmSim.alloc(coordBytes);
    const wCount = wasmSim.mesh_createBoxTets(nx, ny, nz, wElemsPtr);
    wasmSim.mesh_createBoxCoords(nx, ny, nz, 0, 0, 0, 1.0, 0.5, 0.25, wCoordsPtr);

    const nElemsPtr = nativeSim.alloc(elemBytes);
    const nCoordsPtr = nativeSim.alloc(coordBytes);
    const nCount = nativeSim.mesh_createBoxTets(nx, ny, nz, nElemsPtr);
    nativeSim.mesh_createBoxCoords(nx, ny, nz, 0, 0, 0, 1.0, 0.5, 0.25, nCoordsPtr);

    assert.equal(nCount, wCount);
    assert.equal(nCount, nCells * 6);

    const wElems = new Int32Array(wasmSim.memory.buffer, wElemsPtr, wCount * 4);
    const nElems = new Int32Array(nativeSim.memory.buffer, nElemsPtr, nCount * 4);
    assert.deepEqual(Array.from(nElems), Array.from(wElems));

    const wCoords = new Float64Array(wasmSim.memory.buffer, wCoordsPtr, nVerts * 3);
    const nCoords = new Float64Array(nativeSim.memory.buffer, nCoordsPtr, nVerts * 3);
    assert.deepEqual(Array.from(nCoords), Array.from(wCoords));

    wasmSim.free(wElemsPtr);
    wasmSim.free(wCoordsPtr);
    nativeSim.free(nElemsPtr);
    nativeSim.free(nCoordsPtr);
  });
});

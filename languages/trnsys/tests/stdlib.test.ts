// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  TRNSYS_MODEL_SPECS,
  getTrnsysSchemasFromLibraries,
  getTrnsysStdLibWasmBytes,
  getTrnsysTypeSpec,
  lookupTrnsysModelSchema,
  registerBuiltInTrnsysLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/trnsys-std-lib");

describe("@modelscript/trnsys — Cleanroom Standard Library", () => {
  it("loads @modelscript/trnsys-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected trnsys-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/trnsys-std-lib");
    assert.equal(pkg.manifest.language, "trnsys");
    assert.equal(pkg.symbols.length, TRNSYS_MODEL_SPECS.length);
    assert.equal(pkg.diagrams.length, TRNSYS_MODEL_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected cleanroom SVG icon for ${diag.namePath}`);
      assert.ok(diag.ports.length > 0, `Expected diagram ports for ${diag.namePath}`);
    }
  });

  it("supports zero-I/O sync registration and lookup for all 8 classic TRNSYS Types", () => {
    registerBuiltInTrnsysLibrarySync();
    const schemas = getTrnsysSchemasFromLibraries();
    assert.ok(schemas.length >= 8);

    for (const typeNum of [1, 2, 3, 4, 14, 15, 25, 56]) {
      const schema = lookupTrnsysModelSchema(typeNum);
      assert.ok(schema, `Expected schema for Type ${typeNum}`);
      assert.equal(schema.name, `Type${typeNum}`);
      assert.ok(getTrnsysTypeSpec(typeNum), `Expected metadata spec for Type ${typeNum}`);
    }

    assert.equal(lookupTrnsysModelSchema("SOLAR_COLLECTOR")?.name, "Type1");
    assert.equal(lookupTrnsysModelSchema("STORAGE_TANK")?.name, "Type4");
    assert.equal(lookupTrnsysModelSchema("MULTIZONE_BUILDING")?.name, "Type56");
  });

  it("executes Type 1 solar collector and Type 4 storage tank inside runtime.wasm", async () => {
    const wasmBytes = getTrnsysStdLibWasmBytes();
    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as {
      memory: WebAssembly.Memory;
      trnsysModelInit: (typeNumber: number, slotPtr: number, parCount: number) => void;
      trnsysModelStep: (typeNumber: number, t: number, dt: number, slotPtr: number, parCount: number) => void;
    };

    const memF64 = new Float64Array(exports.memory.buffer);
    const slotBase = 4096; // 1024-byte aligned slot
    const parIdx = (slotBase + 0x040) >> 3;
    const inIdx = (slotBase + 0x140) >> 3;
    const outIdx = (slotBase + 0x240) >> 3;

    // Type 1 Solar Collector: area=4.0, cp=4.19, frTa=0.75, frUl=15.0, frUl2=0.0
    memF64[parIdx + 0] = 4.0;
    memF64[parIdx + 1] = 4.19;
    memF64[parIdx + 2] = 0.75;
    memF64[parIdx + 3] = 15.0;
    memF64[parIdx + 4] = 0.0;

    // Inputs: Tin=30 C, mDot=200 kg/h, Tamb=20 C, It=2880 kJ/(h.m2)
    memF64[inIdx + 0] = 30.0;
    memF64[inIdx + 1] = 200.0;
    memF64[inIdx + 2] = 20.0;
    memF64[inIdx + 3] = 2880.0;

    exports.trnsysModelStep(1, 12.0, 0.25, slotBase, 5);
    const expectedQu = 4.0 * (0.75 * 2880.0 - 15.0 * (30.0 - 20.0));
    const expectedTout = 30.0 + expectedQu / (200.0 * 4.19);
    assert.ok(Math.abs(memF64[outIdx + 2]! - expectedQu) < 1e-6);
    assert.ok(Math.abs(memF64[outIdx + 0]! - expectedTout) < 1e-6);

    // Type 4 Storage Tank exponential cooling check in WASM
    const tankBase = 8192;
    const tPar = (tankBase + 0x040) >> 3;
    const tIn = (tankBase + 0x140) >> 3;
    const tOut = (tankBase + 0x240) >> 3;
    memF64[tPar + 0] = 0.3;
    memF64[tPar + 1] = 4.19;
    memF64[tPar + 2] = 1000.0;
    memF64[tPar + 3] = 1.5;
    memF64[tPar + 4] = 1.5;
    memF64[tPar + 5] = 1.0;
    memF64[tPar + 6] = 60.0;

    exports.trnsysModelInit(4, tankBase, 7);
    memF64[tIn + 0] = 20.0;
    memF64[tIn + 1] = 0.0;
    memF64[tIn + 2] = 20.0;
    memF64[tIn + 3] = 0.0;
    memF64[tIn + 4] = 20.0;

    exports.trnsysModelStep(4, 0.0, 1.0, tankBase, 7);
    assert.ok(memF64[tOut + 5]! < 60.0 && memF64[tOut + 5]! > 59.0, `Expected tank cooling, got ${memF64[tOut + 5]}`);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SLAM_BLOCK_SPECS,
  SlamArchetypeId,
  getSlamSchemasFromLibraries,
  lookupSlamModelSchema,
  registerBuiltInSlamLibrarySync,
} from "../src/catalog/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/slam-std-lib");

describe("@modelscript/slam — Cleanroom Standard Library (@modelscript/slam-std-lib)", () => {
  it("loads modelscript.yaml with symbols, cleanroom SVG icons, provenance, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected slam-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/slam-std-lib");
    assert.equal(pkg.manifest.language, "slam");
    assert.equal(pkg.symbols.length, SLAM_BLOCK_SPECS.length);
    assert.equal(pkg.diagrams.length, SLAM_BLOCK_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected cleanroom SVG icon for ${diag.namePath}`);
      assert.ok(diag.ports.length > 0, `Expected diagram ports for ${diag.namePath}`);
    }
    for (const sym of pkg.symbols) {
      const prov = (sym.metadata as Record<string, unknown> | undefined)?.["provenance"];
      assert.ok(
        typeof prov === "string" && prov.includes("Pritsker"),
        `Expected provenance citation for ${sym.namePath}`,
      );
    }
  });

  it("supports zero-I/O sync registration and case-insensitive alias lookup", () => {
    registerBuiltInSlamLibrarySync();
    const schemas = getSlamSchemasFromLibraries();
    assert.ok(schemas.length >= SLAM_BLOCK_SPECS.length);

    assert.equal(lookupSlamModelSchema("CREATE")?.name, "CREATE");
    assert.equal(lookupSlamModelSchema("SLAM.DETECT")?.name, "DETECT");
    assert.equal(lookupSlamModelSchema("seize")?.name, "AWAIT");
    assert.equal(lookupSlamModelSchema("tally")?.name, "COLCT");
    assert.equal(lookupSlamModelSchema("continuous")?.name, "CONTINUOUS");
  });

  it("executes CONTINUOUS, DETECT, RESOURCE, and COLCT kernels in runtime.wasm", async () => {
    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg?.wasmBytes);
    const mod = await WebAssembly.instantiate(pkg.wasmBytes, {
      env: {
        abort: () => {
          throw new Error("WASM abort");
        },
      },
    });
    const exports = mod.instance.exports as {
      memory: WebAssembly.Memory;
      slamBlockInit: (arch: number, ptr: number) => void;
      slamBlockStep: (arch: number, dt: number, ptr: number) => number;
    };

    if (exports.memory.buffer.byteLength < 65536) {
      exports.memory.grow(1);
    }
    const mem = new Float64Array(exports.memory.buffer);
    const slotBase = 1024; // byte offset
    const f64Idx = slotBase / 8;

    // 1. CONTINUOUS integrator: rate = 150.0, dt = 0.5 -> state = 75.0
    exports.slamBlockInit(SlamArchetypeId.CONTINUOUS, slotBase);
    mem[f64Idx + 24] = 150.0; // IO[0] at offset 0xC0 = 192 bytes = 24 f64s
    const y1 = exports.slamBlockStep(SlamArchetypeId.CONTINUOUS, 0.5, slotBase);
    assert.ok(Math.abs(y1 - 75.0) < 1e-9, `Expected 75.0, got ${y1}`);

    // 2. DETECT threshold crossing: threshold = 100.0, dir = +1 (XP)
    exports.slamBlockInit(SlamArchetypeId.DETECT, slotBase);
    mem[f64Idx + 0] = 100.0; // CON[0] = threshold
    mem[f64Idx + 2] = 1.0; // CON[2] = XP
    mem[f64Idx + 24] = 80.0; // below threshold
    assert.equal(exports.slamBlockStep(SlamArchetypeId.DETECT, 0.1, slotBase), 0.0);
    mem[f64Idx + 24] = 105.0; // crosses upward!
    assert.equal(exports.slamBlockStep(SlamArchetypeId.DETECT, 0.1, slotBase), 1.0);

    // 3. COLCT running mean: observations 10.0, 20.0, 30.0 -> mean 20.0
    exports.slamBlockInit(SlamArchetypeId.COLCT, slotBase);
    mem[f64Idx + 24] = 10.0;
    exports.slamBlockStep(SlamArchetypeId.COLCT, 0.0, slotBase);
    mem[f64Idx + 24] = 20.0;
    exports.slamBlockStep(SlamArchetypeId.COLCT, 0.0, slotBase);
    mem[f64Idx + 24] = 30.0;
    const mean = exports.slamBlockStep(SlamArchetypeId.COLCT, 0.0, slotBase);
    assert.ok(Math.abs(mean - 20.0) < 1e-9, `Expected mean 20.0, got ${mean}`);
  });
});

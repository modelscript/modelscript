// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  HEC2_STD_SPECS,
  Hec2ArchetypeId,
  getHec2SchemasFromLibraries,
  getHec2StdLibWasmBytes,
  lookupHec2ModelSchema,
  registerBuiltInHec2LibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/hec2-std-lib");

describe("@modelscript/hec2 — Cleanroom Standard Library (Chow/USACE Manning's n & Losses)", () => {
  it("loads @modelscript/hec2-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected assets/hec2-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/hec2-std-lib");
    assert.equal(pkg.manifest.language, "hec2");
    assert.equal(pkg.symbols.length, HEC2_STD_SPECS.length);
    assert.equal(pkg.diagrams.length, HEC2_STD_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected SVG icon for ${diag.namePath}`);
      assert.ok(diag.ports.length >= 2, `Expected hydraulic ports for ${diag.namePath}`);
    }
  });

  it("supports zero-I/O sync registration and lookup across concrete, earth, natural stream, floodplain, and bridge/culvert schemas", () => {
    registerBuiltInHec2LibrarySync();
    const schemas = getHec2SchemasFromLibraries();
    assert.ok(schemas.length >= HEC2_STD_SPECS.length);

    assert.equal(lookupHec2ModelSchema("CONCRETE_TROWELED")?.name, "CONCRETE_TROWELED");
    assert.equal(lookupHec2ModelSchema("earth_clean")?.name, "EARTH_CLEAN_STRAIGHT");
    assert.equal(lookupHec2ModelSchema("natural_stream_winding")?.name, "STREAM_WINDING_POOLS");
    assert.equal(lookupHec2ModelSchema("floodplain_timber")?.name, "FLOODPLAIN_HEAVY_TIMBER");
    assert.equal(lookupHec2ModelSchema("typical_bridge")?.name, "BRIDGE_TYPICAL");
    assert.equal(lookupHec2ModelSchema("box_culvert")?.name, "CULVERT_BOX_WINGWALL");
  });

  it("executes Manning conveyance and contraction/expansion head-loss kernels in runtime.wasm", async () => {
    const wasmBytes = getHec2StdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 0, "Expected embedded WASM bytes");

    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as {
      hec2ManningConveyance: (n: number, area: number, r: number, isSi: number) => number;
      hec2ManningVelocity: (n: number, r: number, s: number, isSi: number) => number;
      hec2TransitionHeadLoss: (hvDown: number, hvUp: number, cchv: number, cehv: number) => number;
      hec2DefaultManningN: (archetypeId: number) => number;
      hec2EvalHydraulics: (archetypeId: number, area: number, r: number, isSi: number) => number;
    };

    // SI conveyance: K = (1.0 / 0.025) * 20 * 1.5^(2/3)
    const kSi = exports.hec2ManningConveyance(0.025, 20.0, 1.5, 1);
    const kSiExpected = (1.0 / 0.025) * 20.0 * Math.pow(1.5, 2 / 3);
    assert.ok(Math.abs(kSi - kSiExpected) < 1e-10, `Expected K_SI=${kSiExpected}, got ${kSi}`);

    // US conveyance: K = (1.486 / 0.030) * 100 * 3.0^(2/3)
    const kUs = exports.hec2ManningConveyance(0.03, 100.0, 3.0, 0);
    const kUsExpected = (1.486 / 0.03) * 100.0 * Math.pow(3.0, 2 / 3);
    assert.ok(Math.abs(kUs - kUsExpected) < 1e-9, `Expected K_US=${kUsExpected}, got ${kUs}`);

    // Transition loss: contraction (hvUp > hvDown uses cchv=0.1) vs expansion (hvUp < hvDown uses cehv=0.3)
    const hCont = exports.hec2TransitionHeadLoss(0.2, 0.5, 0.1, 0.3);
    const hExp = exports.hec2TransitionHeadLoss(0.5, 0.2, 0.1, 0.3);
    assert.ok(Math.abs(hCont - 0.03) < 1e-12);
    assert.ok(Math.abs(hExp - 0.09) < 1e-12);

    // Archetype default Manning n
    assert.equal(exports.hec2DefaultManningN(Hec2ArchetypeId.CONCRETE_TROWELED), 0.013);
    assert.equal(exports.hec2DefaultManningN(Hec2ArchetypeId.FLOODPLAIN_HEAVY_TIMBER), 0.1);
    assert.ok(exports.hec2EvalHydraulics(Hec2ArchetypeId.STREAM_CLEAN_STRAIGHT, 25.0, 2.0, 1) > 0);
  });
});

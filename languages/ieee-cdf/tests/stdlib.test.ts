// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IEEE_14_BUS_CDF,
  IEEE_5_BUS_CDF,
  IeeeCdfArchetypeId,
  ensureBuiltInIeeeCdfLibraryRegistered,
  getIeeeCdfSchemasFromLibraries,
  getIeeeCdfStdLibWasmBytes,
  lookupIeeeCdfModelSchema,
} from "../src/catalog/index.js";

describe("@modelscript/ieee-cdf Cleanroom Standard Library Suite", () => {
  it("registers @modelscript/ieee-cdf-std-lib in globalLibraryRegistry with zero I/O", () => {
    ensureBuiltInIeeeCdfLibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("ieee-cdf");
    assert.ok(pkgs.length >= 1, "At least one ieee-cdf library package should be registered");
    assert.strictEqual(pkgs[0]!.packageName, "@modelscript/ieee-cdf-std-lib");

    const schemas = getIeeeCdfSchemasFromLibraries();
    assert.ok(schemas.length >= 6, `Expected >= 6 archetypes, got ${schemas.length}`);
    for (const s of schemas) {
      assert.ok(s.svg && s.svg.includes("<svg"), `Schema ${s.name} should have cleanroom SVG icon`);
      assert.ok(s.parameters.length > 0, `Schema ${s.name} should define parameters`);
    }
  });

  it("resolves bus and branch archetypes by canonical name and alias", () => {
    assert.strictEqual(lookupIeeeCdfModelSchema("PQ_BUS")?.name, "PQ_BUS");
    assert.strictEqual(lookupIeeeCdfModelSchema("BQ")?.name, "PV_BUS");
    assert.strictEqual(lookupIeeeCdfModelSchema("BS")?.name, "SLACK_BUS");
    assert.strictEqual(lookupIeeeCdfModelSchema("TRANSMISSION_LINE")?.name, "TRANSMISSION_LINE");
    assert.strictEqual(lookupIeeeCdfModelSchema("TCUL")?.name, "TAP_TRANSFORMER");
    assert.strictEqual(lookupIeeeCdfModelSchema("PHASE_SHIFTER")?.name, "PHASE_SHIFTER");
  });

  it("instantiates cleanroom AssemblyScript runtime.wasm and evaluates transmission line flow", async () => {
    const wasmBytes = getIeeeCdfStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 100, "WASM runtime bytes should be non-empty");

    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as {
      memory: WebAssembly.Memory;
      ieeeCdfGetArenaBase: () => number;
      ieeeCdfModelInit: (arch: number, slotPtr: number, conCount: number) => number;
      ieeeCdfModelEval: (arch: number, slotPtr: number, conCount: number) => void;
    };

    const slotPtr = exports.ieeeCdfGetArenaBase();
    const f64 = new Float64Array(exports.memory.buffer);
    const conBase = (slotPtr + 0x080) >> 3;
    const ioBase = (slotPtr + 0x780) >> 3;

    // Transmission line: R=0.02, X=0.06, B=0.06
    f64[conBase + 0] = 0.02;
    f64[conBase + 1] = 0.06;
    f64[conBase + 2] = 0.06;
    // Vf = 1.06 < 0 rad, Vt = 1.00 < -0.05 rad
    f64[ioBase + 0] = 1.06;
    f64[ioBase + 1] = 0.0;
    f64[ioBase + 2] = 1.0;
    f64[ioBase + 3] = -0.05;

    exports.ieeeCdfModelEval(IeeeCdfArchetypeId.TRANSMISSION_LINE, slotPtr, 3);
    const pFrom = f64[ioBase + 4]!;
    const pTo = f64[ioBase + 6]!;
    assert.ok(pFrom > 0.5, `Expected positive active power flow from bus 1->2, got ${pFrom}`);
    assert.ok(pFrom + pTo > 0, "Series resistance loss P_from + P_to should be positive");
  });

  it("embeds cleanroom IEEE 5-bus and IEEE 14-bus reference CDF decks", () => {
    assert.ok(IEEE_5_BUS_CDF.includes("BUS DATA FOLLOWS"));
    assert.ok(IEEE_5_BUS_CDF.includes("END OF DATA"));
    assert.ok(IEEE_14_BUS_CDF.includes("IEEE 14 BUS TEST CASE"));
    assert.ok(IEEE_14_BUS_CDF.includes("END OF DATA"));
  });
});

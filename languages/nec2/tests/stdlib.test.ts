// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NEC2_STD_SPECS,
  ensureBuiltInNec2LibraryRegistered,
  generateNec2ArchetypeDeck,
  getNec2SchemasFromLibraries,
  getNec2StdLibWasmBytes,
  lintNec2,
  lookupNec2ModelSchema,
  parseNec2Deck,
  solveNec2Deck,
} from "../src/index.js";

describe("@modelscript/nec2 Cleanroom Standard Library (@modelscript/nec2-std-lib)", () => {
  it("registers @modelscript/nec2-std-lib in globalLibraryRegistry with all 6 antenna archetypes", () => {
    ensureBuiltInNec2LibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("nec2");
    assert.ok(pkgs.length >= 1, "Expected @modelscript/nec2-std-lib registered");

    const schemas = getNec2SchemasFromLibraries();
    assert.strictEqual(schemas.length, 6, "Expected 6 standard antenna archetypes");

    const expectedNames = [
      "HALF_WAVE_DIPOLE",
      "QUARTER_WAVE_MONOPOLE",
      "FOLDED_DIPOLE",
      "YAGI_UDA_3EL",
      "CIRCULAR_LOOP",
      "GROUND_PLANE",
    ];
    for (const name of expectedNames) {
      const schema = lookupNec2ModelSchema(name);
      assert.ok(schema, `Expected schema '${name}' in registry`);
      assert.ok(schema.svg && schema.svg.includes("<svg"), `Expected cleanroom SVG icon for '${name}'`);
      assert.ok(schema.parameters.length >= 4, `Expected parameters for '${name}'`);
    }

    // Alias lookup
    assert.strictEqual(lookupNec2ModelSchema("DIPOLE")?.name, "HALF_WAVE_DIPOLE");
    assert.strictEqual(lookupNec2ModelSchema("YAGI")?.name, "YAGI_UDA_3EL");
  });

  it("instantiates and executes the cleanroom AssemblyScript WASM runtime kernel", async () => {
    const wasmBytes = getNec2StdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 200, "Expected non-empty WASM binary");

    const instantiated = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instantiated.instance.exports as {
      memory: WebAssembly.Memory;
      nec2ModelInit: (archetypeId: number, slotPtr: number, conCount: number) => void;
      nec2ModelStep: (archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number) => void;
    };

    assert.strictEqual(typeof exports.nec2ModelInit, "function");
    assert.strictEqual(typeof exports.nec2ModelStep, "function");

    const slotPtr = 0x1000;
    if (exports.memory.buffer.byteLength < slotPtr + 2048) {
      exports.memory.grow(1);
    }
    const view = new Float64Array(exports.memory.buffer, slotPtr, 256);
    // CON[0] = 300 MHz, CON[4] = 50 Ohm
    view[0x080 / 8 + 0] = 300.0;
    view[0x080 / 8 + 4] = 50.0;
    // IO[0] = vFeed = 1.0 V
    view[0x780 / 8 + 0] = 1.0;

    exports.nec2ModelInit(1, slotPtr, 5);
    const rIn = view[0x780 / 8 + 2]!;
    const xIn = view[0x780 / 8 + 3]!;
    const dbi = view[0x780 / 8 + 6]!;

    assert.ok(Math.abs(rIn - 73.13) < 0.01, `Expected dipole R_in=73.13, got ${rIn}`);
    assert.ok(Math.abs(xIn - 42.54) < 0.01, `Expected dipole X_in=42.54, got ${xIn}`);
    assert.ok(Math.abs(dbi - 2.15) < 0.01, `Expected dipole D=2.15 dBi, got ${dbi}`);

    exports.nec2ModelStep(1, 0, 1e-11, slotPtr, 5);
    const iFeed = view[0x780 / 8 + 1]!;
    assert.ok(Number.isFinite(iFeed) && iFeed > 0, `Expected positive feed current after step, got ${iFeed}`);
  });

  it("generates valid, lint-clean, solvable NEC-2 decks for all 6 standard archetypes", () => {
    for (const spec of NEC2_STD_SPECS) {
      const deckSrc = generateNec2ArchetypeDeck(spec.modelType);
      const deck = parseNec2Deck(deckSrc);
      const errors = lintNec2(deck).filter((d) => d.severity === "error");
      assert.strictEqual(
        errors.length,
        0,
        `Archetype '${spec.modelType}' produced lint errors: ${JSON.stringify(errors)}`,
      );

      const res = solveNec2Deck(deck, { computeFarField: false });
      assert.strictEqual(res.points.length, 1);
      const pt = res.points[0]!;
      assert.ok(
        Number.isFinite(pt.feedpointImpedance.re) && pt.feedpointImpedance.re > 0,
        `Expected positive R_in for ${spec.modelType}, got ${pt.feedpointImpedance.re}`,
      );
    }
  });
});

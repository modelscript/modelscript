// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  LUSTRE_OPERATOR_SPECS,
  getLustreSchemasFromLibraries,
  instantiateLustreWasmOperator,
  lookupLustreOperatorSchema,
  registerBuiltInLustreLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/lustre-std-lib");

describe("@modelscript/lustre — Cleanroom Standard Library (modelscript.yaml & runtime.wasm)", () => {
  it("loads @modelscript/lustre-std-lib via modelscript.yaml with all 9 operators, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected lustre-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg);
    assert.strictEqual(pkg.packageName, "@modelscript/lustre-std-lib");
    assert.strictEqual(pkg.manifest.language, "lustre");
    assert.strictEqual(pkg.symbols.length, LUSTRE_OPERATOR_SPECS.length);
    assert.strictEqual(pkg.diagrams.length, LUSTRE_OPERATOR_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm");

    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected cleanroom SVG icon for ${diag.namePath}`);
      assert.ok(diag.ports.length >= 2, `Expected ports for ${diag.namePath}`);
    }
  });

  it("supports zero-I/O sync registration and alias lookup for all 9 temporal operators", () => {
    registerBuiltInLustreLibrarySync();
    const schemas = getLustreSchemasFromLibraries();
    assert.ok(schemas.length >= 9);

    const expected = [
      "Edge",
      "RisingEdge",
      "FallingEdge",
      "Counter",
      "Timer",
      "IntegratorEuler",
      "PIDDiscrete",
      "Latch",
      "OnceSince",
    ];
    for (const name of expected) {
      assert.strictEqual(lookupLustreOperatorSchema(name)?.name, name, `Expected schema for ${name}`);
    }
    assert.strictEqual(lookupLustreOperatorSchema("REdge")?.name, "RisingEdge");
    assert.strictEqual(lookupLustreOperatorSchema("SRLatch")?.name, "Latch");
  });

  it("executes RisingEdge, Counter, IntegratorEuler, PIDDiscrete, Latch, and OnceSince in runtime.wasm", () => {
    // 1. RisingEdge
    const redge = instantiateLustreWasmOperator("RisingEdge")!;
    assert.deepStrictEqual(
      [0, 1, 1, 0, 1].map((x) => redge.step([x])[0]),
      [0, 1, 0, 0, 1],
    );

    // 2. Counter (init=0, incr=2, reset at tick 3)
    const cnt = instantiateLustreWasmOperator("Counter")!;
    assert.deepStrictEqual(
      [
        cnt.step([0, 2, 0])[0],
        cnt.step([0, 2, 0])[0],
        cnt.step([0, 2, 0])[0],
        cnt.step([0, 2, 1])[0],
        cnt.step([0, 2, 0])[0],
      ],
      [0, 2, 4, 0, 2],
    );

    // 3. IntegratorEuler (u=10, dt=0.1, y0=1.0)
    const integ = instantiateLustreWasmOperator("IntegratorEuler")!;
    const y0 = integ.step([10, 0.1, 1.0])[0]!;
    const y1 = integ.step([10, 0.1, 1.0])[0]!;
    const y2 = integ.step([10, 0.1, 1.0])[0]!;
    assert.ok(Math.abs(y0 - 1.0) < 1e-9);
    assert.ok(Math.abs(y1 - 2.0) < 1e-9);
    assert.ok(Math.abs(y2 - 3.0) < 1e-9);

    // 4. PIDDiscrete
    const pid = instantiateLustreWasmOperator("PIDDiscrete", { kp: 2.0, ki: 1.0, kd: 0.0, outMin: -10, outMax: 10 })!;
    const u0 = pid.step([1.0, 0.1])[0]!; // tick 0: P=2.0, I=0, D=0
    const u1 = pid.step([1.0, 0.1])[0]!; // tick 1: P=2.0, I=0.1, D=0 -> 2.1
    assert.ok(Math.abs(u0 - 2.0) < 1e-9);
    assert.ok(Math.abs(u1 - 2.1) < 1e-9);

    // 5. Latch
    const latch = instantiateLustreWasmOperator("Latch")!;
    assert.deepStrictEqual(
      [
        latch.step([0, 0, 0])[0], // init=0 -> 0
        latch.step([1, 0, 0])[0], // set -> 1
        latch.step([0, 0, 0])[0], // hold -> 1
        latch.step([0, 1, 0])[0], // reset -> 0
      ],
      [0, 1, 1, 0],
    );

    // 6. OnceSince(a, b)
    const os = instantiateLustreWasmOperator("OnceSince")!;
    assert.deepStrictEqual(
      [
        os.step([0, 1])[0], // b=1, a=0 -> 0
        os.step([1, 0])[0], // a=1 -> 1
        os.step([0, 0])[0], // still 1 since b
        os.step([0, 1])[0], // b=1 resets -> 0
      ],
      [0, 1, 1, 0],
    );
  });
});

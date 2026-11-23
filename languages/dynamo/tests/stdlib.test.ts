// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DYNAMO_STD_FUNCTION_SPECS,
  ensureBuiltInDynamoLibraryRegistered,
  getDynamoSchemasFromLibraries,
  getDynamoStdLibWasmBytes,
  lookupDynamoFunctionSchema,
  parseDynamo,
  simulateDynamo,
} from "../src/index.js";

describe("@modelscript/dynamo Cleanroom Standard Library Suite", () => {
  it("registers @modelscript/dynamo-std-lib in globalLibraryRegistry with all 12 functions and SVG icons", () => {
    ensureBuiltInDynamoLibraryRegistered();

    const pkgs = globalLibraryRegistry.getPackagesForLanguage("dynamo");
    assert.ok(pkgs.length >= 1, "Expected dynamo stdlib package registered");

    const schemas = getDynamoSchemasFromLibraries();
    assert.strictEqual(schemas.length, 12, `Expected 12 DYNAMO stdlib schemas, got ${schemas.length}`);

    const required = [
      "SMOOTH",
      "DLINF1",
      "DLINF3",
      "DELAY1",
      "DELAY3",
      "TABLE",
      "TABHL",
      "CLIP",
      "SWITCH",
      "STEP",
      "PULSE",
      "RAMP",
    ];
    for (const fn of required) {
      const schema = lookupDynamoFunctionSchema(fn);
      assert.ok(schema, `Missing schema for ${fn}`);
      assert.ok(schema.svg && schema.svg.includes("<svg"), `Missing SVG icon for ${fn}`);
      assert.ok(schema.ports.length >= 2, `Expected ports on ${fn}`);
    }
    assert.strictEqual(DYNAMO_STD_FUNCTION_SPECS.length, 12);
  });

  it("instantiates and executes cleanroom AssemblyScript runtime.wasm kernels", async () => {
    const wasmBytes = getDynamoStdLibWasmBytes();
    assert.ok(wasmBytes.byteLength > 100, "Expected non-empty WASM binary");

    const { instance } = await WebAssembly.instantiate(wasmBytes);
    const exports = instance.exports as Record<string, (...args: number[]) => number>;

    assert.strictEqual(exports["dynamo_eval_clip"]!(10, 20, 5, 3), 10);
    assert.strictEqual(exports["dynamo_eval_clip"]!(10, 20, 2, 3), 20);
    assert.strictEqual(exports["dynamo_eval_switch"]!(10, 20, 0), 10);
    assert.strictEqual(exports["dynamo_eval_switch"]!(10, 20, 1), 20);
    assert.strictEqual(exports["dynamo_eval_step"]!(5, 2, 1.5), 0);
    assert.strictEqual(exports["dynamo_eval_step"]!(5, 2, 2.0), 5);
    assert.strictEqual(exports["dynamo_eval_ramp"]!(3, 1, 4), 9);
    assert.strictEqual(exports["dynamo_eval_pulse"]!(7, 2, 5, 2, 0.25), 7);
    assert.strictEqual(exports["dynamo_eval_pulse"]!(7, 2, 5, 3, 0.25), 0);
    assert.ok(Math.abs(exports["dynamo_eval_smooth_deriv"]!(10, 4, 2) - 3) < 1e-12);
    assert.ok(Math.abs(exports["dynamo_eval_table_interp"]!(2, 6, 0.25, 1) - 3) < 1e-12);
  });

  it("evaluates SMOOTH, DELAY1, DELAY3, TABLE, TABHL, CLIP, SWITCH, STEP, PULSE, RAMP in solver", () => {
    const src = `
NOTE STDLIB FUNCTIONS TEST
A ST.K=STEP(10, 2)
A RP.K=RAMP(2, 1)
A PL.K=PULSE(5, 2, 4)
A CL.K=CLIP(1, 0, TIME.K, 3)
A SW.K=SWITCH(1, 0, CL.K)
A SM.K=SMOOTH(ST.K, 2)
A D1.K=DELAY1(ST.K, 2)
A D3.K=DELAY3(ST.K, 3)
A TB.K=TABLE(MYTAB, TIME.K, 0, 4, 2)
A TH.K=TABHL(MYTAB, TIME.K, 0, 4, 2)
T MYTAB=0/2/4
SPEC DT=0.1/LENGTH=10
`;
    const sim = simulateDynamo(parseDynamo(src), { integrator: "euler" });

    // At TIME=10: STEP(10,2)=10, RAMP(2,1)=18, CL=1, SW=0
    assert.strictEqual(sim.finalValues["ST"], 10);
    assert.ok(Math.abs(sim.finalValues["RP"]! - 18) < 1e-9);
    assert.strictEqual(sim.finalValues["CL"], 1);
    assert.strictEqual(sim.finalValues["SW"], 0);

    // TABLE extrapolates linearly to 10; TABHL clamps to 4
    assert.ok(Math.abs(sim.finalValues["TB"]! - 10) < 1e-9);
    assert.ok(Math.abs(sim.finalValues["TH"]! - 4) < 1e-9);

    // SMOOTH, DELAY1, DELAY3 converge toward step height 10
    assert.ok(sim.finalValues["SM"]! > 9.5 && sim.finalValues["SM"]! <= 10.0);
    assert.ok(sim.finalValues["D1"]! > 9.5 && sim.finalValues["D1"]! <= 10.0);
    assert.ok(sim.finalValues["D3"]! > 9.0 && sim.finalValues["D3"]! <= 10.0);

    // PULSE fired at TIME=2 and TIME=6
    const pulseAt2 = sim.series["PL"]![20]!;
    const pulseAt3 = sim.series["PL"]![30]!;
    assert.strictEqual(pulseAt2, 5);
    assert.strictEqual(pulseAt3, 0);
  });
});

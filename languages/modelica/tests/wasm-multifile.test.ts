// SPDX-License-Identifier: AGPL-3.0-or-later

import { printArenaDAE } from "@modelscript/runtime";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

async function runTests() {
  console.log("Testing Multi-File WASM Flattener Source Buffer...");
  const { parser } = await createWasmParser(modelicaWasm);
  Context.registerParser(".mo", parser as any);

  // 1. Cross-file extends + component + connect across 3 files + 4th unrelated file loaded last
  {
    const ctx = new Context(new NodeFileSystem());

    ctx.load(
      `
connector Pin
  Real v;
  flow Real i;
end Pin;

partial model TwoPin
  Pin p;
  Pin n;
  Real v;
  Real i;
equation
  v = p.v - n.v;
  0 = p.i + n.i;
  i = p.i;
end TwoPin;
`,
      "file:///test/interfaces.mo",
    );

    ctx.load(
      `
model MyResistor
  extends TwoPin;
  parameter Real R = 10.0;
equation
  R * i = v;
end MyResistor;

model MyGround
  Pin p;
equation
  p.v = 0.0;
end MyGround;

model MySource
  extends TwoPin;
  parameter Real V0 = 5.0;
equation
  v = V0;
end MySource;
`,
      "file:///test/components.mo",
    );

    ctx.load(
      `
model MultiFileCircuit
  MySource src(V0 = 12.0);
  MyResistor r1(R = 4.0);
  MyGround gnd;
equation
  connect(src.p, r1.p);
  connect(r1.n, src.n);
  connect(src.n, gnd.p);
end MultiFileCircuit;
`,
      "file:///test/circuit.mo",
    );

    // Load an unrelated 4th file AFTER circuit.mo so parser's single inputBuffer is overwritten!
    ctx.load(
      `
model UnrelatedNoise
  Real junk = 999.0;
end UnrelatedNoise;
`,
      "file:///test/unrelated.mo",
    );

    const wasmDae = ctx.flattenArena("MultiFileCircuit", undefined, "file:///test/circuit.mo", { backend: "wasm" });
    const tsDae = ctx.flattenArena("MultiFileCircuit", undefined, "file:///test/circuit.mo", { backend: "ts" });

    assert(wasmDae !== null, "wasmDae should not be null");
    assert(tsDae !== null, "tsDae should not be null");

    const wasmErrors = wasmDae!.diagnostics.filter((d) => d.severity === "error");
    assert.strictEqual(
      wasmErrors.length,
      0,
      `Expected 0 WASM errors, got: ${wasmErrors.map((e) => e.message).join("; ")}`,
    );

    assert.strictEqual(
      wasmDae!.varCount,
      tsDae!.varCount,
      `varCount mismatch: WASM=${wasmDae!.varCount}, TS=${tsDae!.varCount}`,
    );
    assert.strictEqual(
      wasmDae!.eqCount,
      tsDae!.eqCount,
      `eqCount mismatch: WASM=${wasmDae!.eqCount}, TS=${tsDae!.eqCount}`,
    );

    const wasmVarNames = Array.from({ length: wasmDae!.varCount }, (_, i) => wasmDae!.getVarName(i));
    const tsVarNames = Array.from({ length: tsDae!.varCount }, (_, i) => tsDae!.getVarName(i));
    assert.deepStrictEqual(wasmVarNames, tsVarNames, "Variable names and order should match TS");

    const wasmOut = printArenaDAE(wasmDae!);
    assert(wasmOut.includes("parameter Real src.V0 = 12.0;"), "Expected cross-file V0 modifier");
    assert(wasmOut.includes("parameter Real r1.R = 4.0;"), "Expected cross-file R modifier");
    assert(wasmOut.includes("r1.R * r1.i = r1.v;"), "Expected cross-file resistor equation");
    assert(wasmOut.includes("src.v = src.p.v - src.n.v;"), "Expected cross-file inherited TwoPin equation");
    assert(wasmOut.includes("gnd.p.v = 0.0;"), "Expected cross-file ground equation");
    console.log(
      `  ✔ Test 1 passed: 3-file circuit + stale inputBuffer matches TS (vars=${wasmDae!.varCount}, eqs=${wasmDae!.eqCount})`,
    );
  }

  // 2. Real MSL multi-file tests (if MSL 4.1.0 is present locally)
  const mslDir = path.resolve(__dirname, "../../../data/libraries/Modelica/4.1.0/extracted/Modelica");
  if (fs.existsSync(mslDir)) {
    const ctx = new Context(new NodeFileSystem());
    await ctx.addLibrary(mslDir);

    const exactParityModels = [
      "Modelica.Electrical.Analog.Basic.Resistor",
      "Modelica.Electrical.Analog.Basic.Ground",
      "Modelica.Electrical.Analog.Examples.ChuaCircuit",
      "Modelica.Electrical.Analog.Examples.CauerLowPassAnalog",
      "Modelica.Electrical.Analog.Examples.SwitchWithArc",
    ];

    for (const fqn of exactParityModels) {
      const wasmDae = ctx.flattenArena(fqn, undefined, undefined, { backend: "wasm" });
      const tsDae = ctx.flattenArena(fqn, undefined, undefined, { backend: "ts" });
      assert(wasmDae !== null && tsDae !== null, `${fqn} DAE should not be null`);
      const wasmErrs = wasmDae!.diagnostics.filter((d) => d.severity === "error");
      assert.strictEqual(
        wasmErrs.length,
        0,
        `Expected 0 WASM errors on ${fqn}, got: ${wasmErrs.map((e) => e.message).join("; ")}`,
      );
      assert.strictEqual(wasmDae!.varCount, tsDae!.varCount, `${fqn} varCount mismatch`);
      assert.strictEqual(wasmDae!.eqCount, tsDae!.eqCount, `${fqn} eqCount mismatch`);
      console.log(`  ✔ MSL ${fqn} matches TS in strict WASM (vars=${wasmDae!.varCount}, eqs=${wasmDae!.eqCount})`);
    }

    const multiDomainModels = [
      "Modelica.Electrical.Analog.Examples.SimpleTriacCircuit",
      "Modelica.Electrical.Analog.Examples.CauerLowPassSC",
      "Modelica.Electrical.Analog.Examples.DemoPowerSupply",
      "Modelica.Electrical.Analog.Examples.DemoPowerSupplyWithBuffer",
      "Modelica.Mechanics.Rotational.Examples.LossyGearDemo1",
      "Modelica.Mechanics.Translational.Examples.Vehicle",
      "Modelica.Thermal.HeatTransfer.Examples.Motor",
      "Modelica.Blocks.Examples.DemonstrateSignalExtrema",
    ];

    for (const fqn of multiDomainModels) {
      const wasmDae = ctx.flattenArena(fqn, undefined, undefined, { backend: "wasm" });
      assert(wasmDae !== null, `${fqn} DAE should not be null`);
      const errs = wasmDae!.diagnostics.filter((d) => d.severity === "error");
      assert.strictEqual(
        errs.length,
        0,
        `Expected 0 WASM errors on ${fqn}, got: ${errs.map((e) => e.message).join("; ")}`,
      );
      assert(wasmDae!.varCount > 0 && wasmDae!.eqCount > 0, `${fqn} should have vars and eqs`);
      console.log(`  ✔ MSL ${fqn} passed strict WASM (vars=${wasmDae!.varCount}, eqs=${wasmDae!.eqCount})`);
      wasmDae!.free?.();
    }
  }
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

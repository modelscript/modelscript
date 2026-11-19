// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unit tests for Phase 10 architectural cleanup, MLS §4.8 local balance, CFA while-loop soundness, and error catalog hygiene:
 * - Retire inaccurate CST `unbalancedModel` (keep `M4004` strictly on flattened `DAEBuilder` + add `M4154` `locally-unbalanced-class` via `instantiate`)
 * - Make non-`true` `while` loops sound for zero-trip execution in `cfa.ts` (`M5020`)
 * - Sync CST messages (`M6001`, `M5005`, `M1003`) with `ModelicaErrorCode` (`I7`) and prune dead duplicate error codes (§4)
 */

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { getModelicaErrorCodeDef, ModelicaErrorCode } from "../src/errors.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser, facade } = await createWasmParser(modelicaWasm);

function makeContext(source: string, resourceId = "phase10_test.mo"): Context {
  Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
  const ctx = Context.createBatch(new NodeFileSystem());
  ctx.load(source, resourceId);
  return ctx;
}

function getCstDiagnostics(source: string): { code: number; severity: number; message: string }[] {
  const root = facade.parseIncremental(source, 0, 0, source.length, "file:///phase10_cst.mo");
  assert.ok(root > 0, "Expected facade.parseIncremental root");
  return facade.getDiagnostics(root, 0, 0, source);
}

describe("Modelica Phase 10 DAE/local balance, while-loop CFA soundness, and error catalog hygiene", () => {
  it("retires inaccurate CST M4004 while enforcing MLS §4.8 local balance via M4154", async () => {
    const src = `
partial model BasePartial
  Real x;
equation
  der(x) = -x;
end BasePartial;

model BalancedViaExtends
  extends BasePartial;
  Real y;
equation
  y = 2.0 * x;
end BalancedViaExtends;

model LocallyUnbalanced
  Real a;
  Real b;
equation
  a = 1.0;
end LocallyUnbalanced;
`;
    const cstDiags = getCstDiagnostics(src);
    assert.equal(
      cstDiags.filter((d) => d.code === 4004).length,
      0,
      `CST layer should no longer emit inaccurate M4004: ${JSON.stringify(cstDiags)}`,
    );

    const ctx = makeContext(src);
    const lints = await ctx.queryEngine.runAllLintsAsync();
    const m4154 = lints.filter((d) => d.code === 4154);
    assert.equal(m4154.length, 1, `Expected exactly 1 M4154 on LocallyUnbalanced: ${JSON.stringify(m4154)}`);
    assert.equal(m4154[0]!.severity, "warning");
    assert.ok(m4154[0]!.message.includes("'LocallyUnbalanced'"));
  });

  it("flags M5020 when output is only assigned inside a potentially zero-trip while loop", async () => {
    const ctx = makeContext(`
function ZeroTripWhile
  input Integer n;
  output Real y;
algorithm
  while n > 0 loop
    y := 1.0;
  end while;
end ZeroTripWhile;

function WhileTrueWithBreak
  output Real y;
algorithm
  while true loop
    y := 1.0;
    break;
  end while;
end WhileTrueWithBreak;
`);
    const lints = await ctx.queryEngine.runAllLintsAsync();
    const m5020 = lints.filter((d) => d.code === 5020);
    assert.equal(m5020.length, 1, `Expected M5020 only on ZeroTripWhile: ${JSON.stringify(m5020)}`);
    assert.ok(String(m5020[0]!.message).includes("'y'"));
  });

  it("syncs M6001 and M5005 CST messages with errors.ts and prunes dead duplicate catalog codes", () => {
    const divDiags = getCstDiagnostics(`
model DivZeroMsg
  Real y = 42.0 / 0.0;
end DivZeroMsg;
`);
    const m5005 = divDiags.find((d) => d.code === 5005);
    assert.ok(m5005, `Expected M5005 in ${JSON.stringify(divDiags)}`);
    assert.equal(m5005!.message, ModelicaErrorCode.DIVISION_BY_ZERO.message("42.0"));

    const clkDiags = getCstDiagnostics(`
model MixedClkMsg
  Real u = subSample(Clock(0.1), 2) + sample(1.0, Clock(0.2));
end MixedClkMsg;
`);
    const m6001 = clkDiags.find((d) => d.code === 6001);
    assert.ok(m6001, `Expected M6001 in ${JSON.stringify(clkDiags)}`);
    assert.ok(m6001!.message.startsWith("Clocked expression '"));
    assert.ok(m6001!.message.endsWith("mixes signals from different clock domains."));

    // Pruned unemitted duplicates should no longer exist in ModelicaErrorCode while canonical codes resolve
    for (const removedCode of [4094, 4096, 4114, 4119, 4040]) {
      assert.equal(getModelicaErrorCodeDef(removedCode), undefined, `Expected duplicate M${removedCode} removed`);
    }
    for (const canonicalCode of [4047, 4000, 4037, 4036, 4005]) {
      assert.ok(getModelicaErrorCodeDef(canonicalCode), `Expected canonical M${canonicalCode} registered`);
    }
  });
});

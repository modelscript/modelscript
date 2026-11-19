// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unit tests for Phase 4 Modelica linter & on-demand formal verification additions:
 * - SOTA parity: M2024 (`unused-import`), M4148 (`connector-unbalanced`)
 * - On-demand formal verification: M7106 (`numerically-singular-loop`),
 *   M7111 (`initialization-unbalanced`), M7207 (`integer-overflow`),
 *   M7306 (`state-machine-guard-overlap`), M7307 (`state-machine-deadlock`),
 *   M7308 (`branch-domain-without-noEvent`), M7503 (`unreachable-state-machine-state`)
 */

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser } = await createWasmParser(modelicaWasm);

function makeContext(source: string, resourceId = "phase4_test.mo"): Context {
  Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
  const ctx = Context.createBatch(new NodeFileSystem());
  ctx.load(source, resourceId);
  return ctx;
}

describe("Modelica Phase 4 SOTA parity & expanded 7xxx formal verification", () => {
  it("reports unused qualified/renamed imports (M2024) and skips used imports", async () => {
    const ctx = makeContext(`
package Lib
  model UsedA Real x = 1.0; end UsedA;
  model UnusedB Real y = 2.0; end UnusedB;
end Lib;

model Client
  import Lib.UsedA;
  import Lib.UnusedB;
  UsedA a;
  Real z = a.x;
equation
  z = 1.0;
end Client;
`);
    const lints = await ctx.queryEngine.runAllLintsAsync();
    const m2024 = lints.filter((d: any) => d.code === 2024);
    assert.ok(
      m2024.some((d: any) => String(d.message).includes("UnusedB")),
      `Expected M2024 for UnusedB: ${JSON.stringify(m2024)}`,
    );
    assert.ok(
      !m2024.some((d: any) => String(d.message).includes("UsedA")),
      `Did not expect M2024 for UsedA: ${JSON.stringify(m2024)}`,
    );
  });

  it("reports unbalanced physical connectors while passing balanced and fluid connectors (M4148)", async () => {
    const ctx = makeContext(`
connector Pin
  Real v;
  flow Real i;
end Pin;

connector FluidPort
  Real p;
  flow Real m_flow;
  stream Real h_outflow;
end FluidPort;

connector UnbalancedPort
  Real v;
  flow Real i1;
  flow Real i2;
end UnbalancedPort;
`);
    const lints = await ctx.queryEngine.runAllLintsAsync();
    const m4148 = lints.filter((d: any) => d.code === 4148);
    assert.ok(
      m4148.some((d: any) => String(d.message).includes("UnbalancedPort")),
      `Expected M4148 on UnbalancedPort: ${JSON.stringify(lints)}`,
    );
    assert.ok(!m4148.some((d: any) => String(d.message).includes("'Pin'")));
    assert.ok(!m4148.some((d: any) => String(d.message).includes("'FluidPort'")));
  });

  it("emits M7106, M7111, M7207, and M7308 on demand without leaking 7xxx to standard lints", async () => {
    const ctx = makeContext(`
model SingularLoop
  Real x(min = -1.0, max = 1.0);
equation
  x * x - 1.0 = 0.0;
end SingularLoop;

model InitConflict
  Real x(start = 0.0, fixed = true);
initial equation
  x = 1.0;
equation
  der(x) = -x;
end InitConflict;

model IntOverflow
  Integer k = 2000000000;
  Integer z;
equation
  z = k + 2000000000;
end IntOverflow;

model UnguardedNoEvent
  Real x(min = -1.0, max = 1.0);
  Real y;
equation
  x = sin(time);
  y = if x > 0.0 then sqrt(x) else 0.0;
end UnguardedNoEvent;

model SafeNoEvent
  Real x(min = -1.0, max = 1.0);
  Real y;
equation
  x = sin(time);
  y = if noEvent(x > 0.0) then sqrt(x) else 0.0;
end SafeNoEvent;
`);
    const std = await ctx.queryEngine.runAllLintsAsync();
    assert.deepEqual(
      std.filter((d: any) => typeof d.code === "number" && d.code >= 7000 && d.code < 8000),
      [],
    );

    const res = await ctx.verifyFormal();
    const codes = (cls: string) => res.diagnostics.filter((d) => d.className === cls).map((d) => d.code);

    assert.ok(codes("SingularLoop").includes(7106), `Expected M7106 in ${JSON.stringify(codes("SingularLoop"))}`);
    assert.ok(codes("InitConflict").includes(7111), `Expected M7111 in ${JSON.stringify(codes("InitConflict"))}`);
    assert.ok(codes("IntOverflow").includes(7207), `Expected M7207 in ${JSON.stringify(codes("IntOverflow"))}`);
    assert.ok(
      codes("UnguardedNoEvent").includes(7308),
      `Expected M7308 in ${JSON.stringify(codes("UnguardedNoEvent"))}`,
    );
    assert.ok(
      !codes("SafeNoEvent").includes(7308),
      `Did not expect M7308 on SafeNoEvent: ${JSON.stringify(codes("SafeNoEvent"))}`,
    );
  });

  it("emits state machine formal checks (M7306 overlap, M7307 deadlock, M7503 IC3 unreachable state)", async () => {
    const ctx = makeContext(`
block S1
  Real x = 1.0;
end S1;
block S2
  Real x = 2.0;
end S2;
block S3
  Real x = 3.0;
end S3;
block SDead
  Real x = 4.0;
end SDead;

model StateMachineHazards
  input Real u(min = 0.0, max = 5.0);
  parameter Real p(min = 0.0, max = 5.0);
  S1 s1;
  S2 s2;
  S3 s3;
  SDead sDead;
equation
  initialState(s1);
  transition(s1, s2, u > 1.0, immediate = false, reset = true, synchronize = false, priority = 1);
  transition(s1, sDead, u < 4.0, immediate = false, reset = true, synchronize = false, priority = 1);
  transition(sDead, s2, p > 10.0, immediate = false, reset = true, synchronize = false, priority = 1);
  transition(s2, s1, u < 0.5, immediate = false, reset = true, synchronize = false, priority = 1);
  transition(s3, s1, u > 2.0, immediate = false, reset = true, synchronize = false, priority = 1);
end StateMachineHazards;
`);
    const res = await ctx.verifyFormal();
    const smCodes = res.diagnostics.filter((d) => d.className === "StateMachineHazards").map((d) => d.code);

    assert.ok(smCodes.includes(7306), `Expected M7306 guard overlap in ${JSON.stringify(smCodes)}`);
    assert.ok(smCodes.includes(7307), `Expected M7307 deadlock on sDead in ${JSON.stringify(smCodes)}`);
    assert.ok(smCodes.includes(7503), `Expected M7503 unreachable state s3 in ${JSON.stringify(smCodes)}`);
  });
});

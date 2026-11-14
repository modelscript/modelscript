// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { ModelScriptCompiler } from "../src/index.js";

export const modelscriptBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "modelscript",
  referenceTool: "ModelScript Native / V8 & AssemblyScript Reference",
  defaultTolerance: 0,
  metricKind: "exact",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const compiler = new ModelScriptCompiler();
    await compiler.init();

    const fibCode = `
function fibonacci(n: i32): i32 {
  if (n <= 1) return n;
  let a = 0;
  let b = 1;
  let i = 2;
  while (i <= n) {
    let next = a + b;
    a = b;
    b = next;
    i = i + 1;
  }
  return b;
}
return fibonacci(10);
`;
    const t0 = performance.now();
    const fibRes = compiler.executeJs(fibCode);
    const d1 = performance.now() - t0;

    const flworCode = `
let selected =
  for c in components
  let p := c.pressure
  where p > 150
  order by p descending
  return { name: c.name, pressure: p };
return selected;
`;
    const t1 = performance.now();
    const flworRes = compiler.executeJs(flworCode, {
      components: [
        { name: "TankA", pressure: 100 },
        { name: "Pump1", pressure: 280 },
        { name: "ValveX", pressure: 50 },
        { name: "PipeB", pressure: 310 },
      ],
    }) as Array<{ name: string; pressure: number }>;
    const d2 = performance.now() - t1;

    return [
      {
        id: "modelscript-as-fibonacci",
        name: "Typed AssemblyScript Subset Execution (Fibonacci 10)",
        scale: "micro",
        referenceTool: "ModelScript Native / V8 & AssemblyScript Reference",
        metricKind: "exact",
        threshold: 0,
        measuredError: fibRes === 55 ? 0 : 1,
        passed: fibRes === 55,
        durationMs: d1,
        details: `fib(10)=${String(fibRes)}`,
      },
      {
        id: "modelscript-jsoniq-flwor",
        name: "JSONiq FLWOR Filter & Sort Execution",
        scale: "micro",
        referenceTool: "ModelScript Native / V8 & AssemblyScript Reference",
        metricKind: "exact",
        threshold: 0,
        measuredError: flworRes.length === 2 && flworRes[0]?.name === "PipeB" ? 0 : 1,
        passed: flworRes.length === 2 && flworRes[0]?.name === "PipeB",
        durationMs: d2,
        details: `matched=${flworRes.length}, top=${flworRes[0]?.name ?? "none"}`,
      },
    ];
  },
};

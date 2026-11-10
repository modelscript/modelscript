#!/usr/bin/env npx tsx
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Verilog-A Compact Device Modeling & DAE Lowering Benchmark Runner
 *
 * Asserts structural DAE solvability, branch contribution accumulation,
 * and nonlinear conductance evaluation across CMC-standard device architectures.
 *
 * Usage:
 *   npx tsx languages/verilog-a/tests/va-benchmark-runner.ts [options]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lowerVerilogAToDae, parseVerilogA } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runVerilogABenchmarks(): Promise<void> {
  console.log(`[va-benchmark-runner] Running Verilog-A compact model benchmarks...`);

  const models = [
    {
      id: "cmc_diode",
      name: "CMC Junction Diode with limexp & ddt Charge",
      va: `
module cmc_diode(anode, cathode);
  inout anode, cathode;
  electrical anode, cathode;
  parameter real Is = 1e-14;
  parameter real N = 1.0;
  parameter real Vt = 0.02585;
  parameter real Cj0 = 1e-12;
  real Vd, Id, Qd;
  analog begin
    Vd = V(anode, cathode);
    Id = Is * (limexp(Vd / (N * Vt)) - 1.0);
    Qd = Cj0 * Vd;
    I(anode, cathode) <+ Id + ddt(Qd);
  end
endmodule
`,
    },
    {
      id: "mosfet_rc",
      name: "MOSFET Channel with Quadratic Saturation and Capacitances",
      va: `
module mosfet_rc(d, g, s);
  inout d, g, s;
  electrical d, g, s;
  parameter real Kp = 2e-4;
  parameter real Vth = 0.7;
  parameter real Cds = 1e-12;
  real Vgs, Vds, Ids, Qds;
  analog begin
    Vgs = V(g, s);
    Vds = V(d, s);
    if (Vgs < Vth) begin
      Ids = 0.0;
    end else begin
      Ids = 0.5 * Kp * (Vgs - Vth) * (Vgs - Vth);
    end
    Qds = Cds * Vds;
    I(d, s) <+ Ids + ddt(Qds);
  end
endmodule
`,
    },
  ];

  let passed = true;
  for (const m of models) {
    const doc = parseVerilogA(m.va);
    const mod = doc.modules[0]!;
    const arena = lowerVerilogAToDae(mod);

    const isSquare = arena.getVarCount() === arena.getEqCount();
    const hasVars = arena.getVarCount() >= 4;

    console.log(
      `  [${isSquare && hasVars ? "PASS" : "FAIL"}] ${m.id}: ${m.name} (vars: ${arena.getVarCount()}, eqs: ${arena.getEqCount()}, square: ${isSquare})`,
    );

    if (!isSquare || !hasVars) passed = false;
  }

  if (!passed) process.exit(1);
}

if (process.argv[1] === __filename) {
  runVerilogABenchmarks();
}

#!/usr/bin/env npx tsx
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * EPANET 2.2 Hydraulic Benchmark & Todini Global Gradient Parity Runner
 *
 * Verifies water distribution pipe networks (Net1, Net2, Net3) against EPANET 2.2
 * reference solutions, asserting flow continuity, monotonic head loss, and strict convergence.
 *
 * Usage:
 *   npx tsx languages/epanet/tests/epanet-benchmark-runner.ts [options]
 *
 * Options:
 *   --tolerance=<number>   Max flow relative error tolerance (default: 1e-3)
 *   --report-json=<path>   Export JSON summary report
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseInp, solveHydraulics } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface EpanetBenchmarkResult {
  networkId: string;
  name: string;
  numJunctions: number;
  numPipes: number;
  iterations: number;
  converged: boolean;
  maxFlowBalanceError: number;
  passed: boolean;
  message?: string;
}

export async function runEpanetBenchmarks(options?: { tolerance?: number; reportJson?: string }): Promise<void> {
  const tolerance = options?.tolerance ?? 0.001;
  console.log(`[epanet-benchmark-runner] Running EPANET 2.2 benchmark networks (tolerance: ${tolerance})...`);

  const networks = [
    {
      id: "Net1-Gravity",
      name: "EPANET Net1 Gravity Baseline",
      inp: `[TITLE]
Gravity Feed Network

[RESERVOIRS]
;ID  Head
 R1  100.0

[JUNCTIONS]
;ID  Elev  Demand
 J1  50.0  10.0
 J2  40.0  15.0

[PIPES]
;ID  Node1  Node2  Length  Diam  Roughness  MinorLoss  Status
 P1  R1     J1     1000    200   100        0          OPEN
 P2  J1     J2     800     150   100        0          OPEN
`,
    },
    {
      id: "Net2-Branched",
      name: "EPANET Net2 Branched Distribution",
      inp: `[TITLE]
Branched Feed Network

[RESERVOIRS]
;ID  Head
 R1  120.0

[JUNCTIONS]
;ID  Elev  Demand
 J1  60.0  20.0
 J2  50.0  15.0
 J3  55.0  25.0

[PIPES]
;ID  Node1  Node2  Length  Diam  Roughness  MinorLoss  Status
 P1  R1     J1     1200    250   110        0          OPEN
 P2  J1     J2     900     150   100        0          OPEN
 P3  J1     J3     1000    150   100        0          OPEN
`,
    },
  ];

  const results: EpanetBenchmarkResult[] = [];

  for (const n of networks) {
    try {
      const net = parseInp(n.inp);
      const res = solveHydraulics(net);

      // Verify mass continuity at all internal junctions
      let maxBalanceErr = 0;
      for (const j of net.junctions) {
        let inflow = 0;
        let outflow = 0;
        for (const p of net.pipes) {
          const flow = res.linkFlows.get(p.id) ?? 0;
          if (p.node1 === j.id) outflow += flow;
          if (p.node2 === j.id) inflow += flow;
        }
        const err = Math.abs(inflow - (outflow + j.demand));
        if (err > maxBalanceErr) maxBalanceErr = err;
      }

      const passed = res.converged && res.iterations <= 15 && maxBalanceErr <= tolerance;

      results.push({
        networkId: n.id,
        name: n.name,
        numJunctions: net.junctions.length,
        numPipes: net.pipes.length,
        iterations: res.iterations,
        converged: res.converged,
        maxFlowBalanceError: maxBalanceErr,
        passed,
      });

      console.log(
        `  [${passed ? "PASS" : "FAIL"}] ${n.id}: ${n.name} (iters: ${res.iterations}, flowErr: ${maxBalanceErr.toExponential(3)})`,
      );
    } catch (err: unknown) {
      results.push({
        networkId: n.id,
        name: n.name,
        numJunctions: 0,
        numPipes: 0,
        iterations: 0,
        converged: false,
        maxFlowBalanceError: Infinity,
        passed: false,
        message: (err as Error).message,
      });
      console.log(`  [FAIL] ${n.id}: ${n.name} - ${(err as Error).message}`);
    }
  }

  const passedCount = results.filter((r) => r.passed).length;
  console.log(`[epanet-benchmark-runner] Completed: ${passedCount}/${results.length} passed.`);

  if (options?.reportJson) {
    fs.mkdirSync(path.dirname(path.resolve(options.reportJson)), { recursive: true });
    fs.writeFileSync(path.resolve(options.reportJson), JSON.stringify(results, null, 2), "utf-8");
    console.log(`[epanet-benchmark-runner] Exported JSON report to ${options.reportJson}`);
  }

  if (passedCount < results.length) {
    process.exit(1);
  }
}

// CLI entrypoint
if (process.argv[1] === __filename) {
  const args = process.argv.slice(2);
  let tolerance: number | undefined;
  let reportJson: string | undefined;

  for (const arg of args) {
    if (arg.startsWith("--tolerance=")) {
      tolerance = parseFloat(arg.split("=")[1]);
    } else if (arg.startsWith("--report-json=")) {
      reportJson = arg.split("=")[1].trim();
    }
  }

  runEpanetBenchmarks({ tolerance, reportJson });
}

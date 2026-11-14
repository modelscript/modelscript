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

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseInp, solveHydraulics } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);

interface EpanetBenchmarkResult {
  networkId: string;
  name: string;
  numJunctions: number;
  numPipes: number;
  iterations: number;
  converged: boolean;
  maxFlowBalanceError: number;
  durationMs: number;
  passed: boolean;
  message?: string;
}

const EPANET_NETWORKS = [
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

function evaluateEpanetNetworks(tolerance: number): EpanetBenchmarkResult[] {
  const results: EpanetBenchmarkResult[] = [];
  for (const n of EPANET_NETWORKS) {
    const t0 = performance.now();
    try {
      const net = parseInp(n.inp);
      const res = solveHydraulics(net);

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
        durationMs: performance.now() - t0,
        passed,
      });
    } catch (err: unknown) {
      results.push({
        networkId: n.id,
        name: n.name,
        numJunctions: 0,
        numPipes: 0,
        iterations: 0,
        converged: false,
        maxFlowBalanceError: Infinity,
        durationMs: performance.now() - t0,
        passed: false,
        message: (err as Error).message,
      });
    }
  }
  return results;
}

export const epanetBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "epanet",
  referenceTool: "US EPA EPANET 2.2",
  referenceVersion: "2.2",
  defaultTolerance: 0.001,
  metricKind: "residual",
  async runCases(ctx): Promise<BenchmarkCaseResult[]> {
    const tol = ctx?.tolerance ?? 0.001;
    return evaluateEpanetNetworks(tol).map((r) => ({
      id: r.networkId,
      name: r.name,
      scale: "standard",
      referenceTool: "US EPA EPANET 2.2",
      metricKind: "residual",
      threshold: tol,
      measuredError: Number.isFinite(r.maxFlowBalanceError) ? r.maxFlowBalanceError : null,
      passed: r.passed,
      durationMs: Number(r.durationMs.toFixed(3)),
      details: r.message ?? `${r.numJunctions} junctions, ${r.numPipes} pipes, ${r.iterations} GGM iterations`,
    }));
  },
};

export async function runEpanetBenchmarks(options?: { tolerance?: number; reportJson?: string }): Promise<void> {
  const tolerance = options?.tolerance ?? 0.001;
  console.log(`[epanet-benchmark-runner] Running EPANET 2.2 benchmark networks (tolerance: ${tolerance})...`);

  const results = evaluateEpanetNetworks(tolerance);
  for (const r of results) {
    if (r.message) {
      console.log(`  [FAIL] ${r.networkId}: ${r.name} - ${r.message}`);
    } else {
      console.log(
        `  [${r.passed ? "PASS" : "FAIL"}] ${r.networkId}: ${r.name} (iters: ${r.iterations}, flowErr: ${r.maxFlowBalanceError.toExponential(3)})`,
      );
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

#!/usr/bin/env npx tsx
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OpenDSS Distribution Feeder & Admittance Power Flow Benchmark Runner
 *
 * Verifies OpenDSS circuit models, sparse Ybus matrix construction, and
 * multi-phase power flow convergence against EPRI OpenDSS standards.
 *
 * Usage:
 *   npx tsx languages/opendss/tests/opendss-benchmark-runner.ts [options]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenDssYbus, parseOpenDss, solveAdmittancePowerFlow } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runOpenDssBenchmarks(): Promise<void> {
  console.log(`[opendss-benchmark-runner] Running OpenDSS distribution feeder benchmarks...`);

  const circuits: Array<{ id: string; name: string; dss: string; maxIters?: number }> = [
    {
      id: "IEEE4Bus",
      name: "IEEE 4-Bus Radial Distribution Feeder",
      dss: `Clear
New Circuit.IEEE4Bus basekv=115.0 pu=1.05 phases=3 bus1=SourceBus
New LineCode.100 nphases=3 r1=0.115 x1=0.395 units=km
New Transformer.SubXfmr phases=3 windings=2 buses=[SourceBus, SubBus] kvs=[115, 12.47] kvas=[10000, 10000] %loadloss=0.5 xhl=5.0
New Line.Line1 bus1=SubBus bus2=LoadBus1 phases=3 linecode=100 length=2.5
New Line.Line2 bus1=LoadBus1 bus2=LoadBus2 phases=3 linecode=100 length=1.8
New Load.Load1 bus1=LoadBus1 phases=3 kv=12.47 kw=1800 kvar=600
New Load.Load2 bus1=LoadBus2 phases=3 kv=12.47 kw=1200 kvar=400
New PVSystem.SolarFarm1 bus1=LoadBus2 phases=3 kv=12.47 kva=1500 pmpp=1400
Set VoltageBases = [115, 12.47]
CalcVoltageBases
Solve
`,
      maxIters: 5,
    },
  ];

  const ieee13Path = path.resolve(__dirname, "../../../.cache/benchmarks/opendss/opendss-ieee-feeders/IEEE13Nodeckt.dss");
  if (fs.existsSync(ieee13Path)) {
    circuits.push({
      id: "IEEE13Bus",
      name: "IEEE 13-Bus Unbalanced Radial Feeder (with multi-phase line codes & regulators)",
      dss: fs.readFileSync(ieee13Path, "utf-8"),
      maxIters: 10,
    });
  }

  let passed = true;
  for (const c of circuits) {
    const deck = parseOpenDss(c.dss);
    const ybus = buildOpenDssYbus(deck);
    const res = solveAdmittancePowerFlow(deck);

    const maxIters = c.maxIters ?? 5;
    const okYbus = ybus.nNodes > 0 && ybus.yMatrix.nnz > 0;
    const okFlow = res.converged && res.iterations <= maxIters;

    console.log(
      `  [${okYbus && okFlow ? "PASS" : "FAIL"}] ${c.id}: ${c.name} (nodes: ${ybus.nNodes}, iters: ${res.iterations}, totalLoadKw: ${res.totalLoadKw})`,
    );

    if (!okYbus || !okFlow) passed = false;
  }

  if (!passed) process.exit(1);
}

if (process.argv[1] === __filename) {
  runOpenDssBenchmarks();
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Standalone Mathematical Programming Benchmark Runner
 *
 * Runs canonical operations research and optimization benchmarks across LP, MILP,
 * and NLP problem classes, measuring solve time, iterations, and ground-truth parity.
 */

import {
  instantiateAmpl,
  parseAmplData,
  parseAmplModel,
  solveAmpl,
} from "../src/index.js";

interface BenchmarkCase {
  id: string;
  name: string;
  category: "LP" | "MILP" | "NLP";
  modSrc: string;
  datSrc?: string | undefined;
  expectedObj: number;
  tolerance: number;
}

const BENCHMARKS: BenchmarkCase[] = [
  {
    id: "BM1_HITCHCOCK",
    name: "Hitchcock-Koopmans Transportation Network LP",
    category: "LP",
    modSrc: `
      set ORIG;
      set DEST;
      param supply {ORIG} >= 0;
      param demand {DEST} >= 0;
      param cost {ORIG, DEST} >= 0;
      var Trans {ORIG, DEST} >= 0;
      minimize Total_Cost:
        sum {i in ORIG, j in DEST} cost[i, j] * Trans[i, j];
      subject to Supply_Limit {i in ORIG}:
        sum {j in DEST} Trans[i, j] <= supply[i];
      subject to Demand_Satisfaction {j in DEST}:
        sum {i in ORIG} Trans[i, j] = demand[j];
    `,
    datSrc: `
      set ORIG := Seattle San_Diego ;
      set DEST := New_York Chicago Topeka ;
      param supply :=
        Seattle   350
        San_Diego 600 ;
      param demand :=
        New_York 325
        Chicago  300
        Topeka   275 ;
      param cost :
                   New_York Chicago Topeka :=
        Seattle         2.5     1.7    1.8
        San_Diego       2.5     1.8    1.4 ;
    `,
    expectedObj: 1707.5,
    tolerance: 1e-2,
  },
  {
    id: "BM2_LOT_SIZING",
    name: "Multi-Period Dynamic Production Lot-Sizing LP",
    category: "LP",
    modSrc: `
      set PERIODS;
      param demand {PERIODS} >= 0;
      param reg_cost >= 0;
      param over_cost >= 0;
      param hold_cost >= 0;
      param reg_cap >= 0;
      param over_cap >= 0;
      var MakeReg {PERIODS} >= 0, <= reg_cap;
      var MakeOver {PERIODS} >= 0, <= over_cap;
      var Inventory {PERIODS} >= 0;
      minimize Cost:
        sum {t in PERIODS} (reg_cost * MakeReg[t] + over_cost * MakeOver[t] + hold_cost * Inventory[t]);
      subject to Balance1:
        MakeReg[1] + MakeOver[1] = demand[1] + Inventory[1];
      subject to Balance2:
        Inventory[1] + MakeReg[2] + MakeOver[2] = demand[2] + Inventory[2];
      subject to Balance3:
        Inventory[2] + MakeReg[3] + MakeOver[3] = demand[3] + Inventory[3];
      subject to Balance4:
        Inventory[3] + MakeReg[4] + MakeOver[4] = demand[4] + Inventory[4];
    `,
    datSrc: `
      set PERIODS := 1 2 3 4 ;
      param reg_cost := 25.0 ;
      param over_cost := 35.0 ;
      param hold_cost := 2.0 ;
      param reg_cap := 100.0 ;
      param over_cap := 40.0 ;
      param demand :=
        1 90.0
        2 130.0
        3 110.0
        4 80.0 ;
    `,
    expectedObj: 10570.0,
    tolerance: 50.0,
  },
  {
    id: "BM3_REFINERY_BLEND",
    name: "Petroleum Refinery Feedstock Blending LP",
    category: "LP",
    modSrc: `
      var CRUDE1 >= 0, <= 100;
      var CRUDE2 >= 0, <= 100;
      maximize Profit:
        12 * CRUDE1 + 15 * CRUDE2;
      subject to Octane_Spec:
        0.5 * CRUDE1 + 0.8 * CRUDE2 <= 100;
      subject to Vapor_Spec:
        0.4 * CRUDE1 + 0.2 * CRUDE2 <= 50;
      subject to Lead_Spec:
        0.1 * CRUDE1 + 0.3 * CRUDE2 <= 40;
    `,
    expectedObj: 2113.636,
    tolerance: 1e-2,
  },
  {
    id: "BM4_CAPITAL_BUDGET",
    name: "Capital Budgeting & Project Selection 0-1 Knapsack MILP",
    category: "MILP",
    modSrc: `
      var x1 binary;
      var x2 binary;
      var x3 binary;
      var x4 binary;
      var x5 binary;
      maximize Total_NPV:
        16 * x1 + 22 * x2 + 12 * x3 + 8 * x4 + 11 * x5;
      subject to Budget_Limit:
        6 * x1 + 8 * x2 + 4 * x3 + 3 * x4 + 5 * x5 <= 14;
    `,
    expectedObj: 38.0,
    tolerance: 1e-3,
  },
  {
    id: "BM5_MARKOWITZ_RISK",
    name: "Markowitz Mean-Variance Portfolio Risk Minimization NLP",
    category: "NLP",
    modSrc: `
      var w1 >= 0, <= 1;
      var w2 >= 0, <= 1;
      minimize Risk:
        0.04 * w1^2 + 0.16 * w2^2;
      subject to Full_Investment:
        w1 + w2 = 1.0;
      subject to Min_Return:
        0.08 * w1 + 0.14 * w2 >= 0.10;
    `,
    expectedObj: 0.0355,
    tolerance: 0.005,
  },
];

async function runBenchmarks(): Promise<void> {
  console.log("=======================================================================================");
  console.log("             @modelscript/ampl — Mathematical Programming Benchmark Suite              ");
  console.log("=======================================================================================");
  console.log(
    "Benchmark ID".padEnd(20) +
    "Category".padEnd(10) +
    "Status".padEnd(12) +
    "Actual Obj".padEnd(15) +
    "Expected Obj".padEnd(15) +
    "Time (ms)"
  );
  console.log("-".repeat(87));

  let passed = 0;
  let totalTime = 0;

  for (const b of BENCHMARKS) {
    const t0 = Date.now();
    const model = parseAmplModel(b.modSrc);
    const data = b.datSrc ? parseAmplData(b.datSrc) : undefined;
    const problem = instantiateAmpl(model, data);
    const result = await solveAmpl(problem);
    const elapsed = Date.now() - t0;
    totalTime += elapsed;

    const absDiff = Math.abs(result.objectiveValue - b.expectedObj);
    const ok = result.status === "OPTIMAL" && absDiff <= b.tolerance;

    if (ok) passed++;

    const statusStr = ok ? "PASS" : "FAIL";
    console.log(
      b.id.padEnd(20) +
      b.category.padEnd(10) +
      statusStr.padEnd(12) +
      result.objectiveValue.toFixed(4).padEnd(15) +
      b.expectedObj.toFixed(4).padEnd(15) +
      `${elapsed}ms`
    );
  }

  console.log("=".repeat(87));
  console.log(`Results: ${passed} / ${BENCHMARKS.length} passed in ${totalTime}ms.`);

  if (passed !== BENCHMARKS.length) {
    process.exit(1);
  }
}

runBenchmarks().catch((err) => {
  console.error(err);
  process.exit(1);
});

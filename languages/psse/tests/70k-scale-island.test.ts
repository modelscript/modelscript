// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  balanceIslandActivePower,
  BusType,
  detectElectricalIslands,
  parseRaw,
  screenContingencies,
  solveMultiIslandPowerFlow,
  type BranchRecord,
  type BusRecord,
  type GeneratorRecord,
  type LoadRecord,
  type PsseCase,
} from "../src/index.js";

// Minimal IEEE 14-bus base case RAW representation
const IEEE14_RAW = `0, 100.00, 33, 0, 1, 60.00 / PSS/E IEEE 14-Bus Test Case
CASE TITLE LINE 1
CASE TITLE LINE 2
    1, 'BUS 1       ', 138.000, 3, 1, 1, 1, 1.060,   0.000, 1.100, 0.900, 1.100, 0.900
    2, 'BUS 2       ', 138.000, 2, 1, 1, 1, 1.045,  -4.980, 1.100, 0.900, 1.100, 0.900
    3, 'BUS 3       ', 138.000, 2, 1, 1, 1, 1.010, -12.720, 1.100, 0.900, 1.100, 0.900
    4, 'BUS 4       ', 138.000, 1, 1, 1, 1, 1.019, -10.330, 1.100, 0.900, 1.100, 0.900
    5, 'BUS 5       ', 138.000, 1, 1, 1, 1, 1.020,  -8.780, 1.100, 0.900, 1.100, 0.900
    6, 'BUS 6       ',  13.800, 2, 1, 1, 1, 1.070, -14.220, 1.100, 0.900, 1.100, 0.900
    7, 'BUS 7       ',  13.800, 1, 1, 1, 1, 1.062, -13.370, 1.100, 0.900, 1.100, 0.900
    8, 'BUS 8       ',  13.800, 2, 1, 1, 1, 1.090, -13.360, 1.100, 0.900, 1.100, 0.900
    9, 'BUS 9       ',  13.800, 1, 1, 1, 1, 1.056, -14.940, 1.100, 0.900, 1.100, 0.900
   10, 'BUS 10      ',  13.800, 1, 1, 1, 1, 1.051, -15.100, 1.100, 0.900, 1.100, 0.900
   11, 'BUS 11      ',  13.800, 1, 1, 1, 1, 1.057, -14.790, 1.100, 0.900, 1.100, 0.900
   12, 'BUS 12      ',  13.800, 1, 1, 1, 1, 1.055, -15.070, 1.100, 0.900, 1.100, 0.900
   13, 'BUS 13      ',  13.800, 1, 1, 1, 1, 1.050, -15.160, 1.100, 0.900, 1.100, 0.900
   14, 'BUS 14      ',  13.800, 1, 1, 1, 1, 1.035, -16.040, 1.100, 0.900, 1.100, 0.900
0 / END OF BUS DATA
    2, '1 ', 1, 1, 1,  21.70,  12.70,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
    3, '1 ', 1, 1, 1,  94.20,  19.00,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
    4, '1 ', 1, 1, 1,  47.80,  -3.90,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
    5, '1 ', 1, 1, 1,   7.60,   1.60,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
    6, '1 ', 1, 1, 1,  11.20,   7.50,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
    9, '1 ', 1, 1, 1,  29.50,  16.60,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
   10, '1 ', 1, 1, 1,   9.00,   5.80,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
   11, '1 ', 1, 1, 1,   3.50,   1.80,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
   12, '1 ', 1, 1, 1,   6.10,   1.60,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
   13, '1 ', 1, 1, 1,  13.50,   5.80,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
   14, '1 ', 1, 1, 1,  14.90,   5.00,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
0 / END OF LOAD DATA
    9, '1 ', 1, 0.00, 0.19 / Shunt
0 / END OF FIXED SHUNT DATA
    1, '1 ', 232.40,   0.00,  10.00, -10.00, 1.060, 0, 100.00, 0.00, 0.05, 0.00, 0.00, 1.00, 1, 100.0, 332.4, 0.0, 1, 1.0
    2, '1 ',  40.00,  42.40,  50.00, -40.00, 1.045, 0, 100.00, 0.00, 0.05, 0.00, 0.00, 1.00, 1, 100.0, 140.0, 0.0, 1, 1.0
    3, '1 ',   0.00,  23.40,  40.00,   0.00, 1.010, 0, 100.00, 0.00, 0.05, 0.00, 0.00, 1.00, 1, 100.0, 100.0, 0.0, 1, 1.0
    6, '1 ',   0.00,  12.20,  24.00,  -6.00, 1.070, 0, 100.00, 0.00, 0.05, 0.00, 0.00, 1.00, 1, 100.0, 100.0, 0.0, 1, 1.0
    8, '1 ',   0.00,  17.40,  24.00,  -6.00, 1.090, 0, 100.00, 0.00, 0.05, 0.00, 0.00, 1.00, 1, 100.0, 100.0, 0.0, 1, 1.0
0 / END OF GENERATOR DATA
    1,     2, '1 ', 0.01938, 0.05917, 0.0528, 120.0, 120.0, 120.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    1,     5, '1 ', 0.05403, 0.22304, 0.0492,  65.0,  65.0,  65.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    2,     3, '1 ', 0.04699, 0.19797, 0.0438,  36.0,  36.0,  36.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    2,     4, '1 ', 0.05811, 0.17632, 0.0340,  65.0,  65.0,  65.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    2,     5, '1 ', 0.05695, 0.17388, 0.0346,  50.0,  50.0,  50.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    3,     4, '1 ', 0.06701, 0.17103, 0.0128,  50.0,  50.0,  50.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    4,     5, '1 ', 0.01335, 0.04211, 0.0000,  70.0,  70.0,  70.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    6,    11, '1 ', 0.09498, 0.19890, 0.0000,  25.0,  25.0,  25.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    6,    12, '1 ', 0.12291, 0.25581, 0.0000,  25.0,  25.0,  25.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    6,    13, '1 ', 0.06615, 0.13027, 0.0000,  25.0,  25.0,  25.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    7,     8, '1 ', 0.00000, 0.17615, 0.0000,  40.0,  40.0,  40.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    7,     9, '1 ', 0.00000, 0.11001, 0.0000,  40.0,  40.0,  40.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    9,    10, '1 ', 0.03181, 0.08450, 0.0000,  25.0,  25.0,  25.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    9,    14, '1 ', 0.12711, 0.27038, 0.0000,  25.0,  25.0,  25.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
   10,    11, '1 ', 0.08205, 0.19207, 0.0000,  25.0,  25.0,  25.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
   12,    13, '1 ', 0.22092, 0.19988, 0.0000,  25.0,  25.0,  25.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
   13,    14, '1 ', 0.17093, 0.34802, 0.0000,  25.0,  25.0,  25.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
0 / END OF BRANCH DATA
    4,     7, 0, '1 ', 1, 1, 1, 0.0, 0.0, 2, 'XFR 4-7     ', 1, 1, 1.0, 0.0, 0.20912, 100.0, 0.978, 0.0, 0.0, 40.0, 40.0, 40.0, 0, 0, 1.1, 0.9, 1.1, 0.9, 33, 0, 0.0, 0.0, 0.0, 1.0, 0.0
    4,     9, 0, '1 ', 1, 1, 1, 0.0, 0.0, 2, 'XFR 4-9     ', 1, 1, 1.0, 0.0, 0.55618, 100.0, 0.969, 0.0, 0.0, 40.0, 40.0, 40.0, 0, 0, 1.1, 0.9, 1.1, 0.9, 33, 0, 0.0, 0.0, 0.0, 1.0, 0.0
    5,     6, 0, '1 ', 1, 1, 1, 0.0, 0.0, 2, 'XFR 5-6     ', 1, 1, 1.0, 0.0, 0.25202, 100.0, 0.932, 0.0, 0.0, 40.0, 40.0, 40.0, 0, 0, 1.1, 0.9, 1.1, 0.9, 33, 0, 0.0, 0.0, 0.0, 1.0, 0.0
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
Q
`;

test("Multi-Island Topological Detection & Auto-Slack Election on Network Splitting", () => {
  const pCase = parseRaw(IEEE14_RAW);

  // 1. Initial intact network: single island with 14 buses
  const initialIslands = detectElectricalIslands(pCase);
  assert.strictEqual(initialIslands.length, 1);
  assert.strictEqual(initialIslands[0]!.busNumbers.size, 14);
  assert.strictEqual(initialIslands[0]!.slackBusNumber, 1);
  assert.strictEqual(initialIslands[0]!.isDead, false);

  // 2. Severe cascading outage: disconnect ties between HV 138kV grid (Buses 1-5) and LV 13.8kV grid (Buses 6-14)
  // Transformers 4-7, 4-9, and 5-6 connect the two sub-grids.
  const trippedSet = new Set(["4_7_1", "4_9_1", "5_6_1"]);
  const filter = (br: any) => {
    const k = `${br.i}_${br.j}_${br.ckt.trim()}`;
    return !trippedSet.has(k);
  };

  const splitIslands = detectElectricalIslands(pCase, filter);
  console.log(`Detected ${splitIslands.length} electrical islands after transmission cut:`);
  for (const is of splitIslands) {
    console.log(
      `  Island ${is.id}: ${is.busNumbers.size} buses, slack bus ${is.slackBusNumber}, Gen: ${is.totalGenMw} MW, Load: ${is.totalLoadMw} MW`,
    );
  }

  assert.strictEqual(splitIslands.length, 2);
  // Island 1 (HV grid, 5 buses: 1, 2, 3, 4, 5)
  assert.ok(splitIslands.some((is) => is.busNumbers.size === 5 && is.slackBusNumber === 1));
  // Island 2 (LV grid, 9 buses: 6, 7, 8, 9, 10, 11, 12, 13, 14)
  const lvIsland = splitIslands.find((is) => is.busNumbers.size === 9);
  assert.ok(lvIsland !== undefined);
  // In the LV grid, there was NO original swing bus (only PV generators at Bus 6 and 8).
  // The auto-slack election should automatically designate Bus 6 or Bus 8 as the island swing bus!
  assert.ok(lvIsland.slackBusNumber === 6 || lvIsland.slackBusNumber === 8);
  assert.strictEqual(lvIsland.isDead, false);

  // 3. Test active power balancing (UFLS) on the separated LV island
  balanceIslandActivePower(lvIsland, pCase);
  assert.ok(lvIsland.totalLoadMw <= lvIsland.totalGenCapacityMw);

  // 4. Solve Multi-Island AC Power Flow
  const multiSol = solveMultiIslandPowerFlow(pCase, {
    activeBranchFilter: filter,
    autoBalanceIslands: true,
  });

  assert.strictEqual(multiSol.totalIslands, 2);
  assert.strictEqual(multiSol.activeIslands, 2);
  assert.strictEqual(multiSol.deadIslands, 0);
  assert.ok(multiSol.converged, "Both independent electrical islands must converge in AC power flow");

  // Verify bus results exist for all 14 buses
  assert.strictEqual(multiSol.buses.length, 14);
  for (const b of multiSol.buses) {
    assert.ok(b.vm > 0.85 && b.vm < 1.15, `Bus ${b.busNumber} voltage ${b.vm} p.u. must remain in normal bounds`);
  }
});

test("N-1-1 and N-2 Parallel Contingency Screener & Severity Ranking", () => {
  const pCase = parseRaw(IEEE14_RAW);

  // Define candidate N-1-1 / N-2 contingency pairs
  const candidates = [
    {
      id: "CTG_N2_TIES",
      name: "Simultaneous trip of transformers 4-7 and 5-6",
      events: [
        { type: "trip_branch" as const, fromBus: 4, toBus: 7, ckt: "1" },
        { type: "trip_branch" as const, fromBus: 5, toBus: 6, ckt: "1" },
      ],
    },
    {
      id: "CTG_N11_CRITICAL",
      name: "Trip line 1-2 followed by line 1-5 (loss of main swing export)",
      events: [
        { type: "trip_branch" as const, fromBus: 1, toBus: 2, ckt: "1" },
        { type: "trip_branch" as const, fromBus: 1, toBus: 5, ckt: "1" },
      ],
    },
    {
      id: "CTG_N1_LOCAL",
      name: "Single trip of local distribution branch 12-13",
      events: [{ type: "trip_branch" as const, fromBus: 12, toBus: 13, ckt: "1" }],
    },
    {
      id: "CTG_N2_ISLANDING",
      name: "Simultaneous loss of all 3 HV-LV interties (causes islanding)",
      events: [
        { type: "trip_branch" as const, fromBus: 4, toBus: 7, ckt: "1" },
        { type: "trip_branch" as const, fromBus: 4, toBus: 9, ckt: "1" },
        { type: "trip_branch" as const, fromBus: 5, toBus: 6, ckt: "1" },
      ],
    },
  ];

  const report = screenContingencies(pCase, candidates, {
    topKAcConfirmation: 4,
    overloadThresholdPercent: 80.0,
  });

  console.log(
    `Contingency Screening Report: Evaluated ${report.totalEvaluated}, Critical ${report.criticalCount}, Islanding ${report.islandingCount}`,
  );
  for (const c of report.rankedContingencies) {
    console.log(
      `  [Ranked #${c.id}] SI: ${c.severityIndex}, Islanding: ${c.causesIslanding}, Max Load: ${c.maxBranchLoadingPercent}%, AC Converged: ${c.acConverged}`,
    );
  }

  assert.strictEqual(report.totalEvaluated, 4);
  assert.ok(report.islandingCount >= 1, "Must detect islanding contingency CTG_N2_ISLANDING");

  // The islanding contingency or swing isolation must rank at top severity
  const topRanked = report.rankedContingencies[0]!;
  assert.ok(
    topRanked.id === "CTG_N2_ISLANDING" || topRanked.id === "CTG_N11_CRITICAL",
    `Top severe contingency was ${topRanked.id}`,
  );
  assert.ok(topRanked.severityIndex > 1000.0);
});

test("Synthetic 70,000+ Bus MMWG Eastern Interconnection Scale Benchmark", () => {
  console.log("Generating synthetic 70,000-bus Eastern Interconnection multi-area model...");
  const t0 = Date.now();

  const numAreas = 70;
  const busesPerArea = 1000;
  const totalBuses = numAreas * busesPerArea; // 70,000 buses

  const buses = new Map<number, BusRecord>();
  const branches: BranchRecord[] = [];
  const generators: GeneratorRecord[] = [];
  const loads: LoadRecord[] = [];

  let nextBrId = 1;

  for (let a = 1; a <= numAreas; a++) {
    const areaBase = (a - 1) * busesPerArea + 1;
    const hubBus = areaBase; // 500 kV hub bus

    // Area 500 kV Backbone
    buses.set(hubBus, {
      i: hubBus,
      name: `AREA_${a}_HUB`,
      baseKv: 500.0,
      ide: a === 1 ? BusType.Swing : BusType.PV,
      area: a,
      zone: 1,
      owner: 1,
      vm: 1.02,
      va: 0.0,
    });

    // Area generator at 500 kV hub
    generators.push({
      i: hubBus,
      id: "G1",
      pg: 850.0,
      qg: 120.0,
      qt: 450.0,
      qb: -200.0,
      vs: 1.02,
      ireg: hubBus,
      mbase: 1000.0,
      zr: 0.0,
      zx: 0.15,
      rt: 0.0,
      xt: 0.0,
      gtap: 1.0,
      stat: 1,
      rmpct: 100.0,
      pt: 1000.0,
      pb: 100.0,
    });

    // Sub-transmission 230 kV and 115 kV local buses
    for (let b = 1; b < busesPerArea; b++) {
      const bNum = areaBase + b;
      const isSubTransmission = b < 100;
      const baseKv = isSubTransmission ? 230.0 : 115.0;

      buses.set(bNum, {
        i: bNum,
        name: `B_${bNum}`,
        baseKv,
        ide: BusType.PQ,
        area: a,
        zone: 1,
        owner: 1,
        vm: 1.0,
        va: 0.0,
      });

      // Connect to parent bus inside area
      const parentBus = b < 10 ? hubBus : areaBase + Math.floor(b / 2);
      branches.push({
        i: parentBus,
        j: bNum,
        ckt: "1",
        r: 0.002,
        x: 0.025,
        b: 0.005,
        rateA: 350.0,
        rateB: 400.0,
        rateC: 450.0,
        gi: 0,
        bi: 0,
        gj: 0,
        bj: 0,
        st: 1,
        met: 1,
        len: 15.0,
      });

      // Distributed load on 115 kV buses
      if (!isSubTransmission && b % 3 === 0) {
        loads.push({
          i: bNum,
          id: "1",
          status: 1,
          area: a,
          zone: 1,
          pl: 2.8,
          ql: 0.8,
          ip: 0,
          iq: 0,
          yp: 0,
          yq: 0,
          owner: 1,
          scale: 1,
          intrct: 1,
        });
      }
    }

    // Inter-area 500 kV tie lines linking area hubs into an interconnected bulk grid
    if (a < numAreas) {
      const nextHub = a * busesPerArea + 1;
      branches.push({
        i: hubBus,
        j: nextHub,
        ckt: "1",
        r: 0.001,
        x: 0.015,
        b: 0.02,
        rateA: 2000.0,
        rateB: 2400.0,
        rateC: 2600.0,
        gi: 0,
        bi: 0,
        gj: 0,
        bj: 0,
        st: 1,
        met: 1,
        len: 120.0,
      });
    }
  }

  // Ring tie between Area 70 and Area 1
  branches.push({
    i: (numAreas - 1) * busesPerArea + 1,
    j: 1,
    ckt: "1",
    r: 0.001,
    x: 0.015,
    b: 0.02,
    rateA: 2000.0,
    rateB: 2400.0,
    rateC: 2600.0,
    gi: 0,
    bi: 0,
    gj: 0,
    bj: 0,
    st: 1,
    met: 1,
    len: 120.0,
  });

  const genTimeMs = Date.now() - t0;
  console.log(`   Generated ${buses.size} buses, ${branches.length} branches in ${genTimeMs} ms.`);

  assert.strictEqual(buses.size, 70000);
  assert.ok(branches.length >= 70000);

  const mockCase: PsseCase = {
    header: { ic: 0, sbase: 100.0, rev: 33, xfrrat: 0, nxfrat: 0, basfrq: 60.0 },
    title1: "70,000-Bus MMWG Eastern Interconnection Synthetic Grid",
    title2: "Commercial Parity Scale Benchmark",
    buses,
    loads,
    fixedShunts: [],
    generators,
    branches,
    transformers: [],
    areas: [],
    twoTerminalDc: [],
    vscDc: [],
    switchedShunts: [],
  };

  // 1. Initial 70,000-bus topological detection
  const tDsu0 = Date.now();
  const intactIslands = detectElectricalIslands(mockCase);
  const dsuTimeMs = Date.now() - tDsu0;
  console.log(`   Disjoint Set Union detection on 70,000 buses: ${dsuTimeMs} ms.`);

  assert.strictEqual(intactIslands.length, 1);
  assert.strictEqual(intactIslands[0]!.busNumbers.size, 70000);
  assert.ok(dsuTimeMs < 500, `70,000-bus DSU must complete in < 500ms, took ${dsuTimeMs}ms`);

  // 2. Cut Eastern Interconnection into 2 major partitions:
  // Disconnect tie between Area 35 and Area 36, and between Area 70 and Area 1
  const cutFilter = (br: any) => {
    // Inter-area tie between Area 35 and Area 36: hub 34001 to 35001
    const tie1 = (br.i === 34001 && br.j === 35001) || (br.i === 35001 && br.j === 34001);
    // Inter-area ring tie between Area 70 and Area 1: hub 69001 to 1
    const tie2 = (br.i === 69001 && br.j === 1) || (br.i === 1 && br.j === 69001);
    return !tie1 && !tie2;
  };

  const tSplit0 = Date.now();
  const splitIslands = detectElectricalIslands(mockCase, cutFilter);
  const splitTimeMs = Date.now() - tSplit0;
  console.log(`   Multi-Island topological cut on 70,000 buses: ${splitTimeMs} ms.`);

  assert.strictEqual(splitIslands.length, 2);
  console.log(`   Island 1: ${splitIslands[0]!.busNumbers.size} buses, slack bus: ${splitIslands[0]!.slackBusNumber}`);
  console.log(`   Island 2: ${splitIslands[1]!.busNumbers.size} buses, slack bus: ${splitIslands[1]!.slackBusNumber}`);

  assert.strictEqual(splitIslands[0]!.busNumbers.size, 35000);
  assert.strictEqual(splitIslands[1]!.busNumbers.size, 35000);
  assert.ok(splitIslands[0]!.slackBusNumber !== undefined);
  assert.ok(splitIslands[1]!.slackBusNumber !== undefined);
  assert.notStrictEqual(splitIslands[0]!.slackBusNumber, splitIslands[1]!.slackBusNumber);
  assert.ok(splitTimeMs < 500, `70,000-bus island partitioning must take < 500ms, took ${splitTimeMs}ms`);
});

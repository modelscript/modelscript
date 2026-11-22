// SPDX-License-Identifier: AGPL-3.0-or-later

import { runHybridPhasorEmtCoSimulation } from "@modelscript/exchange";
import { parseDyr, parseRaw, parseSeq, PssePhasorParticipant } from "@modelscript/psse";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extractEmtNetlist, parsePscx, PscadEmtParticipant } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PSSE_SUITE = path.resolve(__dirname, "../../psse/testsuite");
const PSCAD_FIXTURES = path.resolve(__dirname, "./fixtures");

function loadRealPscadNetlist() {
  const pscxXml = fs.readFileSync(path.join(PSCAD_FIXTURES, "IEEE9Bus_IBR_v2.pscx"), "utf-8");
  const project = parsePscx(pscxXml);
  return extractEmtNetlist(project);
}

test("Real-World Benchmark 1: WSCC IEEE 9-Bus (.raw + .dyr) <-> Real IEEE9Bus_IBR_v2.pscx (3-seq SLG fault + FDNE + FMI 3.0 parity)", async () => {
  const psseCase = parseRaw(fs.readFileSync(path.join(PSSE_SUITE, "ieee9.raw"), "utf-8"));
  const dyrCase = parseDyr(fs.readFileSync(path.join(PSSE_SUITE, "ieee9.dyr"), "utf-8"));
  const emtNetlist = loadRealPscadNetlist();

  assert.equal(psseCase.buses.size, 9);
  assert.ok(emtNetlist.buses.has("B3"), "Expected 230 kV bus B3 in parsed IEEE9Bus_IBR_v2.pscx");

  const runMode = async (mode: "direct" | "fmi") =>
    runHybridPhasorEmtCoSimulation(
      new PssePhasorParticipant(psseCase, { id: `IEEE9_${mode}`, dyrCase }),
      [
        {
          id: "PSCAD_IBR_Plant",
          participant: new PscadEmtParticipant(emtNetlist, { id: `PSCAD_IBR_${mode}` }),
          boundaryPorts: [{ phasorBusId: "5", emtBusId: "B3", baseKvLL: 230.0 }],
        },
      ],
      {
        durationSec: 0.05,
        dtTsSec: 0.005,
        dtEmtSec: 50e-6,
        mode,
        sequences: 3,
        useDynamicEquivalent: true,
        useFdne: true,
        fault: {
          busId: "7",
          startSec: 0.015,
          clearSec: 0.035,
          susceptancePu: -15.0,
          faultType: "slg",
        },
      },
    );

  const directRes = await runMode("direct");
  const fmiRes = await runMode("fmi");

  assert.equal(directRes.phasorTrajectory.summary.convergedPowerFlow, true);
  assert.equal(directRes.totalMacroSteps, 10);
  assert.equal(directRes.totalEmtSubSteps, 1000);
  assert.equal(directRes.topologyUpdates, 2);

  const preFault = directRes.macroRecords[1]!; // t = 0.010 s
  const duringFault = directRes.macroRecords[4]!; // t = 0.025 s
  const postFault = directRes.macroRecords[9]!; // t = 0.050 s

  assert.ok(
    Number.isFinite(preFault.vTsMagPu) && preFault.vTsMagPu > 0.8 && preFault.vTsMagPu < 1.2,
    `IEEE 9-Bus pre-fault V out of bounds: ${preFault.vTsMagPu}`,
  );
  assert.ok(
    duringFault.vTsMagPu < preFault.vTsMagPu - 0.02,
    `Expected IEEE 9-Bus voltage dip during Bus 7 SLG fault: ${duringFault.vTsMagPu} vs ${preFault.vTsMagPu}`,
  );
  assert.ok(duringFault.vNegMagPu > 0.005, `Expected non-zero V2 during SLG fault, got ${duringFault.vNegMagPu}`);
  assert.ok(duringFault.vZeroMagPu > 0.005, `Expected non-zero V0 during SLG fault, got ${duringFault.vZeroMagPu}`);
  assert.ok(
    postFault.vTsMagPu > duringFault.vTsMagPu,
    `Expected post-fault voltage recovery: ${postFault.vTsMagPu} vs ${duringFault.vTsMagPu}`,
  );

  // Direct vs FMI 3.0 parity across every macro-step
  for (let i = 0; i < directRes.macroRecords.length; i++) {
    assert.ok(
      Math.abs(directRes.macroRecords[i]!.vTsMagPu - fmiRes.macroRecords[i]!.vTsMagPu) < 1e-4,
      `IEEE 9-Bus direct vs FMI mismatch at step ${i}`,
    );
  }
});

test("Real-World Benchmark 2: Kundur 2-Area 11-Bus (.raw + .dyr) <-> Real IEEE9Bus_IBR_v2.pscx (3ph fault + Picard rollback)", async () => {
  const psseCase = parseRaw(fs.readFileSync(path.join(PSSE_SUITE, "kundur2area.raw"), "utf-8"));
  const dyrCase = parseDyr(fs.readFileSync(path.join(PSSE_SUITE, "kundur2area.dyr"), "utf-8"));
  const emtNetlist = loadRealPscadNetlist();

  assert.equal(psseCase.buses.size, 11);

  const res = await runHybridPhasorEmtCoSimulation(
    new PssePhasorParticipant(psseCase, { id: "Kundur_2Area", dyrCase }),
    [
      {
        id: "PSCAD_TieMidpoint_IBR",
        participant: new PscadEmtParticipant(emtNetlist, { id: "PSCAD_TieMidpoint" }),
        boundaryPorts: [{ phasorBusId: "8", emtBusId: "B3", baseKvLL: 230.0 }],
      },
    ],
    {
      durationSec: 0.04,
      dtTsSec: 0.005,
      dtEmtSec: 50e-6,
      mode: "direct",
      sequences: 1,
      useDynamicEquivalent: true,
      useFdne: true,
      maxIterations: 2,
      iterationTolerancePu: 1e-6,
      fault: {
        busId: "7",
        startSec: 0.01,
        clearSec: 0.025,
        susceptancePu: -15.0,
        faultType: "3ph",
      },
    },
  );

  assert.equal(res.phasorTrajectory.summary.convergedPowerFlow, true);
  assert.equal(res.totalMacroSteps, 8);
  assert.ok(res.totalPicardIterations > res.totalMacroSteps, "Expected Picard rollback iterations > totalMacroSteps");
  assert.equal(res.topologyUpdates, 2);

  const pre = res.macroRecords[0]!;
  const fault = res.macroRecords[3]!;
  const post = res.macroRecords[7]!;
  assert.ok(Number.isFinite(pre.vTsMagPu) && pre.vTsMagPu > 0.7 && pre.vTsMagPu < 1.25);
  assert.ok(fault.vTsMagPu < pre.vTsMagPu - 0.05, `Expected Kundur fault dip: ${fault.vTsMagPu} vs ${pre.vTsMagPu}`);
  assert.ok(
    post.vTsMagPu > fault.vTsMagPu,
    `Expected Kundur post-fault recovery: ${post.vTsMagPu} vs ${fault.vTsMagPu}`,
  );
});

test("Real-World Benchmark 3: IEEE 118-Bus (.raw + .dyr + .seq) <-> Real IEEE9Bus_IBR_v2.pscx (sparse Kron + exact .seq SLG fault + FDNE)", async () => {
  const psseCase = parseRaw(fs.readFileSync(path.join(PSSE_SUITE, "ieee118.raw"), "utf-8"));
  const dyrCase = parseDyr(fs.readFileSync(path.join(PSSE_SUITE, "ieee118.dyr"), "utf-8"));
  const seqCase = parseSeq(fs.readFileSync(path.join(PSSE_SUITE, "ieee118.seq"), "utf-8"));
  const emtNetlist = loadRealPscadNetlist();

  assert.equal(psseCase.buses.size, 118);

  const res = await runHybridPhasorEmtCoSimulation(
    new PssePhasorParticipant(psseCase, { id: "IEEE118_BulkGrid", dyrCase, seqCase }),
    [
      {
        id: "PSCAD_Bus15_IBR",
        participant: new PscadEmtParticipant(emtNetlist, { id: "PSCAD_Bus15" }),
        boundaryPorts: [{ phasorBusId: "15", emtBusId: "B3" }],
      },
    ],
    {
      durationSec: 0.04,
      dtTsSec: 0.005,
      dtEmtSec: 50e-6,
      mode: "direct",
      sequences: 3,
      useDynamicEquivalent: true,
      useFdne: true,
      fault: {
        busId: "17",
        startSec: 0.01,
        clearSec: 0.025,
        susceptancePu: -20.0,
        faultType: "slg",
      },
    },
  );

  assert.equal(res.phasorTrajectory.summary.convergedPowerFlow, true);
  assert.equal(res.totalMacroSteps, 8);
  assert.equal(res.topologyUpdates, 2);

  const pre = res.macroRecords[0]!;
  const fault = res.macroRecords[3]!;
  const post = res.macroRecords[7]!;
  assert.ok(
    Number.isFinite(pre.vTsMagPu) && pre.vTsMagPu > 0.8 && pre.vTsMagPu < 1.2,
    `IEEE 118 pre-fault V: ${pre.vTsMagPu}`,
  );
  assert.ok(fault.vTsMagPu < pre.vTsMagPu - 0.02, `Expected IEEE 118 fault dip: ${fault.vTsMagPu} vs ${pre.vTsMagPu}`);
  assert.ok(fault.vNegMagPu > 0.002, `Expected non-zero V2 on IEEE 118 SLG fault, got ${fault.vNegMagPu}`);
  assert.ok(fault.vZeroMagPu > 0.002, `Expected non-zero V0 on IEEE 118 SLG fault, got ${fault.vZeroMagPu}`);
  assert.ok(
    post.vTsMagPu > fault.vTsMagPu,
    `Expected IEEE 118 post-fault recovery: ${post.vTsMagPu} vs ${fault.vTsMagPu}`,
  );
  assert.ok(res.wallClockTimeMs < 15000, `Expected IEEE 118 hybrid co-sim < 15s, took ${res.wallClockTimeMs} ms`);
});

test("Real-World Large-Scale Benchmark 4: 590-Bus Multi-Area Grid (5x IEEE 118-Bus .raw/.dyr/.seq) <-> 4 Concurrent Real PSCAD .pscx Worker Plants (0.20s, 16,000 EMT sub-steps)", async () => {
  const { WorkerEmtParticipant } = await import("@modelscript/exchange");
  const baseRaw = parseRaw(fs.readFileSync(path.join(PSSE_SUITE, "ieee118.raw"), "utf-8"));
  const baseDyr = parseDyr(fs.readFileSync(path.join(PSSE_SUITE, "ieee118.dyr"), "utf-8"));
  const baseSeq = parseSeq(fs.readFileSync(path.join(PSSE_SUITE, "ieee118.seq"), "utf-8"));
  const emtNetlist = loadRealPscadNetlist();

  // Tile 5 interconnected copies of IEEE 118-Bus -> 590 buses, 270 generators, ~950 branches
  const nAreas = 5;
  const busStride = 200;
  const superCase = {
    ...baseRaw,
    buses: new Map(baseRaw.buses),
    loads: baseRaw.loads.map((l) => ({ ...l })),
    fixedShunts: baseRaw.fixedShunts.map((s) => ({ ...s })),
    generators: baseRaw.generators.map((g) => ({ ...g })),
    branches: baseRaw.branches.map((b) => ({ ...b })),
    transformers: baseRaw.transformers.map((t) => ({ ...t })),
    switchedShunts: baseRaw.switchedShunts.map((s) => ({ ...s })),
  };
  const superDyr = { ...baseDyr, records: baseDyr.records.map((r) => ({ ...r, con: [...r.con] })) };
  const superSeq = {
    generators: baseSeq.generators.map((g) => ({ ...g })),
    branches: baseSeq.branches.map((b) => ({ ...b })),
    mutuals: baseSeq.mutuals.map((m) => ({ ...m })),
    transformers: baseSeq.transformers.map((t) => ({ ...t })),
    shunts: baseSeq.shunts.map((s) => ({ ...s })),
  };

  for (let area = 1; area < nAreas; area++) {
    const off = area * busStride;
    for (const [bNum, bus] of baseRaw.buses) {
      // Keep only Area 0's slack bus as type 3; convert replicated slack buses to PV (type 2)
      superCase.buses.set(bNum + off, {
        ...bus,
        i: bNum + off,
        name: `A${area}_${bus.name}`.slice(0, 12),
        ide: bus.ide === 3 ? 2 : bus.ide,
        area: area + 1,
      });
    }
    for (const l of baseRaw.loads) superCase.loads.push({ ...l, i: l.i + off, area: area + 1 });
    for (const s of baseRaw.fixedShunts) superCase.fixedShunts.push({ ...s, i: s.i + off });
    for (const g of baseRaw.generators) superCase.generators.push({ ...g, i: g.i + off });
    for (const b of baseRaw.branches) superCase.branches.push({ ...b, i: b.i + off, j: b.j + off });
    for (const t of baseRaw.transformers) {
      superCase.transformers.push({ ...t, i: t.i + off, j: t.j + off, k: t.k > 0 ? t.k + off : 0 });
    }
    for (const s of baseRaw.switchedShunts) superCase.switchedShunts.push({ ...s, i: s.i + off });

    for (const r of baseDyr.records) superDyr.records.push({ ...r, ibus: r.ibus + off, con: [...r.con] });
    for (const g of baseSeq.generators) superSeq.generators.push({ ...g, i: g.i + off });
    for (const b of baseSeq.branches) superSeq.branches.push({ ...b, i: b.i + off, j: b.j + off });
    for (const t of baseSeq.transformers) {
      superSeq.transformers.push({ ...t, i: t.i + off, j: t.j + off });
    }
    for (const s of baseSeq.shunts) superSeq.shunts.push({ ...s, i: s.i + off });

    // Inter-area 345 kV / 138 kV tie-lines linking Area (area-1) <-> Area (area)
    const prevOff = (area - 1) * busStride;
    for (const tieBus of [8, 30, 69]) {
      superCase.branches.push({
        i: tieBus + prevOff,
        j: tieBus + off,
        ckt: "1",
        r: 0.012,
        x: 0.095,
        b: 0.04,
        rateA: 500,
        rateB: 500,
        rateC: 500,
        gi: 0,
        bi: 0,
        gj: 0,
        bj: 0,
        st: 1,
        met: 1,
        len: 80,
        o1: 1,
        f1: 1,
      });
      superSeq.branches.push({
        i: tieBus + prevOff,
        j: tieBus + off,
        ckt: "1",
        r0: 0.036,
        x0: 0.285,
        b0: 0.02,
        gi0: 0,
        bi0: 0,
        gj0: 0,
        bj0: 0,
      });
    }
  }

  assert.equal(superCase.buses.size, 590);
  assert.ok(superCase.generators.length >= 250);
  assert.ok(superCase.branches.length + superCase.transformers.length >= 900);

  // Couple 4 concurrent real PSCAD .pscx plants on separate OS worker threads across 4 different areas
  const boundaryBuses = ["15", String(15 + busStride), String(15 + 2 * busStride), String(15 + 3 * busStride)];
  const plants = boundaryBuses.map((busId, idx) => ({
    id: `PSCAD_Area${idx}_IBR`,
    participant: new WorkerEmtParticipant({ kind: "pscad", netlist: emtNetlist }, { id: `PSCAD_Area${idx}_IBR` }),
    boundaryPorts: [{ phasorBusId: busId, emtBusId: "B3" }],
  }));

  const t0 = Date.now();
  const res = await runHybridPhasorEmtCoSimulation(
    new PssePhasorParticipant(superCase, { id: "SuperGrid_590Bus", dyrCase: superDyr, seqCase: superSeq }),
    plants,
    {
      durationSec: 0.2, // 40 macro-steps x 100 EMT sub-steps x 4 plants = 16,000 EMT micro-steps
      dtTsSec: 0.005,
      dtEmtSec: 50e-6,
      mode: "direct",
      sequences: 3,
      useDynamicEquivalent: true,
      useFdne: true,
      fault: {
        busId: "17", // Fault in Area 0 near Plant 0
        startSec: 0.05,
        clearSec: 0.12,
        susceptancePu: -20.0,
        faultType: "slg",
      },
    },
  );
  const wallMs = Date.now() - t0;

  console.log(
    `[Large-Scale 590-Bus x 4 PSCAD Workers] buses=${superCase.buses.size}, gens=${superCase.generators.length}, branches=${superCase.branches.length}, macroSteps=${res.totalMacroSteps}, emtSubSteps=${res.totalEmtSubSteps}, wallMs=${wallMs}`,
  );

  assert.equal(res.phasorTrajectory.summary.convergedPowerFlow, true);
  assert.equal(res.plantCount, 4);
  assert.equal(res.totalMacroSteps, 40);
  assert.equal(res.totalEmtSubSteps, 4000);
  assert.equal(res.topologyUpdates, 2);

  // Check Area 0 boundary bus (near fault on Bus 17) sees clear pre-fault -> fault dip -> post-fault recovery
  const area0Recs = res.macroRecords.filter((r) => r.phasorBusId === "15");
  const pre = area0Recs[5]!; // t = 0.030 s
  const during = area0Recs[15]!; // t = 0.080 s
  const post = area0Recs[39]!; // t = 0.200 s

  assert.ok(
    Number.isFinite(pre.vTsMagPu) && pre.vTsMagPu > 0.8 && pre.vTsMagPu < 1.2,
    `590-Bus pre-fault V: ${pre.vTsMagPu}`,
  );
  assert.ok(during.vTsMagPu < pre.vTsMagPu - 0.02, `Expected 590-Bus fault dip: ${during.vTsMagPu} vs ${pre.vTsMagPu}`);
  assert.ok(during.vNegMagPu > 0.002, `Expected non-zero V2 on 590-Bus SLG fault, got ${during.vNegMagPu}`);
  assert.ok(during.vZeroMagPu > 0.002, `Expected non-zero V0 on 590-Bus SLG fault, got ${during.vZeroMagPu}`);
  assert.ok(
    post.vTsMagPu > during.vTsMagPu,
    `Expected 590-Bus post-fault recovery: ${post.vTsMagPu} vs ${during.vTsMagPu}`,
  );
});

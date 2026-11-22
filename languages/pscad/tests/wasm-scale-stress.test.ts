// SPDX-License-Identifier: AGPL-3.0-or-later

import { runHybridPhasorEmtCoSimulation } from "@modelscript/exchange";
import { parseDyr, parseRaw, parseSeq, PssePhasorParticipant } from "@modelscript/psse";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extractEmtNetlist, parsePscx, PscadEmtParticipant, type EmtNetlist } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PSSE_SUITE = path.resolve(__dirname, "../../psse/testsuite");
const PSCAD_FIXTURES = path.resolve(__dirname, "./fixtures");

const baseRaw = parseRaw(fs.readFileSync(path.join(PSSE_SUITE, "ieee118.raw"), "utf-8"));
const baseDyr = parseDyr(fs.readFileSync(path.join(PSSE_SUITE, "ieee118.dyr"), "utf-8"));
const baseSeq = parseSeq(fs.readFileSync(path.join(PSSE_SUITE, "ieee118.seq"), "utf-8"));
const realPscadNet = extractEmtNetlist(
  parsePscx(fs.readFileSync(path.join(PSCAD_FIXTURES, "IEEE9Bus_IBR_v2.pscx"), "utf-8")),
);

function buildTiledIeee118(nAreas: number) {
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
  return { superCase, superDyr, superSeq };
}

function buildLargeEmtNetlist(nBuses: number): EmtNetlist {
  const buses: EmtNetlist["buses"] = new Map();
  const branches: EmtNetlist["branches"] = [];
  for (let i = 0; i < nBuses; i++) {
    buses.set(`EMT_B${i}`, {
      id: `EMT_B${i}`,
      name: `EMT_B${i}`,
      baseKv: 230.0,
      phaseCount: 3,
      connectedBranchIds: [],
    });
  }
  for (let i = 0; i < nBuses - 1; i++) {
    branches.push({
      id: `L_${i}`,
      kind: "rlc",
      fromBus: `EMT_B${i}`,
      toBus: `EMT_B${i + 1}`,
      resistanceOhm: 1.5,
      inductanceH: 0.015,
      capacitanceF: 0,
    });
    if (i % 5 === 4) {
      branches.push({
        id: `LD_${i}`,
        kind: "rlc",
        fromBus: `EMT_B${i}`,
        toBus: "GND",
        resistanceOhm: 1200.0,
        inductanceH: 0.1,
        capacitanceF: 0,
      });
    }
    if (i + 10 < nBuses && i % 10 === 0) {
      branches.push({
        id: `TIE_${i}`,
        kind: "rlc",
        fromBus: `EMT_B${i}`,
        toBus: `EMT_B${i + 10}`,
        resistanceOhm: 2.0,
        inductanceH: 0.02,
        capacitanceF: 0,
      });
    }
  }
  return {
    buses,
    branches,
    transformers: [],
    transmissionLines: [],
    fmuInstances: [],
    sources: [],
    faults: [],
    nominalFrequencyHz: 60.0,
  };
}

function memMb() {
  const m = process.memoryUsage();
  return `heap=${(m.heapUsed / 1e6).toFixed(1)}MB rss=${(m.rss / 1e6).toFixed(1)}MB`;
}

test("WASM-Scale Tier A: 2,360-Bus Bulk Grid (20x IEEE 118, 1,080 gens) <-> Real PSCAD .pscx (3-seq SLG + sparse Kron + FDNE)", async () => {
  const { superCase, superDyr, superSeq } = buildTiledIeee118(20);
  const t0 = Date.now();
  const res = await runHybridPhasorEmtCoSimulation(
    new PssePhasorParticipant(superCase, { id: "Grid_2360", dyrCase: superDyr, seqCase: superSeq }),
    [
      {
        id: "PSCAD_IBR",
        participant: new PscadEmtParticipant(realPscadNet, { id: "PSCAD_IBR" }),
        boundaryPorts: [{ phasorBusId: "15", emtBusId: "B3" }],
      },
    ],
    {
      durationSec: 0.05,
      dtTsSec: 0.005,
      dtEmtSec: 50e-6,
      sequences: 3,
      useDynamicEquivalent: true,
      useFdne: true,
      fault: { busId: "17", startSec: 0.015, clearSec: 0.035, susceptancePu: -20.0, faultType: "slg" },
    },
  );
  const wallMs = Date.now() - t0;
  console.log(
    `[Tier A: 2,360-Bus x Real PSCAD] gens=${superCase.generators.length}, branches=${superCase.branches.length}, wall=${wallMs}ms, ${memMb()}`,
  );
  assert.equal(res.phasorTrajectory.summary.convergedPowerFlow, true);
  assert.equal(res.topologyUpdates, 2);
  assert.ok(Number.isFinite(res.macroRecords[9]!.vTsMagPu));
});

test("WASM-Scale Tier B: 5,900-Bus Regional Grid (50x IEEE 118, 2,700 gens) <-> Real PSCAD .pscx (3-seq SLG + sparse Kron)", async () => {
  const { superCase, superDyr, superSeq } = buildTiledIeee118(50);
  const t0 = Date.now();
  const res = await runHybridPhasorEmtCoSimulation(
    new PssePhasorParticipant(superCase, { id: "Grid_5900", dyrCase: superDyr, seqCase: superSeq }),
    [
      {
        id: "PSCAD_IBR",
        participant: new PscadEmtParticipant(realPscadNet, { id: "PSCAD_IBR" }),
        boundaryPorts: [{ phasorBusId: "15", emtBusId: "B3" }],
      },
    ],
    {
      durationSec: 0.04,
      dtTsSec: 0.005,
      dtEmtSec: 50e-6,
      sequences: 3,
      useDynamicEquivalent: true,
      useFdne: false, // 20-freq scan over 5,900 buses tested separately; here test sparse Kron + 3-seq RK4
      fault: { busId: "17", startSec: 0.01, clearSec: 0.025, susceptancePu: -20.0, faultType: "slg" },
    },
  );
  const wallMs = Date.now() - t0;
  console.log(
    `[Tier B: 5,900-Bus x Real PSCAD] gens=${superCase.generators.length}, branches=${superCase.branches.length}, wall=${wallMs}ms, ${memMb()}`,
  );
  assert.equal(res.phasorTrajectory.summary.convergedPowerFlow, true);
  assert.equal(res.topologyUpdates, 2);
  assert.ok(Number.isFinite(res.macroRecords[7]!.vTsMagPu));
});

test("WASM-Scale Tier C: 11,800-Bus Continental Grid (100x IEEE 118, 5,400 gens) <-> Real PSCAD .pscx", async () => {
  const { superCase, superDyr } = buildTiledIeee118(100);
  const t0 = Date.now();
  const res = await runHybridPhasorEmtCoSimulation(
    new PssePhasorParticipant(superCase, { id: "Grid_11800", dyrCase: superDyr }),
    [
      {
        id: "PSCAD_IBR",
        participant: new PscadEmtParticipant(realPscadNet, { id: "PSCAD_IBR" }),
        boundaryPorts: [{ phasorBusId: "15", emtBusId: "B3" }],
      },
    ],
    {
      durationSec: 0.03,
      dtTsSec: 0.005,
      dtEmtSec: 50e-6,
      sequences: 1,
      useDynamicEquivalent: true,
      useFdne: false,
      fault: { busId: "17", startSec: 0.01, clearSec: 0.02, susceptancePu: -20.0, faultType: "3ph" },
    },
  );
  const wallMs = Date.now() - t0;
  console.log(
    `[Tier C: 11,800-Bus x Real PSCAD] gens=${superCase.generators.length}, branches=${superCase.branches.length}, wall=${wallMs}ms, ${memMb()}`,
  );
  assert.equal(res.phasorTrajectory.summary.convergedPowerFlow, true);
  assert.equal(res.topologyUpdates, 2);
  assert.ok(Number.isFinite(res.macroRecords[5]!.vTsMagPu));
});

test("WASM-Scale Tier D: Large 150-Bus (450-Phase-Node) EMT Plant (useWasm=true) <-> IEEE 118-Bus Bulk Grid", async () => {
  const bigEmt = buildLargeEmtNetlist(150);
  const t0 = Date.now();
  const res = await runHybridPhasorEmtCoSimulation(
    new PssePhasorParticipant(baseRaw, { id: "IEEE118", dyrCase: baseDyr, seqCase: baseSeq }),
    [
      {
        id: "LargeEMT_150Bus",
        participant: new PscadEmtParticipant(bigEmt, {
          id: "LargeEMT_150Bus",
          solverOptions: { useWasm: true, initializeFromLoadFlow: false },
        }),
        boundaryPorts: [{ phasorBusId: "15", emtBusId: "EMT_B0" }],
      },
    ],
    {
      durationSec: 0.04,
      dtTsSec: 0.005,
      dtEmtSec: 50e-6,
      sequences: 3,
      useDynamicEquivalent: true,
      useFdne: true,
      fault: { busId: "17", startSec: 0.01, clearSec: 0.025, susceptancePu: -20.0, faultType: "slg" },
    },
  );
  const wallMs = Date.now() - t0;
  console.log(
    `[Tier D: IEEE 118 x 150-Bus (450-node) WASM EMT] emtBuses=150, emtBranches=${bigEmt.branches.length}, wall=${wallMs}ms, ${memMb()}`,
  );
  assert.equal(res.phasorTrajectory.summary.convergedPowerFlow, true);
  assert.equal(res.totalEmtSubSteps, 800);
  assert.ok(Number.isFinite(res.macroRecords[7]!.vTsMagPu));
});

test("WASM-Scale Tier E: 29,500-Bus Interconnection Grid (250x IEEE 118, 13,500 gens, ~45k branches) <-> Real PSCAD .pscx", async () => {
  const { superCase, superDyr } = buildTiledIeee118(250);
  const t0 = Date.now();
  const res = await runHybridPhasorEmtCoSimulation(
    new PssePhasorParticipant(superCase, { id: "Grid_29500", dyrCase: superDyr }),
    [
      {
        id: "PSCAD_IBR",
        participant: new PscadEmtParticipant(realPscadNet, { id: "PSCAD_IBR" }),
        boundaryPorts: [{ phasorBusId: "15", emtBusId: "B3" }],
      },
    ],
    {
      durationSec: 0.03,
      dtTsSec: 0.005,
      dtEmtSec: 50e-6,
      sequences: 1,
      useDynamicEquivalent: true,
      useFdne: false,
      fault: { busId: "17", startSec: 0.01, clearSec: 0.02, susceptancePu: -20.0, faultType: "3ph" },
    },
  );
  const wallMs = Date.now() - t0;
  console.log(
    `[Tier E: 29,500-Bus x Real PSCAD] gens=${superCase.generators.length}, branches=${superCase.branches.length}, wall=${wallMs}ms, ${memMb()}`,
  );
  assert.equal(res.phasorTrajectory.summary.convergedPowerFlow, true);
  assert.equal(res.topologyUpdates, 2);
  assert.ok(Number.isFinite(res.macroRecords[5]!.vTsMagPu));
});

test("WASM-Scale Tier F: Large 500-Bus (1,500-Phase-Node) EMT Plant (useWasm=true) <-> IEEE 118-Bus Bulk Grid", async () => {
  const bigEmt = buildLargeEmtNetlist(500);
  const t0 = Date.now();
  const res = await runHybridPhasorEmtCoSimulation(
    new PssePhasorParticipant(baseRaw, { id: "IEEE118", dyrCase: baseDyr, seqCase: baseSeq }),
    [
      {
        id: "LargeEMT_500Bus",
        participant: new PscadEmtParticipant(bigEmt, {
          id: "LargeEMT_500Bus",
          solverOptions: { useWasm: true, initializeFromLoadFlow: false },
        }),
        boundaryPorts: [{ phasorBusId: "15", emtBusId: "EMT_B0" }],
      },
    ],
    {
      durationSec: 0.04,
      dtTsSec: 0.005,
      dtEmtSec: 50e-6,
      sequences: 3,
      useDynamicEquivalent: true,
      useFdne: true,
      fault: { busId: "17", startSec: 0.01, clearSec: 0.025, susceptancePu: -20.0, faultType: "slg" },
    },
  );
  const wallMs = Date.now() - t0;
  console.log(
    `[Tier F: IEEE 118 x 500-Bus (1,500-node) WASM EMT] emtBuses=500, emtBranches=${bigEmt.branches.length}, wall=${wallMs}ms, ${memMb()}`,
  );
  assert.equal(res.phasorTrajectory.summary.convergedPowerFlow, true);
  assert.equal(res.totalEmtSubSteps, 800);
  assert.ok(Number.isFinite(res.macroRecords[7]!.vTsMagPu));
});

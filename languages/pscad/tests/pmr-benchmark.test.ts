// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
  computePmrStatistics,
  create500kVEhvTransmissionCase,
  executePmrRun,
  executePmrRunWithTrajectory,
  exportPmrToCsv,
  exportPmrToJson,
  exportRunToComtrade,
  exportRunToPsout,
  generatePmrTasks,
  type PmrRunRecord,
} from "../src/index.js";

describe("PSCAD Parallel Multiple Run (PMR) & SSOV Benchmark Engine", () => {
  it("should initialize 500 kV EHV transmission case with Bergeron line", () => {
    const netlist = create500kVEhvTransmissionCase();
    assert.equal(netlist.nominalFrequencyHz, 60.0);
    assert.equal(netlist.buses.size, 3);
    assert.ok(netlist.buses.has("SEND_BUS"));
    assert.ok(netlist.buses.has("LINE_SEND"));
    assert.ok(netlist.buses.has("LINE_REC"));

    assert.equal(netlist.sources.length, 1);
    assert.equal(netlist.sources[0]!.bus, "SEND_BUS");

    assert.equal(netlist.transmissionLines.length, 1);
    const line = netlist.transmissionLines[0]!;
    assert.equal(line.id, "LINE_EHV");
    assert.equal(line.modelType, "bergeron");
    assert.equal(line.lengthKm, 250.0);

    const breaker = netlist.branches.find((b) => b.id === "BRK_EHV");
    assert.ok(breaker);
    assert.equal(breaker.kind, "switch");
    assert.equal(breaker.status, "open");
  });

  it("should generate deterministic PMR tasks with Gaussian pole scatter", () => {
    const tasks = generatePmrTasks({
      numRuns: 20,
      breakerId: "BRK_EHV",
      poleScatterSec: 0.0015,
      monitoredBuses: ["LINE_REC"],
    });

    assert.equal(tasks.length, 20);
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i]!;
      assert.equal(t.runIndex, i + 1);
      assert.ok(t.closingAngleDeg >= 0 && t.closingAngleDeg <= 360);
      assert.ok(t.poleClosingTimesSec.a > 0.005 && t.poleClosingTimesSec.a < 0.05);
      assert.ok(t.poleClosingTimesSec.b > 0.005 && t.poleClosingTimesSec.b < 0.05);
      assert.ok(t.poleClosingTimesSec.c > 0.005 && t.poleClosingTimesSec.c < 0.05);
    }
  });

  it("should execute PMR EMT runs and compute IEC 60071-2 statistical metrics", () => {
    const netlist = create500kVEhvTransmissionCase();
    const tasks = generatePmrTasks({
      numRuns: 15,
      breakerId: "BRK_EHV",
      durationSec: 0.04,
      timeStepSec: 50e-6,
      monitoredBuses: ["LINE_REC"],
    });

    const records: PmrRunRecord[] = [];
    const t0 = performance.now();
    for (const task of tasks) {
      records.push(executePmrRun(netlist, task));
    }
    const wallClockMs = performance.now() - t0;

    assert.equal(records.length, 15);
    for (const r of records) {
      assert.equal(r.status, "CONVERGED");
      assert.ok(r.maxPeakKv > 400.0, `Peak overvoltage should reflect wave amplification (> 400 kV), got ${r.maxPeakKv}`);
      assert.ok(r.maxPeakPu > 1.0, `Peak p.u. should exceed 1.0, got ${r.maxPeakPu}`);
      assert.equal(r.peakBusId, "LINE_REC");
      assert.ok(r.chatterDampedSteps > 0, "CDA should damp chatter at breaker close");
    }

    const basePeakKv = (500.0 * Math.SQRT2) / Math.sqrt(3.0);
    const summary = computePmrStatistics(
      "Test_EHV_Energization",
      records,
      basePeakKv,
      wallClockMs,
      1,
      800,
      50.0,
      40.0,
    );

    assert.equal(summary.totalRuns, 15);
    assert.equal(summary.numericalConvergenceRate, 100.0);
    assert.equal(summary.cdaChatterEliminationRate, 100.0);
    assert.ok(summary.ssovV2PercentKv >= summary.meanPeakKv);
    assert.ok(summary.maxPeakKv >= summary.ssovV2PercentKv);
    assert.ok(summary.minPeakKv <= summary.meanPeakKv);

    const totalHistogramPct = summary.histogram.reduce((acc, b) => acc + b.percent, 0.0);
    assert.ok(
      Math.abs(totalHistogramPct - 100.0) < 1.0,
      `Histogram percentages must sum to 100%, got ${totalHistogramPct}`,
    );

    // Test CSV and JSON export
    const tmpDir = path.join(os.tmpdir(), `pscad_pmr_test_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const csvPath = path.join(tmpDir, "pmr_ssov.csv");
    const jsonPath = path.join(tmpDir, "pmr_summary.json");

    exportPmrToCsv(summary, csvPath);
    exportPmrToJson(summary, jsonPath);

    assert.ok(fs.existsSync(csvPath));
    assert.ok(fs.existsSync(jsonPath));

    const csvContent = fs.readFileSync(csvPath, "utf-8");
    assert.ok(csvContent.includes("Run_Index,Closing_Angle_Deg,Pole_A_ms,Pole_B_ms,Pole_C_ms"));
    assert.equal(csvContent.trim().split("\n").length, 16); // Header + 15 rows

    const jsonContent = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    assert.equal(jsonContent.totalRuns, 15);
    assert.equal(jsonContent.caseName, "Test_EHV_Energization");

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should serialize full EMT trajectory to IEEE COMTRADE and PSCAD v5 .psout", () => {
    const netlist = create500kVEhvTransmissionCase();
    const tasks = generatePmrTasks({
      numRuns: 1,
      breakerId: "BRK_EHV",
      durationSec: 0.02,
      timeStepSec: 50e-6,
    });
    assert.equal(tasks.length, 1);

    const { record, trajectory } = executePmrRunWithTrajectory(netlist, tasks[0]!);
    assert.equal(record.status, "CONVERGED");
    assert.ok(record.maxPeakKv > 400.0);
    assert.ok(trajectory.time.length > 0);
    assert.ok(trajectory.busVoltages.size > 0);

    const tmpDir = path.join(os.tmpdir(), `pscad_pmr_wave_test_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const cffPath = path.join(tmpDir, "worst_case.cff");
    const psoutPath = path.join(tmpDir, "worst_case.psout");

    const comtradeRes = exportRunToComtrade(trajectory, cffPath, "Test_Substation", "REC_01");
    const psoutRes = exportRunToPsout(trajectory, psoutPath);

    assert.ok(fs.existsSync(cffPath));
    assert.ok(fs.existsSync(psoutPath));
    assert.ok(comtradeRes.byteLength > 1000);
    assert.ok(psoutRes.byteLength > 1000);

    const cffText = fs.readFileSync(cffPath, "utf-8");
    assert.ok(cffText.includes("--- file type: CFG ---"));
    assert.ok(cffText.includes("Test_Substation,REC_01,1999"));
    assert.ok(cffText.includes("--- file type: DAT ASCII ---"));

    const psoutBytes = fs.readFileSync(psoutPath);
    assert.ok(psoutBytes.length > 512);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});


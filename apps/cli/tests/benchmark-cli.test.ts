// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { BenchmarkCommand } from "../src/commands/benchmark.js";
import { PscadCommand } from "../src/commands/pscad.js";
import { PsseCommand } from "../src/commands/psse.js";

test("ModelScript CLI: Benchmark Command Suite (msx benchmark psse & pscad)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_benchmark_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  await t.test("msx benchmark psse --model=activsg2000: Full run, CSV, HTML, and RAW export", async () => {
    const csvOut = path.join(tmpDir, "activsg2000_accc.csv");
    const htmlOut = path.join(tmpDir, "activsg2000_report.html");
    const rawOut = path.join(tmpDir, "activsg2000.raw");
    const jsonOut = path.join(tmpDir, "activsg2000_metrics.json");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
      origLog(...args);
    };

    try {
      await BenchmarkCommand.handler!({
        suite: "psse",
        model: "activsg2000",
        contingencies: 15,
        out: csvOut,
        html: htmlOut,
        exportRaw: rawOut,
        json: jsonOut,
      } as any);
    } finally {
      console.log = origLog;
    }

    // Verify stdout log telemetry
    const combinedLog = logs.join("\n");
    assert.ok(combinedLog.includes("ACTIVSg2000 Synthetic Texas Grid"), "Must log ACTIVSg2000 model");
    assert.ok(combinedLog.includes("Base Power Flow:"), "Must log power flow status");
    assert.ok(combinedLog.includes("ACCC Screening:"), "Must log ACCC throughput");
    assert.ok(combinedLog.includes("SOTA Parity vs PSS/E:"), "Must log SOTA parity");

    // Verify generated shareable files
    assert.ok(fs.existsSync(csvOut), "Must generate PSS/E Tabulated CSV");
    const csvContent = fs.readFileSync(csvOut, "utf-8");
    assert.ok(csvContent.includes("CONTINGENCY LABEL,STATUS,ITERATIONS"), "Must have PSS/E CSV headers");
    assert.ok(csvContent.includes("CONVERGED"), "Must have converged contingency entries");

    assert.ok(fs.existsSync(htmlOut), "Must generate standalone HTML dashboard");
    const htmlContent = fs.readFileSync(htmlOut, "utf-8");
    assert.ok(htmlContent.includes("ACTIVSg2000"), "HTML must mention ACTIVSg2000");

    assert.ok(fs.existsSync(rawOut), "Must generate Siemens PSS/E .raw file");
    const rawContent = fs.readFileSync(rawOut, "utf-8");
    assert.ok(rawContent.includes("0 / END OF BUS DATA"), "Must be valid .raw format");

    assert.ok(fs.existsSync(jsonOut), "Must generate JSON summary");
    const jsonContent = JSON.parse(fs.readFileSync(jsonOut, "utf-8"));
    assert.ok(jsonContent["ACTIVSg2000"], "JSON must have ACTIVSg2000 entry");
    assert.strictEqual(jsonContent["ACTIVSg2000"].buses, 2000);
  });

  await t.test("msx benchmark psse --model=mmwg70k: 70,000-bus ultra-scale test", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
      origLog(...args);
    };

    try {
      await BenchmarkCommand.handler!({
        suite: "psse",
        model: "mmwg70k",
        contingencies: 10,
      } as any);
    } finally {
      console.log = origLog;
    }

    const combinedLog = logs.join("\n");
    assert.ok(combinedLog.includes("MMWG 70,000-Bus US Eastern Interconnection"), "Must log MMWG 70k");
    assert.ok(combinedLog.includes("Memory Footprint:"), "Must log memory footprint");
    assert.ok(combinedLog.includes("70,000 buses"), "Must synthesize 70k buses");
  });

  await t.test("msx benchmark psse --model=pegase9241: European ill-conditioned grid", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
      origLog(...args);
    };

    try {
      await BenchmarkCommand.handler!({
        suite: "psse",
        model: "pegase9241",
        contingencies: 10,
      } as any);
    } finally {
      console.log = origLog;
    }

    const combinedLog = logs.join("\n");
    assert.ok(combinedLog.includes("FP7 PEGASE 9,241-Bus Pan-European"), "Must log PEGASE 9241");
    assert.ok(combinedLog.includes("Conditioning Stress:"), "Must log R/X ratio spread");
  });

  await t.test("msx benchmark pscad --model=cigre-b4: Multi-Terminal HVDC & COMTRADE export", async () => {
    const comtradeOut = path.join(tmpDir, "cigre_b4.cff");
    const psoutOut = path.join(tmpDir, "cigre_b4.psout");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
      origLog(...args);
    };

    try {
      await BenchmarkCommand.handler!({
        suite: "pscad",
        model: "cigre-b4",
        durationMs: 25.0,
        timeStepUs: 20.0,
        exportComtrade: comtradeOut,
        exportPsout: psoutOut,
      } as any);
    } finally {
      console.log = origLog;
    }

    const combinedLog = logs.join("\n");
    assert.ok(combinedLog.includes("CIGRE B4 DC Grid Benchmark"), "Must log CIGRE B4");
    assert.ok(combinedLog.includes("EMT Closed-Loop:"), "Must log EMT stepping");
    assert.ok(combinedLog.includes("SOTA Parity vs EMTDC:"), "Must log SOTA parity");

    // Verify COMTRADE and PSOUT files
    assert.ok(fs.existsSync(comtradeOut), "Must generate IEEE COMTRADE .cff");
    const cffContent = fs.readFileSync(comtradeOut, "utf-8");
    assert.ok(cffContent.includes("CIGRE_B4_STATION"), "COMTRADE must have station name");

    assert.ok(fs.existsSync(psoutOut), "Must generate native PSCAD .psout binary");
    const psoutBuf = fs.readFileSync(psoutOut);
    assert.ok(psoutBuf.byteLength > 1000, "PSOUT binary must not be empty");
  });

  await t.test("msx benchmark pscad --model=wind100: 100-turbine offshore wind collector", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
      origLog(...args);
    };

    try {
      await BenchmarkCommand.handler!({
        suite: "pscad",
        model: "wind100",
        durationMs: 20.0,
        timeStepUs: 20.0,
      } as any);
    } finally {
      console.log = origLog;
    }

    const combinedLog = logs.join("\n");
    assert.ok(combinedLog.includes("100-Turbine Offshore Wind Farm Collector Network"), "Must log wind farm");
    assert.ok(combinedLog.includes("Grid Code Response:"), "Must log IEEE 2800 response");
  });

  await t.test("msx benchmark pscad --model=ehv-corridor: 500 kV EHV Corridor ULM", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
      origLog(...args);
    };

    try {
      await BenchmarkCommand.handler!({
        suite: "pscad",
        model: "ehv-corridor",
        durationMs: 20.0,
        timeStepUs: 20.0,
      } as any);
    } finally {
      console.log = origLog;
    }

    const combinedLog = logs.join("\n");
    assert.ok(combinedLog.includes("Untransposed 500 kV EHV Corridor"), "Must log EHV corridor");
    assert.ok(combinedLog.includes("Transients & TRV:"), "Must log TRV metrics");
  });

  await t.test("msx psse benchmark & msx pscad benchmark subcommands integration", async () => {
    // Verify psse command delegates to benchmark
    await PsseCommand.handler!({
      action: "benchmark",
      model: "activsg2000",
      contingencies: 5,
    } as any);

    // Verify pscad command delegates to benchmark
    await PscadCommand.handler!({
      action: "benchmark",
      model: "cigre-b4",
      durationMs: 15.0,
      timeStepUs: 20.0,
    } as any);
  });

  // Cleanup temporary scratch files
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

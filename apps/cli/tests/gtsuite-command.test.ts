// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { GtSuiteCommand } from "../src/commands/gtsuite.js";

async function runGtSuiteCommand(
  action: string,
  file: string,
  extraArgs: Record<string, unknown> = {},
): Promise<{
  stdout: string;
  exitCode: number | undefined;
}> {
  const logs: string[] = [];
  const origLog = process.stdout.write;
  const origExitCode = process.exitCode;
  process.exitCode = 0;

  process.stdout.write = ((chunk: any, encoding?: any, cb?: any) => {
    logs.push(String(chunk));
    return origLog.call(process.stdout, chunk, encoding, cb);
  }) as any;

  try {
    await GtSuiteCommand.handler({
      action,
      files: [file],
      format: "terminal",
      ...extraArgs,
      _: ["gtsuite", action, file],
      $0: "msx",
    } as any);
    const exitCode = typeof process.exitCode === "number" ? process.exitCode : undefined;
    return { stdout: logs.join(""), exitCode };
  } finally {
    process.stdout.write = origLog;
    process.exitCode = origExitCode;
  }
}

describe("CLI GtSuiteCommand Suite (`msx gtsuite`)", () => {
  const scratchDir = path.resolve(import.meta.dirname, "scratch_cli_gtsuite");
  const deckFile = path.join(scratchDir, "engine.gtm");

  const gtSource = `MODEL: BenchmarkTurboEngine
SPEED: 3200.0
LAMBDA: 1.0

COMPONENTS:
  INLET = environment_inlet (P = 101325, T = 298.15)
  COMP = turbo_compressor (PR = 2.1, EFF = 0.77, MASS_FLOW = 0.15)
  INTERCOOLER = intercooler (VOL = 0.005, DP = 0.04, EFF = 0.85)
  PLENUM_IN = plenum (VOL = 0.004, P = 195000, T = 315)
  RUNNER1 = intake_runner (D = 0.045, L = 0.35, CELLS = 8)
  CYL1 = cylinder (BORE = 0.0825, STROKE = 0.0928, ROD = 0.144, CR = 10.0, ANCHOR = 15, DURATION = 45)
  RUNNER_EXH1 = exhaust_runner (D = 0.038, L = 0.38, CELLS = 8)
  PLENUM_EXH = plenum (VOL = 0.0028, P = 240000, T = 1050)
  TURB = turbo_turbine (ER = 1.95, EFF = 0.73)
  OUTLET = environment_outlet (P = 101325, T = 298.15)

CONNECTIONS:
  INLET.out -> COMP.in
  COMP.out -> INTERCOOLER.in
  INTERCOOLER.out -> PLENUM_IN.in
  PLENUM_IN.port1 -> RUNNER1.in
  RUNNER1.out -> CYL1.intake
  CYL1.exhaust -> RUNNER_EXH1.in
  RUNNER_EXH1.out -> PLENUM_EXH.port1
  PLENUM_EXH.out -> TURB.in
  TURB.out -> OUTLET.in
`;

  before(() => {
    fs.mkdirSync(scratchDir, { recursive: true });
    fs.writeFileSync(deckFile, gtSource, "utf-8");
  });

  after(() => {
    if (fs.existsSync(scratchDir)) {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it("prints human-readable summary of GT-SUITE model (`summary`)", async () => {
    const res = await runGtSuiteCommand("summary", deckFile);
    assert.ok(res.stdout.includes("GT-SUITE Model Summary: BenchmarkTurboEngine"));
    assert.ok(res.stdout.includes("Cylinders:       1"));
    assert.ok(res.stdout.includes("Rated Speed:     3200 RPM"));
  });

  it("lints GT-SUITE model without errors (`lint`)", async () => {
    const res = await runGtSuiteCommand("lint", deckFile);
    assert.ok(res.stdout.includes("✓ No issues found in 'BenchmarkTurboEngine'."));
    assert.strictEqual(res.exitCode, 0);
  });

  it("simulates GT-SUITE model transient trajectory (`simulate`)", async () => {
    const outTraj = path.join(scratchDir, "traj.csv");
    const res = await runGtSuiteCommand("simulate", deckFile, {
      duration: 0.05,
      out: outTraj,
    });
    assert.ok(res.stdout.includes("Simulation Results: BenchmarkTurboEngine"));
    assert.ok(res.stdout.includes("Mean Brake Torque:"));
    assert.ok(fs.existsSync(outTraj));

    const csvContent = fs.readFileSync(outTraj, "utf-8");
    assert.ok(csvContent.includes("Time_s,CrankAngle_deg,P_cyl_bar"));
  });

  it("projects to Modelica and SysML v2 (`to-modelica`, `to-sysml2`)", async () => {
    const outMo = path.join(scratchDir, "Engine.mo");
    const resMo = await runGtSuiteCommand("to-modelica", deckFile, { out: outMo });
    assert.ok(resMo.stdout.includes("✓ Exported Modelica model"));
    assert.ok(fs.existsSync(outMo));

    const outSysml = path.join(scratchDir, "Engine.sysml");
    const resSysml = await runGtSuiteCommand("to-sysml2", deckFile, { out: outSysml });
    assert.ok(resSysml.stdout.includes("✓ Exported SysML v2 model"));
    assert.ok(fs.existsSync(outSysml));
  });

  it("generates schematic SVG diagrams (`diagram`)", async () => {
    const outSvg = path.join(scratchDir, "schematic.svg");
    const res = await runGtSuiteCommand("diagram", deckFile, {
      out: outSvg,
      view: "schematic",
    });
    assert.ok(res.stdout.includes("✓ Exported schematic SVG diagram"));
    assert.ok(fs.existsSync(outSvg));
    const svgContent = fs.readFileSync(outSvg, "utf-8");
    assert.ok(svgContent.includes("<svg"));
  });

  it("verifies engine performance gates (`verify`)", async () => {
    const res = await runGtSuiteCommand("verify", deckFile, {
      duration: 0.05,
      "max-bsfc": 350.0,
      "max-boost": 3.0,
      "max-nox": 120.0,
      "min-knock": 0.05,
    });
    assert.ok(res.stdout.includes("GT-SUITE Engine Verification Gate Report"));
    assert.ok(res.stdout.includes("✅ PASSED"));
  });
});

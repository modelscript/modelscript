// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { RocetsCommand } from "../src/commands/rocets.js";

async function runRocetsCommand(
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

  process.stdout.write = ((chunk: any) => {
    logs.push(String(chunk));
    return true;
  }) as any;

  try {
    await RocetsCommand.handler({
      action,
      files: [file],
      format: "terminal",
      ...extraArgs,
      _: ["rocets", action, file],
      $0: "msx",
    } as any);
    const exitCode = typeof process.exitCode === "number" ? process.exitCode : undefined;
    return { stdout: logs.join(""), exitCode };
  } finally {
    process.stdout.write = origLog;
    process.exitCode = origExitCode;
  }
}

describe("CLI RocetsCommand Suite (`msx rocets`)", () => {
  const scratchDir = path.resolve(import.meta.dirname, "scratch_cli_rocets");
  const deckFile = path.join(scratchDir, "engine.roc");

  const rocetsSource = `DECK: GasGeneratorEngine
TITLE: "Gas Generator Cycle Rocket Engine"
COMPONENTS:
  CHAMBER TYPE=CHAMBER TITLE="Combustion Chamber"
    PARAMS: PC=10.0E6, MR=6.0, AT=0.03, EPS=45.0, VC=0.02
  PUMP_OX TYPE=PUMP TITLE="LOX Pump"
    PARAMS: DELTA_P=15.0E6, ETA=0.76
  PUMP_FUEL TYPE=PUMP TITLE="LH2 Pump"
    PARAMS: DELTA_P=20.0E6, ETA=0.74
  TURB01 TYPE=TURBINE TITLE="Drive Turbine"
    PARAMS: PR=1.65, ETA=0.72, T_IN=950.0
CONNECTIONS:
  PUMP_OX.OUT_P -> CHAMBER.IN_OX
  PUMP_FUEL.OUT_P -> CHAMBER.IN_FUEL
  TURB01.OUT_P -> CHAMBER.IN_GAS
`;

  before(() => {
    if (fs.existsSync(scratchDir)) {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
    fs.mkdirSync(scratchDir, { recursive: true });
    fs.writeFileSync(deckFile, rocetsSource, "utf-8");
  });

  after(() => {
    if (fs.existsSync(scratchDir)) {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it("msx rocets summary prints module statistics and connections", async () => {
    const { stdout } = await runRocetsCommand("summary", deckFile);
    assert.ok(stdout.includes("GasGeneratorEngine"));
    assert.ok(stdout.includes("CHAMBER"));
    assert.ok(stdout.includes("PUMP_OX"));
  });

  it("msx rocets balance solves engine steady-state power and flow", async () => {
    const { stdout } = await runRocetsCommand("balance", deckFile);
    assert.ok(stdout.includes("Chamber Pressure: 10.00 MPa"));
    assert.ok(stdout.includes("Total Mass Flow:"));
    assert.ok(stdout.includes("Vacuum Thrust:"));
    assert.ok(stdout.includes("Vacuum Isp:"));
  });

  it("msx rocets simulate outputs dynamic start transient table", async () => {
    const { stdout } = await runRocetsCommand("simulate", deckFile, {
      "t-end": 1.0,
    });
    assert.ok(stdout.includes("ROCETS Dynamic Ignition & Ramp Transient"));
    assert.ok(stdout.includes("Time(s)"));
  });

  it("msx rocets to-modelica converts ROCETS deck to Modelica 3.x", async () => {
    const { stdout } = await runRocetsCommand("to-modelica", deckFile);
    assert.ok(stdout.includes("model GasGeneratorEngine"));
    assert.ok(stdout.includes("CHAMBER_Pc"));
  });

  it("msx rocets to-ssp converts ROCETS deck to SystemStructure.ssd XML", async () => {
    const { stdout } = await runRocetsCommand("to-ssp", deckFile);
    assert.ok(stdout.includes("<ssd:SystemStructureDescription"));
    assert.ok(stdout.includes('name="GasGeneratorEngine"'));
  });

  it("msx rocets diagram renders SVG P&ID schematic diagram", async () => {
    const { stdout } = await runRocetsCommand("diagram", deckFile);
    assert.ok(stdout.includes("<svg"));
    assert.ok(stdout.includes("CHAMBER"));
    assert.ok(stdout.includes("</svg>"));
  });
});

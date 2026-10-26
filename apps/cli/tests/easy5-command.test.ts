// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Easy5Command } from "../src/commands/easy5.js";

async function runEasy5Command(
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
    await Easy5Command.handler({
      action,
      files: [file],
      format: "terminal",
      ...extraArgs,
      _: ["easy5", action, file],
      $0: "msx",
    } as any);
    const exitCode = typeof process.exitCode === "number" ? process.exitCode : undefined;
    return { stdout: logs.join(""), exitCode };
  } finally {
    process.stdout.write = origLog;
    process.exitCode = origExitCode;
  }
}

describe("CLI Easy5Command Suite (`msx easy5`)", () => {
  const scratchDir = path.resolve(import.meta.dirname, "scratch_cli_easy5");
  const modelFile = path.join(scratchDir, "lag.ez5");

  const easy5Source = `MODEL: LagFilter
COMPONENTS:
  LA01 TYPE=GP/LA TITLE="Lead Lag"
    XP: P1=1.0, P2=2.0
    S0: S1=0.0
`;

  before(() => {
    if (fs.existsSync(scratchDir)) {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
    fs.mkdirSync(scratchDir, { recursive: true });
    fs.writeFileSync(modelFile, easy5Source, "utf-8");
  });

  after(() => {
    if (fs.existsSync(scratchDir)) {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it("msx easy5 summary prints component and state statistics", async () => {
    const { stdout } = await runEasy5Command("summary", modelFile);
    assert.ok(stdout.includes("LagFilter"));
    assert.ok(stdout.includes("Components:  1"));
    assert.ok(stdout.includes("States (S):  1"));
  });

  it("msx easy5 linearize outputs state space matrices A, B, C, D", async () => {
    const { stdout } = await runEasy5Command("linearize", modelFile);
    assert.ok(stdout.includes("Matrix A"));
    assert.ok(stdout.includes("Matrix B"));
    assert.ok(stdout.includes("Matrix C"));
    assert.ok(stdout.includes("Matrix D"));
  });

  it("msx easy5 bode computes magnitude and phase table", async () => {
    const { stdout } = await runEasy5Command("bode", modelFile, {
      "min-freq": 0.1,
      "max-freq": 10.0,
      "num-points": 10,
    });
    assert.ok(stdout.includes("Magnitude (dB)"));
    assert.ok(stdout.includes("Phase (deg)"));
  });

  it("msx easy5 to-modelica converts EASY5 to Modelica 3.x", async () => {
    const { stdout } = await runEasy5Command("to-modelica", modelFile);
    assert.ok(stdout.includes("model LagFilter"));
    assert.ok(stdout.includes("Modelica.Blocks.Continuous.TransferFunction"));
    assert.ok(stdout.includes("end LagFilter;"));
  });

  it("msx easy5 to-ssp converts EASY5 to SystemStructure.ssd XML", async () => {
    const { stdout } = await runEasy5Command("to-ssp", modelFile);
    assert.ok(stdout.includes("<ssd:SystemStructureDescription"));
    assert.ok(stdout.includes('name="LagFilter"'));
  });

  it("msx easy5 diagram renders SVG schematic diagram", async () => {
    const { stdout } = await runEasy5Command("diagram", modelFile);
    assert.ok(stdout.includes("<svg"));
    assert.ok(stdout.includes("LA01"));
  });

  it("msx easy5 trim computes equilibrium operating point (dx/dt = 0)", async () => {
    const { stdout } = await runEasy5Command("trim", modelFile);
    assert.ok(stdout.includes("Operating Point Equilibrium (Trim) for LagFilter:"));
    assert.ok(stdout.includes("Converged:     YES"));
    assert.ok(stdout.includes("Residual Norm:"));

    const jsonRes = await runEasy5Command("trim", modelFile, { format: "json" });
    const parsed = JSON.parse(jsonRes.stdout);
    assert.equal(parsed.converged, true);
    assert.ok(parsed.trimmedStates !== undefined);
    assert.ok(parsed.trimmedOutputs !== undefined);
  });
});

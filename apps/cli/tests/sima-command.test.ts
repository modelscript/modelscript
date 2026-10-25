// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { SimaCommand } from "../src/commands/sima.js";

async function runSimaCommand(
  action: string,
  file: string,
  extraArgs: Record<string, unknown> = {},
): Promise<{
  stdout: string;
  exitCode: number | undefined;
}> {
  const logs: string[] = [];
  const origLog = console.log;
  const origExitCode = process.exitCode;
  process.exitCode = 0;

  console.log = (...args: any[]) => {
    logs.push(args.join(" "));
  };

  try {
    await SimaCommand.handler({
      action,
      files: [file],
      ...extraArgs,
      _: ["sima", action, file],
      $0: "msx",
    } as any);
    const exitCode = typeof process.exitCode === "number" ? process.exitCode : undefined;
    return { stdout: logs.join("\n"), exitCode };
  } finally {
    console.log = origLog;
    process.exitCode = origExitCode;
  }
}

describe("CLI SimaCommand Suite (`msx sima`)", () => {
  const scratchDir = path.resolve(import.meta.dirname, "scratch_cli_sima");
  const deckFile = path.join(scratchDir, "semi.inp");

  const simoSource = `
SYS 200.0 1025.0 9.81
BODY semi_hull OC4_Semi 13444000 13989 0.0 0.0 -13.46 32.0 32.0 34.0 4.5 5.0
FAIRLEAD fl_1 semi_hull 40.868 0.0 -14.0
FAIRLEAD fl_2 semi_hull -20.434 35.393 -14.0
FAIRLEAD fl_3 semi_hull -20.434 -35.393 -14.0

CRS chain_type 0.137 385.5 3200 1.25e9 1.0e5 1.8e7 1.2 2.0
LINE line_1 catenary fl_1 837.6 0.0 -200.0
SEGM chain_type 835.5 1.8e7
LINE line_2 catenary fl_2 -418.8 725.4 -200.0
SEGM chain_type 835.5 1.8e7
LINE line_3 catenary fl_3 -418.8 -725.4 -200.0
SEGM chain_type 835.5 1.8e7

WAVE JONSWAP 8.0 12.5 3.3 0.0
WIND 20.0 0.0
CURR 1.2 0.0
TIME 0.05 3600.0
`;

  before(() => {
    fs.mkdirSync(scratchDir, { recursive: true });
    fs.writeFileSync(deckFile, simoSource, "utf-8");
  });

  after(() => {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  it("executes `msx sima summary`", async () => {
    const { stdout, exitCode } = await runSimaCommand("summary", deckFile);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("SINTEF Ocean SIMO/RIFLEX Model"));
    assert.ok(stdout.includes("OC4_Semi"));
    assert.ok(stdout.includes("Mooring Lines (3)"));
  });

  it("executes `msx sima lint` on clean deck", async () => {
    const { stdout, exitCode } = await runSimaCommand("lint", deckFile);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("No errors or warnings found"));
  });

  it("executes `msx sima verify` (DNV-OS-E301)", async () => {
    const { stdout, exitCode } = await runSimaCommand("verify", deckFile, {
      "consequence-class": 2,
    });
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("DNV-OS-E301 / DNV-ST-0119 Compliance Report"));
    assert.ok(stdout.includes("ALL LINES COMPLY WITH DNV"));
  });

  it("executes `msx sima to-modelica`", async () => {
    const outFile = path.join(scratchDir, "OC4.mo");
    const { stdout, exitCode } = await runSimaCommand("to-modelica", deckFile, {
      out: outFile,
    });
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("Wrote Modelica model"));
    assert.ok(fs.existsSync(outFile));
    const code = fs.readFileSync(outFile, "utf-8");
    assert.ok(code.includes("model semi"));
    assert.ok(code.includes("der(surge) = v_surge;"));
  });

  it("executes `msx sima to-ssp`", async () => {
    const outFile = path.join(scratchDir, "SystemStructure.ssd");
    const { stdout, exitCode } = await runSimaCommand("to-ssp", deckFile, {
      out: outFile,
    });
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("Wrote SystemStructure.ssd"));
    assert.ok(fs.existsSync(outFile));
    const code = fs.readFileSync(outFile, "utf-8");
    assert.ok(code.includes("<ssd:SystemStructureDescription"));
  });

  it("executes `msx sima offset`", async () => {
    const { stdout, exitCode } = await runSimaCommand("offset", deckFile);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("Vessel Watch Circle & Offset Report"));
    assert.ok(stdout.includes("Watch Circle Limit"));
    assert.ok(stdout.includes("Excursion Utilization"));
  });

  it("executes `msx sima to-sysml2`", async () => {
    const outFile = path.join(scratchDir, "semi.sysml");
    const { stdout, exitCode } = await runSimaCommand("to-sysml2", deckFile, {
      out: outFile,
    });
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("Wrote SysML v2 model"));
    assert.ok(fs.existsSync(outFile));
    const code = fs.readFileSync(outFile, "utf-8");
    assert.ok(code.includes("package semi_inp"));
    assert.ok(code.includes("port def FairleadMechanicalPort"));
  });
});

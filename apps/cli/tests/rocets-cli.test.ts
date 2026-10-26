// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { RocetsCommand } from "../src/commands/rocets.js";

const SAMPLE_ROCETS_DECK = `DECK: EngineCore
TITLE: "Expander Cycle Rocket Engine"
CYCLE: expander

COMPONENTS:
  CHAMBER TYPE=CHAMBER TITLE="Main Combustion Chamber"
    PARAMS: PC=10.0E6, AT=0.02, CSTAR=1780.0, VC=0.015
    S0: PC=10.0E6

  PUMP01 TYPE=PUMP TITLE="LH2 Main Pump"
    PARAMS: DELTA_P=15.0E6, ETA=0.75, RHO=71.0

  TURB01 TYPE=TURBINE TITLE="Drive Turbine"
    PARAMS: ETA=0.78, PR=2.2

  SHAFT01 TYPE=SHAFT TITLE="Turbopump Shaft"
    PARAMS: INERTIA=0.05, SPEED_RPM=35000.0

CONNECTIONS:
  PUMP01.OUT_P -> CHAMBER.IN_FUEL
`;

test("ROCETS CLI Commands (msx rocets inspect, lint, to-dae, to-modelica)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_rocets_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const rocFile = path.join(tmpDir, "engine.roc");
  fs.writeFileSync(rocFile, SAMPLE_ROCETS_DECK, "utf-8");

  await t.test("msx rocets inspect / summary", async () => {
    const outputs: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: any) => {
      outputs.push(String(chunk));
      return true;
    };

    try {
      await (RocetsCommand.handler as any)({
        action: "inspect",
        files: [rocFile],
      });
      const combined = outputs.join("");
      assert.ok(combined.includes("NASA ROCETS Engine Model: EngineCore"));
      assert.ok(combined.includes("Modules (4)"));
      assert.ok(combined.includes("CHAMBER"));
    } finally {
      process.stdout.write = origWrite;
    }
  });

  await t.test("msx rocets lint", async () => {
    const outputs: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: any) => {
      outputs.push(String(chunk));
      return true;
    };

    const origExitCode = process.exitCode;
    try {
      await (RocetsCommand.handler as any)({
        action: "lint",
        files: [rocFile],
      });
      const combined = outputs.join("");
      assert.ok(combined.includes("EngineCore"));
    } finally {
      process.stdout.write = origWrite;
      process.exitCode = origExitCode;
    }
  });

  await t.test("msx rocets to-dae", async () => {
    const outDae = path.join(tmpDir, "engine_dae.json");
    await (RocetsCommand.handler as any)({
      action: "to-dae",
      files: [rocFile],
      out: outDae,
    });

    assert.ok(fs.existsSync(outDae));
    const meta = JSON.parse(fs.readFileSync(outDae, "utf-8"));
    assert.ok(meta.varCount > 5);
    assert.ok(meta.eqCount >= 4);
  });

  await t.test("msx rocets to-modelica", async () => {
    const outMo = path.join(tmpDir, "engine.mo");
    await (RocetsCommand.handler as any)({
      action: "to-modelica",
      files: [rocFile],
      out: outMo,
    });

    assert.ok(fs.existsSync(outMo));
    const content = fs.readFileSync(outMo, "utf-8");
    assert.ok(content.includes("model EngineCore"));
    assert.ok(content.includes("Real CHAMBER_Pc"));
  });
});

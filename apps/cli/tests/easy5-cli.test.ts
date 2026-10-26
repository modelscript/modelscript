// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { Easy5Command } from "../src/commands/easy5.js";

const SAMPLE_EASY5_MODEL = `MODEL: PitchControl
TITLE: "Aircraft Pitch Rate Feedback Controller"

COMPONENTS:
  IN01 TYPE=GP/IN TITLE="Forward Integrator"
    XP: GAIN=5.0, S0=0.0

  GA01 TYPE=GP/GA TITLE="Pitch Rate Gain"
    XP: K=2.5

  SJ01 TYPE=GP/SJ TITLE="Error Summer"
    XP: SGN1=1.0, SGN2=-1.0

CONNECTIONS:
  SJ01.OUT -> GA01.IN
  GA01.OUT -> IN01.IN
`;

test("EASY5 CLI Commands (msx easy5 inspect, lint, to-dae, to-modelica)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_easy5_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const ez5File = path.join(tmpDir, "pitch.ez5");
  fs.writeFileSync(ez5File, SAMPLE_EASY5_MODEL, "utf-8");

  await t.test("msx easy5 inspect / summary", async () => {
    const outputs: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: any) => {
      outputs.push(String(chunk));
      return true;
    };

    try {
      await (Easy5Command.handler as any)({
        action: "inspect",
        files: [ez5File],
      });
      const combined = outputs.join("");
      assert.ok(combined.includes("EASY5 Model: PitchControl"));
      assert.ok(combined.includes("Components:  3"));
      assert.ok(combined.includes("GA01"));
    } finally {
      process.stdout.write = origWrite;
    }
  });

  await t.test("msx easy5 lint", async () => {
    const outputs: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: any) => {
      outputs.push(String(chunk));
      return true;
    };

    const origExitCode = process.exitCode;
    try {
      await (Easy5Command.handler as any)({
        action: "lint",
        files: [ez5File],
      });
      const combined = outputs.join("");
      assert.ok(combined.includes("PitchControl") || combined.includes("pitch.ez5"));
    } finally {
      process.stdout.write = origWrite;
      process.exitCode = origExitCode;
    }
  });

  await t.test("msx easy5 to-dae", async () => {
    const outDae = path.join(tmpDir, "pitch_dae.json");
    await (Easy5Command.handler as any)({
      action: "to-dae",
      files: [ez5File],
      out: outDae,
    });

    assert.ok(fs.existsSync(outDae));
    const meta = JSON.parse(fs.readFileSync(outDae, "utf-8"));
    assert.ok(meta.varCount > 3);
    assert.ok(meta.eqCount >= 2);
  });

  await t.test("msx easy5 to-modelica", async () => {
    const outMo = path.join(tmpDir, "pitch.mo");
    await (Easy5Command.handler as any)({
      action: "to-modelica",
      files: [ez5File],
      out: outMo,
    });

    assert.ok(fs.existsSync(outMo));
    const content = fs.readFileSync(outMo, "utf-8");
    assert.ok(content.includes("model PitchControl"));
  });

  await t.test("msx easy5 sync", async () => {
    const modifiedMo = `model PitchControl
  Modelica.Blocks.Math.Add SJ01;
  Modelica.Blocks.Math.Gain GA01(k=7.5);
  Modelica.Blocks.Continuous.Integrator IN01(k=10.0, y_start=2.0);
equation
  connect(SJ01.y, GA01.u);
  connect(GA01.y, IN01.u);
end PitchControl;`;
    const syncMo = path.join(tmpDir, "pitch_mod.mo");
    fs.writeFileSync(syncMo, modifiedMo, "utf-8");

    const outEz5 = path.join(tmpDir, "pitch_synced.ez5");
    await (Easy5Command.handler as any)({
      action: "sync",
      files: [ez5File],
      "from-modelica": syncMo,
      out: outEz5,
    });
    assert.ok(fs.existsSync(outEz5));
    const content = fs.readFileSync(outEz5, "utf-8");
    assert.ok(content.includes("K=7.5"));
    assert.ok(content.includes("GAIN=10"));
  });

  await t.test("msx easy5 trim", async () => {
    const outputs: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: any) => {
      outputs.push(String(chunk));
      return true;
    };

    try {
      const outTrim = path.join(tmpDir, "pitch_trim.json");
      await (Easy5Command.handler as any)({
        action: "trim",
        files: [ez5File],
        format: "json",
        out: outTrim,
      });

      assert.ok(fs.existsSync(outTrim));
      const res = JSON.parse(fs.readFileSync(outTrim, "utf-8"));
      assert.equal(res.converged, true);
    } finally {
      process.stdout.write = origWrite;
    }
  });
});

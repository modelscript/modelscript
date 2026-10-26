// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { OlgaCommand } from "../src/commands/olga.js";

const SAMPLE_OLGA = `CASE TITLE = "SubseaTieback"
FILES TABLE = "fluids.tab"
FLOWPATH NAME = TiebackLine
  PIPE LABEL = P-101, LENGTH = 1500.0 m, DIAMETER = 0.3 m, ROUGHNESS = 0.000045 m, NSEGMENT = 5
  VALVE NAME = Choke-1, POSITION = 1500.0 m, OPENING = 0.8
NODE NAME = InletWell, TYPE = MASS_SOURCE, FLOWPATH = TiebackLine, FRACTION = 0.0, PRESSURE = 120.0 bar, TEMPERATURE = 85.0 C, TOTALMASSRATE = 25.0 kg/s
NODE NAME = HostSeparator, TYPE = TERMINAL, FLOWPATH = TiebackLine, FRACTION = 1.0, PRESSURE = 35.0 bar, TEMPERATURE = 25.0 C
`;

test("OLGA CLI Commands (msx olga inspect, lint, to-dae, to-modelica, simulate)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_olga_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const olgaFile = path.join(tmpDir, "tieback.genkey");
  fs.writeFileSync(olgaFile, SAMPLE_OLGA, "utf-8");

  await t.test("msx olga inspect", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (OlgaCommand.handler as any)({
        action: "inspect",
        files: [olgaFile],
      });
      assert.ok(logs.some((l) => l.includes("[OLGA Multiphase Model] File: tieback.genkey")));
      assert.ok(logs.some((l) => l.includes("Title: SubseaTieback")));
      assert.ok(logs.some((l) => l.includes("Flowpath 'TiebackLine'")));
      assert.ok(logs.some((l) => l.includes("Node 'InletWell'")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx olga lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (OlgaCommand.handler as any)({
        action: "lint",
        files: [olgaFile],
      });
      assert.ok(logs.some((l) => l.includes("Pre-flight flow assurance checks passed with 0 diagnostics.")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx olga to-dae", async () => {
    const outDae = path.join(tmpDir, "dae_meta.json");
    await (OlgaCommand.handler as any)({
      action: "to-dae",
      files: [olgaFile],
      out: outDae,
    });
    assert.ok(fs.existsSync(outDae));
    const meta = JSON.parse(fs.readFileSync(outDae, "utf-8"));
    assert.ok(meta.varCount > 0);
    assert.ok(meta.eqCount > 0);
  });

  await t.test("msx olga to-modelica", async () => {
    const outMo = path.join(tmpDir, "tieback.mo");
    await (OlgaCommand.handler as any)({
      action: "to-modelica",
      files: [olgaFile],
      out: outMo,
    });
    assert.ok(fs.existsSync(outMo));
    const moContent = fs.readFileSync(outMo, "utf-8");
    assert.ok(moContent.includes("model SubseaTieback"));
    assert.ok(moContent.includes("Modelica.Fluid.Pipes.DynamicPipe"));
    assert.ok(moContent.includes("Modelica.Fluid.Sources.MassFlowSource_T"));
  });

  await t.test("msx olga simulate", async () => {
    const outCsv = path.join(tmpDir, "traj.csv");
    await (OlgaCommand.handler as any)({
      action: "simulate",
      files: [olgaFile],
      duration: 5.0,
      dt: 1.0,
      out: outCsv,
    });
    assert.ok(fs.existsSync(outCsv));
    const csvContent = fs.readFileSync(outCsv, "utf-8");
    assert.ok(csvContent.includes("time,inlet_pressure_bar"));
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

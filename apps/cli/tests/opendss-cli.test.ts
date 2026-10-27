// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { OpenDssCommand } from "../src/commands/opendss.js";

const CLI_OPENDSS_DSS = `! IEEE 4-Bus CLI Test
Clear
New Circuit.CLI_Feeder basekv=115.0 pu=1.05 phases=3 bus1=SourceBus
New Transformer.SubXfmr phases=3 windings=2 buses=[SourceBus, SubBus] kvs=[115, 12.47] kvas=[10000, 10000]
New Line.Line1 bus1=SubBus bus2=LoadBus phases=3 length=2.0 r1=0.1 x1=0.4
New Load.Load1 bus1=LoadBus phases=3 kv=12.47 kw=1500 kvar=500
New PVSystem.SolarFarm1 bus1=LoadBus phases=3 kv=12.47 kva=500 pmpp=450
`;

test("OpenDSS CLI Commands (msx opendss inspect, lint, powerflow, to-dae, to-modelica)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_opendss_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const dssFile = path.join(tmpDir, "circuit.dss");
  fs.writeFileSync(dssFile, CLI_OPENDSS_DSS, "utf-8");

  await t.test("msx opendss inspect / summary", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (OpenDssCommand.handler as any)({
        action: "inspect",
        files: [dssFile],
      });
      assert.ok(logs.some((l) => l.includes("OpenDSS Circuit Summary")));
      assert.ok(logs.some((l) => l.includes("CLI_Feeder")));
      assert.ok(logs.some((l) => l.includes("Transformers: 1")));
      assert.ok(logs.some((l) => l.includes("Lines:        1")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx opendss lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (OpenDssCommand.handler as any)({
        action: "lint",
        files: [dssFile],
      });
      assert.ok(logs.some((l) => l.includes("0 diagnostics") || l.includes("Lint Results")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx opendss powerflow", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (OpenDssCommand.handler as any)({
        action: "powerflow",
        files: [dssFile],
      });
      assert.ok(logs.some((l) => l.includes("Power Flow Results")));
      assert.ok(logs.some((l) => l.includes("CONVERGED")));
      assert.ok(logs.some((l) => l.includes("Total Load:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx opendss to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (OpenDssCommand.handler as any)({
        action: "to-dae",
        files: [dssFile],
      });
      assert.ok(logs.some((l) => l.includes("OpenDSS DAE Lowering")));
      assert.ok(logs.some((l) => l.includes("DAE Variables:")));
      assert.ok(logs.some((l) => l.includes("DAE Equations:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx opendss to-modelica", async () => {
    const outModelica = path.join(tmpDir, "circuit.mo");
    try {
      await (OpenDssCommand.handler as any)({
        action: "to-modelica",
        files: [dssFile],
        out: outModelica,
      });
      assert.ok(fs.existsSync(outModelica));
      const moContent = fs.readFileSync(outModelica, "utf-8");
      assert.ok(moContent.includes("model CLI_Feeder"));
      assert.ok(moContent.includes("SineVoltage source"));
    } finally {
      // Keep tmpDir for cleanup at end
    }
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

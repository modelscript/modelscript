// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SimulinkCommand } from "../src/commands/simulink.js";

const MODEL_MDL = `Model {
  Name "cli_cruise_control"
  Version "10.0"
  System {
    Name "cli_cruise_control"
    Block {
      BlockType Step
      Name "TargetSpeed"
      Position [20, 50, 60, 90]
      Time 0.0
      Before 0.0
      After 30.0
    }
    Block {
      BlockType Integrator
      Name "SpeedIntegrator"
      Position [120, 50, 160, 90]
      InitialCondition 0.0
    }
    Block {
      BlockType Outport
      Name "SpeedOut"
      Position [200, 50, 230, 90]
    }
    Line {
      SrcBlock "TargetSpeed"
      SrcPort 1
      DstBlock "SpeedIntegrator"
      DstPort 1
    }
    Line {
      SrcBlock "SpeedIntegrator"
      SrcPort 1
      DstBlock "SpeedOut"
      DstPort 1
    }
  }
}`;

test("MATLAB Simulink CLI Commands (msx simulink inspect, lint, to-modelica, to-dae)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_simulink_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const mdlFile = path.join(tmpDir, "cruise.mdl");
  fs.writeFileSync(mdlFile, MODEL_MDL, "utf-8");

  await t.test("msx simulink inspect", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (SimulinkCommand.handler as any)({
        action: "inspect",
        files: [mdlFile],
      });
      assert.ok(logs.some((l) => l.includes("cli_cruise_control")));
      assert.ok(logs.some((l) => l.includes("Blocks: 3")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx simulink lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (SimulinkCommand.handler as any)({
        action: "lint",
        files: [mdlFile],
      });
      assert.ok(logs.some((l) => l.includes("Clean. 0 diagnostics.")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx simulink to-modelica", async () => {
    const outMo = path.join(tmpDir, "cruise.mo");
    await (SimulinkCommand.handler as any)({
      action: "to-modelica",
      files: [mdlFile],
      out: outMo,
    });
    assert.ok(fs.existsSync(outMo));
    const content = fs.readFileSync(outMo, "utf-8");
    assert.ok(content.includes("model cli_cruise_control"));
    assert.ok(content.includes("Modelica.Blocks.Continuous.Integrator SpeedIntegrator"));
  });

  await t.test("msx simulink to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (SimulinkCommand.handler as any)({
        action: "to-dae",
        files: [mdlFile],
      });
      assert.ok(logs.some((l) => l.includes("lowered to linear WebAssembly memory arena")));
      assert.ok(logs.some((l) => l.includes("Variables:")));
      assert.ok(logs.some((l) => l.includes("Equations:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx simulink sync", async () => {
    const modifiedMo = `model cli_cruise_control
  Modelica.Blocks.Sources.Step TargetSpeed;
  Modelica.Blocks.Continuous.Integrator SpeedIntegrator(y_start=15.0);
  Modelica.Blocks.Interfaces.RealOutput SpeedOut;
equation
  connect(TargetSpeed.y, SpeedIntegrator.u);
  connect(SpeedIntegrator.y, SpeedOut.inPort);
end cli_cruise_control;`;
    const syncMo = path.join(tmpDir, "cruise_mod.mo");
    fs.writeFileSync(syncMo, modifiedMo, "utf-8");

    const outMdl = path.join(tmpDir, "cruise_synced.mdl");
    await (SimulinkCommand.handler as any)({
      action: "sync",
      files: [mdlFile],
      "from-modelica": syncMo,
      out: outMdl,
    });
    assert.ok(fs.existsSync(outMdl));
    const content = fs.readFileSync(outMdl, "utf-8");
    assert.ok(content.includes("InitialCondition 15"));
  });
});

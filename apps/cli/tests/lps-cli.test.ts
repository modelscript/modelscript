// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { LpsCommand } from "../src/commands/lps.js";

const SAMPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<PipelineStudio id="study_texas_trunk" title="Texas Gulf Coast Gas Trunkline" simulationType="TGNET">
  <Nodes>
    <Node name="Hub_Supply" type="SUPPLY" elevation="10m" pressure="75.0bar" flow="120.0" />
    <Node name="Mid_Compressor_Suction" type="JUNCTION" elevation="25m" />
    <Node name="Mid_Compressor_Discharge" type="JUNCTION" elevation="25m" />
    <Node name="City_Gate_Delivery" type="DELIVERY" elevation="5m" minDeliveryPressure="35.0bar" flow="120.0" />
  </Nodes>
  <Pipes>
    <Pipe name="Line_101" from="Hub_Supply" to="Mid_Compressor_Suction" length="80.0km" diameter="30inch" roughness="0.000045m" maop="95.0bar" />
    <Pipe name="Line_102" from="Mid_Compressor_Discharge" to="City_Gate_Delivery" length="110.0km" diameter="30inch" roughness="0.000045m" maop="95.0bar" />
  </Pipes>
  <Compressors>
    <Compressor name="Station_A" from="Mid_Compressor_Suction" to="Mid_Compressor_Discharge" type="CENTRIFUGAL" power="22000000" maxRatio="1.8" efficiency="0.84" mode="DISCHARGE_PRESSURE" setpoint="85.0bar" status="RUNNING" />
  </Compressors>
  <GasComposition ch4="0.91" c2h6="0.05" c3h8="0.018" co2="0.008" n2="0.014" h2="0.05" ghv="39.2" />
  <SimulationControls startTime="0" endTime="86400" timeStep="60" eos="AGA8" steadyStateFirst="true" />
</PipelineStudio>`;

test("PipelineStudio CLI Commands (msx lps inspect, lint, to-dae, to-modelica, solve, simulate)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_lps_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const lpsFile = path.join(tmpDir, "network.lps");
  fs.writeFileSync(lpsFile, SAMPLE_XML, "utf-8");

  await t.test("msx lps inspect", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (LpsCommand.handler as any)({
        action: "inspect",
        files: [lpsFile],
      });
      assert.ok(logs.some((l) => l.includes("[PipelineStudio Network] File: network.lps")));
      assert.ok(logs.some((l) => l.includes("Title: Texas Gulf Coast Gas Trunkline")));
      assert.ok(logs.some((l) => l.includes("Node 'Hub_Supply'")));
      assert.ok(logs.some((l) => l.includes("Pipe 'Line_101'")));
      assert.ok(logs.some((l) => l.includes("Compressor 'Station_A'")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx lps lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (LpsCommand.handler as any)({
        action: "lint",
        files: [lpsFile],
      });
      assert.ok(logs.some((l) => l.includes("Clean! No diagnostics found.")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx lps to-dae", async () => {
    const outDae = path.join(tmpDir, "lps_dae.json");
    await (LpsCommand.handler as any)({
      action: "to-dae",
      files: [lpsFile],
      out: outDae,
    });
    assert.ok(fs.existsSync(outDae));
    const meta = JSON.parse(fs.readFileSync(outDae, "utf-8"));
    assert.ok(meta.varCount > 0);
    assert.ok(meta.eqCount > 0);
  });

  await t.test("msx lps to-modelica", async () => {
    const outMo = path.join(tmpDir, "network.mo");
    await (LpsCommand.handler as any)({
      action: "to-modelica",
      files: [lpsFile],
      out: outMo,
    });
    assert.ok(fs.existsSync(outMo));
    const content = fs.readFileSync(outMo, "utf-8");
    assert.ok(content.includes("model Texas_Gulf_Coast_Gas_Trunkline"));
    assert.ok(content.includes("Modelica.Fluid.Pipes.DynamicPipe"));
    assert.ok(content.includes("Modelica.Fluid.Machines.PrescribedPump"));
  });

  await t.test("msx lps solve", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (LpsCommand.handler as any)({
        action: "solve",
        files: [lpsFile],
      });
      assert.ok(logs.some((l) => l.includes("PipelineStudio Steady-State Hydraulics")));
      assert.ok(logs.some((l) => l.includes("Hub_Supply")));
      assert.ok(logs.some((l) => l.includes("Line_101")));
    } finally {
      console.log = origLog;
    }
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

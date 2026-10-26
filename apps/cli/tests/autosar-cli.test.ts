// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { AutosarCommand } from "../src/commands/autosar.js";

const SAMPLE_ARXML = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Powertrain</SHORT-NAME>
      <ELEMENTS>
        <SENDER-RECEIVER-INTERFACE>
          <SHORT-NAME>PedalIf</SHORT-NAME>
          <DATA-ELEMENTS>
            <VARIABLE-DATA-PROTOTYPE>
              <SHORT-NAME>Pos</SHORT-NAME>
              <TYPE-TREF>/AUTOSAR/Platform/ImplementationDataTypes/float32</TYPE-TREF>
              <INIT-VALUE>0.0</INIT-VALUE>
            </VARIABLE-DATA-PROTOTYPE>
          </DATA-ELEMENTS>
        </SENDER-RECEIVER-INTERFACE>

        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>PedalSensor</SHORT-NAME>
          <PORTS>
            <P-PORT-PROTOTYPE>
              <SHORT-NAME>PedalOut</SHORT-NAME>
              <PROVIDED-INTERFACE-TREF>/Powertrain/PedalIf</PROVIDED-INTERFACE-TREF>
            </P-PORT-PROTOTYPE>
          </PORTS>
          <INTERNAL-BEHAVIORS>
            <SWC-INTERNAL-BEHAVIOR>
              <SHORT-NAME>Pedal_IB</SHORT-NAME>
              <RUNNABLES>
                <RUNNABLE-ENTITY>
                  <SHORT-NAME>RE_ReadPedal</SHORT-NAME>
                  <DATA-READ-ACCESSS/>
                  <DATA-WRITE-ACCESSS>
                    <VARIABLE-ACCESS>
                      <PORT-PROTOTYPE-REF>PedalOut</PORT-PROTOTYPE-REF>
                      <TARGET-DATA-PROTOTYPE-REF>Pos</TARGET-DATA-PROTOTYPE-REF>
                    </VARIABLE-ACCESS>
                  </DATA-WRITE-ACCESSS>
                </RUNNABLE-ENTITY>
              </RUNNABLES>
              <EVENTS>
                <TIMING-EVENT>
                  <SHORT-NAME>TE_10ms</SHORT-NAME>
                  <START-ON-EVENT-REF>RE_ReadPedal</START-ON-EVENT-REF>
                  <PERIOD>0.010</PERIOD>
                </TIMING-EVENT>
              </EVENTS>
            </SWC-INTERNAL-BEHAVIOR>
          </INTERNAL-BEHAVIORS>
        </APPLICATION-SW-COMPONENT-TYPE>

        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>EngineECU</SHORT-NAME>
          <PORTS>
            <R-PORT-PROTOTYPE>
              <SHORT-NAME>PedalIn</SHORT-NAME>
              <REQUIRED-INTERFACE-TREF>/Powertrain/PedalIf</REQUIRED-INTERFACE-TREF>
            </R-PORT-PROTOTYPE>
          </PORTS>
          <INTERNAL-BEHAVIORS>
            <SWC-INTERNAL-BEHAVIOR>
              <SHORT-NAME>Engine_IB</SHORT-NAME>
              <RUNNABLES>
                <RUNNABLE-ENTITY>
                  <SHORT-NAME>RE_ProcessPedal</SHORT-NAME>
                  <DATA-READ-ACCESSS>
                    <VARIABLE-ACCESS>
                      <PORT-PROTOTYPE-REF>PedalIn</PORT-PROTOTYPE-REF>
                      <TARGET-DATA-PROTOTYPE-REF>Pos</TARGET-DATA-PROTOTYPE-REF>
                    </VARIABLE-ACCESS>
                  </DATA-READ-ACCESSS>
                  <DATA-WRITE-ACCESSS/>
                </RUNNABLE-ENTITY>
              </RUNNABLES>
              <EVENTS>
                <TIMING-EVENT>
                  <SHORT-NAME>TE_20ms</SHORT-NAME>
                  <START-ON-EVENT-REF>RE_ProcessPedal</START-ON-EVENT-REF>
                  <PERIOD>0.020</PERIOD>
                </TIMING-EVENT>
              </EVENTS>
            </SWC-INTERNAL-BEHAVIOR>
          </INTERNAL-BEHAVIORS>
        </APPLICATION-SW-COMPONENT-TYPE>

        <COMPOSITION-SW-COMPONENT-TYPE>
          <SHORT-NAME>VehicleComposition</SHORT-NAME>
          <COMPONENTS>
            <SW-COMPONENT-PROTOTYPE>
              <SHORT-NAME>Pedal</SHORT-NAME>
              <TYPE-TREF>/Powertrain/PedalSensor</TYPE-TREF>
            </SW-COMPONENT-PROTOTYPE>
            <SW-COMPONENT-PROTOTYPE>
              <SHORT-NAME>Engine</SHORT-NAME>
              <TYPE-TREF>/Powertrain/EngineECU</TYPE-TREF>
            </SW-COMPONENT-PROTOTYPE>
          </COMPONENTS>
          <CONNECTORS>
            <ASSEMBLY-SW-CONNECTOR>
              <SHORT-NAME>Conn_Pedal_Engine</SHORT-NAME>
              <PROVIDER-IREF>
                <CONTEXT-COMPONENT-REF>Pedal</CONTEXT-COMPONENT-REF>
                <TARGET-P-PORT-REF>PedalOut</TARGET-P-PORT-REF>
              </PROVIDER-IREF>
              <REQUESTER-IREF>
                <CONTEXT-COMPONENT-REF>Engine</CONTEXT-COMPONENT-REF>
                <TARGET-R-PORT-REF>PedalIn</TARGET-R-PORT-REF>
              </REQUESTER-IREF>
            </ASSEMBLY-SW-CONNECTOR>
          </CONNECTORS>
        </COMPOSITION-SW-COMPONENT-TYPE>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;

test("AUTOSAR CLI Commands (msx autosar inspect, lint, to-modelica, to-sysml, to-dae, simulate-rte)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_autosar_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const arxmlFile = path.join(tmpDir, "system.arxml");
  fs.writeFileSync(arxmlFile, SAMPLE_ARXML, "utf-8");

  await t.test("msx autosar inspect", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (AutosarCommand.handler as any)({
        action: "inspect",
        files: [arxmlFile],
      });
      assert.ok(logs.some((l) => l.includes("[AUTOSAR ARXML] File: system.arxml")));
      assert.ok(logs.some((l) => l.includes("Composition 'VehicleComposition'")));
      assert.ok(logs.some((l) => l.includes("PedalSensor")));
      assert.ok(logs.some((l) => l.includes("EngineECU")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx autosar lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (AutosarCommand.handler as any)({
        action: "lint",
        files: [arxmlFile],
      });
      assert.ok(logs.some((l) => l.includes("Clean. 0 diagnostics.")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx autosar to-modelica", async () => {
    const outMo = path.join(tmpDir, "system.mo");
    await (AutosarCommand.handler as any)({
      action: "to-modelica",
      files: [arxmlFile],
      out: outMo,
    });
    assert.ok(fs.existsSync(outMo));
    const content = fs.readFileSync(outMo, "utf-8");
    assert.ok(content.includes("model VehicleComposition"));
    assert.ok(content.includes("PedalSensor Pedal;"));
    assert.ok(content.includes("EngineECU Engine;"));
    assert.ok(content.includes("connect(Pedal.PedalOut, Engine.PedalIn)"));
  });

  await t.test("msx autosar to-sysml", async () => {
    const outSysml = path.join(tmpDir, "system.sysml");
    await (AutosarCommand.handler as any)({
      action: "to-sysml",
      files: [arxmlFile],
      out: outSysml,
    });
    assert.ok(fs.existsSync(outSysml));
    const content = fs.readFileSync(outSysml, "utf-8");
    assert.ok(content.includes("part def VehicleComposition {"));
    assert.ok(content.includes("part def PedalSensor {"));
    assert.ok(content.includes("part def EngineECU {"));
    assert.ok(content.includes("connect Pedal.PedalOut to Engine.PedalIn;"));
  });

  await t.test("msx autosar to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (AutosarCommand.handler as any)({
        action: "to-dae",
        files: [arxmlFile],
      });
      assert.ok(logs.some((l) => l.includes("lowered to linear WebAssembly memory arena")));
      assert.ok(logs.some((l) => l.includes("Variables:")));
      assert.ok(logs.some((l) => l.includes("Equations:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx autosar simulate-rte", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (AutosarCommand.handler as any)({
        action: "simulate-rte",
        files: [arxmlFile],
        duration: 0.05,
        step: 0.01,
      });
      assert.ok(logs.some((l) => l.includes("[AUTOSAR Virtual RTE] Simulation completed: 0.05s")));
      assert.ok(logs.some((l) => l.includes("Executed task triggers:")));
    } finally {
      console.log = origLog;
    }
  });
});

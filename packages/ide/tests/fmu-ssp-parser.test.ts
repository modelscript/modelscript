// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { FmuBrowserParticipant } from "../src/fmu-browser-participant.js";
import { FmuContentProvider } from "../src/fmu-document-provider.js";
import { parseSsd, parseSsv } from "../src/ssp-parser.js";

describe("FMU & SSP XML CST Parsers Suite", () => {
  it("parses SystemStructureDescription (SSD) XML with elements, connectors, and connections", () => {
    const ssdXml = `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"
                                xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"
                                name="DualDriveSystem" version="1.0" description="Two-motor drive train">
  <ssd:System name="DriveTrain" description="Coupled motors subsystem">
    <ssd:Elements>
      <ssd:Component name="MotorA" type="application/x-fmu-sharedlibrary" source="resources/motorA.fmu">
        <ssd:Connectors>
          <ssd:Connector name="torque" kind="output">
            <ssc:Real unit="N.m" />
          </ssd:Connector>
          <ssd:Connector name="speed" kind="input">
            <ssc:Real unit="rad/s" />
          </ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
      <ssd:Component name="Gearbox" type="application/x-fmu-sharedlibrary" source="resources/gearbox.fmu">
        <ssd:Connectors>
          <ssd:Connector name="torque_in" kind="input">
            <ssc:Real unit="N.m" />
          </ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
    </ssd:Elements>
    <ssd:Connections>
      <ssd:Connection startElement="MotorA" startConnector="torque" endElement="Gearbox" endConnector="torque_in" />
    </ssd:Connections>
    <ssd:ParameterBindings>
      <ssd:ParameterBinding prefix="p" source="resources/params.ssv" />
    </ssd:ParameterBindings>
  </ssd:System>
  <ssd:DefaultExperiment startTime="0.0" stopTime="10.0" />
</ssd:SystemStructureDescription>`;

    const system = parseSsd(ssdXml);
    assert.strictEqual(system.name, "DriveTrain");
    assert.strictEqual(system.description, "Coupled motors subsystem");
    assert.strictEqual(system.version, "1.0");
    assert.strictEqual(system.components.length, 2);

    const motorA = system.components.find((c) => c.name === "MotorA");
    assert.ok(motorA);
    assert.strictEqual(motorA.source, "resources/motorA.fmu");
    assert.strictEqual(motorA.connectors.length, 2);
    assert.strictEqual(motorA.connectors[0]?.name, "torque");
    assert.strictEqual(motorA.connectors[0]?.kind, "output");
    assert.strictEqual(motorA.connectors[0]?.type, "Real");
    assert.strictEqual(motorA.connectors[0]?.unit, "N.m");

    assert.strictEqual(system.connections.length, 1);
    assert.strictEqual(system.connections[0]?.startElement, "MotorA");
    assert.strictEqual(system.connections[0]?.endElement, "Gearbox");

    assert.strictEqual(system.defaultExperiment?.startTime, 0.0);
    assert.strictEqual(system.defaultExperiment?.stopTime, 10.0);
  });

  it("parses SystemStructureParameterValues (SSV) with all scalar types", () => {
    const ssvXml = `<?xml version="1.0" encoding="UTF-8"?>
<ssv:ParameterSet xmlns:ssv="http://ssp-standard.org/SSP1/SystemStructureParameterValues" version="1.0" name="Calibration">
  <ssv:Parameters>
    <ssv:Parameter name="damping">
      <ssv:Real value="0.25" />
    </ssv:Parameter>
    <ssv:Parameter name="gearRatios">
      <ssv:Integer value="4" />
    </ssv:Parameter>
    <ssv:Parameter name="enableRegen">
      <ssv:Boolean value="true" />
    </ssv:Parameter>
    <ssv:Parameter name="controllerMode">
      <ssv:String value="FOC" />
    </ssv:Parameter>
  </ssv:Parameters>
</ssv:ParameterSet>`;

    const params = parseSsv(ssvXml);
    assert.strictEqual(params.length, 4);

    assert.deepStrictEqual(params[0], { name: "damping", type: "Real", value: 0.25 });
    assert.deepStrictEqual(params[1], { name: "gearRatios", type: "Integer", value: 4 });
    assert.deepStrictEqual(params[2], { name: "enableRegen", type: "Boolean", value: true });
    assert.deepStrictEqual(params[3], { name: "controllerMode", type: "String", value: "FOC" });
  });

  it("generates Modelica block from FMU modelDescription.xml via FmuContentProvider", async () => {
    const fmuXml = `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription fmiVersion="2.0" modelName="ElectricMotor" guid="{12345678-ABCD-EF01-2345-6789ABCDEF01}"
                     description="PMSM Motor" generationTool="ModelScript 2026">
  <CoSimulation modelIdentifier="ElectricMotor" canHandleVariableCommunicationStepSize="true" />
  <DefaultExperiment startTime="0.0" stopTime="5.0" stepSize="0.001" />
  <ModelVariables>
    <ScalarVariable name="voltage" valueReference="1" causality="input" variability="continuous">
      <Real start="0.0" unit="V" />
    </ScalarVariable>
    <ScalarVariable name="current" valueReference="2" causality="output" variability="continuous">
      <Real unit="A" />
    </ScalarVariable>
    <ScalarVariable name="resistance" valueReference="3" causality="parameter" variability="fixed">
      <Real start="0.5" unit="Ohm" />
    </ScalarVariable>
    <ScalarVariable name="numPoles" valueReference="4" causality="parameter" variability="fixed">
      <Integer start="4" />
    </ScalarVariable>
  </ModelVariables>
</fmiModelDescription>`;

    const { createZipArchive } = await import("@modelscript/runtime/wasm_container.js");
    const zipBytes = createZipArchive({
      "modelDescription.xml": fmuXml,
    });

    const provider = new FmuContentProvider();
    provider.registerFmu("motor", zipBytes);

    const uri = vscode.Uri.parse("fmu-view:///motor");
    const doc = provider.provideTextDocumentContent(uri);
    assert.ok(typeof doc === "string");
    assert.ok(doc.includes("block ElectricMotor"));
    assert.ok(doc.includes("input Real voltage"));
    assert.ok(doc.includes("output Real current"));
    assert.ok(doc.includes("parameter Real resistance = 0.5"));
    assert.ok(doc.includes("parameter Integer numPoles = 4"));
  });

  it("initializes FmuBrowserParticipant in XML-only mode and extracts variables", async () => {
    const fmuXml = `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription fmiVersion="2.0" modelName="Inverter" guid="{ABCDEF01-2345-6789-ABCD-EF0123456789}"
                     description="DC-AC Inverter">
  <CoSimulation modelIdentifier="Inverter" canHandleVariableCommunicationStepSize="true" />
  <ModelVariables>
    <ScalarVariable name="v_dc" valueReference="10" causality="input" variability="continuous">
      <Real start="400.0" unit="V" />
    </ScalarVariable>
    <ScalarVariable name="i_ac" valueReference="11" causality="output" variability="continuous">
      <Real unit="A" />
    </ScalarVariable>
  </ModelVariables>
</fmiModelDescription>`;

    const participant = new FmuBrowserParticipant("inv1", fmuXml);
    assert.strictEqual(participant.modelName, "Inverter");
    await participant.initialize(0.0, 1.0, 0.01);

    const vars = participant.getVariables();
    assert.strictEqual(vars.length, 2);
    assert.strictEqual(vars[0]?.name, "v_dc");
    assert.strictEqual(vars[0]?.causality, "input");
    assert.strictEqual(vars[0]?.type, "Real");
    assert.strictEqual(vars[0]?.start, 400.0);
    assert.strictEqual(vars[1]?.name, "i_ac");
    assert.strictEqual(vars[1]?.causality, "output");
  });
});

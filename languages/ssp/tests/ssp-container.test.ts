// SPDX-License-Identifier: AGPL-3.0-or-later

import { createZipArchive, defaultContainerToolkit, extractContainerArchive } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sspLanguage } from "../src/language.js";
import { sspToModelicaBlock } from "../src/projection.js";
import { parseSsd, parseSsv } from "../src/ssd-parser.js";

describe("@modelscript/ssp Language & Container Integration", () => {
  const ssdXml = `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"
                                xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"
                                name="DualDriveController"
                                version="1.0"
                                description="Closed loop dual-drive vehicle control system">
  <ssd:System name="DualDriveController">
    <ssd:Connectors>
      <ssd:Connector name="throttle_in" kind="input">
        <ssc:Real unit="percent" />
      </ssd:Connector>
      <ssd:Connector name="steering_in" kind="input">
        <ssc:Real unit="rad" />
      </ssd:Connector>
      <ssd:Connector name="torque_left_out" kind="output">
        <ssc:Real unit="N.m" />
      </ssd:Connector>
      <ssd:Connector name="torque_right_out" kind="output">
        <ssc:Real unit="N.m" />
      </ssd:Connector>
      <ssd:Connector name="gain" kind="parameter">
        <ssc:Real />
      </ssd:Connector>
    </ssd:Connectors>
    <ssd:Elements>
      <ssd:Component name="MotorLeft" source="resources/Motor.fmu">
        <ssd:Connectors>
          <ssd:Connector name="u" kind="input"><ssc:Real /></ssd:Connector>
          <ssd:Connector name="tau" kind="output"><ssc:Real /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
      <ssd:Component name="MotorRight" source="resources/Motor.fmu">
        <ssd:Connectors>
          <ssd:Connector name="u" kind="input"><ssc:Real /></ssd:Connector>
          <ssd:Connector name="tau" kind="output"><ssc:Real /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
    </ssd:Elements>
    <ssd:Connections>
      <ssd:Connection startElement="MotorLeft" startConnector="tau" endElement="DualDriveController" endConnector="torque_left_out" />
    </ssd:Connections>
  </ssd:System>
</ssd:SystemStructureDescription>`;

  const ssvXml = `<?xml version="1.0" encoding="UTF-8"?>
<ssv:ParameterSet xmlns:ssv="http://ssp-standard.org/SSP1/SystemStructureParameterValues"
                  version="1.0"
                  name="DefaultParams">
  <ssv:Parameters>
    <ssv:Parameter name="maxTorque">
      <ssv:Real value="350.0" />
    </ssv:Parameter>
    <ssv:Parameter name="enableRegen">
      <ssv:Boolean value="true" />
    </ssv:Parameter>
    <ssv:Parameter name="gearCount">
      <ssv:Integer value="2" />
    </ssv:Parameter>
  </ssv:Parameters>
</ssv:ParameterSet>`;

  it("parses SSD and SSV XML models accurately", () => {
    const system = parseSsd(ssdXml);
    assert.strictEqual(system.name, "DualDriveController");
    assert.strictEqual(system.version, "1.0");
    assert.strictEqual(system.description, "Closed loop dual-drive vehicle control system");
    assert.strictEqual(system.connectors?.length, 5);
    assert.strictEqual(system.components.length, 2);
    assert.strictEqual(system.connections.length, 1);

    const ssvParams = parseSsv(ssvXml);
    assert.strictEqual(ssvParams.length, 3);
    assert.strictEqual(ssvParams.find((p) => p.name === "maxTorque")?.value, 350.0);
    assert.strictEqual(ssvParams.find((p) => p.name === "enableRegen")?.value, true);
    assert.strictEqual(ssvParams.find((p) => p.name === "gearCount")?.value, 2);
  });

  it("projects SSP system to authentic Modelica block source code", () => {
    const modelicaCode = sspToModelicaBlock(ssdXml, { sspFilePath: "DualDrive.ssp" });
    assert.ok(modelicaCode.includes("block DualDriveController"));
    assert.ok(modelicaCode.includes('input Real throttle_in(unit="percent")'));
    assert.ok(modelicaCode.includes('input Real steering_in(unit="rad")'));
    assert.ok(modelicaCode.includes('output Real torque_left_out(unit="N.m")'));
    assert.ok(modelicaCode.includes('output Real torque_right_out(unit="N.m")'));
    assert.ok(modelicaCode.includes("parameter Real gain"));
    assert.ok(modelicaCode.includes('__modelscript_external(type="ssp", file="DualDrive.ssp")'));
    assert.ok(modelicaCode.includes("Icon(coordinateSystem"));
    assert.ok(modelicaCode.includes("end DualDriveController;"));
  });

  it("extracts and projects in-memory .ssp container using sspLanguage definition", async () => {
    const sspZip = createZipArchive({
      "SystemStructure.ssd": ssdXml,
      "resources/DefaultParams.ssv": ssvXml,
      "resources/Motor.fmu": new Uint8Array([1, 2, 3]),
    });

    assert.ok(sspLanguage.container);
    const result = await extractContainerArchive(sspZip, sspLanguage.container, defaultContainerToolkit);
    assert.ok(result);
    assert.strictEqual(result?.manifest?.path, "SystemStructure.ssd");
    assert.strictEqual(result?.entries?.length, 3);

    // Verify nested container action
    const fmuEntry = result?.entries?.find((e) => e.path === "resources/Motor.fmu");
    assert.strictEqual(fmuEntry?.action, "extract_nested");

    // Verify projection hook
    const projectedModelica = result?.project?.("modelica");
    assert.strictEqual(typeof projectedModelica, "string");
    assert.ok(projectedModelica?.includes("block DualDriveController"));
  });
});

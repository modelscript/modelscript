// SPDX-License-Identifier: AGPL-3.0-or-later

import { createZipArchive, defaultContainerToolkit, extractContainerArchive } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerSspToDae } from "../src/dae/ssp-to-dae.js";
import { sspLanguage } from "../src/language.js";
import { lintSsd } from "../src/linter.js";
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

  it("registers .ssm and .ssb file extensions in sspLanguage", () => {
    assert.ok(sspLanguage.fileExtensions.includes(".ssm"));
    assert.ok(sspLanguage.fileExtensions.includes(".ssb"));
    assert.ok(sspLanguage.lsp?.fileExtensions?.includes(".ssm"));
    assert.ok(sspLanguage.lsp?.fileExtensions?.includes(".ssb"));
  });

  it("lints default-namespace XML (without ssd:/ssc: prefixes), nested <System> elements, and S7014 algebraic loops", () => {
    const unprefixedHierarchicalXml = `<?xml version="1.0" encoding="UTF-8"?>
<SystemStructureDescription xmlns="http://ssp-standard.org/SSP1/SystemStructureDescription" name="RootVehicle" version="1.0">
  <System name="RootVehicle">
    <Elements>
      <Component name="Controller" source="resources/Controller.fmu">
        <Connectors>
          <Connector name="err_in" kind="input"><Real unit="rad/s" /></Connector>
          <Connector name="cmd_out" kind="output"><Real unit="rad/s" /></Connector>
        </Connectors>
      </Component>
      <Component name="Observer" source="resources/Observer.fmu">
        <Connectors>
          <Connector name="cmd_in" kind="input"><Real unit="rad/s" /></Connector>
          <Connector name="est_out" kind="output"><Real unit="rad/s" /></Connector>
        </Connectors>
      </Component>
      <System name="ActuatorSubsys">
        <Connectors>
          <Connector name="sub_in" kind="input"><Real /></Connector>
          <Connector name="sub_out" kind="output"><Real /></Connector>
        </Connectors>
        <Elements>
          <Component name="InnerDrive" source="resources/InnerDrive.fmu">
            <Connectors>
              <Connector name="u" kind="input"><Real /></Connector>
              <Connector name="y" kind="output"><Boolean /></Connector>
            </Connectors>
          </Component>
        </Elements>
        <Connections>
          <Connection startElement="InnerDrive" startConnector="y" endElement="ActuatorSubsys" endConnector="sub_out" />
        </Connections>
      </System>
    </Elements>
    <Connections>
      <Connection startElement="Controller" startConnector="cmd_out" endElement="Observer" endConnector="cmd_in" />
      <Connection startElement="Observer" startConnector="est_out" endElement="Controller" endConnector="err_in" />
    </Connections>
  </System>
</SystemStructureDescription>`;

    const diags = lintSsd(unprefixedHierarchicalXml);
    // 1. Nested <System> connection type mismatch (Boolean -> Real on 'sub_out')
    const nestedMismatch = diags.find((d) => d.code === "SSP_CONNECTOR_TYPE_MISMATCH");
    assert.ok(nestedMismatch, "Expected SSP_CONNECTOR_TYPE_MISMATCH inside nested <System>");
    assert.strictEqual(nestedMismatch.standardCode, "S7009");
    assert.strictEqual(
      unprefixedHierarchicalXml.slice(nestedMismatch.startOffset, nestedMismatch.endOffset),
      "sub_out",
    );

    // 2. Zero-delay algebraic feedthrough loop S7014 between Controller and Observer
    const loopDiag = diags.find((d) => d.standardCode === "S7014" || d.code === "SSP_ALGEBRAIC_FEEDTHROUGH_LOOP");
    assert.ok(loopDiag, "Expected S7014 SSP_ALGEBRAIC_FEEDTHROUGH_LOOP diagnostic");
    assert.strictEqual(loopDiag.numericCode, 7014);
    assert.strictEqual(unprefixedHierarchicalXml.slice(loopDiag.startOffset, loopDiag.endOffset), "err_in");
  });

  it("recursively flattens nested <ssd:System> hierarchies into a structurally square DAE (varCount === eqCount)", () => {
    const nestedSsd = `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"
                                xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"
                                name="HierarchicalDrive"
                                version="1.0">
  <ssd:System name="HierarchicalDrive">
    <ssd:Connectors>
      <ssd:Connector name="ref_in" kind="input"><ssc:Real /></ssd:Connector>
      <ssd:Connector name="speed_out" kind="output"><ssc:Real /></ssd:Connector>
    </ssd:Connectors>
    <ssd:Elements>
      <ssd:Component name="PreFilter" source="resources/PreFilter.fmu">
        <ssd:Connectors>
          <ssd:Connector name="u" kind="input"><ssc:Real /></ssd:Connector>
          <ssd:Connector name="y" kind="output"><ssc:Real /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
      <ssd:System name="PowerStage">
        <ssd:Connectors>
          <ssd:Connector name="cmd_in" kind="input"><ssc:Real /></ssd:Connector>
          <ssd:Connector name="omega_out" kind="output"><ssc:Real /></ssd:Connector>
        </ssd:Connectors>
        <ssd:Elements>
          <ssd:Component name="InverterMotor" source="resources/InverterMotor.fmu">
            <ssd:Connectors>
              <ssd:Connector name="v_in" kind="input"><ssc:Real /></ssd:Connector>
              <ssd:Connector name="w_out" kind="output"><ssc:Real /></ssd:Connector>
            </ssd:Connectors>
          </ssd:Component>
        </ssd:Elements>
        <ssd:Connections>
          <ssd:Connection startElement="PowerStage" startConnector="cmd_in" endElement="InverterMotor" endConnector="v_in" />
          <ssd:Connection startElement="InverterMotor" startConnector="w_out" endElement="PowerStage" endConnector="omega_out" />
        </ssd:Connections>
      </ssd:System>
    </ssd:Elements>
    <ssd:Connections>
      <ssd:Connection startElement="HierarchicalDrive" startConnector="ref_in" endElement="PreFilter" endConnector="u" />
      <ssd:Connection startElement="PreFilter" startConnector="y" endElement="PowerStage" endConnector="cmd_in" />
      <ssd:Connection startElement="PowerStage" startConnector="omega_out" endElement="HierarchicalDrive" endConnector="speed_out" />
    </ssd:Connections>
  </ssd:System>
</ssd:SystemStructureDescription>`;

    const parsed = parseSsd(nestedSsd);
    assert.strictEqual(parsed.systems?.length, 1);
    assert.strictEqual(parsed.elements?.systems.length, 1);
    assert.strictEqual(parsed.systems?.[0]?.name, "PowerStage");

    const dae = lowerSspToDae(parsed);
    // Verify nested subsystem component variables were flattened with hierarchical prefixes
    assert.notStrictEqual(dae.lookupVariable("PowerStage_cmd_in"), -1);
    assert.notStrictEqual(dae.lookupVariable("PowerStage_InverterMotor_v_in"), -1);
    assert.notStrictEqual(dae.lookupVariable("PowerStage_InverterMotor_w_out"), -1);
    // Verify square DAE (N_vars === N_eqs)
    assert.strictEqual(
      dae.varCount,
      dae.eqCount,
      `Expected square DAE, got ${dae.varCount} vars vs ${dae.eqCount} eqs`,
    );
  });
});

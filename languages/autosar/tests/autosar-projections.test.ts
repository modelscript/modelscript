// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileTGGRules } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArxml } from "../src/parser/index.js";
import { autosarToModelica, autosarToSysml } from "../src/projections/index.js";
import { autosarPolyglotConfig, autosarTggRules } from "../src/tgg/autosar-rules.js";
import { projectAutosarViaTgg, synchronizeSysmlToAutosar } from "../src/tgg/autosar-sync.js";

const SAMPLE_ARXML = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Chassis</SHORT-NAME>
      <ELEMENTS>
        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>SteeringSensor</SHORT-NAME>
          <PORTS>
            <P-PORT-PROTOTYPE>
              <SHORT-NAME>SteerAngleOut</SHORT-NAME>
              <PROVIDED-INTERFACE-TREF>/Chassis/SteerIf</PROVIDED-INTERFACE-TREF>
            </P-PORT-PROTOTYPE>
          </PORTS>
        </APPLICATION-SW-COMPONENT-TYPE>

        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>SteeringActuator</SHORT-NAME>
          <PORTS>
            <R-PORT-PROTOTYPE>
              <SHORT-NAME>SteerAngleIn</SHORT-NAME>
              <REQUIRED-INTERFACE-TREF>/Chassis/SteerIf</REQUIRED-INTERFACE-TREF>
            </R-PORT-PROTOTYPE>
          </PORTS>
        </APPLICATION-SW-COMPONENT-TYPE>

        <COMPOSITION-SW-COMPONENT-TYPE>
          <SHORT-NAME>SteeringComposition</SHORT-NAME>
          <COMPONENTS>
            <SW-COMPONENT-PROTOTYPE>
              <SHORT-NAME>Sensor</SHORT-NAME>
              <TYPE-TREF>/Chassis/SteeringSensor</TYPE-TREF>
            </SW-COMPONENT-PROTOTYPE>
            <SW-COMPONENT-PROTOTYPE>
              <SHORT-NAME>Actuator</SHORT-NAME>
              <TYPE-TREF>/Chassis/SteeringActuator</TYPE-TREF>
            </SW-COMPONENT-PROTOTYPE>
          </COMPONENTS>
          <CONNECTORS>
            <ASSEMBLY-SW-CONNECTOR>
              <SHORT-NAME>SteeringLink</SHORT-NAME>
              <PROVIDER-IREF>
                <CONTEXT-COMPONENT-REF>Sensor</CONTEXT-COMPONENT-REF>
                <TARGET-P-PORT-REF>SteerAngleOut</TARGET-P-PORT-REF>
              </PROVIDER-IREF>
              <REQUESTER-IREF>
                <CONTEXT-COMPONENT-REF>Actuator</CONTEXT-COMPONENT-REF>
                <TARGET-R-PORT-REF>SteerAngleIn</TARGET-R-PORT-REF>
              </REQUESTER-IREF>
            </ASSEMBLY-SW-CONNECTOR>
          </CONNECTORS>
        </COMPOSITION-SW-COMPONENT-TYPE>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;

describe("AUTOSAR Projections (@modelscript/autosar)", () => {
  it("should project AUTOSAR SWC architecture to Modelica standard blocks", () => {
    const model = parseArxml(SAMPLE_ARXML);
    const mo = autosarToModelica(model, "SteeringSystem");

    assert.ok(mo.includes("package SteeringSystem"));
    assert.ok(mo.includes("model SteeringSensor"));
    assert.ok(mo.includes("Modelica.Blocks.Interfaces.RealOutput SteerAngleOut"));
    assert.ok(mo.includes("model SteeringActuator"));
    assert.ok(mo.includes("Modelica.Blocks.Interfaces.RealInput SteerAngleIn"));
    assert.ok(mo.includes("model SteeringComposition"));
    assert.ok(mo.includes("connect(Sensor.SteerAngleOut, Actuator.SteerAngleIn)"));
  });

  it("should project AUTOSAR SWC architecture to SysML v2 part definitions", () => {
    const model = parseArxml(SAMPLE_ARXML);
    const sysml = autosarToSysml(model, "SteeringArchitecture");

    assert.ok(sysml.includes("package SteeringArchitecture {"));
    assert.ok(sysml.includes("part def SteeringSensor {"));
    assert.ok(sysml.includes("out port SteerAngleOut;"));
    assert.ok(sysml.includes("part def SteeringActuator {"));
    assert.ok(sysml.includes("in port SteerAngleIn;"));
    assert.ok(sysml.includes("part def SteeringComposition {"));
    assert.ok(sysml.includes("part Sensor : SteeringSensor;"));
    assert.ok(sysml.includes("connect Sensor.SteerAngleOut to Actuator.SteerAngleIn;"));
  });

  it("should project AUTOSAR SWC ports and runnables to SysML v2 part def with action", () => {
    const arxml = `<APPLICATION-SW-COMPONENT-TYPE>
  <SHORT-NAME>SteeringController</SHORT-NAME>
  <PORTS>
    <R-PORT-PROTOTYPE><SHORT-NAME>WheelAngleReq</SHORT-NAME></R-PORT-PROTOTYPE>
    <P-PORT-PROTOTYPE><SHORT-NAME>MotorTorqueCmd</SHORT-NAME></P-PORT-PROTOTYPE>
  </PORTS>
  <INTERNAL-BEHAVIORS>
    <SWC-INTERNAL-BEHAVIOR>
      <SHORT-NAME>Steering_IB</SHORT-NAME>
      <RUNNABLES>
        <RUNNABLE-ENTITY><SHORT-NAME>RE_ComputeTorque</SHORT-NAME></RUNNABLE-ENTITY>
      </RUNNABLES>
    </SWC-INTERNAL-BEHAVIOR>
  </INTERNAL-BEHAVIORS>
</APPLICATION-SW-COMPONENT-TYPE>`;
    const model = parseArxml(arxml);
    const sysml = autosarToSysml(model);
    assert.ok(sysml.includes("package AutosarArchitecture {"));
    assert.ok(sysml.includes("part def SteeringController {"));
    assert.ok(sysml.includes("in port WheelAngleReq;"));
    assert.ok(sysml.includes("out port MotorTorqueCmd;"));
    assert.ok(sysml.includes("action RE_ComputeTorque;"));
  });

  it("should compile declarative AUTOSAR TGG rules and round-trip SysML v2 edits back into ARXML", () => {
    assert.equal(autosarTggRules.length, 6);
    const compiled = compileTGGRules(autosarPolyglotConfig);
    assert.equal(compiled.ruleCount, 6);
    assert.ok(compiled.sourceCode.includes("tgg_forward_AutosarSwcToSysmlPartDef"));
    assert.ok(compiled.sourceCode.includes("tgg_backward_AutosarRunnableToSysmlAction"));
    assert.ok(compiled.sourceCode.includes("tgg_forward_AutosarClientServerPortToConjugatedPort"));

    const origArxml = `<APPLICATION-SW-COMPONENT-TYPE>
  <SHORT-NAME>SteeringController</SHORT-NAME>
  <PORTS>
    <R-PORT-PROTOTYPE>
      <SHORT-NAME>WheelAngleReq</SHORT-NAME>
      <REQUIRED-INTERFACE-TREF DEST="SENDER-RECEIVER-INTERFACE">/Interfaces/IF_WheelAngle</REQUIRED-INTERFACE-TREF>
    </R-PORT-PROTOTYPE>
    <P-PORT-PROTOTYPE><SHORT-NAME>MotorTorqueCmd</SHORT-NAME></P-PORT-PROTOTYPE>
  </PORTS>
  <INTERNAL-BEHAVIORS>
    <SWC-INTERNAL-BEHAVIOR>
      <SHORT-NAME>Steering_IB</SHORT-NAME>
      <RUNNABLES>
        <RUNNABLE-ENTITY>
          <SHORT-NAME>RE_ComputeTorque</SHORT-NAME>
          <SYMBOL>Steering_ComputeTorque_5ms</SYMBOL>
        </RUNNABLE-ENTITY>
      </RUNNABLES>
    </SWC-INTERNAL-BEHAVIOR>
  </INTERNAL-BEHAVIORS>
</APPLICATION-SW-COMPONENT-TYPE>`;

    const { sysmlText } = projectAutosarViaTgg(origArxml);
    const modifiedSysml = sysmlText
      .replace(
        "in port WheelAngleReq;",
        "/* port comment */ in port WheelAngleReq;\n    in port YawRateIn;\n    in port DiagClient : ~UdsDiagnosticService;",
      )
      .replace("action RE_ComputeTorque;", "action RE_ComputeTorque_5ms;");

    const syncRes = synchronizeSysmlToAutosar(origArxml, modifiedSysml);
    assert.ok(syncRes.updatedText.includes("<SHORT-NAME>Steering_IB</SHORT-NAME>"), "Must preserve IB shortName via shadow complement");
    assert.ok(syncRes.updatedText.includes("/Interfaces/IF_WheelAngle"));
    assert.ok(syncRes.updatedText.includes("<SYMBOL>Steering_ComputeTorque_5ms</SYMBOL>"));
    assert.ok(syncRes.updatedText.includes("<SHORT-NAME>YawRateIn</SHORT-NAME>"));
    assert.ok(
      syncRes.updatedText.includes(
        '<REQUIRED-INTERFACE-TREF DEST="CLIENT-SERVER-INTERFACE">/Interfaces/UdsDiagnosticService</REQUIRED-INTERFACE-TREF>',
      ),
    );
    assert.ok(syncRes.updatedText.includes("<SHORT-NAME>RE_ComputeTorque_5ms</SHORT-NAME>"));
  });
});

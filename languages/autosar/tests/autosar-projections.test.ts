// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArxml } from "../src/parser/index.js";
import { autosarToModelica, autosarToSysml } from "../src/projections/index.js";

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
});

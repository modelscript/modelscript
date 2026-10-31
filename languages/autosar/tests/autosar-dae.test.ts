// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerAutosarToDae } from "../src/dae/index.js";
import { parseArxml } from "../src/parser/index.js";

const POWERTRAIN_ARXML = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Powertrain</SHORT-NAME>
      <ELEMENTS>
        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>PedalSensor</SHORT-NAME>
          <PORTS>
            <P-PORT-PROTOTYPE>
              <SHORT-NAME>PedalOut</SHORT-NAME>
              <PROVIDED-INTERFACE-TREF>/Powertrain/PedalIf</PROVIDED-INTERFACE-TREF>
            </P-PORT-PROTOTYPE>
          </PORTS>
        </APPLICATION-SW-COMPONENT-TYPE>

        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>EngineController</SHORT-NAME>
          <PORTS>
            <R-PORT-PROTOTYPE>
              <SHORT-NAME>PedalIn</SHORT-NAME>
              <REQUIRED-INTERFACE-TREF>/Powertrain/PedalIf</REQUIRED-INTERFACE-TREF>
            </R-PORT-PROTOTYPE>
            <P-PORT-PROTOTYPE>
              <SHORT-NAME>ThrottleOut</SHORT-NAME>
              <PROVIDED-INTERFACE-TREF>/Powertrain/ThrottleIf</PROVIDED-INTERFACE-TREF>
            </P-PORT-PROTOTYPE>
          </PORTS>
          <INTERNAL-BEHAVIORS>
            <SWC-INTERNAL-BEHAVIOR>
              <SHORT-NAME>Engine_IB</SHORT-NAME>
              <RUNNABLES>
                <RUNNABLE-ENTITY>
                  <SHORT-NAME>RE_Calc</SHORT-NAME>
                  <DATA-READ-ACCESSS>
                    <VARIABLE-ACCESS>
                      <PORT-PROTOTYPE-REF>PedalIn</PORT-PROTOTYPE-REF>
                      <TARGET-DATA-PROTOTYPE-REF>Val</TARGET-DATA-PROTOTYPE-REF>
                    </VARIABLE-ACCESS>
                  </DATA-READ-ACCESSS>
                  <DATA-WRITE-ACCESSS>
                    <VARIABLE-ACCESS>
                      <PORT-PROTOTYPE-REF>ThrottleOut</PORT-PROTOTYPE-REF>
                      <TARGET-DATA-PROTOTYPE-REF>Val</TARGET-DATA-PROTOTYPE-REF>
                    </VARIABLE-ACCESS>
                  </DATA-WRITE-ACCESSS>
                </RUNNABLE-ENTITY>
              </RUNNABLES>
            </SWC-INTERNAL-BEHAVIOR>
          </INTERNAL-BEHAVIORS>
        </APPLICATION-SW-COMPONENT-TYPE>

        <COMPOSITION-SW-COMPONENT-TYPE>
          <SHORT-NAME>PowertrainComposition</SHORT-NAME>
          <COMPONENTS>
            <SW-COMPONENT-PROTOTYPE>
              <SHORT-NAME>Pedal</SHORT-NAME>
              <TYPE-TREF>/Powertrain/PedalSensor</TYPE-TREF>
            </SW-COMPONENT-PROTOTYPE>
            <SW-COMPONENT-PROTOTYPE>
              <SHORT-NAME>Engine</SHORT-NAME>
              <TYPE-TREF>/Powertrain/EngineController</TYPE-TREF>
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

describe("AUTOSAR DAE Arena Lowering (@modelscript/autosar)", () => {
  it("should lower SWC ports, connectors, and vehicle plant dynamics into DAE arena", () => {
    const model = parseArxml(POWERTRAIN_ARXML);
    const dae = lowerAutosarToDae(model, { includePlantModel: true });

    // Validate variables were emitted in linear memory arena and DAE is structurally square
    assert.ok(dae.varCount >= 5);
    assert.ok(dae.eqCount >= 3);
    assert.equal(dae.varCount, dae.eqCount, "AUTOSAR DAE lowering must be structurally square");

    // Check variable names
    const varNames: string[] = [];
    for (let i = 0; i < dae.varCount; i++) {
      varNames.push(dae.getVarName(i));
    }

    assert.ok(varNames.includes("PedalSensor_PedalOut"));
    assert.ok(varNames.includes("EngineController_PedalIn"));
    assert.ok(varNames.includes("EngineController_ThrottleOut"));
    assert.ok(varNames.includes("vehicle_speed"));
    assert.ok(varNames.includes("engine_torque"));
  });
});

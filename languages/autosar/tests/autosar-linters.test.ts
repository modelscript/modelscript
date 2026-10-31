// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintAutosarModel } from "../src/lints/rules.js";
import { parseArxml } from "../src/parser/index.js";

describe("AUTOSAR Pre-Flight Automotive Linter (M7401–M7410)", () => {
  it("M7401: should report unconnected R-ports in composition", () => {
    const arxml = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Sys</SHORT-NAME>
      <ELEMENTS>
        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>BrakeController</SHORT-NAME>
          <PORTS>
            <R-PORT-PROTOTYPE>
              <SHORT-NAME>PressureIn</SHORT-NAME>
              <REQUIRED-INTERFACE-TREF>/Sys/PressureIf</REQUIRED-INTERFACE-TREF>
            </R-PORT-PROTOTYPE>
          </PORTS>
        </APPLICATION-SW-COMPONENT-TYPE>

        <COMPOSITION-SW-COMPONENT-TYPE>
          <SHORT-NAME>ChassisComposition</SHORT-NAME>
          <COMPONENTS>
            <SW-COMPONENT-PROTOTYPE>
              <SHORT-NAME>Brake</SHORT-NAME>
              <TYPE-TREF>/Sys/BrakeController</TYPE-TREF>
            </SW-COMPONENT-PROTOTYPE>
          </COMPONENTS>
        </COMPOSITION-SW-COMPONENT-TYPE>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;
    const model = parseArxml(arxml);
    const diags = lintAutosarModel(model);
    assert.ok(diags.some((d) => d.code === "M7401"));
    assert.ok(diags.some((d) => d.message.includes("Required port 'PressureIn' on component 'Brake'")));
  });

  it("M7402: should detect interface mismatch across assembly connector", () => {
    const arxml = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Sys</SHORT-NAME>
      <ELEMENTS>
        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>SensorSWC</SHORT-NAME>
          <PORTS>
            <P-PORT-PROTOTYPE>
              <SHORT-NAME>SpeedOut</SHORT-NAME>
              <PROVIDED-INTERFACE-TREF>/Sys/SpeedIf</PROVIDED-INTERFACE-TREF>
            </P-PORT-PROTOTYPE>
          </PORTS>
        </APPLICATION-SW-COMPONENT-TYPE>

        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>ActuatorSWC</SHORT-NAME>
          <PORTS>
            <R-PORT-PROTOTYPE>
              <SHORT-NAME>PressureIn</SHORT-NAME>
              <REQUIRED-INTERFACE-TREF>/Sys/PressureIf</REQUIRED-INTERFACE-TREF>
            </R-PORT-PROTOTYPE>
          </PORTS>
        </APPLICATION-SW-COMPONENT-TYPE>

        <COMPOSITION-SW-COMPONENT-TYPE>
          <SHORT-NAME>VehicleComposition</SHORT-NAME>
          <COMPONENTS>
            <SW-COMPONENT-PROTOTYPE>
              <SHORT-NAME>Sensor</SHORT-NAME>
              <TYPE-TREF>/Sys/SensorSWC</TYPE-TREF>
            </SW-COMPONENT-PROTOTYPE>
            <SW-COMPONENT-PROTOTYPE>
              <SHORT-NAME>Actuator</SHORT-NAME>
              <TYPE-TREF>/Sys/ActuatorSWC</TYPE-TREF>
            </SW-COMPONENT-PROTOTYPE>
          </COMPONENTS>
          <CONNECTORS>
            <ASSEMBLY-SW-CONNECTOR>
              <SHORT-NAME>BadConn</SHORT-NAME>
              <PROVIDER-IREF>
                <CONTEXT-COMPONENT-REF>Sensor</CONTEXT-COMPONENT-REF>
                <TARGET-P-PORT-REF>SpeedOut</TARGET-P-PORT-REF>
              </PROVIDER-IREF>
              <REQUESTER-IREF>
                <CONTEXT-COMPONENT-REF>Actuator</CONTEXT-COMPONENT-REF>
                <TARGET-R-PORT-REF>PressureIn</TARGET-R-PORT-REF>
              </REQUESTER-IREF>
            </ASSEMBLY-SW-CONNECTOR>
          </CONNECTORS>
        </COMPOSITION-SW-COMPONENT-TYPE>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;
    const model = parseArxml(arxml);
    const diags = lintAutosarModel(model);
    assert.ok(diags.some((d) => d.code === "M7402"));
    assert.ok(diags.some((d) => d.message.includes("Interface mismatch in connector 'BadConn'")));
  });

  it("M7405: should detect WCET budget overflow", () => {
    const arxml = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Sys</SHORT-NAME>
      <ELEMENTS>
        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>SlowSWC</SHORT-NAME>
          <INTERNAL-BEHAVIORS>
            <SWC-INTERNAL-BEHAVIOR>
              <SHORT-NAME>Slow_IB</SHORT-NAME>
              <RUNNABLES>
                <RUNNABLE-ENTITY>
                  <SHORT-NAME>RE_HeavyCompute</SHORT-NAME>
                  <EXECUTION-TIME-WCET>0.025</EXECUTION-TIME-WCET>
                </RUNNABLE-ENTITY>
              </RUNNABLES>
              <EVENTS>
                <TIMING-EVENT>
                  <SHORT-NAME>TE_10ms</SHORT-NAME>
                  <START-ON-EVENT-REF>RE_HeavyCompute</START-ON-EVENT-REF>
                  <PERIOD>0.010</PERIOD>
                </TIMING-EVENT>
              </EVENTS>
            </SWC-INTERNAL-BEHAVIOR>
          </INTERNAL-BEHAVIORS>
        </APPLICATION-SW-COMPONENT-TYPE>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;
    const model = parseArxml(arxml);
    const diags = lintAutosarModel(model);
    assert.ok(diags.some((d) => d.code === "M7405"));
    assert.ok(
      diags.some((d) =>
        d.message.includes("WCET (25.0 ms) of runnable 'RE_HeavyCompute' exceeds its timing event period (10.0 ms)"),
      ),
    );
  });

  it("M7406: should report overlapping PDU bit allocations", () => {
    const arxml = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Com</SHORT-NAME>
      <ELEMENTS>
        <I-SIGNAL-I-PDU>
          <SHORT-NAME>CollisionPdu</SHORT-NAME>
          <LENGTH>8</LENGTH>
          <I-SIGNAL-TO-PDU-MAPPINGS>
            <I-SIGNAL-TO-I-PDU-MAPPING>
              <SHORT-NAME>Sig1</SHORT-NAME>
              <START-POSITION>0</START-POSITION>
              <LENGTH>16</LENGTH>
              <I-SIGNAL-REF>SignalA</I-SIGNAL-REF>
            </I-SIGNAL-TO-I-PDU-MAPPING>
            <I-SIGNAL-TO-I-PDU-MAPPING>
              <SHORT-NAME>Sig2</SHORT-NAME>
              <START-POSITION>8</START-POSITION>
              <LENGTH>16</LENGTH>
              <I-SIGNAL-REF>SignalB</I-SIGNAL-REF>
            </I-SIGNAL-TO-I-PDU-MAPPING>
          </I-SIGNAL-TO-PDU-MAPPINGS>
        </I-SIGNAL-I-PDU>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;
    const model = parseArxml(arxml);
    const diags = lintAutosarModel(model);
    assert.ok(diags.some((d) => d.code === "M7406"));
    assert.ok(diags.some((d) => d.message.includes("overlap bit index 8")));
  });

  it("M7406: should detect Motorola big-endian (MOST-SIGNIFICANT-BYTE-FIRST) sawtooth bit overlap across byte boundaries", () => {
    const arxml = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Com</SHORT-NAME>
      <ELEMENTS>
        <I-SIGNAL-I-PDU>
          <SHORT-NAME>MotorolaPdu</SHORT-NAME>
          <LENGTH>8</LENGTH>
          <I-SIGNAL-TO-PDU-MAPPINGS>
            <I-SIGNAL-TO-I-PDU-MAPPING>
              <SHORT-NAME>SigA_Map</SHORT-NAME>
              <START-POSITION>3</START-POSITION>
              <LENGTH>8</LENGTH>
              <PACKING-BYTE-ORDER>MOST-SIGNIFICANT-BYTE-FIRST</PACKING-BYTE-ORDER>
              <I-SIGNAL-REF>SignalA</I-SIGNAL-REF>
            </I-SIGNAL-TO-I-PDU-MAPPING>
            <I-SIGNAL-TO-I-PDU-MAPPING>
              <SHORT-NAME>SigB_Map</SHORT-NAME>
              <START-POSITION>15</START-POSITION>
              <LENGTH>4</LENGTH>
              <PACKING-BYTE-ORDER>MOST-SIGNIFICANT-BYTE-FIRST</PACKING-BYTE-ORDER>
              <I-SIGNAL-REF>SignalB</I-SIGNAL-REF>
            </I-SIGNAL-TO-I-PDU-MAPPING>
          </I-SIGNAL-TO-PDU-MAPPINGS>
        </I-SIGNAL-I-PDU>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;
    const model = parseArxml(arxml);
    const diags = lintAutosarModel(model);
    // SignalA starts at bit 3 (MSB-first sawtooth: 3, 2, 1, 0, then jumps +15 to 15, 14, 13, 12)
    // SignalB starts at bit 15, overlapping at bit index 15
    assert.ok(diags.some((d) => d.code === "M7406" && d.message.includes("overlap bit index 15")));
  });

  it("M7407: should report PDU length exceeding CAN frame capacity", () => {
    const arxml = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Com</SHORT-NAME>
      <ELEMENTS>
        <I-SIGNAL-I-PDU>
          <SHORT-NAME>HugePdu</SHORT-NAME>
          <LENGTH>16</LENGTH>
        </I-SIGNAL-I-PDU>
        <CAN-FRAME>
          <SHORT-NAME>ClassicCanFrame</SHORT-NAME>
          <FRAME-LENGTH>8</FRAME-LENGTH>
          <PDU-TO-FRAME-MAPPINGS>
            <PDU-TO-FRAME-MAPPING>
              <PDU-REF>HugePdu</PDU-REF>
            </PDU-TO-FRAME-MAPPING>
          </PDU-TO-FRAME-MAPPINGS>
        </CAN-FRAME>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;
    const model = parseArxml(arxml);
    const diags = lintAutosarModel(model);
    assert.ok(diags.some((d) => d.code === "M7407"));
    assert.ok(diags.some((d) => d.message.includes("exceeds CAN frame 'ClassicCanFrame' payload capacity (8 bytes)")));
  });

  it("M7408: should detect cyclic runnable dependencies", () => {
    const arxml = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Sys</SHORT-NAME>
      <ELEMENTS>
        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>CyclicSWC</SHORT-NAME>
          <INTERNAL-BEHAVIORS>
            <SWC-INTERNAL-BEHAVIOR>
              <SHORT-NAME>Cyclic_IB</SHORT-NAME>
              <RUNNABLES>
                <RUNNABLE-ENTITY>
                  <SHORT-NAME>RunnableA</SHORT-NAME>
                  <DATA-READ-ACCESSS>
                    <VARIABLE-ACCESS>
                      <PORT-PROTOTYPE-REF>PortB</PORT-PROTOTYPE-REF>
                      <TARGET-DATA-PROTOTYPE-REF>ValB</TARGET-DATA-PROTOTYPE-REF>
                    </VARIABLE-ACCESS>
                  </DATA-READ-ACCESSS>
                  <DATA-WRITE-ACCESSS>
                    <VARIABLE-ACCESS>
                      <PORT-PROTOTYPE-REF>PortA</PORT-PROTOTYPE-REF>
                      <TARGET-DATA-PROTOTYPE-REF>ValA</TARGET-DATA-PROTOTYPE-REF>
                    </VARIABLE-ACCESS>
                  </DATA-WRITE-ACCESSS>
                </RUNNABLE-ENTITY>
                <RUNNABLE-ENTITY>
                  <SHORT-NAME>RunnableB</SHORT-NAME>
                  <DATA-READ-ACCESSS>
                    <VARIABLE-ACCESS>
                      <PORT-PROTOTYPE-REF>PortA</PORT-PROTOTYPE-REF>
                      <TARGET-DATA-PROTOTYPE-REF>ValA</TARGET-DATA-PROTOTYPE-REF>
                    </VARIABLE-ACCESS>
                  </DATA-READ-ACCESSS>
                  <DATA-WRITE-ACCESSS>
                    <VARIABLE-ACCESS>
                      <PORT-PROTOTYPE-REF>PortB</PORT-PROTOTYPE-REF>
                      <TARGET-DATA-PROTOTYPE-REF>ValB</TARGET-DATA-PROTOTYPE-REF>
                    </VARIABLE-ACCESS>
                  </DATA-WRITE-ACCESSS>
                </RUNNABLE-ENTITY>
              </RUNNABLES>
              <EVENTS>
                <TIMING-EVENT>
                  <SHORT-NAME>TE_A</SHORT-NAME>
                  <START-ON-EVENT-REF>RunnableA</START-ON-EVENT-REF>
                  <PERIOD>0.01</PERIOD>
                </TIMING-EVENT>
                <TIMING-EVENT>
                  <SHORT-NAME>TE_B</SHORT-NAME>
                  <START-ON-EVENT-REF>RunnableB</START-ON-EVENT-REF>
                  <PERIOD>0.01</PERIOD>
                </TIMING-EVENT>
              </EVENTS>
            </SWC-INTERNAL-BEHAVIOR>
          </INTERNAL-BEHAVIORS>
        </APPLICATION-SW-COMPONENT-TYPE>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;
    const model = parseArxml(arxml);
    const diags = lintAutosarModel(model);
    assert.ok(diags.some((d) => d.code === "M7408"));
    assert.ok(diags.some((d) => d.message.includes("Cyclic data dependency detected between runnables")));
  });
});

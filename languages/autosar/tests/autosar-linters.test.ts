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

  it("M7411: should report timing event with non-positive period", () => {
    const arxml = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Sys</SHORT-NAME>
      <ELEMENTS>
        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>InvalidTimerSWC</SHORT-NAME>
          <INTERNAL-BEHAVIORS>
            <SWC-INTERNAL-BEHAVIOR>
              <SHORT-NAME>IB_Timer</SHORT-NAME>
              <RUNNABLES>
                <RUNNABLE-ENTITY>
                  <SHORT-NAME>RE_Step</SHORT-NAME>
                </RUNNABLE-ENTITY>
              </RUNNABLES>
              <EVENTS>
                <TIMING-EVENT>
                  <SHORT-NAME>TE_Zero</SHORT-NAME>
                  <START-ON-EVENT-REF>RE_Step</START-ON-EVENT-REF>
                  <PERIOD>-0.005</PERIOD>
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
    assert.ok(diags.some((d) => d.code === "M7411"));
    assert.ok(diags.some((d) => d.message.includes("defines non-positive period (-0.005 s)")));
  });

  it("M7412: should detect invalid data type mapping in DATA-TYPE-MAPPING-SET", () => {
    const arxml = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>DataTypes</SHORT-NAME>
      <ELEMENTS>
        <DATA-TYPE-MAPPING-SET>
          <SHORT-NAME>VehicleTypeMappings</SHORT-NAME>
          <DATA-TYPE-MAPS>
            <DATA-TYPE-MAP>
              <APPLICATION-DATA-TYPE-REF>/DataTypes/AppVehicleSpeed</APPLICATION-DATA-TYPE-REF>
            </DATA-TYPE-MAP>
          </DATA-TYPE-MAPS>
        </DATA-TYPE-MAPPING-SET>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;
    const model = parseArxml(arxml);
    const diags = lintAutosarModel(model);
    assert.ok(diags.some((d) => d.code === "M7412"));
    assert.ok(diags.some((d) => d.message.includes("Invalid data type mapping for 'AppVehicleSpeed'")));
  });

  it("M7413: should detect circular composition dependencies", () => {
    const arxml = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Sys</SHORT-NAME>
      <ELEMENTS>
        <COMPOSITION-SW-COMPONENT-TYPE>
          <SHORT-NAME>CompA</SHORT-NAME>
          <COMPONENTS>
            <SW-COMPONENT-PROTOTYPE>
              <SHORT-NAME>SubB</SHORT-NAME>
              <TYPE-TREF>/Sys/CompB</TYPE-TREF>
            </SW-COMPONENT-PROTOTYPE>
          </COMPONENTS>
        </COMPOSITION-SW-COMPONENT-TYPE>
        <COMPOSITION-SW-COMPONENT-TYPE>
          <SHORT-NAME>CompB</SHORT-NAME>
          <COMPONENTS>
            <SW-COMPONENT-PROTOTYPE>
              <SHORT-NAME>SubA</SHORT-NAME>
              <TYPE-TREF>/Sys/CompA</TYPE-TREF>
            </SW-COMPONENT-PROTOTYPE>
          </COMPONENTS>
        </COMPOSITION-SW-COMPONENT-TYPE>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;
    const model = parseArxml(arxml);
    const diags = lintAutosarModel(model);
    assert.ok(diags.some((d) => d.code === "M7413"));
    assert.ok(diags.some((d) => d.message.includes("CompA -> CompB -> CompA")));
  });

  it("M7414: should warn when variable data prototype SW-DATA-DEF-PROPS lacks SW-ADDR-METHOD-REF", () => {
    const arxml = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>IfPkg</SHORT-NAME>
      <ELEMENTS>
        <SENDER-RECEIVER-INTERFACE>
          <SHORT-NAME>TorqueIf</SHORT-NAME>
          <DATA-ELEMENTS>
            <VARIABLE-DATA-PROTOTYPE>
              <SHORT-NAME>RequestedTorque</SHORT-NAME>
              <SW-DATA-DEF-PROPS>
                <SW-DATA-DEF-PROPS-VARIANTS>
                  <SW-DATA-DEF-PROPS-CONDITIONAL />
                </SW-DATA-DEF-PROPS-VARIANTS>
              </SW-DATA-DEF-PROPS>
              <TYPE-TREF>/DataTypes/Float32</TYPE-TREF>
            </VARIABLE-DATA-PROTOTYPE>
          </DATA-ELEMENTS>
        </SENDER-RECEIVER-INTERFACE>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;
    const model = parseArxml(arxml);
    const diags = lintAutosarModel(model);
    assert.ok(diags.some((d) => d.code === "M7414"));
    assert.ok(diags.some((d) => d.message.includes("Variable data prototype 'RequestedTorque' lacks a declared SwAddrMethod")));
  });

  it("M7415: should report incompatible port interface direction violations", () => {
    const arxml = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Sys</SHORT-NAME>
      <ELEMENTS>
        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>BadPortSWC</SHORT-NAME>
          <PORTS>
            <P-PORT-PROTOTYPE>
              <SHORT-NAME>WrongPPort</SHORT-NAME>
              <REQUIRED-INTERFACE-TREF>/Sys/SensorIf</REQUIRED-INTERFACE-TREF>
            </P-PORT-PROTOTYPE>
          </PORTS>
          <INTERNAL-BEHAVIORS>
            <SWC-INTERNAL-BEHAVIOR>
              <SHORT-NAME>BadPort_IB</SHORT-NAME>
              <RUNNABLES>
                <RUNNABLE-ENTITY>
                  <SHORT-NAME>RE_Main</SHORT-NAME>
                </RUNNABLE-ENTITY>
              </RUNNABLES>
              <EVENTS>
                <INIT-EVENT>
                  <SHORT-NAME>IE_Main</SHORT-NAME>
                  <START-ON-EVENT-REF>RE_Main</START-ON-EVENT-REF>
                </INIT-EVENT>
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
    assert.ok(diags.some((d) => d.code === "M7415"));
    assert.ok(diags.some((d) => d.message.includes("Port 'WrongPPort' interface direction violation")));
  });
});

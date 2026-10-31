// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArxml } from "../src/parser/index.js";
import { VirtualRte } from "../src/rte/index.js";

const CONTROLLER_ARXML = `<?xml version="1.0" encoding="UTF-8"?>
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
                  <SHORT-NAME>RE_ComputeThrottle</SHORT-NAME>
                  <DATA-READ-ACCESSS>
                    <VARIABLE-ACCESS>
                      <PORT-PROTOTYPE-REF>PedalIn</PORT-PROTOTYPE-REF>
                      <TARGET-DATA-PROTOTYPE-REF>Pos</TARGET-DATA-PROTOTYPE-REF>
                    </VARIABLE-ACCESS>
                  </DATA-READ-ACCESSS>
                  <DATA-WRITE-ACCESSS>
                    <VARIABLE-ACCESS>
                      <PORT-PROTOTYPE-REF>ThrottleOut</PORT-PROTOTYPE-REF>
                      <TARGET-DATA-PROTOTYPE-REF>Cmd</TARGET-DATA-PROTOTYPE-REF>
                    </VARIABLE-ACCESS>
                  </DATA-WRITE-ACCESSS>
                </RUNNABLE-ENTITY>
              </RUNNABLES>
              <EVENTS>
                <TIMING-EVENT>
                  <SHORT-NAME>TE_20ms</SHORT-NAME>
                  <START-ON-EVENT-REF>RE_ComputeThrottle</START-ON-EVENT-REF>
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

describe("AUTOSAR Virtual RTE (@modelscript/autosar)", () => {
  it("should schedule periodic runnables and route signals across connectors", () => {
    const model = parseArxml(CONTROLLER_ARXML);
    const rte = new VirtualRte(model);

    // Register pedal runnable logic: produce pedal ramp 0.5
    rte.registerRunnable("PedalSensor", "RE_ReadPedal", (ctx) => {
      ctx.write("PedalOut", "Pos", 0.75);
    });

    // Register engine runnable logic: throttle = pedal * 0.9
    rte.registerRunnable("EngineECU", "RE_ComputeThrottle", (ctx) => {
      const pedal = Number(ctx.read("PedalIn", "Pos"));
      ctx.write("ThrottleOut", "Cmd", pedal * 0.9);
    });

    // Simulate 50 ms (0.05 s) at dt = 10 ms (0.01 s)
    const log = rte.runUntil(0.05, 0.01);

    assert.ok(log.length >= 4);

    // Verify pedal was written
    const pedalSig = rte.getSignal("PedalOut", "Pos", "PedalSensor");
    assert.equal(pedalSig, 0.75);

    // Verify routed signal to engine R-port
    const routedPedal = rte.getSignal("PedalIn", "Pos", "EngineECU");
    assert.equal(routedPedal, 0.75);

    // Verify engine computed throttle
    const throttleSig = rte.getSignal("ThrottleOut", "Cmd", "EngineECU");
    assert.equal(throttleSig, 0.75 * 0.9);
  });

  it("should trigger DATA-RECEIVED-EVENT runnables and route across DELEGATION-SW-CONNECTOR", () => {
    const arxml = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Chassis</SHORT-NAME>
      <ELEMENTS>
        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>WheelSpeedSensor</SHORT-NAME>
          <PORTS>
            <P-PORT-PROTOTYPE>
              <SHORT-NAME>SpeedOut</SHORT-NAME>
              <PROVIDED-INTERFACE-TREF>/Chassis/SpeedIf</PROVIDED-INTERFACE-TREF>
            </P-PORT-PROTOTYPE>
          </PORTS>
          <INTERNAL-BEHAVIORS>
            <SWC-INTERNAL-BEHAVIOR>
              <SHORT-NAME>Sensor_IB</SHORT-NAME>
              <RUNNABLES>
                <RUNNABLE-ENTITY>
                  <SHORT-NAME>RE_SampleWheel</SHORT-NAME>
                  <DATA-READ-ACCESSS/>
                  <DATA-WRITE-ACCESSS>
                    <VARIABLE-ACCESS>
                      <PORT-PROTOTYPE-REF>SpeedOut</PORT-PROTOTYPE-REF>
                      <TARGET-DATA-PROTOTYPE-REF>Rpm</TARGET-DATA-PROTOTYPE-REF>
                    </VARIABLE-ACCESS>
                  </DATA-WRITE-ACCESSS>
                </RUNNABLE-ENTITY>
              </RUNNABLES>
              <EVENTS>
                <TIMING-EVENT>
                  <SHORT-NAME>TE_10ms</SHORT-NAME>
                  <START-ON-EVENT-REF>RE_SampleWheel</START-ON-EVENT-REF>
                  <PERIOD>0.010</PERIOD>
                </TIMING-EVENT>
              </EVENTS>
            </SWC-INTERNAL-BEHAVIOR>
          </INTERNAL-BEHAVIORS>
        </APPLICATION-SW-COMPONENT-TYPE>

        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>AbsController</SHORT-NAME>
          <PORTS>
            <R-PORT-PROTOTYPE>
              <SHORT-NAME>SpeedIn</SHORT-NAME>
              <REQUIRED-INTERFACE-TREF>/Chassis/SpeedIf</REQUIRED-INTERFACE-TREF>
            </R-PORT-PROTOTYPE>
            <P-PORT-PROTOTYPE>
              <SHORT-NAME>BrakeValveOut</SHORT-NAME>
              <PROVIDED-INTERFACE-TREF>/Chassis/BrakeIf</PROVIDED-INTERFACE-TREF>
            </P-PORT-PROTOTYPE>
          </PORTS>
          <INTERNAL-BEHAVIORS>
            <SWC-INTERNAL-BEHAVIOR>
              <SHORT-NAME>Abs_IB</SHORT-NAME>
              <RUNNABLES>
                <RUNNABLE-ENTITY>
                  <SHORT-NAME>RE_OnSpeedReceived</SHORT-NAME>
                  <DATA-READ-ACCESSS>
                    <VARIABLE-ACCESS>
                      <PORT-PROTOTYPE-REF>SpeedIn</PORT-PROTOTYPE-REF>
                      <TARGET-DATA-PROTOTYPE-REF>Rpm</TARGET-DATA-PROTOTYPE-REF>
                    </VARIABLE-ACCESS>
                  </DATA-READ-ACCESSS>
                  <DATA-WRITE-ACCESSS>
                    <VARIABLE-ACCESS>
                      <PORT-PROTOTYPE-REF>BrakeValveOut</PORT-PROTOTYPE-REF>
                      <TARGET-DATA-PROTOTYPE-REF>Pressure</TARGET-DATA-PROTOTYPE-REF>
                    </VARIABLE-ACCESS>
                  </DATA-WRITE-ACCESSS>
                </RUNNABLE-ENTITY>
              </RUNNABLES>
              <EVENTS>
                <DATA-RECEIVED-EVENT>
                  <SHORT-NAME>DRE_Speed</SHORT-NAME>
                  <START-ON-EVENT-REF>RE_OnSpeedReceived</START-ON-EVENT-REF>
                  <DATA-IREF>
                    <PORT-PROTOTYPE-REF>SpeedIn</PORT-PROTOTYPE-REF>
                    <TARGET-DATA-PROTOTYPE-REF>Rpm</TARGET-DATA-PROTOTYPE-REF>
                  </DATA-IREF>
                </DATA-RECEIVED-EVENT>
              </EVENTS>
            </SWC-INTERNAL-BEHAVIOR>
          </INTERNAL-BEHAVIORS>
        </APPLICATION-SW-COMPONENT-TYPE>

        <COMPOSITION-SW-COMPONENT-TYPE>
          <SHORT-NAME>AbsSubsystem</SHORT-NAME>
          <PORTS>
            <P-PORT-PROTOTYPE>
              <SHORT-NAME>SubsystemBrakeOut</SHORT-NAME>
              <PROVIDED-INTERFACE-TREF>/Chassis/BrakeIf</PROVIDED-INTERFACE-TREF>
            </P-PORT-PROTOTYPE>
          </PORTS>
          <COMPONENTS>
            <SW-COMPONENT-PROTOTYPE>
              <SHORT-NAME>Wheel</SHORT-NAME>
              <TYPE-TREF>/Chassis/WheelSpeedSensor</TYPE-TREF>
            </SW-COMPONENT-PROTOTYPE>
            <SW-COMPONENT-PROTOTYPE>
              <SHORT-NAME>Abs</SHORT-NAME>
              <TYPE-TREF>/Chassis/AbsController</TYPE-TREF>
            </SW-COMPONENT-PROTOTYPE>
          </COMPONENTS>
          <CONNECTORS>
            <ASSEMBLY-SW-CONNECTOR>
              <SHORT-NAME>Conn_Wheel_Abs</SHORT-NAME>
              <PROVIDER-IREF>
                <CONTEXT-COMPONENT-REF>Wheel</CONTEXT-COMPONENT-REF>
                <TARGET-P-PORT-REF>SpeedOut</TARGET-P-PORT-REF>
              </PROVIDER-IREF>
              <REQUESTER-IREF>
                <CONTEXT-COMPONENT-REF>Abs</CONTEXT-COMPONENT-REF>
                <TARGET-R-PORT-REF>SpeedIn</TARGET-R-PORT-REF>
              </REQUESTER-IREF>
            </ASSEMBLY-SW-CONNECTOR>
            <DELEGATION-SW-CONNECTOR>
              <SHORT-NAME>Del_BrakeOut</SHORT-NAME>
              <INNER-PORT-IREF>
                <CONTEXT-COMPONENT-REF>Abs</CONTEXT-COMPONENT-REF>
                <TARGET-P-PORT-REF>BrakeValveOut</TARGET-P-PORT-REF>
              </INNER-PORT-IREF>
              <OUTER-PORT-REF>SubsystemBrakeOut</OUTER-PORT-REF>
            </DELEGATION-SW-CONNECTOR>
          </CONNECTORS>
        </COMPOSITION-SW-COMPONENT-TYPE>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;

    const model = parseArxml(arxml);
    const rte = new VirtualRte(model);

    rte.registerRunnable("WheelSpeedSensor", "RE_SampleWheel", (ctx) => {
      ctx.write("SpeedOut", "Rpm", 1200);
    });

    rte.registerRunnable("AbsController", "RE_OnSpeedReceived", (ctx) => {
      const rpm = Number(ctx.read("SpeedIn", "Rpm"));
      ctx.write("BrakeValveOut", "Pressure", rpm * 0.05);
    });

    const log = rte.runUntil(0.02, 0.01);

    // Verify DATA-RECEIVED-EVENT triggered RE_OnSpeedReceived
    assert.ok(
      log.some((entry) => entry.runnable === "RE_OnSpeedReceived" && entry.eventType === "DATA-RECEIVED-EVENT"),
    );

    // Verify DELEGATION-SW-CONNECTOR routed BrakeValveOut -> SubsystemBrakeOut on AbsSubsystem
    assert.equal(rte.getSignal("SubsystemBrakeOut", "Pressure", "AbsSubsystem"), 60);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArxml } from "../src/parser/index.js";

const SAMPLE_ARXML = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0">
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Powertrain</SHORT-NAME>
      <ELEMENTS>
        <SENDER-RECEIVER-INTERFACE>
          <SHORT-NAME>ThrottleIf</SHORT-NAME>
          <DATA-ELEMENTS>
            <VARIABLE-DATA-PROTOTYPE>
              <SHORT-NAME>Position</SHORT-NAME>
              <TYPE-TREF>/DataTypes/float32</TYPE-TREF>
              <INIT-VALUE>0.0</INIT-VALUE>
            </VARIABLE-DATA-PROTOTYPE>
          </DATA-ELEMENTS>
        </SENDER-RECEIVER-INTERFACE>

        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>EngineController</SHORT-NAME>
          <PORTS>
            <P-PORT-PROTOTYPE>
              <SHORT-NAME>ThrottleOut</SHORT-NAME>
              <PROVIDED-INTERFACE-TREF>/Powertrain/ThrottleIf</PROVIDED-INTERFACE-TREF>
            </P-PORT-PROTOTYPE>
            <R-PORT-PROTOTYPE>
              <SHORT-NAME>PedalIn</SHORT-NAME>
              <REQUIRED-INTERFACE-TREF>/Powertrain/ThrottleIf</REQUIRED-INTERFACE-TREF>
            </R-PORT-PROTOTYPE>
          </PORTS>
          <INTERNAL-BEHAVIORS>
            <SWC-INTERNAL-BEHAVIOR>
              <SHORT-NAME>EngineController_IB</SHORT-NAME>
              <RUNNABLES>
                <RUNNABLE-ENTITY>
                  <SHORT-NAME>RE_CalcThrottle</SHORT-NAME>
                  <SYMBOL>CalcThrottle</SYMBOL>
                  <EXECUTION-TIME-WCET>0.002</EXECUTION-TIME-WCET>
                  <CAN-BE-INVOKED-CONCURRENTLY>false</CAN-BE-INVOKED-CONCURRENTLY>
                  <DATA-READ-ACCESSS>
                    <VARIABLE-ACCESS>
                      <SHORT-NAME>DRA_Pedal</SHORT-NAME>
                      <PORT-PROTOTYPE-REF>/Powertrain/EngineController/PedalIn</PORT-PROTOTYPE-REF>
                      <TARGET-DATA-PROTOTYPE-REF>/Powertrain/ThrottleIf/Position</TARGET-DATA-PROTOTYPE-REF>
                    </VARIABLE-ACCESS>
                  </DATA-READ-ACCESSS>
                  <DATA-WRITE-ACCESSS>
                    <VARIABLE-ACCESS>
                      <SHORT-NAME>DWA_Throttle</SHORT-NAME>
                      <PORT-PROTOTYPE-REF>/Powertrain/EngineController/ThrottleOut</PORT-PROTOTYPE-REF>
                      <TARGET-DATA-PROTOTYPE-REF>/Powertrain/ThrottleIf/Position</TARGET-DATA-PROTOTYPE-REF>
                    </VARIABLE-ACCESS>
                  </DATA-WRITE-ACCESSS>
                </RUNNABLE-ENTITY>
              </RUNNABLES>
              <EVENTS>
                <TIMING-EVENT>
                  <SHORT-NAME>TE_10ms</SHORT-NAME>
                  <START-ON-EVENT-REF>/Powertrain/EngineController/EngineController_IB/RE_CalcThrottle</START-ON-EVENT-REF>
                  <PERIOD>0.01</PERIOD>
                </TIMING-EVENT>
              </EVENTS>
            </SWC-INTERNAL-BEHAVIOR>
          </INTERNAL-BEHAVIORS>
        </APPLICATION-SW-COMPONENT-TYPE>

        <I-SIGNAL-I-PDU>
          <SHORT-NAME>EnginePdu</SHORT-NAME>
          <LENGTH>8</LENGTH>
          <I-SIGNAL-TO-PDU-MAPPINGS>
            <I-SIGNAL-TO-I-PDU-MAPPING>
              <SHORT-NAME>ThrottleSigMap</SHORT-NAME>
              <START-POSITION>0</START-POSITION>
              <LENGTH>16</LENGTH>
              <PACKING-BYTE-ORDER>MOST-SIGNIFICANT-BYTE-FIRST</PACKING-BYTE-ORDER>
              <I-SIGNAL-REF>/Powertrain/ThrottleSignal</I-SIGNAL-REF>
            </I-SIGNAL-TO-I-PDU-MAPPING>
          </I-SIGNAL-TO-PDU-MAPPINGS>
        </I-SIGNAL-I-PDU>

        <CAN-FRAME>
          <SHORT-NAME>EngineFrame</SHORT-NAME>
          <FRAME-ID>256</FRAME-ID>
          <FRAME-LENGTH>8</FRAME-LENGTH>
          <PDU-TO-FRAME-MAPPINGS>
            <PDU-TO-FRAME-MAPPING>
              <PDU-REF>/Powertrain/EnginePdu</PDU-REF>
            </PDU-TO-FRAME-MAPPING>
          </PDU-TO-FRAME-MAPPINGS>
        </CAN-FRAME>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;

describe("AUTOSAR ARXML Parser (@modelscript/autosar)", () => {
  it("should parse ARXML packages, SWCs, ports, internal behaviors, and signals", () => {
    const model = parseArxml(SAMPLE_ARXML);

    assert.equal(model.packages.size, 1);
    assert.ok(model.packages.has("Powertrain"));

    // Verify Interfaces
    assert.ok(model.interfaces.has("ThrottleIf"));
    const iface = model.interfaces.get("ThrottleIf")!;
    assert.equal(iface.dataElements?.length, 1);
    assert.equal(iface.dataElements?.[0]?.shortName, "Position");
    assert.equal(iface.dataElements?.[0]?.initValue, 0.0);

    // Verify SWC
    assert.ok(model.components.has("EngineController"));
    const swc = model.components.get("EngineController")!;
    assert.equal(swc.kind, "APPLICATION-SW-COMPONENT-TYPE");
    assert.equal(swc.ports.size, 2);
    assert.equal(swc.ports.get("ThrottleOut")?.direction, "provided");
    assert.equal(swc.ports.get("PedalIn")?.direction, "required");

    // Verify Internal Behavior & Runnables
    assert.ok(swc.internalBehavior);
    assert.equal(swc.internalBehavior?.runnables.size, 1);
    const runnable = swc.internalBehavior?.runnables.get("RE_CalcThrottle");
    assert.ok(runnable);
    assert.equal(runnable?.symbol, "CalcThrottle");
    assert.equal(runnable?.executionTimeWcet, 0.002);
    assert.equal(runnable?.dataReadAccess.length, 1);
    assert.equal(runnable?.dataReadAccess[0]?.port, "PedalIn");
    assert.equal(runnable?.dataWriteAccess.length, 1);
    assert.equal(runnable?.dataWriteAccess[0]?.port, "ThrottleOut");

    // Verify Events
    assert.equal(swc.internalBehavior?.events.length, 1);
    const event = swc.internalBehavior?.events[0];
    assert.equal(event?.kind, "TIMING-EVENT");
    assert.equal(event?.period, 0.01);
    assert.equal(event?.startOnEventRef, "RE_CalcThrottle");

    // Verify PDUs and CAN Frames
    assert.ok(model.pdus.has("EnginePdu"));
    const pdu = model.pdus.get("EnginePdu")!;
    assert.equal(pdu.byteLength, 8);
    assert.equal(pdu.signals.length, 1);
    assert.equal(pdu.signals[0]?.startBit, 0);
    assert.equal(pdu.signals[0]?.length, 16);

    assert.ok(model.frames.has("EngineFrame"));
    const frame = model.frames.get("EngineFrame")!;
    assert.equal(frame.frameId, 256);
    assert.equal(frame.length, 8);
    assert.equal(frame.pduRef, "EnginePdu");
  });
});

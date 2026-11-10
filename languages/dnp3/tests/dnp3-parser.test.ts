// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDnp3, parseDnp3Json, parseDnp3Xml } from "../src/parser/dnp3-parser.js";

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DNP3DeviceProfile xmlns="http://www.dnp.org/DNP3/DeviceProfile/2010" id="SUB_RTU_01">
  <DeviceIdentity>
    <Vendor>Schweitzer Engineering Laboratories</Vendor>
    <DeviceName>SEL-3530 Real-Time Automation Controller</DeviceName>
    <Version>3.2.1</Version>
  </DeviceIdentity>
  <CommunicationSettings>
    <OutstationAddress>102</OutstationAddress>
    <MasterAddress>1</MasterAddress>
  </CommunicationSettings>
  <DNP3PointList>
    <BinaryInputs>
      <BinaryInput index="0" name="CB_52_STATUS" class="1" normalState="0"/>
      <BinaryInput index="1" name="PUMP_1_RUNNING" class="1" normalState="0"/>
      <BinaryInput index="2" name="HIGH_LEVEL_ALARM" class="1" normalState="0"/>
    </BinaryInputs>
    <BinaryOutputs>
      <BinaryOutput index="0" name="CB_52_TRIP"/>
      <BinaryOutput index="1" name="CB_52_CLOSE"/>
    </BinaryOutputs>
    <AnalogInputs>
      <AnalogInput index="0" name="BUS_VOLTAGE_KV" class="2" deadband="0.5" mult="0.001" offset="0.0" units="kV" min="0" max="500"/>
      <AnalogInput index="1" name="PUMP_DISCHARGE_PSI" class="2" deadband="2.0" mult="0.1" offset="14.7" units="psi" min="0" max="250"/>
    </AnalogInputs>
    <AnalogOutputs>
      <AnalogOutput index="0" name="VFD_SPEED_TARGET" units="RPM" min="0" max="3600"/>
    </AnalogOutputs>
    <Counters>
      <Counter index="0" name="TOTAL_ENERGY_KWH" class="1" units="kWh"/>
    </Counters>
  </DNP3PointList>
</DNP3DeviceProfile>`;

const SAMPLE_JSON = JSON.stringify({
  id: "WATER_PLC_01",
  deviceName: "Water Booster Pump RTU",
  vendor: "Siemens",
  version: "2.0",
  outstationAddress: 200,
  masterAddress: 5,
  binaryInputs: [{ index: 0, name: "VALVE_OPEN", eventClass: 1, normalState: 1 }],
  binaryOutputs: [{ index: 0, name: "OPEN_VALVE" }],
  analogInputs: [
    {
      index: 0,
      name: "TANK_LEVEL_M",
      eventClass: 2,
      deadband: 0.1,
      scalingMultiplier: 0.01,
      scalingOffset: 0.0,
      units: "m",
    },
  ],
  analogOutputs: [],
  counters: [{ index: 0, name: "FLOW_TOTAL_M3", eventClass: 1, units: "m3" }],
});

describe("IEEE 1815 / DNP3 SCADA Parser", () => {
  it("parses IEEE 1815 XML Device Profile", () => {
    const profile = parseDnp3Xml(SAMPLE_XML);
    assert.equal(profile.deviceName, "SEL-3530 Real-Time Automation Controller");
    assert.equal(profile.vendor, "Schweitzer Engineering Laboratories");
    assert.equal(profile.outstationAddress, 102);
    assert.equal(profile.masterAddress, 1);

    assert.equal(profile.binaryInputs.length, 3);
    assert.equal(profile.binaryInputs[0]!.name, "CB_52_STATUS");
    assert.equal(profile.binaryInputs[0]!.eventClass, 1);

    assert.equal(profile.binaryOutputs.length, 2);
    assert.equal(profile.binaryOutputs[0]!.name, "CB_52_TRIP");

    assert.equal(profile.analogInputs.length, 2);
    const ai0 = profile.analogInputs[0]!;
    assert.equal(ai0.name, "BUS_VOLTAGE_KV");
    assert.equal(ai0.deadband, 0.5);
    assert.equal(ai0.scalingMultiplier, 0.001);
    assert.equal(ai0.units, "kV");
    assert.equal(ai0.maxVal, 500);

    const ai1 = profile.analogInputs[1]!;
    assert.equal(ai1.name, "PUMP_DISCHARGE_PSI");
    assert.equal(ai1.scalingOffset, 14.7);

    assert.equal(profile.analogOutputs.length, 1);
    assert.equal(profile.counters.length, 1);
    assert.equal(profile.counters[0]!.units, "kWh");
  });

  it("parses JSON DNP3 SCADA point configuration", () => {
    const profile = parseDnp3Json(SAMPLE_JSON);
    assert.equal(profile.deviceName, "Water Booster Pump RTU");
    assert.equal(profile.outstationAddress, 200);
    assert.equal(profile.binaryInputs.length, 1);
    assert.equal(profile.analogInputs.length, 1);
    assert.equal(profile.analogInputs[0]!.units, "m");
    assert.equal(profile.counters.length, 1);
  });

  it("auto-detects XML vs JSON in unified parseDnp3 function", () => {
    const pXml = parseDnp3(SAMPLE_XML);
    const pJson = parseDnp3(SAMPLE_JSON);
    assert.equal(pXml.binaryInputs.length, 3);
    assert.equal(pJson.binaryInputs.length, 1);
  });
});

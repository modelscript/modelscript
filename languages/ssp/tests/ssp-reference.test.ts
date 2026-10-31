// SPDX-License-Identifier: AGPL-3.0-or-later

import { createZipArchive, defaultContainerToolkit, extractContainerArchive } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sspLanguage } from "../src/language.js";
import { lintSsd } from "../src/linter.js";
import { sspToModelicaBlock } from "../src/projection.js";
import { parseSsd, parseSsv } from "../src/ssd-parser.js";

describe("languages/ssp: Modelica Association Official Reference Architectures", () => {
  describe("1. QuarterTruck Automotive Suspension Benchmark", () => {
    // Official Modelica Association SSP 1.0 QuarterTruck System Structure
    const quarterTruckSsd = `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"
                                xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"
                                name="QuarterTruck"
                                version="1.0"
                                description="Modelica Association Quarter-Truck Suspension Co-Simulation Benchmark">
  <ssd:System name="QuarterTruck">
    <ssd:Connectors>
      <ssd:Connector name="road_profile" kind="input">
        <ssc:Real unit="m" />
      </ssd:Connector>
      <ssd:Connector name="chassis_accel" kind="output">
        <ssc:Real unit="m/s2" />
      </ssd:Connector>
      <ssd:Connector name="suspension_deflection" kind="output">
        <ssc:Real unit="m" />
      </ssd:Connector>
    </ssd:Connectors>
    <ssd:Elements>
      <ssd:Component name="Chassis" source="resources/Chassis.fmu">
        <ssd:Connectors>
          <ssd:Connector name="f_suspension" kind="input"><ssc:Real unit="N" /></ssd:Connector>
          <ssd:Connector name="z_chassis" kind="output"><ssc:Real unit="m" /></ssd:Connector>
          <ssd:Connector name="a_chassis" kind="output"><ssc:Real unit="m/s2" /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
      <ssd:Component name="Suspension" source="resources/Suspension.fmu">
        <ssd:Connectors>
          <ssd:Connector name="z_chassis" kind="input"><ssc:Real unit="m" /></ssd:Connector>
          <ssd:Connector name="z_wheel" kind="input"><ssc:Real unit="m" /></ssd:Connector>
          <ssd:Connector name="f_suspension" kind="output"><ssc:Real unit="N" /></ssd:Connector>
          <ssd:Connector name="deflection" kind="output"><ssc:Real unit="m" /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
      <ssd:Component name="Wheel" source="resources/Wheel.fmu">
        <ssd:Connectors>
          <ssd:Connector name="f_suspension" kind="input"><ssc:Real unit="N" /></ssd:Connector>
          <ssd:Connector name="road_profile" kind="input"><ssc:Real unit="m" /></ssd:Connector>
          <ssd:Connector name="z_wheel" kind="output"><ssc:Real unit="m" /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
    </ssd:Elements>
    <ssd:Connections>
      <!-- Road input to Wheel -->
      <ssd:Connection startElement="QuarterTruck" startConnector="road_profile" endElement="Wheel" endConnector="road_profile" />
      <!-- Closed Loop: Chassis <-> Suspension -->
      <ssd:Connection startElement="Chassis" startConnector="z_chassis" endElement="Suspension" endConnector="z_chassis" />
      <ssd:Connection startElement="Suspension" startConnector="f_suspension" endElement="Chassis" endConnector="f_suspension" />
      <!-- Closed Loop: Wheel <-> Suspension -->
      <ssd:Connection startElement="Wheel" startConnector="z_wheel" endElement="Suspension" endConnector="z_wheel" />
      <!-- Outputs to System Boundaries -->
      <ssd:Connection startElement="Chassis" startConnector="a_chassis" endElement="QuarterTruck" endConnector="chassis_accel" />
      <ssd:Connection startElement="Suspension" startConnector="deflection" endElement="QuarterTruck" endConnector="suspension_deflection" />
    </ssd:Connections>
  </ssd:System>
</ssd:SystemStructureDescription>`;

    const quarterTruckSsv = `<?xml version="1.0" encoding="UTF-8"?>
<ssv:ParameterSet xmlns:ssv="http://ssp-standard.org/SSP1/SystemStructureParameterValues"
                  version="1.0"
                  name="QuarterTruckParameters">
  <ssv:Parameters>
    <ssv:Parameter name="chassis_mass"><ssv:Real value="450.0" unit="kg" /></ssv:Parameter>
    <ssv:Parameter name="wheel_mass"><ssv:Real value="40.0" unit="kg" /></ssv:Parameter>
    <ssv:Parameter name="spring_stiffness"><ssv:Real value="28000.0" unit="N/m" /></ssv:Parameter>
    <ssv:Parameter name="damper_rate"><ssv:Real value="1800.0" unit="N.s/m" /></ssv:Parameter>
    <ssv:Parameter name="tire_stiffness"><ssv:Real value="190000.0" unit="N/m" /></ssv:Parameter>
  </ssv:Parameters>
</ssv:ParameterSet>`;

    it("parses QuarterTruck topology and validates port interfaces", () => {
      const system = parseSsd(quarterTruckSsd);
      assert.equal(system.name, "QuarterTruck");
      assert.equal(system.components.length, 3);
      assert.equal(system.connectors?.length, 3);
      assert.equal(system.connections.length, 6);

      const params = parseSsv(quarterTruckSsv);
      assert.equal(params.length, 5);
      const chassisMass = params.find((p) => p.name === "chassis_mass");
      assert.equal(chassisMass?.value, 450.0);
    });

    it("passes semantic linter with zero errors on QuarterTruck", () => {
      const diags = lintSsd(quarterTruckSsd);
      assert.equal(diags.length, 0, `Expected clean lint, got: ${JSON.stringify(diags)}`);
    });

    it("projects QuarterTruck to valid Modelica hierarchical co-simulation block", () => {
      const mo = sspToModelicaBlock(quarterTruckSsd, { sspFilePath: "QuarterTruck.ssp" });
      assert.ok(mo.includes("block QuarterTruck"));
      assert.ok(mo.includes('input Real road_profile(unit="m")'));
      assert.ok(mo.includes('output Real chassis_accel(unit="m/s2")'));
      assert.ok(mo.includes('output Real suspension_deflection(unit="m")'));
      assert.ok(mo.includes('__modelscript_external(type="ssp", file="QuarterTruck.ssp")'));
    });
  });

  describe("2. ControlledTemperature Thermal Management Benchmark", () => {
    const thermalSsd = `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"
                                xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"
                                name="ControlledTemperature"
                                version="1.0"
                                description="Modelica Association Closed-Loop Thermal Co-Simulation Reference">
  <ssd:System name="ControlledTemperature">
    <ssd:Connectors>
      <ssd:Connector name="T_ambient" kind="input"><ssc:Real unit="K" /></ssd:Connector>
      <ssd:Connector name="T_setpoint" kind="input"><ssc:Real unit="K" /></ssd:Connector>
      <ssd:Connector name="T_room" kind="output"><ssc:Real unit="K" /></ssd:Connector>
      <ssd:Connector name="heating_power" kind="output"><ssc:Real unit="W" /></ssd:Connector>
    </ssd:Connectors>
    <ssd:Elements>
      <ssd:Component name="Thermostat" source="resources/Thermostat.fmu">
        <ssd:Connectors>
          <ssd:Connector name="T_set" kind="input"><ssc:Real unit="K" /></ssd:Connector>
          <ssd:Connector name="T_meas" kind="input"><ssc:Real unit="K" /></ssd:Connector>
          <ssd:Connector name="heat_cmd" kind="output"><ssc:Boolean /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
      <ssd:Component name="Heater" source="resources/Heater.fmu">
        <ssd:Connectors>
          <ssd:Connector name="on_off" kind="input"><ssc:Boolean /></ssd:Connector>
          <ssd:Connector name="Q_flow" kind="output"><ssc:Real unit="W" /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
      <ssd:Component name="Room" source="resources/Room.fmu">
        <ssd:Connectors>
          <ssd:Connector name="Q_in" kind="input"><ssc:Real unit="W" /></ssd:Connector>
          <ssd:Connector name="T_ext" kind="input"><ssc:Real unit="K" /></ssd:Connector>
          <ssd:Connector name="T_air" kind="output"><ssc:Real unit="K" /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
    </ssd:Elements>
    <ssd:Connections>
      <ssd:Connection startElement="ControlledTemperature" startConnector="T_setpoint" endElement="Thermostat" endConnector="T_set" />
      <ssd:Connection startElement="ControlledTemperature" startConnector="T_ambient" endElement="Room" endConnector="T_ext" />
      <ssd:Connection startElement="Thermostat" startConnector="heat_cmd" endElement="Heater" endConnector="on_off" />
      <ssd:Connection startElement="Heater" startConnector="Q_flow" endElement="Room" endConnector="Q_in" />
      <ssd:Connection startElement="Room" startConnector="T_air" endElement="Thermostat" endConnector="T_meas" />
      <ssd:Connection startElement="Room" startConnector="T_air" endElement="ControlledTemperature" endConnector="T_room" />
      <ssd:Connection startElement="Heater" startConnector="Q_flow" endElement="ControlledTemperature" endConnector="heating_power" />
    </ssd:Connections>
  </ssd:System>
</ssd:SystemStructureDescription>`;

    it("parses ControlledTemperature and verifies 7 topological co-simulation channels", () => {
      const system = parseSsd(thermalSsd);
      assert.equal(system.name, "ControlledTemperature");
      assert.equal(system.components.length, 3);
      assert.equal(system.connections.length, 7);

      const diags = lintSsd(thermalSsd);
      assert.equal(diags.length, 0);
    });

    it("packs ControlledTemperature into in-memory .ssp archive and verifies container extraction", async () => {
      const sspBytes = createZipArchive({
        "SystemStructure.ssd": thermalSsd,
        "resources/Thermostat.fmu": new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        "resources/Heater.fmu": new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        "resources/Room.fmu": new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      });

      assert.ok(sspLanguage.container, "sspLanguage.container must exist");
      const result = await extractContainerArchive(sspBytes, sspLanguage.container, defaultContainerToolkit);

      assert.ok(result);
      assert.equal(result.manifest?.path, "SystemStructure.ssd");
      assert.equal(result.entries?.length, 4);

      const mo = result.project?.("modelica");
      assert.ok(mo?.includes("block ControlledTemperature"));
      assert.ok(mo?.includes('output Real heating_power(unit="W")'));
    });
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseSspArchive } from "@modelscript/exchange";
import assert from "node:assert";
import { describe, it } from "node:test";
import { SysML2ContainerExporter } from "../src/sysml2-container-exporter.js";

describe("SysML v2 Multi-Physics Container Exporter (SSP & FMI 3.0)", () => {
  const droneSysml = `
    package DroneArchitecture {
      part def Motor {
        attribute kv : Real = 920.0;
        port powerIn : ElectricPort;
        port torqueOut : RotationalFlange;
      }
      part def Battery {
        attribute voltage : Real = 14.8;
        attribute capacity : Real = 5000.0;
        port powerOut : ~ElectricPort;
      }
      part def FlightController {
        port sensorIn : SensorPort;
        port cmdOut : ControlPort;
      }
      part def AutonomousDrone {
        part battery : Battery {
          attribute voltage = 14.8;
        };
        part motor1 : Motor {
          attribute kv = 920.0;
        };
        part motor2 : Motor {
          attribute kv = 920.0;
        };
        part fc : FlightController;

        port telemetry : TelemetryPort;

        connection connect battery.powerOut to motor1.powerIn;
        connection connect battery.powerOut to motor2.powerIn;
        connection connect fc.cmdOut to motor1.powerIn;
      }
    }
  `;

  it("exports multi-part SysML v2 architecture to an SSP (.ssp) container", async () => {
    const sspResult = await SysML2ContainerExporter.exportToSsp(droneSysml, {
      version: "1.0",
      description: "Autonomous Drone Multi-Physics Co-Simulation Package",
      startTime: 0.0,
      stopTime: 5.0,
      stepSize: 0.001,
    });

    assert(sspResult.archive, "SSP archive should be generated");
    assert(sspResult.archive.length > 0, "SSP archive should be non-empty");
    assert.strictEqual(sspResult.fmuCount, 4, "Should bundle 4 subsystem FMUs (battery, motor1, motor2, fc)");
    assert.deepStrictEqual(sspResult.fmuNames.sort(), ["battery.fmu", "fc.fmu", "motor1.fmu", "motor2.fmu"]);

    // Verify SspSystem structure
    assert.strictEqual(sspResult.system.name, "AutonomousDrone");
    assert.strictEqual(sspResult.system.components.length, 4);
    assert.strictEqual(sspResult.system.connections.length, 3);
    assert.strictEqual(sspResult.system.connectors?.length, 1);
    assert.strictEqual(sspResult.system.connectors?.[0]?.name, "telemetry");

    // Verify parameter bindings
    assert(sspResult.system.parameterBindings.length >= 3);
    const batteryBinding = sspResult.system.parameterBindings.find((pb) => pb.prefix === "battery");
    assert(batteryBinding, "Battery parameter binding should exist");
    assert.strictEqual(batteryBinding.values.find((v) => v.name === "voltage")?.value, 14.8);

    // Round-trip verification: parse archive using parseSspArchive
    const parsedMeta = parseSspArchive(new Uint8Array(sspResult.archive));
    assert(parsedMeta, "parseSspArchive should successfully parse the generated .ssp");
    assert.strictEqual(parsedMeta.systemName, "AutonomousDrone");
    assert.strictEqual(parsedMeta.componentNames.length, 4);
    assert(parsedMeta.componentNames.includes("battery"));
    assert(parsedMeta.componentNames.includes("motor1"));
    assert(parsedMeta.componentNames.includes("motor2"));
    assert(parsedMeta.componentNames.includes("fc"));
    assert(parsedMeta.variables.some((v) => v.name === "telemetry"));
  });

  it("exports SysML v2 architecture to a monolithic FMI 3.0 FMU with Terminals & Icons", async () => {
    const fmuResult = await SysML2ContainerExporter.exportToFmi3(droneSysml, {
      fmiVersion: "3",
      includeSources: true,
      includeWasm: true,
      startTime: 0,
      stopTime: 10,
    });

    assert(fmuResult.archive, "FMU archive should be generated");
    assert(fmuResult.archive.length > 0, "FMU archive should be non-empty");

    // Check files inside the archive
    assert(fmuResult.files.includes("modelDescription.xml"), "Archive must contain modelDescription.xml");
    assert(
      fmuResult.files.includes("terminalsAndIcons/terminalsAndIcons.xml"),
      "Archive must contain terminalsAndIcons/terminalsAndIcons.xml layered standard",
    );
    assert(fmuResult.files.includes("resources/model.json"), "Archive must contain resources/model.json");

    // Check FMI 3.0 XML
    assert(
      fmuResult.fmuResult.modelDescriptionXml.includes('fmiVersion="3.0"'),
      "modelDescription.xml should declare fmiVersion 3.0",
    );

    // Check Terminals
    const terminals = fmuResult.fmuResult.fmi3Result?.terminals;
    assert(terminals && terminals.length > 0, "FMI 3.0 terminals must be present");
    assert(
      terminals.some((t) => t.name === "telemetry"),
      "Terminals should contain top-level port 'telemetry'",
    );
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CoSimSession } from "../src/cosim/session.js";
import type { FmuStorage, StoredFmu } from "../src/fmu/storage.js";
import { parseSspArchive } from "../src/ssp/archive.js";
import { exportSsp, exportSspFromSystem, generateSsdFromSystem, generateSsv } from "../src/ssp/export.js";
import { importSsp } from "../src/ssp/import.js";
import { parseSsd, parseSsv } from "../src/ssp/ssd-parser.js";
import type { SspParameterValue, SspSystem } from "../src/ssp/types.js";

describe("SSP (System Structure and Parameterization) Engine Unit Tests", () => {
  const sampleSystem: SspSystem = {
    name: "DualDriveVehicle",
    description: "Electric vehicle powertrain with battery and dual motor drives",
    version: "1.0",
    connectors: [
      { name: "speed_cmd", kind: "input", type: "Real", unit: "m/s" },
      { name: "battery_soc", kind: "output", type: "Real", unit: "1" },
    ],
    components: [
      {
        name: "batteryPack",
        type: "application/x-fmu-sharedlibrary",
        source: "resources/battery.fmu",
        connectors: [
          { name: "current_draw", kind: "input", type: "Real", unit: "A" },
          { name: "terminal_voltage", kind: "output", type: "Real", unit: "V" },
          { name: "soc", kind: "output", type: "Real", unit: "1" },
          { name: "is_overheated", kind: "output", type: "Boolean" },
        ],
      },
      {
        name: "inverterDrive",
        type: "application/x-fmu-sharedlibrary",
        source: "resources/inverter.fmu",
        connectors: [
          { name: "v_dc", kind: "input", type: "Real", unit: "V" },
          { name: "throttle", kind: "input", type: "Real", unit: "1" },
          { name: "motor_torque", kind: "output", type: "Real", unit: "N.m" },
          { name: "i_dc", kind: "output", type: "Real", unit: "A" },
          { name: "gear_mode", kind: "input", type: "Integer" },
        ],
      },
    ],
    connections: [
      {
        startElement: "batteryPack",
        startConnector: "terminal_voltage",
        endElement: "inverterDrive",
        endConnector: "v_dc",
      },
      {
        startElement: "inverterDrive",
        startConnector: "i_dc",
        endElement: "batteryPack",
        endConnector: "current_draw",
      },
    ],
    parameterBindings: [
      {
        prefix: "batteryPack",
        source: "resources/battery_params.ssv",
        values: [
          { name: "nominal_capacity", type: "Real", value: 75.0 },
          { name: "cell_count", type: "Integer", value: 96 },
          { name: "chemistry", type: "String", value: "NMC811" },
          { name: "preheating_enabled", type: "Boolean", value: true },
        ],
      },
    ],
    defaultExperiment: {
      startTime: 0.0,
      stopTime: 60.0,
    },
  };

  describe("SSD and SSV XML Generation & Parsing", () => {
    it("generates SystemStructure.ssd XML and parses it back with exact fidelity", () => {
      const ssdXml = generateSsdFromSystem(sampleSystem);
      assert.ok(ssdXml.includes("<ssd:SystemStructureDescription"));
      assert.ok(ssdXml.includes('name="DualDriveVehicle"'));
      assert.ok(ssdXml.includes('version="1.0"'));
      assert.ok(ssdXml.includes('<ssd:Component name="batteryPack"'));
      assert.ok(ssdXml.includes('<ssd:Component name="inverterDrive"'));
      assert.ok(ssdXml.includes('<ssd:Connection startElement="batteryPack" startConnector="terminal_voltage"'));

      const parsed = parseSsd(ssdXml);
      assert.strictEqual(parsed.name, "DualDriveVehicle");
      assert.strictEqual(parsed.version, "1.0");
      assert.strictEqual(parsed.description, "Electric vehicle powertrain with battery and dual motor drives");
      assert.strictEqual(parsed.components.length, 2);

      const bat = parsed.components.find((c) => c.name === "batteryPack");
      assert.ok(bat);
      assert.strictEqual(bat.source, "resources/battery.fmu");
      assert.strictEqual(bat.connectors.length, 4);
      assert.strictEqual(bat.connectors[0].name, "current_draw");
      assert.strictEqual(bat.connectors[0].kind, "input");
      assert.strictEqual(bat.connectors[0].type, "Real");
      assert.strictEqual(bat.connectors[0].unit, "A");
      assert.strictEqual(bat.connectors[3].name, "is_overheated");
      assert.strictEqual(bat.connectors[3].type, "Boolean");

      assert.strictEqual(parsed.connections.length, 2);
      assert.strictEqual(parsed.connections[0].startElement, "batteryPack");
      assert.strictEqual(parsed.connections[0].startConnector, "terminal_voltage");
      assert.strictEqual(parsed.connections[0].endElement, "inverterDrive");
      assert.strictEqual(parsed.connections[0].endConnector, "v_dc");

      assert.ok(parsed.defaultExperiment);
      assert.strictEqual(parsed.defaultExperiment.startTime, 0.0);
      assert.strictEqual(parsed.defaultExperiment.stopTime, 60.0);
    });

    it("generates SSV XML and parses Real, Integer, Boolean, String parameters", () => {
      const params: SspParameterValue[] = [
        { name: "damping_ratio", type: "Real", value: 0.707 },
        { name: "pole_count", type: "Integer", value: 8 },
        { name: "closed_loop", type: "Boolean", value: true },
        { name: "firmware_version", type: "String", value: "v2.4.1" },
      ];

      const ssvXml = generateSsv(params, "InverterParams");
      assert.ok(ssvXml.includes("<ssv:ParameterSet"));
      assert.ok(ssvXml.includes('name="InverterParams"'));
      assert.ok(ssvXml.includes('version="1.0"'));
      assert.ok(ssvXml.includes('<ssv:Parameter name="damping_ratio">'));
      assert.ok(ssvXml.includes('<ssv:Real value="0.707" />'));

      const parsedValues = parseSsv(ssvXml);
      assert.strictEqual(parsedValues.length, 4);

      assert.strictEqual(parsedValues[0].name, "damping_ratio");
      assert.strictEqual(parsedValues[0].type, "Real");
      assert.strictEqual(parsedValues[0].value, 0.707);

      assert.strictEqual(parsedValues[1].name, "pole_count");
      assert.strictEqual(parsedValues[1].type, "Integer");
      assert.strictEqual(parsedValues[1].value, 8);

      assert.strictEqual(parsedValues[2].name, "closed_loop");
      assert.strictEqual(parsedValues[2].type, "Boolean");
      assert.strictEqual(parsedValues[2].value, true);

      assert.strictEqual(parsedValues[3].name, "firmware_version");
      assert.strictEqual(parsedValues[3].type, "String");
      assert.strictEqual(parsedValues[3].value, "v2.4.1");
    });
  });

  describe("SSP Archive Export & Inspection", () => {
    it("packages an SspSystem into a valid ZIP archive with SSD, SSV, and FMUs", () => {
      const fmuArchives = new Map<string, Buffer>();
      fmuArchives.set("resources/battery.fmu", Buffer.from("PK-dummy-battery-fmu-binary-data"));
      fmuArchives.set("resources/inverter.fmu", Buffer.from("PK-dummy-inverter-fmu-binary-data"));

      const zipBuffer = exportSspFromSystem(sampleSystem, fmuArchives, {
        version: "1.0",
        description: "Exported vehicle package",
      });

      assert.ok(Buffer.isBuffer(zipBuffer));
      assert.ok(zipBuffer.length > 100);

      // Verify header of ZIP (PK\x03\x04)
      assert.strictEqual(zipBuffer[0], 0x50);
      assert.strictEqual(zipBuffer[1], 0x4b);
      assert.strictEqual(zipBuffer[2], 0x03);
      assert.strictEqual(zipBuffer[3], 0x04);

      // Parse metadata using parseSspArchive
      const metadata = parseSspArchive(new Uint8Array(zipBuffer));
      assert.ok(metadata);
      assert.strictEqual(metadata.systemName, "DualDriveVehicle");
      assert.strictEqual(metadata.version, "1.0");
      assert.strictEqual(metadata.description, "Exported vehicle package");
      assert.deepStrictEqual(metadata.componentNames.sort(), ["batteryPack", "inverterDrive"].sort());
      assert.strictEqual(metadata.startTime, 0.0);
      assert.strictEqual(metadata.stopTime, 60.0);
    });

    it("exports SSP archive directly from a CoSimSession", () => {
      const session = new CoSimSession("test-session-123", {
        startTime: 1.0,
        stopTime: 25.0,
        stepSize: 0.02,
      });

      session.coupling.addCoupling({
        from: { participantId: "sub1", variableName: "out1", unit: "m/s" },
        to: { participantId: "sub2", variableName: "in1", unit: "m/s" },
      });

      const fmuArchives = new Map<string, Buffer>();
      fmuArchives.set("sub1.fmu", Buffer.from("fmu-1-content"));
      fmuArchives.set("sub2.fmu", Buffer.from("fmu-2-content"));

      const sspBuffer = exportSsp(session, fmuArchives, { description: "Session export" });
      assert.ok(sspBuffer.length > 50);

      const metadata = parseSspArchive(new Uint8Array(sspBuffer));
      assert.ok(metadata);
      assert.strictEqual(metadata.systemName, "test-session-123");
      assert.strictEqual(metadata.startTime, 1.0);
      assert.strictEqual(metadata.stopTime, 25.0);
    });
  });

  describe("SSP Archive Import & Storage Integration", () => {
    it("imports an SSP archive, extracts resources to FmuStorage, and instantiates a session", () => {
      const fmuArchives = new Map<string, Buffer>();
      fmuArchives.set("resources/battery.fmu", Buffer.from("battery-payload"));
      fmuArchives.set("resources/inverter.fmu", Buffer.from("inverter-payload"));

      const zipBuffer = exportSspFromSystem(sampleSystem, fmuArchives);

      // Mock FmuStorage
      const storedMap = new Map<string, { filename: string; data: Buffer }>();
      const mockStorage = {
        store: (id: string, filename: string, data: Buffer): StoredFmu => {
          storedMap.set(id, { filename, data });
          return {
            id,
            filename,
            modelDescription: {
              fmiVersion: "2.0",
              modelName: filename,
              guid: "{guid}",
              description: "mock",
              author: "test",
              generationTool: "msx",
              coSimulationModelIdentifier: undefined,
              modelExchangeModelIdentifier: undefined,
              supportsCoSimulation: true,
              supportsModelExchange: false,
              defaultExperiment: undefined,
              variables: [],
              numberOfEventIndicators: 0,
            },
            sizeBytes: data.length,
            uploadedAt: new Date().toISOString(),
          };
        },
      } as unknown as FmuStorage;

      const importResult = importSsp(zipBuffer, mockStorage, {
        startTime: 5.0,
        stopTime: 50.0,
        stepSize: 0.05,
      });

      assert.strictEqual(importResult.system.name, "DualDriveVehicle");
      assert.strictEqual(importResult.session.experiment.startTime, 5.0);
      assert.strictEqual(importResult.session.experiment.stopTime, 50.0);
      assert.strictEqual(importResult.session.experiment.stepSize, 0.05);

      // Verify FMUs were stored
      assert.strictEqual(importResult.fmuIds.size, 2);
      assert.ok(importResult.fmuIds.has("batteryPack"));
      assert.ok(importResult.fmuIds.has("inverterDrive"));

      // Verify parameter values from SSV were retained
      const binding = importResult.system.parameterBindings.find((b) => b.prefix === "batteryPack");
      assert.ok(binding);
      assert.strictEqual(binding.values.length, 4);
      assert.strictEqual(binding.values.find((v) => v.name === "nominal_capacity")?.value, 75.0);
    });

    it("throws appropriate error when importing non-SSP or corrupt buffer", () => {
      assert.throws(() => importSsp("not a buffer" as any, {} as any), /Expected Buffer for SSP archive data/);

      assert.throws(() => importSsp(Buffer.from("invalid-zip-header"), {} as any), /SystemStructure\.ssd not found/);
    });
  });
});

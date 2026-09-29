// SPDX-License-Identifier: AGPL-3.0-or-later

import { FmuStorage } from "@modelscript/exchange/fmu";
import { strToU8, zipSync } from "fflate";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";
import { runImportFmu } from "../src/commands/import-fmu.js";

describe("End-to-End FMU Import CLI & Storage Tests", () => {
  test("Imports FMU with FMI 3.0 terminals and synthesizes Modelica wrapper", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fmu-import-test-"));

    try {
      const modelDescriptionXml = `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription fmiVersion="3.0" modelName="RadiatorUnit" guid="{12345678-abcd-ef01-2345-6789abcdef01}" generationTool="ModelScript">
  <ModelExchange modelIdentifier="RadiatorUnit_me" />
  <CoSimulation modelIdentifier="RadiatorUnit_cs" />
  <ModelVariables>
    <Float64 name="fluid_in.p" valueReference="1" causality="input" variability="continuous" />
    <Float64 name="fluid_in.m_flow" valueReference="2" causality="output" variability="continuous" />
    <Float64 name="fluid_in.h_outflow" valueReference="3" causality="output" variability="continuous" />
    <Float64 name="fluid_out.p" valueReference="4" causality="input" variability="continuous" />
    <Float64 name="fluid_out.m_flow" valueReference="5" causality="output" variability="continuous" />
    <Float64 name="fluid_out.h_outflow" valueReference="6" causality="output" variability="continuous" />
    <Float64 name="heat_port.T" valueReference="7" causality="input" variability="continuous" />
    <Float64 name="heat_port.Q_flow" valueReference="8" causality="output" variability="continuous" />
    <Float64 name="ambient_temp" valueReference="9" causality="parameter" variability="fixed" start="293.15" />
    <Float64 name="fan_speed" valueReference="10" causality="input" variability="continuous" start="1000.0" />
    <Float64 name="heat_dissipated" valueReference="11" causality="output" variability="continuous" />
  </ModelVariables>
</fmiModelDescription>`;

      const terminalsXml = `<?xml version="1.0" encoding="UTF-8"?>
<fmiTerminalsAndIcons fmiVersion="3.0">
  <Terminals>
    <Terminal name="fluid_in" terminalKind="org.modelica.types.fluid.FluidPort_a" description="Fluid inlet">
      <TerminalMemberVariable variableName="fluid_in.p" memberName="p" variableKind="potential" />
      <TerminalMemberVariable variableName="fluid_in.m_flow" memberName="m_flow" variableKind="flow" />
      <TerminalMemberVariable variableName="fluid_in.h_outflow" memberName="h_outflow" variableKind="stream" />
      <Position x1="-110" y1="10" x2="-90" y2="30" />
    </Terminal>
    <Terminal name="fluid_out" terminalKind="org.modelica.types.fluid.FluidPort_b" description="Fluid outlet">
      <TerminalMemberVariable variableName="fluid_out.p" memberName="p" variableKind="potential" />
      <TerminalMemberVariable variableName="fluid_out.m_flow" memberName="m_flow" variableKind="flow" />
      <TerminalMemberVariable variableName="fluid_out.h_outflow" memberName="h_outflow" variableKind="stream" />
      <Position x1="90" y1="-30" x2="110" y2="-10" />
    </Terminal>
    <Terminal name="heat_port" terminalKind="org.modelica.types.thermal.HeatPort_a" description="Heat rejection">
      <TerminalMemberVariable variableName="heat_port.T" memberName="T" variableKind="potential" />
      <TerminalMemberVariable variableName="heat_port.Q_flow" memberName="Q_flow" variableKind="flow" />
      <Position x1="-10" y1="90" x2="10" y2="110" />
    </Terminal>
  </Terminals>
</fmiTerminalsAndIcons>`;

      // Create ZIP FMU archive in memory
      const zipData = zipSync({
        "modelDescription.xml": strToU8(modelDescriptionXml),
        "terminalsAndIcons/terminalsAndIcons.xml": strToU8(terminalsXml),
      });

      const fmuFilePath = path.join(tmpDir, "RadiatorUnit.fmu");
      fs.writeFileSync(fmuFilePath, Buffer.from(zipData));

      // Test 1: Test FmuStorage.store and generateWrapper
      const storageDir = path.join(tmpDir, "fmu-storage");
      const storage = new FmuStorage(storageDir);
      const stored = storage.store("radiator-1", "RadiatorUnit.fmu", Buffer.from(zipData));

      assert.strictEqual(stored.modelDescription.modelName, "RadiatorUnit");
      assert.ok(stored.terminalsAndIcons, "terminalsAndIcons should be stored");
      assert.strictEqual(stored.terminalsAndIcons.length, 3);

      const wrapperCode = storage.generateWrapper(stored.id, "ImportedVehicles");
      assert.ok(wrapperCode, "Should generate wrapper from storage");
      assert.ok(wrapperCode.includes("within ImportedVehicles;"));
      assert.ok(wrapperCode.includes("model RadiatorUnit"));
      assert.ok(wrapperCode.includes("FluidPort_a fluid_in"));
      assert.ok(wrapperCode.includes("FluidPort_b fluid_out"));
      assert.ok(wrapperCode.includes("HeatPort_a heat_port"));
      assert.ok(wrapperCode.includes('__ModelScript_preferredKind = "ModelExchange"'));

      // Test 2: Test CLI runImportFmu
      const outMoPath = path.join(tmpDir, "GeneratedRadiator.mo");
      const exitCode = await runImportFmu({
        fmu: fmuFilePath,
        output: outMoPath,
        package: "VehicularThermalSystems",
        verbose: true,
      });

      assert.strictEqual(exitCode, 0, "runImportFmu should exit with 0");
      assert.ok(fs.existsSync(outMoPath), "Generated .mo file should exist on disk");

      const generatedMo = fs.readFileSync(outMoPath, "utf-8");

      assert.ok(generatedMo.includes("within VehicularThermalSystems;"));
      assert.ok(generatedMo.includes("model RadiatorUnit"));
      assert.ok(generatedMo.includes("import Modelica.Fluid.Interfaces.FluidPort_a;"));
      assert.ok(generatedMo.includes("import Modelica.Fluid.Interfaces.FluidPort_b;"));
      assert.ok(generatedMo.includes("import Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a;"));
      assert.ok(generatedMo.includes("FluidPort_a fluid_in"));
      assert.ok(generatedMo.includes("FluidPort_b fluid_out"));
      assert.ok(generatedMo.includes("HeatPort_a heat_port"));
      assert.ok(generatedMo.includes("parameter Real ambient_temp = 293.15;"));
      assert.ok(generatedMo.includes("input Real fan_speed = 1000;"));
      assert.ok(generatedMo.includes("output Real heat_dissipated;"));
      assert.ok(generatedMo.includes("Real fmu_fluid_in_p;"));
      assert.ok(generatedMo.includes("Real fmu_heat_port_Q_flow;"));
      assert.ok(generatedMo.includes("fluid_in.p = fmu_fluid_in_p;"));
      assert.ok(generatedMo.includes("heat_port.Q_flow = fmu_heat_port_Q_flow;"));
      assert.ok(generatedMo.includes('__ModelScript_preferredKind = "ModelExchange"'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

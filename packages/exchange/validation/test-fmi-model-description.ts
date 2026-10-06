// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupFmi3Variables, type FmiScalarVariable } from "../src/fmu/fmi.js";
import { generateTerminalsAndIconsXml, type Fmi3Terminal } from "../src/fmu/fmi3.js";
import { parseModelDescription, parseTerminalsAndIcons } from "../src/fmu/model-description.js";

describe("FMI Model Description & Terminals Parser Unit Tests", () => {
  describe("FMI 2.0 modelDescription.xml Parser", () => {
    it("parses complete FMI 2.0 XML with CoSimulation, ModelExchange, and DefaultExperiment", () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription
  fmiVersion="2.0"
  modelName="PendulumModel"
  guid="{12345678-abcd-ef01-2345-6789abcdef01}"
  description="Inverted pendulum benchmark model"
  author="Antigravity Test Engineer"
  generationTool="ModelScript 0.0.18"
  numberOfEventIndicators="3">
  <CoSimulation modelIdentifier="PendulumModel_cs" />
  <ModelExchange modelIdentifier="PendulumModel_me" />
  <DefaultExperiment startTime="0.5" stopTime="15.0" tolerance="0.0001" stepSize="0.005" />
  <ModelVariables>
    <ScalarVariable name="theta" valueReference="10" causality="output" variability="continuous" description="Pendulum angle">
      <Real start="0.785398" unit="rad" displayUnit="deg" />
    </ScalarVariable>
    <ScalarVariable name="omega" valueReference="11" causality="output" variability="continuous" derivative="1">
      <Real start="0.0" unit="rad/s" />
    </ScalarVariable>
    <ScalarVariable name="mass" valueReference="1" causality="parameter" variability="fixed" description="Bob mass">
      <Real start="2.5" unit="kg" />
    </ScalarVariable>
    <ScalarVariable name="step_count" valueReference="2" causality="local" variability="discrete">
      <Integer start="100" />
    </ScalarVariable>
    <ScalarVariable name="is_active" valueReference="3" causality="input" variability="discrete">
      <Boolean start="true" />
    </ScalarVariable>
    <ScalarVariable name="mode_name" valueReference="4" causality="parameter" variability="fixed">
      <String start="inverted" />
    </ScalarVariable>
    <ScalarVariable name="ctrl_state" valueReference="5" causality="output" variability="discrete">
      <Enumeration start="2" />
    </ScalarVariable>
  </ModelVariables>
</fmiModelDescription>`;

      const desc = parseModelDescription(xml);

      assert.strictEqual(desc.fmiVersion, "2.0");
      assert.strictEqual(desc.modelName, "PendulumModel");
      assert.strictEqual(desc.guid, "{12345678-abcd-ef01-2345-6789abcdef01}");
      assert.strictEqual(desc.description, "Inverted pendulum benchmark model");
      assert.strictEqual(desc.author, "Antigravity Test Engineer");
      assert.strictEqual(desc.generationTool, "ModelScript 0.0.18");
      assert.strictEqual(desc.numberOfEventIndicators, 3);
      assert.strictEqual(desc.supportsCoSimulation, true);
      assert.strictEqual(desc.coSimulationModelIdentifier, "PendulumModel_cs");
      assert.strictEqual(desc.supportsModelExchange, true);
      assert.strictEqual(desc.modelExchangeModelIdentifier, "PendulumModel_me");

      assert.ok(desc.defaultExperiment);
      assert.strictEqual(desc.defaultExperiment.startTime, 0.5);
      assert.strictEqual(desc.defaultExperiment.stopTime, 15.0);
      assert.strictEqual(desc.defaultExperiment.tolerance, 0.0001);
      assert.strictEqual(desc.defaultExperiment.stepSize, 0.005);

      assert.strictEqual(desc.variables.length, 7);

      // Verify sorted by valueReference: 1, 2, 3, 4, 5, 10, 11
      assert.strictEqual(desc.variables[0].name, "mass");
      assert.strictEqual(desc.variables[0].valueReference, 1);
      assert.strictEqual(desc.variables[0].type, "Real");
      assert.strictEqual(desc.variables[0].start, 2.5);
      assert.strictEqual(desc.variables[0].unit, "kg");
      assert.strictEqual(desc.variables[0].causality, "parameter");
      assert.strictEqual(desc.variables[0].variability, "fixed");

      assert.strictEqual(desc.variables[1].name, "step_count");
      assert.strictEqual(desc.variables[1].type, "Integer");
      assert.strictEqual(desc.variables[1].start, 100);

      assert.strictEqual(desc.variables[2].name, "is_active");
      assert.strictEqual(desc.variables[2].type, "Boolean");
      assert.strictEqual(desc.variables[2].start, true);

      assert.strictEqual(desc.variables[3].name, "mode_name");
      assert.strictEqual(desc.variables[3].type, "String");
      assert.strictEqual(desc.variables[3].start, "inverted");

      assert.strictEqual(desc.variables[4].name, "ctrl_state");
      assert.strictEqual(desc.variables[4].type, "Enumeration");
      assert.strictEqual(desc.variables[4].start, 2);

      assert.strictEqual(desc.variables[5].name, "theta");
      assert.strictEqual(desc.variables[5].unit, "rad");
      assert.strictEqual(desc.variables[5].displayUnit, "deg");

      assert.strictEqual(desc.variables[6].name, "omega");
      assert.strictEqual(desc.variables[6].unit, "rad/s");
    });

    it("handles minimal FMI 2.0 XML with missing optional sections and single quotes", () => {
      const xml = `<fmiModelDescription fmiVersion='2.0' modelName='MinimalModel' guid='{abc-123}'>
  <ModelVariables>
    <ScalarVariable name='x' valueReference='0'>
      <Real start='1.23' />
    </ScalarVariable>
    <ScalarVariable name='flag' valueReference='1'>
      <Boolean start='0' />
    </ScalarVariable>
  </ModelVariables>
</fmiModelDescription>`;

      const desc = parseModelDescription(xml);
      assert.strictEqual(desc.modelName, "MinimalModel");
      assert.strictEqual(desc.guid, "{abc-123}");
      assert.strictEqual(desc.supportsCoSimulation, false);
      assert.strictEqual(desc.supportsModelExchange, false);
      assert.strictEqual(desc.defaultExperiment, undefined);
      assert.strictEqual(desc.variables.length, 2);
      assert.strictEqual(desc.variables[0].name, "x");
      assert.strictEqual(desc.variables[0].start, 1.23);
      assert.strictEqual(desc.variables[1].name, "flag");
      assert.strictEqual(desc.variables[1].start, false);
    });
  });

  describe("FMI 3.0 modelDescription.xml Parser", () => {
    it("parses typed FMI 3.0 scalar variables and sorts by valueReference", () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription fmiVersion="3.0" modelName="Fmi3TestModel" guid="{9988-7766}">
  <ModelVariables>
    <Float64 name="pressure" valueReference="10" causality="input" variability="continuous" start="101325.0" unit="Pa" />
    <Float32 name="temperature" valueReference="5" causality="output" variability="continuous" start="298.15" unit="K" />
    <Int8 name="gear" valueReference="1" causality="parameter" variability="fixed" start="3" />
    <Int16 name="rpm" valueReference="2" causality="output" variability="discrete" start="3500" />
    <Int32 name="counter32" valueReference="3" causality="local" variability="discrete" start="12345" />
    <Int64 name="counter64" valueReference="4" causality="local" variability="discrete" start="9876543210" />
    <UInt8 name="flags_u8" valueReference="6" causality="input" variability="discrete" start="128" />
    <UInt16 name="flags_u16" valueReference="7" causality="input" variability="discrete" start="40000" />
    <UInt32 name="flags_u32" valueReference="8" causality="input" variability="discrete" start="100000" />
    <UInt64 name="flags_u64" valueReference="9" causality="input" variability="discrete" start="500000" />
    <Boolean name="motor_on" valueReference="12" causality="input" variability="discrete" start="1" />
    <String name="ident" valueReference="13" causality="parameter" variability="fixed" start="Unit-9" />
    <Enumeration name="state" valueReference="14" causality="output" variability="discrete" start="1" />
  </ModelVariables>
</fmiModelDescription>`;

      const desc = parseModelDescription(xml);
      assert.strictEqual(desc.fmiVersion, "3.0");
      assert.strictEqual(desc.variables.length, 13);

      // Verify sorted order
      const vrs = desc.variables.map((v) => v.valueReference);
      assert.deepStrictEqual(vrs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14]);

      // Types mapped to Modelica equivalents
      assert.strictEqual(desc.variables.find((v) => v.name === "pressure")?.type, "Real");
      assert.strictEqual(desc.variables.find((v) => v.name === "pressure")?.start, 101325.0);
      assert.strictEqual(desc.variables.find((v) => v.name === "temperature")?.type, "Real");
      assert.strictEqual(desc.variables.find((v) => v.name === "gear")?.type, "Integer");
      assert.strictEqual(desc.variables.find((v) => v.name === "gear")?.start, 3);
      assert.strictEqual(desc.variables.find((v) => v.name === "motor_on")?.type, "Boolean");
      assert.strictEqual(desc.variables.find((v) => v.name === "motor_on")?.start, true);
      assert.strictEqual(desc.variables.find((v) => v.name === "ident")?.type, "String");
      assert.strictEqual(desc.variables.find((v) => v.name === "ident")?.start, "Unit-9");
      assert.strictEqual(desc.variables.find((v) => v.name === "state")?.type, "Enumeration");
      assert.strictEqual(desc.variables.find((v) => v.name === "state")?.start, 1);
    });

    it("parses embedded Terminals and Icons in FMI 3.0 XML", () => {
      const xml = `<fmiModelDescription fmiVersion="3.0" modelName="EmbeddedTerminalModel" guid="{5544-3322}">
  <Terminals>
    <Terminal name="pin_p" terminalKind="org.modelica.types.electrical.PositivePin">
      <TerminalMemberVariable variableName="pin_p.v" memberName="v" variableKind="potential" />
      <TerminalMemberVariable variableName="pin_p.i" memberName="i" variableKind="flow" />
      <Position x="-50" y="0" />
    </Terminal>
  </Terminals>
</fmiModelDescription>`;

      const desc = parseModelDescription(xml);
      assert.ok(desc.terminals);
      assert.strictEqual(desc.terminals.length, 1);
      assert.strictEqual(desc.terminals[0].name, "pin_p");
      assert.strictEqual(desc.terminals[0].memberVariables.length, 2);
      assert.strictEqual(desc.terminals[0].graphicalRepresentation?.x, -50);
      assert.strictEqual(desc.terminals[0].graphicalRepresentation?.y, 0);
    });
  });

  describe("Terminals & Icons XML Generation & Roundtrip", () => {
    it("generates terminals XML and roundtrips with parseTerminalsAndIcons", () => {
      const fmi3Terminals: Fmi3Terminal[] = [
        {
          name: "inlet",
          terminalKind: "org.modelica.types.fluid.FluidPort_a",
          description: "Primary fluid intake",
          memberVariables: [
            { variableName: "inlet.p", memberName: "p" },
            { variableName: "inlet.m_flow", memberName: "m_flow" },
          ],
        },
        {
          name: "heat_port",
          description: "Convective boundary port",
          memberVariables: [
            { variableName: "heat_port.T", memberName: "T" },
            { variableName: "heat_port.Q_flow", memberName: "Q_flow" },
          ],
        },
      ];

      const generatedXml = generateTerminalsAndIconsXml(fmi3Terminals);
      assert.ok(generatedXml);
      assert.ok(generatedXml.includes('<Terminal name="inlet"'));
      assert.ok(generatedXml.includes('terminalKind="org.modelica.types.fluid.FluidPort_a"'));

      const parsed = parseTerminalsAndIcons(generatedXml);
      assert.strictEqual(parsed.length, 2);
      assert.strictEqual(parsed[0].name, "inlet");
      assert.strictEqual(parsed[0].terminalKind, "org.modelica.types.fluid.FluidPort_a");
      assert.strictEqual(parsed[0].description, "Primary fluid intake");
      assert.strictEqual(parsed[0].memberVariables.length, 2);
      assert.strictEqual(parsed[0].memberVariables[0].variableName, "inlet.p");
      assert.strictEqual(parsed[0].memberVariables[1].memberName, "m_flow");

      assert.strictEqual(parsed[1].name, "heat_port");
      assert.strictEqual(parsed[1].description, "Convective boundary port");
    });

    it("returns null when generating XML for empty terminals list", () => {
      assert.strictEqual(generateTerminalsAndIconsXml([]), null);
    });
  });

  describe("groupFmi3Variables", () => {
    it("groups indexed 1D array variables into Fmi3ArrayVariable", () => {
      const vars: FmiScalarVariable[] = [
        { name: "scalarA", valueReference: 0, causality: "input", variability: "continuous", type: "Real", start: 1.0 },
        {
          name: "arr[1]",
          valueReference: 1,
          causality: "output",
          variability: "continuous",
          type: "Real",
          start: 10.5,
        },
        {
          name: "arr[2]",
          valueReference: 2,
          causality: "output",
          variability: "continuous",
          type: "Real",
          start: 20.5,
        },
        {
          name: "arr[3]",
          valueReference: 3,
          causality: "output",
          variability: "continuous",
          type: "Real",
          start: 30.5,
        },
        { name: "scalarB", valueReference: 4, causality: "output", variability: "discrete", type: "Integer", start: 7 },
      ];

      const grouped = groupFmi3Variables(vars);
      assert.strictEqual(grouped.length, 3);

      assert.strictEqual((grouped[0] as FmiScalarVariable).name, "scalarA");

      const arrVar = grouped[1] as any;
      assert.strictEqual(arrVar.baseName, "arr");
      assert.deepStrictEqual(arrVar.dimensions, [3]);
      assert.strictEqual(arrVar.elements.length, 3);
      assert.strictEqual(arrVar.sv.name, "arr");
      assert.strictEqual(arrVar.sv.type, "Real");

      assert.strictEqual((grouped[2] as FmiScalarVariable).name, "scalarB");
    });

    it("preserves non-array variables untouched", () => {
      const vars: FmiScalarVariable[] = [
        { name: "u", valueReference: 0, causality: "input", variability: "continuous", type: "Real" },
        { name: "y", valueReference: 1, causality: "output", variability: "continuous", type: "Real" },
      ];
      const grouped = groupFmi3Variables(vars);
      assert.strictEqual(grouped.length, 2);
      assert.strictEqual((grouped[0] as FmiScalarVariable).name, "u");
      assert.strictEqual((grouped[1] as FmiScalarVariable).name, "y");
    });
  });

  describe("Error Resilience & Edge Cases", () => {
    it("handles empty or non-XML string gracefully", () => {
      const emptyDesc = parseModelDescription("");
      assert.strictEqual(emptyDesc.modelName, "Unknown");
      assert.strictEqual(emptyDesc.variables.length, 0);

      const invalidDesc = parseModelDescription("not xml content at all");
      assert.strictEqual(invalidDesc.modelName, "Unknown");
      assert.strictEqual(invalidDesc.variables.length, 0);
    });

    it("parses placement coordinate variations (Position vs Placement)", () => {
      const xml = `<fmiTerminalsAndIcons fmiVersion="3.0">
  <Terminals>
    <Terminal name="box_port">
      <Placement x1="10" y1="20" x2="30" y2="40" />
    </Terminal>
    <Terminal name="point_port">
      <TerminalGraphicalRepresentation x="15" y="25" />
    </Terminal>
  </Terminals>
</fmiTerminalsAndIcons>`;

      const terms = parseTerminalsAndIcons(xml);
      assert.strictEqual(terms.length, 2);
      assert.strictEqual(terms[0].graphicalRepresentation?.x1, 10);
      assert.strictEqual(terms[0].graphicalRepresentation?.y2, 40);
      assert.strictEqual(terms[1].graphicalRepresentation?.x, 15);
      assert.strictEqual(terms[1].graphicalRepresentation?.y, 25);
    });
  });
});

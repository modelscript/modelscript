// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { buildComponentProperties } from "../src/diagram/data.js";
import { computeParameterEdit } from "../src/diagram/edits.js";
import { ModelicaVariability } from "../src/types.js";

describe("Modelica Dialog(...) Annotation Extraction & Property Schema", () => {
  it("extracts Dialog(tab, group, enable) into structured EntityPropertySchema tabs and groups", () => {
    // Construct component class instance (e.g. Resistor definition)
    const resistorClassInstance = {
      name: "Resistor",
      classKind: "model",
      elements: [
        {
          kind: "Component",
          isComponentInstance: true,
          name: "R",
          description: "Resistance",
          variability: ModelicaVariability.PARAMETER,
          modification: { expression: "100" },
          classInstance: {
            name: "Real",
            modification: {
              getModificationArgument: (name: string) => (name === "unit" ? { expression: '"Ohm"' } : null),
            },
          },
          annotation: (name: string) => (name === "Dialog" ? { tab: "General", group: "Parameters" } : null),
        },
        {
          kind: "Component",
          isComponentInstance: true,
          name: "use_HeatPort",
          description: "Enable thermal port",
          variability: ModelicaVariability.PARAMETER,
          modification: { expression: "false" },
          classInstance: { name: "Boolean" },
          annotation: (name: string) => (name === "Dialog" ? { tab: "Thermal", group: "Settings" } : null),
        },
        {
          kind: "Component",
          isComponentInstance: true,
          name: "T",
          description: "Operating temperature",
          variability: ModelicaVariability.PARAMETER,
          modification: { expression: "293.15" },
          classInstance: {
            name: "Real",
            modification: {
              getModificationArgument: (name: string) => (name === "unit" ? { expression: '"K"' } : null),
            },
          },
          annotation: (name: string) =>
            name === "Dialog" ? { tab: "Thermal", group: "Settings", enable: "use_HeatPort" } : null,
        },
      ],
      annotation: () => null,
    };

    // Construct parent circuit with component instance r1
    const circuitInstance = {
      name: "Circuit",
      components: [
        {
          name: "r1",
          description: "Primary resistor",
          classInstance: resistorClassInstance,
          modification: {
            getModificationArgument: (name: string) => {
              if (name === "R") return { expression: "220" };
              if (name === "use_HeatPort") return { expression: "true" };
              return null;
            },
          },
        },
      ],
    };

    const props = buildComponentProperties(circuitInstance as any, "r1");
    assert.ok(props, "Component properties must not be null");
    assert.strictEqual(props.name, "r1");
    assert.strictEqual(props.className, "Resistor");

    // Check schema existence
    assert.ok(props.schema, "props.schema must exist");
    const tabs = props.schema.tabs;
    assert.ok(tabs && tabs.length >= 2, "Must have at least General and Thermal tabs");

    // General tab check
    const generalTab = tabs.find((t: any) => t.label === "General" || t.id === "general");
    assert.ok(generalTab, "General tab must exist");
    const paramGroup = generalTab.groups.find((g: any) => g.label === "Parameters" || g.id === "parameters");
    assert.ok(paramGroup, "Parameters group must exist");
    const rField = paramGroup.fields.find((f: any) => f.key === "R");
    assert.ok(rField, "R field must exist in Parameters group");
    assert.strictEqual(rField.unit, "Ω");
    assert.strictEqual(rField.kind, "quantity");
    assert.strictEqual(props.values?.["R"], "220");

    // Thermal tab check
    const thermalTab = tabs.find((t: any) => t.label === "Thermal" || t.id === "thermal");
    assert.ok(thermalTab, "Thermal tab must exist");
    const settingsGroup = thermalTab.groups.find((g: any) => g.label === "Settings" || g.id === "settings");
    assert.ok(settingsGroup, "Settings group must exist");

    const useHeatPortField = settingsGroup.fields.find((f: any) => f.key === "use_HeatPort");
    assert.ok(useHeatPortField, "use_HeatPort field must exist");
    assert.strictEqual(useHeatPortField.kind, "boolean");
    assert.strictEqual(props.values?.["use_HeatPort"], "true");

    const tField = settingsGroup.fields.find((f: any) => f.key === "T");
    assert.ok(tField, "T field must exist");
    assert.strictEqual(tField.enabledIf, "use_HeatPort");
    assert.strictEqual(tField.unit, "K");
    assert.strictEqual(props.values?.["T"], "293.15");
  });

  it("computes surgical parameter edits on AST modifications", () => {
    // Mock class instance with AST declaration node
    const classInstance = {
      name: "Circuit",
      components: [
        {
          name: "r1",
          abstractSyntaxNode: {
            declaration: {
              modification: {
                classModification: {
                  startPosition: { row: 5, column: 14 },
                  endPosition: { row: 5, column: 23 },
                  modificationArguments: [
                    {
                      name: { parts: [{ text: "R" }] },
                      modification: {
                        startPosition: { row: 5, column: 17 },
                        endPosition: { row: 5, column: 21 },
                      },
                      startPosition: { row: 5, column: 14 },
                      endPosition: { row: 5, column: 21 },
                    },
                  ],
                },
              },
            },
          },
        },
      ],
    };

    // Update existing modifier R = 220
    const edits = computeParameterEdit(classInstance as any, "r1", "R", "220");
    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0].newText, "=220");
    assert.strictEqual(edits[0].range.start.line, 5);
    assert.strictEqual(edits[0].range.start.character, 17);
    assert.strictEqual(edits[0].range.end.character, 21);

    // Append new modifier use_HeatPort = true
    const addEdits = computeParameterEdit(classInstance as any, "r1", "use_HeatPort", "true");
    assert.strictEqual(addEdits.length, 1);
    assert.strictEqual(addEdits[0].newText, ", use_HeatPort=true");
    assert.strictEqual(addEdits[0].range.start.line, 5);
    assert.strictEqual(addEdits[0].range.start.character, 22);
  });
});

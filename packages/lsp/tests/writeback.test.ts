// SPDX-License-Identifier: AGPL-3.0-or-later

import csvLanguage from "@modelscript/csv/language";
import modelicaLanguage from "@modelscript/modelica/language";
import modelscriptLanguage from "@modelscript/modelscript/language";
import owl2Language from "@modelscript/owl2/language";
import scadLanguage from "@modelscript/scad/language";
import { stepLanguage } from "@modelscript/step";
import sysml2Language from "@modelscript/sysml2/language";
import assert from "node:assert/strict";
import test from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";
import { computeWritebackEdit } from "../src/services/writeback-service.js";

// Register language packages into polyglot registry to provide writeback handlers
globalLanguageRegistry.register({
  id: "sysml2",
  name: "SysML v2",
  extensions: [".sysml", ".sysml2"],
  languageDef: sysml2Language,
});
globalLanguageRegistry.register({
  id: "modelica",
  name: "Modelica",
  extensions: [".mo", ".mos"],
  languageDef: modelicaLanguage,
});
globalLanguageRegistry.register({
  id: "scad",
  name: "OpenSCAD",
  extensions: [".scad"],
  languageDef: scadLanguage,
});
globalLanguageRegistry.register({
  id: "owl2",
  name: "OWL2",
  extensions: [".owl", ".ofn"],
  languageDef: owl2Language,
});
globalLanguageRegistry.register({
  id: "step",
  name: "STEP",
  extensions: [".step", ".stp"],
  languageDef: stepLanguage,
});
globalLanguageRegistry.register({
  id: "csv",
  name: "CSV",
  extensions: [".csv"],
  languageDef: csvLanguage,
});
globalLanguageRegistry.register({
  id: "modelscript",
  name: "ModelScript",
  extensions: [".modelscript", ".msx"],
  languageDef: modelscriptLanguage,
});

function applyEditsToText(text: string, edits: any[]): string {
  const sorted = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) {
      return b.range.start.line - a.range.start.line;
    }
    return b.range.start.character - a.range.start.character;
  });

  const lines = text.split("\n");
  for (const edit of sorted) {
    const { start, end } = edit.range;
    const startLine = lines[start.line];
    const endLine = lines[end.line];
    const before = startLine.substring(0, start.character);
    const after = endLine.substring(end.character);
    const replaced = before + edit.newText + after;
    lines.splice(start.line, end.line - start.line + 1, replaced);
  }
  return lines.join("\n");
}

function createMockContext(uri: string, sourceText: string, symbols: Map<number, any>) {
  return {
    workspaceManager: {
      unifiedWorkspace: {
        getIndex: () => ({ symbols }),
      },
      getWorkspaceIndex: () => null,
    },
    documents: {
      get: (u: string) => {
        if (u === uri) {
          return {
            getText: () => sourceText,
            positionAt: (offset: number) => {
              const lines = sourceText.substring(0, offset).split("\n");
              return { line: lines.length - 1, character: lines[lines.length - 1].length };
            },
          };
        }
        return null;
      },
    },
    documentManager: {
      documentTrees: new Map(),
    },
  };
}

test("WritebackService: SysML v2 attribute with unit preservation", async () => {
  const uri = "file:///workspace/drone.sysml";
  const sourceText = `package DronePkg {
  part def Battery {
    attribute mass : Mass = 0.45 [kg];
    attribute voltage = 14.8;
  }
}`;

  const startOffset = sourceText.indexOf("attribute mass");
  const endOffset = sourceText.indexOf(";", startOffset) + 1;

  const symbols = new Map<number, any>([
    [1, { id: 1, name: "mass", ruleName: "AttributeUsage", parentId: 2, startOffset, endOffset, resourceId: uri }],
    [2, { id: 2, name: "Battery", parentId: 3 }],
    [3, { id: 3, name: "DronePkg", parentId: null }],
  ]);

  const mockContext: any = createMockContext(uri, sourceText, symbols);

  const result = await computeWritebackEdit(mockContext, {
    target: "DronePkg.Battery.mass",
    newValue: "0.55",
  });

  assert.equal(result.success, true);
  assert.ok(result.workspaceEdit?.changes?.[uri]);
  const edits = result.workspaceEdit.changes[uri];
  const updatedText = applyEditsToText(sourceText, edits);
  assert.ok(
    updatedText.includes("attribute mass : Mass = 0.55 [kg];"),
    `Expected updated mass with unit preserved, got:\n${updatedText}`,
  );
});

test("WritebackService: Modelica parameter declaration replacement", async () => {
  const uri = "file:///workspace/circuit.mo";
  const sourceText = `model ResistorCircuit
  parameter Real R = 100.0 "Nominal resistance";
  Real v;
equation
  v = R * 2.0;
end ResistorCircuit;`;

  const startOffset = sourceText.indexOf("parameter Real R");
  const endOffset = sourceText.indexOf(";", startOffset) + 1;

  const symbols = new Map<number, any>([
    [1, { id: 1, name: "R", ruleName: "ComponentDeclaration", parentId: 2, startOffset, endOffset, resourceId: uri }],
    [2, { id: 2, name: "ResistorCircuit", parentId: null }],
  ]);

  const mockContext: any = createMockContext(uri, sourceText, symbols);

  const result = await computeWritebackEdit(mockContext, {
    target: "ResistorCircuit.R",
    newValue: "470.0",
  });

  assert.equal(result.success, true);
  const edits = result.workspaceEdit!.changes![uri];
  const updatedText = applyEditsToText(sourceText, edits);
  assert.ok(
    updatedText.includes('parameter Real R = 470.0 "Nominal resistance";'),
    `Expected updated resistance with description preserved, got:\n${updatedText}`,
  );
});

test("WritebackService: OpenSCAD parameter variable replacement", async () => {
  const uri = "file:///workspace/bracket.scad";
  const sourceText = `// Motor mount bracket
width = 25.0;
height = 40.0;
thickness = 3.2;

cube([width, height, thickness]);`;

  const startOffset = sourceText.indexOf("width =");
  const endOffset = sourceText.indexOf(";", startOffset) + 1;

  const symbols = new Map<number, any>([
    [
      1,
      {
        id: 1,
        name: "width",
        ruleName: "VariableDeclaration",
        parentId: null,
        startOffset,
        endOffset,
        resourceId: uri,
      },
    ],
  ]);

  const mockContext: any = createMockContext(uri, sourceText, symbols);

  const result = await computeWritebackEdit(mockContext, {
    target: "width",
    newValue: "35.5",
  });

  assert.equal(result.success, true);
  const edits = result.workspaceEdit!.changes![uri];
  const updatedText = applyEditsToText(sourceText, edits);
  assert.ok(updatedText.includes("width = 35.5;"), `Expected updated width in OpenSCAD, got:\n${updatedText}`);
  assert.ok(updatedText.includes("height = 40.0;"));
});

test("WritebackService: OWL2 DataPropertyAssertion value replacement", async () => {
  const uri = "file:///workspace/drone.ofn";
  const sourceText = `Ontology(<http://example.org/drone>
  Declaration(Class(:Drone))
  Declaration(DataProperty(:maxPayload))
  DataPropertyAssertion(:maxPayload :Drone "2.5"^^xsd:double)
)`;

  const startOffset = sourceText.indexOf("DataPropertyAssertion(:maxPayload");
  const endOffset = sourceText.indexOf(")", startOffset) + 1;

  const symbols = new Map<number, any>([
    [
      1,
      {
        id: 1,
        name: "maxPayload",
        ruleName: "DataPropertyAssertion",
        parentId: null,
        startOffset,
        endOffset,
        resourceId: uri,
      },
    ],
  ]);

  const mockContext: any = createMockContext(uri, sourceText, symbols);

  const result = await computeWritebackEdit(mockContext, {
    target: "maxPayload",
    newValue: "3.2",
  });

  assert.equal(result.success, true);
  const edits = result.workspaceEdit!.changes![uri];
  const updatedText = applyEditsToText(sourceText, edits);
  assert.ok(
    updatedText.includes('DataPropertyAssertion(:maxPayload :Drone "3.2"^^xsd:double)'),
    `Expected updated payload in OWL2 assertion, got:\n${updatedText}`,
  );
});

test("WritebackService: STEP Product entity string replacement", async () => {
  const uri = "file:///workspace/chassis.step";
  const sourceText = `ISO-10303-21;
HEADER;
ENDSEC;
DATA;
#10 = PRODUCT('DroneChassis', 'Drone Chassis Assembly', '', (#20));
ENDSEC;
END-ISO-10303-21;`;

  const startOffset = sourceText.indexOf("#10 = PRODUCT");
  const endOffset = sourceText.indexOf(";", startOffset) + 1;

  const symbols = new Map<number, any>([
    [
      1,
      {
        id: 1,
        name: "DroneChassis",
        ruleName: "step_product",
        parentId: null,
        startOffset,
        endOffset,
        resourceId: uri,
      },
    ],
  ]);

  const mockContext: any = createMockContext(uri, sourceText, symbols);

  const result = await computeWritebackEdit(mockContext, {
    target: "DroneChassis",
    newValue: "HeavyChassisV2",
  });

  assert.equal(result.success, true);
  const edits = result.workspaceEdit!.changes![uri];
  const updatedText = applyEditsToText(sourceText, edits);
  assert.ok(
    updatedText.includes("#10 = PRODUCT('HeavyChassisV2', 'Drone Chassis Assembly'"),
    `Expected updated STEP product name, got:\n${updatedText}`,
  );
});

test("WritebackService: Dynamic / Generic DSL assignment replacement", async () => {
  const uri = "file:///workspace/robot.dsl";
  const sourceText = `robot ArmRobot {
  joint BaseJoint {
    speed_limit = 180.0;
  }
}`;

  const startOffset = sourceText.indexOf("speed_limit =");
  const endOffset = sourceText.indexOf(";", startOffset) + 1;

  const symbols = new Map<number, any>([
    [1, { id: 1, name: "speed_limit", ruleName: "Assignment", parentId: 2, startOffset, endOffset, resourceId: uri }],
    [2, { id: 2, name: "BaseJoint", parentId: 3 }],
    [3, { id: 3, name: "ArmRobot", parentId: null }],
  ]);

  const mockContext: any = createMockContext(uri, sourceText, symbols);

  const result = await computeWritebackEdit(mockContext, {
    target: "ArmRobot.BaseJoint.speed_limit",
    newValue: "240.0",
  });

  assert.equal(result.success, true);
  const edits = result.workspaceEdit!.changes![uri];
  const updatedText = applyEditsToText(sourceText, edits);
  assert.ok(
    updatedText.includes("speed_limit = 240.0;"),
    `Expected updated speed limit in custom DSL, got:\n${updatedText}`,
  );
});

test("WritebackService: Modelica parameter writeback utilizing exact CST fieldRanges.value", async () => {
  const uri = "file:///workspace/motor.mo";
  const sourceText = `model DC_Motor
  parameter Real J = 0.05 "Rotor inertia";
  parameter Real R = 1.5 "Armature resistance";
end DC_Motor;`;

  const jValStart = sourceText.indexOf("0.05");
  const jValEnd = jValStart + "0.05".length;

  const symbols = new Map<number, any>([
    [
      1,
      {
        id: 1,
        name: "J",
        ruleName: "component_declaration",
        parentId: 2,
        startOffset: sourceText.indexOf("parameter Real J"),
        endOffset: sourceText.indexOf(";", sourceText.indexOf("parameter Real J")) + 1,
        fieldRanges: {
          value: { startOffset: jValStart, endOffset: jValEnd },
          expression: { startOffset: jValStart, endOffset: jValEnd },
        },
        resourceId: uri,
      },
    ],
    [2, { id: 2, name: "DC_Motor", parentId: null }],
  ]);

  const mockContext: any = createMockContext(uri, sourceText, symbols);

  const result = await computeWritebackEdit(mockContext, {
    target: "DC_Motor.J",
    newValue: "0.08",
  });

  assert.equal(result.success, true);
  const edits = result.workspaceEdit!.changes![uri];
  const updatedText = applyEditsToText(sourceText, edits);
  assert.ok(
    updatedText.includes('parameter Real J = 0.08 "Rotor inertia";'),
    `Expected updated J via fieldRanges.value, got:\n${updatedText}`,
  );
  assert.ok(updatedText.includes('parameter Real R = 1.5 "Armature resistance";'));
});

test("WritebackService: Modelica parameter writeback utilizing fieldRanges.modification with leading operator", async () => {
  const uri = "file:///workspace/motor2.mo";
  const sourceText = `model DC_Motor
  parameter Real J = 0.05 "Rotor inertia";
end DC_Motor;`;

  const modStart = sourceText.indexOf("= 0.05");
  const modEnd = modStart + "= 0.05".length;

  const symbols = new Map<number, any>([
    [
      1,
      {
        id: 1,
        name: "J",
        ruleName: "component_declaration",
        parentId: 2,
        startOffset: sourceText.indexOf("parameter Real J"),
        endOffset: sourceText.indexOf(";", sourceText.indexOf("parameter Real J")) + 1,
        fieldRanges: {
          modification: { startOffset: modStart, endOffset: modEnd },
        },
        resourceId: uri,
      },
    ],
    [2, { id: 2, name: "DC_Motor", parentId: null }],
  ]);

  const mockContext: any = createMockContext(uri, sourceText, symbols);

  const result = await computeWritebackEdit(mockContext, {
    target: "DC_Motor.J",
    newValue: "0.12",
  });

  assert.equal(result.success, true);
  const edits = result.workspaceEdit!.changes![uri];
  const updatedText = applyEditsToText(sourceText, edits);
  assert.ok(
    updatedText.includes('parameter Real J = 0.12 "Rotor inertia";'),
    `Expected updated J via fieldRanges.modification with leading operator stripped, got:\n${updatedText}`,
  );
});

test("WritebackService: SysML v2 attribute writeback utilizing exact CST fieldRanges.value with unit preservation", async () => {
  const uri = "file:///workspace/satellite.sysml";
  const sourceText = `package SatPkg {
  part def ReactionWheel {
    attribute maxTorque : Torque = 0.25 [N*m];
  }
}`;

  const valStart = sourceText.indexOf("0.25 [N*m]");
  const valEnd = valStart + "0.25 [N*m]".length;

  const symbols = new Map<number, any>([
    [
      1,
      {
        id: 1,
        name: "maxTorque",
        ruleName: "AttributeUsage",
        parentId: 2,
        startOffset: sourceText.indexOf("attribute maxTorque"),
        endOffset: sourceText.indexOf(";", sourceText.indexOf("attribute maxTorque")) + 1,
        fieldRanges: {
          value: { startOffset: valStart, endOffset: valEnd },
        },
        resourceId: uri,
      },
    ],
    [2, { id: 2, name: "ReactionWheel", parentId: 3 }],
    [3, { id: 3, name: "SatPkg", parentId: null }],
  ]);

  const mockContext: any = createMockContext(uri, sourceText, symbols);

  const result = await computeWritebackEdit(mockContext, {
    target: "SatPkg.ReactionWheel.maxTorque",
    newValue: "0.50",
  });

  assert.equal(result.success, true);
  const edits = result.workspaceEdit!.changes![uri];
  const updatedText = applyEditsToText(sourceText, edits);
  assert.ok(
    updatedText.includes("attribute maxTorque : Torque = 0.50 [N*m];"),
    `Expected updated maxTorque via fieldRanges with unit preserved, got:\n${updatedText}`,
  );
});

test("WritebackService: Generic writeback utilizing fieldRanges.initializer", async () => {
  const uri = "file:///workspace/config.custom";
  const sourceText = `config SystemConfig {
  threshold := 99.5;
}`;

  const initStart = sourceText.indexOf("99.5");
  const initEnd = initStart + "99.5".length;

  const symbols = new Map<number, any>([
    [
      1,
      {
        id: 1,
        name: "threshold",
        ruleName: "ConfigField",
        parentId: 2,
        startOffset: sourceText.indexOf("threshold :="),
        endOffset: sourceText.indexOf(";", sourceText.indexOf("threshold :=")) + 1,
        fieldRanges: {
          initializer: { startOffset: initStart, endOffset: initEnd },
        },
        resourceId: uri,
      },
    ],
    [2, { id: 2, name: "SystemConfig", parentId: null }],
  ]);

  const mockContext: any = createMockContext(uri, sourceText, symbols);

  const result = await computeWritebackEdit(mockContext, {
    target: "SystemConfig.threshold",
    newValue: "85.0",
  });

  assert.equal(result.success, true);
  const edits = result.workspaceEdit!.changes![uri];
  const updatedText = applyEditsToText(sourceText, edits);
  assert.ok(
    updatedText.includes("threshold := 85.0;"),
    `Expected updated threshold via fieldRanges.initializer, got:\n${updatedText}`,
  );
});

test("WritebackService: ModelScript parameter declaration replacement via operators", async () => {
  const uri = "file:///workspace/script.msx";
  const sourceText = `parameter damping = 0.15;
parameter stiffness = 100.0;
let x = 1.0;`;

  const startOffset = sourceText.indexOf("parameter damping =");
  const endOffset = sourceText.indexOf(";", startOffset) + 1;

  const symbols = new Map<number, any>([
    [
      1,
      {
        id: 1,
        name: "damping",
        ruleName: "parameter_declaration",
        parentId: null,
        startOffset,
        endOffset,
        resourceId: uri,
      },
    ],
  ]);

  const mockContext: any = createMockContext(uri, sourceText, symbols);

  const result = await computeWritebackEdit(mockContext, {
    target: "damping",
    newValue: "0.25",
  });

  assert.equal(result.success, true);
  const edits = result.workspaceEdit!.changes![uri];
  const updatedText = applyEditsToText(sourceText, edits);
  assert.ok(
    updatedText.includes("parameter damping = 0.25;"),
    `Expected updated damping in ModelScript without wiping statement, got:\n${updatedText}`,
  );
  assert.ok(updatedText.includes("parameter stiffness = 100.0;"));
});

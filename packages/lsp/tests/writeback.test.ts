// SPDX-License-Identifier: AGPL-3.0-or-later

import csvLanguage from "@modelscript/csv/language";
import modelicaLanguage from "@modelscript/modelica/language";
import owl2Language from "@modelscript/owl2/language";
import scadLanguage from "@modelscript/scad/language";
import { stepLanguage } from "@modelscript/step";
import sysml2Language from "@modelscript/sysml2/language";
import assert from "node:assert/strict";
import test from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";
import { computeWritebackEdit } from "../src/services/WritebackService.js";

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
        toUnifiedPartial: () => ({ symbols }),
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

  const startByte = sourceText.indexOf("attribute mass");
  const endByte = sourceText.indexOf(";", startByte) + 1;

  const symbols = new Map<number, any>([
    [1, { id: 1, name: "mass", ruleName: "AttributeUsage", parentId: 2, startByte, endByte, resourceId: uri }],
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

  const startByte = sourceText.indexOf("parameter Real R");
  const endByte = sourceText.indexOf(";", startByte) + 1;

  const symbols = new Map<number, any>([
    [1, { id: 1, name: "R", ruleName: "ComponentDeclaration", parentId: 2, startByte, endByte, resourceId: uri }],
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

  const startByte = sourceText.indexOf("width =");
  const endByte = sourceText.indexOf(";", startByte) + 1;

  const symbols = new Map<number, any>([
    [1, { id: 1, name: "width", ruleName: "VariableDeclaration", parentId: null, startByte, endByte, resourceId: uri }],
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

  const startByte = sourceText.indexOf("DataPropertyAssertion(:maxPayload");
  const endByte = sourceText.indexOf(")", startByte) + 1;

  const symbols = new Map<number, any>([
    [
      1,
      {
        id: 1,
        name: "maxPayload",
        ruleName: "DataPropertyAssertion",
        parentId: null,
        startByte,
        endByte,
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

  const startByte = sourceText.indexOf("#10 = PRODUCT");
  const endByte = sourceText.indexOf(";", startByte) + 1;

  const symbols = new Map<number, any>([
    [1, { id: 1, name: "DroneChassis", ruleName: "step_product", parentId: null, startByte, endByte, resourceId: uri }],
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

  const startByte = sourceText.indexOf("speed_limit =");
  const endByte = sourceText.indexOf(";", startByte) + 1;

  const symbols = new Map<number, any>([
    [1, { id: 1, name: "speed_limit", ruleName: "Assignment", parentId: 2, startByte, endByte, resourceId: uri }],
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

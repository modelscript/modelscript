// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildProjectModel, parsePscx } from "@modelscript/pscad";
import type { SymbolEntry, SymbolIndex } from "@modelscript/runtime";
import { lintSimulinkModel, parseSimulink } from "@modelscript/simulink";
import { lintSpiceCircuit, SpiceParser } from "@modelscript/spice";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { createDiagramDispatch, GenericDSLDiagramBackend } from "../src/diagramApi.js";
import { ValidationService } from "../src/services/validation-service.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";

function buildCrossLanguageUnifiedIndex(): SymbolIndex {
  const symbols = new Map<number, SymbolEntry>();
  const byName = new Map<string, number[]>();
  const childrenOf = new Map<number | null, number[]>();

  const add = (entry: SymbolEntry) => {
    symbols.set(entry.id, entry);
    const list = byName.get(entry.name) ?? [];
    list.push(entry.id);
    byName.set(entry.name, list);
    const ch = childrenOf.get(entry.parentId ?? null) ?? [];
    ch.push(entry.id);
    childrenOf.set(entry.parentId ?? null, ch);
  };

  // Modelica block: Controller.MotorController
  add({
    id: 1,
    name: "Controller",
    kind: "Class",
    ruleName: "class_definition",
    parentId: null,
    resourceId: "file:///workspace/Controller.mo",
    startOffset: 0,
    endOffset: 200,
    startLine: 1,
    startColumn: 1,
    endLine: 10,
    endColumn: 1,
    metadata: { classKind: "package", language: "modelica" },
  });
  add({
    id: 2,
    name: "MotorController",
    kind: "Class",
    ruleName: "class_definition",
    parentId: 1,
    resourceId: "file:///workspace/Controller.mo",
    startOffset: 20,
    endOffset: 180,
    startLine: 2,
    startColumn: 3,
    endLine: 9,
    endColumn: 20,
    metadata: {
      classKind: "block",
      language: "modelica",
      qualifiedName: "Controller.MotorController",
    },
  });
  add({
    id: 3,
    name: "u",
    kind: "Component",
    ruleName: "component_declaration",
    parentId: 2,
    resourceId: "file:///workspace/Controller.mo",
    startOffset: 45,
    endOffset: 60,
    startLine: 3,
    startColumn: 5,
    endLine: 3,
    endColumn: 20,
    metadata: { typeName: "Real", causality: "input" },
  });
  add({
    id: 4,
    name: "y",
    kind: "Component",
    ruleName: "component_declaration",
    parentId: 2,
    resourceId: "file:///workspace/Controller.mo",
    startOffset: 65,
    endOffset: 82,
    startLine: 4,
    startColumn: 5,
    endLine: 4,
    endColumn: 22,
    metadata: { typeName: "Real", causality: "output" },
  });
  add({
    id: 5,
    name: "kp",
    kind: "Component",
    ruleName: "component_declaration",
    parentId: 2,
    resourceId: "file:///workspace/Controller.mo",
    startOffset: 85,
    endOffset: 112,
    startLine: 5,
    startColumn: 5,
    endLine: 5,
    endColumn: 32,
    metadata: { typeName: "Real", variability: "parameter", defaultValue: "2.5" },
  });
  add({
    id: 6,
    name: "ti",
    kind: "Component",
    ruleName: "component_declaration",
    parentId: 2,
    resourceId: "file:///workspace/Controller.mo",
    startOffset: 115,
    endOffset: 142,
    startLine: 6,
    startColumn: 5,
    endLine: 6,
    endColumn: 32,
    metadata: { typeName: "Real", variability: "parameter", defaultValue: "0.1" },
  });

  // SysML2 part def: BatteryPack
  add({
    id: 10,
    name: "BatteryPack",
    kind: "PartDefinition",
    ruleName: "PartDefinition",
    parentId: null,
    resourceId: "file:///workspace/Battery.sysml",
    startOffset: 0,
    endOffset: 160,
    startLine: 1,
    startColumn: 1,
    endLine: 6,
    endColumn: 1,
    metadata: { language: "sysml2", qualifiedName: "BatteryPack" },
  });
  add({
    id: 11,
    name: "v_cmd",
    kind: "ItemUsage",
    ruleName: "ItemUsage",
    parentId: 10,
    resourceId: "file:///workspace/Battery.sysml",
    startOffset: 25,
    endOffset: 48,
    startLine: 2,
    startColumn: 3,
    endLine: 2,
    endColumn: 26,
    metadata: { direction: "in", typeName: "Real" },
  });
  add({
    id: 12,
    name: "soc",
    kind: "ItemUsage",
    ruleName: "ItemUsage",
    parentId: 10,
    resourceId: "file:///workspace/Battery.sysml",
    startOffset: 50,
    endOffset: 72,
    startLine: 3,
    startColumn: 3,
    endLine: 3,
    endColumn: 25,
    metadata: { direction: "out", typeName: "Real" },
  });
  add({
    id: 13,
    name: "capacity",
    kind: "AttributeUsage",
    ruleName: "AttributeUsage",
    parentId: 10,
    resourceId: "file:///workspace/Battery.sysml",
    startOffset: 74,
    endOffset: 110,
    startLine: 4,
    startColumn: 3,
    endLine: 4,
    endColumn: 39,
    metadata: { variability: "parameter", typeName: "Real", defaultValue: "48" },
  });

  return {
    symbols,
    byName,
    childrenOf,
    nextId: 100,
    diagnostics: [],
    references: [],
    semanticAnnotations: [],
  } as unknown as SymbolIndex;
}

describe("Cross-Language Diagram Component Drops & Parity Fallback Removal", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-diagram-drop-"));
  const docs = new Map<string, TextDocument>();

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const writeTempDoc = (filename: string, langId: string, content: string): { uri: string; filePath: string } => {
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, content, "utf8");
    const uri = pathToFileURL(filePath).href;
    docs.set(uri, TextDocument.create(uri, langId, 1, content));
    return { uri, filePath };
  };

  const applyAndSave = (uri: string, filePath: string, langId: string, edits: any[]): string => {
    const cur = docs.get(uri)!;
    const nextText = TextDocument.applyEdits(cur, edits);
    docs.set(uri, TextDocument.create(uri, langId, cur.version + 1, nextText));
    fs.writeFileSync(filePath, nextText, "utf8");
    return nextText;
  };

  const unifiedIndex = buildCrossLanguageUnifiedIndex();
  const dispatch = createDiagramDispatch({
    generic: new GenericDSLDiagramBackend({
      getDocumentText: (uri) => docs.get(uri)?.getText(),
      getSymbolIndex: () => unifiedIndex,
      getUnifiedIndex: () => unifiedIndex,
    }),
    getUnifiedIndex: () => unifiedIndex,
  });

  it("1. PSCAD (.pscx) synthesizes and reuses UserCmpDefn stubs for foreign Modelica & SysML2 drops while keeping native drops working", async () => {
    const initialPscx = `<?xml version="1.0" encoding="UTF-8"?>
<project name="MicrogridProj" version="5.0">
  <hierarchy>
    <call name="Main" link="10001" />
  </hierarchy>
  <definitions>
    <Definition classid="UserCmpDefn" name="Main">
      <schematic classid="GraphFrame" name="Main">
      </schematic>
    </Definition>
  </definitions>
</project>
`;
    const { uri, filePath } = writeTempDoc("microgrid.pscx", "pscad", initialPscx);

    // Drop Modelica Controller.MotorController twice in one batch
    const batchRes = await dispatch.applyEdits({
      uri,
      seq: 1,
      actions: [
        { type: "addComponent", className: "Modelica::Controller.MotorController", x: 180, y: 120 },
        { type: "addComponent", className: "Modelica::Controller.MotorController", x: 340, y: 120 },
      ],
    });
    assert.strictEqual(batchRes.renderHint, "immediate");
    assert.ok(batchRes.edits.length >= 2);

    let updated = applyAndSave(uri, filePath, "pscad", batchRes.edits);
    let parsed = parsePscx(updated);
    let model = buildProjectModel(updated);

    const defMatches = updated.match(/<Definition\b[^>]*name="BlackBox_MotorController"/g) ?? [];
    assert.strictEqual(defMatches.length, 1, "Expected exactly one BlackBox_MotorController Definition stub");
    assert.ok(parsed.definitions.has("BlackBox_MotorController"));

    const defn = model.definitions.get("BlackBox_MotorController");
    assert.ok(defn, "Expected BlackBox_MotorController in project definitions");
    assert.ok(
      defn.ports.some((p) => p.name === "u"),
      "Expected input port 'u'",
    );
    assert.ok(
      defn.ports.some((p) => p.name === "y"),
      "Expected output port 'y'",
    );

    const userMatches = updated.match(/<User\b[^>]*defn="MicrogridProj:BlackBox_MotorController"/g) ?? [];
    assert.strictEqual(userMatches.length, 2, "Expected two UserCmp instances referencing BlackBox_MotorController");

    const diagData = await dispatch.getData({ uri });
    assert.ok(
      diagData && diagData.nodes.length >= 2,
      `Expected PSCAD diagram nodes >= 2 after foreign drop, got nodes=${diagData?.nodes.length}, rootComponents=${parsed.rootModule.components.length}, xml=${updated}`,
    );
    const firstNode = diagData.nodes[0]!;
    const props = await dispatch.getComponentProperties({ uri, componentName: firstNode.id });
    assert.ok(props, "Expected properties for dropped PSCAD foreign component");
    assert.ok(props.parameters.some((p) => p.name === "kp" && p.value === "2.5"));

    // Third drop in a follow-up edit reuses existing BlackBox_MotorController and drops SysML2 BatteryPack
    const secondRes = await dispatch.applyEdits({
      uri,
      seq: 2,
      actions: [
        { type: "addComponent", className: "Modelica::Controller.MotorController", x: 500, y: 120 },
        { type: "addComponent", className: "SysML2::BatteryPack", x: 240, y: 260 },
      ],
    });
    updated = applyAndSave(uri, filePath, "pscad", secondRes.edits);
    parsed = parsePscx(updated);
    model = buildProjectModel(updated);

    assert.strictEqual(
      (updated.match(/<Definition\b[^>]*name="BlackBox_MotorController"/g) ?? []).length,
      1,
      "Follow-up drop must reuse existing BlackBox_MotorController Definition",
    );
    assert.strictEqual((updated.match(/<User\b[^>]*defn="MicrogridProj:BlackBox_MotorController"/g) ?? []).length, 3);
    const batDefn = model.definitions.get("BlackBox_BatteryPack");
    assert.ok(batDefn, "Expected BlackBox_BatteryPack stub for SysML2 drop");
    assert.ok(batDefn.ports.some((p) => p.name === "v_cmd"));
    assert.ok(batDefn.ports.some((p) => p.name === "soc"));

    // Native PSCAD master schema drop still works cleanly without creating a BlackBox_ stub
    const nativeRes = await dispatch.applyEdits({
      uri,
      seq: 3,
      actions: [{ type: "addComponent", className: "master:resistor", x: 100, y: 100 }],
    });
    updated = applyAndSave(uri, filePath, "pscad", nativeRes.edits);
    assert.ok(!updated.includes("BlackBox_resistor"));
  });

  it("2. Simulink (.mdl) generates valid self-consistent SubSystem stubs for foreign drops and native Blocks for native drops", async () => {
    const initialMdl = `Model {
  Name "DriveLoop"
  System {
    Name "DriveLoop"
    Block {
      BlockType Constant
      Name "Setpoint"
      Value "1"
      Position [30, 40, 60, 70]
    }
  }
}
`;
    const { uri, filePath } = writeTempDoc("driveloop.mdl", "simulink", initialMdl);

    const dropRes = await dispatch.applyEdits({
      uri,
      seq: 4,
      actions: [
        { type: "addComponent", className: "Modelica::Controller.MotorController", x: 200, y: 100 },
        { type: "addComponent", className: "Gain", x: 360, y: 100 },
      ],
    });
    assert.strictEqual(dropRes.renderHint, "immediate");
    assert.ok(dropRes.edits.length > 0);

    const updated = applyAndSave(uri, filePath, "simulink", dropRes.edits);
    const parsed = parseSimulink(updated, "driveloop.mdl");

    const stubBlock = parsed.rootSystem.blocks.get("MotorController1");
    assert.ok(stubBlock, "Expected MotorController1 SubSystem block");
    assert.strictEqual(stubBlock.type, "SubSystem");
    assert.strictEqual(stubBlock.ports.filter((p) => p.type === "in").length, 1);
    assert.strictEqual(stubBlock.ports.filter((p) => p.type === "out").length, 1);
    assert.ok(stubBlock.subsystem, "Expected inner System for stub block");
    assert.ok(stubBlock.subsystem.blocks.has("u"), "Expected internal Inport 'u'");
    assert.ok(stubBlock.subsystem.blocks.has("y"), "Expected internal Outport 'y'");

    const gainBlock = parsed.rootSystem.blocks.get("Gain1");
    assert.ok(gainBlock && gainBlock.type === "Gain", "Expected native Gain1 block");

    const simDiags = lintSimulinkModel(parsed);
    const internalErrors = simDiags.filter((d) => d.blockName === "y" && d.code === "M7201");
    assert.strictEqual(internalErrors.length, 0, "Internal stub Outport must be driven inside stub System");

    // Binary .slx remains non-destructive no-op
    const slxPath = path.join(tmpDir, "model.slx");
    fs.writeFileSync(slxPath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const slxRes = await dispatch.applyEdits({
      uri: pathToFileURL(slxPath).href,
      seq: 5,
      actions: [{ type: "addComponent", className: "Modelica::Controller.MotorController", x: 10, y: 10 }],
    });
    assert.strictEqual(slxRes.edits.length, 0);
  });

  it("3. SPICE (.cir) emits and reuses .SUBCKT stubs prior to .END with zero SPICE lint errors", async () => {
    const initialSpice = `RLC Drive Netlist
V1 in 0 DC 5
R1 in out 1k
R_load out 0 10k
.END
`;
    const { uri, filePath } = writeTempDoc("circuit.cir", "spice", initialSpice);

    const dropRes = await dispatch.applyEdits({
      uri,
      seq: 6,
      actions: [
        { type: "addComponent", className: "Modelica::Controller.MotorController", x: 120, y: 80 },
        { type: "addComponent", className: "Modelica::Controller.MotorController", x: 260, y: 80 },
      ],
    });
    assert.strictEqual(dropRes.renderHint, "immediate");

    let updated = applyAndSave(uri, filePath, "spice", dropRes.edits);
    assert.ok(
      updated.indexOf(".SUBCKT MOTORCONTROLLER") < updated.lastIndexOf(".END"),
      ".SUBCKT stub must appear before .END",
    );
    assert.strictEqual(
      (updated.match(/\.SUBCKT\s+MOTORCONTROLLER\b/gi) ?? []).length,
      1,
      "Duplicate .SUBCKT stubs must not be emitted in a batch",
    );

    // Subsequent SysML2 drop into updated netlist
    const followUp = await dispatch.applyEdits({
      uri,
      seq: 7,
      actions: [{ type: "addComponent", className: "SysML2::BatteryPack", x: 400, y: 80 }],
    });
    updated = applyAndSave(uri, filePath, "spice", followUp.edits);

    const parser = new SpiceParser();
    const circuit = parser.parse(updated);
    assert.ok(circuit.subcircuits.has("MOTORCONTROLLER"));
    assert.ok(circuit.subcircuits.has("BATTERYPACK"));
    assert.ok(circuit.components.some((c) => c.kind === "X" && c.subcktName?.toUpperCase() === "MOTORCONTROLLER"));

    const spiceDiags = lintSpiceCircuit(circuit);
    const errorsAndWarnings = spiceDiags.filter((d) => d.severity === "error" || d.severity === "warning");
    assert.deepStrictEqual(errorsAndWarnings, [], `Unexpected SPICE diagnostics: ${JSON.stringify(errorsAndWarnings)}`);
  });

  it("4. Generic DSL backend sanitizes foreign qualified drops cleanly without emitting invalid syntax", async () => {
    const { uri } = writeTempDoc("custom.dsl", "customdsl", "Step step1;\n");
    const res = await dispatch.applyEdits({
      uri,
      seq: 8,
      actions: [
        { type: "addComponent", className: "Modelica::Controller.MotorController", x: 100, y: 100 },
        { type: "addComponent", className: "Modelica::Controller.MotorController", x: 200, y: 100 },
        { type: "addComponent", className: "Step", x: 300, y: 100 },
      ],
    });
    assert.strictEqual(res.renderHint, "immediate");
    assert.ok(res.edits.some((e) => e.newText.includes("MotorController motorController1;")));
    assert.ok(res.edits.some((e) => e.newText.includes("MotorController motorController2;")));
    assert.ok(res.edits.some((e) => e.newText.includes("Step step2;")));
    assert.ok(!res.edits.some((e) => e.newText.includes("::")));
  });

  it("5. ValidationService does not emit hardcoded 1.2 kg DroneSimulation fallback parity diagnostics on unlinked files", async () => {
    const sentDiags = new Map<string, any[]>();
    const wm = new WorkspaceManager(); // unseeded
    const droneUri = "file:///workspace/modelica/DroneSimulation.mo";
    const droneDoc = TextDocument.create(
      droneUri,
      "modelica",
      1,
      "model DroneSimulation\n  parameter Real m = 2.0;\nend DroneSimulation;\n",
    );
    const vs = new ValidationService(
      {
        console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
        sendDiagnostics: (p: { uri: string; diagnostics: any[] }) => sentDiags.set(p.uri, p.diagnostics),
        sendNotification: () => {},
      } as any,
      { documents: new Map([[droneUri, droneDoc]]), documentTrees: new Map() } as any,
      wm,
      { getSharedCstTreeWrapper: () => null, facade: null, sharedContext: null } as any,
    );

    await vs.runUnifiedSemanticPipeline({
      uri: droneUri,
      text: droneDoc.getText(),
      tree: { rootNode: { text: droneDoc.getText() } },
      baseDiagnostics: [],
      revisionAtStart: null,
      langId: "modelica",
      textDocument: droneDoc,
    });

    const unlinkedDiags = sentDiags.get(droneUri) ?? [];
    assert.ok(
      !unlinkedDiags.some(
        (d) =>
          String(d.message).includes("Digital Thread Drift") ||
          String(d.message).includes("Digital Thread In Parity") ||
          String(d.message).includes("1.20 kg"),
      ),
      "Unlinked DroneSimulation.mo must not fabricate 1.20 kg / DroneAssembly parity diagnostics",
    );

    // Binding an actual digital thread with mass = 3.5 kg checks against real bound mass 3.50 kg
    const { ThreadDomain } = await import("@modelscript/runtime");
    wm.bindThreadSlot(505, ThreadDomain.Modelica, 9001, {
      name: "model DroneSimulation",
      uri: droneUri,
      line: 1,
      column: 1,
      domain: "modelica",
      properties: { mass: 2.0 },
    });
    wm.bindThreadSlot(505, ThreadDomain.FEA, 9002, {
      name: "mesh.inp",
      uri: "file:///workspace/cae/mesh.inp",
      line: 1,
      column: 1,
      domain: "fea",
      properties: { mass: 3.5 },
    });

    await vs.runUnifiedSemanticPipeline({
      uri: droneUri,
      text: droneDoc.getText(),
      tree: { rootNode: { text: droneDoc.getText() } },
      baseDiagnostics: [],
      revisionAtStart: null,
      langId: "modelica",
      textDocument: droneDoc,
    });

    const linkedDiags = sentDiags.get(droneUri) ?? [];
    const driftDiag = linkedDiags.find((d) => String(d.message).includes("Digital Thread Drift"));
    assert.ok(driftDiag, "Expected real digital-thread drift diagnostic");
    assert.strictEqual(driftDiag.severity, DiagnosticSeverity.Warning);
    assert.ok(String(driftDiag.message).includes("3.50 kg"));
  });
});

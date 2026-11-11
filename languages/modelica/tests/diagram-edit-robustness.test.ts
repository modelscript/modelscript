// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildDiagramData } from "../src/diagram/data.js";
import {
  applyEditsToText,
  buildFallbackClassInstance,
  computeComponentInsert,
  computeComponentsDelete,
  computeConnectInsert,
  computeConnectRemove,
  computeCoordinateSystemEdits,
  computeDescriptionEdit,
  computeEdgePointEdits,
  computeMinimalNonOverlappingEdits,
  computeNameEdit,
  computeParameterEdit,
  computePlacementEdits,
  healStrandedClassAnnotationsInText,
  scanModelicaClassLayout,
} from "../src/diagram/edits.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

describe("Modelica Diagram-to-Code Robustness, Ordering & Syntax-Error Resilience", async () => {
  const { parser } = await createWasmParser(modelicaWasm);

  it("keeps class-level annotation(...) strictly at the bottom before end <ClassName> when adding components and connections", () => {
    let code = `model Untitled
  annotation(Icon(coordinateSystem(preserveAspectRatio=false)), Diagram(coordinateSystem(preserveAspectRatio=false)));
end Untitled;
`;

    // Step 1: Add CriticalDamping1
    const ci1 = buildFallbackClassInstance(code, "Untitled")!;
    const edits1 = computeComponentInsert(
      ci1,
      "Modelica.Blocks.Continuous.CriticalDamping",
      "CriticalDamping1",
      -13,
      6,
      code,
    );
    code = applyEditsToText(code, edits1);

    // Step 2: Add CriticalDamping2
    const ci2 = buildFallbackClassInstance(code, "Untitled")!;
    const edits2 = computeComponentInsert(
      ci2,
      "Modelica.Blocks.Continuous.CriticalDamping",
      "CriticalDamping2",
      -85,
      6,
      code,
    );
    code = applyEditsToText(code, edits2);

    // Step 3: Connect CriticalDamping1.u -> CriticalDamping2.y
    const ci3 = buildFallbackClassInstance(code, "Untitled")!;
    const edits3 = computeConnectInsert(code, ci3, "CriticalDamping1.u", "CriticalDamping2.y", [
      { x: -25, y: 6 },
      { x: -73, y: 6 },
    ]);
    code = applyEditsToText(code, edits3);

    // Step 4: Connect CriticalDamping1.y -> CriticalDamping2.u with 4-bend C-detour
    const ci4 = buildFallbackClassInstance(code, "Untitled")!;
    const edits4 = computeConnectInsert(code, ci4, "CriticalDamping1.y", "CriticalDamping2.u", [
      { x: -1, y: 6 },
      { x: 10, y: 6 },
      { x: 10, y: -20 },
      { x: -110, y: -20 },
      { x: -110, y: 6 },
      { x: -97, y: 6 },
    ]);
    code = applyEditsToText(code, edits4);

    // Verify exact Modelica grammar ordering:
    //   1. Component declarations
    //   2. equation + connect(...) statements
    //   3. Standalone class annotation(Icon(...), Diagram(...));
    //   4. end Untitled;
    const idxCD1 = code.indexOf("CriticalDamping1");
    const idxCD2 = code.indexOf("CriticalDamping2");
    const idxEq = code.indexOf("\nequation\n");
    const idxConn1 = code.indexOf("connect(CriticalDamping1.u, CriticalDamping2.y)");
    const idxConn2 = code.indexOf("connect(CriticalDamping1.y, CriticalDamping2.u)");
    const idxClassAnn = code.indexOf("annotation(Icon(");
    const idxEnd = code.indexOf("end Untitled;");

    assert.ok(idxCD1 > 0 && idxCD2 > idxCD1, "Components must be in declaration section");
    assert.ok(idxEq > idxCD2, "equation section must follow component declarations");
    assert.ok(idxConn1 > idxEq && idxConn2 > idxConn1, "connect statements must be inside equation section");
    assert.ok(idxClassAnn > idxConn2, "Class-level annotation(...) must remain below equation section");
    assert.ok(idxEnd > idxClassAnn, "end Untitled; must close the model after class annotation");

    // Verify native GLR parser parses the resulting code with zero syntax errors
    const parsed = parser.parse(code);
    assert.strictEqual(
      typeof (parsed.rootNode as any).hasError === "function"
        ? (parsed.rootNode as any).hasError()
        : (parsed.rootNode as any).hasError,
      false,
      `Generated Modelica code had parse errors:\n${code}`,
    );
  });

  it("auto-heals an already-broken model where class annotation(...) was stranded at the top above components and equations", () => {
    const brokenCode = `model Untitled
  annotation(Icon(coordinateSystem(preserveAspectRatio=false)), Diagram(coordinateSystem(preserveAspectRatio=false)));
  Modelica.Blocks.Continuous.CriticalDamping CriticalDamping1 annotation(Placement(transformation(origin={-13,-6}, extent={{-10,-10},{10,10}})));
equation
  connect(CriticalDamping1.u, CriticalDamping1.y);
end Untitled;
`;

    const healed = healStrandedClassAnnotationsInText(brokenCode, "Untitled");
    const idxComp = healed.indexOf("CriticalDamping1");
    const idxEq = healed.indexOf("equation");
    const idxConn = healed.indexOf("connect(");
    const idxClassAnn = healed.indexOf("annotation(Icon(");
    const idxEnd = healed.indexOf("end Untitled;");

    assert.ok(idxComp > 0);
    assert.ok(idxEq > idxComp);
    assert.ok(idxConn > idxEq);
    assert.ok(idxClassAnn > idxConn, `Stranded annotation should move below connect, got:\n${healed}`);
    assert.ok(idxEnd > idxClassAnn);

    const parsed = parser.parse(healed);
    assert.strictEqual(
      typeof (parsed.rootNode as any).hasError === "function"
        ? (parsed.rootNode as any).hasError()
        : (parsed.rootNode as any).hasError,
      false,
      `Healed Modelica code must parse cleanly:\n${healed}`,
    );
  });

  it("updates multi-line component declarations with shifted CST lines without truncating modifiers or duplicating Placement", () => {
    const docText = `model MultiLineShift
  // Newly typed comment lines above R1 that shifted lines relative to stale CST
  parameter Real V0 = 5.0;
  Modelica.Electrical.Analog.Basic.Resistor R1(
    R = 100.0,
    T_ref = 300.15
  ) "Load resistor (with parens)"
    annotation(
      Documentation(info="<html>Info</html>"),
      Placement(
        transformation(
          origin={10, 20},
          extent={{-10,-10},{10,10}}
        )
      )
    );
end MultiLineShift;`;

    // Simulate a stale CST whose startPosition still points to line 1 (now a comment!)
    const staleClassInstance: any = {
      name: "MultiLineShift",
      components: [
        {
          name: "R1",
          cstNode: {
            type: "component_declaration",
            startPosition: { row: 1, column: 2 },
            endPosition: { row: 1, column: 40 },
          },
          annotation: () => ({
            transformation: {
              origin: [10, 20],
              extent: [
                [-10, -10],
                [10, 10],
              ],
            },
          }),
        },
      ],
      connectEquations: [],
    };

    const edits = computePlacementEdits(docText, staleClassInstance, [
      { name: "R1", x: 40, y: -60, width: 20, height: 20 },
    ]);
    assert.strictEqual(edits.length, 1);

    const updated = applyEditsToText(docText, edits);
    // Must preserve modifiers, description, Documentation, and semicolon, with exactly ONE Placement
    assert.ok(updated.includes("R = 100.0"), "Modifier R must be preserved");
    assert.ok(updated.includes("T_ref = 300.15"), "Modifier T_ref must be preserved");
    assert.ok(updated.includes('"Load resistor (with parens)"'), "Description string must be preserved");
    assert.ok(
      updated.includes('Documentation(info="<html>Info</html>")'),
      "Documentation annotation must be preserved",
    );
    assert.strictEqual((updated.match(/\bPlacement\s*\(/g) ?? []).length, 1, "Must have exactly 1 Placement(...)");
    assert.ok(updated.includes("origin={50,50}"), `Expected updated origin in:\n${updated}`);
    assert.strictEqual(
      typeof (parser.parse(updated).rootNode as any).hasError === "function"
        ? (parser.parse(updated).rootNode as any).hasError()
        : (parser.parse(updated).rootNode as any).hasError,
      false,
    );
  });

  it("computeCoordinateSystemEdits never injects Diagram(...) inside a connect Line(...) annotation or comment/string", () => {
    const docText = `model CoordSysSafety
  // Fake comment mentioning Diagram(coordinateSystem(extent={{0,0},{1,1}}))
  Modelica.Blocks.Sources.Constant c1 " mentions Diagram(coordinateSystem()) " annotation(Placement(transformation(origin={-40,0}, extent={{-10,-10},{10,10}})));
  Modelica.Blocks.Math.Gain g1 annotation(Placement(transformation(origin={40,0}, extent={{-10,-10},{10,10}})));
equation
  connect(c1.y, g1.u) annotation(Line(points={{-29,0},{28,0}}, color={0,0,127}));
end CoordSysSafety;`;

    const ci = buildFallbackClassInstance(docText, "CoordSysSafety")!;
    const edits = computeCoordinateSystemEdits(docText, ci, {
      extent: [
        [-200, -150],
        [200, 150],
      ],
      grid: [5, 5],
    });

    assert.strictEqual(edits.length, 1);
    const updated = applyEditsToText(docText, edits);

    // Connect annotation must remain untouched!
    assert.ok(
      updated.includes("connect(c1.y, g1.u) annotation(Line(points={{-29,0},{28,0}}, color={0,0,127}));"),
      `Connect annotation was corrupted:\n${updated}`,
    );
    // Class-level annotation(Diagram(coordinateSystem(...))); must be added right before end CoordSysSafety;
    assert.ok(
      updated.includes(
        "  annotation(Diagram(coordinateSystem(preserveAspectRatio = true, extent = {{-200, -150}, {200, 150}}, grid = {5, 5})));\nend CoordSysSafety;",
      ),
      `Expected clean class-level Diagram annotation before end:\n${updated}`,
    );
    assert.strictEqual(
      typeof (parser.parse(updated).rootNode as any).hasError === "function"
        ? (parser.parse(updated).rootNode as any).hasError()
        : (parser.parse(updated).rootNode as any).hasError,
      false,
    );
  });

  it("computeNameEdit renames both the component declaration and all matching connect(...) endpoints", () => {
    const docText = `model RenameTest
  Modelica.Blocks.Continuous.CriticalDamping CD1 annotation(Placement(transformation(origin={-20,0}, extent={{-10,-10},{10,10}})));
  Modelica.Blocks.Continuous.CriticalDamping CD2 annotation(Placement(transformation(origin={40,0}, extent={{-10,-10},{10,10}})));
equation
  connect(CD1.y, CD2.u) annotation(Line(points={{-9,0},{28,0}}));
  connect(CD2.y, CD1.u);
end RenameTest;`;

    const ci = buildFallbackClassInstance(docText, "RenameTest")!;
    const edits = computeNameEdit(ci, "CD1", "FilterMain", docText);
    const updated = applyEditsToText(docText, edits);

    assert.ok(updated.includes("CriticalDamping FilterMain annotation("));
    assert.ok(updated.includes("connect(FilterMain.y, CD2.u)"));
    assert.ok(updated.includes("connect(CD2.y, FilterMain.u);"));
    assert.ok(!/\bCD1\b/.test(updated), `Old component name CD1 should be completely renamed:\n${updated}`);
    assert.strictEqual(
      typeof (parser.parse(updated).rootNode as any).hasError === "function"
        ? (parser.parse(updated).rootNode as any).hasError()
        : (parser.parse(updated).rootNode as any).hasError,
      false,
    );
  });

  it("handles multi-declarator component deletion cleanly without deleting sibling declarators", () => {
    const docText = `model MultiDecl
  Modelica.Electrical.Analog.Basic.Resistor R1, R2(R=50), R3;
equation
  connect(R1.n, R2.p);
  connect(R2.n, R3.p);
end MultiDecl;`;

    const ci = buildFallbackClassInstance(docText, "MultiDecl")!;
    const edits = computeComponentsDelete(docText, ci, ["R2"]);
    const updated = applyEditsToText(docText, edits);

    assert.ok(updated.includes("Resistor R1, R3;"), `Sibling declarators R1 and R3 must survive:\n${updated}`);
    assert.ok(!updated.includes("R2"), `R2 and its connections must be removed:\n${updated}`);
    assert.strictEqual(
      typeof (parser.parse(updated).rootNode as any).hasError === "function"
        ? (parser.parse(updated).rootNode as any).hasError()
        : (parser.parse(updated).rootNode as any).hasError,
      false,
    );
  });

  it("succeeds on all diagram edits even when the Modelica file has active syntax errors", () => {
    // Active syntax errors in user code:
    // - Missing semicolon on brokenParam
    // - Incomplete equation `brokenVar = sin(1 + ;` with unclosed parenthesis!
    let brokenDoc = `model BrokenSyntaxModel
  parameter Real brokenParam = 42
  Real brokenVar;
  Modelica.Electrical.Analog.Basic.Resistor R1(R=10) annotation(Placement(transformation(origin={-30,0}, extent={{-10,-10},{10,10}})));
equation
  brokenVar = sin(1 + ;
  annotation(Diagram(coordinateSystem(preserveAspectRatio=false)));
end BrokenSyntaxModel;`;

    // 1. Add component C1 before equation section
    let ci = buildFallbackClassInstance(brokenDoc, "BrokenSyntaxModel")!;
    assert.ok(ci, "Fallback class instance must resolve despite syntax errors");
    brokenDoc = applyEditsToText(
      brokenDoc,
      computeComponentInsert(ci, "Modelica.Electrical.Analog.Basic.Capacitor", "C1", 30, 0, brokenDoc),
    );
    assert.ok(brokenDoc.indexOf("Capacitor C1") < brokenDoc.indexOf("\nequation\n"));

    // 2. Connect R1.n -> C1.p inside equation section BEFORE class annotation(...)
    ci = buildFallbackClassInstance(brokenDoc, "BrokenSyntaxModel")!;
    brokenDoc = applyEditsToText(
      brokenDoc,
      computeConnectInsert(brokenDoc, ci, "R1.n", "C1.p", [
        { x: -20, y: 0 },
        { x: 20, y: 0 },
      ]),
    );
    assert.ok(brokenDoc.indexOf("connect(R1.n, C1.p)") > brokenDoc.indexOf("\nequation\n"));
    assert.ok(brokenDoc.indexOf("connect(R1.n, C1.p)") < brokenDoc.indexOf("annotation(Diagram("));

    // 3. Move R1
    ci = buildFallbackClassInstance(brokenDoc, "BrokenSyntaxModel")!;
    brokenDoc = applyEditsToText(
      brokenDoc,
      computePlacementEdits(brokenDoc, ci, [{ name: "R1", x: -60, y: -10, width: 20, height: 20 }]),
    );
    assert.ok(brokenDoc.includes("origin={-50,0}"));

    // 4. Move edge waypoints
    ci = buildFallbackClassInstance(brokenDoc, "BrokenSyntaxModel")!;
    brokenDoc = applyEditsToText(
      brokenDoc,
      computeEdgePointEdits(brokenDoc.split("\n"), ci, [
        {
          source: "R1.n",
          target: "C1.p",
          points: [
            { x: -40, y: 0 },
            { x: 20, y: 0 },
          ],
        },
      ]),
    );
    assert.ok(brokenDoc.includes("points={{-40,0}, {20,0}}"));

    // 5. Update parameter R on R1 and add C=1e-6 on C1
    ci = buildFallbackClassInstance(brokenDoc, "BrokenSyntaxModel")!;
    brokenDoc = applyEditsToText(brokenDoc, computeParameterEdit(ci, "R1", "R", "220", brokenDoc));
    ci = buildFallbackClassInstance(brokenDoc, "BrokenSyntaxModel")!;
    brokenDoc = applyEditsToText(brokenDoc, computeParameterEdit(ci, "C1", "C", "1e-6", brokenDoc));
    assert.ok(brokenDoc.includes("R1(R=220)"));
    assert.ok(brokenDoc.includes("C1(C=1e-6)"));

    // 6. Update description on C1
    ci = buildFallbackClassInstance(brokenDoc, "BrokenSyntaxModel")!;
    brokenDoc = applyEditsToText(brokenDoc, computeDescriptionEdit(brokenDoc, ci, "C1", "Filter cap"));
    assert.ok(brokenDoc.includes('C1(C=1e-6) "Filter cap"'));

    // 7. Disconnect R1.n -> C1.p
    ci = buildFallbackClassInstance(brokenDoc, "BrokenSyntaxModel")!;
    brokenDoc = applyEditsToText(brokenDoc, computeConnectRemove(brokenDoc, ci, "R1.n", "C1.p"));
    assert.ok(!brokenDoc.includes("connect(R1.n, C1.p)"));

    // User's in-progress broken equation is preserved untouched!
    assert.ok(brokenDoc.includes("brokenVar = sin(1 + ;"));
    assert.ok(scanModelicaClassLayout(brokenDoc, "BrokenSyntaxModel"));
  });

  it("locks valid saved 2-point straight connections in buildDiagramData while auto-routing self-impaling 2-point lines", async () => {
    const makeBlockDef = (name: string) => ({
      name,
      annotation: () => null,
      components: [
        {
          name: "u",
          isConnector: true,
          classInstance: { name: "RealInput", classKind: "connector", components: [], annotation: () => null },
          annotation: (k: string) =>
            k === "Placement"
              ? {
                  transformation: {
                    origin: [-110, 0],
                    extent: [
                      [-10, -10],
                      [10, 10],
                    ],
                  },
                }
              : null,
        },
        {
          name: "y",
          isConnector: true,
          classInstance: { name: "RealOutput", classKind: "connector", components: [], annotation: () => null },
          annotation: (k: string) =>
            k === "Placement"
              ? {
                  transformation: {
                    origin: [110, 0],
                    extent: [
                      [-10, -10],
                      [10, 10],
                    ],
                  },
                }
              : null,
        },
      ],
    });

    const blockDef = makeBlockDef("CriticalDamping");
    const mockModel: any = {
      name: "Untitled",
      annotation: () => null,
      components: [
        {
          name: "CriticalDamping1",
          typeName: "Modelica.Blocks.Continuous.CriticalDamping",
          classInstance: blockDef,
          annotation: (k: string) =>
            k === "Placement"
              ? {
                  transformation: {
                    origin: [-13, -6],
                    extent: [
                      [-10, -10],
                      [10, 10],
                    ],
                  },
                }
              : null,
        },
        {
          name: "CriticalDamping2",
          typeName: "Modelica.Blocks.Continuous.CriticalDamping",
          classInstance: blockDef,
          annotation: (k: string) =>
            k === "Placement"
              ? {
                  transformation: {
                    origin: [-85, -6],
                    extent: [
                      [-10, -10],
                      [10, 10],
                    ],
                  },
                }
              : null,
        },
      ],
      connectEquations: [
        {
          // Valid straight connection between facing ports CD1.u (-24,-6) and CD2.y (-74,-6)
          lhs: "CriticalDamping1.u",
          rhs: "CriticalDamping2.y",
          annotation: (k: string) =>
            k === "Line"
              ? {
                  points: [
                    [-24, -6],
                    [-74, -6],
                  ],
                }
              : null,
        },
        {
          // Broken self-impaling 2-point connection cutting through both blocks CD1.y (-2,-6) -> CD2.u (-96,-6)
          lhs: "CriticalDamping1.y",
          rhs: "CriticalDamping2.u",
          annotation: (k: string) =>
            k === "Line"
              ? {
                  points: [
                    [-2, -6],
                    [-96, -6],
                  ],
                }
              : null,
        },
      ],
    };

    const diagram = await buildDiagramData(mockModel);
    assert.strictEqual(diagram.edges.length, 2);

    const forwardEdge = diagram.edges.find((e) => e.source.port === "u" && e.target.port === "y")!;
    const feedbackEdge = diagram.edges.find((e) => e.source.port === "y" && e.target.port === "u")!;

    assert.strictEqual(
      forwardEdge.router,
      undefined,
      "Valid straight 2-point connection must NOT retain live auto-router so later edits never reroute it",
    );
    assert.strictEqual(
      feedbackEdge.router?.name,
      "port-orthogonal-astar",
      "Self-impaling 2-point connection must keep port-orthogonal-astar so it auto-heals around components",
    );
  });

  it("computeMinimalNonOverlappingEdits produces independent non-overlapping hunks", () => {
    const before = `model TwoHunks
  Real a;
equation
  a = 1;
end TwoHunks;`;
    const after = `model TwoHunks
  Real a;
  Real b;
equation
  a = 1;
  b = 2;
end TwoHunks;`;

    const edits = computeMinimalNonOverlappingEdits(before, after);
    assert.strictEqual(edits.length, 2, "Should split top declaration insert and bottom equation insert into 2 hunks");
    assert.strictEqual(applyEditsToText(before, edits), after);
  });
});

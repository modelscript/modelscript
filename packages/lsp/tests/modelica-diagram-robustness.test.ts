// SPDX-License-Identifier: AGPL-3.0-or-later

import * as modelicaDiagramOps from "@modelscript/modelica/diagram";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GenericDSLDiagramBackend, ModelicaDiagramBackend, processDiagramEditBatch } from "../src/diagramApi.js";

(globalThis as any).modelicaDiagramOps = modelicaDiagramOps;

describe("LSP Modelica Diagram Batch Sequential Execution & Syntax-Error Resilience", () => {
  it("applies multiple addComponent and connect actions in a single batch with zero dropped edits or duplicated equation headers", () => {
    const initialCode = `model Untitled
  annotation(Icon(coordinateSystem(preserveAspectRatio=false)), Diagram(coordinateSystem(preserveAspectRatio=false)));
end Untitled;
`;

    const ci = modelicaDiagramOps.buildFallbackClassInstance(initialCode, "Untitled");
    const res = processDiagramEditBatch(
      {
        uri: "file:///Untitled.mo",
        seq: 1,
        actions: [
          {
            type: "addComponent",
            className: "Modelica.Blocks.Continuous.CriticalDamping",
            x: -13,
            y: 6,
          },
          {
            type: "addComponent",
            className: "Modelica.Blocks.Continuous.CriticalDamping",
            x: -85,
            y: 6,
          },
          {
            type: "connect",
            source: "CriticalDamping1.u",
            target: "CriticalDamping2.y",
            points: [
              { x: -25, y: 6 },
              { x: -73, y: 6 },
            ],
          },
          {
            type: "connect",
            source: "CriticalDamping1.y",
            target: "CriticalDamping2.u",
            points: [
              { x: -1, y: 6 },
              { x: 10, y: 6 },
              { x: 10, y: -20 },
              { x: -110, y: -20 },
              { x: -110, y: 6 },
              { x: -97, y: 6 },
            ],
          },
        ],
      },
      ci,
      initialCode,
    );

    assert.ok(res.edits.length > 0, "Batch must produce edits");
    const updated = modelicaDiagramOps.applyEditsToText(initialCode, res.edits);

    // Both components must exist with distinct auto-generated names
    assert.ok(updated.includes("CriticalDamping1"), `Missing CriticalDamping1:\n${updated}`);
    assert.ok(updated.includes("CriticalDamping2"), `Missing CriticalDamping2:\n${updated}`);

    // Exactly ONE equation keyword must be generated
    const eqMatches = updated.match(/^\s*equation\s*$/gm) ?? [];
    assert.strictEqual(eqMatches.length, 1, `Expected 1 equation header, got ${eqMatches.length}:\n${updated}`);

    // Both connections must exist
    assert.ok(updated.includes("connect(CriticalDamping1.u, CriticalDamping2.y)"));
    assert.ok(updated.includes("connect(CriticalDamping1.y, CriticalDamping2.u)"));

    // Class-level annotation(...) must remain at the bottom right before end Untitled;
    assert.ok(updated.indexOf("annotation(Icon(") > updated.indexOf("connect(CriticalDamping1.y, CriticalDamping2.u)"));
    assert.ok(updated.indexOf("end Untitled;") > updated.indexOf("annotation(Icon("));
  });

  it("heals stranded top-level class annotation(...) during batch editing", () => {
    const strandedCode = `model Untitled
  annotation(Icon(coordinateSystem(preserveAspectRatio=false)), Diagram(coordinateSystem(preserveAspectRatio=false)));
  Modelica.Blocks.Continuous.CriticalDamping CriticalDamping1 annotation(Placement(transformation(origin={-13,-6}, extent={{-10,-10},{10,10}})));
end Untitled;
`;

    const ci = modelicaDiagramOps.buildFallbackClassInstance(strandedCode, "Untitled");
    const res = processDiagramEditBatch(
      {
        uri: "file:///Untitled.mo",
        seq: 2,
        actions: [
          {
            type: "addComponent",
            className: "Modelica.Blocks.Continuous.CriticalDamping",
            x: -85,
            y: 6,
          },
        ],
      },
      ci,
      strandedCode,
    );

    const updated = modelicaDiagramOps.applyEditsToText(strandedCode, res.edits);
    const idxCD1 = updated.indexOf("CriticalDamping1");
    const idxCD2 = updated.indexOf("CriticalDamping2");
    const idxAnn = updated.indexOf("annotation(Icon(");
    const idxEnd = updated.indexOf("end Untitled;");

    assert.ok(idxCD1 > 0 && idxCD2 > idxCD1);
    assert.ok(idxAnn > idxCD2, `Stranded class annotation must be moved after components:\n${updated}`);
    assert.ok(idxEnd > idxAnn);
  });

  it("handles reconnect and move + updateParameter batches without overlapping or dropped edits", () => {
    const docText = `model ReconnectBatch
  Modelica.Electrical.Analog.Basic.Resistor R1(R=10) annotation(Placement(transformation(origin={-30,0}, extent={{-10,-10},{10,10}})));
  Modelica.Electrical.Analog.Basic.Capacitor C1 annotation(Placement(transformation(origin={30,0}, extent={{-10,-10},{10,10}})));
  Modelica.Electrical.Analog.Basic.Ground G1 annotation(Placement(transformation(origin={30,-40}, extent={{-10,-10},{10,10}})));
equation
  connect(R1.n, C1.p) annotation(Line(points={{-20,0},{20,0}}));
end ReconnectBatch;`;

    const ci = modelicaDiagramOps.buildFallbackClassInstance(docText, "ReconnectBatch");
    const res = processDiagramEditBatch(
      {
        uri: "file:///ReconnectBatch.mo",
        seq: 3,
        actions: [
          {
            type: "move",
            items: [{ name: "R1", x: -50, y: -10, width: 20, height: 20 }],
          },
          {
            type: "updateParameter",
            name: "R1",
            parameter: "R",
            value: "470",
          },
          {
            type: "reconnect",
            oldSource: "R1.n",
            oldTarget: "C1.p",
            newSource: "R1.n",
            newTarget: "G1.p",
            points: [
              { x: -30, y: 0 },
              { x: 30, y: 30 },
            ],
          },
        ],
      },
      ci,
      docText,
    );

    const updated = modelicaDiagramOps.applyEditsToText(docText, res.edits);
    assert.ok(updated.includes("R1(R=470)"), `Parameter update missing:\n${updated}`);
    assert.ok(updated.includes("origin={-40,0}"), `Placement move missing:\n${updated}`);
    assert.ok(!updated.includes("connect(R1.n, C1.p)"), `Old connection should be removed:\n${updated}`);
    assert.ok(updated.includes("connect(R1.n, G1.p)"), `New connection should be inserted:\n${updated}`);
    assert.strictEqual((updated.match(/^\s*equation\s*$/gm) ?? []).length, 1);
  });

  it("ModelicaDiagramBackend.applyEdits succeeds when documentInstances is empty due to syntax errors and respects className", async () => {
    const multiClassBrokenDoc = `model FirstModel
  Real a = ;
end FirstModel;

model SecondModel
  Modelica.Electrical.Analog.Basic.Resistor R1 annotation(Placement(transformation(origin={0,0}, extent={{-10,-10},{10,10}})));
equation
  x = (1 + ;
end SecondModel;`;

    const backend = new ModelicaDiagramBackend({
      getDocumentInstances: () => [],
      getDocumentText: () => multiClassBrokenDoc,
      resolveClassInstance: () => null,
      flushValidation: async () => {},
      isDocumentStale: () => false,
    });

    const res = await backend.applyEdits({
      uri: "file:///MultiBroken.mo",
      className: "SecondModel",
      seq: 7,
      actions: [
        {
          type: "addComponent",
          className: "Modelica.Electrical.Analog.Basic.Capacitor",
          x: 40,
          y: 0,
        },
        {
          type: "connect",
          source: "R1.n",
          target: "Capacitor1.p",
          points: [
            { x: 10, y: 0 },
            { x: 30, y: 0 },
          ],
        },
      ],
    });

    assert.ok(res.edits.length > 0, "Expected edits even when documentInstances is empty due to syntax errors");
    const updated = modelicaDiagramOps.applyEditsToText(multiClassBrokenDoc, res.edits);

    // FirstModel must remain untouched, SecondModel gets Capacitor1 and connect(...)
    const idxSecond = updated.indexOf("model SecondModel");
    assert.ok(updated.indexOf("Capacitor Capacitor1") > idxSecond);
    assert.ok(updated.indexOf("connect(R1.n, Capacitor1.p)") > updated.indexOf("x = (1 + ;"));
  });

  it("GenericDSLDiagramBackend replaces nested inline Placement and multi-point reconnect braces without trailing garbage", async () => {
    const inlineDoc = `block System
  part R1 annotation(Placement(transformation(origin={0,0}, extent={{-10,-10},{10,10}})));
  part C1 annotation(Placement(transformation(origin={40,0}, extent={{-10,-10},{10,10}})));
  connect(R1.n, C1.p) annotation(Line(points={{10, 0}, {20, 0}, {30, 0}}));
end`;

    const generic = new GenericDSLDiagramBackend({
      getDocumentText: () => inlineDoc,
      getDiagramConfig: () => ({
        placement: {
          persistence: "inline",
          formatPlacement: (x: number, y: number) =>
            `annotation(Placement(transformation(origin={${Math.round(x)},${Math.round(y)}}, extent={{-10,-10},{10,10}})))`,
        },
      }),
    });

    const moveRes = await generic.applyEdits({
      uri: "file:///inline.dsl",
      seq: 1,
      actions: [
        {
          type: "move",
          items: [{ name: "R1", x: 15, y: 25, width: 20, height: 20 }],
        },
        {
          type: "reconnect",
          oldSource: "R1",
          oldSourcePort: "n",
          oldTarget: "C1",
          oldTargetPort: "p",
          newSource: "C1",
          newSourcePort: "p",
          newTarget: "R1",
          newTargetPort: "n",
          points: [
            { x: 30, y: 5 },
            { x: 15, y: 5 },
          ],
        },
      ],
    });

    const updated = modelicaDiagramOps.applyEditsToText(inlineDoc, moveRes.edits);
    assert.ok(
      updated.includes("part R1 annotation(Placement(transformation(origin={15,25}, extent={{-10,-10},{10,10}})));"),
      `Inline placement left trailing parens or corrupted line:\n${updated}`,
    );
    assert.ok(
      updated.includes("connect(C1.p, R1.n) annotation(Line(points={{30, 5}, {15, 5}}));"),
      `Reconnect points replacement left trailing braces:\n${updated}`,
    );
  });
});

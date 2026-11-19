// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { buildDiagramData } from "../src/diagram/data.js";
import {
  applyEditsToText,
  buildFallbackClassInstance,
  computeComponentInsert,
  computeComponentsDelete,
  computeConnectInsert,
  computeNameEdit,
  computeParameterEdit,
  computePlacementEdits,
} from "../src/diagram/edits.js";
import { renderIconSvgString } from "../src/diagram/svg.js";
import { EllipseClosure, FillPattern } from "../src/diagram/types.js";
import { modelicaWriteback } from "../src/writeback.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

describe("Modelica P0 Diagram, Writeback & Flattener Regressions", async () => {
  const { parser } = await createWasmParser(modelicaWasm);
  Context.registerParser(".mo", parser as any);

  it("keeps port angles and text upright under combined flipX and rotation and maps top-level connector edges", async () => {
    const portPinClass = {
      name: "RealInput",
      classKind: "connector",
      components: [],
      annotation: (k: string) =>
        k === "Icon"
          ? {
              coordinateSystem: {
                extent: [
                  [-100, -100],
                  [100, 100],
                ],
              },
              graphics: [
                {
                  "@type": "Polygon",
                  points: [
                    [-100, 100],
                    [100, 0],
                    [-100, -100],
                  ],
                },
              ],
            }
          : null,
    };

    const gainClass = {
      name: "Gain",
      classKind: "block",
      components: [
        {
          name: "u",
          typeName: "Modelica.Blocks.Interfaces.RealInput",
          classInstance: portPinClass,
          annotation: (k: string) =>
            k === "Placement"
              ? {
                  transformation: {
                    extent: [
                      [-120, -20],
                      [-80, 20],
                    ],
                    rotation: 0,
                  },
                }
              : null,
        },
      ],
      annotation: (k: string) =>
        k === "Icon"
          ? {
              coordinateSystem: {
                extent: [
                  [-100, -100],
                  [100, 100],
                ],
              },
              graphics: [
                {
                  "@type": "Text",
                  extent: [
                    [-50, -20],
                    [50, 20],
                  ],
                  textString: "Gain",
                },
              ],
            }
          : null,
    };

    const mockClass = {
      name: "TopModel",
      components: [
        {
          name: "u",
          typeName: "Modelica.Blocks.Interfaces.RealInput",
          classInstance: portPinClass,
          annotation: (k: string) =>
            k === "Placement"
              ? {
                  transformation: {
                    extent: [
                      [-120, -20],
                      [-80, 20],
                    ],
                  },
                }
              : null,
        },
        {
          name: "g",
          typeName: "Modelica.Blocks.Math.Gain",
          classInstance: gainClass,
          annotation: (k: string) =>
            k === "Placement"
              ? {
                  transformation: {
                    origin: [0, 0],
                    extent: [
                      [10, -10],
                      [-10, 10],
                    ],
                    rotation: 45,
                  },
                }
              : null,
        },
      ],
      connectEquations: [{ lhs: "u", rhs: "g.u" }],
    };

    const data = await buildDiagramData(mockClass as any);
    assert.strictEqual(data.edges.length, 1);
    assert.strictEqual(data.edges[0]!.source.cell, "u");
    assert.strictEqual(data.edges[0]!.source.port, "", "Top-level RealInput connector edge must have empty sourcePort");
    assert.strictEqual(data.edges[0]!.target.cell, "g");
    assert.strictEqual(data.edges[0]!.target.port, "u");

    const gainNode = data.nodes.find((n) => n.id === "g")!;
    assert.ok(gainNode, "g node must exist");
    const portItems = Array.isArray(gainNode.ports) ? gainNode.ports : ((gainNode.ports as any)?.items ?? []);
    const portU = portItems.find((p: any) => p.id === "u");
    assert.ok(portU, "g.u port must exist");
    const markupStr = JSON.stringify(portU.attrs || portU.markup || "");
    assert.ok(markupStr.includes("scale(-1, 1)") || gainNode.data?.["flipX"], "Flipped component port must track flip");
    assert.ok(
      JSON.stringify(gainNode.markup || "").includes("rotate(45 "),
      "Text counter-rotation must equal +45 deg to cancel node.angle=-45 even when flipX=true",
    );
  });

  it("preserves Placement iconTransformation/visible and handles NaN coordinates + block-comment connect + multi-declarators", () => {
    let code = `model TestM
  Resistor R1 annotation(Placement(visible=false, transformation(origin={0,0}, extent={{-10,-10},{10,10}}), iconTransformation(origin={0,0}, extent={{-20,-20},{20,20}})));
  Resistor R2(v(start=0, fixed=true), R(unit="Ohm") = 10), R3(R = 20);
equation
  connect(R1.p, R2.p); /* trailing
    block comment */
end TestM;`;

    // 1. Placement edit preserves visible=false and iconTransformation, and guards NaN width/height
    const ci1 = buildFallbackClassInstance(code, "TestM")!;
    const plEdits = computePlacementEdits(code, ci1, [
      { name: "R1", x: 10, y: -30, width: Number.NaN, height: Number.NaN, rotation: 0 },
    ]);
    code = applyEditsToText(code, plEdits);
    assert.ok(code.includes("visible=false"), "Must preserve visible=false");
    assert.ok(code.includes("iconTransformation(origin={0,0}"), "Must preserve iconTransformation");
    assert.ok(!code.includes("NaN"), "Must never emit NaN in Placement");

    // 2. connect() insertion advances past multi-line block comment
    const ci2 = buildFallbackClassInstance(code, "TestM")!;
    const connEdits = computeConnectInsert(code, ci2, "R2.n", "R3.p");
    code = applyEditsToText(code, connEdits);
    const commentClose = code.indexOf("*/");
    const newConnIdx = code.indexOf("connect(R2.n, R3.p)");
    assert.ok(commentClose > 0 && newConnIdx > commentClose, "New connect() must be after closing */");

    // 3. Dotted parameter edit updates R2.v(start=...) and preserves R(unit="Ohm")
    const ci3 = buildFallbackClassInstance(code, "TestM")!;
    const pEditStart = computeParameterEdit(ci3, "R2", "v.start", "5", code);
    code = applyEditsToText(code, pEditStart);
    assert.ok(code.includes("v(start=5, fixed=true)"), "Must update nested v(start=...) without duplicate v.start");
    assert.ok(!code.includes("v.start"), "Must not append redundant v.start=");

    const ci4 = buildFallbackClassInstance(code, "TestM")!;
    const pEditUnit = computeParameterEdit(ci4, "R2", "R", "50", code);
    code = applyEditsToText(code, pEditUnit);
    assert.ok(code.includes('R(unit="Ohm") = 50'), 'Must preserve nested (unit="Ohm") on R=');

    // 4. Deleting one declarator from multi-declarator clause preserves sibling R2
    const ci5 = buildFallbackClassInstance(code, "TestM")!;
    const delEdits = computeComponentsDelete(code, ci5, ["R3"]);
    code = applyEditsToText(code, delEdits);
    assert.ok(code.includes("Resistor R2"), "Deleting R3 must preserve R2 in same clause");
    assert.ok(!code.includes("R3"), "R3 must be deleted");
  });

  it("writeback handles String parameters, multi-modifiers, and preserves trailing annotations", () => {
    const src = `model WB
  parameter Real R(unit="Ohm") = 100 "res" annotation(Evaluate=true);
  parameter String label = "hello; world" annotation(Dialog(tab="General"));
end WB;`;

    const rStart = src.indexOf("parameter Real R");
    const rEnd = src.indexOf("annotation(Evaluate=true);", rStart) + "annotation(Evaluate=true);".length;
    const rawR = modelicaWriteback({
      entry: { name: "R", startOffset: rStart, endOffset: rEnd } as any,
      fullText: src,
      newValue: "250",
      uri: "file:///WB.mo",
    } as any);
    const editsR = Array.isArray(rawR) ? rawR : rawR ? [rawR] : [];
    assert.strictEqual(editsR.length, 1);
    const updatedR = src.slice(0, editsR[0]!.startOffset) + editsR[0]!.newText + src.slice(editsR[0]!.endOffset);
    assert.ok(
      updatedR.includes('R(unit="Ohm") = 250'),
      'Writeback must update binding without clobbering (unit="Ohm")',
    );
    assert.ok(updatedR.includes("annotation(Evaluate=true)"), "Writeback must preserve trailing annotation");

    const strStart = src.indexOf("parameter String label");
    const strEnd = src.indexOf("));", strStart) + 3;
    const rawS = modelicaWriteback({
      entry: { name: "label", startOffset: strStart, endOffset: strEnd } as any,
      fullText: src,
      newValue: '"bye"',
      uri: "file:///WB.mo",
    } as any);
    const editsS = Array.isArray(rawS) ? rawS : rawS ? [rawS] : [];
    assert.strictEqual(editsS.length, 1);
    const updatedS = src.slice(0, editsS[0]!.startOffset) + editsS[0]!.newText + src.slice(editsS[0]!.endOffset);
    assert.ok(updatedS.includes('label = "bye" annotation(Dialog(tab="General"));'));
  });

  it("incremental patching handles Integer parameters and clones bodySnapshot safely", () => {
    const fs = new NodeFileSystem();
    const ctx = new Context(fs);
    const uri = "file:///test/IntParam.mo";
    const s1 = `model IntParam
  parameter Integer n = 3;
  Real x(start = 1.0);
equation
  der(x) = -x;
end IntParam;`;
    ctx.load(s1, uri);
    const d1 = ctx.flattenArena("IntParam", undefined, uri);
    assert.ok(d1);

    const s2 = `model IntParam
  parameter Integer n = 7;
  Real x(start = 1.0);
equation
  der(x) = -x;
end IntParam;`;
    ctx.load(s2, uri);
    const d2 = ctx.flattenArena("IntParam", undefined, uri);
    assert.ok(d2);
    const nIdx = d2.lookupVariable("n");
    assert.ok(nIdx >= 0);
    assert.strictEqual(d2.getVarStartValue(nIdx), 7);
  });

  it("computeNameEdit renames non-dotted body references while skipping member access, LHS mod keys, strings, and comments", () => {
    const src = `model RenameRefTest
  parameter Real R1 = 10;
  Real y;
  // R1 in comment should stay R1
  Modelica.Electrical.Analog.Basic.Resistor r_load(R = R1) "label R1";
  MyBlock other(R1 = 5);
equation
  y = R1 + other.R1 + r_load.R;
end RenameRefTest;`;
    const ci: any = buildFallbackClassInstance(src, "RenameRefTest");
    const edits = computeNameEdit(ci, "R1", "R_base", src);
    const updated = applyEditsToText(src, edits);

    assert.ok(updated.includes("parameter Real R_base = 10;"), "Declaration must be renamed");
    assert.ok(updated.includes("// R1 in comment should stay R1"), "Comment must stay untouched");
    assert.ok(updated.includes('"label R1"'), "String literal must stay untouched");
    assert.ok(updated.includes("(R = R_base)"), "RHS modifier reference must be renamed");
    assert.ok(updated.includes("other(R1 = 5)"), "LHS parameter key name on other block must NOT be renamed");
    assert.ok(
      updated.includes("y = R_base + other.R1 + r_load.R;"),
      "Equation non-dotted R1 must be renamed while other.R1 stays",
    );
  });

  it("computeComponentInsert uses componentIconCoord instead of parent Diagram canvas extent", () => {
    const src = `model HugeCanvas
  annotation(Diagram(coordinateSystem(extent={{-1000,-1000},{1000,1000}}, initialScale=0.5)));
end HugeCanvas;`;
    const ci: any = buildFallbackClassInstance(src, "HugeCanvas");
    const edits = computeComponentInsert(ci, "Custom.Sensor", "sens1", 50, -20, src, {
      extent: [
        [-60, -30],
        [60, 30],
      ],
      initialScale: 0.25,
    });
    const updated = applyEditsToText(src, edits);
    // 120x60 * 0.25 = 30x15 -> half extents = 15, 7.5
    assert.ok(
      updated.includes(
        "Custom.Sensor sens1 annotation(Placement(transformation(origin={50,20}, extent={{-15,-7.5},{15,7.5}})));",
      ),
      `Expected Icon extent {{-15,-7.5},{15,7.5}}, got:\n${updated}`,
    );
  });

  it("renderIconSvgString applies §18.6.4 rotation before origin translation and keeps unfilled CLOSURE_AUTOMATIC arcs open", () => {
    const fakeClassInstance: any = {
      name: "ArcAndPivotIcon",
      annotation: (name: string) =>
        name === "Icon"
          ? {
              coordinateSystem: {
                extent: [
                  [-100, -100],
                  [100, 100],
                ],
              },
              graphics: [
                {
                  "@type": "Rectangle",
                  origin: [50, 0],
                  rotation: 90,
                  extent: [
                    [0, -10],
                    [20, 10],
                  ],
                },
                {
                  "@type": "Ellipse",
                  extent: [
                    [-20, -20],
                    [20, 20],
                  ],
                  startAngle: 0,
                  endAngle: 180,
                  closure: EllipseClosure.AUTOMATIC,
                  fillPattern: FillPattern.NONE,
                },
                {
                  "@type": "Ellipse",
                  extent: [
                    [-10, -10],
                    [10, 10],
                  ],
                  startAngle: 0,
                  endAngle: 90,
                  closure: EllipseClosure.AUTOMATIC,
                  fillPattern: FillPattern.SOLID,
                },
              ],
            }
          : null,
    };

    const svg = renderIconSvgString(fakeClassInstance, 100) ?? "";
    assert.ok(
      svg.includes('x="0" y="-10"') && svg.includes('transform="translate(50, 0) rotate(-90)"'),
      `Expected Rectangle local x=0, y=-10 with translate(50, 0) rotate(-90), got:\n${svg}`,
    );
    assert.ok(
      svg.includes('d="M 20 0 A 20 20 0 0 0 -20'),
      `Expected unfilled CLOSURE_AUTOMATIC arc to stay open without center radial line, got:\n${svg}`,
    );
    assert.ok(
      svg.includes('d="M 0 0 L 10 0 A 10 10 0 0 0'),
      `Expected filled CLOSURE_AUTOMATIC arc to close radially to center, got:\n${svg}`,
    );
  });

  it("synthesizes expandable connector bus ports and binds subscripted vector pin edges", async () => {
    const busClass = {
      name: "ControlBus",
      classKind: "expandable connector",
      components: [],
      annotation: () => ({
        coordinateSystem: {
          extent: [
            [-100, -100],
            [100, 100],
          ],
        },
        graphics: [],
      }),
    } as any;
    const gainClass = {
      name: "VectorGain",
      classKind: "block",
      components: [
        {
          name: "y",
          classInstance: { name: "RealOutput", classKind: "connector", components: [], annotation: () => null },
          annotation: (type: string) =>
            type === "Placement"
              ? {
                  transformation: {
                    extent: [
                      [100, -10],
                      [120, 10],
                    ],
                  },
                }
              : null,
        },
      ],
      annotation: () => ({
        coordinateSystem: {
          extent: [
            [-100, -100],
            [100, 100],
          ],
        },
        graphics: [],
      }),
    } as any;
    const systemClass = {
      name: "BusSystem",
      classKind: "model",
      components: [
        {
          name: "bus",
          classInstance: busClass,
          annotation: (type: string) =>
            type === "Placement"
              ? {
                  transformation: {
                    extent: [
                      [20, -40],
                      [40, 40],
                    ],
                  },
                }
              : null,
        },
        {
          name: "gain",
          classInstance: gainClass,
          annotation: (type: string) =>
            type === "Placement"
              ? {
                  transformation: {
                    extent: [
                      [-60, -20],
                      [-20, 20],
                    ],
                  },
                }
              : null,
        },
      ],
      connectEquations: [{ lhs: "gain.y[1]", rhs: "bus.speed", annotation: () => null }],
      annotation: () => ({
        coordinateSystem: {
          extent: [
            [-100, -100],
            [100, 100],
          ],
        },
        graphics: [],
      }),
    } as any;

    const diag = await buildDiagramData(systemClass);
    const busNode = diag.nodes.find((n: any) => n.id === "bus") as any;
    assert.ok(busNode, "bus node should exist");
    const portItems = Array.isArray(busNode.ports) ? busNode.ports : (busNode.ports?.items ?? []);
    const busPortIds = portItems.map((p: any) => p.id);
    assert.ok(busPortIds.includes("speed"), `Expected synthesized expandable bus port 'speed', got ${busPortIds}`);

    assert.strictEqual(diag.edges.length, 1);
    assert.strictEqual((diag.edges[0] as any).source.cell, "gain");
    assert.strictEqual((diag.edges[0] as any).source.port, "y");
    assert.strictEqual((diag.edges[0] as any).target.cell, "bus");
    assert.strictEqual((diag.edges[0] as any).target.port, "speed");
  });
});

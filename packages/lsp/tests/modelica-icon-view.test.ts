// SPDX-License-Identifier: AGPL-3.0-or-later

import * as modelicaDiagramOps from "@modelscript/modelica/diagram";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ModelicaDiagramBackend } from "../src/diagramApi.js";

(globalThis as unknown as { modelicaDiagramOps: typeof modelicaDiagramOps }).modelicaDiagramOps = modelicaDiagramOps;

describe("Modelica Icon Layer (diagramType === 'icon')", () => {
  it("renders Icon graphics and public connector ports while hiding internal components and connect edges", async () => {
    const uri = "file:///workspace/TestIconView.mo";
    const connectorClass = {
      name: "Pin",
      classKind: "connector",
      components: [],
      extendsClassInstances: [],
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
                  extent: [
                    [-100, -100],
                    [100, 100],
                  ],
                  fillColor: [0, 0, 255],
                  fillPattern: "Solid",
                },
              ],
            }
          : null,
    };

    const internalClass = {
      name: "InternalBlock",
      classKind: "model",
      components: [],
      extendsClassInstances: [],
      annotation: () => null,
    };

    const rootClass = {
      name: "TestComponent",
      classKind: "model",
      components: [
        {
          name: "a",
          visibility: "public",
          classInstance: connectorClass,
          annotation: (name: string) =>
            name === "Placement"
              ? {
                  transformation: {
                    extent: [
                      [-10, -10],
                      [10, 10],
                    ],
                  },
                  iconTransformation: {
                    extent: [
                      [-110, -10],
                      [-90, 10],
                    ],
                  },
                }
              : null,
        },
        {
          name: "inner1",
          visibility: "public",
          classInstance: internalClass,
          annotation: (name: string) =>
            name === "Placement"
              ? {
                  transformation: {
                    extent: [
                      [-20, -20],
                      [20, 20],
                    ],
                  },
                }
              : null,
        },
      ],
      connectEquations: [
        {
          lhs: "a",
          rhs: "inner1",
          annotation: () => ({
            points: [
              [-10, 0],
              [0, 0],
            ],
          }),
        },
      ],
      extendsClassInstances: [],
      annotation: (name: string) => {
        if (name === "Icon") {
          return {
            coordinateSystem: {
              extent: [
                [-100, -100],
                [100, 100],
              ],
            },
            graphics: [
              {
                "@type": "Rectangle",
                extent: [
                  [-80, -50],
                  [80, 50],
                ],
                lineColor: [0, 128, 255],
                fillColor: [240, 248, 255],
                fillPattern: "Solid",
              },
            ],
          };
        }
        if (name === "Diagram") {
          return {
            coordinateSystem: {
              extent: [
                [-100, -100],
                [100, 100],
              ],
            },
          };
        }
        return null;
      },
    };

    const backend = new ModelicaDiagramBackend({
      getDocumentInstances: () => [rootClass],
      getDocumentText: () => `model TestComponent
  annotation(
    Icon(
      coordinateSystem(extent={{-100,-100},{100,100}}),
      graphics={
        Rectangle(extent={{-80,-50},{80,50}}, lineColor={0,128,255}, fillColor={240,248,255}, fillPattern=FillPattern.Solid)
      }
    )
  );
end TestComponent;`,
      resolveClassInstance: () => rootClass,
      flushValidation: async () => {},
    });

    const diagramMode = await backend.getData({ uri, diagramType: "diagram" });
    assert.ok(diagramMode, "Diagram mode must return data");
    assert.ok(
      diagramMode.nodes.some((n) => n.id === "inner1"),
      "Diagram mode should include internal components",
    );
    assert.ok(diagramMode.edges.length > 0, "Diagram mode should include connect edges");

    const iconMode = await backend.getData({ uri, diagramType: "icon" });
    assert.ok(iconMode, "Icon mode must return data");
    assert.equal(iconMode.metadata?.["diagramType"], "icon");
    assert.equal(iconMode.edges.length, 0, "Icon mode must not include connect edges");
    assert.ok(!iconMode.nodes.some((n) => n.id === "inner1"), "Icon mode must exclude non-connector components");
    assert.ok(
      iconMode.nodes.some((n) => n.id === "__icon_gfx_0"),
      "Icon mode must emit selectable __icon_gfx_0 node",
    );
    assert.ok(
      iconMode.nodes.some((n) => n.id === "a"),
      "Icon mode must include public connector 'a'",
    );

    const addRes = await backend.applyEdits({
      uri,
      seq: 1,
      actions: [
        {
          type: "addIconPrimitive",
          primitive: {
            "@type": "Ellipse",
            extent: [
              [-40, -40],
              [40, 40],
            ],
            lineColor: [0, 128, 255],
            fillColor: [255, 255, 255],
            fillPattern: "FillPattern.Solid",
          },
        },
      ],
    });
    assert.equal(addRes.renderHint, "immediate");
    assert.equal(addRes.edits.length, 1);
    assert.ok(addRes.edits[0]!.newText.includes("Ellipse("), "addIconPrimitive must insert Ellipse into Icon graphics");

    const moveRes = await backend.applyEdits({
      uri,
      seq: 2,
      actions: [
        {
          type: "move",
          items: [{ name: "__icon_gfx_0", x: -60, y: -40, width: 120, height: 80 }],
        },
      ],
    });
    assert.equal(moveRes.renderHint, "immediate");
    assert.ok(moveRes.edits.length === 1);
  });

  it("creates annotation(Icon(...)) automatically when adding a primitive to a bare model", async () => {
    const uri = "file:///workspace/BareModel.mo";
    const bareSource = `model BareModel\n  Real x;\nend BareModel;\n`;
    const bareClass = {
      name: "BareModel",
      classKind: "model",
      components: [],
      extendsClassInstances: [],
      annotation: () => null,
    };
    const backend = new ModelicaDiagramBackend({
      getDocumentInstances: () => [bareClass],
      getDocumentText: () => bareSource,
      resolveClassInstance: () => bareClass,
      flushValidation: async () => {},
    });
    const res = await backend.applyEdits({
      uri,
      seq: 1,
      actions: [
        {
          type: "addIconPrimitive",
          primitive: {
            "@type": "Rectangle",
            extent: [
              [-80, -60],
              [80, 60],
            ],
            lineColor: [8, 145, 178],
            fillColor: [224, 242, 254],
            fillPattern: "FillPattern.Solid",
          },
        },
      ],
    });
    assert.equal(res.edits.length, 1);
    assert.ok(res.edits[0]!.newText.includes("annotation(\n    Icon("));
    assert.ok(res.edits[0]!.newText.includes("Rectangle("));
    assert.ok(res.edits[0]!.newText.includes("end BareModel;"));
  });
});

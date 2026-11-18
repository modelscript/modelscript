// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { computeSolderDots } from "../../../packages/diagram/src/solder-dots.js";
import { buildDiagramData, evaluateMacroExpression } from "../src/diagram/data.js";
import { ModelicaClassKind } from "../src/types.js";

function findInMarkup(node: any, pred: (n: any) => boolean): any[] {
  const out: any[] = [];
  if (!node || typeof node !== "object") return out;
  if (pred(node)) out.push(node);
  if (Array.isArray(node.children)) {
    for (const ch of node.children) {
      out.push(...findInMarkup(ch, pred));
    }
  }
  return out;
}

describe("OMEdit Diagram Rendering Parity", () => {
  it("places ports accurately for asymmetric Icon coordinateSystem.extent (MultiSwitch)", async () => {
    const boolIn: any = { name: "BooleanInput", classKind: ModelicaClassKind.CONNECTOR, annotation: () => null };
    const boolOut: any = { name: "BooleanOutput", classKind: ModelicaClassKind.CONNECTOR, annotation: () => null };

    const multiSwitch: any = {
      name: "MultiSwitch",
      classKind: ModelicaClassKind.BLOCK,
      components: [
        {
          name: "u",
          classInstance: boolIn,
          annotation: (k: string) =>
            k === "Placement"
              ? {
                  transformation: {
                    extent: [
                      [-110, 30],
                      [-90, -30],
                    ],
                  },
                }
              : null,
        },
        {
          name: "y",
          classInstance: boolOut,
          annotation: (k: string) =>
            k === "Placement"
              ? {
                  transformation: {
                    extent: [
                      [300, -10],
                      [320, 10],
                    ],
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
                  [300, 100],
                ],
              },
              graphics: [
                {
                  "@type": "Rectangle",
                  extent: [
                    [-100, -51],
                    [300, 50],
                  ],
                  lineColor: [255, 127, 0],
                  lineThickness: 5.0,
                  fillColor: [210, 210, 210],
                  fillPattern: "Solid",
                },
              ],
            }
          : null,
    };

    const root: any = {
      name: "TestNet",
      classKind: ModelicaClassKind.MODEL,
      components: [
        {
          name: "set1",
          classInstance: multiSwitch,
          annotation: (k: string) =>
            k === "Placement"
              ? {
                  transformation: {
                    extent: [
                      [-30, -23],
                      [10, -3],
                    ],
                  },
                }
              : null,
        },
      ],
      connectEquations: [],
      annotation: () => null,
    };

    const data = await buildDiagramData(root);
    const set1 = data.nodes.find((n: any) => n.id === "set1")!;
    assert.ok(set1, "set1 node should exist");
    const uPort = set1.ports.items.find((p: any) => p.id === "u")!;
    const yPort = set1.ports.items.find((p: any) => p.id === "y")!;
    assert.strictEqual(uPort.args.x, 0, "u port should sit on left edge (x=0)");
    assert.strictEqual(yPort.args.x, 41, "y port should sit on right edge (x=41)");

    const rects = findInMarkup(set1.markup, (n) => n.tagName === "path" && n.attrs?.["stroke-width"] != null);
    assert.strictEqual(rects.length, 1);
    const strokeWidth = Number(rects[0].attrs["stroke-width"]);
    assert.ok(strokeWidth > 1.5 && strokeWidth <= 3.5, `Expected bounded stroke-width (~2.5), got ${strokeWidth}`);
  });

  it("expands parameter units for Salsa ComponentInstances (SI.Time -> s)", () => {
    const namedElement: any = {
      entry: { name: "period" },
      declaration: { metadata: { typeSpecifier: "SI.Time" } },
      value: 1,
      classInstance: { name: "Time" },
    };
    const cls: any = {
      name: "BooleanPulse",
      resolveName: (parts: string[]) => (parts[0] === "period" ? namedElement : null),
    };
    const comp: any = { name: "booleanPulse1" };
    assert.strictEqual(evaluateMacroExpression("%period", cls, comp), "1 s");
  });

  it("keeps external labels readable on small blocks and ellipsizes overflow", async () => {
    const makeBlock = (name: string, labelExtent: any) => ({
      name,
      classKind: ModelicaClassKind.BLOCK,
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
                  "@type": "Text",
                  extent: labelExtent,
                  textString: "%name",
                  textColor: [0, 0, 255],
                },
              ],
            }
          : null,
    });

    const root: any = {
      name: "SmallLabels",
      classKind: ModelicaClassKind.MODEL,
      components: [
        {
          name: "triggeredAdd",
          classInstance: makeBlock("TriggeredAdd", [
            [-150, 110],
            [150, 150],
          ]),
          annotation: (k: string) =>
            k === "Placement"
              ? {
                  transformation: {
                    extent: [
                      [14, -56],
                      [26, -44],
                    ],
                  },
                }
              : null,
        },
        {
          name: "onDelay",
          classInstance: makeBlock("OnDelay", [
            [-150, 110],
            [150, 150],
          ]),
          annotation: (k: string) =>
            k === "Placement"
              ? {
                  transformation: {
                    extent: [
                      [-56, -94],
                      [-48, -86],
                    ],
                  },
                }
              : null,
        },
      ],
      connectEquations: [],
      annotation: () => null,
    };

    const data = await buildDiagramData(root);
    const trigNode = data.nodes.find((n: any) => n.id === "triggeredAdd")!;
    const trigText = findInMarkup(trigNode.markup, (n) => n.tagName === "text")[0];
    assert.ok(trigText.textContent.endsWith("..."), `Expected ellipsized label, got ${trigText.textContent}`);

    const delayNode = data.nodes.find((n: any) => n.id === "onDelay")!;
    const delayText = findInMarkup(delayNode.markup, (n) => n.tagName === "text")[0];
    const match = /font-size:\s*([\d.]+)px/.exec(delayText.attrs.style);
    assert.ok(match && Number(match[1]) >= 65, `Expected scaled min font-size >= 65 in icon coords, got ${match?.[1]}`);
  });

  it("preserves vector-port pin offsets on target.anchor for rising/falling -> set1.u[1..2]", async () => {
    const boolIn: any = { name: "BooleanInput", classKind: ModelicaClassKind.CONNECTOR, annotation: () => null };
    const boolOut: any = { name: "BooleanOutput", classKind: ModelicaClassKind.CONNECTOR, annotation: () => null };
    const edgeBlock: any = {
      name: "Edge",
      classKind: ModelicaClassKind.BLOCK,
      components: [
        {
          name: "y",
          classInstance: boolOut,
          annotation: (k: string) =>
            k === "Placement"
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
      annotation: () => null,
    };
    const multiSwitch: any = {
      name: "MultiSwitch",
      classKind: ModelicaClassKind.BLOCK,
      components: [
        {
          name: "u",
          classInstance: boolIn,
          annotation: (k: string) =>
            k === "Placement"
              ? {
                  transformation: {
                    extent: [
                      [-110, 30],
                      [-90, -30],
                    ],
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
                  [300, 100],
                ],
              },
              graphics: [],
            }
          : null,
    };

    const root: any = {
      name: "VectorPortTest",
      classKind: ModelicaClassKind.MODEL,
      components: [
        {
          name: "rising",
          classInstance: edgeBlock,
          annotation: (k: string) =>
            k === "Placement"
              ? {
                  transformation: {
                    extent: [
                      [-56, -15],
                      [-48, -7],
                    ],
                  },
                }
              : null,
        },
        {
          name: "falling",
          classInstance: edgeBlock,
          annotation: (k: string) =>
            k === "Placement"
              ? {
                  transformation: {
                    extent: [
                      [-56, -32],
                      [-48, -24],
                    ],
                  },
                }
              : null,
        },
        {
          name: "set1",
          classInstance: multiSwitch,
          annotation: (k: string) =>
            k === "Placement"
              ? {
                  transformation: {
                    extent: [
                      [-30, -23],
                      [10, -3],
                    ],
                  },
                }
              : null,
        },
      ],
      connectEquations: [
        {
          lhs: "rising.y",
          rhs: "set1.u[1]",
          annotation: (k: string) =>
            k === "Line"
              ? {
                  points: [
                    [-47.2, -11],
                    [-38.6, -11],
                    [-38.6, -11.5],
                    [-30, -11.5],
                  ],
                }
              : null,
        },
        {
          lhs: "falling.y",
          rhs: "set1.u[2]",
          annotation: (k: string) =>
            k === "Line"
              ? {
                  points: [
                    [-47.2, -28],
                    [-40, -28],
                    [-40, -14.5],
                    [-30, -14.5],
                  ],
                }
              : null,
        },
      ],
      annotation: () => null,
    };

    const data = await buildDiagramData(root);
    const e1 = data.edges.find((e: any) => e.id === "rising.y-set1.u[1]")!;
    const e2 = data.edges.find((e: any) => e.id === "falling.y-set1.u[2]")!;
    assert.deepStrictEqual(e1.target.anchor, { name: "center", args: { dx: 0, dy: -1.5 } });
    assert.deepStrictEqual(e2.target.anchor, { name: "center", args: { dx: 0, dy: 1.5 } });
  });

  it("preserves solder dots at T-junctions 3.1 units away from component ports", () => {
    const dots = computeSolderDots(
      [
        {
          id: "e1",
          points: [
            { x: -45.1, y: -70 },
            { x: -36.4, y: -70 },
          ],
          sourceKey: "and1.y",
          targetKey: "or1.u[1]",
        },
        {
          id: "e2",
          points: [
            { x: -45.1, y: -70 },
            { x: -42, y: -70 },
            { x: -42, y: -84 },
          ],
          sourceKey: "and1.y",
          targetKey: "showValue.activePort",
        },
      ],
      {
        tolerance: 3.0,
        portPoints: [
          { x: -45.1, y: -70 },
          { x: -36.4, y: -70 },
          { x: -42, y: -84 },
        ],
      },
    );
    assert.strictEqual(dots.length, 1, "Expected 1 solder dot at (-42, -70)");
    assert.ok(Math.abs(dots[0]!.x - -42) < 0.5 && Math.abs(dots[0]!.y - -70) < 0.5);
  });
});

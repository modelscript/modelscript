// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { buildDiagramData } from "../src/diagram/data.js";
import { ModelicaClassKind } from "../src/types.js";

describe("Diagram Port Centering and Ground Alignment Geometry", () => {
  it("should center Ground pin p exactly on the stem without leftward shift", async () => {
    // Modelica Ground pin p has:
    // origin = {0, 100}, extent = {{10, -10}, {-10, 10}}, rotation = 270
    // Ground icon extent: {{-100, -100}, {100, 100}}
    const pinClassInstance: any = {
      name: "Pin",
      classKind: ModelicaClassKind.CONNECTOR,
      annotation: (name: string) => {
        if (name === "Icon") {
          return {
            coordinateSystem: {
              extent: [
                [-10, -10],
                [10, 10],
              ],
            },
            graphics: [
              {
                type: "Rectangle",
                extent: [
                  [-10, -10],
                  [10, 10],
                ],
                lineColor: [0, 0, 255],
                fillColor: [255, 255, 255],
              },
            ],
          };
        }
        return null;
      },
    };

    const groundClassInstance: any = {
      name: "Ground",
      classKind: ModelicaClassKind.MODEL,
      components: [
        {
          name: "p",
          classInstance: pinClassInstance,
          annotation: (name: string) => {
            if (name === "Placement") {
              return {
                transformation: {
                  origin: [0, 100],
                  extent: [
                    [10, -10],
                    [-10, 10],
                  ],
                  rotation: 270,
                },
              };
            }
            return null;
          },
        },
      ],
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
                type: "Line",
                points: [
                  [0, 100],
                  [0, 50],
                ],
                lineColor: [0, 0, 255],
              },
            ],
          };
        }
        return null;
      },
    };

    const circuitModel: any = {
      name: "TestCircuit",
      classKind: ModelicaClassKind.MODEL,
      components: [
        {
          name: "ground",
          classInstance: groundClassInstance,
          annotation: (name: string) => {
            if (name === "Placement") {
              return {
                transformation: {
                  origin: [0, 0],
                  extent: [
                    [-10, -10],
                    [10, 10],
                  ],
                  rotation: 0,
                },
              };
            }
            return null;
          },
        },
      ],
      annotation: (name: string) => {
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

    const data = await buildDiagramData(circuitModel);
    assert(data);
    assert.strictEqual(data.nodes.length, 1);
    const groundNode = data.nodes[0];
    assert.strictEqual(groundNode.id, "ground");
    assert.strictEqual(groundNode.width, 20);
    assert.strictEqual(groundNode.height, 20);

    const portItems = groundNode.ports?.items;
    assert(portItems && portItems.length === 1);
    const pinP = portItems[0];
    assert.strictEqual(pinP.id, "p");
    assert.strictEqual(pinP.group, "absolute");

    // Pin p should be centered on the top stem of Ground:
    // X center = width / 2 = 10
    // Y center = 0 (top of the icon in inverted SVG coords where y extends downward)
    assert.strictEqual(pinP.args?.x, 10, "Port X center must be exactly 10 (aligned with stem)");
    assert.strictEqual(pinP.args?.y, 0, "Port Y center must be at top edge (0)");
    assert.strictEqual(pinP.args?.angle, -270, "Port angle should preserve connectorTransform.rotate");

    // Port markup should be centered on (0, 0) via x: -w/2, y: -h/2
    const markupAttrs = pinP.markup?.attrs as any;
    assert(markupAttrs);
    assert.strictEqual(markupAttrs.width, 2);
    assert.strictEqual(markupAttrs.height, 2);
    assert.strictEqual(markupAttrs.x, -1, "Port SVG markup must be offset by -width/2");
    assert.strictEqual(markupAttrs.y, -1, "Port SVG markup must be offset by -height/2");
  });

  it("should pre-compute solder dots for intersecting orthogonal wires in buildDiagramData", async () => {
    const circuitModel: any = {
      name: "TeeCircuit",
      classKind: ModelicaClassKind.MODEL,
      components: [
        {
          name: "A",
          classKind: ModelicaClassKind.MODEL,
          annotation: (name: string) =>
            name === "Placement"
              ? {
                  transformation: {
                    origin: [-50, 0],
                    extent: [
                      [-5, -5],
                      [5, 5],
                    ],
                  },
                }
              : null,
        },
        {
          name: "B",
          classKind: ModelicaClassKind.MODEL,
          annotation: (name: string) =>
            name === "Placement"
              ? {
                  transformation: {
                    origin: [50, 0],
                    extent: [
                      [-5, -5],
                      [5, 5],
                    ],
                  },
                }
              : null,
        },
        {
          name: "C",
          classKind: ModelicaClassKind.MODEL,
          annotation: (name: string) =>
            name === "Placement"
              ? {
                  transformation: {
                    origin: [0, 50],
                    extent: [
                      [-5, -5],
                      [5, 5],
                    ],
                  },
                }
              : null,
        },
      ],
      connectEquations: [
        {
          lhs: "A.p",
          rhs: "B.p",
          annotation: (name: string) => {
            if (name === "Line") {
              return {
                points: [
                  [-50, 0],
                  [50, 0],
                ],
                color: [0, 0, 255],
              };
            }
            return null;
          },
        },
        {
          lhs: "C.p",
          rhs: "B.p",
          annotation: (name: string) => {
            if (name === "Line") {
              return {
                points: [
                  [0, 50],
                  [0, 0],
                  [50, 0],
                ],
                color: [0, 0, 255],
              };
            }
            return null;
          },
        },
      ],
      annotation: (name: string) => {
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

    const data = await buildDiagramData(circuitModel);
    assert(data);
    assert.strictEqual(data.edges.length, 2);

    // One horizontal line [-50,0] to [50,0], one vertical line [0,50] to [0,0].
    // They form a T-junction at (0, 0).
    const solderDotNodes = data.nodes.filter((n) => n.id.startsWith("solder_dot_"));
    assert.strictEqual(solderDotNodes.length, 1, "Should precompute 1 solder dot at the T-junction");
    assert.strictEqual(solderDotNodes[0].shape, "circle");
    // In SVG coordinates, center is near (0, 0)
    assert(Math.abs(solderDotNodes[0].x - -1.5) <= 0.1);
    assert(Math.abs(solderDotNodes[0].y - -1.5) <= 0.1);
  });
});

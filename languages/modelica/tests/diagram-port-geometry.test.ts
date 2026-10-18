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

    // Port markup should be a <g> wrapper with a leading centered <rect> child so AntV X6's
    // findShapeNode + toGeometryShape resolves a centered bounding box [-w/2, -h/2, w, h]
    assert.strictEqual(pinP.markup?.tagName, "g");
    const markupAttrs = pinP.markup?.attrs as any;
    assert(markupAttrs);
    assert.strictEqual(markupAttrs.width, 2);
    assert.strictEqual(markupAttrs.height, 2);
    assert.strictEqual(markupAttrs.x, -1, "Port SVG markup must be offset by -width/2");
    assert.strictEqual(markupAttrs.y, -1, "Port SVG markup must be offset by -height/2");

    const markupChildren = (pinP.markup as any)?.children as any[];
    assert(Array.isArray(markupChildren) && markupChildren.length === 2);
    assert.strictEqual(markupChildren[0].tagName, "rect");
    assert.strictEqual(markupChildren[0].attrs.x, -1);
    assert.strictEqual(markupChildren[0].attrs.y, -1);
    assert.strictEqual(markupChildren[0].attrs.width, 2);
    assert.strictEqual(markupChildren[0].attrs.height, 2);
    assert.strictEqual(markupChildren[1].tagName, "svg");
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

  it("should rotate port world coordinates by node angle for rotated RLC components", async () => {
    const pinClassInstance: any = {
      name: "Pin",
      classKind: ModelicaClassKind.CONNECTOR,
      annotation: (name: string) =>
        name === "Icon"
          ? {
              coordinateSystem: {
                extent: [
                  [-10, -10],
                  [10, 10],
                ],
              },
              graphics: [],
            }
          : null,
    };

    const makeTwoPinClass = (className: string): any => ({
      name: className,
      classKind: ModelicaClassKind.MODEL,
      components: [
        {
          name: "p",
          classInstance: pinClassInstance,
          annotation: (name: string) =>
            name === "Placement"
              ? {
                  transformation: {
                    origin: [-100, 0],
                    extent: [
                      [-10, -10],
                      [10, 10],
                    ],
                  },
                }
              : null,
        },
        {
          name: "n",
          classInstance: pinClassInstance,
          annotation: (name: string) =>
            name === "Placement"
              ? {
                  transformation: {
                    origin: [100, 0],
                    extent: [
                      [-10, -10],
                      [10, 10],
                    ],
                  },
                }
              : null,
        },
      ],
      annotation: (name: string) =>
        name === "Icon"
          ? {
              coordinateSystem: {
                extent: [
                  [-100, -100],
                  [100, 100],
                ],
              },
              graphics: [],
            }
          : null,
    });

    const groundClassInstance: any = {
      name: "Ground",
      classKind: ModelicaClassKind.MODEL,
      components: [
        {
          name: "p",
          classInstance: pinClassInstance,
          annotation: (name: string) =>
            name === "Placement"
              ? {
                  transformation: {
                    origin: [0, 100],
                    extent: [
                      [10, -10],
                      [-10, 10],
                    ],
                    rotation: 270,
                  },
                }
              : null,
        },
      ],
      annotation: (name: string) =>
        name === "Icon"
          ? {
              coordinateSystem: {
                extent: [
                  [-100, -100],
                  [100, 100],
                ],
              },
              graphics: [],
            }
          : null,
    };

    const rlcModel: any = {
      name: "RLC",
      classKind: ModelicaClassKind.MODEL,
      components: [
        {
          name: "Vb",
          classInstance: makeTwoPinClass("SineVoltage"),
          annotation: (name: string) =>
            name === "Placement"
              ? {
                  transformation: {
                    origin: [-70, 0],
                    extent: [
                      [-10, -10],
                      [10, 10],
                    ],
                    rotation: 270,
                  },
                }
              : null,
        },
        {
          name: "L",
          classInstance: makeTwoPinClass("Inductor"),
          annotation: (name: string) =>
            name === "Placement"
              ? {
                  transformation: {
                    extent: [
                      [-10, 30],
                      [10, 50],
                    ],
                  },
                }
              : null,
        },
        {
          name: "C",
          classInstance: makeTwoPinClass("Capacitor"),
          annotation: (name: string) =>
            name === "Placement"
              ? {
                  transformation: {
                    origin: [20, 0],
                    extent: [
                      [-10, -10],
                      [10, 10],
                    ],
                    rotation: 270,
                  },
                }
              : null,
        },
        {
          name: "R",
          classInstance: makeTwoPinClass("Resistor"),
          annotation: (name: string) =>
            name === "Placement"
              ? {
                  transformation: {
                    origin: [60, 0],
                    extent: [
                      [-10, -10],
                      [10, 10],
                    ],
                    rotation: 270,
                  },
                }
              : null,
        },
        {
          name: "ground",
          classInstance: groundClassInstance,
          annotation: (name: string) =>
            name === "Placement"
              ? {
                  transformation: {
                    extent: [
                      [-80, -50],
                      [-60, -30],
                    ],
                  },
                }
              : null,
        },
      ],
      connectEquations: [
        {
          lhs: "Vb.p",
          rhs: "L.p",
          annotation: (name: string) =>
            name === "Line"
              ? {
                  points: [
                    [-70, 10],
                    [-70, 40],
                    [-10, 40],
                  ],
                }
              : null,
        },
        {
          lhs: "L.n",
          rhs: "R.p",
          annotation: (name: string) =>
            name === "Line"
              ? {
                  points: [
                    [10, 40],
                    [60, 40],
                    [60, 10],
                  ],
                }
              : null,
        },
        {
          lhs: "L.n",
          rhs: "C.p",
          annotation: (name: string) =>
            name === "Line"
              ? {
                  points: [
                    [10, 40],
                    [20, 40],
                    [20, 10],
                  ],
                }
              : null,
        },
        {
          lhs: "R.n",
          rhs: "Vb.n",
          annotation: (name: string) =>
            name === "Line"
              ? {
                  points: [
                    [60, -10],
                    [60, -30],
                    [-70, -30],
                    [-70, -10],
                  ],
                }
              : null,
        },
        {
          lhs: "C.n",
          rhs: "Vb.n",
          annotation: (name: string) =>
            name === "Line"
              ? {
                  points: [
                    [20, -10],
                    [20, -30],
                    [-70, -30],
                    [-70, -10],
                  ],
                }
              : null,
        },
        {
          lhs: "Vb.n",
          rhs: "ground.p",
          annotation: (name: string) =>
            name === "Line"
              ? {
                  points: [
                    [-70, -10],
                    [-70, -30],
                  ],
                }
              : null,
        },
      ],
      annotation: (name: string) =>
        name === "Diagram"
          ? {
              coordinateSystem: {
                extent: [
                  [-100, -100],
                  [100, 100],
                ],
              },
            }
          : null,
    };

    const data = await buildDiagramData(rlcModel);
    assert(data);

    // Solder dots should be generated at the 2 wire T-junctions (20, -40) and (20, 30) in SVG space,
    // and suppressed at component ports Vb.n (-70, 10) and ground.p (-70, 30).
    const solderDots = data.nodes
      .filter((n) => n.id.startsWith("solder_dot_"))
      .map((n) => ({ cx: n.x + (n.width ?? 3) / 2, cy: n.y + (n.height ?? 3) / 2 }));

    const hasDotNear = (x: number, y: number) =>
      solderDots.some((d) => Math.abs(d.cx - x) <= 0.5 && Math.abs(d.cy - y) <= 0.5);

    assert.strictEqual(
      solderDots.length,
      2,
      `Expected 2 wire T-junction solder dots, got ${JSON.stringify(solderDots)}`,
    );
    assert(hasDotNear(20, -40), `Expected solder dot at top T-junction (20, -40), got ${JSON.stringify(solderDots)}`);
    assert(hasDotNear(20, 30), `Expected solder dot at bottom T-junction (20, 30), got ${JSON.stringify(solderDots)}`);
    assert(!hasDotNear(-70, 10), "Should not place solder dot on rotated port Vb.n (-70, 10)");
    assert(!hasDotNear(-70, 30), "Should not place solder dot on port ground.p (-70, 30)");
  });

  it("should hide conditional heatPort and Line(visible=useHeatPort) by default and show them when useHeatPort=true", async () => {
    const { createWasmParser } = await import("@modelscript/modelica/parser");
    const { AnnotationEvaluator } = await import("../src/diagram/annotation-evaluator.js");
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("@modelscript/modelica/parser.wasm");
    const { parser } = await createWasmParser(wasmPath);

    const source = `
      connector Pin
        annotation(Icon(graphics={Rectangle(extent={{-10,-10},{10,10}})}));
      end Pin;

      connector HeatPort_a
        annotation(Icon(graphics={Rectangle(extent={{-10,-10},{10,10}})}));
      end HeatPort_a;

      partial model ConditionalHeatPort
        parameter Boolean useHeatPort = false "= true, if heatPort is enabled";
        HeatPort_a heatPort if useHeatPort
          annotation(Placement(transformation(extent={{-10,-110},{10,-90}})));
      end ConditionalHeatPort;

      model Resistor
        extends ConditionalHeatPort;
        Pin p annotation(Placement(transformation(extent={{-110,-10},{-90,10}})));
        Pin n annotation(Placement(transformation(extent={{90,-10},{110,10}})));
        parameter Real R = 1;
        annotation(Icon(
          coordinateSystem(extent={{-100,-100},{100,100}}),
          graphics={
            Rectangle(extent={{-70,-30},{70,30}}),
            Line(visible=useHeatPort, points={{0,-100},{0,-30}}, color={127,0,0})
          }
        ));
      end Resistor;

      model Circuit
        Resistor R_default(R=100)
          annotation(Placement(transformation(extent={{-40,-10},{-20,10}})));
        Resistor R_heated(R=100, useHeatPort=true)
          annotation(Placement(transformation(extent={{20,-10},{40,10}})));
        annotation(Diagram(coordinateSystem(extent={{-100,-100},{100,100}})));
      end Circuit;
    `;

    const tree = parser.parse(source);
    const root = tree.rootNode;

    const findClassNode = (name: string): any => {
      const walk = (n: any): any => {
        if (n.type === "class_definition" && n.text.includes(` ${name}`)) {
          return n;
        }
        for (const c of n.children || []) {
          const found = walk(c);
          if (found) return found;
        }
        return null;
      };
      return walk(root);
    };

    const findCompDeclNode = (classNode: any, compName: string): any => {
      const walk = (n: any): any => {
        if (n.type === "component_declaration") {
          const decl = n.children?.find((c: any) => c.type === "declaration");
          const ident = decl?.children?.find((c: any) => c.type === "identifier");
          if (ident?.text?.trim() === compName) return n;
        }
        for (const c of n.children || []) {
          const found = walk(c);
          if (found) return found;
        }
        return null;
      };
      return walk(classNode);
    };

    const pinCst = findClassNode("Pin");
    const heatPortACst = findClassNode("HeatPort_a");
    const condHeatPortCst = findClassNode("ConditionalHeatPort");
    const resistorCst = findClassNode("Resistor");
    const circuitCst = findClassNode("Circuit");

    const pinClass: any = {
      id: 1,
      name: "Pin",
      classKind: ModelicaClassKind.CONNECTOR,
      isClassInstance: true,
      cstNode: pinCst,
      components: [],
      extendsClassInstances: [],
      annotation: (annName: string) => new AnnotationEvaluator(pinClass).evaluate(pinCst, annName),
    };

    const heatPortClass: any = {
      id: 2,
      name: "HeatPort_a",
      classKind: ModelicaClassKind.CONNECTOR,
      isClassInstance: true,
      cstNode: heatPortACst,
      components: [],
      extendsClassInstances: [],
      annotation: (annName: string) => new AnnotationEvaluator(heatPortClass).evaluate(heatPortACst, annName),
    };

    const useHeatPortCst = findCompDeclNode(condHeatPortCst, "useHeatPort");
    const heatPortCompCst = findCompDeclNode(condHeatPortCst, "heatPort");

    const condHeatPortClass: any = {
      id: 3,
      name: "ConditionalHeatPort",
      classKind: ModelicaClassKind.MODEL,
      isClassInstance: true,
      cstNode: condHeatPortCst,
      extendsClassInstances: [],
      components: [
        {
          name: "useHeatPort",
          cstNode: useHeatPortCst,
          abstractSyntaxNode: useHeatPortCst,
        },
        {
          name: "heatPort",
          classInstance: heatPortClass,
          cstNode: heatPortCompCst,
          abstractSyntaxNode: heatPortCompCst,
          annotation: (annName: string) =>
            new AnnotationEvaluator(condHeatPortClass).evaluate(heatPortCompCst, annName),
        },
      ],
      resolveName: (parts: string[]) => condHeatPortClass.components.find((c: any) => c.name === parts[0]) ?? null,
      annotation: (annName: string, _ctx?: any) =>
        new AnnotationEvaluator(
          _ctx && (_ctx.classInstance || _ctx.cstNode)
            ? { componentInstance: _ctx, classInstance: condHeatPortClass }
            : condHeatPortClass,
        ).evaluate(condHeatPortCst, annName),
    };
    for (const c of condHeatPortClass.components) c.parent = condHeatPortClass;

    const pCst = findCompDeclNode(resistorCst, "p");
    const nCst = findCompDeclNode(resistorCst, "n");
    const rParamCst = findCompDeclNode(resistorCst, "R");

    const resistorClass: any = {
      id: 4,
      name: "Resistor",
      classKind: ModelicaClassKind.MODEL,
      isClassInstance: true,
      cstNode: resistorCst,
      extendsClassInstances: [{ name: "ConditionalHeatPort", classInstance: condHeatPortClass }],
      components: [
        {
          name: "p",
          classInstance: pinClass,
          cstNode: pCst,
          abstractSyntaxNode: pCst,
          annotation: (annName: string) => new AnnotationEvaluator(resistorClass).evaluate(pCst, annName),
        },
        {
          name: "n",
          classInstance: pinClass,
          cstNode: nCst,
          abstractSyntaxNode: nCst,
          annotation: (annName: string) => new AnnotationEvaluator(resistorClass).evaluate(nCst, annName),
        },
        {
          name: "R",
          cstNode: rParamCst,
          abstractSyntaxNode: rParamCst,
        },
      ],
      resolveName: (parts: string[]) => {
        const own = resistorClass.components.find((c: any) => c.name === parts[0]);
        if (own) return own;
        return condHeatPortClass.resolveName(parts);
      },
      annotation: (annName: string, _ctx?: any) =>
        new AnnotationEvaluator(
          _ctx && (_ctx.classInstance || _ctx.cstNode)
            ? { componentInstance: _ctx, classInstance: resistorClass }
            : resistorClass,
        ).evaluate(resistorCst, annName),
    };
    for (const c of resistorClass.components) c.parent = resistorClass;

    const rDefaultCst = findCompDeclNode(circuitCst, "R_default");
    const rHeatedCst = findCompDeclNode(circuitCst, "R_heated");

    const circuitClass: any = {
      id: 5,
      name: "Circuit",
      classKind: ModelicaClassKind.MODEL,
      isClassInstance: true,
      cstNode: circuitCst,
      extendsClassInstances: [],
      connectEquations: [],
      components: [
        {
          name: "R_default",
          classInstance: resistorClass,
          cstNode: rDefaultCst,
          abstractSyntaxNode: rDefaultCst,
          annotation: (annName: string) => new AnnotationEvaluator(circuitClass).evaluate(rDefaultCst, annName),
        },
        {
          name: "R_heated",
          classInstance: resistorClass,
          cstNode: rHeatedCst,
          abstractSyntaxNode: rHeatedCst,
          annotation: (annName: string) => new AnnotationEvaluator(circuitClass).evaluate(rHeatedCst, annName),
        },
      ],
      annotation: (annName: string) => new AnnotationEvaluator(circuitClass).evaluate(circuitCst, annName),
    };
    for (const c of circuitClass.components) c.parent = circuitClass;

    const data = await buildDiagramData(circuitClass);
    assert(data);

    const rDefaultNode = data.nodes.find((n) => n.id === "R_default");
    const rHeatedNode = data.nodes.find((n) => n.id === "R_heated");
    assert(rDefaultNode, "Expected R_default node");
    assert(rHeatedNode, "Expected R_heated node");

    const defaultPortIds = (rDefaultNode.ports?.items ?? []).map((p) => p.id);
    assert.deepStrictEqual(
      defaultPortIds,
      ["p", "n"],
      "R_default should only have ports p and n (heatPort must be hidden when useHeatPort=false)",
    );

    const heatedPortIds = (rHeatedNode.ports?.items ?? []).map((p) => p.id);
    assert.deepStrictEqual(
      heatedPortIds,
      ["heatPort", "p", "n"],
      "R_heated should have ports heatPort, p, and n when useHeatPort=true",
    );

    const findLineVisibility = (markup: any): string | undefined => {
      if (!markup || typeof markup !== "object") return undefined;
      if (
        markup.tagName === "g" &&
        Array.isArray(markup.children) &&
        markup.children.length === 1 &&
        (markup.children[0].tagName === "line" || markup.children[0].tagName === "polyline")
      ) {
        return markup.attrs?.visibility;
      }
      for (const child of markup.children || []) {
        const found = findLineVisibility(child);
        if (found) return found;
      }
      return undefined;
    };

    assert.strictEqual(
      findLineVisibility(rDefaultNode.markup),
      "hidden",
      "Line(visible=useHeatPort) on R_default must be hidden by default",
    );
    assert.strictEqual(
      findLineVisibility(rHeatedNode.markup),
      "visible",
      "Line(visible=useHeatPort) on R_heated must be visible when useHeatPort=true",
    );
  });
});

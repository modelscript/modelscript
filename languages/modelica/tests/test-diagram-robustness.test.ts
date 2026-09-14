import assert from "node:assert";
import { describe, it } from "node:test";
import { AnnotationEvaluator } from "../src/diagram/annotation-evaluator.js";
import { buildDiagramData, renderDiagramSvg } from "../src/diagram/data.js";

describe("Modelica Diagram Data Robustness & DynamicSelect", () => {
  it("should handle QueryDB stub without throwing and extract children as components", async () => {
    const fakeQueryDB = {
      childrenOf: (id: string) => [
        { id: "c1", kind: "Component", name: "R1", metadata: {} },
        { id: "c2", kind: "Component", name: "C1", metadata: {} },
      ],
      query: (name: string, id: string) => (name === "classInstance" ? "type_" + id : null),
      symbol: (id: string) => ({ id, name: id.replace("type_", ""), metadata: {} }),
    };

    const stub = {
      id: "root1",
      db: fakeQueryDB,
      name: "SimpleCircuit",
      kind: "Class",
      classKind: "model",
    };

    const data = await buildDiagramData(stub as any);
    assert(data, "DiagramData should be returned");
    assert.strictEqual(data.nodes.length, 2, "Should extract 2 components as nodes");
    assert.strictEqual(data.nodes[0].id, "R1");
    assert.strictEqual(data.nodes[1].id, "C1");
    assert(data.edges, "Edges should be an array");
    assert(data.coordinateSystem, "Coordinate system should be defined");
  });

  it("should record DynamicSelect expressions as dynamic bindings in AnnotationEvaluator", () => {
    const evaluator = new AnnotationEvaluator();

    const ast = {
      annotationClause: {
        classModification: {
          modificationArguments: [
            {
              name: { text: "Line" },
              modification: {
                classModification: {
                  modificationArguments: [
                    {
                      name: { text: "color" },
                      modification: {
                        modificationExpression: {
                          expression: {
                            functionReference: { parts: [{ text: "DynamicSelect" }] },
                            functionCallArguments: {
                              arguments: [
                                { expression: { value: [0, 0, 255] } },
                                { expression: { text: "if switch.isOpen then {255,0,0} else {0,0,255}" } },
                              ],
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    };

    const evaluated = evaluator.evaluate(ast, "Line");
    assert(evaluated, "Evaluated line should not be null");
    assert(Array.isArray(evaluator.dynamicBindings), "dynamicBindings should be array");
    assert.strictEqual(evaluator.dynamicBindings.length, 1);
    assert.strictEqual(evaluator.dynamicBindings[0].variableName, "if switch.isOpen then {255,0,0} else {0,0,255}");
  });

  it("should render standalone diagram SVG string without DOM dependencies", () => {
    const fakeModel = {
      name: "TestModel",
      extendsClassInstances: [],
      annotation: (name: string) => {
        if (name === "Diagram") {
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
                  [-50, -50],
                  [50, 50],
                ],
                lineColor: [0, 0, 255],
                fillColor: [200, 200, 255],
                fillPattern: 1,
              },
            ],
          };
        }
        return null;
      },
    };

    const svgString = renderDiagramSvg(fakeModel);
    assert(typeof svgString === "string", "SVG output should be a string");
    assert(svgString.includes("<svg"), "SVG output should include <svg>");
    assert(svgString.includes("<path"), "SVG output should include <path>");
    assert(svgString.includes('viewBox="-100 -100 200 200"'), "ViewBox should match coordinate system");
  });

  it("should generate cascading stacked icons for multi-instance component arrays", async () => {
    const fakeQueryDB = {
      childrenOf: (id: string) => [{ id: "r_array", kind: "Component", name: "R[5]", metadata: { dimensions: [5] } }],
      query: (name: string, id: string) => (name === "classInstance" ? "type_" + id : null),
      symbol: (id: string) => ({ id, name: "Resistor", metadata: {} }),
    };

    const stub = {
      id: "root2",
      db: fakeQueryDB,
      name: "ArrayCircuit",
      kind: "Class",
      classKind: "model",
    };

    const data = await buildDiagramData(stub as any);
    assert(data && data.nodes.length === 1);
    const node = data.nodes[0];
    assert.strictEqual(node.id, "R[5]");
    const markupStr = JSON.stringify(node.markup);
    assert(markupStr.includes("strokeDasharray"), "Cascading stacked rects should have dashed stroke");
  });
});

import assert from "node:assert";
import { describe, it } from "node:test";
import { AnnotationEvaluator } from "../src/diagram/annotation-evaluator.js";
import { buildDiagramData } from "../src/diagram/data.js";

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
    assert.strictEqual(evaluator.dynamicBindings[0].property, "color");
    assert.strictEqual(evaluator.dynamicBindings[0].variableName, "if switch.isOpen then {255,0,0} else {0,0,255}");
  });
});

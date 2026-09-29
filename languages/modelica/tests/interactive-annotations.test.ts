// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { AnnotationEvaluator } from "../src/diagram/annotation-evaluator.js";

describe("Modelica Interactive & Dialog Annotations", () => {
  it("extracts Interactive(type='momentary') annotation into InteractiveBinding", () => {
    const evaluator = new AnnotationEvaluator();

    const ast = {
      annotationClause: {
        classModification: {
          modificationArguments: [
            {
              name: { text: "Interactive" },
              modification: {
                classModification: {
                  modificationArguments: [
                    {
                      name: { text: "type" },
                      modification: {
                        modificationExpression: {
                          expression: { text: "momentary", value: "momentary" },
                        },
                      },
                    },
                    {
                      name: { text: "label" },
                      modification: {
                        modificationExpression: {
                          expression: { text: "Emergency Stop", value: "Emergency Stop" },
                        },
                      },
                    },
                    {
                      name: { text: "clickTarget" },
                      modification: {
                        modificationExpression: {
                          expression: { text: "button", value: "button" },
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

    const binding = evaluator.evaluateInteractive(ast, "emergencyStop");
    assert.ok(binding);
    assert.strictEqual(binding.action, "momentary");
    assert.strictEqual(binding.variableName, "emergencyStop");
    assert.strictEqual(binding.label, "Emergency Stop");
    assert.strictEqual(binding.targetSelector, "button");
    assert.strictEqual(evaluator.interactiveBindings.length, 1);
  });

  it("extracts Dialog(min=0, max=100, unit='rpm') annotation into slider InteractiveBinding", () => {
    const evaluator = new AnnotationEvaluator();

    const ast = {
      annotationClause: {
        classModification: {
          modificationArguments: [
            {
              name: { text: "Dialog" },
              modification: {
                classModification: {
                  modificationArguments: [
                    {
                      name: { text: "min" },
                      modification: {
                        modificationExpression: {
                          expression: { text: "0", value: 0 },
                        },
                      },
                    },
                    {
                      name: { text: "max" },
                      modification: {
                        modificationExpression: {
                          expression: { text: "100", value: 100 },
                        },
                      },
                    },
                    {
                      name: { text: "step" },
                      modification: {
                        modificationExpression: {
                          expression: { text: "5", value: 5 },
                        },
                      },
                    },
                    {
                      name: { text: "unit" },
                      modification: {
                        modificationExpression: {
                          expression: { text: "rpm", value: "rpm" },
                        },
                      },
                    },
                    {
                      name: { text: "description" },
                      modification: {
                        modificationExpression: {
                          expression: { text: "Target Speed", value: "Target Speed" },
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

    const binding = evaluator.evaluateInteractive(ast, "targetSpeed");
    assert.ok(binding);
    assert.strictEqual(binding.action, "slider");
    assert.strictEqual(binding.variableName, "targetSpeed");
    assert.strictEqual(binding.min, 0);
    assert.strictEqual(binding.max, 100);
    assert.strictEqual(binding.step, 5);
    assert.strictEqual(binding.unit, "rpm");
    assert.strictEqual(binding.label, "Target Speed");
    assert.strictEqual(evaluator.interactiveBindings.length, 1);
  });
});

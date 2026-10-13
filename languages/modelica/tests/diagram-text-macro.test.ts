// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { evaluateMacroExpression, renderIconX6 } from "../src/diagram/data.js";
import { ModelicaClassKind } from "../src/types.js";

describe("Diagram Text Macro Evaluation & Orientation", () => {
  it("should evaluate component parameter overrides via modification object or CST", () => {
    const compInstanceWithMod: any = {
      name: "R1",
      modification: {
        getModificationArgument: (name: string) => {
          if (name === "R") return { expression: { value: 200 } };
          return null;
        },
      },
    };

    const val = evaluateMacroExpression("%R", undefined, compInstanceWithMod);
    assert.strictEqual(val, "200");
  });

  it("should evaluate class default start value when component does not override", () => {
    const classInstance: any = {
      name: "Resistor",
      resolveName: (parts: string[]) => {
        if (parts[0] === "R") {
          return {
            name: "R",
            cstNode: {
              text: "parameter Real R(start = 100);",
            },
          };
        }
        return null;
      },
    };

    const compInstanceEmpty: any = {
      name: "R1",
    };

    const val = evaluateMacroExpression("%R", classInstance, compInstanceEmpty);
    assert.strictEqual(val, "100");
  });

  it("should return empty string rather than parameter identifier when % macro is unresolved", () => {
    const compInstanceEmpty: any = {
      name: "R1",
    };

    // Before fix, %unknown returned "unknown", causing "R=%R" to render as "R=R"
    const val = evaluateMacroExpression("%nonExistentParam", undefined, compInstanceEmpty);
    assert.strictEqual(val, "", "Unresolved macro expression should return empty string");
  });

  it("should render text markup as transparent group without restrictive sub-svg viewport", () => {
    const classInstance: any = {
      name: "LabelledComponent",
      classKind: ModelicaClassKind.MODEL,
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
                "@type": "Text",
                extent: [
                  [-80, -20],
                  [80, 20],
                ],
                textString: "R=%R",
              },
            ],
          };
        }
        return null;
      },
    };

    const compInstance: any = {
      name: "R1",
      modification: {
        getModificationArgument: (name: string) => {
          if (name === "R") return { expression: { value: 4700 } };
          return null;
        },
      },
    };

    const markup = renderIconX6(classInstance, compInstance, false);
    assert(markup);
    // Find text markup in children
    const g = markup.children?.[0];
    assert(g);
    const itemWrapper = g.children?.[0];
    assert(itemWrapper);
    const textGroup = itemWrapper.children?.[0];
    assert(textGroup);
    // Should be <g overflow="visible"> not <svg viewBox="...">
    assert.strictEqual(textGroup.tagName, "g", "Text wrapper must be <g> to avoid viewBox clipping");
    assert.strictEqual(textGroup.attrs?.overflow, "visible");

    const textElement = textGroup.children?.[0];
    assert(textElement);
    assert.strictEqual(textElement.tagName, "text");
    assert.strictEqual(textElement.textContent, "R=4700", "Macro %R must be evaluated to 4700");
  });
});

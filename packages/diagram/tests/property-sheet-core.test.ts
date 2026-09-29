// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { evaluatePropertyPredicate } from "../src/property-evaluator.js";
import { PropertySheetController } from "../src/property-sheet-controller.js";
import { validatePropertyValue } from "../src/property-validator.js";
import type { ComponentPropertyData, PropertyFieldConfig } from "../src/protocol.js";

describe("Property Inspector Core Engine", () => {
  describe("PropertyExpressionEvaluator", () => {
    it("handles undefined, null, and empty predicates as true", () => {
      assert.strictEqual(evaluatePropertyPredicate(undefined), true);
      assert.strictEqual(evaluatePropertyPredicate(null), true);
      assert.strictEqual(evaluatePropertyPredicate(""), true);
      assert.strictEqual(evaluatePropertyPredicate("   "), true);
    });

    it("evaluates functional predicates", () => {
      assert.strictEqual(
        evaluatePropertyPredicate((v) => v.x > 5, { x: 10 }),
        true,
      );
      assert.strictEqual(
        evaluatePropertyPredicate((v) => v.x > 5, { x: 2 }),
        false,
      );
    });

    it("evaluates boolean keywords and identifiers", () => {
      assert.strictEqual(evaluatePropertyPredicate("true"), true);
      assert.strictEqual(evaluatePropertyPredicate("false"), false);
      assert.strictEqual(evaluatePropertyPredicate("use_HeatPort", { use_HeatPort: true }), true);
      assert.strictEqual(evaluatePropertyPredicate("use_HeatPort", { use_HeatPort: "true" }), true);
      assert.strictEqual(evaluatePropertyPredicate("use_HeatPort", { use_HeatPort: false }), false);
      assert.strictEqual(evaluatePropertyPredicate("use_HeatPort", { use_HeatPort: "false" }), false);
    });

    it("evaluates Modelica 'not' and JS '!' negation", () => {
      assert.strictEqual(evaluatePropertyPredicate("not use_HeatPort", { use_HeatPort: false }), true);
      assert.strictEqual(evaluatePropertyPredicate("not use_HeatPort", { use_HeatPort: true }), false);
      assert.strictEqual(evaluatePropertyPredicate("!use_HeatPort", { use_HeatPort: false }), true);
      assert.strictEqual(evaluatePropertyPredicate("!use_HeatPort", { use_HeatPort: true }), false);
      assert.strictEqual(evaluatePropertyPredicate("not tableOnFile", { tableOnFile: false }), true);
    });

    it("evaluates relational comparisons (==, !=, <>, <, <=, >, >=)", () => {
      assert.strictEqual(evaluatePropertyPredicate("mode == 'steady'", { mode: "steady" }), true);
      assert.strictEqual(evaluatePropertyPredicate("mode != 'steady'", { mode: "transient" }), true);
      assert.strictEqual(evaluatePropertyPredicate("fType <> 'Parameter'", { fType: "System" }), true);
      assert.strictEqual(evaluatePropertyPredicate("level > 10", { level: 20 }), true);
      assert.strictEqual(evaluatePropertyPredicate("level <= 5", { level: 5 }), true);
      assert.strictEqual(evaluatePropertyPredicate("level < 0", { level: 5 }), false);
    });

    it("evaluates logical combinations (and, &&, or, ||)", () => {
      assert.strictEqual(evaluatePropertyPredicate("a and b", { a: true, b: true }), true);
      assert.strictEqual(evaluatePropertyPredicate("a and b", { a: true, b: false }), false);
      assert.strictEqual(evaluatePropertyPredicate("a or b", { a: false, b: true }), true);
      assert.strictEqual(evaluatePropertyPredicate("a && (b || c)", { a: true, b: false, c: true }), true);
      assert.strictEqual(evaluatePropertyPredicate("not a and (b or c)", { a: false, b: false, c: true }), true);
    });

    it("evaluates Modelica size() function", () => {
      assert.strictEqual(evaluatePropertyPredicate("size(table, 1) > 0", { table: "{1,2;3,4}" }), true);
      assert.strictEqual(evaluatePropertyPredicate("size(emptyList, 1) > 0", { emptyList: "" }), false);
    });
  });

  describe("PropertyValidator", () => {
    it("validates required fields", () => {
      const field: PropertyFieldConfig = { key: "name", label: "Component Name", kind: "string", required: true };
      assert.strictEqual(validatePropertyValue(field, ""), "Component Name is required.");
      assert.strictEqual(validatePropertyValue(field, null), "Component Name is required.");
      assert.strictEqual(validatePropertyValue(field, "resistor1"), null);
    });

    it("validates numeric ranges (min, max)", () => {
      const field: PropertyFieldConfig = {
        key: "R",
        label: "Resistance",
        kind: "number",
        validation: { min: 0.1, max: 1000 },
      };
      assert.strictEqual(validatePropertyValue(field, "0"), "Resistance must be at least 0.1.");
      assert.strictEqual(validatePropertyValue(field, "1500"), "Resistance must not exceed 1000.");
      assert.strictEqual(validatePropertyValue(field, "100"), null);
    });

    it("validates regex pattern", () => {
      const field: PropertyFieldConfig = {
        key: "id",
        label: "Identifier",
        kind: "string",
        validation: { pattern: "^[A-Za-z][A-Za-z0-9_]*$" },
      };
      assert.strictEqual(validatePropertyValue(field, "123bad"), "Identifier has an invalid format.");
      assert.strictEqual(validatePropertyValue(field, "valid_Id1"), null);
    });
  });

  describe("PropertySheetController", () => {
    const mockData: ComponentPropertyData = {
      className: "Modelica.Electrical.Analog.Basic.Resistor",
      name: "r1",
      description: "Ideal electrical resistor",
      values: { R: "100", use_HeatPort: false, T: "293.15" },
      schema: {
        tabs: [
          {
            id: "general",
            label: "General",
            groups: [
              {
                id: "parameters",
                label: "Parameters",
                fields: [
                  { key: "R", label: "Resistance", kind: "number", defaultValue: "100", validation: { min: 0 } },
                ],
              },
            ],
          },
          {
            id: "thermal",
            label: "Thermal",
            groups: [
              {
                id: "settings",
                label: "Settings",
                fields: [
                  { key: "use_HeatPort", label: "Use Heat Port", kind: "boolean", defaultValue: false },
                  {
                    key: "T",
                    label: "Temperature",
                    kind: "number",
                    defaultValue: "293.15",
                    enabledIf: "use_HeatPort",
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    it("manages properties, tabs, and conditions", () => {
      const controller = new PropertySheetController({ debounceMs: 10 });
      controller.setProperties("r1", mockData);

      assert.strictEqual(controller.getComponentId(), "r1");
      assert.strictEqual(controller.getValue("R"), "100");
      assert.strictEqual(controller.getActiveTabId(), "general");

      // Verify thermal field enabled state based on use_HeatPort (false)
      const thermalTab = controller.getVisibleTabs().find((t) => t.id === "thermal")!;
      const tField = thermalTab.groups[0].fields.find((f) => f.key === "T")!;
      assert.strictEqual(controller.isFieldEnabled(tField), false);

      // Update use_HeatPort to true
      controller.updateValue("use_HeatPort", true);
      assert.strictEqual(controller.isFieldEnabled(tField), true);

      // Verify validation error
      controller.updateValue("R", -50);
      assert.ok(controller.getFieldError("R"));

      controller.destroy();
    });

    it("debounces property change events", async () => {
      const controller = new PropertySheetController({ debounceMs: 20 });
      controller.setProperties("r1", mockData);

      let eventReceived: any = null;
      controller.updateValue("R", "220", (e) => {
        eventReceived = e;
      });

      assert.strictEqual(eventReceived, null);

      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.ok(eventReceived);
      assert.strictEqual(eventReceived.componentId, "r1");
      assert.strictEqual(eventReceived.key, "R");
      assert.strictEqual(eventReceived.value, "220");

      controller.destroy();
    });
  });
});

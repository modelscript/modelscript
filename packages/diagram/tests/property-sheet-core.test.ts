// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  coalesceDiagramActions,
  DiagramActionQueue,
  isOptimisticDiagramActionBatch,
  isSpatialDiagramAction,
  SerializedDiagramEditRunner,
} from "../src/action-dispatch.js";
import { ConflictManager } from "../src/properties/conflict-manager.js";
import {
  applyLivePropertyIconSubstitutions,
  applyOptimisticPropertyAction,
  buildPropertyContextValues,
  getVisiblePropertyTabs,
  resolveActivePropertyTabId,
} from "../src/properties/state.js";
import { evaluatePropertyPredicate } from "../src/property-evaluator.js";
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

  describe("Canonical Property State & Action Dispatch", () => {
    const mockData: ComponentPropertyData = {
      className: "Modelica.Electrical.Analog.Basic.Resistor",
      name: "r1",
      description: "Ideal electrical resistor",
      values: { R: "100", use_HeatPort: false, T: "293.15" },
      parameters: [{ name: "R", value: "100", defaultValue: "1", isBoolean: false }],
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

    it("builds context values, filters tabs, and coordinates ConflictManager", () => {
      const conflictMgr = new ConflictManager();
      conflictMgr.reset(mockData.values || {});

      const ctxInitial = buildPropertyContextValues(mockData, conflictMgr.getAllLocalValues());
      const tabs = getVisiblePropertyTabs(mockData.schema, ctxInitial);
      assert.strictEqual(resolveActivePropertyTabId(tabs, "missing"), "general");

      const thermalTab = tabs.find((t) => t.id === "thermal")!;
      const tField = thermalTab.groups[0]!.fields.find((f) => f.key === "T")!;
      assert.strictEqual(evaluatePropertyPredicate(tField.enabledIf, ctxInitial), false);

      conflictMgr.setLocalValue("use_HeatPort", "true");
      const ctxUpdated = buildPropertyContextValues(mockData, conflictMgr.getAllLocalValues());
      assert.strictEqual(evaluatePropertyPredicate(tField.enabledIf, ctxUpdated), true);

      assert.ok(validatePropertyValue(tabs[0]!.groups[0]!.fields[0]!, -50, ctxUpdated));
    });

    it("applies optimistic property updates and escapes SVG substitutions", () => {
      const updated = applyOptimisticPropertyAction(mockData, {
        type: "updateProperty",
        name: "r1",
        key: "R",
        value: "220",
      });
      assert.strictEqual(updated?.values?.R, "220");
      assert.strictEqual(updated?.parameters?.[0]?.value, "220");

      const svg = applyLivePropertyIconSubstitutions(
        "<svg><text>r[1]</text><text>R = 100</text></svg>",
        { R: "220" },
        "r_new",
        "r[1]",
      );
      assert.ok(svg.includes("<text>r_new</text>"));
      assert.ok(svg.includes("<text>R = 220</text>"));
    });

    it("coalesces adjacent redundant actions without crossing structural barriers", async () => {
      const coalesced = coalesceDiagramActions([
        { type: "move", items: [{ name: "r1", x: 10, y: 20 }] },
        {
          type: "move",
          items: [
            { name: "r1", x: 30, y: 40 },
            { name: "c1", x: 50, y: 60 },
          ],
        },
        { type: "addComponent", className: "Ground", x: 0, y: 0 },
        { type: "updateProperty", name: "r1", key: "R", previousValue: "100", value: "150" },
        { type: "updateProperty", name: "r1", key: "R", previousValue: "150", value: "220" },
      ]);
      assert.strictEqual(coalesced.length, 3);
      assert.deepStrictEqual(coalesced[0]!.items, [
        { name: "r1", x: 30, y: 40 },
        { name: "c1", x: 50, y: 60 },
      ]);
      assert.strictEqual(coalesced[2]!.previousValue, "100");
      assert.strictEqual(coalesced[2]!.value, "220");

      assert.strictEqual(isSpatialDiagramAction({ type: "move" }), true);
      assert.strictEqual(isOptimisticDiagramActionBatch([{ type: "move" }, { type: "updateProperty" }]), true);
      assert.strictEqual(isOptimisticDiagramActionBatch([{ type: "move" }, { type: "addComponent" }]), false);

      const flushed: any[][] = [];
      const immediate: any[] = [];
      const queue = new DiagramActionQueue({
        spatialDelayMs: 15,
        structuralDelayMs: 0,
        onFlush: (batch) => flushed.push(batch),
        onImmediateAction: (act) => immediate.push(act),
      });

      queue.enqueue({ type: "interactiveWrite", name: "sw1", value: "true" });
      assert.strictEqual(immediate.length, 1);

      queue.enqueue({ type: "move", items: [{ name: "r1", x: 10, y: 10 }] });
      queue.enqueue({ type: "move", items: [{ name: "r1", x: 25, y: 35 }] });
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.strictEqual(flushed.length, 1);
      assert.deepStrictEqual(flushed[0], [{ type: "move", items: [{ name: "r1", x: 25, y: 35 }] }]);

      // Structural actions with structuralDelayMs === 0 flush synchronously without setTimeout delay
      queue.enqueue({ type: "addComponent", className: "master:resistor", x: 100, y: 100 });
      assert.strictEqual(flushed.length, 2);
      assert.deepStrictEqual(flushed[1], [{ type: "addComponent", className: "master:resistor", x: 100, y: 100 }]);

      const runner = new SerializedDiagramEditRunner();
      const order: number[] = [];
      await Promise.all([
        runner.enqueue(async (seq) => {
          await new Promise((r) => setTimeout(r, 15));
          order.push(seq);
        }),
        runner.enqueue(async (seq) => {
          order.push(seq);
        }),
      ]);
      assert.deepStrictEqual(order, [1, 2]);
      queue.dispose();
    });
  });
});

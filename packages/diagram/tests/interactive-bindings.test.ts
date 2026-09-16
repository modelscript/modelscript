// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { InteractiveStateManager, type InteractiveBinding, type InteractiveNodeLike } from "../src/interactive.js";

describe("Interactive Bidirectional Bindings", () => {
  it("manages momentary pushbuttons (active on down, inactive on up)", () => {
    const manager = new InteractiveStateManager();
    const attrs: Record<string, unknown> = {};
    const node: InteractiveNodeLike = {
      id: "btn_start",
      attr: (path: string, val: unknown) => {
        attrs[path] = val;
      },
    };

    const binding: InteractiveBinding = {
      action: "momentary",
      variableName: "start_cmd",
      onValue: true,
      offValue: false,
    };

    // Press down
    const downAction = manager.handleInteraction(node, binding, "mousedown");
    assert.ok(downAction);
    assert.strictEqual(downAction.action, "momentary");
    assert.strictEqual(downAction.variableName, "start_cmd");
    assert.strictEqual(downAction.value, true);
    assert.strictEqual(attrs["button/transform"], "translate(0, 2)");

    // Release
    const upAction = manager.handleInteraction(node, binding, "mouseup");
    assert.ok(upAction);
    assert.strictEqual(upAction.value, false);
    assert.strictEqual(attrs["button/transform"], "translate(0, 0)");
  });

  it("manages toggle switches with optimistic indicator feedback", () => {
    const manager = new InteractiveStateManager();
    const attrs: Record<string, unknown> = {};
    const node: InteractiveNodeLike = {
      id: "sw_bypass",
      attr: (path: string, val: unknown) => {
        attrs[path] = val;
      },
    };

    const binding: InteractiveBinding = {
      action: "toggle",
      variableName: "bypass_valve",
      onValue: true,
      offValue: false,
    };

    // First click -> true
    const act1 = manager.handleInteraction(node, binding, "click");
    assert.ok(act1);
    assert.strictEqual(act1.value, true);
    assert.strictEqual(attrs["indicator/fill"], "#2da44e");

    // Second click -> false
    const act2 = manager.handleInteraction(node, binding, "click");
    assert.ok(act2);
    assert.strictEqual(act2.value, false);
    assert.strictEqual(attrs["indicator/fill"], "#57606a");
  });

  it("clamps and steps numeric setpoint values", () => {
    const manager = new InteractiveStateManager();
    const attrs: Record<string, unknown> = {};
    const node: InteractiveNodeLike = {
      id: "sp_temp",
      attr: (path: string, val: unknown) => {
        attrs[path] = val;
      },
    };

    const binding: InteractiveBinding = {
      action: "numeric",
      variableName: "target_temp",
      min: 20,
      max: 100,
      step: 5,
      unit: "°C",
    };

    // Value within bounds and quantized
    const act1 = manager.handleInteraction(node, binding, "input", 52.3);
    assert.ok(act1);
    assert.strictEqual(act1.value, 50); // 20 + round(32.3 / 5) * 5 = 20 + 30 = 50
    assert.strictEqual(attrs["value/text"], "50.0 °C");

    // Value exceeding max -> clamped to 100
    const act2 = manager.handleInteraction(node, binding, "input", 150);
    assert.ok(act2);
    assert.strictEqual(act2.value, 100);

    // Value below min -> clamped to 20
    const act3 = manager.handleInteraction(node, binding, "input", -10);
    assert.ok(act3);
    assert.strictEqual(act3.value, 20);
  });

  it("handles continuous slider drag with thumb positioning", () => {
    const manager = new InteractiveStateManager();
    const attrs: Record<string, unknown> = {};
    const node: InteractiveNodeLike = {
      id: "slider_throttle",
      attr: (path: string, val: unknown) => {
        attrs[path] = val;
      },
    };

    const binding: InteractiveBinding = {
      action: "slider",
      variableName: "throttle_pct",
      min: 0,
      max: 100,
      unit: "%",
    };

    const act = manager.handleInteraction(node, binding, "input", 75);
    assert.ok(act);
    assert.strictEqual(act.value, 75);
    assert.strictEqual(attrs["thumb/transform"], "translate(75%, 0)");
    assert.strictEqual(attrs["value/text"], "75.0 %");
  });

  it("emits faceplate request action", () => {
    const manager = new InteractiveStateManager();
    const node: InteractiveNodeLike = {
      id: "tic_101",
    };

    const binding: InteractiveBinding = {
      action: "faceplate",
      variableName: "temp_loop",
      unit: "°C",
    };

    const act = manager.handleInteraction(node, binding, "click");
    assert.ok(act);
    assert.strictEqual(act.action, "faceplate");
    assert.strictEqual(act.variableName, "temp_loop");
    assert.strictEqual(act.unit, "°C");
  });
});

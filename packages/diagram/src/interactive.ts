// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generic Interactive Bidirectional Bindings for @modelscript/diagram.
 *
 * Supports both:
 * 1. Modelica interactive simulations (via Dialog and Interactive annotations)
 * 2. Industrial SCADA HMI (pushbuttons, toggle switches, sliders, numeric inputs)
 */

export type InteractiveActionType =
  | "momentary" // Active on press (true/1), inactive on release (false/0)
  | "toggle" // Flips state on click (true/false or cycling options)
  | "numeric" // Discrete or continuous numerical setpoint input
  | "slider" // Draggable continuous or stepped range
  | "selector" // Discrete dropdown or multi-position rotary switch
  | "faceplate"; // Requests opening an operational PID loop or diagnostic faceplate

export interface InteractiveBinding {
  /** Interaction behavior */
  action: InteractiveActionType;
  /** Variable or tag name (e.g., in DAE solver, FMU, or MQTT UNS topic) */
  variableName: string;
  /** Optional visual sub-selector within the X6 cell markup (e.g., 'button', 'handle', 'indicator') */
  targetSelector?: string;
  /** Human-readable label or tooltip */
  label?: string;
  /** Lower operational bound for numeric/slider inputs */
  min?: number;
  /** Upper operational bound for numeric/slider inputs */
  max?: number;
  /** Step increment */
  step?: number;
  /** Engineering unit string (e.g. 'rpm', '°C', 'bar') */
  unit?: string;
  /** Available choices for selector/enum inputs */
  options?: { label: string; value: number | string }[];
  /** Value transmitted when active (for momentary/toggle; default: true) */
  onValue?: number | boolean | string;
  /** Value transmitted when inactive (for momentary/toggle; default: false) */
  offValue?: number | boolean | string;
  /** Optional safety confirmation prompt before writing */
  confirmPrompt?: string;
}

export interface InteractiveWriteAction {
  type: "interactiveWrite";
  nodeId: string;
  variableName: string;
  value: number | boolean | string;
  action: InteractiveActionType;
  unit?: string;
}

export interface InteractiveNodeLike {
  id: string;
  getData?: () => {
    interactive?: InteractiveBinding[];
    [key: string]: unknown;
  };
  setData?: (data: Record<string, unknown>, options?: Record<string, unknown>) => void;
  attr?: (path: string, val: unknown) => void;
}

/**
 * Manages runtime interactive values, bounds checking, and visual feedback for diagram cells.
 */
export class InteractiveStateManager {
  private readonly values = new Map<string, Map<string, number | boolean | string>>();

  /** Retrieve the current interactive state for a node variable. */
  getValue(nodeId: string, variableName: string, defaultValue?: number | boolean | string): number | boolean | string {
    const nodeMap = this.values.get(nodeId);
    if (nodeMap?.has(variableName)) {
      return nodeMap.get(variableName)!;
    }
    return defaultValue ?? false;
  }

  /** Set the interactive state for a node variable without emitting an action. */
  setValue(nodeId: string, variableName: string, value: number | boolean | string): void {
    let nodeMap = this.values.get(nodeId);
    if (!nodeMap) {
      nodeMap = new Map();
      this.values.set(nodeId, nodeMap);
    }
    nodeMap.set(variableName, value);
  }

  /** Clear all tracked interactive values. */
  clear(): void {
    this.values.clear();
  }

  /**
   * Process an interactive user event on a cell and produce an InteractiveWriteAction if valid.
   */
  handleInteraction(
    node: InteractiveNodeLike,
    binding: InteractiveBinding,
    eventType: "mousedown" | "mouseup" | "click" | "input",
    inputValue?: unknown,
  ): InteractiveWriteAction | null {
    const nodeId = node.id;
    let nextValue: number | boolean | string | null = null;

    switch (binding.action) {
      case "momentary": {
        const onVal = binding.onValue ?? true;
        const offVal = binding.offValue ?? false;
        if (eventType === "mousedown") {
          nextValue = onVal;
        } else if (eventType === "mouseup") {
          nextValue = offVal;
        }
        break;
      }

      case "toggle": {
        if (eventType === "click") {
          const current = this.getValue(nodeId, binding.variableName, binding.offValue ?? false);
          const onVal = binding.onValue ?? true;
          const offVal = binding.offValue ?? false;

          // If current is equal to onValue, flip to offValue; otherwise onValue
          if (current === onVal) {
            nextValue = offVal;
          } else {
            nextValue = onVal;
          }
        }
        break;
      }

      case "numeric":
      case "slider": {
        if (eventType === "input" || eventType === "click") {
          let num = typeof inputValue === "number" ? inputValue : parseFloat(String(inputValue));
          if (isNaN(num)) {
            num = binding.min ?? 0;
          }

          // Bounds clamp
          if (binding.min !== undefined && num < binding.min) num = binding.min;
          if (binding.max !== undefined && num > binding.max) num = binding.max;

          // Step quantization
          if (binding.step !== undefined && binding.step > 0) {
            const base = binding.min ?? 0;
            num = base + Math.round((num - base) / binding.step) * binding.step;
          }

          nextValue = num;
        }
        break;
      }

      case "selector": {
        if ((eventType === "input" || eventType === "click") && inputValue !== undefined) {
          nextValue = inputValue as number | boolean | string;
        }
        break;
      }

      case "faceplate": {
        if (eventType === "click") {
          // Faceplate action simply triggers opening the modal with the current value
          const current = this.getValue(nodeId, binding.variableName, 0);
          return {
            type: "interactiveWrite",
            nodeId,
            variableName: binding.variableName,
            value: current,
            action: "faceplate",
            unit: binding.unit,
          };
        }
        break;
      }
    }

    if (nextValue === null) return null;

    // Cache updated value
    this.setValue(nodeId, binding.variableName, nextValue);

    // Apply optimistic visual updates to the cell
    this.applyOptimisticVisuals(node, binding, nextValue);

    return {
      type: "interactiveWrite",
      nodeId,
      variableName: binding.variableName,
      value: nextValue,
      action: binding.action,
      unit: binding.unit,
    };
  }

  /**
   * Apply immediate optimistic visual feedback to the cell.
   */
  applyOptimisticVisuals(
    node: InteractiveNodeLike,
    binding: InteractiveBinding,
    value: number | boolean | string,
  ): void {
    if (!node.attr) return;

    if (binding.action === "momentary") {
      const isDown = Boolean(value);
      node.attr("button/transform", isDown ? "translate(0, 2)" : "translate(0, 0)");
      node.attr("button/filter", isDown ? "brightness(0.85)" : "none");
    } else if (binding.action === "toggle") {
      const isTrue = value === (binding.onValue ?? true) || Boolean(value);
      // Update LED indicator
      node.attr("indicator/fill", isTrue ? "#2da44e" : "#57606a");
      node.attr("handle/transform", isTrue ? "rotate(30 20 20)" : "rotate(-30 20 20)");
    } else if (binding.action === "numeric" || binding.action === "slider") {
      const displayVal = typeof value === "number" ? value.toFixed(1) : String(value);
      const unitStr = binding.unit ? ` ${binding.unit}` : "";
      node.attr("value/text", `${displayVal}${unitStr}`);

      if (binding.min !== undefined && binding.max !== undefined && binding.max > binding.min) {
        const pct = Math.max(0, Math.min(100, (((value as number) - binding.min) / (binding.max - binding.min)) * 100));
        node.attr("thumb/transform", `translate(${pct}%, 0)`);
      }
    }
  }
}

/** Global default state manager instance. */
export const defaultInteractiveStateManager = new InteractiveStateManager();

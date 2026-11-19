// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Shared headless property inspector state, schema filtering, and optimistic
 * action application helpers used by both the DOM reconciler (VS Code) and React inspector (Morsel).
 */

import { evaluatePropertyPredicate } from "../property-evaluator.js";
import type { ComponentPropertyData, EntityPropertySchema, PropertyTabConfig } from "../protocol.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Merges component values, parameter list entries, and local edited overrides into a
 * normalized evaluation context for predicates (`visibleIf`, `enabledIf`) and validators.
 */
export function buildPropertyContextValues(
  properties: Pick<ComponentPropertyData, "name" | "description" | "values" | "parameters"> | null | undefined,
  localValues?: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};

  if (properties) {
    if (properties.name !== undefined) ctx["name"] = properties.name;
    if (properties.description !== undefined) ctx["description"] = properties.description;

    if (properties.values && typeof properties.values === "object") {
      for (const [k, v] of Object.entries(properties.values)) {
        if (v !== undefined) ctx[k] = v;
      }
    }

    if (Array.isArray(properties.parameters)) {
      for (const param of properties.parameters) {
        if (!param?.name || ctx[param.name] !== undefined) continue;
        if (param.isBoolean) {
          ctx[param.name] = param.value === "true" || (param.value as unknown) === true;
        } else if (param.value !== undefined) {
          ctx[param.name] = param.value;
        }
      }
    }
  }

  if (localValues) {
    for (const [k, v] of Object.entries(localValues)) {
      if (v !== undefined) ctx[k] = v;
    }
  }

  return ctx;
}

/** Filters schema tabs using `evaluatePropertyPredicate` against the current property values. */
export function getVisiblePropertyTabs(
  schema: EntityPropertySchema | undefined | null,
  contextValues: Record<string, unknown>,
): PropertyTabConfig[] {
  if (!schema?.tabs) return [];
  return schema.tabs.filter((tab) => evaluatePropertyPredicate(tab.visibleIf, contextValues));
}

/** Resolves a valid active tab ID from currently visible schema tabs. */
export function resolveActivePropertyTabId(
  visibleTabs: ReadonlyArray<PropertyTabConfig>,
  currentTabId?: string | undefined,
): string | undefined {
  if (visibleTabs.length === 0) return undefined;
  if (currentTabId && visibleTabs.some((t) => t.id === currentTabId)) {
    return currentTabId;
  }
  return visibleTabs[0]?.id;
}

export interface OptimisticPropertyAction {
  type: string;
  name?: unknown;
  oldName?: unknown;
  newName?: unknown;
  description?: unknown;
  parameter?: unknown;
  key?: unknown;
  value?: unknown;
}

/**
 * Returns an optimistically updated copy of `ComponentPropertyData` for property/name/description
 * edits, or returns the original reference untouched if the action does not target it.
 */
export function applyOptimisticPropertyAction<
  T extends ComponentPropertyData & { properties?: Record<string, unknown> },
>(prev: T | null | undefined, action: OptimisticPropertyAction): T | null | undefined {
  if (!prev) return prev;

  if (action.type === "updateParameter" || action.type === "updateProperty") {
    if (prev.name !== action.name) return prev;
    const paramKey =
      typeof (action.type === "updateParameter" ? action.parameter : action.key) === "string"
        ? String(action.type === "updateParameter" ? action.parameter : action.key)
        : "";
    if (!paramKey) return prev;
    const paramVal = String(action.value ?? "");

    const next: T = {
      ...prev,
      values: {
        ...(prev.values || {}),
        [paramKey]: action.value,
      },
      parameters: Array.isArray(prev.parameters)
        ? prev.parameters.map((p) => (p.name === paramKey ? { ...p, value: paramVal } : p))
        : prev.parameters,
    };
    if (prev.properties && typeof prev.properties === "object") {
      next.properties = { ...prev.properties, [paramKey]: action.value };
    }
    return next;
  }

  if (action.type === "updateName") {
    if (prev.name !== action.oldName || typeof action.newName !== "string") return prev;
    return { ...prev, name: action.newName };
  }

  if (action.type === "updateDescription") {
    if (prev.name !== action.name || typeof action.description !== "string") return prev;
    return { ...prev, description: action.description };
  }

  return prev;
}

/**
 * Safely substitutes parameter assignments and component name text in a component icon SVG
 * preview without failing on regex metacharacters in keys or instance names.
 */
export function applyLivePropertyIconSubstitutions(
  rawSvg: string | undefined | null,
  localValues: Record<string, unknown>,
  localName?: string | undefined,
  propName?: string | undefined,
): string {
  if (!rawSvg) return "";
  let svg = rawSvg;
  for (const [key, val] of Object.entries(localValues)) {
    if (val !== undefined && val !== "") {
      const escapedKey = escapeRegExp(key);
      const regex = new RegExp(`(<text[^>]*>\\s*${escapedKey}\\s*=\\s*)([^<]+)(</text>)`, "gi");
      svg = svg.replace(regex, `$1${String(val)}$3`);
    }
  }
  if (localName && propName) {
    const escapedName = escapeRegExp(propName);
    const nameRegex = new RegExp(`(<text[^>]*>\\s*)${escapedName}(\\s*</text>)`, "gi");
    svg = svg.replace(nameRegex, `$1${localName}$2`);
  }
  return svg;
}

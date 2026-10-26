// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Validation engine for Property Inspector fields.
 * Evaluates min, max, regex pattern, required flags, and custom validate functions.
 */

import type { EntityPropertySchema, PropertyFieldConfig } from "./protocol.js";

export interface PropertyValidationError {
  fieldKey: string;
  message: string;
}

const patternRegexCache = new Map<string, RegExp | null>();

function getCachedPatternRegex(pattern: string): RegExp | null {
  if (patternRegexCache.has(pattern)) {
    return patternRegexCache.get(pattern)!;
  }
  try {
    const reg = new RegExp(pattern);
    patternRegexCache.set(pattern, reg);
    return reg;
  } catch {
    patternRegexCache.set(pattern, null);
    return null;
  }
}

/**
 * Validates a single field value against its configuration and current context values.
 * Returns an error string or null if valid.
 */
export function validatePropertyValue(
  field: PropertyFieldConfig,
  value: any,
  contextValues: Record<string, any> = {},
): string | null {
  const isPresent = value !== undefined && value !== null && value !== "";

  // 1. Required check
  if (field.required && !isPresent) {
    return `${field.label || field.key} is required.`;
  }

  if (!isPresent) {
    return null;
  }

  const validation = field.validation;
  if (!validation) {
    return null;
  }

  // 2. Numeric range checks (min / max)
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (!isNaN(num)) {
    if (validation.min !== undefined && num < validation.min) {
      return `${field.label || field.key} must be at least ${validation.min}.`;
    }
    if (validation.max !== undefined && num > validation.max) {
      return `${field.label || field.key} must not exceed ${validation.max}.`;
    }
  }

  // 3. Regex pattern check
  if (validation.pattern) {
    const reg = getCachedPatternRegex(validation.pattern);
    if (reg && !reg.test(String(value))) {
      return `${field.label || field.key} has an invalid format.`;
    }
  }

  // 4. Custom validation callback
  if (typeof validation.validate === "function") {
    try {
      const customErr = validation.validate(value, contextValues);
      if (customErr) return customErr;
    } catch (e: any) {
      return e?.message || "Validation failed";
    }
  }

  return null;
}

/**
 * Validates all visible fields in an EntityPropertySchema.
 * Returns a map of fieldKey -> errorMessage.
 */
export function validatePropertySchema(
  schema: EntityPropertySchema | undefined | null,
  values: Record<string, any> = {},
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!schema?.tabs) return errors;

  for (const tab of schema.tabs) {
    for (const group of tab.groups || []) {
      for (const field of group.fields || []) {
        const val = values[field.key] ?? field.defaultValue;
        const err = validatePropertyValue(field, val, values);
        if (err) {
          errors[field.key] = err;
        }
      }
    }
  }

  return errors;
}

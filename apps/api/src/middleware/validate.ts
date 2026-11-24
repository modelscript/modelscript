// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NextFunction, Request, Response } from "express";

export interface PaginationDefaults {
  limit?: number;
  maxLimit?: number;
  offset?: number;
}

export interface PaginationParams {
  limit: number;
  offset: number;
}

function parseQueryInt(raw: unknown): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Parse and clamp `limit` and `offset` pagination query parameters.
 * `limit` is always clamped to `1..maxLimit`, and `offset` is always `>= 0`.
 */
export function parsePagination(req: Request, defaults?: PaginationDefaults): PaginationParams {
  const maxLimit = Math.max(1, Math.trunc(defaults?.maxLimit ?? 100));
  const defaultLimit = Math.min(maxLimit, Math.max(1, Math.trunc(defaults?.limit ?? 20)));
  const defaultOffset = Math.max(0, Math.trunc(defaults?.offset ?? 0));

  const rawLimit = parseQueryInt(req.query["limit"]);
  const rawOffset = parseQueryInt(req.query["offset"]);

  const limit = Math.min(maxLimit, Math.max(1, rawLimit ?? defaultLimit));
  const offset = Math.max(0, rawOffset ?? defaultOffset);

  return { limit, offset };
}

/**
 * Standardized JSON error response helper.
 */
export function sendApiError(res: Response, status: number, message: string, code?: string): void {
  const payload: { error: string; code?: string } = code !== undefined ? { error: message, code } : { error: message };
  res.status(status).json(payload);
}

/**
 * Express middleware that verifies required JSON body fields are present and non-empty.
 * Responds with `400 { error: "Missing required fields: ..." }` if any field is missing.
 */
export function requireJsonFields(fields: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const body =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : null;

    const missing = fields.filter((field) => {
      if (!body) return true;
      const value = body[field];
      if (value === undefined || value === null) return true;
      if (typeof value === "string" && value.trim() === "") return true;
      return false;
    });

    if (missing.length > 0) {
      sendApiError(res, 400, `Missing required fields: ${missing.join(", ")}`);
      return;
    }

    next();
  };
}

export type FieldSchemaType = "string" | "number" | "boolean" | "array" | "object";

export interface FieldSchema {
  type: FieldSchemaType;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  enum?: ReadonlyArray<string | number | boolean>;
  description?: string;
  items?: FieldSchema;
  properties?: Record<string, FieldSchema>;
}

export interface ObjectSchema {
  type: "object";
  properties: Record<string, FieldSchema>;
  required?: string[];
  description?: string;
}

export interface ValidationIssue {
  field: string;
  message: string;
  expected?: string;
}

export interface OpenApiOperationSpec {
  summary?: string;
  description?: string;
  tags?: string[];
  operationId?: string;
  parameters?: Array<Record<string, unknown>>;
  requestBody?: ObjectSchema | Record<string, unknown>;
  responses?: Record<string, Record<string, unknown>>;
  security?: Array<Record<string, string[]>>;
}

export interface RegisteredOpenApiOperation {
  method: string;
  path: string;
  spec: OpenApiOperationSpec;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateFieldValue(fieldPath: string, value: unknown, schema: FieldSchema, issues: ValidationIssue[]): void {
  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") {
        issues.push({ field: fieldPath, message: "must be a string", expected: "string" });
        return;
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        issues.push({
          field: fieldPath,
          message: `must have length at least ${schema.minLength}`,
          expected: `string (minLength: ${schema.minLength})`,
        });
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        issues.push({
          field: fieldPath,
          message: `must have length at most ${schema.maxLength}`,
          expected: `string (maxLength: ${schema.maxLength})`,
        });
      }
      break;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        issues.push({ field: fieldPath, message: "must be a finite number", expected: "number" });
        return;
      }
      if (schema.min !== undefined && value < schema.min) {
        issues.push({
          field: fieldPath,
          message: `must be >= ${schema.min}`,
          expected: `number (min: ${schema.min})`,
        });
      }
      if (schema.max !== undefined && value > schema.max) {
        issues.push({
          field: fieldPath,
          message: `must be <= ${schema.max}`,
          expected: `number (max: ${schema.max})`,
        });
      }
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        issues.push({ field: fieldPath, message: "must be a boolean", expected: "boolean" });
        return;
      }
      break;
    }
    case "array": {
      if (!Array.isArray(value)) {
        issues.push({ field: fieldPath, message: "must be an array", expected: "array" });
        return;
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        issues.push({
          field: fieldPath,
          message: `must contain at least ${schema.minLength} item(s)`,
          expected: `array (minItems: ${schema.minLength})`,
        });
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        issues.push({
          field: fieldPath,
          message: `must contain at most ${schema.maxLength} item(s)`,
          expected: `array (maxItems: ${schema.maxLength})`,
        });
      }
      if (schema.items) {
        for (let i = 0; i < value.length; i += 1) {
          validateFieldValue(`${fieldPath}[${i}]`, value[i], schema.items, issues);
        }
      }
      break;
    }
    case "object": {
      if (!isPlainObject(value)) {
        issues.push({ field: fieldPath, message: "must be an object", expected: "object" });
        return;
      }
      if (schema.properties) {
        const nestedIssues = validateObject(value, { type: "object", properties: schema.properties });
        for (const nested of nestedIssues) {
          issues.push({
            field: nested.field ? `${fieldPath}.${nested.field}` : fieldPath,
            message: nested.message,
            ...(nested.expected !== undefined ? { expected: nested.expected } : {}),
          });
        }
      }
      break;
    }
  }

  if (schema.enum !== undefined && !schema.enum.includes(value as string | number | boolean)) {
    const allowed = schema.enum.map((v) => JSON.stringify(v)).join(", ");
    issues.push({
      field: fieldPath,
      message: `must be one of: ${allowed}`,
      expected: `enum(${allowed})`,
    });
  }
}

/**
 * Validate an unknown value against a typed `ObjectSchema`, returning any validation issues.
 */
export function validateObject(value: unknown, schema: ObjectSchema): ValidationIssue[] {
  if (!isPlainObject(value)) {
    return [{ field: "$", message: "Request body must be a JSON object", expected: "object" }];
  }

  const issues: ValidationIssue[] = [];
  const requiredFields = new Set<string>(schema.required ?? []);
  for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
    if (fieldSchema.required) {
      requiredFields.add(fieldName);
    }
  }

  for (const fieldName of requiredFields) {
    const fieldValue = value[fieldName];
    if (fieldValue === undefined || fieldValue === null) {
      const fieldSchema = schema.properties[fieldName];
      issues.push({
        field: fieldName,
        message: "is required",
        ...(fieldSchema?.type !== undefined ? { expected: fieldSchema.type } : {}),
      });
    }
  }

  for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
    const fieldValue = value[fieldName];
    if (fieldValue === undefined || fieldValue === null) {
      continue;
    }
    validateFieldValue(fieldName, fieldValue, fieldSchema, issues);
  }

  return issues;
}

/**
 * Convert a `FieldSchema` or `ObjectSchema` into a JSON Schema 2020-12 / OpenAPI 3.1.0 schema object.
 */
export function toJsonSchema(schema: ObjectSchema | FieldSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: schema.type };

  if (schema.description !== undefined) {
    out["description"] = schema.description;
  }

  if (schema.type === "object" && "properties" in schema && schema.properties) {
    const props: Record<string, unknown> = {};
    const requiredSet = new Set<string>("required" in schema && Array.isArray(schema.required) ? schema.required : []);

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (propSchema.required) {
        requiredSet.add(key);
      }
      props[key] = toJsonSchema(propSchema);
    }

    out["properties"] = props;
    if (requiredSet.size > 0) {
      out["required"] = Array.from(requiredSet);
    }
    return out;
  }

  const field = schema as FieldSchema;
  if (field.type === "string") {
    if (field.minLength !== undefined) out["minLength"] = field.minLength;
    if (field.maxLength !== undefined) out["maxLength"] = field.maxLength;
  } else if (field.type === "number") {
    if (field.min !== undefined) out["minimum"] = field.min;
    if (field.max !== undefined) out["maximum"] = field.max;
  } else if (field.type === "array") {
    if (field.minLength !== undefined) out["minItems"] = field.minLength;
    if (field.maxLength !== undefined) out["maxItems"] = field.maxLength;
    if (field.items) out["items"] = toJsonSchema(field.items);
  }

  if (field.enum !== undefined) {
    out["enum"] = [...field.enum];
  }

  return out;
}

/**
 * Express middleware that validates `req.body` against a typed JSON-Schema-compatible `ObjectSchema`.
 * Responds with `400 { error: "...", details: [...] }` on validation failure.
 */
export function validateBody(schema: ObjectSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const issues = validateObject(req.body, schema);
    if (issues.length > 0) {
      const first = issues[0]!;
      const message =
        issues.length === 1
          ? first.field === "$"
            ? first.message
            : `Validation failed: '${first.field}' ${first.message}`
          : `Validation failed (${issues.length} errors)`;
      res.status(400).json({ error: message, details: issues });
      return;
    }

    next();
  };
}

const openApiOperationRegistry = new Map<string, RegisteredOpenApiOperation>();

function normalizeOpenApiRegistryPath(rawPath: string): string {
  const collapsed = rawPath.replace(/\/+/g, "/");
  const withLeading = collapsed.startsWith("/") ? collapsed : `/${collapsed}`;
  const trimmed = withLeading.length > 1 && withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
  return trimmed.replace(/:([a-zA-Z0-9_]+)/g, "{$1}");
}

/**
 * Register rich OpenAPI 3.1.0 operation metadata (request/response schemas, summary, tags, etc.)
 * to be merged into the generated specification by `generateOpenApiSpec(app)`.
 */
export function registerOpenApiOperation(method: string, path: string, spec: OpenApiOperationSpec): void {
  const normalizedMethod = method.trim().toLowerCase();
  const normalizedPath = normalizeOpenApiRegistryPath(path.trim());
  const key = `${normalizedMethod} ${normalizedPath}`;
  openApiOperationRegistry.set(key, {
    method: normalizedMethod,
    path: normalizedPath,
    spec,
  });
}

/**
 * Return all registered OpenAPI operation specifications.
 */
export function getRegisteredOpenApiOperations(): RegisteredOpenApiOperation[] {
  return Array.from(openApiOperationRegistry.values());
}

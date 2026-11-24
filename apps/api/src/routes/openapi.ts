// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { Router } from "express";
import {
  getRegisteredOpenApiOperations,
  toJsonSchema,
  type ObjectSchema,
  type OpenApiOperationSpec,
} from "../middleware/validate.js";

type HttpMethod = "get" | "put" | "post" | "delete" | "options" | "head" | "patch" | "trace";

const VALID_HTTP_METHODS = new Set<string>(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

interface ExpressRouteLayer {
  path?: string | RegExp | ReadonlyArray<string | RegExp>;
  methods?: Record<string, boolean | undefined>;
}

interface ExpressLayerLike {
  name?: string;
  rawPath?: string | RegExp | ReadonlyArray<string | RegExp>;
  slash?: boolean;
  regexp?: RegExp & { fast_slash?: boolean };
  route?: ExpressRouteLayer;
  handle?: {
    stack?: ReadonlyArray<ExpressLayerLike>;
  };
}

interface ExpressAppWithRouter {
  router?: {
    stack?: ReadonlyArray<ExpressLayerLike>;
  };
  _router?: {
    stack?: ReadonlyArray<ExpressLayerLike>;
  };
}

export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  schema: Record<string, unknown>;
  description?: string;
}

export interface OpenApiOperation {
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  parameters?: Array<OpenApiParameter | Record<string, unknown>>;
  requestBody?: Record<string, unknown>;
  responses: Record<string, unknown>;
  security?: Array<Record<string, string[]>>;
}

export type OpenApiPathItem = Partial<Record<HttpMethod, OpenApiOperation>>;

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
    description: string;
    license: {
      name: string;
      identifier: string;
    };
  };
  servers: Array<{
    url: string;
    description: string;
  }>;
  components: {
    securitySchemes: Record<string, Record<string, unknown>>;
    schemas: Record<string, Record<string, unknown>>;
  };
  paths: Record<string, OpenApiPathItem>;
}

/**
 * Convert an Express mount/route RegExp to a normalized path segment.
 */
function regexToPathSegment(re: RegExp): string {
  let src = re.source;
  // Strip Express-style anchors and trailing mount lookaheads
  src = src
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\(\?=\\\/\|\$\)$/, "")
    .replace(/\\\/\?$/, "");

  // Unescape escaped slashes and dots
  src = src.replace(/\\\//g, "/").replace(/\\\./g, ".");

  // Replace simple capture groups with a placeholder parameter
  src = src.replace(/\((?:\?:)?[^)]*\)/g, "{param}");

  if (!src || src === "/") {
    return "";
  }
  return src.startsWith("/") ? src : `/${src}`;
}

/**
 * Extract one or more mount prefixes from an Express 5 (or Express 4 fallback) layer.
 */
function extractLayerPrefixes(layer: ExpressLayerLike): string[] {
  if (layer.rawPath !== undefined) {
    if (layer.slash && layer.rawPath === "/") {
      return [""];
    }
    const items = Array.isArray(layer.rawPath) ? layer.rawPath : [layer.rawPath];
    return items.map((item) => {
      if (item instanceof RegExp) {
        return regexToPathSegment(item);
      }
      return item === "/" ? "" : item;
    });
  }

  if (layer.regexp) {
    if (layer.regexp.fast_slash) {
      return [""];
    }
    return [regexToPathSegment(layer.regexp)];
  }

  return [""];
}

/**
 * Extract one or more route paths from an Express `layer.route.path`.
 */
function extractRoutePaths(routePath: ExpressRouteLayer["path"]): string[] {
  if (routePath === undefined) {
    return [""];
  }
  const items = Array.isArray(routePath) ? routePath : [routePath];
  return items.map((item) => {
    if (item instanceof RegExp) {
      return regexToPathSegment(item);
    }
    return item;
  });
}

/**
 * Join a mount prefix and a route segment into a clean OpenAPI path template,
 * converting Express parameter syntax (`:id`, `*splat`, `{*splat}`, `{:id}`)
 * into OpenAPI `{param}` templates and returning extracted parameter names.
 */
function normalizeOpenApiPath(prefix: string, segment: string): { path: string; params: string[] } {
  const combined = `${prefix}/${segment}`.replace(/\/+/g, "/");
  const trimmed = combined.length > 1 && combined.endsWith("/") ? combined.slice(0, -1) : combined;
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;

  const params: string[] = [];
  const seenParams = new Set<string>();
  const recordParam = (rawName: string): string => {
    const clean = rawName.replace(/[^a-zA-Z0-9_]/g, "") || "param";
    if (!seenParams.has(clean)) {
      seenParams.add(clean);
      params.push(clean);
    }
    return `{${clean}}`;
  };

  // Express 5 optional/wildcard braces: `{*splat}`, `{:id}`, `{/:id}`
  let openApiPath = withLeadingSlash.replace(/\{\/?[*:]?([a-zA-Z0-9_]+)\}/g, (_match, name: string) =>
    recordParam(name),
  );

  // Express `:param` (with optional trailing `?` or inline regex `(...)`)
  openApiPath = openApiPath.replace(/:([a-zA-Z0-9_]+)(?:\([^)]*\))?\??/g, (_match, name: string) => recordParam(name));

  // Express `*splat` or bare `*`
  openApiPath = openApiPath.replace(/\*([a-zA-Z0-9_]*)/g, (_match, name: string) => recordParam(name || "wildcard"));

  // Preserve any pre-existing `{param}` placeholders (e.g. from RegExp conversion)
  for (const match of openApiPath.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) {
    const name = match[1];
    if (name && !seenParams.has(name)) {
      seenParams.add(name);
      params.push(name);
    }
  }

  return { path: openApiPath, params };
}

/**
 * Infer a human-readable OpenAPI tag from a normalized path.
 */
function inferTag(openApiPath: string): string {
  const segments = openApiPath.split("/").filter((s) => s.length > 0 && !s.startsWith("{"));
  if (segments[0] === "api" && segments[1] === "v1" && segments[2]) {
    return segments[2];
  }
  if (segments[0] === "api" && segments[1]) {
    return segments[1];
  }
  return segments[0] ?? "system";
}

/**
 * Derive a deterministic, unique OpenAPI `operationId`.
 */
function buildOperationId(method: HttpMethod, openApiPath: string, usedIds: Set<string>): string {
  const parts = openApiPath
    .split("/")
    .filter((s) => s.length > 0)
    .map((segment) => {
      const cleaned = segment.startsWith("{") && segment.endsWith("}") ? `by_${segment.slice(1, -1)}` : segment;
      return cleaned.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    })
    .filter((s) => s.length > 0);

  const base = [method, ...parts].join("_") || `${method}_root`;
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }

  let suffix = 2;
  while (usedIds.has(`${base}_${suffix}`)) {
    suffix += 1;
  }
  const unique = `${base}_${suffix}`;
  usedIds.add(unique);
  return unique;
}

function jsonContentRef(schemaName: string): Record<string, unknown> {
  return {
    "application/json": {
      schema: { $ref: `#/components/schemas/${schemaName}` },
    },
  };
}

function jsonRequestBodyRef(schemaName: string, description?: string): Record<string, unknown> {
  return {
    required: true,
    ...(description ? { description } : {}),
    content: jsonContentRef(schemaName),
  };
}

const AUTH_SECURITY: Array<Record<string, string[]>> = [{ bearerAuth: [] }, { cookieAuth: [] }, { patAuth: [] }];

const PAGINATION_QUERY_PARAMS: Array<Record<string, unknown>> = [
  {
    name: "limit",
    in: "query",
    required: false,
    description: "Maximum number of items to return per page (1-100).",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
  },
  {
    name: "offset",
    in: "query",
    required: false,
    description: "Number of items to skip before collecting results.",
    schema: { type: "integer", minimum: 0, default: 0 },
  },
];

const BUILTIN_COMPONENT_SCHEMAS: Record<string, Record<string, unknown>> = {
  ApiError: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "string",
        description: "Human-readable error message.",
      },
      code: {
        type: "string",
        description: "Optional machine-readable error code.",
      },
      details: {
        type: ["array", "object"],
        description: "Optional structured validation or diagnostic details.",
      },
    },
  },
  PaginationParams: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        default: 20,
        description: "Maximum number of items to return per page.",
      },
      offset: {
        type: "integer",
        minimum: 0,
        default: 0,
        description: "Number of items to skip before collecting results.",
      },
      cursor: {
        type: "string",
        description: "Opaque pagination cursor for keyset navigation.",
      },
    },
  },
  LoginRequest: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: {
        type: "string",
        format: "email",
        description: "Registered account email address.",
      },
      password: {
        type: "string",
        format: "password",
        minLength: 1,
        maxLength: 72,
        description: "Account password (up to 72 UTF-8 bytes).",
      },
    },
  },
  AuthResponse: {
    type: "object",
    required: ["token"],
    properties: {
      token: {
        type: "string",
        description: "Signed JWT access token.",
      },
      requires2FA: {
        type: "boolean",
        description: "True when a second-factor challenge must be completed before full session issuance.",
      },
      challengeToken: {
        type: "string",
        description: "Short-lived 2FA challenge token returned when requires2FA is true.",
      },
      user: {
        type: "object",
        description: "Authenticated user profile summary.",
        properties: {
          id: { type: ["integer", "string"] },
          username: { type: "string" },
          email: { type: "string", format: "email" },
          displayName: { type: "string" },
          role: { type: "string" },
        },
      },
    },
  },
  OAuthExchangeRequest: {
    type: "object",
    required: ["code"],
    properties: {
      code: {
        type: "string",
        minLength: 1,
        description: "Single-use OAuth exchange code returned by the provider callback.",
      },
    },
  },
  WalletResponse: {
    type: "object",
    required: ["userId", "creditBalance"],
    properties: {
      userId: {
        type: ["integer", "string"],
        description: "Owner user or organization identifier.",
      },
      creditBalance: {
        type: "number",
        description: "Current available compute credit balance.",
      },
      totalSpent: {
        type: "number",
        description: "Cumulative compute credits spent.",
      },
      totalJobs: {
        type: "integer",
        minimum: 0,
        description: "Total number of compute jobs dispatched.",
      },
      totalCpuSeconds: {
        type: "number",
        minimum: 0,
        description: "Cumulative CPU execution time in seconds.",
      },
      totalGpuSeconds: {
        type: "number",
        minimum: 0,
        description: "Cumulative GPU execution time in seconds.",
      },
      balance: {
        type: "number",
        description: "Legacy alias for creditBalance.",
      },
      wallet: {
        type: "object",
        description: "Detailed wallet ledger metadata.",
      },
    },
  },
  TopupRequest: {
    type: "object",
    required: ["amount"],
    properties: {
      amount: {
        type: "number",
        minimum: 1,
        description: "Positive credit amount to add to the wallet.",
      },
      paymentIntentId: {
        type: "string",
        description: "Optional verified Stripe PaymentIntent ID.",
      },
    },
  },
  SimulateRequest: {
    type: "object",
    required: ["modelName"],
    properties: {
      modelName: {
        type: "string",
        minLength: 1,
        description: "Fully qualified Modelica/ModelScript model name to simulate.",
      },
      modelSource: {
        type: "string",
        description: "Inline model source code (required if libraryName/libraryVersion are not supplied).",
      },
      libraryName: {
        type: "string",
        description: "Published library package name containing the target model.",
      },
      libraryVersion: {
        type: "string",
        description: "SemVer version of the target library package.",
      },
      dependencies: {
        type: "array",
        description: "Additional library dependencies to load prior to compilation.",
        items: {
          type: "object",
          required: ["name", "version"],
          properties: {
            name: { type: "string" },
            version: { type: "string" },
          },
        },
      },
      profile: {
        type: "string",
        description: "Optional compute resource profile identifier.",
      },
    },
  },
  JobStatusResponse: {
    type: "object",
    required: ["jobId", "status"],
    properties: {
      jobId: {
        type: "string",
        description: "Unique simulation or compute job identifier.",
      },
      status: {
        type: "string",
        enum: ["queued", "running", "completed", "failed", "cancelled"],
        description: "Current lifecycle state of the job.",
      },
      progress: {
        type: "number",
        minimum: 0,
        maximum: 100,
        description: "Completion percentage (0-100) when available.",
      },
      createdAt: {
        type: "string",
        format: "date-time",
        description: "ISO-8601 timestamp when the job was queued.",
      },
      startedAt: {
        type: "string",
        format: "date-time",
        description: "ISO-8601 timestamp when execution started.",
      },
      completedAt: {
        type: "string",
        format: "date-time",
        description: "ISO-8601 timestamp when execution finished.",
      },
      error: {
        type: "string",
        description: "Error message if the job failed.",
      },
      resultUrl: {
        type: "string",
        description: "Endpoint URL for downloading simulation trajectories or artifacts.",
      },
    },
  },
  CreateSpaceRequest: {
    type: "object",
    required: ["slug", "name"],
    properties: {
      slug: {
        type: "string",
        minLength: 2,
        maxLength: 64,
        description: "URL-safe space slug (2-64 alphanumeric, dash, or underscore characters).",
      },
      name: {
        type: "string",
        minLength: 1,
        description: "Human-readable display name of the engineering space.",
      },
      tagline: {
        type: "string",
        description: "Short one-line summary of the space.",
      },
      description: {
        type: "string",
        description: "Detailed markdown description of the space.",
      },
      ownerType: {
        type: "string",
        enum: ["user", "organization"],
        description: "Owner namespace kind (defaults to user).",
      },
      organizationId: {
        type: "integer",
        description: "Organization ID when ownerType is organization.",
      },
      organizationSlug: {
        type: "string",
        description: "Organization slug when ownerType is organization.",
      },
      domainPreset: {
        type: "string",
        description: "Engineering domain preset identifier (defaults to systems_general).",
      },
      visibility: {
        type: "string",
        enum: ["public", "private", "unlisted"],
        description: "Visibility level for the space.",
      },
      defaultBranch: {
        type: "string",
        description: "Default Git branch name (defaults to main).",
      },
    },
  },
  CreatePostRequest: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "Markdown post content body.",
      },
      artifact_view_id: {
        type: "string",
        description: "Optional attached engineering artifact view identifier.",
      },
      artifactId: {
        type: "string",
        description: "Alias for artifact_view_id.",
      },
      reply_to_id: {
        type: "string",
        description: "Parent post ID when creating a threaded reply.",
      },
      quote_post_id: {
        type: "string",
        description: "Quoted post ID.",
      },
      repost_of_id: {
        type: "string",
        description: "Original post ID when creating a repost.",
      },
      visibility: {
        type: "string",
        enum: ["public", "unlisted", "followers", "direct"],
        description: "Post visibility scope.",
      },
      reply_visibility: {
        type: "string",
        description: "Who is allowed to reply to the post.",
      },
      content_warning: {
        type: "string",
        description: "Optional content warning / spoiler summary.",
      },
      metadata: {
        type: "object",
        description: "Optional structured metadata attached to the post.",
      },
      poll: {
        type: "object",
        description: "Optional interactive poll configuration.",
      },
      notebook: {
        type: "object",
        description: "Optional interactive notebook payload.",
      },
      cells: {
        type: "array",
        description: "Optional top-level notebook cells array.",
      },
    },
  },
};

const BUILTIN_OPERATION_SPECS: ReadonlyArray<{
  method: HttpMethod;
  path: string;
  spec: OpenApiOperationSpec;
}> = [
  {
    method: "post",
    path: "/api/v1/auth/login",
    spec: {
      summary: "Authenticate with email and password",
      tags: ["auth"],
      requestBody: jsonRequestBodyRef("LoginRequest", "User login credentials."),
      responses: {
        "200": {
          description: "Authentication succeeded (or 2FA challenge issued).",
          content: jsonContentRef("AuthResponse"),
        },
        "429": {
          description: "Too many failed login attempts.",
          content: jsonContentRef("ApiError"),
        },
      },
    },
  },
  {
    method: "post",
    path: "/api/v1/auth/oauth/exchange",
    spec: {
      summary: "Exchange a single-use OAuth code for a session token",
      tags: ["auth"],
      requestBody: jsonRequestBodyRef("OAuthExchangeRequest", "Single-use OAuth exchange code."),
      responses: {
        "200": {
          description: "OAuth code exchanged successfully.",
          content: jsonContentRef("AuthResponse"),
        },
      },
    },
  },
  {
    method: "get",
    path: "/api/v1/billing/wallet",
    spec: {
      summary: "Retrieve the authenticated user's compute credit wallet",
      tags: ["billing"],
      security: AUTH_SECURITY,
      responses: {
        "200": {
          description: "Current wallet balance and compute usage summary.",
          content: jsonContentRef("WalletResponse"),
        },
      },
    },
  },
  {
    method: "get",
    path: "/api/v1/billing/orgs/{orgId}/wallet",
    spec: {
      summary: "Retrieve an organization's compute credit wallet",
      tags: ["billing"],
      security: AUTH_SECURITY,
      responses: {
        "200": {
          description: "Organization wallet balance and compute usage summary.",
          content: jsonContentRef("WalletResponse"),
        },
      },
    },
  },
  {
    method: "get",
    path: "/api/v1/billing/transactions",
    spec: {
      summary: "List wallet credit ledger transactions",
      tags: ["billing"],
      security: AUTH_SECURITY,
      parameters: PAGINATION_QUERY_PARAMS,
    },
  },
  {
    method: "post",
    path: "/api/v1/billing/topup",
    spec: {
      summary: "Top up the authenticated user's compute credit wallet",
      tags: ["billing"],
      security: AUTH_SECURITY,
      requestBody: jsonRequestBodyRef("TopupRequest", "Wallet credit top-up payload."),
      responses: {
        "200": {
          description: "Updated wallet balance after top-up.",
          content: jsonContentRef("WalletResponse"),
        },
      },
    },
  },
  {
    method: "post",
    path: "/api/v1/billing/orgs/{orgId}/topup",
    spec: {
      summary: "Top up an organization's compute credit wallet",
      tags: ["billing"],
      security: AUTH_SECURITY,
      requestBody: jsonRequestBodyRef("TopupRequest", "Organization wallet credit top-up payload."),
      responses: {
        "200": {
          description: "Updated organization wallet balance after top-up.",
          content: jsonContentRef("WalletResponse"),
        },
      },
    },
  },
  {
    method: "post",
    path: "/api/v1/simulate",
    spec: {
      summary: "Enqueue a Modelica / ModelScript simulation job",
      tags: ["simulate"],
      requestBody: jsonRequestBodyRef("SimulateRequest", "Simulation job specification."),
      responses: {
        "200": {
          description: "Simulation job accepted and queued.",
          content: jsonContentRef("JobStatusResponse"),
        },
        "202": {
          description: "Simulation job accepted for asynchronous execution.",
          content: jsonContentRef("JobStatusResponse"),
        },
      },
    },
  },
  {
    method: "get",
    path: "/api/v1/simulate/{jobId}",
    spec: {
      summary: "Get the current status of a simulation job",
      tags: ["simulate"],
      responses: {
        "200": {
          description: "Simulation job status.",
          content: jsonContentRef("JobStatusResponse"),
        },
        "404": {
          description: "Job not found.",
          content: jsonContentRef("ApiError"),
        },
      },
    },
  },
  {
    method: "get",
    path: "/api/v1/spaces",
    spec: {
      summary: "List engineering spaces",
      tags: ["spaces"],
      parameters: PAGINATION_QUERY_PARAMS,
    },
  },
  {
    method: "post",
    path: "/api/v1/spaces",
    spec: {
      summary: "Create a new engineering space",
      tags: ["spaces"],
      security: AUTH_SECURITY,
      requestBody: jsonRequestBodyRef("CreateSpaceRequest", "New engineering space payload."),
    },
  },
  {
    method: "post",
    path: "/api/v1/social/posts",
    spec: {
      summary: "Publish a social or engineering feed post",
      tags: ["social"],
      security: AUTH_SECURITY,
      requestBody: jsonRequestBodyRef("CreatePostRequest", "Post creation payload."),
    },
  },
  {
    method: "get",
    path: "/api/v1/social/timeline",
    spec: {
      summary: "Fetch the authenticated user's home timeline",
      tags: ["social"],
      security: AUTH_SECURITY,
      parameters: PAGINATION_QUERY_PARAMS,
    },
  },
  {
    method: "get",
    path: "/api/v1/social/explore",
    spec: {
      summary: "Explore public engineering posts",
      tags: ["social"],
      parameters: PAGINATION_QUERY_PARAMS,
    },
  },
];

function isObjectSchema(value: unknown): value is ObjectSchema {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "object" &&
    typeof (value as { properties?: unknown }).properties === "object" &&
    (value as { properties?: unknown }).properties !== null
  );
}

function normalizeRequestBody(requestBody: ObjectSchema | Record<string, unknown>): Record<string, unknown> {
  if (isObjectSchema(requestBody)) {
    return {
      required: true,
      content: {
        "application/json": {
          schema: toJsonSchema(requestBody),
        },
      },
    };
  }
  return requestBody;
}

function mergeParameters(
  existing: Array<OpenApiParameter | Record<string, unknown>> | undefined,
  incoming: Array<Record<string, unknown>>,
): Array<OpenApiParameter | Record<string, unknown>> {
  const merged = [...(existing ?? [])];
  const indexByKey = new Map<string, number>();

  for (let i = 0; i < merged.length; i += 1) {
    const param = merged[i] as { in?: unknown; name?: unknown };
    if (typeof param.in === "string" && typeof param.name === "string") {
      indexByKey.set(`${param.in}:${param.name}`, i);
    }
  }

  for (const param of incoming) {
    const key =
      typeof param["in"] === "string" && typeof param["name"] === "string" ? `${param["in"]}:${param["name"]}` : null;
    if (key !== null && indexByKey.has(key)) {
      merged[indexByKey.get(key)!] = param;
    } else {
      if (key !== null) {
        indexByKey.set(key, merged.length);
      }
      merged.push(param);
    }
  }

  return merged;
}

function applyOperationSpec(operation: OpenApiOperation, spec: OpenApiOperationSpec): void {
  if (spec.operationId !== undefined) {
    operation.operationId = spec.operationId;
  }
  if (spec.summary !== undefined) {
    operation.summary = spec.summary;
  }
  if (spec.description !== undefined) {
    operation.description = spec.description;
  }
  if (spec.tags !== undefined && spec.tags.length > 0) {
    operation.tags = [...spec.tags];
  }
  if (spec.security !== undefined) {
    operation.security = spec.security;
  }
  if (spec.parameters !== undefined && spec.parameters.length > 0) {
    operation.parameters = mergeParameters(operation.parameters, spec.parameters);
  }
  if (spec.requestBody !== undefined) {
    operation.requestBody = normalizeRequestBody(spec.requestBody);
  }
  if (spec.responses !== undefined) {
    operation.responses = {
      ...operation.responses,
      ...spec.responses,
    };
  }
}

function createDefaultOperation(
  method: HttpMethod,
  openApiPath: string,
  params: string[],
  usedOperationIds: Set<string>,
): OpenApiOperation {
  const operation: OpenApiOperation = {
    operationId: buildOperationId(method, openApiPath, usedOperationIds),
    summary: `${method.toUpperCase()} ${openApiPath}`,
    tags: [inferTag(openApiPath)],
    responses: {
      "200": {
        description: "Successful response",
      },
      "400": {
        description: "Bad request",
        content: jsonContentRef("ApiError"),
      },
      "401": {
        description: "Unauthorized",
        content: jsonContentRef("ApiError"),
      },
    },
  };

  if (params.length > 0) {
    operation.parameters = params.map((name) => ({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
  }

  return operation;
}

/**
 * Dynamically introspect an Express 5 application's router stack and generate
 * an OpenAPI 3.1.0 specification document, enriched with built-in schemas
 * and any operations registered via `registerOpenApiOperation`.
 */
export function generateOpenApiSpec(app: express.Express): OpenApiDocument {
  const appWithRouter = app as unknown as ExpressAppWithRouter;
  const rootStack = appWithRouter.router?.stack ?? appWithRouter._router?.stack ?? [];

  const discoveredPaths = new Map<string, OpenApiPathItem>();
  const usedOperationIds = new Set<string>();
  const activeStacks = new Set<ReadonlyArray<ExpressLayerLike>>();

  const traverse = (stack: ReadonlyArray<ExpressLayerLike>, prefix: string): void => {
    if (activeStacks.has(stack)) {
      return;
    }
    activeStacks.add(stack);

    try {
      for (const layer of stack) {
        if (layer.route) {
          const methods = Object.entries(layer.route.methods ?? {})
            .filter(([method, enabled]) => Boolean(enabled) && VALID_HTTP_METHODS.has(method.toLowerCase()))
            .map(([method]) => method.toLowerCase() as HttpMethod);

          if (methods.length === 0) {
            continue;
          }

          const routePaths = extractRoutePaths(layer.route.path);
          for (const routePath of routePaths) {
            const { path: openApiPath, params } = normalizeOpenApiPath(prefix, routePath);
            let pathItem = discoveredPaths.get(openApiPath);
            if (!pathItem) {
              pathItem = {};
              discoveredPaths.set(openApiPath, pathItem);
            }

            for (const method of methods) {
              if (pathItem[method]) {
                continue;
              }
              pathItem[method] = createDefaultOperation(method, openApiPath, params, usedOperationIds);
            }
          }
          continue;
        }

        const subStack = layer.handle?.stack;
        if (Array.isArray(subStack)) {
          const mountPrefixes = extractLayerPrefixes(layer);
          for (const mountPrefix of mountPrefixes) {
            const nextPrefix = mountPrefix ? `${prefix}/${mountPrefix}`.replace(/\/+/g, "/") : prefix;
            traverse(subStack, nextPrefix);
          }
        }
      }
    } finally {
      activeStacks.delete(stack);
    }
  };

  traverse(rootStack, "");

  // Attach built-in operation schemas to matching discovered routes
  for (const builtin of BUILTIN_OPERATION_SPECS) {
    const pathItem = discoveredPaths.get(builtin.path);
    const operation = pathItem?.[builtin.method];
    if (operation) {
      applyOperationSpec(operation, builtin.spec);
    }
  }

  // Merge all dynamically registered operation specs (enriching discovered routes or adding registered-only routes)
  for (const registered of getRegisteredOpenApiOperations()) {
    if (!VALID_HTTP_METHODS.has(registered.method)) {
      continue;
    }
    const method = registered.method as HttpMethod;
    const { path: openApiPath, params } = normalizeOpenApiPath("", registered.path);

    let pathItem = discoveredPaths.get(openApiPath);
    if (!pathItem) {
      pathItem = {};
      discoveredPaths.set(openApiPath, pathItem);
    }

    let operation = pathItem[method];
    if (!operation) {
      operation = createDefaultOperation(method, openApiPath, params, usedOperationIds);
      pathItem[method] = operation;
    }

    applyOperationSpec(operation, registered.spec);
  }

  const sortedPaths: Record<string, OpenApiPathItem> = {};
  for (const key of Array.from(discoveredPaths.keys()).sort()) {
    const item = discoveredPaths.get(key);
    if (item) {
      sortedPaths[key] = item;
    }
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "ModelScript & Ansatz API",
      version: "1.0.0",
      description:
        "REST, GraphQL, SPARQL, Git Smart HTTP, ActivityPub federation, co-simulation, and engineering computation API for ModelScript and Ansatz.",
      license: {
        name: "AGPL-3.0-or-later",
        identifier: "AGPL-3.0-or-later",
      },
    },
    servers: [
      {
        url: "/",
        description: "Current API server root",
      },
      {
        url: "/api/v1",
        description: "API v1 base path",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT access token supplied via the Authorization: Bearer <token> header.",
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "access_token",
          description: "HTTP-only session cookie issued by /api/v1/auth/login.",
        },
        patAuth: {
          type: "http",
          scheme: "bearer",
          description: "Personal Access Token (msx_...) supplied via the Authorization: Bearer <token> header.",
        },
      },
      schemas: BUILTIN_COMPONENT_SCHEMAS,
    },
    paths: sortedPaths,
  };
}

/**
 * Router serving the dynamically introspected OpenAPI 3.1.0 specification
 * at `GET /openapi.json` (mounted at `/api/v1` to serve `/api/v1/openapi.json`).
 * The generated document is cached after the first request.
 */
export function openapiRouter(app: express.Express): Router {
  const router = Router();
  let cachedSpec: OpenApiDocument | null = null;

  router.get("/openapi.json", (_req, res) => {
    if (cachedSpec === null) {
      cachedSpec = generateOpenApiSpec(app);
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(cachedSpec);
  });

  return router;
}

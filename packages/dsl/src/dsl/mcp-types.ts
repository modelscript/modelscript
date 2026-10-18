// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Declarative Model Context Protocol (MCP) DSL (In-WASM Polyglot Engine).
 */

export type McpPrimitiveType = "string" | "number" | "boolean" | "array" | "object";

export interface McpPropertySchema {
  type: McpPrimitiveType;
  description?: string | undefined;
  required?: boolean | undefined;
  default?: any;
  enum?: string[] | undefined;
  items?: McpPropertySchema | undefined;
  properties?: Record<string, McpPropertySchema> | undefined;
}

export interface McpToolDeclaration<_RuleName extends string = string, QueryName extends string = string> {
  name: string;
  description: string;
  category?: "ast" | "query" | "simulation" | "reasoning" | "transformation" | "custom" | undefined;
  inputSchema: Record<string, McpPropertySchema>;
  targetQuery?: QueryName | undefined;
  targetAction?: string | undefined;
  inWasmHandler?: string | undefined;
  pure?: boolean | undefined;
  handler?: ((args: any, context: any) => Promise<any> | any) | undefined;
}

export interface McpResourceDeclaration {
  uriTemplate: string;
  name: string;
  mimeType?: string | undefined;
  description?: string | undefined;
  inWasmProvider?: string | undefined;
  provider?:
    | ((
        uri: string,
        context: any,
      ) =>
        | Promise<{ text?: string | undefined; blob?: Uint8Array | undefined; mimeType?: string | undefined }>
        | { text?: string | undefined; blob?: Uint8Array | undefined; mimeType?: string | undefined })
    | undefined;
}

export interface McpPromptDeclaration {
  name: string;
  description: string;
  arguments?: { name: string; description: string; required?: boolean | undefined }[] | undefined;
  template: string | ((args: Record<string, string>) => string);
}

export interface McpDeclarationConfig<
  RuleName extends string = string,
  _FieldName extends string = string,
  QueryName extends string = string,
  _ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  serverName?: string | undefined;
  serverVersion?: string | undefined;
  tools: McpToolDeclaration<RuleName, QueryName>[];
  resources?: McpResourceDeclaration[] | undefined;
  prompts?: McpPromptDeclaration[] | undefined;
}

export function mcpTool<RuleName extends string = string, QueryName extends string = string>(
  options: McpToolDeclaration<RuleName, QueryName>,
): McpToolDeclaration<RuleName, QueryName> {
  return options;
}

export function mcpResource(options: McpResourceDeclaration): McpResourceDeclaration {
  return options;
}

export function mcpPrompt(options: McpPromptDeclaration): McpPromptDeclaration {
  return options;
}

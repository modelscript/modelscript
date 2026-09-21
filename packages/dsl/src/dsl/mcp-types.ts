/**
 * Declarative Model Context Protocol (MCP) DSL (In-WASM Polyglot Engine).
 */

export type McpPrimitiveType = "string" | "number" | "boolean" | "array" | "object";

export interface McpPropertySchema {
  type: McpPrimitiveType;
  description?: string;
  required?: boolean;
  default?: any;
  enum?: string[];
  items?: McpPropertySchema;
  properties?: Record<string, McpPropertySchema>;
}

export interface McpToolDeclaration<RuleName extends string = string, QueryName extends string = string> {
  name: string;
  description: string;
  category?: "ast" | "query" | "simulation" | "reasoning" | "transformation" | "custom";
  inputSchema: Record<string, McpPropertySchema>;
  targetQuery?: QueryName;
  targetAction?: string;
  inWasmHandler?: string;
  pure?: boolean;
  handler?: (args: any, context: any) => Promise<any> | any;
}

export interface McpResourceDeclaration {
  uriTemplate: string;
  name: string;
  mimeType?: string;
  description?: string;
  inWasmProvider?: string;
  provider?: (
    uri: string,
    context: any,
  ) =>
    | Promise<{ text?: string; blob?: Uint8Array; mimeType?: string }>
    | { text?: string; blob?: Uint8Array; mimeType?: string };
}

export interface McpPromptDeclaration {
  name: string;
  description: string;
  arguments?: { name: string; description: string; required?: boolean }[];
  template: string | ((args: Record<string, string>) => string);
}

export interface McpDeclarationConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  serverName?: string;
  serverVersion?: string;
  tools: McpToolDeclaration<RuleName, QueryName>[];
  resources?: McpResourceDeclaration[];
  prompts?: McpPromptDeclaration[];
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

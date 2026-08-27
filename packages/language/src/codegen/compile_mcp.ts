// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpDeclarationConfig, McpPropertySchema } from "../dsl.js";
import { getDJB2Hash } from "./utils.js";

export interface McpManifestTool {
  name: string;
  description: string;
  category: string;
  inputSchema: Record<string, McpPropertySchema>;
  pure: boolean;
  targetQuery?: string;
  targetAction?: string;
  inWasmHandler?: string;
}

export interface McpManifestResource {
  uriTemplate: string;
  name: string;
  mimeType?: string;
  description?: string;
  inWasmProvider?: string;
}

export interface McpManifestPrompt {
  name: string;
  description: string;
  arguments?: { name: string; description: string; required?: boolean }[];
}

export interface McpManifest {
  serverName: string;
  serverVersion: string;
  tools: McpManifestTool[];
  resources: McpManifestResource[];
  prompts: McpManifestPrompt[];
}

export interface CompiledMcpOutput {
  sourceCode: string;
  manifest: McpManifest;
}

/**
 * Compiles declarative Model Context Protocol (MCP) tool, resource, and prompt configurations
 * into an in-WASM dispatch kernel with linear-memory I/O and a JSON-RPC schema manifest.
 */
export function compileMcpConfig(
  config?: McpDeclarationConfig,
  languageName: string = "modelscript",
): CompiledMcpOutput {
  const tools = config?.tools || [];
  const resources = config?.resources || [];
  const prompts = config?.prompts || [];

  const manifest: McpManifest = {
    serverName: config?.serverName || `${languageName}-mcp`,
    serverVersion: config?.serverVersion || "1.0.0",
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      category: t.category || "custom",
      inputSchema: t.inputSchema || {},
      pure: t.pure ?? false,
      targetQuery: t.targetQuery,
      targetAction: t.targetAction,
      inWasmHandler: t.inWasmHandler,
    })),
    resources: resources.map((r) => ({
      uriTemplate: r.uriTemplate,
      name: r.name,
      mimeType: r.mimeType,
      description: r.description,
      inWasmProvider: r.inWasmProvider,
    })),
    prompts: prompts.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    })),
  };

  let code = `// ============================================================================\n`;
  code += `// AOT Compiled Declarative Model Context Protocol (MCP) In-WASM Kernel\n`;
  code += `// ============================================================================\n`;
  code += `import { ChunkedUint8Array, createChunkedUint8Array } from "./array";\n`;
  code += `import { atomicChunkAlloc } from "./arena";\n\n`;

  code += `export const MCP_TOOL_COUNT: u32 = ${tools.length};\n\n`;

  // Output buffer for tool results
  code += `let t_mcpOutputBuffer: ChunkedUint8Array = changetype<ChunkedUint8Array>(0);\n`;
  code += `let t_mcpOutputFlatPtr: usize = 0;\n`;
  code += `let t_mcpOutputFlatCapacity: u32 = 0;\n\n`;

  code += `function ensureMcpBuffers(): void {\n`;
  code += `  if (changetype<usize>(t_mcpOutputBuffer) == 0) {\n`;
  code += `    t_mcpOutputBuffer = createChunkedUint8Array(4096);\n`;
  code += `    t_mcpOutputFlatCapacity = 4096;\n`;
  code += `    t_mcpOutputFlatPtr = atomicChunkAlloc(t_mcpOutputFlatCapacity);\n`;
  code += `  }\n`;
  code += `}\n\n`;

  code += `export function mcp_getToolCount(): u32 {\n`;
  code += `  return MCP_TOOL_COUNT;\n`;
  code += `}\n\n`;

  // Name hash lookup
  code += `export function mcp_getToolNameHash(index: u32): u32 {\n`;
  code += `  switch (index) {\n`;
  for (let i = 0; i < tools.length; i++) {
    const hash = getDJB2Hash(tools[i].name);
    code += `    case ${i}: return ${hash}; // ${tools[i].name}\n`;
  }
  code += `    default: return 0;\n`;
  code += `  }\n`;
  code += `}\n\n`;

  // Tool dispatcher
  code += `export function mcp_dispatchTool(toolIndex: u32, arg1: u32, arg2: u32, arg3: u32): u32 {\n`;
  code += `  ensureMcpBuffers();\n`;
  code += `  t_mcpOutputBuffer.clear();\n\n`;
  code += `  switch (toolIndex) {\n`;
  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i];
    code += `    case ${i}: { // ${tool.name}\n`;
    if (tool.inWasmHandler) {
      code += `      return ${tool.inWasmHandler}(arg1, arg2, arg3);\n`;
    } else {
      code += `      return 1; // Pure success signal\n`;
    }
    code += `    }\n`;
  }
  code += `    default: return 0;\n`;
  code += `  }\n`;
  code += `}\n\n`;

  // Result buffer export C-ABI
  code += `export function mcp_getOutputBuffer(): usize {\n`;
  code += `  ensureMcpBuffers();\n`;
  code += `  let len = t_mcpOutputBuffer.length;\n`;
  code += `  if (len > t_mcpOutputFlatCapacity) {\n`;
  code += `    t_mcpOutputFlatCapacity = len + 1024;\n`;
  code += `    t_mcpOutputFlatPtr = atomicChunkAlloc(t_mcpOutputFlatCapacity);\n`;
  code += `  }\n`;
  code += `  t_mcpOutputBuffer.copyToFlat(t_mcpOutputFlatPtr);\n`;
  code += `  return t_mcpOutputFlatPtr;\n`;
  code += `}\n\n`;

  code += `export function mcp_getOutputLength(): u32 {\n`;
  code += `  ensureMcpBuffers();\n`;
  code += `  return t_mcpOutputBuffer.length;\n`;
  code += `}\n`;

  return { sourceCode: code, manifest };
}

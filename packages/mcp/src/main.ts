#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Context } from "@modelscript/modelica/context";
import { createWasmParser } from "@modelscript/modelica/parser";
import { createRequire } from "node:module";
import { PolyglotMcpHost } from "./polyglot-server.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools.js";
import type { ServerContext } from "./types.js";

const SERVER_VERSION = "0.0.18";
const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(`@modelscript/mcp v${SERVER_VERSION}\n`);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    [
      `@modelscript/mcp v${SERVER_VERSION} — ModelScript Model Context Protocol (MCP) Server`,
      "",
      "Usage:",
      "  npx -y @modelscript/mcp",
      "  modelscript-mcp",
      "",
      "Client Setup:",
      '  VS Code CLI:    code --add-mcp \'{"name":"modelscript","command":"npx","args":["-y","@modelscript/mcp"]}\'',
      "  Claude Code:    claude mcp add modelscript -- npx -y @modelscript/mcp",
      '  VS Code JSON:   Add to .vscode/mcp.json under "servers"',
      '  Cursor / Wind:  Add to .cursor/mcp.json under "mcpServers"',
      "",
    ].join("\n"),
  );
  process.exit(0);
}

// Initialize WASM GLR parser
const require = createRequire(import.meta.url);
let modelicaWasmPath: string;
try {
  modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");
} catch {
  modelicaWasmPath = require.resolve("@modelscript/modelica/dist/parser.wasm");
}
const { parser } = await createWasmParser(modelicaWasmPath);
Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);

// Shared mutable context — populated by modelica_load tool
const ctx: ServerContext = { current: null };

// Create MCP server
const server = new McpServer({
  name: "modelscript",
  version: SERVER_VERSION,
});

const host = new PolyglotMcpHost(server, ctx);
ctx.polyglotHost = host;

registerTools(server, ctx);
registerResources(server, ctx);

// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);

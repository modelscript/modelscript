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

// Initialize WASM GLR parser
const require = createRequire(import.meta.url);
const modelicaWasmPath = require.resolve("@modelscript/modelica/dist/parser.wasm");
const { parser } = await createWasmParser(modelicaWasmPath);
Context.registerParser(".mo", parser as any);

// Shared mutable context — populated by modelica_load tool
const ctx: ServerContext = { current: null };

// Create MCP server
const server = new McpServer({
  name: "modelscript",
  version: "0.0.1",
});

const host = new PolyglotMcpHost(server, ctx);
ctx.polyglotHost = host;

registerTools(server, ctx);
registerResources(server, ctx);

// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);

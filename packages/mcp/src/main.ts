#!/usr/bin/env node

// SPDX-License-Identifier: AGPL-3.0-or-later

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Context } from "@modelscript/core";
import Modelica from "@modelscript/tree-sitter-modelica";
import Parser from "tree-sitter";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools.js";
import type { ServerContext } from "./types.js";

// Initialize tree-sitter parser
const parser = new Parser();
parser.setLanguage(Modelica);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
Context.registerParser(".mo", parser as any);

// Shared mutable context — populated by modelica_load tool
const ctx: ServerContext = { current: null };

// Create MCP server
const server = new McpServer({
  name: "modelscript",
  version: "0.0.1",
});

registerTools(server, ctx);
registerResources(server, ctx);

// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);

// SPDX-License-Identifier: AGPL-3.0-or-later

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PolyglotMcpHost } from "./polyglot-server.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools.js";
import type { ServerContext } from "./types.js";

export interface CreateMcpServerOptions {
  name?: string;
  version?: string;
}

/**
 * Creates and initializes a ModelScript McpServer with all polyglot
 * tools and resources registered for a given ServerContext.
 */
export function createModelScriptMcpServer(ctx: ServerContext, options?: CreateMcpServerOptions): McpServer {
  const server = new McpServer({
    name: options?.name ?? "modelscript-hub",
    version: options?.version ?? "0.1.0",
  });

  const host = new PolyglotMcpHost(server, ctx);
  ctx.polyglotHost = host;

  registerTools(server, ctx);
  registerResources(server, ctx);

  return server;
}

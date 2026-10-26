// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module @modelscript/mcp
 *
 * Public entrypoint for the ModelScript Model Context Protocol (MCP) package.
 * Re-exports server factory helpers, virtual filesystem bridges, the polyglot
 * MCP host, read-only resource providers, compilation/simulation tool handlers,
 * and shared context types.
 */

// Server instantiation and initialization helpers
export * from "./factory.js";
// Virtual and local filesystem adapters for MCP workspaces
export * from "./filesystem.js";
// Declarative polyglot MCP manifest host and digital thread conflict resolver
export * from "./polyglot-server.js";
// Read-only MCP resource endpoints (libraries, classes, class details)
export * from "./resources.js";
// MCP tool registrations for compilation, simulation, verification, and synthesis
export * from "./tools.js";
// Shared topology, quota accounting, and server context interfaces
export * from "./types.js";
// Deterministic execution sandbox for AI agents
export * from "./sandbox.js";

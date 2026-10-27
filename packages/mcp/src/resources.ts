// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "./types.js";

/**
 * Register MCP resources for read-only access to loaded Modelica model data.
 *
 * Exposes three URI endpoints:
 * - `modelica://libraries`: Lists all currently loaded Modelica libraries and their filesystem paths.
 * - `modelica://classes`: Lists all top-level and library classes with their class kind and source library.
 * - `modelica://classes/{name}`: Returns detailed component declarations and nested classes for a specific class.
 *
 * @param server - Target MCP server instance on which resources are registered.
 * @param ctx - Shared server context holding the active compiler `Context`.
 */
export function registerResources(server: McpServer, ctx: ServerContext): void {
  // ── modelica://libraries ───────────────────────────────────────────────

  /**
   * Resource endpoint returning a JSON array of all libraries loaded in the active context.
   */
  server.resource("libraries", "modelica://libraries", async () => {
    // Require an initialized compiler context before enumerating libraries
    if (!ctx.current) {
      return {
        contents: [
          {
            uri: "modelica://libraries",
            mimeType: "application/json",
            text: JSON.stringify({ error: "No libraries loaded. Call modelica_load first." }),
          },
        ],
      };
    }

    // Collect each loaded library's display name and resolved path
    const libraries: { name: string; path: string }[] = [];
    for (const lib of ctx.current.listLibraries()) {
      libraries.push({
        name: lib.name ?? "<unknown>",
        path: lib.path,
      });
    }

    return {
      contents: [
        {
          uri: "modelica://libraries",
          mimeType: "application/json",
          text: JSON.stringify(libraries, null, 2),
        },
      ],
    };
  });

  // ── modelica://classes ─────────────────────────────────────────────────

  /**
   * Resource endpoint returning a JSON summary of all classes across loaded libraries and inline sources.
   */
  server.resource("classes", "modelica://classes", async () => {
    if (!ctx.current) {
      return {
        contents: [
          {
            uri: "modelica://classes",
            mimeType: "application/json",
            text: JSON.stringify({ error: "No libraries loaded. Call modelica_load first." }),
          },
        ],
      };
    }

    // Gather classes exported by each registered library package
    const classes: { name: string; kind: string; library: string }[] = [];
    for (const lib of ctx.current.listLibraries()) {
      for (const element of (lib as any).elements || []) {
        if (element && (element.isClassInstance || element.kind === "Class" || element.classKind)) {
          classes.push({
            name: element.name ?? "<anonymous>",
            kind: element.classKind ?? element.kind ?? "class",
            library: lib.name ?? "<unknown>",
          });
        }
      }
    }

    // Also include context-loaded classes (from load())
    for (const cls of ctx.current.classes) {
      classes.push({
        name: cls.name ?? "<anonymous>",
        kind: cls.classKind ?? cls.kind ?? "class",
        library: "<inline>",
      });
    }

    return {
      contents: [
        {
          uri: "modelica://classes",
          mimeType: "application/json",
          text: JSON.stringify(classes, null, 2),
        },
      ],
    };
  });

  // ── modelica://classes/{name} (resource template) ──────────────────────

  /**
   * Resource template endpoint returning detailed structural metadata (components and nested classes)
   * for a specific Modelica class queried by its qualified or simple name.
   */
  server.resource("class-details", "modelica://classes/{name}", async (uri) => {
    if (!ctx.current) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ error: "No libraries loaded. Call modelica_load first." }),
          },
        ],
      };
    }

    // Extract the target class name from the `modelica://classes/{name}` URI path
    const name = uri.pathname.replace(/^\/\/classes\//, "").replace(/^\//, "");

    const element: any = ctx.current.query(name);

    if (!element) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ error: `Class '${name}' not found.` }),
          },
        ],
      };
    }

    // Reject queries that resolve to a component usage rather than a class definition
    if (element.isClassInstance === false || (element.kind && element.kind === "Component")) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ error: `'${name}' is not a class.` }),
          },
        ],
      };
    }

    // Partition child elements into component declarations and nested class definitions
    const components: { name: string; type: string; description: string }[] = [];
    const childClasses: { name: string; kind: string }[] = [];

    for (const child of element.elements || []) {
      if (child.isComponentInstance || child.kind === "Component") {
        components.push({
          name: child.name ?? "",
          type: child.classInstance?.name ?? child.type ?? "",
          description: child.description ?? "",
        });
      } else if (child.isClassInstance || child.kind === "Class" || child.classKind) {
        childClasses.push({
          name: child.name ?? "",
          kind: child.classKind ?? child.kind ?? "class",
        });
      }
    }

    const info = {
      name,
      kind: element.classKind ?? "class",
      description: element.description ?? "",
      components,
      childClasses,
    };

    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(info, null, 2),
        },
      ],
    };
  });
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ModelicaClassInstance, ModelicaComponentInstance } from "@modelscript/core";
import type { ServerContext } from "./types.js";

/**
 * Register MCP resources for read-only access to loaded Modelica model data.
 */
export function registerResources(server: McpServer, ctx: ServerContext): void {
  // ── modelica://libraries ───────────────────────────────────────────────

  server.resource("libraries", "modelica://libraries", async () => {
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

    const classes: { name: string; kind: string; library: string }[] = [];
    for (const lib of ctx.current.listLibraries()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const element of (lib as any).elements) {
        if (element instanceof ModelicaClassInstance) {
          classes.push({
            name: element.name ?? "<anonymous>",
            kind: element.classKind ?? "class",
            library: lib.name ?? "<unknown>",
          });
        }
      }
    }

    // Also include context-loaded classes (from load())
    for (const cls of ctx.current.classes) {
      classes.push({
        name: cls.name ?? "<anonymous>",
        kind: cls.classKind ?? "class",
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

    const name = uri.pathname.replace(/^\/\/classes\//, "");
    const element = ctx.current.query(name);

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

    if (!(element instanceof ModelicaClassInstance)) {
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

    const components: { name: string; type: string; description: string }[] = [];
    const childClasses: { name: string; kind: string }[] = [];

    for (const child of element.elements) {
      if (child instanceof ModelicaComponentInstance) {
        components.push({
          name: child.name ?? "",
          type: child.classInstance?.name ?? "",
          description: child.description ?? "",
        });
      } else if (child instanceof ModelicaClassInstance) {
        childClasses.push({
          name: child.name ?? "",
          kind: child.classKind ?? "class",
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

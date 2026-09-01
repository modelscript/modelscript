// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

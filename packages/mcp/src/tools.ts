// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  Context,
  ModelicaClassInstance,
  ModelicaComponentInstance,
  ModelicaDAE,
  ModelicaDAEPrinter,
  ModelicaFlattener,
  ModelicaLinter,
  ModelicaStoredDefinitionSyntaxNode,
  StringWriter,
} from "@modelscript/core";
import { ModelicaSimulator } from "@modelscript/simulator";
import path from "node:path";
import { z } from "zod";
import { NodeFileSystem } from "./filesystem.js";
import type { ServerContext } from "./types.js";

/**
 * Register all Modelica MCP tools on the server.
 */
export function registerTools(server: McpServer, ctx: ServerContext): void {
  // ── modelica_load ──────────────────────────────────────────────────────

  server.tool(
    "modelica_load",
    "Load Modelica libraries from file system paths. Must be called before using other tools.",
    { paths: z.array(z.string()).describe("Absolute or relative paths to Modelica libraries or .mo files") },
    async ({ paths }) => {
      const context = new Context(new NodeFileSystem());
      ctx.current = context;

      const loaded: string[] = [];
      for (const p of paths) {
        const resolved = path.resolve(p);
        const library = context.addLibrary(resolved);
        if (library) {
          loaded.push(library.name ?? resolved);
        } else {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to load library from '${p}'. Path must point to a .mo file or a directory containing package.mo.`,
              },
            ],
            isError: true,
          };
        }
      }

      return {
        content: [{ type: "text" as const, text: `Loaded ${loaded.length} library(ies): ${loaded.join(", ")}` }],
      };
    },
  );

  // ── modelica_parse ─────────────────────────────────────────────────────

  server.tool(
    "modelica_parse",
    "Parse inline Modelica source code and return a summary of classes, components, and any syntax errors.",
    { code: z.string().describe("Modelica source code to parse") },
    async ({ code }) => {
      const context = ctx.current ?? new Context(new NodeFileSystem());
      if (!ctx.current) ctx.current = context;

      const tree = context.parse(".mo", code);
      const errors: string[] = [];

      // Collect syntax errors from tree-sitter
      const linter = new ModelicaLinter((_type: string, _code: number, message: string) => {
        errors.push(message);
      });
      linter.lint(tree);

      // Build AST
      const storedDef = ModelicaStoredDefinitionSyntaxNode.new(
        null,

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tree.rootNode as any,
      );
      const classes: { name: string; kind: string; components: string[]; equations: string[] }[] = [];

      if (storedDef) {
        for (const classDef of storedDef.classDefinitions) {
          const name = classDef.identifier?.text ?? "<anonymous>";
          const kind = classDef.classPrefixes?.classKind ?? "class";
          const components: string[] = [];
          const equations: string[] = [];

          for (const element of classDef.elements) {
            if (element.sourceRange) {
              const text = code.slice(element.sourceRange.startIndex, element.sourceRange.endIndex).trim();
              if (text) components.push(text);
            }
          }
          for (const eq of classDef.equations) {
            if (eq.sourceRange) {
              const text = code.slice(eq.sourceRange.startIndex, eq.sourceRange.endIndex).trim();
              if (text) equations.push(text);
            }
          }

          classes.push({ name, kind: String(kind), components, equations });
        }
      }

      const result = {
        classes,
        syntaxErrors: errors,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ── modelica_flatten ───────────────────────────────────────────────────

  server.tool(
    "modelica_flatten",
    "Flatten a Modelica class to its DAE (Differential Algebraic Equation) form. Resolves inheritance, modifications, and produces the flat equation system.",
    { name: z.string().describe("Fully qualified class name to flatten") },
    async ({ name }) => {
      if (!ctx.current) {
        return {
          content: [{ type: "text" as const, text: "No libraries loaded. Call modelica_load first." }],
          isError: true,
        };
      }

      const result = ctx.current.flatten(name);
      if (!result) {
        return {
          content: [{ type: "text" as const, text: `Class '${name}' not found or has errors.` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: result }],
      };
    },
  );

  // ── modelica_lint ──────────────────────────────────────────────────────

  server.tool(
    "modelica_lint",
    "Lint loaded Modelica libraries and return diagnostics (errors, warnings) with source locations.",
    {
      path: z.string().optional().describe("Optional: restrict linting to a specific library path"),
    },
    async ({ path: lintPath }) => {
      if (!ctx.current) {
        return {
          content: [{ type: "text" as const, text: "No libraries loaded. Call modelica_load first." }],
          isError: true,
        };
      }

      const diagnostics: {
        file: string | null;
        line: number;
        column: number;
        severity: string;
        code: string;
        message: string;
      }[] = [];
      const linter = new ModelicaLinter(
        (
          type: string,
          code: number,
          message: string,
          resource: string | null | undefined,
          range: { startPosition: { row: number; column: number } } | null | undefined,
        ) => {
          diagnostics.push({
            file: resource ?? null,
            line: (range?.startPosition.row ?? 0) + 1,
            column: (range?.startPosition.column ?? 0) + 1,
            severity: type,
            code: code > 0 ? `M${code}` : "",
            message,
          });
        },
      );

      // Lint all or specific library
      for (const library of ctx.current.listLibraries()) {
        if (lintPath && library.path !== path.resolve(lintPath)) continue;
        linter.lint(library);
      }

      if (diagnostics.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No diagnostics found." }],
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(diagnostics, null, 2) }],
      };
    },
  );

  // ── modelica_simulate ──────────────────────────────────────────────────

  server.tool(
    "modelica_simulate",
    "Flatten and simulate a Modelica model, returning time-series results.",
    {
      name: z.string().describe("Fully qualified class name to simulate"),
      startTime: z.number().optional().describe("Simulation start time (default: from annotation or 0)"),
      stopTime: z.number().optional().describe("Simulation stop time (default: from annotation or 10)"),
      interval: z.number().optional().describe("Output interval (default: (stopTime-startTime)/1000)"),
      solver: z.enum(["rk4", "dopri5", "bdf", "auto"]).optional().describe("ODE solver (default: dopri5)"),
      format: z.enum(["csv", "json"]).optional().describe("Output format (default: json)"),
    },
    async ({ name, startTime, stopTime, interval, solver, format }) => {
      if (!ctx.current) {
        return {
          content: [{ type: "text" as const, text: "No libraries loaded. Call modelica_load first." }],
          isError: true,
        };
      }

      const instance = ctx.current.query(name);
      if (!instance) {
        return {
          content: [{ type: "text" as const, text: `Class '${name}' not found.` }],
          isError: true,
        };
      }

      // Flatten
      const dae = new ModelicaDAE(instance.name ?? "DAE", instance.description);
      instance.accept(new ModelicaFlattener(), ["", dae]);

      // Check for errors
      const errors: string[] = [];
      const linter = new ModelicaLinter((type: string, _code: number, message: string) => {
        if (type === "error") errors.push(message);
      });
      linter.lint(instance);

      if (errors.length > 0) {
        return {
          content: [{ type: "text" as const, text: `Flatten errors:\n${errors.join("\n")}` }],
          isError: true,
        };
      }

      // Simulate
      const simulator = new ModelicaSimulator(dae);
      simulator.prepare();

      const exp = dae.experiment;
      const t0 = startTime ?? exp.startTime ?? 0;
      const t1 = stopTime ?? exp.stopTime ?? 10;
      const dt = interval ?? exp.interval ?? (t1 - t0) / 1000;

      const result = simulator.simulate(t0, t1, dt, {
        solver: (solver ?? "dopri5") as "rk4" | "dopri5" | "bdf" | "auto",
      });
      const states = result.states;

      if ((format ?? "json") === "csv") {
        const lines = [`time,${states.join(",")}`];
        for (let i = 0; i < result.t.length; i++) {
          const values = [result.t[i], ...states.map((_: string, vi: number) => result.y[i]?.[vi] ?? 0)];
          lines.push(values.join(","));
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } else {
        const rows = result.t.map((t: number, i: number) => {
          const row: Record<string, number> = { time: t };
          states.forEach((state: string, vi: number) => {
            row[state] = result.y[i]?.[vi] ?? 0;
          });
          return row;
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
      }
    },
  );

  // ── modelica_query ─────────────────────────────────────────────────────

  server.tool(
    "modelica_query",
    "Introspect a Modelica class — returns its kind, description, components, extends hierarchy, and equations.",
    { name: z.string().describe("Fully qualified class name to query") },
    async ({ name }) => {
      if (!ctx.current) {
        return {
          content: [{ type: "text" as const, text: "No libraries loaded. Call modelica_load first." }],
          isError: true,
        };
      }

      const element = ctx.current.query(name);
      if (!element) {
        return {
          content: [{ type: "text" as const, text: `Class '${name}' not found.` }],
          isError: true,
        };
      }

      if (!(element instanceof ModelicaClassInstance)) {
        return {
          content: [{ type: "text" as const, text: `'${name}' is not a class.` }],
          isError: true,
        };
      }

      // Gather class info
      const components: { name: string; type: string; description: string }[] = [];
      const extends_: string[] = [];

      for (const child of element.elements) {
        if (child instanceof ModelicaComponentInstance) {
          components.push({
            name: child.name ?? "",
            type: child.classInstance?.name ?? "",
            description: child.description ?? "",
          });
        } else if (child instanceof ModelicaClassInstance) {
          // Nested class or extends
        }
      }

      // Flatten to get equations
      const dae = new ModelicaDAE(element.name ?? name, element.description);
      try {
        element.accept(new ModelicaFlattener(), ["", dae]);
      } catch {
        // Flatten may fail for some classes — still return what we can
      }

      const equationTexts: string[] = [];
      const out = new StringWriter();
      dae.accept(new ModelicaDAEPrinter(out));
      const flatText = out.toString();
      // Extract equation lines from flattened output
      const eqMatch = flatText.match(/equation\n([\s\S]*?)(?:\nend |$)/);
      if (eqMatch?.[1]) {
        for (const line of eqMatch[1].split("\n")) {
          const trimmed = line.trim();
          if (trimmed && trimmed !== "equation") equationTexts.push(trimmed);
        }
      }

      const info = {
        name,
        kind: element.classKind ?? "class",
        description: element.description ?? "",
        components,
        extends: extends_,
        equations: equationTexts,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(info, null, 2) }],
      };
    },
  );
}

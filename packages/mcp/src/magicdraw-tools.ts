// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * MCP tools for inspecting, rendering diagrams from, semantically diffing,
 * and migrating MagicDraw / Cameo (.mdzip, .mdxml, .xmi) models.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildMagicDrawDiagram,
  diffMagicDrawDocuments,
  formatMagicDrawDiffMarkdown,
  lintMagicDrawDocument,
  migrateMagicDrawToSysml2Workspace,
  parseMagicDraw,
  renderMagicDrawDiagramSvg,
} from "@modelscript/magicdraw";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ServerContext } from "./types.js";

function resolveSafePath(_ctx: ServerContext, inputPath: string): string {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);
}

export function registerMagicDrawTools(server: McpServer, ctx: ServerContext): void {
  server.tool(
    "magicdraw_inspect",
    "Inspect a MagicDraw / Cameo (.mdzip, .mdxml, .xmi) model: packages, blocks, requirements, diagrams, and semantic lints.",
    {
      filePath: z.string().describe("Path to the .mdzip, .mdxml, or .xmi file"),
    },
    async ({ filePath }) => {
      const abs = resolveSafePath(ctx, filePath);
      const doc = parseMagicDraw(new Uint8Array(fs.readFileSync(abs)));
      const diags = lintMagicDrawDocument(doc);
      const summary = {
        projectName: doc.metadata.projectName,
        format: doc.metadata.format,
        status: doc.metadata.status,
        packages: doc.packages.size,
        classifiers: doc.classifiers.size,
        requirements: Array.from(doc.classifiers.values()).filter((c) => c.kind === "Requirement").length,
        stateMachines: doc.stateMachines.size,
        activities: doc.activities.size,
        interactions: doc.interactions.size,
        relationships: doc.relationships.length,
        diagrams: doc.diagrams.map((d) => ({ id: d.id, name: d.name, kind: d.kind })),
        lintCount: diags.length,
      };
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    },
  );

  server.tool(
    "magicdraw_diagram",
    "Render a specific MagicDraw / Cameo diagram (by diagramId or diagramKind) to SVG or structured JSON.",
    {
      filePath: z.string().describe("Path to the .mdzip, .mdxml, or .xmi file"),
      diagramId: z.string().optional().describe("Specific diagram xmi:id to render"),
      diagramKind: z.enum(["BDD", "IBD", "REQ", "PAR", "STM", "ACT", "SEQ", "PKG"]).optional(),
      format: z.enum(["svg", "json"]).default("svg"),
    },
    async ({ filePath, diagramId, diagramKind, format }) => {
      const abs = resolveSafePath(ctx, filePath);
      const doc = parseMagicDraw(new Uint8Array(fs.readFileSync(abs)));
      if (format === "json") {
        const model = buildMagicDrawDiagram(doc, { diagramId, diagramKind });
        return { content: [{ type: "text", text: JSON.stringify(model, null, 2) }] };
      }
      const svg = renderMagicDrawDiagramSvg(doc, { diagramId, diagramKind });
      return { content: [{ type: "text", text: svg }] };
    },
  );

  server.tool(
    "magicdraw_diff",
    "Semantically diff two MagicDraw / Cameo (.mdzip, .mdxml, .xmi) models by stable xmi:id.",
    {
      baseFilePath: z.string().describe("Path to base/older .mdzip or .mdxml file"),
      targetFilePath: z.string().describe("Path to target/newer .mdzip or .mdxml file"),
      format: z.enum(["markdown", "json"]).default("markdown"),
    },
    async ({ baseFilePath, targetFilePath, format }) => {
      const baseBytes = new Uint8Array(fs.readFileSync(resolveSafePath(ctx, baseFilePath)));
      const targetBytes = new Uint8Array(fs.readFileSync(resolveSafePath(ctx, targetFilePath)));
      const diff = diffMagicDrawDocuments(baseBytes, targetBytes);
      const text = format === "json" ? JSON.stringify(diff, null, 2) : formatMagicDrawDiffMarkdown(diff);
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "magicdraw_migrate_sysml2",
    "Migrate a MagicDraw / Cameo SysML 1.x model into a multi-file OMG SysML v2 workspace with a migration report.",
    {
      filePath: z.string().describe("Path to the .mdzip, .mdxml, or .xmi file"),
      outDir: z
        .string()
        .optional()
        .describe("Optional output directory to write .sysml files and migration-report.json"),
    },
    async ({ filePath, outDir }) => {
      const abs = resolveSafePath(ctx, filePath);
      const doc = parseMagicDraw(new Uint8Array(fs.readFileSync(abs)));
      const workspace = migrateMagicDrawToSysml2Workspace(doc);
      if (outDir) {
        const absOut = resolveSafePath(ctx, outDir);
        fs.mkdirSync(absOut, { recursive: true });
        for (const f of workspace.files) {
          fs.writeFileSync(path.join(absOut, f.fileName), f.content, "utf-8");
        }
        fs.writeFileSync(
          path.join(absOut, "migration-report.json"),
          JSON.stringify(workspace.report, null, 2),
          "utf-8",
        );
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                report: workspace.report,
                files: workspace.files.map((f) => ({
                  fileName: f.fileName,
                  packageName: f.packageName,
                  lines: f.content.split("\n").length,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

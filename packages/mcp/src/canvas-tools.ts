// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * MCP AI Copilot tools for creating, inspecting, mutating, wiring, and analyzing
 * Polyglot Infinite Spatial Canvas (`.mscanvas`) boards across all 106 ModelScript languages.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  computeCanvasBlastRadius,
  createCanonicalPolyglotDemoBoard,
  createEmptyCanvasDocument,
  deserializeCanvasDocument,
  exportCanvasToSspXml,
  serializeCanvasDocument,
  TileAdapterRegistry,
  validateFmiWire,
  type CanvasWire,
} from "@modelscript/canvas";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ServerContext } from "./types.js";

function resolveSafePath(_ctx: ServerContext, inputPath: string): string {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);
}

const sharedRegistry = new TileAdapterRegistry();

export function registerCanvasTools(server: McpServer, ctx: ServerContext): void {
  server.tool(
    "canvas_create_board",
    "Create a new `.mscanvas` Polyglot Infinite Spatial Canvas board (empty or canonical 6-artifact Modelica+Simulink+KiCad+STEP+ReqIF+MonteCarlo demo).",
    {
      filePath: z.string().describe("Target path for the .mscanvas file"),
      name: z.string().default("System Architecture Board").describe("Human-readable board title"),
      template: z.enum(["empty", "demo"]).default("demo").describe("Board template"),
    },
    async ({ filePath, name, template }) => {
      const abs = resolveSafePath(ctx, filePath);
      const id = path.basename(abs, path.extname(abs)) || `board_${Date.now()}`;
      const doc =
        template === "demo" ? { ...createCanonicalPolyglotDemoBoard(), id, name } : createEmptyCanvasDocument(id, name);

      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, serializeCanvasDocument(doc), "utf8");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                created: abs,
                id: doc.id,
                name: doc.name,
                tileCount: Object.keys(doc.tiles).length,
                wireCount: Object.keys(doc.wires).length,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "canvas_drop_artifact",
    "Drop an engineering artifact from any of the 106 ModelScript languages onto a `.mscanvas` board with automatic archetype & extension routing.",
    {
      boardPath: z.string().describe("Path to the .mscanvas board file"),
      artifactUri: z
        .string()
        .describe("Workspace-relative URI of the artifact (e.g. models/Plant.mo, cad/housing.step)"),
      languageId: z.string().optional().describe("Optional explicit ModelScript language ID"),
      title: z.string().optional().describe("Optional tile display title"),
      x: z.number().default(120).describe("World X coordinate"),
      y: z.number().default(120).describe("World Y coordinate"),
      targetSymbol: z.string().optional().describe("Optional specific class/symbol inside the artifact"),
    },
    async ({ boardPath, artifactUri, languageId, title, x, y, targetSymbol }) => {
      const abs = resolveSafePath(ctx, boardPath);
      const doc = deserializeCanvasDocument(fs.readFileSync(abs, "utf8"));
      const tileId = `tile_${Date.now()}_${Object.keys(doc.tiles).length}`;
      const tile = sharedRegistry.createTileForDrop({
        id: tileId,
        artifactUri,
        languageId,
        title,
        x,
        y,
        zIndex: Object.keys(doc.tiles).length + 1,
        targetSymbol,
      });
      doc.tiles[tile.id] = tile;
      doc.metadata.updatedAt = new Date().toISOString();
      fs.writeFileSync(abs, serializeCanvasDocument(doc), "utf8");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ tile }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "canvas_wire_fmi",
    "Wire two artifact anchors on a `.mscanvas` board with live FMI causality, type, and physical unit validation.",
    {
      boardPath: z.string().describe("Path to the .mscanvas board file"),
      sourceTileId: z.string().describe("Source tile ID"),
      sourceAnchorPath: z.string().describe("Source anchor/port path"),
      targetTileId: z.string().describe("Target tile ID"),
      targetAnchorPath: z.string().describe("Target anchor/port path"),
      kind: z.enum(["fmi-signal", "shared-parameter", "requirement-trace"]).default("fmi-signal"),
    },
    async ({ boardPath, sourceTileId, sourceAnchorPath, targetTileId, targetAnchorPath, kind }) => {
      const abs = resolveSafePath(ctx, boardPath);
      const doc = deserializeCanvasDocument(fs.readFileSync(abs, "utf8"));
      const srcTile = doc.tiles[sourceTileId];
      const dstTile = doc.tiles[targetTileId];
      if (!srcTile || !dstTile) {
        return {
          isError: true,
          content: [
            { type: "text", text: `Source tile '${sourceTileId}' or target tile '${targetTileId}' not found.` },
          ],
        };
      }

      const srcAnchor = srcTile.pinnedAnchors?.find((a) => a.path === sourceAnchorPath) ?? {
        path: sourceAnchorPath,
        label: sourceAnchorPath,
        kind: kind === "fmi-signal" ? ("fmi-output" as const) : ("parameter" as const),
      };
      const dstAnchor = dstTile.pinnedAnchors?.find((a) => a.path === targetAnchorPath) ?? {
        path: targetAnchorPath,
        label: targetAnchorPath,
        kind: kind === "fmi-signal" ? ("fmi-input" as const) : ("parameter" as const),
      };

      const validation = kind === "fmi-signal" ? validateFmiWire(srcAnchor, dstAnchor) : null;
      if (validation && !validation.valid) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ valid: false, errors: validation.errors }, null, 2) }],
        };
      }

      const wire: CanvasWire = {
        id: `wire_${sourceTileId}_${targetTileId}_${Date.now()}`,
        kind,
        source: { tileId: sourceTileId, anchorPath: sourceAnchorPath },
        target: { tileId: targetTileId, anchorPath: targetAnchorPath },
        origin: "user-authored",
        status: validation ? validation.status : "synced",
        transformExpr: validation?.suggestedTransformExpr,
      };
      doc.wires[wire.id] = wire;
      doc.metadata.updatedAt = new Date().toISOString();
      fs.writeFileSync(abs, serializeCanvasDocument(doc), "utf8");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ wire, validation }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "canvas_blast_radius",
    "Compute the causal Blast Radius across all linked polyglot tiles and wires starting from a root tile or anchor on a `.mscanvas` board.",
    {
      boardPath: z.string().describe("Path to the .mscanvas board file"),
      rootTileId: z.string().describe("Root tile ID where the change originates"),
      rootAnchorPath: z.string().optional().describe("Optional specific parameter/port anchor path"),
    },
    async ({ boardPath, rootTileId, rootAnchorPath }) => {
      const abs = resolveSafePath(ctx, boardPath);
      const doc = deserializeCanvasDocument(fs.readFileSync(abs, "utf8"));
      const radius = computeCanvasBlastRadius(doc, rootTileId, rootAnchorPath);
      return {
        content: [{ type: "text", text: JSON.stringify(radius, null, 2) }],
      };
    },
  );

  server.tool(
    "canvas_export_ssp",
    "Export all FMI co-simulation wires and participating tiles on a `.mscanvas` board to an SSP 1.0 SystemStructureDescription XML document.",
    {
      boardPath: z.string().describe("Path to the .mscanvas board file"),
      outPath: z.string().optional().describe("Optional output path to write the .ssd XML file"),
    },
    async ({ boardPath, outPath }) => {
      const abs = resolveSafePath(ctx, boardPath);
      const doc = deserializeCanvasDocument(fs.readFileSync(abs, "utf8"));
      const xml = exportCanvasToSspXml(doc);
      if (outPath) {
        const outAbs = resolveSafePath(ctx, outPath);
        fs.mkdirSync(path.dirname(outAbs), { recursive: true });
        fs.writeFileSync(outAbs, xml, "utf8");
      }
      return {
        content: [{ type: "text", text: xml }],
      };
    },
  );
}

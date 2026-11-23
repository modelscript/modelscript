// SPDX-License-Identifier: AGPL-3.0-or-later

import { exportCanvasToSvg } from "@modelscript/canvas";
import { Router } from "express";
import { optionalAuth } from "../middleware/auth-middleware.js";
import { defaultCanvasRoomManager, type CanvasRoomManager } from "../services/canvas-collab-service.js";

/**
 * REST API for Polyglot Infinite Spatial Canvas boards (`/api/v1/canvas`).
 * Pairs with the live CRDT WebSocket gateway at `/api/v1/canvas/stream`.
 */
export function canvasRouter(manager: CanvasRoomManager = defaultCanvasRoomManager): Router {
  const router = Router();
  router.use(optionalAuth);

  /** List active spatial canvas boards */
  router.get("/", (_req, res) => {
    res.json({ boards: manager.listBoards() });
  });

  /** Create a new spatial canvas board (empty or canonical 6-artifact demo) */
  router.post("/", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawId = typeof body["id"] === "string" && body["id"].trim() ? body["id"].trim() : `board_${Date.now()}`;
    const rawName =
      typeof body["name"] === "string" && body["name"].trim() ? body["name"].trim() : "Untitled System Board";
    const template = body["template"] === "demo" ? "demo" : "empty";

    const doc = manager.createBoard({ id: rawId, name: rawName, template });
    res.status(201).json({ board: doc });
  });

  /** Fetch a single `.mscanvas` board document */
  router.get("/:boardId", (req, res) => {
    const boardId = req.params["boardId"];
    if (!boardId) {
      res.status(400).json({ error: "Missing boardId" });
      return;
    }
    const doc = manager.getBoard(boardId);
    if (!doc) {
      res.status(404).json({ error: `Canvas board '${boardId}' not found.` });
      return;
    }
    res.json({ board: doc });
  });

  /** Validate and persist/broadcast a full `.mscanvas` document update */
  router.put("/:boardId", (req, res) => {
    const boardId = req.params["boardId"];
    if (!boardId) {
      res.status(400).json({ error: "Missing boardId" });
      return;
    }
    const result = manager.replaceBoard(boardId, req.body);
    if (!result.ok) {
      res.status(400).json({ error: "Invalid .mscanvas document", details: result.errors });
      return;
    }
    res.json({ board: result.doc });
  });

  /** Export the board's FMI co-simulation wires as an SSP 1.0 XML SystemStructureDescription */
  router.get("/:boardId/ssp", (req, res) => {
    const boardId = req.params["boardId"];
    if (!boardId) {
      res.status(400).json({ error: "Missing boardId" });
      return;
    }
    const xml = manager.exportBoardSsp(boardId);
    if (!xml) {
      res.status(404).json({ error: `Canvas board '${boardId}' not found.` });
      return;
    }
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.send(xml);
  });

  /** Export the full spatial board as a standalone high-DPI vector SVG */
  router.get("/:boardId/svg", (req, res) => {
    const boardId = req.params["boardId"];
    if (!boardId) {
      res.status(400).json({ error: "Missing boardId" });
      return;
    }
    const doc = manager.getBoard(boardId);
    if (!doc) {
      res.status(404).json({ error: `Canvas board '${boardId}' not found.` });
      return;
    }
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.send(exportCanvasToSvg(doc));
  });

  return router;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";

export function searchRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * GET /api/v1/search/completions
   */
  router.get("/completions", (req: Request, res: Response) => {
    const q = req.query["q"] as string;
    const rawLimit = Number(req.query["limit"]);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 50) : 3;

    if (!q || typeof q !== "string") {
      res.json({ topics: [], users: [], packages: [], repositories: [] });
      return;
    }

    try {
      const results = database.globalSearch(q.slice(0, 200), limit);
      res.json(results);
    } catch {
      res.status(500).json({ error: "Search failed" });
    }
  });

  return router;
}

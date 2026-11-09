// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Supply Chain & Sourcing REST API Routes.
 *
 * Exposes endpoints for real-time distributor queries, BOM scrubbing,
 * risk analysis, and alternate component qualification.
 */

import { Router, type Request, type Response } from "express";
import { SupplyChainOrchestrator } from "../services/supply-chain/orchestrator.js";
import type { BOMComponentInput } from "../services/supply-chain/types.js";

export function supplyChainRouter(orchestrator?: SupplyChainOrchestrator): Router {
  const router = Router();
  const scm = orchestrator ?? new SupplyChainOrchestrator();

  /**
   * POST /api/v1/supply-chain/scrub-bom
   * Scrubs a bill of materials across multi-tier distributors.
   */
  router.post("/scrub-bom", async (req: Request, res: Response) => {
    try {
      const { components, targetQuantity } = req.body as {
        components?: BOMComponentInput[];
        targetQuantity?: number;
      };

      if (!components || !Array.isArray(components) || components.length === 0) {
        res.status(400).json({ error: "Missing or invalid 'components' array." });
        return;
      }

      const qty = typeof targetQuantity === "number" && targetQuantity > 0 ? targetQuantity : 1000;
      const result = await scm.scrubBOM(components, qty);
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `BOM scrub failed: ${msg}` });
    }
  });

  /**
   * GET /api/v1/supply-chain/part/:mpn
   * Queries real-time quotes and availability for a single MPN.
   */
  router.get("/part/:mpn", async (req: Request, res: Response) => {
    try {
      const rawMpn = req.params["mpn"];
      const mpn = Array.isArray(rawMpn) ? rawMpn[0] : rawMpn;
      if (!mpn || mpn.trim() === "") {
        res.status(400).json({ error: "Missing part number parameter." });
        return;
      }

      const quotes = await scm.getQuotesForPart(mpn);
      res.json({
        mpn,
        totalQuotes: quotes.length,
        quotes,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Part lookup failed: ${msg}` });
    }
  });

  return router;
}

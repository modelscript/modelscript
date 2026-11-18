// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";
import { defaultApiLimiter } from "../middleware/rate-limiter.js";
import { MorselAiService, type MorselChatRequest } from "../services/ai/morsel-ai.js";
import { checkComputeQuota } from "../services/hpc/quota-guard.js";

export function aiRouter(database: LibraryDatabase): Router {
  const router = createRouter();
  const morselAi = new MorselAiService();

  router.get("/ai/providers", defaultApiLimiter, async (_req: Request, res: Response) => {
    try {
      const info = await morselAi.getProvidersInfo();
      res.json(info);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to inspect AI providers" });
    }
  });

  router.post("/ai/morsel/chat", defaultApiLimiter, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Partial<MorselChatRequest>;
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      res.status(400).json({ error: "messages array is required" });
      return;
    }

    const userId = (req as Request & { user?: { id?: number } }).user?.id;
    if (body.providerMode !== "custom" && userId) {
      const quota = checkComputeQuota(userId, undefined, database, 0.01);
      if (!quota.allowed) {
        res.status(429).json({ error: quota.reason || "Compute quota exceeded" });
        return;
      }
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", process.env["NODE_ENV"] === "test" ? "close" : "keep-alive");
    res.flushHeaders?.();

    try {
      for await (const chunk of morselAi.streamChat(
        {
          messages: body.messages,
          tools: body.tools,
          context: body.context,
          providerMode: body.providerMode ?? "ansatz",
          customProvider: body.customProvider,
          model: body.model,
          temperature: body.temperature,
          maxTokens: body.maxTokens,
        },
        userId,
      )) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Morsel AI stream failed";
      res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
    } finally {
      res.end();
    }
  });

  return router;
}

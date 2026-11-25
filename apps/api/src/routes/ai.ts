// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";
import { AnsatzAiService, type AnsatzChatRequest } from "../services/ai/ansatz-ai.js";
import { checkComputeQuota } from "../services/hpc/quota-guard.js";

export function aiRouter(database: LibraryDatabase): Router {
  const router = createRouter();
  const ansatzAi = new AnsatzAiService();

  router.get("/ai/providers", async (_req: Request, res: Response) => {
    try {
      const info = await ansatzAi.getProvidersInfo();
      res.json(info);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to inspect AI providers" });
    }
  });

  router.post("/ai/ansatz/chat", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Partial<AnsatzChatRequest>;
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
      for await (const chunk of ansatzAi.streamChat(
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
      const message = err instanceof Error ? err.message : "Ansatz AI stream failed";
      res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
    } finally {
      res.end();
    }
  });

  return router;
}

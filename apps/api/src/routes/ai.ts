// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MemoryChunkResult } from "@modelscript/runtime";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import crypto from "node:crypto";
import path from "node:path";
import type { LibraryDatabase } from "../database.js";
import { requireAuth } from "../middleware/auth-middleware.js";
import { aiChatRateLimiter } from "../middleware/rate-limiter.js";
import { AnsatzAiService, type AnsatzChatRequest, type AnsatzComputeDial } from "../services/ai/ansatz-ai.js";
import {
  escalateTraceToRlhfArena,
  processChatFeedbackAndHarvest,
  recordChatInteractionTrace,
} from "../services/chat-harvest-pipeline.js";
import { getOrCreateDiskAnnService } from "../services/diskann-memory.js";
import { checkComputeQuota } from "../services/hpc/quota-guard.js";
import {
  distributeCreditRoyalties,
  executeRevocationCascade,
  getCreatorEarningsSummary,
  issueRetrievalReceipts,
} from "../services/provenance-attribution.js";

function normalizeComputeDial(raw: unknown): AnsatzComputeDial {
  if (raw === "fast-m0" || raw === "auto-escalate" || raw === "certified-m32") {
    return raw;
  }
  return "auto-escalate";
}

function computeDialCreditCost(computeDial: AnsatzComputeDial): number {
  if (computeDial === "certified-m32") return 0.05;
  if (computeDial === "auto-escalate") return 0.02;
  return 0.01;
}

function sanitizePackagePins(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && k.trim() && v.trim()) {
      out[k.trim()] = v.trim();
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function resolveCallerOrgId(req: Request, database: LibraryDatabase, userId?: number): number | null {
  const rawHeader = req.headers["x-modelscript-org-id"];
  if (typeof rawHeader !== "string" || !/^\d+$/.test(rawHeader)) {
    return null;
  }
  const requestedOrgId = Number(rawHeader);
  if (!Number.isSafeInteger(requestedOrgId) || requestedOrgId <= 0) {
    return null;
  }
  if (!userId && process.env["NODE_ENV"] === "production") {
    return null;
  }
  if (userId) {
    const orgRecord = database.getOrganizationById(requestedOrgId);
    if (orgRecord) {
      const memberRole = database.getOrgMemberRole(requestedOrgId, userId);
      if (!memberRole) return null;
    }
  }
  return requestedOrgId;
}

function formatDiskAnnMemoryBlock(computeDial: AnsatzComputeDial, chunks: MemoryChunkResult[]): string {
  const lines: string[] = [
    `[Verified DiskANN Engineering Memory] (computeDial=${computeDial}, chunks=${chunks.length})`,
  ];
  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i]!;
    const pkgLabel = ch.packageName
      ? `${ch.packageName}${ch.packageVersion ? `@${ch.packageVersion}` : ""}`
      : ch.sourceKind;
    const verifiedTag = ch.formalVerified ? " [formal-verified]" : "";
    const snippet = ch.content.replace(/\s+/g, " ").trim().slice(0, 600);
    lines.push(
      `${i + 1}. (${pkgLabel} · ${ch.dialect} · score=${ch.score}${verifiedTag}) ${ch.sourceUri}\n   ${snippet}`,
    );
  }
  return lines.join("\n");
}

export function aiRouter(database: LibraryDatabase, storageDir?: string): Router {
  const router = createRouter();
  const ansatzAi = new AnsatzAiService();
  const resolvedDiskAnnDir = storageDir ? path.join(storageDir, "ml-memory") : undefined;

  router.get("/ai/providers", async (_req: Request, res: Response) => {
    try {
      const info = await ansatzAi.getProvidersInfo();
      res.json(info);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to inspect AI providers" });
    }
  });

  const handleChat = async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Partial<AnsatzChatRequest> & {
      sessionId?: string | undefined;
      allowTrainingOptIn?: boolean | undefined;
    };
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      res.status(400).json({ error: "messages array is required" });
      return;
    }

    const userId = (req as Request & { user?: { id?: number } }).user?.id;
    const computeDial = normalizeComputeDial(body.computeDial);
    const creditCost = computeDialCreditCost(computeDial);
    const isCustomMode = body.providerMode === "custom";
    if (!isCustomMode) {
      if (!userId && process.env["NODE_ENV"] !== "test") {
        res.status(401).json({
          error: "Authentication required to use Ansatz hosted AI. Sign in or configure a custom/local provider.",
        });
        return;
      }
      if (userId) {
        const quota = checkComputeQuota(userId, undefined, database, creditCost);
        if (!quota.allowed) {
          res.status(429).json({ error: quota.reason || "Compute quota exceeded" });
          return;
        }
      }
    }

    const packagePins = sanitizePackagePins(body.packagePins);
    const callerOrgId = resolveCallerOrgId(req, database, userId);
    const activeDialect = body.context?.dialect?.trim().toLowerCase() || "modelica";
    const traceId = `tr_${crypto.randomBytes(12).toString("hex")}`;
    const latestUserMessage =
      [...body.messages]
        .reverse()
        .find((m) => m.role === "user" && typeof m.content === "string" && m.content.trim().length > 0)
        ?.content.trim() ?? "";

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", process.env["NODE_ENV"] === "test" ? "close" : "keep-alive");
    res.flushHeaders?.();

    // Test-Time Compute Dial -> DiskANN Engineering Memory Injection
    let memoryContext: string | undefined;
    let retrievedChunks: MemoryChunkResult[] = [];
    const deltaTBefore = computeDial === "fast-m0" ? 0.0 : computeDial === "certified-m32" ? 0.85 : 0.55;
    let deltaTAfter = deltaTBefore;
    const diskann = getOrCreateDiskAnnService(database, resolvedDiskAnnDir);

    if (computeDial === "auto-escalate" || computeDial === "certified-m32") {
      if (latestUserMessage) {
        try {
          const dialects = activeDialect ? Array.from(new Set([activeDialect, "markdown", "owl2", "text"])) : undefined;
          const retrieval = await diskann.queryAsync(
            {
              mode: "hybrid",
              textQuery: latestUserMessage,
              dialects,
              packagePins,
              topK: computeDial === "certified-m32" ? 6 : 4,
            },
            {
              userId,
              orgId: callerOrgId,
            },
          );

          retrievedChunks = retrieval.chunks.filter((ch) => ch.score > 0);
          if (retrievedChunks.length > 0) {
            const topScore = Math.min(1, Math.max(0, retrievedChunks[0]!.score));
            const verifiedBonus = retrievedChunks.some((c) => c.formalVerified) ? 0.15 : 0;
            deltaTAfter = Number(Math.max(0.05, deltaTBefore * (1 - 0.55 * topScore - verifiedBonus)).toFixed(4));
            memoryContext = formatDiskAnnMemoryBlock(computeDial, retrievedChunks);
            res.write(
              `data: ${JSON.stringify({
                type: "memory_retrieval",
                computeDial,
                backend: "diskann",
                latencyMs: retrieval.latencyMs,
                chunkCount: retrievedChunks.length,
                deltaTBefore,
                deltaTAfter,
                sources: retrievedChunks.map((ch) => ({
                  chunkId: ch.chunkId,
                  sourceKind: ch.sourceKind,
                  sourceUri: ch.sourceUri,
                  ...(ch.packageName ? { packageName: ch.packageName } : {}),
                  ...(ch.packageVersion ? { packageVersion: ch.packageVersion } : {}),
                  dialect: ch.dialect,
                  score: ch.score,
                  formalVerified: ch.formalVerified,
                })),
              })}\n\n`,
            );
          }
        } catch {
          // DiskANN lookup failure must never break live AI chat
        }
      }
    }

    let streamedResponse = "";
    let streamSucceeded = false;
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
          computeDial,
          packagePins,
          memoryContext,
        },
        userId,
      )) {
        if (chunk.type === "text" && typeof chunk.delta === "string") {
          streamedResponse += chunk.delta;
        }
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      streamSucceeded = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ansatz AI stream failed";
      res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
    } finally {
      // Persist interaction trace, issue signed retrieval receipts, meter credits & distribute creator royalties
      try {
        let creditsCharged = 0;
        if (streamSucceeded && !isCustomMode && userId && typeof database.deductUserCredits === "function") {
          try {
            database.deductUserCredits(
              userId,
              creditCost,
              null,
              `Ansatz AI chat (${computeDial}, dialect=${activeDialect})`,
              { traceId, computeDial, dialect: activeDialect },
            );
            creditsCharged = creditCost;
          } catch {
            // Never fail SSE close on transient wallet errors
          }
        }

        if (database.isOpen()) {
          recordChatInteractionTrace(database, {
            traceId,
            sessionId: body.sessionId ?? "",
            userId: userId ?? null,
            orgId: callerOrgId,
            tenantScope: callerOrgId ? "org" : "public",
            dialect: activeDialect,
            computeDial,
            modelRef: body.model ?? body.providerMode ?? "ansatz",
            prompt: latestUserMessage,
            responseText: streamedResponse,
            deltaTBefore,
            deltaTAfter,
            allowTrainingOptIn: body.allowTrainingOptIn === true,
            creditsCharged,
          });

          if (retrievedChunks.length > 0) {
            issueRetrievalReceipts(database, {
              traceId,
              chunks: retrievedChunks,
              deltaTBefore,
              deltaTAfter,
              diskann,
            });
          }

          if (creditsCharged > 0 && retrievedChunks.length > 0) {
            distributeCreditRoyalties(database, {
              spendCredits: creditsCharged,
              payerUserId: userId ?? null,
              traceId,
            });
          }
        }

        res.write(
          `data: ${JSON.stringify({
            type: "trace_created",
            traceId,
            deltaTBefore,
            deltaTAfter,
            creditsCharged,
          })}\n\n`,
        );
      } catch {
        // Non-fatal telemetry close
      }
      res.end();
    }
  };

  router.post("/ai/ansatz/chat", aiChatRateLimiter, handleChat);
  router.post("/ai/chat", aiChatRateLimiter, handleChat);

  /**
   * POST /api/v1/ai/traces/:traceId/feedback
   * Records explicit thumbs up/down, failure tags, and edit outcome (`accepted | reverted | manual_fixed`),
   * automatically harvesting Gate 1–4 verified fixes into DiskANN when opted-in.
   */
  router.post("/ai/traces/:traceId/feedback", requireAuth, (req: Request, res: Response) => {
    try {
      const traceId = String(req.params["traceId"] ?? "").trim();
      if (!traceId) return res.status(400).json({ error: "traceId is required." });
      const body = (req.body ?? {}) as {
        userRating?: "up" | "down" | null | undefined;
        failureTags?: string[] | undefined;
        editOutcome?: "none" | "accepted" | "reverted" | "manual_fixed" | undefined;
        userFixedCode?: string | undefined;
        allowTrainingOptIn?: boolean | undefined;
      };
      const diskann = getOrCreateDiskAnnService(database, resolvedDiskAnnDir);
      const result = processChatFeedbackAndHarvest(database, traceId, req.user?.id ?? null, body, diskann);
      if (!result.updated) {
        return res.status(404).json({ error: "AI interaction trace not found." });
      }
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to record trace feedback" });
    }
  });

  /**
   * POST /api/v1/ai/traces/:traceId/escalate-arena
   * Escalates a failing or high-Δ_t AI chat turn directly into an RLHF Arena challenge.
   */
  router.post("/ai/traces/:traceId/escalate-arena", requireAuth, (req: Request, res: Response) => {
    try {
      const traceId = String(req.params["traceId"] ?? "").trim();
      if (!traceId) return res.status(400).json({ error: "traceId is required." });
      const body = (req.body ?? {}) as {
        title?: string | undefined;
        challengeType?: "fix_it_bounty" | "pairwise_arena" | "tolerance_labeling" | undefined;
        campaignId?: number | null | undefined;
      };
      const escalated = escalateTraceToRlhfArena(database, traceId, req.user?.id ?? null, body);
      if (!escalated) {
        return res.status(404).json({ error: "AI interaction trace not found." });
      }
      return res.status(201).json({
        success: true,
        ...escalated,
        annotateUrl: `/annotate/${escalated.challengeId}`,
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to escalate trace to arena" });
    }
  });

  /**
   * GET /api/v1/ai/attribution/earnings
   * Returns creator attribution earnings, signed retrieval receipts, and RLHF bounty payouts.
   */
  router.get("/ai/attribution/earnings", requireAuth, (req: Request, res: Response) => {
    try {
      const summary = getCreatorEarningsSummary(database, req.user!.id);
      return res.json(summary);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load creator earnings" });
    }
  });

  /**
   * POST /api/v1/ai/provenance/:cid/revoke
   * Executes a cryptographic revocation cascade for a provenance node authored by the caller (or admin).
   */
  router.post("/ai/provenance/:cid/revoke", requireAuth, (req: Request, res: Response) => {
    try {
      const cid = String(req.params["cid"] ?? "").trim();
      if (!cid) return res.status(400).json({ error: "cid is required." });
      const node = database.db.prepare(`SELECT cid, author_user_id FROM provenance_nodes WHERE cid = ?`).get(cid) as
        { cid: string; author_user_id: number | null } | undefined;
      if (!node) {
        return res.status(404).json({ error: "Provenance node not found." });
      }
      const isCallerAdmin =
        req.user?.role === "admin" || req.user?.accountType === "admin" || req.user?.account_type === "admin";
      if (!isCallerAdmin && node.author_user_id !== req.user?.id) {
        return res.status(403).json({ error: "Only the artifact author or an administrator may revoke this CID." });
      }
      const reason =
        typeof (req.body as { reason?: unknown })?.reason === "string"
          ? String((req.body as { reason?: string }).reason)
              .trim()
              .slice(0, 500)
          : "Creator governance revocation";
      const diskann = getOrCreateDiskAnnService(database, resolvedDiskAnnDir);
      const cascade = executeRevocationCascade(database, cid, reason, req.user?.id ?? null, diskann);
      return res.json({ success: true, cid, ...cascade });
    } catch (err) {
      return res
        .status(500)
        .json({ error: err instanceof Error ? err.message : "Failed to execute revocation cascade" });
    }
  });

  return router;
}

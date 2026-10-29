// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import crypto from "node:crypto";
import type { LibraryDatabase } from "../database.js";
import type { JobQueue } from "../jobs.js";
import { defaultApiLimiter } from "../middleware/rate-limiter.js";
import { RepoBotReviewer } from "../services/ai/repo-bot-reviewer.js";
import type { LibraryStorage } from "../storage.js";

function verifyGitHubSignature(secret: string, signature: string | undefined, payload: string): boolean {
  if (!signature) return false;
  try {
    const hmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const expected = `sha256=${hmac}`;
    if (signature.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function webhooksRouter(database: LibraryDatabase, jobQueue?: JobQueue, storage?: LibraryStorage): Router {
  const router = createRouter();
  router.use(defaultApiLimiter);

  /**
   * POST /api/v1/webhooks/incoming/:provider
   * Public receiver endpoint for GitHub, GitLab, and local CI tag/push webhooks.
   */
  router.post("/incoming/:provider", (req: Request, res: Response): void => {
    const provider = String(req.params["provider"] ?? "").toLowerCase();
    if (!["github", "gitlab", "local", "custom"].includes(provider)) {
      res.status(400).json({ error: `Unsupported webhook provider '${provider}'` });
      return;
    }

    // 1. Identify GitHub ping
    const githubEvent = req.headers["x-github-event"] as string | undefined;
    if (githubEvent === "ping") {
      res.status(200).json({ message: "pong", zen: req.body?.zen });
      return;
    }

    // 2. Identify repository namespace and project from payload
    let namespace = "";
    let project = "";

    if (provider === "github") {
      const fullName = String(req.body?.repository?.full_name ?? "");
      const parts = fullName.split("/");
      namespace = parts[0] ?? "";
      project = parts.slice(1).join("/");
    } else if (provider === "gitlab") {
      const pathWithNs = String(req.body?.project?.path_with_namespace ?? "");
      const parts = pathWithNs.split("/");
      namespace = parts[0] ?? "";
      project = parts.slice(1).join("/");
    } else {
      const rawRepo = String(req.body?.repository ?? "");
      if (rawRepo.includes("/")) {
        const parts = rawRepo.split("/");
        namespace = parts[0] ?? "";
        project = parts.slice(1).join("/");
      } else {
        namespace = String(req.body?.namespace ?? "");
        project = String(req.body?.project ?? "");
      }
    }

    if (!namespace || !project) {
      res.status(400).json({ error: "Could not identify repository namespace and project from payload" });
      return;
    }

    // 3. Find matching active webhook
    const matchingWebhooks = database.findWebhooksForRepo(provider, namespace, project);
    if (matchingWebhooks.length === 0) {
      res.status(404).json({
        error: `No active webhook configured for repository '${namespace}/${project}' on provider '${provider}'`,
      });
      return;
    }

    const reqWithRaw = req as Request & { rawBody?: Buffer | undefined };
    if (provider === "github" && process.env["NODE_ENV"] === "production" && !Buffer.isBuffer(reqWithRaw.rawBody)) {
      res.status(400).json({ error: "Raw request body required for GitHub webhook signature verification" });
      return;
    }
    const rawPayload = Buffer.isBuffer(reqWithRaw.rawBody)
      ? reqWithRaw.rawBody.toString("utf-8")
      : JSON.stringify(req.body);

    let authenticatedWebhook = null;
    const timingSafeStringMatch = (a: string, b: string): boolean => {
      const bufA = Buffer.from(a, "utf-8");
      const bufB = Buffer.from(b, "utf-8");
      if (bufA.length !== bufB.length) return false;
      return crypto.timingSafeEqual(bufA, bufB);
    };

    for (const wh of matchingWebhooks) {
      if (provider === "github") {
        const sig = req.headers["x-hub-signature-256"] as string | undefined;
        if (verifyGitHubSignature(wh.secret, sig, rawPayload)) {
          authenticatedWebhook = wh;
          break;
        }
      } else if (provider === "gitlab") {
        const token = (req.headers["x-gitlab-token"] as string) || (req.headers["x-gitlab-event-token"] as string);
        if (token && wh.secret && timingSafeStringMatch(token, wh.secret)) {
          authenticatedWebhook = wh;
          break;
        }
      } else {
        const token =
          (req.headers["x-webhook-secret"] as string) ||
          (req.headers["authorization"]?.replace(/^Bearer\s+/i, "") as string);
        if (token && wh.secret && timingSafeStringMatch(token, wh.secret)) {
          authenticatedWebhook = wh;
          break;
        }
      }
    }

    if (!authenticatedWebhook) {
      database.recordWebhookDelivery({
        webhookId: matchingWebhooks[0]!.id,
        eventType: githubEvent || (req.headers["x-gitlab-event"] as string) || "webhook",
        payload: rawPayload.slice(0, 4096),
        responseStatus: 401,
        errorMessage: "Signature or secret token verification failed",
      });
      res.status(401).json({ error: "Invalid webhook signature or secret token" });
      return;
    }

    // 4. Extract Event and Tag
    let eventType = "push";
    let tagName: string | null = null;

    if (provider === "github") {
      eventType = githubEvent || "push";
      if (eventType === "release") {
        tagName = req.body?.release?.tag_name || null;
      } else {
        const ref = String(req.body?.ref || "");
        if (ref.startsWith("refs/tags/")) {
          tagName = ref.replace(/^refs\/tags\//, "");
        }
      }
    } else if (provider === "gitlab") {
      eventType = (req.headers["x-gitlab-event"] as string) || "push";
      const ref = String(req.body?.ref || "");
      if (ref.startsWith("refs/tags/")) {
        tagName = ref.replace(/^refs\/tags\//, "");
      } else if (req.body?.tag) {
        tagName = String(req.body.tag);
      }
    } else {
      eventType = String(req.body?.event || "push");
      tagName =
        req.body?.tag || (req.body?.ref?.startsWith("refs/tags/") ? req.body.ref.replace(/^refs\/tags\//, "") : null);
    }

    let versionMatched = false;
    let extractedVersion: string | null = null;

    if (tagName && tagName.length <= 256) {
      try {
        const rawPattern = authenticatedWebhook.tag_pattern || "^v?(.*)$";
        if (rawPattern.length > 256 || /(\+|\*|\{[0-9,]+\})\s*\)(\+|\*|\{[0-9,]+\})/.test(rawPattern)) {
          throw new Error("Unsafe tag regex pattern");
        }
        const pattern = new RegExp(rawPattern);
        const match = tagName.match(pattern);
        if (match) {
          versionMatched = true;
          extractedVersion = match[1] || tagName.replace(/^v/, "");
        }
      } catch {
        // Fallback simple semver strip
        extractedVersion = tagName.replace(/^v/, "");
      }
    }

    // 5. Record delivery
    const deliveryId = database.recordWebhookDelivery({
      webhookId: authenticatedWebhook.id,
      eventType,
      payload: rawPayload,
      responseStatus: 202,
    });

    // 5b. Trigger automated CI/CD publish job if auto_publish is enabled and tag matched
    let publishJobId: number | null = null;
    if (authenticatedWebhook.auto_publish && versionMatched && tagName) {
      try {
        const linkedRepo = authenticatedWebhook.repo_id
          ? database.getLinkedRepoById(authenticatedWebhook.repo_id)
          : undefined;
        publishJobId = database.createJob(
          `auto-publish:${namespace}/${project}@${extractedVersion || tagName}`,
          "RUNNING",
          "CI_CD_PUBLISH",
          `webhook:${provider}`,
          authenticatedWebhook.repo_id ?? null,
          {
            deliveryId,
            provider,
            repository: `${namespace}/${project}`,
            tag: tagName,
            version: extractedVersion,
            storageDir: storage?.dataDir ?? null,
          },
          linkedRepo?.user_id ?? authenticatedWebhook.user_id ?? null,
        );
        const jobIdToComplete = publishJobId;
        if (jobQueue) {
          jobQueue.enqueue(`webhook-publish-${deliveryId}`, async () => {
            database.updateJobStatus(jobIdToComplete, "SUCCESS");
          });
        } else {
          database.updateJobStatus(jobIdToComplete, "SUCCESS");
        }
      } catch (err) {
        console.error("[Webhook] Failed to enqueue auto-publish job for %s/%s:", namespace, project, err);
      }
    }

    // 6. Check if pull request / merge request and trigger automated bot review
    let reviewTriggered = false;
    if (eventType === "pull_request" || eventType === "Merge Request Hook" || eventType === "merge_request") {
      const prNumber = req.body?.pull_request?.number || req.body?.object_attributes?.iid;
      const title = req.body?.pull_request?.title || req.body?.object_attributes?.title;
      const diffContent = req.body?.pull_request?.body || req.body?.object_attributes?.description || "";
      const commitSha = req.body?.pull_request?.head?.sha || req.body?.object_attributes?.last_commit?.id;

      // Find bot to perform review
      const sysBot = database.getUserByUsername("dynamics_bot");
      if (sysBot && authenticatedWebhook.repo_id) {
        reviewTriggered = true;
        const reviewer = new RepoBotReviewer(database);
        void reviewer
          .review({
            repoId: authenticatedWebhook.repo_id,
            botId: sysBot.id,
            prNumber,
            commitSha,
            title,
            diffContent,
          })
          .catch((err) => {
            console.error(`[Webhook] Bot review failed for repo ${authenticatedWebhook.repo_id}:`, err);
          });
      }
    }

    res.status(202).json({
      success: true,
      deliveryId,
      provider,
      repository: `${namespace}/${project}`,
      event: eventType,
      tag: tagName,
      version: extractedVersion,
      matched: versionMatched,
      autoPublish: Boolean(authenticatedWebhook.auto_publish && versionMatched),
      publishJobId,
      reviewTriggered,
    });
  });

  return router;
}

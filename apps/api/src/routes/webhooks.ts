// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import crypto from "node:crypto";
import type { LibraryDatabase } from "../database.js";
import type { JobQueue } from "../jobs.js";
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

export function webhooksRouter(database: LibraryDatabase, _jobQueue?: JobQueue, _storage?: LibraryStorage): Router {
  const router = createRouter();

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

    const rawPayload = (req as any).rawBody ? (req as any).rawBody.toString("utf-8") : JSON.stringify(req.body);

    let authenticatedWebhook = null;

    for (const wh of matchingWebhooks) {
      if (provider === "github") {
        const sig = req.headers["x-hub-signature-256"] as string | undefined;
        if (verifyGitHubSignature(wh.secret, sig, rawPayload)) {
          authenticatedWebhook = wh;
          break;
        }
      } else if (provider === "gitlab") {
        const token = (req.headers["x-gitlab-token"] as string) || (req.headers["x-gitlab-event-token"] as string);
        if (token && token === wh.secret) {
          authenticatedWebhook = wh;
          break;
        }
      } else {
        const token =
          (req.headers["x-webhook-secret"] as string) ||
          (req.headers["authorization"]?.replace(/^Bearer\s+/i, "") as string);
        if (token && token === wh.secret) {
          authenticatedWebhook = wh;
          break;
        }
      }
    }

    if (!authenticatedWebhook) {
      database.recordWebhookDelivery({
        webhookId: matchingWebhooks[0]!.id,
        eventType: githubEvent || (req.headers["x-gitlab-event"] as string) || "webhook",
        payload: rawPayload,
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

    if (tagName) {
      try {
        const pattern = new RegExp(authenticatedWebhook.tag_pattern);
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
    });
  });

  return router;
}

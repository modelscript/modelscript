// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import crypto from "node:crypto";
import type { LibraryDatabase } from "../database.js";
import type { JobQueue } from "../jobs.js";
import { defaultApiLimiter } from "../middleware/rate-limiter.js";
import { RepoBotReviewer } from "../services/ai/repo-bot-reviewer.js";
import {
  extractImpactedModels,
  mapJiraPriorityToSeverity,
  mapJiraStatusToState,
  parseAdfToMarkdown,
} from "../services/integrations/jira-connector.js";
import type { LibraryStorage } from "../storage.js";

function verifyGitHubSignature(secret: string, signature: string | undefined, payload: string): boolean {
  if (!signature) return false;
  try {
    const hmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const expected = `sha256=${hmac}`;
    const sigBuf = Buffer.from(signature, "utf-8");
    const expBuf = Buffer.from(expected, "utf-8");
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

export function webhooksRouter(database: LibraryDatabase, jobQueue?: JobQueue, storage?: LibraryStorage): Router {
  const router = createRouter();
  router.use(defaultApiLimiter);

  /**
   * POST /api/v1/webhooks/incoming/jira
   * Real-time webhook receiver for Atlassian Jira issue events.
   * Supports ?space=namespace/slug or ?spaceId=...
   */
  router.post("/incoming/jira", (req: Request, res: Response): void => {
    // 1. Verify webhook secret if configured
    const expectedSecret = process.env["JIRA_WEBHOOK_SECRET"];
    if (expectedSecret) {
      const providedSecret =
        (req.headers["x-webhook-secret"] as string) ||
        (req.headers["authorization"]?.replace(/^Bearer\s+/i, "") as string) ||
        (req.query["secret"] as string);
      if (!providedSecret || providedSecret !== expectedSecret) {
        res.status(401).json({ error: "Invalid webhook secret" });
        return;
      }
    }

    // 2. Identify target Space
    let space = null;
    const spaceQuery = String(req.query["space"] ?? "").trim();
    const spaceIdQuery = String(req.query["spaceId"] ?? req.query["space_id"] ?? "").trim();

    if (spaceQuery.includes("/")) {
      const [ns, sl] = spaceQuery.split("/");
      space = database.getSpaceByNamespaceAndSlug(ns!, sl!);
    } else if (spaceIdQuery) {
      space = database.getSpaceById(spaceIdQuery);
    }

    const body = req.body as Record<string, unknown> | undefined;
    const issueRaw = body?.["issue"] as Record<string, unknown> | undefined;
    const webhookEvent = String(body?.["webhookEvent"] || "jira:issue_updated");

    if (!issueRaw) {
      res.status(400).json({ error: "Missing 'issue' payload in Jira webhook body" });
      return;
    }

    const fields = (issueRaw["fields"] as Record<string, unknown>) || {};
    const key = String(issueRaw["key"] || "");

    // Fallback space discovery by Jira project key matching space slug
    if (!space) {
      const projectObj = fields["project"] as Record<string, unknown> | undefined;
      const projectKey = String(projectObj?.["key"] || "").toLowerCase();
      if (projectKey) {
        const spaces = database.listSpaces({ limit: 100 });
        space = spaces.find((s) => s.slug.toLowerCase() === projectKey) || null;
      }
    }

    if (!space) {
      res.status(404).json({
        error: "Target space could not be resolved from query parameter or Jira project key",
      });
      return;
    }

    const summary = String(fields["summary"] || `Jira Issue ${key}`);
    const rawDesc = fields["description"];
    const description = parseAdfToMarkdown(rawDesc);

    const statusObj = (fields["status"] as Record<string, unknown>) || {};
    const rawStatus = String(statusObj["name"] || "Open");
    const statusCategoryObj = (statusObj["statusCategory"] as Record<string, unknown>) || {};
    const statusCategory = String(statusCategoryObj["key"] || "");
    const status = mapJiraStatusToState(statusCategory, rawStatus);

    const priorityObj = (fields["priority"] as Record<string, unknown>) || {};
    const rawPriority = String(priorityObj["name"] || "Medium");
    const severity = mapJiraPriorityToSeverity(rawPriority);

    const rawLabels = fields["labels"];
    const labels: string[] = Array.isArray(rawLabels) ? rawLabels.map(String) : [];

    const impactedModels = extractImpactedModels(`${summary}\n${description}`);

    const jiraBase =
      String(req.query["jiraBaseUrl"] || "").replace(/\/+$/, "") ||
      (issueRaw["self"] ? String(issueRaw["self"]).replace(/\/rest\/api\/.*$/, "") : "");
    const browseUrl = jiraBase ? `${jiraBase}/browse/${key}` : null;
    const updatedAt = String(fields["updated"] || new Date().toISOString());

    if (webhookEvent === "jira:issue_deleted") {
      const existing = database.getSpaceIssues(space.id).find((i) => i.external_key === key);
      if (existing) {
        database.updateSpaceIssue({
          spaceId: space.id,
          issueId: existing.id,
          status: "closed",
        });
      }
      res.status(200).json({ success: true, event: webhookEvent, key, closed: Boolean(existing) });
      return;
    }

    const result = database.upsertSpaceIssueFromExternal({
      spaceId: space.id,
      externalSource: "jira",
      externalKey: key,
      externalUrl: browseUrl,
      externalUpdatedAt: updatedAt,
      title: summary,
      description,
      status,
      severity,
      impactedModels,
      labels,
      syncStatus: "synced",
    });

    res.status(200).json({
      success: true,
      event: webhookEvent,
      key,
      isNew: result.isNew,
      issue: result.issue,
    });
  });

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

    // 7. Check for CI/CD status updates (GitHub check_run / workflow_run or GitLab Pipeline) for Spaces
    let spaceEcoUpdated = false;
    let spaceEcoId: string | null = null;
    const matchingSpace = database.getSpaceByNamespaceAndSlug(namespace, project);
    if (matchingSpace) {
      let ref: string | null = null;
      let commitSha: string | null = null;
      let ciStatus: "passed" | "failed" | "running" = "passed";
      let wfName = "External CI";
      let summaryData: Record<string, unknown> = {};

      if (provider === "github") {
        if (eventType === "check_run") {
          const cr = (req.body?.check_run || {}) as Record<string, unknown>;
          commitSha = cr["head_sha"] ? String(cr["head_sha"]) : null;
          const cs = (cr["check_suite"] || {}) as Record<string, unknown>;
          ref = cs["head_branch"] ? String(cs["head_branch"]) : null;
          wfName = String(cr["name"] || "GitHub Check Run");
          const conclusion = String(cr["conclusion"] || "");
          const status = String(cr["status"] || "");
          if (status === "in_progress" || status === "queued") {
            ciStatus = "running";
          } else if (conclusion === "success") {
            ciStatus = "passed";
          } else {
            ciStatus = "failed";
          }
          summaryData = { conclusion, status, output: cr["output"] };
        } else if (eventType === "workflow_run") {
          const wr = (req.body?.workflow_run || {}) as Record<string, unknown>;
          commitSha = wr["head_sha"] ? String(wr["head_sha"]) : null;
          ref = wr["head_branch"] ? String(wr["head_branch"]) : null;
          wfName = String(wr["name"] || "GitHub Workflow");
          const conclusion = String(wr["conclusion"] || "");
          const status = String(wr["status"] || "");
          if (status === "in_progress" || status === "queued") {
            ciStatus = "running";
          } else if (conclusion === "success") {
            ciStatus = "passed";
          } else {
            ciStatus = "failed";
          }
          summaryData = { conclusion, status };
        }
      } else if (provider === "gitlab") {
        if (eventType.includes("Pipeline") || req.body?.object_attributes) {
          const attrs = (req.body?.object_attributes || {}) as Record<string, unknown>;
          ref = attrs["ref"] ? String(attrs["ref"]) : null;
          commitSha = attrs["sha"] ? String(attrs["sha"]) : null;
          const st = String(attrs["status"] || "");
          if (st === "running" || st === "pending") {
            ciStatus = "running";
          } else if (st === "success") {
            ciStatus = "passed";
          } else {
            ciStatus = "failed";
          }
          wfName = "GitLab CI Pipeline";
          summaryData = { status: st, stages: attrs["stages"] };
        }
      }

      const eco = ref || commitSha ? database.findEcoByCommitOrBranch(matchingSpace.id, ref || commitSha || "") : null;
      if (eco) {
        spaceEcoUpdated = true;
        spaceEcoId = eco.id;
        database.createSpaceWorkflowRun({
          spaceId: matchingSpace.id,
          ecoId: eco.id,
          provider: provider === "gitlab" ? "gitlab" : "github",
          workflowFile: provider === "gitlab" ? ".gitlab-ci.yml" : ".github/workflows/ci.yml",
          workflowName: wfName,
          triggerEvent: eventType,
          commitSha,
          ref: ref || eco.source_branch,
          status: ciStatus,
          conclusion: ciStatus === "passed" ? "success" : ciStatus === "failed" ? "failure" : null,
          summary: summaryData,
        });

        database.db
          .prepare(
            `UPDATE space_eco_proposals
             SET simulation_gate_status = ?,
                 simulation_summary_json = ?,
                 updated_at = datetime('now')
             WHERE id = ? AND space_id = ?`,
          )
          .run(ciStatus, JSON.stringify(summaryData), eco.id, matchingSpace.id);
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
      spaceEcoUpdated,
      spaceEcoId,
    });
  });

  return router;
}

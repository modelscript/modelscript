// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Web IDE ALM/PLM/Digital-Thread Sync Proxy Router (`/api/v1/alm`).
 *
 * Allows the browser-based ModelScript Web IDE (`apps/ide`) to discover, pull,
 * and push external remotes (DOORS Next/OSLC, Jama, Codebeamer, Polarion, Jira,
 * Azure DevOps, TestRail, Xray, PTC Windchill, Siemens Teamcenter, Aras Innovator,
 * GitHub, GitLab, Bitbucket, Confluence, PTC Onshape, JFrog Artifactory, Apache
 * Airflow, Vitech GENESYS, Teamwork Cloud, Zuken DS-CR/DS-E3, and Generic REST)
 * without browser CORS restrictions while keeping the in-browser WASM compiler
 * 100% file-based.
 */

import {
  globalAlmConnectorRegistry,
  normalizeRemoteDependency,
  pullRemotePackage,
  pushRemotePackage,
  type AlmLink,
  type AlmVerificationRun,
  type ArtifactEdit,
  type AuthContext,
  type LockfileRemoteState,
  type RemoteDependencySpec,
} from "@modelscript/runtime";
import { Router, json, type Request, type Response } from "express";

function extractProxyAuth(req: Request): AuthContext {
  const bodyAuth = (req.body?.auth ?? {}) as AuthContext;
  const headerToken = typeof req.headers["x-alm-token"] === "string" ? req.headers["x-alm-token"] : undefined;
  return {
    token: bodyAuth.token ?? headerToken,
    username: bodyAuth.username,
    password: bodyAuth.password,
    oauth2: bodyAuth.oauth2,
    headers: bodyAuth.headers,
  };
}

export function almRouter(): Router {
  const router = Router();
  router.use(json({ limit: "2mb" }));

  router.get("/protocols", (_req: Request, res: Response) => {
    res.json({ protocols: globalAlmConnectorRegistry.listProtocols() });
  });

  router.post("/discover", async (req: Request, res: Response) => {
    try {
      const { packageName, spec } = req.body as { packageName?: string; spec?: string | RemoteDependencySpec };
      if (!spec) {
        res.status(400).json({ error: "Missing 'spec' in request body." });
        return;
      }
      const norm = normalizeRemoteDependency(spec);
      if (!norm) {
        res.status(400).json({ error: "Invalid protocol-prefixed ALM dependency spec." });
        return;
      }
      const connector = globalAlmConnectorRegistry.get(norm.connector ?? norm.parsed.protocol);
      if (!connector) {
        res.status(400).json({ error: `Unsupported ALM protocol '${norm.connector ?? norm.parsed.protocol}'.` });
        return;
      }
      const capabilities = await connector.discover(
        { ...norm, packageName: packageName || "@alm/remote" },
        extractProxyAuth(req),
      );
      res.json({ capabilities });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/pull", async (req: Request, res: Response) => {
    try {
      const { packageName, spec, prevState, conflictStrategy, existingLocalContent } = req.body as {
        packageName?: string;
        spec?: string | RemoteDependencySpec;
        prevState?: LockfileRemoteState | null;
        conflictStrategy?: "fail" | "theirs" | "ours";
        existingLocalContent?: string;
      };
      if (!spec) {
        res.status(400).json({ error: "Missing 'spec' in request body." });
        return;
      }
      const norm = normalizeRemoteDependency(spec);
      if (!norm) {
        res.status(400).json({ error: "Invalid protocol-prefixed ALM dependency spec." });
        return;
      }
      const connector = globalAlmConnectorRegistry.get(norm.connector ?? norm.parsed.protocol);
      if (!connector) {
        res.status(400).json({ error: `Unsupported ALM protocol '${norm.connector ?? norm.parsed.protocol}'.` });
        return;
      }

      const result = await pullRemotePackage(
        connector,
        { ...norm, packageName: packageName || "@alm/remote" },
        extractProxyAuth(req),
        prevState,
        { conflictStrategy, existingLocalContent },
      );
      res.json({
        snapshotVersion: result.snapshotVersion,
        integrity: result.snapshot.integrity,
        files: result.snapshot.files,
        remoteState: result.remoteState,
        addedIds: result.addedIds,
        updatedIds: result.updatedIds,
        deletedIds: result.deletedIds,
        conflicts: result.conflicts,
      });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/push", async (req: Request, res: Response) => {
    try {
      const { packageName, spec, links, verificationRuns, edits } = req.body as {
        packageName?: string;
        spec?: string | RemoteDependencySpec;
        links?: AlmLink[];
        verificationRuns?: AlmVerificationRun[];
        edits?: ArtifactEdit[];
      };
      if (!spec) {
        res.status(400).json({ error: "Missing 'spec' in request body." });
        return;
      }
      const norm = normalizeRemoteDependency(spec);
      if (!norm) {
        res.status(400).json({ error: "Invalid protocol-prefixed ALM dependency spec." });
        return;
      }
      const connector = globalAlmConnectorRegistry.get(norm.connector ?? norm.parsed.protocol);
      if (!connector) {
        res.status(400).json({ error: `Unsupported ALM protocol '${norm.connector ?? norm.parsed.protocol}'.` });
        return;
      }

      const result = await pushRemotePackage(
        connector,
        { ...norm, packageName: packageName || "@alm/remote" },
        extractProxyAuth(req),
        { links, verificationRuns, edits },
      );
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * Inbound ALM webhook receiver for GitOps automation (Jira, Jama, Codebeamer, Polarion, OSLC).
   * Validates optional HMAC-SHA256 signature via `ALM_WEBHOOK_SECRET` and normalizes
   * the payload into a canonical sync-trigger event (`AlmWebhookEvent`).
   */
  router.post("/webhook/:protocol", async (req: Request, res: Response) => {
    const protocol = String(req.params["protocol"] ?? "").toLowerCase();
    const secret = process.env["ALM_WEBHOOK_SECRET"];
    if (secret) {
      const crypto = await import("node:crypto");
      const rawSig =
        (typeof req.headers["x-hub-signature-256"] === "string" && req.headers["x-hub-signature-256"]) ||
        (typeof req.headers["x-modelscript-signature"] === "string" && req.headers["x-modelscript-signature"]) ||
        "";
      const expected = `sha256=${crypto
        .createHmac("sha256", secret)
        .update(JSON.stringify(req.body ?? {}))
        .digest("hex")}`;
      const a = Buffer.from(rawSig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        res.status(401).json({ error: "Invalid ALM webhook signature." });
        return;
      }
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const event = normalizeAlmWebhookPayload(protocol, body);
    res.status(202).json({
      accepted: true,
      event,
      recommendedAction: "msx sync pull",
    });
  });

  return router;
}

export interface AlmWebhookEvent {
  protocol: string;
  eventType: string;
  affectedIds: string[];
  baselineOrRevision?: string | undefined;
  receivedAt: string;
}

export function normalizeAlmWebhookPayload(protocol: string, payload: Record<string, unknown>): AlmWebhookEvent {
  const receivedAt = new Date().toISOString();
  const affectedIds: string[] = [];
  let eventType = "updated";
  let baselineOrRevision: string | undefined;

  if (protocol === "jira") {
    eventType = String(payload["webhookEvent"] ?? "jira:issue_updated");
    const issue = payload["issue"] as Record<string, unknown> | undefined;
    if (issue?.["key"]) affectedIds.push(String(issue["key"]));
  } else if (protocol === "jama") {
    eventType = String(payload["event"] ?? "ITEM_UPDATED");
    const data = payload["data"] as Record<string, unknown> | undefined;
    if (data?.["documentKey"]) affectedIds.push(String(data["documentKey"]));
    else if (data?.["id"]) affectedIds.push(String(data["id"]));
  } else if (protocol === "codebeamer") {
    eventType = String(payload["eventType"] ?? "TRACKER_ITEM_UPDATED");
    const item = payload["item"] as Record<string, unknown> | undefined;
    if (item?.["id"]) affectedIds.push(`CB-${String(item["id"])}`);
    if (payload["baselineId"]) baselineOrRevision = String(payload["baselineId"]);
  } else if (protocol === "polarion") {
    eventType = String(payload["event"] ?? "WORKITEM_UPDATED");
    if (payload["workItemId"]) affectedIds.push(String(payload["workItemId"]));
    if (payload["revision"]) baselineOrRevision = String(payload["revision"]);
  } else if (protocol === "github" || protocol === "gh") {
    eventType = String(payload["action"] ?? "issues");
    const issue = (payload["issue"] ?? payload["pull_request"]) as Record<string, unknown> | undefined;
    const prefix = payload["pull_request"] ? "PR" : "GH";
    if (issue?.["number"] !== undefined) affectedIds.push(`${prefix}-${String(issue["number"])}`);
  } else if (protocol === "gitlab" || protocol === "gl") {
    eventType = String(payload["object_kind"] ?? "issue");
    const attrs = payload["object_attributes"] as Record<string, unknown> | undefined;
    if (attrs?.["iid"] !== undefined) affectedIds.push(`GL-${String(attrs["iid"])}`);
  } else if (protocol === "bitbucket" || protocol === "bb") {
    eventType = String(payload["eventKey"] ?? "pr:modified");
    const pr = payload["pullRequest"] as Record<string, unknown> | undefined;
    if (pr?.["id"] !== undefined) affectedIds.push(`BB-PR-${String(pr["id"])}`);
  } else if (protocol === "azdo" || protocol === "azure-devops" || protocol === "ado") {
    eventType = String(payload["eventType"] ?? "workitem.updated");
    const resource = payload["resource"] as Record<string, unknown> | undefined;
    const wiId = resource?.["workItemId"] ?? resource?.["id"];
    if (wiId !== undefined) affectedIds.push(`WI-${String(wiId)}`);
    if (resource?.["rev"] !== undefined) baselineOrRevision = String(resource["rev"]);
  } else if (protocol === "windchill" || protocol === "ptc-windchill") {
    eventType = String(payload["eventType"] ?? "part.modified");
    if (payload["Number"] ?? payload["partNumber"])
      affectedIds.push(String(payload["Number"] ?? payload["partNumber"]));
    if (payload["Version"]) baselineOrRevision = String(payload["Version"]);
  } else if (protocol === "teamcenter" || protocol === "tc") {
    eventType = String(payload["eventType"] ?? "item.modified");
    if (payload["item_id"]) affectedIds.push(String(payload["item_id"]));
    if (payload["item_revision_id"]) baselineOrRevision = String(payload["item_revision_id"]);
  } else if (protocol === "aras" || protocol === "aras-innovator") {
    eventType = String(payload["eventType"] ?? "item.updated");
    if (payload["item_number"] ?? payload["id"]) affectedIds.push(String(payload["item_number"] ?? payload["id"]));
    if (payload["major_rev"]) baselineOrRevision = String(payload["major_rev"]);
  } else if (protocol === "artifactory" || protocol === "jfrog") {
    eventType = String(payload["event_type"] ?? "deployed");
    const data = payload["data"] as Record<string, unknown> | undefined;
    if (data?.["repo_key"] && data?.["path"]) affectedIds.push(`${String(data["repo_key"])}/${String(data["path"])}`);
    if (data?.["sha256"]) baselineOrRevision = String(data["sha256"]);
  } else {
    // OSLC / DOORS Next TRS or generic webhook
    eventType = String(payload["eventType"] ?? payload["type"] ?? "trs:Modification");
    if (payload["identifier"]) affectedIds.push(String(payload["identifier"]));
    if (payload["configuration"]) baselineOrRevision = String(payload["configuration"]);
  }

  return { protocol, eventType, affectedIds, baselineOrRevision, receivedAt };
}

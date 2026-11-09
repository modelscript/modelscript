// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { LibraryStorage } from "../src/storage.js";

test("Jira Ingestion API & Real-Time Webhook Pipeline", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jira-test-"));
  const db = new LibraryDatabase(path.join(tmpDir, "db"));
  const storage = new LibraryStorage(path.join(tmpDir, "storage"));
  const app = createApp({ database: db, storage });

  t.after(() => {
    try {
      if (app.locals.decayWorkerInterval) clearInterval(app.locals.decayWorkerInterval);
      if (app.locals.rssWorkerInterval) clearInterval(app.locals.rssWorkerInterval);
      if (app.locals.logPurgeInterval) clearInterval(app.locals.logPurgeInterval);
      if (app.locals.federationWorker) app.locals.federationWorker.stop();
      if (app.locals.publishWorker) app.locals.publishWorker.stop();
      if (app.locals.jobQueue) app.locals.jobQueue.stop();
    } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 1. Seed user and space
  const user = db.createUser("aero_lead", "lead@aero.space", "hashed", {
    emailVerified: true,
  });

  const authToken = jwt.sign(
    {
      id: user.id,
      username: user.username,
      account_type: "user",
    },
    JWT_SECRET,
  );

  const space = db.createSpace({
    userId: user.id,
    ownerType: "user",
    slug: "propulsion",
    name: "Propulsion Systems",
    description: "Cryogenic rocket and turbine propulsion models",
    domainCategory: "Aerospace",
    visibility: "public",
  });

  // 2. Mock global fetch for Jira REST API
  const originalFetch = globalThis.fetch;
  const mockJiraIssues = [
    {
      id: "1001",
      key: "PROP-101",
      fields: {
        summary: "Cavitation in turbopump inducer",
        description: "Observed vapor bubble formation in model: Aerospace.Propulsion.Turbopump.",
        status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
        priority: { name: "High" },
        labels: ["fluids", "cavitation"],
        created: "2026-11-05T08:00:00Z",
        updated: "2026-11-08T12:00:00Z",
        assignee: { displayName: "Wernher von Braun", emailAddress: "wernher@aero.space" },
      },
    },
    {
      id: "1002",
      key: "PROP-102",
      fields: {
        summary: "Main valve actuation failure",
        description: "Valve actuator exceeded torque limits. Component: SafetyReliefValve.",
        status: { name: "Done", statusCategory: { key: "done" } },
        priority: { name: "Blocker" },
        labels: ["actuator", "critical"],
        created: "2026-11-06T09:00:00Z",
        updated: "2026-11-08T14:00:00Z",
        assignee: null,
      },
    },
  ];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = String(input);
    if (urlStr.includes("/search")) {
      return new Response(
        JSON.stringify({
          startAt: 0,
          maxResults: 25,
          total: 2,
          issues: mockJiraIssues,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (urlStr.includes("/comment")) {
      return new Response(JSON.stringify({ id: "comment-999" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  // 3. Test JQL Sync Pull Endpoint
  const syncRes = await request(app)
    .post(`/api/v1/spaces/${user.username}/${space.slug}/integrations/jira/sync`)
    .set("Authorization", `Bearer ${authToken}`)
    .send({
      jiraBaseUrl: "https://aerospace.atlassian.net",
      email: "engineer@aero.space",
      apiToken: "test-token-123",
      jql: "project = 'PROP' ORDER BY updated DESC",
    });

  assert.strictEqual(syncRes.status, 200, `Expected 200, got: ${JSON.stringify(syncRes.body)}`);
  assert.strictEqual(syncRes.body.success, true);
  assert.strictEqual(syncRes.body.synced, 2);
  assert.strictEqual(syncRes.body.created, 2);
  assert.strictEqual(syncRes.body.updated, 0);

  // Verify issues stored in database
  const issues = db.getSpaceIssues(space.id);
  assert.strictEqual(issues.length, 2);

  const prop101 = issues.find((i) => i.external_key === "PROP-101");
  assert.ok(prop101);
  assert.strictEqual(prop101.external_source, "jira");
  assert.strictEqual(prop101.external_url, "https://aerospace.atlassian.net/browse/PROP-101");
  assert.strictEqual(prop101.status, "open");
  assert.strictEqual(prop101.severity, "major");
  assert.ok(prop101.impacted_models.includes("Aerospace.Propulsion.Turbopump"));

  const prop102 = issues.find((i) => i.external_key === "PROP-102");
  assert.ok(prop102);
  assert.strictEqual(prop102.status, "closed");
  assert.strictEqual(prop102.severity, "safety_critical");
  assert.ok(prop102.impacted_models.includes("SafetyReliefValve"));

  // 4. Test Idempotent Sync (should update, not duplicate)
  const resyncRes = await request(app)
    .post(`/api/v1/spaces/${user.username}/${space.slug}/integrations/jira/sync`)
    .set("Authorization", `Bearer ${authToken}`)
    .send({
      jiraBaseUrl: "https://aerospace.atlassian.net",
      apiToken: "test-token-123",
    });

  assert.strictEqual(resyncRes.status, 200);
  assert.strictEqual(resyncRes.body.synced, 2);
  assert.strictEqual(resyncRes.body.created, 0);
  assert.strictEqual(resyncRes.body.updated, 2);
  assert.strictEqual(db.getSpaceIssues(space.id).length, 2);

  // 5. Test Verification Feedback Comment Endpoint
  const feedbackRes = await request(app)
    .post(`/api/v1/spaces/${user.username}/${space.slug}/integrations/jira/issues/PROP-101/verify`)
    .set("Authorization", `Bearer ${authToken}`)
    .send({
      jiraBaseUrl: "https://aerospace.atlassian.net",
      apiToken: "test-token-123",
      comment: "Automated simulation verification PASSED with CVODE solver. Max deviation = 0.00012.",
    });

  assert.strictEqual(feedbackRes.status, 200);
  assert.strictEqual(feedbackRes.body.commentId, "comment-999");

  // 6. Test Real-Time Webhook Push Ingestion
  const webhookCreateRes = await request(app)
    .post(
      `/api/v1/webhooks/incoming/jira?space=${user.username}/${space.slug}&jiraBaseUrl=https://aerospace.atlassian.net`,
    )
    .send({
      webhookEvent: "jira:issue_created",
      issue: {
        id: "1003",
        key: "PROP-103",
        fields: {
          summary: "Nozzle throat erosion test anomaly",
          description: "Thermal degradation detected in model: Aerospace.Propulsion.NozzleThroat.",
          status: { name: "Open", statusCategory: { key: "new" } },
          priority: { name: "Medium" },
          labels: ["thermal", "nozzle"],
          created: "2026-11-09T01:00:00Z",
          updated: "2026-11-09T01:00:00Z",
        },
      },
    });

  assert.strictEqual(webhookCreateRes.status, 200);
  assert.strictEqual(webhookCreateRes.body.isNew, true);
  assert.strictEqual(webhookCreateRes.body.key, "PROP-103");

  const prop103 = db.getSpaceIssues(space.id).find((i) => i.external_key === "PROP-103");
  assert.ok(prop103);
  assert.strictEqual(prop103.title, "Nozzle throat erosion test anomaly");
  assert.ok(prop103.impacted_models.includes("Aerospace.Propulsion.NozzleThroat"));

  // 7. Test Webhook Issue Deleted (Auto-Close)
  const webhookDeleteRes = await request(app)
    .post(`/api/v1/webhooks/incoming/jira?space=${user.username}/${space.slug}`)
    .send({
      webhookEvent: "jira:issue_deleted",
      issue: {
        id: "1003",
        key: "PROP-103",
        fields: {},
      },
    });

  assert.strictEqual(webhookDeleteRes.status, 200);
  assert.strictEqual(webhookDeleteRes.body.closed, true);

  const prop103AfterDelete = db.getSpaceIssues(space.id).find((i) => i.external_key === "PROP-103");
  assert.strictEqual(prop103AfterDelete?.status, "closed");

  // 8. Test Jira Settings Persistence (PUT & GET /integrations/jira)
  const putSettingsRes = await request(app)
    .put(`/api/v1/spaces/${user.username}/${space.slug}/integrations/jira`)
    .set("Authorization", `Bearer ${authToken}`)
    .send({
      baseUrl: "https://aerospace.atlassian.net",
      email: "service-bot@aero.space",
      apiToken: "secure-stored-token",
      jql: "project = PROP AND statusCategory != Done",
      autoCommentOnSimulation: true,
    });

  assert.strictEqual(putSettingsRes.status, 200);
  assert.strictEqual(putSettingsRes.body.success, true);
  assert.strictEqual(putSettingsRes.body.integration.configured, true);
  assert.strictEqual(putSettingsRes.body.integration.hasApiToken, true);

  const getSettingsRes = await request(app)
    .get(`/api/v1/spaces/${user.username}/${space.slug}/integrations/jira`)
    .set("Authorization", `Bearer ${authToken}`);

  assert.strictEqual(getSettingsRes.status, 200);
  assert.strictEqual(getSettingsRes.body.configured, true);
  assert.strictEqual(getSettingsRes.body.baseUrl, "https://aerospace.atlassian.net");
  assert.strictEqual(getSettingsRes.body.autoCommentOnSimulation, true);
  assert.strictEqual(getSettingsRes.body.hasApiToken, true);

  // 9. Test Sync Using Saved Settings (no credentials in body)
  const savedSyncRes = await request(app)
    .post(`/api/v1/spaces/${user.username}/${space.slug}/integrations/jira/sync`)
    .set("Authorization", `Bearer ${authToken}`)
    .send({});

  assert.strictEqual(savedSyncRes.status, 200);
  assert.strictEqual(savedSyncRes.body.success, true);

  // 10. Test Automated Simulation Gate Comment Writeback on ECO Simulation
  const eco = db.createSpaceEcoProposal({
    spaceId: space.id,
    title: "Optimize Turbopump Inducer Geometry [PROP-101]",
    description: "Modifications to eliminate cavitation. Resolves Jira ticket PROP-101.",
    severity: "major",
    sourceBranch: "fix/inducer-cavitation",
    targetBranch: "main",
    authorId: user.id,
    impactedModels: ["Aerospace.Propulsion.Turbopump"],
  });

  const postedComments: { key: string; comment: string }[] = [];
  // Temporarily spy on fetch for comment writeback
  const spiedFetch = async (url: any, init: any) => {
    if (String(url).includes("/comment")) {
      const match = String(url).match(/\/issue\/([^/]+)\/comment/);
      const key = match ? decodeURIComponent(match[1]) : "unknown";
      let comment = "";
      try {
        const bodyObj = JSON.parse(init?.body || "{}");
        comment = bodyObj.body?.content?.[0]?.content?.[0]?.text || bodyObj.body || "";
      } catch {}
      postedComments.push({ key, comment });
      return new Response(JSON.stringify({ id: "comment-auto-123" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(url, init);
  };
  globalThis.fetch = spiedFetch as any;

  // Trigger external simulation report for this ECO
  const simReportRes = await request(app)
    .post(`/api/v1/spaces/${user.username}/${space.slug}/ecos/${eco.id}/workflows/external-report`)
    .send({
      provider: "ansatz",
      status: "passed",
      workflowName: "Modelica Stiff DAE Gate",
      simulationSummary: {
        solver: "SUNDIALS CVODE (BDF)",
        tolerance: 0.0001,
        maxRelError: 0.000045,
        variablesCount: 168,
        equationsCount: 168,
        checks: [{ name: "Cavitation Head Margin", status: "passed", value: "3.2m", margin: "+1.2m" }],
      },
    });

  assert.strictEqual(simReportRes.status, 200);
  assert.strictEqual(simReportRes.body.simulationGateStatus, "passed");

  // Allow background microtask queue to process comment posting
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.ok(postedComments.length >= 1, "Must post verification comment to Jira ticket");
  const prop101Comment = postedComments.find((c) => c.key === "PROP-101");
  assert.ok(prop101Comment, "Must have posted to PROP-101");
  assert.ok(prop101Comment.comment.includes("Ansatz Simulation Verification Gate: PASSED"));
  assert.ok(prop101Comment.comment.includes("SUNDIALS CVODE (BDF)"));
});

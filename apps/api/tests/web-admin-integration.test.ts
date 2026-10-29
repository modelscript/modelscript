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

test("Web Admin UI Integration & Client API Verification", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "web-admin-test-"));
  const db = new LibraryDatabase(path.join(tmpDir, "db"));
  const storage = new LibraryStorage(path.join(tmpDir, "storage"));
  const app = createApp({ database: db, storage });

  t.after(() => {
    try {
      if (app.locals.decayWorkerInterval) clearInterval(app.locals.decayWorkerInterval);
      if (app.locals.rssWorkerInterval) clearInterval(app.locals.rssWorkerInterval);
      if (app.locals.logPurgeInterval) clearInterval(app.locals.logPurgeInterval);
      if (app.locals.federationWorker) app.locals.federationWorker.stop();
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // 1. Create standard user and admin user
  const regularUser = db.createUser("standard_user", "standard@modelscript.test", "hash123", {
    accountType: "user",
    emailVerified: true,
  });
  const regularToken = jwt.sign(
    { id: regularUser.id, username: regularUser.username, email: regularUser.email, accountType: "user" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  const adminUser = db.createUser("super_admin", "admin@modelscript.test", "hash456", {
    accountType: "admin",
    emailVerified: true,
  });
  const adminToken = jwt.sign(
    { id: adminUser.id, username: adminUser.username, email: adminUser.email, accountType: "admin" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  await t.test("Auth Profile (/api/v1/auth/me) returns account_type for client RBAC", async () => {
    // Regular user
    const resReg = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${regularToken}`).expect(200);
    assert.strictEqual(resReg.body.user.account_type, "user");

    // Admin user
    const resAdmin = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${adminToken}`).expect(200);
    assert.strictEqual(resAdmin.body.user.account_type, "admin");
  });

  await t.test("Moderation workflow: queue retrieval and report resolution with AP tombstone", async () => {
    // Create an offensive post
    const post = db.createPost(
      regularUser.id,
      "Offensive spam post needing moderation",
      undefined,
      undefined,
      undefined,
      undefined,
      "https://hub.modelscript.org/posts/1001",
    );

    // Report the post
    const report = db.createContentReport(regularUser.id, {
      postId: post.id,
      reason: "Spam and abuse",
    });

    // Fetch moderation queue
    const queueRes = await request(app)
      .get("/api/v1/admin/moderation/queue?status=pending")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.ok(queueRes.body.reports.some((r: any) => r.id === report.id));

    // Resolve report with action delete_post
    const resolveRes = await request(app)
      .post(`/api/v1/admin/moderation/reports/${report.id}/resolve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "resolved",
        action: "delete_post",
        resolutionNotes: "Takedown confirmed and executed via admin console",
      })
      .expect(200);

    assert.strictEqual(resolveRes.body.success, true);
    assert.strictEqual(resolveRes.body.actionExecuted, "delete_post");
    assert.ok(resolveRes.body.tombstoneActivity);
    assert.strictEqual(resolveRes.body.tombstoneActivity.type, "Delete");

    // Verify post is now deleted
    const deletedPost = db.getPost(post.id);
    assert.strictEqual(deletedPost, null);
  });

  await t.test("Federation Domain Management workflow", async () => {
    // Set domain tier to silence
    const setRes = await request(app)
      .post("/api/v1/admin/federation/domains")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        domain: "spammer-node.social",
        tier: "silence",
        reason: "Excessive unsolicited notifications",
      })
      .expect(201);

    assert.strictEqual(setRes.body.domain, "spammer-node.social");
    assert.strictEqual(setRes.body.tier, "silence");

    // List domains
    const listRes = await request(app)
      .get("/api/v1/admin/federation/domains")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.ok(listRes.body.domains.some((d: any) => d.domain === "spammer-node.social" && d.tier === "silence"));

    // Reset domain rule
    const delRes = await request(app)
      .delete("/api/v1/admin/federation/domains/spammer-node.social")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.strictEqual(delRes.body.success, true);
  });

  await t.test("DMCA Notice intake and resolution workflow", async () => {
    // Ingest DMCA notice
    const noticeRes = await request(app)
      .post("/api/v1/admin/dmca/notices")
      .send({
        claimantName: "Jane Copyright",
        claimantEmail: "legal@example.com",
        copyrightOwner: "Acme Corp",
        workDescription: "Proprietary Modelica thermal library",
        infringingUrl: "https://hub.modelscript.org/packages/acme-thermal",
      })
      .expect(201);

    const noticeId = noticeRes.body.noticeId;
    assert.ok(noticeId);

    // List notices
    const listRes = await request(app)
      .get("/api/v1/admin/dmca/notices?status=pending")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.ok(listRes.body.notices.some((n: any) => n.id === noticeId));

    // Resolve notice
    const resolveRes = await request(app)
      .post(`/api/v1/admin/dmca/notices/${noticeId}/resolve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ actionTaken: "Package removed per statutory takedown notice." })
      .expect(200);

    assert.strictEqual(resolveRes.body.success, true);
  });

  await t.test("Database Maintenance API workflow", async () => {
    // Get DB Status
    const statusRes = await request(app)
      .get("/api/v1/admin/db/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.ok(statusRes.body.currentVersion !== undefined);
    assert.ok(Array.isArray(statusRes.body.applied));

    // Verify DB schema integrity
    const verifyRes = await request(app)
      .get("/api/v1/admin/db/verify")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.ok(verifyRes.body.valid === true || (verifyRes.body.foreignKeysOk && verifyRes.body.integrityOk));

    // Dry-run DB upgrade
    const upgradeRes = await request(app)
      .post("/api/v1/admin/db/upgrade")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ dryRun: true })
      .expect(200);

    assert.strictEqual(upgradeRes.body.success, true);
  });

  await t.test("Unified first-party pageview analytics, bot filtering, and post view geo-hygiene", async () => {
    // 1. Web pageview beacon with Cloudflare country header
    const webBeacon1 = await request(app)
      .post("/api/v1/analytics/pageview")
      .set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125.0")
      .set("CF-IPCountry", "DE")
      .set("X-Vercel-IP-Country-Region", "BY")
      .send({ path: "/explore?tab=popular#top", surface: "web" })
      .expect(202);

    assert.strictEqual(webBeacon1.body.success, true);
    assert.strictEqual(webBeacon1.body.counted, true);
    assert.strictEqual(webBeacon1.body.isUnique, true);

    // 2. Duplicate hit from the same visitor on the same route on the same day increments total views, not uniqueViews
    const webBeacon2 = await request(app)
      .post("/api/v1/analytics/pageview")
      .set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125.0")
      .set("CF-IPCountry", "DE")
      .set("X-Vercel-IP-Country-Region", "BY")
      .send({ path: "/explore", surface: "web" })
      .expect(202);

    assert.strictEqual(webBeacon2.body.counted, true);
    assert.strictEqual(webBeacon2.body.isUnique, false);

    // 3. Docs portal pageview beacon (text/plain sendBeacon payload)
    const docsBeacon = await request(app)
      .post("/api/v1/analytics/pageview")
      .set("Content-Type", "text/plain")
      .set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15")
      .set("CF-IPCountry", "US")
      .set("X-Vercel-IP-Country-Region", "CA")
      .send(JSON.stringify({ path: "/guide/getting-started.html", surface: "docs" }))
      .expect(202);

    assert.strictEqual(docsBeacon.body.counted, true);
    assert.strictEqual(docsBeacon.body.isUnique, true);

    // 4. Bot User-Agent is filtered and not counted
    const botBeacon = await request(app)
      .post("/api/v1/analytics/pageview")
      .set("User-Agent", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")
      .set("CF-IPCountry", "US")
      .send({ path: "/guide/getting-started.html", surface: "docs" })
      .expect(202);

    assert.strictEqual(botBeacon.body.counted, false);

    // 5. Post view geo-hygiene: free-text profile.location must not pollute post_location_stats
    db.updateProfile(regularUser.id, { location: "San Francisco, Bay Area" });
    const post = db.createPost(regularUser.id, "Testing post impression geo hygiene");

    // View without proxy geo headers on loopback IP -> increments view_count, but does not insert "San Francisco, Bay Area"
    const viewRes1 = await request(app)
      .post(`/api/v1/social/posts/${post.id}/view`)
      .set("Authorization", `Bearer ${regularToken}`)
      .set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) Firefox/126.0")
      .expect(200);
    assert.strictEqual(viewRes1.body.counted, true);

    // Duplicate view from same visitor is deduplicated
    const viewResDup = await request(app)
      .post(`/api/v1/social/posts/${post.id}/view`)
      .set("Authorization", `Bearer ${regularToken}`)
      .set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) Firefox/126.0")
      .expect(200);
    assert.strictEqual(viewResDup.body.counted, false);

    // View from a second visitor with valid ISO header records country/region
    const viewRes2 = await request(app)
      .post(`/api/v1/social/posts/${post.id}/view`)
      .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0")
      .set("CF-IPCountry", "JP")
      .set("X-Region-Code", "13")
      .expect(200);
    assert.strictEqual(viewRes2.body.counted, true);

    const postAnalyticsRes = await request(app).get(`/api/v1/social/posts/${post.id}/analytics`).expect(200);
    assert.strictEqual(postAnalyticsRes.body.view_count, 2);
    assert.strictEqual(postAnalyticsRes.body.location_stats.length, 1);
    assert.strictEqual(postAnalyticsRes.body.location_stats[0].country, "JP");
    assert.strictEqual(postAnalyticsRes.body.location_stats[0].views, 1);

    // 6. Query Admin Analytics summary across all surfaces and surface-filtered
    const adminAnalyticsAll = await request(app)
      .get("/api/v1/admin/analytics?days=30&surface=all")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.strictEqual(adminAnalyticsAll.body.totals.totalViews, 3);
    assert.strictEqual(adminAnalyticsAll.body.totals.uniqueViews, 2);
    assert.strictEqual(adminAnalyticsAll.body.totals.webViews, 2);
    assert.strictEqual(adminAnalyticsAll.body.totals.docsViews, 1);
    assert.ok(
      adminAnalyticsAll.body.topPages.some(
        (p: { path: string; surface: string; views: number }) =>
          p.path === "/explore" && p.surface === "web" && p.views === 2,
      ),
    );
    assert.ok(
      adminAnalyticsAll.body.topPages.some(
        (p: { path: string; surface: string; views: number }) =>
          p.path === "/guide/getting-started.html" && p.surface === "docs" && p.views === 1,
      ),
    );
    assert.ok(
      adminAnalyticsAll.body.countryBreakdown.some(
        (c: { countryCode: string; views: number }) => c.countryCode === "DE" && c.views === 2,
      ),
    );
    assert.ok(
      adminAnalyticsAll.body.countryBreakdown.some(
        (c: { countryCode: string; views: number }) => c.countryCode === "US" && c.views === 1,
      ),
    );

    const adminAnalyticsDocs = await request(app)
      .get("/api/v1/admin/analytics?days=30&surface=docs")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    assert.strictEqual(adminAnalyticsDocs.body.totals.totalViews, 1);
    assert.strictEqual(adminAnalyticsDocs.body.topPages.length, 1);
    assert.strictEqual(adminAnalyticsDocs.body.topPages[0].surface, "docs");

    // 7. Prune analytics endpoint
    const pruneRes = await request(app)
      .post("/api/v1/admin/analytics/prune")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ retainDays: 90 })
      .expect(200);
    assert.strictEqual(pruneRes.body.success, true);
    assert.strictEqual(pruneRes.body.retainDays, 90);
  });

  await t.test("Audit Log records all administrative actions", async () => {
    const logsRes = await request(app)
      .get("/api/v1/admin/audit-logs")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.ok(Array.isArray(logsRes.body.logs));
    assert.ok(logsRes.body.logs.length > 0);

    const actions = logsRes.body.logs.map((l: any) => l.action);
    assert.ok(actions.includes("report_resolved"));
    assert.ok(actions.includes("federation_tier_silence"));
    assert.ok(actions.includes("dmca_notice_resolved"));
    assert.ok(actions.includes("analytics_pruned"));
  });

  await t.test("Consolidated IDE workbench & user language registry routes on API server", async () => {
    const langRes = await request(app).get("/api/languages/user").expect(200);
    assert.ok(langRes.body.version);
    assert.strictEqual(typeof langRes.body.languages, "object");

    const wbRes = await request(app).get("/vscode/workbench?folder=memfs:empty&vscode-coi=3");
    assert.ok(wbRes.status === 200 || wbRes.status === 503);
    assert.strictEqual(wbRes.headers["cross-origin-opener-policy"], "same-origin");
    assert.strictEqual(wbRes.headers["cross-origin-embedder-policy"], "credentialless");
    assert.ok(wbRes.text.includes("ModelScript"));

    const wrapperRes = await request(app).get("/github.com/modelscript/modelscript").expect(200);
    assert.ok(wrapperRes.text.includes("/vscode/workbench?folder="));
  });

  await t.test(
    "Enriched moderation forensics, graduated actions, bulk triage, user governance, S2S queue, and DMCA rejection",
    async () => {
      // 1. Create a remote-attributed user and post, then file multiple reports
      const remoteAuthor = db.createUser("remote_spammer", "spammer@bad-instance.social", "hash789", {
        accountType: "user",
        emailVerified: true,
      });
      db.db.prepare("UPDATE users SET remote_domain = ? WHERE id = ?").run("bad-instance.social", remoteAuthor.id);

      const post1 = db.createPost(remoteAuthor.id, "Crypto pump spam message #1");
      const post2 = db.createPost(remoteAuthor.id, "Crypto pump spam message #2");

      const rep1 = db.createContentReport(regularUser.id, {
        postId: post1.id,
        reason: "Spam",
        details: "Automated bot spam links",
      });
      const rep2 = db.createContentReport(adminUser.id, {
        postId: post1.id,
        reason: "Spam",
        details: "Duplicate report on same post",
      });
      const rep3 = db.createContentReport(regularUser.id, {
        postId: post2.id,
        reason: "Spam",
      });

      // Check overview counts
      const overviewRes = await request(app)
        .get("/api/v1/admin/overview")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.ok(overviewRes.body.pendingReports >= 3);

      // Check enriched moderation queue
      const queueRes = await request(app)
        .get("/api/v1/admin/moderation/queue?status=pending")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      const enrichedRep1 = queueRes.body.reports.find((r: any) => r.id === rep1.id);
      assert.ok(enrichedRep1);
      assert.strictEqual(enrichedRep1.target_type, "post");
      assert.strictEqual(enrichedRep1.author_username, "remote_spammer");
      assert.strictEqual(enrichedRep1.author_domain, "bad-instance.social");
      assert.strictEqual(enrichedRep1.target_report_count, 2);

      // Resolve rep1 with silence_domain and resolveAllForTarget=true -> should also resolve rep2 and silence bad-instance.social
      const resolveDomainRes = await request(app)
        .post(`/api/v1/admin/moderation/reports/${rep1.id}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: "resolved",
          action: "silence_domain",
          resolutionNotes: "Silencing origin domain for repeated spam",
          resolveAllForTarget: true,
        })
        .expect(200);
      assert.strictEqual(resolveDomainRes.body.actionExecuted, "silence_domain");
      assert.strictEqual(db.getDomainTier("bad-instance.social").tier, "silence");

      // Verify rep2 was automatically resolved along with rep1
      const rep2After = db.getContentReport(rep2.id);
      assert.strictEqual(rep2After?.status, "resolved");

      // Delete post1 and verify forensic snapshot is still preserved on rep1 in the queue
      db.deletePost(post1.id);
      const resolvedQueueRes = await request(app)
        .get("/api/v1/admin/moderation/queue?status=resolved")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const preservedRep1 = resolvedQueueRes.body.reports.find((r: any) => r.id === rep1.id);
      assert.ok(preservedRep1);
      assert.strictEqual(preservedRep1.post_content, "Crypto pump spam message #1");

      // Bulk resolve remaining report (rep3) with freeze_user
      const bulkRes = await request(app)
        .post("/api/v1/admin/moderation/bulk-resolve")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          reportIds: [rep3.id],
          status: "resolved",
          action: "freeze_user",
          resolutionNotes: "Bulk freezing spammer account",
        })
        .expect(200);
      assert.strictEqual(bulkRes.body.resolvedCount, 1);

      // Verify user governance list and status
      const usersRes = await request(app)
        .get("/api/v1/admin/users?q=remote_spammer")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.strictEqual(usersRes.body.users.length, 1);
      assert.strictEqual(usersRes.body.users[0].status, "frozen");

      // Restore user via PATCH /api/v1/admin/users/:id
      const patchUserRes = await request(app)
        .patch(`/api/v1/admin/users/${remoteAuthor.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: "active",
          reason: "Appeal accepted",
        })
        .expect(200);
      assert.strictEqual(patchUserRes.body.status, "active");

      // Federation S2S delivery queue inspection, retry, and purge
      const delivery = db.enqueueFederationDelivery(
        "Create",
        "https://hub.modelscript.org/activities/101",
        { type: "Create" },
        "https://bad-instance.social/inbox",
        "bad-instance.social",
      );
      db.updateFederationDeliveryStatus(delivery.id, "failed", "HTTP 502 Bad Gateway");

      const fedQueueRes = await request(app)
        .get("/api/v1/admin/federation/queue?status=failed")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.ok(fedQueueRes.body.stats.failed >= 1);
      assert.ok(fedQueueRes.body.deliveries.some((d: any) => d.id === delivery.id));

      const retryRes = await request(app)
        .post("/api/v1/admin/federation/queue/retry")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({})
        .expect(200);
      assert.ok(retryRes.body.retriedCount >= 1);

      // Mark failed again and test purge
      db.updateFederationDeliveryStatus(delivery.id, "failed", "HTTP 504 Gateway Timeout");
      const purgeRes = await request(app)
        .delete("/api/v1/admin/federation/queue?status=failed")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.ok(purgeRes.body.deletedCount >= 1);

      // DMCA rejection workflow
      const dmcaNoticeRes = await request(app)
        .post("/api/v1/admin/dmca/notices")
        .send({
          claimantName: "Bogus Claimant",
          claimantEmail: "bogus@example.com",
          copyrightOwner: "Bogus LLC",
          workDescription: "Public domain equations",
          infringingUrl: "https://hub.modelscript.org/posts/999999",
        })
        .expect(201);

      const rejectDmcaRes = await request(app)
        .post(`/api/v1/admin/dmca/notices/${dmcaNoticeRes.body.noticeId}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: "rejected",
          actionTaken: "Rejected: Mathematical equations are not subject to copyright.",
          quarantineResource: false,
        })
        .expect(200);
      assert.strictEqual(rejectDmcaRes.body.status, "rejected");

      // 6. Content Warning (mark_sensitive), Automated security_alert Notification, Outbound ActivityPub Flag, Appeals & SHA-256 Audit Chain
      const cwPost = db.createPost(remoteAuthor.id, "Sensitive simulation output without CW");
      const cwReportRes = await request(app)
        .post(`/api/v1/social/posts/${cwPost.id}/report`)
        .set("Authorization", `Bearer ${regularToken}`)
        .send({ reason: "Sensitive Content", details: "Needs a content warning banner" })
        .expect(201);

      const markSensitiveRes = await request(app)
        .post(`/api/v1/admin/moderation/reports/${cwReportRes.body.reportId}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: "resolved",
          action: "mark_sensitive",
          contentWarning: "Graphic thermal runaway simulation",
          resolutionNotes: "Applied content warning blur",
          forwardFederatedFlag: true,
          domain: "remote.DiagnosticLab.example",
        })
        .expect(200);

      assert.strictEqual(markSensitiveRes.body.actionExecuted, "mark_sensitive");
      assert.strictEqual(markSensitiveRes.body.federatedFlagQueued, true);
      assert.strictEqual(markSensitiveRes.body.flagActivity?.type, "Flag");

      const updatedCwPost = db.getPost(cwPost.id);
      assert.ok(updatedCwPost);
      assert.strictEqual(Number(updatedCwPost.is_sensitive), 1);
      assert.strictEqual(updatedCwPost.content_warning, "Graphic thermal runaway simulation");

      // Verify offender received a security_alert notification
      const offenderNotifs = db.getNotifications(remoteAuthor.id, 20, "system");
      assert.ok(offenderNotifs.some((n) => n.type === "security_alert"));

      // Universal resource report (package)
      const pkgReportRes = await request(app)
        .post("/api/v1/social/reports")
        .set("Authorization", `Bearer ${regularToken}`)
        .send({
          targetType: "package",
          targetResourceId: "@malicious/ThermalPkg",
          reason: "Malicious Model / Payload",
          details: "Contains unauthorized external FFI call",
        })
        .expect(201);
      assert.strictEqual(pkgReportRes.body.targetType, "package");

      // Freeze offender, then offender submits a moderation appeal using their JWT, and admin restores account
      await request(app)
        .patch(`/api/v1/admin/users/${remoteAuthor.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "frozen", reason: "Frozen pending review" })
        .expect(200);

      const offenderToken = jwt.sign(
        { id: remoteAuthor.id, username: remoteAuthor.username, email: remoteAuthor.email, accountType: "user" },
        JWT_SECRET,
        { expiresIn: "1h" },
      );

      const appealRes = await request(app)
        .post("/api/v1/users/me/appeals")
        .set("Authorization", `Bearer ${offenderToken}`)
        .send({
          reason: "False positive spam flag",
          details: "My scripts were legitimate parameter sweeps.",
        })
        .expect(201);
      assert.ok(appealRes.body.appealId);

      // Admin resolves the appeal with restore_user
      const approveAppealRes = await request(app)
        .post(`/api/v1/admin/moderation/reports/${appealRes.body.appealId}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: "resolved",
          action: "restore_user",
          resolutionNotes: "Appeal verified and approved.",
        })
        .expect(200);
      assert.strictEqual(approveAppealRes.body.actionExecuted, "restore_user");
      assert.strictEqual(db.getUserById(remoteAuthor.id)?.status, "active");

      // Verify cryptographic SHA-256 hash chain across all audit logs
      const verifyChainRes = await request(app)
        .get("/api/v1/admin/audit-logs/verify")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.strictEqual(verifyChainRes.body.valid, true);
      assert.ok(verifyChainRes.body.verifiedEntries > 0);
      assert.strictEqual(verifyChainRes.body.verifiedEntries, verifyChainRes.body.totalEntries);
      assert.ok(typeof verifyChainRes.body.headHash === "string" && verifyChainRes.body.headHash.length === 64);
    },
  );
});

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

    // View from a second visitor with valid ISO header records country/region even when X-Forwarded-For has a Cloudflare proxy IP (104.28.12.1 -> GB)
    const viewRes2 = await request(app)
      .post(`/api/v1/social/posts/${post.id}/view`)
      .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0")
      .set("X-Forwarded-For", "104.28.12.1")
      .set("CF-Ray", "89abcdef01234567-NRT")
      .set("CF-IPCountry", "JP")
      .set("CF-Region-Code", "13")
      .expect(200);
    assert.strictEqual(viewRes2.body.counted, true);

    // View through Cloudflare where CF-IPCountry is unknown (XX) and no CF-Connecting-IP is present must NOT fall back to the Cloudflare edge IP (1.1.1.1 -> US)
    const viewRes3 = await request(app)
      .post(`/api/v1/social/posts/${post.id}/view`)
      .set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Safari/605.1.15")
      .set("X-Forwarded-For", "1.1.1.1")
      .set("CF-Ray", "89abcdef01234568-SJC")
      .set("CF-IPCountry", "XX")
      .expect(200);
    assert.strictEqual(viewRes3.body.counted, true);

    const postAnalyticsRes = await request(app).get(`/api/v1/social/posts/${post.id}/analytics`).expect(200);
    assert.strictEqual(postAnalyticsRes.body.view_count, 3);
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

  await t.test(
    "Phase 1–3 Lifecycle: Multi-tier RBAC (moderator/auditor), Credit Adjustments, Universal Quarantine & Counter-Notices, Blocklist Import/Export, Online Backup Restore, Instance Settings/Invites/Banner, System Diagnostics, and Hash-Preserving GDPR IP Redaction",
    async () => {
      // 1. Multi-tier RBAC: create moderator and auditor users
      const modUser = db.createUser("trust_safety_mod", "mod@modelscript.test", "hash_mod", {
        accountType: "user",
        emailVerified: true,
      });
      const audUser = db.createUser("compliance_auditor", "auditor@modelscript.test", "hash_aud", {
        accountType: "user",
        emailVerified: true,
      });

      // Promote via PATCH /api/v1/admin/users/:id
      const promoteModRes = await request(app)
        .patch(`/api/v1/admin/users/${modUser.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ role: "moderator", reason: "Trust & Safety team onboarding" })
        .expect(200);
      assert.strictEqual(promoteModRes.body.role, "moderator");

      const promoteAudRes = await request(app)
        .patch(`/api/v1/admin/users/${audUser.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ role: "auditor", reason: "SOC2 external auditor" })
        .expect(200);
      assert.strictEqual(promoteAudRes.body.role, "auditor");

      const modToken = jwt.sign(
        { id: modUser.id, username: modUser.username, email: modUser.email, accountType: "moderator" },
        JWT_SECRET,
        { expiresIn: "1h" },
      );
      const audToken = jwt.sign(
        { id: audUser.id, username: audUser.username, email: audUser.email, accountType: "auditor" },
        JWT_SECRET,
        { expiresIn: "1h" },
      );

      // Moderator can access moderation queue and DMCA notices, but NOT database upgrade or instance settings
      await request(app).get("/api/v1/admin/moderation/queue").set("Authorization", `Bearer ${modToken}`).expect(200);
      await request(app).get("/api/v1/admin/dmca/notices").set("Authorization", `Bearer ${modToken}`).expect(200);
      await request(app)
        .post("/api/v1/admin/db/upgrade")
        .set("Authorization", `Bearer ${modToken}`)
        .send({ dryRun: true })
        .expect(403);

      // Auditor can access audit-logs, verify chain, and system diagnostics, but NOT moderation queue or user mutation
      await request(app).get("/api/v1/admin/audit-logs").set("Authorization", `Bearer ${audToken}`).expect(200);
      await request(app).get("/api/v1/admin/audit-logs/verify").set("Authorization", `Bearer ${audToken}`).expect(200);
      await request(app).get("/api/v1/admin/system").set("Authorization", `Bearer ${audToken}`).expect(200);
      await request(app).get("/api/v1/admin/moderation/queue").set("Authorization", `Bearer ${audToken}`).expect(403);

      // 2. Global user statusBreakdown and Compute Credit Adjustment
      const usersListRes = await request(app)
        .get("/api/v1/admin/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.ok(usersListRes.body.statusBreakdown);
      assert.ok(usersListRes.body.statusBreakdown.moderators >= 1);
      assert.ok(usersListRes.body.statusBreakdown.auditors >= 1);

      const creditRes = await request(app)
        .post(`/api/v1/admin/users/${regularUser.id}/credits`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ deltaCredits: 250, reason: "Academic research grant allocation" })
        .expect(200);
      assert.strictEqual(creditRes.body.success, true);
      assert.strictEqual(creditRes.body.deltaCredits, 250);
      assert.ok(creditRes.body.newBalance >= 250);

      // 3. Universal DMCA Resource Quarantine, Counter-Notice (§ 512(g)), and Restore
      const dmcaPkgNotice = await request(app)
        .post("/api/v1/admin/dmca/notices")
        .send({
          claimantName: "AeroCorp Legal",
          claimantEmail: "ip@aerocorp.example",
          copyrightOwner: "AeroCorp Inc.",
          workDescription: "Proprietary FlightDynamics Modelica package",
          infringingUrl: "https://hub.modelscript.org/packages/@aerocorp/flight-dynamics",
        })
        .expect(201);

      await request(app)
        .post(`/api/v1/admin/dmca/notices/${dmcaPkgNotice.body.noticeId}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: "resolved",
          actionTaken: "Quarantined package pending counter-notice window.",
          quarantineResource: true,
          resourceType: "package",
          resourceId: "@aerocorp/flight-dynamics",
        })
        .expect(200);

      const quarantineList1 = await request(app)
        .get("/api/v1/admin/quarantine")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.ok(
        quarantineList1.body.resources.some(
          (q: any) => q.resource_type === "package" && q.resource_id === "@aerocorp/flight-dynamics",
        ),
      );

      const counterRes = await request(app)
        .post(`/api/v1/admin/dmca/notices/${dmcaPkgNotice.body.noticeId}/counter-notice`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          counterNoticeText:
            "Licensed under Apache-2.0 prior to assignment; good-faith dispute under 17 U.S.C. 512(g).",
        })
        .expect(200);
      assert.strictEqual(counterRes.body.success, true);
      assert.ok(counterRes.body.restoreEligibleAt);

      const restoreQuarantineRes = await request(app)
        .post("/api/v1/admin/quarantine/restore")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ resourceType: "package", resourceId: "@aerocorp/flight-dynamics" })
        .expect(200);
      assert.strictEqual(restoreQuarantineRes.body.success, true);

      // 4. Federation Blocklist CSV/JSON Export, Import, and Peer Policy Tester
      const importCsvRes = await request(app)
        .post("/api/v1/admin/federation/domains/import")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          mode: "merge",
          csv: "#domain,#tier,#reason\nbotnet-alpha.org,suspend,Automated scraper network\nnoisy-relay.social,silence,Unfiltered relay",
        })
        .expect(200);
      assert.strictEqual(importCsvRes.body.imported, 2);

      const exportCsvRes = await request(app)
        .get("/api/v1/admin/federation/domains/export?format=csv")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.ok(exportCsvRes.text.includes("botnet-alpha.org"));
      assert.ok(exportCsvRes.text.includes("noisy-relay.social"));

      const testDomainRes = await request(app)
        .post("/api/v1/admin/federation/test-domain")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ domain: "botnet-alpha.org", probeNetwork: false })
        .expect(200);
      assert.strictEqual(testDomainRes.body.effectiveTier, "suspend");
      assert.strictEqual(testDomainRes.body.allowedByPolicy, false);

      // 5. Instance Settings, Registration Invites, Public Banner, Dynamic NodeInfo, and System Diagnostics
      const patchSettingsRes = await request(app)
        .patch("/api/v1/admin/settings")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          instanceName: "Acme Intranet Modeling Hub",
          instanceDescription: "Corporate Cyber-Physical Digital Thread Appliance",
          contactEmail: "devops@acme.corp",
          registrationMode: "invite_only",
          federationMode: "allowlist",
          maintenanceMode: true,
          announcementBanner: "Scheduled solver cluster upgrade at 02:00 UTC.",
          announcementLevel: "warning",
          backupRetentionCount: 10,
        })
        .expect(200);
      assert.strictEqual(patchSettingsRes.body.settings.instanceName, "Acme Intranet Modeling Hub");
      assert.strictEqual(patchSettingsRes.body.settings.registrationMode, "invite_only");
      assert.strictEqual(patchSettingsRes.body.settings.federationMode, "allowlist");

      // Public banner endpoint reflects announcement and maintenance mode
      const bannerRes = await request(app).get("/api/v1/instance/banner").expect(200);
      assert.strictEqual(bannerRes.body.maintenanceMode, true);
      assert.strictEqual(bannerRes.body.announcementBanner, "Scheduled solver cluster upgrade at 02:00 UTC.");
      assert.strictEqual(bannerRes.body.announcementLevel, "warning");
      assert.strictEqual(bannerRes.body.registrationMode, "invite_only");

      // Dynamic NodeInfo reflects updated instance settings
      const nodeInfoRes = await request(app).get("/nodeinfo/2.0").expect(200);
      assert.strictEqual(nodeInfoRes.body.openRegistrations, false);
      assert.strictEqual(nodeInfoRes.body.metadata.nodeName, "Acme Intranet Modeling Hub");
      assert.strictEqual(nodeInfoRes.body.metadata.federationMode, "allowlist");

      // Create, list, and revoke registration invite code
      const createInviteRes = await request(app)
        .post("/api/v1/admin/invites")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ note: "Propulsion Team", maxUses: 5, expiresInDays: 7 })
        .expect(201);
      assert.ok(createInviteRes.body.invite.code.startsWith("msx-inv-"));

      const listInvitesRes = await request(app)
        .get("/api/v1/admin/invites")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.ok(listInvitesRes.body.invites.some((i: any) => i.id === createInviteRes.body.invite.id));

      await request(app)
        .delete(`/api/v1/admin/invites/${createInviteRes.body.invite.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      // System health diagnostics
      const sysRes = await request(app)
        .get("/api/v1/admin/system")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.strictEqual(sysRes.body.auditChainValid, true);
      assert.ok(sysRes.body.counts.users >= 4);

      // 6. Hot Backup SHA-256, Download, Prune, and Online Point-in-Time Restore
      const backupRes = await request(app)
        .post("/api/v1/admin/backups")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ label: "milestone-test" })
        .expect(201);
      const snapFile = backupRes.body.backup.fileName;
      assert.ok(snapFile);
      assert.strictEqual(typeof backupRes.body.backup.sha256, "string");
      assert.strictEqual(backupRes.body.backup.sha256.length, 64);

      const dlRes = await request(app)
        .get(`/api/v1/admin/backups/${snapFile}/download`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.strictEqual(dlRes.headers["x-backup-sha256"], backupRes.body.backup.sha256);

      // Mutate a setting after backup, then restore from backup and verify setting rolled back
      await request(app)
        .patch("/api/v1/admin/settings")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ instanceName: "Temporary Mutated Name" })
        .expect(200);
      assert.strictEqual(db.getInstanceSettings().instanceName, "Temporary Mutated Name");

      const restoreDbRes = await request(app)
        .post(`/api/v1/admin/backups/${snapFile}/restore`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.strictEqual(restoreDbRes.body.success, true);
      assert.ok(restoreDbRes.body.restoredTables > 0);
      assert.ok(restoreDbRes.body.preRestoreSnapshot.fileName.includes("pre-restore"));
      assert.strictEqual(db.getInstanceSettings().instanceName, "Acme Intranet Modeling Hub");

      // Prune backups
      const pruneBackupsRes = await request(app)
        .post("/api/v1/admin/backups/prune")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ keepLatest: 5 })
        .expect(200);
      assert.strictEqual(pruneBackupsRes.body.success, true);

      // 7. GDPR IP Redaction without breaking SHA-256 Audit Log Hash Chain
      const redactRes = await request(app)
        .post("/api/v1/admin/audit-logs/redact-expired")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ retentionDays: 0 })
        .expect(200);
      assert.strictEqual(redactRes.body.success, true);
      assert.ok(redactRes.body.redactedAuditIps >= 1);

      const row1 = db.db.prepare("SELECT ip_address FROM audit_logs WHERE ip_address IS NOT NULL LIMIT 1").get() as {
        ip_address: string;
      };
      assert.ok(row1.ip_address.startsWith("REDACTED:"), `Expected REDACTED:<token>, got ${row1.ip_address}`);

      // Verify SHA-256 chain is STILL 100% valid after GDPR IP redaction!
      const chainAfterRedact = await request(app)
        .get("/api/v1/admin/audit-logs/verify")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.strictEqual(chainAfterRedact.body.valid, true);
      assert.strictEqual(chainAfterRedact.body.verifiedEntries, chainAfterRedact.body.totalEntries);

      // 8. Registration Policy Enforcement (invite_only) & Invite Code Redemption
      const inviteForSignup = await request(app)
        .post("/api/v1/admin/invites")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          maxUses: 2,
          initialCredits: 300,
          assignedRole: "moderator",
          note: "Moderator onboarding invite",
        })
        .expect(201);
      const signupCode = inviteForSignup.body.invite.code as string;

      // Without inviteCode in invite_only mode -> 403
      await request(app)
        .post("/api/v1/auth/register")
        .send({
          username: "uninvited_eng",
          email: "uninvited@acme.corp",
          password: "StrongPassword123!",
          acceptTerms: true,
          captchaToken: "mock-token",
        })
        .expect(403);

      // With valid inviteCode -> 201, grants initialCredits (300) and assignedRole ('moderator')
      const invitedSignupRes = await request(app)
        .post("/api/v1/auth/register")
        .send({
          username: "invited_mod_eng",
          email: "invited_mod@acme.corp",
          password: "StrongPassword123!",
          acceptTerms: true,
          captchaToken: "mock-token",
          inviteCode: signupCode,
        })
        .expect(201);
      assert.strictEqual(invitedSignupRes.body.user.account_type, "moderator");
      assert.strictEqual(invitedSignupRes.body.user.credit_balance, 300);

      // Restore registrationMode to open for any subsequent tests
      db.updateInstanceSettings({ registrationMode: "open", autoQuarantineReportThreshold: 2 });

      // 9. Automated Report-Threshold Quarantine
      const autoQPost = db.createPost(regularUser.id, "Suspicious spam post triggering auto-quarantine");
      const r1 = db.createContentReport(adminUser.id, {
        postId: autoQPost.id,
        reason: "Automated spam link",
      });
      assert.strictEqual(r1.autoQuarantined, false);
      const r2 = db.createContentReport(modUser.id, {
        postId: autoQPost.id,
        reason: "Automated spam link confirmed",
      });
      assert.strictEqual(r2.autoQuarantined, true);
      assert.strictEqual(db.isResourceQuarantined("post", String(autoQPost.id)), true);

      // 10. User Forensics Dossier Endpoint
      const forensicsRes = await request(app)
        .get(`/api/v1/admin/users/${regularUser.id}/forensics`)
        .set("Authorization", `Bearer ${modToken}`)
        .expect(200);
      assert.strictEqual(forensicsRes.body.user.id, regularUser.id);
      assert.ok(Array.isArray(forensicsRes.body.recentPosts));
      assert.ok(Array.isArray(forensicsRes.body.recentTransactions));
      assert.ok(Array.isArray(forensicsRes.body.recentAuditLogs));

      // 11. Portable Instance Migration Bundle Export & Import + ActivityPub Move Broadcast
      const bundleExportRes = await request(app)
        .get("/api/v1/admin/bundle/export")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.strictEqual(bundleExportRes.body.formatVersion, 1);
      assert.ok(bundleExportRes.body.bundleSha256.length === 64);
      assert.ok(bundleExportRes.body.snapshot.fileName.endsWith(".db"));

      const bundleImportRes = await request(app)
        .post("/api/v1/admin/bundle/import")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          settings: { instanceName: "Restored Bundle Hub" },
          federationDomains: [{ domain: "partner.bundle.org", tier: "allow", reason: "Bundle import peer" }],
        })
        .expect(200);
      assert.strictEqual(bundleImportRes.body.success, true);
      assert.strictEqual(bundleImportRes.body.settingsUpdated, true);
      assert.strictEqual(db.getInstanceSettings().instanceName, "Restored Bundle Hub");

      const moveRes = await request(app)
        .post("/api/v1/admin/federation/move")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          sourceActorUri: "https://old.modelscript.org/users/admin",
          targetActorUri: "https://new.modelscript.org/users/admin",
        })
        .expect(200);
      assert.strictEqual(moveRes.body.success, true);
      assert.strictEqual(moveRes.body.type, "Move");
      assert.ok(moveRes.body.queuedDeliveries >= 1);

      // 12. First-Run Install Wizard (/api/v1/setup/status & /api/v1/setup/complete) on a fresh deployment
      const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-setup-test-"));
      const freshDb = new LibraryDatabase(path.join(freshDir, "db"));
      const freshStorage = new LibraryStorage(path.join(freshDir, "storage"));
      const freshApp = createApp({ database: freshDb, storage: freshStorage });

      try {
        const statusBefore = await request(freshApp).get("/api/v1/setup/status").expect(200);
        assert.strictEqual(statusBefore.body.needsSetup, true);
        assert.strictEqual(statusBefore.body.hasAdmin, false);
        assert.strictEqual(statusBefore.body.setupCompleted, false);
        assert.ok(statusBefore.body.presets.tier1_federated);
        assert.ok(statusBefore.body.presets.tier2_corporate);
        assert.ok(statusBefore.body.presets.tier3_flagship);

        const bannerBefore = await request(freshApp).get("/api/v1/instance/banner").expect(200);
        assert.strictEqual(bannerBefore.body.needsSetup, true);

        const completeRes = await request(freshApp)
          .post("/api/v1/setup/complete")
          .send({
            profileTier: "tier1_federated",
            admin: {
              username: "founding_admin",
              email: "founder@federated.test",
              password: "SuperSecurePassword123!",
              displayName: "Founding Operator",
            },
            settings: {
              instanceName: "Federated Lab Node",
              instanceDescription: "Independent federated ModelScript node",
            },
            initialInvitesCount: 2,
            initialInviteMaxUses: 5,
            initialInviteCredits: 250,
            createInitialBackup: true,
          })
          .expect(201);

        assert.strictEqual(completeRes.body.success, true);
        assert.strictEqual(completeRes.body.setupCompleted, true);
        assert.ok(completeRes.body.token);
        assert.strictEqual(completeRes.body.user.username, "founding_admin");
        assert.strictEqual(completeRes.body.user.account_type, "admin");
        assert.strictEqual(completeRes.body.settings.instanceName, "Federated Lab Node");
        assert.strictEqual(completeRes.body.settings.registrationMode, "invite_only");
        assert.strictEqual(completeRes.body.invites.length, 2);
        assert.ok(completeRes.body.backupSnapshot.fileName.includes("first-boot-baseline"));

        // Verify self-locking: subsequent call to /api/v1/setup/complete is rejected with 403
        await request(freshApp)
          .post("/api/v1/setup/complete")
          .send({
            admin: {
              username: "attacker_admin",
              email: "attacker@federated.test",
              password: "AttackerPassword123!",
            },
          })
          .expect(403);

        const statusAfter = await request(freshApp).get("/api/v1/setup/status").expect(200);
        assert.strictEqual(statusAfter.body.needsSetup, false);
        assert.strictEqual(statusAfter.body.hasAdmin, true);
        assert.strictEqual(statusAfter.body.setupCompleted, true);
        assert.ok(statusAfter.body.preflight);
        assert.ok(Array.isArray(statusAfter.body.preflight.checks));

        // Verify Dev Bar / Admin Re-run Setup Wizard (/api/v1/setup/reset) re-opens wizard and allows re-completion
        const resetRes = await request(freshApp).post("/api/v1/setup/reset").send({}).expect(200);
        assert.strictEqual(resetRes.body.success, true);
        assert.strictEqual(resetRes.body.needsSetup, true);
        assert.strictEqual(resetRes.body.reopened, true);

        const rerunCompleteRes = await request(freshApp)
          .post("/api/v1/setup/complete")
          .send({
            profileTier: "tier2_corporate",
            admin: {
              username: "founding_admin",
              email: "founder@federated.test",
              password: "UpdatedPassword123!",
              displayName: "Re-configured Admin",
            },
            settings: {
              instanceName: "Reconfigured Corporate Appliance",
            },
            initialInvitesCount: 0,
            createInitialBackup: false,
          })
          .expect(201);
        assert.strictEqual(rerunCompleteRes.body.success, true);
        assert.strictEqual(rerunCompleteRes.body.settings.instanceName, "Reconfigured Corporate Appliance");
        assert.strictEqual(freshDb.getSetupStatus().needsSetup, false);
      } finally {
        freshDb.db.close();
        fs.rmSync(freshDir, { recursive: true, force: true });
      }

      // 13. Pillar 1: Preflight Checks, Outbound Mailer Test & .env / Docker Config Export
      const sysInfoRes = await request(app)
        .get("/api/v1/admin/system")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.ok(sysInfoRes.body.preflight);
      assert.ok(sysInfoRes.body.preflight.checks.some((c: { id: string }) => c.id === "sqlite_wal"));

      const testEmailRes = await request(app)
        .post("/api/v1/admin/system/test-email")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ recipientEmail: "ops-verify@acme.corp" })
        .expect(200);
      assert.strictEqual(testEmailRes.body.success, true);
      assert.strictEqual(testEmailRes.body.recipient, "ops-verify@acme.corp");

      const exportEnvRes = await request(app)
        .get("/api/v1/admin/settings/export-env")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.ok(exportEnvRes.body.envSnippet.includes("MODELSCRIPT_REGISTRATION_MODE="));
      assert.ok(exportEnvRes.body.dockerComposeSnippet.includes("services:"));

      // 14. Pillar 2: External .db Snapshot Upload & Integrity Verification
      await request(app)
        .post("/api/v1/admin/backups/upload")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ fileBase64: Buffer.from("not a valid sqlite file").toString("base64") })
        .expect(400);

      const snapshotToUpload = db.createHotBackup("upload-source");
      const rawSnapshotBytes = fs.readFileSync(snapshotToUpload.backupPath);
      const uploadBackupRes = await request(app)
        .post("/api/v1/admin/backups/upload")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          fileBase64: rawSnapshotBytes.toString("base64"),
          label: "external-upload-test",
          restoreImmediately: false,
        })
        .expect(201);
      assert.strictEqual(uploadBackupRes.body.success, true);
      assert.ok(uploadBackupRes.body.backup.fileName.includes("external-upload-test"));
      assert.strictEqual(uploadBackupRes.body.backup.sha256.length, 64);

      // 15. Pillar 3: Multi-Tiered Maintenance Mode (read_only & lockdown) 503 Enforcement & Admin Sudo Step-Up
      const futureEta = new Date(Date.now() + 600 * 1000).toISOString();
      db.updateInstanceSettings({
        maintenanceMode: true,
        maintenanceLevel: "read_only",
        maintenanceEta: futureEta,
      });
      const maintRejectRes = await request(app)
        .post("/api/v1/social/posts")
        .set("Authorization", `Bearer ${regularToken}`)
        .send({ content: "Should be blocked during maintenance" })
        .expect(503);
      assert.strictEqual(maintRejectRes.body.maintenanceMode, true);
      assert.strictEqual(maintRejectRes.body.maintenanceLevel, "read_only");
      assert.strictEqual(maintRejectRes.body.maintenanceEta, futureEta);
      assert.strictEqual(maintRejectRes.headers["x-modelscript-maintenance"], "read_only");
      assert.ok(Number(maintRejectRes.headers["retry-after"]) > 300);

      // In read_only mode, GET requests to API still succeed for public users
      await request(app).get("/api/v1/libraries").expect(200);

      // Escalate to 'lockdown' mode -> blocks non-admin GET requests to API routes while exempting /api/v1/instance/banner & admins
      db.updateInstanceSettings({ maintenanceLevel: "lockdown" });
      const lockdownGetRes = await request(app)
        .get("/api/v1/libraries")
        .set("Authorization", `Bearer ${regularToken}`)
        .expect(503);
      assert.strictEqual(lockdownGetRes.body.maintenanceLevel, "lockdown");

      // Public banner endpoint remains accessible during lockdown and reports subsystem telemetry
      const lockdownBannerRes = await request(app).get("/api/v1/instance/banner").expect(200);
      assert.strictEqual(lockdownBannerRes.body.maintenanceLevel, "lockdown");
      assert.strictEqual(lockdownBannerRes.body.subsystems.coreApi, "maintenance");
      assert.strictEqual(lockdownBannerRes.body.subsystems.wasmSandbox, "operational");

      // Admins bypass lockdown on both GET and PATCH
      await request(app).get("/api/v1/libraries").set("Authorization", `Bearer ${adminToken}`).expect(200);

      await request(app)
        .patch("/api/v1/admin/settings")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ maintenanceMode: false, maintenanceEta: "" })
        .expect(200);
      assert.strictEqual(db.getInstanceSettings().maintenanceLevel, "off");

      // Sudo verification (wrong password -> 401, right password -> 200)
      await request(app)
        .post("/api/v1/admin/sudo/verify")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ password: "WrongPassword!" })
        .expect(401);

      const sudoOkRes = await request(app)
        .post("/api/v1/admin/sudo/verify")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ password: "hash456" })
        .expect(200);
      assert.strictEqual(sudoOkRes.body.success, true);
      assert.ok(sudoOkRes.body.sudoToken);

      // 16. Pillar 4: Automated Keyword/Regex Content Filter, Federation Circuit Breaker & Custom Legal Markdown
      await request(app)
        .patch("/api/v1/admin/settings")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          autoFilterKeywords: ["crypto airdrop", "/export-restricted-itar/i"],
          autoFilterAction: "cw",
          customTermsMarkdown: "# Custom Corporate Terms",
          customPrivacyMarkdown: "# Custom Corporate Privacy",
        })
        .expect(200);

      const filteredPost = db.createPost(regularUser.id, "Check out this crypto airdrop simulation");
      assert.strictEqual(filteredPost.is_sensitive, 1);
      assert.ok(filteredPost.content_warning?.includes("Automated filter match"));

      // Test regex quarantine filter action
      db.updateInstanceSettings({ autoFilterAction: "quarantine" });
      const regexPost = db.createPost(regularUser.id, " blueprints for EXPORT-RESTRICTED-ITAR nozzle");
      assert.strictEqual(db.isResourceQuarantined("post", String(regexPost.id)), true);
      db.updateInstanceSettings({ autoFilterKeywords: [], autoFilterAction: "cw" });

      // Custom legal markdown exposed in public banner
      const bannerLegalRes = await request(app).get("/api/v1/instance/banner").expect(200);
      assert.strictEqual(bannerLegalRes.body.customTermsMarkdown, "# Custom Corporate Terms");
      assert.strictEqual(bannerLegalRes.body.customPrivacyMarkdown, "# Custom Corporate Privacy");

      // Federation Domain Health & 1-Click Circuit Breaker
      db.enqueueFederationDelivery(
        "Create",
        "https://hub.modelscript.org/activities/999",
        { type: "Create" },
        "https://dead-peer.example/inbox",
        "dead-peer.example",
      );
      const fedHealthRes = await request(app)
        .get("/api/v1/admin/federation/health")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.ok(fedHealthRes.body.domains.some((d: { domain: string }) => d.domain === "dead-peer.example"));

      const circuitBreakRes = await request(app)
        .post("/api/v1/admin/federation/circuit-break")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ domain: "dead-peer.example", tier: "suspend", reason: "Dead peer circuit breaker test" })
        .expect(200);
      assert.strictEqual(circuitBreakRes.body.success, true);
      assert.strictEqual(circuitBreakRes.body.tier, "suspend");
      assert.ok(circuitBreakRes.body.purgedDeliveries >= 1);

      // 17. Pillar 5: Prometheus /api/v1/admin/metrics & Redacted Support Bundle
      const metricsRes = await request(app)
        .get("/api/v1/admin/metrics")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.ok(metricsRes.text.includes("modelscript_users_total"));
      assert.ok(metricsRes.text.includes("modelscript_audit_chain_valid 1"));

      const supportBundleRes = await request(app)
        .get("/api/v1/admin/system/support-bundle")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.ok(supportBundleRes.body.preflight);
      assert.strictEqual(supportBundleRes.body.auditChain.valid, true);
      assert.strictEqual(supportBundleRes.body.environment.JWT_SECRET, "[REDACTED]");

      // 18. Pillar 6: White-Label Branding & Ansatz Identity Configuration
      const brandingPatchRes = await request(app)
        .patch("/api/v1/admin/settings")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          instanceName: "ETH Aero Lab",
          instanceBadge: "Lab",
          instanceTagline: "ETH Zurich Propulsion & Fluid Dynamics Network",
          brandLogoUrl: "https://aero.ethz.ch/logo.svg",
          brandLogoDarkUrl: "https://aero.ethz.ch/logo-dark.svg",
          brandFaviconUrl: "https://aero.ethz.ch/favicon.ico",
          brandAccentColor: "#10b981",
          docsBaseUrl: "https://modelscript.org",
          showPoweredBy: true,
        })
        .expect(200);

      assert.strictEqual(brandingPatchRes.body.settings.instanceName, "ETH Aero Lab");
      assert.strictEqual(brandingPatchRes.body.settings.instanceBadge, "Lab");
      assert.strictEqual(
        brandingPatchRes.body.settings.instanceTagline,
        "ETH Zurich Propulsion & Fluid Dynamics Network",
      );
      assert.strictEqual(brandingPatchRes.body.settings.brandLogoUrl, "https://aero.ethz.ch/logo.svg");
      assert.strictEqual(brandingPatchRes.body.settings.brandLogoDarkUrl, "https://aero.ethz.ch/logo-dark.svg");
      assert.strictEqual(brandingPatchRes.body.settings.brandFaviconUrl, "https://aero.ethz.ch/favicon.ico");
      assert.strictEqual(brandingPatchRes.body.settings.brandAccentColor, "#10b981");
      assert.strictEqual(brandingPatchRes.body.settings.docsBaseUrl, "https://modelscript.org");
      assert.strictEqual(brandingPatchRes.body.settings.showPoweredBy, true);

      const bannerBrandRes = await request(app).get("/api/v1/instance/banner").expect(200);
      assert.strictEqual(bannerBrandRes.body.instanceName, "ETH Aero Lab");
      assert.strictEqual(bannerBrandRes.body.instanceBadge, "Lab");
      assert.strictEqual(bannerBrandRes.body.instanceTagline, "ETH Zurich Propulsion & Fluid Dynamics Network");
      assert.strictEqual(bannerBrandRes.body.brandLogoUrl, "https://aero.ethz.ch/logo.svg");
      assert.strictEqual(bannerBrandRes.body.brandAccentColor, "#10b981");
      assert.strictEqual(bannerBrandRes.body.showPoweredBy, true);

      const envBrandRes = await request(app)
        .get("/api/v1/admin/settings/export-env")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      assert.ok(envBrandRes.body.envSnippet.includes('MSX_INSTANCE_NAME="ETH Aero Lab"'));
      assert.ok(envBrandRes.body.envSnippet.includes('MSX_INSTANCE_BADGE="Lab"'));
      assert.ok(envBrandRes.body.envSnippet.includes('MSX_BRAND_ACCENT_COLOR="#10b981"'));
    },
  );
});

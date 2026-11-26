// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
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
import { hasMatchingOrcidResearcherUrl, hasMatchingRelMeTag, isValidOrcidChecksum } from "../src/routes/users.js";
import { generateTotpCode, generateTotpSecret } from "../src/util/totp.js";

test("Phase 4 Federation & Privacy Hardening: rel=me, ORCID, Move re-auth, and Federated Unblock/Unmute", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-phase4-fed-privacy-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  const passwordPlain = "SuperSecretPass!2026";
  const passwordHash = await bcrypt.hash(passwordPlain, 10);
  const user = db.createUser("elena", "elena@modelscript.test", passwordHash, { emailVerified: true });
  const userToken = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET);

  await t.test("rel='me' verification rejects split tags and accepts single matching <a>/<link> tag", async () => {
    const profileUrl = "https://hub.example.org/@elena";
    const actorUrl = "https://hub.example.org/users/elena";
    const targets = [profileUrl, actorUrl];

    // Separate tags: one has rel="me", another has the profile URL -> MUST FAIL
    const splitHtml = `
      <html>
        <body>
          <a rel="me" href="https://other.example.net/elena">Other</a>
          <a href="${profileUrl}">My Profile</a>
        </body>
      </html>
    `;
    assert.strictEqual(hasMatchingRelMeTag(splitHtml, targets), false);

    // Non-token rel="home" -> MUST FAIL
    const nonTokenHtml = `<a rel="home" href="${profileUrl}">Profile</a>`;
    assert.strictEqual(hasMatchingRelMeTag(nonTokenHtml, targets), false);

    // Spoofed redirect query param -> MUST FAIL
    const spoofedHtml = `<a rel="me" href="https://evil.example.com/?next=${profileUrl}">Spoof</a>`;
    assert.strictEqual(hasMatchingRelMeTag(spoofedHtml, targets), false);

    // Single <a> tag with rel="me" and matching href -> MUST PASS
    const validAnchorHtml = `<a rel="noopener me noreferrer" href="${profileUrl}/">Elena</a>`;
    assert.strictEqual(hasMatchingRelMeTag(validAnchorHtml, targets), true);

    // Single <link> tag with rel="me" and matching actorUrl -> MUST PASS
    const validLinkHtml = `<head><link href='${actorUrl}' rel='me'></head>`;
    assert.strictEqual(hasMatchingRelMeTag(validLinkHtml, targets), true);

    // End-to-end HTTP test via POST /api/v1/users/me/verify-fields with mocked fetch
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === "https://93.184.216.34/split") {
          return new Response(
            `<html><a rel="me" href="https://unrelated.example/">Me</a><a href="https://hub.example.org/@elena">Profile</a></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          );
        }
        if (url === "https://93.184.216.34/valid") {
          return new Response(`<html><a rel="me" href="https://hub.example.org/@elena">Profile</a></html>`, {
            status: 200,
            headers: { "Content-Type": "text/html" },
          });
        }
        return new Response("Not Found", { status: 404 });
      }) as typeof fetch;

      const res = await request(app)
        .post("/api/v1/users/me/verify-fields")
        .set("Authorization", `Bearer ${userToken}`)
        .set("Origin", "https://hub.example.org")
        .send({
          profile_fields: [
            { name: "SplitSite", value: "https://93.184.216.34/split" },
            { name: "ValidSite", value: "https://93.184.216.34/valid" },
          ],
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const splitField = res.body.profile_fields.find((f: { name: string }) => f.name === "SplitSite");
      const validField = res.body.profile_fields.find((f: { name: string }) => f.name === "ValidSite");
      assert.strictEqual(splitField.verified_at, null);
      assert.ok(typeof validField.verified_at === "string" && validField.verified_at.length > 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("ORCID verification enforces ISO 7064 (MOD 11-2) checksum and requires backlink", async () => {
    // Valid ISO 7064 checksums (including X check digit)
    assert.strictEqual(isValidOrcidChecksum("0000-0002-1825-0097"), true);
    assert.strictEqual(isValidOrcidChecksum("0000-0001-5109-3700"), true);
    assert.strictEqual(isValidOrcidChecksum("0000-0002-1694-233X"), true);

    // Invalid checksums / malformed strings
    assert.strictEqual(isValidOrcidChecksum("0000-0002-1825-0098"), false);
    assert.strictEqual(isValidOrcidChecksum("0000-0000-0000-0000"), false);
    assert.strictEqual(isValidOrcidChecksum("0000-0002-1694-2339"), false);
    assert.strictEqual(isValidOrcidChecksum("not-an-orcid"), false);

    // Researcher-URL JSON matching helper
    assert.strictEqual(
      hasMatchingOrcidResearcherUrl({ "researcher-url": [{ url: { value: "https://hub.example.org/@elena" } }] }, [
        "https://hub.example.org/@elena",
      ]),
      true,
    );
    assert.strictEqual(
      hasMatchingOrcidResearcherUrl({ "researcher-url": [{ url: { value: "https://someone-else.org/@elena" } }] }, [
        "https://hub.example.org/@elena",
      ]),
      false,
    );

    // Endpoint test: invalid checksum and valid checksum without backlink must NOT auto-verify
    const originalFetch = globalThis.fetch;
    let fetchedUrls: string[] = [];
    try {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        fetchedUrls.push(url);
        if (url.includes("/researcher-urls")) {
          return new Response(JSON.stringify({ "researcher-url": [{ url: { value: "https://other.edu/" } }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("<html><body>No backlink here</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }) as typeof fetch;

      const res = await request(app)
        .post("/api/v1/users/me/verify-fields")
        .set("Authorization", `Bearer ${userToken}`)
        .set("Origin", "https://hub.example.org")
        .send({
          profile_fields: [
            { name: "InvalidORCID", value: "0000-0002-1825-0098" },
            { name: "UnlinkedORCID", value: "0000-0002-1825-0097" },
          ],
        });

      assert.strictEqual(res.status, 200);
      const invalidField = res.body.profile_fields.find((f: { name: string }) => f.name === "InvalidORCID");
      const unlinkedField = res.body.profile_fields.find((f: { name: string }) => f.name === "UnlinkedORCID");
      assert.strictEqual(invalidField.verified_at, null);
      assert.strictEqual(unlinkedField.verified_at, null);
      // Invalid checksum ORCID must not trigger outbound fetch
      assert.strictEqual(
        fetchedUrls.some((u) => u.includes("0000-0002-1825-0098")),
        false,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test(
    "POST /api/v1/users/me/move requires password, TOTP (when enabled), or SSO username confirmation",
    async () => {
      const targetActorUrl = "https://new-instance.example.org/users/elena_new";

      // 1. Missing password -> 400
      const missingPwdRes = await request(app)
        .post("/api/v1/users/me/move")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ targetActorUrl });
      assert.strictEqual(missingPwdRes.status, 400);

      // 2. Wrong password -> 401
      const wrongPwdRes = await request(app)
        .post("/api/v1/users/me/move")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ targetActorUrl, password: "WrongPassword123" });
      assert.strictEqual(wrongPwdRes.status, 401);

      // 3. Valid password -> 200
      const validPwdRes = await request(app)
        .post("/api/v1/users/me/move")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ targetActorUrl, password: passwordPlain });
      assert.strictEqual(validPwdRes.status, 200);
      assert.strictEqual(validPwdRes.body.success, true);
      assert.strictEqual(validPwdRes.body.movedToActorUrl, targetActorUrl);

      // 4. User with 2FA enabled: missing or wrong TOTP -> 401; valid password + valid TOTP -> 200
      const twoFaPwd = "TwoFaSecret!2026";
      const twoFaHash = await bcrypt.hash(twoFaPwd, 10);
      const twoFaUser = db.createUser("marcus", "marcus@modelscript.test", twoFaHash, { emailVerified: true });
      const totpSecret = generateTotpSecret();
      db.enableUser2FA(twoFaUser.id, totpSecret, []);
      const twoFaToken = jwt.sign(
        { id: twoFaUser.id, username: twoFaUser.username, email: twoFaUser.email },
        JWT_SECRET,
      );

      const missingTotpRes = await request(app)
        .post("/api/v1/users/me/move")
        .set("Authorization", `Bearer ${twoFaToken}`)
        .send({ targetActorUrl: "https://new-instance.example.org/users/marcus", password: twoFaPwd });
      assert.strictEqual(missingTotpRes.status, 401);

      const wrongTotpRes = await request(app)
        .post("/api/v1/users/me/move")
        .set("Authorization", `Bearer ${twoFaToken}`)
        .send({
          targetActorUrl: "https://new-instance.example.org/users/marcus",
          password: twoFaPwd,
          totpCode: "000000",
        });
      assert.strictEqual(wrongTotpRes.status, 401);

      const validTotpCode = generateTotpCode(totpSecret);
      const validTwoFaRes = await request(app)
        .post("/api/v1/users/me/move")
        .set("Authorization", `Bearer ${twoFaToken}`)
        .send({
          targetActorUrl: "https://new-instance.example.org/users/marcus",
          password: twoFaPwd,
          totpCode: validTotpCode,
        });
      assert.strictEqual(validTwoFaRes.status, 200);
      assert.strictEqual(validTwoFaRes.body.success, true);

      // 5. SSO-only user (no password_hash, no 2FA): requires confirmUsername
      const ssoUser = db.createUser("sso_nina", "nina@sso.test", "", { emailVerified: true });
      db.db.prepare("UPDATE users SET password_hash = NULL WHERE id = ?").run(ssoUser.id);
      const ssoToken = jwt.sign({ id: ssoUser.id, username: ssoUser.username, email: ssoUser.email }, JWT_SECRET);

      const missingConfirmRes = await request(app)
        .post("/api/v1/users/me/move")
        .set("Authorization", `Bearer ${ssoToken}`)
        .send({ targetActorUrl: "https://new-instance.example.org/users/nina" });
      assert.strictEqual(missingConfirmRes.status, 400);

      const validConfirmRes = await request(app)
        .post("/api/v1/users/me/move")
        .set("Authorization", `Bearer ${ssoToken}`)
        .send({ targetActorUrl: "https://new-instance.example.org/users/nina", confirmUsername: "sso_nina" });
      assert.strictEqual(validConfirmRes.status, 200);
      assert.strictEqual(validConfirmRes.body.success, true);
    },
  );

  await t.test("DELETE /api/v1/users/:username/block and /mute target exact user by userId", async () => {
    const localAlice = db.createUser("alice_local", "alice.local@modelscript.test", passwordHash, {
      emailVerified: true,
    });
    const remoteAlice = db.createUser("alice_remote", "alice.remote@fed.example", passwordHash, {
      emailVerified: true,
    });
    db.db
      .prepare("UPDATE users SET remote_domain = ?, actor_url = ? WHERE id = ?")
      .run("fed.example", "https://fed.example/users/alice_remote", remoteAlice.id);

    // Block and mute both users
    db.blockUser(user.id, localAlice.id);
    db.blockUser(user.id, remoteAlice.id);
    db.muteUser(user.id, localAlice.id);
    db.muteUser(user.id, remoteAlice.id);

    // Unblock remoteAlice using localAlice's username in the path but remoteAlice.id in ?userId=
    // This proves userId takes precedence and targets the exact user ID.
    const unblockRes = await request(app)
      .delete(`/api/v1/users/${localAlice.username}/block?userId=${remoteAlice.id}`)
      .set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(unblockRes.status, 200);
    assert.strictEqual(unblockRes.body.blocked, false);

    const blockedAfter = db.getBlockedUsersDetailed(user.id);
    assert.strictEqual(blockedAfter.length, 1);
    assert.strictEqual(blockedAfter[0]!.id, localAlice.id);

    // Unmute remoteAlice using localAlice's username in path + remoteAlice.id in ?userId=
    const unmuteRes = await request(app)
      .delete(`/api/v1/users/${localAlice.username}/mute?userId=${remoteAlice.id}`)
      .set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(unmuteRes.status, 200);
    assert.strictEqual(unmuteRes.body.muted, false);

    const mutedAfter = db.getMutedUsersDetailed(user.id);
    assert.strictEqual(mutedAfter.length, 1);
    assert.strictEqual(mutedAfter[0]!.id, localAlice.id);

    // Also verify username@remote_domain resolution works without userId
    db.blockUser(user.id, remoteAlice.id);
    const unblockByHandleRes = await request(app)
      .delete(`/api/v1/users/${encodeURIComponent("alice_remote@fed.example")}/block`)
      .set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(unblockByHandleRes.status, 200);
    assert.strictEqual(
      db.getBlockedUsersDetailed(user.id).some((u) => u.id === remoteAlice.id),
      false,
    );
  });
});

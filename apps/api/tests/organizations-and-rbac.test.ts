// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
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

function createMockZip(name: string, version: string): Buffer {
  const zip = new AdmZip();
  const baseName = name.includes("/") ? name.split("/")[1] : name;
  const packageMo = `
package ${baseName}
  annotation(version="${version}");
  parameter Real param1 = 42.0;
end ${baseName};
  `.trim();
  zip.addFile("package.mo", Buffer.from(packageMo, "utf-8"));
  zip.addFile(`${baseName}/package.mo`, Buffer.from(packageMo, "utf-8"));
  return zip.toBuffer();
}

test("Organizations, Scoped Namespaces & Package Collaborators RBAC", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rbac-test-"));
  const dbDir = path.join(tmpDir, "db");
  const storageDir = path.join(tmpDir, "storage");
  fs.mkdirSync(dbDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });

  const db = new LibraryDatabase(dbDir);
  const storage = new LibraryStorage(storageDir);
  const app = createApp({ database: db, storage });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  const alice = db.createUser("alice", "alice@example.com", "hash", { emailVerified: true });
  const bob = db.createUser("bob", "bob@example.com", "hash", { emailVerified: true });
  const charlie = db.createUser("charlie", "charlie@example.com", "hash", { emailVerified: true });
  const eve = db.createUser("eve", "eve@example.com", "hash", { emailVerified: true });

  const aliceToken = jwt.sign({ id: alice.id, username: alice.username }, JWT_SECRET);
  const bobToken = jwt.sign({ id: bob.id, username: bob.username }, JWT_SECRET);
  const charlieToken = jwt.sign({ id: charlie.id, username: charlie.username }, JWT_SECRET);
  const eveToken = jwt.sign({ id: eve.id, username: eve.username }, JWT_SECRET);

  await t.test("Alice creates organization 'acme'", async () => {
    const res = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        slug: "acme",
        name: "Acme Aerospace",
        description: "Physical modeling components for flight simulation",
      })
      .expect(201);

    assert.strictEqual(res.body.organization.slug, "acme");
    assert.strictEqual(res.body.organization.name, "Acme Aerospace");

    // Alice is automatically owner
    const membersRes = await request(app).get("/api/v1/organizations/acme/members").expect(200);
    assert.strictEqual(membersRes.body.members.length, 1);
    assert.strictEqual(membersRes.body.members[0].username, "alice");
    assert.strictEqual(membersRes.body.members[0].role, "owner");
  });

  await t.test("Cannot create duplicate organization or clash with user username", async () => {
    // Duplicate slug
    await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${bobToken}`)
      .send({ slug: "acme", name: "Acme Clone" })
      .expect(409);

    // Clash with existing user 'alice'
    await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${bobToken}`)
      .send({ slug: "alice", name: "Alice Fake Org" })
      .expect(409);
  });

  await t.test("Alice manages Acme organization members (Bob=maintainer, Charlie=contributor)", async () => {
    // Alice adds Bob as maintainer
    await request(app)
      .post("/api/v1/organizations/acme/members")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ username: "bob", role: "maintainer" })
      .expect(200);

    // Alice adds Charlie as contributor
    await request(app)
      .post("/api/v1/organizations/acme/members")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ username: "charlie", role: "contributor" })
      .expect(200);

    // Unauthorized non-member Eve cannot add members
    await request(app)
      .post("/api/v1/organizations/acme/members")
      .set("Authorization", `Bearer ${eveToken}`)
      .send({ username: "eve", role: "owner" })
      .expect(403);

    const membersRes = await request(app).get("/api/v1/organizations/acme/members").expect(200);
    assert.strictEqual(membersRes.body.members.length, 3);
  });

  await t.test("Organization Scoped Publishing: Owners & Maintainers can publish, Contributors cannot", async () => {
    const pkgName = "@acme/turbopump";
    const zip100 = createMockZip(pkgName, "1.0.0");
    const zip110 = createMockZip(pkgName, "1.1.0");
    const zip120 = createMockZip(pkgName, "1.2.0");

    // 1. Alice (owner) publishes @acme/turbopump@1.0.0
    await request(app)
      .post(`/api/v1/libraries/@acme/turbopump/1.0.0`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .attach("file", zip100, "library.zip")
      .expect(201);

    // 2. Bob (maintainer) publishes @acme/turbopump@1.1.0
    await request(app)
      .post(`/api/v1/libraries/@acme/turbopump/1.1.0`)
      .set("Authorization", `Bearer ${bobToken}`)
      .attach("file", zip110, "library.zip")
      .expect(201);

    // 3. Charlie (contributor) cannot publish @acme/turbopump@1.2.0
    await request(app)
      .post(`/api/v1/libraries/@acme/turbopump/1.2.0`)
      .set("Authorization", `Bearer ${charlieToken}`)
      .attach("file", zip120, "library.zip")
      .expect(403);

    // 4. Eve (non-member) cannot publish under @acme namespace
    const eveZip = createMockZip("@acme/malicious", "1.0.0");
    await request(app)
      .post(`/api/v1/libraries/@acme/malicious/1.0.0`)
      .set("Authorization", `Bearer ${eveToken}`)
      .attach("file", eveZip, "library.zip")
      .expect(403);
  });

  await t.test("User-Scoped Publishing & Collaborators RBAC", async () => {
    const pkgName = "@alice/controller";
    const zip100 = createMockZip(pkgName, "1.0.0");
    const zip110 = createMockZip(pkgName, "1.1.0");

    // 1. Bob cannot publish to @alice namespace
    await request(app)
      .post(`/api/v1/libraries/@alice/controller/1.0.0`)
      .set("Authorization", `Bearer ${bobToken}`)
      .attach("file", zip100, "library.zip")
      .expect(403);

    // 2. Alice publishes @alice/controller@1.0.0
    await request(app)
      .post(`/api/v1/libraries/@alice/controller/1.0.0`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .attach("file", zip100, "library.zip")
      .expect(201);

    // 3. Bob still cannot publish 1.1.0 because he is not a collaborator
    await request(app)
      .post(`/api/v1/libraries/@alice/controller/1.1.0`)
      .set("Authorization", `Bearer ${bobToken}`)
      .attach("file", zip110, "library.zip")
      .expect(403);

    // 4. Alice adds Bob as collaborator with write permission
    await request(app)
      .post(`/api/v1/libraries/@alice/controller/collaborators`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ username: "bob", permission: "write" })
      .expect(200);

    const collabRes = await request(app).get(`/api/v1/libraries/@alice/controller/collaborators`).expect(200);
    assert.strictEqual(collabRes.body.collaborators.length, 1);
    assert.strictEqual(collabRes.body.collaborators[0].username, "bob");
    assert.strictEqual(collabRes.body.collaborators[0].permission, "write");

    // 5. Bob can now publish @alice/controller@1.1.0
    await request(app)
      .post(`/api/v1/libraries/@alice/controller/1.1.0`)
      .set("Authorization", `Bearer ${bobToken}`)
      .attach("file", zip110, "library.zip")
      .expect(201);

    // 6. Alice removes Bob from collaborators
    await request(app)
      .delete(`/api/v1/libraries/@alice/controller/collaborators/${bob.id}`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(200);

    // 7. Bob can no longer publish 1.2.0
    const zip120 = createMockZip(pkgName, "1.2.0");
    await request(app)
      .post(`/api/v1/libraries/@alice/controller/1.2.0`)
      .set("Authorization", `Bearer ${bobToken}`)
      .attach("file", zip120, "library.zip")
      .expect(403);
  });
});

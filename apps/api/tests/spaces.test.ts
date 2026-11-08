// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import jwt from "jsonwebtoken";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";
import { WebSocket } from "ws";

process.env["NODE_ENV"] = "test";

import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET, setAuthDatabase } from "../src/middleware/auth-middleware.js";
import { attachCollabWebSocket } from "../src/routes/collab-ws.js";
import { organizationsRouter } from "../src/routes/organizations.js";
import { spacesRouter } from "../src/routes/spaces.js";

test("Ansatz Spaces, Polymorphic Containers, Living Docs, PLM ECOs & Slack-Style Chat", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-spaces-test-"));
  const gitDir = path.join(tmpDir, "git-repos");
  process.env["GIT_REPOS_DIR"] = gitDir;

  const db = new LibraryDatabase(tmpDir);
  setAuthDatabase(db);

  // Seed test users in users table
  db.db
    .prepare(
      `INSERT OR IGNORE INTO users (id, username, email, password_hash, display_name, account_type)
       VALUES (1, 'engineer', 'engineer@modelscript.org', 'hash', 'Lead Engineer', 'admin'),
              (2, 'reviewer', 'reviewer@modelscript.org', 'hash', 'Chief Reviewer', 'user')`,
    )
    .run();

  const engineerToken = jwt.sign(
    {
      id: 1,
      username: "engineer",
      email: "engineer@modelscript.org",
      role: "admin",
      accountType: "admin",
    },
    JWT_SECRET,
  );

  const app = express();
  app.use(express.json());
  app.use("/api/v1/organizations", organizationsRouter(db));
  app.use("/api/v1/spaces", spacesRouter(db));

  const server = http.createServer(app);
  attachCollabWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };

  t.after(() => {
    try {
      server.closeAllConnections?.();
      server.close();
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test("1. Domain Blueprints: returns all 7 industry domain presets covering 68 languages", async () => {
    const res = await request(app).get("/api/v1/spaces/presets").expect(200);
    assert.ok(Array.isArray(res.body.presets));
    assert.equal(res.body.presets.length, 7);

    const allLangs = new Set<string>();
    for (const preset of res.body.presets) {
      for (const lang of preset.languages) {
        allLangs.add(lang);
      }
      assert.ok(preset.defaultChannels.length >= 3);
      assert.ok(preset.starterDocs.length >= 1);
    }
    assert.ok(allLangs.size >= 60, `Expected at least 60 polyglot languages, got ${allLangs.size}`);
  });

  await t.test("2. Personal Space Creation under User Profile (@engineer/evtol-lab)", async () => {
    const createRes = await request(app)
      .post("/api/v1/spaces")
      .set("Authorization", `Bearer ${engineerToken}`)
      .send({
        ownerType: "user",
        slug: "evtol-lab",
        name: "eVTOL Flight Dynamics Lab",
        tagline: "6-DOF flight control, CAD airframe & thermal battery loop",
        domainPreset: "aerospace_cad",
        visibility: "public",
      })
      .expect(201);

    assert.equal(createRes.body.space.owner_type, "user");
    assert.equal(createRes.body.space.owner_namespace, "engineer");
    assert.equal(createRes.body.space.slug, "evtol-lab");
    assert.equal(createRes.body.space.domain_preset, "aerospace_cad");
    assert.ok(createRes.body.channels.length >= 4);
    assert.ok(createRes.body.pages.length >= 1);

    // Verify bare Git Vault was provisioned on disk
    const bareRepoDir = path.join(gitDir, "engineer", "evtol-lab.git");
    assert.ok(fs.existsSync(bareRepoDir), "Bare Git vault should exist on disk");

    // Verify GET /api/v1/spaces/@engineer/evtol-lab works with @ prefix
    const detailRes = await request(app)
      .get("/api/v1/spaces/@engineer/evtol-lab")
      .set("Authorization", `Bearer ${engineerToken}`)
      .expect(200);
    assert.equal(detailRes.body.space.name, "eVTOL Flight Dynamics Lab");
    assert.equal(detailRes.body.viewerState.role, "owner");
  });

  await t.test(
    "3. Organization Container Creation (@acme-power) & Organization Space (@acme-power/ieee-39-bus)",
    async () => {
      const orgRes = await request(app)
        .post("/api/v1/organizations")
        .set("Authorization", `Bearer ${engineerToken}`)
        .send({
          slug: "acme-power",
          name: "Acme Power Grid Corp",
          description: "WECC & IEEE transmission grid EMT protection models",
        })
        .expect(201);

      assert.equal(orgRes.body.organization.slug, "acme-power");

      // Create Space inside @acme-power organization container
      const spaceRes = await request(app)
        .post("/api/v1/spaces")
        .set("Authorization", `Bearer ${engineerToken}`)
        .send({
          ownerType: "organization",
          organizationSlug: "acme-power",
          slug: "ieee-39-bus",
          name: "IEEE 39-Bus New England Grid",
          tagline: "PSCAD, PSS/E, OpenDSS & Modelica EMT digital twin",
          domainPreset: "power_rf_grid",
          visibility: "public",
        })
        .expect(201);

      assert.equal(spaceRes.body.space.owner_type, "organization");
      assert.equal(spaceRes.body.space.owner_namespace, "acme-power");

      // Verify organization detail returns nested spaces
      const getOrgRes = await request(app)
        .get("/api/v1/organizations/acme-power")
        .set("Authorization", `Bearer ${engineerToken}`)
        .expect(200);
      assert.equal(getOrgRes.body.spaces.length, 1);
      assert.equal(getOrgRes.body.spaces[0].slug, "ieee-39-bus");

      // Verify polymorphic namespace resolver
      const resolveUser = await request(app).get("/api/v1/spaces/resolve-namespace/@engineer").expect(200);
      assert.equal(resolveUser.body.kind, "user");
      assert.equal(resolveUser.body.user.username, "engineer");

      const resolveOrg = await request(app).get("/api/v1/spaces/resolve-namespace/@acme-power").expect(200);
      assert.equal(resolveOrg.body.kind, "organization");
      assert.equal(resolveOrg.body.organization.name, "Acme Power Grid Corp");
    },
  );

  await t.test("4. Living Docs CMS CRUD inside Space", async () => {
    const saveRes = await request(app)
      .post("/api/v1/spaces/acme-power/ieee-39-bus/docs")
      .set("Authorization", `Bearer ${engineerToken}`)
      .send({
        slug: "nerc-cip-checklist",
        title: "NERC CIP Protection Relay Checklist",
        summary: "Relay coordination thresholds for Bus 14",
        contentMarkdown: "# NERC CIP Checklist\n\nVerify frequency relay trip at `59.3 Hz`.",
      })
      .expect(201);

    assert.equal(saveRes.body.page.slug, "nerc-cip-checklist");

    const listRes = await request(app).get("/api/v1/spaces/acme-power/ieee-39-bus/docs").expect(200);
    assert.ok(listRes.body.pages.some((p: { slug: string }) => p.slug === "nerc-cip-checklist"));
  });

  await t.test(
    "5. Real-Time Slack/Discord-Style Chat, /run Bot, Reactions, Promotion & WebSocket Broadcast",
    async () => {
      // Get channels to know channel.id for WebSocket subscription
      const channelsRes = await request(app).get("/api/v1/spaces/acme-power/ieee-39-bus/channels").expect(200);
      const generalChannel = channelsRes.body.channels.find((c: { slug: string }) => c.slug === "general");
      assert.ok(generalChannel, "Expected #general channel in space");

      // Connect WebSocket client and subscribe to generalChannel.id
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/collab/ws`);
      const receivedEvents: Array<Record<string, unknown>> = [];

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "chat:subscribe",
              channelIds: [generalChannel.id],
            }),
          );
        });
        ws.on("message", (raw) => {
          const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
          receivedEvents.push(msg);
          if (msg["type"] === "chat:subscribed") {
            resolve();
          }
        });
        ws.on("error", reject);
      });

      // Post a `/run` message to trigger WASM solver bot auto-reply
      const postMsgRes = await request(app)
        .post("/api/v1/spaces/acme-power/ieee-39-bus/channels/general/messages")
        .set("Authorization", `Bearer ${engineerToken}`)
        .send({
          content: "/run Modelica.Electrical.Analog.Examples.ChuaCircuit stopTime=25",
        })
        .expect(201);

      const msgId = postMsgRes.body.message.id as string;
      assert.ok(msgId);
      assert.ok(postMsgRes.body.botReply, "Expected WASM solver bot reply for /run command");
      assert.equal(postMsgRes.body.botReply.sender_type, "ci_runner");

      // React to message
      const reactRes = await request(app)
        .post(`/api/v1/spaces/acme-power/ieee-39-bus/channels/general/messages/${msgId}/reactions`)
        .set("Authorization", `Bearer ${engineerToken}`)
        .send({ emoji: "✅" })
        .expect(200);
      assert.deepEqual(reactRes.body.message.reactions["✅"], ["engineer"]);

      // Promote message to Living Doc
      const promoteDocRes = await request(app)
        .post(`/api/v1/spaces/acme-power/ieee-39-bus/channels/general/messages/${msgId}/promote`)
        .set("Authorization", `Bearer ${engineerToken}`)
        .send({
          targetType: "doc",
          title: "ChuaCircuit Transient Run",
        })
        .expect(201);
      assert.ok(promoteDocRes.body.doc, "Expected promoted Living Doc");

      // Promote message to PLM ECO
      const promoteEcoRes = await request(app)
        .post(`/api/v1/spaces/acme-power/ieee-39-bus/channels/general/messages/${msgId}/promote`)
        .set("Authorization", `Bearer ${engineerToken}`)
        .send({
          targetType: "eco",
          title: "ECO: Update Relay Delay after ChuaCircuit Run",
        })
        .expect(201);
      assert.ok(promoteEcoRes.body.eco, "Expected promoted PLM ECO");

      // Test '#' entity autocomplete
      const autoRes = await request(app).get("/api/v1/spaces/acme-power/ieee-39-bus/autocomplete?q=nerc").expect(200);
      assert.ok(autoRes.body.suggestions.some((e: { reference: string }) => e.reference === "#doc:nerc-cip-checklist"));

      // Test multi-Space Chat Sidenav tree
      const treeRes = await request(app)
        .get("/api/v1/spaces/my")
        .set("Authorization", `Bearer ${engineerToken}`)
        .expect(200);
      assert.ok(treeRes.body.spaces.length >= 2);
      assert.ok(treeRes.body.organizations.length >= 1);

      ws.close();
      assert.ok(
        receivedEvents.some((e) => e["type"] === "chat:message"),
        "WebSocket client should receive real-time chat:message broadcast",
      );
    },
  );

  await t.test("6. PLM Engineering Change Orders (ECO) & Cryptographic Sign-Off", async () => {
    const createEcoRes = await request(app)
      .post("/api/v1/spaces/acme-power/ieee-39-bus/ecos")
      .set("Authorization", `Bearer ${engineerToken}`)
      .send({
        title: "Upgrade Exciter Gain Ka from 200 to 250",
        description: "Improves transient voltage recovery after 3-phase fault at Bus 29",
        severity: "safety_critical",
        sourceBranch: "eco/exciter-ka-250",
        targetBranch: "main",
        impactedModels: ["IEEE39Bus.Generators.Gen10"],
      })
      .expect(201);

    const ecoId = createEcoRes.body.eco.id as string;
    assert.equal(createEcoRes.body.eco.status, "open");

    // Approve ECO with cryptographic SHA-256 sign-off
    const approveRes = await request(app)
      .post(`/api/v1/spaces/acme-power/ieee-39-bus/ecos/${ecoId}/review`)
      .set("Authorization", `Bearer ${engineerToken}`)
      .send({
        decision: "approved",
        comment: "Verified transient stability margin >= 15% across N-1 contingencies.",
      })
      .expect(200);

    assert.equal(approveRes.body.eco.status, "approved");
    assert.equal(approveRes.body.eco.approvals.length, 1);
    assert.ok(approveRes.body.eco.approvals[0].signature_hex.length >= 32);
  });

  await t.test("7. Transfer Space Ownership from User Profile to Organization Container", async () => {
    const transferRes = await request(app)
      .post("/api/v1/spaces/engineer/evtol-lab/transfer")
      .set("Authorization", `Bearer ${engineerToken}`)
      .send({
        targetOwnerType: "organization",
        targetSlug: "acme-power",
      })
      .expect(200);

    assert.equal(transferRes.body.space.owner_type, "organization");
    assert.equal(transferRes.body.space.owner_namespace, "acme-power");

    // Verify space now resolves under @acme-power/evtol-lab
    const movedRes = await request(app).get("/api/v1/spaces/@acme-power/evtol-lab").expect(200);
    assert.equal(movedRes.body.space.name, "eVTOL Flight Dynamics Lab");

    // Verify Git Vault was relocated on disk
    const newRepoDir = path.join(gitDir, "acme-power", "evtol-lab.git");
    assert.ok(fs.existsSync(newRepoDir), "Bare Git vault should be relocated to new owner namespace");
  });
});

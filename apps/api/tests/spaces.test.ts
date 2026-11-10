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
import { seedPolyglotSpaces } from "../src/seed/spaces.js";

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

  await t.test("1. Domain Blueprints: returns all 8 industry domain presets covering 68 languages", async () => {
    const res = await request(app).get("/api/v1/spaces/presets").expect(200);
    assert.ok(Array.isArray(res.body.presets));
    assert.equal(res.body.presets.length, 8);

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

    // Approve ECO with formal 21 CFR Part 11 role, intent, and cryptographic sign-off
    const approveRes = await request(app)
      .post(`/api/v1/spaces/acme-power/ieee-39-bus/ecos/${ecoId}/review`)
      .set("Authorization", `Bearer ${engineerToken}`)
      .send({
        decision: "approved",
        role: "Lead Systems Architect",
        intent: "I verify that simulation results satisfy ISO 26262 ASIL-D safety margins.",
        comment: "Verified transient stability margin >= 15% across N-1 contingencies.",
      })
      .expect(200);

    assert.equal(approveRes.body.eco.status, "approved");
    assert.equal(approveRes.body.eco.approvals.length, 1);
    assert.equal(approveRes.body.eco.approvals[0].role, "Lead Systems Architect");
    assert.ok(approveRes.body.eco.approvals[0].comment.includes("ISO 26262 ASIL-D"));
    assert.ok(approveRes.body.eco.approvals[0].signature_hex.length >= 32);

    // Verify ECO Diff endpoint
    const diffRes = await request(app).get(`/api/v1/spaces/acme-power/ieee-39-bus/ecos/${ecoId}/diff`).expect(200);
    assert.equal(diffRes.body.diff.sourceBranch, "eco/exciter-ka-250");
    assert.ok(diffRes.body.diff.files.length >= 1);
    assert.ok(diffRes.body.diff.files[0].newContent.includes("Change Order"));

    // Verify ECO Simulation endpoint & Trajectory Curves
    const simRes = await request(app).get(`/api/v1/spaces/acme-power/ieee-39-bus/ecos/${ecoId}/simulation`).expect(200);
    assert.equal(simRes.body.simulation.gateStatus, "passed");
    assert.ok(simRes.body.simulation.trajectories.length > 20);
    assert.ok(simRes.body.simulation.checks.length >= 3);

    // Verify ECO Simulate on-demand re-verification
    const reSimRes = await request(app)
      .post(`/api/v1/spaces/acme-power/ieee-39-bus/ecos/${ecoId}/simulate`)
      .set("Authorization", `Bearer ${engineerToken}`)
      .expect(200);
    assert.equal(reSimRes.body.eco.simulation_gate_status, "passed");
    assert.ok(reSimRes.body.simulation.trajectories.length > 20);

    // Verify ECO Blast Radius / Impact endpoint
    const impactRes = await request(app).get(`/api/v1/spaces/acme-power/ieee-39-bus/ecos/${ecoId}/impact`).expect(200);
    assert.ok(impactRes.body.impact.directModels.includes("IEEE39Bus.Generators.Gen10"));
    assert.ok(impactRes.body.impact.downstreamDependencies.length >= 1);
    assert.ok(impactRes.body.impact.allocatedRequirements.length >= 1);
    assert.equal(impactRes.body.impact.riskScore, "safety_critical");

    // Verify Declarative BOM Redline endpoint (Phase 3.2)
    const bomRes = await request(app).get(`/api/v1/spaces/acme-power/ieee-39-bus/ecos/${ecoId}/bom`).expect(200);
    assert.ok(bomRes.body.bom.parts.length >= 4);
    assert.equal(typeof bomRes.body.bom.summary.totalPartsDelta, "number");
    assert.equal(typeof bomRes.body.bom.summary.costDeltaUsd, "number");
    assert.ok(bomRes.body.bom.parts.some((p: any) => p.changeStatus === "added"));
    assert.ok(bomRes.body.bom.parts.some((p: any) => p.changeStatus === "modified"));

    // Verify One-Click Merge & Release Workflow (Phase 3.3)
    const mergeRes = await request(app)
      .post(`/api/v1/spaces/acme-power/ieee-39-bus/ecos/${ecoId}/merge`)
      .set("Authorization", `Bearer ${engineerToken}`)
      .expect(200);
    assert.equal(mergeRes.body.eco.status, "merged");
    assert.ok(mergeRes.body.releaseTag.startsWith("v1.0."));
    assert.ok(mergeRes.body.commitSha.length >= 20);
    assert.ok(mergeRes.body.aasxPackage.filename.endsWith(".aasx"));
    assert.ok(mergeRes.body.ddpContainer.filename.endsWith(".zip"));

    // Verify duplicate merge attempt is rejected
    await request(app)
      .post(`/api/v1/spaces/acme-power/ieee-39-bus/ecos/${ecoId}/merge`)
      .set("Authorization", `Bearer ${engineerToken}`)
      .expect(400);
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

  await t.test("8. Native Git Vault Inspection: Branches, Tree & Commits", async () => {
    // Verify branches endpoint returns default branch
    const branchesRes = await request(app).get("/api/v1/spaces/acme-power/ieee-39-bus/branches").expect(200);
    assert.ok(Array.isArray(branchesRes.body.branches));
    assert.ok(branchesRes.body.branches.length > 0);

    // Verify tree endpoint returns directory listing structure
    const treeRes = await request(app).get("/api/v1/spaces/acme-power/ieee-39-bus/tree").expect(200);
    assert.ok(Array.isArray(treeRes.body.tree));

    // Verify commits endpoint returns commits list
    const commitsRes = await request(app).get("/api/v1/spaces/acme-power/ieee-39-bus/commits").expect(200);
    assert.ok(Array.isArray(commitsRes.body.commits));
  });

  await t.test("9. Seed Polyglot Spaces: Populates Git Vault with commits, branches, and domain models", async () => {
    // Insert mock seed users into users table
    const seedUsernames = [
      "elena_vance",
      "vikram_patel",
      "claire_dubois",
      "omar",
      "kenji_takahashi",
      "marcus_chen",
      "astrid_solberg",
      "henrik_lindqvist",
      "priya_nair",
    ];
    const userIds = new Map<string, number>();
    for (let i = 0; i < seedUsernames.length; i++) {
      const u = seedUsernames[i]!;
      const existing = db.getUserByUsername(u);
      if (existing) {
        userIds.set(u, existing.id);
      } else {
        const created = db.createUser(u, `${u}@modelscript.org`, "hash", {
          emailVerified: true,
          initialCredits: 1000,
          accountType: "user",
          status: "active",
        });
        userIds.set(u, created.id);
      }
    }

    const summary = seedPolyglotSpaces(db, userIds);
    assert.ok(summary.spacesSeeded > 0 || summary.organizationsSeeded > 0);
    assert.ok(summary.gitCommitsSeeded > 0, "Expected git commits to be seeded into Space vaults");

    // 1. Verify eVTOL Space branches
    const evtolBranchesRes = await request(app)
      .get("/api/v1/spaces/aether-dynamics/evtol-flight-dynamics/branches")
      .expect(200);
    const branchNames = evtolBranchesRes.body.branches.map((b: { name: string }) => b.name);
    assert.ok(branchNames.includes("main"), "Expected main branch in eVTOL space");
    assert.ok(
      branchNames.includes("eco/gust-alleviation-actuator"),
      "Expected eco/gust-alleviation-actuator branch in eVTOL space",
    );

    // 2. Verify eVTOL Space tree has models, control, architecture, cad, README
    const evtolTreeRes = await request(app)
      .get("/api/v1/spaces/aether-dynamics/evtol-flight-dynamics/tree?ref=main")
      .expect(200);
    const treePaths = evtolTreeRes.body.tree.map((t: { path: string }) => t.path);
    assert.ok(treePaths.includes("README.md"), "Tree should contain README.md");
    assert.ok(treePaths.includes("package.mo"), "Tree should contain package.mo");
    assert.ok(treePaths.includes("models"), "Tree should contain models directory");
    assert.ok(treePaths.includes("control"), "Tree should contain control directory");
    assert.ok(treePaths.includes("architecture"), "Tree should contain architecture directory");
    assert.ok(treePaths.includes("cad"), "Tree should contain cad directory");

    // 3. Verify raw file retrieval for Modelica model
    const rawModelRes = await request(app)
      .get("/api/v1/spaces/aether-dynamics/evtol-flight-dynamics/files/raw?path=models/FlightDynamics6DOF.mo&ref=main")
      .expect(200);
    assert.ok(
      rawModelRes.text.includes("model FlightDynamics6DOF"),
      "Should return raw Modelica code for FlightDynamics6DOF",
    );

    // 4. Verify commits endpoint returns author and message
    const evtolCommitsRes = await request(app)
      .get("/api/v1/spaces/aether-dynamics/evtol-flight-dynamics/commits?ref=main")
      .expect(200);
    assert.ok(evtolCommitsRes.body.commits.length >= 1);
    assert.ok(
      evtolCommitsRes.body.commits[0].message.includes("feat(aero)"),
      "Commit message should match seeded message",
    );

    // 5. Verify HVDC Space raw SPICE netlist
    const rawSpiceRes = await request(app)
      .get("/api/v1/spaces/terragrid/hvdc-interconnection/files/raw?path=circuits/InverterBridge.sp&ref=main")
      .expect(200);
    assert.ok(rawSpiceRes.text.includes(".subckt MMC_SUBMODULE"), "Should return raw SPICE netlist for MMC submodule");
  });

  await t.test("10. Problem Reports & Engineering Issues: Create, Comment, Auto-Close on PR Merge", async () => {
    // 1. Verify seeded issues exist for Aether Dynamics eVTOL space
    const evtolIssuesRes = await request(app)
      .get("/api/v1/spaces/aether-dynamics/evtol-flight-dynamics/issues")
      .expect(200);
    assert.ok(Array.isArray(evtolIssuesRes.body.issues));
    assert.ok(evtolIssuesRes.body.issues.length >= 2, "Expected at least 2 seeded issues in eVTOL space");
    const issue1 = evtolIssuesRes.body.issues.find((i: { issue_number: number }) => i.issue_number === 1);
    assert.ok(issue1);
    assert.equal(issue1.status, "closed");
    assert.equal(issue1.linked_pr_number, 1);

    // Detail view with comments
    const issue1Detail = await request(app)
      .get(`/api/v1/spaces/aether-dynamics/evtol-flight-dynamics/issues/${issue1.id}`)
      .expect(200);
    assert.ok(issue1Detail.body.issue.comments.length >= 1);

    // 2. Create a new Problem Report (Issue) in acme-power/ieee-39-bus
    const createIssueRes = await request(app)
      .post("/api/v1/spaces/acme-power/ieee-39-bus/issues")
      .set("Authorization", `Bearer ${engineerToken}`)
      .send({
        title: "Exciter Over-Voltage Trip on Bus 14 Transient",
        description:
          "Dynamic voltage sag recovery exceeds 1.15 p.u. threshold, causing premature trip. Fixes #1 needed.",
        severity: "major",
        impactedModels: ["IEEE39Bus.Generators.Gen10"],
      })
      .expect(201);

    const newIssue = createIssueRes.body.issue;
    assert.ok(newIssue.id);
    assert.equal(newIssue.status, "open");
    assert.equal(newIssue.issue_number, 1);

    // 3. Add comment to issue
    const commentRes = await request(app)
      .post(`/api/v1/spaces/acme-power/ieee-39-bus/issues/${newIssue.id}/comments`)
      .set("Authorization", `Bearer ${engineerToken}`)
      .send({
        content: "Root cause identified in AVR amplifier gain. PR will follow shortly.",
      })
      .expect(201);
    assert.equal(
      commentRes.body.comment.content,
      "Root cause identified in AVR amplifier gain. PR will follow shortly.",
    );

    // 4. Create an ECO / Pull Request that references 'Fixes #1'
    const createEcoRes = await request(app)
      .post("/api/v1/spaces/acme-power/ieee-39-bus/ecos")
      .set("Authorization", `Bearer ${engineerToken}`)
      .send({
        title: "AVR Gain Tuning to Prevent Over-Voltage Trip",
        description: "Fixes #1: Reduce exciter amplifier gain Ka from 40 to 25 to prevent Bus 14 trip.",
        severity: "major",
        sourceBranch: "fix/avr-gain-tuning",
        targetBranch: "main",
        impactedModels: ["IEEE39Bus.Generators.Gen10"],
      })
      .expect(201);

    const ecoId = createEcoRes.body.eco.id;

    // Approve the ECO
    await request(app)
      .post(`/api/v1/spaces/acme-power/ieee-39-bus/ecos/${ecoId}/review`)
      .set("Authorization", `Bearer ${engineerToken}`)
      .send({
        decision: "approved",
        role: "Lead Systems Architect",
        intent: "Verified simulation gate.",
        comment: "Simulation gate passed and gain validated.",
      })
      .expect(200);

    // Merge the ECO — this should auto-close Issue #1
    await request(app)
      .post(`/api/v1/spaces/acme-power/ieee-39-bus/ecos/${ecoId}/merge`)
      .set("Authorization", `Bearer ${engineerToken}`)
      .expect(200);

    // Verify Issue #1 is now closed
    const updatedIssueRes = await request(app)
      .get(`/api/v1/spaces/acme-power/ieee-39-bus/issues/${newIssue.id}`)
      .expect(200);
    assert.equal(
      updatedIssueRes.body.issue.status,
      "closed",
      "Issue should be auto-closed after PR merge with 'Fixes #1'",
    );
  });
});

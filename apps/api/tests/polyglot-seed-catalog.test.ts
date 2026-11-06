// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { LibraryDatabase } from "../src/database.js";
import {
  ALL_44_LANGUAGE_SEED_POSTS,
  SEED_PERSONAS,
  seedPolyglotSocialData,
  seedPolyglotUsers,
} from "../src/seed/index.js";
import { decodeMultibase } from "../src/services/git-sync/base58.js";
import { canonicalizeJson } from "../src/services/git-sync/jcs.js";
import { verifyKeyLogChain } from "../src/services/git-sync/key-registry.js";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, "../../..");

describe("Polyglot 44-Language Social Seed Catalog", () => {
  let tmpDir: string;
  let db: LibraryDatabase;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-polyglot-seed-"));
    db = new LibraryDatabase(path.join(tmpDir, "test.db"));
  });

  after(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("covers all 47 seed languages in catalog with 1-to-1 fidelity in languages/*", () => {
    const languagesDir = path.join(REPO_ROOT, "languages");
    const diskLanguages = new Set(
      fs
        .readdirSync(languagesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name),
    );

    assert.equal(ALL_44_LANGUAGE_SEED_POSTS.length, 47);

    const catalogLanguages = ALL_44_LANGUAGE_SEED_POSTS.map((p) => (p.language ?? p.languageId ?? "").trim());
    for (const lang of catalogLanguages) {
      assert.ok(diskLanguages.has(lang), `Catalog language '${lang}' must exist in languages/`);
    }

    const titles = new Set<string>();
    for (const spec of ALL_44_LANGUAGE_SEED_POSTS) {
      assert.ok(spec.title.trim().length > 10, `Title too short for ${spec.language ?? spec.languageId}`);
      assert.equal(titles.has(spec.title), false, `Duplicate title: ${spec.title}`);
      titles.add(spec.title);
      assert.ok(spec.code.trim().length > 50, `Code too short for ${spec.title}`);
      assert.ok(spec.postContent.trim().length > 40, `Post content too short for ${spec.title}`);
      assert.ok(spec.comments.length >= 1, `Expected >= 1 comment for ${spec.title}`);
      assert.ok(spec.likedBy.length >= 3, `Expected >= 3 likes for ${spec.title}`);
    }
  });

  it("seeds 20 personas, 47 language artifacts + 1 fork, comments, likes, and is idempotent", async () => {
    const uploadDir = path.join(tmpDir, "uploads");
    const summary1 = await seedPolyglotSocialData(db, { uploadDir, includeDisabledLanguages: true });

    assert.equal(summary1.usersSeeded, SEED_PERSONAS.length);
    assert.equal(summary1.artifactsCreated, 48); // 47 languages + 1 forked Modelica post
    assert.equal(summary1.postsCreated, 48);
    assert.ok(summary1.commentsCreated >= 100, `Expected >= 100 comments+replies, got ${summary1.commentsCreated}`);

    const codeOnlyViewTypes = new Set([
      "fortran",
      "c",
      "plcopen",
      "verilog-a",
      "scad",
      "csg",
      "ccsds",
      "energyplus",
      "reqif",
      "autosar",
    ]);

    // Verify every diagram-capable artifact view has a generated SVG thumbnail
    for (const spec of ALL_44_LANGUAGE_SEED_POSTS) {
      const row = db.getArtifactViewByTitle(spec.title);
      assert.ok(row, `Missing artifact view for ${spec.title}`);
      const fullView = db.getArtifactView(row.id);
      assert.ok(fullView, `Missing full artifact view for id ${row.id}`);
      const cfg = JSON.parse(fullView.view_config) as Record<string, unknown>;
      if (codeOnlyViewTypes.has(spec.viewType)) {
        assert.equal(typeof cfg["code"], "string", `Expected code string for ${spec.title}`);
      } else {
        assert.equal(typeof cfg["svg"], "string", `Expected SVG string for ${spec.title}`);
        assert.ok((cfg["svg"] as string).includes("<svg"), `Expected <svg tag for ${spec.title}`);
        assert.equal(typeof cfg["thumbnailUrl"], "string", `Expected thumbnailUrl for ${spec.title}`);
      }
    }

    // Second invocation must be a no-op (idempotent)
    const summary2 = await seedPolyglotSocialData(db, { uploadDir, includeDisabledLanguages: true });
    assert.equal(summary2.artifactsCreated, 0);
    assert.equal(summary2.postsCreated, 0);
    assert.equal(summary2.commentsCreated, 0);
  });

  it("skips modelscript artifact when lang_modelscript flag is disabled by default", async () => {
    const cleanDbPath = path.join(tmpDir, "clean.db");
    const cleanDb = new LibraryDatabase(cleanDbPath);
    try {
      const summary = await seedPolyglotSocialData(cleanDb, { uploadDir: path.join(tmpDir, "clean_uploads") });
      assert.equal(summary.artifactsCreated, 47); // 46 languages + 1 forked Modelica post (modelscript excluded)
      const msxArtifact = cleanDb.getArtifactViewByTitle("Tilt-Rotor Transition Corridor Controller");
      assert.equal(msxArtifact, undefined, "ModelScript artifact should not be seeded when flag is disabled");
    } finally {
      cleanDb.close();
    }
  });

  it("seeds real GitHub and GitLab repositories with avatars and default branches", () => {
    seedPolyglotUsers(db);
    const popularRepos = db.getPopularRepos(20);
    assert.ok(popularRepos.length >= 9, `Expected >= 9 seeded repositories, got ${popularRepos.length}`);
    const providers = new Set(popularRepos.map((r) => r.provider));
    assert.ok(providers.has("github"), "Expected GitHub repositories in seed");
    assert.ok(providers.has("gitlab"), "Expected GitLab repositories in seed");

    const omarUser = db.getUserByUsername("omar");
    assert.ok(omarUser);
    const omarRepos = db.getLinkedRepos(omarUser.id);
    assert.equal(omarRepos.length, 3);
    assert.ok(
      omarRepos.some(
        (r) => r.provider === "github" && r.namespace === "modelica" && r.project === "ModelicaStandardLibrary",
      ),
    );
    assert.ok(omarRepos.some((r) => r.provider === "gitlab" && r.namespace === "libeigen" && r.project === "eigen"));
    for (const r of omarRepos) {
      assert.ok(r.avatar_url, `Expected avatar_url to be populated for ${r.namespace}/${r.project}`);
      assert.ok(r.default_branch, `Expected default_branch to be populated for ${r.namespace}/${r.project}`);
    }
  });

  it("assigns the ModelScript logo to omar, realistic portraits to all 19 other personas, and realistic banners to all 20 personas", () => {
    const webPublicDir = path.join(REPO_ROOT, "apps/web/public");
    for (const p of SEED_PERSONAS) {
      if (p.username === "omar") {
        assert.equal(p.avatarSvg, "/ms-logo.png");
        assert.ok(fs.existsSync(path.join(webPublicDir, "ms-logo.png")));
      } else {
        assert.equal(p.avatarSvg, `/avatars/${p.username}.png`);
        const avatarFile = path.join(webPublicDir, "avatars", `${p.username}.png`);
        assert.ok(fs.existsSync(avatarFile), `Missing avatar file for ${p.username} at ${avatarFile}`);
        assert.ok(fs.statSync(avatarFile).size > 50_000, `Expected realistic portrait image for ${p.username}`);
      }
      assert.equal(p.bannerSvg, `/banners/${p.username}.png`);
      const bannerFile = path.join(webPublicDir, "banners", `${p.username}.png`);
      assert.ok(fs.existsSync(bannerFile), `Missing banner file for ${p.username} at ${bannerFile}`);
      assert.ok(fs.statSync(bannerFile).size > 50_000, `Expected realistic banner image for ${p.username}`);
    }
  });

  it("seeds verified accounts with deterministic Ed25519 signing keys and valid transparency logs", () => {
    seedPolyglotUsers(db);

    const verifiedUsernames = ["omar", "elena_vance", "marcus_chen", "claire_dubois", "kenji_takahashi"];
    for (const uname of verifiedUsernames) {
      const user = db.getUserByUsername(uname);
      assert.ok(user, `User ${uname} should exist`);
      assert.equal(user.signing_verified, 1, `User ${uname} should have signing_verified = 1`);
      const keys = db.getSigningKeysForUser(user.id);
      assert.ok(keys.length >= 1, `User ${uname} should have at least 1 registered signing key`);
      for (const k of keys) {
        assert.equal(k.algo, "ed25519");
        assert.ok(k.fingerprint_sha256.startsWith("SHA256:"));
        assert.ok(k.public_key_multibase.startsWith("z"));
        assert.ok(k.public_key_openssh.startsWith("ssh-ed25519 "));
      }

      // Verify tamper-evident key transparency log chain
      const log = db.getKeyLogForUser(user.id);
      assert.ok(log.length >= 1, `User ${uname} should have key log entries`);
      assert.equal(verifyKeyLogChain(log), true, `Key transparency log chain for ${uname} must be valid`);
    }

    // Omar should have both a master key and a delegated device key
    const omarUser = db.getUserByUsername("omar")!;
    const omarKeys = db.getSigningKeysForUser(omarUser.id);
    assert.equal(omarKeys.length, 2, "Omar should have 2 signing keys (master + delegated)");
    const masterKey = omarKeys.find((k) => k.trust_level === "hardware_or_cli");
    const deviceKey = omarKeys.find((k) => k.trust_level === "delegated_by_master");
    assert.ok(masterKey, "Omar should have master hardware key");
    assert.ok(deviceKey, "Omar should have delegated device key");
    assert.equal(deviceKey.prev_key_id, masterKey.id, "Device key should link to master key");
    assert.ok(deviceKey.rotation_proof, "Device key should have rotation attestation proof");

    // Non-verified personas should have signing_verified = 0
    const unverifiedUser = db.getUserByUsername("henrik_lindqvist")!;
    assert.equal(unverifiedUser.signing_verified, 0, "Henrik should not be marked signing_verified");
  });

  it("seeds signed posts with W3C Data Integrity proofs and records evidence in signed_post_evidence", async () => {
    const uploadDir = path.join(tmpDir, "signed_uploads");
    await seedPolyglotSocialData(db, { uploadDir, includeDisabledLanguages: true });

    const signedPostTitles = [
      "ElectroHydrostaticActuator — Primary Aileron EHA Servo Loop",
      "TiltRotorTransitionController — Hybrid eVTOL Corridor Flight Dynamics",
      "ArtemisLunarLanderGNC — OMG SysML v2 Descent & Touchdown Architecture",
      "BESS_250MW_GridForming_IEEE2800 — PSCAD EMT Fault Ride-Through Study",
      "7-DOF Torque-Controlled Dexterous Cobot Manipulator & Parallel Gripper — ROS 2 URDF",
      "ElectroHydrostaticActuator — High-Bandwidth Stiff Bulk Modulus Variant (Fork)",
    ];

    for (const title of signedPostTitles) {
      const art = db.getArtifactViewByTitle(title);
      assert.ok(art, `Artifact '${title}' should exist`);

      // Find post by artifactViewId or forked artifact id
      const postRow = db.db
        .prepare(`SELECT *, CAST(id AS TEXT) as id FROM posts WHERE artifact_view_id = ?`)
        .get(art.id) as any;
      assert.ok(postRow, `Post for '${title}' should exist`);

      const post = db.getPost(postRow.id);
      assert.ok(post, `Post with ID ${postRow.id} should be loadable`);
      assert.equal(post.signing_verified, 1, `Post author for '${title}' should be signing_verified`);
      assert.ok(post.client_signature, `Post '${title}' should have client_signature`);

      const meta = post.metadata as Record<string, any>;
      assert.ok(meta?.proof, `Post '${title}' should have metadata.proof`);
      assert.equal(meta.proof.type, "DataIntegrityProof");
      assert.equal(meta.proof.cryptosuite, "eddsa-jcs-2022");
      assert.ok(meta.proof.proofValue.startsWith("z"));

      // Verify evidence recorded in signed_post_evidence
      const evidence = db.getSignedPostEvidence(String(post.id));
      assert.ok(evidence, `Evidence record must exist for post ${post.id}`);
      assert.equal(evidence.rev, 1);
      assert.ok(evidence.key_id);

      const key = db.getSigningKeyById(evidence.key_id)!;
      assert.ok(key, "Signing key in evidence should exist");

      // Cryptographically verify the W3C Data Integrity signature against the key
      const rawPubWithHeader = decodeMultibase(key.public_key_multibase);
      const rawPub32 = rawPubWithHeader.length === 34 ? rawPubWithHeader.subarray(2) : rawPubWithHeader;
      const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
      const spki = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(rawPub32)]);
      const pubKeyObj = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });

      const parsedPayload = JSON.parse(evidence.payload_json);
      const parsedProof = JSON.parse(evidence.proof_json);

      const canonicalPayload = canonicalizeJson(parsedPayload);
      const payloadHash = crypto.createHash("sha256").update(canonicalPayload, "utf8").digest();

      const proofConfig = {
        type: parsedProof.type,
        cryptosuite: parsedProof.cryptosuite,
        created: parsedProof.created,
        verificationMethod: parsedProof.verificationMethod,
        proofPurpose: parsedProof.proofPurpose,
      };
      const canonicalConfig = canonicalizeJson(proofConfig);
      const configHash = crypto.createHash("sha256").update(canonicalConfig, "utf8").digest();

      const signingData = Buffer.concat([configHash, payloadHash]);
      const sigBytes = decodeMultibase(parsedProof.proofValue);

      const isValid = crypto.verify(null, signingData, pubKeyObj, sigBytes);
      assert.equal(isValid, true, `Cryptographic proof for '${title}' must verify successfully`);
    }
  });

  it("serves public signing keys, transparency log, and signed post evidence via API endpoints", async () => {
    const { createApp } = await import("../src/app.js");
    const request = (await import("supertest")).default;
    const app = createApp({ database: db, seedStdlibOnBoot: false, enableWorkers: false });

    // Test GET /api/v1/users/:username/signing-keys
    const elenaKeysRes = await request(app).get("/api/v1/users/elena_vance/signing-keys");
    assert.equal(elenaKeysRes.status, 200);
    assert.equal(elenaKeysRes.body.signing_verified, true);
    assert.equal(elenaKeysRes.body.keys.length, 1);
    assert.equal(elenaKeysRes.body.keys[0].trust_level, "hardware_or_cli");

    // Test Omar's keys & master delegation
    const omarKeysRes = await request(app).get("/api/v1/users/omar/signing-keys");
    assert.equal(omarKeysRes.status, 200);
    assert.equal(omarKeysRes.body.signing_verified, true);
    assert.equal(omarKeysRes.body.keys.length, 2);

    // Test GET /api/v1/users/:username/signing-keys/log
    const omarLogRes = await request(app).get("/api/v1/users/omar/signing-keys/log");
    assert.equal(omarLogRes.status, 200);
    assert.equal(omarLogRes.body.chain_valid, true);
    assert.ok(omarLogRes.body.log.length >= 3);

    // Test GET /api/v1/posts/:postId/evidence
    const art = db.getArtifactViewByTitle("ElectroHydrostaticActuator — Primary Aileron EHA Servo Loop")!;
    const postRow = db.db
      .prepare(`SELECT CAST(id AS TEXT) as id FROM posts WHERE artifact_view_id = ?`)
      .get(art.id) as { id: string };
    const evRes = await request(app).get(`/api/v1/posts/${postRow.id}/evidence`);
    assert.equal(evRes.status, 200);
    assert.equal(evRes.body.post_id, String(postRow.id));
    assert.equal(evRes.body.rev, 1);
    assert.ok(evRes.body.key);
    assert.ok(evRes.body.proof);
    assert.equal(evRes.body.proof.cryptosuite, "eddsa-jcs-2022");

    // Test GET /api/v1/posts/:postId/revisions
    const revRes = await request(app).get(`/api/v1/social/posts/${postRow.id}/revisions`);
    assert.equal(revRes.status, 200);
    assert.equal(revRes.body.currentRev, 1);
    assert.equal(revRes.body.revisions.length, 1);
  });
});

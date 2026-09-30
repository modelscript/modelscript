// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { clearPublicKeyCache, setCachedPublicKey } from "../src/middleware/activitypub.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { ed25519PemToMultibase, multibaseToEd25519Pem } from "../src/util/multikey.js";

test("Engineering Federation Enhancements: Media Attachments, RFC 9421 & Ed25519, Package Federation", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fed-enhancements-test-"));
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

  // Generate test remote RSA and Ed25519 keypairs
  const { publicKey: testRsaPub, privateKey: testRsaPriv } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const { publicKey: testEdPub, privateKey: testEdPriv } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const testUser = db.createUser("engineer_bob", "bob@modelscript.test", "hashed_pwd", {
    emailVerified: true,
  });
  const bobToken = jwt.sign({ id: testUser.id, username: testUser.username, email: testUser.email }, JWT_SECRET);

  await t.test("FEP-521a Ed25519 Multikey exposed in actor profiles", async () => {
    // 1. User actor profile
    const userRes = await request(app).get(`/users/${testUser.username}`).set("Accept", "application/activity+json");

    assert.strictEqual(userRes.status, 200);
    assert(Array.isArray(userRes.body.assertionMethod), "Expected assertionMethod array");
    const edKey = userRes.body.assertionMethod.find((k: any) => k.type === "Multikey");
    assert(edKey, "Expected Multikey entry in assertionMethod");
    assert(edKey.publicKeyMultibase.startsWith("z"), "Multibase must start with 'z'");
    assert.strictEqual(edKey.controller, `https://hub.modelscript.org/users/${testUser.username}`);

    // Verify roundtrip decoding of multibase key
    const recoveredPem = multibaseToEd25519Pem(edKey.publicKeyMultibase);
    assert(recoveredPem.includes("BEGIN PUBLIC KEY"), "Recovered PEM must be valid SPKI key");

    // 2. Instance actor profile
    const actorRes = await request(app).get("/actor").set("Accept", "application/activity+json");

    assert.strictEqual(actorRes.status, 200);
    assert(Array.isArray(actorRes.body.assertionMethod), "Expected instance actor assertionMethod");
    const instanceEdKey = actorRes.body.assertionMethod[0];
    assert.strictEqual(instanceEdKey.type, "Multikey");
    assert(instanceEdKey.publicKeyMultibase.startsWith("z"));
  });

  await t.test("RFC 9421 HTTP Message Signatures dual-verifier with Ed25519 and Content-Digest", async () => {
    clearPublicKeyCache();
    const remoteActorUrl = "https://remote-cad.org/users/charlie";
    const remoteKeyId = `${remoteActorUrl}#ed25519-key`;
    const edMultibase = ed25519PemToMultibase(testEdPub);

    setCachedPublicKey(remoteActorUrl, testEdPub, {
      id: remoteActorUrl,
      type: "Person",
      preferredUsername: "charlie",
      assertionMethod: [
        {
          id: remoteKeyId,
          type: "Multikey",
          controller: remoteActorUrl,
          publicKeyMultibase: edMultibase,
          publicKeyPem: testEdPub,
        },
      ],
    });

    const body = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${remoteActorUrl}/activities/101`,
      type: "Create",
      actor: remoteActorUrl,
      object: {
        id: `${remoteActorUrl}/posts/101`,
        type: "Note",
        content: "New aerofoil profile simulation attached.",
      },
    };

    const bodyString = JSON.stringify(body);
    const hashBase64 = crypto.createHash("sha256").update(bodyString).digest("base64");
    const contentDigest = `sha-256=:${hashBase64}:`;
    const date = new Date().toUTCString();
    const path = `/users/${testUser.username}/inbox`;

    const sigParams = `("@method" "@path" "date" "content-digest");keyid="${remoteKeyId}";alg="ed25519"`;
    const signatureBase = [
      `"@method": POST`,
      `"@path": ${path}`,
      `"date": ${date}`,
      `"content-digest": ${contentDigest}`,
      `"@signature-params": ${sigParams}`,
    ].join("\n");

    const sigBuf = crypto.sign(null, Buffer.from(signatureBase), testEdPriv);
    const signatureValue = sigBuf.toString("base64");

    // 1. Valid RFC 9421 signature should succeed
    const resValid = await request(app)
      .post(path)
      .set("Host", "hub.modelscript.org")
      .set("Date", date)
      .set("Content-Type", "application/activity+json")
      .set("Content-Digest", contentDigest)
      .set("Signature-Input", `sig1=${sigParams}`)
      .set("Signature", `sig1=:${signatureValue}:`)
      .send(body);

    assert.strictEqual(resValid.status, 202);

    // 2. Tampered Content-Digest should be rejected with 401
    const resTampered = await request(app)
      .post(path)
      .set("Host", "hub.modelscript.org")
      .set("Date", date)
      .set("Content-Type", "application/activity+json")
      .set("Content-Digest", "sha-256=:tamperedHash=:")
      .set("Signature-Input", `sig1=${sigParams}`)
      .set("Signature", `sig1=:${signatureValue}:`)
      .send(body);

    assert.strictEqual(resTampered.status, 401);
  });

  await t.test("Legacy Draft-Cavage RSA-SHA256 signature verifier succeeds transparently", async () => {
    clearPublicKeyCache();
    const remoteActorUrl = "https://legacy-mastodon.org/users/david";
    const remoteKeyId = `${remoteActorUrl}#main-key`;

    setCachedPublicKey(remoteActorUrl, testRsaPub, {
      id: remoteActorUrl,
      type: "Person",
      preferredUsername: "david",
      publicKey: {
        id: remoteKeyId,
        owner: remoteActorUrl,
        publicKeyPem: testRsaPub,
      },
    });

    const body = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${remoteActorUrl}/activities/202`,
      type: "Create",
      actor: remoteActorUrl,
      object: {
        id: `${remoteActorUrl}/posts/202`,
        type: "Note",
        content: "Testing legacy Cavage compatibility.",
      },
    };

    const bodyString = JSON.stringify(body);
    const digest = `SHA-256=${crypto.createHash("sha256").update(bodyString).digest("base64")}`;
    const date = new Date().toUTCString();
    const path = `/users/${testUser.username}/inbox`;

    const signedString = [
      `(request-target): post ${path}`,
      `host: hub.modelscript.org`,
      `date: ${date}`,
      `digest: ${digest}`,
    ].join("\n");

    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signedString);
    const signature = signer.sign(testRsaPriv, "base64");

    const signatureHeader = `keyId="${remoteKeyId}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signature}"`;

    const res = await request(app)
      .post(path)
      .set("Host", "hub.modelscript.org")
      .set("Date", date)
      .set("Digest", digest)
      .set("Content-Type", "application/activity+json")
      .set("Signature", signatureHeader)
      .send(body);

    assert.strictEqual(res.status, 202);
  });

  await t.test("Rich Engineering Media: Inbound STEP CAD attachment materializes into artifact_views", async () => {
    clearPublicKeyCache();
    const remoteActorUrl = "https://cad-hub.org/users/engineer_eva";
    const remoteKeyId = `${remoteActorUrl}#main-key`;

    setCachedPublicKey(remoteActorUrl, testRsaPub, {
      id: remoteActorUrl,
      type: "Person",
      preferredUsername: "engineer_eva",
      publicKey: { id: remoteKeyId, owner: remoteActorUrl, publicKeyPem: testRsaPub },
    });

    const cadPostId = `${remoteActorUrl}/posts/301`;
    const cadAttachmentUrl = "https://cad-hub.org/storage/turbopump-impeller.step";

    const body = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${cadPostId}/activity`,
      type: "Create",
      actor: remoteActorUrl,
      object: {
        id: cadPostId,
        type: "Note",
        content: "High-pressure rocket turbopump impeller 3D geometry.",
        attachment: [
          {
            type: "Document",
            mediaType: "model/step",
            url: cadAttachmentUrl,
            name: "turbopump-impeller.step",
            icon: {
              type: "Image",
              url: "https://cad-hub.org/thumbnails/impeller.webp",
            },
            viewConfig: {
              unit: "mm",
              material: "Inconel 718",
            },
          },
        ],
      },
    };

    const bodyString = JSON.stringify(body);
    const digest = `SHA-256=${crypto.createHash("sha256").update(bodyString).digest("base64")}`;
    const date = new Date().toUTCString();
    const path = `/users/${testUser.username}/inbox`;

    const signedString = [
      `(request-target): post ${path}`,
      `host: hub.modelscript.org`,
      `date: ${date}`,
      `digest: ${digest}`,
    ].join("\n");

    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signedString);
    const signature = signer.sign(testRsaPriv, "base64");

    const res = await request(app)
      .post(path)
      .set("Host", "hub.modelscript.org")
      .set("Date", date)
      .set("Digest", digest)
      .set("Content-Type", "application/activity+json")
      .set(
        "Signature",
        `keyId="${remoteKeyId}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signature}"`,
      )
      .send(body);

    assert.strictEqual(res.status, 202);

    // Verify post created in database has artifact_view_id
    const post = db.getPostByApId(cadPostId);
    assert(post, "Post should be stored in database");
    assert(post.artifact_view_id, "Post must have an associated artifact_view_id");

    const artifact = db.getArtifactView(post.artifact_view_id);
    assert(artifact, "Artifact view must exist");
    assert.strictEqual(artifact.view_type, "cad-step");
    assert.strictEqual(artifact.source_type, "step");
    assert.strictEqual(artifact.remote_origin_url, cadAttachmentUrl);

    const config = JSON.parse(artifact.view_config);
    assert.strictEqual(config.material, "Inconel 718");
    assert.strictEqual(config.url, cadAttachmentUrl);
  });

  await t.test("Rich Engineering Media: SSRF protection rejects private attachment URLs", async () => {
    clearPublicKeyCache();
    const remoteActorUrl = "https://attacker.org/users/malory";
    const remoteKeyId = `${remoteActorUrl}#main-key`;

    setCachedPublicKey(remoteActorUrl, testRsaPub, {
      id: remoteActorUrl,
      type: "Person",
      preferredUsername: "malory",
      publicKey: { id: remoteKeyId, owner: remoteActorUrl, publicKeyPem: testRsaPub },
    });

    const maliciousPostId = `${remoteActorUrl}/posts/exploit-1`;
    const body = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${maliciousPostId}/activity`,
      type: "Create",
      actor: remoteActorUrl,
      object: {
        id: maliciousPostId,
        type: "Note",
        content: "Check internal cloud metadata.",
        attachment: [
          {
            type: "Document",
            mediaType: "model/step",
            url: "http://169.254.169.254/latest/meta-data/",
          },
        ],
      },
    };

    const bodyString = JSON.stringify(body);
    const digest = `SHA-256=${crypto.createHash("sha256").update(bodyString).digest("base64")}`;
    const date = new Date().toUTCString();
    const path = `/users/${testUser.username}/inbox`;

    const signedString = [
      `(request-target): post ${path}`,
      `host: hub.modelscript.org`,
      `date: ${date}`,
      `digest: ${digest}`,
    ].join("\n");

    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signedString);
    const signature = signer.sign(testRsaPriv, "base64");

    const res = await request(app)
      .post(path)
      .set("Host", "hub.modelscript.org")
      .set("Date", date)
      .set("Digest", digest)
      .set("Content-Type", "application/activity+json")
      .set(
        "Signature",
        `keyId="${remoteKeyId}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signature}"`,
      )
      .send(body);

    assert.strictEqual(res.status, 202);

    const post = db.getPostByApId(maliciousPostId);
    assert(post, "Post is recorded");
    assert.strictEqual(post.artifact_view_id, null, "SSRF URL must be rejected and no artifact view created");
  });

  await t.test("Rich Engineering Media: Outbox serialization preserves artifact attachments", async () => {
    // Create an artifact view locally
    const viewId = db.createArtifactView(
      testUser.id,
      "simulation-plot",
      "vegalite",
      JSON.stringify({
        url: "https://hub.modelscript.org/data/timeseries.json",
        mark: "line",
      }),
      "Bifurcation Trajectory Plot",
      "https://hub.modelscript.org/thumbnails/plot.png",
    );

    // Create a local post referencing the artifact view
    const postResult = await request(app).post("/api/v1/social/posts").set("Authorization", `Bearer ${bobToken}`).send({
      content: "Lorenz attractor chaotic simulation run.",
      artifact_view_id: viewId,
    });

    assert.strictEqual(postResult.status, 201);

    // Fetch user outbox page
    const outboxRes = await request(app)
      .get(`/users/${testUser.username}/outbox?page=true`)
      .set("Accept", "application/activity+json");

    assert.strictEqual(outboxRes.status, 200);
    const outboxActivity = outboxRes.body.orderedItems.find(
      (item: any) => item.object?.content === "Lorenz attractor chaotic simulation run.",
    );

    assert(outboxActivity, "Outbox must contain the posted activity");
    assert(Array.isArray(outboxActivity.object.attachment), "Note must have attachment array");
    const att = outboxActivity.object.attachment[0];
    assert.strictEqual(att.type, "Document");
    assert.strictEqual(att.mediaType, "application/vnd.vegalite.v5+json");
    assert.strictEqual(att.viewType, "simulation-plot");
    assert.strictEqual(att.name, "Bifurcation Trajectory Plot");
    assert.strictEqual(att.icon?.url, "https://hub.modelscript.org/thumbnails/plot.png");
  });

  await t.test(
    "Decentralized Package Federation: Inbound SoftwareApplication indexes into remote_packages",
    async () => {
      clearPublicKeyCache();
      const remoteActorUrl = "https://modelica-registry.de/users/aixlib_team";
      const remoteKeyId = `${remoteActorUrl}#main-key`;

      setCachedPublicKey(remoteActorUrl, testRsaPub, {
        id: remoteActorUrl,
        type: "Person",
        preferredUsername: "aixlib_team",
        publicKey: { id: remoteKeyId, owner: remoteActorUrl, publicKeyPem: testRsaPub },
      });

      const packageApId = "https://modelica-registry.de/libraries/@aixlib/HVAC/1.4.0";
      const body = {
        "@context": ["https://www.w3.org/ns/activitystreams", { schema: "http://schema.org/" }],
        id: `${packageApId}/activity`,
        type: "Create",
        actor: remoteActorUrl,
        object: {
          id: packageApId,
          type: ["Document", "schema:SoftwareApplication"],
          name: "@aixlib/HVAC",
          version: "1.4.0",
          checksum: "sha256:4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
          downloadUrl: "https://modelica-registry.de/api/v1/libraries/@aixlib/HVAC/1.4.0",
          license: "MIT",
          description: "Modular building energy simulation HVAC components.",
        },
      };

      const bodyString = JSON.stringify(body);
      const digest = `SHA-256=${crypto.createHash("sha256").update(bodyString).digest("base64")}`;
      const date = new Date().toUTCString();
      const path = `/users/${testUser.username}/inbox`;

      const signedString = [
        `(request-target): post ${path}`,
        `host: hub.modelscript.org`,
        `date: ${date}`,
        `digest: ${digest}`,
      ].join("\n");

      const signer = crypto.createSign("RSA-SHA256");
      signer.update(signedString);
      const signature = signer.sign(testRsaPriv, "base64");

      const res = await request(app)
        .post(path)
        .set("Host", "hub.modelscript.org")
        .set("Date", date)
        .set("Digest", digest)
        .set("Content-Type", "application/activity+json")
        .set(
          "Signature",
          `keyId="${remoteKeyId}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signature}"`,
        )
        .send(body);

      assert.strictEqual(res.status, 202);

      // Verify package is indexed in remote_packages
      const pkg = db.getRemotePackage("@aixlib/HVAC", "1.4.0");
      assert(pkg, "Remote package must be recorded in local database");
      assert.strictEqual(pkg.checksum, "sha256:4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a");
      assert.strictEqual(pkg.license, "MIT");

      // Query packages via /federation/packages
      const listRes = await request(app).get("/federation/packages");
      assert.strictEqual(listRes.status, 200);
      const listed = listRes.body.packages.find((p: any) => p.name === "@aixlib/HVAC" && p.version === "1.4.0");
      assert(listed, "Package must appear in /federation/packages API");

      // Inbound Delete should mark package deleted
      const deleteBody = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `${packageApId}#delete`,
        type: "Delete",
        actor: remoteActorUrl,
        object: packageApId,
      };

      const delBodyString = JSON.stringify(deleteBody);
      const delDigest = `SHA-256=${crypto.createHash("sha256").update(delBodyString).digest("base64")}`;
      const delSigned = [
        `(request-target): post ${path}`,
        `host: hub.modelscript.org`,
        `date: ${date}`,
        `digest: ${delDigest}`,
      ].join("\n");

      const delSigner = crypto.createSign("RSA-SHA256");
      delSigner.update(delSigned);
      const delSig = delSigner.sign(testRsaPriv, "base64");

      const delRes = await request(app)
        .post(path)
        .set("Host", "hub.modelscript.org")
        .set("Date", date)
        .set("Digest", delDigest)
        .set("Content-Type", "application/activity+json")
        .set(
          "Signature",
          `keyId="${remoteKeyId}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${delSig}"`,
        )
        .send(deleteBody);

      assert.strictEqual(delRes.status, 202);

      const deletedPkg = db.getRemotePackage("@aixlib/HVAC", "1.4.0");
      assert.strictEqual(deletedPkg, undefined, "Package should no longer be returned as active");
    },
  );
});

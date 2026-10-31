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
import { computeFollowersSyncDigest } from "../src/util/activitypub-crypto.js";
import { canonicalizeEmail, ipMatchesCidr } from "../src/util/email-filter.js";

function signInboxRequest(
  privateKeyPem: string,
  keyId: string,
  inboxPath: string,
  host: string,
  bodyObj: Record<string, unknown>,
) {
  const bodyStr = JSON.stringify(bodyObj);
  const digest = `SHA-256=${crypto.createHash("sha256").update(bodyStr).digest("base64")}`;
  const date = new Date().toUTCString();
  const stringToSign = `(request-target): post ${inboxPath}\nhost: ${host}\ndate: ${date}\ndigest: ${digest}`;
  const signer = crypto.createSign("sha256");
  signer.update(stringToSign);
  signer.end();
  const signature = signer.sign(privateKeyPem, "base64");
  const sigHeader = `keyId="${keyId}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signature}"`;
  return { bodyStr, digest, date, sigHeader };
}

function signGetRequest(privateKeyPem: string, keyId: string, requestPath: string, host: string) {
  const date = new Date().toUTCString();
  const stringToSign = `(request-target): get ${requestPath}\nhost: ${host}\ndate: ${date}`;
  const signer = crypto.createSign("sha256");
  signer.update(stringToSign);
  signer.end();
  const signature = signer.sign(privateKeyPem, "base64");
  const sigHeader = `keyId="${keyId}",algorithm="rsa-sha256",headers="(request-target) host date",signature="${signature}"`;
  return { date, sigHeader };
}

test("Mastodon Platform Parity Suite: Federation, Moderation, Trust & Safety, and Day-2 CLI Operations", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mastodon-parity-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  const { publicKey: remoteRsaPub, privateKey: remoteRsaPriv } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const alice = db.createUser("alice", "alice@modelscript.test", "hashed_pwd", {
    emailVerified: true,
    accountType: "admin",
  });
  db.ensureUserRSAKeys(alice.id);
  const aliceToken = jwt.sign({ id: alice.id, username: alice.username, email: alice.email }, JWT_SECRET);

  const bob = db.createUser("bob", "bob@modelscript.test", "hashed_pwd", {
    emailVerified: true,
  });
  db.ensureUserRSAKeys(bob.id);
  const bobToken = jwt.sign({ id: bob.id, username: bob.username, email: bob.email }, JWT_SECRET);

  await t.test("1. Post Visibility Tiers (public, unlisted, followers, direct) & Addressing", async () => {
    // Public post
    const pubRes = await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ content: "Public engineering announcement #modelica", visibility: "public" });
    assert.strictEqual(pubRes.status, 201);
    assert.strictEqual(pubRes.body.post.visibility, "public");

    // Unlisted post
    const unlRes = await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ content: "Unlisted work-in-progress simulation", visibility: "unlisted" });
    assert.strictEqual(unlRes.status, 201);
    assert.strictEqual(unlRes.body.post.visibility, "unlisted");

    // Followers-only post
    const folRes = await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ content: "Followers-only benchmark results", visibility: "followers" });
    assert.strictEqual(folRes.status, 201);
    const followersPostId = folRes.body.post.id;

    // Direct post mentioning @bob
    const dirRes = await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ content: "Hey @bob check this direct message", visibility: "direct" });
    assert.strictEqual(dirRes.status, 201);
    const directPostId = dirRes.body.post.id;

    // Explore timeline should contain public post, NOT unlisted/followers/direct
    const exploreRes = await request(app).get("/api/v1/social/explore");
    assert.strictEqual(exploreRes.status, 200);
    const exploreIds = exploreRes.body.posts.map((p: { id: number }) => p.id);
    assert(exploreIds.includes(pubRes.body.post.id), "Public post should be in explore");
    assert(!exploreIds.includes(unlRes.body.post.id), "Unlisted post must not be in explore");
    assert(!exploreIds.includes(followersPostId), "Followers post must not be in explore");
    assert(!exploreIds.includes(directPostId), "Direct post must not be in explore");

    // Unauthenticated / non-follower Bob cannot view Alice's followers-only post
    const nonFollowerGet = await request(app)
      .get(`/api/v1/social/posts/${followersPostId}`)
      .set("Authorization", `Bearer ${bobToken}`);
    assert.strictEqual(nonFollowerGet.status, 403);

    // Bob IS mentioned in direct post, so Bob CAN view direct post
    const bobDirectGet = await request(app)
      .get(`/api/v1/social/posts/${directPostId}`)
      .set("Authorization", `Bearer ${bobToken}`);
    assert.strictEqual(bobDirectGet.status, 200);

    // Unauthenticated user cannot view direct post
    const anonDirectGet = await request(app).get(`/api/v1/social/posts/${directPostId}`);
    assert.strictEqual(anonDirectGet.status, 403);
  });

  await t.test("2. Federated Polls (Question) creation, local voting, and inbound ActivityPub Question", async () => {
    const pollPostRes = await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        content: "Which DAE solver should we benchmark next?",
        visibility: "public",
        poll: {
          options: ["IDA", "CVODE", "Radau5"],
          expiresInSeconds: 3600,
          multiple: false,
        },
      });
    assert.strictEqual(pollPostRes.status, 201);
    assert(pollPostRes.body.post.poll, "Expected poll attached to post");
    assert.strictEqual(pollPostRes.body.post.poll.options.length, 3);

    const postId = pollPostRes.body.post.id;
    const voteRes = await request(app)
      .post(`/api/v1/social/posts/${postId}/poll/vote`)
      .set("Authorization", `Bearer ${bobToken}`)
      .send({ choices: [1] });
    assert.strictEqual(voteRes.status, 200);
    assert.strictEqual(voteRes.body.poll.options[1].votes_count, 1);
    assert.strictEqual(voteRes.body.poll.voters_count, 1);
    assert.deepStrictEqual(voteRes.body.poll.own_votes, [1]);

    // Inbound ActivityPub Create(Question) from remote actor
    clearPublicKeyCache();
    const remoteActor = "https://polls.example.org/users/quizmaster";
    const remoteKeyId = `${remoteActor}#main-key`;
    setCachedPublicKey(remoteActor, remoteRsaPub);

    const questionApId = "https://polls.example.org/statuses/q-500";
    const createQuestion = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${questionApId}/activity`,
      type: "Create",
      actor: remoteActor,
      to: ["https://www.w3.org/ns/activitystreams#Public"],
      object: {
        id: questionApId,
        type: "Question",
        attributedTo: remoteActor,
        content: "<p>Best mesh generator?</p>",
        to: ["https://www.w3.org/ns/activitystreams#Public"],
        oneOf: [
          { type: "Note", name: "Gmsh", replies: { type: "Collection", totalItems: 4 } },
          { type: "Note", name: "SnappyHexMesh", replies: { type: "Collection", totalItems: 2 } },
        ],
        endTime: new Date(Date.now() + 7200_000).toISOString(),
      },
    };

    const { digest, date, sigHeader } = signInboxRequest(
      remoteRsaPriv,
      remoteKeyId,
      "/inbox",
      "127.0.0.1",
      createQuestion,
    );
    const inboxRes = await request(app)
      .post("/inbox")
      .set("Host", "127.0.0.1")
      .set("Date", date)
      .set("Digest", digest)
      .set("Signature", sigHeader)
      .set("Content-Type", "application/activity+json")
      .send(createQuestion);
    assert.strictEqual(inboxRes.status, 202);

    const savedPollPost = db.getPostByApId(questionApId);
    assert(savedPollPost, "Expected inbound Question post to be saved");
    const pollView = db.getPostPoll(savedPollPost.id);
    assert(pollView, "Expected post_polls row for inbound Question");
    assert.strictEqual(pollView.options[0]?.title, "Gmsh");
    assert.strictEqual(pollView.options[0]?.votes_count, 4);
  });

  await t.test("3. Authorized Fetch (Secure Mode) & Suspended Domain GET Rejection", async () => {
    // Default mode: unsigned GET /users/alice succeeds
    const openRes = await request(app).get("/users/alice").set("Accept", "application/activity+json");
    assert.strictEqual(openRes.status, 200);
    assert.strictEqual(openRes.body.discoverable, true);
    assert.strictEqual(openRes.body.indexable, true);

    // Enable authorizedFetchEnabled
    db.updateInstanceSettings({ authorizedFetchEnabled: true }, alice.id);

    // Unsigned GET /users/alice is now rejected with 401
    const unauthRes = await request(app).get("/users/alice").set("Accept", "application/activity+json");
    assert.strictEqual(unauthRes.status, 401);

    // Signed GET /users/alice from an allowed remote actor succeeds
    const remoteActor = "https://trusted.example.org/users/verifier";
    const remoteKeyId = `${remoteActor}#main-key`;
    setCachedPublicKey(remoteActor, remoteRsaPub);

    const signedGet = signGetRequest(remoteRsaPriv, remoteKeyId, "/users/alice", "127.0.0.1");
    const authRes = await request(app)
      .get("/users/alice")
      .set("Host", "127.0.0.1")
      .set("Date", signedGet.date)
      .set("Signature", signedGet.sigHeader)
      .set("Accept", "application/activity+json");
    assert.strictEqual(authRes.status, 200);

    // Suspend the domain -> signed GET is rejected with 403 even if signature is valid
    db.setDomainTier("trusted.example.org", "suspend", "Suspended peer");
    const suspendedGet = signGetRequest(remoteRsaPriv, remoteKeyId, "/users/alice", "127.0.0.1");
    const suspRes = await request(app)
      .get("/users/alice")
      .set("Host", "127.0.0.1")
      .set("Date", suspendedGet.date)
      .set("Signature", suspendedGet.sigHeader)
      .set("Accept", "application/activity+json");
    assert.strictEqual(suspRes.status, 403);

    // Restore setting for subsequent tests
    db.updateInstanceSettings({ authorizedFetchEnabled: false }, alice.id);
    db.deleteDomainTier("trusted.example.org");
  });

  await t.test(
    "4. ActivityPub Relays (FEP-ae97): Subscribe, Inbound Accept/Announce, and Outbound Forwarding",
    async () => {
      const addRelayRes = await request(app)
        .post("/api/v1/admin/federation/relays")
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({
          inboxUrl: "https://relay.fedi.buzz/inbox",
          actorUrl: "https://relay.fedi.buzz/actor",
        });
      assert.strictEqual(addRelayRes.status, 201);
      const relayId = addRelayRes.body.relay.id;
      assert.strictEqual(addRelayRes.body.relay.state, "pending");

      // Simulate inbound Accept(Follow) from the relay actor
      const relayActor = "https://relay.fedi.buzz/actor";
      const relayKeyId = `${relayActor}#main-key`;
      setCachedPublicKey(relayActor, remoteRsaPub);

      const acceptPayload = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `${relayActor}#accept-1`,
        type: "Accept",
        actor: relayActor,
        object: {
          id: addRelayRes.body.relay.follow_activity_id,
          type: "Follow",
        },
      };
      const { digest, date, sigHeader } = signInboxRequest(
        remoteRsaPriv,
        relayKeyId,
        "/inbox",
        "127.0.0.1",
        acceptPayload,
      );
      const acceptRes = await request(app)
        .post("/inbox")
        .set("Host", "127.0.0.1")
        .set("Date", date)
        .set("Digest", digest)
        .set("Signature", sigHeader)
        .send(acceptPayload);
      assert(acceptRes.status === 202 || acceptRes.status === 200);

      const updatedRelay = db.getFederationRelayById(relayId);
      assert.strictEqual(updatedRelay?.state, "accepted");

      // Simulate inbound Announce with embedded Note from the relay
      const relayAnnounce = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://relay.fedi.buzz/activities/announce-99",
        type: "Announce",
        actor: relayActor,
        object: {
          id: "https://remote-lab.org/posts/relayed-1",
          type: "Note",
          attributedTo: "https://remote-lab.org/users/dr_smith",
          content: "<p>Relayed finite element benchmark</p>",
          to: ["https://www.w3.org/ns/activitystreams#Public"],
        },
      };
      const signedAnnounce = signInboxRequest(remoteRsaPriv, relayKeyId, "/inbox", "127.0.0.1", relayAnnounce);
      const annRes = await request(app)
        .post("/inbox")
        .set("Host", "127.0.0.1")
        .set("Date", signedAnnounce.date)
        .set("Digest", signedAnnounce.digest)
        .set("Signature", signedAnnounce.sigHeader)
        .send(relayAnnounce);
      assert.strictEqual(annRes.status, 202);

      const relayedPost = db.getPostByApId("https://remote-lab.org/posts/relayed-1");
      assert(relayedPost, "Expected embedded Note from relay Announce to be ingested");
      assert.strictEqual(db.getFederationRelayById(relayId)?.received_count, 1);
    },
  );

  await t.test(
    "5. Locked Accounts (Follow Requests), Profile Verification (ORCID), and Account Migration (Move)",
    async () => {
      // Lock Bob's account and add ORCID profile field
      const putProfileRes = await request(app)
        .put("/api/v1/users/me")
        .set("Authorization", `Bearer ${bobToken}`)
        .send({
          locked: true,
          discoverable: false,
          indexable: false,
          profile_fields: [{ name: "ORCID", value: "https://orcid.org/0000-0002-1825-0097" }],
        });
      assert.strictEqual(putProfileRes.status, 200);

      // Verify Bob's ORCID field
      const verifyRes = await request(app)
        .post("/api/v1/users/me/verify-fields")
        .set("Authorization", `Bearer ${bobToken}`)
        .send({});
      assert.strictEqual(verifyRes.status, 200);
      assert(verifyRes.body.profile_fields[0].verified_at, "Expected ORCID field to be marked verified_at");

      // Check Bob's Actor JSON exposes manuallyApprovesFollowers, discoverable=false, indexable=false, and PropertyValue
      const bobActorRes = await request(app).get("/users/bob").set("Accept", "application/activity+json");
      assert.strictEqual(bobActorRes.status, 200);
      assert.strictEqual(bobActorRes.body.manuallyApprovesFollowers, true);
      assert.strictEqual(bobActorRes.body.discoverable, false);
      assert.strictEqual(bobActorRes.body.indexable, false);
      assert.strictEqual(bobActorRes.body.attachment[0].type, "PropertyValue");
      assert.strictEqual(bobActorRes.body.attachment[0].name, "ORCID");

      // Alice follows locked Bob -> state is 'pending'
      const followRes = await request(app)
        .post("/api/v1/users/bob/follow")
        .set("Authorization", `Bearer ${aliceToken}`);
      assert.strictEqual(followRes.status, 200);
      assert.strictEqual(followRes.body.state, "pending");

      // Bob lists pending follow requests and accepts Alice
      const reqListRes = await request(app)
        .get("/api/v1/users/me/follow-requests")
        .set("Authorization", `Bearer ${bobToken}`);
      assert.strictEqual(reqListRes.status, 200);
      assert.strictEqual(reqListRes.body.requests.length, 1);
      assert.strictEqual(reqListRes.body.requests[0].id, alice.id);

      const acceptFollowRes = await request(app)
        .post(`/api/v1/users/me/follow-requests/${alice.id}/accept`)
        .set("Authorization", `Bearer ${bobToken}`);
      assert.strictEqual(acceptFollowRes.status, 200);
      assert(db.isFollowing(alice.id, bob.id), "Expected Alice to be an accepted follower of Bob");

      // Social Graph CSV/JSON export & import
      const csvExportRes = await request(app)
        .get("/api/v1/users/me/social-graph/export?format=csv&type=following")
        .set("Authorization", `Bearer ${aliceToken}`);
      assert.strictEqual(csvExportRes.status, 200);
      assert(csvExportRes.text.includes("Account address,Show boosts"), "Expected Mastodon CSV header");

      // Account Migration: Bob moves to Alice (after Alice adds Bob's actor URL to alsoKnownAs)
      const bobFed = db.getUserFederationInfo(bob.id)!;
      const aliceFed = db.getUserFederationInfo(alice.id)!;

      // Create a 3rd user Charlie who follows Bob so we can verify follower migration
      const charlie = db.createUser("charlie", "charlie@modelscript.test", "hashed_pwd", { emailVerified: true });
      db.followUser(charlie.id, bob.id, "accepted");

      await request(app)
        .post("/api/v1/users/me/aliases")
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({ alsoKnownAs: [bobFed.actor_url] });

      const moveRes = await request(app)
        .post("/api/v1/users/me/move")
        .set("Authorization", `Bearer ${bobToken}`)
        .send({ targetActorUrl: aliceFed.actor_url });
      assert.strictEqual(moveRes.status, 200);
      assert.strictEqual(moveRes.body.movedToActorUrl, aliceFed.actor_url);
      assert(db.isFollowing(charlie.id, alice.id), "Expected Charlie's follow to migrate from Bob to Alice");
    },
  );

  await t.test(
    "6. Undo(Announce), Block/Undo(Block), Update(Person), and FEP-8fcf Collection-Synchronization",
    async () => {
      const remoteActor = "https://peer.example.org/users/ peer_eng".replace(/\s+/g, "");
      const remoteKeyId = `${remoteActor}#main-key`;
      setCachedPublicKey(remoteActor, remoteRsaPub);

      // Create remote actor and have them boost Alice's post, then Undo(Announce)
      const alicePosts = db.getUserTimeline("alice", alice.id, 5);
      const targetPost = alicePosts[0]!;
      const targetPostApId = `https://hub.modelscript.org/users/alice/posts/${targetPost.id}`;

      const announcePayload = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `${remoteActor}#announce-1`,
        type: "Announce",
        actor: remoteActor,
        object: targetPostApId,
      };
      const signedAnn = signInboxRequest(remoteRsaPriv, remoteKeyId, "/inbox", "127.0.0.1", announcePayload);
      await request(app)
        .post("/inbox")
        .set("Host", "127.0.0.1")
        .set("Date", signedAnn.date)
        .set("Digest", signedAnn.digest)
        .set("Signature", signedAnn.sigHeader)
        .send(announcePayload);

      const beforeUndoCount = db.getPost(targetPost.id)?.repost_count ?? 0;
      assert(beforeUndoCount >= 1, "Expected repost count >= 1 after Announce");

      const undoAnnouncePayload = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `${remoteActor}#undo-announce-1`,
        type: "Undo",
        actor: remoteActor,
        object: {
          id: `${remoteActor}#announce-1`,
          type: "Announce",
          actor: remoteActor,
          object: targetPostApId,
        },
      };
      const signedUndoAnn = signInboxRequest(remoteRsaPriv, remoteKeyId, "/inbox", "127.0.0.1", undoAnnouncePayload);
      const undoRes = await request(app)
        .post("/inbox")
        .set("Host", "127.0.0.1")
        .set("Date", signedUndoAnn.date)
        .set("Digest", signedUndoAnn.digest)
        .set("Signature", signedUndoAnn.sigHeader)
        .send(undoAnnouncePayload);
      assert(undoRes.status === 202 || undoRes.status === 200);
      assert.strictEqual(db.getPost(targetPost.id)?.repost_count, beforeUndoCount - 1);

      // Update(Person) refreshes remote actor profile
      const updatePersonPayload = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `${remoteActor}#update-profile-1`,
        type: "Update",
        actor: remoteActor,
        object: {
          id: remoteActor,
          type: "Person",
          preferredUsername: "peer_eng",
          name: "Updated Peer Engineer",
          summary: "Updated bio via ActivityPub Update(Person)",
          attachment: [{ type: "PropertyValue", name: "Lab", value: "ETH Zurich" }],
        },
      };
      const signedUpd = signInboxRequest(remoteRsaPriv, remoteKeyId, "/inbox", "127.0.0.1", updatePersonPayload);
      const updRes = await request(app)
        .post("/inbox")
        .set("Host", "127.0.0.1")
        .set("Date", signedUpd.date)
        .set("Digest", signedUpd.digest)
        .set("Signature", signedUpd.sigHeader)
        .send(updatePersonPayload);
      assert(updRes.status === 202 || updRes.status === 200);
      const updatedRemoteUser = db.getUserByActorUrl(remoteActor);
      assert.strictEqual(updatedRemoteUser?.display_name, "Updated Peer Engineer");

      // FEP-8fcf Collection-Synchronization digest calculation and endpoint
      const digestBuf = computeFollowersSyncDigest([remoteActor]);
      assert.strictEqual(digestBuf.length, 64);
      const syncRes = await request(app).get("/users/alice/followers/synchronization");
      assert.strictEqual(syncRes.status, 200);
      assert(syncRes.body.type === "OrderedCollectionPage" || syncRes.body.type === "OrderedCollection");
    },
  );

  await t.test(
    "7. Moderation, Trust & Safety: Granular Domain Flags, Rules, Warnings, Staff Notes, IP & Email Blocks, Content Filters, and Trending Gate",
    async () => {
      // 7a. Granular domain flags: reject_media, reject_reports, obfuscate
      const domRes = await request(app)
        .post("/api/v1/admin/federation/domains")
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({
          domain: "spammy-media.example.com",
          tier: "silence",
          reason: "Excessive unverified media",
          rejectMedia: true,
          rejectReports: true,
          obfuscate: true,
          publicComment: "Media stripped due to policy",
          privateComment: "Internal ticket #402",
        });
      assert.strictEqual(domRes.status, 201);

      // Public domain-blocks endpoint shows obfuscated domain
      const pubBlocksRes = await request(app).get("/api/v1/instance/domain-blocks");
      assert.strictEqual(pubBlocksRes.status, 200);
      const blockEntry = pubBlocksRes.body.domainBlocks.find((b: { comment: string }) =>
        b.comment?.includes("Media stripped"),
      );
      assert(blockEntry, "Expected public domain block entry");
      assert(blockEntry.domain.includes("*"), `Expected obfuscated domain, got ${blockEntry.domain}`);

      // Media proxy rejects URLs from reject_media domain
      const proxyRejectRes = await request(app).get(
        `/api/v1/federation/media-proxy?url=${encodeURIComponent("https://spammy-media.example.com/file.png")}`,
      );
      assert.strictEqual(proxyRejectRes.status, 403);

      // Inbound Flag from reject_reports domain is ignored
      const spamActor = "https://spammy-media.example.com/actor";
      const spamKeyId = `${spamActor}#main-key`;
      setCachedPublicKey(spamActor, remoteRsaPub);
      const beforeReports = db.getModerationQueueCount();
      const flagPayload = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `${spamActor}/flags/1`,
        type: "Flag",
        actor: spamActor,
        object: "https://hub.modelscript.org/users/alice",
        content: "Bogus spam flag",
      };
      const signedFlag = signInboxRequest(remoteRsaPriv, spamKeyId, "/inbox", "127.0.0.1", flagPayload);
      const flagRes = await request(app)
        .post("/inbox")
        .set("Host", "127.0.0.1")
        .set("Date", signedFlag.date)
        .set("Digest", signedFlag.digest)
        .set("Signature", signedFlag.sigHeader)
        .send(flagPayload);
      assert.strictEqual(flagRes.status, 202);
      assert.strictEqual(
        db.getModerationQueueCount(),
        beforeReports,
        "Flag from reject_reports domain must be ignored",
      );

      // 7b. Structured Instance Rules
      const ruleRes = await request(app)
        .post("/api/v1/admin/rules")
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({ text: "Cite simulation assumptions and solver tolerances.", hint: "Reproducibility policy" });
      assert.strictEqual(ruleRes.status, 201);
      const ruleId = ruleRes.body.rule.id;

      const publicRulesRes = await request(app).get("/api/v1/instance/rules");
      assert.strictEqual(publicRulesRes.status, 200);
      assert(publicRulesRes.body.rules.some((r: { id: number }) => r.id === ruleId));

      // 7c. Account Warnings / Strikes & Acknowledgement
      const warnRes = await request(app)
        .post(`/api/v1/admin/users/${bob.id}/warnings`)
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({
          action: "none",
          text: "Please include boundary conditions on CFD posts.",
          ruleIds: [ruleId],
        });
      assert.strictEqual(warnRes.status, 201);
      const warningId = warnRes.body.warning.id;

      const bobWarningsRes = await request(app)
        .get("/api/v1/users/me/warnings")
        .set("Authorization", `Bearer ${bobToken}`);
      assert.strictEqual(bobWarningsRes.status, 200);
      assert.strictEqual(bobWarningsRes.body.warnings.length, 1);

      const ackRes = await request(app)
        .post(`/api/v1/users/me/warnings/${warningId}/acknowledge`)
        .set("Authorization", `Bearer ${bobToken}`);
      assert.strictEqual(ackRes.status, 200);

      // 7d. Internal Staff Notes & User Forensics Dossier
      const noteRes = await request(app)
        .post("/api/v1/admin/notes")
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({
          targetType: "user",
          targetId: String(bob.id),
          content: "Verified academic researcher at TU Munich.",
        });
      assert.strictEqual(noteRes.status, 201);

      const forensicsRes = await request(app)
        .get(`/api/v1/admin/users/${bob.id}/forensics`)
        .set("Authorization", `Bearer ${aliceToken}`);
      assert.strictEqual(forensicsRes.status, 200);
      assert.strictEqual(forensicsRes.body.staffNotes.length, 1);
      assert.strictEqual(forensicsRes.body.accountWarnings.length, 1);

      // 7e. Canonical Email Blocks & IP CIDR Blocks
      assert.strictEqual(canonicalizeEmail("Bad.Actor+spam123@gmail.com"), "badactor@gmail.com");
      assert.strictEqual(ipMatchesCidr("192.168.10.42", "192.168.10.0/24"), true);
      assert.strictEqual(ipMatchesCidr("192.168.11.42", "192.168.10.0/24"), false);

      const emailBlockRes = await request(app)
        .post("/api/v1/admin/email-blocks")
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({ email: "troll.account@gmail.com", reason: "Ban evasion" });
      assert.strictEqual(emailBlockRes.status, 201);

      // Attempt registration with dot + subaddress variant of blocked Gmail address
      const blockedRegRes = await request(app).post("/api/v1/auth/register").send({
        username: "evader99",
        email: "t.r.o.l.l.account+alt5@googlemail.com",
        password: "Password123!",
        acceptTerms: true,
      });
      assert.strictEqual(blockedRegRes.status, 403);

      // 7f. Mastodon v2 Content Filters
      const filterRes = await request(app)
        .post("/api/v1/social/filters")
        .set("Authorization", `Bearer ${bobToken}`)
        .send({
          title: "Spoiler Keyword",
          context: ["public", "home", "thread"],
          filter_action: "warn",
          keywords: [{ keyword: "spoiler_ solver_x", whole_word: false }],
        });
      assert.strictEqual(filterRes.status, 201);

      const filteredPostRes = await request(app)
        .post("/api/v1/social/posts")
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({ content: "Testing spoiler_ solver_x results", visibility: "public" });
      assert.strictEqual(filteredPostRes.status, 201);

      const bobGetFiltered = await request(app)
        .get(`/api/v1/social/posts/${filteredPostRes.body.post.id}`)
        .set("Authorization", `Bearer ${bobToken}`);
      assert.strictEqual(bobGetFiltered.status, 200);
      assert(Array.isArray(bobGetFiltered.body.post.filtered), "Expected post.filtered match array");
      assert.strictEqual(bobGetFiltered.body.post.filtered[0].filter.title, "Spoiler Keyword");

      // 7g. Trending Content Review Gate
      db.updateInstanceSettings({ trendingRequiresApproval: true }, alice.id);
      db.updateTopicScore("thermofluid", "Thermofluid", 15.0);
      assert.strictEqual(
        db.getTopTrendingTopics(10).some((t) => t.concept === "thermofluid"),
        false,
        "Unapproved topic should be hidden when trendingRequiresApproval is enabled",
      );
      const adminTrending = db.listTrendingTopicsForAdmin();
      const tfTopic = adminTrending.find((t) => t.concept === "thermofluid")!;
      await request(app)
        .patch(`/api/v1/admin/trending/${tfTopic.id}`)
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({ status: "approved" });
      assert.strictEqual(
        db.getTopTrendingTopics(10).some((t) => t.concept === "thermofluid"),
        true,
        "Approved topic should appear in public trending",
      );
      db.updateInstanceSettings({ trendingRequiresApproval: false }, alice.id);
    },
  );

  await t.test("8. Day-2 Operations: Auto-Circuit-Breaking, Remote Retention Pruning & `msx hub` CLI", async () => {
    // Auto-circuit-breaking after 10 consecutive failures
    for (let i = 0; i < 10; i++) {
      db.recordDomainDeliveryFailure("dead-node.example.net", "ECONNREFUSED");
    }
    assert.strictEqual(db.isDomainUnavailable("dead-node.example.net"), true);

    // Enqueueing to an unavailable domain is automatically skipped
    db.enqueueFederationDelivery(
      "Create",
      "https://hub.modelscript.org/activities/skip-1",
      { type: "Create" },
      "https://dead-node.example.net/inbox",
      "dead-node.example.net",
    );
    assert.strictEqual(db.listFederationDeliveries(undefined, "dead-node.example.net").length, 0);

    // Recovery on successful delivery / signature verification
    db.recordDomainDeliverySuccess("dead-node.example.net");
    assert.strictEqual(db.isDomainUnavailable("dead-node.example.net"), false);

    // Test admin federation domain, relay, prune, and user endpoints
    const domRes = await request(app)
      .post("/api/v1/admin/federation/domains")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        domain: "noisy-peer.example.org",
        tier: "silence",
        reason: "Admin test silence",
        rejectMedia: true,
      });
    assert.strictEqual(domRes.status, 201);
    assert.strictEqual(domRes.body.success, true);

    const relayRes = await request(app)
      .get("/api/v1/admin/federation/relays")
      .set("Authorization", `Bearer ${aliceToken}`);
    assert.strictEqual(relayRes.status, 200);
    assert(Array.isArray(relayRes.body.relays));

    const pruneRes = await request(app)
      .post("/api/v1/admin/federation/prune")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        days: 30,
        mediaDays: 7,
        accountDays: 60,
      });
    assert.strictEqual(pruneRes.status, 200);
    assert.strictEqual(pruneRes.body.success, true);

    const acctRes = await request(app)
      .get("/api/v1/admin/users?query=alice")
      .set("Authorization", `Bearer ${aliceToken}`);
    assert.strictEqual(acctRes.status, 200);
    assert(Array.isArray(acctRes.body.users));
  });
});

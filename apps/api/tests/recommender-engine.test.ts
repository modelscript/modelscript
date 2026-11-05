// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import jwt from "jsonwebtoken";

const JWT_SECRET = process.env["JWT_SECRET"] || "ansatz-dev-jwt-secret-do-not-use-in-prod";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { extractHashtags, extractTopics } from "../src/util/extract-topics.js";

test("Recommender Engine Suite: Home, Explore, Trending, Related Topics, Who to Follow, Repos & Search", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-recommender-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    try {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  const alice = db.createUser("alice_eng", "alice@example.com", "hash", { emailVerified: true });
  const bob = db.createUser("bob_thermo", "bob@example.com", "hash", { emailVerified: true });
  const carol = db.createUser("carol_controls", "carol@example.com", "hash", { emailVerified: true });
  const dave = db.createUser("dave_spammer", "dave@example.com", "hash", { emailVerified: true });
  const eve = db.createUser("eve_blocked", "eve@example.com", "hash", { emailVerified: true });

  await t.test("Topic extraction sanitizes fenced code, inline code, and ::artifact directives", () => {
    const content = [
      "Simulating #Thermofluid heat exchanger with #Modelica and `inline #ignoredtag`",
      '::artifact{id=42 type="#notatag"}',
      "```modelica",
      "// #codecomment should not be extracted",
      "Real x = 1.0;",
      "```",
    ].join("\n");

    const hashtags = extractHashtags(content).map((h) => h.concept);
    assert.deepEqual(hashtags, ["thermofluid", "modelica"]);

    const topics = extractTopics(content).map((tp) => tp.concept);
    assert.ok(topics.includes("thermofluid"));
    assert.ok(!topics.includes("codecomment"));
    assert.ok(!topics.includes("ignoredtag"));
  });

  await t.test("Onboarding persona seeds cold-start user_topics and populates For You feed", () => {
    // Bob posts about #Thermofluid and #FMI
    const { id: bobPostId } = db.createPost(
      bob.id,
      "New #Thermofluid and #FMI co-simulation benchmark for heat pumps!",
    );
    assert.ok(bobPostId > 0);

    // Alice completes onboarding with physical_systems persona (without following anyone yet)
    db.completeUserOnboarding(alice.id, "physical_systems");
    const aliceTopics = db.getUserTopics(alice.id);
    assert.ok(
      aliceTopics.some((tp) => tp.concept === "thermofluid" && Boolean(tp.is_active)),
      "Expected physical_systems persona to seed thermofluid topic",
    );

    const homeFeed = db.getHomeTimeline(alice.id, 20, 0);
    assert.ok(
      homeFeed.some((p) => p.id === bobPostId),
      "Expected cold-start user with physical_systems persona to see #Thermofluid post in Home feed",
    );
  });

  await t.test("Negative topic feedback (updateUserTopic is_active=0) hides topic from Home and Explore", () => {
    const { id: noisyPostId } = db.createPost(carol.id, "Unrelated #CryptoHype post that engineer wants to mute");
    db.updateUserTopic(alice.id, "#CryptoHype", true);
    assert.ok(db.getHomeTimeline(alice.id, 20, 0).some((p) => p.id === noisyPostId));

    // User clicks "Not interested in this" -> sets is_active = false
    db.updateUserTopic(alice.id, "#CryptoHype", false);
    assert.ok(
      !db.getHomeTimeline(alice.id, 20, 0).some((p) => p.id === noisyPostId),
      "Expected dismissed topic to be excluded from Home timeline",
    );
    assert.ok(
      !db.getExploreTimeline(alice.id, 20, 0).some((p) => p.id === noisyPostId),
      "Expected dismissed topic to be excluded from Explore timeline for that user",
    );
  });

  await t.test("toggleLike and toggleBookmark boost trending topics and derive user_topics", () => {
    const { id: carolPostId } = db.createPost(
      carol.id,
      "State-space LQR controller synthesis in #BondGraph and #ControlSystems",
    );
    const beforeTopics = db.getTopTrendingTopics(20);
    const beforeBondGraph = beforeTopics.find((tp) => tp.concept === "bondgraph")?.real_score ?? 0;

    // Alice likes and bookmarks Carol's post via toggleLike / toggleBookmark
    const liked = db.toggleLike(alice.id, carolPostId);
    assert.equal(liked, true);
    const bookmarked = db.toggleBookmark(alice.id, carolPostId);
    assert.equal(bookmarked, true);

    const afterTopics = db.getTopTrendingTopics(20);
    const afterBondGraph = afterTopics.find((tp) => tp.concept === "bondgraph")?.real_score ?? 0;
    assert.ok(
      afterBondGraph > beforeBondGraph,
      `Expected toggleLike + toggleBookmark to boost topic score (${afterBondGraph} > ${beforeBondGraph})`,
    );

    const aliceTopics = db.getUserTopics(alice.id);
    assert.ok(
      aliceTopics.some((tp) => tp.concept === "bondgraph" && Boolean(tp.is_active)),
      "Expected liked/bookmarked post topics to be derived into user_topics",
    );
  });

  await t.test("Trending topics apply per-author diminishing returns against single-user spam", () => {
    // Dave spams #DaveSpamTag 6 times in a row
    for (let i = 0; i < 6; i++) {
      db.createPost(dave.id, `Spam post ${i} with #DaveSpamTag`);
    }
    // Bob, Carol, and Alice each post once about #MultiAuthorTag (3 distinct authors)
    db.createPost(bob.id, "Collaborative study part 1 #MultiAuthorTag #Thermofluid");
    db.createPost(carol.id, "Collaborative study part 2 #MultiAuthorTag #ControlSystems");
    db.createPost(alice.id, "Collaborative study part 3 #MultiAuthorTag #Modelica");

    const trending = db.getTopTrendingTopics(25);
    const spamEntry = trending.find((tp) => tp.concept === "davespamtag");
    const communityEntry = trending.find((tp) => tp.concept === "multiauthortag");
    assert.ok(spamEntry && communityEntry);
    // 6 posts by 1 author with harmonic diminishing returns: 1 + 1/2 + 1/3 + 1/4 + 1/5 + 1/6 = 2.45 (much less than 6.0)
    assert.ok(
      spamEntry.current_score < 3.0,
      `Expected harmonic diminishing returns on single-author spam (got ${spamEntry.current_score})`,
    );
    assert.equal(communityEntry.unique_authors, 3);
  });

  await t.test("Related topics endpoint returns true co-occurring hashtags from post_topics", async () => {
    const res = await request(app).get("/api/v1/social/topics/Thermofluid/related?limit=5");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.topics));
    const relatedConcepts = res.body.topics.map((tp: { concept: string }) => tp.concept.toLowerCase());
    // #Thermofluid co-occurred with #FMI and #MultiAuthorTag in Bob's posts
    assert.ok(
      relatedConcepts.includes("fmi") || relatedConcepts.includes("multiauthortag"),
      `Expected co-occurring tags fmi or multiauthortag in ${JSON.stringify(relatedConcepts)}`,
    );
  });

  await t.test("Explore endpoint filters by search query ?q= instead of returning unrelated posts", async () => {
    const res = await request(app).get("/api/v1/social/explore?q=BondGraph&limit=20");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.posts));
    assert.equal(res.body.posts.length, 1);
    assert.ok(res.body.posts[0].content.includes("#BondGraph"));

    const emptyRes = await request(app).get("/api/v1/social/explore?q=nonexistent_gibberish_xyz987");
    assert.equal(emptyRes.status, 200);
    assert.equal(emptyRes.body.posts.length, 0);
  });

  await t.test("getTopicPosts enforces mute and block filters", () => {
    const { id: evePostId } = db.createPost(eve.id, "Blocked user post in #Thermofluid");
    assert.ok(db.getTopicPosts("thermofluid", alice.id).some((p) => p.id === evePostId));

    db.blockUser(alice.id, eve.id);
    assert.ok(
      !db.getTopicPosts("thermofluid", alice.id).some((p) => p.id === evePostId),
      "Expected blocked user's post to be hidden from getTopicPosts",
    );
  });

  await t.test(
    "Who to Follow (getUserSuggestions) ranks 2-hop graph & shared topics and excludes blocked users",
    () => {
      // Alice follows Bob; Bob follows Carol -> Carol is a 2-hop friend-of-friend for Alice AND shares topics
      db.followUser(alice.id, bob.id);
      db.followUser(bob.id, carol.id);

      const suggestions = db.getUserSuggestions(alice.id, 10);
      // Should not include Alice herself, Bob (already followed), or Eve (blocked)
      assert.ok(!suggestions.some((u) => u.id === alice.id));
      assert.ok(!suggestions.some((u) => u.id === bob.id));
      assert.ok(!suggestions.some((u) => u.id === eve.id));

      // Carol should be suggested #1 with a recommendation_reason mentioning @bob_thermo
      assert.ok(suggestions.length > 0);
      assert.equal(suggestions[0]!.id, carol.id);
      assert.ok(
        suggestions[0]!.recommendation_reason?.includes("@bob_thermo"),
        `Expected recommendation_reason to mention @bob_thermo, got: ${suggestions[0]!.recommendation_reason}`,
      );
    },
  );

  await t.test("getPopularRepos ranks repositories by community links, citations, and webhooks", () => {
    const repoLow = db.linkRepo(dave.id, "github", "ext-1", "dave/old-unused-repo", "main", "Unused repo");
    const repoHigh = db.linkRepo(bob.id, "github", "ext-2", "bob/thermo-solver", "main", "High activity solver");
    assert.ok(repoLow && repoHigh);

    // Carol also links bob/thermo-solver and cites it in a public post
    db.linkRepo(carol.id, "github", "ext-2", "bob/thermo-solver", "main", "High activity solver");
    db.createPost(carol.id, "Validating bob/thermo-solver on our latest benchmark!");

    const popular = db.getPopularRepos(5);
    const highIdx = popular.findIndex((r) => r.project === "thermo-solver");
    const lowIdx = popular.findIndex((r) => r.project === "old-unused-repo");
    assert.ok(highIdx !== -1 && lowIdx !== -1);
    assert.ok(highIdx < lowIdx, "Expected cited & multi-linked repo to rank above older unused repo");
  });

  await t.test(
    "GET /api/v1/libraries ranks packages by downloads, reverse-dependencies, and query match instead of alphabetical order",
    async () => {
      // Create an alphabetically-first unused package "AardvarkScratch"
      const { id: pkgA } = db.getOrCreatePackage("AardvarkScratch");
      db.updatePackageMeta(pkgA, { description: "Unused scratch library", license: "MIT" });
      db.storePackageVersion(
        pkgA,
        "1.0.0",
        "file:///tmp/a.zip",
        "sha-a",
        null,
        100,
        JSON.stringify({ name: "AardvarkScratch", version: "1.0.0", modelscript: { domains: ["cad"] } }),
        null,
        dave.id,
      );
      db.setDistTag(pkgA, "latest", "1.0.0");

      // Create an alphabetically-later core package "ZeusThermoCore" with downloads and a dependent package
      const { id: pkgZ } = db.getOrCreatePackage("ZeusThermoCore");
      db.updatePackageMeta(pkgZ, { description: "Core thermofluid & FMI library", license: "MPL-2.0" });
      db.storePackageVersion(
        pkgZ,
        "2.0.0",
        "file:///tmp/z.zip",
        "sha-z",
        null,
        500,
        JSON.stringify({ name: "ZeusThermoCore", version: "2.0.0", modelscript: { domains: ["modelica", "fmu"] } }),
        null,
        bob.id,
      );
      db.setDistTag(pkgZ, "latest", "2.0.0");

      // Create a dependent package that depends on ZeusThermoCore
      const { id: pkgDep } = db.getOrCreatePackage("PropulsionApp");
      db.updatePackageMeta(pkgDep, { description: "Propulsion system model", license: "MIT" });
      db.storePackageVersion(
        pkgDep,
        "1.0.0",
        "file:///tmp/dep.zip",
        "sha-dep",
        null,
        200,
        JSON.stringify({
          name: "PropulsionApp",
          version: "1.0.0",
          dependencies: { ZeusThermoCore: "^2.0.0" },
          modelscript: { domains: ["modelica"] },
        }),
        null,
        carol.id,
      );
      db.setDistTag(pkgDep, "latest", "1.0.0");

      // Record downloads for ZeusThermoCore
      db.recordPackageDownload("ZeusThermoCore", "2.0.0");
      db.recordPackageDownload("ZeusThermoCore", "2.0.0");
      db.recordPackageDownload("ZeusThermoCore", "2.0.0");

      const res = await request(app).get("/api/v1/libraries").expect(200);
      const pkgs = res.body.packages as {
        name: string;
        dependentsCount: number;
        totalDownloads: number;
        recommendationScore: number;
        recommendationReason?: string;
      }[];

      const zIdx = pkgs.findIndex((p) => p.name === "ZeusThermoCore");
      const aIdx = pkgs.findIndex((p) => p.name === "AardvarkScratch");
      assert.ok(zIdx !== -1 && aIdx !== -1);
      assert.equal(pkgs[zIdx]!.dependentsCount, 1);
      assert.equal(pkgs[zIdx]!.totalDownloads, 3);
      assert.ok(
        zIdx < aIdx,
        `Expected ZeusThermoCore (idx ${zIdx}, score ${pkgs[zIdx]!.recommendationScore}) to rank above AardvarkScratch (idx ${aIdx}, score ${pkgs[aIdx]!.recommendationScore})`,
      );
      assert.ok(pkgs[zIdx]!.recommendationReason?.includes("Used by 1 package"));

      // Verify ?sort=name still supports explicit alphabetical sorting
      const alphaRes = await request(app).get("/api/v1/libraries?sort=name").expect(200);
      const alphaPkgs = alphaRes.body.packages as { name: string }[];
      assert.ok(
        alphaPkgs.findIndex((p) => p.name === "AardvarkScratch") <
          alphaPkgs.findIndex((p) => p.name === "ZeusThermoCore"),
      );

      // Verify that active topic #ibr does not falsely match words containing "ibr" (e.g. "library")
      // and that "Matches #" is never returned as recommendationReason on packages
      db.updateUserTopic(alice.id, "ibr", true);
      const aliceToken = jwt.sign({ id: alice.id, username: alice.username, email: alice.email }, JWT_SECRET);
      const authRes = await request(app)
        .get("/api/v1/libraries")
        .set("Authorization", `Bearer ${aliceToken}`)
        .expect(200);
      const authPkgs = authRes.body.packages as { name: string; recommendationReason?: string }[];
      for (const p of authPkgs) {
        assert.ok(
          !p.recommendationReason?.includes("Matches #"),
          `Package ${p.name} had unexpected recommendationReason: ${p.recommendationReason}`,
        );
      }
    },
  );
});

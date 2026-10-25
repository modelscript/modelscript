// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LibraryDatabase } from "../src/database.js";
import { DeterministicEngineeringProvider } from "../src/services/ai/llm-client.js";
import { RepoBotReviewer } from "../src/services/ai/repo-bot-reviewer.js";

test("Repo Bot Review: Automated Modelica code and PR verification", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-repo-review-test-"));
  const dbPath = path.join(tempDir, "test.db");
  const db = new LibraryDatabase(dbPath);

  t.after(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // 1. Create user and link repository
  const user = db.createUser("robotics_engineer", "robotics@example.com", "hash123");
  db.linkRepo(user.id, "github", "ext-repo-99", "robotics/quadruped_dynamics", "main", "Quadruped simulation repo");
  const linkedRepos = db.getLinkedRepos(user.id);
  assert.equal(linkedRepos.length, 1);
  const repo = linkedRepos[0];

  // 2. Create bot with modelica:validate and social:write scopes
  const bot = db.createBot(
    user.id,
    "reviewer_bot",
    "Modelica Code Reviewer",
    "Automated PR code reviewer",
    "https://example.com/bot.png",
    "token_hash_reviewer",
    "social:read,social:write,modelica:validate",
    "You are an expert Modelica reviewer.",
    "gemini-1.5-flash",
  );

  // 3. Instantiate reviewer with deterministic provider
  const llm = new DeterministicEngineeringProvider();
  const reviewer = new RepoBotReviewer(db, llm);

  // 4. Test review with valid Modelica model
  const validModelica = `
model QuadrupedLeg
  parameter Real m = 2.5 "Link mass";
  Real theta(start = 0.1);
  Real omega;
equation
  der(theta) = omega;
  m * der(omega) = -9.81 * sin(theta);
end QuadrupedLeg;
`;

  const reviewResult = await reviewer.review({
    repoId: repo.id,
    botId: bot.id,
    prNumber: 42,
    commitSha: "a1b2c3d4e5",
    title: "Add non-linear knee actuator dynamics",
    diffContent: validModelica,
  });

  assert.ok(reviewResult.reviewId > 0, "Review record must be created");
  assert.equal(reviewResult.verdict, "APPROVE");
  assert.ok(reviewResult.summary.length > 0);
  assert.ok(reviewResult.postId !== undefined, "Should create social post for visibility");

  // 5. Query reviews from database
  const reviews = db.getRepoBotReviews(repo.id);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0]?.pr_number, 42);
  assert.equal(reviews[0]?.verdict, "APPROVE");
  assert.equal(reviews[0]?.bot_username, "reviewer_bot");

  // 6. Test review on model with mismatched model/end
  const invalidModelica = `
model UnclosedModel
  Real x;
equation
  der(x) = 1.0;
`;

  const invalidResult = await reviewer.review({
    repoId: repo.id,
    botId: bot.id,
    prNumber: 43,
    title: "Broken syntax experiment",
    diffContent: invalidModelica,
  });

  assert.equal(invalidResult.verdict, "COMMENT");
  assert.ok(invalidResult.issues.length > 0, "Should detect mismatched model/end statements");
  assert.ok(invalidResult.issues.some((i) => i.message.includes("Mismatched 'model'")));

  const allReviews = db.getRepoBotReviews(repo.id);
  assert.equal(allReviews.length, 2);
});

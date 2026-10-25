// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LibraryDatabase } from "../src/database.js";
import { DeterministicEngineeringProvider } from "../src/services/ai/llm-client.js";
import { SocialBotOrchestrator } from "../src/services/ai/social-bot-orchestrator.js";
import { BotMentionWorker } from "../src/services/bot-mention-worker.js";

test("Social Bot Pipeline: Bot registration, mention dispatch, anti-loop safeguard, and LLM reply", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-bot-test-"));
  const dbPath = path.join(tempDir, "test.db");
  const db = new LibraryDatabase(dbPath);

  t.after(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  try {
    // 1. Create a human owner
    const human = db.createUser("eng_lead", "lead@example.com", "hash123");
    console.log("Created human:", human.id);

    // 2. Create an engineering bot with custom scopes and prompt
    const bot = db.createBot(
      human.id,
      "dynamics_bot",
      "Dynamics AI Bot",
      "Automated mechanical engineer bot",
      "https://example.com/bot.png",
      "token_hash_dynamics_123",
      "social:read,social:write",
      "You are DynamicsBot, an expert in pendulum and mechanical vibration equations.",
      "gemini-1.5-flash",
    );
    console.log("Created bot:", bot.id);

    // 3. Human creates a post mentioning the bot
    const humanPost = db.createPost(
      human.id,
      "Hey @dynamics_bot, can you analyze a damped oscillator modelica model for me?",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "public",
    );
    console.log("Created post:", humanPost.id);

    // 4. Enqueue mention job
    const queueId = db.enqueueBotMention(bot.id, humanPost.id, human.id);
    console.log("Enqueued mention:", queueId);

    // 5. Process queue using SocialBotOrchestrator with DeterministicEngineeringProvider
    const orchestrator = new SocialBotOrchestrator(db, {
      llmProvider: new DeterministicEngineeringProvider(),
    });
    const worker = new BotMentionWorker(db, orchestrator);
    const processedCount = await worker.processQueue();
    assert.equal(processedCount, 1);

    // 6. Verify mention job marked completed
    const remainingPending = db.getPendingBotMentions();
    assert.equal(remainingPending.length, 0);

    // 7. Verify reply post created by bot in thread with vega-plot simulation artifact
    const botReplies = db.getReplies(humanPost.id);
    assert.equal(botReplies.length, 1);
    assert.equal(botReplies[0].author_id, bot.id);
    assert.ok(botReplies[0].content.includes("model DynamicSystem"));
    assert.ok(botReplies[0].content.includes("der(phi) = w"));
    assert.ok(botReplies[0].artifact_view_id > 0);

    const artifactView = db.getArtifactView(botReplies[0].artifact_view_id);
    assert.ok(artifactView);
    assert.equal(artifactView.view_type, "vega-plot");
    const parsedConfig = JSON.parse(artifactView.view_config);
    assert.ok(Array.isArray(parsedConfig.data));
    assert.ok(parsedConfig.data.length > 0);
    assert.equal(parsedConfig.data[0].variable, "angle (rad)");

    // 8. Test anti-loop safeguard: A bot mentioning another bot does not produce an infinite response cycle
    const rogueBot = db.createBot(human.id, "loop_bot", "Loop Bot", "Test loop bot", "", "token_hash_loop_456");
    const rogueBotPost = db.createPost(
      rogueBot.id,
      "Hey @dynamics_bot say hello back!",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "public",
    );
    const loopQueueId = db.enqueueBotMention(bot.id, rogueBotPost.id, rogueBot.id);
    assert.ok(loopQueueId > 0);

    const loopResult = await orchestrator.processMention(loopQueueId);
    assert.equal(loopResult.success, false);
    assert.ok(loopResult.error?.includes("Anti-loop safeguard triggered"));

    // 9. Update bot settings via updateBotSettings
    db.updateBotSettings(human.id, bot.id, {
      displayName: "Dynamics SuperBot",
      systemPrompt: "Updated system prompt",
    });
    const updated = db.getBotById(bot.id);
    assert.equal(updated?.display_name, "Dynamics SuperBot");
    assert.equal(updated?.bot_system_prompt, "Updated system prompt");
  } catch (err) {
    console.error("DEBUG FAILING STEP:", err);
    throw err;
  }
});

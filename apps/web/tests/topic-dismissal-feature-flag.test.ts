// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { FEATURE_FLAGS } from "../../../apps/api/src/feature-flags.js";
import { DEFAULT_FRONTEND_FLAGS } from "../src/FeatureFlagContext.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Trending Topic Dismissal Menu Feature Flag & Auth Gating", () => {
  it("verifies topic_dismissal and trending_topic_dismissal are disabled by default in frontend flags", () => {
    assert.strictEqual(DEFAULT_FRONTEND_FLAGS.topic_dismissal, false, "topic_dismissal must be false by default");
    assert.strictEqual(
      DEFAULT_FRONTEND_FLAGS.trending_topic_dismissal,
      false,
      "trending_topic_dismissal alias must be false by default",
    );
  });

  it("verifies topic_dismissal and trending_topic_dismissal are defined in backend FEATURE_FLAGS", () => {
    assert.ok(FEATURE_FLAGS.topic_dismissal, "topic_dismissal must be defined in backend feature flags");
    assert.strictEqual(FEATURE_FLAGS.topic_dismissal.defaultValue, false);
    assert.strictEqual(FEATURE_FLAGS.topic_dismissal.category, "social");

    assert.ok(FEATURE_FLAGS.trending_topic_dismissal, "trending_topic_dismissal alias must be defined in backend");
    assert.strictEqual(FEATURE_FLAGS.trending_topic_dismissal.defaultValue, false);
    assert.strictEqual(FEATURE_FLAGS.trending_topic_dismissal.category, "social");
  });

  it("verifies TrendingTopicsCard.tsx gates kebab menu behind both user authentication and feature flag", () => {
    const cardPath = path.resolve(__dirname, "../src/components/right-panel/components/TrendingTopicsCard.tsx");
    const content = fs.readFileSync(cardPath, "utf-8");

    assert.ok(content.includes("useAuth"), "TrendingTopicsCard must import useAuth");
    assert.ok(content.includes("useFeatureFlag"), "TrendingTopicsCard must import useFeatureFlag");

    assert.ok(
      content.includes('useFeatureFlag(["topic_dismissal", "trending_topic_dismissal"])') ||
        content.includes('useFeatureFlag("topic_dismissal") || useFeatureFlag("trending_topic_dismissal")'),
      "TrendingTopicsCard must check topic_dismissal flag with alias",
    );
    assert.ok(
      content.includes("const canDismiss = Boolean(user && hasTopicDismissal);"),
      "canDismiss must require both user (logged in) and hasTopicDismissal flag",
    );

    assert.ok(
      content.includes(
        "{canDismiss && (\n                  <Box\n                    ref={activeTrendMenu === topicKey ? menuContainerRef : undefined}",
      ),
      "Kebab button container must be conditionally rendered with {canDismiss && ...}",
    );

    assert.ok(
      content.includes("if (!canDismiss) return;"),
      "handleDismissTopic must abort early if canDismiss is false",
    );

    assert.ok(
      content.includes("if (!canDismiss) return true;"),
      "visibleTrending must not filter out dismissed IDs when canDismiss is false",
    );
  });

  it("verifies DevFlagsModal.tsx registers topic_dismissal metadata", () => {
    const devFlagsPath = path.resolve(__dirname, "../src/components/DevFlagsModal.tsx");
    const content = fs.readFileSync(devFlagsPath, "utf-8");

    assert.ok(content.includes("topic_dismissal: {"), "DevFlagsModal must register topic_dismissal metadata");
  });
});

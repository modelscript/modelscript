// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { TOPIC_TABS } from "../src/pages/explore/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Explore Topic View Tabs UI/UX", () => {
  it("defines Top and Latest as canonical topic tabs", () => {
    assert.deepEqual(TOPIC_TABS, ["Top", "Latest"], "TOPIC_TABS must include Top and Latest");
  });

  it("verifies ExploreTopicView renders TOPIC_TABS instead of rigid artifact tabs", () => {
    const topicViewSrc = fs.readFileSync(path.resolve(__dirname, "../src/pages/explore/ExploreTopicView.tsx"), "utf-8");

    assert.ok(topicViewSrc.includes("TOPIC_TABS.map"), "ExploreTopicView.tsx must map over TOPIC_TABS");
    assert.ok(
      !topicViewSrc.includes("TOPIC_ARTIFACT_TABS.map"),
      "ExploreTopicView.tsx must not map over TOPIC_ARTIFACT_TABS",
    );
  });

  it("verifies ExplorePage.tsx maps topic tabs to sort parameter for getTopicPosts", () => {
    const explorePageSrc = fs.readFileSync(path.resolve(__dirname, "../src/pages/ExplorePage.tsx"), "utf-8");

    assert.ok(
      explorePageSrc.includes('sort: topicFilter === "latest" ? "recent" : "top"'),
      "ExplorePage.tsx must query getTopicPosts with recent vs top sort parameter based on active tab",
    );
    assert.ok(
      explorePageSrc.includes("}, [topic, topicFilter, token]);"),
      "ExplorePage.tsx must preserve topicFilter dependency array invariant",
    );
  });
});

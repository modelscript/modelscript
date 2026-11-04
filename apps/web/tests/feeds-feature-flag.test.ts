// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_FRONTEND_FLAGS } from "../src/FeatureFlagContext.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Feeds Page Feature Flag Gating", () => {
  it("verifies feeds_page and rss_feeds flags are disabled by default in DEFAULT_FRONTEND_FLAGS", () => {
    assert.strictEqual(DEFAULT_FRONTEND_FLAGS.feeds_page, false, "feeds_page must be false by default");
    assert.strictEqual(DEFAULT_FRONTEND_FLAGS.rss_feeds, false, "rss_feeds must be false by default");
  });

  it("verifies Sidebar.tsx conditionally renders the Feeds link based on hasFeeds feature flag", () => {
    const sidebarPath = path.resolve(__dirname, "../src/components/Sidebar.tsx");
    const content = fs.readFileSync(sidebarPath, "utf-8");

    assert.ok(
      content.includes('const hasFeeds = useFeatureFlag(["feeds_page", "rss_feeds"]);') ||
        content.includes('const hasFeeds = useFeatureFlag("feeds_page") || useFeatureFlag("rss_feeds");'),
      "Sidebar.tsx must check hasFeeds using feeds_page and rss_feeds feature flags",
    );
    assert.ok(
      content.includes("if (hasFeeds)") &&
        content.includes('communityLinks.push({ to: "/feeds", icon: RssIcon, label: "Feeds" });'),
      "Sidebar.tsx must only push /feeds to communityLinks when hasFeeds is true",
    );
  });

  it("verifies AppShell.tsx conditionally renders the Feeds link in MoreSheet based on hasFeeds", () => {
    const appShellPath = path.resolve(__dirname, "../src/components/AppShell.tsx");
    const content = fs.readFileSync(appShellPath, "utf-8");

    assert.ok(
      content.includes('const hasFeeds = useFeatureFlag(["feeds_page", "rss_feeds"]);') ||
        content.includes('const hasFeeds = useFeatureFlag("feeds_page") || useFeatureFlag("rss_feeds");'),
      "AppShell.tsx must evaluate hasFeeds flag",
    );
    assert.ok(
      content.includes('{hasFeeds && (\n                        <Link to="/feeds"'),
      "AppShell.tsx must gate the /feeds link inside MoreSheet behind hasFeeds",
    );
  });

  it("verifies App.tsx routes /feeds conditionally and gates 'g f' keyboard shortcut", () => {
    const appPath = path.resolve(__dirname, "../src/App.tsx");
    const content = fs.readFileSync(appPath, "utf-8");

    assert.ok(
      content.includes('const hasFeeds = useFeatureFlag(["feeds_page", "rss_feeds"]);') ||
        content.includes('const hasFeeds = useFeatureFlag("feeds_page") || useFeatureFlag("rss_feeds");'),
      "App.tsx must evaluate hasFeeds flag in App() and GlobalModals",
    );
    assert.ok(
      content.includes('path="/feeds"') && content.includes("hasFeeds ? (") && content.includes("<Navigate to="),
      "App.tsx must redirect from /feeds when hasFeeds is false",
    );
    assert.ok(
      content.includes(
        'if (hasFeeds) {\n            e.preventDefault();\n            navWithScroll("/feeds");\n          }',
      ),
      "App.tsx must only trigger 'g f' navigation when hasFeeds is true",
    );
  });

  it("verifies KeyboardShortcutsModal.tsx filters out 'g f' RSS shortcut when hasFeeds is false", () => {
    const modalPath = path.resolve(__dirname, "../src/components/KeyboardShortcutsModal.tsx");
    const content = fs.readFileSync(modalPath, "utf-8");

    assert.ok(
      content.includes('const hasFeeds = useFeatureFlag(["feeds_page", "rss_feeds"]);') ||
        content.includes('const hasFeeds = useFeatureFlag("feeds_page") || useFeatureFlag("rss_feeds");'),
      "KeyboardShortcutsModal.tsx must evaluate hasFeeds",
    );
    assert.ok(
      content.includes('!item.keys.includes("f")'),
      "KeyboardShortcutsModal.tsx must filter out 'f' shortcut when hasFeeds is disabled",
    );
  });

  it("verifies FeedsPage.tsx checks hasFeeds and redirects when feature flag is disabled", () => {
    const feedsPagePath = path.resolve(__dirname, "../src/pages/FeedsPage.tsx");
    const content = fs.readFileSync(feedsPagePath, "utf-8");

    assert.ok(
      content.includes('const hasFeeds = useFeatureFlag(["feeds_page", "rss_feeds"]);') ||
        content.includes('const hasFeeds = useFeatureFlag("feeds_page") || useFeatureFlag("rss_feeds");'),
      "FeedsPage.tsx must check hasFeeds",
    );
    assert.ok(
      content.includes('if (!hasFeeds) {\n    return <Navigate to="/" replace />;\n  }'),
      "FeedsPage.tsx must redirect when hasFeeds is false",
    );
  });

  it("verifies DevFlagsModal.tsx registers metadata for feeds_page and rss_feeds", () => {
    const devFlagsPath = path.resolve(__dirname, "../src/components/DevFlagsModal.tsx");
    const content = fs.readFileSync(devFlagsPath, "utf-8");

    assert.ok(content.includes("feeds_page: {"), "DevFlagsModal must define feeds_page metadata");
    assert.ok(content.includes("rss_feeds: {"), "DevFlagsModal must define rss_feeds metadata");
  });
});

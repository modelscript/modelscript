// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC_DIR = path.resolve(__dirname, "../src");

describe("Settings Page, Deep Search Index, Dynamic Instance URLs & Accessibility", () => {
  it("SettingsPage defines a comprehensive DEEP_SETTINGS_INDEX covering all 13 settings sections", () => {
    const settingsPageSrc = fs.readFileSync(path.join(WEB_SRC_DIR, "pages/SettingsPage.tsx"), "utf-8");

    assert.ok(
      settingsPageSrc.includes("export const DEEP_SETTINGS_INDEX: DeepSettingEntry[]"),
      "SettingsPage.tsx must export DEEP_SETTINGS_INDEX",
    );

    const requiredTabTargets = [
      'tab: "account"',
      'tab: "security"',
      'tab: "connectedAccounts"',
      'tab: "modeling"',
      'tab: "displayAndLanguages"',
      'tab: "notifications"',
      'tab: "privacy"',
      'tab: "dataArchive"',
      'tab: "tokens"',
      'tab: "bots"',
      'tab: "organizations"',
      'tab: "billing"',
      'tab: "invites"',
      'tab: "deleteAccount"',
    ];

    for (const target of requiredTabTargets) {
      assert.ok(settingsPageSrc.includes(target), `DEEP_SETTINGS_INDEX must include entries targeting ${target}`);
    }
  });

  it("PrivacyTab dynamically resolves local actor URLs from window.location.origin instead of hardcoded hub.modelscript.org", async () => {
    const privacyTabSrc = fs.readFileSync(path.join(WEB_SRC_DIR, "pages/settings/tabs/PrivacyTab.tsx"), "utf-8");
    assert.ok(
      privacyTabSrc.includes("export function resolveLocalActorUrl"),
      "PrivacyTab.tsx must export resolveLocalActorUrl",
    );
    assert.ok(
      !privacyTabSrc.includes("`${origin}/ap/users/"),
      "PrivacyTab.tsx must not use invalid /ap/users/ fallback paths",
    );

    const { resolveLocalActorUrl } = await import("../src/util/federation.js");
    assert.strictEqual(
      resolveLocalActorUrl("omar", "https://hub.modelscript.org/users/omar", "http://localhost:3001"),
      "http://localhost:3001/users/omar",
    );
    assert.strictEqual(resolveLocalActorUrl("omar", null, "http://localhost:3001"), "http://localhost:3001/users/omar");
    assert.strictEqual(
      resolveLocalActorUrl("omar", "https://hub.modelscript.org/users/omar", "https://hub.modelscript.org"),
      "https://hub.modelscript.org/users/omar",
    );
    assert.strictEqual(
      resolveLocalActorUrl("omar", "https://custom.engineering.io/users/omar", "http://localhost:3001"),
      "https://custom.engineering.io/users/omar",
    );
  });

  it("App.tsx registers /users/:username routes and ProfilePage strips leading @ from username params", () => {
    const appSrc = fs.readFileSync(path.join(WEB_SRC_DIR, "App.tsx"), "utf-8");
    assert.ok(
      appSrc.includes('path="/users/:username"'),
      "App.tsx must mount /users/:username so actor and profile URLs resolve in the browser",
    );
    assert.ok(
      appSrc.includes('path="/users/:username/followers"') && appSrc.includes('path="/users/:username/following"'),
      "App.tsx must mount /users/:username/followers and /users/:username/following",
    );

    const profilePageSrc = fs.readFileSync(path.join(WEB_SRC_DIR, "pages/ProfilePage.tsx"), "utf-8");
    assert.ok(
      profilePageSrc.includes('rawUsername?.startsWith("@") ? rawUsername.slice(1) : rawUsername'),
      "ProfilePage.tsx must normalize @username route params",
    );
  });

  it("RealtimeNotificationListener respects inAppSounds and channels.inApp preferences", () => {
    const listenerSrc = fs.readFileSync(path.join(WEB_SRC_DIR, "components/RealtimeNotificationListener.tsx"), "utf-8");
    assert.ok(
      listenerSrc.includes("getCachedNotificationPreferences"),
      "RealtimeNotificationListener must read cached notification preferences",
    );
    assert.ok(
      listenerSrc.includes("prefs.inAppSounds !== false"),
      "RealtimeNotificationListener must check prefs.inAppSounds before playing chime",
    );
  });

  it("ComposeBox initializes and syncs post visibility from user.default_post_visibility", () => {
    const composeSrc = fs.readFileSync(path.join(WEB_SRC_DIR, "components/ComposeBox.tsx"), "utf-8");
    assert.ok(
      composeSrc.includes("user?.default_post_visibility"),
      "ComposeBox.tsx must read user?.default_post_visibility",
    );
    assert.ok(
      composeSrc.includes("visibility: postVisibility"),
      "ComposeBox.tsx must pass postVisibility to useComposeSubmit",
    );
  });

  it("theme.ts hydrates display accessibility attributes on boot", () => {
    const themeSrc = fs.readFileSync(path.join(WEB_SRC_DIR, "theme.ts"), "utf-8");
    assert.ok(
      themeSrc.includes("hydrateDisplayAccessibilityPreferences"),
      "theme.ts must export and invoke hydrateDisplayAccessibilityPreferences",
    );
    assert.ok(
      themeSrc.includes("data-density") &&
        themeSrc.includes("data-reduced-motion") &&
        themeSrc.includes("data-high-contrast"),
      "theme.ts must apply data-density, data-reduced-motion, and data-high-contrast attributes",
    );
  });

  it("index.html and App.tsx prevent font and page flickering on load", () => {
    const indexHtml = fs.readFileSync(path.join(WEB_SRC_DIR, "../index.html"), "utf-8");
    assert.ok(
      indexHtml.includes("https://fonts.googleapis.com") && indexHtml.includes("https://fonts.gstatic.com"),
      "index.html must preconnect to fonts.googleapis.com and fonts.gstatic.com",
    );
    assert.ok(
      indexHtml.includes("family=Inter") && indexHtml.includes("family=JetBrains+Mono"),
      "index.html must link Inter and JetBrains Mono fonts upfront",
    );
    assert.ok(
      indexHtml.includes('html[data-theme="dark"]') && indexHtml.includes("#0a0f1c"),
      "index.html must define critical inline dark styles to prevent white flash",
    );
    assert.ok(
      indexHtml.includes("modelscript_display_accessibility"),
      "index.html must pre-hydrate display and accessibility preferences in head",
    );

    const appSrc = fs.readFileSync(path.join(WEB_SRC_DIR, "App.tsx"), "utf-8");
    assert.ok(
      !appSrc.includes("if (isLoading || isFlagsLoading)"),
      "App.tsx must not gate the entire application with an unstyled loading fallback",
    );

    const cssSrc = fs.readFileSync(path.join(WEB_SRC_DIR, "index.css"), "utf-8");
    assert.ok(
      cssSrc.includes("theme-transitioning"),
      "index.css must scope theme transitions to theme-transitioning class",
    );
  });

  it("prevents font and page flickering on scroll down and back up", () => {
    // 1. packages/diagram must never include @import url() in generated SVGs
    const svgRendererPath = path.resolve(WEB_SRC_DIR, "../../../packages/diagram/src/svg-renderer.ts");
    const diffRendererPath = path.resolve(WEB_SRC_DIR, "../../../packages/diagram/src/visual-diff-renderer.ts");
    const svgRendererSrc = fs.readFileSync(svgRendererPath, "utf-8");
    const diffRendererSrc = fs.readFileSync(diffRendererPath, "utf-8");
    assert.ok(!svgRendererSrc.includes("@import url"), "svg-renderer.ts must not inject @import url into SVG defs");
    assert.ok(
      !diffRendererSrc.includes("@import url"),
      "visual-diff-renderer.ts must not inject @import url into SVG defs",
    );

    // 2. Sanitizers in web app must strip any @import rules from embedded SVGs
    const polyglotViewerSrc = fs.readFileSync(
      path.join(WEB_SRC_DIR, "components/artifacts/PolyglotArtifactViewer.tsx"),
      "utf-8",
    );
    const invertedSvgSrc = fs.readFileSync(path.join(WEB_SRC_DIR, "components/InvertedSvg.tsx"), "utf-8");
    assert.ok(
      polyglotViewerSrc.includes("@import"),
      "PolyglotArtifactViewer.tsx must strip @import rules from SVG markup",
    );
    assert.ok(invertedSvgSrc.includes("@import"), "InvertedSvg.tsx must strip @import rules from Modelica SVGs");

    // 3. VirtualPostList must maintain an overscan of at least 8 to prevent mount delays during rapid scroll
    const virtualListSrc = fs.readFileSync(path.join(WEB_SRC_DIR, "components/VirtualPostList.tsx"), "utf-8");
    assert.ok(virtualListSrc.includes("overscan: 10"), "VirtualPostList must use overscan: 10 for smooth scrolling");

    // 4. index.css must apply font smoothing globally to *, *::before, *::after
    const indexCss = fs.readFileSync(path.join(WEB_SRC_DIR, "index.css"), "utf-8");
    assert.ok(
      indexCss.includes("-webkit-font-smoothing: antialiased;") &&
        indexCss.includes("-moz-osx-font-smoothing: grayscale;"),
      "index.css must define antialiased and grayscale font smoothing",
    );

    // 5. ScrollToTop must throttle scroll updates with requestAnimationFrame and use getPropertyValue checks
    const scrollToTopSrc = fs.readFileSync(path.join(WEB_SRC_DIR, "components/ScrollToTop.tsx"), "utf-8");
    assert.ok(
      scrollToTopSrc.includes("requestAnimationFrame") && scrollToTopSrc.includes("getPropertyValue"),
      "ScrollToTop.tsx must throttle scroll updates and avoid redundant property set calls",
    );
  });
});

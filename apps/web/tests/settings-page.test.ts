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
});

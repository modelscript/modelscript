// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  GENERIC_SETTINGS_ERROR_MESSAGE,
  resolveSettingsBannerMessage,
  SETTINGS_STATUS_MESSAGES,
  validateOAuthRedirectUrl,
} from "../src/pages/settings/tabs/ConnectedAccountsTab.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC_DIR = path.resolve(__dirname, "../src");
const API_SRC_DIR = path.resolve(__dirname, "../../api/src");

describe("Settings URL Banner Allowlist, OAuth Redirect Validation & Lockout Guard", () => {
  it("resolves allowlisted success status keys to static trusted UI messages", () => {
    assert.strictEqual(
      resolveSettingsBannerMessage("success", "Linkedgithub"),
      "Successfully linked your GitHub account.",
    );
    assert.strictEqual(
      resolveSettingsBannerMessage("success", "LinkedGitHub"),
      "Successfully linked your GitHub account.",
    );
    assert.strictEqual(
      resolveSettingsBannerMessage("success", "Linkedgitlab"),
      "Successfully linked your GitLab account.",
    );
    assert.strictEqual(
      resolveSettingsBannerMessage("success", "Linkedoidc"),
      "Successfully linked your Enterprise SSO (OIDC) account.",
    );
    assert.strictEqual(
      resolveSettingsBannerMessage("success", "Linkedtwitter"),
      "Successfully linked your X (Twitter) account.",
    );
    assert.strictEqual(
      resolveSettingsBannerMessage("success", "Linkedfediverse"),
      "Successfully linked your Fediverse account.",
    );
    assert.strictEqual(
      resolveSettingsBannerMessage("success", "  checkout_success  "),
      SETTINGS_STATUS_MESSAGES.success["checkout_success"],
    );
  });

  it("rejects arbitrary or phishing strings in ?success= by returning null", () => {
    const phishingPayloads = [
      "Your account is suspended! Visit https://evil.example/verify",
      "Linked<script>alert(1)</script>",
      "LinkedCustomPhishingProvider",
      "constructor",
      "toString",
      "__proto__",
      "",
      "   ",
    ];

    for (const payload of phishingPayloads) {
      assert.strictEqual(
        resolveSettingsBannerMessage("success", payload),
        null,
        `Expected unknown success payload ${JSON.stringify(payload)} to be ignored`,
      );
    }

    assert.strictEqual(resolveSettingsBannerMessage("success", null), null);
    assert.strictEqual(resolveSettingsBannerMessage("success", undefined), null);
  });

  it("resolves allowlisted error status keys to static trusted UI messages", () => {
    assert.strictEqual(
      resolveSettingsBannerMessage("error", "MissingToken"),
      SETTINGS_STATUS_MESSAGES.error["missingtoken"],
    );
    assert.strictEqual(
      resolveSettingsBannerMessage("error", "InvalidToken"),
      SETTINGS_STATUS_MESSAGES.error["invalidtoken"],
    );
    assert.strictEqual(
      resolveSettingsBannerMessage("error", "InvalidState"),
      SETTINGS_STATUS_MESSAGES.error["invalidstate"],
    );
    assert.strictEqual(
      resolveSettingsBannerMessage("error", "OAuthNotConfigured"),
      SETTINGS_STATUS_MESSAGES.error["oauthnotconfigured"],
    );
    assert.strictEqual(
      resolveSettingsBannerMessage("error", "UserNotFound"),
      SETTINGS_STATUS_MESSAGES.error["usernotfound"],
    );
    assert.strictEqual(
      resolveSettingsBannerMessage("error", "oauthnotconfigured"),
      SETTINGS_STATUS_MESSAGES.error["oauthnotconfigured"],
    );
  });

  it("maps unknown ?error= strings to a generic fallback without echoing attacker text", () => {
    const attackerPayloads = [
      "Session expired — sign in at https://evil.example/login",
      "Call support at +1-555-0199 immediately",
      "<img src=x onerror=alert(1)>",
      "constructor",
      "toString",
      "__proto__",
    ];

    for (const payload of attackerPayloads) {
      const resolved = resolveSettingsBannerMessage("error", payload);
      assert.strictEqual(resolved, GENERIC_SETTINGS_ERROR_MESSAGE);
      assert.ok(
        resolved && !resolved.includes(payload),
        `Resolved error banner must never echo attacker payload ${JSON.stringify(payload)}`,
      );
    }

    assert.strictEqual(resolveSettingsBannerMessage("error", ""), null);
    assert.strictEqual(resolveSettingsBannerMessage("error", "   "), null);
    assert.strictEqual(resolveSettingsBannerMessage("error", null), null);
    assert.strictEqual(resolveSettingsBannerMessage("error", undefined), null);
  });

  it("validates OAuth redirectUrl protocol and rejects non-http(s) schemes", () => {
    const origin = "https://hub.modelscript.org";

    assert.strictEqual(
      validateOAuthRedirectUrl("https://github.com/login/oauth/authorize?client_id=123", origin),
      "https://github.com/login/oauth/authorize?client_id=123",
    );
    assert.strictEqual(
      validateOAuthRedirectUrl("http://localhost:3001/api/v1/auth/callback/github", origin),
      "http://localhost:3001/api/v1/auth/callback/github",
    );
    assert.strictEqual(
      validateOAuthRedirectUrl("/api/v1/auth/link/github", origin),
      "https://hub.modelscript.org/api/v1/auth/link/github",
    );

    const unsafeUrls = [
      "javascript:alert(document.cookie)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "blob:https://hub.modelscript.org/1234",
    ];

    for (const unsafeUrl of unsafeUrls) {
      assert.strictEqual(
        validateOAuthRedirectUrl(unsafeUrl, origin),
        null,
        `Expected unsafe redirect URL ${JSON.stringify(unsafeUrl)} to be rejected`,
      );
    }
  });

  it("wires allowlist, ARIA roles, replace: true redirects, URL cleanup, and lockout guard across source files", () => {
    const settingsPageSrc = fs.readFileSync(path.join(WEB_SRC_DIR, "pages/SettingsPage.tsx"), "utf-8");
    assert.ok(
      settingsPageSrc.includes(
        "export { GENERIC_SETTINGS_ERROR_MESSAGE, resolveSettingsBannerMessage, SETTINGS_STATUS_MESSAGES };",
      ),
      "SettingsPage.tsx must export resolveSettingsBannerMessage and SETTINGS_STATUS_MESSAGES",
    );
    assert.ok(
      !settingsPageSrc.includes("<span>{querySuccess || queryError}</span>"),
      "SettingsPage.tsx must never render raw querySuccess or queryError verbatim",
    );
    assert.ok(
      settingsPageSrc.includes('role={bannerVariant === "error" ? "alert" : "status"}'),
      "SettingsPage.tsx StatusToastBanner must use role=alert for errors and role=status for success",
    );
    assert.ok(
      settingsPageSrc.includes('syncUrl("account", "main", { replace: true })') &&
        settingsPageSrc.includes('navigate("/admin", { replace: true })'),
      "SettingsPage.tsx must use { replace: true } on automatic redirects",
    );

    const connectedAccountsSrc = fs.readFileSync(
      path.join(WEB_SRC_DIR, "pages/settings/tabs/ConnectedAccountsTab.tsx"),
      "utf-8",
    );
    assert.ok(
      connectedAccountsSrc.includes("window.history.replaceState("),
      "ConnectedAccountsTab.tsx must strip success/error query params via window.history.replaceState",
    );
    assert.ok(
      connectedAccountsSrc.includes("validateOAuthRedirectUrl(redirectUrl, window.location.origin)"),
      "ConnectedAccountsTab.tsx must validate redirectUrl protocol before navigation",
    );
    assert.ok(
      connectedAccountsSrc.includes("!user?.has_password && connectedAccounts.length <= 1"),
      "ConnectedAccountsTab.tsx must disable Disconnect when user has no password and <= 1 connected account",
    );

    const oauthApiSrc = fs.readFileSync(path.join(API_SRC_DIR, "routes/auth/oauth.ts"), "utf-8");
    assert.ok(
      oauthApiSrc.includes(
        "Cannot disconnect your only sign-in method. Set a password first in Your Account settings.",
      ),
      "oauth.ts must return 400 lockout error when disconnecting the last OAuth provider without a password",
    );
  });
});

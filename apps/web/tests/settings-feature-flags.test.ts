// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { FEATURE_FLAGS } from "../../api/src/feature-flags.js";
import { DEFAULT_FRONTEND_FLAGS } from "../src/FeatureFlagContext.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC_DIR = path.resolve(__dirname, "../src");

describe("Settings Feature Flag Gating (AI Bots, Billing, Organizations, Invites)", () => {
  it("defaults ai bots, billing, organizations, and invites flags to disabled in DEFAULT_FRONTEND_FLAGS", () => {
    assert.strictEqual(DEFAULT_FRONTEND_FLAGS.bot_accounts, false, "bot_accounts must be false by default");
    assert.strictEqual(DEFAULT_FRONTEND_FLAGS.ai_bots, false, "ai_bots must be false by default");
    assert.strictEqual(DEFAULT_FRONTEND_FLAGS.bots, false, "bots must be false by default");

    assert.strictEqual(DEFAULT_FRONTEND_FLAGS.billing, false, "billing must be false by default");
    assert.strictEqual(
      DEFAULT_FRONTEND_FLAGS.billing_stripe_live,
      false,
      "billing_stripe_live must be false by default",
    );

    assert.strictEqual(DEFAULT_FRONTEND_FLAGS.organizations, false, "organizations must be false by default");
    assert.strictEqual(DEFAULT_FRONTEND_FLAGS.orgs, false, "orgs must be false by default");

    assert.strictEqual(DEFAULT_FRONTEND_FLAGS.invites, false, "invites must be false by default");
    assert.strictEqual(DEFAULT_FRONTEND_FLAGS.user_invites, false, "user_invites must be false by default");
  });

  it("verifies api/feature-flags.ts defines flags and aliases for bots, billing, organizations, and invites", () => {
    assert.ok(FEATURE_FLAGS.bot_accounts, "api FEATURE_FLAGS must define bot_accounts");
    assert.strictEqual(FEATURE_FLAGS.bot_accounts.defaultValue, false, "bot_accounts must default to false");

    assert.ok(FEATURE_FLAGS.ai_bots, "api FEATURE_FLAGS must define ai_bots alias");
    assert.ok(FEATURE_FLAGS.bots, "api FEATURE_FLAGS must define bots alias");

    assert.ok(FEATURE_FLAGS.billing_stripe_live, "api FEATURE_FLAGS must define billing_stripe_live");
    assert.ok(FEATURE_FLAGS.billing, "api FEATURE_FLAGS must define billing alias");

    assert.ok(FEATURE_FLAGS.organizations, "api FEATURE_FLAGS must define organizations");
    assert.ok(FEATURE_FLAGS.orgs, "api FEATURE_FLAGS must define orgs alias");

    assert.ok(FEATURE_FLAGS.invites, "api FEATURE_FLAGS must define invites");
    assert.ok(FEATURE_FLAGS.user_invites, "api FEATURE_FLAGS must define user_invites alias");
  });

  it("verifies DevFlagsModal.tsx registers metadata for all settings flags", () => {
    const devFlagsPath = path.resolve(WEB_SRC_DIR, "components/DevFlagsModal.tsx");
    const content = fs.readFileSync(devFlagsPath, "utf-8");

    assert.ok(content.includes("bot_accounts: {"), "DevFlagsModal must define bot_accounts metadata");
    assert.ok(content.includes("ai_bots: {"), "DevFlagsModal must define ai_bots metadata");
    assert.ok(content.includes("bots: {"), "DevFlagsModal must define bots metadata");

    assert.ok(content.includes("billing: {"), "DevFlagsModal must define billing metadata");
    assert.ok(content.includes("billing_stripe_live: {"), "DevFlagsModal must define billing_stripe_live metadata");

    assert.ok(content.includes("organizations: {"), "DevFlagsModal must define organizations metadata");
    assert.ok(content.includes("orgs: {"), "DevFlagsModal must define orgs metadata");

    assert.ok(content.includes("invites: {"), "DevFlagsModal must define invites metadata");
    assert.ok(content.includes("user_invites: {"), "DevFlagsModal must define user_invites metadata");
  });

  it("verifies SettingsPage.tsx checks feature flags for bots, billing, organizations, and invites", () => {
    const settingsPath = path.resolve(WEB_SRC_DIR, "pages/SettingsPage.tsx");
    const content = fs.readFileSync(settingsPath, "utf-8");

    assert.ok(
      content.includes('const hasBots = useFeatureFlag(["bot_accounts", "ai_bots", "bots"]);'),
      "SettingsPage.tsx must evaluate hasBots using bot_accounts, ai_bots, bots flags",
    );
    assert.ok(
      content.includes('const hasBilling = useFeatureFlag(["billing", "billing_stripe_live"]);'),
      "SettingsPage.tsx must evaluate hasBilling using billing, billing_stripe_live flags",
    );
    assert.ok(
      content.includes('const hasOrganizations = useFeatureFlag(["organizations", "orgs"]);'),
      "SettingsPage.tsx must evaluate hasOrganizations using organizations, orgs flags",
    );
    assert.ok(
      content.includes('const hasInvites = useFeatureFlag(["invites", "user_invites"]);'),
      "SettingsPage.tsx must evaluate hasInvites using invites, user_invites flags",
    );
  });

  it("verifies SettingsPage.tsx conditionally gates sidebar items and categories", () => {
    const settingsPath = path.resolve(WEB_SRC_DIR, "pages/SettingsPage.tsx");
    const content = fs.readFileSync(settingsPath, "utf-8");

    // Bots gated under Developer & Automation
    assert.ok(
      content.includes("...(hasBots") &&
        content.includes('id: "bots"') &&
        content.includes('label: "AI Bots & Agents"'),
      "SettingsPage must conditionally render AI Bots & Agents item only when hasBots is true",
    );

    // Entire Billing & Teams category gated
    assert.ok(
      content.includes("...(hasOrganizations || hasBilling || hasInvites") &&
        content.includes('category: "Billing & Teams"'),
      "SettingsPage must gate the Billing & Teams category behind hasOrganizations, hasBilling, and hasInvites",
    );

    // Organizations, Billing, and Invites items gated within Billing & Teams
    assert.ok(
      content.includes("...(hasOrganizations") && content.includes('id: "organizations"'),
      "SettingsPage must conditionally render Organizations item only when hasOrganizations is true",
    );
    assert.ok(
      content.includes("...(hasBilling") && content.includes('id: "billing"'),
      "SettingsPage must conditionally render Billing item only when hasBilling is true",
    );
    assert.ok(
      content.includes("...(hasInvites") && content.includes('id: "invites"'),
      "SettingsPage must conditionally render Invites item only when hasInvites is true",
    );
  });

  it("verifies SettingsPage.tsx filters deep search index when feature flags are disabled", () => {
    const settingsPath = path.resolve(WEB_SRC_DIR, "pages/SettingsPage.tsx");
    const content = fs.readFileSync(settingsPath, "utf-8");

    assert.ok(
      content.includes('if (entry.tab === "bots" && !hasBots) return false;'),
      "SettingsPage matchingDeepSettings must filter out bots when !hasBots",
    );
    assert.ok(
      content.includes('if (entry.tab === "billing" && !hasBilling) return false;'),
      "SettingsPage matchingDeepSettings must filter out billing when !hasBilling",
    );
    assert.ok(
      content.includes('if (entry.tab === "organizations" && !hasOrganizations) return false;'),
      "SettingsPage matchingDeepSettings must filter out organizations when !hasOrganizations",
    );
    assert.ok(
      content.includes('if (entry.tab === "invites" && !hasInvites) return false;'),
      "SettingsPage matchingDeepSettings must filter out invites when !hasInvites",
    );
  });

  it("verifies SettingsPage.tsx protects direct tab navigation and detail tab rendering", () => {
    const settingsPath = path.resolve(WEB_SRC_DIR, "pages/SettingsPage.tsx");
    const content = fs.readFileSync(settingsPath, "utf-8");

    // Availability helper
    assert.ok(
      content.includes("const isTabAvailable = useCallback("),
      "SettingsPage must define isTabAvailable helper",
    );

    // Initial safe tab fallback
    assert.ok(
      content.includes('isTabAvailable(initialResolved.tab) ? initialResolved.tab : "account"'),
      "SettingsPage must fallback initial tab to account if requested tab is unavailable",
    );

    // Sidebar tab selection guard
    assert.ok(
      content.includes("if (!isTabAvailable(tab)) return;"),
      "SettingsPage handleSidebarTabSelect must guard against unavailable tabs",
    );

    // Detail column tab rendering gates
    assert.ok(
      content.includes('{hasBilling && activeTab === "billing" && <BillingTab'),
      "SettingsPage must gate BillingTab rendering behind hasBilling",
    );
    assert.ok(
      content.includes('{hasOrganizations && activeTab === "organizations" && ('),
      "SettingsPage must gate OrganizationTab rendering behind hasOrganizations",
    );
    assert.ok(
      content.includes('{hasInvites && activeTab === "invites" && <InvitesTab'),
      "SettingsPage must gate InvitesTab rendering behind hasInvites",
    );
    assert.ok(
      content.includes('{hasBots && activeTab === "bots" && <BotsTab'),
      "SettingsPage must gate BotsTab rendering behind hasBots",
    );
  });

  it("verifies OrganizationTab.tsx gates 'Manage Org Billing & Credits' button behind hasBilling", () => {
    const orgTabPath = path.resolve(WEB_SRC_DIR, "pages/settings/tabs/OrganizationTab.tsx");
    const content = fs.readFileSync(orgTabPath, "utf-8");

    assert.ok(
      content.includes('useFeatureFlag(["billing", "billing_stripe_live"])'),
      "OrganizationTab.tsx must check billing feature flag",
    );
    assert.ok(
      content.includes("{hasBilling && (\n                      <SecondaryButton") &&
        content.includes("Manage Org Billing &amp; Credits"),
      "OrganizationTab.tsx must wrap Manage Org Billing & Credits button with hasBilling check",
    );
  });

  it("verifies SettingsPage.tsx and AccountTab.tsx only show Instance Administration for admin users", () => {
    const settingsPath = path.resolve(WEB_SRC_DIR, "pages/SettingsPage.tsx");
    const settingsContent = fs.readFileSync(settingsPath, "utf-8");

    assert.ok(
      settingsContent.includes("const isUserAdmin = Boolean("),
      "SettingsPage.tsx must compute isUserAdmin from authenticated user and admin role",
    );
    assert.ok(
      settingsContent.includes(
        '...(isUserAdmin\n            ? [\n                {\n                  id: "admin",\n                  label: "Instance Administration"',
      ),
      "SettingsPage.tsx must conditionally display Instance Administration in sidebar only when isUserAdmin is true",
    );
    assert.ok(
      settingsContent.includes('if (effectiveRawTab === "admin")') &&
        settingsContent.includes(
          'if (isUserAdmin) {\n        navigate("/admin");\n      } else {\n        setActiveTab("account");',
        ),
      "SettingsPage.tsx must protect /settings/admin navigation so non-admins fallback to account",
    );

    const accountTabPath = path.resolve(WEB_SRC_DIR, "pages/settings/tabs/AccountTab.tsx");
    const accountTabContent = fs.readFileSync(accountTabPath, "utf-8");

    assert.ok(
      accountTabContent.includes("const isUserAdmin = Boolean("),
      "AccountTab.tsx must compute isUserAdmin from authenticated user and admin role",
    );
    assert.ok(
      accountTabContent.includes(
        '{isUserAdmin && (\n        <DetailItem $clickable onClick={() => navigate("/admin")}>',
      ) && accountTabContent.includes("Instance Administration Console"),
      "AccountTab.tsx must only render Instance Administration Console item when isUserAdmin is true",
    );
  });
});

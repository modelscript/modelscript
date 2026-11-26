// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { CapabilitiesProvider } from "../src/CapabilitiesContext.js";
import { ToastProvider } from "../src/components/ToastContext.js";
import { FeatureFlagProvider } from "../src/FeatureFlagContext.js";
import { InstanceBrandingProvider } from "../src/InstanceBrandingContext.js";
import { DisplayAndPreferencesTab } from "../src/pages/settings/tabs/DisplayAndPreferencesTab.js";
import { DEEP_SETTINGS_INDEX } from "../src/pages/SettingsPage.js";
import { ThemeContextProvider } from "../src/theme.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC_DIR = path.resolve(__dirname, "../src");

function renderDisplayTab(subView?: "display" | "contentPreferences" | "other"): string {
  return renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(
        ThemeContextProvider,
        null,
        React.createElement(
          ToastProvider,
          null,
          React.createElement(
            InstanceBrandingProvider,
            null,
            React.createElement(
              CapabilitiesProvider,
              null,
              React.createElement(
                FeatureFlagProvider,
                null,
                React.createElement(DisplayAndPreferencesTab, {
                  subView,
                  onNavigate: () => {},
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

describe("Phase 5 Workstream 2: In-Tab SubView Navigation & Deep-Search Index Accuracy", () => {
  it("DisplayAndPreferencesTab wires keyboard-accessible navigation to contentPreferences and other subViews", () => {
    const src = fs.readFileSync(path.join(WEB_SRC_DIR, "pages/settings/tabs/DisplayAndPreferencesTab.tsx"), "utf-8");

    assert.ok(
      src.includes('onNavigate?.("contentPreferences")'),
      "DisplayAndPreferencesTab must navigate to contentPreferences subView",
    );
    assert.ok(src.includes('onNavigate?.("other")'), "DisplayAndPreferencesTab must navigate to other subView");
    assert.ok(
      src.includes('e.key === "Enter" || e.key === " "'),
      "DisplayAndPreferencesTab must handle Enter and Space keys on DetailItem navigation rows",
    );
    assert.ok(
      src.includes("ChevronRightIcon"),
      "DisplayAndPreferencesTab must render ChevronRightIcon on navigation rows",
    );

    // Render main display view and verify both navigation rows appear with button role and tabindex
    const html = renderDisplayTab("display");
    assert.ok(
      html.includes("Content Preferences &amp; Topics"),
      "Main display view must render Content Preferences & Topics navigation row",
    );
    assert.ok(
      html.includes("Keyboard Shortcuts &amp; Resources"),
      "Main display view must render Keyboard Shortcuts & Resources navigation row",
    );
    assert.ok(
      html.includes('role="button"') && html.includes('tabindex="0"'),
      "Navigation rows in display view must be keyboard-accessible buttons with tabIndex=0",
    );
  });

  it("DisplayAndPreferencesTab renders semantic Back button in contentPreferences and other subViews", () => {
    const src = fs.readFileSync(path.join(WEB_SRC_DIR, "pages/settings/tabs/DisplayAndPreferencesTab.tsx"), "utf-8");

    const backMatches = src.match(/onClick=\{\(\) => onNavigate\?\.\("displayAndLanguages"\)\}/g) ?? [];
    assert.ok(
      backMatches.length >= 2,
      `Expected at least 2 back buttons navigating to displayAndLanguages, found ${backMatches.length}`,
    );

    const contentPrefsHtml = renderDisplayTab("contentPreferences");
    assert.ok(
      contentPrefsHtml.includes('type="button"') &&
        contentPrefsHtml.includes('class="subtab-back"') &&
        contentPrefsHtml.includes('aria-label="Back"') &&
        contentPrefsHtml.includes("Content preferences"),
      "contentPreferences subView must render a semantic Back button in its header",
    );

    const otherHtml = renderDisplayTab("other");
    assert.ok(
      otherHtml.includes('type="button"') &&
        otherHtml.includes('class="subtab-back"') &&
        otherHtml.includes('aria-label="Back"') &&
        otherHtml.includes("Help &amp; Additional Resources"),
      "other subView must render a semantic Back button in its header",
    );
  });

  it("DEEP_SETTINGS_INDEX covers all 13 settings sections and has unique IDs", () => {
    const requiredTabs = [
      "account",
      "security",
      "connectedAccounts",
      "modeling",
      "displayAndLanguages",
      "notifications",
      "privacy",
      "dataArchive",
      "tokens",
      "bots",
      "organizations",
      "billing",
      "invites",
      "deleteAccount",
    ];

    const presentTabs = new Set(DEEP_SETTINGS_INDEX.map((entry) => entry.tab));
    for (const tab of requiredTabs) {
      assert.ok(
        presentTabs.has(tab as (typeof DEEP_SETTINGS_INDEX)[number]["tab"]),
        `DEEP_SETTINGS_INDEX missing tab "${tab}"`,
      );
    }

    const ids = DEEP_SETTINGS_INDEX.map((entry) => entry.id);
    assert.strictEqual(new Set(ids).size, ids.length, "DEEP_SETTINGS_INDEX entries must have unique IDs");
  });

  it("DEEP_SETTINGS_INDEX removes nonexistent controls and aligns entries with real implemented controls", () => {
    const titles = DEEP_SETTINGS_INDEX.map((entry) => entry.title);
    const ids = DEEP_SETTINGS_INDEX.map((entry) => entry.id);

    assert.ok(
      !titles.includes("Colorblind Safe Palette") && !ids.includes("display-colorblind-palette"),
      'DEEP_SETTINGS_INDEX must not advertise nonexistent "Colorblind Safe Palette"',
    );
    assert.ok(
      !titles.includes("Auto-Simulate on Model Load") && !ids.includes("modeling-auto-simulate"),
      'DEEP_SETTINGS_INDEX must not advertise nonexistent "Auto-Simulate on Model Load"',
    );
    assert.ok(
      !titles.includes("Primary Engineering Discipline & Persona") && !ids.includes("display-engineering-persona"),
      'DEEP_SETTINGS_INDEX must not advertise nonexistent "Primary Engineering Discipline & Persona"',
    );
    assert.ok(
      !titles.includes("Muted Keywords & Topics") && !ids.includes("display-muted-keywords-topics"),
      'DEEP_SETTINGS_INDEX must not advertise nonexistent "Muted Keywords & Topics"',
    );

    const compilerDiagnostics = DEEP_SETTINGS_INDEX.find(
      (entry) => entry.title === "Compiler Diagnostics & Live Preview",
    );
    assert.ok(compilerDiagnostics, 'DEEP_SETTINGS_INDEX must include "Compiler Diagnostics & Live Preview"');
    assert.strictEqual(compilerDiagnostics.tab, "modeling");

    const highContrastDensity = DEEP_SETTINGS_INDEX.find((entry) => entry.title === "High Contrast & Compact Density");
    assert.ok(highContrastDensity, 'DEEP_SETTINGS_INDEX must include "High Contrast & Compact Density"');
    assert.strictEqual(highContrastDensity.tab, "displayAndLanguages");

    const feedTopics = DEEP_SETTINGS_INDEX.find((entry) => entry.title === "Feed Topics & Content Preferences");
    assert.ok(feedTopics, 'DEEP_SETTINGS_INDEX must include "Feed Topics & Content Preferences"');
    assert.strictEqual(feedTopics.tab, "displayAndLanguages");
    assert.strictEqual(feedTopics.subView, "contentPreferences");

    const shortcutsDocs = DEEP_SETTINGS_INDEX.find((entry) => entry.id === "display-shortcuts-docs");
    assert.ok(shortcutsDocs, "DEEP_SETTINGS_INDEX must include display-shortcuts-docs");
    assert.strictEqual(shortcutsDocs.tab, "displayAndLanguages");
    assert.strictEqual(shortcutsDocs.subView, "other");
  });
});

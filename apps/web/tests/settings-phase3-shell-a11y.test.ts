// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hydrateDisplayAccessibilityPreferences } from "../src/theme.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC_DIR = path.resolve(__dirname, "../src");

describe("Settings Phase 3 — Shell ErrorBoundary, A11y, Logout Cleanup, Multi-Tab Sync & Styles", () => {
  it("SettingsPage defines and wires SettingsTabErrorBoundary keyed by activeTab:subView with role=alert and Try Again", async () => {
    const src = fs.readFileSync(path.join(WEB_SRC_DIR, "pages/SettingsPage.tsx"), "utf-8");

    assert.ok(
      src.includes("export class SettingsTabErrorBoundary extends React.Component"),
      "SettingsPage.tsx must define SettingsTabErrorBoundary class component",
    );
    assert.ok(
      src.includes("<SettingsTabErrorBoundary key={`${activeTab}:${subView}`}>"),
      "SettingsPage.tsx must wrap active tab content in SettingsTabErrorBoundary keyed by ${activeTab}:${subView}",
    );
    assert.ok(src.includes('role="alert"'), "SettingsTabErrorBoundary fallback must use role='alert'");
    assert.ok(src.includes("Try Again"), "SettingsTabErrorBoundary fallback must render a 'Try Again' button");

    const { SettingsTabErrorBoundary } = await import("../src/pages/SettingsPage.js");
    const derived = SettingsTabErrorBoundary.getDerivedStateFromError(new Error("Simulated tab crash"));
    assert.strictEqual(derived.hasError, true);
    assert.strictEqual(derived.error?.message, "Simulated tab crash");

    const boundary = new SettingsTabErrorBoundary({ children: React.createElement("div", null, "Tab content") });
    boundary.state = derived;
    const html = renderToStaticMarkup(boundary.render() as React.ReactElement);
    assert.ok(html.includes('role="alert"'), "Rendered error fallback must include role='alert'");
    assert.ok(html.includes("Simulated tab crash"), "Rendered error fallback must show error message");
    assert.ok(html.includes("Try Again"), "Rendered error fallback must include 'Try Again' button");

    let resetState: { hasError: boolean; error: Error | null } | null = null;
    boundary.setState = ((next: { hasError: boolean; error: Error | null }) => {
      resetState = next;
    }) as typeof boundary.setState;
    boundary.handleReset();
    assert.deepStrictEqual(resetState, { hasError: false, error: null });
  });

  it("SettingsPage wraps sidebar categories in <nav aria-label='Settings'> and sets aria-current on active MenuItem", () => {
    const src = fs.readFileSync(path.join(WEB_SRC_DIR, "pages/SettingsPage.tsx"), "utf-8");

    assert.ok(
      src.includes('<nav aria-label="Settings">'),
      "SettingsPage.tsx must wrap the sidebar category list in <nav aria-label='Settings'>",
    );
    assert.ok(
      src.includes('aria-current={item.isActive ? "page" : undefined}'),
      "SettingsPage.tsx must set aria-current={item.isActive ? 'page' : undefined} on MenuItem",
    );
  });

  it("SettingsPage removes Cmd/Ctrl+K conflict, cleans up deep-setting scroll timeout, and resets mobile back URL", () => {
    const src = fs.readFileSync(path.join(WEB_SRC_DIR, "pages/SettingsPage.tsx"), "utf-8");

    assert.ok(
      !src.includes('e.key === "k" || e.key === "K"'),
      "SettingsPage.tsx must not intercept Cmd/Ctrl+K (conflicts with global CommandPalette)",
    );
    assert.ok(
      src.includes('e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isInput'),
      "SettingsPage.tsx must keep '/' shortcut to focus Settings search",
    );
    assert.ok(
      src.includes("scrollTimeoutRef") && src.includes("clearTimeout(scrollTimeoutRef.current)"),
      "SettingsPage.tsx must track and clean up setTimeout in handleSelectDeepSetting via ref",
    );
    assert.ok(
      src.includes('navigate("/settings", { replace: true })'),
      "SettingsPage.tsx must call navigate('/settings', { replace: true }) when returning to the mobile menu",
    );
  });

  it("AuthContext clears modelscript_notification_prefs on logout and session clear paths", () => {
    const src = fs.readFileSync(path.join(WEB_SRC_DIR, "AuthContext.tsx"), "utf-8");
    const matches = src.match(/localStorage\.removeItem\("modelscript_notification_prefs"\)/g) || [];
    assert.ok(
      matches.length >= 2,
      `AuthContext.tsx must clear modelscript_notification_prefs in both user-clear effect and logout (found ${matches.length})`,
    );
  });

  it("ModelingPreferencesContext and theme.ts synchronize preferences across tabs via window storage events", () => {
    const modelingSrc = fs.readFileSync(path.join(WEB_SRC_DIR, "ModelingPreferencesContext.tsx"), "utf-8");
    assert.ok(
      modelingSrc.includes('window.addEventListener("storage", handleStorage)') &&
        modelingSrc.includes('window.removeEventListener("storage", handleStorage)'),
      "ModelingPreferencesContext.tsx must register and clean up a window 'storage' event listener",
    );
    assert.ok(
      modelingSrc.includes("if (e.key !== STORAGE_KEY) return;"),
      "ModelingPreferencesContext.tsx storage listener must filter for modelscript_modeling_preferences",
    );

    const themeSrc = fs.readFileSync(path.join(WEB_SRC_DIR, "theme.ts"), "utf-8");
    assert.ok(
      themeSrc.includes('e.key === "modelscript_display_accessibility"') &&
        themeSrc.includes("hydrateDisplayAccessibilityPreferences()"),
      "theme.ts storage listener must re-apply display accessibility attributes when modelscript_display_accessibility changes",
    );

    // Behavioral check for hydrateDisplayAccessibilityPreferences
    const store = new Map<string, string>();
    const prevLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
      },
    });

    try {
      const attrs = new Map<string, string>();
      const props = new Map<string, string>();
      const fakeRoot = {
        style: {
          fontSize: "",
          setProperty: (k: string, v: string) => props.set(k, v),
          removeProperty: (k: string) => props.delete(k),
        },
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        removeAttribute: (k: string) => attrs.delete(k),
      } as unknown as HTMLElement;

      store.set(
        "modelscript_display_accessibility",
        JSON.stringify({ fontScale: 110, compactDensity: true, reducedMotion: true, highContrast: true }),
      );
      hydrateDisplayAccessibilityPreferences(fakeRoot);
      assert.strictEqual(fakeRoot.style.fontSize, "110%");
      assert.strictEqual(props.get("--ui-font-scale"), "1.1");
      assert.strictEqual(attrs.get("data-density"), "compact");
      assert.strictEqual(attrs.get("data-reduced-motion"), "true");
      assert.strictEqual(attrs.get("data-high-contrast"), "true");

      // Turning flags off in another tab should clear attributes
      store.set(
        "modelscript_display_accessibility",
        JSON.stringify({ fontScale: 100, compactDensity: false, reducedMotion: false, highContrast: false }),
      );
      hydrateDisplayAccessibilityPreferences(fakeRoot);
      assert.strictEqual(fakeRoot.style.fontSize, "100%");
      assert.strictEqual(attrs.has("data-density"), false);
      assert.strictEqual(attrs.has("data-reduced-motion"), false);
      assert.strictEqual(attrs.has("data-high-contrast"), false);
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: prevLocalStorage,
      });
    }
  });

  it("settingsStyles.ts uses light-mode safe SecondaryButton hover, forced-colors FormInput focus, and responsive DetailItem/DetailText", () => {
    const stylesSrc = fs.readFileSync(path.join(WEB_SRC_DIR, "pages/settings/settingsStyles.ts"), "utf-8");

    assert.ok(
      stylesSrc.includes("background-color: var(--color-bg-hover, rgba(127, 127, 127, 0.14));"),
      "SecondaryButton hover must use var(--color-bg-hover, rgba(127, 127, 127, 0.14))",
    );
    assert.ok(
      !stylesSrc.includes("background-color: rgba(255, 255, 255, 0.08);"),
      "SecondaryButton hover must not use dark-only rgba(255, 255, 255, 0.08)",
    );
    assert.ok(
      stylesSrc.includes("&:focus,\n  &:focus-visible") &&
        stylesSrc.includes("outline: 2px solid transparent;") &&
        stylesSrc.includes("outline-offset: 2px;"),
      "FormInput must preserve Windows High Contrast / forced-colors focus visibility",
    );
    assert.ok(
      stylesSrc.includes("flex-wrap: wrap;") && /gap:\s*(var\(--space-[^)]+\)|12px);/.test(stylesSrc),
      "DetailItem must include flex-wrap: wrap and a responsive/density-aware gap",
    );
    assert.ok(stylesSrc.includes("min-width: 0;"), "DetailText must include min-width: 0");
  });
});

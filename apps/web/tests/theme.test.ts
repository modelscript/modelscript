// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { applyThemeToDom, getStoredThemeOverride, getSystemPreferredTheme } from "../src/theme";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC_DIR = path.resolve(__dirname, "../src");

describe("Theme Management & User Agent Preference Matching", () => {
  it("getStoredThemeOverride returns stored theme or null when not overridden", () => {
    // Mock localStorage
    const storage = new Map<string, string>();
    const globalWithStorage = globalThis as unknown as { localStorage: Storage };
    const originalLocalStorage = globalWithStorage.localStorage;

    globalWithStorage.localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
      key: () => null,
      length: 0,
    } as unknown as Storage;

    try {
      // Unset: should be null (no override)
      assert.strictEqual(getStoredThemeOverride(), null);

      // Overridden to light
      storage.set("ms-theme", "light");
      assert.strictEqual(getStoredThemeOverride(), "light");

      // Overridden to dark
      storage.set("ms-theme", "dark");
      assert.strictEqual(getStoredThemeOverride(), "dark");

      // Invalid value: treated as no override
      storage.set("ms-theme", "custom");
      assert.strictEqual(getStoredThemeOverride(), null);
    } finally {
      globalWithStorage.localStorage = originalLocalStorage;
    }
  });

  it("getSystemPreferredTheme queries prefers-color-scheme media query", () => {
    const globalObj = globalThis as unknown as { window?: unknown };
    const originalWindow = globalObj.window;

    try {
      // Light mode preference
      globalObj.window = {
        matchMedia: (query: string) => ({
          matches: query.includes("light"),
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }),
      };
      assert.strictEqual(getSystemPreferredTheme(), "light");

      // Dark mode preference
      globalObj.window = {
        matchMedia: (query: string) => ({
          matches: query.includes("dark"),
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }),
      };
      assert.strictEqual(getSystemPreferredTheme(), "dark");
    } finally {
      globalObj.window = originalWindow;
    }
  });

  it("applyThemeToDom applies data-theme, data-color-mode, color-scheme, and meta theme-color", () => {
    const rootAttrs: Record<string, string> = {};
    const rootStyle: Record<string, string> = {};
    const metaAttrs: Record<string, string> = { name: "theme-color", content: "#0a0f1c" };

    const mockDoc = {
      documentElement: {
        getAttribute: (k: string) => rootAttrs[k] ?? null,
        setAttribute: (k: string, v: string) => {
          rootAttrs[k] = v;
        },
        style: rootStyle,
      },
      querySelector: (selector: string) => {
        if (selector === 'meta[name="theme-color"]') {
          return {
            getAttribute: (k: string) => metaAttrs[k] ?? null,
            setAttribute: (k: string, v: string) => {
              metaAttrs[k] = v;
            },
          };
        }
        return null;
      },
    };

    const globalObj = globalThis as unknown as { document?: unknown };
    const originalDocument = globalObj.document;
    globalObj.document = mockDoc;

    try {
      applyThemeToDom("light");
      assert.strictEqual(rootAttrs["data-theme"], "light");
      assert.strictEqual(rootAttrs["data-color-mode"], "light");
      assert.strictEqual(rootStyle.colorScheme, "light");
      assert.strictEqual(metaAttrs.content, "#ffffff");

      applyThemeToDom("dark");
      assert.strictEqual(rootAttrs["data-theme"], "dark");
      assert.strictEqual(rootAttrs["data-color-mode"], "dark");
      assert.strictEqual(rootStyle.colorScheme, "dark");
      assert.strictEqual(metaAttrs.content, "#0a0f1c");
    } finally {
      globalObj.document = originalDocument;
    }
  });

  it("index.html boot script inspects prefers-color-scheme when ms-theme is not set", () => {
    const indexHtml = fs.readFileSync(path.join(WEB_SRC_DIR, "../index.html"), "utf-8");

    assert.ok(indexHtml.includes('localStorage.getItem("ms-theme")'), "index.html must check ms-theme in localStorage");
    assert.ok(
      indexHtml.includes('window.matchMedia("(prefers-color-scheme: light)")'),
      "index.html must query (prefers-color-scheme: light) when not overridden",
    );
    assert.ok(
      indexHtml.includes('root.setAttribute("data-theme", theme)') &&
        indexHtml.includes('root.setAttribute("data-color-mode", theme)'),
      "index.html must set both data-theme and data-color-mode",
    );
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MAX_DEFAULT_STOP_TIME, parseDefaultStopTimeDraft } from "../src/pages/settings/tabs/ModelingPreferencesTab.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC_DIR = path.resolve(__dirname, "../src");

describe("Phase 3 Workstream 2: Display & Modeling Preferences UX, Light-Mode Contrast & Input Fixes", () => {
  describe("DisplayAndPreferencesTab", () => {
    const src = fs.readFileSync(path.join(WEB_SRC_DIR, "pages/settings/tabs/DisplayAndPreferencesTab.tsx"), "utf-8");
    const appSrc = fs.readFileSync(path.join(WEB_SRC_DIR, "App.tsx"), "utf-8");

    it("replaces 404 /about and /federation links with valid App.tsx routes and uses React Router Link", () => {
      assert.ok(
        !src.includes('link: "/about"') && !src.includes('href="/about"'),
        "DisplayAndPreferencesTab.tsx must not link to non-existent /about route",
      );
      assert.ok(
        !src.includes('link: "/federation"') && !src.includes('href="/federation"'),
        "DisplayAndPreferencesTab.tsx must not link to non-existent /federation route",
      );

      assert.ok(src.includes('link: "/explore"'), "Other subView should link to valid /explore route");
      assert.ok(src.includes('link: "/spaces"'), "Other subView should link to valid /spaces route");
      assert.ok(src.includes('link: "/packages"'), "Other subView should link to valid /packages route");

      for (const routePath of ['path="/explore"', 'path="/spaces"', 'path="/packages"']) {
        assert.ok(appSrc.includes(routePath), `App.tsx must register ${routePath}`);
      }

      assert.ok(
        /import\s*\{[^}]*\bLink\b[^}]*\}\s*from\s*"react-router-dom"/.test(src),
        "DisplayAndPreferencesTab.tsx must import Link from react-router-dom",
      );
      assert.ok(
        src.includes("<Link to={doc.link}"),
        "Internal documentation links must use React Router <Link to={doc.link}> to avoid full-page reloads",
      );
    });

    it("handles getUserTopics loading, unmount guard, and accessible error banner with Retry", () => {
      assert.ok(
        !src.includes(".catch(() => {})"),
        "DisplayAndPreferencesTab.tsx must not silently swallow getUserTopics() failures",
      );
      assert.ok(src.includes("topicsLoading"), "Must track topicsLoading state");
      assert.ok(src.includes("topicsError"), "Must track topicsError state");
      assert.ok(
        src.includes("let active = true;") && src.includes("active = false;"),
        "Must guard async topic state updates against component unmount",
      );
      assert.ok(src.includes('role="alert"'), 'Topic fetch failure must render an accessible role="alert" banner');
      assert.ok(src.includes("Retry"), "Topic fetch failure banner must provide a Retry button");
    });

    it("rolls back topic toggles on failure with functional updater and shows an error toast", () => {
      assert.ok(!src.includes("catch {}"), "Must not silently swallow updateUserTopic() failures");
      assert.ok(
        src.includes("setTopics((prev) =>"),
        "Topic toggle must use functional state updater setTopics((prev) => ...)",
      );
      assert.ok(src.includes("const prevVal = t.is_active;"), "Topic toggle must capture previous state for rollback");
      assert.ok(src.includes("toast.error("), "Topic toggle failure must surface an error toast to the user");
      assert.ok(
        src.includes("aria-label={`Toggle ${t.concept} topic`}"),
        "Topic toggle switches must expose descriptive aria-label",
      );
    });

    it("removes raw HTML data-* attribute names from user-facing descriptions", () => {
      assert.ok(
        !src.includes('<code>data-density="compact"</code>'),
        "User-facing copy must not leak raw data-density attribute",
      );
      assert.ok(
        !src.includes('<code>data-reduced-motion="true"</code>'),
        "User-facing copy must not leak raw data-reduced-motion attribute",
      );
      assert.ok(
        !src.includes('<code>data-high-contrast="true"</code>'),
        "User-facing copy must not leak raw data-high-contrast attribute",
      );
      // DOM attribute application must remain intact
      assert.ok(
        src.includes('root.setAttribute("data-density", "compact")') &&
          src.includes('root.setAttribute("data-reduced-motion", "true")') &&
          src.includes('root.setAttribute("data-high-contrast", "true")'),
        "applyDisplayPreferencesToDom must still set DOM accessibility attributes",
      );
    });

    it("adds accessible group roles on segmented controls and responsive wrapping on telemetry rows", () => {
      assert.ok(
        src.includes('role="group" aria-label="Color Theme"'),
        'Color Theme segmented control must have role="group" and aria-label',
      );
      assert.ok(
        src.includes('role="group" aria-label="UI Font Scale"'),
        'UI Font Scale segmented control must have role="group" and aria-label',
      );

      const telemetryStart = src.indexOf("const renderInstanceTelemetryCard");
      const telemetryEnd = src.indexOf('if (subView === "contentPreferences")');
      assert.ok(telemetryStart !== -1 && telemetryEnd > telemetryStart);
      const telemetryBlock = src.slice(telemetryStart, telemetryEnd);
      const flexWrapMatches = telemetryBlock.match(/flexWrap="wrap"/g) ?? [];
      assert.ok(
        flexWrapMatches.length >= 5,
        `Expected all telemetry rows to wrap on narrow screens, found ${flexWrapMatches.length} flexWrap="wrap" occurrences`,
      );
    });
  });

  describe("ModelingPreferencesTab", () => {
    const src = fs.readFileSync(path.join(WEB_SRC_DIR, "pages/settings/tabs/ModelingPreferencesTab.tsx"), "utf-8");

    it("parseDefaultStopTimeDraft allows decimals, rejects empty/invalid inputs, and caps upper bound at 1e9", () => {
      assert.strictEqual(MAX_DEFAULT_STOP_TIME, 1e9);
      assert.strictEqual(parseDefaultStopTimeDraft("0.5"), 0.5);
      assert.strictEqual(parseDefaultStopTimeDraft("0.01"), 0.01);
      assert.strictEqual(parseDefaultStopTimeDraft("10"), 10);
      assert.strictEqual(parseDefaultStopTimeDraft(" 42.25 "), 42.25);

      // Upper bound clamping
      assert.strictEqual(parseDefaultStopTimeDraft("1000000000"), 1e9);
      assert.strictEqual(parseDefaultStopTimeDraft("999999999999"), 1e9);
      assert.strictEqual(parseDefaultStopTimeDraft("1e12"), 1e9);

      // Invalid / empty / non-positive drafts
      assert.strictEqual(parseDefaultStopTimeDraft(""), null);
      assert.strictEqual(parseDefaultStopTimeDraft("   "), null);
      assert.strictEqual(parseDefaultStopTimeDraft("0"), null);
      assert.strictEqual(parseDefaultStopTimeDraft("-10"), null);
      assert.strictEqual(parseDefaultStopTimeDraft("abc"), null);
      assert.strictEqual(parseDefaultStopTimeDraft("Infinity"), null);
      assert.strictEqual(parseDefaultStopTimeDraft("NaN"), null);
    });

    it("uses a local stopTimeDraft string state synced from preferences and resets invalid drafts onBlur", () => {
      assert.ok(
        src.includes("const [stopTimeDraft, setStopTimeDraft] = useState"),
        "Must maintain stopTimeDraft state",
      );
      assert.ok(src.includes("value={stopTimeDraft}"), "Number input must bind to stopTimeDraft string");
      assert.ok(src.includes("max={MAX_DEFAULT_STOP_TIME}"), "Number input must declare max={MAX_DEFAULT_STOP_TIME}");
      assert.ok(src.includes("onBlur={"), "Number input must reset invalid drafts on blur");
      assert.ok(
        src.includes("parseDefaultStopTimeDraft(raw)") && src.includes("parseDefaultStopTimeDraft(stopTimeDraft)"),
        "Input handlers must validate via parseDefaultStopTimeDraft",
      );
    });

    it("uses a dedicated high-contrast dark editor surface (#0d1117 / #e6edf3) for Live Monaco Preview", () => {
      assert.ok(
        src.includes('background: "#0d1117"'),
        "Live Monaco Preview must use #0d1117 background for WCAG AA contrast in Light mode",
      );
      assert.ok(src.includes('color: "#e6edf3"'), "Live Monaco Preview must use #e6edf3 foreground text on #0d1117");
      assert.ok(
        !src.includes(
          'const color = bracketColorize ? (depth === 0 ? "#f59e0b" : "#a855f7") : "var(--color-text-primary)"',
        ),
        "renderBracket must not fall back to light-mode var(--color-text-primary) on dark editor surface",
      );
    });

    it("adds gap={3} on switch rows, flexShrink: 0 on switches, role=group on segmented controls, and htmlFor/id bindings", () => {
      const switchInputs = src.match(/role="switch"/g) ?? [];
      assert.ok(switchInputs.length >= 6, `Expected at least 6 switch controls, found ${switchInputs.length}`);

      const flexShrinkMatches = src.match(/flexShrink:\s*0/g) ?? [];
      assert.ok(flexShrinkMatches.length >= switchInputs.length, "Every switch checkbox must include flexShrink: 0");

      for (const groupLabel of [
        'role="group" aria-label="Font Size"',
        'role="group" aria-label="Tab Indentation"',
        'role="group" aria-label="Line Numbers"',
        'aria-label="Compiler and Flattener Backend"',
        'role="group" aria-label="Default Solver"',
        'role="group" aria-label="Default Stop Time Presets"',
        'role="group" aria-label="Relative Tolerance"',
        'role="group" aria-label="Default Output Intervals"',
      ]) {
        assert.ok(src.includes(groupLabel), `Missing segmented control group semantics: ${groupLabel}`);
      }

      for (const inputId of [
        "modeling-word-wrap",
        "modeling-minimap",
        "modeling-bracket-colorization",
        "modeling-lint-on-type",
        "modeling-experimental-features",
        "modeling-default-stop-time",
        "modeling-diagram-auto-layout",
      ]) {
        assert.ok(
          src.includes(`htmlFor="${inputId}"`) && src.includes(`id="${inputId}"`),
          `Form input ${inputId} must have matching htmlFor and id bindings`,
        );
      }
    });
  });
});

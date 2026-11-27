// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { isMlArenaPathname, ML_ARENA_ROUTE_SPECS } from "../src/components/ml-arena-routes.js";

describe("ML & Arena Environment Navigation & Light/Dark Theme Parity", () => {
  it("routes all ML & Arena paths cleanly via isMlArenaPathname", () => {
    for (const p of [
      "/arena",
      "/datasets",
      "/datasets/shard-1/browse",
      "/recipes",
      "/models",
      "/models/qwen/1.0",
      "/runs",
      "/runs/run-123",
      "/memory",
      "/leaderboards",
      "/annotate/queue",
      "/annotate/42",
    ]) {
      assert.equal(isMlArenaPathname(p), true, `Expected ${p} to match ML & Arena`);
    }

    for (const p of ["/home", "/explore", "/packages", "/studio", "/editor", "/settings"]) {
      assert.equal(isMlArenaPathname(p), false, `Expected ${p} NOT to match ML & Arena`);
    }

    const targets = ML_ARENA_ROUTE_SPECS.map((item) => item.to);
    assert.deepEqual(targets, ["/arena", "/datasets", "/models", "/runs", "/memory", "/leaderboards"]);
  });

  it("exposes ML & Arena as a dedicated left sidebar tab and scopes MlArenaNavHeader to ML routes only", () => {
    const sidebarSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/Sidebar.tsx"), "utf-8");
    const shellSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/AppShell.tsx"), "utf-8");

    assert.ok(sidebarSrc.includes('label: "ML & Arena"'), "Sidebar must expose dedicated ML & Arena tab");
    assert.ok(
      sidebarSrc.includes("isMlArenaPathname(location.pathname)"),
      "Sidebar must highlight ML & Arena across all ML sub-routes",
    );
    assert.ok(
      !shellSrc.includes("<MlArenaNavBar"),
      "AppShell must NOT render a global top MlArenaNavBar across unrelated pages",
    );
    assert.ok(
      shellSrc.includes("{isMlArenaRoute && !isChatLayout && <MlArenaNavHeader />}"),
      "AppShell must render MlArenaNavHeader only inside the ML & Arena environment",
    );
  });

  it("defines theme-aware semantic tokens and removes hardcoded dark canvases from RLHF pages", () => {
    const css = fs.readFileSync(path.resolve(import.meta.dirname, "../src/index.css"), "utf-8");
    assert.ok(css.includes("--ms-bg-canvas: var(--ms-bg)"));
    assert.ok(css.includes("--ms-surface-panel: var(--color-bg-card)"));

    for (const file of ["RlhfArenaHubPage.tsx", "RlhfAnnotatorPage.tsx", "RlhfQueuePage.tsx"]) {
      const src = fs.readFileSync(path.resolve(import.meta.dirname, `../src/pages/${file}`), "utf-8");
      assert.ok(!src.includes("#0d1117"), `${file} must not hardcode dark #0d1117 canvas`);
      assert.ok(!src.includes("#161b22"), `${file} must not hardcode dark #161b22 cards`);
      assert.ok(!src.includes('theme="vs-dark"'), `${file} must sync Monaco theme with active light/dark mode`);
    }
  });
});

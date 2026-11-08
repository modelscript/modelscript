// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Spaces UI/UX Layout & Polish Invariants", () => {
  const appShellPath = path.resolve(import.meta.dirname, "../src/components/AppShell.tsx");
  const spacePagePath = path.resolve(import.meta.dirname, "../src/pages/SpacePage.tsx");
  const spaceChatPath = path.resolve(import.meta.dirname, "../src/pages/SpaceChatPage.tsx");
  const spacesExplorePath = path.resolve(import.meta.dirname, "../src/pages/SpacesExplorePage.tsx");

  const appShellSrc = fs.readFileSync(appShellPath, "utf-8");
  const spacePageSrc = fs.readFileSync(spacePagePath, "utf-8");
  const spaceChatSrc = fs.readFileSync(spaceChatPath, "utf-8");
  const spacesExploreSrc = fs.readFileSync(spacesExplorePath, "utf-8");

  it("verifies AppShell defines isSpaceRoute covering /spaces, /chat, /s/, /orgs/, and /@namespace/slug", () => {
    assert.ok(
      appShellSrc.includes("const isSpaceRoute = React.useMemo("),
      "AppShell must compute memoized isSpaceRoute",
    );
    assert.ok(
      appShellSrc.includes(
        'p.startsWith("/spaces") || p.startsWith("/chat") || p.startsWith("/s/") || p.startsWith("/orgs/")',
      ),
      "isSpaceRoute must match core space routes",
    );
    assert.ok(
      appShellSrc.includes('const reserved = new Set(["status", "about", "followers", "following"]);'),
      "isSpaceRoute must ignore reserved user profile subpaths",
    );
  });

  it("verifies AppShell assigns isSpaceRoute to isWideLayout to fill the space of the removed right rail and suppresses showsRightPanel", () => {
    assert.ok(
      appShellSrc.includes("isSpaceRoute") && appShellSrc.includes("isWideLayout"),
      "AppShell must include isSpaceRoute in isWideLayout",
    );
    assert.ok(
      appShellSrc.includes(
        "const showsRightPanel = !isStandaloneRoute && !isWideLayout && !isFullScreenLayout && !isInspectorLayout;",
      ),
      "AppShell must suppress showsRightPanel when isWideLayout is active",
    );
  });

  it("verifies SpacePage implements high-density breadcrumb header and quick action toolbar", () => {
    assert.ok(
      spacePageSrc.includes("git clone @${space.owner_namespace}/${space.slug}.git") ||
        spacePageSrc.includes("git clone @{space.owner_namespace}/{space.slug}.git"),
      "SpacePage must provide quick git clone command",
    );
    assert.ok(
      spacePageSrc.includes("⚡ Dock in Chat Sidenav"),
      "SpacePage must provide direct link to dock space into Chat sidenav",
    );
    assert.ok(
      spacePageSrc.includes("preset.shortLabel") && spacePageSrc.includes("space.visibility"),
      "SpacePage header must render domain blueprint badge and visibility pill",
    );
  });

  it("verifies SpacePage renders 2-column cockpit with contextual Space Inspector", () => {
    assert.ok(spacePageSrc.includes("SpaceCockpitGrid"), "SpacePage must define responsive 2-column SpaceCockpitGrid");
    assert.ok(spacePageSrc.includes("SpaceInspectorPanel"), "SpacePage must render contextual SpaceInspectorPanel");
    assert.ok(spacePageSrc.includes("Space Git Vault"), "SpaceInspectorPanel must render Space Git Vault telemetry");
    assert.ok(
      spacePageSrc.includes("Compliance & Gates"),
      "SpaceInspectorPanel must render automated simulation verification gates",
    );
    assert.ok(
      spacePageSrc.includes("Team & Signatories"),
      "SpaceInspectorPanel must render space team members with role badges",
    );
  });

  it("verifies SpacePage integrates PostMarkdownContent for Living Docs and Split Drawer", () => {
    assert.ok(spacePageSrc.includes("PostMarkdownContent"), "SpacePage must import PostMarkdownContent");
    assert.ok(
      spacePageSrc.includes("<PostMarkdownContent text={activeDoc.content_markdown} isLongForm={true} />"),
      "Living Docs reader must use PostMarkdownContent with isLongForm",
    );
  });

  it("verifies SpaceChatPage and SpacesExplorePage provide multi-column technical layouts", () => {
    assert.ok(
      spaceChatSrc.includes('gridTemplateColumns: "68px 230px 1fr"'),
      "SpaceChatPage must implement 3-column Slack/Discord workspace grid",
    );
    assert.ok(spacesExploreSrc.includes("Ansatz Engineering Spaces"), "SpacesExplorePage must render catalog header");
  });

  it("verifies world-class UI/UX polish: no tab scrollbars, concise labels, unified toolbar & clean inspector", () => {
    // 1. Tab bar scrollbar elimination
    assert.ok(
      spacePageSrc.includes("scrollbar-width: none;") && spacePageSrc.includes("&::-webkit-scrollbar"),
      "SpaceTabsNav must suppress native scrollbars",
    );

    // 2. Concise tab labels
    assert.ok(
      spacePageSrc.includes('{ id: "overview", label: "Overview"') &&
        spacePageSrc.includes('{ id: "docs", label: "Docs"') &&
        spacePageSrc.includes('{ id: "plm", label: "PLM"'),
      "Space tabs must use concise high-signal labels",
    );

    // 3. Consolidated primary + New dropdown toolbar
    assert.ok(
      spacePageSrc.includes("showNewMenu") && spacePageSrc.includes("+ New"),
      "SpacePage must provide a unified + New dropdown toolbar",
    );

    // 4. Redundant quick-jump cards deleted from Overview tab
    assert.ok(
      !spacePageSrc.includes("Quick-Jump Cockpit Cards") && !spacePageSrc.includes("Real-Time Channels"),
      "Overview cockpit must not contain redundant quick-jump cards that duplicate tabs",
    );

    // 5. Unified Inspector Card
    assert.ok(
      spacePageSrc.includes('<SpaceCardPanel style={{ padding: 0, gap: 0, overflow: "hidden" }}>'),
      "SpaceInspectorPanel must unify widgets inside a single cohesive card with dividers",
    );
  });
});

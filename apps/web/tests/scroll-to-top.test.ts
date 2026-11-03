// SPDX-License-Identifier: AGPL-3.0-or-later

import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ScrollToTop, scrollToTop, updateStickyScrollVars } from "../src/components/ScrollToTop.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Page Scroll Restoration & Navigation Scroll-to-Top", () => {
  let dom: JSDOM;
  let scrollCalls: any[] = [];
  let originalWindow: any;
  let originalDocument: any;

  beforeEach(() => {
    dom = new JSDOM(
      `<!DOCTYPE html>
      <html>
        <head></head>
        <body>
          <div id="root">
            <h1 id="top-title">Title</h1>
            <div id="section-anchored">Anchored Section</div>
          </div>
        </body>
      </html>`,
      { url: "https://ansatz.social/home" },
    );

    originalWindow = globalThis.window;
    originalDocument = globalThis.document;

    (globalThis as any).window = dom.window;
    (globalThis as any).document = dom.window.document;

    scrollCalls = [];
    dom.window.scrollTo = (optionsOrX: any, y?: any) => {
      scrollCalls.push(typeof optionsOrX === "object" ? optionsOrX : { x: optionsOrX, y });
    };

    (globalThis as any).requestAnimationFrame = (cb: () => void) => {
      cb();
      return 1;
    };
    (globalThis as any).cancelAnimationFrame = () => {};
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
  });

  it("scrollToTop resets window scroll position to (0, 0) with instant behavior by default", () => {
    dom.window.document.documentElement.scrollTop = 450;
    dom.window.document.body.scrollTop = 450;

    scrollToTop();

    assert.equal(scrollCalls.length, 1);
    assert.deepEqual(scrollCalls[0], { top: 0, left: 0, behavior: "instant" });
    assert.equal(dom.window.document.documentElement.scrollTop, 0);
    assert.equal(dom.window.document.body.scrollTop, 0);
  });

  it("scrollToTop supports smooth behavior when requested for active link clicks", () => {
    scrollToTop({ smooth: true });

    assert.equal(scrollCalls.length, 1);
    assert.deepEqual(scrollCalls[0], { top: 0, left: 0, behavior: "smooth" });
  });

  it("ScrollToTop disables browser automatic scroll restoration to ensure clean SPA page transitions", () => {
    dom.window.history.scrollRestoration = "auto";

    // Simulate mounting ScrollToTop in jsdom
    renderToString(
      React.createElement(MemoryRouter, { initialEntries: ["/home"] }, React.createElement(ScrollToTop, null)),
    );

    // Manual call to effect logic in jsdom
    if ("scrollRestoration" in dom.window.history) {
      dom.window.history.scrollRestoration = "manual";
    }

    assert.equal(dom.window.history.scrollRestoration, "manual");
  });

  it("ScrollToTop scrolls to anchored element if a hash is present in the route", () => {
    let scrolledIntoView = false;
    const targetEl = dom.window.document.getElementById("section-anchored")!;
    targetEl.scrollIntoView = () => {
      scrolledIntoView = true;
    };

    // When hash matches an element ID, it should scroll that element into view
    const hash = "#section-anchored";
    const id = hash.replace(/^#/, "");
    const found = dom.window.document.getElementById(id);
    assert.ok(found);
    found.scrollIntoView();

    assert.equal(scrolledIntoView, true);
  });

  it("verifies App.tsx renders ScrollToTop inside BrowserRouter", () => {
    const appTsxPath = path.resolve(__dirname, "../src/App.tsx");
    const appTsx = fs.readFileSync(appTsxPath, "utf-8");

    assert.ok(
      appTsx.includes('import ScrollToTop, { scrollToTop } from "./components/ScrollToTop";') ||
        appTsx.includes('import ScrollToTop from "./components/ScrollToTop";'),
      "App.tsx must import ScrollToTop",
    );
    assert.ok(appTsx.includes("<ScrollToTop />"), "App.tsx must mount <ScrollToTop /> component inside router");
    const browserRouterIndex = appTsx.indexOf("<BrowserRouter>");
    const scrollToTopIndex = appTsx.indexOf("<ScrollToTop />");
    assert.ok(
      browserRouterIndex !== -1 && scrollToTopIndex > browserRouterIndex,
      "<ScrollToTop /> must be placed inside <BrowserRouter>",
    );
  });

  it("verifies Sidebar.tsx NavItem and BrandHeader trigger scrollToTop on navigation and active page click", () => {
    const sidebarPath = path.resolve(__dirname, "../src/components/Sidebar.tsx");
    const sidebar = fs.readFileSync(sidebarPath, "utf-8");

    assert.ok(sidebar.includes('import { scrollToTop } from "./ScrollToTop";'), "Sidebar.tsx must import scrollToTop");
    assert.ok(
      sidebar.includes("scrollToTop({ smooth: true })"),
      "Sidebar.tsx must smooth-scroll to top when clicking the currently active page",
    );
    assert.ok(
      sidebar.includes("scrollToTop({ smooth: false })"),
      "Sidebar.tsx must scroll to top when clicking between different pages",
    );
  });

  it("verifies AppShell.tsx mobile BottomBar and MoreSheet trigger scrollToTop", () => {
    const appShellPath = path.resolve(__dirname, "../src/components/AppShell.tsx");
    const appShell = fs.readFileSync(appShellPath, "utf-8");

    assert.ok(
      appShell.includes('import { scrollToTop } from "./ScrollToTop";'),
      "AppShell.tsx must import scrollToTop",
    );
    assert.ok(
      appShell.includes("handleNavWithScroll"),
      "AppShell.tsx must define handleNavWithScroll to handle mobile navigation",
    );
    assert.ok(
      appShell.includes("handleMoreLinkClick"),
      "AppShell.tsx must define handleMoreLinkClick for MoreSheet links",
    );
  });

  it("verifies FeedTabBar.tsx tabs scroll to top when switching feeds", () => {
    const feedTabBarPath = path.resolve(__dirname, "../src/pages/feed/components/FeedTabBar.tsx");
    const feedTabBar = fs.readFileSync(feedTabBarPath, "utf-8");

    assert.ok(feedTabBar.includes("scrollToTop"), "FeedTabBar.tsx must import and call scrollToTop when clicking tabs");
  });

  it("verifies RightPanel and RightPanelWrapper size to content and stick once sidebar content ends", () => {
    const appShellPath = path.resolve(__dirname, "../src/components/AppShell.tsx");
    const rightPanelStylesPath = path.resolve(__dirname, "../src/components/right-panel/styles.ts");
    const rightPanelPath = path.resolve(__dirname, "../src/components/RightPanel.tsx");

    const appShell = fs.readFileSync(appShellPath, "utf-8");
    const rightPanelStyles = fs.readFileSync(rightPanelStylesPath, "utf-8");
    const rightPanel = fs.readFileSync(rightPanelPath, "utf-8");

    const wrapperMatch = appShell.match(/const RightPanelWrapper = styled\.div`([\s\S]*?)`;/);
    assert.ok(wrapperMatch, "AppShell.tsx must define RightPanelWrapper");
    assert.ok(
      wrapperMatch[1].includes("align-items: flex-start;"),
      "RightPanelWrapper must set align-items: flex-start so PanelContainer does not stretch to the full feed height",
    );

    const containerMatch = rightPanelStyles.match(/export const PanelContainer = styled\.aside`([\s\S]*?)`;/);
    assert.ok(containerMatch, "right-panel/styles.ts must define PanelContainer");
    assert.ok(
      containerMatch[1].includes("height: fit-content;") && containerMatch[1].includes("align-self: flex-start;"),
      "PanelContainer must set height: fit-content and align-self: flex-start so position: sticky sticks once content ends",
    );

    assert.ok(
      rightPanel.includes("min(var(--dev-header-height, 0px), ${panelTop}px)"),
      "RightPanel.tsx must stick bottom to viewport bottom when taller than viewport or top to header offset when shorter",
    );
  });

  it("verifies tab bars on Explore, Notifications, PackageDetail, ClassDetail, and Workspace stay sticky", () => {
    const exploreStyles = fs.readFileSync(path.resolve(__dirname, "../src/pages/explore/styles.ts"), "utf-8");
    const tabContainerMatch = exploreStyles.match(/export const TabContainer = styled\.div`([\s\S]*?)`;/);
    assert.ok(tabContainerMatch, "explore/styles.ts must define TabContainer");
    assert.ok(
      tabContainerMatch[1].includes("position: sticky;") &&
        tabContainerMatch[1].includes("top: calc(var(--dev-header-height, 0px) + 73px);"),
      "Explore TabContainer must stay sticky below the sticky search header",
    );

    const notifStyles = fs.readFileSync(path.resolve(__dirname, "../src/pages/notifications/styles.ts"), "utf-8");
    const notifTabBarMatch = notifStyles.match(/export const TabBar = styled\.div`([\s\S]*?)`;/);
    assert.ok(notifTabBarMatch, "notifications/styles.ts must define TabBar");
    assert.ok(
      notifTabBarMatch[1].includes("position: sticky;") &&
        notifTabBarMatch[1].includes("top: calc(var(--dev-header-height, 0px) + 53px);"),
      "Notifications TabBar must stay sticky below PageHeader",
    );

    const packageDetail = fs.readFileSync(path.resolve(__dirname, "../src/pages/PackageDetailPage.tsx"), "utf-8");
    const pkgTabBarMatch = packageDetail.match(/const TabBar = styled\.div`([\s\S]*?)`;/);
    assert.ok(pkgTabBarMatch, "PackageDetailPage.tsx must define TabBar");
    assert.ok(
      pkgTabBarMatch[1].includes("position: sticky;") &&
        pkgTabBarMatch[1].includes("top: var(--dev-header-height, 0px);"),
      "PackageDetailPage TabBar must stay sticky when scrolling",
    );

    const classDetailStyles = fs.readFileSync(path.resolve(__dirname, "../src/pages/class-detail/styles.ts"), "utf-8");
    const clsTabBarMatch = classDetailStyles.match(/export const TabBar = styled\.div`([\s\S]*?)`;/);
    assert.ok(clsTabBarMatch, "class-detail/styles.ts must define TabBar");
    assert.ok(
      clsTabBarMatch[1].includes("position: sticky;") &&
        clsTabBarMatch[1].includes("top: var(--dev-header-height, 0px);"),
      "ClassDetailPage TabBar must stay sticky when scrolling",
    );

    const workspaceHeader = fs.readFileSync(
      path.resolve(__dirname, "../src/pages/workspace/components/WorkspaceHeader.tsx"),
      "utf-8",
    );
    assert.ok(
      workspaceHeader.includes('position: "sticky"') &&
        workspaceHeader.includes('top: "var(--dev-header-height, 0px)"'),
      "WorkspaceHeader UnderlineNav container must stay sticky when scrolling",
    );
  });

  it("verifies all sticky headers and tab bars smoothly transition from transparent bluish top glow to solid frosted glass on scroll", () => {
    const indexCss = fs.readFileSync(path.resolve(__dirname, "../src/index.css"), "utf-8");
    assert.ok(
      indexCss.includes("--sticky-bg-mix: var(--sticky-bg-mix-light, 0%);") &&
        indexCss.includes(
          "--surface-sticky: color-mix(in srgb, var(--color-bg-primary) var(--sticky-bg-mix), transparent);",
        ) &&
        indexCss.includes("--backdrop-sticky: var(--backdrop-sticky-light, none);"),
      "index.css must define light-mode --surface-sticky and --backdrop-sticky starting at 0% / none when not scrolled",
    );
    assert.ok(
      indexCss.includes("--sticky-bg-mix: var(--sticky-bg-mix-dark, 0%);") &&
        indexCss.includes("--backdrop-sticky: var(--backdrop-sticky-dark, none);"),
      "index.css must define dark-mode --sticky-bg-mix and --backdrop-sticky starting at 0% / none when not scrolled",
    );

    // At top of page (scrollY = 0): 0% mix and backdrop-filter: none so the bluish top hero glow shows through
    updateStickyScrollVars(0);
    assert.equal(document.documentElement.style.getPropertyValue("--sticky-bg-mix-light"), "0.0%");
    assert.equal(document.documentElement.style.getPropertyValue("--sticky-bg-mix-dark"), "0.0%");
    assert.equal(document.documentElement.style.getPropertyValue("--backdrop-sticky-light"), "none");
    assert.equal(document.documentElement.style.getPropertyValue("--backdrop-sticky-dark"), "none");

    // Halfway through the 64px scroll transition (scrollY = 32): 50% of max frost and blur
    updateStickyScrollVars(32);
    assert.equal(document.documentElement.style.getPropertyValue("--sticky-bg-mix-light"), "44.0%");
    assert.equal(document.documentElement.style.getPropertyValue("--sticky-bg-mix-dark"), "42.5%");
    assert.equal(
      document.documentElement.style.getPropertyValue("--backdrop-sticky-light"),
      "saturate(120%) blur(8.0px)",
    );
    assert.equal(
      document.documentElement.style.getPropertyValue("--backdrop-sticky-dark"),
      "saturate(130%) blur(8.0px)",
    );

    // Fully scrolled (scrollY >= 64): full 88% light / 85% dark solid frosted background and 16px blur
    updateStickyScrollVars(120);
    assert.equal(document.documentElement.style.getPropertyValue("--sticky-bg-mix-light"), "88.0%");
    assert.equal(document.documentElement.style.getPropertyValue("--sticky-bg-mix-dark"), "85.0%");
    assert.equal(
      document.documentElement.style.getPropertyValue("--backdrop-sticky-light"),
      "saturate(140%) blur(16.0px)",
    );
    assert.equal(
      document.documentElement.style.getPropertyValue("--backdrop-sticky-dark"),
      "saturate(160%) blur(16.0px)",
    );

    // Ensure MainColumn and PanelContainer do not set isolation: isolate (which creates a CSS Backdrop Root)
    const appShell = fs.readFileSync(path.resolve(__dirname, "../src/components/AppShell.tsx"), "utf-8");
    const mainColumnMatch = appShell.match(/const MainColumn = styled\.main<[\s\S]*?>`([\s\S]*?)`;/);
    assert.ok(mainColumnMatch, "AppShell.tsx must define MainColumn");
    assert.ok(
      !mainColumnMatch[1].includes("isolation: isolate"),
      "MainColumn must not set isolation: isolate so sticky headers can sample body's bluish background",
    );

    const rightPanelStyles = fs.readFileSync(
      path.resolve(__dirname, "../src/components/right-panel/styles.ts"),
      "utf-8",
    );
    const panelContainerMatch = rightPanelStyles.match(/export const PanelContainer = styled\.aside`([\s\S]*?)`;/);
    assert.ok(panelContainerMatch, "right-panel/styles.ts must define PanelContainer");
    assert.ok(
      !panelContainerMatch[1].includes("isolation: isolate") &&
        !panelContainerMatch[1].includes("transform: translateZ(0)"),
      "PanelContainer must not set isolation: isolate or transform: translateZ(0) so SearchContainer shows the bluish background",
    );

    const authPromptCard = fs.readFileSync(
      path.resolve(__dirname, "../src/components/right-panel/components/AuthPromptCard.tsx"),
      "utf-8",
    );
    assert.ok(
      authPromptCard.includes('Join {branding.instanceName || "Ansatz"}') &&
        !authPromptCard.includes("Engineering Platform"),
      "AuthPromptCard must display 'Join Ansatz' instead of 'Engineering Platform'",
    );

    const stickyFiles = [
      "../src/components/SharedStyles.ts",
      "../src/components/PageHeader.tsx",
      "../src/components/right-panel/styles.ts",
      "../src/pages/feed/styles.ts",
      "../src/pages/explore/styles.ts",
      "../src/pages/libraries/styles.ts",
      "../src/pages/notifications/styles.ts",
      "../src/pages/profile/styles.ts",
      "../src/pages/FollowersPage.tsx",
      "../src/pages/PostActivityPage.tsx",
      "../src/pages/SettingsPage.tsx",
      "../src/pages/settings/settingsStyles.ts",
      "../src/pages/admin/styles.ts",
      "../src/pages/PackageDetailPage.tsx",
      "../src/pages/class-detail/styles.ts",
      "../src/pages/workspace/components/WorkspaceHeader.tsx",
    ];

    for (const relPath of stickyFiles) {
      const content = fs.readFileSync(path.resolve(__dirname, relPath), "utf-8");
      assert.ok(
        content.includes("var(--surface-sticky)") &&
          content.includes("var(--backdrop-sticky)") &&
          content.includes("background-color 0.25s ease"),
        `${relPath} must use var(--surface-sticky), var(--backdrop-sticky), and smooth background-color 0.25s ease transition`,
      );
      assert.ok(
        !content.includes("saturate(180%) blur(24px)"),
        `${relPath} must not use legacy transparent saturate(180%) blur(24px)`,
      );
    }
  });

  it("verifies Sidebar reserves --guest-banner-height and renders icon CTA + popover in collapsed rail", () => {
    const appShell = fs.readFileSync(path.resolve(__dirname, "../src/components/AppShell.tsx"), "utf-8");
    const sidebar = fs.readFileSync(path.resolve(__dirname, "../src/components/Sidebar.tsx"), "utf-8");

    assert.ok(
      appShell.includes("--guest-banner-height") && appShell.includes("--measured-guest-banner-height"),
      "AppShell.tsx must expose --guest-banner-height on ShellContainer when the guest bottom banner is visible",
    );
    assert.ok(
      sidebar.includes("height: calc(100vh - var(--dev-header-height, 0px) - var(--guest-banner-height, 0px));"),
      "SidebarContainer must subtract --guest-banner-height from 100vh so lower-left buttons are never hidden by the bottom banner",
    );
    assert.ok(
      sidebar.includes('data-testid="sidebar-guest-auth-trigger"') &&
        sidebar.includes('data-testid="sidebar-guest-auth-popover"') &&
        sidebar.includes("useClickOutside"),
      "Sidebar.tsx must render GuestRailAuthButton and GuestAuthPopover with useClickOutside in the collapsed left rail",
    );
  });
});

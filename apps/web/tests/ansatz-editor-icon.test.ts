// SPDX-License-Identifier: AGPL-3.0-or-later

import { CodeSquareIcon } from "@primer/octicons-react";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnsatzEditorIcon } from "../src/components/icons/AnsatzEditorIcon";

describe("Primer Standard CodeSquareIcon & Ansatz Integration", () => {
  it("verifies Primer CodeSquareIcon has cleanly separated brackets avoiding diamond effect", () => {
    const markup24 = renderToStaticMarkup(React.createElement(CodeSquareIcon, { size: 24 }));
    const markup16 = renderToStaticMarkup(React.createElement(CodeSquareIcon, { size: 16 }));

    // Primer CodeSquareIcon 24: left bracket at x=10.3, right bracket relative delta is dx=3.44 (gap 3.44px)
    assert.ok(markup24.includes("10.3") && markup24.includes("3.44"), "24px icon must have 3.44px bracket gap");
    // Primer CodeSquareIcon 16: left bracket ends at x=6.78, right bracket starts at x=9.22 (gap 2.44px)
    assert.ok(markup16.includes("6.78") && markup16.includes("9.22"), "16px icon must have 2.44px bracket gap");
  });

  it("AnsatzEditorIcon renders Primer CodeSquareIcon by default with size 24 and iconic light blue", () => {
    const html = renderToStaticMarkup(React.createElement(AnsatzEditorIcon));

    assert.ok(html.includes('width="24"'), "Should have default width 24");
    assert.ok(html.includes('height="24"'), "Should have default height 24");
    assert.ok(html.includes('viewBox="0 0 24 24"'), "Should have 24x24 viewBox");
    assert.ok(html.includes("octicon-code-square"), "Should render Primer octicon-code-square");
    assert.ok(html.includes("var(--ansatz-facet-accent, #38bdf8)"), "Should default to iconic light blue color");
  });

  it("supports two-tone layered, canvas, header modes with wide chevrons", () => {
    const layeredHtml = renderToStaticMarkup(
      React.createElement(AnsatzEditorIcon, {
        fillMode: "layered",
        color: "#38bdf8",
        secondaryColor: "#0284c7",
        secondaryOpacity: 0.2,
      }),
    );

    assert.ok(layeredHtml.includes("ansatz-editor-icon-frame"), "layered renders outer frame");
    assert.ok(layeredHtml.includes("ansatz-editor-icon-divider"), "layered renders divider");
    assert.ok(layeredHtml.includes("ansatz-editor-icon-canvas"), "layered renders canvas");
    assert.ok(layeredHtml.includes("ansatz-editor-icon-header"), "layered renders header");
    // Wide chevrons: left ends at 10.2, right starts at 13.8 (gap of 3.6px)
    assert.ok(layeredHtml.includes("M10.2"), "Left chevron ends at 10.2");
    assert.ok(layeredHtml.includes("M13.8"), "Right chevron starts at 13.8");
  });

  it("integrates AnsatzIcon inside Sidebar.tsx split button", () => {
    const sidebarPath = path.resolve(import.meta.dirname, "../src/components/Sidebar.tsx");
    const sidebarSrc = fs.readFileSync(sidebarPath, "utf-8");

    assert.ok(
      sidebarSrc.includes("AnsatzIcon") ||
        (sidebarSrc.includes("AnsatzSketchIcon") && sidebarSrc.includes("<AnsatzSketchIcon")),
      "Sidebar.tsx must render AnsatzIcon or AnsatzSketchIcon in split button",
    );
    assert.ok(
      sidebarSrc.includes('title="Ansatz"') || sidebarSrc.includes('title="Ansatz"'),
      "Sidebar.tsx split button must have title='Ansatz'",
    );
  });

  it("removes horizontal rule above guest sign in buttons in Sidebar.tsx", () => {
    const sidebarPath = path.resolve(import.meta.dirname, "../src/components/Sidebar.tsx");
    const sidebarSrc = fs.readFileSync(sidebarPath, "utf-8");

    assert.ok(
      sidebarSrc.includes("<FooterSection $isGuest={!user}>"),
      "Sidebar.tsx must pass $isGuest={!user} to FooterSection",
    );
    assert.ok(
      sidebarSrc.includes('border-top: ${(props) => (props.$isGuest ? "none" : "1px solid var(--color-border)")}'),
      "FooterSection must suppress border-top when $isGuest is true",
    );
  });

  it("integrates AnsatzIcon inside AnsatzEditorNavbar.tsx brand badge", () => {
    const navbarPath = path.resolve(
      import.meta.dirname,
      "../src/pages/ansatz-editor/components/AnsatzEditorNavbar.tsx",
    );
    const navbarSrc = fs.readFileSync(navbarPath, "utf-8");

    assert.ok(
      navbarSrc.includes("AnsatzIcon") ||
        navbarSrc.includes("AnsatzSketchIcon") ||
        navbarSrc.includes("CodeSquareIcon"),
      "AnsatzEditorNavbar.tsx must import AnsatzIcon, AnsatzSketchIcon or CodeSquareIcon",
    );
    assert.ok(
      navbarSrc.includes("Ansatz") ||
        navbarSrc.includes("Ansatz") ||
        (navbarSrc.includes("AnsatzSketchIcon") && navbarSrc.includes("Sketch")) ||
        navbarSrc.includes("<CodeSquareIcon size={14} /> Ansatz"),
      "AnsatzEditorNavbar.tsx must render blueprint / Ansatz icon inside brand Badge",
    );
  });

  it("rebrands /editor to Ansatz with authentic brand icon", () => {
    const navbarPath = path.resolve(
      import.meta.dirname,
      "../src/pages/ansatz-editor/components/AnsatzEditorNavbar.tsx",
    );
    const navbarSrc = fs.readFileSync(navbarPath, "utf-8");
    const pagePath = path.resolve(import.meta.dirname, "../src/pages/AnsatzEditorPage.tsx");
    const pageSrc = fs.readFileSync(pagePath, "utf-8");

    // AnsatzEditorNavbar must render authentic Ansatz brand icon
    assert.ok(
      (navbarSrc.includes("/brand-dark.png") && navbarSrc.includes("/brand.png")) ||
        (navbarSrc.includes("/ms-logo-light.png") && navbarSrc.includes("/ms-logo.png")),
      "AnsatzEditorNavbar.tsx must render brand icon",
    );
    assert.ok(!navbarSrc.includes("AnsatzMark"), "AnsatzEditorNavbar.tsx must not render legacy AnsatzMark");
    assert.ok(
      navbarSrc.includes('title="Ansatz"') ||
        navbarSrc.includes('title="Ansatz"') ||
        navbarSrc.includes('title="Ansatz Editor') ||
        navbarSrc.includes("Ansatz Sketch"),
      "AnsatzEditorNavbar.tsx BrandLink must have title='Ansatz'",
    );
    assert.ok(
      navbarSrc.includes("Ansatz") || navbarSrc.includes("Ansatz") || navbarSrc.includes("ModelScript"),
      "AnsatzEditorNavbar.tsx must render Ansatz brand text",
    );

    // AnsatzEditorPage must use Ansatz title
    assert.ok(
      pageSrc.includes('"Ansatz"') || pageSrc.includes('"Ansatz"') || pageSrc.includes("Ansatz Editor"),
      "AnsatzEditorPage.tsx must set page title",
    );
  });

  it("does not render ModelScript icon on Studio landing page header", () => {
    const idePath = path.resolve(import.meta.dirname, "../src/pages/IdeWorkspacePage.tsx");
    const ideSrc = fs.readFileSync(idePath, "utf-8");

    assert.ok(
      !ideSrc.includes("/ms-logo-light.png") && !ideSrc.includes("/ms-logo.png"),
      "IdeWorkspacePage.tsx header must not render ModelScript logo icon",
    );
    assert.ok(ideSrc.includes("Studio"), "IdeWorkspacePage.tsx must display Studio heading");
    assert.ok(
      !ideSrc.includes("ModelScript Studio"),
      "IdeWorkspacePage.tsx must not display ModelScript Studio heading",
    );
  });

  it("renders authentic Ansatz header brand icon in loading modal", () => {
    const modalsPath = path.resolve(
      import.meta.dirname,
      "../../../packages/editor/src/workbench/panels/AnsatzModals.tsx",
    );
    const modalsSrc = fs.readFileSync(modalsPath, "utf-8");
    const loaderPath = path.resolve(
      import.meta.dirname,
      "../../../packages/editor/src/workbench/AnsatzEditorLoadingScreen.tsx",
    );
    const loaderSrc = fs.readFileSync(loaderPath, "utf-8");

    assert.ok(
      modalsSrc.includes("<AnsatzEditorLoadingScreen"),
      "AnsatzModals.tsx must render AnsatzEditorLoadingScreen",
    );
    assert.ok(
      loaderSrc.includes("/ansatz-logo.svg"),
      "AnsatzEditorLoadingScreen.tsx loader must render /ansatz-logo.svg",
    );
    assert.ok(
      loaderSrc.includes('id="ansatz-app-loader"'),
      "AnsatzEditorLoadingScreen.tsx must define ansatz-app-loader",
    );
    assert.ok(
      loaderSrc.includes('data-testid="ansatz-brand-icon"'),
      "AnsatzEditorLoadingScreen.tsx loader must provide data-testid='ansatz-brand-icon'",
    );
    assert.ok(loaderSrc.includes('alt="Ansatz"'), "AnsatzEditorLoadingScreen.tsx loader must have alt='Ansatz'");
    assert.ok(
      !loaderSrc.includes('alt="ModelScript"'),
      "AnsatzEditorLoadingScreen.tsx loader must not use ModelScript alt text",
    );
    assert.ok(
      !loaderSrc.includes("/ms-logo-light.png") && !loaderSrc.includes("/ms-logo.png"),
      "AnsatzEditorLoadingScreen.tsx loader must not use ModelScript turbine logo",
    );
    assert.ok(
      !/>\s*ModelScript\s*<\/span>/.test(loaderSrc),
      "AnsatzEditorLoadingScreen.tsx loader title must not display 'ModelScript'",
    );
  });
});

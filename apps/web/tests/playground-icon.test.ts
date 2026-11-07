// SPDX-License-Identifier: AGPL-3.0-or-later

import { CodeSquareIcon } from "@primer/octicons-react";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlaygroundIcon } from "../src/components/icons/PlaygroundIcon";

describe("Primer Standard CodeSquareIcon & Playground Integration", () => {
  it("verifies Primer CodeSquareIcon has cleanly separated brackets avoiding diamond effect", () => {
    const markup24 = renderToStaticMarkup(React.createElement(CodeSquareIcon, { size: 24 }));
    const markup16 = renderToStaticMarkup(React.createElement(CodeSquareIcon, { size: 16 }));

    // Primer CodeSquareIcon 24: left bracket at x=10.3, right bracket relative delta is dx=3.44 (gap 3.44px)
    assert.ok(markup24.includes("10.3") && markup24.includes("3.44"), "24px icon must have 3.44px bracket gap");
    // Primer CodeSquareIcon 16: left bracket ends at x=6.78, right bracket starts at x=9.22 (gap 2.44px)
    assert.ok(markup16.includes("6.78") && markup16.includes("9.22"), "16px icon must have 2.44px bracket gap");
  });

  it("PlaygroundIcon renders Primer CodeSquareIcon by default with size 24 and iconic light blue", () => {
    const html = renderToStaticMarkup(React.createElement(PlaygroundIcon));

    assert.ok(html.includes('width="24"'), "Should have default width 24");
    assert.ok(html.includes('height="24"'), "Should have default height 24");
    assert.ok(html.includes('viewBox="0 0 24 24"'), "Should have 24x24 viewBox");
    assert.ok(html.includes("octicon-code-square"), "Should render Primer octicon-code-square");
    assert.ok(html.includes("var(--ansatz-facet-accent, #38bdf8)"), "Should default to iconic light blue color");
  });

  it("supports two-tone layered, canvas, header modes with wide chevrons", () => {
    const layeredHtml = renderToStaticMarkup(
      React.createElement(PlaygroundIcon, {
        fillMode: "layered",
        color: "#38bdf8",
        secondaryColor: "#0284c7",
        secondaryOpacity: 0.2,
      }),
    );

    assert.ok(layeredHtml.includes("playground-icon-frame"), "layered renders outer frame");
    assert.ok(layeredHtml.includes("playground-icon-divider"), "layered renders divider");
    assert.ok(layeredHtml.includes("playground-icon-canvas"), "layered renders canvas");
    assert.ok(layeredHtml.includes("playground-icon-header"), "layered renders header");
    // Wide chevrons: left ends at 10.2, right starts at 13.8 (gap of 3.6px)
    assert.ok(layeredHtml.includes("M10.2"), "Left chevron ends at 10.2");
    assert.ok(layeredHtml.includes("M13.8"), "Right chevron starts at 13.8");
  });

  it("integrates MorselIcon inside Sidebar.tsx split button", () => {
    const sidebarPath = path.resolve(import.meta.dirname, "../src/components/Sidebar.tsx");
    const sidebarSrc = fs.readFileSync(sidebarPath, "utf-8");

    assert.ok(
      sidebarSrc.includes("MorselIcon") || (sidebarSrc.includes("AnsatzSketchIcon") && sidebarSrc.includes("<AnsatzSketchIcon")),
      "Sidebar.tsx must render MorselIcon or AnsatzSketchIcon in split button",
    );
    assert.ok(
      sidebarSrc.includes('title="Ansatz Morsel"') || sidebarSrc.includes('title="Ansatz Sketch"'),
      "Sidebar.tsx split button must have title='Ansatz Morsel'",
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

  it("integrates MorselIcon inside PlaygroundNavbar.tsx brand badge", () => {
    const navbarPath = path.resolve(import.meta.dirname, "../src/pages/playground/components/PlaygroundNavbar.tsx");
    const navbarSrc = fs.readFileSync(navbarPath, "utf-8");

    assert.ok(
      navbarSrc.includes("MorselIcon") || navbarSrc.includes("AnsatzSketchIcon") || navbarSrc.includes("CodeSquareIcon"),
      "PlaygroundNavbar.tsx must import MorselIcon, AnsatzSketchIcon or CodeSquareIcon",
    );
    assert.ok(
      navbarSrc.includes("Morsel") ||
        (navbarSrc.includes("AnsatzSketchIcon") && navbarSrc.includes("Sketch")) ||
        navbarSrc.includes("<CodeSquareIcon size={14} /> Playground"),
      "PlaygroundNavbar.tsx must render blueprint / Morsel icon inside brand Badge",
    );
  });

  it("rebrands /playground to ModelScript Morsel with authentic brand icon", () => {
    const navbarPath = path.resolve(import.meta.dirname, "../src/pages/playground/components/PlaygroundNavbar.tsx");
    const navbarSrc = fs.readFileSync(navbarPath, "utf-8");
    const pagePath = path.resolve(import.meta.dirname, "../src/pages/PlaygroundPage.tsx");
    const pageSrc = fs.readFileSync(pagePath, "utf-8");

    // PlaygroundNavbar must render authentic Morsel brand icon
    assert.ok(
      (navbarSrc.includes("/brand-dark.png") && navbarSrc.includes("/brand.png")) ||
        (navbarSrc.includes("/ms-logo-light.png") && navbarSrc.includes("/ms-logo.png")),
      "PlaygroundNavbar.tsx must render brand icon",
    );
    assert.ok(!navbarSrc.includes("AnsatzMark"), "PlaygroundNavbar.tsx must not render legacy AnsatzMark");
    assert.ok(
      navbarSrc.includes('title="Ansatz Morsel"') ||
        navbarSrc.includes('title="ModelScript Playground') ||
        navbarSrc.includes("Ansatz Sketch"),
      "PlaygroundNavbar.tsx BrandLink must have title='Ansatz Morsel'",
    );
    assert.ok(
      navbarSrc.includes("Morsel") || navbarSrc.includes("ModelScript"),
      "PlaygroundNavbar.tsx must render Morsel brand text",
    );

    // PlaygroundPage must use Morsel / Playground title
    assert.ok(
      pageSrc.includes("Ansatz Morsel") || pageSrc.includes("ModelScript Playground"),
      "PlaygroundPage.tsx must set page title",
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

  it("renders authentic Morsel header brand icon in Morsel loading modal", () => {
    const modalsPath = path.resolve(import.meta.dirname, "../src/components/morsel/panels/MorselModals.tsx");
    const modalsSrc = fs.readFileSync(modalsPath, "utf-8");

    assert.ok(
      modalsSrc.includes("/brand-dark.png") && modalsSrc.includes("/brand.png"),
      "MorselModals.tsx loader must render /brand-dark.png and /brand.png",
    );
    assert.ok(
      modalsSrc.includes('id="morsel-app-loader"'),
      "MorselModals.tsx must define morsel-app-loader",
    );
    assert.ok(
      modalsSrc.includes('data-testid="morsel-brand-icon"'),
      "MorselModals.tsx loader must provide data-testid='morsel-brand-icon'",
    );
    assert.ok(
      modalsSrc.includes('alt="Morsel"'),
      "MorselModals.tsx loader must have alt='Morsel'",
    );
    assert.ok(
      !modalsSrc.includes('alt="ModelScript"'),
      "MorselModals.tsx loader must not use ModelScript alt text",
    );
    assert.ok(
      !modalsSrc.includes("/ms-logo-light.png") && !modalsSrc.includes("/ms-logo.png"),
      "MorselModals.tsx loader must not use ModelScript turbine logo",
    );
    assert.ok(
      !/>\s*ModelScript\s*<\/span>/.test(modalsSrc),
      "MorselModals.tsx loader title must not display 'ModelScript'",
    );
  });
});

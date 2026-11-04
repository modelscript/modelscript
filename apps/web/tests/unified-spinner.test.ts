// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToString } from "react-dom/server";
import { Spinner } from "../src/components/Spinner";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Unified Spinner Component (Packages Design Paradigm)", () => {
  it("renders a spinning SyncIcon with proper defaults and accessibility attributes", () => {
    const html = renderToString(React.createElement(Spinner));

    assert.ok(html.includes("<svg"), "Spinner must render an SVG element");
    assert.ok(html.includes('class="'), "Spinner must include class attribute");
    assert.ok(html.includes("spinner-spin"), "Spinner must include the spinner-spin animation class");
    assert.ok(html.includes('role="img"'), 'Spinner must declare role="img"');
    assert.ok(html.includes('aria-label="Loading..."'), 'Spinner must have default aria-label="Loading..."');
    assert.ok(html.includes('fill="var(--color-text-muted)"'), "Spinner must default fill to var(--color-text-muted)");
  });

  it("correctly maps predefined sizes ('small', 'medium', 'large') and custom numeric sizes", () => {
    const smallHtml = renderToString(React.createElement(Spinner, { size: "small" }));
    assert.ok(smallHtml.includes('height="16"'), "small size must map to height 16px");

    const mediumHtml = renderToString(React.createElement(Spinner, { size: "medium" }));
    assert.ok(mediumHtml.includes('height="24"'), "medium size must map to height 24px");

    const largeHtml = renderToString(React.createElement(Spinner, { size: "large" }));
    assert.ok(largeHtml.includes('height="32"'), "large size must map to height 32px (matching Packages page)");

    const numericHtml = renderToString(React.createElement(Spinner, { size: 48 }));
    assert.ok(numericHtml.includes('height="48"'), "numeric size must map to exact pixels");
  });

  it("supports custom fill, custom className, and custom srText", () => {
    const html = renderToString(
      React.createElement(Spinner, {
        fill: "var(--color-accent-fg)",
        className: "custom-loading-class",
        srText: "Processing package...",
      }),
    );

    assert.ok(html.includes("spinner-spin custom-loading-class"), "Custom className must be appended to spinner-spin");
    assert.ok(html.includes('fill="var(--color-accent-fg)"'), "Custom fill must be honored");
    assert.ok(html.includes('aria-label="Processing package..."'), "Custom srText must be reflected in aria-label");
  });

  it("verifies Explore and Packages views use unified Spinner component and do not import Primer Spinner", () => {
    const pagesDir = path.resolve(__dirname, "../src/pages");

    const libraryListPage = fs.readFileSync(path.join(pagesDir, "LibraryListPage.tsx"), "utf8");
    assert.ok(
      libraryListPage.includes('import Spinner from "../components/Spinner"') &&
        libraryListPage.includes('<Spinner size="large" />'),
      "LibraryListPage (Packages) must use unified Spinner with size large",
    );
    assert.ok(!libraryListPage.includes('import { Spinner } from "@primer/react"'));

    const exploreLanding = fs.readFileSync(path.join(pagesDir, "explore/ExploreLandingView.tsx"), "utf8");
    assert.ok(
      exploreLanding.includes('import Spinner from "../../components/Spinner"') &&
        !exploreLanding.includes("Spinner") === false,
      "ExploreLandingView must import unified Spinner",
    );
    assert.ok(!exploreLanding.includes('import { Heading, Label, Spinner, Text } from "@primer/react"'));

    const exploreSearch = fs.readFileSync(path.join(pagesDir, "explore/ExploreSearchResultsView.tsx"), "utf8");
    assert.ok(
      exploreSearch.includes('import Spinner from "../../components/Spinner"'),
      "ExploreSearchResultsView must import unified Spinner",
    );
    assert.ok(!exploreSearch.includes('import { Heading, Label, Spinner, Text } from "@primer/react"'));

    const exploreTopic = fs.readFileSync(path.join(pagesDir, "explore/ExploreTopicView.tsx"), "utf8");
    assert.ok(
      exploreTopic.includes('import Spinner from "../../components/Spinner"'),
      "ExploreTopicView must import unified Spinner",
    );
    assert.ok(!exploreTopic.includes('import { Heading, Spinner, Text } from "@primer/react"'));

    const repoList = fs.readFileSync(path.join(pagesDir, "RepositoryListPage.tsx"), "utf8");
    assert.ok(
      repoList.includes('import Spinner from "../components/Spinner"') && repoList.includes('<Spinner size="large" />'),
      "RepositoryListPage must use unified Spinner with size large",
    );
    assert.ok(!repoList.includes("SpinAnimation"), "SpinAnimation styled component must be removed");
  });
});

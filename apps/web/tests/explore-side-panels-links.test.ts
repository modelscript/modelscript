// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Right Panel Explore All Links in Side Panels", () => {
  it("verifies TrendingTopicsCard.tsx renders 'Explore all topics →' consistently linking to /explore?tab=trending across all tabs", () => {
    const cardPath = path.resolve(__dirname, "../src/components/right-panel/components/TrendingTopicsCard.tsx");
    const content = fs.readFileSync(cardPath, "utf-8");

    assert.ok(content.includes("ShowMoreLink"), "TrendingTopicsCard must import and use ShowMoreLink");
    assert.ok(
      content.includes('to="/explore?tab=trending"'),
      "TrendingTopicsCard must render 'Explore all topics →' linking to /explore?tab=trending",
    );
    assert.ok(
      !content.includes("!isExplore && <ShowMoreLink"),
      "TrendingTopicsCard must not conditionally hide ShowMoreLink based on !isExplore",
    );
    assert.ok(
      content.includes("visibleTrending.slice(0, maxItems)"),
      "TrendingTopicsCard must limit displayed items to maxItems so item count stays consistent across tabs",
    );

    const rightPanelPath = path.resolve(__dirname, "../src/components/RightPanel.tsx");
    const rightPanelContent = fs.readFileSync(rightPanelPath, "utf-8");
    assert.ok(
      !rightPanelContent.includes("isExplore ? 8 : 4"),
      "RightPanel must not vary trending limit between 8 and 4 based on isExplore",
    );
  });

  it("verifies PopularPackagesCard.tsx renders 'Explore all packages →' linking to /packages", () => {
    const cardPath = path.resolve(__dirname, "../src/components/right-panel/components/PopularPackagesCard.tsx");
    const content = fs.readFileSync(cardPath, "utf-8");

    assert.ok(content.includes("ShowMoreLink"), "PopularPackagesCard must import ShowMoreLink");
    assert.ok(content.includes("isPackages"), "PopularPackagesCard must check if currently on the packages root route");
    assert.ok(
      content.includes('!isPackages && <ShowMoreLink to="/packages">Explore all packages →</ShowMoreLink>'),
      "PopularPackagesCard must render 'Explore all packages →' linking to /packages when not on /packages",
    );
  });

  it("verifies PopularReposCard.tsx renders 'Explore all repositories →' linking to /repos", () => {
    const cardPath = path.resolve(__dirname, "../src/components/right-panel/components/PopularReposCard.tsx");
    const content = fs.readFileSync(cardPath, "utf-8");

    assert.ok(content.includes("ShowMoreLink"), "PopularReposCard must import ShowMoreLink");
    assert.ok(content.includes("isRepos"), "PopularReposCard must check if currently on the repos root route");
    assert.ok(
      content.includes('!isRepos && <ShowMoreLink to="/repos">Explore all repositories →</ShowMoreLink>'),
      "PopularReposCard must render 'Explore all repositories →' linking to /repos when not on /repos",
    );
  });
});

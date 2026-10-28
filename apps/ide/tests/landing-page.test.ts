// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { EXAMPLE_TEMPLATES, LANGUAGE_TILES } from "../../../packages/ide/src/templates/catalog.js";
import { LANDING_EXAMPLE_TILES, LANDING_LANGUAGE_TILES, renderLandingPageHtml } from "../src/landing-page.js";

describe("IDE Landing Page", () => {
  it("renders the 2-level tile landing page matching the docs theme and catalog", () => {
    assert.strictEqual(LANDING_LANGUAGE_TILES.length, LANGUAGE_TILES.length);
    assert.strictEqual(LANDING_EXAMPLE_TILES.length, EXAMPLE_TEMPLATES.length);

    const html = renderLandingPageHtml();
    assert.ok(html.includes("#memfs:empty"), "Landing page must include empty workspace hero tile");
    assert.ok(html.includes("level-1-view"), "Landing page must include Level 1 language grid view");
    assert.ok(html.includes("level-2-view"), "Landing page must include Level 2 example workspace view");
    assert.ok(html.includes("--ms-bg-canvas"), "Landing page must use docs design tokens");
    assert.ok(html.includes("Space Grotesk"), "Landing page must use docs typography");
    assert.ok(html.includes("tone-teal"), "Landing page must use docs tone classes");
  });
});

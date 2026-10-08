// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { formatPageTitle } from "../src/util/title.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Title & SEO Infrastructure", () => {
  it("formats page titles correctly with brand suffix", () => {
    assert.equal(formatPageTitle("Dashboard"), "Dashboard | ModelScript");
    assert.equal(formatPageTitle("Explore"), "Explore | ModelScript");
    assert.equal(formatPageTitle(""), "ModelScript");
    assert.equal(formatPageTitle(undefined), "ModelScript");
  });

  it("verifies public/robots.txt contains correct crawl rules and sitemap reference", () => {
    const robotsPath = path.resolve(__dirname, "../public/robots.txt");
    assert.ok(fs.existsSync(robotsPath), "robots.txt must exist in public directory");
    const content = fs.readFileSync(robotsPath, "utf-8");
    assert.ok(content.includes("User-agent: *"), "Must specify wildcard user agent");
    assert.ok(content.includes("Sitemap:"), "Must reference sitemap");
  });

  it("verifies public/sitemap.xml contains valid XML and core routes", () => {
    const sitemapPath = path.resolve(__dirname, "../public/sitemap.xml");
    assert.ok(fs.existsSync(sitemapPath), "sitemap.xml must exist in public directory");
    const content = fs.readFileSync(sitemapPath, "utf-8");
    assert.ok(content.includes('<?xml version="1.0" encoding="UTF-8"?>'), "Must have XML declaration");
    assert.ok(content.includes("<urlset"), "Must have urlset root");
    assert.ok(content.includes("/explore"), "Must list explore route");
  });
});

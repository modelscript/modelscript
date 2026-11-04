// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Sidebar Navigation Structure & Workbench Placement", () => {
  const sidebarPath = path.resolve(import.meta.dirname, "../src/components/Sidebar.tsx");
  const content = fs.readFileSync(sidebarPath, "utf-8");

  it("removes Documentation link from left side navigation", () => {
    assert.ok(
      !content.includes('label: "Documentation"'),
      "Sidebar.tsx must not contain a Documentation navigation link",
    );
    assert.ok(
      !content.includes("docsHref"),
      "Sidebar.tsx must not declare docsHref since documentation is removed from sidebar",
    );
  });

  it("moves IDE link up to a proper nav link below packages titled 'Studio'", () => {
    assert.ok(
      content.includes('registryLinks.push({ to: "/ide", icon: CodeIcon, label: "Studio" });'),
      "Sidebar.tsx must push Studio nav link to registryLinks",
    );

    const packagesIndex = content.indexOf('registryLinks.push({ to: "/packages"');
    const studioIndex = content.indexOf('registryLinks.push({ to: "/ide", icon: CodeIcon, label: "Studio" });');
    const reposIndex = content.indexOf('registryLinks.push({ to: "/repos"');

    assert.ok(packagesIndex !== -1, "Packages link must exist in registryLinks");
    assert.ok(studioIndex !== -1, "Studio link must exist in registryLinks");
    assert.ok(packagesIndex < studioIndex, "Studio link must be placed below Packages");
    assert.ok(studioIndex < reposIndex, "Studio link must be placed above Repositories");
  });

  it("moves Playground link up as a right-aligned icon link next to the Ansatz brand", () => {
    assert.ok(
      content.includes("<BrandRow>"),
      "Sidebar.tsx must render BrandRow container wrapping brand and playground icon link",
    );
    assert.ok(content.includes("<BrandPlaygroundLink"), "Sidebar.tsx must render BrandPlaygroundLink");
    assert.ok(content.includes('to="/playground"'), "BrandPlaygroundLink must point to /playground");
    assert.ok(
      content.includes("ComposeIcon") && content.includes("<ComposeIcon"),
      "BrandPlaygroundLink must render Octicon ComposeIcon",
    );
    assert.ok(
      content.includes('target="_blank"'),
      "BrandPlaygroundLink must open in a new window with target='_blank'",
    );
    assert.ok(
      content.includes('rel="noopener noreferrer"'),
      "BrandPlaygroundLink must specify rel='noopener noreferrer' for security",
    );
  });

  it("removes horizontal rule above guest sign in buttons", () => {
    assert.ok(
      content.includes("<FooterSection $isGuest={!user}>"),
      "Sidebar.tsx must pass $isGuest={!user} to FooterSection",
    );
    assert.ok(
      content.includes('border-top: ${(props) => (props.$isGuest ? "none" : "1px solid var(--color-border)")}'),
      "FooterSection must not render a top border when $isGuest is true",
    );
  });
});

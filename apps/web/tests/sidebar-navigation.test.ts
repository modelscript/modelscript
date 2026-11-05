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

  it("moves IDE link up to a proper nav link below packages titled 'Studio' pointing to /studio", () => {
    assert.ok(
      content.includes('registryLinks.push({ to: "/studio", icon: CodeIcon, label: "Studio" });'),
      "Sidebar.tsx must push Studio nav link to registryLinks pointing to /studio",
    );

    const packagesIndex = content.indexOf('registryLinks.push({ to: "/packages"');
    const studioIndex = content.indexOf('registryLinks.push({ to: "/studio", icon: CodeIcon, label: "Studio" });');
    const reposIndex = content.indexOf('registryLinks.push({ to: "/repos"');

    assert.ok(packagesIndex !== -1, "Packages link must exist in registryLinks");
    assert.ok(studioIndex !== -1, "Studio link must exist in registryLinks");
    assert.ok(packagesIndex < studioIndex, "Studio link must be placed below Packages");
    assert.ok(studioIndex < reposIndex, "Studio link must be placed above Repositories");
  });

  it("removes redundant top-left sketch icon in favor of the split Post | Sketch button and makes BrandHeader full width", () => {
    assert.ok(content.includes("<BrandRow>"), "Sidebar.tsx must render BrandRow container wrapping brand");
    assert.ok(
      !content.includes("<BrandSketchLink") && !content.includes("<BrandPlaygroundLink"),
      "Sidebar.tsx must not render redundant BrandSketchLink in brand header",
    );
    assert.ok(
      content.includes("<SplitPostButtonContainer") && content.includes("<SplitSketchButtonLink"),
      "Sidebar.tsx must provide Sketch action via split button",
    );
    assert.ok(
      content.includes("const BrandHeader = styled(Link)`") && content.includes("width: 100%"),
      "Sidebar.tsx BrandHeader must span full width for hover and click states",
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

  it("converts big blue post button into a split button for Post | Sketch", () => {
    assert.ok(
      content.includes("<SplitPostButtonContainer") && content.includes("post-split-btn-group"),
      "Sidebar.tsx must render SplitPostButtonContainer with class post-split-btn-group",
    );
    assert.ok(
      content.includes('data-testid="sidebar-split-post-button"'),
      "Sidebar.tsx must provide data-testid='sidebar-split-post-button' on the split button container",
    );
    assert.ok(
      content.includes('data-testid="sidebar-post-button"'),
      "Sidebar.tsx must provide data-testid='sidebar-post-button' for the Post action",
    );
    assert.ok(
      content.includes('data-testid="sidebar-sketch-button"'),
      "Sidebar.tsx must provide data-testid='sidebar-sketch-button' for the Sketch action",
    );
    assert.ok(
      content.includes("<SplitPostButtonDivider") && content.includes("post-split-divider"),
      "Sidebar.tsx must render SplitPostButtonDivider separating Post and Sketch",
    );
    assert.ok(content.includes("onClick={onPostClick}"), "Sidebar.tsx Post button must invoke onPostClick");
    assert.ok(content.includes('to="/sketch"'), "Sidebar.tsx Sketch button must point to /sketch");
    assert.ok(content.includes("AnsatzSketchIcon"), "Sidebar.tsx Sketch button must render AnsatzSketchIcon");
    assert.ok(content.includes("PlusIcon"), "Sidebar.tsx Post button must render PlusIcon");
    assert.ok(
      content.includes("onSketchClick?: (() => void) | undefined"),
      "SidebarProps must accept optional onSketchClick handler",
    );
  });

  it("renders a prominent full-width green Sketch button when logged out without split or post button", () => {
    assert.ok(
      content.includes("<GuestSketchButtonLink"),
      "Sidebar.tsx must render GuestSketchButtonLink for logged-out visitors",
    );
    assert.ok(
      content.includes('data-testid="sidebar-guest-sketch-button"'),
      "Sidebar.tsx must provide data-testid='sidebar-guest-sketch-button' for the logged-out Sketch action",
    );
    assert.ok(
      content.includes("background: var(--ms-brand)"),
      "GuestSketchButtonLink must use brand background matching the logged-in button",
    );
  });
});

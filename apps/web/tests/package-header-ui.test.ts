// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Package Header World-Class UI/UX Suite", () => {
  const headerPath = path.resolve(import.meta.dirname, "../src/pages/package/components/PackageHeader.tsx");
  const headerSrc = fs.readFileSync(headerPath, "utf-8");

  const detailPath = path.resolve(import.meta.dirname, "../src/pages/PackageDetailPage.tsx");
  const detailSrc = fs.readFileSync(detailPath, "utf-8");

  describe("1. Visual Hierarchy & Vertical Footprint", () => {
    it("adopts compact 52px HeroIconCard instead of bloated 100px block", () => {
      assert.ok(headerSrc.includes("width: 52px"), "HeroIconCard must be sized at 52px width");
      assert.ok(headerSrc.includes("height: 52px"), "HeroIconCard must be sized at 52px height");
      assert.ok(
        !headerSrc.includes("width: 100px;\n  height: 100px;"),
        "HeroIconCard must not use bloated 100px dimensions",
      );
    });

    it("renders TopStrip with navigation on left and ActionToolbar on right", () => {
      assert.ok(headerSrc.includes("<TopStrip>"), "PackageHeader must render TopStrip");
      assert.ok(headerSrc.includes("<NavLeft>"), "TopStrip must contain NavLeft");
      assert.ok(headerSrc.includes("<ActionToolbar>"), "TopStrip must contain ActionToolbar");
    });

    it("separates scoped packages into ScopePart and NamePart for world-class typography", () => {
      assert.ok(headerSrc.includes("ScopePart"), "PackageHeader must style ScopePart with muted hierarchy");
      assert.ok(headerSrc.includes("ScopeSlash"), "PackageHeader must render ScopeSlash separator");
      assert.ok(headerSrc.includes("NamePart"), "PackageHeader must render NamePart in bold");
    });
  });

  describe("2. Consolidated 32px Action Toolbar", () => {
    it("renders Open in Studio as primary CTA with CodeIcon", () => {
      assert.ok(headerSrc.includes("<OpenIdeButton"), "Must render OpenIdeButton");
      assert.ok(headerSrc.includes("Open in Studio"), "Must render 'Open in Studio' label");
      assert.ok(headerSrc.includes("<CodeIcon size={14} />"), "Must include CodeIcon in OpenIdeButton");
    });

    it("renders Source (.zip) and Cite secondary actions with matching 32px height", () => {
      assert.ok(headerSrc.includes("Source (.zip)"), "Must render Source (.zip) download link");
      assert.ok(headerSrc.includes("<CiteButton"), "Must render CiteButton");
      assert.ok(headerSrc.includes('variant="button"'), "CiteButton must use button variant");
    });

    it("unifies Manage dropdown and Logs button in the action toolbar", () => {
      assert.ok(headerSrc.includes("leadingVisual={GearIcon}"), "Manage button must use GearIcon");
      assert.ok(headerSrc.includes("leadingVisual={TerminalIcon}"), "Logs button must use TerminalIcon");
    });
  });

  describe("3. Quick Install & Metadata Utility Strip", () => {
    it("renders sleek 30px terminal install pill with prompt and mode switcher", () => {
      assert.ok(headerSrc.includes("height: 30px"), "InstallPill must be compact 30px height");
      assert.ok(headerSrc.includes("<InstallModeToggle>"), "Must include InstallModeToggle");
      assert.ok(headerSrc.includes("<InstallCode"), "Must include InstallCode");
      assert.ok(headerSrc.includes("Copied"), "Must provide visual 'Copied' indicator on copy");
    });

    it("formats metadata with dot separators and license chip", () => {
      assert.ok(headerSrc.includes("LicenseChip"), "Must render license in a dedicated styled chip");
      assert.ok(headerSrc.includes("dot-sep"), "Must separate metadata items with subtle dot separators");
    });
  });

  describe("4. Grid Alignment & Skeleton Parity", () => {
    it("aligns AlertsContainer to the page 24px grid", () => {
      assert.ok(headerSrc.includes("<AlertsContainer>"), "PackageHeader must wrap alerts in AlertsContainer");
      assert.ok(headerSrc.includes("padding: 8px 24px 0"), "AlertsContainer must use 24px horizontal padding");
    });

    it("updates PackageDetailSkeleton to match 52px icon and TopStrip layout", () => {
      assert.ok(detailSrc.includes('width: "52px", height: "52px"'), "Skeleton must mirror 52px icon size");
      assert.ok(detailSrc.includes("Top Strip Skeleton"), "Skeleton must include Top Strip skeleton");
    });
  });
});

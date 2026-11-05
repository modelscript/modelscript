// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { compareSemver, resolveLatestVersion, sortVersionsDescending } from "../src/util/semver";

test("Package Version Resolution & Dropdown Sorting", async (t) => {
  await t.test("compareSemver orders semantic versions accurately", () => {
    // 4.1.0 vs 3.2.3
    assert.ok(compareSemver("4.1.0", "3.2.3") > 0, "4.1.0 must be greater than 3.2.3");
    assert.ok(compareSemver("3.2.3", "4.1.0") < 0, "3.2.3 must be less than 4.1.0");

    // 4.1.0 vs 4.0.0
    assert.ok(compareSemver("4.1.0", "4.0.0") > 0, "4.1.0 must be greater than 4.0.0");
    assert.ok(compareSemver("4.0.0", "4.1.0") < 0, "4.0.0 must be less than 4.1.0");

    // Prefix 'v' handling
    assert.ok(compareSemver("v4.1.0", "v3.2.3") > 0, "v4.1.0 must be greater than v3.2.3");
    assert.equal(compareSemver("v4.1.0", "4.1.0"), 0, "v4.1.0 must equal 4.1.0");

    // Prerelease comparison: final release is higher than rc
    assert.ok(compareSemver("4.1.0", "4.1.0-rc.1") > 0, "4.1.0 must be greater than 4.1.0-rc.1");
    assert.ok(compareSemver("4.1.0-rc.2", "4.1.0-rc.1") > 0, "rc.2 must be greater than rc.1");

    // CalVer or irregular versions
    assert.ok(compareSemver("2026.3.0", "1.0.0") > 0, "2026.3.0 must be greater than 1.0.0");
  });

  await t.test("sortVersionsDescending sorts release versions newest first", () => {
    const unsorted = ["3.2.3", "4.0.0", "4.1.0"];
    const sorted = sortVersionsDescending(unsorted);
    assert.deepEqual(
      sorted,
      ["4.1.0", "4.0.0", "3.2.3"],
      "sortVersionsDescending must order versions 4.1.0, 4.0.0, 3.2.3",
    );

    const unsortedWithV = ["v3.2.3", "v4.1.0", "v4.0.0"];
    const sortedWithV = sortVersionsDescending(unsortedWithV);
    assert.deepEqual(
      sortedWithV,
      ["v4.1.0", "v4.0.0", "v3.2.3"],
      "sortVersionsDescending must preserve v-prefix and order correctly",
    );
  });

  await t.test("resolveLatestVersion respects dist-tags or falls back to highest semver", () => {
    // When dist-tags is set
    assert.equal(resolveLatestVersion(["3.2.3", "4.0.0", "4.1.0"], "4.1.0"), "4.1.0");

    // When dist-tags is absent or not in list, defaults to highest semver (4.1.0, NOT 3.2.3)
    assert.equal(resolveLatestVersion(["3.2.3", "4.0.0", "4.1.0"]), "4.1.0");
    assert.equal(resolveLatestVersion(["3.2.3", "4.0.0"]), "4.0.0");
    assert.equal(resolveLatestVersion(["4.0.0", "3.2.3"]), "4.0.0");
  });

  await t.test("PackageHeader wiring uses latestVersion and effectiveLatest for badges", () => {
    const headerSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/pages/package/components/PackageHeader.tsx"),
      "utf-8",
    );

    // Verify PackageHeader accepts latestVersion prop
    assert.ok(
      headerSrc.includes("latestVersion?: string | null | undefined;"),
      "PackageHeaderProps must declare latestVersion",
    );
    assert.ok(
      headerSrc.includes(
        "const effectiveLatest = latestVersion || (versionList && versionList.length > 0 ? versionList[0] : null);",
      ),
      "PackageHeader must compute effectiveLatest taking latestVersion into account",
    );
    assert.ok(
      headerSrc.includes("const isLatestVersion = Boolean(effectiveLatest && effectiveLatest === version);"),
      "PackageHeader must determine isLatestVersion using effectiveLatest instead of hardcoded versionList[0]",
    );
    assert.ok(
      headerSrc.includes("{v === effectiveLatest && ("),
      "ActionList.Item trailing 'latest' label must check v === effectiveLatest",
    );
    assert.ok(
      !headerSrc.includes("{v === versionList[0] && ("),
      "ActionList.Item must not blindly assume versionList[0] is latest",
    );
  });

  await t.test("usePackageData orders versions by semver descending and computes latestVersion", () => {
    const hookSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/pages/package/hooks/usePackageData.ts"),
      "utf-8",
    );

    assert.ok(hookSrc.includes("sortVersionsDescending"), "usePackageData must import and use sortVersionsDescending");
    assert.ok(
      hookSrc.includes("const versionList = useMemo(() => {"),
      "usePackageData must compute versionList with useMemo",
    );
    assert.ok(
      hookSrc.includes("const latestVersion = useMemo(() => {"),
      "usePackageData must compute latestVersion with useMemo",
    );
    assert.ok(hookSrc.includes("latestVersion,"), "usePackageData must return latestVersion in its result object");
  });

  await t.test("PackageDetailPage passes latestVersion to PackageHeader", () => {
    const detailSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/pages/PackageDetailPage.tsx"), "utf-8");

    assert.ok(
      detailSrc.includes("latestVersion={pkg.latestVersion}"),
      "PackageDetailPage must pass latestVersion={pkg.latestVersion} to PackageHeader",
    );
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Compare two version strings according to Semantic Versioning (SemVer 2.0.0).
 * Returns:
 *   - positive number if a > b
 *   - negative number if a < b
 *   - 0 if a === b
 */
export function compareSemver(a: string, b: string): number {
  if (a === b) return 0;

  const cleanA = (a || "").trim().replace(/^[vV]/, "");
  const cleanB = (b || "").trim().replace(/^[vV]/, "");

  // Match: major.minor.patch[-prerelease][+build]
  const semverRegex = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;
  const matchA = cleanA.match(semverRegex);
  const matchB = cleanB.match(semverRegex);

  if (matchA && matchB) {
    const majA = parseInt(matchA[1] || "0", 10);
    const majB = parseInt(matchB[1] || "0", 10);
    if (majA !== majB) return majA - majB;

    const minA = parseInt(matchA[2] || "0", 10);
    const minB = parseInt(matchB[2] || "0", 10);
    if (minA !== minB) return minA - minB;

    const patchA = parseInt(matchA[3] || "0", 10);
    const patchB = parseInt(matchB[3] || "0", 10);
    if (patchA !== patchB) return patchA - patchB;

    const preA = matchA[4];
    const preB = matchB[4];

    // Semver spec: 1.0.0 (no prerelease) > 1.0.0-alpha (prerelease)
    if (!preA && preB) return 1;
    if (preA && !preB) return -1;
    if (preA && preB) {
      return preA.localeCompare(preB, undefined, { numeric: true });
    }
    return 0;
  }

  // Fallback natural alphanumeric comparison for date-based or irregular versions
  return cleanA.localeCompare(cleanB, undefined, { numeric: true });
}

/**
 * Sort an array of version strings descending (highest semantic version first).
 */
export function sortVersionsDescending(versions: string[]): string[] {
  return [...versions].sort((a, b) => compareSemver(b, a));
}

/**
 * Resolve the latest version from a version list and optional dist-tags latest tag.
 */
export function resolveLatestVersion(versionList: string[], distTagLatest?: string | null | undefined): string {
  if (distTagLatest && versionList.includes(distTagLatest)) {
    return distTagLatest;
  }
  const sorted = sortVersionsDescending(versionList);
  return sorted[0] || "";
}

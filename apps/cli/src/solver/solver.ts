// SPDX-License-Identifier: AGPL-3.0-or-later

import semver from "semver";

export interface PackageReleaseMetadata {
  version: string;
  isYanked?: boolean | undefined;
  yankReason?: string | null | undefined;
  isDeprecated?: boolean | undefined;
  deprecationReason?: string | null | undefined;
}

export interface PackageManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string> | undefined;
  peerDependencies?: Record<string, string> | undefined;
  isYanked?: boolean | undefined;
  yankReason?: string | null | undefined;
  isDeprecated?: boolean | undefined;
  deprecationReason?: string | null | undefined;
}

export interface DependencyRequirement {
  name: string;
  range: string;
  source?: string | undefined; // e.g. "package.json", "package.mo uses(...)"
}

export interface PackageVersionProvider {
  getVersions(packageName: string): Promise<string[]>;
  getManifest(packageName: string, version: string): Promise<PackageManifest | null>;
  getReleases?(packageName: string): Promise<PackageReleaseMetadata[]>;
}

export interface ResolutionResult {
  success: boolean;
  packages: Record<
    string,
    {
      version: string;
      dependencies: Record<string, string>;
    }
  >;
  order: string[]; // Topological installation order
  deprecated?: Record<string, { version: string; reason: string }> | undefined;
  yanked?: Record<string, { version: string; reason: string }> | undefined;
  error?: string | undefined;
}

export interface SolveOptions {
  allowYanked?: boolean | undefined;
}

/**
 * Deterministic PubGrub / backtracking SemVer solver for ModelScript packages.
 * Resolves diamond dependencies across polyglot project manifests (`package.json`)
 * and Modelica `package.mo` `annotation(uses(...))` directives.
 */
export class DependencySolver {
  readonly #provider: PackageVersionProvider;
  readonly #packumentCache = new Map<string, string[]>();
  readonly #manifestCache = new Map<string, PackageManifest | null>();
  readonly #releasesCache = new Map<string, PackageReleaseMetadata[]>();

  constructor(provider: PackageVersionProvider) {
    this.#provider = provider;
  }

  /**
   * Normalizes Modelica `uses(Lib(version="4.0.0"))` requirement string to semver range.
   */
  static normalizeModelicaVersion(reqVer: string): string {
    const trimmed = reqVer.trim();
    if (semver.valid(trimmed)) {
      // In Modelica semantics, uses(Modelica(version="4.0.0")) means compatible with 4.x
      const major = semver.major(trimmed);
      return major === 0 ? `^${trimmed}` : `^${trimmed}`;
    }
    if (semver.validRange(trimmed)) {
      return trimmed;
    }
    return `^${trimmed}`;
  }

  /**
   * Solve all transitive dependencies starting from the root requirements.
   */
  async solve(rootRequirements: DependencyRequirement[], options?: SolveOptions): Promise<ResolutionResult> {
    const selected = new Map<string, string>(); // pkg -> chosen version
    // Track dependencies introduced by each selected package version: sourcePkg -> Map<depPkg, depRange>
    const outgoingDeps = new Map<string, Map<string, string>>();

    // Initial root requirements
    const rootConstraints = new Map<string, { range: string; source: string }[]>();
    for (const req of rootRequirements) {
      if (!rootConstraints.has(req.name)) {
        rootConstraints.set(req.name, []);
      }
      rootConstraints.get(req.name)!.push({ range: req.range, source: req.source || "root" });
    }

    const queue: string[] = rootRequirements.map((r) => r.name);
    const MAX_ITERATIONS = 1000;
    let iterations = 0;

    while (queue.length > 0) {
      iterations++;
      if (iterations > MAX_ITERATIONS) {
        return {
          success: false,
          packages: {},
          order: [],
          error: "Dependency resolution exceeded maximum iteration limit (circular dependency or infinite loop).",
        };
      }

      const pkgName = queue.shift()!;

      // Gather all active constraints on pkgName from root + currently selected packages
      const activeConstraints: { range: string; source: string }[] = [];
      const rootList = rootConstraints.get(pkgName);
      if (rootList) {
        activeConstraints.push(...rootList);
      }

      for (const [sourcePkg, depMap] of outgoingDeps.entries()) {
        const depRange = depMap.get(pkgName);
        if (depRange) {
          const sourceVer = selected.get(sourcePkg);
          activeConstraints.push({
            range: depRange,
            source: sourceVer ? `${sourcePkg}@${sourceVer}` : sourcePkg,
          });
        }
      }

      // If no constraints exist on this package anymore (e.g. its parent was removed), deselect it
      if (activeConstraints.length === 0) {
        selected.delete(pkgName);
        outgoingDeps.delete(pkgName);
        continue;
      }

      const candidateVersions = await this.#fetchSortedVersions(pkgName);
      if (candidateVersions.length === 0) {
        return {
          success: false,
          packages: {},
          order: [],
          error: `Could not find any published versions for package '${pkgName}'.`,
        };
      }

      // Filter versions satisfying ALL active constraints for this package
      let matchingVersions = candidateVersions.filter((v) =>
        activeConstraints.every((req) => semver.satisfies(v, req.range || "*", { loose: true })),
      );

      // Yanked filtering: exclude yanked candidate versions unless explicitly pinned or allowed
      if (!options?.allowYanked && this.#provider.getReleases) {
        const releases = await this.#fetchReleases(pkgName);
        const yankedSet = new Set(releases.filter((r) => r.isYanked).map((r) => r.version));
        if (yankedSet.size > 0) {
          matchingVersions = matchingVersions.filter((v) => {
            if (!yankedSet.has(v)) return true;
            // Allow yanked version only if explicitly pinned by an exact constraint (e.g. "1.0.0" or "=1.0.0")
            return activeConstraints.some((c) => {
              const trimmed = c.range.trim();
              const cleaned = semver.clean(trimmed);
              return semver.valid(trimmed) === v || cleaned === v;
            });
          });
        }
      }

      if (matchingVersions.length === 0) {
        const conflictReasons = activeConstraints.map((r) => `requires '${r.range}' (from ${r.source})`).join(" but ");
        return {
          success: false,
          packages: {},
          order: [],
          error: `Version conflict for '${pkgName}': ${conflictReasons}. Available versions: ${candidateVersions.slice(0, 5).join(", ")}${candidateVersions.length > 5 ? "..." : ""}.`,
        };
      }

      // Highest compatible version
      const chosenVersion = matchingVersions[0]!;
      const previousVersion = selected.get(pkgName);

      if (previousVersion !== chosenVersion) {
        selected.set(pkgName, chosenVersion);

        // Fetch manifest and update outgoing dependencies
        const manifest = await this.#fetchManifest(pkgName, chosenVersion);
        const newDepMap = new Map<string, string>();

        if (manifest && manifest.dependencies) {
          for (const [depName, depRange] of Object.entries(manifest.dependencies)) {
            newDepMap.set(depName, depRange);
            if (!queue.includes(depName)) {
              queue.push(depName);
            }
          }
        }

        // Check if any old dependencies were removed or changed
        const oldDepMap = outgoingDeps.get(pkgName);
        outgoingDeps.set(pkgName, newDepMap);

        if (oldDepMap) {
          for (const oldDepName of oldDepMap.keys()) {
            if (!newDepMap.has(oldDepName) && !queue.includes(oldDepName)) {
              queue.push(oldDepName);
            }
          }
        }
      }
    }

    // Build DAG and topological order
    const packageMap: Record<string, { version: string; dependencies: Record<string, string> }> = {};
    for (const [pkg, ver] of selected.entries()) {
      const manifest = await this.#fetchManifest(pkg, ver);
      packageMap[pkg] = {
        version: ver,
        dependencies: manifest?.dependencies || {},
      };
    }

    const deprecatedMap: Record<string, { version: string; reason: string }> = {};
    const yankedMap: Record<string, { version: string; reason: string }> = {};

    for (const [pkg, ver] of selected.entries()) {
      const manifest = await this.#fetchManifest(pkg, ver);
      const releases = await this.#fetchReleases(pkg);
      const rel = releases.find((r) => r.version === ver);
      const isDep = Boolean(manifest?.isDeprecated || rel?.isDeprecated);
      const isYk = Boolean(manifest?.isYanked || rel?.isYanked);
      if (isDep) {
        deprecatedMap[pkg] = {
          version: ver,
          reason:
            manifest?.deprecationReason || rel?.deprecationReason || "This version has been deprecated by the author.",
        };
      }
      if (isYk) {
        yankedMap[pkg] = {
          version: ver,
          reason: manifest?.yankReason || rel?.yankReason || "This release has been yanked by the maintainer.",
        };
      }
    }

    const topologicalOrder = this.#computeTopologicalOrder(packageMap);

    return {
      success: true,
      packages: packageMap,
      order: topologicalOrder,
      ...(Object.keys(deprecatedMap).length > 0 ? { deprecated: deprecatedMap } : {}),
      ...(Object.keys(yankedMap).length > 0 ? { yanked: yankedMap } : {}),
    };
  }

  async #fetchReleases(pkgName: string): Promise<PackageReleaseMetadata[]> {
    if (this.#releasesCache.has(pkgName)) {
      return this.#releasesCache.get(pkgName)!;
    }
    const releases = this.#provider.getReleases ? await this.#provider.getReleases(pkgName) : [];
    this.#releasesCache.set(pkgName, releases);
    return releases;
  }

  async #fetchSortedVersions(pkgName: string): Promise<string[]> {
    if (this.#packumentCache.has(pkgName)) {
      return this.#packumentCache.get(pkgName)!;
    }
    const versions = await this.#provider.getVersions(pkgName);
    const sorted = versions.filter((v) => semver.valid(v) !== null).sort((a, b) => semver.rcompare(a, b));
    this.#packumentCache.set(pkgName, sorted);
    return sorted;
  }

  async #fetchManifest(pkgName: string, version: string): Promise<PackageManifest | null> {
    const key = `${pkgName}@${version}`;
    if (this.#manifestCache.has(key)) {
      return this.#manifestCache.get(key)!;
    }
    const manifest = await this.#provider.getManifest(pkgName, version);
    this.#manifestCache.set(key, manifest);
    return manifest;
  }

  #computeTopologicalOrder(
    packageMap: Record<string, { version: string; dependencies: Record<string, string> }>,
  ): string[] {
    const order: string[] = [];
    const visited = new Set<string>();
    const temp = new Set<string>();

    const visit = (node: string) => {
      if (temp.has(node)) return; // Break circular cycles cleanly
      if (visited.has(node)) return;

      temp.add(node);
      const deps = packageMap[node]?.dependencies || {};
      for (const dep of Object.keys(deps)) {
        if (packageMap[dep]) {
          visit(dep);
        }
      }
      temp.delete(node);
      visited.add(node);
      order.push(node);
    };

    for (const pkg of Object.keys(packageMap)) {
      if (!visited.has(pkg)) {
        visit(pkg);
      }
    }

    return order;
  }
}

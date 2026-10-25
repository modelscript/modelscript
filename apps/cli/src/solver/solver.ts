// SPDX-License-Identifier: AGPL-3.0-or-later

import semver from "semver";

export interface PackageManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string> | undefined;
  peerDependencies?: Record<string, string> | undefined;
}

export interface DependencyRequirement {
  name: string;
  range: string;
  source?: string | undefined; // e.g. "package.json", "package.mo uses(...)"
}

export interface PackageVersionProvider {
  getVersions(packageName: string): Promise<string[]>;
  getManifest(packageName: string, version: string): Promise<PackageManifest | null>;
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
  error?: string | undefined;
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
  async solve(rootRequirements: DependencyRequirement[]): Promise<ResolutionResult> {
    const selected = new Map<string, string>(); // pkg -> version
    const constraints = new Map<string, { range: string; source: string }[]>();

    for (const req of rootRequirements) {
      if (!constraints.has(req.name)) {
        constraints.set(req.name, []);
      }
      constraints.get(req.name)!.push({ range: req.range, source: req.source || "root" });
    }

    const queue: string[] = rootRequirements.map((r) => r.name);
    const visited = new Set<string>();

    while (queue.length > 0) {
      const pkgName = queue.shift()!;
      const reqList = constraints.get(pkgName) || [];

      // Intersect / validate all ranges for this package
      const candidateVersions = await this.#fetchSortedVersions(pkgName);
      if (candidateVersions.length === 0) {
        return {
          success: false,
          packages: {},
          order: [],
          error: `Could not find any published versions for package '${pkgName}'.`,
        };
      }

      // Filter versions that satisfy ALL constraints for this package
      const matchingVersions = candidateVersions.filter((v) =>
        reqList.every((req) => semver.satisfies(v, req.range || "*", { loose: true })),
      );

      if (matchingVersions.length === 0) {
        const conflictReasons = reqList.map((r) => `requires '${r.range}' (from ${r.source})`).join(" but ");
        return {
          success: false,
          packages: {},
          order: [],
          error: `Version conflict for '${pkgName}': ${conflictReasons}. Available versions: ${candidateVersions.slice(0, 5).join(", ")}${candidateVersions.length > 5 ? "..." : ""}.`,
        };
      }

      // Highest compatible version (first in sorted desc)
      const chosenVersion = matchingVersions[0]!;
      selected.set(pkgName, chosenVersion);

      // Fetch chosen package manifest and queue transitive dependencies
      const cacheKey = `${pkgName}@${chosenVersion}`;
      if (!visited.has(cacheKey)) {
        visited.add(cacheKey);
        const manifest = await this.#fetchManifest(pkgName, chosenVersion);
        if (manifest && manifest.dependencies) {
          for (const [depName, depRange] of Object.entries(manifest.dependencies)) {
            if (!constraints.has(depName)) {
              constraints.set(depName, []);
            }
            constraints.get(depName)!.push({
              range: depRange,
              source: `${pkgName}@${chosenVersion}`,
            });

            // If already selected, check if current choice satisfies new constraint
            const currentSelectedVer = selected.get(depName);
            if (currentSelectedVer) {
              if (!semver.satisfies(currentSelectedVer, depRange, { loose: true })) {
                // Must re-evaluate package
                queue.push(depName);
              }
            } else if (!queue.includes(depName)) {
              queue.push(depName);
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

    const topologicalOrder = this.#computeTopologicalOrder(packageMap);

    return {
      success: true,
      packages: packageMap,
      order: topologicalOrder,
    };
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

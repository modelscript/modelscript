// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import semver from "semver";
import type {
  ClassMetadata,
  ClassRow,
  CollaboratorPermission,
  ComponentRow,
  ModifierRow,
  OrgRole,
  OrganizationMemberRecord,
  OrganizationRecord,
  PackageCollaboratorRecord,
  RegistryCatalogItem,
  RegistryCatalogQueryOptions,
  RegistryCatalogQueryResult,
} from "../../database.js";
import type { LibraryReleaseRow, PackageTransferRow, UserRow } from "../../database/types.js";
import { BaseRepository } from "./base.js";
export class LibraryRegistryRepository extends BaseRepository {
  #libraryDiscoveryBaseCache: {
    expiresAt: number;
    data: {
      packagesByName: Map<
        string,
        { id: number; name: string; description: string | null; license: string | null; modified_at: string }
      >;
      versionsByPackageId: Map<number, { id: number; version: string; manifest: string; published_at: string }[]>;
      versionByPkgAndVer: Map<string, { id: number; version: string; manifest: string; published_at: string }>;
      releasesByKey: Map<
        string,
        {
          published_at: string;
          published_by: number | null;
          is_deprecated: number;
          deprecation_reason: string | null;
          is_yanked: number;
          publisher_username: string | null;
        }
      >;
      downloadsByName: Map<string, { totalDownloads: number; downloads30d: number; downloads7d: number }>;
      classSummaryByKey: Map<string, { classCount: number; hasSysml: boolean }>;
      artifactsByVersionId: Map<number, { type: string; count: number }[]>;
      dependentsCountByName: Map<string, number>;
    };
  } | null = null;

  #registryCatalogCache: {
    expiresAt: number;
    components: RegistryCatalogItem[];
    models: RegistryCatalogItem[];
    dependenciesByPackage: Map<string, Record<string, string>>;
  } | null = null;

  invalidateDiscoveryCache(): void {
    this.#libraryDiscoveryBaseCache = null;
    this.#registryCatalogCache = null;
  }

  // ── Library metadata ────────────────────────────────────────────

  /**
   * Clear all metadata for a library version.
   */
  clearLibraryMetadata(libraryName: string, libraryVersion: string): void {
    this.db
      .prepare(`DELETE FROM classes WHERE library_name = ? AND library_version = ?`)
      .run(libraryName, libraryVersion);
    this.#registryCatalogCache = null;
  }

  /**
   * Store metadata for a single class. This should be run inside a transaction for performance.
   */
  storeClassMetadata(libraryName: string, libraryVersion: string, cls: ClassMetadata): void {
    this.#registryCatalogCache = null;
    const result = this.db
      .prepare(
        `INSERT OR REPLACE INTO classes (library_name, library_version, class_name, class_kind, description, documentation, icon_hash, diagram_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        libraryName,
        libraryVersion,
        cls.className,
        cls.classKind,
        cls.description,
        cls.documentation,
        cls.iconHash ?? null,
        cls.diagramHash ?? null,
      );

    const classId = result.lastInsertRowid;

    const insertExtends = this.db.prepare(`INSERT OR REPLACE INTO extends (class_id, base_class) VALUES (?, ?)`);
    for (const baseClass of cls.baseClasses) {
      insertExtends.run(classId, baseClass);
    }

    const insertComponent = this.db.prepare(
      `INSERT OR REPLACE INTO components (class_id, component_name, type_name, description, causality, variability)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertModifier = this.db.prepare(
      `INSERT OR REPLACE INTO modifiers (component_id, modifier_name, modifier_value) VALUES (?, ?, ?)`,
    );

    for (const comp of cls.components) {
      const compResult = insertComponent.run(
        classId,
        comp.name,
        comp.typeName,
        comp.description,
        comp.causality,
        comp.variability,
      );
      const componentId = compResult.lastInsertRowid;

      for (const mod of comp.modifiers) {
        insertModifier.run(componentId, mod.name, mod.value);
      }
    }
  }

  /**
   * Store all metadata for a library version inside a transaction.
   * WARNING: This clears all existing metadata for the version first.
   */
  storeLibraryMetadata(libraryName: string, libraryVersion: string, classes: ClassMetadata[]): void {
    const transaction = this.db.transaction(() => {
      this.clearLibraryMetadata(libraryName, libraryVersion);
      for (const cls of classes) {
        this.storeClassMetadata(libraryName, libraryVersion, cls);
      }
    });

    transaction();
    this.#registryCatalogCache = null;
  }

  /**
   * Store a batch of class metadata without clearing existing data.
   * Use this for incremental batch inserts during library processing.
   */
  storeClassBatch(libraryName: string, libraryVersion: string, classes: ClassMetadata[]): void {
    const transaction = this.db.transaction(() => {
      for (const cls of classes) {
        this.storeClassMetadata(libraryName, libraryVersion, cls);
      }
    });

    transaction();
    this.#registryCatalogCache = null;
  }

  /**
   * Query classes for a library version with optional filters.
   */
  getClasses(
    libraryName: string,
    libraryVersion: string,
    opts?: { kind?: string | undefined; q?: string | undefined },
  ): Omit<ClassRow, "id">[] {
    let sql = `SELECT class_name, class_kind, description, documentation, icon_hash, diagram_hash FROM classes
               WHERE library_name = ? AND library_version = ?`;
    const params: (string | number)[] = [libraryName, libraryVersion];

    if (opts?.kind) {
      sql += ` AND class_kind = ?`;
      params.push(opts.kind);
    }

    if (opts?.q) {
      sql += ` AND class_name LIKE ?`;
      params.push(`%${opts.q}%`);
    }

    sql += ` ORDER BY class_name`;

    return this.db.prepare(sql).all(...params) as Omit<ClassRow, "id">[];
  }

  #getRegistryCatalogIndex(): {
    components: RegistryCatalogItem[];
    models: RegistryCatalogItem[];
    dependenciesByPackage: Map<string, Record<string, string>>;
  } {
    const now = Date.now();
    if (this.#registryCatalogCache && this.#registryCatalogCache.expiresAt > now) {
      return this.#registryCatalogCache;
    }

    const distinctLibVersions = this.db
      .prepare(`SELECT library_name, library_version FROM classes GROUP BY library_name, library_version`)
      .all() as { library_name: string; library_version: string }[];

    const yankedRows = this.db
      .prepare(`SELECT library_name, library_version FROM library_releases WHERE is_yanked = 1`)
      .all() as { library_name: string; library_version: string }[];
    const yankedSet = new Set(yankedRows.map((r) => `${r.library_name}@${r.library_version}`));

    const distTagRows = this.db
      .prepare(
        `SELECT p.name AS library_name, dt.version AS latest_version
         FROM dist_tags dt
         JOIN packages p ON p.id = dt.package_id
         WHERE dt.tag = 'latest'`,
      )
      .all() as { library_name: string; latest_version: string }[];
    const distTagMap = new Map<string, string>();
    for (const dt of distTagRows) {
      distTagMap.set(dt.library_name, dt.latest_version);
    }

    const versionsByPkg = new Map<string, string[]>();
    for (const row of distinctLibVersions) {
      if (yankedSet.has(`${row.library_name}@${row.library_version}`)) continue;
      let list = versionsByPkg.get(row.library_name);
      if (!list) {
        list = [];
        versionsByPkg.set(row.library_name, list);
      }
      list.push(row.library_version);
    }

    const activePkgVersions: { libraryName: string; libraryVersion: string }[] = [];
    for (const [libName, versions] of versionsByPkg.entries()) {
      versions.sort((a, b) => {
        if (semver.valid(a) && semver.valid(b)) return semver.rcompare(a, b);
        return b.localeCompare(a);
      });
      const tagged = distTagMap.get(libName);
      const chosen = tagged && versions.includes(tagged) ? tagged : versions[0];
      if (chosen) {
        activePkgVersions.push({ libraryName: libName, libraryVersion: chosen });
      }
    }
    activePkgVersions.sort((a, b) => a.libraryName.localeCompare(b.libraryName));

    const dependenciesByPackage = new Map<string, Record<string, string>>();
    const manifestStmt = this.db.prepare(
      `SELECT pv.manifest
       FROM package_versions pv
       JOIN packages p ON p.id = pv.package_id
       WHERE p.name = ? AND pv.version = ?`,
    );

    const nonComponentKinds = new Set([
      "package",
      "function",
      "operator",
      "operator function",
      "type",
      "enumeration",
      "sysml_package",
      "sysml_requirement_def",
    ]);
    const nonModelKinds = new Set([
      "package",
      "connector",
      "expandable connector",
      "record",
      "operator record",
      "function",
      "operator",
      "operator function",
      "type",
      "enumeration",
      "sysml_package",
      "sysml_port_def",
      "sysml_item_def",
      "sysml_attribute_def",
      "sysml_requirement_def",
    ]);
    const primitiveSubpkgRe =
      /\.(?:Basic|Components|Sources|Sensors|Actuators|Parts|Joints|Movers|Fittings|HeatExchangers|Volumes|MixingVolumes|Interfaces|Icons|BaseClasses|Internal|Types|Choices|UsersGuide)\./;
    const excludedComponentSegmentRe =
      /\.(?:Examples|Icons|Interfaces|Internal|UsersGuide|BaseClasses|Types|Choices)(?:\.|$)/;

    const inferLanguage = (kindLower: string, libName: string): string => {
      if (kindLower.startsWith("sysml") || libName.toLowerCase().includes("sysml")) return "sysml2";
      if (kindLower.startsWith("pscad") || libName.toLowerCase().includes("pscad")) return "pscad";
      if (kindLower.startsWith("spice") || libName.toLowerCase().includes("spice")) return "spice";
      if (kindLower.startsWith("urdf") || libName.toLowerCase().includes("urdf")) return "urdf";
      if (kindLower.startsWith("step") || kindLower === "cad") return "step";
      if (kindLower.startsWith("scad")) return "scad";
      if (kindLower === "ampl_model" || kindLower === "nl_problem") return "ampl";
      if (kindLower === "gams_model") return "gams";
      if (kindLower === "cplex_lp") return "cplex-lp";
      return "modelica";
    };

    const inferDomain = (fqn: string, kindLower: string, libName: string): string => {
      const hay = `${libName} ${fqn} ${kindLower}`.toLowerCase();
      if (
        kindLower.startsWith("sysml") ||
        /\b(sysml|kerml|reqif|ssp|oscal|requirement|architecture|autosar|owl)\b/.test(hay)
      ) {
        return "systems";
      }
      if (
        kindLower.startsWith("step") ||
        kindLower.startsWith("scad") ||
        kindLower.startsWith("urdf") ||
        /\b(cad|step|scad|urdf|robot|fea|cfd|geometry|chassis|mesh|fastener)\b/.test(hay)
      ) {
        return "robotics-cad";
      }
      if (
        kindLower.startsWith("pscad") ||
        kindLower.startsWith("psse") ||
        /\b(pscad|psse|opendss|ieee|powergrid|power_grid|powersystems|transmission|substation|busbar)\b/.test(hay)
      ) {
        return "power-grids";
      }
      if (
        fqn.includes(".Electrical.") ||
        fqn.includes(".Magnetic.") ||
        /\b(electrical|magnetic|electronic|spice|semiconductor|inverter|battery|circuit|motor|drive)\b/.test(hay)
      ) {
        return "electrical";
      }
      if (
        fqn.includes(".Fluid.") ||
        fqn.includes(".Thermal.") ||
        /\b(fluid|thermal|heat|media|buildings|hvac|thermopower|aixlib|swmm|epanet|olga|relap5|pump|valve|pipe|boiler)\b/.test(
          hay,
        )
      ) {
        return "fluids-thermal";
      }
      if (
        fqn.includes(".Mechanics.") ||
        libName.toLowerCase().includes("mechanics") ||
        /\b(mechanic|rotational|translational|multibody|planar|joint|gear|spring|damper|pendulum|kinematic|adams|simpack)\b/.test(
          hay,
        )
      ) {
        return "mechanics";
      }
      if (
        fqn.includes(".Blocks.") ||
        fqn.includes(".Clocked.") ||
        fqn.includes(".StateGraph.") ||
        /\b(block|control|pid|clocked|stategraph|synchronous|signal|filter|transfer|sensor|source)\b/.test(hay)
      ) {
        return "control";
      }
      return "systems";
    };

    const components: RegistryCatalogItem[] = [];
    const models: RegistryCatalogItem[] = [];

    const selectClassesStmt = this.db.prepare(
      `SELECT class_name, class_kind, description, icon_hash, diagram_hash
       FROM classes
       WHERE library_name = ? AND library_version = ?
       ORDER BY class_name`,
    );

    for (const { libraryName, libraryVersion } of activePkgVersions) {
      const mRow = manifestStmt.get(libraryName, libraryVersion) as { manifest?: string | null } | undefined;
      if (mRow?.manifest) {
        try {
          const parsed = JSON.parse(mRow.manifest) as Record<string, unknown>;
          const msx =
            parsed["modelscript"] && typeof parsed["modelscript"] === "object"
              ? (parsed["modelscript"] as Record<string, unknown>)
              : undefined;
          const rawDeps = {
            ...(parsed["dependencies"] && typeof parsed["dependencies"] === "object"
              ? (parsed["dependencies"] as Record<string, unknown>)
              : {}),
            ...(msx?.["dependencies"] && typeof msx["dependencies"] === "object"
              ? (msx["dependencies"] as Record<string, unknown>)
              : {}),
          };
          const cleanDeps: Record<string, string> = {};
          for (const [depKey, depVal] of Object.entries(rawDeps)) {
            if (typeof depVal === "string" && depVal.trim().length > 0) {
              cleanDeps[depKey] = depVal.trim();
            }
          }
          if (Object.keys(cleanDeps).length > 0) {
            dependenciesByPackage.set(libraryName, cleanDeps);
          }
        } catch {
          // ignore invalid manifest JSON
        }
      }

      const rows = selectClassesStmt.all(libraryName, libraryVersion) as {
        class_name: string;
        class_kind: string;
        description: string | null;
        icon_hash: string | null;
        diagram_hash: string | null;
      }[];

      const parentPrefixes = new Set<string>();
      for (const r of rows) {
        const parts = r.class_name.split(".");
        for (let i = 1; i < parts.length; i++) {
          parentPrefixes.add(parts.slice(0, i).join("."));
        }
      }

      const barePkgName = libraryName.startsWith("@") ? (libraryName.split("/")[1] ?? libraryName) : libraryName;

      for (const r of rows) {
        const fqn = r.class_name;
        if (!fqn || fqn === libraryName || fqn === barePkgName || parentPrefixes.has(fqn)) {
          continue;
        }
        const parts = fqn.split(".");
        const shortName = parts[parts.length - 1] || fqn;
        if (shortName.startsWith("Partial")) {
          continue;
        }

        const kindLower = (r.class_kind || "class").toLowerCase();
        const language = inferLanguage(kindLower, libraryName);
        const domain = inferDomain(fqn, kindLower, libraryName);
        const subpackage = parts.length >= 3 ? parts.slice(1, Math.min(3, parts.length - 1)).join(".") : null;
        const hasIcon = Boolean(r.icon_hash);
        const hasDiagram = Boolean(r.diagram_hash);

        const isExcludedFromComponents =
          nonComponentKinds.has(kindLower) ||
          excludedComponentSegmentRe.test(fqn) ||
          fqn.startsWith("Modelica.Media.") ||
          fqn.startsWith("Modelica.Math.") ||
          fqn.startsWith("Modelica.Utilities.") ||
          fqn.startsWith("Modelica.Icons.") ||
          fqn.startsWith("Modelica.UsersGuide.") ||
          fqn === "Modelica.Constants";

        if (!isExcludedFromComponents) {
          components.push({
            fqn,
            name: shortName,
            kind: kindLower,
            domain,
            subpackage,
            packageName: libraryName,
            packageVersion: libraryVersion,
            description: r.description ?? null,
            language,
            hasIcon,
            hasDiagram,
          });
        }

        const isExampleOrValidation =
          fqn.includes(".Examples.") || fqn.includes(".Validation.") || fqn.includes(".Benchmarks.");
        const isInternalOrBase =
          /\.(?:Icons|Interfaces|Internal|UsersGuide|BaseClasses|Types|Choices)(?:\.|$)/.test(fqn) ||
          fqn.startsWith("Modelica.Media.") ||
          fqn.startsWith("Modelica.Math.") ||
          fqn.startsWith("Modelica.Utilities.");
        const isStandaloneCustomModel =
          libraryName !== "Modelica" && !primitiveSubpkgRe.test(fqn) && (parts.length <= 2 || hasDiagram);

        if (!nonModelKinds.has(kindLower) && !isInternalOrBase && (isExampleOrValidation || isStandaloneCustomModel)) {
          models.push({
            fqn,
            name: shortName,
            kind: kindLower,
            domain,
            subpackage,
            packageName: libraryName,
            packageVersion: libraryVersion,
            description: r.description ?? null,
            language,
            hasIcon,
            hasDiagram,
          });
        }
      }
    }

    this.#registryCatalogCache = {
      expiresAt: now + 30_000,
      components,
      models,
      dependenciesByPackage,
    };
    return this.#registryCatalogCache;
  }

  /**
   * Paginated cross-registry catalog query for streaming placeable schematic components
   * (`mode: "components"`) or runnable schematic models (`mode: "models"`).
   */
  queryRegistryCatalog(opts: RegistryCatalogQueryOptions): RegistryCatalogQueryResult {
    const index = this.#getRegistryCatalogIndex();
    const source = opts.mode === "models" ? index.models : index.components;

    const rawDom = opts.domain && opts.domain !== "all" ? opts.domain.trim().toLowerCase() : null;
    const domainFilter =
      rawDom === "controls"
        ? "control"
        : rawDom === "cad" || rawDom === "robotics"
          ? "robotics-cad"
          : rawDom === "power"
            ? "power-grids"
            : rawDom;
    const pkgFilter = opts.packageName && opts.packageName !== "all" ? opts.packageName.trim().toLowerCase() : null;
    const subpkgFilter = opts.subpackage && opts.subpackage !== "all" ? opts.subpackage.trim().toLowerCase() : null;
    const kindFilter = opts.kind && opts.kind !== "all" ? opts.kind.trim().toLowerCase() : null;
    const queryTokens = (opts.q ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    const queryJoined = queryTokens.join(" ");

    // Compute available packages (respecting domain + query, before package/subpackage narrowing)
    const pkgCounts = new Map<string, { name: string; version: string; count: number }>();
    // Compute available subpackages (respecting domain + package + query, before subpackage narrowing)
    const subpkgCounts = new Map<string, { id: string; label: string; count: number }>();

    const matched: { item: RegistryCatalogItem; score: number }[] = [];

    for (const item of source) {
      if (domainFilter && item.domain.toLowerCase() !== domainFilter) continue;
      if (kindFilter && item.kind !== kindFilter) continue;

      let queryScore = 0;
      if (queryTokens.length > 0) {
        const nameLower = item.name.toLowerCase();
        const fqnLower = item.fqn.toLowerCase();
        const pkgLower = item.packageName.toLowerCase();
        const descLower = (item.description ?? "").toLowerCase();
        const domLower = item.domain.toLowerCase();

        let allMatch = true;
        for (const tok of queryTokens) {
          if (
            !nameLower.includes(tok) &&
            !fqnLower.includes(tok) &&
            !pkgLower.includes(tok) &&
            !descLower.includes(tok) &&
            !domLower.includes(tok)
          ) {
            allMatch = false;
            break;
          }
        }
        if (!allMatch) continue;

        if (nameLower === queryJoined) queryScore += 500;
        else if (nameLower.startsWith(queryJoined)) queryScore += 260;
        else if (fqnLower === queryJoined) queryScore += 420;
        else if (fqnLower.includes(queryJoined)) queryScore += 120;
        else if (pkgLower === queryJoined) queryScore += 90;
      }

      const existingPkg = pkgCounts.get(item.packageName);
      if (existingPkg) {
        existingPkg.count += 1;
      } else {
        pkgCounts.set(item.packageName, {
          name: item.packageName,
          version: item.packageVersion,
          count: 1,
        });
      }

      if (pkgFilter && item.packageName.toLowerCase() !== pkgFilter) continue;

      if (item.subpackage) {
        const subKey = item.subpackage.toLowerCase();
        const existingSub = subpkgCounts.get(subKey);
        if (existingSub) {
          existingSub.count += 1;
        } else {
          subpkgCounts.set(subKey, {
            id: item.subpackage,
            label: item.subpackage.replace(/\./g, " › "),
            count: 1,
          });
        }
      }

      if (subpkgFilter) {
        const itemSub = (item.subpackage ?? "").toLowerCase();
        if (itemSub !== subpkgFilter && !itemSub.startsWith(`${subpkgFilter}.`)) {
          continue;
        }
      }

      let baseScore = queryScore;
      if (opts.mode === "models") {
        if (item.hasDiagram) baseScore += 60;
        if (item.fqn.includes(".Examples.")) baseScore += 40;
      } else {
        if (item.hasIcon) baseScore += 35;
      }
      matched.push({ item, score: baseScore });
    }

    matched.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.item.fqn.localeCompare(b.item.fqn);
    });

    const limit = Math.max(1, Math.min(200, Math.floor(opts.limit ?? 72)));
    const offset = Math.max(0, Math.floor(opts.offset ?? 0));
    const total = matched.length;
    const sliced = matched.slice(offset, offset + limit).map((m) => m.item);

    const packageDependencies: Record<string, Record<string, string>> = {};
    for (const entry of sliced) {
      const deps = index.dependenciesByPackage.get(entry.packageName);
      if (deps && !packageDependencies[entry.packageName]) {
        packageDependencies[entry.packageName] = deps;
      }
    }

    const availablePackages = Array.from(pkgCounts.values()).sort((a, b) => a.name.localeCompare(b.name));
    const availableSubpackages = Array.from(subpkgCounts.values())
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
      .slice(0, 24);

    return {
      total,
      offset,
      limit,
      hasMore: offset + sliced.length < total,
      items: sliced,
      availablePackages,
      availableSubpackages,
      packageDependencies,
    };
  }

  /**
   * Retrieve the boundary icon_hash map (className -> iconHash) for a library version.
   * Used for O(1) cross-library Merkle dependency hashing.
   */
  getClassIconHashes(libraryName: string, libraryVersion: string): Map<string, string> {
    const rows = this.db
      .prepare(
        `SELECT class_name, icon_hash FROM classes
         WHERE library_name = ? AND library_version = ? AND icon_hash IS NOT NULL`,
      )
      .all(libraryName, libraryVersion) as { class_name: string; icon_hash: string }[];
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.class_name, row.icon_hash);
    }
    return map;
  }

  /**
   * Find the closest already-indexed version of `libraryName` (excluding `excludeVersion`)
   * and return its full ClassMetadata + Merkle hashes keyed by className for incremental reuse.
   */
  getPreviousVersionClassHashes(
    libraryName: string,
    excludeVersion?: string,
  ): {
    version: string;
    classes: Map<string, ClassMetadata & { iconHash: string | null; diagramHash: string | null }>;
  } | null {
    const versionRows = this.db
      .prepare(
        `SELECT library_version, COUNT(*) AS cnt FROM classes
         WHERE library_name = ? AND (? IS NULL OR library_version != ?)
         GROUP BY library_version
         HAVING cnt > 0`,
      )
      .all(libraryName, excludeVersion ?? null, excludeVersion ?? null) as {
      library_version: string;
      cnt: number;
    }[];

    if (versionRows.length === 0) return null;

    versionRows.sort((a, b) => {
      const va = semver.valid(a.library_version);
      const vb = semver.valid(b.library_version);
      if (va && vb) return semver.rcompare(va, vb);
      return b.cnt - a.cnt;
    });

    const chosenVersion = versionRows[0]!.library_version;
    const allClasses = this.getAllClasses(libraryName, chosenVersion);
    const map = new Map<string, ClassMetadata & { iconHash: string | null; diagramHash: string | null }>();
    for (const cls of allClasses) {
      map.set(cls.className, {
        className: cls.className,
        classKind: cls.classKind,
        description: cls.description,
        documentation: cls.documentation,
        baseClasses: cls.extends,
        components: cls.components,
        iconHash: cls.iconHash ?? null,
        diagramHash: cls.diagramHash ?? null,
      });
    }
    return { version: chosenVersion, classes: map };
  }

  /**
   * Count indexed classes for a library version without loading documentation/row payloads.
   */
  getClassCount(libraryName: string, libraryVersion: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS cnt FROM classes WHERE library_name = ? AND library_version = ?`)
      .get(libraryName, libraryVersion) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  /**
   * Check whether a specific class exists for a library version without loading component relations.
   */
  hasClass(libraryName: string, libraryVersion: string, className: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 AS ok FROM classes WHERE library_name = ? AND library_version = ? AND class_name = ? LIMIT 1`)
      .get(libraryName, libraryVersion, className) as { ok: number } | undefined;
    return Boolean(row);
  }

  /**
   * Get a single class with its extends and components.
   */
  getClass(
    libraryName: string,
    libraryVersion: string,
    className: string,
  ): {
    classKind: string;
    description: string | null;
    documentation: string | null;
    iconHash: string | null;
    diagramHash: string | null;
    extends: string[];
    components: (Omit<ComponentRow, "id" | "class_id"> & { modifiers: Omit<ModifierRow, "id" | "component_id">[] })[];
  } | null {
    const cls = this.db
      .prepare(
        `SELECT id, class_kind, description, documentation, icon_hash, diagram_hash FROM classes
         WHERE library_name = ? AND library_version = ? AND class_name = ?`,
      )
      .get(libraryName, libraryVersion, className) as
      | {
          id: number;
          class_kind: string;
          description: string | null;
          documentation: string | null;
          icon_hash: string | null;
          diagram_hash: string | null;
        }
      | undefined;

    if (!cls) return null;

    const extendsRows = this.db.prepare(`SELECT base_class FROM extends WHERE class_id = ?`).all(cls.id) as {
      base_class: string;
    }[];

    const componentRows = this.db
      .prepare(
        `SELECT id, component_name, type_name, description, causality, variability
         FROM components WHERE class_id = ? ORDER BY component_name`,
      )
      .all(cls.id) as ComponentRow[];

    const getModifiers = this.db.prepare(`SELECT modifier_name, modifier_value FROM modifiers WHERE component_id = ?`);

    const components = componentRows.map((comp) => {
      const modifiers = getModifiers.all(comp.id) as { modifier_name: string; modifier_value: string | null }[];
      return {
        component_name: comp.component_name,
        type_name: comp.type_name,
        description: comp.description,
        causality: comp.causality,
        variability: comp.variability,
        modifiers: modifiers.map((m) => ({
          modifier_name: m.modifier_name,
          modifier_value: m.modifier_value,
        })),
      };
    });

    return {
      classKind: cls.class_kind,
      description: cls.description,
      documentation: cls.documentation,
      iconHash: cls.icon_hash ?? null,
      diagramHash: cls.diagram_hash ?? null,
      extends: extendsRows.map((r) => r.base_class),
      components,
    };
  }

  /**
   * Get all classes with full details for a library version.
   */
  getAllClasses(
    libraryName: string,
    libraryVersion: string,
  ): {
    className: string;
    classKind: string;
    description: string | null;
    documentation: string | null;
    iconHash: string | null;
    diagramHash: string | null;
    extends: string[];
    components: {
      name: string;
      typeName: string;
      description: string | null;
      causality: string | null;
      variability: string | null;
      modifiers: { name: string; value: string | null }[];
    }[];
  }[] {
    const classRows = this.db
      .prepare(
        `SELECT id, class_name, class_kind, description, documentation, icon_hash, diagram_hash FROM classes
         WHERE library_name = ? AND library_version = ? ORDER BY class_name`,
      )
      .all(libraryName, libraryVersion) as {
      id: number;
      class_name: string;
      class_kind: string;
      description: string | null;
      documentation: string | null;
      icon_hash: string | null;
      diagram_hash: string | null;
    }[];

    if (classRows.length === 0) {
      return [];
    }

    const extendsRows = this.db
      .prepare(
        `SELECT e.class_id, e.base_class
         FROM extends e
         JOIN classes c ON c.id = e.class_id
         WHERE c.library_name = ? AND c.library_version = ?
         ORDER BY e.id`,
      )
      .all(libraryName, libraryVersion) as { class_id: number; base_class: string }[];

    const componentRows = this.db
      .prepare(
        `SELECT comp.id, comp.class_id, comp.component_name, comp.type_name, comp.description, comp.causality, comp.variability
         FROM components comp
         JOIN classes c ON c.id = comp.class_id
         WHERE c.library_name = ? AND c.library_version = ?
         ORDER BY comp.component_name`,
      )
      .all(libraryName, libraryVersion) as (ComponentRow & { class_id: number })[];

    const modifierRows = this.db
      .prepare(
        `SELECT m.component_id, m.modifier_name, m.modifier_value
         FROM modifiers m
         JOIN components comp ON comp.id = m.component_id
         JOIN classes c ON c.id = comp.class_id
         WHERE c.library_name = ? AND c.library_version = ?
         ORDER BY m.id`,
      )
      .all(libraryName, libraryVersion) as {
      component_id: number;
      modifier_name: string;
      modifier_value: string | null;
    }[];

    const extendsByClassId = new Map<number, string[]>();
    for (const row of extendsRows) {
      const list = extendsByClassId.get(row.class_id);
      if (list) {
        list.push(row.base_class);
      } else {
        extendsByClassId.set(row.class_id, [row.base_class]);
      }
    }

    const modifiersByComponentId = new Map<number, { name: string; value: string | null }[]>();
    for (const row of modifierRows) {
      const list = modifiersByComponentId.get(row.component_id);
      const entry = { name: row.modifier_name, value: row.modifier_value };
      if (list) {
        list.push(entry);
      } else {
        modifiersByComponentId.set(row.component_id, [entry]);
      }
    }

    const componentsByClassId = new Map<
      number,
      {
        name: string;
        typeName: string;
        description: string | null;
        causality: string | null;
        variability: string | null;
        modifiers: { name: string; value: string | null }[];
      }[]
    >();
    for (const comp of componentRows) {
      const list = componentsByClassId.get(comp.class_id);
      const entry = {
        name: comp.component_name,
        typeName: comp.type_name,
        description: comp.description,
        causality: comp.causality,
        variability: comp.variability,
        modifiers: modifiersByComponentId.get(comp.id) ?? [],
      };
      if (list) {
        list.push(entry);
      } else {
        componentsByClassId.set(comp.class_id, [entry]);
      }
    }

    return classRows.map((cls) => ({
      className: cls.class_name,
      classKind: cls.class_kind,
      description: cls.description,
      documentation: cls.documentation,
      iconHash: cls.icon_hash ?? null,
      diagramHash: cls.diagram_hash ?? null,
      extends: extendsByClassId.get(cls.id) ?? [],
      components: componentsByClassId.get(cls.id) ?? [],
    }));
  }

  /**
   * Get all data for a library version as RDF triples ({s, p, o}).
   */
  getLibraryTriples(libraryName: string, libraryVersion: string): { s: string; p: string; o: string }[] {
    const NS = "https://modelica.org/ontology#";
    const LIB = `urn:modelica:${libraryName}:${libraryVersion}:`;
    const triples: { s: string; p: string; o: string }[] = [];

    const allClasses = this.getAllClasses(libraryName, libraryVersion);

    for (const cls of allClasses) {
      const classUri = `${LIB}${cls.className}`;
      triples.push({ s: classUri, p: `${NS}type`, o: `${NS}Class` });
      triples.push({ s: classUri, p: `${NS}className`, o: cls.className });
      triples.push({ s: classUri, p: `${NS}classKind`, o: cls.classKind });
      if (cls.description) {
        triples.push({ s: classUri, p: `${NS}description`, o: cls.description });
      }
      if (cls.documentation) {
        triples.push({ s: classUri, p: `${NS}documentation`, o: cls.documentation });
      }

      for (const base of cls.extends) {
        triples.push({ s: classUri, p: `${NS}extends`, o: `${LIB}${base}` });
      }

      for (const comp of cls.components) {
        const compUri = `${classUri}.${comp.name}`;
        triples.push({ s: classUri, p: `${NS}hasComponent`, o: compUri });
        triples.push({ s: compUri, p: `${NS}type`, o: `${NS}Component` });
        triples.push({ s: compUri, p: `${NS}componentName`, o: comp.name });
        triples.push({ s: compUri, p: `${NS}typeName`, o: comp.typeName });
        if (comp.description) {
          triples.push({ s: compUri, p: `${NS}description`, o: comp.description });
        }
        if (comp.causality) {
          triples.push({ s: compUri, p: `${NS}causality`, o: comp.causality });
        }
        if (comp.variability) {
          triples.push({ s: compUri, p: `${NS}variability`, o: comp.variability });
        }

        for (const mod of comp.modifiers) {
          const modUri = `${compUri}.${mod.name}`;
          triples.push({ s: compUri, p: `${NS}hasModifier`, o: modUri });
          triples.push({ s: modUri, p: `${NS}type`, o: `${NS}Modifier` });
          triples.push({ s: modUri, p: `${NS}modifierName`, o: mod.name });
          if (mod.value !== null) {
            triples.push({ s: modUri, p: `${NS}modifierValue`, o: mod.value });
          }
        }
      }
    }

    return triples;
  }

  /**
   * Delete all data for a library version.
   */
  deleteLibrary(libraryName: string, libraryVersion: string): void {
    this.deletePackageVersion(libraryName, libraryVersion);
    // Cascade deletes handle extends, components, modifiers
    this.db
      .prepare(`DELETE FROM classes WHERE library_name = ? AND library_version = ?`)
      .run(libraryName, libraryVersion);
    this.db
      .prepare(`DELETE FROM library_releases WHERE library_name = ? AND library_version = ?`)
      .run(libraryName, libraryVersion);

    // If no releases and no package_versions remain, clean up parent packages row
    const pkg = this.getPackage(libraryName);
    if (pkg) {
      const remainingReleases = this.getLibraryReleases(libraryName);
      const remainingVersions = this.getPackageVersions(pkg.id);
      if (remainingReleases.length === 0 && remainingVersions.length === 0) {
        this.db.prepare(`DELETE FROM dist_tags WHERE package_id = ?`).run(pkg.id);
        this.db.prepare(`DELETE FROM package_collaborators WHERE library_name = ?`).run(libraryName);
        this.db.prepare(`DELETE FROM packages WHERE id = ?`).run(pkg.id);
      }
    }
    this.facade.invalidateLibraryDiscoveryCache();
  }

  /**
   * Save or update a library release record with content hash, signature, and optional OIDC CI/CD attestation.
   */
  saveLibraryRelease(release: {
    libraryName: string;
    libraryVersion: string;
    contentHash: string;
    signature?: string | null | undefined;
    publishedBy?: number | null | undefined;
    oidcIssuer?: string | null | undefined;
    oidcSubject?: string | null | undefined;
    oidcRepository?: string | null | undefined;
    oidcWorkflowRef?: string | null | undefined;
    oidcRunId?: string | null | undefined;
  }): void {
    this.facade.packages.saveLibraryRelease(release);
  }

  /**
   * Find or provision a virtual CI/CD bot user identity for keyless OIDC token publishing.
   */
  getOrCreateCiBotUser(info: { provider: string; repository: string; actor?: string | undefined }): UserRow {
    const repoParts = info.repository.split("/");
    const repoOwner = repoParts[0] || "ci";

    // 1. Check if owner username exists
    const existingUser = this.facade.getUserByUsername(repoOwner);
    if (existingUser) {
      return existingUser;
    }

    // 2. Check if repository is linked to an existing account
    const linked = this.facade.getLinkedRepoById(info.repository);
    if (linked) {
      const linkedUser = this.facade.getUserById(linked.user_id);
      if (linkedUser) return linkedUser;
    }

    // 3. Find or create a dedicated CI publisher account
    const botUsername = `${info.provider}-ci-bot`;
    const botUser = this.facade.getUserByUsername(botUsername);
    if (botUser) return botUser;

    const email = `${info.provider}-ci@modelscript.local`;
    const created = this.facade.createUser(botUsername, email, crypto.randomBytes(32).toString("hex"), {
      accountType: "bot",
      emailVerified: true,
    });
    return this.facade.getUserById(created.id)!;
  }

  /**
   * Get release metadata (content hash, signature, timestamp) for a library.
   */
  getLibraryRelease(libraryName: string, libraryVersion: string): LibraryReleaseRow | null {
    return this.facade.packages.getLibraryRelease(libraryName, libraryVersion);
  }

  /**
   * Get all releases for a library name.
   */
  getLibraryReleases(libraryName: string): LibraryReleaseRow[] {
    return this.facade.packages.getLibraryReleases(libraryName);
  }

  /**
   * Mark a library release as deprecated (or clear deprecation if reason is null).
   */
  deprecateLibraryRelease(libraryName: string, libraryVersion: string, reason: string | null): boolean {
    return this.facade.packages.deprecateLibraryRelease(libraryName, libraryVersion, reason);
  }

  /**
   * Yank a library release (tombstone download while preserving metadata).
   */
  yankLibraryRelease(libraryName: string, libraryVersion: string, reason: string | null): boolean {
    return this.facade.packages.yankLibraryRelease(libraryName, libraryVersion, reason);
  }

  /**
   * Restore/unyank a library release.
   */
  unyankLibraryRelease(libraryName: string, libraryVersion: string): boolean {
    return this.facade.packages.unyankLibraryRelease(libraryName, libraryVersion);
  }

  /**
   * Check if a user has management permissions (owner/maintainer/admin) over a package.
   */
  canUserManagePackage(libraryName: string, userId: number): boolean {
    return this.facade.packages.canUserManagePackage(libraryName, userId);
  }

  /**
   * Check if a user has administrative permissions (owner/org-maintainer/admin collaborator) over a package.
   * Excludes 'write' collaborators from destructive/ownership/collaborator-management actions.
   */
  canUserAdministerPackage(libraryName: string, userId: number): boolean {
    return this.facade.packages.canUserAdministerPackage(libraryName, userId);
  }

  /**
   * Initiate a package ownership transfer request.
   */
  createPackageTransfer(packageName: string, fromUserId: number, toUserId: number): number {
    return this.facade.packages.createPackageTransfer(packageName, fromUserId, toUserId);
  }

  /**
   * Accept an ownership transfer request.
   */
  acceptPackageTransfer(transferId: number, toUserId: number): boolean {
    return this.facade.packages.acceptPackageTransfer(transferId, toUserId);
  }

  /**
   * Cancel an ownership transfer request.
   */
  cancelPackageTransfer(transferId: number, fromUserId: number): boolean {
    return this.facade.packages.cancelPackageTransfer(transferId, fromUserId);
  }

  /**
   * Get pending transfers for a user (incoming and outgoing).
   */
  getPendingTransfers(userId: number): PackageTransferRow[] {
    return this.facade.packages.getPendingTransfers(userId);
  }

  /**
   * Record a package download event for daily aggregation.
   */
  recordPackageDownload(libraryName: string, libraryVersion: string, dateStr?: string): void {
    if (this.facade.analyticsBuffer) {
      this.facade.analyticsBuffer.recordPackageDownload(libraryName, libraryVersion, dateStr);
      return;
    }
    const date = dateStr ?? new Date().toISOString().slice(0, 10);
    const targetDb = this.facade.analyticsDb ?? this.db;
    targetDb
      .prepare(
        `INSERT INTO package_downloads_daily (library_name, library_version, download_date, downloads_count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(library_name, library_version, download_date)
         DO UPDATE SET downloads_count = downloads_count + 1`,
      )
      .run(libraryName, libraryVersion, date);
  }

  /**
   * Query aggregated download statistics for a package.
   */
  getPackageStats(
    libraryName: string,
    days: number = 30,
  ): {
    totalDownloads: number;
    daily: { date: string; downloads: number }[];
    versionBreakdown: Record<string, number>;
  } {
    this.facade.analyticsBuffer?.flushSync();
    const startDate = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10);
    const targetDb = this.facade.analyticsDb ?? this.db;

    const totalRow = targetDb
      .prepare(`SELECT COALESCE(SUM(downloads_count), 0) as total FROM package_downloads_daily WHERE library_name = ?`)
      .get(libraryName) as { total: number };

    const dailyRows = targetDb
      .prepare(
        `SELECT download_date as date, SUM(downloads_count) as downloads
         FROM package_downloads_daily
         WHERE library_name = ? AND download_date >= ?
         GROUP BY download_date
         ORDER BY download_date ASC`,
      )
      .all(libraryName, startDate) as { date: string; downloads: number }[];

    const versionRows = targetDb
      .prepare(
        `SELECT library_version as version, SUM(downloads_count) as downloads
         FROM package_downloads_daily
         WHERE library_name = ?
         GROUP BY library_version
         ORDER BY downloads DESC`,
      )
      .all(libraryName) as { version: string; downloads: number }[];

    const versionBreakdown: Record<string, number> = {};
    for (const row of versionRows) {
      versionBreakdown[row.version] = row.downloads;
    }

    return {
      totalDownloads: totalRow?.total ?? 0,
      daily: dailyRows,
      versionBreakdown,
    };
  }

  /**
   * Get packages that declare this package as a dependency.
   */
  getReverseDependencies(targetPackageName: string): { name: string; version: string; description: string | null }[] {
    return this.facade.packages.getReverseDependencies(targetPackageName);
  }

  /**
   * Check if a user is authorized to publish a package release.
   */
  canUserPublishPackage(libraryName: string, userId: number): { allowed: boolean; reason?: string | undefined } {
    return this.facade.packages.canUserPublishPackage(libraryName, userId);
  }

  // ==========================================
  // Organizations and RBAC
  // ==========================================

  createOrganization(params: {
    slug: string;
    name: string;
    description?: string | null | undefined;
    avatarUrl?: string | null | undefined;
    createdBy: number;
  }): OrganizationRecord {
    const slug = params.slug.trim().toLowerCase();
    const info = this.db
      .prepare(
        `INSERT INTO organizations (slug, name, description, avatar_url, created_by)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(slug, params.name, params.description ?? null, params.avatarUrl ?? null, params.createdBy);

    const orgId = Number(info.lastInsertRowid);
    // Add creator as owner
    this.db
      .prepare(
        `INSERT INTO organization_members (org_id, user_id, role)
         VALUES (?, ?, 'owner')`,
      )
      .run(orgId, params.createdBy);

    return this.getOrganizationById(orgId)!;
  }

  getOrganizationBySlug(slug: string): OrganizationRecord | null {
    const row = this.db.prepare(`SELECT * FROM organizations WHERE LOWER(slug) = LOWER(?)`).get(slug.trim()) as
      OrganizationRecord | undefined;
    return row ?? null;
  }

  getOrganizationById(id: number): OrganizationRecord | null {
    const row = this.db.prepare(`SELECT * FROM organizations WHERE id = ?`).get(id) as OrganizationRecord | undefined;
    return row ?? null;
  }

  updateOrganization(
    orgId: number,
    updates: {
      name?: string | undefined;
      display_name?: string | null | undefined;
      description?: string | null | undefined;
      website?: string | null | undefined;
      billing_email?: string | null | undefined;
      avatar_url?: string | null | undefined;
      banner_url?: string | null | undefined;
      location?: string | null | undefined;
      industry_preset?: string | null | undefined;
    },
  ): OrganizationRecord | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      fields.push("name = ?");
      values.push(updates.name);
    }
    if (updates.display_name !== undefined) {
      fields.push("display_name = ?");
      values.push(updates.display_name);
    }
    if (updates.description !== undefined) {
      fields.push("description = ?");
      values.push(updates.description);
    }
    if (updates.website !== undefined) {
      fields.push("website = ?");
      values.push(updates.website);
    }
    if (updates.billing_email !== undefined) {
      fields.push("billing_email = ?");
      values.push(updates.billing_email);
    }
    if (updates.avatar_url !== undefined) {
      fields.push("avatar_url = ?");
      values.push(updates.avatar_url);
    }
    if (updates.banner_url !== undefined) {
      fields.push("banner_url = ?");
      values.push(updates.banner_url);
    }
    if (updates.location !== undefined) {
      fields.push("location = ?");
      values.push(updates.location);
    }
    if (updates.industry_preset !== undefined) {
      fields.push("industry_preset = ?");
      values.push(updates.industry_preset);
    }

    if (fields.length > 0) {
      values.push(orgId);
      this.db.prepare(`UPDATE organizations SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    }
    return this.getOrganizationById(orgId);
  }

  getUserOrganizations(userId: number): (OrganizationRecord & { role: OrgRole })[] {
    return this.db
      .prepare(
        `SELECT o.*, m.role
         FROM organizations o
         JOIN organization_members m ON o.id = m.org_id
         WHERE m.user_id = ?
         ORDER BY o.name ASC`,
      )
      .all(userId) as (OrganizationRecord & { role: OrgRole })[];
  }

  getOrganizationMembers(orgId: number): OrganizationMemberRecord[] {
    return this.db
      .prepare(
        `SELECT m.*, u.username, u.display_name, u.avatar_url
         FROM organization_members m
         JOIN users u ON m.user_id = u.id
         WHERE m.org_id = ?
         ORDER BY m.created_at ASC`,
      )
      .all(orgId) as OrganizationMemberRecord[];
  }

  getOrganizationMemberRole(orgId: number, userId: number): OrgRole | null {
    const row = this.db
      .prepare(`SELECT role FROM organization_members WHERE org_id = ? AND user_id = ?`)
      .get(orgId, userId) as { role: OrgRole } | undefined;
    return row?.role ?? null;
  }

  getOrgMemberRole(orgId: number, userId: number): OrgRole | null {
    return this.getOrganizationMemberRole(orgId, userId);
  }

  addOrganizationMember(orgId: number, userId: number, role: OrgRole): void {
    this.db
      .prepare(
        `INSERT INTO organization_members (org_id, user_id, role)
         VALUES (?, ?, ?)
         ON CONFLICT(org_id, user_id)
         DO UPDATE SET role = excluded.role`,
      )
      .run(orgId, userId, role);
  }

  removeOrganizationMember(orgId: number, userId: number): boolean {
    const info = this.db
      .prepare(`DELETE FROM organization_members WHERE org_id = ? AND user_id = ?`)
      .run(orgId, userId);
    return info.changes > 0;
  }

  // ==========================================
  // Package Collaborators
  // ==========================================

  addPackageCollaborator(libraryName: string, userId: number, permission: CollaboratorPermission): void {
    this.facade.packages.addPackageCollaborator(libraryName, userId, permission);
  }

  removePackageCollaborator(libraryName: string, userId: number): boolean {
    return this.facade.packages.removePackageCollaborator(libraryName, userId);
  }

  getPackageCollaborators(libraryName: string): PackageCollaboratorRecord[] {
    return this.facade.packages.getPackageCollaborators(libraryName);
  }

  getPackageCollaboratorPermission(libraryName: string, userId: number): CollaboratorPermission | null {
    return this.facade.packages.getPackageCollaboratorPermission(libraryName, userId);
  }

  // ── npm registry methods ────────────────────────────────────────

  /**
   * Get or create a package record by name.
   */
  getOrCreatePackage(name: string): { id: number; created: boolean } {
    return this.facade.packages.getOrCreatePackage(name);
  }

  /**
   * Get a package record by name.
   */
  getPackage(name: string):
    | {
        id: number;
        name: string;
        description: string | null;
        readme: string | null;
        readme_filename: string | null;
        license: string | null;
        homepage: string | null;
        repository_type: string | null;
        repository_url: string | null;
        created_at: string;
        modified_at: string;
      }
    | undefined {
    return this.facade.packages.getPackage(name);
  }

  /**
   * Update package-level metadata (hoisted from latest version).
   */
  updatePackageMeta(
    packageId: number,
    meta: {
      description?: string | null | undefined;
      readme?: string | null | undefined;
      readme_filename?: string | null | undefined;
      license?: string | null | undefined;
      homepage?: string | null | undefined;
      repository_type?: string | null | undefined;
      repository_url?: string | null | undefined;
    },
  ): void {
    this.facade.packages.updatePackageMeta(packageId, meta);
  }

  /**
   * Store a new package version.
   */
  storePackageVersion(
    packageId: number,
    version: string,
    tarballPath: string,
    tarballShasum: string,
    tarballIntegrity: string | null,
    tarballSize: number,
    manifest: string,
    modelscriptMeta: string | null,
    publishedBy: number | null,
  ): number {
    return this.facade.packages.storePackageVersion(
      packageId,
      version,
      tarballPath,
      tarballShasum,
      tarballIntegrity,
      tarballSize,
      manifest,
      modelscriptMeta,
      publishedBy,
    );
  }

  /**
   * Update the manifest of a package version.
   */
  updatePackageVersionManifest(versionId: number, manifest: string): void {
    this.facade.packages.updatePackageVersionManifest(versionId, manifest);
  }

  /**
   * Get a specific package version.
   */
  getPackageVersion(
    packageId: number,
    version: string,
  ):
    | {
        id: number;
        version: string;
        tarball_path: string;
        tarball_shasum: string;
        tarball_integrity: string | null;
        tarball_size: number;
        manifest: string;
        modelscript_meta: string | null;
        published_at: string;
      }
    | undefined {
    return this.facade.packages.getPackageVersion(packageId, version);
  }

  /**
   * Get all versions for a package.
   */
  getPackageVersions(packageId: number): {
    id: number;
    version: string;
    tarball_path: string;
    tarball_shasum: string;
    tarball_integrity: string | null;
    tarball_size: number;
    manifest: string;
    modelscript_meta: string | null;
    published_at: string;
  }[] {
    return this.facade.packages.getPackageVersions(packageId);
  }

  /**
   * Set a dist-tag for a package (e.g. "latest").
   */
  setDistTag(packageId: number, tag: string, version: string): void {
    this.facade.packages.setDistTag(packageId, tag, version);
  }

  /**
   * Get all dist-tags for a package.
   */
  getDistTags(packageId: number): Record<string, string> {
    return this.facade.packages.getDistTags(packageId);
  }

  /**
   * Store an artifact for a package version.
   */
  storeArtifact(versionId: number, type: string, artifactPath: string, metadata: string | null): number {
    return this.facade.packages.storeArtifact(versionId, type, artifactPath, metadata);
  }

  /**
   * Get artifacts for a package version.
   */
  getArtifacts(versionId: number): { id: number; type: string; path: string; metadata: string | null }[] {
    return this.facade.packages.getArtifacts(versionId);
  }

  /**
   * Build the full npm packument JSON for a package.
   */
  buildPackument(name: string, registryUrl: string): Record<string, unknown> | null {
    return this.facade.packages.buildPackument(name, registryUrl);
  }

  /**
   * Search packages by query text. Returns matching packages with basic metadata.
   */
  searchPackages(
    text: string,
    size = 20,
    from = 0,
  ): {
    objects: {
      package: {
        name: string;
        version: string;
        description: string | null;
        date: string;
      };
    }[];
    total: number;
  } {
    return this.facade.packages.searchPackages(text, size, from);
  }

  /**
   * List all packages with optional query filter. Returns basic package info.
   */
  listPackages(query?: string): {
    name: string;
    description: string | null;
    latest_version: string | null;
    modified_at: string;
  }[] {
    return this.facade.packages.listPackages(query);
  }

  /**
   * Batch snapshot for /api/v1/libraries discovery and ranking.
   * Replaces 10*N synchronous per-package SQLite queries with a constant number of bulk queries.
   */
  getLibraryDiscoverySnapshot(currentUserId?: number) {
    this.facade.analyticsBuffer?.flushSync();

    if (currentUserId) {
      this.facade.deriveUserTopics(currentUserId);
    }

    const now = Date.now();
    if (!this.#libraryDiscoveryBaseCache || this.#libraryDiscoveryBaseCache.expiresAt <= now) {
      const pkgRows = this.db.prepare(`SELECT id, name, description, license, modified_at FROM packages`).all() as {
        id: number;
        name: string;
        description: string | null;
        license: string | null;
        modified_at: string;
      }[];

      const packagesByName = new Map<
        string,
        { id: number; name: string; description: string | null; license: string | null; modified_at: string }
      >();
      const canonicalNameByLower = new Map<string, string>();
      for (const row of pkgRows) {
        packagesByName.set(row.name, row);
        canonicalNameByLower.set(row.name.toLowerCase(), row.name);
      }

      const versionRows = this.db
        .prepare(
          `SELECT id, package_id, version, manifest, published_at FROM package_versions ORDER BY published_at DESC`,
        )
        .all() as {
        id: number;
        package_id: number;
        version: string;
        manifest: string;
        published_at: string;
      }[];

      const versionsByPackageId = new Map<
        number,
        { id: number; version: string; manifest: string; published_at: string }[]
      >();
      const versionByPkgAndVer = new Map<
        string,
        { id: number; version: string; manifest: string; published_at: string }
      >();

      for (const v of versionRows) {
        let list = versionsByPackageId.get(v.package_id);
        if (!list) {
          list = [];
          versionsByPackageId.set(v.package_id, list);
        }
        list.push(v);
        versionByPkgAndVer.set(`${v.package_id}@${v.version}`, v);
      }

      const latestTagRows = this.db.prepare(`SELECT package_id, version FROM dist_tags WHERE tag = 'latest'`).all() as {
        package_id: number;
        version: string;
      }[];
      const latestTagByPackageId = new Map<number, string>();
      for (const dt of latestTagRows) {
        latestTagByPackageId.set(dt.package_id, dt.version);
      }

      // Compute reverse dependency counts in O(N) over latest manifests
      const dependentsCountByName = new Map<string, number>();
      for (const pkg of pkgRows) {
        const latestVerStr = latestTagByPackageId.get(pkg.id) ?? versionsByPackageId.get(pkg.id)?.[0]?.version;
        const latestVerRow = latestVerStr ? versionByPkgAndVer.get(`${pkg.id}@${latestVerStr}`) : undefined;
        if (!latestVerRow?.manifest) continue;
        try {
          const parsed = JSON.parse(latestVerRow.manifest) as Record<string, unknown>;
          const msx =
            parsed["modelscript"] && typeof parsed["modelscript"] === "object"
              ? (parsed["modelscript"] as Record<string, unknown>)
              : undefined;
          const depsObj = {
            ...(parsed["dependencies"] && typeof parsed["dependencies"] === "object"
              ? (parsed["dependencies"] as Record<string, unknown>)
              : {}),
            ...(msx?.["dependencies"] && typeof msx["dependencies"] === "object"
              ? (msx["dependencies"] as Record<string, unknown>)
              : {}),
          };
          const seenDeps = new Set<string>();
          for (const rawDep of Object.keys(depsObj)) {
            const depLower = rawDep.toLowerCase();
            if (depLower === pkg.name.toLowerCase() || seenDeps.has(depLower)) continue;
            seenDeps.add(depLower);
            const targetName = canonicalNameByLower.get(depLower) ?? rawDep;
            dependentsCountByName.set(targetName, (dependentsCountByName.get(targetName) ?? 0) + 1);
          }
        } catch {
          // ignore invalid manifest JSON
        }
      }

      const releaseRows = this.db
        .prepare(
          `SELECT lr.library_name, lr.library_version, lr.published_at, lr.published_by,
                lr.is_deprecated, lr.deprecation_reason, lr.is_yanked,
                u.username AS publisher_username
         FROM library_releases lr
         LEFT JOIN users u ON u.id = lr.published_by`,
        )
        .all() as {
        library_name: string;
        library_version: string;
        published_at: string;
        published_by: number | null;
        is_deprecated: number;
        deprecation_reason: string | null;
        is_yanked: number;
        publisher_username: string | null;
      }[];

      const releasesByKey = new Map<
        string,
        {
          published_at: string;
          published_by: number | null;
          is_deprecated: number;
          deprecation_reason: string | null;
          is_yanked: number;
          publisher_username: string | null;
        }
      >();
      for (const r of releaseRows) {
        releasesByKey.set(`${r.library_name}@${r.library_version}`, r);
      }

      const start30d = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
      const start7d = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10);
      const downloadRows = this.db
        .prepare(
          `SELECT
           library_name,
           COALESCE(SUM(downloads_count), 0) AS total_downloads,
           COALESCE(SUM(CASE WHEN download_date >= ? THEN downloads_count ELSE 0 END), 0) AS downloads_30d,
           COALESCE(SUM(CASE WHEN download_date >= ? THEN downloads_count ELSE 0 END), 0) AS downloads_7d
         FROM package_downloads_daily
         GROUP BY library_name`,
        )
        .all(start30d, start7d) as {
        library_name: string;
        total_downloads: number;
        downloads_30d: number;
        downloads_7d: number;
      }[];

      const downloadsByName = new Map<string, { totalDownloads: number; downloads30d: number; downloads7d: number }>();
      for (const d of downloadRows) {
        downloadsByName.set(d.library_name, {
          totalDownloads: d.total_downloads,
          downloads30d: d.downloads_30d,
          downloads7d: d.downloads_7d,
        });
      }

      const classSummaryRows = this.db
        .prepare(
          `SELECT
           library_name,
           library_version,
           COUNT(*) AS class_count,
           MAX(CASE WHEN LOWER(class_kind) LIKE '%sysml%' THEN 1 ELSE 0 END) AS has_sysml
         FROM classes
         GROUP BY library_name, library_version`,
        )
        .all() as {
        library_name: string;
        library_version: string;
        class_count: number;
        has_sysml: number;
      }[];

      const classSummaryByKey = new Map<string, { classCount: number; hasSysml: boolean }>();
      for (const c of classSummaryRows) {
        classSummaryByKey.set(`${c.library_name}@${c.library_version}`, {
          classCount: c.class_count,
          hasSysml: c.has_sysml === 1,
        });
      }

      const artifactRows = this.db
        .prepare(
          `SELECT version_id, LOWER(type) AS type, COUNT(*) AS cnt
         FROM artifacts
         GROUP BY version_id, LOWER(type)`,
        )
        .all() as { version_id: number; type: string; cnt: number }[];

      const artifactsByVersionId = new Map<number, { type: string; count: number }[]>();
      for (const a of artifactRows) {
        let list = artifactsByVersionId.get(a.version_id);
        if (!list) {
          list = [];
          artifactsByVersionId.set(a.version_id, list);
        }
        list.push({ type: a.type, count: a.cnt });
      }

      this.#libraryDiscoveryBaseCache = {
        expiresAt: now + 30000,
        data: {
          packagesByName,
          versionsByPackageId,
          versionByPkgAndVer,
          releasesByKey,
          downloadsByName,
          classSummaryByKey,
          artifactsByVersionId,
          dependentsCountByName,
        },
      };
    }

    const base = this.#libraryDiscoveryBaseCache!.data;

    let viewerPersona: string | null = null;
    const activeTopics = new Set<string>();
    const dismissedTopics = new Set<string>();

    if (currentUserId) {
      const uRow = this.db.prepare(`SELECT engineering_persona FROM users WHERE id = ?`).get(currentUserId) as
        { engineering_persona?: string | null } | undefined;
      viewerPersona = uRow?.engineering_persona ?? null;

      const tRows = this.db
        .prepare(`SELECT concept AS topic, is_active FROM user_topics WHERE user_id = ?`)
        .all(currentUserId) as { topic: string; is_active: number }[];
      for (const t of tRows) {
        const clean = t.topic.replace(/^#+/, "").toLowerCase();
        if (t.is_active === 1) activeTopics.add(clean);
        else dismissedTopics.add(clean);
      }
    }

    return {
      packagesByName: base.packagesByName,
      versionsByPackageId: base.versionsByPackageId,
      versionByPkgAndVer: base.versionByPkgAndVer,
      releasesByKey: base.releasesByKey,
      downloadsByName: base.downloadsByName,
      classSummaryByKey: base.classSummaryByKey,
      artifactsByVersionId: base.artifactsByVersionId,
      dependentsCountByName: base.dependentsCountByName,
      viewerPersona,
      activeTopics,
      dismissedTopics,
    };
  }

  /**
   * Delete a package version. If no more versions remain, delete the package.
   */
  deletePackageVersion(name: string, version: string): boolean {
    return this.facade.packages.deletePackageVersion(name, version);
  }

  // ── CAD Cache ───────────────────────────────────────────────────

  getCachedCadGeometry(url: string): string | undefined {
    const row = this.db.prepare(`SELECT geometry_json FROM cad_cache WHERE url = ?`).get(url) as
      { geometry_json?: string | undefined } | undefined;
    return row?.geometry_json;
  }

  setCachedCadGeometry(url: string, geometryJson: string): void {
    this.db.prepare(`INSERT OR REPLACE INTO cad_cache (url, geometry_json) VALUES (?, ?)`).run(url, geometryJson);
  }

  // ── Jobs ────────────────────────────────────────────────────────

  createJob(
    name: string,
    status: string,
    type: string,
    triggerSource: string | null = null,
    repositoryId: number | null = null,
    metadata: Record<string, unknown> | null = null,
    userId: number | null = null,
  ): number {
    const result = this.db
      .prepare(
        `INSERT INTO jobs (name, status, type, trigger_source, repository_id, metadata, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(name, status, type, triggerSource, repositoryId, metadata ? JSON.stringify(metadata) : null, userId);
    return result.lastInsertRowid as number;
  }

  getJobByMetadataKey(
    key: string,
    value: unknown,
  ): { id: number; name: string; status: string; user_id: number | null; metadata: string | null } | undefined {
    return this.db
      .prepare(
        `SELECT id, name, status, user_id, metadata FROM jobs WHERE json_extract(metadata, '$.' || ?) = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(key, String(value)) as
      { id: number; name: string; status: string; user_id: number | null; metadata: string | null } | undefined;
  }

  updateJobStatus(jobId: number, status: string): void {
    if (status === "SUCCESS" || status === "FAILED" || status === "CANCELLED") {
      this.db.prepare(`UPDATE jobs SET status = ?, completed_at = datetime('now') WHERE id = ?`).run(status, jobId);
    } else {
      this.db.prepare(`UPDATE jobs SET status = ? WHERE id = ?`).run(status, jobId);
    }
  }

  updateJobAccounting(
    jobId: number,
    accounting: {
      computeProfile?: string | undefined;
      cpuSeconds?: number | undefined;
      peakMemoryMb?: number | undefined;
      gpuSeconds?: number | undefined;
      costCredits?: number | undefined;
    },
  ): void {
    const fields: string[] = [];
    const values: (string | number)[] = [];

    if (accounting.computeProfile !== undefined) {
      fields.push("compute_profile = ?");
      values.push(accounting.computeProfile);
    }
    if (accounting.cpuSeconds !== undefined) {
      fields.push("cpu_seconds = ?");
      values.push(accounting.cpuSeconds);
    }
    if (accounting.peakMemoryMb !== undefined) {
      fields.push("peak_memory_mb = ?");
      values.push(accounting.peakMemoryMb);
    }
    if (accounting.gpuSeconds !== undefined) {
      fields.push("gpu_seconds = ?");
      values.push(accounting.gpuSeconds);
    }
    if (accounting.costCredits !== undefined) {
      fields.push("cost_credits = ?");
      values.push(accounting.costCredits);
    }

    if (fields.length > 0) {
      values.push(jobId);
      this.db.prepare(`UPDATE jobs SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    }
  }

  completeJobWithBilling(
    jobId: number,
    usage: {
      computeProfile?: string | undefined;
      cpuSeconds?: number | undefined;
      peakMemoryMb?: number | undefined;
      gpuSeconds?: number | undefined;
      costCredits?: number | undefined;
    },
    userId?: number | null,
    description?: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.db.transaction(() => {
      this.updateJobStatus(jobId, "SUCCESS");
      this.updateJobAccounting(jobId, usage);
      if (userId && usage.costCredits && usage.costCredits > 0) {
        this.facade.deductUserCredits(
          userId,
          usage.costCredits,
          jobId,
          description || `Job ${jobId} execution`,
          metadata,
        );
      }
      if (userId) {
        this.facade.createNotification(userId, userId, "simulation_completed");
      }
    })();
  }
}

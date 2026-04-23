// SPDX-License-Identifier: AGPL-3.0-or-later

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB_DIR = "data";

export interface ClassRow {
  id: number;
  library_name: string;
  library_version: string;
  class_name: string;
  class_kind: string;
  description: string | null;
  documentation: string | null;
}

export interface ExtendsRow {
  id: number;
  class_id: number;
  base_class: string;
}

export interface ComponentRow {
  id: number;
  class_id: number;
  component_name: string;
  type_name: string;
  description: string | null;
  causality: string | null;
  variability: string | null;
}

export interface ModifierRow {
  id: number;
  component_id: number;
  modifier_name: string;
  modifier_value: string | null;
}

export interface ClassMetadata {
  className: string;
  classKind: string;
  description: string | null;
  documentation: string | null;
  baseClasses: string[];
  components: ComponentMetadata[];
}

export interface ComponentMetadata {
  name: string;
  typeName: string;
  description: string | null;
  causality: string | null;
  variability: string | null;
  modifiers: { name: string; value: string | null }[];
}

/**
 * SQLite-backed storage for Modelica class metadata.
 */
export class LibraryDatabase {
  readonly #db: Database.Database;

  constructor(dbDir?: string) {
    const dir = dbDir ?? DEFAULT_DB_DIR;
    const dbPath = path.join(dir, "modelscript.db");

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.#db = new Database(dbPath);
    this.#db.pragma("journal_mode = WAL");
    this.#initialize();
  }

  get db(): Database.Database {
    return this.#db;
  }

  #initialize(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS classes (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        library_name    TEXT NOT NULL,
        library_version TEXT NOT NULL,
        class_name      TEXT NOT NULL,
        class_kind      TEXT NOT NULL,
        description     TEXT,
        documentation   TEXT,
        UNIQUE(library_name, library_version, class_name)
      );

      CREATE TABLE IF NOT EXISTS extends (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        base_class      TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS components (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        component_name  TEXT NOT NULL,
        type_name       TEXT NOT NULL,
        description     TEXT,
        causality       TEXT,
        variability     TEXT
      );

      CREATE TABLE IF NOT EXISTS modifiers (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        component_id    INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
        modifier_name   TEXT NOT NULL,
        modifier_value  TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_classes_library ON classes(library_name, library_version);
      CREATE INDEX IF NOT EXISTS idx_extends_class ON extends(class_id);
      CREATE INDEX IF NOT EXISTS idx_components_class ON components(class_id);
      CREATE INDEX IF NOT EXISTS idx_modifiers_component ON modifiers(component_id);

      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at    TEXT DEFAULT (datetime('now'))
      );

      -- ── npm registry tables ──────────────────────────────────────

      CREATE TABLE IF NOT EXISTS packages (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT NOT NULL UNIQUE,
        description     TEXT,
        readme          TEXT,
        readme_filename TEXT,
        license         TEXT,
        homepage        TEXT,
        repository_type TEXT,
        repository_url  TEXT,
        created_at      TEXT DEFAULT (datetime('now')),
        modified_at     TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS package_versions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        package_id      INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
        version         TEXT NOT NULL,
        tarball_path    TEXT NOT NULL,
        tarball_shasum  TEXT NOT NULL,
        tarball_integrity TEXT,
        tarball_size    INTEGER NOT NULL,
        manifest        TEXT NOT NULL,
        modelscript_meta TEXT,
        published_by    INTEGER REFERENCES users(id),
        published_at    TEXT DEFAULT (datetime('now')),
        UNIQUE(package_id, version)
      );

      CREATE TABLE IF NOT EXISTS dist_tags (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        package_id      INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
        tag             TEXT NOT NULL,
        version         TEXT NOT NULL,
        UNIQUE(package_id, tag)
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        version_id      INTEGER NOT NULL REFERENCES package_versions(id) ON DELETE CASCADE,
        type            TEXT NOT NULL,
        path            TEXT NOT NULL,
        metadata        TEXT,
        UNIQUE(version_id, path)
      );

      CREATE INDEX IF NOT EXISTS idx_packages_name ON packages(name);
      CREATE INDEX IF NOT EXISTS idx_package_versions_pkg ON package_versions(package_id);
      CREATE INDEX IF NOT EXISTS idx_dist_tags_pkg ON dist_tags(package_id);
      CREATE INDEX IF NOT EXISTS idx_artifacts_version ON artifacts(version_id);
    `);
  }

  // ── User management ─────────────────────────────────────────────

  createUser(username: string, email: string, passwordHash: string): { id: number; username: string; email: string } {
    const result = this.#db
      .prepare(`INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)`)
      .run(username, email, passwordHash);
    return { id: Number(result.lastInsertRowid), username, email };
  }

  getUserByEmail(email: string): { id: number; username: string; email: string; password_hash: string } | undefined {
    return this.#db.prepare(`SELECT id, username, email, password_hash FROM users WHERE email = ?`).get(email) as
      | { id: number; username: string; email: string; password_hash: string }
      | undefined;
  }

  getUserByUsername(username: string): { id: number; username: string; email: string } | undefined {
    return this.#db.prepare(`SELECT id, username, email FROM users WHERE username = ?`).get(username) as
      | { id: number; username: string; email: string }
      | undefined;
  }

  getUserById(id: number): { id: number; username: string; email: string } | undefined {
    return this.#db.prepare(`SELECT id, username, email FROM users WHERE id = ?`).get(id) as
      | { id: number; username: string; email: string }
      | undefined;
  }

  // ── Library metadata ────────────────────────────────────────────

  /**
   * Clear all metadata for a library version.
   */
  clearLibraryMetadata(libraryName: string, libraryVersion: string): void {
    this.#db
      .prepare(`DELETE FROM classes WHERE library_name = ? AND library_version = ?`)
      .run(libraryName, libraryVersion);
  }

  /**
   * Store all metadata for a library version inside a transaction.
   */
  /**
   * Store metadata for a single class. This should be run inside a transaction for performance.
   */
  storeClassMetadata(libraryName: string, libraryVersion: string, cls: ClassMetadata): void {
    const result = this.#db
      .prepare(
        `INSERT OR REPLACE INTO classes (library_name, library_version, class_name, class_kind, description, documentation)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(libraryName, libraryVersion, cls.className, cls.classKind, cls.description, cls.documentation);

    const classId = result.lastInsertRowid;

    const insertExtends = this.#db.prepare(`INSERT OR REPLACE INTO extends (class_id, base_class) VALUES (?, ?)`);
    for (const baseClass of cls.baseClasses) {
      insertExtends.run(classId, baseClass);
    }

    const insertComponent = this.#db.prepare(
      `INSERT OR REPLACE INTO components (class_id, component_name, type_name, description, causality, variability)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertModifier = this.#db.prepare(
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
    const transaction = this.#db.transaction(() => {
      this.clearLibraryMetadata(libraryName, libraryVersion);
      for (const cls of classes) {
        this.storeClassMetadata(libraryName, libraryVersion, cls);
      }
    });

    transaction();
  }

  /**
   * Store a batch of class metadata without clearing existing data.
   * Use this for incremental batch inserts during library processing.
   */
  storeClassBatch(libraryName: string, libraryVersion: string, classes: ClassMetadata[]): void {
    const transaction = this.#db.transaction(() => {
      for (const cls of classes) {
        this.storeClassMetadata(libraryName, libraryVersion, cls);
      }
    });

    transaction();
  }

  /**
   * Query classes for a library version with optional filters.
   */
  getClasses(
    libraryName: string,
    libraryVersion: string,
    opts?: { kind?: string | undefined; q?: string | undefined },
  ): Omit<ClassRow, "id">[] {
    let sql = `SELECT class_name, class_kind, description, documentation FROM classes
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

    return this.#db.prepare(sql).all(...params) as Omit<ClassRow, "id">[];
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
    extends: string[];
    components: (Omit<ComponentRow, "id" | "class_id"> & { modifiers: Omit<ModifierRow, "id" | "component_id">[] })[];
  } | null {
    const cls = this.#db
      .prepare(
        `SELECT id, class_kind, description, documentation FROM classes
         WHERE library_name = ? AND library_version = ? AND class_name = ?`,
      )
      .get(libraryName, libraryVersion, className) as
      | { id: number; class_kind: string; description: string | null; documentation: string | null }
      | undefined;

    if (!cls) return null;

    const extendsRows = this.#db.prepare(`SELECT base_class FROM extends WHERE class_id = ?`).all(cls.id) as {
      base_class: string;
    }[];

    const componentRows = this.#db
      .prepare(
        `SELECT id, component_name, type_name, description, causality, variability
         FROM components WHERE class_id = ? ORDER BY component_name`,
      )
      .all(cls.id) as ComponentRow[];

    const getModifiers = this.#db.prepare(`SELECT modifier_name, modifier_value FROM modifiers WHERE component_id = ?`);

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
    const classRows = this.#db
      .prepare(
        `SELECT id, class_name, class_kind, description, documentation FROM classes
         WHERE library_name = ? AND library_version = ? ORDER BY class_name`,
      )
      .all(libraryName, libraryVersion) as {
      id: number;
      class_name: string;
      class_kind: string;
      description: string | null;
      documentation: string | null;
    }[];

    const getExtends = this.#db.prepare(`SELECT base_class FROM extends WHERE class_id = ?`);
    const getComponents = this.#db.prepare(
      `SELECT id, component_name, type_name, description, causality, variability
       FROM components WHERE class_id = ? ORDER BY component_name`,
    );
    const getModifiers = this.#db.prepare(`SELECT modifier_name, modifier_value FROM modifiers WHERE component_id = ?`);

    return classRows.map((cls) => {
      const extendsRows = getExtends.all(cls.id) as { base_class: string }[];
      const componentRows = getComponents.all(cls.id) as ComponentRow[];

      const components = componentRows.map((comp) => {
        const modifiers = getModifiers.all(comp.id) as { modifier_name: string; modifier_value: string | null }[];
        return {
          name: comp.component_name,
          typeName: comp.type_name,
          description: comp.description,
          causality: comp.causality,
          variability: comp.variability,
          modifiers: modifiers.map((m) => ({ name: m.modifier_name, value: m.modifier_value })),
        };
      });

      return {
        className: cls.class_name,
        classKind: cls.class_kind,
        description: cls.description,
        documentation: cls.documentation,
        extends: extendsRows.map((r) => r.base_class),
        components,
      };
    });
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
    // Cascade deletes handle extends, components, modifiers
    this.#db
      .prepare(`DELETE FROM classes WHERE library_name = ? AND library_version = ?`)
      .run(libraryName, libraryVersion);
  }

  // ── npm registry methods ────────────────────────────────────────

  /**
   * Get or create a package record by name.
   */
  getOrCreatePackage(name: string): { id: number; created: boolean } {
    const existing = this.#db.prepare(`SELECT id FROM packages WHERE name = ?`).get(name) as { id: number } | undefined;
    if (existing) {
      return { id: existing.id, created: false };
    }
    const result = this.#db.prepare(`INSERT INTO packages (name) VALUES (?)`).run(name);
    return { id: Number(result.lastInsertRowid), created: true };
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
    return this.#db.prepare(`SELECT * FROM packages WHERE name = ?`).get(name) as
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
      | undefined;
  }

  /**
   * Update package-level metadata (hoisted from latest version).
   */
  updatePackageMeta(
    packageId: number,
    meta: {
      description?: string | null;
      readme?: string | null;
      readme_filename?: string | null;
      license?: string | null;
      homepage?: string | null;
      repository_type?: string | null;
      repository_url?: string | null;
    },
  ): void {
    this.#db
      .prepare(
        `UPDATE packages SET
          description = COALESCE(?, description),
          readme = COALESCE(?, readme),
          readme_filename = COALESCE(?, readme_filename),
          license = COALESCE(?, license),
          homepage = COALESCE(?, homepage),
          repository_type = COALESCE(?, repository_type),
          repository_url = COALESCE(?, repository_url),
          modified_at = datetime('now')
        WHERE id = ?`,
      )
      .run(
        meta.description ?? null,
        meta.readme ?? null,
        meta.readme_filename ?? null,
        meta.license ?? null,
        meta.homepage ?? null,
        meta.repository_type ?? null,
        meta.repository_url ?? null,
        packageId,
      );
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
    const result = this.#db
      .prepare(
        `INSERT INTO package_versions
          (package_id, version, tarball_path, tarball_shasum, tarball_integrity, tarball_size, manifest, modelscript_meta, published_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
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
    return Number(result.lastInsertRowid);
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
    return this.#db
      .prepare(`SELECT * FROM package_versions WHERE package_id = ? AND version = ?`)
      .get(packageId, version) as
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
      | undefined;
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
    return this.#db
      .prepare(`SELECT * FROM package_versions WHERE package_id = ? ORDER BY published_at DESC`)
      .all(packageId) as {
      id: number;
      version: string;
      tarball_path: string;
      tarball_shasum: string;
      tarball_integrity: string | null;
      tarball_size: number;
      manifest: string;
      modelscript_meta: string | null;
      published_at: string;
    }[];
  }

  /**
   * Set a dist-tag for a package (e.g. "latest").
   */
  setDistTag(packageId: number, tag: string, version: string): void {
    this.#db
      .prepare(
        `INSERT INTO dist_tags (package_id, tag, version) VALUES (?, ?, ?)
        ON CONFLICT(package_id, tag) DO UPDATE SET version = excluded.version`,
      )
      .run(packageId, tag, version);
  }

  /**
   * Get all dist-tags for a package.
   */
  getDistTags(packageId: number): Record<string, string> {
    const rows = this.#db.prepare(`SELECT tag, version FROM dist_tags WHERE package_id = ?`).all(packageId) as {
      tag: string;
      version: string;
    }[];
    const tags: Record<string, string> = {};
    for (const row of rows) {
      tags[row.tag] = row.version;
    }
    return tags;
  }

  /**
   * Store an artifact for a package version.
   */
  storeArtifact(versionId: number, type: string, artifactPath: string, metadata: string | null): number {
    const result = this.#db
      .prepare(`INSERT OR REPLACE INTO artifacts (version_id, type, path, metadata) VALUES (?, ?, ?, ?)`)
      .run(versionId, type, artifactPath, metadata);
    return Number(result.lastInsertRowid);
  }

  /**
   * Get artifacts for a package version.
   */
  getArtifacts(versionId: number): { id: number; type: string; path: string; metadata: string | null }[] {
    return this.#db.prepare(`SELECT * FROM artifacts WHERE version_id = ?`).all(versionId) as {
      id: number;
      type: string;
      path: string;
      metadata: string | null;
    }[];
  }

  /**
   * Build the full npm packument JSON for a package.
   */
  buildPackument(name: string, registryUrl: string): Record<string, unknown> | null {
    const pkg = this.getPackage(name);
    if (!pkg) return null;

    const versions = this.getPackageVersions(pkg.id);
    if (versions.length === 0) return null;

    const distTags = this.getDistTags(pkg.id);
    const time: Record<string, string> = {
      created: pkg.created_at,
      modified: pkg.modified_at,
    };

    const versionsObj: Record<string, unknown> = {};
    for (const v of versions) {
      time[v.version] = v.published_at;
      const manifest = JSON.parse(v.manifest) as Record<string, unknown>;
      // Ensure dist info is present
      manifest["dist"] = {
        shasum: v.tarball_shasum,
        integrity: v.tarball_integrity,
        tarball: `${registryUrl}/${encodeURIComponent(name)}/-/${name}-${v.version}.tgz`,
      };
      manifest["_id"] = `${name}@${v.version}`;
      versionsObj[v.version] = manifest;
    }

    const repository = pkg.repository_url ? { type: pkg.repository_type ?? "git", url: pkg.repository_url } : undefined;

    return {
      _id: name,
      _rev: `1-${Date.now().toString(16)}`,
      name,
      description: pkg.description,
      "dist-tags": distTags,
      versions: versionsObj,
      time,
      readme: pkg.readme ?? "",
      readmeFilename: pkg.readme_filename ?? "README.md",
      license: pkg.license,
      homepage: pkg.homepage,
      repository,
    };
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
    const countSql = `SELECT COUNT(*) as total FROM packages WHERE name LIKE ? OR description LIKE ?`;
    const searchSql = `
      SELECT p.name, p.description, p.modified_at,
        (SELECT dt.version FROM dist_tags dt WHERE dt.package_id = p.id AND dt.tag = 'latest') as latest_version
      FROM packages p
      WHERE p.name LIKE ? OR p.description LIKE ?
      ORDER BY p.modified_at DESC
      LIMIT ? OFFSET ?
    `;
    const pattern = `%${text}%`;

    const countRow = this.#db.prepare(countSql).get(pattern, pattern) as { total: number };
    const rows = this.#db.prepare(searchSql).all(pattern, pattern, size, from) as {
      name: string;
      description: string | null;
      modified_at: string;
      latest_version: string | null;
    }[];

    return {
      objects: rows.map((r) => ({
        package: {
          name: r.name,
          version: r.latest_version ?? "0.0.0",
          description: r.description,
          date: r.modified_at,
        },
      })),
      total: countRow.total,
    };
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
    let sql = `
      SELECT p.name, p.description, p.modified_at,
        (SELECT dt.version FROM dist_tags dt WHERE dt.package_id = p.id AND dt.tag = 'latest') as latest_version
      FROM packages p
    `;
    const params: string[] = [];
    if (query) {
      sql += ` WHERE p.name LIKE ? OR p.description LIKE ?`;
      const pattern = `%${query}%`;
      params.push(pattern, pattern);
    }
    sql += ` ORDER BY p.modified_at DESC`;
    return this.#db.prepare(sql).all(...params) as {
      name: string;
      description: string | null;
      latest_version: string | null;
      modified_at: string;
    }[];
  }

  /**
   * Delete a package version. If no more versions remain, delete the package.
   */
  deletePackageVersion(name: string, version: string): boolean {
    const pkg = this.getPackage(name);
    if (!pkg) return false;

    const v = this.getPackageVersion(pkg.id, version);
    if (!v) return false;

    this.#db.prepare(`DELETE FROM package_versions WHERE id = ?`).run(v.id);

    // Clean up dist-tags pointing to this version
    this.#db.prepare(`DELETE FROM dist_tags WHERE package_id = ? AND version = ?`).run(pkg.id, version);

    // If no versions remain, delete the package
    const remaining = this.getPackageVersions(pkg.id);
    if (remaining.length === 0) {
      this.#db.prepare(`DELETE FROM packages WHERE id = ?`).run(pkg.id);
    } else {
      // Re-point "latest" to the newest remaining version
      if (remaining[0]) {
        this.setDistTag(pkg.id, "latest", remaining[0].version);
      }
    }

    return true;
  }

  close(): void {
    this.#db.close();
  }
}

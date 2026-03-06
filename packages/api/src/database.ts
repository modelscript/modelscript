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
    `);
  }

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

  close(): void {
    this.#db.close();
  }
}

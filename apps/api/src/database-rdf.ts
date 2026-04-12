// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Source, Term } from "@rdfjs/types";
import type { Database } from "better-sqlite3";
import { DataFactory } from "n3";
import { Readable } from "node:stream";
import type { ClassRow, ComponentRow, ModifierRow } from "./database.js";

const { namedNode, literal, quad } = DataFactory;

const NS = "https://modelica.org/ontology#";

/**
 * An RDF/JS Source that lazily executes SQLite queries to retrieve Quads
 * instead of loading all triples into an in-memory store.
 */
export class SqliteRdfSource implements Source {
  readonly #db: Database;
  readonly #libraryName: string;
  readonly #libraryVersion: string;
  readonly #libPrefix: string;

  constructor(db: Database, libraryName: string, libraryVersion: string) {
    this.#db = db;
    this.#libraryName = libraryName;
    this.#libraryVersion = libraryVersion;
    this.#libPrefix = `urn:modelica:${libraryName}:${libraryVersion}:`;
  }

  /**
   * Comunica uses this to retrieve matching quads.
   * We translate the match(subject, predicate, object) bounds into SQLite queries.
   */
  match(subject?: Term | null, predicate?: Term | null, object?: Term | null): Readable {
    const stream = new Readable({
      objectMode: true,
      read() {
        // We push all at once in this implementation.
        // For massive DBs, this could be refactored to use #db.prepare().iterate().
      },
    });

    // Execute the database retrieval asynchronously so we don't block the stream
    setImmediate(() => {
      try {
        this.#executeMatch(stream, subject, predicate, object);
        stream.push(null); // End stream
      } catch (err) {
        stream.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    });

    return stream;
  }

  #executeMatch(stream: Readable, subject?: Term | null, predicate?: Term | null, object?: Term | null): void {
    // Determine bounds
    const sValue = subject?.value;
    const pValue = predicate?.value;
    const oValue = object?.value;

    // For complex SPARQL queries, Comunica will ask for everything with unbound variables `match(undefined, undefined, undefined)`.
    const params: (string | number)[] = [this.#libraryName, this.#libraryVersion];

    const classes = this.#db
      .prepare(
        `SELECT id, class_name, class_kind, description FROM classes WHERE library_name = ? AND library_version = ?`,
      )
      .all(...params) as ClassRow[];

    if (classes.length === 0) return;

    const classIds = classes.map((c) => c.id);
    const placeholders = classIds.map(() => "?").join(",");

    const extendsRows = this.#db
      .prepare(`SELECT class_id, base_class FROM extends WHERE class_id IN (${placeholders})`)
      .all(...classIds) as { class_id: number; base_class: string }[];

    const componentsRows = this.#db
      .prepare(
        `SELECT id, class_id, component_name, type_name, description, causality, variability FROM components WHERE class_id IN (${placeholders})`,
      )
      .all(...classIds) as ComponentRow[];

    const compIds = componentsRows.map((c) => c.id);
    let modifiersRows: ModifierRow[] = [];
    if (compIds.length > 0) {
      const compPlaceholders = compIds.map(() => "?").join(",");
      modifiersRows = this.#db
        .prepare(
          `SELECT component_id, modifier_name, modifier_value FROM modifiers WHERE component_id IN (${compPlaceholders})`,
        )
        .all(...compIds) as ModifierRow[];
    }

    // Grouping
    const extendsByClass = new Map<number, string[]>();
    for (const row of extendsRows) {
      const list = extendsByClass.get(row.class_id) ?? [];
      list.push(row.base_class);
      extendsByClass.set(row.class_id, list);
    }

    const modsByComp = new Map<number, ModifierRow[]>();
    for (const row of modifiersRows) {
      const list = modsByComp.get(row.component_id) ?? [];
      list.push(row);
      modsByComp.set(row.component_id, list);
    }

    const compsByClass = new Map<number, ComponentRow[]>();
    for (const row of componentsRows) {
      const list = compsByClass.get(row.class_id) ?? [];
      list.push(row);
      compsByClass.set(row.class_id, list);
    }

    // Generate Quads and emit them
    const emit = (s: string, p: string, o: Term) => {
      // Apply exact bounds filtering
      if (sValue && sValue !== s) return;
      if (pValue && pValue !== p) return;
      if (oValue && object && !o.equals(object)) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stream.push(quad(namedNode(s), namedNode(p), o as any));
    };

    const emitUri = (s: string, p: string, oStr: string) => emit(s, p, namedNode(oStr));
    const emitLit = (s: string, p: string, oStr: string) => emit(s, p, literal(oStr));

    for (const cls of classes) {
      const classUri = `${this.#libPrefix}${cls.class_name}`;
      emitUri(classUri, `${NS}type`, `${NS}Class`);
      emitLit(classUri, `${NS}className`, cls.class_name);
      emitLit(classUri, `${NS}classKind`, cls.class_kind);
      if (cls.description) {
        emitLit(classUri, `${NS}description`, cls.description);
      }

      const bases = extendsByClass.get(cls.id) || [];
      for (const base of bases) {
        emitUri(classUri, `${NS}extends`, `${this.#libPrefix}${base}`);
      }

      const comps = compsByClass.get(cls.id) || [];
      for (const comp of comps) {
        const compUri = `${classUri}.${comp.component_name}`;
        emitUri(classUri, `${NS}hasComponent`, compUri);
        emitUri(compUri, `${NS}type`, `${NS}Component`);
        emitLit(compUri, `${NS}componentName`, comp.component_name);
        emitLit(compUri, `${NS}typeName`, comp.type_name);
        if (comp.description) {
          emitLit(compUri, `${NS}description`, comp.description);
        }
        if (comp.causality) {
          emitLit(compUri, `${NS}causality`, comp.causality);
        }
        if (comp.variability) {
          emitLit(compUri, `${NS}variability`, comp.variability);
        }

        const mods = modsByComp.get(comp.id) || [];
        for (const mod of mods) {
          const modUri = `${compUri}.${mod.modifier_name}`;
          emitUri(compUri, `${NS}hasModifier`, modUri);
          emitUri(modUri, `${NS}type`, `${NS}Modifier`);
          emitLit(modUri, `${NS}modifierName`, mod.modifier_name);
          if (mod.modifier_value !== null) {
            emitLit(modUri, `${NS}modifierValue`, mod.modifier_value);
          }
        }
      }
    }
  }
}

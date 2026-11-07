// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Literal, NamedNode, Quad, Source, Term } from "@rdfjs/types";
import type { Database } from "better-sqlite3";
import { DataFactory } from "n3";
import { Readable } from "node:stream";
import type { ClassRow, ComponentRow, ModifierRow } from "./database.js";

const { namedNode, literal, quad } = DataFactory;

const NS = "https://modelica.org/ontology#";

/**
 * An RDF/JS Source that executes bulk JOIN SQLite queries once per source instance
 * and serves triple pattern matches from indexed quads without hitting SQLite variable limits.
 */
export class SqliteRdfSource implements Source {
  readonly #db: Database;
  readonly #libraryName: string;
  readonly #libraryVersion: string;
  readonly #libPrefix: string;
  #allQuads: Quad[] | null = null;
  #bySubject: Map<string, Quad[]> | null = null;
  #byPredicate: Map<string, Quad[]> | null = null;

  constructor(db: Database, libraryName: string, libraryVersion: string) {
    this.#db = db;
    this.#libraryName = libraryName;
    this.#libraryVersion = libraryVersion;
    this.#libPrefix = `urn:modelica:${libraryName}:${libraryVersion}:`;
  }

  /**
   * Comunica uses this to retrieve matching quads.
   */
  match(subject?: Term | null, predicate?: Term | null, object?: Term | null): Readable {
    const stream = new Readable({
      objectMode: true,
      read() {},
    });

    setImmediate(() => {
      try {
        this.#executeMatch(stream, subject, predicate, object);
        stream.push(null);
      } catch (err) {
        stream.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    });

    return stream;
  }

  #ensureLoaded(): void {
    if (this.#allQuads !== null) {
      return;
    }

    const allQuads: Quad[] = [];
    const bySubject = new Map<string, Quad[]>();
    const byPredicate = new Map<string, Quad[]>();

    const classes = this.#db
      .prepare(
        `SELECT id, class_name, class_kind, description
         FROM classes
         WHERE library_name = ? AND library_version = ?`,
      )
      .all(this.#libraryName, this.#libraryVersion) as ClassRow[];

    if (classes.length === 0) {
      this.#allQuads = allQuads;
      this.#bySubject = bySubject;
      this.#byPredicate = byPredicate;
      return;
    }

    const extendsRows = this.#db
      .prepare(
        `SELECT e.class_id, e.base_class
         FROM extends e
         JOIN classes c ON c.id = e.class_id
         WHERE c.library_name = ? AND c.library_version = ?`,
      )
      .all(this.#libraryName, this.#libraryVersion) as { class_id: number; base_class: string }[];

    const componentsRows = this.#db
      .prepare(
        `SELECT comp.id, comp.class_id, comp.component_name, comp.type_name, comp.description, comp.causality, comp.variability
         FROM components comp
         JOIN classes c ON c.id = comp.class_id
         WHERE c.library_name = ? AND c.library_version = ?`,
      )
      .all(this.#libraryName, this.#libraryVersion) as ComponentRow[];

    const modifiersRows = this.#db
      .prepare(
        `SELECT m.component_id, m.modifier_name, m.modifier_value
         FROM modifiers m
         JOIN components comp ON comp.id = m.component_id
         JOIN classes c ON c.id = comp.class_id
         WHERE c.library_name = ? AND c.library_version = ?`,
      )
      .all(this.#libraryName, this.#libraryVersion) as ModifierRow[];

    const extendsByClass = new Map<number, string[]>();
    for (const row of extendsRows) {
      const list = extendsByClass.get(row.class_id);
      if (list) list.push(row.base_class);
      else extendsByClass.set(row.class_id, [row.base_class]);
    }

    const modsByComp = new Map<number, ModifierRow[]>();
    for (const row of modifiersRows) {
      const list = modsByComp.get(row.component_id);
      if (list) list.push(row);
      else modsByComp.set(row.component_id, [row]);
    }

    const compsByClass = new Map<number, ComponentRow[]>();
    for (const row of componentsRows) {
      const list = compsByClass.get(row.class_id);
      if (list) list.push(row);
      else compsByClass.set(row.class_id, [row]);
    }

    const addQuad = (s: string, p: string, o: NamedNode | Literal) => {
      const q = quad(namedNode(s), namedNode(p), o);
      allQuads.push(q);
      const sList = bySubject.get(s);
      if (sList) sList.push(q);
      else bySubject.set(s, [q]);
      const pList = byPredicate.get(p);
      if (pList) pList.push(q);
      else byPredicate.set(p, [q]);
    };

    const emitUri = (s: string, p: string, oStr: string) => addQuad(s, p, namedNode(oStr));
    const emitLit = (s: string, p: string, oStr: string) => addQuad(s, p, literal(oStr));

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

    this.#allQuads = allQuads;
    this.#bySubject = bySubject;
    this.#byPredicate = byPredicate;
  }

  #executeMatch(stream: Readable, subject?: Term | null, predicate?: Term | null, object?: Term | null): void {
    this.#ensureLoaded();

    const sValue = subject?.value;
    const pValue = predicate?.value;
    const oValue = object?.value;

    let candidates: Quad[];
    if (sValue) {
      candidates = this.#bySubject?.get(sValue) ?? [];
    } else if (pValue) {
      candidates = this.#byPredicate?.get(pValue) ?? [];
    } else {
      candidates = this.#allQuads ?? [];
    }

    for (const q of candidates) {
      if (sValue && q.subject.value !== sValue) continue;
      if (pValue && q.predicate.value !== pValue) continue;
      if (oValue && object && !q.object.equals(object)) continue;
      stream.push(q);
    }
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Memo, QueryCacheStore, SymbolEntry } from "@modelscript/runtime";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";

let sqlPromise: Promise<any> | null = null;
function getSqlInstance(): Promise<any> {
  if (!sqlPromise) {
    let wasmBinary: ArrayBuffer | undefined;
    try {
      if (typeof process !== "undefined" && process.versions?.node) {
        const req = createRequire(import.meta.url);
        const wasmPath = req.resolve("sql.js/dist/sql-wasm.wasm");
        const fs = req("node:fs");
        const buf: Buffer = fs.readFileSync(wasmPath);
        const copy = new Uint8Array(buf.length);
        copy.set(buf);
        wasmBinary = copy.buffer;
      }
    } catch {
      // Fallback for browser or non-Node environments
    }

    sqlPromise = initSqlJs({
      wasmBinary,
      locateFile: (file: string) => {
        const base = (globalThis as any).serverDistBase;
        if (base) {
          return `${base}/${file}`;
        }
        return file;
      },
    });
  }
  return sqlPromise;
}

export async function ingestSalsaIndex(
  buffer: ArrayBuffer,
  cacheStore: QueryCacheStore,
  queryEngine?: any,
): Promise<{ symbols: number; memos: number }> {
  const SQL = await getSqlInstance();

  const db = new SQL.Database(new Uint8Array(buffer));

  try {
    // Check schema version
    const metaRows = db.exec("SELECT value FROM meta WHERE key = 'schema_version'");
    const version = metaRows.length > 0 && metaRows[0].values.length > 0 ? metaRows[0].values[0][0] : null;
    if (version !== "1") {
      throw new Error(`Unsupported salsa-index schema version: ${version}`);
    }

    // Stream symbols into queryEngine.index
    let symbolCount = 0;
    const symbolRows = db.exec("SELECT id, data FROM symbols");
    if (symbolRows.length > 0 && queryEngine?.index?.symbols) {
      for (const row of symbolRows[0].values) {
        try {
          const id = Number(row[0]);
          const entry = JSON.parse(row[1] as string) as SymbolEntry;
          queryEngine.index.symbols.set(id, entry);

          if (entry.name && queryEngine.index.byName) {
            const existing = queryEngine.index.byName.get(entry.name) || [];
            if (!existing.includes(id)) {
              existing.push(id);
              queryEngine.index.byName.set(entry.name, existing);
            }
          }

          if (queryEngine.index.childrenOf) {
            const parentKey = entry.parentId ?? null;
            const siblings = queryEngine.index.childrenOf.get(parentKey) || [];
            if (!siblings.includes(id)) {
              siblings.push(id);
              queryEngine.index.childrenOf.set(parentKey, siblings);
            }
          }
          symbolCount++;
        } catch {
          // Ignore malformed symbol entry
        }
      }
    }

    // Stream memos into cache store
    const memoRows = db.exec("SELECT key, data FROM memos");
    const memos = new Map<number, Memo>();
    if (memoRows.length > 0) {
      for (const row of memoRows[0].values) {
        try {
          const key = Number(row[0]);
          const data = JSON.parse(row[1] as string) as Memo;
          memos.set(key, data);
        } catch {
          // Ignore malformed memos
        }
      }
      await cacheStore.setMemos(memos);
      if (queryEngine && typeof queryEngine.hydrateMemos === "function") {
        queryEngine.hydrateMemos(memos);
      }
    }

    return { symbols: symbolCount, memos: memos.size };
  } finally {
    db.close();
  }
}

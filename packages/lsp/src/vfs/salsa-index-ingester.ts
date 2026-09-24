import type { Memo, QueryCacheStore } from "@modelscript/runtime";
import initSqlJs from "sql.js";

let sqlPromise: Promise<any> | null = null;
function getSqlInstance(): Promise<any> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
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

    return { symbols: 0, memos: memos.size };
  } finally {
    db.close();
  }
}

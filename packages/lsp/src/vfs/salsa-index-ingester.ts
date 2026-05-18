import type { QueryCacheStore } from "@modelscript/compiler";
import type { Memo } from "@modelscript/compiler/runtime";
import initSqlJs from "sql.js";

export async function ingestSalsaIndex(
  buffer: ArrayBuffer,
  cacheStore: QueryCacheStore,
): Promise<{ symbols: number; memos: number }> {
  // sql.js needs to know where the wasm file is. For a webpack build,
  // we usually rely on the default behavior or copy it manually.
  // For now we assume the default works or the caller provides the correct locateFile.
  const SQL = await initSqlJs({
    // We'll leave locateFile out to try the default for now,
    // which usually looks for 'sql-wasm.wasm' in the same dir.
  });

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
    const memos = new Map<string, Memo>();
    if (memoRows.length > 0) {
      for (const row of memoRows[0].values) {
        try {
          const key = row[0] as string;
          const data = JSON.parse(row[1] as string) as Memo;
          memos.set(key, data);
        } catch {
          // Ignore malformed memos
        }
      }
      await cacheStore.setMemos(memos);
    }

    // Note: If we also wanted to extract `SymbolIndex` from the db, we'd do it here.
    // However, the current federated design fetches the index over the wire or
    // from the federated cache store. For now, we only hydrate memos.

    return { symbols: 0, memos: memos.size };
  } finally {
    db.close();
  }
}

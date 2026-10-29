// SPDX-License-Identifier: AGPL-3.0-or-later

export interface CachedPackageSnapshot {
  packageName: string;
  version: string;
  timestamp: number;
  symbolData: ArrayBuffer;
  manifest?: Record<string, unknown> | undefined;
}

const DB_NAME = "modelscript_cache";
const STORE_NAME = "package_symbols";
const DB_VERSION = 1;

/** 4-byte ASCII magic header: 'M', 'S', 'Y', 'M' (0x4D53594D) */
export const SYMBOL_BIN_MAGIC = 0x4d53594d;
/** Current binary serialization schema version */
export const CURRENT_SCHEMA_VERSION = 1;
/** Header size: 4 bytes magic + 2 bytes schema version + 2 bytes dialect + 4 bytes flags + 4 bytes payload length */
export const HEADER_SIZE_BYTES = 16;

/**
 * Validates that an ArrayBuffer begins with the MSYM magic bytes and matches the expected schema version.
 */
export function validateSymbolBinaryHeader(buffer: ArrayBuffer): {
  valid: boolean;
  schemaVersion?: number;
  dialect?: number;
  reason?: string;
} {
  if (buffer.byteLength < HEADER_SIZE_BYTES) {
    return { valid: false, reason: "Buffer smaller than 16-byte header" };
  }
  const view = new DataView(buffer);
  const magic = view.getUint32(0, false);
  if (magic !== SYMBOL_BIN_MAGIC) {
    return { valid: false, reason: `Invalid magic bytes: 0x${magic.toString(16)} (expected 0x4D53594D)` };
  }
  const version = view.getUint16(4, false);
  if (version !== CURRENT_SCHEMA_VERSION) {
    return {
      valid: false,
      schemaVersion: version,
      reason: `Schema version mismatch: found v${version}, expected v${CURRENT_SCHEMA_VERSION}`,
    };
  }
  const dialect = view.getUint16(6, false);
  return { valid: true, schemaVersion: version, dialect };
}

/**
 * Wraps raw symbol data bytes in a 16-byte MSYM header.
 */
export function wrapWithSymbolBinaryHeader(symbolData: Uint8Array, dialectId = 1): ArrayBuffer {
  const totalLength = HEADER_SIZE_BYTES + symbolData.byteLength;
  const out = new ArrayBuffer(totalLength);
  const view = new DataView(out);
  // Magic: MSYM
  view.setUint32(0, SYMBOL_BIN_MAGIC, false);
  // Version
  view.setUint16(4, CURRENT_SCHEMA_VERSION, false);
  // Dialect (1: Modelica, 2: SysML2, etc.)
  view.setUint16(6, dialectId, false);
  // Flags
  view.setUint32(8, 0, false);
  // Payload length
  view.setUint32(12, symbolData.byteLength, false);

  new Uint8Array(out, HEADER_SIZE_BYTES).set(symbolData);
  return out;
}

/**
 * Lightweight IndexedDB wrapper for persisting serialized pre-baked package symbols (.sym.bin)
 * to achieve sub-15ms rehydration without network requests.
 */
export class PackageRehydrationCache {
  private static dbPromise: Promise<IDBDatabase> | null = null;

  private static getDB(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("IndexedDB is unavailable in this environment"));
    }
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: "key" });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  /**
   * Retrieves a cached package symbol buffer from IndexedDB, validating the binary header.
   * If the header schema version is outdated, automatically flushes the record.
   */
  public static async getPackage(pkgName: string, version: string): Promise<ArrayBuffer | null> {
    try {
      const db = await this.getDB();
      const key = `${pkgName}@${version}`;
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => {
          if (req.result && req.result.symbolData) {
            const buf = req.result.symbolData as ArrayBuffer;
            const validation = validateSymbolBinaryHeader(buf);
            if (validation.valid) {
              resolve(buf);
            } else {
              // Stale schema version or corrupted cache: evict
              console.warn(`[modelscript/embed] Evicting stale package cache for ${key}: ${validation.reason}`);
              store.delete(key);
              resolve(null);
            }
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  /**
   * Stores a package symbol buffer into IndexedDB.
   */
  public static async setPackage(
    pkgName: string,
    version: string,
    symbolData: ArrayBuffer,
    manifest?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const db = await this.getDB();
      const key = `${pkgName}@${version}`;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const record = {
          key,
          packageName: pkgName,
          version,
          timestamp: Date.now(),
          symbolData,
          manifest,
        };
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn("[modelscript/embed] Failed to store package in cache:", e);
    }
  }

  /**
   * Loads a package from cache or streams from local/intranet package API, populating cache on miss.
   */
  public static async loadOrFetch(
    pkgName: string,
    version: string,
    cdnBaseUrl = "/api/v1/packages",
  ): Promise<ArrayBuffer> {
    const cached = await this.getPackage(pkgName, version);
    if (cached) {
      return cached;
    }

    let cleanBaseUrl = cdnBaseUrl;
    while (cleanBaseUrl.endsWith("/")) {
      cleanBaseUrl = cleanBaseUrl.slice(0, -1);
    }
    const url = `${cleanBaseUrl}/${pkgName}/${version}/symbols.bin`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Failed to fetch package ${pkgName}@${version} from ${url} (status: ${resp.status})`);
    }
    const buffer = await resp.arrayBuffer();
    await this.setPackage(pkgName, version, buffer);
    return buffer;
  }
}

const SUPPORTED_REHYDRATION_LANGUAGES = new Set([
  "modelica",
  "sysml2",
  "step",
  "scad",
  "pscad",
  "olga",
  "csv",
  "owl2",
  "gensys",
  "simpack",
  "spice",
  "fmu",
  "ssp",
  "cfd",
  "fea",
  "simulink",
  "urdf",
  "plcopen",
  "opendss",
]);

/**
 * Progressive-enhancement DOM rehydration helper for intranet documentation & wikis.
 * Scans a DOM subtree for static `<pre><code class="language-modelica">...</code></pre>` blocks
 * or `<svg data-modelscript-embed>` placeholders and upgrades them into interactive `<modelscript-morsel>` elements.
 */
export function rehydrateEmbeds(root?: ParentNode, options?: { embedOrigin?: string; view?: string }): number {
  const targetRoot = root ?? (typeof document !== "undefined" ? document : null);
  if (!targetRoot || typeof document === "undefined") return 0;

  let upgraded = 0;

  // 1. Upgrade <pre><code class="language-<dialect>"> blocks with data-modelscript-morsel or matching dialect
  const codeNodes = Array.from(
    targetRoot.querySelectorAll("pre > code[class*='language-'], [data-modelscript-morsel]"),
  );
  for (const node of codeNodes) {
    const el = node as HTMLElement;
    const classAttr = el.getAttribute("class") || "";
    const langMatch = classAttr.match(/language-([a-z0-9_-]+)/i);
    const dialect = (
      el.getAttribute("data-dialect") || (langMatch?.[1] ? langMatch[1].toLowerCase() : "modelica")
    ).toLowerCase();

    if (!el.hasAttribute("data-modelscript-morsel") && !SUPPORTED_REHYDRATION_LANGUAGES.has(dialect)) {
      continue;
    }

    const code = el.getAttribute("data-code") || el.textContent?.trim() || "";
    if (!code) continue;

    const viewer = document.createElement("modelscript-morsel");
    viewer.setAttribute("dialect", dialect);
    viewer.setAttribute("view", el.getAttribute("data-view") || options?.view || "diagram");
    viewer.setAttribute("code", code);
    if (options?.embedOrigin) {
      viewer.setAttribute("origin", options.embedOrigin);
    }
    const anchor = el.getAttribute("data-anchor");
    if (anchor) viewer.setAttribute("anchor", anchor);

    const replaceTarget = el.parentElement?.tagName === "PRE" ? el.parentElement : el;
    replaceTarget.replaceWith(viewer);
    upgraded++;
  }

  // 2. Upgrade static <svg data-modelscript-embed> diagrams
  const svgNodes = Array.from(targetRoot.querySelectorAll("svg[data-modelscript-embed]"));
  for (const svg of svgNodes) {
    const code = svg.getAttribute("data-code") || "";
    const morselId = svg.getAttribute("data-morsel-id") || "";
    const artifactId = svg.getAttribute("data-artifact-id") || "";
    if (!code && !morselId && !artifactId) continue;

    const viewer = document.createElement("modelscript-morsel");
    viewer.setAttribute("dialect", svg.getAttribute("data-dialect") || "modelica");
    viewer.setAttribute("view", svg.getAttribute("data-view") || options?.view || "diagram");
    if (code) viewer.setAttribute("code", code);
    if (morselId) viewer.setAttribute("morsel-id", morselId);
    if (artifactId) viewer.setAttribute("artifact-id", artifactId);
    if (options?.embedOrigin) {
      viewer.setAttribute("origin", options.embedOrigin);
    }
    svg.replaceWith(viewer);
    upgraded++;
  }

  return upgraded;
}

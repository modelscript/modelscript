// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Browser-compatible shim for Node.js `node:url` and `url` built-ins.
 * Prevents Vite's externalization proxy from throwing runtime errors in web client bundles.
 */

export function fileURLToPath(url: string | URL): string {
  if (!url) return "";
  const str = typeof url === "string" ? url : url.href || url.toString();
  if (str.startsWith("file://")) {
    const p = str.slice(7);
    return decodeURIComponent(
      p.startsWith("/") && typeof process !== "undefined" && process?.platform === "win32" ? p.slice(1) : p,
    );
  }
  try {
    const parsed = new URL(str, "http://localhost");
    return decodeURIComponent(parsed.pathname);
  } catch {
    return decodeURIComponent(str);
  }
}

export function pathToFileURL(filepath: string): URL {
  if (!filepath) return new URL("file:///");
  const normalized = filepath.replace(/\\/g, "/");
  const leading = normalized.startsWith("/") ? "" : "/";
  return new URL(`file://${leading}${encodeURI(normalized)}`);
}

export function format(urlObject: URL | { href?: string; toString?: () => string }): string {
  if (!urlObject) return "";
  if (typeof urlObject === "string") return urlObject;
  return urlObject.href || (typeof urlObject.toString === "function" ? urlObject.toString() : "");
}

export function domainToASCII(domain: string): string {
  return domain;
}

export function domainToUnicode(domain: string): string {
  return domain;
}

export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;

const nodeUrlShim = {
  fileURLToPath,
  pathToFileURL,
  format,
  domainToASCII,
  domainToUnicode,
  URL: globalThis.URL,
  URLSearchParams: globalThis.URLSearchParams,
};

export default nodeUrlShim;

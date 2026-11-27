// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Downloads the VS Code Web stable build and extracts it to ./vscode-web/.
// Uses the same mechanism as @vscode/test-web's download.ts.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { get } from "node:https";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";

const QUALITY = "stable";
const DEST = join(import.meta.dirname, "..", "vscode-web");
const COMMIT_SHA_RE = /^[0-9a-f]{7,40}$/i;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;
const MAX_REDIRECTS = 5;

export interface UpdateInfo {
  url: string;
  version: string;
  productVersion?: string;
  sha256hash?: string;
}

export function resolveUpdateUrl(commit?: string, quality: string = QUALITY): string {
  const trimmedCommit = commit?.trim();
  if (trimmedCommit) {
    if (!COMMIT_SHA_RE.test(trimmedCommit)) {
      throw new Error(
        `Invalid VSCODE_WEB_COMMIT '${trimmedCommit}': expected a 7-40 character hexadecimal commit SHA.`,
      );
    }
    return `https://update.code.visualstudio.com/api/versions/commit:${trimmedCommit}/web-standalone/${quality}`;
  }
  return `https://update.code.visualstudio.com/api/update/web-standalone/${quality}/latest`;
}

export function resolveExpectedSha256(info: Pick<UpdateInfo, "sha256hash">, overrideSha256?: string): string {
  const trimmedOverride = overrideSha256?.trim();
  if (trimmedOverride) {
    if (!SHA256_HEX_RE.test(trimmedOverride)) {
      throw new Error(
        `Invalid VSCODE_WEB_SHA256 '${trimmedOverride}': expected a 64-character hexadecimal SHA-256 digest.`,
      );
    }
    return trimmedOverride.toLowerCase();
  }

  const apiHash = info.sha256hash?.trim();
  if (apiHash) {
    if (!SHA256_HEX_RE.test(apiHash)) {
      throw new Error(`Invalid sha256hash '${apiHash}' returned by VS Code update API.`);
    }
    return apiHash.toLowerCase();
  }

  throw new Error(
    "VS Code update metadata did not include sha256hash and VSCODE_WEB_SHA256 is not set; refusing to extract unverified archive.",
  );
}

export function verifySha256(data: Buffer, expectedSha256: string): string {
  const expected = expectedSha256.trim().toLowerCase();
  if (!SHA256_HEX_RE.test(expected)) {
    throw new Error(`Invalid expected SHA-256 digest '${expectedSha256}'.`);
  }
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== expected) {
    throw new Error(`SHA-256 checksum mismatch for VS Code Web tarball: expected ${expected}, got ${actual}.`);
  }
  return actual;
}

async function fetchJSON(url: string): Promise<UpdateInfo> {
  return new Promise((resolvePromise, reject) => {
    const req = get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }
      let data = "";
      res.on("data", (chunk: Buffer | string) => {
        data += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      res.on("end", () => {
        try {
          resolvePromise(JSON.parse(data) as UpdateInfo);
        } catch (err) {
          reject(err);
        }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}

async function downloadBuffer(url: string, redirectsLeft: number = MAX_REDIRECTS): Promise<Buffer> {
  return new Promise<Buffer>((resolvePromise, reject) => {
    const req = get(url, (res) => {
      const status = res.statusCode ?? 0;
      if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
        const redirectUrl = res.headers.location;
        res.resume();
        if (!redirectUrl) {
          reject(new Error(`HTTP ${status} redirect without Location header from ${url}`));
          return;
        }
        if (redirectsLeft <= 0) {
          reject(new Error(`Too many redirects while downloading ${url}`));
          return;
        }
        downloadBuffer(redirectUrl, redirectsLeft - 1).then(resolvePromise, reject);
        return;
      }

      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status} while downloading ${url}`));
        return;
      }

      const total = Number(res.headers["content-length"] || 0);
      const chunks: Buffer[] = [];
      let received = 0;
      let lastPrint = 0;

      res.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        received += chunk.length;
        const now = Date.now();
        if (now - lastPrint > 500) {
          const pct = total > 0 ? ((received / total) * 100).toFixed(1) : "?";
          process.stdout.write(`\r  Downloading: ${(received / 1048576).toFixed(1)} MB (${pct}%)`);
          lastPrint = now;
        }
      });

      res.on("end", () => {
        console.log(`\r  Downloaded ${(received / 1048576).toFixed(1)} MB`);
        resolvePromise(Buffer.concat(chunks, received));
      });
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}

async function downloadAndExtract(url: string, dest: string, expectedSha256: string): Promise<void> {
  // Dynamic import for tar-fs (CommonJS module)
  const tar = await import("tar-fs");

  const tarball = await downloadBuffer(url);
  const verifiedHash = verifySha256(tarball, expectedSha256);
  console.log(`  Verified SHA-256: ${verifiedHash}`);

  mkdirSync(dest, { recursive: true });
  await pipeline(Readable.from([tarball]), createGunzip(), tar.extract(dest, { strip: 1 }));
  console.log(`  Extracted ${(tarball.length / 1048576).toFixed(1)} MB to ${dest}`);
}

function computeInlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html)) !== null) {
    const attrs = match[1] ?? "";
    const content = match[2] ?? "";
    if (/\bsrc\s*=/i.test(attrs) || !content) continue;
    const hash = createHash("sha256").update(content, "utf8").digest("base64");
    hashes.push(`'sha256-${hash}'`);
  }
  return hashes;
}

function patchWorkerIframeHtml(html: string): string {
  // Keep 'unsafe-eval' as required by VS Code's web worker extension host (WASM and dynamic extension code),
  // and replace 'unsafe-inline' (or any outdated Microsoft hash) with the exact SHA-256 hash(es) of the
  // inline <script> block(s) in webWorkerExtensionHostIframe.html.
  const hashes = computeInlineScriptHashes(html);
  const inlineAllow = hashes.length > 0 ? ` ${hashes.join(" ")}` : "";
  return html.replace(
    /script-src 'self' 'unsafe-eval'(?: (?:'unsafe-inline'|'sha256-[A-Za-z0-9+/=]+'))* https: http:\/\/localhost:\*(?: http:\/\/127\.0\.0\.1:\*)? blob:;/g,
    `script-src 'self' 'unsafe-eval'${inlineAllow} https: http://localhost:* http://127.0.0.1:* blob:;`,
  );
}

function patchWebviewPreHtml(html: string): string {
  // Allow same-origin webview hosting (e.g. ansatz.social, modelscript.org, localhost) in addition to wildcard hash subdomains
  let out = html.replace(
    /if \((?:hostname === "localhost" \|\| hostname === "127\.0\.0\.1" \|\| )?(?:location\.origin === parentOrigin \|\| )?hostname === parentOriginHash/g,
    'if (hostname === "localhost" || hostname === "127.0.0.1" || location.origin === parentOrigin || hostname === parentOriginHash',
  );

  // Recompute the SHA-256 CSP hash for the patched inline <script> block instead of weakening to 'unsafe-inline'
  const hashes = computeInlineScriptHashes(out);
  if (hashes.length > 0) {
    out = out.replace(
      /script-src (?:'sha256-[A-Za-z0-9+/=]+'|'unsafe-inline') 'self'(?: https:\/\/static\.cloudflareinsights\.com)?/g,
      `script-src ${hashes.join(" ")} 'self'`,
    );
  }
  return out;
}

function applyPatches(dest: string): void {
  // The web-standalone build includes several extensions that are missing their JS code (dist folder).
  // If left as-is, VS Code throws "Not Found" activation errors.
  // Because VS Code's web workbench embeds extension metadata directly, patching package.json
  // does not prevent it from trying to load these missing files.
  // We fix this by creating stub entry points that export empty activate() functions.
  const extsDir = join(dest, "extensions");
  if (existsSync(extsDir)) {
    const stub = `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.activate = function() {};\nexports.deactivate = function() {};\n`;
    const exts = readdirSync(extsDir);
    for (const ext of exts) {
      const pkgPath = join(extsDir, ext, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

        const createStubIfNeeded = (entryPoint: string | undefined) => {
          if (!entryPoint) return;
          let file = entryPoint;
          if (file.startsWith("./")) file = file.slice(2);
          if (!file.endsWith(".js")) file += ".js";

          const fullPath = join(extsDir, ext, file);
          if (!existsSync(fullPath)) {
            mkdirSync(dirname(fullPath), { recursive: true });
            writeFileSync(fullPath, stub);
          }
        };

        createStubIfNeeded(pkg.browser);
        createStubIfNeeded(pkg.main);
      }
    }
  }

  // Patch the webWorkerExtensionHostIframe.html CSP:
  // Allow http://127.0.0.1:* alongside http://localhost:* and pin the inline <script> block(s)
  // via exact SHA-256 hash(es) instead of 'unsafe-inline'.
  const iframeHtmlPath = join(
    dest,
    "out",
    "vs",
    "workbench",
    "services",
    "extensions",
    "worker",
    "webWorkerExtensionHostIframe.html",
  );
  if (existsSync(iframeHtmlPath)) {
    const html = readFileSync(iframeHtmlPath, "utf8");
    const patched = patchWorkerIframeHtml(html);
    if (patched !== html) {
      writeFileSync(iframeHtmlPath, patched);
      console.log("  Patched webWorkerExtensionHostIframe.html CSP");
    }
  }

  // Patch the webview index.html (and index-no-csp.html if present) CSP & same-origin validation
  for (const fileName of ["index.html", "index-no-csp.html"]) {
    const webviewHtmlPath = join(dest, "out", "vs", "workbench", "contrib", "webview", "browser", "pre", fileName);
    if (existsSync(webviewHtmlPath)) {
      const html = readFileSync(webviewHtmlPath, "utf8");
      const patched = patchWebviewPreHtml(html);
      if (patched !== html) {
        writeFileSync(webviewHtmlPath, patched);
        console.log(`  Patched webview ${fileName} CSP and origin validation`);
      }
    }
  }
}

async function main() {
  if (existsSync(join(DEST, "package.json"))) {
    console.log("VS Code Web already downloaded at", DEST);
    applyPatches(DEST);
    return;
  }

  const pinnedCommit = process.env["VSCODE_WEB_COMMIT"]?.trim() || undefined;
  const sha256Override = process.env["VSCODE_WEB_SHA256"]?.trim() || undefined;
  const updateUrl = resolveUpdateUrl(pinnedCommit, QUALITY);

  if (pinnedCommit) {
    console.log(`Fetching pinned VS Code Web ${QUALITY} build info for commit ${pinnedCommit}...`);
  } else {
    console.log(`Fetching latest VS Code Web ${QUALITY} build info...`);
  }

  const info = await fetchJSON(updateUrl);
  const expectedSha256 = resolveExpectedSha256(info, sha256Override);

  console.log(`  Version: ${info.version}`);
  if (info.productVersion) {
    console.log(`  Product Version: ${info.productVersion}`);
  }
  console.log(`  URL: ${info.url}`);
  console.log(`  Expected SHA-256: ${expectedSha256}`);

  console.log("Downloading, verifying, and extracting...");
  await downloadAndExtract(info.url, DEST, expectedSha256);

  applyPatches(DEST);

  console.log("Done!");
}

const isDirectRun = typeof process.argv[1] === "string" && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((err) => {
    console.error("Failed to download VS Code Web:", err);
    process.exit(1);
  });
}

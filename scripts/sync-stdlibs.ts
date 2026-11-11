#!/usr/bin/env npx tsx
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Polyglot Standard Library Synchronizer.
 *
 * Downloads, verifies, and packages standard libraries declared in
 * packages/exchange/src/catalog/stdlibs.catalog.json across all 44 languages.
 *
 * Usage:
 *   npx tsx scripts/sync-stdlibs.ts --pack=core
 *   npx tsx scripts/sync-stdlibs.ts --pack=all
 *   npx tsx scripts/sync-stdlibs.ts --lang=modelica
 *   npx tsx scripts/sync-stdlibs.ts --verify
 */

import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getStdlibCatalog,
  getStdlibsByPack,
  getStdlibsForLanguage,
  type StdlibEntry,
  type StdlibPackId,
} from "../packages/exchange/src/catalog/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

export interface SyncOptions {
  pack?: StdlibPackId | "all" | undefined;
  lang?: string | undefined;
  outDir?: string | undefined;
  verify?: boolean | undefined;
  force?: boolean | undefined;
  extract?: boolean | undefined;
}

export function computeSha256(filePath: string): string {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

export async function syncLibrary(lib: StdlibEntry, options: SyncOptions = {}): Promise<boolean> {
  const targetDir = options.outDir ? path.resolve(options.outDir) : path.join(repoRoot, "scripts");
  fs.mkdirSync(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, lib.filename);

  console.log(
    `[sync-stdlibs] Synchronizing ${lib.packageName} (${lib.version}) [language: ${lib.language}, pack: ${lib.pack}]...`,
  );

  // 1. If library has local source repository (e.g. languages/sysml2/stdlib)
  if (lib.localSourcePath) {
    const localDir = path.resolve(repoRoot, lib.localSourcePath);
    if (fs.existsSync(localDir) && !fs.existsSync(targetPath)) {
      try {
        console.log(`[sync-stdlibs] Packing from local source: ${localDir}`);
        const tmpExtract = path.join(__dirname, `_pack_${lib.id}`);
        if (fs.existsSync(tmpExtract)) fs.rmSync(tmpExtract, { recursive: true, force: true });
        fs.mkdirSync(tmpExtract, { recursive: true });
        execSync(`cp -r "${localDir}/"* "${tmpExtract}/"`, { stdio: "pipe" });
        execSync(`cd "${tmpExtract}" && zip -q -r "${targetPath}" .`, { stdio: "pipe" });
        fs.rmSync(tmpExtract, { recursive: true, force: true });
        console.log(`[sync-stdlibs] Created local archive: ${targetPath}`);
        return true;
      } catch (err: unknown) {
        console.warn(`[sync-stdlibs] Local packaging failed, trying upstream:`, err);
      }
    }
  }

  // 2. Check if already present
  if (fs.existsSync(targetPath) && !options.force) {
    const stat = fs.statSync(targetPath);
    const sizeMb = (stat.size / 1024 / 1024).toFixed(2);
    console.log(`[sync-stdlibs] ${lib.filename} already present (${sizeMb} MB)`);
    if (options.verify && lib.upstream?.sha256) {
      const actual = computeSha256(targetPath);
      if (actual !== lib.upstream.sha256) {
        console.error(
          `[sync-stdlibs] Checksum mismatch for ${lib.filename}: expected ${lib.upstream.sha256}, got ${actual}`,
        );
        return false;
      }
      console.log(`[sync-stdlibs] SHA-256 verified.`);
    }
    return true;
  }

  // 3. Download from upstream or fallback mirrors
  const urls = [lib.upstream?.url, lib.upstream?.fallbackUrl, ...(lib.upstream?.mirrorUrls || [])].filter(
    Boolean,
  ) as string[];

  if (urls.length === 0) {
    console.log(`[sync-stdlibs] No upstream or mirror URL defined for ${lib.id}; skipping download.`);
    return true;
  }

  const tempDownload = path.join(__dirname, `_download_${lib.id}.tmp`);
  let downloadedSuccessfully = false;

  for (const url of urls) {
    try {
      console.log(`[sync-stdlibs] Downloading ${lib.filename} from ${url}...`);
      if (fs.existsSync(tempDownload)) fs.unlinkSync(tempDownload);

      execSync(`curl -f -L -C - --retry 3 --retry-delay 2 -o "${tempDownload}" "${url}"`, {
        stdio: "inherit",
      });

      if (fs.existsSync(tempDownload) && fs.statSync(tempDownload).size > 100) {
        downloadedSuccessfully = true;
        break;
      }
    } catch {
      console.warn(`[sync-stdlibs] Download failed from ${url}, trying fallback mirror...`);
      if (fs.existsSync(tempDownload)) {
        try {
          fs.unlinkSync(tempDownload);
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (!downloadedSuccessfully) {
    console.error(`[sync-stdlibs] Failed to download ${lib.id} from any candidate URL.`);
    return false;
  }

  try {
    if (lib.upstream?.repack === "sysml-library-only") {
      console.log(`[sync-stdlibs] Extracting and repacking sysml.library only...`);
      const tmpDir = path.join(__dirname, `_extract_${lib.id}`);
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.mkdirSync(tmpDir, { recursive: true });

      try {
        execSync(`unzip -q -o "${tempDownload}" "SysML-v2-Release-2026-03/sysml.library/*.sysml" -d "${tmpDir}"`, {
          stdio: "pipe",
        });
        execSync(`cd "${tmpDir}" && zip -q -r "${targetPath}" .`, { stdio: "pipe" });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        if (fs.existsSync(tempDownload)) fs.unlinkSync(tempDownload);
      }
    } else if (lib.upstream?.repack === "openipsl-only") {
      console.log(`[sync-stdlibs] Extracting and repacking OpenIPSL library only...`);
      const tmpDir = path.join(__dirname, `_extract_${lib.id}`);
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.mkdirSync(tmpDir, { recursive: true });

      try {
        execSync(`unzip -q -o "${tempDownload}" "OpenIPSL-3.1.0/OpenIPSL/*" -d "${tmpDir}"`, {
          stdio: "pipe",
        });
        const openipslDir = path.join(tmpDir, "OpenIPSL-3.1.0", "OpenIPSL");
        const cleanDir = path.join(tmpDir, "OpenIPSL");
        if (fs.existsSync(openipslDir)) {
          fs.renameSync(openipslDir, cleanDir);
          execSync(`cd "${tmpDir}" && zip -q -r "${targetPath}" OpenIPSL`, { stdio: "pipe" });
        } else {
          fs.renameSync(tempDownload, targetPath);
        }
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        if (fs.existsSync(tempDownload)) fs.unlinkSync(tempDownload);
      }
    } else {
      fs.renameSync(tempDownload, targetPath);
    }

    const stat = fs.statSync(targetPath);
    const sizeMb = (stat.size / 1024 / 1024).toFixed(2);
    console.log(`[sync-stdlibs] Downloaded ${lib.filename} (${sizeMb} MB)`);

    if (lib.upstream?.sha256) {
      const actual = computeSha256(targetPath);
      if (actual !== lib.upstream.sha256) {
        console.error(`[sync-stdlibs] Integrity verification failed for ${lib.filename}!`);
        return false;
      }
      console.log(`[sync-stdlibs] Checksum verified: ${actual}`);
    }

    return true;
  } catch (err: unknown) {
    console.error(`[sync-stdlibs] Failed to download ${lib.id}:`, err);
    if (fs.existsSync(tempDownload)) {
      try {
        fs.unlinkSync(tempDownload);
      } catch {
        /* ignore */
      }
    }
    return false;
  }
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let pack: StdlibPackId | "all" = "core";
  let lang: string | undefined;
  let outDir: string | undefined;
  let verify = false;
  let force = false;

  for (const arg of args) {
    if (arg.startsWith("--pack=")) {
      pack = arg.split("=")[1]?.trim() as StdlibPackId | "all";
    } else if (arg.startsWith("--lang=")) {
      lang = arg.split("=")[1]?.trim();
    } else if (arg.startsWith("--outDir=")) {
      outDir = arg.split("=")[1]?.trim();
    } else if (arg === "--verify") {
      verify = true;
    } else if (arg === "--force") {
      force = true;
    }
  }

  const catalog = getStdlibCatalog();
  console.log(`[sync-stdlibs] Polyglot Catalog v${catalog.version} (${catalog.libraries.length} libraries total)`);

  let targets: StdlibEntry[] = [];
  if (lang) {
    targets = getStdlibsForLanguage(lang);
  } else {
    targets = getStdlibsByPack(pack);
  }

  if (targets.length === 0) {
    console.warn(`[sync-stdlibs] No libraries matched pack=${pack} lang=${lang}`);
    process.exit(0);
  }

  console.log(`[sync-stdlibs] Selected ${targets.length} standard libraries for synchronization.`);

  let failures = 0;
  for (const lib of targets) {
    const success = await syncLibrary(lib, { pack, lang, outDir, verify, force });
    if (!success) {
      failures++;
    }
  }

  if (failures > 0) {
    console.error(`[sync-stdlibs] ${failures} standard library synchronization(s) failed.`);
    process.exit(1);
  }

  console.log(`[sync-stdlibs] Standard libraries synchronized successfully.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error("[sync-stdlibs] Fatal error:", err);
    process.exit(1);
  });
}

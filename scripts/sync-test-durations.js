#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Synchronizes scripts/test-durations.json from CTRF test execution reports.
 * Used to maintain empirical per-package execution times for balanced CI sharding.
 *
 * Usage:
 *   node scripts/sync-test-durations.js [--dir=ctrf-artifacts]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const durationsFile = path.resolve(__dirname, "test-durations.json");

function findCtrfFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".git") {
          results.push(...findCtrfFiles(full));
        }
      } else if (entry.isFile() && entry.name.endsWith(".json") && entry.name.includes("ctrf")) {
        results.push(full);
      }
    }
  } catch {}
  return results;
}

export function syncTestDurations(options = {}) {
  let searchDir = options.dir;
  if (!searchDir) {
    for (const candidate of [
      path.join(repoRoot, "ctrf-artifacts"),
      path.join(repoRoot, ".cache", "ci-artifacts"),
      repoRoot,
    ]) {
      if (fs.existsSync(candidate)) {
        searchDir = candidate;
        break;
      }
    }
  }

  const existingDurations = fs.existsSync(durationsFile) ? JSON.parse(fs.readFileSync(durationsFile, "utf8")) : {};

  const files = findCtrfFiles(searchDir);
  let updatedCount = 0;

  for (const file of files) {
    if (file.includes("/node_modules/")) continue;
    if (!file.endsWith("/ctrf-report.json") && !path.basename(file).startsWith("ctrf-modelscript-")) continue;

    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const summary = data.results?.summary || {};
      const duration = summary.stop && summary.start ? summary.stop - summary.start : 0;
      if (duration <= 0) continue;

      let pkgName = null;
      let dirCursor = path.dirname(file);
      while (dirCursor !== repoRoot && dirCursor !== path.dirname(dirCursor)) {
        const pkgJson = path.join(dirCursor, "package.json");
        if (fs.existsSync(pkgJson)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
            if (pkg.name) {
              pkgName = pkg.name;
              break;
            }
          } catch {}
        }
        dirCursor = path.dirname(dirCursor);
      }

      if (!pkgName) {
        // Fallback: try parsing from filename ctrf-modelscript-<pkg>.json
        const match = path.basename(file).match(/^ctrf-modelscript-(.+)\.json$/);
        if (match) {
          pkgName = `@modelscript/${match[1]}`;
        }
      }

      if (pkgName) {
        existingDurations[pkgName] = Math.round((duration / 1000) * 10) / 10;
        updatedCount++;
      }
    } catch {}
  }

  const sortedKeys = Object.keys(existingDurations).sort();
  const sorted = {};
  for (const k of sortedKeys) {
    sorted[k] = existingDurations[k];
  }

  fs.writeFileSync(durationsFile, JSON.stringify(sorted, null, 2) + "\n", "utf8");
  console.log(
    `[sync-test-durations] Updated ${updatedCount} packages in ${path.relative(repoRoot, durationsFile)} (${sortedKeys.length} total entries).`,
  );
  return sorted;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const dirArg = process.argv.find((a) => a.startsWith("--dir="));
  syncTestDurations({ dir: dirArg ? path.resolve(dirArg.split("=")[1]) : undefined });
}

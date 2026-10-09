// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import fs from "node:fs";
import path from "node:path";
import semver from "semver";

export interface PackageFileEntry {
  relPath: string;
  fullPath: string;
  size: number;
}

export const DEFAULT_EXCLUDES = [
  /^\.git(\/|$)/,
  /^node_modules(\/|$)/,
  /^\.env(\..+)?$/,
  /\.(pem|key|pkcs12|pfx|p12)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /^\.DS_Store$/,
  /^Thumbs\.db$/,
  /^\.vscode(\/|$)/,
  /^\.idea(\/|$)/,
  /~$/,
  /\.swp$/,
];

/**
 * Format bytes into human-readable size.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Parses ignore file (such as .modelscriptignore, .npmignore, or .gitignore).
 */
export function parseIgnorePatterns(ignoreFilePath: string): string[] {
  if (!fs.existsSync(ignoreFilePath)) return [];
  const content = fs.readFileSync(ignoreFilePath, "utf-8");
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/**
 * Checks if a relative path matches any ignore pattern or default exclusions.
 */
export function isFileIgnored(relPath: string, customPatterns: string[] = []): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  const basename = path.basename(normalized);

  // 1. Check default regex exclusions
  for (const regex of DEFAULT_EXCLUDES) {
    if (regex.test(normalized) || regex.test(basename)) {
      return true;
    }
  }

  // 2. Check custom ignore patterns
  for (const pattern of customPatterns) {
    const cleanPattern = pattern.replace(/\/$/, "");
    if (cleanPattern.startsWith("*.")) {
      const ext = cleanPattern.slice(1);
      if (normalized.endsWith(ext)) return true;
    } else if (normalized === cleanPattern || normalized.startsWith(`${cleanPattern}/`) || basename === cleanPattern) {
      return true;
    }
  }

  return false;
}

/**
 * Collect all files to be packaged from a directory, applying ignore rules
 * and package.json 'files' whitelist if specified.
 */
export function collectPackageFiles(targetDir: string): PackageFileEntry[] {
  const ignorePatterns: string[] = [];

  // Check for ignore files in order of priority: .modelscriptignore > .npmignore > .gitignore
  const modelscriptIgnore = path.join(targetDir, ".modelscriptignore");
  const npmIgnore = path.join(targetDir, ".npmignore");
  const gitIgnore = path.join(targetDir, ".gitignore");

  if (fs.existsSync(modelscriptIgnore)) {
    ignorePatterns.push(...parseIgnorePatterns(modelscriptIgnore));
  } else if (fs.existsSync(npmIgnore)) {
    ignorePatterns.push(...parseIgnorePatterns(npmIgnore));
  } else if (fs.existsSync(gitIgnore)) {
    ignorePatterns.push(...parseIgnorePatterns(gitIgnore));
  }

  // Check for package.json "files" whitelist
  let filesWhitelist: string[] | null = null;
  const pkgJsonPath = path.join(targetDir, "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
      if (Array.isArray(pkg.files) && pkg.files.length > 0) {
        filesWhitelist = pkg.files.map((f: string) => f.replace(/^\.\//, "").replace(/\/$/, ""));
      }
    } catch {
      // Ignore JSON parse errors here, let main validator catch it
    }
  }

  const results: PackageFileEntry[] = [];

  function walk(currentDir: string, relPrefix = "") {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;

      if (isFileIgnored(relPath, ignorePatterns)) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        // If files whitelist is defined, ensure file matches or is a core root file
        if (filesWhitelist) {
          const isCoreRootFile =
            relPath === "package.json" ||
            relPath === "package.mo" ||
            /^readme(\..+)?$/i.test(relPath) ||
            /^licen[sc]e(\..+)?$/i.test(relPath);

          const matchesWhitelist = filesWhitelist.some(
            (pattern) => relPath === pattern || relPath.startsWith(`${pattern}/`),
          );

          if (!isCoreRootFile && !matchesWhitelist) {
            continue;
          }
        }

        const stat = fs.statSync(fullPath);
        results.push({
          relPath,
          fullPath,
          size: stat.size,
        });
      }
    }
  }

  walk(targetDir);
  return results.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/**
 * Creates an AdmZip archive from collected files.
 */
export function buildPackageZip(files: PackageFileEntry[]): AdmZip {
  const zip = new AdmZip();
  for (const file of files) {
    const content = fs.readFileSync(file.fullPath);
    zip.addFile(file.relPath, content);
  }
  return zip;
}

/**
 * Validates manifest name and version before publishing.
 */
export function validatePackageManifest(
  name: string,
  version: string,
  targetDir?: string,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!name || typeof name !== "string") {
    errors.push("Package name is required");
  } else if (!/^(@[a-zA-Z0-9_-]+\/)?[a-zA-Z0-9_.-]+$/.test(name)) {
    errors.push(`Invalid package name "${name}". Names must be alphanumeric with dashes/underscores.`);
  }

  if (!version || !semver.valid(version)) {
    errors.push(`Invalid semantic version "${version}". Version must follow semver (e.g. 1.0.0).`);
  }

  if (targetDir) {
    const pkgJsonPath = path.join(targetDir, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
      } catch (err) {
        errors.push(`Invalid package.json syntax: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

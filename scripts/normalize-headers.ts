// SPDX-License-Identifier: AGPL-3.0-or-later

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { getTrackedFiles, REPO_ROOT, shouldExcludeRepoPath } from "./lib/workspaces.js";

const __filename = fileURLToPath(import.meta.url);

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".sh", ".py"]);

export interface HeaderStats {
  scanned: number;
  alreadyNormalized: number;
  added: number;
  repositioned: number;
  skippedExcluded: number;
  violations: string[];
}

function normalizeFile(
  fullPath: string,
  relPath: string,
  dryRun: boolean,
  checkOnly: boolean,
  stats: HeaderStats,
): void {
  const content = fs.readFileSync(fullPath, "utf-8");
  const ext = path.extname(fullPath);
  const isHashComment = ext === ".sh" || ext === ".py";
  const normRelPath = relPath.replace(/\\/g, "/");
  const isEnterpriseFile = normRelPath === "ee" || normRelPath.startsWith("ee/");
  const expectedLicenseId = isEnterpriseFile ? "LicenseRef-ModelScript-Enterprise" : "AGPL-3.0-or-later";
  const spdxTag = isHashComment
    ? `# SPDX-License-Identifier: ${expectedLicenseId}`
    : `// SPDX-License-Identifier: ${expectedLicenseId}`;

  const lines = content.split(/\r?\n/);
  const firstLine = lines[0] ?? "";
  const hasShebang = firstLine.startsWith("#!");

  // Check if file already contains SPDX-License-Identifier
  const spdxLineIdx = lines.findIndex((l) => l.includes("SPDX-License-Identifier"));

  if (spdxLineIdx === -1) {
    stats.violations.push(`${relPath} (missing SPDX header: expected ${expectedLicenseId})`);
    if (checkOnly) {
      stats.added++;
      return;
    }
    // Missing SPDX header entirely
    let newContent: string;
    if (hasShebang) {
      const rest = lines.slice(1);
      while (rest.length > 0 && rest[0]!.trim() === "") rest.shift();
      newContent = `${firstLine}\n${spdxTag}\n\n${rest.join("\n")}`;
    } else {
      const cleanLines = [...lines];
      while (cleanLines.length > 0 && cleanLines[0]!.trim() === "") cleanLines.shift();
      newContent = `${spdxTag}\n\n${cleanLines.join("\n")}`;
    }

    if (!dryRun) {
      fs.writeFileSync(fullPath, newContent, "utf-8");
    }
    stats.added++;
    return;
  }

  // Verify position and license identifier match
  const expectedLine = hasShebang ? 1 : 0;
  const existingSpdxLine = lines[spdxLineIdx]!;
  const hasExpectedLicenseId = existingSpdxLine.includes(`SPDX-License-Identifier: ${expectedLicenseId}`);

  if (spdxLineIdx === expectedLine && hasExpectedLicenseId) {
    stats.alreadyNormalized++;
    return;
  }

  if (!hasExpectedLicenseId) {
    stats.violations.push(`${relPath} (wrong SPDX license header '${existingSpdxLine.trim()}', expected '${spdxTag}')`);
  } else {
    // Header is misplaced (e.g. after blank line or imports)
    stats.violations.push(
      `${relPath} (misplaced SPDX header at line ${spdxLineIdx + 1}, expected line ${expectedLine + 1})`,
    );
  }
  if (checkOnly) {
    stats.repositioned++;
    return;
  }

  lines.splice(spdxLineIdx, 1);
  const tagToUse = spdxTag;

  let newContent: string;
  if (hasShebang) {
    const rest = lines.slice(1);
    while (rest.length > 0 && rest[0]!.trim() === "") rest.shift();
    newContent = `${firstLine}\n${tagToUse}\n\n${rest.join("\n")}`;
  } else {
    while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
    newContent = `${tagToUse}\n\n${lines.join("\n")}`;
  }

  if (!dryRun) {
    fs.writeFileSync(fullPath, newContent, "utf-8");
  }
  stats.repositioned++;
}

export function run(targetFilter = "", dryRun = false, checkOnly = false): HeaderStats {
  const trackedFiles = getTrackedFiles();

  const stats: HeaderStats = {
    scanned: 0,
    alreadyNormalized: 0,
    added: 0,
    repositioned: 0,
    skippedExcluded: 0,
    violations: [],
  };

  for (const relPath of trackedFiles) {
    if (targetFilter && !relPath.startsWith(targetFilter)) {
      continue;
    }

    const ext = path.extname(relPath);
    if (!CODE_EXTENSIONS.has(ext)) {
      continue;
    }

    if (shouldExcludeRepoPath(relPath)) {
      stats.skippedExcluded++;
      continue;
    }

    const fullPath = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(fullPath)) {
      continue;
    }
    stats.scanned++;
    normalizeFile(fullPath, relPath, dryRun, checkOnly, stats);
  }

  return stats;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const checkOnly = args.includes("--check");
  const filterArg = args.find((a) => !a.startsWith("--")) ?? "";

  console.log(
    `Starting header normalization (filter: "${filterArg || "ALL"}", dryRun: ${dryRun}, check: ${checkOnly})...`,
  );
  const results = run(filterArg, dryRun, checkOnly);
  console.log(`\nResults:
- Scanned: ${results.scanned}
- Already Normalized: ${results.alreadyNormalized}
- Added Header: ${results.added}
- Repositioned Header: ${results.repositioned}
- Skipped (Excluded): ${results.skippedExcluded}
`);

  if (checkOnly && results.violations.length > 0) {
    console.error(`\nFound ${results.violations.length} header violation(s):`);
    for (const v of results.violations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }
}

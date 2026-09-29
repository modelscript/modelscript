// SPDX-License-Identifier: AGPL-3.0-or-later

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

interface RenamePlan {
  oldPath: string;
  newPath: string;
}

function getTrackedFiles(): string[] {
  return childProcess.execSync("git ls-files", { cwd: REPO_ROOT, encoding: "utf-8" }).split(/\r?\n/).filter(Boolean);
}

export function planRenames(): RenamePlan[] {
  const tracked = getTrackedFiles();
  const plans: RenamePlan[] = [];

  for (const relPath of tracked) {
    if (relPath.startsWith("languages/modelica/testsuite/")) {
      continue; // Strictly preserve upstream fixtures
    }

    const filename = path.basename(relPath);
    const dir = path.dirname(relPath);

    // Target 1: test-*.test.ts or test-*.test.tsx
    if (filename.startsWith("test-") && (filename.endsWith(".test.ts") || filename.endsWith(".test.tsx"))) {
      const newFilename = filename.slice("test-".length);
      const newPath = path.join(dir, newFilename);
      plans.push({ oldPath: relPath, newPath });
      continue;
    }

    // Target 2: specific sysml2 orphaned tests
    if (
      relPath === "languages/sysml2/tests/test-imports-and-stdlib.ts" ||
      relPath === "languages/sysml2/tests/test-reasoner-multiplicity-disjoint.ts" ||
      relPath === "languages/sysml2/tests/test-real-simplex.ts" ||
      relPath === "languages/sysml2/tests/test-temporal-contracts.ts"
    ) {
      const newFilename = filename.slice("test-".length).replace(/\.ts$/, ".test.ts");
      const newPath = path.join(dir, newFilename);
      plans.push({ oldPath: relPath, newPath });
      continue;
    }
  }

  return plans;
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

const plans = planRenames();
console.log(`Found ${plans.length} test files to normalize (dryRun: ${dryRun})...\n`);

let collisions = 0;
for (const p of plans) {
  const targetFullPath = path.join(REPO_ROOT, p.newPath);
  if (fs.existsSync(targetFullPath) && p.oldPath !== p.newPath) {
    console.error(`COLLISION DETECTED: Target ${p.newPath} already exists!`);
    collisions++;
  }
}

if (collisions > 0) {
  console.error(`Aborting due to ${collisions} collision(s).`);
  process.exit(1);
}

for (const p of plans) {
  console.log(`git mv ${p.oldPath} -> ${p.newPath}`);
  if (!dryRun) {
    childProcess.execSync(`git mv "${p.oldPath}" "${p.newPath}"`, {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
  }
}

console.log(`\nSuccessfully normalized ${plans.length} test filenames.`);

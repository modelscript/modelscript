// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Smart Hybrid Release Version & Changelog Orchestrator (`scripts/ci-release-version.ts`).
 *
 * Supports both development workflows seamlessly:
 *   1. Pre-Bumped Workflow: Version is bumped early on `main` via `npm run version:bump -- 0.1.0`,
 *      additional commits land on `main`, and the Release workflow tags & publishes `0.1.0` without
 *      double-bumping.
 *   2. Release-Time Bump Workflow: `main` remains at the last released tag (`vX.Y.Z`) and the
 *      Release workflow bumps the version (`auto` via Conventional Commits, or `patch`/`minor`/`major`),
 *      updates `CHANGELOG.md`, syncs all 73+ workspace manifests, commits, and tags `vX.Y.Z`.
 *
 * Also guarantees idempotency if a release workflow is re-run after a partial network/registry failure.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REPO_ROOT } from "./lib/workspaces.js";
import { syncVersions } from "./sync-versions.js";

const __filename = fileURLToPath(import.meta.url);

function git(args: string[], allowFailure = false): string {
  try {
    return execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    if (allowFailure) return "";
    throw err;
  }
}

function parseSemver(ver: string): [number, number, number] | null {
  const m = ver
    .replace(/^v/, "")
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return a.localeCompare(b);
  if (pa[0] !== pb[0]) return pa[0] - pb[0];
  if (pa[1] !== pb[1]) return pa[1] - pb[1];
  return pa[2] - pb[2];
}

function applyRelativeBump(baseVersion: string, bump: string): string | null {
  const p = parseSemver(baseVersion);
  if (!p) return null;
  if (bump === "major" || bump === "premajor") return `${p[0] + 1}.0.0`;
  if (bump === "minor" || bump === "preminor") return `${p[0]}.${p[1] + 1}.0`;
  if (bump === "patch" || bump === "prepatch") return `${p[0]}.${p[1]}.${p[2] + 1}`;
  return null;
}

function getLatestGitTagVersion(): string | null {
  const tag = git(["describe", "--tags", "--match", "v[0-9]*", "--abbrev=0"], true);
  if (!tag) return null;
  return tag.replace(/^v/, "");
}

function hasChangelogSection(changelogContent: string, version: string): boolean {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^#{1,2}\\s+${escaped}(?:\\s+\\([^)]+\\))?\\s*$`, "m");
  return re.test(changelogContent);
}

function updateChangelogDateHeader(changelogContent: string, version: string, isoDate: string): string {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^(#{1,2})\\s+${escaped}(?:\\s+\\([^)]+\\))?\\s*$`, "m");
  return stripAuthorsSection(changelogContent.replace(re, `$1 ${version} (${isoDate})`));
}

function stripAuthorsSection(changelogContent: string): string {
  return changelogContent.replace(/\n### ❤️ Thank You\n+(?:- [^\n]+\n)*/g, "\n").replace(/\n{3,}/g, "\n\n");
}

function appendNewCommitsSinceChangelogUpdate(
  changelogContent: string,
  version: string,
): {
  content: string;
  addedCount: number;
} {
  const lastChangelogSha = git(["log", "-1", "--format=%H", "--", "CHANGELOG.md"], true);
  if (!lastChangelogSha) return { content: changelogContent, addedCount: 0 };

  const logLines = git(["log", `${lastChangelogSha}..HEAD`, "--no-merges", "--format=%h\t%s"], true);
  if (!logLines) return { content: changelogContent, addedCount: 0 };

  const sectionHeadings: Record<"feat" | "fix" | "perf", string> = {
    feat: "### 🚀 Features",
    fix: "### 🩹 Fixes",
    perf: "### 🔥 Performance",
  };
  const buckets: Record<"feat" | "fix" | "perf", string[]> = {
    feat: [],
    fix: [],
    perf: [],
  };

  let addedCount = 0;
  for (const rawLine of logLines.split("\n")) {
    const [shortHash, subject] = rawLine.split("\t");
    if (!shortHash || !subject) continue;
    if (changelogContent.includes(`(${shortHash})`) || changelogContent.includes(`[${shortHash}]`)) continue;

    const ccMatch = subject.match(/^(feat|fix|perf)(?:\(([^)]+)\))?!?:\s*(.+)$/);
    if (!ccMatch) continue;
    const type = ccMatch[1] as "feat" | "fix" | "perf";
    const scope = ccMatch[2]?.trim();
    const desc = ccMatch[3]?.trim();
    if (!desc) continue;

    const link = `([${shortHash}](https://github.com/modelscript/modelscript/commit/${shortHash}))`;
    const bullet = scope ? `- **${scope}:** ${desc} ${link}` : `- ${desc} ${link}`;
    buckets[type].push(bullet);
    addedCount++;
  }

  if (addedCount === 0) return { content: changelogContent, addedCount: 0 };

  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headerRe = new RegExp(`^#{1,2}\\s+${escaped}(?:\\s+\\([^)]+\\))?\\s*$`, "m");
  const match = headerRe.exec(changelogContent);
  if (!match) return { content: changelogContent, addedCount: 0 };

  const startIdx = match.index + match[0].length;
  const rest = changelogContent.slice(startIdx);
  const nextVerMatch = /^#{1,2}\s+\d+\.\d+\.\d+/m.exec(rest);
  let sectionBody = nextVerMatch ? rest.slice(0, nextVerMatch.index) : rest;
  const remainder = nextVerMatch ? rest.slice(nextVerMatch.index) : "";

  for (const type of ["feat", "fix", "perf"] as const) {
    const items = buckets[type];
    if (items.length === 0) continue;
    const heading = sectionHeadings[type];
    const headingIdx = sectionBody.indexOf(heading);
    if (headingIdx !== -1) {
      const afterHeading = sectionBody.slice(headingIdx + heading.length);
      const nextSubIdx = afterHeading.search(/\n###\s+/);
      if (nextSubIdx !== -1) {
        const block = afterHeading.slice(0, nextSubIdx).trimEnd();
        const afterBlock = afterHeading.slice(nextSubIdx);
        sectionBody =
          sectionBody.slice(0, headingIdx + heading.length) + `${block}\n${items.join("\n")}\n` + afterBlock;
      } else {
        sectionBody = `${sectionBody.trimEnd()}\n${items.join("\n")}\n`;
      }
    } else {
      sectionBody = `${sectionBody.trimEnd()}\n\n${heading}\n\n${items.join("\n")}\n`;
    }
  }

  const nextContent =
    changelogContent.slice(0, startIdx) +
    "\n\n" +
    sectionBody.trim() +
    "\n" +
    (remainder ? `\n${remainder.trimStart()}` : "");

  return { content: nextContent, addedCount };
}

export function extractChangelogSection(changelogContent: string, version: string): string {
  const cleaned = stripAuthorsSection(changelogContent);
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headerRe = new RegExp(`^#{1,2}\\s+${escaped}(?:\\s+\\([^)]+\\))?\\s*$`, "m");
  const match = headerRe.exec(cleaned);
  if (!match) return `Release v${version}`;
  const startIdx = match.index;
  const rest = cleaned.slice(startIdx + match[0].length);
  const nextHeaderMatch = /^#{1,2}\s+\d+\.\d+\.\d+/m.exec(rest);
  const body = nextHeaderMatch ? rest.slice(0, nextHeaderMatch.index) : rest;
  return `${match[0]}\n${body}`.trim() + "\n";
}

function run(): void {
  const dryRun = process.argv.includes("--dry-run");
  const bumpArg =
    process.argv
      .find((a) => a.startsWith("--bump="))
      ?.slice("--bump=".length)
      .trim() ||
    process.argv.slice(2).find((a) => !a.startsWith("-")) ||
    "auto";

  const runtimePkgPath = path.join(REPO_ROOT, "packages", "runtime", "package.json");
  const diskVersion: string = JSON.parse(fs.readFileSync(runtimePkgPath, "utf-8")).version;
  const tagVersion = getLatestGitTagVersion();
  const changelogPath = path.join(REPO_ROOT, "CHANGELOG.md");
  const changelogRaw = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, "utf-8") : "";

  const isPreBumpedOnDisk = !tagVersion || compareSemver(diskVersion, tagVersion) > 0;

  let targetVersion: string | undefined;
  let nxSpecifier: string | undefined;

  if (bumpArg === "current") {
    targetVersion = diskVersion;
  } else if (bumpArg === "auto") {
    if (isPreBumpedOnDisk) {
      targetVersion = diskVersion;
    } else {
      // Let Nx Conventional Commits compute the next version from commits since tagVersion
      nxSpecifier = undefined;
    }
  } else if (parseSemver(bumpArg)) {
    targetVersion = bumpArg.replace(/^v/, "");
  } else if (tagVersion) {
    const computedFromTag = applyRelativeBump(tagVersion, bumpArg);
    if (computedFromTag && isPreBumpedOnDisk && compareSemver(diskVersion, computedFromTag) >= 0) {
      // Already pre-bumped on disk to at least the requested relative bump
      targetVersion = diskVersion;
    } else if (computedFromTag) {
      targetVersion = computedFromTag;
    } else {
      nxSpecifier = bumpArg;
    }
  } else {
    targetVersion = applyRelativeBump(diskVersion, bumpArg) ?? diskVersion;
  }

  console.log(`==> Release Orchestrator`);
  console.log(`    Disk version:   ${diskVersion}`);
  console.log(`    Latest git tag: ${tagVersion ? `v${tagVersion}` : "(none)"}`);
  console.log(`    Requested bump: ${bumpArg}`);
  console.log(`    Target version: ${targetVersion ?? "(auto via Conventional Commits)"}`);

  const todayIso = new Date().toISOString().slice(0, 10);
  const alreadyHasCuratedChangelog = targetVersion ? hasChangelogSection(changelogRaw, targetVersion) : false;

  if (targetVersion && alreadyHasCuratedChangelog) {
    console.log(
      `==> Detected pre-bumped version ${targetVersion} with existing CHANGELOG.md entry. Skipping duplicate Nx bump.`,
    );
    const datedChangelog = updateChangelogDateHeader(changelogRaw, targetVersion, todayIso);
    const { content: updatedChangelog, addedCount } = appendNewCommitsSinceChangelogUpdate(
      datedChangelog,
      targetVersion,
    );
    if (addedCount > 0) {
      console.log(`    Merged ${addedCount} new commit(s) since last CHANGELOG.md update into ## ${targetVersion}.`);
    }
    if (!dryRun) {
      if (updatedChangelog !== changelogRaw) {
        fs.writeFileSync(changelogPath, updatedChangelog, "utf-8");
      }
      syncVersions({ explicitVersion: targetVersion });
      const porcelain = git(["status", "--porcelain"]);
      if (porcelain) {
        git(["add", "-A"]);
        git(["commit", "-m", `chore(release): publish ${targetVersion}`]);
      }
      git(["tag", "-f", "-a", `v${targetVersion}`, "-m", `v${targetVersion}`]);
    } else {
      syncVersions({ checkOnly: true, explicitVersion: targetVersion });
      console.log(`    [dry-run] Would ensure all manifests are at ${targetVersion} and tag v${targetVersion}.`);
    }
  } else {
    const nxArgs = ["nx", "release", "--skip-publish"];
    if (targetVersion) {
      nxArgs.push(targetVersion);
    } else if (nxSpecifier) {
      nxArgs.push(nxSpecifier);
    }
    if (dryRun) {
      nxArgs.push("--dry-run");
    }

    const shimPath = path.join(REPO_ROOT, "scripts", "nx-minimatch-shim.cjs");
    const existingNodeOptions = process.env["NODE_OPTIONS"] || "";
    const nodeOptions = `${existingNodeOptions} --require ${shimPath}`.trim();

    console.log(`==> Running: npx ${nxArgs.join(" ")}`);
    const res = spawnSync("npx", nxArgs, {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: { ...process.env, NODE_OPTIONS: nodeOptions },
    });
    if (res.status !== 0) {
      process.exit(res.status ?? 1);
    }

    if (!dryRun) {
      const synced = syncVersions();
      targetVersion = synced.version;
      const porcelain = git(["status", "--porcelain"]);
      if (porcelain) {
        git(["add", "-A"]);
        const headMsg = git(["log", "-1", "--pretty=%B"]);
        if (headMsg.startsWith("chore(release):")) {
          git(["commit", "--amend", "--no-edit"]);
        } else {
          git(["commit", "-m", `chore(release): publish ${targetVersion}`]);
        }
      }
      git(["tag", "-f", "-a", `v${targetVersion}`, "-m", `v${targetVersion}`]);
    } else {
      targetVersion = targetVersion ?? diskVersion;
    }
  }

  const finalVersion = targetVersion ?? JSON.parse(fs.readFileSync(runtimePkgPath, "utf-8")).version;
  const finalChangelog = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, "utf-8") : "";
  const releaseNotes = extractChangelogSection(finalChangelog, finalVersion);

  const cacheDir = path.join(REPO_ROOT, ".cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const notesPath = path.join(cacheDir, "release-notes.md");
  fs.writeFileSync(notesPath, releaseNotes, "utf-8");

  const githubOutput = process.env["GITHUB_OUTPUT"];
  if (githubOutput) {
    fs.appendFileSync(githubOutput, `version=${finalVersion}\n`, "utf-8");
    fs.appendFileSync(githubOutput, `notes_file=${notesPath}\n`, "utf-8");
  }

  console.log(`✓ Release version ready: v${finalVersion} (notes written to .cache/release-notes.md)`);
}

if (process.argv[1] === __filename) {
  run();
}

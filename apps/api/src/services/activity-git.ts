// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LibraryDatabase } from "../database.js";
import { buildOfflineViewerHtml, gatherUserDataBundle, type UserArchiveBundle } from "./user-archive.js";

export const DEFAULT_ACTIVITY_REPO_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MAX_COLD_HISTORY_COMMITS = 200;

export interface ActivityRepoState {
  schemaVersion: 1;
  userId: number;
  username: string;
  createdAt: number;
  lastAccessedAt: number;
  fingerprint: string;
  commitCount: number;
  postHashes: Record<string, string>;
  libraryPaths: Record<string, string>;
  studyPaths: Record<string, string>;
}

export interface EnsureActivityRepoResult {
  repoPath: string;
  mode: "hit" | "incremental" | "cold";
  fingerprint: string;
}

export interface ActivityRepoStatusInfo {
  cached: boolean;
  repoUrlPath: string;
  aliasUrlPath: string;
  webRepoPath: string;
  webIdePath: string;
  clonePaths: {
    byUsername: string;
    shorthand: string;
  };
  createdAt: string | null;
  lastAccessedAt: string | null;
  expiresAt: string | null;
  ttlRemainingSeconds: number;
  commitCount: number;
  sizeBytes: number;
  postCount: number;
  libraryCount: number;
  studyCount: number;
  fingerprint: string;
}

function getDefaultGitReposBaseDir(database?: LibraryDatabase): string {
  return (
    process.env["GIT_REPOS_DIR"] ||
    path.join(process.env["DATA_DIR"] || database?.dbDir || path.join(process.cwd(), "data"), "git-repos")
  );
}

export function getActivityCacheRoot(baseDir?: string, database?: LibraryDatabase): string {
  const resolvedBase = path.resolve(baseDir || getDefaultGitReposBaseDir(database));
  return path.join(resolvedBase, "_activity_cache");
}

export function getUserActivityRepoDir(userId: number, baseDir?: string, database?: LibraryDatabase): string {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("Invalid userId for activity repository");
  }
  const cacheRoot = getActivityCacheRoot(baseDir, database);
  const userDir = path.resolve(cacheRoot, String(userId), "activity.git");
  if (!userDir.startsWith(cacheRoot + path.sep)) {
    throw new Error("Invalid activity repository path");
  }
  return userDir;
}

function getStateFilePath(repoPath: string): string {
  return path.join(repoPath, "ms-activity-state.json");
}

function sha256(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function sanitizePathSegment(segment: string): string {
  const cleaned = segment
    .trim()
    .replace(/[^a-zA-Z0-9_.@-]/g, "_")
    .replace(/^\.+/, "_");
  if (!cleaned || cleaned.toLowerCase() === ".git") {
    return "_item";
  }
  return cleaned.slice(0, 96);
}

function getLibraryFilePath(name: string, version: string): string {
  const parts = name
    .split("/")
    .filter(Boolean)
    .map((p) => sanitizePathSegment(p));
  const safeNamePath = parts.length > 0 ? parts.join("/") : sanitizePathSegment(name);
  const safeVersion = sanitizePathSegment(version || "0.0.0");
  return `libraries/${safeNamePath}/${safeVersion}.json`;
}

function getStudyFileExtension(study: NonNullable<UserArchiveBundle["studies"]>[number]): string {
  const fmt = (study.format || "").toLowerCase();
  if (fmt === "sedml" || fmt === "sed-ml") return "sedml";
  if (fmt === "ssp-ssv" || fmt === "ssv") return "ssv";
  if (fmt === "dakota") return "dakota";
  if (study.source_code) {
    const trimmed = study.source_code.trim();
    if (trimmed.startsWith("<?xml") || trimmed.includes("<sedML")) return "sedml";
    if (trimmed.startsWith("model ") || trimmed.startsWith("within ")) return "mo";
    return "msx";
  }
  return "json";
}

function getStudyFilePath(study: NonNullable<UserArchiveBundle["studies"]>[number]): string {
  const ext = getStudyFileExtension(study);
  const slug = sanitizePathSegment(study.name.toLowerCase().replace(/\s+/g, "-")).slice(0, 48);
  return `scripts/study-${study.id}-${slug}.${ext}`;
}

function formatStudyFileContent(study: NonNullable<UserArchiveBundle["studies"]>[number], username: string): string {
  if (study.source_code && getStudyFileExtension(study) !== "json") {
    return study.source_code.endsWith("\n") ? study.source_code : `${study.source_code}\n`;
  }
  return (
    JSON.stringify(
      {
        id: study.id,
        name: study.name,
        author: username,
        type: study.type,
        status: study.status,
        startedAt: study.started_at,
        completedAt: study.completed_at ?? null,
      },
      null,
      2,
    ) + "\n"
  );
}

function formatPostMarkdown(post: UserArchiveBundle["posts"][number], username: string): string {
  const lines = [
    "---",
    `id: ${post.id}`,
    `author: "@${username}"`,
    `created_at: "${post.created_at}"`,
    `likes: ${post.like_count ?? 0}`,
    `replies: ${post.reply_count ?? 0}`,
    `reposts: ${post.repost_count ?? 0}`,
    "---",
    "",
    post.content || "",
    "",
  ];
  return lines.join("\n");
}

function formatLibraryJson(lib: UserArchiveBundle["libraries"][number], username: string): string {
  return (
    JSON.stringify(
      {
        name: lib.name,
        version: lib.version,
        publisher: username,
        publishedAt: lib.created_at,
      },
      null,
      2,
    ) + "\n"
  );
}

function normalizeIsoTimestamp(raw?: string | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // SQLite CURRENT_TIMESTAMP format: "YYYY-MM-DD HH:MM:SS" (UTC without trailing Z)
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)) {
    return `${trimmed.replace(" ", "T")}Z`;
  }
  return trimmed;
}

function toUnixSeconds(isoDate?: string | undefined, fallbackSec?: number): number {
  const normalized = normalizeIsoTimestamp(isoDate);
  if (normalized) {
    const ms = Date.parse(normalized);
    if (!Number.isNaN(ms) && ms > 0) {
      return Math.floor(ms / 1000);
    }
  }
  return fallbackSec ?? Math.floor(Date.now() / 1000);
}

function formatYearMonth(isoDate?: string | undefined): string {
  const sec = toUnixSeconds(isoDate);
  const d = new Date(sec * 1000);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function buildTimelineMarkdown(bundle: UserArchiveBundle, brandName: string): string {
  const lines: string[] = [
    `# @${bundle.user.username} — Chronological Activity Timeline`,
    "",
    `> Generated by **${brandName}** (powered by ModelScript).`,
    `> Summary: **${bundle.posts.length}** posts • **${bundle.libraries.length}** package releases • **${(bundle.studies ?? []).length}** engineering studies`,
    "",
  ];

  type Entry = {
    timestampSec: number;
    dateStr: string;
    monthKey: string;
    line: string;
  };

  const entries: Entry[] = [];

  for (const post of bundle.posts) {
    const ts = toUnixSeconds(post.created_at);
    const preview = (post.content || "").replace(/\s+/g, " ").trim().slice(0, 80);
    entries.push({
      timestampSec: ts,
      dateStr: new Date(ts * 1000).toISOString().slice(0, 10),
      monthKey: formatYearMonth(post.created_at),
      line: `- **${new Date(ts * 1000).toISOString().slice(0, 10)}** 📝 [Post #${post.id}](posts/post-${post.id}.md) — ${preview || "_No text_"}`,
    });
  }

  for (const lib of bundle.libraries) {
    const ts = toUnixSeconds(lib.created_at);
    const libPath = getLibraryFilePath(lib.name, lib.version);
    entries.push({
      timestampSec: ts,
      dateStr: new Date(ts * 1000).toISOString().slice(0, 10),
      monthKey: formatYearMonth(lib.created_at),
      line: `- **${new Date(ts * 1000).toISOString().slice(0, 10)}** 📦 [Package \`${lib.name}@${lib.version}\`](${libPath})`,
    });
  }

  for (const study of bundle.studies ?? []) {
    const ts = toUnixSeconds(study.started_at);
    const studyPath = getStudyFilePath(study);
    entries.push({
      timestampSec: ts,
      dateStr: new Date(ts * 1000).toISOString().slice(0, 10),
      monthKey: formatYearMonth(study.started_at),
      line: `- **${new Date(ts * 1000).toISOString().slice(0, 10)}** 🔬 [Study #${study.id}: ${study.name}](${studyPath}) (\`${study.status}\`)`,
    });
  }

  entries.sort((a, b) => b.timestampSec - a.timestampSec);

  if (entries.length === 0) {
    lines.push("_No posts, packages, or studies recorded yet._", "");
    return lines.join("\n");
  }

  let currentMonth = "";
  for (const entry of entries) {
    if (entry.monthKey !== currentMonth) {
      currentMonth = entry.monthKey;
      lines.push(`## ${currentMonth}`, "");
    }
    lines.push(entry.line);
  }
  lines.push("");

  return lines.join("\n");
}

function buildReadmeMarkdown(bundle: UserArchiveBundle, brandName: string): string {
  return `# @${bundle.user.username} — ${brandName} Activity & Data Portability Vault

This is a **read-only, owner-authenticated virtual Git repository** generated by **${brandName}** (powered by ModelScript) pursuant to **GDPR Article 20** and **CCPA § 1798.100** Data Portability rights.

## Repository Structure

- \`TIMELINE.md\` — Chronological index grouped by month with links to every post, package release, and study
- \`index.html\` — Self-contained offline interactive viewer (open in any browser, 0 external network requests)
- \`posts/post-<id>.md\` — Individual Markdown files for every post and reply authored by your account
- \`libraries/<package>/<version>.json\` — Release records for every Modelica / SysML / ModelScript package you published
- \`scripts/study-<id>-<slug>.<ext>\` — Authored simulation studies and scripts (\`.msx\`, \`.mo\`, \`.sedml\`, \`.ssv\`, \`.dakota\`)
- \`data/profile.json\` — Account profile and settings
- \`data/posts.json\` — Combined posts array
- \`data/libraries.json\` — Combined published libraries array
- \`data/studies.json\` — Combined simulation studies and job records
- \`data/bookmarks.json\` — Saved post bookmarks
- \`data/social_graph.json\` — Following and followers lists
- \`data/billing.json\` — Compute credit ledger transactions
- \`data/audit_logs.json\` — Security and compliance audit log history
- \`data/compliance.json\` — Statutory privacy and data portability certificate

## Syncing Updates

Because this repository is read-only, \`git push\` is disabled.
- During an active 24-hour cache window, new posts, edits, and deletions are appended as forward commits so \`git pull\` fast-forwards cleanly.
- After the 24-hour server cache TTL expires (or if you purge your activity cache in Settings), deleted items are permanently erased from server packfiles; sync with:
  \`\`\`bash
  git fetch origin && git reset --hard origin/main
  \`\`\`
`;
}

function buildBaseInitFiles(bundle: UserArchiveBundle, brandName: string): Map<string, string> {
  const files = new Map<string, string>();
  files.set("README.md", buildReadmeMarkdown(bundle, brandName));
  files.set(
    "data/manifest.json",
    JSON.stringify(
      {
        schemaVersion: "1.0.0",
        userId: bundle.user.id,
        username: bundle.user.username,
        regulation: bundle.regulation,
      },
      null,
      2,
    ) + "\n",
  );
  files.set("data/profile.json", JSON.stringify(bundle.user, null, 2) + "\n");
  files.set(
    "data/compliance.json",
    JSON.stringify(
      {
        regulation: "GDPR Article 20 / CCPA Data Portability",
        controller: `${brandName} Platform (powered by ModelScript)`,
        thirdPartyTrackers: "None",
        ipRetention: "Ephemeral in-memory only (Scrubbed)",
      },
      null,
      2,
    ) + "\n",
  );
  return files;
}

function buildSnapshotFiles(bundle: UserArchiveBundle, brandName: string): Map<string, string> {
  const files = buildBaseInitFiles(bundle, brandName);
  files.set("TIMELINE.md", buildTimelineMarkdown(bundle, brandName));
  files.set("index.html", buildOfflineViewerHtml(bundle, brandName));
  files.set("data/posts.json", JSON.stringify(bundle.posts, null, 2) + "\n");
  files.set("data/libraries.json", JSON.stringify(bundle.libraries, null, 2) + "\n");
  files.set("data/studies.json", JSON.stringify(bundle.studies ?? [], null, 2) + "\n");
  files.set("data/billing.json", JSON.stringify(bundle.billingHistory, null, 2) + "\n");
  files.set("data/audit_logs.json", JSON.stringify(bundle.auditHistory, null, 2) + "\n");
  files.set("data/bookmarks.json", JSON.stringify(bundle.bookmarks ?? [], null, 2) + "\n");
  files.set(
    "data/social_graph.json",
    JSON.stringify(
      {
        following: bundle.following ?? [],
        followers: bundle.followers ?? [],
      },
      null,
      2,
    ) + "\n",
  );
  return files;
}

function computeBundleState(bundle: UserArchiveBundle): {
  fingerprint: string;
  postHashes: Record<string, string>;
  libraryPaths: Record<string, string>;
  studyPaths: Record<string, string>;
} {
  const postHashes: Record<string, string> = {};
  const sortedPosts = [...bundle.posts].sort((a, b) => a.id - b.id);
  for (const post of sortedPosts) {
    postHashes[String(post.id)] = sha256(formatPostMarkdown(post, bundle.user.username));
  }

  const libraryPaths: Record<string, string> = {};
  const sortedLibs = [...bundle.libraries].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
  );
  for (const lib of sortedLibs) {
    const key = `${lib.name}@${lib.version}`;
    libraryPaths[key] = getLibraryFilePath(lib.name, lib.version);
  }

  const studyPaths: Record<string, string> = {};
  const sortedStudies = [...(bundle.studies ?? [])].sort((a, b) => a.id - b.id);
  for (const study of sortedStudies) {
    studyPaths[String(study.id)] = getStudyFilePath(study);
  }

  // Exclude gdpr_activity_git_synced and gdpr_activity_git_cache_purged audit entries from fingerprint
  // so read-only git pulls and status checks do not self-invalidate the cache
  const stableAudit = bundle.auditHistory.filter(
    (a) => a.action !== "gdpr_activity_git_synced" && a.action !== "gdpr_activity_git_cache_purged",
  );

  const canonicalPayload = JSON.stringify({
    user: bundle.user,
    postHashes,
    libraries: sortedLibs,
    studies: sortedStudies,
    billingHistory: bundle.billingHistory,
    auditHistory: stableAudit,
    bookmarks: bundle.bookmarks ?? [],
    following: bundle.following ?? [],
    followers: bundle.followers ?? [],
  });

  return {
    fingerprint: sha256(canonicalPayload),
    postHashes,
    libraryPaths,
    studyPaths,
  };
}

function sanitizeGitIdentity(value: string, fallback: string): string {
  const cleaned = value.replace(/[<>\r\n]/g, "").trim();
  return cleaned || fallback;
}

function appendFastImportBlobInline(chunks: Buffer[], filePath: string, content: string): void {
  const dataBuf = Buffer.from(content, "utf-8");
  chunks.push(Buffer.from(`M 100644 inline ${filePath}\ndata ${dataBuf.length}\n`, "utf-8"));
  chunks.push(dataBuf);
  chunks.push(Buffer.from("\n", "utf-8"));
}

function appendFastImportCommitHeader(
  chunks: Buffer[],
  opts: {
    branch: string;
    mark: number;
    fromMark?: number | undefined;
    fromRef?: string | undefined;
    authorName: string;
    authorEmail: string;
    timestampSec: number;
    message: string;
  },
): void {
  const msgBuf = Buffer.from(opts.message, "utf-8");
  const name = sanitizeGitIdentity(opts.authorName, "user");
  const email = sanitizeGitIdentity(opts.authorEmail, "user@modelscript.local");
  chunks.push(
    Buffer.from(
      `commit ${opts.branch}\nmark :${opts.mark}\nauthor ${name} <${email}> ${opts.timestampSec} +0000\ncommitter ${name} <${email}> ${opts.timestampSec} +0000\ndata ${msgBuf.length}\n`,
      "utf-8",
    ),
  );
  chunks.push(msgBuf);
  chunks.push(Buffer.from("\n", "utf-8"));
  if (opts.fromMark !== undefined) {
    chunks.push(Buffer.from(`from :${opts.fromMark}\n`, "utf-8"));
  } else if (opts.fromRef) {
    chunks.push(Buffer.from(`from ${opts.fromRef}\n`, "utf-8"));
  }
}

function buildColdFastImportStream(
  bundle: UserArchiveBundle,
  brandName: string,
): { stream: Buffer; commitCount: number } {
  const chunks: Buffer[] = [];
  const authorName = bundle.user.display_name || bundle.user.username;
  const authorEmail = bundle.user.email || `${bundle.user.username}@modelscript.local`;
  const nowSec = Math.floor(Date.now() / 1000);
  const rawCreatedSec = toUnixSeconds(bundle.user.created_at, nowSec);

  type TimelineEvent =
    | { kind: "post"; timestampSec: number; post: UserArchiveBundle["posts"][number] }
    | { kind: "library"; timestampSec: number; lib: UserArchiveBundle["libraries"][number] }
    | { kind: "study"; timestampSec: number; study: NonNullable<UserArchiveBundle["studies"]>[number] };

  const allEvents: TimelineEvent[] = [
    ...bundle.posts.map((post) => ({
      kind: "post" as const,
      timestampSec: toUnixSeconds(post.created_at, rawCreatedSec),
      post,
    })),
    ...bundle.libraries.map((lib) => ({
      kind: "library" as const,
      timestampSec: toUnixSeconds(lib.created_at, rawCreatedSec),
      lib,
    })),
    ...(bundle.studies ?? []).map((study) => ({
      kind: "study" as const,
      timestampSec: toUnixSeconds(study.started_at, rawCreatedSec),
      study,
    })),
  ];

  // Sort chronologically ascending
  allEvents.sort((a, b) => {
    if (a.timestampSec !== b.timestampSec) return a.timestampSec - b.timestampSec;
    if (a.kind === "post" && b.kind === "post") return a.post.id - b.post.id;
    if (a.kind === "study" && b.kind === "study") return a.study.id - b.study.id;
    return 0;
  });

  const earliestEventSec = allEvents.length > 0 ? allEvents[0]!.timestampSec : rawCreatedSec;
  let lastTimestampSec = Math.min(rawCreatedSec, earliestEventSec);

  const olderEvents =
    allEvents.length > MAX_COLD_HISTORY_COMMITS ? allEvents.slice(0, allEvents.length - MAX_COLD_HISTORY_COMMITS) : [];
  const recentEvents =
    allEvents.length > MAX_COLD_HISTORY_COMMITS
      ? allEvents.slice(allEvents.length - MAX_COLD_HISTORY_COMMITS)
      : allEvents;

  const baseInitFiles = buildBaseInitFiles(bundle, brandName);
  const snapshotFiles = buildSnapshotFiles(bundle, brandName);
  let mark = 1;

  // Commit 1: Initial account base & any older history beyond the recent commit window
  // (If there are no recent events, Commit 1 includes the full snapshot directly)
  appendFastImportCommitHeader(chunks, {
    branch: "refs/heads/main",
    mark,
    authorName,
    authorEmail,
    timestampSec: lastTimestampSec,
    message: `Initialize @${bundle.user.username} activity repository`,
  });

  const initialMap = recentEvents.length === 0 ? snapshotFiles : baseInitFiles;
  for (const [filePath, content] of initialMap.entries()) {
    appendFastImportBlobInline(chunks, filePath, content);
  }

  for (const ev of olderEvents) {
    if (ev.kind === "post") {
      appendFastImportBlobInline(
        chunks,
        `posts/post-${ev.post.id}.md`,
        formatPostMarkdown(ev.post, bundle.user.username),
      );
    } else if (ev.kind === "library") {
      appendFastImportBlobInline(
        chunks,
        getLibraryFilePath(ev.lib.name, ev.lib.version),
        formatLibraryJson(ev.lib, bundle.user.username),
      );
    } else {
      appendFastImportBlobInline(
        chunks,
        getStudyFilePath(ev.study),
        formatStudyFileContent(ev.study, bundle.user.username),
      );
    }
  }

  // Subsequent chronological commits for recent activity (with monotonic non-decreasing timestamps)
  for (let idx = 0; idx < recentEvents.length; idx++) {
    const ev = recentEvents[idx]!;
    const isFinalEvent = idx === recentEvents.length - 1;
    const prevMark = mark;
    mark++;
    lastTimestampSec = Math.max(lastTimestampSec, ev.timestampSec);

    if (ev.kind === "post") {
      const preview = (ev.post.content || "").replace(/\s+/g, " ").trim().slice(0, 60);
      appendFastImportCommitHeader(chunks, {
        branch: "refs/heads/main",
        mark,
        fromMark: prevMark,
        authorName,
        authorEmail,
        timestampSec: lastTimestampSec,
        message: `Post #${ev.post.id}${preview ? `: ${preview}` : ""}`,
      });
      appendFastImportBlobInline(
        chunks,
        `posts/post-${ev.post.id}.md`,
        formatPostMarkdown(ev.post, bundle.user.username),
      );
    } else if (ev.kind === "library") {
      appendFastImportCommitHeader(chunks, {
        branch: "refs/heads/main",
        mark,
        fromMark: prevMark,
        authorName,
        authorEmail,
        timestampSec: lastTimestampSec,
        message: `Publish package ${ev.lib.name}@${ev.lib.version}`,
      });
      appendFastImportBlobInline(
        chunks,
        getLibraryFilePath(ev.lib.name, ev.lib.version),
        formatLibraryJson(ev.lib, bundle.user.username),
      );
    } else {
      appendFastImportCommitHeader(chunks, {
        branch: "refs/heads/main",
        mark,
        fromMark: prevMark,
        authorName,
        authorEmail,
        timestampSec: lastTimestampSec,
        message: `Run engineering study #${ev.study.id}: ${ev.study.name}`,
      });
      appendFastImportBlobInline(
        chunks,
        getStudyFilePath(ev.study),
        formatStudyFileContent(ev.study, bundle.user.username),
      );
    }

    // Attach aggregate data/*.json, TIMELINE.md, and index.html on the final tip commit
    // so earlier commits never leak future posts
    if (isFinalEvent) {
      for (const [filePath, content] of snapshotFiles.entries()) {
        appendFastImportBlobInline(chunks, filePath, content);
      }
    }
  }

  return { stream: Buffer.concat(chunks), commitCount: mark };
}

function buildIncrementalFastImportStream(
  bundle: UserArchiveBundle,
  brandName: string,
  prevState: ActivityRepoState,
  nextState: {
    postHashes: Record<string, string>;
    libraryPaths: Record<string, string>;
    studyPaths: Record<string, string>;
  },
): Buffer {
  const chunks: Buffer[] = [];
  const authorName = bundle.user.display_name || bundle.user.username;
  const authorEmail = bundle.user.email || `${bundle.user.username}@modelscript.local`;
  const nowSec = Math.floor(Date.now() / 1000);

  const addedPosts: number[] = [];
  const editedPosts: number[] = [];
  const deletedPostIds: string[] = [];

  const postMap = new Map<string, UserArchiveBundle["posts"][number]>();
  for (const post of bundle.posts) {
    postMap.set(String(post.id), post);
  }

  for (const [idStr, hash] of Object.entries(nextState.postHashes)) {
    if (!(idStr in prevState.postHashes)) {
      addedPosts.push(Number(idStr));
    } else if (prevState.postHashes[idStr] !== hash) {
      editedPosts.push(Number(idStr));
    }
  }

  for (const oldIdStr of Object.keys(prevState.postHashes)) {
    if (!(oldIdStr in nextState.postHashes)) {
      deletedPostIds.push(oldIdStr);
    }
  }

  const summaryParts: string[] = [];
  if (addedPosts.length > 0) summaryParts.push(`+${addedPosts.length} post(s)`);
  if (editedPosts.length > 0) summaryParts.push(`~${editedPosts.length} edited`);
  if (deletedPostIds.length > 0) summaryParts.push(`-${deletedPostIds.length} deleted`);
  const summary = summaryParts.length > 0 ? summaryParts.join(", ") : "profile/activity metadata update";

  appendFastImportCommitHeader(chunks, {
    branch: "refs/heads/main",
    mark: 1,
    fromRef: "refs/heads/main^0",
    authorName,
    authorEmail,
    timestampSec: nowSec,
    message: `Sync activity (${summary})`,
  });

  // Delete removed posts (forward commit deletion so git pull fast-forwards)
  for (const deletedId of deletedPostIds) {
    chunks.push(Buffer.from(`D posts/post-${deletedId}.md\n`, "utf-8"));
  }

  // Delete any removed library versions
  for (const [libKey, oldPath] of Object.entries(prevState.libraryPaths ?? {})) {
    if (!(libKey in nextState.libraryPaths)) {
      chunks.push(Buffer.from(`D ${oldPath}\n`, "utf-8"));
    }
  }

  // Delete any removed study files
  for (const [studyKey, oldPath] of Object.entries(prevState.studyPaths ?? {})) {
    if (!(studyKey in nextState.studyPaths)) {
      chunks.push(Buffer.from(`D ${oldPath}\n`, "utf-8"));
    }
  }

  // Write added or edited posts
  for (const postId of [...addedPosts, ...editedPosts]) {
    const post = postMap.get(String(postId));
    if (post) {
      appendFastImportBlobInline(chunks, `posts/post-${post.id}.md`, formatPostMarkdown(post, bundle.user.username));
    }
  }

  // Write any new library versions
  for (const lib of bundle.libraries) {
    const key = `${lib.name}@${lib.version}`;
    if (!(key in (prevState.libraryPaths ?? {}))) {
      appendFastImportBlobInline(
        chunks,
        getLibraryFilePath(lib.name, lib.version),
        formatLibraryJson(lib, bundle.user.username),
      );
    }
  }

  // Write any new studies
  for (const study of bundle.studies ?? []) {
    const key = String(study.id);
    if (!(key in (prevState.studyPaths ?? {}))) {
      appendFastImportBlobInline(chunks, getStudyFilePath(study), formatStudyFileContent(study, bundle.user.username));
    }
  }

  // Refresh aggregate data/*.json, TIMELINE.md, and index.html
  const snapshotFiles = buildSnapshotFiles(bundle, brandName);
  for (const [filePath, content] of snapshotFiles.entries()) {
    appendFastImportBlobInline(chunks, filePath, content);
  }

  return Buffer.concat(chunks);
}

function readRepoState(repoPath: string): ActivityRepoState | null {
  const stateFile = getStateFilePath(repoPath);
  if (!fs.existsSync(stateFile) || !fs.existsSync(path.join(repoPath, "HEAD"))) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf-8")) as ActivityRepoState;
    if (parsed && parsed.schemaVersion === 1 && typeof parsed.fingerprint === "string") {
      return parsed;
    }
  } catch {
    // Corrupted state file, force cold rebuild
  }
  return null;
}

function writeRepoState(repoPath: string, state: ActivityRepoState): void {
  fs.writeFileSync(getStateFilePath(repoPath), JSON.stringify(state, null, 2), "utf-8");
}

function computeDirectorySizeBytes(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += computeDirectorySizeBytes(fullPath);
      } else if (entry.isFile()) {
        total += fs.statSync(fullPath).size;
      }
    }
  } catch {}
  return total;
}

/**
 * Ensures the user's read-only bare activity Git repository is up-to-date.
 * - Uses 0ms cache hit when fingerprint matches and repo is within TTL.
 * - Appends a forward commit via `git fast-import` when warm (< 24h TTL) so `git pull` is always fast-forward.
 * - Rebuilds cleanly in an atomic staging directory when cold or expired (> 24h TTL) to purge any deleted blobs.
 */
export function ensureUserActivityRepo(
  database: LibraryDatabase,
  userId: number,
  baseDir?: string,
  ttlMs: number = DEFAULT_ACTIVITY_REPO_TTL_MS,
): EnsureActivityRepoResult {
  const bundle = gatherUserDataBundle(database, userId);
  if (!bundle) {
    throw new Error("User not found");
  }

  const brandName = database.getInstanceSettings().instanceName || "Ansatz";
  const repoPath = getUserActivityRepoDir(userId, baseDir, database);
  const now = Date.now();
  const nextComputed = computeBundleState(bundle);
  const existingState = readRepoState(repoPath);

  const isWarm =
    existingState !== null && now - existingState.lastAccessedAt <= ttlMs && now - existingState.createdAt <= ttlMs;

  if (isWarm && existingState) {
    if (existingState.fingerprint === nextComputed.fingerprint) {
      existingState.lastAccessedAt = now;
      writeRepoState(repoPath, existingState);
      return {
        repoPath,
        mode: "hit",
        fingerprint: nextComputed.fingerprint,
      };
    }

    // Warm Incremental Delta: append a single forward commit onto refs/heads/main
    try {
      const deltaStream = buildIncrementalFastImportStream(bundle, brandName, existingState, nextComputed);
      execFileSync("git", ["-C", repoPath, "fast-import", "--quiet"], {
        input: deltaStream,
      });

      const updatedState: ActivityRepoState = {
        schemaVersion: 1,
        userId,
        username: bundle.user.username,
        createdAt: existingState.createdAt,
        lastAccessedAt: now,
        fingerprint: nextComputed.fingerprint,
        commitCount: (existingState.commitCount || 1) + 1,
        postHashes: nextComputed.postHashes,
        libraryPaths: nextComputed.libraryPaths,
        studyPaths: nextComputed.studyPaths,
      };
      writeRepoState(repoPath, updatedState);

      return {
        repoPath,
        mode: "incremental",
        fingerprint: nextComputed.fingerprint,
      };
    } catch {
      // Fallback to clean cold build if incremental fast-import fails
    }
  }

  // Atomic Cold Build: build in a staging directory first, then swap into repoPath
  const parentDir = path.dirname(repoPath);
  fs.mkdirSync(parentDir, { recursive: true });
  const stagingPath = path.join(
    parentDir,
    `activity.git.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}`,
  );

  try {
    fs.mkdirSync(stagingPath, { recursive: true });
    execFileSync("git", ["init", "--bare", stagingPath]);
    execFileSync("git", ["-C", stagingPath, "symbolic-ref", "HEAD", "refs/heads/main"]);
    execFileSync("git", ["-C", stagingPath, "config", "http.receivepack", "false"]);
    execFileSync("git", ["-C", stagingPath, "config", "uploadpack.allowFilter", "true"]);

    const { stream: coldStream, commitCount } = buildColdFastImportStream(bundle, brandName);
    execFileSync("git", ["-C", stagingPath, "fast-import", "--quiet"], {
      input: coldStream,
    });

    const newState: ActivityRepoState = {
      schemaVersion: 1,
      userId,
      username: bundle.user.username,
      createdAt: now,
      lastAccessedAt: now,
      fingerprint: nextComputed.fingerprint,
      commitCount,
      postHashes: nextComputed.postHashes,
      libraryPaths: nextComputed.libraryPaths,
      studyPaths: nextComputed.studyPaths,
    };
    writeRepoState(stagingPath, newState);

    if (fs.existsSync(repoPath)) {
      const oldBackupPath = `${stagingPath}.old`;
      try {
        fs.renameSync(repoPath, oldBackupPath);
        fs.renameSync(stagingPath, repoPath);
        fs.rmSync(oldBackupPath, { recursive: true, force: true });
      } catch {
        fs.rmSync(repoPath, { recursive: true, force: true });
        fs.renameSync(stagingPath, repoPath);
      }
    } else {
      fs.renameSync(stagingPath, repoPath);
    }
  } finally {
    if (fs.existsSync(stagingPath)) {
      try {
        fs.rmSync(stagingPath, { recursive: true, force: true });
      } catch {}
    }
    if (fs.existsSync(`${stagingPath}.old`)) {
      try {
        fs.rmSync(`${stagingPath}.old`, { recursive: true, force: true });
      } catch {}
    }
  }

  return {
    repoPath,
    mode: "cold",
    fingerprint: nextComputed.fingerprint,
  };
}

/**
 * Used during `POST /git-upload-pack` pack negotiation:
 * If the bare repository was already materialized during `GET /info/refs`, serves that exact
 * repository state without risking a mid-negotiation cold rebuild across the 24h TTL boundary.
 */
export function getExistingOrEnsureUserActivityRepo(
  database: LibraryDatabase,
  userId: number,
  baseDir?: string,
  ttlMs: number = DEFAULT_ACTIVITY_REPO_TTL_MS,
): EnsureActivityRepoResult {
  const repoPath = getUserActivityRepoDir(userId, baseDir, database);
  const existingState = readRepoState(repoPath);
  if (existingState) {
    existingState.lastAccessedAt = Date.now();
    writeRepoState(repoPath, existingState);
    return {
      repoPath,
      mode: "hit",
      fingerprint: existingState.fingerprint,
    };
  }
  return ensureUserActivityRepo(database, userId, baseDir, ttlMs);
}

/**
 * Returns live status and cache telemetry for a user's virtual activity Git repository.
 */
export function getUserActivityRepoStatus(
  database: LibraryDatabase,
  userId: number,
  baseDir?: string,
  ttlMs: number = DEFAULT_ACTIVITY_REPO_TTL_MS,
): ActivityRepoStatusInfo {
  const bundle = gatherUserDataBundle(database, userId);
  if (!bundle) {
    throw new Error("User not found");
  }

  const repoPath = getUserActivityRepoDir(userId, baseDir, database);
  const state = readRepoState(repoPath);
  const now = Date.now();
  const computed = computeBundleState(bundle);
  const repoUrlPath = `/git/${bundle.user.username}/activity.git`;
  const aliasUrlPath = `/git/me/activity.git`;

  const isWarm = state !== null && now - state.lastAccessedAt <= ttlMs && now - state.createdAt <= ttlMs;

  if (isWarm && state) {
    const expiresAtMs = Math.min(state.createdAt + ttlMs, state.lastAccessedAt + ttlMs);
    const ttlRemainingSeconds = Math.max(0, Math.ceil((expiresAtMs - now) / 1000));
    return {
      cached: true,
      repoUrlPath,
      aliasUrlPath,
      webRepoPath: `/repos/local/${bundle.user.username}/activity`,
      webIdePath: `/repos/local/${bundle.user.username}/activity/ide?ref=main`,
      clonePaths: {
        byUsername: repoUrlPath,
        shorthand: aliasUrlPath,
      },
      createdAt: new Date(state.createdAt).toISOString(),
      lastAccessedAt: new Date(state.lastAccessedAt).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      ttlRemainingSeconds,
      commitCount: state.commitCount || 1,
      sizeBytes: computeDirectorySizeBytes(repoPath),
      postCount: bundle.posts.length,
      libraryCount: bundle.libraries.length,
      studyCount: (bundle.studies ?? []).length,
      fingerprint: computed.fingerprint,
    };
  }

  const estimatedCommits =
    1 +
    Math.min(MAX_COLD_HISTORY_COMMITS, bundle.posts.length + bundle.libraries.length + (bundle.studies ?? []).length);

  return {
    cached: false,
    repoUrlPath,
    aliasUrlPath,
    webRepoPath: `/repos/local/${bundle.user.username}/activity`,
    webIdePath: `/repos/local/${bundle.user.username}/activity/ide?ref=main`,
    clonePaths: {
      byUsername: repoUrlPath,
      shorthand: aliasUrlPath,
    },
    createdAt: null,
    lastAccessedAt: null,
    expiresAt: null,
    ttlRemainingSeconds: 0,
    commitCount: estimatedCommits,
    sizeBytes: 0,
    postCount: bundle.posts.length,
    libraryCount: bundle.libraries.length,
    studyCount: (bundle.studies ?? []).length,
    fingerprint: computed.fingerprint,
  };
}

/**
 * Immediately erases a user's cached activity Git repository from disk (GDPR Art. 17).
 */
export function purgeUserActivityRepo(userId: number, baseDir?: string, database?: LibraryDatabase): boolean {
  if (!Number.isInteger(userId) || userId <= 0) return false;
  const cacheRoot = getActivityCacheRoot(baseDir, database);
  const userCacheDir = path.resolve(cacheRoot, String(userId));
  if (!userCacheDir.startsWith(cacheRoot + path.sep)) return false;

  if (fs.existsSync(userCacheDir)) {
    fs.rmSync(userCacheDir, { recursive: true, force: true });
    return true;
  }
  return false;
}

/**
 * Purges all cached activity Git repositories that have exceeded their TTL.
 */
export function cleanupExpiredActivityRepos(
  baseDir?: string,
  ttlMs: number = DEFAULT_ACTIVITY_REPO_TTL_MS,
  database?: LibraryDatabase,
): { removedCount: number } {
  const cacheRoot = getActivityCacheRoot(baseDir, database);
  if (!fs.existsSync(cacheRoot)) {
    return { removedCount: 0 };
  }

  const now = Date.now();
  let removedCount = 0;

  try {
    const entries = fs.readdirSync(cacheRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const userCacheDir = path.join(cacheRoot, entry.name);
      const repoPath = path.join(userCacheDir, "activity.git");
      const state = readRepoState(repoPath);

      const expired = !state || now - state.lastAccessedAt > ttlMs || now - state.createdAt > ttlMs;

      if (expired) {
        try {
          fs.rmSync(userCacheDir, { recursive: true, force: true });
          removedCount++;
        } catch {}
      }
    }
  } catch {}

  return { removedCount };
}

// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shared post discovery, frontmatter parsing, and schema validation for @modelscript/blog.
// Enforces the uniform folder-per-post convention:
//   apps/blog/blog/posts/YYYY-MM-DD-<slug>/index.md

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
export const BLOG_ROOT = path.resolve(here, "../blog");
export const POSTS_ROOT = path.resolve(BLOG_ROOT, "posts");
export const PUBLIC_ROOT = path.resolve(BLOG_ROOT, "public");
export const DIST_ROOT = path.resolve(BLOG_ROOT, ".vitepress/dist");
export const SITE_URL = "https://blog.modelscript.org";

export const POST_DIR_RE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export const TWITTER_MAX_CHARS = 250; // Leaves room for 23-char t.co URL + space inside 280-char limit
export const TWITTER_THREAD_MAX_CHARS = 280;
export const LINKEDIN_MIN_CHARS = 80;
export const LINKEDIN_MAX_CHARS = 3000;
export const LINKEDIN_RECOMMENDED_MAX_CHARS = 1300;

export interface BlogSocialMeta {
  twitter: string;
  twitterThread?: string[];
  linkedin: string;
  hashtags?: string[];
}

export interface BlogPostRecord {
  folderName: string;
  folderDate: string;
  folderSlug: string;
  filePath: string;
  relativePath: string;
  url: string;
  canonicalUrl: string;
  title: string;
  slug: string;
  date: string;
  updated?: string;
  author: string;
  tags: string[];
  description: string;
  ogImage: string;
  ogImageExplicit?: string;
  ogAlt?: string;
  draft: boolean;
  featured: boolean;
  readingTimeMinutes: number;
  wordCount: number;
  social: BlogSocialMeta;
  body: string;
  rawFrontmatter: Record<string, unknown>;
}

export function extractFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    return { data: {}, body: raw };
  }
  const parsed = parseYaml(match[1] ?? "");
  const data =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  return { data, body: match[2] ?? "" };
}

export function computeReadingTime(markdownBody: string): { wordCount: number; readingTimeMinutes: number } {
  const stripped = markdownBody
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/:::[\s\S]*?:::/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_`~[\]()>-]/g, " ")
    .trim();
  const words = stripped ? stripped.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 220));
  return { wordCount, readingTimeMinutes };
}

function normalizeDateString(val: unknown): string {
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === "string") {
    return val.trim().slice(0, 10);
  }
  return "";
}

function normalizeStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.map((item) => String(item).trim()).filter(Boolean);
}

export function discoverPosts(options: { includeDrafts?: boolean } = {}): {
  posts: BlogPostRecord[];
  structureErrors: string[];
} {
  const { includeDrafts = false } = options;
  const posts: BlogPostRecord[] = [];
  const structureErrors: string[] = [];

  if (!fs.existsSync(POSTS_ROOT)) {
    return { posts, structureErrors };
  }

  for (const entry of fs.readdirSync(POSTS_ROOT, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(POSTS_ROOT, entry.name);

    if (!entry.isDirectory()) {
      structureErrors.push(
        `Unexpected file in blog/posts/: "${entry.name}". Posts must use folder-per-post layout: posts/YYYY-MM-DD-<slug>/index.md.`,
      );
      continue;
    }

    const dirMatch = POST_DIR_RE.exec(entry.name);
    if (!dirMatch) {
      structureErrors.push(
        `Invalid post folder name "${entry.name}". Expected "YYYY-MM-DD-<kebab-case-slug>" (e.g. 2026-11-26-my-post).`,
      );
      continue;
    }

    const [, folderDate, folderSlug] = dirMatch;
    const indexPath = path.join(fullPath, "index.md");
    if (!fs.existsSync(indexPath)) {
      structureErrors.push(`Missing index.md in post folder "posts/${entry.name}/".`);
      continue;
    }

    const raw = fs.readFileSync(indexPath, "utf8");
    const { data, body } = extractFrontmatter(raw);
    const { wordCount, readingTimeMinutes } = computeReadingTime(body);

    const slug = typeof data.slug === "string" ? data.slug.trim() : "";
    const date = normalizeDateString(data.date);
    const updated = data.updated ? normalizeDateString(data.updated) : undefined;
    const title = typeof data.title === "string" ? data.title.trim() : "";
    const description = typeof data.description === "string" ? data.description.trim() : "";
    const author = typeof data.author === "string" ? data.author.trim() : "";
    const tags = normalizeStringArray(data.tags);
    const draft = data.draft === true;
    const featured = data.featured === true;

    const rawSocial =
      data.social && typeof data.social === "object" && !Array.isArray(data.social)
        ? (data.social as Record<string, unknown>)
        : {};

    const twitter =
      typeof rawSocial.twitter === "string"
        ? rawSocial.twitter.trim()
        : typeof data.summaryShort === "string"
          ? data.summaryShort.trim()
          : "";
    const linkedin =
      typeof rawSocial.linkedin === "string"
        ? rawSocial.linkedin.trim()
        : typeof data.summaryMedium === "string"
          ? data.summaryMedium.trim()
          : "";
    const twitterThread = normalizeStringArray(rawSocial.twitterThread);
    const hashtags = normalizeStringArray(rawSocial.hashtags);

    const ogImageExplicit = typeof data.ogImage === "string" && data.ogImage.trim() ? data.ogImage.trim() : undefined;
    const effectiveSlug = slug || folderSlug;
    const ogImage = ogImageExplicit || `/og/${effectiveSlug}.png`;
    const ogAlt = typeof data.ogAlt === "string" && data.ogAlt.trim() ? data.ogAlt.trim() : undefined;

    const record: BlogPostRecord = {
      folderName: entry.name,
      folderDate,
      folderSlug,
      filePath: indexPath,
      relativePath: path.relative(BLOG_ROOT, indexPath).replace(/\\/g, "/"),
      url: `/${effectiveSlug}`,
      canonicalUrl: `${SITE_URL}/${effectiveSlug}`,
      title,
      slug,
      date,
      ...(updated ? { updated } : {}),
      author,
      tags,
      description,
      ogImage,
      ...(ogImageExplicit ? { ogImageExplicit } : {}),
      ...(ogAlt ? { ogAlt } : {}),
      draft,
      featured,
      readingTimeMinutes,
      wordCount,
      social: {
        twitter,
        ...(twitterThread.length > 0 ? { twitterThread } : {}),
        linkedin,
        ...(hashtags.length > 0 ? { hashtags } : {}),
      },
      body,
      rawFrontmatter: data,
    };

    if (!includeDrafts && record.draft) continue;
    posts.push(record);
  }

  // Sort newest first, tie-break alphabetically by slug
  posts.sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    return dateCmp !== 0 ? dateCmp : a.slug.localeCompare(b.slug);
  });

  return { posts, structureErrors };
}

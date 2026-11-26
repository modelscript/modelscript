// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContentLoader } from "vitepress";

export interface BlogPostSummary {
  title: string;
  slug: string;
  url: string;
  date: string;
  updated?: string;
  author: string;
  tags: string[];
  description: string;
  ogImage: string;
  featured: boolean;
  readingTimeMinutes: number;
  social: {
    twitter: string;
    linkedin: string;
    hashtags: string[];
  };
}

declare const data: BlogPostSummary[];
export { data };

function normalizeDate(val: unknown): string {
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === "string") {
    return val.trim().slice(0, 10);
  }
  return "";
}

function estimateReadingMinutes(src?: string): number {
  if (!src) return 3;
  const body = src.replace(/^---[\s\S]*?---/, "");
  const cleaned = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/:::[\s\S]*?:::/g, " ")
    .replace(/<[^>]+>/g, " ")
    .trim();
  const words = cleaned ? cleaned.split(/\s+/).filter(Boolean).length : 0;
  return Math.max(1, Math.ceil(words / 220));
}

export default createContentLoader("posts/*/index.md", {
  includeSrc: true,
  transform(rawData): BlogPostSummary[] {
    return rawData
      .filter((page) => page.frontmatter?.draft !== true)
      .map((page) => {
        const fm = page.frontmatter ?? {};
        const urlSlugMatch = /\/posts\/\d{4}-\d{2}-\d{2}-([^/]+)\/?$/.exec(page.url);
        const slug =
          (typeof fm.slug === "string" && fm.slug.trim()) ||
          (urlSlugMatch && urlSlugMatch[1]) ||
          page.url.replace(/^\/|\/$/g, "");
        const date = normalizeDate(fm.date);
        const updated = fm.updated ? normalizeDate(fm.updated) : undefined;
        const rawSocial = fm.social && typeof fm.social === "object" ? (fm.social as Record<string, unknown>) : {};

        return {
          title: String(fm.title || slug),
          slug,
          url: `/${slug}`,
          date,
          ...(updated ? { updated } : {}),
          author: String(fm.author || "modelscript"),
          tags: Array.isArray(fm.tags) ? fm.tags.map((t: unknown) => String(t)) : [],
          description: String(fm.description || ""),
          ogImage:
            typeof fm.ogImage === "string" && fm.ogImage.trim() ? fm.ogImage.trim() : `/og/${slug}.png`,
          featured: fm.featured === true,
          readingTimeMinutes: estimateReadingMinutes(page.src),
          social: {
            twitter: String(rawSocial.twitter || fm.summaryShort || fm.description || ""),
            linkedin: String(rawSocial.linkedin || fm.summaryMedium || fm.description || ""),
            hashtags: Array.isArray(rawSocial.hashtags) ? rawSocial.hashtags.map((h: unknown) => String(h)) : [],
          },
        };
      })
      .sort((a, b) => {
        const cmp = b.date.localeCompare(a.date);
        return cmp !== 0 ? cmp : a.slug.localeCompare(b.slug);
      });
  },
});

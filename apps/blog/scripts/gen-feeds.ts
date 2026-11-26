// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Post-build generator for `apps/blog`:
//   - rss.xml (RSS 2.0)
//   - atom.xml (Atom 1.0)
//   - sitemap.xml
//   - social/<slug>.json & social/index.json (Twitter/X & LinkedIn distribution packs)

import fs from "node:fs";
import path from "node:path";
import { discoverPosts, DIST_ROOT, SITE_URL, type BlogPostRecord } from "./blog-schema.js";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toRfc2822(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toUTCString();
}

function toIsoTimestamp(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toISOString();
}

function buildHashtagSuffix(hashtags?: string[]): string {
  if (!hashtags || hashtags.length === 0) return "";
  return hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
}

function buildSocialPack(post: BlogPostRecord) {
  const twitterUrl = `${post.canonicalUrl}?utm_source=twitter&utm_medium=social`;
  const linkedinUrl = `${post.canonicalUrl}?utm_source=linkedin&utm_medium=social`;
  const ogImageAbsolute = /^https?:\/\//.test(post.ogImage)
    ? post.ogImage
    : `${SITE_URL}/${post.ogImage.replace(/^\/+/, "")}`;
  const hashtagLine = buildHashtagSuffix(post.social.hashtags);

  const twitterPost = `${post.social.twitter}\n\n${post.canonicalUrl}`;
  const linkedinPost = [post.social.linkedin, "", post.canonicalUrl, ...(hashtagLine ? ["", hashtagLine] : [])].join(
    "\n",
  );

  return {
    slug: post.slug,
    title: post.title,
    date: post.date,
    canonicalUrl: post.canonicalUrl,
    ogImage: ogImageAbsolute,
    tags: post.tags,
    twitter: {
      summary: post.social.twitter,
      charCount: post.social.twitter.length,
      readyToPost: twitterPost,
      utmUrl: twitterUrl,
      ...(post.social.twitterThread ? { thread: post.social.twitterThread } : {}),
    },
    linkedin: {
      summary: post.social.linkedin,
      charCount: post.social.linkedin.length,
      readyToPost: linkedinPost,
      utmUrl: linkedinUrl,
      hashtags: post.social.hashtags ?? [],
    },
  };
}

function generateRss(posts: BlogPostRecord[]): string {
  const lastBuild = posts[0] ? toRfc2822(posts[0].updated || posts[0].date) : new Date().toUTCString();
  const items = posts
    .map((p) => {
      const cats = p.tags.map((t) => `      <category>${escapeXml(t)}</category>`).join("\n");
      return `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${escapeXml(p.canonicalUrl)}</link>
      <guid isPermaLink="true">${escapeXml(p.canonicalUrl)}</guid>
      <pubDate>${toRfc2822(p.date)}</pubDate>
      <description>${escapeXml(p.description)}</description>
${cats}
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>ModelScript Engineering Blog</title>
    <link>${SITE_URL}/</link>
    <description>Engineering deep dives on polyglot simulation, WebAssembly compilers, and interactive Ansatz artifacts.</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
}

function generateAtom(posts: BlogPostRecord[]): string {
  const updated = posts[0] ? toIsoTimestamp(posts[0].updated || posts[0].date) : new Date().toISOString();
  const entries = posts
    .map(
      (p) => `  <entry>
    <title>${escapeXml(p.title)}</title>
    <link href="${escapeXml(p.canonicalUrl)}" />
    <id>${escapeXml(p.canonicalUrl)}</id>
    <published>${toIsoTimestamp(p.date)}</published>
    <updated>${toIsoTimestamp(p.updated || p.date)}</updated>
    <summary>${escapeXml(p.description)}</summary>
  </entry>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ModelScript Engineering Blog</title>
  <link href="${SITE_URL}/" />
  <link href="${SITE_URL}/atom.xml" rel="self" />
  <id>${SITE_URL}/</id>
  <updated>${updated}</updated>
${entries}
</feed>
`;
}

function generateSitemap(posts: BlogPostRecord[]): string {
  const urls = [
    `  <url>
    <loc>${SITE_URL}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>`,
    ...posts.map(
      (p) => `  <url>
    <loc>${escapeXml(p.canonicalUrl)}</loc>
    <lastmod>${p.updated || p.date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`,
    ),
  ].join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function main(): void {
  fs.mkdirSync(DIST_ROOT, { recursive: true });
  const { posts } = discoverPosts({ includeDrafts: false });

  fs.writeFileSync(path.join(DIST_ROOT, "rss.xml"), generateRss(posts), "utf8");
  fs.writeFileSync(path.join(DIST_ROOT, "atom.xml"), generateAtom(posts), "utf8");
  fs.writeFileSync(path.join(DIST_ROOT, "sitemap.xml"), generateSitemap(posts), "utf8");

  const socialDir = path.join(DIST_ROOT, "social");
  fs.mkdirSync(socialDir, { recursive: true });

  const packs = posts.map((post) => {
    const pack = buildSocialPack(post);
    fs.writeFileSync(path.join(socialDir, `${post.slug}.json`), `${JSON.stringify(pack, null, 2)}\n`, "utf8");
    return pack;
  });

  fs.writeFileSync(path.join(socialDir, "index.json"), `${JSON.stringify({ posts: packs }, null, 2)}\n`, "utf8");

  console.log(
    `✓ Generated rss.xml, atom.xml, sitemap.xml, and ${packs.length} social distribution pack(s) in ${path.relative(process.cwd(), DIST_ROOT)}.`,
  );
}

main();

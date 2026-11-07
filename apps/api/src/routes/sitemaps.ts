// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dynamic XML Sitemaps & robots.txt Route
 *
 * Implements multi-index dynamic sitemaps for traditional search engines (Google, Bing)
 * and welcomes modern AI bots (Perplexity, ChatGPT, Claude) with llms.txt references.
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";
import { escapeXml } from "../util/og-renderer.js";
import { resolveRequestHost } from "../util/seo-injector.js";

export function sitemapsRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  function getBaseContext(req: Request) {
    const host = escapeXml(resolveRequestHost(req));
    return { host };
  }

  // ── Sitemap Index: /sitemap.xml ──
  router.get("/sitemap.xml", (req: Request, res: Response): void => {
    const { host } = getBaseContext(req);
    const today = new Date().toISOString().split("T")[0];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${host}/sitemaps/packages.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${host}/sitemaps/classes.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${host}/sitemaps/posts.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
</sitemapindex>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(xml);
  });

  // ── Packages Sitemap: /sitemaps/packages.xml ──
  router.get("/sitemaps/packages.xml", (req: Request, res: Response): void => {
    const { host } = getBaseContext(req);
    const packages = database.listPackages();

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${host}/libraries</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
`;

    for (const p of packages) {
      const lastMod = p.modified_at ? p.modified_at.split("T")[0] : new Date().toISOString().split("T")[0];
      xml += `  <url>
    <loc>${host}/package/${escapeXml(p.name)}</loc>
    <lastmod>${lastMod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
`;
    }

    xml += `</urlset>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(xml);
  });

  // ── Classes Sitemap: /sitemaps/classes.xml ──
  router.get("/sitemaps/classes.xml", (req: Request, res: Response): void => {
    const { host } = getBaseContext(req);
    const packages = database.listPackages();
    const today = new Date().toISOString().split("T")[0];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;

    for (const p of packages) {
      const version = p.latest_version || "1.0.0";
      const classes = database.getClasses(p.name, version);
      for (const c of classes) {
        xml += `  <url>
    <loc>${host}/package/${escapeXml(p.name)}/classes/${escapeXml(c.class_name)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
`;
      }
    }

    xml += `</urlset>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=7200");
    res.send(xml);
  });

  // ── Posts Sitemap: /sitemaps/posts.xml ──
  router.get("/sitemaps/posts.xml", (req: Request, res: Response): void => {
    const { host } = getBaseContext(req);
    const posts = database.getExploreTimeline(undefined, 200);

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${host}/explore</loc>
    <changefreq>hourly</changefreq>
    <priority>0.9</priority>
  </url>
`;

    for (const p of posts) {
      const date = p.created_at ? p.created_at.split("T")[0] : new Date().toISOString().split("T")[0];
      xml += `  <url>
    <loc>${host}/posts/${p.id}</loc>
    <lastmod>${date}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
`;
    }

    xml += `</urlset>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=1800");
    res.send(xml);
  });

  // ── Universal robots.txt (supports traditional + AI crawlers) ──
  router.get("/robots.txt", (req: Request, res: Response): void => {
    const { host } = getBaseContext(req);

    const txt = `# robots.txt for Ansatz & ModelScript Engineering Network
User-agent: *
Allow: /
Allow: /api/v1/og/
Allow: /api/v1/oembed
Disallow: /api/
Disallow: /admin
Disallow: /settings
Disallow: /drafts

# Explicit permissions for LLM Answer Engines & Academic Crawlers
User-agent: GPTBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: Amazonbot
Allow: /

# Sitemaps & llms.txt Directory
Sitemap: ${host}/sitemap.xml
LLMs-Txt: ${host}/packages/llms.txt
`;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(txt);
  });

  return router;
}

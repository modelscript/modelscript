// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Server-Side SEO & Head Metadata Injector
 *
 * Dynamically rewrites static SPA index.html to inject page-specific:
 *  - OpenGraph & Twitter Card tags
 *  - Canonical URLs
 *  - oEmbed discovery & Markdown mirror links
 *  - Schema.org JSON-LD (TechArticle, SoftwareSourceCode, BreadcrumbList)
 *  - Semantic crawler-visible content body for traditional search engines
 */

import type { Request } from "express";
import type { LibraryDatabase } from "../database.js";
import { escapeXml, extractPostTitle } from "./og-renderer.js";

export function escapeHtml(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function resolveRequestHost(req: Request, fallback: string = "https://ansatz.social"): string {
  const configuredPublicUrl = process.env["PUBLIC_URL"]?.trim();
  if (configuredPublicUrl && process.env["NODE_ENV"] === "production") {
    return configuredPublicUrl.replace(/\/+$/, "");
  }

  const forwardedProto = req.headers["x-forwarded-proto"];
  const forwardedHost = req.headers["x-forwarded-host"];
  const hostHeader = (forwardedHost || req.headers.host || "").toString().trim();

  // If host is absent or points to local loopback (common in unit tests / ephemeral test runners), use default canonical host
  if (!hostHeader || hostHeader.includes("127.0.0.1") || hostHeader.includes("localhost")) {
    return (configuredPublicUrl || fallback).replace(/\/+$/, "");
  }

  const protocol = forwardedProto || req.protocol || "https";
  const cleanProto = String(protocol).split(",")[0]!.trim().toLowerCase();
  const cleanHost = hostHeader.split(",")[0]!.trim();

  if (
    (cleanProto !== "http" && cleanProto !== "https") ||
    !/^(?:[a-zA-Z0-9.-]+|\[[0-9a-fA-F:]+\])(?::\d{1,5})?$/.test(cleanHost)
  ) {
    return (configuredPublicUrl || fallback).replace(/\/+$/, "");
  }

  return `${cleanProto}://${cleanHost}`;
}

export interface SeoPageMetadata {
  title: string;
  description: string;
  canonicalUrl: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  ogType: "website" | "article" | "profile";
  twitterCard: "summary_large_image" | "summary";
  oembedUrl?: string | undefined;
  markdownUrl?: string | undefined;
  citationTitle?: string | undefined;
  citationAuthor?: string | undefined;
  citationDate?: string | undefined;
  jsonLd?: Record<string, unknown> | undefined;
  prerenderBodyHtml?: string | undefined;
}

export function resolveSeoMetadata(req: Request, database: LibraryDatabase): SeoPageMetadata {
  const settings = database.getInstanceSettings();
  const brandName = settings.instanceName || "Ansatz";
  const host = resolveRequestHost(req);
  const rawPath = String(req.path || "/");
  const path = encodeURI(rawPath).replace(/[<>'"]/g, "");

  // Default fallback metadata
  const defaultMeta: SeoPageMetadata = {
    title: `${brandName} | The Federated Scientific & Engineering Network`,
    description:
      "Simulate, publish, and peer-review executable Modelica, SysML v2, and cyber-physical models directly in your browser.",
    canonicalUrl: `${host}${path}`,
    ogTitle: `${brandName} | The Federated Scientific & Engineering Network`,
    ogDescription:
      "Simulate, publish, and peer-review executable Modelica, SysML v2, and cyber-physical models directly in your browser.",
    ogImage: `${host}/ansatz-social-card.png`,
    ogType: "website",
    twitterCard: "summary_large_image",
    oembedUrl: `${host}/api/v1/oembed?url=${encodeURIComponent(host + path)}&format=json`,
  };

  // 1. Post Detail Route: /posts/:id, /p/:id, /:username/status/:id, /users/:username/status/:id
  const postMatch = path.match(/(?:\/(?:posts|p)\/|(?:\/[^/]+)?\/status\/)(\d+)/);
  if (postMatch && postMatch[1]) {
    const postId = postMatch[1];
    const post = database.getPost(postId);
    if (post && (!post.visibility || post.visibility === "public" || post.visibility === "unlisted")) {
      const author = post.display_name || post.username || `${brandName} Engineer`;
      const title = extractPostTitle(post, `${brandName} Engineering Simulation`);
      const excerpt = post.content
        ? post.content
            .replace(/^#+.*$/gm, "")
            .trim()
            .slice(0, 200)
        : defaultMeta.description;
      const canonical = `${host}/posts/${postId}`;
      const ogImg = `${host}/api/v1/og/post/${postId}.png`;
      const oembed = `${host}/api/v1/oembed?url=${encodeURIComponent(canonical)}&format=json`;
      const markdown = `${host}/posts/${postId}.md`;

      const jsonLd = {
        "@context": "https://schema.org",
        "@type": "TechArticle",
        headline: title,
        description: excerpt,
        author: {
          "@type": "Person",
          name: author,
          url: `${host}/@${post.username || ""}`,
        },
        datePublished: post.created_at || new Date().toISOString(),
        url: canonical,
        image: ogImg,
        publisher: {
          "@type": "Organization",
          name: brandName,
          url: host,
        },
      };

      const prerenderBody = `
        <article>
          <h1>${escapeXml(title)}</h1>
          <p class="author">By <a href="/@${escapeXml(post.username || "")}">${escapeXml(author)}</a> on ${escapeXml(post.created_at || "")}</p>
          <div class="content">${escapeXml(post.content || "")}</div>
          <p><a href="${escapeXml(markdown)}">View raw Markdown representation for AI agents</a></p>
        </article>
      `;

      return {
        title: `${title} | ${brandName}`,
        description: excerpt,
        canonicalUrl: canonical,
        ogTitle: `${title} | ${brandName}`,
        ogDescription: excerpt,
        ogImage: ogImg,
        ogType: "article",
        twitterCard: "summary_large_image",
        oembedUrl: oembed,
        markdownUrl: markdown,
        citationTitle: title,
        citationAuthor: author,
        citationDate: post.created_at || undefined,
        jsonLd,
        prerenderBodyHtml: prerenderBody,
      };
    }
  }

  // 2. Class Detail Route: /packages?/:pkg/classes/:class
  // e.g. /packages/@modelica/Modelica/4.0.0/classes/Modelica.Electrical.Analog.Basic.Resistor
  // or   /package/drone-chassis/classes/Chassis
  const classMatch = path.match(/^\/packages?\/(@[^/]+\/[^/]+|[^/]+)(?:\/(?:v\/)?([^/]+))?\/classes\/([^/]+)/);
  if (classMatch) {
    const fullPkgName = classMatch[1]!;
    const requestedVersion = classMatch[2];
    const className = classMatch[3]!;

    const pkg = database.getPackage(fullPkgName);
    const versions = pkg ? database.getPackageVersions(pkg.id) : [];
    const version =
      requestedVersion || (versions.length > 0 ? versions[versions.length - 1]?.version : "1.0.0") || "1.0.0";
    const cls = database.getClass(fullPkgName, version, className);

    const shortName = className.split(".").pop() ?? className;
    const stereotype = cls?.classKind || "model";
    const desc =
      cls?.description ||
      cls?.documentation?.slice(0, 200) ||
      `${shortName} ${stereotype} specification in ${fullPkgName}.`;
    const canonical = `${host}/package/${fullPkgName}/classes/${className}`;
    const ogImg = `${host}/api/v1/og/class/${fullPkgName}/${version}/${className}.png`;
    const markdown = `${host}/package/${fullPkgName}/classes/${className}.md`;

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "SoftwareSourceCode",
      name: className,
      description: desc,
      programmingLanguage: "Modelica",
      codeRepository: `${host}/package/${fullPkgName}`,
      version: version,
      image: ogImg,
      isPartOf: {
        "@type": "SoftwareApplication",
        name: fullPkgName,
        version: version,
      },
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Packages", item: `${host}/libraries` },
          { "@type": "ListItem", position: 2, name: fullPkgName, item: `${host}/package/${fullPkgName}` },
          { "@type": "ListItem", position: 3, name: className, item: canonical },
        ],
      },
    };

    const prerenderBody = `
      <section>
        <h1>«${escapeXml(stereotype)}» ${escapeXml(className)}</h1>
        <p><strong>Package:</strong> <a href="/package/${escapeXml(fullPkgName)}">${escapeXml(fullPkgName)}</a> (v${escapeXml(version)})</p>
        <p class="description">${escapeXml(desc)}</p>
        ${
          cls?.extends && cls.extends.length > 0
            ? `<p><strong>Inherits:</strong> ${cls.extends.map((e) => `<code>${escapeXml(e)}</code>`).join(", ")}</p>`
            : ""
        }
        ${
          cls?.components && cls.components.length > 0
            ? `<h2>Interface &amp; Connectors (${cls.components.length})</h2>
               <ul>
                 ${cls.components.map((c) => `<li><code>${escapeXml(c.component_name)}</code>: ${escapeXml(c.type_name)} (${escapeXml(c.causality || "local")}) - ${escapeXml(c.description || "")}</li>`).join("")}
               </ul>`
            : ""
        }
        <p><a href="${escapeXml(markdown)}">View AI-ready Markdown specification</a></p>
      </section>
    `;

    return {
      title: `${className} (${stereotype}) | ${fullPkgName}@${version} | ${brandName}`,
      description: desc,
      canonicalUrl: canonical,
      ogTitle: `${className} | ${fullPkgName}`,
      ogDescription: desc,
      ogImage: ogImg,
      ogType: "article",
      twitterCard: "summary_large_image",
      markdownUrl: markdown,
      jsonLd,
      prerenderBodyHtml: prerenderBody,
    };
  }

  // 3. Package Detail Route: /packages?/:pkg
  const pkgMatch = path.match(/^\/packages?\/(@[^/]+\/[^/]+|[^/]+)(?:\/(?:v\/)?([^/]+))?$/);
  if (pkgMatch) {
    const fullPkgName = pkgMatch[1]!;
    const pkg = database.getPackage(fullPkgName);
    const versions = pkg ? database.getPackageVersions(pkg.id) : [];
    const latest = versions.length > 0 ? versions[versions.length - 1] : undefined;
    const version = latest?.version || "1.0.0";
    const desc = pkg?.description || `${fullPkgName} computational engineering package on ${brandName}.`;
    const license = pkg?.license || "AGPL-3.0-or-later";
    const canonical = `${host}/package/${fullPkgName}`;
    const ogImg = `${host}/api/v1/og/package/${fullPkgName}.png`;
    const markdown = `${host}/package/${fullPkgName}.md`;

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: fullPkgName,
      description: desc,
      softwareVersion: version,
      license: license,
      applicationCategory: "Simulation & Modeling",
      operatingSystem: "WebAssembly / Linux / Windows / macOS",
      image: ogImg,
      url: canonical,
    };

    const prerenderBody = `
      <section>
        <h1>${escapeXml(fullPkgName)} <small>v${escapeXml(version)}</small></h1>
        <p>${escapeXml(desc)}</p>
        <p><strong>License:</strong> ${escapeXml(license)}</p>
        <p><a href="${escapeXml(markdown)}">View AI-ready Markdown manifest</a></p>
      </section>
    `;

    return {
      title: `${fullPkgName} v${version} | ${brandName} Package Registry`,
      description: desc,
      canonicalUrl: canonical,
      ogTitle: `${fullPkgName} v${version} | ${brandName}`,
      ogDescription: desc,
      ogImage: ogImg,
      ogType: "website",
      twitterCard: "summary_large_image",
      markdownUrl: markdown,
      jsonLd,
      prerenderBodyHtml: prerenderBody,
    };
  }

  // 4. User Profile Route: /@:username or /u/:username
  const userMatch = path.match(/^\/(?:@|u\/)([a-zA-Z0-9_.-]+)/);
  if (userMatch && userMatch[1]) {
    const username = userMatch[1];
    const user = database.getUserByUsername(username);
    if (user) {
      const displayName = user.display_name || user.username;
      const bio = user.bio || `Engineer & physical systems modeler on ${brandName}.`;
      const canonical = `${host}/@${username}`;
      const ogImg = user.avatar_url || `${host}/api/v1/og/post/1`;

      return {
        title: `${displayName} (@${username}) | ${brandName}`,
        description: bio,
        canonicalUrl: canonical,
        ogTitle: `${displayName} (@${username}) | ${brandName}`,
        ogDescription: bio,
        ogImage: ogImg,
        ogType: "profile",
        twitterCard: "summary",
      };
    }
  }

  return defaultMeta;
}

export function injectSeoIntoHtml(baseHtml: string, meta: SeoPageMetadata): string {
  let html = baseHtml;

  // Replace Title
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeXml(meta.title)}</title>`);

  // Strip existing meta tags that we are explicitly rewriting to prevent duplicates
  const tagsToStrip = [
    /<meta\s+name=["']description["'][^>]*>/gi,
    /<meta\s+property=["']og:title["'][^>]*>/gi,
    /<meta\s+property=["']og:description["'][^>]*>/gi,
    /<meta\s+property=["']og:image["'][^>]*>/gi,
    /<meta\s+property=["']og:image:[^"']+["'][^>]*>/gi,
    /<meta\s+property=["']og:site_name["'][^>]*>/gi,
    /<meta\s+property=["']og:url["'][^>]*>/gi,
    /<meta\s+property=["']og:type["'][^>]*>/gi,
    /<meta\s+name=["']twitter:title["'][^>]*>/gi,
    /<meta\s+name=["']twitter:description["'][^>]*>/gi,
    /<meta\s+name=["']twitter:image["'][^>]*>/gi,
    /<meta\s+name=["']twitter:image:[^"']+["'][^>]*>/gi,
    /<meta\s+name=["']twitter:site["'][^>]*>/gi,
    /<meta\s+name=["']twitter:card["'][^>]*>/gi,
    /<link\s+rel=["']canonical["'][^>]*>/gi,
    /<link\s+rel=["']alternate["']\s+type=["']application\/json\+oembed["'][^>]*>/gi,
  ];

  for (const regex of tagsToStrip) {
    html = html.replace(regex, "");
  }

  // Construct new Head Tags block
  const headElements: string[] = [
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(meta.canonicalUrl)}" />`,
    `<meta property="og:site_name" content="Ansatz" />`,
    `<meta property="og:title" content="${escapeHtml(meta.ogTitle)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.ogDescription)}" />`,
    `<meta property="og:image" content="${escapeHtml(meta.ogImage)}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeHtml(meta.ogTitle)}" />`,
    `<meta property="og:url" content="${escapeHtml(meta.canonicalUrl)}" />`,
    `<meta property="og:type" content="${escapeHtml(meta.ogType)}" />`,
    `<meta name="twitter:card" content="${escapeHtml(meta.twitterCard)}" />`,
    `<meta name="twitter:site" content="@ansatz" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.ogTitle)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.ogDescription)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(meta.ogImage)}" />`,
    `<meta name="twitter:image:alt" content="${escapeHtml(meta.ogTitle)}" />`,
  ];

  if (meta.oembedUrl) {
    headElements.push(
      `<link rel="alternate" type="application/json+oembed" href="${escapeHtml(meta.oembedUrl)}" title="${escapeHtml(meta.title)}" />`,
    );
  }

  if (meta.markdownUrl) {
    headElements.push(
      `<link rel="alternate" type="text/markdown" href="${escapeHtml(meta.markdownUrl)}" title="AI Markdown Mirror" />`,
    );
  }

  if (meta.citationTitle) {
    headElements.push(`<meta name="citation_title" content="${escapeHtml(meta.citationTitle)}" />`);
  }
  if (meta.citationAuthor) {
    headElements.push(`<meta name="citation_author" content="${escapeHtml(meta.citationAuthor)}" />`);
  }
  if (meta.citationDate) {
    headElements.push(`<meta name="citation_publication_date" content="${escapeHtml(meta.citationDate)}" />`);
  }

  if (meta.jsonLd) {
    headElements.push(
      `<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, "\\u003c")}</script>`,
    );
  }

  // Inject before </head>
  const headInject = "\n    " + headElements.join("\n    ") + "\n  ";
  html = html.replace("</head>", `${headInject}</head>`);

  // Inject hidden crawler prerender body before </body>
  if (meta.prerenderBodyHtml) {
    const prerenderBlock = `\n    <noscript><div id="seo-prerender">${meta.prerenderBodyHtml}</div></noscript>\n  `;
    html = html.replace("</body>", `${prerenderBlock}</body>`);
  }

  return html;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vitepress";
import { parse as parseYaml } from "yaml";
import { discoverPosts, SITE_URL } from "../../scripts/blog-schema";

const SITE_TITLE = "ModelScript Blog";
const SITE_DESCRIPTION =
  "Engineering deep dives on polyglot simulation, linear-memory WebAssembly compilers, and interactive Ansatz artifacts.";

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Lightweight zero-dependency markdown-it block rule for:
 *   ::: ansatz-artifact
 *   title: "..."
 *   artifactId: "42"
 *   ...
 *   ```modelica
 *   ...
 *   ```
 *   :::
 */
function ansatzArtifactMarkdownPlugin(md: {
  block: {
    ruler: {
      before: (
        beforeName: string,
        ruleName: string,
        fn: (state: any, startLine: number, endLine: number, silent: boolean) => boolean,
      ) => void;
    };
  };
}): void {
  md.block.ruler.before("fence", "ansatz_artifact", (state, startLine, endLine, silent) => {
    const startPos = state.bMarks[startLine] + state.tShift[startLine];
    const startMax = state.eMarks[startLine];
    const openLine = state.src.slice(startPos, startMax).trim();

    if (!/^:::\s*ansatz-artifact\b/.test(openLine)) {
      return false;
    }
    if (silent) return true;

    let nextLine = startLine + 1;
    let foundClose = false;
    let inCodeFence = false;

    while (nextLine < endLine) {
      const pos = state.bMarks[nextLine] + state.tShift[nextLine];
      const max = state.eMarks[nextLine];
      const lineText = state.src.slice(pos, max).trim();

      if (lineText.startsWith("```")) {
        inCodeFence = !inCodeFence;
      } else if (!inCodeFence && lineText === ":::") {
        foundClose = true;
        break;
      }
      nextLine++;
    }

    if (!foundClose) return false;

    const rawLines: string[] = [];
    for (let i = startLine + 1; i < nextLine; i++) {
      rawLines.push(state.src.slice(state.bMarks[i], state.eMarks[i]));
    }
    const blockBody = rawLines.join("\n");

    // Extract optional fenced code block inside the container
    let extractedCode = "";
    let extractedLang = "";
    const metaPart = blockBody.replace(
      /```([a-zA-Z0-9_+-]*)\r?\n([\s\S]*?)```/m,
      (_full, lang: string, code: string) => {
        extractedLang = (lang || "").trim();
        extractedCode = code.replace(/\n$/, "");
        return "";
      },
    );

    let props: Record<string, unknown> = {};
    try {
      const parsed = parseYaml(metaPart.trim());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        props = parsed as Record<string, unknown>;
      }
    } catch {
      // Fall back to empty props if YAML is malformed
    }

    if (extractedCode && !props.code) {
      props.code = extractedCode;
    }
    if (extractedLang && !props.dialect) {
      props.dialect = extractedLang;
    }

    const attrPairs: string[] = [];
    const allowedStringProps = [
      "artifactId",
      "title",
      "dialect",
      "view",
      "kind",
      "height",
      "aspectRatio",
      "poster",
      "caption",
      "figure",
      "anchor",
      "token",
      "activate",
      "code",
    ];

    for (const key of allowedStringProps) {
      const val = props[key];
      if (val !== undefined && val !== null && String(val).length > 0) {
        attrPairs.push(`${key}="${escapeHtmlAttr(String(val))}"`);
      }
    }
    if (props.isMultiFile === true) {
      attrPairs.push(`:isMultiFile="true"`);
    }

    const token = state.push("html_block", "", 0);
    token.map = [startLine, nextLine + 1];
    token.content = `<AnsatzArtifact ${attrPairs.join(" ")} />\n`;

    state.line = nextLine + 1;
    return true;
  });
}

function loadBlogLanguageGrammars(): Record<string, unknown>[] {
  const loaded: Record<string, unknown>[] = [];
  const languagesDir = path.resolve(__dirname, "../../../../languages");
  const candidates: Array<{ slug: string; aliases: string[]; scope: string }> = [
    { slug: "modelica", aliases: ["Modelica", "mo"], scope: "source.modelica" },
    { slug: "modelscript", aliases: ["msx"], scope: "source.modelscript" },
    { slug: "sysml2", aliases: ["sysml", "kerml"], scope: "source.sysml2" },
    { slug: "spice", aliases: ["cir"], scope: "source.spice" },
    { slug: "pscad", aliases: ["pscx"], scope: "source.pscad" },
  ];

  for (const c of candidates) {
    const p = path.join(languagesDir, c.slug, "syntaxes", `${c.slug}.tmLanguage.json`);
    if (!fs.existsSync(p)) continue;
    try {
      const grammar = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
      grammar["name"] = c.slug;
      grammar["scopeName"] = grammar["scopeName"] || c.scope;
      grammar["aliases"] = c.aliases;
      loaded.push(grammar);
    } catch {
      // Ignore malformed grammar files
    }
  }
  return loaded;
}

const excludeDrafts =
  process.env.INCLUDE_DRAFTS !== "1"
    ? discoverPosts({ includeDrafts: true })
        .posts.filter((p) => p.draft)
        .map((p) => p.relativePath)
    : [];

export default defineConfig({
  vite: {
    build: {
      target: ["es2020", "safari15"],
      reportCompressedSize: false,
    },
    esbuild: {
      target: ["es2020", "safari15"],
    },
    optimizeDeps: {
      esbuildOptions: {
        target: ["es2020", "safari15"],
      },
    },
  },
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  lang: "en-US",
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: excludeDrafts,

  rewrites(page) {
    const match = /^posts\/\d{4}-\d{2}-\d{2}-([^/]+)\/index\.md$/.exec(page);
    if (match && match[1]) {
      return `${match[1]}.md`;
    }
    return page;
  },

  markdown: {
    math: true,
    languages: loadBlogLanguageGrammars() as any,
    config(md) {
      ansatzArtifactMarkdownPlugin(md);
    },
  },

  head: [
    ["link", { rel: "icon", href: "/favicon.ico" }],
    [
      "link",
      { rel: "alternate", type: "application/rss+xml", title: "ModelScript Blog RSS", href: `${SITE_URL}/rss.xml` },
    ],
    [
      "link",
      { rel: "alternate", type: "application/atom+xml", title: "ModelScript Blog Atom", href: `${SITE_URL}/atom.xml` },
    ],
    ["meta", { property: "og:site_name", content: SITE_TITLE }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
  ],

  transformHead({ pageData, title, description }) {
    const fm = pageData.frontmatter ?? {};
    const isPost = Boolean(fm.slug);
    const slug = typeof fm.slug === "string" ? fm.slug.trim() : "";
    const url = isPost ? `${SITE_URL}/${slug}` : `${SITE_URL}/`;
    const desc = (typeof fm.description === "string" && fm.description.trim()) || description || SITE_DESCRIPTION;

    const rawSocial = fm.social && typeof fm.social === "object" ? (fm.social as Record<string, unknown>) : {};
    const twitterDesc =
      (typeof rawSocial.twitter === "string" && rawSocial.twitter.trim()) ||
      (typeof fm.summaryShort === "string" && fm.summaryShort.trim()) ||
      desc;

    const ogPath =
      typeof fm.ogImage === "string" && fm.ogImage.trim()
        ? fm.ogImage.trim()
        : isPost
          ? `/og/${slug}.png`
          : "/og/index.png";
    const ogImageUrl = /^https?:\/\//.test(ogPath) ? ogPath : `${SITE_URL}/${ogPath.replace(/^\/+/, "")}`;

    const tags: ([string, Record<string, string>] | [string, Record<string, string>, string])[] = [
      ["link", { rel: "canonical", href: url }],
      ["meta", { property: "og:type", content: isPost ? "article" : "website" }],
      ["meta", { property: "og:url", content: url }],
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: desc }],
      ["meta", { property: "og:image", content: ogImageUrl }],
      ["meta", { name: "twitter:title", content: title }],
      ["meta", { name: "twitter:description", content: twitterDesc }],
      ["meta", { name: "twitter:image", content: ogImageUrl }],
    ];

    if (typeof fm.ogAlt === "string" && fm.ogAlt.trim()) {
      tags.push(["meta", { property: "og:image:alt", content: fm.ogAlt.trim() }]);
      tags.push(["meta", { name: "twitter:image:alt", content: fm.ogAlt.trim() }]);
    }

    if (isPost) {
      const dateStr =
        fm.date instanceof Date
          ? fm.date.toISOString().slice(0, 10)
          : typeof fm.date === "string"
            ? fm.date.trim().slice(0, 10)
            : "";
      const updatedStr =
        fm.updated instanceof Date
          ? fm.updated.toISOString().slice(0, 10)
          : typeof fm.updated === "string"
            ? fm.updated.trim().slice(0, 10)
            : dateStr;

      if (dateStr) {
        tags.push(["meta", { property: "article:published_time", content: `${dateStr}T12:00:00Z` }]);
      }
      if (updatedStr) {
        tags.push(["meta", { property: "article:modified_time", content: `${updatedStr}T12:00:00Z` }]);
      }
      if (Array.isArray(fm.tags)) {
        for (const t of fm.tags) {
          tags.push(["meta", { property: "article:tag", content: String(t) }]);
        }
      }

      tags.push([
        "script",
        { type: "application/ld+json" },
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: fm.title || title,
          description: desc,
          image: ogImageUrl,
          url,
          datePublished: dateStr ? `${dateStr}T12:00:00Z` : undefined,
          dateModified: updatedStr ? `${updatedStr}T12:00:00Z` : undefined,
          publisher: {
            "@type": "Organization",
            name: "ModelScript",
            url: "https://modelscript.org",
          },
        }),
      ]);
    }

    return tags;
  },

  themeConfig: {
    logo: {
      light: "/ms-logo.png",
      dark: "/ms-logo-light.png",
      alt: "ModelScript Blog",
    },
    siteTitle: "ModelScript",
    search: {
      provider: "local",
    },
    outline: { level: [2, 3], label: "In this post" },
    nav: [
      { text: "Posts", link: "/" },
      { text: "Docs", link: "https://modelscript.org/guide/introduction" },
      { text: "Ansatz", link: "https://ansatz.social" },
      { text: "RSS", link: "/rss.xml", target: "_blank" },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/modelscript/modelscript", ariaLabel: "GitHub repository" },
      { icon: "x", link: "https://x.com/modelscript", ariaLabel: "ModelScript on X" },
      { icon: "linkedin", link: "https://www.linkedin.com/company/modelscript", ariaLabel: "ModelScript on LinkedIn" },
    ],
    footer: {
      message:
        'Published by <a href="https://modelscript.org">ModelScript</a> &amp; <a href="https://ansatz.social">Ansatz</a> · <a href="/rss.xml">RSS</a> · <a href="/atom.xml">Atom</a>',
      copyright: "Copyright © 2025-2026 Mohamad Omar Nachawati and ModelScript Contributors.",
    },
  },
});

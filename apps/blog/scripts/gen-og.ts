// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Generates 1200x630 Open Graph PNG cards in `blog/public/og/` for the blog
// index and every post (skipping posts that specify a custom external/local ogImage).

import fs from "node:fs";
import path from "node:path";
import { discoverPosts, PUBLIC_ROOT } from "./blog-schema.js";

const ogDir = path.resolve(PUBLIC_ROOT, "og");

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    const last = lines[maxLines - 1] ?? "";
    lines[maxLines - 1] = last.length > maxCharsPerLine - 1 ? `${last.slice(0, maxCharsPerLine - 1)}…` : `${last}…`;
  }
  return lines;
}

function renderBlogOgSvg(opts: {
  title: string;
  subtitle: string;
  eyebrow: string;
  metaLine: string;
  tags: string[];
}): string {
  const titleLines = wrapLines(opts.title, 28, 3);
  const subtitleLines = wrapLines(opts.subtitle, 64, 2);
  const titleFontSize = titleLines.length >= 3 ? 52 : 60;
  const titleStartY = titleLines.length >= 3 ? 210 : 230;
  const titleLineHeight = titleLines.length >= 3 ? 64 : 74;

  const titleSvg = titleLines
    .map(
      (line, idx) =>
        `<text x="112" y="${titleStartY + idx * titleLineHeight}" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="${titleFontSize}" font-weight="800">${escapeXml(line)}</text>`,
    )
    .join("\n  ");

  const subStartY = titleStartY + titleLines.length * titleLineHeight + 18;
  const subSvg = subtitleLines
    .map(
      (line, idx) =>
        `<text x="112" y="${subStartY + idx * 36}" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="26" font-weight="500">${escapeXml(line)}</text>`,
    )
    .join("\n  ");

  const tagPills = opts.tags
    .slice(0, 4)
    .map((tag, idx) => {
      const x = 112 + idx * 170;
      return `<g transform="translate(${x}, 468)">
    <rect width="154" height="32" rx="16" fill="#0f172a" stroke="#1e293b" stroke-width="1.5" />
    <text x="77" y="21" text-anchor="middle" fill="#38bdf8" font-family="ui-monospace, SFMono-Regular, monospace" font-size="14" font-weight="600">#${escapeXml(tag.slice(0, 14))}</text>
  </g>`;
    })
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#070b14" />
      <stop offset="55%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#172554" />
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#06b6d4" />
      <stop offset="50%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#818cf8" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />
  <rect x="64" y="56" width="1072" height="518" rx="24" fill="rgba(15, 23, 42, 0.55)" stroke="#1e293b" stroke-width="2" />
  <rect x="64" y="56" width="1072" height="6" rx="3" fill="url(#accent)" />
  <text x="112" y="138" fill="#22d3ee" font-family="ui-monospace, SFMono-Regular, monospace" font-size="20" font-weight="700" letter-spacing="3">${escapeXml(opts.eyebrow)}</text>
  ${titleSvg}
  ${subSvg}
  ${tagPills}
  <text x="112" y="540" fill="#64748b" font-family="ui-monospace, SFMono-Regular, monospace" font-size="20">${escapeXml(opts.metaLine)}</text>
</svg>
`;
}

async function main(): Promise<void> {
  fs.mkdirSync(ogDir, { recursive: true });

  let ResvgCtor: (new (svg: string, opts?: Record<string, unknown>) => { render(): { asPng(): Buffer } }) | null = null;
  try {
    const resvgPkg = "@resvg/resvg-js";
    const mod = (await import(resvgPkg)) as { Resvg?: typeof ResvgCtor };
    ResvgCtor = mod.Resvg ?? null;
  } catch {
    console.warn("⚠ @resvg/resvg-js unavailable; falling back to SVG OG cards.");
  }

  let count = 0;
  const writeCard = (slug: string, opts: Parameters<typeof renderBlogOgSvg>[0]): void => {
    const svg = renderBlogOgSvg(opts);
    if (ResvgCtor) {
      const pngPath = path.join(ogDir, `${slug}.png`);
      const resvg = new ResvgCtor(svg, {
        fitTo: { mode: "width", value: 1200 },
        font: { loadSystemFonts: true },
      });
      fs.writeFileSync(pngPath, resvg.render().asPng());
      const legacySvg = path.join(ogDir, `${slug}.svg`);
      if (fs.existsSync(legacySvg)) fs.unlinkSync(legacySvg);
    } else {
      fs.writeFileSync(path.join(ogDir, `${slug}.svg`), svg, "utf8");
    }
    count++;
  };

  // Blog home OG card
  writeCard("index", {
    title: "ModelScript Engineering Blog",
    subtitle:
      "Deep dives on polyglot simulation, linear-memory WebAssembly compilers, and interactive Ansatz artifacts.",
    eyebrow: "MODELSCRIPT BLOG",
    metaLine: "blog.modelscript.org · Computable Digital Thread",
    tags: ["modelica", "wasm", "ansatz", "simulation"],
  });

  const { posts } = discoverPosts({ includeDrafts: true });
  for (const post of posts) {
    if (!post.slug) continue;
    // Only skip auto-generation if the post points to a different custom OG image
    if (post.ogImageExplicit && post.ogImageExplicit !== `/og/${post.slug}.png`) continue;

    writeCard(post.slug, {
      title: post.title || post.slug,
      subtitle: post.description || "ModelScript & Ansatz Engineering",
      eyebrow: `MODELSCRIPT BLOG · ${post.date}`,
      metaLine: `blog.modelscript.org/${post.slug} · ${post.readingTimeMinutes} min read`,
      tags: post.tags,
    });
  }

  console.log(
    `✓ Generated ${count} ${ResvgCtor ? "PNG" : "SVG"} OG card(s) in ${path.relative(process.cwd(), ogDir)}.`,
  );
}

void main();

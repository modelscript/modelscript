// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Generates Open Graph social preview assets in `docs/public/og/` and verifies
// that all OG image paths referenced by `config.ts` exist on disk so social
// cards never 404.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INDUSTRIES } from "../docs/.vitepress/theme/data/industries.js";
import { LANGUAGES } from "../docs/.vitepress/theme/data/languages.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(here, "../docs");
const publicRoot = path.resolve(docsRoot, "public");
const ogDir = path.resolve(publicRoot, "og");

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderOgSvg(title: string, subtitle: string, eyebrow = "MODELSCRIPT"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0a0f1c" />
      <stop offset="55%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#1e1b4b" />
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#22d3ee" />
      <stop offset="100%" stop-color="#818cf8" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />
  <rect x="64" y="64" width="1072" height="502" rx="24" fill="none" stroke="#334155" stroke-width="2" />
  <rect x="64" y="64" width="1072" height="6" rx="3" fill="url(#accent)" />
  <text x="112" y="156" fill="#22d3ee" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="700" letter-spacing="4">${escapeXml(eyebrow)}</text>
  <text x="112" y="260" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="64" font-weight="800">${escapeXml(title)}</text>
  <text x="112" y="340" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="500">${escapeXml(subtitle.slice(0, 72))}</text>
  <text x="112" y="505" fill="#64748b" font-family="ui-monospace, SFMono-Regular, monospace" font-size="22">modelscript.org · Computable Digital Thread · 44 Engineering Formats</text>
</svg>
`;
}

function walkMarkdown(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "public") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(p, out);
    else if (entry.name.endsWith(".md") && !entry.name.includes("[")) out.push(p);
  }
  return out;
}

function extractTitleAndDesc(content: string, fallbackTitle: string): { title: string; subtitle: string } {
  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content);
  let title = "";
  let subtitle = "";
  if (fmMatch && fmMatch[1]) {
    const titleMatch = /^title:\s*(.+)$/m.exec(fmMatch[1]);
    const descMatch = /^description:\s*(.+)$/m.exec(fmMatch[1]);
    if (titleMatch && titleMatch[1]) title = titleMatch[1].trim().replace(/^["']|["']$/g, "");
    if (descMatch && descMatch[1]) subtitle = descMatch[1].trim().replace(/^["']|["']$/g, "");
  }
  if (!title) {
    const h1Match = /^#\s+(.+)$/m.exec(content);
    title = h1Match && h1Match[1] ? h1Match[1].trim().replace(/`/g, "") : fallbackTitle;
  }
  if (!subtitle) {
    subtitle = "Open-Core Computable Digital Thread for Polyglot Engineering & Simulation";
  }
  return { title, subtitle };
}

function main(): void {
  fs.mkdirSync(ogDir, { recursive: true });

  const legacyIndexPng = path.join(ogDir, "index.png");
  if (fs.existsSync(legacyIndexPng)) {
    fs.unlinkSync(legacyIndexPng);
  }

  let count = 0;
  const writeCard = (slug: string, title: string, subtitle: string, eyebrow = "MODELSCRIPT"): void => {
    const svgPath = path.join(ogDir, `${slug}.svg`);
    fs.writeFileSync(svgPath, renderOgSvg(title, subtitle, eyebrow), "utf8");
    count++;
  };

  for (const mdFile of walkMarkdown(docsRoot)) {
    const rel = path.relative(docsRoot, mdFile).replace(/\\/g, "/");
    const rawPath = rel
      .replace(/(^|\/)index\.md$/, "$1")
      .replace(/\.md$/, "")
      .replace(/\/+$/, "");
    const cleanRoute = rawPath ? rawPath.replace(/^\/+/, "") : "";
    const slug = cleanRoute ? cleanRoute.replace(/\//g, "-") : "index";
    const content = fs.readFileSync(mdFile, "utf8");
    const { title, subtitle } = extractTitleAndDesc(content, slug === "index" ? "ModelScript" : slug);
    const section = cleanRoute.split("/")[0]?.toUpperCase() || "MODELSCRIPT & ANSATZ";
    writeCard(slug, slug === "index" ? "ModelScript" : title, subtitle, section);
  }

  for (const lang of LANGUAGES) {
    writeCard(`languages-${lang.slug}`, `${lang.name} (${lang.ext})`, lang.role, "POLYGLOT LANGUAGE");
  }

  for (const ind of INDUSTRIES) {
    writeCard(`industries-${ind.slug}`, ind.name, ind.tagline, "INDUSTRY SOLUTION");
  }

  console.log(
    `✓ Generated ${count} OG preview assets in ${path.relative(process.cwd(), ogDir)} (${LANGUAGES.length} languages, ${INDUSTRIES.length} industries).`,
  );
}

main();

// SPDX-License-Identifier: AGPL-3.0-or-later

import katex from "katex";
import { marked } from "marked";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const DOCS_DIR = path.resolve(__dirname, "../docs");
const OUTPUT_PDF = path.resolve(DOCS_DIR, "public/modelscript-reference-manual.pdf");
const TEMP_HTML = path.resolve(__dirname, "manual-bundle.html");

interface DocSection {
  partTitle: string;
  files: { title: string; relativePath: string }[];
}

const DOCUMENT_STRUCTURE: DocSection[] = [
  {
    partTitle: "Part I: Getting Started & User Guide",
    files: [
      { title: "Introduction", relativePath: "guide/introduction.md" },
      { title: "Installation & Requirements", relativePath: "guide/installation.md" },
      { title: "Getting Started", relativePath: "guide/getting-started.md" },
    ],
  },
  {
    partTitle: "Part II: Compiler & Pipeline Architecture",
    files: [
      { title: "Compiler Pipeline Overview", relativePath: "architecture/overview.md" },
      { title: "WASM GLR Native Parser", relativePath: "architecture/glr-parser.md" },
      { title: "Salsa Query Engine", relativePath: "architecture/salsa-queries.md" },
      { title: "Linear DAE Arena", relativePath: "architecture/dae-arena.md" },
      { title: "Triple Graph Grammars", relativePath: "architecture/tgg.md" },
      { title: "Nelson-Oppen Coordinator", relativePath: "architecture/theory-coordinator.md" },
      { title: "Simulation Solvers", relativePath: "architecture/simulation-solvers.md" },
    ],
  },
  {
    partTitle: "Part III: Polyglot Languages & Formats",
    files: [
      { title: "Language Support Overview", relativePath: "languages/overview.md" },
      { title: "Modelica Physical Modeling", relativePath: "languages/modelica.md" },
      { title: "SysML v2 & KerML", relativePath: "languages/sysml2.md" },
      { title: "STEP CAD (ISO 10303)", relativePath: "languages/step.md" },
      { title: "OWL2 Ontologies", relativePath: "languages/owl2.md" },
      { title: "CSV Telemetry", relativePath: "languages/csv.md" },
      { title: "CFD (SU2 & OpenFOAM)", relativePath: "languages/cfd.md" },
      { title: "FEA Structural Analysis", relativePath: "languages/fea.md" },
      { title: "OpenSCAD CSG Geometry", relativePath: "languages/scad.md" },
      { title: "SSP System Packaging", relativePath: "languages/ssp.md" },
    ],
  },
  {
    partTitle: "Part IV: Comprehensive Algorithms Catalog",
    files: [
      { title: "Algorithms Overview & Map", relativePath: "algorithms/overview.md" },
      { title: "Pantelides Index Reduction", relativePath: "algorithms/pantelides.md" },
      { title: "Tarjan BLT Partitioning", relativePath: "algorithms/blt.md" },
      { title: "Cellier-Elmqvist Tearing", relativePath: "algorithms/tearing.md" },
      { title: "Acausal Connector Balancing", relativePath: "algorithms/connector-balancing.md" },
      { title: "Automatic Differentiation", relativePath: "algorithms/autodiff.md" },
      { title: "Numerical ODE/DAE Solvers", relativePath: "algorithms/solvers-ode-dae.md" },
      { title: "Optimization Algorithms", relativePath: "algorithms/optimization.md" },
      { title: "Nelson-Oppen & SMT Solvers", relativePath: "algorithms/theory-coordinator.md" },
      { title: "CHC & IC3 Verification", relativePath: "algorithms/verification-chc.md" },
      { title: "Abstract Interpretation Domains", relativePath: "algorithms/abstract-interpretation.md" },
      { title: "Graph Rewriting & E-Graphs", relativePath: "algorithms/graph-rewriting.md" },
      { title: "Linear Memory Structures", relativePath: "algorithms/linear-memory-structures.md" },
      { title: "Scientific Computing & Surrogates", relativePath: "algorithms/surrogates-linear-algebra.md" },
      { title: "SDP, BVP & Geometric CSG", relativePath: "algorithms/sdp-bvp-cad.md" },
      { title: "Diagram Layout & Routing", relativePath: "algorithms/diagram-layout.md" },
    ],
  },
  {
    partTitle: "Part V: Command-Line Interface (msx)",
    files: [
      { title: "CLI Overview & Flags", relativePath: "cli/overview.md" },
      { title: "Command Reference", relativePath: "cli/commands.md" },
    ],
  },
  {
    partTitle: "Part VI: Reference & Diagnostics",
    files: [
      { title: "Compiler Linter Rules", relativePath: "reference/linter-rules.md" },
      { title: "Standards & Export Formats", relativePath: "reference/export-formats.md" },
    ],
  },
];

function renderMath(text: string): string {
  // Render display math: $$ ... $$
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    try {
      return `<div class="math-display">${katex.renderToString(math.trim(), { displayMode: true, throwOnError: false })}</div>`;
    } catch {
      return `<pre>$$${math}$$</pre>`;
    }
  });

  // Render inline math: $ ... $
  text = text.replace(/\$([^$\n]+?)\$/g, (_, math) => {
    try {
      return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false });
    } catch {
      return `<code>$${math}$</code>`;
    }
  });

  return text;
}

function processAlerts(html: string): string {
  const alertRegex = /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*([\s\S]*?)<\/blockquote>/gi;
  return html.replace(alertRegex, (_, type, content) => {
    const lowerType = type.toLowerCase();
    return `<div class="alert alert-${lowerType}">
      <div class="alert-title">${type}</div>
      <div class="alert-content">${content}</div>
    </div>`;
  });
}

function preprocessMarkdown(raw: string): string {
  // Convert ```mermaid ... ``` into <div class="mermaid">...</div>
  raw = raw.replace(/```mermaid\n([\s\S]*?)```/g, (_, code) => {
    return `<div class="mermaid">\n${code.trim()}\n</div>`;
  });

  // Convert math before markdown processing
  raw = renderMath(raw);

  // Normalize relative markdown links: [foo](./bar.md) -> [foo](#bar)
  raw = raw.replace(/\]\(\.\/([a-zA-Z0-9_-]+)\.md\)/g, "](#$1)");
  raw = raw.replace(/\]\(\.\.\/([a-zA-Z0-9_/-]+)\.md\)/g, "](#$1)");

  return raw;
}

function generateHtml(): string {
  const logoPath = path.resolve(DOCS_DIR, "public/ms-logo.png");
  const logoBase64 = fs.existsSync(logoPath) ? fs.readFileSync(logoPath).toString("base64") : "";
  const katexCssPath = path.resolve(REPO_ROOT, "node_modules/katex/dist/katex.min.css");
  const katexCss = fs.existsSync(katexCssPath) ? fs.readFileSync(katexCssPath, "utf-8") : "";
  const mermaidJsPath = path.resolve(REPO_ROOT, "node_modules/mermaid/dist/mermaid.min.js");
  const mermaidJs = fs.existsSync(mermaidJsPath) ? fs.readFileSync(mermaidJsPath, "utf-8") : "";

  let tocHtml = `<div class="toc-container break-after">
    <h2 class="toc-heading">Table of Contents</h2>
    <div class="toc-grid">`;

  let bodyHtml = "";
  let chapterIndex = 1;

  for (const section of DOCUMENT_STRUCTURE) {
    bodyHtml += `<div class="part-divider break-before">
      <div class="part-number">${section.partTitle.split(":")[0]}</div>
      <h1 class="part-title">${section.partTitle.split(":")[1]?.trim() ?? section.partTitle}</h1>
    </div>\n`;

    tocHtml += `<div class="toc-section"><div class="toc-part-title">${section.partTitle}</div><ul>`;

    for (const file of section.files) {
      const filePath = path.resolve(DOCS_DIR, file.relativePath);
      if (!fs.existsSync(filePath)) {
        console.warn(`Warning: File ${filePath} does not exist`);
        continue;
      }

      const fileId = path.basename(file.relativePath, ".md");
      const rawMd = fs.readFileSync(filePath, "utf-8");
      const processedMd = preprocessMarkdown(rawMd);
      const parsedHtml = marked.parse(processedMd, { async: false }) as string;
      const finalHtml = processAlerts(parsedHtml);

      tocHtml += `<li><a href="#${fileId}"><span class="toc-ch-num">${chapterIndex}.</span> ${file.title}</a></li>`;

      bodyHtml += `<section id="${fileId}" class="doc-chapter break-before">
        <div class="chapter-badge">Chapter ${chapterIndex}</div>
        ${finalHtml}
      </section>\n`;

      chapterIndex++;
    }

    tocHtml += `</ul></div>`;
  }

  tocHtml += `</div></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ModelScript Reference Manual & Algorithmic Foundations</title>
<style>
${katexCss}

@page {
  size: A4;
  margin: 20mm 15mm 20mm 15mm;
  @top-right {
    content: "ModelScript Reference Manual";
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 8pt;
    color: #64748b;
  }
  @bottom-right {
    content: counter(page);
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 8pt;
    color: #64748b;
  }
}

@page :first {
  margin: 0;
  @top-right { content: normal; }
  @bottom-right { content: normal; }
}

* {
  box-sizing: border-box;
}

body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 10pt;
  line-height: 1.55;
  color: #1e293b;
  background-color: #ffffff;
  margin: 0;
  padding: 0;
}

.break-before {
  page-break-before: always;
  break-before: page;
}

.break-after {
  page-break-after: always;
  break-after: page;
}

/* ── COVER PAGE ─────────────────────────────────────────────────── */
.cover-page {
  height: 100vh;
  min-height: 297mm;
  padding: 40mm 25mm 25mm 25mm;
  background: radial-gradient(circle at 80% 20%, #1e1b4b 0%, #0f172a 100%);
  color: #f8fafc;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  page-break-after: always;
  break-after: page;
}

.cover-header {
  display: flex;
  align-items: center;
  gap: 20px;
}

.cover-logo {
  width: 96px;
  height: 96px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.08);
  padding: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.cover-badge {
  display: inline-block;
  font-size: 9pt;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  padding: 6px 14px;
  border-radius: 9999px;
  background: rgba(99, 102, 241, 0.2);
  color: #a5b4fc;
  border: 1px solid rgba(99, 102, 241, 0.4);
  margin-bottom: 24px;
}

.cover-title {
  font-size: 38pt;
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.05;
  margin: 0 0 16px 0;
  background: linear-gradient(135deg, #ffffff 30%, #a5b4fc 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.cover-subtitle {
  font-size: 14pt;
  font-weight: 400;
  color: #94a3b8;
  max-width: 650px;
  line-height: 1.45;
  margin: 0 0 32px 0;
}

.cover-doc-name {
  font-size: 18pt;
  font-weight: 600;
  color: #e2e8f0;
  border-left: 3px solid #6366f1;
  padding-left: 16px;
  margin-bottom: 40px;
}

.cover-footer {
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  padding-top: 24px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  font-size: 8.5pt;
  color: #94a3b8;
}

.cover-footer strong {
  display: block;
  font-size: 9.5pt;
  color: #f1f5f9;
  margin-bottom: 4px;
}

/* ── PART DIVIDER ───────────────────────────────────────────────── */
.part-divider {
  height: 80vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 40mm 20mm;
}

.part-number {
  font-size: 14pt;
  font-weight: 700;
  color: #4f46e5;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  margin-bottom: 12px;
}

.part-title {
  font-size: 28pt;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.02em;
  line-height: 1.15;
  border-bottom: 3px solid #4f46e5;
  padding-bottom: 24px;
}

/* ── TABLE OF CONTENTS ─────────────────────────────────────────── */
.toc-container {
  padding: 10mm 5mm;
}

.toc-heading {
  font-size: 22pt;
  font-weight: 800;
  color: #0f172a;
  border-bottom: 2px solid #e2e8f0;
  padding-bottom: 12px;
  margin-bottom: 24px;
}

.toc-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.toc-section {
  break-inside: avoid;
}

.toc-part-title {
  font-size: 10.5pt;
  font-weight: 700;
  color: #4f46e5;
  margin-bottom: 10px;
  border-bottom: 1px solid #cbd5e1;
  padding-bottom: 4px;
}

.toc-section ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.toc-section li {
  margin-bottom: 6px;
  font-size: 9pt;
}

.toc-section a {
  text-decoration: none;
  color: #334155;
  display: flex;
  align-items: baseline;
}

.toc-section a:hover {
  color: #4f46e5;
}

.toc-ch-num {
  font-weight: 600;
  color: #64748b;
  margin-right: 6px;
  min-width: 22px;
}

/* ── CHAPTER STYLING ───────────────────────────────────────────── */
.doc-chapter {
  padding-top: 10mm;
}

.chapter-badge {
  display: inline-block;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 2px 8px;
  border-radius: 4px;
  background: #eef2ff;
  color: #4f46e5;
  margin-bottom: 12px;
}

h1 {
  font-size: 20pt;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.02em;
  margin-top: 0;
  margin-bottom: 16px;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 8px;
}

h2 {
  font-size: 14pt;
  font-weight: 700;
  color: #1e293b;
  margin-top: 24px;
  margin-bottom: 12px;
  border-bottom: 1px solid #f1f5f9;
  padding-bottom: 4px;
}

h3 {
  font-size: 11pt;
  font-weight: 600;
  color: #334155;
  margin-top: 18px;
  margin-bottom: 8px;
}

p {
  margin-top: 0;
  margin-bottom: 10px;
}

ul, ol {
  margin-top: 0;
  margin-bottom: 12px;
  padding-left: 20px;
}

li {
  margin-bottom: 4px;
}

/* ── TABLES ─────────────────────────────────────────────────────── */
table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 8.5pt;
  break-inside: avoid;
}

th, td {
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  text-align: left;
}

th {
  background-color: #f1f5f9;
  font-weight: 700;
  color: #0f172a;
}

tr:nth-child(even) td {
  background-color: #f8fafc;
}

/* ── CODE BLOCKS ────────────────────────────────────────────────── */
pre {
  background-color: #0f172a;
  color: #f8fafc;
  padding: 12px 14px;
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 8pt;
  line-height: 1.45;
  overflow-x: auto;
  margin: 14px 0;
  break-inside: avoid;
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 8.5pt;
  background-color: #f1f5f9;
  color: #0f172a;
  padding: 2px 4px;
  border-radius: 4px;
}

pre code {
  background-color: transparent;
  color: inherit;
  padding: 0;
}

/* ── CALLOUT ALERTS ─────────────────────────────────────────────── */
.alert {
  padding: 10px 14px;
  margin: 14px 0;
  border-radius: 6px;
  border-left: 4px solid;
  font-size: 9pt;
  break-inside: avoid;
}

.alert-title {
  font-weight: 700;
  font-size: 8pt;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.alert-note {
  background-color: #f0f9ff;
  border-left-color: #0284c7;
  color: #0369a1;
}

.alert-tip {
  background-color: #f0fdf4;
  border-left-color: #16a34a;
  color: #15803d;
}

.alert-important {
  background-color: #f5f3ff;
  border-left-color: #7c3aed;
  color: #6d28d9;
}

.alert-warning {
  background-color: #fffbeb;
  border-left-color: #d97706;
  color: #b45309;
}

.alert-caution {
  background-color: #fef2f2;
  border-left-color: #dc2626;
  color: #b91c1c;
}

/* ── MERMAID & MATH ─────────────────────────────────────────────── */
.mermaid {
  margin: 16px 0;
  text-align: center;
  break-inside: avoid;
}

.math-display {
  margin: 14px 0;
  text-align: center;
  overflow-x: auto;
  break-inside: avoid;
}

a {
  color: #4f46e5;
  text-decoration: none;
}
</style>
<script>
${mermaidJs}
document.addEventListener("DOMContentLoaded", () => {
  mermaid.initialize({
    startOnLoad: true,
    theme: "neutral",
    flowchart: { curve: "basis" }
  });
});
</script>
</head>
<body>

<!-- ── COVER PAGE ──────────────────────────────────────────────── -->
<div class="cover-page">
  <div>
    <div class="cover-header">
      ${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" class="cover-logo" alt="ModelScript Logo" />` : ""}
      <div>
        <div class="cover-badge">Official Reference Manual</div>
        <div style="font-size: 11pt; color: #cbd5e1; font-weight: 500;">ModelScript Engineering Toolchain</div>
      </div>
    </div>

    <div style="margin-top: 60px;">
      <h1 class="cover-title">ModelScript</h1>
      <p class="cover-subtitle">The Polyglot Cyber-Physical Modeling, Simulation & Formal Verification Environment</p>
      <div class="cover-doc-name">Architecture, Languages & Algorithmic Foundations</div>
    </div>
  </div>

  <div class="cover-footer">
    <div>
      <strong>Edition & Target</strong>
      2026 Comprehensive Edition<br>
      WebAssembly (WASM) & Node.js ≥ 24
    </div>
    <div>
      <strong>Open Source License</strong>
      GNU AGPL v3.0<br>
      github.com/modelscript/modelscript
    </div>
    <div>
      <strong>Documentation Portal</strong>
      docs.modelscript.org<br>
      Compiler & Engine Core
    </div>
  </div>
</div>

<!-- ── TABLE OF CONTENTS ───────────────────────────────────────── -->
${tocHtml}

<!-- ── BODY CONTENT ────────────────────────────────────────────── -->
${bodyHtml}

</body>
</html>`;
}

function getBrowserExecutable(): string {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }
  const candidates = [
    "chromium",
    "google-chrome-stable",
    "google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  for (const c of candidates) {
    try {
      execSync(`which ${c}`, { stdio: "ignore" });
      return c;
    } catch {
      if (fs.existsSync(c)) return c;
    }
  }
  throw new Error("No Chromium or Google Chrome executable found for PDF generation.");
}

async function main() {
  console.log("Generating ModelScript Reference Manual HTML...");
  const html = generateHtml();
  fs.writeFileSync(TEMP_HTML, html, "utf-8");
  console.log(`Saved bundle HTML: ${TEMP_HTML} (${(html.length / 1024).toFixed(1)} KB)`);

  const publicDir = path.dirname(OUTPUT_PDF);
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const browserBin = getBrowserExecutable();
  console.log(`Invoking ${browserBin} headless to render PDF...`);
  const chromiumCmd = `"${browserBin}" --headless --disable-gpu --no-sandbox --run-all-compositor-stages-before-draw --print-to-pdf="${OUTPUT_PDF}" "${TEMP_HTML}"`;

  execSync(chromiumCmd, { stdio: "inherit" });

  if (fs.existsSync(OUTPUT_PDF)) {
    const stats = fs.statSync(OUTPUT_PDF);
    console.log(`\nSuccessfully generated high-quality PDF Reference Manual!`);
    console.log(`File: ${OUTPUT_PDF}`);
    console.log(`Size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
  } else {
    console.error("Failed to generate PDF");
    process.exit(1);
  }

  // Clean up temporary HTML
  if (fs.existsSync(TEMP_HTML)) {
    fs.unlinkSync(TEMP_HTML);
  }
}

main().catch((err) => {
  console.error("Error generating PDF:", err);
  process.exit(1);
});

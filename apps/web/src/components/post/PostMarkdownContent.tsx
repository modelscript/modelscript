// SPDX-License-Identifier: AGPL-3.0-or-later

import DOMPurify from "dompurify";
import { marked } from "marked";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { slugifyHeading } from "../../util/notebook";
import { renderSourceToDiagramSvg } from "../artifacts/PolyglotArtifactViewer";
import { compressMorselPayload } from "../morsel/util/permalink";
import ProfileHoverCard from "../ProfileHoverCard";

const MarkdownContainer = styled.div<{ $isLongForm?: boolean | undefined }>`
  margin: 0;
  color: var(--color-text-primary);

  p {
    margin-top: 0;
    margin-bottom: ${(props) => (props.$isLongForm ? "12px" : "0")};
    &:last-child {
      margin-bottom: 0;
    }
  }

  h1,
  h2,
  h3,
  h4 {
    color: var(--color-text-heading, var(--color-fg-default));
    font-weight: 800;
    line-height: 1.3;
    scroll-margin-top: 84px;
    position: relative;
  }

  h1 {
    font-size: 1.45em;
    margin: 18px 0 10px 0;
  }

  h2 {
    font-size: 1.25em;
    margin: ${(props) => (props.$isLongForm ? "22px 0 10px 0" : "12px 0 6px 0")};
    padding-bottom: ${(props) => (props.$isLongForm ? "6px" : "0")};
    border-bottom: ${(props) => (props.$isLongForm ? "1px solid var(--color-border-default)" : "none")};
  }

  h3 {
    font-size: 1.08em;
    margin: ${(props) => (props.$isLongForm ? "16px 0 8px 0" : "10px 0 4px 0")};
  }

  .msx-heading-anchor {
    opacity: 0;
    margin-left: 8px;
    color: var(--color-accent-cyan);
    text-decoration: none;
    font-weight: 600;
    font-size: 0.85em;
    transition: opacity 0.15s ease;
  }

  h1:hover .msx-heading-anchor,
  h2:hover .msx-heading-anchor,
  h3:hover .msx-heading-anchor {
    opacity: 0.85;
  }

  ul,
  ol {
    margin: ${(props) => (props.$isLongForm ? "8px 0 14px 0" : "4px 0")};
    padding-left: 22px;
  }

  li {
    margin-bottom: 4px;
  }

  code:not(pre code) {
    font-family: var(--font-mono, monospace);
    font-size: 0.88em;
    padding: 2px 6px;
    border-radius: 5px;
    background: var(--color-code-bg, rgba(255, 255, 255, 0.07));
    border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
    color: var(--color-accent-cyan, #38bdf8);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0 16px 0;
    font-size: 13.5px;
    border: 1px solid var(--color-table-border, rgba(255, 255, 255, 0.1));
    border-radius: 8px;
    overflow: hidden;
  }

  th,
  td {
    padding: 8px 12px;
    border: 1px solid var(--color-table-border, rgba(255, 255, 255, 0.08));
    text-align: left;
  }

  th {
    background: var(--color-table-header-bg, rgba(255, 255, 255, 0.05));
    font-weight: 700;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--color-text-heading);
  }

  tr:nth-child(even) td {
    background: rgba(255, 255, 255, 0.015);
  }

  blockquote {
    margin: 10px 0;
    padding: 8px 14px;
    border-left: 3px solid var(--color-accent-purple, #8b5cf6);
    background: rgba(139, 92, 246, 0.05);
    border-radius: 0 8px 8px 0;
    color: var(--color-text-secondary);
  }

  .msx-callout {
    margin: 12px 0;
    padding: 10px 14px;
    border-radius: 10px;
    border: 1px solid rgba(6, 182, 212, 0.28);
    border-left: 4px solid var(--color-accent-cyan, #06b6d4);
    background: rgba(6, 182, 212, 0.06);
    font-size: 14px;
    line-height: 1.55;
  }

  .msx-callout-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono, monospace);
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 4px;
    color: var(--color-accent-cyan, #06b6d4);
  }

  .msx-callout-tip {
    border-color: rgba(16, 185, 129, 0.28);
    border-left-color: var(--color-status-verified, #10b981);
    background: rgba(16, 185, 129, 0.06);
    .msx-callout-header {
      color: var(--color-status-verified, #10b981);
    }
  }

  .msx-callout-important {
    border-color: rgba(139, 92, 246, 0.3);
    border-left-color: var(--color-accent-purple, #8b5cf6);
    background: rgba(139, 92, 246, 0.07);
    .msx-callout-header {
      color: var(--color-accent-purple, #8b5cf6);
    }
  }

  .msx-callout-warning {
    border-color: rgba(245, 158, 11, 0.3);
    border-left-color: var(--color-accent-amber, #f59e0b);
    background: rgba(245, 158, 11, 0.07);
    .msx-callout-header {
      color: var(--color-accent-amber, #f59e0b);
    }
  }

  .msx-callout-caution {
    border-color: rgba(244, 63, 94, 0.3);
    border-left-color: var(--color-error, #f43f5e);
    background: rgba(244, 63, 94, 0.07);
    .msx-callout-header {
      color: var(--color-error, #f43f5e);
    }
  }

  .msx-math-block {
    margin: 12px 0;
    padding: 12px 16px;
    border-radius: 10px;
    background: rgba(15, 23, 42, 0.55);
    border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.1));
    font-family: "Times New Roman", "Cambria Math", Georgia, serif;
    font-size: 1.12em;
    font-style: italic;
    text-align: center;
    color: var(--color-text-heading, #fff);
    overflow-x: auto;
  }

  .msx-math-inline {
    font-family: "Times New Roman", "Cambria Math", Georgia, serif;
    font-size: 1.05em;
    font-style: italic;
    padding: 0 2px;
    color: var(--color-text-heading, #fff);
  }

  .msx-frac {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    vertical-align: middle;
    margin: 0 3px;
    font-size: 0.9em;
  }

  .msx-frac-num {
    border-bottom: 1px solid currentColor;
    padding: 0 3px 1px 3px;
    line-height: 1.1;
  }

  .msx-frac-den {
    padding: 1px 3px 0 3px;
    line-height: 1.1;
  }

  pre.msx-code-pre {
    margin: 12px 0;
    padding: 0;
    border-radius: 10px;
    background: var(--color-pre-bg, #030712);
    border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.12));
    overflow: hidden;
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    line-height: 1.55;
  }

  .msx-code-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.04);
    border-bottom: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
    font-family: var(--font-mono, monospace);
    font-size: 11.5px;
    color: var(--color-text-muted);
  }

  .msx-code-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .msx-code-lang-pill {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(139, 92, 246, 0.15);
    color: var(--color-accent-purple, #a78bfa);
    border: 1px solid rgba(139, 92, 246, 0.28);
  }

  .msx-code-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .msx-code-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.12));
    color: var(--color-text-secondary);
    border-radius: 6px;
    padding: 2px 8px;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      background: rgba(6, 182, 212, 0.14);
      border-color: var(--color-accent-cyan, #06b6d4);
      color: var(--color-text-heading);
    }
  }

  .msx-code-btn-ide {
    background: rgba(139, 92, 246, 0.14);
    border-color: rgba(139, 92, 246, 0.35);
    color: var(--color-text-heading);
  }

  .msx-code-btn-active {
    background: rgba(6, 182, 212, 0.22);
    border-color: var(--color-accent-cyan, #06b6d4);
    color: #38bdf8;
  }

  .msx-code-diagram {
    padding: 16px;
    background: var(--ms-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    max-height: 440px;

    svg {
      max-width: 100%;
      height: auto;
    }
  }

  .msx-code-body {
    padding: 10px 0;
    overflow-x: auto;
    display: block;
  }

  .msx-code-line {
    display: flex;
    padding: 0 14px 0 0;
    min-width: fit-content;

    &:hover {
      background: rgba(255, 255, 255, 0.025);
    }
  }

  .msx-line-num {
    user-select: none;
    width: 36px;
    min-width: 36px;
    padding-right: 12px;
    text-align: right;
    color: var(--color-text-tertiary, #64748b);
    font-size: 11.5px;
    opacity: 0.65;
  }

  .msx-line-content {
    white-space: pre;
    flex: 1;
  }

  .tok-kw {
    color: #c084fc;
    font-weight: 600;
  }
  .tok-type {
    color: #38bdf8;
    font-weight: 600;
  }
  .tok-fn {
    color: #60a5fa;
  }
  .tok-num {
    color: #fbbf24;
  }
  .tok-str {
    color: #34d399;
  }
  .tok-comment {
    color: #64748b;
    font-style: italic;
  }
`;

function escapeHtmlText(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const LATEX_SYMBOLS: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  cdot: "·",
  times: "×",
  div: "÷",
  pm: "±",
  mp: "∓",
  leq: "≤",
  le: "≤",
  geq: "≥",
  ge: "≥",
  neq: "≠",
  ne: "≠",
  approx: "≈",
  equiv: "≡",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  int: "∫",
  sum: "∑",
  prod: "∏",
  sqrt: "√",
  rightarrow: "→",
  to: "→",
  leftarrow: "←",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  iff: "⇔",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  subseteq: "⊆",
  cup: "∪",
  cap: "∩",
  forall: "∀",
  exists: "∃",
  quad: "  ",
  qquad: "    ",
};

function formatLatexExpression(rawLatex: string): string {
  let out = escapeHtmlText(rawLatex.trim());
  out = out.replace(/\\ddot\{([^{}]+)\}/g, "$1&#776;");
  out = out.replace(/\\dot\{([^{}]+)\}/g, "$1&#775;");
  out = out.replace(/\\hat\{([^{}]+)\}/g, "$1&#770;");
  out = out.replace(/\\vec\{([^{}]+)\}/g, "$1&#8407;");
  out = out.replace(/\\text\{([^{}]+)\}/g, '<span style="font-style:normal">$1</span>');
  out = out.replace(/\\mathrm\{([^{}]+)\}/g, '<span style="font-style:normal">$1</span>');
  out = out.replace(/\\mathbf\{([^{}]+)\}/g, "<strong>$1</strong>");
  out = out.replace(
    /\\frac\{([^{}]+)\}\{([^{}]+)\}/g,
    '<span class="msx-frac"><span class="msx-frac-num">$1</span><span class="msx-frac-den">$2</span></span>',
  );
  out = out.replace(/\\sqrt\{([^{}]+)\}/g, "√($1)");
  out = out.replace(/\\([a-zA-Z]+)/g, (_m, cmd: string) => LATEX_SYMBOLS[cmd] ?? cmd);
  out = out.replace(/\^\{([^{}]+)\}/g, "<sup>$1</sup>");
  out = out.replace(/\^([a-zA-Z0-9+-])/g, "<sup>$1</sup>");
  out = out.replace(/_\{([^{}]+)\}/g, "<sub>$1</sub>");
  out = out.replace(/_([a-zA-Z0-9+-])/g, "<sub>$1</sub>");
  return out;
}

const POLYGLOT_EXT_MAP: Record<string, string> = {
  modelica: ".mo",
  mo: ".mo",
  modelscript: ".msx",
  msx: ".msx",
  sysml: ".sysml",
  sysml2: ".sysml",
  kerml: ".kerml",
  step: ".step",
  stp: ".stp",
  owl2: ".owl",
  owl: ".owl",
  ofn: ".ofn",
  calculix: ".inp",
  abaqus: ".inp",
  "fea-deck": ".inp",
  fea: ".inp",
  su2: ".cfg",
  "cfd-config": ".cfg",
  cfd: ".cfg",
  scad: ".scad",
  openscad: ".scad",
  csg: ".csg",
  ssp: ".ssd",
  pscad: ".pscx",
  psse: ".raw",
  raw: ".raw",
  psout: ".psout",
  olga: ".opi",
  easy5: ".ez5",
  rocets: ".roc",
  "pipeline-lps": ".lps",
  lps: ".lps",
  sima: ".sima",
  "gt-suite": ".gtm",
  gtm: ".gtm",
  gensys: ".gensys",
  simpack: ".spck",
  spck: ".spck",
  adams: ".adm",
  adm: ".adm",
  autosar: ".arxml",
  arxml: ".arxml",
  ccsds: ".oem",
  oem: ".oem",
  energyplus: ".idf",
  idf: ".idf",
  epanet: ".inp",
  opendrive: ".xodr",
  xodr: ".xodr",
  openscenario: ".xosc",
  xosc: ".xosc",
  plcopen: ".st",
  iec61131: ".st",
  st: ".st",
  reqif: ".reqif",
  simulink: ".mdl",
  mdl: ".mdl",
  slx: ".slx",
  spice: ".sp",
  cir: ".cir",
  urdf: ".urdf",
  "verilog-a": ".va",
  va: ".va",
  aspen: ".bkp",
  swmm: ".inp",
  touchstone: ".s2p",
  s2p: ".s2p",
  ibis: ".ibs",
  opendss: ".dss",
  dss: ".dss",
  relap5: ".relap",
  eclipse: ".data",
  sbml: ".sbml",
  jsbsim: ".xml",
  c: ".c",
  fortran: ".f90",
  f90: ".f90",
  csv: ".csv",
  tsv: ".tsv",
};

function highlightCodeLine(line: string, lang = "modelica"): string {
  const trimmed = line.trimStart();
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith(";") ||
    trimmed.startsWith("!") ||
    trimmed.startsWith("%") ||
    trimmed.startsWith("--") ||
    trimmed.startsWith("**") ||
    (trimmed.startsWith("*") && ["spice", "cir", "adams", "adm"].includes(lang)) ||
    (trimmed.startsWith("<!--") && trimmed.endsWith("-->"))
  ) {
    return `<span class="tok-comment">${escapeHtmlText(line)}</span>`;
  }

  const commentIdx = line.indexOf("//");
  const hashIdx = ["owl2", "owl", "su2", "cfd", "gensys", "scad", "python", "yaml", "toml"].includes(lang)
    ? line.indexOf("#")
    : -1;
  const splitIdx = commentIdx >= 0 ? commentIdx : hashIdx;
  const codePart = splitIdx >= 0 ? line.slice(0, splitIdx) : line;
  const commentPart = splitIdx >= 0 ? line.slice(splitIdx) : "";

  let html = escapeHtmlText(codePart);
  html = html.replace(/(&quot;.*?&quot;)/g, '<span class="tok-str">$1</span>');
  html = html.replace(
    /\b(model|block|connector|record|package|function|type|extends|equation|initial|algorithm|parameter|constant|discrete|input|output|flow|stream|if|then|else|elseif|when|elsewhen|for|loop|while|in|end|within|import|encapsulated|partial|replaceable|redeclare|final|inner|outer|public|protected|connect|der|pre|reinit|time|annotation|part|def|port|attribute|item|action|state|calc|constraint|requirement|module|union|difference|intersection|translate|rotate|scale|cube|sphere|cylinder|polyhedron|Ontology|Prefix|Declaration|SubClassOf|EquivalentClasses|ObjectPropertyAssertion|DataPropertyAssertion|Class|ObjectProperty|DataProperty|NamedIndividual|analog|electrical|discipline|enddiscipline|endmodule|ddt|idt|subroutine|program|implicit|none|real|integer|double|precision|dimension|void|int|float|double|struct|return|PROGRAM|END_PROGRAM|FUNCTION_BLOCK|END_FUNCTION_BLOCK|VAR|VAR_INPUT|VAR_OUTPUT|END_VAR|IF|THEN|ELSIF|ELSE|END_IF|CASE|OF|END_CASE|FOR|TO|DO|END_FOR|coupl|mass|func|s_var|l_var|body|joint|marker|force|pipe|branch|node|source|boundary|compressor)\b/g,
    '<span class="tok-kw">$1</span>',
  );
  html = html.replace(
    /\b(Real|Integer|Boolean|String|StateSelect|SI\.Voltage|SI\.Current|SI\.Resistance|SI\.Capacitance|SI\.Inductance|SI\.Position|SI\.Velocity|SI\.Acceleration|SI\.Force|SI\.Torque|SI\.Temperature|BOOL|INT|DINT|REAL|LREAL|TIME|STRING)\b/g,
    '<span class="tok-type">$1</span>',
  );
  html = html.replace(/\b(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g, '<span class="tok-num">$1</span>');

  if (commentPart) {
    html += `<span class="tok-comment">${escapeHtmlText(commentPart)}</span>`;
  }
  return html;
}

export const PostMarkdownContent: React.FC<{
  text: string | null;
  isLongForm?: boolean | undefined;
}> = ({ text, isLongForm }) => {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [portals, setPortals] = useState<React.ReactPortal[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!text) {
      containerRef.current.innerHTML = "";
      setPortals([]);
      return;
    }

    // 1. Protect fenced code blocks and inline code spans before transforming math, hashtags, and mentions
    const codePlaceholders: string[] = [];
    let safeText = text.replace(/```[\s\S]*?```|`[^`\n]+`/g, (match) => {
      const idx = codePlaceholders.length;
      codePlaceholders.push(match);
      return `@@MSX_CODE_${idx}@@`;
    });

    // 2. Transform display math $$...$$ and inline math $...$ into HTML placeholders
    const mathPlaceholders: string[] = [];
    safeText = safeText.replace(/\$\$([\s\S]+?)\$\$/g, (_m, expr: string) => {
      const idx = mathPlaceholders.length;
      mathPlaceholders.push(`<div class="msx-math-block">${formatLatexExpression(expr)}</div>`);
      return `\n\n@@MSX_MATH_${idx}@@\n\n`;
    });
    safeText = safeText.replace(/(^|[^$\\])\$([^\n$]+?)\$/g, (_m, prefix: string, expr: string) => {
      if (/^\d/.test(expr.trim()) && !/[\\^_=+\-*/a-zA-Z]/.test(expr)) {
        return `${prefix}$${expr}$`;
      }
      const idx = mathPlaceholders.length;
      mathPlaceholders.push(`<span class="msx-math-inline">${formatLatexExpression(expr)}</span>`);
      return `${prefix}@@MSX_MATH_${idx}@@`;
    });

    // 3. Transform hashtags and @mentions outside code/math
    safeText = safeText.replace(/(^|\s)#([a-zA-Z0-9_-]+)/g, "$1[#$2](/explore?q=$2)");
    safeText = safeText.replace(
      /(^|\s)@([a-zA-Z0-9_.-]*[a-zA-Z0-9_-](?:@[a-zA-Z0-9_.-]*[a-zA-Z0-9_-])?)/g,
      "$1[@$2](/@$2)",
    );

    // 4. Restore fenced code and inline code before marked parsing
    safeText = safeText.replace(/@@MSX_CODE_(\d+)@@/g, (_m, idxStr: string) => {
      return codePlaceholders[Number(idxStr)] ?? "";
    });

    let rawHtml = marked.parse(safeText, { breaks: true, gfm: true }) as string;

    // 5. Restore rendered math blocks
    rawHtml = rawHtml.replace(/@@MSX_MATH_(\d+)@@/g, (_m, idxStr: string) => {
      return mathPlaceholders[Number(idxStr)] ?? "";
    });

    const sanitizedHtml = DOMPurify.sanitize(rawHtml, {
      ADD_TAGS: ["sup", "sub"],
      ADD_ATTR: ["class", "id"],
    });

    containerRef.current.innerHTML = sanitizedHtml;

    // 6. Assign deterministic IDs and anchor links to H1/H2/H3 headings
    const seenSlugs = new Map<string, number>();
    const headings = containerRef.current.querySelectorAll("h1, h2, h3");
    headings.forEach((heading) => {
      const rawHeadingText = heading.textContent || "";
      const baseSlug = slugifyHeading(rawHeadingText);
      const count = seenSlugs.get(baseSlug) || 0;
      seenSlugs.set(baseSlug, count + 1);
      const slug = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
      heading.id = slug;

      if (isLongForm) {
        const anchor = document.createElement("a");
        anchor.href = `#${slug}`;
        anchor.className = "msx-heading-anchor";
        anchor.textContent = "#";
        anchor.title = "Copy link to section";
        anchor.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          heading.scrollIntoView({ behavior: "smooth", block: "start" });
          window.history.replaceState(null, "", `#${slug}`);
        };
        heading.appendChild(anchor);
      }
    });

    // 7. Upgrade GitHub-style admonition blockquotes (> [!TIP], > [!NOTE], etc.)
    const blockquotes = containerRef.current.querySelectorAll("blockquote");
    blockquotes.forEach((bq) => {
      const firstP = bq.querySelector("p");
      if (!firstP) return;
      const htmlContent = firstP.innerHTML.trim();
      const match = htmlContent.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>|\n)?([\s\S]*)$/i);
      if (!match) return;
      const kind = match[1]!.toUpperCase();
      const remainder = match[2] || "";

      const metaMap: Record<string, { label: string; icon: string; cls: string }> = {
        TIP: { label: "Pro Tip", icon: "💡", cls: "msx-callout-tip" },
        NOTE: { label: "Engineering Note", icon: "ℹ️", cls: "msx-callout-note" },
        IMPORTANT: { label: "Important", icon: "⚡", cls: "msx-callout-important" },
        WARNING: { label: "Warning", icon: "⚠️", cls: "msx-callout-warning" },
        CAUTION: { label: "Caution", icon: "🚨", cls: "msx-callout-caution" },
      };
      const meta = metaMap[kind] || metaMap["NOTE"]!;

      const calloutDiv = document.createElement("div");
      calloutDiv.className = `msx-callout ${meta.cls}`;
      const headerDiv = document.createElement("div");
      headerDiv.className = "msx-callout-header";
      headerDiv.textContent = `${meta.icon} ${meta.label}`;
      calloutDiv.appendChild(headerDiv);

      firstP.innerHTML = remainder;
      while (bq.firstChild) {
        calloutDiv.appendChild(bq.firstChild);
      }
      bq.parentNode?.replaceChild(calloutDiv, bq);
    });

    // 8. Upgrade fenced code blocks with header, 44-language highlighting, Diagram/Code toggle, Copy & Open in Playground
    const preBlocks = containerRef.current.querySelectorAll("pre");
    preBlocks.forEach((pre) => {
      const codeEl = pre.querySelector("code");
      if (!codeEl) return;
      const rawCode = (codeEl.textContent || "").replace(/\n$/, "");
      const langClass = Array.from(codeEl.classList).find((c) => c.startsWith("language-"));
      const lang = (langClass ? langClass.replace("language-", "") : "modelica").toLowerCase();
      const ext = POLYGLOT_EXT_MAP[lang] || `.${lang}`;

      const lines = rawCode.split("\n");
      let fileTitle = "";
      if (lines.length > 0) {
        const fileMatch = lines[0]!.match(/^(?:\/\/|#|;|!|--|\*+)\s*(?:File|Filename):\s*(.+)$/i);
        if (fileMatch && fileMatch[1]) {
          fileTitle = fileMatch[1].trim();
        }
      }
      if (!fileTitle) {
        const modelMatch = rawCode.match(
          /\b(?:model|block|package|function|record|connector|part\s+def|module|PROGRAM|FUNCTION_BLOCK)\s+([A-Za-z_]\w*)/,
        );
        if (modelMatch && modelMatch[1]) {
          fileTitle = `${modelMatch[1]}${ext}`;
        } else {
          fileTitle = `snippet${ext}`;
        }
      }

      // Check if this code block can be rendered as a polyglot schematic diagram
      let diagramSvg = "";
      try {
        const built = renderSourceToDiagramSvg(rawCode, lang, fileTitle, true);
        if (built.nodeCount > 0 && built.svg) {
          diagramSvg = built.svg;
        }
      } catch {
        // Not diagrammable
      }

      pre.classList.add("msx-code-pre");
      pre.innerHTML = "";

      const header = document.createElement("div");
      header.className = "msx-code-header";

      const titleSpan = document.createElement("span");
      titleSpan.className = "msx-code-title";
      titleSpan.innerHTML = `<span>📄 ${escapeHtmlText(fileTitle)}</span><span class="msx-code-lang-pill">${escapeHtmlText(lang)}</span>`;
      header.appendChild(titleSpan);

      const actions = document.createElement("div");
      actions.className = "msx-code-actions";

      const codeBody = document.createElement("code");
      codeBody.className = "msx-code-body";
      codeBody.innerHTML = lines
        .map(
          (lineText, idx) =>
            `<div class="msx-code-line"><span class="msx-line-num">${idx + 1}</span><span class="msx-line-content">${highlightCodeLine(lineText, lang)}</span></div>`,
        )
        .join("");

      let diagramDiv: HTMLDivElement | null = null;
      if (diagramSvg) {
        diagramDiv = document.createElement("div");
        diagramDiv.className = "msx-code-diagram";
        diagramDiv.style.display = "none";
        diagramDiv.innerHTML = DOMPurify.sanitize(diagramSvg, {
          USE_PROFILES: { svg: true, svgFilters: true },
        });

        const toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "msx-code-btn";
        toggleBtn.textContent = "📐 Diagram";
        let showingDiagram = false;
        toggleBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          showingDiagram = !showingDiagram;
          if (showingDiagram) {
            codeBody.style.display = "none";
            diagramDiv!.style.display = "flex";
            toggleBtn.textContent = "</> Code";
            toggleBtn.classList.add("msx-code-btn-active");
          } else {
            codeBody.style.display = "block";
            diagramDiv!.style.display = "none";
            toggleBtn.textContent = "📐 Diagram";
            toggleBtn.classList.remove("msx-code-btn-active");
          }
        };
        actions.appendChild(toggleBtn);
      }

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "msx-code-btn";
      copyBtn.textContent = "Copy";
      copyBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(rawCode);
        copyBtn.textContent = "✓ Copied";
        setTimeout(() => {
          copyBtn.textContent = "Copy";
        }, 1800);
      };
      actions.appendChild(copyBtn);

      const playgroundBtn = document.createElement("button");
      playgroundBtn.type = "button";
      playgroundBtn.className = "msx-code-btn msx-code-btn-ide";
      playgroundBtn.textContent = "▶ Open in Playground";
      playgroundBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const hash = compressMorselPayload({
          v: 1,
          lang: lang as any,
          code: rawCode,
          title: fileTitle,
        });
        navigate(`/playground#m=${hash}`);
      };
      actions.appendChild(playgroundBtn);

      header.appendChild(actions);
      pre.appendChild(header);
      if (diagramDiv) {
        pre.appendChild(diagramDiv);
      }
      pre.appendChild(codeBody);
    });

    // 9. Attach portals to user @mentions
    const links = containerRef.current.querySelectorAll("a:not(.msx-heading-anchor)");
    const newPortals: React.ReactPortal[] = [];
    links.forEach((rawLink) => {
      const link = rawLink as HTMLAnchorElement;
      const href = link.getAttribute("href");
      if (href && href.startsWith("/@")) {
        const username = href.substring(2);
        const textContent = link.textContent;
        const container = document.createElement("span");
        link.parentNode?.replaceChild(container, link);
        newPortals.push(
          createPortal(
            <ProfileHoverCard username={username}>
              <Link
                to={`/${username}`}
                style={{ color: "var(--color-accent-cyan)", textDecoration: "none", fontWeight: "bold" }}
                onMouseOver={(e) => ((e.target as any).style.textDecoration = "underline")}
                onMouseOut={(e) => ((e.target as any).style.textDecoration = "none")}
              >
                {textContent}
              </Link>
            </ProfileHoverCard>,
            container,
          ),
        );
      } else if (href && href.startsWith("/explore?q=")) {
        link.style.color = "var(--color-accent-cyan)";
        link.style.textDecoration = "none";
        link.style.fontWeight = "bold";
        link.onmouseover = () => (link.style.textDecoration = "underline");
        link.onmouseout = () => (link.style.textDecoration = "none");
        link.onclick = (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          navigate(href);
        };
      } else if (href && href.startsWith("#")) {
        link.style.color = "var(--color-accent-cyan)";
        link.onclick = (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const targetEl = document.getElementById(href.slice(1));
          if (targetEl) {
            targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        };
      } else {
        link.onclick = (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (href?.startsWith("/")) {
            navigate(href);
          } else if (href) {
            window.open(href, "_blank", "noopener,noreferrer");
          }
        };
      }
    });

    setPortals(newPortals);
    return () => setPortals([]);
  }, [text, navigate, isLongForm]);

  return (
    <>
      <MarkdownContainer className="markdown-body" $isLongForm={isLongForm} ref={containerRef} />
      {portals}
    </>
  );
};

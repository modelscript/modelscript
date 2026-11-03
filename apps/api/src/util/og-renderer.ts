// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OpenGraph & Twitter Card Dynamic SVG Image Generator
 *
 * Renders standard 1200x630 (1.91:1) high-contrast, dark-mode preview cards
 * for posts, package registries, and individual class library models.
 * Output is lightweight, deterministic, vector SVG (compatible with Discord,
 * Slack, Telegram, WhatsApp, and modern web crawlers).
 */

export interface OgPostData {
  id: number;
  title?: string | null | undefined;
  content?: string | null | undefined;
  username?: string | null | undefined;
  display_name?: string | null | undefined;
  created_at?: string | null | undefined;
  thumbnail_url?: string | null | undefined;
  artifact_view_id?: number | null | undefined;
  view_type?: string | null | undefined;
  like_count?: number | null | undefined;
  reply_count?: number | null | undefined;
}

export interface OgPackageData {
  name: string;
  version?: string | null | undefined;
  description?: string | null | undefined;
  license?: string | null | undefined;
  class_count?: number | null | undefined;
  downloads_count?: number | null | undefined;
  modified_at?: string | null | undefined;
  language?: string | null | undefined;
}

export interface OgClassData {
  className: string;
  classKind: string;
  description?: string | null | undefined;
  documentation?: string | null | undefined;
  packageName: string;
  packageVersion: string;
  extends?: string[] | undefined;
  components?:
    | {
        component_name: string;
        type_name: string;
        causality?: string | null | undefined;
        variability?: string | null | undefined;
      }[]
    | undefined;
}

export function escapeXml(str: string): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncate(str: string, maxLen: number): string {
  const clean = String(str ?? "").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1).trim() + "…";
}

/**
 * Split text into lines for SVG <tspan> rendering.
 */
function wrapText(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if ((currentLine + " " + word).trim().length <= maxCharsPerLine) {
      currentLine = (currentLine + " " + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }
  return lines;
}

export function extractPostTitle(
  post: { title?: string | null | undefined; content?: string | null | undefined },
  defaultTitle: string,
): string {
  if (post.title?.trim()) return post.title.trim();
  if (!post.content?.trim()) return defaultTitle;
  const firstLine = post.content.split("\n")[0]!.trim();
  const cleanFirstLine = firstLine.replace(/^#+\s*/, "").trim();
  if (cleanFirstLine.includes(": ")) {
    const candidate = cleanFirstLine.split(": ")[0]!.trim();
    if (candidate.length >= 5 && candidate.length <= 80) {
      return candidate;
    }
  }
  if (cleanFirstLine.length > 0 && cleanFirstLine.length <= 70) {
    return cleanFirstLine;
  }
  return cleanFirstLine.slice(0, 70);
}

export function renderPostOgSvg(
  post: OgPostData,
  host: string = "https://ansatz.social",
  brandName: string = "Ansatz",
): string {
  const title = extractPostTitle(post, `${brandName} Engineering Simulation`);
  const excerpt = post.content
    ? post.content
        .replace(/^#+.*$/gm, "")
        .trim()
        .slice(0, 160)
    : "";
  const authorName = post.display_name || post.username || `${brandName} Engineer`;
  const authorHandle = `@${post.username || "engineer"}`;
  const initial = (authorName.charAt(0) || "A").toUpperCase();
  const vType = (post.view_type || "").toLowerCase();

  const titleLines = wrapText(title, 34, 3);
  const excerptLines = wrapText(excerpt, 48, 2);

  let domainBadge = "ENGINEERING POST";
  if (vType.includes("cad") || vType.includes("step")) domainBadge = "3D CAD ASSEMBLY";
  else if (vType.includes("sim") || vType.includes("fea") || vType.includes("cfd")) domainBadge = "PHYSICAL SIMULATION";
  else if (vType.includes("fmu")) domainBadge = "FMI CO-SIMULATION";
  else if (vType.includes("sysml")) domainBadge = "SYSML v2 ARCHITECTURE";
  else if (post.content && post.content.includes("```")) domainBadge = "EXECUTABLE NOTEBOOK";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <title>${escapeXml(title)}</title>
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#080c16" />
      <stop offset="50%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#19153e" />
    </linearGradient>
    <linearGradient id="neonAccent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="50%" stop-color="#818cf8" />
      <stop offset="100%" stop-color="#c084fc" />
    </linearGradient>
    <linearGradient id="cardGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#111827" />
      <stop offset="100%" stop-color="#0b0f19" />
    </linearGradient>
    <linearGradient id="sparklineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#06b6d4" />
      <stop offset="50%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#a855f7" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="6" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
    <pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse">
      <path d="M 36 0 L 0 0 0 36" fill="none" stroke="rgba(56, 189, 248, 0.04)" stroke-width="1"/>
    </pattern>
  </defs>

  <!-- Background Base -->
  <rect width="1200" height="630" fill="url(#bg)" />
  <rect width="1200" height="630" fill="url(#grid)" />

  <!-- Outer Card Frame & Neon Accent -->
  <rect x="36" y="36" width="1128" height="558" rx="24" fill="none" stroke="#1e293b" stroke-width="2" />
  <rect x="36" y="36" width="1128" height="5" rx="2.5" fill="url(#neonAccent)" />

  <!-- Top Bar: Brand & Domain Badge -->
  <g transform="translate(76, 76)">
    <text x="0" y="20" fill="#38bdf8" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="800" letter-spacing="3">${escapeXml(brandName.toUpperCase())} · COMPUTABLE DIGITAL THREAD</text>
    
    <!-- Domain Tag Pill -->
    <rect x="740" y="0" width="280" height="32" rx="16" fill="rgba(56, 189, 248, 0.12)" stroke="#38bdf8" stroke-width="1.5"/>
    <text x="880" y="21" text-anchor="middle" fill="#38bdf8" font-family="ui-monospace, SFMono-Regular, monospace" font-size="12" font-weight="700" letter-spacing="1.5">${escapeXml(domainBadge)}</text>
  </g>

  <!-- Left Column: Author, Post Title & Excerpt -->
  <g transform="translate(76, 140)">
    <!-- Author Row -->
    <circle cx="24" cy="24" r="24" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5" />
    <text x="24" y="31" text-anchor="middle" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="700">${escapeXml(initial)}</text>
    <text x="64" y="20" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="700">${escapeXml(authorName)}</text>
    <text x="64" y="40" fill="#94a3b8" font-family="ui-monospace, SFMono-Regular, monospace" font-size="14">${escapeXml(authorHandle)}</text>

    <!-- Post Title -->
    <text x="0" y="105" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="34" font-weight="800">
      ${titleLines.map((line, idx) => `<tspan x="0" dy="${idx === 0 ? 0 : 42}">${escapeXml(line)}</tspan>`).join("")}
    </text>

    <!-- Post Excerpt -->
    ${
      excerptLines.length > 0
        ? `<text x="0" y="${115 + titleLines.length * 42}" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="400">
      ${excerptLines.map((line, idx) => `<tspan x="0" dy="${idx === 0 ? 0 : 26}">${escapeXml(line)}</tspan>`).join("")}
    </text>`
        : ""
    }

    <!-- Badges Row -->
    <g transform="translate(0, 340)">
      <rect x="0" y="0" width="168" height="30" rx="8" fill="rgba(16, 185, 129, 0.12)" stroke="#10b981" stroke-width="1"/>
      <text x="84" y="19" text-anchor="middle" fill="#10b981" font-family="system-ui, sans-serif" font-size="12" font-weight="600">✓ Reproducible Run</text>

      <rect x="180" y="0" width="168" height="30" rx="8" fill="rgba(99, 102, 241, 0.12)" stroke="#818cf8" stroke-width="1"/>
      <text x="264" y="19" text-anchor="middle" fill="#818cf8" font-family="system-ui, sans-serif" font-size="12" font-weight="600">⚡ WebAssembly HIL</text>
    </g>
  </g>

  <!-- Right Column: Visual Artifact Preview Card -->
  <g transform="translate(670, 136)">
    <rect x="0" y="0" width="440" height="380" rx="16" fill="url(#cardGrad)" stroke="#334155" stroke-width="1.5"/>
    
    <!-- Window controls header -->
    <rect x="0" y="0" width="440" height="38" rx="16" fill="#1e293b" />
    <rect x="0" y="24" width="440" height="14" fill="#1e293b" />
    <circle cx="20" cy="19" r="5" fill="#ef4444" />
    <circle cx="36" cy="19" r="5" fill="#f59e0b" />
    <circle cx="52" cy="19" r="5" fill="#10b981" />
    <text x="220" y="24" text-anchor="middle" fill="#94a3b8" font-family="ui-monospace, monospace" font-size="11" font-weight="600">simulation-output.wasm · 60 Hz</text>

    <!-- Visual Waveform Display or Code Block -->
    <g transform="translate(24, 60)">
      <!-- Oscilloscope Coordinate Grid -->
      <line x1="0" y1="40" x2="392" y2="40" stroke="rgba(56, 189, 248, 0.15)" stroke-dasharray="4,4"/>
      <line x1="0" y1="100" x2="392" y2="100" stroke="rgba(56, 189, 248, 0.15)" stroke-dasharray="4,4"/>
      <line x1="0" y1="160" x2="392" y2="160" stroke="rgba(56, 189, 248, 0.15)" stroke-dasharray="4,4"/>
      <line x1="0" y1="220" x2="392" y2="220" stroke="rgba(56, 189, 248, 0.15)" stroke-dasharray="4,4"/>
      <line x1="100" y1="0" x2="100" y2="260" stroke="rgba(56, 189, 248, 0.15)" stroke-dasharray="4,4"/>
      <line x1="200" y1="0" x2="200" y2="260" stroke="rgba(56, 189, 248, 0.15)" stroke-dasharray="4,4"/>
      <line x1="300" y1="0" x2="300" y2="260" stroke="rgba(56, 189, 248, 0.15)" stroke-dasharray="4,4"/>

      <!-- Glowing Simulation Waveform Trajectory -->
      <path d="M 0 160 Q 60 20, 120 180 T 220 130 T 310 150 T 392 145" fill="none" stroke="url(#sparklineGrad)" stroke-width="3.5" filter="url(#glow)"/>
      <path d="M 0 160 Q 60 20, 120 180 T 220 130 T 310 150 T 392 145" fill="none" stroke="#f8fafc" stroke-width="1.5"/>

      <!-- Secondary Phase State Trajectory -->
      <path d="M 0 130 Q 80 230, 160 110 T 280 160 T 392 155" fill="none" stroke="#c084fc" stroke-width="2" stroke-dasharray="3,3" opacity="0.8"/>

      <!-- Live Indicator Markers -->
      <circle cx="392" cy="145" r="5" fill="#38bdf8" filter="url(#glow)"/>
      <text x="392" y="132" text-anchor="end" fill="#38bdf8" font-family="ui-monospace, monospace" font-size="11" font-weight="700">t = 10.0 s</text>

      <rect x="12" y="235" width="368" height="28" rx="6" fill="rgba(15, 23, 42, 0.9)" stroke="#1e293b"/>
      <text x="24" y="253" fill="#64748b" font-family="ui-monospace, monospace" font-size="10.5">ODE Integrator: SUNDIALS CVODE (BDF/Newton) · RMSE &lt; 1e-4</text>
    </g>
  </g>

  <!-- Bottom Footer Line -->
  <g transform="translate(76, 552)">
    <text x="0" y="0" fill="#64748b" font-family="ui-monospace, monospace" font-size="13">${escapeXml(host)}/p/${post.id}</text>
    <text x="1048" y="0" text-anchor="end" fill="#64748b" font-family="system-ui, sans-serif" font-size="13">Executable Open-Core Modeling &amp; Simulation Platform</text>
  </g>
</svg>
`;
}

export function renderPackageOgSvg(
  pkg: OgPackageData,
  host: string = "https://ansatz.social",
  brandName: string = "Ansatz",
): string {
  const version = pkg.version || "1.0.0";
  const desc = pkg.description || "Polyglot computational engineering package for simulation, verification, and CAD.";
  const descLines = wrapText(desc, 38, 3);
  const classCount = typeof pkg.class_count === "number" ? pkg.class_count : 48;
  const downloads = typeof pkg.downloads_count === "number" ? pkg.downloads_count : 120;
  const license = pkg.license || "AGPL-3.0-or-later";
  const language = (pkg.language || "Modelica").toUpperCase();

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <title>${escapeXml(pkg.name)} v${escapeXml(version)}</title>
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#080c16" />
      <stop offset="55%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#1e1844" />
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#06b6d4" />
      <stop offset="50%" stop-color="#3b82f6" />
      <stop offset="100%" stop-color="#8b5cf6" />
    </linearGradient>
    <pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse">
      <path d="M 36 0 L 0 0 0 36" fill="none" stroke="rgba(56, 189, 248, 0.04)" stroke-width="1"/>
    </pattern>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)" />
  <rect width="1200" height="630" fill="url(#grid)" />

  <rect x="36" y="36" width="1128" height="558" rx="24" fill="none" stroke="#1e293b" stroke-width="2" />
  <rect x="36" y="36" width="1128" height="5" rx="2.5" fill="url(#accent)" />

  <!-- Top Bar -->
  <g transform="translate(76, 76)">
    <text x="0" y="20" fill="#22d3ee" font-family="system-ui, sans-serif" font-size="16" font-weight="800" letter-spacing="3">${escapeXml(brandName.toUpperCase())} · PACKAGE REGISTRY</text>
    
    <rect x="760" y="0" width="260" height="32" rx="16" fill="rgba(6, 182, 212, 0.15)" stroke="#06b6d4" stroke-width="1.5"/>
    <text x="890" y="21" text-anchor="middle" fill="#22d3ee" font-family="ui-monospace, monospace" font-size="13" font-weight="700" letter-spacing="1.5">${escapeXml(language)} ECOSYSTEM</text>
  </g>

  <!-- Left Column: Package Title & Details -->
  <g transform="translate(76, 160)">
    <g transform="translate(0, 0)">
      <rect x="0" y="0" width="94" height="28" rx="6" fill="#1e293b" stroke="#334155"/>
      <text x="47" y="19" text-anchor="middle" fill="#38bdf8" font-family="ui-monospace, monospace" font-size="13" font-weight="700">v${escapeXml(version)}</text>
    </g>

    <text x="0" y="72" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, monospace" font-size="46" font-weight="800">${escapeXml(truncate(pkg.name, 28))}</text>
    
    <text x="0" y="130" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="20" font-weight="400">
      ${descLines.map((line, idx) => `<tspan x="0" dy="${idx === 0 ? 0 : 30}">${escapeXml(line)}</tspan>`).join("")}
    </text>

    <!-- Install command pill -->
    <g transform="translate(0, 260)">
      <rect x="0" y="0" width="460" height="44" rx="8" fill="#0d1117" stroke="#30363d" stroke-width="1.5"/>
      <text x="18" y="27" fill="#22d3ee" font-family="ui-monospace, monospace" font-size="15" font-weight="700">$</text>
      <text x="36" y="27" fill="#f0f6fc" font-family="ui-monospace, monospace" font-size="14.5">msx install ${escapeXml(pkg.name)}</text>
      <text x="440" y="27" text-anchor="end" fill="#6e7681" font-family="ui-monospace, monospace" font-size="12">CLI</text>
    </g>
  </g>

  <!-- Right Column: Metrics HUD Card -->
  <g transform="translate(680, 140)">
    <rect x="0" y="0" width="430" height="370" rx="16" fill="#0d1117" stroke="#334155" stroke-width="1.5"/>
    
    <text x="28" y="44" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="18" font-weight="700">Library Index &amp; Parity</text>

    <!-- 2x2 Grid of Stat Boxes -->
    <g transform="translate(24, 70)">
      <!-- Models Box -->
      <rect x="0" y="0" width="180" height="96" rx="10" fill="#161b22" stroke="#21262d"/>
      <text x="18" y="36" fill="#8b949e" font-family="system-ui, sans-serif" font-size="13">Indexed Models</text>
      <text x="18" y="74" fill="#58a6ff" font-family="ui-monospace, monospace" font-size="30" font-weight="800">${escapeXml(String(classCount))}</text>

      <!-- Downloads Box -->
      <rect x="202" y="0" width="180" height="96" rx="10" fill="#161b22" stroke="#21262d"/>
      <text x="220" y="36" fill="#8b949e" font-family="system-ui, sans-serif" font-size="13">Downloads</text>
      <text x="220" y="74" fill="#3fb950" font-family="ui-monospace, monospace" font-size="30" font-weight="800">${escapeXml(String(downloads))}</text>

      <!-- License Box -->
      <rect x="0" y="116" width="180" height="96" rx="10" fill="#161b22" stroke="#21262d"/>
      <text x="18" y="152" fill="#8b949e" font-family="system-ui, sans-serif" font-size="13">License</text>
      <text x="18" y="190" fill="#f0883e" font-family="ui-monospace, monospace" font-size="20" font-weight="700">${escapeXml(truncate(license, 12))}</text>

      <!-- Architecture Box -->
      <rect x="202" y="116" width="180" height="96" rx="10" fill="#161b22" stroke="#21262d"/>
      <text x="220" y="152" fill="#8b949e" font-family="system-ui, sans-serif" font-size="13">Runtime</text>
      <text x="220" y="190" fill="#d2a8ff" font-family="ui-monospace, monospace" font-size="20" font-weight="700">WASM DAE</text>
    </g>

    <!-- Verification Footer inside card -->
    <rect x="24" y="306" width="382" height="38" rx="8" fill="rgba(56, 189, 248, 0.08)" stroke="#38bdf8" stroke-width="1"/>
    <text x="215" y="330" text-anchor="middle" fill="#38bdf8" font-family="ui-monospace, monospace" font-size="11.5" font-weight="600">✓ Salsa Memoized Query Engine Verified</text>
  </g>

  <!-- Bottom Footer -->
  <g transform="translate(76, 552)">
    <text x="0" y="0" fill="#64748b" font-family="ui-monospace, monospace" font-size="13">${escapeXml(host)}/package/${escapeXml(pkg.name)}</text>
    <text x="1048" y="0" text-anchor="end" fill="#64748b" font-family="system-ui, sans-serif" font-size="13">ModelScript Polyglot Engineering Ecosystem</text>
  </g>
</svg>
`;
}

export function renderClassOgSvg(
  cls: OgClassData,
  host: string = "https://ansatz.social",
  brandName: string = "Ansatz",
): string {
  const shortName = cls.className.split(".").pop() ?? cls.className;
  const stereotype = `«${(cls.classKind || "model").toLowerCase()}»`;
  const desc =
    cls.description ||
    cls.documentation?.slice(0, 140) ||
    `Physical engineering model component in ${cls.packageName}.`;
  const descLines = wrapText(desc, 40, 2);

  const ports = (cls.components || []).filter(
    (c) => c.causality === "input" || c.causality === "output" || c.causality === "connector",
  );
  const params = (cls.components || []).filter((c) => c.variability === "parameter" || c.variability === "constant");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <title>${escapeXml(cls.className)} (${escapeXml(cls.classKind)})</title>
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#080c16" />
      <stop offset="50%" stop-color="#0e1726" />
      <stop offset="100%" stop-color="#1e1840" />
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="50%" stop-color="#818cf8" />
      <stop offset="100%" stop-color="#f43f5e" />
    </linearGradient>
    <pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse">
      <path d="M 36 0 L 0 0 0 36" fill="none" stroke="rgba(56, 189, 248, 0.04)" stroke-width="1"/>
    </pattern>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)" />
  <rect width="1200" height="630" fill="url(#grid)" />

  <rect x="36" y="36" width="1128" height="558" rx="24" fill="none" stroke="#1e293b" stroke-width="2" />
  <rect x="36" y="36" width="1128" height="5" rx="2.5" fill="url(#accent)" />

  <!-- Top Bar -->
  <g transform="translate(76, 76)">
    <text x="0" y="20" fill="#38bdf8" font-family="system-ui, sans-serif" font-size="16" font-weight="800" letter-spacing="3">${escapeXml(brandName.toUpperCase())} · CLASS SPECIFICATION</text>
    
    <rect x="720" y="0" width="300" height="32" rx="16" fill="rgba(129, 140, 248, 0.15)" stroke="#818cf8" stroke-width="1.5"/>
    <text x="870" y="21" text-anchor="middle" fill="#c7d2fe" font-family="ui-monospace, monospace" font-size="13" font-weight="700">${escapeXml(cls.packageName)}@${escapeXml(cls.packageVersion)}</text>
  </g>

  <!-- Left Column: Class Info -->
  <g transform="translate(76, 146)">
    <rect x="0" y="0" width="110" height="28" rx="6" fill="#1e293b" stroke="#334155"/>
    <text x="55" y="19" text-anchor="middle" fill="#f43f5e" font-family="ui-monospace, monospace" font-size="13" font-weight="700">${escapeXml(stereotype)}</text>

    <text x="0" y="68" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, monospace" font-size="40" font-weight="800">${escapeXml(truncate(shortName, 20))}</text>
    <text x="0" y="102" fill="#38bdf8" font-family="ui-monospace, monospace" font-size="16">${escapeXml(truncate(cls.className, 45))}</text>

    <text x="0" y="145" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="18" font-weight="400">
      ${descLines.map((line, idx) => `<tspan x="0" dy="${idx === 0 ? 0 : 26}">${escapeXml(line)}</tspan>`).join("")}
    </text>

    ${
      cls.extends && cls.extends.length > 0
        ? `<g transform="translate(0, 230)">
      <text x="0" y="0" fill="#64748b" font-family="system-ui, sans-serif" font-size="13" font-weight="600">INHERITANCE</text>
      <text x="0" y="24" fill="#a5b4fc" font-family="ui-monospace, monospace" font-size="15" font-weight="600">extends ${escapeXml(truncate(cls.extends[0]!, 35))}</text>
    </g>`
        : ""
    }

    <!-- Interface summary pills -->
    <g transform="translate(0, 310)">
      <rect x="0" y="0" width="140" height="34" rx="8" fill="#161e2e" stroke="#1f2937"/>
      <text x="70" y="22" text-anchor="middle" fill="#38bdf8" font-family="ui-monospace, monospace" font-size="13" font-weight="700">${ports.length} Connectors</text>

      <rect x="156" y="0" width="140" height="34" rx="8" fill="#161e2e" stroke="#1f2937"/>
      <text x="226" y="22" text-anchor="middle" fill="#10b981" font-family="ui-monospace, monospace" font-size="13" font-weight="700">${params.length} Parameters</text>
    </g>
  </g>

  <!-- Right Column: Vector Schematic Block Diagram Card -->
  <g transform="translate(680, 136)">
    <rect x="0" y="0" width="430" height="380" rx="16" fill="#0d1117" stroke="#334155" stroke-width="1.5"/>
    
    <!-- Header of card -->
    <rect x="0" y="0" width="430" height="36" rx="16" fill="#1e293b"/>
    <rect x="0" y="22" width="430" height="14" fill="#1e293b"/>
    <text x="215" y="24" text-anchor="middle" fill="#94a3b8" font-family="ui-monospace, monospace" font-size="12" font-weight="600">BLOCK DEFINITION DIAGRAM (BDD)</text>

    <!-- Center Component Block -->
    <g transform="translate(65, 80)">
      <!-- Main Component Rectangle -->
      <rect x="40" y="20" width="220" height="190" rx="8" fill="#161b22" stroke="#38bdf8" stroke-width="2"/>
      
      <!-- Component Header inside block -->
      <rect x="40" y="20" width="220" height="36" rx="8" fill="rgba(56, 189, 248, 0.15)"/>
      <rect x="40" y="44" width="220" height="12" fill="rgba(56, 189, 248, 0.15)"/>
      <text x="150" y="38" text-anchor="middle" fill="#38bdf8" font-family="ui-monospace, monospace" font-size="10.5" font-weight="700">${escapeXml(stereotype)}</text>
      <text x="150" y="52" text-anchor="middle" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="13" font-weight="700">${escapeXml(truncate(shortName, 16))}</text>

      <!-- Connector Pins / Ports Left & Right -->
      <rect x="28" y="80" width="24" height="16" rx="3" fill="#38bdf8" stroke="#f8fafc" stroke-width="1.5"/>
      <text x="20" y="93" text-anchor="end" fill="#94a3b8" font-family="ui-monospace, monospace" font-size="11">in_1</text>

      <rect x="28" y="140" width="24" height="16" rx="3" fill="#38bdf8" stroke="#f8fafc" stroke-width="1.5"/>
      <text x="20" y="153" text-anchor="end" fill="#94a3b8" font-family="ui-monospace, monospace" font-size="11">in_2</text>

      <rect x="248" y="110" width="24" height="16" rx="3" fill="#10b981" stroke="#f8fafc" stroke-width="1.5"/>
      <text x="280" y="123" text-anchor="start" fill="#94a3b8" font-family="ui-monospace, monospace" font-size="11">out_1</text>

      <!-- Internal Compartment: Parameters -->
      <line x1="40" y1="120" x2="260" y2="120" stroke="#21262d" stroke-width="1"/>
      <text x="52" y="138" fill="#6e7681" font-family="ui-monospace, monospace" font-size="10">parameters:</text>
      <text x="52" y="156" fill="#79c0ff" font-family="ui-monospace, monospace" font-size="11">R: Resistance = 1.0 Ω</text>
      <text x="52" y="174" fill="#79c0ff" font-family="ui-monospace, monospace" font-size="11">T: Temperature = 293.15 K</text>
      <text x="52" y="192" fill="#6e7681" font-family="ui-monospace, monospace" font-size="10">+ other parameters...</text>
    </g>

    <!-- Bottom interactive status banner -->
    <rect x="24" y="324" width="382" height="34" rx="8" fill="rgba(16, 185, 129, 0.08)" stroke="#10b981" stroke-width="1"/>
    <text x="215" y="346" text-anchor="middle" fill="#10b981" font-family="ui-monospace, monospace" font-size="11.5" font-weight="600">⚡ Computable DAE Lowering Ready</text>
  </g>

  <!-- Bottom Footer -->
  <g transform="translate(76, 552)">
    <text x="0" y="0" fill="#64748b" font-family="ui-monospace, monospace" font-size="13">${escapeXml(host)}/package/${escapeXml(cls.packageName)}/classes/${escapeXml(cls.className)}</text>
    <text x="1048" y="0" text-anchor="end" fill="#64748b" font-family="system-ui, sans-serif" font-size="13">Executable In-Browser via ModelScript WebAssembly</text>
  </g>
</svg>
`;
}

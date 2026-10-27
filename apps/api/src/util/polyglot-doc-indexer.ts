// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import type { ClassMetadata, ComponentMetadata } from "../database.js";
import type { ClassRenderResult } from "./svg-renderer.js";

export interface PolyglotIndexOptions {
  extractedDir: string;
  packageName: string;
  version: string;
  onClassIndexed?: (result: ClassRenderResult) => void;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function listFilesRecursive(dir: string, relPrefix = ""): { fullPath: string; relPath: string }[] {
  const out: { fullPath: string; relPath: string }[] = [];
  if (!fs.existsSync(dir)) return out;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...listFilesRecursive(fullPath, relPath));
      } else if (entry.isFile()) {
        out.push({ fullPath, relPath });
      }
    }
  } catch {
    // ignore
  }
  return out;
}

/**
 * Render a clean, dark/light-adaptive engineering SVG block diagram for any SysML v2 or polyglot class.
 */
export function renderPolyglotClassDiagramSvg(
  meta: ClassMetadata,
  domainLabel: string,
  accentColor = "#0284c7",
): { iconSvg: string; diagramSvg: string } {
  const shortName = meta.className.split(".").pop() ?? meta.className;
  const stereotype = `«${meta.classKind.replace(/_/g, " ")}»`;

  const ports = meta.components.filter(
    (c) => c.causality === "input" || c.causality === "output" || c.causality === "connector",
  );
  const params = meta.components.filter((c) => c.variability === "parameter" || c.variability === "constant");
  const parts = meta.components.filter(
    (c) =>
      c.causality !== "input" &&
      c.causality !== "output" &&
      c.causality !== "connector" &&
      c.variability !== "parameter" &&
      c.variability !== "constant",
  );

  // Icon SVG (120x80)
  const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" width="120" height="80">
  <rect x="8" y="8" width="104" height="64" rx="8" fill="#f8fafc" stroke="${accentColor}" stroke-width="2"/>
  <rect x="8" y="8" width="104" height="20" rx="8" fill="${accentColor}" opacity="0.15"/>
  <text x="60" y="21" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8" fill="${accentColor}" font-weight="600">${escapeXml(domainLabel.toUpperCase())}</text>
  <text x="60" y="47" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#0f172a">${escapeXml(shortName.slice(0, 14))}</text>
  <text x="60" y="62" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, monospace" font-size="7.5" fill="#64748b">${escapeXml(stereotype.slice(0, 18))}</text>
</svg>`;

  // Diagram SVG (BDD / IBD hybrid card with ports, attributes, and compartments)
  const visibleParams = params.slice(0, 8);
  const visibleParts = parts.slice(0, 8);
  const visiblePorts = ports.slice(0, 8);

  const compartmentRows = Math.max(visibleParams.length + visibleParts.length, visiblePorts.length, 2);
  const boxHeight = Math.max(150, 84 + compartmentRows * 22);
  const svgHeight = Math.max(240, boxHeight + 80);
  const svgWidth = 680;
  const boxX = 160;
  const boxY = 40;
  const boxW = 360;

  const portSvgElements: string[] = [];
  visiblePorts.forEach((port, idx) => {
    const isLeft = port.causality === "input" || idx % 2 === 0;
    const rowIdx = Math.floor(idx / 2);
    const py = boxY + 66 + rowIdx * 34;
    const px = isLeft ? boxX - 8 : boxX + boxW - 8;
    const labelX = isLeft ? boxX - 16 : boxX + boxW + 16;
    const anchor = isLeft ? "end" : "start";
    portSvgElements.push(
      `<rect x="${px}" y="${py - 7}" width="16" height="14" rx="2" fill="#ffffff" stroke="${accentColor}" stroke-width="2"/>`,
      `<text x="${labelX}" y="${py + 4}" text-anchor="${anchor}" font-family="ui-monospace, SFMono-Regular, monospace" font-size="10.5" fill="#1e293b">${escapeXml(port.name)}: ${escapeXml(port.typeName)}</text>`,
    );
  });

  const compartmentLines: string[] = [];
  let curY = boxY + 68;

  if (meta.baseClasses.length > 0) {
    compartmentLines.push(
      `<text x="${boxX + 14}" y="${curY}" font-family="ui-monospace, SFMono-Regular, monospace" font-size="10.5" fill="#475569">specializes ${escapeXml(meta.baseClasses.join(", "))}</text>`,
    );
    curY += 20;
  }

  if (visibleParams.length > 0) {
    compartmentLines.push(
      `<line x1="${boxX}" y1="${curY - 12}" x2="${boxX + boxW}" y2="${curY - 12}" stroke="#cbd5e1" stroke-width="1"/>`,
      `<text x="${boxX + 14}" y="${curY + 2}" font-family="system-ui, sans-serif" font-size="9.5" font-weight="700" fill="#64748b">ATTRIBUTES / PARAMETERS</text>`,
    );
    curY += 18;
    for (const p of visibleParams) {
      const defVal = p.modifiers.find((m) => m.name === "value" || m.name === "start")?.value;
      const unitVal = p.modifiers.find((m) => m.name === "unit")?.value;
      const rhs = `${p.typeName}${defVal ? ` = ${defVal}` : ""}${unitVal ? ` [${unitVal}]` : ""}`;
      compartmentLines.push(
        `<text x="${boxX + 14}" y="${curY}" font-family="ui-monospace, SFMono-Regular, monospace" font-size="10.5" fill="#0f172a">${escapeXml(p.name)} : <tspan fill="#0369a1">${escapeXml(rhs.slice(0, 38))}</tspan></text>`,
      );
      curY += 18;
    }
  }

  if (visibleParts.length > 0) {
    compartmentLines.push(
      `<line x1="${boxX}" y1="${curY - 10}" x2="${boxX + boxW}" y2="${curY - 10}" stroke="#cbd5e1" stroke-width="1"/>`,
      `<text x="${boxX + 14}" y="${curY + 4}" font-family="system-ui, sans-serif" font-size="9.5" font-weight="700" fill="#64748b">COMPOSITION / MEMBERS</text>`,
    );
    curY += 20;
    for (const pt of visibleParts) {
      compartmentLines.push(
        `<text x="${boxX + 14}" y="${curY}" font-family="ui-monospace, SFMono-Regular, monospace" font-size="10.5" fill="#0f172a">${escapeXml(pt.name)} : <tspan fill="#0f766e">${escapeXml(pt.typeName.slice(0, 38))}</tspan></text>`,
      );
      curY += 18;
    }
  }

  if (visibleParams.length === 0 && visibleParts.length === 0 && meta.description) {
    const words = meta.description.split(/\s+/);
    let line = "";
    const wrapped: string[] = [];
    for (const w of words) {
      if ((line + " " + w).trim().length > 48) {
        wrapped.push(line.trim());
        line = w;
      } else {
        line = `${line} ${w}`.trim();
      }
    }
    if (line.trim()) wrapped.push(line.trim());
    for (const wl of wrapped.slice(0, 4)) {
      compartmentLines.push(
        `<text x="${boxX + 14}" y="${curY}" font-family="system-ui, sans-serif" font-size="11" fill="#334155">${escapeXml(wl)}</text>`,
      );
      curY += 18;
    }
  }

  const finalBoxH = Math.max(boxHeight, curY - boxY + 16);
  const finalSvgH = Math.max(svgHeight, finalBoxH + 80);

  const diagramSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${finalSvgH}" width="${svgWidth}" height="${finalSvgH}">
  <defs>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.08"/>
    </filter>
  </defs>
  <rect x="${boxX}" y="${boxY}" width="${boxW}" height="${finalBoxH}" rx="8" fill="#ffffff" stroke="${accentColor}" stroke-width="2" filter="url(#shadow)"/>
  <rect x="${boxX}" y="${boxY}" width="${boxW}" height="46" rx="8" fill="${accentColor}" opacity="0.1"/>
  <line x1="${boxX}" y1="${boxY + 46}" x2="${boxX + boxW}" y2="${boxY + 46}" stroke="${accentColor}" stroke-width="1.5"/>
  <text x="${boxX + boxW / 2}" y="${boxY + 18}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, monospace" font-size="10.5" fill="${accentColor}" font-weight="600">${escapeXml(stereotype)}</text>
  <text x="${boxX + boxW / 2}" y="${boxY + 36}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="700" fill="#0f172a">${escapeXml(meta.className)}</text>
  ${compartmentLines.join("\n  ")}
  ${portSvgElements.join("\n  ")}
</svg>`;

  return { iconSvg, diagramSvg };
}

/**
 * Clean a SysML `doc /* ... * /` or `/** ... * /` comment into plain text.
 */
function cleanSysmlDocComment(raw: string): string {
  return raw
    .replace(/^doc\s*\/\*/i, "")
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .trim();
}

/**
 * Build rich HTML documentation for a SysML v2 or polyglot class when no explicit HTML is present.
 */
function buildHtmlDocumentation(
  _className: string,
  classKind: string,
  description: string | null,
  baseClasses: string[],
  components: ComponentMetadata[],
  sourceRelPath: string,
): string {
  const parts: string[] = ["<div>"];
  if (description) {
    parts.push(`<p>${escapeXml(description)}</p>`);
  }
  parts.push(
    `<p><strong>Kind:</strong> <code>${escapeXml(classKind)}</code> &nbsp;|&nbsp; <strong>Source:</strong> <code>${escapeXml(sourceRelPath)}</code></p>`,
  );
  if (baseClasses.length > 0) {
    parts.push(
      `<p><strong>Specializes / Extends:</strong> ${baseClasses.map((b) => `<code>${escapeXml(b)}</code>`).join(", ")}</p>`,
    );
  }
  if (components.length > 0) {
    parts.push("<h4>Declared Features &amp; Members</h4><ul>");
    for (const c of components.slice(0, 25)) {
      const defVal = c.modifiers.find((m) => m.name === "value" || m.name === "start")?.value;
      const desc = c.description ? ` — ${escapeXml(c.description)}` : "";
      parts.push(
        `<li><code>${escapeXml(c.name)} : ${escapeXml(c.typeName)}${defVal ? ` = ${escapeXml(defVal)}` : ""}</code>${desc}</li>`,
      );
    }
    parts.push("</ul>");
  }
  parts.push("</div>");
  return parts.join("\n");
}

/**
 * Extract scoped docstring inside or immediately preceding a SysML declaration block.
 */
function extractScopedSysmlDoc(sourceText: string, startOffset: number, endOffset: number): string | null {
  const blockText = sourceText.slice(startOffset, endOffset);
  // 1. Check for `doc /* ... */` inside the top level of the block (before nested definitions)
  const firstNestedDef = blockText.search(
    /\b(?:part|attribute|item|port|connection|interface|allocation|action|state|constraint|requirement|calc|calculation|enum|enumeration|occurrence)\s+def\b/,
  );
  const headerSlice = firstNestedDef > 20 ? blockText.slice(0, firstNestedDef) : blockText.slice(0, 900);
  const innerDocMatch = headerSlice.match(/\bdoc\s*\/\*([\s\S]*?)\*\//);
  if (innerDocMatch?.[1]) {
    return cleanSysmlDocComment(innerDocMatch[0]);
  }
  const innerBlockComment = headerSlice.match(/\/\*\*([\s\S]*?)\*\//);
  if (innerBlockComment?.[1]) {
    return cleanSysmlDocComment(innerBlockComment[0]);
  }

  // 2. Check immediately preceding comment before `startOffset` (up to 400 chars back)
  const prefixSlice = sourceText.slice(Math.max(0, startOffset - 400), startOffset);
  const trailingCommentMatch = prefixSlice.match(/(?:doc\s*\/\*[\s\S]*?\*\/|\/\*\*[\s\S]*?\*\/)\s*$/);
  if (trailingCommentMatch?.[0]) {
    return cleanSysmlDocComment(trailingCommentMatch[0]);
  }
  return null;
}

/**
 * Extract base classes (`:> Base1, Base2` or `specializes Base1`) from a SysML declaration header.
 */
function extractSysmlSpecializations(blockText: string): string[] {
  const header = blockText.split("{")[0] ?? blockText.split(";")[0] ?? "";
  const specMatch = header.match(/(?::>|specializes|subsets)\s+([A-Za-z0-9_.,\s:]+)/);
  if (!specMatch?.[1]) return [];
  return specMatch[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /^[A-Za-z_]/.test(s));
}

/**
 * Extract direct member attributes, ports, items, and parameters from a SysML definition body
 * (excluding nested `* def` blocks and `import` statements).
 */
function extractSysmlDirectMembers(bodyText: string): ComponentMetadata[] {
  const members: ComponentMetadata[] = [];
  const seen = new Set<string>();
  const lines = bodyText.split(/\r?\n/);
  let depth = 0;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    // Adjust depth before processing if line starts with closing brace
    const openCount = (rawLine.match(/\{/g) ?? []).length;
    const closeCount = (rawLine.match(/\}/g) ?? []).length;

    if (depth === 0 && trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("/*") && !trimmed.startsWith("*")) {
      // Strictly skip import statements and doc blocks
      if (!/^(?:public\s+|private\s+|protected\s+)?import\b/.test(trimmed) && !/^doc\b/.test(trimmed)) {
        const memberMatch = trimmed.match(
          /^(?:(in|out|inout)\s+)?(attribute|port|item|part|ref|parameter|subject|actor|objective|return|feature|end)\s+(?!def\b)'?([A-Za-z_][A-Za-z0-9_]*)'?(?:\s*:\s*~?([A-Za-z0-9_.:]+))?(?:\s*\[([^\]]+)\])?(?:\s*(?:=|:=|default)\s*([^;{\n]+))?/,
        );
        if (memberMatch) {
          const dir = memberMatch[1];
          const kw = memberMatch[2]!;
          const name = memberMatch[3]!;
          const typeName = memberMatch[4] || kw;
          const mult = memberMatch[5];
          const val = memberMatch[6]?.trim();

          if (!seen.has(name) && name !== "import") {
            seen.add(name);
            let causality: string | null = null;
            if (dir === "in") causality = "input";
            else if (dir === "out") causality = "output";
            else if (dir === "inout" || kw === "port") causality = "connector";

            const variability = kw === "attribute" || kw === "parameter" ? "parameter" : null;
            const modifiers: { name: string; value: string | null }[] = [];
            if (val) modifiers.push({ name: "value", value: val });
            if (mult) modifiers.push({ name: "multiplicity", value: mult });

            members.push({
              name,
              typeName,
              description: null,
              causality,
              variability,
              modifiers,
            });
          }
        }
      }
    }

    depth += openCount - closeCount;
    if (depth < 0) depth = 0;
  }

  return members;
}

/**
 * Find the matching closing `}` or terminating `;` for a SysML declaration starting at `declStart`.
 */
function findSysmlBlockEnd(source: string, declStart: number): { endOffset: number; bodyStart: number | null } {
  let i = declStart;
  const len = source.length;
  let depth = 0;
  let bodyStart: number | null = null;
  let inBlockComment = false;
  let inLineComment = false;
  let inString: string | null = null;

  while (i < len) {
    const ch = source[i]!;
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (ch === "\\" && next) {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === '"') {
      inString = ch;
      i++;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) bodyStart = i + 1;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return { endOffset: i + 1, bodyStart };
      }
    } else if (ch === ";" && depth === 0) {
      return { endOffset: i + 1, bodyStart: null };
    }
    i++;
  }

  return { endOffset: len, bodyStart };
}

/**
 * Index all SysML v2 / KerML files in `extractedDir`, including both top-level packages
 * AND nested definitions (`ISQ.ForceValue`, `Parts.Part`, `Ports.FlowPort`, `ScalarValues.Real`, etc.).
 */
export async function indexSysmlFiles(options: PolyglotIndexOptions): Promise<ClassRenderResult[]> {
  const allFiles = listFilesRecursive(options.extractedDir);
  const sysmlFiles = allFiles.filter(
    (f) => f.relPath.toLowerCase().endsWith(".sysml") || f.relPath.toLowerCase().endsWith(".kerml"),
  );
  if (sysmlFiles.length === 0) return [];

  const results: ClassRenderResult[] = [];
  const indexedNames = new Set<string>();

  const emitResult = (res: ClassRenderResult) => {
    if (indexedNames.has(res.metadata.className)) return;
    indexedNames.add(res.metadata.className);
    results.push(res);
    options.onClassIndexed?.(res);
  };

  // Hierarchical brace-balanced scanner over all .sysml / .kerml files
  const declRegex =
    /\b(package|(?:abstract\s+)?(?:(?:part|attribute|port|item|action|state|constraint|requirement|calc|calculation|connection|interface|allocation|analysis|verification|use\s+case|view|viewpoint|rendering|metadata|enum|enumeration|occurrence|flow)\s+def|datatype|classifier|struct|class|assoc|behavior|function|predicate|interaction))\s+(?:<[^>]+>\s+)?(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))(?:\s*(?::>|specializes|subsets)\s*([A-Za-z0-9_.,\s:]+))?\s*(?:\{|;)/g;

  const scanScope = (
    source: string,
    scopeStart: number,
    scopeEnd: number,
    parentFqn: string | null,
    relPath: string,
  ) => {
    const slice = source.slice(scopeStart, scopeEnd);
    const localRegex = new RegExp(declRegex.source, "g");
    let match: RegExpExecArray | null;

    while ((match = localRegex.exec(slice)) !== null) {
      const absStart = scopeStart + match.index;
      const rawKind = match[1]!.replace(/^abstract\s+/, "").replace(/\s+/g, "");
      const rawName = (match[2] ?? match[3] ?? "").trim();
      if (!rawName || rawName === "import") continue;

      const { endOffset: absEnd, bodyStart } = findSysmlBlockEnd(source, absStart);
      const fqn = parentFqn ? `${parentFqn}.${rawName}` : rawName;

      const description = extractScopedSysmlDoc(source, absStart, absEnd);
      const blockText = source.slice(absStart, absEnd);
      const baseClasses = extractSysmlSpecializations(blockText);
      const bodyText = bodyStart !== null && absEnd > bodyStart ? source.slice(bodyStart, absEnd - 1) : "";
      const components = bodyText ? extractSysmlDirectMembers(bodyText) : [];

      const classKind = rawKind === "package" ? "package" : `sysml_${rawKind.toLowerCase()}`;
      const documentation = buildHtmlDocumentation(fqn, classKind, description, baseClasses, components, relPath);

      const metadata: ClassMetadata = {
        className: fqn,
        classKind,
        description,
        documentation,
        baseClasses,
        components,
      };

      const { iconSvg, diagramSvg } = renderPolyglotClassDiagramSvg(metadata, "SysML v2", "#0284c7");
      emitResult({ metadata, iconSvg, diagramSvg });

      // Recurse into package or definition body if it has `{ ... }`
      if (bodyStart !== null && absEnd - 1 > bodyStart) {
        scanScope(source, bodyStart, absEnd - 1, fqn, relPath);
      }

      // Advance regex past the entire block so nested declarations aren't also matched at parent scope
      localRegex.lastIndex = Math.max(localRegex.lastIndex, absEnd - scopeStart);
    }
  };

  for (const sf of sysmlFiles) {
    try {
      const content = fs.readFileSync(sf.fullPath, "utf-8");
      scanScope(content, 0, content.length, null, sf.relPath);
    } catch {
      // ignore
    }
  }

  return results;
}

interface PolyglotLangSpec {
  domain: string;
  classKind: string;
  accentColor: string;
  extensions: string[];
}

const POLYGLOT_SPECS: PolyglotLangSpec[] = [
  { domain: "PSCAD EMT", classKind: "pscad_module", accentColor: "#dc2626", extensions: [".pscx", ".pslx", ".pswx"] },
  { domain: "SSP System", classKind: "ssp_system", accentColor: "#2563eb", extensions: [".ssd", ".ssv", ".ssm"] },
  {
    domain: "SPICE Circuit",
    classKind: "spice_subckt",
    accentColor: "#ea580c",
    extensions: [".cir", ".sp", ".lib", ".net"],
  },
  { domain: "OpenSCAD CSG", classKind: "scad_module", accentColor: "#059669", extensions: [".scad"] },
  {
    domain: "URDF / SDF Robot",
    classKind: "urdf_robot",
    accentColor: "#7c3aed",
    extensions: [".urdf", ".sdf", ".xacro"],
  },
  { domain: "SBML Systems Bio", classKind: "sbml_model", accentColor: "#16a34a", extensions: [".sbml"] },
  { domain: "ReqIF Requirements", classKind: "reqif_spec", accentColor: "#0d9488", extensions: [".reqif"] },
  { domain: "AUTOSAR SWC", classKind: "autosar_swc", accentColor: "#4f46e5", extensions: [".arxml"] },
  { domain: "PLCopen IEC 61131-3", classKind: "plcopen_pou", accentColor: "#0369a1", extensions: [".plcopen", ".st"] },
  {
    domain: "Verilog-A Compact Model",
    classKind: "veriloga_module",
    accentColor: "#b45309",
    extensions: [".va", ".vams"],
  },
  {
    domain: "Simulink Block Diagram",
    classKind: "simulink_system",
    accentColor: "#0284c7",
    extensions: [".mdl", ".slx"],
  },
  { domain: "Embedded C", classKind: "c_module", accentColor: "#475569", extensions: [".c", ".h"] },
  {
    domain: "Fortran Scientific",
    classKind: "fortran_module",
    accentColor: "#6d28d9",
    extensions: [".f90", ".f95", ".f"],
  },
  { domain: "OWL 2 Ontology", classKind: "owl2_ontology", accentColor: "#9333ea", extensions: [".owl", ".ofn"] },
  { domain: "CFD Solver Deck", classKind: "cfd_case", accentColor: "#0891b2", extensions: [".cfg", ".foam", ".su2"] },
  { domain: "FEA Structural", classKind: "fea_deck", accentColor: "#be123c", extensions: [".bdf", ".dat"] },
  { domain: "PSS/E Power Grid", classKind: "psse_network", accentColor: "#b91c1c", extensions: [".raw", ".dyr"] },
  { domain: "OpenDSS Distribution", classKind: "opendss_circuit", accentColor: "#c2410c", extensions: [".dss"] },
  {
    domain: "OLGA Multiphase Flow",
    classKind: "olga_network",
    accentColor: "#0f766e",
    extensions: [".olga", ".genkey"],
  },
  { domain: "EASY5 System Dynamics", classKind: "easy5_model", accentColor: "#1d4ed8", extensions: [".ezmf", ".ezan"] },
  { domain: "ROCETS Propulsion", classKind: "rocets_engine", accentColor: "#991b1b", extensions: [".roc"] },
  {
    domain: "GENSYS Rail Dynamics",
    classKind: "gensys_vehicle",
    accentColor: "#15803d",
    extensions: [".gensys", ".gpf", ".tsimf"],
  },
  { domain: "SIMPACK Multibody", classKind: "simpack_model", accentColor: "#1e40af", extensions: [".spck", ".sim"] },
  { domain: "ADAMS Multibody", classKind: "adams_model", accentColor: "#3730a3", extensions: [".adm", ".acf"] },
  { domain: "GT-SUITE Powertrain", classKind: "gtsuite_model", accentColor: "#9a3412", extensions: [".gtm", ".gts"] },
  { domain: "SIMA Marine Ops", classKind: "sima_workflow", accentColor: "#0369a1", extensions: [".sima", ".stask"] },
  { domain: "Aspen Plus Process", classKind: "aspen_flowsheet", accentColor: "#047857", extensions: [".bkp", ".inp"] },
  { domain: "EnergyPlus Building", classKind: "energyplus_building", accentColor: "#15803d", extensions: [".idf"] },
  { domain: "ECLIPSE Reservoir", classKind: "eclipse_reservoir", accentColor: "#78350f", extensions: [".data"] },
  { domain: "RELAP5 Thermal-Hydraulics", classKind: "relap5_system", accentColor: "#991b1b", extensions: [".i"] },
  { domain: "IBIS Signal Integrity", classKind: "ibis_component", accentColor: "#6b21a8", extensions: [".ibs"] },
  {
    domain: "Touchstone RF Network",
    classKind: "touchstone_network",
    accentColor: "#a21caf",
    extensions: [".s1p", ".s2p", ".s3p", ".s4p", ".snp"],
  },
  { domain: "OpenDRIVE Road Network", classKind: "opendrive_road", accentColor: "#334155", extensions: [".xodr"] },
  { domain: "OpenSCENARIO Scenario", classKind: "openscenario_story", accentColor: "#4338ca", extensions: [".xosc"] },
  {
    domain: "CCSDS Orbit Data",
    classKind: "ccsds_orbit",
    accentColor: "#1e3a8a",
    extensions: [".oem", ".opm", ".omm"],
  },
  { domain: "JSBSim Flight Dynamics", classKind: "jsbsim_aircraft", accentColor: "#075985", extensions: [".xml"] },
  { domain: "LPS Logic Program", classKind: "lps_program", accentColor: "#5b21b6", extensions: [".lps"] },
  { domain: "CSV Dataset", classKind: "csv_dataset", accentColor: "#0d9488", extensions: [".csv"] },
  { domain: "ModelScript Native", classKind: "modelscript_module", accentColor: "#0284c7", extensions: [".msx"] },
];

/**
 * Extract components, parameters, ports, and docstrings from any of the other 41 engineering languages.
 */
function extractPolyglotMetadataFromFile(relPath: string, content: string, spec: PolyglotLangSpec): ClassMetadata[] {
  const baseName = path.basename(relPath, path.extname(relPath));
  const lowerExt = path.extname(relPath).toLowerCase();
  const results: ClassMetadata[] = [];

  // Extract leading comment description if present
  const docMatch =
    content.match(/^\s*\/\*\*([\s\S]*?)\*\//) ??
    content.match(/^\s*<!--([\s\S]*?)-->/) ??
    content.match(/^(?:\s*(?:\/\/|#|!|\*)\s*(.+)\r?\n)+/);
  let fileDesc: string | null = null;
  if (docMatch?.[1]) {
    fileDesc = docMatch[1]
      .replace(/^\s*[*#!/]+\s?/gm, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 280);
  }

  // 1. SPICE (.cir, .sp, .lib)
  if (lowerExt === ".cir" || lowerExt === ".sp" || lowerExt === ".lib" || lowerExt === ".net") {
    const subcktRegex = /\.subckt\s+([A-Za-z0-9_]+)\s+([^\r\n]+)([\s\S]*?)\.ends\b/gi;
    let m: RegExpExecArray | null;
    while ((m = subcktRegex.exec(content)) !== null) {
      const name = m[1]!;
      const headerTokens = m[2]!.trim().split(/\s+/);
      const body = m[3] ?? "";
      const components: ComponentMetadata[] = [];
      for (const tok of headerTokens) {
        if (tok.includes("=")) {
          const [k, v] = tok.split("=");
          if (k) {
            components.push({
              name: k.trim(),
              typeName: "Real",
              description: "Subcircuit parameter",
              causality: null,
              variability: "parameter",
              modifiers: v ? [{ name: "value", value: v.trim() }] : [],
            });
          }
        } else if (/^[A-Za-z0-9_]+$/.test(tok) && tok.toLowerCase() !== "params:") {
          components.push({
            name: tok,
            typeName: "ElectricalNode",
            description: "External SPICE terminal node",
            causality: "connector",
            variability: null,
            modifiers: [],
          });
        }
      }
      for (const line of body.split(/\r?\n/)) {
        const elemMatch = line.trim().match(/^([RLCQMXVD][A-Za-z0-9_]*)\s+([^\s]+)\s+([^\s]+)\s+([^\s;]+)/i);
        if (elemMatch) {
          components.push({
            name: elemMatch[1]!,
            typeName: elemMatch[1]![0]!.toUpperCase(),
            description: `Nodes: ${elemMatch[2]} → ${elemMatch[3]}`,
            causality: null,
            variability: null,
            modifiers: [{ name: "value", value: elemMatch[4]! }],
          });
        }
      }
      results.push({
        className: name,
        classKind: "spice_subckt",
        description: fileDesc ?? `SPICE subcircuit ${name}`,
        documentation: buildHtmlDocumentation(name, "spice_subckt", fileDesc, [], components, relPath),
        baseClasses: [],
        components,
      });
    }
  }

  // 2. OpenSCAD (.scad)
  if (lowerExt === ".scad") {
    const modRegex = /(?:\/\*\*([\s\S]*?)\*\/\s*)?\bmodule\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = modRegex.exec(content)) !== null) {
      const modDoc = m[1] ? cleanSysmlDocComment(m[1]) : fileDesc;
      const name = m[2]!;
      const paramsRaw = m[3] ?? "";
      const components: ComponentMetadata[] = [];
      for (const p of paramsRaw.split(",")) {
        const trimmed = p.trim();
        if (!trimmed) continue;
        const [pname, pval] = trimmed.split("=");
        if (pname) {
          components.push({
            name: pname.trim(),
            typeName: "Real",
            description: "Parametric CSG dimension",
            causality: "input",
            variability: "parameter",
            modifiers: pval ? [{ name: "value", value: pval.trim() }] : [],
          });
        }
      }
      results.push({
        className: name,
        classKind: "scad_module",
        description: modDoc ?? `OpenSCAD parametric CSG module ${name}`,
        documentation: buildHtmlDocumentation(name, "scad_module", modDoc, [], components, relPath),
        baseClasses: [],
        components,
      });
    }
  }

  // 3. Verilog-A (.va, .vams)
  if (lowerExt === ".va" || lowerExt === ".vams") {
    const modRegex = /\bmodule\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)([\s\S]*?)\bendmodule\b/g;
    let m: RegExpExecArray | null;
    while ((m = modRegex.exec(content)) !== null) {
      const name = m[1]!;
      const portsRaw = m[2] ?? "";
      const body = m[3] ?? "";
      const components: ComponentMetadata[] = [];
      for (const p of portsRaw.split(",")) {
        const pname = p.trim();
        if (!pname) continue;
        components.push({
          name: pname,
          typeName: "electrical",
          description: "Verilog-A terminal port",
          causality: "connector",
          variability: null,
          modifiers: [],
        });
      }
      const paramRegex = /\bparameter\s+(?:real|integer)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;\n]+)/g;
      let pm: RegExpExecArray | null;
      while ((pm = paramRegex.exec(body)) !== null) {
        components.push({
          name: pm[1]!,
          typeName: "real",
          description: "Compact model parameter",
          causality: null,
          variability: "parameter",
          modifiers: [{ name: "value", value: pm[2]!.trim() }],
        });
      }
      results.push({
        className: name,
        classKind: "veriloga_module",
        description: fileDesc ?? `Verilog-A compact semiconductor model ${name}`,
        documentation: buildHtmlDocumentation(name, "veriloga_module", fileDesc, [], components, relPath),
        baseClasses: [],
        components,
      });
    }
  }

  // 4. URDF / SDF / SSP / PSCAD / SBML / ReqIF / AUTOSAR / PLCopen XML formats
  if (
    lowerExt === ".urdf" ||
    lowerExt === ".sdf" ||
    lowerExt === ".xacro" ||
    lowerExt === ".ssd" ||
    lowerExt === ".pscx" ||
    lowerExt === ".pslx" ||
    lowerExt === ".sbml" ||
    lowerExt === ".reqif" ||
    lowerExt === ".arxml" ||
    lowerExt === ".xodr" ||
    lowerExt === ".xosc" ||
    lowerExt === ".xml"
  ) {
    // Skip non-engineering XML manifests already handled (package.xml)
    if (path.basename(relPath).toLowerCase() === "package.xml") return [];
    const nameMatch =
      content.match(
        /<(?:robot|model|System|Component|definition|Model|SW-COMPONENT-TYPE|pou)\b[^>]*\bname="([^"]+)"/i,
      ) ?? content.match(/\bname="([^"]+)"/);
    const className = (nameMatch?.[1] ?? baseName).replace(/\s+/g, "_");
    const components: ComponentMetadata[] = [];

    // Links / Joints / Connectors / Ports / Species / Parameters
    const elemRegex =
      /<(link|joint|Connector|Component|Parameter|species|parameter|port|P-PORT-PROTOTYPE|R-PORT-PROTOTYPE)\b([^>]*)\/?>/gi;
    let em: RegExpExecArray | null;
    while ((em = elemRegex.exec(content)) !== null && components.length < 40) {
      const tag = em[1]!;
      const attrs = em[2] ?? "";
      const nMatch = attrs.match(/\b(?:name|id)="([^"]+)"/i);
      const tMatch = attrs.match(/\b(?:type|kind|interface)="([^"]+)"/i);
      const vMatch = attrs.match(/\b(?:value|initialAmount|initialConcentration)="([^"]+)"/i);
      if (nMatch?.[1]) {
        const isPort = /connector|port/i.test(tag);
        const isParam = /parameter|species/i.test(tag);
        components.push({
          name: nMatch[1],
          typeName: tMatch?.[1] ?? tag,
          description: `${spec.domain} ${tag}`,
          causality: isPort
            ? attrs.includes("input")
              ? "input"
              : attrs.includes("output")
                ? "output"
                : "connector"
            : null,
          variability: isParam ? "parameter" : null,
          modifiers: vMatch?.[1] ? [{ name: "value", value: vMatch[1] }] : [],
        });
      }
    }

    results.push({
      className,
      classKind: spec.classKind,
      description: fileDesc ?? `${spec.domain} artifact (${relPath})`,
      documentation: buildHtmlDocumentation(className, spec.classKind, fileDesc, [], components, relPath),
      baseClasses: [],
      components,
    });
  }

  // 5. CSV tabular datasets (.csv)
  if (lowerExt === ".csv") {
    const firstLine = content.split(/\r?\n/)[0]?.trim() ?? "";
    const headers = firstLine
      .split(",")
      .map((h) => h.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    const components: ComponentMetadata[] = headers.slice(0, 30).map((col) => ({
      name: col,
      typeName: "Column<Real | String>",
      description: `Tabular column in ${relPath}`,
      causality: "output",
      variability: null,
      modifiers: [],
    }));
    results.push({
      className: baseName,
      classKind: "csv_dataset",
      description: fileDesc ?? `CSV dataset (${headers.length} columns)`,
      documentation: buildHtmlDocumentation(baseName, "csv_dataset", fileDesc, [], components, relPath),
      baseClasses: [],
      components,
    });
  }

  // 6. Generic fallback for any other matched engineering language file (Fortran, C, CFD, FEA, PSS/E, OpenDSS, OLGA, GENSYS, SIMPACK, ADAMS, etc.)
  if (results.length === 0) {
    const components: ComponentMetadata[] = [];
    // Extract key=value or parameter assignments
    const kvRegex = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|:)\s*([^\n\r;#!]+)/gm;
    let km: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((km = kvRegex.exec(content)) !== null && components.length < 25) {
      const k = km[1]!.trim();
      const v = km[2]!.trim().slice(0, 60);
      if (seen.has(k)) continue;
      seen.add(k);
      components.push({
        name: k,
        typeName: /^[+-]?\d/.test(v) ? "Real" : "String",
        description: null,
        causality: null,
        variability: "parameter",
        modifiers: [{ name: "value", value: v }],
      });
    }

    results.push({
      className: baseName,
      classKind: spec.classKind,
      description: fileDesc ?? `${spec.domain} module (${relPath})`,
      documentation: buildHtmlDocumentation(baseName, spec.classKind, fileDesc, [], components, relPath),
      baseClasses: [],
      components,
    });
  }

  return results;
}

/**
 * Index all non-Modelica, non-SysML, non-STEP engineering files across the 41 remaining languages.
 */
export function indexRemainingPolyglotFiles(options: PolyglotIndexOptions): ClassRenderResult[] {
  const allFiles = listFilesRecursive(options.extractedDir);
  const results: ClassRenderResult[] = [];
  const indexedNames = new Set<string>();

  for (const f of allFiles) {
    const ext = path.extname(f.relPath).toLowerCase();
    const spec = POLYGLOT_SPECS.find((s) => s.extensions.includes(ext));
    if (!spec) continue;

    try {
      const content = fs.readFileSync(f.fullPath, "utf-8");
      const metas = extractPolyglotMetadataFromFile(f.relPath, content, spec);
      for (const metadata of metas) {
        if (indexedNames.has(metadata.className)) continue;
        indexedNames.add(metadata.className);
        const { iconSvg, diagramSvg } = renderPolyglotClassDiagramSvg(metadata, spec.domain, spec.accentColor);
        const res: ClassRenderResult = { metadata, iconSvg, diagramSvg };
        results.push(res);
        options.onClassIndexed?.(res);
      }
    } catch {
      // ignore binary or unreadable files
    }
  }

  return results;
}

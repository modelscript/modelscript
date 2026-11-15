// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import { registerPscadSource } from "./model/workspace-registry.js";
import { parseFlyBySegment } from "./script/script-parser.js";
import type { PscadFlyByDoc } from "./types.js";

function getAttrCI(el: XmlElement | undefined, name: string): string | undefined {
  if (!el) return undefined;
  const target = name.toLowerCase();
  for (const attr of el.attributes) {
    if (attr.name === name || attr.name.toLowerCase() === target) {
      return attr.value;
    }
  }
  return undefined;
}

function getAttrAnyCI(el: XmlElement | undefined, names: readonly string[]): string | undefined {
  for (const name of names) {
    const val = getAttrCI(el, name);
    if (val !== undefined) return val;
  }
  return undefined;
}

function elementText(el: XmlElement): string {
  const raw = el.cdata.length > 0 ? el.cdata.map((c) => c.text).join("") : el.text;
  return raw.trim();
}

function findFirstCI(root: XmlElement | null | undefined, tagName: string): XmlElement | undefined {
  if (!root) return undefined;
  const target = tagName.toLowerCase();
  const stack: XmlElement[] = [root];
  while (stack.length > 0) {
    const cur = stack.shift()!;
    if (cur.name.toLowerCase() === target) return cur;
    for (const child of cur.children) stack.push(child);
  }
  return undefined;
}

function findDescendantsCI(root: XmlElement | null | undefined, tagNames: ReadonlySet<string>): XmlElement[] {
  if (!root) return [];
  const results: XmlElement[] = [];
  const walk = (el: XmlElement) => {
    for (const child of el.children) {
      if (tagNames.has(child.name.toLowerCase())) {
        results.push(child);
      }
      walk(child);
    }
  };
  walk(root);
  return results;
}

function deriveNameFromUri(uri: string): string {
  const raw = uri.split("/").pop() || uri;
  return raw.replace(/\.(pslx|pscx|pswx|psmx)$/i, "");
}

const DEFINITION_TAG_SET = new Set(["definition"]);
const SEGMENT_TAG_SET = new Set(["segment"]);
const PORT_TAG_SET = new Set(["port"]);
const PARAM_TAG_SET = new Set(["parameter", "param"]);
const ONLY_PARAM_TAG_SET = new Set(["param"]);

/**
 * Indexes a PSCAD project or library file (`.pslx`, `.pscx`, `.pswx`, `.psmx`) into `UnifiedWorkspace`.
 *
 * Emits unified package symbols for libraries/cases, and class/block symbols
 * for all contained component definitions (`<Definition classid="UserCmpDefn">`).
 */
export function indexPscadDocument(ctx: DslIndexFileContext): void {
  const { uri, text, extension } = ctx;
  if (extension === ".psout") {
    return;
  }

  registerPscadSource(uri, text);

  const xmlDoc = parseXml(text);
  const projectEl = xmlDoc.root
    ? xmlDoc.root.name.toLowerCase() === "project"
      ? xmlDoc.root
      : findFirstCI(xmlDoc.root, "project")
    : undefined;

  // 1. Extract project name and type
  const rawProjName = getAttrCI(projectEl, "name")?.trim();
  const targetAttr = getAttrAnyCI(projectEl, ["target", "type"]);

  const isLibrary =
    uri.toLowerCase().endsWith(".pslx") || (targetAttr ? targetAttr.toLowerCase().includes("library") : false);

  const projectName = rawProjName && rawProjName !== "" ? rawProjName : deriveNameFromUri(uri);

  // Root symbol (e.g. Component_Lib)
  const rootId = ctx.addSymbol(
    projectName,
    "Class",
    null,
    projectEl ? projectEl.start : 0,
    text.length,
    {
      classPrefixes: isLibrary ? "package" : "model",
      language: "pscad",
      projectType: isLibrary ? "library" : "case",
    },
    {
      ruleName: isLibrary ? "pscad_library" : "pscad_project",
      namePath: projectName,
      resourceId: uri,
    },
  );

  if (!xmlDoc.root) return;

  // 2. Extract component definitions from <definitions>
  const defElements = findDescendantsCI(xmlDoc.root, DEFINITION_TAG_SET);
  for (const defEl of defElements) {
    const defName = getAttrCI(defEl, "name");
    const classId = getAttrCI(defEl, "classid");

    // Only index user component definitions, and skip internal drawing station canvas
    if (!defName || classId !== "UserCmpDefn") continue;
    if (defName === "DS") continue;

    let desc: string | undefined;
    for (const pEl of findDescendantsCI(defEl, ONLY_PARAM_TAG_SET)) {
      if (getAttrCI(pEl, "name")?.toLowerCase() === "description") {
        desc = getAttrCI(pEl, "value");
        break;
      }
    }

    let flyByDoc: PscadFlyByDoc | undefined;
    for (const segEl of findDescendantsCI(defEl, SEGMENT_TAG_SET)) {
      if (getAttrCI(segEl, "name")?.toLowerCase() === "flyby") {
        const flyByText = elementText(segEl);
        flyByDoc = parseFlyBySegment(flyByText);
        if ((!desc || !desc.trim()) && flyByDoc.summary) {
          desc = flyByDoc.summary.split("\n")[0]?.trim();
        }
        break;
      }
    }

    const iconSvg = renderPscadDefinitionIconSvg(defEl, 16, defName);
    const hasSchematic = findFirstCI(defEl, "schematic") !== undefined;

    const compId = ctx.addSymbol(
      defName,
      "Class",
      rootId,
      defEl.start,
      defEl.end,
      {
        classPrefixes: hasSchematic ? "model" : "block",
        language: "pscad",
        description: desc,
        iconSvg,
        flyBy: flyByDoc,
      },
      {
        ruleName: "pscad_component",
        namePath: `${projectName}.${defName}`,
        resourceId: uri,
      },
    );

    const seenChildren = new Set<string>();

    // Index child <port name="..." type="..." /> nodes inside definition body
    for (const portEl of findDescendantsCI(defEl, PORT_TAG_SET)) {
      const pName = getAttrCI(portEl, "name")?.trim();
      if (!pName || seenChildren.has(`port:${pName}`)) continue;
      seenChildren.add(`port:${pName}`);
      const pTypeRaw = getAttrCI(portEl, "type")?.trim() ?? "Real";
      const pDir = getAttrAnyCI(portEl, ["dir", "direction", "kind"])?.trim().toLowerCase();
      ctx.addSymbol(
        pName,
        "Component",
        compId,
        portEl.start,
        portEl.end,
        {
          typeSpecifier: pTypeRaw,
          variability: "continuous",
          causality: pDir === "input" || pDir === "output" ? pDir : undefined,
          direction: pDir || "inout",
          isConnectorPort: true,
          language: "pscad",
        },
        {
          ruleName: "pscad_port",
          namePath: `${projectName}.${defName}.${pName}`,
          resourceId: uri,
        },
      );
    }

    // Index child <parameter .../> (from <form>) and <param .../> (from <paramlist>) entries
    for (const paramEl of findDescendantsCI(defEl, PARAM_TAG_SET)) {
      const pName = getAttrCI(paramEl, "name")?.trim();
      if (!pName || pName === "Name" || pName === "Description" || seenChildren.has(`param:${pName}`)) continue;
      seenChildren.add(`param:${pName}`);
      const pType = getAttrCI(paramEl, "type")?.trim() ?? "Real";
      const attrVal = getAttrAnyCI(paramEl, ["default", "value"])?.trim();
      const innerVal = elementText(paramEl);
      const rawVal = attrVal ?? (innerVal !== "" ? innerVal : undefined);
      const numVal = rawVal !== undefined && rawVal !== "" ? Number(rawVal) : NaN;
      const defaultValue: unknown = Number.isFinite(numVal) ? numVal : rawVal;
      const unit = getAttrCI(paramEl, "unit")?.trim();
      ctx.addSymbol(
        pName,
        "Component",
        compId,
        paramEl.start,
        paramEl.end,
        {
          typeSpecifier: pType,
          variability: "parameter",
          ...(defaultValue !== undefined ? { defaultValue, value: defaultValue } : {}),
          ...(unit ? { unit } : {}),
          language: "pscad",
        },
        {
          ruleName: "pscad_parameter",
          namePath: `${projectName}.${defName}.${pName}`,
          resourceId: uri,
        },
      );
    }
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeIconStroke(s?: string): string {
  if (!s || s === "Black" || s === "Navy" || s === "#000000" || s === "#ff000000" || s === "ByNode" || s === "0") {
    return "currentColor";
  }
  const sl = s.toLowerCase();
  if (sl.includes("blue")) return "#0284c7";
  if (sl.includes("green")) return "#16a34a";
  if (sl.includes("red")) return "#ef4444";
  if (sl.includes("fuchsia") || sl.includes("magenta")) return "#c026d3";
  if (sl.includes("gray") || sl.includes("grey")) return "#94a3b8";
  return "currentColor";
}

/**
 * Renders a small 16x16 library outline SVG icon from a PSCAD `<Definition>` element or raw XML fragment.
 */
export function renderPscadDefinitionIconSvg(
  dBodyOrEl: string | XmlElement,
  size = 16,
  defName = "",
): string | undefined {
  interface VisualItem {
    type: "rect" | "line" | "circle" | "ellipse" | "path" | "polygon" | "text" | "raw";
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    svgMarkup: string;
  }
  const items: VisualItem[] = [];

  const rootEl =
    typeof dBodyOrEl === "string" ? parseXml(`<__pscad_icon__>${dBodyOrEl}</__pscad_icon__>`).root : dBodyOrEl;

  // 1. Try parsing <svg> section first (richest representation in modern PSCAD)
  const svgEl = findFirstCI(rootEl, "svg");
  if (svgEl) {
    let isCondActive = true;
    const walkSvg = (parent: XmlElement) => {
      for (const el of parent.children) {
        const tag = el.name.toLowerCase();
        if (tag === "cond") {
          const condText = elementText(el);
          if (condText.includes("Dim!=1") || condText.includes("Dim > 1") || condText.includes("CmplxParts")) {
            isCondActive = false;
          } else if (condText.includes("true") || condText === "") {
            isCondActive = true;
          }
          walkSvg(el);
          continue;
        }

        if (isCondActive) {
          if (tag === "rect") {
            const x = parseFloat(getAttrCI(el, "x") || "0");
            const y = parseFloat(getAttrCI(el, "y") || "0");
            const w = parseFloat(getAttrCI(el, "width") || "0");
            const h = parseFloat(getAttrCI(el, "height") || "0");
            if (w > 0 && h > 0) {
              const stroke = normalizeIconStroke(getAttrCI(el, "stroke"));
              const fillStyle = (getAttrCI(el, "fill-style") || "").toLowerCase();
              const fillFg = (getAttrCI(el, "fill-fg") || "").toLowerCase();
              const fill =
                fillStyle === "solid" && (fillFg === "black" || fillFg === "#000000") ? "currentColor" : "none";
              items.push({
                type: "rect",
                x1: x,
                y1: y,
                x2: x + w,
                y2: y + h,
                svgMarkup: `<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${stroke}" fill="${fill}" rx="1" ry="1" />`,
              });
            }
          } else if (tag === "line") {
            const x1 = parseFloat(getAttrCI(el, "x1") || "0");
            const y1 = parseFloat(getAttrCI(el, "y1") || "0");
            const x2 = parseFloat(getAttrCI(el, "x2") || "0");
            const y2 = parseFloat(getAttrCI(el, "y2") || "0");
            const stroke = normalizeIconStroke(getAttrCI(el, "stroke"));
            items.push({
              type: "line",
              x1: Math.min(x1, x2),
              y1: Math.min(y1, y2),
              x2: Math.max(x1, x2),
              y2: Math.max(y1, y2),
              svgMarkup: `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" />`,
            });
          } else if (tag === "ellipse" || tag === "circle") {
            const cx = parseFloat(getAttrAnyCI(el, ["cx", "x"]) || "0");
            const cy = parseFloat(getAttrAnyCI(el, ["cy", "y"]) || "0");
            const rx = parseFloat(getAttrAnyCI(el, ["rx", "r"]) || "5");
            const ry = parseFloat(getAttrAnyCI(el, ["ry", "r"]) || "5");
            const stroke = normalizeIconStroke(getAttrCI(el, "stroke"));
            const fillStyle = (getAttrCI(el, "fill-style") || "").toLowerCase();
            const fill = fillStyle === "solid" ? "currentColor" : "none";
            items.push({
              type: "ellipse",
              x1: cx - rx,
              y1: cy - ry,
              x2: cx + rx,
              y2: cy + ry,
              svgMarkup: `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="${stroke}" fill="${fill}" />`,
            });
          } else if (tag === "path") {
            const d = getAttrCI(el, "d") || "";
            if (d) {
              const nums = (d.match(/[-+]?\d*\.?\d+/g) || []).map(Number);
              if (nums.length >= 2) {
                const xs = nums.filter((_, i) => i % 2 === 0);
                const ys = nums.filter((_, i) => i % 2 === 1);
                const stroke = normalizeIconStroke(getAttrCI(el, "stroke"));
                items.push({
                  type: "path",
                  x1: Math.min(...xs),
                  y1: Math.min(...ys),
                  x2: Math.max(...xs),
                  y2: Math.max(...ys),
                  svgMarkup: `<path d="${escapeXml(d)}" stroke="${stroke}" fill="none" />`,
                });
              }
            }
          } else if (tag === "polygon") {
            const pointsRaw = getAttrCI(el, "points") || "";
            const pts = pointsRaw
              .trim()
              .split(/\s+/)
              .map((p) => p.split(",").map(Number));
            if (pts.length >= 3) {
              const xs = pts.map((p) => p[0] || 0);
              const ys = pts.map((p) => p[1] || 0);
              const stroke = normalizeIconStroke(getAttrCI(el, "stroke"));
              items.push({
                type: "polygon",
                x1: Math.min(...xs),
                y1: Math.min(...ys),
                x2: Math.max(...xs),
                y2: Math.max(...ys),
                svgMarkup: `<polygon points="${escapeXml(pointsRaw)}" stroke="${stroke}" fill="none" />`,
              });
            }
          } else if (tag === "text") {
            const tx = parseFloat(getAttrCI(el, "x") || "0");
            const ty = parseFloat(getAttrCI(el, "y") || "0");
            const t = elementText(el);
            if (t && !t.startsWith("%") && t.length <= 6) {
              const stroke = normalizeIconStroke(getAttrAnyCI(el, ["stroke", "fill"]));
              items.push({
                type: "text",
                x1: tx - 8,
                y1: ty - 8,
                x2: tx + 8,
                y2: ty + 8,
                svgMarkup: `<text x="${tx}" y="${ty}" fill="${stroke}" font-size="11" font-family="system-ui, sans-serif" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${escapeXml(t)}</text>`,
              });
            }
          }
        }
        walkSvg(el);
      }
    };
    walkSvg(svgEl);
  }

  // 2. If no SVG items were parsed, fall back to <graphics> section
  if (items.length === 0) {
    const graphicsEl = findFirstCI(rootEl, "graphics");
    if (graphicsEl) {
      for (const gfxEl of findDescendantsCI(graphicsEl, new Set(["gfx"]))) {
        const classId = getAttrCI(gfxEl, "classid") ?? "";
        const classMatch = /^Graphics\.([A-Za-z]+)$/i.exec(classId);
        if (!classMatch) continue;
        const kind = classMatch[1]!;

        if (kind === "Rectangle") {
          const rx = parseFloat(getAttrCI(gfxEl, "x") ?? "0");
          const ry = parseFloat(getAttrCI(gfxEl, "y") ?? "0");
          const rw = parseFloat(getAttrCI(gfxEl, "w") ?? "0");
          const rh = parseFloat(getAttrCI(gfxEl, "h") ?? "0");
          items.push({
            type: "rect",
            x1: rx,
            y1: ry,
            x2: rx + rw,
            y2: ry + rh,
            svgMarkup: `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="1" ry="1" fill="none" stroke="currentColor" />`,
          });
        } else if (kind === "Line") {
          const lx = parseFloat(getAttrCI(gfxEl, "x") ?? "0");
          const ly = parseFloat(getAttrCI(gfxEl, "y") ?? "0");
          const pts: string[] = [];
          const xs: number[] = [];
          const ys: number[] = [];
          for (const vEl of findDescendantsCI(gfxEl, new Set(["vertex"]))) {
            const vx = lx + parseFloat(getAttrCI(vEl, "x") ?? "0");
            const vy = ly + parseFloat(getAttrCI(vEl, "y") ?? "0");
            xs.push(vx);
            ys.push(vy);
            pts.push(`${vx},${vy}`);
          }
          if (pts.length >= 2) {
            items.push({
              type: "line",
              x1: Math.min(...xs),
              y1: Math.min(...ys),
              x2: Math.max(...xs),
              y2: Math.max(...ys),
              svgMarkup: `<polyline points="${pts.join(" ")}" fill="none" stroke="currentColor" />`,
            });
          }
        }
      }
    }
  }

  // 3. Fallback for elements with no graphic items (e.g. annotation)
  if (items.length === 0) {
    if (defName.toLowerCase().includes("annotation") || defName.toLowerCase().includes("text")) {
      items.push({
        type: "raw",
        x1: -8,
        y1: -8,
        x2: 8,
        y2: 8,
        svgMarkup: `<rect x="-7" y="-7" width="14" height="14" rx="2" fill="none" stroke="currentColor" /><line x1="-4" y1="-3" x2="4" y2="-3" stroke="currentColor" /><line x1="-4" y1="0" x2="4" y2="0" stroke="currentColor" /><line x1="-4" y1="3" x2="1" y2="3" stroke="currentColor" />`,
      });
    } else {
      items.push({
        type: "raw",
        x1: -7,
        y1: -7,
        x2: 7,
        y2: 7,
        svgMarkup: `<rect x="-6" y="-6" width="12" height="12" rx="2" fill="none" stroke="currentColor" /><line x1="-6" y1="-2" x2="-8" y2="-2" stroke="currentColor" /><line x1="-6" y1="2" x2="-8" y2="2" stroke="currentColor" /><line x1="6" y1="0" x2="8" y2="0" stroke="currentColor" />`,
      });
    }
  }

  const minX = Math.min(...items.map((i) => i.x1));
  const minY = Math.min(...items.map((i) => i.y1));
  const maxX = Math.max(...items.map((i) => i.x2));
  const maxY = Math.max(...items.map((i) => i.y2));

  const w = maxX - minX;
  const h = maxY - minY;
  const maxDim = Math.max(w, h, 12);
  const pad = Math.max(2.0, maxDim * 0.15);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const vbSize = maxDim + 2 * pad;
  const vbX = cx - vbSize / 2;
  const vbY = cy - vbSize / 2;

  const sw = Math.max(1.2, (vbSize / 16.0) * 1.35);
  const innerSvg = items.map((i) => i.svgMarkup).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX.toFixed(2)} ${vbY.toFixed(2)} ${vbSize.toFixed(2)} ${vbSize.toFixed(2)}" width="${size}" height="${size}" stroke-width="${sw.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"><style>:root { color: #0f172a; } @media (prefers-color-scheme: dark) { :root { color: #f8fafc; } }</style>${innerSvg}</svg>`;
}

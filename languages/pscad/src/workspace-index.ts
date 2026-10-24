// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { registerPscadSource } from "./model/workspace-registry.js";
import { parseFlyBySegment } from "./script/script-parser.js";
import type { PscadFlyByDoc } from "./types.js";

/**
 * Workspace symbol indexer for PSCAD projects (.pslx libraries, .pscx cases, .pswx workspaces).
 *
 * Emits unified package symbols for libraries/cases, and class/block symbols
 * for all contained component definitions (<Definition classid="UserCmpDefn">).
 */
export class PscadWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileBaseIds = new Map<string, number>();
  private nextFileSlot = 1;

  get version(): number {
    return this._version;
  }

  get fileCount(): number {
    return this.fileIndices.size;
  }

  public has(uri: string): boolean {
    return this.fileIndices.has(uri);
  }

  public getFileIndex(uri: string): SymbolIndex | undefined {
    return this.fileIndices.get(uri);
  }

  public register(uri: string, _loader?: () => any): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public reindexDocument(uri: string, loader?: () => any): void {
    this._version++;
    if (loader) {
      try {
        const res = loader();
        const text = typeof res === "string" ? res : (res?.sourceText ?? res?.text);
        if (typeof text === "string") {
          this.indexFile(uri, text);
        }
      } catch {
        // Ignore loader errors during incremental re-indexing
      }
    }
  }

  /**
   * Indexes a PSCAD project or library file.
   */
  public indexFile(uri: string, text: string): SymbolIndex {
    registerPscadSource(uri, text);
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    // Collision-free monotonic slot allocation per file URI
    let baseId = this.fileBaseIds.get(uri);
    if (baseId === undefined) {
      baseId = this.nextFileSlot++ * 100_000;
      this.fileBaseIds.set(uri, baseId);
    }
    let idCounter = baseId;

    // 1. Extract project name and type
    const projectMatch = /<project\b([^>]*?)>/i.exec(text);
    const projAttrs = projectMatch ? projectMatch[1]! : "";
    const nameMatch = /name\s*=\s*["']([^"']+)["']/i.exec(projAttrs);
    const targetMatch =
      /target\s*=\s*["']([^"']+)["']/i.exec(projAttrs) || /type\s*=\s*["']([^"']+)["']/i.exec(projAttrs);

    const isLibrary =
      uri.toLowerCase().endsWith(".pslx") || (targetMatch ? targetMatch[1]!.toLowerCase().includes("library") : false);

    const projectName = nameMatch && nameMatch[1]!.trim() !== "" ? nameMatch[1]!.trim() : this.deriveNameFromUri(uri);

    // Root symbol (e.g. Component_Lib)
    const rootId = idCounter++;
    const rootEntry: SymbolEntry = {
      id: rootId,
      kind: "Class",
      name: projectName,
      ruleName: isLibrary ? "pscad_library" : "pscad_project",
      namePath: projectName,
      startOffset: projectMatch ? projectMatch.index : 0,
      endOffset: text.length,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: {
        classPrefixes: isLibrary ? "package" : "model",
        language: "pscad",
        projectType: isLibrary ? "library" : "case",
      },
      fieldName: null,
      resourceId: uri,
      language: "pscad",
    };

    symbols.set(rootId, rootEntry);
    byName.set(projectName, [rootId]);

    const rootChildren: SymbolId[] = [];
    childrenOf.set(null, [rootId]);
    childrenOf.set(rootId, rootChildren);

    // 2. Extract component definitions from <definitions>
    const defRegex = /<Definition\b([^>]*?)>([\s\S]*?)<\/Definition>/gi;
    let defMatch: RegExpExecArray | null;

    while ((defMatch = defRegex.exec(text)) !== null) {
      const dAttrs = defMatch[1]!;
      const dBody = defMatch[2]!;
      const defName = /name\s*=\s*["']([^"']+)["']/i.exec(dAttrs)?.[1];
      const classId = /classid\s*=\s*["']([^"']+)["']/i.exec(dAttrs)?.[1];

      // Only index user component definitions, and skip internal drawing station canvas
      if (!defName || classId !== "UserCmpDefn") continue;
      if (defName === "DS") continue;

      const descMatch = /<param\s+name\s*=\s*["']Description["']\s+value\s*=\s*["']([^"']*)["']/i.exec(dBody);
      let desc = descMatch ? descMatch[1] : undefined;
      const flyByMatch = /<segment\b[^>]*?name\s*=\s*["']FlyBy["'][^>]*>([\s\S]*?)<\/segment>/i.exec(dBody);
      let flyByDoc: PscadFlyByDoc | undefined;
      if (flyByMatch) {
        let flyByText = flyByMatch[1]!;
        const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/i.exec(flyByText);
        if (cdata) flyByText = cdata[1]!;
        flyByDoc = parseFlyBySegment(flyByText);
        if ((!desc || !desc.trim()) && flyByDoc.summary) {
          desc = flyByDoc.summary.split("\n")[0]?.trim();
        }
      }
      const iconSvg = renderPscadDefinitionIconSvg(dBody, 16, defName);

      const childId = idCounter++;
      const childEntry: SymbolEntry = {
        id: childId,
        kind: "Class",
        name: defName,
        ruleName: "pscad_component",
        namePath: `${projectName}.${defName}`,
        startOffset: defMatch.index,
        endOffset: defMatch.index + defMatch[0].length,
        parentId: rootId,
        exports: [],
        inherits: [],
        metadata: {
          classPrefixes: dBody.includes("<schematic") ? "model" : "block",
          language: "pscad",
          description: desc,
          iconSvg,
          flyBy: flyByDoc,
        },
        fieldName: null,
        resourceId: uri,
        language: "pscad",
      };

      symbols.set(childId, childEntry);
      rootChildren.push(childId);
      childrenOf.set(childId, []);

      const existingNames = byName.get(defName) || [];
      existingNames.push(childId);
      byName.set(defName, existingNames);
    }

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);
    this._version++;
    return index;
  }

  public parsePscadFile(uri: string, text: string): SymbolIndex {
    return this.indexFile(uri, text);
  }

  public toUnified(): SymbolIndex {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    const rootList: SymbolId[] = [];
    childrenOf.set(null, rootList);

    for (const fileIndex of this.fileIndices.values()) {
      for (const [id, entry] of fileIndex.symbols) {
        symbols.set(id, entry);
      }
      for (const [name, ids] of fileIndex.byName) {
        const existing = byName.get(name) || [];
        existing.push(...ids);
        byName.set(name, existing);
      }
      for (const [pId, cIds] of fileIndex.childrenOf) {
        if (pId === null) {
          rootList.push(...cIds);
        } else {
          const existing = childrenOf.get(pId) || [];
          existing.push(...cIds);
          childrenOf.set(pId, existing);
        }
      }
    }

    return { symbols, byName, childrenOf };
  }

  public toTreeIndex(): SymbolIndex {
    return this.toUnified();
  }

  public toSymbolIndex(): SymbolIndex {
    return this.toUnified();
  }

  public toUnifiedPartial(): SymbolIndex {
    return this.toUnified();
  }

  private deriveNameFromUri(uri: string): string {
    const raw = uri.split("/").pop() || uri;
    return raw.replace(/\.(pslx|pscx|pswx|psmx)$/i, "");
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

export function renderPscadDefinitionIconSvg(dBody: string, size = 16, defName = ""): string | undefined {
  interface VisualItem {
    type: "rect" | "line" | "circle" | "ellipse" | "path" | "polygon" | "text" | "raw";
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    svgMarkup: string;
  }
  const items: VisualItem[] = [];

  // 1. Try parsing <svg> section first (richest representation in modern PSCAD)
  const svgMatch = /<svg\b[^>]*>([\s\S]*?)<\/svg>/i.exec(dBody);
  if (svgMatch) {
    const svgXml = svgMatch[1]!;
    const tagRegex = /<(cond|rect|line|circle|ellipse|path|polygon|text)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
    let isCondActive = true;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(svgXml)) !== null) {
      const tag = match[1]!.toLowerCase();
      const attrsStr = match[2]!;
      const bodyText = (match[3] ?? "").trim();

      if (tag === "cond") {
        if (bodyText.includes("Dim!=1") || bodyText.includes("Dim > 1") || bodyText.includes("CmplxParts")) {
          isCondActive = false;
        } else if (bodyText.includes("true") || bodyText === "") {
          isCondActive = true;
        }
        continue;
      }

      if (!isCondActive) continue;

      const getAttr = (name: string): string | undefined => {
        const re = new RegExp(`\\b${name}=["']([^"']*)["']`, "i");
        return re.exec(attrsStr)?.[1];
      };

      if (tag === "rect") {
        const x = parseFloat(getAttr("x") || "0");
        const y = parseFloat(getAttr("y") || "0");
        const w = parseFloat(getAttr("width") || "0");
        const h = parseFloat(getAttr("height") || "0");
        if (w <= 0 || h <= 0) continue;
        const stroke = normalizeIconStroke(getAttr("stroke"));
        const fillStyle = (getAttr("fill-style") || "").toLowerCase();
        const fillFg = (getAttr("fill-fg") || "").toLowerCase();
        const fill = fillStyle === "solid" && (fillFg === "black" || fillFg === "#000000") ? "currentColor" : "none";
        items.push({
          type: "rect",
          x1: x,
          y1: y,
          x2: x + w,
          y2: y + h,
          svgMarkup: `<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${stroke}" fill="${fill}" rx="1" ry="1" />`,
        });
      } else if (tag === "line") {
        const x1 = parseFloat(getAttr("x1") || "0");
        const y1 = parseFloat(getAttr("y1") || "0");
        const x2 = parseFloat(getAttr("x2") || "0");
        const y2 = parseFloat(getAttr("y2") || "0");
        const stroke = normalizeIconStroke(getAttr("stroke"));
        items.push({
          type: "line",
          x1: Math.min(x1, x2),
          y1: Math.min(y1, y2),
          x2: Math.max(x1, x2),
          y2: Math.max(y1, y2),
          svgMarkup: `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" />`,
        });
      } else if (tag === "ellipse" || tag === "circle") {
        const cx = parseFloat(getAttr("cx") || getAttr("x") || "0");
        const cy = parseFloat(getAttr("cy") || getAttr("y") || "0");
        const rx = parseFloat(getAttr("rx") || getAttr("r") || "5");
        const ry = parseFloat(getAttr("ry") || getAttr("r") || "5");
        const stroke = normalizeIconStroke(getAttr("stroke"));
        const fillStyle = (getAttr("fill-style") || "").toLowerCase();
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
        const d = getAttr("d") || "";
        if (!d) continue;
        const nums = (d.match(/[-+]?\d*\.?\d+/g) || []).map(Number);
        if (nums.length >= 2) {
          const xs = nums.filter((_, i) => i % 2 === 0);
          const ys = nums.filter((_, i) => i % 2 === 1);
          const stroke = normalizeIconStroke(getAttr("stroke"));
          items.push({
            type: "path",
            x1: Math.min(...xs),
            y1: Math.min(...ys),
            x2: Math.max(...xs),
            y2: Math.max(...ys),
            svgMarkup: `<path d="${d}" stroke="${stroke}" fill="none" />`,
          });
        }
      } else if (tag === "polygon") {
        const pts = (getAttr("points") || "")
          .trim()
          .split(/\s+/)
          .map((p) => p.split(",").map(Number));
        if (pts.length >= 3) {
          const xs = pts.map((p) => p[0] || 0);
          const ys = pts.map((p) => p[1] || 0);
          const stroke = normalizeIconStroke(getAttr("stroke"));
          items.push({
            type: "polygon",
            x1: Math.min(...xs),
            y1: Math.min(...ys),
            x2: Math.max(...xs),
            y2: Math.max(...ys),
            svgMarkup: `<polygon points="${getAttr("points")}" stroke="${stroke}" fill="none" />`,
          });
        }
      } else if (tag === "text") {
        const tx = parseFloat(getAttr("x") || "0");
        const ty = parseFloat(getAttr("y") || "0");
        const t = bodyText.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
        if (t && !t.startsWith("%") && t.length <= 6) {
          const stroke = normalizeIconStroke(getAttr("stroke") || getAttr("fill"));
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
  }

  // 2. If no SVG items were parsed, fall back to <graphics> section
  if (items.length === 0) {
    const graphicsMatch = /<graphics\b[^>]*>([\s\S]*?)<\/graphics>/i.exec(dBody);
    if (graphicsMatch) {
      const gXml = graphicsMatch[1]!;
      const gfxRegex = /<Gfx\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Gfx>)/gi;
      let gMatch: RegExpExecArray | null;
      while ((gMatch = gfxRegex.exec(gXml)) !== null) {
        const attrs = gMatch[1]!;
        const body = gMatch[2] ?? "";
        const classMatch = attrs.match(/\bclassid=["']Graphics\.([A-Za-z]+)["']/i);
        if (!classMatch) continue;
        const kind = classMatch[1]!;

        if (kind === "Rectangle") {
          const rx = parseFloat(attrs.match(/\bx=["']([^"']+)["']/i)?.[1] ?? "0");
          const ry = parseFloat(attrs.match(/\by=["']([^"']+)["']/i)?.[1] ?? "0");
          const rw = parseFloat(attrs.match(/\bw=["']([^"']+)["']/i)?.[1] ?? "0");
          const rh = parseFloat(attrs.match(/\bh=["']([^"']+)["']/i)?.[1] ?? "0");
          items.push({
            type: "rect",
            x1: rx,
            y1: ry,
            x2: rx + rw,
            y2: ry + rh,
            svgMarkup: `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="1" ry="1" fill="none" stroke="currentColor" />`,
          });
        } else if (kind === "Line") {
          const lx = parseFloat(attrs.match(/\bx=["']([^"']+)["']/i)?.[1] ?? "0");
          const ly = parseFloat(attrs.match(/\by=["']([^"']+)["']/i)?.[1] ?? "0");
          const vertRegex = /<vertex\b([^>]*)>/gi;
          let vMatch: RegExpExecArray | null;
          const pts: string[] = [];
          const xs: number[] = [];
          const ys: number[] = [];
          while ((vMatch = vertRegex.exec(body)) !== null) {
            const vAttrs = vMatch[1]!;
            const vx = lx + parseFloat(vAttrs.match(/\bx=["']([^"']+)["']/i)?.[1] ?? "0");
            const vy = ly + parseFloat(vAttrs.match(/\by=["']([^"']+)["']/i)?.[1] ?? "0");
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

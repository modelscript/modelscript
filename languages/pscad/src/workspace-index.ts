// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";

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
    const projectMatch = /<project\s+([^>]*?)>/i.exec(text);
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
      startByte: projectMatch ? projectMatch.index : 0,
      endByte: text.length,
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
    const defRegex = /<Definition\s+([^>]*?)>([\s\S]*?)<\/Definition>/gi;
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
      const desc = descMatch ? descMatch[1] : undefined;
      const iconSvg = renderPscadDefinitionIconSvg(dBody);

      const childId = idCounter++;
      const childEntry: SymbolEntry = {
        id: childId,
        kind: "Class",
        name: defName,
        ruleName: "pscad_component",
        namePath: `${projectName}.${defName}`,
        startByte: defMatch.index,
        endByte: defMatch.index + defMatch[0].length,
        parentId: rootId,
        exports: [],
        inherits: [],
        metadata: {
          classPrefixes: dBody.includes("<schematic") ? "model" : "block",
          language: "pscad",
          description: desc,
          iconSvg,
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

export function renderPscadDefinitionIconSvg(dBody: string, size = 16): string | undefined {
  const graphicsMatch = /<graphics\s*[^>]*>([\s\S]*?)<\/graphics>/i.exec(dBody);
  if (!graphicsMatch) return undefined;
  const gXml = graphicsMatch[1]!;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  interface SvgItem {
    type: "rect" | "line" | "circle" | "text";
    attrs: Record<string, string | number>;
    content?: string | undefined;
  }
  const items: SvgItem[] = [];

  // 1. Ports
  const portRegex = /<Port\s+[^>]*?x\s*=\s*["']([^"']+)["'][^>]*?y\s*=\s*["']([^"']+)["'][^>]*?>/gi;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = portRegex.exec(gXml)) !== null) {
    const px = parseFloat(pMatch[1]!);
    const py = parseFloat(pMatch[2]!);
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
    items.push({
      type: "circle",
      attrs: { cx: px, cy: py, r: 2.5, fill: "#38bdf8" },
    });
  }

  // 2. Rectangles
  const rectRegex =
    /<Gfx\s+classid=["']Graphics\.Rectangle["'][^>]*?x=["']([^"']+)["'][^>]*?y=["']([^"']+)["'][^>]*?w=["']([^"']+)["'][^>]*?h=["']([^"']+)["']/gi;
  let rMatch: RegExpExecArray | null;
  while ((rMatch = rectRegex.exec(gXml)) !== null) {
    const rx = parseFloat(rMatch[1]!);
    const ry = parseFloat(rMatch[2]!);
    const rw = parseFloat(rMatch[3]!);
    const rh = parseFloat(rMatch[4]!);
    minX = Math.min(minX, rx);
    maxX = Math.max(maxX, rx + rw);
    minY = Math.min(minY, ry);
    maxY = Math.max(maxY, ry + rh);
    items.push({
      type: "rect",
      attrs: {
        x: rx,
        y: ry,
        width: rw,
        height: rh,
        rx: 3,
        ry: 3,
        fill: "#1e293b",
        stroke: "#38bdf8",
        "stroke-width": 1.5,
      },
    });
  }

  // 3. Lines
  const lineRegex =
    /<Gfx\s+classid=["']Graphics\.Line["'][^>]*?x=["']([^"']+)["'][^>]*?y=["']([^"']+)["'][^>]*?>([\s\S]*?)<\/Gfx>/gi;
  let lMatch: RegExpExecArray | null;
  while ((lMatch = lineRegex.exec(gXml)) !== null) {
    const lx = parseFloat(lMatch[1]!);
    const ly = parseFloat(lMatch[2]!);
    const lBody = lMatch[3]!;
    const vertRegex = /<vertex\s+x=["']([^"']+)["']\s+y=["']([^"']+)["']/gi;
    let vMatch: RegExpExecArray | null;
    const pts: string[] = [];
    while ((vMatch = vertRegex.exec(lBody)) !== null) {
      const vx = lx + parseFloat(vMatch[1]!);
      const vy = ly + parseFloat(vMatch[2]!);
      minX = Math.min(minX, vx);
      maxX = Math.max(maxX, vx);
      minY = Math.min(minY, vy);
      maxY = Math.max(maxY, vy);
      pts.push(`${vx},${vy}`);
    }
    if (pts.length >= 2) {
      items.push({
        type: "line",
        attrs: {
          points: pts.join(" "),
          fill: "none",
          stroke: "#38bdf8",
          "stroke-width": 1.5,
          "stroke-linecap": "round",
        },
      });
    }
  }

  // 4. Texts
  const textRegex =
    /<Gfx\s+classid=["']Graphics\.Text["'][^>]*?x=["']([^"']+)["'][^>]*?y=["']([^"']+)["'][^>]*?>([\s\S]*?)<\/Gfx>/gi;
  let tMatch: RegExpExecArray | null;
  while ((tMatch = textRegex.exec(gXml)) !== null) {
    const tx = parseFloat(tMatch[1]!);
    const ty = parseFloat(tMatch[2]!);
    const tBody = tMatch[3]!;
    const valMatch = /<param\s+name=["']text["']\s+value=["']([^"']*)["']/i.exec(tBody);
    const textVal = valMatch ? valMatch[1] : "";
    if (textVal && textVal.length <= 4 && !textVal.startsWith("%")) {
      items.push({
        type: "text",
        attrs: {
          x: tx,
          y: ty + 4,
          fill: "#f8fafc",
          "font-size": 11,
          "font-family": "sans-serif",
          "text-anchor": "middle",
        },
        content: textVal,
      });
    }
  }

  if (!isFinite(minX) || !isFinite(minY)) {
    minX = -30;
    minY = -30;
    maxX = 30;
    maxY = 30;
  }

  const pad = 6;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = Math.max(20, maxX - minX + 2 * pad);
  const vbH = Math.max(20, maxY - minY + 2 * pad);

  let innerSvg = "";
  for (const item of items) {
    if (item.type === "rect") {
      const a = Object.entries(item.attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      innerSvg += `<rect ${a} />`;
    }
  }
  for (const item of items) {
    if (item.type === "line") {
      const a = Object.entries(item.attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      innerSvg += `<polyline ${a} />`;
    }
  }
  for (const item of items) {
    if (item.type === "circle") {
      const a = Object.entries(item.attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      innerSvg += `<circle ${a} />`;
    }
  }
  for (const item of items) {
    if (item.type === "text") {
      const a = Object.entries(item.attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      innerSvg += `<text ${a}>${escapeXml(item.content || "")}</text>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${size}" height="${size}">${innerSvg}</svg>`;
}

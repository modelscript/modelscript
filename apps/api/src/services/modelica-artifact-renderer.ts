// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { NodeFileSystem } from "../util/filesystem.js";

export type ModelicaPreviewMode = "diagram" | "icon" | "simulation" | "code";

export interface ModelicaSimulationSeries {
  name: string;
  values: number[];
}

export interface ModelicaArtifactPreprocessResult {
  svg: string;
  previewMode: ModelicaPreviewMode;
  title: string;
  className: string;
  classKind: string;
  isPartial: boolean;
  metadata: Record<string, unknown>;
  viewConfigAdditions: Record<string, unknown>;
}

class OverlayFileSystem extends NodeFileSystem {
  private readonly virtualFiles = new Map<string, string>();

  setVirtualFile(filePath: string, content: string): void {
    this.virtualFiles.set(filePath, content);
  }

  override read(filePath: string): string {
    const virtual = this.virtualFiles.get(filePath);
    if (virtual !== undefined) return virtual;
    return super.read(filePath);
  }
}

let parserInitPromise: Promise<void> | null = null;

async function ensureModelicaRuntime(): Promise<void> {
  if (!parserInitPromise) {
    parserInitPromise = (async () => {
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      let wasmPath: string;
      try {
        wasmPath = require.resolve("@modelscript/modelica/parser.wasm");
      } catch {
        wasmPath = require.resolve("@modelscript/modelica/dist/parser.wasm");
      }
      const { createWasmParser } = await import("@modelscript/modelica/parser");
      const { parser } = await createWasmParser(wasmPath);
      const { Context } = await import("@modelscript/modelica/context");
      Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
      const { initBltWasm } = await import("@modelscript/runtime");
      await initBltWasm();
    })();
  }
  await parserInitPromise;
}

function escapeXml(str: string): string {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hasVisualElements(svg: string): boolean {
  if (!svg || !svg.trim()) return false;
  // Strip purely transparent bounding rects before checking
  const stripped = svg.replace(/<rect[^>]*fill:\s*transparent[^>]*\/?>/gi, "");
  return /<(line|rect|circle|path|polygon|polyline|ellipse|text|image)\b/i.test(stripped);
}

const CLASS_KIND_KEYWORDS = [
  "class",
  "model",
  "record",
  "block",
  "connector",
  "type",
  "package",
  "function",
  "operator",
  "optimization",
];

function classKindFromEntry(entry: { metadata?: Record<string, unknown> | undefined } | null | undefined): string {
  const prefixesText = entry?.metadata?.["classPrefixes"] ?? entry?.metadata?.["classKind"];
  if (typeof prefixesText !== "string" || !prefixesText) return "model";
  const lower = prefixesText.toLowerCase();
  for (let i = CLASS_KIND_KEYWORDS.length - 1; i >= 0; i--) {
    const kw = CLASS_KIND_KEYWORDS[i];
    if (kw && lower.includes(kw)) return kw;
  }
  return "model";
}

function isEntryPartial(
  entry: { metadata?: Record<string, unknown> | undefined } | null | undefined,
  content: string,
  className: string,
): boolean {
  const prefixesText = entry?.metadata?.["classPrefixes"];
  if (typeof prefixesText === "string" && /\bpartial\b/i.test(prefixesText)) {
    return true;
  }
  if (entry?.metadata?.["isPartial"]) {
    return true;
  }
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const partialRe = new RegExp(
    `\\bpartial\\s+(?:encapsulated\\s+|expandable\\s+|pure\\s+|impure\\s+)*(?:model|class|block|connector|record|function|package|type|operator)\\s+${escaped}\\b`,
  );
  return partialRe.test(content);
}

function findMslExtractedDir(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "data/libraries/Modelica/4.1.0/extracted/Modelica"),
    path.resolve(process.cwd(), "../../data/libraries/Modelica/4.1.0/extracted/Modelica"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function resolveReferencedMslFiles(content: string, mslDir: string): string[] {
  const files = new Set<string>();
  const refRe = /\bModelica(?:\.[A-Za-z_][A-Za-z0-9_]*)+/g;
  let m: RegExpExecArray | null;
  while ((m = refRe.exec(content)) !== null) {
    const parts = m[0].split(".").slice(1); // drop leading 'Modelica'
    if (parts.length === 0) continue;
    // Try progressively shorter prefixes to locate the .mo file on disk
    for (let len = parts.length; len >= 1; len--) {
      const subParts = parts.slice(0, len);
      const directFile = path.join(mslDir, ...subParts) + ".mo";
      if (fs.existsSync(directFile)) {
        files.add(directFile);
        // Also check sibling Interfaces.mo or package.mo in the same directory
        const parentDir = path.dirname(directFile);
        const interfacesFile = path.join(parentDir, "Interfaces.mo");
        if (fs.existsSync(interfacesFile)) files.add(interfacesFile);
        break;
      }
      const pkgFile = path.join(mslDir, ...subParts, "package.mo");
      if (fs.existsSync(pkgFile)) {
        files.add(pkgFile);
      }
    }
  }
  const iconsFile = path.join(mslDir, "Icons.mo");
  if ((content.includes("Icons.") || files.size > 0) && fs.existsSync(iconsFile)) {
    files.add(iconsFile);
  }
  return Array.from(files);
}

function linkMslHierarchyInContext(context: {
  queryEngine: {
    index: {
      symbols: Map<number, Record<string, unknown>>;
      byName: Map<string, number[]>;
      childrenOf: Map<number | null, number[]>;
    };
  };
}): void {
  const index = context.queryEngine.index;
  let nextSyntheticId = 900_000;

  const ensurePackageSymbol = (fqn: string): number => {
    const parts = fqn.split(".");
    let parentId: number | null = null;
    let currentFqn = "";
    for (const part of parts) {
      currentFqn = currentFqn ? `${currentFqn}.${part}` : part;
      let existingId: number | undefined;
      const candidates = index.byName.get(part) || [];
      for (const cid of candidates) {
        const sym = index.symbols.get(cid);
        if (!sym) continue;
        if (sym["parentId"] === parentId && sym["kind"] === "Class") {
          existingId = cid;
          break;
        }
      }
      if (existingId === undefined) {
        existingId = nextSyntheticId++;
        index.symbols.set(existingId, {
          id: existingId,
          name: part,
          qualifiedName: currentFqn,
          kind: "Class",
          parentId,
          resourceId: "synthetic://msl",
          startOffset: 0,
          endOffset: 0,
          metadata: { classKind: "package", classPrefixes: "package" },
        });
        const list = index.byName.get(part) || [];
        if (!list.includes(existingId)) {
          list.push(existingId);
          index.byName.set(part, list);
        }
        const siblings: number[] = index.childrenOf.get(parentId) || [];
        if (!siblings.includes(existingId)) {
          siblings.push(existingId);
          index.childrenOf.set(parentId, siblings);
        }
      }
      parentId = existingId;
    }
    return parentId!;
  };

  for (const [id, sym] of Array.from(index.symbols.entries())) {
    if (sym["kind"] !== "Class") continue;
    const resId = typeof sym["resourceId"] === "string" ? sym["resourceId"] : "";
    if (!resId || resId === "/__virtual__/artifact.mo" || resId === "synthetic://msl") continue;
    if (sym["parentId"] !== null && sym["parentId"] !== undefined && sym["parentId"] !== id) continue;

    const normalized = resId.replace(/\\/g, "/");
    const m = normalized.match(/\/Modelica\/(.+)\.mo$/);
    if (!m || !m[1]) continue;
    const relParts = m[1].split("/").filter(Boolean);
    if (relParts[relParts.length - 1] === "package") {
      relParts.pop();
    }
    // Check if the root symbol is already the file's top-level package/class
    const symName = String(sym["name"] || "");
    if (relParts[relParts.length - 1] === symName) {
      relParts.pop();
    }
    const parentFqn = ["Modelica", ...relParts].join(".");
    const pkgId = ensurePackageSymbol(parentFqn);
    if (pkgId !== id) {
      sym["parentId"] = pkgId;
      const children: number[] = index.childrenOf.get(pkgId) || [];
      if (!children.includes(id)) {
        children.push(id);
        index.childrenOf.set(pkgId, children);
      }
    }
  }
}

function resolveSymbolIdByName(
  context: {
    queryEngine: {
      index: {
        byName: Map<string, number[]>;
        symbols: Map<number, Record<string, unknown>>;
      };
      toQueryDB: () => {
        childrenOf: (id: number) => { id?: number | undefined; name?: string | undefined }[] | undefined;
        symbol: (id: number) => Record<string, unknown> | undefined;
      };
    };
  },
  name: string,
): number | null {
  const parts = name.replace(/^\./, "").split(".");
  if (parts.length > 1) {
    const first = parts[0]!;
    const rootCandidates = context.queryEngine.index.byName.get(first) || [];
    const db = context.queryEngine.toQueryDB();
    for (const rootId of rootCandidates) {
      let curr: number | undefined = rootId;
      for (let i = 1; i < parts.length; i++) {
        if (typeof curr !== "number") break;
        const children: { id?: number | undefined; name?: string | undefined }[] = db.childrenOf(curr) || [];
        const match: { id?: number | undefined; name?: string | undefined } | undefined = children.find(
          (c: { id?: number | undefined; name?: string | undefined }) => c.name === parts[i],
        );
        curr = match?.id;
      }
      if (typeof curr === "number") return curr;
    }
  }
  const byName = context.queryEngine.index.byName.get(name);
  if (byName && byName.length > 0 && typeof byName[0] === "number") return byName[0];
  const shortName = parts[parts.length - 1];
  if (shortName) {
    const shortMatches = context.queryEngine.index.byName.get(shortName);
    if (shortMatches && shortMatches.length > 0 && typeof shortMatches[0] === "number") {
      return shortMatches[0];
    }
  }
  return null;
}

interface CstNodeLike {
  type?: string | undefined;
  text?: string | undefined;
  children?: CstNodeLike[] | undefined;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function buildClassAdapter(
  context: any,
  symbolId: number,
  AnnotationEvaluatorClass: any,
  visited = new Set<number>(),
): any {
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (visited.has(symbolId)) return null;
  visited.add(symbolId);

  const queryDB = context.queryEngine.toQueryDB();
  const entry = queryDB.symbol(symbolId);
  if (!entry) return null;
  const cstNode = queryDB.cstNode(symbolId) as CstNodeLike | null;
  const children = queryDB.childrenOf(symbolId) || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const components: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connectEquations: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extendsClassInstances: any[] = [];

  for (const child of children) {
    if (child.kind === "Component" || child.kind === "Variable") {
      const childCst = queryDB.cstNode(child.id) as CstNodeLike | null;
      let childClassId = queryDB.query("classInstance", child.id) as number | undefined;
      const typeSpec = String(child.metadata?.["typeSpecifier"] || child.typeName || "");
      if (typeof childClassId !== "number" && typeSpec) {
        const resolved = resolveSymbolIdByName(context, typeSpec);
        if (typeof resolved === "number") childClassId = resolved;
      }
      const compCls =
        typeof childClassId === "number"
          ? buildClassAdapter(context, childClassId, AnnotationEvaluatorClass, new Set(visited))
          : null;
      const childMod = queryDB.query("effectiveModification", child.id) as
        | {
            bindingExpression?: { text?: string | undefined; value?: unknown } | undefined;
            args?: { name?: string | undefined; value?: { text?: string | undefined } | unknown }[] | undefined;
          }
        | undefined;
      let exprText = childMod?.bindingExpression?.text ?? childMod?.bindingExpression?.value;
      if (exprText === undefined && childMod?.args) {
        const startArg = childMod.args.find((a) => a.name === "start");
        if (startArg) {
          const rawVal = startArg.value;
          exprText =
            typeof rawVal === "object" && rawVal !== null && "text" in rawVal
              ? (rawVal as { text?: string | undefined }).text
              : rawVal;
        }
      }
      components.push({
        id: child.id,
        name: child.name,
        typeName: typeSpec || compCls?.name,
        entry: child,
        cstNode: childCst,
        abstractSyntaxNode: childCst,
        classInstance: compCls,
        classKind: compCls?.classKind ?? classKindFromEntry(child),
        modification: {
          expression: exprText !== undefined ? { text: String(exprText) } : undefined,
          getModificationArgument: (argName: string) => {
            const foundArg = childMod?.args?.find((a) => a.name === argName);
            if (foundArg) {
              const rawVal = foundArg.value;
              const valText =
                typeof rawVal === "object" && rawVal !== null && "text" in rawVal
                  ? (rawVal as { text?: string | undefined }).text
                  : rawVal;
              return { expression: valText !== undefined ? { text: String(valText) } : undefined };
            }
            return undefined;
          },
        },
      });
    } else if (child.kind === "ConnectEquation" || child.ruleName?.includes("connect")) {
      const connCst = queryDB.cstNode(child.id) as CstNodeLike | null;
      let lhs = "";
      let rhs = "";
      if (connCst) {
        const cRefs = (connCst.children || []).filter(
          (c: CstNodeLike) => c.type === "component_reference" || c.type === "ComponentReference",
        );
        if (cRefs.length > 0) lhs = cRefs[0]?.text?.trim() ?? "";
        if (cRefs.length > 1) rhs = cRefs[1]?.text?.trim() ?? "";
      }
      if (!lhs && child.metadata?.["lhs"]) lhs = String(child.metadata["lhs"]);
      if (!rhs && child.metadata?.["rhs"]) rhs = String(child.metadata["rhs"]);
      connectEquations.push({
        lhs,
        rhs,
        cstNode: connCst,
        annotation: (name: string) => (connCst ? new AnnotationEvaluatorClass().evaluate(connCst, name) : null),
      });
    } else if (child.kind === "Extends" || child.ruleName?.includes("extends")) {
      let baseSym = queryDB.query("resolvedBaseClass", child.id) as { id?: number | undefined } | null | undefined;
      const baseName = String(child.metadata?.["typeSpecifier"] || child.name || "");
      if (!baseSym && baseName) {
        const baseId = resolveSymbolIdByName(context, baseName);
        if (typeof baseId === "number") baseSym = queryDB.symbol(baseId);
      }
      if (baseSym && typeof baseSym.id === "number" && !visited.has(baseSym.id)) {
        const baseAdapter = buildClassAdapter(context, baseSym.id, AnnotationEvaluatorClass, new Set(visited));
        if (baseAdapter) {
          extendsClassInstances.push({ name: baseName, classInstance: baseAdapter });
        }
      } else if (baseName) {
        extendsClassInstances.push({ name: baseName, classInstance: null });
      }
    }
  }

  // Also include inherited components & connectEquations from extends classes so diagram & icon ports resolve
  for (const ext of extendsClassInstances) {
    if (ext.classInstance) {
      for (const baseComp of ext.classInstance.components || []) {
        if (!components.some((c) => c.name === baseComp.name)) {
          components.push(baseComp);
        }
      }
      for (const baseConn of ext.classInstance.connectEquations || []) {
        connectEquations.push(baseConn);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter: any = {
    id: symbolId,
    db: queryDB,
    context,
    cstNode,
    abstractSyntaxNode: cstNode,
    isClassInstance: true,
    name: entry.name,
    classKind: classKindFromEntry(entry),
    entry,
    components,
    connectEquations,
    extendsClassInstances,
  };

  adapter.resolveName = (parts: string[]) => {
    if (!parts || parts.length === 0) return null;
    const [first, ...rest] = parts;
    if (!first) return null;
    let found = components.find((c) => c.name === first);
    if (!found) {
      for (const ext of extendsClassInstances) {
        found = ext.classInstance?.resolveName?.([first]);
        if (found) break;
      }
    }
    if (!found) return null;
    if (rest.length === 0) return found;
    return found.classInstance?.resolveName?.(rest) ?? null;
  };

  const evaluator = new AnnotationEvaluatorClass(adapter);
  for (const comp of components) {
    comp.parent = adapter;
    const childCst = comp.cstNode ?? queryDB.cstNode(comp.id);
    comp.annotation = (name: string) => (childCst ? evaluator.evaluate(childCst, name) : null);
  }

  adapter.annotation = (
    name: string,
    _ctx?: { classInstance?: unknown; modification?: unknown; cstNode?: unknown },
  ) => {
    if (!cstNode) return null;
    if (_ctx && (_ctx.classInstance || _ctx.modification || _ctx.cstNode)) {
      return new AnnotationEvaluatorClass({ componentInstance: _ctx, classInstance: adapter }).evaluate(cstNode, name);
    }
    return evaluator.evaluate(cstNode, name);
  };

  return adapter;
}

/**
 * Stage 1 Renderer: Renders a non-empty Modelica Diagram into a 800x450 SVG thumbnail.
 */
export function renderModelicaDiagramThumbnailSvg(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  diagData: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  x6MarkupToSvg: (markup: any) => string,
  className: string,
  classKind: string,
): string {
  const nodes = Array.isArray(diagData?.nodes) ? diagData.nodes : [];
  const edges = Array.isArray(diagData?.edges) ? diagData.edges : [];
  const solderDots = Array.isArray(diagData?.solderDots) ? diagData.solderDots : [];

  // Compute bounding box in diagram coordinate space
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const includePt = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const node of nodes) {
    const nx = Number(node.x ?? 0);
    const ny = Number(node.y ?? 0);
    const nw = Math.max(4, Number(node.width ?? 20));
    const nh = Math.max(4, Number(node.height ?? 20));
    includePt(nx - 6, ny - 6);
    includePt(nx + nw + 6, ny + nh + 10);
  }

  // Helper to resolve port world coordinates
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resolvePortPoint = (node: any, px: number, py: number): { x: number; y: number } => {
    const nx = Number(node?.x ?? 0);
    const ny = Number(node?.y ?? 0);
    const angleDeg = Number(node?.angle ?? 0);
    if (!angleDeg) return { x: nx + px, y: ny + py };
    const cx = Number(node?.width ?? 0) / 2;
    const cy = Number(node?.height ?? 0) / 2;
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = px - cx;
    const dy = py - cy;
    return {
      x: nx + cx + dx * cos - dy * sin,
      y: ny + cy + dx * sin + dy * cos,
    };
  };

  // Render edges and include their points in bounds
  const edgeSvgParts: string[] = [];
  for (const edge of edges) {
    let pts: { x: number; y: number }[] = [];
    if (Array.isArray(edge?.data?.points) && edge.data.points.length >= 2) {
      pts = edge.data.points;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const srcNode = nodes.find((n: any) => n.id === edge?.source?.cell);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tgtNode = nodes.find((n: any) => n.id === edge?.target?.cell);
      const srcPorts = Array.isArray(srcNode?.ports) ? srcNode.ports : srcNode?.ports?.items;
      const tgtPorts = Array.isArray(tgtNode?.ports) ? tgtNode.ports : tgtNode?.ports?.items;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const srcPort = srcPorts?.find((p: any) => p.id === edge?.source?.port);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tgtPort = tgtPorts?.find((p: any) => p.id === edge?.target?.port);

      const p1 =
        srcNode && typeof srcPort?.args?.x === "number" && typeof srcPort?.args?.y === "number"
          ? resolvePortPoint(srcNode, srcPort.args.x, srcPort.args.y)
          : srcNode
            ? {
                x: Number(srcNode.x ?? 0) + Number(srcNode.width ?? 20),
                y: Number(srcNode.y ?? 0) + Number(srcNode.height ?? 20) / 2,
              }
            : null;
      const p2 =
        tgtNode && typeof tgtPort?.args?.x === "number" && typeof tgtPort?.args?.y === "number"
          ? resolvePortPoint(tgtNode, tgtPort.args.x, tgtPort.args.y)
          : tgtNode
            ? { x: Number(tgtNode.x ?? 0), y: Number(tgtNode.y ?? 0) + Number(tgtNode.height ?? 20) / 2 }
            : null;

      if (p1 && p2) {
        const verts = Array.isArray(edge?.vertices) ? edge.vertices : [];
        if (verts.length > 0) {
          pts = [p1, ...verts, p2];
        } else if (Math.abs(p1.x - p2.x) > 1e-3 && Math.abs(p1.y - p2.y) > 1e-3) {
          const midX = (p1.x + p2.x) / 2;
          pts = [p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2];
        } else {
          pts = [p1, p2];
        }
      }
    }

    if (pts.length >= 2) {
      for (const pt of pts) includePt(pt.x, pt.y);
      const lineAttrs = edge?.attrs?.line ?? {};
      const stroke = lineAttrs.stroke ?? "rgb(0, 102, 204)";
      const strokeWidth = Math.max(1.2, Number(lineAttrs.strokeWidth ?? 1.5));
      const dash = lineAttrs.strokeDasharray
        ? ` stroke-dasharray="${escapeXml(String(lineAttrs.strokeDasharray))}"`
        : "";
      const pointsAttr = pts.map((p) => `${Number(p.x).toFixed(2)},${Number(p.y).toFixed(2)}`).join(" ");
      edgeSvgParts.push(
        `<polyline points="${pointsAttr}" fill="none" stroke="${escapeXml(String(stroke))}" stroke-width="${strokeWidth}"${dash} stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`,
      );
    }
  }

  let bgInnerSvg = "";
  if (diagData?.diagramBackground) {
    const rawBg = x6MarkupToSvg(diagData.diagramBackground);
    if (hasVisualElements(rawBg)) {
      const ext0 = diagData?.coordinateSystem?.extent?.[0] ?? [-100, -100];
      const ext1 = diagData?.coordinateSystem?.extent?.[1] ?? [100, 100];
      includePt(Math.min(ext0[0], ext1[0]), -Math.max(ext0[1], ext1[1]));
      includePt(Math.max(ext0[0], ext1[0]), -Math.min(ext0[1], ext1[1]));
      // Strip outer <svg ...> wrapper so background coordinates sit directly in diagram space
      bgInnerSvg = rawBg.replace(/^<svg[^>]*>/i, "").replace(/<\/svg>\s*$/i, "");
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    minX = -100;
    minY = -100;
    maxX = 100;
    maxY = 100;
  }

  const padX = Math.max(12, (maxX - minX) * 0.08);
  const padY = Math.max(12, (maxY - minY) * 0.08);
  const vbX = minX - padX;
  const vbY = minY - padY;
  const vbW = Math.max(40, maxX - minX + padX * 2);
  const vbH = Math.max(40, maxY - minY + padY * 2);

  const nodeSvgParts: string[] = [];
  for (const node of nodes) {
    const nx = Number(node.x ?? 0);
    const ny = Number(node.y ?? 0);
    const nw = Math.max(2, Number(node.width ?? 20));
    const nh = Math.max(2, Number(node.height ?? 20));
    const angle = Number(node.angle ?? 0);
    const opacity = typeof node.opacity === "number" && node.opacity < 1 ? ` opacity="${node.opacity}"` : "";
    const rotTransform = angle ? ` rotate(${angle}, ${(nw / 2).toFixed(2)}, ${(nh / 2).toFixed(2)})` : "";
    const markupStr = node.markup ? x6MarkupToSvg(node.markup) : "";

    const portItems = Array.isArray(node.ports) ? node.ports : node.ports?.items;
    const portParts: string[] = [];
    if (Array.isArray(portItems)) {
      for (const port of portItems) {
        if (port?.markup && typeof port?.args?.x === "number" && typeof port?.args?.y === "number") {
          const pAngle = Number(port.args.angle ?? 0);
          const pRot = pAngle ? ` rotate(${pAngle})` : "";
          portParts.push(
            `<g transform="translate(${Number(port.args.x).toFixed(2)}, ${Number(port.args.y).toFixed(2)})${pRot}">${x6MarkupToSvg(port.markup)}</g>`,
          );
        }
      }
    }

    nodeSvgParts.push(
      `<g class="modelica-node" data-node-id="${escapeXml(String(node.id ?? ""))}" transform="translate(${nx.toFixed(2)}, ${ny.toFixed(2)})${rotTransform}"${opacity}>${markupStr}${portParts.join("")}</g>`,
    );
  }

  const dotParts: string[] = [];
  for (const dot of solderDots) {
    if (typeof dot?.x === "number" && typeof dot?.y === "number") {
      dotParts.push(
        `<circle cx="${dot.x.toFixed(2)}" cy="${dot.y.toFixed(2)}" r="${Number(dot.r ?? 1.6).toFixed(2)}" fill="${escapeXml(String(dot.color ?? "rgb(0, 102, 204)"))}" />`,
      );
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="100%" height="100%" data-preview-mode="diagram">
  <defs>
    <pattern id="mo-diag-grid" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e2e8f0" stroke-width="0.6"/>
    </pattern>
  </defs>
  <rect width="800" height="450" fill="#0d1117"/>
  <g transform="translate(20, 14)">
    <rect x="0" y="0" width="92" height="22" rx="4" fill="rgba(6, 182, 212, 0.15)" stroke="rgba(6, 182, 212, 0.35)"/>
    <text x="46" y="15" text-anchor="middle" fill="#22d3ee" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" font-weight="700">${escapeXml(classKind.toUpperCase())} DIAGRAM</text>
    <text x="104" y="16" fill="#f0f6fc" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="14" font-weight="700">${escapeXml(className)}</text>
    <text x="760" y="15" text-anchor="end" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11">${nodes.length} components · ${edges.length} connections</text>
  </g>
  <rect x="20" y="46" width="760" height="384" rx="8" fill="#f8fafc" stroke="#30363d" stroke-width="1"/>
  <rect x="20" y="46" width="760" height="384" rx="8" fill="url(#mo-diag-grid)" opacity="0.65"/>
  <svg x="32" y="56" width="736" height="364" viewBox="${vbX.toFixed(2)} ${vbY.toFixed(2)} ${vbW.toFixed(2)} ${vbH.toFixed(2)}" preserveAspectRatio="xMidYMid meet">
    <g class="diagram-background">${bgInnerSvg}</g>
    <g class="diagram-edges">${edgeSvgParts.join("\n    ")}</g>
    <g class="diagram-solder-dots">${dotParts.join("\n    ")}</g>
    <g class="diagram-nodes">${nodeSvgParts.join("\n    ")}</g>
  </svg>
</svg>`;
}

/**
 * Stage 2 Renderer: Renders a non-empty Modelica Icon into a 800x450 SVG thumbnail.
 */
export function renderModelicaIconThumbnailSvg(
  rawIconSvg: string,
  className: string,
  classKind: string,
  componentCount: number,
  description?: string | null,
): string {
  // Extract viewBox and inner content from rawIconSvg
  const vbMatch = rawIconSvg.match(/viewBox=["']([^"']+)["']/i);
  const viewBox = vbMatch?.[1] ?? "-100 -100 200 200";
  const innerIcon = rawIconSvg.replace(/^<svg[^>]*>/i, "").replace(/<\/svg>\s*$/i, "");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="100%" height="100%" data-preview-mode="icon">
  <defs>
    <pattern id="mo-icon-grid" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e2e8f0" stroke-width="0.7"/>
    </pattern>
  </defs>
  <rect width="800" height="450" fill="#0d1117"/>
  <g transform="translate(24, 16)">
    <rect x="0" y="0" width="104" height="22" rx="4" fill="rgba(168, 85, 247, 0.16)" stroke="rgba(168, 85, 247, 0.4)"/>
    <text x="52" y="15" text-anchor="middle" fill="#c084fc" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" font-weight="700">${escapeXml(classKind.toUpperCase())} ICON</text>
    <text x="116" y="16" fill="#f0f6fc" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="14" font-weight="700">${escapeXml(className)}</text>
    ${
      description
        ? `<text x="752" y="15" text-anchor="end" fill="#8b949e" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="11">${escapeXml(description.slice(0, 56))}</text>`
        : `<text x="752" y="15" text-anchor="end" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11">${componentCount} elements</text>`
    }
  </g>
  <rect x="230" y="54" width="340" height="340" rx="12" fill="#f8fafc" stroke="#30363d" stroke-width="1.5"/>
  <rect x="230" y="54" width="340" height="340" rx="12" fill="url(#mo-icon-grid)" opacity="0.7"/>
  <svg x="260" y="84" width="280" height="280" viewBox="${escapeXml(viewBox)}" preserveAspectRatio="xMidYMid meet" overflow="visible">
    ${innerIcon}
  </svg>
  <text x="400" y="422" text-anchor="middle" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12">${escapeXml(className)}</text>
</svg>`;
}

const PLOT_PALETTE = ["#06b6d4", "#10b981", "#f59e0b", "#a855f7", "#ec4899", "#3b82f6"];

/**
 * Stage 3 Renderer: Renders a Simulation Trajectory Plot into a 800x450 SVG thumbnail.
 */
export function renderModelicaSimulationThumbnailSvg(
  t: number[],
  series: ModelicaSimulationSeries[],
  className: string,
  startTime: number,
  stopTime: number,
): string {
  const plotLeft = 68;
  const plotTop = 64;
  const plotW = 704;
  const plotH = 324;
  const plotRight = plotLeft + plotW;
  const plotBottom = plotTop + plotH;

  // Filter out series that have diverged numerically (e.g. > 1e6) so one unstable state doesn't crush all signals
  const boundedSeries = series.filter(
    (s) => s.values.some((v) => Number.isFinite(v)) && s.values.every((v) => !Number.isFinite(v) || Math.abs(v) <= 1e6),
  );
  const effectiveSeries = boundedSeries.length > 0 ? boundedSeries : series;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of effectiveSeries) {
    for (const v of s.values) {
      if (Number.isFinite(v) && Math.abs(v) <= 1e6) {
        if (v < minY) minY = v;
        if (v > maxY) maxY = v;
      }
    }
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    minY = -1;
    maxY = 1;
  }
  if (Math.abs(maxY - minY) < 1e-9) {
    minY -= 1;
    maxY += 1;
  } else {
    const pad = (maxY - minY) * 0.08;
    minY -= pad;
    maxY += pad;
  }

  const tMin = t.length > 0 ? (t[0] ?? startTime) : startTime;
  const tMax = t.length > 0 ? Math.max(tMin + 1e-9, t[t.length - 1] ?? stopTime) : Math.max(tMin + 1, stopTime);

  const mapX = (timeVal: number) => plotLeft + ((timeVal - tMin) / (tMax - tMin)) * plotW;
  const mapY = (val: number) => {
    const clamped = Math.max(minY, Math.min(maxY, val));
    return plotBottom - ((clamped - minY) / (maxY - minY)) * plotH;
  };

  // Grid lines and Y ticks
  const gridParts: string[] = [];
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const frac = i / yTicks;
    const yPos = plotBottom - frac * plotH;
    const val = minY + frac * (maxY - minY);
    gridParts.push(
      `<line x1="${plotLeft}" y1="${yPos.toFixed(1)}" x2="${plotRight}" y2="${yPos.toFixed(1)}" stroke="#21262d" stroke-width="1" stroke-dasharray="4 4"/>`,
      `<text x="${plotLeft - 8}" y="${(yPos + 4).toFixed(1)}" text-anchor="end" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10">${formatAxisNumber(val)}</text>`,
    );
  }

  // Zero reference line if range spans 0
  if (minY < 0 && maxY > 0) {
    const zeroY = mapY(0);
    gridParts.push(
      `<line x1="${plotLeft}" y1="${zeroY.toFixed(1)}" x2="${plotRight}" y2="${zeroY.toFixed(1)}" stroke="#30363d" stroke-width="1.2"/>`,
    );
  }

  // X ticks
  const xTicks = 5;
  for (let i = 0; i <= xTicks; i++) {
    const frac = i / xTicks;
    const xPos = plotLeft + frac * plotW;
    const tVal = tMin + frac * (tMax - tMin);
    gridParts.push(
      `<line x1="${xPos.toFixed(1)}" y1="${plotTop}" x2="${xPos.toFixed(1)}" y2="${plotBottom}" stroke="#21262d" stroke-width="1" stroke-dasharray="4 4"/>`,
      `<text x="${xPos.toFixed(1)}" y="${plotBottom + 18}" text-anchor="middle" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10">${formatAxisNumber(tVal)}s</text>`,
    );
  }

  // Downsample indices for crisp SVG path size (max ~240 points per curve)
  const step = Math.max(1, Math.floor(t.length / 240));
  const indices: number[] = [];
  for (let i = 0; i < t.length; i += step) {
    indices.push(i);
  }
  if (t.length > 1 && indices[indices.length - 1] !== t.length - 1) {
    indices.push(t.length - 1);
  }

  const curveParts: string[] = [];
  const legendParts: string[] = [];
  const displaySeries = effectiveSeries.slice(0, 5);
  const legendItemWidth = 88;
  const legendStartX = plotRight - displaySeries.length * legendItemWidth;

  displaySeries.forEach((s, idx) => {
    const color = PLOT_PALETTE[idx % PLOT_PALETTE.length]!;
    const pts: string[] = [];
    for (const i of indices) {
      const tv = t[i];
      const yv = s.values[i];
      if (tv !== undefined && yv !== undefined && Number.isFinite(tv) && Number.isFinite(yv)) {
        pts.push(`${mapX(tv).toFixed(1)},${mapY(yv).toFixed(1)}`);
      }
    }
    if (pts.length >= 2) {
      curveParts.push(
        `<polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    }
    const lx = legendStartX + idx * legendItemWidth;
    const shortLegendName = s.name.length > 9 ? `${s.name.slice(0, 8)}…` : s.name;
    legendParts.push(
      `<g transform="translate(${lx}, 16)">
        <line x1="0" y1="8" x2="14" y2="8" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="7" cy="8" r="2.5" fill="${color}"/>
        <text x="18" y="12" fill="#e6edf3" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11" font-weight="600">${escapeXml(shortLegendName)}</text>
      </g>`,
    );
  });

  const maxTitleWidthPx = Math.max(80, legendStartX - 144);
  const maxTitleChars = Math.max(10, Math.floor(maxTitleWidthPx / 7.8));
  const displayClassName = className.length > maxTitleChars ? `${className.slice(0, maxTitleChars - 1)}…` : className;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="100%" height="100%" data-preview-mode="simulation">
  <rect width="800" height="450" fill="#0d1117"/>
  <g transform="translate(24, 14)">
    <rect x="0" y="0" width="96" height="22" rx="4" fill="rgba(16, 185, 129, 0.16)" stroke="rgba(16, 185, 129, 0.4)"/>
    <text x="48" y="15" text-anchor="middle" fill="#34d399" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" font-weight="700">SIMULATION</text>
    <text x="108" y="16" fill="#f0f6fc" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="13" font-weight="700">${escapeXml(displayClassName)}</text>
  </g>
  ${legendParts.join("\n  ")}
  <rect x="${plotLeft}" y="${plotTop}" width="${plotW}" height="${plotH}" rx="4" fill="#161b22" stroke="#30363d" stroke-width="1"/>
  <g class="simulation-grid">${gridParts.join("\n    ")}</g>
  <g class="simulation-curves">${curveParts.join("\n    ")}</g>
  <text x="${plotLeft + plotW / 2}" y="428" text-anchor="middle" fill="#8b949e" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="11">Time (s)</text>
</svg>`;
}

function formatAxisNumber(val: number): string {
  if (Math.abs(val) < 1e-10) return "0";
  if (Math.abs(val) >= 1000 || (Math.abs(val) > 0 && Math.abs(val) < 0.01)) {
    return val.toExponential(1);
  }
  return Number(val.toFixed(2)).toString();
}

const MODELICA_KEYWORDS = new Set([
  "model",
  "class",
  "block",
  "connector",
  "record",
  "package",
  "function",
  "type",
  "operator",
  "partial",
  "encapsulated",
  "expandable",
  "extends",
  "within",
  "import",
  "public",
  "protected",
  "parameter",
  "constant",
  "discrete",
  "input",
  "output",
  "flow",
  "stream",
  "inner",
  "outer",
  "replaceable",
  "redeclare",
  "final",
  "each",
  "equation",
  "initial",
  "algorithm",
  "end",
  "annotation",
  "connect",
  "der",
  "if",
  "then",
  "else",
  "elseif",
  "for",
  "loop",
  "in",
  "while",
  "when",
  "elsewhen",
  "return",
  "break",
  "true",
  "false",
  "and",
  "or",
  "not",
]);

const MODELICA_TYPES = new Set(["Real", "Integer", "Boolean", "String", "StateSelect", "ExternalObject"]);

function highlightModelicaLineToSvgTspans(line: string): string {
  const trimmedCommentIdx = line.indexOf("//");
  const codePart = trimmedCommentIdx >= 0 ? line.slice(0, trimmedCommentIdx) : line;
  const commentPart = trimmedCommentIdx >= 0 ? line.slice(trimmedCommentIdx) : "";

  const tokenRe =
    /("(?:[^"\\]|\\.)*"|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b|[^\s"A-Za-z0-9_]+|\s+)/g;
  const spans: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(codePart)) !== null) {
    const tok = m[0];
    if (!tok) continue;
    if (/^\s+$/.test(tok)) {
      spans.push(escapeXml(tok));
    } else if (tok.startsWith('"')) {
      spans.push(`<tspan fill="#a5d6ff">${escapeXml(tok)}</tspan>`);
    } else if (/^\d/.test(tok)) {
      spans.push(`<tspan fill="#d2a8ff">${escapeXml(tok)}</tspan>`);
    } else if (MODELICA_KEYWORDS.has(tok)) {
      spans.push(`<tspan fill="#ff7b72" font-weight="600">${escapeXml(tok)}</tspan>`);
    } else if (MODELICA_TYPES.has(tok)) {
      spans.push(`<tspan fill="#79c0ff">${escapeXml(tok)}</tspan>`);
    } else {
      spans.push(`<tspan fill="#e6edf3">${escapeXml(tok)}</tspan>`);
    }
  }
  if (commentPart) {
    spans.push(`<tspan fill="#8b949e" font-style="italic">${escapeXml(commentPart)}</tspan>`);
  }
  return spans.join("");
}

/**
 * Stage 4 Renderer: Renders a syntax-highlighted Modelica Code Snippet into a 800x450 SVG thumbnail.
 */
export function renderModelicaCodeThumbnailSvg(
  content: string,
  className: string,
  classKind: string,
  isPartial: boolean,
): string {
  const allLines = content.replace(/\r\n/g, "\n").split("\n");
  const maxLines = 16;
  const visibleLines = allLines.slice(0, maxLines);
  const badgeText = `${isPartial ? "PARTIAL " : ""}${classKind.toUpperCase()} · CODE`;

  const lineEls = visibleLines.map((rawLine, idx) => {
    const y = 78 + idx * 21;
    const clipped = rawLine.length > 88 ? `${rawLine.slice(0, 85)}...` : rawLine;
    return `<g>
      <text x="48" y="${y}" text-anchor="end" fill="#484f58" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12">${idx + 1}</text>
      <text x="64" y="${y}" xml:space="preserve" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12.5">${highlightModelicaLineToSvgTspans(clipped)}</text>
    </g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="100%" height="100%" data-preview-mode="code">
  <rect width="800" height="450" fill="#0d1117"/>
  <g transform="translate(20, 14)">
    <rect x="0" y="0" width="136" height="22" rx="4" fill="rgba(56, 139, 253, 0.15)" stroke="rgba(56, 139, 253, 0.4)"/>
    <text x="68" y="15" text-anchor="middle" fill="#58a6ff" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" font-weight="700">${escapeXml(badgeText)}</text>
    <text x="148" y="16" fill="#f0f6fc" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="14" font-weight="700">${escapeXml(className)}</text>
    <text x="760" y="15" text-anchor="end" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11">${allLines.length} lines</text>
  </g>
  <rect x="20" y="46" width="760" height="384" rx="8" fill="#161b22" stroke="#30363d" stroke-width="1"/>
  <line x1="56" y1="46" x2="56" y2="430" stroke="#21262d" stroke-width="1"/>
  ${lineEls.join("\n  ")}
  ${
    allLines.length > maxLines
      ? `<text x="64" y="418" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11">… +${allLines.length - maxLines} more lines</text>`
      : ""
  }
</svg>`;
}

function parseExperimentFromSource(content: string): {
  startTime?: number;
  stopTime?: number;
  interval?: number;
  numberOfIntervals?: number;
  stepSize?: number;
  tolerance?: number;
} {
  const out: {
    startTime?: number;
    stopTime?: number;
    interval?: number;
    numberOfIntervals?: number;
    stepSize?: number;
    tolerance?: number;
  } = {};
  const expMatch = content.match(/\bexperiment\s*\(([\s\S]*?)\)/i);
  if (!expMatch || !expMatch[1]) return out;
  const body = expMatch[1];
  const extractNum = (re: RegExp): number | undefined => {
    const m = body.match(re);
    if (!m || !m[1]) return undefined;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : undefined;
  };
  const startTime = extractNum(/\bStartTime\s*=\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/i);
  if (startTime !== undefined) out.startTime = startTime;
  const stopTime = extractNum(/\bStopTime\s*=\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/i);
  if (stopTime !== undefined) out.stopTime = stopTime;
  const interval = extractNum(/\bInterval\s*=\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/i);
  if (interval !== undefined) out.interval = interval;
  const numberOfIntervals = extractNum(/\bNumberOfIntervals\s*=\s*(\d+)/i);
  if (numberOfIntervals !== undefined) out.numberOfIntervals = numberOfIntervals;
  const stepSize = extractNum(/\bStepSize\s*=\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/i);
  if (stepSize !== undefined) out.stepSize = stepSize;
  const tolerance = extractNum(/\bTolerance\s*=\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/i);
  if (tolerance !== undefined) out.tolerance = tolerance;
  return out;
}

/**
 * Main 4-Stage Modelica Artifact Preprocessor:
 * 1. Diagram (if non-empty)
 * 2. Icon (if non-empty, e.g. for a shared component)
 * 3. Simulation Thumbnail (if simulatable, and no diagram and no icon is available)
 * 4. Code Snippet Thumbnail (fallback for partial models, packages, unsimulatable snippets)
 */
export async function preprocessModelicaArtifact(
  content: string,
  fallbackTitle: string,
): Promise<ModelicaArtifactPreprocessResult> {
  // Quick regex fallback info in case of severe syntax errors
  const headerMatch = content.match(
    /\b(partial\s+)?(model|class|block|connector|record|package|function|type)\s+([A-Za-z_][A-Za-z0-9_]*)/,
  );
  let className = headerMatch?.[3] || fallbackTitle || "Model";
  let classKind = headerMatch?.[2] || "model";
  let isPartial = Boolean(headerMatch?.[1]);

  try {
    await ensureModelicaRuntime();
    const { Context } = await import("@modelscript/modelica/context");
    const { AnnotationEvaluator, buildDiagramData, getClassIconSvg, x6MarkupToSvg } =
      await import("@modelscript/modelica/diagram");

    const fsOverlay = new OverlayFileSystem();
    const virtualPath = "/__virtual__/artifact.mo";
    fsOverlay.setVirtualFile(virtualPath, content);

    const context = new Context(fsOverlay);

    // Load referenced MSL files on demand so component icons, ports, and base classes resolve
    const mslDir = findMslExtractedDir();
    if (mslDir && /\bModelica\b|\bIcons\./.test(content)) {
      const mslFiles = resolveReferencedMslFiles(content, mslDir);
      for (const f of mslFiles) {
        try {
          const mslText = fs.readFileSync(f, "utf-8");
          context.load(mslText, f);
        } catch {
          // ignore individual MSL file parse issue
        }
      }
      linkMslHierarchyInContext(context as unknown as Parameters<typeof linkMslHierarchyInContext>[0]);
    }

    context.load(content, virtualPath);

    // Locate the primary top-level class defined in virtualPath
    const symIndex = context.queryEngine.index;
    let targetSymbolId: number | undefined;
    for (const [id, sym] of symIndex.symbols.entries()) {
      if (sym.kind === "Class" && sym.resourceId === virtualPath) {
        targetSymbolId = id;
        className = sym.name || className;
        classKind = classKindFromEntry(sym as unknown as { metadata?: Record<string, unknown> });
        isPartial = isEntryPartial(sym as unknown as { metadata?: Record<string, unknown> }, content, className);
        break;
      }
    }

    if (targetSymbolId === undefined && context.classes.length > 0) {
      const firstCls = context.classes[0]!;
      targetSymbolId = firstCls.id;
      className = firstCls.name || className;
    }

    if (targetSymbolId !== undefined) {
      const adapter = buildClassAdapter(context, targetSymbolId, AnnotationEvaluator);

      if (adapter) {
        // ── Stage 1: Modelica Diagram (if non-empty) ─────────────────────────
        let diagData = await buildDiagramData(adapter);
        // If the model has explicit connect(...) equations between sub-components that omitted Placement annotations,
        // allow buildDiagramData to auto-layout those connected non-primitive sub-components.
        if ((diagData.nodes?.length ?? 0) === 0 && (adapter.connectEquations?.length ?? 0) > 0) {
          const autoLayoutAdapter = {
            ...adapter,
            context: undefined,
            db: undefined,
            entry: adapter.entry ? { ...adapter.entry, resourceId: undefined } : undefined,
          };
          const autoDiag = await buildDiagramData(autoLayoutAdapter);
          if ((autoDiag.nodes?.length ?? 0) > 0) {
            diagData = autoDiag;
          }
        }

        const hasDiagramNodes = (diagData.nodes?.length ?? 0) > 0;
        const bgSvg = diagData.diagramBackground ? x6MarkupToSvg(diagData.diagramBackground) : "";
        const hasDiagramBg = hasVisualElements(bgSvg);
        const hasDiagramEdges =
          (diagData.edges?.length ?? 0) > 0 &&
          (hasDiagramNodes ||
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            diagData.edges.some((e: any) => Array.isArray(e?.data?.points) && e.data.points.length >= 2));

        if (hasDiagramNodes || hasDiagramBg || hasDiagramEdges) {
          const svg = renderModelicaDiagramThumbnailSvg(diagData, x6MarkupToSvg, className, classKind);
          const nodeCount = diagData.nodes?.length ?? 0;
          const connectionCount = diagData.edges?.length ?? 0;
          return {
            svg,
            previewMode: "diagram",
            title: className,
            className,
            classKind,
            isPartial,
            metadata: {
              previewMode: "diagram",
              className,
              classKind,
              nodeCount,
              connectionCount,
              dialect: "modelica",
            },
            viewConfigAdditions: {
              code: content,
              title: className,
              dialect: "modelica",
              previewMode: "diagram",
              nodeCount,
              connectionCount,
            },
          };
        }

        // ── Stage 2: Modelica Icon (if non-empty, e.g. for a shared component) ─
        const rawIconSvg = getClassIconSvg(adapter, 240, true) ?? "";
        if (hasVisualElements(rawIconSvg)) {
          const description =
            typeof adapter.entry?.metadata?.["description"] === "string" ? adapter.entry.metadata["description"] : null;
          const svg = renderModelicaIconThumbnailSvg(
            rawIconSvg,
            className,
            classKind,
            adapter.components?.length ?? 0,
            description,
          );
          return {
            svg,
            previewMode: "icon",
            title: className,
            className,
            classKind,
            isPartial,
            metadata: {
              previewMode: "icon",
              className,
              classKind,
              componentCount: adapter.components?.length ?? 0,
              dialect: "modelica",
            },
            viewConfigAdditions: {
              code: content,
              title: className,
              dialect: "modelica",
              previewMode: "icon",
            },
          };
        }

        // ── Stage 3: Simulation Thumbnail (if simulatable) ───────────────────
        const isSimulatableKind = !isPartial && ["model", "block", "class"].includes(classKind.toLowerCase());
        if (isSimulatableKind) {
          try {
            const arena = context.flattenArena(className);
            const hasEquationsOrAlgorithms = arena && arena.varCount > 0 && (arena.eqCount > 0 || arena.stmtCount > 0);
            if (arena && hasEquationsOrAlgorithms) {
              const { Variability } = await import("@modelscript/runtime");
              const { simulateArena } = await import("@modelscript/simulate");

              // Select output variables (prioritize states and top-level continuous variables)
              const tier0Ids: number[] = [];
              const tier1Ids: number[] = [];
              for (let i = 0; i < arena.varCount; i++) {
                if (arena.isVarRemoved(i)) continue;
                const v = arena.getVarVariability(i);
                if (v === Variability.Parameter || v === Variability.Constant) continue;
                const name = arena.getVarName(i);
                const nameId = arena.getVarNameId(i);
                const isDer = name.startsWith("der(");
                const isNested = !isDer && name.includes(".");
                const flags = arena.getVarFlags(i);
                const isState = (flags & 16) !== 0;
                if (isState || (!isDer && !isNested)) {
                  tier0Ids.push(nameId);
                } else {
                  tier1Ids.push(nameId);
                }
              }
              const outputStringIds = tier0Ids.length > 0 ? tier0Ids.slice(0, 8) : tier1Ids.slice(0, 8);

              if (outputStringIds.length > 0) {
                const srcExp = parseExperimentFromSource(content);
                const startTime = arena.experiment.startTime ?? srcExp.startTime ?? 0;
                let stopTime = arena.experiment.stopTime ?? srcExp.stopTime ?? 5.0;
                if (stopTime <= startTime) stopTime = startTime + 5.0;

                const stepSize = srcExp.stepSize ?? arena.experiment.interval ?? srcExp.interval;
                const numberOfIntervals =
                  arena.experiment.numberOfIntervals ??
                  srcExp.numberOfIntervals ??
                  (stepSize && stepSize > 0
                    ? Math.min(1000, Math.max(50, Math.round((stopTime - startTime) / stepSize)))
                    : 300);

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const simRes = simulateArena(arena as any, {
                  startTime,
                  stopTime,
                  numberOfIntervals,
                  outputStringIds,
                });

                const tArr = Array.from(simRes.t || []);
                const states = simRes.states || [];
                const yArr = simRes.y || [];

                if (tArr.length >= 2 && states.length > 0 && yArr.length >= 2) {
                  const series: ModelicaSimulationSeries[] = [];
                  for (let si = 0; si < states.length; si++) {
                    const sName = states[si];
                    if (!sName) continue;
                    const values = tArr.map((_, ti) => Number(yArr[ti]?.[si] ?? 0));
                    if (
                      values.some((v) => Number.isFinite(v)) &&
                      values.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e6)
                    ) {
                      series.push({ name: sName, values });
                    }
                  }

                  if (series.length > 0) {
                    const svg = renderModelicaSimulationThumbnailSvg(tArr, series, className, startTime, stopTime);
                    return {
                      svg,
                      previewMode: "simulation",
                      title: className,
                      className,
                      classKind,
                      isPartial,
                      metadata: {
                        previewMode: "simulation",
                        className,
                        classKind,
                        stateCount: series.length,
                        stepCount: tArr.length,
                        startTime,
                        stopTime,
                        dialect: "modelica",
                      },
                      viewConfigAdditions: {
                        code: content,
                        title: className,
                        dialect: "modelica",
                        previewMode: "simulation",
                        simulationPreview: {
                          startTime,
                          stopTime,
                          states: series.map((s) => s.name),
                        },
                      },
                    };
                  }
                }
              }
            }
          } catch {
            // Not simulatable or simulation failed — fall through to Stage 4 (Code Snippet)
          }
        }
      }
    }
  } catch {
    // Parse or runtime failure — fall through to Stage 4 (Code Snippet)
  }

  // ── Stage 4: Code Snippet Thumbnail (fallback) ─────────────────────────────
  const svg = renderModelicaCodeThumbnailSvg(content, className, classKind, isPartial);
  return {
    svg,
    previewMode: "code",
    title: className,
    className,
    classKind,
    isPartial,
    metadata: {
      previewMode: "code",
      className,
      classKind,
      isPartial,
      dialect: "modelica",
    },
    viewConfigAdditions: {
      code: content,
      title: className,
      dialect: "modelica",
      previewMode: "code",
    },
  };
}

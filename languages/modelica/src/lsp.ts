// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Single-language LSP adapter for `@modelscript/modelica`.
 *
 * Automatically discovered by `@modelscript/lsp/core` (`buildLanguagePluginFromModule`)
 * in the lightweight dev playground and standalone Morsel hosts, exposing:
 *   - `getModelicaDiagramData` (`modelscript/getDiagramData`)
 *   - `applyModelicaDiagramEdits` (`modelscript/applyDiagramEdits`)
 *   - `getModelicaComponentProperties` (`modelscript/getComponentProperties`)
 *   - `analyzeModelicaBlt` (`modelscript/analyzeBlt`)
 *   - `getModelicaDocumentSymbols` (`textDocument/documentSymbol`)
 */

import type { DiagramApplyEditsResult, DiagramData, DiagramEditAction } from "@modelscript/diagram/protocol";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import type { TextEdit } from "vscode-languageserver-types";
import { AnnotationEvaluator } from "./diagram/annotation-evaluator.js";
import { buildComponentProperties, buildDiagramData } from "./diagram/data.js";
import {
  applyEditsToText,
  computeComponentInsert,
  computeComponentsDelete,
  computeConnectInsert,
  computeConnectRemove,
  computeEdgePointEdits,
  computeNameEdit,
  computeParameterEdit,
  computePlacementEdits,
} from "./diagram/edits.js";
import { buildFallbackClassInstance } from "./diagram/scanner.js";
import { parseModelicaModelForPanel } from "./ui/modelica-analysis.js";

const PRIMITIVE_MODELICA_TYPES = new Set([
  "Real",
  "Integer",
  "Boolean",
  "String",
  "StateSelect",
  "ExternalObject",
  "Clock",
]);

function isPrimitiveModelicaType(typeName: string | undefined | null): boolean {
  if (!typeName) return true;
  if (PRIMITIVE_MODELICA_TYPES.has(typeName)) return true;
  return (
    typeName.startsWith("SI.") || typeName.startsWith("Modelica.SIunits.") || typeName.startsWith("Modelica.Units.")
  );
}

const loadedMslFilesInContext = new Set<string>();
const resolvedLibraryClassCache = new Map<string, unknown>();
let mslIndexByFqnCache: Map<string, string> | null = null;

function getMslFileForFqn(fqn: string): string | null {
  const mslRoot = findMslPath();
  if (!mslRoot) return null;
  if (!mslIndexByFqnCache) {
    mslIndexByFqnCache = new Map();
    for (const entry of loadMslModelsIndex()) {
      if (entry.fqn && entry.file) {
        mslIndexByFqnCache.set(entry.fqn, entry.file);
      }
    }
  }
  const direct = mslIndexByFqnCache.get(fqn);
  if (direct) {
    const abs = path.isAbsolute(direct) ? direct : path.join(mslRoot, direct);
    if (fs.existsSync(abs)) return abs;
  }
  // Resolve standard Modelica package directory layout on disk (e.g. Modelica/Blocks/Interfaces.mo or .../SISO.mo)
  const parts = fqn.split(".");
  const relParts = parts[0] === "Modelica" ? parts.slice(1) : parts;
  for (let len = relParts.length; len >= 1; len--) {
    const candidateMo = path.join(mslRoot, ...relParts.slice(0, len)) + ".mo";
    if (fs.existsSync(candidateMo)) return candidateMo;
    const candidatePkg = path.join(mslRoot, ...relParts.slice(0, len), "package.mo");
    if (fs.existsSync(candidatePkg)) return candidatePkg;
  }
  return null;
}

function resolveRelativeModelicaFqn(rawName: string, enclosingFqn: string): string[] {
  const clean = rawName.trim().replace(/^\./, "");
  if (!clean) return [];
  const candidates: string[] = [];
  if (clean.startsWith("Modelica.")) {
    candidates.push(clean);
  } else {
    const scopeParts = enclosingFqn.split(".");
    for (let i = scopeParts.length - 1; i >= 1; i--) {
      candidates.push([...scopeParts.slice(0, i), clean].join("."));
    }
    candidates.push(clean);
  }
  return candidates;
}

function ensureMslFilesForFqnLoaded(ctx: import("./context.js").Context, fqn: string): void {
  const filePath = getMslFileForFqn(fqn);
  if (!filePath || loadedMslFilesInContext.has(filePath)) return;
  loadedMslFilesInContext.add(filePath);
  try {
    const text = fs.readFileSync(filePath, "utf-8");
    ctx.load(text, filePath);
  } catch {
    // ignore unreadable file
  }
}

function querySuffixInContext(ctx: import("./context.js").Context, fqn: string) {
  const parts = fqn.split(".");
  for (let i = 0; i < parts.length; i++) {
    const candidate = parts.slice(i).join(".");
    const res = ctx.query(candidate) as {
      id?: number;
      db?: any;
      entry?: any;
      name?: string;
      kind?: string;
      classKind?: string;
      compositeName?: string;
      description?: string | null;
    } | null;
    if (res && res.id != null && res.db && res.entry) {
      return res;
    }
  }
  return null;
}

function resolveLibraryClassInstanceSync(
  ctx: import("./context.js").Context,
  fqn: string,
  visiting: Set<string>,
  depth = 0,
): unknown | null {
  if (!fqn || isPrimitiveModelicaType(fqn) || depth > 8) return null;
  if (resolvedLibraryClassCache.has(fqn)) {
    return resolvedLibraryClassCache.get(fqn) ?? null;
  }
  if (visiting.has(fqn)) return null;
  visiting.add(fqn);

  try {
    ensureMslFilesForFqnLoaded(ctx, fqn);
    const queried = querySuffixInContext(ctx, fqn);
    if (!queried || queried.id == null || !queried.db || !queried.entry) {
      return null;
    }

    const db = queried.db;
    const entry = queried.entry;
    const compositeName = fqn;
    const annCache = new Map<string, unknown>();
    const children: any[] = typeof db.childrenOf === "function" ? (db.childrenOf(entry.id) ?? []) : [];

    const extendsClassInstances: any[] = [];
    const components: any[] = [];

    const adapter: any = {
      id: entry.id,
      entry,
      name: queried.name || fqn.split(".").pop() || fqn,
      kind: queried.kind || "Class",
      classKind: queried.classKind || (entry.metadata as any)?.classKind || "class",
      compositeName,
      description: queried.description ?? (entry.metadata as any)?.description ?? "",
      isClassInstance: true,
      get cstNode() {
        return typeof db.cstNode === "function" ? db.cstNode(entry.id) : null;
      },
      extendsClassInstances,
      components,
      connectEquations: [],
      annotation(annName: string) {
        if (annCache.has(annName)) return annCache.get(annName);
        const cst = typeof db.cstNode === "function" ? db.cstNode(entry.id) : null;
        let result: unknown = null;
        if (cst) {
          try {
            result = new AnnotationEvaluator(adapter).evaluate(cst, annName);
          } catch {
            result = null;
          }
        }
        annCache.set(annName, result);
        return result;
      },
    };

    // Cache early to break cycles cleanly
    resolvedLibraryClassCache.set(fqn, adapter);

    for (const child of children) {
      if (child.kind === "Extends") {
        const baseRaw: string =
          (typeof db.query === "function" ? db.query("typeSpecifier", child.id) : null) ||
          (child.metadata as any)?.typeSpecifier ||
          child.name ||
          "";
        for (const cand of resolveRelativeModelicaFqn(baseRaw, compositeName)) {
          const baseInst = resolveLibraryClassInstanceSync(ctx, cand, visiting, depth + 1);
          if (baseInst) {
            extendsClassInstances.push({ classInstance: baseInst });
            break;
          }
        }
      } else if (child.kind === "Component" || child.kind === "Variable") {
        const typeSpec: string =
          (typeof db.query === "function" ? db.query("typeSpecifier", child.id) : null) ||
          (child.metadata as any)?.typeSpecifier ||
          "";
        if (!typeSpec || isPrimitiveModelicaType(typeSpec)) continue;
        let compClassInst: unknown = null;
        for (const cand of resolveRelativeModelicaFqn(typeSpec, compositeName)) {
          compClassInst = resolveLibraryClassInstanceSync(ctx, cand, visiting, depth + 1);
          if (compClassInst) break;
        }
        const compAnnCache = new Map<string, unknown>();
        components.push({
          name: child.name,
          typeName: typeSpec,
          classInstance: compClassInst,
          description: (child.metadata as any)?.description ?? "",
          declaration: child,
          get cstNode() {
            return typeof db.cstNode === "function" ? db.cstNode(child.id) : null;
          },
          annotation(annName: string) {
            if (compAnnCache.has(annName)) return compAnnCache.get(annName);
            const cst = typeof db.cstNode === "function" ? db.cstNode(child.id) : null;
            let res: unknown = null;
            if (cst) {
              try {
                res = new AnnotationEvaluator(adapter).evaluate(cst, annName);
              } catch {
                res = null;
              }
            }
            compAnnCache.set(annName, res);
            return res;
          },
        });
      }
    }

    return adapter;
  } finally {
    visiting.delete(fqn);
  }
}

export async function getModelicaDiagramData(
  code: string,
  params?: { className?: string; diagramType?: string },
): Promise<DiagramData | null> {
  const effectiveClass = inferPrimaryClassName(code, params?.className);
  let ci = buildFallbackClassInstance(code, effectiveClass);
  if (ci && (!ci.components || ci.components.length === 0)) {
    for (const m of code.matchAll(/\b(?:model|block|class)\s+([A-Za-z_]\w*)\b/g)) {
      const candidateName = m[1];
      if (!candidateName) continue;
      const innerCi = buildFallbackClassInstance(code, candidateName);
      if (innerCi && innerCi.components && innerCi.components.length > 0) {
        ci = innerCi;
        break;
      }
    }
  }
  if (!ci) return null;

  // Hydrate library componentClassInstance directly from live MSL source files via Context + AnnotationEvaluator
  // so icons, inheritance, interactive connector ports, and parameter text labels render directly from the library.
  if (Array.isArray(ci.components) && ci.components.length > 0) {
    const unresolvedLibComps = ci.components.filter(
      (c: any) => !c.classInstance && typeof c.typeName === "string" && !isPrimitiveModelicaType(c.typeName),
    );
    if (unresolvedLibComps.length > 0) {
      try {
        const ctx = await getModelicaContext(false);
        const visiting = new Set<string>();
        for (const comp of unresolvedLibComps as any[]) {
          const resolved = resolveLibraryClassInstanceSync(ctx, comp.typeName, visiting);
          if (resolved) {
            comp.classInstance = resolved;
          }
        }
      } catch (err) {
        console.warn("[modelica-lsp] live MSL hydration failed:", err);
      }
    }
  }

  const data = await buildDiagramData(ci, params?.diagramType);
  if (data && Array.isArray(data.nodes) && data.nodes.length > 0) {
    const icons = loadMslIcons();
    for (const node of data.nodes) {
      const clsName = node.properties?.className;
      const iconSvg = clsName ? icons[clsName] : undefined;
      if (iconSvg) {
        if (!node.data) node.data = {};
        if (!node.data.icon) node.data.icon = iconSvg;
        if (node.properties && !node.properties.iconSvg) {
          node.properties.iconSvg = iconSvg;
        }
        // Last-resort fallback ONLY if live library resolution couldn't resolve the class
        if (node.properties?.classKind === "unknown") {
          const w = typeof node.width === "number" && node.width > 0 ? node.width : 20;
          const h = typeof node.height === "number" && node.height > 0 ? node.height : 20;
          const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(iconSvg)}`;
          node.markup = {
            tagName: "svg",
            attrs: { preserveAspectRatio: "xMidYMid meet", width: w, height: h, style: "overflow: visible" },
            children: [
              { tagName: "rect", attrs: { style: "fill: transparent; stroke: none", width: w, height: h } },
              {
                tagName: "image",
                attrs: {
                  href: dataUri,
                  "xlink:href": dataUri,
                  x: 0,
                  y: 0,
                  width: w,
                  height: h,
                  preserveAspectRatio: "xMidYMid meet",
                },
              },
            ],
          } as unknown as typeof node.markup;
          const portsObj = node.ports as { items?: Array<{ markup?: { attrs?: { fill?: string } } }> } | undefined;
          if (portsObj && Array.isArray(portsObj.items)) {
            portsObj.items = portsObj.items.filter((p) => p?.markup?.attrs?.fill !== "#ef4444");
          }
        }
      }
    }
  }
  return data;
}

export function applyModelicaDiagramEdits(
  code: string,
  params?: { className?: string; seq?: number; actions?: DiagramEditAction[] },
): DiagramApplyEditsResult & { newText?: string } {
  const seq = typeof params?.seq === "number" ? params.seq : 0;
  const effectiveClass = inferPrimaryClassName(code, params?.className);
  const ci = buildFallbackClassInstance(code, effectiveClass) ?? buildFallbackClassInstance(code);
  const actions = Array.isArray(params?.actions) ? params.actions : [];
  if (!ci || actions.length === 0) {
    return { seq, edits: [], renderHint: "none" };
  }

  let currentText = code;
  let currentCi = ci;
  const allEdits: TextEdit[] = [];

  for (const rawAction of actions) {
    const action = rawAction as Record<string, unknown>;
    const kind = typeof action["type"] === "string" ? action["type"] : "";
    let stepEdits: TextEdit[] = [];

    if (kind === "move" || kind === "resize" || kind === "rotate" || kind === "setPlacement") {
      const items = Array.isArray(action["items"])
        ? (action["items"] as Array<Record<string, unknown>>)
        : action["item"] && typeof action["item"] === "object"
          ? [action["item"] as Record<string, unknown>]
          : null;
      if (items && items.length > 0) {
        const placements = items
          .map((it) => ({
            name:
              typeof it["name"] === "string"
                ? it["name"]
                : typeof it["componentName"] === "string"
                  ? it["componentName"]
                  : "",
            x: typeof it["x"] === "number" ? it["x"] : 0,
            y: typeof it["y"] === "number" ? it["y"] : 0,
            width: typeof it["width"] === "number" ? it["width"] : 20,
            height: typeof it["height"] === "number" ? it["height"] : 20,
            rotation: typeof it["rotation"] === "number" ? it["rotation"] : undefined,
            flipX: typeof it["flipX"] === "boolean" ? it["flipX"] : undefined,
            flipY: typeof it["flipY"] === "boolean" ? it["flipY"] : undefined,
            edges: Array.isArray(it["edges"])
              ? (it["edges"] as Array<{ source: string; target: string; points: { x: number; y: number }[] }>)
              : undefined,
            connectedOnly: typeof it["connectedOnly"] === "boolean" ? it["connectedOnly"] : undefined,
          }))
          .filter((p) => Boolean(p.name));
        if (placements.length > 0) {
          stepEdits = computePlacementEdits(currentText, currentCi, placements);
        }
      } else {
        const compName = typeof action["componentName"] === "string" ? action["componentName"] : "";
        const x = typeof action["x"] === "number" ? action["x"] : 0;
        const y = typeof action["y"] === "number" ? action["y"] : 0;
        const width = typeof action["width"] === "number" ? action["width"] : 20;
        const height = typeof action["height"] === "number" ? action["height"] : 20;
        const rotation = typeof action["rotation"] === "number" ? action["rotation"] : undefined;
        if (compName) {
          stepEdits = computePlacementEdits(currentText, currentCi, [
            { name: compName, x, y, width, height, rotation },
          ]);
        }
      }
    } else if (kind === "moveEdge") {
      const edges = Array.isArray(action["edges"])
        ? (action["edges"] as Array<{ source: string; target: string; points: { x: number; y: number }[] }>)
        : [];
      if (edges.length > 0) {
        stepEdits = computeEdgePointEdits(currentText.split("\n"), currentCi, edges);
      }
    } else if (kind === "setParameter" || kind === "updateParameter") {
      const compName =
        typeof action["componentName"] === "string"
          ? action["componentName"]
          : typeof action["name"] === "string"
            ? action["name"]
            : "";
      const paramName =
        typeof action["parameterName"] === "string"
          ? action["parameterName"]
          : typeof action["parameter"] === "string"
            ? action["parameter"]
            : "";
      const value = action["value"] !== undefined ? String(action["value"]) : "";
      if (compName && paramName) {
        stepEdits = computeParameterEdit(currentCi, compName, paramName, value, currentText);
      }
    } else if (kind === "addComponent") {
      const className = typeof action["className"] === "string" ? action["className"] : "";
      let compName = typeof action["componentName"] === "string" ? action["componentName"].trim() : "";
      const x = typeof action["x"] === "number" ? action["x"] : 0;
      const y = typeof action["y"] === "number" ? action["y"] : 0;
      if (className && !compName) {
        const leaf = className.split(".").pop() || "component";
        const base = leaf.charAt(0).toLowerCase() + leaf.slice(1);
        const existing = new Set((currentCi.components ?? []).map((c) => c.name));
        let idx = 1;
        while (existing.has(`${base}${idx}`)) idx++;
        compName = `${base}${idx}`;
      }
      if (className && compName) {
        stepEdits = computeComponentInsert(currentCi, className, compName, x, y, currentText);
      }
    } else if (kind === "addConnect" || kind === "connect") {
      const source = typeof action["source"] === "string" ? action["source"] : "";
      const target = typeof action["target"] === "string" ? action["target"] : "";
      const points = Array.isArray(action["points"])
        ? (action["points"] as Array<{ x: number; y: number }>)
        : undefined;
      const color =
        Array.isArray(action["color"]) && action["color"].length === 3
          ? (action["color"] as [number, number, number])
          : undefined;
      if (source && target) {
        stepEdits = computeConnectInsert(currentText, currentCi, source, target, points, color);
      }
    } else if (kind === "reconnect") {
      const oldSource = typeof action["oldSource"] === "string" ? action["oldSource"] : "";
      const oldTarget = typeof action["oldTarget"] === "string" ? action["oldTarget"] : "";
      const newSource = typeof action["newSource"] === "string" ? action["newSource"] : "";
      const newTarget = typeof action["newTarget"] === "string" ? action["newTarget"] : "";
      const points = Array.isArray(action["points"])
        ? (action["points"] as Array<{ x: number; y: number }>)
        : undefined;
      const color =
        Array.isArray(action["color"]) && action["color"].length === 3
          ? (action["color"] as [number, number, number])
          : undefined;
      if (oldSource && oldTarget && newSource && newTarget) {
        const rmEdits = computeConnectRemove(currentText, currentCi, oldSource, oldTarget);
        if (rmEdits.length > 0) {
          allEdits.push(...rmEdits);
          currentText = applyEditsToText(currentText, rmEdits);
          currentCi =
            buildFallbackClassInstance(currentText, effectiveClass) ??
            buildFallbackClassInstance(currentText) ??
            currentCi;
        }
        stepEdits = computeConnectInsert(currentText, currentCi, newSource, newTarget, points, color);
      }
    } else if (kind === "removeConnect" || kind === "disconnect") {
      const source = typeof action["source"] === "string" ? action["source"] : "";
      const target = typeof action["target"] === "string" ? action["target"] : "";
      if (source && target) {
        stepEdits = computeConnectRemove(currentText, currentCi, source, target);
      }
    } else if (kind === "deleteComponents") {
      const rawNames = Array.isArray(action["names"])
        ? action["names"]
        : Array.isArray(action["componentNames"])
          ? action["componentNames"]
          : [];
      const names = (rawNames as unknown[]).filter((n): n is string => typeof n === "string");
      if (names.length > 0) {
        stepEdits = computeComponentsDelete(currentText, currentCi, names);
      }
    } else if (kind === "renameComponent" || kind === "updateName") {
      const oldName =
        typeof action["oldName"] === "string"
          ? action["oldName"]
          : typeof action["name"] === "string"
            ? action["name"]
            : "";
      const newName = typeof action["newName"] === "string" ? action["newName"] : "";
      if (oldName && newName) {
        stepEdits = computeNameEdit(currentCi, oldName, newName, currentText);
      }
    }

    if (stepEdits.length > 0) {
      allEdits.push(...stepEdits);
      currentText = applyEditsToText(currentText, stepEdits);
      currentCi =
        buildFallbackClassInstance(currentText, effectiveClass) ?? buildFallbackClassInstance(currentText) ?? currentCi;
    }
  }

  return {
    seq,
    edits: allEdits as unknown as DiagramApplyEditsResult["edits"],
    renderHint: allEdits.length > 0 ? "immediate" : "none",
    newText: currentText,
  };
}

export function getModelicaComponentProperties(
  code: string,
  params?: { className?: string; componentName?: string },
): Record<string, unknown> | null {
  const componentName = params?.componentName;
  if (!componentName) return null;

  const ci = buildFallbackClassInstance(code, params?.className);
  if (ci) {
    const nativeProps = buildComponentProperties(ci, componentName);
    if (nativeProps) return nativeProps as unknown as Record<string, unknown>;
  }

  const parsed = parseModelicaModelForPanel(code);
  const comp = parsed.components.find((c) => c.name === componentName);
  if (!comp) return null;

  return {
    componentName: comp.name,
    className: comp.typeName,
    description: comp.description,
    variability: comp.variability,
    causality: comp.causality,
    parameters: comp.modifiers.map((m) => ({
      name: m.name,
      value: m.value,
      type: "Real",
    })),
    values: Object.fromEntries(comp.modifiers.map((m) => [m.name, m.value])),
  };
}

export function analyzeModelicaBlt(code: string) {
  return parseModelicaModelForPanel(code).blt;
}

export function getModelicaDocumentSymbols(code: string) {
  const parsed = parseModelicaModelForPanel(code);
  const children = parsed.components.map((c) => ({
    name: c.name,
    detail: c.typeName,
    kind: c.variability === "parameter" || c.variability === "constant" ? 14 : 13,
    range: {
      start: { line: Math.max(0, c.startLine - 1), character: 0 },
      end: { line: Math.max(0, c.endLine - 1), character: 1 },
    },
    selectionRange: {
      start: { line: Math.max(0, c.startLine - 1), character: 0 },
      end: { line: Math.max(0, c.endLine - 1), character: c.name.length },
    },
  }));

  return [
    {
      name: parsed.className,
      detail: parsed.classKind,
      kind: 5,
      range: {
        start: { line: 0, character: 0 },
        end: { line: Math.max(0, code.split(/\r?\n/).length - 1), character: 1 },
      },
      selectionRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: parsed.className.length },
      },
      children,
    },
  ];
}

// ────────────────────────────────────────────────────────────────────────────
// Lazy Compiler Context, MSL Index & Simulation / Flattening
// ────────────────────────────────────────────────────────────────────────────

interface MslModelEntry {
  fqn: string;
  name: string;
  file: string;
  isExample?: boolean;
  package?: string;
}

let cachedRepoRoot: string | null = null;
function findRepoRoot(): string {
  if (cachedRepoRoot) return cachedRepoRoot;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "languages", "modelica"))) {
      cachedRepoRoot = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cachedRepoRoot = process.cwd();
  return cachedRepoRoot;
}

let cachedMslPath: string | null | undefined;
function findMslPath(): string | null {
  if (cachedMslPath !== undefined) return cachedMslPath;
  const root = findRepoRoot();
  const candidates = [
    path.join(root, "scripts", "msl", "Modelica 4.0.0"),
    path.join(root, "data", "libraries", "Modelica", "4.0.0", "extracted", "Modelica"),
    path.join(root, "data", "libraries", "Modelica", "4.1.0", "extracted", "Modelica"),
    path.join(process.env["HOME"] || "", ".openmodelica", "libraries", "Modelica 4.0.0+maint.om"),
    path.join(process.env["HOME"] || "", ".openmodelica", "libraries", "Modelica 4.1.0+maint.om"),
  ];
  cachedMslPath = candidates.find((p) => p && fs.existsSync(p) && fs.existsSync(path.join(p, "package.mo"))) ?? null;
  return cachedMslPath;
}

let cachedMslModels: MslModelEntry[] | null = null;
function loadMslModelsIndex(): MslModelEntry[] {
  if (cachedMslModels) return cachedMslModels;
  const root = findRepoRoot();
  for (const name of ["msl-4.0.0-models.json", "msl-4.1.0-models.json"]) {
    const cacheFile = path.join(root, ".cache", name);
    if (fs.existsSync(cacheFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
        if (Array.isArray(parsed)) {
          cachedMslModels = parsed as MslModelEntry[];
          return cachedMslModels;
        }
      } catch {
        // ignore corrupt cache
      }
    }
  }
  cachedMslModels = [];
  return cachedMslModels;
}

let cachedMslIcons: Record<string, string> | null = null;
function loadMslIcons(): Record<string, string> {
  if (cachedMslIcons) return cachedMslIcons;
  const root = findRepoRoot();
  const gzPath = path.join(root, "packages", "lsp", "dist", "msl-icons.json.gz");
  if (fs.existsSync(gzPath)) {
    try {
      const jsonStr = zlib.gunzipSync(fs.readFileSync(gzPath)).toString("utf-8");
      cachedMslIcons = JSON.parse(jsonStr) as Record<string, string>;
      return cachedMslIcons;
    } catch {
      // ignore
    }
  }
  cachedMslIcons = {};
  return cachedMslIcons;
}

function createNodeFsAdapter() {
  return {
    exists: (p: string) => fs.existsSync(p),
    read: (p: string) => fs.readFileSync(p, "utf-8"),
    write: (p: string, c: string) => fs.writeFileSync(p, c, "utf-8"),
    stat: (p: string) => {
      try {
        const st = fs.statSync(p);
        return { isFile: () => st.isFile(), isDirectory: () => st.isDirectory(), mtimeMs: st.mtimeMs };
      } catch {
        return null;
      }
    },
    readdir: (p: string) =>
      fs.readdirSync(p, { withFileTypes: true }).map((e) => ({
        name: e.name,
        isFile: () => e.isFile(),
        isDirectory: () => e.isDirectory(),
      })),
    join: (...parts: string[]) => path.join(...parts),
    dirname: (p: string) => path.dirname(p),
    basename: (p: string, ext?: string) => path.basename(p, ext),
    extname: (p: string) => path.extname(p),
    resolve: (...parts: string[]) => path.resolve(...parts),
    isAbsolute: (p: string) => path.isAbsolute(p),
  };
}

let sharedContextPromise: Promise<import("./context.js").Context> | null = null;
let mslMountedInContext = false;

async function getModelicaContext(needsMsl = false): Promise<import("./context.js").Context> {
  if (!sharedContextPromise) {
    sharedContextPromise = (async () => {
      const { createWasmParser } = await import("../src-gen/bindings.js");
      const { Context } = await import("./context.js");
      const { initBltWasm } = await import("@modelscript/runtime");
      const wasmPath = path.join(findRepoRoot(), "languages", "modelica", "dist", "parser.wasm");
      const { parser } = await createWasmParser(wasmPath);
      Context.registerParser(".mo", parser as never);
      await initBltWasm();
      return new Context(createNodeFsAdapter() as never);
    })();
  }
  const ctx = await sharedContextPromise;
  if (needsMsl && !mslMountedInContext) {
    const mslPath = findMslPath();
    if (mslPath) {
      mslMountedInContext = true;
      await ctx.addLibrary(mslPath);
    }
  }
  return ctx;
}

function hasClassDeclInCode(code: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b(?:model|block|class|package|function|record)\\s+${escaped}\\b`).test(code);
}

function inferPrimaryClassName(code: string, requested?: string): string | undefined {
  if (requested && (requested.includes(".") || hasClassDeclInCode(code, requested))) {
    return requested;
  }
  const parsed = parseModelicaModelForPanel(code);
  if (
    parsed.className &&
    parsed.className !== "Model" &&
    parsed.classKind !== "package" &&
    hasClassDeclInCode(code, parsed.className)
  ) {
    return parsed.className;
  }
  const matches = Array.from(code.matchAll(/\b(?:model|block|class)\s+([A-Za-z_]\w*)\b/g));
  const lastMatch = matches[matches.length - 1];
  return lastMatch?.[1] ?? parsed.className;
}

export async function flattenModelica(
  code: string,
  params?: { name?: string; className?: string; uri?: string },
  uri?: string,
): Promise<{ text: string | null; error?: string | undefined }> {
  try {
    const targetUri = params?.uri || uri || "inmemory://model/1";
    const className = inferPrimaryClassName(code, params?.name || params?.className);
    if (!className) return { text: null, error: "No Modelica class name found to flatten." };
    const needsMsl = /\bModelica\./.test(code);
    const ctx = await getModelicaContext(needsMsl);
    ctx.load(code, targetUri);
    const arena = ctx.flattenArena(className, undefined, targetUri);
    if (!arena) return { text: null, error: `Failed to flatten '${className}'.` };
    const { printArenaDAE } = await import("@modelscript/runtime");
    return { text: printArenaDAE(arena) };
  } catch (err) {
    return { text: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function simulateModelica(
  code: string,
  params?: {
    className?: string;
    uri?: string;
    startTime?: number;
    stopTime?: number;
    interval?: number;
    numberOfIntervals?: number;
    solver?: string;
    rtol?: number;
    atol?: number;
    steadyStateOnly?: boolean;
    parameterOverrides?: Record<string, number>;
  },
  uri?: string,
): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  try {
    const targetUri = params?.uri || uri || "inmemory://model/1";
    const className = inferPrimaryClassName(code, params?.className);
    if (!className) {
      return { error: "No Modelica class name found to simulate." };
    }
    const needsMsl = /\bModelica\./.test(code);
    const ctx = await getModelicaContext(needsMsl);
    ctx.load(code, targetUri);
    const arena = ctx.flattenArena(className, undefined, targetUri);
    if (!arena) {
      return { error: `Failed to flatten class '${className}' for simulation.` };
    }

    const { Variability } = await import("@modelscript/runtime");
    const { simulateArenaAsync } = await import("@modelscript/simulate");

    const startTime = params?.startTime ?? 0;
    const stopTime = params?.stopTime ?? 1;
    const numberOfIntervals = params?.numberOfIntervals ?? 200;
    const step = params?.interval ?? (stopTime - startTime) / Math.max(1, numberOfIntervals);

    const paramOverrides = params?.parameterOverrides ? new Map(Object.entries(params.parameterOverrides)) : undefined;

    const simRes = await simulateArenaAsync(arena, {
      startTime,
      stopTime,
      step,
      numberOfIntervals,
      solver: (params?.solver as never) ?? undefined,
      rtol: params?.rtol,
      atol: params?.atol,
      steadyStateOnly: params?.steadyStateOnly,
      parameterOverrides: paramOverrides,
    });

    const parameters: Array<{ name: string; value: number; type: string }> = [];
    for (let i = 0; i < arena.varCount; i++) {
      if (arena.isVarRemoved(i)) continue;
      const v = arena.getVarVariability(i);
      if (v === Variability.Parameter) {
        const numVal = arena.getVarStartValue(i);
        parameters.push({
          name: arena.getVarName(i),
          value: typeof numVal === "number" && Number.isFinite(numVal) ? numVal : 0,
          type: "Real",
        });
      }
    }

    const tArr = Array.from(simRes.t);
    const yArr = (simRes.y || []).map((row: unknown) =>
      Array.isArray(row) ? row : Array.from(row as Iterable<number>),
    );

    return {
      t: tArr,
      y: yArr,
      states: simRes.states,
      parameters,
      experiment: { startTime, stopTime, interval: step, numberOfIntervals },
      telemetry: { executionTimeMs: Date.now() - t0, stepCount: tArr.length },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export function getModelicaMountedLibraries() {
  const mslPath = findMslPath();
  if (!mslPath) return { mounted: [], loading: [] };
  return {
    mounted: [{ name: "Modelica", version: "4.0.0", status: "ready", explicitlyInstalled: true }],
    loading: [],
  };
}

export function getModelicaLibraryTree(code: string, params?: { uri?: string; parentId?: string }) {
  const parentId = params?.parentId;
  const icons = loadMslIcons();
  const mslModels = loadMslModelsIndex();
  const hasMsl = mslModels.length > 0 || Boolean(findMslPath());

  if (!parentId) {
    const nodes: Array<Record<string, unknown>> = [];
    if (hasMsl) {
      nodes.push({
        id: "__LIB__:Modelica",
        name: "Modelica",
        compositeName: "Modelica",
        classKind: "package",
        hasChildren: true,
        language: "modelica",
        iconSvg: icons["Modelica"] ?? null,
      });
    }
    const parsed = parseModelicaModelForPanel(code);
    if (parsed.className) {
      nodes.push({
        id: parsed.className,
        name: parsed.className,
        compositeName: parsed.className,
        classKind: parsed.classKind || "model",
        hasChildren: parsed.components.length > 0,
        language: "modelica",
        uri: params?.uri,
      });
    }
    return nodes;
  }

  const targetPkg = parentId.startsWith("__LIB__:") ? parentId.slice("__LIB__:".length) : parentId;
  const prefix = `${targetPkg}.`;
  const directChildren = new Map<string, MslModelEntry>();
  const packagesWithChildren = new Set<string>();

  for (const m of mslModels) {
    if (!m.fqn.startsWith(prefix)) continue;
    const rest = m.fqn.slice(prefix.length);
    const dotIdx = rest.indexOf(".");
    if (dotIdx === -1) {
      directChildren.set(m.fqn, m);
    } else {
      const childPkgFqn = `${targetPkg}.${rest.slice(0, dotIdx)}`;
      packagesWithChildren.add(childPkgFqn);
      if (!directChildren.has(childPkgFqn)) {
        directChildren.set(childPkgFqn, {
          fqn: childPkgFqn,
          name: rest.slice(0, dotIdx),
          file: m.file,
          isExample: false,
        });
      }
    }
  }

  return Array.from(directChildren.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => ({
      id: m.fqn,
      name: m.name,
      compositeName: m.fqn,
      classKind: packagesWithChildren.has(m.fqn) ? "package" : m.isExample ? "model" : "class",
      hasChildren: packagesWithChildren.has(m.fqn),
      language: "modelica",
      iconSvg: icons[m.fqn] ?? null,
    }));
}

export function searchModelicaClasses(_code: string, params?: { query?: string; limit?: number }) {
  const query = (params?.query ?? "").trim().toLowerCase();
  const limit = params?.limit ?? 50;
  if (!query) return { results: [] };
  const mslModels = loadMslModelsIndex();
  const icons = loadMslIcons();
  const results: Array<Record<string, unknown>> = [];
  for (const m of mslModels) {
    if (m.fqn.toLowerCase().includes(query) || m.name.toLowerCase().includes(query)) {
      results.push({
        id: m.fqn,
        name: m.name,
        compositeName: m.fqn,
        classKind: "class",
        hasChildren: false,
        language: "modelica",
        iconSvg: icons[m.fqn] ?? null,
      });
      if (results.length >= limit) break;
    }
  }
  return { results };
}

export function getModelicaClassSource(
  code: string,
  params?: { className?: string },
): { content: string | null; error?: string } {
  const className = params?.className;
  if (!className) return { content: null, error: "No className provided." };
  const mslModels = loadMslModelsIndex();
  const entry = mslModels.find((m) => m.fqn === className);
  if (entry?.file && fs.existsSync(entry.file)) {
    return { content: fs.readFileSync(entry.file, "utf-8") };
  }
  const parsed = parseModelicaModelForPanel(code);
  if (parsed.className === className) {
    return { content: code };
  }
  return { content: null, error: `Source not found for '${className}'.` };
}

export function getModelicaClassIcon(_code: string, params?: { className?: string }): string | null {
  const className = params?.className;
  if (!className) return null;
  const icons = loadMslIcons();
  return icons[className] ?? null;
}

export function getModelicaComponentCatalog() {
  const icons = loadMslIcons();
  const mslModels = loadMslModelsIndex();
  const components: Array<Record<string, unknown>> = [];
  for (const m of mslModels) {
    if (m.isExample) continue;
    const parts = m.fqn.split(".");
    if (parts.length < 3) continue;
    components.push({
      fqn: m.fqn,
      name: m.name,
      kind: "model",
      packageName: parts[0],
      subpackage: parts.slice(0, -1).join("."),
      language: "modelica",
      hasLiveIcon: Boolean(icons[m.fqn]),
    });
    if (components.length >= 600) break;
  }
  return { components };
}

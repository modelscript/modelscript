// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/obj — Language Server Protocol (LSP) Providers.
 *
 * Provides diagnostics (`validateObj`), document symbols (`getObjDocumentSymbols`),
 * hover documentation (`getObjHover`), and keyword/material completions (`getObjCompletions`)
 * for Wavefront OBJ (`.obj`) and MTL (`.mtl`) files.
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { getObjSchemasFromLibraries, lookupObjSchema } from "./catalog/library-package-adapter.js";
import { lintMtl, lintObj } from "./lints/index.js";
import { parseMtl } from "./parser/mtl-parser.js";
import { parseObj } from "./parser/obj-parser.js";
import { computeMeshMetrics } from "./solver/index.js";
import type { MtlDocument } from "./types.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export const LspSymbolKind = {
  File: 1,
  Module: 2,
  Package: 4,
  Class: 5,
  Property: 7,
  Constant: 14,
  Struct: 23,
} as const;

export type LspSymbolKind = (typeof LspSymbolKind)[keyof typeof LspSymbolKind];

export interface LspDocumentSymbol {
  name: string;
  detail?: string;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4;
  code: string;
  source: string;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange;
}

export interface LspCompletionItem {
  label: string;
  detail?: string;
  documentation?: string;
  insertText?: string;
}

const DIRECTIVE_DOCS: Record<string, { title: string; syntax: string; doc: string }> = {
  v: {
    title: "Geometric Vertex",
    syntax: "v x y z [w]",
    doc: "Defines a 3D geometric vertex position in model space (optional homogeneous weight `w`, default 1.0).",
  },
  vt: {
    title: "Texture Coordinate",
    syntax: "vt u [v] [w]",
    doc: "Defines a UV(W) texture coordinate for mapping 2D/3D textures onto polygonal faces.",
  },
  vn: {
    title: "Vertex Normal",
    syntax: "vn nx ny nz",
    doc: "Defines a vertex normal vector `(nx, ny, nz)` used for smooth shading.",
  },
  vp: {
    title: "Parameter-Space Vertex",
    syntax: "vp u [v] [w]",
    doc: "Defines a control point in the parameter space of a free-form curve or surface.",
  },
  f: {
    title: "Polygonal Face",
    syntax: "f v1[/vt1][/vn1] v2[/vt2][/vn2] v3[/vt3][/vn3] ...",
    doc: "Defines a polygonal face using 1-based positive or relative negative vertex/UV/normal indices.",
  },
  l: {
    title: "Polyline Element",
    syntax: "l v1[/vt1] v2[/vt2] ...",
    doc: "Defines a connected polyline passing through the referenced vertices.",
  },
  p: {
    title: "Point Set Element",
    syntax: "p v1 [v2 ...]",
    doc: "Defines one or more discrete 3D points referencing geometric vertices.",
  },
  o: {
    title: "Object Name",
    syntax: "o <name>",
    doc: "Assigns subsequent geometry elements to a named 3D object.",
  },
  g: {
    title: "Group Name(s)",
    syntax: "g <name1> [name2 ...]",
    doc: "Assigns subsequent faces to one or more named polygon groups.",
  },
  s: {
    title: "Smoothing Group",
    syntax: "s <group_number | off>",
    doc: "Enables or disables smooth normal interpolation across adjacent faces.",
  },
  mtllib: {
    title: "Material Template Library",
    syntax: "mtllib <filename.mtl> ...",
    doc: "References one or more companion Wavefront `.mtl` material library files.",
  },
  usemtl: {
    title: "Use Material",
    syntax: "usemtl <material_name>",
    doc: "Binds a named MTL material to all subsequent polygonal faces.",
  },
  newmtl: {
    title: "Define Material (MTL)",
    syntax: "newmtl <material_name>",
    doc: "Begins a new Wavefront MTL material definition.",
  },
  Ka: {
    title: "Ambient Reflectivity (MTL)",
    syntax: "Ka r g b",
    doc: "Ambient RGB reflectivity with each component in `[0.0, 1.0]`.",
  },
  Kd: {
    title: "Diffuse Reflectivity (MTL)",
    syntax: "Kd r g b",
    doc: "Diffuse Lambertian RGB albedo with each component in `[0.0, 1.0]`.",
  },
  Ks: {
    title: "Specular Reflectivity (MTL)",
    syntax: "Ks r g b",
    doc: "Specular highlight RGB reflectivity with each component in `[0.0, 1.0]`.",
  },
  Ke: {
    title: "Emissive Color (MTL)",
    syntax: "Ke r g b",
    doc: "Self-emissive RGB color with each component in `[0.0, 1.0]`.",
  },
  Ns: {
    title: "Specular Exponent (MTL)",
    syntax: "Ns <shininess>",
    doc: "Phong specular exponent controlling highlight tightness (typically `0` to `1000`).",
  },
  d: {
    title: "Dissolve / Opacity (MTL)",
    syntax: "d <factor>",
    doc: "Material opacity from `0.0` (fully transparent) to `1.0` (fully opaque).",
  },
  Tr: {
    title: "Transparency (MTL)",
    syntax: "Tr <factor>",
    doc: "Inverted dissolve (`Tr = 1 - d`), where `0.0` is opaque and `1.0` is fully transparent.",
  },
  Ni: {
    title: "Optical Density / IOR (MTL)",
    syntax: "Ni <ior>",
    doc: "Index of refraction (e.g., `1.0` air, `1.52` borosilicate glass).",
  },
  illum: {
    title: "Illumination Model (MTL)",
    syntax: "illum <0..10>",
    doc: "Selects Wavefront shading model (`1` = diffuse, `2` = Phong specular, `4` = glass transparency).",
  },
};

function isMtlContent(content: string, uri?: string): boolean {
  if (uri && uri.toLowerCase().endsWith(".mtl")) return true;
  return /^\s*newmtl\s+/m.test(content) && !/^\s*v\s+/m.test(content);
}

interface ObjCstLine {
  row: number;
  text: string;
  colLine: string;
  startCol: number;
  endCol: number;
}

interface ObjCstIndex {
  byRow: Map<number, ObjCstLine>;
  lastRow: number;
  lastEndCol: number;
}

function buildObjCstIndex(content: string): ObjCstIndex {
  const byRow = new Map<number, ObjCstLine>();
  let lastRow = 0;
  let lastEndCol = 0;

  let rootNode: CstNodeLike | null = null;
  try {
    rootNode =
      (getOrLoadLanguageWasmParser("obj", import.meta.url, createWasmParserSync).parse(content)?.rootNode as
        CstNodeLike | undefined) ?? null;
  } catch {
    rootNode = null;
  }

  if (rootNode) {
    for (const { row, tokens } of groupAllCstTokensByLine(rootNode)) {
      const lineText = cstLineText(content, tokens);
      const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const startCol = first?.startPosition?.column ?? 0;
      const endCol = last?.endPosition?.column ?? startCol + lineText.length;
      const colLine = startCol > 0 ? " ".repeat(startCol) + lineText : lineText;
      byRow.set(row, { row, text: lineText, colLine, startCol, endCol });
      if (row >= lastRow) {
        lastRow = row;
        lastEndCol = endCol;
      }
    }
  } else {
    const rawLines = content.split(/\r?\n/);
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i] ?? "";
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const startCol = Math.max(0, raw.search(/\S/));
      const endCol = startCol + trimmed.length;
      byRow.set(i, { row: i, text: trimmed, colLine: raw, startCol, endCol });
      lastRow = i;
      lastEndCol = endCol;
    }
  }

  return { byRow, lastRow, lastEndCol };
}

/**
 * Validate a Wavefront OBJ or MTL file and return LSP diagnostics.
 */
export function validateObj(content: string, uri = "model.obj", companionMtl?: MtlDocument): LspDiagnostic[] {
  const cstIndex = buildObjCstIndex(content);
  const diags = isMtlContent(content, uri) ? lintMtl(parseMtl(content)) : lintObj(parseObj(content), companionMtl);

  return diags.map((d) => {
    const lineIdx = Math.max(0, d.line - 1);
    const entry = cstIndex.byRow.get(lineIdx);
    const startChar = d.column ? Math.max(0, d.column - 1) : (entry?.startCol ?? 0);
    const endChar = Math.max(startChar + 1, entry?.endCol ?? startChar + 1);
    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-obj",
      message: d.message,
    };
  });
}

/**
 * Return hierarchical LSP document symbols for a Wavefront OBJ or MTL file.
 */
export function getObjDocumentSymbols(content: string, uri = "model.obj"): LspDocumentSymbol[] {
  const cstIndex = buildObjCstIndex(content);
  const mkLineRange = (lineIdx: number, fallbackLen = 1): LspRange => {
    const entry = cstIndex.byRow.get(lineIdx);
    return {
      start: { line: lineIdx, character: entry?.startCol ?? 0 },
      end: { line: lineIdx, character: Math.max(1, entry?.endCol ?? fallbackLen) },
    };
  };

  if (isMtlContent(content, uri)) {
    const mtl = parseMtl(content);
    const out: LspDocumentSymbol[] = [];
    for (const mat of mtl.materials.values()) {
      const lineIdx = Math.max(0, mat.line - 1);
      const range = mkLineRange(lineIdx, (mtl.rawLines[lineIdx] ?? "").length);
      out.push({
        name: mat.name,
        detail: mat.illum !== undefined ? `illum ${mat.illum}` : "MTL Material",
        kind: LspSymbolKind.Struct,
        range,
        selectionRange: range,
      });
    }
    return out;
  }

  const doc = parseObj(content);
  const metrics = computeMeshMetrics(doc);
  const children: LspDocumentSymbol[] = [];

  for (const obj of doc.objects) {
    const lineIdx = Math.max(0, obj.line - 1);
    const range = mkLineRange(lineIdx, (doc.rawLines[lineIdx] ?? "").length);
    children.push({
      name: obj.name,
      detail: `Object (${obj.faceIndices.length} faces)`,
      kind: LspSymbolKind.Class,
      range,
      selectionRange: range,
    });
  }

  for (const grp of doc.groups) {
    const lineIdx = Math.max(0, grp.line - 1);
    const range = mkLineRange(lineIdx, (doc.rawLines[lineIdx] ?? "").length);
    children.push({
      name: grp.name,
      detail: `Group (${grp.faceIndices.length} faces)`,
      kind: LspSymbolKind.Module,
      range,
      selectionRange: range,
    });
  }

  for (const mat of doc.usedMaterials) {
    const lineIdx = Math.max(0, mat.line - 1);
    const range = mkLineRange(lineIdx, (doc.rawLines[lineIdx] ?? "").length);
    children.push({
      name: mat.name,
      detail: "usemtl",
      kind: LspSymbolKind.Property,
      range,
      selectionRange: range,
    });
  }

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: cstIndex.lastRow, character: cstIndex.lastEndCol },
  };

  return [
    {
      name: doc.objects[0]?.name ?? "Wavefront OBJ Mesh",
      detail: `V=${metrics.vertexCount}, F=${metrics.faceCount}, T=${metrics.triangleCount}`,
      kind: LspSymbolKind.Package,
      range: rootRange,
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      children,
    },
  ];
}

/**
 * Provide markdown hover documentation for Wavefront OBJ/MTL directives and standard materials.
 */
export function getObjHover(content: string, position: LspPosition): LspHover | null {
  const cstIndex = buildObjCstIndex(content);
  const entry = cstIndex.byRow.get(position.line);
  if (!entry) return null;
  const line = entry.colLine;

  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  // Find word under cursor
  let start = position.character;
  let end = position.character;
  while (start > 0 && /[A-Za-z0-9_.-]/.test(line[start - 1] ?? "")) start--;
  while (end < line.length && /[A-Za-z0-9_.-]/.test(line[end] ?? "")) end++;
  const word = line.slice(start, end);

  const firstToken = trimmed.split(/\s+/)[0] ?? "";
  const docEntry = DIRECTIVE_DOCS[word] ?? DIRECTIVE_DOCS[firstToken];
  if (docEntry) {
    return {
      contents: {
        kind: "markdown",
        value: `**${docEntry.title}** (\`${docEntry.syntax}\`)\n\n${docEntry.doc}`,
      },
      range: {
        start: { line: position.line, character: start },
        end: { line: position.line, character: end },
      },
    };
  }

  const schema = lookupObjSchema(word);
  if (schema) {
    return {
      contents: {
        kind: "markdown",
        value: `**${schema.label}** (\`${schema.name}\`)\n\n${schema.description}`,
      },
      range: {
        start: { line: position.line, character: start },
        end: { line: position.line, character: end },
      },
    };
  }

  return null;
}

/**
 * Provide keyword and standard engineering material completions for Wavefront OBJ/MTL files.
 */
export function getObjCompletions(content: string, position: LspPosition, uri = "model.obj"): LspCompletionItem[] {
  const cstIndex = buildObjCstIndex(content);
  const linePrefix = (cstIndex.byRow.get(position.line)?.colLine ?? "").slice(0, position.character).trim();

  // If completing after `usemtl`, suggest standard engineering materials
  if (/^usemtl\b/i.test(linePrefix)) {
    const schemas = getObjSchemasFromLibraries().filter((s) => s.category === "Engineering Materials");
    return schemas.map((s) => ({
      label: s.name,
      detail: s.label,
      documentation: s.description,
      insertText: s.name,
    }));
  }

  const mtlMode = isMtlContent(content, uri);
  const keys = mtlMode
    ? ["newmtl", "Ka", "Kd", "Ks", "Ke", "Ns", "d", "Tr", "Ni", "illum"]
    : ["v", "vt", "vn", "vp", "f", "l", "p", "o", "g", "s", "mtllib", "usemtl"];

  return keys.map((k) => {
    const entry = DIRECTIVE_DOCS[k]!;
    return {
      label: k,
      detail: entry.title,
      documentation: `${entry.syntax} — ${entry.doc}`,
      insertText: `${k} `,
    };
  });
}

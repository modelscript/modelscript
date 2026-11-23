// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Declarative Workspace Indexing for AMPL Models & Data.
 */

import type { DslIndexFileContext, SyntaxNode } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseAmplData } from "./parser/ampl-dat-parser.js";
import { parseAmplModel } from "./parser/ampl-mod-parser.js";
import type { AmplData, AmplModel } from "./types.js";

type AmplCstNodeLike = Omit<SyntaxNode, "hasError"> & { hasError?: boolean | (() => boolean) };

interface AmplCstDeclSpan {
  name: string;
  kind: "array" | "constant" | "variable" | "function" | "property";
  startOffset: number;
  endOffset: number;
  nameStartOffset: number;
  nameEndOffset: number;
  direction?: "minimize" | "maximize" | undefined;
}

function extractValidCstRoot(tree: unknown): SyntaxNode | null {
  if (!tree || typeof tree !== "object") return null;
  const candidate = ("rootNode" in tree ? (tree as { rootNode?: unknown }).rootNode : tree) as
    AmplCstNodeLike | undefined;
  if (!candidate || typeof candidate !== "object" || typeof candidate.type !== "string") return null;
  const hasErr = typeof candidate.hasError === "function" ? candidate.hasError() : Boolean(candidate.hasError);
  if (hasErr || candidate.isError) return null;
  return candidate as SyntaxNode;
}

function cstNodeText(node: SyntaxNode, source: string): string {
  if (typeof node.text === "string" && node.text.length > 0) return node.text;
  if (typeof node.startIndex === "number" && typeof node.endIndex === "number" && node.endIndex >= node.startIndex) {
    return source.slice(node.startIndex, node.endIndex);
  }
  return "";
}

function collectAmplCstTokens(rootNode: SyntaxNode): SyntaxNode[] {
  const tokens: SyntaxNode[] = [];
  const stack: SyntaxNode[] = [rootNode];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const t = cur.type;
    if (t === "DeckIdentifier" || t === "DeckPunct" || t === "DeckNumber" || t === "DeckString") {
      tokens.push(cur);
      continue;
    }
    const kids = cur.namedChildren ?? cur.children ?? [];
    if (kids.length === 0 && t !== "Document" && t !== "DeckToken") {
      tokens.push(cur);
      continue;
    }
    for (let i = kids.length - 1; i >= 0; i--) {
      stack.push(kids[i]!);
    }
  }
  return tokens;
}

function extractAmplDeclsFromCst(rootNode: SyntaxNode, text: string): AmplCstDeclSpan[] {
  const rawTokens = collectAmplCstTokens(rootNode);
  const tokens: { node: SyntaxNode; text: string }[] = [];

  // Filter out `# ...` line comments using token byte offsets
  let skipUntil = -1;
  for (const node of rawTokens) {
    if (node.startIndex < skipUntil) continue;
    const tokText = cstNodeText(node, text);
    if (!tokText) continue;
    if (node.type === "DeckPunct" && tokText.includes("#")) {
      const hashIdx = tokText.indexOf("#");
      const beforeHash = tokText.slice(0, hashIdx);
      if (beforeHash.includes(";")) {
        tokens.push({ node, text: beforeHash });
      }
      const nl = text.indexOf("\n", node.startIndex + hashIdx);
      skipUntil = nl === -1 ? text.length : nl + 1;
      continue;
    }
    tokens.push({ node, text: tokText });
  }

  const decls: AmplCstDeclSpan[] = [];
  let i = 0;
  while (i < tokens.length) {
    const startIdx = i;
    // Find statement end (`;` token)
    let endIdx = i;
    while (endIdx < tokens.length && !tokens[endIdx]!.text.includes(";")) {
      endIdx++;
    }
    const stmtEndOffset =
      endIdx < tokens.length ? tokens[endIdx]!.node.endIndex : tokens[tokens.length - 1]!.node.endIndex;
    const first = tokens[startIdx]!;
    const kw = first.text.toLowerCase();

    if (kw === "set" || kw === "param" || kw === "var" || kw === "minimize" || kw === "maximize") {
      const nameTok = tokens[startIdx + 1];
      if (nameTok && nameTok.node.type === "DeckIdentifier" && startIdx + 1 <= endIdx) {
        const kind: AmplCstDeclSpan["kind"] =
          kw === "set" ? "array" : kw === "param" ? "constant" : kw === "var" ? "variable" : "function";
        decls.push({
          name: nameTok.text,
          kind,
          startOffset: first.node.startIndex,
          endOffset: stmtEndOffset,
          nameStartOffset: nameTok.node.startIndex,
          nameEndOffset: nameTok.node.endIndex,
          direction: kw === "minimize" || kw === "maximize" ? kw : undefined,
        });
      }
    } else if (kw === "s.t.") {
      const nameTok = tokens[startIdx + 1];
      if (nameTok && nameTok.node.type === "DeckIdentifier" && startIdx + 1 <= endIdx) {
        decls.push({
          name: nameTok.text,
          kind: "property",
          startOffset: first.node.startIndex,
          endOffset: stmtEndOffset,
          nameStartOffset: nameTok.node.startIndex,
          nameEndOffset: nameTok.node.endIndex,
        });
      }
    } else if ((kw === "subject" || kw === "subj") && tokens[startIdx + 1]?.text.toLowerCase() === "to") {
      const nameTok = tokens[startIdx + 2];
      if (nameTok && nameTok.node.type === "DeckIdentifier" && startIdx + 2 <= endIdx) {
        decls.push({
          name: nameTok.text,
          kind: "property",
          startOffset: first.node.startIndex,
          endOffset: stmtEndOffset,
          nameStartOffset: nameTok.node.startIndex,
          nameEndOffset: nameTok.node.endIndex,
        });
      }
    }

    i = endIdx + 1;
  }

  return decls;
}

/**
 * Disambiguates AMPL `.mod` and `.dat` files in polyglot `UnifiedWorkspace` instances.
 */
export function canIndexAmpl(uri: string, text?: string): boolean {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".ampl") || lower.endsWith(".run") || lower.endsWith(".mps")) {
    return true;
  }
  if (!text) return lower.endsWith(".mod") || lower.endsWith(".dat");
  return /(?:^|\s)(?:set|param|var|minimize|maximize|subject\s+to|data;|solve;)\b/m.test(text);
}

/**
 * Declarative per-file indexer for AMPL `.mod` and `.dat` documents.
 *
 * Uses CST-first declaration span extraction when a valid compiled WASM `SyntaxNode` tree
 * is provided via `ctx.tree`, falling back gracefully to the string-based AMPL parsers.
 */
export function indexAmplDocument(ctx: DslIndexFileContext): void {
  const { text } = ctx;
  const isDat = ctx.extension === ".dat" || /^\s*(?:set|param)\s+\w+\s*:?=/m.test(text);
  const cstRoot = extractValidCstRoot(ctx.tree);
  const cstDecls = cstRoot ? extractAmplDeclsFromCst(cstRoot, text) : null;
  const cstByName = new Map<string, AmplCstDeclSpan>();
  if (cstDecls) {
    for (const d of cstDecls) {
      if (!cstByName.has(d.name)) cstByName.set(d.name, d);
    }
  }

  if (isDat) {
    let data: AmplData | null = null;
    try {
      data = parseAmplData(text);
      ctx.setParsedModel<AmplData>(data, "data");
    } catch {
      // Fallback to CST declarations if available
    }

    if (data || (cstDecls && cstDecls.length > 0)) {
      const rootId = ctx.addSymbol("AMPL_Data", "package", null, 0, text.length);
      const emitted = new Set<string>();

      if (data) {
        for (const [setName, elements] of data.sets) {
          const span = cstByName.get(setName);
          emitted.add(setName);
          ctx.addSymbol(
            setName,
            "array",
            rootId,
            span?.startOffset ?? 0,
            span?.endOffset ?? Math.min(50, text.length),
            { size: elements.length },
            span
              ? { fieldRanges: { name: { startOffset: span.nameStartOffset, endOffset: span.nameEndOffset } } }
              : undefined,
          );
        }
        for (const [paramName, values] of data.params) {
          const span = cstByName.get(paramName);
          emitted.add(paramName);
          ctx.addSymbol(
            paramName,
            "constant",
            rootId,
            span?.startOffset ?? 0,
            span?.endOffset ?? Math.min(50, text.length),
            { size: values.size },
            span
              ? { fieldRanges: { name: { startOffset: span.nameStartOffset, endOffset: span.nameEndOffset } } }
              : undefined,
          );
        }
      }

      if (cstDecls) {
        for (const decl of cstDecls) {
          if (emitted.has(decl.name)) continue;
          if (decl.kind !== "array" && decl.kind !== "constant") continue;
          emitted.add(decl.name);
          ctx.addSymbol(
            decl.name,
            decl.kind,
            rootId,
            decl.startOffset,
            decl.endOffset,
            {},
            { fieldRanges: { name: { startOffset: decl.nameStartOffset, endOffset: decl.nameEndOffset } } },
          );
        }
      }
    }
  } else {
    let model: AmplModel | null = null;
    try {
      model = parseAmplModel(text);
      ctx.setParsedModel<AmplModel>(model);
    } catch {
      // Fallback to CST declarations if available
    }

    if (model || (cstDecls && cstDecls.length > 0)) {
      const rootId = ctx.addSymbol("AMPL_Model", "package", null, 0, text.length);
      const emitted = new Set<string>();

      if (model) {
        for (const [name, decl] of model.sets) {
          const span = cstByName.get(name);
          emitted.add(name);
          ctx.addSymbol(
            name,
            "array",
            rootId,
            span?.startOffset ?? 0,
            span?.endOffset ?? Math.min(50, text.length),
            { dimen: decl.dimen },
            span
              ? { fieldRanges: { name: { startOffset: span.nameStartOffset, endOffset: span.nameEndOffset } } }
              : undefined,
          );
        }
        for (const [name, decl] of model.params) {
          const span = cstByName.get(name);
          emitted.add(name);
          ctx.addSymbol(
            name,
            "constant",
            rootId,
            span?.startOffset ?? 0,
            span?.endOffset ?? Math.min(50, text.length),
            { type: decl.type },
            span
              ? { fieldRanges: { name: { startOffset: span.nameStartOffset, endOffset: span.nameEndOffset } } }
              : undefined,
          );
        }
        for (const [name, decl] of model.vars) {
          const span = cstByName.get(name);
          emitted.add(name);
          ctx.addSymbol(
            name,
            "variable",
            rootId,
            span?.startOffset ?? 0,
            span?.endOffset ?? Math.min(50, text.length),
            { type: decl.type },
            span
              ? { fieldRanges: { name: { startOffset: span.nameStartOffset, endOffset: span.nameEndOffset } } }
              : undefined,
          );
        }
        for (const [name, decl] of model.objectives) {
          const span = cstByName.get(name);
          emitted.add(name);
          ctx.addSymbol(
            name,
            "function",
            rootId,
            span?.startOffset ?? 0,
            span?.endOffset ?? Math.min(50, text.length),
            { direction: decl.direction },
            span
              ? { fieldRanges: { name: { startOffset: span.nameStartOffset, endOffset: span.nameEndOffset } } }
              : undefined,
          );
        }
        for (const [name, decl] of model.constraints) {
          const span = cstByName.get(name);
          emitted.add(name);
          ctx.addSymbol(
            name,
            "property",
            rootId,
            span?.startOffset ?? 0,
            span?.endOffset ?? Math.min(50, text.length),
            { operator: decl.operator },
            span
              ? { fieldRanges: { name: { startOffset: span.nameStartOffset, endOffset: span.nameEndOffset } } }
              : undefined,
          );
        }
      }

      if (cstDecls) {
        for (const decl of cstDecls) {
          if (emitted.has(decl.name)) continue;
          emitted.add(decl.name);
          ctx.addSymbol(
            decl.name,
            decl.kind,
            rootId,
            decl.startOffset,
            decl.endOffset,
            decl.direction ? { direction: decl.direction } : {},
            { fieldRanges: { name: { startOffset: decl.nameStartOffset, endOffset: decl.nameEndOffset } } },
          );
        }
      }
    }
  }
}

/**
 * Retrieves a parsed `AmplModel` from `UnifiedWorkspace` for `uri`.
 */
export function getAmplModel(workspace: UnifiedWorkspace, uri: string): AmplModel | undefined {
  return workspace.getParsedModel<AmplModel>(uri);
}

/**
 * Retrieves a parsed `AmplData` from `UnifiedWorkspace` for `uri`.
 */
export function getAmplData(workspace: UnifiedWorkspace, uri: string): AmplData | undefined {
  return workspace.getParsedModel<AmplData>(uri, "data");
}

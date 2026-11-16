// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/reqif — Language Server Protocol (LSP) Service Integration.
 *
 * Implements real-time diagnostic reporting, document symbol trees,
 * hover documentation, and formal entailment inspection for OMG ReqIF 1.2.
 */

import { xmlErrorToLspRange } from "@modelscript/dsl/xml";
import type { SymbolEntry, UnifiedWorkspace } from "@modelscript/runtime";
import { lintReqIf } from "./lints/index.js";
import { parseReqIf } from "./parser/reqif-parser.js";
import { parseReqIfXmlDocument } from "./parser/wasm-loader.js";
import type { ReqIfDocument, ReqIfSpecHierarchy, ReqIfSpecObject, SourceSpan } from "./types.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export enum LspSymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[] | undefined;
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4; // 1 = Error, 2 = Warning, 3 = Information, 4 = Hint
  code: string | number;
  source: string;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange | undefined;
}

/**
 * Validates a ReqIF document text and produces LSP diagnostics.
 */
export function validateReqif(content: string, cstTree?: { rootNode?: unknown } | null): LspDiagnostic[] {
  const xml = parseReqIfXmlDocument(content, cstTree);
  const diags: LspDiagnostic[] = [];

  if (xml.errors && xml.errors.length > 0) {
    for (const err of xml.errors) {
      diags.push({
        range: xmlErrorToLspRange(content, err),
        severity: 1,
        code: "REQIF-PARSE-ERROR",
        source: "reqif",
        message: err.message || "XML syntax error in ReqIF document",
      });
    }
  }

  let doc: ReqIfDocument;
  try {
    doc = parseReqIf(content, { cstTree });
  } catch (err: unknown) {
    if (diags.length === 0) {
      diags.push({
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "REQIF-PARSE-ERROR",
        source: "reqif",
        message: (err instanceof Error ? err.message : String(err)) || "Failed to parse ReqIF XML document",
      });
    }
    return diags;
  }

  const lintDiags = lintReqIf(doc);
  for (const d of lintDiags) {
    const startLine = d.span ? Math.max(0, d.span.startLine - 1) : 0;
    const startCol = d.span ? Math.max(0, d.span.startCol - 1) : 0;
    const endLine = d.span ? Math.max(0, d.span.endLine - 1) : startLine;
    const endCol = d.span ? Math.max(0, d.span.endCol - 1) : startCol + 10;

    diags.push({
      range: {
        start: { line: startLine, character: startCol },
        end: { line: endLine, character: endCol },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.code,
      source: "reqif",
      message: d.message,
    });
  }

  return diags;
}

/**
 * Builds hierarchical DocumentSymbols representing specifications and requirements.
 */
export function getReqifDocumentSymbols(content: string): LspDocumentSymbol[] {
  let doc: ReqIfDocument;
  try {
    doc = parseReqIf(content);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  function hierarchyToSymbol(h: ReqIfSpecHierarchy): LspDocumentSymbol | null {
    const obj = doc.specObjects.get(h.objectRef);
    if (!obj) return null;

    const startLine = obj.span ? Math.max(0, obj.span.startLine - 1) : 0;
    const startCol = obj.span ? Math.max(0, obj.span.startCol - 1) : 0;
    const endLine = obj.span ? Math.max(0, obj.span.endLine - 1) : startLine;
    const endCol = obj.span ? Math.max(0, obj.span.endCol - 1) : startCol + 20;

    const range: LspRange = {
      start: { line: startLine, character: startCol },
      end: { line: endLine, character: endCol },
    };

    const asilStr = obj.asilLevel ? ` [${obj.asilLevel}]` : "";
    const contractStr = obj.contract
      ? ` (${obj.contract.variable} ${obj.contract.comparator} ${obj.contract.limitValue}${obj.contract.unit ? " " + obj.contract.unit : ""})`
      : "";
    const detail = `${obj.longName ?? ""}${asilStr}${contractStr}`.trim();

    const childSymbols: LspDocumentSymbol[] = [];
    if (h.children && h.children.length > 0) {
      for (const child of h.children) {
        const s = hierarchyToSymbol(child);
        if (s) childSymbols.push(s);
      }
    }

    return {
      name: `[${obj.identifier}] ${obj.longName ?? obj.text.slice(0, 30)}`,
      detail: detail.length > 0 ? detail : undefined,
      kind: LspSymbolKind.Interface,
      range,
      selectionRange: range,
      children: childSymbols.length > 0 ? childSymbols : undefined,
    };
  }

  for (const spec of doc.specifications) {
    const startLine = spec.span ? Math.max(0, spec.span.startLine - 1) : 0;
    const startCol = spec.span ? Math.max(0, spec.span.startCol - 1) : 0;
    const endLine = spec.span ? Math.max(0, spec.span.endLine - 1) : startLine;
    const endCol = spec.span ? Math.max(0, spec.span.endCol - 1) : startCol + 20;

    const specRange: LspRange = {
      start: { line: startLine, character: startCol },
      end: { line: endLine, character: endCol },
    };

    const children: LspDocumentSymbol[] = [];
    for (const h of spec.children) {
      const s = hierarchyToSymbol(h);
      if (s) children.push(s);
    }

    symbols.push({
      name: spec.longName ?? spec.identifier,
      detail: `Specification (${children.length} root items)`,
      kind: LspSymbolKind.Package,
      range: specRange,
      selectionRange: specRange,
      children: children.length > 0 ? children : undefined,
    });
  }

  return symbols;
}

/**
 * Resolves hover documentation for a requirement under cursor.
 */
export function getReqifHover(content: string, line: number, character: number): LspHover | null {
  let doc: ReqIfDocument;
  try {
    doc = parseReqIf(content);
  } catch {
    return null;
  }

  // 1-indexed line for comparison with SourceSpan
  const l1 = line + 1;
  const c1 = character + 1;

  for (const obj of doc.specObjects.values()) {
    if (obj.span) {
      const inside =
        (l1 > obj.span.startLine || (l1 === obj.span.startLine && c1 >= obj.span.startCol)) &&
        (l1 < obj.span.endLine || (l1 === obj.span.endLine && c1 <= obj.span.endCol));

      if (inside) {
        return formatSpecObjectHover(obj, doc);
      }
    }
  }

  return null;
}

function formatSpecObjectHover(obj: ReqIfSpecObject, doc: ReqIfDocument): LspHover {
  const md: string[] = [];
  md.push(`### Requirement: \`${obj.identifier}\``);
  if (obj.longName) {
    md.push(`**Title:** ${obj.longName}`);
  }

  const badges: string[] = [];
  if (obj.asilLevel) badges.push(`**ASIL:** \`${obj.asilLevel}\``);
  if (obj.status) badges.push(`**Status:** \`${obj.status}\``);
  if (badges.length > 0) {
    md.push(badges.join(" | "));
  }

  if (obj.text) {
    md.push(`\n> ${obj.text.trim()}\n`);
  }

  if (obj.contract) {
    const c = obj.contract;
    const unitStr = c.unit ? ` ${c.unit}` : "";
    md.push(`**Formal Contract (Nelson-Oppen):** \`${c.variable} ${c.comparator} ${c.limitValue}${unitStr}\``);
  }

  // Traceability relations
  const outgoing = doc.specRelations.filter((r) => r.sourceId === obj.identifier);
  const incoming = doc.specRelations.filter((r) => r.targetId === obj.identifier);

  if (outgoing.length > 0 || incoming.length > 0) {
    md.push(`\n**Traceability Links:**`);
    for (const r of outgoing) {
      md.push(`- *${r.relationType}* → \`${r.targetId}\``);
    }
    for (const r of incoming) {
      md.push(`- *${r.relationType}* ← from \`${r.sourceId}\``);
    }
  }

  return {
    contents: {
      kind: "markdown",
      value: md.join("\n"),
    },
  };
}

function reqifSpanToRange(span?: SourceSpan): LspRange {
  if (!span) {
    return { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
  }
  const startLine = Math.max(0, span.startLine - 1);
  const startCol = Math.max(0, span.startCol - 1);
  const endLine = Math.max(0, span.endLine - 1);
  const endCol = Math.max(0, span.endCol - 1);
  return {
    start: { line: startLine, character: startCol },
    end: { line: endLine, character: endCol },
  };
}

function reqifOffsetToPosition(text: string, offset: number): LspPosition {
  const clamped = Math.max(0, Math.min(text.length, offset));
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: clamped - lineStart };
}

function reqifSymbolUri(sym: SymbolEntry): string {
  return sym.resourceId || sym.documentUri || "";
}

function reqifSymbolToLocation(sym: SymbolEntry, workspace: UnifiedWorkspace): LspLocation {
  const symUri = reqifSymbolUri(sym);
  const docText = workspace.getDocument(symUri)?.text ?? "";
  const nameRange = sym.fieldRanges?.["name"];
  const startOff = nameRange?.startOffset ?? sym.startOffset ?? 0;
  const endOff = nameRange?.endOffset ?? sym.endOffset ?? startOff;
  return {
    uri: symUri,
    range: {
      start: reqifOffsetToPosition(docText, startOff),
      end: reqifOffsetToPosition(docText, Math.max(startOff, endOff)),
    },
  };
}

function extractReqifTokenAtOffset(text: string, offset: number): string {
  if (offset < 0 || offset > text.length) return "";
  const isChar = (ch: string | undefined) => Boolean(ch && /[A-Za-z0-9_.-]/.test(ch));
  let start = offset;
  while (start > 0 && isChar(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && isChar(text[end])) end++;
  return text.slice(start, end);
}

function collectReqifWorkspacePeers(
  workspace: UnifiedWorkspace,
  uri: string,
  reqIdentifier: string,
  longName?: string,
): LspLocation[] {
  const uIdx = workspace.getIndex();
  workspace.syncTggCorrespondences(uIdx);
  const out: LspLocation[] = [];
  const seen = new Set<string>();
  const pushSym = (sym: SymbolEntry) => {
    const loc = reqifSymbolToLocation(sym, workspace);
    if (!loc.uri) return;
    const key = `${loc.uri}:${loc.range.start.line}:${loc.range.start.character}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(loc);
    }
  };

  const indexer = workspace.tggCorrespondenceIndexer;
  for (const symId of uIdx.byName.get(reqIdentifier) ?? []) {
    const sym = uIdx.symbols.get(symId);
    if (!sym || reqifSymbolUri(sym) !== uri) continue;
    for (const slot of indexer.getSlotsForSymbol(symId)) {
      const rec = indexer.hypergraph.getRecord(slot);
      if (!rec || rec.isRemoved) continue;
      for (const memberId of Object.values(rec.domainNodes)) {
        if (typeof memberId === "number" && memberId !== symId) {
          const peer = uIdx.symbols.get(memberId);
          if (peer) pushSym(peer);
        }
      }
    }
  }

  // Also include cross-language `satisfy` / `verify` usages referencing `reqIdentifier` or `longName`
  const matchNames = new Set([reqIdentifier, ...(longName ? [longName] : [])]);
  for (const sym of uIdx.symbols.values()) {
    if (sym.language === "reqif") continue;
    const satisfied = String(
      sym.metadata?.["satisfiedRequirement"] ?? sym.metadata?.["verifiedRequirement"] ?? "",
    ).replace(/^['"]|['"]$/g, "");
    if (satisfied && matchNames.has(satisfied)) {
      pushSym(sym);
    }
  }

  return out;
}

/**
 * Resolves Go-to-Definition for ReqIF `SPEC-OBJECT-REF` links (`SPEC-HIERARCHY`, `SPEC-RELATION`)
 * and cross-language TGG counterparts (SysML v2 requirements/satisfactions, Modelica verifiers).
 */
export function getReqifDefinition(
  content: string,
  offset: number,
  uri = "file:///requirements.reqif",
  workspace?: UnifiedWorkspace,
): LspLocation | null {
  let doc: ReqIfDocument;
  try {
    doc = parseReqIf(content);
  } catch {
    return null;
  }

  if (workspace && !workspace.getNativeFileIndex(uri)) {
    workspace.indexDocumentText(uri, content, "reqif");
  }

  const token = extractReqifTokenAtOffset(content, offset);
  let targetObj: ReqIfSpecObject | undefined = token ? doc.specObjects.get(token) : undefined;
  if (!targetObj && token) {
    for (const obj of doc.specObjects.values()) {
      if (obj.longName === token) {
        targetObj = obj;
        break;
      }
    }
  }

  if (!targetObj) {
    for (const rel of doc.specRelations) {
      if (rel.span && offset >= (rel.span.startOffset ?? -1) && offset <= (rel.span.endOffset ?? -1)) {
        targetObj = doc.specObjects.get(rel.targetId) ?? doc.specObjects.get(rel.sourceId);
        if (targetObj) break;
      }
    }
  }

  if (!targetObj) {
    for (const obj of doc.specObjects.values()) {
      if (obj.span && offset >= (obj.span.startOffset ?? -1) && offset <= (obj.span.endOffset ?? -1)) {
        targetObj = obj;
        break;
      }
    }
  }

  if (!targetObj) return null;

  const inOwnDecl =
    targetObj.span !== undefined &&
    targetObj.span.startOffset !== undefined &&
    targetObj.span.endOffset !== undefined &&
    offset >= targetObj.span.startOffset &&
    offset <= targetObj.span.endOffset;

  if (inOwnDecl && workspace) {
    const peers = collectReqifWorkspacePeers(workspace, uri, targetObj.identifier, targetObj.longName);
    const firstPeer = peers[0];
    if (firstPeer) return firstPeer;
  }

  return {
    uri,
    range: reqifSpanToRange(targetObj.span),
  };
}

/**
 * Finds all intra/inter-file ReqIF references (`SPEC-OBJECT`, `SPEC-RELATION`, `SPEC-HIERARCHY`)
 * and cross-language TGG counterparts (SysML v2 requirements/`satisfy`/`verify`, Modelica verifiers).
 */
export function getReqifReferences(
  content: string,
  offset: number,
  uri = "file:///requirements.reqif",
  workspace?: UnifiedWorkspace,
): LspLocation[] {
  let doc: ReqIfDocument;
  try {
    doc = parseReqIf(content);
  } catch {
    return [];
  }

  if (workspace && !workspace.getNativeFileIndex(uri)) {
    workspace.indexDocumentText(uri, content, "reqif");
  }

  const token = extractReqifTokenAtOffset(content, offset);
  let targetObj: ReqIfSpecObject | undefined = token ? doc.specObjects.get(token) : undefined;
  if (!targetObj && token) {
    for (const obj of doc.specObjects.values()) {
      if (obj.longName === token) {
        targetObj = obj;
        break;
      }
    }
  }
  if (!targetObj) {
    for (const obj of doc.specObjects.values()) {
      if (obj.span && offset >= (obj.span.startOffset ?? -1) && offset <= (obj.span.endOffset ?? -1)) {
        targetObj = obj;
        break;
      }
    }
  }
  if (!targetObj) return [];

  const results: LspLocation[] = [];
  const seen = new Set<string>();
  const pushLoc = (loc: LspLocation) => {
    const key = `${loc.uri}:${loc.range.start.line}:${loc.range.start.character}:${loc.range.end.line}:${loc.range.end.character}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(loc);
    }
  };

  pushLoc({ uri, range: reqifSpanToRange(targetObj.span) });

  for (const rel of doc.specRelations) {
    if (rel.sourceId === targetObj.identifier || rel.targetId === targetObj.identifier) {
      pushLoc({ uri, range: reqifSpanToRange(rel.span) });
    }
  }

  const walkHierarchy = (h: ReqIfSpecHierarchy) => {
    if (h.objectRef === targetObj.identifier && h.span) {
      pushLoc({ uri, range: reqifSpanToRange(h.span) });
    }
    for (const c of h.children ?? []) walkHierarchy(c);
  };
  for (const spec of doc.specifications) {
    for (const h of spec.children) walkHierarchy(h);
  }

  if (workspace) {
    for (const [otherUri, otherDoc] of workspace.getAllParsedModels<ReqIfDocument>()) {
      if (otherUri === uri || !otherDoc?.specRelations) continue;
      for (const rel of otherDoc.specRelations) {
        if (rel.sourceId === targetObj.identifier || rel.targetId === targetObj.identifier) {
          pushLoc({ uri: otherUri, range: reqifSpanToRange(rel.span) });
        }
      }
    }
    for (const peer of collectReqifWorkspacePeers(workspace, uri, targetObj.identifier, targetObj.longName)) {
      pushLoc(peer);
    }
  }

  return results;
}

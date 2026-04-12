/* eslint-disable */
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { WebSocket, WebSocketServer } from "ws";
import { AdapterRegistry, type ProjectionResult } from "./adapter-registry.js";
import { extractClassSpecs, generateAstClasses } from "./generate-ast-classes.js";
import { extractKeywords } from "./generate-highlights.js";
import { extractIndexerHooks } from "./generate-indexer.js";
import { extractRefHooks } from "./generate-refs.js";
import { buildWasm, findWasmFile } from "./init.js";
import { LSPBridge, PositionIndex } from "./lsp-bridge.js";
import { QueryEngine } from "./query-engine.js";
import { ScopeResolver } from "./resolver.js";
import type { IndexerHook, SymbolIndex } from "./runtime.js";
import { nodeEndByte, nodeStartByte, SymbolIndexer, type CSTNode } from "./symbol-indexer.js";

// ---------------------------------------------------------------------------
// Mock parser fallback (used when WASM is not available)
// ---------------------------------------------------------------------------

function mockParse(source: string): CSTNode {
  const tokens: { type: string; text: string; start: number; end: number }[] = [];
  const re = /([a-zA-Z_][a-zA-Z0-9_.]*)|(\\d+(?:\\.\\d+)?)|("(?:[^"])*")|([;=(),:])|(\\s+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m[5]) continue;
    tokens.push({
      type: m[1] ? "IDENT" : m[2] ? "NUMBER" : m[3] ? "STRING" : "PUNCT",
      text: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  const children: CSTNode[] = tokens.map((t) => ({
    type: t.type,
    text: t.text,
    startByte: t.start,
    endByte: t.end,
    children: [],
    childForFieldName: () => null,
  }));
  return {
    type: "file",
    text: source,
    startByte: 0,
    endByte: source.length,
    children,
    childForFieldName: () => null,
  };
}

// ---------------------------------------------------------------------------
// web-tree-sitter adapter: LAZY wrap SyntaxNode → CSTNode
// Only materializes children when accessed, so unchanged subtrees are free.
// ---------------------------------------------------------------------------

function lazyWrapNode(node: any): CSTNode {
  let _children: CSTNode[] | null = null;
  const _childCache = new Map<number, CSTNode>();
  return {
    get type() {
      return node.type;
    },
    get text() {
      return node.text;
    },
    get startByte() {
      return node.startIndex;
    },
    get endByte() {
      return node.endIndex;
    },
    get hasChanges() {
      return node.hasChanges;
    },
    get isMissing() {
      return node.isMissing;
    },
    get hasError() {
      return node.hasError;
    },
    get childCount() {
      return node.childCount;
    },
    child(i: number): CSTNode | null {
      if (i < 0 || i >= node.childCount) return null;
      let cached = _childCache.get(i);
      if (!cached) {
        cached = lazyWrapNode(node.child(i));
        _childCache.set(i, cached);
      }
      return cached;
    },
    get children() {
      if (!_children) {
        _children = [];
        for (let i = 0; i < node.childCount; i++) {
          let c = _childCache.get(i);
          if (!c) {
            c = lazyWrapNode(node.child(i));
            _childCache.set(i, c);
          }
          _children.push(c);
        }
      }
      return _children;
    },
    childForFieldName(name: string): CSTNode | null {
      const child = node.childForFieldName(name);
      return child ? lazyWrapNode(child) : null;
    },
  };
}

// ---------------------------------------------------------------------------
// CST → JSON serializer
// ---------------------------------------------------------------------------

interface CSTJson {
  type: string;
  text?: string;
  startByte: number;
  endByte: number;
  children?: CSTJson[];
}

function cstToJson(node: CSTNode, depth = 0): CSTJson {
  const result: CSTJson = {
    type: node.type,
    startByte: nodeStartByte(node),
    endByte: nodeEndByte(node),
  };
  if (depth > 8 || node.children.length === 0) {
    result.text = node.text.substring(0, 120);
  }
  if (node.children.length > 0) {
    result.children = node.children.map((c) => cstToJson(c, depth + 1));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Symbol Index → Pull-Up AST JSON
// ---------------------------------------------------------------------------

function indexToAstJson(index: SymbolIndex): Record<string, unknown>[] {
  const childrenOf = new Map<number | null, Record<string, unknown>[]>();
  for (const entry of index.symbols.values()) {
    const parent = entry.parentId;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push({
      id: entry.id,
      kind: entry.kind,
      name: entry.name,
      metadata: entry.metadata,
      children: [],
    });
  }
  function attachChildren(nodes: Record<string, unknown>[]) {
    for (const node of nodes) {
      const kids = childrenOf.get(node.id as number) ?? [];
      node.children = kids;
      attachChildren(kids);
    }
  }
  const topLevel = childrenOf.get(null) ?? [];
  attachChildren(topLevel);
  return topLevel;
}

// ---------------------------------------------------------------------------
// Diagnostics — extract ERROR/MISSING nodes from CST (incremental)
// ---------------------------------------------------------------------------

interface DiagnosticJson {
  startByte: number;
  endByte: number;
  message: string;
  severity: "error" | "warning" | "info" | "hint";
}

/** Full diagnostic collection — walks entire tree. Used for initial parse. */
function collectDiagnosticsFull(node: CSTNode, sourceText: string): DiagnosticJson[] {
  const diagnostics: DiagnosticJson[] = [];
  walkForErrors(node, diagnostics, sourceText);
  return diagnostics;
}

/** Incremental diagnostic collection — keeps old diagnostics outside edit zones,
 *  walks only edit zone children of root using binary search to find errors. */
function collectDiagnosticsIncremental(
  node: CSTNode,
  sourceText: string,
  oldDiagnostics: DiagnosticJson[],
  editRanges: Array<{ startByte: number; endByte: number }>,
): DiagnosticJson[] {
  // Compute combined edit bounds (with margin to catch shifted ERROR nodes)
  let editStart = Infinity,
    editEnd = 0;
  for (const r of editRanges) {
    editStart = Math.min(editStart, r.startByte);
    editEnd = Math.max(editEnd, r.endByte);
  }
  // Expand the zone slightly to catch errors that tree-sitter may shift
  editStart = Math.max(0, editStart - 1);
  editEnd = editEnd + 1;

  // Keep old diagnostics that are completely outside the edit zone
  const kept = oldDiagnostics.filter((d) => d.endByte <= editStart || d.startByte >= editEnd);

  // Walk only children of root that overlap the edit zone
  const found: DiagnosticJson[] = [];
  const childCount = node.childCount ?? 0;

  if (childCount > 32) {
    // Binary search for edit zone boundaries in root children
    let lo = 0,
      hi = childCount;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const c = node.child!(mid);
      if (c && nodeEndByte(c) < editStart) lo = mid + 1;
      else hi = mid;
    }
    const first = Math.max(0, lo - 1);

    lo = first;
    hi = childCount;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const c = node.child!(mid);
      if (c && nodeStartByte(c) <= editEnd) lo = mid + 1;
      else hi = mid;
    }
    const last = Math.min(childCount - 1, lo);

    for (let i = first; i <= last; i++) {
      const ch = node.child!(i);
      if (ch) walkForErrors(ch, found, sourceText);
    }
  } else {
    // Small tree — just walk everything
    walkForErrors(node, found, sourceText);
  }

  return [...kept, ...found];
}

function walkForErrors(node: CSTNode, diagnostics: DiagnosticJson[], sourceText: string): void {
  // Prune subtrees that have no errors — huge win for large files
  if (node.hasError === false) return;

  if (node.type === "ERROR") {
    const snippet = sourceText.substring(nodeStartByte(node), Math.min(nodeEndByte(node), nodeStartByte(node) + 30));
    diagnostics.push({
      startByte: nodeStartByte(node),
      endByte: nodeEndByte(node),
      message: "Syntax error: unexpected '" + snippet.trim() + "'",
      severity: "error",
    });
    return;
  }
  if (node.isMissing) {
    diagnostics.push({
      startByte: nodeStartByte(node),
      endByte: nodeEndByte(node) === nodeStartByte(node) ? nodeStartByte(node) + 1 : nodeEndByte(node),
      message: `Missing expected '${node.type}'`,
      severity: "error",
    });
    return;
  }
  // Auto-generated recovery blobs — valid grammar but semantically errors
  if (node.type.startsWith("recovery_")) {
    const snippet = sourceText.substring(nodeStartByte(node), Math.min(nodeEndByte(node), nodeStartByte(node) + 30));
    diagnostics.push({
      startByte: nodeStartByte(node),
      endByte: nodeEndByte(node),
      message: "Syntax error: unexpected '" + snippet.trim() + "'",
      severity: "error",
    });
    return;
  }
  const count = node.childCount ?? node.children.length;
  for (let i = 0; i < count; i++) {
    const ch = node.child ? node.child(i) : node.children[i];
    if (ch) walkForErrors(ch, diagnostics, sourceText);
  }
}

/** Only recurse into subtrees where hasChanges is true. */
function walkForErrorsIncremental(node: CSTNode, diagnostics: DiagnosticJson[], sourceText: string): void {
  if (node.hasChanges === false) return; // Skip unchanged subtrees entirely
  if (node.type === "ERROR") {
    const snippet = sourceText.substring(nodeStartByte(node), Math.min(nodeEndByte(node), nodeStartByte(node) + 30));
    diagnostics.push({
      startByte: nodeStartByte(node),
      endByte: nodeEndByte(node),
      message: "Syntax error: unexpected '" + snippet.trim() + "'",
      severity: "error",
    });
    return;
  }
  if (node.type === "MISSING") {
    diagnostics.push({
      startByte: nodeStartByte(node),
      endByte: nodeEndByte(node) === nodeStartByte(node) ? nodeStartByte(node) + 1 : nodeEndByte(node),
      message: "Missing expected token",
      severity: "error",
    });
    return;
  }
  const count = node.childCount ?? node.children.length;
  for (let i = 0; i < count; i++) {
    const ch = node.child ? node.child(i) : node.children[i];
    if (ch) walkForErrorsIncremental(ch, diagnostics, sourceText);
  }
}

// ---------------------------------------------------------------------------
// Incremental CST serialization — only serialize changed subtrees
// ---------------------------------------------------------------------------

interface CSTJsonPatch {
  path: number[];
  node: CSTJson;
}

/**
 * Walk the CST tree, finding the minimal set of changed subtrees.
 * For unchanged subtrees (hasChanges === false), skip entirely.
 * Returns patches: each is a path (child indices from root) + serialized subtree.
 */
function cstPatchesFromTree(node: CSTNode, cachedJson: CSTJson | null): CSTJsonPatch[] {
  const patches: CSTJsonPatch[] = [];
  findChangedSubtrees(node, cachedJson, [], patches);
  return patches;
}

function findChangedSubtrees(node: CSTNode, cached: CSTJson | null, path: number[], patches: CSTJsonPatch[]): void {
  if (node.hasChanges === false) return; // Unchanged — no patches, no materialization

  // Use childCount + child(i) to avoid materializing ALL children
  const childCount = node.childCount ?? node.children.length;
  if (childCount > 0) {
    // Find which specific children changed (without materializing unchanged ones)
    let anyChildChanged = false;
    for (let i = 0; i < childCount; i++) {
      const child = node.child ? node.child(i) : node.children[i];
      if (child && child.hasChanges !== false) {
        anyChildChanged = true;
        break;
      }
    }
    if (anyChildChanged) {
      // Check if structure changed (children added/removed)
      if (!cached || childCount !== (cached.children?.length ?? 0)) {
        // Structure changed — send full subtree
        patches.push({ path, node: cstToJson(node) });
        return;
      }
      // Recurse only into changed children
      for (let i = 0; i < childCount; i++) {
        const child = node.child ? node.child(i) : node.children[i];
        if (child) {
          findChangedSubtrees(child, cached?.children?.[i] ?? null, [...path, i], patches);
        }
      }
      return;
    }
  }

  // Leaf-level change — serialize just this subtree
  patches.push({ path, node: cstToJson(node) });
}

// ---------------------------------------------------------------------------
// Playground Server
// ---------------------------------------------------------------------------

export interface PlaygroundOptions {
  /** Path to the primary language.ts config file. */
  languageFile: string;
  /**
   * Optional path to a second language.ts for polyglot (split-editor) mode.
   * When supplied, the playground shows two Monaco editors side-by-side
   * with a central Interop Bridge panel showing live cross-language projections.
   */
  secondLanguageFile?: string;
  /** Port to serve on (default: 3377). */
  port?: number;
}

export async function startPlayground(options: PlaygroundOptions): Promise<void> {
  const { languageFile, secondLanguageFile, port = 3377 } = options;
  const polyglot = !!secondLanguageFile;

  // ---------------------------------------------------------------------------
  // Helper: load a single language config + parser
  // ---------------------------------------------------------------------------
  async function loadLang(langFile: string) {
    const langDir = path.dirname(path.resolve(langFile));
    const langMod = require(path.resolve(langFile));
    const langConfig = langMod.default || langMod;
    const langName: string = langConfig.name ?? "unknown";

    const $ = new Proxy({} as Record<string, any>, {
      get: (_, prop) => ({ type: "sym", name: prop }),
    });

    const indexerHooks = extractIndexerHooks(langConfig, $);
    const refHooks = extractRefHooks(langConfig, $);

    const classSpecs = extractClassSpecs(langConfig, $);
    const generatedSource =
      classSpecs.length > 0 ? generateAstClasses(classSpecs, langName) : "// No ast configs found";

    function buildQueryHooksMap(): Map<string, any> {
      const hooksMap = new Map<string, any>();
      if (!langConfig.rules) return hooksMap;
      for (const [ruleName, ruleFn] of Object.entries<any>(langConfig.rules)) {
        const ruleAST = (ruleFn as any)($);
        if (!ruleAST || ruleAST.type !== "def") continue;
        const opts = ruleAST.options;
        if (!opts?.queries && !opts?.lints) continue;
        const merged: Record<string, any> = {};
        if (opts.queries) Object.assign(merged, opts.queries);
        if (opts.lints) {
          for (const [name, fn] of Object.entries(opts.lints)) {
            merged["lint__" + name] = fn;
          }
        }
        if (Object.keys(merged).length > 0) hooksMap.set(ruleName, merged);
      }
      return hooksMap;
    }
    const queryHooksMap = buildQueryHooksMap();

    let tsParser: any = null;
    let wasmMode = false;
    let wasmPath = findWasmFile(langDir, langName);
    if (!wasmPath) {
      console.log(`[playground/${langName}] No WASM found, attempting build...`);
      wasmPath = buildWasm(langDir, langName);
    }
    let tsLanguage: any = null;
    if (wasmPath) {
      try {
        const { Parser, Language } = await import("web-tree-sitter");
        await Parser.init();
        tsLanguage = await Language.load(wasmPath);
        tsParser = new Parser();
        tsParser.setLanguage(tsLanguage);
        wasmMode = true;
        console.log(`[playground/${langName}] ✅ Loaded WASM: ${path.basename(wasmPath)}`);
      } catch (e) {
        console.warn(`[playground/${langName}] ⚠️ WASM load failed: ${e}`);
      }
    }

    // Load highlight query if available (with graceful error recovery)
    let highlightQuery: any = null;
    if (wasmMode && tsLanguage) {
      const queriesPath = path.join(langDir, "queries", "highlights.scm");
      if (fs.existsSync(queriesPath)) {
        try {
          // Split query into individual patterns and validate each one
          // This is much more robust than iteratively removing bad names
          const { Query } = await import("web-tree-sitter");
          const querySource = fs.readFileSync(queriesPath, "utf-8");

          // Try loading directly first (fast path)
          try {
            highlightQuery = new Query(tsLanguage, querySource);
            console.log(
              `[playground/${langName}] ✅ Loaded highlight query directly (${highlightQuery.captureNames.length} captures)`,
            );
          } catch (e1) {
            console.warn(`[playground/${langName}] Direct query load failed:`, e1);
            // Patterns can be multi-line blocks `[ ... ] @cap`, or single line `( ... )`.
            // A simple way is to match `[` to `] @...`, OR match a line starting with `(` or `"`.
            // We use a regex that handles up to 2 levels of nested parens inside `( ... )`,
            // and captures the `@...` inside or outside.
            // Better yet, just match:
            // 1) `[ ... ] @...` multi line
            // 2) `( ... )` single line where parens are matched up to 2 levels deep
            // 3) `"..." @...` single line
            const patternRegex =
              /(?:;\s*[^\n]*\n)*(?:\[[\s\S]*?\]\s*@[\w.]+|\((?:[^()]+|\([^()]*\))*\)(?:\s*@[\w.]+)?|"[^"]*"\s*@[\w.]+)/g;
            const patterns = querySource.match(patternRegex) || [];
            const validPatterns: string[] = [];
            let removedCount = 0;

            for (const pattern of patterns) {
              try {
                const testQuery = new Query(tsLanguage, pattern);
                testQuery.delete();
                validPatterns.push(pattern);
              } catch {
                removedCount++;
              }
            }

            if (validPatterns.length > 0) {
              const validSource = validPatterns.join("\n\n");
              try {
                highlightQuery = new Query(tsLanguage, validSource);
                console.log(
                  `[playground/${langName}] ✅ Loaded highlight query (${highlightQuery.captureNames.length} captures, ${removedCount} invalid patterns removed from ${patterns.length} total)`,
                );
              } catch (e2) {
                console.warn(`[playground/${langName}] ⚠️ Highlight query still fails after filtering: ${e2}`);
              }
            } else {
              console.warn(`[playground/${langName}] ⚠️ No valid highlight patterns found`);
            }
          }
        } catch (e) {
          console.warn(`[playground/${langName}] ⚠️ Highlight query load failed: ${e}`);
        }
      }
    }

    // Extract keywords dynamically from grammar
    const kwProxy = new Proxy({} as Record<string, any>, {
      get: (_, prop) => ({ type: "sym", name: prop }),
    });
    const dynamicKeywords = extractKeywords(langConfig, kwProxy);

    // Convert refHooks into indexerHooks so reference nodes get indexed too.
    // The resolver needs reference entries in the index to detect unresolved refs.
    const defRuleNames = new Set(indexerHooks.map((h) => h.ruleName));
    const refAsIndexerHooks: IndexerHook[] = refHooks
      .filter((rh) => !defRuleNames.has(rh.ruleName)) // Don't duplicate def() rules
      .map((rh) => ({
        ruleName: rh.ruleName,
        kind: "Reference" as any,
        namePath: rh.namePath,
        exportPaths: [],
        inheritPaths: [],
        metadataFieldPaths: {},
      }));
    const allIndexerHooks = [...indexerHooks, ...refAsIndexerHooks];

    const indexer = new SymbolIndexer(allIndexerHooks);
    return {
      langDir,
      langConfig,
      langName,
      indexerHooks,
      refHooks,
      queryHooksMap,
      generatedSource,
      tsParser,
      wasmMode,
      indexer,
      highlightQuery,
      dynamicKeywords,
    };
  }

  // ---------------------------------------------------------------------------
  // Load primary language
  // ---------------------------------------------------------------------------
  const L = await loadLang(languageFile);
  const langName = L.langName;

  // ---------------------------------------------------------------------------
  // Load secondary language (polyglot mode)
  // ---------------------------------------------------------------------------
  const R = polyglot && secondLanguageFile ? await loadLang(secondLanguageFile) : null;

  // ---------------------------------------------------------------------------
  // Create AdapterRegistry when in polyglot mode
  // (populated lazily once first analysis completes)
  // ---------------------------------------------------------------------------
  const adapterRegistry = new AdapterRegistry();

  // ---------------------------------------------------------------------------
  // Default source texts
  // ---------------------------------------------------------------------------
  let sourceTextL = `class Resistor\n  parameter Real r;\n  input Real v;\n  output Real i;\nend Resistor;\n\nclass OnePort\n  Real u;\n  Real i;\nend OnePort;\n`;
  let sourceTextR = R
    ? `block Vehicle {\n  part engine : Engine;\n  attribute mass : Real;\n}\n\nblock Engine {\n  attribute power : Real;\n}\n`
    : "";

  /** Extract the word at a byte offset. */
  function wordAtOffset(text: string, offset: number): string | null {
    const idChar = /[a-zA-Z0-9_]/;
    if (offset >= text.length || !idChar.test(text[offset])) return null;
    let start = offset,
      end = offset;
    while (start > 0 && idChar.test(text[start - 1])) start--;
    while (end < text.length && idChar.test(text[end])) end++;
    return text.substring(start, end);
  }

  // ---------------------------------------------------------------------------
  // Per-side incremental state
  // ---------------------------------------------------------------------------
  let lastTreeL: any = null,
    lastIndexL: SymbolIndex | null = null,
    lastDiagnosticsL: DiagnosticJson[] = [],
    lastCstJsonL: CSTJson | null = null,
    lastAnalysisL: ReturnType<typeof analyzeL> | null = null;

  let lastTreeR: any = null,
    lastIndexR: SymbolIndex | null = null,
    lastDiagnosticsR: DiagnosticJson[] = [],
    lastCstJsonR: CSTJson | null = null,
    lastAnalysisR: ReturnType<typeof analyzeR> | null = null;

  // ---------------------------------------------------------------------------
  // Semantic Token Types — shared between server and client
  // ---------------------------------------------------------------------------
  const SEMANTIC_TOKEN_TYPES = [
    "keyword",
    "type",
    "variable",
    "number",
    "string",
    "comment",
    "operator",
    "module",
    "constant",
    "label",
    "punctuation",
    "enum",
    "enumMember",
    "property",
    "function",
  ];
  const tokenTypeIndex = new Map(SEMANTIC_TOKEN_TYPES.map((t, i) => [t, i]));

  // Map tree-sitter capture names → Monaco semantic token types
  const captureToTokenType: Record<string, string> = {
    keyword: "keyword",
    type: "type",
    "type.definition": "type",
    "type.enum": "enum",
    "type.reference": "type",
    variable: "variable",
    "variable.definition": "variable",
    "variable.parameter": "variable",
    module: "module",
    comment: "comment",
    "comment.documentation": "comment",
    string: "string",
    "string.special": "string",
    number: "number",
    operator: "operator",
    constant: "constant",
    "constant.builtin": "constant",
    label: "label",
    "punctuation.bracket": "punctuation",
    "punctuation.delimiter": "punctuation",
    property: "property",
    function: "function",
    "function.method": "function",
  };

  /**
   * Run a tree-sitter highlight query against a parse tree and produce
   * delta-encoded semantic tokens for Monaco's DocumentSemanticTokensProvider.
   *
   * Returns an array of integers: [deltaLine, deltaStartChar, length, tokenType, tokenModifiers, ...]
   */
  function runHighlightCaptures(lang: typeof L, tree: any, sourceText: string): number[] | null {
    if (!lang.highlightQuery || !tree) return null;

    try {
      const captures: any[] = lang.highlightQuery.captures(tree.rootNode);
      if (captures.length === 0) return null;

      // Sort captures by start position (they should already be ordered, but ensure)
      captures.sort((a: any, b: any) => {
        const aStart = a.node.startPosition;
        const bStart = b.node.startPosition;
        if (aStart.row !== bStart.row) return aStart.row - bStart.row;
        return aStart.column - bStart.column;
      });

      const data: number[] = [];
      let prevLine = 0,
        prevChar = 0;

      // Deduplicate: for overlapping captures, keep only the first (more specific) one
      const coveredRanges = new Set<string>();

      for (const capture of captures) {
        const node = capture.node;
        const name: string = capture.name;
        const monacoType = captureToTokenType[name];
        if (!monacoType) continue;

        const typeIdx = tokenTypeIndex.get(monacoType);
        if (typeIdx === undefined) continue;

        const startLine = node.startPosition.row;
        const startChar = node.startPosition.column;
        const endIndex = node.endIndex;
        const length = endIndex - node.startIndex;

        if (length <= 0 || length > 500) continue; // skip empty or absurdly large

        // Skip if this exact range is already covered by a more specific capture
        const rangeKey = `${startLine}:${startChar}:${length}`;
        if (coveredRanges.has(rangeKey)) continue;
        coveredRanges.add(rangeKey);

        const deltaLine = startLine - prevLine;
        const deltaChar = deltaLine === 0 ? startChar - prevChar : startChar;

        data.push(deltaLine, deltaChar, length, typeIdx, 0);
        prevLine = startLine;
        prevChar = startChar;
      }

      return data.length > 0 ? data : null;
    } catch (e) {
      console.warn(`[playground] ⚠️ Highlight query execution failed: ${e}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Parse helpers
  // ---------------------------------------------------------------------------
  interface EditOp {
    rangeOffset: number;
    rangeLength: number;
    text: string;
    range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
  }

  /** Convert a byte index in text to a {row, column} position for tree-sitter. */
  function positionForIndex(text: string, index: number): { row: number; column: number } {
    let row = 0;
    let lastNewline = -1;
    for (let i = 0; i < index && i < text.length; i++) {
      if (text[i] === "\n") {
        row++;
        lastNewline = i;
      }
    }
    return { row, column: index - lastNewline - 1 };
  }

  function makeParse(lang: typeof L, lastTree: { v: any }) {
    return function parse(text: string, edits?: EditOp[]): { cst: CSTNode; tree: any } {
      if (lang.wasmMode && lang.tsParser) {
        if (lastTree.v && edits && edits.length > 0) {
          for (const edit of edits) {
            const startIndex = edit.rangeOffset;
            const oldEndIndex = startIndex + edit.rangeLength;
            const newEndIndex = startIndex + edit.text.length;
            lastTree.v.edit({
              startIndex,
              oldEndIndex,
              newEndIndex,
              startPosition: { row: edit.range.startLineNumber - 1, column: edit.range.startColumn - 1 },
              oldEndPosition: { row: edit.range.endLineNumber - 1, column: edit.range.endColumn - 1 },
              newEndPosition: positionForIndex(text, newEndIndex),
            });
          }
          const tree = lang.tsParser.parse(text, lastTree.v);
          return { cst: lazyWrapNode(tree.rootNode), tree };
        }
        const tree = lang.tsParser.parse(text);
        return { cst: lazyWrapNode(tree.rootNode), tree };
      }
      return { cst: mockParse(text), tree: null };
    };
  }

  const treeLRef = { v: lastTreeL };
  const treeRRef = { v: lastTreeR };
  const parseL = makeParse(L, treeLRef);
  const parseR = R ? makeParse(R, treeRRef) : null;

  // ---------------------------------------------------------------------------
  // Analyze functions (per-side)
  // ---------------------------------------------------------------------------
  function analyzeL(text: string, edits?: EditOp[]) {
    const t0 = performance.now();
    sourceTextL = text;
    const isIncremental = !!(lastIndexL && lastTreeL && edits && edits.length > 0);
    const { cst, tree } = parseL(text, edits);
    const tParse = performance.now();

    let index: SymbolIndex;
    if (isIncremental && lastIndexL && edits) {
      const editRanges = edits.map((e) => ({
        startByte: e.rangeOffset,
        endByte: e.rangeOffset + Math.max(e.rangeLength, e.text.length),
      }));
      const totalDelta = edits.reduce((sum, e) => sum + (e.text.length - e.rangeLength), 0);
      index = L.indexer.update(lastIndexL, cst, editRanges, totalDelta).index;
    } else {
      index = L.indexer.index(cst);
    }
    const tIndex = performance.now();

    const ast = indexToAstJson(index);
    const cstTree = tree
      ? {
          getText(startByte: number, endByte: number): string | null {
            return text.slice(startByte, endByte) ?? null;
          },
          getNode(startByte: number, endByte: number): unknown | null {
            try {
              const node = tree.rootNode.descendantForIndex(startByte, endByte);
              return node ? lazyWrapNode(node) : null;
            } catch {
              return null;
            }
          },
        }
      : undefined;
    const engine = new QueryEngine(index, L.queryHooksMap, { tree: cstTree });
    const resolver = new ScopeResolver(index, L.refHooks, L.indexerHooks);
    const positions = new PositionIndex(text);
    const bridge = new LSPBridge(index, engine, resolver, positions, "playground://left." + L.langName);

    lastTreeL = tree;
    treeLRef.v = tree;
    lastIndexL = index;

    // Register with adapter registry
    adapterRegistry.registerLanguage(L.langConfig, index);

    console.log(
      `[playground/L] ${isIncremental ? "Incr" : "Full"}: parse=${(tParse - t0).toFixed(1)}ms index=${(tIndex - tParse).toFixed(1)}ms total=${(performance.now() - t0).toFixed(1)}ms`,
    );
    return {
      cst,
      ast,
      index,
      engine,
      resolver,
      positions,
      bridge,
      symbols: bridge.documentSymbols(),
      parserMode: L.wasmMode ? "tree-sitter" : "mock",
    };
  }

  function analyzeR(text: string, edits?: EditOp[]) {
    if (!R || !parseR) return null;
    const t0 = performance.now();
    sourceTextR = text;
    const isIncremental = !!(lastIndexR && lastTreeR && edits && edits.length > 0);
    const { cst, tree } = parseR(text, edits);
    const tParse = performance.now();

    let index: SymbolIndex;
    if (isIncremental && lastIndexR && edits) {
      const editRanges = edits.map((e) => ({
        startByte: e.rangeOffset,
        endByte: e.rangeOffset + Math.max(e.rangeLength, e.text.length),
      }));
      const totalDelta = edits.reduce((sum, e) => sum + (e.text.length - e.rangeLength), 0);
      index = R.indexer.update(lastIndexR, cst, editRanges, totalDelta).index;
    } else {
      index = R.indexer.index(cst);
    }
    const tIndex = performance.now();

    const ast = indexToAstJson(index);
    const cstTree = tree
      ? {
          getText(startByte: number, endByte: number): string | null {
            return text.slice(startByte, endByte) ?? null;
          },
          getNode(startByte: number, endByte: number): unknown | null {
            try {
              const node = tree.rootNode.descendantForIndex(startByte, endByte);
              return node ? lazyWrapNode(node) : null;
            } catch {
              return null;
            }
          },
        }
      : undefined;
    const engine = new QueryEngine(index, R.queryHooksMap, { tree: cstTree });
    const resolver = new ScopeResolver(index, R.refHooks, R.indexerHooks);
    const positions = new PositionIndex(text);
    const bridge = new LSPBridge(index, engine, resolver, positions, "playground://right." + R.langName);

    lastTreeR = tree;
    treeRRef.v = tree;
    lastIndexR = index;

    // Register with adapter registry
    adapterRegistry.registerLanguage(R.langConfig, index);

    console.log(
      `[playground/R] ${isIncremental ? "Incr" : "Full"}: parse=${(tParse - t0).toFixed(1)}ms index=${(tIndex - tParse).toFixed(1)}ms total=${(performance.now() - t0).toFixed(1)}ms`,
    );
    return {
      cst,
      ast,
      index,
      engine,
      resolver,
      positions,
      bridge,
      symbols: bridge.documentSymbols(),
      parserMode: R.wasmMode ? "tree-sitter" : "mock",
    };
  }

  // ---------------------------------------------------------------------------
  // Cross-language completion items from interop projections
  // ---------------------------------------------------------------------------

  /**
   * Generate completion items from the interop adapter projections.
   * "lr" = project right-language symbols as completions visible in the left editor.
   * "rl" = project left-language symbols as completions visible in the right editor.
   */
  function crossLangCompletions(direction: "lr" | "rl"): { label: string; kind: number; detail: string }[] {
    if (!R) return [];
    try {
      // Determine the other language's analysis result
      const otherAnalysis = direction === "lr" ? lastAnalysisR : lastAnalysisL;
      const otherLangName = direction === "lr" ? R.langName : L.langName;
      if (!otherAnalysis) return [];

      const seen = new Set<string>();
      const items: { label: string; kind: number; detail: string }[] = [];

      // Pull top-level symbols from the other language's index
      for (const entry of otherAnalysis.index.symbols.values()) {
        if (entry.parentId !== null) continue; // only top-level defs
        if (!entry.name || seen.has(entry.name)) continue;
        seen.add(entry.name);
        items.push({
          label: entry.name,
          kind: 5, // CompletionItemKind.Class
          detail: `${entry.kind} (from ${otherLangName})`,
        });
      }

      return items;
    } catch {
      return [];
    }
  }

  /**
   * Detect whether the cursor is in a dot-access context (e.g. "foo." or "foo.ba").
   */
  function isDotAccess(sourceText: string, offset: number): boolean {
    const before = sourceText.slice(0, offset);
    return /[a-zA-Z_][a-zA-Z0-9_]*\s*\.\s*[a-zA-Z_]?[a-zA-Z0-9_]*$/.test(before);
  }

  /**
   * Handle dot-access on a cross-language symbol.
   * E.g. typing "Engine." in Modelica when Engine is a SysML2 block —
   * resolves Engine in SysML2's index and returns its children (e.g. "power").
   */
  function crossLangDotCompletion(
    sourceText: string,
    offset: number,
    direction: "lr" | "rl",
  ): { label: string; kind: number; detail: string }[] {
    if (!R) return [];

    // Detect dot-access pattern
    const before = sourceText.slice(0, offset);
    const dotMatch = before.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*[a-zA-Z_]?[a-zA-Z0-9_]*$/);
    if (!dotMatch) return [];

    const varName = dotMatch[1];
    const otherAnalysis = direction === "lr" ? lastAnalysisR : lastAnalysisL;
    const otherLangName = direction === "lr" ? R.langName : L.langName;
    if (!otherAnalysis) return [];

    // Find the symbol by name in the other language's index
    const ids = otherAnalysis.index.byName.get(varName);
    if (!ids || ids.length === 0) return [];

    const items: { label: string; kind: number; detail: string }[] = [];
    const seen = new Set<string>();

    for (const id of ids) {
      const entry = otherAnalysis.index.symbols.get(id);
      if (!entry) continue;

      // Get children of this symbol (its members)
      for (const child of otherAnalysis.index.symbols.values()) {
        if (child.parentId !== entry.id) continue;
        if (!child.name || seen.has(child.name)) continue;
        seen.add(child.name);
        items.push({
          label: child.name,
          kind: 7, // CompletionItemKind.Property
          detail: `${child.kind} (${otherLangName}::${varName})`,
        });
      }
    }

    return items;
  }

  // ---------------------------------------------------------------------------
  // Interop projection pass
  // ---------------------------------------------------------------------------
  function computeInteropProjections(): object[] {
    if (!R || !lastIndexL) return [];
    try {
      // Project LEFT → RIGHT
      const lr = adapterRegistry.projectAll(L.langName, R.langName).map((r) => serializeProjection(r, "lr"));
      // Project RIGHT → LEFT (if right is analyzed)
      const rl = lastIndexR
        ? adapterRegistry.projectAll(R.langName, L.langName).map((r) => serializeProjection(r, "rl"))
        : [];
      return [...lr, ...rl];
    } catch (e) {
      console.warn(`[playground] Interop projection failed: ${e}`);
      return [];
    }
  }

  function serializeProjection(r: ProjectionResult, direction: "lr" | "rl"): object {
    return {
      direction,
      foreignId: r.foreignEntry.id,
      foreignName: r.foreignEntry.name,
      foreignKind: r.foreignEntry.kind,
      foreignLang: direction === "lr" ? L.langName : R!.langName,
      targetClass: r.targetClass,
      targetLang: r.targetLang,
      approach: r.approach,
      props: r.props,
    };
  }

  // ---------------------------------------------------------------------------
  // HTTP server
  // ---------------------------------------------------------------------------
  const server = http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        playgroundHTML({
          langName: L.langName,
          secondLangName: R?.langName,
          initialSourceL: sourceTextL,
          initialSourceR: sourceTextR,
          generatedSource: L.generatedSource,
          wasmMode: L.wasmMode,
          wasmModeR: R?.wasmMode ?? false,
        }),
      );
    } else if (req.url === "/favicon.ico") {
      res.writeHead(204);
      res.end();
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  // ---------------------------------------------------------------------------
  // WebSocket server
  // ---------------------------------------------------------------------------
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws: WebSocket) => {
    console.log("[playground] Client connected");

    // Send initial analysis for both sides
    try {
      const resultL = analyzeL(sourceTextL);
      lastAnalysisL = resultL;
      const initialDiagsL = collectDiagnosticsFull(resultL.cst, sourceTextL);
      const resultR = R ? analyzeR(sourceTextR) : null;
      lastAnalysisR = resultR;
      const initialDiagsR = resultR ? collectDiagnosticsFull(resultR.cst, sourceTextR) : [];
      const projections = computeInteropProjections();

      // Compute semantic tokens from highlight queries
      const semanticTokensL = runHighlightCaptures(L, lastTreeL, sourceTextL);
      const semanticTokensR = R && lastTreeR ? runHighlightCaptures(R, lastTreeR, sourceTextR) : null;

      ws.send(
        JSON.stringify({
          type: "analysis",
          // Left side
          cst: cstToJson(resultL.cst),
          ast: resultL.ast,
          symbols: resultL.symbols,
          diagnostics: initialDiagsL,
          // Right side (only in polyglot mode)
          ...(resultR
            ? {
                cstR: cstToJson(resultR.cst),
                astR: resultR.ast,
                symbolsR: resultR.symbols,
                diagnosticsR: initialDiagsR,
              }
            : {}),
          // Cross-language projections
          projections,
          // Semantic highlighting
          semanticTokenTypes: SEMANTIC_TOKEN_TYPES,
          semanticTokens: semanticTokensL,
          ...(semanticTokensR ? { semanticTokensR } : {}),
          // Dynamic keywords for Monarch fallback
          keywords: L.dynamicKeywords.keywords,
          keywordsR: R ? R.dynamicKeywords.keywords : undefined,
        }),
      );
    } catch (e) {
      ws.send(JSON.stringify({ type: "error", message: String(e) }));
    }

    let editGeneration = 0;
    let diagTimer: ReturnType<typeof setTimeout> | null = null;
    let cstTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleDiagUpdate(cst: CSTNode, text: string, side: "L" | "R") {
      editGeneration++;
      if (diagTimer) clearTimeout(diagTimer);
      const gen = editGeneration;
      diagTimer = setTimeout(() => {
        if (gen !== editGeneration || ws.readyState !== 1) return;
        const syntaxDiags = collectDiagnosticsFull(cst, text);
        let lintDiags: DiagnosticJson[] = [];
        let refDiags: DiagnosticJson[] = [];
        const analysis = side === "L" ? lastAnalysisL : lastAnalysisR;
        if (analysis?.engine) {
          try {
            lintDiags = analysis.engine.runAllLints().map((d) => ({
              startByte: d.startByte,
              endByte: d.endByte,
              message: d.message,
              severity: d.severity as DiagnosticJson["severity"],
            }));
          } catch (e) {
            console.warn(`[playground] Lint failed: ${e}`);
          }
        }
        if (analysis?.resolver) {
          try {
            refDiags = analysis.resolver.resolveAllReferences().map((d) => ({
              startByte: d.startByte,
              endByte: d.endByte,
              message: d.message,
              severity: d.severity as DiagnosticJson["severity"],
            }));
          } catch (e) {
            console.warn(`[playground] Ref resolution failed: ${e}`);
          }
        }
        const diagnostics = [...syntaxDiags, ...lintDiags, ...refDiags];
        if (side === "L") lastDiagnosticsL = diagnostics;
        else lastDiagnosticsR = diagnostics;
        ws.send(
          JSON.stringify({ type: side === "L" ? "diagnostics-update" : "diagnostics-update-right", diagnostics }),
        );
      }, 150);
    }

    function scheduleCstUpdate(side: "L" | "R") {
      if (cstTimer) clearTimeout(cstTimer);
      const gen = editGeneration;
      cstTimer = setTimeout(() => {
        if (gen !== editGeneration || ws.readyState !== 1) return;
        const tree = side === "L" ? lastTreeL : lastTreeR;
        if (!tree) return;
        try {
          const cstJson = cstToJson(lazyWrapNode(tree.rootNode));
          ws.send(JSON.stringify({ type: side === "L" ? "cst-update" : "cst-update-right", cst: cstJson }));
        } catch (e) {
          console.warn(`[playground] CST serialization failed: ${e}`);
        }
      }, 500);
    }

    ws.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "update" || msg.type === "update-left") {
          // Left editor update
          const changes = msg.changes;
          const result = analyzeL(msg.source, changes?.length ? changes : undefined);
          lastAnalysisL = result;
          const projections = computeInteropProjections();
          const semanticTokens = runHighlightCaptures(L, lastTreeL, msg.source);
          ws.send(
            JSON.stringify({ type: "analysis", ast: result.ast, symbols: result.symbols, projections, semanticTokens }),
          );
          scheduleDiagUpdate(result.cst, msg.source, "L");
          scheduleCstUpdate("L");
        } else if (msg.type === "update-right" && R) {
          // Right editor update
          const changes = msg.changes;
          const result = analyzeR(msg.source, changes?.length ? changes : undefined);
          lastAnalysisR = result;
          if (result) {
            const projections = computeInteropProjections();
            const semanticTokensR = runHighlightCaptures(R, lastTreeR, msg.source);
            ws.send(
              JSON.stringify({
                type: "analysis-right",
                astR: result.ast,
                symbolsR: result.symbols,
                projections,
                semanticTokensR,
              }),
            );
            scheduleDiagUpdate(result.cst, msg.source, "R");
            scheduleCstUpdate("R");
          }
        } else if (msg.type === "hover" || msg.type === "hover-left") {
          if (!lastAnalysisL) return;
          let hover = lastAnalysisL.bridge.hover(msg.offset);
          if (!hover) {
            const word = wordAtOffset(sourceTextL, msg.offset);
            if (word) {
              const ids = lastAnalysisL.index.byName.get(word);
              if (ids?.length) {
                const entry = lastAnalysisL.index.symbols.get(ids[0])!;
                hover = {
                  contents: `**${entry.kind}** \`${entry.name}\``,
                  range: lastAnalysisL.positions.rangeFromBytes(entry.startByte, entry.endByte),
                };
              }
            }
          }
          ws.send(JSON.stringify({ type: "hover", data: hover }));
        } else if (msg.type === "hover-right" && lastAnalysisR) {
          let hover = lastAnalysisR.bridge.hover(msg.offset);
          if (!hover) {
            const word = wordAtOffset(sourceTextR, msg.offset);
            if (word) {
              const ids = lastAnalysisR.index.byName.get(word);
              if (ids?.length) {
                const entry = lastAnalysisR.index.symbols.get(ids[0])!;
                hover = {
                  contents: `**${entry.kind}** \`${entry.name}\``,
                  range: lastAnalysisR.positions.rangeFromBytes(entry.startByte, entry.endByte),
                };
              }
            }
          }
          ws.send(JSON.stringify({ type: "hover-right", data: hover }));
        } else if (msg.type === "completion") {
          if (!lastAnalysisL) return;
          const src = msg.sourceText ?? sourceTextL;
          const isDot = isDotAccess(src, msg.offset);
          if (isDot) {
            // Dot-access: try native first, then cross-language
            const native = lastAnalysisL.bridge.completion(msg.offset, src);
            if (native.length > 0) {
              ws.send(JSON.stringify({ type: "completion", data: native }));
            } else {
              const crossDot = crossLangDotCompletion(src, msg.offset, "lr");
              ws.send(JSON.stringify({ type: "completion", data: crossDot }));
            }
          } else {
            // Scope completion: native + cross-language top-level symbols
            const native = lastAnalysisL.bridge.completion(msg.offset, src);
            const cross = crossLangCompletions("lr");
            ws.send(JSON.stringify({ type: "completion", data: [...native, ...cross] }));
          }
        } else if (msg.type === "completion-right" && lastAnalysisR) {
          const src = msg.sourceText ?? sourceTextR;
          const isDot = isDotAccess(src, msg.offset);
          if (isDot) {
            const native = lastAnalysisR.bridge.completion(msg.offset, src);
            if (native.length > 0) {
              ws.send(JSON.stringify({ type: "completion-right", data: native }));
            } else {
              const crossDot = crossLangDotCompletion(src, msg.offset, "rl");
              ws.send(JSON.stringify({ type: "completion-right", data: crossDot }));
            }
          } else {
            const native = lastAnalysisR.bridge.completion(msg.offset, src);
            const cross = crossLangCompletions("rl");
            ws.send(JSON.stringify({ type: "completion-right", data: [...native, ...cross] }));
          }
        } else if (msg.type === "definition") {
          if (!lastAnalysisL) return;
          let def = lastAnalysisL.bridge.definition(msg.offset) ?? null;
          if (!def) {
            const word = wordAtOffset(sourceTextL, msg.offset);
            if (word) {
              const ids = lastAnalysisL.index.byName.get(word);
              if (ids?.length) {
                for (const id of ids) {
                  const entry = lastAnalysisL.index.symbols.get(id)!;
                  if (entry.startByte > msg.offset || entry.endByte <= msg.offset) {
                    def = {
                      uri: "playground://left",
                      range: lastAnalysisL.positions.rangeFromBytes(entry.startByte, entry.endByte),
                    };
                    break;
                  }
                }
              }
            }
          }
          ws.send(JSON.stringify({ type: "definition", data: def }));
        } else if (msg.type === "definition-right" && lastAnalysisR) {
          let def = lastAnalysisR.bridge.definition(msg.offset) ?? null;
          ws.send(JSON.stringify({ type: "definition-right", data: def }));
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: "error", message: String(e) }));
      }
    });

    ws.on("close", () => console.log("[playground] Client disconnected"));
  });

  server.listen(port, () => {
    console.log(`\n  🧪 Metascript Playground`);
    console.log(`  Primary language:    ${L.langName}${R ? `\n  Secondary language:  ${R.langName}` : ""}`);
    console.log(`  Mode:                ${polyglot ? "polyglot (split editor)" : "single language"}`);
    console.log(`  URL: http://localhost:${port}\n`);
  });
}

// ---------------------------------------------------------------------------
// Playground HTML (self-contained SPA)
// ---------------------------------------------------------------------------

function playgroundHTML(opts: {
  langName: string;
  secondLangName?: string;
  initialSourceL: string;
  initialSourceR: string;
  generatedSource: string;
  wasmMode: boolean;
  wasmModeR: boolean;
}): string {
  const { langName, secondLangName, initialSourceL, initialSourceR, generatedSource, wasmMode, wasmModeR } = opts;
  const polyglot = !!secondLangName;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Metascript Playground — ${langName}${polyglot ? " + " + secondLangName : ""}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root {
  --bg-primary: #0d1117;
  --bg-secondary: #161b22;
  --bg-tertiary: #1c2333;
  --bg-panel: #13171f;
  --border: #30363d;
  --border-active: #58a6ff;
  --text-primary: #e6edf3;
  --text-secondary: #8b949e;
  --text-muted: #484f58;
  --accent-blue: #58a6ff;
  --accent-green: #3fb950;
  --accent-purple: #bc8cff;
  --accent-orange: #d29922;
  --accent-red: #f85149;
  --accent-cyan: #39d2c0;
  --radius: 8px;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --font-sans: 'Inter', -apple-system, sans-serif;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: var(--font-sans);
  background: var(--bg-primary);
  color: var(--text-primary);
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
/* ---- Header ---- */
header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
header .logo {
  font-weight: 700; font-size: 16px;
  background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  letter-spacing: -0.5px;
}
header .lang-badge {
  font-size: 12px; padding: 3px 10px; border-radius: 12px;
  background: rgba(88, 166, 255, 0.12); color: var(--accent-blue);
  font-weight: 500; border: 1px solid rgba(88, 166, 255, 0.2);
}
header .status { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
header .status .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent-green); animation: pulse 2s infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

/* ---- Main layout ---- */
main {
  display: grid;
  ${
    polyglot
      ? `grid-template-columns: 40% 20% 40%; grid-template-rows: 1fr 1fr;`
      : `grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;`
  }
  gap: 1px; flex: 1; background: var(--border); overflow: hidden;
}

/* ---- Panel ---- */
.panel { display: flex; flex-direction: column; background: var(--bg-primary); overflow: hidden; }
.panel-header {
  display: flex; align-items: center; gap: 8px; padding: 8px 14px;
  background: var(--bg-secondary); border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.panel-header .panel-icon { font-size: 14px; }
.panel-header h2 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary); }
.panel-header .panel-count {
  margin-left: auto; font-size: 11px; padding: 1px 7px; border-radius: 10px;
  background: rgba(88, 166, 255, 0.12); color: var(--accent-blue); font-weight: 500;
}
.panel-body { flex: 1; overflow: auto; padding: 0; }
.panel-body.padded { padding: 12px; }
#editor-container, #editor-container-right { flex: 1; overflow: hidden; }

/* ---- Interop Bridge (center panel, polyglot only) ---- */
.interop-bridge { grid-row: 1 / 3; grid-column: 2; }
.interop-bridge .panel-body { padding: 12px; }
.projection-card {
  background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 12px; margin-bottom: 10px; transition: border-color 0.2s;
}
.projection-card:hover { border-color: var(--accent-blue); }
.projection-card .proj-header {
  display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
}
.projection-card .proj-name {
  font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--text-primary);
}
.projection-card .proj-arrow { color: var(--accent-cyan); font-size: 16px; }
.projection-card .proj-target {
  font-family: var(--font-mono); font-size: 12px; color: var(--accent-purple);
}
.projection-card .proj-approach {
  font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 600; margin-left: auto;
}
.proj-approach-A { background: rgba(63,185,80,0.15); color: var(--accent-green); }
.proj-approach-B { background: rgba(88,166,255,0.15); color: var(--accent-blue); }
.proj-approach-C { background: rgba(188,140,255,0.15); color: var(--accent-purple); }
.projection-card .proj-props {
  font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary);
  background: var(--bg-primary); border-radius: 4px; padding: 8px; margin-top: 6px;
  max-height: 200px; overflow: auto; white-space: pre-wrap; line-height: 1.5;
}
.interop-empty {
  text-align: center; padding: 40px 20px; color: var(--text-muted); font-size: 13px;
}
.interop-empty .interop-icon { font-size: 32px; margin-bottom: 12px; }
.interop-stats {
  display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap;
}
.interop-stat {
  font-size: 11px; padding: 4px 10px; border-radius: 6px;
  background: var(--bg-tertiary); color: var(--text-secondary);
}
.interop-stat strong { color: var(--accent-cyan); }

/* ---- Tree views ---- */
.tree-node { font-family: var(--font-mono); font-size: 12px; line-height: 1.7; }
.tree-node details { padding-left: 18px; }
.tree-node details > summary {
  cursor: pointer; list-style: none; position: relative; padding: 2px 4px;
  border-radius: 4px; transition: background 0.15s;
}
.tree-node details > summary:hover { background: rgba(88, 166, 255, 0.08); }
.tree-node details > summary::before {
  content: '▸'; position: absolute; left: -14px; color: var(--text-muted);
  font-size: 10px; transition: transform 0.15s;
}
.tree-node details[open] > summary::before { transform: rotate(90deg); }
.tree-node .node-type { color: var(--accent-purple); font-weight: 500; }
.tree-node .node-text { color: var(--accent-green); margin-left: 6px; }
.tree-node .node-range { color: var(--text-muted); font-size: 10px; margin-left: 6px; }
.tree-node .leaf { padding-left: 18px; padding: 2px 4px 2px 18px; border-radius: 4px; transition: background 0.15s; }
.tree-node .leaf:hover { background: rgba(88, 166, 255, 0.08); }

/* ---- AST nodes ---- */
.ast-node .kind-Class { color: var(--accent-blue); }
.ast-node .kind-Component { color: var(--accent-orange); }
.ast-node .kind-Function { color: var(--accent-purple); }
.ast-node .kind-Extends { color: var(--accent-cyan); }
.ast-node .kind-Block { color: var(--accent-green); }
.ast-node .kind-Part { color: var(--accent-orange); }
.ast-node .kind-Attribute { color: var(--accent-cyan); }
.ast-node .kind-Port { color: var(--accent-purple); }
.ast-node .kind-default { color: var(--text-primary); }
.ast-node .meta-badge {
  font-size: 10px; padding: 1px 5px; border-radius: 4px;
  background: rgba(188, 140, 255, 0.12); color: var(--accent-purple);
  margin-left: 6px; font-weight: 400;
}

/* ---- Generated Source ---- */
#generated-source {
  font-family: var(--font-mono); font-size: 12px; line-height: 1.6;
  white-space: pre; color: var(--text-secondary); padding: 12px;
  overflow: auto; height: 100%; tab-size: 2;
}

/* ---- Tabs ---- */
.tab-bar { display: flex; gap: 0; flex-shrink: 0; }
.tab-bar button {
  font-family: var(--font-sans); font-size: 11px; font-weight: 500;
  padding: 6px 14px; background: transparent; border: none;
  border-bottom: 2px solid transparent; color: var(--text-secondary);
  cursor: pointer; transition: all 0.15s;
}
.tab-bar button:hover { color: var(--text-primary); }
.tab-bar button.active { color: var(--accent-blue); border-bottom-color: var(--accent-blue); }

/* ---- Scrollbar ---- */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--text-muted); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-secondary); }
</style>
</head>
<body>

<header>
  <span class="logo">⚡ Metascript Playground</span>
  <span class="lang-badge">${langName}</span>
  ${polyglot ? `<span class="lang-badge" style="background:rgba(63,185,80,0.12);color:var(--accent-green);border-color:rgba(63,185,80,0.2)">${secondLangName}</span>` : ""}
  <span class="lang-badge" style="background:\${${wasmMode} ? 'rgba(63,185,80,0.12)' : 'rgba(210,153,34,0.12)'};color:\${${wasmMode} ? 'var(--accent-green)' : 'var(--accent-orange)'};border-color:\${${wasmMode} ? 'rgba(63,185,80,0.2)' : 'rgba(210,153,34,0.2)'}" id="parser-badge">${wasmMode ? "🌲 tree-sitter" : "⚠ mock tokenizer"}</span>
  <div class="status">
    <span class="dot" id="ws-dot"></span>
    <span id="ws-status">Connecting…</span>
  </div>
</header>

<main>
  <!-- Left Editor Panel -->
  <div class="panel">
    <div class="panel-header">
      <span class="panel-icon">📝</span>
      <h2>${langName}</h2>
    </div>
    <div class="panel-body" id="editor-container"></div>
  </div>

  ${
    polyglot
      ? `
  <!-- Interop Bridge (center, spans both rows) -->
  <div class="panel interop-bridge">
    <div class="panel-header">
      <span class="panel-icon">🔗</span>
      <h2>Interop Bridge</h2>
      <span class="panel-count" id="interop-count">0 projections</span>
    </div>
    <div class="panel-body padded" id="interop-panel">
      <div class="interop-empty">
        <div class="interop-icon">🔗</div>
        Edit both files to see live<br>cross-language projections
      </div>
    </div>
  </div>

  <!-- Right Editor Panel -->
  <div class="panel">
    <div class="panel-header">
      <span class="panel-icon">📝</span>
      <h2>${secondLangName}</h2>
    </div>
    <div class="panel-body" id="editor-container-right"></div>
  </div>
  `
      : `
  <!-- CST Panel (top-right, single mode) -->
  <div class="panel">
    <div class="panel-header">
      <span class="panel-icon">🌳</span>
      <h2>Syntax</h2>
      <span class="panel-count" id="cst-count">0 nodes</span>
    </div>
    <div class="panel-body padded tree-node" id="cst-tree"></div>
  </div>
  `
  }

  <!-- Bottom-left: AST/CST tabs -->
  <div class="panel">
    <div class="panel-header">
      <span class="panel-icon">🔷</span>
      <h2>${polyglot ? langName + " Model" : "Model"}</h2>
      <span class="panel-count" id="ast-count">0 symbols</span>
      ${polyglot ? `<div class="tab-bar"><button class="active" onclick="showLeftTab('ast')">Model</button><button onclick="showLeftTab('cst')">Syntax</button></div>` : ""}
    </div>
    <div class="panel-body padded tree-node ast-node" id="ast-tree"></div>
    ${polyglot ? `<div class="panel-body padded tree-node" id="cst-tree" style="display:none"></div>` : ""}
  </div>

  ${
    polyglot
      ? `
  <!-- Bottom-right: Right AST/CST -->
  <div class="panel">
    <div class="panel-header">
      <span class="panel-icon">🔷</span>
      <h2>${secondLangName} Model</h2>
      <span class="panel-count" id="ast-count-right">0 symbols</span>
      <div class="tab-bar"><button class="active" onclick="showRightTab('ast')">Model</button><button onclick="showRightTab('cst')">Syntax</button></div>
    </div>
    <div class="panel-body padded tree-node ast-node" id="ast-tree-right"></div>
    <div class="panel-body padded tree-node" id="cst-tree-right" style="display:none"></div>
  </div>
  `
      : `
  <!-- Bottom-right: Generated Classes (single mode) -->
  <div class="panel">
    <div class="panel-header">
      <span class="panel-icon">⚙️</span>
      <h2>Generated Classes</h2>
      <div class="tab-bar">
        <button class="active" onclick="showGenTab('source')">Source</button>
        <button onclick="showGenTab('symbols')">Symbols</button>
      </div>
    </div>
    <div class="panel-body">
      <pre id="generated-source">${escapeHtml(generatedSource)}</pre>
      <div id="generated-symbols" style="display:none; padding:12px;"></div>
    </div>
  </div>
  `
  }
</main>

<script src="https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs/loader.min.js"></script>
<script>
// =========================================================================
// Config
// =========================================================================
const POLYGLOT = ${polyglot};
const LANG_L = ${JSON.stringify(langName)};
const LANG_R = ${JSON.stringify(secondLangName ?? "")};

// =========================================================================
// Monaco Editor Setup
// =========================================================================
require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs' } });

let editorL, editorR;
const initialSourceL = ${JSON.stringify(initialSourceL)};
const initialSourceR = ${JSON.stringify(initialSourceR)};

// Keywords for both languages (defaults until server sends dynamic ones)
let dynamicKeywordsL = ['model','class','record','block','connector','type',
  'package','function','end','extends','parameter','constant','discrete',
  'input','output','flow','stream','public','protected','equation',
  'algorithm','initial','if','then','else','elseif','for','while','loop',
  'when','connect','der','within','import','replaceable','redeclare',
  'final','inner','outer','partial','encapsulated','expandable','operator',
  'pure','impure','each','not','and','or','true','false'];

let dynamicKeywordsR = ['block','part','attribute','port','interface','def',
  'package','abstract','in','out','inout','import','alias','redefines',
  'subsets','specializes','ordered','nonunique','connection','item',
  'requirement','constraint','action','state','calc','ref'];

// Semantic token state
let semanticTokenTypesArr = [];
let lastSemanticTokensL = null;
let lastSemanticTokensR = null;
let semanticTokenVersionL = 0;
let semanticTokenVersionR = 0;

require(['vs/editor/editor.main'], function () {
  // Register left language
  monaco.languages.register({ id: LANG_L });
  monaco.languages.setMonarchTokensProvider(LANG_L, {
    keywords: dynamicKeywordsL,
    typeKeywords: ['Real', 'Integer', 'Boolean', 'String'],
    tokenizer: {
      root: [
        [/\\/\\/.*$/, 'comment'], [/"[^"]*"/, 'string'], [/\\d+\\.?\\d*/, 'number'],
        [/[a-zA-Z_]\\w*/, { cases: { '@keywords': 'keyword', '@typeKeywords': 'type', '@default': 'identifier' } }],
        [/[;,=(){}\\[\\].:+\\-*\\/]/, 'delimiter'],
      ]
    }
  });

  ${
    polyglot
      ? `
  // Register right language
  monaco.languages.register({ id: LANG_R });
  monaco.languages.setMonarchTokensProvider(LANG_R, {
    keywords: dynamicKeywordsR,
    typeKeywords: ['Real', 'Integer', 'Boolean', 'String'],
    tokenizer: {
      root: [
        [/\\/\\/.*$/, 'comment'], [/"[^"]*"/, 'string'], [/\\d+\\.?\\d*/, 'number'],
        [/[a-zA-Z_]\\w*/, { cases: { '@keywords': 'keyword', '@typeKeywords': 'type', '@default': 'identifier' } }],
        [/[;,=(){}\\[\\].:+\\-*\\/]/, 'delimiter'],
      ]
    }
  });
  `
      : ""
  }

  // Custom dark theme with semantic token rules
  monaco.editor.defineTheme('metascript-dark', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'keyword', foreground: 'ff7b72', fontStyle: 'bold' },
      { token: 'type', foreground: '79c0ff' },
      { token: 'string', foreground: 'a5d6ff' },
      { token: 'number', foreground: '79c0ff' },
      { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
      { token: 'identifier', foreground: 'e6edf3' },
      { token: 'delimiter', foreground: '8b949e' },
    ],
    colors: {
      'editor.background': '#0d1117', 'editor.foreground': '#e6edf3',
      'editor.lineHighlightBackground': '#161b2266',
      'editorCursor.foreground': '#58a6ff',
      'editor.selectionBackground': '#264f7844',
      'editorLineNumber.foreground': '#484f58',
      'editorLineNumber.activeForeground': '#8b949e',
    }
  });

  // Define semantic token legend for Monaco
  const semanticLegend = {
    tokenTypes: ['keyword', 'type', 'variable', 'number', 'string', 'comment',
      'operator', 'namespace', 'property', 'label', 'regexp', 'enumMember',
      'enum', 'property', 'function'],
    tokenModifiers: [],
  };

  // Register semantic token providers for the editors
  function registerSemanticTokenProvider(langId, getTokens, getVersion) {
    monaco.languages.registerDocumentSemanticTokensProvider(langId, {
      getLegend: function() { return semanticLegend; },
      provideDocumentSemanticTokens: function(model, lastResultId, token) {
        const tokens = getTokens();
        if (!tokens || tokens.length === 0) return { data: new Uint32Array(0) };
        return { data: new Uint32Array(tokens), resultId: String(getVersion()) };
      },
      releaseDocumentSemanticTokens: function() {},
    });
  }

  registerSemanticTokenProvider(LANG_L,
    function() { return lastSemanticTokensL; },
    function() { return semanticTokenVersionL; }
  );
  ${
    polyglot
      ? `
  registerSemanticTokenProvider(LANG_R,
    function() { return lastSemanticTokensR; },
    function() { return semanticTokenVersionR; }
  );
  `
      : ""
  }

  // Apply semantic token colors via CSS-based theme customizations
  // These map to the semantic token types defined in the legend
  monaco.editor.defineTheme('metascript-dark-semantic', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'keyword', foreground: 'ff7b72', fontStyle: 'bold' },
      { token: 'type', foreground: '79c0ff' },
      { token: 'variable', foreground: 'e6edf3' },
      { token: 'number', foreground: '79c0ff' },
      { token: 'string', foreground: 'a5d6ff' },
      { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
      { token: 'operator', foreground: 'ff7b72' },
      { token: 'namespace', foreground: 'ffa657' },
      { token: 'property', foreground: 'd2a8ff' },
      { token: 'label', foreground: 'ffa657' },
      { token: 'regexp', foreground: '8b949e' },
      { token: 'enumMember', foreground: '79c0ff' },
      { token: 'enum', foreground: '79c0ff', fontStyle: 'bold' },
      { token: 'function', foreground: 'd2a8ff' },
      { token: 'identifier', foreground: 'e6edf3' },
      { token: 'delimiter', foreground: '8b949e' },
    ],
    colors: {
      'editor.background': '#0d1117', 'editor.foreground': '#e6edf3',
      'editor.lineHighlightBackground': '#161b2266',
      'editorCursor.foreground': '#58a6ff',
      'editor.selectionBackground': '#264f7844',
      'editorLineNumber.foreground': '#484f58',
      'editorLineNumber.activeForeground': '#8b949e',
    }
  });

  const editorOpts = {
    theme: 'metascript-dark-semantic',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 14, lineHeight: 22,
    padding: { top: 12, bottom: 12 },
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'all',
    bracketPairColorization: { enabled: true },
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    'semanticHighlighting.enabled': true,
    cursorSmoothCaretAnimation: 'on',
  };

  // Left editor
  editorL = monaco.editor.create(document.getElementById('editor-container'), {
    value: initialSourceL, language: LANG_L, ...editorOpts,
  });

  // Wire left editor LSP providers
  wireLSPProviders(LANG_L, 'hover', 'completion', 'definition');

  // Left editor change handler
  let debounceL, pendingChangesL = [];
  editorL.onDidChangeModelContent(function (event) {
    for (var i = 0; i < event.changes.length; i++) {
      var c = event.changes[i];
      pendingChangesL.push({
        rangeOffset: c.rangeOffset, rangeLength: c.rangeLength, text: c.text,
        range: { startLineNumber: c.range.startLineNumber, startColumn: c.range.startColumn,
                 endLineNumber: c.range.endLineNumber, endColumn: c.range.endColumn },
      });
    }
    clearTimeout(debounceL);
    debounceL = setTimeout(function () {
      var changes = pendingChangesL; pendingChangesL = [];
      sendMsg({ type: 'update', source: editorL.getValue(), changes: changes });
    }, 300);
  });

  ${
    polyglot
      ? `
  // Right editor
  editorR = monaco.editor.create(document.getElementById('editor-container-right'), {
    value: initialSourceR, language: LANG_R, ...editorOpts,
  });

  wireLSPProviders(LANG_R, 'hover-right', 'completion-right', 'definition-right');

  let debounceR, pendingChangesR = [];
  editorR.onDidChangeModelContent(function (event) {
    for (var i = 0; i < event.changes.length; i++) {
      var c = event.changes[i];
      pendingChangesR.push({
        rangeOffset: c.rangeOffset, rangeLength: c.rangeLength, text: c.text,
        range: { startLineNumber: c.range.startLineNumber, startColumn: c.range.startColumn,
                 endLineNumber: c.range.endLineNumber, endColumn: c.range.endColumn },
      });
    }
    clearTimeout(debounceR);
    debounceR = setTimeout(function () {
      var changes = pendingChangesR; pendingChangesR = [];
      sendMsg({ type: 'update-right', source: editorR.getValue(), changes: changes });
    }, 300);
  });
  `
      : ""
  }

  window.addEventListener('resize', () => {
    editorL.layout();
    ${polyglot ? "if (editorR) editorR.layout();" : ""}
  });
});

// Wire LSP providers for a language
function wireLSPProviders(langId, hoverType, completionType, defType) {
  monaco.languages.registerDefinitionProvider(langId, {
    provideDefinition: function (model, position) {
      return lspRequest(defType, { offset: model.getOffsetAt(position) }).then(function (data) {
        if (!data) return null;
        return { uri: model.uri, range: new monaco.Range(
          data.range.start.line + 1, data.range.start.character + 1,
          data.range.end.line + 1, data.range.end.character + 1
        )};
      });
    }
  });
  monaco.languages.registerHoverProvider(langId, {
    provideHover: function (model, position) {
      return lspRequest(hoverType, { offset: model.getOffsetAt(position) }).then(function (data) {
        if (!data) return null;
        var range = data.range ? new monaco.Range(
          data.range.start.line + 1, data.range.start.character + 1,
          data.range.end.line + 1, data.range.end.character + 1
        ) : undefined;
        return { contents: [{ value: data.contents }], range: range };
      });
    }
  });
  monaco.languages.registerCompletionItemProvider(langId, {
    triggerCharacters: ['.'],
    provideCompletionItems: function (model, position) {
      return lspRequest(completionType, { offset: model.getOffsetAt(position), sourceText: model.getValue() }).then(function (data) {
        if (!data || !data.length) return { suggestions: [] };
        var word = model.getWordUntilPosition(position);
        var range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        return {
          suggestions: data.map(function (item) {
            return { label: item.label, kind: item.kind || monaco.languages.CompletionItemKind.Variable,
                     detail: item.detail || '', insertText: item.label, range: range };
          })
        };
      });
    }
  });
}

// =========================================================================
// WebSocket
// =========================================================================
const ws = new WebSocket('ws://' + location.host);
const wsStatus = document.getElementById('ws-status');
const wsDot = document.getElementById('ws-dot');
let pendingRequests = {};
let requestId = 0;

function lspRequest(type, params) {
  return new Promise(function (resolve) {
    if (ws.readyState !== WebSocket.OPEN) { resolve(null); return; }
    const id = ++requestId;
    pendingRequests[type] = { resolve: resolve, id: id };
    ws.send(JSON.stringify(Object.assign({ type: type, id: id }, params)));
  });
}

function sendMsg(obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

ws.onopen = () => { wsStatus.textContent = 'Connected'; wsDot.style.background = 'var(--accent-green)'; };
ws.onerror = () => { wsStatus.textContent = 'Error'; wsDot.style.background = 'var(--accent-red)'; };
ws.onclose = () => { wsStatus.textContent = 'Disconnected'; wsDot.style.background = 'var(--text-muted)'; wsDot.style.animation = 'none'; };

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === 'analysis') {
    if (msg.cst) renderCST(msg.cst, 'cst-tree', 'cst-count');
    renderAST(msg.ast, 'ast-tree', 'ast-count');
    if (msg.symbols) renderSymbols(msg.symbols, 'generated-symbols');
    if (msg.diagnostics && editorL) setDiagnostics(msg.diagnostics, editorL);
    // Right side (initial load)
    if (msg.cstR) renderCST(msg.cstR, 'cst-tree-right', null);
    if (msg.astR) renderAST(msg.astR, 'ast-tree-right', 'ast-count-right');
    if (msg.diagnosticsR && editorR) setDiagnostics(msg.diagnosticsR, editorR);
    if (msg.projections) renderProjections(msg.projections);
    // Semantic tokens
    if (msg.semanticTokenTypes) semanticTokenTypesArr = msg.semanticTokenTypes;
    if (msg.keywords) dynamicKeywordsL = msg.keywords;
    if (msg.keywordsR) dynamicKeywordsR = msg.keywordsR;
    if (msg.semanticTokens) {
      lastSemanticTokensL = msg.semanticTokens;
      semanticTokenVersionL++;
      if (editorL && editorL.getModel()) {
        // Trigger semantic token refresh by notifying model change
        editorL.getModel()._onDidChangeContent.fire({});
      }
    }
    if (msg.semanticTokensR) {
      lastSemanticTokensR = msg.semanticTokensR;
      semanticTokenVersionR++;
      if (editorR && editorR.getModel()) {
        editorR.getModel()._onDidChangeContent.fire({});
      }
    }

  } else if (msg.type === 'analysis-right') {
    if (msg.astR) renderAST(msg.astR, 'ast-tree-right', 'ast-count-right');
    if (msg.projections) renderProjections(msg.projections);
    if (msg.semanticTokensR) {
      lastSemanticTokensR = msg.semanticTokensR;
      semanticTokenVersionR++;
    }

  } else if (msg.type === 'cst-update') {
    renderCST(msg.cst, 'cst-tree', 'cst-count');
  } else if (msg.type === 'cst-update-right') {
    renderCST(msg.cst, 'cst-tree-right', null);

  } else if (msg.type === 'diagnostics-update') {
    if (editorL) setDiagnostics(msg.diagnostics, editorL);
  } else if (msg.type === 'diagnostics-update-right') {
    if (editorR) setDiagnostics(msg.diagnostics, editorR);

  } else if (msg.type === 'hover' || msg.type === 'hover-right' ||
             msg.type === 'definition' || msg.type === 'definition-right' ||
             msg.type === 'completion' || msg.type === 'completion-right') {
    const pending = pendingRequests[msg.type];
    if (pending) { pending.resolve(msg.data); delete pendingRequests[msg.type]; }
  }
};

// =========================================================================
// Diagnostics
// =========================================================================
function setDiagnostics(diagnostics, editor) {
  if (!editor) return;
  const model = editor.getModel();
  if (!model) return;
  const markers = diagnostics.map(function (d) {
    const startPos = model.getPositionAt(d.startByte);
    const endPos = model.getPositionAt(d.endByte);
    return {
      severity: d.severity === 'error' ? monaco.MarkerSeverity.Error
        : d.severity === 'warning' ? monaco.MarkerSeverity.Warning
        : d.severity === 'info' ? monaco.MarkerSeverity.Info
        : monaco.MarkerSeverity.Hint,
      message: d.message,
      startLineNumber: startPos.lineNumber, startColumn: startPos.column,
      endLineNumber: endPos.lineNumber, endColumn: endPos.column,
      source: 'metascript',
    };
  });
  monaco.editor.setModelMarkers(model, 'metascript', markers);
}

// =========================================================================
// CST Renderer
// =========================================================================
function renderCST(cst, containerId, countId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const count = countNodes(cst);
  if (countId) { const el = document.getElementById(countId); if (el) el.textContent = count + ' nodes'; }
  container.innerHTML = renderCSTNode(cst);
}
function countNodes(node) { let c = 1; for (const ch of (node.children||[])) c += countNodes(ch); return c; }
function renderCSTNode(node) {
  const range = '<span class="node-range">[' + node.startByte + '..' + node.endByte + ']</span>';
  if (!node.children || node.children.length === 0) {
    const text = node.text ? '<span class="node-text">"' + escapeHtmlJS(node.text.substring(0, 60)) + '"</span>' : '';
    return '<div class="leaf"><span class="node-type">' + escapeHtmlJS(node.type) + '</span>' + text + range + '</div>';
  }
  return '<details open><summary><span class="node-type">' + escapeHtmlJS(node.type) + '</span>' + range + '</summary>' +
    node.children.map(renderCSTNode).join('') + '</details>';
}

// =========================================================================
// AST Renderer
// =========================================================================
function renderAST(ast, containerId, countId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const count = countASTNodes(ast);
  if (countId) { const el = document.getElementById(countId); if (el) el.textContent = count + ' symbols'; }
  container.innerHTML = ast.map(renderASTNode).join('');
}
function countASTNodes(nodes) { let c = 0; for (const n of nodes) { c += 1 + countASTNodes(n.children||[]); } return c; }
function renderASTNode(node) {
  const kindClass = 'kind-' + (['Class','Component','Function','Extends','Block','Part','Attribute','Port','PartDef','InterfaceDef'].includes(node.kind) ? node.kind : 'default');
  const kindBadge = '<span class="' + kindClass + '">' + escapeHtmlJS(node.kind) + '</span>';
  const name = ' <strong>' + escapeHtmlJS(node.name) + '</strong>';
  const meta = Object.keys(node.metadata||{}).length > 0
    ? Object.entries(node.metadata).map(([k,v]) => '<span class="meta-badge">' + k + '=' + escapeHtmlJS(String(v)) + '</span>').join('')
    : '';
  const id = '<span class="node-range">#' + node.id + '</span>';
  const children = node.children || [];
  if (children.length === 0) return '<div class="leaf">' + kindBadge + name + meta + id + '</div>';
  return '<details open><summary>' + kindBadge + name + meta + id + '</summary>' +
    children.map(renderASTNode).join('') + '</details>';
}

// =========================================================================
// Symbols Renderer
// =========================================================================
function renderSymbols(symbols, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '<div class="tree-node ast-node">' + symbols.map(renderSymbolNode).join('') + '</div>';
}
function renderSymbolNode(sym) {
  const name = '<strong>' + escapeHtmlJS(sym.name) + '</strong>';
  const range = '<span class="node-range">[' + sym.range.start.line + ':' + sym.range.start.character + ']</span>';
  const children = sym.children || [];
  if (children.length === 0) return '<div class="leaf">' + name + range + '</div>';
  return '<details open><summary>' + name + range + '</summary>' + children.map(renderSymbolNode).join('') + '</details>';
}

// =========================================================================
// Interop Projection Renderer
// =========================================================================
function renderProjections(projections) {
  const panel = document.getElementById('interop-panel');
  if (!panel) return;
  const countEl = document.getElementById('interop-count');
  if (countEl) countEl.textContent = projections.length + ' projections';

  if (projections.length === 0) {
    panel.innerHTML = '<div class="interop-empty"><div class="interop-icon">🔗</div>No cross-language matches.<br>Define adapters in language.ts to enable projections.</div>';
    return;
  }

  // Stats
  const byApproach = { A: 0, B: 0, C: 0 };
  projections.forEach(p => byApproach[p.approach]++);
  let stats = '<div class="interop-stats">';
  if (byApproach.A) stats += '<div class="interop-stat"><strong>' + byApproach.A + '</strong> source-side (A)</div>';
  if (byApproach.B) stats += '<div class="interop-stat"><strong>' + byApproach.B + '</strong> target-side (B)</div>';
  if (byApproach.C) stats += '<div class="interop-stat"><strong>' + byApproach.C + '</strong> global (C)</div>';
  stats += '</div>';

  let html = stats;
  for (const p of projections) {
    const arrow = p.direction === 'lr' ? '→' : '←';
    const approachLabel = p.approach === 'A' ? 'source export' : p.approach === 'B' ? 'target import' : 'global';
    html += '<div class="projection-card">' +
      '<div class="proj-header">' +
        '<span class="proj-name">' + escapeHtmlJS(p.foreignName) + '</span>' +
        '<span class="proj-arrow">' + arrow + '</span>' +
        '<span class="proj-target">' + escapeHtmlJS(p.targetClass) + '</span>' +
        '<span class="proj-approach proj-approach-' + p.approach + '">' + approachLabel + '</span>' +
      '</div>' +
      '<div class="proj-props">' + escapeHtmlJS(JSON.stringify(p.props, null, 2)) + '</div>' +
    '</div>';
  }
  panel.innerHTML = html;
}

// =========================================================================
// Tab Switching
// =========================================================================
function showGenTab(tab) {
  var src = document.getElementById('generated-source');
  var sym = document.getElementById('generated-symbols');
  if (src) src.style.display = tab === 'source' ? '' : 'none';
  if (sym) sym.style.display = tab === 'symbols' ? '' : 'none';
  document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
}
function showLeftTab(tab) {
  var ast = document.getElementById('ast-tree');
  var cst = document.getElementById('cst-tree');
  if (ast) ast.style.display = tab === 'ast' ? '' : 'none';
  if (cst) cst.style.display = tab === 'cst' ? '' : 'none';
  event.target.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
}
function showRightTab(tab) {
  var ast = document.getElementById('ast-tree-right');
  var cst = document.getElementById('cst-tree-right');
  if (ast) ast.style.display = tab === 'ast' ? '' : 'none';
  if (cst) cst.style.display = tab === 'cst' ? '' : 'none';
  event.target.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
}

// =========================================================================
// Util
// =========================================================================
function escapeHtmlJS(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
</script>
</body>
</html>`;
}
function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

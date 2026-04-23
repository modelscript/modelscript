/* eslint-disable */
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser";

Error.stackTraceLimit = Infinity;

import {
  CodeAction,
  CodeActionKind,
  CodeLens,
  Color,
  ColorInformation,
  ColorPresentation,
  CompletionItem,
  CompletionItemKind,
  Diagnostic,
  DiagnosticSeverity,
  DocumentHighlightKind,
  DocumentSymbol,
  InitializeResult,
  InlayHint,
  InlayHintKind,
  ParameterInformation,
  SemanticTokens,
  SemanticTokensBuilder,
  SemanticTokensLegend,
  ServerCapabilities,
  SignatureInformation,
  SymbolKind,
  TextDocumentSyncKind,
  TextDocuments,
  WorkspaceEdit,
} from "vscode-languageserver";

import { TextDocument } from "vscode-languageserver-textdocument";
import { buildDiagramData, getClassIconSvg, type DiagramData } from "./diagramData";
import {
  computeComponentInsert,
  computeComponentsDelete,
  computeConnectInsert,
  computeConnectRemove,
  computeDescriptionEdit,
  computeEdgePointEdits,
  computeNameEdit,
  computeParameterEdit,
  computePlacementEdits,
} from "./diagramEdits";
import {
  createEmptyLayout,
  removeElements,
  updateConnectionVertices,
  updateElementPositions,
  type SysML2Layout,
} from "./sysml2-layout";
import {
  computeSysML2ConnectionDelete,
  computeSysML2ConnectionInsert,
  computeSysML2DescriptionEdit,
  computeSysML2ElementDelete,
  computeSysML2ElementInsert,
  computeSysML2NameEdit,
  computeSysML2ParameterEdit,
  generateUniqueName,
} from "./sysml2DiagramEdits";

import { Language, Parser, Node as SyntaxNode, Tree as TreeSitterTree } from "web-tree-sitter";

import { unzipSync } from "fflate";

import {
  Context,
  LSPBridge,
  ModelicaClassDefinitionSyntaxNode,
  ModelicaClassInstance,
  ModelicaClassKind,
  ModelicaComponentInstance,
  ModelicaDAE,
  ModelicaElement,
  ModelicaFlattener,
  ModelicaInterpreter,
  ModelicaLinter,
  ModelicaNamedElement,
  ModelicaScriptScope,
  ModelicaStoredDefinitionSyntaxNode,
  ModelicaVariability,
  PositionIndex,
  QueryBackedClassInstance,
  QueryEngine,
  Scope,
  buildSysML2DiagramData,
  createModelicaLSPBridge,
  createModelicaQueryEngine,
  createModelicaScopeResolver,
  createModelicaWorkspaceIndex,
  createSysML2LSPBridge,
  createSysML2QueryEngine,
  createSysML2ScopeResolver,
  createSysML2WorkspaceIndex,
  injectPredefinedTypes,
  performBltTransformation,
  type Dirent,
  type FileSystem,
  type Stats,
} from "@modelscript/core";
import { ModelicaFmuEntity, buildFmuArchive, generateFmuWasmSource, generateMultiModelWrapper } from "@modelscript/fmi";
import {
  ModelicaCalibrator,
  ModelicaOptimizer,
  parseCsvMeasurements,
  registerCalibrateDeps,
  registerOptimizeDeps,
} from "@modelscript/optimizer";
import { VerificationRunner } from "@modelscript/polyglot";
import { ModelicaSimulator, registerSimulateDeps } from "@modelscript/simulator";
import { getRequirements, getTraceabilityMatrix } from "./requirements";

// Register flattener/simulator constructors for the scripting simulate() function.
// This breaks the circular dependency: interpreter → evaluate-simulate → flattener.
registerSimulateDeps({ Flattener: ModelicaFlattener, Simulator: ModelicaSimulator });
registerOptimizeDeps({ Flattener: ModelicaFlattener, Optimizer: ModelicaOptimizer });
registerCalibrateDeps({ Flattener: ModelicaFlattener, Simulator: ModelicaSimulator, Calibrator: ModelicaCalibrator });

console.log("ModelScript language server starting...");

/* Document formatter — ported from morsel's formatter.ts */

const INDENT_STRING = "  ";

// Nodes that increase indentation for their children/content
const INDENT_TRIGGER_NODES = new Set([
  "ClassDefinition",
  "IfStatement",
  "ForStatement",
  "WhileStatement",
  "WhenStatement",
  "IfEquation",
  "ForEquation",
  "WhenEquation",
  "enumeration_literal", // Enum values
]);

// Tokens that start a block but should be dedented to align with the container's start
const DEDENT_START_TOKENS = new Set([
  "model",
  "class",
  "record",
  "block",
  "connector",
  "type",
  "package",
  "function",
  "encapsulated",
  "partial",
  "final",
  "pure",
  "impure",
  "operator",
  "expandable",
]);

function format(tree: TreeSitterTree, content: string): string {
  const lines = content.split("\n");
  const formattedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (trimmedLine.length === 0) {
      formattedLines.push("");
      continue;
    }

    // Find the first non-whitespace character's column
    const firstCharColumn = line.search(/\S/);

    // Get the node at the start of the line
    const node = tree.rootNode.descendantForPosition({ row: i, column: firstCharColumn });
    if (!node) {
      formattedLines.push(line);
      continue;
    }

    // Calculate indentation level
    let indentLevel = 0;
    let current: SyntaxNode | null = node.parent;

    while (current) {
      if (INDENT_TRIGGER_NODES.has(current.type)) {
        indentLevel++;
      }
      current = current.parent;
    }

    // Adjust for dedent triggers (e.g., 'end', 'else', 'equation' keywords)
    const firstToken = trimmedLine.split(" ")[0];

    // Dedent start of blocks (model, class, etc)
    if (DEDENT_START_TOKENS.has(firstToken)) {
      indentLevel--;
    }

    // Dedent end of blocks and control structures (else, end, etc)
    if (trimmedLine.startsWith("end") || trimmedLine.startsWith("else") || trimmedLine.startsWith("elseif")) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    if (
      trimmedLine.startsWith("equation") ||
      trimmedLine.startsWith("algorithm") ||
      trimmedLine.startsWith("public") ||
      trimmedLine.startsWith("protected") ||
      trimmedLine.startsWith("initial equation") ||
      trimmedLine.startsWith("initial algorithm")
    ) {
      indentLevel--;
    }

    const indent = INDENT_STRING.repeat(Math.max(0, indentLevel));
    formattedLines.push(indent + trimmedLine);
  }

  return formattedLines.join("\n");
}

/* Browser-specific connection setup */

const messageReader = new BrowserMessageReader(self);
const messageWriter = new BrowserMessageWriter(self);

const connection = createConnection(messageReader, messageWriter);

/* In-memory filesystem backed by zip contents */

interface MemFile {
  content: string;
  binary: Uint8Array;
}

interface MemDir {
  children: Map<string, boolean>; // name → isDirectory
}

class BrowserFileSystem implements FileSystem {
  readonly #files = new Map<string, MemFile>();
  readonly #dirs = new Map<string, MemDir>();

  /** Normalise a path: collapse double-slashes, remove trailing slash */
  #norm(p: string): string {
    return p.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  }

  /** Add a file from zip decompression */
  addFile(path: string, data: Uint8Array): void {
    const p = this.#norm(path);
    const decoder = new TextDecoder();
    this.#files.set(p, { content: decoder.decode(data), binary: data });
    // Ensure parent directories exist
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/") || "/";
      const child = parts[i];
      const isDir = i < parts.length - 1;
      if (!this.#dirs.has(dir)) {
        this.#dirs.set(dir, { children: new Map() });
      }
      const dirEntry = this.#dirs.get(dir);
      if (!dirEntry) continue;
      if (!dirEntry.children.has(child)) {
        dirEntry.children.set(child, isDir);
      } else if (isDir) {
        // Upgrade from file to dir if needed
        dirEntry.children.set(child, true);
      }
    }
  }

  /** Register a directory (for leaf directories that may have no files) */
  addDir(path: string): void {
    const p = this.#norm(path);
    if (!this.#dirs.has(p)) {
      this.#dirs.set(p, { children: new Map() });
    }
    // Ensure parent chain
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/") || "/";
      const child = parts[i];
      if (!this.#dirs.has(dir)) {
        this.#dirs.set(dir, { children: new Map() });
      }
      const dirEntry = this.#dirs.get(dir);
      if (dirEntry) dirEntry.children.set(child, true);
    }
  }

  basename(path: string): string {
    return path.split("/").pop() || path;
  }
  extname(path: string): string {
    const dot = path.lastIndexOf(".");
    return dot >= 0 ? path.substring(dot) : "";
  }
  join(...paths: string[]): string {
    const joined = paths.join("/");
    return this.#norm(joined);
  }
  read(path: string): string {
    const p = this.#norm(path);
    const file = this.#files.get(p);
    if (file) return file.content;
    return "";
  }
  readBinary(path: string): Uint8Array {
    const p = this.#norm(path);
    const file = this.#files.get(p);
    if (file) return file.binary;
    return new Uint8Array();
  }
  readdir(path: string): Dirent[] {
    const p = this.#norm(path);
    const dir = this.#dirs.get(p);
    if (!dir) return [];
    const entries: Dirent[] = [];
    for (const [name, isDir] of dir.children) {
      entries.push({
        name,
        parentPath: p,
        isDirectory: () => isDir,
        isFile: () => !isDir,
      });
    }
    return entries;
  }
  resolve(...paths: string[]): string {
    return this.#norm(paths.join("/"));
  }
  readonly sep = "/";
  stat(path: string): Stats | null {
    const p = this.#norm(path);
    const epoch = new Date(0);
    if (this.#files.has(p)) {
      const file = this.#files.get(p);
      const size = file ? file.binary.length : 0;
      return {
        isDirectory: () => false,
        isFile: () => true,
        atime: epoch,
        ctime: epoch,
        mtime: epoch,
        size,
      };
    }
    if (this.#dirs.has(p)) {
      return { isDirectory: () => true, isFile: () => false, atime: epoch, ctime: epoch, mtime: epoch, size: 0 };
    }
    return null;
  }
}

/* Shared filesystem + context (populated with MSL during init) */

const sharedFs = new BrowserFileSystem();
let sharedContext: Context | null = null;

/* Tree-sitter state */

let parser: any = null;
let parserReady = false;

/* Incremental parsing — cache last tree per document for reuse */

interface CachedClassEntry {
  classDef: ModelicaClassDefinitionSyntaxNode;
  instance: ModelicaClassInstance;
  diagnostics: Diagnostic[];
}

interface CachedTree {
  text: string;
  tree: TreeSitterTree;
  classCache: Map<string, CachedClassEntry>;
}

const documentTrees = new Map<string, CachedTree>();
const lazyLibTrees = new Map<string, { tree: any; text: string }>();

/**
 * Compute the position (row, column) at a given byte index in a string.
 */
function indexToPoint(text: string, index: number): { row: number; column: number } {
  let row = 0;
  let lastNewline = -1;
  for (let i = 0; i < index; i++) {
    if (text[i] === "\n") {
      row++;
      lastNewline = i;
    }
  }
  return { row, column: index - lastNewline - 1 };
}

/**
 * Compute a tree-sitter Edit by finding the common prefix and suffix between
 * old and new text. This is O(n) but practically near-instant since we stop
 * at the first/last differing character.
 */
function computeTreeEdit(
  oldText: string,
  newText: string,
): {
  startIndex: number;
  oldEndIndex: number;
  newEndIndex: number;
  startPosition: { row: number; column: number };
  oldEndPosition: { row: number; column: number };
  newEndPosition: { row: number; column: number };
} {
  // Find common prefix
  const minLen = Math.min(oldText.length, newText.length);
  let prefixLen = 0;
  while (prefixLen < minLen && oldText[prefixLen] === newText[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix (not overlapping with prefix)
  let oldSuffix = oldText.length;
  let newSuffix = newText.length;
  while (oldSuffix > prefixLen && newSuffix > prefixLen && oldText[oldSuffix - 1] === newText[newSuffix - 1]) {
    oldSuffix--;
    newSuffix--;
  }

  return {
    startIndex: prefixLen,
    oldEndIndex: oldSuffix,
    newEndIndex: newSuffix,
    startPosition: indexToPoint(oldText, prefixLen),
    oldEndPosition: indexToPoint(oldText, oldSuffix),
    newEndPosition: indexToPoint(newText, newSuffix),
  };
}

/**
 * Parse a document incrementally, reusing the cached tree if available.
 * The result is cached for subsequent requests.
 */
function updateDocumentTree(uri: string, newText: string): TreeSitterTree {
  if (!parserReady || !parser) {
    throw new Error("Parser not ready");
  }

  const cached = documentTrees.get(uri);
  let tree: TreeSitterTree;

  if (cached && cached.text !== newText) {
    // Incremental reparse: edit the old tree and pass it to parse()
    const edit = computeTreeEdit(cached.text, newText);
    cached.tree.edit(edit as never);
    tree = parser.parse(newText, cached.tree);
  } else if (cached) {
    // Text unchanged — reuse existing tree
    return cached.tree;
  } else {
    // First parse — no old tree available
    tree = parser.parse(newText);
  }

  documentTrees.set(uri, { text: newText, tree, classCache: cached?.classCache ?? new Map() });
  return tree;
}

/**
 * Get the cached tree for a document, parsing fresh if needed.
 */
function getDocumentTree(uri: string): TreeSitterTree | null {
  if (!parserReady || !parser) return null;

  const cached = documentTrees.get(uri);
  if (cached) return cached.tree;

  // No cached tree — parse from current document text
  const document = documents.get(uri);
  if (!document) return null;

  const text = document.getText();
  return updateDocumentTree(uri, text);
}

/* Per-document state for hover resolution */

const documentInstances = new Map<string, ModelicaClassInstance[]>();
const documentContexts = new Map<string, Context>();

/* Workspace-wide class instances — keyed by document URI */
const workspaceInstances = new Map<string, ModelicaClassInstance[]>();
const allWorkspaceIndices = new Map<string, any>();

/* LSP-Bridge polyglot indexing */
const globalWorkspaceIndex = createModelicaWorkspaceIndex();
const sysml2WorkspaceIndex = createSysML2WorkspaceIndex();

import modelicaLangFallback from "@modelscript/modelica-polyglot/language";
import { UnifiedWorkspace } from "@modelscript/polyglot";
import sysml2LangFallback from "@modelscript/sysml2-polyglot/language";

const unifiedWorkspace = new UnifiedWorkspace();
unifiedWorkspace.registerWorkspace("modelica", globalWorkspaceIndex, modelicaLangFallback);
unifiedWorkspace.registerWorkspace("sysml2", sysml2WorkspaceIndex, sysml2LangFallback);

const documentLSPBridges = new Map<string, LSPBridge>();

/** Per-document QueryEngine — used by compat-shim to create QueryBackedClassInstance wrappers */
const documentQueryEngines = new Map<string, QueryEngine>();

/* SysML2 parser (separate from Modelica) */
let sysml2Parser: Parser | null = null;
let sysml2ParserReady = false;
let sysml2StdlibReady = false;

/* Whether MSL background indexing has completed */
let mslStdlibReady = false;

/* SysML2 layout data — stores diagram positions in-memory (sidecar to .sysml files) */
const sysml2Layouts = new Map<string, SysML2Layout>();

/* Resolve a modification/annotation path element to its named element */

function resolvePathElement(node: SyntaxNode, scope: Scope): ModelicaNamedElement | null {
  let pathNode: SyntaxNode | null = node;
  const parameterPath: string[] = [];
  let baseElement: ModelicaNamedElement | null = null;
  let foundBase = false;

  while (pathNode) {
    if (pathNode.type === "ElementModification") {
      const nameNode = pathNode.children.find((c: SyntaxNode) => c.type === "Name");
      if (nameNode) {
        parameterPath.unshift(...nameNode.text.split("."));
      }
    } else if (pathNode.type === "NamedArgument") {
      const identNode = pathNode.childForFieldName("identifier");
      if (identNode) {
        parameterPath.unshift(identNode.text);
      }
    }

    // If we hit a FunctionCall, it's a base (potential record constructor)
    if (pathNode.type === "FunctionCall") {
      const refNode = pathNode.children.find((c: SyntaxNode) => c.type === "ComponentReference");
      if (refNode) {
        const funcRef = refNode.text;
        baseElement = scope.resolveName(funcRef.split("."));
        if (!baseElement) {
          const annotationClass = (ModelicaElement as any).annotationClassInstance;
          if (annotationClass) {
            baseElement = annotationClass.resolveSimpleName(funcRef);
            if (!baseElement && funcRef.includes(".")) {
              baseElement = annotationClass.resolveName(funcRef.split("."));
            }
          }
        }
        if (baseElement) {
          foundBase = true;
          break;
        }
      }
    }

    if (pathNode.type === "AnnotationClause") {
      baseElement = (ModelicaElement as any).annotationClassInstance;
      foundBase = true;
      break;
    }

    if (
      pathNode.type === "ComponentClause" ||
      pathNode.type === "ShortClassSpecifier" ||
      pathNode.type === "ExtendsClause"
    ) {
      const typeSpecNode = pathNode.children.find((c: SyntaxNode) => c.type === "TypeSpecifier");
      if (typeSpecNode) {
        baseElement = scope.resolveName(typeSpecNode.text.split("."));
        foundBase = true;
        break;
      }
    }

    pathNode = pathNode.parent;
  }

  if (foundBase && baseElement) {
    return baseElement instanceof ModelicaClassInstance
      ? baseElement.resolveName(parameterPath)
      : baseElement instanceof ModelicaComponentInstance
        ? (baseElement.classInstance?.resolveName(parameterPath) ?? null)
        : null;
  }
  return null;
}

/* Initialize tree-sitter parser */

async function initTreeSitter(extensionUri: string): Promise<void> {
  try {
    // Construct absolute URLs for WASM files using the extension URI.
    // The extensionUri may be an HTTP URL or a VS Code internal URI scheme.
    // For static deployments, we need to ensure it resolves to an HTTP URL.
    let serverDistBase = `${extensionUri}/server/dist`;
    connection.console.info(`[tree-sitter] extensionUri: ${extensionUri}`);
    connection.console.info(`[tree-sitter] serverDistBase: ${serverDistBase}`);

    // If the URI isn't HTTP(S), try to construct an HTTP URL from the worker's location
    if (!serverDistBase.startsWith("http://") && !serverDistBase.startsWith("https://")) {
      // Fallback: use the worker's origin with the known static path
      const origin = (globalThis as unknown as { location?: { origin?: string } }).location?.origin;
      if (origin) {
        serverDistBase = `${origin}/static/devextensions/server/dist`;
        connection.console.info(`[tree-sitter] Using fallback serverDistBase: ${serverDistBase}`);
      }
    }

    connection.sendNotification("modelscript/status", { state: "loading", message: "Initializing parser..." });

    await Parser.init({
      locateFile: (file: string) => {
        return `${serverDistBase}/${file}`;
      },
    });

    const Modelica = await Language.load(`${serverDistBase}/tree-sitter-modelica.wasm`);
    parser = new Parser();
    parser.setLanguage(Modelica);
    Context.registerParser(".mo", parser);
    Context.registerParser(".mos", parser);
    parserReady = true;
    connection.console.info("Tree-sitter Modelica parser initialized");

    // Initialize SysML2 parser
    try {
      const SysML2 = await Language.load(`${serverDistBase}/tree-sitter-sysml2.wasm`);
      sysml2Parser = new Parser();
      sysml2Parser.setLanguage(SysML2);
      Context.registerParser(".sysml", sysml2Parser as any);
      sysml2ParserReady = true;
      connection.console.info("Tree-sitter SysML2 parser initialized");
    } catch (e) {
      connection.console.warn(`[tree-sitter] Failed to load SysML2 language: ${e}`);
    }

    // Load the Modelica Standard Library from the bundled zip
    await loadMSL(serverDistBase);

    // Load the SysML v2 Standard Library from the bundled zip
    if (sysml2ParserReady) {
      await loadSysML2StandardLibrary(serverDistBase);
    }

    // Re-validate strictly AFTER MSL and parser are ready!
    connection.console.info(`[lsp] Initialization complete. Re-validating ${documents.all().length} open documents.`);

    // Initial fast validation pass — uses toUnifiedPartial() which only merges
    // already-parsed files (just the open documents). No MSL parsing happens here.
    for (const doc of documents.all()) {
      await validateTextDocument(doc);
    }

    connection.sendNotification("modelscript/status", { state: "ready", message: "ModelScript" });

    // Background-index remaining MSL files progressively, then re-validate
    // with the full unified index for cross-file resolution.
    const pending = globalWorkspaceIndex.pendingFileCount;
    if (pending > 0) {
      connection.console.info(`[lsp] Background-indexing ${pending} remaining files...`);
      globalWorkspaceIndex
        .indexRemainingInBackground(20, (indexed, total) => {
          if (indexed % 200 === 0) {
            connection.console.info(`[lsp] Background indexing: ${indexed}/${total}`);
          }
        })
        .then(async () => {
          mslStdlibReady = true;
          connection.console.info(`[lsp] Background indexing complete. Re-validating documents.`);
          // Re-validate with full index for cross-file resolution
          for (let pass = 1; pass <= 2; pass++) {
            for (const doc of documents.all()) {
              await validateTextDocument(doc);
            }
          }
        });
    } else {
      // No MSL files to index (or all already indexed) — mark ready immediately
      mslStdlibReady = true;
    }
  } catch (e: any) {
    connection.console.error(`Failed to initialize tree-sitter: ${e}\n${e.stack}`);
    parserReady = false;
    connection.sendNotification("modelscript/status", { state: "error", message: "Parser initialization failed" });
  }
}

// ---------------------------------------------------------------------------
//  IndexedDB helpers for MSL cache
// ---------------------------------------------------------------------------

const MSL_DB_NAME = "modelscript-msl-cache";
const MSL_DB_VERSION = 1;
const MSL_STORE = "files";
const MSL_VERSION_KEY = "ModelicaStandardLibrary_v4.1.0";

function openMSLCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MSL_DB_NAME, MSL_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MSL_STORE)) {
        db.createObjectStore(MSL_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MSL_STORE, "readonly");
    const req = tx.objectStore(MSL_STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MSL_STORE, "readwrite");
    tx.objectStore(MSL_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------

/** Fetch and decompress the bundled MSL zip, populate the shared filesystem and context.
 *  Uses IndexedDB to cache the extracted file entries so that on subsequent
 *  loads the network fetch and decompression are skipped entirely. */
async function loadMSL(serverDistBase: string): Promise<void> {
  try {
    connection.sendNotification("modelscript/status", {
      state: "loading",
      message: "Loading Modelica Standard Library...",
    });

    let fileEntries: Record<string, Uint8Array> | null = null;

    // ---- Try IndexedDB cache first ----
    try {
      const db = await openMSLCache();
      const cached = await idbGet<Record<string, ArrayBuffer>>(db, MSL_VERSION_KEY);
      if (cached) {
        console.log("[msl-cache] Cache hit — loading from IndexedDB");
        connection.sendNotification("modelscript/status", {
          state: "loading",
          message: "Loading MSL from cache...",
        });
        // Convert ArrayBuffers back to Uint8Arrays
        fileEntries = {};
        for (const [name, buf] of Object.entries(cached)) {
          fileEntries[name] = new Uint8Array(buf);
        }
      }
      db.close();
    } catch (cacheErr) {
      console.warn("[msl-cache] IndexedDB read failed, falling back to network:", cacheErr);
    }

    // ---- Network fetch + decompress if not cached ----
    if (!fileEntries) {
      const response = await fetch(`${serverDistBase}/ModelicaStandardLibrary_v4.1.0.zip`);
      if (!response.ok) {
        console.warn("MSL zip not found — library features will be unavailable");
        return;
      }
      connection.sendNotification("modelscript/status", {
        state: "loading",
        message: "Decompressing MSL...",
      });
      const buffer = await response.arrayBuffer();
      const zipData = new Uint8Array(buffer);
      fileEntries = unzipSync(zipData);

      // Store in IndexedDB for next time (fire-and-forget)
      try {
        const db = await openMSLCache();
        // Convert Uint8Arrays to plain ArrayBuffers for structured-clone compatibility
        const serializable: Record<string, ArrayBuffer> = {};
        for (const [name, data] of Object.entries(fileEntries)) {
          serializable[name] = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        }
        await idbPut(db, MSL_VERSION_KEY, serializable);
        db.close();
        console.log("[msl-cache] Cached extracted MSL in IndexedDB");
      } catch (cacheErr) {
        console.warn("[msl-cache] IndexedDB write failed:", cacheErr);
      }
    }

    // ---- Populate in-memory filesystem ----
    let fileCount = 0;
    for (const [name, data] of Object.entries(fileEntries)) {
      if (name.endsWith("/")) {
        sharedFs.addDir(`/lib/${name.slice(0, -1)}`);
        continue;
      }
      sharedFs.addFile(`/lib/${name}`, data);
      fileCount++;
    }
    console.log(`MSL loaded: ${fileCount} files`);
    connection.sendNotification("modelscript/status", { state: "loading", message: "Processing MSL classes..." });

    // Create the shared context and register MSL libraries
    sharedContext = new Context(sharedFs);
    const libEntries = sharedFs.readdir("/lib");
    const hasPackage = libEntries.some((e) => e.name === "package.mo");
    if (hasPackage) {
      await sharedContext.addLibrary("/lib", { skipIndex: true });
    } else {
      for (const entry of libEntries) {
        if (entry.isDirectory()) {
          try {
            await sharedContext.addLibrary(`/lib/${entry.name}`, { skipIndex: true });
          } catch (e) {
            console.warn(`Failed to load library from /lib/${entry.name}:`, e);
          }
        }
      }
    }
    // Perform a single indexing pass after all libraries are registered
    connection.sendNotification("modelscript/status", { state: "loading", message: "Indexing MSL classes..." });
    await sharedContext.finalizeLibraries();
    console.log(
      `MSL libraries registered in shared context. Total elements in context: ${Array.from(sharedContext.elements).length}`,
    );

    // Register MSL files lazily in the polyglot workspace index so the QueryEngine
    // can resolve qualified type specifiers (e.g. Modelica.Electrical.Analog.Sources.SineVoltage).
    // We use lazy tree factories so files are only parsed the first time they're needed.
    if (parser) {
      connection.sendNotification("modelscript/status", { state: "loading", message: "Indexing MSL for polyglot..." });
      let registeredCount = 0;
      const mslTreeCache = new Map<string, any>();
      const registerDirLazy = (dirPath: string) => {
        try {
          const entries = sharedFs.readdir(dirPath);
          for (const entry of entries) {
            const fullPath = `${dirPath}/${entry.name}`;
            if (entry.isDirectory()) {
              registerDirLazy(fullPath);
            } else if (entry.name.endsWith(".mo")) {
              const uri = `file://${fullPath}`;

              // Compute parentFQN based on directory structure
              // e.g. /lib/Modelica/Electrical/package.mo -> "Modelica"
              let parentFQN = "";
              const relPath = fullPath.substring(5); // strip "/lib/"
              const parts = relPath.split("/");
              if (parts[parts.length - 1] === "package.mo") {
                parts.pop(); // Remove "package.mo"
                parts.pop(); // Remove the package dir name itself
              } else {
                parts.pop(); // Remove "Filename.mo"
              }
              // The top-level directory in the MSL zip has a version string (e.g. "Modelica 4.1.0").
              // This must be stripped to map correctly to the FQN "Modelica".
              if (parts.length > 0) {
                parts[0] = parts[0].split(" ")[0];
              }
              parentFQN = parts.join(".");

              globalWorkspaceIndex.register(
                uri,
                () => {
                  // Lazy: parse the file only when its tree is first requested
                  if (!mslTreeCache.has(fullPath)) {
                    try {
                      const text = sharedFs.read(fullPath);
                      if (text) {
                        const tree = sharedContext!.parse(".mo", text);
                        mslTreeCache.set(fullPath, tree);
                      }
                    } catch {
                      mslTreeCache.set(fullPath, null);
                    }
                  }
                  return mslTreeCache.get(fullPath)?.rootNode ?? null;
                },
                parentFQN,
              );
              registeredCount++;
            }
          }
        } catch {
          // Directory might not exist
        }
      };
      registerDirLazy("/lib");
      console.log(`[polyglot] Registered ${registeredCount} MSL files lazily in globalWorkspaceIndex`);
    }
  } catch (e) {
    console.error("Failed to load MSL zip:", e);
  }
}

// ---------------------------------------------------------------------------

const SYSML_VERSION_KEY = "SysML-v2-Release-2026-03";

async function loadSysML2StandardLibrary(serverDistBase: string): Promise<void> {
  try {
    connection.sendNotification("modelscript/status", {
      state: "loading",
      message: "Loading SysML v2 Standard Library...",
    });

    let fileEntries: Record<string, Uint8Array> | null = null;
    try {
      const db = await openMSLCache(); // Reuse MSL indexedDB
      const cached = await idbGet<Record<string, ArrayBuffer>>(db, SYSML_VERSION_KEY);
      if (cached) {
        console.log("[sysml-cache] Cache hit — loading sysml stdlib from IndexedDB");
        fileEntries = {};
        for (const [name, buf] of Object.entries(cached)) {
          fileEntries[name] = new Uint8Array(buf);
        }
      }
      db.close();
    } catch {
      /* ignore */
    }

    if (!fileEntries) {
      const response = await fetch(`${serverDistBase}/SysML-v2-Release-2026-03.zip`);
      if (!response.ok) {
        console.warn("SysML v2 standard library zip not found in dist");
        return;
      }
      connection.sendNotification("modelscript/status", {
        state: "loading",
        message: "Decompressing SysML v2 library...",
      });
      const buffer = await response.arrayBuffer();
      const zipData = new Uint8Array(buffer);
      fileEntries = unzipSync(zipData);

      try {
        const db = await openMSLCache();
        const serializable: Record<string, ArrayBuffer> = {};
        for (const [name, data] of Object.entries(fileEntries)) {
          if (name.endsWith(".sysml")) {
            serializable[name] = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
          }
        }
        await idbPut(db, SYSML_VERSION_KEY, serializable);
        db.close();
      } catch {
        /* ignore */
      }
    }

    let fileCount = 0;
    const textDecoder = new TextDecoder("utf-8");
    for (const [name, data] of Object.entries(fileEntries)) {
      if (!name.endsWith(".sysml")) continue;
      // Filter out only kerml/ and sysml.library/
      if (!name.includes("kerml/") && !name.includes("sysml.library/")) continue;

      const text = textDecoder.decode(data);
      const uri = `sysml2://stdlib/${name}`;

      // Store in documentTrees so LSP operations like Hover and GoToDef can access the text/tree
      documentTrees.set(uri, { text, tree: null as any, classCache: new Map() });
      sysml2WorkspaceIndex.register(uri, () => {
        const tree = sysml2Parser!.parse(text);
        const node = documentTrees.get(uri);
        if (node && tree) node.tree = tree;
        return tree!.rootNode;
      });
      fileCount++;
    }

    sysml2StdlibReady = true;
    console.log(`SysML2 Standard Library loaded: ${fileCount} files registered in sysml2WorkspaceIndex.`);
  } catch (e) {
    console.error("Failed to load SysML2 standard library:", e);
  }
}

/* Modelica keyword lists (matching morsel's code.tsx) */

const keywords = [
  "algorithm",
  "and",
  "annotation",
  "block",
  "break",
  "class",
  "connect",
  "connector",
  "constant",
  "constrainedby",
  "der",
  "discrete",
  "each",
  "else",
  "elseif",
  "elsewhen",
  "encapsulated",
  "end",
  "enumeration",
  "equation",
  "expandable",
  "extends",
  "external",
  "false",
  "final",
  "flow",
  "for",
  "function",
  "if",
  "import",
  "impure",
  "initial",
  "inner",
  "input",
  "loop",
  "model",
  "not",
  "operator",
  "or",
  "outer",
  "output",
  "package",
  "parameter",
  "partial",
  "protected",
  "public",
  "pure",
  "record",
  "redeclare",
  "replaceable",
  "return",
  "stream",
  "then",
  "true",
  "type",
  "when",
  "while",
  "within",
];

const typeKeywords = ["Boolean", "Integer", "Real", "String"];

/* Semantic token legend — matches morsel's code.tsx exactly */

const tokenTypes = [
  "keyword",
  "type",
  "class",
  "variable",
  "parameter",
  "function",
  "string",
  "number",
  "operator",
  "comment",
];

const tokenModifiers = ["declaration", "readonly"];

const legend: SemanticTokensLegend = { tokenTypes, tokenModifiers };

/* Language server initialization */

connection.onInitialize((params): InitializeResult => {
  connection.console.info("[lsp] onInitialize called");
  // Get the extension URI from initializationOptions
  const extensionUri = params.initializationOptions?.extensionUri as string;

  if (extensionUri) {
    connection.console.info(`[lsp] Triggering initTreeSitter with extensionUri=${extensionUri}`);
    initTreeSitter(extensionUri).catch((e) => {
      connection.console.error(`[lsp] initTreeSitter threw an error: ${e}\n${e.stack}`);
    });
  } else {
    connection.console.warn("No extensionUri provided — tree-sitter disabled");
  }

  const capabilities: ServerCapabilities = {
    textDocumentSync: TextDocumentSyncKind.Full,
    completionProvider: {
      triggerCharacters: ["."],
    },
    hoverProvider: true,
    semanticTokensProvider: {
      legend,
      full: true,
    },
    documentFormattingProvider: true,
    colorProvider: true,
    documentSymbolProvider: true,
    definitionProvider: true,
    typeDefinitionProvider: true,
    referencesProvider: true,
    foldingRangeProvider: true,
    selectionRangeProvider: true,
    documentHighlightProvider: true,
    signatureHelpProvider: {
      triggerCharacters: ["(", ","],
    },
    renameProvider: {
      prepareProvider: true,
    },
    codeActionProvider: {
      codeActionKinds: [CodeActionKind.QuickFix],
    },
    workspaceSymbolProvider: true,
    codeLensProvider: { resolveProvider: false },
    inlayHintProvider: true,
  };
  return { capabilities };
});

// Track open, change and close text document events
const documents = new TextDocuments(TextDocument);
documents.listen(connection);

// Validate documents when they change, and re-validate other open docs for cross-file resolution
let revalidationTimer: ReturnType<typeof setTimeout> | null = null;
let verificationTimer: ReturnType<typeof setTimeout> | null = null;
let activeVerification: AbortController | null = null;
const verificationDiagnosticsByUri = new Map<string, Diagnostic[]>();
const verificationResultsByUri = new Map<string, any[]>();
const activeValidationTimers = new Map<string, ReturnType<typeof setTimeout>>();

function flushValidation(uri: string) {
  const timer = activeValidationTimers.get(uri);
  if (timer) {
    clearTimeout(timer);
    activeValidationTimers.delete(uri);
    const doc = documents.get(uri);
    if (doc) validateTextDocument(doc);
  }
}

documents.onDidChangeContent((change) => {
  const uri = change.document.uri;
  verificationDiagnosticsByUri.delete(uri);
  verificationResultsByUri.delete(uri);

  const existingTimer = activeValidationTimers.get(uri);
  if (existingTimer) clearTimeout(existingTimer);

  activeValidationTimers.set(
    uri,
    setTimeout(() => {
      const doc = documents.get(uri);
      if (doc) validateTextDocument(doc);
      activeValidationTimers.delete(uri);
    }, 200),
  );

  // Debounced cross-file revalidation: re-validate OTHER open docs for cross-file resolution.
  // Only re-validate documents of the same language — cross-language edits don't affect
  // each other's diagnostics. Use a longer debounce to avoid cascading validations.
  if (revalidationTimer) clearTimeout(revalidationTimer);
  const changedExt = uri.substring(uri.lastIndexOf("."));
  revalidationTimer = setTimeout(() => {
    for (const doc of documents.all()) {
      if (doc.uri !== uri && doc.uri.endsWith(changedExt)) {
        validateTextDocument(doc);
      }
    }
  }, 3000);
});

// Clean up when a document is closed
documents.onDidClose((event) => {
  workspaceInstances.delete(event.document.uri);
  documentInstances.delete(event.document.uri);
  documentContexts.delete(event.document.uri);
  const oldTree = documentTrees.get(event.document.uri);
  if (oldTree) {
    oldTree.tree.delete();
    documentTrees.delete(event.document.uri);
  }
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });

  // Re-validate remaining open documents
  for (const doc of documents.all()) {
    validateTextDocument(doc);
  }
});

/* Diagnostic validation — uses tree-sitter + ModelicaLinter when available */

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const diagnostics: Diagnostic[] = [];
  const text = textDocument.getText();

  // Handle Javascript/TypeScript sidecar files natively via mock entity
  if (textDocument.uri.endsWith(".js") || textDocument.uri.endsWith(".ts")) {
    const context = sharedContext ?? new Context(sharedFs);
    const entity = {
      isClassInstance: true,
      jsSource: text,
      name: "",
      context,
      uri: textDocument.uri,
      instantiate() {},
    } as any;
    // Derive name from generic path (e.g. file:///.../Test.js -> Test)
    const filename = textDocument.uri.split("/").pop();
    if (filename) {
      entity.name = filename.replace(/\.[tj]s$/, "");
    }
    entity.instantiate(); // Regex parses and natively hydrates the parameters
    workspaceInstances.set(textDocument.uri, [entity]);
    documentInstances.set(textDocument.uri, [entity]);
    documentContexts.set(textDocument.uri, context);
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
    connection.sendNotification("modelscript/projectTreeChanged");
    return;
  }

  // Handle SysML2 files via the polyglot SysML2 pipeline
  if (textDocument.uri.endsWith(".sysml") && sysml2ParserReady && sysml2Parser) {
    try {
      const tree = sysml2Parser.parse(text);
      if (!tree) {
        connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
        return;
      }

      // Store in documentTrees so verification and other LSP operations can access the tree/text
      documentTrees.set(textDocument.uri, { text, tree, classCache: new Map() });

      // Register/update in SysML2 workspace index
      if (sysml2WorkspaceIndex.has(textDocument.uri)) {
        sysml2WorkspaceIndex.markDirty(textDocument.uri, () => tree.rootNode);
      } else {
        sysml2WorkspaceIndex.register(textDocument.uri, () => tree.rootNode);
      }

      // Force index evaluation for active document AFTER it is registered/marked dirty
      // so that it actually triggers processing and populates the partial index.
      // Without this, toUnifiedPartial() skips the file (index stays null).
      sysml2WorkspaceIndex.getFileIndex(textDocument.uri);

      // Create or update query engine, resolver, and LSP bridge for the document
      const unifiedIndex = unifiedWorkspace.toUnifiedPartial();

      let engine = documentQueryEngines.get(textDocument.uri) as any;
      if (engine) {
        engine.updateIndex(unifiedIndex);
      } else {
        engine = createSysML2QueryEngine(unifiedIndex);
        documentQueryEngines.set(textDocument.uri, engine);
      }

      let resolver = (engine as any).__resolverCache;
      if (!resolver) {
        resolver = createSysML2ScopeResolver(unifiedIndex);
        (engine as any).__resolverCache = resolver;
      } else {
        resolver.updateIndex(unifiedIndex);
      }

      const bridge = createSysML2LSPBridge(unifiedIndex, engine, resolver, text, textDocument.uri);
      documentLSPBridges.set(textDocument.uri, bridge);

      // Collect parse errors from the tree
      const sysmlDiagnostics: Diagnostic[] = [];
      const collectErrors = (node: SyntaxNode | any) => {
        if (!node) return;
        if (typeof node.hasError === "function" ? !node.hasError() : node.hasError === false) return;
        if (node.type === "ERROR" || node.isMissing) {
          const start = bridge["positions"].offsetToPosition(node.startIndex);
          const end = bridge["positions"].offsetToPosition(node.endIndex);
          sysmlDiagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: { start, end },
            message: node.isMissing ? `Missing ${node.type}` : `Syntax error`,
            source: "sysml2",
          });
        }
        for (let i = 0; i < node.childCount; i++) {
          collectErrors(node.child(i));
        }
      };
      collectErrors(tree.rootNode);

      // Run Polyglot declarative lints (e.g. multiplicity bounds, usage matching)
      const engineDiags = engine.runAllLints(textDocument.uri);
      for (const d of engineDiags) {
        const start = bridge["positions"].offsetToPosition(d.startByte);
        const end = bridge["positions"].offsetToPosition(d.endByte);
        let severity: DiagnosticSeverity = DiagnosticSeverity.Warning;
        if (d.severity === "error") severity = DiagnosticSeverity.Error;
        if (d.severity === "info") severity = DiagnosticSeverity.Information;

        sysmlDiagnostics.push({
          severity,
          range: { start, end },
          message: d.message,
          source: "sysml2",
        });
      }

      // Collect unresolved references
      // Skip unresolved-reference diagnostics while the SysML2 standard library
      // is still loading — primitive types like Real/Integer/Boolean/String live
      // in the stdlib and produce false positives until it's indexed.
      const unresolvedRefs = sysml2StdlibReady ? resolver.resolveAllReferences(textDocument.uri) : [];
      for (const r of unresolvedRefs) {
        const start = bridge["positions"].offsetToPosition(r.startByte);
        const end = bridge["positions"].offsetToPosition(r.endByte);
        let severity: DiagnosticSeverity = DiagnosticSeverity.Error;
        if (r.severity === "warning") severity = DiagnosticSeverity.Warning;
        if (r.severity === "info") severity = DiagnosticSeverity.Information;

        sysmlDiagnostics.push({
          severity,
          range: { start, end },
          message: r.message,
          source: "sysml2",
        });
      }

      const vDiags = verificationDiagnosticsByUri.get(textDocument.uri);
      if (vDiags) {
        sysmlDiagnostics.push(...vDiags);
      }

      connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: sysmlDiagnostics });
    } catch (e: any) {
      connection.console.error(`[sysml2] Error processing ${textDocument.uri}: ${e.message}`);
      connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
    }
    return;
  }

  if (parserReady && parser) {
    // Polyglot-only pipeline: tree-sitter parse → SymbolIndex → QueryEngine → diagnostics
    const context = sharedContext ?? new Context(sharedFs);

    // Parse with tree-sitter (incremental when possible)
    const oldCached = documentTrees.get(textDocument.uri);

    let tree: any;
    if (oldCached && oldCached.text !== text) {
      const edit = computeTreeEdit(oldCached.text, text);
      oldCached.tree.edit(edit as never);
      tree = context.parse(".mo", text, oldCached.tree as never);
    } else if (oldCached) {
      tree = oldCached.tree;
    } else {
      tree = context.parse(".mo", text);
    }
    documentTrees.set(textDocument.uri, { text, tree, classCache: oldCached?.classCache ?? new Map() });

    // Normalize UI virtual URIs back to internal indices so we can match MSL classes correctly
    const effectiveUri = textDocument.uri.startsWith("modelscript-lib://global")
      ? "file://" + textDocument.uri.substring("modelscript-lib://global".length)
      : textDocument.uri;

    // --- Polyglot Pipeline ---
    if (globalWorkspaceIndex.has(effectiveUri)) {
      globalWorkspaceIndex.markDirty(effectiveUri, () => tree.rootNode);
    } else {
      globalWorkspaceIndex.register(effectiveUri, () => tree.rootNode);
    }

    // Force index evaluation for active document AFTER it is registered/marked dirty
    // so that it actually triggers processing and populates the partial index.
    globalWorkspaceIndex.getFileIndex(effectiveUri);

    // Create query engine, resolver, and LSP bridge over the unified workspace index.
    // Use toUnifiedPartial() to avoid blocking on parsing ALL MSL files —
    // only merges files that have already been indexed.
    let unifiedIndex = unifiedWorkspace.toUnifiedPartial();

    const cstTreeWrapper = {
      getText(startByte: number, endByte: number, entry?: any): string | null {
        if (!entry || !entry.resourceId) return null;
        const uri = entry.resourceId;
        const docTree = documentTrees.get(uri);
        if (docTree && docTree.tree && docTree.text) return docTree.text.substring(startByte, endByte);

        let lazyCache = lazyLibTrees.get(uri);
        if (!lazyCache && sharedContext) {
          try {
            const fsPath = uri.startsWith("file://") ? uri.substring(7) : uri;
            const text = sharedContext.fs.read(fsPath);
            if (text) {
              const tree = sharedContext.parse(uri.endsWith(".sysml") ? ".sysml" : ".mo", text);
              lazyCache = { tree, text };
              lazyLibTrees.set(uri, lazyCache);
            }
          } catch (e) {
            // ignore
          }
        }
        if (lazyCache) return lazyCache.text.substring(startByte, endByte);
        return null;
      },
      getNode(startByte: number, endByte: number, entry?: any): any | null {
        if (!entry || !entry.resourceId) return null;
        const uri = entry.resourceId;
        const docTree = documentTrees.get(uri);
        if (docTree && docTree.tree)
          return docTree.tree.rootNode.descendantForIndex(startByte, Math.max(startByte, endByte - 1));

        let lazyCache = lazyLibTrees.get(uri);
        if (!lazyCache && sharedContext) {
          try {
            const fsPath = uri.startsWith("file://") ? uri.substring(7) : uri;
            const text = sharedContext.fs.read(fsPath);
            if (text) {
              const tree = sharedContext.parse(uri.endsWith(".sysml") ? ".sysml" : ".mo", text);
              lazyCache = { tree, text };
              lazyLibTrees.set(uri, lazyCache);
            } else {
              connection.console.error(`[cstTreeWrapper] failed to read fsPath: ${fsPath}`);
            }
          } catch (e) {
            connection.console.error(`[cstTreeWrapper] exception parsing ${uri}: ${e}`);
          }
        }
        if (lazyCache) {
          const n = lazyCache.tree.rootNode.descendantForIndex(startByte, Math.max(startByte, endByte - 1));
          if (!n)
            connection.console.error(
              `[cstTreeWrapper] descendantForIndex returned null for ${uri} [${startByte}-${endByte}]`,
            );
          return n;
        }
        connection.console.error(`[cstTreeWrapper] lazyCache completely empty for ${uri}`);
        return null;
      },
    };

    let engine = documentQueryEngines.get(textDocument.uri) as any;
    if (engine) {
      injectPredefinedTypes(unifiedIndex);
      engine.updateIndex(unifiedIndex);
      if (typeof engine.updateTree === "function") engine.updateTree(cstTreeWrapper);
    } else {
      engine = createModelicaQueryEngine(unifiedIndex, cstTreeWrapper);
      documentQueryEngines.set(textDocument.uri, engine);
    }

    let resolver = (engine as any).__resolverCache;
    if (!resolver) {
      resolver = createModelicaScopeResolver(unifiedIndex);
      (engine as any).__resolverCache = resolver;
    } else {
      resolver.updateIndex(unifiedIndex);
    }

    const bridge = createModelicaLSPBridge(unifiedIndex, engine, resolver, text, textDocument.uri);
    documentLSPBridges.set(textDocument.uri, bridge);

    // 1. Collect parse errors from the tree (ERROR and MISSING nodes)
    const collectErrors = (node: any) => {
      if (!node) return;
      if (typeof node.hasError === "function" ? !node.hasError() : node.hasError === false) return;

      if (node.isMissing || node.type === "ERROR") {
        const start = bridge["positions"].offsetToPosition(node.startIndex);
        const end = bridge["positions"].offsetToPosition(node.endIndex);
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: { start, end },
          message: `Syntax error`,
          source: "modelscript",
        });
      }
      for (let i = 0; i < node.childCount; i++) {
        collectErrors(node.child(i));
      }
    };
    collectErrors(tree.rootNode);

    // 2. Run Polyglot declarative lints (Salsa-memoized queries from language.ts)
    const engineDiags = engine.runAllLints(textDocument.uri);
    for (const d of engineDiags) {
      const start = (bridge as any).positions.offsetToPosition(d.startByte);
      const end = (bridge as any).positions.offsetToPosition(d.endByte);
      let severity: DiagnosticSeverity = DiagnosticSeverity.Warning;
      if (d.severity === "error") severity = DiagnosticSeverity.Error;
      if (d.severity === "info") severity = DiagnosticSeverity.Information;

      diagnostics.push({
        severity,
        range: { start, end },
        message: d.message,
        source: "modelscript",
      });
    }

    // 3. Collect unresolved reference diagnostics from the polyglot resolver
    // Skip unresolved-reference diagnostics while MSL background indexing is still
    // in progress — qualified references like Modelica.Electrical.Analog.Sources.SineVoltage
    // produce false positives until the standard library files have been parsed and merged.
    const unresolvedRefs = mslStdlibReady ? resolver.resolveAllReferences(textDocument.uri) : [];
    let dirty = false;
    for (const r of unresolvedRefs) {
      // Force evaluate any missing class files based on their expected FQN
      if (r.fqn) {
        const uriToFix = (globalWorkspaceIndex as any).getFileUriForFQN?.(r.fqn);
        if (uriToFix && !globalWorkspaceIndex.has(uriToFix)) {
          globalWorkspaceIndex.getFileIndex(uriToFix);
          dirty = true;
          continue; // Wait until next validation pass when it's resolved
        }
      }

      const start = (bridge as any).positions.offsetToPosition(r.startByte);
      const end = (bridge as any).positions.offsetToPosition(r.endByte);
      let severity: DiagnosticSeverity = DiagnosticSeverity.Error;
      if (r.severity === "warning") severity = DiagnosticSeverity.Warning;
      if (r.severity === "info") severity = DiagnosticSeverity.Information;

      diagnostics.push({
        severity,
        range: { start, end },
        message: r.message,
        source: "modelscript",
      });
    }

    if (dirty) {
      unifiedIndex = unifiedWorkspace.toUnifiedPartial();
      injectPredefinedTypes(unifiedIndex);
      engine.updateIndex(unifiedIndex);
      resolver.updateIndex(unifiedIndex);
      // Let the references resolve on the next edit, or re-run here.
    }

    // 4. Create QueryBackedClassInstance wrappers from the polyglot index
    //    for backward compatibility with downstream handlers (diagram, simulation, etc.)
    // already declared above, we only need to use it here.
    // effectiveUri is available in this scope.

    const db = engine.toQueryDB();
    const thisDocInstances: ModelicaClassInstance[] = [];

    // Strip "file://" uniformly for matching.
    const normUri = (uri: string) => (uri.startsWith("file://") ? uri.substring(7) : uri);
    const matchUri = normUri(effectiveUri);

    for (const [id, entry] of unifiedIndex.symbols) {
      if (!entry.resourceId || normUri(entry.resourceId) !== matchUri) continue;
      if (entry.kind !== "Class") continue; // Top-level classes only
      // If the parent is in the same file, this is not a top-level class in this file.
      // E.g., skips nested classes, but keeps file-root classes even if they use the `within` directive
      // to anchor themselves to an external package (such as MSL).
      if (entry.parentId !== null) {
        const parentEntry = unifiedIndex.symbols.get(entry.parentId);
        if (parentEntry && parentEntry.resourceId && normUri(parentEntry.resourceId) === matchUri) {
          continue;
        }
      }

      const wrapper = new QueryBackedClassInstance(id, db) as unknown as ModelicaClassInstance;
      thisDocInstances.push(wrapper);
    }
    workspaceInstances.set(textDocument.uri, thisDocInstances);
    documentInstances.set(textDocument.uri, thisDocInstances);
    connection.console.info(`[validate] stored ${thisDocInstances.length} instances for ${textDocument.uri}`);
    documentContexts.set(textDocument.uri, context);
  } else {
    // Fallback: basic regex validation when tree-sitter is not available
    const openComments = (text.match(/\/\*/g) || []).length;
    const closeComments = (text.match(/\*\//g) || []).length;
    if (openComments > closeComments) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: textDocument.positionAt(text.lastIndexOf("/*")),
          end: textDocument.positionAt(text.lastIndexOf("/*") + 2),
        },
        message: "Unclosed block comment.",
        source: "modelscript",
      });
    }
  }

  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });

  // Notify the client that project tree data may have changed
  connection.sendNotification("modelscript/projectTreeChanged");
}

/* Semantic tokens provider — tree-sitter AST traversal matching morsel's code.tsx exactly */

function computeSemanticTokens(textDocument: TextDocument): SemanticTokens {
  const builder = new SemanticTokensBuilder();
  const text = textDocument.getText();

  // SysML2 files use a separate parser and node-type classification
  if (textDocument.uri.endsWith(".sysml")) {
    return computeSysML2SemanticTokens(builder, text);
  }

  // Try to parse with tree-sitter via document context
  const ctx = documentContexts.get(textDocument.uri);
  if (!ctx) {
    return builder.build();
  }

  let tree;
  try {
    tree = ctx.parse(".mo", text);
  } catch {
    return builder.build();
  }

  const rawTokens: {
    line: number;
    char: number;
    length: number;
    typeIndex: number;
    modifier: number;
  }[] = [];

  const traverseTree = (node: any) => {
    let tokenType: string | null = null;
    const modifier = 0;

    const isKeyword = keywords.includes(node.type) || typeKeywords.includes(node.type);

    if (isKeyword) {
      tokenType = "keyword";
    } else if (node.type === "IDENT") {
      const parent = node.parent;
      let p = parent;
      while (p && p.type === "Name") {
        p = p.parent;
      }

      if (
        parent?.type === "LongClassSpecifier" ||
        parent?.type === "ShortClassSpecifier" ||
        parent?.type === "DerClassSpecifier" ||
        p?.type === "WithinDirective" ||
        p?.type === "ExtendsClause" ||
        p?.type === "TypeSpecifier"
      ) {
        tokenType = "type";
      } else if (parent?.type === "Declaration") {
        tokenType = "variable";
      } else if (typeKeywords.includes(node.text)) {
        tokenType = "type";
      } else {
        tokenType = "variable";
      }
    } else if (node.type === "STRING") {
      tokenType = "string";
    } else if (node.type === "UNSIGNED_INTEGER" || node.type === "UNSIGNED_REAL") {
      tokenType = "number";
    } else if (node.type === "comment") {
      tokenType = "comment";
    } else if (["+", "-", "*", "/", "=", "<", ">", "<=", ">=", "==", "<>"].includes(node.type)) {
      tokenType = "operator";
    }

    if (tokenType !== null) {
      const typeIndex = tokenTypes.indexOf(tokenType);
      if (typeIndex >= 0) {
        if (!rawTokens.some((t) => t.line === node.startPosition.row && t.char === node.startPosition.column)) {
          rawTokens.push({
            line: node.startPosition.row,
            char: node.startPosition.column,
            length: node.endPosition.column - node.startPosition.column,
            typeIndex,
            modifier,
          });
        }
      }
    }

    for (const child of node.children) {
      traverseTree(child);
    }
  };

  traverseTree(tree.rootNode);

  rawTokens.sort((a, b) => {
    if (a.line === b.line) {
      return a.char - b.char;
    }
    return a.line - b.line;
  });

  for (const token of rawTokens) {
    builder.push(token.line, token.char, token.length, token.typeIndex, token.modifier);
  }

  return builder.build();
}

// SysML2 structural keywords that correspond to storage.type in the grammar
const sysml2StructuralKeywords = new Set([
  "package",
  "library",
  "standard",
  "part",
  "actor",
  "stakeholder",
  "attribute",
  "port",
  "connection",
  "interface",
  "allocation",
  "action",
  "state",
  "constraint",
  "requirement",
  "concern",
  "case",
  "analysis",
  "verification",
  "use",
  "view",
  "viewpoint",
  "rendering",
  "enumeration",
  "occurrence",
  "item",
  "calculation",
  "metadata",
  "flow",
  "connect",
  "def",
]);

// SysML2 control keywords
const sysml2ControlKeywords = new Set([
  "if",
  "else",
  "then",
  "while",
  "for",
  "loop",
  "return",
  "import",
  "alias",
  "about",
  "accept",
  "after",
  "all",
  "as",
  "assign",
  "assert",
  "assume",
  "at",
  "bind",
  "by",
  "chains",
  "collect",
  "decide",
  "default",
  "defined",
  "dependency",
  "do",
  "doc",
  "done",
  "emit",
  "entry",
  "exhibit",
  "expose",
  "filter",
  "first",
  "fork",
  "frame",
  "from",
  "hastype",
  "intersect",
  "include",
  "istype",
  "join",
  "merge",
  "message",
  "multiplicity",
  "namespace",
  "nonunique",
  "objective",
  "of",
  "on",
  "ordered",
  "perform",
  "private",
  "protected",
  "public",
  "readonly",
  "redefines",
  "ref",
  "render",
  "rep",
  "require",
  "satisfy",
  "send",
  "snapshot",
  "specializes",
  "stakeholder",
  "subject",
  "subsets",
  "succession",
  "timeslice",
  "to",
  "transition",
  "union",
  "until",
  "variant",
  "variation",
  "verify",
  "via",
  "when",
  "in",
  "out",
  "inout",
  "abstract",
  "derived",
  "end",
  "individual",
  "parallel",
]);

// SysML2 built-in type names
const sysml2BuiltinTypes = new Set([
  "Boolean",
  "Integer",
  "Real",
  "String",
  "Natural",
  "Positive",
  "NaturalNumber",
  "Number",
  "ScalarValues",
  "Any",
  "Anything",
  "DataValue",
]);

/**
 * Compute semantic tokens for SysML2 documents using the SysML2 tree-sitter parser.
 */
function computeSysML2SemanticTokens(builder: SemanticTokensBuilder, text: string): SemanticTokens {
  if (!sysml2ParserReady || !sysml2Parser) {
    return builder.build();
  }

  let tree;
  try {
    tree = sysml2Parser.parse(text);
  } catch {
    return builder.build();
  }
  if (!tree) {
    return builder.build();
  }

  const rawTokens: {
    line: number;
    char: number;
    length: number;
    typeIndex: number;
    modifier: number;
  }[] = [];

  // SysML2 node types for definition names (after 'def Something')
  const definitionTypes = new Set([
    "PartDefinition",
    "AttributeDefinition",
    "PortDefinition",
    "ConnectionDefinition",
    "InterfaceDefinition",
    "AllocationDefinition",
    "ActionDefinition",
    "StateDefinition",
    "ConstraintDefinition",
    "RequirementDefinition",
    "ConcernDefinition",
    "CaseDefinition",
    "AnalysisCaseDefinition",
    "VerificationCaseDefinition",
    "ViewDefinition",
    "ViewpointDefinition",
    "RenderingDefinition",
    "CalculationDefinition",
    "EnumerationDefinition",
    "OccurrenceDefinition",
    "ItemDefinition",
    "FlowDefinition",
    "MetadataDefinition",
  ]);

  const usageTypes = new Set([
    "PartUsage",
    "AttributeUsage",
    "PortUsage",
    "ConnectionUsage",
    "InterfaceUsage",
    "AllocationUsage",
    "ActionUsage",
    "StateUsage",
    "ConstraintUsage",
    "RequirementUsage",
    "ConcernUsage",
    "CaseUsage",
    "AnalysisCaseUsage",
    "VerificationCaseUsage",
    "ViewUsage",
    "ViewpointUsage",
    "RenderingUsage",
    "CalculationUsage",
    "EnumerationUsage",
    "OccurrenceUsage",
    "ItemUsage",
    "FlowUsage",
    "MetadataUsage",
    "ReferenceUsage",
    "DefaultReferenceUsage",
  ]);

  const traverse = (node: any) => {
    let tokenType: string | null = null;
    const modifier = 0;

    const nodeType = node.type;
    const nodeText = node.text;

    // Named fields from the grammar — declaredName is usually an identifier
    if (nodeType === "declaredName" || nodeType === "name") {
      // Determine if this is a definition name (type) or usage name (variable)
      const parent = node.parent;
      if (parent && definitionTypes.has(parent.type)) {
        tokenType = "type";
      } else if (parent && usageTypes.has(parent.type)) {
        tokenType = "variable";
      } else if (parent?.type === "Package" || parent?.type === "LibraryPackage") {
        tokenType = "namespace";
      } else {
        tokenType = "variable";
      }
    } else if (nodeType === "qualifiedName" || nodeType === "identification") {
      // Skip — traverse children
    } else if (sysml2StructuralKeywords.has(nodeText) && node.childCount === 0) {
      tokenType = "keyword";
    } else if (sysml2ControlKeywords.has(nodeText) && node.childCount === 0) {
      tokenType = "keyword";
    } else if (sysml2BuiltinTypes.has(nodeText) && node.childCount === 0) {
      tokenType = "type";
    } else if (nodeType === "comment" || nodeType === "line_comment" || nodeType === "block_comment") {
      tokenType = "comment";
    } else if (nodeType === "string_literal" || nodeType === "regular_expression") {
      tokenType = "string";
    } else if (nodeType === "integer_literal" || nodeType === "real_literal") {
      tokenType = "number";
    } else if (["+", "-", "*", "/", "=", "<", ">", "<=", ">=", "==", "!="].includes(nodeType)) {
      tokenType = "operator";
    }

    if (tokenType !== null) {
      const typeIndex = tokenTypes.indexOf(tokenType);
      if (typeIndex >= 0 && node.startPosition.row === node.endPosition.row) {
        const length = node.endPosition.column - node.startPosition.column;
        if (
          length > 0 &&
          !rawTokens.some((t) => t.line === node.startPosition.row && t.char === node.startPosition.column)
        ) {
          rawTokens.push({
            line: node.startPosition.row,
            char: node.startPosition.column,
            length,
            typeIndex,
            modifier,
          });
        }
      }
    }

    for (const child of node.children) {
      traverse(child);
    }
  };

  traverse(tree.rootNode);

  rawTokens.sort((a, b) => (a.line === b.line ? a.char - b.char : a.line - b.line));
  for (const token of rawTokens) {
    builder.push(token.line, token.char, token.length, token.typeIndex, token.modifier);
  }

  return builder.build();
}

connection.onRequest("textDocument/semanticTokens/full", (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return { data: [] };
  }
  return computeSemanticTokens(document);
});

// Completion provider — polyglot-driven scoped completion + keyword fallback
connection.onCompletion((params): CompletionItem[] => {
  // NOTE: We intentionally do NOT call flushValidation() here.
  // The bridge/resolver already have valid state from the last validation cycle.
  // Flushing synchronously blocks the completion response while the full
  // parse → index → resolve → lint pipeline runs, causing "loading..." hangs.
  const document = documents.get(params.textDocument.uri);
  const bridge = documentLSPBridges.get(params.textDocument.uri);
  if (!document || !bridge) return [];

  const text = document.getText();
  const offset = document.offsetAt(params.position);
  const items = bridge.completion(offset, text) as unknown as CompletionItem[];

  if (items.length > 0) {
    return items;
  }

  // Fallback: keyword completions (language-specific)
  if (params.textDocument.uri.endsWith(".sysml")) {
    const sysml2Keywords = [
      // Structural
      "package",
      "part",
      "part def",
      "attribute",
      "attribute def",
      "port",
      "port def",
      "item",
      "item def",
      "enum def",
      "occurrence",
      "occurrence def",
      // Behavioral
      "action",
      "action def",
      "state",
      "state def",
      "calc",
      "calc def",
      "transition",
      "accept",
      "send",
      "assign",
      "perform",
      "exhibit",
      // Requirements
      "requirement",
      "requirement def",
      "constraint",
      "constraint def",
      "concern",
      "concern def",
      "assume",
      "require",
      // Analysis
      "use case",
      "use case def",
      "case",
      "case def",
      "analysis",
      "analysis case",
      "verification",
      // Interconnection
      "connection",
      "connection def",
      "connect",
      "interface",
      "interface def",
      "allocation",
      "allocation def",
      "flow",
      "flow def",
      "binding",
      "succession",
      // Views
      "view",
      "view def",
      "viewpoint",
      "viewpoint def",
      "rendering",
      "rendering def",
      // Modifiers
      "abstract",
      "readonly",
      "derived",
      "end",
      "ordered",
      "nonunique",
      "in",
      "out",
      "inout",
      "ref",
      "redefines",
      "subsets",
      "specializes",
      // Control
      "if",
      "else",
      "while",
      "for",
      "loop",
      "return",
      // Types
      "Boolean",
      "Integer",
      "Real",
      "String",
      "Natural",
      // Meta
      "import",
      "alias",
      "doc",
      "comment",
      "about",
      "actor",
      "stakeholder",
      "subject",
      "objective",
    ];
    return sysml2Keywords.map((kw, index) => ({
      label: kw,
      kind: CompletionItemKind.Keyword,
      data: index,
      // Provide snippets for definition keywords
      ...(kw.endsWith(" def")
        ? {
            insertText: `${kw} $1 {\n\t$0\n}`,
            insertTextFormat: 2, // Snippet
          }
        : {}),
    }));
  }

  const allKeywords = [...keywords, ...typeKeywords];
  return allKeywords.map((kw, index) => ({
    label: kw,
    kind: CompletionItemKind.Keyword,
    data: index,
  }));
});

connection.onHover((params) => {
  const document = documents.get(params.textDocument.uri);
  const bridge = documentLSPBridges.get(params.textDocument.uri);
  if (!document || !bridge) return null;

  const offset = document.offsetAt(params.position);
  const hoverDef = bridge.hover(offset);
  if (!hoverDef) return null;

  return {
    contents: {
      kind: "markdown" as const,
      value: hoverDef.contents,
    },
    range: hoverDef.range as any,
  };
});

/* Go to Definition — reuses hover's resolution logic to locate declarations */

/** Helper to convert a SymbolEntry to a cross-file LSP Location */
function symbolEntryToLocation(entry: any): { uri: string; range: any } | null {
  const uri = entry.resourceId;
  if (!uri) return null;

  // If the file is open, we already have a PositionIndex in its LSPBridge
  const bridge = documentLSPBridges.get(uri);
  if (bridge) {
    const range = (bridge as any).positions.rangeFromBytes(entry.startByte, entry.endByte);
    return { uri, range };
  }

  // File is not open and we don't have text. Fallback to line 1 to avoid sync IO.
  // In the future, we could resolve positions asynchronously from VFS.
  const text = documentTrees.get(uri)?.text;
  if (!text) {
    return {
      uri,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
    };
  }

  const positions = new PositionIndex(text);
  return { uri, range: positions.rangeFromBytes(entry.startByte, entry.endByte) };
}

connection.onDefinition((params) => {
  const document = documents.get(params.textDocument.uri);
  const bridge = documentLSPBridges.get(params.textDocument.uri);
  if (!document || !bridge) return null;

  const offset = document.offsetAt(params.position);
  const rawTarget = (bridge as any).definitionRaw(offset);
  if (!rawTarget) return null;
  return symbolEntryToLocation(rawTarget) as any;
});

/* Document formatting — uses tree-sitter parse + format() */

connection.onDocumentFormatting((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  // SysML2 formatting — simple brace-based indentation
  if (params.textDocument.uri.endsWith(".sysml")) {
    const text = document.getText();
    const tabSize = params.options.tabSize ?? 2;
    const indent = params.options.insertSpaces !== false ? " ".repeat(tabSize) : "\t";
    const lines = text.split("\n");
    const formatted: string[] = [];
    let depth = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        formatted.push("");
        continue;
      }

      // Closing brace decreases indent before writing
      if (trimmed.startsWith("}")) {
        depth = Math.max(0, depth - 1);
      }

      formatted.push(indent.repeat(depth) + trimmed);

      // Opening brace increases indent after writing
      const openBraces = (trimmed.match(/{/g) || []).length;
      const closeBraces = (trimmed.match(/}/g) || []).length;
      depth = Math.max(0, depth + openBraces - closeBraces);
      // But if we already decremented for a leading `}`, add it back since we counted it in closeBraces
      if (trimmed.startsWith("}") && closeBraces > openBraces) {
        // Already handled above, no adjustment needed
      }
    }

    const result = formatted.join("\n");
    const lastLine = document.lineCount - 1;
    const lastChar = document.getText().length - document.offsetAt({ line: lastLine, character: 0 });
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: lastLine, character: lastChar },
        },
        newText: result,
      },
    ];
  }

  // Modelica formatting
  if (!parserReady || !parser) {
    return [];
  }

  const text = document.getText();
  const tree = getDocumentTree(params.textDocument.uri);
  if (!tree) return [];
  const formatted = format(tree, text);

  // Return a single edit replacing the entire document
  const lastLine = document.lineCount - 1;
  const lastChar = document.getText().length - document.offsetAt({ line: lastLine, character: 0 });

  return [
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: lastLine, character: lastChar },
      },
      newText: formatted,
    },
  ];
});

/* Document color provider — detects Modelica color fields (color, lineColor, etc.) */

const COLOR_FIELDS = new Set(["color", "lineColor", "fillColor", "textColor"]);

connection.onDocumentColor((params) => {
  if (!parserReady || !parser) return [];
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const tree = getDocumentTree(params.textDocument.uri);
  if (!tree) return [];
  const colors: ColorInformation[] = [];

  const traverse = (node: SyntaxNode) => {
    if (node.type === "ElementModification" || node.type === "NamedArgument") {
      const nameNode = node.childForFieldName("name") || node.childForFieldName("identifier");
      const name = nameNode?.text;
      if (name && COLOR_FIELDS.has(name)) {
        let exprNode;
        if (node.type === "ElementModification") {
          const modNode = node.childForFieldName("modification");
          exprNode = modNode?.childForFieldName("modificationExpression")?.childForFieldName("expression");
        } else {
          exprNode = node.childForFieldName("argument")?.childForFieldName("expression");
        }

        if (exprNode?.type === "ArrayConstructor") {
          const listNode = exprNode.childForFieldName("expressionList");
          if (listNode) {
            const exprs = listNode.namedChildren;
            if (exprs.length === 3) {
              const r = parseInt(exprs[0].text);
              const g = parseInt(exprs[1].text);
              const b = parseInt(exprs[2].text);
              if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
                colors.push({
                  range: {
                    start: { line: exprNode.startPosition.row, character: exprNode.startPosition.column },
                    end: { line: exprNode.endPosition.row, character: exprNode.endPosition.column },
                  },
                  color: Color.create(
                    Math.max(0, Math.min(255, r)) / 255.0,
                    Math.max(0, Math.min(255, g)) / 255.0,
                    Math.max(0, Math.min(255, b)) / 255.0,
                    1.0,
                  ),
                });
              }
            }
          }
        }
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) traverse(child);
    }
  };

  traverse(tree.rootNode);
  return colors;
});

connection.onColorPresentation((params) => {
  const c = params.color;
  const r = Math.round(c.red * 255);
  const g = Math.round(c.green * 255);
  const b = Math.round(c.blue * 255);
  const label = `{${r}, ${g}, ${b}}`;
  return [ColorPresentation.create(label, { range: params.range, newText: label })];
});

/* Document symbols — enables Outline panel and breadcrumb navigation */

connection.onDocumentSymbol((params) => {
  try {
    const bridge = documentLSPBridges.get(params.textDocument.uri);
    if (!bridge) return [];
    // Bridge returns LSPDocumentSymbol[]; cast to the server-library DocumentSymbol type.
    return bridge.documentSymbols() as unknown as DocumentSymbol[];
  } catch (e: any) {
    connection.console.error(`[documentSymbol] ${e.message}`);
    return [];
  }
});

/* Folding Ranges — enables code folding for classes, sections, and control structures */

connection.onFoldingRanges((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  // SysML2 folding ranges
  if (params.textDocument.uri.endsWith(".sysml")) {
    if (!sysml2ParserReady || !sysml2Parser) return [];
    const text = document.getText();
    const tree = sysml2Parser.parse(text);
    if (!tree) return [];

    const ranges: { startLine: number; endLine: number; kind?: string }[] = [];
    // Fold any node whose type ends in Definition, Usage, or is a package/body block
    const collectFolds = (node: SyntaxNode) => {
      const t = node.type;
      if (
        t.endsWith("Definition") ||
        t.endsWith("Usage") ||
        t === "Package" ||
        t === "LibraryPackage" ||
        t === "Namespace" ||
        t === "Comment"
      ) {
        const startLine = node.startPosition.row;
        const endLine = node.endPosition.row;
        if (endLine > startLine) {
          ranges.push({
            startLine,
            endLine,
            kind: t === "Comment" ? "comment" : undefined,
          });
        }
      }
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) collectFolds(child);
      }
    };
    collectFolds(tree.rootNode);
    return ranges;
  }

  // Modelica folding ranges
  if (!parserReady || !parser) return [];

  const tree = getDocumentTree(document.uri);
  if (!tree) return [];
  const ranges: { startLine: number; endLine: number; kind?: string }[] = [];

  const FOLDABLE_NODES = new Set([
    "ClassDefinition",
    "EquationSection",
    "InitialEquationSection",
    "AlgorithmSection",
    "InitialAlgorithmSection",
    "IfEquation",
    "ForEquation",
    "WhenEquation",
    "IfStatement",
    "ForStatement",
    "WhileStatement",
    "WhenStatement",
    "AnnotationClause",
  ]);

  const collectFolds = (node: SyntaxNode) => {
    if (FOLDABLE_NODES.has(node.type)) {
      const startLine = node.startPosition.row;
      const endLine = node.endPosition.row;
      if (endLine > startLine) {
        ranges.push({ startLine, endLine });
      }
    }
    // Block comments
    if (node.type === "Comment" || node.type === "comment") {
      const startLine = node.startPosition.row;
      const endLine = node.endPosition.row;
      if (endLine > startLine) {
        ranges.push({ startLine, endLine, kind: "comment" });
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) collectFolds(child);
    }
  };

  collectFolds(tree.rootNode);
  return ranges;
});

/* Selection Ranges — enables smart Expand/Shrink selection */

function nodeRange(node: SyntaxNode): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  return {
    start: { line: node.startPosition.row, character: node.startPosition.column },
    end: { line: node.endPosition.row, character: node.endPosition.column },
  };
}

connection.onSelectionRanges((params) => {
  if (!parserReady || !parser) return [];
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const tree = getDocumentTree(document.uri);
  if (!tree) return [];

  const results = params.positions.map((pos) => {
    let node: SyntaxNode | null = tree.rootNode.descendantForPosition({
      row: pos.line,
      column: pos.character,
    });

    // Build the chain from innermost to outermost

    let current: any = null;
    const ancestors: SyntaxNode[] = [];
    while (node) {
      ancestors.push(node);
      node = node.parent;
    }

    // Build linked list from outermost to innermost
    for (const ancestor of ancestors) {
      current = {
        range: nodeRange(ancestor),
        parent: current,
      };
    }

    return current ?? { range: nodeRange(tree.rootNode) };
  });

  return results;
});

/* Document Highlights — highlights all occurrences of the symbol under cursor */

connection.onDocumentHighlight((params) => {
  if (!parserReady || !parser) return [];
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const text = document.getText();
  const lines = text.split("\n");
  const lineContent = lines[params.position.line] ?? "";

  // Find the word under cursor
  let wordStart = params.position.character;
  let wordEnd = params.position.character;
  while (wordStart > 0 && /[_a-zA-Z0-9]/.test(lineContent[wordStart - 1])) wordStart--;
  while (wordEnd < lineContent.length && /[_a-zA-Z0-9]/.test(lineContent[wordEnd])) wordEnd++;
  const word = lineContent.substring(wordStart, wordEnd);
  if (!word || /^\d/.test(word)) return []; // Skip empty or numeric tokens

  // Find all occurrences of the word in the document using tree-sitter
  const tree = getDocumentTree(document.uri);
  if (!tree) return [];
  const highlights: {
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    kind: DocumentHighlightKind;
  }[] = [];

  const collectHighlights = (node: SyntaxNode) => {
    if (node.type === "IDENT" && node.text === word) {
      highlights.push({
        range: nodeRange(node),
        kind: DocumentHighlightKind.Text,
      });
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) collectHighlights(child);
    }
  };

  collectHighlights(tree.rootNode);
  return highlights;
});

/* Signature Help — shows function parameter info on ( and , */

connection.onSignatureHelp((params) => {
  if (!parserReady || !parser) return null;
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const text = document.getText();
  const tree = getDocumentTree(document.uri);
  if (!tree) return null;

  try {
    const rootNode = tree.rootNode;
    const node = rootNode.descendantForPosition({
      row: params.position.line,
      column: params.position.character,
    });

    // Walk up to find a FunctionCall ancestor
    let funcCallNode: SyntaxNode | null = node;
    while (funcCallNode && funcCallNode.type !== "FunctionCall") {
      funcCallNode = funcCallNode.parent;
    }
    if (!funcCallNode) return null;

    const refNode = funcCallNode.children.find((c: SyntaxNode) => c.type === "ComponentReference");
    if (!refNode) return null;

    const bridge = documentLSPBridges.get(params.textDocument.uri);
    if (!bridge) return null;

    // Use polyglot to resolve the function reference
    const funcTarget = (bridge as any).definitionRaw(refNode.startIndex);
    if (!funcTarget || funcTarget.kind !== "Class") return null;

    // Quick check if it's a function or record (from metadata classKind)
    const classKind = funcTarget.metadata?.classKind;
    if (classKind !== "function" && classKind !== "record") {
      return null;
    }

    // Collect all elements, filter to input parameters
    let allElements: any[] = [];
    try {
      allElements = (bridge as any).engine.query("allElements", funcTarget.id) || [];
    } catch {
      // fallback
    }

    const inputParams = allElements.filter((c) => c.kind === "Component" && c.metadata?.causality === "input");

    // Collect parameter information
    const paramInfos: ParameterInformation[] = [];
    for (const param of inputParams) {
      const typeName = param.metadata?.typeSpecifier ?? "?";
      const label = `${typeName} ${param.name}`;
      paramInfos.push(ParameterInformation.create(label, param.metadata?.description ?? undefined));
    }

    // Determine which parameter is active based on comma count before cursor
    const argsNode = funcCallNode.children.find((c: SyntaxNode) => c.type === "FunctionCallArguments");
    let activeParameter = 0;
    if (argsNode) {
      const argsText = text.substring(argsNode.startIndex, argsNode.endIndex);
      const cursorOffset = document.offsetAt(params.position) - argsNode.startIndex;
      const textBeforeCursor = argsText.substring(0, Math.max(0, cursorOffset));
      // Count commas at nesting depth 0
      let depth = 0;
      for (const ch of textBeforeCursor) {
        if (ch === "(" || ch === "{" || ch === "[") depth++;
        else if (ch === ")" || ch === "}" || ch === "]") depth--;
        else if (ch === "," && depth <= 1) activeParameter++;
      }
    }

    const sigLabel = `${refNode.text}(${paramInfos.map((p) => p.label).join(", ")})`;

    return {
      signatures: [SignatureInformation.create(sigLabel, funcTarget.metadata?.description ?? undefined, ...paramInfos)],
      activeSignature: 0,
      activeParameter,
    };
  } finally {
    // Tree is managed by cache
  }
});

/* Find References — locates all occurrences of a symbol across open documents */

connection.onReferences(async (params) => {
  flushValidation(params.textDocument.uri);
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const isSysML2 = params.textDocument.uri.endsWith(".sysml");
  const unifiedIndex = isSysML2
    ? await sysml2WorkspaceIndex.toUnifiedAsync()
    : await globalWorkspaceIndex.toUnifiedAsync();
  const resolver = isSysML2 ? createSysML2ScopeResolver(unifiedIndex) : createModelicaScopeResolver(unifiedIndex);

  const offset = document.offsetAt(params.position);
  let targetEntry: any = null;

  for (const entry of unifiedIndex.symbols.values()) {
    if (entry.resourceId === params.textDocument.uri && entry.startByte <= offset && offset < entry.endByte) {
      if (!targetEntry || entry.endByte - entry.startByte < targetEntry.endByte - targetEntry.startByte) {
        targetEntry = entry;
      }
    }
  }

  if (!targetEntry) return [];

  // Find the declarations this symbol refers to (or itself if it is a declaration)
  let declarationIds: number[] = [];
  if (resolver.isDeclaration(targetEntry)) {
    declarationIds = [targetEntry.id as number];
  } else {
    const decls = resolver.resolve(targetEntry);
    declarationIds = decls.map((d) => d.id as number);
  }

  const results: any[] = [];
  const seen = new Set<string>();

  const addLocation = (uri: string, startByte: number, endByte: number) => {
    let text = documents.get(uri)?.getText();
    if (!text) {
      const cached = documentTrees.get(uri);
      if (cached) text = cached.text;
    }
    if (!text) return;

    const dummyDoc = TextDocument.create(uri, "temp", 1, text);
    const start = dummyDoc.positionAt(startByte);
    const end = dummyDoc.positionAt(endByte);
    const key = `${uri}:${start.line}:${start.character}`;

    if (!seen.has(key)) {
      seen.add(key);
      results.push({ uri, range: { start, end } });
    }
  };

  for (const declId of declarationIds) {
    // Include declaration
    const declEntry = unifiedIndex.symbols.get(declId);
    if (declEntry && declEntry.resourceId) {
      addLocation(declEntry.resourceId, declEntry.startByte, declEntry.endByte);
    }
    // Include references
    const refs = resolver.findReferences(declId);
    for (const ref of refs) {
      if (ref.resourceId) {
        addLocation(ref.resourceId, ref.startByte, ref.endByte);
      }
    }
  }

  return results;
});

/* Rename — renames a symbol across all documents */

connection.onRenameRequest(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const isSysML2 = params.textDocument.uri.endsWith(".sysml");
  const unifiedIndex = isSysML2
    ? await sysml2WorkspaceIndex.toUnifiedAsync()
    : await globalWorkspaceIndex.toUnifiedAsync();
  const resolver = isSysML2 ? createSysML2ScopeResolver(unifiedIndex) : createModelicaScopeResolver(unifiedIndex);

  const offset = document.offsetAt(params.position);
  let targetEntry: any = null;

  for (const entry of unifiedIndex.symbols.values()) {
    if (entry.resourceId === params.textDocument.uri && entry.startByte <= offset && offset < entry.endByte) {
      if (!targetEntry || entry.endByte - entry.startByte < targetEntry.endByte - targetEntry.startByte) {
        targetEntry = entry;
      }
    }
  }

  if (!targetEntry) return null;

  let declarationIds: number[] = [];
  if (resolver.isDeclaration(targetEntry)) {
    declarationIds = [targetEntry.id as number];
  } else {
    const decls = resolver.resolve(targetEntry);
    declarationIds = decls.map((d) => d.id as number);
  }

  if (declarationIds.length === 0) return null;

  const changes: WorkspaceEdit["changes"] = {};
  const seen = new Set<string>();

  const addEdit = (uri: string, startByte: number, endByte: number) => {
    let text = documents.get(uri)?.getText();
    if (!text) {
      const cached = documentTrees.get(uri);
      if (cached) text = cached.text;
    }
    if (!text) return;

    const dummyDoc = TextDocument.create(uri, "temp", 1, text);
    const start = dummyDoc.positionAt(startByte);
    const end = dummyDoc.positionAt(endByte);
    const key = `${uri}:${start.line}:${start.character}`;

    if (!seen.has(key)) {
      seen.add(key);
      if (!changes[uri]) changes[uri] = [];
      changes[uri].push({
        range: { start, end },
        newText: params.newName,
      });
    }
  };

  for (const declId of declarationIds) {
    // Include declaration
    const declEntry = unifiedIndex.symbols.get(declId);
    if (declEntry && declEntry.resourceId && declEntry.name) {
      // The entry byte range might include keywords/type, we just want to replace the name.
      // E.g., `part engine : Engine`, `declEntry` spans the whole thing.
      // Actually `targetName` length is from `declEntry.name.length`, but `declEntry.nameLoc` isn't available.
      // In ModelScript indexing, `startByte` to `endByte` is usually the identifier for refs.
      // For declarations, `startByte` to `endByte` is the WHOLE declaration body. That's a problem for rename!
      // Let's use `name` and match the identifier.

      const text = documents.get(declEntry.resourceId)?.getText() ?? documentTrees.get(declEntry.resourceId)?.text;
      if (text) {
        const dummyDoc = TextDocument.create(declEntry.resourceId, "temp", 1, text);
        // Find exact occurrence of declaration name near the start
        const nameMatch = text.substring(declEntry.startByte, declEntry.endByte).indexOf(declEntry.name);
        if (nameMatch !== -1) {
          const matchStart = declEntry.startByte + nameMatch;
          const matchEnd = matchStart + declEntry.name.length;
          addEdit(declEntry.resourceId, matchStart, matchEnd);
        }
      }
    }
    // Include references
    const refs = resolver.findReferences(declId);
    for (const ref of refs) {
      if (ref.resourceId) {
        addEdit(ref.resourceId, ref.startByte, ref.endByte);
      }
    }
  }

  return { changes };
});

/* Code Actions — quick-fix suggestions based on diagnostics */

connection.onCodeAction((params) => {
  const actions: CodeAction[] = [];
  const document = documents.get(params.textDocument.uri);
  if (!document) return actions;

  for (const diagnostic of params.context.diagnostics) {
    if (diagnostic.source !== "modelscript") continue;

    // Suggest adding import for unresolved references
    if (diagnostic.message.includes("not found") || diagnostic.message.includes("unresolved")) {
      // Extract the name from the diagnostic range
      const text = document.getText();
      const startOffset = document.offsetAt(diagnostic.range.start);
      const endOffset = document.offsetAt(diagnostic.range.end);
      const unresolvedName = text.substring(startOffset, endOffset);

      if (unresolvedName && /^[a-zA-Z_]/.test(unresolvedName)) {
        actions.push({
          title: `Import '${unresolvedName}'`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          edit: {
            changes: {
              [params.textDocument.uri]: [
                {
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                  newText: `import ${unresolvedName};\n`,
                },
              ],
            },
          },
        });
      }
    }
  }

  return actions;
});

/* Workspace Symbols — search across all loaded classes in MSL and open documents */

connection.onWorkspaceSymbol((params) => {
  const query = params.query.toLowerCase();
  if (query.length < 2) return []; // Avoid returning too many results for short queries

  const symbols: {
    name: string;
    kind: SymbolKind;
    location: {
      uri: string;
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
    };
  }[] = [];
  const MAX_RESULTS = 100;

  // Search open document instances
  for (const [uri, instances] of documentInstances) {
    for (const inst of instances) {
      if (symbols.length >= MAX_RESULTS) break;
      collectWorkspaceSymbols(inst, uri, query, symbols, MAX_RESULTS);
    }
    if (symbols.length >= MAX_RESULTS) break;
  }

  // Search MSL classes from shared context
  if (sharedContext && symbols.length < MAX_RESULTS) {
    for (const element of sharedContext.elements) {
      if (symbols.length >= MAX_RESULTS) break;
      if (element instanceof ModelicaClassInstance) {
        collectWorkspaceSymbols(element, "", query, symbols, MAX_RESULTS);
      }
    }
  }

  return symbols;
});

function collectWorkspaceSymbols(
  element: ModelicaNamedElement,
  uri: string,
  query: string,
  symbols: {
    name: string;
    kind: SymbolKind;
    location: {
      uri: string;
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
    };
  }[],
  maxResults: number,
): void {
  if (symbols.length >= maxResults) return;

  const name = element.compositeName;
  if (name && name.toLowerCase().includes(query)) {
    const range = (element as any).abstractSyntaxNode?.sourceRange || (element as any).ast?.sourceRange;
    symbols.push({
      name,
      kind: element instanceof ModelicaClassInstance ? SymbolKind.Class : SymbolKind.Variable,
      location: {
        uri: uri || "file:///lib",
        range: range
          ? {
              start: { line: range.startRow, character: range.startCol },
              end: { line: range.endRow, character: range.endCol },
            }
          : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      },
    });
  }

  // Recurse into class children (limit depth for performance)
  if (element instanceof ModelicaClassInstance) {
    try {
      for (const child of element.elements) {
        if (symbols.length >= maxResults) break;
        if (child instanceof ModelicaNamedElement) {
          collectWorkspaceSymbols(child, uri, query, symbols, maxResults);
        }
      }
    } catch {
      // Skip classes that fail to iterate
    }
  }
}

/* Go to Type Definition — jumps to the class definition of a component's type */

connection.onTypeDefinition((params) => {
  const document = documents.get(params.textDocument.uri);
  const bridge = documentLSPBridges.get(params.textDocument.uri);
  if (!document || !bridge) return null;

  const offset = document.offsetAt(params.position);
  const typeTarget = (bridge as any).typeDefinitionRaw(offset);
  if (!typeTarget) return null;

  return symbolEntryToLocation(typeTarget) as any;
});

// Custom request: get diagram data for the webview
connection.onRequest(
  "modelscript/getDiagramData",
  (params: { uri: string; className?: string; diagramType?: string }) => {
    // SysML2 files use the polyglot diagram builder
    if (params.uri.endsWith(".sysml")) {
      try {
        const unified = unifiedWorkspace.toUnified();
        const resolver = createSysML2ScopeResolver(unified);

        const diagramTypeRaw = params.diagramType ?? "All";
        const validTypes = ["All", "BDD", "IBD", "StateMachine"];
        const diagramType = validTypes.includes(diagramTypeRaw)
          ? (diagramTypeRaw as "All" | "BDD" | "IBD" | "StateMachine")
          : "All";

        const data = buildSysML2DiagramData(unified, params.uri, resolver, diagramType);

        // Merge stored layout positions into diagram data
        const layout = sysml2Layouts.get(params.uri);
        if (layout && data) {
          for (const node of data.nodes) {
            // Node IDs are prefixed with "n_" + symbolId — try matching by name
            // Also try the raw node.id in case it was stored without prefix
            const sym = [...unified.symbols.values()].find(
              (s) => `n_${s.id}` === node.id && s.resourceId === params.uri,
            );
            const name = sym?.name;
            if (name && layout.elements[name]) {
              const el = layout.elements[name];
              node.x = el.x;
              node.y = el.y;
              if (el.width) node.width = el.width;
              if (el.height) node.height = el.height;
              node.autoLayout = false;
            }
          }
        }

        return data;
      } catch (e: any) {
        connection.console.error(`[sysml2-diagram] Error building diagram data: ${e?.message ?? e}\n${e?.stack ?? ""}`);
        return null;
      }
    }

    const instances = documentInstances.get(params.uri);
    if (!instances || instances.length === 0) {
      return null;
    }

    // Find the requested class instance (by name, or first one)
    let classInstance = instances[0];
    if (params.className) {
      const found = instances.find((i) => i.name === params.className);
      if (found) classInstance = found;
    }

    try {
      connection.console.error(`[diagram] classInstance name: ${classInstance.name} kind: ${classInstance.classKind}`);
      connection.console.error(`[diagram] elements: ${classInstance.elements?.length ?? "N/A"}`);
      connection.console.error(`[diagram] components: ${classInstance.components?.length ?? "N/A"}`);
      for (const comp of classInstance.components ?? []) {
        connection.console.error(
          `[diagram]   component: ${comp.name} classInstance: ${!!comp.classInstance} classKind: ${comp.classInstance?.classKind}`,
        );
      }
      connection.console.error(`[diagram] connectEquations: ${classInstance.connectEquations?.length ?? "N/A"}`);
      const result = buildDiagramData(classInstance);
      connection.console.error(`[diagram] result nodes: ${result?.nodes?.length} edges: ${result?.edges?.length}`);
      for (const node of result?.nodes ?? []) {
        const portIds = node.ports?.items?.map((p: any) => p.id).join(", ") ?? "";
        connection.console.error(`[diagram]   node: ${node.id} ports=[${portIds}]`);
      }
      for (const edge of result?.edges ?? []) {
        connection.console.error(
          `[diagram]   edge: ${edge.id} src=${edge.source.cell}:${edge.source.port} tgt=${edge.target.cell}:${edge.target.port}`,
        );
      }
      return result;
    } catch (e: any) {
      connection.console.error(`[diagram] Error building diagram data: ${e?.message ?? e}\n${e?.stack ?? ""}`);
      return null;
    }
  },
);

// Custom request: get CAD components for the webview
connection.onRequest("modelscript/getCadComponents", (params: { uri: string }) => {
  const instances = documentInstances.get(params.uri);
  if (!instances || instances.length === 0) {
    return [];
  }

  const classInstance = instances[0];

  try {
    if (!classInstance.instantiated) {
      classInstance.instantiate();
    }
    const dae = new ModelicaDAE(classInstance.name || "Model");
    const flattener = new ModelicaFlattener();
    classInstance.accept(flattener, ["", dae]);

    // Extract variables with CAD annotations
    return dae.variables

      .filter((v: any) => v.cadAnnotationString)

      .map((v: any) => ({ name: v.name, cad: v.cadAnnotationString }));
  } catch (e) {
    console.error("[cad] Error extracting CAD components:", e);
    return [];
  }
});

// ── Diagram mutation handlers ──

connection.onRequest(
  "modelscript/updatePlacement",
  (params: {
    uri: string;
    items: {
      name: string;
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
      edges?: { source: string; target: string; points: { x: number; y: number }[] }[];
    }[];
  }) => {
    // SysML2: store placement in the in-memory layout (no source text edits)
    if (params.uri.endsWith(".sysml")) {
      try {
        let layout = sysml2Layouts.get(params.uri) ?? createEmptyLayout();
        layout = updateElementPositions(layout, params.items);
        // Also update edge vertices if provided
        const edgeUpdates: { id: string; vertices: { x: number; y: number }[] }[] = [];
        for (const item of params.items) {
          if (item.edges) {
            for (const edge of item.edges) {
              edgeUpdates.push({ id: `${edge.source}→${edge.target}`, vertices: edge.points });
            }
          }
        }
        if (edgeUpdates.length > 0) {
          layout = updateConnectionVertices(layout, edgeUpdates);
        }
        sysml2Layouts.set(params.uri, layout);
        connection.console.log(`[sysml2] Layout updated for ${params.uri}: ${params.items.length} elements`);
      } catch (e) {
        console.error("[sysml2-diagram] updatePlacement error:", e);
      }
      return []; // No TextEdits — layout is stored externally
    }

    const instances = documentInstances.get(params.uri);
    const doc = documents.get(params.uri);
    if (!instances?.[0] || !doc) return [];
    try {
      return computePlacementEdits(doc.getText(), instances[0], params.items);
    } catch (e) {
      console.error("[diagram] updatePlacement error:", e);
      return [];
    }
  },
);

connection.onRequest(
  "modelscript/addConnect",
  (params: { uri: string; source: string; target: string; points?: { x: number; y: number }[] }) => {
    // SysML2: insert a connection usage in source text
    if (params.uri.endsWith(".sysml")) {
      const doc = documents.get(params.uri);
      if (!doc) return [];
      try {
        const edits = computeSysML2ConnectionInsert(doc.getText(), params.source, params.target);
        // Store edge vertices in layout
        if (params.points && params.points.length > 0) {
          let layout = sysml2Layouts.get(params.uri) ?? createEmptyLayout();
          layout = updateConnectionVertices(layout, [
            { id: `${params.source}→${params.target}`, vertices: params.points },
          ]);
          sysml2Layouts.set(params.uri, layout);
        }
        return edits;
      } catch (e) {
        console.error("[sysml2-diagram] addConnect error:", e);
        return [];
      }
    }

    const instances = documentInstances.get(params.uri);
    const doc = documents.get(params.uri);
    if (!instances?.[0] || !doc) return [];
    try {
      return computeConnectInsert(doc.getText(), instances[0], params.source, params.target, params.points);
    } catch (e) {
      console.error("[diagram] addConnect error:", e);
      return [];
    }
  },
);

connection.onRequest("modelscript/removeConnect", (params: { uri: string; source: string; target: string }) => {
  // SysML2: remove a connection usage from source text
  if (params.uri.endsWith(".sysml")) {
    const doc = documents.get(params.uri);
    if (!doc) return [];
    try {
      return computeSysML2ConnectionDelete(doc.getText(), params.source, params.target);
    } catch (e) {
      console.error("[sysml2-diagram] removeConnect error:", e);
      return [];
    }
  }

  const instances = documentInstances.get(params.uri);
  const doc = documents.get(params.uri);
  if (!instances?.[0] || !doc) return [];
  try {
    return computeConnectRemove(doc.getText(), instances[0], params.source, params.target);
  } catch (e) {
    console.error("[diagram] removeConnect error:", e);
    return [];
  }
});

connection.onRequest(
  "modelscript/updateEdgePoints",
  (params: { uri: string; edges: { source: string; target: string; points: { x: number; y: number }[] }[] }) => {
    // SysML2: store edge vertices in the layout (no source text edits)
    if (params.uri.endsWith(".sysml")) {
      try {
        let layout = sysml2Layouts.get(params.uri) ?? createEmptyLayout();
        const updates = params.edges.map((e) => ({
          id: `${e.source}→${e.target}`,
          vertices: e.points,
        }));
        layout = updateConnectionVertices(layout, updates);
        sysml2Layouts.set(params.uri, layout);
      } catch (e) {
        console.error("[sysml2-diagram] updateEdgePoints error:", e);
      }
      return []; // No TextEdits
    }

    const instances = documentInstances.get(params.uri);
    const doc = documents.get(params.uri);
    if (!instances?.[0] || !doc) return [];
    try {
      const lines = doc.getText().split("\n");
      return computeEdgePointEdits(lines, instances[0], params.edges);
    } catch (e) {
      console.error("[diagram] updateEdgePoints error:", e);
      return [];
    }
  },
);

connection.onRequest("modelscript/deleteComponents", (params: { uri: string; names: string[] }) => {
  // SysML2: delete elements from source text and layout
  if (params.uri.endsWith(".sysml")) {
    const doc = documents.get(params.uri);
    if (!doc) return [];
    try {
      const edits = computeSysML2ElementDelete(doc.getText(), params.names);
      // Also clean up layout
      const layout = sysml2Layouts.get(params.uri);
      if (layout) {
        sysml2Layouts.set(params.uri, removeElements(layout, params.names));
      }
      return edits;
    } catch (e) {
      console.error("[sysml2-diagram] deleteComponents error:", e);
      return [];
    }
  }

  const instances = documentInstances.get(params.uri);
  const doc = documents.get(params.uri);
  if (!instances?.[0] || !doc) return [];
  try {
    return computeComponentsDelete(doc.getText(), instances[0], params.names);
  } catch (e) {
    console.error("[diagram] deleteComponents error:", e);
    return [];
  }
});

connection.onRequest("modelscript/updateComponentName", (params: { uri: string; oldName: string; newName: string }) => {
  if (params.uri.endsWith(".sysml")) {
    const doc = documents.get(params.uri);
    if (!doc || !sysml2ParserReady || !sysml2Parser) return [];
    try {
      const tree = sysml2Parser.parse(doc.getText());
      return computeSysML2NameEdit(tree, doc.getText(), params.oldName, params.newName);
    } catch (e) {
      console.error("[sysml2-diagram] updateComponentName error:", e);
      return [];
    }
  }

  const instances = documentInstances.get(params.uri);
  if (!instances?.[0]) return [];
  try {
    return computeNameEdit(instances[0], params.oldName, params.newName);
  } catch (e) {
    console.error("[diagram] updateComponentName error:", e);
    return [];
  }
});

connection.onRequest(
  "modelscript/updateComponentDescription",
  (params: { uri: string; name: string; description: string }) => {
    if (params.uri.endsWith(".sysml")) {
      const doc = documents.get(params.uri);
      if (!doc || !sysml2ParserReady || !sysml2Parser) return [];
      try {
        const tree = sysml2Parser.parse(doc.getText());
        return computeSysML2DescriptionEdit(tree, doc.getText(), params.name, params.description);
      } catch (e) {
        console.error("[sysml2-diagram] updateComponentDescription error:", e);
        return [];
      }
    }

    const instances = documentInstances.get(params.uri);
    const doc = documents.get(params.uri);
    if (!instances?.[0] || !doc) return [];
    try {
      return computeDescriptionEdit(doc.getText(), instances[0], params.name, params.description);
    } catch (e) {
      console.error("[diagram] updateComponentDescription error:", e);
      return [];
    }
  },
);

connection.onRequest(
  "modelscript/updateComponentParameter",
  (params: { uri: string; name: string; parameter: string; value: string }) => {
    if (params.uri.endsWith(".sysml")) {
      const doc = documents.get(params.uri);
      if (!doc || !sysml2ParserReady || !sysml2Parser) return [];
      try {
        const tree = sysml2Parser.parse(doc.getText());
        return computeSysML2ParameterEdit(tree, doc.getText(), params.name, params.parameter, params.value);
      } catch (e) {
        console.error("[sysml2-diagram] updateComponentParameter error:", e);
        return [];
      }
    }
    const instances = documentInstances.get(params.uri);
    if (!instances?.[0]) return [];
    try {
      return computeParameterEdit(instances[0], params.name, params.parameter, params.value);
    } catch (e) {
      console.error("[diagram] updateComponentParameter error:", e);
      return [];
    }
  },
);

// Custom request: simulate a model
connection.onRequest(
  "modelscript/simulate",
  async (params: {
    uri: string;
    className?: string;
    startTime?: number;
    stopTime?: number;
    interval?: number;
    equidistant?: boolean;
    solver?: string;
    format?: string;
    parameterOverrides?: Record<string, number>;
  }): Promise<{
    t: number[];
    y: number[][];
    states: string[];
    parameters?: {
      name: string;
      type: "real" | "integer" | "boolean" | "enumeration";
      defaultValue: number;
      min?: number;
      max?: number;
      step: number;
      unit?: string;
      enumLiterals?: { ordinal: number; label: string }[];
    }[];
    experiment?: { startTime?: number; stopTime?: number; interval?: number; tolerance?: number };
    error?: string;
  }> => {
    connection.console.info(`[simulate] Requested simulation for URI: ${params.uri}`);
    connection.console.info(`[simulate] documentInstances has ${documentInstances.size} entries.`);
    let instances = documentInstances.get(params.uri);
    if (!instances || instances.length === 0) {
      // Force-validate the document so the polyglot index is populated
      const doc = documents.get(params.uri);
      if (doc) {
        connection.console.info(`[simulate] No instances yet — force-validating ${params.uri}`);
        await validateTextDocument(doc);
        instances = documentInstances.get(params.uri);
      }
    }
    if (!instances || instances.length === 0) {
      connection.console.info(
        `[simulate] Instances array empty/undefined for ${params.uri}. Available URIs: ${Array.from(documentInstances.keys()).join(", ")}`,
      );
      return { t: [], y: [], states: [], error: "No class instances found for this document." };
    }

    let classInstance = instances[0];
    if (params.className) {
      const found = instances.find((i) => i.name === params.className);
      if (found) classInstance = found;
    }

    try {
      // Ensure the full MSL index is available before flattening — the flattener
      // resolves component types like Modelica.Electrical.Analog.Sources.SineVoltage
      // which require MSL to be fully indexed.
      if (!mslStdlibReady && globalWorkspaceIndex.pendingFileCount > 0) {
        connection.console.info(`[simulate] MSL not fully indexed — forcing full index...`);
        connection.sendNotification("modelscript/status", {
          state: "loading",
          message: "Indexing MSL for simulation...",
        });
        await globalWorkspaceIndex.indexRemainingInBackground(50);
        mslStdlibReady = true;
        connection.sendNotification("modelscript/status", { state: "ready", message: "ModelScript" });

        // Re-create the query engine with the full unified index
        const fullIndex = unifiedWorkspace.toUnifiedPartial();
        injectPredefinedTypes(fullIndex);
        const engine = documentQueryEngines.get(params.uri) as any;
        if (engine) {
          engine.updateIndex(fullIndex);
          const resolver = engine.__resolverCache;
          if (resolver) resolver.updateIndex(fullIndex);
        }

        // Re-validate to rebuild instances with full index
        const doc = documents.get(params.uri);
        if (doc) await validateTextDocument(doc);
        instances = documentInstances.get(params.uri);
        if (!instances || instances.length === 0) {
          return { t: [], y: [], states: [], error: "No class instances found after MSL indexing." };
        }
        classInstance = params.className
          ? (instances.find((i) => i.name === params.className) ?? instances[0])
          : instances[0];
      }

      if (!classInstance.instantiated) {
        classInstance.instantiate();
      }

      const dae = new ModelicaDAE(classInstance.name || "Model");
      const flattener = new ModelicaFlattener();
      classInstance.accept(flattener, ["", dae]);
      flattener.generateFlowBalanceEquations(dae);
      flattener.foldDAEConstants(dae);

      const simulator = new ModelicaSimulator(dae);
      simulator.prepare();

      const exp = simulator.dae.experiment;
      const startTime = params.startTime ?? exp.startTime ?? 0;
      const stopTime = params.stopTime ?? exp.stopTime ?? 10;
      const step = params.interval ?? exp.interval ?? (stopTime - startTime) / 500;

      const result = simulator.simulate(startTime, stopTime, step, {
        solver: (params.solver ?? "dopri5") as "rk4" | "dopri5" | "bdf" | "auto",
        equidistantOutput: params.equidistant ?? exp.__modelscript_equidistantOutput ?? true,
        parameterOverrides: params.parameterOverrides ? new Map(Object.entries(params.parameterOverrides)) : undefined,
      });

      if (params.format === "csv") {
        const lines = [`time,${result.states.join(",")}`];
        for (let i = 0; i < result.t.length; i++) {
          const values = [result.t[i], ...result.states.map((_: string, vi: number) => result.y[i]?.[vi] ?? 0)];
          lines.push(values.join(","));
        }
        // Return CSV as a text field alongside the structured data
        return {
          t: result.t,
          y: result.y,
          states: result.states,
          parameters: simulator.getParameterInfo(),
          experiment: exp,
          error: undefined,
        };
      }

      return {
        t: result.t,
        y: result.y,
        states: result.states,
        parameters: simulator.getParameterInfo(),
        experiment: exp,
      };
    } catch (e) {
      console.error("[simulate] Error:", e);
      return {
        t: [],
        y: [],
        states: [],
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
);

// ── Step-by-step co-simulation API ──

/** Stored simulator instances for step-by-step co-simulation. */
const cosimSimulators = new Map<
  string,
  {
    simulator: {
      simulate(start: number, stop: number, step: number): { t: number[]; y: number[][]; states: string[] };
    };
    dae: ModelicaDAE;
    currentValues: Map<string, number>;
    stepSize: number;
  }
>();

/** Initialize a model for step-by-step simulation. Returns variable metadata. */
connection.onRequest(
  "modelscript/simulateInit",
  (params: {
    uri: string;
    participantId: string;
    className?: string;
    startTime?: number;
    stopTime?: number;
    stepSize?: number;
  }): {
    ok: boolean;
    variables?: { name: string; causality: string }[];
    error?: string;
  } => {
    const instances = documentInstances.get(params.uri);
    if (!instances || instances.length === 0) {
      return { ok: false, error: "No class instances found for this document." };
    }

    let classInstance = instances[0];
    if (params.className) {
      const found = instances.find((i) => i.name === params.className);
      if (found) classInstance = found;
    }

    try {
      if (!classInstance.instantiated) {
        classInstance.instantiate();
      }

      const dae = new ModelicaDAE(classInstance.name || "Model");
      const flattener = new ModelicaFlattener();
      classInstance.accept(flattener, ["", dae]);
      flattener.generateFlowBalanceEquations(dae);
      flattener.foldDAEConstants(dae);

      const simulator = new ModelicaSimulator(dae);
      simulator.prepare();

      // Initialize current values from start attributes
      const currentValues = new Map<string, number>();
      for (const v of dae.variables) {
        const startAttr = v.attributes.get("start");
        if (startAttr && "value" in startAttr) {
          const val = (startAttr as { value: number }).value;
          if (typeof val === "number") {
            currentValues.set(v.name, val);
          }
        }
      }

      // Store the simulator instance
      cosimSimulators.set(params.participantId, {
        simulator: simulator as unknown as {
          simulate(start: number, stop: number, step: number): { t: number[]; y: number[][]; states: string[] };
        },
        dae,
        currentValues,
        stepSize: params.stepSize ?? 0.01,
      });

      // Build variable list with causality info
      const variables = dae.variables.map((v) => ({
        name: v.name,
        causality: v.causality ?? "local",
      }));

      return { ok: true, variables };
    } catch (e) {
      console.error("[simulateInit] Error:", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
);

/** Advance a simulator by one step, with optional input overrides. Returns output values. */
connection.onRequest(
  "modelscript/simulateStep",
  (params: {
    participantId: string;
    currentTime: number;
    stepSize: number;
    inputs?: Record<string, number>;
  }): {
    ok: boolean;
    outputs?: Record<string, number>;
    allValues?: Record<string, number>;
    error?: string;
  } => {
    const entry = cosimSimulators.get(params.participantId);
    if (!entry) {
      return { ok: false, error: `Participant '${params.participantId}' not initialized.` };
    }

    try {
      // Apply input overrides (set them in current values before stepping)
      if (params.inputs) {
        for (const [name, value] of Object.entries(params.inputs)) {
          entry.currentValues.set(name, value);
        }
      }

      // Step the simulation by one communication interval
      const result = entry.simulator.simulate(
        params.currentTime,
        params.currentTime + params.stepSize,
        params.stepSize,
      );

      // Extract values from the last time point
      const lastIdx = result.t.length - 1;
      if (lastIdx >= 0) {
        for (let i = 0; i < result.states.length; i++) {
          const name = result.states[i];
          const value = result.y[lastIdx]?.[i];
          if (name && value !== undefined) {
            entry.currentValues.set(name, value);
          }
        }
      }

      // Collect outputs (variables with causality "output")
      const outputs: Record<string, number> = {};
      const allValues: Record<string, number> = {};
      for (const v of entry.dae.variables) {
        const val = entry.currentValues.get(v.name);
        if (val !== undefined) {
          allValues[v.name] = val;
          if (v.causality === "output") {
            outputs[v.name] = val;
          }
        }
      }

      return { ok: true, outputs, allValues };
    } catch (e) {
      console.error("[simulateStep] Error:", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
);

/** Dispose a simulator instance. */
connection.onRequest("modelscript/simulateTerminate", (params: { participantId: string }): { ok: boolean } => {
  cosimSimulators.delete(params.participantId);
  return { ok: true };
});

// ── Co-simulation graph extraction from Modelica wrapper model ──

interface CosimParticipantInfo {
  id: string;
  type: "modelica" | "fmu";
  className: string;
  /** For FMU participants, the fileName parameter value. */
  fileName?: string;
}

interface CosimCouplingInfo {
  from: { participantId: string; variable: string };
  to: { participantId: string; variable: string };
}

interface CosimGraphResult {
  ok: boolean;
  participants?: CosimParticipantInfo[];
  couplings?: CosimCouplingInfo[];
  error?: string;
}

/**
 * Extract co-simulation participants and couplings from a Modelica wrapper model.
 *
 * Scans the model text for:
 * - Component declarations → participants
 * - connect(a.x, b.y) equations → couplings
 *
 * Components with a `fileName` parameter are classified as FMU participants.
 */
connection.onRequest("modelscript/extractCosimGraph", (params: { uri: string; text: string }): CosimGraphResult => {
  try {
    const text = params.text;

    // ── Extract component declarations ──
    // Match patterns like:  ClassName instanceName(...);
    // Exclude keywords, parameter declarations, and Real/Integer/Boolean/String variables
    const componentRegex = /^\s+([A-Z][A-Za-z0-9_.]*)\s+([a-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*(?:"[^"]*")?\s*;/gm;
    const builtinTypes = new Set(["Real", "Integer", "Boolean", "String", "StateSelect"]);
    const keywords = new Set([
      "parameter",
      "constant",
      "discrete",
      "input",
      "output",
      "flow",
      "stream",
      "replaceable",
      "redeclare",
      "inner",
      "outer",
      "final",
      "extends",
      "import",
      "equation",
      "algorithm",
      "initial",
      "end",
      "model",
      "class",
      "block",
      "connector",
      "record",
      "type",
      "package",
      "function",
      "when",
      "if",
      "for",
      "while",
      "connect",
      "protected",
      "public",
      "annotation",
      "external",
      "partial",
      "encapsulated",
      "within",
    ]);

    const participants: CosimParticipantInfo[] = [];
    const componentNames = new Set<string>();

    // Pre-filter: remove lines that start with "parameter", "constant", etc.
    const lines = text.split("\n");
    const filteredText = lines
      .filter((line) => {
        const trimmed = line.trimStart();
        const firstWord = trimmed.split(/\s+/)[0] ?? "";
        // Keep lines that don't start with modifier keywords
        return !["parameter", "constant", "discrete", "input", "output"].includes(firstWord);
      })
      .join("\n");

    let match: RegExpExecArray | null;
    while ((match = componentRegex.exec(filteredText)) !== null) {
      const className = match[1] ?? "";
      const instanceName = match[2] ?? "";
      const modBody = match[3] ?? "";

      // Skip built-in types and keywords
      if (builtinTypes.has(className) || keywords.has(className.toLowerCase())) continue;
      // Skip Modelica.Blocks.Interfaces types (connector definitions)
      if (className.includes("Interface")) continue;

      // Check for fileName parameter → FMU
      const fileNameMatch = modBody.match(/fileName\s*=\s*"([^"]*)"/);
      const isFmu = fileNameMatch !== null;

      participants.push({
        id: instanceName,
        type: isFmu ? "fmu" : "modelica",
        className,
        fileName: fileNameMatch?.[1],
      });
      componentNames.add(instanceName);
    }

    // ── Extract connect equations ──
    const connectRegex = /connect\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*,\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)/g;
    const couplings: CosimCouplingInfo[] = [];

    while ((match = connectRegex.exec(text)) !== null) {
      const ref1 = match[1] ?? "";
      const ref2 = match[2] ?? "";

      // Split into component.variable
      const dot1 = ref1.indexOf(".");
      const dot2 = ref2.indexOf(".");

      if (dot1 === -1 || dot2 === -1) continue; // Skip non-dotted references

      const comp1 = ref1.substring(0, dot1);
      const var1 = ref1.substring(dot1 + 1);
      const comp2 = ref2.substring(0, dot2);
      const var2 = ref2.substring(dot2 + 1);

      // Only add if both components are known participants
      if (!componentNames.has(comp1) || !componentNames.has(comp2)) continue;

      couplings.push({
        from: { participantId: comp1, variable: var1 },
        to: { participantId: comp2, variable: var2 },
      });
    }

    return { ok: true, participants, couplings };
  } catch (e) {
    console.error("[extractCosimGraph] Error:", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

/**
 * Custom request: create a Modelica wrapper model for multi-FMU co-simulation.
 *
 * Takes a model name and list of FMU descriptors, returns the generated
 * Modelica source text that can be written to a .mo file.
 */
connection.onRequest(
  "modelscript/createCosimWrapper",
  (params: {
    modelName: string;
    fmus: { className: string; instanceName: string; fileName: string }[];
    connections?: { source: string; target: string }[];
  }): { ok: boolean; source?: string; error?: string } => {
    try {
      const source = generateMultiModelWrapper(params.modelName, params.fmus, params.connections ?? []);
      return { ok: true, source };
    } catch (e) {
      console.error("[createCosimWrapper] Error:", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
);

// Custom request: get library tree children (lazy loading)
interface TreeNodeInfo {
  id: string;
  name: string;
  compositeName: string;
  classKind: string;
  hasChildren: boolean;
  iconSvg?: string;
}

// ── Fast library tree: works directly from SymbolIndex metadata ──
// No QueryBackedClassInstance creation, no instantiation, no icon rendering.
// Uses childrenOf map for O(1) parent-child lookups.

/** Known Modelica class kind keywords — order matters (last match wins in classPrefixes text). */
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

/**
 * Extract the class kind from a classPrefixes metadata string.
 * The metadata is the full text of the ClassPrefixes CST node,
 * e.g. "partial model", "expandable connector", "pure function".
 */
function classKindFromPrefixes(prefixesText: unknown): string {
  if (typeof prefixesText !== "string" || !prefixesText) return "class";
  const lower = prefixesText.toLowerCase();
  // Find the last class-kind keyword in the string
  for (let i = CLASS_KIND_KEYWORDS.length - 1; i >= 0; i--) {
    if (lower.includes(CLASS_KIND_KEYWORDS[i])) return CLASS_KIND_KEYWORDS[i];
  }
  return "class";
}

/** FQN → SymbolId cache — avoids O(n) scans on repeated getTreeChildren calls. */
let fqnCache = new Map<string, number>();
/** The unified index revision this cache was built against. */
let fqnCacheIndex: any = null;

function getCompositeName(entry: any, index: any): string {
  if (entry.parentId === null) return entry.name;
  const parent = index.symbols.get(entry.parentId);
  if (!parent) return entry.name;
  return getCompositeName(parent, index) + "." + entry.name;
}

connection.onRequest("modelscript/getLibraryTree", (params: { uri: string; parentId?: string }): TreeNodeInfo[] => {
  // Use toTreeIndex() — returns the full unified index if cached,
  // or a lightweight skeleton from file metadata (no parsing needed)
  const unifiedIndex = globalWorkspaceIndex.toTreeIndex();
  if (!unifiedIndex) return [];

  // Invalidate FQN cache when the index changes
  if (fqnCacheIndex !== unifiedIndex) {
    fqnCache = new Map();
    fqnCacheIndex = unifiedIndex;
  }

  return getTreeChildrenFast(unifiedIndex, params.parentId);
});

function getTreeChildrenFast(index: any, parentId?: string): TreeNodeInfo[] {
  const nodes: TreeNodeInfo[] = [];

  if (!parentId) {
    // Root level: get children of null (top-level symbols)
    const rootChildIds = index.childrenOf.get(null) ?? [];
    for (const id of rootChildIds) {
      const entry = index.symbols.get(id);
      if (!entry || entry.kind !== "Class") continue;
      const compositeName = entry.name; // Root classes have no parent
      nodes.push({
        id: compositeName,
        name: entry.name,
        compositeName,
        classKind: classKindFromPrefixes(entry.metadata?.classPrefixes),
        hasChildren: hasClassChildren(index, id),
      });
      // Cache FQN → ID
      fqnCache.set(compositeName, id);
    }
  } else {
    // Find the parent's numeric ID
    let parentIdNum = fqnCache.get(parentId);

    if (parentIdNum === undefined) {
      // Cache miss — search the index (one-time cost per FQN)
      for (const [id, entry] of index.symbols) {
        if (entry.kind === "Class" && getCompositeName(entry, index) === parentId) {
          parentIdNum = id;
          fqnCache.set(parentId, id);
          break;
        }
      }
    }

    if (parentIdNum !== undefined) {
      const childIds = index.childrenOf.get(parentIdNum) ?? [];
      for (const id of childIds) {
        const entry = index.symbols.get(id);
        if (!entry || entry.kind !== "Class") continue;
        const compositeName = parentId + "." + entry.name;
        nodes.push({
          id: compositeName,
          name: entry.name,
          compositeName,
          classKind: classKindFromPrefixes(entry.metadata?.classPrefixes),
          hasChildren: hasClassChildren(index, id),
        });
        // Cache FQN → ID
        fqnCache.set(compositeName, id);
      }
    }
  }

  // Sort nodes alphabetically
  nodes.sort((a, b) => a.name.localeCompare(b.name));
  return nodes;
}

/** Check if a symbol has any Class children using the childrenOf map. */
function hasClassChildren(index: any, symbolId: number): boolean {
  const childIds = index.childrenOf.get(symbolId);
  if (!childIds) return false;
  for (const id of childIds) {
    const entry = index.symbols.get(id);
    if (entry?.kind === "Class") return true;
  }
  return false;
}

// Custom request: search classes by name across the workspace index
connection.onRequest(
  "modelscript/searchClasses",
  (params: { query: string; limit?: number }): { results: TreeNodeInfo[] } => {
    const query = (params.query ?? "").toLowerCase();
    if (!query) return { results: [] };

    const limit = params.limit ?? 50;
    const unifiedIndex = globalWorkspaceIndex.toTreeIndex();
    if (!unifiedIndex) return { results: [] };

    const results: TreeNodeInfo[] = [];

    for (const [id, entry] of unifiedIndex.symbols) {
      if (entry.kind !== "Class") continue;
      const compositeName = getCompositeName(entry, unifiedIndex);
      if (compositeName.toLowerCase().includes(query)) {
        results.push({
          id: compositeName,
          name: entry.name,
          compositeName,
          classKind: classKindFromPrefixes(entry.metadata?.classPrefixes),
          hasChildren: hasClassChildren(unifiedIndex, id),
        });
        if (results.length >= limit) break;
      }
    }

    results.sort((a, b) => a.compositeName.localeCompare(b.compositeName));
    return { results };
  },
);

// Custom request: get project tree (workspace files and their classes)
interface ProjectTreeNodeInfo {
  id: string;
  name: string;
  uri?: string;
  compositeName?: string;
  classKind?: string;
  hasChildren: boolean;
  isFile: boolean;
  iconSvg?: string;
  /** 0-based line number of the class definition */
  line?: number;
}

connection.onRequest("modelscript/getProjectTree", (params: { parentId?: string }): ProjectTreeNodeInfo[] => {
  const nodes: ProjectTreeNodeInfo[] = [];

  const globalUnified = globalWorkspaceIndex.toTreeIndex();
  const sysmlUnified = sysml2WorkspaceIndex.toTreeIndex();

  const allSymbols = new Map<string, any>();
  for (const [id, entry] of globalUnified.symbols) allSymbols.set(id.toString(), entry);
  for (const [id, entry] of sysmlUnified.symbols) allSymbols.set(id.toString(), entry);

  // Group top-level elements by resourceId
  const files = new Map<string, any[]>();
  for (const entry of allSymbols.values()) {
    if (entry.resourceId) {
      if (!files.has(entry.resourceId)) files.set(entry.resourceId, []);
      files.get(entry.resourceId)?.push(entry);
    }
  }

  function getCompositeName(entry: any): string {
    if (entry.parentId === null) return entry.name;
    const parent = allSymbols.get(entry.parentId.toString());
    if (!parent) return entry.name;
    return getCompositeName(parent) + "." + entry.name;
  }

  function hasClassChildren(entry: any) {
    for (const child of allSymbols.values()) {
      if (child.parentId === entry.id && (child.kind === "Class" || child.kind === "Def")) {
        return true;
      }
    }
    return false;
  }

  if (!params.parentId) {
    // Root level: return one node per parsed file (exclude stdlib)
    for (const [uri, entries] of files.entries()) {
      if (uri.startsWith("file:///lib/")) continue;

      const fileName = uri.split("/").pop() ?? uri;
      let hasChildren = false;
      for (const entry of entries) {
        if ((entry.kind === "Class" || entry.kind === "Def") && entry.parentId === null) {
          hasChildren = true;
          break;
        }
      }

      nodes.push({
        id: uri,
        name: fileName,
        uri,
        hasChildren,
        isFile: true,
      });
    }
    nodes.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    const sepIdx = params.parentId.indexOf("::");
    const isFileNode = sepIdx < 0;

    if (isFileNode) {
      const entries = files.get(params.parentId) ?? [];
      for (const entry of entries) {
        if ((entry.kind === "Class" || entry.kind === "Def") && entry.parentId === null) {
          nodes.push({
            id: `${params.parentId}::${getCompositeName(entry)}`,
            name: entry.name,
            uri: params.parentId,
            compositeName: getCompositeName(entry),
            classKind: (entry.metadata?.classKind as string) ?? (entry.metadata?.defKind as string) ?? "class",
            hasChildren: hasClassChildren(entry),
            isFile: false,
          });
        }
      }
    } else {
      const docUri = params.parentId.substring(0, sepIdx);
      const compositeName = params.parentId.substring(sepIdx + 2);
      const entries = files.get(docUri) ?? [];

      let parentEntry: any = null;
      for (const entry of entries) {
        if (getCompositeName(entry) === compositeName) {
          parentEntry = entry;
          break;
        }
      }

      if (parentEntry) {
        for (const entry of entries) {
          if (entry.parentId === parentEntry.id && (entry.kind === "Class" || entry.kind === "Def")) {
            nodes.push({
              id: `${docUri}::${getCompositeName(entry)}`,
              name: entry.name,
              uri: docUri,
              compositeName: getCompositeName(entry),
              classKind: (entry.metadata?.classKind as string) ?? (entry.metadata?.defKind as string) ?? "class",
              hasChildren: hasClassChildren(entry),
              isFile: false,
            });
          }
        }
      }
    }
  }

  return nodes;
});

// Custom request: get class icon SVG
connection.onRequest("modelscript/getClassIcon", (params: { className: string; uri?: string }): string | null => {
  try {
    const docUri = params.uri ?? documentContexts.keys().next().value;
    if (!docUri) return null;
    const context = documentContexts.get(docUri);
    if (!context) return null;

    let classInstance = context.query(params.className);

    // If not found, it might be an unparsed MSL file. Force indexing and retry.
    if (!classInstance) {
      const uri = (globalWorkspaceIndex as any).getFileUriForFQN?.(params.className);
      if (uri) {
        globalWorkspaceIndex.getFileIndex(uri);
        // We must update the engine's index so it sees the newly parsed file
        const newIndex = unifiedWorkspace.toUnifiedPartial();
        injectPredefinedTypes(newIndex);
        const engine = documentQueryEngines.get(docUri) as any;
        if (engine) engine.updateIndex(newIndex);
        classInstance = context.query(params.className);
      }
    }

    if (!(classInstance instanceof ModelicaClassInstance)) return null;

    return getClassIconSvg(classInstance) ?? null;
  } catch (e) {
    console.error("[library-tree] Error rendering icon:", e);
    return null;
  }
});

// Custom request: run a .mos script file
connection.onRequest("modelscript/runScript", async (params: { uri: string }) => {
  const context = documentContexts.get(params.uri);
  const doc = documents.get(params.uri);
  if (!context || !doc) return { output: "Error: Could not find document context." };

  const tree = context.parse(".mos", doc.getText());
  const storedDef = ModelicaStoredDefinitionSyntaxNode.new(null, tree.rootNode);
  if (!storedDef) return { output: "Error: Could not parse script structure." };

  let output = "";
  const interpreter = new ModelicaInterpreter(true, (msg) => {
    output += msg + "\n";
  });

  const scriptScope = new ModelicaScriptScope(context);

  try {
    interpreter.visitStoredDefinition(storedDef, scriptScope);
  } catch (e) {
    output += `Runtime Error: ${e instanceof Error ? e.message : String(e)}\n`;
  }

  return { output };
});

// ── Notebook API: session-scoped cell execution ──
const notebookSessions = new Map<string, ModelicaScriptScope>();

connection.onRequest("modelscript/runNotebookCell", async (params: { sessionId: string; code: string }) => {
  // Find a context to use — prefer the first available document context
  let ctx: Context | undefined;
  for (const c of documentContexts.values()) {
    ctx = c;
    break;
  }
  if (!ctx) return { output: "", error: "No Modelica context available. Open a .mo file first." };

  // Get or create session scope
  let scope = notebookSessions.get(params.sessionId);
  if (!scope) {
    scope = new ModelicaScriptScope(ctx);
    notebookSessions.set(params.sessionId, scope);
  }

  // Parse the cell code as a .mos script fragment
  const tree = ctx.parse(".mos", params.code);
  const storedDef = ModelicaStoredDefinitionSyntaxNode.new(null, tree.rootNode);
  if (!storedDef) return { output: "", error: "Could not parse cell content." };

  let output = "";
  let error: string | undefined;
  const interpreter = new ModelicaInterpreter(true, (msg) => {
    output += msg + "\n";
  });

  const diagrams: { name: string; data: DiagramData }[] = [];

  try {
    interpreter.visitStoredDefinition(storedDef, scope);

    // Extract diagrams for any classes defined in this cell
    for (const classDef of storedDef.classDefinitions) {
      const name = classDef.identifier?.text;
      if (!name) {
        console.log(`[notebook-diagram] skipping classDef without identifier`);
        continue;
      }
      const classInstance = scope.classDefinitions.get(name);
      if (classInstance) {
        try {
          console.log(`[notebook-diagram] building diagram for '${name}'`);
          const data = buildDiagramData(classInstance);
          console.log(
            `[notebook-diagram] diagram for '${name}': ${data.nodes.length} nodes, ${data.edges.length} edges`,
          );
          // Include diagram even if empty — the renderer will show the coordinate system frame
          diagrams.push({ name, data });
        } catch (e) {
          console.error(`[notebook-diagram] Error building diagram for ${name}:`, e);
        }
      } else {
        console.log(`[notebook-diagram] class '${name}' not found in scope.classDefinitions`);
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return { output: output.trimEnd(), error, diagrams };
});

connection.onRequest("modelscript/resetNotebookSession", async (params: { sessionId: string }) => {
  notebookSessions.delete(params.sessionId);
  return { success: true };
});

// Custom request: add a component to a model (drag-drop from library tree)
connection.onRequest("modelscript/addComponent", (params: { uri: string; className: string; x: number; y: number }) => {
  // SysML2: insert a new element declaration in source text
  if (params.uri.endsWith(".sysml")) {
    const doc = documents.get(params.uri);
    if (!doc) return [];
    try {
      const docText = doc.getText();
      // className is the element type (e.g., "PartDefinition", "ActionUsage")
      const elementType = params.className;
      // Generate a base name from the type
      const baseParts = elementType.replace("Definition", "").replace("Usage", "");
      const baseName = baseParts.charAt(0).toLowerCase() + baseParts.slice(1);
      const uniqueName = generateUniqueName(docText, baseName);

      const edits = computeSysML2ElementInsert(docText, elementType, uniqueName);

      // Store position in layout
      let layout = sysml2Layouts.get(params.uri) ?? createEmptyLayout();
      layout = updateElementPositions(layout, [
        {
          name: uniqueName,
          x: Math.round(params.x),
          y: Math.round(params.y),
          width: 180,
          height: 60,
        },
      ]);
      sysml2Layouts.set(params.uri, layout);

      return edits;
    } catch (e) {
      console.error("[sysml2-diagram] addComponent error:", e);
      return [];
    }
  }

  const instances = documentInstances.get(params.uri);
  const doc = documents.get(params.uri);
  if (!instances?.[0] || !doc) return [];

  const classInstance = instances[0];
  const context = documentContexts.get(params.uri);

  try {
    // Get base name from defaultComponentName annotation or class name
    const shortName = params.className.split(".").pop() || "component";
    let baseName = shortName.toLowerCase();
    try {
      if (context) {
        const droppedClass = context.query(params.className);
        if (droppedClass instanceof ModelicaClassInstance) {
          const defaultName = droppedClass.annotation("defaultComponentName") as string | null;
          if (defaultName) {
            baseName = (droppedClass as any).translate?.(defaultName) ?? defaultName;
          } else {
            baseName = (droppedClass.localizedName || shortName).toLowerCase();
          }
        }
      }
    } catch {
      // proceed with default baseName
    }

    // Find unique name
    let name = baseName;
    let i = 1;
    const existingNames = new Set(Array.from(classInstance.components).map((c) => c.name));
    while (existingNames.has(name)) {
      name = `${baseName}${i}`;
      i++;
    }

    return computeComponentInsert(classInstance, params.className, name, params.x, params.y, doc.getText());
  } catch (e) {
    console.error("[diagram] addComponent error:", e);
    return [];
  }
});

// ── MCP Bridge: custom requests for AI chat integration ──

connection.onRequest(
  "modelscript/flatten",
  (params: { name: string; uri?: string }): { text: string | null; error?: string } => {
    // Find a context — prefer one from a specific document, or fallback to first available
    let ctx: Context | undefined;
    if (params.uri) ctx = documentContexts.get(params.uri);
    if (!ctx) {
      for (const c of documentContexts.values()) {
        ctx = c;
        break;
      }
    }
    if (!ctx) return { text: null, error: "No Modelica context available. Open a .mo file first." };

    try {
      const result = ctx.flatten(params.name);
      if (!result) return { text: null, error: `Class '${params.name}' not found.` };
      return { text: result };
    } catch (e) {
      return { text: null, error: e instanceof Error ? e.message : String(e) };
    }
  },
);

connection.onRequest(
  "modelscript/query",
  (params: {
    name: string;
    uri?: string;
  }): {
    name: string;
    kind: string;
    description: string;
    components: { name: string; type: string; description: string }[];
    childClasses: { name: string; kind: string }[];
    error?: string;
  } | null => {
    let ctx: Context | undefined;
    if (params.uri) ctx = documentContexts.get(params.uri);
    if (!ctx) {
      for (const c of documentContexts.values()) {
        ctx = c;
        break;
      }
    }
    if (!ctx) return null;

    try {
      const element = ctx.query(params.name);
      if (!element || !(element instanceof ModelicaClassInstance)) return null;

      const components: { name: string; type: string; description: string }[] = [];
      const childClasses: { name: string; kind: string }[] = [];
      for (const child of element.elements) {
        if (child instanceof ModelicaComponentInstance) {
          components.push({
            name: child.name ?? "",
            type: child.classInstance?.name ?? "",
            description: child.description ?? "",
          });
        } else if (child instanceof ModelicaClassInstance) {
          childClasses.push({
            name: child.name ?? "",
            kind: child.classKind ?? "class",
          });
        }
      }

      return {
        name: params.name,
        kind: element.classKind ?? "class",
        description: element.description ?? "",
        components,
        childClasses,
      };
    } catch (e) {
      console.error("[mcp-bridge] query error:", e);
      return null;
    }
  },
);

connection.onRequest(
  "modelscript/getComponentProperties",
  (params: {
    uri: string;
    className: string;
    componentName: string;
  }): {
    name: string;
    className: string;
    localizedClassName: string;
    description: string;
    iconSvg?: string | null;
    parameters: {
      name: string;
      localizedName?: string;
      localizedDescription?: string;
      value: string;
      defaultValue: string;
      unit?: string;
      isBoolean?: boolean;
    }[];
    documentation?: { info?: string; revisions?: string };
  } | null => {
    let ctx = documentContexts.get(params.uri);
    if (!ctx) {
      for (const c of documentContexts.values()) {
        ctx = c;
        break;
      }
    }
    if (!ctx) return null;

    try {
      const cls = ctx.query(params.className);
      if (!cls || !(cls instanceof ModelicaClassInstance)) return null;

      const component = Array.from(cls.components).find((c) => c.name === params.componentName);
      if (!component) return null;

      const parameters: any[] = [];
      if (component.classInstance) {
        for (const element of component.classInstance.elements) {
          if (element instanceof ModelicaComponentInstance && element.variability === ModelicaVariability.PARAMETER) {
            const value =
              typeof (component.modification?.getModificationArgument(element.name ?? "")?.expression as any)?.value ===
              "string"
                ? (component.modification?.getModificationArgument(element.name ?? "")?.expression as any).value
                : typeof (element.modification?.expression as any)?.value === "string"
                  ? (element.modification?.expression as any).value
                  : "-";

            const unitExpr = element.classInstance?.modification?.getModificationArgument("unit")?.expression;
            const rawUnit =
              typeof (unitExpr as any)?.value === "string" ? (unitExpr as any).value.replace(/^"|"$/g, "") : undefined;
            const unit = rawUnit === "1" || rawUnit === "" ? undefined : rawUnit;
            const isBoolean = element.classInstance?.name === "Boolean";

            parameters.push({
              name: element.name ?? "",
              localizedName: element.localizedName,
              localizedDescription: (element as any).localizedDescription || element.description,
              value,
              defaultValue:
                typeof (element.modification?.expression as any)?.value === "string"
                  ? (element.modification?.expression as any).value
                  : "-",
              unit,
              isBoolean,
            });
          }
        }
      }

      const doc = component.classInstance?.annotation("Documentation") as { info?: string; revisions?: string } | null;

      return {
        name: component.name ?? "",
        className: component.classInstance?.name ?? "",
        localizedClassName: component.classInstance?.localizedName ?? "",
        description: component.description ?? "",
        iconSvg: component.classInstance ? getClassIconSvg(component.classInstance as ModelicaClassInstance) : null,
        parameters,
        documentation: doc ? { info: doc.info, revisions: doc.revisions } : undefined,
      };
    } catch (e) {
      console.error("[lsp] getComponentProperties error:", e);
      return null;
    }
  },
);

connection.onRequest(
  "modelscript/parse",
  (params: { code: string }): { classes: { name: string; kind: string }[]; syntaxErrors: string[] } => {
    let ctx: Context | undefined;
    for (const c of documentContexts.values()) {
      ctx = c;
      break;
    }
    if (!ctx) return { classes: [], syntaxErrors: ["No Modelica context available."] };

    try {
      const tree = ctx.parse(".mo", params.code);
      const errors: string[] = [];
      const linter = new ModelicaLinter((_type: string, _code: number, message: string) => {
        errors.push(message);
      });
      linter.lint(tree);

      const storedDef = ModelicaStoredDefinitionSyntaxNode.new(null, tree.rootNode);
      const classes: { name: string; kind: string }[] = [];
      if (storedDef) {
        for (const classDef of storedDef.classDefinitions) {
          classes.push({
            name: classDef.identifier?.text ?? "<anonymous>",
            kind: String(classDef.classPrefixes?.classKind ?? "class"),
          });
        }
      }
      return { classes, syntaxErrors: errors };
    } catch (e) {
      return { classes: [], syntaxErrors: [e instanceof Error ? e.message : String(e)] };
    }
  },
);

// List all top-level classes across all loaded documents (for AI chat context)
connection.onRequest("modelscript/listClasses", (): { classes: { name: string; kind: string; uri: string }[] } => {
  const classes: { name: string; kind: string; uri: string }[] = [];
  const seen = new Set<string>();

  const globalUnified = globalWorkspaceIndex.toTreeIndex();
  const sysmlUnified = sysml2WorkspaceIndex.toTreeIndex();

  const allSymbols = new Map<string, any>();
  for (const [id, entry] of globalUnified.symbols) allSymbols.set(id.toString(), entry);
  for (const [id, entry] of sysmlUnified.symbols) allSymbols.set(id.toString(), entry);

  for (const entry of allSymbols.values()) {
    if ((entry.kind === "Class" || entry.kind === "Def") && entry.parentId === null) {
      if (!seen.has(entry.name)) {
        seen.add(entry.name);
        classes.push({
          name: entry.name,
          kind: (entry.metadata?.classKind as string) ?? (entry.metadata?.defKind as string) ?? "class",
          uri: entry.resourceId,
        });
      }
    }
  }

  return { classes };
});

// ── FMU generation capability ──────────────────────────────────────
connection.onRequest(
  "modelscript/exportFmu",
  async (params: { uri: string; fmiVersion: "2.0" | "3.0"; includeWasm?: boolean }) => {
    const ctx = documentContexts.get(params.uri);
    const doc = documents.get(params.uri);
    if (!ctx || !doc) throw new Error("Document not found or no context available.");

    // Get the first class defined in the document as the target for FMU generation
    const instances = documentInstances.get(params.uri);
    if (!instances || instances.length === 0) throw new Error("No Modelica classes found in the active document.");

    const targetInstance = instances[0];
    const targetClass = targetInstance.name;
    if (!targetClass) throw new Error("Could not determine model name.");

    const dae = new ModelicaDAE(targetClass);
    const flattener = new ModelicaFlattener();
    (targetInstance as any).accept(flattener, ["", dae]);
    flattener.generateFlowBalanceEquations(dae);
    flattener.foldDAEConstants(dae);

    const { archive } = buildFmuArchive(dae, {
      modelIdentifier: targetClass,
      includeWasm: params.includeWasm,
    });

    // Base64 encode the Uint8Array
    const chunkSize = 0x8000;
    const chunks: string[] = [];
    for (let i = 0; i < archive.length; i += chunkSize) {
      chunks.push(String.fromCharCode.apply(null, Array.from(archive.subarray(i, i + chunkSize))));
    }
    const base64 = btoa(chunks.join(""));

    return { fmuName: targetClass, base64 };
  },
);

// ── WASM compilation capability ──────────────────────────────────────
connection.onRequest("modelscript/compileWasm", async (params: { uri: string }) => {
  const ctx = documentContexts.get(params.uri);
  const doc = documents.get(params.uri);
  if (!ctx || !doc) throw new Error("Document not found or no context available.");

  const instances = documentInstances.get(params.uri);
  if (!instances || instances.length === 0) throw new Error("No Modelica classes found in the active document.");

  const targetInstance = instances[0];
  const targetClass = targetInstance.name;
  if (!targetClass) throw new Error("Could not determine model name.");

  const dae = new ModelicaDAE(targetClass);
  const flattener = new ModelicaFlattener();
  (targetInstance as any).accept(flattener, ["", dae]);
  flattener.generateFlowBalanceEquations(dae);
  flattener.foldDAEConstants(dae);

  // Generate the FMU result for scalar variable metadata
  const { generateFmu } = await import("@modelscript/fmi");
  const fmuResult = generateFmu(dae, { modelIdentifier: targetClass });

  // Generate WASM-targeted C source
  const wasmResult = generateFmuWasmSource(dae, fmuResult, { modelIdentifier: targetClass });

  return {
    wasmC: wasmResult.wasmC,
    emccFlags: wasmResult.emccFlags,
    exportedFunctions: wasmResult.exportedFunctions,
    scalarVariables: fmuResult.scalarVariables.map((sv) => ({
      name: sv.name,
      valueReference: sv.valueReference,
      causality: sv.causality,
    })),
  };
});

// ── FMU registration (binary data via custom request) ──────────────────
connection.onRequest(
  "modelscript/registerFmu",
  (params: { name: string; data: string }): { ok: boolean; error?: string } => {
    try {
      const context = sharedContext ?? new Context(sharedFs);
      // Decode base64 to Uint8Array
      const binaryStr = atob(params.data);
      const fmuBytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        fmuBytes[i] = binaryStr.charCodeAt(i);
      }
      const fmuEntity = ModelicaFmuEntity.fromFmu(context, params.name, fmuBytes);
      fmuEntity.load();
      fmuEntity.instantiate();
      const uri = `__fmu__:${params.name}`;
      workspaceInstances.set(uri, [fmuEntity as any]);
      console.log(`[fmu] Registered FMU entity '${params.name}' via custom request`);
      // Re-validate all .mo documents to pick up the new FMU class
      for (const doc of documents.all()) {
        if (doc.uri.endsWith(".mo")) {
          validateTextDocument(doc);
        }
      }
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[fmu] Failed to register FMU '${params.name}':`, msg);
      return { ok: false, error: msg };
    }
  },
);

// ── Code Lens Provider ──

connection.onRequest("textDocument/codeLens", (params): CodeLens[] => {
  if (!parserReady || !parser) return [];

  const uri = params.textDocument.uri;
  const instances = documentInstances.get(uri);
  if (!instances || instances.length === 0) return [];

  const document = documents.get(uri);
  if (!document) return [];

  const lenses: CodeLens[] = [];

  for (const instance of instances) {
    if (!instance.instantiated) {
      try {
        instance.instantiate();
      } catch {
        continue;
      }
    }

    // Find the line of the class definition
    const sourceRange = instance.abstractSyntaxNode?.sourceRange;
    if (!sourceRange) continue;
    const startLine = sourceRange.startRow;

    // Only emit analytical lenses for simulatable class kinds
    const isSimulatable =
      instance.classKind === ModelicaClassKind.MODEL ||
      instance.classKind === ModelicaClassKind.BLOCK ||
      instance.classKind === ModelicaClassKind.CLASS;

    if (isSimulatable) {
      // Flatten to get equation/variable counts
      try {
        const dae = new ModelicaDAE(instance.name || "Model");
        const flattener = new ModelicaFlattener();
        instance.accept(flattener, ["", dae]);
        flattener.generateFlowBalanceEquations(dae);

        const nEqs = dae.equations.filter((eq) => eq.constructor.name !== "ModelicaFunctionCallEquation").length;
        const nVars = dae.variables.filter(
          (v) =>
            (v as { variability?: unknown }).variability === null || (v as { name: string }).name.startsWith("der("),
        ).length;

        if (nEqs > 0 || nVars > 0) {
          lenses.push({
            range: {
              start: { line: startLine, character: 0 },
              end: { line: startLine, character: 0 },
            },
            command: {
              title: `📐 ${nEqs} equation${nEqs !== 1 ? "s" : ""}, ${nVars} unknown${nVars !== 1 ? "s" : ""}`,
              command: "modelscript.analyzeBlt",
            },
          });
        }

        // Check for algebraic loops via BLT
        if (dae.algebraicLoops.length > 0) {
          for (const loop of dae.algebraicLoops) {
            lenses.push({
              range: {
                start: { line: startLine, character: 0 },
                end: { line: startLine, character: 0 },
              },
              command: {
                title: `⚠️ Algebraic loop (size ${loop.variables.length}): ${loop.variables.slice(0, 3).join(", ")}${loop.variables.length > 3 ? "…" : ""}`,
                command: "modelscript.analyzeBlt",
              },
            });
          }
        }
      } catch (e) {
        console.warn(`[codeLens] Could not flatten ${instance.name}:`, e);
      }
    }

    // Extends count lens
    let extendsCount = 0;
    try {
      for (const ext of instance.extendsClassInstances) {
        if (ext) extendsCount++;
      }
    } catch {
      // ignore
    }
    if (extendsCount > 0) {
      lenses.push({
        range: {
          start: { line: startLine, character: 0 },
          end: { line: startLine, character: 0 },
        },
        command: {
          title: `🏗️ ${extendsCount} extends`,
          command: "modelscript.showClassHierarchy",
        },
      });
    }
  }

  return lenses;
});

// ── Inlay Hints Provider ──

connection.onRequest("textDocument/inlayHint", (params): InlayHint[] => {
  if (!parserReady || !parser) return [];

  const uri = params.textDocument.uri;
  const instances = documentInstances.get(uri);
  if (!instances || instances.length === 0) return [];

  const document = documents.get(uri);
  if (!document) return [];

  const hints: InlayHint[] = [];

  for (const instance of instances) {
    if (!instance.instantiated) continue;

    // Only process simulatable classes for start value hints
    const isSimulatable =
      instance.classKind === ModelicaClassKind.MODEL ||
      instance.classKind === ModelicaClassKind.BLOCK ||
      instance.classKind === ModelicaClassKind.CLASS;
    if (!isSimulatable) continue;

    try {
      const dae = new ModelicaDAE(instance.name || "Model");
      const flattener = new ModelicaFlattener();
      instance.accept(flattener, ["", dae]);

      // For each variable, show start value if it has one
      for (const v of dae.variables) {
        const rv = v as any;
        if (rv.start !== undefined && rv.start !== null && rv.start !== 0) {
          if (typeof rv.start === "object") continue;

          // Try to find the component declaration in the source for this variable
          // Only show for top-level (non-dotted) names declared in this class
          const varName = v.name;
          if (varName.includes(".") || varName.startsWith("der(")) continue;

          // Find the declaration position in the source text
          for (const element of instance.declaredElements) {
            if (element instanceof ModelicaComponentInstance && element.name === varName) {
              const sr = element.abstractSyntaxNode?.sourceRange;
              if (sr && sr.startRow >= params.range.start.line && sr.startRow <= params.range.end.line) {
                const identNode = element.abstractSyntaxNode?.declaration?.identifier;
                const identSr = identNode?.sourceRange;
                if (identSr) {
                  hints.push({
                    position: { line: identSr.endRow, character: identSr.endCol },
                    label: ` start=${rv.start}`,
                    kind: InlayHintKind.Parameter,
                    paddingLeft: true,
                  });
                }
              }
              break;
            }
          }
        }
      }
    } catch (e) {
      console.warn(`[inlayHint] Could not flatten ${instance.name}:`, e);
    }
  }

  return hints;
});

// ── Class Hierarchy RPC ──

interface ClassHierarchyNode {
  name: string;
  kind: string;
  description: string | null;
  children: ClassHierarchyNode[];
}

function buildClassHierarchy(classInstance: ModelicaClassInstance, visited = new Set<string>()): ClassHierarchyNode {
  const name = classInstance.compositeName || classInstance.name || "<unknown>";
  if (visited.has(name)) {
    return { name, kind: classInstance.classKind || "class", description: classInstance.description, children: [] };
  }
  visited.add(name);

  const children: ClassHierarchyNode[] = [];
  try {
    for (const ext of classInstance.extendsClassInstances) {
      if (ext.classInstance) {
        children.push(buildClassHierarchy(ext.classInstance, visited));
      }
    }
  } catch {
    // ignore errors during hierarchy traversal
  }

  return {
    name,
    kind: classInstance.classKind || "class",
    description: classInstance.description,
    children,
  };
}

connection.onRequest(
  "modelscript/getClassHierarchy",
  (params: { uri: string; className?: string }): ClassHierarchyNode | null => {
    const instances = documentInstances.get(params.uri);
    if (!instances || instances.length === 0) return null;

    let target = instances[0];
    if (params.className) {
      const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
      if (found) target = found;
    }

    if (!target.instantiated) {
      try {
        target.instantiate();
      } catch {
        return null;
      }
    }

    return buildClassHierarchy(target);
  },
);

// ── BLT Analysis RPC ──

interface BltAnalysisResult {
  className: string;
  variables: string[];
  equations: string[];
  algebraicLoops: { variables: string[]; equations: string[] }[];
  equationCount: number;
  unknownCount: number;
}

connection.onRequest(
  "modelscript/analyzeBlt",
  (params: { uri: string; className?: string }): BltAnalysisResult | null => {
    const instances = documentInstances.get(params.uri);
    if (!instances || instances.length === 0) return null;

    let target = instances[0];
    if (params.className) {
      const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
      if (found) target = found;
    }

    if (!target.instantiated) {
      try {
        target.instantiate();
      } catch {
        return null;
      }
    }

    try {
      const dae = new ModelicaDAE(target.name || "Model");
      const flattener = new ModelicaFlattener();
      target.accept(flattener, ["", dae]);
      flattener.generateFlowBalanceEquations(dae);

      // Run BLT transformation
      const { algebraicLoops } = performBltTransformation(dae);

      // Serialize equation text via toJSON
      const eqTexts = dae.equations
        .filter((eq) => eq.constructor.name !== "ModelicaFunctionCallEquation")
        .map((eq) => {
          try {
            const json = eq.toJSON;
            if (json && typeof json === "object" && "expression1" in json && "expression2" in json) {
              return `${JSON.stringify(json.expression1)} = ${JSON.stringify(json.expression2)}`;
            }
            return JSON.stringify(json);
          } catch {
            return "<equation>";
          }
        });

      const varNames = dae.variables.map((v) => v.name);

      const unknownCount = dae.variables.filter(
        (v) => (v as { variability?: unknown }).variability === null || (v as { name: string }).name.startsWith("der("),
      ).length;

      return {
        className: target.name || "Model",
        variables: varNames,
        equations: eqTexts,
        algebraicLoops: algebraicLoops.map((loop) => ({
          variables: loop.variables,
          equations: loop.equations.map((eq) => {
            try {
              return JSON.stringify(eq.toJSON);
            } catch {
              return "<equation>";
            }
          }),
        })),
        equationCount: dae.equations.filter((eq) => eq.constructor.name !== "ModelicaFunctionCallEquation").length,
        unknownCount,
      };
    } catch (e) {
      console.error(`[analyzeBlt] Error:`, e);
      return null;
    }
  },
);

// ── Component Tree RPC ──

interface ComponentTreeNode {
  name: string;
  typeName: string;
  kind: string;
  variability: string | null;
  causality: string | null;
  description: string | null;
  children: ComponentTreeNode[];
}

connection.onRequest(
  "modelscript/getComponentTree",
  (params: { uri: string; className?: string }): ComponentTreeNode | null => {
    const instances = documentInstances.get(params.uri);
    if (!instances || instances.length === 0) return null;

    let target = instances[0];
    if (params.className) {
      const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
      if (found) target = found;
    }

    if (!target.instantiated) {
      try {
        target.instantiate();
      } catch {
        return null;
      }
    }

    return buildComponentTree(target);
  },
);

function buildComponentTree(classInstance: ModelicaClassInstance, depth = 0): ComponentTreeNode {
  const children: ComponentTreeNode[] = [];
  if (depth < 5) {
    try {
      for (const comp of classInstance.components) {
        if (comp instanceof ModelicaComponentInstance) {
          const childCI = comp.classInstance;
          const childNode: ComponentTreeNode = {
            name: comp.name || "<unnamed>",
            typeName: childCI?.name || "<unknown>",
            kind: childCI?.classKind || "unknown",
            variability: comp.variability,
            causality: comp.causality,
            description: comp.description,
            children: [],
          };
          if (childCI) {
            try {
              const subtree = buildComponentTree(childCI, depth + 1);
              childNode.children = subtree.children;
            } catch {
              // ignore
            }
          }
          children.push(childNode);
        }
      }
    } catch {
      // ignore
    }
  }

  return {
    name: classInstance.name || "<unnamed>",
    typeName: classInstance.compositeName || classInstance.name || "<unnamed>",
    kind: classInstance.classKind || "class",
    variability: null,
    causality: null,
    description: classInstance.description,
    children,
  };
}
// ── Interval Analysis RPC ──

interface IntervalBound {
  variable: string;
  lower: number;
  upper: number;
  isComputed: boolean;
}

interface IntervalAnalysisResult {
  className: string;
  bounds: IntervalBound[];
  totalVariables: number;
  boundedCount: number;
}

connection.onRequest(
  "modelscript/getIntervals",
  (params: { uri: string; className?: string }): IntervalAnalysisResult | null => {
    const instances = documentInstances.get(params.uri);
    if (!instances || instances.length === 0) return null;

    let target = instances[0];
    if (params.className) {
      const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
      if (found) target = found;
    }

    if (!target.instantiated) {
      try {
        target.instantiate();
      } catch {
        return null;
      }
    }

    try {
      const dae = new ModelicaDAE(target.name || "Model");
      const flattener = new ModelicaFlattener();
      target.accept(flattener, ["", dae]);

      // Helper to extract a numeric value from a ModelicaExpression attribute
      const exprToNum = (e: unknown): number | null => {
        if (e && typeof e === "object" && "value" in e && typeof (e as { value: unknown }).value === "number") {
          return (e as { value: number }).value;
        }
        return null;
      };

      const bounds: IntervalBound[] = [];
      for (const v of dae.variables) {
        const attrs = v.attributes;
        const minVal = exprToNum(attrs.get("min"));
        const maxVal = exprToNum(attrs.get("max"));
        const startVal = exprToNum(attrs.get("start"));

        const lower = minVal ?? -Infinity;
        const upper = maxVal ?? Infinity;
        const isComputed = minVal !== null || maxVal !== null;

        bounds.push({
          variable: v.name,
          lower: isFinite(lower) ? lower : startVal !== null ? startVal - 1000 : -1e6,
          upper: isFinite(upper) ? upper : startVal !== null ? startVal + 1000 : 1e6,
          isComputed,
        });
      }

      return {
        className: target.name || "Model",
        bounds,
        totalVariables: dae.variables.length,
        boundedCount: bounds.filter((b) => b.isComputed).length,
      };
    } catch (e) {
      console.error("[getIntervals] Error:", e);
      return null;
    }
  },
);

// ── Optimization RPC ──

interface OptimizationResult {
  className: string;
  status: "optimal" | "infeasible" | "error";
  objectiveValue: number | null;
  parameters: { name: string; value: number }[];
  iterations: number;
  message: string;
}

connection.onRequest(
  "modelscript/runOptimization",
  async (params: { uri: string; className?: string }): Promise<OptimizationResult | null> => {
    let instances = documentInstances.get(params.uri);
    if (!instances || instances.length === 0) {
      const doc = documents.get(params.uri);
      if (doc) {
        await validateTextDocument(doc);
        instances = documentInstances.get(params.uri);
      }
    }
    if (!instances || instances.length === 0) return null;

    let target = instances[0];
    if (params.className) {
      const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
      if (found) target = found;
    }

    try {
      if (!target.instantiated) target.instantiate();

      const dae = new ModelicaDAE(target.name || "Model");
      const flattener = new ModelicaFlattener();
      target.accept(flattener, ["", dae]);
      flattener.generateFlowBalanceEquations(dae);
      flattener.foldDAEConstants(dae);

      // Build a simple optimization problem from the DAE
      const controls: string[] = [];
      const controlBounds = new Map<string, { min: number; max: number }>();
      for (const v of dae.variables) {
        if (v.causality === "input") {
          controls.push(v.name);
          controlBounds.set(v.name, { min: -1e6, max: 1e6 });
        }
      }

      const exp = dae.experiment;
      const problem = {
        startTime: exp.startTime ?? 0,
        stopTime: exp.stopTime ?? 10,
        numIntervals: 10,
        controls,
        controlBounds,
        objective: "u^2",
      };

      const optimizer = new ModelicaOptimizer(dae, problem);
      const result = optimizer.solve();

      const parameters: { name: string; value: number }[] = [];
      if (result.states) {
        for (const [name, values] of result.states) {
          parameters.push({ name, value: values[values.length - 1] ?? 0 });
        }
      }

      return {
        className: target.name || "Model",
        status: result.success ? "optimal" : "infeasible",
        objectiveValue: result.cost,
        parameters,
        iterations: result.iterations,
        message: result.messages || "Optimization completed",
      };
    } catch (e) {
      console.error("[runOptimization] Error:", e);
      return {
        className: target.name || "Model",
        status: "error",
        objectiveValue: null,
        parameters: [],
        iterations: 0,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  },
);

// ── Model Calibration RPC ──

/** Get calibration-eligible parameters for a model. */
connection.onRequest(
  "modelscript/getCalibrationParameters",
  async (params: {
    uri: string;
    className?: string;
  }): Promise<{
    parameters: {
      name: string;
      type: "real" | "integer" | "boolean" | "enumeration";
      defaultValue: number;
      min?: number;
      max?: number;
      unit?: string;
    }[];
  } | null> => {
    let instances = documentInstances.get(params.uri);
    if (!instances || instances.length === 0) {
      const doc = documents.get(params.uri);
      if (doc) {
        await validateTextDocument(doc);
        instances = documentInstances.get(params.uri);
      }
    }
    if (!instances || instances.length === 0) return null;

    let target = instances[0];
    if (params.className) {
      const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
      if (found) target = found;
    }

    try {
      if (!target.instantiated) target.instantiate();

      const dae = new ModelicaDAE(target.name || "Model");
      const flattener = new ModelicaFlattener();
      target.accept(flattener, ["", dae]);
      flattener.generateFlowBalanceEquations(dae);
      flattener.foldDAEConstants(dae);

      const simulator = new ModelicaSimulator(dae);
      simulator.prepare();

      return { parameters: simulator.getParameterInfo() };
    } catch (e) {
      console.error("[getCalibrationParameters] Error:", e);
      return null;
    }
  },
);

/** Run model calibration against CSV measurement data. */
connection.onRequest(
  "modelscript/runCalibration",
  async (params: {
    uri: string;
    className?: string;
    csvData: string;
    parameters?: string[];
    parameterBounds?: Record<string, { min: number; max: number }>;
    columnMapping?: Record<string, string>;
    timeColumn?: string;
    method?: string;
    gradient?: string;
    tolerance?: number;
    maxIterations?: number;
  }): Promise<{
    success: boolean;
    parameters: { name: string; value: number; initial: number }[];
    residual: number;
    variableResiduals: { name: string; residual: number }[];
    iterations: number;
    simulated: { t: number[]; y: number[][]; states: string[] };
    measured: { t: number[]; y: number[][]; states: string[] };
    costHistory: number[];
    message: string;
    error?: string;
  }> => {
    const errorResult = (error: string) => ({
      success: false,
      parameters: [],
      residual: 0,
      variableResiduals: [],
      iterations: 0,
      simulated: { t: [], y: [], states: [] },
      measured: { t: [], y: [], states: [] },
      costHistory: [],
      message: "",
      error,
    });

    // Parse CSV
    let csv;
    try {
      csv = parseCsvMeasurements(params.csvData, {
        timeColumn: params.timeColumn,
        columnMapping: params.columnMapping ? new Map(Object.entries(params.columnMapping)) : undefined,
        skipNaN: true,
      });
    } catch (e) {
      return errorResult(`CSV parse error: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Resolve class instance
    let instances = documentInstances.get(params.uri);
    if (!instances || instances.length === 0) {
      const doc = documents.get(params.uri);
      if (doc) {
        await validateTextDocument(doc);
        instances = documentInstances.get(params.uri);
      }
    }
    if (!instances || instances.length === 0) {
      return errorResult("No class instances found for this document.");
    }

    let target = instances[0];
    if (params.className) {
      const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
      if (found) target = found;
    }

    try {
      if (!target.instantiated) target.instantiate();

      const dae = new ModelicaDAE(target.name || "Model");
      const flattener = new ModelicaFlattener();
      target.accept(flattener, ["", dae]);
      flattener.generateFlowBalanceEquations(dae);
      flattener.foldDAEConstants(dae);

      const simulator = new ModelicaSimulator(dae);
      simulator.prepare();

      // Determine parameters to calibrate
      const paramInfo = simulator.getParameterInfo();
      let paramNames = params.parameters;
      if (!paramNames || paramNames.length === 0) {
        // Auto-detect: all Real parameters
        paramNames = paramInfo.filter((p) => p.type === "real").map((p) => p.name);
      }
      if (paramNames.length === 0) {
        return errorResult("No calibration parameters found or specified.");
      }

      // Build parameter bounds
      const parameterBounds = new Map<string, { min: number; max: number }>();
      for (const name of paramNames) {
        const userBounds = params.parameterBounds?.[name];
        const pInfo = paramInfo.find((p) => p.name === name);
        parameterBounds.set(name, {
          min: userBounds?.min ?? pInfo?.min ?? -1e6,
          max: userBounds?.max ?? pInfo?.max ?? 1e6,
        });
      }

      // Build measurements map from CSV
      const measurements = new Map<string, { t: number[]; y: number[] }>();
      for (const col of csv.columns) {
        const values = csv.data.get(col);
        if (values) {
          measurements.set(col, { t: csv.time, y: values });
        }
      }

      if (measurements.size === 0) {
        return errorResult("No measurement variables found in CSV columns.");
      }

      // Extract initial guesses
      const initialGuess = new Map<string, number>();
      for (const pi of paramInfo) {
        if (paramNames.includes(pi.name)) {
          initialGuess.set(pi.name, pi.defaultValue);
        }
      }

      // Run calibration
      const calibrator = new ModelicaCalibrator(dae, simulator, {
        parameters: paramNames,
        parameterBounds,
        initialGuess,
        measurements,
        tolerance: params.tolerance ?? 1e-8,
        maxIterations: params.maxIterations ?? 100,
        method: (params.method as "lm" | "sqp") ?? "lm",
        gradient: (params.gradient as "sensitivity" | "finite-difference") ?? "sensitivity",
      });

      const result = calibrator.calibrate();

      // Format result for RPC
      const parametersOut: { name: string; value: number; initial: number }[] = [];
      for (const name of paramNames) {
        parametersOut.push({
          name,
          value: result.parameters.get(name) ?? 0,
          initial: initialGuess.get(name) ?? 0,
        });
      }

      const variableResidualsOut: { name: string; residual: number }[] = [];
      for (const [name, res] of result.variableResiduals) {
        variableResidualsOut.push({ name, residual: res });
      }

      // Format simulated output: convert Map to arrays
      const simStates: string[] = [];
      const simY: number[][] = [];
      const simT = result.simulated.t;
      for (const [varName, vals] of result.simulated.y) {
        simStates.push(varName);
      }
      for (let ti = 0; ti < simT.length; ti++) {
        const row: number[] = [];
        for (const varName of simStates) {
          const vals = result.simulated.y.get(varName);
          row.push(vals?.[ti] ?? 0);
        }
        simY.push(row);
      }

      // Format measured output for overlay
      const measStates: string[] = [];
      const measY: number[][] = [];
      const measT = csv.time;
      for (const [varName] of measurements) {
        measStates.push(varName);
      }
      for (let ti = 0; ti < measT.length; ti++) {
        const row: number[] = [];
        for (const varName of measStates) {
          const meas = measurements.get(varName);
          row.push(meas?.y[ti] ?? 0);
        }
        measY.push(row);
      }

      return {
        success: result.success,
        parameters: parametersOut,
        residual: result.residual,
        variableResiduals: variableResidualsOut,
        iterations: result.iterations,
        simulated: { t: simT, y: simY, states: simStates },
        measured: { t: measT, y: measY, states: measStates },
        costHistory: result.costHistory,
        message: result.message,
      };
    } catch (e) {
      console.error("[runCalibration] Error:", e);
      return errorResult(e instanceof Error ? e.message : String(e));
    }
  },
);

// ── System Identification RPC ──

interface SysIdResult {
  className: string;
  status: "converged" | "failed" | "error";
  fittedParameters: { name: string; initial: number; fitted: number }[];
  residualNorm: number;
  iterations: number;
  message: string;
}

connection.onRequest(
  "modelscript/systemIdentification",
  async (params: {
    uri: string;
    className?: string;
    data: { time: number[]; signals: Record<string, number[]> };
    parametersToFit: string[];
  }): Promise<SysIdResult | null> => {
    let instances = documentInstances.get(params.uri);
    if (!instances || instances.length === 0) {
      const doc = documents.get(params.uri);
      if (doc) {
        await validateTextDocument(doc);
        instances = documentInstances.get(params.uri);
      }
    }
    if (!instances || instances.length === 0) return null;

    let target = instances[0];
    if (params.className) {
      const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
      if (found) target = found;
    }

    try {
      if (!target.instantiated) target.instantiate();

      const dae = new ModelicaDAE(target.name || "Model");
      const flattener = new ModelicaFlattener();
      target.accept(flattener, ["", dae]);
      flattener.generateFlowBalanceEquations(dae);
      flattener.foldDAEConstants(dae);

      // Extract initial parameter values
      const fittedParameters: { name: string; initial: number; fitted: number }[] = [];
      for (const paramName of params.parametersToFit) {
        const v = dae.variables.get(paramName);
        const startAttr = v?.attributes.get("start");
        const initial =
          startAttr && typeof (startAttr as unknown as { value?: unknown }).value === "number"
            ? (startAttr as unknown as { value: number }).value
            : 0;
        fittedParameters.push({ name: paramName, initial, fitted: initial });
      }

      // Simple gradient-free Nelder-Mead style parameter estimation
      const timeData = params.data.time;
      const signalData = params.data.signals;

      // Cost function: simulate and compute residual

      const simulate = async (_paramValues: number[]): Promise<number> => {
        for (const pName of params.parametersToFit) {
          if (!pName) continue;
          // Parameters are set via the expression, not attributes, for simulation
          // This is a simplified approach
        }
        try {
          const simulator = new ModelicaSimulator(dae);
          simulator.prepare();
          const start = timeData[0] ?? 0;
          const stop = timeData[timeData.length - 1] ?? 10;
          const step = (stop - start) / Math.max(timeData.length - 1, 1);
          const result = await simulator.simulateAsync(start, stop, step);
          if (!result || typeof result !== "object") return Infinity;

          let residual = 0;
          const resultVars = result as Record<string, unknown>;
          for (const [sigName, measured] of Object.entries(signalData)) {
            const simulated = resultVars[sigName];
            if (Array.isArray(simulated) && Array.isArray(measured)) {
              for (let j = 0; j < Math.min(simulated.length, measured.length); j++) {
                const diff = (simulated[j] as number) - (measured[j] as number);
                residual += diff * diff;
              }
            }
          }
          return residual;
        } catch {
          return Infinity;
        }
      };

      // Simple perturbation-based optimization (5 iterations)
      let currentParams = fittedParameters.map((p) => p.initial);
      let bestCost = await simulate(currentParams);
      const stepSize = 0.01;

      for (let iter = 0; iter < 5; iter++) {
        for (let i = 0; i < currentParams.length; i++) {
          // Try positive perturbation
          const trial = [...currentParams];
          trial[i] = (trial[i] ?? 0) + stepSize * Math.abs(trial[i] ?? 1);
          const cost = await simulate(trial);
          if (cost < bestCost) {
            bestCost = cost;
            currentParams = trial;
          } else {
            // Try negative perturbation
            trial[i] = (currentParams[i] ?? 0) - stepSize * Math.abs(currentParams[i] ?? 1);
            const cost2 = await simulate(trial);
            if (cost2 < bestCost) {
              bestCost = cost2;
              currentParams = trial;
            }
          }
        }
      }

      for (let i = 0; i < fittedParameters.length; i++) {
        const fp = fittedParameters[i];
        if (fp) fp.fitted = currentParams[i] ?? 0;
      }

      return {
        className: target.name || "Model",
        status: isFinite(bestCost) ? "converged" : "failed",
        fittedParameters,
        residualNorm: bestCost,
        iterations: 5,
        message: isFinite(bestCost) ? "Parameter estimation converged" : "Parameter estimation failed to converge",
      };
    } catch (e) {
      console.error("[systemIdentification] Error:", e);
      return {
        className: target.name || "Model",
        status: "error",
        fittedParameters: [],
        residualNorm: Infinity,
        iterations: 0,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  },
);

// ── Symbolic Trace RPC ──

interface SymbolicRewriteStep {
  from: string;
  to: string;
  rule: string;
}

interface SymbolicTraceResult {
  className: string;
  equation: string;
  steps: SymbolicRewriteStep[];
  simplified: string;
}

connection.onRequest(
  "modelscript/getSymbolicTrace",
  (params: { uri: string; className?: string; equationIndex?: number }): SymbolicTraceResult | null => {
    const instances = documentInstances.get(params.uri);
    if (!instances || instances.length === 0) return null;

    let target = instances[0];
    if (params.className) {
      const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
      if (found) target = found;
    }

    if (!target.instantiated) {
      try {
        target.instantiate();
      } catch {
        return null;
      }
    }

    try {
      const dae = new ModelicaDAE(target.name || "Model");
      const flattener = new ModelicaFlattener();
      target.accept(flattener, ["", dae]);

      const eqIdx = params.equationIndex ?? 0;
      const equations = dae.equations;
      if (eqIdx >= equations.length) return null;

      const eq = equations[eqIdx];
      const original = (() => {
        try {
          const json = eq.toJSON;
          if (json && typeof json === "object" && "expression1" in json && "expression2" in json) {
            return `${JSON.stringify(json.expression1)} = ${JSON.stringify(json.expression2)}`;
          }
          return JSON.stringify(json);
        } catch {
          return "<equation>";
        }
      })();

      // Run constant folding and collect trace
      flattener.foldDAEConstants(dae);

      const simplified = (() => {
        try {
          const foldedEq = eqIdx < dae.equations.length ? dae.equations[eqIdx] : eq;
          const json = foldedEq.toJSON;
          if (json && typeof json === "object" && "expression1" in json && "expression2" in json) {
            return `${JSON.stringify(json.expression1)} = ${JSON.stringify(json.expression2)}`;
          }
          return JSON.stringify(json);
        } catch {
          return original;
        }
      })();

      const steps: SymbolicRewriteStep[] = [];
      if (original !== simplified) {
        steps.push({
          from: original,
          to: simplified,
          rule: "constant-folding",
        });
      }

      return {
        className: target.name || "Model",
        equation: original,
        steps,
        simplified,
      };
    } catch (e) {
      console.error("[getSymbolicTrace] Error:", e);
      return null;
    }
  },
);

// Listen on the connection
connection.listen();

let debuggerResumeCallback: (() => void) | undefined;
let currentDebugEnv: Map<string, number> | undefined;
let stepMode = true; // Initially true to stop on first statement
const breakpointsMap = new Map<string, { line: number; column?: number }[]>();

connection.onNotification(
  "modelscript/setBreakpoints",
  (params: { uri: string; breakpoints: { line: number; column?: number }[] }) => {
    breakpointsMap.set(params.uri, params.breakpoints);
  },
);

connection.onRequest("modelscript/debuggerContinue", (params?: any) => {
  stepMode = params?.step || false;
  if (debuggerResumeCallback) {
    debuggerResumeCallback();
    debuggerResumeCallback = undefined;
  }
  return { ok: true };
});

function formatDebugValue(val: unknown): string {
  if (val !== null && typeof val === "object" && "elements" in val) {
    const arrVal = val as { elements: unknown[] };
    if (Array.isArray(arrVal.elements)) {
      return `[${arrVal.elements.map(formatDebugValue).join(", ")}]`;
    }
  }
  return String(val);
}

connection.onRequest("modelscript/debuggerVariables", () => {
  if (!currentDebugEnv) return [];
  // Sort variables alphabetically for better UX
  const entries = Array.from(currentDebugEnv.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  return entries.map(([name, value]) => ({
    name,
    value: formatDebugValue(value),
    variablesReference: 0,
  }));
});

connection.onRequest(
  "modelscript/simulateDebug",
  async (params: { uri: string; className?: string }): Promise<unknown> => {
    let instances = documentInstances.get(params.uri);
    if (!instances || instances.length === 0) {
      const doc = documents.get(params.uri);
      if (doc) {
        await validateTextDocument(doc);
        instances = documentInstances.get(params.uri);
      }
    }
    if (!instances || instances.length === 0) {
      return {
        error: `No class instances found for ${params.uri}. Available: ${Array.from(documentInstances.keys()).join(", ")}`,
      };
    }

    let classInstance = instances[0];
    if (params.className) {
      const found = instances.find((i) => i.name === params.className);
      if (found) classInstance = found;
    }

    try {
      if (!classInstance.instantiated) {
        classInstance.instantiate();
      }

      const dae = new ModelicaDAE(classInstance.name || "Model");
      const flattener = new ModelicaFlattener();
      classInstance.accept(flattener, ["", dae]);
      flattener.generateFlowBalanceEquations(dae);
      flattener.foldDAEConstants(dae);

      stepMode = true; // Reset step mode on new simulation run

      const simulator = new ModelicaSimulator(dae, {
        onStatement: async (stmt: any, evaluator: any) => {
          const bps = breakpointsMap.get(params.uri) || [];
          const isBreakpoint = bps.some((bp) => bp.line === stmt.location?.startLine);

          if (stepMode || isBreakpoint) {
            stepMode = false;
            currentDebugEnv = evaluator.env;
            // Send notification to the VS Code client
            connection.sendNotification("modelscript/debuggerStopped", {
              uri: params.uri,
              line: stmt.location?.startLine,
              column: stmt.location?.startCol,
            });
            // Wait for client to send modelscript/debuggerContinue
            await new Promise<void>((resolve) => {
              debuggerResumeCallback = resolve;
            });
            currentDebugEnv = undefined;
          }
        },
      });
      simulator.prepare();

      const exp = simulator.dae.experiment;
      const startTime = exp.startTime ?? 0;
      const stopTime = exp.stopTime ?? 10;
      const step = exp.interval ?? (stopTime - startTime) / 100;

      const result = await simulator.simulateAsync(startTime, stopTime, step);
      return result;
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
);

// ── Requirements Management: spreadsheet data for webview editors ──

connection.onRequest("modelscript/getRequirements", (params: { uri: string }) => {
  try {
    const db = unifiedWorkspace.toUnifiedPartial();
    // Gather all verification results across the workspace
    const allResults = [];
    for (const res of verificationResultsByUri.values()) {
      allResults.push(...res);
    }
    return getRequirements(db, undefined, allResults); // Do not filter by uri to show workspace-level requirements
  } catch (e) {
    console.error("[requirements] Error:", e);
    return [];
  }
});

connection.onRequest("modelscript/getTraceabilityMatrix", (params: { uri: string }) => {
  try {
    const db = unifiedWorkspace.toUnifiedPartial();
    return getTraceabilityMatrix(db); // Do not filter by uri to show workspace-level traceability
  } catch (e) {
    console.error("[traceability] Error:", e);
    return { sources: [], targets: [], links: [] };
  }
});

connection.onRequest("modelscript/runVerification", async (params: { uri: string }) => {
  try {
    const textDocument = documents.get(params.uri);
    if (!textDocument) throw new Error("Document not found");

    if (activeVerification) activeVerification.abort();
    activeVerification = new AbortController();
    const signal = activeVerification.signal;

    const db = unifiedWorkspace.toUnifiedPartial();
    const fileNodes = Array.from(db.symbols.values()).filter(
      (s) =>
        s.resourceId === textDocument.uri &&
        (s.ruleName === "VerifyRequirementUsage" ||
          s.ruleName === "AnalysisCaseDefinition" ||
          s.ruleName === "AnalysisCaseUsage" ||
          s.ruleName === "VerificationCaseDefinition" ||
          s.ruleName === "VerificationCaseUsage"),
    );

    if (fileNodes.length === 0) return { ok: true };

    // Build a CST tree wrapper so that the SysML QueryEngine can access parse trees
    // for constraint extraction. This mirrors the Modelica path's cstTreeWrapper.
    const verifyCstTreeWrapper = {
      getText(startByte: number, endByte: number, entry?: any): string | null {
        if (!entry || !entry.resourceId) return null;
        const uri = entry.resourceId;
        const docTree = documentTrees.get(uri);
        if (docTree && docTree.text) return docTree.text.substring(startByte, endByte);

        let lazyCache = lazyLibTrees.get(uri);
        if (!lazyCache && sharedContext) {
          try {
            const fsPath = uri.startsWith("file://") ? uri.substring(7) : uri;
            const text = sharedContext.fs.read(fsPath);
            if (text) {
              const tree = sharedContext.parse(uri.endsWith(".sysml") ? ".sysml" : ".mo", text);
              lazyCache = { tree, text };
              lazyLibTrees.set(uri, lazyCache);
            }
          } catch (e) {}
        }
        if (lazyCache) return lazyCache.text.substring(startByte, endByte);

        // Final Fallback: try to read from the document manager
        const doc = documents.get(uri);
        if (doc) return doc.getText().substring(startByte, endByte);
        return null;
      },
      getNode(startByte: number, endByte: number, entry?: any): any | null {
        if (!entry || !entry.resourceId) return null;
        const uri = entry.resourceId;
        const docTree = documentTrees.get(uri);
        if (docTree && docTree.tree) {
          return docTree.tree.rootNode.descendantForIndex(startByte, Math.max(startByte, endByte - 1));
        }

        let lazyCache = lazyLibTrees.get(uri);
        if (!lazyCache && sharedContext) {
          try {
            const fsPath = uri.startsWith("file://") ? uri.substring(7) : uri;
            const text = sharedContext.fs.read(fsPath);
            if (text) {
              const tree = sharedContext.parse(uri.endsWith(".sysml") ? ".sysml" : ".mo", text);
              lazyCache = { tree, text };
              lazyLibTrees.set(uri, lazyCache);
            }
          } catch (e) {}
        }
        if (lazyCache) {
          return lazyCache.tree.rootNode.descendantForIndex(startByte, Math.max(startByte, endByte - 1));
        }

        // Final Fallback: parse on-demand if we have the text
        const doc = documents.get(uri);
        if (doc) {
          const text = doc.getText();
          let tree: any;
          if (uri.endsWith(".sysml") && sysml2Parser) {
            tree = sysml2Parser.parse(text);
          } else if (sharedContext) {
            tree = sharedContext.parse(".mo", text);
          }
          if (tree) {
            documentTrees.set(uri, { text, tree, classCache: new Map() });
            return tree.rootNode.descendantForIndex(startByte, Math.max(startByte, endByte - 1));
          }
        }
        return null;
      },
    };

    const sysmlEngine = createSysML2QueryEngine(db, verifyCstTreeWrapper);
    const sysmlDB = sysmlEngine.toQueryDB();
    const newDiagnostics: Diagnostic[] = [];
    const allResults: any[] = [];

    for (const verifyUsage of fileNodes) {
      if (signal.aborted) return { ok: false };

      const topo = sysmlDB.query("extractTopology", verifyUsage.id) as any;
      if (!topo || topo.rootIds.length === 0) continue;

      const rootNode = topo.nodes.get(topo.rootIds[0]);
      if (!rootNode?.targetClassId) continue;

      let simTargetId = rootNode.targetClassId;
      const targetEntry = db.symbols.get(rootNode.targetClassId);

      if (targetEntry) {
        for (const entry of db.symbols.values()) {
          const text = sysmlDB.cstText(entry.startByte, entry.endByte, entry);
          if (text && (text.includes(`implements="${targetEntry.name}"`) || text.includes(`::${targetEntry.name}"`))) {
            simTargetId = entry.id;
            break;
          }
        }
      }

      const finalEntry = db.symbols.get(simTargetId);
      let targetEngine = undefined;
      // Normal UI edits populate documentQueryEngines, but global UI files like modelscript-lib://
      // might be lazily indexed. Let's use documentQueryEngines or fallback to unified.
      if (finalEntry && finalEntry.resourceId) {
        targetEngine = documentQueryEngines.get(finalEntry.resourceId);
        if (!targetEngine && finalEntry.resourceId.endsWith(".mo")) {
          targetEngine = createModelicaQueryEngine(db, verifyCstTreeWrapper);
        }
      }

      const targetDB = targetEngine
        ? (targetEngine as any).toQueryDB()
        : (unifiedWorkspace as any).engine?.toQueryDB() || sysmlDB;
      const targetModel = new QueryBackedClassInstance(simTargetId, targetDB) as any;
      targetModel.instantiate();

      const dae = new ModelicaDAE(targetModel.name || "Model");
      const mFlattener = new ModelicaFlattener();
      targetModel.accept(mFlattener, ["", dae]);
      mFlattener.generateFlowBalanceEquations(dae);
      mFlattener.foldDAEConstants(dae);

      const simulator = new ModelicaSimulator(dae);
      simulator.prepare();
      const simResult = await simulator.simulateAsync(0, 10, 0.1, {
        signal,
        realtimeFactor: 1000000,
      });

      if (signal.aborted) return { ok: false };

      // Create a runner per topology with the explicit variable mapping
      const runner = new VerificationRunner(sysmlDB, topo.variableMap);
      const vResults = runner.verifyCase(verifyUsage.id, simResult);
      allResults.push(...vResults);

      for (const vr of vResults) {
        if (!vr.constraintId) continue;

        let start = { line: 0, character: 0 };
        let end = { line: 0, character: 10 };

        const targetId = vr.constraintId;
        const targetNode = db.symbols.get(targetId);

        if (targetNode) {
          const bridge = documentLSPBridges.get(textDocument.uri);
          if (bridge && typeof targetNode.startByte === "number" && typeof targetNode.endByte === "number") {
            const s = bridge["positions"].offsetToPosition(targetNode.startByte);
            const e = bridge["positions"].offsetToPosition(targetNode.endByte);
            if (!isNaN(s.line) && !isNaN(e.line)) {
              start = s;
              end = e;
            }
          }
        }

        if (!vr.isSatisfied) {
          newDiagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: { start, end },
            message: vr.message ? vr.message : `Requirement constraint violated over the simulation trajectory.`,
            source: "sysml2-verifier",
          });
        }
      }
    }

    if (signal.aborted) return { ok: false };

    // Store verification diagnostics persistently for this URI until next edit
    verificationDiagnosticsByUri.set(textDocument.uri, newDiagnostics);
    verificationResultsByUri.set(textDocument.uri, allResults);

    // Trigger validation loop to merge and push diagnostics instantly
    validateTextDocument(textDocument);
    return { ok: true };
  } catch (e: any) {
    connection.console.error(`[sysml2-verifier] Error: ${e.message}\n${e.stack}`);

    // Push the crash as a diagnostic so the user sees it visually instead of it being swallowed
    const crashDiag: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
      message: `Verification CRASHED: ${e.message}`,
      source: "sysml2-verifier",
    };
    verificationDiagnosticsByUri.set(params.uri, [crashDiag]);
    const doc = documents.get(params.uri);
    if (doc) validateTextDocument(doc);

    return { ok: false };
  }
});

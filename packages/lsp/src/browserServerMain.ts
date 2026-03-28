import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser";

import {
  CodeAction,
  CodeActionKind,
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
  computeComponentsDelete,
  computeConnectInsert,
  computeConnectRemove,
  computeDescriptionEdit,
  computeEdgePointEdits,
  computeNameEdit,
  computeParameterEdit,
  computePlacementEdits,
} from "./diagramEdits";

import { Language, Parser, Node as SyntaxNode, Tree as TreeSitterTree } from "web-tree-sitter";

import { unzipSync } from "fflate";

import {
  Context,
  ModelicaClassDefinitionSyntaxNode,
  ModelicaClassInstance,
  ModelicaClassKind,
  ModelicaComponentDeclarationSyntaxNode,
  ModelicaComponentInstance,
  ModelicaComponentReferenceSyntaxNode,
  ModelicaDAE,
  ModelicaElement,
  ModelicaEnumerationClassInstance,
  ModelicaFlattener,
  ModelicaFmuEntity,
  ModelicaFunctionCallSyntaxNode,
  ModelicaInterpreter,
  ModelicaLibrary,
  ModelicaLinter,
  ModelicaNamedElement,
  ModelicaOptimizer,
  ModelicaProcedureCallStatementSyntaxNode,
  ModelicaScriptScope,
  ModelicaSimpleAssignmentStatementSyntaxNode,
  ModelicaSimulator,
  ModelicaStoredDefinitionSyntaxNode,
  ModelicaSyntaxNode,
  Scope,
  registerOptimizeDeps,
  registerSimulateDeps,
  type Dirent,
  type FileSystem,
  type IDiagram,
  type Range,
  type Stats,
} from "@modelscript/core";

// Register flattener/simulator constructors for the scripting simulate() function.
// This breaks the circular dependency: interpreter → evaluate-simulate → flattener.
registerSimulateDeps({ Flattener: ModelicaFlattener, Simulator: ModelicaSimulator });
registerOptimizeDeps({ Flattener: ModelicaFlattener, Optimizer: ModelicaOptimizer });

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/* Scope wrapper for editor-level class instances (matching morsel's EditorScope) */

class EditorScope extends Scope {
  #instances: ModelicaClassInstance[];

  constructor(parent: Scope, instances: ModelicaClassInstance[]) {
    super(parent);
    this.#instances = instances;
  }

  get elements(): IterableIterator<ModelicaElement> {
    const instances = this.#instances;
    return (function* () {
      yield* instances;
    })();
  }

  readonly hash = "editor";
}

/* Per-document state for hover resolution */

const documentInstances = new Map<string, ModelicaClassInstance[]>();
const documentContexts = new Map<string, Context>();

/* Workspace-wide class instances — keyed by document URI */
const workspaceInstances = new Map<string, ModelicaClassInstance[]>();

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
          const annotationClass = ModelicaElement.annotationClassInstance;
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
      baseElement = ModelicaElement.annotationClassInstance;
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
    console.log(`[tree-sitter] extensionUri: ${extensionUri}`);
    console.log(`[tree-sitter] serverDistBase: ${serverDistBase}`);

    // If the URI isn't HTTP(S), try to construct an HTTP URL from the worker's location
    if (!serverDistBase.startsWith("http://") && !serverDistBase.startsWith("https://")) {
      // Fallback: use the worker's origin with the known static path
      const origin = (globalThis as unknown as { location?: { origin?: string } }).location?.origin;
      if (origin) {
        serverDistBase = `${origin}/static/devextensions/server/dist`;
        console.log(`[tree-sitter] Using fallback serverDistBase: ${serverDistBase}`);
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
    console.log("Tree-sitter Modelica parser initialized");

    // Load the Modelica Standard Library from the bundled zip
    await loadMSL(serverDistBase);

    // Re-validate strictly AFTER MSL and parser are ready!
    console.log(`[lsp] Initialization complete. Re-validating ${documents.all().length} open documents.`);
    for (const doc of documents.all()) {
      validateTextDocument(doc);
    }

    connection.sendNotification("modelscript/status", { state: "ready", message: "ModelScript" });
  } catch (e) {
    console.error("Failed to initialize tree-sitter:", e);
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
      sharedContext.addLibrary("/lib");
    } else {
      for (const entry of libEntries) {
        if (entry.isDirectory()) {
          try {
            sharedContext.addLibrary(`/lib/${entry.name}`);
          } catch (e) {
            console.warn(`Failed to load library from /lib/${entry.name}:`, e);
          }
        }
      }
    }
    console.log("MSL libraries registered in shared context");
  } catch (e) {
    console.error("Failed to load MSL zip:", e);
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
  // Get the extension URI from initializationOptions
  const extensionUri = params.initializationOptions?.extensionUri as string;
  if (extensionUri) {
    initTreeSitter(extensionUri);
  } else {
    console.warn("No extensionUri provided — tree-sitter disabled");
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
  };
  return { capabilities };
});

// Track open, change and close text document events
const documents = new TextDocuments(TextDocument);
documents.listen(connection);

// Validate documents when they change, and re-validate other open docs for cross-file resolution
let revalidationTimer: ReturnType<typeof setTimeout> | null = null;

documents.onDidChangeContent((change) => {
  validateTextDocument(change.document);

  // Short debounce: batch rapid-fire opens from workspace scanning, then re-validate all
  if (revalidationTimer) clearTimeout(revalidationTimer);
  revalidationTimer = setTimeout(() => {
    console.log(`[cross-file] re-validating all ${documents.all().length} open documents`);
    for (const doc of documents.all()) {
      validateTextDocument(doc);
    }
  }, 200);
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

  // Handle FMU archive files
  if (textDocument.uri.endsWith(".fmu")) {
    try {
      const context = sharedContext ?? new Context(sharedFs);
      const baseName =
        textDocument.uri
          .split("/")
          .pop()
          ?.replace(/\.fmu$/, "") ?? "FMU";
      // The document text is the raw bytes encoded as a string — convert to Uint8Array
      const fmuBytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) {
        fmuBytes[i] = text.charCodeAt(i);
      }
      const fmuEntity = ModelicaFmuEntity.fromFmu(context, baseName, fmuBytes);
      fmuEntity.load();
      fmuEntity.instantiate();
      workspaceInstances.set(textDocument.uri, [fmuEntity]);
      console.log(`[fmu] Registered FMU entity '${baseName}' from ${textDocument.uri}`);
      // Re-validate all .mo documents to pick up the new FMU class
      for (const doc of documents.all()) {
        if (doc.uri !== textDocument.uri && doc.uri.endsWith(".mo")) {
          validateTextDocument(doc);
        }
      }
    } catch (e) {
      console.error("[fmu] Failed to create FMU entity:", e);
    }
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
    return;
  }

  if (parserReady && parser) {
    // Full tree-sitter + ModelicaLinter pipeline (matching morsel's processContent)
    // Use the shared context (with MSL loaded) when available, otherwise a bare context
    const context = sharedContext ?? new Context(sharedFs);
    const linter = new ModelicaLinter(
      (
        _type: string,
        _code: number,
        message: string,
        _resource: string | null | undefined,
        range: Range | null | undefined,
      ) => {
        if (!range) return;
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: range.startPosition.row, character: range.startPosition.column },
            end: { line: range.endPosition.row, character: range.endPosition.column },
          },
          message,
          source: "modelscript",
        });
      },
    );

    // Parse with tree-sitter (incremental when possible)
    const oldCached = documentTrees.get(textDocument.uri);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // Lint the raw parse tree (catches ERROR and MISSING nodes)
    linter.lint(tree, textDocument.uri);

    // Build syntax nodes and lint them
    const node = ModelicaStoredDefinitionSyntaxNode.new(null, tree.rootNode);
    if (node) {
      linter.lint(node, textDocument.uri);

      // Resolve the within directive to find the correct parent scope (matching morsel)
      let parentScope: Scope = context;
      const withinParts = node.withinDirective?.packageName?.parts;
      if (withinParts && withinParts.length > 0) {
        const withinNames = withinParts.map((p) => p.text).filter((t): t is string => t !== null && t !== undefined);
        const resolved = context.resolveName(withinNames);
        if (resolved) {
          parentScope = resolved;
          console.log(`[cross-file] within '${withinNames.join(".")}' resolved from MSL context`);
        } else {
          // Try to find the within-package among workspace instances
          for (const instances of workspaceInstances.values()) {
            for (const inst of instances) {
              if (inst.name === withinNames[0]) {
                let target: ModelicaNamedElement | null = inst;
                for (let i = 1; i < withinNames.length && target; i++) {
                  target = target.resolveSimpleName(withinNames[i], false, true);
                }
                if (target instanceof ModelicaClassInstance) {
                  parentScope = target;
                  console.log(`[cross-file] within '${withinNames.join(".")}' resolved from workspace instances`);
                }
                break;
              }
            }
            if (parentScope !== context) break;
          }
          if (parentScope === context) {
            console.log(`[cross-file] within '${withinNames.join(".")}' could not be resolved`);
          }
        }
      }

      // Collect instances from all other open documents for cross-file resolution
      const allInstances: ModelicaClassInstance[] = [];
      for (const [uri, instances] of workspaceInstances) {
        if (uri !== textDocument.uri) {
          allInstances.push(...instances);
        }
      }
      console.log(
        `[cross-file] ${textDocument.uri.split("/").pop()}: ${allInstances.length} cross-file instances, ${workspaceInstances.size} total docs`,
      );

      // Instantiate classes from this document — reuse unchanged classes
      const thisDocInstances: ModelicaClassInstance[] = [];
      const combinedInstances = [...allInstances, ...thisDocInstances];
      const editorScope = new EditorScope(parentScope, combinedInstances);
      const prevClassCache = oldCached?.classCache ?? new Map<string, CachedClassEntry>();
      const newClassCache = new Map<string, CachedClassEntry>();
      const isIncremental = oldCached && oldCached.text !== text;

      // Helper to get class name from a class definition's CST node
      const getClassDefName = (classDef: ModelicaClassDefinitionSyntaxNode): string | null => {
        return classDef.identifier?.text ?? null;
      };

      // Two-pass: first create all instances (so they're visible as siblings)
      let reusedCount = 0;
      for (const classDef of node.classDefinitions) {
        const className = getClassDefName(classDef);
        const cstNode = classDef.sourceRange;
        // Check if this class definition's CST subtree is unchanged
        const cstClassNode = tree.rootNode
          .childrenForFieldName("classDefinition")
          .find((c: SyntaxNode) => cstNode && c.startIndex === cstNode.startIndex);
        const hasChanges = !isIncremental || !cstClassNode || cstClassNode.hasChanges;
        const cachedEntry = className ? prevClassCache.get(className) : null;

        if (!hasChanges && cachedEntry && className) {
          // Reuse cached instance — class subtree is unchanged
          thisDocInstances.push(cachedEntry.instance);
          combinedInstances.push(cachedEntry.instance);
          newClassCache.set(className, cachedEntry);
          // Re-emit cached diagnostics
          diagnostics.push(...cachedEntry.diagnostics);
          reusedCount++;
        } else {
          // Changed or new class — build fresh instance
          const instance = new ModelicaClassInstance(editorScope, classDef);
          thisDocInstances.push(instance);
          combinedInstances.push(instance);
          if (className) {
            // We'll fill diagnostics after instantiation
            newClassCache.set(className, { classDef, instance, diagnostics: [] });
          }
        }
      }

      // Then instantiate and lint only the new/changed instances
      for (const instance of thisDocInstances) {
        const className = instance.name;
        const cacheEntry = className ? newClassCache.get(className) : null;
        // Skip if this is a reused instance (diagnostics already emitted)
        if (cacheEntry && cacheEntry.instance === instance && cacheEntry.diagnostics.length === 0) {
          try {
            const preDiagCount = diagnostics.length;
            instance.instantiate();
            linter.lint(instance, textDocument.uri);
            // Capture diagnostics produced by this instance
            if (cacheEntry) {
              cacheEntry.diagnostics = diagnostics.slice(preDiagCount);
            }
          } catch (e) {
            console.error("Lint error for instance:", e);
          }
        }
      }

      // Update the class cache
      const cached = documentTrees.get(textDocument.uri);
      if (cached) {
        cached.classCache = newClassCache;
      }

      console.log(
        `[incremental] ${textDocument.uri.split("/").pop()}: ${thisDocInstances.length} classes, ${reusedCount} reused, ${thisDocInstances.length - reusedCount} rebuilt`,
      );

      // Cache instances for cross-file resolution and hover
      workspaceInstances.set(textDocument.uri, thisDocInstances);
      documentInstances.set(textDocument.uri, thisDocInstances);
      documentContexts.set(textDocument.uri, context);

      // For .mos script files and .monb notebook cells, lint statements (undeclared variables, invalid record fields)
      if (textDocument.uri.endsWith(".mos") || textDocument.uri.includes(".monb")) {
        lintScriptStatements(node, thisDocInstances, editorScope, diagnostics);
      }
    }
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

/* Script statement linter — validates .mos file statements */

/** Built-in function/type names that don't need declaration */
const SCRIPT_BUILTINS = new Set([
  "print",
  "abs",
  "sign",
  "sqrt",
  "ceil",
  "floor",
  "mod",
  "rem",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "exp",
  "log",
  "log10",
  "max",
  "min",
  "sum",
  "product",
  "size",
  "ndims",
  "fill",
  "zeros",
  "ones",
  "identity",
  "diagonal",
  "linspace",
  "cat",
  "array",
  "transpose",
  "symmetric",
  "der",
  "initial",
  "terminal",
  "pre",
  "edge",
  "change",
  "reinit",
  "noEvent",
  "smooth",
  "sample",
  "delay",
  "assert",
  "terminate",
  "String",
  "Integer",
  "Real",
  "Boolean",
  "true",
  "false",
  "time",
  // Scripting API
  "simulate",
]);

/**
 * Lints script statements for undeclared variable references and
 * invalid named arguments in record/class constructor calls.
 */
function lintScriptStatements(
  storedDef: ModelicaStoredDefinitionSyntaxNode,
  classInstances: ModelicaClassInstance[],
  scope: Scope,
  diagnostics: Diagnostic[],
): void {
  // Track assigned variable names
  const assignedVars = new Set<string>();
  // Map of class names to their component names (for record constructor validation)
  const classComponentNames = new Map<string, Set<string>>();
  for (const inst of classInstances) {
    if (inst.name) {
      const componentNames = new Set<string>();
      try {
        if (!inst.instantiated) inst.instantiate();
        for (const el of inst.elements) {
          if (el instanceof ModelicaComponentInstance && el.name) {
            componentNames.add(el.name);
          }
        }
      } catch {
        // ignore instantiation errors, already linted
      }
      classComponentNames.set(inst.name, componentNames);
    }
  }

  // Register variables declared in top-level script component clauses
  for (const componentClause of storedDef.componentClauses) {
    for (const decl of componentClause.componentDeclarations) {
      if (decl.declaration?.modification?.modificationExpression) {
        checkExpressionReferences(
          decl.declaration.modification.modificationExpression,
          assignedVars,
          classComponentNames,
          scope,
          diagnostics,
        );
      }
      const targetName = decl.declaration?.identifier?.text;
      if (targetName) assignedVars.add(targetName);
    }
  }

  for (const stmt of storedDef.statements) {
    if (stmt instanceof ModelicaSimpleAssignmentStatementSyntaxNode) {
      // Check RHS expressions for undeclared references
      if (stmt.source) {
        checkExpressionReferences(stmt.source, assignedVars, classComponentNames, scope, diagnostics);
      }
      // Register LHS as assigned (scripts auto-vivify variables)
      const targetName = stmt.target?.parts?.[0]?.identifier?.text;
      if (targetName) assignedVars.add(targetName);
    } else if (stmt instanceof ModelicaProcedureCallStatementSyntaxNode) {
      // Check function call arguments for undeclared references
      if (stmt.functionCallArguments) {
        for (const arg of stmt.functionCallArguments.arguments ?? []) {
          if (arg.expression) {
            checkExpressionReferences(arg.expression, assignedVars, classComponentNames, scope, diagnostics);
          }
        }
      }
      // Don't flag the function name itself as undeclared — it could be a built-in
    }
  }
}

/** Recursively check expression syntax nodes for undeclared references and invalid constructor arguments. */
function checkExpressionReferences(
  node: ModelicaSyntaxNode,
  assignedVars: Set<string>,
  classComponentNames: Map<string, Set<string>>,
  scope: Scope,
  diagnostics: Diagnostic[],
): void {
  if (node instanceof ModelicaFunctionCallSyntaxNode) {
    // Check if this is a record constructor call like A(xx=1)
    const funcName = node.functionReference?.parts?.[0]?.identifier?.text;
    if (funcName && classComponentNames.has(funcName)) {
      const validComponents = classComponentNames.get(funcName);
      // Validate named arguments
      for (const namedArg of node.functionCallArguments?.namedArguments ?? []) {
        const argName = namedArg.identifier?.text;
        const identNode = namedArg.identifier;
        if (argName && validComponents && !validComponents.has(argName) && identNode) {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
              start: { line: identNode.startPosition.row, character: identNode.startPosition.column },
              end: { line: identNode.endPosition.row, character: identNode.endPosition.column },
            },
            message: `'${argName}' is not a component of record '${funcName}'.`,
            source: "modelscript",
          });
        }
      }
    } else if (funcName && !SCRIPT_BUILTINS.has(funcName) && !scope.resolveSimpleName(funcName)) {
      const identNode = node.functionReference?.parts?.[0]?.identifier;
      if (identNode) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: identNode.startPosition.row, character: identNode.startPosition.column },
            end: { line: identNode.endPosition.row, character: identNode.endPosition.column },
          },
          message: `Unknown function or record '${funcName}'.`,
          source: "modelscript",
        });
      }
    }
    // Also check positional arguments for references
    for (const arg of node.functionCallArguments?.arguments ?? []) {
      if (arg.expression) {
        checkExpressionReferences(arg.expression, assignedVars, classComponentNames, scope, diagnostics);
      }
    }
    for (const namedArg of node.functionCallArguments?.namedArguments ?? []) {
      if (namedArg.argument?.expression) {
        checkExpressionReferences(namedArg.argument.expression, assignedVars, classComponentNames, scope, diagnostics);
      }
    }
    return;
  }

  if (node instanceof ModelicaComponentReferenceSyntaxNode) {
    // Check if the root identifier is declared
    const rootName = node.parts?.[0]?.identifier?.text;
    const identNode = node.parts?.[0]?.identifier;
    if (
      rootName &&
      !assignedVars.has(rootName) &&
      !SCRIPT_BUILTINS.has(rootName) &&
      !classComponentNames.has(rootName) &&
      !scope.resolveSimpleName(rootName) &&
      identNode
    ) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: {
          start: { line: identNode.startPosition.row, character: identNode.startPosition.column },
          end: { line: identNode.endPosition.row, character: identNode.endPosition.column },
        },
        message: `Variable '${rootName}' is used before being assigned.`,
        source: "modelscript",
      });
    }
    return;
  }

  // Recurse into child syntax nodes
  for (const key of Object.keys(node)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (node as any)[key];
    if (val instanceof ModelicaSyntaxNode) {
      checkExpressionReferences(val, assignedVars, classComponentNames, scope, diagnostics);
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (item instanceof ModelicaSyntaxNode) {
          checkExpressionReferences(item, assignedVars, classComponentNames, scope, diagnostics);
        }
      }
    }
  }
}

/* Semantic tokens provider — tree-sitter AST traversal matching morsel's code.tsx exactly */

function computeSemanticTokens(textDocument: TextDocument): SemanticTokens {
  const builder = new SemanticTokensBuilder();
  const text = textDocument.getText();

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

connection.onRequest("textDocument/semanticTokens/full", (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return { data: [] };
  }
  return computeSemanticTokens(document);
});

// Completion provider — dot-path resolution (matching morsel) + keyword fallback
connection.onCompletion((params): CompletionItem[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const position = params.position;
  const text = document.getText();
  const lines = text.split("\n");
  const lineContent = lines[position.line] ?? "";
  const textUntilPosition = lineContent.substring(0, position.character);

  // Check for dot-path completion (e.g. "SomeModel." or "Modelica.SIunits.")
  const match = textUntilPosition.match(/([a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*)\.$/);
  if (match) {
    const path = match[1];
    const instances = documentInstances.get(params.textDocument.uri);
    const context = documentContexts.get(params.textDocument.uri);
    const scope: Scope | undefined = instances?.[0] ?? context;

    if (scope) {
      const element = scope.resolveName(path.split("."));
      if (element) {
        const items: CompletionItem[] = [];
        for (const child of element.elements) {
          if (child instanceof ModelicaNamedElement && child.name) {
            items.push({
              label: child.name,
              kind: child instanceof ModelicaClassInstance ? CompletionItemKind.Class : CompletionItemKind.Field,
              detail: child.description ?? undefined,
            });
          }
        }
        return items;
      }
    }
  }

  // Fallback: keyword completions
  const allKeywords = [...keywords, ...typeKeywords];
  return allKeywords.map((kw, index) => ({
    label: kw,
    kind: CompletionItemKind.Keyword,
    data: index,
  }));
});

connection.onHover((params) => {
  if (!parserReady || !parser) {
    return null;
  }

  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const position = params.position;
  const text = document.getText();
  const lines = text.split("\n");
  const lineContent = lines[position.line] ?? "";

  // Find the word under cursor
  let wordStart = position.character;
  let wordEnd = position.character;
  while (wordStart > 0 && /[_a-zA-Z0-9]/.test(lineContent[wordStart - 1])) wordStart--;
  while (wordEnd < lineContent.length && /[_a-zA-Z0-9]/.test(lineContent[wordEnd])) wordEnd++;
  const word = lineContent.substring(wordStart, wordEnd);
  if (!word) return null;

  // Expand to full dotted path (e.g. Modelica.SIunits.Voltage)
  let start = wordStart;
  let end = wordEnd;
  while (start > 0 && (lineContent[start - 1] === "." || /[a-zA-Z0-9_]/.test(lineContent[start - 1]))) start--;
  while (end < lineContent.length && (lineContent[end] === "." || /[a-zA-Z0-9_]/.test(lineContent[end]))) end++;
  if (lineContent[end - 1] === ".") end--;
  const fullPath = lineContent.substring(start, end);

  // Get cached scope from validation
  const instances = documentInstances.get(params.textDocument.uri);
  const context = documentContexts.get(params.textDocument.uri);
  const scope: Scope | undefined = instances?.[0] ?? context;
  if (!scope) return null;

  // Ensure annotation and scripting classes are initialized
  if (!ModelicaElement.annotationClassInstance && context) {
    ModelicaElement.initializeAnnotationClass(context);
  }
  if (!ModelicaElement.scriptingClassInstance && context) {
    ModelicaElement.initializeScriptingClass(context);
  }

  try {
    const tree = getDocumentTree(params.textDocument.uri);
    if (!tree) return null;
    try {
      const rootNode = tree.rootNode;
      const searchRow = position.line;
      const searchCol = Math.max(0, wordStart);
      const searchEndCol = wordEnd;

      const current: SyntaxNode | null = rootNode.descendantForPosition(
        { row: searchRow, column: searchCol },
        { row: searchRow, column: searchEndCol },
      );

      let element: ModelicaNamedElement | null = null;

      // Unified path resolution for modifications and arguments
      let currentPathNode: SyntaxNode | null = current;
      let isOverValue = false;
      let isOverName = false;

      while (currentPathNode) {
        if (
          currentPathNode.type === "Name" &&
          (currentPathNode.parent?.type === "ElementModification" ||
            currentPathNode.parent?.type === "ElementRedeclaration")
        ) {
          isOverName = true;
          break;
        }
        if (currentPathNode.type === "IDENT" && currentPathNode.parent?.type === "NamedArgument") {
          isOverName = true;
          break;
        }
        if (
          currentPathNode.type === "Modification" ||
          currentPathNode.type === "FunctionCallArguments" ||
          currentPathNode.type === "ArgumentList"
        ) {
          isOverValue = true;
        }
        if (
          currentPathNode.type === "ElementModification" ||
          currentPathNode.type === "NamedArgument" ||
          currentPathNode.type === "FunctionCall"
        ) {
          break;
        }
        currentPathNode = currentPathNode.parent;
      }

      if ((isOverName || isOverValue) && currentPathNode) {
        const resolved = resolvePathElement(currentPathNode, scope);

        if (isOverName) {
          element = resolved;
        } else if (isOverValue && resolved) {
          const typeScope =
            resolved instanceof ModelicaComponentInstance
              ? resolved.classInstance
              : resolved instanceof ModelicaClassInstance
                ? resolved
                : null;
          if (typeScope) {
            element = typeScope.resolveName(fullPath.split("."));
            if (!element && fullPath !== word) {
              element = typeScope.resolveName(word.split("."));
            }
          }
        }
      }

      if (!element) {
        element = scope.resolveName(fullPath.split("."));
        if (!element && fullPath !== word) {
          element = scope.resolveName(word.split("."));
          if (element) {
            start = wordStart;
            end = wordEnd;
          }
        }
      }

      if (element instanceof ModelicaNamedElement) {
        const contents: string[] = [];
        if (element instanceof ModelicaEnumerationClassInstance && element.value) {
          const value = element.value;
          contents.push(`**enumeration literal** \`${value.stringValue}\` : \`${element.name}\``);
          if (value.description) {
            contents.push(value.description);
          }
        } else if (element instanceof ModelicaClassInstance) {
          contents.push(`**${element.classKind}** \`${element.compositeName}\``);
        } else if (element instanceof ModelicaComponentInstance) {
          const typeName = element.declaredType?.compositeName ?? element.classInstance?.compositeName ?? "UnknownType";
          contents.push(`**component** \`${element.name}\` : \`${typeName}\``);
        } else {
          contents.push(`\`${element.name}\``);
        }

        if (element.description && !(element instanceof ModelicaEnumerationClassInstance && element.value)) {
          contents.push(element.description);
        }

        return {
          contents: {
            kind: "markdown" as const,
            value: contents.join("\n\n"),
          },
          range: {
            start: { line: position.line, character: start },
            end: { line: position.line, character: end },
          },
        };
      }

      return null;
    } finally {
      // Tree is managed by cache
    }
  } catch (e) {
    console.error("Hover resolution failed:", e);
    return null;
  }
});

/* Go to Definition — reuses hover's resolution logic to locate declarations */

/**
 * Resolve a Modelica element at a given text position.
 * Shared by hover and go-to-definition.
 */
function resolveElementAtPosition(
  document: TextDocument,
  position: { line: number; character: number },
): { element: ModelicaNamedElement; uri: string } | null {
  if (!parserReady || !parser) return null;

  const text = document.getText();
  const lines = text.split("\n");
  const lineContent = lines[position.line] ?? "";

  // Find the word under cursor
  let wordStart = position.character;
  let wordEnd = position.character;
  while (wordStart > 0 && /[_a-zA-Z0-9]/.test(lineContent[wordStart - 1])) wordStart--;
  while (wordEnd < lineContent.length && /[_a-zA-Z0-9]/.test(lineContent[wordEnd])) wordEnd++;
  const word = lineContent.substring(wordStart, wordEnd);
  if (!word) return null;

  // Expand to full dotted path
  let start = wordStart;
  let end = wordEnd;
  while (start > 0 && (lineContent[start - 1] === "." || /[a-zA-Z0-9_]/.test(lineContent[start - 1]))) start--;
  while (end < lineContent.length && (lineContent[end] === "." || /[a-zA-Z0-9_]/.test(lineContent[end]))) end++;
  if (lineContent[end - 1] === ".") end--;
  const fullPath = lineContent.substring(start, end);

  const instances = documentInstances.get(document.uri);
  const context = documentContexts.get(document.uri);
  const scope: Scope | undefined = instances?.[0] ?? context;
  if (!scope) return null;

  // Ensure annotation and scripting classes are initialized
  if (!ModelicaElement.annotationClassInstance && context) {
    ModelicaElement.initializeAnnotationClass(context);
  }

  try {
    const tree = getDocumentTree(document.uri);
    if (!tree) return null;
    try {
      const rootNode = tree.rootNode;
      const current: SyntaxNode | null = rootNode.descendantForPosition(
        { row: position.line, column: Math.max(0, wordStart) },
        { row: position.line, column: wordEnd },
      );

      let element: ModelicaNamedElement | null = null;

      // Check if inside a modification/annotation path
      let currentPathNode: SyntaxNode | null = current;
      let isOverValue = false;
      let isOverName = false;

      while (currentPathNode) {
        if (
          currentPathNode.type === "Name" &&
          (currentPathNode.parent?.type === "ElementModification" ||
            currentPathNode.parent?.type === "ElementRedeclaration")
        ) {
          isOverName = true;
          break;
        }
        if (currentPathNode.type === "IDENT" && currentPathNode.parent?.type === "NamedArgument") {
          isOverName = true;
          break;
        }
        if (
          currentPathNode.type === "Modification" ||
          currentPathNode.type === "FunctionCallArguments" ||
          currentPathNode.type === "ArgumentList"
        ) {
          isOverValue = true;
        }
        if (
          currentPathNode.type === "ElementModification" ||
          currentPathNode.type === "NamedArgument" ||
          currentPathNode.type === "FunctionCall"
        ) {
          break;
        }
        currentPathNode = currentPathNode.parent;
      }

      if ((isOverName || isOverValue) && currentPathNode) {
        const resolved = resolvePathElement(currentPathNode, scope);
        if (isOverName) {
          element = resolved;
        } else if (isOverValue && resolved) {
          const typeScope =
            resolved instanceof ModelicaComponentInstance
              ? resolved.classInstance
              : resolved instanceof ModelicaClassInstance
                ? resolved
                : null;
          if (typeScope) {
            element = typeScope.resolveName(fullPath.split("."));
            if (!element && fullPath !== word) {
              element = typeScope.resolveName(word.split("."));
            }
          }
        }
      }

      if (!element) {
        element = scope.resolveName(fullPath.split("."));
        if (!element && fullPath !== word) {
          element = scope.resolveName(word.split("."));
        }
      }

      if (element instanceof ModelicaNamedElement) {
        // Find the URI that owns this element
        let elementUri = document.uri; // Default: same document

        // Check if it's defined in a different open document
        for (const [uri, instances] of documentInstances) {
          if (uri === document.uri) continue;
          for (const inst of instances) {
            if (inst === element || isDescendantOf(element, inst)) {
              elementUri = uri;
              break;
            }
          }
          if (elementUri !== document.uri) break;
        }

        return { element, uri: elementUri };
      }
      return null;
    } finally {
      // Tree is managed by cache
    }
  } catch {
    return null;
  }
}

/** Check if `child` is within the parent hierarchy of `ancestor` */
function isDescendantOf(child: ModelicaNamedElement, ancestor: ModelicaNamedElement): boolean {
  let current: Scope | null = child.parent;
  while (current) {
    if (current === ancestor) return true;
    if (!("parent" in current)) return false;
    current = (current as ModelicaNamedElement).parent;
  }
  return false;
}

connection.onDefinition((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const resolved = resolveElementAtPosition(document, params.position);
  if (!resolved) return null;

  const { element, uri } = resolved;
  const syntaxNode = element.abstractSyntaxNode;
  if (!syntaxNode?.sourceRange) return null;

  // Use the identifier node for selection if available (class or component name)
  let targetRange = syntaxNode.sourceRange;
  if (element instanceof ModelicaClassInstance) {
    const ident = (element.abstractSyntaxNode as ModelicaClassDefinitionSyntaxNode | null)?.identifier;
    if (ident?.sourceRange) targetRange = ident.sourceRange;
  } else if (element instanceof ModelicaComponentInstance) {
    const decl = element.abstractSyntaxNode;
    const ident = (decl as ModelicaComponentDeclarationSyntaxNode | null)?.declaration?.identifier;
    if (ident?.sourceRange) targetRange = ident.sourceRange;
  }

  return {
    uri,
    range: {
      start: { line: targetRange.startRow, character: targetRange.startCol },
      end: { line: targetRange.endRow, character: targetRange.endCol },
    },
  };
});

/* Document formatting — uses tree-sitter parse + format() */

connection.onDocumentFormatting((params) => {
  if (!parserReady || !parser) {
    return [];
  }

  const document = documents.get(params.textDocument.uri);
  if (!document) {
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

/** Map a Modelica class prefix keyword to the most appropriate SymbolKind */
function classKindToSymbolKind(prefixes: SyntaxNode | null): SymbolKind {
  if (!prefixes) return SymbolKind.Class;
  const text = prefixes.text;
  if (text.includes("package")) return SymbolKind.Package;
  if (text.includes("function")) return SymbolKind.Function;
  if (text.includes("type")) return SymbolKind.TypeParameter;
  if (text.includes("record")) return SymbolKind.Struct;
  if (text.includes("connector")) return SymbolKind.Interface;
  if (text.includes("operator")) return SymbolKind.Operator;
  return SymbolKind.Class;
}

function nodeRange(node: SyntaxNode): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  return {
    start: { line: node.startPosition.row, character: node.startPosition.column },
    end: { line: node.endPosition.row, character: node.endPosition.column },
  };
}

function collectDocumentSymbols(node: SyntaxNode): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === "ClassDefinition") {
      const prefixes = child.childForFieldName("classPrefixes");
      const specifier = child.childForFieldName("classSpecifier");
      const ident = specifier?.childForFieldName("identifier");
      const name = ident?.text ?? "unknown";
      const kind = classKindToSymbolKind(prefixes);
      const detail = prefixes?.text ?? "";

      const sym: DocumentSymbol = {
        name,
        detail,
        kind,
        range: nodeRange(child),
        selectionRange: ident ? nodeRange(ident) : nodeRange(child),
        children: specifier ? collectDocumentSymbols(specifier) : [],
      };
      symbols.push(sym);
    } else if (child.type === "ComponentClause") {
      const typeSpec = child.childForFieldName("typeSpecifier");
      const typeName = typeSpec?.text ?? "";
      // Each ComponentClause can declare multiple components
      const decls = child.children.filter((c: SyntaxNode) => c.type === "ComponentDeclaration");
      for (const decl of decls) {
        const declaration = decl.childForFieldName("declaration");
        const ident = declaration?.childForFieldName("identifier");
        const name = ident?.text ?? "unknown";
        symbols.push({
          name,
          detail: typeName,
          kind: SymbolKind.Variable,
          range: nodeRange(decl),
          selectionRange: ident ? nodeRange(ident) : nodeRange(decl),
        });
      }
    } else if (child.type === "EquationSection" || child.type === "InitialEquationSection") {
      const label = child.type === "InitialEquationSection" ? "initial equation" : "equation";
      const eqSymbols: DocumentSymbol[] = [];
      // Collect connect equations as children
      for (let j = 0; j < child.childCount; j++) {
        const eq = child.child(j);
        if (!eq) continue;
        if (eq.type === "SpecialEquation") {
          const connectNode = eq.children.find((c: SyntaxNode) => c.type === "ConnectEquation");
          if (connectNode) {
            const refs = connectNode.children.filter((c: SyntaxNode) => c.type === "ComponentReference");
            const connName = refs.length >= 2 ? `connect(${refs[0].text}, ${refs[1].text})` : "connect(...)";
            eqSymbols.push({
              name: connName,
              kind: SymbolKind.Event,
              range: nodeRange(eq),
              selectionRange: nodeRange(connectNode),
            });
          }
        }
      }
      symbols.push({
        name: label,
        kind: SymbolKind.Namespace,
        range: nodeRange(child),
        selectionRange: nodeRange(child),
        children: eqSymbols.length > 0 ? eqSymbols : undefined,
      });
    } else if (child.type === "AlgorithmSection" || child.type === "InitialAlgorithmSection") {
      const label = child.type === "InitialAlgorithmSection" ? "initial algorithm" : "algorithm";
      symbols.push({
        name: label,
        kind: SymbolKind.Namespace,
        range: nodeRange(child),
        selectionRange: nodeRange(child),
      });
    } else if (child.type === "ExtendsClause") {
      const typeSpec = child.childForFieldName("typeSpecifier");
      const name = typeSpec?.text ?? "extends";
      symbols.push({
        name: `extends ${name}`,
        kind: SymbolKind.Interface,
        range: nodeRange(child),
        selectionRange: typeSpec ? nodeRange(typeSpec) : nodeRange(child),
      });
    } else if (
      child.type === "SimpleImportClause" ||
      child.type === "CompoundImportClause" ||
      child.type === "UnqualifiedImportClause"
    ) {
      const nameNode = child.childForFieldName("name");
      const name = nameNode?.text ?? "import";
      symbols.push({
        name: `import ${name}`,
        kind: SymbolKind.Module,
        range: nodeRange(child),
        selectionRange: nameNode ? nodeRange(nameNode) : nodeRange(child),
      });
    } else if (child.type === "ElementSection") {
      // Recurse into public/protected sections
      symbols.push(...collectDocumentSymbols(child));
    }
  }

  return symbols;
}

connection.onDocumentSymbol((params) => {
  if (!parserReady || !parser) return [];
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const tree = getDocumentTree(params.textDocument.uri);
  if (!tree) return [];
  try {
    return collectDocumentSymbols(tree.rootNode);
  } finally {
    // Tree is managed by cache — no delete needed
  }
});

/* Folding Ranges — enables code folding for classes, sections, and control structures */

connection.onFoldingRanges((params) => {
  if (!parserReady || !parser) return [];
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // Get the function reference
    const refNode = funcCallNode.children.find((c: SyntaxNode) => c.type === "ComponentReference");
    if (!refNode) return null;

    const instances = documentInstances.get(params.textDocument.uri);
    const context = documentContexts.get(params.textDocument.uri);
    const scope: Scope | undefined = instances?.[0] ?? context;
    if (!scope) return null;

    const funcElement = scope.resolveName(refNode.text.split("."));
    if (!(funcElement instanceof ModelicaClassInstance)) return null;
    if (funcElement.classKind !== ModelicaClassKind.FUNCTION && funcElement.classKind !== ModelicaClassKind.RECORD)
      return null;

    // Collect input parameters
    const paramInfos: ParameterInformation[] = [];
    for (const param of funcElement.inputParameters) {
      const typeName = param.declaredType?.compositeName ?? param.classInstance?.compositeName ?? "?";
      const label = `${typeName} ${param.name}`;
      paramInfos.push(ParameterInformation.create(label, param.description ?? undefined));
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
      signatures: [SignatureInformation.create(sigLabel, funcElement.description ?? undefined, ...paramInfos)],
      activeSignature: 0,
      activeParameter,
    };
  } finally {
    // Tree is managed by cache
  }
});

/* Find References — locates all occurrences of a symbol across open documents */

connection.onReferences((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const resolved = resolveElementAtPosition(document, params.position);
  if (!resolved) return [];

  const targetElement = resolved.element;
  const targetName = targetElement.name;
  if (!targetName) return [];

  const locations: {
    uri: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
  }[] = [];

  // Search all open documents
  for (const doc of documents.all()) {
    const tree = getDocumentTree(doc.uri);
    if (!tree) continue;

    const collectRefs = (node: SyntaxNode) => {
      if (node.type === "IDENT" && node.text === targetName) {
        locations.push({
          uri: doc.uri,
          range: nodeRange(node),
        });
      }
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) collectRefs(child);
      }
    };

    collectRefs(tree.rootNode);
  }

  return locations;
});

/* Rename — renames a symbol across the current document */

connection.onPrepareRename((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const text = document.getText();
  const lines = text.split("\n");
  const lineContent = lines[params.position.line] ?? "";

  let wordStart = params.position.character;
  let wordEnd = params.position.character;
  while (wordStart > 0 && /[_a-zA-Z0-9]/.test(lineContent[wordStart - 1])) wordStart--;
  while (wordEnd < lineContent.length && /[_a-zA-Z0-9]/.test(lineContent[wordEnd])) wordEnd++;
  const word = lineContent.substring(wordStart, wordEnd);
  if (!word || /^[0-9]/.test(word)) return null;

  // Verify it resolves to something
  const resolved = resolveElementAtPosition(document, params.position);
  if (!resolved) return null;

  return {
    range: {
      start: { line: params.position.line, character: wordStart },
      end: { line: params.position.line, character: wordEnd },
    },
    placeholder: word,
  };
});

connection.onRenameRequest((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const resolved = resolveElementAtPosition(document, params.position);
  if (!resolved) return null;

  const targetName = resolved.element.name;
  if (!targetName) return null;

  const changes: WorkspaceEdit["changes"] = {};

  // Find and replace all occurrences across open documents
  for (const doc of documents.all()) {
    const tree = getDocumentTree(doc.uri);
    if (!tree) continue;
    const edits: {
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      newText: string;
    }[] = [];

    const collectRenames = (node: SyntaxNode) => {
      if (node.type === "IDENT" && node.text === targetName) {
        edits.push({
          range: nodeRange(node),
          newText: params.newName,
        });
      }
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) collectRenames(child);
      }
    };

    collectRenames(tree.rootNode);

    if (edits.length > 0) {
      changes[doc.uri] = edits;
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
      if (element instanceof ModelicaLibrary) {
        for (const child of element.elements) {
          if (symbols.length >= MAX_RESULTS) break;
          if (child instanceof ModelicaClassInstance) {
            collectWorkspaceSymbols(child, "", query, symbols, MAX_RESULTS);
          }
        }
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
    const range = element.abstractSyntaxNode?.sourceRange;
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
  if (!document) return null;

  const resolved = resolveElementAtPosition(document, params.position);
  if (!resolved) return null;

  const { element, uri } = resolved;

  // For components, jump to their type class
  let targetClass: ModelicaClassInstance | null = null;
  if (element instanceof ModelicaComponentInstance) {
    targetClass = element.declaredType ?? element.classInstance ?? null;
  } else if (element instanceof ModelicaClassInstance) {
    // Already a class — nothing to jump to
    return null;
  }

  if (!targetClass) return null;
  const syntaxNode = targetClass.abstractSyntaxNode;
  if (!syntaxNode?.sourceRange) return null;

  // Use identifier for precise location
  const ident = (syntaxNode as ModelicaClassDefinitionSyntaxNode | null)?.identifier;
  const targetRange = ident?.sourceRange ?? syntaxNode.sourceRange;

  // Find the URI for this class
  let targetUri = uri;
  for (const [docUri, instances] of documentInstances) {
    for (const inst of instances) {
      if (inst === targetClass || isDescendantOf(targetClass, inst)) {
        targetUri = docUri;
        break;
      }
    }
    if (targetUri !== uri) break;
  }

  return {
    uri: targetUri,
    range: {
      start: { line: targetRange.startRow, character: targetRange.startCol },
      end: { line: targetRange.endRow, character: targetRange.endCol },
    },
  };
});

// Custom request: get diagram data for the webview
connection.onRequest("modelscript/getDiagramData", (params: { uri: string; className?: string }) => {
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
    return buildDiagramData(classInstance);
  } catch (e) {
    console.error("[diagram] Error building diagram data:", e);
    return null;
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
  (params: {
    uri: string;
    className?: string;
    startTime?: number;
    stopTime?: number;
    interval?: number;
    solver?: string;
    format?: string;
  }): {
    t: number[];
    y: number[][];
    states: string[];
    error?: string;
  } => {
    const instances = documentInstances.get(params.uri);
    if (!instances || instances.length === 0) {
      return { t: [], y: [], states: [], error: "No class instances found for this document." };
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

      const exp = simulator.dae.experiment;
      const startTime = params.startTime ?? exp.startTime ?? 0;
      const stopTime = params.stopTime ?? exp.stopTime ?? 10;
      const step = params.interval ?? exp.interval ?? (stopTime - startTime) / 100;

      const result = simulator.simulate(startTime, stopTime, step, {
        solver: (params.solver ?? "dopri5") as "rk4" | "dopri5" | "bdf" | "auto",
      });

      if (params.format === "csv") {
        const lines = [`time,${result.states.join(",")}`];
        for (let i = 0; i < result.t.length; i++) {
          const values = [result.t[i], ...result.states.map((_: string, vi: number) => result.y[i]?.[vi] ?? 0)];
          lines.push(values.join(","));
        }
        // Return CSV as a text field alongside the structured data
        return { t: result.t, y: result.y, states: result.states, error: undefined };
      }

      return {
        t: result.t,
        y: result.y,
        states: result.states,
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

// Custom request: get library tree children (lazy loading)
interface TreeNodeInfo {
  id: string;
  name: string;
  compositeName: string;
  classKind: string;
  hasChildren: boolean;
  iconSvg?: string;
}

connection.onRequest("modelscript/getLibraryTree", (params: { uri: string; parentId?: string }): TreeNodeInfo[] => {
  const context = documentContexts.get(params.uri);
  if (!context) {
    // Try any available context
    const anyCtx = documentContexts.values().next().value;
    if (!anyCtx) return [];
    return getTreeChildren(anyCtx, params.parentId);
  }
  return getTreeChildren(context, params.parentId);
});

function classHasChildClasses(cls: ModelicaClassInstance): boolean {
  for (const child of cls.elements) {
    if (child instanceof ModelicaClassInstance) return true;
  }
  return false;
}

function resolveClassKind(cls: ModelicaClassInstance): string {
  // cls.classKind is set from abstractSyntaxNode.classPrefixes.classKind in the constructor,
  // but for lazily-loaded library entries, classPrefixes may be null, defaulting to "class".
  // Walk up: check the class definition syntax node's class prefixes directly.
  const kind = cls.classKind;
  if (kind && kind !== "class") return kind;
  // Try to get the actual kind from the syntax node chain
  const asn = cls.abstractSyntaxNode;
  if (asn) {
    const prefixes = asn.classPrefixes;
    if (prefixes?.classKind && prefixes.classKind !== "class") return prefixes.classKind;
    // For short class specifiers, check the classSpecifier that wraps them
    const classSpecifier = asn.classSpecifier;
    if (classSpecifier && "typeSpecifier" in classSpecifier) {
      // Short class specifier — resolve the referenced type's kind
      const resolved = cls.parent?.resolveSimpleName?.(classSpecifier.identifier?.text);
      if (resolved && "classKind" in resolved) {
        const resolvedKind = (resolved as ModelicaClassInstance).classKind;
        if (resolvedKind && resolvedKind !== "class") return resolvedKind;
      }
    }
  }
  return kind || "class";
}

function toTreeNode(cls: ModelicaClassInstance): TreeNodeInfo {
  if (!cls.instantiated && !cls.instantiating) {
    try {
      cls.instantiate();
    } catch {
      // ignore instantiation errors for invalid files in the tree
    }
  }
  return {
    id: cls.compositeName,
    name: cls.name || "",
    compositeName: cls.compositeName,
    classKind: resolveClassKind(cls),
    hasChildren: classHasChildClasses(cls),
    iconSvg: getClassIconSvg(cls),
  };
}

function getTreeChildren(context: Context, parentId?: string): TreeNodeInfo[] {
  const nodes: TreeNodeInfo[] = [];

  if (!parentId) {
    // Root level: return libraries and top-level user classes
    for (const element of context.elements) {
      if (element instanceof ModelicaLibrary) {
        // Get top-level classes from the library
        for (const child of element.elements) {
          if (child instanceof ModelicaClassInstance) {
            nodes.push(toTreeNode(child));
          }
        }
      } else if (element instanceof ModelicaClassInstance) {
        nodes.push(toTreeNode(element));
      }
    }
  } else {
    // Find the parent and return its class children
    try {
      const parent = context.query(parentId);
      if (parent instanceof ModelicaClassInstance) {
        for (const child of parent.elements) {
          if (child instanceof ModelicaClassInstance) {
            nodes.push(toTreeNode(child));
          }
        }
      }
    } catch (e) {
      console.error("[library-tree] Error getting children:", e);
    }
  }

  return nodes;
}

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

  if (!params.parentId) {
    // Root level: return one node per open .mo document
    for (const [uri, instances] of workspaceInstances) {
      const fileName = uri.split("/").pop() ?? uri;
      nodes.push({
        id: uri,
        name: fileName,
        uri,
        hasChildren: instances.length > 0,
        isFile: true,
      });
    }
    // Sort files alphabetically
    nodes.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    // Check if parentId is a document URI (file node) or a class composite name
    const fileInstances = workspaceInstances.get(params.parentId);
    if (fileInstances) {
      // File level: return top-level classes from this document
      for (const inst of fileInstances) {
        const kind = resolveClassKind(inst);
        const line = inst.abstractSyntaxNode?.startPosition.row;
        nodes.push({
          id: `${params.parentId}::${inst.compositeName}`,
          name: inst.name || "",
          uri: params.parentId,
          compositeName: inst.compositeName,
          classKind: kind,
          hasChildren: classHasChildClasses(inst),
          isFile: false,
          iconSvg: getClassIconSvg(inst),
          line,
        });
      }
    } else {
      // Class level: find the parent class and return its child classes
      const sepIdx = params.parentId.indexOf("::");
      if (sepIdx >= 0) {
        const docUri = params.parentId.substring(0, sepIdx);
        const compositeName = params.parentId.substring(sepIdx + 2);
        const instances = workspaceInstances.get(docUri);
        if (instances) {
          // Find the parent class by composite name
          const parent = findClassByCompositeName(instances, compositeName);
          if (parent) {
            for (const child of parent.elements) {
              if (child instanceof ModelicaClassInstance) {
                const kind = resolveClassKind(child);
                const line = child.abstractSyntaxNode?.startPosition.row;
                nodes.push({
                  id: `${docUri}::${child.compositeName}`,
                  name: child.name || "",
                  uri: docUri,
                  compositeName: child.compositeName,
                  classKind: kind,
                  hasChildren: classHasChildClasses(child),
                  isFile: false,
                  iconSvg: getClassIconSvg(child),
                  line,
                });
              }
            }
          }
        }
      }
    }
  }

  return nodes;
});

function findClassByCompositeName(
  instances: ModelicaClassInstance[],
  compositeName: string,
): ModelicaClassInstance | null {
  for (const inst of instances) {
    if (inst.compositeName === compositeName) return inst;
    // Search children recursively
    for (const child of inst.elements) {
      if (child instanceof ModelicaClassInstance) {
        const found = findClassByCompositeName([child], compositeName);
        if (found) return found;
      }
    }
  }
  return null;
}

// Custom request: get class icon SVG
connection.onRequest("modelscript/getClassIcon", (params: { className: string; uri?: string }): string | null => {
  try {
    const context = params.uri ? documentContexts.get(params.uri) : documentContexts.values().next().value;
    if (!context) return null;

    const classInstance = context.query(params.className);
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
          const defaultName = droppedClass.annotation<string>("defaultComponentName");
          if (defaultName) {
            baseName = droppedClass.translate(defaultName);
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

    // Get scale from diagram annotation
    const diagram: IDiagram | null = classInstance.annotation("Diagram");
    const initialScale = diagram?.coordinateSystem?.initialScale ?? 0.1;
    const extent = diagram?.coordinateSystem?.extent;

    let width = 200;
    let height = 200;
    if (extent && extent.length >= 2) {
      width = Math.abs(extent[1][0] - extent[0][0]);
      height = Math.abs(extent[1][1] - extent[0][1]);
    }
    const w = width * initialScale;
    const h = height * initialScale;

    const x = Math.round(params.x);
    const y = -Math.round(params.y);
    const annotation = `annotation(Placement(transformation(origin={${x},${y}}, extent={{-${w / 2},-${h / 2}},{${w / 2},${h / 2}}})))`;
    const componentDecl = `  ${params.className} ${name} ${annotation};\n`;

    // Find insertion point: before the "equation" or "algorithm" section, or before "end ClassName;"
    const text = doc.getText();
    const lines = text.split("\n");

    // Scan forward to find the first equation/algorithm section or end of model
    const modelName = classInstance.name;
    let insertLine = -1;
    for (let li = 0; li < lines.length; li++) {
      const trimmed = lines[li].trim();
      if (trimmed === "equation" || trimmed.startsWith("equation ") || trimmed.startsWith("equation\t")) {
        insertLine = li;
        break;
      }
      if (trimmed === "algorithm" || trimmed.startsWith("algorithm ") || trimmed.startsWith("algorithm\t")) {
        insertLine = li;
        break;
      }
      if (trimmed === `end ${modelName};`) {
        insertLine = li;
        break;
      }
    }

    if (insertLine < 0) return [];

    return [
      {
        range: {
          start: { line: insertLine, character: 0 },
          end: { line: insertLine, character: 0 },
        },
        newText: componentDecl,
      },
    ];
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

  for (const [uri, ctx] of documentContexts.entries()) {
    try {
      for (const element of ctx.elements) {
        if (element instanceof ModelicaClassInstance && element.name) {
          if (!seen.has(element.name)) {
            seen.add(element.name);
            classes.push({
              name: element.name,
              kind: element.classKind ?? "class",
              uri,
            });
          }
        }
      }
    } catch {
      // Skip problematic contexts
    }
  }

  return { classes };
});

// Listen on the connection
connection.listen();

import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser";

import {
  Color,
  ColorInformation,
  ColorPresentation,
  CompletionItem,
  CompletionItemKind,
  Diagnostic,
  DiagnosticSeverity,
  InitializeResult,
  SemanticTokens,
  SemanticTokensBuilder,
  SemanticTokensLegend,
  ServerCapabilities,
  TextDocumentSyncKind,
  TextDocuments,
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

import Parser from "web-tree-sitter";

import { unzipSync } from "fflate";

import {
  Context,
  ModelicaClassInstance,
  ModelicaComponentInstance,
  ModelicaComponentReferenceSyntaxNode,
  ModelicaDAE,
  ModelicaElement,
  ModelicaEnumerationClassInstance,
  ModelicaFlattener,
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

function format(tree: Parser.Tree, content: string): string {
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
    let current: Parser.SyntaxNode | null = node.parent;

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

function resolvePathElement(node: Parser.SyntaxNode, scope: Scope): ModelicaNamedElement | null {
  let pathNode: Parser.SyntaxNode | null = node;
  const parameterPath: string[] = [];
  let baseElement: ModelicaNamedElement | null = null;
  let foundBase = false;

  while (pathNode) {
    if (pathNode.type === "ElementModification") {
      const nameNode = pathNode.children.find((c: Parser.SyntaxNode) => c.type === "Name");
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
      const refNode = pathNode.children.find((c: Parser.SyntaxNode) => c.type === "ComponentReference");
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
      const typeSpecNode = pathNode.children.find((c: Parser.SyntaxNode) => c.type === "TypeSpecifier");
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
    const Modelica = await Parser.Language.load(`${serverDistBase}/tree-sitter-modelica.wasm`);
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

    // Parse with tree-sitter
    const tree = context.parse(".mo", text);

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

      // Instantiate classes from this document
      const thisDocInstances: ModelicaClassInstance[] = [];
      const combinedInstances = [...allInstances, ...thisDocInstances];
      const editorScope = new EditorScope(parentScope, combinedInstances);

      // Two-pass: first create all instances (so they're visible as siblings)
      for (const classDef of node.classDefinitions) {
        const instance = new ModelicaClassInstance(editorScope, classDef);
        thisDocInstances.push(instance);
        combinedInstances.push(instance);
      }

      // Then instantiate and lint them
      for (const instance of thisDocInstances) {
        try {
          instance.instantiate();
          linter.lint(instance, textDocument.uri);
        } catch (e) {
          console.error("Lint error for instance:", e);
        }
      }
      console.log(
        `[cross-file] ${textDocument.uri.split("/").pop()}: created ${thisDocInstances.length} instances, scope has ${combinedInstances.length} total`,
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
    const tree = parser.parse(text);
    try {
      const rootNode = tree.rootNode;
      const searchRow = position.line;
      const searchCol = Math.max(0, wordStart);
      const searchEndCol = wordEnd;

      const current: Parser.SyntaxNode | null = rootNode.descendantForPosition(
        { row: searchRow, column: searchCol },
        { row: searchRow, column: searchEndCol },
      );

      let element: ModelicaNamedElement | null = null;

      // Unified path resolution for modifications and arguments
      let currentPathNode: Parser.SyntaxNode | null = current;
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
      tree.delete();
    }
  } catch (e) {
    console.error("Hover resolution failed:", e);
    return null;
  }
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
  const tree = parser.parse(text);
  const formatted = format(tree, text);
  tree.delete();

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

  const text = document.getText();
  const tree = parser.parse(text);
  const colors: ColorInformation[] = [];

  const traverse = (node: Parser.SyntaxNode) => {
    if (node.type === "ElementModification" || node.type === "NamedArgument") {
      const nameNode = node.childForFieldName("name") || node.childForFieldName("identifier");
      const name = nameNode?.text;
      if (name && COLOR_FIELDS.has(name)) {
        let exprNode = null;
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
  tree.delete();
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
      const startTime = exp.startTime ?? 0;
      const stopTime = exp.stopTime ?? 10;
      const step = exp.interval ?? (stopTime - startTime) / 100;

      const result = simulator.simulate(startTime, stopTime, step);

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

// Listen on the connection
connection.listen();

import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser";

import {
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
import { buildDiagramData } from "./diagramData";
import {
  computeComponentsDelete,
  computeConnectInsert,
  computeConnectRemove,
  computeEdgePointEdits,
  computePlacementEdits,
} from "./diagramEdits";

import Parser from "web-tree-sitter";

import { unzipSync } from "fflate";

import {
  Context,
  ModelicaClassInstance,
  ModelicaComponentInstance,
  ModelicaElement,
  ModelicaEnumerationClassInstance,
  ModelicaLinter,
  ModelicaNamedElement,
  ModelicaStoredDefinitionSyntaxNode,
  Scope,
  type Dirent,
  type FileSystem,
  type Range,
  type Stats,
} from "@modelscript/core";

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
    // Construct absolute URLs for WASM files using the extension URI
    const serverDistBase = `${extensionUri}/server/dist`;

    await Parser.init({
      locateFile: (file: string) => {
        return `${serverDistBase}/${file}`;
      },
    });
    const Modelica = await Parser.Language.load(`${serverDistBase}/tree-sitter-modelica.wasm`);
    parser = new Parser();
    parser.setLanguage(Modelica);
    Context.registerParser(".mo", parser);
    parserReady = true;
    console.log("Tree-sitter Modelica parser initialized");

    // Load the Modelica Standard Library from the bundled zip
    await loadMSL(serverDistBase);
  } catch (e) {
    console.error("Failed to initialize tree-sitter:", e);
    parserReady = false;
  }
}

/** Fetch and decompress the bundled MSL zip, populate the shared filesystem and context */
async function loadMSL(serverDistBase: string): Promise<void> {
  try {
    const response = await fetch(`${serverDistBase}/ModelicaStandardLibrary_v4.1.0.zip`);
    if (!response.ok) {
      console.warn("MSL zip not found — library features will be unavailable");
      return;
    }
    const buffer = await response.arrayBuffer();
    const zipData = new Uint8Array(buffer);
    const files = unzipSync(zipData);

    let fileCount = 0;
    for (const [name, data] of Object.entries(files)) {
      // Skip directory entries (empty data with trailing slash)
      if (name.endsWith("/")) {
        sharedFs.addDir(`/lib/${name.slice(0, -1)}`);
        continue;
      }
      sharedFs.addFile(`/lib/${name}`, data);
      fileCount++;
    }
    console.log(`MSL loaded: ${fileCount} files`);

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
    linter.lint(tree);

    // Build syntax nodes and lint them
    const node = ModelicaStoredDefinitionSyntaxNode.new(null, tree.rootNode);
    if (node) {
      linter.lint(node);

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
          linter.lint(instance);
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
}

/* Semantic tokens provider — regex-based tokenizer matching morsel's token types */

function computeSemanticTokens(textDocument: TextDocument): SemanticTokens {
  const builder = new SemanticTokensBuilder();
  const text = textDocument.getText();
  const lines = text.split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    tokenizeLine(builder, line, lineIndex);
  }

  return builder.build();
}

function tokenizeLine(builder: SemanticTokensBuilder, line: string, lineIndex: number): void {
  let i = 0;

  while (i < line.length) {
    // Skip whitespace
    if (/\s/.test(line[i])) {
      i++;
      continue;
    }

    // Line comment
    if (line[i] === "/" && i + 1 < line.length && line[i + 1] === "/") {
      builder.push(lineIndex, i, line.length - i, tokenTypes.indexOf("comment"), 0);
      return;
    }

    // Block comment start
    if (line[i] === "/" && i + 1 < line.length && line[i + 1] === "*") {
      const endIdx = line.indexOf("*/", i + 2);
      if (endIdx !== -1) {
        builder.push(lineIndex, i, endIdx + 2 - i, tokenTypes.indexOf("comment"), 0);
        i = endIdx + 2;
      } else {
        builder.push(lineIndex, i, line.length - i, tokenTypes.indexOf("comment"), 0);
        return;
      }
      continue;
    }

    // String
    if (line[i] === '"') {
      const start = i;
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === "\\") i++;
        i++;
      }
      if (i < line.length) i++;
      builder.push(lineIndex, start, i - start, tokenTypes.indexOf("string"), 0);
      continue;
    }

    // Numbers
    if (/\d/.test(line[i])) {
      const start = i;
      while (i < line.length && /[\d.]/.test(line[i])) i++;
      if (i < line.length && /[eE]/.test(line[i])) {
        i++;
        if (i < line.length && /[+-]/.test(line[i])) i++;
        while (i < line.length && /\d/.test(line[i])) i++;
      }
      builder.push(lineIndex, start, i - start, tokenTypes.indexOf("number"), 0);
      continue;
    }

    // Operators
    if ("+-*/^=<>:".includes(line[i])) {
      const start = i;
      if (i + 1 < line.length) {
        const two = line.substring(i, i + 2);
        if ([":=", "<=", ">=", "<>", "=="].includes(two)) {
          builder.push(lineIndex, start, 2, tokenTypes.indexOf("operator"), 0);
          i += 2;
          continue;
        }
      }
      builder.push(lineIndex, start, 1, tokenTypes.indexOf("operator"), 0);
      i++;
      continue;
    }

    // Identifiers and keywords
    if (/[_a-zA-Z]/.test(line[i])) {
      const start = i;
      while (i < line.length && /[_a-zA-Z0-9]/.test(line[i])) i++;
      const word = line.substring(start, i);

      if (keywords.includes(word)) {
        builder.push(lineIndex, start, word.length, tokenTypes.indexOf("keyword"), 0);
      } else if (typeKeywords.includes(word)) {
        builder.push(lineIndex, start, word.length, tokenTypes.indexOf("type"), 0);
      } else {
        const rest = line.substring(i).trimStart();
        if (/^[_a-zA-Z]/.test(rest)) {
          builder.push(lineIndex, start, word.length, tokenTypes.indexOf("type"), 0);
        } else {
          builder.push(lineIndex, start, word.length, tokenTypes.indexOf("variable"), 0);
        }
      }
      continue;
    }

    // Quoted identifier
    if (line[i] === "'") {
      const start = i;
      i++;
      while (i < line.length && line[i] !== "'") {
        if (line[i] === "\\") i++;
        i++;
      }
      if (i < line.length) i++;
      builder.push(lineIndex, start, i - start, tokenTypes.indexOf("variable"), 0);
      continue;
    }

    i++;
  }
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

  // Ensure annotation class is initialized
  if (!ModelicaElement.annotationClassInstance && context) {
    ModelicaElement.initializeAnnotationClass(context);
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

// Listen on the connection
connection.listen();

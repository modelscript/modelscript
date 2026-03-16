import {
  BrowserMessageReader,
  BrowserMessageWriter,
  Connection,
  createConnection,
} from "vscode-languageserver/browser";

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

import Parser from "web-tree-sitter";

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

/* Filesystem backed by LSP requests to the VS Code client */

class BrowserFileSystem implements FileSystem {
  // Used for future async workspace file reads via LSP requests
  // eslint-disable-next-line no-unused-private-class-members
  readonly #connection: Connection;

  constructor(conn: Connection) {
    this.#connection = conn;
  }

  basename(path: string): string {
    return path.split("/").pop() || path;
  }
  extname(path: string): string {
    const dot = path.lastIndexOf(".");
    return dot >= 0 ? path.substring(dot) : "";
  }
  join(...paths: string[]): string {
    return paths.join("/");
  }
  read(path: string): string {
    // Synchronous read not supported in browser — returns empty
    // Tree-sitter parsing uses text from the document sync, not from filesystem
    console.warn("BrowserFileSystem.read called for:", path);
    return "";
  }
  readBinary(): Uint8Array {
    return new Uint8Array();
  }
  readdir(): Dirent[] {
    return [];
  }
  resolve(...paths: string[]): string {
    return paths.join("/");
  }
  readonly sep = "/";
  stat(): Stats | null {
    return null;
  }
}

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
  } catch (e) {
    console.error("Failed to initialize tree-sitter:", e);
    parserReady = false;
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

// Validate documents when they change
documents.onDidChangeContent((change) => {
  validateTextDocument(change.document);
});

/* Diagnostic validation — uses tree-sitter + ModelicaLinter when available */

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const diagnostics: Diagnostic[] = [];
  const text = textDocument.getText();

  if (parserReady && parser) {
    // Full tree-sitter + ModelicaLinter pipeline (matching morsel's processContent)
    const context = new Context(new BrowserFileSystem(connection));
    const linter = new ModelicaLinter(
      (_type: string, message: string, _resource: string | null | undefined, range: Range | null | undefined) => {
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

      // Instantiate classes and run semantic linting
      const instances: ModelicaClassInstance[] = [];
      const editorScope = new EditorScope(context, instances);

      for (const classDef of node.classDefinitions) {
        const instance = new ModelicaClassInstance(editorScope, classDef);
        instances.push(instance);
      }

      for (const instance of instances) {
        try {
          instance.instantiate();
          linter.lint(instance);
        } catch (e) {
          console.error("Lint error for instance:", e);
        }
      }

      // Cache instances and context for hover resolution
      documentInstances.set(textDocument.uri, instances);
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

// Basic keyword completions for Modelica
connection.onCompletion((): CompletionItem[] => {
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

// Listen on the connection
connection.listen();

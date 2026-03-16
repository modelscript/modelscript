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

console.log("ModelScript language server starting...");

/* Browser-specific connection setup */

const messageReader = new BrowserMessageReader(self);
const messageWriter = new BrowserMessageWriter(self);

const connection = createConnection(messageReader, messageWriter);

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

connection.onInitialize((): InitializeResult => {
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

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const diagnostics: Diagnostic[] = [];
  const text = textDocument.getText();

  // Basic validation: check for unclosed block comments
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

  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

/* Semantic tokens provider — regex-based tokenizer matching morsel's tree-sitter logic */

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
      return; // rest of line is comment
    }

    // Block comment start (partial — we just color what's on this line)
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
        if (line[i] === "\\") i++; // skip escape
        i++;
      }
      if (i < line.length) i++; // closing quote
      builder.push(lineIndex, start, i - start, tokenTypes.indexOf("string"), 0);
      continue;
    }

    // Numbers
    if (/\d/.test(line[i])) {
      const start = i;
      while (i < line.length && /[\d.]/.test(line[i])) i++;
      // Scientific notation
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
      // Two-character operators
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
        // Peek ahead to classify: if followed by a space and then an identifier, it's likely a type
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

    // Skip other characters
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
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const position = params.position;
  const offset = document.offsetAt(position);
  const text = document.getText();

  // Extract the word under the cursor
  let start = offset;
  let end = offset;
  while (start > 0 && /\w/.test(text[start - 1])) start--;
  while (end < text.length && /\w/.test(text[end])) end++;
  const word = text.substring(start, end);

  const hoverInfo: Record<string, string> = {
    model: "Defines a Modelica model class.",
    connector: "Defines a Modelica connector for physical connections.",
    package: "Defines a Modelica package for organizing classes.",
    function: "Defines a Modelica function.",
    parameter: "A variable whose value is fixed during simulation.",
    equation: "Begins the equation section of a class.",
    algorithm: "Begins the algorithmic section of a class.",
    der: "Time derivative operator.",
    connect: "Creates a connection between two connectors.",
    flow: "Prefix indicating a flow variable in a connector.",
    stream: "Prefix indicating a stream variable in a connector.",
  };

  if (word in hoverInfo) {
    return {
      contents: {
        kind: "markdown" as const,
        value: `**${word}**\n\n${hoverInfo[word]}`,
      },
    };
  }

  return null;
});

// Listen on the connection
connection.listen();

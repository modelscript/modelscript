import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser";

import {
  CompletionItem,
  CompletionItemKind,
  Diagnostic,
  DiagnosticSeverity,
  InitializeResult,
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

/* Language server initialization */

connection.onInitialize((): InitializeResult => {
  const capabilities: ServerCapabilities = {
    textDocumentSync: TextDocumentSyncKind.Full,
    completionProvider: {
      triggerCharacters: ["."],
    },
    hoverProvider: true,
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

// Basic keyword completions for Modelica
connection.onCompletion((): CompletionItem[] => {
  const keywords = [
    "model",
    "end",
    "class",
    "connector",
    "package",
    "function",
    "record",
    "block",
    "type",
    "extends",
    "import",
    "parameter",
    "constant",
    "input",
    "output",
    "equation",
    "algorithm",
    "initial",
    "if",
    "then",
    "else",
    "elseif",
    "for",
    "while",
    "loop",
    "when",
    "elsewhen",
    "connect",
    "der",
    "flow",
    "stream",
    "replaceable",
    "redeclare",
    "partial",
    "encapsulated",
    "final",
    "inner",
    "outer",
    "protected",
    "public",
    "Real",
    "Integer",
    "Boolean",
    "String",
    "annotation",
    "external",
  ];

  return keywords.map((kw, index) => ({
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

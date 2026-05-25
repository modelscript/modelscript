/* eslint-disable @typescript-eslint/no-explicit-any */
import { Connection, TextDocuments, TextEdit } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { formatModelicaTree } from "../formatting/modelica-formatter";

function formatStepDocument(document: TextDocument): TextEdit[] {
  const text = document.getText();

  // Normalize line endings
  let normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Split multiple entities on the same line onto separate lines.
  // Pattern: "; #" → ";\n#" (entity terminator followed by next entity)
  normalized = normalized.replace(/;\s*(?=#\d)/g, ";\n");

  // Section keywords onto their own lines
  normalized = normalized.replace(
    /(ISO-10303-21;|HEADER;|ENDSEC;|END-ISO-10303-21;|DATA(?:\s*\([^)]*\))?\s*;)/g,
    (match) => "\n" + match.trim() + "\n",
  );

  // Normalize whitespace inside entity records:
  //   #1=FOO( 'a' , 'b' ) → #1=FOO('a','b')
  const resultLines: string[] = [];
  for (const line of normalized.split("\n")) {
    let trimmed = line.trim();

    // Skip empty lines in sequence (keep at most one blank line)
    if (!trimmed) {
      if (resultLines.length > 0 && resultLines[resultLines.length - 1] === "") {
        continue;
      }
      resultLines.push("");
      continue;
    }

    // For entity lines (#N=...), normalize internal spacing
    if (/^#\d+=/.test(trimmed)) {
      // Normalize spaces around commas: " , " → ","
      trimmed = trimmed.replace(/\s*,\s*/g, ",");
      // Normalize spaces after opening parens: "( " → "("
      trimmed = trimmed.replace(/\(\s+/g, "(");
      // Normalize spaces before closing parens: " )" → ")"
      trimmed = trimmed.replace(/\s+\)/g, ")");
      // Normalize space around "=": "# 1 = " → "#1="
      trimmed = trimmed.replace(/\s*=\s*/g, "=");
    }

    resultLines.push(trimmed);
  }

  // Trim leading/trailing blank lines
  while (resultLines.length > 0 && resultLines[0] === "") resultLines.shift();
  while (resultLines.length > 0 && resultLines[resultLines.length - 1] === "") resultLines.pop();

  const result = resultLines.join("\n") + "\n";

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

export function registerFormattingProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  getDocumentTree: (uri: string) => any,
  isParserReady: () => boolean,
) {
  connection.onDocumentFormatting((params): TextEdit[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    // STEP formatting — one entity per line, consistent spacing
    if (params.textDocument.uri.match(/\.(step|stp|p21)$/i)) {
      return formatStepDocument(document);
    }

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
    if (!isParserReady()) {
      return [];
    }

    const text = document.getText();
    const tree = getDocumentTree(params.textDocument.uri);
    if (!tree) return [];
    const formatted = formatModelicaTree(tree, text);

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
}

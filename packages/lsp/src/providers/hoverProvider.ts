/* eslint-disable @typescript-eslint/no-explicit-any */
import { LSPBridge } from "@modelscript/compiler";
import { Connection, Hover, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { STEP_SCHEMA } from "../utils/stepUtils";

function isStepDocument(document: TextDocument): boolean {
  return document.languageId === "step" || /\.(step|stp|p21)$/i.test(document.uri);
}

export function registerHoverProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  documentLSPBridges: Map<string, LSPBridge>,
) {
  connection.onHover((params): Hover | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const text = document.getText();
    const offset = document.offsetAt(params.position);

    // ── STEP-specific hover (does NOT require an LSPBridge) ────────────
    if (isStepDocument(document)) {
      // Expand token boundaries to include # for entity IDs and uppercase for type names
      let start = offset;
      while (start > 0 && /[A-Z0-9_#]/.test(text[start - 1])) start--;
      let end = offset;
      while (end < text.length && /[A-Z0-9_]/.test(text[end])) end++;

      const token = text.slice(start, end);

      // Hover over entity ID reference (#123) → show its definition line
      if (/^#\d+$/.test(token)) {
        // Escape the # for use in regex
        const defRegex = new RegExp(`^${token.replace("#", "\\#")}\\s*=\\s*([^;]+);`, "m");
        const match = defRegex.exec(text);
        if (match) {
          return {
            contents: {
              kind: "markdown" as const,
              value: ["```step", match[0].trim(), "```"].join("\n"),
            },
            range: {
              start: document.positionAt(start),
              end: document.positionAt(end),
            },
          };
        }
        return null; // It's an entity ref but not found — don't fall through to bridge
      }

      // Hover over STEP entity type name (e.g. ORIENTED_EDGE) → show schema info
      if (/^[A-Z][A-Z0-9_]*$/.test(token)) {
        const schema = STEP_SCHEMA[token];
        if (schema) {
          return {
            contents: {
              kind: "markdown" as const,
              value: [
                `**${token}**`,
                "",
                schema.description,
                "",
                "**Parameters:**",
                ...schema.parameters.map((p: any, i: number) => `${i + 1}. \`${p.name}\` — \`${p.type}\``),
              ].join("\n"),
            },
            range: {
              start: document.positionAt(start),
              end: document.positionAt(end),
            },
          };
        }
      }

      return null; // STEP file but nothing to hover on — don't fall through
    }

    // ── Standard polyglot hover (Modelica/SysML/OWL2 — requires bridge) ──
    const bridge = documentLSPBridges.get(params.textDocument.uri);
    if (!bridge) return null;

    const hoverDef = bridge.hover(offset, text);
    if (!hoverDef) return null;

    return {
      contents: {
        kind: "markdown" as const,
        value: hoverDef.contents,
      },
      range: hoverDef.range as any,
    };
  });
}

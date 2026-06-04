/* eslint-disable @typescript-eslint/no-explicit-any */

import { Connection, Hover, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { STEP_SCHEMA } from "../utils/stepUtils";

function isStepDocument(document: TextDocument): boolean {
  return document.languageId === "step" || /\.(step|stp|p21)$/i.test(document.uri);
}

export function registerHoverProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  validationService: any,
) {
  const documentLSPBridges = validationService.documentLSPBridges;
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

    let hoverContent = hoverDef.contents;

    // Enhance hover with reasoner inferences if this is SysML2 and reasonerService is available
    if (document.uri.endsWith(".sysml")) {
      const bridgePos = (bridge as any).positions;
      const resolver = (bridge as any).resolver;
      if (resolver && bridgePos) {
        // find symbol at offset
        const queryEngine = validationService.workspaceManager.globalSysML2QueryEngine;
        if (queryEngine && validationService.reasonerService) {
          const id = (resolver as any).findSymbolAtPosition(document.uri, offset);
          if (id !== undefined) {
            const entry = queryEngine.index.symbols.get(id);
            if (entry) {
              const iri = `sysml:${entry.name || `anon_${entry.id}`}`;
              const taxonomy = validationService.reasonerService.reasoner.getTaxonomy();
              const node = taxonomy.get(iri);

              if (node && node.superClasses.size > 0) {
                const inferred = Array.from(node.superClasses).filter(
                  (superIri: string) => superIri !== "owl:Thing" && superIri !== iri,
                );
                if (inferred.length > 0) {
                  hoverContent += `\n\n**Inferred Types (Reasoner):**\n- ${inferred.map((i: string) => i.replace("sysml:", "")).join(", ")}`;
                }

                // If there are subclasses, we can show them too
                const subclasses = Array.from(node.subClasses).filter(
                  (subIri: string) => subIri !== "owl:Nothing" && subIri !== iri,
                );
                if (subclasses.length > 0) {
                  hoverContent += `\n\n**Inferred Subtypes:**\n- ${subclasses.map((i: string) => i.replace("sysml:", "")).join(", ")}`;
                }
              }
            }
          }
        }
      }
    }

    return {
      contents: {
        kind: "markdown" as const,
        value: hoverContent,
      },
      range: hoverDef.range as any,
    };
  });
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */

import { STEP_SCHEMA } from "@modelscript/step";
import { Connection, Hover, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";

function isStepDocument(document: TextDocument): boolean {
  return document.languageId === "step" || /\.(step|stp|p21)$/i.test(document.uri);
}

function enhanceWithCadLink(hoverContent: string, token: string, text: string, offset: number): string {
  if (!token) return hoverContent;

  const lineStart = text.lastIndexOf("\n", offset) + 1;
  const nextLine = text.indexOf("\n", offset);
  const lineEnd = nextLine === -1 ? text.length : nextLine;
  const lineText = text.slice(lineStart, lineEnd);

  let coupledPartName: string | null = null;
  const cadMatch =
    lineText.match(/CAD(?:Port)?\([^)]*?(?:feature|part)\s*=\s*"([^"]+)"/i) ||
    lineText.match(/__modelscript_cad\([^)]*?part\s*=\s*"([^"]+)"/i);

  if (cadMatch) {
    coupledPartName = cadMatch[1];
  } else {
    const lowerToken = token.toLowerCase();
    const bioCadKeywords = [
      "lead",
      "cannula",
      "ventricle",
      "atrium",
      "myocardium",
      "valve",
      "leaflet",
      "anchor",
      "housing",
      "impeller",
      "patch",
      "catheter",
      "stent",
      "sensor",
      "motor",
      "rotor",
      "electrode",
      "apex",
    ];
    if (
      bioCadKeywords.some((k) => lowerToken.includes(k)) ||
      lowerToken.endsWith("_anchor") ||
      lowerToken.endsWith("_cad") ||
      lowerToken.endsWith("_part") ||
      lowerToken.startsWith("cad_")
    ) {
      coupledPartName = token;
    }
  }

  if (coupledPartName) {
    const commandArg = encodeURIComponent(JSON.stringify({ partName: coupledPartName }));
    return (
      hoverContent +
      `\n\n---\n**Coupled 3D CAD Anchor:**\n[🔍 Inspect in 3D Anatomy Canvas](command:modelscript.focusCadPart?${commandArg})`
    );
  }

  return hoverContent;
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
    if (!bridge) {
      const plugin = globalLanguageRegistry.getPluginForUri(params.textDocument.uri);
      if (plugin) {
        if (plugin.customHandlers?.hover) {
          return plugin.customHandlers.hover(offset, text);
        }
        if (plugin.facade?.getHover) {
          try {
            const hoverText = plugin.facade.getHover(0, offset);
            if (hoverText) {
              let tokenStart = offset;
              while (tokenStart > 0 && /[a-zA-Z0-9_]/.test(text[tokenStart - 1]!)) tokenStart--;
              let tokenEnd = offset;
              while (tokenEnd < text.length && /[a-zA-Z0-9_]/.test(text[tokenEnd]!)) tokenEnd++;
              const token = text.slice(tokenStart, tokenEnd).trim();
              const enriched = enhanceWithCadLink(hoverText, token, text, offset);
              return {
                contents: { kind: "markdown", value: enriched },
                range: {
                  start: document.positionAt(tokenStart),
                  end: document.positionAt(tokenEnd),
                },
              };
            }
          } catch {}
        }
      }
      return null;
    }

    const hoverDef = bridge.hover(offset, text);
    if (!hoverDef) return null;

    let hoverContent = hoverDef.contents;

    // Enhance hover with reasoner inferences if this is SysML2 and reasonerService is available
    const plugin = globalLanguageRegistry.getPluginForUri(document.uri);
    if (plugin?.id === "sysml2" || document.uri.endsWith(".sysml")) {
      const bridgePos = (bridge as any).positions;
      const resolver = (bridge as any).resolver;
      if (resolver && bridgePos) {
        // find symbol at offset
        const queryEngine = plugin?.queryEngine ?? validationService.workspaceManager.globalSysML2QueryEngine;
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

    // Enhance hover with formal abstract interpretation invariants if this is Modelica
    if (document.uri.endsWith(".mo") || plugin?.id === "modelica") {
      const proofMap = validationService.modelicaProofResultsByUri?.get(document.uri);
      if (proofMap) {
        let tokenStart = offset;
        while (tokenStart > 0 && /[a-zA-Z0-9_]/.test(text[tokenStart - 1]!)) tokenStart--;
        let tokenEnd = offset;
        while (tokenEnd < text.length && /[a-zA-Z0-9_]/.test(text[tokenEnd]!)) tokenEnd++;
        const token = text.slice(tokenStart, tokenEnd).trim();

        if (token) {
          for (const [fnName, proof] of proofMap.entries()) {
            const entryStates = proof.summary?.blockEntryStates as Map<number, any> | undefined;
            const exitStates = proof.summary?.blockExitStates as Map<number, any> | undefined;

            let matchedIval: any = undefined;

            // 1. Try finding a basic block spanning the hovered cursor offset
            if (proof.cfg?.blocks) {
              for (const [bId, block] of proof.cfg.blocks) {
                const inBlock = block.instructions.some(
                  (inst: any) =>
                    inst.startByte !== undefined &&
                    inst.endByte !== undefined &&
                    offset >= inst.startByte &&
                    offset <= inst.endByte,
                );
                if (inBlock) {
                  const state = exitStates?.get(bId) || entryStates?.get(bId);
                  const ival = state?.intervals?.get?.(token);
                  if (ival && !ival.isTop?.() && !ival.isBottom?.()) {
                    matchedIval = ival;
                    break;
                  }
                }
              }
            }

            // 2. Sound fallback: inspect reachable blocks where token is bound
            if (!matchedIval && (entryStates || exitStates)) {
              const states = [
                ...(entryStates ? Array.from(entryStates.values()) : []),
                ...(exitStates ? Array.from(exitStates.values()) : []),
              ];
              for (const state of states) {
                const ival = state?.intervals?.get?.(token);
                if (ival && !ival.isTop?.() && !ival.isBottom?.()) {
                  if (!matchedIval) {
                    matchedIval = ival;
                  } else if (matchedIval.join) {
                    matchedIval = matchedIval.join(ival);
                  }
                }
              }
            }

            if (matchedIval) {
              hoverContent += `\n\n---\n**Formal Invariant (Sound Abstract Domain):**\n- \`${token} ∈ ${matchedIval.toString()}\` (Verified Invariant in \`${fnName}\`)`;
              break;
            }
          }
        }
      }

      // Enhance hover with DAE reachability bounds and algebraic loop certificates
      const daeMap = validationService.modelicaDaeVerificationResultsByUri?.get(document.uri);
      if (daeMap) {
        let tokenStart = offset;
        while (tokenStart > 0 && /[a-zA-Z0-9_]/.test(text[tokenStart - 1]!)) tokenStart--;
        let tokenEnd = offset;
        while (tokenEnd < text.length && /[a-zA-Z0-9_]/.test(text[tokenEnd]!)) tokenEnd++;
        const token = text.slice(tokenStart, tokenEnd).trim();

        if (token) {
          for (const [modelName, daeProof] of daeMap.entries()) {
            const varBound = daeProof.variableBounds?.get(token);
            if (varBound && !varBound.isTop?.() && !varBound.isBottom?.()) {
              hoverContent += `\n\n---\n**DAE Reachability Invariant:**\n- \`${token} \u2208 ${varBound.toString()}\` \u2713 (Sound BLT Reachability in \`${modelName}\`)`;
            }
          }
        }
      }
    }

    // Enhance hover with coupled 3D CAD navigation link (Workstream 4)
    let hoveredStart = offset;
    while (hoveredStart > 0 && /[a-zA-Z0-9_]/.test(text[hoveredStart - 1]!)) hoveredStart--;
    let hoveredEnd = offset;
    while (hoveredEnd < text.length && /[a-zA-Z0-9_]/.test(text[hoveredEnd]!)) hoveredEnd++;
    const hoveredToken = text.slice(hoveredStart, hoveredEnd).trim();
    hoverContent = enhanceWithCadLink(hoverContent, hoveredToken, text, offset);

    return {
      contents: {
        kind: "markdown" as const,
        value: hoverContent,
      },
      range: hoverDef.range as any,
    };
  });
}

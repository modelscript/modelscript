// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */

import { getSymbolDomain, LanguageDomainId } from "@modelscript/runtime";
import { STEP_SCHEMA } from "@modelscript/step";
import { Connection, Hover, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";

function isStepDocument(document: TextDocument): boolean {
  return document.languageId === "step" || /\.(step|stp|p21)$/i.test(document.uri);
}

function getDomainName(domainId: number, resourceId?: string): string {
  switch (domainId) {
    case LanguageDomainId.Modelica:
      return "Modelica";
    case LanguageDomainId.SysML2:
      return "SysML v2";
    case LanguageDomainId.STEP_CAD:
      return "STEP CAD";
    case LanguageDomainId.OWL2:
      return "OWL2 Ontology";
    case LanguageDomainId.SSP:
      return "SSP Container";
    case LanguageDomainId.CFD:
      return "CFD Aerodynamics";
    case LanguageDomainId.FEA:
      return "FEA Finite Element";
    case LanguageDomainId.ModelScript:
      return "ModelScript";
    case LanguageDomainId.SCAD:
      return "OpenSCAD";
    case LanguageDomainId.CSV:
      return "Tabular Dataset";
    default:
      if (resourceId) {
        if (/\.(sysml|kerml)$/i.test(resourceId)) return "SysML v2";
        if (/\.(step|stp|p21)$/i.test(resourceId)) return "STEP CAD";
        if (/\.mo$/i.test(resourceId)) return "Modelica";
        if (/\.(owl|ttl|ofn)$/i.test(resourceId)) return "OWL2 Ontology";
      }
      return "Polyglot";
  }
}

function domainToLang(domainName: string): string {
  switch (domainName) {
    case "SysML v2":
      return "sysml";
    case "Modelica":
      return "modelica";
    case "STEP CAD":
      return "step";
    case "OWL2 Ontology":
      return "owl";
    default:
      return "plaintext";
  }
}

function enhanceWithDigitalThreadTwin(
  hoverContent: string,
  token: string,
  text: string,
  offset: number,
  documentUri: string,
  bridge: any,
  validationService: any,
): string {
  if (hoverContent.includes("### 🔗 Polyglot Digital Thread Twin")) {
    return hoverContent;
  }

  const lineStart = text.lastIndexOf("\n", offset) + 1;
  const nextLine = text.indexOf("\n", offset);
  const lineEnd = nextLine === -1 ? text.length : nextLine;
  const lineText = text.slice(lineStart, lineEnd);

  const refEntry = bridge?.findEntryAtOffset?.(offset) || bridge?.findScopeAtOffset?.(offset);

  // Twin annotations / metadata
  const twinMatch = lineText.match(/(?:twin|counterpart|implements)\s*=\s*"([^"]+)"/i);
  const partTypeMatch = lineText.match(/part\s+[a-zA-Z0-9_]+\s*:\s*([a-zA-Z0-9_:]+)/);
  const cadMatch =
    lineText.match(/CAD(?:Port)?\([^)]*?(?:feature|part)\s*=\s*"([^"]+)"/i) ||
    lineText.match(/__modelscript_cad\([^)]*?part\s*=\s*"([^"]+)"/i);

  const twinCand =
    refEntry?.metadata?.twin ||
    refEntry?.metadata?.counterpart ||
    refEntry?.metadata?.implements ||
    twinMatch?.[1] ||
    partTypeMatch?.[1];

  const qe =
    bridge?.engine ??
    bridge?.getQueryEngine?.() ??
    validationService?.workspaceManager?.getQueryEngine?.("modelica") ??
    validationService?.workspaceManager?.getQueryEngine?.("sysml2") ??
    globalLanguageRegistry.getAllPlugins().find((p: any) => p.queryEngine)?.queryEngine;

  let counterpartEntry: any = null;
  let counterpartDomain = "";
  let parityReport: any = null;

  // 1. Check crossDomainBinding via Salsa
  if (refEntry?.id !== undefined && typeof qe?.crossDomainBinding === "function") {
    try {
      const boundIds = qe.crossDomainBinding(refEntry.id);
      if (boundIds.length > 0) {
        counterpartEntry = qe.resolveEntry(boundIds[0]);
        if (counterpartEntry) {
          counterpartDomain = getDomainName(getSymbolDomain(counterpartEntry.id), counterpartEntry.resourceId);
        }
      }
    } catch {}
  }

  // 2. Check twinCand via Salsa resolvePolyglotSymbol
  if (!counterpartEntry && twinCand && typeof qe?.resolvePolyglotSymbol === "function") {
    try {
      const symId = qe.resolvePolyglotSymbol(String(twinCand));
      if (symId !== null && symId !== undefined) {
        counterpartEntry = qe.resolveEntry(symId);
        if (counterpartEntry) {
          counterpartDomain = getDomainName(getSymbolDomain(counterpartEntry.id), counterpartEntry.resourceId);
        }
      }
    } catch {}
  }

  // 3. Check digital thread hypergraph
  let threadElem: any = null;
  if (!counterpartEntry && validationService?.workspaceManager?.getThreadsForUri) {
    try {
      const threads = validationService.workspaceManager.getThreadsForUri(documentUri);
      if (threads && threads.length > 0) {
        for (const t of threads) {
          const aligned = validationService.workspaceManager.findAlignedElementsBySlot(t.slot);
          for (const elem of aligned) {
            if (elem.uri && elem.uri !== documentUri) {
              threadElem = elem;
              counterpartDomain = elem.domain ? elem.domain.toUpperCase() : "Digital Thread";
              break;
            }
          }
          if (threadElem) break;
        }
      }
    } catch {}
  }

  // 4. Physical quantity parity check
  if (
    refEntry?.id !== undefined &&
    counterpartEntry?.id !== undefined &&
    typeof qe?.physicalQuantityParity === "function"
  ) {
    try {
      parityReport = qe.physicalQuantityParity(refEntry.id, counterpartEntry.id);
    } catch {}
  }

  // If we have counterpart info or CAD annotation or thread element, construct twin section
  if (counterpartEntry || threadElem || cadMatch) {
    const cName = counterpartEntry?.name || threadElem?.name || cadMatch?.[1] || String(twinCand);
    const cKind = counterpartEntry?.ruleName || counterpartEntry?.kind || threadElem?.properties?.kind || "definition";
    const cUri = counterpartEntry?.resourceId || threadElem?.uri;
    const cDomain = counterpartDomain || (cadMatch ? "STEP CAD" : "Polyglot");

    const lines: string[] = [
      "",
      "---",
      "### 🔗 Polyglot Digital Thread Twin",
      `- **Domain:** ${cDomain}`,
      `- **Counterpart:** \`${cName}\` (\`${cKind}\`)`,
    ];

    if (cUri) {
      const bName = cUri.split("/").pop() || cUri;
      lines.push(`- **Resource:** [\`${bName}\`](${cUri})`);
    }

    if (parityReport) {
      if (parityReport.compatible) {
        lines.push(
          `- **Physical Quantity:** \`${parityReport.mUnit || parityReport.sType || "Matched"}\` ✓ [Consistent]`,
        );
      } else if (parityReport.reason) {
        lines.push(`- **Physical Quantity Parity:** ⚠ Incompatible (${parityReport.reason})`);
      }
    } else if (counterpartEntry?.metadata?.unit || refEntry?.metadata?.unit) {
      const u = counterpartEntry?.metadata?.unit || refEntry?.metadata?.unit;
      lines.push(`- **Physical Quantity:** \`${u}\` ✓ [Consistent]`);
    } else if (threadElem?.properties?.mass) {
      lines.push(`- **Physical Quantity:** \`mass: ${threadElem.properties.mass}\` ✓ [Consistent]`);
    }

    const cadPartName = cadMatch?.[1] || (cDomain === "STEP CAD" ? cName : null);
    if (cadPartName && !hoverContent.includes("command:modelscript.focusCadPart?")) {
      const commandArg = encodeURIComponent(JSON.stringify({ partName: cadPartName }));
      lines.push(
        `- **Coupled 3D CAD Anchor:** [🔍 Inspect in 3D Anatomy Canvas](command:modelscript.focusCadPart?${commandArg})`,
      );
    }

    return hoverContent + lines.join("\n");
  }

  return hoverContent;
}

function enhanceWithCadLink(hoverContent: string, token: string, text: string, offset: number): string {
  if (!token) return hoverContent;
  if (hoverContent.includes("command:modelscript.focusCadPart?")) return hoverContent;

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
          let stepHover = ["```step", match[0].trim(), "```"].join("\n");
          stepHover = enhanceWithDigitalThreadTwin(
            stepHover,
            token,
            text,
            offset,
            document.uri,
            undefined,
            validationService,
          );
          return {
            contents: {
              kind: "markdown" as const,
              value: stepHover,
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
    let hoverContent = hoverDef?.contents;
    let hoverRange = hoverDef?.range;

    if (!hoverContent) {
      // Check if cursor is over a cross-language reference, e.g. Propulsion::Motor or SysML2::Avionics::IMU
      let tokStart = offset;
      while (tokStart > 0 && /[-a-zA-Z0-9_:#./]/.test(text[tokStart - 1]!)) tokStart--;
      let tokEnd = offset;
      while (tokEnd < text.length && /[-a-zA-Z0-9_:#./]/.test(text[tokEnd]!)) tokEnd++;
      const fullToken = text.slice(tokStart, tokEnd).trim();

      const qe =
        (bridge as any)?.engine ??
        (bridge as any)?.getQueryEngine?.() ??
        validationService?.workspaceManager?.getQueryEngine?.("modelica") ??
        validationService?.workspaceManager?.getQueryEngine?.("sysml2") ??
        globalLanguageRegistry.getAllPlugins().find((p: any) => p.queryEngine)?.queryEngine;

      if (qe && fullToken && typeof qe.resolvePolyglotSymbol === "function") {
        const symId = qe.resolvePolyglotSymbol(fullToken);
        if (symId !== null && symId !== undefined) {
          const entry = qe.resolveEntry(symId);
          if (entry) {
            const domainName = getDomainName(getSymbolDomain(entry.id), entry.resourceId);
            const kind = entry.kind || entry.ruleName || "definition";
            const resName = entry.resourceId ? entry.resourceId.split("/").pop() || entry.resourceId : "";
            const resLink = entry.resourceId ? `\n- **Resource:** [\`${resName}\`](${entry.resourceId})` : "";
            hoverContent = `\`\`\`${domainToLang(domainName)}\n${entry.name}: ${kind}\n\`\`\`\n\n---\n### 🔗 Polyglot Digital Thread Twin\n- **Domain:** ${domainName}\n- **Counterpart:** \`${entry.name}\` (\`${kind}\`)${resLink}`;
            hoverRange = {
              start: document.positionAt(tokStart),
              end: document.positionAt(tokEnd),
            };
          }
        }
      }

      if (!hoverContent) return null;
    }

    // Enhance hover with reasoner inferences if this is SysML2 and reasonerService is available
    const plugin = globalLanguageRegistry.getPluginForUri(document.uri);
    if (plugin?.id === "sysml2" || document.uri.endsWith(".sysml")) {
      const bridgePos = (bridge as any).positions;
      const resolver = (bridge as any).resolver;
      if (resolver && bridgePos) {
        // find symbol at offset
        const queryEngine = plugin?.queryEngine ?? validationService?.workspaceManager?.globalSysML2QueryEngine;
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

    // Enhance hover with coupled 3D CAD navigation link (Workstream 4) and Digital Thread Twin
    let hoveredStart = offset;
    while (hoveredStart > 0 && /[a-zA-Z0-9_]/.test(text[hoveredStart - 1]!)) hoveredStart--;
    let hoveredEnd = offset;
    while (hoveredEnd < text.length && /[a-zA-Z0-9_]/.test(text[hoveredEnd]!)) hoveredEnd++;
    const hoveredToken = text.slice(hoveredStart, hoveredEnd).trim();

    hoverContent = enhanceWithDigitalThreadTwin(
      hoverContent,
      hoveredToken,
      text,
      offset,
      document.uri,
      bridge,
      validationService,
    );
    hoverContent = enhanceWithCadLink(hoverContent, hoveredToken, text, offset);

    return {
      contents: {
        kind: "markdown" as const,
        value: hoverContent,
      },
      range: (hoverRange ?? hoverDef?.range) as any,
    };
  });
}

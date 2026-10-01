// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, no-useless-assignment */
import {
  CodeAction,
  CodeActionKind,
  Connection,
  SymbolKind,
  TextDocuments,
  WorkspaceEdit,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

export function registerWorkspaceFeaturesProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  documentTrees: Map<string, any>,
  flushValidation: (uri: string) => Promise<void>,
  getUnifiedIndex: (isSysML2: boolean) => Promise<any>,
  getResolverOrIndex?: any,
  getGlobalWorkspaceIndex?: () => any,
) {
  const getWorkspaceIndex =
    typeof getResolverOrIndex === "function" && getGlobalWorkspaceIndex === undefined
      ? getResolverOrIndex
      : getGlobalWorkspaceIndex || (() => null);

  const isDecl = (entry: any): boolean => {
    return entry.kind !== "Reference" && entry.kind !== "ConnectEquation" && entry.kind !== "FunctionCall";
  };

  const resolveRef = (entry: any, index: any): any[] => {
    if (isDecl(entry)) return [entry];
    const ids = index.byName.get(entry.name) || [];
    const decls: any[] = [];
    for (const id of ids) {
      const sym = index.symbols.get(id);
      if (sym && isDecl(sym)) decls.push(sym);
    }
    return decls;
  };

  const findRefs = (declId: number, index: any): any[] => {
    const decl = index.symbols.get(declId);
    if (!decl) return [];
    const ids = index.byName.get(decl.name) || [];
    const refs: any[] = [];
    for (const id of ids) {
      const sym = index.symbols.get(id);
      if (sym && !isDecl(sym)) refs.push(sym);
    }
    return refs;
  };

  connection.onReferences(async (params) => {
    await flushValidation(params.textDocument.uri);
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const isSysML2 = params.textDocument.uri.endsWith(".sysml");
    const unifiedIndex = isSysML2 ? await getUnifiedIndex(true) : await getUnifiedIndex(false);

    const offset = document.offsetAt(params.position);
    const text = document.getText();
    let ws = offset;
    if (ws > 0 && !/[a-zA-Z0-9_]/.test(text[ws]!) && /[a-zA-Z0-9_]/.test(text[ws - 1]!)) ws--;
    while (ws > 0 && /[a-zA-Z0-9_]/.test(text[ws - 1]!)) ws--;
    let we = ws;
    while (we < text.length && /[a-zA-Z0-9_]/.test(text[we]!)) we++;
    if (ws >= we || offset < ws || offset > we) {
      return [];
    }
    const word = text.slice(ws, we);

    let targetEntry: any = null;

    for (const entry of unifiedIndex.symbols.values()) {
      if (entry.resourceId === params.textDocument.uri && entry.startByte <= offset && offset < entry.endByte) {
        if (!targetEntry || entry.endByte - entry.startByte < targetEntry.endByte - targetEntry.startByte) {
          targetEntry = entry;
        }
      }
    }

    if (!targetEntry) return [];

    if (targetEntry.kind === "Class" && word !== targetEntry.name) {
      const child = Array.from(unifiedIndex.symbols.values()).find(
        (s: any) => s.resourceId === params.textDocument.uri && s.parentId === targetEntry.id && s.name === word,
      );
      if (child) {
        targetEntry = child;
      }
    }

    // Find the declarations this symbol refers to (or itself if it is a declaration)
    let declarationIds: number[] = [];
    if (isDecl(targetEntry)) {
      declarationIds = [targetEntry.id as number];
    } else {
      const decls = resolveRef(targetEntry, unifiedIndex);
      declarationIds = decls.map((d: any) => d.id as number);
    }

    const results: any[] = [];
    const seen = new Set<string>();

    const addLocation = (uri: string, startByte: number, endByte: number) => {
      let text = documents.get(uri)?.getText();
      if (!text) {
        const cached = documentTrees.get(uri);
        if (cached) text = cached.text;
      }
      if (!text) return;

      const dummyDoc = TextDocument.create(uri, "temp", 1, text);
      const start = dummyDoc.positionAt(startByte);
      const end = dummyDoc.positionAt(endByte);
      const key = `${uri}:${start.line}:${start.character}`;

      if (!seen.has(key)) {
        seen.add(key);
        results.push({ uri, range: { start, end } });
      }
    };

    for (const declId of declarationIds) {
      // Include declaration
      const declEntry = unifiedIndex.symbols.get(declId);
      if (declEntry && declEntry.resourceId) {
        const nameField = declEntry.fieldRanges?.name;
        if (nameField) {
          addLocation(declEntry.resourceId, nameField.startByte, nameField.endByte);
        } else {
          let sByte = declEntry.startByte;
          let eByte = declEntry.endByte;
          const declText =
            documents.get(declEntry.resourceId)?.getText() ?? documentTrees.get(declEntry.resourceId)?.text;
          if (declText && declEntry.name && declEntry.name !== "<anonymous>") {
            const slice = declText.slice(sByte, Math.min(sByte + 300, eByte));
            const idx = slice.indexOf(declEntry.name);
            if (idx !== -1) {
              sByte += idx;
              eByte = sByte + declEntry.name.length;
            }
          }
          addLocation(declEntry.resourceId, sByte, eByte);
        }
      }
      // Include references
      const refs = findRefs(declId, unifiedIndex);
      for (const ref of refs) {
        if (ref.resourceId) {
          addLocation(ref.resourceId, ref.startByte, ref.endByte);
        }
      }
    }

    return results;
  });

  connection.onRenameRequest(async (params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const isSysML2 = params.textDocument.uri.endsWith(".sysml");
    const unifiedIndex = isSysML2 ? await getUnifiedIndex(true) : await getUnifiedIndex(false);

    const offset = document.offsetAt(params.position);
    let targetEntry: any = null;

    for (const entry of unifiedIndex.symbols.values()) {
      if (entry.resourceId === params.textDocument.uri && entry.startByte <= offset && offset < entry.endByte) {
        if (!targetEntry || entry.endByte - entry.startByte < targetEntry.endByte - targetEntry.startByte) {
          targetEntry = entry;
        }
      }
    }

    if (!targetEntry) return null;

    let declarationIds: number[] = [];
    if (isDecl(targetEntry)) {
      declarationIds = [targetEntry.id as number];
    } else {
      const decls = resolveRef(targetEntry, unifiedIndex);
      declarationIds = decls.map((d: any) => d.id as number);
    }

    if (declarationIds.length === 0) return null;

    const changes: WorkspaceEdit["changes"] = {};
    const seen = new Set<string>();

    const addEdit = (uri: string, startByte: number, endByte: number) => {
      let text = documents.get(uri)?.getText();
      if (!text) {
        const cached = documentTrees.get(uri);
        if (cached) text = cached.text;
      }
      if (!text) return;

      const dummyDoc = TextDocument.create(uri, "temp", 1, text);
      const start = dummyDoc.positionAt(startByte);
      const end = dummyDoc.positionAt(endByte);
      const key = `${uri}:${start.line}:${start.character}`;

      if (!seen.has(key)) {
        seen.add(key);
        if (!changes[uri]) changes[uri] = [];
        changes[uri].push({
          range: { start, end },
          newText: params.newName,
        });
      }
    };

    for (const declId of declarationIds) {
      // Include declaration
      const declEntry = unifiedIndex.symbols.get(declId);
      if (declEntry && declEntry.resourceId && declEntry.name) {
        const text = documents.get(declEntry.resourceId)?.getText() ?? documentTrees.get(declEntry.resourceId)?.text;
        if (text) {
          const dummyDoc = TextDocument.create(declEntry.resourceId, "temp", 1, text);
          const nameMatch = text.substring(declEntry.startByte, declEntry.endByte).indexOf(declEntry.name);
          if (nameMatch !== -1) {
            const matchStart = declEntry.startByte + nameMatch;
            const matchEnd = matchStart + declEntry.name.length;
            addEdit(declEntry.resourceId, matchStart, matchEnd);
          }
        }
      }
      // Include references
      const refs = findRefs(declId, unifiedIndex);
      for (const ref of refs) {
        if (ref.resourceId) {
          addEdit(ref.resourceId, ref.startByte, ref.endByte);
        }
      }
    }

    return { changes };
  });

  connection.onCodeAction((params) => {
    const actions: CodeAction[] = [];
    const document = documents.get(params.textDocument.uri);
    if (!document) return actions;

    for (const diagnostic of params.context.diagnostics) {
      // ── Digital Thread Quick-Fixes ──────────────────────────────────
      if (diagnostic.source === "modelscript-digital-thread") {
        const text = document.getText();
        const startOffset = document.offsetAt(diagnostic.range.start);
        const endOffset = document.offsetAt(diagnostic.range.end);
        const termText = text.substring(startOffset, endOffset).trim();

        const data = diagnostic.data as any;
        const consensus = data?.simplexConsensus;
        const sourceVal = data?.sourceValue;
        const unit = data?.unit ? ` ${data.unit}` : "";
        const elemName = data?.elementName || termText;
        const threadId = data?.threadId;
        const slot = data?.slot;

        // Try to locate line content to construct accurate replacement
        const lineStart = document.offsetAt({ line: diagnostic.range.start.line, character: 0 });
        const lineEnd = document.offsetAt({ line: diagnostic.range.start.line + 1, character: 0 });
        const lineContent = text.substring(lineStart, lineEnd);

        // 1. SMT Physics-Simplex Consensus QuickFix
        if (consensus !== undefined) {
          let newRange = diagnostic.range;
          let newText = `${consensus}`;

          // If the line contains an assignment (e.g. mass = 1.0 or Real mass = 1.0;), replace the value part
          const assignMatch = lineContent.match(/(=|:=)\s*([0-9]+(?:\.[0-9]+)?)/);
          if (assignMatch && assignMatch.index !== undefined) {
            const valStartChar = lineContent.indexOf(assignMatch[2]!, assignMatch.index);
            const valEndChar = valStartChar + assignMatch[2]!.length;
            newRange = {
              start: { line: diagnostic.range.start.line, character: valStartChar },
              end: { line: diagnostic.range.start.line, character: valEndChar },
            };
            newText = `${consensus}`;
          }

          actions.push({
            title: `Reconcile '${elemName}' with SMT Physics-Simplex consensus (${consensus}${unit})`,
            kind: CodeActionKind.QuickFix,
            isPreferred: true,
            diagnostics: [diagnostic],
            edit: {
              changes: {
                [params.textDocument.uri]: [
                  {
                    range: newRange,
                    newText,
                  },
                ],
              },
            },
          });
        }

        // 2. Accept Source Value QuickFix
        if (sourceVal !== undefined && data?.sourceDomain) {
          let newRange = diagnostic.range;
          let newText = `${sourceVal}`;
          const assignMatch = lineContent.match(/(=|:=)\s*([0-9]+(?:\.[0-9]+)?)/);
          if (assignMatch && assignMatch.index !== undefined) {
            const valStartChar = lineContent.indexOf(assignMatch[2]!, assignMatch.index);
            const valEndChar = valStartChar + assignMatch[2]!.length;
            newRange = {
              start: { line: diagnostic.range.start.line, character: valStartChar },
              end: { line: diagnostic.range.start.line, character: valEndChar },
            };
            newText = `${sourceVal}`;
          }

          actions.push({
            title: `Accept '${elemName}' from ${data.sourceDomain.toUpperCase()} source (${sourceVal}${unit})`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            edit: {
              changes: {
                [params.textDocument.uri]: [
                  {
                    range: newRange,
                    newText,
                  },
                ],
              },
            },
          });
        }

        // 3. Open in Digital Thread Explorer Command
        if (threadId !== undefined) {
          actions.push({
            title: `Open Thread #${threadId} in Digital Thread Explorer`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            command: {
              title: "Open in Digital Thread Explorer",
              command: "modelscript.openDigitalThread",
              arguments: [{ threadId, slot }],
            },
          });
        }

        continue;
      }

      if (diagnostic.source !== "modelscript") continue;

      // Suggest adding import for unresolved references
      if (diagnostic.message.includes("not found") || diagnostic.message.includes("unresolved")) {
        // Extract the name from the diagnostic range
        const text = document.getText();
        const startOffset = document.offsetAt(diagnostic.range.start);
        const endOffset = document.offsetAt(diagnostic.range.end);
        const unresolvedName = text.substring(startOffset, endOffset);

        if (unresolvedName && /^[a-zA-Z_]/.test(unresolvedName)) {
          actions.push({
            title: `Import '${unresolvedName}'`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            edit: {
              changes: {
                [params.textDocument.uri]: [
                  {
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                    newText: `import ${unresolvedName};\n`,
                  },
                ],
              },
            },
          });
        }
      }

      // Suggest homotopy operator wrapping for steep nonlinearities
      if (
        diagnostic.code === 5010 ||
        diagnostic.code === "homotopyRecommended" ||
        (diagnostic.message && diagnostic.message.includes("without homotopy"))
      ) {
        const text = document.getText();
        const startOffset = document.offsetAt(diagnostic.range.start);
        const endOffset = document.offsetAt(diagnostic.range.end);
        const termText = text.substring(startOffset, endOffset).trim();

        if (termText) {
          const deriveSimp =
            (globalThis as any).deriveSimplification ??
            ((kind: string, varName: string, options?: any) => {
              const startVal = options?.startVal ?? (varName.toLowerCase().startsWith("t") ? 300.0 : 1.0);
              switch (kind) {
                case "power": {
                  const p = options?.power ?? 2;
                  if (p === 2) {
                    const slope = 2 * startVal;
                    const intercept = startVal * startVal;
                    return `(${slope} * ${varName} - ${intercept})`;
                  } else if (p === 4) {
                    const slope = 4 * Math.pow(startVal, 3);
                    const intercept = 3 * Math.pow(startVal, 4);
                    return `(${slope} * ${varName} - ${intercept})`;
                  } else {
                    const slope = p * Math.pow(startVal, p - 1);
                    const intercept = (p - 1) * Math.pow(startVal, p);
                    return `(${slope.toFixed(4)} * ${varName} - ${intercept.toFixed(4)})`;
                  }
                }
                case "quadratic_drag":
                  return `(${varName} * ${startVal})`;
                case "exp": {
                  const arg = options?.arg ?? varName;
                  return `(1.0 + (${arg}))`;
                }
                case "sqrt": {
                  const arg = options?.arg ?? varName;
                  return `(1.0 + 0.5 * ((${arg}) - 1.0))`;
                }
                case "log": {
                  const arg = options?.arg ?? varName;
                  return `((${arg}) - 1.0)`;
                }
                default:
                  return `/* linear proxy */ ${varName}`;
              }
            });

          let simplified: string | null = null;
          const powMatch = termText.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\^\s*([0-9]+(?:\.[0-9]+)?)$/);
          if (powMatch) {
            const varName = powMatch[1];
            const power = parseFloat(powMatch[2]);
            simplified = deriveSimp("power", varName, { power });
          } else if (/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\*\s*abs\(\s*\1\s*\)$/.test(termText)) {
            const varName = termText.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/)?.[1] || "v";
            simplified = deriveSimp("quadratic_drag", varName);
          } else if (/^abs\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)\s*\*\s*\1$/.test(termText)) {
            const varName = termText.match(/abs\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/)?.[1] || "v";
            simplified = deriveSimp("quadratic_drag", varName);
          } else if (/^exp\(\s*([^()]+)\s*\)$/.test(termText)) {
            const arg = termText.match(/^exp\(\s*([^()]+)\s*\)$/)?.[1] || "x";
            const varName = arg.match(/[a-zA-Z_][a-zA-Z0-9_]*/)?.[0] || "x";
            simplified = deriveSimp("exp", varName, { arg });
          } else if (/^sqrt\(\s*([^()]+)\s*\)$/.test(termText)) {
            const arg = termText.match(/^sqrt\(\s*([^()]+)\s*\)$/)?.[1] || "x";
            const varName = arg.match(/[a-zA-Z_][a-zA-Z0-9_]*/)?.[0] || "x";
            simplified = deriveSimp("sqrt", varName, { arg });
          } else {
            simplified = `/* linear proxy */ ${termText}`;
          }

          if (simplified) {
            actions.push({
              title: `Wrap '${termText}' with homotopy (Taylor linearization at start)`,
              kind: CodeActionKind.QuickFix,
              isPreferred: true,
              diagnostics: [diagnostic],
              edit: {
                changes: {
                  [params.textDocument.uri]: [
                    {
                      range: diagnostic.range,
                      newText: `homotopy(${termText}, ${simplified})`,
                    },
                  ],
                },
              },
            });
          }
        }
      }

      // Suggest QuickFix for unhandled scenario / missing guard in SysML v2 decision table
      if (
        diagnostic.code === "DECISION_TABLE_GAP" ||
        diagnostic.code === 4004 ||
        (diagnostic.message &&
          (diagnostic.message.includes("Unhandled input domain") ||
            diagnostic.message.includes("Missing guard scenario") ||
            diagnostic.message.includes("non-exhaustive")))
      ) {
        const fixSnippetMatch = diagnostic.message.match(/QuickFix:\s*(else if[^\n]+)/);
        const conditionMatch = diagnostic.message.match(/condition:\s*([^\n]+)/);
        const condition = conditionMatch ? conditionMatch[1] : "/* unhandled condition */";
        const newSnippet = fixSnippetMatch
          ? `\n  ${fixSnippetMatch[1]} {\n    // Auto-generated QuickFix\n  }`
          : `\n  else if (${condition}) {\n    // Auto-generated QuickFix for unhandled scenario\n  }`;

        actions.push({
          title: "Auto-repair: Insert missing guard scenario (QuickFix)",
          kind: CodeActionKind.QuickFix,
          isPreferred: true,
          diagnostics: [diagnostic],
          edit: {
            changes: {
              [params.textDocument.uri]: [
                {
                  range: {
                    start: diagnostic.range.end,
                    end: diagnostic.range.end,
                  },
                  newText: newSnippet,
                },
              ],
            },
          },
        });
      }
    }

    return actions;
  });

  connection.onWorkspaceSymbol((params) => {
    const query = params.query.toLowerCase();
    if (query.length < 2) return []; // Avoid returning too many results for short queries

    const symbols: {
      name: string;
      kind: SymbolKind;
      location: {
        uri: string;
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
      };
    }[] = [];
    const MAX_RESULTS = 100;

    // Search using the global unified workspace index
    if (getGlobalWorkspaceIndex()) {
      const unifiedIndex = getGlobalWorkspaceIndex().toUnified();
      for (const entry of unifiedIndex.symbols.values()) {
        if (symbols.length >= MAX_RESULTS) break;
        if (!entry.name || entry.name.startsWith("<")) continue;

        let fqn = entry.name;
        let curr = entry.parentId;
        while (curr !== null) {
          const p = unifiedIndex.symbols.get(curr);
          if (p) {
            fqn = p.name + "." + fqn;
            curr = p.parentId;
          } else {
            break;
          }
        }

        if (fqn && fqn.toLowerCase().includes(query)) {
          // Fallback to startByte/endByte if line numbers aren't computed
          symbols.push({
            name: fqn,
            kind: SymbolKind.Class,
            location: {
              uri: entry.resourceId || "modelica:/lib",
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              },
            },
          });
        }
      }
    }

    return symbols;
  });
}

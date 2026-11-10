// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOlgaQuickFixes } from "@modelscript/olga";
import { getPscadQuickFixes, getPscadReferences, getPscadRenameEdits } from "@modelscript/pscad";
import { getPsseCodeActions, getPsseRenameEdits } from "@modelscript/psse";
import {
  CodeAction,
  CodeActionKind,
  Connection,
  SymbolKind,
  TextDocuments,
  WorkspaceEdit,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

function collectPscadWorkspaceDocs(
  documents: TextDocuments<TextDocument>,
  documentTrees: Map<string, any>,
): Array<{ uri: string; text: string }> {
  const docs: Array<{ uri: string; text: string }> = [];
  for (const d of documents.all()) {
    if (/\.(pscx|pslx|pswx|psmx)$/i.test(d.uri)) {
      docs.push({ uri: d.uri, text: d.getText() });
    }
  }
  for (const [tUri, tTree] of documentTrees.entries()) {
    if (/\.(pscx|pslx|pswx|psmx)$/i.test(tUri) && tTree?.text && !docs.some((d) => d.uri === tUri)) {
      docs.push({ uri: tUri, text: tTree.text });
    }
  }
  return docs;
}

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
  void getWorkspaceIndex;

  const isDecl = (entry: any): boolean => {
    return entry.kind !== "Reference" && entry.kind !== "ConnectEquation" && entry.kind !== "FunctionCall";
  };

  const resolveRef = (entry: any, index: any): any[] => {
    if (isDecl(entry)) return [entry];
    let current = entry.parentId ?? null;
    while (current !== null && current !== undefined) {
      const children = index.childrenOf?.get(current) || [];
      for (const childId of children) {
        const sym = index.symbols.get(childId);
        if (sym && sym.name === entry.name && isDecl(sym)) {
          return [sym];
        }
      }
      const parent = index.symbols.get(current);
      current = parent?.parentId ?? null;
    }
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
      if (sym && !isDecl(sym)) {
        const resolved = resolveRef(sym, index);
        if (resolved.some((d: any) => d.id === declId)) {
          refs.push(sym);
        }
      }
    }
    return refs;
  };

  connection.onReferences(async (params) => {
    await flushValidation(params.textDocument.uri);
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const offset = document.offsetAt(params.position);
    const text = document.getText();

    if (/\.(pscx|pslx|pswx|psmx)$/i.test(params.textDocument.uri)) {
      const pscadDocs = collectPscadWorkspaceDocs(documents, documentTrees);
      const pscadRefs = getPscadReferences(text, offset, params.textDocument.uri, pscadDocs);
      if (pscadRefs.length > 0) return pscadRefs;
    }

    const { globalLanguageRegistry } = await import("../registry/LanguageRegistry.js");
    const plugin = globalLanguageRegistry.getPluginForUri(params.textDocument.uri, text);
    if (plugin?.customHandlers?.references) {
      const refs = plugin.customHandlers.references(offset, text, params.textDocument.uri);
      if (refs && refs.length > 0) return refs;
    }

    const isSysML2 = params.textDocument.uri.endsWith(".sysml");
    const unifiedIndex = isSysML2 ? await getUnifiedIndex(true) : await getUnifiedIndex(false);
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
      const eStart = entry.startOffset;
      const eEnd = entry.endOffset;
      if (entry.resourceId === params.textDocument.uri && eStart <= offset && offset < eEnd) {
        const targetStart = targetEntry ? targetEntry.startOffset : 0;
        const targetEnd = targetEntry ? targetEntry.endOffset : 0;
        if (!targetEntry || eEnd - eStart < targetEnd - targetStart) {
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

    const addLocation = (uri: string, startOffset: number, endOffset: number) => {
      let text = documents.get(uri)?.getText();
      if (!text) {
        const cached = documentTrees.get(uri);
        if (cached) text = cached.text;
      }
      if (!text) return;

      const dummyDoc = TextDocument.create(uri, "temp", 1, text);
      const start = dummyDoc.positionAt(startOffset);
      const end = dummyDoc.positionAt(endOffset);
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
          addLocation(declEntry.resourceId, nameField.startOffset, nameField.endOffset);
        } else {
          let sOff = declEntry.startOffset;
          let eOff = declEntry.endOffset;
          const declText =
            documents.get(declEntry.resourceId)?.getText() ?? documentTrees.get(declEntry.resourceId)?.text;
          if (declText && declEntry.name && declEntry.name !== "<anonymous>") {
            const slice = declText.slice(sOff, Math.min(sOff + 300, eOff));
            const idx = slice.indexOf(declEntry.name);
            if (idx !== -1) {
              sOff += idx;
              eOff = sOff + declEntry.name.length;
            }
          }
          addLocation(declEntry.resourceId, sOff, eOff);
        }
      }
      // Include references
      const refs = findRefs(declId, unifiedIndex);
      for (const ref of refs) {
        if (ref.resourceId) {
          addLocation(ref.resourceId, ref.startOffset, ref.endOffset);
        }
      }
    }

    return results;
  });

  connection.onRenameRequest(async (params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const offset = document.offsetAt(params.position);
    if (/\.(pscx|pslx|pswx|psmx)$/i.test(params.textDocument.uri)) {
      const pscadDocs = collectPscadWorkspaceDocs(documents, documentTrees);
      const pscadRename = getPscadRenameEdits(
        document.getText(),
        offset,
        params.newName,
        params.textDocument.uri,
        pscadDocs,
      );
      if (pscadRename) return { changes: pscadRename };
    }

    if (/\.(raw|dyr)$/i.test(params.textDocument.uri) || document.languageId === "psse") {
      const { globalLanguageRegistry } = await import("../registry/LanguageRegistry.js");
      const plugin = globalLanguageRegistry.getPluginForUri(params.textDocument.uri, document.getText());
      const psseRename = getPsseRenameEdits(
        document.getText(),
        params.position,
        params.newName,
        params.textDocument.uri,
        plugin?.workspaceIndex as unknown as Parameters<typeof getPsseRenameEdits>[4],
      );
      if (psseRename) return psseRename;
    }

    const isSysML2 = params.textDocument.uri.endsWith(".sysml");
    const unifiedIndex = isSysML2 ? await getUnifiedIndex(true) : await getUnifiedIndex(false);
    let targetEntry: any = null;

    for (const entry of unifiedIndex.symbols.values()) {
      const eStart = entry.startOffset;
      const eEnd = entry.endOffset;
      if (entry.resourceId === params.textDocument.uri && eStart <= offset && offset < eEnd) {
        const targetStart = targetEntry ? targetEntry.startOffset : 0;
        const targetEnd = targetEntry ? targetEntry.endOffset : 0;
        if (!targetEntry || eEnd - eStart < targetEnd - targetStart) {
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

    const addEdit = (uri: string, startOffset: number, endOffset: number) => {
      let text = documents.get(uri)?.getText();
      if (!text) {
        const cached = documentTrees.get(uri);
        if (cached) text = cached.text;
      }
      if (!text) return;

      const dummyDoc = TextDocument.create(uri, "temp", 1, text);
      const start = dummyDoc.positionAt(startOffset);
      const end = dummyDoc.positionAt(endOffset);
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
          void dummyDoc;
          const declStart = declEntry.startOffset;
          const declEnd = declEntry.endOffset;
          const nameMatch = text.substring(declStart, declEnd).indexOf(declEntry.name);
          if (nameMatch !== -1) {
            const matchStart = declStart + nameMatch;
            const matchEnd = matchStart + declEntry.name.length;
            addEdit(declEntry.resourceId, matchStart, matchEnd);
          }
        }
      }
      // Include references
      const refs = findRefs(declId, unifiedIndex);
      for (const ref of refs) {
        if (ref.resourceId) {
          addEdit(ref.resourceId, ref.startOffset, ref.endOffset);
        }
      }
    }

    return { changes };
  });

  connection.onCodeAction((params) => {
    const actions: CodeAction[] = [];
    const document = documents.get(params.textDocument.uri);
    if (!document) return actions;

    const requestedKinds = params.context.only;
    const isKindAllowed = (kind: string | undefined): boolean => {
      if (!requestedKinds || requestedKinds.length === 0) return true;
      if (!kind) return false;
      return requestedKinds.some((req) => kind === req || kind.startsWith(`${req}.`));
    };

    const docUri = params.textDocument.uri;
    const docText = document.getText();
    const docLines = docText.split(/\r?\n/);
    const cursorLine = docLines[params.range.start.line] ?? "";

    // Declaration-level CodeActions (only evaluated when Source or Refactor kinds are requested)
    const allowDeclarations = isKindAllowed(CodeActionKind.Source) || isKindAllowed(CodeActionKind.Refactor);
    if (allowDeclarations && /\.(sysml|kerml)$/i.test(docUri)) {
      const partMatch = /^\s*(?:abstract\s+)?part\s+def\s+([A-Za-z0-9_]+)/.exec(cursorLine);
      if (partMatch) {
        const partName = partMatch[1]!;
        actions.push(
          {
            title: `Verify Contracts & Hierarchy for '${partName}'`,
            kind: CodeActionKind.Source,
            command: {
              title: "Verify Contracts & Hierarchy",
              command: "modelscript.openContractExplorer",
              arguments: [docUri, partName],
            },
          },
          {
            title: `Scaffold Multi-Domain Models (SCAD + Modelica + FEA) for '${partName}'`,
            kind: CodeActionKind.RefactorRewrite,
            command: {
              title: "Scaffold Multi-Domain (SCAD + MO + FEA)",
              command: "modelscript.scaffoldMultiDomain",
              arguments: [docUri, partName],
            },
          },
          {
            title: `Project '${partName}' to Target Engineering Domain...`,
            kind: CodeActionKind.Refactor,
            command: {
              title: "Project Model to Target Engineering Domain",
              command: "modelscript.projectModel",
              arguments: [docUri, partName],
            },
          },
        );
      }

      const reqMatch = /^\s*(?:abstract\s+)?requirement\s+def\s+([A-Za-z0-9_]+)/.exec(cursorLine);
      if (reqMatch) {
        const reqName = reqMatch[1]!;
        actions.push({
          title: `Verify Formal Requirement Contract '${reqName}'`,
          kind: CodeActionKind.Source,
          command: {
            title: `Verify Formal Requirement Contract: ${reqName}`,
            command: "modelscript.runReachabilityFlowpipe",
            arguments: [docUri],
          },
        });
      }

      const actionMatch = /^\s*(?:abstract\s+)?(?:action|calc)\s+def\s+([A-Za-z0-9_]+)/.exec(cursorLine);
      if (actionMatch) {
        const actName = actionMatch[1]!;
        actions.push(
          {
            title: `Run Formal MC/DC Coverage Tests for '${actName}'`,
            kind: CodeActionKind.Source,
            command: {
              title: "Run Formal MC/DC Tests",
              command: "modelscript.runMcdcTests",
              arguments: [docUri, actName],
            },
          },
          {
            title: `Decompose State/Decision Regions for '${actName}'`,
            kind: CodeActionKind.Source,
            command: {
              title: "Decompose Regions",
              command: "modelscript.decomposeRegions",
              arguments: [docUri, actName],
            },
          },
        );
      }
    } else if (allowDeclarations && /\.mo$/i.test(docUri)) {
      const classMatch = /^\s*(?:model|block|study|process|class)\s+([A-Za-z0-9_]+)/.exec(cursorLine);
      if (classMatch) {
        const className = classMatch[1]!;
        actions.push(
          {
            title: `Open Interactive Diagram for '${className}'`,
            kind: CodeActionKind.Source,
            command: {
              title: "Open Interactive Diagram",
              command: "modelscript.openDiagram",
              arguments: [docUri],
            },
          },
          {
            title: `Project '${className}' to Target Engineering Domain...`,
            kind: CodeActionKind.Refactor,
            command: {
              title: "Project Model to Target Engineering Domain",
              command: "modelscript.projectModel",
              arguments: [docUri, className],
            },
          },
        );
      }
    }

    if (/\.(pscx|pslx|pswx|psmx)$/i.test(params.textDocument.uri)) {
      const pscadFixes = getPscadQuickFixes(document.getText(), params.textDocument.uri);
      for (const fix of pscadFixes) {
        actions.push({
          title: fix.title,
          kind: CodeActionKind.QuickFix,
          edit: fix.edit,
        });
      }
    }

    if (/\.(opi|olga)$/i.test(params.textDocument.uri)) {
      const olgaFixes = getOlgaQuickFixes(document.getText(), params.textDocument.uri);
      for (const fix of olgaFixes) {
        const action: CodeAction = {
          title: fix.title,
          kind: CodeActionKind.QuickFix,
          edit: fix.edit,
        };
        if (fix.isPreferred !== undefined) {
          action.isPreferred = fix.isPreferred;
        }
        actions.push(action);
      }
    }

    if (/\.(raw|dyr)$/i.test(params.textDocument.uri) || document.languageId === "psse") {
      const psseActions = getPsseCodeActions(
        document.getText(),
        params.range,
        params.context.diagnostics as unknown as Parameters<typeof getPsseCodeActions>[2],
        params.textDocument.uri,
      );
      for (const fix of psseActions) {
        const action: CodeAction = {
          title: fix.title,
          kind: CodeActionKind.QuickFix,
          edit: fix.edit,
        };
        if (fix.isPreferred !== undefined) {
          action.isPreferred = fix.isPreferred;
        }
        actions.push(action);
      }
    }

    const batchDriftEdits: Array<{ range: any; newText: string }> = [];
    const batchDriftDiags: any[] = [];

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

      // ── Reasoner & Verification QuickFixes (M4101, M4102, M5101, M5102, M5103, M5104) ──
      const isReasonerDiag =
        diagnostic.source?.includes("reasoner") ||
        diagnostic.source?.includes("drift-checker") ||
        diagnostic.code === "M4101" ||
        diagnostic.code === "M4102" ||
        diagnostic.code === "M5101" ||
        diagnostic.code === "M5102" ||
        diagnostic.code === "M5103" ||
        diagnostic.code === "M5104" ||
        diagnostic.code === "division_by_zero" ||
        diagnostic.code === "div_by_zero" ||
        diagnostic.code === "min_bound_violation" ||
        diagnostic.code === "max_bound_violation";

      if (isReasonerDiag) {
        const text = document.getText();
        const lineStart = document.offsetAt({ line: diagnostic.range.start.line, character: 0 });
        const lineEnd = document.offsetAt({ line: diagnostic.range.start.line + 1, character: 0 });
        const lineContent = text.substring(lineStart, lineEnd);
        const data = diagnostic.data as any;
        const numMatch = lineContent.match(/(=|:=|:)\s*([0-9]+(?:\.[0-9]+)?)/);

        // 0. Cross-Language Parameter Drift QuickFix (M5104)
        if (diagnostic.code === "M5104" || diagnostic.source?.includes("drift-checker")) {
          const suggestedVal = data?.suggestedValue;
          const currentVal = data?.currentValue;
          const paramName = data?.param || "parameter";
          const counterpartLang = (data?.counterpartLang || "counterpart").toUpperCase();

          if (suggestedVal !== undefined) {
            let newRange = diagnostic.range;
            let newText = `${suggestedVal}`;

            // Match numeric literals (including signs, decimals, scientific notation, and scale suffixes)
            const numPattern = /[-+]?\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?[a-zA-Z]?\b/g;
            const matches: RegExpExecArray[] = [];
            let m: RegExpExecArray | null;
            while ((m = numPattern.exec(lineContent)) !== null) {
              matches.push(m);
            }

            let bestMatch: RegExpExecArray | undefined;
            if (currentVal !== undefined && matches.length > 0) {
              // Try finding the token whose numeric value matches currentVal
              bestMatch = matches.find((cand) => {
                const parsed = parseFloat(cand[0]);
                return (
                  Math.abs(parsed - currentVal) < 1e-6 ||
                  Math.abs(parsed - currentVal) / Math.max(Math.abs(currentVal), 1) < 1e-4
                );
              });
            }

            // In netlists like SPICE (e.g. R1 1 2 100), the parameter value is the last numeric token, not node IDs!
            if (!bestMatch && matches.length > 0) {
              const eqIdx = lineContent.indexOf("=");
              if (eqIdx !== -1) {
                bestMatch = matches.find((cand) => cand.index >= eqIdx);
              } else {
                bestMatch = matches[matches.length - 1];
              }
            }

            if (bestMatch && bestMatch.index !== undefined) {
              const valStartChar = bestMatch.index;
              const valEndChar = valStartChar + bestMatch[0].length;
              newRange = {
                start: { line: diagnostic.range.start.line, character: valStartChar },
                end: { line: diagnostic.range.start.line, character: valEndChar },
              };
            }

            batchDriftEdits.push({ range: newRange, newText });
            batchDriftDiags.push(diagnostic);

            actions.push({
              title: `Synchronize '${paramName}' to ${suggestedVal} (Matches ${counterpartLang})`,
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

            // Reverse synchronization: propagate local value to counterpart document
            const counterpartUri = data?.counterpartUri;
            if (counterpartUri && currentVal !== undefined) {
              const counterpartDoc = documents.get(counterpartUri);
              const counterpartText = counterpartDoc?.getText() ?? documentTrees.get(counterpartUri)?.text;
              const counterpartFile = counterpartUri.split("/").pop() || counterpartUri;

              let cRange = data.counterpartRange;
              if (counterpartText && cRange) {
                const cDoc = counterpartDoc || TextDocument.create(counterpartUri, "temp", 1, counterpartText);
                const cLineStart = cDoc.offsetAt({ line: cRange.start.line, character: 0 });
                const cLineEnd = cDoc.offsetAt({ line: cRange.start.line + 1, character: 0 });
                const cLineContent = counterpartText.substring(cLineStart, cLineEnd);

                const cNumPattern = /[-+]?\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?[a-zA-Z]?\b/g;
                const cMatches: RegExpExecArray[] = [];
                let cm: RegExpExecArray | null;
                while ((cm = cNumPattern.exec(cLineContent)) !== null) {
                  cMatches.push(cm);
                }

                let cBestMatch: RegExpExecArray | undefined;
                if (suggestedVal !== undefined && cMatches.length > 0) {
                  cBestMatch = cMatches.find((cand) => {
                    const parsed = parseFloat(cand[0]);
                    return (
                      Math.abs(parsed - suggestedVal) < 1e-6 ||
                      Math.abs(parsed - suggestedVal) / Math.max(Math.abs(suggestedVal), 1) < 1e-4
                    );
                  });
                }
                if (!cBestMatch && cMatches.length > 0) {
                  const eqIdx = cLineContent.indexOf("=");
                  if (eqIdx !== -1) {
                    cBestMatch = cMatches.find((cand) => cand.index >= eqIdx);
                  } else {
                    cBestMatch = cMatches[cMatches.length - 1];
                  }
                }

                if (cBestMatch && cBestMatch.index !== undefined) {
                  const cValStartChar = cBestMatch.index;
                  const cValEndChar = cValStartChar + cBestMatch[0].length;
                  cRange = {
                    start: { line: cRange.start.line, character: cValStartChar },
                    end: { line: cRange.start.line, character: cValEndChar },
                  };
                }

                actions.push({
                  title: `Propagate local '${paramName}' (${currentVal}) to ${counterpartLang} in '${counterpartFile}'`,
                  kind: CodeActionKind.QuickFix,
                  diagnostics: [diagnostic],
                  edit: {
                    changes: {
                      [counterpartUri]: [
                        {
                          range: cRange,
                          newText: `${currentVal}`,
                        },
                      ],
                    },
                  },
                });
              }
            }
          }
          continue;
        }

        // 1. Parameter Boundary Relaxation QuickFix (Derived from MCS or numeric literal on line)
        if (
          diagnostic.code === "M4101" ||
          diagnostic.code === "M4102" ||
          (diagnostic.source?.includes("reasoner") && !diagnostic.code?.toString().startsWith("M5"))
        ) {
          const suggestedVal = data?.suggestedValue;
          if (suggestedVal !== undefined && numMatch && numMatch.index !== undefined) {
            const valStartChar = lineContent.indexOf(numMatch[2]!, numMatch.index);
            const valEndChar = valStartChar + numMatch[2]!.length;

            actions.push({
              title: `Relax boundary parameter to ${suggestedVal} (Restores consistency)`,
              kind: CodeActionKind.QuickFix,
              isPreferred: true,
              diagnostics: [diagnostic],
              edit: {
                changes: {
                  [params.textDocument.uri]: [
                    {
                      range: {
                        start: { line: diagnostic.range.start.line, character: valStartChar },
                        end: { line: diagnostic.range.start.line, character: valEndChar },
                      },
                      newText: `${suggestedVal}`,
                    },
                  ],
                },
              },
            });
          }
        }

        // 2. Abstract Interpretation Division Guard QuickFix
        if (
          diagnostic.code === "M5101" ||
          diagnostic.code === "division_by_zero" ||
          diagnostic.code === "div_by_zero" ||
          diagnostic.message.includes("division by zero")
        ) {
          const slashMatch = lineContent.match(/\/\s*([a-zA-Z_][a-zA-Z0-9_]*)/);
          if (slashMatch && slashMatch[1] && slashMatch.index !== undefined) {
            const varName = slashMatch[1];
            const varStartChar = slashMatch.index + slashMatch[0].lastIndexOf(varName);
            const varEndChar = varStartChar + varName.length;
            actions.push({
              title: `Guard against division by zero with 'max(1e-6, ${varName})'`,
              kind: CodeActionKind.QuickFix,
              diagnostics: [diagnostic],
              edit: {
                changes: {
                  [params.textDocument.uri]: [
                    {
                      range: {
                        start: { line: diagnostic.range.start.line, character: varStartChar },
                        end: { line: diagnostic.range.start.line, character: varEndChar },
                      },
                      newText: `max(1e-6, ${varName})`,
                    },
                  ],
                },
              },
            });
          }
        }

        // 4. Contract Refinement QuickFix (M5102)
        if (diagnostic.code === "M5102" || diagnostic.message.includes("contract")) {
          const reqLimit = data?.requiredLimit ?? data?.suggestedValue;
          if (reqLimit !== undefined && numMatch && numMatch.index !== undefined) {
            const valStartChar = lineContent.indexOf(numMatch[2]!, numMatch.index);
            const valEndChar = valStartChar + numMatch[2]!.length;
            actions.push({
              title: `Adjust contract to satisfy parent requirement (${reqLimit})`,
              kind: CodeActionKind.QuickFix,
              isPreferred: true,
              diagnostics: [diagnostic],
              edit: {
                changes: {
                  [params.textDocument.uri]: [
                    {
                      range: {
                        start: { line: diagnostic.range.start.line, character: valStartChar },
                        end: { line: diagnostic.range.start.line, character: valEndChar },
                      },
                      newText: `${reqLimit}`,
                    },
                  ],
                },
              },
            });
          }
        }

        // 5. Reachability Boundary Enclosure QuickFix (M5103)
        if (
          diagnostic.code === "M5103" ||
          diagnostic.code === "min_bound_violation" ||
          diagnostic.code === "max_bound_violation" ||
          diagnostic.message.includes("boundary") ||
          diagnostic.message.includes("flowpipe")
        ) {
          const provenBound = data?.provenBound ?? data?.suggestedValue;
          if (provenBound !== undefined && numMatch && numMatch.index !== undefined) {
            const valStartChar = lineContent.indexOf(numMatch[2]!, numMatch.index);
            const valEndChar = valStartChar + numMatch[2]!.length;
            actions.push({
              title: `Enclose reachability flowpipe boundary (${provenBound})`,
              kind: CodeActionKind.QuickFix,
              isPreferred: true,
              diagnostics: [diagnostic],
              edit: {
                changes: {
                  [params.textDocument.uri]: [
                    {
                      range: {
                        start: { line: diagnostic.range.start.line, character: valStartChar },
                        end: { line: diagnostic.range.start.line, character: valEndChar },
                      },
                      newText: `${provenBound}`,
                    },
                  ],
                },
              },
            });
          }
        }

        // 6. Comment Out Conflicting Assertion QuickFix
        if (
          diagnostic.code === "M4101" ||
          diagnostic.code === "M4102" ||
          (diagnostic.source?.includes("reasoner") && !diagnostic.code?.toString().startsWith("M5"))
        ) {
          const uriLower = params.textDocument.uri.toLowerCase();
          let commentPrefix = "// ";
          if (uriLower.endsWith(".cir") || uriLower.endsWith(".sp") || uriLower.endsWith(".spice")) {
            commentPrefix = "* ";
          } else if (
            uriLower.endsWith(".py") ||
            uriLower.endsWith(".yaml") ||
            uriLower.endsWith(".yml") ||
            uriLower.endsWith(".ampl")
          ) {
            commentPrefix = "# ";
          } else if (uriLower.endsWith(".f") || uriLower.endsWith(".f90")) {
            commentPrefix = "! ";
          }

          actions.push({
            title: `Comment out conflicting assertion (Restores local consistency)`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            edit: {
              changes: {
                [params.textDocument.uri]: [
                  {
                    range: {
                      start: { line: diagnostic.range.start.line, character: 0 },
                      end: { line: diagnostic.range.start.line, character: 0 },
                    },
                    newText: commentPrefix,
                  },
                ],
              },
            },
          });
        }

        continue;
      }

      if (diagnostic.source !== "modelscript" && diagnostic.source !== "modelica") continue;

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
        diagnostic.code === 5040 ||
        diagnostic.code === "homotopyRecommended" ||
        (diagnostic.message && diagnostic.message.includes("without homotopy"))
      ) {
        const text = document.getText();
        const startOffset = document.offsetAt(diagnostic.range.start);
        const endOffset = document.offsetAt(diagnostic.range.end);
        const termText = text.substring(startOffset, endOffset).trim();

        if (termText) {
          const deriveSimp = (kind: string, varName: string, options?: any) => {
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
          };

          let simplified: string | null = null;
          const powMatch = termText.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\^\s*([0-9]+(?:\.[0-9]+)?)$/);
          if (powMatch) {
            const varName = powMatch[1]!;
            const power = parseFloat(powMatch[2]!);
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

    if (batchDriftEdits.length >= 2) {
      actions.push({
        title: `Synchronize all drifted parameters (${batchDriftEdits.length}) in this document`,
        kind: CodeActionKind.SourceFixAll,
        diagnostics: batchDriftDiags,
        edit: {
          changes: {
            [params.textDocument.uri]: batchDriftEdits,
          },
        },
      });
    }

    return actions.filter((a) => isKindAllowed(a.kind));
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
    const globalWsIdx = getGlobalWorkspaceIndex?.();
    if (globalWsIdx) {
      const unifiedIndex = globalWsIdx.toUnified();
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
          // Fallback to startOffset/endOffset if line numbers aren't computed
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

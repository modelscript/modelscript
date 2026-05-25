/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, prefer-const, @typescript-eslint/no-non-null-assertion */
// @ts-nocheck
import { Connection } from "vscode-languageserver";

export function registerMiscEndpoints(connection: Connection, documentManager: any, workspaceManager: any) {
  connection.onNotification("modelscript/registryPackages", async (params: { packages: RegistryPackageInfo[] }) => {
    if (savedLoaderCtx) {
      connection.console.info(`[lsp] Received ${params.packages.length} registry packages from client.`);
      await loadRegistryPackages(params.packages, savedLoaderCtx);
      // Re-validate all documents to pick up the newly indexed library items
      for (const doc of documents.all()) {
        validateTextDocument(doc);
      }
    } else {
      connection.console.warn("[lsp] Received registry packages but loader context is not ready.");
    }
  });

  connection.onRequest("modelscript/getTraceabilityMatrix", (params: { uri: string }) => {
    try {
      const db = workspaceManager.unifiedWorkspace.toUnifiedPartial();
      return getTraceabilityMatrix(db); // Do not filter by uri to show workspace-level traceability
    } catch (e) {
      console.error("[traceability] Error:", e);
      return { sources: [], targets: [], links: [] };
    }
  });

  connection.onRequest("modelscript/resolveMarkdownVars", (): { values: Record<string, string> } => {
    return { values: {} };
  });

  connection.onRequest(
    "modelscript/resolveMarkdownContent",
    (): {
      requirements: Record<string, { rows: { reqId: string; name: string; text: string; status: string }[] }>;
      diagrams: Record<
        string,
        { components: { name: string; type: string }[]; connections: { from: string; to: string }[] }
      >;
    } => {
      return { requirements: {}, diagrams: {} };
    },
  );

  connection.onRequest(
    "modelscript/generateCommitMessage",
    async (params: { changes: { uri: string; oldText: string; newText: string }[] }) => {
      let descriptions: string[] = [];
      let scopeStr = "";

      for (const change of params.changes) {
        const isSysml = change.uri.endsWith(".sysml");
        const isModelica = change.uri.endsWith(".mo");
        if (!isSysml && !isModelica) continue;

        scopeStr = isSysml ? "sysml" : "modelica";

        const hooks = isSysml ? sysml2IndexerHooks : modelicaIndexerHooks;
        const qHooks = isSysml ? sysml2QueryHooks : modelicaQueryHooks;
        const wrapEntry = isSysml ? sysml2WrapEntry : modelicaWrapEntry;
        const langParser = isSysml ? sysml2Parser : parser;

        if (!langParser) continue;

        try {
          const oldTree = langParser.parse(change.oldText);
          const oldIndexer = new SymbolIndexer(hooks);
          const oldIndex = oldIndexer.index(oldTree.rootNode);
          const oldDb = new QueryEngine(oldIndex, qHooks);
          const oldRootEntries = oldIndex.childrenOf.get(null) || [];

          const newTree = langParser.parse(change.newText);
          const newIndexer = new SymbolIndexer(hooks);
          const newIndex = newIndexer.index(newTree.rootNode);
          const newDb = new QueryEngine(newIndex, qHooks);
          const newRootEntries = newIndex.childrenOf.get(null) || [];

          const maxLen = Math.max(oldRootEntries.length, newRootEntries.length);
          for (let i = 0; i < maxLen; i++) {
            let oldNode = null;
            let newNode = null;
            if (i < oldRootEntries.length) {
              const entry = oldIndex.symbols.get(oldRootEntries[i]);
              if (entry) oldNode = wrapEntry(entry, oldDb.toQueryDB());
            }
            if (i < newRootEntries.length) {
              const entry = newIndex.symbols.get(newRootEntries[i]);
              if (entry) newNode = wrapEntry(entry, newDb.toQueryDB());
            }

            if (!oldNode && !newNode) continue;

            // Special handling if one side is null (deleted or inserted root node)
            let diff: SemanticEdit;
            if (!oldNode && newNode) {
              diff = {
                action: "insert",
                newNode,
                description: `Added ${newNode.entry.kind} '${newNode.entry.name || "unnamed"}'`,
              };
            } else if (oldNode && !newNode) {
              diff = {
                action: "delete",
                oldNode,
                description: `Deleted ${oldNode.entry.kind} '${oldNode.entry.name || "unnamed"}'`,
              };
            } else {
              diff = computeSemanticDiff(oldNode!, newNode!, {
                nodeFactory: wrapEntry as any,
                orderAgnostic: true,
              });
            }

            const collectDescriptions = (edit: SemanticEdit) => {
              if (edit.description) descriptions.push(edit.description);
              if (edit.children) {
                for (const child of edit.children) collectDescriptions(child);
              }
            };

            collectDescriptions(diff);
          }
        } catch (e) {
          console.error("Diff error", e);
        }
      }

      if (descriptions.length === 0) {
        return { commitMessage: `chore(${scopeStr || "core"}): update files` };
      }

      // Aggregate descriptions
      const uniqueDescs = Array.from(new Set(descriptions));
      const commitMsg = `feat(${scopeStr}): ${uniqueDescs.join(", ")}`;
      return { commitMessage: commitMsg };
    },
  );

  connection.onRequest(
    "modelscript/getSemanticDiff",
    async (params: { uri: string; oldText: string; newText: string }): Promise<{ diffs: FlatSemanticEdit[] }> => {
      const isSysml = params.uri.endsWith(".sysml");
      const isModelica = params.uri.endsWith(".mo");
      if (!isSysml && !isModelica) return { diffs: [] };

      const hooks = isSysml ? sysml2IndexerHooks : modelicaIndexerHooks;
      const qHooks = isSysml ? sysml2QueryHooks : modelicaQueryHooks;
      const wrapEntry = isSysml ? sysml2WrapEntry : modelicaWrapEntry;
      const langParser = isSysml ? sysml2Parser : parser;

      if (!langParser) return { diffs: [] };

      try {
        const oldDoc = TextDocument.create(params.uri, isSysml ? "sysml2" : "modelica", 1, params.oldText);
        const newDoc = TextDocument.create(params.uri, isSysml ? "sysml2" : "modelica", 1, params.newText);

        const oldTree = langParser.parse(params.oldText);
        const oldIndexer = new SymbolIndexer(hooks);
        const oldIndex = oldIndexer.index(oldTree.rootNode);
        const oldDb = new QueryEngine(oldIndex, qHooks);
        const oldRootEntries = oldIndex.childrenOf.get(null) || [];

        const newTree = langParser.parse(params.newText);
        const newIndexer = new SymbolIndexer(hooks);
        const newIndex = newIndexer.index(newTree.rootNode);
        const newDb = new QueryEngine(newIndex, qHooks);
        const newRootEntries = newIndex.childrenOf.get(null) || [];

        const maxLen = Math.max(oldRootEntries.length, newRootEntries.length);
        const diffs: FlatSemanticEdit[] = [];

        for (let i = 0; i < maxLen; i++) {
          let oldNode = null;
          let newNode = null;
          if (i < oldRootEntries.length) {
            const entry = oldIndex.symbols.get(oldRootEntries[i]);
            if (entry) oldNode = wrapEntry(entry, oldDb.toQueryDB());
          }
          if (i < newRootEntries.length) {
            const entry = newIndex.symbols.get(newRootEntries[i]);
            if (entry) newNode = wrapEntry(entry, newDb.toQueryDB());
          }

          if (!oldNode && !newNode) continue;

          let diff: SemanticEdit;
          if (!oldNode && newNode) {
            diff = {
              action: "insert",
              newNode,
              description: `Inserted ${newNode.entry.kind} '${newNode.entry.name || "unnamed"}'`,
            };
          } else if (oldNode && !newNode) {
            diff = {
              action: "delete",
              oldNode,
              description: `Deleted ${oldNode.entry.kind} '${oldNode.entry.name || "unnamed"}'`,
            };
          } else {
            diff = computeSemanticDiff(oldNode!, newNode!, {
              nodeFactory: wrapEntry as any,
              orderAgnostic: true,
            });
          }

          const flattenDiffs = (edit: SemanticEdit) => {
            if (edit.action !== "none" && edit.description) {
              const flatEdit: FlatSemanticEdit = {
                action: edit.action,
                description: edit.description,
              };

              if (edit.oldNode) {
                const startPos = oldDoc.positionAt(edit.oldNode.entry.startByte);
                const endPos = oldDoc.positionAt(edit.oldNode.entry.endByte);
                flatEdit.oldRange = {
                  startLine: startPos.line,
                  startCharacter: startPos.character,
                  endLine: endPos.line,
                  endCharacter: endPos.character,
                };
                flatEdit.kind = edit.oldNode.entry.kind;
              }

              if (edit.newNode) {
                const startPos = newDoc.positionAt(edit.newNode.entry.startByte);
                const endPos = newDoc.positionAt(edit.newNode.entry.endByte);
                flatEdit.newRange = {
                  startLine: startPos.line,
                  startCharacter: startPos.character,
                  endLine: endPos.line,
                  endCharacter: endPos.character,
                };
                flatEdit.kind = edit.newNode.entry.kind;
              }

              diffs.push(flatEdit);
            }

            if (edit.children) {
              for (const child of edit.children) flattenDiffs(child);
            }
          };

          flattenDiffs(diff);
        }

        return { diffs };
      } catch (e) {
        console.error("getSemanticDiff error", e);
        return { diffs: [] };
      }
    },
  );

  connection.onRequest("modelscript/runVerification", async (params: { uri: string }) => {
    return runVerificationForUri(params.uri);
  });
}

// @ts-nocheck

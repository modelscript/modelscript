/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, prefer-const, @typescript-eslint/no-non-null-assertion */
// @ts-nocheck
import { LspContext } from "../LspContext";

export function registerMiscEndpoints(context: LspContext) {
  // ── Viewport tracking for prioritized linting ────────────────────────
  // Client sends visible line ranges on scroll/edit. We convert to byte
  // ranges and store in ValidationService for viewport-aware linting.
  context.connection.onNotification(
    "modelscript/visibleRanges",
    (params: { uri: string; ranges: { startLine: number; endLine: number }[] }) => {
      if (!params.ranges || params.ranges.length === 0) {
        context.validationService.documentViewports.delete(params.uri);
        return;
      }
      // Use the bridge's PositionIndex to convert lines → byte offsets
      const bridge = context.validationService.documentLSPBridges.get(params.uri);
      if (bridge && (bridge as any).positions) {
        const positions = (bridge as any).positions;
        // Merge all visible ranges into one encompassing byte range
        let minByte = Infinity;
        let maxByte = 0;
        for (const range of params.ranges) {
          const startByte = positions.positionToOffset(range.startLine, 0);
          const endByte = positions.positionToOffset(range.endLine + 1, 0); // end of last visible line
          if (startByte < minByte) minByte = startByte;
          if (endByte > maxByte) maxByte = endByte;
        }
        if (minByte < maxByte) {
          context.validationService.documentViewports.set(params.uri, { startByte: minByte, endByte: maxByte });
        }
      }
    },
  );

  context.connection.onNotification(
    "modelscript/registryPackages",
    async (params: { packages: RegistryPackageInfo[] }) => {
      if (savedLoaderCtx) {
        context.connection.console.info(`[lsp] Received ${params.packages.length} registry packages from client.`);
        await loadRegistryPackages(params.packages, savedLoaderCtx);
        // Re-validate all documents to pick up the newly indexed library items
        for (const doc of context.documents.all()) {
          context.validationService.validateTextDocument(doc);
        }
      } else {
        context.connection.console.warn("[lsp] Received registry packages but loader context is not ready.");
      }
    },
  );

  // Handler for installing a single dependency from the registry (triggered by web IDE install button)
  context.connection.onNotification(
    "modelscript/installDependency",
    async (params: { name: string; version: string }) => {
      if (!savedLoaderCtx) {
        context.connection.console.warn("[lsp] installDependency: loader context not ready.");
        return;
      }
      context.connection.console.info(`[lsp] Installing dependency ${params.name}@${params.version} from registry...`);
      context.connection.sendNotification("modelscript/status", {
        state: "loading",
        message: `Loading ${params.name}@${params.version}...`,
      });
      try {
        await loadDependencyFromRegistry(params, savedLoaderCtx);
        context.connection.console.info(`[lsp] Successfully loaded ${params.name}@${params.version}`);
        // Re-validate all open documents
        for (const doc of context.documents.all()) {
          context.validationService.validateTextDocument(doc);
        }
        // Notify client that the project tree changed (refreshes Libraries panel)
        context.connection.sendNotification("modelscript/projectTreeChanged");
        context.connection.sendNotification("modelscript/status", {
          state: "ready",
          message: `Loaded ${params.name}@${params.version}`,
        });
      } catch (e) {
        context.connection.console.error(`[lsp] Failed to install ${params.name}@${params.version}: ${e}`);
        context.connection.sendNotification("modelscript/status", {
          state: "error",
          message: `Failed to load ${params.name}`,
        });
      }
    },
  );

  context.connection.onRequest("modelscript/getTraceabilityMatrix", (params: { uri: string }) => {
    try {
      const db = context.workspaceManager.unifiedWorkspace.toUnifiedPartial();
      return getTraceabilityMatrix(db); // Do not filter by uri to show workspace-level traceability
    } catch (e) {
      console.error("[traceability] Error:", e);
      return { sources: [], targets: [], links: [] };
    }
  });

  context.connection.onRequest("modelscript/resolveMarkdownVars", (): { values: Record<string, string> } => {
    return { values: {} };
  });

  context.connection.onRequest(
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

  context.connection.onRequest(
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

  context.connection.onRequest(
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

  context.connection.onRequest("modelscript/runVerification", async (params: { uri: string }) => {
    return runVerificationForUri(params.uri);
  });
}

// @ts-nocheck

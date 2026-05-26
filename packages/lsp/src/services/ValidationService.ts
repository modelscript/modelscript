/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-function, @typescript-eslint/prefer-for-of, @typescript-eslint/array-type, @typescript-eslint/no-non-null-assertion, no-empty */
// @ts-nocheck
import { Connection, Diagnostic } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DocumentManager } from "./DocumentManager";
import { WorkspaceManager } from "./WorkspaceManager";

export class ValidationService {
  constructor(
    private connection: Connection,
    private documentManager: DocumentManager,
    private workspaceManager: WorkspaceManager,
  ) {}

  public collectSyntaxErrors(rootNode: any, textDocument: TextDocument): Diagnostic[] {
    const t0 = performance.now();
    const diagnostics: Diagnostic[] = [];
    const cursor = rootNode.walk();
    let didDescend = true;

    while (didDescend) {
      if (performance.now() - t0 > 1000) {
        this.connection.console.warn(
          `[perf] collectSyntaxErrors aborted after ${(performance.now() - t0).toFixed(2)}ms (too many nodes)`,
        );
        break;
      }
      const node = cursor.currentNode;
      const hasErr = typeof node.hasError === "function" ? node.hasError() : node.hasError;

      if (hasErr) {
        const isMissing = typeof node.isMissing === "function" ? node.isMissing() : node.isMissing;
        if (isMissing || node.type === "ERROR") {
          const start = textDocument.positionAt(node.startIndex);
          const end = textDocument.positionAt(node.endIndex);
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: { start, end },
            message: isMissing ? `Missing syntax element` : `Syntax error`,
            source: "modelscript",
          });
        }
        if (cursor.gotoFirstChild()) {
          continue;
        }
      }

      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) {
          didDescend = false;
          break;
        }
      }
    }

    const totalMs = performance.now() - t0;
    if (totalMs > 100) {
      this.connection.console.warn(
        `[perf] collectSyntaxErrors took ${totalMs.toFixed(2)}ms for ${diagnostics.length} diagnostics`,
      );
    }
    return diagnostics;
  }

  public async flushValidation(uri: string): Promise<void> {
    const timer = activeValidationTimers.get(uri);
    if (timer) {
      clearTimeout(timer);
      activeValidationTimers.delete(uri);
      const doc = documents.get(uri);
      if (doc) await validateTextDocument(doc);
    }
    const pending = activeValidationPromises.get(uri);
    if (pending) {
      await pending;
    }
  }

  public async validateTextDocument(textDocument: TextDocument): Promise<void> {
    const diagnostics: Diagnostic[] = [];
    const text = textDocument.getText();

    // Handle Javascript/TypeScript sidecar files natively via mock entity
    if (textDocument.uri.endsWith(".js") || textDocument.uri.endsWith(".ts")) {
      const context = sharedContext;
      if (!context) return;
      const entity = {
        isClassInstance: true,
        jsSource: text,
        name: "",
        context,
        uri: textDocument.uri,
        instantiate() {},
      } as any;
      // Derive name from generic path (e.g. file:///.../Test.js -> Test)
      const filename = textDocument.uri.split("/").pop();
      if (filename) {
        entity.name = filename.replace(/\.[tj]s$/, "");
      }
      entity.instantiate(); // Regex parses and natively hydrates the parameters
      workspaceManager.workspaceInstances.set(textDocument.uri, [entity]);
      workspaceManager.documentInstances.set(textDocument.uri, [entity]);
      workspaceManager.documentContexts.set(textDocument.uri, context);
      this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
      this.connection.sendNotification("modelscript/projectTreeChanged");
      return;
    }

    // Handle STEP files
    if (textDocument.uri.match(/\.(step|stp|p21)$/i)) {
      const text = textDocument.getText();
      const buffer = new TextEncoder().encode(text);

      try {
        this.connection.console.info(`[step] Validating ${textDocument.uri} (${text.length} chars)`);
        this.connection.console.info(`[step] stepParserReady=${stepParserReady}, stepParser=${!!stepParser}`);

        // 1. Tree-sitter parsing for LSP features
        let astIndex;
        let tree;
        if (stepParserReady && stepParser) {
          tree = stepParser.parse(text);
          if (tree) {
            documentManager.documentTrees.set(textDocument.uri, { text, tree, classCache: new Map() });
            const indexer = new SymbolIndexer(stepIndexerHooks as any);
            astIndex = indexer.index(tree.rootNode);
            this.connection.console.info(`[step] AST index: ${astIndex.symbols.size} symbols`);
          }
        } else {
          this.connection.console.info(`[step] Tree-sitter STEP parser not available, using regex-only extraction`);
        }

        // 2. Structural indexing (Regex + OCCT) + AST index merge
        const stepIndex = await workspaceManager.stepWorkspaceIndex.parseStepFile(textDocument.uri, buffer, astIndex);
        this.connection.console.info(
          `[step] StepWorkspaceIndex: ${stepIndex.symbols.size} symbols, ${workspaceManager.stepWorkspaceIndex.getMeshes(textDocument.uri).length} meshes`,
        );
        for (const [id, entry] of stepIndex.symbols) {
          if (entry.ruleName === "step_product" || entry.ruleName === "step_shape") {
            this.connection.console.info(
              `[step]   ${entry.ruleName}: "${entry.name}" (${entry.startByte}-${entry.endByte})`,
            );
          }
        }

        // Invalidate the unified partial cache so cross-language resolvers pick up
        // the new STEP symbols immediately.
        const unifiedIndex = workspaceManager.unifiedWorkspace.toUnifiedPartial();
        this.connection.console.info(`[step] Unified index: ${unifiedIndex.symbols.size} symbols total`);
        if (workspaceManager.globalModelicaQueryEngine)
          workspaceManager.globalModelicaQueryEngine.updateIndex(unifiedIndex);
        if (workspaceManager.globalSysML2QueryEngine) {
          workspaceManager.globalSysML2QueryEngine.updateIndex(unifiedIndex);
          // Invalidate the SysML2 resolver cache so it sees the new STEP symbols
          const cachedResolver = (workspaceManager.globalSysML2QueryEngine as any).__resolverCache;
          if (cachedResolver) cachedResolver.updateIndex(unifiedIndex);
        }

        // Create/update STEP query engine + resolver + bridge
        // Always create a bridge, even without tree-sitter, so hover/completion
        // work on the structural (regex-derived) symbols.
        if (!workspaceManager.globalStepQueryEngine) {
          workspaceManager.globalStepQueryEngine = new QueryEngine(unifiedIndex, stepQueryHooks as any);
        } else {
          workspaceManager.globalStepQueryEngine.updateIndex(unifiedIndex);
        }

        const engine = workspaceManager.globalStepQueryEngine;
        let resolver = (engine as any).__resolverCache;
        if (!resolver) {
          resolver = new ScopeResolver(unifiedIndex, stepRefHooks as any, stepIndexerHooks as any);
          (engine as any).__resolverCache = resolver;
        } else {
          resolver.updateIndex(unifiedIndex);
        }

        const bridge = new LSPBridge(unifiedIndex, engine, resolver, new PositionIndex(text), textDocument.uri);
        documentLSPBridges.set(textDocument.uri, bridge);
        this.connection.console.info(`[step] LSPBridge created for ${textDocument.uri}`);

        const stepDiagnostics: Diagnostic[] = [];
        if (tree) {
          const collectErrors = (node: any) => {
            if (!node) return;
            if (typeof node.hasError === "function" ? !node.hasError() : node.hasError === false) return;

            if (node.isMissing || node.type === "ERROR") {
              const start = bridge["positions"].offsetToPosition(node.startIndex);
              const end = bridge["positions"].offsetToPosition(node.endIndex);
              stepDiagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: { start, end },
                message: node.isMissing ? `Missing syntax element` : `Syntax error`,
                source: "step",
              });
            }
            const children = node.children || [];
            for (let i = 0; i < children.length; i++) {
              collectErrors(children[i]);
            }
          };
          collectErrors(tree.rootNode);

          // Check for unresolved semantic references
          const unresolved = resolver.resolveAllReferences(textDocument.uri);
          for (const unres of unresolved) {
            const start = bridge["positions"].offsetToPosition(unres.startByte);
            const end = bridge["positions"].offsetToPosition(unres.endByte);
            stepDiagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: { start, end },
              message: unres.message,
              source: "step",
            });
          }
        }

        this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: stepDiagnostics });
        this.connection.sendNotification("modelscript/projectTreeChanged");

        // Trigger cross-file revalidation so SysML files referencing this STEP file
        // will resolve the newly available CAD entities.
        if (revalidationTimer) clearTimeout(revalidationTimer);
        revalidationTimer = setTimeout(() => {
          this.connection.console.info(`[step] Cross-file revalidation triggered`);
          for (const doc of documents.all()) {
            if (doc.uri !== textDocument.uri) {
              validateTextDocument(doc);
            }
          }
        }, 300);
      } catch (e: any) {
        this.connection.console.error(`[step] Error parsing ${textDocument.uri}: ${e.message}\n${e.stack}`);
      }
      return;
    }

    // Handle OWL2 files via the polyglot reasoner pipeline
    if (textDocument.uri.endsWith(".owl") && owl2ParserReady && owl2Parser) {
      try {
        const oldCached = documentManager.documentTrees.get(textDocument.uri);
        let tree: any;

        if (oldCached && oldCached.text !== text) {
          const edit = computeTreeEdit(oldCached.text, text);
          oldCached.tree.edit(edit as never);
          tree = owl2Parser.parse(text, oldCached.tree as never);
        } else if (oldCached) {
          tree = oldCached.tree;
        } else {
          tree = owl2Parser.parse(text);
        }

        if (!tree) {
          this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
          return;
        }

        // Store in documentManager.documentTrees
        documentManager.documentTrees.set(textDocument.uri, {
          text,
          tree,
          classCache: oldCached?.classCache ?? new Map(),
        });

        const textChanged = lastIndexedText.get(textDocument.uri) !== text;

        // Register/update in OWL2 workspace index
        if (textChanged) {
          let editRanges: Array<{ startByte: number; endByte: number }> | undefined;
          const lastText = lastIndexedText.get(textDocument.uri);
          if (lastText) {
            const edit = computeTreeEdit(lastText, text);
            editRanges = [{ startByte: edit.startIndex, endByte: edit.newEndIndex }];
          }

          if (workspaceManager.owl2WorkspaceIndex.has(textDocument.uri)) {
            workspaceManager.owl2WorkspaceIndex.markDirty(textDocument.uri, () => tree.rootNode, editRanges);
          } else {
            workspaceManager.owl2WorkspaceIndex.register(textDocument.uri, () => tree.rootNode);
          }

          workspaceManager.owl2WorkspaceIndex.getFileIndex(textDocument.uri);
          lastIndexedText.set(textDocument.uri, text);
        }

        const changedIds = workspaceManager.owl2WorkspaceIndex.takeGlobalChangedIds();
        const changedNames = workspaceManager.owl2WorkspaceIndex.takeGlobalChangedNames();

        const unifiedIndex = workspaceManager.unifiedWorkspace.toUnifiedPartial();

        if (changedNames && changedNames.size > 0) {
          if (revalidationTimer) clearTimeout(revalidationTimer);
          revalidationTimer = setTimeout(() => {
            for (const doc of documents.all()) {
              if (doc.uri !== textDocument.uri) {
                validateTextDocument(doc);
              }
            }
          }, 500);
        }

        if (workspaceManager.globalOWL2QueryEngine) {
          if (changedIds && typeof workspaceManager.globalOWL2QueryEngine.swapIndex === "function") {
            workspaceManager.globalOWL2QueryEngine.swapIndex(unifiedIndex, changedIds);
          } else {
            workspaceManager.globalOWL2QueryEngine.updateIndex(unifiedIndex);
          }
        } else {
          workspaceManager.globalOWL2QueryEngine = new QueryEngine(unifiedIndex, owl2QueryHooks as any);
        }
        const engine = workspaceManager.globalOWL2QueryEngine;

        let resolver = (engine as any).__resolverCache;
        if (!resolver) {
          resolver = new ScopeResolver(unifiedIndex, owl2RefHooks as any, owl2IndexerHooks as any);
          (engine as any).__resolverCache = resolver;
        } else {
          resolver.updateIndex(unifiedIndex);
        }

        const bridge = new LSPBridge(unifiedIndex, engine, resolver, new PositionIndex(text), textDocument.uri);
        documentLSPBridges.set(textDocument.uri, bridge);

        const owl2Diagnostics: Diagnostic[] = [];

        // Collect parse errors from the tree
        const collectErrors = (node: SyntaxNode | any) => {
          if (!node) return;
          if (typeof node.hasError === "function" ? !node.hasError() : node.hasError === false) return;
          if (node.type === "ERROR" || node.isMissing) {
            const start = bridge["positions"].offsetToPosition(node.startIndex);
            const end = bridge["positions"].offsetToPosition(node.endIndex);
            owl2Diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: { start, end },
              message: node.isMissing ? `Missing syntax element` : `Syntax error`,
              source: "owl2",
            });
          }
          const children = node.children || [];
          for (let i = 0; i < children.length; i++) {
            collectErrors(children[i]);
          }
        };
        collectErrors(tree.rootNode);

        const hasSyntaxErrors = owl2Diagnostics.length > 0;

        if (!hasSyntaxErrors) {
          // Run Polyglot declarative lints from query hooks
          const engineDiags = await (engine as any).runAllLintsAsync(textDocument.uri, async () => {
            await new Promise<void>((r) => setTimeout(r, 0));
            return false;
          });
          for (const d of engineDiags) {
            const start = bridge["positions"].offsetToPosition(d.startByte);
            const end = bridge["positions"].offsetToPosition(d.endByte);
            let severity: DiagnosticSeverity = DiagnosticSeverity.Warning;
            if (d.severity === "error") severity = DiagnosticSeverity.Error;
            if (d.severity === "info") severity = DiagnosticSeverity.Information;

            owl2Diagnostics.push({
              severity,
              range: { start, end },
              message: d.message,
              source: "owl2",
            });
          }

          // Collect unresolved references
          const unresolvedRefs = await (resolver as any).resolveAllReferencesAsync(textDocument.uri, async () => {
            await new Promise<void>((r) => setTimeout(r, 0));
            return false;
          });
          for (const r of unresolvedRefs) {
            const start = bridge["positions"].offsetToPosition(r.startByte);
            const end = bridge["positions"].offsetToPosition(r.endByte);
            let severity: DiagnosticSeverity = DiagnosticSeverity.Error;
            if (r.severity === "warning") severity = DiagnosticSeverity.Warning;
            if (r.severity === "info") severity = DiagnosticSeverity.Information;

            owl2Diagnostics.push({
              severity,
              range: { start, end },
              message: r.message,
              source: "owl2",
            });
          }

          // Run tableau reasoner check
          try {
            const store = workspaceManager.unifiedWorkspace.owl2Store;
            const reasoner = new TableauReasoner();
            await reasoner.init();
            reasoner.loadOntology(store.axioms);
            const consistency = reasoner.checkConsistency();

            if (!consistency.isConsistent) {
              const explanation = consistency.explanation || "Ontology inconsistency detected";

              let reported = false;
              if (consistency.conflictingAxioms) {
                for (const axiom of consistency.conflictingAxioms) {
                  let targetIri: string | null = null;
                  if (axiom.type === "SubClassOf") {
                    targetIri = axiom.subClassIri;
                  } else if (axiom.type === "DisjointClasses" && axiom.classIris && axiom.classIris.length > 0) {
                    for (const iri of axiom.classIris) {
                      if (findRangeForIri(iri, textDocument.uri)) {
                        targetIri = iri;
                        break;
                      }
                    }
                    if (!targetIri) targetIri = axiom.classIris[0];
                  } else if (axiom.type === "ClassAssertion") {
                    targetIri = axiom.individualIri;
                  } else if (axiom.type === "ObjectPropertyAssertion") {
                    targetIri = axiom.subjectIri;
                  } else if ((axiom as any).iri) {
                    targetIri = (axiom as any).iri;
                  }

                  if (targetIri) {
                    const range = findRangeForIri(targetIri, textDocument.uri);
                    if (range) {
                      owl2Diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range,
                        message: `Ontology inconsistency: ${explanation}`,
                        source: "owl2-reasoner",
                      });
                      reported = true;
                    }
                  }
                }
              }

              if (!reported) {
                owl2Diagnostics.push({
                  severity: DiagnosticSeverity.Error,
                  range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 10 },
                  },
                  message: `Ontology inconsistency: ${explanation}`,
                  source: "owl2-reasoner",
                });
              }
            }
          } catch (reasonerError: any) {
            this.connection.console.error(`[owl2-reasoner] Reasoner failed: ${reasonerError.message}`);
          }
        }

        this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: owl2Diagnostics });
        this.connection.sendNotification("modelscript/projectTreeChanged");
      } catch (e: any) {
        this.connection.console.error(`[owl2] Error parsing ${textDocument.uri}: ${e.message}\n${e.stack}`);
      }
      return;
    }

    // Handle SysML2 files via the polyglot SysML2 pipeline
    if (textDocument.uri.endsWith(".sysml") && sysml2ParserReady && sysml2Parser) {
      try {
        const oldCached = documentManager.documentTrees.get(textDocument.uri);
        let tree: any;

        if (oldCached && oldCached.text !== text) {
          const edit = computeTreeEdit(oldCached.text, text);
          oldCached.tree.edit(edit as never);
          tree = sysml2Parser.parse(text, oldCached.tree as never);
        } else if (oldCached) {
          tree = oldCached.tree;
        } else {
          tree = sysml2Parser.parse(text);
        }

        if (!tree) {
          this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
          return;
        }

        // Store in documentManager.documentTrees so verification and other LSP operations can access the tree/text
        documentManager.documentTrees.set(textDocument.uri, {
          text,
          tree,
          classCache: oldCached?.classCache ?? new Map(),
        });

        const textChanged = lastIndexedText.get(textDocument.uri) !== text;

        // Register/update in SysML2 workspace index
        if (textChanged) {
          let editRanges: Array<{ startByte: number; endByte: number }> | undefined;
          const lastText = lastIndexedText.get(textDocument.uri);
          if (lastText) {
            const edit = computeTreeEdit(lastText, text);
            editRanges = [{ startByte: edit.startIndex, endByte: edit.newEndIndex }];
          }

          if (workspaceManager.sysml2WorkspaceIndex.has(textDocument.uri)) {
            workspaceManager.sysml2WorkspaceIndex.markDirty(textDocument.uri, () => tree.rootNode, editRanges);
          } else {
            workspaceManager.sysml2WorkspaceIndex.register(textDocument.uri, () => tree.rootNode);
          }

          // Force index evaluation for active document AFTER it is registered/marked dirty
          // so that it actually triggers processing and populates the partial index.
          // Without this, toUnifiedPartial() skips the file (index stays null).
          workspaceManager.sysml2WorkspaceIndex.getFileIndex(textDocument.uri);
          lastIndexedText.set(textDocument.uri, text);
        }

        // Get ALL changed symbol IDs across the workspace since last check
        const changedIds = workspaceManager.sysml2WorkspaceIndex.takeGlobalChangedIds();
        const changedNames = workspaceManager.sysml2WorkspaceIndex.takeGlobalChangedNames();

        // Create or update query engine, resolver, and LSP bridge for the document
        const unifiedIndex = workspaceManager.unifiedWorkspace.toUnifiedPartial();

        if (changedNames && changedNames.size > 0) {
          if (revalidationTimer) clearTimeout(revalidationTimer);
          revalidationTimer = setTimeout(() => {
            for (const doc of documents.all()) {
              if (doc.uri !== textDocument.uri) {
                validateTextDocument(doc);
              }
            }
          }, 500);
        }

        if (workspaceManager.globalSysML2QueryEngine) {
          if (changedIds && typeof workspaceManager.globalSysML2QueryEngine.swapIndex === "function") {
            workspaceManager.globalSysML2QueryEngine.swapIndex(unifiedIndex, changedIds);
          } else {
            workspaceManager.globalSysML2QueryEngine.updateIndex(unifiedIndex);
          }
        } else {
          workspaceManager.globalSysML2QueryEngine = createSysML2QueryEngine(unifiedIndex) as any;
        }
        const engine = workspaceManager.globalSysML2QueryEngine;

        let resolver = (engine as any).__resolverCache;
        if (!resolver) {
          resolver = createSysML2ScopeResolver(unifiedIndex);
          (engine as any).__resolverCache = resolver;
        } else {
          resolver.updateIndex(unifiedIndex);
        }

        const bridge = createSysML2LSPBridge(unifiedIndex, engine, resolver, text, textDocument.uri);
        documentLSPBridges.set(textDocument.uri, bridge);

        // Collect parse errors from the tree
        const sysmlDiagnostics: Diagnostic[] = [];
        const collectErrors = (node: SyntaxNode | any) => {
          if (!node) return;
          if (typeof node.hasError === "function" ? !node.hasError() : node.hasError === false) return;
          if (node.type === "ERROR" || node.isMissing) {
            const start = bridge["positions"].offsetToPosition(node.startIndex);
            const end = bridge["positions"].offsetToPosition(node.endIndex);
            sysmlDiagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: { start, end },
              message: node.isMissing ? `Missing ${node.type}` : `Syntax error`,
              source: "sysml2",
            });
          }
          const children = node.children || [];
          for (let i = 0; i < children.length; i++) {
            collectErrors(children[i]);
          }
        };
        collectErrors(tree.rootNode);

        const hasSyntaxErrors = sysmlDiagnostics.length > 0;

        if (!hasSyntaxErrors) {
          // Run Polyglot declarative lints (e.g. multiplicity bounds, usage matching)
          const engineDiags = await (engine as any).runAllLintsAsync(textDocument.uri, async () => {
            await new Promise<void>((r) => setTimeout(r, 0));
            return false; // sysml2 side doesn't have isStale easily accessible here, but yielding prevents UI freeze
          });
          for (const d of engineDiags) {
            const start = bridge["positions"].offsetToPosition(d.startByte);
            const end = bridge["positions"].offsetToPosition(d.endByte);
            let severity: DiagnosticSeverity = DiagnosticSeverity.Warning;
            if (d.severity === "error") severity = DiagnosticSeverity.Error;
            if (d.severity === "info") severity = DiagnosticSeverity.Information;

            sysmlDiagnostics.push({
              severity,
              range: { start, end },
              message: d.message,
              source: "sysml2",
            });
          }

          // Collect unresolved references
          // Skip unresolved-reference diagnostics while the SysML2 standard library
          // is still loading — primitive types like Real/Integer/Boolean/String live
          // in the stdlib and produce false positives until it's indexed.
          const unresolvedRefs = sysml2StdlibReady
            ? await (resolver as any).resolveAllReferencesAsync(textDocument.uri, async () => {
                await new Promise<void>((r) => setTimeout(r, 0));
                return false;
              })
            : [];
          for (const r of unresolvedRefs) {
            const start = bridge["positions"].offsetToPosition(r.startByte);
            const end = bridge["positions"].offsetToPosition(r.endByte);
            let severity: DiagnosticSeverity = DiagnosticSeverity.Error;
            if (r.severity === "warning") severity = DiagnosticSeverity.Warning;
            if (r.severity === "info") severity = DiagnosticSeverity.Information;

            sysmlDiagnostics.push({
              severity,
              range: { start, end },
              message: r.message,
              source: "sysml2",
            });
          }
        } else {
          // Retain existing semantic diagnostics if the AST is broken to prevent flashing
          const cachedSemantic = lastSemanticDiagnostics.get(textDocument.uri) || [];
          sysmlDiagnostics.push(...cachedSemantic);
        }

        const vDiags = verificationDiagnosticsByUri.get(textDocument.uri);
        if (vDiags) {
          sysmlDiagnostics.push(...vDiags);
        }

        this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: sysmlDiagnostics });

        // Auto-trigger verification if this document contains verification/analysis cases.
        // This makes the "compiler actively fails the build" behavior described in the paper
        // happen automatically without requiring the user to run a command.
        if (workspaceManager.unifiedWorkspace) {
          try {
            const udb = workspaceManager.unifiedWorkspace.toUnifiedPartial();
            // Use symbolsByResource for O(1) lookup instead of scanning all symbols
            const docSymbolIds = udb.symbolsByResource?.get(textDocument.uri);
            let hasVerifyCases = false;
            if (docSymbolIds) {
              for (const id of docSymbolIds) {
                const s = udb.symbols.get(id);
                if (
                  s &&
                  (s.ruleName === "VerifyRequirementUsage" ||
                    s.ruleName === "AnalysisCaseDefinition" ||
                    s.ruleName === "AnalysisCaseUsage" ||
                    s.ruleName === "VerificationCaseDefinition" ||
                    s.ruleName === "VerificationCaseUsage")
                ) {
                  hasVerifyCases = true;
                  break;
                }
              }
            }
            if (hasVerifyCases) {
              if (verificationTimer) clearTimeout(verificationTimer);
              const verifyUri = textDocument.uri;
              verificationTimer = setTimeout(() => {
                this.connection.console.log(`[auto-verify] Triggering verification for ${verifyUri}`);
                runVerificationForUri(verifyUri).catch(() => {
                  // Ignore — errors surface as diagnostics
                });
              }, 1000);
            }
          } catch {
            // Ignore — auto-verify is best-effort
          }
        }
      } catch (e: any) {
        this.connection.console.error(`[sysml2] Error processing ${textDocument.uri}: ${e.message}`);
        this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
      }
      return;
    }

    if (parserReady && parser) {
      this.connection.console.info(`[validate] Entering Modelica parsing`);
      // Polyglot-only pipeline: tree-sitter parse → SymbolIndex → QueryEngine → diagnostics
      const context = sharedContext;
      if (!context) {
        this.connection.console.info(`[validate] sharedContext is null!`);
        return;
      }

      // Parse with tree-sitter (incremental when possible)
      const oldCached = documentManager.documentTrees.get(textDocument.uri);

      let tree: any;
      let editRanges: Array<{ startByte: number; endByte: number }> | undefined;
      if (oldCached && oldCached.text !== text) {
        const edit = computeTreeEdit(oldCached.text, text);
        oldCached.tree.edit(edit as never);
        tree = context.parse(".mo", text, oldCached.tree as never);
        // Capture edit byte ranges for incremental indexing
        editRanges = [{ startByte: edit.startIndex, endByte: edit.newEndIndex }];
      } else if (oldCached) {
        tree = oldCached.tree;
      } else {
        tree = context.parse(".mo", text);
      }
      documentManager.documentTrees.set(textDocument.uri, {
        text,
        tree,
        classCache: oldCached?.classCache ?? new Map(),
      });

      this.connection.console.info(`[validate] tree parsed`);

      // Collect syntax errors from the tree using the shared pure function.
      // These were likely already sent instantly by the onDidChangeContent handler,
      // but we recompute them here to ensure consistency with the current tree.
      const syntaxDiags = collectSyntaxErrors(tree.rootNode, textDocument);
      diagnostics.push(...syntaxDiags);

      this.connection.console.info(
        `[validate] ${textDocument.uri}: text=${text.length}B, syntaxErrors=${diagnostics.length}, hasError=${typeof tree.rootNode.hasError === "function" ? tree.rootNode.hasError() : tree.rootNode.hasError}`,
      );

      // Send syntax diagnostics immediately so the user gets instant feedback
      // even if the semantic pipeline takes a long time.
      const cachedSemantic = lastSemanticDiagnostics.get(textDocument.uri) || [];
      const allDiags = [...diagnostics, ...cachedSemantic];
      if (allDiags.length > 1000) allDiags.length = 1000;
      this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: allDiags });

      // Always run the semantic pipeline with revision tracking — syntax errors
      // were already sent instantly by the onDidChangeContent handler, so this
      // pass focuses on producing the merged (syntax + semantic) diagnostic set.
      // Passing the revision allows the pipeline to bail out early if a new edit
      // arrives while it's running (staleness check at each expensive step).
      const revisionAtStart = documentRevisions.get(textDocument.uri) ?? 0;

      this.connection.console.info(`[validate] starting runSemanticPipeline`);
      const promise = runSemanticPipeline(
        textDocument.uri,
        text,
        tree,
        editRanges,
        diagnostics,
        revisionAtStart,
        context,
      ).catch((e) => {
        this.connection.console.error(
          `[runSemanticPipeline] Failed for ${textDocument.uri}: ${e instanceof Error ? e.message + "\\n" + e.stack : String(e)}`,
        );
      });
      activeValidationPromises.set(textDocument.uri, promise);
      promise.finally(() => {
        if (activeValidationPromises.get(textDocument.uri) === promise) {
          activeValidationPromises.delete(textDocument.uri);
        }
      });
    } else {
      // Fallback: basic regex validation when tree-sitter is not available
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
      this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
    }
  }

  public async runSemanticPipeline(
    uri: string,
    text: string,
    tree: any,
    editRanges: Array<{ startByte: number; endByte: number }> | undefined,
    baseDiagnostics: Diagnostic[],
    revisionAtStart: number | null,
    context: any,
  ): Promise<void> {
    const newSemanticDiagnostics: Diagnostic[] = [];

    // If the tree has syntax errors, skip the semantic pipeline to preserve the cache
    // and prevent massive index invalidation cascades when the parser fails to recover.
    const hasError = typeof tree.rootNode.hasError === "function" ? tree.rootNode.hasError() : tree.rootNode.hasError;
    if (hasError) {
      this.connection.console.info(
        `[pipeline] Syntax errors present in ${uri}, skipping semantic pipeline to preserve cache and latency`,
      );
      return;
    }

    const startVersion = workspaceManager.globalWorkspaceIndex.version;
    /** Returns true if a newer edit has arrived, meaning we should abandon this pipeline run. */
    const isStale = () => {
      if (revisionAtStart !== null && (documentRevisions.get(uri) ?? 0) !== revisionAtStart) return true;
      return false;
    };
    /** Yields to the event loop so new edits can be processed. */
    const yieldToEventLoop = () => new Promise<void>((r) => setTimeout(r, 0));
    /** Yields and checks if pipeline is stale */
    const yieldAndCheckStale = async () => {
      await yieldToEventLoop();
      return isStale();
    };

    try {
      const t0 = performance.now();
      this.connection.console.info(`[perf] Starting runSemanticPipeline for ${uri}`);
      const effectiveUri = uri.startsWith("modelscript-lib://global")
        ? "file://" + uri.substring("modelscript-lib://global".length)
        : uri;

      // ── Step 1: Re-index ─────────────────────────────────────────────────
      // Only update the workspace index if the text actually changed.
      // Prevents infinite revalidation loops from revalidation calls.
      const textChanged = lastIndexedText.get(effectiveUri) !== text;
      let changedIds: Set<number> | null = null;
      let changedNames: Set<string> | null = null;
      let unifiedIndex: any = null;

      if (textChanged) {
        const step0t = performance.now();
        if (!editRanges) {
          const lastText = lastIndexedText.get(effectiveUri);
          if (lastText) {
            const edit = computeTreeEdit(lastText, text);
            editRanges = [{ startByte: edit.startIndex, endByte: edit.newEndIndex }];
          }
        }

        if (workspaceManager.globalWorkspaceIndex.has(effectiveUri)) {
          workspaceManager.globalWorkspaceIndex.markDirty(effectiveUri, () => tree.rootNode, editRanges);
        } else {
          workspaceManager.globalWorkspaceIndex.register(effectiveUri, () => tree.rootNode);
        }
        const step0_1t = performance.now();
        workspaceManager.globalWorkspaceIndex.getFileIndex(effectiveUri);
        const step0_2t = performance.now();
        lastIndexedText.set(effectiveUri, text);
        changedIds = workspaceManager.globalWorkspaceIndex.takeGlobalChangedIds();
        changedNames = workspaceManager.globalWorkspaceIndex.takeGlobalChangedNames();
        this.connection.console.info(
          `[perf] Step 1.0 (markDirty): ${(step0_1t - step0t).toFixed(2)}ms, (getFileIndex): ${(step0_2t - step0_1t).toFixed(2)}ms`,
        );
      }

      if (isStale()) return;

      // We ALWAYS need unifiedIndex for downstream steps (bridge, linting, etc.)
      // It's very fast if there are no changes.
      const step0_3t = performance.now();
      unifiedIndex = workspaceManager.unifiedWorkspace.toUnifiedPartial();
      const step0_4t = performance.now();
      const cstTreeWrapper = getSharedCstTreeWrapper();
      this.connection.console.info(`[perf] Step 1.0 (toUnifiedPartial): ${(step0_4t - step0_3t).toFixed(2)}ms`);

      if (textChanged) {
        // ── Step 2: Unified index merge + QueryEngine update ─────────────────
        let step1T = performance.now();
        this.connection.console.info(
          `[perf] Step 1.1 (toUnifiedPartial): ${(performance.now() - step1T).toFixed(2)}ms`,
        );

        if (changedNames && changedNames.size > 0) {
          if (revalidationTimer) clearTimeout(revalidationTimer);
          revalidationTimer = setTimeout(() => {
            for (const doc of documents.all()) {
              const effectiveDocUri = doc.uri.startsWith("modelscript-lib://global")
                ? "file://" + doc.uri.substring("modelscript-lib://global".length)
                : doc.uri;
              if (effectiveDocUri !== effectiveUri) {
                validateTextDocument(doc);
              }
            }
          }, 1000);
        }

        step1T = performance.now();

        if (workspaceManager.globalModelicaQueryEngine) {
          injectPredefinedTypes(unifiedIndex);
          this.connection.console.info(
            `[perf] Step 1.2 (injectPredefinedTypes): ${(performance.now() - step1T).toFixed(2)}ms`,
          );
          step1T = performance.now();
          if (changedIds && typeof workspaceManager.globalModelicaQueryEngine.swapIndex === "function") {
            workspaceManager.globalModelicaQueryEngine.swapIndex(unifiedIndex, changedIds);
            this.connection.console.info(`[perf] Step 1.3 (swapIndex): ${(performance.now() - step1T).toFixed(2)}ms`);
          } else {
            workspaceManager.globalModelicaQueryEngine.updateIndex(unifiedIndex);
            this.connection.console.info(`[perf] Step 1.3 (updateIndex): ${(performance.now() - step1T).toFixed(2)}ms`);
          }
          if (typeof workspaceManager.globalModelicaQueryEngine.updateTree === "function") {
            workspaceManager.globalModelicaQueryEngine.updateTree(cstTreeWrapper);
          }
          // Invalidate wrapper caches for changed symbols so user document
          // wrappers get fresh data while MSL library wrappers stay warm.
          if (changedIds && typeof invalidateWrapperCache === "function") {
            try {
              invalidateWrapperCache(workspaceManager.globalModelicaQueryEngine.toQueryDB(), changedIds);
            } catch {
              // Ignore — invalidation is best-effort
            }
          }
        } else {
          workspaceManager.globalModelicaQueryEngine = createModelicaQueryEngine(unifiedIndex, cstTreeWrapper) as any;
        }
      } else {
        if (!workspaceManager.globalModelicaQueryEngine) {
          workspaceManager.globalModelicaQueryEngine = createModelicaQueryEngine(unifiedIndex, cstTreeWrapper) as any;
        }
      }
      this.connection.console.info(`[perf] Step 1 (Index): ${(performance.now() - t0).toFixed(2)}ms`);
      context.setQueryEngine(workspaceManager.globalModelicaQueryEngine);
      context.setWorkspaceIndex(workspaceManager.globalWorkspaceIndex);
      const engine = workspaceManager.globalModelicaQueryEngine;

      let resolver = (engine as any).__resolverCache;
      if (!resolver) {
        resolver = createModelicaScopeResolver(unifiedIndex);
        (engine as any).__resolverCache = resolver;
      } else if (textChanged) {
        resolver.updateIndex(unifiedIndex);
      }

      const currentDoc = documents.get(uri);
      const currentText = currentDoc ? currentDoc.getText() : text;
      const bridge = createModelicaLSPBridge(unifiedIndex, engine, resolver, currentText, uri);
      documentLSPBridges.set(uri, bridge);
      this.connection.console.info(`[perf] Step 2 (Engine Update): ${(performance.now() - t0).toFixed(2)}ms`);

      // Yield before expensive linting
      await yieldToEventLoop();
      if (isStale()) return;

      // ── Step 2.5: Preflight cache hydration ──────────────────────────────
      // Before running synchronous queries, asynchronously hydrate memos for
      // the symbols in this document from the cache store (IndexedDB / federated).
      // This ensures evicted dependency memos are available for the synchronous
      // fetch() calls inside linting and reference resolution.
      const resourceSymbolIds = unifiedIndex.symbolsByResource?.get(effectiveUri);
      const docSymbolCount = resourceSymbolIds ? resourceSymbolIds.length : 0;
      const isWorkspaceFile = !!documents.get(uri);

      // We skip preflight for active workspace files because their memos are
      // already hot in memory (or actively re-evaluated efficiently).
      // Preflighting massive files triggers tens of thousands of IndexedDB reads
      // on every keystroke, which can take 15+ seconds and destroy responsiveness.
      if (
        engine &&
        resourceSymbolIds &&
        resourceSymbolIds.length > 0 &&
        engine.preflight &&
        !isWorkspaceFile &&
        docSymbolCount < 2000
      ) {
        try {
          await engine.preflight(resourceSymbolIds, ["resolve", "members", "type_check"]);
        } catch {
          // Best-effort — don't block validation if preflight fails
        }
      }
      this.connection.console.info(`[perf] Step 2.5 (Preflight): ${(performance.now() - t0).toFixed(2)}ms`);

      // ── Step 3: Run lints ────────────────────────────────────────────────
      // Skip for library files with >1000 symbols to avoid O(n²) on MSL.
      // User-authored files always get full diagnostics regardless of size.
      // A file is a "workspace file" if it's tracked by the TextDocuments manager
      // (i.e., currently open in the editor). Library files loaded via loadMSL
      // or background indexing are not tracked by documents.
      const hasSyntaxErrors = baseDiagnostics.length > 0;
      const skipHeavyLints = true; // Temporarily disable tier-2 validations

      if (hasSyntaxErrors) {
        // Retain existing semantic diagnostics if the AST is broken to prevent flashing
        const cachedSemantic = lastSemanticDiagnostics.get(uri) || [];
        newSemanticDiagnostics.push(...cachedSemantic);
      }

      if (!skipHeavyLints) {
        const engineDiags = await (engine as any).runAllLintsAsync(uri, yieldAndCheckStale);
        if (isStale()) return;

        for (const d of engineDiags) {
          const start = (bridge as any).positions.offsetToPosition(d.startByte);
          const end = (bridge as any).positions.offsetToPosition(d.endByte);
          let severity: DiagnosticSeverity = DiagnosticSeverity.Warning;
          if (d.severity === "error") severity = DiagnosticSeverity.Error;
          if (d.severity === "info") severity = DiagnosticSeverity.Information;
          newSemanticDiagnostics.push({ severity, range: { start, end }, message: d.message, source: "modelscript" });
        }
      }
      this.connection.console.info(`[perf] Step 3 (Lints): ${(performance.now() - t0).toFixed(2)}ms`);

      // Yield before expensive reference resolution
      await yieldToEventLoop();
      if (isStale()) return;

      // ── Step 4: Resolve references ───────────────────────────────────────
      if (!skipHeavyLints) {
        const unresolvedRefs = mslStdlibReady
          ? await (resolver as any).resolveAllReferencesAsync(uri, yieldAndCheckStale)
          : [];
        if (isStale()) return;

        let dirty = false;
        for (const r of unresolvedRefs) {
          if (r.fqn) {
            const uriToFix = (workspaceManager.globalWorkspaceIndex as any).getFileUriForFQN?.(r.fqn);
            if (uriToFix && !workspaceManager.globalWorkspaceIndex.has(uriToFix)) {
              workspaceManager.globalWorkspaceIndex.getFileIndex(uriToFix);
              dirty = true;
              continue;
            }
          }
          const start = (bridge as any).positions.offsetToPosition(r.startByte);
          const end = (bridge as any).positions.offsetToPosition(r.endByte);
          let severity: DiagnosticSeverity = DiagnosticSeverity.Error;
          if (r.severity === "warning") severity = DiagnosticSeverity.Warning;
          if (r.severity === "info") severity = DiagnosticSeverity.Information;
          newSemanticDiagnostics.push({ severity, range: { start, end }, message: r.message, source: "modelscript" });
        }
        if (dirty) {
          unifiedIndex = workspaceManager.unifiedWorkspace.toUnifiedPartial();
          injectPredefinedTypes(unifiedIndex);
          engine!.updateIndex(unifiedIndex);
          resolver.updateIndex(unifiedIndex);
        }
      }
      this.connection.console.info(`[perf] Step 4 (References): ${(performance.now() - t0).toFixed(2)}ms`);

      // ── Step 5: Create ModelicaClassInstance wrappers ──────────────────
      const db = engine!.toQueryDB();
      const thisDocInstances: ModelicaClassInstance[] = [];
      const normUri = (u: string) => (u.startsWith("file://") ? u.substring(7) : u);
      const matchUri = normUri(effectiveUri);

      const symbolsToCheck = resourceSymbolIds
        ? (resourceSymbolIds.map((id: any) => [id, unifiedIndex.symbols.get(id)]) as Iterable<[any, any]>)
        : unifiedIndex.symbols;

      for (const [id, entry] of symbolsToCheck) {
        if (!entry || !entry.resourceId || normUri(entry.resourceId) !== matchUri) continue;
        if (entry.kind !== "Class") continue;
        if (entry.parentId !== null) {
          const parentEntry = unifiedIndex.symbols.get(entry.parentId);
          if (parentEntry && parentEntry.resourceId && normUri(parentEntry.resourceId) === matchUri) continue;
        }
        const wrapper = new ModelicaClassInstance(id, db) as unknown as ModelicaClassInstance;
        thisDocInstances.push(wrapper);
      }
      workspaceManager.workspaceInstances.set(uri, thisDocInstances);
      workspaceManager.documentInstances.set(uri, thisDocInstances);
      workspaceManager.documentContexts.set(uri, context);
      this.connection.console.info(`[perf] Step 5 (Wrappers): ${(performance.now() - t0).toFixed(2)}ms`);

      // Final stale check
      if (isStale()) return;

      lastSemanticDiagnostics.set(uri, newSemanticDiagnostics);
      const diagnostics = [...baseDiagnostics, ...newSemanticDiagnostics];
      if (diagnostics.length > 1000) diagnostics.length = 1000;

      this.connection.sendDiagnostics({ uri, diagnostics });
      sendProjectTreeChanged();
      this.connection.console.info(
        `[perf] Finished runSemanticPipeline for ${uri} in ${(performance.now() - t0).toFixed(2)}ms`,
      );
    } catch (e: any) {
      this.connection.console.error(`[modelica] Error in semantic pipeline for ${uri}: ${e.message}\n${e.stack}`);
      if (!isStale()) {
        const diagnostics = [...baseDiagnostics, ...newSemanticDiagnostics];
        if (diagnostics.length > 1000) diagnostics.length = 1000;
        this.connection.sendDiagnostics({ uri, diagnostics });
      }
    }
  }

  async runVerificationForUri(uri: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const textDocument = documents.get(uri);
      if (!textDocument) throw new Error("Document not found");

      if (activeVerification) activeVerification.abort();
      activeVerification = new AbortController();
      const signal = activeVerification.signal;

      const db = workspaceManager.unifiedWorkspace.toUnifiedPartial();
      const fileNodes = Array.from(db.symbols.values()).filter(
        (s) =>
          s.resourceId === textDocument.uri &&
          (s.ruleName === "VerifyRequirementUsage" ||
            s.ruleName === "AnalysisCaseDefinition" ||
            s.ruleName === "AnalysisCaseUsage" ||
            s.ruleName === "VerificationCaseDefinition" ||
            s.ruleName === "VerificationCaseUsage"),
      );

      if (fileNodes.length === 0) return { ok: true };

      const verifyCstTreeWrapper = {
        getText(startByte: number, endByte: number, entry?: any): string | null {
          if (!entry || !entry.resourceId) return null;
          const entryUri = entry.resourceId;
          const docTree = documentManager.documentTrees.get(entryUri);
          if (docTree && docTree.text) return docTree.text.substring(startByte, endByte);

          let lazyCache = documentManager.lazyLibTrees.get(entryUri);
          if (!lazyCache && sharedContext) {
            try {
              const fsPath = entryUri.startsWith("file://") ? entryUri.substring(7) : entryUri;
              const text = sharedContext.fs.read(fsPath);
              if (text) {
                const tree = sharedContext.parse(entryUri.endsWith(".sysml") ? ".sysml" : ".mo", text);
                lazyCache = { tree, text };
                documentManager.lazyLibTrees.set(entryUri, lazyCache);
              }
            } catch (e) {}
          }
          if (lazyCache) return lazyCache.text.substring(startByte, endByte);

          const doc = documents.get(entryUri);
          if (doc) return doc.getText().substring(startByte, endByte);
          return null;
        },
        getNode(startByte: number, endByte: number, entry?: any): any | null {
          if (!entry || !entry.resourceId) return null;
          const entryUri = entry.resourceId;
          const docTree = documentManager.documentTrees.get(entryUri);
          if (docTree && docTree.tree) {
            return docTree.tree.rootNode.descendantForIndex(startByte, Math.max(startByte, endByte - 1));
          }

          let lazyCache = documentManager.lazyLibTrees.get(entryUri);
          if (!lazyCache && sharedContext) {
            try {
              const fsPath = entryUri.startsWith("file://") ? entryUri.substring(7) : entryUri;
              const text = sharedContext.fs.read(fsPath);
              if (text) {
                const tree = sharedContext.parse(entryUri.endsWith(".sysml") ? ".sysml" : ".mo", text);
                lazyCache = { tree, text };
                documentManager.lazyLibTrees.set(entryUri, lazyCache);
              }
            } catch (e) {}
          }
          if (lazyCache) {
            return lazyCache.tree.rootNode.descendantForIndex(startByte, Math.max(startByte, endByte - 1));
          }

          const doc = documents.get(entryUri);
          if (doc) {
            const text = doc.getText();
            let tree: any;
            if (entryUri.endsWith(".sysml") && sysml2Parser) {
              tree = sysml2Parser.parse(text);
            } else if (sharedContext) {
              tree = sharedContext.parse(".mo", text);
            }
            if (tree) {
              documentManager.documentTrees.set(entryUri, { text, tree, classCache: new Map() });
              return tree.rootNode.descendantForIndex(startByte, Math.max(startByte, endByte - 1));
            }
          }
          return null;
        },
      };

      const sysmlEngine = createSysML2QueryEngine(db, verifyCstTreeWrapper);
      const sysmlDB = sysmlEngine.toQueryDB();
      const newDiagnostics: Diagnostic[] = [];
      const allResults: any[] = [];

      for (const verifyUsage of fileNodes) {
        if (signal.aborted) return { ok: false };

        const topo = sysmlDB.query("extractTopology", verifyUsage.id) as any;
        if (!topo || topo.rootIds.length === 0) continue;

        const rootNode = topo.nodes.get(topo.rootIds[0]);
        if (!rootNode?.targetClassId) continue;

        let simTargetId = rootNode.targetClassId;
        const targetEntry = db.symbols.get(rootNode.targetClassId);

        if (targetEntry) {
          for (const entry of db.symbols.values()) {
            const text = sysmlDB.cstText(entry.startByte, entry.endByte, entry);
            if (
              text &&
              (text.includes(`implements="${targetEntry.name}"`) || text.includes(`::${targetEntry.name}"`))
            ) {
              simTargetId = entry.id;
              break;
            }
          }
        }

        const finalEntry = db.symbols.get(simTargetId);
        let targetEngine = undefined;
        if (finalEntry && finalEntry.resourceId) {
          targetEngine = finalEntry.resourceId.endsWith(".sysml")
            ? workspaceManager.globalSysML2QueryEngine
            : workspaceManager.globalModelicaQueryEngine;
          if (!targetEngine && finalEntry.resourceId.endsWith(".mo")) {
            targetEngine = createModelicaQueryEngine(db, verifyCstTreeWrapper);
          }
        }

        const targetDB = targetEngine
          ? (targetEngine as any).toQueryDB()
          : (workspaceManager.unifiedWorkspace as any).engine?.toQueryDB() || sysmlDB;
        const targetModel = new ModelicaClassInstance(simTargetId, targetDB) as any;
        targetModel.instantiate();

        const context = sharedContext;
        if (!context) return { ok: false, error: "Context not initialized" };
        const arena = flattenArenaFromInstance(targetModel, context);

        const arenaSimResult = simulateArena(arena, {
          startTime: 0,
          stopTime: 10,
          step: 0.1,
        });

        if (signal.aborted) return { ok: false };

        const simParameters: { name: string; value: number }[] = [];
        const paramInfo = getArenaParameterInfo(arena);
        for (const p of paramInfo) {
          simParameters.push({ name: p.name, value: p.defaultValue });
        }

        const simResult = {
          t: arenaSimResult.t,
          states: arenaSimResult.states,
          y: arenaSimResult.y,
          parameters: simParameters,
        };

        const runner = new VerificationRunner(sysmlDB, topo.variableMap);
        const vResults = runner.verifyCase(verifyUsage.id, simResult);
        allResults.push(...vResults);

        const bridge = documentLSPBridges.get(uri);
        if (bridge) {
          const diags = emitVerificationDiagnostics(vResults, sysmlDB, uri, bridge["positions"]);
          newDiagnostics.push(...diags);
        }
      }

      if (signal.aborted) return { ok: false };

      verificationDiagnosticsByUri.set(uri, newDiagnostics);
      verificationResultsByUri.set(uri, allResults);

      validateTextDocument(textDocument);
      return { ok: true };
    } catch (e: any) {
      this.connection.console.error(`[sysml2-verifier] Error: ${e.message}\n${e.stack}`);

      const crashDiag: Diagnostic = {
        severity: DiagnosticSeverity.Error,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        message: `Verification CRASHED: ${e.message}`,
        source: "sysml2-verifier",
      };
      verificationDiagnosticsByUri.set(uri, [crashDiag]);
      const doc = documents.get(uri);
      if (doc) validateTextDocument(doc);

      return { ok: false };
    }
  }
}

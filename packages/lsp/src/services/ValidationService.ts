/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-function, @typescript-eslint/prefer-for-of, @typescript-eslint/array-type, @typescript-eslint/no-non-null-assertion, no-empty */
// ts-check
import { Connection, Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DocumentManager } from "./DocumentManager";
import { ParserService } from "./ParserService";
import { WorkspaceManager } from "./WorkspaceManager";

import {
  LSPBridge,
  PositionIndex,
  QueryEngine,
  ScopeResolver,
  SymbolIndexer,
  VerificationRunner,
} from "@modelscript/compiler";
import { simulateArena } from "@modelscript/compiler/simulator";
import { createModelicaLSPBridge, createModelicaScopeResolver } from "@modelscript/modelica/factory";
import { ModelicaClassInstance } from "@modelscript/modelica/semantic-model";
import { TableauReasoner } from "@modelscript/reasoner";
import { createSysML2LSPBridge, createSysML2ScopeResolver } from "@modelscript/sysml2/factory";
import { Node as SyntaxNode } from "web-tree-sitter";
import { getArenaParameterInfo } from "../utils/arenaUtils";
import { computeTreeEdit } from "../utils/astUtils";
import { parseStepReferences, STEP_SCHEMA } from "../utils/stepUtils";
import { ReasonerService } from "./ReasonerService";

export class ValidationService {
  // Instance state (previously module-level variables in browserServerMain.ts)
  public lastSemanticDiagnostics = new Map<string, Diagnostic[]>();
  public lastIndexedText = new Map<string, string>();
  public documentLSPBridges = new Map<string, LSPBridge>();
  public activeValidationPromises = new Map<string, Promise<void>>();
  public documentRevisions = new Map<string, number>();
  public activeValidationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  public revalidationTimer: ReturnType<typeof setTimeout> | null = null;
  public declaredDependencies: Array<{ name: string; version: string }> = [];
  public loadedDependencies = new Set<string>();

  public verificationDiagnosticsByUri = new Map<string, Diagnostic[]>();
  public verificationResultsByUri = new Map<string, any[]>();

  get dependenciesReady(): boolean {
    return this.declaredDependencies.every((dep) => this.loadedDependencies.has(`${dep.name}@${dep.version}`));
  }

  markDependencyLoaded(name: string, version: string): void {
    this.loadedDependencies.add(`${name}@${version}`);
  }

  /**
   * Per-document viewport byte ranges, updated by `modelscript/visibleRanges` notifications.
   * When set, linting and reference resolution prioritize symbols within this range.
   */
  public documentViewports = new Map<string, { startByte: number; endByte: number }>();

  public reasonerService: ReasonerService;

  constructor(
    private connection: Connection,
    private documentManager: DocumentManager,
    private workspaceManager: WorkspaceManager,
    public parserService: ParserService,
  ) {
    this.reasonerService = new ReasonerService(connection, workspaceManager);
  }

  public collectSyntaxErrors(rootNode: any, textDocument: TextDocument): Diagnostic[] {
    const t0 = performance.now();
    const diagnostics: Diagnostic[] = [];
    const cursor = rootNode.walk();
    let didDescend = true;

    while (didDescend) {
      if (performance.now() - t0 > 1000) {
        this.connection.console.warn(
          `[perf] this.collectSyntaxErrors aborted after ${(performance.now() - t0).toFixed(2)}ms (too many nodes)`,
        );
        break;
      }
      const node = cursor.currentNode;
      const hasErr = typeof node.hasError === "function" ? node.hasError() : node.hasError;
      const isMissing = typeof node.isMissing === "function" ? node.isMissing() : node.isMissing;

      let shouldReport = false;
      let start = textDocument.positionAt(node.startIndex);
      let end = textDocument.positionAt(node.endIndex);

      if (isMissing) {
        shouldReport = true;
        if (start.line === end.line && start.character === end.character) {
          if (node.previousSibling) {
            start = textDocument.positionAt(node.previousSibling.startIndex);
            end = textDocument.positionAt(node.previousSibling.endIndex);
          } else {
            end = { line: start.line, character: start.character + 1 };
          }
        }
      } else if (node.type === "ERROR") {
        if (node.childCount === 0) shouldReport = true;
      } else if (!hasErr && node.childCount === 0 && node.parent?.type === "ERROR") {
        shouldReport = true;
      }

      if (shouldReport) {
        if (start.line !== end.line || start.character !== end.character) {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: { start, end },
            message: isMissing ? `Missing syntax element` : `Syntax error`,
            source: "modelscript",
          });
        }
      }

      if (hasErr || node.type === "ERROR") {
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
        `[perf] this.collectSyntaxErrors took ${totalMs.toFixed(2)}ms for ${diagnostics.length} diagnostics`,
      );
    }
    return diagnostics;
  }

  public async flushValidation(uri: string): Promise<void> {
    const timer = this.activeValidationTimers.get(uri);
    if (timer) {
      clearTimeout(timer);
      this.activeValidationTimers.delete(uri);
      const doc = this.documentManager.documents.get(uri);
      if (doc) await this.validateTextDocument(doc);
    }
    const pending = this.activeValidationPromises.get(uri);
    if (pending) {
      await pending;
    }
  }

  public async validateTextDocument(textDocument: TextDocument): Promise<void> {
    const diagnostics: Diagnostic[] = [];
    const text = textDocument.getText();

    // Handle Javascript/TypeScript sidecar files natively via mock entity
    if (textDocument.uri.endsWith(".js") || textDocument.uri.endsWith(".ts")) {
      const context = this.parserService.sharedContext;
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
      this.workspaceManager.workspaceInstances.set(textDocument.uri, [entity]);
      this.workspaceManager.documentInstances.set(textDocument.uri, [entity]);
      this.workspaceManager.documentContexts.set(textDocument.uri, context);
      this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
      this.connection.sendNotification("modelscript/projectTreeChanged");
      return;
    }

    // Handle STEP files
    const isStep = textDocument.languageId === "step" || /\.(step|stp|p21)$/i.test(textDocument.uri);
    if (isStep) {
      const text = textDocument.getText();
      const buffer = new TextEncoder().encode(text);

      const stepDiagnostics: Diagnostic[] = [];
      try {
        this.connection.console.info(`[step] Validating ${textDocument.uri} (${text.length} chars)`);
        this.connection.console.info(
          `[step] this.parserService.stepParserReady=${this.parserService.stepParserReady}, this.parserService.stepParser=${!!this.parserService.stepParser}`,
        );

        // 1. Tree-sitter parsing for LSP features
        let astIndex;
        let tree;
        if (this.parserService.stepParserReady && this.parserService.stepParser) {
          tree = this.parserService.stepParser.parse(text);
          if (tree) {
            this.documentManager.documentTrees.set(textDocument.uri, { text, tree, classCache: new Map() });
            const indexer = new SymbolIndexer([]);
            astIndex = indexer.index(tree.rootNode);
            this.connection.console.info(`[step] AST index: ${astIndex.symbols.size} symbols`);
          }
        } else {
          this.connection.console.info(
            `[step] Tree-sitter STEP this.parserService.parser not available, using regex-only extraction`,
          );
        }

        // 2. Structural indexing (Regex + OCCT) + AST index merge
        const stepIndex = await this.workspaceManager.stepWorkspaceIndex.parseStepFile(
          textDocument.uri,
          buffer,
          astIndex,
        );
        this.connection.console.info(
          `[step] StepWorkspaceIndex: ${stepIndex.symbols.size} symbols, ${this.workspaceManager.stepWorkspaceIndex.getMeshes(textDocument.uri).length} meshes`,
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
        const unifiedIndex = this.workspaceManager.unifiedWorkspace.toUnifiedPartial();
        this.connection.console.info(`[step] Unified index: ${unifiedIndex.symbols.size} symbols total`);
        if (this.workspaceManager.globalModelicaQueryEngine)
          this.workspaceManager.globalModelicaQueryEngine.updateIndex(unifiedIndex);
        if (this.workspaceManager.globalSysML2QueryEngine) {
          this.workspaceManager.globalSysML2QueryEngine.updateIndex(unifiedIndex);
          // Invalidate the SysML2 resolver cache so it sees the new STEP symbols
          const cachedResolver = (this.workspaceManager.globalSysML2QueryEngine as any).__resolverCache;
          if (cachedResolver) cachedResolver.updateIndex(unifiedIndex);
        }

        // Create/update STEP query engine + resolver + bridge
        // Always create a bridge, even without tree-sitter, so hover/completion
        // work on the structural (regex-derived) symbols.
        if (!this.workspaceManager.globalStepQueryEngine) {
          this.workspaceManager.globalStepQueryEngine = new QueryEngine(unifiedIndex, {} as any);
        } else {
          this.workspaceManager.globalStepQueryEngine.updateIndex(unifiedIndex);
        }

        const engine = this.workspaceManager.globalStepQueryEngine;
        let resolver = (engine as any).__resolverCache;
        if (!resolver) {
          resolver = new ScopeResolver(unifiedIndex, {} as any, {} as any);
          (engine as any).__resolverCache = resolver;
        } else {
          resolver.updateIndex(unifiedIndex);
        }

        const bridge = new LSPBridge(unifiedIndex, engine, resolver, new PositionIndex(text), textDocument.uri);
        this.documentLSPBridges.set(textDocument.uri, bridge);
        this.connection.console.info(`[step] LSPBridge created for ${textDocument.uri}`);

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
          try {
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
          } catch {
            // resolveAllReferences might not exist for the STEP resolver — that's ok
          }
        }
      } catch (e: any) {
        this.connection.console.error(
          `[step] Error in STEP pipeline for ${textDocument.uri}: ${e.message}\n${e.stack}`,
        );
      }

      // ── Always run regex-based reference checking (independent of tree-sitter/OCCT) ──
      const { definitions, references } = parseStepReferences(text);
      for (const ref of references) {
        if (!definitions.has(ref.id)) {
          const start = textDocument.positionAt(ref.startOffset);
          const end = textDocument.positionAt(ref.endOffset);
          stepDiagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: { start, end },
            message: `Reference to undefined entity '${ref.id}'`,
            source: "step",
          });
        }
      }

      // Schema arity checking
      for (const [, def] of definitions.entries()) {
        const schema = STEP_SCHEMA[def.type];
        if (schema) {
          let i = def.endOffset;
          while (i < text.length && /\s/.test(text[i])) i++;
          if (text[i] === "(") {
            const argsStart = i;
            let depth = 0;
            let inStr = false;
            let argCount = 0;
            let hasContent = false;

            for (i = argsStart; i < text.length; i++) {
              const ch = text[i];
              if (ch === "'") {
                inStr = !inStr;
                hasContent = true;
              } else if (!inStr && ch === "(") {
                if (depth > 0) hasContent = true;
                depth++;
              } else if (!inStr && ch === ")") {
                depth--;
                if (depth === 0) {
                  if (hasContent || argCount > 0) argCount++;
                  break;
                }
                hasContent = true;
              } else if (!inStr && depth === 1 && ch === ",") {
                argCount++;
                hasContent = false;
              } else if (depth > 0 && !/\s/.test(ch)) {
                hasContent = true;
              }
            }

            if (argCount !== schema.parameters.length) {
              const start = textDocument.positionAt(def.startOffset);
              const end = textDocument.positionAt(def.endOffset);
              stepDiagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: { start, end },
                message: `Schema violation for ${def.type}: expected ${schema.parameters.length} arguments, got ${argCount}.`,
                source: "step",
              });
            }
          }
        } else if (def.type !== "COMPLEX_ENTITY") {
          // Identify the exact position of the type name for a precise underline
          // def.text contains the full match e.g. "#123 = AXIS2_PLACEMENT_3D"
          // We want to highlight just the "AXIS2_PLACEMENT_3D" part.
          const typeMatchIndex = def.text.indexOf(def.type);
          const typeStartOffset = typeMatchIndex !== -1 ? def.startOffset + typeMatchIndex : def.startOffset;

          const start = textDocument.positionAt(typeStartOffset);
          const end = textDocument.positionAt(typeStartOffset + def.type.length);
          stepDiagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: { start, end },
            message: `Undefined STEP entity type '${def.type}'`,
            source: "step",
          });
        }
      }

      this.connection.console.info(`[step] Sending ${stepDiagnostics.length} diagnostics for ${textDocument.uri}`);
      this.lastSemanticDiagnostics.set(textDocument.uri, stepDiagnostics);
      this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: stepDiagnostics });
      this.connection.sendNotification("modelscript/projectTreeChanged");

      // Trigger cross-file revalidation so SysML files referencing this STEP file
      // will resolve the newly available CAD entities.
      if (this.revalidationTimer) clearTimeout(this.revalidationTimer);
      this.revalidationTimer = setTimeout(() => {
        this.connection.console.info(`[step] Cross-file revalidation triggered`);
        for (const doc of this.documentManager.documents.all()) {
          if (doc.uri !== textDocument.uri) {
            this.validateTextDocument(doc);
          }
        }
      }, 300);
      return;
    }

    // Handle OWL2 files via the polyglot reasoner pipeline
    if (textDocument.uri.endsWith(".owl") && this.parserService.owl2ParserReady && this.parserService.owl2Parser) {
      try {
        const oldCached = this.documentManager.documentTrees.get(textDocument.uri);
        let tree: any;

        if (oldCached && oldCached.text !== text) {
          const edit = computeTreeEdit(oldCached.text, text);
          oldCached.tree.edit(edit as never);
          tree = this.parserService.owl2Parser.parse(text, oldCached.tree as never);
        } else if (oldCached) {
          tree = oldCached.tree;
        } else {
          tree = this.parserService.owl2Parser.parse(text);
        }

        if (!tree) {
          this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
          return;
        }

        // Store in this.documentManager.documentTrees
        this.documentManager.documentTrees.set(textDocument.uri, {
          text,
          tree,
          classCache: oldCached?.classCache ?? new Map(),
        });

        const textChanged = this.lastIndexedText.get(textDocument.uri) !== text;

        // Register/update in OWL2 workspace index
        if (textChanged) {
          let editRanges: Array<{ startByte: number; endByte: number }> | undefined;
          let totalDelta = 0;
          const lastText = this.lastIndexedText.get(textDocument.uri);
          if (lastText) {
            const edit = computeTreeEdit(lastText, text);
            editRanges = [{ startByte: edit.startIndex, endByte: edit.newEndIndex }];
            totalDelta = edit.newEndIndex - edit.oldEndIndex;
          }

          if (this.workspaceManager.owl2WorkspaceIndex.has(textDocument.uri)) {
            this.workspaceManager.owl2WorkspaceIndex.markDirty(
              textDocument.uri,
              () => tree.rootNode,
              editRanges,
              totalDelta,
            );
          } else {
            this.workspaceManager.owl2WorkspaceIndex.register(textDocument.uri, () => tree.rootNode);
          }

          this.workspaceManager.owl2WorkspaceIndex.getFileIndex(textDocument.uri);
          this.lastIndexedText.set(textDocument.uri, text);
        }

        const changedIdsObj = this.workspaceManager.owl2WorkspaceIndex.takeGlobalChangedIds();
        const changedIds = changedIdsObj ? changedIdsObj.changedIds : null;
        const changedNames = this.workspaceManager.owl2WorkspaceIndex.takeGlobalChangedNames();

        const unifiedIndex = this.workspaceManager.unifiedWorkspace.toUnifiedPartial();

        if (changedNames && changedNames.size > 0) {
          if (this.revalidationTimer) clearTimeout(this.revalidationTimer);
          this.revalidationTimer = setTimeout(() => {
            for (const doc of this.documentManager.documents.all()) {
              if (doc.uri !== textDocument.uri) {
                this.validateTextDocument(doc);
              }
            }
          }, 500);
        }

        if (this.workspaceManager.globalOWL2QueryEngine) {
          if (changedIds && typeof this.workspaceManager.globalOWL2QueryEngine.swapIndex === "function") {
            this.workspaceManager.globalOWL2QueryEngine.swapIndex(unifiedIndex, changedIds);
          } else {
            this.workspaceManager.globalOWL2QueryEngine.updateIndex(unifiedIndex);
          }
        } else {
          this.workspaceManager.globalOWL2QueryEngine = new QueryEngine(unifiedIndex, {} as any);
        }
        const engine = this.workspaceManager.globalOWL2QueryEngine;

        let resolver = (engine as any).__resolverCache;
        if (!resolver) {
          resolver = new ScopeResolver(unifiedIndex, {} as any, {} as any);
          (engine as any).__resolverCache = resolver;
        } else {
          resolver.updateIndex(unifiedIndex);
        }

        const bridge = new LSPBridge(unifiedIndex, engine, resolver, new PositionIndex(text), textDocument.uri);
        this.documentLSPBridges.set(textDocument.uri, bridge);

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
            const store = this.workspaceManager.unifiedWorkspace.owl2Store;
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
                      if (this.findRangeForIri(iri, textDocument.uri)) {
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
                    const range = this.findRangeForIri(targetIri, textDocument.uri);
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
    if (
      textDocument.uri.endsWith(".sysml") &&
      this.parserService.sysml2ParserReady &&
      this.parserService.sysml2Parser
    ) {
      try {
        const oldCached = this.documentManager.documentTrees.get(textDocument.uri);
        let tree: any;

        if (oldCached && oldCached.text !== text) {
          const edit = computeTreeEdit(oldCached.text, text);
          oldCached.tree.edit(edit as never);
          tree = this.parserService.sysml2Parser.parse(text, oldCached.tree as never);
        } else if (oldCached) {
          tree = oldCached.tree;
        } else {
          tree = this.parserService.sysml2Parser.parse(text);
        }

        if (!tree) {
          this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
          return;
        }

        // Store in this.documentManager.documentTrees so verification and other LSP operations can access the tree/text
        this.documentManager.documentTrees.set(textDocument.uri, {
          text,
          tree,
          classCache: oldCached?.classCache ?? new Map(),
        });

        const textChanged = this.lastIndexedText.get(textDocument.uri) !== text;

        // Register/update in SysML2 workspace index
        if (textChanged) {
          let editRanges: Array<{ startByte: number; endByte: number }> | undefined;
          let totalDelta = 0;
          const lastText = this.lastIndexedText.get(textDocument.uri);
          if (lastText) {
            const edit = computeTreeEdit(lastText, text);
            editRanges = [{ startByte: edit.startIndex, endByte: edit.newEndIndex }];
            totalDelta = edit.newEndIndex - edit.oldEndIndex;
          }

          if (this.workspaceManager.sysml2WorkspaceIndex.has(textDocument.uri)) {
            this.workspaceManager.sysml2WorkspaceIndex.markDirty(
              textDocument.uri,
              () => tree.rootNode,
              editRanges,
              totalDelta,
            );
          } else {
            this.workspaceManager.sysml2WorkspaceIndex.register(textDocument.uri, () => tree.rootNode);
          }

          // Force index evaluation for active document AFTER it is registered/marked dirty
          // so that it actually triggers processing and populates the partial index.
          // Without this, toUnifiedPartial() skips the file (index stays null).
          this.workspaceManager.sysml2WorkspaceIndex.getFileIndex(textDocument.uri);
          this.lastIndexedText.set(textDocument.uri, text);
        }

        // Get ALL changed symbol IDs across the workspace since last check
        const changedIdsObj = this.workspaceManager.sysml2WorkspaceIndex.takeGlobalChangedIds();
        const changedIds = changedIdsObj ? changedIdsObj.changedIds : null;
        const changedNames = this.workspaceManager.sysml2WorkspaceIndex.takeGlobalChangedNames();

        // Create or update query engine, resolver, and LSP bridge for the document
        const unifiedIndex = this.workspaceManager.unifiedWorkspace.toUnifiedPartial();

        if (changedNames && changedNames.size > 0) {
          if (this.revalidationTimer) clearTimeout(this.revalidationTimer);
          this.revalidationTimer = setTimeout(() => {
            for (const doc of this.documentManager.documents.all()) {
              if (doc.uri !== textDocument.uri) {
                this.validateTextDocument(doc);
              }
            }
          }, 500);
        }

        if (this.workspaceManager.globalSysML2QueryEngine) {
          if (changedIds && typeof this.workspaceManager.globalSysML2QueryEngine.swapIndex === "function") {
            this.workspaceManager.globalSysML2QueryEngine.swapIndex(unifiedIndex, changedIds);
          } else {
            this.workspaceManager.globalSysML2QueryEngine.updateIndex(unifiedIndex);
          }
        } else {
          this.workspaceManager.globalSysML2QueryEngine = createSysML2QueryEngine(unifiedIndex) as any;
        }
        const engine = this.workspaceManager.globalSysML2QueryEngine;

        let resolver = (engine as any).__resolverCache;
        if (!resolver) {
          resolver = createSysML2ScopeResolver(unifiedIndex);
          (engine as any).__resolverCache = resolver;
        } else {
          resolver.updateIndex(unifiedIndex);
        }

        const bridge = createSysML2LSPBridge(unifiedIndex, engine, resolver, text, textDocument.uri);
        this.documentLSPBridges.set(textDocument.uri, bridge);

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
          const unresolvedRefs = this.dependenciesReady
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

          // Run the incremental reasoner update for SysML2
          try {
            const versions = new Map<string, number>();
            versions.set("sysml2", this.workspaceManager.sysml2WorkspaceIndex.version);
            this.reasonerService.updateAndReason(versions);

            const consistency = this.reasonerService.reasoner.checkConsistency();
            if (!consistency.isConsistent) {
              // Find any inconsistencies related to this file and map them
              for (const axiom of consistency.conflictingAxioms || []) {
                let targetIri: string | null = null;
                if (axiom.type === "SubClassOf") targetIri = axiom.subClassIri;
                else if (axiom.type === "ClassAssertion") targetIri = axiom.individualIri;
                else if ((axiom as any).iri) targetIri = (axiom as any).iri;

                if (targetIri) {
                  const range = this.findRangeForIri(targetIri, textDocument.uri);
                  if (range) {
                    sysmlDiagnostics.push({
                      severity: DiagnosticSeverity.Error,
                      range,
                      message: `Logical contradiction: ${this.reasonerService.reasoner.explain(targetIri, "satisfiability")}`,
                      source: "sysml2-reasoner",
                    });
                  }
                }
              }
            }
          } catch (e: any) {
            this.connection.console.error(`[sysml2-reasoner] Update failed: ${e.message}`);
          }
        } else {
          // Retain existing semantic diagnostics if the AST is broken to prevent flashing
          const cachedSemantic = this.lastSemanticDiagnostics.get(textDocument.uri) || [];
          sysmlDiagnostics.push(...cachedSemantic);
        }

        const vDiags = this.verificationDiagnosticsByUri.get(textDocument.uri);
        if (vDiags) {
          sysmlDiagnostics.push(...vDiags);
        }

        this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: sysmlDiagnostics });

        // Notify UI that the project tree (and requirements index) has been updated
        this.connection.sendNotification("modelscript/projectTreeChanged");

        // Auto-trigger verification if this document contains verification/analysis cases.
        // This makes the "compiler actively fails the build" behavior described in the paper
        // happen automatically without requiring the user to run a command.
        if (this.workspaceManager.unifiedWorkspace) {
          try {
            const udb = this.workspaceManager.unifiedWorkspace.toUnifiedPartial();
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

    if (this.parserService.parserReady && this.parserService.parser) {
      this.connection.console.info(`[validate] Entering Modelica parsing`);
      // Polyglot-only pipeline: tree-sitter parse → SymbolIndex → QueryEngine → diagnostics
      const context = this.parserService.sharedContext;
      if (!context) {
        this.connection.console.info(`[validate] this.parserService.sharedContext is null!`);
        return;
      }

      // Pre-process Modelica text to replace the custom 'shape' keyword with 'model'
      // Since both are 5 characters long, byte offsets remain perfectly aligned!
      const processedText = text.replace(/\bshape\b/g, "model");

      // Parse with tree-sitter (incremental when possible)
      const oldCached = this.documentManager.documentTrees.get(textDocument.uri);

      let tree: any;
      let editRanges: Array<{ startByte: number; endByte: number }> | undefined;
      if (oldCached && oldCached.text !== text) {
        const edit = computeTreeEdit(oldCached.text, text);
        oldCached.tree.edit(edit as never);
        tree = context.parse(".mo", processedText, oldCached.tree as never);
        // Capture edit byte ranges for incremental indexing
        editRanges = [{ startByte: edit.startIndex, endByte: edit.newEndIndex }];
      } else if (oldCached) {
        tree = oldCached.tree;
      } else {
        tree = context.parse(".mo", processedText);
      }
      this.documentManager.documentTrees.set(textDocument.uri, {
        text, // Keep the original text in the cache!
        tree,
        classCache: oldCached?.classCache ?? new Map(),
      });

      this.connection.console.info(`[validate] tree parsed`);

      // Collect syntax errors from the tree using the shared pure function.
      // These were likely already sent instantly by the onDidChangeContent handler,
      // but we recompute them here to ensure consistency with the current tree.
      const syntaxDiags = this.collectSyntaxErrors(tree.rootNode, textDocument);
      diagnostics.push(...syntaxDiags);

      this.connection.console.info(
        `[validate] ${textDocument.uri}: text=${text.length}B, syntaxErrors=${diagnostics.length}, hasError=${typeof tree.rootNode.hasError === "function" ? tree.rootNode.hasError() : tree.rootNode.hasError}`,
      );

      // Send syntax diagnostics immediately so the user gets instant feedback
      // even if the semantic pipeline takes a long time.
      const cachedSemantic = this.lastSemanticDiagnostics.get(textDocument.uri) || [];
      const allDiags = [...diagnostics, ...cachedSemantic];
      if (allDiags.length > 1000) allDiags.length = 1000;
      this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: allDiags });

      // Always run the semantic pipeline with revision tracking — syntax errors
      // were already sent instantly by the onDidChangeContent handler, so this
      // pass focuses on producing the merged (syntax + semantic) diagnostic set.
      // Passing the revision allows the pipeline to bail out early if a new edit
      // arrives while it's running (staleness check at each expensive step).
      const revisionAtStart = this.documentRevisions.get(textDocument.uri) ?? 0;

      this.connection.console.info(`[validate] starting this.runSemanticPipeline`);
      const promise = this.runSemanticPipeline(
        textDocument.uri,
        text,
        tree,
        editRanges,
        diagnostics,
        revisionAtStart,
        context,
      ).catch((e) => {
        this.connection.console.error(
          `[this.runSemanticPipeline] Failed for ${textDocument.uri}: ${e instanceof Error ? e.message + "\\n" + e.stack : String(e)}`,
        );
      });
      this.activeValidationPromises.set(textDocument.uri, promise);
      promise.finally(() => {
        if (this.activeValidationPromises.get(textDocument.uri) === promise) {
          this.activeValidationPromises.delete(textDocument.uri);
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
    // and prevent massive index invalidation cascades when the this.parserService.parser fails to recover.
    const hasError = typeof tree.rootNode.hasError === "function" ? tree.rootNode.hasError() : tree.rootNode.hasError;
    if (hasError) {
      this.connection.console.info(
        `[pipeline] Syntax errors present in ${uri}, skipping semantic pipeline to preserve cache and latency`,
      );
      return;
    }

    const startVersion = this.workspaceManager.globalWorkspaceIndex.version;
    /** Returns true if a newer edit has arrived, meaning we should abandon this pipeline run. */
    const isStale = () => {
      if (revisionAtStart !== null && (this.documentRevisions.get(uri) ?? 0) !== revisionAtStart) return true;
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
      this.connection.console.info(`[perf] Starting this.runSemanticPipeline for ${uri}`);
      const effectiveUri = uri.startsWith("modelscript-lib://global")
        ? "file://" + uri.substring("modelscript-lib://global".length)
        : uri;

      // ── Step 1: Re-index ─────────────────────────────────────────────────
      // Only update the workspace index if the text actually changed.
      // Prevents infinite revalidation loops from revalidation calls.
      const textChanged = this.lastIndexedText.get(effectiveUri) !== text;
      let changedIds: Set<number> | null = null;
      let changedNames: Set<string> | null = null;
      let unifiedIndex: any = null;

      if (textChanged) {
        const step0t = performance.now();
        let totalDelta = 0;
        if (!editRanges) {
          const lastText = this.lastIndexedText.get(effectiveUri);
          if (lastText) {
            const edit = computeTreeEdit(lastText, text);
            editRanges = [{ startByte: edit.startIndex, endByte: edit.newEndIndex }];
            totalDelta = edit.newEndIndex - edit.oldEndIndex;
          }
        }

        if (this.workspaceManager.globalWorkspaceIndex.has(effectiveUri)) {
          this.workspaceManager.globalWorkspaceIndex.markDirty(
            effectiveUri,
            () => tree.rootNode,
            editRanges,
            totalDelta,
          );
        } else {
          this.workspaceManager.globalWorkspaceIndex.register(effectiveUri, () => tree.rootNode);
        }
        const step0_1t = performance.now();
        this.workspaceManager.globalWorkspaceIndex.getFileIndex(effectiveUri);
        const step0_2t = performance.now();
        this.lastIndexedText.set(effectiveUri, text);
        this.connection.console.info(
          `[perf] Step 1.0 (markDirty): ${(step0_1t - step0t).toFixed(2)}ms, (getFileIndex): ${(step0_2t - step0_1t).toFixed(2)}ms`,
        );
      }

      changedNames = this.workspaceManager.globalWorkspaceIndex.takeGlobalChangedNames();

      if (isStale()) return;

      // We ALWAYS need unifiedIndex for downstream steps (bridge, linting, etc.)
      // It's very fast if there are no changes.
      const step0_3t = performance.now();
      unifiedIndex = this.workspaceManager.unifiedWorkspace.toUnifiedPartial();
      const step0_4t = performance.now();
      const cstTreeWrapper = getSharedCstTreeWrapper();
      this.connection.console.info(`[perf] Step 1.0 (toUnifiedPartial): ${(step0_4t - step0_3t).toFixed(2)}ms`);

      const changedIdsObj = this.workspaceManager.globalWorkspaceIndex.takeGlobalChangedIds();
      changedIds = changedIdsObj ? changedIdsObj.changedIds : null;
      const structuralChangedIds = changedIdsObj ? changedIdsObj.structuralChangedIds : null;
      const engineNeedsUpdate = textChanged || (changedIds && changedIds.size > 0);

      if (engineNeedsUpdate) {
        // ── Step 2: Unified index merge + QueryEngine update ─────────────────
        let step1T = performance.now();
        this.connection.console.info(
          `[perf] Step 1.1 (toUnifiedPartial): ${(performance.now() - step1T).toFixed(2)}ms`,
        );

        if (changedNames && changedNames.size > 0) {
          if (this.revalidationTimer) clearTimeout(this.revalidationTimer);
          this.revalidationTimer = setTimeout(() => {
            for (const doc of this.documentManager.documents.all()) {
              const effectiveDocUri = doc.uri.startsWith("modelscript-lib://global")
                ? "file://" + doc.uri.substring("modelscript-lib://global".length)
                : doc.uri;
              if (effectiveDocUri !== effectiveUri) {
                this.validateTextDocument(doc);
              }
            }
          }, 1000);
        }

        step1T = performance.now();

        if (this.workspaceManager.globalModelicaQueryEngine) {
          injectPredefinedTypes(unifiedIndex);
          this.connection.console.info(
            `[perf] Step 1.2 (injectPredefinedTypes): ${(performance.now() - step1T).toFixed(2)}ms`,
          );
          step1T = performance.now();
          if (changedIds && typeof this.workspaceManager.globalModelicaQueryEngine.swapIndex === "function") {
            this.workspaceManager.globalModelicaQueryEngine.swapIndex(
              unifiedIndex,
              changedIds,
              structuralChangedIds || undefined,
            );
            this.connection.console.info(`[perf] Step 1.3 (swapIndex): ${(performance.now() - step1T).toFixed(2)}ms`);
          } else {
            this.workspaceManager.globalModelicaQueryEngine.updateIndex(unifiedIndex);
            this.connection.console.info(`[perf] Step 1.3 (updateIndex): ${(performance.now() - step1T).toFixed(2)}ms`);
          }
          if (typeof this.workspaceManager.globalModelicaQueryEngine.updateTree === "function") {
            this.workspaceManager.globalModelicaQueryEngine.updateTree(cstTreeWrapper);
          }
        } else {
          this.workspaceManager.globalModelicaQueryEngine = createModelicaQueryEngine(
            unifiedIndex,
            cstTreeWrapper,
          ) as any;
        }
      } else {
        if (!this.workspaceManager.globalModelicaQueryEngine) {
          this.workspaceManager.globalModelicaQueryEngine = createModelicaQueryEngine(
            unifiedIndex,
            cstTreeWrapper,
          ) as any;
        }
      }
      this.connection.console.info(`[perf] Step 1 (Index): ${(performance.now() - t0).toFixed(2)}ms`);
      context.setQueryEngine(this.workspaceManager.globalModelicaQueryEngine);
      context.setWorkspaceIndex(this.workspaceManager.globalWorkspaceIndex);
      const engine = this.workspaceManager.globalModelicaQueryEngine;

      let resolver = (engine as any).__resolverCache;
      if (!resolver) {
        resolver = createModelicaScopeResolver(unifiedIndex);
        (engine as any).__resolverCache = resolver;
      } else if (engineNeedsUpdate) {
        resolver.updateIndex(unifiedIndex);
      }
      // Pass changedIds for incremental reference caching
      if (resolver.setChangedIds) {
        resolver.setChangedIds(changedIds ?? null);
      }

      const currentDoc = this.documentManager.documents.get(uri);
      const currentText = currentDoc ? currentDoc.getText() : text;
      const bridge = createModelicaLSPBridge(unifiedIndex, engine, resolver, currentText, uri);
      this.documentLSPBridges.set(uri, bridge);
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
      const isWorkspaceFile = !!this.documentManager.documents.get(uri);

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
      // or background indexing are not tracked by this.documentManager.documents.
      const hasSyntaxErrors = baseDiagnostics.length > 0;
      const skipHeavyLints = !isWorkspaceFile && docSymbolCount > 1000;

      if (hasSyntaxErrors) {
        // Retain existing semantic diagnostics if the AST is broken to prevent flashing
        const cachedSemantic = this.lastSemanticDiagnostics.get(uri) || [];
        newSemanticDiagnostics.push(...cachedSemantic);
      }

      if (!skipHeavyLints) {
        const viewportRange = this.documentViewports.get(uri) ?? undefined;
        const engineDiags = await (engine as any).runAllLintsAsync(uri, yieldAndCheckStale, viewportRange);
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

      // ── Step 5 (moved before Step 4): Create ModelicaClassInstance wrappers
      // Wrappers are needed by the project tree and diagram rendering.
      // They don't depend on reference resolution, so run them now.
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
      this.workspaceManager.workspaceInstances.set(uri, thisDocInstances);
      this.workspaceManager.documentInstances.set(uri, thisDocInstances);
      this.workspaceManager.documentContexts.set(uri, context);
      this.connection.console.info(`[perf] Step 5 (Wrappers): ${(performance.now() - t0).toFixed(2)}ms`);

      // ── Immediate delivery: publish lint diagnostics + wrappers now ─────
      // The user sees lint errors and the project tree immediately.
      if (isStale()) return;

      const preservedRefDiags: Diagnostic[] = [];
      const cachedRefs = (resolver as any).getPreservedDiagnostics?.(uri) || [];
      for (const r of cachedRefs) {
        if (r.fqn) {
          const uriToFix = (this.workspaceManager.globalWorkspaceIndex as any).getFileUriForFQN?.(r.fqn);
          if (uriToFix && !this.workspaceManager.globalWorkspaceIndex.has(uriToFix)) {
            continue;
          }
        }
        const start = (bridge as any).positions.offsetToPosition(r.startByte);
        const end = (bridge as any).positions.offsetToPosition(r.endByte);
        let severity: DiagnosticSeverity = DiagnosticSeverity.Error;
        if (r.severity === "warning") severity = DiagnosticSeverity.Warning;
        if (r.severity === "info") severity = DiagnosticSeverity.Information;
        preservedRefDiags.push({ severity, range: { start, end }, message: r.message, source: "modelscript" });
      }

      this.lastSemanticDiagnostics.set(uri, [...newSemanticDiagnostics, ...preservedRefDiags]);
      const earlyDiags = [...baseDiagnostics, ...newSemanticDiagnostics, ...preservedRefDiags];
      if (earlyDiags.length > 1000) earlyDiags.length = 1000;
      this.connection.sendDiagnostics({ uri, diagnostics: earlyDiags });
      this.connection.sendNotification("modelscript/projectTreeChanged");
      this.connection.console.info(
        `[perf] Immediate delivery for ${uri} in ${(performance.now() - t0).toFixed(2)}ms (preserved ${preservedRefDiags.length} ref errors)`,
      );

      // ── Step 4 (deferred): Resolve references in the background ─────────
      // Reference resolution can take 4+ seconds on cold cache. Run it
      // asynchronously and send an augmented diagnostic update when done.
      // IMPORTANT: We track this as part of the pipeline promise via
      // deferredResolve so the inflight check prevents redundant pipeline starts.
      if (!skipHeavyLints && this.dependenciesReady) {
        // Capture values needed by the async closure
        const capturedUri = uri;
        const capturedBaseDiagnostics = [...baseDiagnostics];
        const capturedLintDiagnostics = [...newSemanticDiagnostics];
        const capturedBridge = bridge;
        const capturedResolver = resolver;
        const capturedRevision = revisionAtStart;
        const capturedT0 = t0;

        // Yield to the event loop to let the Tier 2 timer settle.
        // The pipeline's outer promise (tracked in activeValidationPromises)
        // won't resolve until this await completes, keeping "inflight" true.
        await new Promise<void>((r) => setTimeout(r, 0));

        // If a new edit arrived during the yield, abort deferred work
        if (capturedRevision !== null && (this.documentRevisions.get(capturedUri) ?? 0) !== capturedRevision) {
          this.connection.console.info(`[perf] Step 4 (deferred) skipped — stale revision for ${capturedUri}`);
        } else {
          try {
            this.connection.console.info(`[perf] Step 4 (deferred) starting for ${capturedUri}`);
            const refT0 = performance.now();

            const yieldAndCheckStaleDeferred = async () => {
              await new Promise<void>((r) => setTimeout(r, 0));
              return capturedRevision !== null && (this.documentRevisions.get(capturedUri) ?? 0) !== capturedRevision;
            };

            const unresolvedRefs = await (capturedResolver as any).resolveAllReferencesAsync(
              capturedUri,
              yieldAndCheckStaleDeferred,
            );

            // Check again after resolution
            if (capturedRevision !== null && (this.documentRevisions.get(capturedUri) ?? 0) !== capturedRevision) {
              this.connection.console.info(
                `[perf] Step 4 (deferred) aborted — stale after resolution for ${capturedUri}`,
              );
            } else {
              const refDiagnostics: Diagnostic[] = [];
              for (const r of unresolvedRefs) {
                if (r.fqn) {
                  const uriToFix = (this.workspaceManager.globalWorkspaceIndex as any).getFileUriForFQN?.(r.fqn);
                  if (uriToFix && !this.workspaceManager.globalWorkspaceIndex.has(uriToFix)) {
                    this.workspaceManager.globalWorkspaceIndex.getFileIndex(uriToFix);
                    continue;
                  }
                }
                const start = (capturedBridge as any).positions.offsetToPosition(r.startByte);
                const end = (capturedBridge as any).positions.offsetToPosition(r.endByte);
                let severity: DiagnosticSeverity = DiagnosticSeverity.Error;
                if (r.severity === "warning") severity = DiagnosticSeverity.Warning;
                if (r.severity === "info") severity = DiagnosticSeverity.Information;
                refDiagnostics.push({ severity, range: { start, end }, message: r.message, source: "modelscript" });
              }

              // Merge lint + reference diagnostics and send update
              const allSemanticDiags = [...capturedLintDiagnostics, ...refDiagnostics];
              this.lastSemanticDiagnostics.set(capturedUri, allSemanticDiags);
              const finalDiags = [...capturedBaseDiagnostics, ...allSemanticDiags];
              if (finalDiags.length > 1000) finalDiags.length = 1000;
              this.connection.sendDiagnostics({ uri: capturedUri, diagnostics: finalDiags });

              this.connection.console.info(
                `[perf] Step 4 (deferred) completed for ${capturedUri} in ${(performance.now() - refT0).toFixed(2)}ms (total pipeline: ${(performance.now() - capturedT0).toFixed(2)}ms), refDiags=${refDiagnostics.length}`,
              );
            }
          } catch (e: any) {
            this.connection.console.warn(`[perf] Step 4 (deferred) failed: ${e?.message ?? e}`);
          }
        }
      }

      this.connection.console.info(
        `[perf] Finished this.runSemanticPipeline for ${uri} in ${(performance.now() - t0).toFixed(2)}ms`,
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
      const textDocument = this.documentManager.documents.get(uri);
      if (!textDocument) throw new Error("Document not found");

      if (activeVerification) activeVerification.abort();
      activeVerification = new AbortController();
      const signal = activeVerification.signal;

      const db = this.workspaceManager.unifiedWorkspace.toUnifiedPartial();
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
        getText: (startByte: number, endByte: number, entry?: any): string | null => {
          if (!entry || !entry.resourceId) return null;
          const entryUri = entry.resourceId;
          const docTree = this.documentManager.documentTrees.get(entryUri);
          if (docTree && docTree.text) return docTree.text.substring(startByte, endByte);

          let lazyCache = this.documentManager.lazyLibTrees.get(entryUri);
          if (!lazyCache && this.parserService.sharedContext) {
            try {
              const fsPath = entryUri.startsWith("file://") ? entryUri.substring(7) : entryUri;
              const text = this.parserService.sharedContext.fs.read(fsPath);
              if (text) {
                const tree = this.parserService.sharedContext.parse(
                  entryUri.endsWith(".sysml") ? ".sysml" : ".mo",
                  text,
                );
                lazyCache = { tree, text };
                this.documentManager.lazyLibTrees.set(entryUri, lazyCache);
              }
            } catch (e) {}
          }
          if (lazyCache) return lazyCache.text.substring(startByte, endByte);

          const doc = this.documentManager.documents.get(entryUri);
          if (doc) return doc.getText().substring(startByte, endByte);
          return null;
        },
        getNode: (startByte: number, endByte: number, entry?: any): any | null => {
          if (!entry || !entry.resourceId) return null;
          const entryUri = entry.resourceId;
          const docTree = this.documentManager.documentTrees.get(entryUri);
          if (docTree && docTree.tree) {
            return docTree.tree.rootNode.descendantForIndex(startByte, Math.max(startByte, endByte - 1));
          }

          let lazyCache = this.documentManager.lazyLibTrees.get(entryUri);
          if (!lazyCache && this.parserService.sharedContext) {
            try {
              const fsPath = entryUri.startsWith("file://") ? entryUri.substring(7) : entryUri;
              const text = this.parserService.sharedContext.fs.read(fsPath);
              if (text) {
                const tree = this.parserService.sharedContext.parse(
                  entryUri.endsWith(".sysml") ? ".sysml" : ".mo",
                  text,
                );
                lazyCache = { tree, text };
                this.documentManager.lazyLibTrees.set(entryUri, lazyCache);
              }
            } catch (e) {}
          }
          if (lazyCache) {
            return lazyCache.tree.rootNode.descendantForIndex(startByte, Math.max(startByte, endByte - 1));
          }

          const doc = this.documentManager.documents.get(entryUri);
          if (doc) {
            const text = doc.getText();
            let tree: any;
            if (entryUri.endsWith(".sysml") && this.parserService.sysml2Parser) {
              tree = this.parserService.sysml2Parser.parse(text);
            } else if (this.parserService.sharedContext) {
              tree = this.parserService.sharedContext.parse(".mo", text);
            }
            if (tree) {
              this.documentManager.documentTrees.set(entryUri, { text, tree, classCache: new Map() });
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
            ? this.workspaceManager.globalSysML2QueryEngine
            : this.workspaceManager.globalModelicaQueryEngine;
          if (!targetEngine && finalEntry.resourceId.endsWith(".mo")) {
            targetEngine = createModelicaQueryEngine(db, verifyCstTreeWrapper);
          }
        }

        const targetDB = targetEngine
          ? (targetEngine as any).toQueryDB()
          : (this.workspaceManager.unifiedWorkspace as any).engine?.toQueryDB() || sysmlDB;
        const targetModel = new ModelicaClassInstance(simTargetId, targetDB) as any;
        targetModel.instantiate();

        const context = this.parserService.sharedContext;
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

        const bridge = this.documentLSPBridges.get(uri);
        if (bridge) {
          const diags: Diagnostic[] = vResults.map((v) => ({
            range: this.findRangeForIri(v.constraintId as unknown as string, uri) || {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            message: v.message || "Constraint violated",
            severity: DiagnosticSeverity.Error,
            source: "sysml2-verifier",
          }));
          newDiagnostics.push(...diags);
        }
      }

      if (signal.aborted) return { ok: false };

      this.verificationDiagnosticsByUri.set(uri, newDiagnostics);
      this.verificationResultsByUri.set(uri, allResults);

      this.validateTextDocument(textDocument);
      return { ok: true };
    } catch (e: any) {
      this.connection.console.error(`[sysml2-verifier] Error: ${e.message}\n${e.stack}`);

      const crashDiag: Diagnostic = {
        severity: DiagnosticSeverity.Error,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        message: `Verification CRASHED: ${e.message}`,
        source: "sysml2-verifier",
      };
      this.verificationDiagnosticsByUri.set(uri, [crashDiag]);
      const doc = this.documentManager.documents.get(uri);
      if (doc) this.validateTextDocument(doc);

      return { ok: false };
    }
  }

  private findRangeForIri(
    iri: string,
    currentUri: string,
  ): { start: { line: number; character: number }; end: { line: number; character: number } } | null {
    const db = this.workspaceManager.unifiedWorkspace.toUnifiedPartial();
    const nameIds = db.byName.get(iri);
    if (nameIds && nameIds.length > 0) {
      for (const id of nameIds) {
        const entry = db.symbols.get(id);
        if (
          entry &&
          entry.resourceId === currentUri &&
          typeof entry.startByte === "number" &&
          typeof entry.endByte === "number"
        ) {
          const docTree = this.documentManager.documentTrees.get(currentUri);
          if (docTree && docTree.tree) {
            const node = docTree.tree.rootNode.descendantForIndex(
              entry.startByte,
              Math.max(entry.startByte, entry.endByte - 1),
            );
            return {
              start: { line: node.startPosition.row, character: node.startPosition.column },
              end: { line: node.endPosition.row, character: node.endPosition.column },
            };
          }
        }
      }
    }
    return null;
  }
}

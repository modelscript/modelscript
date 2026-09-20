/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-function, @typescript-eslint/prefer-for-of, @typescript-eslint/array-type, @typescript-eslint/no-non-null-assertion, no-empty */
// ts-check
import { Connection, Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DocumentManager } from "./DocumentManager.js";
import { ParserService } from "./ParserService.js";
import { WorkspaceManager } from "./WorkspaceManager.js";

import { lowerCstToAxioms } from "@modelscript/owl2/cst-lowering";
import { QueryEngine, VerificationRunner } from "@modelscript/runtime";
import { TableauReasoner } from "@modelscript/runtime/wasm_ontology.js";
import { simulateArena } from "@modelscript/simulate";
import { parseStepReferences, STEP_SCHEMA } from "@modelscript/step";
import { LSPBridge, PositionIndex } from "../lsp-bridge.js";
import { getArenaParameterInfo } from "../utils/arenaUtils.js";
import { computeTreeEdit } from "../utils/astUtils.js";
import { ReasonerService } from "./ReasonerService.js";

import { globalLanguageRegistry, type LanguagePlugin } from "../registry/LanguageRegistry.js";

let verificationTimer: any = undefined;
let activeVerification: any = undefined;
let flattenArenaFromInstance: any = undefined;

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

  public collectSyntaxErrors(rootNode: any, textDocument: TextDocument, plugin?: LanguagePlugin): Diagnostic[] {
    const t0 = performance.now();
    const diagnostics: Diagnostic[] = [];
    if (!rootNode) return diagnostics;

    // 1. Native WASM GLR parser diagnostics
    const facade = plugin?.facade ?? rootNode?.tree?.facade ?? this.parserService.facade;
    if (facade && typeof facade.getDiagnostics === "function") {
      try {
        const rootPtr = rootNode.id ?? rootNode.ptr ?? rootNode?.tree?.rootPtr ?? 0;
        if (rootPtr) {
          const wasmDiags = facade.getDiagnostics(rootPtr);
          if (Array.isArray(wasmDiags) && wasmDiags.length > 0) {
            for (const d of wasmDiags) {
              // Severity 1 = Error (Syntax Error).
              // Linter warnings (severity 2 / lintId >= 1000) are handled by the semantic pipeline.
              if (d.severity === 1 || !d.code || d.code === "ERROR") {
                let range = d.range;
                if (d.startCharOffset !== undefined && d.endCharOffset !== undefined) {
                  range = {
                    start: textDocument.positionAt(d.startCharOffset),
                    end: textDocument.positionAt(d.endCharOffset),
                  };
                }
                if (range.start.line === range.end.line && range.start.character === range.end.character) {
                  range = {
                    start: range.start,
                    end: { line: range.start.line, character: range.start.character + 1 },
                  };
                }
                diagnostics.push({
                  severity: DiagnosticSeverity.Error,
                  range,
                  message: d.message || "Syntax error",
                  source: plugin?.name ? plugin.name.toLowerCase() : "modelscript",
                });
              }
            }
            if (diagnostics.length > 0) {
              return diagnostics;
            }
          }
        }
      } catch (e) {
        this.connection.console.error(`[collectSyntaxErrors] error calling facade.getDiagnostics: ${e}`);
      }
    }

    // 2. Fallback: CST tree walk
    if (typeof rootNode.walk !== "function") return diagnostics;
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

      let start = textDocument.positionAt(node.startIndex);
      let end = textDocument.positionAt(node.endIndex);

      if (isMissing) {
        if (start.line === end.line && start.character === end.character) {
          if (node.previousSibling) {
            start = textDocument.positionAt(node.previousSibling.startIndex);
            end = textDocument.positionAt(node.previousSibling.endIndex);
          } else {
            end = { line: start.line, character: start.character + 1 };
          }
        }
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: { start, end },
          message: `Missing syntax element`,
          source: "modelscript",
        });
      } else if (node.type === "ERROR") {
        if (start.line === end.line && start.character === end.character) {
          end = { line: start.line, character: start.character + 1 };
        }
        const textSnippet = textDocument.getText({ start, end });
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: { start, end },
          message: textSnippet ? `Syntax error near '${textSnippet}'` : "Syntax error",
          source: "modelscript",
        });

        // Don't descend further into this ERROR node's children to prevent duplicate noisy diagnostics
        while (!cursor.gotoNextSibling()) {
          if (!cursor.gotoParent()) {
            didDescend = false;
            break;
          }
        }
        continue;
      }

      if (hasErr) {
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
    const uri = textDocument.uri;
    const text = textDocument.getText();
    const plugin = globalLanguageRegistry.getPluginForLanguageIdOrUri(textDocument.languageId, uri);

    // 1. Check custom validation handler (e.g. for specialized formats)
    if (plugin?.customHandlers?.validate) {
      try {
        const res = await plugin.customHandlers.validate(textDocument);
        if (res !== undefined) return;
      } catch (e: any) {
        this.connection.console.error(`[validate] Custom validation handler failed for ${uri}: ${e.message}`);
        return;
      }
    }

    // Handle Javascript/TypeScript sidecar files natively if no plugin customHandler
    if (uri.endsWith(".js") || uri.endsWith(".ts")) {
      this.validateSidecarDocument(textDocument);
      return;
    }

    // Handle STEP files natively if no plugin customHandler
    const isStep = textDocument.languageId === "step" || /\.(step|stp|p21)$/i.test(uri);
    if (isStep) {
      await this.validateStepDocument(textDocument, plugin);
      return;
    }

    // 2. Uniform Parsing Pipeline
    const langId = plugin?.id ?? (textDocument.languageId || "modelica");
    const parser = plugin?.parser ?? this.parserService.getParser(langId);

    if (!parser && !this.parserService.sharedContext) {
      this.fallbackRegexValidation(textDocument);
      return;
    }

    // Pre-process text if needed (e.g. Modelica 'shape' keyword)
    let processedText = text;
    if (plugin?.preprocessText) {
      processedText = plugin.preprocessText(text);
    } else if (typeof (globalThis as any).preprocessLanguageText === "function") {
      processedText = (globalThis as any).preprocessLanguageText(langId, text);
    } else if (langId === "modelica" || uri.endsWith(".mo")) {
      processedText = text.replace(/\bshape\b/g, "model");
    }

    const oldCached = this.documentManager.documentTrees.get(uri);
    let tree: any;
    let editRanges: Array<{ startByte: number; endByte: number }> | undefined;

    try {
      if (oldCached && oldCached.text !== text) {
        const edit = computeTreeEdit(oldCached.text, text);
        if (typeof (oldCached.tree as any)?.edit === "function") {
          oldCached.tree.edit(edit as never);
        }
        if (parser) {
          tree = parser.parse(processedText, oldCached.tree as never);
        } else if (this.parserService.sharedContext) {
          tree = this.parserService.sharedContext.parse(".mo", processedText, oldCached.tree as never, {
            editStart: edit.startIndex,
            editOldEnd: edit.oldEndIndex,
            editNewEnd: edit.newEndIndex,
          });
        }
        editRanges = [{ startByte: edit.startIndex, endByte: edit.newEndIndex }];
      } else if (oldCached) {
        tree = oldCached.tree;
      } else {
        if (parser) {
          tree = parser.parse(processedText);
        } else if (this.parserService.sharedContext) {
          tree = this.parserService.sharedContext.parse(".mo", processedText);
        }
      }
    } catch (err: any) {
      this.connection.console.error(`[validate] Parser error for ${uri}: ${err.message}`);
    }

    if (!tree) {
      this.connection.sendDiagnostics({ uri, diagnostics: [] });
      return;
    }

    this.documentManager.documentTrees.set(uri, {
      text,
      tree,
      classCache: oldCached?.classCache ?? new Map(),
    });

    // 3. Collect syntax diagnostics immediately
    const syntaxDiags = this.collectSyntaxErrors(tree.rootNode, textDocument, plugin);
    const cachedSemantic = this.lastSemanticDiagnostics.get(uri) || [];
    const initialDiags = [...syntaxDiags, ...cachedSemantic];
    if (initialDiags.length > 1000) initialDiags.length = 1000;
    this.connection.sendDiagnostics({ uri, diagnostics: initialDiags });

    // 4. Run Unified Semantic Pipeline
    const revisionAtStart = this.documentRevisions.get(uri) ?? 0;
    const promise = this.runUnifiedSemanticPipeline({
      uri,
      text,
      tree,
      editRanges,
      baseDiagnostics: syntaxDiags,
      revisionAtStart,
      plugin,
      langId,
      textDocument,
    }).catch((e) => {
      this.connection.console.error(`[runUnifiedSemanticPipeline] Failed for ${uri}: ${e?.message ?? e}`);
    });

    this.activeValidationPromises.set(uri, promise);
    promise.finally(() => {
      if (this.activeValidationPromises.get(uri) === promise) {
        this.activeValidationPromises.delete(uri);
      }
    });
  }

  public async runUnifiedSemanticPipeline(params: {
    uri: string;
    text: string;
    tree: any;
    editRanges?: Array<{ startByte: number; endByte: number }>;
    baseDiagnostics: Diagnostic[];
    revisionAtStart: number | null;
    plugin?: LanguagePlugin;
    langId: string;
    textDocument?: TextDocument;
  }): Promise<void> {
    const { uri, text, tree, editRanges, baseDiagnostics, revisionAtStart, plugin, langId, textDocument } = params;
    const newSemanticDiagnostics: Diagnostic[] = [];

    const isStale = () => {
      if (revisionAtStart !== null && (this.documentRevisions.get(uri) ?? 0) !== revisionAtStart) return true;
      return false;
    };
    const yieldToEventLoop = () => new Promise<void>((r) => setTimeout(r, 0));
    const yieldAndCheckStale = async () => {
      await yieldToEventLoop();
      return isStale();
    };

    try {
      const t0 = performance.now();
      const effectiveUri = uri.startsWith("modelscript-lib://global")
        ? "file://" + uri.substring("modelscript-lib://global".length)
        : uri;

      // ── Step 1: Re-index ─────────────────────────────────────────────────
      const wsIndex = plugin?.workspaceIndex ?? this.workspaceManager.getWorkspaceIndex(langId);
      const textChanged = this.lastIndexedText.get(effectiveUri) !== text;
      let changedIds: Set<number> | null = null;
      let changedNames: Set<string> | null = null;
      let structuralChangedIds: Set<number> | null = null;

      if (wsIndex) {
        if (textChanged) {
          let totalDelta = 0;
          let actualEditRanges = editRanges;
          if (!actualEditRanges) {
            const lastText = this.lastIndexedText.get(effectiveUri);
            if (lastText) {
              const edit = computeTreeEdit(lastText, text);
              actualEditRanges = [{ startByte: edit.startIndex, endByte: edit.newEndIndex }];
              totalDelta = edit.newEndIndex - edit.oldEndIndex;
            }
          }

          if (wsIndex.has(effectiveUri)) {
            wsIndex.markDirty(effectiveUri, () => tree.rootNode, actualEditRanges, totalDelta);
          } else {
            wsIndex.register(effectiveUri, () => tree.rootNode);
          }
          wsIndex.getFileIndex(effectiveUri);
          this.lastIndexedText.set(effectiveUri, text);
        }

        const changedIdsObj =
          typeof wsIndex.takeGlobalChangedIds === "function" ? wsIndex.takeGlobalChangedIds() : null;
        changedIds = changedIdsObj ? changedIdsObj.changedIds : null;
        structuralChangedIds = changedIdsObj ? (changedIdsObj as any).structuralChangedIds : null;
        changedNames = typeof wsIndex.takeGlobalChangedNames === "function" ? wsIndex.takeGlobalChangedNames() : null;
      }

      if (isStale()) return;

      // ── Step 2: Cross-File Revalidation Trigger ──────────────────────────
      if (changedNames && changedNames.size > 0) {
        if (this.revalidationTimer) clearTimeout(this.revalidationTimer);
        this.revalidationTimer = setTimeout(() => {
          for (const doc of this.documentManager.documents.all()) {
            const eff = doc.uri.startsWith("modelscript-lib://global")
              ? "file://" + doc.uri.substring("modelscript-lib://global".length)
              : doc.uri;
            if (eff !== effectiveUri) {
              this.validateTextDocument(doc);
            }
          }
        }, 500);
      }

      // ── Step 3: Unified Index & QueryEngine Update ───────────────────────
      const unifiedIndex = this.workspaceManager.unifiedWorkspace.toUnifiedPartial();
      const cstTreeWrapper = this.parserService.getSharedCstTreeWrapper();

      let engine = plugin?.queryEngine ?? this.workspaceManager.getQueryEngine(langId);
      if (!engine) {
        engine = this.createDefaultQueryEngine(langId, unifiedIndex, cstTreeWrapper);
        if (engine) {
          this.workspaceManager.setQueryEngine(langId, engine);
        }
      } else {
        if (langId === "modelica") {
          const injectFn = (globalThis as any).injectPredefinedTypes;
          if (typeof injectFn === "function") injectFn(unifiedIndex);
        }
        if (changedIds && typeof (engine as any).swapIndex === "function") {
          (engine as any).swapIndex(unifiedIndex, changedIds, structuralChangedIds || undefined);
        } else if (typeof (engine as any).updateIndex === "function") {
          (engine as any).updateIndex(unifiedIndex);
        }
        if (typeof (engine as any).updateTree === "function") {
          (engine as any).updateTree(cstTreeWrapper);
        }
      }

      // Sync parser sharedContext if Modelica
      const context = this.parserService.sharedContext;
      if (context && langId === "modelica") {
        if (typeof (context as any).setQueryEngine === "function") context.setQueryEngine(engine);
        else context.queryEngine = engine;
        if (typeof (context as any).setWorkspaceIndex === "function") context.setWorkspaceIndex(wsIndex);
        else context.workspaceIndex = wsIndex;
      }

      // Create / update LSP bridge
      const currentDoc = this.documentManager.documents.get(uri);
      const currentText = currentDoc ? currentDoc.getText() : text;
      const bridge = new LSPBridge(unifiedIndex, engine, new PositionIndex(currentText), uri);
      this.documentLSPBridges.set(uri, bridge as any);

      await yieldToEventLoop();
      if (isStale()) return;

      // ── Step 4: Preflight Cache Hydration ────────────────────────────────
      const resourceSymbolIds = unifiedIndex.symbolsByResource?.get(effectiveUri);
      const docSymbolCount = resourceSymbolIds ? resourceSymbolIds.length : 0;
      const isWorkspaceFile = !!this.documentManager.documents.get(uri);

      if (
        engine &&
        resourceSymbolIds &&
        resourceSymbolIds.length > 0 &&
        (engine as any).preflight &&
        !isWorkspaceFile &&
        docSymbolCount < 2000
      ) {
        try {
          await (engine as any).preflight(resourceSymbolIds, ["resolve", "members", "type_check"]);
        } catch {
          // Best-effort
        }
      }

      // ── Step 5: Declarative Lints ────────────────────────────────────────
      const hasError = typeof tree.rootNode.hasError === "function" ? tree.rootNode.hasError() : tree.rootNode.hasError;
      const hasSyntaxErrors = baseDiagnostics.length > 0 || hasError;

      if (hasSyntaxErrors) {
        const cachedSemantic = this.lastSemanticDiagnostics.get(uri) || [];
        newSemanticDiagnostics.push(...cachedSemantic);
      }

      const skipHeavyLints = (!isWorkspaceFile && docSymbolCount > 1000) || hasSyntaxErrors;
      if (!skipHeavyLints && engine && typeof (engine as any).runAllLintsAsync === "function") {
        const viewportRange = this.documentViewports.get(uri) ?? undefined;
        const engineDiags = await (engine as any).runAllLintsAsync(uri, yieldAndCheckStale, viewportRange);
        if (isStale()) return;

        for (const d of engineDiags) {
          const start = (bridge as any).positions.offsetToPosition(d.startByte);
          const end = (bridge as any).positions.offsetToPosition(d.endByte);
          let severity: DiagnosticSeverity = DiagnosticSeverity.Warning;
          if (d.severity === "error") severity = DiagnosticSeverity.Error;
          if (d.severity === "info") severity = DiagnosticSeverity.Information;
          newSemanticDiagnostics.push({
            severity,
            range: { start, end },
            message: d.message,
            source: plugin?.name ? plugin.name.toLowerCase() : "modelscript",
            code: d.code ?? d.lintName,
          });
        }
      }

      // ── Step 6: Domain Post-Validation Hooks ──────────────────────────────
      if (plugin?.customHandlers?.postValidate && textDocument) {
        await plugin.customHandlers.postValidate(textDocument, context, newSemanticDiagnostics);
      } else {
        if (langId === "owl2" && !hasSyntaxErrors) {
          await this.postValidateOwl2(effectiveUri, tree, text, newSemanticDiagnostics);
        } else if (langId === "sysml2") {
          if (!hasSyntaxErrors) {
            this.postValidateSysml2(effectiveUri, newSemanticDiagnostics);
          }
          this.checkAutoVerify(effectiveUri);
        }
      }

      const vDiags = this.verificationDiagnosticsByUri.get(uri) ?? this.verificationDiagnosticsByUri.get(effectiveUri);
      if (vDiags) {
        newSemanticDiagnostics.push(...vDiags);
      }

      // ── Step 7: Populate Class / Symbol Wrappers for Trees ───────────────
      this.populateClassWrappers(effectiveUri, uri, unifiedIndex, engine, context);

      // ── Step 8: Deliver Diagnostics and Notify UI ────────────────────────
      if (isStale()) return;
      this.lastSemanticDiagnostics.set(uri, newSemanticDiagnostics);
      const diagnostics = [...baseDiagnostics, ...newSemanticDiagnostics];
      if (diagnostics.length > 1000) diagnostics.length = 1000;
      this.connection.sendDiagnostics({ uri, diagnostics });
      this.connection.sendNotification("modelscript/projectTreeChanged");
    } catch (e: any) {
      this.connection.console.error(`[runUnifiedSemanticPipeline] Error for ${uri}: ${e.message}\n${e.stack}`);
      if (!isStale()) {
        const diagnostics = [...baseDiagnostics, ...newSemanticDiagnostics];
        if (diagnostics.length > 1000) diagnostics.length = 1000;
        this.connection.sendDiagnostics({ uri, diagnostics });
      }
    }
  }

  /**
   * Backward-compatible delegation for runSemanticPipeline.
   */
  public async runSemanticPipeline(
    uri: string,
    text: string,
    tree: any,
    editRanges: Array<{ startByte: number; endByte: number }> | undefined,
    baseDiagnostics: Diagnostic[],
    revisionAtStart: number | null,
    context: any,
  ): Promise<void> {
    const plugin = globalLanguageRegistry.getPluginForUri(uri);
    await this.runUnifiedSemanticPipeline({
      uri,
      text,
      tree,
      editRanges,
      baseDiagnostics,
      revisionAtStart,
      plugin,
      langId: plugin?.id ?? "modelica",
    });
  }

  private createDefaultQueryEngine(langId: string, unifiedIndex: any, cstTreeWrapper: any): QueryEngine {
    const plugin = globalLanguageRegistry.getPluginById(langId);
    const factory =
      plugin?.createQueryEngine ??
      (globalThis as any)[`create_${langId}_query_engine`] ??
      (globalThis as any)[`create${langId.charAt(0).toUpperCase() + langId.slice(1)}QueryEngine`];
    if (typeof factory === "function") {
      return factory(unifiedIndex, cstTreeWrapper) as any;
    }
    return new QueryEngine(unifiedIndex, cstTreeWrapper as any);
  }

  private validateSidecarDocument(textDocument: TextDocument): void {
    const context = this.parserService.sharedContext;
    if (!context) return;
    const text = textDocument.getText();
    const entity = {
      isClassInstance: true,
      jsSource: text,
      name: "",
      context,
      uri: textDocument.uri,
      instantiate() {},
    } as any;
    const filename = textDocument.uri.split("/").pop();
    if (filename) {
      entity.name = filename.replace(/\.[tj]s$/, "");
    }
    entity.instantiate();
    this.workspaceManager.workspaceInstances.set(textDocument.uri, [entity]);
    this.workspaceManager.documentInstances.set(textDocument.uri, [entity]);
    this.workspaceManager.documentContexts.set(textDocument.uri, context);
    this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
    this.connection.sendNotification("modelscript/projectTreeChanged");
  }

  private async validateStepDocument(textDocument: TextDocument, plugin?: LanguagePlugin): Promise<void> {
    const text = textDocument.getText();
    const buffer = new TextEncoder().encode(text);
    const stepDiagnostics: Diagnostic[] = [];

    try {
      this.connection.console.info(`[step] Validating ${textDocument.uri} (${text.length} chars)`);
      let astIndex;
      let tree;
      const stepParser = plugin?.parser ?? this.parserService.stepParser;
      if (stepParser) {
        tree = stepParser.parse(text);
        if (tree) {
          this.documentManager.documentTrees.set(textDocument.uri, { text, tree, classCache: new Map() });
          astIndex = { symbols: new Map(), byName: new Map(), childrenOf: new Map() } as any;
        }
      }

      const stepIndex = await this.workspaceManager.stepWorkspaceIndex.parseStepFile(
        textDocument.uri,
        buffer,
        astIndex,
      );

      const unifiedIndex = this.workspaceManager.unifiedWorkspace.toUnifiedPartial();
      if (this.workspaceManager.globalModelicaQueryEngine) {
        this.workspaceManager.globalModelicaQueryEngine.updateIndex(unifiedIndex);
      }
      if (this.workspaceManager.globalSysML2QueryEngine) {
        this.workspaceManager.globalSysML2QueryEngine.updateIndex(unifiedIndex);
      }

      if (!this.workspaceManager.globalStepQueryEngine) {
        this.workspaceManager.globalStepQueryEngine = new QueryEngine(unifiedIndex, {} as any);
      } else {
        this.workspaceManager.globalStepQueryEngine.updateIndex(unifiedIndex);
      }

      const engine = this.workspaceManager.globalStepQueryEngine;
      const bridge = new LSPBridge(unifiedIndex, engine, new PositionIndex(text), textDocument.uri);
      this.documentLSPBridges.set(textDocument.uri, bridge);

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
              message: node.isMissing ? "Missing syntax element" : "Syntax error",
              source: "step",
            });
          }
          const children = node.children || [];
          for (let i = 0; i < children.length; i++) {
            collectErrors(children[i]);
          }
        };
        collectErrors(tree.rootNode);
      }
    } catch (e: any) {
      this.connection.console.error(`[step] Error in STEP pipeline for ${textDocument.uri}: ${e.message}\n${e.stack}`);
    }

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

    this.lastSemanticDiagnostics.set(textDocument.uri, stepDiagnostics);
    this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: stepDiagnostics });
    this.connection.sendNotification("modelscript/projectTreeChanged");

    if (this.revalidationTimer) clearTimeout(this.revalidationTimer);
    this.revalidationTimer = setTimeout(() => {
      for (const doc of this.documentManager.documents.all()) {
        if (doc.uri !== textDocument.uri) {
          this.validateTextDocument(doc);
        }
      }
    }, 300);
  }

  private async postValidateOwl2(
    effectiveUri: string,
    tree: any,
    text: string,
    diagnostics: Diagnostic[],
  ): Promise<void> {
    try {
      const axioms = lowerCstToAxioms(tree.rootNode, text);
      const store = this.workspaceManager.unifiedWorkspace.owl2Store;
      store.setAxioms(effectiveUri, axioms);

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
                if (this.findRangeForIri(iri, effectiveUri)) {
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
              const range = this.findRangeForIri(targetIri, effectiveUri);
              if (range) {
                diagnostics.push({
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
          diagnostics.push({
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

  private postValidateSysml2(effectiveUri: string, diagnostics: Diagnostic[]): void {
    try {
      const versions = new Map<string, number>();
      versions.set("sysml2", this.workspaceManager.sysml2WorkspaceIndex.version);
      this.reasonerService.updateAndReason(versions);

      const consistency = this.reasonerService.reasoner.checkConsistency();
      if (!consistency.isConsistent) {
        for (const axiom of consistency.conflictingAxioms || []) {
          let targetIri: string | null = null;
          if (axiom.type === "SubClassOf") targetIri = axiom.subClassIri;
          else if (axiom.type === "ClassAssertion") targetIri = axiom.individualIri;
          else if ((axiom as any).iri) targetIri = (axiom as any).iri;

          if (targetIri) {
            const range = this.findRangeForIri(targetIri, effectiveUri);
            if (range) {
              diagnostics.push({
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
  }

  private checkAutoVerify(effectiveUri: string): void {
    if (this.workspaceManager.unifiedWorkspace) {
      try {
        const udb = this.workspaceManager.unifiedWorkspace.toUnifiedPartial();
        const docSymbolIds = udb.symbolsByResource?.get(effectiveUri);
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
          const verifyUri = effectiveUri;
          verificationTimer = setTimeout(() => {
            this.connection.console.log(`[auto-verify] Triggering verification for ${verifyUri}`);
            this.runVerificationForUri(verifyUri).catch(() => {});
          }, 1000);
        }
      } catch {
        // Ignore — auto-verify is best-effort
      }
    }
  }

  private populateClassWrappers(effectiveUri: string, uri: string, unifiedIndex: any, engine: any, context: any): void {
    const db = engine?.toQueryDB ? engine.toQueryDB() : null;
    if (!db) return;

    const thisDocInstances: any[] = [];
    const normUri = (u: string) => (u.startsWith("file://") ? u.substring(7) : u);
    const matchUri = normUri(effectiveUri);

    const resourceSymbolIds = unifiedIndex.symbolsByResource?.get(effectiveUri);
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
      const wrapper = {
        id,
        db,
        entry,
        name: entry.name ?? "",
        kind: entry.kind ?? "Class",
        classKind: (entry.metadata as any)?.classKind ?? "class",
        compositeName: entry.name ?? "",
        description: (entry.metadata as any)?.description ?? null,
        isClassInstance: true,
      };
      thisDocInstances.push(wrapper);
    }
    this.workspaceManager.workspaceInstances.set(uri, thisDocInstances);
    this.workspaceManager.documentInstances.set(uri, thisDocInstances);
    if (context) {
      this.workspaceManager.documentContexts.set(uri, context);
    }
  }

  private fallbackRegexValidation(textDocument: TextDocument): void {
    const text = textDocument.getText();
    const diagnostics: Diagnostic[] = [];
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

  async runVerificationForUri(uri: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const textDocument = this.documentManager.documents.get(uri);
      if (!textDocument) throw new Error("Document not found");

      if (activeVerification) activeVerification.abort();
      activeVerification = new AbortController();
      const signal = activeVerification.signal;

      const db = this.workspaceManager.unifiedWorkspace.toUnifiedPartial();
      const fileNodes = Array.from(db.symbols.values()).filter(
        (s: any) =>
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
            if ((entryUri.endsWith(".sysml") || entryUri.endsWith(".sysml2")) && this.parserService.sysml2Parser) {
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

      const sysmlFactory =
        (globalThis as any).createSysML2QueryEngine ??
        (globalThis as any).create_sysml2_query_engine ??
        globalLanguageRegistry.getPluginForLanguageIdOrUri("sysml2")?.createQueryEngine;
      const sysmlEngine = typeof sysmlFactory === "function" ? sysmlFactory(db, verifyCstTreeWrapper) : null;
      if (!sysmlEngine) return { ok: false };
      const sysmlDB = sysmlEngine.toQueryDB();
      const newDiagnostics: Diagnostic[] = [];
      const allResults: any[] = [];

      for (const verifyUsage of fileNodes) {
        if (signal.aborted) return { ok: false };

        const topo = sysmlDB.query("extractTopology", (verifyUsage as any).id) as any;
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
            const moFactory =
              (globalThis as any).createModelicaQueryEngine ??
              (globalThis as any).create_modelica_query_engine ??
              globalLanguageRegistry.getPluginForLanguageIdOrUri("modelica")?.createQueryEngine;
            if (typeof moFactory === "function") {
              targetEngine = moFactory(db, verifyCstTreeWrapper);
            }
          }
        }

        const targetDB = targetEngine
          ? (targetEngine as any).toQueryDB()
          : (this.workspaceManager.unifiedWorkspace as any).engine?.toQueryDB() || sysmlDB;
        const targetModel = {
          id: simTargetId,
          name: targetDB.symbol(simTargetId)?.name ?? "",
          compositeName: targetDB.symbol(simTargetId)?.name ?? "",
        };

        const context = this.parserService.sharedContext;
        if (!context) return { ok: false, error: "Context not initialized" };
        const flattenFn = (globalThis as any).flattenArenaFromInstance ?? flattenArenaFromInstance;
        if (typeof flattenFn !== "function") return { ok: false, error: "Flattener not available" };
        const arena = flattenFn(targetModel, context);

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
        const vResults = runner.verifyCase((verifyUsage as any).id, simResult);
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

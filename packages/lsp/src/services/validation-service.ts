// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-function, @typescript-eslint/prefer-for-of, @typescript-eslint/array-type, @typescript-eslint/no-non-null-assertion, no-empty */
// ts-check
import { Connection, Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DocumentManager } from "./DocumentManager.js";
import { ParserService } from "./ParserService.js";
import { WorkspaceManager } from "./WorkspaceManager.js";

import { getModelicaErrorCodeDef } from "@modelscript/modelica";
import { lowerCstToAxioms } from "@modelscript/owl2/cst-lowering";
import { QueryEngine, VerificationRunner } from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate";
import { parseStepReferences, STEP_SCHEMA } from "@modelscript/step";
import { LSPBridge, PositionIndex } from "../lsp-bridge.js";
import { ThreadDiagnosticsProvider } from "../providers/threadDiagnosticsProvider.js";
import { getArenaParameterInfo } from "../utils/arena-utils.js";
import { computeTreeEdit } from "../utils/ast-utils.js";
import { ReasonerService } from "./ReasonerService.js";

import { globalLanguageRegistry, type LanguagePlugin } from "../registry/LanguageRegistry.js";

let verificationTimer: any = undefined;
let activeVerification: any = undefined;
let flattenArenaFromInstance: any = undefined;

/**
 * Canonical error code information extracted from diagnostic code or lint name.
 */
export function extractCanonicalErrorInfo(
  code: string | number | undefined,
  lintName?: string,
  plugin?: any,
): { codeNum?: number; ruleName?: string; raw: string } {
  const raw = String(code ?? lintName ?? "").trim();
  if (!raw) return { raw: "" };

  if (typeof code === "number") {
    const def = plugin?.languageDef?.errorCodes?.[code] ?? getModelicaErrorCodeDef(code);
    const rule = def?.rule ? def.rule.toLowerCase().replace(/[-_]/g, "") : undefined;
    return { codeNum: code, ruleName: rule, raw };
  }

  const numMatch = /^M?(\d+)$/i.exec(raw);
  if (numMatch) {
    const num = Number(numMatch[1]);
    const def = plugin?.languageDef?.errorCodes?.[num] ?? getModelicaErrorCodeDef(num);
    const rule = def?.rule ? def.rule.toLowerCase().replace(/[-_]/g, "") : undefined;
    return { codeNum: num, ruleName: rule, raw };
  }

  // Rule name string
  const normalizedRule = raw.toLowerCase().replace(/[-_]/g, "");
  const def = getModelicaErrorCodeDef(raw);
  if (def) {
    return {
      codeNum: def.code,
      ruleName: def.rule ? def.rule.toLowerCase().replace(/[-_]/g, "") : normalizedRule,
      raw,
    };
  }

  return { ruleName: normalizedRule, raw };
}

/**
 * Deduplicate or merge a semantic diagnostic from Step 5b into the existing Step 5a diagnostics list.
 * Returns true if the diagnostic was merged or recognized as a duplicate.
 */
export function tryDeduplicateOrMergeSemanticDiagnostic(
  existingList: Diagnostic[],
  incoming: Diagnostic,
  plugin?: any,
): boolean {
  const incomingInfo = extractCanonicalErrorInfo(incoming.code, undefined, plugin);

  for (const existing of existingList) {
    // 1. Line match or overlap
    const sameLine = existing.range.start.line === incoming.range.start.line;
    const linesOverlap =
      Math.max(existing.range.start.line, incoming.range.start.line) <=
      Math.min(existing.range.end.line, incoming.range.end.line);

    if (!sameLine && !linesOverlap) continue;

    // 2. Code match
    const existingInfo = extractCanonicalErrorInfo(existing.code, undefined, plugin);
    const codesMatch =
      (existingInfo.codeNum !== undefined &&
        incomingInfo.codeNum !== undefined &&
        existingInfo.codeNum === incomingInfo.codeNum) ||
      (existingInfo.ruleName !== undefined &&
        incomingInfo.ruleName !== undefined &&
        existingInfo.ruleName === incomingInfo.ruleName) ||
      (existingInfo.raw.length > 0 &&
        incomingInfo.raw.length > 0 &&
        existingInfo.raw.toLowerCase() === incomingInfo.raw.toLowerCase());

    // 3. Horizontal range relationship
    const charOverlap =
      Math.max(existing.range.start.character, incoming.range.start.character) <=
      Math.min(existing.range.end.character, incoming.range.end.character);

    const charAdjacent =
      Math.abs(existing.range.start.character - incoming.range.start.character) <= 15 ||
      Math.abs(existing.range.end.character - incoming.range.end.character) <= 15;

    // 4. Duplicate decision
    let isMatch = false;
    if (codesMatch) {
      // If error codes match on the same line, it's the same error
      if (sameLine || charOverlap || charAdjacent) {
        isMatch = true;
      }
    } else if (charOverlap) {
      // Overlapping character range on the same line: check if messages are identical or share category
      if (existing.message === incoming.message) {
        isMatch = true;
      } else {
        const m1 = existing.message.toLowerCase();
        const m2 = incoming.message.toLowerCase();
        if (
          (m1.startsWith("type mismatch") && m2.startsWith("type mismatch")) ||
          (m1.startsWith("variable") && m2.startsWith("variable")) ||
          (m1.startsWith("duplicate") && m2.startsWith("duplicate")) ||
          (m1.startsWith("syntax error") && m2.startsWith("syntax error"))
        ) {
          isMatch = true;
        }
      }
    }

    if (isMatch) {
      // Merge / enrich existing diagnostic with incoming diagnostic details
      const existingIsGeneric =
        !existing.message ||
        existing.message.startsWith("Linter Rule ") ||
        existing.message.startsWith("Linter rule ") ||
        existing.message === "Syntax Error";

      const incomingIsSpecific =
        incoming.message &&
        !incoming.message.startsWith("Linter Rule ") &&
        !incoming.message.startsWith("Linter rule ");

      if (existingIsGeneric && incomingIsSpecific) {
        existing.message = incoming.message;
        existing.code = incoming.code ?? existing.code;
        existing.range = incoming.range;
      } else if (incomingIsSpecific && incoming.message.length > existing.message.length) {
        // Incoming Salsa diagnostic usually contains more specific details (e.g. types, scopes)
        existing.message = incoming.message;
        if (incoming.code) existing.code = incoming.code;
      }

      // Upgrade severity if incoming is higher
      if (incoming.severity === DiagnosticSeverity.Error) {
        existing.severity = DiagnosticSeverity.Error;
      }

      // If existing had a 1-character dummy range, take the better range
      if (
        existing.range.start.line === existing.range.end.line &&
        existing.range.end.character - existing.range.start.character <= 1 &&
        incoming.range.end.character - incoming.range.start.character > 1
      ) {
        existing.range = incoming.range;
      }

      return true; // Successfully deduplicated / merged
    }
  }

  return false;
}

/**
 * Clean deduplication pass over a list of diagnostics to remove exact or shadowed duplicates.
 */
export function deduplicateAllDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const result: Diagnostic[] = [];
  for (const d of diagnostics) {
    const isDup = result.some((existing, idx) => {
      const sameStart =
        existing.range.start.line === d.range.start.line && existing.range.start.character === d.range.start.character;
      const sameEnd =
        existing.range.end.line === d.range.end.line && existing.range.end.character === d.range.end.character;

      if (sameStart && sameEnd) {
        // 1. Exact range and message
        if (existing.message === d.message) {
          return true;
        }
        // 2. Exact range and code
        if (existing.code !== undefined && d.code !== undefined && String(existing.code) === String(d.code)) {
          return true;
        }
        // 3. Symmetrical generic syntax error shadowing
        const existingIsGeneric = existing.message === "Syntax Error" || existing.message === "Syntax error";
        const dIsGeneric = d.message === "Syntax Error" || d.message === "Syntax error";
        if (existingIsGeneric && !dIsGeneric) {
          result[idx] = d;
          return true;
        }
        if (!existingIsGeneric && dIsGeneric) {
          return true;
        }
      }

      // Same start position + same error code duplicate
      if (
        sameStart &&
        existing.code !== undefined &&
        d.code !== undefined &&
        String(existing.code) === String(d.code)
      ) {
        return true;
      }

      return false;
    });

    if (!isDup) {
      result.push(d);
    }
  }
  return result;
}

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
  public modelicaProofResultsByUri = new Map<string, Map<string, any>>();
  public modelicaDaeVerificationResultsByUri = new Map<string, Map<string, any>>();
  public reasonerDiagnosticsByUri = new Map<string, Diagnostic[]>();

  get dependenciesReady(): boolean {
    return this.declaredDependencies.every((dep) => this.loadedDependencies.has(`${dep.name}@${dep.version}`));
  }

  markDependencyLoaded(name: string, version: string): void {
    this.loadedDependencies.add(`${name}@${version}`);
    if (this.dependenciesReady) {
      (globalThis as any).clearDiagramCache?.();
      (globalThis as any).clearIconCache?.();
    }
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
    if (
      this.workspaceManager?.hypergraph &&
      typeof (this.workspaceManager.hypergraph as any).addListener === "function"
    ) {
      (this.workspaceManager.hypergraph as any).addListener((event: any) => {
        try {
          this.connection.sendNotification("modelscript/threadStatusChanged", event);
        } catch {}
      });
    }
  }

  public sendProjectTreeChanged(): void {
    if (globalThis.projectTreeChangedTimer) {
      globalThis.projectTreeChangedPending = true;
      return;
    }
    this.connection.sendNotification("modelscript/projectTreeChanged");
    globalThis.projectTreeChangedTimer = setTimeout(() => {
      globalThis.projectTreeChangedTimer = null;
      if (globalThis.projectTreeChangedPending) {
        globalThis.projectTreeChangedPending = false;
        this.connection.sendNotification("modelscript/projectTreeChanged");
      }
    }, 500);
  }

  /**
   * Adjusts line/column positions of cached semantic diagnostics during keystrokes,
   * preventing squiggles from displaying on wrong lines before asynchronous re-validation completes.
   */
  public adjustDiagnostics(
    uri: string,
    edit: {
      startPosition: { row: number; column: number };
      oldEndPosition: { row: number; column: number };
      newEndPosition: { row: number; column: number };
    },
  ): void {
    const cached = this.lastSemanticDiagnostics.get(uri);
    if (!cached || cached.length === 0) return;

    const startRow = edit.startPosition.row;
    const oldEndRow = edit.oldEndPosition.row;
    const newEndRow = edit.newEndPosition.row;
    const rowDelta = newEndRow - oldEndRow;
    const colDelta = edit.newEndPosition.column - edit.oldEndPosition.column;

    const adjusted: Diagnostic[] = [];
    for (const d of cached) {
      // 1. Diagnostic completely before the edit range — unaffected
      if (d.range.end.line < startRow) {
        adjusted.push(d);
        continue;
      }

      // 2. Diagnostic strictly after the edit range — shift rows
      if (d.range.start.line > oldEndRow) {
        adjusted.push({
          ...d,
          range: {
            start: { line: d.range.start.line + rowDelta, character: d.range.start.character },
            end: { line: d.range.end.line + rowDelta, character: d.range.end.character },
          },
        });
        continue;
      }

      // 3. Single-line edit on the same line as diagnostic
      if (startRow === oldEndRow && rowDelta === 0 && d.range.start.line === startRow) {
        if (d.range.start.character >= edit.oldEndPosition.column) {
          // Diagnostic is to the right of the edit point — shift columns
          adjusted.push({
            ...d,
            range: {
              start: { line: d.range.start.line, character: Math.max(0, d.range.start.character + colDelta) },
              end: { line: d.range.end.line, character: Math.max(0, d.range.end.character + colDelta) },
            },
          });
        } else if (d.range.end.character <= edit.startPosition.column) {
          // Diagnostic is to the left of the edit point — unaffected
          adjusted.push(d);
        }
        // If it intersects the edited token, drop it until revalidation completes
      }
    }

    this.lastSemanticDiagnostics.set(uri, adjusted);
  }

  /**
   * Purges cached state, diagnostics, revisions, and timers when a document is closed.
   */
  public disposeDocument(uri: string): void {
    const eff = uri.startsWith("modelscript-lib://global")
      ? "file://" + uri.substring("modelscript-lib://global".length)
      : uri;
    this.lastSemanticDiagnostics.delete(uri);
    this.lastSemanticDiagnostics.delete(eff);
    this.lastIndexedText.delete(uri);
    this.lastIndexedText.delete(eff);
    this.documentRevisions.delete(uri);
    this.documentRevisions.delete(eff);
    this.documentViewports.delete(uri);
    this.documentViewports.delete(eff);
    const timer = this.activeValidationTimers.get(uri);
    if (timer) {
      clearTimeout(timer);
      this.activeValidationTimers.delete(uri);
    }
    this.activeValidationPromises.delete(uri);
    this.activeValidationPromises.delete(eff);
  }

  /**
   * Collect syntax errors and lint diagnostics from the WASM parser.
   *
   * IMPORTANT: This is called synchronously right after parsing, while the WASM
   * input buffer still contains this document's text. The returned `wasmLintDiags`
   * must be captured here because the async semantic pipeline (Step 5a) cannot
   * safely re-call `getDiagnostics` — by that time another document may have been
   * parsed, overwriting the WASM input buffer and causing the linter to read
   * garbled text at the old CST byte offsets.
   */
  public collectSyntaxErrors(
    rootNode: any,
    textDocument: TextDocument,
    plugin?: LanguagePlugin,
  ): { syntaxDiags: Diagnostic[]; wasmLintDiags: any[] } {
    const t0 = performance.now();
    const syntaxDiags: Diagnostic[] = [];
    const wasmLintDiags: any[] = [];
    if (!rootNode) return { syntaxDiags, wasmLintDiags };

    // 1. Native WASM GLR parser diagnostics
    const facade = plugin?.facade ?? rootNode?.tree?.facade ?? this.parserService.facade;
    if (facade && typeof facade.getDiagnostics === "function") {
      try {
        const rootPtr = rootNode.id ?? rootNode.ptr ?? rootNode?.tree?.rootPtr ?? 0;
        if (rootPtr) {
          const docText = textDocument ? textDocument.getText() : (rootNode?.tree?.sourceCode ?? "");
          if (docText && typeof facade.loadSource === "function") {
            facade.loadSource(docText);
          }
          const wasmDiags = facade.getDiagnostics(rootPtr, 0, 0, docText);
          if (Array.isArray(wasmDiags)) {
            for (const d of wasmDiags) {
              const isSyntax = !d.code || d.code === "ERROR" || d.code === 1001 || d.code === 1002;
              if (isSyntax) {
                // Syntax Error
                let range = d.range;
                const startOff = d.startOffset ?? d.startCharOffset;
                const endOff = d.endOffset ?? d.endCharOffset;
                if (startOff !== undefined && endOff !== undefined) {
                  range = {
                    start: textDocument.positionAt(startOff),
                    end: textDocument.positionAt(endOff),
                  };
                }
                if (range.start.line === range.end.line && range.start.character === range.end.character) {
                  range = {
                    start: range.start,
                    end: { line: range.start.line, character: range.start.character + 1 },
                  };
                }
                syntaxDiags.push({
                  severity: DiagnosticSeverity.Error,
                  range,
                  message: d.message || "Syntax error",
                  source: plugin?.name ? plugin.name.toLowerCase() : "modelscript",
                });
              } else {
                // Lint diagnostics — capture now while WASM state is valid
                wasmLintDiags.push(d);
              }
            }
            return { syntaxDiags, wasmLintDiags };
          }
        }
      } catch (e) {
        this.connection.console.error(`[collectSyntaxErrors] error calling facade.getDiagnostics: ${e}`);
      }
    }

    // 2. Fallback: CST tree walk (only if native WASM parser diagnostics unavailable and root has error)
    const hasError = typeof rootNode.hasError === "function" ? rootNode.hasError() : rootNode.hasError;
    if (!hasError) return { syntaxDiags, wasmLintDiags };
    if (typeof rootNode.walk !== "function") return { syntaxDiags, wasmLintDiags };
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
        syntaxDiags.push({
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
        syntaxDiags.push({
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
        `[perf] this.collectSyntaxErrors took ${totalMs.toFixed(2)}ms for ${syntaxDiags.length} diagnostics`,
      );
    }
    return { syntaxDiags, wasmLintDiags };
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
          tree = parser.parse(
            processedText,
            oldCached.tree as never,
            edit.startIndex,
            edit.oldEndIndex,
            edit.newEndIndex,
            uri,
          );
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
        const facade = plugin?.facade ?? tree?.facade ?? tree?.rootNode?.tree?.facade ?? this.parserService.facade;
        if (facade && typeof facade.loadSource === "function") {
          facade.loadSource(text);
        }
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

    // 3. Collect syntax + lint diagnostics immediately (while WASM state is valid)
    const { syntaxDiags, wasmLintDiags } = this.collectSyntaxErrors(tree.rootNode, textDocument, plugin);
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
      wasmLintDiags,
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
    wasmLintDiags?: any[];
    revisionAtStart: number | null;
    plugin?: LanguagePlugin;
    langId: string;
    textDocument?: TextDocument;
  }): Promise<void> {
    const {
      uri,
      text,
      tree,
      editRanges,
      baseDiagnostics,
      wasmLintDiags,
      revisionAtStart,
      plugin,
      langId,
      textDocument,
    } = params;
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

          if (typeof wsIndex.has === "function") {
            if (wsIndex.has(effectiveUri)) {
              wsIndex.reindexDocument?.(effectiveUri, () => tree.rootNode, actualEditRanges, totalDelta);
            } else {
              wsIndex.register?.(effectiveUri, () => tree.rootNode);
            }
            wsIndex.getFileIndex?.(effectiveUri);
          }
          this.workspaceManager.workspaceInstances.delete(uri);
          this.workspaceManager.workspaceInstances.delete(effectiveUri);
          this.workspaceManager.documentInstances.delete(uri);
          this.workspaceManager.documentInstances.delete(effectiveUri);
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

      // ── Step 5: Declarative & CST Lints ────────────────────────────────────
      const hasError = typeof tree.rootNode.hasError === "function" ? tree.rootNode.hasError() : tree.rootNode.hasError;
      const hasSyntaxErrors = baseDiagnostics.length > 0 || hasError;

      if (hasSyntaxErrors) {
        const cachedSemantic = this.lastSemanticDiagnostics.get(uri) || [];
        newSemanticDiagnostics.push(...cachedSemantic);
      }

      // 5a. WASM Linear Memory CST Linter diagnostics (pre-collected synchronously in collectSyntaxErrors)
      // NOTE: We use the pre-collected wasmLintDiags instead of re-calling facade.getDiagnostics(rootPtr)
      // here because the WASM input buffer may have been overwritten by parsing another document
      // during the async yields above. Using a stale rootPtr with a different input buffer would
      // cause the linter to read garbled text at the old CST byte offsets.
      if (!hasSyntaxErrors && wasmLintDiags && wasmLintDiags.length > 0) {
        try {
          const pluginLints = plugin?.languageDef?.lints;
          const pluginSource = plugin?.name ? plugin.name.toLowerCase() : "modelscript";

          for (const d of wasmLintDiags) {
            // Resolve character offsets — prefer startOffset (new), fall back to startCharOffset (deprecated)
            const startOff = d.startOffset ?? d.startCharOffset;
            const endOff = d.endOffset ?? d.endCharOffset;

            // Compute range from character offsets
            let range = d.range;
            if (startOff !== undefined && endOff !== undefined) {
              if (bridge) {
                range = (bridge as any).positions.rangeFromOffsets(startOff, endOff);
              } else if (currentDoc) {
                range = {
                  start: currentDoc.positionAt(startOff),
                  end: currentDoc.positionAt(endOff),
                };
              }
            }
            if (!range) continue;

            // Ensure non-zero-width range
            if (range.start.line === range.end.line && range.start.character === range.end.character) {
              range = {
                start: range.start,
                end: { line: range.start.line, character: range.start.character + 1 },
              };
            }

            // Extract token text from character offsets
            const tokenText =
              startOff !== undefined && endOff !== undefined && endOff > startOff
                ? currentText.slice(startOff, endOff).trim()
                : "";

            // Determine message — use the WASM-provided message if available,
            // otherwise look up the lint rule or dynamic error code definition.
            let message = d.message;
            const code = d.code;
            let matchedLint: any = null;

            if (pluginLints && code) {
              for (const lint of Object.values(pluginLints)) {
                if ((lint as any)?.code === code) {
                  matchedLint = lint;
                  break;
                }
              }
            }

            const codeNum = typeof code === "number" ? code : typeof code === "string" ? Number(code) : undefined;
            const matchedCodeDef =
              codeNum !== undefined
                ? ((plugin?.languageDef?.errorCodes ? (plugin.languageDef.errorCodes as any)[codeNum] : undefined) ??
                  getModelicaErrorCodeDef(codeNum))
                : undefined;

            if (
              !message ||
              message.startsWith("Linter Rule ") ||
              message.startsWith("Linter rule ") ||
              message.startsWith("Syntax Error")
            ) {
              if (matchedLint && typeof matchedLint.message === "function") {
                try {
                  message = matchedLint.message({ text: tokenText }, { text: "" });
                } catch {
                  // Fallback
                }
              }

              if (!message || message.startsWith("Linter Rule ") || message.startsWith("Linter rule ")) {
                if (codeNum === 2001 || codeNum === 2002) {
                  message = tokenText ? `Variable '${tokenText}' not found in scope.` : "Variable not found in scope.";
                } else if (codeNum === 2003) {
                  message = tokenText
                    ? `Class or type '${tokenText}' not found in scope.`
                    : "Class or type not found in scope.";
                } else if (codeNum === 3001) {
                  message = tokenText
                    ? `Type mismatch in binding or modification expression '${tokenText}'.`
                    : "Type mismatch in binding.";
                } else if (codeNum === 3009) {
                  message = tokenText
                    ? `Array index '${tokenText}' has invalid type: expected Integer or Boolean.`
                    : "Invalid array index type.";
                } else if (codeNum === 4031) {
                  message = tokenText ? `Subscript '${tokenText}' is out of bounds.` : "Array index out of bounds.";
                } else if (codeNum === 5001) {
                  message = tokenText ? `Type mismatch in equation '${tokenText}'.` : "Type mismatch in equation.";
                } else if (codeNum === 5005) {
                  message = tokenText ? `Division by literal zero in '${tokenText}'.` : "Division by literal zero.";
                } else if (codeNum === 5006) {
                  message = tokenText
                    ? `Type mismatch in assignment in '${tokenText}'.`
                    : "Type mismatch in assignment.";
                } else if (matchedCodeDef) {
                  try {
                    const formatted = matchedCodeDef.message(tokenText || "");
                    if (formatted && !formatted.includes("undefined")) {
                      message = formatted;
                    }
                  } catch {
                    // Fallback
                  }
                  if (!message || message.startsWith("Linter Rule ") || message.startsWith("Linter rule ")) {
                    const ruleDisplay = matchedCodeDef.rule ? matchedCodeDef.rule.replace(/-/g, " ") : `rule ${code}`;
                    const capitalizedRule = ruleDisplay.charAt(0).toUpperCase() + ruleDisplay.slice(1);
                    message = tokenText ? `${capitalizedRule} for '${tokenText}'.` : `${capitalizedRule}.`;
                  }
                } else {
                  message = `Linter rule ${code}`;
                }
              }
            }

            // Determine severity dynamically
            let severity: DiagnosticSeverity = DiagnosticSeverity.Warning;
            const defSeverity = matchedCodeDef?.severity ?? matchedLint?.severity;

            if (d.severity === 1 || defSeverity === "error") {
              severity = DiagnosticSeverity.Error;
            } else if (defSeverity === "info") {
              severity = DiagnosticSeverity.Information;
            } else if (defSeverity === "warning") {
              severity = DiagnosticSeverity.Warning;
            } else if (typeof codeNum === "number" && codeNum >= 1000 && codeNum < 6000) {
              // Standard compiler error code numbering ranges (1xxx-5xxx)
              severity = DiagnosticSeverity.Error;
            }

            newSemanticDiagnostics.push({
              severity,
              range,
              message,
              source: pluginSource,
              code: code ?? d.lintName,
            });
          }
        } catch (e: any) {
          this.connection.console.warn(`[runUnifiedSemanticPipeline] CST linter error for ${uri}: ${e?.message ?? e}`);
        }
      }

      // 5b. Salsa QueryEngine symbol lints
      const skipHeavyLints = (!isWorkspaceFile && docSymbolCount > 1000) || hasSyntaxErrors;
      if (!skipHeavyLints && engine && typeof (engine as any).runAllLintsAsync === "function") {
        const viewportRange = this.documentViewports.get(uri) ?? undefined;
        const engineDiags = await (engine as any).runAllLintsAsync(effectiveUri, yieldAndCheckStale, viewportRange);
        if (isStale()) return;

        for (const d of engineDiags) {
          const startOff = d.startOffset ?? d.startByte;
          const endOff = d.endOffset ?? d.endByte;
          const start = (bridge as any).positions.charOffsetToPosition(startOff);
          const end = (bridge as any).positions.charOffsetToPosition(endOff);
          let severity: DiagnosticSeverity = DiagnosticSeverity.Warning;
          if (d.severity === "error") severity = DiagnosticSeverity.Error;
          if (d.severity === "info") severity = DiagnosticSeverity.Information;

          const diagCode = d.code ?? d.lintName;
          const incomingDiag: Diagnostic = {
            severity,
            range: { start, end },
            message: d.message,
            source: plugin?.name ? plugin.name.toLowerCase() : "modelscript",
            code: diagCode,
          };

          const isDuplicate = tryDeduplicateOrMergeSemanticDiagnostic(newSemanticDiagnostics, incomingDiag, plugin);

          if (!isDuplicate) {
            newSemanticDiagnostics.push(incomingDiag);
          }
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
        } else if (langId === "modelica" && !hasSyntaxErrors && textDocument) {
          await this.postValidateModelicaAbstractInterpretation(effectiveUri, textDocument, newSemanticDiagnostics);
          await this.postValidateModelicaDaeReachability(effectiveUri, textDocument, newSemanticDiagnostics);
          this.postValidateModelicaReasoner(effectiveUri, newSemanticDiagnostics);
        }
      }

      const vDiags = this.verificationDiagnosticsByUri.get(uri) ?? this.verificationDiagnosticsByUri.get(effectiveUri);
      if (vDiags) {
        newSemanticDiagnostics.push(...vDiags);
      }

      const rDiags = this.reasonerDiagnosticsByUri.get(uri) ?? this.reasonerDiagnosticsByUri.get(effectiveUri);
      if (rDiags && rDiags.length > 0) {
        for (const rd of rDiags) {
          if (
            !newSemanticDiagnostics.some(
              (d) =>
                d.range.start.line === rd.range.start.line &&
                d.range.start.character === rd.range.start.character &&
                d.message === rd.message,
            )
          ) {
            newSemanticDiagnostics.push(rd);
          }
        }
      }

      // Digital Thread Cross-Domain Diagnostics
      const threadDiags = this.collectThreadDiagnostics(effectiveUri, textDocument);
      if (threadDiags.length > 0) {
        newSemanticDiagnostics.push(...threadDiags);
      }

      // ── Step 7: Populate Class / Symbol Wrappers for Trees ───────────────
      this.populateClassWrappers(effectiveUri, uri, unifiedIndex, engine, context);

      // ── Step 8: Deliver Diagnostics and Notify UI ────────────────────────
      if (isStale()) return;
      this.lastSemanticDiagnostics.set(uri, newSemanticDiagnostics);
      const rawDiagnostics = [...baseDiagnostics, ...newSemanticDiagnostics];
      const diagnostics = deduplicateAllDiagnostics(rawDiagnostics);
      if (diagnostics.length > 1000) diagnostics.length = 1000;
      this.connection.sendDiagnostics({ uri, diagnostics });
      this.sendProjectTreeChanged();
    } catch (e: any) {
      this.connection.console.error(`[runUnifiedSemanticPipeline] Error for ${uri}: ${e.message}\n${e.stack}`);
      if (!isStale()) {
        const rawDiagnostics = [...baseDiagnostics, ...newSemanticDiagnostics];
        const diagnostics = deduplicateAllDiagnostics(rawDiagnostics);
        if (diagnostics.length > 1000) diagnostics.length = 1000;
        this.connection.sendDiagnostics({ uri, diagnostics });
      }
    }
  }

  public collectThreadDiagnostics(uri: string, textDocument?: TextDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (!this.workspaceManager) return diagnostics;

    const threadEntries = this.workspaceManager.getThreadsForUri(uri);
    if (!threadEntries || threadEntries.length === 0) return diagnostics;

    const text = textDocument ? textDocument.getText() : "";

    for (const entry of threadEntries) {
      const { slot, record, meta, domain } = entry;
      const alignedElements = this.workspaceManager.findAlignedElementsBySlot(slot);
      const conflict =
        typeof (this.workspaceManager.hypergraph as any).getConflict === "function"
          ? (this.workspaceManager.hypergraph as any).getConflict(slot)
          : undefined;

      const threadDiags = ThreadDiagnosticsProvider.diagnoseThread(
        record?.id ?? slot,
        alignedElements,
        0.05,
        conflict,
        domain,
      );

      for (const td of threadDiags) {
        if (td.domain.toLowerCase() !== domain.toLowerCase()) continue;

        let startLine = Math.max(0, (td.line || meta.line || 1) - 1);
        let startCol = Math.max(0, (td.column || meta.column || 1) - 1);
        let len = td.length || meta.length || (meta.name ? meta.name.length : 8);

        // If textDocument is provided and variable name is found, match exact token position if possible
        if (text && td.elementName) {
          const varBase = td.elementName.split(".").pop() || td.elementName;
          const lineOffsets = text.split("\n");
          if (startLine < lineOffsets.length) {
            const lineStr = lineOffsets[startLine] || "";
            const idx = lineStr.indexOf(varBase);
            if (idx >= 0) {
              startCol = idx;
              len = varBase.length;
            }
          }
        }

        diagnostics.push({
          range: {
            start: { line: startLine, character: startCol },
            end: { line: startLine, character: startCol + len },
          },
          severity:
            td.severity === "error"
              ? DiagnosticSeverity.Error
              : td.severity === "info"
                ? DiagnosticSeverity.Information
                : DiagnosticSeverity.Warning,
          code: td.code || "THREAD_CONFLICT",
          source: td.source || "modelscript-digital-thread",
          message: td.message,
          data: {
            threadId: td.threadId ?? record?.id ?? slot,
            slot,
            elementName: td.elementName,
            sourceDomain: td.sourceDomain,
            sourceValue: td.sourceValue,
            targetDomain: td.targetDomain,
            targetValue: td.targetValue,
            simplexConsensus: td.simplexConsensus,
            unit: td.unit,
            alignedElements,
          },
        });
      }
    }

    return diagnostics;
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
    const norm = langId.toLowerCase();
    const plugin = globalLanguageRegistry.getPluginById(norm);
    const factory =
      plugin?.createQueryEngine ??
      (globalThis as any)[`create_${norm}_query_engine`] ??
      (globalThis as any)[`create${norm.charAt(0).toUpperCase() + norm.slice(1)}QueryEngine`];
    if (typeof factory === "function") {
      return factory(unifiedIndex, cstTreeWrapper) as any;
    }
    return new QueryEngine(unifiedIndex, new Map(), { tree: cstTreeWrapper });
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
    this.sendProjectTreeChanged();
  }

  private async validateStepDocument(textDocument: TextDocument, plugin?: LanguagePlugin): Promise<void> {
    const text = textDocument.getText();
    const buffer = new TextEncoder().encode(text);
    const stepDiagnostics: Diagnostic[] = [];

    try {
      this.connection.console.info(`[step] Validating ${textDocument.uri} (${text.length} chars)`);
      let astIndex;
      let tree;
      const stepParser = plugin?.parser ?? this.parserService.getParser("step");
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
    this.sendProjectTreeChanged();

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
      const store = this.workspaceManager?.unifiedWorkspace?.owl2Store;
      if (store && typeof store.setAxioms === "function") {
        store.setAxioms(effectiveUri, axioms);
      }

      const versions = new Map<string, number>();
      const mIndex = this.workspaceManager.getWorkspaceIndex?.("modelica");
      if (mIndex) versions.set("modelica", mIndex.version);
      const sIndex = this.workspaceManager.getWorkspaceIndex?.("sysml2");
      if (sIndex) versions.set("sysml2", sIndex.version);

      if (store?.axioms && typeof this.reasonerService?.reasoner?.loadOntology === "function") {
        this.reasonerService.reasoner.loadOntology(store.axioms);
      }

      const consistency = this.reasonerService?.updateAndReason
        ? this.reasonerService.updateAndReason(versions)
        : this.reasonerService?.reasoner?.checkConsistency();

      this.routeReasonerDiagnostics(effectiveUri, consistency, diagnostics, "owl2-reasoner");
    } catch (reasonerError: any) {
      this.connection.console.error(`[owl2-reasoner] Reasoner failed: ${reasonerError.message}`);
    }
  }

  private postValidateSysml2(effectiveUri: string, diagnostics: Diagnostic[]): void {
    try {
      const versions = new Map<string, number>();
      const sysml2Index = this.workspaceManager.getWorkspaceIndex?.("sysml2");
      if (sysml2Index) versions.set("sysml2", sysml2Index.version);

      const consistency = this.reasonerService?.updateAndReason
        ? this.reasonerService.updateAndReason(versions)
        : this.reasonerService?.reasoner?.checkConsistency();

      this.routeReasonerDiagnostics(effectiveUri, consistency, diagnostics, "sysml2-reasoner");
    } catch (e: any) {
      this.connection.console.error(`[sysml2-reasoner] Update failed: ${e.message}`);
    }
  }

  private postValidateModelicaReasoner(effectiveUri: string, diagnostics: Diagnostic[]): void {
    try {
      const store = this.workspaceManager?.unifiedWorkspace?.owl2Store;
      if (!store || !store.axioms || store.axioms.length === 0) return;

      const versions = new Map<string, number>();
      const mIndex = this.workspaceManager.getWorkspaceIndex?.("modelica");
      if (mIndex) versions.set("modelica", mIndex.version);

      const consistency = this.reasonerService?.updateAndReason
        ? this.reasonerService.updateAndReason(versions)
        : this.reasonerService?.reasoner?.checkConsistency();

      this.routeReasonerDiagnostics(effectiveUri, consistency, diagnostics, "modelica-reasoner");
    } catch (e: any) {
      this.connection.console.error(`[modelica-reasoner] Update failed: ${e.message}`);
    }
  }

  private routeReasonerDiagnostics(
    currentUri: string,
    consistency: any,
    currentSemanticDiagnostics: Diagnostic[],
    source: string,
  ): void {
    if (!consistency) return;

    const newDiagsByUri = new Map<string, Diagnostic[]>();

    if (!consistency.isConsistent) {
      const explanation = consistency.explanation || "Ontology inconsistency detected";
      const candidateAxioms: any[] = [];
      if (consistency.minimalConflictCore && consistency.minimalConflictCore.length > 0) {
        candidateAxioms.push(...consistency.minimalConflictCore);
      }
      if (consistency.conflictingAxioms && consistency.conflictingAxioms.length > 0) {
        candidateAxioms.push(...consistency.conflictingAxioms);
      }

      const targetIris: string[] = [];
      for (const axiom of candidateAxioms) {
        if (axiom.type === "SubClassOf") {
          if (axiom.subClassIri) targetIris.push(axiom.subClassIri);
          if (axiom.superClassIri) targetIris.push(axiom.superClassIri);
        } else if (axiom.type === "DisjointClasses") {
          if (axiom.subClassIri) targetIris.push(axiom.subClassIri);
          if (Array.isArray(axiom.classIris)) targetIris.push(...axiom.classIris);
        } else if (axiom.type === "ClassAssertion") {
          if (axiom.individualIri) targetIris.push(axiom.individualIri);
          if (axiom.classIri) targetIris.push(axiom.classIri);
        } else if (axiom.type === "EquivalentClasses") {
          if (Array.isArray(axiom.classIris)) targetIris.push(...axiom.classIris);
        } else if (axiom.type === "ObjectPropertyAssertion") {
          if (axiom.subjectIri) targetIris.push(axiom.subjectIri);
          if (axiom.objectIri) targetIris.push(axiom.objectIri);
          if (axiom.propertyIri) targetIris.push(axiom.propertyIri);
        } else if (axiom.iri) {
          targetIris.push(axiom.iri);
        }
      }

      const seenRangesByUri = new Map<string, Set<string>>();

      const addDiag = (locUri: string, range: any) => {
        if (!locUri || !range) return;
        let uriSeen = seenRangesByUri.get(locUri);
        if (!uriSeen) {
          uriSeen = new Set<string>();
          seenRangesByUri.set(locUri, uriSeen);
        }
        const rangeKey = `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
        if (!uriSeen.has(rangeKey)) {
          uriSeen.add(rangeKey);
          let uriDiags = newDiagsByUri.get(locUri);
          if (!uriDiags) {
            uriDiags = [];
            newDiagsByUri.set(locUri, uriDiags);
          }
          const msgPrefix =
            locUri.endsWith(".owl") || locUri.endsWith(".ofn") || locUri.endsWith(".ttl")
              ? "Ontology inconsistency: "
              : "Logical contradiction: ";
          uriDiags.push({
            severity: DiagnosticSeverity.Error,
            range,
            message: `${msgPrefix}${explanation}`,
            source,
          });
        }
      };

      const candidateUris = new Set<string>([currentUri, ...this.documentManager.documents.keys()]);

      const store = this.workspaceManager?.unifiedWorkspace?.owl2Store;
      if (store && (store as any)._axiomsBySource) {
        for (const k of (store as any)._axiomsBySource.keys()) {
          if (k.includes(":") || k.includes("/")) {
            candidateUris.add(k);
          }
        }
      }

      for (const targetIri of targetIris) {
        const declLoc = this.findDeclarationLocation(targetIri);
        if (declLoc) {
          addDiag(declLoc.uri, declLoc.range);
        }

        for (const cUri of candidateUris) {
          const r = this.findRangeForIri(targetIri, cUri);
          if (r) {
            addDiag(cUri, r);
          }
        }
      }

      if (store && (store as any)._axiomsBySource) {
        for (const [sourceKey, sourceAxioms] of (store as any)._axiomsBySource.entries()) {
          if (sourceKey.includes(":") || sourceKey.includes("/")) {
            const hasConflict = sourceAxioms.some((sa: any) =>
              candidateAxioms.some(
                (ca: any) =>
                  ca.type === sa.type &&
                  (ca.type === "DisjointClasses"
                    ? Array.isArray(ca.classIris) &&
                      Array.isArray(sa.classIris) &&
                      ca.classIris.every((i: string) => sa.classIris.includes(i))
                    : ca.subClassIri === sa.subClassIri && ca.superClassIri === sa.superClassIri),
              ),
            );
            if (hasConflict) {
              let r: any = null;
              const doc = this.documentManager.documents.get(sourceKey);
              if (doc) {
                const text = doc.getText();
                const idx = text.indexOf("DisjointClasses");
                if (idx !== -1) {
                  r = {
                    start: doc.positionAt(idx),
                    end: doc.positionAt(idx + "DisjointClasses".length),
                  };
                }
              }
              if (!r && candidateAxioms[0]?.classIris?.[0]) {
                r = this.findRangeForIri(candidateAxioms[0].classIris[0], sourceKey);
              }
              if (r) {
                addDiag(sourceKey, r);
              }
            }
          }
        }
      }

      const isOwlFile = currentUri.endsWith(".owl") || currentUri.endsWith(".ofn") || currentUri.endsWith(".ttl");
      if (isOwlFile && (!newDiagsByUri.has(currentUri) || (newDiagsByUri.get(currentUri)?.length ?? 0) === 0)) {
        let fallbackRange = {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        };
        const doc = this.documentManager.documents.get(currentUri);
        if (doc) {
          const docText = doc.getText();
          const ontologyIdx = docText.indexOf("Ontology(");
          if (ontologyIdx !== -1) {
            fallbackRange = {
              start: doc.positionAt(ontologyIdx),
              end: doc.positionAt(ontologyIdx + "Ontology(".length),
            };
          }
        }
        let uriDiags = newDiagsByUri.get(currentUri);
        if (!uriDiags) {
          uriDiags = [];
          newDiagsByUri.set(currentUri, uriDiags);
        }
        uriDiags.push({
          severity: DiagnosticSeverity.Error,
          range: fallbackRange,
          message: `Ontology inconsistency: ${explanation}`,
          source,
        });
      }
    }

    const allKnownUris = new Set<string>([...this.reasonerDiagnosticsByUri.keys(), ...newDiagsByUri.keys()]);

    for (const uri of allKnownUris) {
      const newDiags = newDiagsByUri.get(uri) || [];
      if (newDiags.length === 0) {
        const hadPrevious = this.reasonerDiagnosticsByUri.has(uri);
        this.reasonerDiagnosticsByUri.delete(uri);
        if (hadPrevious && uri !== currentUri) {
          const base = (this.lastSemanticDiagnostics.get(uri) || []).filter((d) => !d.source?.includes("reasoner"));
          this.lastSemanticDiagnostics.set(uri, base);
          this.connection.sendDiagnostics({ uri, diagnostics: base });
        }
      } else {
        this.reasonerDiagnosticsByUri.set(uri, newDiags);
        if (uri === currentUri) {
          currentSemanticDiagnostics.push(...newDiags);
        } else {
          const existing = (this.lastSemanticDiagnostics.get(uri) || []).filter((d) => !d.source?.includes("reasoner"));
          const merged = deduplicateAllDiagnostics([...existing, ...newDiags]);
          this.lastSemanticDiagnostics.set(uri, merged);
          this.connection.sendDiagnostics({ uri, diagnostics: merged });
        }
      }
    }
  }

  public async postValidateModelicaAbstractInterpretation(
    effectiveUri: string,
    textDocument: TextDocument,
    diagnostics: Diagnostic[],
  ): Promise<void> {
    try {
      const text = textDocument.getText();
      if (!/\balgorithm\b/.test(text)) return;

      const { ModelicaAlgorithmAnalyzer, ModelicaCFGLowerer, findCstNodesByType } =
        await import("@modelscript/modelica");

      const proofMap = new Map<string, any>();
      this.modelicaProofResultsByUri.set(effectiveUri, proofMap);

      // Match class / function / block / model definitions with algorithms
      const funcRegex = /\b(function|block|model|class)\s+([a-zA-Z_][a-zA-Z0-9_]*)([\s\S]*?)\bend\s+\2\s*;/g;
      let match: RegExpExecArray | null;

      const cached = this.documentCache?.get(effectiveUri);

      while ((match = funcRegex.exec(text)) !== null) {
        const kind = match[1]!;
        const name = match[2]!;
        const body = match[3]!;

        const algMatch = /\b(?:initial\s+)?algorithm\b([\s\S]*)$/.exec(body);
        if (!algMatch) continue;

        const algText = algMatch[0];
        const algOffset = match.index + match[0].indexOf(algText);

        // Extract declared variables from the definition body
        const variables: any[] = [];
        const varDeclRegex =
          /\b(input|output)?\s*(Real|Integer|Boolean|String)\s+(?:\[(.*?)\]\s+)?([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*=\s*([^;]+))?\s*;/g;
        let vMatch: RegExpExecArray | null;
        while ((vMatch = varDeclRegex.exec(body)) !== null) {
          const io = vMatch[1];
          const type = vMatch[2];
          const dimStr = vMatch[3];
          const vName = vMatch[4]!;
          const initExpr = vMatch[5];

          const isArray = Boolean(dimStr);
          const arrayDimension = dimStr && /^\d+$/.test(dimStr.trim()) ? Number(dimStr.trim()) : undefined;

          let initialBound: [number, number] | undefined = undefined;
          if (initExpr && /^-?\d+(?:\.\d+)?$/.test(initExpr.trim())) {
            const val = Number(initExpr.trim());
            initialBound = [val, val];
          }

          variables.push({
            name: vName,
            type,
            isInput: io === "input",
            isOutput: io === "output",
            isArray,
            arrayDimension,
            initialBound,
          });
        }

        let statements: any[] = [];
        if (cached?.tree?.rootNode && findCstNodesByType) {
          const classNodes = findCstNodesByType(cached.tree.rootNode, "class_definition");
          const classNode = classNodes.find((cn: any) => {
            const idNode = findCstNodesByType(cn, "identifier")[0];
            return idNode?.text?.trim() === name;
          });
          if (classNode) {
            const algSections = findCstNodesByType(classNode, "algorithm_section");
            if (algSections.length > 0) {
              statements = ModelicaCFGLowerer.extractStatementsFromCst(algSections[0], algOffset);
            }
          }
        }
        if (statements.length === 0) {
          statements = ModelicaCFGLowerer.parseStatements(algText, algOffset);
        }
        if (statements.length === 0) continue;

        const result = ModelicaAlgorithmAnalyzer.analyze(statements, variables, {
          functionName: name,
        });

        proofMap.set(name, result);

        // Map proof results to 4-color LSP diagnostics
        // 1. Definite Bugs (Red)
        for (const bug of result.definiteBugs) {
          const bugStart = (bug as any).startOffset ?? bug.startByte ?? algOffset;
          const bugEnd = (bug as any).endOffset ?? bug.endByte ?? bugStart + 10;
          const startPos = textDocument.positionAt(bugStart);
          const endPos = textDocument.positionAt(bugEnd);

          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: { start: startPos, end: endPos },
            message: `[Formal Proof Defect] ${bug.description}`,
            source: "modelscript-prover",
            code: bug.category,
          });
        }

        // 2. Potential Bugs / Warnings (Orange)
        for (const warn of result.potentialBugs) {
          const warnStart = (warn as any).startOffset ?? warn.startByte ?? algOffset;
          const warnEnd = (warn as any).endOffset ?? warn.endByte ?? warnStart + 10;
          const startPos = textDocument.positionAt(warnStart);
          const endPos = textDocument.positionAt(warnEnd);

          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: { start: startPos, end: endPos },
            message: `[Formal Proof Unproven] ${warn.description}. Consider adding an invariant assertion.`,
            source: "modelscript-prover",
            code: warn.category,
          });
        }
      }
    } catch (err: any) {
      this.connection?.console?.error?.(`[modelica-prover] Error in abstract interpretation: ${err?.message}`);
    }
  }

  public async postValidateModelicaDaeReachability(
    effectiveUri: string,
    textDocument: TextDocument,
    diagnostics: Diagnostic[],
  ): Promise<void> {
    try {
      const text = textDocument.getText();
      if (!/\bequation\b/.test(text) && !/\bmodel\b|\bblock\b|\bclass\b/.test(text)) return;

      const {
        DAEBuilder,
        DaeBltReachabilityEngine,
        HybridModeConsistencyVerifier,
        performBltTransformationArena,
        initBltWasm,
        BinOp,
        EqKind,
        ExprKind,
        UnaryOp,
        Variability,
        VarType,
      } = await import("@modelscript/runtime");

      const daeMap = new Map<string, any>();
      this.modelicaDaeVerificationResultsByUri.set(effectiveUri, daeMap);

      const classRegex = /\b(model|block|class)\s+([a-zA-Z_][a-zA-Z0-9_]*)([\s\S]*?)\bend\s+\2\s*;/g;
      let match: RegExpExecArray | null;

      while ((match = classRegex.exec(text)) !== null) {
        const name = match[2]!;
        const body = match[3]!;
        const classOffset = match.index;

        if (!/\bequation\b/.test(body)) continue;

        let arena: any;
        const flattenFn = (globalThis as any).flattenArenaFromInstance ?? flattenArenaFromInstance;
        const context = this.parserService?.sharedContext;
        if (typeof flattenFn === "function" && context) {
          try {
            arena = flattenFn({ name }, context);
          } catch {
            // fallback
          }
        }

        if (!arena) {
          arena = this.extractLightweightDaeArena(
            body,
            DAEBuilder,
            EqKind,
            ExprKind,
            BinOp,
            UnaryOp,
            Variability,
            VarType,
          );
        }
        if (!arena || arena.eqCount === 0) continue;

        let bltResult: any;
        try {
          await initBltWasm();
          bltResult = performBltTransformationArena(arena);
        } catch {
          const blocks = [];
          for (let e = 0; e < arena.eqCount; e++) {
            blocks.push({ eqIdxs: [e], vars: [Math.min(e, arena.varCount - 1)] });
          }
          bltResult = { sortedEquations: blocks.map((_, i) => i), blocks };
        }

        const reachEngine = new DaeBltReachabilityEngine(arena);
        const reachSummary = reachEngine.verify(bltResult);

        const hybridVerifier = new HybridModeConsistencyVerifier(arena);
        const hybridResult = hybridVerifier.verify();

        const allIssues = [...reachSummary.issues, ...hybridResult.issues];

        const namedBounds = new Map<string, any>();
        for (let i = 0; i < arena.varCount; i++) {
          const vName = arena.getVarName(i);
          const bound = reachSummary.variableBounds.get(i) ?? reachEngine.evaluator.getVarBound(i);
          if (vName && bound && !bound.isTop?.() && !bound.isBottom?.()) {
            namedBounds.set(vName, bound);
          }
        }

        daeMap.set(name, {
          isFullyCertified: reachSummary.isFullyCertified && hybridResult.isCertifiedConsistent,
          reachSummary,
          hybridResult,
          issues: allIssues,
          variableBounds: namedBounds,
        });

        for (const issue of allIssues) {
          let issueOffset = classOffset;
          if (issue.varName && body.includes(issue.varName)) {
            issueOffset = classOffset + body.indexOf(issue.varName);
          } else {
            const eqMatch = /\bequation\b/.exec(body);
            if (eqMatch) {
              issueOffset = classOffset + eqMatch.index;
            }
          }

          const startPos = textDocument.positionAt(issueOffset);
          const endPos = textDocument.positionAt(issueOffset + (issue.varName?.length ?? 10));

          if (issue.severity === "definite") {
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: { start: startPos, end: endPos },
              message: `[DAE Formal Defect] ${issue.message}`,
              source: "modelscript-dae-verifier",
              code: issue.kind,
            });
          } else {
            diagnostics.push({
              severity: DiagnosticSeverity.Warning,
              range: { start: startPos, end: endPos },
              message: `[DAE Invariant Warning] ${issue.message}`,
              source: "modelscript-dae-verifier",
              code: issue.kind,
            });
          }
        }
      }
    } catch (err: any) {
      this.connection?.console?.error?.(`[modelica-dae-verifier] Error in DAE verification: ${err?.message}`);
    }
  }

  private extractLightweightDaeArena(
    body: string,
    DAEBuilder: any,
    EqKind: any,
    ExprKind: any,
    BinOp: any,
    _UnaryOp: any,
    Variability: any,
    VarType: any,
  ): any {
    const arena = new DAEBuilder();

    const varDeclRegex =
      /\b(parameter|constant)?\s*(Real|Integer|Boolean)\s+(?:\[(.*?)\]\s+)?([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*\((.*?)\))?(?:\s*=\s*([^;]+))?\s*;/g;
    let vMatch: RegExpExecArray | null;
    while ((vMatch = varDeclRegex.exec(body)) !== null) {
      const variabilityStr = vMatch[1];
      const typeStr = vMatch[2];
      const nameStr = vMatch[4]!;
      const attrsStr = vMatch[5];
      const initExprStr = vMatch[6];

      let varType = VarType.Real;
      if (typeStr === "Integer") varType = VarType.Integer;
      else if (typeStr === "Boolean") varType = VarType.Boolean;

      let variability = Variability.Continuous;
      if (variabilityStr === "parameter") variability = Variability.Parameter;
      else if (variabilityStr === "constant") variability = Variability.Constant;

      const vIdx = arena.addVariable(nameStr, varType, variability);

      if (attrsStr) {
        const minMatch = /\bmin\s*=\s*(-?\d+(?:\.\d+)?)/.exec(attrsStr);
        if (minMatch) {
          arena.setVarAttr(vIdx, "min", arena.addRealLiteral(Number(minMatch[1])));
        }
        const maxMatch = /\bmax\s*=\s*(-?\d+(?:\.\d+)?)/.exec(attrsStr);
        if (maxMatch) {
          arena.setVarAttr(vIdx, "max", arena.addRealLiteral(Number(maxMatch[1])));
        }
        const startMatch = /\bstart\s*=\s*(-?\d+(?:\.\d+)?)/.exec(attrsStr);
        if (startMatch) {
          arena.setVarStartValue(vIdx, Number(startMatch[1]));
        }
      }

      if (initExprStr) {
        const val = Number(initExprStr.trim());
        if (Number.isFinite(val)) {
          arena.setVarStartValue(vIdx, val);
        }
      }
    }

    const eqMatch = /\bequation\b([\s\S]*)$/.exec(body);
    if (!eqMatch) return arena;

    const eqSection = eqMatch[1]!;

    const parseExpr = (exprStr: string): number => {
      const s = exprStr.trim();
      if (!s) return -1;

      if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(s)) {
        return arena.addRealLiteral(Number(s));
      }

      const derMatch = /^der\((.*?)\)$/.exec(s);
      if (derMatch) {
        const inner = parseExpr(derMatch[1]!);
        return arena.addExpression(ExprKind.Der, inner);
      }

      const sqrtMatch = /^sqrt\((.*?)\)$/.exec(s);
      if (sqrtMatch) {
        const inner = parseExpr(sqrtMatch[1]!);
        return arena.addCallExpr(arena.interner.intern("sqrt"), [inner]);
      }

      const binOps = [
        { op: "+", kind: BinOp.Add },
        { op: "-", kind: BinOp.Sub },
        { op: "*", kind: BinOp.Mul },
        { op: "/", kind: BinOp.Div },
        { op: "<=", kind: BinOp.Lte },
        { op: ">=", kind: BinOp.Gte },
        { op: "<", kind: BinOp.Lt },
        { op: ">", kind: BinOp.Gt },
      ];

      for (const b of binOps) {
        const opIdx = s.lastIndexOf(b.op);
        if (opIdx > 0 && opIdx < s.length - 1) {
          const leftStr = s.slice(0, opIdx).trim();
          const rightStr = s.slice(opIdx + b.op.length).trim();
          if (leftStr && rightStr) {
            const leftExpr = parseExpr(leftStr);
            const rightExpr = parseExpr(rightStr);
            return arena.addBinaryExpr(b.kind, leftExpr, rightExpr);
          }
        }
      }

      let vIdx = arena.getVarIdxByName(s);
      if (vIdx < 0) {
        vIdx = arena.addVariable(s, VarType.Real, Variability.Continuous);
      }
      return arena.addExpression(ExprKind.Name, arena.interner.intern(s));
    };

    const rawStmts = eqSection.split(";");
    for (let rawStmt of rawStmts) {
      rawStmt = rawStmt.trim();
      if (!rawStmt || rawStmt.startsWith("//")) continue;

      const whenMatch = /\bwhen\s+(.*?)\s+then\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.*?)\s*(?:;\s*)?end\s+when/s.exec(
        rawStmt,
      );
      if (whenMatch) {
        const condExpr = parseExpr(whenMatch[1]!);
        const targetName = whenMatch[2]!;
        const valExpr = parseExpr(whenMatch[3]!);
        const whenIdx = arena.addWhenEquation(condExpr);
        let targetIdx = arena.getVarIdxByName(targetName);
        if (targetIdx < 0) targetIdx = arena.addVariable(targetName, VarType.Real, Variability.Continuous);
        const targetExpr = arena.addExpression(ExprKind.Name, arena.interner.intern(targetName));
        arena.addWhenBodyEquation(whenIdx, EqKind.Simple, targetExpr, valExpr);
        continue;
      }

      const eqParts = rawStmt.split("=");
      if (eqParts.length === 2) {
        const lhsExpr = parseExpr(eqParts[0]!.trim());
        const rhsExpr = parseExpr(eqParts[1]!.trim());
        arena.addEquation(EqKind.Simple, lhsExpr, rhsExpr);
      }
    }

    return arena;
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
    const db = engine?.toQueryDB
      ? engine.toQueryDB()
      : {
          childrenOf: (id: number) => {
            const childIds = unifiedIndex.childrenOf?.get(id) || [];
            return childIds.map((cid: any) => unifiedIndex.symbols.get(cid)).filter(Boolean);
          },
          symbol: (id: number) => unifiedIndex.symbols.get(id) || null,
          query: (_name: string, _id: number) => null,
          cstNode: (id: number) => this.workspaceManager.getCstNodeForSymbol(unifiedIndex.symbols.get(id)),
        };

    const thisDocInstances: any[] = [];
    const normUri = (u: string) => {
      if (!u) return "";
      let s = u;
      try {
        s = decodeURIComponent(u);
      } catch {}
      return s.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///");
    };
    const matchEffective = normUri(effectiveUri);
    const matchUri = normUri(uri);
    const matchesResource = (resId: string) => {
      if (!resId) return false;
      if (resId === uri || resId === effectiveUri) return true;
      const normRes = normUri(resId);
      return (
        normRes === matchEffective ||
        normRes === matchUri ||
        (matchEffective.startsWith("file:///") && normRes === matchEffective.substring(7)) ||
        (matchUri.startsWith("file:///") && normRes === matchUri.substring(7))
      );
    };

    const resourceSymbolIds =
      unifiedIndex.symbolsByResource?.get(effectiveUri) ?? unifiedIndex.symbolsByResource?.get(uri);
    const symbolsToCheck =
      resourceSymbolIds && resourceSymbolIds.length > 0
        ? (resourceSymbolIds.map((id: any) => [id, unifiedIndex.symbols.get(id)]).filter(([, e]: any) => e) as Iterable<
            [any, any]
          >)
        : unifiedIndex.symbols;

    for (const [id, entry] of symbolsToCheck) {
      if (!entry || !entry.resourceId || !matchesResource(entry.resourceId)) continue;
      if (entry.kind !== "Class" && entry.kind !== "Def") continue;
      if (entry.parentId !== null) {
        const parentEntry = unifiedIndex.symbols.get(entry.parentId);
        if (parentEntry && parentEntry.resourceId && matchesResource(parentEntry.resourceId)) continue;
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
    this.workspaceManager.workspaceInstances.set(effectiveUri, thisDocInstances);
    this.workspaceManager.documentInstances.set(uri, thisDocInstances);
    this.workspaceManager.documentInstances.set(effectiveUri, thisDocInstances);
    if (context) {
      this.workspaceManager.documentContexts.set(uri, context);
      this.workspaceManager.documentContexts.set(effectiveUri, context);
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
            const parser = this.parserService.getParserForUri(entryUri);
            if (parser) {
              tree = parser.parse(text);
            } else if (this.parserService.sharedContext) {
              const ext = entryUri.includes(".") ? entryUri.substring(entryUri.lastIndexOf(".")) : ".mo";
              tree = this.parserService.sharedContext.parse(ext, text);
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
            const text = sysmlDB.cstText(entry.startOffset ?? entry.startByte, entry.endOffset ?? entry.endByte, entry);
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
    if (!iri) return null;

    const candidates: string[] = [iri];
    if (iri.includes("#")) {
      const frag = iri.split("#").pop()!;
      if (frag && !candidates.includes(frag)) candidates.push(frag);
    }
    if (iri.includes("/")) {
      const segment = iri.split("/").pop()!;
      if (segment && !candidates.includes(segment)) candidates.push(segment);
    }
    if (iri.includes(":")) {
      const local = iri.split(":").pop()!;
      if (local && !candidates.includes(local)) candidates.push(local);
    }

    const db = this.workspaceManager.unifiedWorkspace.toUnifiedPartial();
    for (const cand of candidates) {
      const nameIds = db.byName.get(cand);
      if (nameIds && nameIds.length > 0) {
        for (const id of nameIds) {
          const entry = db.symbols.get(id);
          if (
            entry &&
            (typeof entry.startOffset === "number" || typeof entry.startByte === "number") &&
            (typeof entry.endOffset === "number" || typeof entry.endByte === "number")
          ) {
            const matchesUri =
              entry.resourceId === currentUri ||
              (entry.resourceId && currentUri.endsWith(entry.resourceId)) ||
              (entry.resourceId && entry.resourceId.endsWith(currentUri));
            if (matchesUri) {
              const startOff = entry.startOffset ?? entry.startByte;
              const endOff = entry.endOffset ?? entry.endByte;
              const docTree = this.documentManager.documentTrees.get(currentUri);
              if (docTree && docTree.tree) {
                const node = docTree.tree.rootNode.descendantForIndex(startOff, Math.max(startOff, endOff - 1));
                return {
                  start: { line: node.startPosition.row, character: node.startPosition.column },
                  end: { line: node.endPosition.row, character: node.endPosition.column },
                };
              }
              const doc = this.documentManager.documents.get(currentUri);
              if (doc) {
                return {
                  start: doc.positionAt(startOff),
                  end: doc.positionAt(endOff),
                };
              }
            }
          }
        }
      }
    }

    // Direct document text fallback
    const doc = this.documentManager.documents.get(currentUri);
    if (doc) {
      const text = doc.getText();
      for (const cand of candidates) {
        const idx = text.indexOf(cand);
        if (idx !== -1) {
          return {
            start: doc.positionAt(idx),
            end: doc.positionAt(idx + cand.length),
          };
        }
      }
    }

    return null;
  }

  public findDeclarationLocation(iri: string): {
    uri: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
  } | null {
    if (!iri) return null;

    const candidates: string[] = [iri];
    if (iri.includes("#")) {
      const frag = iri.split("#").pop()!;
      if (frag && !candidates.includes(frag)) candidates.push(frag);
    }
    if (iri.includes("/")) {
      const segment = iri.split("/").pop()!;
      if (segment && !candidates.includes(segment)) candidates.push(segment);
    }
    if (iri.includes(":")) {
      const local = iri.split(":").pop()!;
      if (local && !candidates.includes(local)) candidates.push(local);
    }

    const db = this.workspaceManager?.unifiedWorkspace?.toUnifiedPartial?.();
    if (!db || !db.byName || !db.symbols) return null;

    for (const cand of candidates) {
      const nameIds = db.byName.get(cand);
      if (nameIds && nameIds.length > 0) {
        for (const id of nameIds) {
          const entry = db.symbols.get(id);
          if (
            entry &&
            entry.resourceId &&
            (typeof entry.startOffset === "number" || typeof entry.startByte === "number") &&
            (typeof entry.endOffset === "number" || typeof entry.endByte === "number")
          ) {
            const entryUri = entry.resourceId;
            const startOff = entry.startOffset ?? entry.startByte;
            const endOff = entry.endOffset ?? entry.endByte;

            const docTree = this.documentManager.documentTrees.get(entryUri);
            if (docTree && docTree.tree) {
              const node = docTree.tree.rootNode.descendantForIndex(startOff, Math.max(startOff, endOff - 1));
              return {
                uri: entryUri,
                range: {
                  start: { line: node.startPosition.row, character: node.startPosition.column },
                  end: { line: node.endPosition.row, character: node.endPosition.column },
                },
              };
            }

            const doc = this.documentManager.documents.get(entryUri);
            if (doc) {
              return {
                uri: entryUri,
                range: {
                  start: doc.positionAt(startOff),
                  end: doc.positionAt(endOff),
                },
              };
            }

            let lazyCache = this.documentManager.lazyLibTrees.get(entryUri);
            if (!lazyCache && this.parserService?.sharedContext) {
              try {
                const fsPath = entryUri.startsWith("file://") ? entryUri.substring(7) : entryUri;
                const text = this.parserService.sharedContext.fs.read(fsPath);
                if (text) {
                  const ext = entryUri.includes(".") ? entryUri.substring(entryUri.lastIndexOf(".")) : ".mo";
                  const tree = this.parserService.sharedContext.parse(ext, text);
                  lazyCache = { tree, text };
                  this.documentManager.lazyLibTrees.set(entryUri, lazyCache);
                }
              } catch (e) {}
            }
            if (lazyCache && lazyCache.tree) {
              const node = lazyCache.tree.rootNode.descendantForIndex(startOff, Math.max(startOff, endOff - 1));
              return {
                uri: entryUri,
                range: {
                  start: { line: node.startPosition.row, character: node.startPosition.column },
                  end: { line: node.endPosition.row, character: node.endPosition.column },
                },
              };
            }
          }
        }
      }
    }

    return null;
  }
}

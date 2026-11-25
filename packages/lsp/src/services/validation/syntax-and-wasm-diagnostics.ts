// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  countModelicaInputPrimitives,
  getModelicaErrorCodeDef,
  parseModelicaEquationsForVariablesCounts,
} from "@modelscript/modelica";
import { Diagnostic, DiagnosticSeverity, Range } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { LanguagePlugin } from "../../registry/LanguageRegistry.js";
import type { DocumentManager } from "../document-manager.js";
import { findFirstNonWsIndex, hasWordMatch, type WasmLintDiagnostic } from "./text-helpers.js";

interface WalkableNodeLike {
  type?: string;
  text?: string;
  id?: number;
  ptr?: number;
  startOffset?: number;
  startIndex?: number;
  endOffset?: number;
  endIndex?: number;
  hasError?: boolean | (() => boolean);
  isMissing?: boolean | (() => boolean);
  previousSibling?: WalkableNodeLike | null;
  children?: WalkableNodeLike[];
  tree?: {
    __isXmlCstFallback?: boolean;
    __xmlErrors?: Array<{ start: number; end: number; message: string }>;
    facade?: WasmFacadeLike;
    rootPtr?: number;
    sourceCode?: string;
  };
  walk?: () => {
    currentNode: WalkableNodeLike;
    gotoFirstChild(): boolean;
    gotoNextSibling(): boolean;
    gotoParent(): boolean;
  };
}

interface WasmFacadeLike {
  loadSource?(text: string): void;
  getDiagnostics?(rootPtr: number, a: number, b: number, docText: string): WasmLintDiagnostic[];
}

export interface SyntaxCollectionContext {
  readonly defaultModelicaFacade: WasmFacadeLike | null | undefined;
  readonly console: {
    error(msg: string): void;
    warn(msg: string): void;
  };
}

/**
 * Extracts syntax errors and raw WASM linter diagnostics from a parsed CST root node
 * while the WASM parser linear-memory input buffer still matches the document.
 */
export function collectSyntaxErrorsFromRoot(
  ctx: SyntaxCollectionContext,
  rawRootNode: unknown,
  textDocument: TextDocument,
  plugin?: LanguagePlugin,
): { syntaxDiags: Diagnostic[]; wasmLintDiags: WasmLintDiagnostic[] } {
  const t0 = performance.now();
  const syntaxDiags: Diagnostic[] = [];
  const wasmLintDiags: WasmLintDiagnostic[] = [];
  const rootNode = rawRootNode as WalkableNodeLike | null | undefined;
  if (!rootNode) return { syntaxDiags, wasmLintDiags };

  const clampRangeToLine = (r: Range): Range => {
    if (r.end.line <= r.start.line) {
      if (r.start.character === r.end.character) {
        return { start: r.start, end: { line: r.start.line, character: r.start.character + 1 } };
      }
      return r;
    }
    const nextLineOffset = textDocument.offsetAt({ line: r.start.line + 1, character: 0 });
    const rawLineText = textDocument.getText({
      start: r.start,
      end: textDocument.positionAt(nextLineOffset),
    });
    const trimmedLen = rawLineText.trimEnd().length;
    const clampedChar = trimmedLen > 0 ? r.start.character + trimmedLen : r.start.character + 1;
    return {
      start: r.start,
      end: { line: r.start.line, character: clampedChar },
    };
  };

  const pushSyntaxRange = (
    range: Range,
    message: string,
    source = plugin?.name ? plugin.name.toLowerCase() : "modelscript",
  ) => {
    if (range.end.line <= range.start.line) {
      syntaxDiags.push({
        severity: DiagnosticSeverity.Error,
        range: clampRangeToLine(range),
        message,
        source,
      });
      return;
    }
    for (let line = range.start.line; line <= range.end.line; line++) {
      const nextLineOffset = textDocument.offsetAt({ line: line + 1, character: 0 });
      const lineText = textDocument.getText({
        start: { line, character: 0 },
        end: textDocument.positionAt(nextLineOffset),
      });
      const trimmed = lineText.trim();
      if (!trimmed) continue;
      const startChar = line === range.start.line ? range.start.character : findFirstNonWsIndex(lineText);
      const endChar =
        line === range.end.line ? Math.max(range.end.character, startChar + 1) : lineText.trimEnd().length;
      if (endChar > startChar) {
        syntaxDiags.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line, character: Math.max(0, startChar) },
            end: { line, character: Math.max(startChar + 1, endChar) },
          },
          message,
          source,
        });
      }
    }
  };

  const treeMeta = rootNode.tree;
  if (treeMeta?.__isXmlCstFallback) {
    if (Array.isArray(treeMeta.__xmlErrors)) {
      for (const err of treeMeta.__xmlErrors) {
        pushSyntaxRange(
          {
            start: textDocument.positionAt(err.start),
            end: textDocument.positionAt(Math.max(err.start, err.end)),
          },
          err.message || "XML syntax error",
        );
      }
    }
    return { syntaxDiags, wasmLintDiags };
  }

  // 1. Native WASM GLR parser diagnostics
  const isModelicaPlugin = !plugin || plugin.id === "modelica" || plugin.id === "modelscript";
  const facade =
    (plugin?.facade as WasmFacadeLike | undefined) ??
    rootNode.tree?.facade ??
    (isModelicaPlugin ? ctx.defaultModelicaFacade : null);
  if (facade && typeof facade.getDiagnostics === "function") {
    try {
      const rootPtr = rootNode.id ?? rootNode.ptr ?? rootNode.tree?.rootPtr ?? 0;
      if (rootPtr) {
        const docText = textDocument ? textDocument.getText() : (rootNode.tree?.sourceCode ?? "");
        if (docText && typeof facade.loadSource === "function") {
          facade.loadSource(docText);
        }
        const wasmDiags = facade.getDiagnostics(rootPtr, 0, 0, docText);
        if (Array.isArray(wasmDiags)) {
          for (const d of wasmDiags) {
            const isSyntax = !d.code || d.code === "ERROR" || d.code === 1001 || d.code === 1002;
            if (isSyntax) {
              let range = d.range;
              const startOff = d.startOffset;
              const endOff = d.endOffset;
              if (startOff !== undefined && endOff !== undefined) {
                range = {
                  start: textDocument.positionAt(startOff),
                  end: textDocument.positionAt(endOff),
                };
              }
              if (range) {
                pushSyntaxRange(range, d.message || "Syntax error");
              }
            } else {
              wasmLintDiags.push(d);
            }
          }
          const rootHasError = typeof rootNode.hasError === "function" ? rootNode.hasError() : rootNode.hasError;
          if (syntaxDiags.length > 0 || !rootHasError) {
            return { syntaxDiags, wasmLintDiags };
          }
        }
      }
    } catch (e) {
      ctx.console.error(`[collectSyntaxErrors] error calling facade.getDiagnostics: ${e}`);
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
      ctx.console.warn(
        `[perf] this.collectSyntaxErrors aborted after ${(performance.now() - t0).toFixed(2)}ms (too many nodes)`,
      );
      break;
    }
    const node = cursor.currentNode;
    const hasErr = typeof node.hasError === "function" ? node.hasError() : node.hasError;
    const isMissing = typeof node.isMissing === "function" ? node.isMissing() : node.isMissing;

    let start = textDocument.positionAt(node.startOffset ?? node.startIndex ?? 0);
    let end = textDocument.positionAt(node.endOffset ?? node.endIndex ?? 0);

    if (isMissing) {
      if (start.line === end.line && start.character === end.character) {
        if (node.previousSibling) {
          start = textDocument.positionAt(node.previousSibling.startOffset ?? node.previousSibling.startIndex ?? 0);
          end = textDocument.positionAt(node.previousSibling.endOffset ?? node.previousSibling.endIndex ?? 0);
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
      const textSnippet = textDocument.getText({ start, end });
      pushSyntaxRange(
        { start, end },
        textSnippet ? `Syntax error near '${textSnippet.slice(0, 30)}'` : "Syntax error",
        "modelscript",
      );

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
    ctx.console.warn(
      `[perf] this.collectSyntaxErrors took ${totalMs.toFixed(2)}ms for ${syntaxDiags.length} diagnostics`,
    );
  }
  return { syntaxDiags, wasmLintDiags };
}

/**
 * Converts raw WASM GLR parser linter diagnostics into LSP `Diagnostic` instances,
 * calculating accurate source ranges, descriptive messages from error code definitions,
 * and compiler severity levels.
 */
export function convertWasmLintDiagnosticsToLsp(
  documentManager: DocumentManager | undefined,
  wasmLintDiags: readonly WasmLintDiagnostic[],
  textDocument?:
    | TextDocument
    | {
        uri?: string;
        getText?(): string;
        languageId?: string;
        positionAt?(offset: number): { line: number; character: number };
      },
  plugin?: LanguagePlugin,
  currentText?: string,
  bridge?: unknown,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!wasmLintDiags || wasmLintDiags.length === 0) return diagnostics;

  const text =
    currentText ?? (textDocument && typeof textDocument.getText === "function" ? textDocument.getText() : "");
  const langId = plugin?.id ?? (textDocument?.languageId || "modelica");
  const pluginLints = plugin?.languageDef?.lints;
  const pluginSource = plugin?.name ? plugin.name.toLowerCase() : "modelscript";

  for (const d of wasmLintDiags) {
    const startOff = d.startOffset;
    const endOff = d.endOffset;

    let range = d.range;
    if (startOff !== undefined && endOff !== undefined) {
      const bridgePositions = (
        bridge as { positions?: { rangeFromOffsets?: (start: number, end: number) => Range } } | null | undefined
      )?.positions;
      if (bridgePositions?.rangeFromOffsets) {
        range = bridgePositions.rangeFromOffsets(startOff, endOff);
      } else if (textDocument?.positionAt) {
        range = {
          start: textDocument.positionAt(startOff),
          end: textDocument.positionAt(endOff),
        };
      }
    }
    if (!range) continue;

    if (range.start.line === range.end.line && range.start.character === range.end.character) {
      range = {
        start: range.start,
        end: { line: range.start.line, character: range.start.character + 1 },
      };
    }

    const tokenText =
      startOff !== undefined && endOff !== undefined && endOff > startOff ? text.slice(startOff, endOff).trim() : "";

    let message = d.message;
    const code = d.code;
    type MatchedLintDef = {
      code?: unknown;
      severity?: string;
      message?: (target: { text: string }, extra: { text: string }) => string;
    };
    let matchedLint: MatchedLintDef | null = null;

    if (pluginLints && code) {
      for (const lint of Object.values(pluginLints)) {
        if ((lint as { code?: unknown })?.code === code) {
          matchedLint = lint as MatchedLintDef;
          break;
        }
      }
    }

    const codeNum = typeof code === "number" ? code : typeof code === "string" ? Number(code) : undefined;

    // Modelica M4004: Do not flag models as unbalanced if exogenous 'input' variables account for the difference
    if (codeNum === 4004 && langId === "modelica") {
      let inputCount = 0;
      const docUri = textDocument && "uri" in textDocument ? textDocument.uri : undefined;
      const cachedTree = docUri ? documentManager?.documentTrees?.get(docUri) : null;
      const root = cachedTree?.tree?.rootNode as WalkableNodeLike | null | undefined;
      if (root) {
        const countInputsInCst = (n: WalkableNodeLike | null | undefined) => {
          if (!n) return;
          if (n.type === "component_clause" || n.type === "ComponentClause") {
            const hasInput = (n.children || []).some(
              (c) => c.type === "input" || (c.type === "type_prefix" && hasWordMatch(c.text ?? "", "input")),
            );
            if (hasInput) {
              const compDecls = (n.children || []).filter(
                (c) => c.type === "component_declaration" || c.type === "declaration",
              );
              inputCount += Math.max(1, compDecls.length);
            }
          }
          for (const ch of n.children || []) {
            countInputsInCst(ch);
          }
        };
        countInputsInCst(root);
      } else {
        inputCount = countModelicaInputPrimitives(text);
      }

      const msgToCheck = message || d.message || "";
      const counts = parseModelicaEquationsForVariablesCounts(msgToCheck);
      if (counts && inputCount > 0) {
        if (counts.eqCount === counts.varCount - inputCount) {
          continue;
        }
      }
    }

    const errorCodes = plugin?.languageDef?.errorCodes as
      | Record<string | number, { code: number; rule?: string; severity?: string; message: (param: string) => string }>
      | undefined;
    const matchedCodeDef =
      codeNum !== undefined ? (errorCodes?.[codeNum] ?? getModelicaErrorCodeDef(codeNum)) : undefined;

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
          message = tokenText ? `Type mismatch in assignment in '${tokenText}'.` : "Type mismatch in assignment.";
        } else if (matchedCodeDef) {
          try {
            const msgFn = matchedCodeDef.message as (...args: string[]) => string;
            const formatted = msgFn(tokenText || "");
            if (formatted && !formatted.includes("undefined")) {
              message = formatted;
            }
          } catch {
            // Fallback
          }
          if (!message || message.startsWith("Linter Rule ") || message.startsWith("Linter rule ")) {
            const ruleDisplay = matchedCodeDef.rule ? matchedCodeDef.rule.replaceAll("-", " ") : `rule ${code}`;
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
      severity = DiagnosticSeverity.Error;
    }

    const diagCode = code ?? d.lintName;
    diagnostics.push({
      severity,
      range,
      message,
      source: pluginSource,
      ...(diagCode !== undefined ? { code: diagCode } : {}),
    });
  }

  return diagnostics;
}

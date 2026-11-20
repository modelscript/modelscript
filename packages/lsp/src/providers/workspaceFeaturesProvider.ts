// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CodeAction,
  CodeActionKind,
  Connection,
  SymbolKind,
  TextDocuments,
  WorkspaceEdit,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import { findCstNodesByType, type CstNodeLike, type CstTreeLike } from "../utils/ast-utils.js";
import {
  extractLeafSymbolName,
  extractWordAtOffset,
  findAssignedNumberInLine,
  findScalarAssignmentValue,
  isIdentContCode,
  isIdentStartCode,
  readIdentAt,
  readNumericLiteralAt,
  scanNumericTokensInLine,
  skipWs,
  splitLines,
  uriBasename,
  type NumericSpan,
} from "../utils/lexical-utils.js";

function extractSysmlNodeName(node: CstNodeLike | null | undefined): string | undefined {
  const identNode = findCstNodesByType(node, "identification")[0] ?? findCstNodesByType(node, "identifier")[0];
  const raw = identNode?.text?.trim();
  if (!raw) return undefined;
  const ident = readIdentAt(raw, 0);
  return ident?.token;
}

function resolveSysmlDeclOnLine(
  tree: CstTreeLike | null | undefined,
  cursorRow: number,
  cursorLine: string,
): { kind: "part" | "requirement" | "action"; name: string } | { kind: undefined } {
  const root = tree?.rootNode;
  if (root) {
    const checks: Array<{ types: string[]; kind: "part" | "requirement" | "action" }> = [
      { types: ["part_definition", "PartDefinition"], kind: "part" },
      { types: ["requirement_definition", "RequirementDefinition"], kind: "requirement" },
      {
        types: ["action_definition", "ActionDefinition", "calculation_definition", "CalculationDefinition"],
        kind: "action",
      },
    ];
    for (const c of checks) {
      for (const nodeType of c.types) {
        for (const node of findCstNodesByType(root, nodeType)) {
          if (node?.startPosition?.row === cursorRow) {
            const name = extractSysmlNodeName(node);
            if (name) return { kind: c.kind, name };
          }
        }
      }
    }
  }

  let pos = skipWs(cursorLine, 0);
  const first = readIdentAt(cursorLine, pos);
  if (!first) return { kind: undefined };
  let kw = first;
  if (first.token === "abstract") {
    const nextPos = skipWs(cursorLine, first.next);
    if (nextPos === first.next) return { kind: undefined };
    const nextTok = readIdentAt(cursorLine, nextPos);
    if (!nextTok) return { kind: undefined };
    kw = nextTok;
  }
  const kind =
    kw.token === "part"
      ? "part"
      : kw.token === "requirement"
        ? "requirement"
        : kw.token === "action" || kw.token === "calc"
          ? "action"
          : undefined;
  if (!kind) return { kind: undefined };

  const afterKw = skipWs(cursorLine, kw.next);
  if (afterKw === kw.next) return { kind: undefined };
  const defTok = readIdentAt(cursorLine, afterKw);
  if (!defTok || defTok.token !== "def") return { kind: undefined };
  const afterDef = skipWs(cursorLine, defTok.next);
  if (afterDef === defTok.next) return { kind: undefined };
  const nameTok = readIdentAt(cursorLine, afterDef);
  return nameTok ? { kind, name: nameTok.token } : { kind: undefined };
}

const MODELICA_DECL_ACTION_KEYWORDS = new Set(["model", "block", "study", "process", "class"]);

function resolveModelicaClassOnLine(
  tree: CstTreeLike | null | undefined,
  cursorRow: number,
  cursorLine: string,
): string | undefined {
  const root = tree?.rootNode;
  if (root) {
    for (const node of findCstNodesByType(root, "class_definition")) {
      if (node?.startPosition?.row === cursorRow) {
        const spec = findCstNodesByType(node, "class_specifier")[0] ?? node;
        const idNode = findCstNodesByType(spec, "identifier")[0] ?? findCstNodesByType(spec, "IDENT")[0];
        const raw = idNode?.text?.trim();
        if (raw) return raw;
      }
    }
  }
  const pos = skipWs(cursorLine, 0);
  const kw = readIdentAt(cursorLine, pos);
  if (!kw || !MODELICA_DECL_ACTION_KEYWORDS.has(kw.token)) return undefined;
  const afterKw = skipWs(cursorLine, kw.next);
  if (afterKw === kw.next) return undefined;
  return readIdentAt(cursorLine, afterKw)?.token;
}

function selectBestDriftNumericSpan(
  lineContent: string,
  matches: NumericSpan[],
  expectedVal: number | undefined,
): NumericSpan | undefined {
  let bestMatch: NumericSpan | undefined;
  if (expectedVal !== undefined && matches.length > 0) {
    bestMatch = matches.find((cand) => {
      const parsed = parseFloat(cand.text);
      return (
        Math.abs(parsed - expectedVal) < 1e-6 ||
        Math.abs(parsed - expectedVal) / Math.max(Math.abs(expectedVal), 1) < 1e-4
      );
    });
  }
  if (!bestMatch && matches.length > 0) {
    const eqIdx = lineContent.indexOf("=");
    bestMatch = eqIdx !== -1 ? matches.find((cand) => cand.start >= eqIdx) : matches[matches.length - 1];
  }
  return bestMatch;
}

function findDivisorVariableInLine(lineContent: string): { name: string; start: number; end: number } | undefined {
  let pos = 0;
  while (pos < lineContent.length) {
    const slashIdx = lineContent.indexOf("/", pos);
    if (slashIdx === -1) return undefined;
    const varStart = skipWs(lineContent, slashIdx + 1);
    const ident = readIdentAt(lineContent, varStart);
    if (ident) {
      return { name: ident.token, start: varStart, end: ident.next };
    }
    pos = slashIdx + 1;
  }
  return undefined;
}

function parseFuncCallSingleArg(termText: string, fnName: string): string | undefined {
  if (!termText.startsWith(fnName)) return undefined;
  const openPos = skipWs(termText, fnName.length);
  if (termText[openPos] !== "(" || !termText.endsWith(")")) return undefined;
  const inner = termText.slice(openPos + 1, -1);
  if (inner.includes("(") || inner.includes(")")) return undefined;
  const trimmed = inner.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function findFirstIdent(text: string): string | undefined {
  for (let i = 0; i < text.length; i++) {
    if (isIdentStartCode(text.charCodeAt(i))) {
      return readIdentAt(text, i)?.token;
    }
  }
  return undefined;
}

function parseNonlinearSimplification(
  termText: string,
  deriveSimp: (kind: string, varName: string, options?: any) => string,
): string {
  const trimmed = termText.trim();
  const ident = readIdentAt(trimmed, 0);
  if (ident) {
    const afterIdent = skipWs(trimmed, ident.next);
    if (trimmed[afterIdent] === "^") {
      const expStart = skipWs(trimmed, afterIdent + 1);
      const expSpan = readNumericLiteralAt(trimmed, expStart);
      if (expSpan && expSpan.end === trimmed.length) {
        return deriveSimp("power", ident.token, { power: parseFloat(expSpan.text) });
      }
    } else if (trimmed[afterIdent] === "*") {
      const rhsStart = skipWs(trimmed, afterIdent + 1);
      const arg = parseFuncCallSingleArg(trimmed.slice(rhsStart), "abs");
      if (arg === ident.token) {
        return deriveSimp("quadratic_drag", ident.token);
      }
    }
  }

  const starIdx = trimmed.indexOf("*");
  if (trimmed.startsWith("abs") && starIdx !== -1) {
    const lhsArg = parseFuncCallSingleArg(trimmed.slice(0, starIdx).trimEnd(), "abs");
    if (lhsArg) {
      const rhsIdent = trimmed.slice(starIdx + 1).trim();
      if (rhsIdent === lhsArg) {
        return deriveSimp("quadratic_drag", lhsArg);
      }
    }
  }

  const expArg = parseFuncCallSingleArg(trimmed, "exp");
  if (expArg) {
    return deriveSimp("exp", findFirstIdent(expArg) || "x", { arg: expArg });
  }

  const sqrtArg = parseFuncCallSingleArg(trimmed, "sqrt");
  if (sqrtArg) {
    return deriveSimp("sqrt", findFirstIdent(sqrtArg) || "x", { arg: sqrtArg });
  }

  return `/* linear proxy */ ${termText}`;
}

function extractLineAfterLabel(text: string, label: string): string | undefined {
  const idx = text.indexOf(label);
  if (idx === -1) return undefined;
  const start = skipWs(text, idx + label.length);
  const nl = text.indexOf("\n", start);
  const slice = (nl === -1 ? text.slice(start) : text.slice(start, nl)).trimEnd();
  return slice.length > 0 ? slice : undefined;
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

  type SymbolEntryLike = {
    id: number;
    name: string;
    kind: string;
    parentId?: number | null;
    resourceId?: string;
    startOffset: number;
    endOffset: number;
  };
  type SymbolIndexLike = {
    symbols: Map<number, SymbolEntryLike>;
    byName: Map<string, number[]>;
    childrenOf?: Map<number, number[]>;
  };

  const isDecl = (entry: SymbolEntryLike): boolean => {
    return entry.kind !== "Reference" && entry.kind !== "ConnectEquation" && entry.kind !== "FunctionCall";
  };

  const resolveRef = (entry: SymbolEntryLike, index: SymbolIndexLike): SymbolEntryLike[] => {
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
    const decls: SymbolEntryLike[] = [];
    for (const id of ids) {
      const sym = index.symbols.get(id);
      if (sym && isDecl(sym)) decls.push(sym);
    }
    return decls;
  };

  const findRefs = (declId: number, index: SymbolIndexLike): SymbolEntryLike[] => {
    const decl = index.symbols.get(declId);
    if (!decl) return [];
    const ids = index.byName.get(decl.name) || [];
    const refs: SymbolEntryLike[] = [];
    for (const id of ids) {
      const sym = index.symbols.get(id);
      if (sym && !isDecl(sym)) {
        const resolved = resolveRef(sym, index);
        if (resolved.some((d) => d.id === declId)) {
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

    const { globalLanguageRegistry } = await import("../registry/LanguageRegistry.js");
    const plugin = globalLanguageRegistry.getPluginForUri(params.textDocument.uri, text);
    if (plugin?.customHandlers?.references) {
      const refs = plugin.customHandlers.references(offset, text, params.textDocument.uri);
      if (refs && refs.length > 0) return refs;
    }

    const isSysML2 = params.textDocument.uri.endsWith(".sysml");
    const unifiedIndex = isSysML2 ? await getUnifiedIndex(true) : await getUnifiedIndex(false);
    let adjOffset = offset;
    if (
      adjOffset > 0 &&
      !isIdentContCode(text.charCodeAt(adjOffset)) &&
      isIdentContCode(text.charCodeAt(adjOffset - 1))
    ) {
      adjOffset--;
    }
    const { token: word, start: ws, end: we } = extractWordAtOffset(text, adjOffset);
    if (ws >= we || offset < ws || offset > we) {
      return [];
    }

    let targetEntry: SymbolEntryLike | null = null;

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
      const child = Array.from(unifiedIndex.symbols.values() as Iterable<SymbolEntryLike>).find(
        (s) => s.resourceId === params.textDocument.uri && s.parentId === targetEntry!.id && s.name === word,
      );
      if (child) {
        targetEntry = child;
      }
    }

    // Find the declarations this symbol refers to (or itself if it is a declaration)
    let declarationIds: number[] = [];
    if (isDecl(targetEntry)) {
      declarationIds = [targetEntry.id];
    } else {
      const decls = resolveRef(targetEntry, unifiedIndex);
      declarationIds = decls.map((d) => d.id);
    }

    // Expand declarationIds with cross-language TGG counterparts from TggCorrespondenceIndexer
    const corrIndexer = unifiedIndex?.tggCorrespondenceIndexer;
    if (corrIndexer && typeof corrIndexer.getSlotsForSymbol === "function") {
      const expanded = new Set<number>(declarationIds);
      for (const baseId of declarationIds) {
        for (const slot of corrIndexer.getSlotsForSymbol(baseId)) {
          const rec = corrIndexer.hypergraph?.getRecord?.(slot);
          if (!rec || rec.isRemoved || !rec.domainNodes) continue;
          for (const memberId of Object.values(rec.domainNodes)) {
            if (typeof memberId === "number") expanded.add(memberId);
          }
        }
      }
      declarationIds = Array.from(expanded);
    }

    const results: Array<{
      uri: string;
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
    }> = [];
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
    const { globalLanguageRegistry } = await import("../registry/LanguageRegistry.js");
    const renamePlugin = globalLanguageRegistry.getPluginForUri(params.textDocument.uri, document.getText());
    if (renamePlugin?.customHandlers?.rename) {
      const customRename = await renamePlugin.customHandlers.rename(document, params.position, params.newName);
      if (customRename) return customRename;
    }

    const isSysML2 = params.textDocument.uri.endsWith(".sysml");
    const unifiedIndex = isSysML2 ? await getUnifiedIndex(true) : await getUnifiedIndex(false);
    let targetEntry: SymbolEntryLike | null = null;

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
      declarationIds = [targetEntry.id];
    } else {
      const decls = resolveRef(targetEntry, unifiedIndex);
      declarationIds = decls.map((d) => d.id);
    }

    if (declarationIds.length === 0) return null;

    const changes: WorkspaceEdit["changes"] = {};
    const seen = new Set<string>();
    const isNonIdentifierUri = (u: string) => /\.(step|stp|p21|raw|dyr|seq|reqif|reqifz|qif|xml)$/i.test(u);

    const addEdit = (uri: string, startOffset: number, endOffset: number) => {
      if (uri !== params.textDocument.uri && isNonIdentifierUri(uri)) {
        return;
      }
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
      if (declEntry && declEntry.resourceId && declEntry.name && !declEntry.name.startsWith("#")) {
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
    const docLines = splitLines(docText);
    const cursorRow = params.range.start.line;
    const cursorLine = docLines[cursorRow] ?? "";

    // Declaration-level CodeActions (CST-first, with zero-regex line header fallback)
    const allowDeclarations = isKindAllowed(CodeActionKind.Source) || isKindAllowed(CodeActionKind.Refactor);
    if (allowDeclarations && /\.(sysml|kerml)$/i.test(docUri)) {
      const decl = resolveSysmlDeclOnLine(documentTrees.get(docUri)?.tree, cursorRow, cursorLine);
      if (decl.kind === "part") {
        const partName = decl.name;
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

      if (decl.kind === "requirement") {
        const reqName = decl.name;
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

      if (decl.kind === "action") {
        const actName = decl.name;
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
      const className = resolveModelicaClassOnLine(documentTrees.get(docUri)?.tree, cursorRow, cursorLine);
      if (className) {
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

    const actionPlugin = globalLanguageRegistry.getPluginForUri(params.textDocument.uri, document.getText());
    if (actionPlugin?.customHandlers?.codeActions) {
      const pluginActions = actionPlugin.customHandlers.codeActions(document, params.range, params.context.diagnostics);
      if (Array.isArray(pluginActions)) {
        for (const fix of pluginActions) {
          const action: CodeAction = {
            title: fix.title,
            kind: fix.kind ?? CodeActionKind.QuickFix,
            ...(fix.edit ? { edit: fix.edit } : {}),
            ...(fix.command ? { command: fix.command } : {}),
          };
          if (fix.isPreferred !== undefined) {
            action.isPreferred = fix.isPreferred;
          }
          actions.push(action);
        }
      }
    }

    type LspRange = { start: { line: number; character: number }; end: { line: number; character: number } };
    type DigitalThreadDiagData = {
      simplexConsensus?: unknown;
      sourceValue?: unknown;
      unit?: string;
      elementName?: string;
      threadId?: string;
      slot?: string;
      sourceDomain?: string;
      targetUri?: string;
      targetLine?: number;
      startOffset?: number;
      endOffset?: number;
      newText?: unknown;
      description?: string;
      suggestedEdits?: Array<{
        uri?: string;
        line?: number;
        startOffset?: number;
        endOffset?: number;
        newText: string;
        description?: string;
      }>;
    };
    const batchDriftEdits: Array<{ range: LspRange; newText: string }> = [];
    const batchDriftDiags: typeof params.context.diagnostics = [];

    for (const diagnostic of params.context.diagnostics) {
      // ── Digital Thread Quick-Fixes ──────────────────────────────────
      if (diagnostic.source === "modelscript-digital-thread") {
        const text = document.getText();
        const startOffset = document.offsetAt(diagnostic.range.start);
        const endOffset = document.offsetAt(diagnostic.range.end);
        const termText = text.substring(startOffset, endOffset).trim();

        const data = diagnostic.data as DigitalThreadDiagData | undefined;
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
          const assignSpan = findAssignedNumberInLine(lineContent);
          if (assignSpan) {
            newRange = {
              start: { line: diagnostic.range.start.line, character: assignSpan.start },
              end: { line: diagnostic.range.start.line, character: assignSpan.end },
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
          const assignSpan = findAssignedNumberInLine(lineContent);
          if (assignSpan) {
            newRange = {
              start: { line: diagnostic.range.start.line, character: assignSpan.start },
              end: { line: diagnostic.range.start.line, character: assignSpan.end },
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

        // 2b. Polyglot Digital Thread Generic Drift QuickFix (POLYGLOT_TWIN_DRIFT / suggestedEdits)
        if (
          (diagnostic.code === "POLYGLOT_TWIN_DRIFT" || data?.targetUri || Array.isArray(data?.suggestedEdits)) &&
          (Array.isArray(data?.suggestedEdits) || (data?.targetUri && data?.newText !== undefined))
        ) {
          const editsList =
            Array.isArray(data?.suggestedEdits) && data.suggestedEdits.length > 0
              ? data.suggestedEdits
              : [
                  {
                    uri: data?.targetUri,
                    line: data?.targetLine,
                    startOffset: data?.startOffset,
                    endOffset: data?.endOffset,
                    newText: String(data?.newText),
                    description: data?.description,
                  },
                ];
          const wsChanges: Record<string, Array<{ range: LspRange; newText: string }>> = {};
          for (const se of editsList) {
            if (!se.uri) continue;
            const targetDoc = documents.get(se.uri);
            let targetText = targetDoc?.getText();
            if (targetText === undefined && /^file:\/\//i.test(se.uri) && typeof process !== "undefined") {
              try {
                const procBuiltin = process as unknown as {
                  getBuiltinModule?: (id: string) => Record<string, (...a: string[]) => unknown>;
                };
                const nodeFs = procBuiltin.getBuiltinModule?.("node:fs") as
                  | { existsSync: (p: string) => boolean; readFileSync: (p: string, enc: string) => string }
                  | undefined;
                const nodeUrl = procBuiltin.getBuiltinModule?.("node:url") as
                  | { fileURLToPath: (u: string) => string }
                  | undefined;
                if (nodeFs && nodeUrl) {
                  const fsPath = nodeUrl.fileURLToPath(se.uri);
                  if (nodeFs.existsSync(fsPath)) {
                    targetText = nodeFs.readFileSync(fsPath, "utf-8");
                  }
                }
              } catch {
                // Ignore unreadable external URI
              }
            }

            let editRange: LspRange | undefined;
            if (targetDoc && se.startOffset !== undefined && se.endOffset !== undefined) {
              editRange = {
                start: targetDoc.positionAt(se.startOffset),
                end: targetDoc.positionAt(se.endOffset),
              };
            } else if (targetText !== undefined && se.startOffset !== undefined && se.endOffset !== undefined) {
              const offsetToPos = (txt: string, utf16Off: number) => {
                const clamped = Math.max(0, Math.min(utf16Off, txt.length));
                const sub = txt.slice(0, clamped);
                const lines = splitLines(sub);
                return { line: lines.length - 1, character: lines[lines.length - 1]!.length };
              };
              editRange = {
                start: offsetToPos(targetText, se.startOffset),
                end: offsetToPos(targetText, se.endOffset),
              };
            } else if (targetText !== undefined) {
              const zeroLine = Math.max(0, (se.line ?? 1) - 1);
              const lText = splitLines(targetText)[zeroLine] ?? "";
              const mVal = findAssignedNumberInLine(lText, { allowSign: true, allowExponent: true });
              if (mVal) {
                editRange = {
                  start: { line: zeroLine, character: mVal.start },
                  end: { line: zeroLine, character: mVal.end },
                };
              }
            }
            if (editRange) {
              wsChanges[se.uri] ??= [];
              wsChanges[se.uri]!.push({ range: editRange, newText: se.newText });
            }
          }
          if (Object.keys(wsChanges).length > 0) {
            actions.push({
              title: editsList[0]?.description || `Sync '${elemName}' across polyglot digital thread`,
              kind: CodeActionKind.QuickFix,
              isPreferred: true,
              diagnostics: [diagnostic],
              edit: { changes: wsChanges },
            });
          }
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
        diagnostic.source === "modelscript-prover" ||
        diagnostic.code === "M4101" ||
        diagnostic.code === "M4102" ||
        diagnostic.code === "M5101" ||
        diagnostic.code === "M5102" ||
        diagnostic.code === "M5103" ||
        diagnostic.code === "M5104" ||
        diagnostic.code === "S5020" ||
        diagnostic.code === "S5021" ||
        diagnostic.code === "division_by_zero" ||
        diagnostic.code === "div_by_zero" ||
        diagnostic.code === "math_domain" ||
        diagnostic.code === "min_bound_violation" ||
        diagnostic.code === "max_bound_violation";

      if (isReasonerDiag) {
        const text = document.getText();
        const lineStart = document.offsetAt({ line: diagnostic.range.start.line, character: 0 });
        const lineEnd = document.offsetAt({ line: diagnostic.range.start.line + 1, character: 0 });
        const lineContent = text.substring(lineStart, lineEnd);
        const data = diagnostic.data as any;
        const numMatch = findAssignedNumberInLine(lineContent, { allowSingleColon: true });

        // 0. Cross-Language Parameter Drift QuickFix (M5104)
        if (diagnostic.code === "M5104" || diagnostic.source?.includes("drift-checker")) {
          const suggestedVal = data?.suggestedValue;
          const currentVal = data?.currentValue;
          const paramName = data?.param || "parameter";
          const counterpartLang = (data?.counterpartLang || "counterpart").toUpperCase();

          if (suggestedVal !== undefined) {
            let newRange = diagnostic.range;
            let newText = `${suggestedVal}`;

            const matches = scanNumericTokensInLine(lineContent);
            let bestMatch = selectBestDriftNumericSpan(lineContent, matches, currentVal);

            if (bestMatch) {
              newRange = {
                start: { line: diagnostic.range.start.line, character: bestMatch.start },
                end: { line: diagnostic.range.start.line, character: bestMatch.end },
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
              const counterpartFile = uriBasename(counterpartUri);

              let cRange = data.counterpartRange;
              if (counterpartText && cRange) {
                const cDoc = counterpartDoc || TextDocument.create(counterpartUri, "temp", 1, counterpartText);
                const cLineStart = cDoc.offsetAt({ line: cRange.start.line, character: 0 });
                const cLineEnd = cDoc.offsetAt({ line: cRange.start.line + 1, character: 0 });
                const cLineContent = counterpartText.substring(cLineStart, cLineEnd);

                const cMatches = scanNumericTokensInLine(cLineContent);
                const cBestMatch = selectBestDriftNumericSpan(cLineContent, cMatches, suggestedVal);

                if (cBestMatch) {
                  cRange = {
                    start: { line: cRange.start.line, character: cBestMatch.start },
                    end: { line: cRange.start.line, character: cBestMatch.end },
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
          if (suggestedVal !== undefined && numMatch) {
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
                        start: { line: diagnostic.range.start.line, character: numMatch.start },
                        end: { line: diagnostic.range.start.line, character: numMatch.end },
                      },
                      newText: `${suggestedVal}`,
                    },
                  ],
                },
              },
            });
          }
        }

        // 2. Abstract Interpretation Division & Math Domain Guard QuickFixes
        if (
          diagnostic.code === "M5101" ||
          diagnostic.code === "division_by_zero" ||
          diagnostic.code === "div_by_zero" ||
          diagnostic.message.includes("division by zero")
        ) {
          const divisor = findDivisorVariableInLine(lineContent);
          if (divisor) {
            const indent = lineContent.match(/^[ \t]*/)?.[0] ?? "";
            actions.push({
              title: `Guard against division by zero with 'max(1e-6, ${divisor.name})'`,
              kind: CodeActionKind.QuickFix,
              diagnostics: [diagnostic],
              edit: {
                changes: {
                  [params.textDocument.uri]: [
                    {
                      range: {
                        start: { line: diagnostic.range.start.line, character: divisor.start },
                        end: { line: diagnostic.range.start.line, character: divisor.end },
                      },
                      newText: `max(1e-6, ${divisor.name})`,
                    },
                  ],
                },
              },
            });
            actions.push({
              title: `Insert invariant assertion 'assert(${divisor.name} <> 0, ...)'`,
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
                      newText: `${indent}assert(${divisor.name} <> 0, "Divisor '${divisor.name}' must be non-zero");\n`,
                    },
                  ],
                },
              },
            });
          }
        }

        if (diagnostic.code === "math_domain" || /\b(sqrt|log|log10)\s*\(/.test(lineContent)) {
          const mathMatch = /\b(sqrt|log|log10)\s*\(\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\)/.exec(lineContent);
          if (mathMatch) {
            const fnName = mathMatch[1]!;
            const argName = mathMatch[2]!;
            const cond = fnName === "sqrt" ? `${argName} >= 0` : `${argName} > 0`;
            const indent = lineContent.match(/^[ \t]*/)?.[0] ?? "";
            actions.push({
              title: `Insert domain assertion 'assert(${cond}, ...)' before '${fnName}(${argName})'`,
              kind: CodeActionKind.QuickFix,
              isPreferred: true,
              diagnostics: [diagnostic],
              edit: {
                changes: {
                  [params.textDocument.uri]: [
                    {
                      range: {
                        start: { line: diagnostic.range.start.line, character: 0 },
                        end: { line: diagnostic.range.start.line, character: 0 },
                      },
                      newText: `${indent}assert(${cond}, "Argument '${argName}' must satisfy ${cond} for ${fnName}()");\n`,
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
          if (reqLimit !== undefined && numMatch) {
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
                        start: { line: diagnostic.range.start.line, character: numMatch.start },
                        end: { line: diagnostic.range.start.line, character: numMatch.end },
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
          if (provenBound !== undefined && numMatch) {
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
                        start: { line: diagnostic.range.start.line, character: numMatch.start },
                        end: { line: diagnostic.range.start.line, character: numMatch.end },
                      },
                      newText: `${provenBound}`,
                    },
                  ],
                },
              },
            });
          }
        }

        // 5b. Standard Compliance Limit QuickFix (S5020 / S5021)
        if (diagnostic.code === "S5020" || diagnostic.code === "S5021") {
          const targetVal = data?.suggestedValue ?? data?.requiredLimit;
          if (typeof targetVal === "number" && Number.isFinite(targetVal)) {
            const formattedVal = Number(targetVal.toPrecision(6)).toString();
            const clauseLabel = data?.standardClause ? ` (${data.standardClause})` : "";
            const varLabel = typeof data?.varName === "string" && data.varName ? data.varName : "parameter";
            let editRange:
              | { start: { line: number; character: number }; end: { line: number; character: number } }
              | undefined;

            if (numMatch) {
              editRange = {
                start: { line: diagnostic.range.start.line, character: numMatch.start },
                end: { line: diagnostic.range.start.line, character: numMatch.end },
              };
            } else if (typeof data?.varName === "string" && data.varName.trim()) {
              const shortVar = extractLeafSymbolName(data.varName);
              const valSpan = findScalarAssignmentValue(text, shortVar);
              if (valSpan) {
                editRange = {
                  start: document.positionAt(valSpan.start),
                  end: document.positionAt(valSpan.end),
                };
              }
            }

            if (editRange) {
              actions.push({
                title: `Update '${varLabel}' to ${formattedVal} to satisfy${clauseLabel}`,
                kind: CodeActionKind.QuickFix,
                isPreferred: true,
                diagnostics: [diagnostic],
                edit: {
                  changes: {
                    [params.textDocument.uri]: [
                      {
                        range: editRange,
                        newText: formattedVal,
                      },
                    ],
                  },
                },
              });
            }
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

      // ── SysML v2 QuickFixes (S6002, S2010, S2011, S4021) ────────────
      const rawDiagCode = diagnostic.code;
      const isSysmlDocOrDiag =
        /\.(?:sysml|sysml2|kerml|sysmlx|sys2)$/i.test(docUri) ||
        document.languageId === "sysml2" ||
        document.languageId === "sysml" ||
        document.languageId === "kerml" ||
        (typeof rawDiagCode === "string" && /^S\d{4}$/i.test(rawDiagCode.trim())) ||
        Boolean(diagnostic.source?.toLowerCase().includes("sysml"));

      if (isSysmlDocOrDiag) {
        const normSysmlCode =
          typeof rawDiagCode === "number"
            ? `S${rawDiagCode}`
            : typeof rawDiagCode === "string"
              ? /^\d{4}$/.test(rawDiagCode.trim())
                ? `S${rawDiagCode.trim()}`
                : rawDiagCode.trim().toUpperCase()
              : "";

        // 1. S6002 (requirement-decomposition-gap): Insert synthesized Craig interpolant constraint
        if (normSysmlCode === "S6002") {
          const reqConstraintMatch = /require\s+constraint\s*\{\s*([^}]+?)\s*\}/i.exec(diagnostic.message);
          const interpMatch = !reqConstraintMatch ? /interpolant[^:]*:\s*([^)\]]+)/i.exec(diagnostic.message) : null;
          const violatingMatch =
            !reqConstraintMatch && !interpMatch ? /violating\s+'([^']+)'/i.exec(diagnostic.message) : null;

          let synthExpr = reqConstraintMatch?.[1]?.trim();
          if (!synthExpr && interpMatch?.[1]) {
            const rawInterp = interpMatch[1]
              .trim()
              .replace(/[.;]+$/, "")
              .trim();
            const nestedReq = /^require\s+constraint\s*\{\s*([^}]+?)\s*\}$/i.exec(rawInterp);
            synthExpr = nestedReq?.[1]?.trim() ?? rawInterp;
          }
          if (!synthExpr && violatingMatch?.[1]) {
            synthExpr = violatingMatch[1].trim();
          }

          if (synthExpr) {
            const reqHeaderRe =
              /^\s*(?:(?:public|private|protected|abstract|individual|variation|variant)\s+)*requirement\b/;
            let reqHeaderLine = -1;
            const diagLine = Math.max(0, Math.min(docLines.length - 1, diagnostic.range.start.line));

            const findMatchingCloseBrace = (startSearchOffset: number): number => {
              let depth = 0;
              let seenOpen = false;
              let inLineComment = false;
              let inBlockComment = false;
              let quoteChar = "";

              for (let idx = startSearchOffset; idx < docText.length; idx++) {
                const ch = docText[idx]!;
                const next = docText[idx + 1] ?? "";
                if (inLineComment) {
                  if (ch === "\n") inLineComment = false;
                  continue;
                }
                if (inBlockComment) {
                  if (ch === "*" && next === "/") {
                    inBlockComment = false;
                    idx++;
                  }
                  continue;
                }
                if (quoteChar) {
                  if (ch === "\\" && next) {
                    idx++;
                    continue;
                  }
                  if (ch === quoteChar) quoteChar = "";
                  continue;
                }
                if (ch === "/" && next === "/") {
                  inLineComment = true;
                  idx++;
                  continue;
                }
                if (ch === "/" && next === "*") {
                  inBlockComment = true;
                  idx++;
                  continue;
                }
                if (ch === '"' || ch === "'") {
                  quoteChar = ch;
                  continue;
                }
                if (ch === "{") {
                  seenOpen = true;
                  depth++;
                } else if (ch === "}" && seenOpen) {
                  depth--;
                  if (depth === 0) return idx;
                }
              }
              return -1;
            };

            const diagStartOffset = document.offsetAt(diagnostic.range.start);
            if (reqHeaderRe.test(docLines[diagLine] ?? "")) {
              reqHeaderLine = diagLine;
            } else {
              for (let r = diagLine - 1; r >= 0; r--) {
                if (!reqHeaderRe.test(docLines[r] ?? "")) continue;
                const candStart = document.offsetAt({ line: r, character: 0 });
                const candClose = findMatchingCloseBrace(candStart);
                if (candClose > diagStartOffset) {
                  reqHeaderLine = r;
                  break;
                }
              }
            }

            const searchStart =
              reqHeaderLine >= 0 ? document.offsetAt({ line: reqHeaderLine, character: 0 }) : diagStartOffset;
            const closeOffset = findMatchingCloseBrace(searchStart);
            if (closeOffset >= 0) {
              const closePos = document.positionAt(closeOffset);
              const closeLineText = docLines[closePos.line] ?? "";
              const prefixBeforeBrace = closeLineText.slice(0, closePos.character);
              const isBraceOnOwnLine = prefixBeforeBrace.trim().length === 0;
              const insertPos = isBraceOnOwnLine ? { line: closePos.line, character: 0 } : closePos;
              const indent = isBraceOnOwnLine ? `${prefixBeforeBrace}  ` : "  ";

              actions.push({
                title: "Insert synthesized Craig interpolant constraint",
                kind: CodeActionKind.QuickFix,
                isPreferred: true,
                diagnostics: [diagnostic],
                edit: {
                  changes: {
                    [docUri]: [
                      {
                        range: { start: insertPos, end: insertPos },
                        newText: `${indent}require constraint { ${synthExpr} }\n`,
                      },
                    ],
                  },
                },
              });
            }
          }
          continue;
        }

        // 2. S2010 (top-level-import-not-private): Make top-level import 'private'
        if (normSysmlCode === "S2010") {
          const lineIdx = diagnostic.range.start.line;
          const lineText = docLines[lineIdx] ?? "";
          const importLineMatch = /^(\s*)(?:(public|protected)\s+)?(import\b)/.exec(lineText);
          let editRange: LspRange;
          let newText: string;

          if (importLineMatch && importLineMatch[2]) {
            const visStart = importLineMatch[1]!.length;
            editRange = {
              start: { line: lineIdx, character: visStart },
              end: { line: lineIdx, character: visStart + importLineMatch[2].length },
            };
            newText = "private";
          } else if (importLineMatch) {
            const impCol = importLineMatch[1]!.length;
            editRange = {
              start: { line: lineIdx, character: impCol },
              end: { line: lineIdx, character: impCol },
            };
            newText = "private ";
          } else {
            editRange = {
              start: diagnostic.range.start,
              end: diagnostic.range.start,
            };
            newText = "private ";
          }

          actions.push({
            title: "Make top-level import 'private'",
            kind: CodeActionKind.QuickFix,
            isPreferred: true,
            diagnostics: [diagnostic],
            edit: {
              changes: {
                [docUri]: [{ range: editRange, newText }],
              },
            },
          });
          continue;
        }

        // 3. S2011 (inherited-member-shadowing): Add ':>>' ('redefines') to shadowed member
        if (normSysmlCode === "S2011") {
          const shadowedName = /Member\s+'([^']+)'\s+shadows/i.exec(diagnostic.message)?.[1];
          const lineIdx = diagnostic.range.start.line;
          const lineText = docLines[lineIdx] ?? "";
          const rangeSlice = docText.slice(
            document.offsetAt(diagnostic.range.start),
            document.offsetAt(diagnostic.range.end),
          );

          let insertChar = -1;
          if (shadowedName && rangeSlice === shadowedName) {
            insertChar = diagnostic.range.start.character;
          } else if (shadowedName) {
            const escapedName = shadowedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const declBeforeDelim = lineText.split(/[:={;]/)[0] ?? lineText;
            const nameMatch = new RegExp(`\\b(${escapedName})\\b`).exec(declBeforeDelim);
            if (nameMatch && typeof nameMatch.index === "number") {
              insertChar = nameMatch.index;
            }
          } else if (rangeSlice && isIdentStartCode(rangeSlice.charCodeAt(0))) {
            insertChar = diagnostic.range.start.character;
          }

          if (insertChar >= 0) {
            const pos = { line: lineIdx, character: insertChar };
            actions.push({
              title: "Add ':>>' ('redefines') to shadowed member",
              kind: CodeActionKind.QuickFix,
              isPreferred: true,
              diagnostics: [diagnostic],
              edit: {
                changes: {
                  [docUri]: [{ range: { start: pos, end: pos }, newText: ":>> " }],
                },
              },
            });
          }
          continue;
        }

        // 4. S4021 (send-to-port-without-via): Replace 'to' with 'via' for port send
        if (normSysmlCode === "S4021") {
          const portFromMsg =
            /Sending to port '([^']+)'/i.exec(diagnostic.message)?.[1] ??
            /instead of 'to\s+([^']+)'/i.exec(diagnostic.message)?.[1];
          const lineIdx = diagnostic.range.start.line;
          const lineText = docLines[lineIdx] ?? "";
          let replaceRange: LspRange | undefined;
          let replacementText: string | undefined;

          if (portFromMsg) {
            const escapedPort = portFromMsg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const toPortRe = new RegExp(`\\bto(\\s+${escapedPort})(?![A-Za-z0-9_])`);
            const m = toPortRe.exec(lineText);
            if (m && typeof m.index === "number") {
              replaceRange = {
                start: { line: lineIdx, character: m.index },
                end: { line: lineIdx, character: m.index + m[0].length },
              };
              replacementText = `via${m[1]}`;
            }
          }

          if (!replaceRange) {
            const fallbackMatch = /\bto(\s+[A-Za-z_][A-Za-z0-9_.'"]*)/.exec(lineText);
            if (fallbackMatch && typeof fallbackMatch.index === "number") {
              replaceRange = {
                start: { line: lineIdx, character: fallbackMatch.index },
                end: { line: lineIdx, character: fallbackMatch.index + fallbackMatch[0].length },
              };
              replacementText = `via${fallbackMatch[1]}`;
            }
          }

          if (replaceRange && replacementText !== undefined) {
            actions.push({
              title: "Replace 'to' with 'via' for port send",
              kind: CodeActionKind.QuickFix,
              isPreferred: true,
              diagnostics: [diagnostic],
              edit: {
                changes: {
                  [docUri]: [{ range: replaceRange, newText: replacementText }],
                },
              },
            });
          }
          continue;
        }
      }

      if (diagnostic.source !== "modelscript" && diagnostic.source !== "modelica") continue;

      // Suggest adding import for unresolved references
      if (diagnostic.message.includes("not found") || diagnostic.message.includes("unresolved")) {
        // Extract the name from the diagnostic range
        const text = document.getText();
        const startOffset = document.offsetAt(diagnostic.range.start);
        const endOffset = document.offsetAt(diagnostic.range.end);
        const unresolvedName = text.substring(startOffset, endOffset);

        if (unresolvedName && isIdentStartCode(unresolvedName.charCodeAt(0))) {
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

          const simplified = parseNonlinearSimplification(termText, deriveSimp);

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
        const fixSnippet = extractLineAfterLabel(diagnostic.message, "QuickFix:");
        const condText = extractLineAfterLabel(diagnostic.message, "condition:");
        const condition = condText || "/* unhandled condition */";
        const newSnippet =
          fixSnippet && fixSnippet.startsWith("else if")
            ? `\n  ${fixSnippet} {\n    // Auto-generated QuickFix\n  }`
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
      const unifiedIndex = globalWsIdx.getIndex({ eager: true });
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

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
  getResolver: (isSysML2: boolean, unifiedIndex: any) => any,
  getGlobalWorkspaceIndex: () => any,
) {
  connection.onReferences(async (params) => {
    await flushValidation(params.textDocument.uri);
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const isSysML2 = params.textDocument.uri.endsWith(".sysml");
    const unifiedIndex = isSysML2 ? await getUnifiedIndex(true) : await getUnifiedIndex(false);
    const resolver = isSysML2 ? getResolver(true, unifiedIndex) : getResolver(false, unifiedIndex);

    const offset = document.offsetAt(params.position);
    let targetEntry: any = null;

    for (const entry of unifiedIndex.symbols.values()) {
      if (entry.resourceId === params.textDocument.uri && entry.startByte <= offset && offset < entry.endByte) {
        if (!targetEntry || entry.endByte - entry.startByte < targetEntry.endByte - targetEntry.startByte) {
          targetEntry = entry;
        }
      }
    }

    if (!targetEntry) return [];

    // Find the declarations this symbol refers to (or itself if it is a declaration)
    let declarationIds: number[] = [];
    if (resolver.isDeclaration(targetEntry)) {
      declarationIds = [targetEntry.id as number];
    } else {
      const decls = resolver.resolve(targetEntry);
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
        addLocation(declEntry.resourceId, declEntry.startByte, declEntry.endByte);
      }
      // Include references
      const refs = resolver.findReferences(declId);
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
    const resolver = isSysML2 ? getResolver(true, unifiedIndex) : getResolver(false, unifiedIndex);

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
    if (resolver.isDeclaration(targetEntry)) {
      declarationIds = [targetEntry.id as number];
    } else {
      const decls = resolver.resolve(targetEntry);
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
        // The entry byte range might include keywords/type, we just want to replace the name.
        // E.g., `part engine : Engine`, `declEntry` spans the whole thing.
        // Actually `targetName` length is from `declEntry.name.length`, but `declEntry.nameLoc` isn't available.
        // In ModelScript indexing, `startByte` to `endByte` is usually the identifier for refs.
        // For declarations, `startByte` to `endByte` is the WHOLE declaration body. That's a problem for rename!
        // Let's use `name` and match the identifier.

        const text = documents.get(declEntry.resourceId)?.getText() ?? documentTrees.get(declEntry.resourceId)?.text;
        if (text) {
          const dummyDoc = TextDocument.create(declEntry.resourceId, "temp", 1, text);
          // Find exact occurrence of declaration name near the start
          const nameMatch = text.substring(declEntry.startByte, declEntry.endByte).indexOf(declEntry.name);
          if (nameMatch !== -1) {
            const matchStart = declEntry.startByte + nameMatch;
            const matchEnd = matchStart + declEntry.name.length;
            addEdit(declEntry.resourceId, matchStart, matchEnd);
          }
        }
      }
      // Include references
      const refs = resolver.findReferences(declId);
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

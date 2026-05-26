/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any */

// @ts-nocheck
import { Connection } from "vscode-languageserver";

export function registerSignatureHelpProvider(connection: Connection) {
  connection.onSignatureHelp((params) => {
    if (!parserReady || !parser) return null;
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const text = document.getText();
    const tree = getDocumentTree(document.uri);
    if (!tree) return null;

    try {
      const rootNode = tree.rootNode;
      let node: SyntaxNode | null = null;
      const indexData = getLineIndexForDoc(document.uri);
      if (indexData) {
        const idx = indexData.lineIndex.tokenIndexAt(params.position.line, params.position.character);
        if (idx !== -1) node = indexData.tokens[idx]!;
      }
      if (!node) {
        node = rootNode.descendantForPosition({
          row: params.position.line,
          column: params.position.character,
        });
      }

      // Walk up to find a FunctionCall ancestor
      let funcCallNode: SyntaxNode | null = node;
      while (funcCallNode && funcCallNode.type !== "FunctionCall") {
        funcCallNode = funcCallNode.parent;
      }
      if (!funcCallNode) return null;

      const refNode = funcCallNode.children.find((c: SyntaxNode) => c.type === "ComponentReference");
      if (!refNode) return null;

      const bridge = documentLSPBridges.get(params.textDocument.uri);
      if (!bridge) return null;

      // Use polyglot to resolve the function reference
      const funcTarget = (bridge as any).definitionRaw(refNode.startIndex);
      if (!funcTarget || funcTarget.kind !== "Class") return null;

      // Quick check if it's a function or record (from metadata classKind)
      const classKind = funcTarget.metadata?.classKind;
      if (classKind !== "function" && classKind !== "record") {
        return null;
      }

      // Collect all elements, filter to input parameters
      let allElements: any[] = [];
      try {
        allElements = (bridge as any).engine.query("allElements", funcTarget.id) || [];
      } catch {
        // fallback
      }

      const inputParams = allElements.filter((c) => c.kind === "Component" && c.metadata?.causality === "input");

      // Collect parameter information
      const paramInfos: ParameterInformation[] = [];
      for (const param of inputParams) {
        const typeName = param.metadata?.typeSpecifier ?? "?";
        const label = `${typeName} ${param.name}`;
        paramInfos.push(ParameterInformation.create(label, param.metadata?.description ?? undefined));
      }

      // Determine which parameter is active based on comma count before cursor
      const argsNode = funcCallNode.children.find((c: SyntaxNode) => c.type === "FunctionCallArguments");
      let activeParameter = 0;
      if (argsNode) {
        const argsText = text.substring(argsNode.startIndex, argsNode.endIndex);
        const cursorOffset = document.offsetAt(params.position) - argsNode.startIndex;
        const textBeforeCursor = argsText.substring(0, Math.max(0, cursorOffset));
        // Count commas at nesting depth 0
        let depth = 0;
        for (const ch of textBeforeCursor) {
          if (ch === "(" || ch === "{" || ch === "[") depth++;
          else if (ch === ")" || ch === "}" || ch === "]") depth--;
          else if (ch === "," && depth <= 1) activeParameter++;
        }
      }

      const sigLabel = `${refNode.text}(${paramInfos.map((p) => p.label).join(", ")})`;

      return {
        signatures: [
          SignatureInformation.create(sigLabel, funcTarget.metadata?.description ?? undefined, ...paramInfos),
        ],
        activeSignature: 0,
        activeParameter,
      };
    } finally {
      // Tree is managed by cache
    }
  });
}

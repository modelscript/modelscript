// SPDX-License-Identifier: AGPL-3.0-or-later

import { Connection, ParameterInformation, SignatureInformation } from "vscode-languageserver";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import type { SyntaxNode } from "../utils/cst-facade.js";

export function registerSignatureHelpProvider(
  connection: Connection,
  documents: any,
  documentLSPBridges: any,
  getDocumentTree: any,
  isParserReady: () => boolean,
  getParser: () => any,
  getLineIndexForDoc: any,
) {
  connection.onSignatureHelp(async (params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    // ── Language-plugin custom signature help (e.g. STEP, etc.) ──
    const plugin = globalLanguageRegistry.getPluginForUri(document.uri);
    if (plugin?.customHandlers?.signatureHelp) {
      const customSig = await plugin.customHandlers.signatureHelp(document, params.position);
      if (customSig) return customSig;
      if (plugin.id !== "modelica" && plugin.id !== "modelscript" && plugin.id !== "sysml2") {
        return null;
      }
    }

    // ── Standard Modelica/SysML signature help (requires parser + bridge) ──
    const text = document.getText();
    if (!isParserReady() || !getParser()) return null;
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

      // Walk up to find a FunctionCall / function_call ancestor
      let funcCallNode: SyntaxNode | null = node;
      while (funcCallNode && funcCallNode.type !== "FunctionCall" && funcCallNode.type !== "function_call") {
        funcCallNode = funcCallNode.parent;
      }
      if (!funcCallNode) return null;

      const refNode = funcCallNode.children.find(
        (c: SyntaxNode) =>
          c.type === "ComponentReference" ||
          c.type === "component_reference" ||
          c.type === "name" ||
          c.type === "IDENT",
      );
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
      const argsNode = funcCallNode.children.find(
        (c: SyntaxNode) =>
          c.type === "FunctionCallArguments" || c.type === "function_call_args" || c.type === "function_arguments",
      );
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

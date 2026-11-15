// SPDX-License-Identifier: AGPL-3.0-or-later

import { Color, ColorInformation, ColorPresentation, Connection, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { SyntaxNode } from "../utils/cst-facade.js";
import { isDigitCode, skipWs } from "../utils/lexical-utils.js";

const COLOR_FIELDS = new Set(["color", "lineColor", "fillColor", "textColor"]);

function parseRgbTupleFromExpr(exprNode: SyntaxNode): [number, number, number] | null {
  const nums: number[] = [];
  const collect = (n: SyntaxNode) => {
    if (n.type === "UNSIGNED_NUMBER" || n.type === "unsigned_number" || n.type === "UNSIGNED_INTEGER") {
      const v = Number((n.text ?? "").trim());
      if (Number.isInteger(v)) nums.push(v);
      return;
    }
    for (const c of n.children || []) {
      if (c) collect(c);
    }
  };
  collect(exprNode);
  if (nums.length === 3) {
    return [nums[0]!, nums[1]!, nums[2]!];
  }

  const raw = (exprNode.text ?? "").trim();
  if (!raw.startsWith("{")) return null;
  let pos = 1;
  const parsed: number[] = [];
  for (let k = 0; k < 3; k++) {
    pos = skipWs(raw, pos);
    const dStart = pos;
    while (pos < raw.length && isDigitCode(raw.charCodeAt(pos))) pos++;
    if (pos === dStart) return null;
    parsed.push(parseInt(raw.slice(dStart, pos), 10));
    pos = skipWs(raw, pos);
    if (k < 2) {
      if (raw[pos] !== ",") return null;
      pos++;
    }
  }
  pos = skipWs(raw, pos);
  return raw[pos] === "}" ? [parsed[0]!, parsed[1]!, parsed[2]!] : null;
}

export function registerColorProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  getDocumentTree: (uri: string) => any,
  isParserReady: () => boolean,
) {
  connection.onDocumentColor((params): ColorInformation[] => {
    if (!isParserReady()) return [];
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const tree = getDocumentTree(params.textDocument.uri);
    if (!tree) return [];
    const colors: ColorInformation[] = [];

    const traverse = (node: SyntaxNode) => {
      const isElemMod = node.type === "element_modification" || node.type === "ElementModification";
      const isNamedArg = node.type === "named_argument" || node.type === "NamedArgument";

      if (isElemMod || isNamedArg) {
        const nameNode =
          node.childForFieldName?.("name") ||
          node.childForFieldName?.("identifier") ||
          node.children?.find(
            (c: any) => c.type === "name" || c.type === "identifier" || c.type === "component_reference",
          );
        const name = nameNode?.text?.trim();
        if (name && COLOR_FIELDS.has(name)) {
          let exprNode: any = null;
          if (isElemMod) {
            const modNode =
              node.childForFieldName?.("modification") ?? node.children?.find((c: any) => c.type === "modification");
            const modExpr =
              modNode?.childForFieldName?.("modificationExpression") ??
              modNode?.children?.find((c: any) => c.type === "modification_expression");
            exprNode =
              modExpr?.childForFieldName?.("expression") ??
              modExpr?.children?.find((c: any) => c.type === "expression") ??
              modNode?.children?.find((c: any) => c.type === "expression");
          } else {
            const argNode =
              node.childForFieldName?.("argument") ??
              node.children?.find((c: any) => c.type === "function_argument" || c.type === "argument");
            exprNode =
              argNode?.childForFieldName?.("expression") ??
              argNode?.children?.find((c: any) => c.type === "expression") ??
              argNode;
          }
          if (!exprNode) {
            exprNode = node.children?.find((c: any) => c.type === "expression" || c.type === "primary");
          }

          if (exprNode) {
            const rgb = parseRgbTupleFromExpr(exprNode);
            if (rgb) {
              const [r, g, b] = rgb;
              colors.push({
                range: {
                  start: { line: exprNode.startPosition.row, character: exprNode.startPosition.column },
                  end: { line: exprNode.endPosition.row, character: exprNode.endPosition.column },
                },
                color: Color.create(
                  Math.max(0, Math.min(255, r)) / 255.0,
                  Math.max(0, Math.min(255, g)) / 255.0,
                  Math.max(0, Math.min(255, b)) / 255.0,
                  1.0,
                ),
              });
            }
          }
        }
      }
      const children = node.children || [];
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child) traverse(child);
      }
    };

    traverse(tree.rootNode);
    return colors;
  });

  connection.onColorPresentation((params): ColorPresentation[] => {
    const c = params.color;
    const r = Math.round(c.red * 255);
    const g = Math.round(c.green * 255);
    const b = Math.round(c.blue * 255);
    const label = `{${r}, ${g}, ${b}}`;
    return [ColorPresentation.create(label, { range: params.range, newText: label })];
  });
}

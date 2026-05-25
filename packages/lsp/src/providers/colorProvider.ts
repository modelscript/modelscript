/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/prefer-for-of */
import { Color, ColorInformation, ColorPresentation, Connection, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Node as SyntaxNode } from "web-tree-sitter";

const COLOR_FIELDS = new Set(["color", "lineColor", "fillColor", "textColor"]);

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
      if (node.type === "ElementModification" || node.type === "NamedArgument") {
        const nameNode = node.childForFieldName("name") || node.childForFieldName("identifier");
        const name = nameNode?.text;
        if (name && COLOR_FIELDS.has(name)) {
          let exprNode;
          if (node.type === "ElementModification") {
            const modNode = node.childForFieldName("modification");
            exprNode = modNode?.childForFieldName("modificationExpression")?.childForFieldName("expression");
          } else {
            exprNode = node.childForFieldName("argument")?.childForFieldName("expression");
          }

          if (exprNode?.type === "ArrayConstructor") {
            const listNode = exprNode.childForFieldName("expressionList");
            if (listNode) {
              const exprs = listNode.namedChildren;
              if (exprs.length === 3) {
                const r = parseInt(exprs[0].text);
                const g = parseInt(exprs[1].text);
                const b = parseInt(exprs[2].text);
                if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
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

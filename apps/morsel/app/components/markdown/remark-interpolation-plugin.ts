import type { Node, Parent } from "unist";
import { visit } from "unist-util-visit";

export function remarkInterpolation() {
  return (tree: Node) => {
    visit(tree, "text", (node: any, index: number | undefined, parent: Parent | undefined) => {
      if (!parent || index === undefined) return;

      const regex = /\{\{\s*([\w.]+)\s*\}\}/g;
      const value = node.value as string;
      let match;
      let lastIndex = 0;
      const newNodes: any[] = [];

      while ((match = regex.exec(value)) !== null) {
        const textBefore = value.substring(lastIndex, match.index);
        if (textBefore) {
          newNodes.push({ type: "text", value: textBefore });
        }

        newNodes.push({
          type: "textDirective",
          name: "var",
          attributes: { name: match[1] },
          children: [{ type: "text", value: match[1] }],
        });

        lastIndex = regex.lastIndex;
      }

      if (lastIndex < value.length) {
        newNodes.push({ type: "text", value: value.substring(lastIndex) });
      }

      if (newNodes.length > 0 && (newNodes.length !== 1 || newNodes[0].type !== "text")) {
        parent.children.splice(index, 1, ...newNodes);
      }
    });
  };
}

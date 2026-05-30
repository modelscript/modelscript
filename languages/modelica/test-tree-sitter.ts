import Modelica from "@modelscript/modelica/parser";
import Parser, { type SyntaxNode } from "tree-sitter";

const parser = new Parser();
parser.setLanguage(Modelica);
const tree = parser.parse("model M Pin ip(i=-3, v=-3); end M;");

function findSmallestNode(node: SyntaxNode, start: number, end: number): SyntaxNode | null {
  if (node.startIndex === start && node.endIndex === end) return node;
  for (const child of node.children) {
    if (child.startIndex <= start && child.endIndex >= end) {
      const found = findSmallestNode(child, start, end);
      if (found) return found;
    }
  }
  return null;
}

const walk = (node: SyntaxNode) => {
  if (node.text === "-3" || node.text === "-") {
    console.log("NODE:", node.type, "text:", node.text, "range:", node.startIndex, "-", node.endIndex);
  }
  node.children.forEach(walk);
};
walk(tree.rootNode);

const smallest = findSmallestNode(tree.rootNode, 17, 19);
console.log("SMALLEST FOR 17-19 (i=-3):", smallest?.type, smallest?.text);
console.log("descendantForIndex(17, 18):", tree.rootNode.descendantForIndex(17, 18).type);
console.log("descendantForIndex(17, 19):", tree.rootNode.descendantForIndex(17, 19).type);
